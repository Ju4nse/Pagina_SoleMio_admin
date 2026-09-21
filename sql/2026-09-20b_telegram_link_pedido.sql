-- 2026-09-20b_telegram_link_pedido.sql
-- El aviso de Telegram de pedido nuevo ahora trae un botón "Abrir
-- pedido" que va directo a pedidos.html?id=<pedido> (la página abre el
-- modal de edición de ese pedido; si no hay sesión de admin, pasa por
-- el login y vuelve al pedido).
--
-- Además el token del bot y el chat_id dejan de estar escritos adentro
-- de la función: pasan a Supabase Vault (secretos encriptados), así este
-- archivo nunca necesita los valores reales y cambiar de chat (ej. pasar
-- los avisos del teléfono de Juanse al del dueño) es solo:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'telegram_chat_id'),
--     'NUEVO_CHAT_ID'
--   );
--
-- PASO 1 (automático): si todavía no existen los secretos en Vault, los
-- copia de la versión anterior de notificar_pedido_nuevo() (la de
-- 2026-09-10_notificacion_telegram.sql, que los tenía escritos adentro).
-- Si la función anterior tenía los placeholders sin reemplazar, avisa y
-- hay que crearlos a mano:
--
--   select vault.create_secret('TOKEN_DE_BOTFATHER', 'telegram_bot_token');
--   select vault.create_secret('CHAT_ID',            'telegram_chat_id');
--
-- Se puede volver a correr sin problema.

do $$
declare
  def   text;
  token text;
  chat  text;
begin
  if exists (select 1 from vault.secrets where name = 'telegram_bot_token')
     and exists (select 1 from vault.secrets where name = 'telegram_chat_id') then
    raise notice 'Los secretos de Telegram ya están en Vault, no se tocan.';
    return;
  end if;

  select pg_get_functiondef('public.notificar_pedido_nuevo()'::regprocedure) into def;
  token := substring(def from 'telegram_bot_token\s+text\s*:=\s*''([^'']*)''');
  chat  := substring(def from 'telegram_chat_id\s+text\s*:=\s*''([^'']*)''');

  if token is null or chat is null or token = 'TU_TOKEN_ACA' or chat = 'TU_CHAT_ID_ACA' then
    raise warning 'No se encontraron el token/chat_id reales en la función anterior: crealos a mano con vault.create_secret (ver arriba).';
    return;
  end if;

  if not exists (select 1 from vault.secrets where name = 'telegram_bot_token') then
    perform vault.create_secret(token, 'telegram_bot_token', 'Token del bot de avisos de pedidos (BotFather)');
  end if;
  if not exists (select 1 from vault.secrets where name = 'telegram_chat_id') then
    perform vault.create_secret(chat, 'telegram_chat_id', 'Chat de Telegram que recibe los avisos de pedidos');
  end if;
end;
$$;

-- PASO 2: la función nueva, que lee los secretos de Vault.
create or replace function public.notificar_pedido_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  telegram_bot_token text;
  telegram_chat_id   text;
  link    text;
  mensaje text;
begin
  select decrypted_secret into telegram_bot_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into telegram_chat_id   from vault.decrypted_secrets where name = 'telegram_chat_id';

  -- Sin secretos cargados no se avisa, pero el pedido se guarda igual
  -- (nunca bloquear la compra de un cliente por el aviso).
  if telegram_bot_token is null or telegram_chat_id is null then
    raise warning 'notificar_pedido_nuevo: faltan los secretos de Telegram en Vault';
    return new;
  end if;

  link := 'https://solemiocatalogo.juansegundofrias.workers.dev/pedidos.html?id=' || new.id::text;

  mensaje := '🛍️ Nuevo pedido de ' || new.cliente_nombre
    || ' (' || new.cliente_telefono || ')'
    || ' — estimado $' || round(new.monto_estimado)::text
    || coalesce(' — nota: ' || new.nota, '')
    || E'\n\n' || link;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || telegram_bot_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'chat_id', telegram_chat_id,
      'text',    mensaje,
      -- el link del texto ya alcanza, sin la vista previa grande
      'link_preview_options', jsonb_build_object('is_disabled', true),
      'reply_markup', jsonb_build_object(
        'inline_keyboard', jsonb_build_array(jsonb_build_array(
          jsonb_build_object('text', 'Abrir pedido', 'url', link)
        ))
      )
    )
  );

  return new;
end;
$$;

-- "create or replace" conserva los permisos, pero por las dudas se
-- repite lo de 2026-09-16b_arreglos_advisors.sql: nadie la llama
-- directo, solo el trigger.
revoke execute on function public.notificar_pedido_nuevo() from public, anon, authenticated;

-- El trigger ya existe (2026-09-10_notificacion_telegram.sql) y sigue
-- apuntando a esta misma función: no hace falta recrearlo.

-- ── PARA PROBAR ─────────────────────────────────────────────────
-- Hacé un pedido de prueba desde el catálogo. Si no llega el aviso:
--   select * from net._http_response order by id desc limit 5;
