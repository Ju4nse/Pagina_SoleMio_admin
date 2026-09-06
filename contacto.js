/* ================================================================
   contacto.js — Tema y acceso al catálogo desde la página de contacto
   ================================================================ */
import { initTheme, toggleTheme } from './theme.js';
import { sb, esAdmin, irAlCatalogo } from './supabase-client.js';
import { initCarritoUI } from './carrito.js';
import { renderTopbar } from './topbar.js';
import { renderFooter } from './footer.js';

let rolActual = 'guest';

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
  renderTopbar('contacto');
  renderFooter();
  initTheme();
  initCarritoUI();

  rolActual = await detectarRol();
  document.body.dataset.role = rolActual;

  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = rolActual === 'admin' ? 'Admin' : 'Invitado';
    badge.className   = 'role-badge ' + rolActual;
  }
}

window.verCatalogo = irAlCatalogo;
window.toggleTheme = toggleTheme;
window.doLogout    = doLogout;

init();
