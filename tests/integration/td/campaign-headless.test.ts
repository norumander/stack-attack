import { describe, expect, it } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import { registerTDDefaults } from "@modes/td/register-td-defaults";
import { TDModeController } from "@modes/td/td-mode-controller";
import { TDEconomy } from "@modes/td/td-economy";
import { WAVE_1, WAVE_2, WAVE_3 } from "@modes/td/td-waves";
import { makeRng } from "./helpers";

function runUntilDrained(
  state: SimulationState,
  tdc: TDModeController,
  engine: Engine,
): void {
  let safety = 200;
  while (!tdc.isWaveDrained(state) && safety-- > 0) {
    engine.tick(tdc);
  }
  if (safety <= 0) {
    throw new Error("wave did not drain within 200 ticks");
  }
}

function resetAllConditions(state: SimulationState): void {
  for (const id of state.components.keys()) {
    state.setCondition(id, 1.0);
  }
}

describe("TD campaign headless — full 3-wave registry path", () => {
  it("plays through Waves 1–3 with placements, all waves pass", () => {
    const state = new SimulationState({
      zones: ["default"],
      pairLatency: new Map(),
    });
    const capRegistry = new CapabilityRegistry();
    const compRegistry = new ComponentRegistry(capRegistry);
    registerTDDefaults(capRegistry, compRegistry);

    // Seed the entry-point Client via the registry.
    const client = compRegistry.create("client", { x: 0, y: 0 }, null);
    state.placeComponent(client);

    // Boot the controller for the full campaign.
    let economy = new TDEconomy({
      startingBudget: WAVE_1.startingBudget ?? 500,
      revenuePerRequestType: WAVE_1.revenuePerRequestType,
    });
    const tdc = new TDModeController({
      waves: [WAVE_1, WAVE_2, WAVE_3],
      economy,
      entryPointId: client.id,
      rng: makeRng(1),
      componentRegistry: compRegistry,
    });

    // === Wave 1: place Server, connect Client → Server ===
    const w1Server = tdc.tryPlace(state, "server", { x: 1, y: 0 }, null);
    expect(w1Server.ok).toBe(true);
    if (!w1Server.ok) throw new Error("w1Server placement failed");
    const w1Conn = tdc.tryConnect(state, client.id, w1Server.componentId);
    expect(w1Conn.ok).toBe(true);

    // Per-wave visitOrder refresh mirrors the dashboard's build → simulate
    // handoff: `state.recomputeVisitOrder()` reuses the same Engine
    // instance while picking up any components placed during this wave's
    // build phase.
    tdc.advancePhase(state); // build → simulate
    const engine = new Engine(state);
    runUntilDrained(state, tdc, engine);
    // Capture terminal state while still in simulate phase (getTerminalState
    // checks phase === "simulate" to emit "wave_passed").
    const w1TerminalState = tdc.getTerminalState(state);
    tdc.advancePhase(state); // simulate → assess
    expect(w1TerminalState).toBe("wave_passed");
    expect(tdc.getViability().value).toBeGreaterThan(0);
    // Under the new economy, budget carries over across waves (no per-wave reset).
    // This per-wave TDEconomy re-creation is left here to mirror the legacy
    // dashboard build→simulate handoff pattern exercised by this campaign test.
    // NOTE: budget carryover assertion is deferred to T16 once payRent is wired.
    const _w1FinalBudget = economy.getBudget();

    // === Per-wave reset (mirrors dashboard behavior) ===
    // TODO(carryover): in the new economy, startingBudget for Wave 2 would be
    // _w1FinalBudget rather than a hardcoded WAVE_2.startingBudget.
    economy = new TDEconomy({
      startingBudget: WAVE_2.startingBudget ?? 500,
      revenuePerRequestType: WAVE_2.revenuePerRequestType,
    });
    tdc.setEconomy(economy);
    resetAllConditions(state);
    tdc.advancePhase(state); // assess → build, waveIndex → 1

    // === Wave 2: place Database, connect Server → Database ===
    expect(tdc.getCurrentWave()).toBe(WAVE_2);
    const w2Db = tdc.tryPlace(state, "database", { x: 2, y: 0 }, null);
    expect(w2Db.ok).toBe(true);
    if (!w2Db.ok) throw new Error("w2Db placement failed");
    const w2Conn = tdc.tryConnect(
      state,
      w1Server.componentId,
      w2Db.componentId,
    );
    expect(w2Conn.ok).toBe(true);

    tdc.advancePhase(state); // build → simulate
    state.recomputeVisitOrder();
    runUntilDrained(state, tdc, engine);
    // Capture terminal state while still in simulate phase.
    const w2TerminalState = tdc.getTerminalState(state);
    tdc.advancePhase(state); // simulate → assess
    expect(w2TerminalState).toBe("wave_passed");
    expect(tdc.getViability().value).toBeGreaterThan(0);
    // Budget carryover: in the new economy w2 starting budget = _w1FinalBudget
    // minus rent. Assertion deferred to T16.
    const _w2FinalBudget = economy.getBudget();

    // === Per-wave reset ===
    // TODO(carryover): in the new economy, startingBudget for Wave 3 would be
    // _w2FinalBudget rather than a hardcoded WAVE_3.startingBudget.
    economy = new TDEconomy({
      startingBudget: WAVE_3.startingBudget ?? 600,
      revenuePerRequestType: WAVE_3.revenuePerRequestType,
    });
    tdc.setEconomy(economy);
    resetAllConditions(state);
    tdc.advancePhase(state); // assess → build, waveIndex → 2

    // === Wave 3: Cache + second Server rescue ===
    // Server ingress capacity is 1 — already bound by w1 Client→Server.
    // To introduce a cache on the read path we add a parallel branch:
    //   Client → Cache → w3Server → w2Db
    // Client egress (capacity 4) round-robins reads/writes across the two
    // branches. Cache absorbs ~67% of its branch's reads (pool 15 vs
    // capacity 10); uncached reads and all writes forward to w3Server,
    // which handles the half of wave-3 traffic it sees comfortably.
    expect(tdc.getCurrentWave()).toBe(WAVE_3);
    const w3Cache = tdc.tryPlace(state, "cache", { x: 1, y: 1 }, null);
    expect(w3Cache.ok).toBe(true);
    if (!w3Cache.ok) throw new Error("w3Cache placement failed");
    const w3Server = tdc.tryPlace(state, "server", { x: 2, y: 1 }, null);
    expect(w3Server.ok).toBe(true);
    if (!w3Server.ok) throw new Error("w3Server placement failed");

    expect(
      tdc.tryConnect(state, client.id, w3Cache.componentId).ok,
    ).toBe(true);
    expect(
      tdc.tryConnect(state, w3Cache.componentId, w3Server.componentId).ok,
    ).toBe(true);
    expect(
      tdc.tryConnect(state, w3Server.componentId, w2Db.componentId).ok,
    ).toBe(true);

    tdc.advancePhase(state); // build → simulate
    state.recomputeVisitOrder();
    runUntilDrained(state, tdc, engine);
    // Capture terminal state while still in simulate phase.
    const w3TerminalState = tdc.getTerminalState(state);
    tdc.advancePhase(state); // simulate → assess
    expect(w3TerminalState).toBe("wave_passed");
    expect(tdc.getViability().value).toBeGreaterThan(0);
    const _w3FinalBudget = economy.getBudget(); // captured for future carryover assertions (T16)

    // === Final: campaign complete ===
    tdc.advancePhase(state); // assess → build, waveIndex past length
    expect(tdc.isCampaignComplete()).toBe(true);
  });
});
