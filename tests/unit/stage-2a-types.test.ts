import { describe, it, expect } from "vitest";
import type { StagedOutcome } from "@core/engine/staged-outcome.js";
import type { BlockedParentEntry, ChildResponseSnapshot } from "@core/engine/blocked-parent.js";
import type { ProcessContext } from "@core/capability/process-context.js";
import type { ComponentId, RequestId } from "@core/types/ids.js";
import type { Request } from "@core/types/request.js";
import type { ProcessResult } from "@core/types/result.js";

describe("Stage 2a type scaffolding", () => {
  it("StagedOutcome has sourceComponentId, request, result", () => {
    const req = { id: "r1" as RequestId } as Request;
    const result = {
      outcome: { kind: "DROP" as const, reason: "test" },
      sideEffects: [],
      events: [],
    } as ProcessResult;
    const staged: StagedOutcome = {
      sourceComponentId: "c1" as ComponentId,
      request: req,
      result,
    };
    expect(staged.sourceComponentId).toBe("c1");
  });

  it("BlockedParentEntry and ChildResponseSnapshot shapes", () => {
    const req = { id: "p1" as RequestId } as Request;
    const snap: ChildResponseSnapshot = {
      outcome: { kind: "RESPOND" },
      events: [],
      returnLatency: 5,
    };
    const entry: BlockedParentEntry = {
      request: req,
      originComponentId: "c1" as ComponentId,
      blockedOn: new Set(["child1" as RequestId]),
      childResponses: new Map([["child1" as RequestId, snap]]),
    };
    expect(entry.blockedOn.size).toBe(1);
    expect(entry.childResponses.get("child1" as RequestId)?.returnLatency).toBe(5);
  });

  it("ProcessContext has childResponses", () => {
    const ctx = { childResponses: new Map() } as Pick<
      ProcessContext,
      "childResponses"
    >;
    expect(ctx.childResponses.size).toBe(0);
  });
});
