import { describe, it, expect, beforeEach } from "vitest";
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
} from "../../../src/cyberpunk-hud.js";

function bootHud(): void {
  document.body.className = "";
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  window.history.replaceState(null, "", "/?renderer=iso#mode=td");
  activateCyberpunkHud();
}

describe("CyberpunkHudController.updateViability", () => {
  beforeEach(bootHud);

  it("renders a green fill at 100%", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateViability({ value: 100, fraction: 1 });
    const fill = document.querySelector<HTMLElement>(".cp-viability-fill")!;
    expect(fill.style.width).toBe("100.0%");
    expect(fill.classList.contains("cp-viability-fill--green")).toBe(true);
  });

  it("switches to amber at 40%", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateViability({ value: 40, fraction: 0.4 });
    const fill = document.querySelector<HTMLElement>(".cp-viability-fill")!;
    expect(fill.classList.contains("cp-viability-fill--amber")).toBe(true);
    expect(fill.classList.contains("cp-viability-fill--green")).toBe(false);
  });

  it("switches to red + low pulse at 10%", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateViability({ value: 10, fraction: 0.1 });
    const fill = document.querySelector<HTMLElement>(".cp-viability-fill")!;
    const panel = document.querySelector<HTMLElement>(".cp-viability")!;
    expect(fill.classList.contains("cp-viability-fill--red")).toBe(true);
    expect(panel.classList.contains("cp-viability--low")).toBe(true);
  });

  it("clamps fractions outside [0,1]", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateViability({ value: -10, fraction: -0.5 });
    const fill = document.querySelector<HTMLElement>(".cp-viability-fill")!;
    expect(fill.style.width).toBe("0.0%");
  });
});
