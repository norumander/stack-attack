/**
 * Instagram Diagnose arc — 5 levels.
 *
 * Each level hands the player a pre-built ~15-component system with one or
 * more subtle flaws. They observe live metrics, diagnose, and remediate
 * within a capped budget to meet SLA under a single revealing wave.
 *
 * Starting topology progression (each level builds on the previous level's
 * intended fix):
 *   L1 — Baseline Instagram. No cache between servers and Posts DB →
 *        celebrity hot-key saturates the database.
 *   L2 — L1 + Profile Cache. Photo uploads route through API Servers →
 *        Servers drown while Streaming/Blob sit idle.
 *   L3 — L2 + ag1 → ss_reels rewire. Single Worker per queue → queues back
 *        up under async avalanche.
 *   L4 — L3 + second workers. Single NA region → AP users pay cross-zone
 *        latency tax.
 *   L5 — L4 + APAC replica. No CB on the non-Posts paths, no AutoScale, no
 *        cache redundancy → chaos events during a viral spike cascade.
 */

import type { ComponentId } from "@core/types/ids";
import { topology, type TopologyDef } from "../playtest/topology-builder";
import type { DiagnoseLevel } from "./diagnose-level";

const CLIENT_ID = "client" as ComponentId;

// ---------- Starting topologies ---------------------------------------------

/** Level 1 starting topology: the inherited Instagram system with Profile DB
 * lacking a cache. All in zone_na. */
function baseInstagram(): ReturnType<typeof topology> {
  return topology("instagram-1-start")
    .add("cdn", "cdn1", "CDN")
    .add("api_gateway", "ag1", "API Gateway")
    .add("load_balancer", "lb_api", "API LB")
    .add("server", "s1", "API Server 1")
    .add("server", "s2", "API Server 2")
    .add("server", "s3", "API Server 3")
    .add("server", "s4", "API Server 4")
    .add("database", "db_posts", "Posts DB")
    .add("queue", "q_notif", "Notifications Queue")
    .add("worker", "w_notif", "Notifications Worker")
    .add("queue", "q_likes", "Likes Queue")
    .add("worker", "w_likes", "Likes Worker")
    .add("streaming_server", "ss_reels", "Reels Streaming")
    .add("circuit_breaker", "cb_posts", "Posts CB")
    .entry("cdn1")
    .connect("cdn1", "ag1")
    .connect("ag1", "lb_api")
    .connect("lb_api", "s1")
    .connect("lb_api", "s2")
    .connect("lb_api", "s3")
    .connect("lb_api", "s4")
    .connect("s1", "cb_posts")
    .connect("s2", "cb_posts")
    .connect("s3", "cb_posts")
    .connect("s4", "cb_posts")
    .connect("cb_posts", "db_posts")
    .connect("ag1", "q_notif")
    .connect("q_notif", "w_notif")
    .connect("w_notif", "db_posts")
    .connect("ag1", "q_likes")
    .connect("q_likes", "w_likes")
    .connect("w_likes", "db_posts");
  // NOTE: ss_reels is inherited but intentionally NOT wired to the API
  // Gateway — that rewire is the L2 remediation. Blob storage is omitted
  // from the starting topologies because the pre-sim validator is strict
  // about it (blob_storage dead-ends any non-large/non-stream BFS path).
  // Players add blob storage if they want as a remediation option.
}

/** Level 2 starting topology: L1 + Data Cache (the expected L1 fix). */
function level2Start(): ReturnType<typeof topology> {
  return topology("instagram-2-start")
    .add("cdn", "cdn1", "CDN")
    .add("api_gateway", "ag1", "API Gateway")
    .add("load_balancer", "lb_api", "API LB")
    .add("server", "s1", "API Server 1")
    .add("server", "s2", "API Server 2")
    .add("server", "s3", "API Server 3")
    .add("server", "s4", "API Server 4")
    .add("data_cache", "c_posts", "Posts Cache")
    .add("database", "db_posts", "Posts DB")
    .add("queue", "q_notif", "Notifications Queue")
    .add("worker", "w_notif", "Notifications Worker")
    .add("queue", "q_likes", "Likes Queue")
    .add("worker", "w_likes", "Likes Worker")
    .add("streaming_server", "ss_reels", "Reels Streaming")
    .add("circuit_breaker", "cb_posts", "Posts CB")
    .entry("cdn1")
    .connect("cdn1", "ag1")
    .connect("ag1", "lb_api")
    .connect("lb_api", "s1")
    .connect("lb_api", "s2")
    .connect("lb_api", "s3")
    .connect("lb_api", "s4")
    .connect("s1", "c_posts")
    .connect("s2", "c_posts")
    .connect("s3", "c_posts")
    .connect("s4", "c_posts")
    .connect("c_posts", "cb_posts")
    .connect("cb_posts", "db_posts")
    .connect("ag1", "q_notif")
    .connect("q_notif", "w_notif")
    .connect("w_notif", "db_posts")
    .connect("ag1", "q_likes")
    .connect("q_likes", "w_likes")
    .connect("w_likes", "db_posts");
  // L2 starting DOES NOT wire ag1→ss_reels. Adding that edge IS the L2
  // remediation.
}

/** Level 3 starting topology: L2 + ag1→ss_reels wired (the L2 fix). Flaw
 *  shifts to queue workers being single. */
function level3Start(): ReturnType<typeof topology> {
  // L3 inherits L2's *intended* topology = L2 start + ag1→ss_reels (the L2
  // fix). ss_reels also writes stream metadata into db_posts so the API
  // write / non-stream paths can resolve. Flaw at this level is the single
  // worker per queue.
  return level2Start()
    .connect("ag1", "ss_reels")
    .connect("ss_reels", "db_posts");
}

/** Level 4 starting topology: L3 + second worker on each queue (the L3
 *  fix). All components tagged NA. */
function level4Start(): ReturnType<typeof topology> {
  const t = topology("instagram-4-start")
    .add("cdn", "cdn1", "CDN")
    .add("api_gateway", "ag1", "API Gateway")
    .add("load_balancer", "lb_api", "API LB")
    .add("server", "s1", "API Server 1")
    .add("server", "s2", "API Server 2")
    .add("server", "s3", "API Server 3")
    .add("server", "s4", "API Server 4")
    .add("data_cache", "c_posts", "Posts Cache")
    .add("database", "db_posts", "Posts DB")
    .add("queue", "q_notif", "Notifications Queue")
    .add("worker", "w_notif", "Notifications Worker")
    .add("worker", "w_notif2", "Notifications Worker 2")
    .add("queue", "q_likes", "Likes Queue")
    .add("worker", "w_likes", "Likes Worker")
    .add("worker", "w_likes2", "Likes Worker 2")
    .add("streaming_server", "ss_reels", "Reels Streaming")
    .add("circuit_breaker", "cb_posts", "Posts CB")
    .entry("cdn1")
    .connect("cdn1", "ag1")
    .connect("ag1", "lb_api")
    .connect("lb_api", "s1")
    .connect("lb_api", "s2")
    .connect("lb_api", "s3")
    .connect("lb_api", "s4")
    .connect("s1", "c_posts")
    .connect("s2", "c_posts")
    .connect("s3", "c_posts")
    .connect("s4", "c_posts")
    .connect("c_posts", "cb_posts")
    .connect("cb_posts", "db_posts")
    .connect("ag1", "q_notif")
    .connect("q_notif", "w_notif")
    .connect("q_notif", "w_notif2")
    .connect("w_notif", "db_posts")
    .connect("w_notif2", "db_posts")
    .connect("ag1", "q_likes")
    .connect("q_likes", "w_likes")
    .connect("q_likes", "w_likes2")
    .connect("w_likes", "db_posts")
    .connect("w_likes2", "db_posts")
    .connect("ag1", "ss_reels")
    .connect("ss_reels", "db_posts");

  for (const id of [
    "cdn1", "ag1", "lb_api", "s1", "s2", "s3", "s4",
    "c_posts", "db_posts",
    "q_notif", "w_notif", "w_notif2", "q_likes", "w_likes", "w_likes2",
    "ss_reels", "cb_posts",
  ]) {
    t.inZone(id, "zone_na");
  }
  return t;
}

/** Level 5 starting topology: L4 + APAC replica + DNS/GTM (the L4 fix).
 *  Still missing: CBs on non-Posts paths, AutoScale markers, cache
 *  redundancy. These are the L5 flaws. */
function level5Start(): ReturnType<typeof topology> {
  const t = topology("instagram-5-start")
    .add("dns_gtm", "gtm", "DNS/GTM")
    // NA stack
    .add("cdn", "cdn1", "CDN NA")
    .add("api_gateway", "ag1", "API Gateway NA")
    .add("load_balancer", "lb_api", "API LB NA")
    .add("server", "s1", "API Server 1")
    .add("server", "s2", "API Server 2")
    .add("server", "s3", "API Server 3")
    .add("server", "s4", "API Server 4")
    .add("data_cache", "c_posts", "Posts Cache NA")
    .add("database", "db_posts", "Posts DB NA")
    .add("queue", "q_notif", "Notifications Queue")
    .add("worker", "w_notif", "Notifications Worker")
    .add("worker", "w_notif2", "Notifications Worker 2")
    .add("queue", "q_likes", "Likes Queue")
    .add("worker", "w_likes", "Likes Worker")
    .add("worker", "w_likes2", "Likes Worker 2")
    .add("streaming_server", "ss_reels", "Reels Streaming")
    .add("circuit_breaker", "cb_posts", "Posts CB NA")
    // APAC stack (minimal: CDN + Server + Cache + DB)
    .add("cdn", "cdn_ap", "CDN APAC")
    .add("server", "s_ap", "API Server APAC")
    .add("data_cache", "c_ap", "Cache APAC")
    .add("database", "db_ap", "Posts DB APAC")
    .entry("gtm")
    // NA wiring
    .connect("gtm", "cdn1")
    .connect("cdn1", "ag1")
    .connect("ag1", "lb_api")
    .connect("lb_api", "s1")
    .connect("lb_api", "s2")
    .connect("lb_api", "s3")
    .connect("lb_api", "s4")
    .connect("s1", "c_posts")
    .connect("s2", "c_posts")
    .connect("s3", "c_posts")
    .connect("s4", "c_posts")
    .connect("c_posts", "cb_posts")
    .connect("cb_posts", "db_posts")
    .connect("ag1", "q_notif")
    .connect("q_notif", "w_notif")
    .connect("q_notif", "w_notif2")
    .connect("w_notif", "db_posts")
    .connect("w_notif2", "db_posts")
    .connect("ag1", "q_likes")
    .connect("q_likes", "w_likes")
    .connect("q_likes", "w_likes2")
    .connect("w_likes", "db_posts")
    .connect("w_likes2", "db_posts")
    .connect("ag1", "ss_reels")
    .connect("ss_reels", "db_posts")
    // APAC wiring
    .connect("gtm", "cdn_ap")
    .connect("cdn_ap", "s_ap")
    .connect("s_ap", "c_ap")
    .connect("c_ap", "db_ap");

  // Zone assignments.
  for (const id of [
    "gtm", "cdn1", "ag1", "lb_api", "s1", "s2", "s3", "s4",
    "c_posts", "db_posts",
    "q_notif", "w_notif", "w_notif2", "q_likes", "w_likes", "w_likes2",
    "ss_reels", "cb_posts",
  ]) {
    t.inZone(id, "zone_na");
  }
  t.inZone("gtm", "zone_na");
  for (const id of ["cdn_ap", "s_ap", "c_ap", "db_ap"]) {
    t.inZone(id, "zone_ap");
  }
  return t;
}

// ---------- The 5 levels ----------------------------------------------------

export const INSTAGRAM_LEVELS: ReadonlyArray<DiagnoseLevel> = [
  {
    id: "instagram-1",
    title: "Instagram L1 — Celebrity Post",
    briefing:
      "A celebrity just posted. Hot traffic is hammering one profile. The Posts DB is drowning under read load. Find the bottleneck, fix it before the SLA breaks.",
    narrative:
      "Hot reads concentrate on a single key — the celebrity's post. Every request goes straight to the database with no caching layer. Add a Data Cache between the servers and the Posts DB.",
    startingTopology: baseInstagram().build() satisfies TopologyDef,
    remediationBudget: 400,
    wave: {
      intensity: 80,
      packetRate: 15,
      duration: 12,
      composition: { writeRatio: 0.15, authRatio: 0.05, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.3, spaceSize: 200 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
  },
  {
    id: "instagram-2",
    title: "Instagram L2 — Sunset Upload Wave",
    briefing:
      "Golden hour = mass uploads. Your Streaming Server is idle while API Servers drown. What's the rewire?",
    narrative:
      "Photo uploads are large_payload traffic. They're squeezing through the API path when a dedicated Streaming / Blob path exists. Rewire the gateway.",
    // L2 start already contains the Profile Cache fix from L1. The L2
    // flaw is that ag1→ss_reels is not wired — adding that edge is the
    // expected remediation (sends streams/large to the dedicated path).
    startingTopology: level2Start().build() satisfies TopologyDef,
    remediationBudget: 500,
    wave: {
      intensity: 120,
      packetRate: 10,
      duration: 12,
      composition: { writeRatio: 0.15, authRatio: 0.15, streamRatio: 0, largeRatio: 0.2, asyncRatio: 0.1 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 180 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.83, maxAvgLatencySeconds: 2, maxDropRate: 0.17 },
  },
  {
    id: "instagram-3",
    title: "Instagram L3 — Notifications Avalanche",
    briefing:
      "Breaking news event → likes + notifications flood. Queues backing up. Workers can't keep up.",
    narrative:
      "Async work is 35% of the wave but every queue has exactly one worker. Queue depth rises; latency bleeds into sync.",
    // L3 start = L2 intended (with ag1→ss_reels wired). Flaw is single
    // worker per queue. The pipeline graph still has one worker per queue
    // in our baseInstagram; level3Start() uses level2Start() which has
    // only w_notif + w_likes.
    startingTopology: level3Start().build() satisfies TopologyDef,
    remediationBudget: 450,
    wave: {
      intensity: 140,
      packetRate: 12,
      duration: 14,
      composition: { writeRatio: 0.1, authRatio: 0.15, streamRatio: 0, largeRatio: 0.1, asyncRatio: 0.35 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 220 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 0, perAsync: 3 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.8, maxAvgLatencySeconds: 2, maxDropRate: 0.2 },
  },
  {
    id: "instagram-4",
    title: "Instagram L4 — Cold Zone Syndrome",
    briefing:
      "Growing in Asia. Pings from Tokyo take 800ms. What do you do?",
    narrative:
      "40% NA, 25% EU, 35% AP — but every component lives in zone_na. Stand up a replica stack in zone_ap and route with DNS/GTM.",
    startingTopology: level4Start().build() satisfies TopologyDef,
    remediationBudget: 1500,
    wave: {
      intensity: 150,
      packetRate: 12,
      duration: 14,
      composition: { writeRatio: 0.15, authRatio: 0.1, streamRatio: 0.1, largeRatio: 0.15, asyncRatio: 0.1 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 220 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.5, bandwidth: 20 },
      zoneDistribution: new Map([
        ["zone_na", 0.4],
        ["zone_eu", 0.25],
        ["zone_ap", 0.35],
      ]),
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.78, maxAvgLatencySeconds: 1.5, maxDropRate: 0.2 },
  },
  {
    id: "instagram-5",
    title: "Instagram L5 — The Cascadia Event",
    briefing:
      "Major event viral moment. Infrastructure stressed, chaos events incoming. This is what you've been training for.",
    narrative:
      "Three chaos events, loose SLA — but your cache has no twin, most DBs have no CB, and nothing auto-scales. Harden what matters most.",
    startingTopology: level5Start().build() satisfies TopologyDef,
    remediationBudget: 800,
    wave: {
      intensity: 250,
      packetRate: 14,
      duration: 14,
      composition: { writeRatio: 0.15, authRatio: 0.1, streamRatio: 0.15, largeRatio: 0.2, asyncRatio: 0.15 },
      keyDistribution: { kind: "zipf", alpha: 1.2, spaceSize: 260 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.5, bandwidth: 20 },
      zoneDistribution: new Map([
        ["zone_na", 0.4],
        ["zone_eu", 0.25],
        ["zone_ap", 0.35],
      ]),
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.7, maxAvgLatencySeconds: 2, maxDropRate: 0.3 },
    chaosSchedule: [
      { atSeconds: 4, kind: "crash_component", targetRole: "any_server" },
      { atSeconds: 7, kind: "sever_connection", targetRole: "any_connection_to_database" },
      { atSeconds: 10, kind: "crash_component", targetRole: "any_cache" },
    ],
  },
];
