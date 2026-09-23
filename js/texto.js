/* ================================================================
   texto.js — Cómo se muestran nombres de productos y marcas.
   Sin dependencias, para que lo pueda importar cualquier página
   (tarjeta-producto.js, carrito.js…) sin cruces entre módulos.
   ================================================================ */

/* Muchos nombres vienen del proveedor en MAYÚSCULAS ("ANA GRANT CORP
   REDUCTOR"), que en la grilla se leen como un grito. Si el nombre es
   casi todo mayúsculas se muestra con mayúscula solo al principio;
   los que el admin ya escribió en minúscula normal quedan como están.
   Si el nombre incluye la marca, la marca queda como nombre propio
   ("Ana Grant corp reductor", no "Ana grant corp reductor").
   Es solo para mostrar: el dato guardado no cambia. */
function capitalizarPalabras(s) {
  return s.toLocaleLowerCase('es-AR').replace(/(^|[\s-])(\p{L})/gu, (_, sep, l) => sep + l.toLocaleUpperCase('es-AR'));
}

/* "ANA GRANT" → "Ana Grant". Siglas cortas ("DM", "LYB") quedan igual. */
export function marcaLegible(marca) {
  const m = String(marca || '').trim();
  const letras = m.replace(/[^\p{L}]/gu, '');
  if (letras.length <= 3 || letras !== letras.toLocaleUpperCase('es-AR')) return m;
  return capitalizarPalabras(m);
}

export function nombreLegible(nombre, marca) {
  const s = String(nombre || '').trim();
  const letras = s.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  if (letras.length < 4) return s;
  const mayus = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '').length;
  if (mayus / letras.length < 0.7) return s;

  const bajo = s.toLocaleLowerCase('es-AR');
  let legible = bajo.charAt(0).toLocaleUpperCase('es-AR') + bajo.slice(1);

  const m = String(marca || '').trim();
  if (m) {
    const i = bajo.indexOf(m.toLocaleLowerCase('es-AR'));
    if (i >= 0) legible = legible.slice(0, i) + marcaLegible(m) + legible.slice(i + m.length);
  }
  return legible;
}
