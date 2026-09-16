/* ================================================================
   pedidos-alertas.js — Avisos para el admin en cualquier página del
   sitio (igual que topbar.js / footer.js: un módulo compartido, no
   copiado en cada página).

   initAlertasPedidos(rol) no hace nada si rol !== 'admin' — un
   invitado no debe ni enterarse de que existen estos contadores.
   (El nombre quedó de cuando solo avisaba pedidos; se mantiene para no
   tocar todas las páginas que lo llaman.)

   Muestra:
     - PEDIDOS: una campanita con contador en la topbar (cuántos
       pedidos están en estado "espera", sin revisar todavía) que lleva
       a pedidos.html, y un aviso en la esquina cuando entra uno nuevo.
     - MENSAJES DE INSTAGRAM: un ícono de chat con la cantidad de
       mensajes sin leer que lleva a mensajes.html, y un aviso cuando
       entra un mensaje nuevo (ver sql/2026-09-16_instagram_inbox.sql).
       Si esa conversación ya está abierta en mensajes.html, no avisa
       (ver setConversacionAbiertaIG).
   ================================================================ */
import { sb } from './supabase-client.js';

let suscripto = false;
let alertaSeq = 0;
let conversacionAbiertaIG = null;

export function initAlertasPedidos(rol) {
  if (rol !== 'admin') return;

  montarBoton({
    id: 'pedido-alert-btn',
    badgeId: 'pedido-alert-badge',
    href: 'pedidos.html',
    title: 'Pedidos por revisar',
    svg: `<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  });
  montarBoton({
    id: 'ig-alert-btn',
    badgeId: 'ig-alert-badge',
    href: 'mensajes.html',
    title: 'Mensajes de Instagram sin leer',
    svg: `<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>`,
  });
  actualizarContadorPedidos();
  actualizarContadorMensajes();

  if (suscripto) return;
  suscripto = true;

  sb.channel('pedidos-alertas')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'pedidos' },
      (payload) => {
        actualizarContadorPedidos();
        mostrarAlertaPedidoNuevo(payload.new);
      })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'pedidos' },
      () => actualizarContadorPedidos())
    .subscribe();

  sb.channel('ig-alertas')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ig_mensajes' },
      (payload) => {
        if (payload.new?.direccion === 'entrante') mostrarAlertaMensajeNuevo(payload.new);
      })
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'ig_conversaciones' },
      () => actualizarContadorMensajes())
    .subscribe();
}

/* mensajes.html avisa qué conversación tiene abierta (o null al
   cerrarla), para no mostrar un aviso de algo que ya se está leyendo. */
export function setConversacionAbiertaIG(id) {
  conversacionAbiertaIG = id || null;
}

/* ================================================================
   ÍCONOS + CONTADORES (topbar)
   ================================================================ */
function montarBoton({ id, badgeId, href, title, svg }) {
  const iconos = document.querySelector('.topbar-icons');
  if (!iconos || document.getElementById(id)) return;

  const btn = document.createElement('a');
  btn.id = id;
  btn.className = 'icon-btn alert-btn';
  btn.href = href;
  btn.title = title;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;stroke:currentColor">
      ${svg}
    </svg>
    <span class="alert-badge" id="${badgeId}"></span>`;

  // Se agrupa junto al resto de accesos rápidos, antes del carrito.
  const cartBtn = document.getElementById('cart-btn');
  iconos.insertBefore(btn, cartBtn || iconos.firstChild);
}

function pintarBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  badge.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  badge.style.display = count > 0 ? 'flex' : 'none';
}

async function actualizarContadorPedidos() {
  if (!document.getElementById('pedido-alert-badge')) return;

  const { count, error } = await sb
    .from('pedidos')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'espera');

  if (error) { console.warn('Error contando pedidos en espera:', error.message); return; }
  pintarBadge('pedido-alert-badge', count);
}

async function actualizarContadorMensajes() {
  if (!document.getElementById('ig-alert-badge')) return;

  const { data, error } = await sb
    .from('ig_conversaciones')
    .select('no_leidos')
    .gt('no_leidos', 0);

  // Si la migración de Instagram todavía no se corrió, la tabla no
  // existe: se deja el ícono sin número, sin ensuciar la consola.
  if (error) { console.debug('Contador de mensajes no disponible:', error.message); return; }
  pintarBadge('ig-alert-badge', (data || []).reduce((s, c) => s + (c.no_leidos || 0), 0));
}

/* ================================================================
   AVISOS (esquina de la página, apilables — mismo criterio que el
   toast de "agregado al carrito" en carrito.js, pero en un contenedor
   propio del lado opuesto para no mezclarse).
   ================================================================ */
function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function stackAlertas() {
  let stack = document.getElementById('pedido-alerta-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'pedido-alerta-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

function mostrarAviso({ icono, iconoClase, titulo, detalle, href }) {
  const stack = stackAlertas();
  const id = `pedido-alerta-${++alertaSeq}`;

  const el = document.createElement('div');
  el.className = 'carrito-toast';
  el.id = id;
  el.innerHTML = `
    <div class="carrito-toast-icon ${iconoClase}">${icono}</div>
    <div class="carrito-toast-body">
      <div class="carrito-toast-titulo">${escapar(titulo)}</div>
      <div class="carrito-toast-nombre">${escapar(detalle)}</div>
    </div>
    <a class="btn sm primary" href="${escapar(href)}">Ver</a>
    <button type="button" class="carrito-toast-cerrar" onclick="cerrarAlertaPedidoUI('${id}')" aria-label="Cerrar">✕</button>`;

  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  setTimeout(() => cerrarAlertaPedido(id), 6000);
}

function mostrarAlertaPedidoNuevo(pedido) {
  mostrarAviso({
    icono: '🔔',
    iconoClase: 'pedido-alerta-icon',
    titulo: 'Nuevo pedido',
    detalle: pedido?.cliente_nombre || 'Cliente',
    href: 'pedidos.html',
  });
}

async function mostrarAlertaMensajeNuevo(mensaje) {
  const enPantalla = conversacionAbiertaIG === mensaje.conversacion_id
    && document.visibilityState === 'visible';
  if (enPantalla) return;

  const { data: conv } = await sb
    .from('ig_conversaciones')
    .select('username, nombre')
    .eq('id', mensaje.conversacion_id)
    .maybeSingle();

  const quien = conv?.username ? `@${conv.username}` : (conv?.nombre || 'Instagram');
  const texto = mensaje.texto || '📎 Adjunto';
  mostrarAviso({
    icono: '💬',
    iconoClase: 'ig-alerta-icon',
    titulo: `Mensaje de ${quien}`,
    detalle: texto.length > 80 ? texto.slice(0, 80) + '…' : texto,
    href: `mensajes.html?c=${encodeURIComponent(mensaje.conversacion_id)}`,
  });
}

function cerrarAlertaPedido(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => el.remove(), 200);
}

window.cerrarAlertaPedidoUI = cerrarAlertaPedido;
