-- Camions SDC : à coller une fois dans Supabase › SQL Editor › Run (projet neuf)
-- Chaque ligne appartient à l'utilisateur connecté (sécurité RLS).

create table if not exists public.camions (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client      text,
  reference   text,
  cree_le     timestamptz,
  termine_le  timestamptz,
  statut      text not null default 'en_cours',   -- en_cours / termine
  etat        text,                                -- ok / peu / trop
  total_m3    numeric(8,3) not null default 0,
  lignes      jsonb not null default '[]'::jsonb,  -- [{id, ep, la, pi, lo, nb}]
  plan        jsonb,                               -- {"idLigne#n": "G1" ... "D3"}
  maj_le      timestamptz not null default now(),
  supprime    boolean not null default false
);
create index if not exists camions_user_maj on public.camions (user_id, maj_le);

create table if not exists public.reglages (
  user_id  uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data     jsonb not null default '{}'::jsonb,
  maj_le   timestamptz not null default now()
);

alter table public.camions  enable row level security;
alter table public.reglages enable row level security;

drop policy if exists "camions_proprio" on public.camions;
create policy "camions_proprio" on public.camions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reglages_proprio" on public.reglages;
create policy "reglages_proprio" on public.reglages
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
