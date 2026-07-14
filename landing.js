/* ================================================================
   landing.js — Recibidor: destacados del catálogo + acceso invitado
   ================================================================ */
import { sb, irAlCatalogo } from './supabase-client.js';
import { ICON, initTheme, toggleTheme } from './theme.js';

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
    .eq('stock', true)
    .not('oculto', 'is', true)
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
      ${img
        ? `<img class="dest-thumb" src="${img}" alt="${p.nombre}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="dest-thumb-ph" style="${img ? 'display:none' : ''}">${ICON.shoe}</div>
      <div class="dest-body">
        <div class="dest-name">${p.nombre}</div>
        <div class="dest-price">${fmtARS(Math.round((p.precio || 0) * 1.5))}</div>
      </div>
    </article>`;
  }).join('');
}

function init() {
  initTheme();
  document.getElementById('year').textContent = new Date().getFullYear();
  cargarDestacados();
}

window.verCatalogo = irAlCatalogo;
window.toggleTheme = toggleTheme;

init();
