import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { ComponentId } from "@core/types/ids";
import { computeLoad, type BriefingDisplay } from "./briefing-text";

export type CampaignWave = {
  readonly id: string;
  readonly title: string;
  readonly briefing: string;       // shown in briefing panel (legacy)
  readonly narrative?: string;     // short prose hint about topology
  readonly wave: WaveDef;
  readonly sla: SLAThresholds;
  readonly startBudget: number;
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
    title: "Wave 1 — First Light",
    briefing: "10 reads/sec, no writes. Server is a forwarder — it needs a Database behind it. Place Server + Database, connect them, then connect the Client to your Server.",
    narrative: "First contact. Drop a Server, wire a Database behind it, and route the Client through the Server.",
    wave: {
      intensity: 10,
      packetRate: 1,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "uniform", spaceSize: 50 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
    startBudget: 300,
  },
  {
    id: "w2",
    title: "Wave 2 — Read/Write Mix",
    briefing: "20 req/sec with 30% writes. Writes need to reach the Database; reads can be served by the Server's response.",
    narrative: "Writes arrive. Wire a Database behind the Server so durable writes have a home.",
    wave: {
      intensity: 20,
      packetRate: 2,
      duration: 8,
      composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "uniform", spaceSize: 50 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
    startBudget: 400,
  },
  {
    id: "w3",
    title: "Wave 3 — DB Saturation",
    briefing: "30 reads/sec hot keys. Database alone will saturate. A Data Cache between Server and DB absorbs the hot-key traffic.",
    narrative: "Hot keys hammer the DB. Slot a Data Cache between Server and Database to absorb repeats.",
    wave: {
      intensity: 30,
      packetRate: 3,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
    startBudget: 250,
  },
  {
    id: "w4",
    title: "Wave 4 — Marketing Adds Images",
    briefing: "60 reads/sec with 40% large assets. CDN absorbs large traffic before it reaches Server. Add a CDN in front of your existing topology.",
    narrative: "Marketing pushes the launch banner. Plant a CDN in front of your stack so heavy assets never reach the Server.",
    wave: {
      intensity: 60,
      packetRate: 6,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0.4, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
    startBudget: 350,
  },
  {
    id: "w5",
    title: "Wave 5 — Auth Wall",
    briefing: "60 req/sec with 25% auth-required. Place an API Gateway in front to terminate auth before it touches the read path.",
    narrative: "Sign-ins flood the line. Plant an API Gateway up front to terminate auth before it reaches your read path.",
    wave: {
      intensity: 60,
      packetRate: 5,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0.25, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 2, perStream: 0, perAsync: 1 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.8, maxAvgLatencySeconds: 2, maxDropRate: 0.2 },
    startBudget: 350,
  },
];
