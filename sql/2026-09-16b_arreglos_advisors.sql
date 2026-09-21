-- 2026-09-16b_arreglos_advisors.sql
-- Arreglos de los avisos de seguridad/rendimiento de Supabase (Advisors).
-- No cambia qué puede hacer cada rol en el sitio, salvo los puntos 1 y 5
-- (que cierran accesos que no usaba nadie).
-- ================================================================

-- 1. confirmar_item (vieja, no la usa el sitio) es SECURITY DEFINER y
--    cualquier visitante podía llamarla por /rest/v1/rpc y descontar
--    stock. notificar_pedido_nuevo es la función del trigger de pedidos:
--    los triggers no necesitan EXECUTE para dispararse, así que sacarlo
--    no afecta las notificaciones de Telegram.
revoke execute on function public.confirmar_item(bigint)     from public, anon, authenticated;
revoke execute on function public.notificar_pedido_nuevo()   from public, anon, authenticated;

-- 2. search_path fijo en las funciones que no lo tenían.
alter function public.confirmar_item(bigint)            set search_path = public;
alter function public.set_scraped_updated_at()          set search_path = public;
alter function public.set_updated_at()                  set search_path = public;
alter function public.sync_from_externos()              set search_path = public;
alter function public.ocultar_productos_liquidacion()   set search_path = public;

-- 3. productos tenía dos juegos de policies que hacían lo mismo (uno
--    viejo con auth.email(), otro nuevo con auth.jwt()). Queda uno solo.
drop policy if exists "Lectura pública"                          on public.productos;
drop policy if exists "Solo admins pueden insertar productos"    on public.productos;
drop policy if exists "Solo admins pueden actualizar productos"  on public.productos;
drop policy if exists "Solo admins pueden eliminar productos"    on public.productos;

-- 4. Policies de admin: (select auth.jwt()) en vez de auth.jwt() para que
--    Postgres lo evalúe una vez por consulta y no una vez por fila. Y las
--    "for all" se separan en insert/update/delete, porque el select ya lo
--    cubre la policy de lectura pública (tener dos policies de select
--    hacía evaluar las dos en cada lectura).
do $$
declare
  t text;
  chequeo constant text :=
    'exists (select 1 from public.admins where admins.email = ((select auth.jwt()) ->> ''email''))';
begin
  -- tablas con lectura pública + escritura admin
  foreach t in array array['productos', 'producto_talles', 'producto_fotos', 'colores_personalizados'] loop
    execute format('drop policy if exists %I on public.%I',
      case t when 'producto_talles' then 'talles_escritura_admin' else t || '_escritura_admin' end, t);
    execute format('create policy %I on public.%I for insert with check (%s)', t || '_insert_admin', t, chequeo);
    execute format('create policy %I on public.%I for update using (%s) with check (%s)', t || '_update_admin', t, chequeo, chequeo);
    execute format('create policy %I on public.%I for delete using (%s)', t || '_delete_admin', t, chequeo);
  end loop;

  -- pedidos / pedido_items: select, update y delete solo admin
  foreach t in array array['pedidos', 'pedido_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_lectura_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_admin', t);
    execute format('create policy %I on public.%I for select using (%s)', t || '_lectura_admin', t, chequeo);
    execute format('create policy %I on public.%I for update using (%s)', t || '_update_admin', t, chequeo);
    execute format('create policy %I on public.%I for delete using (%s)', t || '_delete_admin', t, chequeo);
  end loop;
end $$;

-- 5. compras (tabla vieja, vacía, no la usa el sitio) se podía leer
--    públicamente. Queda todo solo para admins.
drop policy if exists "Lectura pública"                     on public.compras;
drop policy if exists "Solo admins pueden insertar compras" on public.compras;
drop policy if exists "Solo admins pueden eliminar compras" on public.compras;
create policy compras_admin on public.compras for all
  using      (exists (select 1 from public.admins where admins.email = ((select auth.jwt()) ->> 'email')))
  with check (exists (select 1 from public.admins where admins.email = ((select auth.jwt()) ->> 'email')));

-- 6. admins: cualquier usuario logueado podía leer la lista entera de
--    mails de admins. esAdmin() solo consulta el mail propio, así que
--    alcanza con dejar leer la fila de uno mismo.
drop policy if exists "Autenticados pueden leer admins" on public.admins;
create policy admins_lectura_propia on public.admins for select to authenticated
  using (email = ((select auth.jwt()) ->> 'email'));

-- 7. Índices de las foreign keys de pedido_items.
create index if not exists pedido_items_pedido_id_idx   on public.pedido_items(pedido_id);
create index if not exists pedido_items_producto_id_idx on public.pedido_items(producto_id);
