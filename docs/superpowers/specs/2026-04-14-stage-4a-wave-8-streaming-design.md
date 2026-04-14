# Stage 4a — Wave 8: Video Launch (Streaming Isolation)

**Status:** Design approved 2026-04-14. Simulation layer only — dashboard/renderer deferred.

## 1. Goal

Wave 8 ("Video Launch") teaches **traffic isolation**. Streaming requests (`stream` type) reserve bandwidth on connections for multiple ticks, starving API requests if they share the same path. The player learns to add a **Streaming Media Server** (inline filter that handles streams and forwards everything else) backed by **Blob Storage**. Without isolation, streams consume all connection bandwidth and API availability collapses.

This is the first wave where requests have multi-tick lifetime. Waves 1–7 are one-shot (request arrives, gets processed or dropped in the same tick pipeline). Stream requests persist for 20 ticks, reserving 3 bandwidth units per tick on the connection where they're RESPOND'd.

## 2. Architectural context (source-dive findings)

### Engine infrastructure — all production-ready, no changes needed

1. **Active-stream lifecycle is complete.** `deliver-staged.ts` registers an `ActiveStream` when a RESPOND outcome reaches a request with `streamDuration != null`. `active-streams.ts` decrements `remainingDuration` each tick and releases when expired, emitting `STREAM_COMPLETED` and crediting revenue. Tested in `active-streams.test.ts`, `stream-registration.test.ts`, `chaos-stream.test.ts`.

2. **Bandwidth reservation works.** `getEffectiveBandwidth()` computes: `conn.bandwidth - connectionLoadThisTick - streamReservedBandwidth`. Active streams sum their `reservedBandwidth` on each connection. When effective bandwidth drops below minimum, the engine's delivery gate-keeps new requests.

3. **`isWaveDrained()` handles streams.** Checks `state.activeStreams.size > 0` to block wave completion until all streams finish. The wave runs longer than `duration` ticks if streams are still active.

4. **Stream registration trigger.** Only fires when `request.streamDuration != null` in the RESPOND path. If no valid egress connection exists, degrades to DROP with reason `"NO_STREAM_EGRESS"`.

5. **`TDWaveDefinition.streamConfig` already exists.** Optional field `{ duration: number, bandwidth: number }`. No wave currently uses it.

### Existing capabilities

6. **StreamingCapability** (`src/capabilities/streaming/streaming-capability.ts`). PROCESS phase, `canHandle("stream")`, returns RESPOND. Throughput: tier×4/tick. Upkeep: tier×7. Stats: `{ activeStreams: number }`. Simple and sufficient — the engine handles bandwidth reservation.

7. **BlobStorageCapability** (`src/capabilities/blob-storage/blob-storage-capability.ts`). PROCESS phase, `canHandle("static_asset")`, returns RESPOND with 5 latency. Throughput: tier×8/tick. Upkeep: tier×6. **Does NOT handle `stream` type.** Decorative in the streaming path — Streaming Server is the real processor.

8. **Server does NOT handle `stream`.** ProcessingCapability handledTypes: `["api_read", "static_asset", "auth_required"]`. Stream requests reaching Server are PASS'd, eventually timing out.

### Gap: TDTrafficSource doesn't populate stream fields

9. **TDTrafficSource sets `streamDuration: null` and `streamBandwidth: null` on all requests.** Must be extended to read `wave.streamConfig` and populate these fields when `tickType === "stream"`. This is the single code change that activates the entire stream lifecycle for Wave 8.

## 3. Scope: what changes

| Change                                                        | Slice |
|---------------------------------------------------------------|-------|
| TDTrafficSource: populate streamDuration/streamBandwidth      | A     |
| TD_STREAMING_SERVER_ENTRY (streaming + forwarding-pipe + mon) | A     |
| TD_BLOB_STORAGE_ENTRY (blob-storage + monitoring)             | A     |
| Wire streaming + blob-storage factories in registerTDDefaults | A     |
| WAVE_8 definition in td-waves.ts                              | A     |
| buildStreamingServer + buildBlobStorage test helpers           | B     |
| wave-8-no-streaming-server-loses.test.ts                      | B     |
| wave-8-streaming-rescue-wins.test.ts                          | B     |
| Extend runWave helper to drain active streams past duration   | B     |
| Handoff docs: implementation-status, gotchas, CLAUDE.md       | C     |

## 4. Slice A — Wave 8 wiring

### 4a. TDTrafficSource stream field population

In `src/modes/td/td-traffic-source.ts`, the `generate()` method constructs requests with `streamDuration: null` and `streamBandwidth: null`. When the wave has `streamConfig` and `tickType === "stream"`, populate these fields:

```ts
streamDuration: tickType === "stream" && this.wave.streamConfig
  ? this.wave.streamConfig.duration
  : null,
streamBandwidth: tickType === "stream" && this.wave.streamConfig
  ? this.wave.streamConfig.bandwidth
  : null,
```

This is the critical activation point. Once `streamDuration != null`, the engine's `deliver-staged.ts` registers an `ActiveStream` on RESPOND, `active-streams.ts` manages the lifecycle, and `getEffectiveBandwidth()` deducts reserved bandwidth.

**No changes to Waves 1–7.** They have no `streamConfig`, so `stream` type never appears in their composition and the null check keeps the existing behavior.

### 4b. TD_STREAMING_SERVER_ENTRY

New entry in `src/modes/td/td-component-entries.ts`:

- **type:** `"streaming_media_server"`
- **capabilities:** streaming + forwarding-pipe + monitoring
- **ports:** 1 ingress (capacity 2), 1 egress (capacity 2)
- **placementCost:** $300
- **visual:** `{ icon: "streaming", color: "#e11d48", shape: "rectangle" }`
- **conditionProfile:** RESILIENT (edge infrastructure, like CDN)

The Streaming Server follows the inline filter pattern established by Wave 6's Worker:
- **StreamingCapability** (PROCESS phase): `canHandle("stream")` → RESPOND. Triggers engine stream registration.
- **ForwardingCapability** (PROCESS phase): handles all non-stream types → FORWARD to downstream. This is the `forwarding-pipe` variant with `handledTypes: ["api_read", "api_write", "static_asset", "auth_required", "batch"]` (all non-stream types).

**Key difference from sandbox Streaming Media Server:** The sandbox entry has `streaming + caching + monitoring`. The TD entry replaces `caching` with `forwarding-pipe` so it can serve as an inline filter. The TD entry also excludes `stream` from forwarding-pipe's handledTypes to prevent double-handling.

### 4c. TD_BLOB_STORAGE_ENTRY

New entry in `src/modes/td/td-component-entries.ts`:

- **type:** `"blob_storage"`
- **capabilities:** blob-storage + monitoring
- **ports:** 1 ingress (capacity 2), 1 egress (capacity 1)
- **placementCost:** $250
- **visual:** `{ icon: "blob-storage", color: "#64748b", shape: "rectangle" }`
- **conditionProfile:** RESILIENT (storage infrastructure)

**Decorative in Wave 8.** BlobStorageCapability handles `static_asset`, not `stream`. The Streaming Server handles streams via StreamingCapability. Blob Storage is in the topology to teach the player about content storage, but the Streaming Server does the actual stream processing. The player places Blob Storage behind the Streaming Server — it serves static_asset requests that pass through the streaming path.

### 4d. registerTDDefaults wiring

Add two capability factory registrations:

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

### 4e. WAVE_8 definition

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

**Tuning rationale:**
- **intensity 500/tick:** 43% jump from Wave 7's 350. Teaches that scale matters.
- **stream 30%:** 150 stream req/tick. Each reserves 3 bandwidth/tick for 20 ticks. At steady state: ~150 × 3 = 450 bandwidth reserved per tick across connections. This starves shared connections (bandwidth 700 − 450 = only 250 available for API traffic).
- **duration 40 ticks:** Longer than Waves 1–7 (30 ticks) because streams persist for 20 ticks and `isWaveDrained` waits for all streams to finish. At tick 40, the last streams were created at tick 39 and persist until tick 59.
- **startingBudget $1500:** Player carries Wave 7 topology (~$1200 worth) and needs $300 for Streaming Server + $250 for Blob Storage = $550 incremental.
- **connectionBandwidth 700:** Must be high enough that non-stream traffic can flow when streams are on isolated connections, but low enough that shared connections get starved.
- **stream revenue $8:** Highest per-request revenue — incentivizes handling streams, not just ignoring them.
- **SLA 92% availability:** Slightly tighter than Wave 7's 90% because the player should already have a resilient topology.

## 5. Slice B — Integration tests

### 5a. Test helpers

Two new builders in `tests/integration/td/helpers.ts`:

```ts
buildStreamingServer(compRegistry) → { component, ingressPortId, egressPortId }
buildBlobStorage(compRegistry)     → { component, ingressPortId, egressPortId }
```

**buildStreamingServer** — uses registry `compRegistry.create("streaming_media_server", ...)`. However, like the Worker situation in Wave 6, the registry Streaming Media Server has `streaming + caching + monitoring` (no forwarding). The TD entry needs forwarding-pipe for inline filtering. Options:
1. Use the TD-tuned registry entry (if `registerTDDefaults` overrides the sandbox entry's capabilities) — preferred.
2. Build a custom `buildStreamingServerWithForwarding()` helper (like `buildWorkerWithForwarding`) — fallback.

The preferred approach: the TD component entry in `td-component-entries.ts` defines `streaming + forwarding-pipe + monitoring`, and `registerTDDefaults` registers capability factories for `streaming` and `forwarding-pipe`. When `compRegistry.create("streaming_media_server")` is called, it should use the TD entry (since `bootTDRegistry()` loads TD entries). **Verify this during implementation — if the registry still uses the sandbox entry, fall back to the custom builder pattern.**

**buildBlobStorage** — straightforward: `compRegistry.create("blob_storage", ...)`.

### 5b. wave-8-no-streaming-server-loses.test.ts

**Topology:** Wave 7 rescue topology (CDN → Gateway → Cache → Queue → Worker → LB → CB → [Server×5] → DB). No streaming isolation — stream requests flow through the shared pipeline.

**What happens:** Stream requests reach Servers, which PASS them (Server doesn't handle `stream`). Streams that somehow get RESPOND'd by other capabilities reserve bandwidth on shared connections, starving API traffic. Even without RESPOND, the 150 stream req/tick at 500 intensity overwhelms the pipeline.

**Assertions:**
1. `result.outcome.verdict === "lose"`
2. Loss is availability-driven (streams starve API traffic or stream requests themselves timeout)

### 5c. wave-8-streaming-rescue-wins.test.ts

**Rescue topology:**
```
Client → CDN → Gateway → Cache → StreamingServer → BlobStorage
                                                  ↘ Queue → Worker → LB → [Server×N] → DB
```

Streaming Server sits inline. Handles `stream` → RESPOND (triggers bandwidth reservation on StreamingServer→BlobStorage connection, isolating it from the API path). Forwards everything else to Queue→Worker→LB→Servers.

**Assertions:**
1. `result.outcome.verdict === "win"`
2. `result.outcome.slaResults?.availability.passed === true`
3. StreamingCapability diagnostic: `streamCap.getStats().activeStreams > 0` (or check at end of wave — activeStreams may be 0 if all streams completed)
4. API path availability: Servers' processedCount > 0 (API traffic still flows)
5. Stream isolation: bandwidth on the StreamingServer→BlobStorage connection is consumed by streams, not shared with API traffic

**Tuning considerations:**
- Server count: at 500/tick with 70% non-stream (350 API req/tick), need enough servers. Wave 7 used 5 servers for 350/tick. Similar or more needed here.
- StreamingCapability throughput: tier×4 = 4 streams/tick at tier 1. With 150 stream req/tick arriving, this is a severe bottleneck. May need to bump StreamingCapability throughput in the TD factory (e.g., `throughputPerTier: 50`) or the test will show streams timing out rather than being served.
- `pickStreamConnection` selects the egress connection for stream bandwidth reservation. Verify it picks the StreamingServer→BlobStorage connection, not some other egress.

## 6. Slice C — Handoff documentation

### 6a. Update implementation-status.md
- Stage line: "Phase 1, Stage 4a complete. TD mode playable through Wave 8..."
- Add Stage 4a paragraph: streaming isolation, TDTrafficSource stream wiring, TD entries, tests
- Update test count

### 6b. Update td-stage-gotchas.md
- StreamingCapability throughput (tier×4) may be too low for 150 stream/tick — tuning may be needed
- BlobStorage is decorative (handles static_asset, not stream)
- `isWaveDrained` extends wave beyond duration ticks — tests must account for this
- Stream bandwidth reservation is per-connection — isolated connections don't affect API path
- `pickStreamConnection` selects the RESPOND component's egress for reservation — topology must have valid egress

### 6c. Update CLAUDE.md
- Current stage line + test count

## 7. Tests summary

| Test                                   | Type        | Status  | Asserts                                                     |
|----------------------------------------|-------------|---------|-------------------------------------------------------------|
| wave-8-no-streaming-server-loses       | Integration | **New** | verdict=lose without streaming isolation                    |
| wave-8-streaming-rescue-wins           | Integration | **New** | verdict=win, StreamingCap stats, API path availability      |
| TDTrafficSource stream field unit test | Unit        | **New** | stream requests get streamDuration/streamBandwidth from config |

## 8. Risk register

| #  | Risk                                                                              | Mitigation                                                                                         |
|----|-----------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| R1 | Stream bandwidth reservation may not starve API traffic enough for loss test      | Tune streamConfig.bandwidth (3→5) or intensity (500→600) until shared-path loss is clear           |
| R2 | BlobStorageCapability handles `static_asset` not `stream` — decorative            | Accept as decorative; Streaming Server does the real work; document in gotchas                      |
| R3 | StreamingCapability throughput (tier×4) too low for 150 stream/tick               | Bump throughput in TD factory (e.g., 50/tick) or use tier-3 entry (12/tick) — verify in test       |
| R4 | `pickStreamConnection` may not select the intended connection                     | Verify in integration test; Streaming Server must have egress connection to BlobStorage             |
| R5 | `runWave` only ticks for `wave.duration` — does NOT drain active streams           | Extend `runWave` to tick past duration until `isWaveDrained` returns true (or add a drain loop)    |
| R6 | Registry Streaming Media Server entry may not have forwarding-pipe                | TD entry overrides sandbox entry; if not, use custom builder pattern (like buildWorkerWithForwarding) |

## 9. Out of scope (deferred)

- Dashboard/renderer changes (persistent stream lines, bandwidth utilization chart)
- Adaptive bitrate in StreamingCapability
- BlobStorageCapability handling `stream` type
- Type-aware LB routing
- Stream-specific loss diagnosis panel text

## 10. Update checklist (post-merge)

1. `docs/claude/implementation-status.md` — stage line, test count, Stage 4a paragraph
2. `docs/claude/td-stage-gotchas.md` — Stage 4a section
3. `CLAUDE.md` — current stage line + test count
4. `docs/superpowers/roadmaps/2026-04-14-waves-4-10-roadmap.md` — mark Wave 8 as shipped
