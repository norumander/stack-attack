import { describe, it, expect, beforeEach } from "vitest";
import { ComponentDossierStore } from "../../../src/dashboard/td/component-dossier.js";

describe("ComponentDossierStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts empty when localStorage has nothing", () => {
    const store = new ComponentDossierStore();
    expect(store.hasSeen("server")).toBe(false);
  });

  it("markSeen persists to localStorage", () => {
    const store = new ComponentDossierStore();
    store.markSeen("server");
    expect(store.hasSeen("server")).toBe(true);

    const restored = new ComponentDossierStore();
    expect(restored.hasSeen("server")).toBe(true);
  });

  it("markSeen is idempotent", () => {
    const store = new ComponentDossierStore();
    store.markSeen("server");
    store.markSeen("server");
    expect(store.hasSeen("server")).toBe(true);
  });

  it("clear removes persisted state", () => {
    const store = new ComponentDossierStore();
    store.markSeen("server");
    store.markSeen("database");
    store.clear();
    expect(store.hasSeen("server")).toBe(false);

    const restored = new ComponentDossierStore();
    expect(restored.hasSeen("server")).toBe(false);
    expect(restored.hasSeen("database")).toBe(false);
  });

  it("tolerates corrupt localStorage without throwing", () => {
    window.localStorage.setItem("td-dossiers-seen", "not-json{{");
    expect(() => new ComponentDossierStore()).not.toThrow();
    expect(new ComponentDossierStore().hasSeen("server")).toBe(false);
  });
});
