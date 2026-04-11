import type { ChaosEvent } from "../../core/types/chaos.js";
import { zonePairKey } from "../../core/types/zone.js";
import type { SandboxTrafficConfig } from "./sandbox-traffic-source.js";
import type { SandboxModeController } from "./sandbox-mode-controller.js";

export interface SandboxScenario {
  readonly version: 1;
  readonly name: string;
  readonly description: string;
  readonly zones: readonly string[];
  readonly pairLatencies: readonly {
    readonly zoneA: string;
    readonly zoneB: string;
    readonly latency: number;
  }[];
  readonly trafficSources: readonly SandboxTrafficConfig[];
  readonly chaosSchedule: readonly {
    readonly event: ChaosEvent;
    readonly atTick: number;
  }[];
}

/**
 * Export the current sandbox controller state as a serializable scenario.
 * Captures zones, traffic source configs, and chaos schedule.
 * Omits runtime state (economy totals, metrics, request counters).
 */
export function exportScenario(
  name: string,
  description: string,
  controller: SandboxModeController,
): SandboxScenario {
  const zones = controller.getZones();
  const pairLatencyMap = controller.getZonePairLatencies();

  const pairLatencies: { zoneA: string; zoneB: string; latency: number }[] = [];
  for (const [key, latency] of pairLatencyMap) {
    const [zoneA, zoneB] = key.split("|") as [string, string];
    pairLatencies.push({ zoneA, zoneB, latency });
  }

  const trafficSources = controller
    .getTrafficSources()
    .map((source) => source.config);

  const chaosSchedule = [...controller.getChaosQueue()];

  return {
    version: 1,
    name,
    description,
    zones,
    pairLatencies,
    trafficSources,
    chaosSchedule,
  };
}

/**
 * Apply a scenario to a controller, resetting its state to match.
 * Clears existing traffic sources, chaos queue, and zone topology
 * before applying the scenario's configuration.
 */
export function applyScenario(
  scenario: SandboxScenario,
  controller: SandboxModeController,
): void {
  // Clear existing state
  controller.clearTrafficSources();
  controller.clearChaosQueue();

  // Apply zones
  const pairLatencyMap = new Map<string, number>();
  for (const { zoneA, zoneB, latency } of scenario.pairLatencies) {
    pairLatencyMap.set(zonePairKey(zoneA, zoneB), latency);
  }
  controller.setZones(scenario.zones, pairLatencyMap);

  // Apply traffic sources
  for (const config of scenario.trafficSources) {
    controller.addTrafficSource(config);
  }

  // Apply chaos schedule
  for (const { event, atTick } of scenario.chaosSchedule) {
    controller.scheduleChaos(event, atTick);
  }
}

/**
 * Serialize a scenario to a JSON string.
 */
export function serializeScenario(scenario: SandboxScenario): string {
  return JSON.stringify(scenario, null, 2);
}

/**
 * Parse a JSON string into a SandboxScenario.
 * Validates version and basic structure.
 */
export function parseScenario(json: string): SandboxScenario {
  const parsed = JSON.parse(json) as Record<string, unknown>;

  if (parsed.version !== 1) {
    throw new Error(
      `Unsupported scenario version: ${String(parsed.version)} (expected 1)`,
    );
  }

  if (
    !Array.isArray(parsed.zones) ||
    parsed.zones.length === 0
  ) {
    throw new Error("Scenario must have at least one zone");
  }

  if (!Array.isArray(parsed.trafficSources)) {
    throw new Error("Scenario must have a trafficSources array");
  }

  for (const source of parsed.trafficSources as Record<string, unknown>[]) {
    if (!source.targetEntryPointId || !source.requestType || !source.pattern) {
      throw new Error(
        "Each traffic source must have targetEntryPointId, requestType, and pattern",
      );
    }
    if (typeof source.intensity !== "number" || source.intensity < 0) {
      throw new Error("Each traffic source must have a non-negative intensity");
    }
  }

  if (!Array.isArray(parsed.chaosSchedule)) {
    throw new Error("Scenario must have a chaosSchedule array");
  }

  return parsed as unknown as SandboxScenario;
}
