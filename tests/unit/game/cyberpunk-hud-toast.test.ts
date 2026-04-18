import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
} from "../../../src/dashboard/cyberpunk-hud.js";

function bootHud(): void {
  document.body.className = "";
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  window.history.replaceState(null, "", "/?renderer=iso#mode=td");
  activateCyberpunkHud();
}

describe("CyberpunkHudController.showToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bootHud();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast and hides it after 3s", () => {
    const hud = getCyberpunkHudController()!;
    hud.showToast("Rent due: $160. You only have $80.");
    const toast = document.querySelector<HTMLElement>(".cp-toast")!;
    expect(toast.textContent).toContain("Rent due");
    expect(toast.classList.contains("cp-toast--visible")).toBe(true);
    vi.advanceTimersByTime(3100);
    expect(toast.classList.contains("cp-toast--visible")).toBe(false);
  });

  it("replaces an earlier toast on re-call", () => {
    const hud = getCyberpunkHudController()!;
    hud.showToast("first");
    vi.advanceTimersByTime(1000);
    hud.showToast("second");
    const toast = document.querySelector<HTMLElement>(".cp-toast")!;
    expect(toast.textContent).toBe("second");
    expect(toast.classList.contains("cp-toast--visible")).toBe(true);
  });
});
