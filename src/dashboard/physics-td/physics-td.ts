// Force cyberpunk HUD activation (depends on ?renderer=iso URL flag).
if (!new URLSearchParams(window.location.search).has("renderer")) {
  const url = new URL(window.location.href);
  url.searchParams.set("renderer", "iso");
  window.location.replace(url.toString());
}

import {
  activateCyberpunkHud,
  getCyberpunkHudController,
  type CyberpunkHudController,
} from "@dashboard/cyberpunk-hud";
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
import { CAMPAIGN_WAVES, computeBriefingForCampaignWave } from "./waves";
import { PlacementUX } from "./placement-ux";
import { ConnectUX } from "./connect-ux";
import { wireWorkers } from "./wire-workers";
import * as hud from "./hud-bridge";
import { diagnoseWave } from "./diagnose-wave";
import { ComponentDossierStore } from "./dossier-store";
import { showDossier } from "./show-dossier";
import { bindInfoPanel, type InfoPanelHandle } from "./component-info-panel";
import type { ComponentId } from "@core/types/ids";

const CLIENT_ID = "client" as ComponentId;
// Drain budget after wave duration: extra real-seconds for in-flight packets to retire.
const DRAIN_SECONDS = 4;

async function waitForHudController(): Promise<CyberpunkHudController> {
  for (let i = 0; i < 60; i += 1) {
    const ctrl = getCyberpunkHudController();
    if (ctrl) return ctrl;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  throw new Error("Cyberpunk HUD controller never initialized");
}

async function main(): Promise<void> {
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

  let sim = new Sim({ seed: 1 });

  // Per-wave positions for the sim-to-renderer adapter (tracks placed positions).
  let positions = new Map<ComponentId, { x: number; y: number }>();
  const componentTypes = new Map<ComponentId, string>();

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
  let waveStartMs = 0;
  let waveDurationMs = 0;
  let metrics = {
    responded: 0,
    terminated: 0,
    drops: 0,
    revenue: 0,
    latencySum: 0,
    latencyCount: 0,
    totalPackets: 0,
  };
  let perComponentDrops: Map<ComponentId, { total: number; byReason: Map<string, number> }> = new Map();
  let perComponentProcessed: Map<ComponentId, number> = new Map();
  const seenPacketIds = new Set<string>();

  // Delete mode toggle (fallback to right-click). When ON, normal click on a
  // component or connection deletes it instead of placing/connecting.
  let deleteMode = false;
  function setDeleteMode(enabled: boolean): void {
    deleteMode = enabled;
    deleteToggleBtn?.classList.toggle("cp-placing", enabled);
    document.body.style.cursor = enabled ? "not-allowed" : "";
    if (enabled) {
      // Exit placement so a queued ghost doesn't fight the delete handler.
      refs.placement?.exitPlacingMode();
      refs.connect?.cancel();
      hud.setStatus("DELETE MODE — click a component or connection to remove (refunds budget)");
    } else {
      hud.setStatus("Build phase — place components and click READY");
    }
  }

  // Forward declaration — assigned after controller construction (closure safe
  // because onPhaseChange is only called during gameplay, after assignment).
  let infoPanel!: InfoPanelHandle;

  const controller = new PhysicsCampaignController({
    waves: CAMPAIGN_WAVES.map((w) => ({ id: w.id, startBudget: w.startBudget })),
    componentCosts: COMPONENT_COSTS,
    callbacks: {
      onPlaced: (type, id, gridPos) => {
        positions.set(id, gridPos);
        componentTypes.set(id, type);
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
        componentTypes.delete(id);
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
          hudCtrl.updateBriefing(computeBriefingForCampaignWave(wave));
          hud.setStatus("Build phase — place components, READY when done");
          hud.hideLossModal();
          hud.setReadyDisabled(false);
          setDeleteMode(false);
          setupClientForBuild();
        } else if (phase === "simulate") {
          hud.setStatus("Wave running — tick 0/100");
          hud.setReadyDisabled(true);
          hudCtrl.hideBriefing();
        } else if (phase === "won") {
          infoPanel.hide();
          hud.setStatus("Wave WON");
          hud.setReadyDisabled(true);
          showWinModal(waveIndex);
        } else if (phase === "lost") {
          infoPanel.hide();
          hud.setReadyDisabled(true);
          // Loss modal is shown by the wave-end handler with the SLA reasons.
        } else if (phase === "campaign-complete") {
          infoPanel.hide();
          hud.setStatus("Campaign complete — well played!");
          hud.setReadyDisabled(true);
          showCampaignCompleteModal();
        }
      },
      onBudgetChange: (b) => hud.setBudget(b),
    },
  });

  const dossierStore = new ComponentDossierStore();

  infoPanel = bindInfoPanel({
    renderer: { onPointerDown: (cb) => renderer.onPointerDown((ev) => cb({ hit: ev.hit })) },
    sim,
    controller,
    dossierStore,
    hudCtrl,
    componentTypes,
    getDrops: () => perComponentDrops,
    getProcessed: () => perComponentProcessed,
  });

  // ─── Dev wave-jump selector ─────────────────────────────────────────
  const devSelect = document.getElementById("td-dev-wave-select") as HTMLSelectElement | null;
  if (devSelect) {
    // Clear any existing options without using innerHTML.
    while (devSelect.firstChild) devSelect.removeChild(devSelect.firstChild);
    // Populate options from CAMPAIGN_WAVES.
    for (let i = 0; i < CAMPAIGN_WAVES.length; i += 1) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = CAMPAIGN_WAVES[i]!.title;
      devSelect.appendChild(opt);
    }
    // Honor ?wave=N on URL (1-indexed for human friendliness).
    const urlWaveParam = new URLSearchParams(window.location.search).get("wave");
    if (urlWaveParam !== null) {
      const idx = Number.parseInt(urlWaveParam, 10);
      if (Number.isFinite(idx) && idx >= 1 && idx <= CAMPAIGN_WAVES.length) {
        const zeroIdx = idx - 1;
        devSelect.value = String(zeroIdx);
        // Defer the jump until after initial paint so the controller's first
        // onPhaseChange callback fires for wave 0 first (paint reset).
        queueMicrotask(() => {
          clearWaveWorld();
          controller.jumpToWave(zeroIdx);
        });
      }
    }
    // Wire change → jump.
    devSelect.addEventListener("change", () => {
      const idx = Number.parseInt(devSelect.value, 10);
      if (!Number.isFinite(idx)) return;
      clearWaveWorld();
      controller.jumpToWave(idx);
    });
  }

  refs.placement = new PlacementUX(sim, renderer, controller);
  refs.connect = new ConnectUX(
    sim,
    renderer,
    controller,
    () => refs.placement?.isPlacing() ?? false,
    () => deleteMode,
  );

  // ─── Wire palette buttons via HUD controller ────────────────────────
  // The controller's getPaletteButtons() returns the cyberpunk-styled cells.
  // Hook those directly so we don't need the classic .td-palette-btn forward
  // hop the HUD does by default. Cheaper, and more reliable because the
  // palette cells exist for sure (we just got the controller).
  const paletteButtons = hudCtrl.getPaletteButtons();
  for (const [type, btn] of paletteButtons) {
    // Replace the default forwarding click handler with a direct one. Easiest
    // way: clone the node so any prior listeners are dropped, then re-bind.
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(fresh);
    fresh.addEventListener("click", async (e) => {
      e.preventDefault();
      if (deleteMode) {
        // Toggling palette in delete mode exits delete mode first.
        setDeleteMode(false);
      }
      if (!dossierStore.hasSeen(type)) {
        const cost = COMPONENT_COSTS.get(type) ?? 0;
        await showDossier(type, cost);
        dossierStore.markSeen(type);
      }
      refs.placement?.enterPlacingMode(type);
    });
  }

  // ─── Add DELETE MODE toggle button to the palette strip ─────────────
  let deleteToggleBtn: HTMLButtonElement | null = null;
  const paletteCells = document.querySelector(".cp-palette-cells");
  if (paletteCells) {
    deleteToggleBtn = document.createElement("button");
    deleteToggleBtn.type = "button";
    deleteToggleBtn.className = "cp-palette-cell";
    deleteToggleBtn.dataset.type = "__delete__";
    deleteToggleBtn.style.borderColor = "#ff4d6a";
    const icon = document.createElement("div");
    icon.className = "cp-palette-icon";
    icon.textContent = "✕";
    icon.style.fontSize = "20px";
    icon.style.color = "#ff4d6a";
    icon.style.display = "flex";
    icon.style.alignItems = "center";
    icon.style.justifyContent = "center";
    icon.style.height = "100%";
    deleteToggleBtn.append(icon);
    const name = document.createElement("div");
    name.className = "cp-palette-name";
    name.textContent = "Delete";
    deleteToggleBtn.append(name);
    const cost = document.createElement("div");
    cost.className = "cp-palette-cost cp-mono";
    cost.textContent = "REFUND";
    cost.style.color = "#ff4d6a";
    deleteToggleBtn.append(cost);
    deleteToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (controller.phase !== "build") return;
      setDeleteMode(!deleteMode);
    });
    paletteCells.append(deleteToggleBtn);
  }

  // ─── Right-click to delete (component or connection) ────────────────
  // Bind contextmenu to BOTH the host and the canvas itself — Pixi's canvas
  // can intercept events depending on stacking + pointer-events. Belt and
  // suspenders: bind both, and dedupe via preventDefault.
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
    // No component under cursor — try connection.
    // hitTestConnection is not on the public interface; the renderer handles
    // connection clicks via onConnectionPointerDown. For right-click we use
    // delete mode instead — fall through silently here.
  }
  host.addEventListener("contextmenu", handleContextMenu);
  const canvas = renderer.getCanvas();
  if (canvas) canvas.addEventListener("contextmenu", handleContextMenu);

  // ─── Connection click in delete mode → delete it ────────────────────
  renderer.onConnectionPointerDown((connId) => {
    if (controller.phase !== "build") return;
    if (!deleteMode) return;
    const ok = controller.tryDeleteConnection(connId);
    if (ok) hudCtrl.showToast("Connection deleted");
  });

  // ─── Component click in delete mode → delete it ─────────────────────
  // The renderer fires onPointerDown for component clicks. We add ours
  // BEFORE PlacementUX/ConnectUX are wired so we can short-circuit when
  // delete mode is active. Easiest: subscribe and check deleteMode flag.
  renderer.onPointerDown((ev) => {
    if (!deleteMode) return;
    if (controller.phase !== "build") return;
    if (!ev.hit) return;
    if (ev.hit.componentId === CLIENT_ID) {
      hudCtrl.showToast("Cannot delete the client");
      return;
    }
    const ok = controller.tryDeleteComponent(ev.hit.componentId);
    if (ok) hudCtrl.showToast("Deleted — budget refunded");
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
      hudCtrl.showToast("Place at least one component before READY");
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
      hudCtrl.showToast("Connect the client to a component before READY");
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
    wireWorkers(sim);

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
    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    seenPacketIds.clear();

    adapter = new SimToRendererAdapter(sim, renderer, positions);
    driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    waveStartMs = performance.now();
    waveDurationMs = wave.wave.duration * 1000;
    waveDeadline = waveStartMs + waveDurationMs;
    drainDeadline = waveDeadline + DRAIN_SECONDS * 1000;

    controller.ready();
  });

  // ─── Frame loop — runs always; only ticks while driver active ───────
  let lastFrame = performance.now();
  let lastProgressUpdate = 0;
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
          const compId = ev.componentId as ComponentId;
          let tally = perComponentDrops.get(compId);
          if (!tally) { tally = { total: 0, byReason: new Map() }; perComponentDrops.set(compId, tally); }
          tally.total += ev.count;
          tally.byReason.set(ev.reason, (tally.byReason.get(ev.reason) ?? 0) + ev.count);
        } else if (ev.kind === "terminate") {
          metrics.terminated += 1;
          metrics.revenue += ev.revenue;
          metrics.latencySum += ev.latencySeconds;
          metrics.latencyCount += 1;
          const compId = ev.componentId as ComponentId;
          perComponentProcessed.set(compId, (perComponentProcessed.get(compId) ?? 0) + 1);
        } else if (ev.kind === "respond-delivered") {
          metrics.responded += 1;
          metrics.revenue += ev.revenue;
          metrics.latencySum += ev.latencySeconds;
          metrics.latencyCount += 1;
          const compId = ev.componentId as ComponentId;
          perComponentProcessed.set(compId, (perComponentProcessed.get(compId) ?? 0) + 1);
        }
      }
      adapter.syncFrame();

      // Wave progress bar: HUD observes #td-status for "tick X/Y".
      // Throttle to 4Hz to keep MutationObserver cheap.
      if (now - lastProgressUpdate > 250) {
        lastProgressUpdate = now;
        if (now < waveDeadline) {
          const elapsedMs = Math.max(0, now - waveStartMs);
          const tick = Math.floor((elapsedMs / 1000) * 60);
          const total = Math.floor((waveDurationMs / 1000) * 60);
          hud.setStatus(`Wave running — tick ${tick}/${total}`);
        } else if (now < drainDeadline) {
          hud.setStatus("Wave running — draining queue");
        }
        if (infoPanel.isOpen() && controller.phase === "simulate") {
          infoPanel.updateLiveStats();
        }
      }

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
          const wave = CAMPAIGN_WAVES[controller.currentWaveIndex]!;
          const diagnosis = diagnoseWave({
            sim,
            wave: {
              writeRatio: wave.wave.composition.writeRatio,
              hasReads: 1 - wave.wave.composition.writeRatio - wave.wave.composition.authRatio - wave.wave.composition.streamRatio > 0,
              hasStreams: wave.wave.composition.streamRatio > 0,
            },
            perComponentDrops,
            totalDrops: metrics.drops,
            totalProcessed: metrics.responded + metrics.terminated,
          });
          const detail = diagnosis.hint
            ? `${diagnosis.symptom} ${diagnosis.hint}`
            : diagnosis.symptom;
          hud.showLossModal(diagnosis.headline, detail);
        }
        controller.onWaveEnd(sla.passed);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ─── Win / Campaign-complete modals ─────────────────────────────────
  function showWinModal(waveIndex: number): void {
    // Tear down any prior overlay so we don't stack.
    document.querySelector(".cp-win-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "cp-win-overlay";

    const modal = document.createElement("div");
    modal.className = "cp-win-modal cp-panel";

    const title = document.createElement("h2");
    title.className = "cp-win-title";
    title.textContent = `WAVE ${waveIndex + 1} CLEARED`;
    modal.appendChild(title);

    const stats = document.createElement("div");
    stats.className = "cp-win-stats";
    const earnedRow = document.createElement("div");
    earnedRow.className = "cp-win-stat";
    earnedRow.textContent = `Earned  $${Math.round(metrics.revenue)}`;
    const budgetRow = document.createElement("div");
    budgetRow.className = "cp-win-stat";
    budgetRow.textContent = `Budget  $${controller.budget}`;
    stats.appendChild(earnedRow);
    stats.appendChild(budgetRow);
    modal.appendChild(stats);

    // Preview of next wave if there is one.
    const nextIndex = waveIndex + 1;
    const nextWave = CAMPAIGN_WAVES[nextIndex] ?? null;
    if (nextWave) {
      const divider = document.createElement("div");
      divider.className = "cp-win-divider";
      modal.appendChild(divider);

      const nextHeader = document.createElement("div");
      nextHeader.className = "cp-win-next-header";
      nextHeader.textContent = "INCOMING";
      modal.appendChild(nextHeader);

      const preview = computeBriefingForCampaignWave(nextWave);
      const nextTitle = document.createElement("div");
      nextTitle.className = "cp-win-next-title";
      nextTitle.textContent = preview.title;
      modal.appendChild(nextTitle);

      if (preview.narrative) {
        const narr = document.createElement("div");
        narr.className = "cp-win-narrative";
        narr.textContent = preview.narrative;
        modal.appendChild(narr);
      }

      const rows = document.createElement("div");
      rows.className = "cp-win-preview-rows";
      rows.appendChild(winPreviewRow(
        "Load",
        "●".repeat(preview.load.dots) + "○".repeat(5 - preview.load.dots) + "  " + preview.load.label,
      ));
      rows.appendChild(winPreviewRow("Traffic", preview.traffic));
      rows.appendChild(winPreviewRow("Objective", preview.objective));
      rows.appendChild(winPreviewRow("Reward", preview.reward));
      modal.appendChild(rows);
    }

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "cp-win-cta";
    cta.textContent = nextWave ? "NEXT WAVE →" : "FINISH";
    modal.appendChild(cta);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    cta.addEventListener("click", () => {
      overlay.remove();
      // Topology + budget carry into next wave (no clearWaveWorld here).
      // Detach the SimClient so the next wave's TrafficSource starts fresh.
      sim.clients.delete(CLIENT_ID);
      sim.activePackets.length = 0;
      controller.nextWave();
    });
    cta.focus();
  }

  function showCampaignCompleteModal(): void {
    document.querySelector(".cp-win-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "cp-win-overlay";
    const modal = document.createElement("div");
    modal.className = "cp-win-modal cp-panel";

    const title = document.createElement("h2");
    title.className = "cp-win-title";
    title.textContent = "CAMPAIGN COMPLETE";
    modal.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "cp-win-narrative";
    sub.textContent = `${CAMPAIGN_WAVES.length} waves cleared. The grid is yours.`;
    modal.appendChild(sub);

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

  function winPreviewRow(label: string, value: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "cp-win-preview-row";
    const k = document.createElement("span");
    k.className = "cp-win-preview-key";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "cp-win-preview-val";
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    return row;
  }

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
    componentTypes.clear();
    perComponentProcessed = new Map();
    // Fresh sim instance to wipe internal merge maps + revenue ledger.
    sim = new Sim({ seed: 1 });
    // PlacementUX/ConnectUX hold a Sim reference — rebuild them so they
    // operate on the new instance.
    refs.placement = new PlacementUX(sim, renderer, controller);
    refs.connect = new ConnectUX(
      sim,
      renderer,
      controller,
      () => refs.placement?.isPlacing() ?? false,
      () => deleteMode,
    );
    // Repaint the client visual for the next build phase.
    setupClientForBuild();
  }

  // ─── Initial paint ──────────────────────────────────────────────────
  hud.setWavePill(1, CAMPAIGN_WAVES.length);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hudCtrl.updateBriefing(computeBriefingForCampaignWave(CAMPAIGN_WAVES[0]!));
  hud.setStatus("Build phase — place components and click READY");
}

void main();
