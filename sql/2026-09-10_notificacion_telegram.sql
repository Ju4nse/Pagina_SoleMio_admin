-- 2026-09-10_notificacion_telegram.sql
-- Avisa por Telegram al dueño cada vez que un cliente confirma un
-- pedido nuevo. Reemplaza el aviso anterior por WhatsApp (CallMeBot,
-- sql/2026-09-06_notificacion_callmebot.sql) — usa el mismo nombre de
-- función y de trigger, así que correr este script deja a Telegram
-- como único canal de aviso (no hace falta borrar nada a mano).
--
-- ANTES DE CORRER ESTE SCRIPT hay que crear el bot y conseguir dos
-- datos (gratis, unos minutos):
--
--   1. TOKEN DEL BOT
--      - Abrí Telegram y buscá el contacto "BotFather" (verificado,
--        con el ✅ azul).
--      - Mandale /newbot y seguí los pasos: un nombre para mostrar
--        (ej. "SoleMio Avisos") y un "username" único que tiene que
--        terminar en "bot" (ej. SoleMioAvisosBot).
--      - Te va a contestar con un mensaje que incluye un token con
--        forma "123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".
--        Ese es el TOKEN — no lo compartas, da control total del bot.
--
--   2. CHAT_ID DEL DUEÑO
--      - Desde el Telegram del DUEÑO (la cuenta que tiene que recibir
--        los avisos), buscá el bot recién creado por su username y
--        mandale cualquier mensaje (ej. "hola"). Esto es necesario:
--        un bot no le puede escribir primero a nadie.
--      - Después, desde cualquier navegador, abrí (reemplazando
--        TOKEN por el de arriba, tal cual, sin espacios):
--          https://api.telegram.org/botTOKEN/getUpdates
--      - En el JSON de respuesta buscá "chat":{"id": ...} — ese
--        número (puede ser negativo) es el CHAT_ID.
--
-- Con esos dos datos, reemplazá los placeholders de abajo:
--   telegram_bot_token -> el TOKEN de BotFather
--   telegram_chat_id   -> el CHAT_ID del dueño
--
-- Se puede volver a correr este script (reemplazando los valores) si
-- alguna vez cambia el bot o el chat — el "create or replace" y el
-- "drop trigger if exists" lo hacen seguro de repetir.

create extension if not exists pg_net;

create or replace function public.notificar_pedido_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  telegram_bot_token text := 'TU_TOKEN_ACA';    -- <-- REEMPLAZAR
  telegram_chat_id   text := 'TU_CHAT_ID_ACA';  -- <-- REEMPLAZAR
  mensaje text;
begin
  mensaje := '🛍️ Nuevo pedido de ' || new.cliente_nombre
    || ' (' || new.cliente_telefono || ')'
    || ' — estimado $' || round(new.monto_estimado)::text
    || coalesce(' — nota: ' || new.nota, '')
    || '. Revisalo en pedidos.html';

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || telegram_bot_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'chat_id', telegram_chat_id,
      'text',    mensaje
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
-- 2) Si no llega el mensaje de Telegram, revisá qué contestó la API
--    corriendo:
--      select * from net._http_response order by id desc limit 5;
--    (la columna "content" trae el error si algo salió mal, ej. un
--    token incorrecto o un chat_id mal escrito).
