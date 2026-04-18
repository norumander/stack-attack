import { COMPONENT_META } from "./component-meta";

/**
 * Renders a full-overlay dossier modal for the given component type.
 * Returns a Promise that resolves once the user dismisses the modal
 * (CTA, × button, or Escape). Caller is responsible for calling
 * dossierStore.markSeen(type) after the promise resolves.
 */
export function showDossier(type: string, cost: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const meta = COMPONENT_META[type];
    const dossier = meta?.dossier;
    const titleText = meta?.displayName.toUpperCase() ?? type.toUpperCase();

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
    rows.appendChild(dossierRow("COST", `$${cost}`));
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
