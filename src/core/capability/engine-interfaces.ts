import type { Capability } from "./capability.js";
import type { Connection } from "../types/connection.js";
import type { ConnectionId, ComponentId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessResult } from "../types/result.js";
import type { ProcessContext, PullContext } from "./process-context.js";

export interface EngineConsultable {
  selectConnection(
    request: Request,
    egressConnections: Connection[],
    context: ProcessContext,
  ): ConnectionId;
}

export interface EngineBufferable {
  enqueueForRetry(request: Request, result: ProcessResult): boolean;
  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  };
  dequeueBatch(n: number): Request[];
}

export interface EnginePullable {
  pullPending(context: PullContext): Request[];
}

export interface ComponentRef {
  readonly componentId: ComponentId;
  readonly componentType: string;
  readonly zone: string | null;
  readonly condition: number;
}

export interface InstanceDirectory {
  listCandidates(query: {
    componentType?: string;
    zone?: string;
    healthyOnly?: boolean;
  }): ComponentRef[];
}

export function isEngineConsultable(
  c: Capability,
): c is Capability & EngineConsultable {
  return typeof (c as unknown as EngineConsultable).selectConnection === "function";
}

export function isEngineBufferable(
  c: Capability,
): c is Capability & EngineBufferable {
  return typeof (c as unknown as EngineBufferable).enqueueForRetry === "function";
}

export function isEnginePullable(
  c: Capability,
): c is Capability & EnginePullable {
  return typeof (c as unknown as EnginePullable).pullPending === "function";
}

export function isInstanceDirectory(
  c: Capability,
): c is Capability & InstanceDirectory {
  return typeof (c as unknown as InstanceDirectory).listCandidates === "function";
}
