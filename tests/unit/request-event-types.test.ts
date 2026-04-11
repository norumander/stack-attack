import { describe, it, expect } from "vitest";
import type { RequestEventType } from "@core/types/request.js";

describe("Stage 2a RequestEventType additions", () => {
  it("includes all new Stage 2a event types", () => {
    const types: RequestEventType[] = [
      "CHILD_RESOLVED",
      "CHILD_FAILED",
      "SIBLING_CANCELLED",
      "STREAM_STARTED",
      "STREAM_COMPLETED",
    ];
    expect(types).toHaveLength(5);
  });
});
