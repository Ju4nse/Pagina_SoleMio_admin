/* ================================================================
   topbar.js — Barra superior compartida por catalogo/producto/
   carrito/pedidos/pedido-estado, para que sea idéntica en todas
   (mismos botones, mismo orden) en vez de mantenerla copiada y
   pisada de forma distinta en cada HTML.

   Cada página solo necesita:
     <header class="topbar" id="topbar-slot"></header>
   y llamar a renderTopbar('<key>') antes de tocar #role-badge,
   #theme-btn, #cart-btn, etc.

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
   tema/cuenta/salir, sobresale a la derecha). Ver catalogo.css.

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
    <div class="logo">
      <a href="landing.html" class="logo-link">
        <span class="logo-word">SoleMio</span>
      </a>
    </div>
    ${marcasHtml}
    ${searchHtml}
    <nav class="topbar-nav">
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
      <a class="icon-btn" id="cart-btn" href="carrito.html" title="Tu pedido">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;stroke:currentColor">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        <span class="cart-badge" id="cart-badge"></span>
      </a>
      <button class="theme-btn" id="theme-btn" onclick="toggleTheme()" aria-label="Cambiar tema"></button>
      <button class="icon-btn admin-only-link" id="account-btn" onclick="irACuentaUI()" title="Mi cuenta">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;stroke:currentColor">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      </button>
      <button class="icon-btn logout-btn" onclick="doLogout()" title="Cerrar sesión">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;stroke:currentColor">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>`;
}

function irACuenta() {
  if (/catalogo\.html$/.test(location.pathname) && typeof window.openAccountModal === 'function') {
    window.openAccountModal();
  } else {
    location.href = 'catalogo.html?account=1';
  }
}

window.irACuentaUI = irACuenta;
