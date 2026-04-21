import {
  activateCyberpunkHud,
  getCyberpunkHudController,
  type CyberpunkHudController,
} from "../cyberpunk-hud";
import { CyberpunkTopologyRenderer } from "../render/cyberpunk-topology-renderer";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { BrowserDriver } from "../sim-demo/browser-driver";
import { SimToRendererAdapter } from "../sim-demo/sim-to-renderer";
import { PhysicsCampaignController, type Phase } from "./campaign-controller";
import { COMPONENT_COSTS, buildSimComponent } from "./component-factory";
import { CAMPAIGN_WAVES, computeBriefingForCampaignWave, type CampaignWave } from "./waves";
import { BITLY_WAVES } from "./bitly-waves";
import { PlacementUX } from "./placement-ux";
import { ConnectUX } from "./connect-ux";
import { wireWorkers } from "./wire-workers";
import * as hud from "./hud-bridge";
import { Viability, DAMAGE_PER_FAILURE } from "./viability";
import { validateTopology } from "./validate-topology";
import { formatTopologyError, COMPONENT_TYPE_LABEL } from "./topology-error-messages";
import { computeSlaPenalty } from "./wave-penalty";
import { ComponentDossierStore } from "./dossier-store";
import { showDossier } from "./show-dossier";
import { bindInfoPanel, type InfoPanelHandle } from "./component-info-panel";
import { ComponentMetricsAggregator } from "./component-metrics";
import type { ComponentId } from "@core/types/ids";
import { injectNavBar, isAuthConfigured } from "../auth/index";
import { resolveInitialSession } from "../auth-gate";
import { mountChatbotDrawer } from "../chatbot/chatbot-drawer";
import { serializeContextForChat } from "../chatbot/serialize-context";
import type { ChatRequest } from "../chatbot/chat-client";

const CLIENT_ID = "client" as ComponentId;
// Drain budget after wave duration: extra real-seconds for in-flight packets to retire.
const DRAIN_SECONDS = 4;

export type StackAttackLevelId = "url-shortener" | "netflix";

const KNOWN_LEVEL_IDS: ReadonlySet<string> = new Set(["url-shortener", "netflix"]);

/**
 * Parse ?level=… out of a URL query string. Exported for testability.
 *
 * Both known values route to their own campaign waves array — the
 * teammate owning game balance will branch on this id when the URL Shortener
 * and Netflix campaigns diverge. Unknown values fall through to `null`.
 */
export function readLevelIdFromUrl(search: string): StackAttackLevelId | null {
  const raw = new URLSearchParams(search).get("level");
  if (raw === null) return null;
  const normalized = raw.toLowerCase();
  return KNOWN_LEVEL_IDS.has(normalized) ? (normalized as StackAttackLevelId) : null;
}

async function waitForHudController(): Promise<CyberpunkHudController> {
  for (let i = 0; i < 60; i += 1) {
    const ctrl = getCyberpunkHudController();
    if (ctrl) return ctrl;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  throw new Error("Cyberpunk HUD controller never initialized");
}

async function main(waves: ReadonlyArray<CampaignWave> = CAMPAIGN_WAVES): Promise<void> {
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
  const componentLabels = new Map<ComponentId, string | undefined>();

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
    totalRequests: 0,
  };
  let perComponentDrops: Map<ComponentId, { total: number; byReason: Map<string, number> }> = new Map();
  let perComponentProcessed: Map<ComponentId, number> = new Map();
  const seenPacketIds = new Set<string>();
  const metricsAggregator = new ComponentMetricsAggregator();

  // Campaign-wide viability pool. Drains per failed request; at 0 the
  // player restarts from wave 1 (page reload).
  const viability = new Viability();
  let dead = false;
  let lastWavePenalty = 0;
  let lastWaveAvailability = 1;
  let lastWaveAvgLatency = 0;
  let lastWaveAvailShortfall = 0;
  let lastWaveLatencyOvershoot = 0;
  let lastWaveProcessedByComponent: ReadonlyMap<ComponentId, number> = new Map();

  // Forward declaration — assigned after controller construction (closure safe
  // because onPhaseChange is only called during gameplay, after assignment).
  let infoPanel!: InfoPanelHandle;

  /**
   * Re-run the pre-sim topology validator and publish human-readable
   * messages into the HUD's mirror div. Called after every topology change
   * in build phase so the player sees live feedback instead of waiting for
   * READY. Cheap (BFS over a tiny graph); no throttling required.
   *
   * Reads `sim` from closure so it picks up the post-clearWaveWorld
   * replacement instance.
   */
  function revalidateTopology(): void {
    if (controller.phase !== "build") {
      hud.setTopologyErrors([]);
      return;
    }
    const wave = waves[controller.currentWaveIndex];
    if (!wave) {
      hud.setTopologyErrors([]);
      return;
    }
    // Empty canvas (only the client) — nothing to validate, show nothing.
    if (sim.components.size === 0) {
      hud.setTopologyErrors([]);
      return;
    }
    const errors = validateTopology(sim, wave.wave, CLIENT_ID, componentTypes);
    controller.lastTopologyErrors = errors;
    hud.setTopologyErrors(errors.map(formatTopologyError));
  }

  const controller = new PhysicsCampaignController({
    waves: waves.map((w) => ({ id: w.id, startBudget: w.startBudget, revenue: w.wave.revenue })),
    componentCosts: COMPONENT_COSTS,
    callbacks: {
      onPlaced: (type, id, gridPos) => {
        positions.set(id, gridPos);
        componentTypes.set(id, type);
        // Auto-generate a human-friendly label ("Server 1", "Data Cache 2")
        // based on the 1-based index among already-placed components of
        // this type (the just-placed id was already recorded above).
        let index = 0;
        for (const t of componentTypes.values()) {
          if (t === type) index += 1;
        }
        const typeDisplay = COMPONENT_TYPE_LABEL.get(type) ?? type;
        const autoLabel = `${typeDisplay} ${index}`;
        componentLabels.set(id, autoLabel);
        refs.placement?.applyPlacement(type, id, gridPos, autoLabel);
        revalidateTopology();
      },
      onConnected: (sourceId, targetId, forwardId, backId) => {
        refs.connect?.applyConnection(sourceId, targetId, forwardId, backId);
        revalidateTopology();
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
        componentLabels.delete(id);
        renderer.removeComponent(id);
        revalidateTopology();
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
        revalidateTopology();
      },
      onPhaseChange: (phase, waveIndex) => {
        const wave = waves[waveIndex];
        hud.setPhase(phase);
        hud.setWavePill(waveIndex + 1, waves.length);
        renderer.setClientTyping?.(phase === "simulate");
        if (phase === "build" && wave) {
          hudCtrl.updateBriefing(computeBriefingForCampaignWave(wave));
          hud.setStatus("Build phase — place components, READY when done");
          hud.setReadyDisabled(false);
          setupClientForBuild();
          hudCtrl.setZones(wave.wave.zoneDistribution ? [...wave.wave.zoneDistribution.keys()] : []);
          revalidateTopology();
        } else if (phase === "simulate") {
          hud.setStatus("Wave running — tick 0/100");
          hud.setReadyDisabled(true);
          hudCtrl.hideBriefing();
          hud.setTopologyErrors([]);
        } else if (phase === "won") {
          infoPanel.hide();
          hud.setStatus("Wave WON");
          hud.setReadyDisabled(true);
          showWinModal(waveIndex);
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
    getSim: () => sim,
    controller,
    dossierStore,
    hudCtrl,
    componentTypes,
    getDrops: () => perComponentDrops,
    getProcessed: () => perComponentProcessed,
    getMetrics: (id) => metricsAggregator.getMetricsFor(id),
  });

  // ─── Zone reassignment: click zone button while component selected ──
  hudCtrl.onZoneClick((zone) => {
    if (controller.phase !== "build") return;
    const selectedId = infoPanel.openId();
    if (!selectedId) return;
    const comp = sim.components.get(selectedId);
    if (!comp) return;
    comp.zone = zone ?? null;
    // Update the renderer label badge with zone tag
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

  // ─── Dev +$100 button (testing aid; remove before ship) ────────────
  const devGrantBtn = document.getElementById("td-dev-grant-btn");
  if (devGrantBtn) {
    devGrantBtn.addEventListener("click", () => {
      controller.devGrant(100);
    });
  }

  // ─── Dev wave-jump selector ─────────────────────────────────────────
  const devSelect = document.getElementById("td-dev-wave-select") as HTMLSelectElement | null;
  if (devSelect) {
    // Clear any existing options without using innerHTML.
    while (devSelect.firstChild) devSelect.removeChild(devSelect.firstChild);
    // Populate options from waves.
    for (let i = 0; i < waves.length; i += 1) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = waves[i]!.title;
      devSelect.appendChild(opt);
    }
    // Honor ?wave=N on URL (1-indexed for human friendliness).
    const urlWaveParam = new URLSearchParams(window.location.search).get("wave");
    if (urlWaveParam !== null) {
      const idx = Number.parseInt(urlWaveParam, 10);
      if (Number.isFinite(idx) && idx >= 1 && idx <= waves.length) {
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
  refs.placement.setZoneResolver(() => hudCtrl.getSelectedZone());
  refs.placement.setOnPlacingChange((type) => {
    for (const [t, btn] of livePaletteButtons) {
      btn.classList.toggle("cp-placing", t === type);
    }
  });
  refs.connect = new ConnectUX(
    sim,
    renderer,
    controller,
    () => refs.placement?.isPlacing() ?? false,
  );

  // ─── Wire palette buttons via HUD controller ────────────────────────
  // The controller's getPaletteButtons() returns the cyberpunk-styled cells.
  // Hook those directly so we don't need the classic .td-palette-btn forward
  // hop the HUD does by default. Cheaper, and more reliable because the
  // palette cells exist for sure (we just got the controller).
  const paletteButtons = hudCtrl.getPaletteButtons();
  const livePaletteButtons = new Map<string, HTMLButtonElement>();
  for (const [type, btn] of paletteButtons) {
    // Replace the default forwarding click handler with a direct one. Easiest
    // way: clone the node so any prior listeners are dropped, then re-bind.
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(fresh);
    livePaletteButtons.set(type, fresh);
    fresh.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!dossierStore.hasSeen(type)) {
        const cost = COMPONENT_COSTS.get(type) ?? 0;
        await showDossier(type, cost);
        dossierStore.markSeen(type);
      }
      refs.placement?.enterPlacingMode(type);
    });
  }

  // ─── Left-click on connection to toggle L-routing ───────────────────
  renderer.onConnectionPointerDown((connId) => {
    if (controller.phase !== "build") return;
    renderer.toggleConnectionRoute(connId);
  });

  // ─── Right-click to delete (component or connection) ────────────────
  // Bind contextmenu to BOTH the host and the canvas itself — Pixi's canvas
  // can intercept events depending on stacking; binding both + preventDefault
  // keeps the browser menu away and guarantees delivery.
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
      // Controller tracks forward ids only; resolve a back-lane hit to its
      // forward twin via sim's twinId mapping.
      const conn = sim.connections.get(connId);
      const canonicalId =
        conn?.direction === "back" ? (conn.twinId ?? connId) : connId;
      const ok = controller.tryDeleteConnection(canonicalId);
      if (ok) hudCtrl.showToast("Connection deleted");
    }
  }
  host.addEventListener("contextmenu", handleContextMenu);
  const canvas = renderer.getCanvas();
  if (canvas) canvas.addEventListener("contextmenu", handleContextMenu);

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
    const wave = waves[controller.currentWaveIndex];
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
      waveStartTime: sim.simTime,
      waveEndTime: sim.simTime + wave.wave.duration,
      ...(wave.wave.rampSeconds !== undefined && { rampSeconds: wave.wave.rampSeconds }),
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
      totalRequests: 0,
    };
    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    seenPacketIds.clear();
    metricsAggregator.reset();

    // Pre-sim topology validation — non-blocking. Stores errors on the
    // controller so a future HUD warning UI can surface them.
    // TODO: surface these as a pre-wave HUD warning panel.
    controller.lastTopologyErrors = validateTopology(sim, wave.wave, CLIENT_ID, componentTypes);

    // ── Dev diagnostics ──
    console.log("[wave-start]", {
      waveIndex: controller.currentWaveIndex,
      intensity: wave.wave.intensity,
      packetRate: wave.wave.packetRate,
      perPacketCount: Math.round(wave.wave.intensity / wave.wave.packetRate),
      rampSeconds: wave.wave.rampSeconds ?? 0,
      components: [...sim.components.values()].map((c) => ({
        id: c.id, type: componentTypes.get(c.id), zone: c.zone ?? null,
        capacity: c.bucket?.capacity() ?? "unlimited",
      })),
      connections: [...sim.connections.values()]
        .filter((c) => c.direction === "forward")
        .map((c) => `${c.from.componentId} → ${c.to.componentId} (lat=${c.latencySeconds}s)`),
    });

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
      // Count requests in fresh top-level packets (parentId === null) as denominator.
      for (const p of sim.activePackets) {
        const id = p.id as unknown as string;
        if (p.parentId === null && !seenPacketIds.has(id)) {
          seenPacketIds.add(id);
          metrics.totalRequests += p.requests.length;
        }
      }
      let failuresThisFrame = 0;
      for (const ev of driver.tickEvents) {
        if (ev.kind === "drop") {
          metrics.drops += ev.count;
          failuresThisFrame += ev.count;
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

      // Per-component live metrics aggregator + sprite stress indicator.
      metricsAggregator.update(sim, driver.tickEvents, sim.simTime);
      for (const id of sim.components.keys()) {
        if ((id as unknown as string) === (CLIENT_ID as unknown as string)) continue;
        const m = metricsAggregator.getMetricsFor(id);
        renderer.updateComponent(id, { stress: { stressed: m.stressed, dropping: m.dropping } });
      }

      if (failuresThisFrame > 0) {
        viability.damage(failuresThisFrame * DAMAGE_PER_FAILURE);
        hudCtrl.updateViability({ value: viability.value, fraction: viability.fraction });
        if (viability.isDead && !dead) {
          dead = true;
          driver = null;
          adapter = null;
          showDeathModal();
          // Don't return — let requestAnimationFrame(frame) at the bottom
          // keep the loop alive so retry can resume ticking.
        }
      }

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
        const wave = waves[controller.currentWaveIndex]!;
        const avgLatency =
          metrics.latencyCount > 0 ? metrics.latencySum / metrics.latencyCount : 0;
        driver = null;
        adapter = null;
        const penalty = computeSlaPenalty(
          {
            totalRequests: metrics.totalRequests,
            responded: metrics.responded,
            terminated: metrics.terminated,
            drops: metrics.drops,
            avgLatencySeconds: avgLatency,
            totalRevenue: metrics.revenue,
          },
          wave.sla,
        );
        lastWavePenalty = penalty.dollars;
        lastWaveAvailability = penalty.actualAvailability;
        lastWaveAvgLatency = avgLatency;
        lastWaveAvailShortfall = penalty.availabilityShortfallPct;
        lastWaveLatencyOvershoot = penalty.latencyOvershootPct;
        lastWaveProcessedByComponent = new Map(perComponentProcessed);
        if (penalty.dollars > 0) {
          controller.applyPenalty(penalty.dollars);
        }
        controller.onWaveEnd();
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
    stats.appendChild(earnedRow);
    const slaRow = document.createElement("div");
    slaRow.className = "cp-win-stat";
    slaRow.textContent = `Avail   ${(lastWaveAvailability * 100).toFixed(1)}%`;
    stats.appendChild(slaRow);
    const latRow = document.createElement("div");
    latRow.className = "cp-win-stat";
    latRow.textContent = `Latency ${lastWaveAvgLatency.toFixed(2)}s`;
    stats.appendChild(latRow);
    if (lastWavePenalty > 0) {
      const penaltyRow = document.createElement("div");
      penaltyRow.className = "cp-win-stat";
      const causes: string[] = [];
      if (lastWaveAvailShortfall > 0) causes.push(`avail −${lastWaveAvailShortfall.toFixed(1)}pt`);
      if (lastWaveLatencyOvershoot > 0) causes.push(`lat +${lastWaveLatencyOvershoot.toFixed(0)}%`);
      const cause = causes.length > 0 ? ` (${causes.join(", ")})` : "";
      penaltyRow.textContent = `Penalty −$${lastWavePenalty}${cause}`;
      stats.appendChild(penaltyRow);
    }
    const budgetRow = document.createElement("div");
    budgetRow.className = "cp-win-stat";
    budgetRow.textContent = `Budget  $${controller.budget}`;
    stats.appendChild(budgetRow);
    modal.appendChild(stats);

    // Per-component "served requests" breakdown (shows whether cache/CDN actually absorbed traffic).
    if (lastWaveProcessedByComponent.size > 0) {
      const servedHeader = document.createElement("div");
      servedHeader.className = "cp-win-next-header";
      servedHeader.textContent = "SERVED BY";
      modal.appendChild(servedHeader);
      const servedList = document.createElement("div");
      servedList.className = "cp-win-preview-rows";
      for (const [compId, count] of lastWaveProcessedByComponent) {
        const type = componentTypes.get(compId) ?? (compId as unknown as string);
        servedList.appendChild(winPreviewRow(type, String(count)));
      }
      modal.appendChild(servedList);
    }

    // Preview of next wave if there is one.
    const nextIndex = waveIndex + 1;
    const nextWave = waves[nextIndex] ?? null;
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

    // Persist completion so the level select page can show it.
    const levelId =
      (window as unknown as { __stackAttackLevelId?: StackAttackLevelId | null })
        .__stackAttackLevelId ?? null;
    if (levelId) {
      const key = `stackattack:completed:${levelId}`;
      const avgLatency = metrics.latencyCount > 0 ? metrics.latencySum / metrics.latencyCount : 0;
      const delivered = metrics.responded + metrics.terminated;
      const availability = metrics.totalRequests > 0 ? delivered / metrics.totalRequests : 1;
      localStorage.setItem(key, JSON.stringify({
        completedAt: new Date().toISOString(),
        waves: waves.length,
        finalAvailability: availability,
        viabilityRemaining: viability.value,
      }));
    }

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
    sub.textContent = `${waves.length} waves cleared. The grid is yours.`;
    modal.appendChild(sub);

    const stats = document.createElement("div");
    stats.className = "cp-win-preview";
    stats.appendChild(winPreviewRow("Viability", `${viability.value}%`));
    stats.appendChild(winPreviewRow("Revenue", `$${metrics.revenue}`));
    modal.appendChild(stats);

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "cp-win-cta";
    cta.textContent = "BACK TO LEVELS";
    modal.appendChild(cta);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    cta.addEventListener("click", () => {
      window.location.href = "./levels.html";
    });
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

  function retryCurrentWave(): void {
    document.querySelector(".cp-win-overlay")?.remove();
    // Reset viability so the retry starts fresh.
    viability.reset();
    dead = false;
    hudCtrl.updateViability({ value: viability.value, fraction: viability.fraction });
    // Reset metrics but keep topology + budget.
    metrics = { responded: 0, terminated: 0, drops: 0, revenue: 0, latencySum: 0, latencyCount: 0, totalRequests: 0 };
    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    metricsAggregator.reset();
    seenPacketIds.clear();
    // Kill any active driver/adapter so the render loop stops.
    driver = null;
    adapter = null;

    // Clear all transient visuals: packets, snakes, flash FX.
    renderer.resetTransientVisuals();

    // Clear visual artefacts on components: stress rings, util bars, pending counts.
    for (const id of sim.components.keys()) {
      renderer.updateComponent(id, {
        utilization: 0,
        pendingCount: 0,
        stress: { stressed: false, dropping: false },
      });
    }

    // Create a fresh sim with rebuilt components. Old SimComponent objects
    // carry stale state (depleted buckets, filled queues, autoscale tiers)
    // that would prevent traffic from flowing on retry.
    const retryConnections = [...sim.connections.values()];
    const retryWave = waves[controller.currentWaveIndex];
    const retryRevenue = retryWave?.wave.revenue ?? { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 1 };
    // Snapshot zone info from old components before discarding them.
    const oldZones = new Map<ComponentId, string | null>();
    for (const [id, comp] of sim.components) oldZones.set(id, comp.zone);
    sim = new Sim({ seed: 1 });
    for (const [id, type] of componentTypes) {
      const zone = oldZones.get(id) ?? undefined;
      const label = componentLabels.get(id);
      const freshComp = buildSimComponent(type, id, retryRevenue, zone ?? undefined, label);
      if (freshComp) sim.addComponent(freshComp);
    }
    for (const c of retryConnections) sim.addConnection(c);
    wireWorkers(sim);

    // Rebuild PlacementUX/ConnectUX so they reference the new sim.
    refs.placement = new PlacementUX(sim, renderer, controller);
    refs.placement.setZoneResolver(() => hudCtrl.getSelectedZone());
    refs.placement.setOnPlacingChange((type) => {
      for (const [t, btn] of livePaletteButtons) {
        btn.classList.toggle("cp-placing", t === type);
      }
    });
    refs.connect = new ConnectUX(
      sim,
      renderer,
      controller,
      () => refs.placement?.isPlacing() ?? false,
    );

    // Re-enter build phase for the same wave.
    controller.phase = "build" as Phase;
    hud.setPhase("build");
    hud.setReadyDisabled(false);
    hud.setTopologyErrors([]);
    infoPanel.hide();
    const wave = waves[controller.currentWaveIndex];
    if (wave) {
      hudCtrl.updateBriefing(computeBriefingForCampaignWave(wave));
      hudCtrl.setZones(wave.wave.zoneDistribution ? [...wave.wave.zoneDistribution.keys()] : []);
    }
    hud.setStatus("Build phase — retry wave, adjust topology and click READY");
    revalidateTopology();
  }

  function showDeathModal(): void {
    document.querySelector(".cp-win-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "cp-win-overlay";
    const modal = document.createElement("div");
    modal.className = "cp-win-modal cp-panel";

    const title = document.createElement("h2");
    title.className = "cp-win-title";
    title.textContent = "SYSTEM COLLAPSE";
    modal.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "cp-win-narrative";
    sub.textContent =
      "Too many failed requests. The grid is offline.";
    modal.appendChild(sub);

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "cp-win-cta";
    retryBtn.textContent = "RETRY WAVE";
    modal.appendChild(retryBtn);

    const restartBtn = document.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "cp-win-cta cp-win-cta--secondary";
    restartBtn.textContent = "RESTART CAMPAIGN";
    modal.appendChild(restartBtn);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    retryBtn.addEventListener("click", () => retryCurrentWave());
    restartBtn.addEventListener("click", () => window.location.reload());
    retryBtn.focus();
  }

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
    componentLabels.clear();
    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    metricsAggregator.reset();
    // Fresh sim instance to wipe internal merge maps + revenue ledger.
    sim = new Sim({ seed: 1 });
    // PlacementUX/ConnectUX hold a Sim reference — rebuild them so they
    // operate on the new instance.
    refs.placement = new PlacementUX(sim, renderer, controller);
    refs.placement.setZoneResolver(() => hudCtrl.getSelectedZone());
    refs.placement.setOnPlacingChange((type) => {
      for (const [t, btn] of hudCtrl.getPaletteButtons()) {
        btn.classList.toggle("cp-placing", t === type);
      }
    });
    refs.connect = new ConnectUX(
      sim,
      renderer,
      controller,
      () => refs.placement?.isPlacing() ?? false,
    );
    // Repaint the client visual for the next build phase.
    setupClientForBuild();
  }

  // ─── Chatbot tutor drawer ───────────────────────────────────────────
  const levelId =
    (window as unknown as { __stackAttackLevelId?: StackAttackLevelId | null })
      .__stackAttackLevelId ?? undefined;
  mountChatbotDrawer({
    host: document.body,
    ...(!isAuthConfigured && { endpoint: "/api/chat", skipAuth: true }),
    getContext: (): ChatRequest | null => {
      const waveEntry = waves[controller.currentWaveIndex];
      if (!waveEntry) return null;
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
        wave: waveEntry.wave,
        waveId: waveEntry.id,
        waveTitle: waveEntry.title,
        sla: waveEntry.sla,
        metricsAggregator: controller.phase === "simulate" ? metricsAggregator : null,
        componentTypes,
        componentLabels,
        mode: "build",
        hintLevel: "coach",
        levelId: levelId ?? undefined,
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
    onHighlight: () => {
      // TODO: wire component flash when renderer exposes a highlight API.
    },
  });

  // ─── Initial paint ──────────────────────────────────────────────────
  hud.setWavePill(1, waves.length);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hudCtrl.updateBriefing(computeBriefingForCampaignWave(waves[0]!));
  hudCtrl.updateViability({ value: viability.value, fraction: viability.fraction });
  hudCtrl.setZones(waves[0]!.wave.zoneDistribution ? [...waves[0]!.wave.zoneDistribution.keys()] : []);
  hud.setStatus("Build phase — place components and click READY");
}

async function boot(): Promise<void> {
  // Auth happens on the landing page. If someone reaches /game.html without a
  // session (deep-link, expired token), bounce them home so they can sign in.
  // In local dev without Supabase env configured, skip the gate so contributors
  // can play without setting up Supabase. Production is unaffected.
  const user = await resolveInitialSession(8000);
  if (!user && isAuthConfigured) {
    window.location.href = "./index.html";
    return;
  }

  // Capture ?level= so the teammate can branch on it when the URL Shortener
  // and Netflix campaigns diverge. Currently a read-only observable marker;
  // netflix → CAMPAIGN_WAVES, url-shortener → BITLY_WAVES.
  const levelId = readLevelIdFromUrl(window.location.search);
  (window as unknown as { __stackAttackLevelId: StackAttackLevelId | null }).__stackAttackLevelId = levelId;

  if (user) injectNavBar();
  const waves = levelId === "url-shortener" ? BITLY_WAVES : CAMPAIGN_WAVES;
  await main(waves);
}

void boot();
