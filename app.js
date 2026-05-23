// ── CONFIGURACIÓN GENERAL DE AUTENTICACIÓN ────────────────────
const AUTH = {
  USER: "admin",
  PASS_HASH: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918", // admin
  SESSION_KEY: "solemio_session",
  SESSION_TTL: 24 * 60 * 60 * 1000 // 24 horas
};

// ── CONFIGURACIÓN PÚBLICA DE FIREBASE ────────────────────────
const FB_CONFIG = {
  apiKey:            "AIzaSyD5UWe2m7-Ue9Ty4qCrs0BnAgIqYmhJOC4", 
  authDomain:        "solemio-panel.firebaseapp.com",
  projectId:         "solemio-panel",
  storageBucket:     "solemio-panel.firebasestorage.app",
  messagingSenderId: "223180443701",
  appId:             "1:223180443701:web:1cef7d7c0c32833577617c",
};

// ── ICONOS SVG ────────────────────────────────────────────────
const ICON = {
  shoe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12h18M3 12a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3M3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`
};

let db = null;
let productos = [];

// ── FLUJO DE AUTENTICACIÓN Y ROLES ────────────────────────────
function loginComoInvitado() {
  const sessionData = {
    user: "invitado",
    role: "guest",
    expires: Date.now() + AUTH.SESSION_TTL
  };
  sessionStorage.setItem(AUTH.SESSION_KEY, JSON.stringify(sessionData));
  init();
}

function doLogin() {
  const u = document.getElementById("login-user").value;
  const p = document.getElementById("login-pass").value;
  const err = document.getElementById("login-error");

  if (u === AUTH.USER) {
    hashStr(p).then(h => {
      if (h === AUTH.PASS_HASH) {
        const sessionData = {
          user: u,
          role: "admin",
          expires: Date.now() + AUTH.SESSION_TTL
        };
        sessionStorage.setItem(AUTH.SESSION_KEY, JSON.stringify(sessionData));
        if (err) err.innerText = "";
        init();
      } else {
        if (err) err.innerText = "Contraseña incorrecta";
      }
    });
  } else {
    if (err) err.innerText = "Usuario no válido";
  }
}

function obtenerRolUsuario() {
  try {
    const raw = sessionStorage.getItem(AUTH.SESSION_KEY);
    if (!raw) return null;
    const { expires, role } = JSON.parse(raw);
    if (Date.now() > expires) {
      sessionStorage.removeItem(AUTH.SESSION_KEY);
      return null;
    }
    return role || "admin"; 
  } catch(e) { return null; }
}

function doLogout() {
  sessionStorage.removeItem(AUTH.SESSION_KEY);
  location.reload();
}

// ── PERSISTENCIA CON BUFFER INTELIGENTE (FIRESTORE REAL) ──────
// ── CARGAR PRODUCTOS DESDE TU GITHUB (100% GRATIS Y SIN LÍMITES) ──
async function cargarProductos() {
  // 1. BUFFER LOCAL: Carga inmediata en 0.01 segundos para que la app vuele
  const local = localStorage.getItem('solemio-productos');
  if (local) {
    productos = JSON.parse(local);
    renderCatalogo(); 
  } else {
    productos = demoProductos(); 
    renderCatalogo();
  }

  // 2. FETCH DIRECTO A TU JSON DE GITHUB: Trae los datos reales en segundo plano
  try {
    // Le metemos un timestamp (?t=...) para que el navegador no te cachee el JSON viejo
    const res = await fetch(`productos.json?t=${new Date().getTime()}`);
    
    if (res.ok) {
      const datosFrescos = await res.json();
      
      if (Array.isArray(datosFrescos)) {
        // Mapeamos los datos del JSON (title, image_link) a las variables que usa tu HTML
        productos = datosFrescos.map(data => ({
          id:          data.id || "p_" + Date.now(),
          nombre:      data.title || data.nombre || '',
          marca:       data.brand || data.marca || '',
          precio:      parseFloat(data.price || data.precio || 0),
          color:       data.color || '',
          talles:      data.talles || '',
          stock:       data.availability || data.stock || 'out of stock',
          imagen:      data.image_link || data.imagen || '',
          descripcion: data.description || data.descripcion || ''
        }));

        // Guardamos los datos nuevos en el buffer del navegador para la próxima visita
        localStorage.setItem('solemio-productos', JSON.stringify(productos));
        
        // Volvemos a dibujar la pantalla con el stock e imágenes actualizadas
        renderCatalogo();
        console.log("✓ Catálogo sincronizado exitosamente desde el JSON de GitHub.");
      }
    }
  } catch (e) {
    console.warn("No se pudo descargar productos.json, usando los datos del buffer previo:", e);
  }
}

async function persistirProducto(p) {
  if (obtenerRolUsuario() !== 'admin') return; // Bloqueo de seguridad a invitados

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
      console.error("Error persistiendo en Firebase:", e);
    }
  }
  
  const idx = productos.findIndex(x => x.id === p.id);
  if (idx >= 0) productos[idx] = p; else productos.unshift(p);
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
}

// ── RENDER CATÁLOGO (CON VISUALIZACIÓN DE ID Y BÚSQUEDA CRUZADA) ──
function renderCatalogo() {
  const q     = (document.getElementById('buscar')?.value       || '').toLowerCase();
  const marca = document.getElementById('filtro-marca')?.value  || '';
  const stock = document.getElementById('filtro-stock')?.value  || '';

  const marcas = [...new Set(productos.map(p => p.marca).filter(Boolean))].sort();
  const mSel   = document.getElementById('filtro-marca');
  const mCur   = mSel?.value || '';
  if (mSel) {
    mSel.innerHTML = '<option value="">Todas las marcas</option>' +
      marcas.map(m => `<option value="${m}"${m === mCur ? ' selected' : ''}>${m}</option>`).join('');
  }

  // FILTRO AMPLIADO: Nombre, Marca o ID
  const lista = productos.filter(p => {
    const coincidencia = 
      (p.nombre || '').toLowerCase().includes(q) || 
      (p.marca  || '').toLowerCase().includes(q) || 
      (p.id     || '').toLowerCase().includes(q);

    if (q && !coincidencia) return false;
    if (marca && p.marca !== marca) return false;
    if (stock && p.stock !== stock) return false;
    return true;
  });

  const grid = document.getElementById('catalogo-grid');
  if (!grid) return;

  if (!lista.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${ICON.shoe} No se encontraron productos</div>`;
    return;
  }

  grid.innerHTML = lista.map((p, i) => `
    <article class="prod-card" style="animation-delay:${i * 20}ms">
      ${p.imagen ? `<img class="prod-thumb" src="${p.imagen}" alt="${p.nombre}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
      <div class="prod-thumb-ph" style="${p.imagen ? 'display:none' : ''}">${ICON.shoe}</div>
      <div class="prod-body">
        <div style="font-size:0.7rem; color:var(--text-3); font-family:monospace; margin-bottom:0.2rem;">ID: ${p.id}</div>
        <div class="prod-name">${p.nombre}</div>
        <div class="prod-meta">${[p.color, p.talles].filter(Boolean).join(' · ')}</div>
        <div class="prod-price">${fmtARS(p.precio)}</div>
        <div class="prod-badges">
          <span class="badge ${p.stock === 'in stock' ? 'stock' : 'nostock'}">${p.stock === 'in stock' ? 'En stock' : 'Sin stock'}</span>
          ${p.marca ? `<span class="badge marca">${p.marca}</span>` : ''}
        </div>
        
        ${obtenerRolUsuario() === 'admin' ? `
        <div class="prod-actions">
          <button class="btn sm ghost" onclick="openProdModal('${p.id}')">${ICON.edit} Editar</button>
          <button class="btn sm danger" onclick="confirmarEliminar('${p.id}')">${ICON.trash}</button>
        </div>` : ''}
      </div>
    </article>`).join('');
}

// ── MANEJO DE MODALES Y ACCIONES MANUALES ─────────────────────
function openProdModal(id = null) {
  if (obtenerRolUsuario() !== 'admin') return; // Bloqueo extra de interfaz

  const m = document.getElementById('prod-modal');
  if (!m) return;
  
  if (id) {
    const p = productos.find(x => x.id === id);
    if (!p) return;
    document.getElementById('modal-title').innerText = "Editar Producto";
    document.getElementById('p-id').value = p.id;
    document.getElementById('p-nombre').value = p.nombre;
    document.getElementById('p-marca').value = p.marca;
    document.getElementById('p-precio').value = p.precio;
    document.getElementById('p-color').value = p.color;
    document.getElementById('p-talles').value = p.talles;
    document.getElementById('p-imagen').value = p.imagen;
    document.getElementById('p-stock').value = p.stock;
    document.getElementById('p-descripcion').value = p.descripcion;
  } else {
    document.getElementById('modal-title').innerText = "Nuevo Producto";
    document.getElementById('p-id').value = "p_" + Date.now();
    document.getElementById('p-nombre').value = "";
    document.getElementById('p-marca').value = "";
    document.getElementById('p-precio').value = "";
    document.getElementById('p-color').value = "";
    document.getElementById('p-talles').value = "";
    document.getElementById('p-imagen').value = "";
    document.getElementById('p-stock').value = "in stock";
    document.getElementById('p-descripcion').value = "";
  }
  m.style.display = 'flex';
}

function closeProdModal() {
  const m = document.getElementById('prod-modal');
  if (m) m.style.display = 'none';
}

async function saveProd() {
  const p = {
    id:          document.getElementById('p-id').value,
    nombre:      document.getElementById('p-nombre').value,
    marca:       document.getElementById('p-marca').value,
    precio:      parseFloat(document.getElementById('p-precio').value || 0),
    color:       document.getElementById('p-color').value,
    talles:      document.getElementById('p-talles').value,
    imagen:      document.getElementById('p-imagen').value,
    stock:       document.getElementById('p-stock').value,
    descripcion: document.getElementById('p-descripcion').value
  };

  if (!p.nombre) return alert("El nombre es obligatorio");
  
  await persistirProducto(p);
  closeProdModal();
  renderCatalogo();
}

async function confirmarEliminar(id) {
  if (obtenerRolUsuario() !== 'admin') return;
  if (!confirm("¿Seguro que querés borrar este producto del catálogo?")) return;
  
  if (db) {
    try {
      await window._fb.deleteDoc(window._fb.doc(db, 'productos', id));
    } catch(e) { console.error(e); }
  }
  productos = productos.filter(x => x.id !== id);
  localStorage.setItem('solemio-productos', JSON.stringify(productos));
  renderCatalogo();
}

// ── DISPARAR WORKFLOW EN GITHUB ACTIONS ───────────────────────
async function sincronizarCatalogo() {
  const btn = document.getElementById('btn-sincro');
  const status = document.getElementById('sincro-status');
  if (!btn || !status) return;

  const token = localStorage.getItem('sm_gh_token') || "";
  const repo = localStorage.getItem('sm_gh_repo') || "";

  if (!token || !repo) {
    status.innerHTML = `<span style="color:var(--red)">⚠ Error: Configurá primero el Token y el Repo en la pestaña Configuración.</span>`;
    return;
  }

  btn.disabled = true;
  status.innerHTML = '<span class="spin">↻</span> Levantando GitHub Action...';

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/catalogo.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' })
    });

    if (res.status === 204) {
      status.innerHTML = '<span style="color:var(--green)">✓ ¡Acción lanzada! Tardará unos 15 min en sincronizar todo.</span>';
    } else {
      throw new Error(`Código HTTP ${res.status}`);
    }
  } catch(e) {
    status.innerHTML = `<span style="color:var(--red)">Fallo al conectar con GitHub: ${e.message}</span>`;
  }
  btn.disabled = false;
}

// ── MENÚ LATERAL Y NAVEGACIÓN ─────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

  const targetTab = document.getElementById(`tab-${tabId}`);
  const targetBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  
  if (targetTab) targetTab.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');
}

function guardarConfig() {
  const token = document.getElementById('cfg-token').value;
  const repo = document.getElementById('cfg-repo').value;
  localStorage.setItem('sm_gh_token', token);
  localStorage.setItem('sm_gh_repo', repo);
  alert("Configuración de GitHub guardada localmente.");
}

// ── AUXILIARES TÉCNICOS ───────────────────────────────────────
function initTheme() {
  document.documentElement.setAttribute('data-theme', 'dark');
}
function fmtARS(v) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v);
}
async function hashStr(s) {
  const msgBuffer = new TextEncoder().encode(s);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function demoProductos() {
  return []; // Inicialización vacía limpia
}

// ── INICIALIZADOR DE LA APP (ORQUESTADOR) ─────────────────────
async function init() {
  initTheme();
  const rol = obtenerRolUsuario();

  if (!rol) {
    document.getElementById("app").style.display = "none";
    document.getElementById("login-screen").style.display = "flex";
    return;
  }

  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";

  // Control estricto del Menú Lateral por permisos de Rol
  if (rol === 'guest') {
    document.querySelectorAll('.nav-btn[data-tab="sync"], .nav-btn[data-tab="config"]').forEach(el => el.style.display = 'none');
    document.getElementById('btn-nuevo-prod').style.display = 'none';
    switchTab('catalog');
  } else {
    document.querySelectorAll('.nav-btn').forEach(el => el.style.display = 'flex');
    document.getElementById('btn-nuevo-prod').style.display = 'flex';
    
    // Auto-completar inputs de config si ya existen
    if(document.getElementById('cfg-token')) document.getElementById('cfg-token').value = localStorage.getItem('sm_gh_token') || "";
    if(document.getElementById('cfg-repo')) document.getElementById('cfg-repo').value = localStorage.getItem('sm_gh_repo') || "";
    switchTab('catalog');
  }

  // Inicializar Firebase e inyectar datos al Buffer
  if (window._fb && !db) {
    try {
      const app = window._fb.initializeApp(FB_CONFIG);
      db = window._fb.getFirestore(app);
    } catch(e) { console.error("Error inicializando Firebase SDK:", e); }
  }

  await cargarProductos();
}

window.addEventListener('DOMContentLoaded', init);
