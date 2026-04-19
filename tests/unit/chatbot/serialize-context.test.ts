import { describe, expect, it } from "vitest";
import { Sim } from "../../../src/sim/sim";
import { SimComponent } from "../../../src/sim/component";
import { SimConnection } from "../../../src/sim/connection";
import type { ComponentId, ConnectionId, PortId } from "../../../src/core/types/ids";
import type { WaveDef } from "../../../src/sim/wave";
import type { SLAThresholds } from "../../../src/sim/sla";
import { ComponentMetricsAggregator } from "../../../src/physics-td/component-metrics";
import { serializeContextForChat } from "../../../src/chatbot/serialize-context";

function mkWave(): WaveDef {
  return {
    intensity: 15,
    packetRate: 20,
    duration: 45,
    composition: {
      writeRatio: 0.2,
      authRatio: 0.1,
      streamRatio: 0,
      largeRatio: 0,
      asyncRatio: 0,
    },
    keyDistribution: { kind: "uniform", spaceSize: 1000 },
    revenue: { perRead: 1, perWrite: 2, perAuth: 1, perStream: 0, perAsync: 0 },
    entryClients: ["client" as ComponentId],
  };
}

function mkSla(): SLAThresholds {
  return { availability: 0.99, maxAvgLatencySeconds: 2, maxDropRate: 0.01 };
}

function mkComponent(id: string): SimComponent {
  return new SimComponent({
    id: id as ComponentId,
    capabilities: [],
    capacityPerSecond: 100,
  });
}

function mkConnection(
  id: string,
  from: string,
  to: string,
  dir: "forward" | "back",
): SimConnection {
  return new SimConnection({
    id: id as ConnectionId,
    from: { componentId: from as ComponentId, portId: "out" as PortId },
    to: { componentId: to as ComponentId, portId: "in" as PortId },
    bandwidth: 100,
    latencySeconds: 0.01,
    twinId: (id + "_twin") as ConnectionId,
    direction: dir,
  });
}

describe("serializeContextForChat", () => {
  it("produces a ChatRequest matching the live sim + wave + metrics", () => {
    const sim = new Sim({ seed: 1 });
    const s1 = mkComponent("s1");
    const lb = mkComponent("lb");
    sim.components.set(s1.id, s1);
    sim.components.set(lb.id, lb);

    const forward = mkConnection("c1", "lb", "s1", "forward");
    const back = mkConnection("c1_back", "s1", "lb", "back");
    sim.connections.set(forward.id, forward);
    sim.connections.set(back.id, back);

    const componentTypes = new Map<ComponentId, string>([
      [s1.id, "server"],
      [lb.id, "load_balancer"],
    ]);
    const componentLabels = new Map<ComponentId, string | undefined>([
      [s1.id, "Server 1"],
      [lb.id, undefined],
    ]);

    const agg = new ComponentMetricsAggregator();
    agg.update(sim, [], 0); // populates utilization = 0 baseline

    const req = serializeContextForChat({
      sim,
      wave: mkWave(),
      waveId: "w1",
      waveTitle: "Launch",
      sla: mkSla(),
      metricsAggregator: agg,
      componentTypes,
      componentLabels,
      mode: "build",
      hintLevel: "coach",
      levelId: "url-shortener",
      liveMetrics: {
        availability: 0.98,
        avgLatencySeconds: 1.2,
        dropRate: 0.02,
        currentTickSeconds: 10,
      },
      recentEvents: [{ t: 5, type: "saturation", detail: "s1 queue full" }],
      conversationHistory: [{ role: "user", content: "hi" }],
      userMessage: "why are drops spiking?",
    });

    expect(req.mode).toBe("build");
    expect(req.hintLevel).toBe("coach");
    expect(req.levelId).toBe("url-shortener");
    expect(req.wave.id).toBe("w1");
    expect(req.wave.title).toBe("Launch");
    expect(req.wave.intensity).toBe(15);
    expect(req.wave.duration).toBe(45);
    expect(req.wave.sla.availability).toBeCloseTo(0.99);
    expect(req.wave.composition.writeRatio).toBeCloseTo(0.2);

    // Topology
    expect(req.topology.components).toHaveLength(2);
    const s1Row = req.topology.components.find((c) => c.id === "s1")!;
    expect(s1Row.type).toBe("server");
    expect(s1Row.label).toBe("Server 1");
    expect(s1Row.utilization).toBe(0);
    expect(s1Row.dropsThisWave).toBe(0);

    const lbRow = req.topology.components.find((c) => c.id === "lb")!;
    expect(lbRow.type).toBe("load_balancer");
    expect(lbRow.label).toBeUndefined();

    // Only forward connections are included.
    expect(req.topology.connections).toEqual([{ from: "lb", to: "s1" }]);

    expect(req.liveMetrics.availability).toBeCloseTo(0.98);
    expect(req.recentEvents).toHaveLength(1);
    expect(req.conversationHistory).toHaveLength(1);
    expect(req.userMessage).toBe("why are drops spiking?");
  });

  it("omits utilization/dropsThisWave when metricsAggregator is null (pre-wave)", () => {
    const sim = new Sim({ seed: 1 });
    const s1 = mkComponent("s1");
    sim.components.set(s1.id, s1);

    const req = serializeContextForChat({
      sim,
      wave: mkWave(),
      waveId: "w1",
      waveTitle: "Launch",
      sla: mkSla(),
      metricsAggregator: null,
      componentTypes: new Map([[s1.id, "server"]]),
      componentLabels: new Map(),
      mode: "build",
      hintLevel: "explorer",
      levelId: undefined,
      liveMetrics: {
        availability: 1,
        avgLatencySeconds: 0,
        dropRate: 0,
        currentTickSeconds: 0,
      },
      recentEvents: [],
      conversationHistory: [],
      userMessage: "hello",
    });

    const s1Row = req.topology.components[0]!;
    expect(s1Row.utilization).toBeUndefined();
    expect(s1Row.dropsThisWave).toBeUndefined();
    expect(req.levelId).toBeUndefined();
  });
});
