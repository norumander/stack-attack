import { supabase } from "./supabase-client";
import { getUser, setProfile } from "./auth-state";
import type { Profile } from "./database.types";
import {
  AVATAR_KEYS,
  AVATAR_LABELS,
  attachRotateOnHover,
  avatarSpritePath,
} from "./avatar";

/**
 * Race a promise against a timeout. We use this on Supabase calls because a
 * stale session or auto-refresh stall can make the client hang indefinitely
 * — surfacing a clear timeout error is much better than a spinning button.
 */
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export function showProfileSetup(): Promise<Profile> {
  return new Promise((resolve) => {
    const user = getUser();
    if (!user) throw new Error("showProfileSetup called without a signed-in user");

    const prefillName =
      (user.user_metadata?.full_name as string) ??
      (user.email?.split("@")[0] ?? "Commander");

    let selectedAvatar: string = AVATAR_KEYS[0];

    const modal = document.createElement("div");
    modal.className = "sa-profile-setup-overlay";

    const card = document.createElement("div");
    card.className = "sa-profile-card";

    const title = document.createElement("h2");
    title.className = "sa-profile-title";
    title.textContent = "Deploy Your Profile";
    card.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "sa-profile-subtitle";
    subtitle.textContent = "Choose your callsign and avatar";
    card.appendChild(subtitle);

    const nameLabel = document.createElement("label");
    nameLabel.className = "sa-profile-label";
    nameLabel.textContent = "Display Name";
    nameLabel.htmlFor = "sa-profile-name";
    card.appendChild(nameLabel);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.id = "sa-profile-name";
    nameInput.className = "sa-profile-input";
    nameInput.maxLength = 30;
    nameInput.value = prefillName;
    nameInput.placeholder = "Commander";
    card.appendChild(nameInput);

    const avatarLabel = document.createElement("label");
    avatarLabel.className = "sa-profile-label";
    avatarLabel.textContent = "Avatar";
    card.appendChild(avatarLabel);

    const grid = document.createElement("div");
    grid.className = "sa-avatar-grid";

    for (const key of AVATAR_KEYS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sa-avatar-btn";
      if (key === selectedAvatar) btn.classList.add("selected");
      btn.dataset.avatar = key;
      btn.setAttribute("aria-label", AVATAR_LABELS[key]);

      const sprite = document.createElement("img");
      sprite.className = "sa-avatar-sprite";
      sprite.src = avatarSpritePath(key, "south");
      sprite.alt = "";
      btn.appendChild(sprite);

      attachRotateOnHover(btn, sprite, key);

      btn.addEventListener("click", () => {
        grid.querySelectorAll(".sa-avatar-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedAvatar = key;
      });

      grid.appendChild(btn);
    }

    card.appendChild(grid);

    const saveBtn = document.createElement("button");
    saveBtn.id = "sa-profile-save";
    saveBtn.className = "sa-profile-save-btn";
    saveBtn.textContent = "DEPLOY PROFILE";
    card.appendChild(saveBtn);

    const errorEl = document.createElement("p");
    errorEl.className = "sa-profile-error";
    errorEl.hidden = true;
    card.appendChild(errorEl);

    modal.appendChild(card);
    document.body.appendChild(modal);

    saveBtn.addEventListener("click", async () => {
      const displayName = nameInput.value.trim() || "Commander";

      saveBtn.disabled = true;
      saveBtn.textContent = "SAVING…";
      errorEl.hidden = true;

      const profile: Profile = {
        id: user.id,
        display_name: displayName,
        avatar_key: selectedAvatar,
        created_at: new Date().toISOString(),
      };

      try {
        // Raw PostgREST upsert — supabase-js 2.x has been observed hanging
        // indefinitely on profile writes in this project (even with a fresh
        // session), while an equivalent raw fetch completes normally. Using
        // fetch gives us direct visibility into the HTTP status and body.
        const supaUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          5000,
          "getSession",
        );
        const token = session?.access_token ?? anonKey;

        const resp = await withTimeout(
          fetch(`${supaUrl}/rest/v1/profiles?on_conflict=id`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: anonKey,
              Authorization: `Bearer ${token}`,
              Prefer: "resolution=merge-duplicates,return=representation",
            },
            body: JSON.stringify({
              id: user.id,
              display_name: displayName,
              avatar_key: selectedAvatar,
            }),
          }),
          10000,
          "profile upsert",
        );

        if (!resp.ok) {
          const bodyText = await resp.text();
          console.error("[profile] upsert failed:", resp.status, bodyText);
          throw new Error(
            `HTTP ${resp.status}: ${bodyText.slice(0, 300)}`,
          );
        }
      } catch (err) {
        console.error("[profile] save failed:", err);
        errorEl.textContent =
          `Couldn't save profile: ${err instanceof Error ? err.message : String(err)}`;
        errorEl.hidden = false;
        saveBtn.disabled = false;
        saveBtn.textContent = "DEPLOY PROFILE";
        return;
      }

      setProfile(profile);
      modal.remove();
      resolve(profile);
    });
  });
}
