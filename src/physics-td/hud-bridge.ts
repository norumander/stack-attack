/** Pushes physics-td state into the mirror divs that cyberpunk-hud.ts observes. */

export function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function setStatus(text: string): void {
  setText("td-status", text);
}

export function setWavePill(currentWave: number, totalWaves: number): void {
  setText("td-hud-wave", `${currentWave} of ${totalWaves}`);
}

export function setPhase(phase: string): void {
  setText("td-hud-phase", phase);
}

export function setBudget(budget: number): void {
  setText("td-hud-budget", `$${budget}`);
}

export function setBriefing(title: string, body: string): void {
  setText("td-briefing-title", title);
  setText("td-briefing-traffic", body);
  setText("td-briefing-budget", "");
  setText("td-briefing-threshold", "");
  setText("td-briefing-components", "");
}

export function setReadyDisabled(disabled: boolean): void {
  const btn = document.getElementById("td-ready-btn") as HTMLButtonElement | null;
  if (!btn) return;
  if (disabled) btn.setAttribute("disabled", "");
  else btn.removeAttribute("disabled");
}

/**
 * Publish topology-validation messages into the hidden mirror container.
 * Each message becomes a `<div data-topology-error>` child so the cyberpunk
 * HUD can observe children and clone them into the visible panel.
 *
 * Passing an empty array clears the list (HUD hides the panel).
 */
export function setTopologyErrors(messages: readonly string[]): void {
  const host = document.getElementById("td-topology-errors");
  if (!host) return;
  while (host.firstChild) host.removeChild(host.firstChild);
  for (const msg of messages) {
    const row = document.createElement("div");
    row.setAttribute("data-topology-error", "");
    row.textContent = msg;
    host.appendChild(row);
  }
}
