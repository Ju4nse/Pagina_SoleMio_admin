-- 2026-09-10c_productos_creado_en.sql
-- Nueva columna para poder mostrar una etiqueta "Nuevo" (dura 1
-- semana desde que se creó el producto), visible tanto para
-- invitados como para el admin.
--
-- Para los productos que vinieron del scraper, se recupera la fecha
-- REAL de la primera vez que se vieron
-- (productos_externos.scraped_created_at, columna que el trigger de
-- sync solo escribe en el INSERT inicial y nunca vuelve a tocar) —
-- cruzando por productos.id = productos_externos.codigo (mismo join
-- que usa ese trigger). Los productos sin contraparte en
-- productos_externos (cargados a mano desde el panel, no por
-- scraper) quedan con una fecha vieja fija, para que no aparezcan
-- todos como "Nuevo" de golpe al correr este script.

alter table public.productos add column if not exists creado_en timestamptz;

update public.productos p
set creado_en = pe.scraped_created_at
from public.productos_externos pe
where pe.codigo = p.id
  and p.creado_en is null;

update public.productos
set creado_en = '2020-01-01T00:00:00Z'
where creado_en is null;

alter table public.productos alter column creado_en set default now();
alter table public.productos alter column creado_en set not null;
