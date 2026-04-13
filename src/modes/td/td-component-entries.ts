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

export const CACHE_ENTRY: ComponentRegistryEntry = {
  type: "cache",
  name: "Cache",
  description: "Remembers recent responses so your database doesn't get hammered twice.",
  capabilities: [
    { id: "caching" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 1, connections: [] },
  ],
  placementCost: 150,
  upgradeCostCurve: [150, 300, 600],
  visual: { icon: "cache", color: "#F5A623", shape: "diamond" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

export const LOAD_BALANCER_ENTRY: ComponentRegistryEntry = {
  type: "load_balancer",
  name: "Load Balancer",
  description: "Splits traffic across multiple servers so no single one gets overwhelmed.",
  capabilities: [
    { id: "routing" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 1, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 4, connections: [] },
  ],
  placementCost: 175,
  upgradeCostCurve: [175, 350, 700],
  visual: { icon: "load-balancer", color: "#50C878", shape: "hexagon" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

export const CLIENT_ENTRY: ComponentRegistryEntry = {
  type: "client",
  name: "Client",
  description: "Traffic entry point. Forwards requests into the architecture.",
  capabilities: [
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 1 },
  ],
  ports: [
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 4, connections: [] },
  ],
  placementCost: 0,
  upgradeCostCurve: [0],
  visual: { icon: "client", color: "#94a3b8", shape: "circle" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};
