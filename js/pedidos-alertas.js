/* ================================================================
   pedidos-alertas.js — Notificación visual para el admin cuando
   entra un pedido nuevo, en cualquier página del sitio (igual que
   topbar.js / footer.js: un módulo compartido, no copiado en cada
   página).

   initAlertasPedidos(rol) no hace nada si rol !== 'admin' — un
   invitado no debe ni enterarse de que existe este contador.

   Muestra:
     - una campanita con contador en la topbar (cuántos pedidos están
       en estado "espera", sin revisar todavía) que lleva a
       pedidos.html.
     - un aviso apilable en la esquina cuando entra un pedido nuevo en
       tiempo real, mientras el admin está navegando cualquier página
       del sitio (no hace falta tener pedidos.html abierto).
   ================================================================ */
import { sb } from './supabase-client.js';

let suscripto = false;
let alertaSeq = 0;

export function initAlertasPedidos(rol) {
  if (rol !== 'admin') return;

  montarCampanita();
  actualizarContador();

  if (suscripto) return;
  suscripto = true;

  sb.channel('pedidos-alertas')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pedidos' },
      (payload) => {
        actualizarContador();
        mostrarAlertaPedidoNuevo(payload.new);
      })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'pedidos' },
      () => actualizarContador())
    .subscribe();
}

/* ================================================================
   CAMPANITA + CONTADOR (topbar)
   ================================================================ */
function montarCampanita() {
  const iconos = document.querySelector('.topbar-icons');
  if (!iconos || document.getElementById('pedido-alert-btn')) return;

  const btn = document.createElement('a');
  btn.id = 'pedido-alert-btn';
  btn.className = 'icon-btn';
  btn.href = 'pedidos.html';
  btn.title = 'Pedidos por revisar';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;stroke:currentColor">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
    <span class="alert-badge" id="pedido-alert-badge"></span>`;

  // Se agrupa junto al resto de accesos rápidos, antes del carrito.
  const cartBtn = document.getElementById('cart-btn');
  iconos.insertBefore(btn, cartBtn || iconos.firstChild);
}

async function actualizarContador() {
  const badge = document.getElementById('pedido-alert-badge');
  if (!badge) return;

  const { count, error } = await sb
    .from('pedidos')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'espera');

  if (error) { console.warn('Error contando pedidos en espera:', error.message); return; }

  badge.textContent = count > 0 ? String(count) : '';
  badge.style.display = count > 0 ? 'flex' : 'none';
}

/* ================================================================
   AVISO DE PEDIDO NUEVO (esquina de la página, apilable — mismo
   criterio que el toast de "agregado al carrito" en carrito.js, pero
   en un contenedor propio del lado opuesto para no mezclarse).
   ================================================================ */
function stackAlertas() {
  let stack = document.getElementById('pedido-alerta-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'pedido-alerta-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function mostrarAlertaPedidoNuevo(pedido) {
  const stack = stackAlertas();
  const id = `pedido-alerta-${++alertaSeq}`;

  const el = document.createElement('div');
  el.className = 'carrito-toast';
  el.id = id;
  el.innerHTML = `
    <div class="carrito-toast-icon pedido-alerta-icon">🔔</div>
    <div class="carrito-toast-body">
      <div class="carrito-toast-titulo">Nuevo pedido</div>
      <div class="carrito-toast-nombre">${pedido?.cliente_nombre || 'Cliente'}</div>
    </div>
    <a class="btn sm primary" href="pedidos.html">Ver</a>
    <button type="button" class="carrito-toast-cerrar" onclick="cerrarAlertaPedidoUI('${id}')" aria-label="Cerrar">✕</button>`;

  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  setTimeout(() => cerrarAlertaPedido(id), 6000);
}

function cerrarAlertaPedido(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => el.remove(), 200);
}

window.cerrarAlertaPedidoUI = cerrarAlertaPedido;
