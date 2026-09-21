-- 2026-09-20_pedido_items_colores_opciones.sql
-- Al revisar un pedido, el admin puede ofrecerle al cliente VARIOS
-- colores disponibles para el talle que pidió (ej. pidió Negro, no hay,
-- pero hay Blanco y Nude), en vez de cambiarle a un solo color.
--
--   colores_opciones: los colores ofrecidos, cuando son 2 o más. null si
--   no se ofrecieron varios. Cuando se elige un solo color distinto se
--   sigue usando color_final, como hasta ahora.
--
-- También se actualiza obtener_pedido_items_publico para que el cliente
-- vea esas opciones en pedido-estado.html. Hay que dropearla (cambia el
-- tipo de retorno, "create or replace" no alcanza) y volver a dar los
-- permisos de 2026-09-05d_pedido_lookup_publico.sql.
--
-- Correr ANTES de subir el código que usa la columna.

alter table public.pedido_items add column if not exists colores_opciones text[];

drop function if exists public.obtener_pedido_items_publico(uuid);

create function public.obtener_pedido_items_publico(p_pedido_id uuid)
returns table (
  id bigint, producto_nombre text, talle text, color text, cantidad integer,
  precio_unitario numeric, disponible boolean,
  talle_final text, color_final text, cantidad_final integer,
  colores_opciones text[]
)
language sql
security definer
set search_path = public
as $$
  select i.id, i.producto_nombre, i.talle, i.color, i.cantidad, i.precio_unitario,
         i.disponible, i.talle_final, i.color_final, i.cantidad_final,
         i.colores_opciones
  from public.pedido_items i
  where i.pedido_id = p_pedido_id;
$$;

revoke execute on function public.obtener_pedido_items_publico(uuid) from public;
grant  execute on function public.obtener_pedido_items_publico(uuid) to anon, authenticated;
