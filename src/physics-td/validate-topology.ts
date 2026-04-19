import type { ComponentId } from "@core/types/ids";
import type { Sim } from "@sim/sim";
import type { WaveDef } from "@sim/wave";
import type { SimComponent } from "@sim/component";
import type { SimCapability } from "@sim/types";

/**
 * Pre-sim topology validator. BFS from the entry client along forward
 * connections, per request type, checking whether any reachable component's
 * capability can terminate the request. Reports `no_handler` (BFS exhausted
 * without finding a terminal handler) or `no_egress` (a forwarder-only
 * component has no outgoing forward edge).
 *
 * This is best-effort static analysis. Capability semantics are simplified
 * to capability-id plus request-type heuristics — the validator errs
 * optimistically so valid topologies are not flagged, at the cost of
 * occasionally missing a truly-broken edge case that only fails at runtime.
 */

export type RequestType =
  | "api_read"
  | "api_write"
  | "auth_required"
  | "stream_data"
  | "large_payload"
  | "async_work";

export interface TopologyError {
  requestType: string;
  componentId: ComponentId;
  componentType: string;
  reason: "no_handler" | "no_egress";
}

/** Role of a capability for a given request type. */
type Role = "terminal" | "forwarder" | "none";

/**
 * Classify a capability by id for a given request type.
 *
 * Contract:
 *  - "terminal" — explicitly handles AND terminates (responds/stores/reserves)
 *  - "forwarder" — may pass the type through to egress (either because the
 *    capability explicitly forwards, OR because it simply doesn't match and
 *    the packet continues via component egress at runtime)
 *  - "none" — the capability will drop/reject the type (rare; only blob_storage
 *    currently drops-on-mismatch via its "unsupported" branch)
 *
 * Terminal per type:
 *  - processing: terminates writes, responds to reads (all non-specialty types)
 *  - caching: responds on cache hit (optimistic — terminal for reads / large reads)
 *  - gateway: terminates auth; forwards others
 *  - streaming: terminates stream; forwards others
 *  - worker: terminates async items pulled from queue; forwards others (doesn't
 *    destroy the packet — runtime passes through via component egress)
 *  - blob_storage: terminal for large_payload and stream_data; drops others
 *
 * Pure forwarders (any type): forwarding, load-balancer, geo-routing, queue
 * (non-async forwarded, async held → implicitly satisfied by downstream worker),
 * circuit_breaker (CLOSED forwards all; OPEN is runtime chaos, not a static
 * flag), auto-scale (second-capability, never on arrival path).
 */
function classify(capId: string, type: RequestType): Role {
  switch (capId) {
    case "processing":
      // ProcessingCapability doesn't inspect stream/async flags — at runtime
      // it terminates writes / responds to reads regardless. But the
      // validator prefers dedicated handlers (streaming, worker) for those
      // specialty types; treat processing as forwarder there so BFS doesn't
      // prematurely satisfy, but not "none" because the component egress
      // will still carry the packet toward a real handler if one exists.
      if (type === "stream_data" || type === "async_work") return "forwarder";
      return "terminal";
    case "caching":
      // Can terminate reads on hit; forwards misses + writes + specialties.
      if (type === "api_read" || type === "large_payload") return "terminal";
      return "forwarder";
    case "gateway":
      if (type === "auth_required") return "terminal";
      return "forwarder";
    case "streaming":
      if (type === "stream_data") return "terminal";
      return "forwarder";
    case "worker":
      if (type === "async_work") return "terminal";
      // For non-async, Worker doesn't claim the packet — runtime flows it
      // to component egress. Treat as forwarder so validator matches runtime
      // behavior in chains like Client → LB → Worker → Server → DB.
      return "forwarder";
    case "blob_storage":
      // Terminal for large_payload + stream_data. Explicitly drops
      // everything else with reason "unsupported".
      if (type === "large_payload" || type === "stream_data") return "terminal";
      return "none";
    case "queue":
      // Queue holds async until worker pulls; forwards non-async to egress.
      // Async satisfaction depends on a downstream worker being reachable,
      // so treat queue itself as forwarder — BFS will keep walking.
      return "forwarder";
    case "circuit_breaker":
      // CLOSED: forwards to first egress. OPEN/HALF_OPEN is a runtime chaos
      // concern, not a static topology flag. Treat as forwarder.
      return "forwarder";
    case "auto-scale":
      // Second-capability attached via enableAutoScale. Never the arrival
      // path; returns drop(0) if invoked. A component bearing auto-scale
      // always has a primary capability in slot 0, so this case only
      // matters when auto-scale shows up as a later cap — should not
      // block the BFS at that component.
      return "forwarder";
    case "forwarding":
    case "load-balancer":
    case "geo-routing":
      return "forwarder";
    default:
      return "none";
  }
}

/** Determine which request types this wave actually emits.
 *
 * async_work is a modifier: if asyncRatio < 1, reads/writes still flow
 * through the normal (non-queue) path for the non-async fraction. At
 * asyncRatio === 1 the entire wave is async and no non-async path is
 * needed. Other ratios (write/auth/stream/large) are mutually non-exclusive
 * dimensions that each demand their own terminal.
 */
function enumerateRequestTypes(wave: WaveDef): RequestType[] {
  const c = wave.composition;
  const types: RequestType[] = [];
  const nonAsyncFraction = 1 - c.asyncRatio;
  const readRatio = nonAsyncFraction > 0
    ? 1 - c.writeRatio - c.authRatio - c.streamRatio
    : 0;

  if (nonAsyncFraction > 0) {
    if (readRatio > 0) types.push("api_read");
    if (c.writeRatio > 0) types.push("api_write");
    if (c.authRatio > 0) types.push("auth_required");
    if (c.streamRatio > 0) types.push("stream_data");
    if (c.largeRatio > 0) types.push("large_payload");
  }
  if (c.asyncRatio > 0) types.push("async_work");
  return types;
}

function componentTypeLabel(comp: SimComponent): string {
  const cap = comp.capabilities[0];
  return cap?.id ?? "unknown";
}

/**
 * BFS for a single request type. Returns either no errors (type satisfied)
 * or a single error describing where/why the flow broke.
 */
function bfsForType(
  sim: Sim,
  entryClientId: ComponentId,
  type: RequestType,
): TopologyError | null {
  const visited = new Set<ComponentId>();
  const queue: ComponentId[] = [entryClientId];
  visited.add(entryClientId);

  // Track the deepest component reached for "no_handler" error placement.
  let deepestReached: ComponentId = entryClientId;

  while (queue.length > 0) {
    const current = queue.shift()!;
    deepestReached = current;
    const comp = sim.components.get(current);
    if (!comp) continue;

    // Check capabilities at this component (skip the client's — empty list).
    const isEntry = current === entryClientId;
    if (!isEntry) {
      let anyTerminal = false;
      let anyForwarder = false;
      for (const cap of comp.capabilities) {
        const role = classify(cap.id, type);
        if (role === "terminal") anyTerminal = true;
        else if (role === "forwarder") anyForwarder = true;
      }
      if (anyTerminal) {
        // This type is satisfied — done.
        return null;
      }
      if (!anyForwarder && comp.capabilities.length > 0) {
        // Reached a component that neither terminates nor forwards this type.
        return {
          requestType: type,
          componentId: current,
          componentType: componentTypeLabel(comp),
          reason: "no_handler",
        };
      }
      // Otherwise: forwarder — fall through to enqueue egresses.
    }

    // Enumerate forward egresses.
    const egresses: ComponentId[] = [];
    for (const conn of sim.connections.values()) {
      if (conn.direction !== "forward") continue;
      if (conn.from.componentId !== current) continue;
      egresses.push(conn.to.componentId);
    }

    // Entry client with no outgoing edges is handled upstream (bootstrap
    // already blocks READY in that case). Here we still need to flag a
    // forwarder component with zero egress as `no_egress`.
    if (!isEntry && egresses.length === 0) {
      return {
        requestType: type,
        componentId: current,
        componentType: componentTypeLabel(comp),
        reason: "no_egress",
      };
    }

    for (const target of egresses) {
      if (visited.has(target)) continue; // cycle guard
      visited.add(target);
      queue.push(target);
    }
  }

  // BFS exhausted without finding a terminal handler.
  const deepestComp = sim.components.get(deepestReached);
  return {
    requestType: type,
    componentId: deepestReached,
    componentType: deepestComp ? componentTypeLabel(deepestComp) : "client",
    reason: "no_handler",
  };
}

export function validateTopology(
  sim: Sim,
  wave: WaveDef,
  entryClientId: ComponentId,
): TopologyError[] {
  const errors: TopologyError[] = [];
  const types = enumerateRequestTypes(wave);
  for (const type of types) {
    const err = bfsForType(sim, entryClientId, type);
    if (err) errors.push(err);
  }
  return errors;
}

// Re-export used only for type introspection in tests / callers.
export type { SimCapability };
