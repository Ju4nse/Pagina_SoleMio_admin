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
  // ── ADMIN ──────────────────────────────────────────────────
  USER:      'admin',
  // SHA-256 de "solemio2024"
  PASS_HASH: '6eba795eea2b6fe29165de3c2d376ab8b7f526485f47df2e7a26466d0f61a61f',

  // ── INVITADO ────────────────────────────────────────────────
  GUEST_USER: 'invitado',
  // SHA-256 de "solemio" (contraseña por defecto del modo invitado)
  GUEST_HASH: '6a82664a67178402c61b37d5fbe265c14cbbc0a33af48a3d7d3215624026b3e4',

  SESSION_KEY: 'solemio-session',
  SESSION_TTL: 8 * 60 * 60 * 1000, // 8 horas en ms
};

// Modo actual: 'admin' | 'guest' | null
let currentRole = null;

async function hashStr(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isLoggedIn() {
  try {
    const raw = sessionStorage.getItem(AUTH.SESSION_KEY);
    if (!raw) return false;
    const { expires, role } = JSON.parse(raw);
    if (Date.now() > expires) { sessionStorage.removeItem(AUTH.SESSION_KEY); return false; }
    currentRole = role || 'admin';
    return true;
  } catch { return false; }
}

function isAdmin() { return currentRole === 'admin'; }
function isGuest() { return currentRole === 'guest'; }

function setSession(role) {
  sessionStorage.setItem(AUTH.SESSION_KEY, JSON.stringify({
    expires: Date.now() + AUTH.SESSION_TTL,
    role,
  }));
  currentRole = role;
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

  // Verificar admin
  const savedHash = localStorage.getItem('solemio-pass-hash') || AUTH.PASS_HASH;
  const savedUser = localStorage.getItem('solemio-user')      || AUTH.USER;
  // Verificar invitado
  const guestHash = localStorage.getItem('solemio-guest-hash') || AUTH.GUEST_HASH;
  const guestUser = localStorage.getItem('solemio-guest-user') || AUTH.GUEST_USER;

  if (user === savedUser && hash === savedHash) {
    setSession('admin');
    await startApp();
  } else if (user === guestUser && hash === guestHash) {
    setSession('guest');
    await startApp();
  } else {
    errEl.textContent = 'Usuario o contraseña incorrectos';
    errEl.style.animation = 'none';
    errEl.offsetHeight;
    errEl.style.animation = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
  }

  btnEl.disabled    = false;
  btnEl.textContent = 'Ingresar';
}

async function doGuestLogin() {
  setSession('guest');
  await startApp();
}

function doLogout() {
  sessionStorage.removeItem(AUTH.SESSION_KEY);
  currentRole = null;
  // No limpiamos localStorage — conservamos el cache para que el próximo
  // login muestre datos inmediatamente. El rol correcto se aplica en startApp().
  mostrarPantallaLogin();
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
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

// Secuencia de arranque garantizada — siempre en este orden:
// 1. token  2. rol visual  3. datos  4. render
async function startApp() {
  loadConfig();
  applyRole();
  mostrarPantallaApp();

  await new Promise(r => requestAnimationFrame(r));

  await cargarProductos();
  await cargarCompras();
}

function applyRole() {
  const isG = isGuest();

  // Ocultar tabs que el invitado no puede ver
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const tab = btn.getAttribute('onclick')?.match(/showTab\('(\w+)'/)?.[1];
    if (isG && (tab === 'compras' || tab === 'sync')) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }
  });

  // Ocultar botones de edición/eliminación en el catálogo
  // (se aplica también cada vez que se renderiza el catálogo)
  document.getElementById('app').dataset.role = isG ? 'guest' : 'admin';

  // Badge de rol en topbar
  const badge = document.getElementById('role-badge');
  if (badge) {
    badge.textContent = isG ? 'Invitado' : 'Admin';
    badge.className   = 'role-badge ' + (isG ? 'guest' : 'admin');
  }

  // Si es invitado y está en una tab restringida, volver a catálogo
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

// ── CONFIG ────────────────────────────────────────────────────
const CONFIG = {
  // Repo del script Python (privado) — solo para escrituras con token
  SCRIPT_REPO:    'Ju4nse/actualizar_catalogo',
  // Repo de la página (público) — lectura sin token, accesible desde cualquier dispositivo
  PAGES_REPO:     'Ju4nse/Pagina_SoleMio_admin',
  PRODUCTOS_FILE: 'productos.json',
  COMPRAS_FILE:   'compras.json',
};

// ── STATE ─────────────────────────────────────────────────────
let productos = [];
let compras   = [];
let Token   = '';   // se carga desde localStorage al iniciar

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
  const saved = localStorage.getItem('solemio-theme') || 'lit';
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
  if (name === 'sync')    fillSyncInputs();
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

// ── GITHUB JSON — HELPERS ─────────────────────────────────────
async function ghReadJSON(repo, file) {
  const rawUrl =
    `https://raw.githubusercontent.com/${repo}/main/${file}?t=${Date.now()}`;

  try {
    // 1. Intentar RAW primero (más rápido)
    const rawRes = await fetch(rawUrl, {
      cache: 'no-store'
    });

    if (rawRes.ok) {
      const text = await rawRes.text();

      if (text.trim()) {
        return JSON.parse(text);
      }
    }

    throw new Error('Raw falló');

  } catch (err) {
    console.warn(
      `Raw falló (${err.message}), probando GitHub API...`
    );

    // 2. Metadata del archivo
    const apiRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${file}?t=${Date.now()}`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        },
        cache: 'no-store'
      }
    );

    if (!apiRes.ok) {
      throw new Error(
        `GitHub API falló (${apiRes.status})`
      );
    }

    const j = await apiRes.json();

    // Archivo chico → viene base64
    if (j.content && j.encoding === 'base64') {
      return JSON.parse(
        atob(j.content.replace(/\n/g, ''))
      );
    }

    // Archivo grande → usar download_url
    if (j.download_url) {
      console.log(
        'Archivo grande, usando download_url'
      );

      const res = await fetch(
        `${j.download_url}?t=${Date.now()}`,
        {
          cache: 'no-store'
        }
      );

      if (!res.ok) {
        throw new Error(
          `download_url falló (${res.status})`
        );
      }

      return await res.json();
    }

    throw new Error(
      `GitHub API no devolvió contenido para ${file}`
    );
  }
}
// Escribe/actualiza un archivo en GitHub via API (requiere token)
async function ghWriteJSON(repo, file, data, mensaje) {
  if (!ghToken) {
    throw new Error('No hay token de GitHub configurado');
  }

  const apiUrl =
    `https://api.github.com/repos/${repo}/contents/${file}`;

  const headers = {
    'Authorization': `token ${ghToken}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  async function save(retry = false) {
    const r = await fetch(apiUrl, { headers });

    if (!r.ok) {
      throw new Error(
        `No se pudo obtener SHA (${r.status})`
      );
    }

    const j = await r.json();

    const body = {
      message:
        mensaje || `Actualizar ${file}`,
      content: btoa(
        unescape(
          encodeURIComponent(
            JSON.stringify(data)
          )
        )
      ),
      sha: j.sha
    };

    const res = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });

    if (res.status === 409 && !retry) {
      console.warn(
        '409 conflicto — reintentando...'
      );

      await new Promise(r => setTimeout(r, 1000));

      return save(true);
    }

    if (!res.ok) {
      const err =
        await res.json().catch(() => ({}));

      throw new Error(
        err.message ||
        `Error al escribir ${file} (${res.status})`
      );
    }

    return res.json();
  }

  return save();
}
// ── WRITE LOCK ────────────────────────────────────────────────
// Cuando se hace una escritura (eliminar/guardar), se bloquea el
// fetch remoto por 60s para que GitHub tenga tiempo de procesar
// el commit antes de que una recarga pise los cambios locales.
const WRITE_LOCK_TTL = 10 * 1000; // 60 segundos

function setWriteLock(key) {
  localStorage.setItem(`solemio-wlock-${key}`, Date.now().toString());
}

function hasWriteLock(key) {
  const t = localStorage.getItem(`solemio-wlock-${key}`);
  if (!t) return false;
  if (Date.now() - parseInt(t) > WRITE_LOCK_TTL) {
    localStorage.removeItem(`solemio-wlock-${key}`);
    return false;
  }
  return true;
}

// ── CARGAR DATOS ───────────────────────────────────────────────
async function cargarProductos() {
  // Spinner
  const grid = document.getElementById('catalogo-grid');

  if (grid) {
    grid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <svg viewBox="0 0 24 24" fill="none"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        Cargando catálogo…
      </div>`;
  }

  // ─────────────────────────────────────────────
  // 1. Si acabamos de escribir → usar local
  // ─────────────────────────────────────────────
  if (hasWriteLock('productos')) {
    const local =
      localStorage.getItem('solemio-productos');

    if (local) {
      productos = JSON.parse(local);
      renderCatalogo();

      console.log(
        '⏳ Write lock activo — usando buffer local'
      );
      return;
    }
  }

  // ─────────────────────────────────────────────
  // 2. Mostrar cache rápido mientras carga GitHub
  // ─────────────────────────────────────────────
  const local =
    localStorage.getItem('solemio-productos');

  if (local) {
    try {
      productos = JSON.parse(local);
      renderCatalogo();
    } catch (_) {}
  }

  // ─────────────────────────────────────────────
  // 3. Leer GitHub (fuente de verdad)
  // ─────────────────────────────────────────────
  try {
    const data = await ghReadJSON(
      CONFIG.SCRIPT_REPO,
      CONFIG.PRODUCTOS_FILE
    );

    const raw = (
      Array.isArray(data)
        ? data
        : (data.productos || [])
    ).map(p => ({
      id:
        (p.id || p.codigo || uid())
          .toString()
          .replace(/^p_/, ''),

      nombre:
        p.nombre ||
        p.title ||
        p.name ||
        '',

      marca:
        p.marca ||
        p.brand ||
        '',

      precio: parseFloat(
        p.precio ||
        p.price ||
        0
      ),

      color:
        p.color ||
        '',

      talles:
        p.talles ||
        p.sizes ||
        '',

      stock:
        p.stock ||
        p.availability ||
        'out of stock',

      cantidad:
        p.cantidad != null
          ? p.cantidad
          : null,

      imagen:
        p.imagen ||
        p.image_link ||
        p.image ||
        '',

      descripcion:
        p.descripcion ||
        p.description ||
        '',

      oculto:
        p.oculto === true ||
        p.oculto === 'true',
    }));

    // ─────────────────────────────────────────────
    // 4. Deduplicar IDs (p_xxx vs xxx)
    // ─────────────────────────────────────────────
    const seen = new Map();

    for (const p of raw) {
      const existing = seen.get(p.id);

      if (!existing) {
        seen.set(p.id, p);
        continue;
      }

      // quedarse con el más completo
      const score = x =>
        (x.precio > 0 ? 2 : 0) +
        (x.imagen ? 1 : 0) +
        (x.descripcion ? 1 : 0);

      if (score(p) > score(existing)) {
        seen.set(p.id, p);
      }
    }

    productos =
      Array.from(seen.values());

    // Guardar cache local
    localStorage.setItem(
      'solemio-productos',
      JSON.stringify(productos)
    );

    renderCatalogo();

    const muestra = productos
      .slice(0, 3)
      .map(
        p =>
          `${p.nombre}: precio=${p.precio}`
      )
      .join(' | ');

    console.log(
      `✓ ${productos.length} productos cargados desde GitHub — muestra: ${muestra}`
    );

  } catch (e) {
    console.warn(
      'No se pudo leer productos.json, usando buffer local:',
      e.message
    );
  }
}

async function cargarCompras() {
  // 1. Buffer local
  const local = localStorage.getItem('solemio-compras');
  if (local) compras = JSON.parse(local);

  // 2. Si hay un write lock activo, no pisamos con el remoto
  if (hasWriteLock('compras')) {
    console.log('⏳ Write lock activo — usando buffer local para compras');
    return;
  }

  // 3. Leer compras.json del repo de la página
  try {
    const data = await ghReadJSON(CONFIG.PAGES_REPO, CONFIG.COMPRAS_FILE);
    compras = (Array.isArray(data) ? data : (data.compras || []))
      .sort((a, b) => (b.fecha > a.fecha ? 1 : -1));
    localStorage.setItem('solemio-compras', JSON.stringify(compras));
    console.log(`✓ ${compras.length} compras cargadas desde GitHub`);
  } catch (e) {
    console.warn('No se pudo leer compras.json, usando buffer local:', e.message);
  }
}

// ── GUARDAR DATOS ──────────────────────────────────────────────
async function persistirProducto(p) {
  // Normalizar ID
  p.id = p.id.replace(/^p_/, '');

  // Buscar usando ID normalizado
  const idx = productos.findIndex(
    x => x.id.replace(/^p_/, '') === p.id
  );

  if (idx >= 0) {
    // Mantener datos existentes y pisar solo cambios
    productos[idx] = {
      ...productos[idx],
      ...p,
      id: p.id
    };
  } else {
    productos.unshift(p);
  }

  localStorage.setItem(
    'solemio-productos',
    JSON.stringify(productos)
  );

  setWriteLock('productos');

  try {
    await ghWriteJSON(
      CONFIG.SCRIPT_REPO,
      CONFIG.PRODUCTOS_FILE,
      productos,
      `Editar producto: ${p.nombre}`
    );

    console.log('✓ productos.json actualizado en GitHub');
  } catch (e) {
    console.warn(
      'No se pudo guardar en GitHub (se guardó localmente):',
      e.message
    );

    alert(
      `Cambio guardado localmente.\n` +
      `Para sincronizar con GitHub configurá el token.\n` +
      `(${e.message})`
    );
  }
}

async function eliminarProductoDB(id) {
  productos = productos.filter(p => p.id !== id);
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
  setWriteLock('productos');

  try {
    await ghWriteJSON(CONFIG.SCRIPT_REPO, CONFIG.PRODUCTOS_FILE, productos, `Eliminar producto ${id}`);
    console.log('✓ productos.json actualizado en GitHub');
  } catch (e) {
    console.warn('No se pudo eliminar en GitHub:', e.message);
  }
}

async function persistirCompra(c) {
  compras.unshift(c);
  localStorage.setItem('solemio-compras', JSON.stringify(compras));
  setWriteLock('compras');

  try {
    await ghWriteJSON(CONFIG.PAGES_REPO, CONFIG.COMPRAS_FILE, compras, `Nueva compra ${c.fecha}`);
    console.log('✓ compras.json actualizado en GitHub');
  } catch (e) {
    console.warn('No se pudo guardar compra en GitHub:', e.message);
    alert(`Compra guardada localmente.\nPara sincronizar configurá el token.\n(${e.message})`);
  }
}

async function eliminarCompraDB(id) {
  compras = compras.filter(c => c.id !== id);
  localStorage.setItem('solemio-compras', JSON.stringify(compras));
  setWriteLock('compras');

  try {
    await ghWriteJSON(CONFIG.PAGES_REPO, CONFIG.COMPRAS_FILE, compras, `Eliminar compra ${id}`);
  } catch (e) {
    console.warn('No se pudo eliminar compra en GitHub:', e.message);
  }
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

  // Mostrar/ocultar botón nuevo producto según rol
  const newBtn = document.querySelector('.toolbar .btn.primary');
  if (newBtn) newBtn.style.display = isGuest() ? 'none' : '';

  // Actualizar opciones de marcas
  const marcas = [...new Set(productos.map(p => p.marca).filter(Boolean))].sort();
  const mSel = document.getElementById('filtro-marca');
  const mCur = mSel?.value || '';
  if (mSel) {
    mSel.innerHTML =
      '<option value="">Todas las marcas</option>' +
      marcas.map(m => `<option value="${m}"${m === mCur ? ' selected' : ''}>${m}</option>`).join('');
  }

  // FILTRO INTELIGENTE: Permite buscar por Nombre, Marca o ID del producto
  const lista = productos.filter(p => {
    // Invitados no ven productos ocultos
    if (p.oculto && isGuest()) return false;

    const coincidenciaTexto =
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.marca  || '').toLowerCase().includes(q) ||
      (p.id     || '').toLowerCase().includes(q);

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
        <div class="prod-price">${fmtARS(Math.round(p.precio * 1.5))}</div>
        <div class="prod-badges">
          <span class="badge ${p.stock === 'in stock' ? 'stock' : 'nostock'}">
            ${p.stock === 'in stock'
              ? (p.cantidad != null ? `En stock (${p.cantidad})` : 'En stock')
              : 'Sin stock'}
          </span>
          ${p.marca ? `<span class="badge marca">${p.marca}</span>` : ''}
          ${p.oculto && !isGuest() ? `<span class="badge" style="background:var(--red-bg);color:var(--red)">Oculto</span>` : ''}
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
        <div class="field-row">
          <div class="field">
            <label>Cantidad en stock</label>
            <input id="p-cantidad" type="number" min="0" placeholder="0"
              value="${p?.cantidad ?? ''}"
              oninput="actualizarBadgeStock(this.value)">
          </div>
          <div class="field">
            <label>Estado</label>
            <div id="p-stock-badge" style="padding:.5rem .75rem;border:1px solid var(--border-md);border-radius:var(--radius);background:var(--bg);font-size:.85rem;display:flex;align-items:center;gap:.4rem">
              ${(p?.cantidad ?? 1) > 0
                ? `<span style="color:var(--green)">● En stock (${p?.cantidad ?? ''})</span>`
                : `<span style="color:var(--red)">● Sin stock</span>`
              }
            </div>
          </div>
        </div>
        <div class="field">
          <label>URL de imagen</label>
          <input id="p-imagen" type="url" placeholder="https://…" value="${p?.imagen || ''}">
        </div>
        <div class="field">
          <label>Descripción</label>
          <textarea id="p-desc">${p?.descripcion || ''}</textarea>
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
  const n = parseInt(val) || 0;
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

  const cantidad = parseInt(document.getElementById('p-cantidad').value) || 0;
  const p = {
    id: (editingProdId || uid()).replace(/^p_/, ''),
    nombre,
    marca:       document.getElementById('p-marca').value.trim(),
    precio:      parseFloat(document.getElementById('p-precio').value) || 0,
    color:       document.getElementById('p-color').value.trim(),
    talles:      document.getElementById('p-talles').value.trim(),
    cantidad,
    stock:       cantidad > 0 ? 'in stock' : 'out of stock',
    imagen:      document.getElementById('p-imagen').value.trim(),
    descripcion: document.getElementById('p-desc').value.trim(),
    oculto:      document.getElementById('p-oculto')?.checked || false,
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
        <span style="color:var(--text-3);font-size:.78rem;display:flex;gap:.4rem;align-items:center">
          ${p.cantidad != null ? `<span style="font-size:.7rem">(${p.cantidad} disp.)</span>` : ''}
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

  const c = {
    id:        uid(),
    fecha,
    monto,
    productos: sel,
    notas,
  };

  // ── Descontar stock de cada producto vendido ────────────────
  let productosModificados = false;
  for (const item of sel) {
    const prod = productos.find(p => p.id === item.id);
    if (!prod) continue;
    const nuevaCantidad = Math.max(0, (prod.cantidad || 0) - (item.cantidad || 1));
    prod.cantidad = nuevaCantidad;
    prod.stock    = nuevaCantidad > 0 ? 'in stock' : 'out of stock';
    productosModificados = true;
  }

  // Guardar productos actualizados si hubo cambios de stock
  if (productosModificados) {
    localStorage.setItem('solemio-productos', JSON.stringify(productos));
    setWriteLock('productos');
    try {
      await ghWriteJSON(CONFIG.SCRIPT_REPO, CONFIG.PRODUCTOS_FILE, productos, `Stock actualizado por compra ${fecha}`);
    } catch (e) {
      console.warn('No se pudo actualizar stock en GitHub:', e.message);
    }
  }

  await persistirCompra(c);
  closePurchaseModal();
  renderCompras();
  renderCatalogo(); // actualizar badges de stock en el catálogo
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
  ghToken = document.getElementById('gh-token').value.trim();
  localStorage.setItem('gh-token',    ghToken);
  localStorage.setItem('gh-repo',     document.getElementById('gh-repo').value);
  localStorage.setItem('gh-workflow', document.getElementById('gh-workflow').value);
}

function loadConfig() {
  // Solo cargar en memoria — NO tocar el DOM aquí
  // Los inputs se rellenan cuando el tab sync se muestra (fillSyncInputs)
  const t = localStorage.getItem('gh-token');
  const r = localStorage.getItem('gh-repo');
  const w = localStorage.getItem('gh-workflow');
  if (t) ghToken = t;
  if (r) localStorage.getItem('gh-repo');   // solo validar que existe
}

function fillSyncInputs() {
  const t = localStorage.getItem('gh-token');
  const r = localStorage.getItem('gh-repo');
  const w = localStorage.getItem('gh-workflow');
  const elT = document.getElementById('gh-token');
  const elR = document.getElementById('gh-repo');
  const elW = document.getElementById('gh-workflow');
  if (elT && t) elT.value = t;
  if (elR && r) elR.value = r;
  if (elW && w) elW.value = w;
}

async function pollWorkflowResult(token, repo, startedAt) {
  const status  = document.getElementById('run-status');
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
  };

  const MAX_INTENTOS = 24; // 24 x 10s = 4 minutos máximo
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
      const run  = (data.workflow_runs || []).find(r =>
        r.path && r.path.includes('catalogo')
      );

      if (!run) continue;

      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          // Recargar productos.json automáticamente tras éxito
          status.innerHTML = `<span class="spin">↻</span> Script finalizado, recargando catálogo…`;
          await cargarProductos();
          status.innerHTML = `<span style="color:var(--green)">✓ Catálogo actualizado correctamente</span>`;
        } else {
          status.innerHTML = `<span style="color:var(--red)">✗ El script falló — puede que la página de Casa Ari esté caída. <a href="${run.html_url}" target="_blank" style="color:var(--red);text-decoration:underline">Ver detalle en GitHub</a></span>`;
        }
        document.getElementById('run-btn').disabled = false;
        return;
      }
    } catch (e) { /* seguir intentando */ }
  }

  status.innerHTML = `<span style="color:var(--text-2)">No se pudo confirmar el resultado. Revisá <a href="https://github.com/${repo}/actions" target="_blank" style="color:var(--blue)">GitHub Actions</a> directamente.</span>`;
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

  const startedAt = new Date().toISOString().slice(0, 19);

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
      pollWorkflowResult(token, repo, startedAt);
    } else {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || `HTTP ${res.status}`);
    }
  } catch (e) {
    status.innerHTML = `<span style="color:var(--red)">Error: ${e.message}</span>`;
    btn.disabled = false;
  }
}

// ── INIT ───────────────────────────────────────────────────────
async function init() {
  initTheme();

  if (!isLoggedIn()) {
    mostrarPantallaLogin();
    return;
  }

  await startApp();
}

init();
