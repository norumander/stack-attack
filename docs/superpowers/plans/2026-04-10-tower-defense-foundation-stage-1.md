# Tower Defense Foundation — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Stage 1 "core types + engine skeleton" slice of the Phase 1 foundation: every type, interface, class, and registry defined in the spec, plus a walking-skeleton Engine and a smoke-test integration test that proves requests flow end-to-end through a minimal Client → Server topology.

**Architecture:** Framework-agnostic pure TypeScript under `src/core/`. Strict structural typing (no runtime type checks). Immutable `Request`, mutable `SimulationState`, read-only `SimulationStateReader` narrowing `Component` to `ComponentReader`. Registries validate at registration time. Abstract `ModeController` / `EconomyStrategy` / `TrafficSource` in core; only test-harness stubs live in Phase 1. The Stage 1 engine runs a minimal tick loop sufficient for a smoke test; Stage 2 replaces the internals.

**Tech Stack:** Vite + TypeScript (strict) + Vitest. React/Pixi come in Stage 4. No runtime deps in Stage 1.

**Spec reference:** `docs/superpowers/specs/2026-04-10-tower-defense-foundation-design.md`. When a type signature in this plan is truncated, the spec is authoritative — read the matching section.

**Out of scope for Stage 1 (deferred to later stage plans):**
- Real tick-step implementations (Stage 2): fixed-point loop, backpressure routing, TTL, condition effects, throughput gate, metrics, chaos
- All 24 capability implementations beyond the stub `ProcessingCapability` (Stage 3)
- 14 component registry entries (Stage 3)
- UI (Stage 4)
- `src/modes/example/`, Phase 2 onboarding doc, ESLint import boundaries, frozen-folder markers (Stage 5)

**Stage 1 exit criterion (from the spec):** the smoke-test integration test passes, and every Stage 1 interface is committed and exported. After Stage 1 merges, write the Stage 2 plan against the locked interfaces.

---

## File structure (Stage 1 only)

Files created in this stage:

```
package.json
tsconfig.json
vitest.config.ts
.gitignore  (augmented)

src/core/types/
  ids.ts                       # branded ID types
  position.ts                  # Position
  phase.ts                     # Phase union
  request.ts                   # Request, RequestEvent, RequestEventType
  result.ts                    # PrimaryOutcome, SideEffect, ProcessResult
  port.ts                      # Port
  connection.ts                # Connection
  condition.ts                 # ConditionEffect, ConditionProfile
  zone.ts                      # ZoneTopology, zonePairKey, getZonePairLatency
  stream.ts                    # ActiveStream
  metrics.ts                   # TickMetrics
  outcome.ts                   # OutcomeReport
  build-constraints.ts         # BuildConstraints, PlacementResult, UpgradeResult
  chaos.ts                     # ChaosEvent, ActiveChaosEntry
  index.ts

src/core/engine/
  rng.ts                       # DeterministicRng + default impl
  per-component-counters.ts    # PerComponentTickCounters, EMPTY_COUNTERS
  engine.ts                    # Stage 1 walking-skeleton Engine
  index.ts

src/core/capability/
  capability.ts                # Capability + CapabilityStats
  engine-interfaces.ts         # EngineConsultable/Bufferable/Pullable/InstanceDirectory + predicates
  process-context.ts           # ProcessContext, PullContext
  index.ts

src/core/component/
  component-reader.ts          # ComponentReader interface
  component.ts                 # Component class + ComponentConstructorArgs
  effective-tier.ts            # getEffectiveTier, computeEffectiveTiers
  index.ts

src/core/state/
  simulation-state.ts          # SimulationState class
  state-reader.ts              # SimulationStateReader interface
  index.ts

src/core/registry/
  capability-registry.ts
  component-registry.ts
  index.ts

src/core/mode/
  mode-controller.ts           # ModeController interface (abstract)
  economy-strategy.ts          # EconomyStrategy interface (abstract)
  traffic-source.ts            # TrafficSource interface
  composite-traffic-source.ts  # CompositeTrafficSource utility
  mode-definition.ts           # ModeDefinition interface
  index.ts

src/capabilities/processing/
  processing-capability.ts     # Stub: always PASS

tests/harness/
  noop-economy.ts
  noop-mode-controller.ts
  fixed-intensity-traffic-source.ts
  fixtures.ts                  # builders for Component/Connection/SimulationState

tests/unit/
  ids.test.ts
  zone.test.ts
  rng.test.ts
  capability-predicates.test.ts
  component.test.ts
  effective-tier.test.ts
  simulation-state.test.ts
  capability-registry.test.ts
  component-registry.test.ts
  composite-traffic-source.test.ts
  processing-capability.test.ts

tests/integration/
  smoke.test.ts
```

All Stage 1 files are under `src/core/**`, `src/capabilities/processing/**`, and `tests/**`. Nothing else is touched.

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "capstone",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noImplicitAny": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "node"],
    "baseUrl": ".",
    "paths": {
      "@core/*": ["src/core/*"],
      "@capabilities/*": ["src/capabilities/*"],
      "@harness/*": ["tests/harness/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@core": new URL("./src/core", import.meta.url).pathname,
      "@capabilities": new URL("./src/capabilities", import.meta.url).pathname,
      "@harness": new URL("./tests/harness", import.meta.url).pathname,
    },
  },
});
```

- [ ] **Step 4: Augment `.gitignore`**

Append:
```
node_modules/
dist/
coverage/
.vitest/
```

- [ ] **Step 5: Install and verify**

Run: `pnpm install` (or `npm install`)
Run: `pnpm typecheck`
Expected: no output (typecheck passes with empty project)
Run: `pnpm test`
Expected: "No test files found" (vitest exits 0 with no tests)

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold TypeScript project with strict tsconfig and vitest"
```

---

## Task 1: Branded IDs and Position

**Files:**
- Create: `src/core/types/ids.ts`
- Create: `src/core/types/position.ts`
- Create: `tests/unit/ids.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ids.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { RequestId, ComponentId } from "@core/types/ids";
import type { Position } from "@core/types/position";

describe("branded IDs", () => {
  it("treats branded IDs as nominal", () => {
    const r = "r-1" as RequestId;
    const c = "c-1" as ComponentId;
    expectTypeOf<RequestId>().not.toEqualTypeOf<ComponentId>();
    expectTypeOf<typeof r>().toEqualTypeOf<RequestId>();
    expectTypeOf<typeof c>().toEqualTypeOf<ComponentId>();
  });

  it("Position is a readonly 2D point", () => {
    const p: Position = { x: 1, y: 2 };
    expectTypeOf(p).toEqualTypeOf<Position>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/ids.test.ts`
Expected: FAIL — cannot find module `@core/types/ids`

- [ ] **Step 3: Implement `ids.ts`**

```ts
// src/core/types/ids.ts
export type RequestId    = string & { readonly __brand: "RequestId" };
export type ComponentId  = string & { readonly __brand: "ComponentId" };
export type CapabilityId = string & { readonly __brand: "CapabilityId" };
export type ConnectionId = string & { readonly __brand: "ConnectionId" };
export type PortId       = string & { readonly __brand: "PortId" };
```

- [ ] **Step 4: Implement `position.ts`**

```ts
// src/core/types/position.ts
export interface Position {
  readonly x: number;
  readonly y: number;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/unit/ids.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/types/ids.ts src/core/types/position.ts tests/unit/ids.test.ts
git commit -m "feat(core): add branded ID types and Position"
```

---

## Task 2: Phase, Request, RequestEvent

**Files:**
- Create: `src/core/types/phase.ts`
- Create: `src/core/types/request.ts`

- [ ] **Step 1: Write a placeholder test that imports the types**

Inline into a new file `tests/unit/request.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Request, RequestEvent, Phase } from "@core/types/request";
import type { RequestId, ComponentId, CapabilityId, ConnectionId } from "@core/types/ids";

describe("Request type", () => {
  it("constructs an immutable Request", () => {
    const r: Request = {
      id: "r-1" as RequestId,
      parentId: null,
      type: "api_read",
      payload: { foo: 1 },
      origin: "c-client" as ComponentId,
      createdAt: 0,
      ttl: 10,
      originZone: null,
      streamDuration: null,
      streamBandwidth: null,
    };
    expect(r.type).toBe("api_read");
  });

  it("constructs a RequestEvent", () => {
    const e: RequestEvent = {
      tick: 0,
      componentId: "c-1" as ComponentId,
      capabilityId: null,
      connectionId: null,
      type: "ENTERED",
      latencyAdded: 0,
    };
    expect(e.type).toBe("ENTERED");
  });

  it("narrows Phase union", () => {
    const p: Phase = "INTERCEPT";
    expect(p).toBe("INTERCEPT");
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `pnpm test tests/unit/request.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `phase.ts`**

```ts
// src/core/types/phase.ts
export type Phase = "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE";
```

- [ ] **Step 4: Implement `request.ts`**

```ts
// src/core/types/request.ts
import type {
  RequestId, ComponentId, CapabilityId, ConnectionId,
} from "./ids.js";

export type { Phase } from "./phase.js";

export interface Request {
  readonly id: RequestId;
  readonly parentId: RequestId | null;
  readonly type: string;
  readonly payload: unknown;
  readonly origin: ComponentId;
  readonly createdAt: number;
  readonly ttl: number;
  readonly originZone: string | null;
  readonly streamDuration: number | null;
  readonly streamBandwidth: number | null;
}

export type RequestEventType =
  | "ENTERED" | "PROCESSED" | "FORWARDED"
  | "CACHED_HIT" | "CACHED_MISS"
  | "QUEUED" | "DEQUEUED"
  | "SPAWNED_SUB"
  | "RESPONDED" | "DROPPED" | "TIMED_OUT"
  | "BACKPRESSURED" | "OVERLOADED"
  | "TRAVERSED";

export interface RequestEvent {
  readonly tick: number;
  readonly componentId: ComponentId;
  readonly capabilityId: CapabilityId | null;
  readonly connectionId: ConnectionId | null;
  readonly type: RequestEventType;
  readonly latencyAdded: number;
  readonly metadata?: Record<string, unknown>;
}
```

- [ ] **Step 5: Run test, confirm pass**

Run: `pnpm test tests/unit/request.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/types/phase.ts src/core/types/request.ts tests/unit/request.test.ts
git commit -m "feat(core): add Request, RequestEvent, Phase types"
```

---

## Task 3: ProcessResult, PrimaryOutcome, SideEffect

**Files:**
- Create: `src/core/types/result.ts`
- Create: `tests/unit/result.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/result.test.ts
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
```

- [ ] **Step 2: Run and verify fail**

Run: `pnpm test tests/unit/result.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `result.ts`**

```ts
// src/core/types/result.ts
import type { Request, RequestEvent } from "./request.js";

export type PrimaryOutcome =
  | { kind: "RESPOND" }
  | { kind: "FORWARD" }
  | { kind: "DROP"; reason: string }
  | { kind: "QUEUE_HOLD" }
  | { kind: "PASS" };

export type SideEffect =
  | { kind: "SPAWN"; request: Request; blocking: boolean }
  | { kind: "SCALE"; targetInstanceCount: number };

export interface ProcessResult {
  outcome: PrimaryOutcome;
  sideEffects: SideEffect[];
  events: RequestEvent[];
}
```

- [ ] **Step 4: Run and verify pass**

Run: `pnpm test tests/unit/result.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/types/result.ts tests/unit/result.test.ts
git commit -m "feat(core): add ProcessResult, PrimaryOutcome, SideEffect types"
```

---

## Task 4: Port and Connection

**Files:**
- Create: `src/core/types/port.ts`
- Create: `src/core/types/connection.ts`
- Create: `tests/unit/port-connection.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/port-connection.test.ts
import { describe, it, expect } from "vitest";
import type { Port } from "@core/types/port";
import type { Connection } from "@core/types/connection";
import type { PortId, ComponentId, ConnectionId } from "@core/types/ids";

describe("Port and Connection", () => {
  it("constructs an ingress Port with mutable connections list", () => {
    const p: Port = {
      id: "p-1" as PortId,
      direction: "ingress",
      dataType: "any",
      capacity: 100,
      connections: [],
    };
    p.connections.push("cx-1" as ConnectionId);
    expect(p.connections).toHaveLength(1);
  });

  it("constructs a Connection with mutable currentLoad", () => {
    const c: Connection = {
      id: "cx-1" as ConnectionId,
      source: { componentId: "c-a" as ComponentId, portId: "p-a" as PortId },
      target: { componentId: "c-b" as ComponentId, portId: "p-b" as PortId },
      bandwidth: 10,
      latency: 1,
      currentLoad: 0,
    };
    c.currentLoad = 5;
    expect(c.currentLoad).toBe(5);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/port-connection.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `port.ts`**

```ts
// src/core/types/port.ts
import type { PortId, ConnectionId } from "./ids.js";

export interface Port {
  readonly id: PortId;
  readonly direction: "ingress" | "egress";
  readonly dataType: string;
  readonly capacity: number;
  connections: ConnectionId[];
}
```

- [ ] **Step 4: Implement `connection.ts`**

```ts
// src/core/types/connection.ts
import type { ConnectionId, ComponentId, PortId } from "./ids.js";

export interface Connection {
  readonly id: ConnectionId;
  readonly source: { componentId: ComponentId; portId: PortId };
  readonly target: { componentId: ComponentId; portId: PortId };
  readonly bandwidth: number;
  readonly latency: number;
  currentLoad: number;
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test tests/unit/port-connection.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/types/port.ts src/core/types/connection.ts tests/unit/port-connection.test.ts
git commit -m "feat(core): add Port and Connection types"
```

---

## Task 5: ConditionEffect and ConditionProfile

**Files:**
- Create: `src/core/types/condition.ts`
- Create: `tests/unit/condition.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/condition.test.ts
import { describe, it, expect } from "vitest";
import type { ConditionEffect, ConditionProfile } from "@core/types/condition";

describe("ConditionEffect and ConditionProfile", () => {
  it("models each effect kind", () => {
    const effects: ConditionEffect[] = [
      { kind: "latency_multiplier", factor: 1.5 },
      { kind: "drop_probability", p: 0.25 },
      { kind: "throughput_multiplier", factor: 0.5 },
      { kind: "upkeep_multiplier", factor: 1.2 },
    ];
    expect(effects).toHaveLength(4);
  });

  it("assembles a ConditionProfile", () => {
    const profile: ConditionProfile = {
      degradedThreshold: 0.6,
      criticalThreshold: 0.3,
      decayRate: 0.1,
      recoveryRate: 0.05,
      degradedEffects: [{ kind: "latency_multiplier", factor: 1.5 }],
      criticalEffects: [{ kind: "drop_probability", p: 0.5 }],
    };
    expect(profile.criticalThreshold).toBe(0.3);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/condition.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `condition.ts`**

```ts
// src/core/types/condition.ts
export type ConditionEffect =
  | { kind: "latency_multiplier"; factor: number }
  | { kind: "drop_probability"; p: number }
  | { kind: "throughput_multiplier"; factor: number }
  | { kind: "upkeep_multiplier"; factor: number };

export interface ConditionProfile {
  degradedThreshold: number;
  criticalThreshold: number;
  decayRate: number;
  recoveryRate: number;
  degradedEffects: ConditionEffect[];
  criticalEffects: ConditionEffect[];
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/condition.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/types/condition.ts tests/unit/condition.test.ts
git commit -m "feat(core): add ConditionEffect and ConditionProfile"
```

---

## Task 6: Zone topology and latency helpers

**Files:**
- Create: `src/core/types/zone.ts`
- Create: `tests/unit/zone.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/zone.test.ts
import { describe, it, expect } from "vitest";
import {
  zonePairKey,
  getZonePairLatency,
  type ZoneTopology,
} from "@core/types/zone";

describe("zone helpers", () => {
  it("zonePairKey is order-independent", () => {
    expect(zonePairKey("us-east", "us-west")).toBe(zonePairKey("us-west", "us-east"));
  });

  it("same zone returns 0 regardless of topology", () => {
    const topo: ZoneTopology = { zones: [], pairLatency: new Map() };
    expect(getZonePairLatency(topo, "us-east", "us-east")).toBe(0);
  });

  it("null zone returns 0", () => {
    const topo: ZoneTopology = { zones: [], pairLatency: new Map() };
    expect(getZonePairLatency(topo, null, "us-east")).toBe(0);
    expect(getZonePairLatency(topo, "us-east", null)).toBe(0);
    expect(getZonePairLatency(topo, null, null)).toBe(0);
  });

  it("empty topology returns 0 for any cross-zone pair", () => {
    const topo: ZoneTopology = { zones: [], pairLatency: new Map() };
    expect(getZonePairLatency(topo, "us-east", "us-west")).toBe(0);
  });

  it("populated topology returns the configured latency", () => {
    const topo: ZoneTopology = {
      zones: ["us-east", "us-west"],
      pairLatency: new Map([[zonePairKey("us-east", "us-west"), 40]]),
    };
    expect(getZonePairLatency(topo, "us-east", "us-west")).toBe(40);
    expect(getZonePairLatency(topo, "us-west", "us-east")).toBe(40);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/zone.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `zone.ts`**

```ts
// src/core/types/zone.ts
export interface ZoneTopology {
  readonly zones: readonly string[];
  readonly pairLatency: ReadonlyMap<string, number>;
}

export function zonePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function getZonePairLatency(
  topology: ZoneTopology,
  a: string | null,
  b: string | null,
): number {
  if (a === null || b === null || a === b) return 0;
  return topology.pairLatency.get(zonePairKey(a, b)) ?? 0;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/zone.test.ts`
Expected: PASS (5 assertions)

- [ ] **Step 5: Commit**

```bash
git add src/core/types/zone.ts tests/unit/zone.test.ts
git commit -m "feat(core): add ZoneTopology and latency helpers"
```

---

## Task 7: Chaos events and active stream types

**Files:**
- Create: `src/core/types/chaos.ts`
- Create: `src/core/types/stream.ts`
- Create: `tests/unit/chaos-stream.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/chaos-stream.test.ts
import { describe, it, expect } from "vitest";
import type { ChaosEvent, ActiveChaosEntry } from "@core/types/chaos";
import type { ActiveStream } from "@core/types/stream";
import type { ComponentId, ConnectionId, RequestId } from "@core/types/ids";

describe("ChaosEvent and ActiveStream", () => {
  it("models each ChaosEvent kind", () => {
    const events: ChaosEvent[] = [
      { kind: "component_failure", componentId: "c-1" as ComponentId },
      { kind: "zone_outage", zone: "us-east", durationTicks: 5 },
      { kind: "connection_sever", connectionId: "cx-1" as ConnectionId, durationTicks: 3 },
      { kind: "latency_injection", connectionId: "cx-1" as ConnectionId, extraLatency: 10, durationTicks: 2 },
    ];
    expect(events).toHaveLength(4);
  });

  it("wraps a ChaosEvent in an ActiveChaosEntry", () => {
    const entry: ActiveChaosEntry = {
      event: { kind: "component_failure", componentId: "c-1" as ComponentId },
      expiresAtTick: 10,
    };
    expect(entry.expiresAtTick).toBe(10);
  });

  it("builds an ActiveStream with mutable duration and bandwidth", () => {
    const stream: ActiveStream = {
      requestId: "r-1" as RequestId,
      connectionId: "cx-1" as ConnectionId,
      originComponentId: "c-1" as ComponentId,
      baseRevenue: 2,
      remainingDuration: 20,
      reservedBandwidth: 5,
    };
    stream.remainingDuration -= 1;
    expect(stream.remainingDuration).toBe(19);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/chaos-stream.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `chaos.ts`**

```ts
// src/core/types/chaos.ts
import type { ComponentId, ConnectionId } from "./ids.js";

export type ChaosEvent =
  | { kind: "component_failure"; componentId: ComponentId }
  | { kind: "zone_outage"; zone: string; durationTicks: number }
  | { kind: "connection_sever"; connectionId: ConnectionId; durationTicks: number }
  | { kind: "latency_injection"; connectionId: ConnectionId; extraLatency: number; durationTicks: number };

export interface ActiveChaosEntry {
  readonly event: ChaosEvent;
  readonly expiresAtTick: number;
}
```

- [ ] **Step 4: Implement `stream.ts`**

```ts
// src/core/types/stream.ts
import type { RequestId, ComponentId, ConnectionId } from "./ids.js";

export interface ActiveStream {
  readonly requestId: RequestId;
  readonly connectionId: ConnectionId;
  readonly originComponentId: ComponentId;
  readonly baseRevenue: number;
  remainingDuration: number;
  reservedBandwidth: number;
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test tests/unit/chaos-stream.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/types/chaos.ts src/core/types/stream.ts tests/unit/chaos-stream.test.ts
git commit -m "feat(core): add ChaosEvent and ActiveStream types"
```

---

## Task 8: Remaining mode/metric/outcome types

**Files:**
- Create: `src/core/types/build-constraints.ts`
- Create: `src/core/types/metrics.ts`
- Create: `src/core/types/outcome.ts`
- Create: `src/core/types/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/mode-types.test.ts
import { describe, it, expect } from "vitest";
import type {
  BuildConstraints, PlacementResult, UpgradeResult,
} from "@core/types/build-constraints";
import type { TickMetrics } from "@core/types/metrics";
import type { OutcomeReport } from "@core/types/outcome";
import type { ComponentId } from "@core/types/ids";

describe("mode boundary types", () => {
  it("PlacementResult narrows ok/fail", () => {
    const ok: PlacementResult = { ok: true, componentId: "c-1" as ComponentId };
    const fail: PlacementResult = { ok: false, reason: "insufficient_budget" };
    if (ok.ok) expect(ok.componentId).toBe("c-1");
    if (!fail.ok) expect(fail.reason).toBe("insufficient_budget");
  });

  it("UpgradeResult narrows ok/fail", () => {
    const ok: UpgradeResult = { ok: true, newPlayerTier: 2 };
    if (ok.ok) expect(ok.newPlayerTier).toBe(2);
  });

  it("BuildConstraints has available types", () => {
    const c: BuildConstraints = { availableComponentTypes: ["server", "database"] };
    expect(c.availableComponentTypes).toHaveLength(2);
  });

  it("TickMetrics is a full record", () => {
    const m: TickMetrics = {
      tick: 0, requestsProcessed: 0, requestsResolved: 0, requestsDropped: 0,
      requestsOverloaded: 0, requestsBackpressured: 0, requestsTimedOut: 0,
      revenueEarned: 0, upkeepPaid: 0, avgLatency: 0, perComponent: new Map(),
    };
    expect(m.tick).toBe(0);
  });

  it("OutcomeReport has a verdict", () => {
    const o: OutcomeReport = {
      verdict: "win",
      score: { cost: 10, performance: 90, reliability: 95, composite: 85 },
      notes: [],
    };
    expect(o.verdict).toBe("win");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/mode-types.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `build-constraints.ts`**

```ts
// src/core/types/build-constraints.ts
import type { ComponentId } from "./ids.js";

export interface BuildConstraints {
  readonly availableComponentTypes: readonly string[];
  readonly maxPlacements?: number;
  readonly zoneAllowlist?: readonly string[];
}

export type PlacementResult =
  | { ok: true; componentId: ComponentId }
  | {
      ok: false;
      reason:
        | "insufficient_budget"
        | "invalid_position"
        | "invalid_zone"
        | "disallowed_by_mode"
        | "registry_unknown_type";
      detail?: string;
    };

export type UpgradeResult =
  | { ok: true; newPlayerTier: number }
  | {
      ok: false;
      reason:
        | "insufficient_budget"
        | "max_tier_reached"
        | "disallowed_by_mode"
        | "capability_not_found";
      detail?: string;
    };
```

- [ ] **Step 4: Implement `metrics.ts`**

```ts
// src/core/types/metrics.ts
import type { ComponentId } from "./ids.js";

export interface TickMetrics {
  readonly tick: number;
  readonly requestsProcessed: number;
  readonly requestsResolved: number;
  readonly requestsDropped: number;
  readonly requestsOverloaded: number;
  readonly requestsBackpressured: number;
  readonly requestsTimedOut: number;
  readonly revenueEarned: number;
  readonly upkeepPaid: number;
  readonly avgLatency: number;
  readonly perComponent: ReadonlyMap<
    ComponentId,
    {
      processed: number;
      dropped: number;
      overloaded: number;
      backpressured: number;
      condition: number;
    }
  >;
}
```

- [ ] **Step 5: Implement `outcome.ts`**

```ts
// src/core/types/outcome.ts
export interface OutcomeReport {
  readonly verdict: "win" | "lose" | "neutral";
  readonly score: {
    readonly cost: number;
    readonly performance: number;
    readonly reliability: number;
    readonly composite: number;
  };
  readonly notes: readonly string[];
}
```

- [ ] **Step 6: Implement barrel `index.ts`**

```ts
// src/core/types/index.ts
export * from "./ids.js";
export * from "./position.js";
export * from "./phase.js";
export * from "./request.js";
export * from "./result.js";
export * from "./port.js";
export * from "./connection.js";
export * from "./condition.js";
export * from "./zone.js";
export * from "./stream.js";
export * from "./chaos.js";
export * from "./build-constraints.js";
export * from "./metrics.js";
export * from "./outcome.js";
```

- [ ] **Step 7: Run, verify pass**

Run: `pnpm test tests/unit/mode-types.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/types/ tests/unit/mode-types.test.ts
git commit -m "feat(core): add BuildConstraints, TickMetrics, OutcomeReport, types barrel"
```

---

## Task 9: DeterministicRng

**Files:**
- Create: `src/core/engine/rng.ts`
- Create: `tests/unit/rng.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/rng.test.ts
import { describe, it, expect } from "vitest";
import { createRng } from "@core/engine/rng";

describe("DeterministicRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng("seed-1");
    const b = createRng("seed-1");
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");
    expect(a.next()).not.toBe(b.next());
  });

  it("next() returns a float in [0, 1)", () => {
    const rng = createRng("seed");
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt(n) returns an int in [0, n)", () => {
    const rng = createRng("seed");
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it("fork(tag) isolates child RNG state from parent", () => {
    const parent = createRng("seed");
    const child1 = parent.fork("child");
    const parent2 = createRng("seed");
    const child2 = parent2.fork("child");
    expect(child1.next()).toBe(child2.next());
    // Parent advancing doesn't change child.
    const before = child1.next();
    parent.next(); parent.next(); parent.next();
    const child1b = createRng("seed").fork("child");
    child1b.next();
    expect(child1b.next()).toBe(before);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/rng.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `rng.ts`**

Use a minimal splitmix64-style PRNG seeded from the string via FNV-1a hashing. Fork derives the child seed by hashing `parentSeedString + "|" + tag`.

```ts
// src/core/engine/rng.ts
export interface DeterministicRng {
  next(): number;
  nextInt(maxExclusive: number): number;
  fork(purposeTag: string): DeterministicRng;
}

function hashSeed(s: string): bigint {
  // FNV-1a 64-bit
  let h = 0xcbf29ce484222325n;
  const P = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * P) & 0xffffffffffffffffn;
  }
  return h === 0n ? 0x9e3779b97f4a7c15n : h;
}

function splitmix64Next(stateRef: { s: bigint }): number {
  stateRef.s = (stateRef.s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
  let z = stateRef.s;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
  z = z ^ (z >> 31n);
  const top53 = Number(z >> 11n);
  return top53 / 2 ** 53;
}

class SplitMixRng implements DeterministicRng {
  private state: { s: bigint };
  constructor(private readonly seedString: string) {
    this.state = { s: hashSeed(seedString) };
  }
  next(): number {
    return splitmix64Next(this.state);
  }
  nextInt(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new Error("nextInt requires maxExclusive > 0");
    return Math.floor(this.next() * maxExclusive);
  }
  fork(purposeTag: string): DeterministicRng {
    return new SplitMixRng(`${this.seedString}|${purposeTag}`);
  }
}

export function createRng(seedString: string): DeterministicRng {
  return new SplitMixRng(seedString);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/rng.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/rng.ts tests/unit/rng.test.ts
git commit -m "feat(core): add DeterministicRng with splitmix64 PRNG"
```

---

## Task 10: Per-component tick counters

**Files:**
- Create: `src/core/engine/per-component-counters.ts`
- Create: `tests/unit/per-component-counters.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/per-component-counters.test.ts
import { describe, it, expect } from "vitest";
import { EMPTY_COUNTERS } from "@core/engine/per-component-counters";
import type { PerComponentTickCounters } from "@core/engine/per-component-counters";

describe("PerComponentTickCounters", () => {
  it("EMPTY_COUNTERS is fully zero", () => {
    expect(EMPTY_COUNTERS.processed).toBe(0);
    expect(EMPTY_COUNTERS.drops).toBe(0);
    expect(EMPTY_COUNTERS.timeouts).toBe(0);
    expect(EMPTY_COUNTERS.overloaded).toBe(0);
    expect(EMPTY_COUNTERS.backpressured).toBe(0);
  });

  it("EMPTY_COUNTERS is frozen", () => {
    expect(Object.isFrozen(EMPTY_COUNTERS)).toBe(true);
  });

  it("a mutable counters record increments", () => {
    const c: PerComponentTickCounters = {
      processed: 0, drops: 0, timeouts: 0, overloaded: 0, backpressured: 0,
    };
    c.processed += 1;
    expect(c.processed).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/per-component-counters.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `per-component-counters.ts`**

```ts
// src/core/engine/per-component-counters.ts
export interface PerComponentTickCounters {
  processed: number;
  drops: number;
  timeouts: number;
  overloaded: number;
  backpressured: number;
}

export const EMPTY_COUNTERS: Readonly<PerComponentTickCounters> = Object.freeze({
  processed: 0,
  drops: 0,
  timeouts: 0,
  overloaded: 0,
  backpressured: 0,
});
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/per-component-counters.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/per-component-counters.ts tests/unit/per-component-counters.test.ts
git commit -m "feat(core): add PerComponentTickCounters and EMPTY_COUNTERS"
```

---

## Task 11: Capability interface and engine sub-interfaces

**Files:**
- Create: `src/core/capability/capability.ts`
- Create: `src/core/capability/engine-interfaces.ts`
- Create: `tests/unit/capability-predicates.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/capability-predicates.test.ts
import { describe, it, expect } from "vitest";
import {
  isEngineConsultable,
  isEngineBufferable,
  isEnginePullable,
  isInstanceDirectory,
} from "@core/capability/engine-interfaces";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ConnectionId } from "@core/types/ids";

function baseCap(): Capability {
  return {
    id: "cap-x" as CapabilityId,
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

describe("engine sub-interface predicates", () => {
  it("plain capability is recognized as none", () => {
    const c = baseCap();
    expect(isEngineConsultable(c)).toBe(false);
    expect(isEngineBufferable(c)).toBe(false);
    expect(isEnginePullable(c)).toBe(false);
    expect(isInstanceDirectory(c)).toBe(false);
  });

  it("adding selectConnection makes it EngineConsultable", () => {
    const c: Capability = {
      ...baseCap(),
      selectConnection: () => "cx-1" as ConnectionId,
    } as Capability;
    expect(isEngineConsultable(c)).toBe(true);
  });

  it("adding listCandidates makes it InstanceDirectory", () => {
    const c: Capability = { ...baseCap(), listCandidates: () => [] } as Capability;
    expect(isInstanceDirectory(c)).toBe(true);
  });

  it("adding pullPending makes it EnginePullable", () => {
    const c: Capability = { ...baseCap(), pullPending: () => [] } as Capability;
    expect(isEnginePullable(c)).toBe(true);
  });

  it("adding enqueueForRetry/emitReady/dequeueBatch makes it EngineBufferable", () => {
    const c: Capability = {
      ...baseCap(),
      enqueueForRetry: () => true,
      emitReady: () => ({ awaitingPipeline: [], awaitingDelivery: [] }),
      dequeueBatch: () => [],
    } as Capability;
    expect(isEngineBufferable(c)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/capability-predicates.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `capability.ts`**

```ts
// src/core/capability/capability.ts
import type { CapabilityId } from "../types/ids.js";
import type { Phase } from "../types/phase.js";
import type { Request } from "../types/request.js";
import type { ProcessResult } from "../types/result.js";
import type { ProcessContext } from "./process-context.js";

export interface CapabilityStats {
  hitRate?: number;
  queueDepth?: number;
  latencyAdded?: number;
  [key: string]: number | undefined;
}

export interface Capability {
  readonly id: CapabilityId;
  readonly phase?: Phase;
  canHandle(requestType: string): boolean;
  process(request: Request, context: ProcessContext): ProcessResult;
  getUpkeepCost(tier: number): number;
  getThroughputPerTick?(tier: number): number;
  getStats(): CapabilityStats;
  configure?(config: unknown): void;
  resetPerTickState?(): void;
}
```

- [ ] **Step 4: Implement `engine-interfaces.ts`**

```ts
// src/core/capability/engine-interfaces.ts
import type { Capability } from "./capability.js";
import type { Connection } from "../types/connection.js";
import type { ConnectionId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { ProcessResult } from "../types/result.js";
import type { ProcessContext, PullContext } from "./process-context.js";
import type { ComponentId } from "../types/ids.js";

export interface EngineConsultable {
  selectConnection(
    request: Request,
    egressConnections: Connection[],
    context: ProcessContext,
  ): ConnectionId;
}

export interface EngineBufferable {
  enqueueForRetry(request: Request, result: ProcessResult): boolean;
  emitReady(): {
    awaitingPipeline: Request[];
    awaitingDelivery: { request: Request; result: ProcessResult }[];
  };
  dequeueBatch(n: number): Request[];
}

export interface EnginePullable {
  pullPending(context: PullContext): Request[];
}

export interface ComponentRef {
  readonly componentId: ComponentId;
  readonly componentType: string;
  readonly zone: string | null;
  readonly condition: number;
}

export interface InstanceDirectory {
  listCandidates(query: {
    componentType?: string;
    zone?: string;
    healthyOnly?: boolean;
  }): ComponentRef[];
}

export function isEngineConsultable(
  c: Capability,
): c is Capability & EngineConsultable {
  return typeof (c as unknown as EngineConsultable).selectConnection === "function";
}

export function isEngineBufferable(
  c: Capability,
): c is Capability & EngineBufferable {
  return typeof (c as unknown as EngineBufferable).enqueueForRetry === "function";
}

export function isEnginePullable(
  c: Capability,
): c is Capability & EnginePullable {
  return typeof (c as unknown as EnginePullable).pullPending === "function";
}

export function isInstanceDirectory(
  c: Capability,
): c is Capability & InstanceDirectory {
  return typeof (c as unknown as InstanceDirectory).listCandidates === "function";
}
```

- [ ] **Step 5: Create `process-context.ts` placeholder (full impl in Task 12)**

```ts
// src/core/capability/process-context.ts
import type { CapabilityId, ComponentId, RequestId } from "../types/ids.js";
import type { DeterministicRng } from "../engine/rng.js";
import type { InstanceDirectory } from "./engine-interfaces.js";
import type { SimulationStateReader } from "../state/state-reader.js";

export interface ProcessContext {
  readonly state: SimulationStateReader;
  readonly componentId: ComponentId;
  readonly effectiveTier: number;
  readonly effectiveTiers: ReadonlyMap<CapabilityId, number>;
  readonly activeCapabilityIds: ReadonlySet<CapabilityId>;
  readonly currentTick: number;
  readonly rng: DeterministicRng;
  readonly directories: readonly InstanceDirectory[];
}

export interface PullContext {
  readonly state: SimulationStateReader;
  readonly componentId: ComponentId;
  readonly currentTick: number;
}
```

Note: `SimulationStateReader` is defined in Task 16 — the file will currently typecheck-fail until then. This is expected. Committing is deferred to the end of this task; the test is also deferred.

Actually, to keep the task self-contained and testable, provide a minimal stub `state-reader.ts` now so the typecheck passes, then replace it in Task 16.

- [ ] **Step 6: Create minimal stub `state-reader.ts`**

```ts
// src/core/state/state-reader.ts
// Stub — replaced in Task 16.
export interface SimulationStateReader {
  readonly currentTick: number;
}
```

- [ ] **Step 7: Run the predicate test, verify pass**

Run: `pnpm test tests/unit/capability-predicates.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/core/capability/ src/core/state/state-reader.ts tests/unit/capability-predicates.test.ts
git commit -m "feat(core): add Capability interface and engine sub-interface predicates"
```

---

## Task 12: ComponentReader interface

**Files:**
- Create: `src/core/component/component-reader.ts`

- [ ] **Step 1: Write a type-level test**

```ts
// tests/unit/component-reader.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { ComponentReader } from "@core/component/component-reader";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId } from "@core/types/ids";

describe("ComponentReader", () => {
  it("exposes only read methods and readonly fields", () => {
    type Reader = ComponentReader;
    // getPlayerTier takes a CapabilityId and returns number
    expectTypeOf<Reader["getPlayerTier"]>().parameters
      .toEqualTypeOf<[CapabilityId]>();
    expectTypeOf<Reader["getPlayerTier"]>().returns.toEqualTypeOf<number>();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/component-reader.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `component-reader.ts`**

```ts
// src/core/component/component-reader.ts
import type { CapabilityId, ComponentId, PortId } from "../types/ids.js";
import type { Port } from "../types/port.js";
import type { Position } from "../types/position.js";
import type { ConditionProfile } from "../types/condition.js";
import type { Capability } from "../capability/capability.js";

export interface ComponentReader {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly placementTick: number;
  readonly position: Readonly<Position>;
  readonly zone: string | null;
  readonly instanceCount: number;
  readonly condition: number;
  readonly conditionProfile: ConditionProfile;

  getPlayerTier(capabilityId: CapabilityId): number;
  getCapabilityIds(): readonly CapabilityId[];
  getCapabilityByInterface<T>(
    predicate: (c: Capability) => c is Capability & T,
  ): (Capability & T) | null;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/component-reader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/component/component-reader.ts tests/unit/component-reader.test.ts
git commit -m "feat(core): add ComponentReader interface"
```

---

## Task 13: Component class (constructor + read methods + pipeline runner)

**Files:**
- Create: `src/core/component/component.ts`
- Create: `tests/unit/component.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/component.test.ts
import { describe, it, expect } from "vitest";
import { Component, type ComponentConstructorArgs } from "@core/component/component";
import type { Capability } from "@core/capability/capability";
import type { ProcessResult } from "@core/types/result";
import type {
  CapabilityId, ComponentId, PortId,
} from "@core/types/ids";
import type { Port } from "@core/types/port";
import type { ConditionProfile } from "@core/types/condition";

const profile: ConditionProfile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0.1,
  recoveryRate: 0.05,
  degradedEffects: [],
  criticalEffects: [],
};

function makeCap(id: string, phase: "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE",
                 outcome: ProcessResult["outcome"]): Capability {
  return {
    id: id as CapabilityId,
    phase,
    canHandle: () => true,
    process: () => ({ outcome, sideEffects: [], events: [] }),
    getUpkeepCost: () => 1,
    getStats: () => ({}),
  };
}

function baseArgs(overrides: Partial<ComponentConstructorArgs> = {}): ComponentConstructorArgs {
  const caps = new Map<CapabilityId, Capability>();
  caps.set("cap-a" as CapabilityId, makeCap("cap-a", "PROCESS", { kind: "PASS" }));
  const tiers = new Map<CapabilityId, number>();
  tiers.set("cap-a" as CapabilityId, 1);
  const ports: Port[] = [];
  return {
    id: "c-1" as ComponentId,
    type: "server",
    name: "Server",
    description: "",
    capabilities: caps,
    initialTiers: tiers,
    ports,
    placementCost: 10,
    position: { x: 0, y: 0 },
    zone: null,
    placementTick: 0,
    conditionProfile: profile,
    ...overrides,
  };
}

describe("Component", () => {
  it("constructor seeds tiers and defaults", () => {
    const c = new Component(baseArgs());
    expect(c.id).toBe("c-1");
    expect(c.instanceCount).toBe(1);
    expect(c.condition).toBe(1);
    expect(c.getPlayerTier("cap-a" as CapabilityId)).toBe(1);
    expect(c.getPlayerTier("cap-missing" as CapabilityId)).toBe(0);
  });

  it("getCapabilityIds lists registered capabilities", () => {
    const c = new Component(baseArgs());
    expect(c.getCapabilityIds()).toEqual(["cap-a"]);
  });

  it("upgrade() clamps to registryMaxTier", () => {
    const c = new Component(baseArgs());
    c.upgrade("cap-a" as CapabilityId, 3);
    expect(c.getPlayerTier("cap-a" as CapabilityId)).toBe(2);
    c.upgrade("cap-a" as CapabilityId, 3);
    expect(c.getPlayerTier("cap-a" as CapabilityId)).toBe(3);
    // Further upgrade exceeds max — caller should prevent, but the method caps.
    c.upgrade("cap-a" as CapabilityId, 3);
    expect(c.getPlayerTier("cap-a" as CapabilityId)).toBe(3);
  });

  it("getCapabilitiesByPhase filters by phase", () => {
    const caps = new Map<CapabilityId, Capability>();
    caps.set("i1" as CapabilityId, makeCap("i1", "INTERCEPT", { kind: "PASS" }));
    caps.set("p1" as CapabilityId, makeCap("p1", "PROCESS", { kind: "PASS" }));
    const tiers = new Map<CapabilityId, number>([
      ["i1" as CapabilityId, 1],
      ["p1" as CapabilityId, 1],
    ]);
    const c = new Component(baseArgs({ capabilities: caps, initialTiers: tiers }));
    expect(c.getCapabilitiesByPhase("INTERCEPT").map(x => x.id)).toEqual(["i1"]);
    expect(c.getCapabilitiesByPhase("PROCESS").map(x => x.id)).toEqual(["p1"]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/component.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `component.ts`** (constructor + read methods; pipeline runner added in Task 15)

```ts
// src/core/component/component.ts
import type {
  CapabilityId, ComponentId,
} from "../types/ids.js";
import type { Port } from "../types/port.js";
import type { Position } from "../types/position.js";
import type { Phase } from "../types/phase.js";
import type { ConditionProfile } from "../types/condition.js";
import type { Capability } from "../capability/capability.js";
import type { ComponentReader } from "./component-reader.js";

export interface ComponentConstructorArgs {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: ReadonlyMap<CapabilityId, Capability>;
  readonly initialTiers: ReadonlyMap<CapabilityId, number>;
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly position: Position;
  readonly zone: string | null;
  readonly placementTick: number;
  readonly conditionProfile: ConditionProfile;
  readonly initialInstanceCount?: number;
  readonly initialCondition?: number;
}

export class Component implements ComponentReader {
  readonly id: ComponentId;
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: ReadonlyMap<CapabilityId, Capability>;
  private capabilityTiers: Map<CapabilityId, number>;
  readonly ports: readonly Port[];
  readonly placementCost: number;
  readonly placementTick: number;
  position: Position;
  zone: string | null;
  instanceCount: number;
  condition: number;
  readonly conditionProfile: ConditionProfile;

  constructor(args: ComponentConstructorArgs) {
    this.id = args.id;
    this.type = args.type;
    this.name = args.name;
    this.description = args.description;
    this.capabilities = args.capabilities;
    this.capabilityTiers = new Map(args.initialTiers);
    this.ports = args.ports;
    this.placementCost = args.placementCost;
    this.placementTick = args.placementTick;
    this.position = args.position;
    this.zone = args.zone;
    this.conditionProfile = args.conditionProfile;
    this.instanceCount = args.initialInstanceCount ?? 1;
    this.condition = args.initialCondition ?? 1.0;
  }

  getPlayerTier(capabilityId: CapabilityId): number {
    return this.capabilityTiers.get(capabilityId) ?? 0;
  }

  getCapabilityIds(): readonly CapabilityId[] {
    return [...this.capabilities.keys()];
  }

  getCapabilitiesByPhase(phase: Phase): Capability[] {
    const result: Capability[] = [];
    for (const cap of this.capabilities.values()) {
      if (cap.phase === phase) result.push(cap);
    }
    return result;
  }

  getCapabilityByInterface<T>(
    predicate: (c: Capability) => c is Capability & T,
  ): (Capability & T) | null {
    for (const cap of this.capabilities.values()) {
      if (predicate(cap)) return cap;
    }
    return null;
  }

  upgrade(capabilityId: CapabilityId, registryMaxTier: number): void {
    const current = this.capabilityTiers.get(capabilityId) ?? 0;
    const next = Math.min(current + 1, registryMaxTier);
    this.capabilityTiers.set(capabilityId, next);
  }

  resetPerTickState(): void {
    for (const cap of this.capabilities.values()) {
      cap.resetPerTickState?.();
    }
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/component.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/component/component.ts tests/unit/component.test.ts
git commit -m "feat(core): add Component class with constructor and read methods"
```

---

## Task 14: getEffectiveTier and computeEffectiveTiers

**Files:**
- Create: `src/core/component/effective-tier.ts`
- Create: `tests/unit/effective-tier.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/effective-tier.test.ts
import { describe, it, expect } from "vitest";
import { getEffectiveTier, computeEffectiveTiers } from "@core/component/effective-tier";
import { Component } from "@core/component/component";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { ComponentReader } from "@core/component/component-reader";
import type { ModeController } from "@core/mode/mode-controller";

const profile = {
  degradedThreshold: 0.6, criticalThreshold: 0.3,
  decayRate: 0.1, recoveryRate: 0.05,
  degradedEffects: [], criticalEffects: [],
};

function makeCap(id: string): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

function makeComp(): Component {
  const caps = new Map<CapabilityId, Capability>([
    ["cap-a" as CapabilityId, makeCap("cap-a")],
    ["cap-b" as CapabilityId, makeCap("cap-b")],
  ]);
  const tiers = new Map<CapabilityId, number>([
    ["cap-a" as CapabilityId, 3],
    ["cap-b" as CapabilityId, 1],
  ]);
  return new Component({
    id: "c-1" as ComponentId,
    type: "server", name: "Server", description: "",
    capabilities: caps, initialTiers: tiers, ports: [],
    placementCost: 0, position: { x: 0, y: 0 }, zone: null,
    placementTick: 0, conditionProfile: profile,
  });
}

function mockMode(caps: Record<string, number>): ModeController {
  return {
    getTierCap: (_comp: ComponentReader, id: CapabilityId) =>
      caps[id as unknown as string] ?? Infinity,
  } as unknown as ModeController;
}

describe("getEffectiveTier", () => {
  it("returns min of player tier and mode cap", () => {
    const comp = makeComp();
    const mode = mockMode({ "cap-a": 2 });
    expect(getEffectiveTier(comp, "cap-a" as CapabilityId, mode)).toBe(2);
  });

  it("returns player tier when mode cap is Infinity", () => {
    const comp = makeComp();
    const mode = mockMode({});
    expect(getEffectiveTier(comp, "cap-a" as CapabilityId, mode)).toBe(3);
  });

  it("returns 0 for unknown capability", () => {
    const comp = makeComp();
    const mode = mockMode({});
    expect(getEffectiveTier(comp, "cap-zzz" as CapabilityId, mode)).toBe(0);
  });
});

describe("computeEffectiveTiers", () => {
  it("builds a full map across component capabilities", () => {
    const comp = makeComp();
    const mode = mockMode({ "cap-a": 2 });
    const map = computeEffectiveTiers(comp, mode);
    expect(map.get("cap-a" as CapabilityId)).toBe(2);
    expect(map.get("cap-b" as CapabilityId)).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/effective-tier.test.ts`
Expected: FAIL (module + ModeController not found)

- [ ] **Step 3: Create an abstract `ModeController` stub so effective-tier can import its type**

```ts
// src/core/mode/mode-controller.ts
// Stub — full interface added in Task 20.
import type { ComponentReader } from "../component/component-reader.js";
import type { CapabilityId } from "../types/ids.js";

export interface ModeController {
  getTierCap(component: ComponentReader, capabilityId: CapabilityId): number;
}
```

- [ ] **Step 4: Implement `effective-tier.ts`**

```ts
// src/core/component/effective-tier.ts
import type { CapabilityId } from "../types/ids.js";
import type { ComponentReader } from "./component-reader.js";
import type { ModeController } from "../mode/mode-controller.js";

export function getEffectiveTier(
  component: ComponentReader,
  capabilityId: CapabilityId,
  modeController: ModeController,
): number {
  const playerTier = component.getPlayerTier(capabilityId);
  const modeCap = modeController.getTierCap(component, capabilityId);
  return Math.min(playerTier, modeCap);
}

export function computeEffectiveTiers(
  component: ComponentReader,
  modeController: ModeController,
): ReadonlyMap<CapabilityId, number> {
  const result = new Map<CapabilityId, number>();
  for (const capId of component.getCapabilityIds()) {
    result.set(capId, getEffectiveTier(component, capId, modeController));
  }
  return result;
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test tests/unit/effective-tier.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/component/effective-tier.ts src/core/mode/mode-controller.ts tests/unit/effective-tier.test.ts
git commit -m "feat(core): add getEffectiveTier and computeEffectiveTiers"
```

---

## Task 15: Component pipeline runner (process method)

**Files:**
- Modify: `src/core/component/component.ts`
- Create: `tests/unit/component-pipeline.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/component-pipeline.test.ts
import { describe, it, expect } from "vitest";
import { Component } from "@core/component/component";
import type { Capability } from "@core/capability/capability";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessResult } from "@core/types/result";
import { createRng } from "@core/engine/rng";

const profile = {
  degradedThreshold: 0.6, criticalThreshold: 0.3,
  decayRate: 0, recoveryRate: 0, degradedEffects: [], criticalEffects: [],
};

function stubCap(
  id: string,
  phase: "INTERCEPT" | "PROCESS" | "REPLICATE" | "OBSERVE",
  outcome: ProcessResult["outcome"],
  callLog: string[],
): Capability {
  return {
    id: id as CapabilityId,
    phase,
    canHandle: () => true,
    process: () => {
      callLog.push(id);
      return { outcome, sideEffects: [], events: [] };
    },
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

function ctx(active: CapabilityId[]): ProcessContext {
  return {
    state: { currentTick: 0 } as any,
    componentId: "c-1" as ComponentId,
    effectiveTier: 1,
    effectiveTiers: new Map(active.map(id => [id, 1])),
    activeCapabilityIds: new Set(active),
    currentTick: 0,
    rng: createRng("t"),
    directories: [],
  };
}

function req(): Request {
  return {
    id: "r-1" as RequestId, parentId: null, type: "api_read", payload: null,
    origin: "c-client" as ComponentId, createdAt: 0, ttl: 10,
    originZone: null, streamDuration: null, streamBandwidth: null,
  };
}

describe("Component.process pipeline runner", () => {
  it("runs phases in INTERCEPT → PROCESS → REPLICATE → OBSERVE order", () => {
    const log: string[] = [];
    const caps = new Map<CapabilityId, Capability>([
      ["obs" as CapabilityId, stubCap("obs", "OBSERVE", { kind: "PASS" }, log)],
      ["proc" as CapabilityId, stubCap("proc", "PROCESS", { kind: "PASS" }, log)],
      ["rep" as CapabilityId, stubCap("rep", "REPLICATE", { kind: "PASS" }, log)],
      ["int" as CapabilityId, stubCap("int", "INTERCEPT", { kind: "PASS" }, log)],
    ]);
    const tiers = new Map<CapabilityId, number>(
      [...caps.keys()].map(k => [k, 1]),
    );
    const comp = new Component({
      id: "c-1" as ComponentId, type: "server", name: "S", description: "",
      capabilities: caps, initialTiers: tiers, ports: [],
      placementCost: 0, position: { x: 0, y: 0 }, zone: null,
      placementTick: 0, conditionProfile: profile,
    });
    comp.process(req(), ctx(["int", "proc", "rep", "obs"] as CapabilityId[]));
    expect(log).toEqual(["int", "proc", "rep", "obs"]);
  });

  it("INTERCEPT RESPOND short-circuits later phases", () => {
    const log: string[] = [];
    const caps = new Map<CapabilityId, Capability>([
      ["int" as CapabilityId, stubCap("int", "INTERCEPT", { kind: "RESPOND" }, log)],
      ["proc" as CapabilityId, stubCap("proc", "PROCESS", { kind: "PASS" }, log)],
    ]);
    const tiers = new Map<CapabilityId, number>([
      ["int" as CapabilityId, 1], ["proc" as CapabilityId, 1],
    ]);
    const comp = new Component({
      id: "c-1" as ComponentId, type: "server", name: "S", description: "",
      capabilities: caps, initialTiers: tiers, ports: [],
      placementCost: 0, position: { x: 0, y: 0 }, zone: null,
      placementTick: 0, conditionProfile: profile,
    });
    const r = comp.process(req(), ctx(["int", "proc"] as CapabilityId[]));
    expect(log).toEqual(["int"]);
    expect(r.outcome.kind).toBe("RESPOND");
  });

  it("only one PROCESS capability runs (first canHandle match)", () => {
    const log: string[] = [];
    const caps = new Map<CapabilityId, Capability>([
      ["p1" as CapabilityId, stubCap("p1", "PROCESS", { kind: "RESPOND" }, log)],
      ["p2" as CapabilityId, stubCap("p2", "PROCESS", { kind: "RESPOND" }, log)],
    ]);
    const tiers = new Map<CapabilityId, number>([
      ["p1" as CapabilityId, 1], ["p2" as CapabilityId, 1],
    ]);
    const comp = new Component({
      id: "c-1" as ComponentId, type: "server", name: "S", description: "",
      capabilities: caps, initialTiers: tiers, ports: [],
      placementCost: 0, position: { x: 0, y: 0 }, zone: null,
      placementTick: 0, conditionProfile: profile,
    });
    comp.process(req(), ctx(["p1", "p2"] as CapabilityId[]));
    expect(log).toEqual(["p1"]);
  });

  it("skips capabilities not in activeCapabilityIds", () => {
    const log: string[] = [];
    const caps = new Map<CapabilityId, Capability>([
      ["int" as CapabilityId, stubCap("int", "INTERCEPT", { kind: "PASS" }, log)],
      ["proc" as CapabilityId, stubCap("proc", "PROCESS", { kind: "PASS" }, log)],
    ]);
    const tiers = new Map<CapabilityId, number>([
      ["int" as CapabilityId, 1], ["proc" as CapabilityId, 1],
    ]);
    const comp = new Component({
      id: "c-1" as ComponentId, type: "server", name: "S", description: "",
      capabilities: caps, initialTiers: tiers, ports: [],
      placementCost: 0, position: { x: 0, y: 0 }, zone: null,
      placementTick: 0, conditionProfile: profile,
    });
    comp.process(req(), ctx(["proc"] as CapabilityId[]));
    expect(log).toEqual(["proc"]);
  });

  it("defaults to PASS outcome when no capability resolves", () => {
    const comp = new Component({
      id: "c-1" as ComponentId, type: "server", name: "S", description: "",
      capabilities: new Map(), initialTiers: new Map(), ports: [],
      placementCost: 0, position: { x: 0, y: 0 }, zone: null,
      placementTick: 0, conditionProfile: profile,
    });
    const r = comp.process(req(), ctx([]));
    expect(r.outcome.kind).toBe("PASS");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/component-pipeline.test.ts`
Expected: FAIL — `comp.process is not a function`

- [ ] **Step 3: Extend `Component` with `process()`**

Append to `src/core/component/component.ts`:

```ts
// Added after resetPerTickState:

  process(
    request: import("../types/request.js").Request,
    context: import("../capability/process-context.js").ProcessContext,
  ): import("../types/result.js").ProcessResult {
    const events: import("../types/request.js").RequestEvent[] = [];
    const sideEffects: import("../types/result.js").SideEffect[] = [];
    let outcome: import("../types/result.js").PrimaryOutcome = { kind: "PASS" };

    const runPhase = (phase: import("../types/phase.js").Phase, onePerRequest: boolean): boolean => {
      const caps = this.getCapabilitiesByPhase(phase);
      for (const cap of caps) {
        if (!context.activeCapabilityIds.has(cap.id)) continue;
        if (!cap.canHandle(request.type)) continue;
        const result = cap.process(request, context);
        for (const ev of result.events) events.push(ev);
        for (const se of result.sideEffects) sideEffects.push(se);
        if (result.outcome.kind !== "PASS") {
          outcome = result.outcome;
          // Short-circuits INTERCEPT and always honours first non-PASS PROCESS result.
          return true;
        }
        if (onePerRequest) return false; // one-per-request rule: stop PROCESS after first candidate regardless
      }
      return false;
    };

    // INTERCEPT — first non-PASS short-circuits the whole pipeline.
    if (runPhase("INTERCEPT", false)) {
      return { outcome, sideEffects, events };
    }

    // PROCESS — only one matching PROCESS capability runs.
    runPhase("PROCESS", true);

    // REPLICATE — all matching capabilities run; they append SPAWNs but do not
    // override the primary outcome. We run them without mutating `outcome`.
    {
      const caps = this.getCapabilitiesByPhase("REPLICATE");
      for (const cap of caps) {
        if (!context.activeCapabilityIds.has(cap.id)) continue;
        if (!cap.canHandle(request.type)) continue;
        const result = cap.process(request, context);
        for (const ev of result.events) events.push(ev);
        for (const se of result.sideEffects) sideEffects.push(se);
        // Intentionally ignore result.outcome — REPLICATE is additive.
      }
    }

    // OBSERVE — always runs, read-only by convention.
    {
      const caps = this.getCapabilitiesByPhase("OBSERVE");
      for (const cap of caps) {
        if (!context.activeCapabilityIds.has(cap.id)) continue;
        const result = cap.process(request, context);
        for (const ev of result.events) events.push(ev);
        // OBSERVE side effects and outcomes are ignored in Stage 1.
      }
    }

    return { outcome, sideEffects, events };
  }
```

Also add `getThroughputPerTick` and `getUpkeepCost` stubs that sum across capabilities (needed by ComponentReader consumers in later stages; harmless for Stage 1):

```ts
  getThroughputPerTick(
    activeCapabilityIds: ReadonlySet<import("../types/ids.js").CapabilityId>,
    effectiveTiers: ReadonlyMap<import("../types/ids.js").CapabilityId, number>,
  ): number {
    let sum = 0;
    for (const [id, cap] of this.capabilities) {
      if (!activeCapabilityIds.has(id)) continue;
      if (cap.phase !== "PROCESS") continue;
      const tier = effectiveTiers.get(id) ?? 0;
      sum += cap.getThroughputPerTick?.(tier) ?? 0;
    }
    return sum * this.instanceCount;
  }

  getUpkeepCost(
    activeCapabilityIds: ReadonlySet<import("../types/ids.js").CapabilityId>,
    effectiveTiers: ReadonlyMap<import("../types/ids.js").CapabilityId, number>,
  ): number {
    let sum = 0;
    for (const [id, cap] of this.capabilities) {
      if (!activeCapabilityIds.has(id)) continue;
      const tier = effectiveTiers.get(id) ?? 0;
      sum += cap.getUpkeepCost(tier);
    }
    return sum * this.instanceCount;
  }
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/component-pipeline.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `pnpm test`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add src/core/component/component.ts tests/unit/component-pipeline.test.ts
git commit -m "feat(core): add Component.process pipeline runner"
```

---

## Task 16: SimulationState and SimulationStateReader

**Files:**
- Create: `src/core/state/simulation-state.ts`
- Modify: `src/core/state/state-reader.ts` (replace stub)
- Create: `tests/unit/simulation-state.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/simulation-state.test.ts
import { describe, it, expect } from "vitest";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import type { ComponentId, ConnectionId, PortId, RequestId } from "@core/types/ids";
import type { Connection } from "@core/types/connection";
import type { Request } from "@core/types/request";
import type { ActiveStream } from "@core/types/stream";

const profile = {
  degradedThreshold: 0.6, criticalThreshold: 0.3,
  decayRate: 0, recoveryRate: 0, degradedEffects: [], criticalEffects: [],
};

function makeComp(id: string): Component {
  return new Component({
    id: id as ComponentId, type: "server", name: "S", description: "",
    capabilities: new Map(), initialTiers: new Map(), ports: [],
    placementCost: 0, position: { x: 0, y: 0 }, zone: null,
    placementTick: 0, conditionProfile: profile,
  });
}

function makeConn(id: string, from: string, to: string): Connection {
  return {
    id: id as ConnectionId,
    source: { componentId: from as ComponentId, portId: "p" as PortId },
    target: { componentId: to as ComponentId, portId: "p" as PortId },
    bandwidth: 10, latency: 1, currentLoad: 0,
  };
}

function makeReq(id: string): Request {
  return {
    id: id as RequestId, parentId: null, type: "api_read", payload: null,
    origin: "c-a" as ComponentId, createdAt: 0, ttl: 10,
    originZone: null, streamDuration: null, streamBandwidth: null,
  };
}

describe("SimulationState", () => {
  it("placeComponent adds to components map", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const c = makeComp("c-a");
    state.placeComponent(c);
    expect(state.components.get("c-a" as ComponentId)).toBe(c);
  });

  it("enqueuePending and dequeuePending operate FIFO", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("c-a"));
    state.enqueuePending("c-a" as ComponentId, makeReq("r-1"));
    state.enqueuePending("c-a" as ComponentId, makeReq("r-2"));
    const first = state.dequeuePending("c-a" as ComponentId);
    const second = state.dequeuePending("c-a" as ComponentId);
    expect(first?.id).toBe("r-1");
    expect(second?.id).toBe("r-2");
    expect(state.dequeuePending("c-a" as ComponentId)).toBeUndefined();
  });

  it("appendEvent stores events keyed by request id", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.appendEvent("r-1" as RequestId, {
      tick: 0, componentId: "c-a" as ComponentId,
      capabilityId: null, connectionId: null,
      type: "ENTERED", latencyAdded: 0,
    });
    expect(state.requestLog.get("r-1" as RequestId)).toHaveLength(1);
  });

  it("advanceTick increments currentTick", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    expect(state.currentTick).toBe(0);
    state.advanceTick();
    expect(state.currentTick).toBe(1);
  });

  it("addConnection/removeConnection manage connections map", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("c-a"));
    state.placeComponent(makeComp("c-b"));
    state.addConnection(makeConn("cx-1", "c-a", "c-b"));
    expect(state.connections.has("cx-1" as ConnectionId)).toBe(true);
    state.removeConnection("cx-1" as ConnectionId);
    expect(state.connections.has("cx-1" as ConnectionId)).toBe(false);
  });

  it("registerActiveStream and releaseActiveStream manage streams", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    const s: ActiveStream = {
      requestId: "r-1" as RequestId,
      connectionId: "cx-1" as ConnectionId,
      originComponentId: "c-a" as ComponentId,
      baseRevenue: 1, remainingDuration: 5, reservedBandwidth: 2,
    };
    state.registerActiveStream(s);
    expect(state.activeStreams.get("r-1" as RequestId)).toBe(s);
    state.releaseActiveStream("r-1" as RequestId);
    expect(state.activeStreams.has("r-1" as RequestId)).toBe(false);
  });

  it("setCondition clamps 0..1 and setInstanceCount updates the component", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("c-a"));
    state.setCondition("c-a" as ComponentId, 0.5);
    expect(state.components.get("c-a" as ComponentId)!.condition).toBe(0.5);
    state.setInstanceCount("c-a" as ComponentId, 3);
    expect(state.components.get("c-a" as ComponentId)!.instanceCount).toBe(3);
  });

  it("asReader narrows components to ComponentReader", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });
    state.placeComponent(makeComp("c-a"));
    const reader = state.asReader();
    const c = reader.components.get("c-a" as ComponentId);
    expect(c?.id).toBe("c-a");
    // Compile-time check: no upgrade() on ComponentReader
    // @ts-expect-error upgrade is not on ComponentReader
    c?.upgrade;
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/simulation-state.test.ts`
Expected: FAIL

- [ ] **Step 3: Replace `state-reader.ts` with the full interface**

```ts
// src/core/state/state-reader.ts
import type { ComponentId, ConnectionId, RequestId } from "../types/ids.js";
import type { Connection } from "../types/connection.js";
import type { ComponentReader } from "../component/component-reader.js";
import type { ZoneTopology } from "../types/zone.js";
import type { RequestEvent } from "../types/request.js";
import type { ActiveStream } from "../types/stream.js";
import type { ActiveChaosEntry } from "../types/chaos.js";

export interface SimulationStateReader {
  readonly components: ReadonlyMap<ComponentId, ComponentReader>;
  readonly connections: ReadonlyMap<ConnectionId, Readonly<Connection>>;
  readonly zoneTopology: ZoneTopology;
  readonly currentTick: number;
  readonly phase: "build" | "simulate" | "assess";
  getEventsFor(requestId: RequestId): readonly RequestEvent[];
  getActiveStreamsOnConnection(connectionId: ConnectionId): readonly ActiveStream[];
  getActiveChaos(): readonly ActiveChaosEntry[];
}
```

- [ ] **Step 4: Implement `simulation-state.ts`**

```ts
// src/core/state/simulation-state.ts
import type { ComponentId, ConnectionId, RequestId } from "../types/ids.js";
import type { Connection } from "../types/connection.js";
import type { Request, RequestEvent } from "../types/request.js";
import type { ActiveStream } from "../types/stream.js";
import type { ActiveChaosEntry } from "../types/chaos.js";
import type { ZoneTopology } from "../types/zone.js";
import { Component } from "../component/component.js";
import type { SimulationStateReader } from "./state-reader.js";
import type { PerComponentTickCounters } from "../engine/per-component-counters.js";

export class SimulationState {
  readonly components: Map<ComponentId, Component> = new Map();
  readonly connections: Map<ConnectionId, Connection> = new Map();
  readonly pending: Map<ComponentId, Request[]> = new Map();
  readonly activeStreams: Map<RequestId, ActiveStream> = new Map();
  readonly requestLog: Map<RequestId, RequestEvent[]> = new Map();
  readonly activeChaos: Map<string, ActiveChaosEntry> = new Map();
  readonly zoneTopology: ZoneTopology;
  currentTick = 0;
  phase: "build" | "simulate" | "assess" = "build";
  readonly perComponentThisTick: Map<ComponentId, PerComponentTickCounters> = new Map();
  connectionLoadThisTick: Map<ConnectionId, number> = new Map();

  constructor(zoneTopology: ZoneTopology) {
    this.zoneTopology = zoneTopology;
  }

  placeComponent(c: Component): void {
    this.components.set(c.id, c);
    if (!this.pending.has(c.id)) this.pending.set(c.id, []);
  }

  removeComponent(id: ComponentId): void {
    this.components.delete(id);
    this.pending.delete(id);
  }

  addConnection(c: Connection): void {
    this.connections.set(c.id, c);
  }

  removeConnection(id: ConnectionId): void {
    this.connections.delete(id);
  }

  appendEvent(requestId: RequestId, event: RequestEvent): void {
    const arr = this.requestLog.get(requestId) ?? [];
    arr.push(event);
    this.requestLog.set(requestId, arr);
  }

  enqueuePending(componentId: ComponentId, request: Request): void {
    const arr = this.pending.get(componentId) ?? [];
    arr.push(request);
    this.pending.set(componentId, arr);
  }

  dequeuePending(componentId: ComponentId): Request | undefined {
    const arr = this.pending.get(componentId);
    if (!arr || arr.length === 0) return undefined;
    return arr.shift();
  }

  registerActiveStream(stream: ActiveStream): void {
    this.activeStreams.set(stream.requestId, stream);
  }

  releaseActiveStream(requestId: RequestId): void {
    this.activeStreams.delete(requestId);
  }

  incrementProcessedCount(componentId: ComponentId): void {
    const counters = this.perComponentThisTick.get(componentId) ?? {
      processed: 0, drops: 0, timeouts: 0, overloaded: 0, backpressured: 0,
    };
    counters.processed += 1;
    this.perComponentThisTick.set(componentId, counters);
  }

  incrementConnectionLoad(connectionId: ConnectionId, amount: number): void {
    const prev = this.connectionLoadThisTick.get(connectionId) ?? 0;
    this.connectionLoadThisTick.set(connectionId, prev + amount);
    const conn = this.connections.get(connectionId);
    if (conn) conn.currentLoad = prev + amount;
  }

  setCondition(componentId: ComponentId, value: number): void {
    const comp = this.components.get(componentId);
    if (!comp) return;
    comp.condition = Math.max(0, Math.min(1, value));
  }

  setInstanceCount(componentId: ComponentId, count: number): void {
    const comp = this.components.get(componentId);
    if (!comp) return;
    comp.instanceCount = Math.max(0, count);
  }

  advanceTick(): void {
    this.currentTick += 1;
  }

  asReader(): SimulationStateReader {
    const self = this;
    return {
      components: self.components as ReadonlyMap<ComponentId, Component>,
      connections: self.connections,
      zoneTopology: self.zoneTopology,
      get currentTick() { return self.currentTick; },
      get phase() { return self.phase; },
      getEventsFor: (id) => self.requestLog.get(id) ?? [],
      getActiveStreamsOnConnection: (connId) => {
        const result: ActiveStream[] = [];
        for (const s of self.activeStreams.values()) {
          if (s.connectionId === connId) result.push(s);
        }
        return result;
      },
      getActiveChaos: () => [...self.activeChaos.values()],
    };
  }
}
```

- [ ] **Step 5: Create `src/core/state/index.ts`**

```ts
// src/core/state/index.ts
export { SimulationState } from "./simulation-state.js";
export type { SimulationStateReader } from "./state-reader.js";
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm test tests/unit/simulation-state.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/core/state/ tests/unit/simulation-state.test.ts
git commit -m "feat(core): add SimulationState and SimulationStateReader"
```

---

## Task 17: CapabilityRegistry

**Files:**
- Create: `src/core/registry/capability-registry.ts`
- Create: `tests/unit/capability-registry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/capability-registry.test.ts
import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId } from "@core/types/ids";

function stub(id: string): Capability {
  return {
    id: id as CapabilityId,
    phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0,
    getStats: () => ({}),
  };
}

describe("CapabilityRegistry", () => {
  it("register + get round-trip", () => {
    const reg = new CapabilityRegistry();
    reg.register({ id: "cap-a" as CapabilityId, factory: () => stub("cap-a") });
    const entry = reg.get("cap-a" as CapabilityId);
    expect(entry?.id).toBe("cap-a");
    expect(entry?.factory().id).toBe("cap-a");
  });

  it("throws on duplicate registration", () => {
    const reg = new CapabilityRegistry();
    reg.register({ id: "cap-a" as CapabilityId, factory: () => stub("cap-a") });
    expect(() =>
      reg.register({ id: "cap-a" as CapabilityId, factory: () => stub("cap-a") }),
    ).toThrow(/already registered/);
  });

  it("get returns undefined for unknown id", () => {
    const reg = new CapabilityRegistry();
    expect(reg.get("cap-missing" as CapabilityId)).toBeUndefined();
  });

  it("validate() passes on an empty registry", () => {
    const reg = new CapabilityRegistry();
    expect(() => reg.validate()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/capability-registry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `capability-registry.ts`**

```ts
// src/core/registry/capability-registry.ts
import type { Capability } from "../capability/capability.js";
import type { CapabilityId } from "../types/ids.js";

export interface CapabilityRegistryEntry {
  id: CapabilityId;
  factory: () => Capability;
  documentsSubInterfaces?: readonly (
    | "EngineConsultable"
    | "EngineBufferable"
    | "EnginePullable"
    | "InstanceDirectory"
  )[];
}

export class CapabilityRegistry {
  private readonly entries = new Map<CapabilityId, CapabilityRegistryEntry>();

  register(entry: CapabilityRegistryEntry): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`Capability ${entry.id} already registered`);
    }
    this.entries.set(entry.id, entry);
  }

  get(id: CapabilityId): CapabilityRegistryEntry | undefined {
    return this.entries.get(id);
  }

  validate(): void {
    // Phase 1 has no dependencies to validate. Hook in later stages
    // for e.g. optional cross-capability dependency checks.
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/capability-registry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/registry/capability-registry.ts tests/unit/capability-registry.test.ts
git commit -m "feat(core): add CapabilityRegistry"
```

---

## Task 18: ComponentRegistry with phase-or-sub-interface validation (item C2)

**Files:**
- Create: `src/core/registry/component-registry.ts`
- Create: `src/core/registry/index.ts`
- Create: `tests/unit/component-registry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/component-registry.test.ts
import { describe, it, expect } from "vitest";
import { ComponentRegistry } from "@core/registry/component-registry";
import { CapabilityRegistry } from "@core/registry/capability-registry";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId } from "@core/types/ids";

function withPhase(id: string): Capability {
  return {
    id: id as CapabilityId, phase: "PROCESS",
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0, getStats: () => ({}),
  };
}

function withSubInterfaceOnly(id: string): Capability {
  return {
    id: id as CapabilityId,
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0, getStats: () => ({}),
    selectConnection: () => "cx-1" as any,
  } as Capability;
}

function noPhaseNoSub(id: string): Capability {
  return {
    id: id as CapabilityId,
    canHandle: () => true,
    process: () => ({ outcome: { kind: "PASS" }, sideEffects: [], events: [] }),
    getUpkeepCost: () => 0, getStats: () => ({}),
  };
}

describe("ComponentRegistry", () => {
  it("registers and creates a component from an entry", () => {
    const caps = new CapabilityRegistry();
    caps.register({ id: "cap-p" as CapabilityId, factory: () => withPhase("cap-p") });
    const comps = new ComponentRegistry(caps);
    comps.register({
      type: "server", name: "Server", description: "",
      capabilities: [{ id: "cap-p" as CapabilityId, defaultTier: 1, maxTier: 3 }],
      ports: [], placementCost: 10, upgradeCostCurve: [10, 20, 40],
      visual: { icon: "s", color: "#fff", shape: "rect" },
      conditionProfile: {
        degradedThreshold: 0.6, criticalThreshold: 0.3,
        decayRate: 0, recoveryRate: 0, degradedEffects: [], criticalEffects: [],
      },
    });
    comps.validate();
    const comp = comps.create("server", { x: 0, y: 0 }, null);
    expect(comp.type).toBe("server");
    expect(comp.getPlayerTier("cap-p" as CapabilityId)).toBe(1);
  });

  it("accepts sub-interface-only capabilities (no phase)", () => {
    const caps = new CapabilityRegistry();
    caps.register({ id: "cap-s" as CapabilityId, factory: () => withSubInterfaceOnly("cap-s") });
    const comps = new ComponentRegistry(caps);
    comps.register({
      type: "lb", name: "LB", description: "",
      capabilities: [{ id: "cap-s" as CapabilityId, defaultTier: 1, maxTier: 2 }],
      ports: [], placementCost: 10, upgradeCostCurve: [10],
      visual: { icon: "l", color: "#fff", shape: "rect" },
      conditionProfile: {
        degradedThreshold: 0.6, criticalThreshold: 0.3,
        decayRate: 0, recoveryRate: 0, degradedEffects: [], criticalEffects: [],
      },
    });
    expect(() => comps.validate()).not.toThrow();
  });

  it("validate() rejects a capability with neither phase nor sub-interface", () => {
    const caps = new CapabilityRegistry();
    caps.register({ id: "cap-bad" as CapabilityId, factory: () => noPhaseNoSub("cap-bad") });
    const comps = new ComponentRegistry(caps);
    comps.register({
      type: "broken", name: "Broken", description: "",
      capabilities: [{ id: "cap-bad" as CapabilityId, defaultTier: 1, maxTier: 1 }],
      ports: [], placementCost: 10, upgradeCostCurve: [10],
      visual: { icon: "x", color: "#fff", shape: "rect" },
      conditionProfile: {
        degradedThreshold: 0.6, criticalThreshold: 0.3,
        decayRate: 0, recoveryRate: 0, degradedEffects: [], criticalEffects: [],
      },
    });
    expect(() => comps.validate()).toThrow(/phase.*or.*sub-interface/i);
  });

  it("create() throws on unknown type", () => {
    const caps = new CapabilityRegistry();
    const comps = new ComponentRegistry(caps);
    expect(() => comps.create("missing", { x: 0, y: 0 }, null)).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/component-registry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `component-registry.ts`**

```ts
// src/core/registry/component-registry.ts
import type { CapabilityId, ComponentId } from "../types/ids.js";
import type { Port } from "../types/port.js";
import type { Position } from "../types/position.js";
import type { ConditionProfile } from "../types/condition.js";
import type { Capability } from "../capability/capability.js";
import { Component } from "../component/component.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import {
  isEngineConsultable,
  isEngineBufferable,
  isEnginePullable,
  isInstanceDirectory,
} from "../capability/engine-interfaces.js";

export interface ComponentRegistryEntry {
  type: string;
  name: string;
  description: string;
  capabilities: Array<{
    id: CapabilityId;
    defaultTier: number;
    maxTier: number;
  }>;
  ports: Port[];
  placementCost: number;
  upgradeCostCurve: number[];
  visual: { icon: string; color: string; shape: string };
  conditionProfile: ConditionProfile;
}

let idCounter = 0;
function nextId(type: string): ComponentId {
  idCounter += 1;
  return `${type}-${idCounter}` as ComponentId;
}

export class ComponentRegistry {
  private readonly entries = new Map<string, ComponentRegistryEntry>();

  constructor(private readonly capabilityRegistry: CapabilityRegistry) {}

  register(entry: ComponentRegistryEntry): void {
    if (this.entries.has(entry.type)) {
      throw new Error(`Component type ${entry.type} already registered`);
    }
    this.entries.set(entry.type, entry);
  }

  get(type: string): ComponentRegistryEntry | undefined {
    return this.entries.get(type);
  }

  list(): ComponentRegistryEntry[] {
    return [...this.entries.values()];
  }

  validate(): void {
    for (const entry of this.entries.values()) {
      for (const capRef of entry.capabilities) {
        const capEntry = this.capabilityRegistry.get(capRef.id);
        if (!capEntry) {
          throw new Error(
            `Component ${entry.type} references unknown capability ${capRef.id}`,
          );
        }
        const cap = capEntry.factory();
        const hasPhase = typeof cap.phase === "string";
        const hasSubInterface =
          isEngineConsultable(cap) ||
          isEngineBufferable(cap) ||
          isEnginePullable(cap) ||
          isInstanceDirectory(cap);
        if (!hasPhase && !hasSubInterface) {
          throw new Error(
            `Capability ${capRef.id} (used by ${entry.type}) has neither a phase nor a sub-interface`,
          );
        }
      }
    }
  }

  create(type: string, position: Position, zone: string | null): Component {
    const entry = this.entries.get(type);
    if (!entry) throw new Error(`Unknown component type ${type}`);
    const caps = new Map<CapabilityId, Capability>();
    const tiers = new Map<CapabilityId, number>();
    for (const capRef of entry.capabilities) {
      const capEntry = this.capabilityRegistry.get(capRef.id);
      if (!capEntry) {
        throw new Error(`Capability ${capRef.id} not in registry`);
      }
      caps.set(capRef.id, capEntry.factory());
      tiers.set(capRef.id, capRef.defaultTier);
    }
    return new Component({
      id: nextId(type),
      type: entry.type,
      name: entry.name,
      description: entry.description,
      capabilities: caps,
      initialTiers: tiers,
      ports: entry.ports.map(p => ({ ...p, connections: [...p.connections] })),
      placementCost: entry.placementCost,
      position,
      zone,
      placementTick: 0,
      conditionProfile: entry.conditionProfile,
    });
  }
}
```

- [ ] **Step 4: Create `src/core/registry/index.ts`**

```ts
// src/core/registry/index.ts
export { CapabilityRegistry } from "./capability-registry.js";
export type { CapabilityRegistryEntry } from "./capability-registry.js";
export { ComponentRegistry } from "./component-registry.js";
export type { ComponentRegistryEntry } from "./component-registry.js";
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test tests/unit/component-registry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/core/registry/ tests/unit/component-registry.test.ts
git commit -m "feat(core): add ComponentRegistry with phase-or-sub-interface validation"
```

---

## Task 19: Full abstract ModeController interface

**Files:**
- Modify: `src/core/mode/mode-controller.ts` (replace stub)
- Create: `src/core/mode/economy-strategy.ts`
- Create: `src/core/mode/traffic-source.ts`

- [ ] **Step 1: Write a compile-only test**

```ts
// tests/unit/mode-interfaces.test.ts
import { describe, it } from "vitest";
import type { ModeController } from "@core/mode/mode-controller";
import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { TrafficSource } from "@core/mode/traffic-source";

describe("mode interfaces", () => {
  it("ModeController, EconomyStrategy, TrafficSource are importable", () => {
    // Compile-time assertion: these names exist as types.
    const _a: ModeController | undefined = undefined;
    const _b: EconomyStrategy | undefined = undefined;
    const _c: TrafficSource | undefined = undefined;
    void _a; void _b; void _c;
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/mode-interfaces.test.ts`
Expected: FAIL (economy-strategy not found)

- [ ] **Step 3: Replace `mode-controller.ts` with the full interface**

```ts
// src/core/mode/mode-controller.ts
import type { ComponentReader } from "../component/component-reader.js";
import type { CapabilityId, ComponentId } from "../types/ids.js";
import type { BuildConstraints, PlacementResult, UpgradeResult } from "../types/build-constraints.js";
import type { TickMetrics } from "../types/metrics.js";
import type { OutcomeReport } from "../types/outcome.js";
import type { ZoneTopology } from "../types/zone.js";
import type { ChaosEvent } from "../types/chaos.js";
import type { Position } from "../types/position.js";
import type { SimulationState } from "../state/simulation-state.js";
import type { SimulationStateReader } from "../state/state-reader.js";
import type { EconomyStrategy } from "./economy-strategy.js";
import type { TrafficSource } from "./traffic-source.js";

export interface ModeController {
  readonly economy: EconomyStrategy;

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId>;
  getTierCap(component: ComponentReader, capabilityId: CapabilityId): number;

  getBuildConstraints(): BuildConstraints;
  getTrafficSource(): TrafficSource;
  evaluateOutcome(metrics: readonly TickMetrics[]): OutcomeReport;
  getPhase(): "build" | "simulate" | "assess";
  advancePhase(): void;
  getInitialZoneTopology(): ZoneTopology;

  tryPlace(
    state: SimulationState,
    type: string,
    position: Position,
    zone: string | null,
  ): PlacementResult;
  tryUpgrade(
    state: SimulationState,
    componentId: ComponentId,
    capabilityId: CapabilityId,
  ): UpgradeResult;

  getScheduledChaos(currentTick: number): readonly ChaosEvent[];

  onTick?(state: SimulationStateReader): void;
}
```

- [ ] **Step 4: Implement `economy-strategy.ts`**

```ts
// src/core/mode/economy-strategy.ts
import type { ComponentReader } from "../component/component-reader.js";
import type { CapabilityId, ComponentId } from "../types/ids.js";
import type { Request } from "../types/request.js";
import type { SimulationStateReader } from "../state/state-reader.js";

export interface EconomyStrategy {
  getBudget(): number;
  canAfford(cost: number): boolean;
  creditRevenue(request: Request): number;
  debitUpkeep(totalUpkeep: number): void;
  debitPlacement(component: ComponentReader): void;
  debitUpgrade(component: ComponentReader, capabilityId: CapabilityId): void;
  resolveInsolvency(state: SimulationStateReader): ComponentId[];
}
```

- [ ] **Step 5: Implement `traffic-source.ts`**

```ts
// src/core/mode/traffic-source.ts
import type { ComponentId } from "../types/ids.js";
import type { Request } from "../types/request.js";

export interface TrafficSource {
  readonly targetEntryPointId: ComponentId | null;
  generate(tick: number): Request[];
  getSubSources?(): readonly TrafficSource[];
}
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm test tests/unit/mode-interfaces.test.ts`
Expected: PASS
Run: `pnpm typecheck`
Expected: no errors (existing tests that depended on the stub `ModeController` still compile because `getTierCap` is still present)

- [ ] **Step 7: Commit**

```bash
git add src/core/mode/mode-controller.ts src/core/mode/economy-strategy.ts src/core/mode/traffic-source.ts tests/unit/mode-interfaces.test.ts
git commit -m "feat(core): finalize ModeController, EconomyStrategy, TrafficSource interfaces"
```

---

## Task 20: CompositeTrafficSource and ModeDefinition

**Files:**
- Create: `src/core/mode/composite-traffic-source.ts`
- Create: `src/core/mode/mode-definition.ts`
- Create: `src/core/mode/index.ts`
- Create: `tests/unit/composite-traffic-source.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/composite-traffic-source.test.ts
import { describe, it, expect } from "vitest";
import { CompositeTrafficSource } from "@core/mode/composite-traffic-source";
import type { TrafficSource } from "@core/mode/traffic-source";
import type { ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";

function mkRequest(id: string, origin: string): Request {
  return {
    id: id as RequestId, parentId: null, type: "api_read", payload: null,
    origin: origin as ComponentId, createdAt: 0, ttl: 10,
    originZone: null, streamDuration: null, streamBandwidth: null,
  };
}

function mockSource(id: string, origin: string): TrafficSource {
  return {
    targetEntryPointId: origin as ComponentId,
    generate: (_tick: number) => [mkRequest(`${id}-r`, origin)],
  };
}

describe("CompositeTrafficSource", () => {
  it("targetEntryPointId is null", () => {
    const c = new CompositeTrafficSource([]);
    expect(c.targetEntryPointId).toBeNull();
  });

  it("generate concatenates sub-source outputs", () => {
    const c = new CompositeTrafficSource([
      mockSource("a", "c-a"),
      mockSource("b", "c-b"),
    ]);
    const out = c.generate(0);
    expect(out.map(r => r.id)).toEqual(["a-r", "b-r"]);
  });

  it("getSubSources returns the configured sources", () => {
    const a = mockSource("a", "c-a");
    const b = mockSource("b", "c-b");
    const c = new CompositeTrafficSource([a, b]);
    expect(c.getSubSources()).toEqual([a, b]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/composite-traffic-source.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `composite-traffic-source.ts`**

```ts
// src/core/mode/composite-traffic-source.ts
import type { Request } from "../types/request.js";
import type { TrafficSource } from "./traffic-source.js";

export class CompositeTrafficSource implements TrafficSource {
  readonly targetEntryPointId: null = null;
  private readonly sources: readonly TrafficSource[];

  constructor(sources: readonly TrafficSource[]) {
    this.sources = sources;
  }

  generate(tick: number): Request[] {
    const out: Request[] = [];
    for (const src of this.sources) {
      for (const r of src.generate(tick)) out.push(r);
    }
    return out;
  }

  getSubSources(): readonly TrafficSource[] {
    return this.sources;
  }
}
```

- [ ] **Step 4: Implement `mode-definition.ts`**

```ts
// src/core/mode/mode-definition.ts
import type { ModeController } from "./mode-controller.js";

export interface ModeDefinition {
  id: string;
  name: string;
  description: string;
  createController: () => ModeController;
  // React.ComponentType pulled in from UI layer in Stage 4 — Stage 1 uses unknown.
  hudSlot: unknown;
}
```

- [ ] **Step 5: Implement `src/core/mode/index.ts`**

```ts
// src/core/mode/index.ts
export type { ModeController } from "./mode-controller.js";
export type { EconomyStrategy } from "./economy-strategy.js";
export type { TrafficSource } from "./traffic-source.js";
export { CompositeTrafficSource } from "./composite-traffic-source.js";
export type { ModeDefinition } from "./mode-definition.js";
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm test tests/unit/composite-traffic-source.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add src/core/mode/ tests/unit/composite-traffic-source.test.ts
git commit -m "feat(core): add CompositeTrafficSource and ModeDefinition"
```

---

## Task 21: Stub ProcessingCapability

**Files:**
- Create: `src/capabilities/processing/processing-capability.ts`
- Create: `tests/unit/processing-capability.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/processing-capability.test.ts
import { describe, it, expect } from "vitest";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import type { CapabilityId, ComponentId, RequestId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { ProcessContext } from "@core/capability/process-context";
import { createRng } from "@core/engine/rng";

function req(): Request {
  return {
    id: "r-1" as RequestId, parentId: null, type: "api_read", payload: null,
    origin: "c-a" as ComponentId, createdAt: 0, ttl: 10,
    originZone: null, streamDuration: null, streamBandwidth: null,
  };
}

function ctx(): ProcessContext {
  return {
    state: { currentTick: 0 } as any,
    componentId: "c-a" as ComponentId,
    effectiveTier: 1,
    effectiveTiers: new Map(),
    activeCapabilityIds: new Set(),
    currentTick: 0,
    rng: createRng("t"),
    directories: [],
  };
}

describe("ProcessingCapability stub", () => {
  it("has PROCESS phase", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId);
    expect(cap.phase).toBe("PROCESS");
  });

  it("canHandle returns true for any request type", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId);
    expect(cap.canHandle("api_read")).toBe(true);
    expect(cap.canHandle("stream")).toBe(true);
  });

  it("process returns a PASS outcome by default (Stage 1 stub)", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId);
    const result = cap.process(req(), ctx());
    expect(result.outcome.kind).toBe("PASS");
    expect(result.sideEffects).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("can be constructed with a test-only outcome override", () => {
    const cap = new ProcessingCapability(
      "cap-proc" as CapabilityId,
      { outcomeKind: "RESPOND" },
    );
    const result = cap.process(req(), ctx());
    expect(result.outcome.kind).toBe("RESPOND");
  });

  it("getUpkeepCost returns tier * 1 (stub formula)", () => {
    const cap = new ProcessingCapability("cap-proc" as CapabilityId);
    expect(cap.getUpkeepCost(0)).toBe(0);
    expect(cap.getUpkeepCost(3)).toBe(3);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/processing-capability.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `processing-capability.ts`**

The spec says "stub, always PASS". The test override is Stage 1 test convenience and will be removed when the real capability lands in Stage 3.

```ts
// src/capabilities/processing/processing-capability.ts
import type { Capability, CapabilityStats } from "@core/capability/capability";
import type { Request } from "@core/types/request";
import type { ProcessResult, PrimaryOutcome } from "@core/types/result";
import type { ProcessContext } from "@core/capability/process-context";
import type { CapabilityId } from "@core/types/ids";

export interface ProcessingCapabilityOptions {
  // Test-only override for Stage 1 fixtures. Removed in Stage 3.
  outcomeKind?: "PASS" | "RESPOND" | "FORWARD";
}

export class ProcessingCapability implements Capability {
  readonly phase = "PROCESS" as const;

  constructor(
    readonly id: CapabilityId,
    private readonly options: ProcessingCapabilityOptions = {},
  ) {}

  canHandle(_requestType: string): boolean {
    return true;
  }

  process(_request: Request, _context: ProcessContext): ProcessResult {
    const kind = this.options.outcomeKind ?? "PASS";
    const outcome: PrimaryOutcome =
      kind === "RESPOND"
        ? { kind: "RESPOND" }
        : kind === "FORWARD"
        ? { kind: "FORWARD" }
        : { kind: "PASS" };
    return { outcome, sideEffects: [], events: [] };
  }

  getUpkeepCost(tier: number): number {
    return tier;
  }

  getStats(): CapabilityStats {
    return {};
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/unit/processing-capability.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/processing/processing-capability.ts tests/unit/processing-capability.test.ts
git commit -m "feat(capabilities): add stub ProcessingCapability"
```

---

## Task 22: Test harness — NoOpEconomy

**Files:**
- Create: `tests/harness/noop-economy.ts`
- Create: `tests/harness/noop-economy.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/harness/noop-economy.test.ts
import { describe, it, expect } from "vitest";
import { NoOpEconomy } from "@harness/noop-economy";
import type { Request } from "@core/types/request";
import type { RequestId, ComponentId } from "@core/types/ids";

function req(): Request {
  return {
    id: "r-1" as RequestId, parentId: null, type: "api_read", payload: null,
    origin: "c-a" as ComponentId, createdAt: 0, ttl: 10,
    originZone: null, streamDuration: null, streamBandwidth: null,
  };
}

describe("NoOpEconomy", () => {
  it("getBudget returns Infinity", () => {
    const e = new NoOpEconomy();
    expect(e.getBudget()).toBe(Infinity);
  });

  it("canAfford is always true", () => {
    const e = new NoOpEconomy();
    expect(e.canAfford(10_000_000)).toBe(true);
  });

  it("creditRevenue returns 0 (observation-only)", () => {
    const e = new NoOpEconomy();
    expect(e.creditRevenue(req())).toBe(0);
  });

  it("resolveInsolvency returns empty array", () => {
    const e = new NoOpEconomy();
    expect(e.resolveInsolvency({} as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/harness/noop-economy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `noop-economy.ts`**

```ts
// tests/harness/noop-economy.ts
import type { EconomyStrategy } from "@core/mode/economy-strategy";
import type { ComponentReader } from "@core/component/component-reader";
import type { CapabilityId, ComponentId } from "@core/types/ids";
import type { Request } from "@core/types/request";
import type { SimulationStateReader } from "@core/state/state-reader";

export class NoOpEconomy implements EconomyStrategy {
  getBudget(): number { return Infinity; }
  canAfford(_cost: number): boolean { return true; }
  creditRevenue(_request: Request): number { return 0; }
  debitUpkeep(_totalUpkeep: number): void { /* noop */ }
  debitPlacement(_component: ComponentReader): void { /* noop */ }
  debitUpgrade(_component: ComponentReader, _capabilityId: CapabilityId): void { /* noop */ }
  resolveInsolvency(_state: SimulationStateReader): ComponentId[] { return []; }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/harness/noop-economy.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/harness/noop-economy.ts tests/harness/noop-economy.test.ts
git commit -m "test(harness): add NoOpEconomy"
```

---

## Task 23: Test harness — FixedIntensityTrafficSource

**Files:**
- Create: `tests/harness/fixed-intensity-traffic-source.ts`
- Create: `tests/harness/fixed-intensity-traffic-source.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/harness/fixed-intensity-traffic-source.test.ts
import { describe, it, expect } from "vitest";
import { FixedIntensityTrafficSource } from "@harness/fixed-intensity-traffic-source";
import type { ComponentId } from "@core/types/ids";

describe("FixedIntensityTrafficSource", () => {
  it("generates `intensity` requests per tick with the given type", () => {
    const src = new FixedIntensityTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 3,
      requestType: "api_read",
    });
    const out = src.generate(0);
    expect(out).toHaveLength(3);
    expect(out.every(r => r.type === "api_read")).toBe(true);
    expect(out.every(r => r.origin === ("c-client" as ComponentId))).toBe(true);
    expect(out.every(r => r.ttl === 10)).toBe(true);
  });

  it("produces sequential unique IDs across ticks", () => {
    const src = new FixedIntensityTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });
    const ids = [
      ...src.generate(0).map(r => r.id),
      ...src.generate(1).map(r => r.id),
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it("uses createdAt = tick argument", () => {
    const src = new FixedIntensityTrafficSource({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(src.generate(5)[0].createdAt).toBe(5);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/harness/fixed-intensity-traffic-source.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `fixed-intensity-traffic-source.ts`**

```ts
// tests/harness/fixed-intensity-traffic-source.ts
import type { TrafficSource } from "@core/mode/traffic-source";
import type { Request } from "@core/types/request";
import type { ComponentId, RequestId } from "@core/types/ids";

export interface FixedIntensityConfig {
  targetEntryPointId: ComponentId;
  intensity: number;
  requestType: string;
}

export class FixedIntensityTrafficSource implements TrafficSource {
  readonly targetEntryPointId: ComponentId;
  private readonly intensity: number;
  private readonly requestType: string;
  private counter = 0;

  constructor(cfg: FixedIntensityConfig) {
    this.targetEntryPointId = cfg.targetEntryPointId;
    this.intensity = cfg.intensity;
    this.requestType = cfg.requestType;
  }

  generate(tick: number): Request[] {
    const out: Request[] = [];
    for (let i = 0; i < this.intensity; i++) {
      this.counter += 1;
      out.push({
        id: `fixed-r-${this.counter}` as RequestId,
        parentId: null,
        type: this.requestType,
        payload: null,
        origin: this.targetEntryPointId,
        createdAt: tick,
        ttl: 10,
        originZone: null,
        streamDuration: null,
        streamBandwidth: null,
      });
    }
    return out;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/harness/fixed-intensity-traffic-source.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/harness/fixed-intensity-traffic-source.ts tests/harness/fixed-intensity-traffic-source.test.ts
git commit -m "test(harness): add FixedIntensityTrafficSource"
```

---

## Task 24: Test harness — NoOpModeController

**Files:**
- Create: `tests/harness/noop-mode-controller.ts`
- Create: `tests/harness/noop-mode-controller.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/harness/noop-mode-controller.test.ts
import { describe, it, expect } from "vitest";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { SimulationState } from "@core/state/simulation-state";
import type { ComponentId, CapabilityId } from "@core/types/ids";

describe("NoOpModeController", () => {
  it("economy is a NoOpEconomy", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(m.economy.getBudget()).toBe(Infinity);
  });

  it("getActiveCapabilities returns all capability ids on the component", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    const fake = {
      getCapabilityIds: () => ["a", "b"] as CapabilityId[],
    } as any;
    const set = m.getActiveCapabilities(fake);
    expect([...set]).toEqual(["a", "b"]);
  });

  it("getTierCap returns Infinity", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(m.getTierCap({} as any, "x" as CapabilityId)).toBe(Infinity);
  });

  it("getScheduledChaos returns empty", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(m.getScheduledChaos(0)).toEqual([]);
  });

  it("evaluateOutcome returns neutral verdict", () => {
    const m = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 1,
      requestType: "api_read",
    });
    expect(m.evaluateOutcome([]).verdict).toBe("neutral");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/harness/noop-mode-controller.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `noop-mode-controller.ts`**

```ts
// tests/harness/noop-mode-controller.ts
import type { ModeController } from "@core/mode/mode-controller";
import type { TrafficSource } from "@core/mode/traffic-source";
import type { ComponentReader } from "@core/component/component-reader";
import type {
  CapabilityId, ComponentId,
} from "@core/types/ids";
import type { Position } from "@core/types/position";
import type {
  BuildConstraints, PlacementResult, UpgradeResult,
} from "@core/types/build-constraints";
import type { TickMetrics } from "@core/types/metrics";
import type { OutcomeReport } from "@core/types/outcome";
import type { ChaosEvent } from "@core/types/chaos";
import type { ZoneTopology } from "@core/types/zone";
import type { SimulationState } from "@core/state/simulation-state";
import { NoOpEconomy } from "./noop-economy.js";
import {
  FixedIntensityTrafficSource,
  type FixedIntensityConfig,
} from "./fixed-intensity-traffic-source.js";

export class NoOpModeController implements ModeController {
  readonly economy = new NoOpEconomy();
  private readonly traffic: TrafficSource;
  private phase: "build" | "simulate" | "assess" = "simulate";

  constructor(trafficConfig: FixedIntensityConfig) {
    this.traffic = new FixedIntensityTrafficSource(trafficConfig);
  }

  getActiveCapabilities(component: ComponentReader): ReadonlySet<CapabilityId> {
    return new Set(component.getCapabilityIds());
  }

  getTierCap(_component: ComponentReader, _capabilityId: CapabilityId): number {
    return Infinity;
  }

  getBuildConstraints(): BuildConstraints {
    return { availableComponentTypes: [] };
  }

  getTrafficSource(): TrafficSource {
    return this.traffic;
  }

  evaluateOutcome(_metrics: readonly TickMetrics[]): OutcomeReport {
    return {
      verdict: "neutral",
      score: { cost: 0, performance: 0, reliability: 0, composite: 0 },
      notes: [],
    };
  }

  getPhase(): "build" | "simulate" | "assess" {
    return this.phase;
  }

  advancePhase(): void {
    this.phase = this.phase === "build" ? "simulate"
      : this.phase === "simulate" ? "assess" : "build";
  }

  getInitialZoneTopology(): ZoneTopology {
    return { zones: [], pairLatency: new Map() };
  }

  tryPlace(
    _state: SimulationState,
    _type: string,
    _position: Position,
    _zone: string | null,
  ): PlacementResult {
    return { ok: false, reason: "disallowed_by_mode", detail: "NoOpModeController does not accept placements" };
  }

  tryUpgrade(
    _state: SimulationState,
    _componentId: ComponentId,
    _capabilityId: CapabilityId,
  ): UpgradeResult {
    return { ok: false, reason: "disallowed_by_mode" };
  }

  getScheduledChaos(_currentTick: number): readonly ChaosEvent[] {
    return [];
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test tests/harness/noop-mode-controller.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/harness/noop-mode-controller.ts tests/harness/noop-mode-controller.test.ts
git commit -m "test(harness): add NoOpModeController"
```

---

## Task 25: Stage 1 walking-skeleton Engine

**Goal:** the minimum tick loop required for the smoke test. Stage 2 replaces most of this. The Stage 1 engine:
1. **Inject:** asks the mode's `TrafficSource` for requests, enqueues them on `pending[targetEntryPointId]`, appends an `ENTERED` event for each.
2. **Process pending:** for each component with pending requests, drains them one at a time, builds a `ProcessContext`, calls `Component.process()`, handles the result:
   - `FORWARD` → deliver via the first egress connection whose source matches the current component, enqueue on the target's pending, append `TRAVERSED`.
   - `RESPOND` → append `RESPONDED`.
   - `DROP` → append `DROPPED` with reason.
   - `PASS` → if the component has an egress connection, treat as FORWARD (walking-skeleton default); else `DROPPED` with reason `"no_outcome"`.
   - `QUEUE_HOLD` → append `QUEUED` (no real buffer yet).
3. **Advance tick.**

No backpressure, no TTL, no condition, no throughput gate, no fixed-point loop — those arrive in Stage 2. Requests cannot loop: each component processes each pending-request slice exactly once per tick (new arrivals during the tick go to `nextPending`, processed next tick).

**Files:**
- Create: `src/core/engine/engine.ts`
- Create: `src/core/engine/index.ts`
- Create: `tests/unit/engine-skeleton.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/engine-skeleton.test.ts
import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { Component } from "@core/component/component";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { NoOpModeController } from "@harness/noop-mode-controller";
import type {
  CapabilityId, ComponentId, ConnectionId, PortId,
} from "@core/types/ids";
import type { Capability } from "@core/capability/capability";
import type { Port } from "@core/types/port";
import type { Connection } from "@core/types/connection";

const profile = {
  degradedThreshold: 0.6, criticalThreshold: 0.3,
  decayRate: 0, recoveryRate: 0, degradedEffects: [], criticalEffects: [],
};

function mkPort(id: string, direction: "ingress" | "egress"): Port {
  return {
    id: id as PortId, direction, dataType: "any",
    capacity: 100, connections: [],
  };
}

function mkComp(
  id: string,
  ports: Port[],
  caps: ReadonlyMap<CapabilityId, Capability>,
  tiers: ReadonlyMap<CapabilityId, number>,
): Component {
  return new Component({
    id: id as ComponentId, type: "test", name: id, description: "",
    capabilities: caps, initialTiers: tiers, ports,
    placementCost: 0, position: { x: 0, y: 0 }, zone: null,
    placementTick: 0, conditionProfile: profile,
  });
}

function mkConn(id: string, from: ComponentId, to: ComponentId, fromPort: PortId, toPort: PortId): Connection {
  return {
    id: id as ConnectionId,
    source: { componentId: from, portId: fromPort },
    target: { componentId: to, portId: toPort },
    bandwidth: 100, latency: 1, currentLoad: 0,
  };
}

describe("Engine walking skeleton", () => {
  it("injects traffic, forwards from Client to Server, logs events", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    // Client: egress only, no capabilities → pipeline returns PASS;
    // engine's walking-skeleton default routes PASS as FORWARD when an egress exists.
    const clientEgress = mkPort("p-c-out", "egress");
    const client = mkComp(
      "c-client",
      [clientEgress],
      new Map(),
      new Map(),
    );

    // Server: ingress + ProcessingCapability configured to RESPOND.
    const serverIngress = mkPort("p-s-in", "ingress");
    const serverCap = new ProcessingCapability(
      "cap-proc" as CapabilityId,
      { outcomeKind: "RESPOND" },
    );
    const caps = new Map<CapabilityId, Capability>([
      ["cap-proc" as CapabilityId, serverCap],
    ]);
    const tiers = new Map<CapabilityId, number>([
      ["cap-proc" as CapabilityId, 1],
    ]);
    const server = mkComp("c-server", [serverIngress], caps, tiers);

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = mkConn(
      "cx-1",
      "c-client" as ComponentId, "c-server" as ComponentId,
      "p-c-out" as PortId, "p-s-in" as PortId,
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });

    const engine = new Engine();
    // Tick 0: inject 2, client forwards both to server, server RESPONDs to both.
    engine.tick(state, mode);

    // Expect 2 request logs, each containing ENTERED (client), TRAVERSED, RESPONDED
    const logs = [...state.requestLog.values()];
    expect(logs).toHaveLength(2);
    for (const events of logs) {
      const types = events.map(e => e.type);
      expect(types).toContain("ENTERED");
      expect(types).toContain("TRAVERSED");
      expect(types).toContain("RESPONDED");
    }
    expect(state.currentTick).toBe(1);
  });

  it("5 ticks with intensity 2 produces 10 total requests", () => {
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const clientEgress = mkPort("p-c-out", "egress");
    const client = mkComp("c-client", [clientEgress], new Map(), new Map());

    const serverIngress = mkPort("p-s-in", "ingress");
    const cap = new ProcessingCapability("cap-proc" as CapabilityId, { outcomeKind: "RESPOND" });
    const server = mkComp(
      "c-server",
      [serverIngress],
      new Map([["cap-proc" as CapabilityId, cap]]),
      new Map([["cap-proc" as CapabilityId, 1]]),
    );

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = mkConn(
      "cx-1",
      "c-client" as ComponentId, "c-server" as ComponentId,
      "p-c-out" as PortId, "p-s-in" as PortId,
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    const mode = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });
    const engine = new Engine();
    for (let i = 0; i < 5; i++) engine.tick(state, mode);

    expect(state.currentTick).toBe(5);
    expect([...state.requestLog.values()]).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test tests/unit/engine-skeleton.test.ts`
Expected: FAIL (Engine not found)

- [ ] **Step 3: Implement `engine.ts`**

```ts
// src/core/engine/engine.ts
import type {
  CapabilityId, ComponentId, ConnectionId, RequestId,
} from "../types/ids.js";
import type { Request, RequestEvent } from "../types/request.js";
import type { Connection } from "../types/connection.js";
import type { ProcessContext } from "../capability/process-context.js";
import type { ModeController } from "../mode/mode-controller.js";
import type { SimulationState } from "../state/simulation-state.js";
import { computeEffectiveTiers } from "../component/effective-tier.js";
import { createRng } from "./rng.js";

export class Engine {
  tick(state: SimulationState, modeController: ModeController): void {
    this.injectTraffic(state, modeController);
    this.processPending(state, modeController);
    this.advanceTick(state);
  }

  private injectTraffic(state: SimulationState, modeController: ModeController): void {
    const source = modeController.getTrafficSource();
    const newRequests =
      typeof source.getSubSources === "function"
        ? source.getSubSources().flatMap(s => s.generate(state.currentTick))
        : source.generate(state.currentTick);

    for (const req of newRequests) {
      // Walking skeleton: each top-level source has a targetEntryPointId.
      // Composite sources were flattened above; atomic sources still expose it.
      const subSources =
        typeof source.getSubSources === "function" ? source.getSubSources() : [source];
      const owningSource = subSources.find(s =>
        s.targetEntryPointId !== null && req.origin === s.targetEntryPointId,
      );
      const target: ComponentId | null = owningSource?.targetEntryPointId ?? req.origin;
      if (target === null) continue;
      state.enqueuePending(target, req);
      state.appendEvent(req.id, {
        tick: state.currentTick,
        componentId: target,
        capabilityId: null,
        connectionId: null,
        type: "ENTERED",
        latencyAdded: 0,
      });
    }
  }

  private processPending(state: SimulationState, modeController: ModeController): void {
    // Snapshot of pending per component — new arrivals during processing defer
    // to the next tick, which guarantees termination in the walking skeleton.
    const snapshot: Array<[ComponentId, Request[]]> = [];
    for (const [id, queue] of state.pending) {
      if (queue.length === 0) continue;
      snapshot.push([id, [...queue]]);
      state.pending.set(id, []);
    }

    for (const [componentId, queue] of snapshot) {
      const component = state.components.get(componentId);
      if (!component) continue;
      const activeCapabilityIds = modeController.getActiveCapabilities(component);
      const effectiveTiers = computeEffectiveTiers(component, modeController);

      for (const request of queue) {
        const context = this.buildProcessContext(
          state, componentId, activeCapabilityIds, effectiveTiers, request,
        );
        const result = component.process(request, context);

        for (const ev of result.events) {
          state.appendEvent(request.id, ev);
        }

        switch (result.outcome.kind) {
          case "RESPOND": {
            state.appendEvent(request.id, {
              tick: state.currentTick,
              componentId,
              capabilityId: null,
              connectionId: null,
              type: "RESPONDED",
              latencyAdded: 0,
            });
            break;
          }
          case "FORWARD":
          case "PASS": {
            const routed = this.routeForward(state, componentId, request);
            if (!routed) {
              state.appendEvent(request.id, {
                tick: state.currentTick,
                componentId,
                capabilityId: null,
                connectionId: null,
                type: "DROPPED",
                latencyAdded: 0,
                metadata: { reason: "no_outcome" },
              });
            }
            break;
          }
          case "DROP": {
            state.appendEvent(request.id, {
              tick: state.currentTick,
              componentId,
              capabilityId: null,
              connectionId: null,
              type: "DROPPED",
              latencyAdded: 0,
              metadata: { reason: result.outcome.reason },
            });
            break;
          }
          case "QUEUE_HOLD": {
            state.appendEvent(request.id, {
              tick: state.currentTick,
              componentId,
              capabilityId: null,
              connectionId: null,
              type: "QUEUED",
              latencyAdded: 0,
            });
            break;
          }
        }
      }
    }
  }

  private routeForward(
    state: SimulationState,
    fromId: ComponentId,
    request: Request,
  ): boolean {
    const component = state.components.get(fromId);
    if (!component) return false;
    const egressPort = component.ports.find(p => p.direction === "egress");
    if (!egressPort) return false;
    const connectionId: ConnectionId | undefined = egressPort.connections[0];
    if (!connectionId) return false;
    const conn = state.connections.get(connectionId);
    if (!conn) return false;

    state.enqueuePending(conn.target.componentId, request);
    const ev: RequestEvent = {
      tick: state.currentTick,
      componentId: fromId,
      capabilityId: null,
      connectionId,
      type: "TRAVERSED",
      latencyAdded: conn.latency,
    };
    state.appendEvent(request.id, ev);
    return true;
  }

  private buildProcessContext(
    state: SimulationState,
    componentId: ComponentId,
    activeCapabilityIds: ReadonlySet<CapabilityId>,
    effectiveTiers: ReadonlyMap<CapabilityId, number>,
    request: Request,
  ): ProcessContext {
    return {
      state: state.asReader(),
      componentId,
      effectiveTier: 0, // walking skeleton — per-capability tiers are in effectiveTiers
      effectiveTiers,
      activeCapabilityIds,
      currentTick: state.currentTick,
      rng: createRng(`${state.currentTick}:${componentId}:${request.id}`),
      directories: [],
    };
  }

  private advanceTick(state: SimulationState): void {
    state.advanceTick();
  }
}
```

Note: the Stage 1 engine has a subtle termination behavior — requests that arrive at a component during a tick are processed on the *next* tick. In the smoke test, tick 0 enqueues at Client, tick 0 also processes Client (forwards to Server), but Server's processing defers to tick 1. To make the smoke test pass in a single tick as specified, the walking skeleton needs to re-drain until stable within a tick.

Rewrite `processPending` to loop until all pending queues are empty within the tick:

```ts
  private processPending(state: SimulationState, modeController: ModeController): void {
    const MAX_ITERATIONS = 32; // walking-skeleton safety cap
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const snapshot: Array<[ComponentId, Request[]]> = [];
      for (const [id, queue] of state.pending) {
        if (queue.length === 0) continue;
        snapshot.push([id, [...queue]]);
        state.pending.set(id, []);
      }
      if (snapshot.length === 0) return;

      for (const [componentId, queue] of snapshot) {
        const component = state.components.get(componentId);
        if (!component) continue;
        const activeCapabilityIds = modeController.getActiveCapabilities(component);
        const effectiveTiers = computeEffectiveTiers(component, modeController);

        for (const request of queue) {
          const context = this.buildProcessContext(
            state, componentId, activeCapabilityIds, effectiveTiers, request,
          );
          const result = component.process(request, context);

          for (const ev of result.events) state.appendEvent(request.id, ev);

          switch (result.outcome.kind) {
            case "RESPOND":
              state.appendEvent(request.id, {
                tick: state.currentTick, componentId,
                capabilityId: null, connectionId: null,
                type: "RESPONDED", latencyAdded: 0,
              });
              break;
            case "FORWARD":
            case "PASS":
              if (!this.routeForward(state, componentId, request)) {
                state.appendEvent(request.id, {
                  tick: state.currentTick, componentId,
                  capabilityId: null, connectionId: null,
                  type: "DROPPED", latencyAdded: 0,
                  metadata: { reason: "no_outcome" },
                });
              }
              break;
            case "DROP":
              state.appendEvent(request.id, {
                tick: state.currentTick, componentId,
                capabilityId: null, connectionId: null,
                type: "DROPPED", latencyAdded: 0,
                metadata: { reason: result.outcome.reason },
              });
              break;
            case "QUEUE_HOLD":
              state.appendEvent(request.id, {
                tick: state.currentTick, componentId,
                capabilityId: null, connectionId: null,
                type: "QUEUED", latencyAdded: 0,
              });
              break;
          }
        }
      }
    }
  }
```

(Stage 2 replaces this with the real fixed-point loop + visitation order per item B6.)

- [ ] **Step 4: Create `src/core/engine/index.ts`**

```ts
// src/core/engine/index.ts
export { Engine } from "./engine.js";
export { createRng } from "./rng.js";
export type { DeterministicRng } from "./rng.js";
export { EMPTY_COUNTERS } from "./per-component-counters.js";
export type { PerComponentTickCounters } from "./per-component-counters.js";
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test tests/unit/engine-skeleton.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Run full test suite**

Run: `pnpm test`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add src/core/engine/engine.ts src/core/engine/index.ts tests/unit/engine-skeleton.test.ts
git commit -m "feat(core): add Stage 1 walking-skeleton Engine"
```

---

## Task 26: Smoke-test integration (Stage 1 exit criterion)

**Files:**
- Create: `tests/harness/fixtures.ts`
- Create: `tests/integration/smoke.test.ts`

- [ ] **Step 1: Implement `tests/harness/fixtures.ts`**

```ts
// tests/harness/fixtures.ts
import { Component } from "@core/component/component";
import type { Capability } from "@core/capability/capability";
import type {
  CapabilityId, ComponentId, ConnectionId, PortId,
} from "@core/types/ids";
import type { Port } from "@core/types/port";
import type { Connection } from "@core/types/connection";
import type { ConditionProfile } from "@core/types/condition";

const defaultProfile: ConditionProfile = {
  degradedThreshold: 0.6,
  criticalThreshold: 0.3,
  decayRate: 0,
  recoveryRate: 0,
  degradedEffects: [],
  criticalEffects: [],
};

export function makePort(id: string, direction: "ingress" | "egress", dataType = "any"): Port {
  return { id: id as PortId, direction, dataType, capacity: 100, connections: [] };
}

export function makeComponent(args: {
  id: string;
  type?: string;
  ports?: Port[];
  capabilities?: Map<CapabilityId, Capability>;
  tiers?: Map<CapabilityId, number>;
  zone?: string | null;
}): Component {
  return new Component({
    id: args.id as ComponentId,
    type: args.type ?? "test",
    name: args.id,
    description: "",
    capabilities: args.capabilities ?? new Map(),
    initialTiers: args.tiers ?? new Map(),
    ports: args.ports ?? [],
    placementCost: 0,
    position: { x: 0, y: 0 },
    zone: args.zone ?? null,
    placementTick: 0,
    conditionProfile: defaultProfile,
  });
}

export function makeConnection(
  id: string,
  from: { componentId: string; portId: string },
  to: { componentId: string; portId: string },
  opts: { bandwidth?: number; latency?: number } = {},
): Connection {
  return {
    id: id as ConnectionId,
    source: { componentId: from.componentId as ComponentId, portId: from.portId as PortId },
    target: { componentId: to.componentId as ComponentId, portId: to.portId as PortId },
    bandwidth: opts.bandwidth ?? 100,
    latency: opts.latency ?? 1,
    currentLoad: 0,
  };
}
```

- [ ] **Step 2: Write failing smoke test**

```ts
// tests/integration/smoke.test.ts
import { describe, it, expect } from "vitest";
import { Engine } from "@core/engine/engine";
import { SimulationState } from "@core/state/simulation-state";
import { ProcessingCapability } from "@capabilities/processing/processing-capability";
import { NoOpModeController } from "@harness/noop-mode-controller";
import { makeComponent, makePort, makeConnection } from "@harness/fixtures";
import type { Capability } from "@core/capability/capability";
import type { CapabilityId, ComponentId } from "@core/types/ids";

describe("Stage 1 smoke test", () => {
  it("Client → Server topology, 10 requests over 5 ticks, all RESPONDED", () => {
    // ----- Build state -----
    const state = new SimulationState({ zones: [], pairLatency: new Map() });

    const clientEgress = makePort("p-c-out", "egress");
    const client = makeComponent({ id: "c-client", ports: [clientEgress] });

    const serverIngress = makePort("p-s-in", "ingress");
    const caps = new Map<CapabilityId, Capability>([
      ["cap-proc" as CapabilityId,
        new ProcessingCapability("cap-proc" as CapabilityId, { outcomeKind: "RESPOND" })],
    ]);
    const tiers = new Map<CapabilityId, number>([["cap-proc" as CapabilityId, 1]]);
    const server = makeComponent({
      id: "c-server",
      ports: [serverIngress],
      capabilities: caps,
      tiers,
    });

    state.placeComponent(client);
    state.placeComponent(server);

    const conn = makeConnection(
      "cx-1",
      { componentId: "c-client", portId: "p-c-out" },
      { componentId: "c-server", portId: "p-s-in" },
    );
    clientEgress.connections.push(conn.id);
    serverIngress.connections.push(conn.id);
    state.addConnection(conn);

    // ----- Run -----
    const mode = new NoOpModeController({
      targetEntryPointId: "c-client" as ComponentId,
      intensity: 2,
      requestType: "api_read",
    });
    const engine = new Engine();
    for (let i = 0; i < 5; i++) engine.tick(state, mode);

    // ----- Assert -----
    expect(state.currentTick).toBe(5);

    const logs = [...state.requestLog.values()];
    expect(logs).toHaveLength(10);

    for (const events of logs) {
      const types = events.map(e => e.type);
      expect(types).toContain("ENTERED");
      expect(types).toContain("TRAVERSED");
      expect(types).toContain("RESPONDED");
      expect(types).not.toContain("DROPPED");
    }

    // Ordering: ENTERED is always the first event on a request.
    for (const events of logs) {
      expect(events[0].type).toBe("ENTERED");
    }

    // All TRAVERSED events are on the single connection.
    const traversed = logs.flatMap(evs => evs.filter(e => e.type === "TRAVERSED"));
    expect(traversed).toHaveLength(10);
    for (const t of traversed) expect(t.connectionId).toBe("cx-1");
  });
});
```

- [ ] **Step 3: Run, verify pass**

Run: `pnpm test tests/integration/smoke.test.ts`
Expected: PASS

- [ ] **Step 4: Run full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all green, no TS errors

- [ ] **Step 5: Commit**

```bash
git add tests/harness/fixtures.ts tests/integration/smoke.test.ts
git commit -m "test(integration): Stage 1 smoke test — Client→Server topology passes"
```

---

## Task 27: Package barrel exports and Stage 1 exit verification

**Files:**
- Create: `src/core/capability/index.ts`
- Create: `src/core/component/index.ts`
- Modify: `src/core/types/index.ts` (already created in Task 8 — ensure complete)
- Create: `src/core/index.ts` (top-level barrel)

- [ ] **Step 1: Create capability barrel**

```ts
// src/core/capability/index.ts
export type { Capability, CapabilityStats } from "./capability.js";
export type { ProcessContext, PullContext } from "./process-context.js";
export {
  isEngineConsultable, isEngineBufferable,
  isEnginePullable, isInstanceDirectory,
} from "./engine-interfaces.js";
export type {
  EngineConsultable, EngineBufferable,
  EnginePullable, InstanceDirectory, ComponentRef,
} from "./engine-interfaces.js";
```

- [ ] **Step 2: Create component barrel**

```ts
// src/core/component/index.ts
export { Component } from "./component.js";
export type { ComponentConstructorArgs } from "./component.js";
export type { ComponentReader } from "./component-reader.js";
export { getEffectiveTier, computeEffectiveTiers } from "./effective-tier.js";
```

- [ ] **Step 3: Create top-level `src/core/index.ts`**

```ts
// src/core/index.ts
export * from "./types/index.js";
export * from "./capability/index.js";
export * from "./component/index.js";
export * from "./state/index.js";
export * from "./engine/index.js";
export * from "./registry/index.js";
export * from "./mode/index.js";
```

- [ ] **Step 4: Run typecheck and full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: no errors, all tests green

- [ ] **Step 5: Verify Stage 1 exit criterion**

Exit criterion from the spec (Stage 1):
> The smoke-test integration test passes. Every core interface is committed and exported.

Checklist to run by hand before committing:
1. `pnpm test tests/integration/smoke.test.ts` → PASS
2. Every file listed in the "File structure" section at the top of this plan exists
3. `src/core/index.ts` re-exports types, capability, component, state, engine, registry, mode
4. `git status` is clean except for the new barrel files

- [ ] **Step 6: Commit**

```bash
git add src/core/capability/index.ts src/core/component/index.ts src/core/index.ts
git commit -m "feat(core): add barrel exports and complete Stage 1"
```

- [ ] **Step 7: Tag Stage 1 completion (optional but recommended)**

```bash
git tag phase-1-stage-1-complete
```

---

## Self-review

**Spec coverage (Stage 1 section):**
| Spec item (Stage 1 build order) | Task |
|---|---|
| 1. Core value types | Tasks 1–8 |
| 2. Capability + 4 sub-interfaces | Task 11 |
| 3. ProcessContext + DeterministicRng | Tasks 9, 11 |
| 4. Component, ComponentReader, getEffectiveTier | Tasks 12–15 |
| 5. SimulationState + SimulationStateReader | Task 16 |
| 6. CapabilityRegistry + ComponentRegistry w/ validation | Tasks 17–18 |
| 7. Abstract ModeController/EconomyStrategy/TrafficSource/ModeDefinition | Tasks 19–20 |
| 8. Stub ProcessingCapability | Task 21 |
| 9. Test harness (NoOpModeController, NoOpEconomy, FixedIntensityTrafficSource) | Tasks 22–24 |
| 10. Smoke-test integration test | Task 26 |

Also covered beyond the numbered Stage 1 list:
- Walking-skeleton Engine (enables the smoke test): Task 25
- `PerComponentTickCounters` + `EMPTY_COUNTERS` (referenced by `SimulationState` in spec): Task 10
- `CompositeTrafficSource` (spec in-scope item 10): Task 20
- Barrel exports + exit verification: Task 27

**Deferred-to-later-stage items (explicitly noted in the plan header):**
- Real tick-step implementations, fixed-point loop, condition effects, throughput gate, chaos, metrics → Stage 2 plan
- 24 real capabilities + 14 component registry entries → Stage 3 plan
- Render snapshot + UI → Stage 4 plan
- `src/modes/example/`, Phase 2 onboarding doc, ESLint boundaries, frozen-folder markers → Stage 5 plan

**Type consistency check:**
- `Capability.phase` is optional from Task 11 onwards; Component.process in Task 15 treats missing phase as "does not run in any phase" (capabilities without a phase are still invokable via sub-interfaces in later stages).
- `ModeController.getTierCap` signature in Task 14's stub matches Task 19's full interface (`(ComponentReader, CapabilityId) => number`).
- `SimulationStateReader` stub in Task 11 exposes only `currentTick`; Task 16 replaces it with the full interface before anything else consumes it (ProcessContext continues to typecheck because it only references the type name).
- All branded IDs (`RequestId`, `ComponentId`, etc.) flow through unchanged from Task 1.
- `ProcessingCapability` in Task 21 accepts an optional `outcomeKind` override; this is test-only and is explicitly flagged for removal in Stage 3.

**Known walking-skeleton simplifications (Stage 2 targets):**
- Stage 1 engine's `processPending` iterates until `pending` is empty with a hard cap of 32 iterations — this is the placeholder for the item B6 fixed-point loop and stable visitation order.
- No backpressure, TTL, condition effects, throughput gate, upkeep debit, metrics, or chaos — Stage 2 adds all of these.
- `ProcessContext.effectiveTier` is set to 0 in the walking-skeleton engine (per-capability effective tiers live in `effectiveTiers` map); Stage 2's `buildProcessContext` computes a per-capability `effectiveTier` as it iterates phases.

**No placeholders detected** — every task has concrete code, tests, and commands.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-10-tower-defense-foundation-stage-1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
