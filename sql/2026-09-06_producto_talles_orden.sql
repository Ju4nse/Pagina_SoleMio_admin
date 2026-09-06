-- Permite al admin decidir el orden en que se muestran los talles y
-- colores de un producto (antes quedaban en el orden en que se habían
-- ido creando las filas, sin forma de cambiarlo).
--
-- orden = posición dentro del recorrido talles × colores del panel de
-- edición al guardar (ver sincronizarTallesDB en catalogo.js/producto.js).
-- El backfill deja el orden actual (por id) como punto de partida, así
-- no cambia nada visualmente hasta que el admin reordene algo.

alter table public.producto_talles add column if not exists orden integer not null default 0;

update public.producto_talles set orden = id where orden = 0;
