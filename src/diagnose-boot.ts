/**
 * Diagnose Mode bootstrap. Mirrors src/physics-td/physics-td.ts in spirit
 * but scoped to a single "inherit a system" level: the level's
 * startingTopology is pre-placed via the controller's `preplace()` hook,
 * the player observes + remediates within `remediationBudget`, and the
 * single wave runs exactly once. Win/lose is decided by the SLA evaluator.
 */
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
  type CyberpunkHudController,
} from "./cyberpunk-hud";
import { CyberpunkTopologyRenderer } from "./render/cyberpunk-topology-renderer";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { BrowserDriver } from "./sim-demo/browser-driver";
import { SimToRendererAdapter } from "./sim-demo/sim-to-renderer";
import { PhysicsDiagnoseController } from "./diagnose/diagnose-controller";
import {
  buildSimComponent,
  COMPONENT_COSTS,
  COMPONENT_SPRITE_TYPE,
} from "./physics-td/component-factory";
import { PlacementUX } from "./physics-td/placement-ux";
import { ConnectUX } from "./physics-td/connect-ux";
import { wireWorkers } from "./physics-td/wire-workers";
import { wireContentRouters } from "./physics-td/wire-content-routers";
import { bindInfoPanel, type InfoPanelHandle } from "./physics-td/component-info-panel";
import { ComponentDossierStore } from "./physics-td/dossier-store";
import * as hud from "./physics-td/hud-bridge";
import { applyChaosEvent, type ChaosEvent } from "./physics-td/chaos";
import { ComponentMetricsAggregator } from "./physics-td/component-metrics";
import { evaluateSLA } from "@sim/sla";
import { resolveDiagnoseLevel } from "./diagnose/url";
import { resolveInitialSession } from "./auth-gate";
import { injectNavBar, isAuthConfigured } from "./auth/index";
import { mountChatbotDrawer } from "./chatbot/chatbot-drawer";
import { serializeContextForChat } from "./chatbot/serialize-context";
import type { ChatRequest } from "./chatbot/chat-client";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { PhysicsCampaignController } from "./physics-td/campaign-controller";
import type { DiagnoseLevel } from "./diagnose/diagnose-level";
import { computeTopologyLayout } from "./layout/topology-layout";

// Re-exported for callers/tests.
export { readDiagnoseLevelFromUrl, resolveDiagnoseLevel } from "./diagnose/url";

const CLIENT_ID = "client" as ComponentId;
const DRAIN_SECONDS = 4;

/**
 * Topology-aware layout for diagnose levels. Uses the shared subtree-aware
 * DAG layout from src/layout/topology-layout.ts.
 */
function buildLayout(
  level: DiagnoseLevel,
): (topologyId: string, index: number) => { x: number; y: number } {
  const topo = level.startingTopology;
  const layout = computeTopologyLayout({
    entryId: topo.entryTargetId,
    components: topo.components,
    connections: topo.connections,
  });
  return (topologyId: string) => layout.positions.get(topologyId) ?? { x: 4, y: 0 };
}

async function waitForHudController(): Promise<CyberpunkHudController> {
  for (let i = 0; i < 60; i += 1) {
    const ctrl = getCyberpunkHudController();
    if (ctrl) return ctrl;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  throw new Error("Cyberpunk HUD controller never initialized");
}

async function main(): Promise<void> {
  const level = resolveDiagnoseLevel(window.location.search);

  const statusEl = document.getElementById("td-status");
  if (statusEl) statusEl.textContent = `Diagnose — ${level.title}`;
  const briefingEl = document.getElementById("td-briefing-title");
  if (briefingEl) briefingEl.textContent = level.title;
  const narrativeEl = document.getElementById("td-diagnose-briefing");
  if (narrativeEl) narrativeEl.textContent = level.briefing;

  activateCyberpunkHud();
  const hudCtrl = await waitForHudController();

  const host = document.getElementById("canvas-host");
  if (!host) throw new Error("canvas-host missing");

  const renderer = new CyberpunkTopologyRenderer();
  await renderer.mount(host);
  renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () =>
    renderer.resize(window.innerWidth, window.innerHeight),
  );

  const sim = new Sim({ seed: 1 });

  const positions = new Map<ComponentId, { x: number; y: number }>();
  const componentTypes = new Map<ComponentId, string>();
  const componentLabels = new Map<ComponentId, string | undefined>();

  // Zone annotations from the TopologyDef keyed by topology id; resolved to
  // ComponentIds after preplace completes (controller returns the minted id
  // map on itself).
  const topoZoneById = new Map<string, string | undefined>();
  const topoLabelById = new Map<string, string | undefined>();
  for (const c of level.startingTopology.components) {
    topoZoneById.set(c.id, c.zone);
    topoLabelById.set(c.id, c.label);
  }

  const refs: {
    placement: PlacementUX | null;
    connect: ConnectUX | null;
  } = { placement: null, connect: null };

  // Wave-runtime state (assigned on READY).
  let driver: BrowserDriver | null = null;
  let adapter: SimToRendererAdapter | null = null;
  let waveSimStart = 0;
  let waveSimEnd = 0;
  let drainSimEnd = 0;
  const firedChaosIndices = new Set<number>();
  let metrics = {
    responded: 0,
    terminated: 0,
    drops: 0,
    revenue: 0,
    latencySum: 0,
    latencyCount: 0,
    totalRequests: 0,
  };
  const seenPacketIds = new Set<string>();
  let perComponentDrops = new Map<ComponentId, { total: number; byReason: Map<string, number> }>();
  let perComponentProcessed = new Map<ComponentId, number>();
  const metricsAggregator = new ComponentMetricsAggregator();

  const controller = new PhysicsDiagnoseController({
    level,
    componentCosts: COMPONENT_COSTS,
    callbacks: {
      onPlaced: (type, id, gridPos) => {
        positions.set(id, gridPos);
        componentTypes.set(id, type);
        // Prefer the TopologyDef-provided label when pre-placing; fall back
        // to a "Type N" auto-label for player-added components.
        const topoId = findTopologyIdForMintedId(id);
        let label = topoId ? topoLabelById.get(topoId) : undefined;
        if (label === undefined) {
          let index = 0;
          for (const t of componentTypes.values()) if (t === type) index += 1;
          label = `${type} ${index}`;
        }
        componentLabels.set(id, label);

        // Mint + add the SimComponent (this callback is the single source of
        // truth for both pre-placement AND player placement — PlacementUX
        // only mutates the renderer ghost + drives tryPlace; it does not
        // call sim.addComponent directly anymore).
        const zone = topoId
          ? (topoZoneById.get(topoId) as
              | "zone_na"
              | "zone_eu"
              | "zone_ap"
              | undefined)
          : undefined;
        const comp = buildSimComponent(type, id, level.wave.revenue, zone, label);
        if (comp) sim.addComponent(comp);

        const sprite = COMPONENT_SPRITE_TYPE.get(type) ?? type;
        renderer.addComponent(id, {
          type: sprite,
          displayName: label ?? type,
          gridPosition: gridPos,
          ...(label !== undefined ? { label } : {}),
        });
      },
      onConnected: (sourceId, targetId, forwardId, backId) => {
        // Single source of truth for both pre-placement and player-driven
        // edges. ConnectUX previously called applyConnection itself; we now
        // consolidate here and never call it.
        const forward = new SimConnection({
          id: forwardId,
          from: { componentId: sourceId, portId: "p" as PortId },
          to: { componentId: targetId, portId: "p" as PortId },
          bandwidth: 500,
          latencySeconds: 0.1,
          twinId: backId,
          direction: "forward",
        });
        const back = new SimConnection({
          id: backId,
          from: { componentId: targetId, portId: "p" as PortId },
          to: { componentId: sourceId, portId: "p" as PortId },
          bandwidth: 500,
          latencySeconds: 0.1,
          twinId: forwardId,
          direction: "back",
        });
        sim.addConnection(forward);
        sim.addConnection(back);
        renderer.addConnection(forwardId, sourceId, targetId, { direction: "forward" });
        renderer.addConnection(backId, targetId, sourceId, { direction: "back" });
      },
      onComponentDeleted: (id) => {
        for (const [connId, conn] of [...sim.connections.entries()]) {
          if (conn.from.componentId === id || conn.to.componentId === id) {
            sim.connections.delete(connId);
          }
        }
        sim.components.delete(id);
        sim.clients.delete(id);
        positions.delete(id);
        componentTypes.delete(id);
        componentLabels.delete(id);
        renderer.removeComponent(id);
      },
      onConnectionDeleted: (forwardId) => {
        const fwd = sim.connections.get(forwardId);
        const twinId = fwd?.twinId;
        sim.connections.delete(forwardId);
        renderer.removeConnection(forwardId);
        if (twinId) {
          sim.connections.delete(twinId);
          renderer.removeConnection(twinId);
        }
      },
      onBudgetChange: (b) => hud.setBudget(b),
      onPhaseChange: (phase) => {
        hud.setPhase(phase);
        if (phase === "build") {
          hud.setStatus("Diagnose — inherit, remediate, READY when done");
          hud.setReadyDisabled(false);
        } else if (phase === "simulate") {
          hud.setStatus("Wave running — tick 0/?");
          hud.setReadyDisabled(true);
          hudCtrl.hideBriefing();
        } else if (phase === "won") {
          hud.setStatus("DIAGNOSIS CLEARED — SLA met");
          hud.setReadyDisabled(true);
          showResultModal(true);
        } else if (phase === "lost") {
          hud.setStatus("DIAGNOSIS FAILED — SLA breached");
          hud.setReadyDisabled(true);
          showResultModal(false);
        }
      },
    },
  });

  // Helper: given a minted ComponentId, find the topology id that produced
  // it (reverse of controller.topologyIdMap). O(n) per lookup but n ≤ ~20.
  function findTopologyIdForMintedId(id: ComponentId): string | undefined {
    for (const [topoId, mintedId] of controller.topologyIdMap.entries()) {
      if (mintedId === id) return topoId;
    }
    return undefined;
  }

  // ─── Pre-place the inherited topology ───────────────────────────────
  const layout = buildLayout(level);
  controller.preplace(layout);
  wireWorkers(sim);
  wireContentRouters(sim, componentTypes);

  // ─── Place a visible client at the left end of the topology ─────────
  // With the architecture centered (ingress tier at x ≈ -8.75), the client
  // sits one tile further left so it reads as the traffic source entering
  // the leftmost tier.
  const CLIENT_POS = { x: -10, y: 0 };
  positions.set(CLIENT_ID, CLIENT_POS);
  renderer.addComponent(CLIENT_ID, {
    type: "client",
    displayName: "client",
    gridPosition: CLIENT_POS,
  });

  // ─── PlacementUX + ConnectUX ────────────────────────────────────────
  // Both are typed against PhysicsCampaignController but only touch shared
  // BaseController methods + `.phase` + `currentWaveRevenue()`. Shim the
  // missing revenue accessor so we can pass the diagnose controller.
  const uxController = Object.assign(controller, {
    currentWaveRevenue: () => level.wave.revenue,
  }) as unknown as PhysicsCampaignController;

  refs.placement = new PlacementUX(sim, renderer, uxController);
  refs.connect = new ConnectUX(
    sim,
    renderer,
    uxController,
    () => refs.placement?.isPlacing() ?? false,
  );

  // ─── Component info panel ────────────────────────────────────────────
  const dossierStore = new ComponentDossierStore();
  const infoPanel: InfoPanelHandle = bindInfoPanel({
    renderer: { onPointerDown: (cb) => renderer.onPointerDown((ev) => cb({ hit: ev.hit })) },
    getSim: () => sim,
    controller: uxController,
    dossierStore,
    hudCtrl,
    componentTypes,
    getDrops: () => perComponentDrops,
    getProcessed: () => perComponentProcessed,
    getMetrics: (id) => metricsAggregator.getMetricsFor(id),
  });
  // Suppress unused-variable lint — infoPanel is used implicitly via its
  // pointerDown listener and live-stats updates during simulate phase.
  void infoPanel;

  // ─── Palette wiring ─────────────────────────────────────────────────
  const paletteButtons = hudCtrl.getPaletteButtons();
  for (const [type, btn] of paletteButtons) {
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(fresh);
    fresh.addEventListener("click", (e) => {
      e.preventDefault();
      refs.placement?.enterPlacingMode(type);
    });
  }

  // ─── Right-click to delete ──────────────────────────────────────────
  function handleContextMenu(ev: MouseEvent): void {
    ev.preventDefault();
    if (controller.phase !== "build") return;
    const compHit = renderer.hitTest(ev.clientX, ev.clientY);
    if (compHit) {
      if (compHit.componentId === CLIENT_ID) {
        hudCtrl.showToast("Cannot delete the client");
        return;
      }
      const ok = controller.tryDeleteComponent(compHit.componentId);
      if (ok) hudCtrl.showToast("Deleted — partial refund");
      return;
    }
    const connId = renderer.hitTestConnection(ev.clientX, ev.clientY);
    if (connId !== null) {
      const conn = sim.connections.get(connId);
      const canonicalId = conn?.direction === "back" ? (conn.twinId ?? connId) : connId;
      const ok = controller.tryDeleteConnection(canonicalId);
      if (ok) hudCtrl.showToast("Connection deleted");
    }
  }
  // ─── Component drag — update positions map ───────────────────────────
  renderer.onComponentDragEnd(({ componentId, gridPosition }) => {
    positions.set(componentId, gridPosition);
  });

  // ─── Left-click on connection to toggle L-routing ───────────────────
  renderer.onConnectionPointerDown((connId) => {
    if (controller.phase !== "build") return;
    renderer.toggleConnectionRoute(connId);
  });

  host.addEventListener("contextmenu", handleContextMenu);
  const canvas = renderer.getCanvas();
  if (canvas) canvas.addEventListener("contextmenu", handleContextMenu);

  // ─── READY → wave runtime ───────────────────────────────────────────
  const readyBtn = document.getElementById("td-ready-btn");
  readyBtn?.addEventListener("click", () => {
    if (controller.phase !== "build") return;

    // Auto-connect the client to the entry target of the inherited topology
    // so the player doesn't need to wire the client themselves. (Diagnose
    // levels ship with their entry target baked in.)
    const entryTopoId = level.startingTopology.entryTargetId;
    const entryMinted = controller.topologyIdMap.get(entryTopoId);
    if (entryMinted) {
      const alreadyWired = [...sim.connections.values()].some(
        (c) =>
          c.from.componentId === CLIENT_ID &&
          c.to.componentId === entryMinted &&
          c.direction === "forward",
      );
      if (!alreadyWired) {
        const forwardId = `conn_client_fwd` as unknown as ConnectionId;
        const backId = `conn_client_back` as unknown as ConnectionId;
        const forward = new SimConnection({
          id: forwardId,
          from: { componentId: CLIENT_ID, portId: "p" as PortId },
          to: { componentId: entryMinted, portId: "p" as PortId },
          bandwidth: 500,
          latencySeconds: 0.1,
          twinId: backId,
          direction: "forward",
        });
        const back = new SimConnection({
          id: backId,
          from: { componentId: entryMinted, portId: "p" as PortId },
          to: { componentId: CLIENT_ID, portId: "p" as PortId },
          bandwidth: 500,
          latencySeconds: 0.1,
          twinId: forwardId,
          direction: "back",
        });
        sim.addConnection(forward);
        sim.addConnection(back);
        renderer.addConnection(forwardId, CLIENT_ID, entryMinted, { direction: "forward" });
        renderer.addConnection(backId, entryMinted, CLIENT_ID, { direction: "back" });
      }
    }

    const ts = new TrafficSource(level.wave, makeSimRng(42));
    const client = new SimClient({
      id: CLIENT_ID,
      capabilities: [],
      packetRate: level.wave.packetRate,
      trafficSource: ts,
      waveStartTime: sim.simTime,
      waveEndTime: sim.simTime + level.wave.duration,
    });
    sim.addClient(client);
    wireWorkers(sim);
    wireContentRouters(sim, componentTypes);

    metrics = {
      responded: 0,
      terminated: 0,
      drops: 0,
      revenue: 0,
      latencySum: 0,
      latencyCount: 0,
      totalRequests: 0,
    };
    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    seenPacketIds.clear();
    metricsAggregator.reset();
    firedChaosIndices.clear();

    // ── Dev diagnostics ──
    const compLines = [...sim.components.values()].map((c) => {
      const type = componentTypes.get(c.id) ?? "?";
      const label = componentLabels.get(c.id) ?? "";
      const cap = c.bucket ? `cap=${c.bucket.capacity()}/s` : "unlimited";
      return `  [${c.id}] ${type} "${label}" (${cap})`;
    });
    const connLines = [...sim.connections.values()]
      .filter((c) => c.direction === "forward")
      .map((c) => {
        const fromLabel = componentLabels.get(c.from.componentId as ComponentId) ?? c.from.componentId;
        const toLabel = componentLabels.get(c.to.componentId as ComponentId) ?? c.to.componentId;
        return `  ${fromLabel} → ${toLabel}`;
      });
    console.log(
      `[wave-start] ${level.id} | intensity=${level.wave.intensity} packetRate=${level.wave.packetRate}\n` +
      `COMPONENTS:\n${compLines.join("\n")}\n` +
      `CONNECTIONS:\n${connLines.join("\n")}`
    );

    adapter = new SimToRendererAdapter(sim, renderer, positions);
    driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    waveSimStart = sim.simTime;
    waveSimEnd = sim.simTime + level.wave.duration;
    drainSimEnd = waveSimEnd + DRAIN_SECONDS;

    controller.ready();
  });

  // ─── Frame loop ─────────────────────────────────────────────────────
  let lastFrame = performance.now();
  function frame(now: number): void {
    const delta = now - lastFrame;
    lastFrame = now;
    if (driver && adapter) {
      const scaledDelta = delta * hudCtrl.getSimSpeed();
      driver.tick(scaledDelta);

      // Chaos schedule (optional per level).
      const chaosElapsed = sim.simTime - waveSimStart;
      const chaos: ReadonlyArray<ChaosEvent> | undefined = level.chaosSchedule;
      if (chaos) {
        for (let i = 0; i < chaos.length; i += 1) {
          if (firedChaosIndices.has(i)) continue;
          const ev = chaos[i]!;
          if (ev.atSeconds <= chaosElapsed) {
            applyChaosEvent(ev, sim);
            firedChaosIndices.add(i);
          }
        }
      }

      for (const p of sim.activePackets) {
        const id = p.id as unknown as string;
        if (p.parentId === null && !seenPacketIds.has(id)) {
          seenPacketIds.add(id);
          metrics.totalRequests += p.requests.length;
        }
      }
      for (const ev of driver.tickEvents) {
        if (ev.kind === "drop") {
          metrics.drops += ev.count;
          if (ev.count > 0) {
            console.warn("[drop]", ev.reason, "×" + ev.count, "at", ev.componentId, `(type=${componentTypes.get(ev.componentId as ComponentId) ?? "?"})`);
          }
          const compId = ev.componentId as ComponentId;
          let tally = perComponentDrops.get(compId);
          if (!tally) { tally = { total: 0, byReason: new Map() }; perComponentDrops.set(compId, tally); }
          tally.total += ev.count;
          tally.byReason.set(ev.reason, (tally.byReason.get(ev.reason) ?? 0) + ev.count);
        } else if (ev.kind === "terminate") {
          metrics.terminated += ev.count;
          metrics.revenue += ev.revenue;
          metrics.latencySum += ev.latencySeconds;
          metrics.latencyCount += 1;
          const compId = ev.componentId as ComponentId;
          perComponentProcessed.set(compId, (perComponentProcessed.get(compId) ?? 0) + ev.count);
        } else if (ev.kind === "respond-delivered") {
          metrics.responded += ev.count;
          metrics.revenue += ev.revenue;
          metrics.latencySum += ev.latencySeconds;
          metrics.latencyCount += 1;
          const compId = ev.componentId as ComponentId;
          perComponentProcessed.set(compId, (perComponentProcessed.get(compId) ?? 0) + ev.count);
        }
      }
      adapter.syncFrame(driver.tickEvents);
      metricsAggregator.update(sim, driver.tickEvents, sim.simTime);
      for (const id of sim.components.keys()) {
        if ((id as unknown as string) === (CLIENT_ID as unknown as string)) continue;
        const m = metricsAggregator.getMetricsFor(id);
        renderer.updateComponent(id, { stress: { stressed: m.stressed, dropping: m.dropping } });
      }

      // Refresh the info panel live stats every frame.
      if (infoPanel.isOpen() && controller.phase === "simulate") {
        infoPanel.updateLiveStats();
      }

      const simElapsed = sim.simTime - waveSimStart;
      const waveDuration = waveSimEnd - waveSimStart;
      if (sim.simTime < waveSimEnd) {
        const tick = Math.floor(simElapsed * 60);
        const total = Math.floor(waveDuration * 60);
        hud.setStatus(`Wave running — tick ${tick}/${total}`);
      } else if (sim.simTime < drainSimEnd) {
        hud.setStatus("Wave running — draining queue");
      }

      if (sim.simTime >= drainSimEnd) {
        const avgLatency =
          metrics.latencyCount > 0 ? metrics.latencySum / metrics.latencyCount : 0;
        driver = null;
        adapter = null;
        const sla = evaluateSLA(
          {
            totalRequests: metrics.totalRequests,
            responded: metrics.responded,
            terminated: metrics.terminated,
            drops: metrics.drops,
            avgLatencySeconds: avgLatency,
            totalRevenue: metrics.revenue,
          },
          level.sla,
        );
        controller.onWaveEnd(sla.passed);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ─── Result modal (win/lose) ────────────────────────────────────────
  function showResultModal(won: boolean): void {
    document.querySelector(".cp-win-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "cp-win-overlay";
    const modal = document.createElement("div");
    modal.className = "cp-win-modal cp-panel";

    const title = document.createElement("h2");
    title.className = "cp-win-title";
    title.textContent = won ? "DIAGNOSIS CLEARED" : "SLA BREACHED";
    modal.appendChild(title);

    const avgLatency =
      metrics.latencyCount > 0 ? metrics.latencySum / metrics.latencyCount : 0;
    const delivered = metrics.responded + metrics.terminated;
    const avail = metrics.totalRequests > 0 ? delivered / metrics.totalRequests : 1;

    const stats = document.createElement("div");
    stats.className = "cp-win-stats";
    for (const [label, value] of [
      ["Avail", `${(avail * 100).toFixed(1)}%`],
      ["Latency", `${avgLatency.toFixed(2)}s`],
      ["Earned", `$${Math.round(metrics.revenue)}`],
      ["Budget", `$${controller.budget}`],
    ] as const) {
      const row = document.createElement("div");
      row.className = "cp-win-stat";
      row.textContent = `${label}  ${value}`;
      stats.appendChild(row);
    }
    modal.appendChild(stats);

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "cp-win-cta";
    cta.textContent = "RESTART";
    modal.appendChild(cta);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    cta.addEventListener("click", () => window.location.reload());
    cta.focus();
  }

  // ─── Chatbot tutor drawer — now serializes real sim state ───────────
  mountChatbotDrawer({
    host: document.body,
    ...(!isAuthConfigured && { endpoint: "/api/chat", skipAuth: true }),
    getContext: (): ChatRequest | null => {
      const avgLatency =
        metrics.latencyCount > 0 ? metrics.latencySum / metrics.latencyCount : 0;
      const dropRate =
        metrics.totalRequests > 0 ? metrics.drops / metrics.totalRequests : 0;
      const delivered = metrics.responded + metrics.terminated;
      const availability =
        metrics.totalRequests > 0 ? delivered / metrics.totalRequests : 1;
      const currentTick =
        controller.phase === "simulate"
          ? Math.max(0, sim.simTime - waveSimStart)
          : 0;
      return serializeContextForChat({
        sim,
        wave: level.wave,
        waveId: level.id,
        waveTitle: level.title,
        sla: level.sla,
        metricsAggregator: controller.phase === "simulate" ? metricsAggregator : null,
        componentTypes,
        componentLabels,
        mode: "diagnose",
        hintLevel: "coach",
        levelId: level.id,
        liveMetrics: {
          availability,
          avgLatencySeconds: avgLatency,
          dropRate,
          currentTickSeconds: currentTick,
        },
        recentEvents: [],
        conversationHistory: [],
        userMessage: "",
      });
    },
  });

  // ─── Initial HUD paint ──────────────────────────────────────────────
  hud.setWavePill(1, 1);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hud.setStatus("Diagnose — inherit, remediate, READY when done");

  (window as unknown as { __diagnoseController: PhysicsDiagnoseController }).__diagnoseController =
    controller;
  (window as unknown as { __diagnoseSim: Sim }).__diagnoseSim = sim;
}

async function boot(): Promise<void> {
  const user = await resolveInitialSession(8000);
  if (!user && isAuthConfigured) {
    window.location.href = "./index.html";
    return;
  }
  if (user) injectNavBar();
  await main();
  // Signal the loading-screen overlay (in diagnose.html) that the renderer
  // is up and the level is wired. The overlay listens for this event and
  // also has a 12s safety timeout in case main() throws.
  window.dispatchEvent(new Event("stackattack:ready"));
}

// Skip auto-boot during tests (jsdom) — tests exercise the pure helpers.
if (typeof window !== "undefined" && typeof document !== "undefined" && !("vitest" in globalThis)) {
  void boot();
}
