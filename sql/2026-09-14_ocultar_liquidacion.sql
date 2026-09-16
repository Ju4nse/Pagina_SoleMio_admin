-- 2026-09-14_ocultar_liquidacion.sql
-- Todo producto cuyo nombre diga "liquidacion" (en cualquier variante)
-- queda siempre como NO disponible (oculto para invitados). Lo fuerza
-- un trigger BEFORE INSERT/UPDATE sobre productos, así que alcanza
-- tanto a lo que entra por el scraper (el sync productos_externos ->
-- productos hace INSERT ... ON CONFLICT DO UPDATE, que dispara este
-- trigger) como a lo que se edita desde el panel.
--
-- Match: nombre ~* '\mliquid' — "liquid" al principio de una palabra,
-- sin importar mayúsculas. Contra la base en vivo (2026-09-14) cubre
-- 145 productos, con estas variantes: liquidacion, LIQUIDACION,
-- Liquidacion, y los nombres cortados a 40 caracteres por el
-- proveedor: liquidacio, liquidaci, liquidac. También cubre
-- "liquidación" con tilde (la tilde queda después de "liquid").
-- No usamos '%liq%' a secas porque matchea "aplique" (5 productos).
--
-- Ojo: como el trigger corre también en UPDATE, si el admin intenta
-- marcar como disponible un producto de liquidación desde el panel,
-- el cambio no queda (vuelve a false). Si algún día hace falta una
-- excepción, hay que borrar el trigger o agregarle una condición.

create or replace function public.ocultar_productos_liquidacion()
returns trigger
language plpgsql
as $$
begin
  if new.nombre ~* '\mliquid' then
    new.disponible := false;
  end if;
  return new;
end;
$$;

drop trigger if exists productos_ocultar_liquidacion on public.productos;

create trigger productos_ocultar_liquidacion
  before insert or update of nombre, disponible on public.productos
  for each row
  execute function public.ocultar_productos_liquidacion();

-- Backfill: los que ya están cargados hoy (18 disponibles al
-- momento de escribir esto).
update public.productos
set disponible = false
where nombre ~* '\mliquid'
  and disponible = true;
