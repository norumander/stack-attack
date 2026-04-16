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

/**
 * Renders a full-overlay dossier modal for the given component type.
 * Returns a Promise that resolves once the user dismisses the modal (CTA,
 * X button, or Escape). The caller is responsible for `markSeen(type)` after
 * the promise resolves — this keeps the store decoupled from the renderer.
 */
export function showDossier(type: string, rentPerWave: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const dossier = DOSSIERS[type];
    const titleText = dossier?.title ?? type.toUpperCase();

    const modal = document.createElement("div");
    modal.className = "cp-dossier-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", `${titleText} dossier`);

    const content = document.createElement("div");
    content.className = "cp-dossier-content cp-panel";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "cp-dossier-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close dossier");
    content.appendChild(close);

    const title = document.createElement("h2");
    title.className = "cp-dossier-title";
    title.textContent = titleText;
    content.appendChild(title);

    const sprite = document.createElement("div");
    sprite.className = "cp-dossier-sprite";
    sprite.dataset.type = type;
    content.appendChild(sprite);

    const body = document.createElement("p");
    body.className = "cp-dossier-body";
    body.textContent = dossier?.body ?? "";
    content.appendChild(body);

    const rows = document.createElement("div");
    rows.className = "cp-dossier-rows";
    rows.appendChild(dossierRow("WIRE", dossier?.wire ?? "—"));
    rows.appendChild(dossierRow("HANDLES", dossier?.handles ?? "—"));
    rows.appendChild(dossierRow("RENT", `$${rentPerWave} / wave`));
    if (dossier?.tip) rows.appendChild(dossierRow("TIP", dossier.tip));
    content.appendChild(rows);

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "cp-dossier-cta";
    cta.textContent = "GOT IT, PLACE IT";
    content.appendChild(cta);

    modal.appendChild(content);
    document.body.appendChild(modal);

    const dismiss = (): void => {
      document.removeEventListener("keydown", onKey);
      if (modal.parentNode) modal.parentNode.removeChild(modal);
      resolve();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") dismiss();
    };

    close.addEventListener("click", dismiss);
    cta.addEventListener("click", dismiss);
    document.addEventListener("keydown", onKey);

    // Minimal focus trap: focus the CTA so Enter confirms.
    cta.focus();
  });
}

function dossierRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "cp-dossier-row";
  const k = document.createElement("span");
  k.className = "cp-dossier-row-key";
  k.textContent = label;
  const v = document.createElement("span");
  v.className = "cp-dossier-row-val";
  v.textContent = value;
  row.appendChild(k);
  row.appendChild(v);
  return row;
}
