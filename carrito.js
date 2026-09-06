/* ================================================================
   carrito.js — Estado del carrito compartido (localStorage) +
   notificación breve al agregar un producto.

   El carrito en sí (edición completa, explicación del proceso y
   confirmación del pedido) vive en carrito.html / carrito-page.js.
   Este módulo solo mantiene el estado y lo que necesitan
   catalogo.js / producto.js: el badge del ícono y el toast de
   "agregado al carrito".
   ================================================================ */
import { sb } from './supabase-client.js';
import { ICON } from './theme.js';

const CARRITO_KEY      = 'solemio-carrito';
const MIS_PEDIDOS_KEY  = 'solemio-mis-pedidos';

/* Cuánto se le avisa al cliente que puede tardar la revisión manual
   del pedido. Un solo lugar para cambiarlo — lo usan carrito-page.js
   (explicación + confirmación) y pedido-estado.js (estado "espera"). */
export const TIEMPO_REVISION_HORAS = 24;

export function fmtARS(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-AR');
}

export function leerCarrito() {
  try {
    return JSON.parse(localStorage.getItem(CARRITO_KEY)) || [];
  } catch (_) {
    return [];
  }
}

function guardarCarrito(items) {
  localStorage.setItem(CARRITO_KEY, JSON.stringify(items));
  actualizarBadge();
}

/* separado:true evita fusionar con una línea existente aunque
   coincidan producto/talle/color — lo usa el botón rápido del
   catálogo, donde talle/color quedan vacíos "a propósito" (se eligen
   después en el carrito) y cada click debe ser una unidad aparte, no
   sumarse a la anterior. Una vez que cada línea tenga su talle/color
   elegido, actualizarAtributoItem() sí las fusiona si terminan iguales. */
export function agregarAlCarrito({ productoId, nombre, precioUnitario, imagen, talle, color, cantidad, separado }) {
  const items = leerCarrito();
  const cant  = Math.max(1, parseInt(cantidad, 10) || 1);
  const idx   = separado ? -1 : items.findIndex(it =>
    it.productoId === productoId && it.talle === (talle || '') && it.color === (color || ''));

  if (idx >= 0) {
    items[idx].cantidad += cant;
  } else {
    items.push({
      productoId,
      nombre,
      precioUnitario: Math.round(precioUnitario) || 0,
      imagen: imagen || '',
      talle:  talle  || '',
      color:  color  || '',
      cantidad: cant,
    });
  }

  guardarCarrito(items);
  mostrarToastAgregado(nombre);
}

export function quitarItem(idx) {
  const items = leerCarrito();
  items.splice(idx, 1);
  guardarCarrito(items);
}

export function cambiarCantidad(idx, delta) {
  const items = leerCarrito();
  if (!items[idx]) return;
  items[idx].cantidad = Math.max(1, (parseInt(items[idx].cantidad, 10) || 1) + delta);
  guardarCarrito(items);
}

/* Usado por carrito-page.js para completar talle/color de un ítem
   agregado sin elegirlos (desde el botón rápido del catálogo). Si el
   cambio hace que el ítem coincida con otro ya existente, se fusionan
   las cantidades en vez de dejar dos líneas iguales. */
export function actualizarAtributoItem(idx, cambios) {
  const items = leerCarrito();
  if (!items[idx]) return;
  const item = { ...items[idx], ...cambios };

  const otroIdx = items.findIndex((it, i) =>
    i !== idx && it.productoId === item.productoId &&
    it.talle === (item.talle || '') && it.color === (item.color || ''));

  items[idx] = item;
  if (otroIdx >= 0) {
    items[otroIdx].cantidad += item.cantidad;
    items.splice(idx, 1);
  }
  guardarCarrito(items);
}

/* ================================================================
   VARIANTES DE PRODUCTO (talle/color) — helpers compartidos por
   producto.js (selector en la página de detalle) y carrito-page.js
   (selector inline para ítems agregados sin talle/color elegidos).
   ================================================================ */
export function variantesFallbackDesdeTexto(p) {
  const talles  = (p.talles || '').split(',').map(t => t.trim()).filter(Boolean);
  const colores = (p.color  || '').split(',').map(c => c.trim()).filter(Boolean);
  if (talles.length) {
    return colores.length
      ? talles.flatMap(t => colores.map(c => ({ talle: t, color: c })))
      : talles.map(t => ({ talle: t, color: '' }));
  }
  return colores.map(c => ({ talle: '', color: c }));
}

/* producto_talles puede tener filas que solo cubren el talle (color='')
   si se cargaron antes de que existiera la gestión de colores. En ese
   caso se cruzan los talles reales con los colores del campo de texto
   legado, en vez de perder el color por completo. */
export function combinarVariantesConTexto(variantesDB, data) {
  if (!variantesDB) return variantesFallbackDesdeTexto(data);

  const tieneColorEstructurado = variantesDB.some(v => v.color);
  if (tieneColorEstructurado) return variantesDB;

  const coloresTexto = (data.color || '').split(',').map(c => c.trim()).filter(Boolean);
  if (!coloresTexto.length) return variantesDB;

  return variantesDB.flatMap(v => coloresTexto.map(c => ({ talle: v.talle, color: c })));
}

export function vaciarCarrito() {
  guardarCarrito([]);
}

export function totalCarrito(items) {
  return (items || leerCarrito()).reduce((acc, it) => acc + it.precioUnitario * it.cantidad, 0);
}

export function cantidadTotalItems(items) {
  return (items || leerCarrito()).reduce((acc, it) => acc + it.cantidad, 0);
}

export function actualizarBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  const n = cantidadTotalItems();
  badge.textContent = n > 0 ? String(n) : '';
  badge.style.display = n > 0 ? 'flex' : 'none';
}

/* ================================================================
   TOASTS "agregado al carrito" — se muestran al costado de la página
   (no navegan, no interrumpen el catálogo) con un link a carrito.html.
   Si se agregan varios productos seguido, se apilan uno debajo del
   otro (ver #modal-carrito en catalogo.css) en vez de reemplazarse:
   cada uno es independiente, con su propio timer de cierre.
   ================================================================ */
let toastSeq = 0;

function mostrarToastAgregado(nombre) {
  const container = document.getElementById('modal-carrito');
  if (!container) return;

  const id = `carrito-toast-${++toastSeq}`;
  const toastEl = document.createElement('div');
  toastEl.className = 'carrito-toast';
  toastEl.id = id;
  toastEl.innerHTML = `
    <div class="carrito-toast-icon">✓</div>
    <div class="carrito-toast-body">
      <div class="carrito-toast-titulo">Producto agregado a tu pedido</div>
      <div class="carrito-toast-nombre">${nombre}</div>
    </div>
    <a class="btn sm primary" href="carrito.html">Ver pedido</a>
    <button type="button" class="carrito-toast-cerrar" onclick="cerrarToastCarritoUI('${id}')" aria-label="Cerrar">✕</button>`;

  container.appendChild(toastEl);

  requestAnimationFrame(() => toastEl.classList.add('open'));

  setTimeout(() => cerrarToast(id), 4000);
}

function cerrarToast(id) {
  const toast = document.getElementById(id);
  if (!toast) return;
  toast.classList.remove('open');
  setTimeout(() => toast.remove(), 200);
}

/* ================================================================
   DRAWER DEL CARRITO — panel lateral que abre el ícono del carrito
   de la topbar (en cualquier página) para ver el pedido sin navegar.
   Se inyecta una sola vez en document.body la primera vez que se
   abre, así no hace falta agregar su contenedor a cada HTML.
   ================================================================ */
let drawerAbierto = false;

function asegurarDrawer() {
  if (document.getElementById('carrito-drawer')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="carrito-drawer-overlay" id="carrito-drawer-overlay" onclick="cerrarCarritoDrawerUI()"></div>
    <aside class="carrito-drawer" id="carrito-drawer">
      <div class="carrito-drawer-header">
        <h2>Tu pedido</h2>
        <button type="button" class="carrito-drawer-cerrar" onclick="cerrarCarritoDrawerUI()" aria-label="Cerrar">✕</button>
      </div>
      <div class="carrito-body" id="carrito-drawer-body"></div>
    </aside>`;
  document.body.append(...wrap.children);
}

/* Junta en una sola fila las líneas que son "el mismo" ítem (mismo
   producto/talle/color) — típicamente varias agregadas sin talle/color
   elegido todavía desde el botón rápido del catálogo, que quedan como
   líneas independientes a propósito (ver agregarAlCarritoRapido en
   catalogo.js) porque cada una podría terminar con un talle/color
   distinto. En el drawer eso solo se ve como ruido visual, así que acá
   se agrupan para mostrar; al llegar al carrito completo (carrito.html)
   siguen apareciendo separadas para poder elegirles el talle/color
   una por una. */
function agruparItemsParaDrawer(items) {
  const grupos = [];
  const posPorClave = new Map();

  items.forEach((it, idx) => {
    const clave = `${it.productoId}|${it.talle || ''}|${it.color || ''}`;
    if (posPorClave.has(clave)) {
      const grupo = grupos[posPorClave.get(clave)];
      grupo.cantidad += it.cantidad;
      grupo.idxs.push(idx);
    } else {
      posPorClave.set(clave, grupos.length);
      grupos.push({ ...it, idxs: [idx] });
    }
  });

  return grupos;
}

function renderDrawerBody() {
  const body = document.getElementById('carrito-drawer-body');
  if (!body) return;
  const items  = leerCarrito();
  const grupos = agruparItemsParaDrawer(items);

  if (!grupos.length) {
    body.innerHTML = `
      <div class="carrito-vacio">
        Todavía no agregaste productos a tu pedido.<br>
        <a class="btn primary" href="catalogo.html" style="margin-top:1rem;display:inline-flex">Ir al catálogo</a>
      </div>`;
    return;
  }

  body.innerHTML = `
    <div class="carrito-items">
      ${grupos.map(g => `
        <div class="carrito-item">
          <div class="carrito-item-img">
            ${g.imagen
              ? `<img src="${g.imagen}" alt="${g.nombre}"
                   onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                 <div class="carrito-item-img-ph" style="display:none">${ICON.shoe}</div>`
              : `<div class="carrito-item-img-ph">${ICON.shoe}</div>`}
          </div>
          <div class="carrito-item-info">
            <div class="carrito-item-nombre">${g.nombre}</div>
            <div class="carrito-item-attrs">${[g.talle, g.color].filter(Boolean).join(' · ') || '&nbsp;'}</div>
            <div class="carrito-item-precio">${fmtARS(g.precioUnitario)} c/u</div>
          </div>
          <div class="carrito-item-qty">
            <button type="button" class="btn-qty" onclick="cambiarCantidadDrawerUI([${g.idxs}],-1)">−</button>
            <span>${g.cantidad}</span>
            <button type="button" class="btn-qty" onclick="cambiarCantidadDrawerUI([${g.idxs}],1)">+</button>
          </div>
          <button type="button" class="btn-quitar-item" onclick="quitarItemDrawerUI([${g.idxs}])" title="Quitar">✕</button>
        </div>
      `).join('')}
    </div>
    <div class="carrito-drawer-footer">
      <div class="carrito-total">
        <span>Total estimado</span>
        <strong>${fmtARS(totalCarrito(items))}</strong>
      </div>
      <div class="carrito-drawer-botones">
        <button type="button" class="btn ghost" onclick="cerrarCarritoDrawerUI()">Seguir comprando</button>
        <a class="btn primary" href="carrito.html">Ir al pedido</a>
      </div>
    </div>`;
}

function abrirCarritoDrawer(event) {
  if (event) event.preventDefault();
  asegurarDrawer();
  renderDrawerBody();
  document.getElementById('carrito-drawer-overlay')?.classList.add('open');
  document.getElementById('carrito-drawer')?.classList.add('open');
  document.body.classList.add('carrito-drawer-lock');
  drawerAbierto = true;
  return false;
}

function cerrarCarritoDrawer() {
  document.getElementById('carrito-drawer-overlay')?.classList.remove('open');
  document.getElementById('carrito-drawer')?.classList.remove('open');
  document.body.classList.remove('carrito-drawer-lock');
  drawerAbierto = false;
}

/* idxs: todas las líneas agrupadas bajo esta fila del drawer (ver
   agruparItemsParaDrawer). El +/- actúa solo sobre la última línea del
   grupo (la más reciente); si el "-" la deja en 0, se saca esa línea
   entera en vez de quedar en cantidad 0. */
function cambiarCantidadDrawer(idxs, delta) {
  const items   = leerCarrito();
  const ultimo  = idxs[idxs.length - 1];
  if (!items[ultimo]) return;

  if (delta < 0 && items[ultimo].cantidad <= 1) {
    quitarItem(ultimo);
  } else {
    cambiarCantidad(ultimo, delta);
  }
  renderDrawerBody();
}

function quitarItemDrawer(idxs) {
  // de mayor a menor índice: sacar uno no debe correr los índices de
  // los que todavía faltan sacar del mismo grupo
  [...idxs].sort((a, b) => b - a).forEach(i => quitarItem(i));
  renderDrawerBody();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawerAbierto) cerrarCarritoDrawer();
});

/* ================================================================
   ENVÍO DEL PEDIDO A SUPABASE — usado por carrito-page.js

   El id del pedido se genera en el cliente (uuid) porque un invitado
   no tiene permiso de SELECT sobre `pedidos` (RLS: solo admin puede
   leer pedidos), así que insert(...).select() nunca podría devolver
   la fila — generarlo antes evita necesitar leerla de vuelta.
   ================================================================ */
function generarUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  // Fallback simple para navegadores/contextos sin crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function enviarPedidoSupabase({ nombre, telefono, nota }, items) {
  if (!nombre || !telefono || !items.length) {
    return { ok: false, error: 'Faltan datos' };
  }

  const pedidoId = generarUUID();

  const { error: errPedido } = await sb
    .from('pedidos')
    .insert({
      id:               pedidoId,
      cliente_nombre:   nombre,
      cliente_telefono: telefono,
      monto_estimado:   totalCarrito(items),
      nota:             nota || null,
    });

  if (errPedido) return { ok: false, error: errPedido.message };

  const filas = items.map(it => ({
    pedido_id:       pedidoId,
    producto_id:     it.productoId,
    producto_nombre: it.nombre,
    talle:           it.talle || '',
    color:           it.color || '',
    cantidad:        it.cantidad,
    precio_unitario: it.precioUnitario,
  }));

  const { error: errItems } = await sb.from('pedido_items').insert(filas);
  if (errItems) return { ok: false, error: errItems.message };

  guardarPedidoLocal(pedidoId, { fecha: new Date().toISOString(), montoEstimado: totalCarrito(items) });
  vaciarCarrito();
  return { ok: true, pedidoId };
}

/* ================================================================
   "MIS PEDIDOS" — lista local (sin cuenta) de los pedidos hechos
   desde este navegador, para poder consultarlos después sin
   depender de que llegue el WhatsApp de confirmación.
   ================================================================ */
function guardarPedidoLocal(pedidoId, resumen) {
  try {
    const lista = leerMisPedidosLocal();
    lista.unshift({ id: pedidoId, ...resumen });
    localStorage.setItem(MIS_PEDIDOS_KEY, JSON.stringify(lista));
  } catch (_) {}
}

export function leerMisPedidosLocal() {
  try {
    return JSON.parse(localStorage.getItem(MIS_PEDIDOS_KEY)) || [];
  } catch (_) {
    return [];
  }
}

/* ================================================================
   INIT — llamar una vez por página (catalogo.js / producto.js)
   ================================================================ */
export function initCarritoUI() {
  actualizarBadge();
}

window.cerrarToastCarritoUI    = cerrarToast;
window.abrirCarritoDrawerUI    = abrirCarritoDrawer;
window.cerrarCarritoDrawerUI   = cerrarCarritoDrawer;
window.cambiarCantidadDrawerUI = cambiarCantidadDrawer;
window.quitarItemDrawerUI      = quitarItemDrawer;
