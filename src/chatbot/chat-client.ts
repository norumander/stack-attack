// Browser-side client for the `stack-attack-chat` Supabase Edge Function.
//
// The UI lane will call `sendChatMessage` with the current game state.
// This module is intentionally pure plumbing — no UI, no state management —
// so it can be unit-tested against a mocked `fetch`.

export type HintLevel = "explorer" | "coach" | "mentor";
export type ChatMode = "build" | "diagnose";

export interface ChatWave {
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

export interface ChatTopologyComponent {
  id: string;
  type: string;
  label?: string;
  zone?: string;
  utilization?: number;
  dropsThisWave?: number;
}

export interface ChatTopology {
  components: ChatTopologyComponent[];
  connections: Array<{ from: string; to: string }>;
}

export interface ChatLiveMetrics {
  availability: number;
  avgLatencySeconds: number;
  dropRate: number;
  currentTickSeconds: number;
}

export interface ChatRecentEvent {
  t: number;
  type: string;
  detail: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  mode: ChatMode;
  hintLevel: HintLevel;
  levelId?: string;
  wave: ChatWave;
  topology: ChatTopology;
  liveMetrics: ChatLiveMetrics;
  recentEvents: ChatRecentEvent[];
  conversationHistory: ChatHistoryMessage[];
  userMessage: string;
}

export interface ChatSuggestedAction {
  action: "add" | "delete" | "connect" | "inspect";
  target?: string;
}

export interface ChatResponse {
  reply: string;
  highlights?: string[];
  suggestedAction?: ChatSuggestedAction;
}

export class ChatClientError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = "ChatClientError";
  }
}

function resolveEndpoint(override?: string): string {
  if (override) return override;
  const base =
    (import.meta.env?.VITE_SUPABASE_URL as string | undefined) ?? "";
  if (!base) {
    throw new ChatClientError(
      "VITE_SUPABASE_URL is not configured — cannot resolve chat endpoint.",
    );
  }
  return `${base.replace(/\/$/, "")}/functions/v1/stack-attack-chat`;
}

async function resolveAuthToken(): Promise<string | null> {
  // Lazy-import so test environments without Supabase env vars don't blow up
  // at module load (the client module throws on construction otherwise).
  try {
    const base = (import.meta.env?.VITE_SUPABASE_URL as string | undefined) ?? "";
    const key = (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
    if (!base || !key) return null;
    const { supabase } = await import("../auth/supabase-client");
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export interface SendChatOptions {
  /** Override the edge function URL (tests). */
  endpoint?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Skip auth lookup (tests / anonymous mode). */
  skipAuth?: boolean;
  /** Abort signal to cancel the request. */
  signal?: AbortSignal;
}

export async function sendChatMessage(
  req: ChatRequest,
  opts: SendChatOptions = {},
): Promise<ChatResponse> {
  const endpoint = resolveEndpoint(opts.endpoint);
  const fetchImpl = opts.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (!opts.skipAuth) {
    const token = await resolveAuthToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }

  const init: RequestInit = {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  };
  if (opts.signal) init.signal = opts.signal;

  let res: Response;
  try {
    res = await fetchImpl(endpoint, init);
  } catch (err) {
    throw new ChatClientError(
      `Network error calling chat endpoint: ${(err as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ChatClientError(
      `Chat endpoint returned non-JSON (status ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    // Server rate-limit / upstream-error responses still carry a reply string
    // that the UI can show — surface it by preferring the body's `reply`.
    const reply =
      body && typeof body === "object" && "reply" in body
        ? String((body as { reply: unknown }).reply)
        : undefined;
    if (reply) return { reply };
    throw new ChatClientError(
      `Chat endpoint error (status ${res.status})`,
      res.status,
      body,
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { reply?: unknown }).reply !== "string"
  ) {
    throw new ChatClientError("Chat endpoint returned malformed response", res.status, body);
  }

  return body as ChatResponse;
}
