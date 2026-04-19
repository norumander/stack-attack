/**
 * Netflix Diagnose arc — 5 levels.
 *
 * Companion to the Instagram arc (`./instagram-levels.ts`). Same 5-level
 * structure and level schema, but the system is Netflix-flavored:
 * personalization (recommendations), content delivery (CDN + Blob), VOD +
 * live streaming, global scale. Each level inherits the previous level's
 * *intended* fix topology.
 *
 * Arc:
 *   NL1 — Member Home Page. Profile DB has no cache → personalization
 *         saturates it. Fix: add a cache in front of Profile DB (or an
 *         Edge Cache in front of the LB).
 *   NL2 — Trending Title. CDN capacity too small / cold for a newly
 *         trending title → misses cascade to origin. Fix: add a second CDN
 *         (or expand content-blob backing).
 *   NL3 — Live Event. VOD streaming infra sized for lazy on-demand, not
 *         a live broadcast → the single Streaming Server saturates. Fix:
 *         add a second Streaming Server dedicated to live.
 *   NL4 — Asian Expansion. Everything in zone_na; APAC subscribers pay
 *         cross-zone latency. Fix: DNS/GTM + APAC replica stack.
 *   NL5 — The Squid Game Event. Only one CB, no AutoScale, single cache
 *         tier → chaos events during a global spike cascade. Harden what
 *         matters most.
 */

import type { ComponentId } from "@core/types/ids";
import { topology, type TopologyDef } from "../playtest/topology-builder";
import type { DiagnoseLevel } from "./diagnose-level";

const CLIENT_ID = "client" as ComponentId;

// ---------- Starting topologies ---------------------------------------------

/** NL1 starting topology: the inherited Netflix system with Profile DB
 *  lacking a cache. All in zone_na. */
function baseNetflix(): ReturnType<typeof topology> {
  return topology("netflix-1-start")
    .add("cdn", "cdn1", "CDN")
    .add("api_gateway", "ag1", "API Gateway")
    .add("load_balancer", "lb_api", "API LB")
    .add("server", "s1", "API Server 1")
    .add("server", "s2", "API Server 2")
    .add("server", "s3", "API Server 3")
    .add("data_cache", "c_rec", "Recs Cache")
    .add("database", "db_rec", "Recommendations DB")
    .add("database", "db_profile", "Profile DB")
    .add("queue", "q_watchhistory", "Watch History Queue")
    .add("worker", "w_watchhistory", "Watch History Worker")
    .add("streaming_server", "ss_vod", "VOD Streaming")
    .add("blob_storage", "bs_content", "Content Blob Store")
    .add("circuit_breaker", "cb_rec", "Recs Circuit Breaker")
    .entry("cdn1")
    .connect("cdn1", "ag1")
    .connect("ag1", "lb_api")
    .connect("lb_api", "s1")
    .connect("lb_api", "s2")
    .connect("lb_api", "s3")
    // Recommendations path: shared cache + CB + DB.
    .connect("s1", "c_rec")
    .connect("s2", "c_rec")
    .connect("s3", "c_rec")
    .connect("c_rec", "cb_rec")
    .connect("cb_rec", "db_rec")
    // Profile path: DIRECT to DB — NO CACHE. This is the L1 flaw.
    .connect("s1", "db_profile")
    .connect("s2", "db_profile")
    .connect("s3", "db_profile")
    // Async watch-history writes.
    .connect("ag1", "q_watchhistory")
    .connect("q_watchhistory", "w_watchhistory")
    .connect("w_watchhistory", "db_profile")
    // VOD streaming pipeline (present but light traffic at L1).
    .connect("ag1", "ss_vod")
    .connect("ss_vod", "bs_content");
}

/** NL2 starting topology: NL1 + Profile Cache (the expected NL1 fix).
 *  Flaw: CDN too small / cold for a newly trending title. */
function level2Start(): ReturnType<typeof topology> {
  return topology("netflix-2-start")
    .add("cdn", "cdn1", "CDN")
    .add("api_gateway", "ag1", "API Gateway")
    .add("load_balancer", "lb_api", "API LB")
    .add("server", "s1", "API Server 1")
    .add("server", "s2", "API Server 2")
    .add("server", "s3", "API Server 3")
    .add("data_cache", "c_rec", "Recs Cache")
    .add("data_cache", "c_profile", "Profile Cache")
    .add("database", "db_rec", "Recommendations DB")
    .add("database", "db_profile", "Profile DB")
    .add("queue", "q_watchhistory", "Watch History Queue")
    .add("worker", "w_watchhistory", "Watch History Worker")
    .add("streaming_server", "ss_vod", "VOD Streaming")
    .add("blob_storage", "bs_content", "Content Blob Store")
    .add("circuit_breaker", "cb_rec", "Recs Circuit Breaker")
    .entry("cdn1")
    .connect("cdn1", "ag1")
    .connect("ag1", "lb_api")
    .connect("lb_api", "s1")
    .connect("lb_api", "s2")
    .connect("lb_api", "s3")
    .connect("s1", "c_rec")
    .connect("s2", "c_rec")
    .connect("s3", "c_rec")
    .connect("c_rec", "cb_rec")
    .connect("cb_rec", "db_rec")
    // Profile path now via Profile Cache (the NL1 fix).
    .connect("s1", "c_profile")
    .connect("s2", "c_profile")
    .connect("s3", "c_profile")
    .connect("c_profile", "db_profile")
    .connect("ag1", "q_watchhistory")
    .connect("q_watchhistory", "w_watchhistory")
    .connect("w_watchhistory", "db_profile")
    .connect("ag1", "ss_vod")
    .connect("ss_vod", "bs_content");
}

/** NL3 starting topology: NL2 + second CDN (the NL2 fix). Flaw: single
 *  Streaming Server saturates under live-event traffic. */
function level3Start(): ReturnType<typeof topology> {
  return level2Start()
    // The NL2 fix: a second CDN tier sharing the Gateway egress.
    .add("cdn", "cdn2", "CDN Edge")
    .connect("cdn1", "cdn2")
    .connect("cdn2", "ag1");
}

/** NL4 starting topology: NL3 + second Streaming Server (the NL3 fix).
 *  All components tagged zone_na — this is the flaw. */
function level4Start(): ReturnType<typeof topology> {
  const t = topology("netflix-4-start")
    .add("cdn", "cdn1", "CDN")
    .add("cdn", "cdn2", "CDN Edge")
    .add("api_gateway", "ag1", "API Gateway")
    .add("load_balancer", "lb_api", "API LB")
    .add("server", "s1", "API Server 1")
    .add("server", "s2", "API Server 2")
    .add("server", "s3", "API Server 3")
    .add("data_cache", "c_rec", "Recs Cache")
    .add("data_cache", "c_profile", "Profile Cache")
    .add("database", "db_rec", "Recommendations DB")
    .add("database", "db_profile", "Profile DB")
    .add("queue", "q_watchhistory", "Watch History Queue")
    .add("worker", "w_watchhistory", "Watch History Worker")
    .add("streaming_server", "ss_vod", "VOD Streaming")
    .add("streaming_server", "ss_live", "Live Streaming")
    .add("blob_storage", "bs_content", "Content Blob Store")
    .add("circuit_breaker", "cb_rec", "Recs Circuit Breaker")
    .entry("cdn1")
    .connect("cdn1", "cdn2")
    .connect("cdn2", "ag1")
    .connect("cdn1", "ag1")
    .connect("ag1", "lb_api")
    .connect("lb_api", "s1")
    .connect("lb_api", "s2")
    .connect("lb_api", "s3")
    .connect("s1", "c_rec")
    .connect("s2", "c_rec")
    .connect("s3", "c_rec")
    .connect("c_rec", "cb_rec")
    .connect("cb_rec", "db_rec")
    .connect("s1", "c_profile")
    .connect("s2", "c_profile")
    .connect("s3", "c_profile")
    .connect("c_profile", "db_profile")
    .connect("ag1", "q_watchhistory")
    .connect("q_watchhistory", "w_watchhistory")
    .connect("w_watchhistory", "db_profile")
    .connect("ag1", "ss_vod")
    .connect("ag1", "ss_live")
    .connect("ss_vod", "bs_content")
    .connect("ss_live", "bs_content");

  for (const id of [
    "cdn1", "cdn2", "ag1", "lb_api", "s1", "s2", "s3",
    "c_rec", "c_profile", "db_rec", "db_profile",
    "q_watchhistory", "w_watchhistory",
    "ss_vod", "ss_live", "bs_content", "cb_rec",
  ]) {
    t.inZone(id, "zone_na");
  }
  return t;
}

/** NL5 starting topology: NL4 + DNS/GTM + APAC replica (the NL4 fix).
 *  Still missing: CBs on non-Recs paths, AutoScale, cache redundancy. */
function level5Start(): ReturnType<typeof topology> {
  const t = topology("netflix-5-start")
    // DNS/GTM in front of everything.
    .add("dns_gtm", "gtm", "DNS/GTM")
    // NA stack
    .add("cdn", "cdn1", "CDN NA")
    .add("cdn", "cdn2", "CDN Edge NA")
    .add("api_gateway", "ag1", "API Gateway NA")
    .add("load_balancer", "lb_api", "API LB NA")
    .add("server", "s1", "API Server 1")
    .add("server", "s2", "API Server 2")
    .add("server", "s3", "API Server 3")
    .add("data_cache", "c_rec", "Recs Cache NA")
    .add("data_cache", "c_profile", "Profile Cache NA")
    .add("database", "db_rec", "Recommendations DB NA")
    .add("database", "db_profile", "Profile DB NA")
    .add("queue", "q_watchhistory", "Watch History Queue")
    .add("worker", "w_watchhistory", "Watch History Worker")
    .add("streaming_server", "ss_vod", "VOD Streaming")
    .add("streaming_server", "ss_live", "Live Streaming")
    .add("blob_storage", "bs_content", "Content Blob Store")
    .add("circuit_breaker", "cb_rec", "Recs Circuit Breaker NA")
    // APAC stack (minimal: CDN + Server + Cache + DB + Streaming).
    .add("cdn", "cdn_ap", "CDN APAC")
    .add("server", "s_ap", "API Server APAC")
    .add("data_cache", "c_ap", "Recs Cache APAC")
    .add("database", "db_ap", "Recommendations DB APAC")
    .add("streaming_server", "ss_ap", "VOD Streaming APAC")
    .entry("gtm")
    // NA wiring
    .connect("gtm", "cdn1")
    .connect("cdn1", "cdn2")
    .connect("cdn2", "ag1")
    .connect("cdn1", "ag1")
    .connect("ag1", "lb_api")
    .connect("lb_api", "s1")
    .connect("lb_api", "s2")
    .connect("lb_api", "s3")
    .connect("s1", "c_rec")
    .connect("s2", "c_rec")
    .connect("s3", "c_rec")
    .connect("c_rec", "cb_rec")
    .connect("cb_rec", "db_rec")
    .connect("s1", "c_profile")
    .connect("s2", "c_profile")
    .connect("s3", "c_profile")
    .connect("c_profile", "db_profile")
    .connect("ag1", "q_watchhistory")
    .connect("q_watchhistory", "w_watchhistory")
    .connect("w_watchhistory", "db_profile")
    .connect("ag1", "ss_vod")
    .connect("ag1", "ss_live")
    .connect("ss_vod", "bs_content")
    .connect("ss_live", "bs_content")
    // APAC wiring
    .connect("gtm", "cdn_ap")
    .connect("cdn_ap", "s_ap")
    .connect("s_ap", "c_ap")
    .connect("c_ap", "db_ap")
    .connect("cdn_ap", "ss_ap")
    .connect("ss_ap", "bs_content");

  // Zone assignments.
  for (const id of [
    "gtm", "cdn1", "cdn2", "ag1", "lb_api", "s1", "s2", "s3",
    "c_rec", "c_profile", "db_rec", "db_profile",
    "q_watchhistory", "w_watchhistory",
    "ss_vod", "ss_live", "bs_content", "cb_rec",
  ]) {
    t.inZone(id, "zone_na");
  }
  for (const id of ["cdn_ap", "s_ap", "c_ap", "db_ap", "ss_ap"]) {
    t.inZone(id, "zone_ap");
  }
  return t;
}

// ---------- The 5 levels ----------------------------------------------------

export const NETFLIX_LEVELS: ReadonlyArray<DiagnoseLevel> = [
  {
    id: "netflix-1",
    title: "Netflix L1 — Member Home Page",
    briefing:
      "Netflix members loading their personalized home page. Millions of concurrent sessions. One database is drowning.",
    narrative:
      "Profile reads concentrate on a single Profile DB with no cache in front. Either put a cache between Servers and the DB, or add an Edge Cache in front of the LB to absorb repeated api_reads.",
    startingTopology: baseNetflix().build() satisfies TopologyDef,
    remediationBudget: 400,
    wave: {
      intensity: 110,
      packetRate: 10,
      duration: 12,
      composition: { writeRatio: 0.1, authRatio: 0.15, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.3, spaceSize: 200 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
  },
  {
    id: "netflix-2",
    title: "Netflix L2 — Trending Title",
    briefing:
      "A new series just dropped and it's trending. Your CDN has never seen this content before. Every miss slams your origin.",
    narrative:
      "Large artwork + trailer assets with a cold CDN cascade misses back to the origin. A second CDN tier absorbs the edge load.",
    startingTopology: level2Start().build() satisfies TopologyDef,
    remediationBudget: 500,
    wave: {
      intensity: 130,
      packetRate: 12,
      duration: 12,
      composition: { writeRatio: 0.1, authRatio: 0.2, streamRatio: 0.1, largeRatio: 0.2, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 180 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.2, bandwidth: 15 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.83, maxAvgLatencySeconds: 2, maxDropRate: 0.17 },
  },
  {
    id: "netflix-3",
    title: "Netflix L3 — Live Event",
    briefing:
      "Live-streamed boxing match starts in 60 seconds. Your streaming pipeline was sized for lazy VOD traffic.",
    narrative:
      "30% of the wave is live stream_data into a single Streaming Server. Add a second Streaming Server (dedicated to live) to parallelize the stream termination.",
    startingTopology: level3Start().build() satisfies TopologyDef,
    remediationBudget: 600,
    wave: {
      intensity: 150,
      packetRate: 12,
      duration: 14,
      composition: { writeRatio: 0.1, authRatio: 0.2, streamRatio: 0.3, largeRatio: 0.2, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 200 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.5, bandwidth: 25 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.8, maxAvgLatencySeconds: 2, maxDropRate: 0.2 },
  },
  {
    id: "netflix-4",
    title: "Netflix L4 — Asian Expansion",
    briefing:
      "Netflix launched in Singapore. 150 million potential subscribers 12,000 miles from your US servers. Speed of light is a hard limit.",
    narrative:
      "40% NA, 25% EU, 35% AP — but every component lives in zone_na. Stand up a replica stack in zone_ap and route with DNS/GTM.",
    startingTopology: level4Start().build() satisfies TopologyDef,
    remediationBudget: 1500,
    wave: {
      intensity: 180,
      packetRate: 12,
      duration: 14,
      composition: { writeRatio: 0.1, authRatio: 0.15, streamRatio: 0.3, largeRatio: 0.25, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 220 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.5, bandwidth: 25 },
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
    id: "netflix-5",
    title: "Netflix L5 — The Squid Game Event",
    briefing:
      "Squid Game just dropped globally. Concurrent viewers 10x normal. Infrastructure under chaos. The next 15 seconds determine whether Netflix survives the night.",
    narrative:
      "Four chaos events, a loose SLA — but only the Recs path has a CB, nothing auto-scales, and losing the single Recs Cache goes dark on personalization. Harden what matters most.",
    startingTopology: level5Start().build() satisfies TopologyDef,
    remediationBudget: 1000,
    wave: {
      intensity: 280,
      packetRate: 14,
      duration: 15,
      composition: { writeRatio: 0.1, authRatio: 0.15, streamRatio: 0.25, largeRatio: 0.2, asyncRatio: 0.1 },
      keyDistribution: { kind: "zipf", alpha: 1.2, spaceSize: 260 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.5, bandwidth: 25 },
      zoneDistribution: new Map([
        ["zone_na", 0.4],
        ["zone_eu", 0.25],
        ["zone_ap", 0.35],
      ]),
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.72, maxAvgLatencySeconds: 2, maxDropRate: 0.28 },
    chaosSchedule: [
      { atSeconds: 3, kind: "crash_component", targetRole: "any_server" },
      { atSeconds: 6, kind: "sever_connection", targetRole: "any_connection_to_database" },
      { atSeconds: 10, kind: "crash_component", targetRole: "any_cache" },
      { atSeconds: 12, kind: "crash_component", targetRole: "any_server" },
    ],
  },
];
