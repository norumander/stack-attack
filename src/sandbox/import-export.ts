/**
 * Import/export utilities for sandbox topologies.
 *
 * Pure functions (exportTopology, importTopology) are fully testable without DOM.
 * Modal helpers (showExportModal, showImportModal) require a browser environment.
 */

import type { TopologyDef } from "../playtest/topology-builder";
import type { WaveComposition, WaveKeyDistribution } from "@sim/wave";
import { toHCL, fromHCL } from "./hcl";

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
 * Show a read-only export modal with JSON/HCL format toggle.
 */
export function showExportModal(json: string, topology?: TopologyDef, traffic?: SandboxTrafficSettings): Promise<void> {
  const hcl = topology ? toHCL(topology, traffic) : "";

  return new Promise((resolve) => {
    const { overlay, modal } = createModal("Export Topology");

    // Format toggle
    let activeFormat: "json" | "hcl" = "json";
    const tabRow = document.createElement("div");
    tabRow.className = "cp-sandbox-modal-buttons";
    tabRow.style.marginBottom = "8px";
    const jsonTab = document.createElement("button");
    jsonTab.className = "cp-win-cta";
    jsonTab.textContent = "JSON";
    const hclTab = document.createElement("button");
    hclTab.className = "cp-win-cta cp-win-cta--secondary";
    hclTab.textContent = "TERRAFORM";
    if (!topology) hclTab.disabled = true;
    tabRow.appendChild(jsonTab);
    tabRow.appendChild(hclTab);
    modal.appendChild(tabRow);

    const textarea = document.createElement("textarea");
    textarea.className = "cp-sandbox-modal-textarea";
    textarea.readOnly = true;
    textarea.value = json;
    modal.appendChild(textarea);

    function setFormat(fmt: "json" | "hcl"): void {
      activeFormat = fmt;
      textarea.value = fmt === "json" ? json : hcl;
      jsonTab.className = fmt === "json" ? "cp-win-cta" : "cp-win-cta cp-win-cta--secondary";
      hclTab.className = fmt === "hcl" ? "cp-win-cta" : "cp-win-cta cp-win-cta--secondary";
    }
    jsonTab.addEventListener("click", () => setFormat("json"));
    hclTab.addEventListener("click", () => setFormat("hcl"));

    const buttons = document.createElement("div");
    buttons.className = "cp-sandbox-modal-buttons";

    const copyBtn = document.createElement("button");
    copyBtn.className = "cp-win-cta";
    copyBtn.textContent = "COPY";
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(textarea.value).catch(() => {
        textarea.select();
        document.execCommand("copy");
      });
    });

    const saveFileBtn = document.createElement("button");
    saveFileBtn.className = "cp-win-cta cp-win-cta--secondary";
    saveFileBtn.textContent = "SAVE FILE";
    saveFileBtn.addEventListener("click", () => {
      const isHcl = activeFormat === "hcl";
      const blob = new Blob([textarea.value], { type: isHcl ? "text/plain" : "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = isHcl ? "stack-attack-topology.tf" : "stack-attack-topology.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "cp-win-cta cp-win-cta--secondary";
    closeBtn.textContent = "CLOSE";
    closeBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve();
    });

    buttons.appendChild(copyBtn);
    buttons.appendChild(saveFileBtn);
    buttons.appendChild(closeBtn);
    modal.appendChild(buttons);

    document.body.appendChild(overlay);

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
    textarea.placeholder = "Paste JSON or Terraform HCL here…";
    modal.appendChild(textarea);

    const errorEl = document.createElement("p");
    errorEl.className = "cp-sandbox-modal-error";
    errorEl.style.display = "none";
    modal.appendChild(errorEl);

    /** Try parsing as JSON first, then HCL. */
    function tryParse(text: string): SandboxImportResult | null {
      const jsonResult = importTopology(text);
      if (jsonResult) return jsonResult;
      const hclResult = fromHCL(text);
      if (hclResult) return hclResult;
      return null;
    }

    const buttons = document.createElement("div");
    buttons.className = "cp-sandbox-modal-buttons";

    const loadBtn = document.createElement("button");
    loadBtn.className = "cp-win-cta";
    loadBtn.textContent = "LOAD";
    loadBtn.addEventListener("click", () => {
      const result = tryParse(textarea.value);
      if (result === null) {
        errorEl.textContent = "Invalid format — accepts JSON or Terraform HCL.";
        errorEl.style.display = "";
        return;
      }
      document.body.removeChild(overlay);
      resolve(result);
    });

    const loadFileBtn = document.createElement("button");
    loadFileBtn.className = "cp-win-cta cp-win-cta--secondary";
    loadFileBtn.textContent = "LOAD FILE";
    loadFileBtn.addEventListener("click", () => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".json,.tf";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          textarea.value = text;
          errorEl.style.display = "none";
          const result = tryParse(text);
          if (result === null) {
            errorEl.textContent = "Invalid format — accepts JSON or Terraform HCL.";
            errorEl.style.display = "";
            return;
          }
          document.body.removeChild(overlay);
          resolve(result);
        };
        reader.readAsText(file);
      });
      fileInput.click();
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cp-win-cta cp-win-cta--secondary";
    cancelBtn.textContent = "CANCEL";
    cancelBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
      resolve(null);
    });

    buttons.appendChild(loadBtn);
    buttons.appendChild(loadFileBtn);
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
