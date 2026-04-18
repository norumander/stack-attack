# Physics-TD — Component Info Panel + Dossier Modal — Design

**Status:** Drafted 2026-04-18 through brainstorming session. Awaiting approval → implementation planning (Plan 9).

## Problem statement

The physics-td game (`/physics-td/physics-td.html`) is the post-refactor tower defense experience. Tier 1 quick wins shipped (Plan 8) — 10-type palette, Waves 1–5, topology + budget carryover, dev wave-jump, diagnose-wave loss copy. But the player still can't learn *why* their topology is succeeding or failing:

- **Clicking a placed component does nothing.** The cyberpunk HUD has a `.cp-info-panel` visible panel already built — it observes mirror divs under `#td-info-panel` — but nobody writes to those mirrors, so the panel never appears.
- **No "what does this component do?" onboarding.** The pre-physics campaign had `showDossier(type)` — a full-screen modal with a title, sprite, body, WIRE example, HANDLES explainer, and a strategic TIP — that auto-opened the first time a player clicked a palette button for an unseen type. Physics-td has no equivalent.
- **Live component stats are invisible.** Under saturation, the player sees drop flashes but has no way to answer "which component dropped these?" without replaying and inferring.

Tier 2 items 7 + 8 from `docs/superpowers/specs/2026-04-17-physics-sim-roadmap-checkpoint.md` cover both surfaces. This spec designs the port.

## Goal

1. Clicking a placed component during any phase opens an info panel with: display name, description, capability bullets, and (during simulate) live utilization / drop / processed counts for that component.
2. First click on a palette type the player hasn't seen yet opens the dossier modal; player dismisses, placement proceeds, "seen" persists in localStorage so the dossier doesn't nag on replay.
3. The info panel carries a DETAILS button that re-opens the dossier on demand.

## Decisions summary

| Decision | Choice |
|---|---|
| Live stats during simulate | YES — utilization %, drops (this wave), processed (this wave) at 4Hz |
| Live stats during build | NO — static rows only; stats block hidden |
| Dossier trigger | Auto on palette-first-click for unseen types + manual DETAILS button in info panel |
| Seen-tracking storage | localStorage, key `physics-td-dossiers-seen` (fresh — not shared with pre-physics `td-dossiers-seen`) |
| Dossier RENT row | Replaced with COST row (physics-td has no upkeep/rent) |
| Metadata source | New file `component-meta.ts` — single source of truth for all 10 types |
| NEW badges (item #9) | DEFERRED to Plan 10 — reuses the dossier store built here |
| Component health ring | OUT OF SCOPE — Tier 3 (no condition system in physics sim) |
| Upkeep / NEXT BILL | OUT OF SCOPE — Tier 3 |
| Per-zone viz | OUT OF SCOPE — bundled with Wave 9 port |

## File layout

All new files under `src/dashboard/physics-td/`. Pure TypeScript, no sim-internal imports beyond `Sim` and `ComponentId`.

| File | Exports | Purpose |
|---|---|---|
| `component-meta.ts` | `ComponentMeta` type, `COMPONENT_META: Record<string, ComponentMeta>` | Single source of truth. One entry per placeable type (10 total): `displayName`, `description`, `capabilitiesHuman[]`, `dossier: { body, wire, handles, tip? }`. Pure data. |
| `dossier-store.ts` | `class ComponentDossierStore` with `hasSeen(type)`, `markSeen(type)`, `clear()` | LocalStorage-backed `Set<string>` under key `physics-td-dossiers-seen`. Port of pre-physics pattern; corrupt-JSON recovery preserved. |
| `show-dossier.ts` | `showDossier(type, cost): Promise<void>` | Modal renderer. Reads `COMPONENT_META[type].dossier`. Renders the `.cp-dossier-modal` overlay (CSS already in `cyberpunk-hud.css`). Rows: WIRE, HANDLES, COST (swapped from pre-physics RENT), TIP. CTA, × button, and Escape all dismiss. Resolves on dismiss. |
| `component-info-panel.ts` | `bindInfoPanel(deps): InfoPanelHandle` returning `{ show(id), hide(), isOpen(), openId(), updateLiveStats(sim, drops, processed), dispose() }` | Wires the renderer click handler (additive to the existing delete-mode handler), writes to the mirror divs in `physics-td.html`, owns the DETAILS button wire-up. |

**Modified files:**

| File | Change |
|---|---|
| `src/dashboard/physics-td/physics-td.html` | Add one mirror button: `<button id="td-info-panel-details" hidden>DETAILS</button>` inside `#td-info-panel`. HUD's visible DETAILS button forwards clicks to this (same pattern as `td-ready-btn`). |
| `src/dashboard/cyberpunk-hud.ts` | Extend `buildInfoPanel` to append a visible `.cp-info-details-btn` below stats. `forwardClick(detailsBtn, "td-info-panel-details")`. Observer hides the button when `#td-info-panel-details` has `hidden` attribute. |
| `src/dashboard/physics-td/physics-td.ts` | (a) Construct `dossierStore` after controller creation. (b) Maintain a `componentTypes: Map<ComponentId, string>` — populated in `onPlaced`, deleted in `onComponentDeleted`, `.clear()`'d in `clearWaveWorld()`. (c) Call `bindInfoPanel({ renderer, sim, controller, dossierStore, hudCtrl, componentTypes, getDrops, getProcessed })` to wire the click handler. (d) Modify the palette click handler block (~line 227) to await `showDossier` on unseen types before entering placing mode. (e) Add `perComponentProcessed: Map<ComponentId, number>` tally alongside `perComponentDrops` in the frame loop (increment on `terminate` + `respond-delivered` events). (f) In the 4Hz throttle branch, call `infoPanel.updateLiveStats(...)` if panel open and phase is simulate. (g) On phase transitions to `won`/`lost`/`campaign-complete`, close the panel. |
| `src/dashboard/cyberpunk-hud.css` | `.cp-info-details-btn` styling. `.cp-dossier-modal` styles exist — re-use as-is. |

## Component metadata — full contents

All 10 types. Ported entries (server, database, data_cache) match pre-physics voice verbatim; new entries (load_balancer, cdn, api_gateway, queue, worker, streaming_server, dns_gtm) use the same register.

```ts
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

## Click / event flow

### Opening the info panel

`bindInfoPanel` augments (not replaces) the existing `renderer.onPointerDown(ev)` subscriber. Open conditions:

- `controller.phase` is `build` or `simulate`
- not in `deleteMode`
- `refs.placement?.isPlacing()` false
- `refs.connect?.isConnecting()` false (introspect via existing `cancel()` gate)
- `ev.hit?.componentId` exists
- `ev.hit.componentId !== CLIENT_ID` (client has no dossier; toast "client is the entry point")

Toggle semantics, checked in the handler before calling into the panel:

```ts
if (panel.isOpen() && panel.openId() === ev.hit.componentId) {
  panel.hide();
} else {
  panel.show(ev.hit.componentId);
}
```

- Click different component while panel open → `show(newId)` (swaps content; no intermediate hide)
- Click empty canvas (`ev.hit === null`) → `hide()`
- Escape key (global listener bound once in `bindInfoPanel`, only acts when `isOpen()`) → `hide()`
- Close button — cyberpunk-hud's × forwards clicks to `#td-info-panel-close`; `bindInfoPanel` binds a click listener on that mirror button that calls `hide()`

### Writing to mirror divs

`show(id)` reads `sim.components.get(id)` to learn the type (by looking up the component's factory-constructed shape via a parallel `Map<ComponentId, string>` tracked in physics-td.ts — the placement callback already has the type; extend it to record `componentTypes: Map<ComponentId, string>`). Then:

1. `#td-info-panel-header.textContent = meta.displayName`
2. `#td-info-panel-description.textContent = meta.description`
3. `#td-info-panel-caps` — replace children with one `<li>` per bullet
4. `#td-info-panel-stats` — write three rows (utilization / dropped / processed); during build phase, leave empty
5. `#td-info-panel.hidden = false` (cyberpunk-hud's `mirrorAttribute` observer shows the visible panel; DETAILS button visibility rides the CSS cascade from `.cp-info-panel.cp-hidden`)
6. Also stash `dataset["componentType"] = type` on `#td-info-panel` so the dossier-from-info-panel path can read it

`hide()` clears stats, sets `#td-info-panel.hidden = true`, clears `dataset`.

### DETAILS button → dossier

The `#td-info-panel-details` mirror button has a click handler bound in `bindInfoPanel`:

```ts
detailsBtn.addEventListener("click", async () => {
  const id = state.openId;
  if (!id) return;
  const type = componentTypes.get(id);
  if (!type) return;
  const cost = COMPONENT_COSTS.get(type) ?? 0;
  await showDossier(type, cost);
  dossierStore.markSeen(type);
});
```

The HUD's visible DETAILS button (built by `buildInfoPanel` in cyberpunk-hud.ts) forwards clicks to this mirror.

### Palette → dossier-on-first-click

Modify the existing clone-and-rebind block in `physics-td.ts`:

```ts
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

First click on an unseen type: modal appears, player reads/dismisses, placement mode starts. Subsequent clicks go straight to placement.

### Phase transitions

The panel stays open through `build → simulate` — that's the whole point of live stats, the player can click during build and keep watching the component they care about through the wave.

Close the panel only on transitions to `won`, `lost`, or `campaign-complete`. At that point the wave-end modal takes focus, and the "this wave" tallies are finalized and no longer updating — letting the panel persist across modals just clutters the screen.

## Live stats (simulate phase, 4Hz)

The frame loop already throttles progress-bar updates to 4Hz (`if (now - lastProgressUpdate > 250)`). Piggyback on this throttle.

### Tally plumbing

Frame loop adds a `perComponentProcessed: Map<ComponentId, number>` alongside the existing `perComponentDrops`. In the event-handling block:

```ts
} else if (ev.kind === "terminate" || ev.kind === "respond-delivered") {
  // existing metrics increment …
  const compId = ev.componentId as ComponentId;
  perComponentProcessed.set(compId, (perComponentProcessed.get(compId) ?? 0) + 1);
}
```

Reset `perComponentProcessed = new Map()` alongside the existing `perComponentDrops = new Map()` in the READY handler.

### Computed rows

`updateLiveStats(sim, perComponentDrops, perComponentProcessed)` reads the open component and renders three `<div>` rows into `#td-info-panel-stats`:

| Row | Value |
|---|---|
| Utilization | `comp.capacityPerSecond > 0 ? Math.round(100 * (1 - comp.capacityBucket.credits / comp.capacityPerSecond)) + "%" : "unbounded"` |
| Dropped (this wave) | `perComponentDrops.get(id)?.total ?? 0` |
| Processed (this wave) | `perComponentProcessed.get(id) ?? 0` |

Build phase: stats block empty. Between waves (phase `won` pending `nextWave()`): panel is already closed.

### Guard against stale reads

If `sim.components.get(id)` returns undefined (component deleted between panel-open and next 4Hz tick), call `hide()`.

## Testing

| File | Coverage |
|---|---|
| `tests/unit/dashboard/physics-td/component-meta.test.ts` | All 10 types have a full entry: non-empty `displayName`, `description`, at least one `capabilitiesHuman` bullet, non-empty `dossier.body`, `dossier.wire`, `dossier.handles`. COMPONENT_META type union matches COMPONENT_COSTS keys. |
| `tests/unit/dashboard/physics-td/dossier-store.test.ts` | New store returns `hasSeen(anything) === false`. `markSeen("server")` persists across a fresh store instance (same localStorage). `clear()` resets. Corrupt JSON in storage falls back to empty set. |
| `tests/unit/dashboard/physics-td/show-dossier.test.ts` | Calling `showDossier("server", 100)` appends `.cp-dossier-modal` to document.body, populates WIRE/HANDLES/COST/TIP rows. Clicking CTA removes modal + resolves promise. Escape removes + resolves. Re-entrant calls stack cleanly. |
| `tests/unit/dashboard/physics-td/component-info-panel.test.ts` | `show(id)` writes meta rows; `updateLiveStats` writes three rows with expected values from a fake sim + tallies; `hide()` clears `#td-info-panel-details.hidden = true`; DETAILS click invokes `showDossier` then `markSeen` on the open type; click on CLIENT_ID toasts and does not open. |

Tests use JSDOM (Vitest default) for DOM assertions; `window.localStorage` is the JSDOM implementation. No integration test — the click flow is verified manually at `?wave=3` per the acceptance criteria below.

## Acceptance criteria

- All new tests pass. Full suite: ~955 tests (from 942, +~13 new).
- `pnpm typecheck` clean (modulo documented `pull-from-buffers.test.ts:81`).
- Manual playtest at `http://localhost:5173/physics-td/physics-td.html?renderer=iso`:
  - Fresh localStorage: click any palette button — dossier opens; dismiss; placement mode starts.
  - Click a placed component during build: info panel opens with displayName / description / caps bullets; stats block empty.
  - DETAILS button in info panel: re-opens the dossier for that type.
  - READY → simulate → click a placed component mid-wave: info panel shows live utilization %, drops-this-wave, processed-this-wave; values update at ~4Hz.
  - Phase transitions (build→simulate, wave-end): panel closes automatically.
  - localStorage `physics-td-dossiers-seen` persists the seen set across page reloads.
  - Clicking the client: toast "client is the entry point" (or similar); panel does not open.

## Out of scope / deferred

| Item | Reason |
|---|---|
| NEW badges on palette (Tier 2 #9) | Plan 10 — reuses `dossierStore.hasSeen()` built here |
| Component health / condition ring | Tier 3 — no condition system in physics sim |
| Upkeep / NEXT BILL plumbing | Tier 3 — no per-wave rent in physics sim |
| Per-zone visualization | Bundled with Wave 9 port |
| Tier / instance-count indicator | No auto-scale in physics sim (Tier 3) |
| Info panel during `lost` phase | Panel closes on transition — player is looking at the diagnose-wave modal anyway |

## Implementation notes

- 4Hz hook site is the existing `if (now - lastProgressUpdate > 250)` branch in the frame loop. Append `if (infoPanel.isOpen() && controller.phase === "simulate") infoPanel.updateLiveStats(sim, perComponentDrops, perComponentProcessed)` alongside the progress-bar status update.
- DETAILS button styling follows `.cp-palette-btn` tone (small pill button). Single utility class (`.cp-info-details-btn`) in `cyberpunk-hud.css`.
- Client click stays silent with a toast ("client is the entry point"). Playtest may reveal we want a minimal client-only panel; if so, follow-up.
- `componentTypes: Map<ComponentId, string>` is maintained in `physics-td.ts` alongside `positions`. Populated in `onPlaced` callback (`type, id` already in scope); cleared in `onComponentDeleted`; cleared wholesale in `clearWaveWorld()`.
