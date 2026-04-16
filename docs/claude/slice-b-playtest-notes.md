# Slice B playtest notes

Handoff notes from the Wave 1 UX pass Slice B implementation. Slice A tuning notes live at `docs/claude/slice-a-tuning-notes.md`; read them first for context on the viability damage math and known-untuned items.

## What shipped in Slice B

Slice B is a pure dashboard pass — no changes to `src/core/` or `src/capabilities/`. Every modification lives under `src/dashboard/`:

- **Entry-point redirect.** `src/dashboard/main.ts` rewrites any `#mode=td` URL to include `?renderer=iso` at boot. Classic TD is deprecated and only reachable by programmatic callers; a single `console.warn("[td-classic] DEPRECATED ...")` fires if anyone lands on the classic path.
- **Pure content modules.**
  - `src/dashboard/td/briefing-text.ts` — `renderBriefing(wave)` + `computeLoad` / `describeTraffic` / `describeObjective` / `describeReward` sub-functions. Zero DOM. Covered by 21 unit tests.
  - `src/dashboard/td/wave-narrative.ts` — `WAVE_NARRATIVES[1]` authored with `"Your service just went live. A trickle of users is knocking."` Waves 2–10 are Slice C.
  - `src/dashboard/td/component-dossier.ts` — `ComponentDossierStore` (localStorage-backed seen set), `DOSSIERS` content for Server + Database, and `showDossier(type, rentPerWave): Promise<void>` modal renderer.
- **`CyberpunkHudController`** in `src/dashboard/cyberpunk-hud.ts`. Exposes typed setters the dashboard calls directly: `updateBriefing`, `hideBriefing`, `updateViability`, `updateNextBill`, `showToast`, `getPaletteButtons`. Retrieved via `getCyberpunkHudController()`. New builders: `buildViabilityPanel`, `buildToast`, a rewritten `buildBriefingPanel` that direct-renders instead of mirroring classic DOM, and a `buildResourcesPanel` with a new NEXT BILL row.
- **New CSS** (~200 lines appended to `cyberpunk-hud.css`): viability meter (`.cp-viability` + `--green/--amber/--red` + `@keyframes cp-viability-pulse`), NEXT BILL row, Slice B briefing rows with dot meter, toast, NEW palette badge (`.cp-palette-cell--new` + `@keyframes cp-new-pulse`), and the `.cp-dossier-*` modal family.
- **`repaintCyberpunkHudForPhase(controller, state)`** helper in `main.ts`. Called from (a) end of `bootTDMode`, (b) the Ready-button `onPhaseChange` callback, and (c) `tdOnTick` after the engine-driven wave_passed `advancePhase` sequence. Handles four phase scenarios: campaign complete (hide briefing + null bill + viability), build (briefing + bill + viability + NEW badges), simulate (null bill + viability), assess (no-op).
- **Rent pre-flight in `td-mode.ts onReady`.** Calls `controller.payRent(state)` before `advancePhase`. On `{ok: false}` surfaces a toast via the HUD (or `window.alert` fallback if the HUD handle is null) and returns without advancing phase. On `{ok: true}` proceeds and surfaces `getTopologyErrors()` as a non-blocking advisory toast. Topology error formatting uses real fields (`reason`, `requestType`, `componentType`) rather than the plan's defensive casts.
- **Terminal-state migration in `tdOnTick`.** Replaces the old `isWaveDrained + evaluateOutcome + verdict` gate with `controller.getTerminalState(state)`. Dead path calls `showDeathModal()` ("YOUR OPPORTUNITY WINDOW HAS CLOSED" + diagnoseWave hint + "RESTART CAMPAIGN" button). Wave_passed path calls `showWinModal()` which reuses the existing `showWaveResultToast` for visual continuity, then runs the snapshot + condition reset + two `advancePhase` calls.
- **`controller.onTick(state.asReader())` wired into `tdOnTick`.** Slice A's tuning notes claimed `SimLoop` would fire this — it doesn't. Slice B drives it from the TD dashboard's tick callback so viability damage actually accrues during real play. Without this wiring the death modal was dead code. Tuning notes are back-annotated to reflect reality.
- **Palette NEW badges + first-click dossier interception.** Module-level `dossierStore` + `dossierInterceptionAbort: AbortController`. Each `bootTDMode` aborts the prior listener set, creates a fresh controller, and attaches capture-phase click handlers. On first click of an unseen authored component, the handler synchronously marks seen (closing a double-click race), opens the modal via `showDossier`, and manually forwards to the classic button after dismissal. Unauthored roadmap components silently mark seen without a modal so they can still be placed.
- **Deprecation annotations.** `src/dashboard/td/briefing-card.ts` gained a `@deprecated` JSDoc; `bootTDMode` logs `[td-classic] DEPRECATED ...` once if the iso HUD isn't active.

### Test coverage added

| File | Tests |
|---|---|
| `tests/unit/dashboard/env.test.ts` | 1 (happy-dom env proof) |
| `tests/unit/dashboard/briefing-text.test.ts` | 21 (computeLoad ×10, describeTraffic ×7, describeObjective, describeReward ×2, renderBriefing) |
| `tests/unit/dashboard/wave-narrative.test.ts` | 3 |
| `tests/unit/dashboard/component-dossier-store.test.ts` | 6 (store ×5 + DOSSIERS content sanity) |
| `tests/unit/dashboard/component-dossier-modal.test.ts` | 4 (CTA dismiss, Escape, X button, unknown type fallback) |
| `tests/unit/dashboard/cyberpunk-hud-viability.test.ts` | 4 (green/amber/red+pulse/clamp) |
| `tests/unit/dashboard/cyberpunk-hud-next-bill.test.ts` | 2 (show/hide) |
| `tests/unit/dashboard/cyberpunk-hud-briefing.test.ts` | 2 (Wave 1 paint + hide) |
| `tests/unit/dashboard/cyberpunk-hud-toast.test.ts` | 2 (show/fade + replace) |
| **Total** | **45** |

Full suite sits at **811 tests** post-Slice-B (740 pre-Slice-A baseline + 27 Slice A additions + 44 Slice B additions — the 45th test was an append to an existing file, keeping the file count unchanged).

## Automated verification — all green

- `pnpm test` → 811 pass / 186 files / ~40s (Wave 10 integration dominates wall clock at 39s).
- `pnpm typecheck` → clean.
- `pnpm exec vite build` → built in 402ms, bundle ~395 KB / ~120 KB gzip, no errors, no warnings of substance.
- `tests/unit/engine-pixi-isolation.test.ts` still green — Phase 1 engine-purity invariant preserved by construction.

## Browser playtest — TODO, not yet executed

The plan's Task 15 lists three playtest runs that require a real browser:

1. **Naked Database run (teaching failure).** Clear localStorage, open `/?renderer=iso#mode=td`, click Database → dossier opens, dismiss, place Database, connect Client → Database, click READY → verify NEXT BILL shows `$80`, briefing shows `LAUNCH DAY / A handful of readers / LIGHT / Survive 30 ticks / $1 per user served`, wave drains, viability meter falls as reads drop, modal fires at `wave_passed` or `dead`.
2. **Server + Database run (teaching success).** Clear localStorage, open `/?renderer=iso#mode=td`, dismiss both dossiers, place Server + Database wired as Client → Server → Database, READY → NEXT BILL `$160`, wave passes cleanly, win toast shows viability 100% + budget near $740.
3. **Persistence run.** Reload without clearing localStorage, verify no dossiers fire and no NEW badges appear.

I did not run these — they need a real browser + human validation of the copy tone, colour bands, badge animation, toast readability, and modal focus behavior. The automated test coverage proves the state-push surfaces write the right DOM; it cannot prove the experience reads the way the spec intended.

**Recommended sequence when you run them yourself, Normid:**

```bash
# In the worktree:
lsof -ti:5173 | xargs kill 2>/dev/null || true
pnpm dev
# Open http://localhost:5173/#mode=td — the URL should auto-rewrite to
# http://localhost:5173/?renderer=iso#mode=td and the cyberpunk HUD should be active.
# In devtools console: localStorage.clear() between the three runs.
```

Specific things worth watching and flagging back:

- **Dossier copy tone.** The Server dossier says "workhorses of your stack"; the Database dossier says "sit behind a Server". A writerly pass may want to smooth these lines further.
- **Viability meter colour transitions.** Fall rate in a naked-DB Wave 1 should hit amber (<0.5) and probably not red (<0.25) unless you double-down on bad topology. The low-state keyframe pulse is `0.8s ease-in-out infinite` — if it's jarring or reads as error instead of warning, it's a Slice C CSS tweak.
- **NEXT BILL counter readability.** Row is amber text on dark. If it blends into the other resource rows during build phase, the colour needs a tweak.
- **Toast copy.** The rent-due toast reads `Rent due: $X. You only have $Y. Scrap a component to reduce the bill.` The topology-warning toast reads `Topology warning: no_handler (GET @ server) · no_egress ...` — the `reason` codes leak engine language. Worth a Slice C player-facing-copy pass (reviewer flagged this in the Task 10 quality review).
- **Death modal copy.** `YOUR OPPORTUNITY WINDOW HAS CLOSED` + italic `"The market moved on. Your service couldn't keep up."` + diagnoseWave hint + RESTART CAMPAIGN button. Tone is grim-but-recoverable per the spec; confirm it reads that way.
- **Wave 1 → Wave 2 transition.** Task 13's `repaintCyberpunkHudForPhase` helper is called from the engine-driven wave_passed path. Verify that after a win, the briefing panel updates to show Wave 2's data (not stale Wave 1), NEXT BILL shows the carried-topology's rent against the new wave, and NEW badges appear for any newly-unlocked components in wave 2's `availableComponents`.
- **Double-click resilience.** Rapidly double-click an unseen palette cell — should only open one dossier modal, not two (Task 11 C1 fix).

## Known-untuned items (carried from Slice A)

The viability damage math is not yet playtested end-to-end. Slice A's tuning notes flag that `viabilityPerFailure` values for waves 7/8/10 may overshoot and cause false deaths on winning topologies. Now that Slice B wires `controller.onTick` into real play, those untuned numbers will actually matter — expect a retuning pass after the first couple of playtest runs.

The 9 wave-integration "lose" tests still carry `TODO(T16)` markers using the old `outcome.verdict === "lose"` assertion. Slice B doesn't migrate them because `runWave` deliberately doesn't call `mode.onTick` (see Slice A tuning notes). A future tuning pass may want to either wire onTick into `runWave` with tuned damage values, or make the engine call `mc.onTick` internally.

## Open items for Slice C (reviewer-flagged, not shipping in this pass)

- **Focus restore on dossier modal dismiss.** Currently `cta.focus()` lands focus on the CTA but nothing restores focus to the palette button on dismiss. Task 7 quality review flagged this as a follow-up.
- **Dossier Tab-key focus trap.** Minimal modal with 2 focusable elements; Tab can still escape. Follow-up.
- **Classic-mode dossier CSS.** All `.cp-dossier-*` selectors are scoped under `body.renderer-iso`. If the classic dashboard ever needs dossiers, these rules need un-scoping.
- **Topology warning toast copy** (Task 10 reviewer). `no_handler (GET @ server)` leaks capability-engine language; a Slice C polish pass should map reason codes to player-facing phrasing.
- **OutcomeReport smell in `showWinModal`** (Task 12 reviewer). The synthetic literal fills `score` and `slaResults` fields that `showWaveResultToast` never reads. A Slice C cleanup could narrow `showWaveResultToast`'s signature to `(verdict, notes)` and drop the synthesis.
- **`showLossModal` + `retryTDWave` dead code.** Task 12 deliberately preserved them for a Slice C mercy-mode hook (spec §6). Currently unreachable from `tdOnTick` and from the `$tdRetryBtn` click handler.
- **Stale CLAUDE.md test count.** The root CLAUDE.md says "740 tests" — post-Slice-B it's 811. Update in a follow-up.
- **`cyberpunk-hud.css` colour tokens.** The new Slice B CSS uses `var(--cp-green, #22c55e)` / `--cp-amber` / `--cp-red` / `--cp-text` / `--cp-accent` / `--cp-mono` variables that aren't defined on `body.renderer-iso`. The fallback hex values always fire, so visuals work, but the palette drifts from the `--sc-*` design tokens used elsewhere. Slice C design-system pass should consolidate.
- **Remaining 10 dossiers.** Cache, Load Balancer, CDN, API Gateway, Queue, Worker, Circuit Breaker, DNS/GTM, Streaming Server, Blob Storage. Roadmap.
- **Wave 2–10 narratives.** Only Wave 1 is authored. Roadmap.
