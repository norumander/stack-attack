/**
 * Campaign progress save/restore via localStorage + Supabase cloud sync.
 *
 * Saves to localStorage immediately (fast, works offline). If Supabase is
 * configured and a user is signed in, also upserts to the cloud table.
 * On load, checks cloud first (last write wins), falls back to local.
 */

import type { ComponentId } from "@core/types/ids";
import { supabase, isAuthConfigured } from "../auth/supabase-client";

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

// ── Cloud helpers ────────────────────────────────────────────────────

async function getAuthUserId(): Promise<string | null> {
  if (!isAuthConfigured) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function cloudSave(userId: string, save: CampaignSave): Promise<void> {
  try {
    await supabase.from("campaign_progress").upsert(
      {
        user_id: userId,
        level_id: save.levelId,
        wave_index: save.waveIndex,
        budget: save.budget,
        viability: save.viability,
        topology: {
          components: save.components,
          connections: save.connections,
          clientPos: save.clientPos,
          clientEntryIndex: save.clientEntryIndex,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,level_id" },
    );
  } catch (err) {
    console.warn("[progress-save] cloud save failed:", err);
  }
}

async function cloudLoad(userId: string, levelId: string): Promise<CampaignSave | null> {
  try {
    const { data } = await supabase
      .from("campaign_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("level_id", levelId)
      .single();
    if (!data) return null;
    const topo = data.topology as {
      components?: SavedTopologyComponent[];
      connections?: SavedConnection[];
      clientPos?: { x: number; y: number };
      clientEntryIndex?: number;
    };
    const result: CampaignSave = {
      levelId: data.level_id,
      waveIndex: data.wave_index,
      budget: data.budget,
      viability: data.viability ?? 100,
      components: topo.components ?? [],
      connections: topo.connections ?? [],
    };
    if (topo.clientPos) result.clientPos = topo.clientPos;
    if (topo.clientEntryIndex !== undefined) result.clientEntryIndex = topo.clientEntryIndex;
    return result;
  } catch {
    return null;
  }
}

async function cloudDelete(userId: string, levelId: string): Promise<void> {
  try {
    await supabase
      .from("campaign_progress")
      .delete()
      .eq("user_id", userId)
      .eq("level_id", levelId);
  } catch (err) {
    console.warn("[progress-save] cloud delete failed:", err);
  }
}

// ── Public API ───────────────────────────────────────────────────────

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

  // Save to localStorage immediately.
  localStorage.setItem(storageKey(levelId), JSON.stringify(save));

  // Fire-and-forget cloud save if authenticated.
  void getAuthUserId().then((userId) => {
    if (userId) void cloudSave(userId, save);
  });
}

/**
 * Load campaign progress. Checks cloud first (last write wins),
 * falls back to localStorage.
 */
export async function loadCampaignProgress(levelId: string): Promise<CampaignSave | null> {
  // Try cloud first if authenticated.
  const userId = await getAuthUserId();
  if (userId) {
    const cloudData = await cloudLoad(userId, levelId);
    if (cloudData) {
      // Sync to localStorage so offline access works.
      localStorage.setItem(storageKey(levelId), JSON.stringify(cloudData));
      return cloudData;
    }
  }

  // Fall back to localStorage.
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

/**
 * Synchronous localStorage-only load. Used in places that can't await
 * (e.g., death modal checking for wave-start save).
 */
export function loadCampaignProgressSync(levelId: string): CampaignSave | null {
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

  // Fire-and-forget cloud delete if authenticated.
  void getAuthUserId().then((userId) => {
    if (userId) void cloudDelete(userId, levelId);
  });
}
