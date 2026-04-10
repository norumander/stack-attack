import type { CapabilityId, ComponentId } from "../types/ids.js";
import type { Port } from "../types/port.js";
import type { Position } from "../types/position.js";
import type { ConditionProfile } from "../types/condition.js";
import type { Capability } from "../capability/capability.js";
import { Component } from "../component/component.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import {
  isEngineConsultable,
  isEngineBufferable,
  isEnginePullable,
  isInstanceDirectory,
} from "../capability/engine-interfaces.js";

export interface ComponentRegistryEntry {
  type: string;
  name: string;
  description: string;
  capabilities: Array<{
    id: CapabilityId;
    defaultTier: number;
    maxTier: number;
  }>;
  ports: Port[];
  placementCost: number;
  upgradeCostCurve: number[];
  visual: { icon: string; color: string; shape: string };
  conditionProfile: ConditionProfile;
}

let idCounter = 0;
function nextId(type: string): ComponentId {
  idCounter += 1;
  return `${type}-${idCounter}` as ComponentId;
}

export class ComponentRegistry {
  private readonly entries = new Map<string, ComponentRegistryEntry>();

  constructor(private readonly capabilityRegistry: CapabilityRegistry) {}

  register(entry: ComponentRegistryEntry): void {
    if (this.entries.has(entry.type)) {
      throw new Error(`Component type ${entry.type} already registered`);
    }
    this.entries.set(entry.type, entry);
  }

  get(type: string): ComponentRegistryEntry | undefined {
    return this.entries.get(type);
  }

  list(): ComponentRegistryEntry[] {
    return [...this.entries.values()];
  }

  validate(): void {
    for (const entry of this.entries.values()) {
      for (const capRef of entry.capabilities) {
        const capEntry = this.capabilityRegistry.get(capRef.id);
        if (!capEntry) {
          throw new Error(
            `Component ${entry.type} references unknown capability ${capRef.id}`,
          );
        }
        const cap = capEntry.factory();
        const hasPhase = typeof cap.phase === "string";
        const hasSubInterface =
          isEngineConsultable(cap) ||
          isEngineBufferable(cap) ||
          isEnginePullable(cap) ||
          isInstanceDirectory(cap);
        if (!hasPhase && !hasSubInterface) {
          throw new Error(
            `Capability ${capRef.id} (used by ${entry.type}) has neither a phase nor a sub-interface`,
          );
        }
      }
    }
  }

  create(type: string, position: Position, zone: string | null): Component {
    const entry = this.entries.get(type);
    if (!entry) throw new Error(`Unknown component type ${type}`);
    const caps = new Map<CapabilityId, Capability>();
    const tiers = new Map<CapabilityId, number>();
    for (const capRef of entry.capabilities) {
      const capEntry = this.capabilityRegistry.get(capRef.id);
      if (!capEntry) {
        throw new Error(`Capability ${capRef.id} not in registry`);
      }
      caps.set(capRef.id, capEntry.factory());
      tiers.set(capRef.id, capRef.defaultTier);
    }
    return new Component({
      id: nextId(type),
      type: entry.type,
      name: entry.name,
      description: entry.description,
      capabilities: caps,
      initialTiers: tiers,
      ports: entry.ports.map((p) => ({ ...p, connections: [...p.connections] })),
      placementCost: entry.placementCost,
      position,
      zone,
      placementTick: 0,
      conditionProfile: entry.conditionProfile,
    });
  }
}
