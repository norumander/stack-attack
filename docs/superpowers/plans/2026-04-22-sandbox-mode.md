# Sandbox Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free-build sandbox mode where players construct architectures, live-tune traffic, inject chaos, and import/export topologies as JSON.

**Architecture:** New `sandbox.html` page with `sandbox-boot.ts` entry script. Reuses existing renderer, HUD, placement/connect UX, and sim engine. A `SandboxController` extends `BaseController` with infinite budget and always-build phase. Traffic panel and import/export are new modules in `src/sandbox/`. No sim engine changes.

**Tech Stack:** TypeScript, Pixi.js (existing renderer), Vite MPA, existing sim engine.

---

### Task 1: SandboxController

**Files:**
- Create: `src/sandbox/sandbox-controller.ts`
- Test: `tests/unit/sandbox-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sandbox-controller.test.ts
import { describe, it, expect } from "vitest";
import { SandboxController } from "../../src/sandbox/sandbox-controller";
import type { ComponentId, ConnectionId } from "@core/types/ids";

describe("SandboxController", () => {
  function makeController() {
    const placed: Array<{ type: string; id: ComponentId }> = [];
    const connected: Array<{ src: ComponentId; tgt: ComponentId }> = [];
    const ctrl = new SandboxController({
      onPlaced: (type, id, _pos) => placed.push({ type, id }),
      onConnected: (src, tgt) => connected.push({ src, tgt }),
      onComponentDeleted: () => {},
      onConnectionDeleted: () => {},
      onBudgetChange: () => {},
    });
    return { ctrl, placed, connected };
  }

  it("places components with no budget limit", () => {
    const { ctrl, placed } = makeController();
    // Place 100 servers — should never run out of budget
    for (let i = 0; i < 100; i++) {
      const r = ctrl.tryPlace("server", { x: i, y: 0 });
      expect(r.ok).toBe(true);
    }
    expect(placed).toHaveLength(100);
  });

  it("isBuildPhase returns true in build, false in simulate", () => {
    const { ctrl } = makeController();
    expect(ctrl.phase).toBe("build");
    const r = ctrl.tryPlace("server", { x: 0, y: 0 });
    expect(r.ok).toBe(true);
    ctrl.startSimulate();
    // Placement blocked during simulate
    const r2 = ctrl.tryPlace("server", { x: 1, y: 0 });
    expect(r2.ok).toBe(false);
    ctrl.stopSimulate();
    expect(ctrl.phase).toBe("build");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/sandbox-controller.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/sandbox/sandbox-controller.ts
import { BaseController, type BaseCallbacks } from "../physics-td/base-controller";
import { COMPONENT_COSTS } from "../physics-td/component-factory";
import type { WaveRevenue } from "@sim/wave";

export type SandboxPhase = "build" | "simulate";

const INFINITE_BUDGET = 999_999;
const SANDBOX_REVENUE: WaveRevenue = {
  perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3,
};

export class SandboxController extends BaseController {
  phase: SandboxPhase = "build";

  constructor(callbacks: BaseCallbacks) {
    super(COMPONENT_COSTS, callbacks, INFINITE_BUDGET);
  }

  protected override isBuildPhase(): boolean {
    return this.phase === "build";
  }

  protected override deleteRefundRate(): number {
    return 1; // full refund — budget is infinite anyway
  }

  currentWaveRevenue(): WaveRevenue {
    return SANDBOX_REVENUE;
  }

  startSimulate(): void {
    this.phase = "simulate";
  }

  stopSimulate(): void {
    this.phase = "build";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/sandbox-controller.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/sandbox-controller.ts tests/unit/sandbox-controller.test.ts
git commit -m "feat(sandbox): SandboxController — infinite budget, build/simulate toggle"
```

---

### Task 2: Import/Export Module

**Files:**
- Create: `src/sandbox/import-export.ts`
- Test: `tests/unit/sandbox-import-export.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/sandbox-import-export.test.ts
import { describe, it, expect } from "vitest";
import {
  exportTopology,
  importTopology,
  type SandboxExport,
  type SandboxTrafficSettings,
} from "../../src/sandbox/import-export";

describe("sandbox import/export", () => {
  const traffic: SandboxTrafficSettings = {
    intensity: 120,
    composition: {
      writeRatio: 0.15,
      authRatio: 0.05,
      streamRatio: 0,
      largeRatio: 0,
      asyncRatio: 0.1,
    },
    keyDistribution: { kind: "zipf", alpha: 1.3, spaceSize: 200 },
  };

  const components = [
    { type: "server", id: "s1", label: "Server 1" },
    { type: "database", id: "db1", zone: "zone_na", label: "Posts DB" },
  ];
  const connections = [{ from: "s1", to: "db1" }];

  it("round-trips topology + traffic through JSON", () => {
    const json = exportTopology({
      label: "test",
      entryTargetId: "s1",
      components,
      connections,
      autoScaleIds: [],
    }, traffic);

    const parsed = importTopology(json);
    expect(parsed).not.toBeNull();
    const p = parsed!;
    expect(p.topology.components).toEqual(components);
    expect(p.topology.connections).toEqual(connections);
    expect(p.topology.entryTargetId).toBe("s1");
    expect(p.traffic?.intensity).toBe(120);
    expect(p.traffic?.composition.writeRatio).toBe(0.15);
    expect(p.traffic?.keyDistribution).toEqual({ kind: "zipf", alpha: 1.3, spaceSize: 200 });
  });

  it("returns null for malformed JSON", () => {
    expect(importTopology("not json")).toBeNull();
    expect(importTopology('{"label":"x"}')).toBeNull(); // missing required fields
  });

  it("imports without traffic field (traffic is optional)", () => {
    const json = JSON.stringify({
      label: "minimal",
      entryTargetId: "s1",
      components,
      connections,
      autoScaleIds: [],
    });
    const parsed = importTopology(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.traffic).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/sandbox-import-export.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/sandbox/import-export.ts
import type { TopologyDef } from "../playtest/topology-builder";
import type { WaveComposition, WaveKeyDistribution } from "@sim/wave";

export interface SandboxTrafficSettings {
  readonly intensity: number;
  readonly composition: WaveComposition;
  readonly keyDistribution: WaveKeyDistribution;
}

export interface SandboxExport extends TopologyDef {
  readonly traffic?: SandboxTrafficSettings;
}

export interface SandboxImportResult {
  readonly topology: TopologyDef;
  readonly traffic?: SandboxTrafficSettings;
}

export function exportTopology(
  topology: TopologyDef,
  traffic: SandboxTrafficSettings,
): string {
  const out: SandboxExport = { ...topology, traffic };
  return JSON.stringify(out, null, 2);
}

export function importTopology(json: string): SandboxImportResult | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.entryTargetId !== "string" ||
    !Array.isArray(obj.components) ||
    !Array.isArray(obj.connections)
  ) {
    return null;
  }
  const topology: TopologyDef = {
    label: typeof obj.label === "string" ? obj.label : "imported",
    entryTargetId: obj.entryTargetId,
    components: obj.components as TopologyDef["components"],
    connections: obj.connections as TopologyDef["connections"],
    autoScaleIds: Array.isArray(obj.autoScaleIds)
      ? (obj.autoScaleIds as string[])
      : [],
  };
  const traffic = obj.traffic as SandboxTrafficSettings | undefined;
  return { topology, traffic };
}

/**
 * Show an export modal with the JSON in a read-only textarea.
 * Returns a promise that resolves when the modal is dismissed.
 */
export function showExportModal(json: string): Promise<void> {
  return new Promise((resolve) => {
    document.querySelector(".cp-sandbox-modal-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "cp-sandbox-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "cp-sandbox-modal cp-panel";

    const title = document.createElement("h2");
    title.className = "cp-sandbox-modal-title";
    title.textContent = "EXPORT";
    modal.appendChild(title);

    const textarea = document.createElement("textarea");
    textarea.className = "cp-sandbox-modal-textarea";
    textarea.readOnly = true;
    textarea.value = json;
    modal.appendChild(textarea);

    const btnRow = document.createElement("div");
    btnRow.className = "cp-sandbox-modal-buttons";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "cp-win-cta";
    copyBtn.textContent = "COPY";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(json).then(() => {
        copyBtn.textContent = "COPIED";
        setTimeout(() => { copyBtn.textContent = "COPY"; }, 1500);
      });
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cp-win-cta cp-win-cta--secondary";
    closeBtn.textContent = "CLOSE";
    closeBtn.addEventListener("click", () => { overlay.remove(); resolve(); });

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(closeBtn);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    textarea.select();
  });
}

/**
 * Show an import modal with an empty textarea. Returns the parsed result
 * or null if the user cancels.
 */
export function showImportModal(): Promise<SandboxImportResult | null> {
  return new Promise((resolve) => {
    document.querySelector(".cp-sandbox-modal-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "cp-sandbox-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "cp-sandbox-modal cp-panel";

    const title = document.createElement("h2");
    title.className = "cp-sandbox-modal-title";
    title.textContent = "IMPORT";
    modal.appendChild(title);

    const textarea = document.createElement("textarea");
    textarea.className = "cp-sandbox-modal-textarea";
    textarea.placeholder = "Paste topology JSON here...";
    modal.appendChild(textarea);

    const error = document.createElement("div");
    error.className = "cp-sandbox-modal-error";
    error.style.display = "none";
    modal.appendChild(error);

    const btnRow = document.createElement("div");
    btnRow.className = "cp-sandbox-modal-buttons";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "cp-win-cta";
    loadBtn.textContent = "LOAD";
    loadBtn.addEventListener("click", () => {
      const result = importTopology(textarea.value);
      if (!result) {
        error.textContent = "Invalid JSON — check format and try again";
        error.style.display = "block";
        return;
      }
      overlay.remove();
      resolve(result);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cp-win-cta cp-win-cta--secondary";
    cancelBtn.textContent = "CANCEL";
    cancelBtn.addEventListener("click", () => { overlay.remove(); resolve(null); });

    btnRow.appendChild(loadBtn);
    btnRow.appendChild(cancelBtn);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    textarea.focus();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/sandbox-import-export.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/import-export.ts tests/unit/sandbox-import-export.test.ts
git commit -m "feat(sandbox): import/export module — JSON round-trip + modals"
```

---

### Task 3: Traffic Panel UI

**Files:**
- Create: `src/sandbox/traffic-panel.ts`

- [ ] **Step 1: Create the traffic panel module**

```typescript
// src/sandbox/traffic-panel.ts
/**
 * Traffic control panel for sandbox mode. Builds DOM into the right column
 * (replacing the briefing panel slot). Exposes current settings as a live
 * object that sandbox-boot reads when creating/updating the TrafficSource.
 */

export interface TrafficSettings {
  intensity: number;
  writeRatio: number;
  authRatio: number;
  streamRatio: number;
  largeRatio: number;
  asyncRatio: number;
  keyKind: "uniform" | "zipf";
  zipfAlpha: number;
  spaceSize: number;
}

export interface TrafficPanelHandle {
  /** Current slider values. Mutated in-place by slider events. */
  readonly settings: TrafficSettings;
  /** Register callback for START button click. */
  onStart(cb: () => void): void;
  /** Register callback for STOP button click. */
  onStop(cb: () => void): void;
  /** Register callback for Crash Server button click. */
  onCrashServer(cb: () => void): void;
  /** Register callback for Sever Connection button click. */
  onSeverConnection(cb: () => void): void;
  /** Register callback for Export button click. */
  onExport(cb: () => void): void;
  /** Register callback for Import button click. */
  onImport(cb: () => void): void;
  /** Register callback invoked whenever any slider changes. */
  onChange(cb: () => void): void;
  /** Update settings from imported traffic (e.g. after import). */
  applySettings(s: Partial<TrafficSettings>): void;
  /** Toggle the START/STOP button label. */
  setRunning(running: boolean): void;
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function sliderRow(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const row = div("cp-traffic-row");
  const lbl = document.createElement("label");
  lbl.className = "cp-traffic-label";
  lbl.textContent = label;
  const val = document.createElement("span");
  val.className = "cp-traffic-val";
  val.textContent = String(initial);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "cp-traffic-slider";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(initial);
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    val.textContent = String(v);
    onChange(v);
  });
  lbl.appendChild(val);
  row.appendChild(lbl);
  row.appendChild(slider);
  parent.appendChild(row);
  return slider;
}

export function buildTrafficPanel(root: HTMLElement): TrafficPanelHandle {
  const panel = div("cp-traffic-panel cp-panel");

  const title = div("cp-traffic-title");
  title.textContent = "TRAFFIC";
  panel.appendChild(title);

  const settings: TrafficSettings = {
    intensity: 60,
    writeRatio: 0.15,
    authRatio: 0,
    streamRatio: 0,
    largeRatio: 0,
    asyncRatio: 0,
    keyKind: "uniform",
    spaceSize: 200,
    zipfAlpha: 1.3,
  };

  const startCbs: Array<() => void> = [];
  const stopCbs: Array<() => void> = [];
  const crashCbs: Array<() => void> = [];
  const severCbs: Array<() => void> = [];
  const exportCbs: Array<() => void> = [];
  const importCbs: Array<() => void> = [];
  const changeCbs: Array<() => void> = [];

  const fireChange = (): void => { for (const cb of changeCbs) cb(); };

  let running = false;

  // START / STOP toggle
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "cp-win-cta cp-traffic-toggle";
  toggleBtn.textContent = "START";
  toggleBtn.addEventListener("click", () => {
    if (running) {
      for (const cb of stopCbs) cb();
    } else {
      for (const cb of startCbs) cb();
    }
  });
  panel.appendChild(toggleBtn);

  // Sliders
  const sliders: Record<string, HTMLInputElement> = {};
  sliders.intensity = sliderRow(panel, "INTENSITY", 10, 200, 5, 60, (v) => { settings.intensity = v; fireChange(); });
  sliders.write = sliderRow(panel, "WRITE %", 0, 100, 1, 15, (v) => { settings.writeRatio = v / 100; fireChange(); });
  sliders.auth = sliderRow(panel, "AUTH %", 0, 100, 1, 0, (v) => { settings.authRatio = v / 100; fireChange(); });
  sliders.stream = sliderRow(panel, "STREAM %", 0, 100, 1, 0, (v) => { settings.streamRatio = v / 100; fireChange(); });
  sliders.large = sliderRow(panel, "LARGE %", 0, 100, 1, 0, (v) => { settings.largeRatio = v / 100; fireChange(); });
  sliders.async = sliderRow(panel, "ASYNC %", 0, 100, 1, 0, (v) => { settings.asyncRatio = v / 100; fireChange(); });

  // Key distribution
  const distRow = div("cp-traffic-row");
  const distLabel = document.createElement("label");
  distLabel.className = "cp-traffic-label";
  distLabel.textContent = "KEYS";
  const distSelect = document.createElement("select");
  distSelect.className = "cp-traffic-select";
  distSelect.innerHTML = '<option value="uniform">Uniform</option><option value="zipf">Zipf</option>';
  distSelect.value = "uniform";
  distRow.appendChild(distLabel);
  distRow.appendChild(distSelect);
  panel.appendChild(distRow);

  const zipfSlider = sliderRow(panel, "ZIPF α", 10, 20, 1, 13, (v) => { settings.zipfAlpha = v / 10; fireChange(); });
  const zipfRow = zipfSlider.parentElement!;
  zipfRow.style.display = "none";

  distSelect.addEventListener("change", () => {
    settings.keyKind = distSelect.value as "uniform" | "zipf";
    zipfRow.style.display = settings.keyKind === "zipf" ? "" : "none";
    fireChange();
  });

  // Chaos buttons
  const chaosRow = div("cp-traffic-chaos");
  const chaosTitle = div("cp-traffic-label");
  chaosTitle.textContent = "CHAOS";
  chaosRow.appendChild(chaosTitle);

  const crashBtn = document.createElement("button");
  crashBtn.type = "button";
  crashBtn.className = "cp-win-cta cp-win-cta--secondary cp-traffic-chaos-btn";
  crashBtn.textContent = "CRASH SERVER";
  crashBtn.addEventListener("click", () => { for (const cb of crashCbs) cb(); });
  chaosRow.appendChild(crashBtn);

  const severBtn = document.createElement("button");
  severBtn.type = "button";
  severBtn.className = "cp-win-cta cp-win-cta--secondary cp-traffic-chaos-btn";
  severBtn.textContent = "SEVER WIRE";
  severBtn.addEventListener("click", () => { for (const cb of severCbs) cb(); });
  chaosRow.appendChild(severBtn);
  panel.appendChild(chaosRow);

  // Import / Export buttons
  const ioRow = div("cp-traffic-io");
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "cp-win-cta cp-win-cta--secondary";
  exportBtn.textContent = "EXPORT";
  exportBtn.addEventListener("click", () => { for (const cb of exportCbs) cb(); });
  ioRow.appendChild(exportBtn);

  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "cp-win-cta cp-win-cta--secondary";
  importBtn.textContent = "IMPORT";
  importBtn.addEventListener("click", () => { for (const cb of importCbs) cb(); });
  ioRow.appendChild(importBtn);
  panel.appendChild(ioRow);

  root.appendChild(panel);

  return {
    settings,
    onStart: (cb) => startCbs.push(cb),
    onStop: (cb) => stopCbs.push(cb),
    onCrashServer: (cb) => crashCbs.push(cb),
    onSeverConnection: (cb) => severCbs.push(cb),
    onExport: (cb) => exportCbs.push(cb),
    onImport: (cb) => importCbs.push(cb),
    onChange: (cb) => changeCbs.push(cb),
    setRunning: (r) => {
      running = r;
      toggleBtn.textContent = r ? "STOP" : "START";
      toggleBtn.classList.toggle("cp-traffic-toggle--running", r);
    },
    applySettings: (s) => {
      if (s.intensity !== undefined) { settings.intensity = s.intensity; sliders.intensity!.value = String(s.intensity); }
      if (s.writeRatio !== undefined) { settings.writeRatio = s.writeRatio; sliders.write!.value = String(Math.round(s.writeRatio * 100)); }
      if (s.authRatio !== undefined) { settings.authRatio = s.authRatio; sliders.auth!.value = String(Math.round(s.authRatio * 100)); }
      if (s.streamRatio !== undefined) { settings.streamRatio = s.streamRatio; sliders.stream!.value = String(Math.round(s.streamRatio * 100)); }
      if (s.largeRatio !== undefined) { settings.largeRatio = s.largeRatio; sliders.large!.value = String(Math.round(s.largeRatio * 100)); }
      if (s.asyncRatio !== undefined) { settings.asyncRatio = s.asyncRatio; sliders.async!.value = String(Math.round(s.asyncRatio * 100)); }
      if (s.keyKind !== undefined) { settings.keyKind = s.keyKind; distSelect.value = s.keyKind; zipfRow.style.display = s.keyKind === "zipf" ? "" : "none"; }
      if (s.zipfAlpha !== undefined) { settings.zipfAlpha = s.zipfAlpha; zipfSlider.value = String(Math.round(s.zipfAlpha * 10)); }
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/sandbox/traffic-panel.ts
git commit -m "feat(sandbox): traffic panel UI — sliders, chaos buttons, import/export"
```

---

### Task 4: Sandbox HTML Page

**Files:**
- Create: `src/sandbox.html`
- Modify: `vite.config.ts` — add sandbox to build inputs

- [ ] **Step 1: Create the HTML page**

```html
<!-- src/sandbox.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stack Attack — Sandbox</title>
  <link rel="stylesheet" href="./styles.css" />
  <link rel="stylesheet" href="./cyberpunk-hud.css" />
  <link rel="stylesheet" href="./chatbot/chatbot-drawer.css" />
  <link rel="stylesheet" href="./auth/auth.css" />
  <style>
    html, body { margin: 0; padding: 0; background: #0a1420; color: #ccddee; font-family: monospace; overflow: hidden; }
    #canvas-host { position: absolute; inset: 0; }
    .td-hud-mirror { display: none; }
  </style>
</head>
<body>
  <div id="canvas-host"></div>

  <div class="td-hud-mirror">
    <div id="td-hud-wave">SANDBOX</div>
    <div id="td-hud-phase">build</div>
    <div id="td-hud-budget">∞</div>
    <div id="td-status">Sandbox — place components, then START traffic</div>
    <div id="td-topology-errors"></div>
    <div id="td-briefing-title"></div>
    <div id="td-briefing-traffic"></div>
    <div id="td-briefing-budget"></div>
    <div id="td-briefing-threshold"></div>
    <div id="td-briefing-components"></div>
    <div id="td-info-panel" hidden>
      <button id="td-info-panel-close">×</button>
      <div id="td-info-panel-header"></div>
      <div id="td-info-panel-description"></div>
      <ul id="td-info-panel-caps"></ul>
      <div id="td-info-panel-stats"></div>
      <button id="td-info-panel-details">DETAILS</button>
    </div>
    <button id="td-ready-btn" style="display:none">READY</button>
  </div>

  <script type="module" src="./sandbox-boot.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Add to Vite build inputs**

In `vite.config.ts`, add `sandbox` to the `rollupOptions.input` object:

```typescript
input: {
  landing: resolve(srcDir, "index.html"),
  levels: resolve(srcDir, "levels.html"),
  game: resolve(srcDir, "game.html"),
  diagnose: resolve(srcDir, "diagnose.html"),
  sandbox: resolve(srcDir, "sandbox.html"),
},
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck && pnpm exec vite build`
Expected: both pass, `src/dist/sandbox.html` exists

- [ ] **Step 4: Commit**

```bash
git add src/sandbox.html vite.config.ts
git commit -m "feat(sandbox): HTML page + Vite build input"
```

---

### Task 5: Sandbox Boot Script

**Files:**
- Create: `src/sandbox-boot.ts`

This is the main integration task. It wires the renderer, HUD, controller, placement/connect UX, traffic panel, frame loop, start/stop lifecycle, import/export, chaos, and info panel.

- [ ] **Step 1: Create sandbox-boot.ts**

```typescript
// src/sandbox-boot.ts
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
  type CyberpunkHudController,
} from "./cyberpunk-hud";
import { CyberpunkTopologyRenderer } from "./render/cyberpunk-topology-renderer";
import { Sim } from "@sim/sim";
import { SimClient } from "@sim/client";
import { SimConnection } from "@sim/connection";
import { TrafficSource } from "@sim/traffic-source";
import { makeSimRng } from "@sim/rng";
import { BrowserDriver } from "./sim-demo/browser-driver";
import { SimToRendererAdapter } from "./sim-demo/sim-to-renderer";
import { SandboxController } from "./sandbox/sandbox-controller";
import {
  buildSimComponent,
  COMPONENT_SPRITE_TYPE,
  COMPONENT_COSTS,
} from "./physics-td/component-factory";
import { PlacementUX } from "./physics-td/placement-ux";
import { ConnectUX } from "./physics-td/connect-ux";
import { wireWorkers } from "./physics-td/wire-workers";
import { bindInfoPanel, type InfoPanelHandle } from "./physics-td/component-info-panel";
import { ComponentDossierStore } from "./physics-td/dossier-store";
import { ComponentMetricsAggregator } from "./physics-td/component-metrics";
import { applyChaosEvent } from "./physics-td/chaos";
import * as hud from "./physics-td/hud-bridge";
import { buildTrafficPanel, type TrafficPanelHandle } from "./sandbox/traffic-panel";
import {
  exportTopology,
  importTopology,
  showExportModal,
  showImportModal,
  type SandboxTrafficSettings,
} from "./sandbox/import-export";
import type { TopologyDef } from "./playtest/topology-builder";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";
import type { WaveDef } from "@sim/wave";

const CLIENT_ID = "client" as ComponentId;

async function waitForHudController(): Promise<CyberpunkHudController> {
  for (let i = 0; i < 60; i += 1) {
    const ctrl = getCyberpunkHudController();
    if (ctrl) return ctrl;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  throw new Error("Cyberpunk HUD controller never initialized");
}

function buildWaveDef(settings: ReturnType<typeof buildTrafficPanel>["settings"]): WaveDef {
  const packetRate = Math.max(1, Math.round(settings.intensity / 8));
  return {
    intensity: settings.intensity,
    packetRate,
    duration: 9999, // effectively infinite — stopped manually
    composition: {
      writeRatio: settings.writeRatio,
      authRatio: settings.authRatio,
      streamRatio: settings.streamRatio,
      largeRatio: settings.largeRatio,
      asyncRatio: settings.asyncRatio,
    },
    keyDistribution: settings.keyKind === "zipf"
      ? { kind: "zipf", alpha: settings.zipfAlpha, spaceSize: settings.spaceSize }
      : { kind: "uniform", spaceSize: settings.spaceSize },
    revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
    entryClients: [CLIENT_ID],
  };
}

async function main(): Promise<void> {
  activateCyberpunkHud();
  const hudCtrl = await waitForHudController();

  const host = document.getElementById("canvas-host");
  if (!host) throw new Error("canvas-host missing");

  const renderer = new CyberpunkTopologyRenderer();
  await renderer.mount(host);
  renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () =>
    renderer.resize(window.innerWidth, window.innerHeight),
  );

  let sim = new Sim({ seed: 1 });
  const positions = new Map<ComponentId, { x: number; y: number }>();
  const componentTypes = new Map<ComponentId, string>();
  const componentLabels = new Map<ComponentId, string | undefined>();
  let perComponentDrops = new Map<ComponentId, { total: number; byReason: Map<string, number> }>();
  let perComponentProcessed = new Map<ComponentId, number>();
  const metricsAggregator = new ComponentMetricsAggregator();

  let driver: BrowserDriver | null = null;
  let adapter: SimToRendererAdapter | null = null;

  const refs: { placement: PlacementUX | null; connect: ConnectUX | null } = {
    placement: null,
    connect: null,
  };

  const controller = new SandboxController({
    onPlaced: (type, id, gridPos) => {
      positions.set(id, gridPos);
      componentTypes.set(id, type);
      let index = 0;
      for (const t of componentTypes.values()) if (t === type) index += 1;
      const label = `${type} ${index}`;
      componentLabels.set(id, label);

      const zone = hudCtrl.getSelectedZone();
      const comp = buildSimComponent(type, id, controller.currentWaveRevenue(), zone, label);
      if (comp) sim.addComponent(comp);

      const sprite = COMPONENT_SPRITE_TYPE.get(type) ?? "server";
      const zoneBadge = zone ? ` [${zone.replace("zone_", "").toUpperCase()}]` : "";
      renderer.addComponent(id, {
        type: sprite,
        displayName: label,
        gridPosition: gridPos,
        label: `${label}${zoneBadge}`,
      });
    },
    onConnected: (sourceId, targetId, forwardId, backId) => {
      const forward = new SimConnection({
        id: forwardId,
        from: { componentId: sourceId, portId: "p" as PortId },
        to: { componentId: targetId, portId: "p" as PortId },
        bandwidth: 500,
        latencySeconds: 0.1,
        twinId: backId,
        direction: "forward",
      });
      const back = new SimConnection({
        id: backId,
        from: { componentId: targetId, portId: "p" as PortId },
        to: { componentId: sourceId, portId: "p" as PortId },
        bandwidth: 500,
        latencySeconds: 0.1,
        twinId: forwardId,
        direction: "back",
      });
      sim.addConnection(forward);
      sim.addConnection(back);
      renderer.addConnection(forwardId, sourceId, targetId, { direction: "forward" });
      renderer.addConnection(backId, targetId, sourceId, { direction: "back" });
    },
    onComponentDeleted: (id) => {
      sim.components.delete(id);
      renderer.removeComponent(id);
      positions.delete(id);
      componentTypes.delete(id);
      componentLabels.delete(id);
    },
    onConnectionDeleted: (forwardId) => {
      const conn = sim.connections.get(forwardId);
      const twinId = conn?.twinId;
      sim.connections.delete(forwardId);
      if (twinId) sim.connections.delete(twinId);
      renderer.removeConnection(forwardId);
      if (twinId) renderer.removeConnection(twinId);
    },
    onBudgetChange: () => {}, // budget is infinite — no UI update needed
  });

  // ─── Info panel ──────────────────────────────────────────────────────
  const dossierStore = new ComponentDossierStore();
  const infoPanel: InfoPanelHandle = bindInfoPanel({
    renderer: { onPointerDown: (cb) => renderer.onPointerDown((ev) => cb({ hit: ev.hit })) },
    getSim: () => sim,
    controller: controller as unknown as { phase: string },
    dossierStore,
    hudCtrl,
    componentTypes,
    getDrops: () => perComponentDrops,
    getProcessed: () => perComponentProcessed,
    getMetrics: (id) => metricsAggregator.getMetricsFor(id),
  });

  // ─── Client placement ────────────────────────────────────────────────
  const CLIENT_POS = { x: -10, y: 0 };
  positions.set(CLIENT_ID, CLIENT_POS);
  renderer.addComponent(CLIENT_ID, {
    type: "client",
    displayName: "client",
    gridPosition: CLIENT_POS,
  });

  // ─── PlacementUX + ConnectUX ─────────────────────────────────────────
  function rebuildUX(): void {
    refs.placement = new PlacementUX(
      sim, renderer,
      controller as unknown as import("./physics-td/campaign-controller").PhysicsCampaignController,
    );
    refs.placement.setZoneResolver(() => hudCtrl.getSelectedZone());
    refs.connect = new ConnectUX(
      sim, renderer,
      controller as unknown as import("./physics-td/campaign-controller").PhysicsCampaignController,
      () => refs.placement?.isPlacing() ?? false,
    );
  }
  rebuildUX();

  // ─── Palette wiring ──────────────────────────────────────────────────
  const paletteButtons = hudCtrl.getPaletteButtons();
  const livePaletteButtons = new Map<string, HTMLButtonElement>();
  for (const [type, btn] of paletteButtons) {
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(fresh);
    livePaletteButtons.set(type, fresh);
    fresh.addEventListener("click", (e) => {
      e.preventDefault();
      refs.placement?.enterPlacingMode(type);
    });
  }
  refs.placement!.setOnPlacingChange((type) => {
    for (const [t, btn] of livePaletteButtons) {
      btn.classList.toggle("cp-placing", t === type);
    }
  });

  // ─── Connection toggle + delete ──────────────────────────────────────
  renderer.onConnectionPointerDown((connId) => {
    if (controller.phase !== "build") return;
    renderer.toggleConnectionRoute(connId);
  });

  function handleContextMenu(ev: MouseEvent): void {
    ev.preventDefault();
    if (controller.phase !== "build") return;
    const compHit = renderer.hitTest(ev.clientX, ev.clientY);
    if (compHit) {
      if (compHit.componentId === CLIENT_ID) {
        hudCtrl.showToast("Cannot delete the client");
        return;
      }
      controller.tryDeleteComponent(compHit.componentId);
      return;
    }
    const connId = renderer.hitTestConnection(ev.clientX, ev.clientY);
    if (connId !== null) {
      const conn = sim.connections.get(connId);
      const canonicalId = conn?.direction === "back" ? (conn.twinId ?? connId) : connId;
      controller.tryDeleteConnection(canonicalId);
    }
  }
  host.addEventListener("contextmenu", handleContextMenu);
  const canvas = renderer.getCanvas();
  if (canvas) canvas.addEventListener("contextmenu", handleContextMenu);

  // ─── Zone reassignment ───────────────────────────────────────────────
  hudCtrl.onZoneClick((zone) => {
    if (controller.phase !== "build") return;
    const selectedId = infoPanel.openId();
    if (!selectedId) return;
    const comp = sim.components.get(selectedId);
    if (!comp) return;
    comp.zone = zone ?? null;
    const baseLabel = componentLabels.get(selectedId);
    if (baseLabel) {
      const stripped = baseLabel.replace(/\s*\[(?:NA|EU|AP)\]$/, "");
      const zoneBadge = zone ? ` [${zone.replace("zone_", "").toUpperCase()}]` : "";
      const newLabel = `${stripped}${zoneBadge}`;
      componentLabels.set(selectedId, newLabel);
      renderer.updateComponent(selectedId, { label: newLabel });
    }
    hudCtrl.showToast(`Zone → ${zone ? zone.replace("zone_", "").toUpperCase() : "none"}`);
  });

  // ─── Traffic panel (right column) ────────────────────────────────────
  const rightCol = document.querySelector(".cp-right-col");
  // Hide briefing + viability panels (not used in sandbox)
  document.getElementById("cp-briefing-panel")?.classList.add("cp-hidden");
  document.querySelector(".cp-viability")?.classList.add("cp-hidden");

  const trafficPanel = buildTrafficPanel(rightCol ?? document.body);

  // ─── START / STOP lifecycle ──────────────────────────────────────────
  function startTraffic(): void {
    const wave = buildWaveDef(trafficPanel.settings);
    const ts = new TrafficSource(wave, makeSimRng(Date.now()));
    const client = new SimClient({
      id: CLIENT_ID,
      capabilities: [],
      packetRate: wave.packetRate,
      trafficSource: ts,
      waveStartTime: sim.simTime,
      waveEndTime: sim.simTime + wave.duration,
    });
    sim.addClient(client);
    wireWorkers(sim);

    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    metricsAggregator.reset();

    adapter = new SimToRendererAdapter(sim, renderer, positions);
    driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });
    controller.startSimulate();
    trafficPanel.setRunning(true);
    hud.setPhase("simulate");
  }

  function stopTraffic(): void {
    driver = null;
    adapter = null;
    controller.stopSimulate();
    trafficPanel.setRunning(false);
    hud.setPhase("build");

    // Full reset — same as retry-wave.
    renderer.resetTransientVisuals();
    for (const id of sim.components.keys()) {
      renderer.updateComponent(id, {
        utilization: 0,
        pendingCount: 0,
        stress: { stressed: false, dropping: false },
      });
    }
    const oldConnections = [...sim.connections.values()];
    const wave = buildWaveDef(trafficPanel.settings);
    sim = new Sim({ seed: 1 });
    for (const [id, type] of componentTypes) {
      const oldZone = undefined; // zones are on labels
      const label = componentLabels.get(id);
      const zoneMatch = label?.match(/\[(\w+)\]$/);
      const zone = zoneMatch ? `zone_${zoneMatch[1]!.toLowerCase()}` : undefined;
      const comp = buildSimComponent(type, id, wave.revenue, zone, label?.replace(/\s*\[\w+\]$/, ""));
      if (comp) sim.addComponent(comp);
    }
    for (const c of oldConnections) sim.addConnection(c);
    wireWorkers(sim);
    rebuildUX();
    refs.placement!.setOnPlacingChange((type) => {
      for (const [t, btn] of livePaletteButtons) {
        btn.classList.toggle("cp-placing", t === type);
      }
    });

    perComponentDrops = new Map();
    perComponentProcessed = new Map();
    metricsAggregator.reset();
    infoPanel.hide();
    hud.setStatus("Sandbox — place components, then START traffic");
  }

  trafficPanel.onStart(() => startTraffic());
  trafficPanel.onStop(() => stopTraffic());

  // Live-tune: rebuild TrafficSource when sliders change during simulation.
  trafficPanel.onChange(() => {
    if (controller.phase !== "simulate") return;
    const client = sim.clients.get(CLIENT_ID);
    if (!client) return;
    const wave = buildWaveDef(trafficPanel.settings);
    const ts = new TrafficSource(wave, makeSimRng(Date.now()));
    client.trafficSource = ts as unknown as typeof client.trafficSource;
    client.packetRate = wave.packetRate;
  });

  // ─── Chaos buttons ───────────────────────────────────────────────────
  trafficPanel.onCrashServer(() => {
    applyChaosEvent({ atSeconds: 0, kind: "crash_component", targetRole: "any_server" }, sim);
    hudCtrl.showToast("Server crashed");
  });
  trafficPanel.onSeverConnection(() => {
    applyChaosEvent({ atSeconds: 0, kind: "sever_connection", targetRole: "any_connection_to_database" }, sim);
    hudCtrl.showToast("Connection severed");
  });

  // ─── Export / Import ─────────────────────────────────────────────────
  trafficPanel.onExport(async () => {
    if (controller.phase === "simulate") stopTraffic();
    const topo: TopologyDef = {
      label: "sandbox-export",
      entryTargetId: (() => {
        // Find entry: first component connected from client.
        for (const c of sim.connections.values()) {
          if (c.from.componentId === CLIENT_ID && c.direction === "forward") {
            return c.to.componentId as unknown as string;
          }
        }
        return "";
      })(),
      components: [...componentTypes.entries()].map(([id, type]) => ({
        type,
        id: id as unknown as string,
        label: componentLabels.get(id)?.replace(/\s*\[\w+\]$/, ""),
        ...(sim.components.get(id)?.zone ? { zone: sim.components.get(id)!.zone! } : {}),
      })),
      connections: [...sim.connections.values()]
        .filter((c) => c.direction === "forward" && (c.from.componentId as unknown as string) !== (CLIENT_ID as unknown as string))
        .map((c) => ({
          from: c.from.componentId as unknown as string,
          to: c.to.componentId as unknown as string,
        })),
      autoScaleIds: [],
    };
    const s = trafficPanel.settings;
    const traffic: SandboxTrafficSettings = {
      intensity: s.intensity,
      composition: {
        writeRatio: s.writeRatio,
        authRatio: s.authRatio,
        streamRatio: s.streamRatio,
        largeRatio: s.largeRatio,
        asyncRatio: s.asyncRatio,
      },
      keyDistribution: s.keyKind === "zipf"
        ? { kind: "zipf", alpha: s.zipfAlpha, spaceSize: s.spaceSize }
        : { kind: "uniform", spaceSize: s.spaceSize },
    };
    await showExportModal(exportTopology(topo, traffic));
  });

  trafficPanel.onImport(async () => {
    if (controller.phase === "simulate") stopTraffic();
    const result = await showImportModal();
    if (!result) return;

    // Clear existing topology.
    for (const id of [...componentTypes.keys()]) {
      controller.tryDeleteComponent(id);
    }

    // Place imported components.
    const idMap = new Map<string, ComponentId>();
    const topo = result.topology;
    for (let i = 0; i < topo.components.length; i++) {
      const c = topo.components[i]!;
      // Spread components in a line for now — player can rearrange.
      const gridPos = { x: (i % 8) * 3 - 10, y: Math.floor(i / 8) * 3 };
      if (c.zone) hudCtrl.setZones([...new Set([c.zone])]);
      const r = controller.tryPlace(c.type, gridPos);
      if (r.ok) idMap.set(c.id, r.componentId);
    }

    // Wire connections.
    for (const edge of topo.connections) {
      const fromId = idMap.get(edge.from);
      const toId = idMap.get(edge.to);
      if (fromId && toId) controller.tryConnect(fromId, toId);
    }

    // Wire client to entry.
    const entryId = idMap.get(topo.entryTargetId);
    if (entryId) controller.tryConnect(CLIENT_ID, entryId);

    // Apply traffic settings if present.
    if (result.traffic) {
      trafficPanel.applySettings({
        intensity: result.traffic.intensity,
        writeRatio: result.traffic.composition.writeRatio,
        authRatio: result.traffic.composition.authRatio,
        streamRatio: result.traffic.composition.streamRatio,
        largeRatio: result.traffic.composition.largeRatio,
        asyncRatio: result.traffic.composition.asyncRatio,
        keyKind: result.traffic.keyDistribution.kind,
        ...(result.traffic.keyDistribution.kind === "zipf"
          ? { zipfAlpha: result.traffic.keyDistribution.alpha }
          : {}),
      });
    }
    hudCtrl.showToast("Topology imported");
  });

  // ─── Frame loop ──────────────────────────────────────────────────────
  let lastFrame = performance.now();
  function frame(now: number): void {
    const delta = now - lastFrame;
    lastFrame = now;
    if (driver && adapter) {
      driver.tick(delta * hudCtrl.getSimSpeed());

      for (const ev of driver.tickEvents) {
        if (ev.kind === "drop" && ev.count > 0) {
          const compId = ev.componentId as ComponentId;
          let tally = perComponentDrops.get(compId);
          if (!tally) { tally = { total: 0, byReason: new Map() }; perComponentDrops.set(compId, tally); }
          tally.total += ev.count;
          tally.byReason.set(ev.reason, (tally.byReason.get(ev.reason) ?? 0) + ev.count);
        } else if (ev.kind === "terminate" || ev.kind === "respond-delivered") {
          const compId = ev.componentId as ComponentId;
          perComponentProcessed.set(compId, (perComponentProcessed.get(compId) ?? 0) + ev.count);
        }
      }
      adapter.syncFrame(driver.tickEvents);
      metricsAggregator.update(sim, driver.tickEvents, sim.simTime);
      for (const id of sim.components.keys()) {
        if ((id as unknown as string) === (CLIENT_ID as unknown as string)) continue;
        const m = metricsAggregator.getMetricsFor(id);
        renderer.updateComponent(id, { stress: { stressed: m.stressed, dropping: m.dropping } });
      }
      if (infoPanel.isOpen()) {
        infoPanel.updateLiveStats();
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ─── Back button ─────────────────────────────────────────────────────
  // The HUD already has a back button from cyberpunk-hud.ts. It navigates
  // to levels.html. For sandbox, the back button should go to index.html.
  // We'll handle this by checking if we're on the sandbox page.

  hud.setStatus("Sandbox — place components, then START traffic");
}

void main();
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (may need minor type adjustments — fix inline)

- [ ] **Step 3: Commit**

```bash
git add src/sandbox-boot.ts
git commit -m "feat(sandbox): boot script — full sandbox mode integration"
```

---

### Task 6: Traffic Panel CSS

**Files:**
- Modify: `src/cyberpunk-hud.css` — add traffic panel styles

- [ ] **Step 1: Add CSS for traffic panel + import/export modals**

Append to `src/cyberpunk-hud.css`:

```css
/* ================================================================
   Sandbox traffic panel
   ================================================================ */

body.renderer-iso .cp-traffic-panel {
  position: relative !important;
  top: auto !important;
  margin-bottom: 12px;
}

body.renderer-iso .cp-traffic-title {
  font-family: "Press Start 2P", monospace;
  font-size: 11px;
  color: #FFEC27;
  text-shadow: 2px 2px 0 #FF77A8, 3px 3px 0 #000;
  margin-bottom: 10px;
}

body.renderer-iso .cp-traffic-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 8px;
}

body.renderer-iso .cp-traffic-label {
  font-family: "Press Start 2P", monospace;
  font-size: 8px;
  letter-spacing: 0.15em;
  color: var(--sc-ink-dim);
  display: flex;
  justify-content: space-between;
}

body.renderer-iso .cp-traffic-val {
  color: var(--sc-ink);
}

body.renderer-iso .cp-traffic-slider {
  width: 100%;
  accent-color: #29ADFF;
  cursor: pointer;
}

body.renderer-iso .cp-traffic-select {
  font-family: "Press Start 2P", monospace;
  font-size: 9px;
  background: #1D2B53;
  color: #29ADFF;
  border: 1px solid rgba(41, 173, 255, 0.4);
  padding: 4px 8px;
  cursor: pointer;
}

body.renderer-iso .cp-traffic-toggle {
  width: 100%;
  margin-bottom: 12px;
}

body.renderer-iso .cp-traffic-toggle--running {
  background: #FF004D !important;
  color: #FFF1E8 !important;
}

body.renderer-iso .cp-traffic-chaos {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--sc-border);
}

body.renderer-iso .cp-traffic-chaos-btn {
  font-size: 8px !important;
  padding: 4px 8px !important;
}

body.renderer-iso .cp-traffic-io {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--sc-border);
}

body.renderer-iso .cp-traffic-io .cp-win-cta--secondary {
  flex: 1;
  font-size: 9px !important;
  padding: 6px 8px !important;
}

/* Import/export modals */
.cp-sandbox-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
}

.cp-sandbox-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 420px;
  max-width: 600px;
}

.cp-sandbox-modal-title {
  font-family: "Press Start 2P", monospace;
  font-size: 14px;
  color: #FFEC27;
  text-shadow: 2px 2px 0 #FF77A8, 3px 3px 0 #000;
}

.cp-sandbox-modal-textarea {
  width: 100%;
  height: 200px;
  font-family: "VT323", monospace;
  font-size: 14px;
  color: #FFF1E8;
  background: #000;
  border: 1px solid rgba(41, 173, 255, 0.4);
  padding: 8px;
  resize: vertical;
}

.cp-sandbox-modal-error {
  font-family: "Press Start 2P", monospace;
  font-size: 9px;
  color: #FF004D;
}

.cp-sandbox-modal-buttons {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cyberpunk-hud.css
git commit -m "feat(sandbox): traffic panel + import/export modal CSS"
```

---

### Task 7: Landing Page SANDBOX Button

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Add SANDBOX button to the CTA row**

Find the `.cta-row` div in `src/index.html` and add the sandbox link:

```html
<div class="cta-row">
  <a class="cta" href="./levels.html">▶ INSERT COIN</a>
  <a class="cta" href="./sandbox.html" style="background: var(--pi-cyan); color: var(--pi-navy);">⚙ SANDBOX</a>
  <span class="cta-hint">— press play to begin —</span>
  <a class="credits-link" href="./credits.html">CREDITS</a>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/index.html
git commit -m "feat(sandbox): add SANDBOX button to landing page"
```

---

### Task 8: Build Verification Test

**Files:**
- Modify: `tests/unit/asset-presence.test.ts`

- [ ] **Step 1: Add sandbox.html to build presence check**

Add `"sandbox.html"` to the list of expected HTML files in the build output test. Check the existing test to see the pattern and add the entry.

- [ ] **Step 2: Run full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: All pass including the new sandbox tests

- [ ] **Step 3: Commit**

```bash
git add tests/unit/asset-presence.test.ts
git commit -m "test(sandbox): verify sandbox.html in build output"
```

---

### Task 9: Final Integration Test

- [ ] **Step 1: Manual smoke test**

Run `pnpm dev`, open `http://localhost:5173/`, click SANDBOX:

1. Board loads with client placed
2. Place a server, database, wire them: Client → Server → Database
3. Click START — packets flow
4. Adjust intensity slider — packet rate changes live
5. Click CRASH SERVER — server shows stressed/dropping
6. Click STOP — board clears, back to build phase
7. Click EXPORT — modal shows JSON with topology + traffic
8. Copy JSON, click STOP, click IMPORT, paste, click LOAD — topology rebuilds
9. Speed control (1x/2x/4x) works

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat(sandbox): complete sandbox mode MVP"
git push origin main
```
