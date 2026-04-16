/**
 * @deprecated Slice B (2026-04-16) — the cyberpunk HUD renders the briefing
 * directly via `renderBriefing` + `CyberpunkHudController.updateBriefing`.
 * This module is only used by the classic (non-iso) TD path, which now
 * redirects to iso at boot. Kept compiling so sandbox mode and any
 * programmatic callers still work; slated for removal in a Slice C cleanup.
 */
import type { TDWaveDefinition } from "@modes/td/td-waves.js";
import {
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  DATA_CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
  CDN_ENTRY,
  API_GATEWAY_ENTRY,
} from "@modes/td/td-component-entries.js";
import type { ComponentRegistryEntry } from "@core/registry/component-registry.js";

const REQUEST_TYPE_LABELS: Record<string, string> = {
  api_read: "read",
  api_write: "write",
  static_asset: "static",
  auth_required: "auth",
  batch: "batch",
  event: "event",
  stream: "stream",
};

function labelForType(type: string): string {
  return REQUEST_TYPE_LABELS[type] ?? type.replace("api_", "");
}

const ENTRY_BY_TYPE: Record<string, ComponentRegistryEntry> = {
  client: CLIENT_ENTRY,
  server: SERVER_ENTRY,
  database: DATABASE_ENTRY,
  data_cache: DATA_CACHE_ENTRY,
  load_balancer: LOAD_BALANCER_ENTRY,
  cdn: CDN_ENTRY,
  api_gateway: API_GATEWAY_ENTRY,
};

export function renderBriefingCard(wave: TDWaveDefinition): void {
  const root = document.getElementById("td-briefing");
  const titleEl = document.getElementById("td-briefing-title");
  const trafficEl = document.getElementById("td-briefing-traffic");
  const budgetEl = document.getElementById("td-briefing-budget");
  const thresholdEl = document.getElementById("td-briefing-threshold");
  const componentsEl = document.getElementById("td-briefing-components");
  if (!root || !titleEl || !trafficEl || !budgetEl || !thresholdEl || !componentsEl) return;

  titleEl.textContent = `Wave ${wave.id} — ${wave.name}`;

  const compBits: string[] = [];
  for (const [type, weight] of wave.composition) {
    compBits.push(`${Math.round(weight * 100)}% ${labelForType(type)}`);
  }
  trafficEl.textContent = `${wave.intensity} req/tick · ${compBits.join(", ")} · TTL ${wave.ttl} · ${wave.duration} ticks`;

  const revenueBits: string[] = [];
  for (const [type, rev] of wave.revenuePerRequestType) {
    revenueBits.push(`$${rev}/${labelForType(type)}`);
  }
  budgetEl.textContent = `$${wave.startingBudget} starting · ${revenueBits.join(", ")}`;

  if (wave.sla) {
    thresholdEl.textContent =
      `Availability ≥ ${Math.round(wave.sla.availabilityTarget * 100)}% · ` +
      `avg latency ≤ ${wave.sla.maxAvgLatency} · ` +
      `−$${wave.sla.penaltyPerTick}/tick while failing`;
  } else {
    thresholdEl.textContent = `Drop rate < ${Math.round(wave.dropThreshold * 100)}%`;
  }

  const componentNames = wave.availableComponents
    .map((t) => ENTRY_BY_TYPE[t]?.name ?? t)
    .join(" · ");
  componentsEl.textContent = componentNames;

  root.hidden = false;
}

export function hideBriefingCard(): void {
  const root = document.getElementById("td-briefing");
  if (root) root.hidden = true;
}
