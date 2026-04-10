import type { Request, RequestEvent } from "./request.js";

export type PrimaryOutcome =
  | { kind: "RESPOND" }
  | { kind: "FORWARD" }
  | { kind: "DROP"; reason: string }
  | { kind: "QUEUE_HOLD" }
  | { kind: "PASS" };

export type SideEffect =
  | { kind: "SPAWN"; request: Request; blocking: boolean }
  | { kind: "SCALE"; targetInstanceCount: number };

export interface ProcessResult {
  outcome: PrimaryOutcome;
  sideEffects: SideEffect[];
  events: RequestEvent[];
}
