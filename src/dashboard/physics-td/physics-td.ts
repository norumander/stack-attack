// Force cyberpunk HUD activation (depends on ?renderer=iso URL flag).
if (!new URLSearchParams(window.location.search).has("renderer")) {
  const url = new URL(window.location.href);
  url.searchParams.set("renderer", "iso");
  window.location.replace(url.toString());
}

import { activateCyberpunkHud } from "@dashboard/cyberpunk-hud";
import { CyberpunkTopologyRenderer } from "@dashboard/render/cyberpunk-topology-renderer";
import { Sim } from "@sim/sim";
import { PhysicsCampaignController } from "./campaign-controller";
import { COMPONENT_COSTS } from "./component-factory";
import { CAMPAIGN_WAVES } from "./waves";
import * as hud from "./hud-bridge";

async function main(): Promise<void> {
  activateCyberpunkHud();

  const host = document.getElementById("canvas-host");
  if (!host) throw new Error("canvas-host missing");

  const renderer = new CyberpunkTopologyRenderer();
  await renderer.mount(host);
  renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () =>
    renderer.resize(window.innerWidth, window.innerHeight),
  );

  // Sim placeholder — wave-driven Client + driver added on READY (Task 7).
  const sim = new Sim({ seed: 1 });

  const controller = new PhysicsCampaignController({
    waves: CAMPAIGN_WAVES.map((w) => ({ id: w.id, startBudget: w.startBudget })),
    componentCosts: COMPONENT_COSTS,
    callbacks: {
      onPlaced: (type, id, gridPos) => {
        // Wired in Task 5 — placement.applyPlacement
        console.log("[physics-td] onPlaced", type, id, gridPos);
      },
      onConnected: (sourceId, targetId, forwardId, backId) => {
        // Wired in Task 6 — connect.applyConnection
        console.log("[physics-td] onConnected", sourceId, targetId, forwardId, backId);
      },
      onPhaseChange: (phase, waveIndex) => {
        const wave = CAMPAIGN_WAVES[waveIndex];
        hud.setPhase(phase);
        hud.setWavePill(waveIndex + 1, CAMPAIGN_WAVES.length);
        if (phase === "build" && wave) {
          hud.setBriefing(wave.title, wave.briefing);
          hud.setStatus("Build phase — place components and click READY");
          hud.hideLossModal();
          hud.setReadyDisabled(false);
        } else if (phase === "simulate") {
          hud.setStatus("Wave running…");
          hud.setReadyDisabled(true);
        } else if (phase === "won") {
          hud.setStatus("Wave WON — advancing to next wave…");
          hud.setReadyDisabled(true);
        } else if (phase === "lost") {
          hud.setStatus("Wave LOST — SLA failed");
          hud.setReadyDisabled(true);
        } else if (phase === "campaign-complete") {
          hud.setStatus("Campaign complete — well played!");
          hud.setReadyDisabled(true);
        }
      },
      onBudgetChange: (b) => hud.setBudget(b),
    },
  });

  // Initial paint
  hud.setWavePill(1, CAMPAIGN_WAVES.length);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hud.setBriefing(CAMPAIGN_WAVES[0]!.title, CAMPAIGN_WAVES[0]!.briefing);
  hud.setStatus("Build phase — place components and click READY");

  // Keep references alive for subsequent tasks.
  void sim;
  void renderer;
  void controller;
}

void main();
