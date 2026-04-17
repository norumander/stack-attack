# Physics-driven request flow — design

**Status:** Drafted 2026-04-16 through brainstorming session. Awaiting approval → implementation planning.

## Problem statement

The current engine resolves requests deterministically inside a fixed-point loop within a single tick: a request can hop `Client → CDN → Gateway → Cache → LB → Server → DB` all in one tick. The renderer then fakes spatial staggering (`state-to-renderer.ts` adds `spawnOffsetMs` per-group) so animated "dots" look like they hopped through the pipeline. In this model, simulation decides outcomes, visuals decorate them.

This inversion hurts the game:

- **No anticipation.** The player can't *watch* a request travel and *react* to what's coming — by the time the dots animate, the outcome is already decided.
- **Capacity teaching is hidden.** A server's saturation is a number in a HUD, not a visible phenomenon.
- **The upcoming-requests queue the player wants** (a visual preview of what's about to arrive) has no natural home in a model where traffic materializes from a tick-level counter.
- **Routing specialization is implicit.** The engine knows LBs and caches have special semantics, but nothing about the visual layer makes that specialization readable.

## Goal

Replace the tick-driven simulation with a continuous-time physics simulation where **packets physically traverse edges in real time, and components only decide outcomes when a packet arrives at them**. Visuals and simulation are the same thing. Add a diegetic "snake" of upcoming packets behind each client, so the player can see incoming load before it hits the network.

## Decisions summary

| Decision | Choice |
|---|---|
| Travel-time model | Continuous motion, fixed 60Hz timestep sim |
| Packet "size" semantics | Aggregated request count (size=N means N real requests batched) |
| LB split behavior | Always splits the batch by count across all healthy egresses |
| Random-pick semantics | Per-packet independent roll at any bare fan-out |
| Component processing | Instant decide at arrival; `-x` drop flash, `+$x` revenue flash |
| Request types | Collapsed into attribute flags on a single `Request` type |
| Response flow | Added — twin connections mint on user connect; retrace via `twinId` |
| Income rule | Writes earn at target arrival; reads earn at client response-arrival |
| Cache model | Real key-keyed LRU; deterministic hit/miss per request |
| LB merge | Wait-all (slowest child drags the response) |
| Cache populate timing | On response-path through cache (miss → forward → populate on return) |
| Snake queue | Diegetic, 10 slots, behind client, direction = away from first egress |
| Queued preview | Full size, desaturated, fade-to-back |
| Renderer scope | Iso renderer only; flat Pixi renderer deleted |
| Flash density | Accumulation-window throttling |
| Migration approach | Hard reset — build `src/sim/` fresh, delete `src/core/engine/` at switchover |

## Simulation architecture

### Fixed-step loop

Replaces the 10-step tick with a canonical game-loop pattern.

- **Step duration:** 1/60 s (16.67ms). Deterministic.
- **Browser driver:** `requestAnimationFrame` accumulator drains wall-clock delta in fixed steps; renderer interpolates between steps using `alpha = (now - lastStepTime) / stepDuration`.
- **Test driver:** mock clock, tests call `sim.step(1/60)` in a loop. Zero wall-clock dependencies.
- **Location:** new module `src/sim/`. Pure TypeScript, zero Pixi imports. Invariant test `tests/unit/sim-pixi-isolation.test.ts` enforces this.

### Step ordering

Within a single step, events fire deterministically:

1. **Advance in-flight packets** — each active packet does `progress += speed × dt`.
2. **Fire arrivals** — packets with `progress ≥ 1` trigger `component.onArrive()`. Sort by `packet.id` (monotonic birth order) before processing to make capacity competition deterministic.
3. **Launch from snakes** — each client that's due (based on its `packetRate`) launches `snake[0]` onto the first chosen egress edge.
4. **Generate new snake tails** — `TrafficSource` appends to each client's snake to keep the visible 10 populated.
5. **Refill capacity buckets** — each component's per-type credit buckets refill by `capacity × dt`.
6. **Tick economy / TTLs** — deduct upkeep at configured cadence, expire TTL'd in-flight packets.

### Packet model

```ts
type Packet = {
  id: PacketId                  // monotonic; used for step-internal sort
  requests: Request[]           // N real requests bundled (count = requests.length)
  edgeId: ConnectionId          // which edge it's traversing
  progress: number              // 0..1 along the edge
  speed: number                 // edge-units per second
  spawnedAt: number             // sim-time seconds; TTL reference
  parentId: PacketId | null     // set when this is a split child
  direction: "forward" | "back" // request leg vs response leg
}
```

Packets do not live on components. They live on edges. A component holds no pending queue — if it accepts an arrival it emits new packet(s) onto egress edges; if it rejects, the packet drops.

### Request model

```ts
type Request = {
  id: RequestId
  key: string              // for cache lookup; drawn from wave's key distribution
  isWrite: boolean
  requiresAuth: boolean
  isLarge: boolean
  stream?: { duration: number; bandwidth: number }  // present iff streaming
  originClientId: ComponentId
  originZone: Zone | null
  spawnedAt: number
}
```

The `type` enum is gone. Components decide handling by reading attributes:

- Cache, CDN, Data Cache handle `!isWrite`
- Gateway handles `requiresAuth` (terminates or forwards)
- Worker handles batch/slow patterns (distinguishing flag TBD in implementation; likely `isAsync` or placement-based)
- StreamingServer handles `stream != undefined`

### Connections (twin pairs)

When the player connects Client→Server with one action, the sim mints:

- `request edge`: Client.out → Server.in
- `response edge`: Server.out → Client.in
- both carry `twinId` referencing each other

Requests traverse forward edges. Responses auto-retrace using each hop's `twinId`. The renderer draws this as one curve with two animation lanes (request below center, response above). Click/delete targets the curve; deletion removes both twins.

```ts
type Connection = {
  id: ConnectionId
  from: { componentId; portId }
  to:   { componentId; portId }
  bandwidth: number          // max simultaneous in-flight packets
  latency: number            // seconds to traverse (derives `speed`)
  twinId: ConnectionId       // response-leg partner
  direction: "forward" | "back"
}
```

## Component arrival contract

Each component exposes `onArrive(packet, ctx): Outcome`. Outcome shapes:

```ts
type Outcome =
  | { kind: "forward"; emit: Array<{ edgeId: ConnectionId; packet: Packet }> }
  | { kind: "terminate"; revenue: number }        // writes; + $x flash at this component
  | { kind: "respond"; responsePacket: Packet }   // births response; travels back to origin
  | { kind: "split"; children: Packet[]; merge?: MergeSpec }  // LB split; merge info for response joining
  | { kind: "drop"; reason: string; count: number }           // -count flash
```

Capabilities compose by phase priority (INTERCEPT → PROCESS → OBSERVE) on arrival — same discipline as today, different trigger.

### Per-component routing rules

| Component | On N egresses | Handling |
|---|---|---|
| Client | N/A (only emits from snake) | Snake.head launches on a **per-packet random pick** of client's egresses |
| Server | N/A (first-matching egress) | Processes writes (terminate), forwards reads (`respond` → DB chain), capacity bucket per-type |
| Database | terminal | Processes writes (terminate + revenue); serves reads from storage (respond) |
| Data Cache | 1 forward egress | Per-request cache lookup on batch; emits hits-child (respond) and misses-child (forward) |
| CDN | same as Cache, edge-placed, tuned for `isLarge` | Same arrival semantics |
| LoadBalancer | N egresses | Always splits: packet of count C becomes N children with counts summing to C (round-robin remainder). Healthy egresses only. Each child gets new id, `parentId = parent.id`, records `MergeSpec` |
| DNS/GTM | N egresses | Deterministic pick by `request.originZone`; no split |
| API Gateway | 1 forward egress | Auth termination for `requiresAuth` (respond + revenue if terminating), else forward |
| Queue | 1 forward egress, 1 pull target | Holds until Worker pulls; non-async types pass through |
| Worker | N/A | Actively pulls from Queue each step at own rate |
| StreamingServer | N/A | Reserves bandwidth on ingress edge for stream duration; processes stream requests |

### Capacity bucket

Each processing component has per-attribute credit buckets:

```ts
type CapacityBucket = {
  capacityPerSecond: number
  credits: number            // refills at capacityPerSecond × dt per step, capped
}
```

On arrival, consume `requests.length` credits. If insufficient: drop with reason `overloaded`, fire `-count` flash, packet does not advance. No internal queueing, no linger sprite.

### Response flow

On `terminate` (write success at target): fire `+$revenue` flash, packet retires, no response.

On `respond`: the target emits a response packet with `direction: "back"`, born on the component's response-edge (the twin of the edge the request arrived on). Each arrival on the response leg calls `component.onArriveResponse()` which by default passes through to the next twin hop. Data Cache intercepts response-arrivals to populate slots (see Cache model). Eventually the response arrives at its origin client and fires `+$revenue`.

### LB split/merge

On forward arrival: split by `MergeSpec` tracking `{ expectedChildren: N, receivedChildren: 0, accumulatedRevenue: 0, childIds: Set<PacketId> }`. Store on LB component state keyed by parent packet id.

When response children arrive at LB: increment received count, accumulate revenue. When `received == expected`: emit a merged response packet on the twin of the original ingress edge; delete the merge state.

**TTL on merge state:** if `expectedChildren` isn't reached within the parent request's remaining TTL, emit a single merged drop (`-x` where x = still-missing count) and retire the merge state.

## Cache model (key-aware, deterministic)

Drops `hitRateByType` entirely. Each Cache/CDN/DataCache component holds:

```ts
type CacheState = {
  capacity: number            // slot count
  slots: Array<{ key: string; lastAccessedAt: number }>  // LRU-ordered, front = most recent
}
```

### Request-leg behavior

A packet of N read requests arrives. For each request:

- **Hit**: key is in `slots`. Move slot to front (LRU update).
- **Miss**: key is not in `slots`. Reserved for populate on response-leg.

Emit up to two children:

- **hits-child**: size = hit count, terminates → `respond` at cache (response heads back along response-leg).
- **misses-child**: size = miss count, `forward` to single downstream egress.

If all requests hit or all miss, only one child is emitted. Zero hits or zero misses → no child of that kind.

### Response-leg behavior

When a response packet passes back through a Cache on the response-edge twin of the request's egress:

- For each request in the response's payload, populate its key in `slots`.
- If over capacity, evict LRU (tail) per inserted key.
- Forward response to next upstream twin edge.

This is the "miss → populate on return" policy (Q-C: C2). It intentionally allows cold-key stampedes (many simultaneous misses on the same cold key all reach DB before cache populates), which is a real teaching moment.

### Write invalidation

On a write request arrival at a Cache: drop the slot matching that key (no-op if not present). Writes don't normally route through caches, but a write-through wave variant can be a later capability upgrade.

## Entry-point queue (the snake)

### Wave definition

```ts
type WaveDef = {
  intensity: number            // requests per second
  packetRate: number           // packets per second emitted from the snake (visual cadence)
  duration: number             // generation seconds
  composition: {
    writeRatio: number
    authRatio: number
    streamRatio: number
    largeRatio: number
  }
  keyDistribution: { kind: "zipf"; alpha: number; spaceSize: number }
  zoneDistribution?: Record<Zone, number>
  streamConfig?: { duration: number; bandwidth: number }
  sla: { availability: number; maxAvgLatencySeconds: number; maxDropRate: number }
  chaosSchedule?: ChaosEntry[]
}
```

Per-packet request count = `intensity / packetRate` (rounded; fractional debt accumulates for long-term exactness).

### Per-packet attribute rolls

Each newly generated packet rolls its attributes *once*:

- `isWrite ← rng() < composition.writeRatio`
- `requiresAuth ← rng() < composition.authRatio`
- `stream ← rng() < composition.streamRatio ? wave.streamConfig : undefined`
- `isLarge ← rng() < composition.largeRatio`
- zone (if multi-zone): weighted random pick

The whole packet shares these attributes. The on-average distribution across a wave matches `composition`.

### Per-request key rolls

For each of the N requests inside a packet:

- `key ← zipfSample(keyDistribution, rng)`

So a packet of 50 reads has 50 keys drawn from Zipfian (hot keys cluster by frequency, not position in packet).

### The snake state machine

Per client:

```
TrafficSource generates a packet → append to client.snake tail
Renderer shows up to 10 packets behind client (desaturated, fade-to-back)

Every (1/packetRate) seconds:
  snake.head launches:
    - transitions to in-flight on random-pick of client's egresses
    - ~100ms fade-in tween from desaturated to bright
  snake shifts forward; new packet appears at tail
```

Snake length clamped to 10 visible. TrafficSource may buffer internally up to `maxLookAhead = 100`; beyond that, drop at generation with `-x` flash on the client (distinct "topology can't even ingest" failure mode).

### Multi-zone

Wave 9+ has per-zone client instances. Each packet rolls its `originZone` from `zoneDistribution` and is enqueued in that zone's client snake. Each zone animates independently; `packetRate` scales by zone share.

## Rendering contract

### Architecture

Sim = source of truth. Renderer = pure consumer. Zero bidirectional deps.

- Renderer polls `sim.activePackets[]`, `sim.components[]`, `sim.connections[]`, `sim.clients[].snake[]` at frame rate.
- Renderer subscribes to one-shot events: `packet.launched`, `packet.split`, `packet.dropped`, `packet.terminatedWithRevenue`, `response.deliveredToClient`, `cache.hit`, `cache.miss+populated`, `cache.evicted`, `lb.responseMerged`.
- Interpolation: `pos = lerp(prevPos, nextPos, alpha)` where alpha = frame-time fraction through the current sim step.

### Visual elements

| Element | Behavior |
|---|---|
| In-flight packet | Sprite at interpolated edge position. Size = log-scaled by `requests.length` (capped). Label `x{count}` when count ≥ 5 or on hover |
| Snake packet | Up to 10 sprites trailing client, desaturated, fade-to-back opacity ramp |
| Component capacity bar | Thin bar under sprite: `creditsConsumedThisSecond / capacityPerSecond`; fills red as saturation approaches |
| Cache slot strip | Chip strip below cache sprite (e.g. 8 visible) showing current keys as 3-char hashes; LRU left→right; pulse green on hit, swap on miss+populate |
| Two-lane edge | Single curve, request lane offset perpendicular-down, response lane offset perpendicular-up; per-lane load coloring |
| Drop flash | Red `-{count}` at dropping component, 250ms pulse |
| Revenue flash | Green `+${amount}` at terminator (writes) or client (reads); accumulation-window throttled (~200ms window batching) |
| LB split | Parent sprite shrinks, N children burst outward on egress edges |
| LB merge | N response children converge at LB, emit one parent upward |

### Connection drawing UX

One user action (drag from port A to port B) mints twin connections if both sides support bidirectional traffic. Renderer draws a single curve; selection/deletion operates on the pair.

### Flash throttling

Accumulation window: per-component flash events batched into ~200ms buckets. If a component earns $3 × 40 flashes in 200ms, renderer emits one `+$120` flash. Prevents strobing at Wave 10 intensities while preserving signal density.

### Renderer scope cut

Iso renderer becomes the only renderer. Delete:

- `src/dashboard/render/pixi-topology-renderer.ts` (flat DOM renderer)
- `src/dashboard/render/state-to-renderer.ts` (aggregation adapter — no longer needed, renderer reads sim directly)
- `?renderer=iso` flag becomes default; flat renderer option removed from the router

## Testing & determinism

### RNG discipline

Single wave-seeded LCG (existing `makeRng` pattern). Every non-deterministic choice draws from it: attribute rolls, key rolls, zone rolls, random-pick at fan-out, LRU tie-breaks, chaos event timing. No `Math.random`. No `Date.now` outside the sim clock. Map iteration order never load-bearing (sort by id first).

### Mock clock

Headless tests construct the sim and call `sim.step(1/60)` in a loop. Same `step()` function the browser's `requestAnimationFrame` driver layers on top of. One implementation, two drivers.

### Step-internal determinism

Packets sort by `id` (monotonic birth order) before per-step processing. First-come-first-serve capacity allocation, deterministic.

### Test categories

1. **Capability unit tests** — one file per capability; `onArrive` and `onArriveResponse` behaviors exhaustively covered.
2. **Sim-step unit tests** — edge traversal, arrival firing order, snake launch cadence, capacity bucket refill, twin-edge response retracing, LB merge state machine, cache LRU eviction, Zipf key sampling.
3. **Wave integration tests** — per wave, run for `wave.duration` simulated seconds. Assert:
   - cumulative revenue ≥ threshold
   - availability = (responsesDelivered + writesTerminated) / totalRequests ≥ `wave.sla.availability`
   - avg response latency ≤ `wave.sla.maxAvgLatencySeconds`
   - drop rate ≤ `wave.sla.maxDropRate`
4. **Determinism tests** — run same wave + seed twice, assert identical packet outcome streams. Guards against accidental non-determinism.

### Deletions

- `tests/unit/engine-*.test.ts` — entire tick-loop contract surface
- `tests/unit/effective-latency.test.ts`, `pull-from-buffers.test.ts`, `engine-pixi-isolation.test.ts`
- `tests/unit/state-to-renderer-aggregation.test.ts` and adapter tests
- `tests/integration/td/wave-*.test.ts` (all current wave tests)
- `tests/integration/td/campaign-headless.test.ts`

### Survivors

- `tests/unit/component-registry-*.test.ts`
- `tests/unit/td-economy*.test.ts`
- `tests/unit/td-mode-controller-{place,connect,phase}.test.ts` (modulo: `tryConnect` now mints twin connections — update assertions)
- Capability factory tests (re-author assertions against `onArrive`/`onArriveResponse`)

### Projected test count

~400–600 after switchover, vs 825 today. Lower because mid-level tick-step contracts have no analogue. Coverage shape changes, not coverage quality.

### Documentation

- Delete: `docs/claude/simulation-tick.md`, `docs/claude/td-stage-*-gotchas.md` (all).
- Add: `docs/claude/sim-loop.md` (60Hz step contract, packet lifecycle, twin-edge model, RNG discipline), `docs/claude/sim-test-harness.md` (mock-clock fixture, seed conventions).
- Update: `docs/claude/implementation-status.md`, `docs/claude/development.md`, `CLAUDE.md` context hub table.

## Migration plan

### Branch strategy

Worktree at `.worktrees/physics-sim`. Single long-lived branch. Ship behind `#mode=td&sim=physics` URL flag until Wave 1 is verified end-to-end; flip default and delete old engine in the merge commit. No parallel-mode indefinitely — switchover is part of the merge.

### Stages

| Stage | Scope |
|---|---|
| A | Sim core: `src/sim/`, packet/connection/component types, fixed-step loop with mock clock, edge traversal, capacity bucket, `onArrive` contract, twin routing, per-packet RNG. Ports Processing, Forwarding, Caching capabilities |
| B | Wave + client: `WaveDef`, `TrafficSource`, client snake + launch cadence. End-to-end Wave 1 runs headless with revenue + responses + determinism test passing |
| C | Remaining capabilities: LB (split + wait-all merge), CDN, Gateway, Queue + Worker (pull semantics preserved), StreamingServer, DNS/GTM + multi-zone latency |
| D | Waves re-authored: port `WaveDef` for each wave, re-tune intensities (units changed from req/tick to req/sec), author win/lose integration tests per wave. Re-find the teaching arc |
| E | Renderer integration: wire iso renderer to sim. Implement interpolated motion, snake, two-lane edges, capacity bars, cache slot strip, flash events, split/merge animations. Delete flat renderer and adapter |
| F | Switchover: flip `sim=physics` default. Delete `src/core/engine/`. Delete obsolete docs. Tag `pre-physics` at HEAD before this commit for one-command revert |
| G | Polish: flash throttling tuning, label density tuning, snake orientation edge cases, connection twin-edge draw UX, selection/deletion ergonomics surfaced during tuning |

Stage ordering is strict A→B→C; D can begin once C's capability set supports a wave; E can proceed in parallel with D once sim state shape stabilizes. F gates on Wave 1–10 green. G is incremental after F.

### Deliberate scope cuts (v1)

- **REPLICATE / `event` type fan-out** — not implemented in current engine either; stays deferred.
- **Request hedging on LB** — wait-all only in v1; first-arrival is a future capability upgrade.
- **Cache write-through** — v1 is write-around; writes bypass cache except for optional invalidation.
- **Connection-level chaos (bandwidth saturation as a chaos kind)** — latency injection and cross-zone topology survive; bandwidth chaos deferred.
- **Auto-scaling arrival semantics** — Wave 10's instance-count scaling ports as-is; only the arrival-time decision logic changes.

### Rollback

Stages A–C discardable: delete worktree, `main` untouched. From Stage F onward, revert by `git reset --hard pre-physics`. No parallel-engine dead-code situation — the old engine is either present (pre-F) or deleted (post-F).

## Open questions for planning phase

These aren't design-level ambiguities — they're tuning/implementation details to resolve during the planning skill pass:

- **Worker distinguishing flag.** The current `batch` request type becomes... what? A `priority: "background"` flag? A separate ingress port? Placement-based?  Needs a decision before Stage C.
- **Packet speed derivation.** `speed = 1 / connection.latency` in units-per-second. If latency is in seconds, a latency-1s edge takes 1s to cross at speed 1. Need to set typical latency values so wave pacing feels right.
- **CDN vs Data Cache differentiation.** Both are key-keyed LRU caches in the new model. Differentiation becomes configuration (slot count, which attributes they key on, placement). Registry entries define these tuning defaults.
- **Snake direction for multi-egress clients.** "Away from first egress" works when client has one egress. Multi-egress: compute average direction and flip, or snap to cardinal directions to avoid snake-on-network overlap. Implementation detail.
- **Flash accumulation window size.** 200ms is a starting point; tune during Stage G playtest.
