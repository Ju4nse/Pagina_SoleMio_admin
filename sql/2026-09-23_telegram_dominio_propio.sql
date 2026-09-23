-- 2026-09-23_telegram_dominio_propio.sql
-- El sitio pasó a su dominio propio (solemiotandil.com.ar). El botón
-- "Abrir pedido" del aviso de Telegram seguía llevando a la dirección
-- vieja (solemiocatalogo.juansegundofrias.workers.dev).
--
-- Es la misma función de 2026-09-21b_telegram_aviso_total_corregido.sql,
-- sin cambios salvo el link. Los archivos viejos quedan como estaban
-- (son historia: ya se corrieron).
--
-- Se puede volver a correr sin problema.

create or replace function public.avisar_pedido_telegram(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  telegram_bot_token text;
  telegram_chat_id   text;
  p       public.pedidos%rowtype;
  link    text;
  mensaje text;
begin
  select * into p from pedidos where id = p_pedido_id;
  if not found then return; end if;

  select decrypted_secret into telegram_bot_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into telegram_chat_id   from vault.decrypted_secrets where name = 'telegram_chat_id';

  -- Sin secretos cargados no se avisa, pero el pedido se guarda igual
  -- (nunca bloquear la compra de un cliente por el aviso).
  if telegram_bot_token is null or telegram_chat_id is null then
    raise warning 'avisar_pedido_telegram: faltan los secretos de Telegram en Vault';
    return;
  end if;

  link := 'https://solemiotandil.com.ar/pedidos.html?id=' || p.id::text;

  mensaje := '🛍️ Nuevo pedido de ' || p.cliente_nombre
    || ' (' || p.cliente_telefono || ')'
    || ' — estimado $' || round(p.monto_estimado)::text
    || coalesce(' — nota: ' || p.nota, '')
    || E'\n\n' || link;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || telegram_bot_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'chat_id', telegram_chat_id,
      'text',    mensaje,
      'link_preview_options', jsonb_build_object('is_disabled', true),
      'reply_markup', jsonb_build_object(
        'inline_keyboard', jsonb_build_array(jsonb_build_array(
          jsonb_build_object('text', 'Abrir pedido', 'url', link)
        ))
      )
    )
  );
end;
$$;

-- "create or replace" conserva los permisos, pero por las dudas: solo la
-- usa el trigger de pedido_items, nadie la llama por /rest/v1/rpc.
revoke execute on function public.avisar_pedido_telegram(uuid) from public, anon, authenticated;

-- ── PARA VERIFICAR ──────────────────────────────────────────────
-- Tiene que devolver el dominio nuevo:
--   select substring(pg_get_functiondef('public.avisar_pedido_telegram(uuid)'::regprocedure)
--                    from 'https://[^/]+/pedidos');
