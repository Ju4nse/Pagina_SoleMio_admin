/* ================================================================
   landing.js — Recibidor: novedades del catálogo + acceso invitado
   ================================================================ */
import { sb }         from './supabase-client.js';
import { ICON, initTheme, toggleTheme } from './theme.js';

function fmtARS(n) {
  return '$\u202F' + Math.round(n).toLocaleString('es-AR');
}

function resolverImagen(p) {
  return p.imagen_custom || p.imagen_scraper || p.imagen || '';
}

/* Entra al catálogo como invitado (sin pedir login) */
function verCatalogo() {
  sessionStorage.setItem('solemio-role', 'guest');
  window.location.href = 'catalogo.html?stock=in';
}

async function cargarNovedades() {
  const grid = document.getElementById('novedades-grid');

  const { data, error } = await sb
    .from('productos')
    .select('*')
    .not('oculto', 'is', true)
    .order('id', { ascending: false })
    .limit(8);

  if (error) {
    console.warn('Error cargando novedades:', error.message);
    grid.innerHTML = '<div class="empty">No se pudieron cargar las novedades</div>';
    return;
  }

  if (!data.length) {
    grid.innerHTML = '<div class="empty">Todavía no hay productos cargados</div>';
    return;
  }

  grid.innerHTML = data.map(p => {
    const img = resolverImagen(p);
    return `
    <article class="nov-card" onclick="verCatalogo()">
      ${img
        ? `<img class="nov-thumb" src="${img}" alt="${p.nombre}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="nov-thumb-ph" style="${img ? 'display:none' : ''}">${ICON.shoe}</div>
      <div class="nov-body">
        <div class="nov-name">${p.nombre}</div>
        <div class="nov-price">${fmtARS(Math.round((p.precio || 0) * 1.5))}</div>
      </div>
    </article>`;
  }).join('');
}

function init() {
  initTheme();
  document.getElementById('year').textContent = new Date().getFullYear();
  cargarNovedades();
}

window.verCatalogo = verCatalogo;
window.toggleTheme = toggleTheme;

init();
