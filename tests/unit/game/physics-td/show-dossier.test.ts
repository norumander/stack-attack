import { describe, it, beforeEach, expect } from "vitest";
import { showDossier } from "../../../../src/physics-td/show-dossier";

describe("showDossier", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("appends a .cp-dossier-modal with the type's title and rows", async () => {
    const p = showDossier("server", 100);
    const modal = document.querySelector(".cp-dossier-modal");
    expect(modal).toBeTruthy();
    expect(modal!.querySelector(".cp-dossier-title")!.textContent).toBe("SERVER");
    const rowValues = Array.from(modal!.querySelectorAll(".cp-dossier-row-val")).map(
      (el) => el.textContent,
    );
    expect(rowValues).toContain("Client → Server → Database"); // wire
    expect(rowValues).toContain("$100"); // cost (not rent)
    // Dismiss so the test's promise resolves and we don't leak listeners.
    modal!.querySelector<HTMLButtonElement>(".cp-dossier-cta")!.click();
    await p;
  });

  it("CTA click resolves the promise and removes the modal", async () => {
    const p = showDossier("database", 200);
    document.querySelector<HTMLButtonElement>(".cp-dossier-cta")!.click();
    await p;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("Escape key resolves the promise and removes the modal", async () => {
    const p = showDossier("cdn", 200);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await p;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("× button resolves the promise and removes the modal", async () => {
    const p = showDossier("data_cache", 150);
    document.querySelector<HTMLButtonElement>(".cp-dossier-close")!.click();
    await p;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("falls back to an uppercase type when meta is missing", async () => {
    const p = showDossier("unknown_type", 0);
    const title = document.querySelector(".cp-dossier-title")!.textContent;
    expect(title).toBe("UNKNOWN_TYPE");
    document.querySelector<HTMLButtonElement>(".cp-dossier-cta")!.click();
    await p;
  });
});
