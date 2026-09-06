/* ================================================================
   carrito-page.js — Página dedicada del carrito (carrito.html)

   Acá el cliente revisa/edita su pedido, ve explicado el proceso de
   revisión manual, y lo confirma dejando nombre + WhatsApp. No hace
   falta sesión: funciona igual para invitados y para admin.
   ================================================================ */
import { sb, esAdmin } from './supabase-client.js';
import { ICON, initTheme, toggleTheme, hexDeColor } from './theme.js';
import {
  leerCarrito, quitarItem, cambiarCantidad, totalCarrito,
  enviarPedidoSupabase, actualizarBadge, fmtARS, TIEMPO_REVISION_HORAS,
  actualizarAtributoItem, variantesFallbackDesdeTexto, combinarVariantesConTexto,
} from './carrito.js';
import { renderTopbar } from './topbar.js';
import { renderFooter } from './footer.js';
import { initAlertasPedidos } from './pedidos-alertas.js';

let vista            = 'carrito'; // 'carrito' | 'listo'
let rolActual         = 'guest';
let pedidoIdCreado    = null;

/* ================================================================
   VARIANTES POR PRODUCTO (talle/color) — para los ítems que se
   agregaron sin elegirlos (botón rápido del catálogo). Se cachean
   por productoId para no repetir consultas al re-renderizar.
   variantesCache[id] === undefined  → todavía no se cargaron
   variantesCache[id] === []         → cargadas, el producto no tiene variantes
   ================================================================ */
let variantesCache     = {};
let precioBaseCache    = {}; // productoId -> precio base del producto (sin markup)

async function cargarVariantesParaItems(items) {
  const ids = [...new Set(items.map(it => it.productoId))]
    .filter(id => variantesCache[id] === undefined);
  if (!ids.length) return;

  const [{ data: talles }, { data: prods }] = await Promise.all([
    sb.from('producto_talles').select('producto_id, talle, color, precio').eq('activo', true).in('producto_id', ids).order('orden', { ascending: true }),
    sb.from('productos').select('id, talles, color, precio').in('id', ids),
  ]);

  const prodMap = new Map((prods || []).map(p => [p.id, p]));
  ids.forEach(id => {
    const variantesDB = (talles || [])
      .filter(t => t.producto_id === id)
      .map(t => ({ talle: t.talle, color: t.color || '', precio: t.precio ?? null }));
    const prod = prodMap.get(id);
    precioBaseCache[id] = prod?.precio || 0;
    variantesCache[id] = variantesDB.length
      ? combinarVariantesConTexto(variantesDB, prod || {})
      : (prod ? variantesFallbackDesdeTexto(prod) : []);
  });
}

/* Igual que en producto.js: una combinación de talle/color puede tener
   su propio precio (dos productos del scraper que en el fondo son la
   misma prenda, ej. "AG0108"/"AG0108B"). Se aplica recién cuando se
   termina de elegir esa combinación acá — hasta entonces vale el
   precio con el que se agregó (el precio base del producto). */
function precioUnitarioDeItem(it) {
  const variantes = variantesCache[it.productoId] || [];
  const match = variantes.find(v => v.talle === (it.talle || '') && v.color === (it.color || ''));
  const base = (match && match.precio != null) ? match.precio : precioBaseCache[it.productoId];
  return base != null ? Math.round(base * 1.5) : null;
}

function tallesDelItem(it) {
  return [...new Set((variantesCache[it.productoId] || []).map(v => v.talle).filter(Boolean))];
}

function coloresDelItem(it) {
  const variantes = variantesCache[it.productoId] || [];
  return [...new Set(
    variantes.filter(v => !it.talle || v.talle === it.talle).map(v => v.color).filter(Boolean)
  )];
}

/* true si al ítem todavía le falta un talle o color que el producto
   sí tiene cargado (bloquea la confirmación del pedido). */
function faltaSeleccion(it) {
  const variantes = variantesCache[it.productoId];
  if (variantes === undefined) return true; // todavía no se sabe: por las dudas, bloquea
  const faltaTalle = tallesDelItem(it).length > 0 && !it.talle;
  const faltaColor = coloresDelItem(it).length > 0 && !it.color;
  return faltaTalle || faltaColor;
}

function renderSelectorItem(it, idx) {
  const variantes = variantesCache[it.productoId];
  if (variantes === undefined) {
    return (!it.talle || !it.color)
      ? `<p class="carrito-item-selector-cargando">Cargando opciones…</p>`
      : '';
  }

  const talles = tallesDelItem(it);
  const colores = coloresDelItem(it);
  const faltaTalle = talles.length > 0 && !it.talle;
  const faltaColor = colores.length > 0 && !it.color;
  if (!faltaTalle && !faltaColor) return '';

  return `
    <div class="carrito-item-selector">
      ${faltaTalle ? `
        <div class="attr-group">
          <span class="attr-label">Elegí un talle</span>
          ${talles.map(t => `
            <button type="button" class="attr-tag selector-chip" onclick="elegirTalleItemUI(${idx},&quot;${t.replace(/"/g, '&quot;')}&quot;)">${t}</button>
          `).join('')}
        </div>` : ''}
      ${faltaColor ? `
        <div class="attr-group">
          <span class="attr-label">Elegí un color</span>
          ${colores.map(c => {
            const hex = hexDeColor(c);
            return `
              <button type="button" class="color-tag selector-chip" onclick="elegirColorItemUI(${idx},&quot;${c.replace(/"/g, '&quot;')}&quot;)">
                <span class="color-dot ${hex ? '' : 'color-dot-generic'}" style="${hex ? `background:${hex}` : ''}"></span>${c}
              </button>`;
          }).join('')}
        </div>` : ''}
    </div>`;
}

function elegirTalleItem(idx, talle) {
  const items = leerCarrito();
  const it = items[idx];
  if (!it) return;

  const cambios = { talle };
  const coloresParaEseTalle = new Set(
    (variantesCache[it.productoId] || []).filter(v => v.talle === talle).map(v => v.color).filter(Boolean)
  );
  if (it.color && !coloresParaEseTalle.has(it.color)) cambios.color = '';

  const precio = precioUnitarioDeItem({ ...it, ...cambios });
  if (precio != null) cambios.precioUnitario = precio;

  actualizarAtributoItem(idx, cambios);
  render();
}

function elegirColorItem(idx, color) {
  const items = leerCarrito();
  const it = items[idx];
  if (!it) return;

  const cambios = { color };
  const precio = precioUnitarioDeItem({ ...it, ...cambios });
  if (precio != null) cambios.precioUnitario = precio;

  actualizarAtributoItem(idx, cambios);
  render();
}

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
          <div class="carrito-item-wrap" id="carrito-item-${idx}">
            <div class="carrito-item">
              <a class="carrito-item-link" href="producto.html?id=${encodeURIComponent(it.productoId)}" title="Ver producto">
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
              </a>
              <div class="carrito-item-qty">
                <button type="button" class="btn-qty" onclick="cambiarCantidadUI(${idx},-1)">−</button>
                <span>${it.cantidad}</span>
                <button type="button" class="btn-qty" onclick="cambiarCantidadUI(${idx},1)">+</button>
              </div>
              <button type="button" class="btn-quitar-item" onclick="quitarItemUI(${idx})" title="Quitar">✕</button>
            </div>
            ${renderSelectorItem(it, idx)}
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

  await cargarVariantesParaItems(items);
  const idxPendiente = items.findIndex(faltaSeleccion);
  if (idxPendiente >= 0) {
    render(); // recrea el DOM del carrito con los selectores de talle/color visibles

    // render() reconstruye el formulario entero: se restauran los datos
    // que la persona ya había escrito para que no tenga que reescribirlos.
    const nombreEl   = document.getElementById('chk-nombre');
    const telefonoEl = document.getElementById('chk-telefono');
    const notaEl     = document.getElementById('chk-nota');
    if (nombreEl)   nombreEl.value   = nombre;
    if (telefonoEl) telefonoEl.value = telefono;
    if (notaEl)     notaEl.value     = nota || '';

    const errorElNuevo = document.getElementById('chk-error');
    if (errorElNuevo) {
      errorElNuevo.textContent = 'Todavía tenés un producto sin talle o color elegido.';
      errorElNuevo.style.display = 'block';
    }
    document.getElementById(`carrito-item-${idxPendiente}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

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
  renderFooter();
  initTheme();
  actualizarBadge();
  render();

  // Carga las variantes talle/color de los productos del carrito (para
  // los ítems agregados sin elegirlas) y re-renderiza cuando llegan.
  cargarVariantesParaItems(leerCarrito()).then(render);

  rolActual = await detectarRol();
  const app = document.getElementById('app');
  app.dataset.role = rolActual;
  initAlertasPedidos(rolActual);

  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = rolActual === 'admin' ? 'Admin' : 'Invitado';
    badge.className   = 'role-badge ' + rolActual;
  }

  app.style.display = 'flex';
}

window.toggleTheme        = toggleTheme;
window.cambiarCantidadUI  = cambiarCantidadUI;
window.quitarItemUI       = quitarItemUI;
window.enviarPedidoUI     = enviarPedido;
window.doLogout           = doLogout;
window.elegirTalleItemUI  = elegirTalleItem;
window.elegirColorItemUI  = elegirColorItem;

init();
