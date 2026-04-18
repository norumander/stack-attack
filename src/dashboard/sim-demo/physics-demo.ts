import { CyberpunkTopologyRenderer } from "@dashboard/render/cyberpunk-topology-renderer";
import type { SimClient } from "@sim/client";
import { buildWave3CacheRescue } from "./topology-builder";
import { SimToRendererAdapter } from "./sim-to-renderer";
import { BrowserDriver } from "./browser-driver";

async function main(): Promise<void> {
  const host = document.getElementById("canvas-host");
  if (!host) throw new Error("canvas-host missing");

  const { sim, positions } = buildWave3CacheRescue(7);
  const renderer = new CyberpunkTopologyRenderer();
  await renderer.mount(host);
  renderer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () => renderer.resize(window.innerWidth, window.innerHeight));

  for (const [id, comp] of sim.components.entries()) {
    const pos = positions.get(id);
    if (!pos) continue;
    const type = comp.capabilities[0]?.id ?? "client";
    renderer.addComponent(id, { type: normalizeType(type), displayName: String(id), gridPosition: pos });
  }
  for (const [id, conn] of sim.connections.entries()) {
    renderer.addConnection(id, conn.from.componentId, conn.to.componentId, { direction: conn.direction });
  }

  const adapter = new SimToRendererAdapter(sim, renderer, positions);
  const driver = new BrowserDriver(sim, { stepSeconds: 1 / 60 });

  const statSimTime = document.getElementById("stat-sim-time")!;
  const statActive = document.getElementById("stat-active")!;
  const statSnake = document.getElementById("stat-snake")!;
  const statResponded = document.getElementById("stat-responded")!;
  const statDrops = document.getElementById("stat-drops")!;
  const statRevenue = document.getElementById("stat-revenue")!;
  let responded = 0;
  let drops = 0;
  let revenue = 0;

  let lastTime = performance.now();
  function frame(now: number): void {
    const delta = now - lastTime;
    lastTime = now;
    driver.tick(delta);
    for (const ev of sim.lastStepEvents) {
      if (ev.kind === "drop") {
        drops += ev.count;
      } else if (ev.kind === "respond-delivered" || ev.kind === "terminate") {
        responded += 1;
        revenue += ev.revenue;
      }
    }
    adapter.syncFrame();
    statSimTime.textContent = sim.simTime.toFixed(1);
    statActive.textContent = String(sim.activePackets.length);
    const client: SimClient | undefined = sim.clients.values().next().value;
    statSnake.textContent = String(client?.snake.length ?? 0);
    statResponded.textContent = String(responded);
    statDrops.textContent = String(drops);
    statRevenue.textContent = String(revenue);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function normalizeType(capId: string): string {
  if (capId === "forwarding") return "server";
  if (capId === "caching") return "data_cache";
  if (capId === "processing") return "database";
  return "client";
}

void main();
