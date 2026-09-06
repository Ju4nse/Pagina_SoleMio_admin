/* ================================================================
   landing.js — Recibidor: novedades del catálogo + acceso invitado
   ================================================================ */
import { sb, esAdmin, irAlCatalogo } from './supabase-client.js';
import { ICON, initTheme, toggleTheme } from './theme.js';
import { initCarritoUI } from './carrito.js';
import { renderTopbar } from './topbar.js';
import { renderFooter } from './footer.js';
import { initAlertasPedidos } from './pedidos-alertas.js';

let rolActual = 'guest';

function fmtARS(n) {
  return '$\u202F' + Math.round(n).toLocaleString('es-AR');
}

function resolverImagen(p) {
  return p.imagen_custom || p.imagen_scraper || p.imagen || '';
}

async function cargarDestacados() {
  const grid = document.getElementById('destacados-grid');

  const { data, error } = await sb
    .from('productos')
    .select('*')
    .eq('destacado', true)
    .eq('disponible', true)
    .eq('eliminado', false)
    .order('id', { ascending: false })
    .limit(8);

  if (error) {
    console.warn('Error cargando destacados:', error.message);
    grid.innerHTML = '<div class="empty">No se pudieron cargar los destacados</div>';
    return;
  }

  if (!data.length) {
    grid.innerHTML = '<div class="empty">Todavía no hay productos destacados con stock disponible</div>';
    return;
  }

  grid.innerHTML = data.map(p => {
    const img = resolverImagen(p);
    return `
    <article class="dest-card" onclick="verCatalogo()">
      <div class="frame dest-frame">
        ${img
          ? `<img src="${img}" alt="${p.nombre}" loading="lazy"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : ''}
        <div class="dest-thumb-ph" style="${img ? 'display:none' : ''}">${ICON.shoe}</div>
      </div>
      ${p.marca ? `<span class="dest-marca">${p.marca}</span>` : ''}
      <div class="dest-name">${p.nombre}</div>
      <div class="dest-price">${fmtARS(Math.round((p.precio || 0) * 1.5))}</div>
    </article>`;
  }).join('');
}

async function detectarRol() {
  // La sesión real de Supabase se chequea primero (no el flag de
  // invitado): evita que un admin quede pegado en modo invitado.
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user && await esAdmin(session.user.email)) {
    sessionStorage.removeItem('solemio-role');
    return 'admin';
  }
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
  renderTopbar('inicio');
  renderFooter();
  initTheme();
  initCarritoUI();

  rolActual = await detectarRol();
  document.body.dataset.role = rolActual;
  initAlertasPedidos(rolActual);

  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = rolActual === 'admin' ? 'Admin' : 'Invitado';
    badge.className   = 'role-badge ' + rolActual;
  }

  cargarDestacados();
}

window.verCatalogo = irAlCatalogo;
window.toggleTheme = toggleTheme;
window.doLogout    = doLogout;

init();
