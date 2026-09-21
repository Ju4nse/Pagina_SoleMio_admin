/* ================================================================
   html.js — Escapar texto antes de meterlo en un template HTML.

   Todo lo que escribe un cliente al hacer un pedido (nombre, teléfono,
   nota, y también producto_nombre/talle/color de pedido_items, que los
   manda el navegador del cliente) se tiene que pasar por esc() antes
   de ir a un innerHTML. Si no, un pedido con, por ejemplo,
   <img src=x onerror=...> en el nombre ejecuta código en el panel de
   admin con la sesión del admin.
   ================================================================ */
export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
