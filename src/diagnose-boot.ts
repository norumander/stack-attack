/**
 * Diagnose Mode bootstrap. Mirrors src/physics-td/physics-td.ts in spirit
 * but scoped to a single "inherit a system" level at a time. The content
 * lane (Instagram Level 1) will depend on this framework being present.
 *
 * Intentionally kept slim: the `DIAGNOSE_LEVELS` catalogue is empty
 * today, so the runtime simply falls back to the wiring-verification
 * placeholder. Once real levels land, they are appended to the catalogue
 * and the `?level=<id>` URL param selects among them.
 */
import { PhysicsDiagnoseController } from "./diagnose/diagnose-controller";
import { COMPONENT_COSTS } from "./physics-td/component-factory";
import { resolveDiagnoseLevel } from "./diagnose/url";
import { resolveInitialSession } from "./auth-gate";
import { injectNavBar } from "./auth/index";

// Re-exported for callers/tests.
export { readDiagnoseLevelFromUrl, resolveDiagnoseLevel } from "./diagnose/url";

async function main(): Promise<void> {
  const level = resolveDiagnoseLevel(window.location.search);
  const statusEl = document.getElementById("td-status");
  if (statusEl) statusEl.textContent = `Diagnose — ${level.title}`;

  const briefingEl = document.getElementById("td-briefing-title");
  if (briefingEl) briefingEl.textContent = level.title;

  const narrativeEl = document.getElementById("td-diagnose-briefing");
  if (narrativeEl) narrativeEl.textContent = level.briefing;

  const controller = new PhysicsDiagnoseController({
    level,
    componentCosts: COMPONENT_COSTS,
    callbacks: {
      onPlaced: () => {},
      onConnected: () => {},
      onComponentDeleted: () => {},
      onConnectionDeleted: () => {},
      onBudgetChange: (b) => {
        const budgetEl = document.getElementById("td-hud-budget");
        if (budgetEl) budgetEl.textContent = `$${b}`;
      },
      onPhaseChange: (phase) => {
        const phaseEl = document.getElementById("td-hud-phase");
        if (phaseEl) phaseEl.textContent = phase;
      },
    },
  });

  controller.preplace();

  // Expose for console debugging.
  (window as unknown as { __diagnoseController: PhysicsDiagnoseController }).__diagnoseController = controller;
}

async function boot(): Promise<void> {
  const user = await resolveInitialSession();
  if (!user) {
    window.location.href = "./index.html";
    return;
  }
  injectNavBar();
  await main();
}

// Skip auto-boot during tests (jsdom) — tests exercise the pure helpers.
if (typeof window !== "undefined" && typeof document !== "undefined" && !("vitest" in globalThis)) {
  void boot();
}
