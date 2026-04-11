import type { Component } from "../component/component.js";
import type { ConditionEffect } from "../types/condition.js";

/**
 * Tier selection (exact, in order):
 *   if (condition <= criticalThreshold)  return criticalEffects;
 *   if (condition <= degradedThreshold)  return degradedEffects;
 *   return [];
 *
 * Higher condition = healthier. Exactly-at-threshold is the lower tier.
 */
export function getActiveConditionEffects(
  component: Component,
): readonly ConditionEffect[] {
  const { condition, conditionProfile: profile } = component;
  if (condition <= profile.criticalThreshold) return profile.criticalEffects;
  if (condition <= profile.degradedThreshold) return profile.degradedEffects;
  return [];
}

export function getUpkeepMultiplier(component: Component): number {
  let product = 1;
  for (const e of getActiveConditionEffects(component)) {
    if (e.kind === "upkeep_multiplier") product *= e.factor;
  }
  return product;
}

export function getThroughputMultiplier(component: Component): number {
  let product = 1;
  for (const e of getActiveConditionEffects(component)) {
    if (e.kind === "throughput_multiplier") product *= e.factor;
  }
  return product;
}

export function getDropProbability(component: Component): number {
  let sum = 0;
  for (const e of getActiveConditionEffects(component)) {
    if (e.kind === "drop_probability") sum += e.p;
  }
  return sum > 1 ? 1 : sum;
}

export function getLatencyMultiplier(component: Component): number {
  let product = 1;
  for (const e of getActiveConditionEffects(component)) {
    if (e.kind === "latency_multiplier") product *= e.factor;
  }
  return product;
}
