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
  yFirst?: boolean; // wire L-routing (true = Y-first, false = X-first)
}

export interface CampaignSave {
  levelId: string;
  waveIndex: number; // the wave to resume at (0-based)
  budget: number;
  viability: number;
  components: SavedTopologyComponent[];
  connections: SavedConnection[];
  clientPos?: { x: number; y: number };
  /** Index into components array that the client connects to, or -1 if none. */
  clientEntryIndex?: number;
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
  sim: { components: ReadonlyMap<ComponentId, { zone: string | null }>; connections: ReadonlyMap<unknown, { from: { componentId: ComponentId }; to: { componentId: ComponentId }; direction: string; id: unknown }> },
  clientId: ComponentId,
  getConnectionYFirst?: (connId: unknown) => boolean | undefined,
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
  let clientEntryIndex = -1;
  for (const conn of sim.connections.values()) {
    if (conn.direction !== "forward") continue;
    const fromStr = conn.from.componentId as unknown as string;
    const toStr = conn.to.componentId as unknown as string;
    if (fromStr === (clientId as unknown as string)) {
      // Save which component the client connects to.
      const toIdx = idToIndex.get(toStr);
      if (toIdx !== undefined) clientEntryIndex = toIdx;
      continue;
    }
    const fromIdx = idToIndex.get(fromStr);
    const toIdx = idToIndex.get(toStr);
    if (fromIdx !== undefined && toIdx !== undefined) {
      const entry: SavedConnection = { fromIndex: fromIdx, toIndex: toIdx };
      if (getConnectionYFirst) {
        const yf = getConnectionYFirst(conn.id);
        if (yf !== undefined) entry.yFirst = yf;
      }
      connList.push(entry);
    }
  }

  const clientPos = positions.get(clientId) ?? { x: -3, y: 0 };

  const save: CampaignSave = {
    levelId,
    waveIndex,
    budget,
    viability,
    components: compList,
    connections: connList,
    clientPos,
    clientEntryIndex,
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
