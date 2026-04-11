import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { makeComponent } from "@harness/fixtures";
import {
  BlockingDbCapability,
  RespondingCapability,
  TwoBlockingSpawnsCapability,
  DroppingCapability,
} from "@harness/test-capabilities";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

function makeReq(id: string, origin: ComponentId): Request {
  return {
    id: id as RequestId,
    parentId: null,
    type: "api_read",
    payload: null,
    origin,
    createdAt: 0,
    ttl: 100,
    originZone: null,
    streamDuration: null,
    streamBandwidth: null,
  };
}

describe("integration — blocking SPAWN round-trip + strict cascade", () => {
  it("resolves Server → blocking SPAWN → DB → RESPOND → Server re-processes → RESPOND in one tick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const serverCap = new BlockingDbCapability(
      "cap-server" as CapabilityId,
      "c-db" as ComponentId,
    );
    const server = makeComponent({
      id: "c-server",
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-server" as CapabilityId, serverCap],
      ]),
      tiers: new Map([["cap-server" as CapabilityId, 1]]),
    });

    const dbCap = new RespondingCapability("cap-db" as CapabilityId);
    const db = makeComponent({
      id: "c-db",
      capabilities: new Map<CapabilityId, Capability>([["cap-db" as CapabilityId, dbCap]]),
      tiers: new Map([["cap-db" as CapabilityId, 1]]),
    });

    state.placeComponent(server);
    state.placeComponent(db);

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: "c-server" as ComponentId,
      intensity: 0,
      requestType: "api_read",
    });

    const req = makeReq("r-parent", "c-server" as ComponentId);
    state.requestLog.set(req.id, []);
    state.enqueuePending(server.id, req);

    engine.tick(mc);

    const evs = state.requestLog.get(req.id)!;
    const types = evs.map((e) => e.type);
    expect(types).toContain("SPAWNED_SUB");
    expect(types).toContain("CHILD_RESOLVED");
    expect(types).toContain("RESPONDED");
    expect(state.blockedParents.has(req.id)).toBe(false);
    expect(state.pending.get(server.id)).toHaveLength(0);
    expect(state.pending.get(db.id)).toHaveLength(0);
  });

  it("cascades CHILD_FAILED to parent and SIBLING_CANCELLED to remaining sibling when a blocking child DROPs", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const serverCap = new TwoBlockingSpawnsCapability(
      "cap-server" as CapabilityId,
      "c-db-a" as ComponentId,
      "c-db-b" as ComponentId,
    );
    const server = makeComponent({
      id: "c-server",
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-server" as CapabilityId, serverCap],
      ]),
      tiers: new Map([["cap-server" as CapabilityId, 1]]),
    });

    // DB-A drops whatever arrives.
    const dbA = makeComponent({
      id: "c-db-a",
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-db-a" as CapabilityId, new DroppingCapability("cap-db-a" as CapabilityId, "test-drop-a")],
      ]),
      tiers: new Map([["cap-db-a" as CapabilityId, 1]]),
    });

    // DB-B would respond — but should be SIBLING_CANCELLED after DB-A's cascade fires.
    // visitOrder sorts by (zone, placementTick, id); all placements are at tick 0, same zone,
    // so id is the tiebreaker. "c-db-a" < "c-db-b" alphabetically → DB-A visits first.
    const dbB = makeComponent({
      id: "c-db-b",
      capabilities: new Map<CapabilityId, Capability>([
        ["cap-db-b" as CapabilityId, new RespondingCapability("cap-db-b" as CapabilityId)],
      ]),
      tiers: new Map([["cap-db-b" as CapabilityId, 1]]),
    });

    state.placeComponent(server);
    state.placeComponent(dbA);
    state.placeComponent(dbB);

    const engine = new Engine(state);
    const mc = new NoOpModeController({
      targetEntryPointId: "c-server" as ComponentId,
      intensity: 0,
      requestType: "api_read",
    });

    const req = makeReq("r-parent", "c-server" as ComponentId);
    state.requestLog.set(req.id, []);
    state.enqueuePending(server.id, req);

    engine.tick(mc);

    const parentEvs = state.requestLog.get(req.id)!;
    const parentTypes = parentEvs.map((e) => e.type);
    // Parent: saw both SPAWNED_SUBs, then CHILD_FAILED after A's cascade fired.
    expect(parentEvs.filter((e) => e.type === "SPAWNED_SUB")).toHaveLength(2);
    expect(parentTypes).toContain("CHILD_FAILED");
    // Parent should NOT have a RESPONDED event — cascade took it terminal.
    expect(parentEvs.some((e) => e.type === "RESPONDED")).toBe(false);
    // Parent removed from blocked pool.
    expect(state.blockedParents.has(req.id)).toBe(false);

    // Child B should be SIBLING_CANCELLED.
    const spawnEvs = parentEvs.filter((e) => e.type === "SPAWNED_SUB");
    const childIds = spawnEvs.map((e) => (e.metadata as { childId: RequestId }).childId);
    expect(childIds).toHaveLength(2);

    // Find the cancelled child by scanning both children's logs for SIBLING_CANCELLED.
    const cancelledIds = childIds.filter((cid) =>
      state.requestLog.get(cid)!.some((e) => e.type === "SIBLING_CANCELLED"),
    );
    expect(cancelledIds).toHaveLength(1);

    // The dropped child has a DROPPED event with reason != "SIBLING_CANCELLED".
    const droppedIds = childIds.filter((cid) =>
      state.requestLog.get(cid)!.some(
        (e) => e.type === "DROPPED" && (e.metadata as { reason?: string })?.reason !== "SIBLING_CANCELLED",
      ),
    );
    expect(droppedIds).toHaveLength(1);
  });
});
