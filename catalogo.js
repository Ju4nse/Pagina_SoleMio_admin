/* ================================================================
   catalogo.js — Backend propio del panel de catálogo
   Requiere sesión válida (admin o invitado); si no existe, redirige
   de vuelta a login.html
   ================================================================ */
import { sb, esAdmin }        from './supabase-client.js';
import { ICON, initTheme, toggleTheme, hexDeColor, cargarColoresPersonalizados, guardarColorPersonalizado } from './theme.js';
import { initCarritoUI, agregarAlCarrito } from './carrito.js';
import { renderTopbar }       from './topbar.js';
import { renderFooter }       from './footer.js';
import { initAlertasPedidos } from './pedidos-alertas.js';

/* ================================================================
   STATE
   ================================================================ */
let currentRole        = null;   // 'admin' | 'guest'
let productos           = [];
let productosVisibles   = 50;
let editingProdId       = null;
let marcaFiltro         = '';    // marca elegida en el menú "Marcas" del topbar
let categoriaFiltro     = '';    // categoría elegida en el sidebar del catálogo

/* Mismas categorías que ofrece el picker del modal de edición (ver
   openProdModal) — de ahí sale el valor guardado en p.categoria. Un
   producto puede tener varias: se guardan separadas por coma. */
const CATEGORIA_LABELS = {
  conjuntos:   'Conjuntos',
  'corpiños':  'Corpiños',
  bombachas:   'Bombachas',
  pijamas:     'Pijamas & Homewear',
  maternal:    'Maternal & Lactancia',
  modeladora:  'Línea Modeladora & Fajas',
};

function categoriasDeProducto(p) {
  return (p.categoria || '').split(',').map(c => c.trim()).filter(Boolean);
}

function isAdmin()    { return currentRole === 'admin'; }
function isGuest()    { return currentRole === 'guest'; }


/* ================================================================
   REALTIME
   ================================================================ */
let _realtimeCanalProductos = null;

function iniciarRealtime() {
  detenerRealtime();

  _realtimeCanalProductos = sb
    .channel('productos-cambios')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'productos' },
      () => { console.log('🔄 Productos cambiaron'); cargarProductos(); }
    )
    .subscribe();
}

function detenerRealtime() {
  if (_realtimeCanalProductos) { sb.removeChannel(_realtimeCanalProductos); _realtimeCanalProductos = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    detenerRealtime();
  } else if (currentRole) {
    iniciarRealtime();
    cargarProductos();
  }
});


/* ================================================================
   HELPERS
   ================================================================ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function fmtARS(n) {
  return '$\u202F' + Math.round(n).toLocaleString('es-AR');
}

function resolverImagen(p) {
  return p.imagen_custom || p.imagen_scraper || p.imagen || '';
}


/* ================================================================
   CARGAR DATOS — Supabase
   ================================================================ */
async function cargarProductos() {
  const grid = document.getElementById('catalogo-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        Cargando catálogo…
      </div>`;
  }

  const local = localStorage.getItem('solemio-productos');
  if (local) {
    try { productos = JSON.parse(local); renderCatalogo(); } catch (_) {}
  }

  const PAGINA = 1000;
  let todos = [];
  let desde = 0;

  while (true) {
    const { data, error } = await sb
      .from('productos')
      .select('*')
      .eq('eliminado', false)
      .order('id', {ascending: true})
      .range(desde, desde + PAGINA - 1);

    if (error) {
      console.warn('Error cargando productos:', error.message);
      break;
    }

    todos = todos.concat(data);
    if (data.length < PAGINA) break;
    desde += PAGINA;
  }

  productos = todos.map(p => ({ ...p, imagen: resolverImagen(p) }));
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
  renderCatalogo();
  console.log(`✓ ${productos.length} productos cargados`);
}


/* ================================================================
   GUARDAR DATOS — Supabase
   ================================================================ */
async function persistirProducto(p) {
  if (!isAdmin()) { console.warn('Acceso denegado'); return; }

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
    return;
  }

  const idx = productos.findIndex(x => x.id === p.id);
  const productoConImagen = { ...fila, imagen: resolverImagen(fila) };
  if (idx >= 0) productos[idx] = productoConImagen;
  else          productos.unshift(productoConImagen);

  localStorage.setItem('solemio-productos', JSON.stringify(productos));
}

/* "Eliminar" no borra la fila de la base — la marca como eliminada
   (ver sql/2026-09-06_producto_eliminado_soft_delete.sql). Así el
   producto deja de aparecer en cualquier lado (ni admin ni invitados)
   pero el dato queda conservado, por ejemplo para no perder el
   historial de pedidos que lo referencian. */
async function eliminarProductoDB(id) {
  if (!isAdmin()) { console.warn('Acceso denegado'); return; }

  const { error } = await sb.from('productos').update({ eliminado: true }).eq('id', id);
  if (error) { console.warn('Error eliminando producto:', error.message); return; }

  productos = productos.filter(p => p.id !== id);
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
}


/* ================================================================
   RENDER CATÁLOGO
   ================================================================ */
function renderCatalogo(resetear = false) {
  if (resetear) productosVisibles = 30;

  const q     = (document.getElementById('buscar')?.value      || '').toLowerCase();
  const marca = marcaFiltro;
  const stock = document.getElementById('filtro-stock')?.value || '';

  const newBtn = document.querySelector('.toolbar .btn.primary');
  if (newBtn) newBtn.style.display = isGuest() ? 'none' : '';

  const marcas = [...new Set(productos.map(p => p.marca).filter(Boolean))].sort();
  renderMarcasMenu(marcas, marcaFiltro);

  // El conteo del sidebar refleja solo lo que ve un invitado (en stock y no
  // oculto), sea cual sea el rol de quien está mirando el catálogo ahora —
  // así el número siempre coincide con lo que un cliente realmente ve.
  const categoriasContadas = {};
  productos.forEach(p => {
    if (!p.stock || p.oculto) return;
    categoriasDeProducto(p).forEach(c => { categoriasContadas[c] = (categoriasContadas[c] || 0) + 1; });
  });
  renderCategoriasSidebar(categoriasContadas, categoriaFiltro);

  const lista = productos.filter(p => {
    if (p.oculto && isGuest()) return false;
    if (!p.stock && isGuest()) return false; // el invitado solo ve productos con stock
    const q_ok =
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.marca  || '').toLowerCase().includes(q) ||
      (p.id     || '').toLowerCase().includes(q);
    if (q && !q_ok)                            return false;
    if (marca && p.marca !== marca)            return false;
    if (categoriaFiltro && !categoriasDeProducto(p).includes(categoriaFiltro)) return false;
    // El filtro manual de stock (dropdown) es una herramienta de admin.
    if (isAdmin()) {
      if (stock === 'in stock'     && !p.stock) return false;
      if (stock === 'out of stock' &&  p.stock) return false;
    }
    return true;
  });

  const grid = document.getElementById('catalogo-grid');
  if (!grid) return;

  if (!lista.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        No se encontraron productos
      </div>`;
    return;
  }

  const visibles = lista.slice(0, productosVisibles);
  const hayMas   = lista.length > productosVisibles;

  grid.innerHTML = visibles.map((p, i) => {
    const img      = p.imagen;
    const enStock  = p.stock === true || p.stock === 'in stock';
    const cantidad = p.num_stock ?? null;

    const badgeStock = isAdmin()
      ? (enStock ? (cantidad != null ? `En stock (${cantidad})` : 'En stock') : 'Sin stock')
      : null; // el stock es un dato interno: no se muestra a invitados

    return `
    <a class="prod-card" style="animation-delay:${i * 30}ms" href="producto.html?id=${encodeURIComponent(p.id)}">
      ${img
        ? `<img class="prod-thumb" src="${img}" alt="${p.nombre}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="prod-thumb-ph" style="${img ? 'display:none' : ''}">${ICON.shoe}</div>
      <div class="prod-body">
        <div style="font-size:.7rem;color:var(--text-3);font-family:monospace;margin-bottom:.2rem">ID: ${p.id}</div>
        <div class="prod-name">${p.nombre}</div>
        <div class="prod-meta">${[p.color, p.talles].filter(Boolean).join(' · ')}</div>
        <div class="prod-price">${fmtARS(Math.round(p.precio * 1.5))}</div>
        <div class="prod-badges">
          ${badgeStock ? `<span class="badge ${enStock ? 'stock' : 'nostock'}">${badgeStock}</span>` : ''}
          ${p.marca ? `<span class="badge marca">${p.marca}</span>` : ''}
          ${p.destacado && isAdmin() ? `<span class="badge" style="background:var(--blue-bg,#e8f0fe);color:var(--blue,#1a73e8)">★ Destacado</span>` : ''}
          ${p.oculto && isAdmin() ? `<span class="badge" style="background:var(--red-bg);color:var(--red)">Oculto</span>` : ''}
          ${p.imagen_custom && isAdmin() ? `<span class="badge" style="background:var(--blue-bg,#e8f0fe);color:var(--blue,#1a73e8)">Foto custom</span>` : ''}
        </div>
        ${isAdmin() ? `
        <div class="prod-actions">
          <button class="btn sm ghost" onclick="event.preventDefault();event.stopPropagation();openProdModal('${p.id}')">
            ${ICON.edit} Editar
          </button>
          <button class="btn sm danger" onclick="event.preventDefault();event.stopPropagation();confirmarEliminar('${p.id}')">
            ${ICON.trash}
          </button>
        </div>` : `
        <div class="prod-quickadd">
          <button type="button" class="btn sm primary" ${!enStock ? 'disabled' : ''}
            onclick="event.preventDefault();event.stopPropagation();agregarAlCarritoRapidoUI('${p.id}')">
            ${ICON.cart} Agregar
          </button>
        </div>`}
      </div>
    </a>`;
  }).join('');

  if (hayMas) {
    grid.insertAdjacentHTML('beforeend', `
      <div style="grid-column:1/-1;text-align:center;padding:1.5rem 0">
        <button class="btn ghost" onclick="cargarMas()">
          Cargar más (${productosVisibles} de ${lista.length})
        </button>
      </div>`);
  }
}

function cargarMas() {
  productosVisibles += 50;
  renderCatalogo();
}

/* Agrega un producto al carrito directo desde su tarjeta del catálogo,
   sin pasar por su detalle. Va sin talle/color: se eligen después en
   el carrito (ver carrito-page.js). Si el producto tiene talles y/o
   colores para elegir, cada click agrega una línea separada (en vez
   de sumar cantidad a una ya pendiente de elección), para poder
   agregar el mismo producto varias veces y darle a cada uno un talle
   o color distinto — si dos terminan con la misma combinación, el
   carrito las fusiona solo en ese momento. */
function agregarAlCarritoRapido(id) {
  const p = productos.find(x => x.id === id);
  if (!p) return;

  const necesitaSeleccion = !!(p.talles || p.color);

  agregarAlCarrito({
    productoId:     p.id,
    nombre:         p.nombre,
    precioUnitario: Math.round(p.precio * 1.5),
    imagen:         p.imagen,
    talle:          '',
    color:          '',
    cantidad:       1,
    separado:       necesitaSeleccion,
  });
}

/* ── MENÚ "MARCAS" DEL TOPBAR — panel que se despliega al hacer
   hover sobre el trigger (ver .marcas-panel en catalogo.css). Se
   reconstruye cada vez que renderCatalogo() recalcula la lista de
   marcas, así siempre refleja el catálogo actual. En varias columnas
   (CSS columns) para que entren aunque haya muchas. ────────────── */
function renderMarcasMenu(marcas, marcaActual) {
  const panel = document.getElementById('marcas-panel');
  if (!panel) return;

  if (!marcas.length) {
    panel.innerHTML = '<span class="marcas-empty">Todavía no hay marcas cargadas</span>';
    return;
  }

  panel.innerHTML =
    `<button type="button" class="marcas-item${marcaActual ? '' : ' active'}" data-marca="">Todas las marcas</button>` +
    marcas.map(m =>
      `<button type="button" class="marcas-item${m === marcaActual ? ' active' : ''}" data-marca="${m}">${m}</button>`
    ).join('');
}

document.addEventListener('click', (e) => {
  const item = e.target.closest('.marcas-item');
  if (!item) return;
  marcaFiltro = item.dataset.marca || '';
  renderCatalogo(true);

  // Cierra el desplegable al elegir: como se abre con :hover, sin esto
  // seguiría abierto tapando los productos hasta que el mouse se fuera.
  const menu = item.closest('.marcas-menu');
  if (menu) {
    menu.classList.add('force-closed');
    menu.addEventListener('mouseleave', () => menu.classList.remove('force-closed'), { once: true });
  }
});

/* ── SIDEBAR "CATEGORÍA" — a la izquierda del catálogo. Solo lista
   las categorías que efectivamente tienen algún producto cargado
   (muchos productos todavía no tienen categoria asignada). ────── */
function renderCategoriasSidebar(categoriasContadas, categoriaActual) {
  const list = document.getElementById('categoria-list');
  if (!list) return;

  const categorias = Object.keys(categoriasContadas)
    .sort((a, b) => (CATEGORIA_LABELS[a] || a).localeCompare(CATEGORIA_LABELS[b] || a));

  if (!categorias.length) {
    list.innerHTML = '<li class="categoria-empty">Todavía no hay categorías cargadas</li>';
    return;
  }

  list.innerHTML =
    `<li><button type="button" class="categoria-item${categoriaActual ? '' : ' active'}" data-categoria="">Todas</button></li>` +
    categorias.map(c => `
      <li>
        <button type="button" class="categoria-item${c === categoriaActual ? ' active' : ''}" data-categoria="${c}">
          <span>${CATEGORIA_LABELS[c] || c}</span>
          <span class="categoria-count">${categoriasContadas[c]}</span>
        </button>
      </li>`).join('');
}

document.addEventListener('click', (e) => {
  const item = e.target.closest('.categoria-item');
  if (!item) return;
  categoriaFiltro = item.dataset.categoria || '';
  renderCatalogo(true);
});


/* ================================================================
   GESTOR DE TALLES + COLORES + STOCK POR COMBINACIÓN (MODAL)

   El stock real vive por combinación talle×color (variantesStockState),
   sincronizado 1:1 con producto_talles(producto_id, talle, color, stock).
   Si el producto no tiene colores cargados, cada talle usa color=''.
   ================================================================ */
let tallesModalState     = [];  // nombres de talle, ej. ['S','M','L']
let coloresModalState    = [];  // nombres de color, ej. ['Negro','Rojo']
let variantesStockState  = {};  // `${talle}||${color}` -> stock (int)
let fotosModalState      = [];  // urls de producto_fotos, en orden
let categoriasModalState = [];  // claves de CATEGORIA_LABELS elegidas, ej. ['bombachas','conjuntos']

function claveVariante(talle, color) { return `${talle}||${color || ''}`; }

function renderCategoriaChipsPicker() {
  const container = document.getElementById('categoria-chips-picker');
  if (!container) return;

  container.innerHTML = Object.entries(CATEGORIA_LABELS).map(([valor, label]) => `
    <button type="button" class="attr-tag selector-chip${categoriasModalState.includes(valor) ? ' selected' : ''}"
      onclick="toggleCategoriaModalUI('${valor}')">${label}</button>
  `).join('');
}

function toggleCategoriaModal(valor) {
  const idx = categoriasModalState.indexOf(valor);
  if (idx >= 0) categoriasModalState.splice(idx, 1);
  else          categoriasModalState.push(valor);
  renderCategoriaChipsPicker();
}

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
   MODAL PRODUCTO
   ================================================================ */
async function openProdModal(id) {
  editingProdId = id || null;
  const p     = id ? productos.find(x => x.id === id) : null;
  const title = p ? 'Editar producto' : 'Nuevo producto';

  await cargarColoresPersonalizados();

  const seedTalles   = parsearTallesTexto(p?.talles || '');
  tallesModalState   = seedTalles.map(t => t.talle);
  coloresModalState  = parsearColoresTexto(p?.color || '');
  variantesStockState = {};
  seedTalles.forEach(t => { variantesStockState[claveVariante(t.talle, '')] = t.stock; });
  fotosModalState = [];
  categoriasModalState = (p?.categoria || '').split(',').map(c => c.trim()).filter(Boolean);

  document.getElementById('modal-prod').innerHTML = `
    <div class="modal-overlay" id="mpo" onclick="if(event.target.id==='mpo') closeProdModal()">
      <div class="modal prod-modal-grande">
        <div class="modal-title">${ICON.edit} ${title}</div>

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
          <label>Categorías
            <span style="font-size:.72rem;color:var(--text-3);font-weight:400"> — podés elegir más de una</span>
          </label>
          <div class="selector-compra" id="categoria-chips-picker" style="margin:0"></div>
        </div>

        <!-- SECCIÓN GESTIÓN DE COLORES -->
        <div class="field colores-manager-section">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
            <label style="margin:0; font-weight:600; font-size:0.85rem;">Colores disponibles</label>
            <span style="font-size:0.75rem; color:var(--text-3);" id="colores-resumen">Cargando…</span>
          </div>
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

  renderCategoriaChipsPicker();
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

function actualizarBadgeStock(val) {
  const n     = parseInt(val) || 0;
  const badge = document.getElementById('p-stock-badge');
  if (!badge) return;
  badge.innerHTML = n > 0
    ? `<span style="color:var(--green)">● En stock (${n})</span>`
    : `<span style="color:var(--red)">● Sin stock</span>`;
}

function closeProdModal() {
  document.getElementById('modal-prod').innerHTML = '';
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
    id:             (editingProdId || uid()),
    nombre,
    marca:          document.getElementById('p-marca').value.trim(),
    precio:         parseFloat(document.getElementById('p-precio').value) || 0,
    categoria:      categoriasModalState.join(',') || null,
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

  await persistirProducto(p);

  // Sincronizar en tabla producto_talles si está disponible
  await sincronizarTallesDB(p.id);
  await sincronizarFotosDB(p.id);

  closeProdModal();
  renderCatalogo();
}

async function confirmarEliminar(id) {
  if (!confirm('¿Eliminar este producto? Deja de verse en la página, pero el dato queda guardado en la base.')) return;
  await eliminarProductoDB(id);
  renderCatalogo();
}


/* ================================================================
   MODAL DE CUENTA — cambiar contraseña (solo admin)
   ================================================================ */
function openAccountModal() {
  if (!isAdmin()) return;

  document.getElementById('modal-account').innerHTML = `
    <div class="modal-overlay" id="mao" onclick="if(event.target.id==='mao') closeAccountModal()">
      <div class="modal">
        <div class="modal-title">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;stroke:var(--text-2)">
            <circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
          Cambiar contraseña
        </div>

        <div class="field">
          <label>Nueva contraseña</label>
          <input type="password" id="cp-nueva" placeholder="••••••••" autocomplete="new-password">
        </div>
        <div class="field">
          <label>Repetir nueva</label>
          <input type="password" id="cp-repetir" placeholder="••••••••" autocomplete="new-password">
        </div>
        <div id="cp-msg" style="font-size:.78rem;min-height:18px"></div>

        <div class="modal-footer">
          <button class="btn ghost" onclick="closeAccountModal()">Cerrar</button>
          <button class="btn primary" onclick="cambiarPassword()">Actualizar contraseña</button>
        </div>
      </div>
    </div>`;
}

function closeAccountModal() {
  document.getElementById('modal-account').innerHTML = '';
}

async function cambiarPassword() {
  if (!isAdmin()) return;

  const nueva   = document.getElementById('cp-nueva').value;
  const repetir = document.getElementById('cp-repetir').value;
  const msgEl   = document.getElementById('cp-msg');

  msgEl.style.color = 'var(--red)';
  if (!nueva || !repetir) { msgEl.textContent = 'Completá los campos'; return; }
  if (nueva.length < 8)   { msgEl.textContent = 'Mínimo 8 caracteres'; return; }
  if (nueva !== repetir)  { msgEl.textContent = 'Las contraseñas no coinciden'; return; }

  const { error } = await sb.auth.updateUser({ password: nueva });

  if (error) { msgEl.textContent = `Error: ${error.message}`; return; }

  msgEl.style.color = 'var(--green)';
  msgEl.textContent  = '✓ Contraseña actualizada correctamente';
  document.getElementById('cp-nueva').value   = '';
  document.getElementById('cp-repetir').value = '';
}


/* ================================================================
   ROL / ACCESOS
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
   LOGOUT
   ================================================================ */
async function doLogout() {
  detenerRealtime();

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
  document.getElementById('app').style.display = 'flex';

  renderTopbar('catalogo', { search: true, marcas: true });
  renderFooter();
  initAlertasPedidos(currentRole);
  initTheme();
  applyRole();
  initCarritoUI();

  await new Promise(r => requestAnimationFrame(r));

  await cargarProductos();
  iniciarRealtime();

  // volver desde producto.html con "Editar" abre el modal directamente
  const params  = new URLSearchParams(location.search);
  const editId  = params.get('edit');
  if (editId && isAdmin()) {
    openProdModal(editId);
    history.replaceState(null, '', 'catalogo.html');
  }

  // el botón "Mi cuenta" de otras páginas linkea acá con ?account=1
  if (params.get('account') === '1' && isAdmin()) {
    openAccountModal();
    history.replaceState(null, '', 'catalogo.html');
  }
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

  // Sin sesión de admin → entrar como invitado (acceso público al catálogo)
  currentRole = 'guest';
  sessionStorage.setItem('solemio-role', 'guest');
  await startApp();
}

// ── Exponer funciones globales para los onclick del HTML ──────
window.toggleTheme          = toggleTheme;
window.renderCatalogo       = renderCatalogo;
window.cargarMas            = cargarMas;
window.agregarAlCarritoRapidoUI = agregarAlCarritoRapido;
window.openProdModal        = openProdModal;
window.closeProdModal       = closeProdModal;
window.saveProd             = saveProd;
window.actualizarBadgeStock = actualizarBadgeStock;
window.confirmarEliminar    = confirmarEliminar;
window.openAccountModal     = openAccountModal;
window.closeAccountModal    = closeAccountModal;
window.cambiarPassword      = cambiarPassword;
window.doLogout              = doLogout;
window.toggleCategoriaModalUI  = toggleCategoriaModal;
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

init();
