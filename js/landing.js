/* ================================================================
   landing.js — Recibidor: novedades del catálogo + acceso invitado
   ================================================================ */
import { sb, esAdmin, irAlCatalogo } from './supabase-client.js';
import { initTheme, toggleTheme, cargarColoresPersonalizados } from './theme.js';
import { initCarritoUI } from './carrito.js';
import { renderTopbar } from './topbar.js';
import { renderFooter } from './footer.js';
import { initAlertasPedidos } from './pedidos-alertas.js';
import { renderTarjetaProducto } from './tarjeta-producto.js';

let rolActual = 'guest';

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

  // Misma tarjeta que el catálogo (con código y "Agregar al carrito");
  // se esperan los colores personalizados para que los puntitos salgan bien.
  await cargarColoresPersonalizados();
  grid.innerHTML = data.map(p => renderTarjetaProducto(p)).join('');
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
