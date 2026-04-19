import { DIAGNOSE_LEVELS, type DiagnoseLevel } from "./diagnose-level";
import { PLACEHOLDER_DIAGNOSE_LEVEL } from "./placeholder-level";

/**
 * Parse ?level=<id> from a URL search string and return the matching
 * DiagnoseLevel, or null if not found. Pure; no DOM or auth side-effects,
 * so tests import this without pulling the whole boot graph.
 */
export function readDiagnoseLevelFromUrl(
  search: string,
  catalogue: ReadonlyArray<DiagnoseLevel> = DIAGNOSE_LEVELS,
): DiagnoseLevel | null {
  const raw = new URLSearchParams(search).get("level");
  if (raw === null) return null;
  const normalized = raw.toLowerCase();
  return catalogue.find((l) => l.id.toLowerCase() === normalized) ?? null;
}

/**
 * Priority:
 *   1) ?level=<id> if it matches a catalogue entry
 *   2) first catalogue entry
 *   3) placeholder (framework smoke test)
 */
export function resolveDiagnoseLevel(
  search: string,
  catalogue: ReadonlyArray<DiagnoseLevel> = DIAGNOSE_LEVELS,
): DiagnoseLevel {
  const fromUrl = readDiagnoseLevelFromUrl(search, catalogue);
  if (fromUrl) return fromUrl;
  if (catalogue.length > 0) return catalogue[0]!;
  return PLACEHOLDER_DIAGNOSE_LEVEL;
}
