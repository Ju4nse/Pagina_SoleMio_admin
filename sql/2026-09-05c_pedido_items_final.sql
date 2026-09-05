-- ================================================================
-- pedido_items: separar lo que pidió el cliente de lo que el admin
-- termina confirmando, para poder avisar por WhatsApp cuando cambia
-- el color o se baja la cantidad.
--
-- talle / color / cantidad  → lo que pidió el cliente (no se toca).
-- talle_final / color_final / cantidad_final → lo que decide el admin
--   al revisar (si quedan null, se usa el valor original tal cual).
-- ================================================================
alter table public.pedido_items
  add column if not exists talle_final    text,
  add column if not exists color_final    text,
  add column if not exists cantidad_final int;
