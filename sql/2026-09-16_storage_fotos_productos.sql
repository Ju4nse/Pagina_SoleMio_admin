-- 2026-09-16_storage_fotos_productos.sql
-- Bucket de Supabase Storage para las fotos de productos que sube el
-- admin desde el modal de edición (botón "Subir foto" de la galería).
--
-- Público: cualquiera puede VER las fotos por su URL pública (el
-- catálogo es público), pero solo un admin puede subir, reemplazar o
-- borrar. Las URLs públicas no pasan por RLS, así que no hace falta
-- policy de select (y sin ella nadie puede listar el bucket).
--
-- No se usa el bucket "Catalogo" que ya existía: es privado y tiene
-- archivos internos (el Excel del proveedor).
-- ================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-productos', 'fotos-productos', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "fotos_productos_insert_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-productos'
              and exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

create policy "fotos_productos_update_admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'fotos-productos'
         and exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));

create policy "fotos_productos_delete_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-productos'
         and exists (select 1 from admins where admins.email = (auth.jwt() ->> 'email')));
