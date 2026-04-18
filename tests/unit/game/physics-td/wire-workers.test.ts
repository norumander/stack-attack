import { describe, it, beforeEach, expect } from "vitest";
import { Sim } from "@sim/sim";
import { SimComponent } from "@sim/component";
import { SimConnection } from "@sim/connection";
import { QueueCapability } from "@sim/capabilities/queue";
import { WorkerCapability } from "@sim/capabilities/worker";
import { ForwardingCapability } from "@sim/capabilities/forwarding";
import { resetIdCountersForTest } from "@sim/packet";
import { wireWorkers } from "../../../../src/dashboard/physics-td/wire-workers";
import type { ComponentId, ConnectionId, PortId } from "@core/types/ids";

describe("wireWorkers", () => {
  beforeEach(() => resetIdCountersForTest());

  it("binds each Worker.queue to the QueueCapability of the Queue component on its source-side connection", () => {
    const sim = new Sim({ seed: 1 });
    const queueCap = new QueueCapability({ capacity: 32 });
    const queueComp = new SimComponent({ id: "q1" as ComponentId, capabilities: [queueCap] });
    const workerCap = new WorkerCapability({ pullRate: 10, revenuePerItem: 1 }, null);
    const workerComp = new SimComponent({ id: "w1" as ComponentId, capabilities: [workerCap] });
    sim.addComponent(queueComp);
    sim.addComponent(workerComp);
    sim.addConnection(new SimConnection({
      id: "qw" as ConnectionId,
      from: { componentId: queueComp.id, portId: "p" as PortId },
      to:   { componentId: workerComp.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "wq" as ConnectionId, direction: "forward",
    }));
    sim.addConnection(new SimConnection({
      id: "wq" as ConnectionId,
      from: { componentId: workerComp.id, portId: "p" as PortId },
      to:   { componentId: queueComp.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "qw" as ConnectionId, direction: "back",
    }));
    expect(workerCap.queue).toBeNull();
    wireWorkers(sim);
    expect(workerCap.queue).toBe(queueCap);
  });

  it("leaves Worker.queue null when no Queue is connected", () => {
    const sim = new Sim({ seed: 1 });
    const workerCap = new WorkerCapability({ pullRate: 10, revenuePerItem: 1 }, null);
    sim.addComponent(new SimComponent({ id: "w1" as ComponentId, capabilities: [workerCap] }));
    wireWorkers(sim);
    expect(workerCap.queue).toBeNull();
  });

  it("leaves Worker.queue null when the connected source is not a Queue", () => {
    const sim = new Sim({ seed: 1 });
    const forwarderComp = new SimComponent({
      id: "srv1" as ComponentId,
      capabilities: [new ForwardingCapability()],
    });
    const workerCap = new WorkerCapability({ pullRate: 10, revenuePerItem: 1 }, null);
    const workerComp = new SimComponent({ id: "w1" as ComponentId, capabilities: [workerCap] });
    sim.addComponent(forwarderComp);
    sim.addComponent(workerComp);
    sim.addConnection(new SimConnection({
      id: "sw" as ConnectionId,
      from: { componentId: forwarderComp.id, portId: "p" as PortId },
      to:   { componentId: workerComp.id, portId: "p" as PortId },
      bandwidth: 100, latencySeconds: 0.05, twinId: "ws" as ConnectionId, direction: "forward",
    }));
    wireWorkers(sim);
    expect(workerCap.queue).toBeNull();
  });
});
