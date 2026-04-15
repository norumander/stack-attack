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

const RESILIENT_CONDITION_PROFILE: ConditionProfile = {
  degradedThreshold: 0.5,
  criticalThreshold: 0.2,
  decayRate: 0.03,
  recoveryRate: 0.03,
  degradedEffects: [
    { kind: "latency_multiplier", factor: 1.3 },
  ],
  criticalEffects: [
    { kind: "drop_probability", p: 0.15 },
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

export const CDN_ENTRY: ComponentRegistryEntry = {
  type: "cdn",
  name: "CDN",
  description:
    "Edge cache for static assets. Absorbs static_asset volume so Servers can focus on API work.",
  longDescription:
    "A CDN sits at the edge and caches static_asset responses. The first request " +
    "for an asset misses and forwards downstream; every subsequent request for the " +
    "same asset is served from the CDN's cache without ever touching your Servers. " +
    "CDNs help most when traffic has hot static assets; they help least when every " +
    "static request is unique.",
  capabilitiesHuman: [
    "Caches static_asset responses at the edge",
    "Serves cache hits directly (fast path, no Server load)",
    "Forwards misses downstream to populate the cache",
    "Low upkeep — runs cheap once placed",
  ],
  capabilities: [
    { id: "caching" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 2, connections: [] },
  ],
  placementCost: 200,
  upgradeCostCurve: [200, 400],
  visual: { icon: "cdn", color: "#10b981", shape: "pentagon" },
  conditionProfile: RESILIENT_CONDITION_PROFILE,
};

export const API_GATEWAY_ENTRY: ComponentRegistryEntry = {
  type: "api_gateway",
  name: "API Gateway",
  description:
    "Edge auth handler. Validates auth_required requests upstream so Servers don't have to.",
  longDescription:
    "An API Gateway sits in front of your Servers and handles authentication for " +
    "auth_required requests at the edge. AuthCapability runs in the INTERCEPT phase " +
    "and adds only 1 tick of latency, vs. 5 ticks if a Server has to handle it. " +
    "Once authenticated, the request is terminated at the Gateway.",
  capabilitiesHuman: [
    "Validates auth_required requests at the edge",
    "Adds only 1 tick of auth latency (vs. 5 on a Server)",
    "Terminates authenticated requests at the Gateway",
    "Other request types pass through unchanged",
  ],
  capabilities: [
    { id: "auth" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 2, connections: [] },
  ],
  placementCost: 250,
  upgradeCostCurve: [250, 500],
  visual: { icon: "api-gateway", color: "#ec4899", shape: "trapezoid" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

export const QUEUE_ENTRY: ComponentRegistryEntry = {
  type: "queue",
  name: "Queue",
  description:
    "Buffers batch requests so your API servers stay responsive. Trades latency for throughput.",
  longDescription:
    "A Queue sits between your API path and async Workers. Batch requests are buffered " +
    "in the Queue instead of blocking Server processing slots. Workers pull from the " +
    "Queue independently, processing jobs without affecting API response times.",
  capabilitiesHuman: [
    "Buffers batch requests in a FIFO queue (32 slots at tier 1)",
    "Prevents batch jobs from blocking synchronous API traffic",
    "Workers pull from the Queue to process async",
  ],
  capabilities: [
    { id: "queue" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "any", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "any", capacity: 2, connections: [] },
  ],
  placementCost: 125,
  upgradeCostCurve: [125, 250, 500],
  visual: { icon: "queue", color: "#f97316", shape: "rectangle" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

export const WORKER_ENTRY: ComponentRegistryEntry = {
  type: "worker",
  name: "Worker",
  description:
    "Async batch processor. Pulls jobs from a Queue without blocking your API servers.",
  longDescription:
    "A Worker pulls batch jobs from a connected Queue and processes them independently. " +
    "At tier 1, it processes 5 batch jobs per tick. Workers scale separately from " +
    "your API Servers — add more Workers for heavier batch loads without affecting API latency.",
  capabilitiesHuman: [
    "Processes batch requests (5/tick at tier 1)",
    "Pulls from connected Queue component",
    "Operates independently of synchronous API traffic",
  ],
  capabilities: [
    { id: "batch-processing" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "any", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "data", capacity: 1, connections: [] },
  ],
  placementCost: 125,
  upgradeCostCurve: [125, 250, 500],
  visual: { icon: "worker", color: "#eab308", shape: "rectangle" },
  conditionProfile: DEFAULT_CONDITION_PROFILE,
};

export const CIRCUIT_BREAKER_ENTRY: ComponentRegistryEntry = {
  type: "circuit_breaker",
  name: "Circuit Breaker",
  description:
    "Stops traffic to failing servers. Prevents one failure from crashing your entire system.",
  longDescription:
    "A Circuit Breaker sits between your Load Balancer and each Server. When a Server " +
    "fails, the Circuit Breaker detects consecutive failures, opens the circuit, and " +
    "stops routing traffic to the dead server. Traffic reroutes to healthy servers. " +
    "When the server recovers, the circuit half-opens and probes with single requests.",
  capabilitiesHuman: [
    "CLOSED: passes all traffic through normally",
    "OPEN: fast-fails traffic to prevent cascade (after 5 failures)",
    "HALF_OPEN: probes recovery with single requests",
    "Cooldown: 10 ticks at tier 1, 3 ticks at tier 3",
  ],
  capabilities: [
    { id: "circuit-breaker" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "any", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "any", capacity: 1, connections: [] },
  ],
  placementCost: 100,
  upgradeCostCurve: [100, 200, 400],
  visual: { icon: "circuit-breaker", color: "#ef4444", shape: "octagon" },
  conditionProfile: RESILIENT_CONDITION_PROFILE,
};

export const STREAMING_SERVER_ENTRY: ComponentRegistryEntry = {
  type: "streaming_media_server",
  name: "Streaming Server",
  description: "Handles sustained streaming sessions and forwards non-stream traffic.",
  longDescription:
    "A specialized server that processes streaming requests (video, audio) while " +
    "forwarding all other traffic types downstream. Isolates bandwidth-heavy streams " +
    "from the API tier so they don't starve regular requests.",
  capabilitiesHuman: [
    "Processes stream requests with adaptive delivery",
    "Forwards non-stream traffic to downstream components",
    "Monitors throughput and health",
  ],
  capabilities: [
    { id: "streaming" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "data", capacity: 2, connections: [] },
  ],
  placementCost: 300,
  upgradeCostCurve: [300, 600],
  visual: { icon: "streaming", color: "#e11d48", shape: "rectangle" },
  conditionProfile: RESILIENT_CONDITION_PROFILE,
};

export const BLOB_STORAGE_ENTRY: ComponentRegistryEntry = {
  type: "blob_storage",
  name: "Blob Storage",
  description: "Stores unstructured assets like videos, images, and files.",
  longDescription:
    "High-capacity storage for large binary objects. Cheap per-byte but higher latency " +
    "than in-memory caches. Backs the Streaming Server with video content.",
  capabilitiesHuman: [
    "Stores and serves large binary assets",
    "Monitors throughput and health",
  ],
  capabilities: [
    { id: "blob-storage" as CapabilityId, defaultTier: 1, maxTier: 3 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "data", capacity: 2, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "data", capacity: 1, connections: [] },
  ],
  placementCost: 250,
  upgradeCostCurve: [250, 500],
  visual: { icon: "blob-storage", color: "#64748b", shape: "rectangle" },
  conditionProfile: RESILIENT_CONDITION_PROFILE,
};

export const DNS_GTM_ENTRY: ComponentRegistryEntry = {
  type: "dns_gtm",
  name: "DNS / GTM",
  description: "Routes requests to the nearest healthy zone.",
  longDescription:
    "A global traffic manager that inspects request origin zones and routes each " +
    "request to the nearest datacenter. Eliminates cross-zone latency penalties by " +
    "ensuring requests are served locally.",
  capabilitiesHuman: [
    "Routes requests to nearest zone",
    "Forwards all traffic types at high throughput",
    "Monitors throughput and health",
  ],
  capabilities: [
    { id: "geo-routing" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "forwarding-pipe" as CapabilityId, defaultTier: 1, maxTier: 2 },
    { id: "monitoring" as CapabilityId, defaultTier: 1, maxTier: 2 },
  ],
  ports: [
    { id: "p-in" as PortId, direction: "ingress", dataType: "http", capacity: 4, connections: [] },
    { id: "p-out" as PortId, direction: "egress", dataType: "http", capacity: 4, connections: [] },
  ],
  placementCost: 300,
  upgradeCostCurve: [300, 600],
  visual: { icon: "dns", color: "#14b8a6", shape: "globe" },
  conditionProfile: RESILIENT_CONDITION_PROFILE,
};
