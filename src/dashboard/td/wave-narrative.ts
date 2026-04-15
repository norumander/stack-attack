export const WAVE_NARRATIVES: Readonly<Record<number, string>> = {
  1: "Your service just went live. A trickle of users is knocking.",
};

export function getNarrative(waveId: number): string | undefined {
  return WAVE_NARRATIVES[waveId];
}
