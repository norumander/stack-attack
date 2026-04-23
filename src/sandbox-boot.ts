/**
 * Sandbox Mode bootstrap. Freeform topology builder with manual traffic
 * control — no waves, no budget constraints, no SLA. Players place
 * components, wire connections, tune traffic sliders, and observe the
 * system in real-time. Supports export/import of topologies.
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
import {
  buildSimComponent,
  COMPONENT_SPRITE_TYPE,
  COMPONENT_COSTS,
} from "./physics-td/component-factory";
import { PlacementUX } from "./physics-td/placement-ux";
import { ConnectUX } from "./physics-td/connect-ux";
import { wireWorkers } from "./physics-td/wire-workers";
import { wireContentRouters } from "./physics-td/wire-content-routers";
import { bindInfoPanel, type InfoPanelHandle } from "./physics-td/component-info-panel";
import { ComponentDossierStore } from "./physics-td/dossier-store";
import { ComponentMetricsAggregator } from "./physics-td/component-metrics";
import { applyChaosEvent } from "./physics-td/chaos";
import * as hud from "./physics-td/hud-bridge";
import { SandboxController } from "./sandbox/sandbox-controller";
import { buildTrafficPanel, type TrafficSettings } from "./sandbox/traffic-panel";
import {
  exportTopology,
  importTopology,
  showExportModal,
  showImportModal,
  type SandboxTrafficSettings,
} from "./sandbox/import-export";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";
import type { PhysicsCampaignController } from "./physics-td/campaign-controller";
import type { TopologyDef } from "./playtest/topology-builder";
import { computeTopologyLayout, computeWireRouting } from "./layout/topology-layout";

const CLIENT_ID = "client" as ComponentId;
const CLIENT_POS = { x: -10, y: 0 };

async function waitForHudController(): Promise<CyberpunkHudController> {
  for (let i = 0; i < 60; i += 1) {
    const ctrl = getCyberpunkHudController();
    if (ctrl) return ctrl;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  throw new Error("Cyberpunk HUD controller never initialized");
}

// ---------------------------------------------------------------------------
// Build a WaveDef from the traffic panel sliders
// ---------------------------------------------------------------------------

function buildWaveDef(settings: TrafficSettings): WaveDef {
  const packetRate = Math.max(1, Math.round(settings.intensity / 8));
  return {
    intensity: settings.intensity,
    packetRate,
    duration: 9999,
    composition: {
      writeRatio: settings.writeRatio,
      authRatio: settings.authRatio,
      streamRatio: settings.streamRatio,
      largeRatio: settings.largeRatio,
      asyncRatio: settings.asyncRatio,
    },
    keyDistribution: settings.keyKind === "zipf"
      ? { kind: "zipf", alpha: settings.zipfAlpha, spaceSize: settings.spaceSize }
      : { kind: "uniform", spaceSize: settings.spaceSize },
    revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
    ...(settings.streamRatio > 0 && { streamConfig: { duration: 1.5, bandwidth: 20 } }),
    entryClients: [CLIENT_ID],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  activateCyberpunkHud();
  // Sandbox mode flag — CSS hides wave-based controls (READY button) since
  // sandbox uses the traffic-panel START/STOP toggle instead.
  document.body.classList.add("cp-mode-sandbox");
  const hudCtrl = await waitForHudController();

  const host = document.getElementById("canvas-host");
  if (!host) throw new Error("canvas-host missing");

  const renderer = new CyberpunkTopologyRenderer();
  await renderer.mount(host);
  renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () =>
    renderer.resize(window.innerWidth, window.innerHeight),
  );

  let sim = new Sim({ seed: 1 });

  const positions = new Map<ComponentId, { x: number; y: number }>();
  const componentTypes = new Map<ComponentId, string>();
  const componentLabels = new Map<ComponentId, string | undefined>();

  const refs: {
    placement: PlacementUX | null;
    connect: ConnectUX | null;
  } = { placement: null, connect: null };

  // Wave-runtime state
  let driver: BrowserDriver | null = null;
  let adapter: SimToRendererAdapter | null = null;
  let lastImportedJson: string | null = null;
  let perComponentDrops = new Map<ComponentId, { total: number; byReason: Map<string, number> }>();
  let perComponentProcessed = new Map<ComponentId, number>();
  const metricsAggregator = new ComponentMetricsAggregator();

  // ─── Controller ─────────────────────────────────────────────────────
  const controller = new SandboxController({
    onPlaced: (type, id, gridPos) => {
      positions.set(id, gridPos);
      componentTypes.set(id, type);
      let index = 0;
      for (const t of componentTypes.values()) if (t === type) index += 1;
      const label = `${type} ${index}`;
      componentLabels.set(id, label);
      const comp = buildSimComponent(type, id, controller.currentWaveRevenue(), undefined, label);
      if (comp) sim.addComponent(comp);
      const sprite = COMPONENT_SPRITE_TYPE.get(type) ?? type;
      renderer.addComponent(id, {
        type: sprite,
        displayName: label,
        gridPosition: gridPos,
        label,
      });
    },
    onConnected: (sourceId, targetId, forwardId, backId) => {
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
    onBudgetChange: (_b) => { /* sandbox has infinite budget — no HUD update */ },
  });

  const uxController = controller as unknown as PhysicsCampaignController;

  // ─── Client visual ──────────────────────────────────────────────────
  positions.set(CLIENT_ID, CLIENT_POS);
  renderer.addComponent(CLIENT_ID, {
    type: "client",
    displayName: "client",
    gridPosition: CLIENT_POS,
  });

  // ─── PlacementUX + ConnectUX ────────────────────────────────────────
  function rebuildUX(): void {
    refs.placement = new PlacementUX(sim, renderer, uxController);
    refs.connect = new ConnectUX(
      sim,
      renderer,
      uxController,
      () => refs.placement?.isPlacing() ?? false,
    );
  }
  rebuildUX();

  // ─── Component info panel ───────────────────────────────────────────
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
  void infoPanel;

  // ─── HUD setup ──────────────────────────────────────────────────────
  // Hide briefing + viability panels (not used in sandbox)
  document.getElementById("cp-briefing-panel")?.classList.add("cp-hidden");
  document.querySelector(".cp-viability")?.classList.add("cp-hidden");

  // Zone selector — always show all zones in sandbox
  hudCtrl.setZones(["zone_na", "zone_eu", "zone_ap"]);

  // ─── Zone reassignment ──────────────────────────────────────────────
  hudCtrl.onZoneClick((zone) => {
    if (controller.phase !== "build") return;
    const selectedId = infoPanel.openId();
    if (!selectedId) return;
    const comp = sim.components.get(selectedId);
    if (!comp) return;
    comp.zone = zone ?? null;
    const baseLabel = componentLabels.get(selectedId);
    if (baseLabel) {
      const stripped = baseLabel.replace(/\s*\[(?:NA|EU|AP)\]$/, "");
      const zoneBadge = zone ? ` [${zone.replace("zone_", "").toUpperCase()}]` : "";
      const newLabel = `${stripped}${zoneBadge}`;
      componentLabels.set(selectedId, newLabel);
      renderer.updateComponent(selectedId, { label: newLabel });
    }
    const zoneName = zone ? zone.replace("zone_", "").toUpperCase() : "none";
    hudCtrl.showToast(`Zone → ${zoneName}`);
  });

  // ─── Palette wiring ─────────────────────────────────────────────────
  const paletteButtons = hudCtrl.getPaletteButtons();
  const livePaletteButtons = new Map<string, HTMLButtonElement>();
  for (const [type, btn] of paletteButtons) {
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(fresh);
    livePaletteButtons.set(type, fresh);
    fresh.addEventListener("click", (e) => {
      e.preventDefault();
      refs.placement?.enterPlacingMode(type);
    });
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
      if (ok) hudCtrl.showToast("Deleted — budget refunded");
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

  // ─── Traffic panel ──────────────────────────────────────────────────
  const rightCol = document.querySelector(".cp-right-col") as HTMLElement | null;
  const trafficPanel = buildTrafficPanel(rightCol ?? document.body);

  // ─── START traffic ──────────────────────────────────────────────────
  function startTraffic(): void {
    if (controller.phase !== "build") return;

    // Verify the client is connected to something
    const clientHasEgress = [...sim.connections.values()].some(
      (c) => c.from.componentId === CLIENT_ID && c.direction === "forward",
    );
    if (!clientHasEgress) {
      hudCtrl.showToast("Connect the client to a component before starting");
      return;
    }

    const settings = trafficPanel.settings;
    const wave = buildWaveDef(settings);
    const ts = new TrafficSource(wave, makeSimRng(42));
    const client = new SimClient({
      id: CLIENT_ID,
      capabilities: [],
      packetRate: wave.packetRate,
      trafficSource: ts,
      waveStartTime: sim.simTime,
      waveEndTime: sim.simTime + wave.duration,
    });
    sim.addClient(client);
    wireWorkers(sim);
    wireContentRouters(sim, componentTypes);

    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    metricsAggregator.reset();

    adapter = new SimToRendererAdapter(sim, renderer, positions);
    driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });

    controller.startSimulate();
    trafficPanel.setRunning(true);
    hud.setPhase("simulate");
    hud.setStatus("Sandbox — traffic flowing");
  }

  // ─── STOP traffic ───────────────────────────────────────────────────
  function stopTraffic(): void {
    driver = null;
    adapter = null;
    controller.stopSimulate();
    trafficPanel.setRunning(false);
    hud.setPhase("build");
    hud.setStatus("Sandbox — place components, then START traffic");

    renderer.resetTransientVisuals();
    for (const id of sim.components.keys()) {
      renderer.updateComponent(id, {
        utilization: 0,
        pendingCount: 0,
        stress: { stressed: false, dropping: false },
      });
    }

    // Rebuild fresh sim preserving topology
    const oldConnections = [...sim.connections.values()];
    const oldZones = new Map<ComponentId, string | null>();
    for (const [id, comp] of sim.components) oldZones.set(id, comp.zone);

    sim = new Sim({ seed: 1 });
    for (const [id, type] of componentTypes) {
      const zone = oldZones.get(id) ?? undefined;
      const label = componentLabels.get(id);
      const comp = buildSimComponent(type, id, controller.currentWaveRevenue(), zone ?? undefined, label);
      if (comp) sim.addComponent(comp);
    }
    for (const c of oldConnections) sim.addConnection(c);
    wireWorkers(sim);
    wireContentRouters(sim, componentTypes);
    rebuildUX();

    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    metricsAggregator.reset();
    infoPanel.hide();
  }

  trafficPanel.onStart(() => startTraffic());
  trafficPanel.onStop(() => stopTraffic());

  // ─── Live-tuning: slider changes while simulating ───────────────────
  trafficPanel.onChange(() => {
    if (controller.phase !== "simulate" || !driver) return;
    const settings = trafficPanel.settings;
    const wave = buildWaveDef(settings);
    const newTs = new TrafficSource(wave, makeSimRng(Date.now()));
    const newPacketRate = wave.packetRate;

    // SimClient fields are readonly — recreate the client with new settings
    sim.clients.delete(CLIENT_ID);
    const client = new SimClient({
      id: CLIENT_ID,
      capabilities: [],
      packetRate: newPacketRate,
      trafficSource: newTs,
      waveStartTime: sim.simTime,
      waveEndTime: sim.simTime + wave.duration,
    });
    sim.addClient(client);
  });

  // ─── Chaos buttons ─────────────────────────────────────────────────
  trafficPanel.onCrashServer(() => {
    if (controller.phase !== "simulate") {
      hudCtrl.showToast("Start traffic first");
      return;
    }
    const ok = applyChaosEvent(
      { atSeconds: 0, kind: "crash_component", targetRole: "any_server" },
      sim,
    );
    hudCtrl.showToast(ok ? "Server crashed!" : "No server to crash");
  });

  trafficPanel.onSeverConnection(() => {
    if (controller.phase !== "simulate") {
      hudCtrl.showToast("Start traffic first");
      return;
    }
    const ok = applyChaosEvent(
      { atSeconds: 0, kind: "sever_connection", targetRole: "any_connection_to_server" },
      sim,
    );
    hudCtrl.showToast(ok ? "Connection severed!" : "No connection to sever");
  });

  // ─── Export ─────────────────────────────────────────────────────────
  trafficPanel.onExport(() => {
    // Stop if running
    if (controller.phase === "simulate") stopTraffic();

    const settings = trafficPanel.settings;
    const traffic: SandboxTrafficSettings = {
      intensity: settings.intensity,
      composition: {
        writeRatio: settings.writeRatio,
        authRatio: settings.authRatio,
        streamRatio: settings.streamRatio,
        largeRatio: settings.largeRatio,
        asyncRatio: settings.asyncRatio,
      },
      keyDistribution: settings.keyKind === "zipf"
        ? { kind: "zipf", alpha: settings.zipfAlpha, spaceSize: settings.spaceSize }
        : { kind: "uniform", spaceSize: settings.spaceSize },
    };

    // Build TopologyDef from current board
    const components: Array<{ type: string; id: string; zone?: string; label?: string }> = [];
    let entryTargetId = "";
    for (const [id, type] of componentTypes) {
      const comp = sim.components.get(id);
      const entry: { type: string; id: string; zone?: string; label?: string } = {
        type,
        id: id as unknown as string,
      };
      if (comp?.zone) entry.zone = comp.zone;
      const label = componentLabels.get(id);
      if (label) entry.label = label;
      components.push(entry);
    }

    // Find entry target: the first component connected from the client
    for (const conn of sim.connections.values()) {
      if (
        conn.from.componentId === CLIENT_ID &&
        conn.direction === "forward" &&
        (conn.to.componentId as unknown as string) !== (CLIENT_ID as unknown as string)
      ) {
        entryTargetId = conn.to.componentId as unknown as string;
        break;
      }
    }

    // Forward connections only, exclude client edges
    const connections: Array<{ from: string; to: string }> = [];
    for (const conn of sim.connections.values()) {
      if (conn.direction !== "forward") continue;
      const fromStr = conn.from.componentId as unknown as string;
      const toStr = conn.to.componentId as unknown as string;
      if (fromStr === (CLIENT_ID as unknown as string)) continue;
      connections.push({ from: fromStr, to: toStr });
    }

    const topology: TopologyDef = {
      label: "Sandbox Export",
      entryTargetId,
      components,
      connections,
      autoScaleIds: [],
    };

    const json = exportTopology(topology, traffic);
    void showExportModal(json, topology, traffic);
  });

  // ─── Shared import logic (used by both Import and Reset) ─────────────
  function applyImport(result: import("./sandbox/import-export").SandboxImportResult): void {
    const topo = result.topology;

    // Compute tree-aware layout positions.
    const layout = computeTopologyLayout({
      entryId: topo.entryTargetId,
      components: topo.components,
      connections: topo.connections,
    });

    // Place components via controller so they're tracked for deletion.
    const idMap = new Map<string, ComponentId>();
    for (const c of topo.components) {
      const gridPos = layout.positions.get(c.id) ?? { x: 0, y: 0 };
      const placeResult = controller.tryPlace(c.type, gridPos);
      if (placeResult.ok) {
        idMap.set(c.id, placeResult.componentId);
        if (c.zone) {
          const comp = sim.components.get(placeResult.componentId);
          if (comp) comp.zone = (c.zone as string) ?? null;
        }
      }
    }

    // Wire connections via controller so they're tracked for deletion.
    for (const edge of topo.connections) {
      const sourceId = idMap.get(edge.from);
      const targetId = idMap.get(edge.to);
      if (sourceId && targetId) {
        controller.tryConnect(sourceId, targetId);
      }
    }

    // Wire client to entry target.
    if (topo.entryTargetId) {
      const entryId = idMap.get(topo.entryTargetId);
      if (entryId) {
        controller.tryConnect(CLIENT_ID, entryId);
      }
    }

    wireWorkers(sim);
    wireContentRouters(sim, componentTypes);
    rebuildUX();

    // Optimize wire routing to minimize overlaps.
    const wireRouting = computeWireRouting(layout.positions, topo.connections);
    for (const conn of sim.connections.values()) {
      if (conn.direction !== "forward") continue;
      const fromOrig = [...idMap.entries()].find(([, v]) => v === conn.from.componentId)?.[0];
      const toOrig = [...idMap.entries()].find(([, v]) => v === conn.to.componentId)?.[0];
      if (!fromOrig || !toOrig) continue;
      const key = `${fromOrig}:${toOrig}`;
      const yFirst = wireRouting.get(key);
      if (yFirst !== undefined) {
        // Set yFirst on the connection's render state by toggling if needed.
        // The connection layer's current yFirst might differ, so toggle to match.
        renderer.setConnectionYFirst?.(conn.id, yFirst);
      }
    }

    // Apply traffic settings to sliders.
    if (result.traffic) {
      const t = result.traffic;
      trafficPanel.applySettings({
        intensity: t.intensity,
        writeRatio: t.composition.writeRatio,
        authRatio: t.composition.authRatio,
        streamRatio: t.composition.streamRatio,
        largeRatio: t.composition.largeRatio,
        asyncRatio: t.composition.asyncRatio,
        keyKind: t.keyDistribution.kind,
        zipfAlpha: t.keyDistribution.kind === "zipf" ? t.keyDistribution.alpha : 1.0,
        spaceSize: t.keyDistribution.spaceSize,
      });
    }

    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    metricsAggregator.reset();
  }

  // ─── Import ─────────────────────────────────────────────────────────
  trafficPanel.onImport(() => {
    if (controller.phase === "simulate") stopTraffic();

    void showImportModal().then((result) => {
      if (!result) return;
      clearBoard();
      applyImport(result);
      lastImportedJson = exportTopology(result.topology, result.traffic);
      trafficPanel.enableReset(true);
      hudCtrl.showToast("Topology imported");
    });
  });

  // ─── Clear board helper ─────────────────────────────────────────────
  function clearBoard(): void {
    if (controller.phase === "simulate") stopTraffic();

    for (const id of [...componentTypes.keys()]) {
      if ((id as unknown as string) === (CLIENT_ID as unknown as string)) continue;
      controller.tryDeleteComponent(id);
    }
  }

  // ─── Confirmation dialog helper ──────────────────────────────────────
  function showConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      document.querySelector(".cp-sandbox-modal-overlay")?.remove();
      const overlay = document.createElement("div");
      overlay.className = "cp-sandbox-modal-overlay";
      const modal = document.createElement("div");
      modal.className = "cp-sandbox-modal cp-panel";
      const title = document.createElement("h2");
      title.className = "cp-sandbox-modal-title";
      title.textContent = "CONFIRM";
      modal.appendChild(title);
      const msg = document.createElement("div");
      msg.className = "cp-back-msg";
      msg.textContent = message;
      modal.appendChild(msg);
      const btnRow = document.createElement("div");
      btnRow.className = "cp-sandbox-modal-buttons";
      const yesBtn = document.createElement("button");
      yesBtn.type = "button";
      yesBtn.className = "cp-win-cta";
      yesBtn.textContent = "YES";
      yesBtn.addEventListener("click", () => { overlay.remove(); resolve(true); });
      const noBtn = document.createElement("button");
      noBtn.type = "button";
      noBtn.className = "cp-win-cta cp-win-cta--secondary";
      noBtn.textContent = "CANCEL";
      noBtn.addEventListener("click", () => { overlay.remove(); resolve(false); });
      btnRow.appendChild(yesBtn);
      btnRow.appendChild(noBtn);
      modal.appendChild(btnRow);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      noBtn.focus();
    });
  }

  // ─── Clear button ───────────────────────────────────────────────────
  trafficPanel.onClear(async () => {
    const ok = await showConfirm("Clear the entire board? This cannot be undone.");
    if (!ok) return;
    clearBoard();
    trafficPanel.enableReset(lastImportedJson !== null);
    hudCtrl.showToast("Board cleared");
  });

  // ─── Reset button — re-import the last imported JSON ─────────────────
  trafficPanel.onReset(async () => {
    if (!lastImportedJson) return;
    const ok = await showConfirm("Reset board to the last imported state? Current changes will be lost.");
    if (!ok) return;
    clearBoard();
    const parsed = importTopology(lastImportedJson);
    if (!parsed) return;
    applyImport(parsed);
    hudCtrl.showToast("Board reset to imported state");
  });

  // ─── Frame loop ─────────────────────────────────────────────────────
  let lastFrame = performance.now();
  function frame(now: number): void {
    const delta = now - lastFrame;
    lastFrame = now;
    if (driver && adapter) {
      driver.tick(delta * hudCtrl.getSimSpeed());

      for (const ev of driver.tickEvents) {
        if (ev.kind === "drop") {
          const compId = ev.componentId as ComponentId;
          let tally = perComponentDrops.get(compId);
          if (!tally) { tally = { total: 0, byReason: new Map() }; perComponentDrops.set(compId, tally); }
          tally.total += ev.count;
          tally.byReason.set(ev.reason, (tally.byReason.get(ev.reason) ?? 0) + ev.count);
        } else if (ev.kind === "terminate" || ev.kind === "respond-delivered") {
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

      if (infoPanel.isOpen()) {
        infoPanel.updateLiveStats();
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ─── Initial HUD paint ──────────────────────────────────────────────
  hud.setWavePill(1, 1);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hud.setStatus("Sandbox — place components, then START traffic");
}

// Skip auto-boot during tests
if (typeof window !== "undefined" && typeof document !== "undefined" && !("vitest" in globalThis)) {
  void main();
}
