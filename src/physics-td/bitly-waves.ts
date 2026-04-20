import type { ComponentId } from "@core/types/ids";
import type { CampaignWave } from "./waves";

const CLIENT_ID = "client" as ComponentId;

/**
 * bit.ly-style URL shortener campaign — 4 waves.
 *
 * Teaching arc: reads dominate catastrophically (95%+) and are trivially
 * cacheable (redirect lookups are immutable). Edge Cache is the star
 * component. Wave 2 is where it earns its keep.
 *
 * Waves: Launch → Reddit Front Page (hot zipf) → Analytics Pipeline
 * (async fan-out) → Global Viral (multi-zone).
 *
 * Intentionally omitted vs Netflix: CircuitBreaker (no chaos events),
 * Blob Storage (no streams), AutoScale (shorter campaign).
 */
export const BITLY_WAVES: ReadonlyArray<CampaignWave> = [
  {
    id: "bw1",
    title: "Wave 1 — Hello World",
    briefing:
      "Launch day for your new URL shortener. A couple dozen redirects per second. Get the basic stack running: Client → Server → Database so every short code has somewhere to resolve.",
    narrative:
      "It's launch day. 20 redirects/second — modest. Place a Server, drop a Database behind it, and wire the Client through. Classic request-response.",
    wave: {
      intensity: 20,
      packetRate: 2,
      duration: 10,
      composition: { writeRatio: 0.1, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "uniform", spaceSize: 60 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
    startBudget: 400,
  },
  {
    id: "bw2",
    title: "Wave 2 — Reddit Front Page",
    briefing:
      "One of your short URLs just hit the front page of Reddit. Thousands of requests per second for ONE redirect. If every request hits your app tier, you're done. Put an Edge Cache in front — redirects are immutable, cache hit rate approaches 100%.",
    narrative:
      "Viral storm, one link dominating. Edge Cache absorbs the hot read before it reaches the Server. Keep a backend Data Cache for tail reads and a Database for writes.",
    wave: {
      intensity: 120,
      packetRate: 15,
      duration: 12,
      composition: { writeRatio: 0.05, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.5, spaceSize: 200 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 1 },
      rampSeconds: 2,
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.88, maxAvgLatencySeconds: 2, maxDropRate: 0.12 },
    startBudget: 500,
  },
  {
    id: "bw3",
    title: "Wave 3 — Analytics Pipeline",
    briefing:
      "Product wants click analytics on every redirect. Can't block the redirect waiting on a database write — queue it up and let a Worker drain it in the background.",
    narrative:
      "20% async click-tracking now. Drop a Queue + Worker behind the read path so analytics writes drain off the hot redirect path.",
    wave: {
      intensity: 150,
      packetRate: 10,
      duration: 12,
      composition: { writeRatio: 0.05, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0.2 },
      keyDistribution: { kind: "zipf", alpha: 1.3, spaceSize: 200 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 3 },
      rampSeconds: 2,
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
    startBudget: 450,
  },
  {
    id: "bw4",
    title: "Wave 4 — Global Viral",
    briefing:
      "Your viral link is being shared globally. Users in Singapore are getting 800ms redirects from US servers. Time to go global — replicate the stack per zone and route with DNS/GTM.",
    narrative:
      "Traffic now spreads NA/EU/AP. Stand up DNS/GTM at the edge and replicate backend stacks per zone so each user hits a local server.",
    wave: {
      intensity: 200,
      packetRate: 12,
      duration: 14,
      composition: { writeRatio: 0.05, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0.15 },
      keyDistribution: { kind: "zipf", alpha: 1.3, spaceSize: 240 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 3 },
      rampSeconds: 2,
      zoneDistribution: new Map([
        ["zone_na", 0.4],
        ["zone_eu", 0.3],
        ["zone_ap", 0.3],
      ]),
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.82, maxAvgLatencySeconds: 1.5, maxDropRate: 0.18 },
    startBudget: 1550,
  },
];
