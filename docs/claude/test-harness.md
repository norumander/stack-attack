# Test harness

## Fixtures (`tests/harness/`)

- `fixtures.ts` — `makeComponent`, `makePort`, `makeConnection`
- `test-capabilities.ts` — `ForwardingCapability`, `RespondingCapability`, `BlockingDbCapability`, `TwoBlockingSpawnsCapability`, `DroppingCapability`, `TestQueueCapability` (EngineBufferable)
- `scaling-capability.ts` — `TestScalingCapability` emits SCALE side effect per request (Stage 2c+)
- `random-topology.ts` — `makeRandomTopology(rng)` deterministic linear chains for property tests
- `noop-mode-controller.ts`, `noop-economy.ts`, `fixed-intensity-traffic-source.ts` — minimal mode/traffic stubs
- `test-economy.ts` — `TestEconomyStrategy` with `creditLog`/`debitLog` + configurable `revenuePerRequest`/`insolvencyRule`
- `test-chaos-controller.ts` — `TestChaosController` wraps `NoOpModeController` with a scripted `Map<tick, ChaosEvent[]>`
- `td-fixtures.ts` — canonical TD test boot: `makeRng(seed)`, `bootTDRegistry()`, `makeTDController(opts)`

## Harness gotchas

- `NoOpModeController` constructor takes `{ targetEntryPointId, intensity, requestType }` (from `FixedIntensityConfig`), not `{ requestsPerTick, originComponentId }`.
- `FixedIntensityTrafficSource` hardcodes `ttl: 10` on generated requests — not configurable. TTL-sensitive tests must live within that window or inject requests manually.
- Populate `state.visitOrder` before running engine steps in unit tests: `state.visitOrder.push(...computeVisitOrder(state.components))`. Not `buildVisitOrder`.
- Heterogeneous capability maps need explicit typing: `new Map<CapabilityId, Capability>()` + `.set(...)`. Inline `new Map([[a, capA], [b, capB]])` narrows to the first capability subclass.
- `readonly` fields on `Component` (e.g. `minInstances`, `maxInstances`) are TS-only; tests can override at runtime via `(comp as { maxInstances: number }).maxInstances = 5`.
