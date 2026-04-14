import type { TDModeController } from "@modes/td/td-mode-controller";
import type { SimulationState } from "@core/state/simulation-state";
import type { ComponentId, ConnectionId } from "@core/types/ids";
import {
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
} from "@modes/td/td-component-entries";
import type { ComponentRegistryEntry } from "@core/registry/component-registry";
import { PixiTopologyRenderer } from "./render/pixi-topology-renderer.js";
import type {
  TopologyRenderer,
  RendererPointerEvent,
} from "./render/topology-renderer.js";
import { applyTickToRenderer } from "./render/state-to-renderer.js";
import { renderBriefingCard, hideBriefingCard } from "./td/briefing-card.js";
import {
  showComponentInfoPanel,
  hideComponentInfoPanel,
  updateComponentInfoPanelStats,
  getOpenInfoPanelComponentId,
} from "./td/component-info-panel.js";

const ENTRY_BY_TYPE: Record<string, ComponentRegistryEntry> = {
  client: CLIENT_ENTRY,
  server: SERVER_ENTRY,
  database: DATABASE_ENTRY,
  cache: CACHE_ENTRY,
  load_balancer: LOAD_BALANCER_ENTRY,
};

function displayNameFor(type: string): string {
  return ENTRY_BY_TYPE[type]?.name ?? type;
}

interface TDDashboardState {
  cursor: "idle" | "placing" | "connecting";
  placingType: string | null;
  connectingFromId: ComponentId | null;
}

export interface TDDashboard {
  refreshHud(): void;
  rerenderTopology(): void;
  /** Update the in-topology status banner with running-wave info (cheap, no rerender). */
  updateRunningStatus(tickInWave: number, totalTicks: number, resolved: number): void;
  /** Per-tick: feeds the Pixi renderer from engine state. */
  applyTick(state: SimulationState, tickIntervalMs: number): void;
  destroy(): void;
}

/**
 * Wire the TD HUD DOM elements to the controller. Returns a handle for
 * cleanup (used when toggling back to sandbox mode).
 */
export async function createTDDashboard(args: {
  state: SimulationState;
  controller: TDModeController;
  topologyContainer: HTMLElement;
  onPlace?: (id: ComponentId) => void;
  onConnect?: (connectionId: ConnectionId) => void;
  onPhaseChange?: () => void;
}): Promise<TDDashboard> {
  const { state, controller, topologyContainer } = args;

  const hudEl = requireElement("td-hud");
  const waveEl = requireElement("td-hud-wave");
  const phaseEl = requireElement("td-hud-phase");
  const budgetEl = requireElement("td-hud-budget");
  const readyBtn = requireElement("td-ready-btn") as HTMLButtonElement;
  const paletteButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".td-palette-btn"),
  );

  hudEl.hidden = false;
  topologyContainer.classList.add("td-mode");

  const dash: TDDashboardState = {
    cursor: "idle",
    placingType: null,
    connectingFromId: null,
  };

  // ─── Pixi renderer bootstrap ──────────────────────────────────────────
  const renderer: TopologyRenderer = new PixiTopologyRenderer();
  await renderer.mount(topologyContainer);

  // Minimal DOM status banner stacked above the canvas.
  const statusEl = document.createElement("div");
  statusEl.className = "td-status";
  statusEl.style.position = "absolute";
  statusEl.style.top = "8px";
  statusEl.style.left = "8px";
  statusEl.style.pointerEvents = "none";
  statusEl.style.zIndex = "10";
  topologyContainer.appendChild(statusEl);

  function setStatusText(): void {
    if (controller.getPhase() === "simulate") {
      statusEl.textContent = "Wave running…";
    } else if (controller.getPhase() === "assess") {
      statusEl.textContent = "Assessing wave…";
    } else if (dash.cursor === "placing" && dash.placingType !== null) {
      statusEl.textContent = `Placing ${displayNameFor(dash.placingType)} — click an empty cell`;
    } else if (dash.cursor === "connecting") {
      const fromComp = dash.connectingFromId
        ? state.components.get(dash.connectingFromId)
        : null;
      const fromName = fromComp ? displayNameFor(fromComp.type) : "?";
      statusEl.textContent = `Connecting from ${fromName} — click another component to wire it`;
    } else if (controller.getPhase() === "build") {
      statusEl.textContent =
        "Click a palette button or click a component to start a connection";
    } else {
      statusEl.textContent = `Phase: ${controller.getPhase().toUpperCase()}`;
    }
  }

  /** Seed or re-sync the renderer from current state. Idempotent. */
  function seedRendererFromState(): void {
    // Walk the render's components aren't exposed; we track via our own set.
    // Simplest correct: destroy+recreate every tick. Instead, we keep a set of
    // ids currently in the renderer and diff.
    const desiredComponents = new Set<ComponentId>(state.components.keys());
    const desiredConnections = new Set<ConnectionId>(state.connections.keys());

    for (const id of seededComponentIds) {
      if (!desiredComponents.has(id)) {
        renderer.removeComponent(id);
      }
    }
    for (const id of seededConnectionIds) {
      if (!desiredConnections.has(id)) {
        renderer.removeConnection(id);
      }
    }
    seededComponentIds.clear();
    seededConnectionIds.clear();

    for (const [id, comp] of state.components) {
      renderer.addComponent(id, {
        type: comp.type,
        displayName: displayNameFor(comp.type),
        gridPosition: { x: comp.position.x, y: comp.position.y },
      });
      seededComponentIds.add(id);
    }
    for (const [id, conn] of state.connections) {
      renderer.addConnection(id, conn.source.componentId, conn.target.componentId);
      seededConnectionIds.add(id);
    }
  }

  const seededComponentIds = new Set<ComponentId>();
  const seededConnectionIds = new Set<ConnectionId>();

  // Seed initial state (Client was placed before createTDDashboard ran).
  seedRendererFromState();

  function refreshHud(): void {
    const complete = controller.isCampaignComplete();
    if (complete) {
      waveEl.textContent = "Complete";
      phaseEl.textContent = "—";
      hideBriefingCard();
    } else {
      waveEl.textContent = `${controller.getCurrentWaveIndex() + 1} of ${controller.getWaveCount()}`;
      phaseEl.textContent = controller.getPhase().toUpperCase();
      if (controller.getPhase() === "build") {
        renderBriefingCard(controller.getCurrentWave());
      } else {
        hideBriefingCard();
      }
    }
    budgetEl.textContent = `$${controller.economy.getBudget()}`;
    const actionable = !complete && controller.getPhase() === "build";
    paletteButtons.forEach((b) => (b.disabled = !actionable));
    readyBtn.disabled = !actionable;
    setStatusText();
  }

  // ─── Palette click handlers ────────────────────────────────────────────
  function onPaletteClick(this: HTMLButtonElement) {
    if (controller.getPhase() !== "build") return;
    const type = this.dataset["type"];
    if (!type) return;
    dash.cursor = "placing";
    dash.placingType = type;
    dash.connectingFromId = null;
    renderer.setSelected(null);
    paletteButtons.forEach((b) => b.classList.remove("placing"));
    this.classList.add("placing");
    setStatusText();
  }
  paletteButtons.forEach((btn) => btn.addEventListener("click", onPaletteClick));

  // ─── Pointer events (delegated through the Pixi renderer) ─────────────
  const unsubPointerDown = renderer.onPointerDown((ev: RendererPointerEvent) => {
    if (controller.getPhase() !== "build") {
      // eslint-disable-next-line no-console
      console.warn("[td] pointer ignored — phase is", controller.getPhase());
      return;
    }

    // CASE 1: clicked an existing component
    if (ev.hit) {
      const id = ev.hit.componentId;
      // eslint-disable-next-line no-console
      console.warn("[td] component click", id, "cursor=", dash.cursor);
      if (dash.cursor === "connecting" && dash.connectingFromId !== null) {
        const result = controller.tryConnect(state, dash.connectingFromId, id);
        if (result.ok) {
          const conn = state.connections.get(result.connectionId);
          if (conn) {
            renderer.addConnection(
              result.connectionId,
              conn.source.componentId,
              conn.target.componentId,
            );
            seededConnectionIds.add(result.connectionId);
          }
          // eslint-disable-next-line no-console
          console.warn("[td] tryConnect ok", result.connectionId);
          args.onConnect?.(result.connectionId);
        } else {
          // eslint-disable-next-line no-console
          console.warn("[td] tryConnect failed:", result.reason, result);
        }
        dash.cursor = "idle";
        dash.connectingFromId = null;
        renderer.setSelected(null);
        setStatusText();
      } else {
        dash.cursor = "connecting";
        dash.connectingFromId = id;
        renderer.setSelected(id);
        showComponentInfoPanel(id, state);
        setStatusText();
        // eslint-disable-next-line no-console
        console.warn("[td] connecting from", id);
      }
      return;
    }

    // CASE 2: empty cell while placing → tryPlace
    if (dash.cursor === "placing" && dash.placingType !== null) {
      const grid = renderer.screenToGrid(ev.screenX, ev.screenY);
      const result = controller.tryPlace(state, dash.placingType, grid, null);
      if (result.ok) {
        const comp = state.components.get(result.componentId);
        if (comp) {
          renderer.addComponent(result.componentId, {
            type: comp.type,
            displayName: displayNameFor(comp.type),
            gridPosition: { x: comp.position.x, y: comp.position.y },
          });
          seededComponentIds.add(result.componentId);
        }
        // eslint-disable-next-line no-console
        console.warn("[td] tryPlace ok", result.componentId, "at", grid);
        args.onPlace?.(result.componentId);
      } else {
        // eslint-disable-next-line no-console
        console.warn("[td] tryPlace failed:", result.reason, result);
      }
      dash.cursor = "idle";
      dash.placingType = null;
      paletteButtons.forEach((b) => b.classList.remove("placing"));
      renderer.setPlacementGhost(null, null);
      setStatusText();
      return;
    }

    // CASE 3: empty space in idle/connecting → cancel
    if (dash.cursor === "connecting") {
      // eslint-disable-next-line no-console
      console.warn("[td] connecting cancelled (clicked empty)");
    }
    dash.cursor = "idle";
    dash.placingType = null;
    dash.connectingFromId = null;
    paletteButtons.forEach((b) => b.classList.remove("placing"));
    renderer.setSelected(null);
    renderer.setPlacementGhost(null, null);
    setStatusText();
  });

  const unsubPointerMove = renderer.onPointerMove((ev: RendererPointerEvent) => {
    if (dash.cursor === "placing" && dash.placingType !== null) {
      renderer.setPlacementGhost(dash.placingType, { x: ev.screenX, y: ev.screenY });
    }
  });

  /**
   * Sync the renderer to engine state. Called after retry (main.ts replays
   * actions against state directly, bypassing the pointerdown handler).
   */
  function rerenderTopology(): void {
    seedRendererFromState();
    setStatusText();
  }

  function onReady(): void {
    if (controller.getPhase() !== "build") return;
    controller.advancePhase(state);
    args.onPhaseChange?.();
    refreshHud();
  }
  readyBtn.addEventListener("click", onReady);

  function updateRunningStatus(
    tickInWave: number,
    totalTicks: number,
    resolved: number,
  ): void {
    if (tickInWave <= totalTicks) {
      statusEl.textContent = `Wave running — tick ${tickInWave}/${totalTicks} — ${resolved} resolved`;
    } else {
      const drainTicks = tickInWave - totalTicks;
      statusEl.textContent = `Draining queue (+${drainTicks} past wave duration) — ${resolved} resolved`;
    }
  }

  function applyTick(stateArg: SimulationState, tickIntervalMs: number): void {
    applyTickToRenderer(stateArg, renderer, tickIntervalMs);
    const openId = getOpenInfoPanelComponentId();
    if (openId) {
      const metrics = stateArg.metricsHistory[stateArg.metricsHistory.length - 1] ?? null;
      updateComponentInfoPanelStats(openId, stateArg, metrics);
    }
  }

  // Info panel close button — wire once per dashboard instance.
  const infoCloseBtn = document.getElementById("td-info-panel-close");
  const onInfoClose = () => hideComponentInfoPanel();
  infoCloseBtn?.addEventListener("click", onInfoClose);

  // Initial render
  refreshHud();

  return {
    refreshHud,
    rerenderTopology,
    updateRunningStatus,
    applyTick,
    destroy: () => {
      hudEl.hidden = true;
      topologyContainer.classList.remove("td-mode");
      hideBriefingCard();
      hideComponentInfoPanel();
      infoCloseBtn?.removeEventListener("click", onInfoClose);
      unsubPointerDown();
      unsubPointerMove();
      renderer.destroy();
      if (statusEl.parentElement === topologyContainer) {
        topologyContainer.removeChild(statusEl);
      }
      readyBtn.removeEventListener("click", onReady);
      paletteButtons.forEach((btn) => btn.removeEventListener("click", onPaletteClick));
    },
  };
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`TD dashboard: missing required element #${id}`);
  return el;
}
