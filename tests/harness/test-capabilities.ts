/**
 * Test-only capability implementations.
 *
 * These are simple, deterministic stubs used by integration tests that need
 * precise control over what each component does without pulling in real
 * capability logic.
 */

import type { Capability } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import type { ProcessResult, SideEffect } from "@core/types/result";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";

/** Always produces a FORWARD outcome. Throughput is unbounded (no getThroughputPerTick). */
export class ForwardingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_req: Request, _ctx: ProcessContext): ProcessResult {
    return { outcome: { kind: "FORWARD" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(_tier: number): number {
    return 0;
  }

  getStats() {
    return {};
  }
}

/** Always produces a RESPOND outcome. Throughput is unbounded. */
export class RespondingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(readonly id: CapabilityId) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_req: Request, _ctx: ProcessContext): ProcessResult {
    return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
  }

  getUpkeepCost(_tier: number): number {
    return 0;
  }

  getStats() {
    return {};
  }
}

/**
 * Two-phase capability that models a Server making a synchronous DB call.
 *
 * First pass (ctx.childResponses is empty):
 *   - Emits a blocking SPAWN side effect targeting `dbComponentId`.
 *   - Returns PASS so the parent is parked in state.blockedParents.
 *
 * Re-entry (ctx.childResponses has the DB child's snapshot):
 *   - Returns RESPOND, completing the parent request.
 */
export class BlockingDbCapability implements Capability {
  readonly phase = "PROCESS" as const;
  private spawnCounter = 0;

  constructor(
    readonly id: CapabilityId,
    private readonly dbComponentId: ComponentId,
  ) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(req: Request, ctx: ProcessContext): ProcessResult {
    if (ctx.childResponses.size > 0) {
      // Re-entry after the DB child resolved — respond to the original caller.
      return { outcome: { kind: "RESPOND" }, sideEffects: [], events: [] };
    }

    // First pass — spawn a blocking child request targeted at the DB component.
    this.spawnCounter += 1;
    const childId = `${req.id}-db-child-${this.spawnCounter}` as RequestId;

    const childRequest: Request = {
      id: childId,
      parentId: req.id,
      type: "api_read",
      payload: null,
      // origin doubles as the initial target for the SPAWN side-effect handler.
      origin: this.dbComponentId,
      createdAt: 0, // overwritten by deliverStaged to state.currentTick
      ttl: 100,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };

    const sideEffect: SideEffect = {
      kind: "SPAWN",
      request: childRequest,
      blocking: true,
    };

    return { outcome: { kind: "PASS" }, sideEffects: [sideEffect], events: [] };
  }

  getUpkeepCost(_tier: number): number {
    return 0;
  }

  getStats() {
    return {};
  }
}
