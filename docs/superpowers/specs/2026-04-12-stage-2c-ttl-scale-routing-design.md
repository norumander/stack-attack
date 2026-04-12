# Stage 2c — Bufferable TTL, SCALE Processing, Condition-Aware Routing (Design)

**Status:** Design
**Date:** 2026-04-12
**Depends on:** Stage 2b condition/chaos/upkeep (merged at `a6e883f`)
**Supersedes:** — (first spec for this stage)

## 1. Context and motivation

Stage 2b landed real condition/chaos/upkeep, revenue crediting, and economy
metrics. Three engine gaps remain from Stage 2a/2b that affect correctness
and completeness:

1. **Bufferable TTL hole.** `checkTTL` does not scan `EngineBufferable`
   partitions. Buffered requests get a one-tick grace period before timing
   out. Cascade functions (`applyStrictCascade`, `cascadeParentTimeoutToChildren`)
   cannot remove specific requests from bufferables. The `EngineBufferable`
   interface lacks `peekBuffered` and `removeRequest` methods needed to
   close this gap.

2. **SCALE side effects are ignored.** The `SideEffect` type includes
   `{ kind: "SCALE"; targetInstanceCount: number }` and
   `state.setInstanceCount()` exists, but `deliverStaged` only processes
   SPAWN — SCALE is silently discarded. Components have `instanceCount` but
   no min/max bounds to constrain scaling.

3. **EngineConsultable is unvalidated.** The `EngineConsultable` interface
   and `selectEgressConnection` discovery logic exist, but no concrete
   implementation exercises them. The default round-robin fallback is the
   only routing path that has ever run. Condition-aware routing — routing
   away from degraded components — is a core gameplay mechanic for
   LoadBalancer tier 3+ but has no engine proof.

Stage 2c closes all three gaps. After 2c, buffered requests respect TTL
exactly, the engine honors SCALE side effects, and routing decisions can
factor in component health. These are the last engine-level prerequisites
before Stage 3 can fill in the full capability and component registry.

## 2. Goals

1. `checkTTL` scans bufferable partitions and expires buffered requests at
   exactly `createdAt + ttl <= currentTick`, same as pending requests.
2. `applyStrictCascade` and `cascadeParentTimeoutToChildren` remove
   buffered siblings/children during cascade, not on the next tick.
3. `deliverStaged` processes SCALE side effects by calling
   `state.setInstanceCount` clamped to component bounds.
4. Components gain `minInstances` / `maxInstances` properties that
   constrain SCALE.
5. A concrete `RoutingCapability` implements `EngineConsultable` with
   three tiers: round-robin (T1), least-load (T2), condition-weighted (T3).
6. Per-component metrics snapshot includes `instanceCount`.
7. No changes to `ModeController`, `EconomyStrategy`, or the 10-step tick
   ordering. All changes are additive behind existing contracts.

## 3. Non-goals

- **AutoScaleCapability.** The OBSERVE-phase capability that monitors load
  and emits SCALE side effects is a Stage 3 concrete capability. Stage 2c
  only makes the engine honor SCALE when emitted; tests use a test
  capability that emits SCALE directly.
- **Economy cost for scaling.** No one-time scaling fee or
  `EconomyStrategy.debitScale` method. Upkeep already multiplies by
  `instanceCount` in `deductUpkeep`, so scaling up naturally costs more
  per tick. A one-time fee is a TD-mode concern.
- **Condition-aware default fallback.** The engine's round-robin fallback
  in `egress-selection.ts` stays dumb. Condition-awareness requires a
  `RoutingCapability` — the engine default should not silently change
  behavior for components without one.
- **Request-type-specific routing.** `RoutingCapability` does not inspect
  `request.type` for routing decisions. That is a Stage 3 concern for
  content-based routing (APIGateway tier 2+).
- **`dequeueBatch` implementation.** The existing `dequeueBatch(n)`
  method on `EngineBufferable` stays unused. It is reserved for future
  batch-drain patterns and is not needed by any Stage 2c consumer.

## 4. Architecture overview

Stage 2c touches three distinct subsystems. No new tick steps are added.

```
src/core/capability/
  engine-interfaces.ts     → modified: EngineBufferable gains peekBuffered + removeRequest

src/core/component/
  component.ts             → modified: minInstances / maxInstances properties
  component-reader.ts      → modified: expose minInstances / maxInstances readonly

src/core/engine/
  check-ttl.ts             → modified: Scan 3 (bufferable partition scan)
  cascade.ts               → modified: applyStrictCascade + cascadeParentTimeoutToChildren
                                        scan bufferables for siblings/children
  deliver-staged.ts        → modified: process SCALE side effects;
                                        side-effect loop changes from skip-non-SPAWN
                                        to if/if structure
  egress-selection.ts      → modified: gains modeController parameter;
                                        builds real ProcessContext for consultable
  metrics-builder.ts       → modified: per-component snapshot includes instanceCount

src/core/types/
  request.ts               → modified: add "SCALED" to RequestEventType union
  metrics.ts               → modified: per-component gains instanceCount field

src/capabilities/
  routing/
    routing-capability.ts  → new: RoutingCapability (EngineConsultable, T1–T3)

tests/
  unit/ttl-bufferable.test.ts                → new
  unit/cascade-bufferable.test.ts            → new
  unit/scale-processing.test.ts              → new
  unit/routing-capability.test.ts            → new
  unit/tick-metrics-shape.test.ts            → modified: add instanceCount to fixture
  integration/ttl-bufferable.test.ts         → new
  integration/scale-processing.test.ts       → new
  integration/condition-routing.test.ts      → new
  harness/test-capabilities.ts               → modified: TestQueueCapability
  harness/scaling-capability.ts              → new: TestScalingCapability
```

### 4.1 Data flow

```
tick boundary
 │
 ├─ steps 1..4b (unchanged)
 │
 ├─ step 5 checkTTL
 │    Scan 1: pending (unchanged)
 │    Scan 2: blocked-pool (unchanged)
 │    Scan 3: bufferable partitions (NEW)
 │      reads  : EngineBufferable.peekBuffered() on all components
 │      writes : EngineBufferable.removeRequest() for expired
 │               state.requestLog (TIMED_OUT events)
 │               perComponentThisTick.timeouts
 │               cascade side effects (applyStrictCascade)
 │
 ├─ step 3 deliverStaged (within fixed-point loop)
 │    SCALE processing (NEW, alongside existing SPAWN processing):
 │      reads  : result.sideEffects where kind === "SCALE"
 │               component.minInstances, component.maxInstances
 │      writes : state.setInstanceCount (clamped)
 │               state.requestLog (SCALED event on triggering request)
 │
 ├─ step 3 egress-selection (within deliverStaged FORWARD path)
 │    selectEgressConnection gains modeController param (NEW):
 │      computes: effective tier for the discovered EngineConsultable
 │      builds : real ProcessContext with correct effectiveTier
 │    RoutingCapability (NEW, via existing EngineConsultable discovery):
 │      reads  : context.effectiveTier (real tier, not placeholder 0)
 │               egressConnections[].currentLoad, bandwidth
 │               target component condition (via context.state)
 │      returns: ConnectionId of chosen egress
 │
 ├─ step 8 recordMetrics
 │    reads  : component.instanceCount (NEW field in snapshot)
 │
 └─ steps 9..10 (unchanged)
```

### 4.2 Cascade data flow (updated)

```
applyStrictCascade (UP-cascade, blocking child fails)
 │
 ├─ Scan sibling in state.pending queues (existing)
 ├─ Scan sibling in EngineBufferable partitions (NEW)
 │    for each component in visitOrder:
 │      for each EngineBufferable capability:
 │        call removeRequest(siblingId)
 │        if found: attribute SIBLING_CANCELLED + DROPPED to that component
 │
 └─ Recursive cascade for nested blocked siblings (existing)

cascadeParentTimeoutToChildren (DOWN-cascade, parent times out)
 │
 ├─ Scan child in state.pending queues (existing)
 ├─ Scan child in EngineBufferable partitions (NEW)
 │    same pattern: iterate components × bufferables × removeRequest
 ├─ Scan child in state.blockedParents (existing, recursive)
 │
 └─ Attribution: component where child was found, else fallback
```

## 5. Module design

### 5.1 EngineBufferable interface extension

Two new methods on `EngineBufferable` in
`src/core/capability/engine-interfaces.ts`:

```ts
export interface EngineBufferable {
  // Existing methods (unchanged)
  enqueueForRetry(request: Request, result: ProcessResult): boolean;
  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  };
  dequeueBatch(n: number): Request[];

  // NEW: snapshot of all buffered items without draining.
  // Returns a defensive copy in insertion order (FIFO).
  // Implementations MUST return a copy, not a live view — the caller
  // may call removeRequest() during iteration of the returned array.
  peekBuffered(): ReadonlyArray<{ request: Request; result: ProcessResult }>;

  // NEW: remove a specific request by ID. Returns true if found and removed.
  // Used by checkTTL (Scan 3) and cascade functions.
  removeRequest(id: RequestId): boolean;
}
```

The `isEngineBufferable` type guard is updated to also check for
`peekBuffered`, ensuring stale implementations that lack the new methods
are not accepted at runtime:

```ts
export function isEngineBufferable(
  c: Capability,
): c is Capability & EngineBufferable {
  return (
    typeof (c as unknown as EngineBufferable).enqueueForRetry === "function" &&
    typeof (c as unknown as EngineBufferable).peekBuffered === "function"
  );
}
```

### 5.2 `checkTTL` Scan 3 — bufferable partition scan

Added after the existing blocked-pool scan (Scan 2) in `check-ttl.ts`:

```ts
// --- BUFFERABLE PARTITION SCAN (Stage 2c) ---
for (const componentId of state.visitOrder) {
  const component = state.components.get(componentId);
  if (!component) continue;

  for (const cap of component.capabilities.values()) {
    if (!isEngineBufferable(cap)) continue;
    const buffered = cap.peekBuffered();

    for (const entry of buffered) {
      if (entry.request.createdAt + entry.request.ttl > state.currentTick) {
        continue;
      }

      // Expired — remove from buffer. If removeRequest returns false,
      // the request was already removed by a cascade from an earlier
      // expiration in this same scan pass. Skip to avoid duplicate events.
      if (!cap.removeRequest(entry.request.id)) continue;

      state.appendEvent(entry.request.id, {
        tick: state.currentTick,
        componentId,
        capabilityId: null,
        connectionId: null,
        type: "TIMED_OUT",
        latencyAdded: 0,
      });
      getOrInitCounters(state, componentId).timeouts += 1;
      applyStrictCascade(state, entry.request.id);
    }
  }
}
```

**Ordering:** `visitOrder` iteration ensures deterministic scan order.
Within a component, `peekBuffered()` returns items in insertion order.

**Scan 3 runs after Scans 1 and 2.** A request that expired while buffered
is found here. If that request is also a blocking child, `applyStrictCascade`
fires the UP-cascade — the parent may still be in `blockedParents`
(Scan 2 only times out parents whose own TTL expired, not parents whose
children expired).

### 5.3 Cascade updates

#### `applyStrictCascade` — sibling scan extension

After the existing pending-queue scan for siblings, add a bufferable scan:

```ts
// Existing: scan pending queues for sibling
let found: ComponentId | null = null;
for (const [componentId, queue] of state.pending) { /* ... */ }

// NEW: if not found in pending, scan bufferables
if (!found) {
  for (const componentId of state.visitOrder) {
    const comp = state.components.get(componentId);
    if (!comp) continue;
    for (const cap of comp.capabilities.values()) {
      if (!isEngineBufferable(cap)) continue;
      if (cap.removeRequest(siblingId)) {
        found = componentId;
        break;
      }
    }
    if (found) break;
  }
}
```

The sibling is in exactly one location — pending, bufferable, or
blockedParents. The search stops at the first hit. `visitOrder` ensures
deterministic scan order for the bufferable path.

#### `cascadeParentTimeoutToChildren` — child scan extension

Same pattern. After the existing pending-queue scan for each child, scan
bufferables before falling through to the blockedParents check:

```ts
// Existing: scan pending queues for child
let found: ComponentId | null = null;
for (const [componentId, queue] of state.pending) { /* ... */ }

// NEW: if not found in pending, scan bufferables
if (!found) {
  for (const componentId of state.visitOrder) {
    const comp = state.components.get(componentId);
    if (!comp) continue;
    for (const cap of comp.capabilities.values()) {
      if (!isEngineBufferable(cap)) continue;
      if (cap.removeRequest(childId)) {
        found = componentId;
        break;
      }
    }
    if (found) break;
  }
}
```

If found in a bufferable, the child is attributed to the component where it
was removed. The existing blockedParents recursive cascade check follows —
a child cannot be in both a bufferable and blockedParents simultaneously,
so the order of these checks doesn't matter for correctness.

#### Known limitation: recursive grandchild cascade

`applyStrictCascade` has a recursive path (lines 95–101 of `cascade.ts`)
for when a cancelled sibling is itself a blocking parent. The current code
deletes grandchildren from `childToParent` but does not remove them from
pending queues or bufferables (`TODO(stage-2b)` at line 100). Stage 2c
adds bufferable scanning for first-level siblings and children but does
not extend this recursive grandchild path. Grandchildren stuck in
bufferables after their grandparent was cascaded will time out via Scan 3
on the next tick (no longer a multi-tick grace period thanks to the new
bufferable scan), producing `TIMED_OUT` instead of `SIBLING_CANCELLED`.
Closing this requires a deeper refactor of the recursive cascade that is
out of scope. The TODO remains.

### 5.4 TestQueueCapability changes

`tests/harness/test-capabilities.ts` — `TestQueueCapability`:

```ts
// Buffer changes from array to Map for O(1) lookup/removal
private buffer: Map<RequestId, { request: Request; result: ProcessResult }> = new Map();

enqueueForRetry(request: Request, result: ProcessResult): boolean {
  if (this.buffer.size >= this.capacity) return false;
  this.buffer.set(request.id, { request, result });
  return true;
}

emitReady(): {
  awaitingPipeline: Request[];
  awaitingDelivery: { request: Request; result: ProcessResult }[];
} {
  const out = [...this.buffer.values()];
  this.buffer.clear();
  return { awaitingPipeline: [], awaitingDelivery: out };
}

peekBuffered(): ReadonlyArray<{ request: Request; result: ProcessResult }> {
  return [...this.buffer.values()];
}

removeRequest(id: RequestId): boolean {
  return this.buffer.delete(id);
}
```

Map preserves insertion order (ES2015+), so `peekBuffered()` and
`emitReady()` return items in FIFO order.

### 5.5 SCALE side effect processing

#### Component changes

`src/core/component/component.ts` — add `minInstances` and `maxInstances`:

```ts
export interface ComponentConstructorArgs {
  // ... existing fields ...
  readonly minInstances?: number;    // NEW: floor for scaling (default 1)
  readonly maxInstances?: number;    // NEW: ceiling for scaling (default 1)
}

export class Component implements ComponentReader {
  // ... existing fields ...
  readonly minInstances: number;     // NEW
  readonly maxInstances: number;     // NEW

  constructor(args: ComponentConstructorArgs) {
    // ... existing assignments ...
    this.minInstances = args.minInstances ?? 1;
    this.maxInstances = args.maxInstances ?? 1;
  }
}
```

`src/core/component/component-reader.ts`:

```ts
export interface ComponentReader {
  // ... existing fields ...
  readonly minInstances: number;     // NEW
  readonly maxInstances: number;     // NEW
}
```

When `maxInstances === 1` (default), SCALE side effects clamp to 1 — a
no-op. Existing components are unaffected. Only components explicitly
configured with `maxInstances > 1` can scale.

#### Request event type

`src/core/types/request.ts` — add `"SCALED"` to the `RequestEventType`
union:

```ts
export type RequestEventType =
  | /* ... existing types ... */
  | "SCALED";
```

The `SCALED` event is appended to the triggering request's event log with
metadata `{ from: number; to: number }` recording the previous and new
instance count. This ties the scaling action to its cause for traceability.

#### deliverStaged changes

The existing side-effects loop in `deliver-staged.ts` uses a skip pattern:
`if (se.kind !== "SPAWN") continue;`. This changes to an `if/if` structure
that handles both SPAWN and SCALE. This is a modification to the loop
structure, not a simple addition after it:

```ts
// Process side effects before the primary outcome.
for (const se of result.sideEffects) {
  if (se.kind === "SPAWN") {
    // ... existing SPAWN logic (unchanged) ...
  }

  if (se.kind === "SCALE") {
    const comp = state.components.get(sourceComponentId);
    if (!comp) continue;
    const clamped = Math.max(
      comp.minInstances,
      Math.min(comp.maxInstances, se.targetInstanceCount),
    );
    if (clamped !== comp.instanceCount) {
      const from = comp.instanceCount;
      state.setInstanceCount(sourceComponentId, clamped);
      state.appendEvent(request.id, {
        tick: state.currentTick,
        componentId: sourceComponentId,
        capabilityId: null,
        connectionId: null,
        type: "SCALED",
        latencyAdded: 0,
        metadata: { from, to: clamped },
      });
    }
  }
}
```

**Timing:** SCALE takes effect immediately within the current tick's
fixed-point loop. Subsequent deliveries in the same tick see the updated
`instanceCount` (and therefore updated throughput). This is consistent with
SPAWN (spawned children enter pending immediately). The throughput
calculation in `componentThroughputPerTick` reads `component.instanceCount`
dynamically, so the effect is automatic.

**Clamping:** The engine clamps `targetInstanceCount` to
`[minInstances, maxInstances]`. If the clamped value equals the current
count, no mutation occurs and no event is appended. `setInstanceCount`
additionally floors at 0 (existing behavior), but `minInstances >= 1`
prevents this path in practice.

**Self-targeting:** SCALE always targets `sourceComponentId` — the
component that emitted the side effect. The `SideEffect` type has no
`targetComponentId` field. This is correct for the self-scaling use case
(a component's AutoScaleCapability scales itself). If Stage 3 needs
cross-component scaling (e.g., an orchestrator scaling a downstream
server), the `SideEffect` type would need a `targetComponentId?: ComponentId`
extension. That is out of scope for Stage 2c.

**No-op for default components:** When `maxInstances === 1` (default),
any SCALE target clamps to 1, which equals the default `instanceCount`.
No event, no mutation.

#### Metrics changes

`src/core/types/metrics.ts` — add `instanceCount` to per-component:

```ts
export interface TickMetrics {
  // ... existing top-level fields ...
  readonly perComponent: ReadonlyMap<
    ComponentId,
    {
      // ... existing fields ...
      instanceCount: number;   // NEW
    }
  >;
}
```

`src/core/engine/metrics-builder.ts` — populate in the per-component
snapshot:

```ts
perComponent.set(id, {
  // ... existing fields ...
  instanceCount: state.components.get(id)?.instanceCount ?? 1,
});
```

#### Test harness: TestScalingCapability

`tests/harness/scaling-capability.ts` — a PROCESS-phase capability that
emits SCALE on every request:

```ts
export class TestScalingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(
    readonly id: CapabilityId,
    private readonly targetInstanceCount: number,
  ) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return {
      outcome: { kind: "RESPOND" },
      sideEffects: [{ kind: "SCALE", targetInstanceCount: this.targetInstanceCount }],
      events: [],
    };
  }

  getUpkeepCost(_tier: number): number { return 1; }
  getStats() { return {}; }
}
```

This avoids building a real AutoScaleCapability (Stage 3 concern) while
exercising the engine's SCALE processing end-to-end.

### 5.6 RoutingCapability

`src/capabilities/routing/routing-capability.ts`:

```ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { EngineConsultable } from "@core/capability/engine-interfaces";
import type { Request } from "@core/types/request";
import type { Connection } from "@core/types/connection";
import type { ProcessResult } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId, ConnectionId, ComponentId } from "@core/types/ids";

export class RoutingCapability implements Capability, EngineConsultable {
  readonly phase = "INTERCEPT" as const;
  private cursor = 0;

  constructor(readonly id: CapabilityId) {}

  // --- Capability (pipeline-invisible) ---

  canHandle(_requestType: string): boolean {
    return false; // never intercepts; discovered only via isEngineConsultable
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    return { outcome: { kind: "PASS" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    // T1 is free (same as default round-robin). T2/T3 add overhead.
    if (tier <= 1) return 0;
    if (tier === 2) return 2;
    return 5;
  }

  getStats(): CapabilityStats {
    return {};
  }

  resetPerTickState(): void {
    // cursor persists across ticks (round-robin state)
  }

  // --- EngineConsultable ---

  selectConnection(
    _request: Request,
    egressConnections: Connection[],
    context: ProcessContext,
  ): ConnectionId {
    if (egressConnections.length === 0) {
      throw new Error("selectConnection called with no egress connections");
    }

    // effectiveTier is set by selectEgressConnection (§5.7) to this
    // capability's real tier. Fallback to effectiveTiers map for safety.
    const tier = context.effectiveTier
      || context.effectiveTiers.get(this.id)
      || 0;

    if (tier <= 1) {
      return this.roundRobin(egressConnections);
    }

    if (tier === 2) {
      return this.leastLoad(egressConnections);
    }

    // Tier 3+: condition-weighted
    return this.conditionWeighted(egressConnections, context);
  }

  // --- Strategies ---

  private roundRobin(connections: Connection[]): ConnectionId {
    const chosen = connections[this.cursor % connections.length]!;
    this.cursor += 1;
    return chosen.id;
  }

  private leastLoad(connections: Connection[]): ConnectionId {
    let best = connections[0]!;
    let bestRatio = best.currentLoad / Math.max(best.bandwidth, 1);

    for (let i = 1; i < connections.length; i++) {
      const c = connections[i]!;
      const ratio = c.currentLoad / Math.max(c.bandwidth, 1);
      if (ratio < bestRatio) {
        best = c;
        bestRatio = ratio;
      }
    }
    return best.id;
  }

  private conditionWeighted(
    connections: Connection[],
    context: ProcessContext,
  ): ConnectionId {
    let bestId = connections[0]!.id;
    let bestScore = -1;

    for (const conn of connections) {
      const targetId = conn.target.componentId;
      const target = context.state.components.get(targetId);
      const condition = target?.condition ?? 1.0;
      const availableCapacity = 1 - conn.currentLoad / Math.max(conn.bandwidth, 1);
      const score = condition * Math.max(0, availableCapacity);

      if (score > bestScore) {
        bestScore = score;
        bestId = conn.id;
      }
    }

    // Fallback: if all scores are 0 (fully saturated), use round-robin.
    if (bestScore <= 0) {
      return this.roundRobin(connections);
    }

    return bestId;
  }
}
```

**Pipeline presence:** Phase `INTERCEPT` with `canHandle() => false`. The
capability is invisible in the INTERCEPT/PROCESS/REPLICATE/OBSERVE pipeline.
The engine discovers it solely via `isEngineConsultable()` in
`egress-selection.ts`. This follows the same pattern as
`TestQueueCapability` (phase INTERCEPT, canHandle false, useful only through
its sub-interface).

**Tier progression:**

| Tier | Strategy | Selection rule |
|------|----------|----------------|
| T1 | Round-robin | Cycle through egress connections in order. Same behavior as engine default but explicit. |
| T2 | Least-load | Pick connection with lowest `currentLoad / bandwidth` ratio. Deterministic tie-breaking by connection order. |
| T3 | Condition-weighted | Score = `targetCondition * max(0, 1 - currentLoad/bandwidth)`. Pick highest score. Falls back to round-robin if all scores are 0. |

**T3 scoring rationale:** A single formula naturally balances health and
capacity. Condition (0–1) and available capacity (0–1) multiply:
- Healthy (1.0) + empty (0 load) = 1.0 (best)
- Healthy (1.0) + half-loaded = 0.5
- Degraded (0.5) + empty = 0.5
- Critical (0.2) + empty = 0.2 (last resort)

No threshold partitioning is needed. The formula continuously prefers
healthier, less-loaded targets without cliff edges.

**Reading target condition:** Via
`context.state.components.get(conn.target.componentId)?.condition ?? 1.0`.
The `SimulationStateReader` already exposes component conditions through
`ComponentReader` — no new interfaces needed. The `?? 1.0` fallback treats
unknown components as healthy (conservative; avoids penalizing components
not yet registered).

**Cursor persistence:** The round-robin cursor is instance state on the
capability, not `state.roundRobinCursor`. This means each `RoutingCapability`
maintains its own cursor independent of the engine default. The engine's
`roundRobinCursor` is only used when no `EngineConsultable` is present.

**Upkeep collection:** `RoutingCapability` must be in the
`ModeController.getActiveCapabilities` set for its upkeep to be counted by
`Component.getUpkeepCost`. The existing `NoOpModeController` and
`SandboxModeController` return all capabilities as active, so this works
out of the box. TD mode must include it in the active set when unlocked.

### 5.7 `selectEgressConnection` changes

The current `selectEgressConnection` in `egress-selection.ts` passes a
placeholder `ProcessContext` with `effectiveTier: 0` to
`EngineConsultable.selectConnection`. This makes T2/T3 routing unreachable.

Stage 2c modifies `selectEgressConnection` to accept `modeController` and
compute a real `ProcessContext` for the discovered consultable:

```ts
export function selectEgressConnection(
  state: SimulationState,
  sourceComponentId: ComponentId,
  request: Request,
  modeController: ModeController,  // replaces ctx: ProcessContext
): ConnectionId | null {
  const source = state.components.get(sourceComponentId);
  if (!source) return null;

  const egresses = [...state.connections.values()]
    .filter((c) => c.source.componentId === sourceComponentId)
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  if (egresses.length === 0) return null;

  for (const cap of source.capabilities.values()) {
    if (isEngineConsultable(cap)) {
      // Compute the effective tier for this specific consultable capability.
      const playerTier = source.getPlayerTier(cap.id);
      const tierCap = modeController.getTierCap(source, cap.id);
      const effectiveTier = Math.min(playerTier, tierCap);

      const ctx: ProcessContext = {
        state: state.asReader(),
        componentId: sourceComponentId,
        effectiveTier,
        effectiveTiers: new Map([[cap.id, effectiveTier]]),
        activeCapabilityIds: modeController.getActiveCapabilities(source),
        currentTick: state.currentTick,
        rng: null as unknown as never,  // routing should not use RNG
        directories: [],
        childResponses: new Map(),
      };

      return cap.selectConnection(request, egresses, ctx);
    }
  }

  // No consultable — fall back to round-robin.
  const cursor = state.roundRobinCursor.get(sourceComponentId) ?? 0;
  const chosen = egresses[cursor % egresses.length]!;
  state.roundRobinCursor.set(sourceComponentId, cursor + 1);
  return chosen.id;
}
```

**Call site change in `deliverStaged`:** The FORWARD path currently calls
`selectEgressConnection(state, sourceComponentId, request, placeholderCtx)`.
This changes to `selectEgressConnection(state, sourceComponentId, request, modeController)`.
The placeholder `ProcessContext` construction (lines 212–222 in the current
`deliver-staged.ts`) is removed entirely.

**Why `modeController` instead of threading `ProcessContext`:** The
`ProcessContext` built in `processPending` is per-PROCESS-capability
(its `effectiveTier` is for the processing capability, not the routing
capability). Routing needs the tier of the *consultable* capability, which
is different. Computing it fresh in `selectEgressConnection` is correct
and avoids plumbing a second context through `StagedOutcome`.

## 6. Invariants and contracts

### 6.1 Bufferable TTL

- **Exact TTL expiry:** A buffered request expires at `createdAt + ttl <=
  currentTick`, same condition as pending and blocked-pool scans. No
  grace period.
- **Scan 3 ordering:** After Scans 1 and 2. A request that was re-emitted
  by `reEmitQueued` at the start of the tick and then processed into pending
  will be caught by Scan 1. Only requests that remain in bufferables
  (not yet re-emitted, or newly buffered during the fixed-point loop)
  are caught by Scan 3.
- **Cascade correctness:** A request can be in exactly one of: pending,
  bufferable, blockedParents, or terminal. The cascade scan searches
  pending first, then bufferables, then blockedParents. The first hit
  wins and the search stops.

### 6.2 SCALE processing

- **Clamping:** `targetInstanceCount` is clamped to
  `[component.minInstances, component.maxInstances]` before mutation.
  `setInstanceCount` additionally floors at 0.
- **Idempotent no-op:** If clamped value equals current `instanceCount`,
  no mutation and no event. Default components (`maxInstances === 1`)
  never produce SCALE events.
- **Immediate effect:** SCALE takes effect within the same tick's
  fixed-point loop. Throughput scales immediately because
  `componentThroughputPerTick` reads `instanceCount` dynamically.
- **Upkeep scaling:** `deductUpkeep` already multiplies by `instanceCount`
  (`component.getUpkeepCost() * instanceCount`). No changes needed — a
  scaled-up component automatically pays more upkeep on the same tick.

### 6.3 RoutingCapability

- **Real effective tier:** `selectEgressConnection` computes the
  consultable's effective tier from `min(playerTier, modeController.tierCap)`.
  The placeholder `ProcessContext` with `effectiveTier: 0` is eliminated.
  T1/T2/T3 strategies are reachable through normal engine paths.
- **Deterministic egress list:** `selectEgressConnection` sorts egress
  connections by connection ID before passing to the consultable. The
  `RoutingCapability` receives a stable-ordered list.
- **Fallback guarantee:** T3 falls back to round-robin when all scores
  are 0. The capability never returns an invalid `ConnectionId`.
- **Condition source:** Reads from `context.state` (a `SimulationStateReader`).
  Condition values reflect the state after `updateCondition` and
  `injectChaos` from the previous tick. Within a tick, condition is not
  updated until step 6 (after all processing).
- **No bandwidth enforcement:** The `RoutingCapability` selects a
  connection but does not enforce bandwidth. `deliverStaged` handles
  backpressure downstream. A saturated connection will trigger the
  existing backpressure path regardless of routing.

## 7. Test strategy

### 7.1 Unit tests

**`ttl-bufferable.test.ts`:**
- Request buffered via `enqueueForRetry`, TTL expires, Scan 3 removes it
  and appends TIMED_OUT
- Request buffered, TTL NOT expired, survives Scan 3
- Multiple buffered requests, only expired ones removed (FIFO preserved)
- Scan 3 fires `applyStrictCascade` for expired blocking children

**`cascade-bufferable.test.ts`:**
- `applyStrictCascade`: sibling in bufferable found and removed,
  SIBLING_CANCELLED + DROPPED appended
- `cascadeParentTimeoutToChildren`: child in bufferable found and removed,
  TIMED_OUT appended
- Child in bufferable, sibling in pending: both found and removed in
  single cascade pass
- Child not in pending or bufferable: falls through to blockedParents check

**`scale-processing.test.ts`:**
- SCALE side effect clamps to [minInstances, maxInstances]
- SCALE that matches current instanceCount: no event, no mutation
- SCALE on default component (maxInstances=1): no-op
- SCALE produces SCALED event with correct from/to metadata
- Multiple SCALE side effects on same request: each applied sequentially,
  each producing its own SCALED event (e.g., SCALE(3) then SCALE(5)
  produces events {from:1,to:3} and {from:3,to:5}, final count is 5)

**`routing-capability.test.ts`:**
- T1: round-robin cycles through connections
- T2: picks least-loaded connection
- T2: tie-breaking by connection order (first wins)
- T3: prefers healthy + lightly-loaded targets
- T3: routes away from degraded component
- T3: all connections saturated → falls back to round-robin
- T3: unknown target component → treats as healthy (condition 1.0)

### 7.2 Integration tests

**`ttl-bufferable.test.ts`** (integration):
- Request flows through topology, gets backpressured into buffer, TTL
  expires in buffer, correctly timed out and cascade fires

**`scale-processing.test.ts`** (integration):
- Component processes request, emits SCALE(3), throughput triples on
  subsequent tick, upkeep triples

**`condition-routing.test.ts`** (integration):
- Two target components behind a RoutingCapability T3. One degrades
  (condition drops). Traffic shifts to healthy target. Verifies routing
  decisions change as condition changes across ticks.

## 8. Feature interaction

### 8.1 Bufferable TTL + condition

A request timing out in a bufferable partition increments the timeout
counter for that component. `updateCondition` (step 6) reads the counter
and may degrade the component's condition. This is correct — a component
that buffers requests until they expire should be penalized.

### 8.2 SCALE + upkeep

Scaling up increases `instanceCount`, which multiplies both throughput and
upkeep cost. A component that scales from 1 to 3 instances pays 3x upkeep
starting on the same tick. If the economy cannot afford the upkeep,
`deductUpkeep` → `resolveInsolvency` may zero the component's condition,
which in turn triggers condition effects (throughput_multiplier,
drop_probability). This feedback loop is intentional — scaling without
revenue to support it is a losing strategy.

### 8.3 SCALE + condition effects

`instanceCount` multiplies the base throughput first (in
`componentThroughputPerTick`), then `throughput_multiplier` from condition
effects scales the result (in `processPending`). So a degraded component
with `throughput_multiplier: 0.5` and `instanceCount: 3` has effective
throughput of `(base * 3) * 0.5`. The result is mathematically identical
to `base * 0.5 * 3` since multiplication is commutative, but the code path
order is instanceCount first, then condition multiplier. Scaling up a
degraded component gives diminished returns — the player should fix
condition first.

### 8.4 Routing + chaos

A `component_failure` chaos event zeros condition. T3 routing scores that
component at 0, routing all traffic to healthy targets. A `zone_outage`
zeros all components in a zone, and T3 routing shifts to connections
targeting components in other zones. This is the core gameplay loop for
chaos waves.

### 8.5 Routing + SCALE

Routing and scaling are independent. A component that scales up does not
directly affect routing decisions — routing reads condition and load, not
instance count. However, a scaled-up component has higher effective
bandwidth (throughput × instanceCount), so its connections saturate more
slowly, indirectly making it a more attractive T2/T3 routing target.

## 9. Exit criteria

Stage 2c is complete when:

1. All unit and integration tests pass (~30–40 new tests, total ~410–420).
2. `pnpm typecheck` passes with no new type errors.
3. Existing 378 tests continue to pass (no regressions).
4. The `checkTTL` TODO comment referencing Stage 2a limitation is removed.
5. The `cascade.ts` Stage 2a scope comments about bufferable scanning
   are removed.
6. The `deliverStaged` side-effects loop is restructured from the
   skip-non-SPAWN pattern to handle both SPAWN and SCALE. The placeholder
   `ProcessContext` in the FORWARD path is replaced with the real context
   built by `selectEgressConnection`.
7. CLAUDE.md is updated to reflect Stage 2c completion and list Stage 2c
   gotchas.

## 10. Design decisions and rationale

### 10.1 `peekBuffered` vs. `getBufferedRequestIds`

`peekBuffered` returns full `{ request, result }` entries rather than just
IDs because `checkTTL` needs `request.createdAt` and `request.ttl` to
evaluate expiry. Returning only IDs would require a second lookup to
access the request, which is both slower and requires a separate
`getRequest(id)` method.

### 10.2 Map-based buffer for TestQueueCapability

Switching from `Array<{ request, result }>` to `Map<RequestId, { request, result }>`
gives O(1) lookup for `removeRequest` instead of O(n) linear scan. Map
preserves insertion order (ES2015+), so `emitReady()` and `peekBuffered()`
maintain FIFO ordering. The tradeoff is slightly more memory per entry
(Map overhead), which is negligible for buffer sizes in this game.

### 10.3 SCALE timing: immediate vs. next-tick

SCALE takes effect immediately, consistent with SPAWN (spawned children
enter pending immediately). Deferring to next tick would create a
confusing inconsistency — two side effects of the same request taking
effect at different times. Immediate effect also means throughput scales
within the same fixed-point loop iteration, which is correct: adding
workers to a server makes it faster right away, not on the next heartbeat.

### 10.4 RoutingCapability phase

RoutingCapability uses phase `INTERCEPT` with `canHandle() => false`. This
is the same pattern as `TestQueueCapability`. The capability exists on the
component for discovery via `isEngineConsultable()` but never runs in the
processing pipeline. A future refactor could split `Capability` into
pipeline capabilities (with phase) and engine-extension capabilities
(EngineConsultable, EngineBufferable), but that refactor is out of scope
for Stage 2c and would touch every capability implementation.

### 10.5 T3 scoring formula

A multiplicative formula (`condition * availableCapacity`) was chosen over
threshold-based partitioning (e.g., "healthy pool first, then degraded")
because:
- No cliff edges at threshold boundaries
- Single formula, no branching logic
- Naturally handles partial degradation (condition 0.6 vs. 0.3)
- Load and health trade off smoothly (a slightly degraded but empty server
  may be better than a healthy but nearly-full one)

The formula can be extended in Stage 3 with additional factors (latency,
zone affinity) by adding terms to the score.
