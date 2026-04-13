import type { TDModeController } from "@modes/td/td-mode-controller";
import type { SimulationState } from "@core/state/simulation-state";
import type { ComponentId, ConnectionId } from "@core/types/ids";

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
  onConnect?: (connectionId: ConnectionId) => void;
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
  topologyContainer.classList.add("td-mode");

  const dash: TDDashboardState = {
    cursor: "idle",
    placingType: null,
    connectingFromId: null,
  };

  function refreshHud(): void {
    const complete = controller.isCampaignComplete();
    if (complete) {
      waveEl.textContent = "Complete";
      phaseEl.textContent = "—";
    } else {
      waveEl.textContent = `${controller.getCurrentWaveIndex() + 1} of ${controller.getWaveCount()}`;
      phaseEl.textContent = controller.getPhase().toUpperCase();
    }
    budgetEl.textContent = `$${controller.economy.getBudget()}`;
    // Palette + READY are only actionable during a wave's build phase.
    // Lock them both during simulate/assess and after the campaign is complete.
    const actionable = !complete && controller.getPhase() === "build";
    paletteButtons.forEach((b) => (b.disabled = !actionable));
    readyBtn.disabled = !actionable;
  }

  // === Palette click handlers ===
  function onPaletteClick(this: HTMLButtonElement) {
    if (controller.getPhase() !== "build") return;
    const type = this.dataset["type"];
    if (!type) return;
    dash.cursor = "placing";
    dash.placingType = type;
    dash.connectingFromId = null;
    paletteButtons.forEach((b) => b.classList.remove("placing"));
    this.classList.add("placing");
    rerenderTopology();
  }
  paletteButtons.forEach((btn) => btn.addEventListener("click", onPaletteClick));

  // === Topology click handler (delegated) ===
  function onTopologyClick(ev: MouseEvent): void {
    if (controller.getPhase() !== "build") {
      // eslint-disable-next-line no-console
      console.warn("[td] topology click ignored — phase is", controller.getPhase());
      return;
    }
    const targetEl = ev.target as HTMLElement;

    // CASE 1: clicked an existing component → connect or start connecting
    const componentEl = targetEl.closest<HTMLElement>("[data-component-id]");
    if (componentEl) {
      const id = componentEl.dataset["componentId"] as ComponentId;
      // eslint-disable-next-line no-console
      console.warn("[td] component click", id, "cursor=", dash.cursor);
      if (dash.cursor === "connecting" && dash.connectingFromId !== null) {
        // Complete a connection. The convention: connectingFromId is the SOURCE
        // (set when the user clicked the first component), the just-clicked
        // component is the TARGET.
        const result = controller.tryConnect(state, dash.connectingFromId, id);
        if (result.ok) {
          // eslint-disable-next-line no-console
          console.warn("[td] tryConnect ok", result.connectionId);
          args.onConnect?.(result.connectionId);
        } else {
          // eslint-disable-next-line no-console
          console.warn("[td] tryConnect failed:", result.reason, result);
        }
        dash.cursor = "idle";
        dash.connectingFromId = null;
        rerenderTopology();
      } else {
        // Begin connecting from this component
        dash.cursor = "connecting";
        dash.connectingFromId = id;
        // eslint-disable-next-line no-console
        console.warn("[td] connecting from", id, "— click another component to connect");
        rerenderTopology();
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
        // eslint-disable-next-line no-console
        console.warn("[td] tryPlace ok", result.componentId, "at", position);
        args.onPlace?.(result.componentId);
      } else {
        // eslint-disable-next-line no-console
        console.warn("[td] tryPlace failed:", result.reason, result);
      }
      // Return to idle after placement. The user clicks two components
      // explicitly to draw a connection — no implicit auto-connect.
      dash.cursor = "idle";
      dash.placingType = null;
      paletteButtons.forEach((b) => b.classList.remove("placing"));
      rerenderTopology();
      return;
    }

    // CASE 3: clicked empty space in idle mode → cancel any in-progress action
    if (dash.cursor === "connecting") {
      // eslint-disable-next-line no-console
      console.warn("[td] connecting cancelled (clicked empty)");
    }
    dash.cursor = "idle";
    dash.placingType = null;
    dash.connectingFromId = null;
    paletteButtons.forEach((b) => b.classList.remove("placing"));
    rerenderTopology();
  }

  topologyContainer.addEventListener("click", onTopologyClick);

  /**
   * Minimal DOM-based topology renderer. Removes existing children and
   * appends one element per component. Connections are not visualized in
   * Stage 3b — the data is in state.connections if a future stage wants
   * to draw SVG <line> elements.
   */
  function rerenderTopology(): void {
    // Toggle the .simulating class for CSS pulse animation on connection lines
    if (controller.getPhase() === "simulate") {
      topologyContainer.classList.add("simulating");
    } else {
      topologyContainer.classList.remove("simulating");
    }

    while (topologyContainer.firstChild) {
      topologyContainer.removeChild(topologyContainer.firstChild);
    }
    // Status banner: show the player what action is in progress
    const status = document.createElement("div");
    status.className = "td-status";
    if (controller.getPhase() === "simulate") {
      status.textContent = "Wave running…";
    } else if (controller.getPhase() === "assess") {
      status.textContent = "Assessing wave…";
    } else if (dash.cursor === "placing" && dash.placingType !== null) {
      status.textContent = `Placing ${dash.placingType} — click an empty cell`;
    } else if (dash.cursor === "connecting") {
      const fromName = dash.connectingFromId
        ? state.components.get(dash.connectingFromId)?.type ?? "?"
        : "?";
      status.textContent = `Connecting from ${fromName} — click another component to wire it`;
    } else if (controller.getPhase() === "build") {
      status.textContent = "Click a palette button or click a component to start a connection";
    } else {
      status.textContent = `Phase: ${controller.getPhase().toUpperCase()}`;
    }
    topologyContainer.appendChild(status);

    // SVG layer for connection lines (drawn behind components via z-index)
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "td-connections-svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.position = "absolute";
    svg.style.left = "0";
    svg.style.top = "0";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "1";

    // Arrowhead marker
    const defs = document.createElementNS(svgNs, "defs");
    const marker = document.createElementNS(svgNs, "marker");
    marker.setAttribute("id", "td-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    const arrowPath = document.createElementNS(svgNs, "path");
    arrowPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    arrowPath.setAttribute("fill", "#22c55e");
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Draw one line per connection
    for (const conn of state.connections.values()) {
      const sourceComp = state.components.get(conn.source.componentId);
      const targetComp = state.components.get(conn.target.componentId);
      if (!sourceComp || !targetComp) continue;
      const x1 = sourceComp.position.x * 40;
      const y1 = sourceComp.position.y * 40;
      const x2 = targetComp.position.x * 40;
      const y2 = targetComp.position.y * 40;
      const line = document.createElementNS(svgNs, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", "#22c55e");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("marker-end", "url(#td-arrow)");
      svg.appendChild(line);
    }
    topologyContainer.appendChild(svg);

    for (const [id, comp] of state.components) {
      const el = document.createElement("div");
      el.className = "td-comp";
      if (dash.connectingFromId === id) {
        el.classList.add("connecting-source");
      }
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

  /**
   * Lightweight per-tick status update — finds the existing .td-status
   * element and overwrites its text. Avoids a full rerenderTopology on
   * every tick.
   */
  function updateRunningStatus(
    tickInWave: number,
    totalTicks: number,
    resolved: number,
  ): void {
    const statusEl = topologyContainer.querySelector<HTMLDivElement>(".td-status");
    if (!statusEl) return;
    if (tickInWave <= totalTicks) {
      statusEl.textContent = `Wave running — tick ${tickInWave}/${totalTicks} — ${resolved} resolved`;
    } else {
      // Past the traffic-generation window; engine is draining the queue.
      const drainTicks = tickInWave - totalTicks;
      statusEl.textContent = `Draining queue (+${drainTicks} ticks past wave duration) — ${resolved} resolved`;
    }
  }

  // Initial render
  rerenderTopology();
  refreshHud();

  return {
    refreshHud,
    rerenderTopology,
    updateRunningStatus,
    destroy: () => {
      hudEl.hidden = true;
      topologyContainer.classList.remove("td-mode");
      while (topologyContainer.firstChild) {
        topologyContainer.removeChild(topologyContainer.firstChild);
      }
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
