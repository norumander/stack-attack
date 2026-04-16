# CircuitBreaker Wiring Design

**Status:** Design approved 2026-04-15. Engine change to make CircuitBreakerCapability actually work.

## 1. Goal

Wire up `CircuitBreakerCapability.reportFailure()` and `reportSuccess()` so the CB state machine actually transitions based on downstream request outcomes. Currently CB is decorative — the methods exist but are never called. This blocks Wave 7's "failure isolation" teaching arc.

After this change: chaos events that kill downstream servers cause drops/timeouts → those failures notify upstream CBs → CB threshold (5 failures) trips → CB state goes OPEN → subsequent requests fast-fail (DROP/circuit_open) instead of piling up on dead paths → healthy servers absorb the load.

## 2. Architectural context

### What exists

1. **`CircuitBreakerCapability` has a complete state machine** (`src/capabilities/circuit-breaker/circuit-breaker-capability.ts`):
   - States: CLOSED, OPEN, HALF_OPEN
   - `reportFailure(tick, {tier})` — increments failureCount, trips OPEN at threshold (5 at tier 1-2, 3 at tier 3+)
   - `reportSuccess()` — transitions HALF_OPEN → CLOSED, resets failureCount
   - `process()` — in OPEN state, DROPs requests with reason "circuit_open"; in CLOSED/HALF_OPEN, passes through

2. **Request event log is complete** (`src/core/state/simulation-state.ts:68-76`):
   - Every component a request passes through emits events to `state.requestLog.get(requestId)`
   - Event structure: `{ tick, componentId, capabilityId, connectionId, type, latencyAdded, metadata }`
   - Event types include DROPPED, TIMED_OUT, BACKPRESSURED, RESPOND, FORWARDED, PROCESSED, TRAVERSED

3. **`return-path.ts` already walks event logs** (lines 11-34). Same pattern applies for finding upstream CBs.

4. **Three failure emission points** in the engine:
   - `deliver-staged.ts:229` — DROP outcome → appends DROPPED event
   - `check-ttl.ts:51-62` — pending queue scan → appends TIMED_OUT event
   - `check-ttl.ts:83-90` — blocked parent scan → appends TIMED_OUT event

5. **One success emission point**:
   - `deliver-staged.ts` RESPOND handler — credits revenue for successful requests

### The gap

`CircuitBreakerCapability.reportFailure()` is called by **zero production code paths**. Only the unit tests call it directly. CB stays CLOSED indefinitely, `process()` always returns PASS, and the state machine never exercises.

## 3. Design

### 3a. New file: `src/core/engine/notify-circuit-breakers.ts`

Pure function. Takes a requestId and a "failure" | "success" kind. Walks the request's event log backward, deduplicates by componentId (so each component is visited once even if it appears in multiple events), finds components with a CircuitBreakerCapability, and calls the appropriate method.

```ts
import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { RequestId, ComponentId } from "../types/ids.js";

/**
 * Walks a request's event log backward and notifies any CircuitBreaker
 * capabilities the request passed through. Failure reports accumulate
 * toward the CB's tripping threshold; success reports complete the
 * HALF_OPEN → CLOSED transition.
 */
export function notifyCircuitBreakers(
  state: SimulationState,
  modeController: ModeController,
  requestId: RequestId,
  kind: "failure" | "success",
): void {
  const events = state.requestLog.get(requestId);
  if (!events || events.length === 0) return;

  const visitedComponents = new Set<ComponentId>();

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (visitedComponents.has(event.componentId)) continue;
    visitedComponents.add(event.componentId);

    const comp = state.components.get(event.componentId);
    if (!comp) continue;

    for (const cap of comp.capabilities.values()) {
      // Duck-type check: any capability with reportFailure + reportSuccess
      // qualifies. Today only CircuitBreakerCapability has this shape;
      // the interface could be extracted later if needed.
      const maybeCB = cap as unknown as {
        reportFailure?: (tick: number, ctx?: { tier?: number }) => void;
        reportSuccess?: () => void;
      };
      if (typeof maybeCB.reportFailure !== "function") continue;
      if (typeof maybeCB.reportSuccess !== "function") continue;
      const tier = comp.getPlayerTier(cap.id);
      if (kind === "failure") {
        maybeCB.reportFailure(state.currentTick, { tier });
      } else {
        maybeCB.reportSuccess();
      }
    }
  }
}
```

**Design notes:**
- Deduplication by componentId prevents multi-count when a component appears in multiple events (e.g., FORWARDED + TRAVERSED + PROCESSED).
- Walks backward so most recent components are checked first, but all are notified (threshold-filtered).
- Duck-types via `reportFailure`/`reportSuccess` presence — avoids hard import dependency on CircuitBreakerCapability. Any future capability implementing the same pattern automatically participates.
- Tier lookup uses `comp.getPlayerTier(cap.id)` which already exists on Component.

### 3b. Integration points

**`deliver-staged.ts` — DROP handler (line ~229):**
```ts
case "DROP":
  state.appendEvent(request.id, { /* ... DROPPED event ... */ });
  getOrInitCounters(state, sourceComponentId).drops += 1;

  // NEW: notify upstream CBs, but exclude BACKPRESSURED drops
  const dropReason = result.outcome.reason;
  if (dropReason !== "BACKPRESSURED") {
    notifyCircuitBreakers(state, modeController, request.id, "failure");
  }

  applyStrictCascade(state, request.id);
  return true;
```

**`deliver-staged.ts` — RESPOND handler:**
After revenue crediting, add:
```ts
notifyCircuitBreakers(state, modeController, request.id, "success");
```

**`check-ttl.ts` — pending queue timeouts (line ~51):**
After the TIMED_OUT event is appended, add:
```ts
notifyCircuitBreakers(state, modeController, req.id, "failure");
```

**`check-ttl.ts` — blocked parent timeouts (line ~83):**
Same pattern — call notifyCircuitBreakers for failure after appending TIMED_OUT.

### 3c. Failure type exclusions

| Event                               | Notify CB? | Reason |
|-------------------------------------|------------|--------|
| DROP with reason "condition_critical" | YES       | Service failure — exactly what CB tracks |
| DROP with reason "no_handler"         | YES       | Threshold (5) filters spurious design errors |
| DROP with reason "NO_EGRESS"          | YES       | Downstream topology broken — legitimate failure |
| DROP with reason "circuit_open"       | YES       | CB itself dropped — still counts as failure for outer CBs |
| DROP with reason "QUEUE_FULL"         | YES       | Downstream buffer exhausted |
| **DROP with reason "BACKPRESSURED"**  | **NO**    | Resource issue, not service failure. Retry via reEmitQueued. |
| TIMED_OUT (pending)                   | YES       | Downstream couldn't process in time |
| TIMED_OUT (blocked parent)            | YES       | Downstream dependency didn't respond |
| RESPOND                               | YES (success) | Drives HALF_OPEN → CLOSED transition |

### 3d. Path walking semantics

When a request fails at component X, the event log looks like:
```
Client → FORWARDED at LB (cap-id) → TRAVERSED on conn-lb-cb → FORWARDED at CB (cap-id) → TRAVERSED on conn-cb-s0 → DROPPED at server[0]
```

Walking backward from DROPPED: server[0] → CB → LB → Client.

The dedup-by-componentId ensures CB is notified once even though its `FORWARDED` and `TRAVERSED` events are separate.

All CBs on the path get notified — if the topology is LB → CB1 → CB2 → Server, both CB1 and CB2 see the failure.

## 4. Expected Wave 7 behavior

### Without CB (3 servers, chaos kills server[0])

1. Tick 10: chaos → server[0] condition=0
2. LB round-robins 1/3 of traffic to server[0] → server[0] drops/times out
3. No CB → failures don't trigger fast-fail
4. Subsequent requests keep hitting server[0] → continuous drops
5. **Availability: ~85%** (below 92% SLA → LOSE)

### With CB protecting server[0] path (LB → CB → server[0])

1. Tick 10: chaos → server[0] condition=0
2. Some requests route to CB → server[0] path → server[0] drops them
3. CB.reportFailure called after each drop → failureCount accumulates
4. ~Tick 12: failureCount reaches 5 → CB trips OPEN
5. Tick 12+: subsequent requests to CB path fast-fail (DROP/circuit_open) — but these are counted as "handled" via CB's DROP outcome, not server drops
6. LB's round-robin keeps splitting 1/3 to CB (which fast-fails) and 2/3 to healthy servers (which handle)
7. Tick 20+ (cooldown expires): CB → HALF_OPEN → probe → if server recovered, reportSuccess → CB closes
8. **Availability: ~93-95%** (above 92% SLA → WIN)

**The key insight:** CB doesn't save requests from failing — it just fast-fails them locally instead of letting them wait/timeout on dead downstream. This frees up connection bandwidth and reduces TIMED_OUT cascades.

## 5. Tests

| Test                                          | Type        | Asserts                                            |
|-----------------------------------------------|-------------|----------------------------------------------------|
| notifyCircuitBreakers walks event log         | Unit        | CBs on path notified, others ignored               |
| notifyCircuitBreakers deduplicates            | Unit        | Same component visited once per call                |
| notifyCircuitBreakers handles no CB in path   | Unit        | No-op, no error                                    |
| notifyCircuitBreakers handles empty event log | Unit        | No-op                                               |
| deliver-staged DROP triggers notify           | Unit        | Mock CB sees reportFailure call                     |
| deliver-staged DROP/BACKPRESSURED excludes    | Unit        | Mock CB does NOT see reportFailure                  |
| deliver-staged RESPOND triggers notify        | Unit        | Mock CB sees reportSuccess call                     |
| check-ttl TIMED_OUT triggers notify           | Unit        | Mock CB sees reportFailure call                     |
| Integration: CB trips under sustained chaos   | Integration | Wave 7 no-CB loses, Wave 7 with CB wins             |

## 6. Risk register

| #  | Risk                                                                      | Mitigation                                                                |
|----|---------------------------------------------------------------------------|---------------------------------------------------------------------------|
| R1 | notifyCircuitBreakers walks full event log — O(N) per failure             | Dedup set keeps it O(unique components). Typical request has <10 events. |
| R2 | CB trips on design errors (no_handler) spuriously                         | 5-failure threshold filters — design errors rarely exceed it             |
| R3 | Existing Wave 7 integration tests may pass with different metrics         | Update assertions if needed — CB actually working now                    |
| R4 | Duck-typing on reportFailure could match unrelated caps                    | Require both reportFailure AND reportSuccess — CB-specific pair           |
| R5 | modeController parameter needed — ripples through deliver-staged signature | deliver-staged already takes modeController — no new param needed         |
| R6 | reportSuccess called on every RESPOND — may transition CLOSED → CLOSED (no-op) | Idempotent — reportSuccess only changes state in HALF_OPEN               |
| R7 | Playtest may reveal need to tune thresholds for Wave 7                    | Post-implementation tuning is expected — that's the whole point          |

## 7. Out of scope

- Per-connection CB state (currently per-component)
- CB state change events emitted to dashboard (CIRCUIT_OPENED, CIRCUIT_CLOSED)
- CB metrics in monitoring dashboard
- CB trip on BACKPRESSURED (intentionally excluded — resource vs service issue)
- Tier-based threshold customization beyond what already exists

## 8. Update checklist (post-merge)

1. Re-run playtest — Wave 7 should now show CB topologies winning, no-CB topologies losing
2. Update `docs/claude/implementation-status.md` with CB wiring note
3. Update `docs/claude/td-stage-gotchas.md` — mark CB as wired (was previously noted as "reportFailure external-only")
4. Consider re-tuning Wave 7 SLA if CB now makes win margin too wide
