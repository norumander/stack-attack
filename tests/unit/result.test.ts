import { describe, it, expect } from "vitest";
import type { ProcessResult, PrimaryOutcome, SideEffect } from "@core/types/result";
import type { Request } from "@core/types/request";
import type { RequestId, ComponentId } from "@core/types/ids";

describe("ProcessResult", () => {
  it("models each PrimaryOutcome kind", () => {
    const outcomes: PrimaryOutcome[] = [
      { kind: "RESPOND" },
      { kind: "FORWARD" },
      { kind: "DROP", reason: "test" },
      { kind: "QUEUE_HOLD" },
      { kind: "PASS" },
    ];
    expect(outcomes).toHaveLength(5);
  });

  it("models SPAWN and SCALE side effects", () => {
    const stubReq: Request = {
      id: "r-sub" as RequestId,
      parentId: "r-parent" as RequestId,
      type: "api_read",
      payload: null,
      origin: "c-1" as ComponentId,
      createdAt: 0,
      ttl: 5,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
    const effects: SideEffect[] = [
      { kind: "SPAWN", request: stubReq, blocking: true },
      { kind: "SCALE", targetInstanceCount: 3 },
    ];
    expect(effects).toHaveLength(2);
  });

  it("assembles a ProcessResult", () => {
    const result: ProcessResult = {
      outcome: { kind: "PASS" },
      sideEffects: [],
      events: [],
    };
    expect(result.outcome.kind).toBe("PASS");
  });
});
