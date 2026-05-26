/* ================================================================
   AUTH — Supabase Auth + modo invitado
   ================================================================ */

// ── RATE LIMITING — máx 5 intentos fallidos, bloqueo 5 min ──
const RATE = {
  MAX_INTENTOS:  5,
  BLOQUEO_MS:    5 * 60 * 1000,
  KEY_INTENTOS:  'solemio-login-intentos',
  KEY_BLOQUEADO: 'solemio-login-bloqueado',
};

function loginBloqueado() {
  const hasta = parseInt(localStorage.getItem(RATE.KEY_BLOQUEADO) || '0');
  if (Date.now() < hasta) return Math.ceil((hasta - Date.now()) / 60000);
  return 0;
}

function registrarIntentoFallido() {
  const intentos = parseInt(localStorage.getItem(RATE.KEY_INTENTOS) || '0') + 1;
  localStorage.setItem(RATE.KEY_INTENTOS, intentos);
  if (intentos >= RATE.MAX_INTENTOS) {
    localStorage.setItem(RATE.KEY_BLOQUEADO, Date.now() + RATE.BLOQUEO_MS);
    localStorage.removeItem(RATE.KEY_INTENTOS);
    return -1;
  }
  return RATE.MAX_INTENTOS - intentos;
}

function resetearIntentos() {
  localStorage.removeItem(RATE.KEY_INTENTOS);
  localStorage.removeItem(RATE.KEY_BLOQUEADO);
}

// Contraseña del modo invitado (no admin — solo lectura)
const GUEST_PASS = 'solemio';   // <-- cambiala si querés

let currentRole = null;   // 'admin' | 'guest' | null

function isAdmin() { return currentRole === 'admin'; }
function isGuest() { return currentRole === 'guest'; }

function isLoggedIn() {
  // Admin: verificar sesión activa de Supabase
  // (sb.auth.getSession() es sync en memoria si ya se cargó)
  if (currentRole) return true;
  // El rol se restaura en init() via sb.auth.onAuthStateChange
  return false;
}

async function doLogin() {
  const errEl = document.getElementById('login-error');
  const btnEl = document.querySelector('.login-btn');

  const minsBloqueado = loginBloqueado();
  if (minsBloqueado > 0) {
    errEl.textContent = `Demasiados intentos. Esperá ${minsBloqueado} min.`;
    return;
  }

  // El campo "usuario" ahora acepta email o la palabra "invitado"
  const user = document.getElementById('login-user').value.trim().slice(0, 128);
  const pass = document.getElementById('login-pass').value.slice(0, 128);

  if (!user || !pass) { errEl.textContent = 'Completá usuario y contraseña'; return; }

  errEl.textContent = '';
  btnEl.disabled    = true;
  btnEl.textContent = 'Verificando…';

  // ── Modo invitado ──────────────────────────────────────────
  if (user.toLowerCase() === 'invitado' && pass === GUEST_PASS) {
    resetearIntentos();
    currentRole = 'guest';
    await startApp();
    btnEl.disabled    = false;
    btnEl.textContent = 'Ingresar';
    return;
  }

  // ── Admin: Supabase Auth ───────────────────────────────────
  const { error } = await sb.auth.signInWithPassword({ email: user, password: pass });

  if (error) {
    const restantes = registrarIntentoFallido();
    if (restantes === -1) {
      errEl.textContent = 'Demasiados intentos. Cuenta bloqueada 5 minutos.';
    } else {
      errEl.textContent = `Usuario o contraseña incorrectos (${restantes} intento${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''})`;
    }
    errEl.style.animation = 'none';
    errEl.offsetHeight;
    errEl.style.animation = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
    btnEl.disabled    = false;
    btnEl.textContent = 'Ingresar';
    return;
  }

  // Supabase Auth exitoso → onAuthStateChange se encarga del resto
  resetearIntentos();
  // startApp() lo llama onAuthStateChange con event 'SIGNED_IN'
}

async function doGuestLogin() {
  currentRole = 'guest';
  await startApp();
}

async function doLogout() {
  detenerRealtime();
  if (currentRole === 'admin') {
    await sb.auth.signOut();
  }
  currentRole = null;
  mostrarPantallaLogin();
  document.getElementById('login-user').value        = '';
  document.getElementById('login-pass').value        = '';
  document.getElementById('login-error').textContent = '';
}

function mostrarPantallaApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display          = 'block';
}
function mostrarPantallaLogin() {
  document.getElementById('app').style.display          = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}


/* ================================================================
   SUPABASE — cliente
   ================================================================ */

// ── Reemplazá SUPABASE_ANON_KEY con la nueva clave que generaste ──
const SUPABASE_URL      = 'https://pktwpktmxbfapwjsugrx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Z2czITrIU3Y32ZLEjno9uw_oS2gGe6f';  // 

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


/* ================================================================
   REALTIME — reemplaza el polling de SHA de GitHub
   ================================================================ */

let _realtimeCanalProductos = null;
let _realtimeCanalCompras   = null;

function iniciarRealtime() {
  detenerRealtime();

  _realtimeCanalProductos = sb
    .channel('productos-cambios')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'productos' },
      () => {
        console.log('🔄 Productos cambiaron en Supabase — recargando...');
        cargarProductos();
      }
    )
    .subscribe();

  _realtimeCanalCompras = sb
    .channel('compras-cambios')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'compras' },
      () => {
        console.log('🔄 Compras cambiaron en Supabase — recargando...');
        cargarCompras();
      }
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
  } else if (isLoggedIn()) {
    iniciarRealtime();
    cargarProductos();
    cargarCompras();
  }
});


/* ================================================================
   CONFIG — solo para disparar el workflow de GitHub Actions
   ================================================================ */

const CONFIG = {
  SCRIPT_REPO: 'Ju4nse/actualizar_catalogo',
};

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
   STATE
   ================================================================ */

let productos = [];
let compras   = [];


/* ================================================================
   ÍCONOS SVG
   ================================================================ */

const ICON = {
  sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1"  x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>`,
  moon: `<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12"/></svg>`,
  shoe: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
  cartEmpty: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
};


/* ================================================================
   TEMA / TABS
   ================================================================ */

function toggleTheme() {
  const html   = document.documentElement;
  const isDark = html.dataset.theme === 'dark';
  html.dataset.theme = isDark ? 'light' : 'dark';
  document.getElementById('theme-btn').innerHTML = isDark ? ICON.moon : ICON.sun;
  localStorage.setItem('solemio-theme', html.dataset.theme);
}

function initTheme() {
  const saved = localStorage.getItem('solemio-theme') || 'light';
  document.documentElement.dataset.theme = saved;
  document.getElementById('theme-btn').innerHTML = saved === 'dark' ? ICON.sun : ICON.moon;
}

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

  // Mostrar cache mientras carga
  const local = localStorage.getItem('solemio-productos');
  if (local) {
    try { productos = JSON.parse(local); renderCatalogo(); } catch (_) {}
  }

  // Paginación para superar el límite de 1000 filas de Supabase
  const PAGINA = 1000;
  let todos = [];
  let desde = 0;

  while (true) {
    const { data, error } = await sb
      .from('productos')
      .select('*')
      .order('marca')
      .range(desde, desde + PAGINA - 1);

    if (error) {
      console.warn('Error cargando productos desde Supabase:', error.message);
      break;
    }

    todos = todos.concat(data);
    if (data.length < PAGINA) break;  // última página
    desde += PAGINA;
  }

  productos = todos.map(p => ({
    ...p,
    imagen: resolverImagen(p),
  }));

  localStorage.setItem('solemio-productos', JSON.stringify(productos));
  renderCatalogo();
  console.log(`✓ ${productos.length} productos cargados desde Supabase`);
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
    console.warn('Error cargando compras desde Supabase:', error.message);
    return;
  }

  compras = data;
  localStorage.setItem('solemio-compras', JSON.stringify(compras));
  console.log(`✓ ${compras.length} compras cargadas desde Supabase`);

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
  console.log('✓ Producto guardado en Supabase');
}

async function eliminarProductoDB(id) {
  if (!isAdmin()) { console.warn('Acceso denegado'); return; }

  const { error } = await sb.from('productos').delete().eq('id', id);

  if (error) { console.warn('Error eliminando producto:', error.message); return; }

  productos = productos.filter(p => p.id !== id);
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
  console.log('✓ Producto eliminado de Supabase');
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
  console.log('✓ Compra guardada en Supabase');
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

function renderCatalogo() {
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
    if (q && !q_ok)                              return false;
    if (marca && p.marca !== marca)              return false;
    if (stock === 'in stock'     && !p.stock)   return false;
    if (stock === 'out of stock' &&  p.stock)   return false;
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

  grid.innerHTML = lista.map((p, i) => {
    const img     = p.imagen;
    const enStock = p.stock === true || p.stock === 'in stock';
    const cantidad = p.num_stock ?? null;

    return `
    <article class="prod-card" style="animation-delay:${i * 30}ms">
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
          <span class="badge ${enStock ? 'stock' : 'nostock'}">
            ${enStock
              ? (cantidad != null ? `En stock (${cantidad})` : 'En stock')
              : 'Sin stock'}
          </span>
          ${p.marca ? `<span class="badge marca">${p.marca}</span>` : ''}
          ${p.oculto && !isGuest() ? `<span class="badge" style="background:var(--red-bg);color:var(--red)">Oculto</span>` : ''}
          ${p.imagen_custom && !isGuest() ? `<span class="badge" style="background:var(--blue-bg,#e8f0fe);color:var(--blue,#1a73e8)">Foto custom</span>` : ''}
        </div>
        ${!isGuest() ? `
        <div class="prod-actions">
          <button class="btn sm ghost" onclick="openProdModal('${p.id}')">
            ${ICON.edit} Editar
          </button>
          <button class="btn sm danger" onclick="confirmarEliminar('${p.id}')">
            ${ICON.trash}
          </button>
        </div>` : ''}
      </div>
    </article>`;
  }).join('');
}


/* ================================================================
   MODAL PRODUCTO
   ================================================================ */

let editingProdId = null;

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
              — si la cargás acá reemplaza la foto del scraper en el catálogo
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
              — la trae el script automáticamente, no hace falta tocarla
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
  const seleccionados = [];
  window._sel = seleccionados;
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
            oninput="renderProdSel()" style="margin-bottom:.5rem">
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
    await persistirProducto({
      ...prod,
      num_stock: nuevo_num_stock,
      stock:     nuevo_num_stock > 0,
    });
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
    el.innerHTML = `<div class="empty">${ICON.cartEmpty} No hay compras registradas todavía</div>`;
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
   GITHUB ACTIONS — solo para disparar el workflow del scraper
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

function togglePass() {
  const input = document.getElementById('login-pass');
  input.type  = input.type === 'password' ? 'text' : 'password';
}

async function cambiarPassword() {
  if (!isAdmin()) return;

  const nueva   = document.getElementById('cp-nueva').value;
  const repetir = document.getElementById('cp-repetir').value;
  const msgEl   = document.getElementById('cp-msg');

  msgEl.style.color = 'var(--red)';
  if (!nueva || !repetir)  { msgEl.textContent = 'Completá los campos'; return; }
  if (nueva.length < 8)    { msgEl.textContent = 'Mínimo 8 caracteres'; return; }
  if (nueva !== repetir)   { msgEl.textContent = 'Las contraseñas no coinciden'; return; }

  const { error } = await sb.auth.updateUser({ password: nueva });

  if (error) {
    msgEl.textContent = `Error: ${error.message}`;
    return;
  }

  msgEl.style.color = 'var(--green)';
  msgEl.textContent  = '✓ Contraseña actualizada correctamente';
  document.getElementById('cp-nueva').value   = '';
  document.getElementById('cp-repetir').value = '';
}


/* ================================================================
   INIT
   ================================================================ */

async function startApp() {
  loadConfig();
  applyRole();
  mostrarPantallaApp();

  await new Promise(r => requestAnimationFrame(r));

  await cargarProductos();
  await cargarCompras();
  iniciarRealtime();
}

async function init() {
  initTheme();

  // Escuchar cambios de sesión de Supabase Auth
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      // Verificar que el email está en la tabla admins
      const { data } = await sb
        .from('admins')
        .select('email')
        .eq('email', session.user.email)
        .maybeSingle();

      if (data) {
        currentRole = 'admin';
        if (document.getElementById('login-screen').style.display !== 'none') {
          await startApp();
        }
      } else {
        // Email autenticado pero no es admin — cerrar sesión
        await sb.auth.signOut();
        currentRole = null;
        const errEl = document.getElementById('login-error');
        if (errEl) errEl.textContent = 'Este usuario no tiene permisos de administrador.';
      }
    } else if (event === 'SIGNED_OUT') {
      if (currentRole === 'admin') {
        currentRole = null;
        mostrarPantallaLogin();
      }
    }
  });

  // Verificar si ya hay sesión activa (recarga de página)
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    // onAuthStateChange ya se disparó con SIGNED_IN — no hacer nada más
    return;
  }

  // Sin sesión de Supabase — mostrar login
  mostrarPantallaLogin();
}

// ── Exponer funciones globales para los onclick del HTML ──────
window.doLogin                 = doLogin;
window.doGuestLogin            = doGuestLogin;
window.doLogout                = doLogout;
window.toggleTheme             = toggleTheme;
window.togglePass              = togglePass;
window.showTab                 = showTab;
window.renderCatalogo          = renderCatalogo;
window.openProdModal           = openProdModal;
window.closeProdModal          = closeProdModal;
window.saveProd                = saveProd;
window.actualizarBadgeStock    = actualizarBadgeStock;
window.confirmarEliminar       = confirmarEliminar;
window.openPurchaseModal       = openPurchaseModal;
window.closePurchaseModal      = closePurchaseModal;
window.savePurchase            = savePurchase;
window.confirmarEliminarCompra = confirmarEliminarCompra;
window.runScript               = runScript;
window.saveConfig              = saveConfig;
window.cambiarPassword         = cambiarPassword;

init();
