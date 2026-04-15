import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { showDossier } from "../../../src/dashboard/td/component-dossier.js";

function clearBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe("showDossier modal", () => {
  beforeEach(clearBody);
  afterEach(clearBody);

  it("builds a dialog with the dossier title, wire, handles, rent, and tip", async () => {
    const done = showDossier("server", 80);
    const modal = document.querySelector<HTMLElement>(".cp-dossier-modal");
    expect(modal).not.toBeNull();
    expect(modal!.getAttribute("role")).toBe("dialog");

    const text = modal!.textContent ?? "";
    expect(text).toContain("SERVER");
    expect(text).toContain("Client → Server → Database");
    expect(text).toContain("Read requests");
    expect(text).toContain("$80");
    expect(text).toContain("GOT IT, PLACE IT");

    // Dismiss via CTA
    const cta = modal!.querySelector<HTMLButtonElement>(".cp-dossier-cta")!;
    cta.click();
    await done;

    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("dismisses on Escape", async () => {
    const done = showDossier("database", 80);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await done;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("dismisses on the X button", async () => {
    const done = showDossier("server", 80);
    const close = document.querySelector<HTMLButtonElement>(".cp-dossier-close")!;
    close.click();
    await done;
    expect(document.querySelector(".cp-dossier-modal")).toBeNull();
  });

  it("uses a fallback label if the type has no dossier", async () => {
    const done = showDossier("unknown_type", 0);
    const modal = document.querySelector<HTMLElement>(".cp-dossier-modal")!;
    expect(modal.textContent).toContain("UNKNOWN_TYPE");
    modal.querySelector<HTMLButtonElement>(".cp-dossier-cta")!.click();
    await done;
  });
});
