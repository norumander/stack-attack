import type { ComponentId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessResult } from "../types/result.js";

export interface StagedOutcome {
  readonly sourceComponentId: ComponentId;
  readonly request: Request;
  readonly result: ProcessResult;
}
