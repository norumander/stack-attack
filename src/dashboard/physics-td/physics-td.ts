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
import { PlacementUX } from "./placement-ux";
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

  // Mutable refs let us define controller callbacks before placement/connect
  // UX exist (they need the controller). Tasks 5–6 set these refs.
  const refs: {
    placement: PlacementUX | null;
  } = { placement: null };

  const controller = new PhysicsCampaignController({
    waves: CAMPAIGN_WAVES.map((w) => ({ id: w.id, startBudget: w.startBudget })),
    componentCosts: COMPONENT_COSTS,
    callbacks: {
      onPlaced: (type, id, gridPos) => {
        refs.placement?.applyPlacement(type, id, gridPos);
      },
      onConnected: (sourceId, targetId, forwardId, backId) => {
        // Wired in Task 6
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

  // Placement UX
  refs.placement = new PlacementUX(sim, renderer, controller);

  // Wire palette buttons to placement mode.
  document.querySelectorAll<HTMLButtonElement>(".td-palette-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      if (type) refs.placement?.enterPlacingMode(type);
    });
  });

  // Initial paint
  hud.setWavePill(1, CAMPAIGN_WAVES.length);
  hud.setPhase("build");
  hud.setBudget(controller.budget);
  hud.setBriefing(CAMPAIGN_WAVES[0]!.title, CAMPAIGN_WAVES[0]!.briefing);
  hud.setStatus("Build phase — place components and click READY");
}

void main();
