const STORAGE_KEY = "physics-td-dossiers-seen";

export class ComponentDossierStore {
  private seen: Set<string>;

  constructor() {
    this.seen = new Set();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (typeof entry === "string") this.seen.add(entry);
          }
        }
      }
    } catch {
      // Corrupt JSON — start fresh; the next markSeen rewrites the slot.
    }
  }

  hasSeen(type: string): boolean {
    return this.seen.has(type);
  }

  markSeen(type: string): void {
    this.seen.add(type);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.seen)));
  }

  clear(): void {
    this.seen.clear();
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
