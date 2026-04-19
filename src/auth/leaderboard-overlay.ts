import { fetchWaveLeaderboard, fetchCampaignLeaderboard, type LeaderboardRow } from "./leaderboard";
import { getUser } from "./auth-state";

const OVERLAY_ID = "sa-leaderboard-overlay";
const TOTAL_WAVES = 10;

const AVATAR_COLORS: Record<string, string> = {
  server: "#4A90D9",
  database: "#7B68EE",
  cache: "#F5A623",
  load_balancer: "#50C878",
  cdn: "#E74C8B",
  api_gateway: "#6366f1",
};

export function showLeaderboardOverlay(): void {
  if (document.getElementById(OVERLAY_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "sa-leaderboard-overlay";

  const tabs = ["Campaign", ...Array.from({ length: TOTAL_WAVES }, (_, i) => `Wave ${i + 1}`)];

  overlay.innerHTML = `
    <div class="sa-leaderboard-panel">
      <div class="sa-leaderboard-header">
        <h2>Leaderboard</h2>
        <button class="sa-leaderboard-close" id="sa-lb-close">&times;</button>
      </div>
      <div class="sa-leaderboard-tabs" id="sa-lb-tabs">
        ${tabs.map((t, i) => `<button class="sa-lb-tab ${i === 0 ? "active" : ""}" data-tab="${i}">${t}</button>`).join("")}
      </div>
      <div class="sa-leaderboard-body" id="sa-lb-body">
        <div class="sa-lb-loading">Loading...</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("sa-lb-close")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const tabContainer = document.getElementById("sa-lb-tabs")!;
  tabContainer.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".sa-lb-tab");
    if (!btn) return;
    tabContainer.querySelectorAll(".sa-lb-tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    const tabIdx = parseInt(btn.dataset.tab!, 10);
    loadTab(tabIdx);
  });

  loadTab(0);
}

async function loadTab(tabIdx: number): Promise<void> {
  const body = document.getElementById("sa-lb-body");
  if (!body) return;
  body.innerHTML = `<div class="sa-lb-loading">Loading...</div>`;

  const userId = getUser()?.id;

  if (tabIdx === 0) {
    const rows = await fetchCampaignLeaderboard();
    if (rows.length === 0) {
      body.innerHTML = `<div class="sa-lb-empty">No campaign scores yet. Complete all ${TOTAL_WAVES} waves to appear here.</div>`;
      return;
    }
    body.innerHTML = `
      <table class="sa-lb-table">
        <thead><tr><th>#</th><th>Player</th><th>Score</th><th>Waves</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="${r.user_id === userId ? "sa-lb-me" : ""}">
              <td>${i + 1}</td>
              <td class="sa-lb-player">
                <span class="sa-lb-avatar" style="background:${AVATAR_COLORS[r.avatar_key] ?? "#6366f1"}">&nbsp;</span>
                ${escapeHtml(r.display_name)}
              </td>
              <td>${r.total_score.toFixed(1)}</td>
              <td>${r.waves_completed}/${TOTAL_WAVES}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } else {
    const waveId = tabIdx;
    const rows: LeaderboardRow[] = await fetchWaveLeaderboard(waveId);
    if (rows.length === 0) {
      body.innerHTML = `<div class="sa-lb-empty">No scores for Wave ${waveId} yet.</div>`;
      return;
    }
    body.innerHTML = `
      <table class="sa-lb-table">
        <thead><tr><th>#</th><th>Player</th><th>Score</th><th>Avail%</th><th>Latency</th><th>Budget</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="${r.user_id === userId ? "sa-lb-me" : ""}">
              <td>${i + 1}</td>
              <td class="sa-lb-player">
                <span class="sa-lb-avatar" style="background:${AVATAR_COLORS[r.avatar_key] ?? "#6366f1"}">&nbsp;</span>
                ${escapeHtml(r.display_name)}
              </td>
              <td>${r.composite_score.toFixed(1)}</td>
              <td>${(r.availability * 100).toFixed(1)}%</td>
              <td>${r.avg_latency.toFixed(0)}ms</td>
              <td>$${r.final_budget}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }
}

function escapeHtml(s: string): string {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}
