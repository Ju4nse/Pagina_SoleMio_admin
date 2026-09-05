-- ================================================================
-- Estados de pedido: pendiente/confirmado_parcial/confirmado_total/
-- cancelado se simplifican a espera/revisado/confirmado/cancelado.
--
-- "revisado" ahora engloba tanto los pedidos que antes eran
-- confirmado_parcial (mezcla de disponible/sin stock) como cualquier
-- pedido donde el admin cambió talle, color o cantidad de algún ítem
-- al confirmar. "confirmado" queda reservado para cuando todo se
-- confirma tal cual se pidió, sin cambios.
--
-- Además se agrega `pagado`: marca de uso exclusivo del admin (no se
-- expone al cliente — obtener_pedido_publico/obtener_pedido_items_publico
-- listan columnas explícitas y no incluyen esta).
--
-- Corré esto en el SQL Editor de Supabase.
-- ================================================================
-- Primero hay que sacar el constraint viejo: todavía solo permite los
-- valores anteriores, así que los UPDATE de abajo fallarían si se
-- corrieran antes de esto.
alter table public.pedidos drop constraint if exists pedidos_estado_check;

update public.pedidos set estado = 'espera'     where estado = 'pendiente';
update public.pedidos set estado = 'revisado'   where estado = 'confirmado_parcial';
update public.pedidos set estado = 'confirmado' where estado = 'confirmado_total';

alter table public.pedidos add constraint pedidos_estado_check
  check (estado in ('espera','revisado','confirmado','cancelado'));

alter table public.pedidos alter column estado set default 'espera';

alter table public.pedidos add column if not exists pagado boolean not null default false;
