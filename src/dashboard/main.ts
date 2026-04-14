import { TOPOLOGIES, type TopologyInfo } from "./topologies";
import { SimLoop } from "./sim-loop";
import { exportScenario, applyScenario, serializeScenario, parseScenario } from "@modes/sandbox/sandbox-scenario";
import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { TickMetrics } from "@core/types/metrics";
import type { SandboxModeController, MetricsSnapshot } from "@modes/sandbox/sandbox-mode-controller";

// TD mode imports
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { createTDDashboard, type TDDashboard } from "./td-mode";
import type { OutcomeReport } from "@core/types/outcome";

declare const Chart: any;

// ─── State ────────────────────────────────────────────────────────────
let topo: TopologyInfo;
let simLoop: SimLoop<SandboxModeController>;

const PRESETS = [
  "steady-load", "black-friday", "gradual-ramp",
  "flash-crowd", "async-heavy", "media-launch",
] as const;

const MAX_CHART_POINTS = 100;
const throughputData = { resolved: [] as number[], dropped: [] as number[], labels: [] as number[] };
const latencyData = { values: [] as number[], labels: [] as number[] };

// ─── DOM refs ─────────────────────────────────────────────────────────
const $topoSelect = document.getElementById("topology-select") as HTMLSelectElement;
const $trafficSelect = document.getElementById("traffic-select") as HTMLSelectElement;
const $btnPlay = document.getElementById("btn-play") as HTMLButtonElement;
const $btnStep = document.getElementById("btn-step") as HTMLButtonElement;
const $btnReset = document.getElementById("btn-reset") as HTMLButtonElement;
const $speedSlider = document.getElementById("speed-slider") as HTMLInputElement;
const $tickCounter = document.getElementById("tick-counter") as HTMLSpanElement;
const $topoVisual = document.getElementById("topology-visual") as HTMLDivElement;

const $statResolved = document.getElementById("stat-resolved")!;
const $statDropped = document.getElementById("stat-dropped")!;
const $statTimedout = document.getElementById("stat-timedout")!;
const $statBackpressured = document.getElementById("stat-backpressured")!;
const $statReliability = document.getElementById("stat-reliability")!;
const $statLatency = document.getElementById("stat-latency")!;
const $statRevenue = document.getElementById("stat-revenue")!;
const $statUpkeep = document.getElementById("stat-upkeep")!;
const $healthBars = document.getElementById("health-bars")!;

const $chaosTarget = document.getElementById("chaos-target") as HTMLSelectElement;
const $btnChaosKill = document.getElementById("btn-chaos-kill")!;
const $btnChaosLatency = document.getElementById("btn-chaos-latency")!;
const $btnChaosZone = document.getElementById("btn-chaos-zone")!;
const $btnChaosSever = document.getElementById("btn-chaos-sever")!;

const $btnSave = document.getElementById("btn-save")!;
const $btnLoad = document.getElementById("btn-load")!;
const $fileInput = document.getElementById("file-input") as HTMLInputElement;

// ─── Charts ───────────────────────────────────────────────────────────
const throughputChart = new Chart(
  document.getElementById("chart-throughput") as HTMLCanvasElement,
  {
    type: "line",
    data: {
      labels: throughputData.labels,
      datasets: [
        { label: "Resolved", data: throughputData.resolved, borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.1)", fill: true, tension: 0.3, pointRadius: 0 },
        { label: "Dropped", data: throughputData.dropped, borderColor: "#ef4444", backgroundColor: "rgba(239,68,68,0.1)", fill: true, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 0 },
      scales: { x: { display: false }, y: { beginAtZero: true, ticks: { color: "#8b8fa3" }, grid: { color: "#2e3344" } } },
      plugins: { legend: { labels: { color: "#e1e4ed", boxWidth: 12 } } },
    },
  },
);

const latencyChart = new Chart(
  document.getElementById("chart-latency") as HTMLCanvasElement,
  {
    type: "line",
    data: {
      labels: latencyData.labels,
      datasets: [
        { label: "Avg Latency", data: latencyData.values, borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,0.1)", fill: true, tension: 0.3, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 0 },
      scales: { x: { display: false }, y: { beginAtZero: true, ticks: { color: "#8b8fa3" }, grid: { color: "#2e3344" } } },
      plugins: { legend: { labels: { color: "#e1e4ed", boxWidth: 12 } } },
    },
  },
);

// ─── Initialization ───────────────────────────────────────────────────
function populateSelects(): void {
  for (const name of Object.keys(TOPOLOGIES)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    $topoSelect.appendChild(opt);
  }
  for (const name of PRESETS) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    $trafficSelect.appendChild(opt);
  }
}

function renderTopologyVisual(): void {
  const nodes = topo.components.map(c => `<span class="node">${c.name}</span>`);
  $topoVisual.innerHTML = nodes.join('<span class="arrow"> → </span>');
}

function populateChaosTargets(): void {
  $chaosTarget.innerHTML = "";
  for (const comp of topo.components) {
    const opt = document.createElement("option");
    opt.value = comp.id;
    opt.textContent = comp.name;
    $chaosTarget.appendChild(opt);
  }
  for (const conn of topo.connections) {
    const opt = document.createElement("option");
    opt.value = conn.id;
    opt.textContent = `${conn.from} → ${conn.to}`;
    $chaosTarget.appendChild(opt);
  }
}

function resetCharts(): void {
  throughputData.resolved.length = 0;
  throughputData.dropped.length = 0;
  throughputData.labels.length = 0;
  latencyData.values.length = 0;
  latencyData.labels.length = 0;
  throughputChart.update();
  latencyChart.update();
}

function initTopology(): void {
  // Stop any running sim loop before creating a new one
  if (simLoop) simLoop.stop();

  const factory = TOPOLOGIES[$topoSelect.value];
  if (!factory) return;

  topo = factory();

  // Apply traffic
  topo.controller.addTrafficSourceFromPreset(
    $trafficSelect.value as any,
    topo.entryPointId,
  );
  topo.controller.advancePhase(); // build → simulate

  simLoop = new SimLoop<SandboxModeController>({
    engine: topo.engine,
    state: topo.state,
    controller: topo.controller,
    tickInterval: parseInt($speedSlider.value),
    onTick: (controller, state) => {
      const history = state.metricsHistory;
      const lastMetrics = history[history.length - 1];
      if (!lastMetrics) return;
      const snapshot = controller.getMetricsSnapshot(state);
      onTick(state.currentTick, lastMetrics, snapshot);
    },
  });

  $tickCounter.textContent = "0";
  renderTopologyVisual();
  populateChaosTargets();
  resetCharts();
  updateStats(null);
  renderHealthBars(null);
  updatePlayButton();
}

// ─── Tick callback ────────────────────────────────────────────────────
function onTick(tick: number, metrics: TickMetrics, snapshot: MetricsSnapshot): void {
  $tickCounter.textContent = String(tick);

  // Charts
  throughputData.labels.push(tick);
  throughputData.resolved.push(metrics.requestsResolved);
  throughputData.dropped.push(metrics.requestsDropped);
  latencyData.labels.push(tick);
  latencyData.values.push(metrics.avgLatency);

  if (throughputData.labels.length > MAX_CHART_POINTS) {
    throughputData.labels.shift();
    throughputData.resolved.shift();
    throughputData.dropped.shift();
    latencyData.labels.shift();
    latencyData.values.shift();
  }

  throughputChart.update();
  latencyChart.update();

  // Stats
  updateStats(snapshot);

  // Health bars
  renderHealthBars(metrics);
}

function updateStats(snapshot: MetricsSnapshot | null): void {
  if (!snapshot) {
    $statResolved.textContent = "0";
    $statDropped.textContent = "0";
    $statTimedout.textContent = "0";
    $statBackpressured.textContent = "0";
    $statReliability.textContent = "100%";
    $statLatency.textContent = "0";
    $statRevenue.textContent = "0";
    $statUpkeep.textContent = "0";
    return;
  }
  $statResolved.textContent = String(snapshot.totalResolved);
  $statDropped.textContent = String(snapshot.totalDropped);
  $statTimedout.textContent = String(snapshot.totalTimedOut);
  $statBackpressured.textContent = String(snapshot.totalBackpressured);
  $statReliability.textContent = `${(snapshot.reliability * 100).toFixed(1)}%`;
  $statLatency.textContent = snapshot.avgLatency.toFixed(1);
  $statRevenue.textContent = topo.controller.economy.totalRevenue.toFixed(0);
  $statUpkeep.textContent = topo.controller.economy.totalUpkeep.toFixed(0);
}

function renderHealthBars(metrics: TickMetrics | null): void {
  $healthBars.innerHTML = "";
  for (const comp of topo.components) {
    const perComp = metrics?.perComponent.get(comp.id);
    const condition = perComp?.condition ?? 1;
    const pending = perComp?.pendingAtEndOfTick ?? 0;

    const color = condition > 0.6 ? "var(--green)" : condition > 0.3 ? "var(--yellow)" : "var(--red)";
    const pct = (condition * 100).toFixed(0);

    $healthBars.innerHTML += `
      <div class="health-bar-container">
        <div class="health-bar-label">
          <span>${comp.name}</span>
          <span>${pct}% · ${pending} pending</span>
        </div>
        <div class="health-bar-track">
          <div class="health-bar-fill" style="width: ${pct}%; background: ${color};"></div>
        </div>
      </div>
    `;
  }
}

// ─── Controls ─────────────────────────────────────────────────────────
function updatePlayButton(): void {
  $btnPlay.textContent = simLoop.isRunning ? "⏸ Pause" : "▶ Play";
}

$btnPlay.addEventListener("click", () => {
  if (simLoop.isRunning) {
    simLoop.stop();
  } else {
    simLoop.play();
  }
  updatePlayButton();
});

$btnStep.addEventListener("click", () => {
  simLoop.stop();
  simLoop.step();
  updatePlayButton();
});

$btnReset.addEventListener("click", () => {
  initTopology();
});

$topoSelect.addEventListener("change", () => {
  initTopology();
});

$trafficSelect.addEventListener("change", () => {
  initTopology();
});

$speedSlider.addEventListener("input", () => {
  simLoop.tickInterval = 1020 - parseInt($speedSlider.value); // invert: slider right = faster
});

// ─── Chaos ────────────────────────────────────────────────────────────
$btnChaosKill.addEventListener("click", () => {
  const id = $chaosTarget.value;
  if (topo.components.some(c => c.id === id)) {
    topo.controller.scheduleChaos(
      { kind: "component_failure", componentId: id as ComponentId },
      topo.state.currentTick + 1,
    );
  }
});

$btnChaosLatency.addEventListener("click", () => {
  const id = $chaosTarget.value;
  if (topo.connections.some(c => c.id === id)) {
    topo.controller.scheduleChaos(
      { kind: "latency_injection", connectionId: id as ConnectionId, extraLatency: 20, durationTicks: 10 },
      topo.state.currentTick + 1,
    );
  }
});

$btnChaosZone.addEventListener("click", () => {
  topo.controller.scheduleChaos(
    { kind: "zone_outage", zone: "default", durationTicks: 5 },
    topo.state.currentTick + 1,
  );
});

$btnChaosSever.addEventListener("click", () => {
  const id = $chaosTarget.value;
  if (topo.connections.some(c => c.id === id)) {
    topo.controller.scheduleChaos(
      { kind: "connection_sever", connectionId: id as ConnectionId, durationTicks: 5 },
      topo.state.currentTick + 1,
    );
  }
});

// ─── Scenario IO ──────────────────────────────────────────────────────
$btnSave.addEventListener("click", () => {
  const scenario = exportScenario("Dashboard Scenario", "Exported from sandbox dashboard", topo.controller);
  const json = serializeScenario(scenario);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sandbox-scenario-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$btnLoad.addEventListener("click", () => {
  $fileInput.click();
});

$fileInput.addEventListener("change", () => {
  const file = $fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const scenario = parseScenario(reader.result as string);
      applyScenario(scenario, topo.controller, topo.entryPointId);
      resetCharts();
      $tickCounter.textContent = String(topo.state.currentTick);
      alert("Scenario loaded!");
    } catch (e) {
      alert(`Failed to load scenario: ${(e as Error).message}`);
    }
  };
  reader.readAsText(file);
  $fileInput.value = "";
});

// ─── TD Mode ──────────────────────────────────────────────────────────
// Module-level TD state so boot/teardown/onTick can share references.
const TD_WAVES = [WAVE_1, WAVE_2, WAVE_3] as const;

let tdDashboard: TDDashboard | null = null;
let tdLoop: SimLoop<TDModeController> | null = null;
let tdEngine: Engine | null = null;
let tdState: SimulationState | null = null;
let tdController: TDModeController | null = null;
let tdClientId: ComponentId | null = null;

// === Action log for retry/reset ===
// Logical actions, NO concrete component ids in the log itself. References to
// placed components use the place-action's index in the log; references to the
// entry-point use -1. This makes the log replayable across full reboots where
// component ids change.
type TDPlaceAction = { kind: "place"; type: string; position: { x: number; y: number } };
type TDConnectAction = { kind: "connect"; sourceRef: number; targetRef: number };
type TDAction = TDPlaceAction | TDConnectAction;

let tdActionLog: TDAction[] = [];
/** Index into tdActionLog marking the end of the most recent successful wave. */
let tdSnapshotIndex = 0;
/** Parallel array: index N → ComponentId minted by the Nth place action. */
let tdPlaceActionIds: ComponentId[] = [];

function refForId(id: ComponentId): number {
  if (id === tdClientId) return -1;
  return tdPlaceActionIds.indexOf(id);
}

function idForRef(ref: number): ComponentId | null {
  if (ref === -1) return tdClientId;
  return tdPlaceActionIds[ref] ?? null;
}

const $modeSandbox = document.getElementById("mode-sandbox") as HTMLButtonElement;
const $modeTd = document.getElementById("mode-td") as HTMLButtonElement;

// Sandbox-only panels that should be hidden while in TD mode.
const SANDBOX_PANEL_IDS = [
  "topology-select",
  "traffic-select",
  "btn-play",
  "btn-step",
  "btn-reset",
  "speed-slider",
];

function getCurrentTickIntervalMs(): number {
  // Sandbox speed slider: right = faster. Invert to ms the same way sandbox does.
  return 1020 - parseInt($speedSlider.value);
}

function clearChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function showWaveResultToast(outcome: OutcomeReport): void {
  const toast = document.createElement("div");
  toast.className = "td-toast";
  toast.style.position = "fixed";
  toast.style.top = "24px";
  toast.style.left = "50%";
  toast.style.transform = "translateX(-50%)";
  toast.style.padding = "16px 28px";
  toast.style.background = outcome.verdict === "win" ? "#1a3b1f" : "#3b1a1a";
  toast.style.color = "#e1e4ed";
  toast.style.border = `1px solid ${outcome.verdict === "win" ? "#22c55e" : "#ef4444"}`;
  toast.style.borderRadius = "8px";
  toast.style.fontWeight = "600";
  toast.style.fontSize = "14px";
  toast.style.zIndex = "1000";
  toast.style.boxShadow = "0 8px 24px rgba(0,0,0,0.5)";
  const noteText = outcome.notes.join(" · ");
  toast.textContent = `Wave ${outcome.verdict.toUpperCase()} — ${noteText}`;
  document.body.appendChild(toast);
  // 10-second timeout so the player has time to read it
  setTimeout(() => toast.remove(), 10000);
}

/** Tracks per-wave start tick so we can compute wave-relative tick number for the HUD. */
let waveStartTick = 0;

/** The per-tick callback — hoisted so loop reconstruction can reuse it. */
let tdTickSeq = 0;
function tdOnTick(controller: TDModeController, state: SimulationState): void {
  tdTickSeq += 1;

  // Update the in-topology running status every tick (cheap text update).
  const wave = controller.getCurrentWave();
  const tickInWave = state.currentTick - waveStartTick;
  const resolvedThisWave = controller
    .getCurrentWaveMetrics(state)
    .reduce((sum, m) => sum + m.requestsResolved, 0);
  tdDashboard?.updateRunningStatus(tickInWave, wave.duration, resolvedThisWave);
  tdDashboard?.applyTick(state, tdLoop?.tickInterval ?? 200);

  if (!controller.isWaveDrained(state)) return;

  // eslint-disable-next-line no-console
  console.warn(
    `[td-wave-end] wave ${controller.getCurrentWaveIndex() + 1} drained at tick=${state.currentTick}`,
  );
  tdLoop?.stop();
  controller.advancePhase(state); // simulate → assess
  const outcome = controller.evaluateOutcome(
    controller.getCurrentWaveMetrics(state),
  );
  // eslint-disable-next-line no-console
  console.warn(
    `[td-outcome] verdict=${outcome.verdict} notes=${outcome.notes.join(" | ")}`,
  );
  showWaveResultToast(outcome);

  if (outcome.verdict === "win") {
    // === WIN: snapshot the action log and advance to next wave ===
    tdSnapshotIndex = tdActionLog.length;
    // eslint-disable-next-line no-console
    console.warn(`[td-snapshot] saved at action ${tdSnapshotIndex}`);

    const nextIdx = controller.getCurrentWaveIndex() + 1;
    if (nextIdx < controller.getWaveCount()) {
      const nextWave = TD_WAVES[nextIdx]!;
      controller.setEconomy(
        new TDEconomy({
          startingBudget: nextWave.startingBudget,
          revenuePerRequestType: nextWave.revenuePerRequestType,
        }),
      );
      for (const id of state.components.keys()) {
        state.setCondition(id, 1.0);
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[td-next-wave] advancing to wave ${nextIdx + 1} of ${controller.getWaveCount()}, fresh economy budget=${nextWave.startingBudget}`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[td-campaign-end] all ${controller.getWaveCount()} waves complete`);
    }
    // advancePhase handles terminal case: bumps waveIndex and stays in assess
    // when there is no next wave, so isCampaignComplete() becomes true.
    controller.advancePhase(state);
    tdTickSeq = 0;
    tdDashboard?.refreshHud();
    tdDashboard?.rerenderTopology();
  } else {
    // === LOSS: stay in assess phase, show retry/reset modal ===
    // eslint-disable-next-line no-console
    console.warn(
      `[td-loss] wave ${controller.getCurrentWaveIndex() + 1} lost; awaiting Retry or Reset`,
    );
    showLossModal(outcome);
    tdTickSeq = 0;
    tdDashboard?.refreshHud();
    tdDashboard?.rerenderTopology();
  }
}

// === Loss modal helpers ===

function showLossModal(outcome: OutcomeReport): void {
  const modal = document.getElementById("td-loss-modal");
  const title = document.getElementById("td-loss-modal-title");
  const detail = document.getElementById("td-loss-modal-detail");
  if (!modal || !title || !detail || !tdController) return;
  const waveNum = tdController.getCurrentWaveIndex() + 1;
  title.textContent = `Wave ${waveNum} LOST`;
  detail.textContent = outcome.notes.join(" · ");
  // Update Retry button label so the player knows which wave they'll retry.
  const retryBtn = document.getElementById("td-retry-btn");
  if (retryBtn) retryBtn.textContent = `Retry Wave ${waveNum}`;
  modal.hidden = false;
}

function hideLossModal(): void {
  const modal = document.getElementById("td-loss-modal");
  if (modal) modal.hidden = true;
}

/**
 * Replays a slice of the action log against the current state + controller.
 * Used by Retry to reconstruct the topology that existed at the end of the
 * most recent successful wave. Rebuilds tdPlaceActionIds as a side effect.
 */
function replayActions(actions: readonly TDAction[]): void {
  if (!tdController || !tdState) return;
  tdPlaceActionIds = [];
  for (const action of actions) {
    if (action.kind === "place") {
      const result = tdController.tryPlace(
        tdState,
        action.type,
        action.position,
        null,
      );
      if (result.ok) {
        tdPlaceActionIds.push(result.componentId);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[td-replay] place failed: ${result.reason}`);
      }
    } else {
      const sourceId = idForRef(action.sourceRef);
      const targetId = idForRef(action.targetRef);
      if (!sourceId || !targetId) {
        // eslint-disable-next-line no-console
        console.warn(`[td-replay] connect failed: missing ref`);
        continue;
      }
      const result = tdController.tryConnect(tdState, sourceId, targetId);
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[td-replay] connect failed: ${result.reason}`);
      }
    }
  }
  // eslint-disable-next-line no-console
  console.warn(`[td-replay] applied ${actions.length} actions`);
}

/** Retry the failed wave by rewinding to the end-of-prior-wave snapshot. */
function retryTDWave(): void {
  if (!tdController) return;
  // eslint-disable-next-line no-console
  console.warn(`[td-retry] rewinding to snapshot=${tdSnapshotIndex}`);
  hideLossModal();

  // Save the snapshot slice + the wave we were on before nuking state.
  const snapshotActions = tdActionLog.slice(0, tdSnapshotIndex);
  const failedWaveIndex = tdController.getCurrentWaveIndex();
  const failedWaveStartingBudget = TD_WAVES[failedWaveIndex]!.startingBudget;
  const revenueTable = TD_WAVES[failedWaveIndex]!.revenuePerRequestType;

  // Full state reboot (preserves the action log; we'll restore it after replay).
  bootTDMode();
  // bootTDMode resets tdActionLog to [] via the reset path; but we kept the
  // snapshot slice in `snapshotActions`. The new boot also reset tdSnapshotIndex.

  // Replay snapshotted actions so the topology matches end-of-prior-wave.
  replayActions(snapshotActions);

  // Restore the action log + snapshot marker.
  tdActionLog = snapshotActions.slice();
  tdSnapshotIndex = tdActionLog.length;

  // Advance the controller's wave index to the failed wave (we lost on this one;
  // bootTDMode put us on wave 0).
  for (let i = 0; i < failedWaveIndex; i++) {
    // build → simulate → assess → build (advances waveIndex by 1)
    tdController!.advancePhase();
    tdController!.advancePhase();
    tdController!.advancePhase();
  }

  // Reset the economy + condition for the failed wave.
  tdController!.setEconomy(
    new TDEconomy({
      startingBudget: failedWaveStartingBudget,
      revenuePerRequestType: revenueTable,
    }),
  );
  if (tdState) {
    for (const id of tdState.components.keys()) {
      tdState.setCondition(id, 1.0);
    }
  }

  tdDashboard?.refreshHud();
  tdDashboard?.rerenderTopology();
  // eslint-disable-next-line no-console
  console.warn(
    `[td-retry] complete; back to wave ${failedWaveIndex + 1} build phase`,
  );
}

/** Reset the campaign — clears the action log and reboots from Wave 1. */
function resetTDCampaign(): void {
  // eslint-disable-next-line no-console
  console.warn(`[td-reset] clearing log and rebooting`);
  hideLossModal();
  tdActionLog = [];
  tdSnapshotIndex = 0;
  tdPlaceActionIds = [];
  bootTDMode();
}

async function bootTDMode(): Promise<void> {
  // eslint-disable-next-line no-console
  console.warn("[td-boot] bootTDMode start");
  // Reset action log on a fresh boot. (Retry uses bootTDMode then re-restores
  // the log post-replay; that's why we always start clean here.)
  tdActionLog = [];
  tdSnapshotIndex = 0;
  tdPlaceActionIds = [];
  // Stop sandbox loop (don't tear it down entirely — re-entry just clicks the
  // sandbox button, which calls initTopology()).
  simLoop?.stop();

  // Hide sandbox-only panels.
  for (const id of SANDBOX_PANEL_IDS) {
    const el = document.getElementById(id);
    if (el) (el as HTMLElement).style.display = "none";
  }
  // Clear the shared topology visual — TD dashboard will re-render into it.
  clearChildren($topoVisual);
  // Make topology container absolute-positionable for TD component divs.
  $topoVisual.style.position = "relative";

  const state = new SimulationState({
    zones: ["default"],
    pairLatency: new Map(),
  });
  const capRegistry = new CapabilityRegistry();
  const compRegistry = new ComponentRegistry(capRegistry);
  registerTDDefaults(capRegistry, compRegistry);

  // Seed the entry-point Client on the left side of the grid (visible).
  const client = compRegistry.create("client", { x: 2, y: 5 }, null);
  state.placeComponent(client);
  tdClientId = client.id;

  const economy = new TDEconomy({
    startingBudget: WAVE_1.startingBudget,
    revenuePerRequestType: WAVE_1.revenuePerRequestType,
  });
  const controller = new TDModeController({
    waves: TD_WAVES,
    economy,
    entryPointId: client.id,
    rng: Math.random,
    componentRegistry: compRegistry,
  });

  // visitOrder is refreshed via state.recomputeVisitOrder() on each
  // build→simulate transition (newly placed components are otherwise
  // invisible to the engine's per-tick loop).
  const engine = new Engine(state);
  tdEngine = engine;
  tdState = state;
  tdController = controller;

  tdDashboard = await createTDDashboard({
    state,
    controller,
    topologyContainer: $topoVisual,
    onPlace: (id) => {
      // Record the place action in the log (logical, no concrete id stored).
      const comp = state.components.get(id);
      if (comp) {
        tdActionLog.push({
          kind: "place",
          type: comp.type,
          position: { x: comp.position.x, y: comp.position.y },
        });
        tdPlaceActionIds.push(id);
        // eslint-disable-next-line no-console
        console.warn(
          `[td-action] place ${comp.type}@(${comp.position.x},${comp.position.y}); log=${tdActionLog.length}`,
        );
      }
      tdDashboard?.refreshHud();
    },
    onConnect: (connectionId) => {
      // Record the connect action with logical refs (entry-point = -1, else
      // index into place actions). This makes the log replayable across reboots.
      const conn = state.connections.get(connectionId);
      if (conn) {
        const sourceRef = refForId(conn.source.componentId);
        const targetRef = refForId(conn.target.componentId);
        tdActionLog.push({ kind: "connect", sourceRef, targetRef });
        // eslint-disable-next-line no-console
        console.warn(
          `[td-action] connect ${sourceRef}→${targetRef}; log=${tdActionLog.length}`,
        );
      }
      tdDashboard?.refreshHud();
    },
    onPhaseChange: () => {
      tdDashboard?.refreshHud();
      // eslint-disable-next-line no-console
      console.warn(
        `[td-phase] now ${controller.getPhase()} (wave ${controller.getCurrentWaveIndex() + 1} of ${controller.getWaveCount()})`,
      );
      if (controller.getPhase() === "simulate") {
        // Snapshot the wave-start tick so the per-tick HUD can show
        // wave-relative tick numbers (rather than the engine's global tick).
        waveStartTick = state.currentTick;
        // Refresh visitOrder so freshly-placed components are visited.
        state.recomputeVisitOrder();
        // eslint-disable-next-line no-console
        console.warn(
          `[td-engine] visitOrder refreshed; [${state.visitOrder.join(",")}] components=${state.components.size} connections=${state.connections.size}`,
        );
        tdLoop?.reset(engine, state, controller);
        tdLoop?.play();
        // eslint-disable-next-line no-console
        console.warn(`[td-loop] started; tickInterval=${tdLoop?.tickInterval}ms`);
      }
    },
  });

  tdLoop = new SimLoop<TDModeController>({
    engine,
    state,
    controller,
    tickInterval: getCurrentTickIntervalMs(),
    onTick: tdOnTick,
    shouldStop: (c) => c.getPhase() !== "simulate",
  });

  tdDashboard.refreshHud();
}

function teardownTDMode(): void {
  tdLoop?.stop();
  tdLoop = null;
  tdDashboard?.destroy();
  tdDashboard = null;
  tdState = null;
  tdController = null;
  tdEngine = null;

  // Restore sandbox panels.
  for (const id of SANDBOX_PANEL_IDS) {
    const el = document.getElementById(id);
    if (el) (el as HTMLElement).style.display = "";
  }
  $topoVisual.style.position = "";
}

// ─── Mode toggle ──────────────────────────────────────────────────────
function activateSandboxButton(): void {
  $modeSandbox.classList.add("active");
  $modeTd.classList.remove("active");
}

function activateTdButton(): void {
  $modeTd.classList.add("active");
  $modeSandbox.classList.remove("active");
}

$modeTd.addEventListener("click", () => {
  if (tdDashboard) return; // already in TD mode
  if (location.hash !== "#mode=td") location.hash = "#mode=td";
  activateTdButton();
  void bootTDMode();
});

$modeSandbox.addEventListener("click", () => {
  if (!tdDashboard) return; // already in sandbox mode
  if (location.hash !== "#mode=sandbox") location.hash = "#mode=sandbox";
  activateSandboxButton();
  teardownTDMode();
  // Rebuild sandbox topology from the currently-selected preset.
  initTopology();
});

// Keep the TD sim loop responsive to the shared speed slider.
$speedSlider.addEventListener("input", () => {
  if (tdLoop) tdLoop.tickInterval = getCurrentTickIntervalMs();
});

// Loss modal buttons (one-time wiring; modal HTML is static).
const $tdRetryBtn = document.getElementById("td-retry-btn") as HTMLButtonElement | null;
const $tdResetBtn = document.getElementById("td-reset-btn") as HTMLButtonElement | null;
$tdRetryBtn?.addEventListener("click", () => retryTDWave());
$tdResetBtn?.addEventListener("click", () => resetTDCampaign());

// ─── Boot ─────────────────────────────────────────────────────────────
populateSelects();
if (location.hash === "#mode=td") {
  activateTdButton();
  // Fire-and-forget at module load; Pixi v8 init is async.
  void bootTDMode();
} else {
  activateSandboxButton();
  initTopology();
}
