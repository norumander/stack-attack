# Plan 9 — Physics-TD Info Panel + Dossier Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire clicks on placed components to the dormant `#td-info-panel` mirror so players can see type / description / capability bullets / live utilization + drop + processed tallies during a wave; port the pre-physics dossier modal to the physics-td game with its own localStorage key and full dossier copy for all 10 placeable types; auto-open the dossier on a player's first palette click for an unseen type, and expose a DETAILS button in the info panel to re-open it on demand.

**Architecture:** Four new leaf files under `src/dashboard/physics-td/` (component-meta, dossier-store, show-dossier, component-info-panel). All DOM-level wiring. Info panel writes to existing `#td-info-panel-*` mirror divs in `physics-td.html`; the cyberpunk HUD's `buildInfoPanel` already mirrors those divs to the visible `.cp-info-panel` — we just need a writer. Live stats piggyback on the 4Hz throttle already in the frame loop.

**Tech Stack:** TypeScript strict mode, Vite, Vitest + JSDOM, existing Pixi `CyberpunkTopologyRenderer`. Pure-TypeScript in the dashboard layer; no new sim-side surgery.

---

## Worktree & branch

This work continues in the existing `physics-sim` worktree:

- **Path:** `/Users/normanettedgui/development/capstone/.worktrees/physics-sim`
- **Branch:** `physics-sim` (85 commits ahead of `origin/main` including spec commit `66bd7be`)
- **Do NOT create a new worktree.** All commands assume cwd is the worktree root above.

Single dev server port rule still applies: only one `pnpm dev` per session. Kill stale Vite first via `lsof -ti:5173 | xargs kill 2>/dev/null` if a previous session left it running.

## Reference documents

- `docs/superpowers/specs/2026-04-18-physics-td-info-panel-dossier-design.md` — full design spec (source of truth for all decisions in this plan)
- `docs/superpowers/specs/2026-04-17-physics-sim-roadmap-checkpoint.md` — three-tier roadmap; this plan ships Tier 2 items 7 + 8
- `docs/superpowers/plans/2026-04-18-plan-8-tier-1-quick-wins.md` — structural template this plan follows

## Existing code map (read these before starting any task)

| File | Why it matters |
|---|---|
| `src/dashboard/physics-td/physics-td.html` | Already has `#td-info-panel` + `#td-info-panel-close` mirror divs. Task 4 adds one more mirror button (`#td-info-panel-details`). |
| `src/dashboard/cyberpunk-hud.ts` | `buildInfoPanel` at line ~258 already observes the info-panel mirrors and renders the visible `.cp-info-panel`. Task 4 extends it to create a DETAILS button that forwards clicks to the new mirror. |
| `src/dashboard/cyberpunk-hud.css` | Already contains `.cp-dossier-modal`, `.cp-dossier-content`, `.cp-dossier-cta`, `.cp-dossier-rows`, etc. (verified via grep). Task 4 appends `.cp-info-details-btn`. |
| `src/dashboard/td/component-dossier.ts` | Pre-physics dossier module. Task 3 is a direct port with the `rentPerWave` → `cost` swap and the `td-dossiers-seen` → `physics-td-dossiers-seen` key change. Read the pre-physics file for the exact modal DOM shape — the CSS already expects those class names. |
| `src/dashboard/physics-td/component-factory.ts` | Defines `COMPONENT_COSTS` + `COMPONENT_FACTORY` — the canonical 10-type list. Task 1 (`component-meta.ts`) mirrors these keys; Task 5 reads `COMPONENT_COSTS.get(type)` for the dossier COST row. |
| `src/dashboard/physics-td/physics-td.ts` | Bootstrap — Task 5 integrates everything here. Key sites: `onPlaced` callback (line ~109, add to `componentTypes` map), palette click handler (line ~227, dossier-on-first-click), frame-loop event handling (line ~416, `perComponentProcessed` tally), 4Hz throttle branch (line ~440, `updateLiveStats` hook), `onPhaseChange` callback (line ~139, close panel on won/lost). |
| `src/sim/component.ts` | `SimComponent.bucket` is public; capacity read via `bucket.available()`. `capacityPerSecond` is also public on the component. |
| `src/sim/types.ts` line 71-73 | `SimStepEvent` union — drop, terminate, respond-delivered. All three carry `componentId`, so terminate/respond-delivered tallying works the same way as the existing drop tallying. |

## Always-apply rules from `CLAUDE.md`

- Never commit unless explicitly asked. New commits over amending. Never `--no-verify`, never force-push. (Each task below ends with a commit step; the plan's author already authorized those specifically.)
- Pure TypeScript in `src/sim/` (no React/Pixi imports). This plan does not touch `src/sim/`; all new code is in `src/dashboard/physics-td/` and modifies `src/dashboard/cyberpunk-hud.ts` + `.css`. Enforced by `tests/unit/sim/sim-pixi-isolation.test.ts`.
- Run `pnpm test` after each task to confirm no regressions; full suite is ~6s.
- Pre-existing typecheck noise: `tests/unit/pull-from-buffers.test.ts:81` is unrelated and stays.
- **No `innerHTML` in tests.** The repo has a security hook that blocks `element.innerHTML = …` assignments. Use `document.createElement` + `appendChild` (see the `mountMirrors` helper in Task 4 Step 1). Use `element.replaceChildren()` for cleanup instead of `innerHTML = ""`.

## Acceptance criteria for the whole plan

- All 5 tasks merged onto `physics-sim` branch.
- `pnpm test` passes (expect ~968 tests after this plan; +26 from current 942).
- `pnpm typecheck` clean (modulo the pre-existing `pull-from-buffers.test.ts:81` line).
- Manual playtest at `http://localhost:5173/physics-td/physics-td.html?renderer=iso`:
  1. Fresh `localStorage.clear()`. Click any palette button — dossier modal appears; CTA/Escape/× all dismiss; placement mode starts after dismiss. Second click on same type goes straight to placement.
  2. Click a placed component during build: info panel opens on the right showing display name (uppercase), description, capability bullets, empty stats block.
  3. Click DETAILS button: dossier re-opens for that type.
  4. Press READY → wave runs → click any placed component mid-wave: stats block shows three rows (Utilization / Dropped (wave) / Processed (wave)) updating at ~4Hz.
  5. Wave ends (won or lost modal): info panel closes automatically.
  6. Reload the page: `localStorage.getItem("physics-td-dossiers-seen")` contains the set of types you've seen; clicking those in palette goes straight to placement.
  7. Clicking the client: brief toast "client is the entry point"; info panel does not open.

---

## Task 1: Component metadata (`component-meta.ts`)

**Goal:** Single-source-of-truth data file listing all 10 placeable types with their display name, description, capability bullets, and dossier copy.

**Files:**
- Create: `src/dashboard/physics-td/component-meta.ts`
- Test: `tests/unit/dashboard/physics-td/component-meta.test.ts`

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/physics-td/component-meta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { COMPONENT_META } from "../../../../src/dashboard/physics-td/component-meta";
import { COMPONENT_COSTS } from "../../../../src/dashboard/physics-td/component-factory";

describe("COMPONENT_META catalog", () => {
  it("covers all 10 placeable types from COMPONENT_COSTS", () => {
    const metaKeys = Object.keys(COMPONENT_META).sort();
    const costKeys = [...COMPONENT_COSTS.keys()].sort();
    expect(metaKeys).toEqual(costKeys);
  });

  it("every entry has non-empty displayName, description, and at least one capability bullet", () => {
    for (const [type, meta] of Object.entries(COMPONENT_META)) {
      expect(meta.displayName, `${type}.displayName`).toBeTruthy();
      expect(meta.description, `${type}.description`).toBeTruthy();
      expect(meta.capabilitiesHuman.length, `${type}.capabilitiesHuman`).toBeGreaterThan(0);
      for (const bullet of meta.capabilitiesHuman) {
        expect(bullet, `${type} bullet`).toBeTruthy();
      }
    }
  });

  it("every entry has a non-empty dossier with body, wire, and handles", () => {
    for (const [type, meta] of Object.entries(COMPONENT_META)) {
      expect(meta.dossier.body, `${type}.dossier.body`).toBeTruthy();
      expect(meta.dossier.wire, `${type}.dossier.wire`).toBeTruthy();
      expect(meta.dossier.handles, `${type}.dossier.handles`).toBeTruthy();
    }
  });

  it("server / database / data_cache dossiers match the ported voice", () => {
    expect(COMPONENT_META.server!.dossier.body).toContain("workhorses");
    expect(COMPONENT_META.database!.dossier.body).toContain("store your data");
    expect(COMPONENT_META.data_cache!.dossier.body).toContain("Redis");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm test tests/unit/dashboard/physics-td/component-meta.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `component-meta.ts`**

Create `src/dashboard/physics-td/component-meta.ts`:

```typescript
export interface ComponentMeta {
  readonly displayName: string;
  readonly description: string;
  readonly capabilitiesHuman: readonly string[];
  readonly dossier: {
    readonly body: string;
    readonly wire: string;
    readonly handles: string;
    readonly tip?: string;
  };
}

export const COMPONENT_META: Readonly<Record<string, ComponentMeta>> = {
  server: {
    displayName: "Server",
    description: "Request router — takes reads and forwards them downstream, sends responses back.",
    capabilitiesHuman: [
      "Forwards reads to downstream components (Data Cache, Database)",
      "Forwards writes to a Database",
    ],
    dossier: {
      body: "Servers are the workhorses of your stack. They take a request from a user, do the work, and send a response back.",
      wire: "Client → Server → Database",
      handles: "Read requests (and writes, if forwarded to a Database)",
      tip: "You always need at least one. Without a Server in the read path, your users have nowhere to go.",
    },
  },
  database: {
    displayName: "Database",
    description: "Persistent store. Answers reads from storage and terminates writes with revenue.",
    capabilitiesHuman: [
      "Stores data persistently",
      "Serves reads from storage",
      "Terminates writes with revenue",
    ],
    dossier: {
      body: "Databases store your data. They accept writes from Servers and hold onto them for later reads. Databases don't answer user requests directly — they sit behind a Server.",
      wire: "Server → Database",
      handles: "Read and write requests forwarded from a Server",
      tip: "A Database alone can't serve users — it needs a Server in front of it to route traffic.",
    },
  },
  data_cache: {
    displayName: "Data Cache",
    description: "LRU read cache — absorbs repeated reads between Server and Database.",
    capabilitiesHuman: [
      "Caches hot reads in an LRU slot set (32 slots)",
      "Responds directly on cache hit",
      "Forwards misses downstream, populates on the return trip",
    ],
    dossier: {
      body: "Sits between your Server and Database to absorb repeated read queries — like Redis or Memcached in a real backend. Responds directly on a cache hit (skipping the Database) and forwards misses through.",
      wire: "Server → Data Cache → Database",
      handles: "Repeated read requests forwarded from a Server (best with hot keys; doesn't accelerate writes)",
      tip: "When your Database is the bottleneck and reads repeat, drop a Data Cache in front of it to absorb the duplicates.",
    },
  },
  load_balancer: {
    displayName: "Load Balancer",
    description: "Splits a request batch across N healthy egresses; waits for all responses before returning.",
    capabilitiesHuman: [
      "Splits incoming batches across all healthy downstream egresses",
      "Merges responses (wait-all) before returning",
    ],
    dossier: {
      body: "Distributes traffic across multiple downstream components. Each incoming batch is split N ways; the response waits on all children before merging upward.",
      wire: "Server → Load Balancer → [Server-A, Server-B]",
      handles: "Any traffic that needs to be spread across duplicate downstream components",
      tip: "Add a Load Balancer when one Server saturates and you want to spread the same role across multiple instances.",
    },
  },
  cdn: {
    displayName: "CDN",
    description: "Edge cache for large static assets — images, video, downloads. Caches large reads only.",
    capabilitiesHuman: [
      "Caches large assets in an LRU slot set (24 slots)",
      "Passes non-large requests through unchanged",
    ],
    dossier: {
      body: "A Content Delivery Network sits at the edge of your stack — the first component traffic hits. It caches heavy static assets like images and video, so they never touch your Server.",
      wire: "Client → CDN → Server",
      handles: "Large-asset reads (bypasses non-large requests unchanged)",
      tip: "Use a CDN when a wave is heavy on images or blobs. It absorbs the large stuff before it reaches the rest of your stack.",
    },
  },
  api_gateway: {
    displayName: "API Gateway",
    description: "Terminates authentication at the edge. Auth-tagged requests stop here; non-auth passes through.",
    capabilitiesHuman: [
      "Terminates auth-tagged requests at the edge",
      "Forwards non-auth requests unchanged",
    ],
    dossier: {
      body: "An API Gateway handles authentication before traffic reaches your Servers. Auth-tagged requests get verified and responded to here; everything else passes through unchanged.",
      wire: "Client → API Gateway → Server",
      handles: "Auth-required requests (terminates); other requests pass through",
      tip: "Place an API Gateway in front when a wave brings auth traffic — it stops those requests from burning Server capacity.",
    },
  },
  queue: {
    displayName: "Queue",
    description: "FIFO buffer that holds requests until a connected Worker pulls one.",
    capabilitiesHuman: [
      "Holds up to 64 requests in FIFO order",
      "Released to a Worker that pulls from it",
    ],
    dossier: {
      body: "A Queue is a buffer between fast-arriving requests and slow consumers. It holds requests in order until a connected Worker pulls one off. A Queue by itself processes nothing.",
      wire: "Server → Queue → Worker",
      handles: "Async or batch requests that don't need an immediate response",
      tip: "Pair a Queue with a Worker for async work. The Queue absorbs traffic spikes; the Worker drains at its own pace.",
    },
  },
  worker: {
    displayName: "Worker",
    description: "Pulls buffered requests from a connected Queue at its own rate.",
    capabilitiesHuman: [
      "Pulls buffered requests from a connected Queue (30/sec)",
      "Terminates each pulled request with revenue",
    ],
    dossier: {
      body: "A Worker consumes held requests from a Queue, one by one, at its own pace. It does nothing on its own — you must connect it downstream of a Queue.",
      wire: "Queue → Worker",
      handles: "Requests buffered in the connected Queue",
      tip: "A Worker is inert without a Queue in front of it. Wire them together to drain batch traffic.",
    },
  },
  streaming_server: {
    displayName: "Streaming Server",
    description: "Handles long-lived streams — reserves bandwidth for the stream's duration.",
    capabilitiesHuman: [
      "Handles stream requests with reserved bandwidth for the stream's duration",
    ],
    dossier: {
      body: "Streams — like video playback or live broadcasts — hold a connection open for seconds, not milliseconds. A Streaming Server reserves bandwidth on its ingress for each stream's duration.",
      wire: "Client → Streaming Server",
      handles: "Stream requests with a declared duration and bandwidth",
      tip: "Streams are expensive — each one ties up a bandwidth slot. Place a Streaming Server when a wave brings video traffic.",
    },
  },
  dns_gtm: {
    displayName: "DNS / GTM",
    description: "Global Traffic Manager — routes each request to its origin zone deterministically.",
    capabilitiesHuman: [
      "Routes each request to the egress matching its origin zone",
      "Deterministic per-request; no splitting",
    ],
    dossier: {
      body: "A Global Traffic Manager sits in front of a multi-zone stack and routes each request to the zone it came from. Used to keep latency low when your stack spans regions.",
      wire: "Client → DNS/GTM → [na-east Server, eu-west Server]",
      handles: "Zone-tagged requests — routed to the matching zone's egress",
      tip: "Place a DNS/GTM at the front of a multi-zone topology so each region's traffic lands on its own stack.",
    },
  },
};
```

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm test tests/unit/dashboard/physics-td/component-meta.test.ts
pnpm typecheck
```

Expected: PASS + typecheck clean modulo documented `pull-from-buffers.test.ts:81` noise.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/physics-td/component-meta.ts tests/unit/dashboard/physics-td/component-meta.test.ts
git commit -m "$(cat <<'EOF'
feat(physics-td): COMPONENT_META data file for all 10 types

Single source of truth for display name, description, capability
bullets, and dossier copy (body / wire / handles / tip). Ports the
voice of the pre-physics dossier for server / database / data_cache;
new entries in the same register for load_balancer / cdn / api_gateway
/ queue / worker / streaming_server / dns_gtm.
EOF
)"
```

---

## Task 2: Dossier store (`dossier-store.ts`)

**Goal:** localStorage-backed `Set<string>` tracking which types the player has seen. Fresh localStorage key (`physics-td-dossiers-seen`) so physics-td's tracking is isolated from any pre-physics state.

**Files:**
- Create: `src/dashboard/physics-td/dossier-store.ts`
- Test: `tests/unit/dashboard/physics-td/dossier-store.test.ts`

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/physics-td/dossier-store.test.ts`:

```typescript
import { describe, it, beforeEach, expect } from "vitest";
import { ComponentDossierStore } from "../../../../src/dashboard/physics-td/dossier-store";

const KEY = "physics-td-dossiers-seen";

describe("ComponentDossierStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("a fresh store reports everything as unseen", () => {
    const s = new ComponentDossierStore();
    expect(s.hasSeen("server")).toBe(false);
    expect(s.hasSeen("anything")).toBe(false);
  });

  it("markSeen persists across a fresh store instance (localStorage round-trip)", () => {
    const first = new ComponentDossierStore();
    first.markSeen("server");
    first.markSeen("cdn");

    const second = new ComponentDossierStore();
    expect(second.hasSeen("server")).toBe(true);
    expect(second.hasSeen("cdn")).toBe(true);
    expect(second.hasSeen("database")).toBe(false);
  });

  it("clear() empties memory and localStorage", () => {
    const s = new ComponentDossierStore();
    s.markSeen("server");
    s.clear();
    expect(s.hasSeen("server")).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("corrupt JSON in localStorage falls back to an empty set", () => {
    window.localStorage.setItem(KEY, "{not valid json");
    const s = new ComponentDossierStore();
    expect(s.hasSeen("server")).toBe(false);
    // markSeen rewrites the slot with a valid JSON array.
    s.markSeen("server");
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual(["server"]);
  });

  it("uses the physics-td-dossiers-seen key (isolated from pre-physics td-dossiers-seen)", () => {
    window.localStorage.setItem("td-dossiers-seen", JSON.stringify(["server"]));
    const s = new ComponentDossierStore();
    expect(s.hasSeen("server")).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm test tests/unit/dashboard/physics-td/dossier-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dossier-store.ts`**

Create `src/dashboard/physics-td/dossier-store.ts`:

```typescript
const STORAGE_KEY = "physics-td-dossiers-seen";

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
      // Corrupt JSON — start fresh; the next markSeen rewrites the slot.
    }
  }

  hasSeen(type: string): boolean {
    return this.seen.has(type);
  }

  markSeen(type: string): void {
    this.seen.add(type);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.seen)));
  }

  clear(): void {
    this.seen.clear();
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm test tests/unit/dashboard/physics-td/dossier-store.test.ts
pnpm typecheck
```

Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/physics-td/dossier-store.ts tests/unit/dashboard/physics-td/dossier-store.test.ts
git commit -m "$(cat <<'EOF'
feat(physics-td): ComponentDossierStore with localStorage backing

Port of pre-physics ComponentDossierStore, tracking the set of
dossier-type strings the player has seen under the localStorage key
'physics-td-dossiers-seen' (isolated from pre-physics 'td-dossiers-seen').
Corrupt-JSON recovery falls back to an empty set.
EOF
)"
```

---

## Task 3: Show-dossier modal renderer (`show-dossier.ts`)

**Goal:** Render the full-screen dossier modal from `COMPONENT_META[type].dossier`. Resolve the returned Promise when the CTA, × button, or Escape dismisses it. Port of pre-physics `showDossier` with the `rentPerWave` row swapped for `COST`.

**Files:**
- Create: `src/dashboard/physics-td/show-dossier.ts`
- Test: `tests/unit/dashboard/physics-td/show-dossier.test.ts`

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/physics-td/show-dossier.test.ts`:

```typescript
import { describe, it, beforeEach, expect } from "vitest";
import { showDossier } from "../../../../src/dashboard/physics-td/show-dossier";

describe("showDossier", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("appends a .cp-dossier-modal with the type's title and rows", async () => {
    const p = showDossier("server", 100);
    const modal = document.querySelector(".cp-dossier-modal");
    expect(modal).toBeTruthy();
    expect(modal!.querySelector(".cp-dossier-title")!.textContent).toBe("SERVER");
    const rowValues = [...modal!.querySelectorAll(".cp-dossier-row-val")].map(
      (el) => el.textContent,
    );
    expect(rowValues).toContain("Client → Server → Database"); // wire
    expect(rowValues).toContain("$100"); // cost (not rent)
    // Dismiss so the test's promise resolves and we don't leak listeners.
    modal!.querySelector<HTMLButtonElement>(".cp-dossier-cta")!.click();
    await p;
  });

  it("CTA click resolves the promise and removes the modal", async () => {
    const p = showDossier("database", 200);
    document.querySelector<HTMLButtonElement>(".cp-dossier-cta")!.click();
    await p;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("Escape key resolves the promise and removes the modal", async () => {
    const p = showDossier("cdn", 200);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("× button resolves the promise and removes the modal", async () => {
    const p = showDossier("data_cache", 150);
    document.querySelector<HTMLButtonElement>(".cp-dossier-close")!.click();
    await p;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("falls back to an uppercase type when meta is missing", async () => {
    const p = showDossier("unknown_type", 0);
    const title = document.querySelector(".cp-dossier-title")!.textContent;
    expect(title).toBe("UNKNOWN_TYPE");
    document.querySelector<HTMLButtonElement>(".cp-dossier-cta")!.click();
    await p;
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm test tests/unit/dashboard/physics-td/show-dossier.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `show-dossier.ts`**

Create `src/dashboard/physics-td/show-dossier.ts`:

```typescript
import { COMPONENT_META } from "./component-meta";

/**
 * Renders a full-overlay dossier modal for the given component type.
 * Returns a Promise that resolves once the user dismisses the modal
 * (CTA, × button, or Escape). Caller is responsible for calling
 * dossierStore.markSeen(type) after the promise resolves.
 */
export function showDossier(type: string, cost: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const meta = COMPONENT_META[type];
    const dossier = meta?.dossier;
    const titleText = meta?.displayName.toUpperCase() ?? type.toUpperCase();

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
    rows.appendChild(dossierRow("COST", `$${cost}`));
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

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm test tests/unit/dashboard/physics-td/show-dossier.test.ts
pnpm typecheck
```

Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/physics-td/show-dossier.ts tests/unit/dashboard/physics-td/show-dossier.test.ts
git commit -m "$(cat <<'EOF'
feat(physics-td): showDossier modal renderer

Reads from COMPONENT_META[type].dossier. Reuses the existing
.cp-dossier-* CSS. RENT row from pre-physics becomes COST (physics-td
has no upkeep yet). CTA / × button / Escape all dismiss + resolve
the returned Promise.
EOF
)"
```

---

## Task 4: Info panel module + HUD DETAILS button

**Goal:** Wire `bindInfoPanel(deps)` to own all click bindings and mirror-div writes for the info panel. Extend the HUD's visible `.cp-info-panel` with a DETAILS button that forwards clicks to a new `#td-info-panel-details` mirror button.

**Files:**
- Modify: `src/dashboard/physics-td/physics-td.html` (add one button inside `#td-info-panel`)
- Modify: `src/dashboard/cyberpunk-hud.ts` (extend `buildInfoPanel` to create a visible DETAILS button and forward its clicks)
- Modify: `src/dashboard/cyberpunk-hud.css` (append `.cp-info-details-btn` style)
- Create: `src/dashboard/physics-td/component-info-panel.ts`
- Test: `tests/unit/dashboard/physics-td/component-info-panel.test.ts`

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard/physics-td/component-info-panel.test.ts`:

```typescript
import { describe, it, beforeEach, expect, vi } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { bindInfoPanel } from "../../../../src/dashboard/physics-td/component-info-panel";
import { ComponentDossierStore } from "../../../../src/dashboard/physics-td/dossier-store";
import * as ShowDossier from "../../../../src/dashboard/physics-td/show-dossier";
import type { ComponentId } from "@core/types/ids";

// Build the mirror-div fixture programmatically — never use innerHTML.
function mountMirrors(): void {
  document.body.replaceChildren();
  const panel = document.createElement("div");
  panel.id = "td-info-panel";
  panel.hidden = true;

  const closeBtn = document.createElement("button");
  closeBtn.id = "td-info-panel-close";
  closeBtn.textContent = "×";
  panel.appendChild(closeBtn);

  const header = document.createElement("div");
  header.id = "td-info-panel-header";
  panel.appendChild(header);

  const desc = document.createElement("div");
  desc.id = "td-info-panel-description";
  panel.appendChild(desc);

  const caps = document.createElement("ul");
  caps.id = "td-info-panel-caps";
  panel.appendChild(caps);

  const stats = document.createElement("div");
  stats.id = "td-info-panel-stats";
  panel.appendChild(stats);

  const detailsBtn = document.createElement("button");
  detailsBtn.id = "td-info-panel-details";
  detailsBtn.textContent = "DETAILS";
  panel.appendChild(detailsBtn);

  document.body.appendChild(panel);
}

// Minimal fake renderer: records the onPointerDown handler so tests can invoke it.
function makeFakeRenderer() {
  const subscribers: Array<(ev: { hit: { componentId: ComponentId } | null }) => void> = [];
  return {
    subscribers,
    onPointerDown(cb: (ev: { hit: { componentId: ComponentId } | null }) => void): void {
      subscribers.push(cb);
    },
  };
}

describe("bindInfoPanel", () => {
  beforeEach(() => {
    mountMirrors();
    window.localStorage.clear();
  });

  function setup() {
    const sim = new Sim({ seed: 1 });
    const db = new SimComponent({
      id: "db1" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 1, revenuePerRead: 1 })],
      capacityPerSecond: 30,
    });
    const srv = new SimComponent({
      id: "s1" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    sim.addComponent(db);
    sim.addComponent(srv);
    const componentTypes = new Map<ComponentId, string>([
      ["db1" as ComponentId, "database"],
      ["s1" as ComponentId, "server"],
    ]);
    const dossierStore = new ComponentDossierStore();
    const perComponentDrops = new Map<ComponentId, { total: number; byReason: Map<string, number> }>();
    const perComponentProcessed = new Map<ComponentId, number>();
    const controller = { phase: "build" as "build" | "simulate" | "won" | "lost" };
    const renderer = makeFakeRenderer();
    const toasts: string[] = [];
    const hudCtrl = { showToast: (m: string) => toasts.push(m) };
    const handle = bindInfoPanel({
      renderer,
      sim,
      controller,
      dossierStore,
      hudCtrl,
      componentTypes,
      getDrops: () => perComponentDrops,
      getProcessed: () => perComponentProcessed,
    });
    return { handle, sim, controller, dossierStore, toasts, renderer, perComponentDrops, perComponentProcessed };
  }

  it("show(id) writes header / description / caps to the mirror divs and unsets hidden", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    expect(document.getElementById("td-info-panel-header")!.textContent).toBe("Database");
    expect(document.getElementById("td-info-panel-description")!.textContent).toContain("Persistent store");
    const bullets = [...document.querySelectorAll("#td-info-panel-caps li")].map((li) => li.textContent);
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets[0]).toContain("Stores data");
    expect(document.getElementById("td-info-panel")!.hidden).toBe(false);
    expect(document.getElementById("td-info-panel")!.dataset.componentType).toBe("database");
  });

  it("hide() sets hidden = true and clears dataset + stats", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    handle.hide();
    expect(document.getElementById("td-info-panel")!.hidden).toBe(true);
    expect(document.getElementById("td-info-panel")!.dataset.componentType).toBeUndefined();
    expect(document.getElementById("td-info-panel-stats")!.children.length).toBe(0);
  });

  it("updateLiveStats renders utilization / dropped / processed rows with real values during simulate", () => {
    const { handle, controller, perComponentDrops, perComponentProcessed, sim } = setup();
    handle.show("db1" as ComponentId);
    controller.phase = "simulate";
    // Simulate some drops + processed events for db1.
    perComponentDrops.set("db1" as ComponentId, {
      total: 7,
      byReason: new Map([["overloaded", 7]]),
    });
    perComponentProcessed.set("db1" as ComponentId, 23);
    // Drain bucket credits to simulate partial load.
    sim.components.get("db1" as ComponentId)!.bucket!.tryConsume(18);
    handle.updateLiveStats();
    const labels = [...document.querySelectorAll("#td-info-panel-stats .k")].map((el) => el.textContent);
    const values = [...document.querySelectorAll("#td-info-panel-stats .v")].map((el) => el.textContent);
    expect(labels).toContain("Utilization");
    expect(labels).toContain("Dropped (wave)");
    expect(labels).toContain("Processed (wave)");
    expect(values).toContain("7");
    expect(values).toContain("23");
    // Utilization = 100 * (1 - 12/30) = 60%.
    expect(values).toContain("60%");
  });

  it("updateLiveStats renders nothing during build phase", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    // phase stays "build"
    handle.updateLiveStats();
    expect(document.getElementById("td-info-panel-stats")!.children.length).toBe(0);
  });

  it("updateLiveStats renders 'unbounded' when component has no capacity bucket", () => {
    const { handle, controller } = setup();
    handle.show("s1" as ComponentId); // server has no capacityPerSecond
    controller.phase = "simulate";
    handle.updateLiveStats();
    const values = [...document.querySelectorAll("#td-info-panel-stats .v")].map((el) => el.textContent);
    expect(values).toContain("unbounded");
  });

  it("DETAILS button click invokes showDossier + markSeen for the open type", async () => {
    const spy = vi.spyOn(ShowDossier, "showDossier").mockResolvedValue();
    const { handle, dossierStore } = setup();
    handle.show("db1" as ComponentId);
    document.getElementById("td-info-panel-details")!.click();
    // Allow queued microtasks to flush so the awaited showDossier resolves and
    // the subsequent markSeen call runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith("database", expect.any(Number));
    expect(dossierStore.hasSeen("database")).toBe(true);
    spy.mockRestore();
  });

  it("close button click hides the panel", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    document.getElementById("td-info-panel-close")!.click();
    expect(handle.isOpen()).toBe(false);
    expect(document.getElementById("td-info-panel")!.hidden).toBe(true);
  });

  it("Escape key hides the panel when it's open", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(handle.isOpen()).toBe(false);
  });

  it("click on client id toasts and does not open", () => {
    const { renderer, toasts, handle } = setup();
    renderer.subscribers[0]!({ hit: { componentId: "client" as ComponentId } });
    expect(toasts[0]).toContain("entry point");
    expect(handle.isOpen()).toBe(false);
  });

  it("click on the same component toggles closed", () => {
    const { renderer, handle } = setup();
    renderer.subscribers[0]!({ hit: { componentId: "db1" as ComponentId } });
    expect(handle.isOpen()).toBe(true);
    renderer.subscribers[0]!({ hit: { componentId: "db1" as ComponentId } });
    expect(handle.isOpen()).toBe(false);
  });

  it("click on a different component swaps content", () => {
    const { renderer, handle } = setup();
    renderer.subscribers[0]!({ hit: { componentId: "db1" as ComponentId } });
    expect(handle.openId()).toBe("db1");
    renderer.subscribers[0]!({ hit: { componentId: "s1" as ComponentId } });
    expect(handle.openId()).toBe("s1");
    expect(document.getElementById("td-info-panel-header")!.textContent).toBe("Server");
  });

  it("click on empty canvas (null hit) closes", () => {
    const { renderer, handle } = setup();
    renderer.subscribers[0]!({ hit: { componentId: "db1" as ComponentId } });
    renderer.subscribers[0]!({ hit: null });
    expect(handle.isOpen()).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm test tests/unit/dashboard/physics-td/component-info-panel.test.ts
```

Expected: FAIL — `bindInfoPanel` import not found.

- [ ] **Step 3: Add the mirror button to `physics-td.html`**

Edit `src/dashboard/physics-td/physics-td.html`. Inside the `<div id="td-info-panel" hidden>` block, after the stats div, add:

```html
<button id="td-info-panel-details">DETAILS</button>
```

The block should end up as:

```html
<div id="td-info-panel" hidden>
  <button id="td-info-panel-close">×</button>
  <div id="td-info-panel-header"></div>
  <div id="td-info-panel-description"></div>
  <ul id="td-info-panel-caps"></ul>
  <div id="td-info-panel-stats"></div>
  <button id="td-info-panel-details">DETAILS</button>
</div>
```

- [ ] **Step 4: Extend `buildInfoPanel` in cyberpunk-hud.ts**

Edit `src/dashboard/cyberpunk-hud.ts`. In `buildInfoPanel` (~line 258), immediately after the `root.append(p);` line (~line 289) and before the mirror wiring (`forwardClick(close, "td-info-panel-close");`), insert:

```typescript
const details = document.createElement("button");
details.type = "button";
details.className = "cp-info-details-btn";
details.textContent = "DETAILS";
p.append(details);
forwardClick(details, "td-info-panel-details");
```

The final ordering inside `buildInfoPanel` should be: title → close × → header → desc → caps title → caps ul → stats title → stats → DETAILS button → root.append(p) → mirror wiring.

After the edit, the panel ends with a DETAILS button in the HUD overlay; its click forwards to the hidden mirror button added in Step 3.

- [ ] **Step 5: Add `.cp-info-details-btn` CSS**

Edit `src/dashboard/cyberpunk-hud.css`. Append:

```css
.cp-info-details-btn {
  display: block;
  margin: 12px 0 0;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid rgba(120, 220, 255, 0.45);
  color: #aee7ff;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
}
.cp-info-details-btn:hover {
  background: rgba(120, 220, 255, 0.12);
  border-color: rgba(170, 240, 255, 0.75);
  color: #eaf7ff;
}
.cp-info-details-btn:active {
  transform: translateY(1px);
}
```

- [ ] **Step 6: Implement `component-info-panel.ts`**

Create `src/dashboard/physics-td/component-info-panel.ts`:

```typescript
import type { Sim } from "@sim/sim";
import type { ComponentId } from "@core/types/ids";
import { COMPONENT_META } from "./component-meta";
import { COMPONENT_COSTS } from "./component-factory";
import { ComponentDossierStore } from "./dossier-store";
import { showDossier } from "./show-dossier";

export interface InfoPanelDeps {
  readonly renderer: {
    onPointerDown(cb: (ev: { hit: { componentId: ComponentId } | null }) => void): void;
  };
  readonly sim: Sim;
  readonly controller: { readonly phase: string };
  readonly dossierStore: ComponentDossierStore;
  readonly hudCtrl: { showToast(message: string): void };
  readonly componentTypes: Map<ComponentId, string>;
  readonly getDrops: () => Map<ComponentId, { total: number; byReason: Map<string, number> }>;
  readonly getProcessed: () => Map<ComponentId, number>;
}

export interface InfoPanelHandle {
  show(id: ComponentId): void;
  hide(): void;
  isOpen(): boolean;
  openId(): ComponentId | null;
  updateLiveStats(): void;
}

const CLIENT_ID = "client" as ComponentId;

export function bindInfoPanel(deps: InfoPanelDeps): InfoPanelHandle {
  let openId: ComponentId | null = null;

  const root = document.getElementById("td-info-panel");
  const header = document.getElementById("td-info-panel-header");
  const desc = document.getElementById("td-info-panel-description");
  const caps = document.getElementById("td-info-panel-caps") as HTMLUListElement | null;
  const stats = document.getElementById("td-info-panel-stats");
  const closeBtn = document.getElementById("td-info-panel-close");
  const detailsBtn = document.getElementById("td-info-panel-details");

  if (!root || !header || !desc || !caps || !stats || !closeBtn || !detailsBtn) {
    throw new Error("bindInfoPanel: missing one or more #td-info-panel mirror elements");
  }

  function clearChildren(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function show(id: ComponentId): void {
    const type = deps.componentTypes.get(id);
    if (!type) return;
    const meta = COMPONENT_META[type];
    if (!meta) return;
    openId = id;
    header!.textContent = meta.displayName;
    desc!.textContent = meta.description;
    clearChildren(caps!);
    for (const bullet of meta.capabilitiesHuman) {
      const li = document.createElement("li");
      li.textContent = bullet;
      caps!.appendChild(li);
    }
    clearChildren(stats!);
    root!.dataset["componentType"] = type;
    root!.hidden = false;
    updateLiveStats(); // paint stats immediately if already in simulate phase
  }

  function hide(): void {
    openId = null;
    clearChildren(stats!);
    delete root!.dataset["componentType"];
    root!.hidden = true;
  }

  function isOpen(): boolean {
    return openId !== null;
  }

  function statRow(label: string, value: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "td-info-panel__stat-row";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = value;
    row.append(k, v);
    return row;
  }

  function updateLiveStats(): void {
    if (!openId) return;
    const comp = deps.sim.components.get(openId);
    if (!comp) { hide(); return; }
    clearChildren(stats!);
    // Stats block is intentionally empty during build phase — nothing to show.
    if (deps.controller.phase !== "simulate") return;
    if (comp.bucket && comp.capacityPerSecond && comp.capacityPerSecond > 0) {
      const pct = Math.max(0, Math.min(100, Math.round(100 * (1 - comp.bucket.available() / comp.capacityPerSecond))));
      stats!.appendChild(statRow("Utilization", `${pct}%`));
    } else {
      stats!.appendChild(statRow("Utilization", "unbounded"));
    }
    const dropTally = deps.getDrops().get(openId)?.total ?? 0;
    stats!.appendChild(statRow("Dropped (wave)", String(dropTally)));
    const processed = deps.getProcessed().get(openId) ?? 0;
    stats!.appendChild(statRow("Processed (wave)", String(processed)));
  }

  // ─── Click handler (renderer) ───────────────────────────────────────
  deps.renderer.onPointerDown((ev) => {
    if (deps.controller.phase !== "build" && deps.controller.phase !== "simulate") return;
    if (!ev.hit) {
      if (isOpen()) hide();
      return;
    }
    if (ev.hit.componentId === CLIENT_ID) {
      deps.hudCtrl.showToast("client is the entry point");
      return;
    }
    if (isOpen() && openId === ev.hit.componentId) {
      hide();
    } else {
      show(ev.hit.componentId);
    }
  });

  // ─── Close button ────────────────────────────────────────────────────
  closeBtn!.addEventListener("click", () => { hide(); });

  // ─── DETAILS button ──────────────────────────────────────────────────
  detailsBtn!.addEventListener("click", async () => {
    if (!openId) return;
    const type = deps.componentTypes.get(openId);
    if (!type) return;
    const cost = COMPONENT_COSTS.get(type) ?? 0;
    await showDossier(type, cost);
    deps.dossierStore.markSeen(type);
  });

  // ─── Escape key (global, only when open) ─────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isOpen()) hide();
  });

  return { show, hide, isOpen, openId: () => openId, updateLiveStats };
}
```

- [ ] **Step 7: Run tests + typecheck**

```bash
pnpm test tests/unit/dashboard/physics-td/component-info-panel.test.ts
pnpm typecheck
```

Expected: PASS + clean. If the DETAILS-button test's `vi.spyOn(ShowDossier, "showDossier")` fails because of ESM module immutability, verify Vitest's config allows mocking of local ESM modules (existing tests in `tests/unit/dashboard/physics-td/` work in the same harness — this should be fine).

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/physics-td/component-info-panel.ts src/dashboard/physics-td/physics-td.html src/dashboard/cyberpunk-hud.ts src/dashboard/cyberpunk-hud.css tests/unit/dashboard/physics-td/component-info-panel.test.ts
git commit -m "$(cat <<'EOF'
feat(physics-td): component info panel module + HUD DETAILS button

bindInfoPanel owns all info-panel DOM writes + click bindings:
renderer click toggles/swaps/closes, × button hides, Escape hides,
DETAILS button opens the dossier for the current type and marks it
seen. updateLiveStats renders Utilization / Dropped (wave) /
Processed (wave) during simulate phase; empty during build.

HUD extended with a DETAILS button below the stats block that
forwards clicks to the new #td-info-panel-details mirror button.
.cp-info-details-btn pill style appended to cyberpunk-hud.css.
EOF
)"
```

---

## Task 5: Bootstrap integration in `physics-td.ts` + manual playtest

**Goal:** Wire the info panel into the physics-td bootstrap. Maintain `componentTypes: Map<ComponentId, string>`; construct `dossierStore`; call `bindInfoPanel`; gate palette clicks behind dossier-on-first-click; add `perComponentProcessed` tally; hook `updateLiveStats` at 4Hz during simulate; close panel on wave-end transitions.

No new unit tests (the integration is covered by the module tests plus the manual playtest). Full test suite + typecheck verify no regressions.

**Files:**
- Modify: `src/dashboard/physics-td/physics-td.ts` (multiple sites, all detailed below)

### Steps

- [ ] **Step 1: Add imports**

Edit `src/dashboard/physics-td/physics-td.ts`. Near the top with the other physics-td imports (around line 27-29), add:

```typescript
import { ComponentDossierStore } from "./dossier-store";
import { showDossier } from "./show-dossier";
import { bindInfoPanel, type InfoPanelHandle } from "./component-info-panel";
```

- [ ] **Step 2: Declare `componentTypes` and `perComponentProcessed` alongside `positions` + `perComponentDrops`**

Inside `main()`, right after the `let positions = new Map<ComponentId, { x: number; y: number }>();` declaration (line 61), add:

```typescript
const componentTypes = new Map<ComponentId, string>();
```

Inside the metrics block (after `let perComponentDrops = new Map…`, line 85), add:

```typescript
let perComponentProcessed: Map<ComponentId, number> = new Map();
```

- [ ] **Step 3: Populate `componentTypes` in placement/delete callbacks**

In the `PhysicsCampaignController` callbacks block (`physics-td.ts:105-168`), modify:

```typescript
onPlaced: (type, id, gridPos) => {
  positions.set(id, gridPos);
  componentTypes.set(id, type);
  refs.placement?.applyPlacement(type, id, gridPos);
},
onComponentDeleted: (id) => {
  // existing body unchanged up through positions.delete(id), then:
  componentTypes.delete(id);
},
```

Verify `onComponentDeleted` already deletes `positions`; add `componentTypes.delete(id)` as a sibling call.

- [ ] **Step 4: Construct the dossier store + bind the info panel**

Immediately after the `controller = new PhysicsCampaignController({…})` block (line ~169, just before the dev-select block starts at line 171), add:

```typescript
const dossierStore = new ComponentDossierStore();

const infoPanel: InfoPanelHandle = bindInfoPanel({
  renderer: { onPointerDown: (cb) => renderer.onPointerDown((ev) => cb({ hit: ev.hit })) },
  sim,
  controller,
  dossierStore,
  hudCtrl,
  componentTypes,
  getDrops: () => perComponentDrops,
  getProcessed: () => perComponentProcessed,
});
```

Note: `renderer.onPointerDown` callback in physics-td.ts uses `{ hit: compHit }` shape — the wrapping lambda normalizes the signature.

- [ ] **Step 5: Close the info panel on wave-end transitions**

In the `onPhaseChange` callback (line ~139), inside the `else if (phase === "won")` and `else if (phase === "lost")` and `else if (phase === "campaign-complete")` branches, add `infoPanel.hide()` as the first line of each branch. Example:

```typescript
} else if (phase === "won") {
  infoPanel.hide();
  hud.setStatus("Wave WON");
  hud.setReadyDisabled(true);
  showWinModal(waveIndex);
} else if (phase === "lost") {
  infoPanel.hide();
  hud.setReadyDisabled(true);
  // existing comment + SLA reasons handled elsewhere
} else if (phase === "campaign-complete") {
  infoPanel.hide();
  hud.setStatus("Campaign complete — well played!");
  hud.setReadyDisabled(true);
  showCampaignCompleteModal();
}
```

(Do not add `infoPanel.hide()` to `phase === "simulate"` — the panel intentionally persists through build → simulate so the player can watch a component through the wave.)

- [ ] **Step 6: Gate palette-button clicks behind the dossier on first-click**

Edit the existing clone-and-rebind block (`physics-td.ts:222-235`). Replace the inner `fresh.addEventListener("click", …)` body with:

```typescript
fresh.addEventListener("click", async (e) => {
  e.preventDefault();
  if (deleteMode) setDeleteMode(false);
  if (!dossierStore.hasSeen(type)) {
    const cost = COMPONENT_COSTS.get(type) ?? 0;
    await showDossier(type, cost);
    dossierStore.markSeen(type);
  }
  refs.placement?.enterPlacingMode(type);
});
```

- [ ] **Step 7: Tally `perComponentProcessed` in the frame loop**

Edit the event-handling block inside the frame loop (`physics-td.ts:416-435`). In both the `terminate` and `respond-delivered` branches, add per-component increment. The updated block:

```typescript
for (const ev of sim.lastStepEvents) {
  if (ev.kind === "drop") {
    metrics.drops += ev.count;
    const compId = ev.componentId as ComponentId;
    let tally = perComponentDrops.get(compId);
    if (!tally) { tally = { total: 0, byReason: new Map() }; perComponentDrops.set(compId, tally); }
    tally.total += ev.count;
    tally.byReason.set(ev.reason, (tally.byReason.get(ev.reason) ?? 0) + ev.count);
  } else if (ev.kind === "terminate") {
    metrics.terminated += 1;
    metrics.revenue += ev.revenue;
    metrics.latencySum += ev.latencySeconds;
    metrics.latencyCount += 1;
    const compId = ev.componentId as ComponentId;
    perComponentProcessed.set(compId, (perComponentProcessed.get(compId) ?? 0) + 1);
  } else if (ev.kind === "respond-delivered") {
    metrics.responded += 1;
    metrics.revenue += ev.revenue;
    metrics.latencySum += ev.latencySeconds;
    metrics.latencyCount += 1;
    const compId = ev.componentId as ComponentId;
    perComponentProcessed.set(compId, (perComponentProcessed.get(compId) ?? 0) + 1);
  }
}
```

- [ ] **Step 8: Reset `perComponentProcessed` in the READY handler**

Inside the `document.getElementById("td-ready-btn")!.addEventListener("click", …)` handler (`physics-td.ts:377-388`), where `perComponentDrops = new Map();` is assigned, also add:

```typescript
perComponentProcessed = new Map();
```

- [ ] **Step 9: Hook `infoPanel.updateLiveStats()` into the 4Hz throttle**

Inside the 4Hz-throttle branch (`physics-td.ts:440-450`), after `lastProgressUpdate = now;`, add:

```typescript
if (infoPanel.isOpen() && controller.phase === "simulate") {
  infoPanel.updateLiveStats();
}
```

- [ ] **Step 10: Clear `componentTypes` + `perComponentProcessed` in `clearWaveWorld()`**

Edit the `clearWaveWorld()` function (`physics-td.ts:636-665`). Inside the body, alongside `positions.clear()` and `sim.activePackets.length = 0`, add:

```typescript
componentTypes.clear();
perComponentProcessed = new Map();
```

- [ ] **Step 11: Run full suite + typecheck**

```bash
pnpm test
pnpm typecheck
```

Expected: all green. ~26 new tests were added in earlier tasks; total should be ~968. No new tests in this task — existing tests verify no regressions.

- [ ] **Step 12: Manual playtest**

```bash
lsof -ti:5173 | xargs kill 2>/dev/null
pnpm dev
```

Open `http://localhost:5173/physics-td/physics-td.html?renderer=iso`. With `localStorage.clear()` executed in devtools first, verify every bullet in the acceptance criteria at the top of this plan. Specifically:

1. Fresh localStorage → click **Server** palette → dossier modal opens; click CTA → placement mode starts.
2. Place Server on the grid → click it → info panel opens on the right with "Server" header, description, capability bullets; stats block empty.
3. Click DETAILS → dossier re-opens for Server.
4. Connect Client → Server; place a Database; connect Server → Database; connect both into a working topology for Wave 1.
5. Press READY → wave runs → click Database → stats block updates every ~250ms: Utilization increments as bucket fills/drains, Dropped stays 0 on Wave 1, Processed counts up.
6. Win screen appears → info panel closes automatically.
7. Reload page → click Server again → no dossier (marked seen); placement starts immediately.
8. Click **Load Balancer** palette (unseen) → dossier for Load Balancer opens.
9. Click the client → toast "client is the entry point", info panel does not open.

If anything fails: diagnose with browser devtools, fix in physics-td.ts (no other file should need changes at this point), re-test.

- [ ] **Step 13: Commit**

```bash
git add src/dashboard/physics-td/physics-td.ts
git commit -m "$(cat <<'EOF'
feat(physics-td): wire info panel + dossier into bootstrap

Maintains componentTypes Map alongside positions. Constructs
ComponentDossierStore + bindInfoPanel after campaign controller.
Palette click awaits showDossier on first-click for unseen types,
then markSeen + enter placing mode. Frame loop tallies
perComponentProcessed per terminate + respond-delivered event;
4Hz throttle branch calls infoPanel.updateLiveStats when the panel
is open during simulate. Phase transitions to won/lost/
campaign-complete hide the panel; build → simulate keeps it open.
clearWaveWorld clears componentTypes + perComponentProcessed.
EOF
)"
```

---

## Self-review checklist

After implementing all 5 tasks, run this end-to-end audit:

- [ ] `pnpm test` — full suite green (~968 tests; +26 from baseline 942).
- [ ] `pnpm typecheck` — only documented `pull-from-buffers.test.ts:81` noise remains.
- [ ] Manual playtest as in Task 5 Step 12 — every acceptance-criterion bullet checks out.
- [ ] `localStorage.getItem("physics-td-dossiers-seen")` after seeing all 10 types returns a JSON array with 10 entries.
- [ ] `localStorage.getItem("td-dossiers-seen")` is untouched (or whatever was there pre-plan, including null).

## Out of plan (Tier 2/3 candidates flagged for later)

- NEW badges on palette per-wave unlock allowlist — Plan 10 (reuses `dossierStore.hasSeen()`).
- Per-component health / condition ring — Tier 3 (requires condition system in physics sim).
- Upkeep / NEXT BILL plumbing — Tier 3 (requires per-wave rent semantics in physics sim).
- Per-zone visualization — bundled with Wave 9 port.
- Tier / instance-count indicator — Tier 3 (requires auto-scale).
- Info panel during `lost` phase — intentionally closed; player looks at diagnose-wave modal.
