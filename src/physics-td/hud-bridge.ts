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

export function showLossModal(title: string, detail: string): void {
  const modal = document.getElementById("td-loss-modal");
  if (modal) modal.removeAttribute("hidden");
  setText("td-loss-modal-title", title);
  setText("td-loss-modal-detail", detail);
}

export function hideLossModal(): void {
  const modal = document.getElementById("td-loss-modal");
  if (modal) modal.setAttribute("hidden", "");
}

export function setReadyDisabled(disabled: boolean): void {
  const btn = document.getElementById("td-ready-btn") as HTMLButtonElement | null;
  if (!btn) return;
  if (disabled) btn.setAttribute("disabled", "");
  else btn.removeAttribute("disabled");
}
