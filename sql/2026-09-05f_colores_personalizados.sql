-- ================================================================
-- Colores personalizados: permite pisar (o agregar) el hex que se
-- usa para el puntito de un color, por nombre — ej. definir el tono
-- exacto de "Natural" o de un verde específico, en vez de depender
-- del mapa fijo de theme.js (COLOR_MAP).
--
-- `nombre` se guarda ya normalizado (minúscula, sin acentos — mismo
-- criterio que normalizarColor() en theme.js) para que el lookup
-- funcione sin importar cómo se haya escrito el color en el producto.
-- ================================================================
create table public.colores_personalizados (
  nombre  text primary key,
  hex     text not null,
  updated_at timestamptz not null default now()
);

alter table public.colores_personalizados enable row level security;

create policy "colores_personalizados_lectura_publica" on public.colores_personalizados
  for select using (true);

create policy "colores_personalizados_escritura_admin" on public.colores_personalizados
  for all using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')))
  with check (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));
