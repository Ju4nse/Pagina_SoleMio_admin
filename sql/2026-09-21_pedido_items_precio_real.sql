-- 2026-09-21_pedido_items_precio_real.sql
-- El precio de cada ítem de un pedido lo manda el navegador del cliente
-- (pedido_items.precio_unitario, ver enviarPedidoSupabase en carrito.js),
-- y la base lo aceptaba tal cual: cualquiera con las herramientas del
-- navegador podía mandar un pedido con precio_unitario = 1, y el panel
-- de admin (y el mensaje de WhatsApp con el "Total a pagar") usaban ese
-- número.
--
-- Con esto, al insertar un ítem la base pone el precio real, calculado
-- igual que en el frontend:
--   precio del talle+color exacto en producto_talles (si tiene precio
--   propio) o, si no, productos.precio — por 1.5, redondeado.
-- Si el producto no existe se deja el precio que vino (el admin revisa
-- cada pedido igual). Los pedidos que carga un admin a mano ("Nuevo
-- pedido" en pedidos.html) no se tocan.
--
-- Además, después de insertar los ítems, recalcula pedidos.monto_estimado
-- con esos precios (también venía del navegador).

create or replace function public.pedido_items_precio_real()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base numeric;
begin
  if exists (select 1 from admins where admins.email = ((select auth.jwt()) ->> 'email')) then
    return new;
  end if;

  select pt.precio into base
  from producto_talles pt
  where pt.producto_id = new.producto_id
    and pt.talle = new.talle
    and pt.color = new.color
    and pt.precio is not null
  limit 1;

  if base is null then
    select p.precio into base from productos p where p.id = new.producto_id;
  end if;

  if base is not null and base > 0 then
    new.precio_unitario := round(base * 1.5);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pedido_items_precio_real on public.pedido_items;
create trigger trg_pedido_items_precio_real
  before insert on public.pedido_items
  for each row
  execute function public.pedido_items_precio_real();

create or replace function public.pedidos_recalcular_monto_estimado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update pedidos p
  set monto_estimado = (
    select coalesce(sum(i.precio_unitario * i.cantidad), 0)
    from pedido_items i
    where i.pedido_id = p.id
  )
  where p.id in (select distinct pedido_id from nuevos);
  return null;
end;
$$;

drop trigger if exists trg_pedidos_recalcular_monto_estimado on public.pedido_items;
create trigger trg_pedidos_recalcular_monto_estimado
  after insert on public.pedido_items
  referencing new table as nuevos
  for each statement
  execute function public.pedidos_recalcular_monto_estimado();

-- Solo las usan los triggers: nadie las llama por /rest/v1/rpc.
revoke execute on function public.pedido_items_precio_real()          from public, anon, authenticated;
revoke execute on function public.pedidos_recalcular_monto_estimado() from public, anon, authenticated;
