import type { Component } from "../component/component.js";
import type { ComponentId } from "../types/ids.js";

export function computeVisitOrder(
  components: ReadonlyMap<ComponentId, Component>,
): ComponentId[] {
  return [...components.values()]
    .slice()
    .sort((a, b) => {
      const za = a.zone ?? "";
      const zb = b.zone ?? "";
      if (za !== zb) return za < zb ? -1 : 1;
      if (a.placementTick !== b.placementTick)
        return a.placementTick - b.placementTick;
      return (a.id as string) < (b.id as string) ? -1 : 1;
    })
    .map((c) => c.id);
}
