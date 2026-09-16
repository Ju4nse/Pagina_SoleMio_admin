-- 2026-09-16b_instagram_refresh_cron.sql
-- Renueva solo el token de Instagram una vez por semana. El token dura
-- 60 días; si nadie lo renueva, vence y la bandeja deja de funcionar
-- hasta que la dueña genere uno nuevo en Meta.
--
-- Correr DESPUÉS de:
--   1. 2026-09-16_instagram_inbox.sql
--   2. desplegar la Edge Function ig-refresh (ver INSTAGRAM.md)
--   3. definir el secret CRON_SECRET en Supabase
--      (npx supabase secrets set CRON_SECRET=...)
--
-- Reemplazar TU_CRON_SECRET_ACA por ese MISMO valor al pegar esto en el
-- SQL Editor — nunca commitear el valor real. Se puede volver a correr:
-- cron.schedule con el mismo nombre reemplaza el job anterior.
--
-- Ojo: Instagram solo acepta renovar tokens con más de 24 h de vida, así
-- que si el token se cargó hoy, la primera corrida puede fallar y la
-- siguiente (una semana después) ya funciona.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ig-refresh-token',
  '0 9 * * 1',   -- lunes 09:00 UTC (06:00 en Argentina)
  $$
  select net.http_post(
    url     := 'https://pktwpktmxbfapwjsugrx.supabase.co/functions/v1/ig-refresh',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', 'TU_CRON_SECRET_ACA'   -- <-- REEMPLAZAR
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── PARA PROBAR ─────────────────────────────────────────────────
-- Forzar una corrida ya mismo (mismo request que hace el cron):
--   select net.http_post(
--     url := 'https://pktwpktmxbfapwjsugrx.supabase.co/functions/v1/ig-refresh',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','TU_CRON_SECRET_ACA'),
--     body := '{}'::jsonb);
-- Ver la respuesta:
--   select * from net._http_response order by id desc limit 5;
-- Ver que el token se actualizó:
--   select clave, actualizado_en from public.ig_config;
