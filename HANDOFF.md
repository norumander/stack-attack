# Stack Attack — Session Handoff

**To the next Claude (CLI):** Read this fully before acting. Project is at `C:/Users/rjxxl/projects/g4-capstone`. Root context lives in `CLAUDE.md`; deeper context under `docs/claude/`.

---

## The immediate task

**Generate dedicated isometric sprites for 8 components that currently use fallback sprites.** Pixel Lab MCP is configured but was failing to load in Claude Desktop. User is moving to Claude CLI to unblock.

### Missing sprites

The only components with real texture files today are: `client`, `server`, `database`, `data_cache`, `load_balancer`, `cdn`, `api_gateway` (see `SPRITE_URLS` in `src/render/cyberpunk/component-layer.ts`). Everything else falls back via `FALLBACK_BY_TYPE` which I extended last session:

| Component | Current fallback | Needs own sprite |
|---|---|---|
| `queue` | database | ✅ |
| `worker` | server | ✅ |
| `edge_cache` | data_cache | ✅ |
| `dns_gtm` | load_balancer | ✅ |
| `circuit_breaker` | api_gateway | ✅ |
| `streaming_server` | (already had fallback) | ✅ |
| `blob_storage` | (already had fallback) | ✅ |

### Style anchor

Look at the existing PNGs referenced by `SPRITE_URLS` (they live under `src/assets/stack-attack/components/` or similar — verify path). They're **isometric cyberpunk** — ~80–100px tiles, glowing cyan/amber accents, crisp pixel edges. Use 2–3 as style references for all Pixel Lab generations.

### Pixel Lab setup

MCP config has been added in two places:
- `.mcp.json` at project root (gitignored — key does NOT leak)
- `%APPDATA%\Claude\claude_desktop_config.json` (user-scope)

API key: `3b469505-a138-4872-b022-03817fb3e08c`

If the MCP isn't auto-loading in CLI, run:
```bash
claude mcp add --transport http pixellab https://api.pixellab.ai/mcp \
  --header "Authorization: Bearer 3b469505-a138-4872-b022-03817fb3e08c"
```

The MCP exposes `create_isometric_tile(description, size)` which is the right tool.

### Recommended approach

1. Confirm MCP tools are visible (ToolSearch for `pixellab` — should return `create_isometric_tile`, `create_character`, etc.)
2. Generate **one sprite first** (suggest `queue` — "cyberpunk isometric message queue tile, stacked glowing pipes with data packets queued, cyan accents matching [anchor images]") — show to user
3. If style matches → batch the remaining 7
4. Drop PNGs into the correct assets directory (verify path from existing sprite URLs)
5. Add entries to `SPRITE_URLS` in `src/render/cyberpunk/component-layer.ts`
6. Remove the corresponding entries from `FALLBACK_BY_TYPE`
7. `pnpm typecheck && pnpm test --run && pnpm exec vite build` — should all be green
8. Commit + push

---

## Context — what shipped this session (relevant to above)

### Auth fixes (dev bypass)
- `src/auth/supabase-client.ts` — stubs out Supabase when env vars are missing so module import doesn't crash. Exports `isAuthConfigured: boolean`.
- `src/auth-gate.ts` — `resolveInitialSession()` now has 3s timeout.
- All 4 boot scripts (`landing-boot.ts`, `levels-boot.ts`, `diagnose-boot.ts`, `physics-td/physics-td.ts`) skip auth gate when `!isAuthConfigured`.

### Diagnose runtime wired
- `src/diagnose-boot.ts` now fully mirrors `src/physics-td/physics-td.ts`:
  - Mounts renderer + sim
  - Pre-places starting topology via `PhysicsDiagnoseController.preplace(positionFor)` with a tier-based column layout
  - Wires `PlacementUX`, `ConnectUX`, component palette, chatbot drawer
  - READY button starts the wave with auto-client-wire + `wireWorkers` + BrowserDriver + chaos firing + SLA evaluation
- Layout tuned: `COL_SPACING=2.5`, `ROW_SPACING=3`, `MID_COL=3.5`, client at `x=-10`.
- Renderer board expanded 25% (24→30 tiles per side in `src/render/cyberpunk/tokens.ts`).

### Other recent changes (since last commit to origin)
Two files were modified locally and may be uncommitted — verify with `git status`:
- `src/physics-td/component-factory.ts` — `edge_cache` added to `CLIENT_FACING_COMPONENT_TYPES`, `buildSimComponent` signature accepts `zone?` and `label?`.
- `tests/playtest/wave-6-candidates.test.ts` — restructured to include `with-edge-cache` variant; `describe.skip` (research-only).

### Sprite fallback map
`src/render/cyberpunk/component-layer.ts` — `FALLBACK_BY_TYPE` maps queue→database, worker→server, edge_cache→data_cache, dns_gtm→load_balancer, circuit_breaker→api_gateway, plus streaming_server and blob_storage. Once dedicated sprites land, **remove the relevant rows**.

---

## Project state

- **Tests:** 833 passing, 7 skipped, typecheck clean at last check
- **Branch:** main, tracked to `origin/main`
- **Origin:** https://github.com/norumander/stack-attack
- **Key docs to read first:** `CLAUDE.md`, `docs/claude/implementation-status.md`, `docs/claude/development.md`

### Hotpaths to know
- Campaign build mode: `src/physics-td/physics-td.ts` → waves in `src/physics-td/waves.ts` (CAMPAIGN_WAVES, 8 Netflix waves)
- URL Shortener campaign: waves in `src/physics-td/bitly-waves.ts` (4 waves); boot branches on `?level=url-shortener`
- Diagnose mode: `src/diagnose-boot.ts` + `src/diagnose/diagnose-level.ts` (DIAGNOSE_LEVELS = Instagram 5 + Netflix 5)
- Rendering: `src/render/cyberpunk/` (component-layer.ts, tokens.ts, iso-projection.ts)

### Always-apply project rules (from CLAUDE.md)
- Use git worktrees for code changes (`.worktrees/<branch>`)
- Only one `pnpm dev` at a time
- Never commit unless explicitly asked; never --no-verify; never force-push to main
- No React/Next/Vercel imports in `src/core/` or `src/capabilities/` (enforced by a test)

---

## Open polish items (not blocking sprite work)

- Login avatar thumbnails: fixed in last session (`src/auth/avatar.ts` uses `import.meta.url`) — verify they actually render on the deployed app
- Diagnose L1 layout still feels slightly crowded in the middle tiers (server/queue/worker area). Possibly iterate ROW_SPACING further to 3.5.
- W5 intended ranks 3rd due to CB-in-front-of-LB being architecturally inert — this is a design decision parked; if you pick it up, see the earlier discussion about per-backend CB placement.

## Deferred

- Playtest harness `tests/playtest/*.test.ts` files are research-only, not CI contracts
- Known typecheck-clean baseline — don't reintroduce the two pre-existing errors we fixed (they were `pull-from-buffers.test.ts:81` and `sim-to-renderer-adapter.test.ts:8`)
