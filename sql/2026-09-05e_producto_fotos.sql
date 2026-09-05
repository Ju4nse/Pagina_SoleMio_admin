-- ================================================================
-- Galería de fotos por producto (varias fotos, ordenables, para el
-- carrusel + zoom de la página de detalle). Mismo criterio que
-- producto_talles: tabla aparte en vez de texto/columna única.
--
-- imagen_custom / imagen_scraper en `productos` NO se tocan — siguen
-- funcionando como fallback para productos que todavía no tienen
-- fotos cargadas acá (ver resolverFotos() en producto.js/catalogo.js).
-- ================================================================
create table public.producto_fotos (
  id           bigint generated always as identity primary key,
  producto_id  text not null references public.productos(id) on delete cascade,
  url          text not null,
  orden        int  not null default 0,
  created_at   timestamptz not null default now()
);

create index producto_fotos_producto_id_idx on public.producto_fotos(producto_id);

alter table public.producto_fotos enable row level security;

create policy "producto_fotos_lectura_publica" on public.producto_fotos
  for select using (true);

create policy "producto_fotos_escritura_admin" on public.producto_fotos
  for all using (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')))
  with check (exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));
