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
  { type: "data_cache", label: "Data Cache" },
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

function buildHud(): void {
  if (document.getElementById("cp-hud-root")) return;

  const root = document.createElement("div");
  root.id = "cp-hud-root";
  document.body.appendChild(root);

  buildWavePill(root);

  // Right-side column: resources → viability → briefing stacked vertically.
  // Without a shared container these panels overlap because each is
  // position:absolute with hardcoded top values that don't account for
  // each other's dynamic height (e.g. the NEXT BILL row).
  const rightCol = div("cp-right-col");
  root.append(rightCol);
  buildResourcesPanel(rightCol);
  buildViabilityPanel(rightCol);
  buildBriefingPanel(rightCol);

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

// ─── Wave pill (top-left) ─────────────────────────────────────────────

function buildWavePill(root: HTMLElement): void {
  const pill = panel("cp-wave-pill");

  const label = div("cp-label");
  label.textContent = "Signal · Active";
  pill.append(label);

  const value = div("cp-wave-value cp-mono");
  value.textContent = "01 / 05";
  pill.append(value);

  const phase = div("cp-wave-phase");
  phase.textContent = "BUILD";
  pill.append(phase);

  const progressLabel = div("cp-wave-progress-label");
  progressLabel.textContent = "Wave Progress";
  pill.append(progressLabel);

  const progressBar = div("cp-wave-progress-bar");
  const progressFill = div("cp-wave-progress-fill");
  progressBar.append(progressFill);
  pill.append(progressBar);

  root.append(pill);

  mirrorText("td-hud-wave", value, (text) => {
    const match = text.match(/(\d+)\s+of\s+(\d+)/i);
    if (!match) return text.toUpperCase();
    const current = parseInt(match[1]!, 10);
    const total = parseInt(match[2]!, 10);
    return `${String(current).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  });
  mirrorText("td-hud-phase", phase, (text) => text.toUpperCase());

  // Wave progress bar: observe the #td-status text and parse "tick X/Y"
  // from the "Wave running — tick X/Y — N resolved" status string.
  observeText("td-status", (text) => {
    const match = text.match(/tick\s+(\d+)\/(\d+)/i);
    if (match) {
      const tick = parseInt(match[1]!, 10);
      const total = parseInt(match[2]!, 10);
      const pct = total > 0 ? Math.min(100, (tick / total) * 100) : 0;
      progressFill.style.width = `${pct}%`;
      progressFill.classList.remove("cp-wave-progress-fill--drain");
    } else if (/draining queue/i.test(text)) {
      // Drain phase — past wave duration; bar pinned at 100% with pulse.
      progressFill.style.width = "100%";
      progressFill.classList.add("cp-wave-progress-fill--drain");
    } else {
      // Build / idle / placing / connecting — reset to 0%.
      progressFill.style.width = "0%";
      progressFill.classList.remove("cp-wave-progress-fill--drain");
    }
  });
}

// ─── Resources panel (top-right) ──────────────────────────────────────

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

// ─── Viability panel (right, under resources) ─────────────────────────

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

// ─── Briefing panel (right, under viability) ──────────────────────────

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

// ─── Info panel (right side, appears on component click) ──────────────

function buildInfoPanel(root: HTMLElement): void {
  const p = panel("cp-info-panel");
  p.classList.add("cp-hidden");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "cp-info-close";
  close.textContent = "×";
  p.append(close);

  const header = div("cp-info-header");
  p.append(header);

  const desc = div("cp-info-desc");
  p.append(desc);

  const capsTitle = div("cp-section-title");
  capsTitle.textContent = "Capabilities";
  p.append(capsTitle);

  const caps = document.createElement("ul");
  caps.className = "cp-info-caps";
  p.append(caps);

  const statsTitle = div("cp-section-title");
  statsTitle.textContent = "Live Stats";
  p.append(statsTitle);

  const stats = div("cp-info-stats cp-mono");
  p.append(stats);

  const details = document.createElement("button");
  details.type = "button";
  details.className = "cp-info-details-btn";
  details.textContent = "DETAILS";
  p.append(details);

  root.append(p);

  forwardClick(details, "td-info-panel-details");
  forwardClick(close, "td-info-panel-close");
  mirrorText("td-info-panel-header", header, (t) => t.toUpperCase());
  mirrorText("td-info-panel-description", desc);
  mirrorChildren("td-info-panel-caps", caps);
  mirrorChildren("td-info-panel-stats", stats);
  mirrorAttribute("td-info-panel", "hidden", (hidden) => {
    p.classList.toggle("cp-hidden", hidden);
  });
}

// ─── Palette strip (bottom-center) ────────────────────────────────────

const paletteButtons = new Map<string, HTMLButtonElement>();

function buildPaletteStrip(root: HTMLElement): void {
  paletteButtons.clear();
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

function paletteCell(entry: PaletteEntry): HTMLElement {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "cp-palette-cell";
  cell.dataset.type = entry.type;

  const icon = div("cp-palette-icon");
  icon.dataset.type = entry.type;
  cell.append(icon);

  const name = div("cp-palette-name");
  name.textContent = entry.label;
  cell.append(name);

  const cost = div("cp-palette-cost cp-mono");
  cost.textContent = "";
  cell.append(cost);

  // Extract cost from classic button text ("+ Server $100" → "$100")
  const classicBtn = document.querySelector<HTMLButtonElement>(
    `.td-palette-btn[data-type="${entry.type}"]`,
  );
  if (classicBtn) {
    const match = classicBtn.textContent?.match(/\$\d+/);
    if (match) cost.textContent = match[0];
    syncPaletteState(cell, classicBtn);
    const observer = new MutationObserver(() => syncPaletteState(cell, classicBtn));
    observer.observe(classicBtn, { attributes: true, attributeFilter: ["disabled", "class"] });
  }

  cell.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector<HTMLElement>(
      `.td-palette-btn[data-type="${entry.type}"]`,
    );
    if (target) target.click();
  });

  return cell;
}

function syncPaletteState(cell: HTMLElement, classicBtn: HTMLButtonElement): void {
  cell.classList.toggle("cp-disabled", classicBtn.disabled);
  cell.classList.toggle("cp-placing", classicBtn.classList.contains("placing"));
  const btnEl = cell as HTMLButtonElement;
  btnEl.disabled = classicBtn.disabled;
}

// ─── READY button (bottom-right) ──────────────────────────────────────

function buildReadyButton(root: HTMLElement): void {
  const btn = document.createElement("button");
  btn.id = "cp-ready-btn";
  btn.className = "cp-ready-btn";
  btn.type = "button";
  btn.textContent = "READY";
  root.append(btn);

  forwardClick(btn, "td-ready-btn");
  mirrorAttribute("td-ready-btn", "disabled", (disabled) => {
    btn.disabled = disabled;
    btn.classList.toggle("cp-disabled", disabled);
  });
}

// ─── Toast (bottom-center, above palette) ─────────────────────────────

function buildToast(root: HTMLElement): void {
  toastEl = div("cp-toast");
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  root.append(toastEl);
}

// ─── Loss modal (centered overlay) ────────────────────────────────────

function buildLossModal(root: HTMLElement): void {
  const modal = div("cp-loss-modal cp-hidden");
  const content = panel("cp-loss-content");

  const title = document.createElement("h3");
  title.className = "cp-loss-title";
  title.textContent = "Wave LOST";
  content.append(title);

  const detail = document.createElement("p");
  detail.className = "cp-loss-detail";
  content.append(detail);

  const buttons = div("cp-loss-buttons");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "cp-btn cp-btn-primary";
  retry.textContent = "Retry Wave";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "cp-btn";
  reset.textContent = "Reset Campaign";
  buttons.append(retry, reset);
  content.append(buttons);

  modal.append(content);
  root.append(modal);

  mirrorText("td-loss-modal-title", title, (t) => t.toUpperCase());
  mirrorText("td-loss-modal-detail", detail);
  mirrorAttribute("td-loss-modal", "hidden", (hidden) => {
    modal.classList.toggle("cp-hidden", hidden);
  });
  forwardClick(retry, "td-retry-btn");
  forwardClick(reset, "td-reset-btn");
}

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

// ─── Helpers ──────────────────────────────────────────────────────────

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function panel(className: string): HTMLElement {
  const p = document.createElement("div");
  p.className = `cp-panel ${className}`;
  for (const pos of ["tl", "tr", "bl", "br"] as const) {
    const c = document.createElement("span");
    c.className = `cp-corner cp-corner-${pos}`;
    p.append(c);
  }
  return p;
}

function keyLabel(text: string): HTMLElement {
  const k = div("cp-res-key");
  k.textContent = text;
  return k;
}

function mirrorText(
  sourceId: string,
  target: HTMLElement,
  transform: (text: string) => string = (t) => t,
): void {
  const source = document.getElementById(sourceId);
  if (!source) {
    requestAnimationFrame(() => mirrorText(sourceId, target, transform));
    return;
  }
  const sync = (): void => {
    target.textContent = transform(source.textContent ?? "");
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source, { childList: true, characterData: true, subtree: true });
}

/**
 * Observe the text content of a source element without writing to any target.
 * Useful when the callback drives arbitrary DOM state (style, classes) rather
 * than a simple string mirror.
 */
function observeText(sourceId: string, onChange: (text: string) => void): void {
  const source = document.getElementById(sourceId);
  if (!source) {
    requestAnimationFrame(() => observeText(sourceId, onChange));
    return;
  }
  onChange(source.textContent ?? "");
  const observer = new MutationObserver(() => onChange(source.textContent ?? ""));
  observer.observe(source, { childList: true, characterData: true, subtree: true });
}

function mirrorChildren(sourceId: string, target: HTMLElement): void {
  const source = document.getElementById(sourceId);
  if (!source) {
    requestAnimationFrame(() => mirrorChildren(sourceId, target));
    return;
  }
  const sync = (): void => {
    while (target.firstChild) target.removeChild(target.firstChild);
    for (const child of Array.from(source.childNodes)) {
      target.appendChild(child.cloneNode(true));
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source, { childList: true, characterData: true, subtree: true });
}

function mirrorAttribute(
  sourceId: string,
  attribute: string,
  callback: (hasAttribute: boolean) => void,
): void {
  const source = document.getElementById(sourceId);
  if (!source) {
    requestAnimationFrame(() => mirrorAttribute(sourceId, attribute, callback));
    return;
  }
  callback(source.hasAttribute(attribute));
  const observer = new MutationObserver(() => {
    callback(source.hasAttribute(attribute));
  });
  observer.observe(source, { attributes: true, attributeFilter: [attribute] });
}

function forwardClick(newButton: HTMLElement, targetId: string): void {
  newButton.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (target) target.click();
  });
}
