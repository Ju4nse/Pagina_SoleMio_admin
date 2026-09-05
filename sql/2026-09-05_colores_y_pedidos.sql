-- ================================================================
-- Migración: stock por talle+color combinado, y tablas de pedidos.
-- Corré esto una sola vez en el SQL Editor de Supabase.
-- ================================================================

-- ----------------------------------------------------------------
-- 1) Colores: extender producto_talles con una columna `color`.
--    color = '' significa "sin color / no aplica" (producto que solo
--    varía por talle). El stock real vive en (producto_id, talle, color).
-- ----------------------------------------------------------------
alter table public.producto_talles
  add column if not exists color text not null default '';

-- Reemplaza el unique constraint (producto_id, talle) por
-- (producto_id, talle, color), sea cual sea su nombre actual.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.producto_talles'::regclass
    and contype = 'u';

  if cname is not null then
    execute format('alter table public.producto_talles drop constraint %I', cname);
  end if;
end $$;

alter table public.producto_talles
  add constraint producto_talles_producto_id_talle_color_key
  unique (producto_id, talle, color);

-- ----------------------------------------------------------------
-- 2) Pedidos: las tablas existentes están vacías y sin uso desde
--    ningún código del repo (confirmado). Se recrean desde cero.
-- ----------------------------------------------------------------
drop table if exists public.pedido_items cascade;
drop table if exists public.pedidos cascade;

create table public.pedidos (
  id                bigint generated always as identity primary key,
  cliente_nombre    text not null,
  cliente_telefono  text not null,
  estado            text not null default 'pendiente'
                     check (estado in ('pendiente','confirmado_parcial','confirmado_total','cancelado')),
  monto_estimado    numeric not null default 0,
  monto_final       numeric,
  nota              text,
  created_at        timestamptz not null default now(),
  confirmado_at     timestamptz
);

create table public.pedido_items (
  id                bigint generated always as identity primary key,
  pedido_id         bigint not null references public.pedidos(id) on delete cascade,
  producto_id       text references public.productos(id) on delete set null,
  producto_nombre   text not null,   -- snapshot: si el producto cambia o se borra, el pedido no pierde el dato
  talle             text not null default '',
  color             text not null default '',
  cantidad          int not null check (cantidad > 0),
  precio_unitario   numeric not null,  -- snapshot del precio al momento del pedido
  disponible        boolean,            -- null = sin revisar, true = confirmado, false = sin stock
  created_at        timestamptz not null default now()
);

alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

-- Cualquiera (invitado incluido, sin sesión) puede crear un pedido.
create policy "pedidos_insert_publico" on public.pedidos
  for insert with check (true);

create policy "pedido_items_insert_publico" on public.pedido_items
  for insert with check (true);

-- Solo el dueño (mismo criterio que productos/producto_talles) puede
-- ver, editar o borrar pedidos. Los datos de clientes no son públicos.
create policy "pedidos_lectura_admin" on public.pedidos
  for select using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

create policy "pedidos_update_admin" on public.pedidos
  for update using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

create policy "pedidos_delete_admin" on public.pedidos
  for delete using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

create policy "pedido_items_lectura_admin" on public.pedido_items
  for select using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

create policy "pedido_items_update_admin" on public.pedido_items
  for update using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

create policy "pedido_items_delete_admin" on public.pedido_items
  for delete using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));
