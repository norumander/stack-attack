# Stage 4a: Wave 8 — Streaming Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Wave 8 ("Video Launch") — streaming traffic isolation via inline Streaming Media Server + Blob Storage, with TDTrafficSource stream field population and win/lose integration tests.

**Architecture:** No engine changes. TDTrafficSource populates `streamDuration`/`streamBandwidth` from `wave.streamConfig` for `stream`-type requests. The engine's existing active-stream lifecycle (deliver-staged registration, per-tick bandwidth reservation, isWaveDrained drain check) handles everything. TD entries for Streaming Server (inline filter with forwarding-pipe) and Blob Storage (decorative) added to the TD bundle. `runWave` helper extended to drain active streams past wave duration.

**Tech Stack:** TypeScript, Vitest, existing `@core/`, `@modes/td/`, `@capabilities/`, `@harness/` modules.

---

### Task 1: TDTrafficSource — populate stream fields

**Files:**
- Modify: `src/modes/td/td-traffic-source.ts` (generate method, ~line 76-77)
- Test: `tests/unit/td-traffic-source-stream-fields.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/td-traffic-source-stream-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TDTrafficSource } from "@modes/td/td-traffic-source";
import type { TDWaveDefinition } from "@modes/td/td-waves";
import type { ComponentId } from "@core/types/ids";

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const STREAM_WAVE: TDWaveDefinition = {
  id: 99,
  name: "Stream Test",
  startingBudget: 1000,
  intensity: 10,
  composition: new Map([["stream", 1.0]]),
  duration: 5,
  ttl: 10,
  availableComponents: ["server"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["stream", 8]]),
  keyPoolSize: 10,
  connectionBandwidth: 100,
  streamConfig: { duration: 20, bandwidth: 3 },
  sla: { availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 5 },
};

const NO_STREAM_WAVE: TDWaveDefinition = {
  id: 98,
  name: "No Stream Test",
  startingBudget: 1000,
  intensity: 10,
  composition: new Map([["api_read", 1.0]]),
  duration: 5,
  ttl: 10,
  availableComponents: ["server"],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([["api_read", 1]]),
  keyPoolSize: 10,
  connectionBandwidth: 100,
  sla: { availabilityTarget: 0.90, maxAvgLatency: 10, minBudget: 0, penaltyPerTick: 5 },
};

describe("TDTrafficSource stream field population", () => {
  it("populates streamDuration and streamBandwidth for stream-type requests when streamConfig exists", () => {
    const source = new TDTrafficSource({
      wave: STREAM_WAVE,
      targetEntryPointId: "client" as ComponentId,
      rng: makeRng(1),
    });
    const requests = source.generate(0);
    expect(requests.length).toBe(10);
    for (const req of requests) {
      expect(req.type).toBe("stream");
      expect(req.streamDuration).toBe(20);
      expect(req.streamBandwidth).toBe(3);
    }
  });

  it("leaves streamDuration and streamBandwidth null for non-stream requests", () => {
    const source = new TDTrafficSource({
      wave: NO_STREAM_WAVE,
      targetEntryPointId: "client" as ComponentId,
      rng: makeRng(1),
    });
    const requests = source.generate(0);
    expect(requests.length).toBe(10);
    for (const req of requests) {
      expect(req.type).toBe("api_read");
      expect(req.streamDuration).toBeNull();
      expect(req.streamBandwidth).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/td-traffic-source-stream-fields.test.ts`
Expected: FAIL — `streamDuration` is `null` for stream requests (current code hardcodes null).

- [ ] **Step 3: Implement stream field population**

In `src/modes/td/td-traffic-source.ts`, find the `generate()` method. Replace the two null lines (~lines 76-77):

```ts
        streamDuration: null,
        streamBandwidth: null,
```

With:

```ts
        streamDuration:
          tickType === "stream" && this.wave.streamConfig
            ? this.wave.streamConfig.duration
            : null,
        streamBandwidth:
          tickType === "stream" && this.wave.streamConfig
            ? this.wave.streamConfig.bandwidth
            : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/td-traffic-source-stream-fields.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full suite for regressions**

Run: `pnpm test`
Expected: All pass. Waves 1–7 have no `streamConfig` and no `stream` in composition, so the null fallback keeps existing behavior identical.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-traffic-source.ts tests/unit/td-traffic-source-stream-fields.test.ts
git commit -m "feat(td): TDTrafficSource populates streamDuration/streamBandwidth from wave.streamConfig"
```

---

### Task 2: TD component entries — Streaming Server + Blob Storage

**Files:**
- Modify: `src/modes/td/td-component-entries.ts` (add two new entry constants)

- [ ] **Step 1: Add STREAMING_SERVER_ENTRY**

In `src/modes/td/td-component-entries.ts`, after `CIRCUIT_BREAKER_ENTRY` (ends around line 323), add:

```ts
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
```

- [ ] **Step 2: Add BLOB_STORAGE_ENTRY**

After STREAMING_SERVER_ENTRY, add:

```ts
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
```

- [ ] **Step 3: Verify imports**

Ensure `CapabilityId` and `PortId` are imported at the top of the file (they should already be — check existing entry patterns). Also ensure `ComponentRegistryEntry` is imported.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: Clean. The entries are defined but not yet registered — they'll be wired in Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/modes/td/td-component-entries.ts
git commit -m "feat(td): TD_STREAMING_SERVER_ENTRY and TD_BLOB_STORAGE_ENTRY"
```

---

### Task 3: Wire capability factories and component entries in registerTDDefaults

**Files:**
- Modify: `src/modes/td/register-td-defaults.ts`

- [ ] **Step 1: Add imports**

At the top of `src/modes/td/register-td-defaults.ts`, add:

```ts
import { StreamingCapability } from "@capabilities/streaming/streaming-capability.js";
import { BlobStorageCapability } from "@capabilities/blob-storage/blob-storage-capability.js";
```

And add the new entry imports alongside existing ones:

```ts
import { STREAMING_SERVER_ENTRY, BLOB_STORAGE_ENTRY } from "./td-component-entries.js";
```

- [ ] **Step 2: Register capability factories**

In the `registerTDDefaults` function, after the circuit-breaker registration (around line 137), add:

```ts
  capRegistry.register({
    id: "streaming" as CapabilityId,
    factory: () => new StreamingCapability("streaming" as CapabilityId),
  });
  capRegistry.register({
    id: "blob-storage" as CapabilityId,
    factory: () => new BlobStorageCapability("blob-storage" as CapabilityId),
  });
```

- [ ] **Step 3: Register component entries**

In the component registration section (around line 148), add:

```ts
  compRegistry.register(STREAMING_SERVER_ENTRY);
  compRegistry.register(BLOB_STORAGE_ENTRY);
```

- [ ] **Step 4: Verify registration works**

Run: `pnpm test tests/integration/td/wave-1-launch-day.test.ts`
Expected: PASS — existing waves unaffected by new registrations.

- [ ] **Step 5: Run full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All pass, clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/register-td-defaults.ts
git commit -m "feat(td): wire streaming + blob-storage factories and entries in registerTDDefaults"
```

---

### Task 4: WAVE_8 definition

**Files:**
- Modify: `src/modes/td/td-waves.ts` (add WAVE_8 after WAVE_7)
- Create: `tests/unit/wave-8-definition.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/wave-8-definition.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WAVE_8 } from "@modes/td/td-waves";

describe("WAVE_8 — Video Launch", () => {
  it("has correct id, name, and starting budget", () => {
    expect(WAVE_8.id).toBe(8);
    expect(WAVE_8.name).toBe("Video Launch");
    expect(WAVE_8.startingBudget).toBe(1500);
  });

  it("composition includes stream at 0.30", () => {
    expect(WAVE_8.composition.get("stream")).toBeCloseTo(0.30);
    expect(WAVE_8.composition.get("api_read")).toBeCloseTo(0.20);
    expect(WAVE_8.composition.get("batch")).toBeCloseTo(0.15);
  });

  it("includes streaming_media_server and blob_storage in availableComponents", () => {
    expect(WAVE_8.availableComponents).toContain("streaming_media_server");
    expect(WAVE_8.availableComponents).toContain("blob_storage");
  });

  it("has streamConfig with duration 20 and bandwidth 3", () => {
    expect(WAVE_8.streamConfig).toBeDefined();
    expect(WAVE_8.streamConfig!.duration).toBe(20);
    expect(WAVE_8.streamConfig!.bandwidth).toBe(3);
  });

  it("revenue table includes stream at 8", () => {
    expect(WAVE_8.revenuePerRequestType.get("stream")).toBe(8);
  });

  it("intensity is 500 and duration is 40", () => {
    expect(WAVE_8.intensity).toBe(500);
    expect(WAVE_8.duration).toBe(40);
  });

  it("SLA targets 92% availability", () => {
    expect(WAVE_8.sla.availabilityTarget).toBeCloseTo(0.92);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/wave-8-definition.test.ts`
Expected: FAIL — `WAVE_8` is not exported from `td-waves.ts`.

- [ ] **Step 3: Add WAVE_8 definition**

In `src/modes/td/td-waves.ts`, after the WAVE_7 definition, add:

```ts
export const WAVE_8: TDWaveDefinition = {
  id: 8,
  name: "Video Launch",
  startingBudget: 1500,
  intensity: 500,
  composition: new Map([
    ["api_read", 0.20],
    ["api_write", 0.10],
    ["static_asset", 0.15],
    ["auth_required", 0.10],
    ["batch", 0.15],
    ["stream", 0.30],
  ]),
  duration: 40,
  ttl: 15,
  availableComponents: [
    "server", "database", "cache", "load_balancer", "cdn", "api_gateway",
    "queue", "worker", "circuit_breaker", "streaming_media_server", "blob_storage",
  ],
  dropThreshold: 0.05,
  revenuePerRequestType: new Map([
    ["api_read", 1],
    ["api_write", 2],
    ["static_asset", 0.3],
    ["auth_required", 1.5],
    ["batch", 5],
    ["stream", 8],
  ]),
  keyPoolSize: 15,
  connectionBandwidth: 700,
  streamConfig: {
    duration: 20,
    bandwidth: 3,
  },
  sla: {
    availabilityTarget: 0.92,
    maxAvgLatency: 8,
    minBudget: 0,
    penaltyPerTick: 7,
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/wave-8-definition.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/modes/td/td-waves.ts tests/unit/wave-8-definition.test.ts
git commit -m "feat(td): WAVE_8 definition — Video Launch with streamConfig"
```

---

### Task 5: Extend runWave helper to drain active streams

**Files:**
- Modify: `tests/integration/td/helpers.ts` (runWave function)

The current `runWave` ticks for exactly `wave.duration` ticks. Stream requests persist past wave duration (20-tick streams created at tick 39 last until tick 59). The engine's `isWaveDrained()` checks `state.activeStreams.size > 0`. We need to keep ticking until all streams complete.

- [ ] **Step 1: Extend runWave with drain loop**

In `tests/integration/td/helpers.ts`, find the tick loop in `runWave` (line ~82):

```ts
  for (let i = 0; i < wave.duration; i++) {
    engine.tick(mode);
  }
```

Replace with:

```ts
  for (let i = 0; i < wave.duration; i++) {
    engine.tick(mode);
  }
  // Drain active streams past wave duration. Streams persist for
  // streamConfig.duration ticks after their creation tick. The engine's
  // isWaveDrained checks state.activeStreams.size > 0.
  const maxDrainTicks = (wave.streamConfig?.duration ?? 0) + 10; // safety margin
  for (let i = 0; i < maxDrainTicks && !mode.isWaveDrained(state); i++) {
    engine.tick(mode);
  }
```

This adds a bounded drain loop: tick up to `streamConfig.duration + 10` extra ticks after the wave's generation phase, stopping early when `isWaveDrained` returns true. For waves without `streamConfig`, `maxDrainTicks` is 10 (safety margin; existing waves drain instantly so the loop body never executes).

- [ ] **Step 2: Run all existing wave integration tests**

Run: `pnpm test tests/integration/td/`
Expected: All pass. Waves 1–7 have no active streams, so `isWaveDrained` returns true immediately after the generation phase and the drain loop is a no-op.

- [ ] **Step 3: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/td/helpers.ts
git commit -m "feat(td): extend runWave with stream drain loop for multi-tick stream support"
```

---

### Task 6: Add buildStreamingServer and buildBlobStorage helpers

**Files:**
- Modify: `tests/integration/td/helpers.ts`

- [ ] **Step 1: Add two new builder functions**

In `tests/integration/td/helpers.ts`, after `buildCircuitBreaker`, add:

```ts
/**
 * Build a Streaming Media Server from the TD registry (StreamingCapability +
 * forwarding-pipe + Monitoring). Handles "stream" requests inline (RESPOND) and
 * forwards all other traffic types downstream. Inline filter pattern.
 */
export function buildStreamingServer(compRegistry: ComponentRegistry): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("streaming_media_server", { x: 0, y: 0 }, null);
  return { component, ...singlePortIds(component) };
}

/**
 * Build a Blob Storage component from the TD registry (BlobStorageCapability + Monitoring).
 * Handles "static_asset" requests. Decorative in the streaming path — Streaming Server
 * does the actual stream processing.
 */
export function buildBlobStorage(compRegistry: ComponentRegistry): {
  component: Component;
  ingressPortId: PortId;
  egressPortId: PortId;
} {
  const component = compRegistry.create("blob_storage", { x: 0, y: 0 }, null);
  return { component, ...singlePortIds(component) };
}
```

- [ ] **Step 2: Verify helpers work**

Run: `pnpm test tests/integration/td/wave-1-launch-day.test.ts`
Expected: PASS (no regressions — new helpers just added, not yet used)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/td/helpers.ts
git commit -m "feat(td): add buildStreamingServer and buildBlobStorage test helpers"
```

---

### Task 7: Wave 8 loss-path integration test

**Files:**
- Create: `tests/integration/td/wave-8-no-streaming-server-loses.test.ts`

- [ ] **Step 1: Write the loss test**

Create `tests/integration/td/wave-8-no-streaming-server-loses.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import { WAVE_8 } from "@modes/td/td-waves";
import {
  runWave,
  buildServer,
  buildDatabase,
  buildCache,
  buildCDN,
  buildAPIGateway,
  buildLoadBalancer,
  buildQueue,
  buildCircuitBreaker,
  buildWorkerWithForwarding,
  wire,
} from "./helpers";

describe("Wave 8 — no streaming server loses", () => {
  it("Wave 7 rescue topology without streaming isolation fails on stream traffic", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Wave 7 rescue topology: no streaming isolation
    // Client → CDN → Gateway → Cache → Queue → Worker → LB → CB → [Server×5] → DB
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const cache = buildCache(compRegistry);
    const queue = buildQueue(compRegistry);
    const worker = buildWorkerWithForwarding();
    const lb = buildLoadBalancer("lb", 5);
    const cb = buildCircuitBreaker(compRegistry);
    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < 5; i++) servers.push(buildServer(compRegistry));
    const database = buildDatabase(compRegistry);

    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(cache.component);
    state.placeComponent(queue.component);
    state.placeComponent(worker.component);
    state.placeComponent(lb.component);
    state.placeComponent(cb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 700 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 700 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", { bandwidth: 700 });
    wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-cache-queue", { bandwidth: 700 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-queue-worker", { bandwidth: 700 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-worker-lb", { bandwidth: 700 });
    wire(state, { component: lb.component, egressPortId: lb.egressPortIds[0]! }, { component: cb.component, ingressPortId: cb.ingressPortId }, "c-lb-cb", { bandwidth: 700 });
    wire(state, { component: cb.component, egressPortId: cb.egressPortId }, { component: servers[0]!.component, ingressPortId: servers[0]!.ingressPortId }, "c-cb-s0", { bandwidth: 700 });
    for (let i = 1; i < 5; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 700 });
    }
    for (let i = 0; i < 5; i++) {
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, `c-s${i}-db`, { bandwidth: 700 });
    }

    const result = runWave(state, WAVE_8, client.id);

    // Without streaming isolation, stream requests overwhelm the shared pipeline → SLA fails
    expect(result.outcome.verdict).toBe("lose");
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm test tests/integration/td/wave-8-no-streaming-server-loses.test.ts`
Expected: PASS (verdict is "lose" — stream requests on shared pipeline overwhelm API traffic).

If the test unexpectedly passes (verdict "win"), the stream traffic isn't causing enough pressure. Tuning options:
- Bump `streamConfig.bandwidth` from 3 to 5 in WAVE_8
- Bump intensity from 500 to 600
- Reduce connectionBandwidth from 700 to 500

- [ ] **Step 3: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/td/wave-8-no-streaming-server-loses.test.ts
git commit -m "test(td): Wave 8 without streaming isolation loses"
```

---

### Task 8: Wave 8 win-path integration test

**Files:**
- Create: `tests/integration/td/wave-8-streaming-rescue-wins.test.ts`

- [ ] **Step 1: Write the win test**

Create `tests/integration/td/wave-8-streaming-rescue-wins.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { bootTDRegistry } from "@harness/td-fixtures";
import type { CapabilityId } from "@core/types/ids";
import { WAVE_8 } from "@modes/td/td-waves";
import { StreamingCapability } from "@capabilities/streaming/streaming-capability";
import {
  runWave,
  buildServer,
  buildDatabase,
  buildCache,
  buildCDN,
  buildAPIGateway,
  buildLoadBalancer,
  buildQueue,
  buildCircuitBreaker,
  buildStreamingServer,
  buildBlobStorage,
  buildWorkerWithForwarding,
  wire,
} from "./helpers";

describe("Wave 8 — streaming rescue wins", () => {
  it("Streaming Server isolates stream traffic, API path stays healthy → SLA passes", () => {
    const compRegistry = bootTDRegistry();
    const state = new SimulationState({ zones: ["default"], pairLatency: new Map() });

    // Rescue topology:
    // Client → CDN → Gateway → Cache → StreamingServer → BlobStorage
    //                                                   ↘ Queue → Worker → LB → [Server×N] → DB
    //
    // StreamingServer handles "stream" → RESPOND (triggers engine bandwidth reservation
    // on StreamingServer→BlobStorage connection). Forwards everything else downstream.
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    const cdn = buildCDN(compRegistry);
    const gateway = buildAPIGateway(compRegistry);
    const cache = buildCache(compRegistry);
    const streamServer = buildStreamingServer(compRegistry);
    const blobStorage = buildBlobStorage(compRegistry);
    const queue = buildQueue(compRegistry);
    const worker = buildWorkerWithForwarding();
    const serverCount = 5;
    const lb = buildLoadBalancer("lb", serverCount);
    const servers: ReturnType<typeof buildServer>[] = [];
    for (let i = 0; i < serverCount; i++) servers.push(buildServer(compRegistry));
    const database = buildDatabase(compRegistry);

    state.placeComponent(client);
    state.placeComponent(cdn.component);
    state.placeComponent(gateway.component);
    state.placeComponent(cache.component);
    state.placeComponent(streamServer.component);
    state.placeComponent(blobStorage.component);
    state.placeComponent(queue.component);
    state.placeComponent(worker.component);
    state.placeComponent(lb.component);
    for (const s of servers) state.placeComponent(s.component);
    state.placeComponent(database.component);

    const clientEgress = client.ports.find(p => p.direction === "egress")!;

    // Client → CDN → Gateway → Cache → StreamingServer
    wire(state, { component: client, egressPortId: clientEgress.id }, { component: cdn.component, ingressPortId: cdn.ingressPortId }, "c-client-cdn", { bandwidth: 700 });
    wire(state, { component: cdn.component, egressPortId: cdn.egressPortId }, { component: gateway.component, ingressPortId: gateway.ingressPortId }, "c-cdn-gw", { bandwidth: 700 });
    wire(state, { component: gateway.component, egressPortId: gateway.egressPortId }, { component: cache.component, ingressPortId: cache.ingressPortId }, "c-gw-cache", { bandwidth: 700 });
    wire(state, { component: cache.component, egressPortId: cache.egressPortId }, { component: streamServer.component, ingressPortId: streamServer.ingressPortId }, "c-cache-ss", { bandwidth: 700 });

    // StreamingServer → BlobStorage (isolated stream path)
    // StreamingServer → Queue → Worker → LB → Servers → DB (API path)
    // StreamingServer has 2 egress capacity — need to check port structure.
    // If it only has 1 egress, we need to wire differently.
    wire(state, { component: streamServer.component, egressPortId: streamServer.egressPortId }, { component: queue.component, ingressPortId: queue.ingressPortId }, "c-ss-queue", { bandwidth: 700 });
    wire(state, { component: queue.component, egressPortId: queue.egressPortId }, { component: worker.component, ingressPortId: worker.ingressPortId }, "c-queue-worker", { bandwidth: 700 });
    wire(state, { component: worker.component, egressPortId: worker.egressPortId }, { component: lb.component, ingressPortId: lb.ingressPortId }, "c-worker-lb", { bandwidth: 700 });
    for (let i = 0; i < serverCount; i++) {
      wire(state, { component: lb.component, egressPortId: lb.egressPortIds[i]! }, { component: servers[i]!.component, ingressPortId: servers[i]!.ingressPortId }, `c-lb-s${i}`, { bandwidth: 700 });
      wire(state, { component: servers[i]!.component, egressPortId: servers[i]!.egressPortId }, { component: database.component, ingressPortId: database.ingressPortId }, `c-s${i}-db`, { bandwidth: 700 });
    }

    const result = runWave(state, WAVE_8, client.id);

    // 1. SLA passes — verdict is "win"
    expect(result.outcome.verdict).toBe("win");
    expect(result.outcome.slaResults?.availability.passed).toBe(true);

    // 2. Streaming Server forwarded non-stream traffic (proving it's in the pipeline)
    const ssForwarded = result.forwardedCountByComponent.get(streamServer.component.id) ?? 0;
    expect(ssForwarded).toBeGreaterThan(0);

    // 3. API path still works — Servers processed requests
    let totalServerProcessed = 0;
    for (const s of servers) {
      totalServerProcessed += result.processedCountByComponent.get(s.component.id) ?? 0;
    }
    expect(totalServerProcessed).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm test tests/integration/td/wave-8-streaming-rescue-wins.test.ts`

If it fails:
- **verdict "lose":** Check which SLA gate failed. Common issues:
  - StreamingCapability throughput (tier×4 = 4/tick) is too low for 150 stream/tick. Fix: bump throughput in the streaming capability factory in `registerTDDefaults` (e.g., `throughputPerTier: 50`) or adjust WAVE_8 intensity/composition.
  - Not enough servers for 350 non-stream API req/tick. Fix: increase `serverCount`.
  - BlobStorage connection missing — `pickStreamConnection` can't find egress for stream reservation. Fix: wire StreamingServer→BlobStorage.
- **StreamingServer only has 1 egress port:** The TD entry defines egress capacity 2, but if `singlePortIds` only finds the first egress, the wiring above (which uses `streamServer.egressPortId` for the queue path) leaves no connection for stream bandwidth reservation. In that case, the Streaming Server needs a second egress port wired to BlobStorage, or the test needs a topology adjustment.

**Tuning if needed:**
- If StreamingCapability throughput is the bottleneck, modify the `streaming` factory in `registerTDDefaults` to pass options: `new StreamingCapability("streaming" as CapabilityId)` — but StreamingCapability doesn't accept options currently. Alternative: set the TD entry's defaultTier higher (tier 2 = 8/tick, tier 3 = 12/tick).
- If the topology needs BlobStorage wired: add a second wire from StreamingServer to BlobStorage. This requires the StreamingServer to have 2 egress connections, which the TD entry supports (egress capacity: 2).

- [ ] **Step 3: Tune and iterate until test passes**

Apply minimal fixes. Document any tuning changes made.

- [ ] **Step 4: Run full suite**

Run: `pnpm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/td/wave-8-streaming-rescue-wins.test.ts
git commit -m "test(td): Wave 8 streaming isolation rescue wins with diagnostic stats"
```

---

### Task 9: Verify full suite and typecheck

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All pass. Note the total test count for documentation.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: Clean (0 errors).

---

### Task 10: Update handoff documentation

**Files:**
- Modify: `docs/claude/implementation-status.md`
- Modify: `docs/claude/td-stage-gotchas.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update implementation-status.md stage line**

Replace the `**Current stage:**` line with:

```
**Current stage:** Phase 1, Stage 4a complete. TD mode is playable through Wave 8. Wave 8 teaches streaming traffic isolation via inline Streaming Media Server + Blob Storage. TDTrafficSource populates streamDuration/streamBandwidth from wave.streamConfig. Engine's active-stream lifecycle handles bandwidth reservation. [TEST_COUNT] tests, typecheck clean.
```

Replace `[TEST_COUNT]` with the actual count from Task 9.

- [ ] **Step 2: Add Stage 4a paragraph**

After the Stage 3e augmentation paragraph in "What ships", add:

```markdown
**Stage 4a: Wave 8 — Video Launch (streaming isolation)** — `stream` request type with multi-tick bandwidth reservation. `TDTrafficSource` populates `streamDuration`/`streamBandwidth` from `wave.streamConfig` for stream-type requests, activating the engine's existing active-stream lifecycle. TD entries added: `STREAMING_SERVER_ENTRY` (streaming + forwarding-pipe + monitoring, inline filter pattern) and `BLOB_STORAGE_ENTRY` (blob-storage + monitoring, decorative). `runWave` extended with stream drain loop to tick past wave duration until `isWaveDrained` returns true. Win/lose integration test pair validates streaming isolation rescue. [TEST_COUNT] tests total.
```

- [ ] **Step 3: Update next-candidates section**

Update to reflect what's done and deferred:

```markdown
## Next: Stage 4b+ candidates (no spec yet)

- **Wave 9 — Going Global.** Multi-datacenter with zone latency penalties. Requires engine source-dive: does tick loop apply `getZonePairLatency`?
- **Wave 10 — The Viral Moment.** Stress-test boss wave. AutoScaleCapability needs source-dive.
- **Dashboard stream visualization.** Persistent connection lines for active streams, bandwidth utilization chart.
- **Adaptive bitrate in StreamingCapability.** Stream quality degrades under congestion.
- **Type-aware LB routing.** Round-robin LB can't route by request type.
- **Worker/StreamingServer registry entry with ForwardingCapability.** Both use custom inline filter pattern in tests; registry entries lack forwarding-pipe.
```

- [ ] **Step 4: Add Stage 4a section to td-stage-gotchas.md**

Append:

```markdown
## Stage 4a gotchas

- **StreamingCapability throughput (tier×4) may be too low.** At 150 stream/tick (30% of 500), tier-1 handles 4/tick. Tests may need tier-2+ or throughput tuning in the factory.
- **BlobStorage is decorative in Wave 8.** BlobStorageCapability handles `static_asset`, not `stream`. Streaming Server does the actual stream processing.
- **`runWave` now drains active streams.** After `wave.duration` ticks, a drain loop ticks up to `streamConfig.duration + 10` extra ticks until `isWaveDrained` returns true. Waves without `streamConfig` are unaffected (drain loop is a no-op).
- **Stream bandwidth reservation is per-connection.** `getEffectiveBandwidth()` deducts `reservedBandwidth` from the connection where the stream was RESPOND'd. Isolated connections (StreamingServer→BlobStorage) don't affect API path bandwidth.
- **`pickStreamConnection` selects the RESPOND component's egress.** The Streaming Server must have an egress connection for stream bandwidth reservation to work. If no valid egress exists, the engine degrades RESPOND to DROP with reason `"NO_STREAM_EGRESS"`.
- **Streaming Server uses inline filter pattern.** Like Worker in Waves 6+7, Streaming Server has StreamingCapability (handles stream → RESPOND) + ForwardingCapability (forwards non-stream types). The forwarding-pipe handledTypes excludes `stream` to prevent double-handling.
```

- [ ] **Step 5: Update CLAUDE.md**

Replace the `**Current stage:**` line with:

```
**Current stage:** Phase 1, Stage 4a complete. TD mode is playable through Wave 8. Wave 8 teaches streaming traffic isolation (Streaming Server + Blob Storage). [TEST_COUNT] tests, typecheck clean.
```

- [ ] **Step 6: Run full suite one final time**

Run: `pnpm test && pnpm typecheck`
Expected: All pass, clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add docs/claude/implementation-status.md docs/claude/td-stage-gotchas.md CLAUDE.md
git commit -m "docs(stage-4a): handoff docs — status, gotchas, CLAUDE.md updated"
```

---

### Task 11: Update roadmap and final push

**Files:**
- Modify: `docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md`

- [ ] **Step 1: Mark Wave 8 as shipped**

In the progress table, update Wave 8's row:

```
| 8 | Video Launch | 4a | ✅ Shipped | 2026-04-14 |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md
git commit -m "docs(roadmap): mark Wave 8 as shipped"
```

- [ ] **Step 3: Push to remote**

```bash
git push origin main
```
