# Physics Sim — Roadmap Checkpoint (2026-04-17)

> Use this file to resume work in a fresh Claude session. The recall prompt at the end of this file gets you back up to speed in one paste.

## Where things stand

**Branch:** `physics-sim`
**Worktree:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`
**Current HEAD:** `8c30aba` (73 commits ahead of `origin/main`)
**Tests:** 135 passing across `tests/unit/sim/` (62) + `tests/unit/dashboard/` (64) + `tests/integration/sim/` (9)
**Typecheck:** clean (only the pre-existing `tests/unit/pull-from-buffers.test.ts:81` noise documented in `CLAUDE.md`)
**Demo:** `http://localhost:5173/physics-td/physics-td.html?renderer=iso` — playable but with significant gaps from the pre-physics iso TD

## Architecture in one paragraph

Designed and built a physics-driven request flow simulation in `src/sim/`, replacing the tick-based engine model with continuous-time packets that physically traverse twin-edge connections at 60Hz. Built a new TD game UX at `/physics-td/` that uses the existing iso renderer (`src/dashboard/render/cyberpunk-*`) and HUD chrome (`src/dashboard/cyberpunk-hud.ts`) but with its own controller (`PhysicsCampaignController`) and wave catalog. The legacy engine + dashboard at `/` remains untouched for now.

## What's shipped (Plans 1–7 + 4b + 6a + polish passes)

| Plan | Stage | Scope |
|---|---|---|
| 1 | A | Sim core: `Sim`, `SimComponent`, `SimConnection`, `Packet`, capacity buckets, twin-edge response retracing, 3 capabilities (Processing, Forwarding, Caching) |
| 2 | B | `WaveDef` + `TrafficSource` + `SimClient` snake + Wave 1 end-to-end |
| 3 | C | 6 more capabilities: LoadBalancer (split + wait-all merge), Gateway, GeoRouting, Streaming (with bandwidth reservation), Queue, Worker (pull semantics) |
| 4 | D | Test harness (`runWave` + `evaluateSLA`) + Waves 1, 2, 3 (lose+rescue), 4, 5 integration tests |
| 4b | D-cont | TrafficSource zone distribution + Waves 6, 8, 9 integration tests |
| 5 | E | Iso renderer integration: adapter, fixed-step browser driver, snake layer, demo page at `/sim-demo/physics-demo.html` |
| 7 | G | Polish: two-lane edges (with direction-based color), snake-direction-from-egress, cache slot chips, capacity bars, flash throttling |
| 6a | new game UX | `/physics-td/` — campaign controller, palette, placement UX, connect UX, READY transition, win/loss modals, retry, full BriefingDisplay |

## What's left — three-tier roadmap

The audit `docs/superpowers/specs/2026-04-17-physics-td-parity-audit.md` is the definitive gap list. Roadmap below distills it.

### Tier 1 — Quick Wins (~1 week)

**Goal:** close the worst pre-physics regressions and unblock the most playable waves.

1. **Wire 4 already-built capabilities into `component-factory.ts`:**
   - Queue, Worker (for batch waves)
   - Streaming (for video waves)
   - GeoRouting (for multi-zone waves)
   - All four exist in `src/sim/capabilities/` but the player can't place them.

2. **Port Wave 4 (CDN absorbs static asset traffic).**
   - Need a `caching-static` factory variant that filters by `isLarge`.
   - Update palette + briefing.

3. **Multi-wave topology persistence + economy carryover.**
   - Currently `clearWaveWorld()` (in `physics-td.ts:581-610`) wipes everything between waves. Pre-physics game carried the player's build forward through the entire campaign.
   - Revenue earned in Wave N should add to Wave N+1's starting budget, not just be discarded.

4. **Wave dev-jump selector** (the `#td-dev-wave-select` mirror div).
   - Critical for development velocity — without it, every test of a late-wave change requires playing through all earlier waves.

5. **Diagnose-wave loss copy.**
   - Pre-physics had `src/dashboard/td/diagnose-wave.ts` with branch logic ("DB saturated", "no read path", etc.). Currently loss modal just says `"SLA failed: availability 0.6 < 0.85"`.
   - Port the diagnostic logic; map physics-sim metrics to the same branches.

6. **Fix Wave 1 briefing** — currently says "A lone Server can handle this" but post-Data-Cache redesign Server is a forwarder for reads, so lone Server drops everything. Either make Wave 1's intended-rescue topology explicit (Server + Database) OR change the wave definition to give Server something it can terminate locally.

### Tier 2 — Mid-Term (~2 weeks)

**Goal:** complete the wave catalog through Wave 9 and add the deep teaching UX.

7. **Component info panel.** When player clicks a placed component during build, show the existing HUD info panel populated with: type, capabilities list, cost, current bucket utilization (if simulating), description. The DOM is already there in cyberpunk-hud.ts.

8. **Component dossier modal.** Pre-physics had `src/dashboard/td/component-dossier.ts` — a "what does this component do" deep-dive triggered from the info panel. Port it.

9. **NEW badges on palette.** Pre-physics highlighted newly-unlocked components when a wave introduces them (CDN appears in W4 palette with NEW badge). Mostly a per-wave allowlist of placeable types.

10. **Port Waves 6, 8, 9 with their full intended topologies** (now that Queue/Worker/Streaming/GeoRouting are wired). Integration tests already exist for these — port the wave config + briefings into `physics-td/waves.ts`.

11. **Per-zone visualization for Wave 9** (multi-zone topology). The renderer doesn't currently group components by zone visually. Either add zone backgrounds/regions OR explicit zone labels.

### Tier 3 — Long-Tail (~3+ weeks)

**Goal:** the pieces that need genuine new design work, not straight ports.

12. **Component condition / health system.**
    - Pre-physics had per-tick condition decay driven by drops/timeouts/overload counters.
    - Continuous-time version: needs a design pass on what "condition" means in a 60Hz physics sim. Probably accumulate-and-decay over rolling windows.
    - Visual: condition rings (HUD has the CSS).

13. **Chaos events.**
    - 4 kinds in pre-physics: `component_failure`, `zone_outage`, `connection_sever`, `latency_injection`.
    - `chaosSchedule` per wave with timed insertions.
    - New design needed for how chaos affects a continuous-time sim — e.g. "kill component" means it stops accepting arrivals, decays to condition 0, eventually recovers.

14. **CircuitBreaker capability + Wave 7.**
    - Pre-physics: tracks downstream failures, opens after threshold, blocks forwards while open, half-open recovery probe.
    - Wave 7 ("Outage") uses chaos schedule + CircuitBreaker for the rescue topology.
    - Depends on chaos system landing first.

15. **AutoScale capability + Wave 10.**
    - Pre-physics: utilization-based scale-up (>80% for 2 ticks) / scale-down (<30% for 5 ticks). Per-component instance count.
    - Continuous-time version: similar threshold logic but using rolling-window utilization (already computed for capacity bars).
    - Wave 10 ("Viral") uses autoscale + chaos at peak intensity.

16. **Per-wave UPKEEP cost.**
    - Pre-physics deducted upkeep every tick from budget; running out caused insolvency (component condition → 0).
    - Plumbing already exists in HUD (`updateNextBill` controller method). Bootstrap doesn't compute or push it yet.
    - Continuous-time version: per-second upkeep deduction during simulate phase.

17. **Visual polish.**
    - Drop / revenue flash refinement (currently throttled but could use dedicated number floats)
    - Component "killed by chaos" animation
    - Auto-scale instance fan-out animation
    - Wave-end victory animation

18. **Topology validation.**
    - Pre-physics had `src/modes/td/validate-topology.ts` — dry-run trace of each request type to detect dead-end topologies before wave starts.
    - Save the player from "READY → wave runs → 100% drops because they forgot to wire DB."

### Out of scope (or much later)

- Tier upgrade UI (per-component instance count or capacity tier) — pre-physics had it but the new physics sim's capacity model is different
- Replication / `event` request type — never shipped pre-physics either
- Sandbox mode (the non-TD experience at `/`) — user explicit: deprecating all of this
- Mobile / touch UX
- Production build packaging — `vite build` doesn't yet include the physics-td.html entry

## Known issues at checkpoint time

1. **Right-click delete may not visibly fire** in some browsers — the dual-bind (host + canvas) was added defensively; user reported delete not working. Fallback Delete Mode toggle is in the palette and definitely works.
2. **Wave 1 briefing is wrong** — says lone Server suffices but it doesn't (per Data Cache redesign). Listed as Quick Win #6.
3. **`pre-physics` git tag NOT yet created** — when we eventually delete `src/core/engine/`, tag first.
4. **`vite build` won't include physics-td.html** as a production entry without a `build.rollupOptions.input` map addition. Dev server picks it up automatically.
5. **`tests/unit/pull-from-buffers.test.ts:81`** — known pre-existing typecheck noise (documented in `CLAUDE.md`). Not introduced by physics-sim work.

## Documentation to update at parity time

- `docs/claude/implementation-status.md` — currently describes pre-physics state
- `docs/claude/td-stage-gotchas.md` — pre-physics tick-loop semantics
- `docs/claude/simulation-tick.md` — entirely obsolete under physics model
- `CLAUDE.md` context hub — point at new sim docs once written

## Recommended next action

Write **Plan 8 — Tier 1 Quick Wins** as a focused 5–7 task plan, then execute subagent-driven. Tier 1 closes the worst regressions and is contained enough to ship in a few hours of dispatcher work.

---

## Recall prompt (paste into a fresh Claude session)

```
We're mid-stride on a physics-driven TD game refactor. Read this file FIRST
before doing anything:

  docs/superpowers/specs/2026-04-17-physics-sim-roadmap-checkpoint.md

It captures: where things stand, what's shipped (Plans 1–7 + 4b + 6a),
the three-tier roadmap (Quick Wins / Mid-Term / Long-Tail), the parity
audit reference, and known issues.

Worktree is at .worktrees/physics-sim, branch is physics-sim, 73 commits
ahead of origin/main. The dev server runs at
http://localhost:5173/physics-td/physics-td.html?renderer=iso .

Also worth scanning before any code changes:
  - docs/superpowers/specs/2026-04-17-physics-driven-request-flow-design.md
    (the original design that drove all this work)
  - docs/superpowers/specs/2026-04-17-physics-td-parity-audit.md
    (the gap list vs pre-physics iso TD)

When you've read those, summarize the current state in 3-4 bullets and
ask me which roadmap tier to start. Default recommendation if I don't
specify: write Plan 8 (Tier 1 Quick Wins) and start executing it
subagent-driven.
```
