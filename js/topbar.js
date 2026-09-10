/* ================================================================
   topbar.js — Barra superior compartida por catalogo/producto/
   carrito/pedidos/pedido-estado, para que sea idéntica en todas
   (mismos botones, mismo orden) en vez de mantenerla copiada y
   pisada de forma distinta en cada HTML.

   Cada página solo necesita:
     <header class="topbar" id="topbar-slot"></header>
   y llamar a renderTopbar('<key>') antes de tocar #role-badge,
   #cart-btn, etc.

   renderTopbar(activeKey, { search: true }) agrega además la barra de
   búsqueda entre el logo y el nav — hoy solo la usa catalogo.js (el
   input dispara renderCatalogo(), que vive en esa página).

   renderTopbar(activeKey, { marcas: true }) agrega el menú "Marcas"
   (desplegable al pasar el cursor) junto al logo. El panel arranca
   vacío — catalogo.js lo llena vía renderMarcasMenu() cada vez que
   cambia la lista de productos, y también resuelve los clicks.

   Estructura: .logo (sobresale a la izquierda) — .marcas-menu —
   .topbar-search — .topbar-nav (Inicio…Contacto, alineado con el
   margen de la grilla de productos) — .topbar-icons (rol/carrito/
   menú de opciones, sobresale a la derecha). Ver catalogo.css.

   Tema/cuenta/salir viven juntos dentro de un mismo desplegable
   (.settings-menu, ícono de engranaje) en vez de ser íconos
   sueltos — igual en mobile que en desktop. "Mi cuenta" se oculta
   solo para invitados vía la clase admin-only-link de siempre.

   Los botones de cuenta ("Mi cuenta") y logout dependen de que la
   página defina window.doLogout() (todas las páginas de la app lo
   hacen) — la cuenta en sí (cambiar contraseña) solo vive en
   catalogo.js, así que desde cualquier otra página el botón lleva
   ahí con ?account=1.
   ================================================================ */

const NAV_ITEMS = [
  { href: 'landing.html',       label: 'Inicio',      key: 'inicio' },
  { href: 'catalogo.html',      label: 'Catálogo',    key: 'catalogo' },
  { href: 'pedidos.html',       label: 'Pedidos',     key: 'pedidos', adminOnly: true },
  { href: 'pedido-estado.html', label: 'Mis pedidos', key: 'mis-pedidos' },
  { href: 'contacto.html',      label: 'Contacto',    key: 'contacto' },
];

export function renderTopbar(activeKey, opts = {}) {
  const slot = document.getElementById('topbar-slot');
  if (!slot) return;

  const marcasHtml = opts.marcas ? `
    <div class="marcas-menu">
      <button type="button" class="marcas-trigger">
        Marcas
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="marcas-panel" id="marcas-panel"></div>
    </div>` : '';

  const searchHtml = opts.search ? `
    <div class="topbar-search">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="text" id="buscar" placeholder="Buscar producto, marca…" oninput="renderCatalogo()" autocomplete="off">
      </div>
    </div>` : '';

  slot.innerHTML = `
    <button type="button" class="hamburger-btn" id="hamburger-btn" onclick="toggleMobileNavUI()" aria-label="Abrir menú" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    <div class="logo">
      <a href="landing.html" class="logo-link">
        <img src="img/logo-wordmark.png" alt="SoleMio" class="logo-img"
             onerror="this.style.display='none';document.getElementById('topbar-logo-fallback').style.display='inline-flex'">
        <span id="topbar-logo-fallback" style="display:none;align-items:baseline;gap:0.5rem">
          <span class="logo-flourish" aria-hidden="true">☙</span>
          <span class="logo-word">SoleMio</span>
          <span class="logo-flourish" aria-hidden="true">❧</span>
        </span>
      </a>
    </div>
    ${marcasHtml}
    ${searchHtml}
    <nav class="topbar-nav" id="topbar-nav">
      ${NAV_ITEMS.map(item => {
        const classes = [
          item.key === activeKey ? 'active' : '',
          item.adminOnly ? 'admin-only-link' : '',
        ].filter(Boolean).join(' ');
        return `<a href="${item.href}"${classes ? ` class="${classes}"` : ''}>${item.label}</a>`;
      }).join('')}
    </nav>
    <div class="topbar-icons">
      <span class="role-badge" id="role-badge"></span>
      <a class="icon-btn" id="cart-btn" href="carrito.html" title="Tu pedido" onclick="return abrirCarritoDrawerUI(event)">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;stroke:currentColor">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        <span class="cart-badge" id="cart-badge"></span>
      </a>
      <!-- Tema/cuenta/salir van todos acá adentro (mismo desplegable
           en mobile y desktop) en vez de ser íconos sueltos — ver
           toggleSettingsMenuUI más abajo. -->
      <div class="settings-menu" id="settings-menu">
        <button type="button" class="icon-btn" id="settings-btn" onclick="toggleSettingsMenuUI()" aria-label="Más opciones" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <div class="settings-panel" id="settings-panel">
          <button type="button" class="settings-item" onclick="toggleTheme();cerrarSettingsMenuUI()">
            <span class="theme-btn-icon"></span> Cambiar tema
          </button>
          <button type="button" class="settings-item admin-only-link" onclick="irACuentaUI();cerrarSettingsMenuUI()">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
            Mi cuenta
          </button>
          <button type="button" class="settings-item logout-btn" onclick="doLogout()">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>`;
}

function irACuenta() {
  if (/catalogo\.html$/.test(location.pathname) && typeof window.openAccountModal === 'function') {
    window.openAccountModal();
  } else {
    location.href = 'catalogo.html?account=1';
  }
}

/* ── MENÚ MOBILE (hamburguesa) — junta Inicio/Catálogo/Mis pedidos/
   Contacto en un desplegable en vez de ocupar su propia fila fija,
   solo por debajo de cierto ancho (ver .hamburger-btn en catalogo.css,
   que solo se muestra ahí). ────────────────────────────────────── */
function toggleMobileNav() {
  const nav = document.getElementById('topbar-nav');
  const btn = document.getElementById('hamburger-btn');
  if (!nav || !btn) return;
  const abierto = nav.classList.toggle('mobile-open');
  btn.classList.toggle('open', abierto);
  btn.setAttribute('aria-expanded', String(abierto));
}

function cerrarMobileNav() {
  const nav = document.getElementById('topbar-nav');
  const btn = document.getElementById('hamburger-btn');
  if (nav) nav.classList.remove('mobile-open');
  if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
}

// Cierra el menú al elegir una página o al tocar afuera — si no,
// quedaría tapando el catálogo hasta el próximo toque en la campanita.
document.addEventListener('click', (e) => {
  const nav = document.getElementById('topbar-nav');
  if (!nav || !nav.classList.contains('mobile-open')) return;
  if (e.target.closest('#topbar-nav') || e.target.closest('#hamburger-btn')) return;
  cerrarMobileNav();
});

/* ── MENÚ DE OPCIONES (tema / cuenta / salir) — mismo desplegable en
   mobile y desktop, ver .settings-menu en catalogo.css. ─────────── */
function toggleSettingsMenu() {
  const menu = document.getElementById('settings-menu');
  const btn  = document.getElementById('settings-btn');
  if (!menu || !btn) return;
  const abierto = menu.classList.toggle('open');
  btn.setAttribute('aria-expanded', String(abierto));
}

function cerrarSettingsMenu() {
  const menu = document.getElementById('settings-menu');
  const btn  = document.getElementById('settings-btn');
  if (menu) menu.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (e) => {
  const menu = document.getElementById('settings-menu');
  if (!menu || !menu.classList.contains('open')) return;
  if (e.target.closest('#settings-menu')) return;
  cerrarSettingsMenu();
});

window.irACuentaUI          = irACuenta;
window.toggleMobileNavUI    = toggleMobileNav;
window.cerrarMobileNavUI    = cerrarMobileNav;
window.toggleSettingsMenuUI = toggleSettingsMenu;
window.cerrarSettingsMenuUI = cerrarSettingsMenu;
