import type { TDModeController } from "@modes/td/td-mode-controller";
import type { SimulationState } from "@core/state/simulation-state";
import type { ComponentId, ConnectionId } from "@core/types/ids";
import {
  CLIENT_ENTRY,
  SERVER_ENTRY,
  DATABASE_ENTRY,
  DATA_CACHE_ENTRY,
  LOAD_BALANCER_ENTRY,
} from "@modes/td/td-component-entries";
import type { ComponentRegistryEntry } from "@core/registry/component-registry";
import { createRenderer } from "./render/renderer-factory.js";
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
import { getCyberpunkHudController } from "./cyberpunk-hud.js";

const ENTRY_BY_TYPE: Record<string, ComponentRegistryEntry> = {
  client: CLIENT_ENTRY,
  server: SERVER_ENTRY,
  database: DATABASE_ENTRY,
  data_cache: DATA_CACHE_ENTRY,
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
  onDisconnect?: (info: { connectionId: ConnectionId; sourceId: ComponentId; targetId: ComponentId }) => void;
  onRemove?: (componentId: ComponentId) => void;
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
  const renderer: TopologyRenderer = createRenderer();
  await renderer.mount(topologyContainer);

  // Minimal DOM status banner stacked above the canvas.
  const statusEl = document.createElement("div");
  statusEl.className = "td-status";
  statusEl.id = "td-status";
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

  /**
   * Seed or re-sync the renderer from current state. Idempotent.
   *
   * True diff: only removes orphaned renderer elements and only adds
   * missing ones. Leaves existing elements alone. Previously this cleared
   * the tracking sets and re-added everything, which duplicated Pixi
   * containers because the renderer's `addComponent` isn't idempotent —
   * a second call with the same id creates a new container without
   * destroying the old one, orphaning it on the layer.
   */
  function seedRendererFromState(): void {
    // Remove orphans (tracked but no longer in state).
    for (const id of seededComponentIds) {
      if (!state.components.has(id)) {
        renderer.removeComponent(id);
        seededComponentIds.delete(id);
      }
    }
    for (const id of seededConnectionIds) {
      if (!state.connections.has(id)) {
        renderer.removeConnection(id);
        seededConnectionIds.delete(id);
      }
    }

    // Add missing (in state but not yet tracked).
    for (const [id, comp] of state.components) {
      if (seededComponentIds.has(id)) continue;
      renderer.addComponent(id, {
        type: comp.type,
        displayName: displayNameFor(comp.type),
        gridPosition: { x: comp.position.x, y: comp.position.y },
      });
      seededComponentIds.add(id);
    }
    for (const [id, conn] of state.connections) {
      if (seededConnectionIds.has(id)) continue;
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
    // Filter palette by wave.availableComponents. Buttons for locked types
    // are hidden entirely so the player doesn't see future waves' components
    // before they're unlocked. `tryPlace` would reject placement with
    // `disallowed_by_mode` anyway, but that only surfaces as a console
    // warning — the button would appear enabled and click-to-no-op.
    const availableTypes = complete
      ? new Set<string>()
      : new Set(controller.getCurrentWave().availableComponents);
    paletteButtons.forEach((b) => {
      const type = b.dataset["type"] ?? "";
      const allowed = availableTypes.has(type);
      b.hidden = !allowed;
      b.disabled = !actionable || !allowed;
    });
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
        renderer.setConnectionMode(false);
        setStatusText();
      } else {
        dash.cursor = "connecting";
        dash.connectingFromId = id;
        renderer.setSelected(id);
        renderer.setConnectionMode(true);
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
    renderer.setConnectionMode(false);
    setStatusText();
  });

  const unsubPointerMove = renderer.onPointerMove((ev: RendererPointerEvent) => {
    if (dash.cursor === "placing" && dash.placingType !== null) {
      renderer.setPlacementGhost(dash.placingType, { x: ev.screenX, y: ev.screenY });
    }
  });

  const unsubConnectionDown = renderer.onConnectionPointerDown((connectionId: ConnectionId) => {
    if (controller.getPhase() !== "build") return;
    // Capture source/target BEFORE tryDisconnect removes the connection from state.
    const conn = state.connections.get(connectionId);
    if (!conn) return;
    const sourceId = conn.source.componentId;
    const targetId = conn.target.componentId;
    const result = controller.tryDisconnect(state, connectionId);
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn("[td] tryDisconnect failed:", result.reason);
      return;
    }
    renderer.removeConnection(connectionId);
    seededConnectionIds.delete(connectionId);
    args.onDisconnect?.({ connectionId, sourceId, targetId });
    setStatusText();
  });

  const unsubDragEnd = renderer.onComponentDragEnd(({ componentId, gridPosition }) => {
    const comp = state.components.get(componentId);
    if (!comp) return;

    const revert = (): void => {
      renderer.updateComponent(componentId, {
        gridPosition: { x: comp.position.x, y: comp.position.y },
      });
    };

    if (controller.getPhase() !== "build") {
      revert();
      return;
    }
    // No-op if the position didn't actually change.
    if (comp.position.x === gridPosition.x && comp.position.y === gridPosition.y) {
      revert();
      return;
    }
    // Collision check — don't overlap other components.
    for (const other of state.components.values()) {
      if (other.id === componentId) continue;
      if (other.position.x === gridPosition.x && other.position.y === gridPosition.y) {
        revert();
        return;
      }
    }
    // Commit the move on the game model. Renderer already shows the new cell.
    comp.position = gridPosition;
  });

  /**
   * Keyboard affordance: Delete / Backspace removes the currently selected
   * component during the build phase. Cascades to all connected wires.
   */
  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    if (controller.getPhase() !== "build") return;
    if (dash.cursor !== "connecting" || dash.connectingFromId === null) return;

    const removedId = dash.connectingFromId;
    const result = controller.tryRemove(state, removedId);
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn("[td] tryRemove failed:", result.reason);
      return;
    }

    // Diff-sync renderer to state (cascaded connections already gone from state)
    seedRendererFromState();

    // Reset selection state
    dash.cursor = "idle";
    dash.connectingFromId = null;
    renderer.setSelected(null);
    hideComponentInfoPanel();

    // Refresh HUD so budget shows the refund
    refreshHud();

    // Fire callback so main.ts can log the action
    args.onRemove?.(removedId);

    // eslint-disable-next-line no-console
    console.warn("[td] deleted component", removedId, "refund=$" + result.refund, "disconnected=" + result.disconnectedCount);
  }
  document.addEventListener("keydown", onKeyDown);

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

    // Slice B: atomic rent pre-flight. Runs BEFORE advancePhase.
    const rent = controller.payRent(state);
    if (!rent.ok) {
      const hud = getCyberpunkHudController();
      const msg =
        `Rent due: $${rent.bill}. You only have $${rent.budget}. ` +
        `Scrap a component to reduce the bill.`;
      if (hud) {
        hud.showToast(msg);
      } else {
        // Classic (deprecated) path: fall back to an alert so the player
        // at least sees the block.
        // eslint-disable-next-line no-alert
        window.alert(msg);
      }
      return;
    }

    controller.advancePhase(state);

    // Topology validation is advisory — surface any warnings but continue.
    const errors = controller.getTopologyErrors();
    if (errors.length > 0) {
      const hud = getCyberpunkHudController();
      if (hud) {
        const summary = errors
          .map((e) => `${e.reason} (${e.requestType} @ ${e.componentType})`)
          .join(" · ");
        hud.showToast(`Topology warning: ${summary}`);
      }
    }

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
      document.removeEventListener("keydown", onKeyDown);
      unsubPointerDown();
      unsubPointerMove();
      unsubConnectionDown();
      unsubDragEnd();
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
