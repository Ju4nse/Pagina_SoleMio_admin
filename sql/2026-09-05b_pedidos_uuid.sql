-- ================================================================
-- Fix: pedidos.id pasa de bigint identity a uuid.
--
-- Por qué: un invitado (sin sesión) inserta un pedido y necesita el
-- id para poder insertar sus pedido_items a continuación — pero la
-- política RLS de SELECT en `pedidos` es admin-only (correcto: no
-- puede leer pedidos ajenos), así que insert(...).select().single()
-- fallaba siempre para invitados: el insert se hacía, pero PostgREST
-- no podía devolver la fila. Con id uuid generado en el cliente
-- (crypto.randomUUID()) no hace falta leer nada de vuelta.
--
-- Corré esto en el SQL Editor de Supabase (después de la migración
-- anterior). Como las tablas están recién creadas y sin pedidos
-- reales todavía, se recrean directo.
-- ================================================================
drop table if exists public.pedido_items cascade;
drop table if exists public.pedidos cascade;

create table public.pedidos (
  id                uuid primary key default gen_random_uuid(),
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
  pedido_id         uuid not null references public.pedidos(id) on delete cascade,
  producto_id       text references public.productos(id) on delete set null,
  producto_nombre   text not null,
  talle             text not null default '',
  color             text not null default '',
  cantidad          int not null check (cantidad > 0),
  precio_unitario   numeric not null,
  disponible        boolean,
  created_at        timestamptz not null default now()
);

alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;

create policy "pedidos_insert_publico" on public.pedidos
  for insert with check (true);

create policy "pedido_items_insert_publico" on public.pedido_items
  for insert with check (true);

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
