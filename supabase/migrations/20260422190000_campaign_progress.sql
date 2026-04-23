-- Campaign progress cloud save.
-- One row per user per level. Upserted on wave win, deleted on reset.
-- Last write wins (no conflict resolution).

create table if not exists public.campaign_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  level_id text not null,
  wave_index integer not null,
  budget integer not null,
  viability integer not null default 100,
  topology jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- One save per user per level
  unique (user_id, level_id)
);

create index if not exists campaign_progress_user_level_idx
  on public.campaign_progress (user_id, level_id);

-- RLS: users can read/write their own rows only.
alter table public.campaign_progress enable row level security;

drop policy if exists "campaign_progress_select_own"
  on public.campaign_progress;
create policy "campaign_progress_select_own"
  on public.campaign_progress
  for select
  using (auth.uid() = user_id);

drop policy if exists "campaign_progress_insert_own"
  on public.campaign_progress;
create policy "campaign_progress_insert_own"
  on public.campaign_progress
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "campaign_progress_update_own"
  on public.campaign_progress;
create policy "campaign_progress_update_own"
  on public.campaign_progress
  for update
  using (auth.uid() = user_id);

drop policy if exists "campaign_progress_delete_own"
  on public.campaign_progress;
create policy "campaign_progress_delete_own"
  on public.campaign_progress
  for delete
  using (auth.uid() = user_id);
