import type { ComponentRegistryEntry } from "@core/registry/component-registry.js";
import type { CapabilityId, PortId } from "@core/types/ids.js";
import type { ConditionProfile } from "@core/types/condition.js";

const DEFAULT_CONDITION_PROFILE: ConditionProfile = {
  degradedThreshold: 0.7,
  criticalThreshold: 0.3,
  decayRate: 0.05,
  recoveryRate: 0.02,
  degradedEffects: [
    { kind: "latency_multiplier", factor: 1.5 },
  ],
  criticalEffects: [
    { kind: "drop_probability", p: 0.2 },
  ],
};

export const SERVER_ENTRY: ComponentRegistryEntry = {
  type: "server",
  name: "Server",
  description: "Handles incoming requests. The workhorse of your architecture.",
  capabilities: [
    { id: "processing" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 1, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "data", capacity: 2, connections: [] },
  ],
  placementCost: 100,
  upgradeCostCurve: [100, 200, 400],
  visual: { icon: "server", color: "#4A90D9", shape: "rectangle" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

export const DATABASE_ENTRY: ComponentRegistryEntry = {
  type: "database",
  name: "Database",
  description: "Persists data so your servers don't have to remember everything.",
  capabilities: [
    { id: "storage" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "data", capacity: 3, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "data", capacity: 2, connections: [] },
  ],
  placementCost: 200,
  upgradeCostCurve: [200, 400, 800],
  visual: { icon: "database", color: "#7B68EE", shape: "cylinder" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

// Added in later slices:
// export const CACHE_ENTRY: ComponentRegistryEntry = ...;
// export const LOAD_BALANCER_ENTRY: ComponentRegistryEntry = ...;
