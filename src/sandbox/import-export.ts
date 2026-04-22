/**
 * Import/export utilities for sandbox topologies.
 *
 * Pure functions (exportTopology, importTopology) are fully testable without DOM.
 * Modal helpers (showExportModal, showImportModal) require a browser environment.
 */

import type { TopologyDef } from "../playtest/topology-builder";
import type { WaveComposition, WaveKeyDistribution } from "@sim/wave";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxTrafficSettings {
  readonly intensity: number;
  readonly composition: WaveComposition;
  readonly keyDistribution: WaveKeyDistribution;
}

export interface SandboxExport extends TopologyDef {
  readonly traffic?: SandboxTrafficSettings;
}

export interface SandboxImportResult {
  readonly topology: TopologyDef;
  readonly traffic?: SandboxTrafficSettings;
}

// ---------------------------------------------------------------------------
// Pure serialisation helpers
// ---------------------------------------------------------------------------

/**
 * Serialise a topology (+ optional traffic settings) to a JSON string.
 */
export function exportTopology(
  topology: TopologyDef,
  traffic?: SandboxTrafficSettings,
): string {
  const payload: SandboxExport = traffic !== undefined
    ? { ...topology, traffic }
    : { ...topology };
  return JSON.stringify(payload, null, 2);
}

/**
 * Deserialise a JSON string produced by exportTopology.
 * Returns null for any malformed or structurally invalid input.
 */
export function importTopology(json: string): SandboxImportResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Required fields
  if (typeof obj["entryTargetId"] !== "string") return null;
  if (!Array.isArray(obj["components"])) return null;
  if (!Array.isArray(obj["connections"])) return null;

  const label = typeof obj["label"] === "string" ? obj["label"] : "";
  const autoScaleIds = Array.isArray(obj["autoScaleIds"])
    ? (obj["autoScaleIds"] as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const topology: TopologyDef = {
    label,
    entryTargetId: obj["entryTargetId"] as string,
    components: obj["components"] as TopologyDef["components"],
    connections: obj["connections"] as TopologyDef["connections"],
    autoScaleIds,
  };

  const result: SandboxImportResult =
    obj["traffic"] !== undefined
      ? { topology, traffic: obj["traffic"] as SandboxTrafficSettings }
      : { topology };

  return result;
}

// ---------------------------------------------------------------------------
// Modal helpers (DOM — not unit-tested)
// ---------------------------------------------------------------------------

function createOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "cp-sandbox-modal-overlay";
  return overlay;
}

function createModal(title: string): { overlay: HTMLDivElement; modal: HTMLDivElement; titleEl: HTMLHeadingElement } {
  const overlay = createOverlay();
  const modal = document.createElement("div");
  modal.className = "cp-sandbox-modal cp-panel";
  const titleEl = document.createElement("h2");
  titleEl.className = "cp-sandbox-modal-title";
  titleEl.textContent = title;
  modal.appendChild(titleEl);
  overlay.appendChild(modal);
  return { overlay, modal, titleEl };
}

/**
 * Show a read-only export modal with COPY and CLOSE buttons.
 */
export function showExportModal(json: string): Promise<void> {
  return new Promise((resolve) => {
    const { overlay, modal } = createModal("Export Topology");

    const textarea = document.createElement("textarea");
    textarea.className = "cp-sandbox-modal-textarea";
    textarea.readOnly = true;
    textarea.value = json;
    modal.appendChild(textarea);

    const buttons = document.createElement("div");
    buttons.className = "cp-sandbox-modal-buttons";

    const copyBtn = document.createElement("button");
    copyBtn.className = "cp-win-cta";
    copyBtn.textContent = "COPY";
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(json).catch(() => {
        textarea.select();
        document.execCommand("copy");
      });
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "cp-win-cta cp-win-cta--secondary";
    closeBtn.textContent = "CLOSE";
    closeBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve();
    });

    buttons.appendChild(copyBtn);
    buttons.appendChild(closeBtn);
    modal.appendChild(buttons);

    document.body.appendChild(overlay);

    // Also close on overlay click
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve();
      }
    });
  });
}

/**
 * Show an import modal with a textarea, LOAD, and CANCEL buttons.
 * Resolves with the parsed result on success, or null on cancel / invalid input.
 */
export function showImportModal(): Promise<SandboxImportResult | null> {
  return new Promise((resolve) => {
    const { overlay, modal } = createModal("Import Topology");

    const textarea = document.createElement("textarea");
    textarea.className = "cp-sandbox-modal-textarea";
    textarea.placeholder = "Paste exported JSON here…";
    modal.appendChild(textarea);

    const errorEl = document.createElement("p");
    errorEl.className = "cp-sandbox-modal-error";
    errorEl.style.display = "none";
    modal.appendChild(errorEl);

    const buttons = document.createElement("div");
    buttons.className = "cp-sandbox-modal-buttons";

    const loadBtn = document.createElement("button");
    loadBtn.className = "cp-win-cta";
    loadBtn.textContent = "LOAD";
    loadBtn.addEventListener("click", () => {
      const result = importTopology(textarea.value);
      if (result === null) {
        errorEl.textContent = "Invalid topology JSON — check the format and try again.";
        errorEl.style.display = "";
        return;
      }
      document.body.removeChild(overlay);
      resolve(result);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cp-win-cta cp-win-cta--secondary";
    cancelBtn.textContent = "CANCEL";
    cancelBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve(null);
    });

    buttons.appendChild(loadBtn);
    buttons.appendChild(cancelBtn);
    modal.appendChild(buttons);

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
        resolve(null);
      }
    });
  });
}
