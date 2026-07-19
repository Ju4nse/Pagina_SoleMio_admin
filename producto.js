/* ================================================================
   producto.js — Página de detalle de un producto individual
   Requiere sesión válida (admin o invitado); si no existe, redirige
   de vuelta a login.html
   ================================================================ */
import { sb, esAdmin }        from './supabase-client.js';
import { ICON, initTheme, toggleTheme } from './theme.js';

/* ================================================================
   CONTACTO / REDES
   ================================================================ */
const CONTACTO = {
  whatsapp:   'https://wa.me/5492494003595',
  instagram:  'https://instagram.com/solemio.tandil',
};

/* ================================================================
   STATE
   ================================================================ */
let currentRole = null;   // 'admin' | 'guest'

function isAdmin() { return currentRole === 'admin'; }
function isGuest() { return currentRole === 'guest'; }


/* ================================================================
   HELPERS
   ================================================================ */
function fmtARS(n) {
  return '$\u202F' + Math.round(n).toLocaleString('es-AR');
}

function resolverImagen(p) {
  return p.imagen_custom || p.imagen_scraper || p.imagen || '';
}

function getProductoId() {
  return new URLSearchParams(location.search).get('id');
}

/* Mapa de nombres de color (es) → hex, para el circulito.
   Si un color no está en el mapa, se muestra un circulito neutro
   con el nombre igual visible como texto. */
const COLOR_MAP = {
  'negro': '#1a1a1a', 'blanco': '#ffffff', 'crudo': '#f2ead9',
  'gris': '#9c9c9c', 'gris claro': '#cfcfcf', 'gris oscuro': '#555555',
  'rojo': '#c0392b', 'rosa': '#e8a0bf', 'rosa viejo': '#c98ba0',
  'fucsia': '#d6336c', 'bordo': '#7b1e3a', 'vino': '#722f37',
  'azul': '#2b4c8c', 'azul marino': '#1b2a4a', 'celeste': '#8ec9e0',
  'turquesa': '#1abc9c', 'verde': '#2e8b57', 'verde militar': '#556b2f',
  'amarillo': '#f1c40f', 'mostaza': '#c9a227', 'naranja': '#e07b39',
  'marron': '#6b4226', 'beige': '#d8c3a5', 'nude': '#e3c2a5',
  'camel': '#c19a6b', 'violeta': '#8e44ad', 'lila': '#c8a2c8',
  'morado': '#6c3483', 'dorado': '#caa94a', 'plateado': '#c0c0c0',
  'animal print': '#a67b5b', 'leopardo': '#a67b5b', 'coral': '#ff7f50',
  'salmon': '#fa8072',
};

function normalizarColor(nombre) {
  return nombre
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function hexDeColor(nombre) {
  return COLOR_MAP[normalizarColor(nombre)] || null;
}


/* ================================================================
   ROL (topbar)
   ================================================================ */
function applyRole() {
  const isG = isGuest();

  document.getElementById('app').dataset.role = isG ? 'guest' : 'admin';

  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = isG ? 'Invitado' : 'Admin';
    badge.className   = 'role-badge ' + (isG ? 'guest' : 'admin');
  }
}


/* ================================================================
   RENDER
   ================================================================ */
function renderNoEncontrado() {
  document.getElementById('producto-content').innerHTML = `
    <div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      Producto no encontrado
      <div style="margin-top:1rem">
        <a class="btn ghost" href="catalogo.html">← Volver al catálogo</a>
      </div>
    </div>`;
}

function renderProducto(p, prev, next, similares) {
  const img      = p.imagen;
  const enStock  = p.stock === true || p.stock === 'in stock';
  const cantidad = p.num_stock ?? null;

  const badgeStock = enStock
    ? (isAdmin() && cantidad != null ? `En stock (${cantidad})` : 'En stock')
    : 'Sin stock';

  document.getElementById('producto-content').innerHTML = `
    <nav class="breadcrumb">
      <a href="catalogo.html">Catálogo</a>
      ${p.marca ? `<span>/</span><a href="catalogo.html">${p.marca}</a>` : ''}
      <span>/</span><span class="breadcrumb-current">${p.nombre}</span>
    </nav>

    <div class="product-box">

      <div class="product-media">
        ${img
          ? `<div class="product-photo">
               <img src="${img}" alt="${p.nombre}"
                    onerror="this.parentElement.style.display='none';this.closest('.product-media').querySelector('.view-img-ph').style.display='flex'">
             </div>
             <div class="view-img-ph" style="display:none">${ICON.shoe}</div>`
          : `<div class="view-img-ph">${ICON.shoe}</div>`}

        <div class="social-row">
          <a class="icon-btn" href="${CONTACTO.whatsapp}" target="_blank" rel="noopener" title="Consultar por WhatsApp" aria-label="WhatsApp">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </a>
          <a class="icon-btn" href="${CONTACTO.instagram}" target="_blank" rel="noopener" title="Ver en Instagram" aria-label="Instagram">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="5"/>
              <circle cx="12" cy="12" r="4"/>
              <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none"/>
            </svg>
          </a>
        </div>
      </div>

      <div class="product-info">
        ${p.marca ? `<div class="eyebrow">${p.marca}</div>` : ''}
        <h1 class="view-name">${p.nombre}</h1>

        <div class="product-meta-row">
          <span class="meta-code">ID: ${p.id}</span>
          <span class="badge ${enStock ? 'stock' : 'nostock'}">${badgeStock}</span>
          ${p.oculto && isAdmin() ? `<span class="badge" style="background:var(--red-bg);color:var(--red)">Oculto</span>` : ''}
          ${p.imagen_custom && isAdmin() ? `<span class="badge" style="background:var(--blue-bg,#e8f0fe);color:var(--blue,#1a73e8)">Foto custom</span>` : ''}
        </div>

        <div class="view-price">${fmtARS(Math.round(p.precio * 1.5))}</div>

        ${renderColorGroup(p.color)}
        ${renderAttrGroup('Talle', p.talles)}

        <div class="product-actions">
          <a class="btn ghost" href="catalogo.html">← Volver al catálogo</a>
          ${isAdmin() ? `<a class="btn primary" href="catalogo.html?edit=${encodeURIComponent(p.id)}">${ICON.edit} Editar</a>` : ''}
        </div>

        ${renderPrevNextStrip(prev, next)}
      </div>

    </div>

    ${renderSimilares(p.marca, similares)}
  `;
}

function renderColorGroup(value) {
  if (!value) return '';
  const colores = value.split(',').map(v => v.trim()).filter(Boolean);
  if (!colores.length) return '';
  return `
    <div class="attr-group">
      <span class="attr-label">Color</span>
      ${colores.map(c => {
        const hex = hexDeColor(c);
        return hex
          ? `<span class="color-tag" title="${c}">
               <span class="color-dot" style="background:${hex}"></span>${c}
             </span>`
          : `<span class="color-tag" title="${c}">
               <span class="color-dot color-dot-generic"></span>${c}
             </span>`;
      }).join('')}
    </div>`;
}

function renderAttrGroup(label, value) {
  if (!value) return '';
  const tags = value.split(',').map(v => v.trim()).filter(Boolean);
  if (!tags.length) return '';
  return `
    <div class="attr-group">
      <span class="attr-label">${label}</span>
      ${tags.map(t => `<span class="attr-tag">${t}</span>`).join('')}
    </div>`;
}

function renderPrevNextStrip(prev, next) {
  if (!prev && !next) return '';
  return `
    <div class="prod-nav-strip">
      ${prev
        ? `<a class="prod-nav-link prod-nav-prev" href="producto.html?id=${encodeURIComponent(prev.id)}">
             <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
             <span>${prev.nombre}</span>
           </a>`
        : `<span></span>`}
      ${next
        ? `<a class="prod-nav-link prod-nav-next" href="producto.html?id=${encodeURIComponent(next.id)}">
             <span>${next.nombre}</span>
             <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
           </a>`
        : `<span></span>`}
    </div>`;
}

function renderSimilares(marca, lista) {
  if (!marca || !lista || !lista.length) return '';

  return `
    <section class="similares-section">
      <h2 class="similares-title">Más de ${marca}</h2>
      <div class="prod-grid">
        ${lista.map(p => {
          const img      = resolverImagen(p);
          const enStock  = p.stock === true || p.stock === 'in stock';
          return `
          <article class="prod-card" style="cursor:pointer" onclick="location.href='producto.html?id=${encodeURIComponent(p.id)}'">
            ${img
              ? `<img class="prod-thumb" src="${img}" alt="${p.nombre}" loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
              : ''}
            <div class="prod-thumb-ph" style="${img ? 'display:none' : ''}">${ICON.shoe}</div>
            <div class="prod-body">
              <div class="prod-name">${p.nombre}</div>
              <div class="prod-price">${fmtARS(Math.round((p.precio || 0) * 1.5))}</div>
              <div class="prod-badges">
                <span class="badge ${enStock ? 'stock' : 'nostock'}">${enStock ? 'En stock' : 'Sin stock'}</span>
              </div>
            </div>
          </article>`;
        }).join('')}
      </div>
    </section>`;
}


/* ================================================================
   CARGAR PRODUCTO — Supabase (con caché local instantánea)
   ================================================================ */
async function cargarProducto() {
  const id = getProductoId();
  if (!id) { renderNoEncontrado(); return; }

  // Mostrar de inmediato desde caché local, si existe
  const local = localStorage.getItem('solemio-productos');
  let cache = null;
  if (local) {
    try {
      cache = JSON.parse(local);
      const pCache = cache.find(x => x.id === id);
      if (pCache && !(pCache.oculto && isGuest())) {
        const { prev, next } = calcularVecinos(cache, id);
        const similares       = productosDeMarca(cache, pCache.marca, id);
        renderProducto({ ...pCache, imagen: resolverImagen(pCache) }, prev, next, similares);
      }
    } catch (_) {}
  }

  // Traer versión actualizada desde la base
  const { data, error } = await sb
    .from('productos')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.warn('Error cargando producto:', error.message);
    return;
  }

  if (!data || (data.oculto && isGuest())) {
    renderNoEncontrado();
    return;
  }

  const listaNav        = cache || await obtenerListaNav();
  const { prev, next }  = calcularVecinos(listaNav, id);
  const similares        = productosDeMarca(listaNav, data.marca, id);

  renderProducto({ ...data, imagen: resolverImagen(data) }, prev, next, similares);
}

async function obtenerListaNav() {
  const { data, error } = await sb
    .from('productos')
    .select('id,nombre,marca,precio,stock,num_stock,imagen_custom,imagen_scraper,imagen,oculto')
    .order('id', { ascending: true });
  if (error) { console.warn('Error cargando navegación:', error.message); return []; }
  return data || [];
}

function calcularVecinos(lista, id) {
  const filtrada = lista.filter(x => !(x.oculto && isGuest()));
  const idx       = filtrada.findIndex(x => x.id === id);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0                     ? filtrada[idx - 1] : null,
    next: idx < filtrada.length - 1   ? filtrada[idx + 1] : null,
  };
}

function productosDeMarca(lista, marca, excludeId) {
  if (!marca) return [];
  return lista
    .filter(x => x.marca === marca && x.id !== excludeId && !(x.oculto && isGuest()))
    .slice(0, 8);
}


/* ================================================================
   LOGOUT
   ================================================================ */
async function doLogout() {
  if (currentRole === 'admin') {
    const { error } = await sb.auth.signOut();
    if (error) console.error('[LOGOUT ERROR]', error);
  }

  currentRole = null;
  sessionStorage.removeItem('solemio-role');
  localStorage.removeItem('solemio-productos');

  window.location.href = 'login.html';
}


/* ================================================================
   INIT / GUARDIA DE AUTENTICACIÓN
   ================================================================ */
async function startApp() {
  document.getElementById('app').style.display = 'block';

  initTheme();
  applyRole();

  await cargarProducto();
}

async function init() {
  const rolGuardado = sessionStorage.getItem('solemio-role');

  if (rolGuardado === 'guest') {
    currentRole = 'guest';
    await startApp();
    return;
  }

  // Sesión de admin vía Supabase
  const { data: { session } } = await sb.auth.getSession();

  if (session?.user && await esAdmin(session.user.email)) {
    currentRole = 'admin';
    await startApp();

    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        currentRole = null;
        window.location.href = 'login.html';
      }
    });
    return;
  }

  // Sin sesión válida → volver al login
  window.location.href = 'login.html';
}

// ── Exponer funciones globales para los onclick del HTML ──────
window.toggleTheme = toggleTheme;
window.doLogout    = doLogout;

init();
