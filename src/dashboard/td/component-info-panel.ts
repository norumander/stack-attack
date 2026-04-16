import type { ComponentId } from "@core/types/ids.js";
import type { SimulationState } from "@core/state/simulation-state.js";
import type { TickMetrics } from "@core/types/metrics.js";
import type { ComponentRegistryEntry } from "@core/registry/component-registry.js";
import { componentThroughputPerTick } from "@core/engine/throughput.js";
import {
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  DATA_CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
} from "@modes/td/td-component-entries.js";

const ENTRY_BY_TYPE: Record<string, ComponentRegistryEntry> = {
  client: CLIENT_ENTRY,
  server: SERVER_ENTRY,
  database: DATABASE_ENTRY,
  data_cache: DATA_CACHE_ENTRY,
  load_balancer: LOAD_BALANCER_ENTRY,
};

function clearChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function showComponentInfoPanel(
  id: ComponentId,
  state: SimulationState,
): void {
  const root = document.getElementById("td-info-panel");
  const header = document.getElementById("td-info-panel-header");
  const description = document.getElementById("td-info-panel-description");
  const capsEl = document.getElementById("td-info-panel-caps") as HTMLUListElement | null;
  if (!root || !header || !description || !capsEl) return;

  const comp = state.components.get(id);
  if (!comp) return;
  const entry = ENTRY_BY_TYPE[comp.type];

  header.textContent = entry?.name ?? comp.type;
  description.textContent = entry?.longDescription ?? comp.description ?? "";

  clearChildren(capsEl);
  const bullets = entry?.capabilitiesHuman ?? [];
  for (const bullet of bullets) {
    const li = document.createElement("li");
    li.textContent = bullet;
    capsEl.appendChild(li);
  }

  root.dataset["componentId"] = id;
  root.hidden = false;

  // Seed the stats panel with the latest snapshot if available.
  const last = state.metricsHistory[state.metricsHistory.length - 1];
  updateComponentInfoPanelStats(id, state, last ?? null);
}

export function hideComponentInfoPanel(): void {
  const root = document.getElementById("td-info-panel");
  if (!root) return;
  root.hidden = true;
  delete root.dataset["componentId"];
}

export function getOpenInfoPanelComponentId(): ComponentId | null {
  const root = document.getElementById("td-info-panel");
  if (!root || root.hidden) return null;
  const raw = root.dataset["componentId"];
  return raw ? (raw as ComponentId) : null;
}

export function updateComponentInfoPanelStats(
  id: ComponentId,
  state: SimulationState,
  metrics: TickMetrics | null,
): void {
  const statsEl = document.getElementById("td-info-panel-stats");
  if (!statsEl) return;

  const comp = state.components.get(id);
  if (!comp) {
    clearChildren(statsEl);
    return;
  }

  clearChildren(statsEl);

  const throughput = componentThroughputPerTick(comp);
  const m = metrics?.perComponent.get(id) ?? null;
  const processed = m?.processed ?? 0;
  const dropped = m?.dropped ?? 0;
  const overloaded = m?.overloaded ?? 0;
  const pending = m?.pendingAtEndOfTick ?? 0;
  const condition = m?.condition ?? comp.condition;
  const utilization = throughput > 0 ? Math.round((processed / throughput) * 100) : 0;

  const rows: Array<[string, string]> = [
    ["Tier", String(comp.instanceCount)],
    ["Throughput cap", throughput > 0 ? `${throughput}/tick` : "unbounded"],
    ["Processed last tick", String(processed)],
    ["Utilization last tick", throughput > 0 ? `${Math.min(100, utilization)}%` : "—"],
    ["Pending", String(pending)],
    ["Dropped last tick", String(dropped)],
    ["Overloaded last tick", String(overloaded)],
    ["Condition", `${Math.round(condition * 100)}%`],
  ];

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "td-info-panel__stat-row";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    statsEl.appendChild(row);
  }
}
