import type { Sim } from "@sim/sim";
import type { ComponentId } from "@core/types/ids";
import { COMPONENT_META } from "./component-meta";
// TODO(autoscale-ux): add UX entry point to call enableAutoScale(comp) on
// an existing Server or Database — likely a right-click context menu item
// in this info panel (e.g. "Enable AutoScale"). The capability already
// handles tier bumps + cooldown; UI only needs to attach it and surface
// the current tier / "scaled" events. See src/sim/capabilities/auto-scale.ts.
import { COMPONENT_COSTS } from "./component-factory";
import { ComponentDossierStore } from "./dossier-store";
import { showDossier } from "./show-dossier";
import type { ComponentMetrics } from "./component-metrics";

export interface InfoPanelDeps {
  readonly renderer: {
    onPointerDown(cb: (ev: { hit: { componentId: ComponentId } | null }) => void): void;
  };
  readonly getSim: () => Sim;
  readonly controller: { readonly phase: string };
  readonly dossierStore: ComponentDossierStore;
  readonly hudCtrl: { showToast(message: string): void };
  readonly componentTypes: Map<ComponentId, string>;
  readonly getDrops: () => Map<ComponentId, { total: number; byReason: Map<string, number> }>;
  readonly getProcessed: () => Map<ComponentId, number>;
  /** Optional live-metrics lookup. When supplied, the panel renders a
   *  "Live" section (drops-last-1s, avg response, stress indicator). */
  readonly getMetrics?: (id: ComponentId) => ComponentMetrics;
}

export interface InfoPanelHandle {
  show(id: ComponentId): void;
  hide(): void;
  isOpen(): boolean;
  openId(): ComponentId | null;
  updateLiveStats(): void;
}

const CLIENT_ID = "client" as ComponentId;

export function bindInfoPanel(deps: InfoPanelDeps): InfoPanelHandle {
  let openId: ComponentId | null = null;

  const root = document.getElementById("td-info-panel");
  const header = document.getElementById("td-info-panel-header");
  const desc = document.getElementById("td-info-panel-description");
  const caps = document.getElementById("td-info-panel-caps") as HTMLUListElement | null;
  const stats = document.getElementById("td-info-panel-stats");
  const closeBtn = document.getElementById("td-info-panel-close");
  const detailsBtn = document.getElementById("td-info-panel-details");

  if (!root || !header || !desc || !caps || !stats || !closeBtn || !detailsBtn) {
    throw new Error("bindInfoPanel: missing one or more #td-info-panel mirror elements");
  }

  function clearChildren(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function show(id: ComponentId): void {
    const type = deps.componentTypes.get(id);
    if (!type) return;
    const meta = COMPONENT_META[type];
    if (!meta) return;
    openId = id;
    header!.textContent = meta.displayName;
    desc!.textContent = meta.description;
    clearChildren(caps!);
    for (const bullet of meta.capabilitiesHuman) {
      const li = document.createElement("li");
      li.textContent = bullet;
      caps!.appendChild(li);
    }
    clearChildren(stats!);
    root!.dataset["componentType"] = type;
    root!.hidden = false;
    updateLiveStats();
  }

  function hide(): void {
    openId = null;
    clearChildren(stats!);
    delete root!.dataset["componentType"];
    root!.hidden = true;
  }

  function isOpen(): boolean {
    return openId !== null;
  }

  function statRow(label: string, value: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "td-info-panel__stat-row";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = value;
    row.append(k, v);
    return row;
  }

  function updateLiveStats(): void {
    if (!openId) return;
    const comp = deps.getSim().components.get(openId);
    if (!comp) { hide(); return; }
    clearChildren(stats!);
    if (deps.controller.phase !== "simulate") return;
    if (comp.bucket && comp.capacityPerSecond && comp.capacityPerSecond > 0) {
      const effective = comp.getEffectiveCapacity();
      const pct = Math.max(0, Math.min(100, Math.round(100 * (1 - comp.bucket.available() / effective))));
      stats!.appendChild(statRow("Utilization", `${pct}%`));
    } else {
      stats!.appendChild(statRow("Utilization", "unbounded"));
    }
    const dropTally = deps.getDrops().get(openId)?.total ?? 0;
    stats!.appendChild(statRow("Dropped (wave)", String(dropTally)));
    const processed = deps.getProcessed().get(openId) ?? 0;
    stats!.appendChild(statRow("Processed (wave)", String(processed)));

    // Live telemetry section — only when an aggregator is wired.
    if (deps.getMetrics) {
      const m = deps.getMetrics(openId);
      stats!.appendChild(statRow("Drops (last 1s)", String(m.dropsLastSecond)));
      const avgMs = Math.round(m.avgResponseSeconds * 1000);
      stats!.appendChild(statRow("Avg response", m.avgResponseSeconds > 0 ? `${avgMs} ms` : "—"));
      if (m.stressed || m.dropping) {
        const status = m.dropping ? "DROPPING" : "STRESSED";
        const row = statRow("Status", status);
        row.classList.add(m.dropping ? "td-info-panel__stat-row--dropping" : "td-info-panel__stat-row--stressed");
        stats!.appendChild(row);
      }
    }
  }

  deps.renderer.onPointerDown((ev) => {
    if (deps.controller.phase !== "build" && deps.controller.phase !== "simulate") return;
    if (!ev.hit) {
      if (isOpen()) hide();
      return;
    }
    if (ev.hit.componentId === CLIENT_ID) {
      deps.hudCtrl.showToast("client is the entry point");
      return;
    }
    if (isOpen() && openId === ev.hit.componentId) {
      hide();
    } else {
      show(ev.hit.componentId);
    }
  });

  closeBtn!.addEventListener("click", () => { hide(); });

  detailsBtn!.addEventListener("click", async () => {
    if (!openId) return;
    const type = deps.componentTypes.get(openId);
    if (!type) return;
    const cost = COMPONENT_COSTS.get(type) ?? 0;
    await showDossier(type, cost);
    deps.dossierStore.markSeen(type);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isOpen()) hide();
  });

  return { show, hide, isOpen, openId: () => openId, updateLiveStats };
}
