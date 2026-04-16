# Wave 1 UX Slice B — Cyberpunk HUD UX Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paint the Slice A economy/viability mechanics into the cyberpunk HUD so Wave 1 reads as a glanceable, teaching-first experience — new briefing copy, dossier-on-first-click, live viability meter, next-wave rent counter, and wave_passed/dead terminal modals wired through `getTerminalState()`.

**Architecture:** Slice A already landed `TDViability`, `getViability()`, `getRentBill(state)`, `payRent(state)`, and `getTerminalState(state?)` on `TDModeController`, plus `rentPerWave` on every TD `ComponentRegistryEntry`. Slice B is a pure dashboard pass — new pure modules under `src/dashboard/td/` (briefing text, dossier data, dossier store, wave narrative), new cyberpunk HUD elements under `src/dashboard/cyberpunk-hud.ts` (viability meter, NEXT BILL row, direct-render briefing panel, toast helper, dossier modal), and wiring adjustments in `src/dashboard/main.ts` + `src/dashboard/td-mode.ts` to call the new APIs. No `src/core/`, `src/capabilities/`, or `src/modes/` changes. The Phase 1 engine-purity invariant (`tests/unit/engine-pixi-isolation.test.ts`) stays green by construction.

**Tech Stack:** TypeScript strict · Vite + Pixi dashboard · Vitest 2.1 · happy-dom (new devDependency for DOM tests) · localStorage for dossier persistence · CSS keyframes for low-viability pulse and NEW-badge glow.

---

## Scope Check

Slice B is one coherent subsystem (the cyberpunk HUD UX pass). It does not span independent subsystems — every task produces either a new pure dashboard module or an increment to the existing HUD. The plan stays as one plan.

## File Structure

### New files (dashboard)

| File | Responsibility |
|---|---|
| `src/dashboard/td/briefing-text.ts` | Pure briefing renderer: `renderBriefing(wave)` + `computeLoad`, `describeTraffic`, `describeObjective`, `describeReward` sub-functions. Zero DOM. Returns a `BriefingDisplay` data object. |
| `src/dashboard/td/wave-narrative.ts` | `WAVE_NARRATIVES` keyed map + `getNarrative(waveId)` helper. Data-only. |
| `src/dashboard/td/component-dossier.ts` | `ComponentDossierStore` (localStorage-backed seen-set), `DOSSIERS` content map, `showDossier(type, rentPerWave): Promise<void>` modal renderer. |
| `tests/unit/dashboard/briefing-text.test.ts` | Pure unit tests for every sub-function + `renderBriefing` across Wave 1. |
| `tests/unit/dashboard/component-dossier-store.test.ts` | localStorage persistence, hasSeen/markSeen/clear semantics + DOSSIERS content sanity. |
| `tests/unit/dashboard/component-dossier-modal.test.ts` | happy-dom — modal DOM shape, CTA resolves promise, Esc dismiss, X dismiss. |
| `tests/unit/dashboard/cyberpunk-hud-viability.test.ts` | happy-dom — `updateViability({fraction})` writes bar width + colour class. |
| `tests/unit/dashboard/cyberpunk-hud-next-bill.test.ts` | happy-dom — `updateNextBill(bill)` writes counter; null hides it. |
| `tests/unit/dashboard/cyberpunk-hud-briefing.test.ts` | happy-dom — `updateBriefing(wave)` writes the Wave 1 briefing panel rows. |
| `tests/unit/dashboard/cyberpunk-hud-toast.test.ts` | happy-dom — `showToast(msg)` shows then hides after 3000ms (fake timers). |
| `tests/unit/dashboard/wave-narrative.test.ts` | Wave 1 narrative returns the authored line; unknown wave returns `undefined`. |
| `tests/unit/dashboard/env.test.ts` | Placeholder proving the happy-dom environment is wired. |

### Modified files

| File | What changes |
|---|---|
| `src/dashboard/cyberpunk-hud.ts` | Replace briefing-panel mirror with a direct-render panel fed from `tdController`; add viability-meter element under the resources panel; add `NEXT BILL` row; add toast helper (`showToast`); add NEW-badge support on palette cells; expose a `CyberpunkHudController` handle so `main.ts` can push updates. |
| `src/dashboard/cyberpunk-hud.css` | Styles for `.cp-viability`, `.cp-viability-bar`, `.cp-viability-fill`, `.cp-viability--low` (keyframe pulse), `.cp-res-next-bill`, `.cp-palette-cell--new::after` (NEW badge), `.cp-toast`, `.cp-toast--visible`, new briefing rows, and the `.cp-dossier-*` modal family. |
| `src/dashboard/main.ts` | URL rewrite to force `?renderer=iso` when `#mode=td` is requested. Wire the new `CyberpunkHudController` into TD boot: call `updateBriefing(wave)` on phase change to build / wave advance, call `updateViability(v)` on every TD `onTick`, call `updateNextBill(bill)` on place/connect/remove events and on phase change, use `getTerminalState(state)` instead of `evaluateOutcome()` to decide loss vs win modal, replace loss-modal copy for the new death state. Deprecate the classic TD path via a single `console.warn`. |
| `src/dashboard/td-mode.ts` | `onReady` runs the rent pre-flight via `controller.payRent(state)`; on `{ok:false}` forwards to HUD `showToast("Rent due …")` and stays in build. On `{ok:true}` calls `advancePhase(state)` as today. Topology errors still read via `getTopologyErrors()` and piped to `showToast`. |
| `src/dashboard/td/briefing-card.ts` | Deprecated on the iso path via a `/** @deprecated */` JSDoc block. Keep the module compiling for the classic (deprecated) path. No behavior change. |
| `package.json` | New devDependency: `happy-dom`. |
| `vitest.config.ts` | `test.environmentMatchGlobs` entry: any file in `tests/unit/dashboard/**` runs under `happy-dom`. Everything else stays on Node. |

---

## Task 1: Add happy-dom so DOM tests can run

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Create: `tests/unit/dashboard/env.test.ts`

- [ ] **Step 1: Install happy-dom as a devDependency**

Run:

```bash
pnpm add -D happy-dom@^15
```

Expected: `package.json` gains `"happy-dom": "^15.x.y"` under `devDependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Teach vitest to use happy-dom for dashboard DOM tests**

Edit `vitest.config.ts` — replace the `test` block:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    environmentMatchGlobs: [
      ["tests/unit/dashboard/**", "happy-dom"],
    ],
  },
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@capabilities": fileURLToPath(new URL("./src/capabilities", import.meta.url)),
      "@harness": fileURLToPath(new URL("./tests/harness", import.meta.url)),
      "@modes": fileURLToPath(new URL("./src/modes", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: Create a placeholder dashboard test to prove the environment works**

Create `tests/unit/dashboard/env.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("dashboard test environment", () => {
  it("exposes window and document", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
    expect(document.createElement("div")).toBeInstanceOf(HTMLElement);
  });
});
```

- [ ] **Step 4: Run the placeholder**

Run: `pnpm test tests/unit/dashboard/env.test.ts`
Expected: PASS, one test.

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `pnpm test && pnpm typecheck`
Expected: all existing tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tests/unit/dashboard/env.test.ts
git commit -m "test(dashboard): add happy-dom environment for dashboard unit tests"
```

---

## Task 2: Entry-point redirect — force `?renderer=iso` when TD mode is requested

**Files:**
- Modify: `src/dashboard/main.ts:1-30` (the boot-time activation block)

**Context:** The cyberpunk HUD only activates when `?renderer=iso` is in the query string. Slice B's UX only works on the iso HUD. Players who open `#mode=td` without the query param silently land on the classic (deprecated) HUD. We rewrite the URL at the top of `main.ts`, before `isCyberpunkHudActive()` is evaluated.

- [ ] **Step 1: Write the redirect helper**

At the very top of `src/dashboard/main.ts`, immediately after the existing imports and BEFORE `if (isCyberpunkHudActive())`, insert:

```ts
// ─── Entry-point redirect: force iso HUD for TD mode ──────────────────
// Slice B makes the iso cyberpunk HUD the canonical TD surface. Anyone
// arriving with #mode=td but without ?renderer=iso gets silently rewritten.
// Classic TD mode is deprecated and left only as a code-path for the sandbox
// HUD's stale mirror targets; no bookmark-surface depends on it.
(function forceIsoForTDMode(): void {
  const hash = window.location.hash;
  if (!hash.startsWith("#mode=td")) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("renderer") === "iso") return;
  url.searchParams.set("renderer", "iso");
  // replaceState (not assign) so the user's history isn't polluted.
  window.history.replaceState(null, "", url.toString());
})();
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional but cheap)**

Run: `pnpm dev` in one terminal, then in a browser open `http://localhost:5173/#mode=td`.
Expected: the URL bar immediately becomes `http://localhost:5173/?renderer=iso#mode=td` and the iso HUD is active.
Kill the dev server with `lsof -ti:5173 | xargs kill` when done.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/main.ts
git commit -m "feat(dashboard): force ?renderer=iso when entering #mode=td"
```

---

## Task 3: `briefing-text.ts` — pure briefing module (TDD)

**Files:**
- Create: `src/dashboard/td/briefing-text.ts`
- Create: `tests/unit/dashboard/briefing-text.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/dashboard/briefing-text.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  renderBriefing,
  computeLoad,
  describeTraffic,
  describeObjective,
  describeReward,
  type BriefingDisplay,
} from "../../../src/dashboard/td/briefing-text.js";
import { WAVE_1 } from "../../../src/modes/td/td-waves.js";

describe("computeLoad", () => {
  it.each([
    [1, 1, "LIGHT"],
    [15, 1, "LIGHT"],
    [16, 2, "STEADY"],
    [50, 2, "STEADY"],
    [51, 3, "HEAVY"],
    [150, 3, "HEAVY"],
    [151, 4, "PEAK"],
    [500, 4, "PEAK"],
    [501, 5, "EXTREME"],
    [10000, 5, "EXTREME"],
  ])("intensity=%i → %i dot(s) %s", (intensity, dots, label) => {
    expect(computeLoad(intensity)).toEqual({ dots, label });
  });
});

describe("describeTraffic", () => {
  it("100% api_read → 'A handful of readers'", () => {
    expect(describeTraffic(new Map([["api_read", 1.0]]))).toBe(
      "A handful of readers",
    );
  });

  it("api_read + api_write → 'Readers and contributors'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.7], ["api_write", 0.3]])),
    ).toBe("Readers and contributors");
  });

  it("contains static_asset → 'Readers and asset traffic'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.5], ["static_asset", 0.5]])),
    ).toBe("Readers and asset traffic");
  });

  it("contains auth_required → 'Sign-ins and reads'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.8], ["auth_required", 0.2]])),
    ).toBe("Sign-ins and reads");
  });

  it("contains stream → 'Viewers tuning in'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.3], ["stream", 0.7]])),
    ).toBe("Viewers tuning in");
  });

  it("contains batch → 'Background jobs and reads'", () => {
    expect(
      describeTraffic(new Map([["api_read", 0.6], ["batch", 0.4]])),
    ).toBe("Background jobs and reads");
  });

  it("unknown shape falls back to 'Mixed traffic'", () => {
    expect(describeTraffic(new Map([["api_read", 0.5], ["event", 0.5]]))).toBe(
      "Mixed traffic",
    );
  });
});

describe("describeObjective", () => {
  it("Wave 1 → fixed launch-day copy", () => {
    expect(describeObjective(WAVE_1)).toBe(
      "Survive 30 ticks. Don't lose your foothold.",
    );
  });
});

describe("describeReward", () => {
  it("single type → '$N per user served'", () => {
    expect(describeReward(new Map([["api_read", 1]]))).toBe(
      "$1 per user served",
    );
  });

  it("mixed → range '$low–$high per user served'", () => {
    expect(
      describeReward(new Map([["api_read", 1], ["api_write", 2]])),
    ).toBe("$1–$2 per user served");
  });
});

describe("renderBriefing — Wave 1", () => {
  it("produces the Wave 1 briefing shape", () => {
    const display: BriefingDisplay = renderBriefing(WAVE_1);
    expect(display.title).toBe("LAUNCH DAY");
    expect(display.load).toEqual({ dots: 1, label: "LIGHT" });
    expect(display.traffic).toBe("A handful of readers");
    expect(display.objective).toBe(
      "Survive 30 ticks. Don't lose your foothold.",
    );
    expect(display.reward).toBe("$1 per user served");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/dashboard/briefing-text.test.ts`
Expected: FAIL — cannot resolve `src/dashboard/td/briefing-text.js`.

- [ ] **Step 3: Implement the module**

Create `src/dashboard/td/briefing-text.ts`:

```ts
import type { TDWaveDefinition } from "@modes/td/td-waves.js";

export interface BriefingDisplay {
  readonly title: string;
  readonly narrative?: string;
  readonly load: { readonly dots: number; readonly label: string };
  readonly traffic: string;
  readonly objective: string;
  readonly reward: string;
}

export function computeLoad(intensity: number): { dots: number; label: string } {
  if (intensity <= 15) return { dots: 1, label: "LIGHT" };
  if (intensity <= 50) return { dots: 2, label: "STEADY" };
  if (intensity <= 150) return { dots: 3, label: "HEAVY" };
  if (intensity <= 500) return { dots: 4, label: "PEAK" };
  return { dots: 5, label: "EXTREME" };
}

export function describeTraffic(
  composition: ReadonlyMap<string, number>,
): string {
  const types = new Set(composition.keys());
  if (types.size === 1 && types.has("api_read")) {
    return "A handful of readers";
  }
  if (types.has("stream")) return "Viewers tuning in";
  if (types.has("batch")) return "Background jobs and reads";
  if (types.has("auth_required")) return "Sign-ins and reads";
  if (types.has("static_asset")) return "Readers and asset traffic";
  if (types.has("api_write") && types.has("api_read") && types.size === 2) {
    return "Readers and contributors";
  }
  return "Mixed traffic";
}

export function describeObjective(wave: TDWaveDefinition): string {
  if (wave.id === 1) {
    return "Survive 30 ticks. Don't lose your foothold.";
  }
  return `Hold the line for ${wave.duration} ticks.`;
}

export function describeReward(
  revenue: ReadonlyMap<string, number>,
): string {
  const values = Array.from(revenue.values());
  if (values.length === 0) return "No reward";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return `$${min} per user served`;
  return `$${min}–$${max} per user served`;
}

export function renderBriefing(wave: TDWaveDefinition): BriefingDisplay {
  // Filter revenue to only the traffic types that actually appear in this
  // wave's composition. WAVE_1's revenuePerRequestType holds both api_read
  // and api_write rates even though composition is 100% api_read; passing
  // the raw map would show "$1–$2 per user served" instead of "$1 per user
  // served". describeReward itself stays general-purpose.
  const activeRevenue = new Map<string, number>();
  for (const [type, rate] of wave.revenuePerRequestType) {
    if (wave.composition.has(type)) activeRevenue.set(type, rate);
  }
  return {
    title: wave.name.toUpperCase(),
    load: computeLoad(wave.intensity),
    traffic: describeTraffic(wave.composition),
    objective: describeObjective(wave),
    reward: describeReward(activeRevenue),
  };
}
```

- [ ] **Step 4: Run the test — expected PASS**

Run: `pnpm test tests/unit/dashboard/briefing-text.test.ts`
Expected: PASS (20 test cases).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/td/briefing-text.ts tests/unit/dashboard/briefing-text.test.ts
git commit -m "feat(dashboard): pure briefing-text module"
```

---

## Task 4: `wave-narrative.ts` — optional per-wave story beat

**Files:**
- Create: `src/dashboard/td/wave-narrative.ts`
- Create: `tests/unit/dashboard/wave-narrative.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/wave-narrative.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  WAVE_NARRATIVES,
  getNarrative,
} from "../../../src/dashboard/td/wave-narrative.js";

describe("wave-narrative", () => {
  it("wave 1 has an authored narrative", () => {
    expect(getNarrative(1)).toBe(
      "Your service just went live. A trickle of users is knocking.",
    );
  });

  it("unknown wave ids return undefined", () => {
    expect(getNarrative(42)).toBeUndefined();
  });

  it("WAVE_NARRATIVES is keyed by wave id", () => {
    expect(WAVE_NARRATIVES[1]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it — expected FAIL**

Run: `pnpm test tests/unit/dashboard/wave-narrative.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/dashboard/td/wave-narrative.ts`:

```ts
export const WAVE_NARRATIVES: Readonly<Record<number, string>> = {
  1: "Your service just went live. A trickle of users is knocking.",
};

export function getNarrative(waveId: number): string | undefined {
  return WAVE_NARRATIVES[waveId];
}
```

- [ ] **Step 4: Run the test — expected PASS**

Run: `pnpm test tests/unit/dashboard/wave-narrative.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/td/wave-narrative.ts tests/unit/dashboard/wave-narrative.test.ts
git commit -m "feat(dashboard): wave narrative module with Wave 1 copy"
```

---

## Task 5: `ComponentDossierStore` — localStorage-backed seen-set (TDD)

**Files:**
- Create: `src/dashboard/td/component-dossier.ts` (store half only; modal half lands in Task 7)
- Create: `tests/unit/dashboard/component-dossier-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/component-dossier-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { ComponentDossierStore } from "../../../src/dashboard/td/component-dossier.js";

describe("ComponentDossierStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts empty when localStorage has nothing", () => {
    const store = new ComponentDossierStore();
    expect(store.hasSeen("server")).toBe(false);
  });

  it("markSeen persists to localStorage", () => {
    const store = new ComponentDossierStore();
    store.markSeen("server");
    expect(store.hasSeen("server")).toBe(true);

    const restored = new ComponentDossierStore();
    expect(restored.hasSeen("server")).toBe(true);
  });

  it("markSeen is idempotent", () => {
    const store = new ComponentDossierStore();
    store.markSeen("server");
    store.markSeen("server");
    expect(store.hasSeen("server")).toBe(true);
  });

  it("clear removes persisted state", () => {
    const store = new ComponentDossierStore();
    store.markSeen("server");
    store.markSeen("database");
    store.clear();
    expect(store.hasSeen("server")).toBe(false);

    const restored = new ComponentDossierStore();
    expect(restored.hasSeen("server")).toBe(false);
    expect(restored.hasSeen("database")).toBe(false);
  });

  it("tolerates corrupt localStorage without throwing", () => {
    window.localStorage.setItem("td-dossiers-seen", "not-json{{");
    expect(() => new ComponentDossierStore()).not.toThrow();
    expect(new ComponentDossierStore().hasSeen("server")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expected FAIL**

Run: `pnpm test tests/unit/dashboard/component-dossier-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/dashboard/td/component-dossier.ts`:

```ts
const STORAGE_KEY = "td-dossiers-seen";

export class ComponentDossierStore {
  private seen: Set<string>;

  constructor() {
    this.seen = new Set();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (typeof entry === "string") this.seen.add(entry);
          }
        }
      }
    } catch {
      // Corrupt state — start fresh; the next markSeen rewrites it.
    }
  }

  hasSeen(type: string): boolean {
    return this.seen.has(type);
  }

  markSeen(type: string): void {
    this.seen.add(type);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(this.seen)),
    );
  }

  clear(): void {
    this.seen.clear();
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
```

- [ ] **Step 4: Run the test — expected PASS**

Run: `pnpm test tests/unit/dashboard/component-dossier-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/td/component-dossier.ts tests/unit/dashboard/component-dossier-store.test.ts
git commit -m "feat(dashboard): ComponentDossierStore with localStorage persistence"
```

---

## Task 6: Dossier content data (Server + Database)

**Files:**
- Modify: `src/dashboard/td/component-dossier.ts` (append a `DOSSIERS` export)
- Modify: `tests/unit/dashboard/component-dossier-store.test.ts` (append a content sanity block)

- [ ] **Step 1: Add the content export**

Append to `src/dashboard/td/component-dossier.ts` (below the `ComponentDossierStore` class):

```ts
export interface ComponentDossier {
  readonly title: string;
  readonly body: string;
  readonly wire: string;
  readonly handles: string;
  readonly tip?: string;
}

export const DOSSIERS: Readonly<Record<string, ComponentDossier>> = {
  server: {
    title: "SERVER",
    body:
      "Servers are the workhorses of your stack. They take a request from a user, do the work, and send a response back.",
    wire: "Client → Server → Database",
    handles: "Read requests (and writes, if forwarded to a Database)",
    tip: "You always need at least one. Without a Server in the read path, your users have nowhere to go.",
  },
  database: {
    title: "DATABASE",
    body:
      "Databases store your data. They accept writes from Servers and hold onto them for later reads. Databases don't answer user requests directly — they sit behind a Server.",
    wire: "Server → Database",
    handles: "Write requests forwarded from a Server",
    tip: "A Database alone can't serve users — it needs a Server in front of it to route reads.",
  },
  // Roadmap: cache, load_balancer, cdn, api_gateway, queue, worker,
  // circuit_breaker, dns_gtm, streaming_server, blob_storage. Slice C.
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Append a content sanity test**

Append to `tests/unit/dashboard/component-dossier-store.test.ts`:

```ts
import { DOSSIERS } from "../../../src/dashboard/td/component-dossier.js";

describe("DOSSIERS content", () => {
  it("ships Server and Database copy", () => {
    expect(DOSSIERS.server?.title).toBe("SERVER");
    expect(DOSSIERS.database?.title).toBe("DATABASE");
    expect(DOSSIERS.server?.body.length).toBeGreaterThan(0);
    expect(DOSSIERS.database?.body.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run the tests — expected PASS**

Run: `pnpm test tests/unit/dashboard/component-dossier-store.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/td/component-dossier.ts tests/unit/dashboard/component-dossier-store.test.ts
git commit -m "feat(dashboard): Server + Database dossier content"
```

---

## Task 7: `showDossier` modal renderer (happy-dom TDD)

**Files:**
- Modify: `src/dashboard/td/component-dossier.ts` (append `showDossier`)
- Modify: `src/dashboard/cyberpunk-hud.css` (append `.cp-dossier-*` styles)
- Create: `tests/unit/dashboard/component-dossier-modal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/component-dossier-modal.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { showDossier } from "../../../src/dashboard/td/component-dossier.js";

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe("showDossier modal", () => {
  beforeEach(clearBody);
  afterEach(clearBody);

  it("builds a dialog with the dossier title, wire, handles, rent, and tip", async () => {
    const done = showDossier("server", 80);
    const modal = document.querySelector<HTMLElement>(".cp-dossier-modal");
    expect(modal).not.toBeNull();
    expect(modal!.getAttribute("role")).toBe("dialog");

    const text = modal!.textContent ?? "";
    expect(text).toContain("SERVER");
    expect(text).toContain("Client → Server → Database");
    expect(text).toContain("Read requests");
    expect(text).toContain("$80");
    expect(text).toContain("GOT IT, PLACE IT");

    // Dismiss via CTA
    const cta = modal!.querySelector<HTMLButtonElement>(".cp-dossier-cta")!;
    cta.click();
    await done;

    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("dismisses on Escape", async () => {
    const done = showDossier("database", 80);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await done;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("dismisses on the X button", async () => {
    const done = showDossier("server", 80);
    const close = document.querySelector<HTMLButtonElement>(".cp-dossier-close")!;
    close.click();
    await done;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("uses a fallback label if the type has no dossier", async () => {
    const done = showDossier("unknown_type", 0);
    const modal = document.querySelector<HTMLElement>(".cp-dossier-modal")!;
    expect(modal.textContent).toContain("UNKNOWN_TYPE");
    modal.querySelector<HTMLButtonElement>(".cp-dossier-cta")!.click();
    await done;
  });
});
```

- [ ] **Step 2: Run it — expected FAIL**

Run: `pnpm test tests/unit/dashboard/component-dossier-modal.test.ts`
Expected: FAIL — `showDossier` is not exported.

- [ ] **Step 3: Implement `showDossier`**

Append to `src/dashboard/td/component-dossier.ts`:

```ts
/**
 * Renders a full-overlay dossier modal for the given component type.
 * Returns a Promise that resolves once the user dismisses the modal (CTA,
 * X button, or Escape). The caller is responsible for `markSeen(type)` after
 * the promise resolves — this keeps the store decoupled from the renderer.
 */
export function showDossier(type: string, rentPerWave: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const dossier = DOSSIERS[type];
    const titleText = dossier?.title ?? type.toUpperCase();

    const modal = document.createElement("div");
    modal.className = "cp-dossier-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", `${titleText} dossier`);

    const content = document.createElement("div");
    content.className = "cp-dossier-content cp-panel";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "cp-dossier-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close dossier");
    content.appendChild(close);

    const title = document.createElement("h2");
    title.className = "cp-dossier-title";
    title.textContent = titleText;
    content.appendChild(title);

    const sprite = document.createElement("div");
    sprite.className = "cp-dossier-sprite";
    sprite.dataset.type = type;
    content.appendChild(sprite);

    const body = document.createElement("p");
    body.className = "cp-dossier-body";
    body.textContent = dossier?.body ?? "";
    content.appendChild(body);

    const rows = document.createElement("div");
    rows.className = "cp-dossier-rows";
    rows.appendChild(dossierRow("WIRE", dossier?.wire ?? "—"));
    rows.appendChild(dossierRow("HANDLES", dossier?.handles ?? "—"));
    rows.appendChild(dossierRow("RENT", `$${rentPerWave} / wave`));
    if (dossier?.tip) rows.appendChild(dossierRow("TIP", dossier.tip));
    content.appendChild(rows);

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "cp-dossier-cta";
    cta.textContent = "GOT IT, PLACE IT";
    content.appendChild(cta);

    modal.appendChild(content);
    document.body.appendChild(modal);

    const dismiss = (): void => {
      document.removeEventListener("keydown", onKey);
      if (modal.parentNode) modal.parentNode.removeChild(modal);
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") dismiss();
    };

    close.addEventListener("click", dismiss);
    cta.addEventListener("click", dismiss);
    document.addEventListener("keydown", onKey);

    // Minimal focus trap: focus the CTA so Enter confirms.
    cta.focus();
  });
}

function dossierRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "cp-dossier-row";
  const k = document.createElement("span");
  k.className = "cp-dossier-row-key";
  k.textContent = label;
  const v = document.createElement("span");
  v.className = "cp-dossier-row-val";
  v.textContent = value;
  row.appendChild(k);
  row.appendChild(v);
  return row;
}
```

- [ ] **Step 4: Run the tests — expected PASS**

Run: `pnpm test tests/unit/dashboard/component-dossier-modal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add dossier modal CSS**

Append to `src/dashboard/cyberpunk-hud.css`:

```css
/* ─── Dossier modal ─────────────────────────────────────────────── */
body.renderer-iso .cp-dossier-modal {
  position: fixed;
  inset: 0;
  background: rgba(3, 7, 18, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}
body.renderer-iso .cp-dossier-content {
  position: relative;
  min-width: 420px;
  max-width: 520px;
  padding: 28px 32px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
body.renderer-iso .cp-dossier-close {
  position: absolute;
  top: 10px;
  right: 12px;
  background: transparent;
  border: none;
  color: var(--cp-text-dim, #8b8fa3);
  font-size: 20px;
  cursor: pointer;
}
body.renderer-iso .cp-dossier-title {
  font-family: var(--cp-mono, ui-monospace, monospace);
  font-size: 20px;
  letter-spacing: 0.12em;
  color: var(--cp-text, #e1e4ed);
  margin: 0;
}
body.renderer-iso .cp-dossier-sprite {
  height: 72px;
  border: 1px dashed rgba(255, 255, 255, 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--cp-text-dim, #8b8fa3);
  font-family: var(--cp-mono, ui-monospace, monospace);
  font-size: 12px;
}
body.renderer-iso .cp-dossier-sprite::after {
  content: attr(data-type);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
body.renderer-iso .cp-dossier-body {
  color: var(--cp-text, #e1e4ed);
  line-height: 1.5;
  margin: 0;
}
body.renderer-iso .cp-dossier-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
body.renderer-iso .cp-dossier-row {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 12px;
  font-family: var(--cp-mono, ui-monospace, monospace);
  font-size: 12px;
}
body.renderer-iso .cp-dossier-row-key {
  color: var(--cp-text-dim, #8b8fa3);
  letter-spacing: 0.1em;
}
body.renderer-iso .cp-dossier-row-val {
  color: var(--cp-text, #e1e4ed);
}
body.renderer-iso .cp-dossier-cta {
  align-self: flex-end;
  margin-top: 8px;
  padding: 10px 18px;
  background: var(--cp-accent, #22d3ee);
  color: #031017;
  border: none;
  font-family: var(--cp-mono, ui-monospace, monospace);
  letter-spacing: 0.15em;
  cursor: pointer;
}
body.renderer-iso .cp-dossier-cta:hover {
  filter: brightness(1.1);
}
```

- [ ] **Step 6: Typecheck + full dashboard test run**

Run: `pnpm typecheck && pnpm test tests/unit/dashboard/`
Expected: clean typecheck, all dashboard tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/td/component-dossier.ts src/dashboard/cyberpunk-hud.css tests/unit/dashboard/component-dossier-modal.test.ts
git commit -m "feat(dashboard): dossier modal renderer with CSS and happy-dom tests"
```

---

## Task 8: `CyberpunkHudController` — direct HUD handle exposed from cyberpunk-hud.ts

**Files:**
- Modify: `src/dashboard/cyberpunk-hud.ts` (add a controller handle returned from `activateCyberpunkHud`)
- Modify: `src/dashboard/cyberpunk-hud.css` (append styles for viability, next-bill, toast, briefing, NEW badge)

**Context:** Slice A's HUD uses MutationObservers to mirror the classic DOM. For Slice B we need to push structured state (briefing display, viability fraction, next bill, toast message) into specific HUD elements from `main.ts` directly. We add a `CyberpunkHudController` interface that `buildHud` returns, and expose it via a module-level getter so `main.ts` can grab it after boot.

- [ ] **Step 1: Extend the top of `cyberpunk-hud.ts` with types + getter**

Replace the file's existing header (the JSDoc block plus the `PaletteEntry` import block through the `activateCyberpunkHud` function) with:

```ts
/**
 * Cyberpunk HUD — full-screen overlay for the iso TD renderer.
 *
 * Activates on ?renderer=iso. Slice B exposes a CyberpunkHudController
 * handle for pushing structured state (briefing, viability, next bill,
 * toast) from main.ts; the older mirror-observer pattern is retained for
 * the simple text fields (wave pill, phase, budget) that haven't been
 * migrated yet.
 */

import type { BriefingDisplay } from "./td/briefing-text.js";

export interface CyberpunkHudController {
  updateBriefing(display: BriefingDisplay): void;
  hideBriefing(): void;
  updateViability(v: { value: number; fraction: number }): void;
  updateNextBill(bill: number | null): void;
  showToast(message: string): void;
  /** Returns palette button elements keyed by component type — used for NEW badges and click interception. */
  getPaletteButtons(): ReadonlyMap<string, HTMLButtonElement>;
}

interface PaletteEntry {
  readonly type: string;
  readonly label: string;
}

const PALETTE: readonly PaletteEntry[] = [
  { type: "server", label: "Server" },
  { type: "database", label: "Database" },
  { type: "cache", label: "Cache" },
  { type: "load_balancer", label: "Balancer" },
  { type: "cdn", label: "CDN" },
  { type: "api_gateway", label: "Gateway" },
];

let hudController: CyberpunkHudController | null = null;

/** Returns the HUD controller once the HUD has been built. Null before activation. */
export function getCyberpunkHudController(): CyberpunkHudController | null {
  return hudController;
}

/** True when the current URL opts into the iso renderer + cyberpunk HUD. */
export function isCyberpunkHudActive(): boolean {
  return new URLSearchParams(window.location.search).get("renderer") === "iso";
}

/** Activate the cyberpunk HUD. Idempotent. */
export function activateCyberpunkHud(): void {
  document.body.classList.add("renderer-iso");
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildHud, { once: true });
  } else {
    buildHud();
  }
}
```

- [ ] **Step 2: Replace `buildHud` with the Slice B version**

Replace the existing `buildHud` with:

```ts
function buildHud(): void {
  if (document.getElementById("cp-hud-root")) return;

  const root = document.createElement("div");
  root.id = "cp-hud-root";
  document.body.appendChild(root);

  buildWavePill(root);
  buildResourcesPanel(root);
  buildViabilityPanel(root);
  buildBriefingPanel(root);
  buildInfoPanel(root);
  buildPaletteStrip(root);
  buildReadyButton(root);
  buildLossModal(root);
  buildToast(root);

  hudController = {
    updateBriefing,
    hideBriefing,
    updateViability,
    updateNextBill,
    showToast,
    getPaletteButtons: () => paletteButtons,
  };
}
```

- [ ] **Step 3: Replace `buildResourcesPanel` — adds NEXT BILL row**

Replace the existing `buildResourcesPanel` with:

```ts
function buildResourcesPanel(root: HTMLElement): void {
  const p = panel("cp-resources");

  const budgetRow = div("cp-res-row");
  budgetRow.append(keyLabel("Budget"));
  const budgetVal = div("cp-res-val cp-mono");
  budgetVal.textContent = "$0";
  budgetRow.append(budgetVal);
  p.append(budgetRow);

  nextBillRow = div("cp-res-row cp-res-next-bill cp-hidden");
  nextBillRow.append(keyLabel("Next Bill"));
  nextBillValue = div("cp-res-val cp-mono");
  nextBillValue.textContent = "$0";
  nextBillRow.append(nextBillValue);
  p.append(nextBillRow);

  const phaseRow = div("cp-res-row");
  phaseRow.append(keyLabel("Phase"));
  const phaseVal = div("cp-res-val cp-mono");
  phaseVal.textContent = "—";
  phaseRow.append(phaseVal);
  p.append(phaseRow);

  root.append(p);

  mirrorText("td-hud-budget", budgetVal);
  mirrorText("td-hud-phase", phaseVal, (text) => text.toUpperCase());
}
```

- [ ] **Step 4: Add `buildViabilityPanel`**

Insert above `buildBriefingPanel`:

```ts
function buildViabilityPanel(root: HTMLElement): void {
  const p = panel("cp-viability");
  viabilityPanel = p;

  const label = div("cp-res-key");
  label.textContent = "VIABILITY";
  p.append(label);

  const bar = div("cp-viability-bar");
  viabilityFill = div("cp-viability-fill cp-viability-fill--green");
  viabilityFill.style.width = "100%";
  bar.append(viabilityFill);
  p.append(bar);

  viabilityReadout = div("cp-viability-readout cp-mono");
  viabilityReadout.textContent = "100%";
  p.append(viabilityReadout);

  root.append(p);
}
```

- [ ] **Step 5: Replace `buildBriefingPanel` with a direct-render version**

Replace the existing `buildBriefingPanel` with:

```ts
function buildBriefingPanel(root: HTMLElement): void {
  const p = panel("cp-briefing cp-hidden");
  p.id = "cp-briefing-panel";

  briefingTitle = div("cp-briefing-title");
  briefingTitle.textContent = "";
  p.append(briefingTitle);

  briefingNarrative = div("cp-briefing-narrative cp-hidden");
  p.append(briefingNarrative);

  const body = div("cp-briefing-body");

  const loadRow = briefingCustomRow(body, "Incoming");
  briefingLoadDots = div("cp-briefing-load-dots cp-mono");
  briefingLoadLabel = div("cp-briefing-load-label");
  loadRow.append(briefingLoadDots, briefingLoadLabel);

  briefingTraffic = briefingValueRow(body, "Traffic");
  briefingObjective = briefingValueRow(body, "Objective");
  briefingReward = briefingValueRow(body, "Reward");

  p.append(body);
  root.append(p);
}

function briefingValueRow(parent: HTMLElement, label: string): HTMLElement {
  const r = div("cp-brief-row");
  const k = div("cp-brief-key");
  k.textContent = label;
  r.append(k);
  const v = div("cp-brief-val");
  r.append(v);
  parent.append(r);
  return v;
}

function briefingCustomRow(parent: HTMLElement, label: string): HTMLElement {
  const r = div("cp-brief-row");
  const k = div("cp-brief-key");
  k.textContent = label;
  r.append(k);
  parent.append(r);
  return r;
}
```

- [ ] **Step 6: Collect palette buttons into a map**

Replace the existing `buildPaletteStrip` with:

```ts
const paletteButtons = new Map<string, HTMLButtonElement>();

function buildPaletteStrip(root: HTMLElement): void {
  const strip = div("cp-palette");

  const label = div("cp-palette-header");
  label.textContent = "COMPONENT PALETTE";
  strip.append(label);

  const cells = div("cp-palette-cells");
  strip.append(cells);

  for (const entry of PALETTE) {
    const cell = paletteCell(entry);
    cells.append(cell);
    paletteButtons.set(entry.type, cell as HTMLButtonElement);
  }

  root.append(strip);
}
```

(`paletteCell` and `syncPaletteState` are unchanged.)

- [ ] **Step 7: Add `buildToast`**

Insert above `buildLossModal`:

```ts
function buildToast(root: HTMLElement): void {
  toastEl = div("cp-toast");
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  root.append(toastEl);
}
```

- [ ] **Step 8: Add the Slice B state + setters**

Just above the `// ─── Helpers` section, insert:

```ts
// ─── Slice B — controller state + setters ─────────────────────────────

let briefingTitle: HTMLElement;
let briefingNarrative: HTMLElement;
let briefingLoadDots: HTMLElement;
let briefingLoadLabel: HTMLElement;
let briefingTraffic: HTMLElement;
let briefingObjective: HTMLElement;
let briefingReward: HTMLElement;

let viabilityPanel: HTMLElement;
let viabilityFill: HTMLElement;
let viabilityReadout: HTMLElement;

let nextBillRow: HTMLElement;
let nextBillValue: HTMLElement;

let toastEl: HTMLElement;
let toastTimer: number | null = null;

function updateBriefing(display: BriefingDisplay): void {
  briefingTitle.textContent = display.title;
  briefingNarrative.textContent = display.narrative ?? "";
  briefingNarrative.classList.toggle("cp-hidden", !display.narrative);
  briefingLoadDots.textContent =
    "●".repeat(display.load.dots) + "○".repeat(5 - display.load.dots);
  briefingLoadLabel.textContent = display.load.label;
  briefingTraffic.textContent = display.traffic;
  briefingObjective.textContent = display.objective;
  briefingReward.textContent = display.reward;
  document.getElementById("cp-briefing-panel")?.classList.remove("cp-hidden");
}

function hideBriefing(): void {
  document.getElementById("cp-briefing-panel")?.classList.add("cp-hidden");
}

function updateViability(v: { value: number; fraction: number }): void {
  const pct = Math.max(0, Math.min(1, v.fraction));
  viabilityFill.style.width = `${(pct * 100).toFixed(1)}%`;
  viabilityFill.classList.remove(
    "cp-viability-fill--green",
    "cp-viability-fill--amber",
    "cp-viability-fill--red",
  );
  if (pct >= 0.5) {
    viabilityFill.classList.add("cp-viability-fill--green");
  } else if (pct >= 0.25) {
    viabilityFill.classList.add("cp-viability-fill--amber");
  } else {
    viabilityFill.classList.add("cp-viability-fill--red");
  }
  viabilityPanel.classList.toggle("cp-viability--low", pct < 0.25);
  viabilityReadout.textContent = `${Math.round(pct * 100)}%`;
}

function updateNextBill(bill: number | null): void {
  if (bill === null) {
    nextBillRow.classList.add("cp-hidden");
    return;
  }
  nextBillRow.classList.remove("cp-hidden");
  nextBillValue.textContent = `$${bill}`;
}

function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("cp-toast--visible");
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("cp-toast--visible");
    toastTimer = null;
  }, 3000);
}
```

- [ ] **Step 9: Remove the old briefing mirror wiring**

The old `buildBriefingPanel` contained `mirrorText("td-briefing-*", ...)` and `mirrorAttribute("td-briefing", ...)` calls. Those are gone as part of Step 5's rewrite — verify with:

```bash
grep -n "td-briefing" src/dashboard/cyberpunk-hud.ts
```

Expected: no matches.

- [ ] **Step 10: Append the new CSS**

Append to `src/dashboard/cyberpunk-hud.css`:

```css
/* ─── Viability meter ───────────────────────────────────────────── */
body.renderer-iso .cp-viability {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}
body.renderer-iso .cp-viability-bar {
  height: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  position: relative;
  overflow: hidden;
}
body.renderer-iso .cp-viability-fill {
  height: 100%;
  width: 100%;
  transition: width 180ms ease-out;
}
body.renderer-iso .cp-viability-fill--green { background: var(--cp-green, #22c55e); }
body.renderer-iso .cp-viability-fill--amber { background: var(--cp-amber, #f59e0b); }
body.renderer-iso .cp-viability-fill--red   { background: var(--cp-red, #ef4444); }
body.renderer-iso .cp-viability-readout {
  color: var(--cp-text, #e1e4ed);
  font-size: 12px;
  min-width: 36px;
  text-align: right;
}
@keyframes cp-viability-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
body.renderer-iso .cp-viability--low .cp-viability-fill {
  animation: cp-viability-pulse 0.8s ease-in-out infinite;
}

/* ─── NEXT BILL row ─────────────────────────────────────────────── */
body.renderer-iso .cp-res-next-bill .cp-res-val {
  color: var(--cp-amber, #f59e0b);
}

/* ─── Briefing panel (Slice B) ──────────────────────────────────── */
body.renderer-iso .cp-briefing-narrative {
  font-style: italic;
  color: var(--cp-text-dim, #8b8fa3);
  margin-bottom: 8px;
}
body.renderer-iso .cp-briefing-load-dots {
  letter-spacing: 0.2em;
  color: var(--cp-accent, #22d3ee);
}
body.renderer-iso .cp-briefing-load-label {
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--cp-text-dim, #8b8fa3);
  margin-left: 10px;
}

/* ─── Toast ─────────────────────────────────────────────────────── */
body.renderer-iso .cp-toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translate(-50%, 20px);
  padding: 12px 22px;
  background: rgba(3, 7, 18, 0.94);
  border: 1px solid var(--cp-accent, #22d3ee);
  color: var(--cp-text, #e1e4ed);
  font-family: var(--cp-mono, ui-monospace, monospace);
  font-size: 12px;
  letter-spacing: 0.08em;
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease-out, transform 180ms ease-out;
  z-index: 900;
  max-width: 560px;
  text-align: center;
}
body.renderer-iso .cp-toast--visible {
  opacity: 1;
  transform: translate(-50%, 0);
}

/* ─── NEW badge on palette cells ────────────────────────────────── */
body.renderer-iso .cp-palette-cell--new {
  position: relative;
}
body.renderer-iso .cp-palette-cell--new::after {
  content: "NEW";
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 1px 5px;
  background: var(--cp-accent, #22d3ee);
  color: #031017;
  font-family: var(--cp-mono, ui-monospace, monospace);
  font-size: 9px;
  letter-spacing: 0.1em;
  animation: cp-new-pulse 1.4s ease-in-out infinite;
}
@keyframes cp-new-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.08); opacity: 0.85; }
}
```

- [ ] **Step 11: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 12: Commit**

```bash
git add src/dashboard/cyberpunk-hud.ts src/dashboard/cyberpunk-hud.css
git commit -m "feat(dashboard): CyberpunkHudController with viability, next bill, toast, briefing"
```

---

## Task 9: HUD state setter tests (happy-dom)

**Files:**
- Create: `tests/unit/dashboard/cyberpunk-hud-viability.test.ts`
- Create: `tests/unit/dashboard/cyberpunk-hud-next-bill.test.ts`
- Create: `tests/unit/dashboard/cyberpunk-hud-briefing.test.ts`
- Create: `tests/unit/dashboard/cyberpunk-hud-toast.test.ts`

**Context:** We test the controller setters through `getCyberpunkHudController()` after activating the HUD on a clean document. We use a `clearBody()` helper that removes all children rather than setting `innerHTML = ""`.

- [ ] **Step 1: Write the viability test**

Create `tests/unit/dashboard/cyberpunk-hud-viability.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
} from "../../../src/dashboard/cyberpunk-hud.js";

function bootHud(): void {
  document.body.className = "";
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  window.history.replaceState(null, "", "/?renderer=iso#mode=td");
  activateCyberpunkHud();
}

describe("CyberpunkHudController.updateViability", () => {
  beforeEach(bootHud);

  it("renders a green fill at 100%", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateViability({ value: 100, fraction: 1 });
    const fill = document.querySelector<HTMLElement>(".cp-viability-fill")!;
    expect(fill.style.width).toBe("100.0%");
    expect(fill.classList.contains("cp-viability-fill--green")).toBe(true);
  });

  it("switches to amber at 40%", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateViability({ value: 40, fraction: 0.4 });
    const fill = document.querySelector<HTMLElement>(".cp-viability-fill")!;
    expect(fill.classList.contains("cp-viability-fill--amber")).toBe(true);
    expect(fill.classList.contains("cp-viability-fill--green")).toBe(false);
  });

  it("switches to red + low pulse at 10%", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateViability({ value: 10, fraction: 0.1 });
    const fill = document.querySelector<HTMLElement>(".cp-viability-fill")!;
    const panel = document.querySelector<HTMLElement>(".cp-viability")!;
    expect(fill.classList.contains("cp-viability-fill--red")).toBe(true);
    expect(panel.classList.contains("cp-viability--low")).toBe(true);
  });

  it("clamps fractions outside [0,1]", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateViability({ value: -10, fraction: -0.5 });
    const fill = document.querySelector<HTMLElement>(".cp-viability-fill")!;
    expect(fill.style.width).toBe("0.0%");
  });
});
```

- [ ] **Step 2: Write the next-bill test**

Create `tests/unit/dashboard/cyberpunk-hud-next-bill.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
} from "../../../src/dashboard/cyberpunk-hud.js";

function bootHud(): void {
  document.body.className = "";
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  window.history.replaceState(null, "", "/?renderer=iso#mode=td");
  activateCyberpunkHud();
}

describe("CyberpunkHudController.updateNextBill", () => {
  beforeEach(bootHud);

  it("shows and writes a dollar amount", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateNextBill(160);
    const row = document.querySelector<HTMLElement>(".cp-res-next-bill")!;
    expect(row.classList.contains("cp-hidden")).toBe(false);
    expect(row.querySelector(".cp-res-val")!.textContent).toBe("$160");
  });

  it("hides the row when bill is null", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateNextBill(160);
    hud.updateNextBill(null);
    const row = document.querySelector<HTMLElement>(".cp-res-next-bill")!;
    expect(row.classList.contains("cp-hidden")).toBe(true);
  });
});
```

- [ ] **Step 3: Write the briefing test**

Create `tests/unit/dashboard/cyberpunk-hud-briefing.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
} from "../../../src/dashboard/cyberpunk-hud.js";
import { renderBriefing } from "../../../src/dashboard/td/briefing-text.js";
import { WAVE_1 } from "../../../src/modes/td/td-waves.js";
import { getNarrative } from "../../../src/dashboard/td/wave-narrative.js";

function bootHud(): void {
  document.body.className = "";
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  window.history.replaceState(null, "", "/?renderer=iso#mode=td");
  activateCyberpunkHud();
}

describe("CyberpunkHudController.updateBriefing", () => {
  beforeEach(bootHud);

  it("writes Wave 1 title, narrative, load, traffic, objective, reward", () => {
    const hud = getCyberpunkHudController()!;
    const display = renderBriefing(WAVE_1);
    // exactOptionalPropertyTypes rejects `narrative: getNarrative(1)` when
    // the getter can return undefined — conditional-spread keeps the key
    // absent rather than explicitly undefined. Local renamed to avoid
    // shadowing the later `narrativeEl` DOM query.
    const waveNarrative = getNarrative(1);
    hud.updateBriefing({
      ...display,
      ...(waveNarrative !== undefined ? { narrative: waveNarrative } : {}),
    });

    const panel = document.getElementById("cp-briefing-panel")!;
    expect(panel.classList.contains("cp-hidden")).toBe(false);

    const title = panel.querySelector(".cp-briefing-title")!;
    expect(title.textContent).toBe("LAUNCH DAY");

    const narrativeEl = panel.querySelector(".cp-briefing-narrative")!;
    expect(narrativeEl.textContent).toContain("trickle of users");

    const dots = panel.querySelector(".cp-briefing-load-dots")!;
    expect(dots.textContent).toBe("●○○○○");

    const text = panel.textContent ?? "";
    expect(text).toContain("LIGHT");
    expect(text).toContain("A handful of readers");
    expect(text).toContain("Survive 30 ticks");
    expect(text).toContain("$1 per user served");
  });

  it("hides the briefing on demand", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateBriefing(renderBriefing(WAVE_1));
    hud.hideBriefing();
    expect(
      document.getElementById("cp-briefing-panel")!.classList.contains("cp-hidden"),
    ).toBe(true);
  });
});
```

- [ ] **Step 4: Write the toast test**

Create `tests/unit/dashboard/cyberpunk-hud-toast.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
} from "../../../src/dashboard/cyberpunk-hud.js";

function bootHud(): void {
  document.body.className = "";
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  window.history.replaceState(null, "", "/?renderer=iso#mode=td");
  activateCyberpunkHud();
}

describe("CyberpunkHudController.showToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bootHud();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast and hides it after 3s", () => {
    const hud = getCyberpunkHudController()!;
    hud.showToast("Rent due: $160. You only have $80.");
    const toast = document.querySelector<HTMLElement>(".cp-toast")!;
    expect(toast.textContent).toContain("Rent due");
    expect(toast.classList.contains("cp-toast--visible")).toBe(true);
    vi.advanceTimersByTime(3100);
    expect(toast.classList.contains("cp-toast--visible")).toBe(false);
  });

  it("replaces an earlier toast on re-call", () => {
    const hud = getCyberpunkHudController()!;
    hud.showToast("first");
    vi.advanceTimersByTime(1000);
    hud.showToast("second");
    const toast = document.querySelector<HTMLElement>(".cp-toast")!;
    expect(toast.textContent).toBe("second");
    expect(toast.classList.contains("cp-toast--visible")).toBe(true);
  });
});
```

- [ ] **Step 5: Run all four tests**

Run: `pnpm test tests/unit/dashboard/cyberpunk-hud-`
Expected: PASS (10 tests across the four files).

**Note:** The HUD module caches state at module load. If Vitest's module isolation doesn't clear it between test files, each `bootHud` call will find `cp-hud-root` already present and early-return from `buildHud`. In that case, add a module-level reset helper to `cyberpunk-hud.ts` exposed only under test (e.g. `export function __resetHudForTest() { hudController = null; paletteButtons.clear(); const root = document.getElementById("cp-hud-root"); if (root) root.remove(); }`) and call it from `bootHud`. Discover the need only if the tests fail at Step 5 — do not add the helper speculatively.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/dashboard/cyberpunk-hud-*.test.ts src/dashboard/cyberpunk-hud.ts
git commit -m "test(dashboard): cover CyberpunkHudController setters under happy-dom"
```

---

## Task 10: Rent pre-flight in the READY handler (td-mode.ts)

**Files:**
- Modify: `src/dashboard/td-mode.ts` — the `onReady` function (around line 418) and its imports

**Context:** `TDModeController.payRent(state)` is atomic — it debits on success and leaves state unchanged on failure. We call it BEFORE `advancePhase`. If the player lacks funds, we surface the toast and stay in build. If topology errors are present after `advancePhase`, we surface them as an advisory toast but still proceed (topology is non-blocking per the spec).

- [ ] **Step 1: Locate the current `onReady` function**

Read `src/dashboard/td-mode.ts:418-425`. It reads:

```ts
function onReady(): void {
  if (controller.getPhase() !== "build") return;
  controller.advancePhase(state);
  args.onPhaseChange?.();
  refreshHud();
}
readyBtn.addEventListener("click", onReady);
```

- [ ] **Step 2: Replace `onReady` with the rent-preflight version**

Replace those lines with:

```ts
function onReady(): void {
  if (controller.getPhase() !== "build") return;

  // Slice B: atomic rent pre-flight. Runs BEFORE advancePhase.
  const rent = controller.payRent(state);
  if (!rent.ok) {
    const hud = getCyberpunkHudController();
    const msg =
      `Rent due: $${rent.bill}. You only have $${rent.budget}. ` +
      `Scrap a component to reduce the bill.`;
    if (hud) {
      hud.showToast(msg);
    } else {
      // Classic (deprecated) path: fall back to an alert so the player
      // at least sees the block.
      // eslint-disable-next-line no-alert
      window.alert(msg);
    }
    return;
  }

  controller.advancePhase(state);

  // Topology validation is advisory — surface any warnings but continue.
  const errors = controller.getTopologyErrors();
  if (errors.length > 0) {
    const hud = getCyberpunkHudController();
    if (hud) {
      const summary = errors
        .map((e) => (e as unknown as { detail?: string; kind?: string }).detail
          ?? (e as unknown as { kind?: string }).kind
          ?? "unknown")
        .join(" · ");
      hud.showToast(`Topology warning: ${summary}`);
    }
  }

  args.onPhaseChange?.();
  refreshHud();
}
readyBtn.addEventListener("click", onReady);
```

- [ ] **Step 3: Add the HUD controller import at the top of `src/dashboard/td-mode.ts`**

Add this import line after the existing `./td/*` import block (around line 24):

```ts
import { getCyberpunkHudController } from "./cyberpunk-hud.js";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: clean. If the topology-error `e.detail` / `e.kind` access fails typecheck because the exported `TopologyError` has different field names, open `src/modes/td/validate-topology.ts` and adjust the `summary` expression to use real fields. Do NOT silence typecheck errors.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`
Expected: all tests PASS. `runWave` tests are unaffected because they call `controller.advancePhase` directly and bypass the dashboard's `onReady`.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/td-mode.ts
git commit -m "feat(dashboard): rent pre-flight in TD READY handler"
```

---

## Task 11: Palette NEW badge + first-click dossier interception

**Files:**
- Modify: `src/dashboard/main.ts` (imports; module-level `dossierStore`; wiring inside `bootTDMode` after `createTDDashboard`)

**Context:** The iso HUD's palette cells (`paletteCell` in `cyberpunk-hud.ts`) already forward their click to `.td-palette-btn[data-type=X]`. We attach a capture-phase click handler on each iso cell BEFORE the forward runs: if the dossier hasn't been seen, preventDefault, open the modal, await dismissal, `markSeen`, then forward manually via the classic button. The `cp-palette-cell--new` class is toggled on boot and on phase change.

- [ ] **Step 1: Import the dossier store + content + modal + HUD getter in main.ts**

At the top of `src/dashboard/main.ts` with the other TD imports (after the `activateCyberpunkHud` import), add:

```ts
import {
  ComponentDossierStore,
  DOSSIERS,
  showDossier,
} from "./td/component-dossier.js";
import { getCyberpunkHudController } from "./cyberpunk-hud.js";
```

- [ ] **Step 2: Create a module-level store instance**

Near the module-level TD state block (around line 416 where `tdDashboard` is declared), add:

```ts
const dossierStore = new ComponentDossierStore();
```

- [ ] **Step 3: Wire NEW badges + interception after TD dashboard boot**

Inside `bootTDMode`, immediately after the `tdDashboard = await createTDDashboard({ ... });` block (and before `tdLoop = new SimLoop(...)`), add:

```ts
// Slice B: NEW badges + first-click dossier interception.
{
  const hud = getCyberpunkHudController();
  if (hud) {
    const paletteButtonsMap = hud.getPaletteButtons();
    const wave = controller.getCurrentWave();
    for (const type of wave.availableComponents) {
      const cell = paletteButtonsMap.get(type);
      if (!cell) continue;
      cell.classList.toggle(
        "cp-palette-cell--new",
        !dossierStore.hasSeen(type),
      );
    }

    for (const [type, cell] of paletteButtonsMap) {
      // Capture phase so we run BEFORE cyberpunk-hud's own forwarding click.
      cell.addEventListener(
        "click",
        async (e: Event) => {
          if (dossierStore.hasSeen(type)) return;
          if (!(type in DOSSIERS)) {
            // No content authored yet — mark seen silently so we don't block
            // placement indefinitely on a roadmap component.
            dossierStore.markSeen(type);
            cell.classList.remove("cp-palette-cell--new");
            return;
          }
          e.preventDefault();
          e.stopImmediatePropagation();
          const entry = compRegistry.get(type);
          const rent = entry?.rentPerWave ?? 0;
          await showDossier(type, rent);
          dossierStore.markSeen(type);
          cell.classList.remove("cp-palette-cell--new");
          // Forward manually to the classic palette button so the place-mode
          // state machine kicks in. This mirrors what cyberpunk-hud's normal
          // forwarding would have done.
          const classicBtn = document.querySelector<HTMLButtonElement>(
            `.td-palette-btn[data-type="${type}"]`,
          );
          classicBtn?.click();
        },
        { capture: true },
      );
    }
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: clean. `compRegistry` is defined earlier in `bootTDMode` (line ~976) and is in scope at the insertion point.

- [ ] **Step 5: Full test run**

Run: `pnpm test`
Expected: all tests PASS. No new unit tests for this piece — the happy-dom `showDossier` test (Task 7) covers the modal; the interception path is exercised by the playtest in Task 15.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/main.ts
git commit -m "feat(dashboard): dossier NEW badges and first-click interception"
```

---

## Task 12: Replace `tdOnTick` outcome gating with `getTerminalState`

**Files:**
- Modify: `src/dashboard/main.ts` — `tdOnTick` (line ~618), `showDeathModal` + `showWinModal` (new), the `$tdRetryBtn` wiring (line ~1212)

**Context:** `tdOnTick` currently runs `controller.advancePhase(state)` + `controller.evaluateOutcome(metrics)` at drain and reads `outcome.verdict === "win"`. Slice A's `getTerminalState(state)` is the new gate: `"dead"` fires at any point during simulate; `"wave_passed"` fires only when the wave drains with viability > 0. We also push viability and next-bill into the HUD every tick.

- [ ] **Step 1: Pump viability + next-bill into the HUD every tick**

In `src/dashboard/main.ts`, inside `tdOnTick`, immediately after `tdDashboard?.applyTick(state, tdLoop?.tickInterval ?? 200);` (around line 628), add:

```ts
// Slice B: push live campaign state into the cyberpunk HUD.
{
  const hud = getCyberpunkHudController();
  if (hud) {
    hud.updateViability(controller.getViability());
    if (controller.getPhase() === "build") {
      hud.updateNextBill(controller.getRentBill(state));
    } else {
      hud.updateNextBill(null);
    }
  }
}
```

- [ ] **Step 2: Migrate the terminal-state branch**

In `tdOnTick`, replace the block from `if (!controller.isWaveDrained(state)) return;` through the end of the function with:

```ts
const terminalState = controller.getTerminalState(state);
if (terminalState === "running") return;

// Either "dead" (viability hit 0 mid-wave) or "wave_passed" (drained with
// viability > 0). Both end the tick loop.
tdLoop?.stop();

if (terminalState === "dead") {
  // eslint-disable-next-line no-console
  console.warn(`[td-dead] viability=${controller.getViability().value}`);
  showDeathModal();
  tdTickSeq = 0;
  tdDashboard?.refreshHud();
  tdDashboard?.rerenderTopology();
  return;
}

// terminalState === "wave_passed"
// eslint-disable-next-line no-console
console.warn(
  `[td-wave-end] wave ${controller.getCurrentWaveIndex() + 1} drained at tick=${state.currentTick}`,
);
controller.advancePhase(state); // simulate → assess

// Snapshot the action log for retry semantics (same as before).
tdSnapshotIndex = tdActionLog.length;
// eslint-disable-next-line no-console
console.warn(`[td-snapshot] saved at action ${tdSnapshotIndex}`);

showWinModal();

const nextIdx = controller.getCurrentWaveIndex() + 1;
if (nextIdx < controller.getWaveCount()) {
  // Condition reset; economy carries over under the rent model — no
  // per-wave budget reset.
  for (const id of state.components.keys()) {
    state.setCondition(id, 1.0);
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[td-next-wave] advancing to wave ${nextIdx + 1} of ${controller.getWaveCount()}`,
  );
}
controller.advancePhase(state); // assess → build (or end of campaign)
tdTickSeq = 0;
tdDashboard?.refreshHud();
tdDashboard?.rerenderTopology();
```

- [ ] **Step 3: Add `showDeathModal` + `showWinModal`**

At the top of the `// === Loss modal helpers ===` block (around line 692), above the existing `gatherPerTypeCacheStats`, add:

```ts
function showDeathModal(): void {
  const modal = document.getElementById("td-loss-modal");
  const title = document.getElementById("td-loss-modal-title");
  const detail = document.getElementById("td-loss-modal-detail");
  if (!modal || !title || !detail || !tdController || !tdState) return;

  title.textContent = "YOUR OPPORTUNITY WINDOW HAS CLOSED";
  while (detail.firstChild) detail.removeChild(detail.firstChild);

  const flavor = document.createElement("div");
  flavor.textContent = "The market moved on. Your service couldn't keep up.";
  flavor.style.fontStyle = "italic";
  flavor.style.marginBottom = "10px";
  detail.appendChild(flavor);

  // Reuse the diagnose-wave hint for an actionable line.
  const metrics = tdController.getCurrentWaveMetrics(tdState);
  const diagnosis = diagnoseWave({
    wave: tdController.getCurrentWave(),
    metrics,
    components: tdState.components,
    connections: tdState.connections,
  });
  if (diagnosis.hint) {
    const hintEl = document.createElement("div");
    hintEl.textContent = diagnosis.hint;
    hintEl.style.color = "#8b8fa3";
    detail.appendChild(hintEl);
  }

  const retryBtn = document.getElementById("td-retry-btn");
  // Deaths are persistent — the button is a campaign restart, not a wave retry.
  if (retryBtn) retryBtn.textContent = "RESTART CAMPAIGN";
  modal.hidden = false;
}

function showWinModal(): void {
  if (!tdController || !tdState) return;
  const waveNum = tdController.getCurrentWaveIndex() + 1;
  const v = tdController.getViability();
  const budget = tdController.economy.getBudget();
  // Reuse the existing wave-result toast DOM for visual continuity.
  const outcome: OutcomeReport = {
    verdict: "win",
    score: { cost: budget, performance: 1, reliability: 1, composite: 1 },
    slaResults: {
      availability: { target: 0, actual: 1, passed: true },
      latency: { target: Infinity, actual: 0, passed: true },
      budget: { target: 0, actual: budget, passed: true },
      allPassed: true,
    },
    notes: [
      `Viability ${Math.round(v.fraction * 100)}%`,
      `Budget $${budget}`,
    ],
  };
  showWaveResultToast(outcome);
  // eslint-disable-next-line no-console
  console.warn(
    `[td-win] wave ${waveNum} passed; viability=${v.value} budget=${budget}`,
  );
}
```

- [ ] **Step 4: Rewire the retry button to restart the campaign on death**

The `$tdRetryBtn` click handler at line 1212 currently calls `retryTDWave()`. For death modals we want it to call `resetTDCampaign()` instead. Replace:

```ts
$tdRetryBtn?.addEventListener("click", () => retryTDWave());
```

with:

```ts
$tdRetryBtn?.addEventListener("click", () => {
  // Death modal repurposes this button as "RESTART CAMPAIGN".
  // Loss-without-death is no longer a path in the Slice B terminal model,
  // so the old retryTDWave flow is unreachable in normal gameplay. The
  // `retryTDWave` function and its helpers remain defined in case we need
  // them for a mercy-mode roadmap item (Slice C §6).
  resetTDCampaign();
});
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean. If the `OutcomeReport` / `SLAResult` import isn't present at the top of `main.ts`, the `OutcomeReport` reference in `showWinModal` will fail to resolve — the existing `import type { OutcomeReport } from "@core/types/outcome"` at line 19 satisfies this. If the `SLAResult` shape has more fields, extend the literal in Step 3 accordingly.

- [ ] **Step 6: Full test run**

Run: `pnpm test`
Expected: all tests PASS. `main.ts` has no unit tests; the integration path is exercised manually in Task 15.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/main.ts
git commit -m "feat(dashboard): migrate TD tick gating to getTerminalState"
```

---

## Task 13: Wire new briefing + viability refresh on phase change + edit events

**Files:**
- Modify: `src/dashboard/main.ts` — imports at top; initial paint at the end of `bootTDMode`; `onPhaseChange`, `onPlace`, `onConnect`, `onDisconnect`, `onRemove` callbacks inside `createTDDashboard({...})`

**Context:** The HUD's briefing panel needs to repaint when a new wave's build phase begins, and the viability meter needs an initial paint at boot. The next-bill counter refreshes on every edit event.

- [ ] **Step 1: Import `renderBriefing` + `getNarrative`**

At the top of `src/dashboard/main.ts` with the other TD dashboard imports, add:

```ts
import { renderBriefing } from "./td/briefing-text.js";
import { getNarrative } from "./td/wave-narrative.js";
```

- [ ] **Step 2: Paint the briefing + viability + next bill at boot**

In `bootTDMode`, at the very end (after `tdDashboard.refreshHud();`), add:

```ts
// Slice B: initial HUD paint for the starting wave.
{
  const hud = getCyberpunkHudController();
  if (hud) {
    const wave = controller.getCurrentWave();
    hud.updateBriefing({
      ...renderBriefing(wave),
      narrative: getNarrative(wave.id),
    });
    hud.updateViability(controller.getViability());
    hud.updateNextBill(controller.getRentBill(state));
  }
}
```

- [ ] **Step 3: Repaint on phase change (new build phase or new wave)**

Inside `bootTDMode`, in the `onPhaseChange` callback (around line 1090), replace the existing body with:

```ts
onPhaseChange: () => {
  tdDashboard?.refreshHud();
  const hud = getCyberpunkHudController();
  if (controller.isCampaignComplete()) {
    hud?.hideBriefing();
    hud?.updateNextBill(null);
  } else if (controller.getPhase() === "build") {
    const wave = controller.getCurrentWave();
    hud?.updateBriefing({
      ...renderBriefing(wave),
      narrative: getNarrative(wave.id),
    });
    hud?.updateNextBill(controller.getRentBill(state));
    // Refresh NEW badges for the new wave's available components.
    if (hud) {
      const paletteButtonsMap = hud.getPaletteButtons();
      for (const [type, cell] of paletteButtonsMap) {
        const available = wave.availableComponents.includes(type);
        cell.classList.toggle(
          "cp-palette-cell--new",
          available && !dossierStore.hasSeen(type),
        );
      }
    }
  } else if (controller.getPhase() === "simulate") {
    hud?.updateNextBill(null);
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[td-phase] now ${controller.getPhase()} (wave ${controller.getCurrentWaveIndex() + 1} of ${controller.getWaveCount()})`,
  );
  if (controller.getPhase() === "simulate") {
    waveStartTick = state.currentTick;
    state.recomputeVisitOrder();
    // eslint-disable-next-line no-console
    console.warn(
      `[td-engine] visitOrder refreshed; [${state.visitOrder.join(",")}] components=${state.components.size} connections=${state.connections.size}`,
    );
    tdLoop?.reset(engine, state, controller);
    tdLoop?.play();
    // eslint-disable-next-line no-console
    console.warn(`[td-loop] started; tickInterval=${tdLoop?.tickInterval}ms`);
  }
},
```

- [ ] **Step 4: Push bill update on place/connect/disconnect/remove**

In the same `bootTDMode` options object, inside `onPlace` (line ~1018), after `tdDashboard?.refreshHud();`, add:

```ts
getCyberpunkHudController()?.updateNextBill(controller.getRentBill(state));
```

Do the same inside `onConnect`, `onDisconnect`, and `onRemove`.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Full test run**

Run: `pnpm test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/main.ts
git commit -m "feat(dashboard): refresh briefing, viability, next-bill on phase and edit events"
```

---

## Task 14: Deprecate classic TD briefing-card

**Files:**
- Modify: `src/dashboard/td/briefing-card.ts` (add `@deprecated` JSDoc; no behavior change)
- Modify: `src/dashboard/main.ts` (console.warn once if the classic TD path is entered without iso)

**Context:** Slice B's entry-point redirect (Task 2) makes iso the default — the classic TD DOM only runs when a programmatic caller somehow bypasses the redirect. Mark both surfaces deprecated so a future removal pass can delete them.

- [ ] **Step 1: Add `@deprecated` to `briefing-card.ts`**

At the top of `src/dashboard/td/briefing-card.ts`, above the imports, insert:

```ts
/**
 * @deprecated Slice B (2026-04-16) — the cyberpunk HUD renders the briefing
 * directly via `renderBriefing` + `CyberpunkHudController.updateBriefing`.
 * This module is only used by the classic (non-iso) TD path, which now
 * redirects to iso at boot. Kept compiling so sandbox mode and any
 * programmatic callers still work; slated for removal in a Slice C cleanup.
 */
```

- [ ] **Step 2: Add a single console.warn when the classic TD path is entered**

In `src/dashboard/main.ts`, inside `bootTDMode`, at the very start (just after the existing `console.warn("[td-boot] bootTDMode start");`), insert:

```ts
if (!isCyberpunkHudActive()) {
  // eslint-disable-next-line no-console
  console.warn(
    "[td-classic] DEPRECATED — classic TD dashboard is being phased out. " +
    "Add ?renderer=iso to the URL for the supported experience.",
  );
}
```

- [ ] **Step 3: Typecheck + full test run**

Run: `pnpm typecheck && pnpm test`
Expected: clean, all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/td/briefing-card.ts src/dashboard/main.ts
git commit -m "chore(dashboard): mark classic TD briefing path deprecated"
```

---

## Task 15: End-to-end playtest checklist + production build verify

**Files:**
- Create: `docs/claude/slice-b-playtest-notes.md` (observations)

**Context:** Slice A handed off with 740 tests passing and the viability damage math verified by unit tests. Slice B is a dashboard pass — the HUD elements can only be truly validated in a browser. Run the spec §7.4 playtest checklist and capture observations for the follow-up tuning doc. Also run `vite build` to catch any Vite-specific issues that `vitest` misses (import-resolution, asset hashing).

- [ ] **Step 1: Full test suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS, clean typecheck. Test count should be the pre-Slice-B baseline plus the new dashboard tests added in Tasks 3–9 (roughly +45 tests).

- [ ] **Step 2: Production build**

Run: `pnpm exec vite build`
Expected: build succeeds with no errors. Warnings about bundle size are acceptable.

- [ ] **Step 3: Launch dev server**

First ensure port 5173 is free: `lsof -ti:5173 | xargs kill 2>/dev/null || true`
Run: `pnpm dev`
Open in browser: `http://localhost:5173/#mode=td`
Expected: the URL is immediately rewritten to `http://localhost:5173/?renderer=iso#mode=td` and the cyberpunk HUD is active.

- [ ] **Step 4: Playtest run 1 — naked Database (teaching failure)**

- Clear localStorage: in devtools console, run `localStorage.clear()`, then reload.
- Click the Database palette cell → dossier modal opens with the DATABASE content and `$80 / wave` rent row.
- Click `GOT IT, PLACE IT` → modal dismisses, placement cursor is active.
- Place the Database, connect Client → Database.
- Verify the NEXT BILL row on the resources panel shows `$80`.
- Click READY → wave runs. Verify the briefing panel shows the Wave 1 copy (LAUNCH DAY, narrative, 1 dot LIGHT, A handful of readers, Survive 30 ticks, $1 per user served).
- Wave drains — expect the viability meter to fall significantly (SimLoop fires `mode.onTick` so the damage math runs; ~60 viability expected after 30 ticks of a naked DB topology).
- Document the final viability, which modal fired (`wave_passed` or `dead`), and whether the copy reads correctly.

- [ ] **Step 5: Playtest run 2 — Server + Database (teaching success)**

- `localStorage.clear()` + reload.
- Click Server → dossier opens. Dismiss.
- Click Database → dossier opens. Dismiss.
- Both NEW badges are cleared.
- Place Server + Database, wire Client → Server → Database.
- NEXT BILL shows `$160`.
- READY → wave runs. Viability stays at 100. Budget ticks up as reads resolve.
- Wave clears with the WIN toast showing viability 100% and the end budget.

- [ ] **Step 6: Playtest run 3 — persistence check**

- Reload the browser without clearing localStorage.
- Click Server → placement starts immediately; no dossier modal.
- Click Database → placement starts immediately.
- No NEW badges.

- [ ] **Step 7: Capture observations**

Write `docs/claude/slice-b-playtest-notes.md` with findings from Steps 4–6 (briefing copy issues, dossier tone, meter colour feel, toast readability). Do not block on perfection — the spec's §8 tuning risks explicitly call out the need for a follow-up pass.

- [ ] **Step 8: Kill dev server**

Run: `lsof -ti:5173 | xargs kill 2>/dev/null || true`

- [ ] **Step 9: Commit playtest notes**

```bash
git add docs/claude/slice-b-playtest-notes.md
git commit -m "docs(td): Slice B playtest observations"
```

---

## Task 16: Final sweep — test count, typecheck, clean status

**Files:**
- None (verification only)

- [ ] **Step 1: Confirm final test count + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all PASS, clean typecheck. The test count should increase by roughly 45+ tests vs. the pre-Slice-B baseline (briefing-text ×20 cases, wave-narrative ×3, dossier-store ×6, dossier-modal ×4, viability ×4, next-bill ×2, briefing panel ×2, toast ×2, env ×1 — plus a few smaller ones from the content-sanity block).

- [ ] **Step 2: Check git status is clean**

Run: `git status`
Expected: clean working tree. All commits from this plan are present in history.

- [ ] **Step 3: Summarize what landed in a short commit-log check**

Run: `git log --oneline -25`
Expected: commits in roughly the order the tasks produced them (happy-dom env → iso redirect → briefing-text → wave-narrative → dossier-store → dossier-content → dossier-modal → CyberpunkHudController → HUD tests → rent pre-flight → palette interception → tdOnTick terminal-state → briefing phase wiring → deprecation → playtest notes).

- [ ] **Step 4: Plan complete**

Slice B is ready for merge. Slice C (VFX / SFX / remaining dossiers / wave narratives 2–10 / mercy mode / classic TD removal) remains a roadmap per spec §6 and should NOT be touched in this plan.

---

## Spec coverage self-review

Cross-referencing the plan against `docs/superpowers/specs/2026-04-15-wave1-ux-and-economy-design.md` §5:

| Spec section | Task(s) | Status |
|---|---|---|
| §5.1 Entry-point redirect | Task 2 | covered |
| §5.2 Briefing redesign (pure module) | Task 3 | covered |
| §5.2 Wave narrative | Task 4 | covered |
| §5.3 Briefing card DOM (cyberpunk) | Task 8 (panel rebuild), Task 9 (test), Task 13 (wiring) | covered |
| §5.4 Component dossier system (store + content) | Tasks 5, 6 | covered |
| §5.5 Dossier modal DOM | Task 7 | covered |
| §5.6 NEW badge + first-click interception | Task 8 (CSS + map), Task 11 (main.ts interception) | covered |
| §5.7 Viability meter HUD | Task 8 (builder + setter), Task 9 (tests), Task 12 (per-tick pump), Task 13 (boot paint) | covered |
| §5.8 Next wave bill counter | Task 8 (builder + setter), Task 13 (wiring) | covered |
| §5.9 READY handler integration (rent + topology toast) | Task 10 | covered |
| §5.10 Loss modal (death) | Task 12 (`showDeathModal`) | covered |
| §5.11 Win modal (wave clear) | Task 12 (`showWinModal`) | covered |
| §6 Slice C roadmap | Untouched, explicitly out of scope | covered |
| §7.3 New integration tests (Slice B) | Task 7 (dossier flow), Task 9 (briefing render) | covered |
| §7.4 Play-test checklist | Task 15 | covered |

**Placeholder scan:** no "TODO", "TBD", "implement later" tokens in the plan body. Every step has concrete code or a concrete command.

**Type consistency:** method names match Slice A's merged surface — `getViability()`, `getRentBill(state)`, `payRent(state)`, `getTerminalState(state?)`, `getTopologyErrors()`, `ComponentRegistryEntry.rentPerWave`, `PayRentResult = {ok:true; bill} | {ok:false; bill; budget}`. New dashboard names — `CyberpunkHudController`, `updateBriefing`, `hideBriefing`, `updateViability`, `updateNextBill`, `showToast`, `getPaletteButtons`, `ComponentDossierStore`, `showDossier`, `DOSSIERS`, `renderBriefing`, `getNarrative`, `computeLoad`, `describeTraffic`, `describeObjective`, `describeReward` — are used consistently across all tasks and test files.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-wave1-ux-slice-b-ui.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
