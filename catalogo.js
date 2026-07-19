/* ================================================================
   catalogo.js — Backend propio del panel de catálogo
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
let productosVisibles   = 50;
let editingProdId       = null;

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

async function eliminarProductoDB(id) {
  if (!isAdmin()) { console.warn('Acceso denegado'); return; }

  const { error } = await sb.from('productos').delete().eq('id', id);
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
    <article class="prod-card" style="animation-delay:${i * 30}ms;cursor:pointer" onclick="verProducto('${p.id}')">
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
          ${p.destacado && isAdmin() ? `<span class="badge" style="background:var(--blue-bg,#e8f0fe);color:var(--blue,#1a73e8)">★ Destacado</span>` : ''}
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
   IR AL DETALLE DE PRODUCTO (página aparte)
   ================================================================ */
function verProducto(id) {
  location.href = 'producto.html?id=' + encodeURIComponent(id);
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
    destacado:      document.getElementById('p-destacado')?.checked || false,
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
  document.getElementById('app').style.display = 'block';

  initTheme();
  applyRole();

  await new Promise(r => requestAnimationFrame(r));

  // filtro de stock por defecto para invitados que vienen de "Ver como invitado"
  if (isGuest() && new URLSearchParams(location.search).get('stock') === 'in') {
    const filtroStock = document.getElementById('filtro-stock');
    if (filtroStock) filtroStock.value = 'in stock';
  }

  await cargarProductos();
  iniciarRealtime();

  // volver desde producto.html con "Editar" abre el modal directamente
  const editId = new URLSearchParams(location.search).get('edit');
  if (editId && isAdmin()) {
    openProdModal(editId);
    history.replaceState(null, '', 'catalogo.html');
  }
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
