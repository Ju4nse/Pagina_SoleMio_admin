-- 2026-09-06_producto_eliminado_soft_delete.sql
-- "Eliminar" un producto desde el panel ya NO borra la fila de la
-- base — la marca como eliminada. Así el dato queda conservado (por
-- si hace falta recuperarlo, o para no perder el historial de
-- pedidos que lo referencian) pero deja de aparecer en cualquier
-- consulta del sitio, tanto para invitados como para el admin.
--
-- Es distinto de "oculto": un producto oculto lo sigue viendo el
-- admin (con badge "Oculto"); uno eliminado no lo ve nadie más,
-- salvo que alguien entre directo a la base.

alter table public.productos
  add column if not exists eliminado boolean not null default false;

create index if not exists productos_eliminado_idx
  on public.productos (eliminado)
  where eliminado = false;
