const AUTH = {
  USER: "admin",
  PASS_HASH: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
  SESSION_KEY: "solemio_session",
  SESSION_TTL: 86400000
};

let productos = [];

// ── LÓGICA DE CARGA JSON ────────────────────────
async function cargarProductos() {
  const local = localStorage.getItem('solemio-productos');
  if (local) {
    productos = JSON.parse(local);
    renderCatalogo();
  }

  try {
    const res = await fetch(`productos.json?t=${Date.now()}`);
    if (res.ok) {
      productos = await res.json();
      localStorage.setItem('solemio-productos', JSON.stringify(productos));
      renderCatalogo();
    }
  } catch (e) { console.warn("No se pudo cargar productos.json remoto"); }
}

// ── RENDERS Y ACCIONES ──────────────────────────
function renderCatalogo() {
  const q = document.getElementById('buscar')?.value.toLowerCase() || '';
  const grid = document.getElementById('catalogo-grid');
  if (!grid) return;

  const filtered = productos.filter(p => 
    p.nombre?.toLowerCase().includes(q) || p.id?.toLowerCase().includes(q)
  );

  grid.innerHTML = filtered.map(p => `
    <article class="prod-card">
      <div class="prod-body">
        <strong>${p.nombre}</strong><br>
        <small>ID: ${p.id}</small><br>
        <span>$${p.precio}</span>
      </div>
    </article>`).join('');
}

// ── AUTH ──────────────────────────────────────
function doLogin() {
  const u = document.getElementById("login-user").value;
  const p = document.getElementById("login-pass").value;
  hashStr(p).then(h => {
    if (u === AUTH.USER && h === AUTH.PASS_HASH) {
      sessionStorage.setItem(AUTH.SESSION_KEY, JSON.stringify({role: 'admin'}));
      init();
    } else {
      alert("Error de login");
    }
  });
}

function loginComoInvitado() {
  sessionStorage.setItem(AUTH.SESSION_KEY, JSON.stringify({role: 'guest'}));
  init();
}

function obtenerRolUsuario() {
  const s = sessionStorage.getItem(AUTH.SESSION_KEY);
  return s ? JSON.parse(s).role : null;
}

// ── SYNC GITHUB ───────────────────────────────
async function sincronizarCatalogo() {
  const token = localStorage.getItem('sm_gh_token');
  const repo = localStorage.getItem('sm_gh_repo');
  
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/catalogo.yml/dispatches`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify({ ref: 'main' })
  });
  
  if (res.ok) alert("Sincronización iniciada");
}

function init() {
  const rol = obtenerRolUsuario();
  document.getElementById("login-screen").style.display = rol ? "none" : "flex";
  document.getElementById("app").style.display = rol ? "block" : "none";
  cargarProductos();
}

async function hashStr(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function doLogout() { sessionStorage.removeItem(AUTH.SESSION_KEY); location.reload(); }
function switchTab(t) { /* lógica de pestañas igual a la anterior */ }
function guardarConfig() {
  localStorage.setItem('sm_gh_token', document.getElementById('cfg-token').value);
  localStorage.setItem('sm_gh_repo', document.getElementById('cfg-repo').value);
}

window.onload = init;
