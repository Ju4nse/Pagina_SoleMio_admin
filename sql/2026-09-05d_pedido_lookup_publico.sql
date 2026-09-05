-- ================================================================
-- Consulta pública de un pedido por su ID (para que el cliente pueda
-- ver el estado de su pedido en la página, sin necesitar cuenta).
--
-- No se toca RLS de las tablas (pedidos/pedido_items siguen siendo
-- admin-only para SELECT directo). En cambio, se agregan dos
-- funciones SECURITY DEFINER que devuelven UN pedido puntual por su
-- id exacto — no permiten listar ni buscar, solo "si conocés el id,
-- lo podés ver" (mismo modelo de seguridad que un link de Google
-- Docs: el UUID es la clave, no hace falta login).
-- ================================================================

create or replace function public.obtener_pedido_publico(p_pedido_id uuid)
returns table (
  id             uuid,
  cliente_nombre text,
  estado         text,
  monto_estimado numeric,
  monto_final    numeric,
  nota           text,
  created_at     timestamptz,
  confirmado_at  timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.cliente_nombre, p.estado, p.monto_estimado, p.monto_final,
         p.nota, p.created_at, p.confirmado_at
  from public.pedidos p
  where p.id = p_pedido_id;
$$;

create or replace function public.obtener_pedido_items_publico(p_pedido_id uuid)
returns table (
  id              bigint,
  producto_nombre text,
  talle           text,
  color           text,
  cantidad        int,
  precio_unitario numeric,
  disponible      boolean,
  talle_final     text,
  color_final     text,
  cantidad_final  int
)
language sql
security definer
set search_path = public
as $$
  select i.id, i.producto_nombre, i.talle, i.color, i.cantidad, i.precio_unitario,
         i.disponible, i.talle_final, i.color_final, i.cantidad_final
  from public.pedido_items i
  where i.pedido_id = p_pedido_id;
$$;

grant execute on function public.obtener_pedido_publico(uuid)       to anon, authenticated;
grant execute on function public.obtener_pedido_items_publico(uuid) to anon, authenticated;
