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

const BASE_PATH = "./assets/stack-attack/engineers";

function folderFor(key: string): string {
  return key === "engineer_female" ? "female" : "male";
}

/** Path to a specific rotation PNG for an avatar. Defaults to front-facing. */
export function avatarSpritePath(
  key: string,
  direction: (typeof ROTATION_ORDER)[number] = "south",
): string {
  return `${BASE_PATH}/${folderFor(key)}/${direction}.png`;
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
