/* ================================================================
   pedido-estado.js — Consulta pública del estado de un pedido
   (sin necesidad de cuenta). Usa las funciones RPC
   obtener_pedido_publico / obtener_pedido_items_publico, que
   devuelven un único pedido por su id exacto — no listan ni buscan.
   ================================================================ */
import { sb, esAdmin } from './supabase-client.js';
import { initTheme, toggleTheme } from './theme.js';
import { leerMisPedidosLocal, initCarritoUI, TIEMPO_REVISION_HORAS } from './carrito.js';
import { renderTopbar } from './topbar.js';
import { renderFooter } from './footer.js';

let rolActual = 'guest';

const ESTADO_LABEL = {
  espera:      'Pendiente de revisión',
  revisado:    'Revisado',
  confirmado:  'Confirmado',
  cancelado:   'Sin stock',
};

const ESTADO_DESC = {
  espera:     `Todavía estamos revisando la disponibilidad real de cada producto (puede demorar hasta ${TIEMPO_REVISION_HORAS} horas hábiles). Te contactaremos por WhatsApp apenas lo confirmemos.`,
  revisado:   'Revisamos tu pedido: puede que hayamos ajustado el talle, color o cantidad de algún producto, o que alguno no tenga stock — revisá el detalle de cada uno más abajo.',
  confirmado: 'Confirmamos todos los productos de tu pedido tal como los pediste.',
  cancelado:  'Lamentablemente no pudimos confirmar disponibilidad de ningún producto de este pedido.',
};

function fmtARS(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-AR');
}

function fmtFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function talleFinal(it)    { return it.talle_final    ?? (it.talle || ''); }
function colorFinal(it)    { return it.color_final    ?? (it.color || ''); }
function cantidadFinal(it) { return it.cantidad_final ?? it.cantidad; }
function attrsPedidas(it)  { return [it.talle, it.color].filter(Boolean).join(' · '); }
function attrsFinales(it)  { return [talleFinal(it), colorFinal(it)].filter(Boolean).join(' · '); }

function getIdDeUrl() {
  return new URLSearchParams(location.search).get('id');
}

/* ================================================================
   RENDER
   ================================================================ */
function renderBuscador(mensaje) {
  const root = document.getElementById('pedido-estado-root');
  root.innerHTML = `
    <div class="carrito-page-aside" style="max-width:420px;margin:2rem auto">
      <h1 class="carrito-page-title" style="font-size:1.25rem;margin-top:0">Buscar un pedido</h1>
      ${mensaje ? `<p style="font-size:0.85rem;color:var(--text-2);margin-top:-0.5rem">${mensaje}</p>` : ''}
      <form onsubmit="return buscarPedidoUI(event)">
        <div class="field">
          <label>Código del pedido</label>
          <input id="pe-codigo" type="text" required placeholder="El código que te dimos al confirmarlo">
        </div>
        <button type="submit" class="btn primary carrito-btn-full">Ver pedido</button>
      </form>
    </div>`;
}

/* Lista de pedidos hechos desde este navegador (localStorage, sin
   cuenta). Si está vacía (otro dispositivo, borró el navegador),
   se ofrece la búsqueda manual por código como alternativa. */
async function renderMisPedidos() {
  const root    = document.getElementById('pedido-estado-root');
  const locales = leerMisPedidosLocal();

  if (!locales.length) {
    renderBuscador('Todavía no encontramos pedidos hechos desde este navegador. Si tenés el código de un pedido hecho desde otro dispositivo, buscalo acá:');
    return;
  }

  renderCargando();

  const resultados = await Promise.all(locales.map(async l => {
    const { data, error } = await sb.rpc('obtener_pedido_publico', { p_pedido_id: l.id });
    if (error) console.warn('Error consultando pedido', l.id, error.message);
    return (data && data[0]) || {
      id: l.id, cliente_nombre: '', estado: null,
      monto_estimado: l.montoEstimado, monto_final: null, created_at: l.fecha,
    };
  }));

  root.innerHTML = `
    <div style="max-width:640px;margin:0 auto 3rem">
      <h1 class="carrito-page-title">Mis pedidos</h1>
      <div class="pedidos-lista">
        ${resultados.map(p => `
          <article class="pedido-row" onclick="location.href='pedido-estado.html?id=${p.id}'">
            <div class="pedido-row-main">
              <div class="pedido-row-cliente">Pedido del ${fmtFecha(p.created_at)}</div>
              <div class="pedido-row-meta">${p.estado ? '' : 'No encontramos este pedido'}</div>
            </div>
            <div class="pedido-row-right">
              ${p.estado ? `<span class="badge badge-estado-${p.estado}">${ESTADO_LABEL[p.estado] || p.estado}</span>` : ''}
              <span class="pedido-row-monto">${fmtARS(p.estado && p.estado !== 'espera' ? p.monto_final : p.monto_estimado)}</span>
            </div>
          </article>
        `).join('')}
      </div>

      <p style="font-size:0.8rem;color:var(--text-3);text-align:center;margin-top:1.5rem">
        ¿Tenés el código de un pedido hecho desde otro dispositivo?
        <a href="#" onclick="mostrarBuscadorUI(event)">Buscalo acá</a>.
      </p>
    </div>`;
}

function renderCargando() {
  const root = document.getElementById('pedido-estado-root');
  root.innerHTML = `
    <div class="empty" style="margin-top:3rem">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      Buscando tu pedido…
    </div>`;
}

function renderNoEncontrado() {
  renderBuscador('No encontramos ningún pedido con ese código. Revisá el link o código que te compartimos al confirmarlo.');
}

function renderPedido(p, items) {
  const root = document.getElementById('pedido-estado-root');

  root.innerHTML = `
    <div style="max-width:640px;margin:0 auto 3rem">
      <a href="pedido-estado.html" style="font-size:0.78rem;color:var(--text-2)">← Mis pedidos</a>
      <h1 class="carrito-page-title">Tu pedido</h1>

      <div class="pedido-detalle-cliente" style="margin-bottom:1.25rem">
        <div><strong>${p.cliente_nombre}</strong></div>
        <div style="font-size:.78rem;color:var(--text-3);margin-top:.15rem">Hecho el ${fmtFecha(p.created_at)}</div>
      </div>

      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem">
        <span class="badge badge-estado-${p.estado}">${ESTADO_LABEL[p.estado] || p.estado}</span>
      </div>
      <p style="font-size:0.85rem;color:var(--text-2);line-height:1.55;margin:0 0 1.25rem">
        ${ESTADO_DESC[p.estado] || ''}
      </p>

      <div class="pedido-items-edit" style="max-height:none">
        ${items.map(it => renderItemEstado(it)).join('')}
      </div>

      <div class="carrito-total" style="margin-top:1.25rem">
        <span>${p.estado === 'espera' ? 'Total estimado' : 'Total a pagar'}</span>
        <strong>${fmtARS(p.estado === 'espera' ? p.monto_estimado : p.monto_final)}</strong>
      </div>

      ${p.nota ? `<div class="pedido-nota" style="margin-top:.75rem">Tu nota: "${p.nota}"</div>` : ''}
    </div>`;
}

function renderItemEstado(it) {
  const pedidoAttrs   = attrsPedidas(it);
  const finalAttrs    = attrsFinales(it);
  const cantPedida    = it.cantidad;
  const cantConfirmada = cantidadFinal(it);

  const talleCambio = talleFinal(it) !== (it.talle || '');
  const colorCambio = colorFinal(it) !== (it.color || '');
  const cantCambio  = cantConfirmada !== cantPedida;
  const huboCambios = talleCambio || colorCambio || cantCambio;

  const estadoTag = it.disponible === true
    ? `<span class="badge badge-estado-confirmado">Disponible</span>`
    : it.disponible === false
      ? `<span class="badge badge-estado-cancelado">Sin stock</span>`
      : `<span class="badge badge-estado-espera">Sin revisar</span>`;

  return `
    <div class="pedido-item-edit" style="align-items:center">
      <div class="pedido-item-edit-info">
        <div class="pedido-item-edit-nombre">${it.producto_nombre}</div>
        <div style="font-size:.78rem;color:var(--text-3);margin-top:.25rem">
          Pediste: ${pedidoAttrs || 'sin detalle'} · x${cantPedida}
        </div>
        ${huboCambios ? `
          <div style="font-size:.78rem;color:var(--primary-dark);margin-top:.15rem">
            Confirmamos: ${finalAttrs || 'sin detalle'} · x${cantConfirmada}
          </div>` : ''}
        <div class="pedido-item-edit-precio">${fmtARS(it.precio_unitario * cantConfirmada)}</div>
      </div>
      ${estadoTag}
    </div>`;
}

/* ================================================================
   CARGA
   ================================================================ */
async function buscarPedido(id) {
  if (!id) { await renderMisPedidos(); return; }

  renderCargando();

  const { data: pedidoRows, error } = await sb.rpc('obtener_pedido_publico', { p_pedido_id: id });
  if (error) console.warn('Error consultando pedido', id, error.message);

  if (error || !pedidoRows || !pedidoRows.length) {
    renderNoEncontrado();
    return;
  }

  const pedido = pedidoRows[0];

  const { data: itemsRows, error: errItems } = await sb.rpc('obtener_pedido_items_publico', { p_pedido_id: id });
  if (errItems) console.warn('Error cargando ítems del pedido:', errItems.message);

  renderPedido(pedido, itemsRows || []);
}

function buscarPedidoDesdeForm(event) {
  event.preventDefault();
  const codigo = document.getElementById('pe-codigo')?.value.trim();
  if (!codigo) return false;
  history.replaceState(null, '', `pedido-estado.html?id=${encodeURIComponent(codigo)}`);
  buscarPedido(codigo);
  return false;
}

function mostrarBuscador(event) {
  event.preventDefault();
  renderBuscador();
  return false;
}

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
  renderTopbar('mis-pedidos');
  renderFooter();
  initTheme();
  initCarritoUI();

  rolActual = await detectarRol();
  const app = document.getElementById('app');
  app.dataset.role = rolActual;

  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = rolActual === 'admin' ? 'Admin' : 'Invitado';
    badge.className   = 'role-badge ' + rolActual;
  }

  app.style.display = 'block';

  await buscarPedido(getIdDeUrl());
}

init();

window.toggleTheme       = toggleTheme;
window.buscarPedidoUI    = buscarPedidoDesdeForm;
window.mostrarBuscadorUI = mostrarBuscador;
window.doLogout          = doLogout;
