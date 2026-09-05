/* ================================================================
   producto.js — Página de detalle de un producto individual
   Requiere sesión válida (admin o invitado); si no existe, redirige
   de vuelta a login.html
   ================================================================ */
import { sb, esAdmin }        from './supabase-client.js';
import { ICON, initTheme, toggleTheme, hexDeColor, cargarColoresPersonalizados, guardarColorPersonalizado } from './theme.js';
import { initCarritoUI, agregarAlCarrito } from './carrito.js';
import { renderTopbar }       from './topbar.js';

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
let currentRole    = null;   // 'admin' | 'guest'
let productoActual = null;   // producto que se está mostrando/editando

let fotosProducto    = [];    // urls de la galería (o [imagen única] de fallback)
let indiceFotoActual = 0;
let zoomAbierto       = false;
let touchStartX       = null;

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

/* Un invitado no puede ver productos ocultos ni sin stock (mismo
   criterio que el listado del catálogo en catalogo.js). */
function noVisibleParaGuest(p) {
  return isGuest() && (p.oculto || !p.stock);
}

/* hexDeColor(nombre) viene de theme.js — mapa de color compartido con catalogo.js */

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
  const enStock  = p.stock === true || p.stock === 'in stock';
  const cantidad = p.num_stock ?? null;

  const badgeStock = isAdmin()
    ? (enStock ? (cantidad != null ? `En stock (${cantidad})` : 'En stock') : 'Sin stock')
    : null; // el stock es un dato interno: no se muestra a invitados

  document.getElementById('producto-content').innerHTML = `
    <nav class="breadcrumb">
      <a href="catalogo.html">Catálogo</a>
      ${p.marca ? `<span>/</span><a href="catalogo.html">${p.marca}</a>` : ''}
      <span>/</span><span class="breadcrumb-current">${p.nombre}</span>
    </nav>

    <div class="product-box">

      <div class="product-media">
        <div id="galeria-container">${renderGaleria()}</div>

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
          ${badgeStock ? `<span class="badge ${enStock ? 'stock' : 'nostock'}">${badgeStock}</span>` : ''}
          ${p.oculto && isAdmin() ? `<span class="badge" style="background:var(--red-bg);color:var(--red)">Oculto</span>` : ''}
          ${p.imagen_custom && isAdmin() ? `<span class="badge" style="background:var(--blue-bg,#e8f0fe);color:var(--blue,#1a73e8)">Foto custom</span>` : ''}
        </div>

        <div class="view-price">${fmtARS(Math.round(p.precio * 1.5))}</div>

        <div id="selector-compra-container">${renderSelectorCompra()}</div>

        <div class="product-actions">
          <a class="btn ghost" href="catalogo.html">← Volver al catálogo</a>
          ${isAdmin() ? `<button class="btn primary" onclick="openProdModal()">${ICON.edit} Editar</button>` : ''}
        </div>

        ${renderPrevNextStrip(prev, next)}
      </div>

    </div>

    ${renderSimilares(p.marca, similares)}
  `;
}

/* ================================================================
   GALERÍA DE FOTOS (carrusel) + ZOOM

   fotosProducto viene de producto_fotos si el admin cargó una
   galería; si no, es un array de un solo elemento con la foto única
   de siempre (imagen_custom/imagen_scraper/imagen), para no perder
   nada en productos que todavía no tienen galería cargada.
   ================================================================ */
function renderGaleria() {
  if (!fotosProducto.length) {
    return `<div class="view-img-ph">${ICON.shoe}</div>`;
  }

  const url      = fotosProducto[indiceFotoActual];
  const multiple = fotosProducto.length > 1;

  return `
    <div class="product-photo-wrap">
      <div class="product-photo" onclick="abrirZoomUI()" title="Ver más grande"
           ontouchstart="onGaleriaTouchStartUI(event)" ontouchend="onGaleriaTouchEndUI(event)">
        <img src="${url}" alt=""
             onerror="this.closest('.product-photo-wrap').style.display='none'; document.getElementById('galeria-fallback').style.display='flex'">
      </div>
      ${multiple ? `
        <button type="button" class="galeria-flecha galeria-flecha-izq" onclick="event.stopPropagation();moverGaleriaUI(-1)" aria-label="Foto anterior">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button type="button" class="galeria-flecha galeria-flecha-der" onclick="event.stopPropagation();moverGaleriaUI(1)" aria-label="Foto siguiente">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>` : ''}
    </div>
    <div class="view-img-ph" id="galeria-fallback" style="display:none">${ICON.shoe}</div>
    ${multiple ? `
      <div class="galeria-dots">
        ${fotosProducto.map((_, i) => `<span class="galeria-dot ${i === indiceFotoActual ? 'activo' : ''}" onclick="irAFotoUI(${i})"></span>`).join('')}
      </div>` : ''}
  `;
}

function actualizarGaleria() {
  const container = document.getElementById('galeria-container');
  if (container) container.innerHTML = renderGaleria();
  if (zoomAbierto) renderZoomModal();
}

function moverGaleria(delta) {
  if (fotosProducto.length < 2) return;
  indiceFotoActual = (indiceFotoActual + delta + fotosProducto.length) % fotosProducto.length;
  actualizarGaleria();
}

function irAFoto(idx) {
  indiceFotoActual = idx;
  actualizarGaleria();
}

function onGaleriaTouchStart(event) {
  touchStartX = event.changedTouches[0].clientX;
}

function onGaleriaTouchEnd(event) {
  if (touchStartX === null) return;
  const delta = event.changedTouches[0].clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(delta) > 40) moverGaleria(delta > 0 ? -1 : 1);
}

function abrirZoom() {
  if (!fotosProducto.length) return;
  zoomAbierto = true;
  renderZoomModal();
}

function cerrarZoom() {
  zoomAbierto = false;
  const container = document.getElementById('modal-zoom');
  if (container) container.innerHTML = '';
}

function renderZoomModal() {
  const container = document.getElementById('modal-zoom');
  if (!container) return;

  const url      = fotosProducto[indiceFotoActual];
  const multiple = fotosProducto.length > 1;

  container.innerHTML = `
    <div class="zoom-overlay" id="zoo" onclick="if(event.target.id==='zoo') cerrarZoomUI()">
      <button type="button" class="zoom-cerrar" onclick="cerrarZoomUI()" aria-label="Cerrar">✕</button>
      ${multiple ? `
        <button type="button" class="zoom-flecha zoom-flecha-izq" onclick="moverGaleriaUI(-1)" aria-label="Foto anterior">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>` : ''}
      <img src="${url}" class="zoom-img" alt=""
           ontouchstart="onGaleriaTouchStartUI(event)" ontouchend="onGaleriaTouchEndUI(event)">
      ${multiple ? `
        <button type="button" class="zoom-flecha zoom-flecha-der" onclick="moverGaleriaUI(1)" aria-label="Foto siguiente">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
        <div class="zoom-contador">${indiceFotoActual + 1} / ${fotosProducto.length}</div>` : ''}
    </div>`;
}

document.addEventListener('keydown', (event) => {
  if (!zoomAbierto) return;
  if (event.key === 'Escape')     cerrarZoom();
  if (event.key === 'ArrowLeft')  moverGaleria(-1);
  if (event.key === 'ArrowRight') moverGaleria(1);
});

/* ================================================================
   SELECTOR DE COMPRA (talle / color / cantidad → agregar al carrito)

   variantesProducto: [{talle, color}] combinaciones reales del
   producto. Si producto_talles tiene filas, esa es la fuente de
   verdad (aunque el stock en sí no se muestra ni se valida acá —
   ver nota en cargarVariantesProducto). Si no hay filas todavía,
   se arma un fallback no validado desde el texto p.talles/p.color.
   ================================================================ */
let variantesProducto = [];
let selTalle    = null;
let selColor    = null;
let cantidadSel = 1;

async function cargarVariantesProducto(productoId) {
  try {
    const { data, error } = await sb
      .from('producto_talles')
      .select('talle, color')
      .eq('producto_id', productoId)
      .eq('activo', true)
      .order('id', { ascending: true });
    if (!error && data && data.length) {
      return data.map(d => ({ talle: d.talle, color: d.color || '' }));
    }
  } catch (_) {}
  return null;
}

function variantesFallbackDesdeTexto(p) {
  const talles  = (p.talles || '').split(',').map(t => t.trim()).filter(Boolean);
  const colores = (p.color  || '').split(',').map(c => c.trim()).filter(Boolean);
  if (talles.length) {
    return colores.length
      ? talles.flatMap(t => colores.map(c => ({ talle: t, color: c })))
      : talles.map(t => ({ talle: t, color: '' }));
  }
  return colores.map(c => ({ talle: '', color: c }));
}

function tallesDeVariantes() {
  return [...new Set(variantesProducto.map(v => v.talle).filter(Boolean))];
}

function coloresParaTalle(talle) {
  return [...new Set(
    variantesProducto.filter(v => !talle || v.talle === talle).map(v => v.color).filter(Boolean)
  )];
}

function renderSelectorCompra() {
  if (!variantesProducto.length) {
    return `<p style="font-size:0.85rem;color:var(--text-3);margin:1rem 0;">Cargando opciones…</p>`;
  }

  const talles  = tallesDeVariantes();
  const colores = coloresParaTalle(selTalle);

  return `
    <div class="selector-compra">
      ${talles.length ? `
        <div class="attr-group">
          <span class="attr-label">Talle</span>
          ${talles.map(t => `
            <button type="button" class="attr-tag selector-chip ${selTalle === t ? 'selected' : ''}"
              onclick="seleccionarTalleUI(&quot;${t.replace(/"/g, '&quot;')}&quot;)">${t}</button>
          `).join('')}
        </div>` : ''}
      ${colores.length ? `
        <div class="attr-group">
          <span class="attr-label">Color</span>
          ${colores.map(c => {
            const hex = hexDeColor(c);
            return `
              <button type="button" class="color-tag selector-chip ${selColor === c ? 'selected' : ''}"
                onclick="seleccionarColorUI(&quot;${c.replace(/"/g, '&quot;')}&quot;)">
                <span class="color-dot ${hex ? '' : 'color-dot-generic'}" style="${hex ? `background:${hex}` : ''}"></span>${c}
              </button>`;
          }).join('')}
        </div>` : ''}
      <div class="selector-compra-actions">
        <div class="qty-stepper">
          <button type="button" class="btn-qty" onclick="cambiarCantidadSelectorUI(-1)">−</button>
          <span id="selector-cantidad">${cantidadSel}</span>
          <button type="button" class="btn-qty" onclick="cambiarCantidadSelectorUI(1)">+</button>
        </div>
        <button type="button" class="btn primary" onclick="agregarAlCarritoDesdeProductoUI()">Agregar al carrito</button>
      </div>
      <div id="selector-error" class="carrito-error" style="display:none"></div>
    </div>`;
}

function actualizarSelectorCompra() {
  const container = document.getElementById('selector-compra-container');
  if (container && productoActual) container.innerHTML = renderSelectorCompra();
}

function seleccionarTalle(talle) {
  selTalle = talle;
  const disponibles = coloresParaTalle(talle);
  if (selColor && !disponibles.includes(selColor)) selColor = null;
  actualizarSelectorCompra();
}

function seleccionarColor(color) {
  selColor = color;
  actualizarSelectorCompra();
}

function cambiarCantidadSelector(delta) {
  cantidadSel = Math.max(1, cantidadSel + delta);
  const el = document.getElementById('selector-cantidad');
  if (el) el.textContent = cantidadSel;
}

function mostrarErrorSelector(msg) {
  const errorEl = document.getElementById('selector-error');
  if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
}

function agregarAlCarritoDesdeProducto() {
  const p = productoActual;
  if (!p) return;

  const necesitaTalle = tallesDeVariantes().length > 0;
  const necesitaColor = coloresParaTalle(selTalle).length > 0;

  if (necesitaTalle && !selTalle) { mostrarErrorSelector('Elegí un talle'); return; }
  if (necesitaColor && !selColor) { mostrarErrorSelector('Elegí un color'); return; }

  agregarAlCarrito({
    productoId:     p.id,
    nombre:         p.nombre,
    precioUnitario: Math.round(p.precio * 1.5),
    imagen:         resolverImagen(p),
    talle:          selTalle || '',
    color:          selColor || '',
    cantidad:       cantidadSel,
  });

  cantidadSel = 1;
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
          <a class="prod-card" href="producto.html?id=${encodeURIComponent(p.id)}">
            ${img
              ? `<img class="prod-thumb" src="${img}" alt="${p.nombre}" loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
              : ''}
            <div class="prod-thumb-ph" style="${img ? 'display:none' : ''}">${ICON.shoe}</div>
            <div class="prod-body">
              <div class="prod-name">${p.nombre}</div>
              <div class="prod-price">${fmtARS(Math.round((p.precio || 0) * 1.5))}</div>
              <div class="prod-badges">
                ${isAdmin() ? `<span class="badge ${enStock ? 'stock' : 'nostock'}">${enStock ? 'En stock' : 'Sin stock'}</span>` : ''}
              </div>
            </div>
          </a>`;
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
      if (pCache && !noVisibleParaGuest(pCache)) {
        const { prev, next } = calcularVecinos(cache, id);
        const similares       = productosDeMarca(cache, pCache.marca, id);
        productoActual = { ...pCache, imagen: resolverImagen(pCache) };
        fotosProducto  = productoActual.imagen ? [productoActual.imagen] : [];
        indiceFotoActual = 0;
        renderProducto(productoActual, prev, next, similares);
      }
    } catch (_) {}
  }

  // Traer versión actualizada desde la base (en paralelo con los
  // colores personalizados, para que el selector no tenga que esperar
  // dos consultas seguidas para pintar los puntitos bien).
  const [{ data, error }] = await Promise.all([
    sb.from('productos').select('*').eq('id', id).maybeSingle(),
    cargarColoresPersonalizados(),
  ]);

  if (error) {
    console.warn('Error cargando producto:', error.message);
    return;
  }

  if (!data || noVisibleParaGuest(data)) {
    renderNoEncontrado();
    return;
  }

  productoActual = { ...data, imagen: resolverImagen(data) };
  fotosProducto  = productoActual.imagen ? [productoActual.imagen] : [];
  indiceFotoActual = 0;
  variantesProducto = [];
  selTalle    = null;
  selColor    = null;
  cantidadSel = 1;

  // Render inmediato con los datos que ya tenemos: ni la navegación
  // prev/next (que a veces implica traer TODO el catálogo) ni las
  // variantes de talle/color ni la galería frenan lo que ya se puede
  // mostrar (la foto única de fallback ya está lista, sin red).
  renderProducto(productoActual, null, null, []);

  cargarNavYSimilares(id, cache, data);
  cargarVariantesYActualizar(id, data);
  cargarFotosYActualizar(id);
}

async function cargarFotosYActualizar(id) {
  try {
    const { data: rows, error } = await sb
      .from('producto_fotos')
      .select('url')
      .eq('producto_id', id)
      .order('orden', { ascending: true });

    if (productoActual?.id !== id) return; // el usuario ya navegó a otro producto
    if (!error && rows && rows.length) {
      fotosProducto    = rows.map(r => r.url);
      indiceFotoActual = 0;
      actualizarGaleria();
    }
  } catch (_) {}
}

async function cargarNavYSimilares(id, cache, data) {
  const listaNav       = cache || await obtenerListaNav();
  if (productoActual?.id !== id) return; // el usuario ya navegó a otro producto

  const { prev, next } = calcularVecinos(listaNav, id);
  const similares       = productosDeMarca(listaNav, data.marca, id);
  renderProducto(productoActual, prev, next, similares);
}

async function cargarVariantesYActualizar(id, data) {
  const variantesDB = await cargarVariantesProducto(id);
  if (productoActual?.id !== id) return; // el usuario ya navegó a otro producto

  variantesProducto = combinarVariantesConTexto(variantesDB, data);
  actualizarSelectorCompra();
}

/* producto_talles puede tener filas que solo cubren el talle (color='')
   si se cargaron antes de que existiera la gestión de colores, o si el
   admin todavía no volvió a guardar el producto con la grilla nueva.
   En ese caso se cruzan los talles reales con los colores del campo
   de texto legado, en vez de perder el color por completo. */
function combinarVariantesConTexto(variantesDB, data) {
  if (!variantesDB) return variantesFallbackDesdeTexto(data);

  const tieneColorEstructurado = variantesDB.some(v => v.color);
  if (tieneColorEstructurado) return variantesDB;

  const coloresTexto = (data.color || '').split(',').map(c => c.trim()).filter(Boolean);
  if (!coloresTexto.length) return variantesDB;

  return variantesDB.flatMap(v => coloresTexto.map(c => ({ talle: v.talle, color: c })));
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
  const filtrada = lista.filter(x => !noVisibleParaGuest(x));
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
    .filter(x => x.marca === marca && x.id !== excludeId && !noVisibleParaGuest(x))
    .slice(0, 8);
}


/* ================================================================
   MODAL DE EDICIÓN / GESTOR DE TALLES + COLORES + STOCK POR COMBINACIÓN

   El stock real vive por combinación talle×color (variantesStockState),
   sincronizado 1:1 con producto_talles(producto_id, talle, color, stock).
   Si el producto no tiene colores cargados, cada talle usa color=''.
   ================================================================ */
let tallesModalState     = [];  // nombres de talle, ej. ['S','M','L']
let coloresModalState    = [];  // nombres de color, ej. ['Negro','Rojo']
let variantesStockState  = {};  // `${talle}||${color}` -> stock (int)
let fotosModalState      = [];  // urls de producto_fotos, en orden

function claveVariante(talle, color) { return `${talle}||${color || ''}`; }

function parsearTallesTexto(str) {
  if (!str) return [];
  return str.split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => {
      const match = t.match(/^([^(]+)(?:\((\d+)\))?$/);
      if (match) {
        return {
          talle: match[1].trim(),
          stock: match[2] ? parseInt(match[2], 10) : 1
        };
      }
      return { talle: t, stock: 1 };
    });
}

function parsearColoresTexto(str) {
  if (!str) return [];
  return str.split(',').map(c => c.trim()).filter(Boolean);
}

/* Recalcula las claves de variantesStockState para que reflejen
   exactamente el producto cartesiano talles×colores actual,
   conservando el stock ya cargado en las combinaciones que sobreviven. */
function regenerarVariantesGrid() {
  const columnas = coloresModalState.length ? coloresModalState : [''];
  const nuevo = {};
  tallesModalState.forEach(talle => {
    columnas.forEach(color => {
      const k = claveVariante(talle, color);
      nuevo[k] = variantesStockState[k] ?? 0;
    });
  });
  variantesStockState = nuevo;
}

function renderListaTallesModal() {
  const container = document.getElementById('lista-talles-container');
  if (!container) return;

  if (!tallesModalState.length) {
    container.innerHTML = `
      <div style="font-size:0.78rem; color:var(--text-3); padding:0.5rem; text-align:center; font-style:italic;">
        Sin talles cargados aún. Usá el campo de abajo para agregar talles.
      </div>`;
    return;
  }

  container.innerHTML = tallesModalState.map((t, idx) => `
    <div class="talle-item-row">
      <span class="talle-tag-badge">${t}</span>
      <button type="button" class="btn-quitar-talle" onclick="quitarTalleItem(${idx})" title="Quitar talle ${t}">
        ✕
      </button>
    </div>
  `).join('');
}

function agregarTalleItem() {
  const nombreInput = document.getElementById('nuevo-talle-nombre');
  if (!nombreInput) return;

  const nombre = nombreInput.value.trim();
  if (!nombre) { nombreInput.focus(); return; }

  if (!tallesModalState.some(t => t.toLowerCase() === nombre.toLowerCase())) {
    tallesModalState.push(nombre);
  }

  nombreInput.value = '';
  nombreInput.focus();

  renderListaTallesModal();
  renderVariantesGrid();
}

function quitarTalleItem(idx) {
  if (idx >= 0 && idx < tallesModalState.length) {
    tallesModalState.splice(idx, 1);
    renderListaTallesModal();
    renderVariantesGrid();
  }
}

function agregarTalleRapido(nombre) {
  if (!tallesModalState.some(t => t.toLowerCase() === nombre.toLowerCase())) {
    tallesModalState.push(nombre);
  }
  renderListaTallesModal();
  renderVariantesGrid();
}

function renderListaColoresModal() {
  const container = document.getElementById('lista-colores-container');
  if (!container) return;

  if (!coloresModalState.length) {
    container.innerHTML = `
      <div style="font-size:0.78rem; color:var(--text-3); padding:0.4rem; text-align:center; font-style:italic; width:100%;">
        Sin colores cargados aún. Usá el campo o sugerencias de abajo para agregar.
      </div>`;
    return;
  }

  container.innerHTML = coloresModalState.map((c, idx) => {
    const hex = hexDeColor(c) || '#999999';
    const nombreAttr = c.replace(/"/g, '&quot;');
    return `
      <div class="color-item-chip">
        <span class="color-item-swatch-wrap" title="Elegir el color exacto de &quot;${nombreAttr}&quot;">
          <span class="color-item-swatch-dot" style="background:${hex}"></span>
          <input type="color" class="color-item-swatch-input" value="${hex}"
            onchange="cambiarHexColorUI(&quot;${nombreAttr}&quot;, this.value)">
        </span>
        <span class="color-item-name">${c}</span>
        <button type="button" class="btn-quitar-color" onclick="quitarColorItem(${idx})" title="Quitar color ${c}">✕</button>
      </div>`;
  }).join('');
}

async function cambiarHexColor(nombre, hex) {
  await guardarColorPersonalizado(nombre, hex);
  renderListaColoresModal();
}

function agregarColorItem() {
  const input = document.getElementById('nuevo-color-nombre');
  if (!input) return;
  const nombre = input.value.trim();
  if (!nombre) { input.focus(); return; }

  if (!coloresModalState.some(c => c.toLowerCase() === nombre.toLowerCase())) {
    coloresModalState.push(nombre);
    renderListaColoresModal();
    renderVariantesGrid();
  }
  input.value = '';
  input.focus();
}

function quitarColorItem(idx) {
  if (idx >= 0 && idx < coloresModalState.length) {
    coloresModalState.splice(idx, 1);
    renderListaColoresModal();
    renderVariantesGrid();
  }
}

function agregarColorRapido(nombre) {
  if (!coloresModalState.some(c => c.toLowerCase() === nombre.toLowerCase())) {
    coloresModalState.push(nombre);
    renderListaColoresModal();
    renderVariantesGrid();
  }
}

/* Grilla de stock: filas = talles, columnas = colores (o una sola
   columna "Stock" si el producto no usa colores). */
function renderVariantesGrid() {
  const container = document.getElementById('variantes-grid-container');
  if (!container) return;

  regenerarVariantesGrid();

  if (!tallesModalState.length) {
    container.innerHTML = `
      <div style="font-size:0.78rem; color:var(--text-3); padding:0.5rem; text-align:center; font-style:italic;">
        Agregá al menos un talle para poder cargar el stock.
      </div>`;
    actualizarResumenVariantes();
    return;
  }

  const columnas = coloresModalState.length ? coloresModalState : [''];

  container.innerHTML = `
    <table class="variantes-grid-table">
      <thead>
        <tr>
          <th></th>
          ${columnas.map(c => `<th>${c || 'Stock'}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${tallesModalState.map(talle => `
          <tr>
            <th class="variantes-grid-rowhead">${talle}</th>
            ${columnas.map(color => {
              const k = claveVariante(talle, color);
              const talleAttr = talle.replace(/"/g, '&quot;');
              const colorAttr = color.replace(/"/g, '&quot;');
              return `<td><input type="number" min="0" class="variante-stock-input"
                value="${variantesStockState[k] ?? 0}"
                oninput="actualizarVarianteStock(this, &quot;${talleAttr}&quot;, &quot;${colorAttr}&quot;)"></td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  actualizarResumenVariantes();
}

function actualizarVarianteStock(input, talle, color) {
  variantesStockState[claveVariante(talle, color)] = Math.max(0, parseInt(input.value, 10) || 0);
  actualizarResumenVariantes();
}

function actualizarResumenVariantes() {
  const total = Object.values(variantesStockState).reduce((acc, v) => acc + (parseInt(v, 10) || 0), 0);

  const resumenEl = document.getElementById('talles-resumen-stock');
  if (resumenEl) {
    resumenEl.textContent = tallesModalState.length
      ? `${tallesModalState.length} talle${tallesModalState.length !== 1 ? 's' : ''}`
        + (coloresModalState.length ? ` × ${coloresModalState.length} color${coloresModalState.length !== 1 ? 'es' : ''}` : '')
        + ` · Total: ${total} u.`
      : 'Sin talles';
  }

  const numStockInput = document.getElementById('p-num-stock');
  if (numStockInput && tallesModalState.length > 0) {
    numStockInput.value = total;
    actualizarBadgeStock(total);
  }
}

/* Sincroniza producto_talles con el estado actual del modal
   (tallesModalState × coloresModalState × variantesStockState). */
async function sincronizarTallesDB(productoId) {
  if (!productoId) return;
  try {
    const columnas = coloresModalState.length ? coloresModalState : [''];
    const filas = [];
    tallesModalState.forEach(talle => {
      columnas.forEach(color => {
        filas.push({
          producto_id: productoId,
          talle,
          color,
          stock: variantesStockState[claveVariante(talle, color)] ?? 0,
          activo: true
        });
      });
    });

    const { data: existentes, error: errSelect } = await sb
      .from('producto_talles')
      .select('id, talle, color')
      .eq('producto_id', productoId);

    if (errSelect) return;

    const clavesNuevas = new Set(filas.map(f => claveVariante(f.talle, f.color)));
    const idsAEliminar = (existentes || [])
      .filter(ex => !clavesNuevas.has(claveVariante(ex.talle, ex.color || '')))
      .map(ex => ex.id);

    if (idsAEliminar.length) {
      await sb.from('producto_talles').delete().in('id', idsAEliminar);
    }

    if (filas.length) {
      await sb.from('producto_talles').upsert(filas, { onConflict: 'producto_id,talle,color' });
    }
  } catch (err) {
    console.warn('Sincronización producto_talles opcional:', err);
  }
}

/* ================================================================
   GESTOR DE GALERÍA DE FOTOS (MODAL)

   Si el producto tiene fotos acá, la página de detalle muestra un
   carrusel con zoom en vez de la foto única (imagen_custom /
   imagen_scraper), que sigue funcionando como antes para productos
   sin galería todavía.
   ================================================================ */
function renderListaFotosModal() {
  const container = document.getElementById('lista-fotos-container');
  if (!container) return;

  if (!fotosModalState.length) {
    container.innerHTML = `
      <div style="font-size:0.78rem; color:var(--text-3); padding:0.5rem; text-align:center; font-style:italic;">
        Sin fotos en la galería todavía — se usa la foto única de más abajo.
      </div>`;
    return;
  }

  container.innerHTML = fotosModalState.map((url, idx) => `
    <div class="foto-item-row">
      <img src="${url}" class="foto-item-thumb" alt="Foto ${idx + 1}" onerror="this.style.opacity='0.25'">
      <span class="foto-item-url" title="${url}">${url}</span>
      <button type="button" class="btn-chip" onclick="moverFotoItem(${idx},-1)" ${idx === 0 ? 'disabled' : ''} title="Subir">↑</button>
      <button type="button" class="btn-chip" onclick="moverFotoItem(${idx},1)" ${idx === fotosModalState.length - 1 ? 'disabled' : ''} title="Bajar">↓</button>
      <button type="button" class="btn-quitar-talle" onclick="quitarFotoItem(${idx})" title="Quitar">✕</button>
    </div>
  `).join('');
}

function agregarFotoItem() {
  const input = document.getElementById('nueva-foto-url');
  if (!input) return;
  const url = input.value.trim();
  if (!url) { input.focus(); return; }
  if (!/^https?:\/\//.test(url)) { alert('La URL de la foto tiene que empezar con http:// o https://'); return; }

  fotosModalState.push(url);
  input.value = '';
  input.focus();
  renderListaFotosModal();
}

function quitarFotoItem(idx) {
  if (idx >= 0 && idx < fotosModalState.length) {
    fotosModalState.splice(idx, 1);
    renderListaFotosModal();
  }
}

function moverFotoItem(idx, delta) {
  const nuevoIdx = idx + delta;
  if (nuevoIdx < 0 || nuevoIdx >= fotosModalState.length) return;
  [fotosModalState[idx], fotosModalState[nuevoIdx]] = [fotosModalState[nuevoIdx], fotosModalState[idx]];
  renderListaFotosModal();
}

async function cargarFotosModal(productoId) {
  if (!productoId) return;
  try {
    const { data, error } = await sb
      .from('producto_fotos')
      .select('url')
      .eq('producto_id', productoId)
      .order('orden', { ascending: true });
    if (!error && data) {
      fotosModalState = data.map(d => d.url);
      renderListaFotosModal();
    }
  } catch (_) {}
}

/* Reemplaza toda la galería del producto por el estado actual del
   modal (más simple que un upsert con orden: es una lista corta). */
async function sincronizarFotosDB(productoId) {
  if (!productoId) return;
  try {
    await sb.from('producto_fotos').delete().eq('producto_id', productoId);
    if (fotosModalState.length) {
      const filas = fotosModalState.map((url, idx) => ({ producto_id: productoId, url, orden: idx }));
      await sb.from('producto_fotos').insert(filas);
    }
  } catch (err) {
    console.warn('Sincronización producto_fotos opcional:', err);
  }
}

/* ================================================================
   MODAL DE EDICIÓN
   ================================================================ */
async function openProdModal() {
  const p = productoActual;
  if (!p || !isAdmin()) return;

  await cargarColoresPersonalizados();

  const seedTalles   = parsearTallesTexto(p?.talles || '');
  tallesModalState   = seedTalles.map(t => t.talle);
  coloresModalState  = parsearColoresTexto(p?.color || '');
  variantesStockState = {};
  seedTalles.forEach(t => { variantesStockState[claveVariante(t.talle, '')] = t.stock; });
  fotosModalState = [];

  document.getElementById('modal-prod').innerHTML = `
    <div class="modal-overlay" id="mpo" onclick="if(event.target.id==='mpo') closeProdModal()">
      <div class="modal prod-modal-grande">
        <div class="modal-title">${ICON.edit} Editar producto</div>

        <div class="field">
          <label>Nombre</label>
          <input id="p-nombre" type="text" value="${p?.nombre || ''}">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Marca</label>
            <input id="p-marca" type="text" value="${p?.marca || ''}">
          </div>
          <div class="field">
            <label>Precio ($)</label>
            <input id="p-precio" type="number" value="${p?.precio || ''}">
          </div>
        </div>
        <div class="field">
          <label>Categoría</label>
          <select id="p-categoria">
            <option value="">(Detectar automáticamente)</option>
            <option value="conjuntos" ${p?.categoria === 'conjuntos' ? 'selected' : ''}>Conjuntos</option>
            <option value="corpiños" ${p?.categoria === 'corpiños' ? 'selected' : ''}>Corpiños</option>
            <option value="bombachas" ${p?.categoria === 'bombachas' ? 'selected' : ''}>Bombachas</option>
            <option value="pijamas" ${p?.categoria === 'pijamas' ? 'selected' : ''}>Pijamas & Homewear</option>
            <option value="maternal" ${p?.categoria === 'maternal' ? 'selected' : ''}>Maternal & Lactancia</option>
            <option value="modeladora" ${p?.categoria === 'modeladora' ? 'selected' : ''}>Línea Modeladora & Fajas</option>
          </select>
        </div>

        <!-- SECCIÓN GESTIÓN DE COLORES -->
        <div class="field colores-manager-section">
          <label style="margin:0 0 0.35rem; font-weight:600; font-size:0.85rem;">Colores disponibles</label>
          <p style="font-size:0.74rem; color:var(--text-2); margin-top:0; margin-bottom:0.6rem; line-height:1.4;">
            Agregá o quitá colores disponibles para este producto:
          </p>

          <div id="lista-colores-container" class="colores-chips-list"></div>

          <div style="display:flex; gap:0.4rem; align-items:center; margin-top:0.65rem;">
            <input type="text" id="nuevo-color-nombre" placeholder="Ej: Negro, Blanco, Rosa…" style="flex:1; min-width:120px;" onkeydown="if(event.key==='Enter'){event.preventDefault();agregarColorItem();}">
            <button type="button" class="btn sm primary" onclick="agregarColorItem()" style="flex-shrink:0;">
              + Agregar
            </button>
          </div>

          <div style="display:flex; gap:0.3rem; flex-wrap:wrap; margin-top:0.5rem; align-items:center;">
            <span style="font-size:0.7rem; color:var(--text-3);">Sugerencias:</span>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Negro')"><span class="color-dot-sm" style="background:#1a1a1a"></span>Negro</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Blanco')"><span class="color-dot-sm" style="background:#ffffff"></span>Blanco</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Rojo')"><span class="color-dot-sm" style="background:#c0392b"></span>Rojo</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Rosa')"><span class="color-dot-sm" style="background:#e8a0bf"></span>Rosa</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Nude')"><span class="color-dot-sm" style="background:#e3c2a5"></span>Nude</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Beige')"><span class="color-dot-sm" style="background:#d8c3a5"></span>Beige</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Bordo')"><span class="color-dot-sm" style="background:#7b1e3a"></span>Bordó</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Azul')"><span class="color-dot-sm" style="background:#2b4c8c"></span>Azul</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Gris')"><span class="color-dot-sm" style="background:#9c9c9c"></span>Gris</button>
            <button type="button" class="btn-chip color-chip-btn" onclick="agregarColorRapido('Animal print')"><span class="color-dot-sm" style="background:#a67b5b"></span>Animal print</button>
          </div>
        </div>

        <!-- SECCIÓN GESTIÓN DE TALLES -->
        <div class="field talles-manager-section">
          <label style="margin:0 0 0.35rem; font-weight:600; font-size:0.85rem;">Talles disponibles</label>
          <p style="font-size:0.74rem; color:var(--text-2); margin-top:0; margin-bottom:0.6rem; line-height:1.4;">
            Agregá o quitá los talles que tiene este producto:
          </p>

          <div id="lista-talles-container" class="talles-grid-list"></div>

          <div style="display:flex; gap:0.4rem; align-items:center; margin-top:0.65rem;">
            <input type="text" id="nuevo-talle-nombre" placeholder="Ej: 90, M, S…" style="flex:1; min-width:80px;" onkeydown="if(event.key==='Enter'){event.preventDefault();agregarTalleItem();}">
            <button type="button" class="btn sm primary" onclick="agregarTalleItem()" style="flex-shrink:0;">
              + Agregar
            </button>
          </div>

          <div style="display:flex; gap:0.3rem; flex-wrap:wrap; margin-top:0.5rem; align-items:center;">
            <span style="font-size:0.7rem; color:var(--text-3);">Sugerencias:</span>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('85')">85</button>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('90')">90</button>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('95')">95</button>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('100')">100</button>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('105')">105</button>
            <span style="font-size:0.7rem; color:var(--text-3);">|</span>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('S')">S</button>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('M')">M</button>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('L')">L</button>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('XL')">XL</button>
            <button type="button" class="btn-chip" onclick="agregarTalleRapido('Único')">Único</button>
          </div>
        </div>

        <!-- SECCIÓN STOCK POR COMBINACIÓN -->
        <div class="field talles-manager-section">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
            <label style="margin:0; font-weight:600; font-size:0.85rem;">Stock por combinación</label>
            <span style="font-size:0.75rem; color:var(--text-3);" id="talles-resumen-stock">Cargando…</span>
          </div>
          <p style="font-size:0.74rem; color:var(--text-2); margin-top:0; margin-bottom:0.6rem; line-height:1.4;">
            Cargá la cantidad real disponible de cada talle (y color, si aplica):
          </p>
          <div id="variantes-grid-container" class="variantes-grid-wrap"></div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Cantidad total en stock</label>
            <input id="p-num-stock" type="number" min="0" placeholder="0"
              value="${p?.num_stock ?? ''}"
              oninput="actualizarBadgeStock(this.value)">
          </div>
          <div class="field">
            <label>Estado</label>
            <div id="p-stock-badge" style="padding:.5rem .75rem;border:1px solid var(--border-md);border-radius:var(--radius);background:var(--bg);font-size:.85rem;display:flex;align-items:center;gap:.4rem">
              ${(p?.num_stock ?? 0) > 0
                ? `<span style="color:var(--green)">● En stock (${p?.num_stock})</span>`
                : `<span style="color:var(--red)">● Sin stock</span>`}
            </div>
          </div>
        </div>

        <!-- SECCIÓN GALERÍA DE FOTOS -->
        <div class="field talles-manager-section">
          <label style="margin:0 0 0.35rem; font-weight:600; font-size:0.85rem;">Galería de fotos</label>
          <p style="font-size:0.74rem; color:var(--text-2); margin-top:0; margin-bottom:0.6rem; line-height:1.4;">
            Si cargás fotos acá, en la página de detalle se muestran en un carrusel con zoom
            (en vez de la foto única de abajo). El orden de la lista es el orden del carrusel.
          </p>

          <div id="lista-fotos-container" class="fotos-grid-list"></div>

          <div style="display:flex; gap:0.4rem; align-items:center; margin-top:0.65rem;">
            <input type="url" id="nueva-foto-url" placeholder="https://…" style="flex:1;"
              onkeydown="if(event.key==='Enter'){event.preventDefault();agregarFotoItem();}">
            <button type="button" class="btn sm primary" onclick="agregarFotoItem()" style="flex-shrink:0;">
              + Agregar
            </button>
          </div>
        </div>

        <div class="field">
          <label>Foto custom
            <span style="font-size:.72rem;color:var(--text-3);font-weight:400">
              — reemplaza la foto del scraper en el catálogo
            </span>
          </label>
          <input id="p-imagen-custom" type="url" placeholder="https://…" value="${p?.imagen_custom || ''}">
          ${p?.imagen_custom
            ? `<img src="${p.imagen_custom}" style="margin-top:.4rem;max-height:80px;border-radius:6px;object-fit:cover" alt="preview custom">`
            : ''}
        </div>
        <div class="field">
          <label>Foto del scraper
            <span style="font-size:.72rem;color:var(--text-3);font-weight:400">
              — la trae el script automáticamente
            </span>
          </label>
          <input id="p-imagen-scraper" type="url" placeholder="https://…" value="${p?.imagen_scraper || p?.imagen || ''}">
        </div>

        <div class="field" style="display:flex;align-items:center;gap:.5rem">
          <input type="checkbox" id="p-destacado" ${p?.destacado ? 'checked' : ''}
            style="width:auto;accent-color:var(--text)">
          <label for="p-destacado" style="margin:0;cursor:pointer">
            Destacado (aparece en la sección "Destacados" del sitio)
          </label>
        </div>

        <div class="field" style="display:flex;align-items:center;gap:.5rem">
          <input type="checkbox" id="p-oculto" ${p?.oculto ? 'checked' : ''}
            style="width:auto;accent-color:var(--text)">
          <label for="p-oculto" style="margin:0;cursor:pointer">
            Ocultar producto (solo visible para admin)
          </label>
        </div>

        <div class="modal-footer">
          <button class="btn ghost" onclick="closeProdModal()">Cancelar</button>
          <button class="btn primary" onclick="saveProd()">${ICON.check} Guardar</button>
        </div>
      </div>
    </div>`;

  renderListaColoresModal();
  renderListaTallesModal();
  renderVariantesGrid();
  renderListaFotosModal();
  cargarFotosModal(p?.id);

  // Si hay filas cargadas en producto_talles, son la fuente de verdad
  // (reemplazan lo parseado del texto legado de p.talles/p.color)
  if (p?.id) {
    try {
      const { data, error } = await sb
        .from('producto_talles')
        .select('talle, color, stock')
        .eq('producto_id', p.id)
        .eq('activo', true)
        .order('id', { ascending: true });

      if (!error && data && data.length > 0) {
        const talles  = [];
        const colores = [];
        const stockPorTalle = {};
        variantesStockState = {};
        data.forEach(d => {
          if (!talles.includes(d.talle)) talles.push(d.talle);
          const color = d.color || '';
          if (color && !colores.includes(color)) colores.push(color);
          stockPorTalle[d.talle] = d.stock ?? 0;
          variantesStockState[claveVariante(d.talle, color)] = d.stock ?? 0;
        });
        tallesModalState = talles;

        if (colores.length) {
          coloresModalState = colores;
        } else if (coloresModalState.length) {
          // Las filas de producto_talles todavía no tienen color
          // cargado (vienen de antes de esa función), pero el texto
          // legado sí tiene colores: se cruzan para no perder el
          // stock real ya cargado (se copia a cada color, el admin
          // lo ajusta después si corresponde uno distinto por color).
          variantesStockState = {};
          talles.forEach(t => {
            coloresModalState.forEach(c => {
              variantesStockState[claveVariante(t, c)] = stockPorTalle[t] ?? 0;
            });
          });
        }

        renderListaColoresModal();
        renderListaTallesModal();
        renderVariantesGrid();
      }
    } catch (_) {}
  }
}

function closeProdModal() {
  document.getElementById('modal-prod').innerHTML = '';
}

function actualizarBadgeStock(val) {
  const n     = parseInt(val) || 0;
  const badge = document.getElementById('p-stock-badge');
  if (!badge) return;
  badge.innerHTML = n > 0
    ? `<span style="color:var(--green)">● En stock (${n})</span>`
    : `<span style="color:var(--red)">● Sin stock</span>`;
}

async function persistirProducto(p) {
  if (!isAdmin()) { console.warn('Acceso denegado'); return false; }

  p.nombre         = String(p.nombre         || '').slice(0, 200).trim();
  p.marca          = String(p.marca          || '').slice(0, 100).trim();
  p.color          = String(p.color          || '').slice(0, 100).trim();
  p.talles         = String(p.talles         || '').slice(0, 100).trim();
  p.precio         = Math.max(0, parseFloat(p.precio)  || 0);
  p.num_stock      = Math.max(0, parseInt(p.num_stock) || 0);
  p.imagen_custom  = (p.imagen_custom  || '').trim();
  p.imagen_scraper = (p.imagen_scraper || '').trim();
  if (p.imagen_custom  && !/^https?:\/\//.test(p.imagen_custom))  p.imagen_custom  = '';
  if (p.imagen_scraper && !/^https?:\/\//.test(p.imagen_scraper)) p.imagen_scraper = '';

  const { imagen: _img, ...fila } = p;

  const { error } = await sb
    .from('productos')
    .upsert(fila, { onConflict: 'id' });

  if (error) {
    console.warn('Error guardando producto:', error.message);
    alert(`No se pudo guardar el producto.\n(${error.message})`);
    return false;
  }

  // Mantener sincronizada la caché local que también usa catalogo.js
  try {
    const local = localStorage.getItem('solemio-productos');
    if (local) {
      const cache = JSON.parse(local);
      const idx   = cache.findIndex(x => x.id === fila.id);
      const conImagen = { ...fila, imagen: resolverImagen(fila) };
      if (idx >= 0) cache[idx] = conImagen; else cache.unshift(conImagen);
      localStorage.setItem('solemio-productos', JSON.stringify(cache));
    }
  } catch (_) {}

  return true;
}

async function saveProd() {
  const nombre = document.getElementById('p-nombre').value.trim();
  if (!nombre) { alert('El nombre es obligatorio'); return; }

  const strTalles = tallesModalState.join(', ');
  const strColor  = coloresModalState.join(', ');
  const num_stock = tallesModalState.length > 0
    ? Object.values(variantesStockState).reduce((acc, v) => acc + (parseInt(v, 10) || 0), 0)
    : (parseInt(document.getElementById('p-num-stock').value, 10) || 0);

  const p = {
    id:             productoActual.id,
    nombre,
    marca:          document.getElementById('p-marca').value.trim(),
    precio:         parseFloat(document.getElementById('p-precio').value) || 0,
    categoria:      document.getElementById('p-categoria')?.value.trim() || null,
    color:          strColor,
    talles:         strTalles,
    num_stock,
    stock:          num_stock > 0,
    imagen_custom:  document.getElementById('p-imagen-custom').value.trim(),
    imagen_scraper: document.getElementById('p-imagen-scraper').value.trim(),
    destacado:      document.getElementById('p-destacado')?.checked || false,
    oculto:         document.getElementById('p-oculto')?.checked || false,
  };

  // Si hay galería pero no foto única, la miniatura del catálogo usa
  // la primera foto de la galería (no todo el sitio sabe leer la galería).
  if (!p.imagen_custom && !p.imagen_scraper && fotosModalState.length) {
    p.imagen_scraper = fotosModalState[0];
  }

  const ok = await persistirProducto(p);
  if (!ok) return;

  // Sincronizar en tabla producto_talles si está disponible
  await sincronizarTallesDB(p.id);
  await sincronizarFotosDB(p.id);

  closeProdModal();
  await cargarProducto();   // refresca la página con los datos ya guardados
}

// Exponer funciones para los onclick del modal
window.agregarTalleItem        = agregarTalleItem;
window.quitarTalleItem         = quitarTalleItem;
window.agregarTalleRapido      = agregarTalleRapido;
window.agregarColorItem        = agregarColorItem;
window.quitarColorItem         = quitarColorItem;
window.agregarColorRapido      = agregarColorRapido;
window.actualizarVarianteStock = actualizarVarianteStock;
window.agregarFotoItem         = agregarFotoItem;
window.quitarFotoItem          = quitarFotoItem;
window.moverFotoItem           = moverFotoItem;
window.cambiarHexColorUI       = cambiarHexColor;
window.seleccionarTalleUI              = seleccionarTalle;
window.seleccionarColorUI              = seleccionarColor;
window.cambiarCantidadSelectorUI       = cambiarCantidadSelector;
window.agregarAlCarritoDesdeProductoUI = agregarAlCarritoDesdeProducto;
window.moverGaleriaUI            = moverGaleria;
window.irAFotoUI                 = irAFoto;
window.abrirZoomUI               = abrirZoom;
window.cerrarZoomUI              = cerrarZoom;
window.onGaleriaTouchStartUI     = onGaleriaTouchStart;
window.onGaleriaTouchEndUI       = onGaleriaTouchEnd;


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

  renderTopbar('catalogo');
  initTheme();
  applyRole();
  initCarritoUI();

  await cargarProducto();
}

async function init() {
  // Se chequea primero la sesión real de Supabase (no el flag de invitado
  // guardado en sessionStorage): si no, un admin que alguna vez entró como
  // invitado en la misma pestaña quedaría pegado en modo invitado aunque
  // después haga login.
  const { data: { session } } = await sb.auth.getSession();

  if (session?.user && await esAdmin(session.user.email)) {
    currentRole = 'admin';
    sessionStorage.removeItem('solemio-role');
    await startApp();

    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        currentRole = null;
        window.location.href = 'login.html';
      }
    });
    return;
  }

  const rolGuardado = sessionStorage.getItem('solemio-role');
  if (rolGuardado === 'guest') {
    currentRole = 'guest';
    await startApp();
    return;
  }

  // Sin sesión de admin → entrar como invitado (acceso público)
  currentRole = 'guest';
  sessionStorage.setItem('solemio-role', 'guest');
  await startApp();
}

// ── Exponer funciones globales para los onclick del HTML ──────
window.toggleTheme          = toggleTheme;
window.doLogout             = doLogout;
window.openProdModal        = openProdModal;
window.closeProdModal       = closeProdModal;
window.saveProd             = saveProd;
window.actualizarBadgeStock = actualizarBadgeStock;

init();
