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

describe("CyberpunkHudController.updateNextBill", () => {
  beforeEach(bootHud);

  it("shows and writes a dollar amount", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateNextBill(160);
    const row = document.querySelector<HTMLElement>(".cp-res-next-bill")!;
    expect(row.classList.contains("cp-hidden")).toBe(false);
    expect(row.querySelector(".cp-res-val")!.textContent).toBe("$160");
  });

  it("hides the row when bill is null", () => {
    const hud = getCyberpunkHudController()!;
    hud.updateNextBill(160);
    hud.updateNextBill(null);
    const row = document.querySelector<HTMLElement>(".cp-res-next-bill")!;
    expect(row.classList.contains("cp-hidden")).toBe(true);
  });
});
