import { describe, expect, it } from "vitest";
import { makeTDController } from "@harness/td-fixtures";
import { WAVE_3, WAVE_4, WAVE_5 } from "@modes/td/td-waves";
import type { ComponentId, ConnectionId } from "@core/types/ids";

/**
 * Helper: set up a fixture with the real client as entry point, one placed
 * Server, and a Client→Server connection. The fixture's entryPointId is
 * wired to the client so tryRemove correctly guards against it.
 */
function setupConnected() {
  const compReg = makeTDController({ startingBudget: 10_000 }).compRegistry;
  const client = compReg.create("client", { x: 0, y: 0 }, null);

  const fix = makeTDController({
    startingBudget: 10_000,
    entryPointId: client.id,
    compRegistry: compReg,
  });
  fix.state.placeComponent(client);

  const placeResult = fix.tdc.tryPlace(fix.state, "server", { x: 1, y: 0 }, null);
  if (!placeResult.ok) throw new Error(`tryPlace failed: ${placeResult.reason}`);
  const serverId = placeResult.componentId;

  const connResult = fix.tdc.tryConnect(fix.state, client.id, serverId);
  if (!connResult.ok) throw new Error(`tryConnect failed: ${connResult.reason}`);
  const connectionId = connResult.connectionId;

  return { ...fix, client, serverId, connectionId };
}

describe("TDModeController.tryDisconnect", () => {
  it("removes a valid connection from state and from both endpoint ports", () => {
    const { state, tdc, client, serverId, connectionId } = setupConnected();

    const result = tdc.tryDisconnect(state, connectionId);
    expect(result.ok).toBe(true);

    // Connection is gone from state
    expect(state.connections.has(connectionId)).toBe(false);

    // Port arrays are cleared on both sides
    const clientComp = state.components.get(client.id)!;
    const serverComp = state.components.get(serverId)!;
    const egressPort = clientComp.ports.find((p) => p.direction === "egress")!;
    const ingressPort = serverComp.ports.find((p) => p.direction === "ingress")!;
    expect(egressPort.connections).not.toContain(connectionId);
    expect(ingressPort.connections).not.toContain(connectionId);
  });

  it("returns unknown_connection for a missing connection id", () => {
    const { state, tdc } = setupConnected();
    const result = tdc.tryDisconnect(state, "ghost-conn" as ConnectionId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("unknown_connection");
  });

  it("returns wrong_phase when not in build phase", () => {
    const { state, tdc, connectionId } = setupConnected();
    tdc.advancePhase(state); // build → simulate
    const result = tdc.tryDisconnect(state, connectionId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("wrong_phase");
  });

  it("restores port capacity so same source→target pair can be re-connected after disconnect", () => {
    const { state, tdc, client, serverId, connectionId } = setupConnected();

    const disconnectResult = tdc.tryDisconnect(state, connectionId);
    expect(disconnectResult.ok).toBe(true);

    // Re-connecting the same pair should succeed (capacity was restored)
    const reconnect = tdc.tryConnect(state, client.id, serverId);
    expect(reconnect.ok).toBe(true);
  });
});

describe("TDModeController.tryRemove", () => {
  it("cascades 3 disconnects and refunds placement cost when component has 2 incoming + 1 outgoing", () => {
    // load_balancer available from WAVE_3 onwards
    const compReg = makeTDController({ startingBudget: 10_000 }).compRegistry;
    const client = compReg.create("client", { x: 0, y: 0 }, null);
    const fix = makeTDController({
      startingBudget: 10_000,
      entryPointId: client.id,
      compRegistry: compReg,
      waves: [WAVE_3, WAVE_4, WAVE_5],
    });
    fix.state.placeComponent(client);

    // Place a load balancer — ingress capacity 1, egress capacity 4
    // Use it as the "middle": one input from client, two outputs to servers
    const lbPlace = fix.tdc.tryPlace(fix.state, "load_balancer", { x: 1, y: 0 }, null);
    if (!lbPlace.ok) throw new Error(`tryPlace lb: ${lbPlace.reason}`);
    const lbId = lbPlace.componentId;

    // Place two servers
    const s1Place = fix.tdc.tryPlace(fix.state, "server", { x: 2, y: 0 }, null);
    if (!s1Place.ok) throw new Error(`tryPlace s1: ${s1Place.reason}`);
    const s2Place = fix.tdc.tryPlace(fix.state, "server", { x: 2, y: 1 }, null);
    if (!s2Place.ok) throw new Error(`tryPlace s2: ${s2Place.reason}`);

    const s1Id = s1Place.componentId;
    const s2Id = s2Place.componentId;

    // Connect: client→lb (1 incoming), lb→s1 (outgoing 1), lb→s2 (outgoing 2)
    const c1 = fix.tdc.tryConnect(fix.state, client.id, lbId);
    if (!c1.ok) throw new Error(`connect client→lb: ${c1.reason}`);
    const c2 = fix.tdc.tryConnect(fix.state, lbId, s1Id);
    if (!c2.ok) throw new Error(`connect lb→s1: ${c2.reason}`);
    const c3 = fix.tdc.tryConnect(fix.state, lbId, s2Id);
    if (!c3.ok) throw new Error(`connect lb→s2: ${c3.reason}`);

    const budgetBefore = fix.economy.getBudget();
    const lbCost = fix.state.components.get(lbId)!.placementCost;

    const result = fix.tdc.tryRemove(fix.state, lbId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();

    // All 3 connections cascaded
    expect(result.disconnectedCount).toBe(3);
    // Refund equals the lb's placementCost
    expect(result.refund).toBe(lbCost);
    // Budget increased by the refund
    expect(fix.economy.getBudget()).toBe(budgetBefore + lbCost);
    // lb is gone from state
    expect(fix.state.components.has(lbId)).toBe(false);
    // All 3 connections are gone
    expect(fix.state.connections.size).toBe(0);
  });

  it("returns unknown_component for a missing component id", () => {
    const { state, tdc } = setupConnected();
    const result = tdc.tryRemove(state, "ghost-comp" as ComponentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("unknown_component");
  });

  it("returns cannot_remove_entry_point when removing the Client entry point", () => {
    const { state, tdc, client } = setupConnected();
    const result = tdc.tryRemove(state, client.id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("cannot_remove_entry_point");
  });

  it("returns wrong_phase when not in build phase", () => {
    const { state, tdc, serverId } = setupConnected();
    tdc.advancePhase(state); // build → simulate
    const result = tdc.tryRemove(state, serverId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("wrong_phase");
  });

  it("removed component is absent from state and no remaining connection references its id", () => {
    // wire: client→server→database, then remove server (cascade removes both connections)
    const compReg = makeTDController({ startingBudget: 10_000 }).compRegistry;
    const client = compReg.create("client", { x: 0, y: 0 }, null);
    const fix = makeTDController({
      startingBudget: 10_000,
      entryPointId: client.id,
      compRegistry: compReg,
    });
    fix.state.placeComponent(client);

    const sPlace = fix.tdc.tryPlace(fix.state, "server", { x: 1, y: 0 }, null);
    if (!sPlace.ok) throw new Error();
    const dbPlace = fix.tdc.tryPlace(fix.state, "database", { x: 2, y: 0 }, null);
    if (!dbPlace.ok) throw new Error();

    const serverId = sPlace.componentId;
    const dbId = dbPlace.componentId;

    const c1 = fix.tdc.tryConnect(fix.state, client.id, serverId);
    if (!c1.ok) throw new Error(`connect client→server: ${c1.reason}`);
    const c2 = fix.tdc.tryConnect(fix.state, serverId, dbId);
    if (!c2.ok) throw new Error(`connect server→db: ${c2.reason}`);

    const result = fix.tdc.tryRemove(fix.state, serverId);
    expect(result.ok).toBe(true);

    // Server is gone from components
    expect(fix.state.components.has(serverId)).toBe(false);

    // No remaining connection references serverId
    for (const conn of fix.state.connections.values()) {
      expect(conn.source.componentId).not.toBe(serverId);
      expect(conn.target.componentId).not.toBe(serverId);
    }

    // Port arrays on surviving components only reference connections that exist in state
    for (const comp of fix.state.components.values()) {
      for (const port of comp.ports) {
        for (const cId of port.connections) {
          expect(fix.state.connections.has(cId)).toBe(true);
        }
      }
    }
  });
});
