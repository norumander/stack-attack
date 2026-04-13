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
  longDescription:
    "A Server accepts requests from clients, processes them, and returns responses. " +
    "It can also forward writes to a downstream database. Without a database wired in, " +
    "write requests have nowhere to land and get dropped. Throughput is capped per tick — " +
    "under sustained load beyond that cap the server sheds traffic rather than queue it.",
  capabilitiesHuman: [
    "Processes API reads directly (returns a response)",
    "Forwards writes to a downstream database",
    "Emits health metrics each tick",
    "Throughput: 20 reads + 12 write-forwards per tick at tier 1",
  ],
  capabilities: [
    { id: "processing" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
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
  longDescription:
    "A Database accepts write requests from servers and stores them durably. It has its " +
    "own throughput budget independent of the servers in front of it, so adding a database " +
    "relieves write pressure on servers. Databases don't forward anywhere — they're a terminal " +
    "sink for writes in your pipeline.",
  capabilitiesHuman: [
    "Stores writes durably (responds to write requests)",
    "Higher write throughput than a server (25/tick at tier 1)",
    "Emits health metrics each tick",
  ],
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
  longDescription:
    "A Cache intercepts reads before they reach your server. If the cache has seen the same " +
    "read recently (a 'hit'), it responds immediately — no load on your server. If it hasn't " +
    "(a 'miss'), it forwards the request downstream and remembers the response for next time. " +
    "Caches help most when reads repeat; they help least when every read is unique.",
  capabilitiesHuman: [
    "Responds directly on cache hit (fast path)",
    "Forwards misses to downstream server",
    "Absorbs repeated reads — effective when traffic has hot keys",
    "Does not help write traffic",
  ],
  capabilities: [
    { id: "caching" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 3 },
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
  longDescription:
    "A Load Balancer sits in front of multiple servers and splits incoming traffic across " +
    "them. It has no throughput cap of its own — the bottleneck moves to whichever server " +
    "is slowest. Useful when one server isn't enough but you don't want to cache. Only works " +
    "if you actually connect multiple servers behind it.",
  capabilitiesHuman: [
    "Distributes requests across connected downstream targets",
    "Picks healthier servers first (condition-weighted)",
    "Falls back to round-robin when all targets are saturated",
    "Unbounded throughput (bottleneck is downstream)",
  ],
  capabilities: [
    { id: "routing" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 3 },
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
  longDescription:
    "The Client is the entry point for all user traffic. Traffic injection lands here; " +
    "the Client then forwards each request to whatever it's connected to. A Client " +
    "with no outbound connection silently drops all traffic.",
  capabilitiesHuman: [
    "Entry point for user traffic",
    "Forwards all requests to connected downstream components",
    "No internal processing — pass-through only",
  ],
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
