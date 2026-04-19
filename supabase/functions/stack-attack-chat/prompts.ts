// System prompt builder for the Stack Attack in-game AI tutor.
//
// The tutor is a Socratic coach that watches the player's live topology and
// wave metrics and nudges them toward diagnosing bottlenecks themselves.
// The hint level knob controls how much the tutor reveals.

export type HintLevel = "explorer" | "coach" | "mentor";
export type ChatMode = "build" | "diagnose";

export interface WaveContext {
  id: string;
  title: string;
  intensity: number;
  composition: {
    writeRatio: number;
    authRatio: number;
    streamRatio: number;
    largeRatio: number;
    asyncRatio: number;
  };
  duration: number;
  sla: {
    availability: number;
    maxAvgLatencySeconds: number;
    maxDropRate: number;
  };
}

export interface TopologyComponent {
  id: string;
  type: string;
  label?: string;
  zone?: string;
  utilization?: number;
  dropsThisWave?: number;
}

export interface TopologyConnection {
  from: string;
  to: string;
}

export interface TopologyContext {
  components: TopologyComponent[];
  connections: TopologyConnection[];
}

export interface LiveMetrics {
  availability: number;
  avgLatencySeconds: number;
  dropRate: number;
  currentTickSeconds: number;
}

export interface RecentEvent {
  t: number;
  type: string;
  detail: string;
}

export interface PromptInputs {
  mode: ChatMode;
  hintLevel: HintLevel;
  levelId?: string;
  wave: WaveContext;
  topology: TopologyContext;
  liveMetrics: LiveMetrics;
  recentEvents: RecentEvent[];
}

const HINT_LEVEL_RULES: Record<HintLevel, string> = {
  explorer: [
    "HINT LEVEL: EXPLORER (maximum Socratic).",
    "- Never state the fix directly. Never name the specific component to add, delete, or wire.",
    "- Respond primarily with guiding questions that help the player notice the symptom themselves.",
    "- If the player seems stuck, narrow the question (from 'what's saturated?' down to 'which zone has the highest utilization?').",
    "- Refuse politely if the player asks 'just tell me the answer'; invite them to inspect a specific metric instead.",
  ].join("\n"),
  coach: [
    "HINT LEVEL: COACH (partial reveal).",
    "- Name the bottleneck by role (e.g., 'your write path is saturated', 'auth is the hot spot').",
    "- Hint at the pattern family that resolves it (e.g., 'a caching layer', 'a queue to smooth bursts', 'horizontal replicas') without prescribing the exact component type or placement.",
    "- Still end with a guiding question that asks the player which component they think fits.",
  ].join("\n"),
  mentor: [
    "HINT LEVEL: MENTOR (concrete prescription).",
    "- Describe the fix concretely: name the component type to add, where to place it, and which connections to (re)wire.",
    "- Example phrasing: 'Add a Data Cache between Server 1 and the Profile DB, then redirect read traffic through it.'",
    "- Still briefly explain *why* the fix works so the player learns the pattern, not just the move.",
  ].join("\n"),
};

const MODE_RULES: Record<ChatMode, string> = {
  build: [
    "MODE: BUILD (pre-wave planning).",
    "- The wave has not yet started. Focus on forecasting what this wave's composition will stress (writes, auth, streams, large payloads, async work).",
    "- Help the player reason about SLA targets vs. the topology they've drafted.",
  ].join("\n"),
  diagnose: [
    "MODE: DIAGNOSE (mid-wave triage).",
    "- The wave is live. Anchor your answer in the current live metrics and recent events.",
    "- Prefer the most recent signal (last ~10s) over what the topology looked like at wave start.",
  ].join("\n"),
};

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function renderWave(wave: WaveContext): string {
  const c = wave.composition;
  return [
    `Wave: ${wave.title} (id=${wave.id})`,
    `  intensity=${wave.intensity} req/tick, duration=${wave.duration}s`,
    `  composition: write=${fmtPct(c.writeRatio)} auth=${fmtPct(c.authRatio)} stream=${fmtPct(c.streamRatio)} large=${fmtPct(c.largeRatio)} async=${fmtPct(c.asyncRatio)}`,
    `  SLA: availability>=${fmtPct(wave.sla.availability)}, avgLatency<=${wave.sla.maxAvgLatencySeconds}s, dropRate<=${fmtPct(wave.sla.maxDropRate)}`,
  ].join("\n");
}

function renderTopology(t: TopologyContext): string {
  if (t.components.length === 0) return "Topology: (empty — no components placed yet)";
  const comps = t.components
    .map((c) => {
      const parts = [`${c.id}:${c.type}`];
      if (c.label) parts.push(`"${c.label}"`);
      if (c.zone) parts.push(`zone=${c.zone}`);
      if (c.utilization !== undefined) parts.push(`util=${fmtPct(c.utilization)}`);
      if (c.dropsThisWave !== undefined && c.dropsThisWave > 0) parts.push(`drops=${c.dropsThisWave}`);
      return `  - ${parts.join(" ")}`;
    })
    .join("\n");
  const conns = t.connections.length
    ? t.connections.map((c) => `  - ${c.from} -> ${c.to}`).join("\n")
    : "  (no connections)";
  return `Topology components:\n${comps}\nConnections:\n${conns}`;
}

function renderMetrics(m: LiveMetrics): string {
  return [
    `Live metrics @ t=${m.currentTickSeconds}s:`,
    `  availability=${fmtPct(m.availability)}`,
    `  avgLatency=${m.avgLatencySeconds.toFixed(3)}s`,
    `  dropRate=${fmtPct(m.dropRate)}`,
  ].join("\n");
}

function renderEvents(events: RecentEvent[]): string {
  if (events.length === 0) return "Recent events: (none)";
  const lines = events
    .slice(-10)
    .map((e) => `  - t=${e.t}s [${e.type}] ${e.detail}`)
    .join("\n");
  return `Recent events (most recent last):\n${lines}`;
}

export function buildSystemPrompt(inputs: PromptInputs): string {
  const persona = [
    "You are the Stack Attack Tutor — a Socratic coach embedded in a tower-defense game where players build system architectures to survive waves of traffic.",
    "You teach distributed-systems patterns (caching, queues, load balancing, replication, auth offload, backpressure) through guided diagnosis, not lectures.",
    "Keep replies tight (<= ~120 words). Use plain English. Reference specific component IDs from the topology when pointing at things.",
    "Never invent components that are not in the topology. Never promise a fix will work — describe the expected effect and the signal to watch.",
  ].join(" ");

  const responseShape = [
    "RESPONSE SHAPE:",
    "- Your reply is markdown-compatible plain text; no JSON, no code fences unless quoting a command.",
    "- You MAY emphasize components by naming their IDs — the game can highlight them.",
    "- One question per turn in explorer/coach modes. End mentor replies with a one-line 'why it works' note.",
  ].join("\n");

  const levelLine = inputs.levelId ? `Level: ${inputs.levelId}` : "Level: (unspecified)";

  return [
    persona,
    "",
    MODE_RULES[inputs.mode],
    "",
    HINT_LEVEL_RULES[inputs.hintLevel],
    "",
    responseShape,
    "",
    "=== GAME STATE ===",
    levelLine,
    renderWave(inputs.wave),
    renderTopology(inputs.topology),
    renderMetrics(inputs.liveMetrics),
    renderEvents(inputs.recentEvents),
  ].join("\n");
}
