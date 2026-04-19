// Supabase Edge Function: stack-attack-chat
//
// A server-side proxy that enriches the client's game-state payload with a
// Socratic tutor system prompt, calls Anthropic's Claude API, logs the
// conversation to Postgres, and returns a structured reply to the browser.
//
// Runs on Deno. Deploy with:
//   npx supabase functions deploy stack-attack-chat
// Configure the upstream key with:
//   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// If ANTHROPIC_API_KEY is not set we return a stub response so the client
// lane can still exercise the happy path end-to-end.

// deno-lint-ignore-file no-explicit-any
// @ts-ignore deno import — resolved at edge runtime, ignored by pnpm typecheck
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// @ts-ignore deno import — resolved at edge runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import {
  buildSystemPrompt,
  type ChatMode,
  type HintLevel,
  type LiveMetrics,
  type RecentEvent,
  type TopologyContext,
  type WaveContext,
} from "./prompts.ts";

// @ts-ignore Deno global provided at runtime
declare const Deno: { env: { get(key: string): string | undefined } };

const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";
const CLAUDE_MAX_TOKENS = 512;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 30;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  mode: ChatMode;
  hintLevel: HintLevel;
  levelId?: string;
  wave: WaveContext;
  topology: TopologyContext;
  liveMetrics: LiveMetrics;
  recentEvents: RecentEvent[];
  conversationHistory: ChatMessage[];
  userMessage: string;
}

interface SuggestedAction {
  action: "add" | "delete" | "connect" | "inspect";
  target?: string;
}

interface ChatResponse {
  reply: string;
  highlights?: string[];
  suggestedAction?: SuggestedAction;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---- simple in-memory rate limiter (per edge instance) ----
const rateBuckets = new Map<string, number[]>();

function rateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key) ?? [];
  const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  rateBuckets.set(key, fresh);
  return true;
}

// ---- extract simple structured hints from Claude's reply ----
//
// Convention: if Claude writes "[highlight: a, b, c]" or "[action: add:DataCache]"
// at the end of a reply, we parse those out and strip them from the visible text.
function parseStructuredHints(raw: string): {
  text: string;
  highlights: string[];
  suggestedAction?: SuggestedAction;
} {
  let text = raw;
  const highlights: string[] = [];
  let suggestedAction: SuggestedAction | undefined;

  const highlightMatch = text.match(/\[highlight:\s*([^\]]+)\]/i);
  if (highlightMatch?.[1]) {
    highlights.push(
      ...highlightMatch[1].split(",").map((s) => s.trim()).filter(Boolean),
    );
    text = text.replace(highlightMatch[0], "").trim();
  }

  const actionMatch = text.match(/\[action:\s*(add|delete|connect|inspect)(?::([^\]]+))?\]/i);
  if (actionMatch?.[1]) {
    const action = actionMatch[1].toLowerCase() as SuggestedAction["action"];
    const target = actionMatch[2]?.trim();
    suggestedAction = target ? { action, target } : { action };
    text = text.replace(actionMatch[0], "").trim();
  }

  return { text, highlights, suggestedAction };
}

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<string> {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body}`);
  }

  const json = await res.json();
  const block = json?.content?.[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Anthropic API returned unexpected payload shape");
  }
  return block.text;
}

async function logConversation(
  body: ChatRequest,
  reply: string,
  userId: string | null,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return; // soft-fail: don't block reply on logging
  try {
    const admin = createClient(url, serviceKey);
    await admin.from("chatbot_conversations").insert({
      user_id: userId,
      level_id: body.levelId ?? null,
      hint_level: body.hintLevel,
      user_message: body.userMessage,
      assistant_reply: reply,
      topology_snapshot: body.topology,
      live_metrics: body.liveMetrics,
    });
  } catch (err) {
    console.warn("[stack-attack-chat] failed to log conversation", err);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return null;
  try {
    const client = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
    });
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  // Minimal validation — anything else Claude will handle gracefully.
  if (!body?.userMessage || !body.mode || !body.hintLevel || !body.wave || !body.topology || !body.liveMetrics) {
    return json(400, { error: "missing_required_fields" });
  }

  const userId = await resolveUserId(req);
  const rateKey = userId ?? `ip:${clientIp(req)}`;
  if (!rateLimit(rateKey)) {
    return json(429, { error: "rate_limited", reply: "You're chatting a lot — take a beat and try again in a minute." });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    const stub: ChatResponse = {
      reply: "AI tutor is not configured. Set ANTHROPIC_API_KEY in Supabase secrets to enable.",
      highlights: [],
    };
    return json(200, stub);
  }

  const systemPrompt = buildSystemPrompt({
    mode: body.mode,
    hintLevel: body.hintLevel,
    levelId: body.levelId,
    wave: body.wave,
    topology: body.topology,
    liveMetrics: body.liveMetrics,
    recentEvents: body.recentEvents ?? [],
  });

  let raw: string;
  try {
    raw = await callClaude(apiKey, systemPrompt, body.conversationHistory ?? [], body.userMessage);
  } catch (err) {
    console.error("[stack-attack-chat] claude error", err);
    return json(502, { error: "llm_upstream_error", reply: "The tutor is unreachable right now. Try again in a moment." });
  }

  const { text, highlights, suggestedAction } = parseStructuredHints(raw);

  // fire-and-forget logging
  logConversation(body, text, userId);

  const response: ChatResponse = { reply: text };
  if (highlights.length > 0) response.highlights = highlights;
  if (suggestedAction) response.suggestedAction = suggestedAction;
  return json(200, response);
});
