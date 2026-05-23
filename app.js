
/* ================================================================
   AUTH — Login con SHA-256
   ================================================================

   CÓMO CAMBIAR LA CONTRASEÑA HARDCODEADA:
   1. Abrí la consola del navegador (F12)
   2. Pegá: await hashStr("tu_nueva_contraseña")
   3. Copiá el resultado y reemplazá PASS_HASH abajo.

   Usuario por defecto : admin
   Contraseña por defecto: solemio2024

   ================================================================ */

const AUTH = {
  USER:      'admin',
  // SHA-256 de "solemio2024"
  PASS_HASH: '6eba795eea2b6fe29165de3c2d376ab8b7f526485f47df2e7a26466d0f61a61f',
  SESSION_KEY: 'solemio-session',
  SESSION_TTL: 8 * 60 * 60 * 1000, // 8 horas en ms
};

async function hashStr(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isLoggedIn() {
  try {
    const raw = sessionStorage.getItem(AUTH.SESSION_KEY);
    if (!raw) return false;
    const { expires } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(AUTH.SESSION_KEY); return false; }
    return true;
  } catch { return false; }
}

function setSession() {
  sessionStorage.setItem(AUTH.SESSION_KEY, JSON.stringify({
    expires: Date.now() + AUTH.SESSION_TTL,
  }));
}

async function doLogin() {
  const user    = document.getElementById('login-user').value.trim();
  const pass    = document.getElementById('login-pass').value;
  const errEl   = document.getElementById('login-error');
  const btnEl   = document.querySelector('.login-btn');

  errEl.textContent = '';
  btnEl.disabled    = true;
  btnEl.textContent = 'Verificando…';

  // pequeña pausa para evitar timing attacks
  await new Promise(r => setTimeout(r, 350));

  const hash = await hashStr(pass);

  // Verificar contra hash guardado en localStorage (si el usuario lo cambió)
  const savedHash = localStorage.getItem('solemio-pass-hash') || AUTH.PASS_HASH;
  const savedUser = localStorage.getItem('solemio-user')      || AUTH.USER;

  if (user === savedUser && hash === savedHash) {
    setSession();
    showApp();
  } else {
    errEl.textContent  = 'Usuario o contraseña incorrectos';
    // reset de animación
    errEl.style.animation = 'none';
    errEl.offsetHeight;
    errEl.style.animation = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
  }

  btnEl.disabled    = false;
  btnEl.textContent = 'Ingresar';
}

function doLogout() {
  sessionStorage.removeItem(AUTH.SESSION_KEY);
  document.getElementById('app').style.display          = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').textContent = '';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display          = 'block';
}

function togglePass() {
  const input = document.getElementById('login-pass');
  input.type  = input.type === 'password' ? 'text' : 'password';
}

async function cambiarPassword() {
  const actual   = document.getElementById('cp-actual').value;
  const nueva    = document.getElementById('cp-nueva').value;
  const repetir  = document.getElementById('cp-repetir').value;
  const msgEl    = document.getElementById('cp-msg');

  msgEl.style.color = 'var(--red)';

  if (!actual || !nueva || !repetir) { msgEl.textContent = 'Completá todos los campos'; return; }
  if (nueva.length < 8)              { msgEl.textContent = 'La nueva contraseña debe tener al menos 8 caracteres'; return; }
  if (nueva !== repetir)             { msgEl.textContent = 'Las contraseñas nuevas no coinciden'; return; }

  const hashActual  = await hashStr(actual);
  const savedHash   = localStorage.getItem('solemio-pass-hash') || AUTH.PASS_HASH;

  if (hashActual !== savedHash) { msgEl.textContent = 'La contraseña actual es incorrecta'; return; }

  const hashNueva = await hashStr(nueva);
  localStorage.setItem('solemio-pass-hash', hashNueva);

  msgEl.style.color = 'var(--green)';
  msgEl.textContent = '✓ Contraseña actualizada correctamente';

  document.getElementById('cp-actual').value  = '';
  document.getElementById('cp-nueva').value   = '';
  document.getElementById('cp-repetir').value = '';
}

/* ================================================================
   app.js — SoleMio Panel
   ================================================================ */

// ── FIREBASE CONFIG ───────────────────────────────────────────
const FB_CONFIG = {
  apiKey:            "AIzaSyD5UWe2m7-Ue9Ty4qCrs0BnAgIqYmhJOC4",
  authDomain:        "solemio-panel.firebaseapp.com",
  projectId:         "solemio-panel",
  storageBucket:     "solemio-panel.firebasestorage.app",
  messagingSenderId: "223180443701",
  appId:             "1:223180443701:web:1cef7d7c0c32833577617c",
};

// ── STATE ─────────────────────────────────────────────────────
let productos = [];
let compras   = [];
let db        = null;

// ── ÍCONOS SVG ────────────────────────────────────────────────
const ICON = {
  sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1"  x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1"  y1="12" x2="3"  y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36"/>
    <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
  </svg>`,

  moon: `<svg viewBox="0 0 24 24">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>`,

  edit: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>`,

  trash: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>`,

  check: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`,

  shoe: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>`,

  cart: `<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>`,

  cartEmpty: `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>`,
};

// ── TEMA ──────────────────────────────────────────────────────
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

// ── TABS ──────────────────────────────────────────────────────
function showTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'compras') renderCompras();
}

// ── HELPERS ───────────────────────────────────────────────────
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

// ── FIREBASE INIT ─────────────────────────────────────────────
async function initFirebase() {
  if (FB_CONFIG.apiKey === 'TU_API_KEY') return false;
  try {
    const { initializeApp } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getFirestore, collection, getDocs, setDoc, deleteDoc, doc } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    const app = initializeApp(FB_CONFIG);
    db = getFirestore(app);
    window._fb = { collection, getDocs, setDoc, deleteDoc, doc };
    return true;
  } catch (e) {
    console.warn('Firebase no disponible, usando localStorage.', e);
    return false;
  }
}

// ── CARGAR PRODUCTOS CON BUFFER Y MAPEO CORRECTO ──────────────
async function cargarProductos() {
  // 1. BUFFER LOCAL: Carga instantánea
  const local = localStorage.getItem('solemio-productos');
  if (local) {
    productos = JSON.parse(local);
    renderCatalogo(); 
  } else {
    productos = demoProductos(); 
    renderCatalogo();
  }

  // 2. ASINCRÓNICO: Trae la data de Firebase de fondo y normaliza las claves
  if (db) {
    try {
      const snap = await window._fb.getDocs(window._fb.collection(db, 'productos'));
      
      if (!snap.empty) {
        productos = snap.docs.map(d => {
          const data = d.data();
          
          // Mapeamos lo que viene de Firestore (priorizando tus nombres reales de la BD)
          return {
            id:          d.id, // ← Guardamos el ID del documento de Firebase de forma estricta
            nombre:      data.title        || data.nombre || data.name || '',
            marca:       data.brand        || data.marca  || '',
            precio:      parseFloat(data.price || data.precio || 0),
            color:       data.color        || '',
            talles:      data.talles       || data.sizes  || '',
            stock:       data.availability || data.stock  || 'out of stock',
            imagen:      data.image_link   || data.imagen || data.image || '',
            descripcion: data.description  || data.descripcion || ''
          };
        });

        // Guardamos los datos limpios en el buffer de LocalStorage
        localStorage.setItem('solemio-productos', JSON.stringify(productos));
        
        // Volvemos a renderizar la pantalla con lo último de la nube
        renderCatalogo();
        console.log("✓ Buffer actualizado y normalizado.");
      }
    } catch (e) {
      console.warn("No se pudo sincronizar con Firebase, usando buffer local:", e);
    }
  }
}

async function persistirProducto(p) {
  // Cuando creás o editás un producto desde el modal, lo guardamos estructurado a Firebase
  if (db) {
    try {
      const firestoreData = {
        title:        p.nombre,
        brand:        p.marca,
        price:        p.precio,
        color:        p.color,
        talles:       p.talles,
        availability: p.stock,
        image_link:   p.imagen,
        description:  p.descripcion,
        id:           p.id,
        updated_at:   new Date().toISOString()
      };
      await window._fb.setDoc(window._fb.doc(db, 'productos', p.id), firestoreData);
    } catch(e) {
      console.error("Error guardando en Firebase:", e);
    }
  }
  
  // También actualizamos el buffer local inmediatamente para que el cambio se vea en el acto
  const idx = productos.findIndex(x => x.id === p.id);
  if (idx >= 0) productos[idx] = p; else productos.unshift(p);
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
}

async function cargarCompras() {
  if (db) {
    try {
      const snap = await window._fb.getDocs(window._fb.collection(db, 'compras'));
      compras = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.fecha > a.fecha ? 1 : -1));
      return;
    } catch (e) { /* cae a localStorage */ }
  }
  const local = localStorage.getItem('solemio-compras');
  compras = local ? JSON.parse(local) : [];
}

async function eliminarProductoDB(id) {
  if (db) await window._fb.deleteDoc(window._fb.doc(db, 'productos', id));
  productos = productos.filter(p => p.id !== id);
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
}

async function persistirCompra(c) {
  if (db) await window._fb.setDoc(window._fb.doc(db, 'compras', c.id), c);
  compras.unshift(c);
  localStorage.setItem('solemio-compras', JSON.stringify(compras));
}

async function eliminarCompraDB(id) {
  if (db) await window._fb.deleteDoc(window._fb.doc(db, 'compras', id));
  compras = compras.filter(c => c.id !== id);
  localStorage.setItem('solemio-compras', JSON.stringify(compras));
}

// ── DEMO DATA ─────────────────────────────────────────────────
function demoProductos() {
  return [
    { id: 'p1', nombre: 'Zapatilla urbana',  marca: 'Nike',          precio: 45000, color: 'Blanco', talles: '36–42', imagen: '', stock: 'in stock',    descripcion: 'Modelo clásico urbano' },
    { id: 'p2', nombre: 'Sandalia verano',   marca: 'Topper',        precio: 28000, color: 'Beige',  talles: '35–40', imagen: '', stock: 'in stock',    descripcion: 'Liviana y cómoda'      },
    { id: 'p3', nombre: 'Bota cuero',        marca: 'Ricky Sarkany', precio: 98000, color: 'Negro',  talles: '36–41', imagen: '', stock: 'out of stock', descripcion: 'Cuero genuino'         },
    { id: 'p4', nombre: 'Mocasín vestir',    marca: 'Guido',         precio: 62000, color: 'Marrón', talles: '38–44', imagen: '', stock: 'in stock',    descripcion: 'Formal y confortable'  },
    { id: 'p5', nombre: 'Ojotas goma',       marca: 'Havaianas',     precio: 15000, color: 'Azul',   talles: '35–44', imagen: '', stock: 'in stock',    descripcion: 'Para playa y verano'   },
    { id: 'p6', nombre: 'Zapatilla running', marca: 'Adidas',        precio: 78000, color: 'Gris',   talles: '36–45', imagen: '', stock: 'out of stock', descripcion: 'Alto rendimiento'     },
  ];
}

// ── RENDER CATÁLOGO (CON VISUALIZACIÓN DE ID Y BÚSQUEDA AMPLIADA) ──
function renderCatalogo() {
  const q     = (document.getElementById('buscar')?.value       || '').toLowerCase();
  const marca = document.getElementById('filtro-marca')?.value  || '';
  const stock = document.getElementById('filtro-stock')?.value  || '';

  // Actualizar opciones de marcas
  const marcas = [...new Set(productos.map(p => p.marca).filter(Boolean))].sort();
  const mSel   = document.getElementById('filtro-marca');
  const mCur   = mSel.value;
  if (mSel) {
    mSel.innerHTML =
      '<option value="">Todas las marcas</option>' +
      marcas.map(m => `<option value="${m}"${m === mCur ? ' selected' : ''}>${m}</option>`).join('');
  }

  // FILTRO INTELIGENTE: Permite buscar por Nombre, Marca o ID del producto
  const lista = productos.filter(p => {
    const coincidenciaTexto = 
      (p.nombre || '').toLowerCase().includes(q) || 
      (p.marca  || '').toLowerCase().includes(q) || 
      (p.id     || '').toLowerCase().includes(q); // ← Búsqueda por ID integrada

    if (q && !coincidenciaTexto) return false;
    if (marca && p.marca !== marca) return false;
    if (stock && p.stock !== stock) return false;
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

  grid.innerHTML = lista.map((p, i) => `
    <article class="prod-card" style="animation-delay:${i * 30}ms">
      ${p.imagen
        ? `<img class="prod-thumb" src="${p.imagen}" alt="${p.nombre}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="prod-thumb-ph" style="${p.imagen ? 'display:none' : ''}">${ICON.shoe}</div>
      <div class="prod-body">
        <div style="font-size: 0.7rem; color: var(--text-3); font-family: monospace; margin-bottom: 0.2rem;">ID: ${p.id}</div>
        
        <div class="prod-name">${p.nombre}</div>
        <div class="prod-meta">${[p.color, p.talles].filter(Boolean).join(' · ')}</div>
        <div class="prod-price">${fmtARS(p.precio)}</div>
        <div class="prod-badges">
          <span class="badge ${p.stock === 'in stock' ? 'stock' : 'nostock'}">
            ${p.stock === 'in stock' ? 'En stock' : 'Sin stock'}
          </span>
          ${p.marca ? `<span class="badge marca">${p.marca}</span>` : ''}
        </div>
        <div class="prod-actions">
          <button class="btn sm ghost" onclick="openProdModal('${p.id}')">
            ${ICON.edit} Editar
          </button>
          <button class="btn sm danger" onclick="confirmarEliminar('${p.id}')">
            ${ICON.trash}
          </button>
        </div>
      </div>
    </article>`).join('');
}
// ── MODAL PRODUCTO ─────────────────────────────────────────────
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
        <div class="field">
          <label>Stock</label>
          <select id="p-stock">
            <option value="in stock"    ${p?.stock === 'in stock'    ? 'selected' : ''}>En stock</option>
            <option value="out of stock"${p?.stock === 'out of stock' ? 'selected' : ''}>Sin stock</option>
          </select>
        </div>
        <div class="field">
          <label>URL de imagen</label>
          <input id="p-imagen" type="url" placeholder="https://…" value="${p?.imagen || ''}">
        </div>
        <div class="field">
          <label>Descripción</label>
          <textarea id="p-desc">${p?.descripcion || ''}</textarea>
        </div>

        <div class="modal-footer">
          <button class="btn ghost" onclick="closeProdModal()">Cancelar</button>
          <button class="btn primary" onclick="saveProd()">${ICON.check} Guardar</button>
        </div>
      </div>
    </div>`;
}

function closeProdModal() {
  document.getElementById('modal-prod').innerHTML = '';
}

async function saveProd() {
  const nombre = document.getElementById('p-nombre').value.trim();
  if (!nombre) { alert('El nombre es obligatorio'); return; }

  const p = {
    id:          editingProdId || uid(),
    nombre,
    marca:       document.getElementById('p-marca').value.trim(),
    precio:      parseFloat(document.getElementById('p-precio').value) || 0,
    color:       document.getElementById('p-color').value.trim(),
    talles:      document.getElementById('p-talles').value.trim(),
    stock:       document.getElementById('p-stock').value,
    imagen:      document.getElementById('p-imagen').value.trim(),
    descripcion: document.getElementById('p-desc').value.trim(),
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

// ── MODAL COMPRA ───────────────────────────────────────────────
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

  // Funciones locales al modal
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
        <span style="color:var(--text-3);font-size:.78rem">${fmtARS(p.precio)}</span>
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
      mEl.value = Math.round(window._sel.reduce((a, s) => a + s.precio, 0)) || '';
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

  const c = {
    id:        uid(),
    fecha,
    monto,
    productos: [...(window._sel || [])],
    notas,
  };

  await persistirCompra(c);
  closePurchaseModal();
  renderCompras();
}

// ── RENDER COMPRAS ─────────────────────────────────────────────
function renderCompras() {
  const hoy  = new Date().toISOString().slice(0, 10);
  const mes  = new Date().toISOString().slice(0, 7);
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
    el.innerHTML = `
      <div class="empty">
        ${ICON.cartEmpty}
        No hay compras registradas todavía
      </div>`;
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

// ── GITHUB ACTIONS ─────────────────────────────────────────────
function saveConfig() {
  localStorage.setItem('gh-token',    document.getElementById('gh-token').value);
  localStorage.setItem('gh-repo',     document.getElementById('gh-repo').value);
  localStorage.setItem('gh-workflow', document.getElementById('gh-workflow').value);
}

function loadConfig() {
  const t = localStorage.getItem('gh-token');
  const r = localStorage.getItem('gh-repo');
  const w = localStorage.getItem('gh-workflow');
  if (t) document.getElementById('gh-token').value    = t;
  if (r) document.getElementById('gh-repo').value     = r;
  if (w) document.getElementById('gh-workflow').value = w;
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
      status.innerHTML = '<span style="color:var(--green)">✓ Workflow iniciado — tarda ~1–2 min</span>';
    } else {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || `HTTP ${res.status}`);
    }
  } catch (e) {
    status.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
  }

  btn.disabled = false;
}

// ── INIT ───────────────────────────────────────────────────────
async function init() {
  initTheme(); // aplicar tema antes de mostrar cualquier pantalla

  // Verificar sesión activa
  if (!isLoggedIn()) {
    document.getElementById("app").style.display = "none";
    document.getElementById("login-screen").style.display = "flex";
    return;
  }
  showApp();
  await initFirebase();
  await Promise.all([cargarProductos(), cargarCompras()]);
  renderCatalogo();
  loadConfig();
}

init();
