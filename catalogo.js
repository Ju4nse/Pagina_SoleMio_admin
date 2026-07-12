/* ================================================================
   catalogo.js — Backend propio del panel (catálogo, compras, sync)
   Requiere sesión válida (admin o invitado); si no existe, redirige
   de vuelta a login.html
   ================================================================ */
import { sb, esAdmin }        from './supabase-client.js';
import { ICON, initTheme, toggleTheme } from './theme.js';

/* ================================================================
   STATE
   ================================================================ */
let currentRole        = null;   // 'admin' | 'guest'
let productos           = [];
let compras             = [];
let productosVisibles   = 50;
let editingProdId       = null;

function isAdmin()    { return currentRole === 'admin'; }
function isGuest()    { return currentRole === 'guest'; }


/* ================================================================
   REALTIME
   ================================================================ */
let _realtimeCanalProductos = null;
let _realtimeCanalCompras   = null;

function iniciarRealtime() {
  detenerRealtime();

  _realtimeCanalProductos = sb
    .channel('productos-cambios')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'productos' },
      () => { console.log('🔄 Productos cambiaron'); cargarProductos(); }
    )
    .subscribe();

  _realtimeCanalCompras = sb
    .channel('compras-cambios')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'compras' },
      () => { console.log('🔄 Compras cambiaron'); cargarCompras(); }
    )
    .subscribe();
}

function detenerRealtime() {
  if (_realtimeCanalProductos) { sb.removeChannel(_realtimeCanalProductos); _realtimeCanalProductos = null; }
  if (_realtimeCanalCompras)   { sb.removeChannel(_realtimeCanalCompras);   _realtimeCanalCompras   = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    detenerRealtime();
  } else if (currentRole) {
    iniciarRealtime();
    cargarProductos();
    cargarCompras();
  }
});


/* ================================================================
   CONFIG — GitHub Actions
   ================================================================ */
let ghToken = '';

function loadConfig() {
  const t = sessionStorage.getItem('solemio-gh-token');
  if (t) ghToken = t;
}

function saveConfig() {
  ghToken = document.getElementById('gh-token').value.trim();
  sessionStorage.setItem('solemio-gh-token', ghToken);
  localStorage.setItem('gh-repo',     document.getElementById('gh-repo').value);
  localStorage.setItem('gh-workflow', document.getElementById('gh-workflow').value);
}

function fillSyncInputs() {
  const t = sessionStorage.getItem('solemio-gh-token');
  const r = localStorage.getItem('gh-repo');
  const w = localStorage.getItem('gh-workflow');
  if (document.getElementById('gh-token')    && t) document.getElementById('gh-token').value    = t;
  if (document.getElementById('gh-repo')     && r) document.getElementById('gh-repo').value     = r;
  if (document.getElementById('gh-workflow') && w) document.getElementById('gh-workflow').value = w;
}


/* ================================================================
   TABS
   ================================================================ */
function showTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'compras') renderCompras();
  if (name === 'sync')    fillSyncInputs();
}


/* ================================================================
   HELPERS
   ================================================================ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function fmtARS(n) {
  return '$\u202F' + Math.round(n).toLocaleString('es-AR');
}

function fmtFecha(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
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

async function cargarCompras() {
  const local = localStorage.getItem('solemio-compras');
  if (local) {
    try { compras = JSON.parse(local); } catch (_) {}
  }

  const { data, error } = await sb
    .from('compras')
    .select('*')
    .order('fecha', { ascending: false });

  if (error) {
    console.warn('Error cargando compras:', error.message);
    return;
  }

  compras = data;
  localStorage.setItem('solemio-compras', JSON.stringify(compras));
  console.log(`✓ ${compras.length} compras cargadas`);

  if (document.getElementById('tab-compras')?.classList.contains('active')) {
    renderCompras();
  }
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

async function eliminarProductoDB(id) {
  if (!isAdmin()) { console.warn('Acceso denegado'); return; }

  const { error } = await sb.from('productos').delete().eq('id', id);
  if (error) { console.warn('Error eliminando producto:', error.message); return; }

  productos = productos.filter(p => p.id !== id);
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
}

async function persistirCompra(c) {
  if (!isAdmin()) { console.warn('Acceso denegado'); return; }

  c.notas = String(c.notas || '').slice(0, 500).trim();
  c.monto = Math.max(0, parseFloat(c.monto) || 0);

  const { error } = await sb.from('compras').insert(c);

  if (error) {
    console.warn('Error guardando compra:', error.message);
    alert(`No se pudo guardar la compra.\n(${error.message})`);
    return;
  }

  compras.unshift(c);
  localStorage.setItem('solemio-compras', JSON.stringify(compras));
}

async function eliminarCompraDB(id) {
  if (!isAdmin()) { console.warn('Acceso denegado'); return; }

  const { error } = await sb.from('compras').delete().eq('id', id);
  if (error) { console.warn('Error eliminando compra:', error.message); return; }

  compras = compras.filter(c => c.id !== id);
  localStorage.setItem('solemio-compras', JSON.stringify(compras));
}


/* ================================================================
   RENDER CATÁLOGO
   ================================================================ */
function renderCatalogo(resetear = false) {
  if (resetear) productosVisibles = 30;

  const q     = (document.getElementById('buscar')?.value      || '').toLowerCase();
  const marca = document.getElementById('filtro-marca')?.value || '';
  const stock = document.getElementById('filtro-stock')?.value || '';

  const newBtn = document.querySelector('.toolbar .btn.primary');
  if (newBtn) newBtn.style.display = isGuest() ? 'none' : '';

  const marcas = [...new Set(productos.map(p => p.marca).filter(Boolean))].sort();
  const mSel   = document.getElementById('filtro-marca');
  const mCur   = mSel?.value || '';
  if (mSel) {
    mSel.innerHTML =
      '<option value="">Todas las marcas</option>' +
      marcas.map(m => `<option value="${m}"${m === mCur ? ' selected' : ''}>${m}</option>`).join('');
  }

  const lista = productos.filter(p => {
    if (p.oculto && isGuest()) return false;
    const q_ok =
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.marca  || '').toLowerCase().includes(q) ||
      (p.id     || '').toLowerCase().includes(q);
    if (q && !q_ok)                            return false;
    if (marca && p.marca !== marca)            return false;
    if (stock === 'in stock'     && !p.stock) return false;
    if (stock === 'out of stock' &&  p.stock) return false;
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

    const badgeStock = enStock
      ? (isAdmin() && cantidad != null ? `En stock (${cantidad})` : 'En stock')
      : 'Sin stock';

    return `
    <article class="prod-card" style="animation-delay:${i * 30}ms;cursor:pointer" onclick="openViewModal('${p.id}')">
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
          <span class="badge ${enStock ? 'stock' : 'nostock'}">${badgeStock}</span>
          ${p.marca ? `<span class="badge marca">${p.marca}</span>` : ''}
          ${p.oculto && isAdmin() ? `<span class="badge" style="background:var(--red-bg);color:var(--red)">Oculto</span>` : ''}
          ${p.imagen_custom && isAdmin() ? `<span class="badge" style="background:var(--blue-bg,#e8f0fe);color:var(--blue,#1a73e8)">Foto custom</span>` : ''}
        </div>
        ${isAdmin() ? `
        <div class="prod-actions">
          <button class="btn sm ghost" onclick="event.stopPropagation();openProdModal('${p.id}')">
            ${ICON.edit} Editar
          </button>
          <button class="btn sm danger" onclick="event.stopPropagation();confirmarEliminar('${p.id}')">
            ${ICON.trash}
          </button>
        </div>` : ''}
      </div>
    </article>`;
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


/* ================================================================
   MODAL VER DETALLE (foto grande + todos los datos)
   ================================================================ */
function openViewModal(id) {
  const p = productos.find(x => x.id === id);
  if (!p) return;

  const img      = p.imagen;
  const enStock  = p.stock === true || p.stock === 'in stock';
  const cantidad = p.num_stock ?? null;

  const badgeStock = enStock
    ? (isAdmin() && cantidad != null ? `En stock (${cantidad})` : 'En stock')
    : 'Sin stock';

  document.getElementById('modal-view').innerHTML = `
    <div class="modal-overlay" id="mvo" onclick="if(event.target.id==='mvo') closeViewModal()">
      <div class="modal modal-view-box">
        <button class="modal-close-x" onclick="closeViewModal()" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>

        ${img
          ? `<img class="view-img" src="${img}" alt="${p.nombre}"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
             <div class="view-img-ph" style="display:none">${ICON.shoe}</div>`
          : `<div class="view-img-ph">${ICON.shoe}</div>`}

        <div class="view-body">
          <div style="font-size:.72rem;color:var(--text-3);font-family:monospace;margin-bottom:.25rem">ID: ${p.id}</div>
          <div class="view-name">${p.nombre}</div>
          <div class="view-price">${fmtARS(Math.round(p.precio * 1.5))}</div>

          <div class="prod-badges" style="margin:.6rem 0 1rem">
            <span class="badge ${enStock ? 'stock' : 'nostock'}">${badgeStock}</span>
            ${p.marca ? `<span class="badge marca">${p.marca}</span>` : ''}
            ${p.oculto && isAdmin() ? `<span class="badge" style="background:var(--red-bg);color:var(--red)">Oculto</span>` : ''}
            ${p.imagen_custom && isAdmin() ? `<span class="badge" style="background:var(--blue-bg,#e8f0fe);color:var(--blue,#1a73e8)">Foto custom</span>` : ''}
          </div>

          <div class="view-grid">
            <div><label>Marca</label><span>${p.marca || '—'}</span></div>
            <div><label>Color</label><span>${p.color || '—'}</span></div>
            <div><label>Talles</label><span>${p.talles || '—'}</span></div>
            <div><label>Precio base</label><span>${fmtARS(p.precio || 0)}</span></div>
          </div>
        </div>

        ${isAdmin() ? `
        <div class="modal-footer">
          <button class="btn ghost" onclick="closeViewModal()">Cerrar</button>
          <button class="btn primary" onclick="closeViewModal();openProdModal('${p.id}')">${ICON.edit} Editar</button>
        </div>` : ''}
      </div>
    </div>`;
}

function closeViewModal() {
  document.getElementById('modal-view').innerHTML = '';
}


/* ================================================================
   MODAL PRODUCTO
   ================================================================ */
function openProdModal(id) {
  editingProdId = id || null;
  const p     = id ? productos.find(x => x.id === id) : null;
  const title = p ? 'Editar producto' : 'Nuevo producto';

  document.getElementById('modal-prod').innerHTML = `
    <div class="modal-overlay" id="mpo" onclick="if(event.target.id==='mpo') closeProdModal()">
      <div class="modal">
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
        <div class="field-row">
          <div class="field">
            <label>Color</label>
            <input id="p-color" type="text" value="${p?.color || ''}">
          </div>
          <div class="field">
            <label>Talles</label>
            <input id="p-talles" type="text" value="${p?.talles || ''}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Cantidad en stock</label>
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

  const num_stock = parseInt(document.getElementById('p-num-stock').value) || 0;

  const p = {
    id:             (editingProdId || uid()),
    nombre,
    marca:          document.getElementById('p-marca').value.trim(),
    precio:         parseFloat(document.getElementById('p-precio').value) || 0,
    color:          document.getElementById('p-color').value.trim(),
    talles:         document.getElementById('p-talles').value.trim(),
    num_stock,
    stock:          num_stock > 0,
    imagen_custom:  document.getElementById('p-imagen-custom').value.trim(),
    imagen_scraper: document.getElementById('p-imagen-scraper').value.trim(),
    oculto:         document.getElementById('p-oculto')?.checked || false,
  };

  await persistirProducto(p);
  closeProdModal();
  renderCatalogo();
}

async function confirmarEliminar(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  await eliminarProductoDB(id);
  renderCatalogo();
}


/* ================================================================
   MODAL COMPRA
   ================================================================ */
function openPurchaseModal() {
  window._sel = [];
  const today = new Date().toISOString().slice(0, 10);

  document.getElementById('modal-compra').innerHTML = `
    <div class="modal-overlay" id="mco" onclick="if(event.target.id==='mco') closePurchaseModal()">
      <div class="modal">
        <div class="modal-title">${ICON.cart} Registrar compra</div>
        <div class="field">
          <label>Fecha</label>
          <input id="c-fecha" type="date" value="${today}">
        </div>
        <div class="field">
          <label>Productos</label>
          <div class="sel-tags" id="c-tags">
            <span style="font-size:.75rem;color:var(--text-3)">Ninguno seleccionado</span>
          </div>
          <input type="text" id="c-buscar" placeholder="Buscar producto…"
            oninput="renderProdSel()" style="margin-bottom:.5rem" autocomplete="off">
          <div class="prod-selector" id="c-prod-sel"></div>
        </div>
        <div class="field">
          <label>Monto total ($)</label>
          <input id="c-monto" type="number" placeholder="0" oninput="this.dataset.manual='1'">
        </div>
        <div class="field">
          <label>Notas</label>
          <textarea id="c-notas" placeholder="Método de pago, cliente, observaciones…"></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn ghost" onclick="closePurchaseModal()">Cancelar</button>
          <button class="btn primary" onclick="savePurchase()">${ICON.check} Guardar</button>
        </div>
      </div>
    </div>`;

  function updateTags() {
    const tags = document.getElementById('c-tags');
    if (!tags) return;
    tags.innerHTML = window._sel.length
      ? window._sel.map(s =>
          `<span class="sel-tag">${s.nombre}
             <button onclick="removeSel('${s.id}')" aria-label="Quitar">×</button>
           </span>`).join('')
      : '<span style="font-size:.75rem;color:var(--text-3)">Ninguno seleccionado</span>';

    const mEl = document.getElementById('c-monto');
    if (mEl && !mEl.dataset.manual) {
      mEl.value = Math.round(window._sel.reduce((a, s) => a + s.precio * 1.5, 0)) || '';
    }
  }

  window.renderProdSel = function () {
    const q      = (document.getElementById('c-buscar')?.value || '').toLowerCase();
    const filtro = productos.filter(p =>
      p.nombre.toLowerCase().includes(q) || (p.marca || '').toLowerCase().includes(q)
    );

    document.getElementById('c-prod-sel').innerHTML = filtro.map(p => `
      <div class="prod-sel-item"
           onclick="toggleSel('${p.id}','${p.nombre.replace(/'/g, "\\'")}',${p.precio})">
        <input type="checkbox"
               ${window._sel.find(s => s.id === p.id) ? 'checked' : ''}
               onclick="event.stopPropagation();toggleSel('${p.id}','${p.nombre.replace(/'/g, "\\'")}',${p.precio})">
        <span style="flex:1">${p.nombre}</span>
        <span style="color:var(--text-3);font-size:.78rem;display:flex;gap:.4rem;align-items:center">
          ${p.num_stock != null ? `<span style="font-size:.7rem">(${p.num_stock} disp.)</span>` : ''}
          ${fmtARS(Math.round(p.precio * 1.5))}
        </span>
      </div>`).join('');

    updateTags();
  };

  window.toggleSel = function (id, nombre, precio) {
    const idx = window._sel.findIndex(s => s.id === id);
    if (idx >= 0) window._sel.splice(idx, 1);
    else          window._sel.push({ id, nombre, precio });
    window.renderProdSel();
  };

  window.removeSel = function (id) {
    const idx = window._sel.findIndex(s => s.id === id);
    if (idx >= 0) { window._sel.splice(idx, 1); window.renderProdSel(); }
  };

  window.renderProdSel();
}

function closePurchaseModal() {
  document.getElementById('modal-compra').innerHTML = '';
}

async function savePurchase() {
  const fecha = document.getElementById('c-fecha').value;
  const monto = parseFloat(document.getElementById('c-monto').value) || 0;
  const notas = document.getElementById('c-notas').value.trim();
  if (!fecha) { alert('La fecha es obligatoria'); return; }

  const sel = [...(window._sel || [])];
  const c   = { id: uid(), fecha, monto, productos: sel, notas };

  for (const item of sel) {
    const prod = productos.find(p => p.id === item.id);
    if (!prod) continue;
    const nuevo_num_stock = Math.max(0, (prod.num_stock || 0) - (item.cantidad || 1));
    await persistirProducto({ ...prod, num_stock: nuevo_num_stock, stock: nuevo_num_stock > 0 });
  }

  await persistirCompra(c);
  closePurchaseModal();
  renderCompras();
  renderCatalogo();
}


/* ================================================================
   RENDER COMPRAS
   ================================================================ */
function renderCompras() {
  const hoy   = new Date().toISOString().slice(0, 10);
  const mes   = new Date().toISOString().slice(0, 7);
  const total = compras.reduce((a, c) => a + c.monto, 0);
  const hoyM  = compras.filter(c => c.fecha === hoy).reduce((a, c) => a + c.monto, 0);
  const mesM  = compras.filter(c => (c.fecha || '').startsWith(mes)).reduce((a, c) => a + c.monto, 0);

  document.getElementById('stats-row').innerHTML = [
    ['Total ventas', compras.length],
    ['Hoy',          fmtARS(hoyM)],
    ['Este mes',     fmtARS(mesM)],
    ['Acumulado',    fmtARS(total)],
  ].map(([l, v]) => `
    <div class="stat-card">
      <div class="stat-label">${l}</div>
      <div class="stat-val">${v}</div>
    </div>`).join('');

  const el = document.getElementById('purchase-list');

  if (!compras.length) {
    el.innerHTML = `<div class="empty">${ICON.cart} No hay compras registradas todavía</div>`;
    return;
  }

  el.innerHTML =
    '<div class="purchase-list">' +
    compras.map(c => `
      <div class="purchase-card">
        <div class="purchase-date">${c.fecha ? fmtFecha(c.fecha) : '—'}</div>
        <div class="purchase-body">
          <div class="purchase-prods">
            ${c.productos?.length ? c.productos.map(p => p.nombre).join(', ') : 'Sin productos'}
          </div>
          ${c.notas ? `<div class="purchase-notes">${c.notas}</div>` : ''}
        </div>
        <div class="purchase-right">
          <div class="purchase-amount">${fmtARS(c.monto)}</div>
          <button class="btn sm danger" onclick="confirmarEliminarCompra('${c.id}')">
            ${ICON.trash} Eliminar
          </button>
        </div>
      </div>`).join('') +
    '</div>';
}

async function confirmarEliminarCompra(id) {
  if (!confirm('¿Eliminar esta compra?')) return;
  await eliminarCompraDB(id);
  renderCompras();
}


/* ================================================================
   GITHUB ACTIONS
   ================================================================ */
async function pollWorkflowResult(token, repo) {
  const status  = document.getElementById('run-status');
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
  };

  const MAX_INTENTOS = 24;
  let intento = 0;

  while (intento < MAX_INTENTOS) {
    await new Promise(r => setTimeout(r, 10000));
    intento++;
    status.innerHTML = `<span class="spin">↻</span> Ejecutando… (~${intento * 10}s)`;

    try {
      const res  = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs?per_page=5`,
        { headers }
      );
      const data = await res.json();
      const run  = (data.workflow_runs || []).find(r => r.path?.includes('catalogo'));

      if (!run) continue;

      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          status.innerHTML = `<span class="spin">↻</span> Script finalizado, recargando catálogo…`;
          await cargarProductos();
          status.innerHTML = `<span style="color:var(--green)">✓ Catálogo actualizado correctamente</span>`;
        } else {
          status.innerHTML = `<span style="color:var(--red)">✗ El script falló. <a href="${run.html_url}" target="_blank" style="color:var(--red);text-decoration:underline">Ver detalle en GitHub</a></span>`;
        }
        document.getElementById('run-btn').disabled = false;
        return;
      }
    } catch (_) {}
  }

  status.innerHTML = `<span style="color:var(--text-2)">No se pudo confirmar. Revisá <a href="https://github.com/${repo}/actions" target="_blank" style="color:var(--blue)">GitHub Actions</a>.</span>`;
  document.getElementById('run-btn').disabled = false;
}

async function runScript() {
  const token    = document.getElementById('gh-token').value.trim();
  const repo     = document.getElementById('gh-repo').value.trim();
  const workflow = document.getElementById('gh-workflow').value.trim() || 'catalogo.yml';
  const status   = document.getElementById('run-status');
  const btn      = document.getElementById('run-btn');

  if (!token || !repo) {
    status.innerHTML = '<span style="color:var(--red)">Completá el token y el repo primero</span>';
    return;
  }

  btn.disabled     = true;
  status.innerHTML = '<span class="spin">↻</span> Enviando solicitud…';

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Accept':        'application/vnd.github.v3+json',
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (res.status === 204) {
      status.innerHTML = '<span class="spin">↻</span> Workflow iniciado, esperando resultado…';
      pollWorkflowResult(token, repo);
    } else {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || `HTTP ${res.status}`);
    }
  } catch (e) {
    status.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    btn.disabled = false;
  }
}


/* ================================================================
   ROL / ACCESOS
   ================================================================ */
function applyRole() {
  const isG = isGuest();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    const tab = btn.getAttribute('onclick')?.match(/showTab\('(\w+)'/)?.[1];
    btn.style.display = (isG && (tab === 'compras' || tab === 'sync')) ? 'none' : '';
  });

  document.getElementById('app').dataset.role = isG ? 'guest' : 'admin';

  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = isG ? 'Invitado' : 'Admin';
    badge.className   = 'role-badge ' + (isG ? 'guest' : 'admin');
  }

  if (isG) {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && (activeTab.id === 'tab-compras' || activeTab.id === 'tab-sync')) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-catalogo').classList.add('active');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.nav-btn').classList.add('active');
    }
  }
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
  localStorage.removeItem('solemio-compras');

  window.location.href = 'login.html';
}


/* ================================================================
   INIT / GUARDIA DE AUTENTICACIÓN
   ================================================================ */
async function startApp() {
  document.getElementById('app').style.display = 'block';

  initTheme();
  applyRole();

  await new Promise(r => requestAnimationFrame(r));

  loadConfig();

  // filtro de stock por defecto para invitados que vienen de "Ver como invitado"
  if (isGuest() && new URLSearchParams(location.search).get('stock') === 'in') {
    const filtroStock = document.getElementById('filtro-stock');
    if (filtroStock) filtroStock.value = 'in stock';
  }

  await cargarProductos();
  await cargarCompras();
  iniciarRealtime();
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
window.toggleTheme             = toggleTheme;
window.showTab                 = showTab;
window.renderCatalogo          = renderCatalogo;
window.cargarMas               = cargarMas;
window.openViewModal           = openViewModal;
window.closeViewModal          = closeViewModal;
window.openProdModal           = openProdModal;
window.closeProdModal          = closeProdModal;
window.saveProd                = saveProd;
window.actualizarBadgeStock    = actualizarBadgeStock;
window.confirmarEliminar       = confirmarEliminar;
window.openPurchaseModal       = openPurchaseModal;
window.closePurchaseModal      = closePurchaseModal;
window.savePurchase            = savePurchase;
window.confirmarEliminarCompra = confirmarEliminarCompra;
window.runScript                = runScript;
window.saveConfig               = saveConfig;
window.cambiarPassword          = cambiarPassword;
window.doLogout                 = doLogout;

init();
