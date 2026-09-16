-- 2026-09-16_instagram_inbox.sql
-- Bandeja de mensajes directos de Instagram (@solemio.tandil) dentro
-- del panel admin (mensajes.html). Ver INSTAGRAM.md para el paso a paso
-- completo (app de Meta, Edge Functions, webhook).
--
-- Quién escribe acá: SOLO las Edge Functions de supabase/functions/
-- (ig-webhook, ig-send, ig-sync, ig-refresh), con la service role key,
-- que saltea RLS. Los admins solo leen y marcan como leído desde el
-- navegador. No hay ninguna policy de insert: ni un invitado ni un
-- admin puede inventar mensajes desde el cliente.
--
-- Se puede volver a correr entero sin romper nada (if not exists /
-- create or replace / drop policy if exists).

-- ── CONVERSACIONES — una por cliente de Instagram ────────────────
create table if not exists public.ig_conversaciones (
  id                    uuid primary key default gen_random_uuid(),
  -- IGSID: id del cliente "visto desde" nuestra cuenta. Es lo que
  -- Instagram manda en sender/recipient y lo que pide para responder.
  igsid                 text not null unique,
  username              text,
  nombre                text,
  foto_url              text,          -- vence a los pocos días (URL de CDN de Meta)
  perfil_actualizado_en timestamptz,
  ultimo_mensaje_texto  text,
  ultimo_mensaje_en     timestamptz,
  -- Último mensaje DEL CLIENTE: Instagram solo deja responder por API
  -- dentro de las 24 h siguientes a este momento.
  ultimo_entrante_en    timestamptz,
  no_leidos             integer not null default 0,
  creado_en             timestamptz not null default now()
);

create index if not exists ig_conversaciones_ultimo_mensaje_idx
  on public.ig_conversaciones (ultimo_mensaje_en desc nulls last);

-- ── MENSAJES ─────────────────────────────────────────────────────
create table if not exists public.ig_mensajes (
  id              bigint generated always as identity primary key,
  conversacion_id uuid not null references public.ig_conversaciones(id) on delete cascade,
  -- Id del mensaje en Meta. Unique = idempotencia: Meta reintenta los
  -- webhooks hasta ~36 h, y el mismo mensaje puede llegar también por
  -- ig-send (lo mandamos nosotros) + su "eco" por el webhook.
  mid             text not null unique,
  direccion       text not null check (direccion in ('entrante', 'saliente')),
  texto           text,
  -- [{ "tipo": "image" | "video" | "audio" | "file" | "share" | "story_mention" | "respuesta_historia" | ..., "url": "https://..." }]
  -- Las URLs vencen a los pocos días: el panel muestra "adjunto vencido".
  adjuntos        jsonb not null default '[]'::jsonb,
  respuesta_a     text,                -- mid del mensaje al que responde, si aplica
  es_eco          boolean not null default false,  -- llegó como eco del webhook
  enviado_por     text,                -- email del admin si salió desde el panel; null si fue desde la app de IG
  eliminado       boolean not null default false,  -- el cliente lo borró ("anular envío")
  enviado_en      timestamptz not null,
  creado_en       timestamptz not null default now()
);

create index if not exists ig_mensajes_conversacion_idx
  on public.ig_mensajes (conversacion_id, enviado_en);

-- ── CONFIG (token de acceso) ─────────────────────────────────────
-- Clave/valor. El token de Instagram vence a los 60 días y ig-refresh
-- lo renueva: por eso vive en una tabla y no en los secrets de la Edge
-- Function (una función no puede reescribir sus propios secrets).
-- RLS activado y SIN policies → nadie desde el navegador lo puede leer,
-- ni siquiera un admin. Solo la service role key.
create table if not exists public.ig_config (
  clave          text primary key,
  valor          text not null,
  actualizado_en timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────────
alter table public.ig_conversaciones enable row level security;
alter table public.ig_mensajes       enable row level security;
alter table public.ig_config         enable row level security;

revoke all on public.ig_config from anon, authenticated;

drop policy if exists "ig_conversaciones_select_admin" on public.ig_conversaciones;
create policy "ig_conversaciones_select_admin" on public.ig_conversaciones
  for select using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

-- Update: el panel lo usa para marcar la conversación como leída
-- (no_leidos = 0).
drop policy if exists "ig_conversaciones_update_admin" on public.ig_conversaciones;
create policy "ig_conversaciones_update_admin" on public.ig_conversaciones
  for update using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')))
  with check (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

drop policy if exists "ig_mensajes_select_admin" on public.ig_mensajes;
create policy "ig_mensajes_select_admin" on public.ig_mensajes
  for select using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

-- ── REGISTRAR UN MENSAJE (lo llaman las Edge Functions) ──────────
-- Hace todo en una sola transacción: crea la conversación si no existe,
-- inserta el mensaje (ignorando duplicados por mid) y actualiza el
-- resumen de la conversación SOLO si el mensaje era nuevo — así un
-- reintento de Meta no suma dos veces al contador de no leídos.
--
-- Deduplicación extra entre "lo mandé desde el panel" (ig-send) y "el
-- eco de ese mismo mensaje" (webhook): lo normal es que traigan el mismo
-- mid y el unique lo resuelva, pero si alguna vez Meta los manda con mid
-- distinto, se matchean por mismo texto en la misma conversación con
-- menos de 60 s de diferencia. Llegue primero cualquiera de los dos,
-- queda un solo mensaje y con el email del admin en enviado_por.
create or replace function public.ig_registrar_mensaje(
  p_igsid           text,
  p_mid             text,
  p_direccion       text,
  p_texto           text,
  p_adjuntos        jsonb,
  p_respuesta_a     text,
  p_es_eco          boolean,
  p_enviado_por     text,
  p_enviado_en      timestamptz,
  p_sumar_no_leido  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv      uuid;
  v_insertado integer := 0;
  v_gemelo    bigint;
begin
  insert into ig_conversaciones (igsid) values (p_igsid)
  on conflict (igsid) do nothing;

  select id into v_conv from ig_conversaciones where igsid = p_igsid;

  if p_direccion = 'saliente' and not exists (select 1 from ig_mensajes where mid = p_mid) then
    if p_es_eco then
      -- Eco de algo que ya registró ig-send con otro mid
      select id into v_gemelo from ig_mensajes
      where conversacion_id = v_conv and direccion = 'saliente'
        and es_eco = false and enviado_por is not null
        and texto is not distinct from p_texto
        and abs(extract(epoch from (enviado_en - p_enviado_en))) < 60
      limit 1;
      if v_gemelo is not null then
        return jsonb_build_object('conversacion_id', v_conv, 'insertado', false);
      end if;
    elsif p_enviado_por is not null then
      -- ig-send llega después de que ya entró el eco con otro mid
      select id into v_gemelo from ig_mensajes
      where conversacion_id = v_conv and direccion = 'saliente'
        and es_eco = true and enviado_por is null
        and texto is not distinct from p_texto
        and abs(extract(epoch from (enviado_en - p_enviado_en))) < 60
      limit 1;
      if v_gemelo is not null then
        update ig_mensajes set enviado_por = p_enviado_por where id = v_gemelo;
        return jsonb_build_object('conversacion_id', v_conv, 'insertado', false);
      end if;
    end if;
  end if;

  insert into ig_mensajes (conversacion_id, mid, direccion, texto, adjuntos,
                           respuesta_a, es_eco, enviado_por, enviado_en)
  values (v_conv, p_mid, p_direccion, p_texto, coalesce(p_adjuntos, '[]'::jsonb),
          p_respuesta_a, coalesce(p_es_eco, false), p_enviado_por, p_enviado_en)
  on conflict (mid) do nothing;

  get diagnostics v_insertado = row_count;

  if v_insertado > 0 then
    update ig_conversaciones set
      ultimo_mensaje_texto = case
        when ultimo_mensaje_en is null or p_enviado_en >= ultimo_mensaje_en
          then coalesce(nullif(p_texto, ''), '📎 Adjunto')
        else ultimo_mensaje_texto end,
      ultimo_mensaje_en = greatest(coalesce(ultimo_mensaje_en, p_enviado_en), p_enviado_en),
      ultimo_entrante_en = case
        when p_direccion = 'entrante'
          then greatest(coalesce(ultimo_entrante_en, p_enviado_en), p_enviado_en)
        else ultimo_entrante_en end,
      no_leidos = no_leidos + case
        when p_direccion = 'entrante' and p_sumar_no_leido then 1 else 0 end
    where id = v_conv;
  elsif p_enviado_por is not null then
    -- Mismo mid ya cargado por el eco: completar quién lo mandó
    update ig_mensajes set enviado_por = coalesce(enviado_por, p_enviado_por)
    where mid = p_mid;
  end if;

  return jsonb_build_object('conversacion_id', v_conv, 'insertado', v_insertado > 0);
end;
$$;

revoke all on function public.ig_registrar_mensaje(text, text, text, text, jsonb, text, boolean, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.ig_registrar_mensaje(text, text, text, text, jsonb, text, boolean, text, timestamptz, boolean) to service_role;

-- ── ESTADO DEL TOKEN (para el aviso del panel) ───────────────────
-- Devuelve solo CUÁNDO se cargó/renovó el token, nunca el token. Si
-- quien llama no es admin devuelve null.
create or replace function public.ig_estado_token()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select actualizado_en from ig_config
  where clave = 'access_token'
    and exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email'));
$$;

revoke all on function public.ig_estado_token() from public, anon;
grant execute on function public.ig_estado_token() to authenticated;

-- ── REALTIME ─────────────────────────────────────────────────────
-- El panel y el aviso de la topbar escuchan inserts/updates en vivo.
-- Realtime respeta RLS: solo los admins reciben los eventos.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ig_conversaciones') then
    alter publication supabase_realtime add table public.ig_conversaciones;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ig_mensajes') then
    alter publication supabase_realtime add table public.ig_mensajes;
  end if;
end;
$$;

-- ── CARGAR EL TOKEN (a mano, NO en este archivo) ─────────────────
-- Una vez generado el token en Meta (ver INSTAGRAM.md), correr esto
-- en el SQL Editor reemplazando el valor. Nunca commitear el token real.
--
--   insert into public.ig_config (clave, valor, actualizado_en)
--   values ('access_token', 'TU_TOKEN_ACA', now())
--   on conflict (clave) do update
--     set valor = excluded.valor, actualizado_en = now();
