# Future Campaign Candidates

Beyond the Netflix campaign (Waves 1–10), these real-world architectures could serve as additional campaigns with distinct gameplay mechanics.

## Ranked by Feasibility

### 1. Twitter/X — Fan-Out Problem ✅ Buildable Now

**Core mechanic:** 1:N fan-out. One tweet → N timelines. Player decides: fan-out-on-write (pre-compute, expensive but fast reads) or fan-out-on-read (cheap writes, slow feeds).

**Real-world reference:** Twitter's timeline service, fan-out service, social graph.

**Why it's different from Netflix:** Netflix is 1:1 (one request, one response). Twitter is 1:N. The REPLICATE phase and SPAWN side effects already exist in the engine but no capability uses them yet.

**New components needed:** Fan-Out Service (REPLICATE-phase capability that SPAWNs N children), Timeline Cache (per-user cache partitioning), Social Graph Index (lookup follower count for fan-out factor).

**Engine work:** None — REPLICATE phase + SPAWN (blocking/non-blocking) + cascade are all wired.

**Teaching arc:** Small accounts (low fan-out) → verified accounts (medium) → celebrity tweets (massive fan-out) → viral retweet chains (recursive fan-out).

---

### 2. Slack/Discord — Persistent Connection Fan-Out 🟡 Mostly Buildable

**Core mechanic:** Millions of persistent WebSocket connections, each subscribed to channels. Message in a channel must reach all online subscribers in real-time. Connection management IS the bottleneck.

**Real-world reference:** Slack's real-time messaging, Discord's voice/text channel infrastructure.

**Why it's different:** Netflix handles stateless HTTP. Slack handles stateful connections that persist for hours. Dropping a connection = user goes offline.

**New components needed:** WebSocket Gateway (persistent connection manager), Channel Router (pub/sub fan-out by subscription), Presence Service (tracks online/offline state).

**Engine work:** Minor — reuse streaming mechanic (multi-tick connections) + REPLICATE fan-out. May need a "subscription registry" for channel membership.

**Teaching arc:** DMs (1:1) → small channels (1:20) → large channels (1:1000) → @everyone in 50K-member server → typing indicators + presence at scale.

---

### 3. Stripe — Transaction Saga 🟠 Happy Path Only

**Core mechanic:** Multi-step payment processing (authorize → capture → settle) where any step can fail and the system must guarantee exactly-once semantics. Correctness over throughput.

**Real-world reference:** Stripe's payment pipeline, idempotency keys, webhook delivery.

**Why it's different:** Netflix optimizes for throughput (drop a request, lose $0.001). Stripe optimizes for correctness (drop a request, lose $10,000 or double-charge).

**New components needed:** Idempotency Layer (dedup), Saga Orchestrator (multi-step coordination), Ledger (append-only transaction log), Fraud Detection Service.

**Engine work needed:** COMPENSATE outcome — when a child fails, undo the parent's previous steps (rollback). This is the key missing primitive. Currently child failure just cascades a DROP; there's no "undo the authorization."

**Teaching arc:** Simple charges → multi-currency → 3D Secure (async verification) → subscription billing (recurring sagas) → marketplace payouts (multi-party settlement).

---

### 4. Amazon — Order Saga Orchestration 🟠 Happy Path Only

**Core mechanic:** Order touches 10+ services (cart, inventory, payment, fraud, warehouse, shipping) and each can fail independently. System maintains consistency across all of them.

**Real-world reference:** Amazon's order pipeline, Prime Day scaling, warehouse routing.

**Why it's different:** Netflix has a linear pipeline. Amazon has a DAG of dependent services with compensation logic.

**New components needed:** Order Orchestrator (saga coordinator), Inventory Service, Warehouse Router, Shipping Tracker.

**Engine work needed:** Same as Stripe — COMPENSATE outcome for saga rollback. Also partial fulfillment (some children succeed, others fail; the parent adapts rather than fully failing).

**Teaching arc:** Single item → multi-item cart → out-of-stock handling → Prime same-day (tight SLA) → Prime Day (10× spike across all services).

---

### 5. Uber — Real-Time Geospatial Matching ❌ Needs Fundamental Redesign

**Core mechanic:** Two simultaneous input streams (riders + drivers) cross-referenced geographically. Matching algorithm pairs them in under 2 seconds.

**Real-world reference:** Uber's dispatch system, H3 hexagonal geospatial indexing, surge pricing.

**Why it's different:** Netflix is single-stream pipeline. Uber is dual-stream matching — fundamentally different from our single-request-in, single-response-out model.

**New components needed:** Geospatial Index (H3 hexagons), Matching Engine (joins two request types), Pricing Service (feedback loop), Notification Push.

**Engine work needed:** Dual traffic sources generating simultaneously, request-joining mechanic (pair rider + driver), geospatial primitives beyond named zones.

**Teaching arc:** Single city → multi-zone city → surge event → concurrent ride types (UberX, Pool, XL) → cross-city airport trips.

---

## Engine Primitives Available vs Needed

| Primitive                     | Status                              | Used by campaign        |
|-------------------------------|-------------------------------------|-------------------------|
| REPLICATE phase               | Wired, no capability uses it        | Twitter, Slack          |
| SPAWN (non-blocking)          | Wired + tested                      | Twitter, Amazon, Stripe |
| SPAWN (blocking) + cascade    | Wired + tested                      | Stripe, Amazon          |
| Streaming (multi-tick)        | Production (Wave 8+)                | Slack                   |
| Zones + geo-routing           | Production (Wave 9+)                | All                     |
| COMPENSATE outcome            | **Not implemented**                 | Stripe, Amazon          |
| Dual traffic sources          | **Not implemented**                 | Uber                    |
| Request joining/matching      | **Not implemented**                 | Uber                    |
| Idempotency / dedup           | **Not implemented**                 | Stripe                  |

## Recommendation

**Twitter first.** It exercises REPLICATE (already in engine, never used) and creates genuinely different gameplay. No new engine steps needed — just new capabilities and components. The fan-out tradeoff (write amplification vs read amplification) is one of the most important distributed systems concepts and maps perfectly to player decisions.
