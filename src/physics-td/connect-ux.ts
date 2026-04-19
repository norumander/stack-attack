import { SimConnection } from "@sim/connection";
import type { TopologyRenderer } from "../render/topology-renderer";
import type { Sim } from "@sim/sim";
import type { PhysicsCampaignController } from "./campaign-controller";
import { setStatus } from "./hud-bridge";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

/**
 * Connect UX — click two placed components to mint a twin pair.
 *
 * First click on a placed component → enters "connecting mode", source
 * highlighted via setSelected. Second click on a different component →
 * controller.tryConnect; on success, applyConnection mints both
 * forward + back SimConnections and adds them to the renderer.
 *
 * Click empty space or the same source cancels.
 *
 * Defers to the placement UX — if placement is active, this UX ignores
 * pointer events.
 */
export class ConnectUX {
  private source: ComponentId | null = null;

  constructor(
    private readonly sim: Sim,
    private readonly renderer: TopologyRenderer,
    private readonly controller: PhysicsCampaignController,
    private readonly placementIsActive: () => boolean,
  ) {
    this.renderer.onPointerDown((ev) => {
      if (this.placementIsActive()) return;
      if (this.controller.phase !== "build") return;
      if (!ev.hit) {
        if (this.source) this.cancel();
        return;
      }
      if (this.source === null) {
        this.source = ev.hit.componentId;
        this.renderer.setSelected(this.source);
        this.renderer.setConnectionMode(true);
        setStatus("Connecting — click another component to wire");
        return;
      }
      const target = ev.hit.componentId;
      if (target === this.source) {
        this.cancel();
        return;
      }
      const result = this.controller.tryConnect(this.source, target);
      if (!result.ok) {
        setStatus(`Cannot connect: ${result.reason}`);
      }
      this.cancel();
    });
  }

  applyConnection(
    sourceId: ComponentId,
    targetId: ComponentId,
    forwardId: ConnectionId,
    backId: ConnectionId,
  ): void {
    const forward = new SimConnection({
      id: forwardId,
      from: { componentId: sourceId, portId: "p" as PortId },
      to: { componentId: targetId, portId: "p" as PortId },
      bandwidth: 500,
      latencySeconds: 0.5,
      twinId: backId,
      direction: "forward",
    });
    const back = new SimConnection({
      id: backId,
      from: { componentId: targetId, portId: "p" as PortId },
      to: { componentId: sourceId, portId: "p" as PortId },
      bandwidth: 500,
      latencySeconds: 0.5,
      twinId: forwardId,
      direction: "back",
    });
    this.sim.addConnection(forward);
    this.sim.addConnection(back);
    this.renderer.addConnection(forwardId, sourceId, targetId, { direction: "forward" });
    this.renderer.addConnection(backId, targetId, sourceId, { direction: "back" });
  }

  cancel(): void {
    this.source = null;
    this.renderer.setSelected(null);
    this.renderer.setConnectionMode(false);
    setStatus("Build phase — place components and click READY");
  }
}
