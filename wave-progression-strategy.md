# Wave Progression & Request Type Strategy

This document defines how traffic waves escalate across the tower defense campaign, how request types function as enemy variants that demand specific architectural counters, and how the two scaling axes (quantitative intensity and qualitative diversity) combine to teach system architecture through gameplay pressure.

---

## Two Axes of Scaling

The TD campaign escalates along two independent axes that combine multiplicatively.

### Quantitative Axis: Intensity

Each wave increases `TrafficSource.intensity` — the raw number of requests per tick. Wave 1 might generate 10 requests/tick. Wave 5 generates 500. Wave 10 generates 10,000+. This is the "enemies get stronger" mechanic. A single request in wave 10 might represent 1,000 real user actions (the TrafficSource abstracts this — the player sees "10,000 rps" on the HUD, not individual request objects).

The player counters intensity with horizontal scaling: more servers, load balancers, caching layers, and eventually auto-scaling. This teaches the first scaling lesson: **you can't serve a million users from one server.**

Intensity alone is solvable by throwing money at the problem — just place more of what you already have. That's why the qualitative axis exists.

### Qualitative Axis: Diversity

New request types appear at specific waves. Each new type has properties that the player's existing architecture handles poorly or not at all. The specialized counter (a specific component or upgrade) handles it efficiently. The player *can* brute-force any request type through generic Servers, but at a severe efficiency penalty — higher latency, higher upkeep per request, lower throughput. The economic pressure from the quantitative axis makes brute-force unsustainable. Together, the two axes force the player toward the architecturally correct solution.

This is the core teaching loop: **new traffic patterns demand new architectural patterns.** The player doesn't learn "place a CDN" from a tooltip — they learn it because their servers are drowning in image requests and they're hemorrhaging budget.

---

## Request Types as Enemy Variants

Each request type has properties that determine how it interacts with the simulation. These properties map to real-world characteristics that drive architectural decisions.

### Base Request Types

```
api_read:
  processingCost: 1        # ticks of PROCESS-phase compute
  bandwidth: 1             # connection bandwidth units consumed
  revenue: 1               # base revenue on successful completion
  ttl: 10                  # ticks before timeout
  description: "A simple API read. The bread and butter of web traffic."
  
api_write:
  processingCost: 2        # writes are more expensive than reads
  bandwidth: 1
  revenue: 1.5             # slightly higher value — user is creating data
  ttl: 12
  requiresStorage: true    # must reach a component with StorageCapability
  description: "A data mutation. Needs to reach a database."

static_asset:
  processingCost: 0.5      # trivial to serve if cached
  bandwidth: 3             # images/CSS/JS are larger than API payloads
  revenue: 0.3             # low value per request but high volume
  ttl: 8
  cacheable: true          # CachingCapability can intercept and serve
  description: "An image, stylesheet, or script. High volume, low compute."

auth_required:
  processingCost: 1.5
  bandwidth: 1
  revenue: 1
  ttl: 10
  requiresAuth: true       # must pass through AuthCapability before processing
  description: "A request that needs authentication before anything else."

batch:
  processingCost: 10       # heavy compute — video transcode, analytics job
  bandwidth: 2
  revenue: 5               # high value but slow
  ttl: 50                  # long TTL — batch jobs take time
  async: true              # optimal path is Queue → Worker, not synchronous
  batchSize: 10            # spawns N child requests when processed by BatchProcessingCapability
  description: "A heavy async job. Transcoding, analytics, recommendation generation."

stream:
  processingCost: 2        # initial setup cost
  bandwidth: 5             # sustained bandwidth — streams are fat pipes
  revenue: 3               # per-tick revenue while active (not one-shot)
  ttl: 100                 # long-lived
  streamDuration: 20       # occupies connection bandwidth for 20 ticks
  streamBandwidth: 3       # bandwidth reserved per tick during stream
  description: "Video playback. A sustained flow, not a single response."

event:
  processingCost: 0.5      # lightweight — just a notification
  bandwidth: 1
  revenue: 0               # events don't directly generate revenue
  ttl: 15
  fanout: true             # REPLICATE phase fans out to all subscribers
  description: "A pub/sub event. User watched X, update the recommendation model."
```

### The Brute Force Tax

Any request type *can* be processed by a generic Server. A Server's `ProcessingCapability` returns `canHandle() → true` for everything — it's a general-purpose workhorse. But it processes every type at its base `processingCost` with no optimizations. Specialized components process their target types more efficiently:

| Request Type | Server (generic) | Optimal Counter | Efficiency Gain |
|---|---|---|---|
| `api_read` | processingCost: 1 | Server (this IS the counter) | 1× (baseline) |
| `api_write` | processingCost: 2 | Server + Database | 1× (no shortcut for writes) |
| `static_asset` | processingCost: 0.5 | CDN (serves from cache, cost: ~0) | ~10× — CDN serves cached assets at near-zero compute |
| `auth_required` | processingCost: 1.5 + auth overhead | API Gateway (auth at edge) | ~2× — Gateway handles auth before routing, prevents unauthorized requests from consuming downstream compute |
| `batch` | processingCost: 10 (blocks the server) | Queue + Worker (async, batched) | ~5× — Worker pulls from queue, processes in batches, doesn't block synchronous path |
| `stream` | processingCost: 2 + occupies bandwidth for 20 ticks | Streaming/Media Server | ~3× — adaptive bitrate, chunked delivery, dedicated bandwidth management |
| `event` | processingCost: 0.5 (but no fan-out) | Any component with ReplicationCapability | N/A — Server can't fan out; events require REPLICATE phase |

The efficiency gain isn't just about processing cost — it's about *opportunity cost*. A Server processing a `static_asset` request is a Server not processing an `api_read` request. At scale, the cost of using the wrong component for a request type compounds: you need more Servers, which means more upkeep, which eats into your budget, which prevents you from scaling for the next wave.

This is the economic engine of the game. The player who builds the right counter for each request type runs a lean, efficient architecture. The player who brute-forces everything with Servers runs out of money by wave 7.

---

## Wave Progression

Each wave introduces new request types, increases intensity, and — at key moments — introduces structural challenges (chaos events, zone requirements) that demand new architectural patterns.

### Wave 1: "Launch Day"

**Narrative:** Your startup just launched. A handful of users are hitting your single server. Keep the lights on.

**Traffic composition:**
- 100% `api_read`
- Intensity: 10 requests/tick

**What the player learns:** Basic wiring. Server receives requests, processes them, returns responses. Place a Server, connect it to the entry point. Success means "requests come in, responses go out."

**Available components:** Server, Database (but not needed yet — reads don't require storage in wave 1).

**Architectural lesson:** The request/response cycle. What a server does. What latency means.

---

### Wave 2: "Users Start Signing Up"

**Narrative:** Word is spreading. Traffic doubles and users are creating accounts — that means writes.

**Traffic composition:**
- 70% `api_read`, 30% `api_write`
- Intensity: 25 requests/tick

**New request type: `api_write`.** Writes are more expensive than reads (2× processing cost) and require reaching a component with `StorageCapability`. If the player hasn't placed a Database, writes fail.

**What the player learns:** Read/write asymmetry. Writes are harder than reads. You need persistent storage. The Server alone can't handle everything.

**Counter:** Database. The player wires Server → Database so writes can persist. They see that writes take longer than reads in the diagnostics screen.

**Architectural lesson:** Separation of compute and storage. Servers process logic; databases persist state.

---

### Wave 3: "Traffic Spikes"

**Narrative:** A blog post about your product goes semi-viral. Traffic 5×'s. Your single server can't keep up.

**Traffic composition:**
- 70% `api_read`, 30% `api_write`
- Intensity: 50 requests/tick (first real pressure)

**No new request type — just intensity.** The player's single Server + Database architecture starts dropping requests or hitting TTL.

**What the player learns:** A single server has a throughput ceiling. You need to either scale horizontally (more servers + load balancer) or reduce load (caching).

**Counter:** Load Balancer + additional Server(s), or Cache in front of Database. Both are valid. The player who adds a Cache sees repeated reads served instantly (cache hits generate RESPOND in INTERCEPT phase, never reaching the Database). The player who adds a Load Balancer + Servers sees throughput increase linearly. The optimal answer is both — but budget forces prioritization.

**Architectural lesson:** Horizontal scaling and caching are complementary strategies. Load balancing distributes work; caching eliminates work.

---

### Wave 4: "Marketing Adds Images"

**Narrative:** Marketing redesigns the landing page with high-res images and heavy CSS. Suddenly 40% of your traffic is static asset requests that your servers are wasting compute on.

**Traffic composition:**
- 40% `api_read`, 20% `api_write`, 40% `static_asset`
- Intensity: 80 requests/tick

**New request type: `static_asset`.** High bandwidth (3× a normal request), low revenue (0.3× per request), but massive volume. Servers can handle them but it's wasteful — each static request occupies a Server that could be processing a higher-value API call.

**What the player learns:** Not all requests are equal. Static content is high-volume, low-value, and perfectly cacheable. Serving it from your application servers is an architectural mistake.

**Counter:** CDN. The CDN's FilterCapability intercepts static requests in the INTERCEPT phase and serves them from cache — they never reach the Server. The player watches their Server load drop by 40% after placing a CDN. The economic lesson is immediate: CDN has high placement cost but near-zero upkeep, and it frees your Servers (which have high upkeep) to do valuable work.

**Architectural lesson:** Edge caching. Serve static content from the edge; reserve your servers for dynamic work. Capital expense (CDN placement) reduces operational expense (server load).

---

### Wave 5: "The Authentication Wall"

**Narrative:** You're adding user accounts, personalization, and premium features. Every request now needs to be authenticated. Your servers are spending half their time validating tokens instead of processing business logic.

**Traffic composition:**
- 30% `api_read`, 20% `api_write`, 30% `static_asset`, 20% `auth_required`
- Intensity: 150 requests/tick

**New request type: `auth_required`.** These requests have `requiresAuth: true` — they must pass through a component with `AuthCapability` before the PROCESS phase, or they fail. A generic Server *can* handle auth (its ProcessingCapability accepts anything), but it does auth + business logic sequentially, burning compute on both.

**What the player learns:** Authentication is a cross-cutting concern. Handling it inside every service is wasteful and inconsistent. You need a dedicated edge component that validates auth once and routes to specialized backends.

**Counter:** API Gateway. AuthCapability (INTERCEPT) validates the token before anything else — unauthenticated requests are rejected instantly (DROPped) without consuming downstream compute. RateLimitCapability prevents abuse. RoutingCapability routes authenticated requests to the correct backend service by path/content. This is the monolith → microservices transition.

**Architectural lesson:** API Gateway pattern. Centralize cross-cutting concerns (auth, rate limiting, routing) at the edge. This is why Netflix built Zuul.

**Structural unlock:** Service Registry becomes available. Without it, the player manually wires the API Gateway to each backend. With it, new service instances auto-register and become routing targets. The player discovers this need organically: adding a third or fourth backend service and manually rewiring connections is tedious enough to motivate the registry.

---

### Wave 6: "Async Workloads"

**Narrative:** Your product now generates video thumbnails, sends email notifications, and computes recommendation scores. These are expensive operations that shouldn't block the API response.

**Traffic composition:**
- 25% `api_read`, 15% `api_write`, 25% `static_asset`, 15% `auth_required`, 15% `batch`, 5% `event`
- Intensity: 250 requests/tick

**New request types: `batch` and `event`.** Batch requests have 10× processing cost and long TTL — they represent heavy async work (video transcoding, analytics). If processed on a Server, they block synchronous traffic for multiple ticks. Events have `fanout: true` — they need to be replicated to multiple downstream consumers (recommendation service, analytics service, notification service).

**What the player learns:** Not everything is request/response. Some work should be queued and processed asynchronously. Some work is event-driven and needs to fan out to multiple consumers.

**Counter:** Queue + Worker for batch. The Queue buffers batch requests (proactive INTERCEPT hold). The Worker pulls from the Queue via `BatchProcessingCapability` and processes items in batches — high throughput, doesn't block the synchronous path. For events, any component with `ReplicationCapability` in the REPLICATE phase fans out to subscribers.

**Architectural lesson:** Asynchronous processing and event-driven architecture. Queue decouples producers from consumers. Workers scale independently from API servers. Events decouple services from each other. This is how Netflix transcodes millions of video segments and updates recommendations without blocking API responses.

---

### Wave 7: "The Outage"

**Narrative:** Your recommendation service starts failing intermittently. First a few timeouts, then a flood. Requests that depend on it cascade into failures. Your entire system goes down because one service is sick.

**Traffic composition:**
- Same as wave 6 (no new types)
- Intensity: 350 requests/tick
- **Chaos event:** One downstream service degrades to critical condition mid-wave. Requests routed to it fail or time out.

**No new request type — this wave introduces failure.** The chaos event (triggered by the ModeController) randomly degrades a component's condition to 0.0 during the wave. Requests that depend on the failed component cascade: the API Gateway keeps routing to it, responses time out, the Queue fills up, and the entire system's latency spikes.

**What the player learns:** Cascading failure. One sick component can bring down the whole system if nothing prevents traffic from flowing into it.

**Counter:** Circuit Breaker. Placed between the API Gateway and the failing service, the Circuit Breaker detects consecutive failures, opens the circuit (stops sending traffic), and returns fallback responses instantly. The healthy parts of the system keep running. The player watches the circuit open, sees the fallback responses, and then watches it half-open to probe recovery when the failing service comes back.

**Architectural lesson:** Resilience patterns. Circuit breakers prevent cascading failure. Fallback responses degrade gracefully instead of failing completely. This is why Netflix invented Hystrix.

**Also teaches:** The player who already has a Load Balancer with `HealthCheckCapability` at tier 2+ sees it route *away* from the degraded component automatically. Multiple resilience layers compound — health-aware routing + circuit breaking + retry with backoff create a fault-tolerant system. The player who has none of these watches their architecture crumble.

---

### Wave 8: "Video Launch"

**Narrative:** Your company launches video streaming. The traffic profile changes fundamentally — a single video playback session consumes as much bandwidth as hundreds of API calls, and it lasts for minutes, not milliseconds.

**Traffic composition:**
- 20% `api_read`, 10% `api_write`, 20% `static_asset`, 10% `auth_required`, 10% `batch`, 5% `event`, 25% `stream`
- Intensity: 500 requests/tick

**New request type: `stream`.** Streaming requests occupy connection bandwidth for 20 ticks (vs. 1 tick for a normal request) and consume 3 bandwidth units per tick (vs. 1). A few dozen streams can saturate a connection that handles hundreds of normal requests. Processing them on generic Servers is possible but disastrous — each stream monopolizes a Server and connection for 20 ticks.

**What the player learns:** Streaming is a fundamentally different traffic pattern. It's not "a big request" — it's a sustained flow that needs dedicated infrastructure. You can't mix streaming and API traffic on the same connections without starving the API.

**Counter:** Streaming/Media Server + Blob Storage. The Streaming/Media Server's `StreamingCapability` handles adaptive bitrate delivery — it adjusts stream bandwidth based on congestion instead of dropping. Its `CachingCapability` caches popular stream segments. Blob Storage holds the video files with a cost profile optimized for large sequential reads (cheap storage, high bandwidth). The player wires: CDN → Streaming Server → Blob Storage, creating a dedicated streaming path separate from the API path.

**Architectural lesson:** Traffic isolation. Streaming infrastructure must be separated from API infrastructure because they have fundamentally different resource profiles. This is why Netflix built Open Connect as a dedicated content delivery network separate from their API tier.

---

### Wave 9: "Going Global"

**Narrative:** Your user base is now worldwide. Users in Europe are complaining about latency. Users in Asia can't stream without buffering. Your single-datacenter architecture has hit a geographic wall.

**Traffic composition:**
- Same types as wave 8
- Intensity: 800 requests/tick
- **New:** Requests now have `originZone` spread across `"na-east"` (40%), `"eu-west"` (35%), `"ap-south"` (25%)
- Cross-zone latency penalties apply (NA↔EU: +80ms, NA↔AP: +150ms)

**No new request type — this wave introduces geography.** The player's single-zone architecture works but EU and AP users see massive latency penalties. The diagnostics screen shows the zone-pair latency adding 80-150ms to every cross-zone request — making streams unwatchable and API calls sluggish.

**What the player learns:** Geography is a scaling dimension. You can't serve global users from a single datacenter no matter how powerful it is. The speed of light is the ultimate bottleneck.

**Counter:** DNS/GTM + multi-zone replication. The player places a DNS/GTM component at the entry point. Its `GeoRoutingCapability` routes requests to the nearest healthy zone. The player then replicates their architecture across zones: Servers, Databases (with cross-zone `ReplicationCapability`), Caches, Streaming infrastructure — each zone gets a copy.

**Architectural lesson:** Multi-region architecture. Replicate your infrastructure across geographic zones and route users to the nearest one. The cost scales linearly (you're building 2-3 copies of your architecture) but latency drops dramatically. This is the core global scaling pattern — Netflix runs in 3+ AWS regions for exactly this reason.

**Also teaches:** Data consistency tradeoffs. Cross-zone replication has latency (a write in NA takes 80ms+ to replicate to EU). During that window, reads in EU return stale data. The player observes this in the diagnostics screen and learns the CAP theorem through direct experience, not a textbook.

---

### Wave 10: "The Viral Moment"

**Narrative:** Your biggest show drops its final season. Traffic explodes 10× across every zone and every request type simultaneously. Your architecture either bends or breaks.

**Traffic composition:**
- All request types active, weighted toward `stream` (40%) and `api_read` (25%)
- Intensity: 3000+ requests/tick across all zones
- **Chaos events:** Zone outage (one full zone goes critical), connection severing (random inter-zone links drop), latency injection (network degradation)

**No new request type — this wave tests everything.** The player's architecture faces the ultimate stress test: massive scale + all traffic types + deliberate failures, all simultaneously.

**What the player learns:** Everything they've built is tested together. Do their auto-scaling policies react fast enough? Do their circuit breakers prevent cascading failure during the zone outage? Does their DNS/GTM reroute traffic to surviving zones? Does their async pipeline absorb the batch spike without starving the API path?

**Counter:** AutoScaleCapability. This is the wave where manual scaling breaks. The player who unlocked AutoScaleCapability on their Servers and Workers sees instance counts ramp up dynamically. The player who didn't has to watch their fixed-size architecture crumble under 10× load.

**Architectural lesson:** Elastic infrastructure. At true scale, capacity must be dynamic. The viral moment is the ultimate validation of every architectural decision the player has made across 10 waves: caching strategy, traffic isolation, resilience patterns, multi-region, async processing, and auto-scaling all working together. The leanest architecture that survives with the highest profit margin wins.

---

## The Cumulative Pressure Model

The key insight is that request types **never disappear**. Wave 10 still has `api_read` from wave 1. The player's architecture must handle all types simultaneously, and each type's volume grows with the overall intensity. This creates a compound scaling challenge:

```
Wave 1:  [api_read ████████████████████]
Wave 2:  [api_read ██████████████] [api_write ██████]
Wave 3:  [api_read ████████████████████████████] [api_write ████████████]  (intensity spike)
Wave 4:  [api_read ████████] [api_write ████] [static ████████] 
Wave 5:  [api_read ██████] [api_write ████] [static ██████] [auth ████]
Wave 6:  [api_read █████] [write ███] [static █████] [auth ███] [batch ███] [event █]
Wave 7:  [same as 6 but with chaos event mid-wave]
Wave 8:  [api_read ████] [write ██] [static ████] [auth ██] [batch ██] [event █] [stream █████]
Wave 9:  [same as 8 × 3 zones, with cross-zone latency]
Wave 10: [EVERYTHING AT 10× WITH CHAOS]
```

The player can't "solve" any single wave in isolation. Each wave's solution must be forward-compatible with future waves. A Cache placed in wave 3 must still function when streams arrive in wave 8. A Load Balancer upgraded in wave 3 must still route efficiently when zones appear in wave 9. This forward-compatibility pressure is what teaches real architecture: good system design isn't about solving today's problem — it's about solving today's problem in a way that doesn't break tomorrow.

---

## Economic Pressure Curve

The economic model ensures that brute-force scaling becomes unsustainable as diversity increases.

**Revenue per wave scales sub-linearly with intensity.** Early waves have generous revenue-per-request ratios. Later waves decrease revenue per request (more traffic, thinner margins — modeling real-world unit economics at scale). This means the player can't just "earn more by serving more" forever — efficiency becomes critical.

**Upkeep scales linearly with components.** Every Server, Database, and Cache costs per tick whether it's busy or idle. A player who over-provisions for wave 5 pays the upkeep tax in waves 6-10 even if those components aren't fully utilized. This teaches capacity planning.

**The efficiency wedge:** The gap between "brute force with generic Servers" and "specialized counters" widens each wave. In wave 4, the CDN saves maybe 30% of server upkeep. By wave 8, the player without a CDN, streaming infrastructure, and async pipeline is spending 3-4× what the efficient player spends — for the same throughput.

| Wave | Brute Force Budget | Efficient Budget | Savings |
|------|-------------------|-----------------|---------|
| 1-3 | ~100/tick | ~90/tick | ~10% — brute force is fine early |
| 4-5 | ~250/tick | ~160/tick | ~35% — CDN and Gateway pay for themselves |
| 6-7 | ~500/tick | ~280/tick | ~45% — async pipeline and Circuit Breaker |
| 8-9 | ~1200/tick | ~550/tick | ~55% — streaming isolation and multi-zone |
| 10 | ~3000/tick | ~1100/tick | ~63% — auto-scaling vs. permanent over-provision |

The numbers above are illustrative, not final — they'll need balancing during playtesting. The pattern is what matters: the efficiency advantage of the "correct" architecture compounds with each wave.

---

## Boss Waves (Optional)

Between the standard waves, optional boss waves present extreme versions of a single request type. These are high-risk, high-reward — the player can skip them but misses bonus income.

**"DDoS Attack" (after wave 5):** A massive spike of `auth_required` requests, most of which are invalid. Tests the API Gateway's RateLimitCapability and AuthCapability. The player's score depends on how quickly invalid requests are rejected (DROP in INTERCEPT) vs. how many leak through to consume downstream compute.

**"Recommendation Storm" (after wave 6):** An avalanche of `event` requests as every user simultaneously triggers recommendation updates. Tests the pub/sub fan-out and async pipeline. The player's Worker pool and Queue depth determine whether the recommendation system survives.

**"Season Premiere" (after wave 8):** A 50× spike in `stream` requests concentrated in a single zone. Tests streaming infrastructure capacity and CDN cache warm-up. The player who pre-positioned Blob Storage and Streaming Servers in the right zone survives. The player who didn't learns the hard way that you can't spin up streaming infrastructure reactively.

**"Chaos Monkey" (after wave 9):** Continuous random failures across all zones for 30 ticks. Nothing specific to counter — this tests the entire resilience stack. Circuit breakers, health-aware routing, multi-zone failover, auto-scaling all need to work together. The player's final score depends on uptime percentage during the chaos.

---

## Mapping to Component Architecture

Every concept in this document maps to existing constructs in `component-architecture.md`:

| Wave Concept | Architecture Construct |
|---|---|
| Request type properties (`processingCost`, `bandwidth`, `revenue`) | Request fields + Capability-specific handling |
| Brute force tax | `ProcessingCapability.canHandle()` returns true for everything; specialized capabilities are more efficient |
| New request type introduction | `TrafficSource.requestTypes` distribution changes per wave |
| Intensity scaling | `TrafficSource.intensity` increases per wave |
| Chaos events | ModeController failure injection (see Failure Injection section) |
| Zone introduction | `Request.originZone` + zone-pair latency table |
| Economic pressure | `Component.getUpkeepCost()` × `instanceCount` vs. revenue per successful request |
| Boss waves | Special TrafficSource configurations with extreme parameters |
| Cumulative types | TrafficSource generates a weighted mix; weights shift each wave but no type drops to 0% |

No new engine constructs are needed. The wave progression is entirely driven by TrafficSource configuration and ModeController decisions — the simulation engine processes all request types uniformly through the capability pipeline. This validates the architecture's extensibility claim: adding 7 request types and 10 wave configurations required zero engine modifications.
