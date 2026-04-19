import { supabase } from "./supabase-client";
import { getUser, setProfile } from "./auth-state";
import type { Profile } from "./database.types";
import {
  AVATAR_KEYS,
  AVATAR_LABELS,
  attachRotateOnHover,
  avatarSpritePath,
} from "./avatar";

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

    modal.appendChild(card);
    document.body.appendChild(modal);

    saveBtn.addEventListener("click", async () => {
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
