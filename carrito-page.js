/* ================================================================
   carrito-page.js — Página dedicada del carrito (carrito.html)

   Acá el cliente revisa/edita su pedido, ve explicado el proceso de
   revisión manual, y lo confirma dejando nombre + WhatsApp. No hace
   falta sesión: funciona igual para invitados y para admin.
   ================================================================ */
import { sb, esAdmin } from './supabase-client.js';
import { ICON, initTheme, toggleTheme } from './theme.js';
import {
  leerCarrito, quitarItem, cambiarCantidad, totalCarrito,
  enviarPedidoSupabase, actualizarBadge, fmtARS, TIEMPO_REVISION_HORAS,
} from './carrito.js';
import { renderTopbar } from './topbar.js';

let vista            = 'carrito'; // 'carrito' | 'listo'
let rolActual         = 'guest';
let pedidoIdCreado    = null;

function render() {
  const root = document.getElementById('carrito-page-root');
  if (!root) return;
  root.innerHTML = vista === 'listo' ? renderListo() : renderCarrito(leerCarrito());
  actualizarBadge();
}

function renderCarrito(items) {
  if (!items.length) {
    return `
      <h1 class="carrito-page-title">Tu pedido</h1>
      <div class="carrito-vacio" style="margin-top:2rem">
        Todavía no agregaste productos a tu pedido.<br>
        <a class="btn primary" href="catalogo.html" style="margin-top:1rem;display:inline-flex">Ir al catálogo</a>
      </div>`;
  }

  return `
    <h1 class="carrito-page-title">Tu pedido</h1>
    <div class="carrito-page-grid">
      <div class="carrito-items">
        ${items.map((it, idx) => `
          <div class="carrito-item">
            <div class="carrito-item-img">
              ${it.imagen
                ? `<img src="${it.imagen}" alt="${it.nombre}"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                   <div class="carrito-item-img-ph" style="display:none">${ICON.shoe}</div>`
                : `<div class="carrito-item-img-ph">${ICON.shoe}</div>`}
            </div>
            <div class="carrito-item-info">
              <div class="carrito-item-nombre">${it.nombre}</div>
              <div class="carrito-item-attrs">${[it.talle, it.color].filter(Boolean).join(' · ') || '&nbsp;'}</div>
              <div class="carrito-item-precio">${fmtARS(it.precioUnitario)} c/u</div>
            </div>
            <div class="carrito-item-qty">
              <button type="button" class="btn-qty" onclick="cambiarCantidadUI(${idx},-1)">−</button>
              <span>${it.cantidad}</span>
              <button type="button" class="btn-qty" onclick="cambiarCantidadUI(${idx},1)">+</button>
            </div>
            <button type="button" class="btn-quitar-item" onclick="quitarItemUI(${idx})" title="Quitar">✕</button>
          </div>
        `).join('')}
      </div>

      <aside class="carrito-page-aside">
        <div class="carrito-explica">
          <h2>Cómo continúa tu pedido</h2>
          <ol>
            <li>Al confirmar, tu pedido queda registrado como pendiente de revisión. Esto no representa un cargo ni una compra confirmada.</li>
            <li>Nuestro equipo verifica manualmente la disponibilidad real de cada talle y color solicitado — la revisión puede demorar hasta ${TIEMPO_REVISION_HORAS} horas hábiles.</li>
            <li>Te contactamos por WhatsApp para confirmar los productos disponibles y el monto final a abonar.</li>
            <li>Una vez confirmado, coordinamos el medio de pago y la modalidad de entrega o retiro.</li>
          </ol>
        </div>

        <form onsubmit="return enviarPedidoUI(event)">
          <div class="field">
            <label>Nombre y apellido</label>
            <input id="chk-nombre" type="text" required autocomplete="name">
          </div>
          <div class="field">
            <label>WhatsApp / teléfono</label>
            <input id="chk-telefono" type="tel" required autocomplete="tel" placeholder="Ej: 2494 123456">
          </div>
          <div class="field">
            <label>Nota (opcional)</label>
            <textarea id="chk-nota" placeholder="Alguna aclaración para tu pedido…"></textarea>
          </div>
          <div class="carrito-total">
            <span>Total estimado</span>
            <strong>${fmtARS(totalCarrito(items))}</strong>
          </div>
          <div id="chk-error" class="carrito-error" style="display:none"></div>
          <button type="submit" class="btn primary carrito-btn-full" id="chk-submit-btn">Confirmar pedido</button>
        </form>
      </aside>
    </div>`;
}

function renderListo() {
  const linkEstado = pedidoIdCreado ? `pedido-estado.html?id=${encodeURIComponent(pedidoIdCreado)}` : null;

  return `
    <div class="carrito-listo">
      <div class="carrito-listo-icon">✓</div>
      <p>Recibimos tu pedido correctamente. La revisión puede demorar hasta
        ${TIEMPO_REVISION_HORAS} horas hábiles; nos vamos a contactar por
        WhatsApp para confirmar la disponibilidad y el monto final a abonar.</p>

      ${linkEstado ? `
        <div class="carrito-explica" style="text-align:left;margin-bottom:1.5rem">
          <h2 style="margin-bottom:0.4rem">Guardá este link para consultar tu pedido</h2>
          <p style="font-size:0.8rem;color:var(--text-2);line-height:1.5;margin:0 0 0.6rem">
            Ahí vas a poder ver el estado de tu pedido y, si hicimos algún cambio
            (por ejemplo de color o cantidad), vas a poder verlo aunque todavía
            no te hayamos escrito por WhatsApp.
          </p>
          <a class="btn ghost carrito-btn-full" href="${linkEstado}">Ver el estado de mi pedido</a>
        </div>` : ''}

      <a class="btn primary" href="catalogo.html">Volver al catálogo</a>
    </div>`;
}

function cambiarCantidadUI(idx, delta) {
  cambiarCantidad(idx, delta);
  render();
}

function quitarItemUI(idx) {
  quitarItem(idx);
  render();
}

async function enviarPedido(event) {
  event.preventDefault();

  const nombre   = document.getElementById('chk-nombre')?.value.trim();
  const telefono = document.getElementById('chk-telefono')?.value.trim();
  const nota     = document.getElementById('chk-nota')?.value.trim();
  const errorEl  = document.getElementById('chk-error');
  const btn      = document.getElementById('chk-submit-btn');
  const items    = leerCarrito();

  if (!nombre || !telefono || !items.length) return false;

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  if (errorEl) errorEl.style.display = 'none';

  const res = await enviarPedidoSupabase({ nombre, telefono, nota }, items);

  if (res.ok) {
    pedidoIdCreado = res.pedidoId;
    vista = 'listo';
    render();
  } else {
    console.warn('Error enviando pedido:', res.error);
    if (errorEl) {
      errorEl.textContent = 'No fue posible enviar tu pedido. Por favor, intentá nuevamente en unos minutos.';
      errorEl.style.display = 'block';
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pedido'; }
  }

  return false;
}

/* ================================================================
   ROL — solo para mostrar/ocultar el link "Pedidos" (admin-only)
   ================================================================ */
async function detectarRol() {
  // La sesión real de Supabase se chequea primero (no el flag de
  // invitado): evita que un admin quede pegado en modo invitado.
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user && await esAdmin(session.user.email)) {
    sessionStorage.removeItem('solemio-role');
    return 'admin';
  }

  const rolGuardado = sessionStorage.getItem('solemio-role');
  if (rolGuardado === 'guest') return 'guest';
  return 'guest';
}

async function doLogout() {
  if (rolActual === 'admin') {
    const { error } = await sb.auth.signOut();
    if (error) console.error('[LOGOUT ERROR]', error);
  }
  sessionStorage.removeItem('solemio-role');
  window.location.href = 'login.html';
}

async function init() {
  renderTopbar('carrito');
  initTheme();
  actualizarBadge();
  render();

  rolActual = await detectarRol();
  const app = document.getElementById('app');
  app.dataset.role = rolActual;

  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = rolActual === 'admin' ? 'Admin' : 'Invitado';
    badge.className   = 'role-badge ' + rolActual;
  }

  app.style.display = 'block';
}

window.toggleTheme        = toggleTheme;
window.cambiarCantidadUI  = cambiarCantidadUI;
window.quitarItemUI       = quitarItemUI;
window.enviarPedidoUI     = enviarPedido;
window.doLogout           = doLogout;

init();
