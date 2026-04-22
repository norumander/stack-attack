# Sandbox Mode — Design Spec

**Date:** 2026-04-22
**Status:** Approved

## Overview

A free-build mode where players construct any architecture on a blank board, control traffic mixture and chaos events in real time, and observe the system to find faults and bottlenecks. No budget, no SLA, no viability — pure experimentation. Architectures can be exported as JSON and imported to share or reload.

## Entry Point

- Landing page (`index.html`) gets a second CTA button "SANDBOX" next to "INSERT COIN"
- Links to `/sandbox.html`
- No level select intermediary — direct access for demos and experimentation

## Page & Boot

**`sandbox.html`** — minimal page shell following the same pattern as `game.html` and `diagnose.html`: `<div id="canvas-host">`, hidden mirror divs for HUD sync, single `<script type="module" src="./sandbox-boot.ts">`.

**`sandbox-boot.ts`** — entry script responsibilities:
- Mount `CyberpunkTopologyRenderer` + `activateCyberpunkHud()`
- Create `Sim`, `PlacementUX`, `ConnectUX` (reusing existing classes)
- Auto-place client at the left of the board
- Mount traffic control panel in the right column (replacing briefing)
- Mount import/export buttons
- Wire speed control, info panel, connection toggle, component drag
- No controller class — sandbox-boot manages state directly
- No budget constraint — all components always placeable
- No viability pool, no SLA targets, no wave progression

**`vite.config.ts`** — add `sandbox: resolve(srcDir, "sandbox.html")` to build inputs.

## Traffic Control Panel

Replaces the briefing/viability panel in the right column. Built as `src/sandbox/traffic-panel.ts`.

### Controls

| Control             | Type     | Range         | Default | Live-update |
|---------------------|----------|---------------|---------|-------------|
| START / STOP toggle | Button   | —             | Stopped | —           |
| Intensity           | Slider   | 10–200 req/s  | 60      | Yes         |
| Write %             | Slider   | 0–100%        | 15      | Yes         |
| Auth %              | Slider   | 0–100%        | 0       | Yes         |
| Stream %            | Slider   | 0–100%        | 0       | Yes         |
| Large %             | Slider   | 0–100%        | 0       | Yes         |
| Async %             | Slider   | 0–100%        | 0       | Yes         |
| Key distribution    | Dropdown | Uniform/Zipf  | Uniform | Yes         |
| Zipf alpha          | Slider   | 1.0–2.0       | 1.3     | When Zipf   |
| Crash Server        | Button   | —             | —       | —           |
| Sever Connection    | Button   | —             | —       | —           |

### Live-Tuning Behavior

All sliders update the sim in real time while traffic is flowing. When a slider changes:
1. A new `WaveDef` is assembled from the current slider values
2. A new `TrafficSource` is created from that `WaveDef`
3. The existing `SimClient` is updated with the new traffic source
4. Packets already in-flight continue on their current path; new packets use the updated settings

The remaining read % is implicit: `100% - write - auth - stream - large - async`. If the sum exceeds 100%, reads go to 0% and the sliders clamp visually.

### START / STOP Behavior

**START:** Creates a `SimClient` with the current slider settings, attaches it to the sim, creates `BrowserDriver` + `SimToRendererAdapter`, starts the frame loop ticking.

**STOP:** Full reset (same as retry-wave):
- Kill driver/adapter
- Clear all transient visuals (packets, snakes, flash FX)
- Clear stress rings, utilization bars, pending counts on all components
- Rebuild fresh `SimComponent` objects (clears depleted buckets, filled queues)
- Re-add existing connections to the fresh sim
- Rebuild `PlacementUX` / `ConnectUX` for the new sim instance
- Board is clean for the next experiment

Traffic can be started and stopped freely — no commitment.

## Import / Export

Built as `src/sandbox/import-export.ts`. Two buttons at the bottom of the traffic control panel.

### Export Format

JSON serialization of `TopologyDef` extended with traffic settings:

```json
{
  "label": "My Architecture",
  "entryTargetId": "cdn1",
  "components": [
    { "type": "server", "id": "srv1", "zone": "zone_na", "label": "Server 1" }
  ],
  "connections": [
    { "from": "cdn1", "to": "srv1" }
  ],
  "autoScaleIds": [],
  "traffic": {
    "intensity": 120,
    "composition": {
      "writeRatio": 0.15,
      "authRatio": 0.05,
      "streamRatio": 0,
      "largeRatio": 0,
      "asyncRatio": 0.1
    },
    "keyDistribution": { "kind": "zipf", "alpha": 1.3, "spaceSize": 200 }
  }
}
```

The `traffic` field is optional on import — if missing, sliders keep their current values.

### EXPORT Button

1. Stop traffic if running (clean state for export)
2. Serialize current topology + traffic settings to JSON
3. Open a Pico-8 styled modal with the JSON in a read-only textarea
4. Player copies the text manually (or a "Copy" button for convenience)

### IMPORT Button

1. Stop traffic if running
2. Open a Pico-8 styled modal with an empty textarea + LOAD button
3. Player pastes JSON, clicks LOAD
4. Validate JSON structure (show error toast if malformed)
5. Clear the board (remove all components + connections from sim and renderer)
6. Rebuild topology: place components, wire connections, restore zones and labels
7. Restore traffic slider values from `traffic` field if present
8. Board is ready — player can START to test the imported architecture

## File Structure

```
src/sandbox.html                 — page shell
src/sandbox-boot.ts              — entry script
src/sandbox/traffic-panel.ts     — traffic control UI + slider logic
src/sandbox/import-export.ts     — export/import modals + serialization
```

## Reuse from Existing Code

| Existing Module                  | Usage in Sandbox                        |
|----------------------------------|-----------------------------------------|
| `CyberpunkTopologyRenderer`      | Same renderer, same board               |
| `cyberpunk-hud.ts`               | HUD shell, palette, speed control, toast|
| `PlacementUX` / `ConnectUX`      | Component placement and wiring          |
| `Sim` / `BrowserDriver`          | Sim engine and frame driver             |
| `SimToRendererAdapter`           | Sync sim state to renderer              |
| `buildSimComponent` / `wireWorkers` | Component factory                    |
| `ComponentMetricsAggregator`     | Live per-component metrics              |
| `bindInfoPanel`                  | Component info on click                 |
| `TopologyDef`                    | Import/export format basis              |

No sim engine changes required. Sandbox is purely a new UI mode driving the existing sim.

## Testing

### Unit Tests

- `tests/unit/sandbox-import-export.test.ts` — round-trip: build TopologyDef with traffic settings, export to JSON, import back, verify components/connections/zones/traffic match
- `tests/unit/sandbox-traffic-panel.test.ts` — verify traffic settings serialize correctly into export JSON and deserialize on import

### Build Test

- Add `sandbox.html` to existing `tests/unit/asset-presence.test.ts` to verify it's in the Vite build output

### Manual Testing Checklist

1. Place components, wire them, start traffic, observe packets flowing
2. Adjust sliders live — intensity change visible immediately
3. Hit STOP — board clears completely (no stale visuals)
4. Crash a server via chaos button — observe traffic dropping
5. Export -> copy JSON -> STOP -> Import -> paste -> verify topology rebuilds
6. Navigate from landing page SANDBOX button -> sandbox loads
7. Speed control (1x/2x/4x) works during sandbox simulation

## Future Work (Not in MVP)

- **Terraform HCL export** — read-only "View as Terraform" alongside JSON
- **Save/load named architectures** to localStorage
- **Share via URL** — encode topology in URL hash for clipboard sharing
- **Preset architectures** — load common patterns (LB + 2 servers, cache tier, etc.) as starting points
