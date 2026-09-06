-- Precio especial opcional por combinación de talle/color (ej: dos
-- productos del scraper que en realidad son la misma prenda con un
-- talle más caro, tipo "AG0108" y "AG0108B"). Si es null, se usa el
-- precio base del producto (productos.precio) como hasta ahora.
--
-- Igual que productos.precio, este valor es el costo/base al que
-- después se le aplica el mismo margen (*1.5) en el front — no es el
-- precio final que ve el cliente.

alter table public.producto_talles add column if not exists precio numeric;
