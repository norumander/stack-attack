/** Cyberpunk HUD — full-screen overlay for the physics TD renderer. */

import type { BriefingDisplay } from "./physics-td/briefing-text.js";

export interface CyberpunkHudController {
  updateBriefing(display: BriefingDisplay): void;
  hideBriefing(): void;
  updateViability(v: { value: number; fraction: number }): void;
  updateNextBill(bill: number | null): void;
  showToast(message: string): void;
  /** Returns palette button elements keyed by component type — used for NEW badges and click interception. */
  getPaletteButtons(): ReadonlyMap<string, HTMLButtonElement>;
  /** Show/hide the zone selector and set available zones. */
  setZones(zones: ReadonlyArray<string>): void;
  /** Returns the currently selected zone, or undefined for "no zone". */
  getSelectedZone(): string | undefined;
  /** Called whenever a zone button is clicked. Use for zone reassignment of selected components. */
  onZoneClick(cb: (zone: string | undefined) => void): void;
  /** Current sim speed multiplier (0.25, 0.5, 1, 2). */
  getSimSpeed(): number;
}

interface PaletteEntry {
  readonly type: string;
  readonly label: string;
}

// Labels with a newline wrap onto two lines inside the palette cell
// (CSS `white-space: pre-line` on .cp-palette-name respects \n). Keeps
// multi-word components legible without resizing every cell.
const PALETTE: readonly PaletteEntry[] = [
  { type: "server", label: "Server" },
  { type: "database", label: "Database" },
  { type: "data_cache", label: "Data\nCache" },
  { type: "edge_cache", label: "Edge\nCache" },
  { type: "load_balancer", label: "Balancer" },
  { type: "cdn", label: "CDN" },
  { type: "api_gateway", label: "Gateway" },
  { type: "queue", label: "Queue" },
  { type: "worker", label: "Worker" },
  { type: "streaming_server", label: "Streaming" },
  { type: "blob_storage", label: "Blob\nStorage" },
  { type: "dns_gtm", label: "DNS\n/ GTM" },
  { type: "circuit_breaker", label: "Circuit\nBreaker" },
  { type: "edge_router", label: "Edge\nRouter" },
];

let hudController: CyberpunkHudController | null = null;

/** Returns the HUD controller once the HUD has been built. Null before activation. */
export function getCyberpunkHudController(): CyberpunkHudController | null {
  return hudController;
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
  buildBackButton(root);

  // Right-side column: resources → viability → briefing stacked vertically.
  // Without a shared container these panels overlap because each is
  // position:absolute with hardcoded top values that don't account for
  // each other's dynamic height (e.g. the NEXT BILL row).
  const rightCol = div("cp-right-col");
  root.append(rightCol);
  buildResourcesPanel(rightCol);
  buildViabilityPanel(rightCol);
  buildBriefingPanel(rightCol);
  buildTopologyErrorsPanel(rightCol);

  buildInfoPanel(root);
  buildPaletteStrip(root);
  buildActionBar(root);
  buildToast(root);
  installLeftPanelMutex();

  hudController = {
    updateBriefing,
    hideBriefing,
    updateViability,
    updateNextBill,
    showToast,
    getPaletteButtons: () => paletteButtons,
    setZones: setZonesImpl,
    getSelectedZone: () => selectedZone,
    onZoneClick: (cb) => { zoneClickCallbacks.push(cb); },
    getSimSpeed: () => simSpeed,
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

// ─── Back to levels button (top-left, under wave pill) ───────────────

function buildBackButton(root: HTMLElement): void {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cp-back-btn";
  btn.textContent = "< BACK";
  root.append(btn);

  btn.addEventListener("click", () => {
    // Remove any existing dialog first.
    document.querySelector(".cp-back-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "cp-back-overlay";

    const modal = document.createElement("div");
    modal.className = "cp-back-modal cp-panel";

    const title = document.createElement("h2");
    title.className = "cp-back-title";
    title.textContent = "LEAVE GAME?";
    modal.appendChild(title);

    const msg = document.createElement("div");
    msg.className = "cp-back-msg";
    msg.textContent = "Your progress on the current run will be lost.";
    modal.appendChild(msg);

    const buttons = document.createElement("div");
    buttons.className = "cp-back-buttons";

    const leaveBtn = document.createElement("button");
    leaveBtn.type = "button";
    leaveBtn.className = "cp-win-cta";
    leaveBtn.textContent = "LEAVE";
    leaveBtn.addEventListener("click", () => {
      window.location.href = "./levels.html";
    });

    const stayBtn = document.createElement("button");
    stayBtn.type = "button";
    stayBtn.className = "cp-win-cta cp-win-cta--secondary";
    stayBtn.textContent = "STAY";
    stayBtn.addEventListener("click", () => overlay.remove());

    buttons.appendChild(leaveBtn);
    buttons.appendChild(stayBtn);
    modal.appendChild(buttons);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    stayBtn.focus();
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

  // Header row: VIABILITY label on the left, percentage readout on the right.
  // Keeps the bar free to span the full panel width below.
  const header = div("cp-viability-header");
  const label = div("cp-res-key");
  label.textContent = "VIABILITY";
  header.append(label);
  viabilityReadout = div("cp-viability-readout cp-mono");
  viabilityReadout.textContent = "100%";
  header.append(viabilityReadout);
  p.append(header);

  const bar = div("cp-viability-bar");
  viabilityFill = div("cp-viability-fill cp-viability-fill--green");
  viabilityFill.style.width = "100%";
  bar.append(viabilityFill);
  p.append(bar);

  root.append(p);
}

// ─── Briefing panel (right, under viability) ──────────────────────────

function buildBriefingPanel(root: HTMLElement): void {
  const p = panel("cp-briefing cp-hidden");
  p.id = "cp-briefing-panel";

  briefingTitle = div("cp-briefing-title");
  briefingTitle.textContent = "";
  p.append(briefingTitle);

  // Scrollable contents — narrative + briefing rows. Title stays anchored
  // above so "WAVE N — NAME" is always visible even when the objective text
  // is long enough to overflow the height cap.
  const scroll = div("cp-briefing-scroll");

  briefingNarrative = div("cp-briefing-narrative cp-hidden");
  scroll.append(briefingNarrative);

  const body = div("cp-briefing-body");

  const loadRow = briefingCustomRow(body, "Incoming");
  briefingLoadDots = div("cp-briefing-load-dots cp-mono");
  briefingLoadLabel = div("cp-briefing-load-label");
  loadRow.append(briefingLoadDots, briefingLoadLabel);

  briefingTraffic = briefingValueRow(body, "Traffic");
  briefingObjective = briefingValueRow(body, "Objective");
  briefingReward = briefingValueRow(body, "Reward");

  scroll.append(body);
  p.append(scroll);
  root.append(p);
}

// ─── Topology errors panel (right column, below briefing) ────────────
// Shows a compact list of pre-sim validator errors so the player sees
// WHY the current topology will fail before pressing READY. Hidden when
// the topology is valid.

function buildTopologyErrorsPanel(root: HTMLElement): void {
  const p = panel("cp-topology-errors cp-hidden");
  p.id = "cp-topology-errors-panel";

  const header = div("cp-topology-errors-header");
  header.id = "cp-topology-errors-header";
  header.textContent = "TOPOLOGY ERRORS";
  p.append(header);

  const list = div("cp-topology-errors-list");
  list.id = "cp-topology-errors-list";
  p.append(list);

  root.append(p);

  // Observe the hidden mirror div — each child (data-topology-error) is one
  // error message. Re-render the list + update the header count on change.
  const source = document.getElementById("td-topology-errors");
  const sync = (): void => {
    const rows = source
      ? Array.from(source.querySelectorAll<HTMLElement>("[data-topology-error]"))
      : [];
    while (list.firstChild) list.removeChild(list.firstChild);
    if (rows.length === 0) {
      p.classList.add("cp-hidden");
      header.textContent = "TOPOLOGY ERRORS";
      return;
    }
    p.classList.remove("cp-hidden");
    header.textContent = `TOPOLOGY ERRORS (${rows.length})`;
    for (const row of rows) {
      const item = div("cp-topology-error-row");
      const dot = document.createElement("span");
      dot.className = "cp-topology-error-dot";
      dot.textContent = "!";
      item.append(dot);
      const text = document.createElement("span");
      text.className = "cp-topology-error-text";
      text.textContent = row.textContent ?? "";
      item.append(text);
      list.append(item);
    }
  };
  if (!source) {
    requestAnimationFrame(() => buildTopologyErrorsPanel_rebind(p, header, list));
    return;
  }
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source, { childList: true, subtree: true, characterData: true });
}

function buildTopologyErrorsPanel_rebind(
  p: HTMLElement,
  header: HTMLElement,
  list: HTMLElement,
): void {
  const source = document.getElementById("td-topology-errors");
  if (!source) {
    requestAnimationFrame(() => buildTopologyErrorsPanel_rebind(p, header, list));
    return;
  }
  const sync = (): void => {
    const rows = Array.from(source.querySelectorAll<HTMLElement>("[data-topology-error]"));
    while (list.firstChild) list.removeChild(list.firstChild);
    if (rows.length === 0) {
      p.classList.add("cp-hidden");
      header.textContent = "TOPOLOGY ERRORS";
      return;
    }
    p.classList.remove("cp-hidden");
    header.textContent = `TOPOLOGY ERRORS (${rows.length})`;
    for (const row of rows) {
      const item = div("cp-topology-error-row");
      const dot = document.createElement("span");
      dot.className = "cp-topology-error-dot";
      dot.textContent = "!";
      item.append(dot);
      const text = document.createElement("span");
      text.className = "cp-topology-error-text";
      text.textContent = row.textContent ?? "";
      item.append(text);
      list.append(item);
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source, { childList: true, subtree: true, characterData: true });
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

  // Scrollable contents — description, capabilities, live stats. Title +
  // close stay fixed above; the DETAILS button stays pinned below. Max-height
  // on the panel plus flex layout forces this middle region to scroll when
  // component descriptions are long (keeps the panel from colliding with the
  // bottom-left tutor drawer or the top-left wave pill).
  const scroll = div("cp-info-scroll");

  const desc = div("cp-info-desc");
  scroll.append(desc);

  const capsTitle = div("cp-section-title");
  capsTitle.textContent = "Capabilities";
  scroll.append(capsTitle);

  const caps = document.createElement("ul");
  caps.className = "cp-info-caps";
  scroll.append(caps);

  const statsTitle = div("cp-section-title");
  statsTitle.textContent = "Live Stats";
  scroll.append(statsTitle);

  const stats = div("cp-info-stats cp-mono");
  scroll.append(stats);

  p.append(scroll);

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

// ─── Zone selector (above palette, only visible for multi-zone waves) ─

const ZONE_LABELS: Record<string, string> = {
  zone_na: "NA",
  zone_eu: "EU",
  zone_ap: "AP",
};

let zoneBar: HTMLElement | null = null;
let selectedZone: string | undefined;
let zoneButtons: HTMLButtonElement[] = [];
let zoneClickCallbacks: Array<(zone: string | undefined) => void> = [];

function buildZoneBar(root: HTMLElement): void {
  zoneBar = div("cp-zone-bar cp-hidden");

  const label = div("cp-zone-bar-label");
  label.textContent = "ZONE";
  zoneBar.append(label);

  const btnGroup = div("cp-zone-btn-group");
  zoneBar.append(btnGroup);

  // "None" button for unzoned placement
  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "cp-zone-btn cp-zone-btn--active";
  noneBtn.textContent = "—";
  noneBtn.title = "No zone (local)";
  noneBtn.addEventListener("click", () => selectZone(undefined));
  btnGroup.append(noneBtn);
  zoneButtons.push(noneBtn);

  root.append(zoneBar);
}

function setZonesImpl(zones: ReadonlyArray<string>): void {
  if (!zoneBar) return;
  // Remove old zone buttons (keep the "none" button at index 0)
  while (zoneButtons.length > 1) {
    const btn = zoneButtons.pop()!;
    btn.remove();
  }
  if (zones.length === 0) {
    zoneBar.classList.add("cp-hidden");
    selectedZone = undefined;
    return;
  }
  zoneBar.classList.remove("cp-hidden");
  const btnGroup = zoneBar.querySelector(".cp-zone-btn-group")!;
  for (const zone of zones) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cp-zone-btn";
    btn.textContent = ZONE_LABELS[zone] ?? zone;
    btn.dataset.zone = zone;
    btn.addEventListener("click", () => selectZone(zone));
    btnGroup.append(btn);
    zoneButtons.push(btn);
  }
  selectZone(undefined);
}

function selectZone(zone: string | undefined): void {
  selectedZone = zone;
  for (const btn of zoneButtons) {
    const isActive = btn.dataset.zone === zone || (!btn.dataset.zone && zone === undefined);
    btn.classList.toggle("cp-zone-btn--active", isActive);
  }
  for (const cb of zoneClickCallbacks) cb(zone);
}

// ─── Palette strip (bottom-center) ────────────────────────────────────

const paletteButtons = new Map<string, HTMLButtonElement>();

const PALETTE_PAGE_SIZE = 8;

function buildPaletteStrip(root: HTMLElement): void {
  paletteButtons.clear();
  const strip = div("cp-palette");

  const label = div("cp-palette-header");
  label.textContent = "COMPONENT PALETTE";
  strip.append(label);

  buildZoneBar(strip);

  // Row = [prev] [cells] [next]. Pagination caps the horizontal width at
  // PALETTE_PAGE_SIZE cells and cycles the rest behind the arrow buttons.
  const row = div("cp-palette-row");
  strip.append(row);

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "cp-palette-page-btn";
  prevBtn.textContent = "<";
  prevBtn.setAttribute("aria-label", "Previous palette page");
  row.append(prevBtn);

  const cells = div("cp-palette-cells");
  row.append(cells);

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "cp-palette-page-btn";
  nextBtn.textContent = ">";
  nextBtn.setAttribute("aria-label", "Next palette page");
  row.append(nextBtn);

  // Build every cell up front so boot-time wiring can look up paletteButtons
  // by type regardless of which page a cell is on. Cells beyond the first
  // page are hidden via inline `display: none`; clones from cloneNode inherit
  // the style so the hidden state survives boot-level `replaceWith` swaps.
  for (const entry of PALETTE) {
    const cell = paletteCell(entry);
    cells.append(cell);
    paletteButtons.set(entry.type, cell as HTMLButtonElement);
  }

  const totalPages = Math.max(1, Math.ceil(PALETTE.length / PALETTE_PAGE_SIZE));
  let currentPage = 0;

  const renderPage = (): void => {
    const start = currentPage * PALETTE_PAGE_SIZE;
    const end = start + PALETTE_PAGE_SIZE;
    Array.from(cells.children).forEach((child, i) => {
      (child as HTMLElement).style.display = i >= start && i < end ? "" : "none";
    });
    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = currentPage >= totalPages - 1;
  };

  prevBtn.addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage -= 1;
      renderPage();
    }
  });
  nextBtn.addEventListener("click", () => {
    if (currentPage < totalPages - 1) {
      currentPage += 1;
      renderPage();
    }
  });

  renderPage();

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
    // Hide costs in sandbox mode (budget mirror shows "∞").
    const budgetMirror = document.getElementById("td-hud-budget");
    const isSandbox = budgetMirror?.textContent?.trim() === "∞";
    if (!isSandbox) {
      const match = classicBtn.textContent?.match(/\$\d+/);
      if (match) cost.textContent = match[0];
    }
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

// ─── Action bar (bottom-right) — wraps SPEED + READY in one chunky
// pico-8 orange container so they read as a single "wave controls" unit. ──

function buildActionBar(root: HTMLElement): void {
  const bar = div("cp-action-bar");
  buildSpeedControl(bar);
  buildReadyButton(bar);
  root.append(bar);
}

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

// ─── Speed control (bottom-right, above READY) ───────────────────────

const SPEED_OPTIONS: ReadonlyArray<{ label: string; multiplier: number }> = [
  { label: "1x", multiplier: 0.125 },
  { label: "2x", multiplier: 0.5 },
  { label: "4x", multiplier: 2 },
];
let simSpeed = 0.125;

function buildSpeedControl(root: HTMLElement): void {
  const bar = div("cp-speed-bar");

  const label = div("cp-speed-label");
  label.textContent = "SPEED";
  bar.append(label);

  const btnGroup = div("cp-speed-btn-group");
  bar.append(btnGroup);

  const buttons: HTMLButtonElement[] = [];
  for (const opt of SPEED_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cp-speed-btn";
    if (opt.multiplier === simSpeed) btn.classList.add("cp-speed-btn--active");
    btn.textContent = opt.label;
    btn.dataset.speed = String(opt.multiplier);
    btn.addEventListener("click", () => {
      simSpeed = opt.multiplier;
      for (const b of buttons) {
        b.classList.toggle("cp-speed-btn--active", b.dataset.speed === String(opt.multiplier));
      }
    });
    btnGroup.append(btn);
    buttons.push(btn);
  }

  root.append(bar);
}

// ─── Toast (bottom-center, above palette) ─────────────────────────────

function buildToast(root: HTMLElement): void {
  toastEl = div("cp-toast");
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  root.append(toastEl);
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

/**
 * Left-side panel mutex: the AI tutor drawer (bottom-left) and the component
 * info panel (left side) share screen space. Whichever opens last closes the
 * other.
 *
 * The tutor is mounted by the host (physics-td / diagnose-boot / sandbox-boot)
 * after the HUD builds, so we poll briefly for `.cp-chatbot` before attaching
 * the observer. The info panel lives in the DOM from boot via its mirror div.
 */
function installLeftPanelMutex(): void {
  const classicInfoPanel = document.getElementById("td-info-panel");
  if (!classicInfoPanel) return;

  const closeInfoPanel = (): void => {
    // Forward via the classic close button so component-info-panel.ts
    // runs its own hide path (clears selection, updates state, etc).
    document.getElementById("td-info-panel-close")?.click();
  };
  const closeTutor = (): void => {
    const tutor = document.querySelector(".cp-chatbot");
    if (!tutor || !tutor.classList.contains("cp-chatbot--open")) return;
    tutor.classList.remove("cp-chatbot--open");
    tutor.classList.add("cp-chatbot--closed");
  };

  // Wait for the chatbot to mount, then observe its open class.
  const waitForTutor = (attempts = 40): void => {
    const tutor = document.querySelector(".cp-chatbot");
    if (!tutor) {
      if (attempts > 0) window.setTimeout(() => waitForTutor(attempts - 1), 200);
      return;
    }
    new MutationObserver(() => {
      if (tutor.classList.contains("cp-chatbot--open")) closeInfoPanel();
    }).observe(tutor, { attributes: true, attributeFilter: ["class"] });
  };
  waitForTutor();

  // When the info panel transitions from hidden → visible, close the tutor.
  new MutationObserver(() => {
    if (!classicInfoPanel.hasAttribute("hidden")) closeTutor();
  }).observe(classicInfoPanel, { attributes: true, attributeFilter: ["hidden"] });
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
