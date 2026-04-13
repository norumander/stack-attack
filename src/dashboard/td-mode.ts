import type { TDModeController } from "@modes/td/td-mode-controller";
import type { SimulationState } from "@core/state/simulation-state";
import type { ComponentId } from "@core/types/ids";

interface TDDashboardState {
  cursor: "idle" | "placing" | "connecting";
  placingType: string | null;
  connectingFromId: ComponentId | null;
}

export interface TDDashboard {
  refreshHud(): void;
  rerenderTopology(): void;
  destroy(): void;
}

/**
 * Wire the TD HUD DOM elements to the controller. Returns a handle for
 * cleanup (used when toggling back to sandbox mode).
 */
export function createTDDashboard(args: {
  state: SimulationState;
  controller: TDModeController;
  topologyContainer: HTMLElement;
  onPlace?: (id: ComponentId) => void;
  onConnect?: () => void;
  onPhaseChange?: () => void;
}): TDDashboard {
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

  const dash: TDDashboardState = {
    cursor: "idle",
    placingType: null,
    connectingFromId: null,
  };

  function refreshHud(): void {
    if (controller.isCampaignComplete()) {
      waveEl.textContent = "Complete";
      phaseEl.textContent = "—";
    } else {
      waveEl.textContent = `${controller.getCurrentWaveIndex() + 1} of ${controller.getWaveCount()}`;
      phaseEl.textContent = controller.getPhase().toUpperCase();
    }
    budgetEl.textContent = `$${controller.economy.getBudget()}`;
    const buildPhase = controller.getPhase() === "build";
    paletteButtons.forEach((b) => (b.disabled = !buildPhase));
    readyBtn.disabled = !buildPhase;
  }

  // === Palette click handlers ===
  function onPaletteClick(this: HTMLButtonElement) {
    if (controller.getPhase() !== "build") return;
    const type = this.dataset["type"];
    if (!type) return;
    dash.cursor = "placing";
    dash.placingType = type;
    paletteButtons.forEach((b) => b.classList.remove("placing"));
    this.classList.add("placing");
  }
  paletteButtons.forEach((btn) => btn.addEventListener("click", onPaletteClick));

  // === Topology click handler (delegated) ===
  function onTopologyClick(ev: MouseEvent): void {
    if (controller.getPhase() !== "build") return;
    const targetEl = ev.target as HTMLElement;

    // CASE 1: clicked an existing component → connect or start connecting
    const componentEl = targetEl.closest<HTMLElement>("[data-component-id]");
    if (componentEl) {
      const id = componentEl.dataset["componentId"] as ComponentId;
      if (dash.cursor === "connecting" && dash.connectingFromId !== null) {
        // Complete a connection: clicked component is the source, stored id is target
        const result = controller.tryConnect(state, id, dash.connectingFromId);
        if (result.ok) {
          args.onConnect?.();
          rerenderTopology();
        } else {
          // eslint-disable-next-line no-console
          console.warn(`tryConnect failed: ${result.reason}`, result);
        }
        dash.cursor = "idle";
        dash.connectingFromId = null;
      } else {
        // Begin connecting from this component
        dash.cursor = "connecting";
        dash.connectingFromId = id;
      }
      return;
    }

    // CASE 2: clicked empty grid cell while placing → call tryPlace
    if (dash.cursor === "placing" && dash.placingType !== null) {
      const rect = topologyContainer.getBoundingClientRect();
      const position = {
        x: Math.round((ev.clientX - rect.left) / 40), // 40px grid cell
        y: Math.round((ev.clientY - rect.top) / 40),
      };
      const result = controller.tryPlace(state, dash.placingType, position, null);
      if (result.ok) {
        args.onPlace?.(result.componentId);
        rerenderTopology();
        // Auto-enter connecting mode with the new component as the to-be-connected target
        dash.cursor = "connecting";
        dash.connectingFromId = result.componentId;
      } else {
        // eslint-disable-next-line no-console
        console.warn(`tryPlace failed: ${result.reason}`, result);
      }
      paletteButtons.forEach((b) => b.classList.remove("placing"));
      dash.placingType = null;
      return;
    }

    // CASE 3: clicked empty space in idle mode → cancel any in-progress action
    dash.cursor = "idle";
    dash.placingType = null;
    dash.connectingFromId = null;
    paletteButtons.forEach((b) => b.classList.remove("placing"));
  }

  topologyContainer.addEventListener("click", onTopologyClick);

  /**
   * Minimal DOM-based topology renderer. Removes existing children and
   * appends one element per component. Connections are not visualized in
   * Stage 3b — the data is in state.connections if a future stage wants
   * to draw SVG <line> elements.
   */
  function rerenderTopology(): void {
    while (topologyContainer.firstChild) {
      topologyContainer.removeChild(topologyContainer.firstChild);
    }
    for (const [id, comp] of state.components) {
      const el = document.createElement("div");
      el.className = "td-comp";
      el.dataset["componentId"] = id;
      el.style.position = "absolute";
      el.style.left = `${comp.position.x * 40}px`;
      el.style.top = `${comp.position.y * 40}px`;
      el.textContent = comp.type;
      topologyContainer.appendChild(el);
    }
  }

  function onReady(): void {
    if (controller.getPhase() !== "build") return;
    controller.advancePhase(state); // build → simulate
    args.onPhaseChange?.();
    refreshHud();
  }

  readyBtn.addEventListener("click", onReady);

  // Initial render
  rerenderTopology();
  refreshHud();

  return {
    refreshHud,
    rerenderTopology,
    destroy: () => {
      hudEl.hidden = true;
      topologyContainer.removeEventListener("click", onTopologyClick);
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
