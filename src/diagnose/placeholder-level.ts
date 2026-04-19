import type { ComponentId } from "@core/types/ids";
import { topology } from "../playtest/topology-builder";
import type { DiagnoseLevel } from "./diagnose-level";

const CLIENT_ID = "client" as ComponentId;

/**
 * Wiring-verification placeholder ONLY. Do not ship as a real level. Kept
 * in its own file so content work can evolve without touching it, and the
 * main catalogue (`DIAGNOSE_LEVELS`) stays empty until content lands.
 */
export const PLACEHOLDER_DIAGNOSE_LEVEL: DiagnoseLevel = {
  id: "__diagnose_placeholder__",
  title: "Placeholder — framework smoke test",
  briefing: "Internal only. Verifies end-to-end wiring of diagnose mode.",
  narrative: "Trivial 1 server + 1 db topology. Used to smoke-test the framework.",
  startingTopology: topology("__placeholder__")
    .add("server", "s1")
    .add("database", "db1")
    .entry("s1")
    .connect("s1", "db1")
    .build(),
  remediationBudget: 100,
  wave: {
    intensity: 5,
    packetRate: 1,
    duration: 5,
    composition: { writeRatio: 0.2, authRatio: 0, streamRatio: 0, largeRatio: 0, asyncRatio: 0 },
    keyDistribution: { kind: "uniform", spaceSize: 30 },
    revenue: { perRead: 1, perWrite: 1, perAuth: 0, perStream: 0, perAsync: 0 },
    entryClients: [CLIENT_ID],
  },
  sla: { availability: 0.9, maxAvgLatencySeconds: 2, maxDropRate: 0.1 },
};
