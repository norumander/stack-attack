import type { Component } from "../component/component.js";

export function componentThroughputPerTick(c: Component): number {
  let total = 0;
  let sawProcess = false;
  for (const cap of c.capabilities.values()) {
    if (cap.phase !== "PROCESS") continue;
    sawProcess = true;
    const impl = cap.getThroughputPerTick;
    if (impl == null) return Infinity;
    const tier = c.getPlayerTier(cap.id);
    total += impl.call(cap, tier);
  }
  if (!sawProcess) return Infinity;
  return total * c.instanceCount;
}
