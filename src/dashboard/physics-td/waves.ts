// src/dashboard/physics-td/waves.ts
import type { WaveDef } from "@sim/wave";
import type { SLAThresholds } from "@sim/sla";
import type { ComponentId } from "@core/types/ids";

export type CampaignWave = {
  readonly id: string;
  readonly title: string;
  readonly briefing: string;       // shown in briefing panel
  readonly wave: WaveDef;
  readonly sla: SLAThresholds;
  readonly startBudget: number;
};

const CLIENT_ID = "client" as ComponentId;

export const CAMPAIGN_WAVES: ReadonlyArray<CampaignWave> = [
  {
    id: "w1",
    title: "Wave 1 — First Light",
    briefing: "10 reads/sec, no writes. A lone Server can handle this. Budget for one Server, one Database (optional).",
    wave: {
      intensity: 10,
      packetRate: 1,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "uniform", spaceSize: 50 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
    startBudget: 200,
  },
  {
    id: "w2",
    title: "Wave 2 — Read/Write Mix",
    briefing: "20 req/sec with 30% writes. Writes need to reach the Database; reads can be served by the Server's response.",
    wave: {
      intensity: 20,
      packetRate: 2,
      duration: 8,
      composition: { writeRatio: 0.3, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "uniform", spaceSize: 50 },
      revenue: { perRead: 1, perWrite: 2, perAuth: 0, perStream: 0 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.85, maxAvgLatencySeconds: 2, maxDropRate: 0.15 },
    startBudget: 400,
  },
  {
    id: "w3",
    title: "Wave 3 — DB Saturation",
    briefing: "30 reads/sec hot keys. Database alone will saturate. A Data Cache between Server and DB absorbs the hot-key traffic.",
    wave: {
      intensity: 30,
      packetRate: 3,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 0, perStream: 0 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
    startBudget: 250,
  },
  {
    id: "w5",
    title: "Wave 5 — Auth Wall",
    briefing: "60 req/sec with 25% auth-required. Place an API Gateway in front to terminate auth before it touches the read path.",
    wave: {
      intensity: 60,
      packetRate: 5,
      duration: 8,
      composition: { writeRatio: 0, authRatio: 0.25, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
      keyDistribution: { kind: "zipf", alpha: 1.07, spaceSize: 100 },
      revenue: { perRead: 1, perWrite: 0, perAuth: 2, perStream: 0 },
      entryClients: [CLIENT_ID],
    },
    sla: { availability: 0.8, maxAvgLatencySeconds: 2, maxDropRate: 0.2 },
    startBudget: 350,
  },
];
