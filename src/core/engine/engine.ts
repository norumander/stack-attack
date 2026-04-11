import type { SimulationState } from "../state/simulation-state.js";
import type { ModeController } from "../mode/mode-controller.js";
import { computeVisitOrder } from "./visit-order.js";
import { injectTraffic as defaultInjectTraffic } from "./inject-traffic.js";
import { reEmitQueued as defaultReEmitQueued } from "./re-emit-queued.js";
import { runFixedPointLoop as defaultRunFixedPointLoop } from "./fixed-point-loop.js";
import { sweepOverloaded as defaultSweepOverloaded } from "./overloaded-sweep.js";
import { updateActiveStreams as defaultUpdateActiveStreams } from "./active-streams.js";
import { checkTTL as defaultCheckTTL } from "./check-ttl.js";
import {
  updateCondition as defaultUpdateCondition,
  injectChaos as defaultInjectChaos,
  deductUpkeep as defaultDeductUpkeep,
} from "./stubs.js";
import { recordMetrics as defaultRecordMetrics } from "./metrics-builder.js";
import { resetPerTickState as defaultResetPerTickState } from "./reset-per-tick.js";

/**
 * Injectable step functions. Defaults to the real Stage 2a implementations.
 * Tests can override any subset to observe call ordering or substitute behavior.
 */
export interface EngineSteps {
  injectTraffic: (state: SimulationState, mc: ModeController) => void;
  reEmitQueued: (state: SimulationState) => void;
  runFixedPointLoop: (state: SimulationState, mc: ModeController) => void;
  sweepOverloaded: (state: SimulationState) => void;
  updateActiveStreams: (state: SimulationState, mc: ModeController) => void;
  checkTTL: (state: SimulationState) => void;
  updateCondition: (state: SimulationState, mc: ModeController) => void;
  injectChaos: (state: SimulationState, mc: ModeController) => void;
  deductUpkeep: (state: SimulationState, mc: ModeController) => void;
  recordMetrics: (state: SimulationState) => void;
  resetPerTickState: (state: SimulationState) => void;
}

const defaultSteps: EngineSteps = {
  injectTraffic: defaultInjectTraffic,
  reEmitQueued: defaultReEmitQueued,
  runFixedPointLoop: defaultRunFixedPointLoop,
  sweepOverloaded: defaultSweepOverloaded,
  updateActiveStreams: defaultUpdateActiveStreams,
  checkTTL: defaultCheckTTL,
  updateCondition: defaultUpdateCondition,
  injectChaos: defaultInjectChaos,
  deductUpkeep: defaultDeductUpkeep,
  recordMetrics: defaultRecordMetrics,
  resetPerTickState: defaultResetPerTickState,
};

/**
 * Stage 2a Engine — runs the full 12-step simulation tick in deterministic order.
 *
 * Step ordering is locked by construction; 2b fills in updateCondition, injectChaos,
 * and deductUpkeep without touching this file.
 */
export class Engine {
  private readonly steps: EngineSteps;

  constructor(
    private readonly state: SimulationState,
    stepsOverride: Partial<EngineSteps> = {},
  ) {
    this.steps = { ...defaultSteps, ...stepsOverride };
    // Compute the initial visitOrder from the current components map.
    this.state.visitOrder.length = 0;
    this.state.visitOrder.push(...computeVisitOrder(state.components));
  }

  tick(modeController: ModeController): void {
    this.steps.injectTraffic(this.state, modeController);        // step 1
    this.steps.reEmitQueued(this.state);                         // step 2
    this.steps.runFixedPointLoop(this.state, modeController);    // step 3 (fixed-point)
    this.steps.sweepOverloaded(this.state);                      // step 3b (post-loop sweep)
    this.steps.updateActiveStreams(this.state, modeController);  // step 4b
    this.steps.checkTTL(this.state);                             // step 5
    this.steps.updateCondition(this.state, modeController);      // step 6  (stub)
    this.steps.injectChaos(this.state, modeController);          // step 6b (stub)
    this.steps.deductUpkeep(this.state, modeController);         // step 7  (stub)
    this.steps.recordMetrics(this.state);                        // step 8
    this.steps.resetPerTickState(this.state);                    // step 9
    this.state.advanceTick();                                    // step 10
  }
}
