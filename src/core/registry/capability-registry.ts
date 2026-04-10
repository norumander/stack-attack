import type { Capability } from "../capability/capability.js";
import type { CapabilityId } from "../types/ids.js";

export interface CapabilityRegistryEntry {
  id: CapabilityId;
  factory: () => Capability;
  documentsSubInterfaces?: readonly (
    | "EngineConsultable"
    | "EngineBufferable"
    | "EnginePullable"
    | "InstanceDirectory"
  )[];
}

export class CapabilityRegistry {
  private readonly entries = new Map<CapabilityId, CapabilityRegistryEntry>();

  register(entry: CapabilityRegistryEntry): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`Capability ${entry.id} already registered`);
    }
    this.entries.set(entry.id, entry);
  }

  get(id: CapabilityId): CapabilityRegistryEntry | undefined {
    return this.entries.get(id);
  }

  validate(): void {
    // Phase 1 has no cross-capability dependencies to validate here. Hook in
    // later stages when capabilities gain registration-time preconditions.
  }
}
