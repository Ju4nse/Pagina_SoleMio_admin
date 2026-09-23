/* ================================================================
   tarjeta-producto.js — La tarjetita de producto, igual en todo el
   sitio: grilla del catálogo, "Más de <marca>" en producto.html y
   destacados de la landing.

   Siempre muestra el ID del producto (las clientas lo usan para
   consultar por WhatsApp) y el botón "Agregar al carrito". Se pueden
   rediseñar, pero no sacar.

   Es un <article> con un link "estirado" (ver .prod-link::after en
   catalogo.css) en vez de un <a> que envuelve todo: así el botón de
   agregar no queda metido adentro de un link, que es HTML inválido y
   confunde a los lectores de pantalla.
   ================================================================ */
import { ICON, hexDeColor } from './theme.js';
import { agregarAlCarrito } from './carrito.js';
import { esc } from './html.js';
import { nombreLegible, marcaLegible } from './texto.js';

export { nombreLegible, marcaLegible };

const UNA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

export function esProductoNuevo(p) {
  return !!p.creado_en && (Date.now() - new Date(p.creado_en).getTime()) < UNA_SEMANA_MS;
}

export function resolverImagen(p) {
  return p.imagen_custom || p.imagen_scraper || p.imagen || '';
}

function fmtARS(n) {
  return '$ ' + Math.round(n).toLocaleString('es-AR');
}

const ORDEN_LETRAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];

/* "100, 105, 110, 85, 90, 95" → "Talles 85 al 110". Con letras
   (S, M, L…) usa el mismo orden de siempre; si hay mezcla o un talle
   raro, muestra los primeros tres. */
export function resumenTalles(talles) {
  const lista = String(talles || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!lista.length) return '';
  if (lista.length === 1) return `Talle ${lista[0]}`;

  const numeros = lista.map(Number);
  if (numeros.every(n => Number.isFinite(n))) {
    return `Talles ${Math.min(...numeros)} al ${Math.max(...numeros)}`;
  }

  const posiciones = lista.map(t => ORDEN_LETRAS.indexOf(t.toUpperCase()));
  if (posiciones.every(i => i >= 0)) {
    const orden = [...lista].sort((a, b) =>
      ORDEN_LETRAS.indexOf(a.toUpperCase()) - ORDEN_LETRAS.indexOf(b.toUpperCase()));
    return lista.length <= 3
      ? `Talles ${orden.join(', ')}`
      : `Talles ${orden[0]} al ${orden[orden.length - 1]}`;
  }

  return `Talles ${lista.slice(0, 3).join(', ')}${lista.length > 3 ? '…' : ''}`;
}

/* Puntitos del color real de cada variante (hasta 5, después "+N").
   Los nombres completos van en texto para lectores de pantalla y como
   tooltip — el color solo nunca es la única forma de saberlo. */
export function puntosColor(color) {
  const lista = String(color || '').split(',').map(c => c.trim()).filter(Boolean);
  if (!lista.length) return '';
  const MAX = 5;
  const nombres = lista.map(c => nombreLegible(c)).join(', ');
  const puntos = lista.slice(0, MAX).map(c => {
    const hex = hexDeColor(c);
    return hex
      ? `<span class="prod-dot" style="background:${esc(hex)}"></span>`
      : `<span class="prod-dot color-dot-generic"></span>`;
  }).join('');
  const resto = lista.length > MAX ? `<span class="prod-dot-mas">+${lista.length - MAX}</span>` : '';
  return `<span class="prod-dots" title="${esc(nombres)}" aria-hidden="true">${puntos}${resto}</span>`
       + `<span class="sr-only">Colores: ${esc(nombres)}.</span>`;
}

/* Productos ya dibujados en la página, para que el onclick de
   "Agregar al carrito" encuentre el producto por su id. */
const registro = new Map();

export function agregarRapido(id) {
  const p = registro.get(id);
  if (!p) return;
  /* Va sin talle/color: se eligen después en el carrito (ver
     carrito-page.js). Si el producto tiene talles y/o colores para
     elegir, cada click agrega una línea separada, para poder agregar el
     mismo producto varias veces y darle a cada uno un talle o color
     distinto — si dos terminan con la misma combinación, el carrito
     las fusiona solo en ese momento. */
  agregarAlCarrito({
    productoId:     p.id,
    nombre:         p.nombre,
    precioUnitario: Math.round((p.precio || 0) * 1.5),
    imagen:         resolverImagen(p),
    talle:          '',
    color:          '',
    cantidad:       1,
    separado:       !!(p.talles || p.color),
  });
}
window.agregarAlCarritoRapidoUI = agregarRapido;

/* opts.badges   — HTML extra de etiquetas (stock, destacado… solo admin)
   opts.acciones — HTML que reemplaza al botón de agregar (Editar/Disponible
                   del admin); sin esto va "Agregar al carrito" */
export function renderTarjetaProducto(p, opts = {}) {
  registro.set(p.id, p);

  const img    = resolverImagen(p);
  const nombre = nombreLegible(p.nombre, p.marca);
  const href   = `producto.html?id=${encodeURIComponent(p.id)}`;
  const talles = resumenTalles(p.talles);
  const dots   = puntosColor(p.color);
  const nuevo  = esProductoNuevo(p);

  return `
    <article class="prod-card${p.disponible === false ? ' no-disponible' : ''}">
      <div class="prod-media">
        ${img
          ? `<img class="prod-thumb" src="${esc(img)}" alt="" loading="lazy"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ''}
        <div class="prod-thumb-ph" style="${img ? 'display:none' : ''}">${ICON.shoe}</div>
        ${nuevo ? `<span class="prod-nuevo">Nuevo</span>` : ''}
      </div>
      <div class="prod-body">
        <div class="prod-top">
          ${p.marca ? `<span class="prod-marca">${esc(marcaLegible(p.marca))}</span>` : ''}
          <span class="prod-id"><span class="sr-only">Código </span>${esc(p.id)}</span>
        </div>
        <h3 class="prod-name"><a class="prod-link" href="${href}">${esc(nombre)}</a></h3>
        ${dots || talles ? `<div class="prod-variantes">${dots}${talles ? `<span>${esc(talles)}</span>` : ''}</div>` : ''}
        <div class="prod-price">${fmtARS((p.precio || 0) * 1.5)}</div>
        ${opts.badges ? `<div class="prod-badges">${opts.badges}</div>` : ''}
        ${opts.acciones != null
          ? opts.acciones
          : `<div class="prod-quickadd">
              <button type="button" class="btn primary" ${p.disponible === false ? 'disabled' : ''}
                onclick="agregarAlCarritoRapidoUI('${esc(p.id)}')"
                aria-label="Agregar ${esc(nombre)} al carrito">
                ${ICON.cart}<span class="prod-quickadd-largo">Agregar al carrito</span><span class="prod-quickadd-corto">Agregar</span>
              </button>
            </div>`}
      </div>
    </article>`;
}
