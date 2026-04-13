import { describe, expect, it } from "vitest";
import { makeTDController } from "@harness/td-fixtures";
import type { ComponentId } from "@core/types/ids";

function setupWithClient() {
  const fixture = makeTDController({ startingBudget: 10_000 });
  // Seed a Client (entry-point) for tryConnect to attach to.
  const client = fixture.compRegistry.create("client", { x: 0, y: 0 }, null);
  fixture.state.placeComponent(client);
  return { ...fixture, client };
}

describe("TDModeController.tryConnect", () => {
  it("creates a connection between Client and a placed Server", () => {
    const { state, tdc, client } = setupWithClient();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(place.ok).toBe(true);
    if (!place.ok) throw new Error();
    const result = tdc.tryConnect(state, client.id, place.componentId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error();
    expect(state.connections.has(result.connectionId)).toBe(true);

    // Verify port.connections updated on both endpoints
    const conn = state.connections.get(result.connectionId)!;
    const sourceComp = state.components.get(conn.source.componentId)!;
    const targetComp = state.components.get(conn.target.componentId)!;
    const sourcePort = sourceComp.ports.find((p) => p.id === conn.source.portId)!;
    const targetPort = targetComp.ports.find((p) => p.id === conn.target.portId)!;
    expect(sourcePort.connections).toContain(result.connectionId);
    expect(targetPort.connections).toContain(result.connectionId);
  });

  it("rejects with wrong_phase in simulate phase", () => {
    const { state, tdc, client } = setupWithClient();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    tdc.advancePhase(state); // build → simulate
    const result = tdc.tryConnect(state, client.id, place.componentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("wrong_phase");
  });

  it("rejects with unknown_source for bogus source id", () => {
    const { state, tdc, client } = setupWithClient();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    const result = tdc.tryConnect(state, "ghost" as ComponentId, place.componentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("unknown_source");
  });

  it("rejects with unknown_target for bogus target id", () => {
    const { state, tdc, client } = setupWithClient();
    const result = tdc.tryConnect(state, client.id, "ghost" as ComponentId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("unknown_target");
  });

  it("rejects with no_ingress_port when target is the Client", () => {
    const { state, tdc, client } = setupWithClient();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    // Connecting Server → Client: Client has no ingress port (CLIENT_ENTRY only declares egress)
    const result = tdc.tryConnect(state, place.componentId, client.id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("no_ingress_port");
  });

  it("rejects duplicate_connection on second connect of same pair", () => {
    const { state, tdc, client } = setupWithClient();
    const place = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    if (!place.ok) throw new Error();
    const first = tdc.tryConnect(state, client.id, place.componentId);
    expect(first.ok).toBe(true);
    const second = tdc.tryConnect(state, client.id, place.componentId);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error();
    expect(second.reason).toBe("duplicate_connection");
  });
});
