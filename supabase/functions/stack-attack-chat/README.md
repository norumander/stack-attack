# `stack-attack-chat` — Supabase Edge Function

Server-side LLM proxy for the Stack Attack in-game AI tutor. Keeps the
Anthropic API key off the browser, injects the Socratic-tutor system prompt,
enforces rate limits, and logs every exchange to `public.chatbot_conversations`.

## Files

- `index.ts`   — HTTP handler, rate limiter, Anthropic call, structured-hint parser, Supabase logger.
- `prompts.ts` — System-prompt builder. Iterate on tutor persona + hint-level rules here.

## Environment

Set these as Supabase Function secrets (not in `.env`):

| Secret                      | Purpose                                                                 |
|-----------------------------|-------------------------------------------------------------------------|
| `ANTHROPIC_API_KEY`         | Required. Claude 3.5 Sonnet API key. If absent, function returns stub.  |
| `SUPABASE_URL`              | Auto-injected by Supabase runtime. Used for logging + auth lookup.      |
| `SUPABASE_ANON_KEY`         | Auto-injected. Used to resolve the caller's user ID from the JWT.       |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected. Used to insert conversation rows past RLS.               |

## Manual steps the user must run

The agent cannot perform any of these — they all require your Supabase project
credentials / CLI session.

```bash
# 1. Apply the DB migration (creates chatbot_conversations table + RLS)
npx supabase db push

# 2. Store the Anthropic API key
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# 3. Deploy the function
npx supabase functions deploy stack-attack-chat
```

Verify it's live:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/stack-attack-chat" \
  -H "content-type: application/json" \
  -d '{"mode":"diagnose","hintLevel":"coach","wave":{...},"topology":{...},"liveMetrics":{...},"recentEvents":[],"conversationHistory":[],"userMessage":"why am I dropping traffic?"}'
```

## Contract

See `src/chatbot/chat-client.ts` for the canonical TypeScript types. Request /
response shapes are kept in sync manually — update both when changing either.

## Model & limits

- Model: `claude-3-5-sonnet-20241022`
- `max_tokens`: 512
- Rate limit: 30 requests / hour, keyed on the authenticated user ID or, for
  anonymous users, the client IP (`x-forwarded-for` / `cf-connecting-ip`).
- The rate limiter is in-memory per edge instance — good enough for the demo,
  but swap to a Redis-backed counter if this ever sees real traffic.

## Hint-level behavior

| Level     | Behavior                                                                    |
|-----------|-----------------------------------------------------------------------------|
| explorer  | Pure Socratic. Never names the fix; always ends in a guiding question.      |
| coach     | Names the bottleneck role + pattern family, but not the exact component.   |
| mentor    | Prescribes the concrete fix (component type, placement, wiring) + why.      |

## Structured hints (optional)

Claude can emit `[highlight: id1, id2]` and/or `[action: add:DataCache]` at the
end of a reply. The handler strips those tags from the visible text and
returns them as `highlights` / `suggestedAction` for the UI to act on.
