import { describe, it, expect, beforeEach } from "vitest";
import {
  activateCyberpunkHud,
  getCyberpunkHudController,
} from "../../../src/cyberpunk-hud.js";
import { setTopologyErrors } from "../../../src/physics-td/hud-bridge";

async function flushMutations(): Promise<void> {
  // MutationObserver callbacks in jsdom are queued as microtasks; a macrotask
  // hop after the microtask flush is enough to deliver them deterministically.
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

function bootHudWithMirror(): void {
  document.body.className = "";
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  // Create the hidden mirror host the HUD observes for topology errors.
  const mirror = document.createElement("div");
  mirror.id = "td-topology-errors";
  document.body.appendChild(mirror);
  window.history.replaceState(null, "", "/?renderer=iso#mode=td");
  activateCyberpunkHud();
}

describe("cyberpunk HUD — topology errors panel", () => {
  beforeEach(bootHudWithMirror);

  it("starts hidden when there are no errors", () => {
    // Controller presence confirms HUD built.
    expect(getCyberpunkHudController()).not.toBeNull();
    const panel = document.getElementById("cp-topology-errors-panel")!;
    expect(panel.classList.contains("cp-hidden")).toBe(true);
  });

  it("shows a count header and one row per error message", async () => {
    setTopologyErrors([
      "Database can't face the client directly",
      "Load Balancer has no downstream",
    ]);
    await flushMutations();
    const panel = document.getElementById("cp-topology-errors-panel")!;
    expect(panel.classList.contains("cp-hidden")).toBe(false);
    const header = document.getElementById("cp-topology-errors-header")!;
    expect(header.textContent).toBe("TOPOLOGY ERRORS (2)");
    const rows = document.querySelectorAll(".cp-topology-error-row");
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Database can't face the client");
    expect(rows[1]!.textContent).toContain("Load Balancer has no downstream");
  });

  it("re-hides itself when errors are cleared", async () => {
    setTopologyErrors(["Server has no downstream"]);
    await flushMutations();
    const panel = document.getElementById("cp-topology-errors-panel")!;
    expect(panel.classList.contains("cp-hidden")).toBe(false);
    setTopologyErrors([]);
    await flushMutations();
    expect(panel.classList.contains("cp-hidden")).toBe(true);
    const rows = document.querySelectorAll(".cp-topology-error-row");
    expect(rows.length).toBe(0);
  });

  it("replaces prior rows on update", async () => {
    setTopologyErrors(["first"]);
    await flushMutations();
    setTopologyErrors(["second", "third"]);
    await flushMutations();
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".cp-topology-error-row"),
    ).map((r) => r.textContent ?? "");
    expect(rows.length).toBe(2);
    expect(rows.some((t) => t.includes("second"))).toBe(true);
    expect(rows.some((t) => t.includes("third"))).toBe(true);
    expect(rows.some((t) => t.includes("first"))).toBe(false);
  });
});
