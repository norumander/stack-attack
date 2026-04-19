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
    startBudget: 300,
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
    startBudget: 425,
  },
  {
    id: "w3",
    title: "Wave 3 — Going Mainstream",
    briefing: "~80 req/sec with 30% marketing images and 20% sign-in traffic. Large payloads and auth handshakes must not reach your Servers. Put a CDN at the edge for assets and an API Gateway to terminate auth.",
    narrative: "Marketing banners and sign-in waves pile up. A CDN offloads heavy assets and an API Gateway terminates auth before the read path ever notices.",
    wave: {
      intensity: 80,
      packetRate: 8,
      duration: 11,
      composition: { writeRatio: 0.15, authRatio: 0.2, streamRatio: 0, largeRatio: 0.3, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 140 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
    startBudget: 500,
  },
  {
    id: "w4",
    title: "Wave 4 — Async Operations",
    briefing: "~100 req/sec as recommendations and thumbnail pipelines kick in — 20% async work. Synchronous handling stalls the read path. Drop a Queue in front of a Worker so async jobs drain off the hot path.",
    narrative: "Recs and thumbnails backfill around the clock. A Queue buffers the surge, a Worker drains it in the background, and the sync read path stays fast.",
    wave: {
      intensity: 100,
      packetRate: 10,
      duration: 12,
      composition: { writeRatio: 0.15, authRatio: 0.15, streamRatio: 0, largeRatio: 0.2, asyncRatio: 0.2 },
      keyDistribution: { kind: "zipf", alpha: 1.1, spaceSize: 160 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 2, perStream: 0, perAsync: 3 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.82, maxAvgLatencySeconds: 2, maxDropRate: 0.18 },
    startBudget: 400,
  },
];
