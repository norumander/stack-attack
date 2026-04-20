export const AVATAR_KEYS = ["engineer_male", "engineer_female"] as const;
export type AvatarKey = (typeof AVATAR_KEYS)[number];

export const AVATAR_LABELS: Record<AvatarKey, string> = {
  engineer_male: "Engineer",
  engineer_female: "Engineer",
};

/**
 * Clockwise rotation order used by the hover animation in the avatar picker.
 * Starts at south (front-facing) so the avatar returns to facing the player
 * when the animation wraps.
 */
export const ROTATION_ORDER = [
  "south",
  "south-east",
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
] as const;

// Explicitly register each engineer sprite via `new URL(..., import.meta.url)`
// so Vite rewrites them to the correct hashed URLs in production. A raw
// string path like "./assets/..." does NOT work: the browser resolves it
// against the current document URL at runtime (e.g. /game.html), which
// produces 404s on the deployed app because `src/assets` is never served as
// a static path. This mirrors the pattern used in `src/render/cyberpunk/*`.
const SPRITE_URLS: Record<"male" | "female", Record<string, string>> = {
  male: {
    south: new URL("../assets/stack-attack/engineers/male/south.png", import.meta.url).href,
    "south-east": new URL("../assets/stack-attack/engineers/male/south-east.png", import.meta.url).href,
    east: new URL("../assets/stack-attack/engineers/male/east.png", import.meta.url).href,
    "north-east": new URL("../assets/stack-attack/engineers/male/north-east.png", import.meta.url).href,
    north: new URL("../assets/stack-attack/engineers/male/north.png", import.meta.url).href,
    "north-west": new URL("../assets/stack-attack/engineers/male/north-west.png", import.meta.url).href,
    west: new URL("../assets/stack-attack/engineers/male/west.png", import.meta.url).href,
    "south-west": new URL("../assets/stack-attack/engineers/male/south-west.png", import.meta.url).href,
  },
  female: {
    south: new URL("../assets/stack-attack/engineers/female/south.png", import.meta.url).href,
    "south-east": new URL("../assets/stack-attack/engineers/female/south-east.png", import.meta.url).href,
    east: new URL("../assets/stack-attack/engineers/female/east.png", import.meta.url).href,
    "north-east": new URL("../assets/stack-attack/engineers/female/north-east.png", import.meta.url).href,
    north: new URL("../assets/stack-attack/engineers/female/north.png", import.meta.url).href,
    "north-west": new URL("../assets/stack-attack/engineers/female/north-west.png", import.meta.url).href,
    west: new URL("../assets/stack-attack/engineers/female/west.png", import.meta.url).href,
    "south-west": new URL("../assets/stack-attack/engineers/female/south-west.png", import.meta.url).href,
  },
};

function folderFor(key: string): "male" | "female" {
  return key === "engineer_female" ? "female" : "male";
}

/** Path to a specific rotation PNG for an avatar. Defaults to front-facing. */
export function avatarSpritePath(
  key: string,
  direction: (typeof ROTATION_ORDER)[number] = "south",
): string {
  const folder = folderFor(key);
  const url = SPRITE_URLS[folder][direction];
  return url ?? SPRITE_URLS.male.south!;
}

/**
 * Wire up a rotation-on-hover animation for an `<img>` that should cycle
 * through the 8 directions while the pointer is over `trigger`.
 *
 * Returns a detach function that cancels the animation and resets the image.
 */
export function attachRotateOnHover(
  trigger: HTMLElement,
  img: HTMLImageElement,
  avatarKey: string,
  stepMs = 120,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let index = 0;

  const start = (): void => {
    if (timer) return;
    timer = setInterval(() => {
      index = (index + 1) % ROTATION_ORDER.length;
      img.src = avatarSpritePath(avatarKey, ROTATION_ORDER[index]!);
    }, stepMs);
  };

  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    index = 0;
    img.src = avatarSpritePath(avatarKey, "south");
  };

  trigger.addEventListener("mouseenter", start);
  trigger.addEventListener("mouseleave", stop);
  trigger.addEventListener("focus", start);
  trigger.addEventListener("blur", stop);

  return () => {
    stop();
    trigger.removeEventListener("mouseenter", start);
    trigger.removeEventListener("mouseleave", stop);
    trigger.removeEventListener("focus", start);
    trigger.removeEventListener("blur", stop);
  };
}
