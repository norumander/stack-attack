import { describe, it, beforeEach, expect } from "vitest";
import { ComponentDossierStore } from "../../../../src/dashboard/physics-td/dossier-store";

const KEY = "physics-td-dossiers-seen";

describe("ComponentDossierStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("a fresh store reports everything as unseen", () => {
    const s = new ComponentDossierStore();
    expect(s.hasSeen("server")).toBe(false);
    expect(s.hasSeen("anything")).toBe(false);
  });

  it("markSeen persists across a fresh store instance (localStorage round-trip)", () => {
    const first = new ComponentDossierStore();
    first.markSeen("server");
    first.markSeen("cdn");

    const second = new ComponentDossierStore();
    expect(second.hasSeen("server")).toBe(true);
    expect(second.hasSeen("cdn")).toBe(true);
    expect(second.hasSeen("database")).toBe(false);
  });

  it("clear() empties memory and localStorage", () => {
    const s = new ComponentDossierStore();
    s.markSeen("server");
    s.clear();
    expect(s.hasSeen("server")).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("corrupt JSON in localStorage falls back to an empty set", () => {
    window.localStorage.setItem(KEY, "{not valid json");
    const s = new ComponentDossierStore();
    expect(s.hasSeen("server")).toBe(false);
    // markSeen rewrites the slot with a valid JSON array.
    s.markSeen("server");
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual(["server"]);
  });

  it("uses the physics-td-dossiers-seen key (isolated from pre-physics td-dossiers-seen)", () => {
    window.localStorage.setItem("td-dossiers-seen", JSON.stringify(["server"]));
    const s = new ComponentDossierStore();
    expect(s.hasSeen("server")).toBe(false);
  });
});
