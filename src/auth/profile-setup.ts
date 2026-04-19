import { supabase } from "./supabase-client";
import { getUser, setProfile } from "./auth-state";
import type { Profile } from "./database.types";

const AVATAR_KEYS = [
  "server",
  "database",
  "cache",
  "load_balancer",
  "cdn",
  "api_gateway",
] as const;

const AVATAR_LABELS: Record<string, string> = {
  server: "Server",
  database: "Database",
  cache: "Cache",
  load_balancer: "Load Balancer",
  cdn: "CDN",
  api_gateway: "API Gateway",
};

const AVATAR_COLORS: Record<string, string> = {
  server: "#4A90D9",
  database: "#7B68EE",
  cache: "#F5A623",
  load_balancer: "#50C878",
  cdn: "#E74C8B",
  api_gateway: "#6366f1",
};

const AVATAR_SHAPES: Record<string, string> = {
  server: `<rect x="6" y="4" width="28" height="32" rx="3" fill="currentColor"/>
           <rect x="12" y="10" width="16" height="4" rx="1" fill="#0f1117" opacity="0.6"/>
           <rect x="12" y="18" width="16" height="4" rx="1" fill="#0f1117" opacity="0.6"/>
           <circle cx="26" cy="30" r="2" fill="#22c55e"/>`,
  database: `<ellipse cx="20" cy="10" rx="14" ry="6" fill="currentColor"/>
             <path d="M6 10v18c0 3.3 6.3 6 14 6s14-2.7 14-6V10" fill="currentColor" opacity="0.8"/>
             <ellipse cx="20" cy="28" rx="14" ry="6" fill="currentColor" opacity="0.6"/>`,
  cache: `<path d="M20 2 L38 20 L20 38 L2 20 Z" fill="currentColor"/>
          <path d="M20 10 L30 20 L20 30 L10 20 Z" fill="#0f1117" opacity="0.3"/>`,
  load_balancer: `<polygon points="20,2 38,12 38,28 20,38 2,28 2,12" fill="currentColor"/>
                  <circle cx="20" cy="20" r="6" fill="#0f1117" opacity="0.3"/>`,
  cdn: `<circle cx="20" cy="20" r="16" fill="currentColor"/>
        <circle cx="20" cy="20" r="10" fill="currentColor" opacity="0.7" stroke="#0f1117" stroke-width="1"/>
        <circle cx="20" cy="20" r="4" fill="#0f1117" opacity="0.3"/>`,
  api_gateway: `<rect x="4" y="8" width="32" height="24" rx="4" fill="currentColor"/>
                <path d="M12 16 L20 24 L28 16" stroke="#0f1117" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
};

export function showProfileSetup(): Promise<Profile> {
  return new Promise((resolve) => {
    const user = getUser();
    if (!user) throw new Error("showProfileSetup called without a signed-in user");

    const prefillName =
      (user.user_metadata?.full_name as string) ??
      (user.email?.split("@")[0] ?? "Commander");

    let selectedAvatar = "server";

    const modal = document.createElement("div");
    modal.className = "sa-profile-setup-overlay";

    modal.innerHTML = `
      <div class="sa-profile-card">
        <h2 class="sa-profile-title">Deploy Your Profile</h2>
        <p class="sa-profile-subtitle">Choose your callsign and avatar</p>

        <label class="sa-profile-label">Display Name</label>
        <input
          type="text"
          id="sa-profile-name"
          class="sa-profile-input"
          maxlength="30"
          value="${escapeAttr(prefillName)}"
          placeholder="Commander"
        />

        <label class="sa-profile-label">Avatar</label>
        <div class="sa-avatar-grid" id="sa-avatar-grid">
          ${AVATAR_KEYS.map(
            (key) => `
            <button
              class="sa-avatar-btn ${key === selectedAvatar ? "selected" : ""}"
              data-avatar="${key}"
              title="${AVATAR_LABELS[key]}"
            >
              <svg viewBox="0 0 40 40" width="40" height="40" style="color:${AVATAR_COLORS[key]}">
                ${AVATAR_SHAPES[key]}
              </svg>
              <span class="sa-avatar-label">${AVATAR_LABELS[key]}</span>
            </button>
          `,
          ).join("")}
        </div>

        <button id="sa-profile-save" class="sa-profile-save-btn">DEPLOY PROFILE</button>
      </div>
    `;

    document.body.appendChild(modal);

    const grid = document.getElementById("sa-avatar-grid")!;
    grid.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".sa-avatar-btn");
      if (!btn) return;
      grid.querySelectorAll(".sa-avatar-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedAvatar = btn.dataset.avatar!;
    });

    document.getElementById("sa-profile-save")!.addEventListener("click", async () => {
      const nameInput = document.getElementById("sa-profile-name") as HTMLInputElement;
      const displayName = nameInput.value.trim() || "Commander";

      const profile: Profile = {
        id: user.id,
        display_name: displayName,
        avatar_key: selectedAvatar,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("profiles").insert({
        id: user.id,
        display_name: displayName,
        avatar_key: selectedAvatar,
      });

      if (error) {
        console.error("[profile] insert error:", error);
        await supabase
          .from("profiles")
          .update({ display_name: displayName, avatar_key: selectedAvatar })
          .eq("id", user.id);
      }

      setProfile(profile);
      modal.remove();
      resolve(profile);
    });
  });
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
