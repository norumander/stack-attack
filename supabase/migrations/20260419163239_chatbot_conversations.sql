-- Chatbot conversation log for the Stack Attack in-game AI tutor.
--
-- Each row is one exchange (user message + assistant reply) with a snapshot
-- of the game state at that moment. Used for post-hoc quality analysis,
-- prompt iteration, and spotting stuck players.

create table if not exists public.chatbot_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  level_id text,
  hint_level text not null check (hint_level in ('explorer', 'coach', 'mentor')),
  user_message text not null,
  assistant_reply text not null,
  topology_snapshot jsonb not null default '{}'::jsonb,
  live_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chatbot_conversations_user_id_idx
  on public.chatbot_conversations (user_id, created_at desc);

create index if not exists chatbot_conversations_level_id_idx
  on public.chatbot_conversations (level_id, created_at desc);

-- RLS: users can read their own rows; the edge function uses the service role
-- key for inserts so it bypasses RLS.
alter table public.chatbot_conversations enable row level security;

drop policy if exists "chatbot_conversations_select_own"
  on public.chatbot_conversations;
create policy "chatbot_conversations_select_own"
  on public.chatbot_conversations
  for select
  using (auth.uid() = user_id);
