import { describe, it, expect, beforeEach } from "vitest";
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
} from "../../../src/dashboard/cyberpunk-hud.js";
import { renderBriefing } from "../../../src/dashboard/td/briefing-text.js";
import { WAVE_1 } from "../../../src/modes/td/td-waves.js";
import { getNarrative } from "../../../src/dashboard/td/wave-narrative.js";

function bootHud(): void {
  document.body.className = "";
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  window.history.replaceState(null, "", "/?renderer=iso#mode=td");
  activateCyberpunkHud();
}

describe("CyberpunkHudController.updateBriefing", () => {
  beforeEach(bootHud);

  it("writes Wave 1 title, narrative, load, traffic, objective, reward", () => {
    const hud = getCyberpunkHudController()!;
    const display = renderBriefing(WAVE_1);
    const waveNarrative = getNarrative(1);
    hud.updateBriefing({ ...display, ...(waveNarrative !== undefined ? { narrative: waveNarrative } : {}) });

    const panel = document.getElementById("cp-briefing-panel")!;
    expect(panel.classList.contains("cp-hidden")).toBe(false);

    const title = panel.querySelector(".cp-briefing-title")!;
    expect(title.textContent).toBe("LAUNCH DAY");

    const narrativeEl = panel.querySelector(".cp-briefing-narrative")!;
    expect(narrativeEl.textContent).toContain("trickle of users");

    const dots = panel.querySelector(".cp-briefing-load-dots")!;
    expect(dots.textContent).toBe("●○○○○");

    const text = panel.textContent ?? "";
    expect(text).toContain("LIGHT");
    expect(text).toContain("A handful of readers");
    expect(text).toContain("Survive 30 ticks");
    expect(text).toContain("$1 per user served");
  });

  it("hides the briefing on demand", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateBriefing(renderBriefing(WAVE_1));
    hud.hideBriefing();
    expect(
      document.getElementById("cp-briefing-panel")!.classList.contains("cp-hidden"),
    ).toBe(true);
  });
});
