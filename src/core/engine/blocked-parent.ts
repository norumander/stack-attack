import type { ComponentId, RequestId } from "../types/ids.js";
import type { Request, RequestEvent } from "../types/request.js";
import type { PrimaryOutcome } from "../types/result.js";

export interface ChildResponseSnapshot {
  readonly outcome: PrimaryOutcome;
  readonly events: readonly RequestEvent[];
  readonly returnLatency: number;
}

export interface BlockedParentEntry {
  readonly request: Request;
  readonly originComponentId: ComponentId;
  readonly blockedOn: Set<RequestId>;
  readonly childResponses: Map<RequestId, ChildResponseSnapshot>;
}
