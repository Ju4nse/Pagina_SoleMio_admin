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

export function agregarAlCarrito({ productoId, nombre, precioUnitario, imagen, talle, color, cantidad }) {
  const items = leerCarrito();
  const cant  = Math.max(1, parseInt(cantidad, 10) || 1);
  const idx   = items.findIndex(it =>
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
   TOAST "agregado al carrito" — se muestra al costado de la página
   (no navega, no interrumpe el catálogo) con un link a carrito.html
   ================================================================ */
let toastTimer = null;

function mostrarToastAgregado(nombre) {
  const container = document.getElementById('modal-carrito');
  if (!container) return;

  container.innerHTML = `
    <div class="carrito-toast" id="carrito-toast">
      <div class="carrito-toast-icon">✓</div>
      <div class="carrito-toast-body">
        <div class="carrito-toast-titulo">Producto agregado a tu pedido</div>
        <div class="carrito-toast-nombre">${nombre}</div>
      </div>
      <a class="btn sm primary" href="carrito.html">Ver pedido</a>
      <button type="button" class="carrito-toast-cerrar" onclick="cerrarToastCarritoUI()" aria-label="Cerrar">✕</button>
    </div>`;

  requestAnimationFrame(() => {
    document.getElementById('carrito-toast')?.classList.add('open');
  });

  clearTimeout(toastTimer);
  toastTimer = setTimeout(cerrarToast, 4000);
}

function cerrarToast() {
  const toast = document.getElementById('carrito-toast');
  if (!toast) return;
  toast.classList.remove('open');
  setTimeout(() => {
    const container = document.getElementById('modal-carrito');
    if (container) container.innerHTML = '';
  }, 200);
}

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

window.cerrarToastCarritoUI = cerrarToast;
