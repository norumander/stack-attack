// Force cyberpunk HUD activation (depends on ?renderer=iso URL flag).
if (!new URLSearchParams(window.location.search).has("renderer")) {
  const url = new URL(window.location.href);
  url.searchParams.set("renderer", "iso");
  window.location.replace(url.toString());
}

import { activateCyberpunkHud } from "@dashboard/cyberpunk-hud";
import { CyberpunkTopologyRenderer } from "@dashboard/render/cyberpunk-topology-renderer";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { evaluateSLA } from "@sim/sla";
import { BrowserDriver } from "@dashboard/sim-demo/browser-driver";
import { SimToRendererAdapter } from "@dashboard/sim-demo/sim-to-renderer";
import { PhysicsCampaignController } from "./campaign-controller";
import { COMPONENT_COSTS } from "./component-factory";
import { CAMPAIGN_WAVES } from "./waves";
import { PlacementUX } from "./placement-ux";
import { ConnectUX } from "./connect-ux";
import * as hud from "./hud-bridge";
import type { ComponentId } from "@core/types/ids";

const CLIENT_ID = "client" as ComponentId;
// Drain budget after wave duration: extra real-seconds for in-flight packets to retire.
const DRAIN_SECONDS = 4;

async function main(): Promise<void> {
  activateCyberpunkHud();

  const host = document.getElementById("canvas-host");
  if (!host) throw new Error("canvas-host missing");

  const renderer = new CyberpunkTopologyRenderer();
  await renderer.mount(host);
  renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () =>
    renderer.resize(window.innerWidth, window.innerHeight),
  );

  let sim = new Sim({ seed: 1 });

  // Per-wave positions for the sim-to-renderer adapter (tracks placed positions).
  let positions = new Map<ComponentId, { x: number; y: number }>();

  // Mutable refs for late-bound UX wiring.
  const refs: {
    placement: PlacementUX | null;
    connect: ConnectUX | null;
  } = { placement: null, connect: null };

  // Wave-runtime state (set when READY fires).
  let driver: BrowserDriver | null = null;
  let adapter: SimToRendererAdapter | null = null;
  let waveDeadline = 0; // performance.now ms — cutoff for sim ticks
  let drainDeadline = 0; // performance.now ms — cutoff for drain phase
  let metrics = {
    responded: 0,
    terminated: 0,
    drops: 0,
    revenue: 0,
    latencySum: 0,
    latencyCount: 0,
    totalPackets: 0,
  };
  const seenPacketIds = new Set<string>();

  const controller = new PhysicsCampaignController({
    waves: CAMPAIGN_WAVES.map((w) => ({ id: w.id, startBudget: w.startBudget })),
    componentCosts: COMPONENT_COSTS,
    callbacks: {
      onPlaced: (type, id, gridPos) => {
        positions.set(id, gridPos);
        refs.placement?.applyPlacement(type, id, gridPos);
      },
      onConnected: (sourceId, targetId, forwardId, backId) => {
        refs.connect?.applyConnection(sourceId, targetId, forwardId, backId);
      },
      onComponentDeleted: (id) => {
        // Remove all sim connections touching this component; renderer side is
        // covered by the onConnectionDeleted callbacks the controller also fires.
        for (const [connId, conn] of [...sim.connections.entries()]) {
          if (conn.from.componentId === id || conn.to.componentId === id) {
            sim.connections.delete(connId);
          }
        }
        sim.components.delete(id);
        sim.clients.delete(id);
        positions.delete(id);
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
      onPhaseChange: (phase, waveIndex) => {
        const wave = CAMPAIGN_WAVES[waveIndex];
        hud.setPhase(phase);
        hud.setWavePill(waveIndex + 1, CAMPAIGN_WAVES.length);
        if (phase === "build" && wave) {
          hud.setBriefing(wave.title, wave.briefing);
          hud.setStatus("Build phase — place components, right-click to delete, READY when done");
          hud.hideLossModal();
          hud.setReadyDisabled(false);
          setupClientForBuild();
        } else if (phase === "simulate") {
          hud.setStatus("Wave running…");
          hud.setReadyDisabled(true);
        } else if (phase === "won") {
          hud.setStatus("Wave WON — advancing to next wave…");
          hud.setReadyDisabled(true);
          // Auto-advance to next wave after a short celebration delay.
          window.setTimeout(() => controller.nextWave(), 1500);
        } else if (phase === "lost") {
          hud.setReadyDisabled(true);
          // Loss modal is shown by the wave-end handler with the SLA reasons.
        } else if (phase === "campaign-complete") {
          hud.setStatus("Campaign complete — well played!");
          hud.setReadyDisabled(true);
        }
      },
      onBudgetChange: (b) => hud.setBudget(b),
    },
  });

  refs.placement = new PlacementUX(sim, renderer, controller);
  refs.connect = new ConnectUX(sim, renderer, controller, () =>
    refs.placement?.isPlacing() ?? false,
  );

  // Palette buttons — enter placement mode.
  document.querySelectorAll<HTMLButtonElement>(".td-palette-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      if (type) refs.placement?.enterPlacingMode(type);
    });
  });

  // Right-click to delete a placed component (refunds cost). Connections
  // attached to the deleted component are cleaned up automatically by the
  // controller's onConnectionDeleted callbacks.
  host.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (controller.phase !== "build") return;
    const hit = renderer.hitTest(ev.clientX, ev.clientY);
    if (!hit) return;
    if (hit.componentId === CLIENT_ID) {
      hud.setStatus("Cannot delete the client — it's the entry point");
      return;
    }
    const ok = controller.tryDeleteComponent(hit.componentId);
    if (ok) hud.setStatus("Deleted — budget refunded");
  });

  // Client visual lives on the board during build phase so the player can
  // see the entry point and route to it. The SimClient (with TrafficSource)
  // is attached on READY.
  const CLIENT_POS = { x: -3, y: 0 };
  function setupClientForBuild(): void {
    if (positions.has(CLIENT_ID)) return; // already there
    positions.set(CLIENT_ID, CLIENT_POS);
    renderer.addComponent(CLIENT_ID, {
      type: "client",
      displayName: "client",
      gridPosition: CLIENT_POS,
    });
  }
  // Initial build phase already painted before controller emits onPhaseChange,
  // so we also bootstrap the client here for the first wave.
  setupClientForBuild();

  // ─── READY → simulate ───────────────────────────────────────────────
  document.getElementById("td-ready-btn")!.addEventListener("click", () => {
    if (controller.phase !== "build") return;
    if (controller.placedComponents.size === 0) {
      hud.setStatus("Place at least one component before READY");
      return;
    }
    const wave = CAMPAIGN_WAVES[controller.currentWaveIndex];
    if (!wave) return;

    // Verify the player has connected the client to something — otherwise
    // packets will spawn but never enter the network.
    const clientHasEgress = [...sim.connections.values()].some(
      (c) => c.from.componentId === CLIENT_ID && c.direction === "forward",
    );
    if (!clientHasEgress) {
      hud.setStatus("Connect the client to a component before READY");
      return;
    }

    // Attach the SimClient (with TrafficSource for this wave) to the existing
    // client visual. The renderer entry was created at build phase start.
    const ts = new TrafficSource(
      wave.wave,
      makeSimRng(42 + controller.currentWaveIndex),
    );
    const client = new SimClient({
      id: CLIENT_ID,
      capabilities: [],
      packetRate: wave.wave.packetRate,
      trafficSource: ts,
      waveStartTime: 0,
      waveEndTime: wave.wave.duration,
    });
    sim.addClient(client);

    // Reset metric accumulators
    metrics = {
      responded: 0,
      terminated: 0,
      drops: 0,
      revenue: 0,
      latencySum: 0,
      latencyCount: 0,
      totalPackets: 0,
    };
    seenPacketIds.clear();

    adapter = new SimToRendererAdapter(sim, renderer, positions);
    driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    waveDeadline = performance.now() + wave.wave.duration * 1000;
    drainDeadline = waveDeadline + DRAIN_SECONDS * 1000;

    controller.ready();
  });

  // ─── Frame loop — runs always; only ticks while driver active ───────
  let lastFrame = performance.now();
  function frame(now: number): void {
    const delta = now - lastFrame;
    lastFrame = now;
    if (driver && adapter) {
      driver.tick(delta);
      // Count fresh top-level packets (parentId === null) as denominator.
      for (const p of sim.activePackets) {
        const id = p.id as unknown as string;
        if (p.parentId === null && !seenPacketIds.has(id)) {
          seenPacketIds.add(id);
          metrics.totalPackets += 1;
        }
      }
      for (const ev of sim.lastStepEvents) {
        if (ev.kind === "drop") {
          metrics.drops += ev.count;
        } else if (ev.kind === "terminate") {
          metrics.terminated += 1;
          metrics.revenue += ev.revenue;
          metrics.latencySum += ev.latencySeconds;
          metrics.latencyCount += 1;
        } else if (ev.kind === "respond-delivered") {
          metrics.responded += 1;
          metrics.revenue += ev.revenue;
          metrics.latencySum += ev.latencySeconds;
          metrics.latencyCount += 1;
        }
      }
      adapter.syncFrame();

      if (now >= drainDeadline) {
        // Wave done — evaluate SLA.
        const wave = CAMPAIGN_WAVES[controller.currentWaveIndex]!;
        const avgLatency =
          metrics.latencyCount > 0 ? metrics.latencySum / metrics.latencyCount : 0;
        const sla = evaluateSLA(
          {
            totalPackets: metrics.totalPackets,
            responded: metrics.responded,
            terminated: metrics.terminated,
            drops: metrics.drops,
            avgLatencySeconds: avgLatency,
            totalRevenue: metrics.revenue,
          },
          wave.sla,
        );
        driver = null;
        adapter = null;
        if (!sla.passed) {
          const reasons = sla.reasons.length > 0 ? sla.reasons.join("; ") : "wave failed";
          hud.showLossModal("Wave LOST", `SLA failed: ${reasons}`);
        }
        controller.onWaveEnd(sla.passed);
      } else if (now >= waveDeadline) {
        hud.setStatus("Wave running… draining queue");
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ─── Retry / Reset (Task 8) ─────────────────────────────────────────
  document.getElementById("td-retry-btn")!.addEventListener("click", () => {
    if (controller.phase !== "lost") return;
    // Wipe everything from sim + renderer.
    clearWaveWorld();
    controller.retry();
  });
  document.getElementById("td-reset-btn")!.addEventListener("click", () => {
    window.location.reload();
  });

  function clearWaveWorld(): void {
    // Snapshot ids first so we can iterate while mutating.
    const compIds = Array.from(sim.components.keys());
    const connIds = Array.from(sim.connections.keys());
    for (const id of connIds) {
      sim.connections.delete(id);
      renderer.removeConnection(id);
    }
    for (const id of compIds) {
      sim.components.delete(id);
      renderer.removeComponent(id);
    }
    sim.clients.clear();
    sim.activePackets.length = 0;
    positions.clear();
    // Fresh sim instance to wipe internal merge maps + revenue ledger.
    sim = new Sim({ seed: 1 });
    // PlacementUX/ConnectUX hold a Sim reference — rebuild them so they
    // operate on the new instance.
    refs.placement = new PlacementUX(sim, renderer, controller);
    refs.connect = new ConnectUX(sim, renderer, controller, () =>
      refs.placement?.isPlacing() ?? false,
    );
    // Repaint the client visual for the next build phase.
    setupClientForBuild();
  }

  // ─── Initial paint ──────────────────────────────────────────────────
  hud.setWavePill(1, CAMPAIGN_WAVES.length);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hud.setBriefing(CAMPAIGN_WAVES[0]!.title, CAMPAIGN_WAVES[0]!.briefing);
  hud.setStatus("Build phase — place components and click READY");
}

void main();
