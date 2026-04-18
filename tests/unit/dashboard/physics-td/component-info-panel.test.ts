import { describe, it, beforeEach, expect, vi } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { ProcessingCapability } from "@sim/capabilities/processing";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { bindInfoPanel } from "../../../../src/dashboard/physics-td/component-info-panel";
import { ComponentDossierStore } from "../../../../src/dashboard/physics-td/dossier-store";
import * as ShowDossier from "../../../../src/dashboard/physics-td/show-dossier";
import type { ComponentId } from "@core/types/ids";

// Build the mirror-div fixture programmatically — never use innerHTML.
function mountMirrors(): void {
  document.body.replaceChildren();
  const panel = document.createElement("div");
  panel.id = "td-info-panel";
  panel.hidden = true;

  const closeBtn = document.createElement("button");
  closeBtn.id = "td-info-panel-close";
  closeBtn.textContent = "×";
  panel.appendChild(closeBtn);

  const header = document.createElement("div");
  header.id = "td-info-panel-header";
  panel.appendChild(header);

  const desc = document.createElement("div");
  desc.id = "td-info-panel-description";
  panel.appendChild(desc);

  const caps = document.createElement("ul");
  caps.id = "td-info-panel-caps";
  panel.appendChild(caps);

  const stats = document.createElement("div");
  stats.id = "td-info-panel-stats";
  panel.appendChild(stats);

  const detailsBtn = document.createElement("button");
  detailsBtn.id = "td-info-panel-details";
  detailsBtn.textContent = "DETAILS";
  panel.appendChild(detailsBtn);

  document.body.appendChild(panel);
}

// Minimal fake renderer: records the onPointerDown handler so tests can invoke it.
function makeFakeRenderer() {
  const subscribers: Array<(ev: { hit: { componentId: ComponentId } | null }) => void> = [];
  return {
    subscribers,
    onPointerDown(cb: (ev: { hit: { componentId: ComponentId } | null }) => void): void {
      subscribers.push(cb);
    },
  };
}

describe("bindInfoPanel", () => {
  beforeEach(() => {
    mountMirrors();
    window.localStorage.clear();
  });

  function setup() {
    const sim = new Sim({ seed: 1 });
    const db = new SimComponent({
      id: "db1" as ComponentId,
      capabilities: [new ProcessingCapability({ revenuePerWrite: 1, revenuePerRead: 1 })],
      capacityPerSecond: 30,
    });
    const srv = new SimComponent({
      id: "s1" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    sim.addComponent(db);
    sim.addComponent(srv);
    const componentTypes = new Map<ComponentId, string>([
      ["db1" as ComponentId, "database"],
      ["s1" as ComponentId, "server"],
    ]);
    const dossierStore = new ComponentDossierStore();
    const perComponentDrops = new Map<ComponentId, { total: number; byReason: Map<string, number> }>();
    const perComponentProcessed = new Map<ComponentId, number>();
    const controller = { phase: "build" as "build" | "simulate" | "won" | "lost" };
    const renderer = makeFakeRenderer();
    const toasts: string[] = [];
    const hudCtrl = { showToast: (m: string) => toasts.push(m) };
    const handle = bindInfoPanel({
      renderer,
      getSim: () => sim,
      controller,
      dossierStore,
      hudCtrl,
      componentTypes,
      getDrops: () => perComponentDrops,
      getProcessed: () => perComponentProcessed,
    });
    return { handle, sim, controller, dossierStore, toasts, renderer, perComponentDrops, perComponentProcessed };
  }

  it("show(id) writes header / description / caps to the mirror divs and unsets hidden", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    expect(document.getElementById("td-info-panel-header")!.textContent).toBe("Database");
    expect(document.getElementById("td-info-panel-description")!.textContent).toContain("Persistent store");
    const bullets = Array.from(document.querySelectorAll("#td-info-panel-caps li")).map((li) => li.textContent);
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets[0]).toContain("Stores data");
    expect(document.getElementById("td-info-panel")!.hidden).toBe(false);
    expect(document.getElementById("td-info-panel")!.dataset.componentType).toBe("database");
  });

  it("hide() sets hidden = true and clears dataset + stats", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    handle.hide();
    expect(document.getElementById("td-info-panel")!.hidden).toBe(true);
    expect(document.getElementById("td-info-panel")!.dataset.componentType).toBeUndefined();
    expect(document.getElementById("td-info-panel-stats")!.children.length).toBe(0);
  });

  it("updateLiveStats renders utilization / dropped / processed rows with real values during simulate", () => {
    const { handle, controller, perComponentDrops, perComponentProcessed, sim } = setup();
    handle.show("db1" as ComponentId);
    controller.phase = "simulate";
    perComponentDrops.set("db1" as ComponentId, {
      total: 7,
      byReason: new Map([["overloaded", 7]]),
    });
    perComponentProcessed.set("db1" as ComponentId, 23);
    sim.components.get("db1" as ComponentId)!.bucket!.tryConsume(18);
    handle.updateLiveStats();
    const labels = Array.from(document.querySelectorAll("#td-info-panel-stats .k")).map((el) => el.textContent);
    const values = Array.from(document.querySelectorAll("#td-info-panel-stats .v")).map((el) => el.textContent);
    expect(labels).toContain("Utilization");
    expect(labels).toContain("Dropped (wave)");
    expect(labels).toContain("Processed (wave)");
    expect(values).toContain("7");
    expect(values).toContain("23");
    // Utilization = 100 * (1 - 12/30) = 60%.
    expect(values).toContain("60%");
  });

  it("updateLiveStats renders nothing during build phase", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    handle.updateLiveStats();
    expect(document.getElementById("td-info-panel-stats")!.children.length).toBe(0);
  });

  it("updateLiveStats renders 'unbounded' when component has no capacity bucket", () => {
    const { handle, controller } = setup();
    handle.show("s1" as ComponentId);
    controller.phase = "simulate";
    handle.updateLiveStats();
    const values = Array.from(document.querySelectorAll("#td-info-panel-stats .v")).map((el) => el.textContent);
    expect(values).toContain("unbounded");
  });

  it("DETAILS button click invokes showDossier + markSeen for the open type", async () => {
    const spy = vi.spyOn(ShowDossier, "showDossier").mockResolvedValue();
    const { handle, dossierStore } = setup();
    handle.show("db1" as ComponentId);
    document.getElementById("td-info-panel-details")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledWith("database", expect.any(Number));
    expect(dossierStore.hasSeen("database")).toBe(true);
    spy.mockRestore();
  });

  it("close button click hides the panel", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    document.getElementById("td-info-panel-close")!.click();
    expect(handle.isOpen()).toBe(false);
    expect(document.getElementById("td-info-panel")!.hidden).toBe(true);
  });

  it("Escape key hides the panel when it's open", () => {
    const { handle } = setup();
    handle.show("db1" as ComponentId);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(handle.isOpen()).toBe(false);
  });

  it("click on client id toasts and does not open", () => {
    const { renderer, toasts, handle } = setup();
    renderer.subscribers[0]!({ hit: { componentId: "client" as ComponentId } });
    expect(toasts[0]).toContain("entry point");
    expect(handle.isOpen()).toBe(false);
  });

  it("click on the same component toggles closed", () => {
    const { renderer, handle } = setup();
    renderer.subscribers[0]!({ hit: { componentId: "db1" as ComponentId } });
    expect(handle.isOpen()).toBe(true);
    renderer.subscribers[0]!({ hit: { componentId: "db1" as ComponentId } });
    expect(handle.isOpen()).toBe(false);
  });

  it("click on a different component swaps content", () => {
    const { renderer, handle } = setup();
    renderer.subscribers[0]!({ hit: { componentId: "db1" as ComponentId } });
    expect(handle.openId()).toBe("db1");
    renderer.subscribers[0]!({ hit: { componentId: "s1" as ComponentId } });
    expect(handle.openId()).toBe("s1");
    expect(document.getElementById("td-info-panel-header")!.textContent).toBe("Server");
  });

  it("click on empty canvas (null hit) closes", () => {
    const { renderer, handle } = setup();
    renderer.subscribers[0]!({ hit: { componentId: "db1" as ComponentId } });
    renderer.subscribers[0]!({ hit: null });
    expect(handle.isOpen()).toBe(false);
  });
});
