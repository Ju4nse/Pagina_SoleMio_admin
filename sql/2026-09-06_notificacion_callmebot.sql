-- 2026-09-06_notificacion_callmebot.sql
-- Avisa por WhatsApp al dueño (vía CallMeBot) cada vez que un cliente
-- confirma un pedido nuevo. No hace falta backend propio: un trigger
-- de Postgres llama directo a la API de CallMeBot usando pg_net
-- (extensión ya disponible en Supabase).
--
-- ANTES DE CORRER ESTE SCRIPT hay que conseguir el apikey (una sola
-- vez, gratis, dos minutos):
--   1. Desde el WhatsApp del DUEÑO, agregá el contacto:
--        +34 644 71 91 92   (número oficial de CallMeBot)
--   2. Mandale por WhatsApp, tal cual, el mensaje:
--        I allow callmebot to send me messages
--   3. En un par de minutos responde con un mensaje que incluye un
--      número (ej. "Your APIKEY is 123456"). Ese número es el apikey.
--
-- Con eso, reemplazá los dos placeholders de abajo:
--   telefono_duenio  -> el WhatsApp del dueño, con código de país y
--                       área, SIN "+", SIN espacios ni guiones.
--                       Ej: Argentina 2494 xxx-xxx -> '54924942xxxxx'
--   apikey_callmebot -> el número que le contestó CallMeBot
--
-- Se puede volver a correr este script (reemplazando los valores) si
-- alguna vez cambia el número o el apikey — el "create or replace" y
-- el "drop trigger if exists" lo hacen seguro de repetir.

create extension if not exists pg_net;

create or replace function public.notificar_pedido_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  telefono_duenio  text := '5492494XXXXXX';   -- <-- REEMPLAZAR
  apikey_callmebot text := 'TU_APIKEY_ACA';   -- <-- REEMPLAZAR
  mensaje text;
begin
  mensaje := '🛍️ Nuevo pedido de ' || new.cliente_nombre
    || ' (' || new.cliente_telefono || ')'
    || ' — estimado $' || round(new.monto_estimado)::text
    || coalesce(' — nota: ' || new.nota, '')
    || '. Revisalo en pedidos.html';

  perform net.http_get(
    url    := 'https://api.callmebot.com/whatsapp.php',
    params := jsonb_build_object(
      'phone',  telefono_duenio,
      'apikey', apikey_callmebot,
      'text',   mensaje
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notificar_pedido_nuevo on public.pedidos;
create trigger trg_notificar_pedido_nuevo
  after insert on public.pedidos
  for each row
  execute function public.notificar_pedido_nuevo();

-- ── PARA PROBAR QUE FUNCIONA ────────────────────────────────────
-- 1) Hacé un pedido de prueba real desde el catálogo (como invitado).
-- 2) Si no llega el WhatsApp, revisá qué contestó CallMeBot corriendo:
--      select * from net._http_response order by id desc limit 5;
--    (la columna "content" trae el error si algo salió mal, ej. un
--    apikey incorrecto o el número mal escrito).
