-- 2026-09-21b_telegram_aviso_total_corregido.sql
-- El aviso de Telegram salía al crear el pedido (AFTER INSERT en
-- pedidos), antes de que se cargaran los ítems: el "estimado" del
-- mensaje era el que mandó el navegador, no el que corrige
-- 2026-09-21_pedido_items_precio_real.sql.
--
-- Ahora el aviso sale después de insertar los ítems, en el mismo trigger
-- que recalcula pedidos.monto_estimado, así el mensaje ya trae el total
-- corregido. Tanto el carrito (carrito.js) como "Nuevo pedido" del admin
-- (pedidos.js) insertan el pedido y después todos sus ítems en un solo
-- insert, así que sale un aviso por pedido.
--
-- Si más adelante alguien agrega ítems a un pedido que ya tenía, no se
-- vuelve a avisar (solo se avisa si todos los ítems del pedido son de
-- este mismo insert).
--
-- Contra: si el insert de los ítems falla, ese pedido queda sin aviso
-- (antes avisaba igual). Un pedido sin ítems no se puede revisar de todas
-- formas.
--
-- Requiere 2026-09-20b_telegram_link_pedido.sql (secretos en Vault) y
-- 2026-09-21_pedido_items_precio_real.sql.

-- 1. El armado y envío del mensaje, como función aparte (antes vivía
--    adentro del trigger de pedidos).
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

  link := 'https://solemiocatalogo.juansegundofrias.workers.dev/pedidos.html?id=' || p.id::text;

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

-- 2. El trigger de los ítems: recalcula el total y después avisa.
create or replace function public.pedidos_recalcular_monto_estimado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  update pedidos p
  set monto_estimado = (
    select coalesce(sum(i.precio_unitario * i.cantidad), 0)
    from pedido_items i
    where i.pedido_id = p.id
  )
  where p.id in (select distinct pedido_id from nuevos);

  -- Aviso de Telegram, ya con el total corregido. Solo para pedidos cuyos
  -- ítems son todos de este insert (el primero): si después se agregan
  -- más, no se vuelve a avisar.
  for pid in
    select distinct n.pedido_id from nuevos n
    where not exists (
      select 1 from pedido_items i
      where i.pedido_id = n.pedido_id
        and i.id not in (select id from nuevos)
    )
  loop
    perform avisar_pedido_telegram(pid);
  end loop;

  return null;
end;
$$;

-- 3. Se saca el aviso viejo (al crear el pedido, sin ítems todavía).
drop trigger if exists trg_notificar_pedido_nuevo on public.pedidos;
drop function if exists public.notificar_pedido_nuevo();

-- Solo las usan los triggers: nadie las llama por /rest/v1/rpc.
revoke execute on function public.avisar_pedido_telegram(uuid)          from public, anon, authenticated;
revoke execute on function public.pedidos_recalcular_monto_estimado()   from public, anon, authenticated;

-- ── PARA PROBAR ─────────────────────────────────────────────────
-- Hacé un pedido de prueba desde el catálogo. Si no llega el aviso:
--   select * from net._http_response order by id desc limit 5;
