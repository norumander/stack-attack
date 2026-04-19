# Simulation model

## Physics TD uses a real-time sim, not a tick-phase engine

The shipping game (Physics TD, `src/sim/`) runs a real-time, continuous packet-physics simulation:

- `Sim.step(dt)` advances `simTime` by `dt` seconds each frame.
- Each step: refill component capacity buckets, populate + launch due snakes, pull from workers, advance packets along edges, collect arrivals, process arrivals (capability dispatch), release expired stream bandwidth reservations.
- There is **no** INTERCEPT/PROCESS/REPLICATE/OBSERVE phase ordering, no fixed-point loop, no `lastTickEvents` blob. Events are collected into `sim.lastStepEvents` for the current step and consumed by the renderer bridge (`src/sim-demo/sim-to-renderer.ts`) and the client-side metrics aggregator (`src/physics-td/component-metrics.ts`).

The realtime model is what makes per-frame bandwidth reservations (streams), zone-latency accumulation on edges, and continuous packet animation work cleanly.

## Historical: legacy tick-step engine (`src/core/engine/`)

The codebase still contains a framework-agnostic tick-step engine under `src/core/` and `src/capabilities/`, with a 10-step `Engine.tick(mc)` loop, capability phase ordering, `EngineBufferable`/`EnginePullable`/`EngineConsultable` sub-interfaces, and an extensive unit-test suite. **The Physics TD game does not use this engine.** It is compiled and covered by tests as a contract surface left over from the pre-pivot design; preserved so its tests stay green and it can still be referenced when reasoning about capability semantics.

If you need to understand the tick-phase model (e.g. to read old tests or the historical `component-architecture.md`), the 10-step order was:

1. Inject traffic
2. Re-emit queued
2.5. Pull from buffers
3. Process pending (fixed-point loop)
3b. Overloaded sweep
4b. Update active streams
5. Check TTL
6. Update condition
6b. Inject chaos
7. Deduct upkeep
8. Record metrics
9. Reset per-tick state
10. Advance tick

Full gotchas for this engine live in `td-stage-gotchas.md` (also historical).
