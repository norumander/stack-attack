/**
 * Traffic control panel for Sandbox mode.
 *
 * Builds sliders and buttons into the HUD's right column.
 * Pure DOM — no Pixi, no sim dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrafficSettings {
  intensity: number;       // 10-200
  writeRatio: number;      // 0-1
  authRatio: number;       // 0-1
  streamRatio: number;     // 0-1
  largeRatio: number;      // 0-1
  asyncRatio: number;      // 0-1
  keyKind: "uniform" | "zipf";
  zipfAlpha: number;       // 1.0-2.0
  spaceSize: number;       // fixed at 200
}

export interface TrafficPanelHandle {
  readonly settings: TrafficSettings;
  onStart(cb: () => void): void;
  onStop(cb: () => void): void;
  onCrashServer(cb: () => void): void;
  onSeverConnection(cb: () => void): void;
  onExport(cb: () => void): void;
  onImport(cb: () => void): void;
  onChange(cb: () => void): void;
  applySettings(s: Partial<TrafficSettings>): void;
  setRunning(running: boolean): void;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildTrafficPanel(container: HTMLElement): TrafficPanelHandle {
  // Mutable settings object — mutated in-place on slider changes.
  const settings: TrafficSettings = {
    intensity: 60,
    writeRatio: 0,
    authRatio: 0,
    streamRatio: 0,
    largeRatio: 0,
    asyncRatio: 0,
    keyKind: "uniform",
    zipfAlpha: 1.0,
    spaceSize: 200,
  };

  // Callback registries
  const startCbs: Array<() => void> = [];
  const stopCbs: Array<() => void> = [];
  const crashServerCbs: Array<() => void> = [];
  const severConnectionCbs: Array<() => void> = [];
  const exportCbs: Array<() => void> = [];
  const importCbs: Array<() => void> = [];
  const changeCbs: Array<() => void> = [];

  function fireChange(): void {
    for (const cb of changeCbs) cb();
  }

  // ---------------------------------------------------------------------------
  // Root panel
  // ---------------------------------------------------------------------------

  const panel = document.createElement("div");
  panel.className = "cp-traffic-panel cp-panel";

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  const title = document.createElement("div");
  title.className = "cp-traffic-title";
  title.textContent = "TRAFFIC";
  panel.appendChild(title);

  // ---------------------------------------------------------------------------
  // START / STOP toggle
  // ---------------------------------------------------------------------------

  let isRunning = false;

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "cp-traffic-toggle";
  toggleBtn.textContent = "START";
  toggleBtn.addEventListener("click", () => {
    if (isRunning) {
      for (const cb of stopCbs) cb();
    } else {
      for (const cb of startCbs) cb();
    }
  });
  panel.appendChild(toggleBtn);

  // ---------------------------------------------------------------------------
  // Slider helper
  // ---------------------------------------------------------------------------

  /**
   * Build a labelled slider row.
   * Returns the <input type="range"> element so callers can sync it via
   * applySettings().
   *
   * @param label     Display label
   * @param min       Range minimum
   * @param max       Range maximum
   * @param step      Range step
   * @param initial   Initial value
   * @param display   Format the current value for the inline display span
   * @param onChange  Called with the raw numeric input value on change
   */
  function makeSliderRow(
    label: string,
    min: number,
    max: number,
    step: number,
    initial: number,
    display: (v: number) => string,
    onChange: (v: number) => void,
  ): { row: HTMLElement; input: HTMLInputElement; valSpan: HTMLSpanElement } {
    const row = document.createElement("div");
    row.className = "cp-traffic-row";

    const labelEl = document.createElement("label");
    labelEl.className = "cp-traffic-label";

    const labelText = document.createTextNode(label + " ");
    labelEl.appendChild(labelText);

    const valSpan = document.createElement("span");
    valSpan.className = "cp-traffic-val";
    valSpan.textContent = display(initial);
    labelEl.appendChild(valSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.className = "cp-traffic-slider";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);

    input.addEventListener("input", () => {
      const v = Number(input.value);
      valSpan.textContent = display(v);
      onChange(v);
      fireChange();
    });

    row.appendChild(labelEl);
    row.appendChild(input);

    return { row, input, valSpan };
  }

  // ---------------------------------------------------------------------------
  // Sliders
  // ---------------------------------------------------------------------------

  const intensitySlider = makeSliderRow(
    "INTENSITY", 10, 200, 5, settings.intensity,
    (v) => String(v),
    (v) => { settings.intensity = v; },
  );
  panel.appendChild(intensitySlider.row);

  const writeSlider = makeSliderRow(
    "WRITE %", 0, 100, 1, Math.round(settings.writeRatio * 100),
    (v) => `${v}%`,
    (v) => { settings.writeRatio = v / 100; },
  );
  panel.appendChild(writeSlider.row);

  const authSlider = makeSliderRow(
    "AUTH %", 0, 100, 1, Math.round(settings.authRatio * 100),
    (v) => `${v}%`,
    (v) => { settings.authRatio = v / 100; },
  );
  panel.appendChild(authSlider.row);

  const streamSlider = makeSliderRow(
    "STREAM %", 0, 100, 1, Math.round(settings.streamRatio * 100),
    (v) => `${v}%`,
    (v) => { settings.streamRatio = v / 100; },
  );
  panel.appendChild(streamSlider.row);

  const largeSlider = makeSliderRow(
    "LARGE %", 0, 100, 1, Math.round(settings.largeRatio * 100),
    (v) => `${v}%`,
    (v) => { settings.largeRatio = v / 100; },
  );
  panel.appendChild(largeSlider.row);

  const asyncSlider = makeSliderRow(
    "ASYNC %", 0, 100, 1, Math.round(settings.asyncRatio * 100),
    (v) => `${v}%`,
    (v) => { settings.asyncRatio = v / 100; },
  );
  panel.appendChild(asyncSlider.row);

  // ---------------------------------------------------------------------------
  // Key distribution dropdown + Zipf alpha slider
  // ---------------------------------------------------------------------------

  const keyRow = document.createElement("div");
  keyRow.className = "cp-traffic-row";

  const keySelect = document.createElement("select");
  keySelect.className = "cp-traffic-select";

  const uniformOpt = document.createElement("option");
  uniformOpt.value = "uniform";
  uniformOpt.textContent = "Uniform";
  keySelect.appendChild(uniformOpt);

  const zipfOpt = document.createElement("option");
  zipfOpt.value = "zipf";
  zipfOpt.textContent = "Zipf";
  keySelect.appendChild(zipfOpt);

  keySelect.value = settings.keyKind;
  keyRow.appendChild(keySelect);
  panel.appendChild(keyRow);

  // Zipf alpha row — shown only when Zipf is selected.
  // Integer range 10-20, displayed as /10 (1.0-2.0).
  const zipfRow = makeSliderRow(
    "ZIPF α", 10, 20, 1, Math.round(settings.zipfAlpha * 10),
    (v) => (v / 10).toFixed(1),
    (v) => { settings.zipfAlpha = v / 10; },
  );
  zipfRow.row.style.display = "none";
  panel.appendChild(zipfRow.row);

  keySelect.addEventListener("change", () => {
    const val = keySelect.value as "uniform" | "zipf";
    settings.keyKind = val;
    zipfRow.row.style.display = val === "zipf" ? "" : "none";
    fireChange();
  });

  // ---------------------------------------------------------------------------
  // CHAOS section
  // ---------------------------------------------------------------------------

  const chaosSection = document.createElement("div");
  chaosSection.className = "cp-traffic-chaos";

  const crashBtn = document.createElement("button");
  crashBtn.className = "cp-traffic-chaos-btn cp-win-cta cp-win-cta--secondary";
  crashBtn.textContent = "CRASH SERVER";
  crashBtn.addEventListener("click", () => {
    for (const cb of crashServerCbs) cb();
  });

  const severBtn = document.createElement("button");
  severBtn.className = "cp-traffic-chaos-btn cp-win-cta cp-win-cta--secondary";
  severBtn.textContent = "SEVER WIRE";
  severBtn.addEventListener("click", () => {
    for (const cb of severConnectionCbs) cb();
  });

  chaosSection.appendChild(crashBtn);
  chaosSection.appendChild(severBtn);
  panel.appendChild(chaosSection);

  // ---------------------------------------------------------------------------
  // I/O section
  // ---------------------------------------------------------------------------

  const ioSection = document.createElement("div");
  ioSection.className = "cp-traffic-io";

  const exportBtn = document.createElement("button");
  exportBtn.className = "cp-win-cta cp-win-cta--secondary";
  exportBtn.textContent = "EXPORT";
  exportBtn.addEventListener("click", () => {
    for (const cb of exportCbs) cb();
  });

  const importBtn = document.createElement("button");
  importBtn.className = "cp-win-cta cp-win-cta--secondary";
  importBtn.textContent = "IMPORT";
  importBtn.addEventListener("click", () => {
    for (const cb of importCbs) cb();
  });

  ioSection.appendChild(exportBtn);
  ioSection.appendChild(importBtn);
  panel.appendChild(ioSection);

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------

  container.appendChild(panel);

  // ---------------------------------------------------------------------------
  // Handle implementation
  // ---------------------------------------------------------------------------

  function setRunning(running: boolean): void {
    isRunning = running;
    toggleBtn.textContent = running ? "STOP" : "START";
    if (running) {
      toggleBtn.classList.add("cp-traffic-toggle--running");
    } else {
      toggleBtn.classList.remove("cp-traffic-toggle--running");
    }
  }

  function applySettings(s: Partial<TrafficSettings>): void {
    if (s.intensity !== undefined) {
      settings.intensity = s.intensity;
      intensitySlider.input.value = String(s.intensity);
      intensitySlider.valSpan.textContent = String(s.intensity);
    }
    if (s.writeRatio !== undefined) {
      settings.writeRatio = s.writeRatio;
      const pct = Math.round(s.writeRatio * 100);
      writeSlider.input.value = String(pct);
      writeSlider.valSpan.textContent = `${pct}%`;
    }
    if (s.authRatio !== undefined) {
      settings.authRatio = s.authRatio;
      const pct = Math.round(s.authRatio * 100);
      authSlider.input.value = String(pct);
      authSlider.valSpan.textContent = `${pct}%`;
    }
    if (s.streamRatio !== undefined) {
      settings.streamRatio = s.streamRatio;
      const pct = Math.round(s.streamRatio * 100);
      streamSlider.input.value = String(pct);
      streamSlider.valSpan.textContent = `${pct}%`;
    }
    if (s.largeRatio !== undefined) {
      settings.largeRatio = s.largeRatio;
      const pct = Math.round(s.largeRatio * 100);
      largeSlider.input.value = String(pct);
      largeSlider.valSpan.textContent = `${pct}%`;
    }
    if (s.asyncRatio !== undefined) {
      settings.asyncRatio = s.asyncRatio;
      const pct = Math.round(s.asyncRatio * 100);
      asyncSlider.input.value = String(pct);
      asyncSlider.valSpan.textContent = `${pct}%`;
    }
    if (s.keyKind !== undefined) {
      settings.keyKind = s.keyKind;
      keySelect.value = s.keyKind;
      zipfRow.row.style.display = s.keyKind === "zipf" ? "" : "none";
    }
    if (s.zipfAlpha !== undefined) {
      settings.zipfAlpha = s.zipfAlpha;
      const intVal = Math.round(s.zipfAlpha * 10);
      zipfRow.input.value = String(intVal);
      zipfRow.valSpan.textContent = s.zipfAlpha.toFixed(1);
    }
    // spaceSize is fixed at 200 — silently accept but keep it 200.
    if (s.spaceSize !== undefined) {
      settings.spaceSize = 200;
    }
  }

  return {
    get settings() { return settings; },
    onStart(cb) { startCbs.push(cb); },
    onStop(cb) { stopCbs.push(cb); },
    onCrashServer(cb) { crashServerCbs.push(cb); },
    onSeverConnection(cb) { severConnectionCbs.push(cb); },
    onExport(cb) { exportCbs.push(cb); },
    onImport(cb) { importCbs.push(cb); },
    onChange(cb) { changeCbs.push(cb); },
    applySettings,
    setRunning,
  };
}
