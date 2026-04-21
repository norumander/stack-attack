#!/usr/bin/env node
/**
 * Local chat proxy — replaces the Supabase Edge Function for local dev.
 *
 * Reads ANTHROPIC_API_KEY from .env (or env var), builds the system prompt
 * using the same logic as the edge function, calls Claude, and returns the
 * response. No Supabase, no auth, no rate limiting, no DB logging.
 *
 * Usage:
 *   node scripts/chat-proxy.mjs          # reads .env automatically
 *   ANTHROPIC_API_KEY=sk-... node scripts/chat-proxy.mjs
 *
 * The Vite dev server proxies /api/chat → this server (see vite.config.ts).
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Load .env manually (no dotenv dependency)
function loadEnv() {
  try {
    const envFile = readFileSync(resolve(ROOT, ".env"), "utf-8");
    for (const line of envFile.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* no .env file — rely on env vars */ }
}
loadEnv();

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = parseInt(process.env.CHAT_PROXY_PORT || "3099", 10);
const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 512;

// ---- import the prompt builder (it's TypeScript but we inline the logic) ----

// Inline the prompt builder to avoid needing a TS compiler at runtime.
// This mirrors supabase/functions/stack-attack-chat/prompts.ts exactly.

const HINT_LEVEL_RULES = {
  explorer: [
    "HINT LEVEL: EXPLORER (maximum Socratic).",
    "- Never state the fix directly. Never name the specific component to add, delete, or wire.",
    "- Respond primarily with guiding questions that help the player notice the symptom themselves.",
    "- If the player seems stuck, narrow the question.",
    "- Refuse politely if the player asks 'just tell me the answer'.",
  ].join("\n"),
  coach: [
    "HINT LEVEL: COACH (partial reveal).",
    "- Name the bottleneck by role (e.g., 'your write path is saturated').",
    "- Hint at the pattern family without prescribing the exact component.",
    "- Still end with a guiding question.",
  ].join("\n"),
  mentor: [
    "HINT LEVEL: MENTOR (concrete prescription).",
    "- Describe the fix concretely: name the component type, where to place it, which connections to (re)wire.",
    "- Still briefly explain *why* the fix works.",
  ].join("\n"),
};

const MODE_RULES = {
  build: "MODE: BUILD (pre-wave planning). The wave has not started. Focus on forecasting what this wave's composition will stress.",
  diagnose: "MODE: DIAGNOSE (mid-wave triage). The wave is live. Anchor your answer in current live metrics and recent events.",
};

function fmtPct(n) { return `${(n * 100).toFixed(1)}%`; }

function buildSystemPrompt(body) {
  const persona = "You are the Stack Attack Tutor — a Socratic coach embedded in a tower-defense game where players build system architectures to survive waves of traffic. Keep replies tight (<= ~120 words). Use plain English. Reference specific component IDs from the topology.";

  const c = body.wave.composition;
  const wave = [
    `Wave: ${body.wave.title} (id=${body.wave.id})`,
    `  intensity=${body.wave.intensity}, duration=${body.wave.duration}s`,
    `  composition: write=${fmtPct(c.writeRatio)} auth=${fmtPct(c.authRatio)} stream=${fmtPct(c.streamRatio)} large=${fmtPct(c.largeRatio)} async=${fmtPct(c.asyncRatio)}`,
    `  SLA: availability>=${fmtPct(body.wave.sla.availability)}, avgLatency<=${body.wave.sla.maxAvgLatencySeconds}s, dropRate<=${fmtPct(body.wave.sla.maxDropRate)}`,
  ].join("\n");

  const comps = (body.topology.components || []).map(tc => {
    const parts = [`${tc.id}:${tc.type}`];
    if (tc.label) parts.push(`"${tc.label}"`);
    if (tc.zone) parts.push(`zone=${tc.zone}`);
    if (tc.utilization !== undefined) parts.push(`util=${fmtPct(tc.utilization)}`);
    if (tc.dropsThisWave > 0) parts.push(`drops=${tc.dropsThisWave}`);
    return `  - ${parts.join(" ")}`;
  }).join("\n") || "  (empty)";

  const conns = (body.topology.connections || []).map(c => `  - ${c.from} -> ${c.to}`).join("\n") || "  (none)";

  const m = body.liveMetrics;
  const metrics = `Live metrics @ t=${m.currentTickSeconds}s:\n  availability=${fmtPct(m.availability)}\n  avgLatency=${m.avgLatencySeconds.toFixed(3)}s\n  dropRate=${fmtPct(m.dropRate)}`;

  const events = (body.recentEvents || []).length
    ? body.recentEvents.slice(-10).map(e => `  - t=${e.t}s [${e.type}] ${e.detail}`).join("\n")
    : "  (none)";

  return [
    persona, "",
    MODE_RULES[body.mode] || "", "",
    HINT_LEVEL_RULES[body.hintLevel] || "", "",
    "=== GAME STATE ===",
    body.levelId ? `Level: ${body.levelId}` : "Level: (unspecified)",
    wave,
    `Topology components:\n${comps}\nConnections:\n${conns}`,
    metrics,
    `Recent events:\n${events}`,
  ].join("\n");
}

function parseStructuredHints(raw) {
  let text = raw;
  const highlights = [];
  let suggestedAction;

  const hlMatch = text.match(/\[highlight:\s*([^\]]+)\]/i);
  if (hlMatch?.[1]) {
    highlights.push(...hlMatch[1].split(",").map(s => s.trim()).filter(Boolean));
    text = text.replace(hlMatch[0], "").trim();
  }

  const actMatch = text.match(/\[action:\s*(add|delete|connect|inspect)(?::([^\]]+))?\]/i);
  if (actMatch?.[1]) {
    suggestedAction = { action: actMatch[1].toLowerCase() };
    if (actMatch[2]) suggestedAction.target = actMatch[2].trim();
    text = text.replace(actMatch[0], "").trim();
  }

  return { text, highlights, suggestedAction };
}

// ---- HTTP server ----

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "method_not_allowed" })); return; }

  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;

  let body;
  try { body = JSON.parse(rawBody); } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }

  if (!API_KEY) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ reply: "AI tutor not configured. Add ANTHROPIC_API_KEY to .env and restart the chat proxy." }));
    return;
  }

  const systemPrompt = buildSystemPrompt(body);
  const messages = [
    ...(body.conversationHistory || []).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: body.userMessage },
  ];

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, messages }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error(`[chat-proxy] Anthropic ${apiRes.status}: ${errText}`);
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ reply: "Tutor unreachable. Check your ANTHROPIC_API_KEY." }));
      return;
    }

    const json = await apiRes.json();
    const raw = json?.content?.[0]?.text || "(empty response)";
    const { text, highlights, suggestedAction } = parseStructuredHints(raw);

    const response = { reply: text };
    if (highlights.length) response.highlights = highlights;
    if (suggestedAction) response.suggestedAction = suggestedAction;

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  } catch (err) {
    console.error("[chat-proxy] error:", err.message);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ reply: "Network error reaching Claude API." }));
  }
});

server.listen(PORT, () => {
  console.log(`[chat-proxy] listening on http://localhost:${PORT}`);
  console.log(`[chat-proxy] API key: ${API_KEY ? "configured" : "MISSING — add ANTHROPIC_API_KEY to .env"}`);
});
