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
import { SimConnection } from "@sim/connection";
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
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

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
  let connIdSeq = 0;
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

  function mintConnId(prefix: string): ConnectionId {
    connIdSeq += 1;
    return `${prefix}${String(connIdSeq).padStart(6, "0")}` as ConnectionId;
  }

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
      onPhaseChange: (phase, waveIndex) => {
        const wave = CAMPAIGN_WAVES[waveIndex];
        hud.setPhase(phase);
        hud.setWavePill(waveIndex + 1, CAMPAIGN_WAVES.length);
        if (phase === "build" && wave) {
          hud.setBriefing(wave.title, wave.briefing);
          hud.setStatus("Build phase — place components and click READY");
          hud.hideLossModal();
          hud.setReadyDisabled(false);
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

  // ─── READY → simulate ───────────────────────────────────────────────
  document.getElementById("td-ready-btn")!.addEventListener("click", () => {
    if (controller.phase !== "build") return;
    if (controller.placedComponents.size === 0) {
      hud.setStatus("Place at least one component before READY");
      return;
    }
    const wave = CAMPAIGN_WAVES[controller.currentWaveIndex];
    if (!wave) return;

    // Mint Client at a fixed position (off the placed-component grid).
    const clientPos = { x: -3, y: 0 };
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
    positions.set(CLIENT_ID, clientPos);
    renderer.addComponent(CLIENT_ID, {
      type: "client",
      displayName: "client",
      gridPosition: clientPos,
    });

    // Auto-connect Client to the closest placed component (no manual wiring needed
    // for the entry point — the player's first placement becomes the entry).
    const target = pickClosestPlaced(controller.placedComponents, positions, clientPos);
    if (target) {
      const fwdId = mintConnId("conn-cli-f-");
      const backId = mintConnId("conn-cli-b-");
      const fwd = new SimConnection({
        id: fwdId,
        from: { componentId: CLIENT_ID, portId: "p" as PortId },
        to: { componentId: target, portId: "p" as PortId },
        bandwidth: 500,
        latencySeconds: 0.5,
        twinId: backId,
        direction: "forward",
      });
      const back = new SimConnection({
        id: backId,
        from: { componentId: target, portId: "p" as PortId },
        to: { componentId: CLIENT_ID, portId: "p" as PortId },
        bandwidth: 500,
        latencySeconds: 0.5,
        twinId: fwdId,
        direction: "back",
      });
      sim.addConnection(fwd);
      sim.addConnection(back);
      renderer.addConnection(fwdId, CLIENT_ID, target, { direction: "forward" });
      renderer.addConnection(backId, target, CLIENT_ID, { direction: "back" });
    }

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
  }

  // ─── Initial paint ──────────────────────────────────────────────────
  hud.setWavePill(1, CAMPAIGN_WAVES.length);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hud.setBriefing(CAMPAIGN_WAVES[0]!.title, CAMPAIGN_WAVES[0]!.briefing);
  hud.setStatus("Build phase — place components and click READY");
}

function pickClosestPlaced(
  placed: ReadonlySet<ComponentId>,
  positions: Map<ComponentId, { x: number; y: number }>,
  origin: { x: number; y: number },
): ComponentId | null {
  let best: ComponentId | null = null;
  let bestDist = Infinity;
  for (const id of placed) {
    const p = positions.get(id);
    if (!p) continue;
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

void main();
