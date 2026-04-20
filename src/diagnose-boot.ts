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

// Re-exported for callers/tests.
export { readDiagnoseLevelFromUrl, resolveDiagnoseLevel } from "./diagnose/url";

const CLIENT_ID = "client" as ComponentId;
const DRAIN_SECONDS = 4;

/**
 * Tier-based grid layout for a pre-placed topology. Components are grouped
 * by role into columns (ingress → gateway → servers → caches → data), then
 * stacked vertically within each column. The client lives at x=-3 and
 * connects to the entry target via a client edge created on READY.
 *
 * Content authors can still override by baking positions via a custom hook
 * (PhysicsDiagnoseController.preplace accepts a positionFor callback).
 */
function tierColumnFor(type: string): number {
  // Columns read left-to-right: edge → gateway → LB → compute/buffers →
  // workers → caches/CB → storage. Related types share a column so the
  // topology stays compact horizontally, and wider COL_SPACING + ROW_SPACING
  // give each tile room to breathe.
  switch (type) {
    case "dns_gtm":
    case "cdn":
      return 0;
    case "api_gateway":
      return 1;
    case "load_balancer":
      return 2;
    case "server":
      return 3;
    case "streaming_server":
    case "queue":
      return 4;
    case "worker":
      return 5;
    case "circuit_breaker":
    case "data_cache":
    case "edge_cache":
      return 6;
    case "database":
    case "blob_storage":
      return 7;
    default:
      return 4;
  }
}

/**
 * Build a deterministic positionFor hook for a topology: assign each
 * component to a column based on its type, stack by arrival order within
 * the column. Each column is centered vertically around y=0 so dense
 * tiers don't crowd sparse ones, and column spacing is x*2 so labels
 * don't collide. Returns a closure ready to hand to `controller.preplace()`.
 */
function buildLayout(
  level: DiagnoseLevel,
): (topologyId: string, index: number) => { x: number; y: number } {
  // First pass: count components per column so we can center the stacks.
  const columnTotals = new Map<number, number>();
  for (const c of level.startingTopology.components) {
    const col = tierColumnFor(c.type);
    columnTotals.set(col, (columnTotals.get(col) ?? 0) + 1);
  }

  // Column spacing (x) — 1.5 grid units between tiers gives adjacent columns
  // clear horizontal breathing room while keeping storage tier (col 7) on
  // the visible board. 2+ was too wide — databases ran off the right edge.
  const COL_SPACING = 1.5;
  // Row spacing (y) — 3 units between siblings so labels never collide and
  // dense stacks (e.g. 4 servers) stay legible (y = -4.5..+4.5).
  const ROW_SPACING = 3;

  // Shift the topology so ingress columns sit just right of the client's
  // landing point at x=-3. With COL_SPACING=1.5 and MID_COL=1, edge (col 0)
  // lands at x=-1.5 and storage (col 7) lands at x=9 — everything visible
  // on the iso board, client cleanly left of the ingress edge.
  const MID_COL = 1;

  // Second pass: assign each component a grid position. Within a column,
  // rows are centered around y=0; e.g. three components get y=-2, 0, +2.
  const colIndex = new Map<number, number>();
  const assigned = new Map<string, { x: number; y: number }>();
  for (const c of level.startingTopology.components) {
    const col = tierColumnFor(c.type);
    const total = columnTotals.get(col) ?? 1;
    const row = colIndex.get(col) ?? 0;
    colIndex.set(col, row + 1);
    const centeredRow = row - (total - 1) / 2;
    assigned.set(c.id, {
      x: (col - MID_COL) * COL_SPACING,
      y: Math.round(centeredRow * ROW_SPACING),
    });
  }
  return (topologyId: string) => assigned.get(topologyId) ?? { x: 4, y: 0 };
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
  let waveDeadline = 0;
  let drainDeadline = 0;
  let waveStartMs = 0;
  let waveDurationMs = 0;
  const firedChaosIndices = new Set<number>();
  let waveElapsedSeconds = 0;
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
          latencySeconds: 0.5,
          twinId: backId,
          direction: "forward",
        });
        const back = new SimConnection({
          id: backId,
          from: { componentId: targetId, portId: "p" as PortId },
          to: { componentId: sourceId, portId: "p" as PortId },
          bandwidth: 500,
          latencySeconds: 0.5,
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

  // ─── Place a visible client at x=-3 (matches campaign) ──────────────
  const CLIENT_POS = { x: -3, y: 0 };
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

    metrics = {
      responded: 0,
      terminated: 0,
      drops: 0,
      revenue: 0,
      latencySum: 0,
      latencyCount: 0,
      totalRequests: 0,
    };
    seenPacketIds.clear();
    metricsAggregator.reset();
    firedChaosIndices.clear();
    waveElapsedSeconds = 0;

    adapter = new SimToRendererAdapter(sim, renderer, positions);
    driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    waveStartMs = performance.now();
    waveDurationMs = level.wave.duration * 1000;
    waveDeadline = waveStartMs + waveDurationMs;
    drainDeadline = waveDeadline + DRAIN_SECONDS * 1000;

    controller.ready();
  });

  // ─── Frame loop ─────────────────────────────────────────────────────
  let lastFrame = performance.now();
  function frame(now: number): void {
    const delta = now - lastFrame;
    lastFrame = now;
    if (driver && adapter) {
      driver.tick(delta);
      waveElapsedSeconds += delta / 1000;

      // Chaos schedule (optional per level).
      const chaos: ReadonlyArray<ChaosEvent> | undefined = level.chaosSchedule;
      if (chaos) {
        for (let i = 0; i < chaos.length; i += 1) {
          if (firedChaosIndices.has(i)) continue;
          const ev = chaos[i]!;
          if (ev.atSeconds <= waveElapsedSeconds) {
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
        } else if (ev.kind === "terminate") {
          metrics.terminated += ev.count;
          metrics.revenue += ev.revenue;
          metrics.latencySum += ev.latencySeconds;
          metrics.latencyCount += 1;
        } else if (ev.kind === "respond-delivered") {
          metrics.responded += ev.count;
          metrics.revenue += ev.revenue;
          metrics.latencySum += ev.latencySeconds;
          metrics.latencyCount += 1;
        }
      }
      adapter.syncFrame(driver.tickEvents);
      metricsAggregator.update(sim, driver.tickEvents, sim.simTime);
      for (const id of sim.components.keys()) {
        if ((id as unknown as string) === (CLIENT_ID as unknown as string)) continue;
        const m = metricsAggregator.getMetricsFor(id);
        renderer.updateComponent(id, { stress: { stressed: m.stressed, dropping: m.dropping } });
      }

      if (now < waveDeadline) {
        const elapsedMs = Math.max(0, now - waveStartMs);
        const tick = Math.floor((elapsedMs / 1000) * 60);
        const total = Math.floor((waveDurationMs / 1000) * 60);
        hud.setStatus(`Wave running — tick ${tick}/${total}`);
      } else if (now < drainDeadline) {
        hud.setStatus("Wave running — draining queue");
      }

      if (now >= drainDeadline) {
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
          ? Math.max(0, (performance.now() - waveStartMs) / 1000)
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
  const user = await resolveInitialSession();
  if (!user && isAuthConfigured) {
    window.location.href = "./index.html";
    return;
  }
  if (user) injectNavBar();
  await main();
}

// Skip auto-boot during tests (jsdom) — tests exercise the pure helpers.
if (typeof window !== "undefined" && typeof document !== "undefined" && !("vitest" in globalThis)) {
  void boot();
}
