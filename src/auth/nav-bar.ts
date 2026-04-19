import { getProfile, signOut, onAuthChange } from "./auth-state";
import { avatarSpritePath } from "./avatar";

export function injectNavBar(): void {
  const profile = getProfile();
  if (!profile) return;

  const nav = document.createElement("div");
  nav.id = "sa-nav-bar";
  nav.className = "sa-nav-bar";

  nav.innerHTML = `
    <button id="sa-leaderboard-btn" class="sa-nav-btn sa-leaderboard-btn">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="8" width="4" height="7" rx="0.5"/>
        <rect x="6" y="3" width="4" height="12" rx="0.5"/>
        <rect x="11" y="6" width="4" height="9" rx="0.5"/>
      </svg>
      Leaderboard
    </button>
    <div class="sa-user-menu" id="sa-user-menu">
      <button class="sa-user-menu-trigger" id="sa-user-menu-trigger">
        <span class="sa-user-avatar">
          <img src="${avatarSpritePath(profile.avatar_key, "south")}" alt="" />
        </span>
        <span class="sa-user-name">${escapeHtml(profile.display_name)}</span>
      </button>
      <div class="sa-user-dropdown" id="sa-user-dropdown" hidden>
        <button class="sa-dropdown-item" id="sa-edit-profile">Edit Profile</button>
        <button class="sa-dropdown-item sa-dropdown-danger" id="sa-signout">Sign Out</button>
      </div>
    </div>
  `;

  document.body.prepend(nav);

  document.getElementById("sa-user-menu-trigger")!.addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = document.getElementById("sa-user-dropdown")!;
    dd.hidden = !dd.hidden;
  });

  document.addEventListener("click", () => {
    const dd = document.getElementById("sa-user-dropdown");
    if (dd) dd.hidden = true;
  });

  document.getElementById("sa-signout")!.addEventListener("click", () => {
    signOut();
  });

  document.getElementById("sa-edit-profile")!.addEventListener("click", async () => {
    const { showProfileSetup } = await import("./profile-setup");
    await showProfileSetup();
    updateNavProfile();
  });

  document.getElementById("sa-leaderboard-btn")!.addEventListener("click", async () => {
    const { showLeaderboardOverlay } = await import("./leaderboard-overlay");
    showLeaderboardOverlay();
  });

  onAuthChange((event) => {
    if (event.type === "profile_ready") {
      updateNavProfile();
    }
  });
}

function updateNavProfile(): void {
  const profile = getProfile();
  if (!profile) return;

  const avatarImg = document.querySelector(".sa-user-avatar img") as HTMLImageElement | null;
  const name = document.querySelector(".sa-user-name") as HTMLElement | null;
  if (avatarImg) {
    avatarImg.src = avatarSpritePath(profile.avatar_key, "south");
  }
  if (name) {
    name.textContent = profile.display_name;
  }
}

function escapeHtml(s: string): string {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}
