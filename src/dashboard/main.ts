import { TOPOLOGIES, type TopologyInfo } from "./topologies";
import { SimLoop } from "./sim-loop";
import { exportScenario, applyScenario, serializeScenario, parseScenario } from "@modes/sandbox/sandbox-scenario";
import type { ComponentId, ConnectionId, CapabilityId } from "@core/types/ids";
import type { Component } from "@core/component/component";
import type { TickMetrics } from "@core/types/metrics";
import type { SandboxModeController, MetricsSnapshot } from "@modes/sandbox/sandbox-mode-controller";

// TD mode imports
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1, WAVE_2, WAVE_3, WAVE_4, WAVE_5 } from "@modes/td/td-waves";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { SimulationState } from "@core/state/simulation-state";
import { Engine } from "@core/engine/engine";
import { createTDDashboard, type TDDashboard } from "./td-mode";
import type { OutcomeReport } from "@core/types/outcome";
import { diagnoseWave } from "./td/diagnose-wave";
import { activateCyberpunkHud, isCyberpunkHudActive } from "./cyberpunk-hud";
import {
  ComponentDossierStore,
  DOSSIERS,
  showDossier,
} from "./td/component-dossier.js";
import { getCyberpunkHudController } from "./cyberpunk-hud.js";

declare const Chart: any;

// ─── Entry-point redirect: force iso HUD for TD mode ──────────────────
// Slice B makes the iso cyberpunk HUD the canonical TD surface. Anyone
// arriving with #mode=td but without ?renderer=iso gets silently rewritten.
// Classic TD mode is deprecated and left only as a code-path for the sandbox
// HUD's stale mirror targets; no bookmark-surface depends on it.
(function forceIsoForTDMode(): void {
  const hash = window.location.hash;
  if (!hash.startsWith("#mode=td")) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("renderer") === "iso") return;
  url.searchParams.set("renderer", "iso");
  // replaceState (not assign) so the user's history isn't polluted.
  window.history.replaceState(null, "", url.toString());
})();

// Activate cyberpunk HUD at boot (before any TD DOM is shown) if the URL opts in.
if (isCyberpunkHudActive()) {
  activateCyberpunkHud();
}

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
const TD_WAVES = [WAVE_1, WAVE_2, WAVE_3, WAVE_4, WAVE_5] as const;

/**
 * Test-mode affordance: parse `#mode=td&wave=N` (1-indexed) and return
 * the matching wave index (0-based), clamped to the valid range. Defaults
 * to 0 when no `wave` param is present.
 */
function parseTDStartingWaveFromHash(): number {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(raw);
  const waveParam = params.get("wave");
  if (!waveParam) return 0;
  const n = parseInt(waveParam, 10);
  if (Number.isNaN(n) || n < 1) return 0;
  return Math.min(n - 1, TD_WAVES.length - 1);
}

/**
 * Cumulative starting budget through wave index (inclusive). Used when
 * jump-starting at a later wave so the player has a budget reflecting
 * "you would have earned this by finishing the prior waves."
 */
function cumulativeStartingBudget(waveIndex: number): number {
  let sum = 0;
  for (let i = 0; i <= waveIndex; i++) {
    sum += TD_WAVES[i]?.startingBudget ?? 0;
  }
  return sum;
}

const dossierStore = new ComponentDossierStore();

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
type TDDisconnectAction = { kind: "disconnect"; sourceRef: number; targetRef: number };
type TDRemoveAction = { kind: "remove"; placeRef: number };
type TDAction = TDPlaceAction | TDConnectAction | TDDisconnectAction | TDRemoveAction;

let tdActionLog: TDAction[] = [];
/** Index into tdActionLog marking the end of the most recent successful wave. */
let tdSnapshotIndex = 0;
/**
 * Parallel array: index N → ComponentId minted by the Nth place action.
 * Slots are set to null when the component is removed so future refs to
 * that index fail loudly instead of silently reusing a stale id.
 */
let tdPlaceActionIds: (ComponentId | null)[] = [];

function refForId(id: ComponentId): number {
  if (id === tdClientId) return -1;
  // indexOf is safe — null slots won't match a real ComponentId string
  return tdPlaceActionIds.indexOf(id);
}

function idForRef(ref: number): ComponentId | null {
  if (ref === -1) return tdClientId;
  // null means the slot was dead-marked by a remove action — return null
  // so callers fail loudly rather than silently reusing a stale id.
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
  const isWin = outcome.verdict === "win";
  const modifier = isWin ? "td-toast--win" : "td-toast--loss";
  const toast = document.createElement("div");
  toast.className = `td-toast ${modifier}`;

  const currentIdx = tdController?.getCurrentWaveIndex() ?? 0;
  const currentWave = TD_WAVES[currentIdx];
  const nextWave = TD_WAVES[currentIdx + 1];

  // ─ Title ──────────────────────────────────────────────────────────
  const title = document.createElement("div");
  title.className = "td-toast__title";
  title.textContent = isWin
    ? `Wave ${currentIdx + 1} Complete`
    : `Wave ${currentIdx + 1} Lost`;
  toast.appendChild(title);

  if (currentWave) {
    const subtitle = document.createElement("div");
    subtitle.className = "td-toast__subtitle";
    subtitle.textContent = currentWave.name;
    toast.appendChild(subtitle);
  }

  // ─ Current-round stats ────────────────────────────────────────────
  if (tdController && tdState) {
    const metrics = tdController.getCurrentWaveMetrics(tdState);
    const totalResolved = metrics.reduce((s, m) => s + m.requestsResolved, 0);
    const totalDropped = metrics.reduce((s, m) => s + m.requestsDropped, 0);
    const totalRev = metrics.reduce((s, m) => s + m.revenueEarned, 0);
    const totalUpkeep = metrics.reduce((s, m) => s + m.upkeepPaid, 0);
    const denom = totalResolved + totalDropped;
    const servedPct = denom > 0 ? Math.round((totalResolved / denom) * 100) : 0;
    const net = totalRev - totalUpkeep;
    const netSign = net >= 0 ? "+" : "";

    const stats = document.createElement("div");
    stats.className = "td-toast__block";
    stats.appendChild(statRow("Served", `${servedPct}%`));
    stats.appendChild(statRow("Revenue", `$${totalRev}`));
    stats.appendChild(statRow("Upkeep", `$${totalUpkeep}`));
    stats.appendChild(statRow("Net", `${netSign}$${net}`));
    toast.appendChild(stats);

    if (outcome.notes.length > 0) {
      const notes = document.createElement("div");
      notes.className = "td-toast__notes";
      notes.textContent = outcome.notes.join(" · ");
      toast.appendChild(notes);
    }
  }

  // ─ Next-wave preview ──────────────────────────────────────────────
  if (isWin && nextWave) {
    const divider = document.createElement("div");
    divider.className = "td-toast__divider";
    toast.appendChild(divider);

    const next = document.createElement("div");
    next.className = "td-toast__block";

    const nextHeader = document.createElement("div");
    nextHeader.className = "td-toast__next-header";
    nextHeader.textContent = `Next — ${nextWave.name}`;
    next.appendChild(nextHeader);

    next.appendChild(statRow("Intensity", `${nextWave.intensity} req/tick`));
    next.appendChild(statRow("Budget", `$${nextWave.startingBudget}`));
    next.appendChild(statRow("Traffic", formatTrafficMix(nextWave.composition)));
    if (nextWave.sla) {
      const availPct = Math.round(nextWave.sla.availabilityTarget * 100);
      next.appendChild(statRow("SLA", `≥${availPct}% · ≤${nextWave.sla.maxAvgLatency}t latency`));
    }
    toast.appendChild(next);
  } else if (isWin) {
    const divider = document.createElement("div");
    divider.className = "td-toast__divider";
    toast.appendChild(divider);

    const note = document.createElement("div");
    note.className = "td-toast__next-header";
    note.textContent = "Campaign Complete";
    toast.appendChild(note);
  }

  // ─ Action button (dismiss) ────────────────────────────────────────
  const dismiss = (): void => {
    if (toast.parentNode) toast.remove();
  };

  const button = document.createElement("button");
  button.type = "button";
  button.className = "td-toast__btn";
  button.textContent = isWin && nextWave ? "Continue ▶" : "Dismiss";
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    dismiss();
  });
  toast.appendChild(button);

  // Click anywhere on the toast also dismisses.
  toast.addEventListener("click", dismiss);

  document.body.appendChild(toast);
}

function statRow(key: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "td-toast__stat";
  const k = document.createElement("span");
  k.className = "td-toast__stat-key";
  k.textContent = key;
  const v = document.createElement("span");
  v.className = "td-toast__stat-val";
  v.textContent = value;
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

function formatTrafficMix(composition: ReadonlyMap<string, number>): string {
  const parts: string[] = [];
  for (const [type, pct] of composition) {
    const short = type
      .replace(/^api_/, "")
      .replace(/^static_/, "")
      .replace(/_required$/, "")
      .replace(/_/g, " ");
    parts.push(`${Math.round(pct * 100)}% ${short}`);
  }
  return parts.join(" · ");
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
          startingBudget: nextWave.startingBudget ?? 0,
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

function gatherPerTypeCacheStats(
  state: { components: ReadonlyMap<ComponentId, Component> },
): Array<{
  componentName: string;
  hitRateByType: Record<string, { hits: number; misses: number; hitRate: number }>;
}> {
  const results: Array<{
    componentName: string;
    hitRateByType: Record<string, { hits: number; misses: number; hitRate: number }>;
  }> = [];
  for (const comp of state.components.values()) {
    const caching = comp.capabilities.get("caching" as CapabilityId);
    if (!caching) continue;
    const stats = caching.getStats();
    if (!stats.hitRateByType || Object.keys(stats.hitRateByType).length === 0) {
      continue;
    }
    results.push({
      componentName: comp.name ?? comp.type,
      hitRateByType: stats.hitRateByType,
    });
  }
  return results;
}

function showLossModal(outcome: OutcomeReport): void {
  const modal = document.getElementById("td-loss-modal");
  const title = document.getElementById("td-loss-modal-title");
  const detail = document.getElementById("td-loss-modal-detail");
  if (!modal || !title || !detail || !tdController || !tdState) return;
  const waveNum = tdController.getCurrentWaveIndex() + 1;
  title.textContent = `Wave ${waveNum} LOST`;

  const metrics = tdController.getCurrentWaveMetrics(tdState);
  const diagnosis = diagnoseWave({
    wave: tdController.getCurrentWave(),
    metrics,
    components: tdState.components,
    connections: tdState.connections,
  });

  while (detail.firstChild) detail.removeChild(detail.firstChild);

  const headlineEl = document.createElement("div");
  headlineEl.textContent = diagnosis.headline;
  headlineEl.style.fontWeight = "600";
  headlineEl.style.color = "#ef4444";
  headlineEl.style.marginBottom = "8px";
  detail.appendChild(headlineEl);

  const symptomEl = document.createElement("div");
  symptomEl.textContent = diagnosis.symptom;
  symptomEl.style.marginBottom = "8px";
  detail.appendChild(symptomEl);

  if (diagnosis.hint) {
    const hintEl = document.createElement("div");
    hintEl.textContent = diagnosis.hint;
    hintEl.style.color = "#8b8fa3";
    hintEl.style.fontStyle = "italic";
    detail.appendChild(hintEl);
  }

  const notesEl = document.createElement("div");
  notesEl.textContent = outcome.notes.join(" · ");
  notesEl.style.marginTop = "12px";
  notesEl.style.color = "#8b8fa3";
  notesEl.style.fontSize = "11px";
  detail.appendChild(notesEl);

  const cacheStats = gatherPerTypeCacheStats(tdState);
  if (cacheStats.length > 0) {
    const cacheHeader = document.createElement("div");
    cacheHeader.textContent = "Cache hit rates:";
    cacheHeader.style.marginTop = "12px";
    cacheHeader.style.fontWeight = "600";
    cacheHeader.style.fontSize = "11px";
    detail.appendChild(cacheHeader);

    for (const { componentName, hitRateByType } of cacheStats) {
      const row = document.createElement("div");
      const parts: string[] = [];
      for (const [type, stats] of Object.entries(hitRateByType)) {
        parts.push(`${type}: ${(stats.hitRate * 100).toFixed(0)}%`);
      }
      row.textContent = `  ${componentName} — ${parts.join(", ")}`;
      row.style.color = "#8b8fa3";
      row.style.fontSize = "11px";
      detail.appendChild(row);
    }
  }

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
        // Push null so subsequent place-ref indices remain correct
        tdPlaceActionIds.push(null);
      }
    } else if (action.kind === "connect") {
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
    } else if (action.kind === "disconnect") {
      const sourceId = idForRef(action.sourceRef);
      const targetId = idForRef(action.targetRef);
      if (!sourceId || !targetId) {
        // eslint-disable-next-line no-console
        console.warn(`[td-replay] disconnect failed: missing ref`);
        continue;
      }
      // Find the connection matching source→target
      let connIdToRemove: ConnectionId | null = null;
      for (const conn of tdState.connections.values()) {
        if (
          conn.source.componentId === sourceId &&
          conn.target.componentId === targetId
        ) {
          connIdToRemove = conn.id;
          break;
        }
      }
      if (!connIdToRemove) {
        // eslint-disable-next-line no-console
        console.warn(`[td-replay] disconnect failed: connection not found`);
        continue;
      }
      const result = tdController.tryDisconnect(tdState, connIdToRemove);
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[td-replay] disconnect failed: ${result.reason}`);
      }
    } else if (action.kind === "remove") {
      const componentId = idForRef(action.placeRef);
      if (!componentId) {
        // eslint-disable-next-line no-console
        console.warn(`[td-replay] remove failed: missing placeRef ${action.placeRef}`);
        continue;
      }
      const result = tdController.tryRemove(tdState, componentId);
      if (result.ok) {
        // Dead-mark the place-ref slot so future refs to it fail loudly
        tdPlaceActionIds[action.placeRef] = null;
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[td-replay] remove failed: ${result.reason}`);
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
  const failedWaveStartingBudget = TD_WAVES[failedWaveIndex]!.startingBudget ?? 0;
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

  // Test-mode: the hash may say `#mode=td&wave=N` to jump-start at a
  // later wave with a cumulative starting budget. Omitted param → wave 1.
  const startingWaveIndex = parseTDStartingWaveFromHash();
  const startingWave = TD_WAVES[startingWaveIndex]!;
  const startingBudget = cumulativeStartingBudget(startingWaveIndex);
  // eslint-disable-next-line no-console
  console.warn(
    `[td-boot] starting at wave ${startingWaveIndex + 1} of ${TD_WAVES.length} with $${startingBudget}`,
  );
  const economy = new TDEconomy({
    startingBudget,
    revenuePerRequestType: startingWave.revenuePerRequestType,
  });
  const controller = new TDModeController({
    waves: TD_WAVES,
    economy,
    entryPointId: client.id,
    rng: Math.random,
    componentRegistry: compRegistry,
    ...(startingWaveIndex > 0 ? { startingWaveIndex } : {}),
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
    onDisconnect: ({ connectionId: _connectionId, sourceId, targetId }) => {
      // Look up logical refs for both endpoints and record a disconnect action.
      // The connection has already been removed from state at this point, so we
      // rely on the sourceId/targetId passed from td-mode.ts (captured before
      // tryDisconnect ran).
      const sourceRef = refForId(sourceId);
      const targetRef = refForId(targetId);
      // refForId returns -1 for the entry-point client and a non-negative index
      // for placed components. A value of -1 for a non-client component means
      // the id wasn't found — guard against both endpoints returning -1 when
      // neither is the actual client (shouldn't happen in practice).
      if (sourceRef < -1 || targetRef < -1) {
        // eslint-disable-next-line no-console
        console.warn(`[td-action] disconnect: could not resolve refs for ${sourceId}→${targetId}`);
        return;
      }
      tdActionLog.push({ kind: "disconnect", sourceRef, targetRef });
      // eslint-disable-next-line no-console
      console.warn(
        `[td-action] disconnect ${sourceRef}→${targetRef}; log=${tdActionLog.length}`,
      );
      tdDashboard?.refreshHud();
    },
    onRemove: (id) => {
      // Find the place-ref for the removed component and dead-mark the slot.
      const placeRef = tdPlaceActionIds.indexOf(id);
      if (placeRef >= 0) {
        tdActionLog.push({ kind: "remove", placeRef });
        // Dead-mark the slot so future actions referencing this index fail loudly
        tdPlaceActionIds[placeRef] = null;
        // eslint-disable-next-line no-console
        console.warn(
          `[td-action] remove placeRef=${placeRef}; log=${tdActionLog.length}`,
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[td-action] remove: id ${id} not found in tdPlaceActionIds (entry point removal blocked?)`);
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

  // Slice B: NEW badges + first-click dossier interception.
  {
    const hud = getCyberpunkHudController();
    if (hud) {
      const paletteButtonsMap = hud.getPaletteButtons();
      const wave = controller.getCurrentWave();
      for (const type of wave.availableComponents) {
        const cell = paletteButtonsMap.get(type);
        if (!cell) continue;
        cell.classList.toggle(
          "cp-palette-cell--new",
          !dossierStore.hasSeen(type),
        );
      }

      for (const [type, cell] of paletteButtonsMap) {
        // Capture phase so we run BEFORE cyberpunk-hud's own forwarding click.
        cell.addEventListener(
          "click",
          async (e: Event) => {
            if (dossierStore.hasSeen(type)) return;
            if (!(type in DOSSIERS)) {
              // No content authored yet — mark seen silently so we don't block
              // placement indefinitely on a roadmap component.
              dossierStore.markSeen(type);
              cell.classList.remove("cp-palette-cell--new");
              return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            const entry = compRegistry.get(type);
            const rent = entry?.rentPerWave ?? 0;
            await showDossier(type, rent);
            dossierStore.markSeen(type);
            cell.classList.remove("cp-palette-cell--new");
            // Forward manually to the classic palette button so the place-mode
            // state machine kicks in. This mirrors what cyberpunk-hud's normal
            // forwarding would have done.
            const classicBtn = document.querySelector<HTMLButtonElement>(
              `.td-palette-btn[data-type="${type}"]`,
            );
            classicBtn?.click();
          },
          { capture: true },
        );
      }
    }
  }

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

function isTDHash(hash: string): boolean {
  return hash.startsWith("#mode=td");
}

$modeTd.addEventListener("click", () => {
  if (tdDashboard) return; // already in TD mode
  if (!isTDHash(location.hash)) location.hash = "#mode=td";
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

/**
 * Dev-only: wire the "Start at Wave" dropdown in the HUD. Populates from
 * `TD_WAVES` at boot (so it auto-updates whenever a new wave is added
 * to the campaign) and reboots TD mode on selection change.
 */
const $tdWaveStartSelect = document.getElementById(
  "td-dev-wave-select",
) as HTMLSelectElement | null;
if ($tdWaveStartSelect) {
  for (let i = 0; i < TD_WAVES.length; i++) {
    const wave = TD_WAVES[i]!;
    const opt = document.createElement("option");
    opt.value = String(i + 1);
    opt.textContent = `Wave ${wave.id} — ${wave.name}`;
    $tdWaveStartSelect.appendChild(opt);
  }
  const initialWaveIndex = parseTDStartingWaveFromHash();
  $tdWaveStartSelect.value = String(initialWaveIndex + 1);
  $tdWaveStartSelect.addEventListener("change", () => {
    const waveNum = $tdWaveStartSelect.value;
    if (!waveNum) return;
    location.hash = `#mode=td&wave=${waveNum}`;
    if (tdDashboard) {
      teardownTDMode();
    }
    activateTdButton();
    void bootTDMode();
  });
}

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
if (isTDHash(location.hash)) {
  activateTdButton();
  // Fire-and-forget at module load; Pixi v8 init is async.
  void bootTDMode();
} else {
  activateSandboxButton();
  initTopology();
}
