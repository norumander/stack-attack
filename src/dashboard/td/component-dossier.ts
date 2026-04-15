const STORAGE_KEY = "td-dossiers-seen";

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
      // Corrupt state — start fresh; the next markSeen rewrites it.
    }
  }

  hasSeen(type: string): boolean {
    return this.seen.has(type);
  }

  markSeen(type: string): void {
    this.seen.add(type);
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(this.seen)),
    );
  }

  clear(): void {
    this.seen.clear();
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export interface ComponentDossier {
  readonly title: string;
  readonly body: string;
  readonly wire: string;
  readonly handles: string;
  readonly tip?: string;
}

export const DOSSIERS: Readonly<Record<string, ComponentDossier>> = {
  server: {
    title: "SERVER",
    body:
      "Servers are the workhorses of your stack. They take a request from a user, do the work, and send a response back.",
    wire: "Client → Server → Database",
    handles: "Read requests (and writes, if forwarded to a Database)",
    tip: "You always need at least one. Without a Server in the read path, your users have nowhere to go.",
  },
  database: {
    title: "DATABASE",
    body:
      "Databases store your data. They accept writes from Servers and hold onto them for later reads. Databases don't answer user requests directly — they sit behind a Server.",
    wire: "Server → Database",
    handles: "Write requests forwarded from a Server",
    tip: "A Database alone can't serve users — it needs a Server in front of it to route reads.",
  },
  // Roadmap: cache, load_balancer, cdn, api_gateway, queue, worker,
  // circuit_breaker, dns_gtm, streaming_server, blob_storage. Slice C.
};
