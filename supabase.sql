-- =====================================================================
-- Camions SDC — équipe partagée (sans compte, avec un code d'équipe)
-- À coller UNE FOIS dans Supabase › SQL Editor › Run (projet neuf).
-- Puis : Authentication › Sign In / Providers › activer « Allow anonymous sign-ins ».
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------
create table if not exists public.equipes (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique,          -- code d'équipe (jamais stocké en clair)
  recup_hash  text,                          -- code secret de l'administrateur
  admin_id    uuid not null,                 -- invisible pour les autres
  reglages    jsonb not null default '{}'::jsonb,
  reglages_le timestamptz not null default now(),
  cree_le     timestamptz not null default now()
);

create table if not exists public.membres (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  equipe_id  uuid not null references public.equipes (id) on delete cascade,
  prenom     text not null,
  actif      boolean not null default true,
  rejoint_le timestamptz not null default now(),
  vu_le      timestamptz not null default now()
);

create table if not exists public.camions_equipe (
  id            text primary key,
  equipe_id     uuid not null references public.equipes (id) on delete cascade,
  auteur        uuid not null,
  auteur_prenom text,
  cle           text,                          -- client|référence|jour : évite les doublons
  data          jsonb not null,                -- le camion complet (colis, plan…)
  supprime      boolean not null default false,
  maj_le        timestamptz not null,          -- heure de la modif sur le téléphone
  serveur_le    timestamptz not null default clock_timestamp()
);
create index if not exists camions_equipe_sync on public.camions_equipe (equipe_id, serveur_le);
create index if not exists camions_equipe_cle  on public.camions_equipe (equipe_id, cle);

-- ---------- Outils ----------
create or replace function public._h(t text) returns text
language sql immutable as $$
  select encode(extensions.digest(upper(regexp_replace(coalesce(t, ''), '\s', '', 'g')), 'sha256'), 'hex')
$$;

create or replace function public.mon_equipe() returns uuid
language sql stable security definer set search_path = public as $$
  select equipe_id from membres where user_id = auth.uid() and actif
$$;

create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from equipes where id = mon_equipe() and admin_id = auth.uid())
$$;

create or replace function public._code_secret() returns text
language plpgsql volatile as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(7); r text := ''; i int;
begin
  for i in 0..6 loop
    r := r || substr(a, (get_byte(b, i) % length(a)) + 1, 1);
    if i = 2 then r := r || '-'; end if;
  end loop;
  return r;
end $$;

-- L'heure du serveur à chaque modif ; l'auteur d'un camion ne change jamais
create or replace function public._camion_maj() returns trigger
language plpgsql as $$
begin
  new.serveur_le := clock_timestamp();
  if tg_op = 'UPDATE' and coalesce(current_setting('csdc.transfert', true), '') <> '1' then
    new.auteur := old.auteur; new.auteur_prenom := old.auteur_prenom; new.equipe_id := old.equipe_id;
  end if;
  return new;
end $$;
drop trigger if exists camion_maj on public.camions_equipe;
create trigger camion_maj before insert or update on public.camions_equipe
  for each row execute function public._camion_maj();

-- ---------- Sécurité (RLS) ----------
alter table public.equipes        enable row level security;  -- aucun accès direct
alter table public.membres        enable row level security;
alter table public.camions_equipe enable row level security;

drop policy if exists membres_lire on public.membres;
create policy membres_lire on public.membres for select to authenticated
  using (equipe_id = public.mon_equipe());

drop policy if exists camions_lire on public.camions_equipe;
create policy camions_lire on public.camions_equipe for select to authenticated
  using (equipe_id = public.mon_equipe());
-- écriture uniquement par les fonctions ci-dessous (contrôle auteur / admin)

revoke all on public.equipes from anon, authenticated;
revoke all on public.membres from anon, authenticated;
revoke all on public.camions_equipe from anon, authenticated;
grant select on public.membres to authenticated;
grant select on public.camions_equipe to authenticated;

-- Changement de téléphone : même prénom = on reprend son compte (ses camions passent sur ce téléphone)
drop function if exists public._reprendre(uuid, text);
create or replace function public._reprendre(p_eq uuid, p_prenom text, p_secret boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); m membres;
begin
  select * into m from membres where equipe_id = p_eq and user_id <> u and lower(trim(prenom)) = lower(trim(p_prenom)) limit 1;
  if not found then return false; end if;
  if not m.actif then raise exception 'RETIRE'; end if;
  -- le compte de l'admin ne se reprend qu'avec son code secret
  if not p_secret and exists (select 1 from equipes where id = p_eq and admin_id = m.user_id) then raise exception 'PRENOM_PRIS'; end if;
  perform set_config('csdc.transfert', '1', true);
  update camions_equipe set auteur = u, auteur_prenom = trim(p_prenom) where equipe_id = p_eq and auteur = m.user_id;
  perform set_config('csdc.transfert', '', true);
  delete from membres where user_id = m.user_id;
  return true;
end $$;
revoke all on function public._reprendre(uuid, text, boolean) from public, anon, authenticated;

-- ---------- Rejoindre l'équipe ----------
-- Le tout premier code tapé crée l'équipe : ce téléphone devient l'administrateur (en secret).
-- Le code secret de l'admin, tapé à la place du code d'équipe, rend l'admin sur un nouveau téléphone.
create or replace function public.rejoindre(p_code text, p_prenom text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); e equipes; m membres; s text; rep boolean := false; pr text := left(trim(coalesce(p_prenom, '')), 30);
begin
  if u is null then raise exception 'NON_CONNECTE'; end if;
  if pr = '' then raise exception 'PRENOM'; end if;
  select * into m from membres where user_id = u;
  if found and not m.actif then raise exception 'RETIRE'; end if;

  select * into e from equipes where code_hash = _h(p_code);
  if found then
    rep := _reprendre(e.id, pr, false);
    insert into membres (user_id, equipe_id, prenom) values (u, e.id, pr)
      on conflict (user_id) do update set equipe_id = excluded.equipe_id, prenom = excluded.prenom, vu_le = now();
    return jsonb_build_object('equipe', e.id, 'admin', e.admin_id = u, 'repris', rep);
  end if;

  select * into e from equipes where recup_hash = _h(p_code);
  if found then
    rep := _reprendre(e.id, pr, true);
    update equipes set admin_id = u where id = e.id;
    insert into membres (user_id, equipe_id, prenom) values (u, e.id, pr)
      on conflict (user_id) do update set equipe_id = excluded.equipe_id, prenom = excluded.prenom, vu_le = now();
    return jsonb_build_object('equipe', e.id, 'admin', true, 'recup', true, 'repris', rep);
  end if;

  if exists (select 1 from equipes) then raise exception 'CODE'; end if;
  if length(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) < 4 then raise exception 'CODE_COURT'; end if;
  s := _code_secret();
  insert into equipes (code_hash, recup_hash, admin_id) values (_h(p_code), _h(s), u) returning * into e;
  insert into membres (user_id, equipe_id, prenom) values (u, e.id, pr)
    on conflict (user_id) do update set equipe_id = excluded.equipe_id, prenom = excluded.prenom, vu_le = now();
  return jsonb_build_object('equipe', e.id, 'admin', true, 'nouvelle', true, 'secret', s);
end $$;

-- ---------- Envoyer des camions ----------
-- p_fusion = true au premier branchement : un camion déjà présent (même client + réf. + jour) n'est pas doublé,
-- on garde la version la plus récente. Renvoie, pour chaque camion envoyé, son id final ou « refuse ».
create or replace function public.envoyer_camions(p_camions jsonb, p_fusion boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); eq uuid := mon_equipe(); adm boolean := est_admin(); x jsonb; r camions_equipe;
        res jsonb := '{}'::jsonb; pr text; idc text; mj timestamptz; cl text;
begin
  if eq is null then raise exception 'PAS_MEMBRE'; end if;
  select prenom into pr from membres where user_id = u;
  update membres set vu_le = now() where user_id = u;
  for x in select * from jsonb_array_elements(coalesce(p_camions, '[]'::jsonb)) loop
    idc := x->>'id'; mj := coalesce((x->>'maj_le')::timestamptz, now()); cl := nullif(x->>'cle', '');
    select * into r from camions_equipe where id = idc;
    if found then
      if r.equipe_id <> eq or (r.auteur <> u and not adm) then res := res || jsonb_build_object(idc, 'refuse'); continue; end if;
      if r.auteur <> u then
        -- l'admin ne peut que supprimer / remettre un camion d'un autre
        if mj > r.maj_le then
          update camions_equipe set supprime = coalesce((x->>'supprime')::boolean, false),
            data = jsonb_set(r.data, '{supprime}', to_jsonb(coalesce((x->>'supprime')::boolean, false))), maj_le = mj where id = idc;
        end if;
      elsif mj > r.maj_le then
        update camions_equipe set data = x->'data', cle = cl, supprime = coalesce((x->>'supprime')::boolean, false), maj_le = mj where id = idc;
      end if;
      res := res || jsonb_build_object(idc, idc); continue;
    end if;
    if p_fusion and cl is not null then
      select * into r from camions_equipe where equipe_id = eq and cle = cl and not supprime order by maj_le desc limit 1;
      if found then
        if mj > r.maj_le then
          update camions_equipe set data = jsonb_set(x->'data', '{id}', to_jsonb(r.id)), maj_le = mj where id = r.id;
        end if;
        res := res || jsonb_build_object(idc, r.id); continue;
      end if;
    end if;
    insert into camions_equipe (id, equipe_id, auteur, auteur_prenom, cle, data, supprime, maj_le)
      values (idc, eq, u, pr, cl, x->'data', coalesce((x->>'supprime')::boolean, false), mj);
    res := res || jsonb_build_object(idc, idc);
  end loop;
  return res;
end $$;

-- ---------- Réglages communs (sections, volumes, étages) ----------
create or replace function public.lire_reglages() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('reglages', reglages, 'le', reglages_le, 'admin', admin_id = auth.uid())
  from equipes where id = mon_equipe()
$$;

create or replace function public.ecrire_reglages(p jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if not est_admin() then raise exception 'ADMIN'; end if;
  update equipes set reglages = coalesce(p, '{}'::jsonb), reglages_le = t where id = mon_equipe();
  return t;
end $$;

-- ---------- Administration (réservé à l'admin) ----------
create or replace function public.changer_code(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'ADMIN'; end if;
  if length(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) < 4 then raise exception 'CODE_COURT'; end if;
  if exists (select 1 from equipes where code_hash = _h(p_code) and id <> mon_equipe()) or exists (select 1 from equipes where recup_hash = _h(p_code)) then raise exception 'CODE_PRIS'; end if;
  update equipes set code_hash = _h(p_code) where id = mon_equipe();
  return true;
end $$;

create or replace function public.nouveau_secret() returns text
language plpgsql security definer set search_path = public as $$
declare s text := _code_secret();
begin
  if not est_admin() then raise exception 'ADMIN'; end if;
  update equipes set recup_hash = _h(s) where id = mon_equipe();
  return s;
end $$;

create or replace function public.definir_secret(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'ADMIN'; end if;
  if length(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) < 6 then raise exception 'SECRET_COURT'; end if;
  if exists (select 1 from equipes where code_hash = _h(p_code)) or exists (select 1 from equipes where recup_hash = _h(p_code) and id <> mon_equipe()) then raise exception 'CODE_PRIS'; end if;
  update equipes set recup_hash = _h(p_code) where id = mon_equipe();
  return true;
end $$;

create or replace function public.retirer_membre(p_user uuid, p_actif boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not est_admin() then raise exception 'ADMIN'; end if;
  if p_user = auth.uid() then raise exception 'SOI_MEME'; end if;
  delete from membres where user_id = p_user and equipe_id = mon_equipe();
  return true;
end $$;

create or replace function public.changer_prenom(p_prenom text) returns boolean
language plpgsql security definer set search_path = public as $$
declare pr text := left(trim(coalesce(p_prenom, '')), 30);
begin
  if pr = '' then raise exception 'PRENOM'; end if;
  if exists (select 1 from membres where equipe_id = mon_equipe() and user_id <> auth.uid() and lower(trim(prenom)) = lower(pr)) then raise exception 'PRENOM_PRIS'; end if;
  update membres set prenom = pr where user_id = auth.uid();
  update camions_equipe set auteur_prenom = pr where auteur = auth.uid();
  return true;
end $$;

revoke all on function public.rejoindre(text, text), public.envoyer_camions(jsonb, boolean), public.lire_reglages(),
  public.ecrire_reglages(jsonb), public.changer_code(text), public.nouveau_secret(), public.definir_secret(text), public.retirer_membre(uuid, boolean),
  public.changer_prenom(text), public.mon_equipe(), public.est_admin() from public, anon;
grant execute on function public.rejoindre(text, text), public.envoyer_camions(jsonb, boolean), public.lire_reglages(),
  public.ecrire_reglages(jsonb), public.changer_code(text), public.nouveau_secret(), public.definir_secret(text), public.retirer_membre(uuid, boolean),
  public.changer_prenom(text), public.mon_equipe(), public.est_admin() to authenticated;
