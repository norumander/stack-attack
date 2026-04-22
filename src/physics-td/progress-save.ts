/**
 * Campaign progress save/restore via localStorage.
 *
 * Saves after each wave win. Restores on page load if saved progress
 * exists for this level. Cleared on viability death (campaign fail).
 */

import type { ComponentId } from "@core/types/ids";

export interface SavedTopologyComponent {
  type: string;
  label?: string;
  zone?: string;
  gridPos: { x: number; y: number };
}

export interface SavedConnection {
  fromIndex: number; // index into components array
  toIndex: number;
}

export interface CampaignSave {
  levelId: string;
  waveIndex: number; // the wave to resume at (0-based)
  budget: number;
  viability: number;
  components: SavedTopologyComponent[];
  connections: SavedConnection[];
}

function storageKey(levelId: string): string {
  return `stackattack:campaign:${levelId}`;
}

export function saveCampaignProgress(
  levelId: string,
  waveIndex: number,
  budget: number,
  viability: number,
  componentTypes: ReadonlyMap<ComponentId, string>,
  componentLabels: ReadonlyMap<ComponentId, string | undefined>,
  positions: ReadonlyMap<ComponentId, { x: number; y: number }>,
  sim: { components: ReadonlyMap<ComponentId, { zone: string | null }>; connections: ReadonlyMap<unknown, { from: { componentId: ComponentId }; to: { componentId: ComponentId }; direction: string }> },
  clientId: ComponentId,
): void {
  // Build ordered component list (excluding client).
  const compIds: ComponentId[] = [];
  const compList: SavedTopologyComponent[] = [];
  for (const [id, type] of componentTypes) {
    if ((id as unknown as string) === (clientId as unknown as string)) continue;
    compIds.push(id);
    const pos = positions.get(id) ?? { x: 0, y: 0 };
    const label = componentLabels.get(id);
    const zone = sim.components.get(id)?.zone ?? undefined;
    const entry: SavedTopologyComponent = { type, gridPos: pos };
    if (label !== undefined) entry.label = label;
    if (zone) entry.zone = zone;
    compList.push(entry);
  }

  // Build connection list using component indices.
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < compIds.length; i++) {
    idToIndex.set(compIds[i] as unknown as string, i);
  }

  const connList: SavedConnection[] = [];
  for (const conn of sim.connections.values()) {
    if (conn.direction !== "forward") continue;
    const fromStr = conn.from.componentId as unknown as string;
    const toStr = conn.to.componentId as unknown as string;
    // Skip client connections — they'll be re-created on restore.
    if (fromStr === (clientId as unknown as string)) continue;
    const fromIdx = idToIndex.get(fromStr);
    const toIdx = idToIndex.get(toStr);
    if (fromIdx !== undefined && toIdx !== undefined) {
      connList.push({ fromIndex: fromIdx, toIndex: toIdx });
    }
  }

  const save: CampaignSave = {
    levelId,
    waveIndex,
    budget,
    viability,
    components: compList,
    connections: connList,
  };

  localStorage.setItem(storageKey(levelId), JSON.stringify(save));
}

export function loadCampaignProgress(levelId: string): CampaignSave | null {
  const raw = localStorage.getItem(storageKey(levelId));
  if (!raw) return null;
  try {
    const save = JSON.parse(raw) as CampaignSave;
    if (!save.levelId || save.waveIndex === undefined || !Array.isArray(save.components)) {
      return null;
    }
    return save;
  } catch {
    return null;
  }
}

export function clearCampaignProgress(levelId: string): void {
  localStorage.removeItem(storageKey(levelId));
}
