import { Component } from "@core/component/component";
import type { Capability } from "@core/capability/capability";
import type {
  CapabilityId,
  ComponentId,
  ConnectionId,
  PortId,
} from "@core/types/ids";
import type { Port } from "@core/types/port";
import type { Connection } from "@core/types/connection";
import type { ConditionProfile } from "@core/types/condition";

const defaultProfile: ConditionProfile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [],
  criticalEffects: [],
};

export function makePort(
  id: string,
  direction: "ingress" | "egress",
  dataType = "any",
): Port {
  return {
    id: id as PortId,
    direction,
    dataType,
    capacity: 100,
    connections: [],
  };
}

export function makeComponent(args: {
  id: string;
  type?: string;
  ports?: Port[];
  capabilities?: Map<CapabilityId, Capability>;
  tiers?: Map<CapabilityId, number>;
  zone?: string | null;
}): Component {
  return new Component({
    id: args.id as ComponentId,
    type: args.type ?? "test",
    name: args.id,
    description: "",
    capabilities: args.capabilities ?? new Map(),
    initialTiers: args.tiers ?? new Map(),
    ports: args.ports ?? [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: args.zone ?? null,
    placementTick: 0,
    conditionProfile: defaultProfile,
  });
}

export function makeConnection(
  id: string,
  from: { componentId: string; portId: string },
  to: { componentId: string; portId: string },
  opts: { bandwidth?: number; latency?: number } = {},
): Connection {
  return {
    id: id as ConnectionId,
    source: {
      componentId: from.componentId as ComponentId,
      portId: from.portId as PortId,
    },
    target: {
      componentId: to.componentId as ComponentId,
      portId: to.portId as PortId,
    },
    bandwidth: opts.bandwidth ?? 100,
    latency: opts.latency ?? 1,
    currentLoad: 0,
  };
}
