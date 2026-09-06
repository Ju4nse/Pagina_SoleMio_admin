-- Permite al admin archivar pedidos (sacarlos de la vista principal
-- del panel sin borrarlos) — por ejemplo pedidos viejos ya resueltos
-- que no necesita seguir viendo mezclados con los activos.

alter table public.pedidos add column if not exists archivado boolean not null default false;
