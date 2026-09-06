-- Hasta ahora "stock" (booleano, visible al cliente) se recalculaba
-- solo a partir de num_stock > 0 cada vez que se guardaba el producto
-- (ver saveProd en catalogo.js) — no había forma de marcar un producto
-- disponible aunque la cantidad cargada fuera 0 (ej: se puede conseguir
-- por encargue). "disponible" es ese flag independiente, editable
-- desde un botón en la propia grilla del panel, sin entrar a editar.
--
-- Reemplaza también a "oculto" (columna que queda en la tabla sin uso,
-- no se borra por las dudas — pero el código ya no la lee ni la
-- escribe): antes un producto era visible si stock=true Y oculto=false,
-- así que el backfill combina las dos para que "disponible" arranque
-- reflejando exactamente lo que un invitado ya veía, y ningún producto
-- cambie de visibilidad hasta que el admin toque el botón nuevo.

alter table public.productos add column if not exists disponible boolean not null default true;

update public.productos set disponible = (stock and not coalesce(oculto, false));
