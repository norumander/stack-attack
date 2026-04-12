import { TOPOLOGIES, type TopologyInfo } from "./topologies";
import { SimLoop } from "./sim-loop";
import { exportScenario, applyScenario, serializeScenario, parseScenario } from "@modes/sandbox/sandbox-scenario";
import type { ComponentId, ConnectionId } from "@core/types/ids";
import type { TickMetrics } from "@core/types/metrics";
import type { MetricsSnapshot } from "@modes/sandbox/sandbox-mode-controller";

declare const Chart: any;

// ─── State ────────────────────────────────────────────────────────────
let topo: TopologyInfo;
let simLoop: SimLoop;

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

  simLoop = new SimLoop(topo.engine, topo.state, topo.controller);
  simLoop.tickInterval = parseInt($speedSlider.value);
  simLoop.onTick = onTick;

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
      applyScenario(scenario, topo.controller);
      // Re-add traffic from scenario (applyScenario already does this)
      topo.controller.advancePhase(); // ensure simulate phase
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

// ─── Boot ─────────────────────────────────────────────────────────────
populateSelects();
initTopology();
