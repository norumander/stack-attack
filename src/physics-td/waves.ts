import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { ComponentId } from "@core/types/ids";
import { computeLoad, type BriefingDisplay } from "./briefing-text";
import type { ChaosEvent } from "./chaos";

export type CampaignWave = {
  readonly id: string;
  readonly title: string;
  readonly briefing: string;       // shown in briefing panel (legacy)
  readonly narrative?: string;     // short prose hint about topology
  readonly wave: WaveDef;
  readonly sla: SLAThresholds;
  readonly startBudget: number;
  /**
   * Optional campaign-level chaos schedule. Fired by the campaign controller
   * at elapsed wave time — the sim itself knows nothing about "chaos".
   */
  readonly chaosSchedule?: ReadonlyArray<ChaosEvent>;
};

/**
 * Build a structured BriefingDisplay for the cyberpunk HUD's briefing panel
 * from a CampaignWave. Derives load (intensity bucket), traffic mix string,
 * objective (duration + availability), and reward-per-request summary.
 */
export function computeBriefingForCampaignWave(w: CampaignWave): BriefingDisplay {
  const base: BriefingDisplay = {
    title: w.title.toUpperCase(),
    load: computeLoad(w.wave.intensity),
    traffic: describeWaveTraffic(w.wave),
    objective: `Hold ${w.wave.duration}s — availability >= ${(w.sla.availability * 100).toFixed(0)}%`,
    reward: describeWaveReward(w.wave),
  };
  return w.narrative ? { ...base, narrative: w.narrative } : base;
}

function describeWaveTraffic(wave: WaveDef): string {
  const c = wave.composition;
  const parts: string[] = [];
  if (c.authRatio > 0) parts.push(`${pct(c.authRatio)} auth`);
  if (c.writeRatio > 0) parts.push(`${pct(c.writeRatio)} writes`);
  if (c.streamRatio > 0) parts.push(`${pct(c.streamRatio)} streams`);
  const readRatio = 1 - c.writeRatio - c.authRatio - c.streamRatio;
  if (readRatio > 0.99) return "Reads only";
  if (parts.length === 0) return "Mixed traffic";
  return `Reads + ${parts.join(", ")}`;
}

function describeWaveReward(wave: WaveDef): string {
  const r = wave.revenue;
  const bits: string[] = [];
  if (r.perRead > 0) bits.push(`$${r.perRead}/read`);
  if (r.perWrite > 0) bits.push(`$${r.perWrite}/write`);
  if (r.perAuth > 0) bits.push(`$${r.perAuth}/auth`);
  if (r.perStream > 0) bits.push(`$${r.perStream}/stream`);
  return bits.length > 0 ? bits.join(" · ") : "No reward";
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

const CLIENT_ID = "client" as ComponentId;

export const CAMPAIGN_WAVES: ReadonlyArray<CampaignWave> = [
  {
    id: "w1",
    title: "Wave 1 — Launch Day",
    briefing: "Netflix streaming goes live. ~15 req/sec of profile reads and watchlist writes. Stand up Client → Server → Database so every request has somewhere to land and writes have a home.",
    narrative: "Launch day. Wire a Server with a Database behind it and route the Client through the Server — the classic request/response + persistence loop.",
    wave: {
      intensity: 15,
      packetRate: 2,
      duration: 10,
      composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "uniform", spaceSize: 60 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
    startBudget: 400,
  },
  {
    id: "w2",
    title: "Wave 2 — Growth Spike",
    briefing: "Mainstream press coverage hits. ~60 req/sec — reads dominate and hot titles repeat. One Server's 30/sec capacity drowns under the sync load. Split load across a second Server with a Load Balancer, and share a Data Cache behind the Servers so hot titles skip the Database.",
    narrative: "The press discovers Netflix. Spread traffic with a Load Balancer onto a second Server, and share a backend Data Cache so hot titles skip the DB — classic scale-out with a Redis-style cache.",
    wave: {
      intensity: 60,
      packetRate: 6,
      duration: 10,
      composition: { writeRatio: 0.25, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 120 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.88, maxAvgLatencySeconds: 2, maxDropRate: 0.12 },
    startBudget: 500,
  },
  {
    id: "w3",
    title: "Wave 3 — Going Mainstream",
    briefing: "~100 req/sec with 65% marketing images and 15% sign-in traffic. Large payloads and auth handshakes would crush your Servers at this scale. Put a CDN at the edge to absorb the image flood and an API Gateway to terminate auth before traffic ever reaches the read path.",
    narrative: "Marketing banners and sign-in waves pile up — over half of traffic is now heavy assets. A CDN offloads the image flood at the edge and an API Gateway terminates auth before the Servers ever see it.",
    wave: {
      intensity: 100,
      packetRate: 10,
      duration: 12,
      composition: { writeRatio: 0.1, authRatio: 0.15, streamRatio: 0, largeRatio: 0.65, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 140 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.91, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
    startBudget: 550,
  },
  {
    id: "w4",
    title: "Wave 4 — Async Operations",
    briefing: "~90 req/sec as recommendations and thumbnail pipelines kick in — 20% async work. Synchronous handling stalls the read path. Drop a Queue in front of a Worker so async jobs drain off the hot path.",
    narrative: "Recs and thumbnails backfill around the clock. A Queue buffers the surge, a Worker drains it in the background, and the sync read path stays fast.",
    wave: {
      intensity: 90,
      packetRate: 10,
      duration: 12,
      composition: { writeRatio: 0.15, authRatio: 0.15, streamRatio: 0, largeRatio: 0.2, asyncRatio: 0.2 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 160 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 0, perAsync: 3 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.82, maxAvgLatencySeconds: 2, maxDropRate: 0.18 },
    startBudget: 450,
  },
  {
    id: "w5",
    title: "Wave 5 — Things Break",
    briefing: "~75 req/sec with chaos: servers crash mid-wave and a DB edge gets severed. A Circuit Breaker in front of the server cluster isolates a failing fan-out, and an extra redundant Server means one crashed node doesn't take out your availability SLO.",
    narrative: "Failure is a design parameter, not an exception. A Circuit Breaker absorbs cascades and a third Server carries the load when any one node dies.",
    wave: {
      intensity: 75,
      packetRate: 10,
      duration: 13,
      composition: { writeRatio: 0.15, authRatio: 0.15, streamRatio: 0, largeRatio: 0.2, asyncRatio: 0.2 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 160 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 0, perAsync: 3 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.7, maxAvgLatencySeconds: 2, maxDropRate: 0.3 },
    startBudget: 400,
    chaosSchedule: [
      { atSeconds: 3, kind: "crash_component", targetRole: "any_server" },
      { atSeconds: 6, kind: "sever_connection", targetRole: "any_connection_to_database" },
      { atSeconds: 9, kind: "crash_component", targetRole: "any_server" },
    ],
  },
  {
    id: "w6",
    title: "Wave 6 — Video Launch",
    briefing: "~105 req/sec — 25% streams, 35% large. Streaming traffic is a different animal: persistent bandwidth reservations, not request/response. Add a Streaming Server as a dedicated client-facing entry and a Blob Storage tier so large assets and streams stop hammering your Servers.",
    narrative: "Video launch means streams saturate the API path if you let them. A dedicated Streaming Server terminates streams at the edge; Blob Storage absorbs large-payload reads behind it.",
    wave: {
      intensity: 105,
      packetRate: 10,
      duration: 12,
      composition: { writeRatio: 0.1, authRatio: 0.1, streamRatio: 0.25, largeRatio: 0.35, asyncRatio: 0.1 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 180 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.5, bandwidth: 20 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.78, maxAvgLatencySeconds: 2, maxDropRate: 0.25 },
    startBudget: 550,
  },
  {
    id: "w7",
    title: "Wave 7 — Going Global",
    briefing: "~130 req/sec spread across NA / EU / AP. Cross-zone hops pay a latency tax — users in AP suffer if every request flies to NA. Stand up DNS/GTM to route each zone's traffic to a replicated backend stack in that zone.",
    narrative: "Speed of light is real. Replicate the backend close to each user and route with DNS/GTM so zone-local traffic never leaves its region.",
    wave: {
      intensity: 130,
      packetRate: 10,
      duration: 14,
      composition: { writeRatio: 0.2, authRatio: 0.15, streamRatio: 0.15, largeRatio: 0.25, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 200 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.5, bandwidth: 20 },
      zoneDistribution: new Map([
        ["zone_na", 0.4],
        ["zone_eu", 0.35],
        ["zone_ap", 0.25],
      ]),
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.82, maxAvgLatencySeconds: 1.5, maxDropRate: 0.2 },
    startBudget: 2000,
  },
  {
    id: "w8",
    title: "Wave 8 — Viral Moment",
    briefing: "~270 req/sec slam the platform mid-crash. Static capacity collapses. Enable AutoScale on Servers and Databases — tiers bump under sustained load — and ride out the spike.",
    narrative: "Going viral at internet scale. Infrastructure must be elastic: AutoScale on Servers and DBs auto-bumps capacity tiers as utilization pins 80%+.",
    wave: {
      intensity: 160,
      packetRate: 12,
      duration: 15,
      composition: { writeRatio: 0.15, authRatio: 0.1, streamRatio: 0.2, largeRatio: 0.3, asyncRatio: 0.1 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 240 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 3, perAsync: 3 },
      streamConfig: { duration: 1.5, bandwidth: 20 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.5, maxAvgLatencySeconds: 2, maxDropRate: 0.5 },
    startBudget: 400,
    chaosSchedule: [
      { atSeconds: 4, kind: "crash_component", targetRole: "any_server" },
      { atSeconds: 10, kind: "crash_component", targetRole: "any_server" },
    ],
  },
];
