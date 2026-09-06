/* ================================================================
   footer.js — Pie de página compartido por todas las páginas del
   sitio (mismos links y datos de contacto en todos lados, en vez de
   mantenerlo copiado y pisado de forma distinta en cada HTML — mismo
   criterio que topbar.js).

   Cada página solo necesita:
     <footer class="site-footer" id="footer-slot"></footer>
   y llamar a renderFooter() (los estilos viven en catalogo.css, que
   ya se linkea en todas las páginas de la app).
   ================================================================ */

const WHATSAPP  = 'https://wa.me/542494003595';
const INSTAGRAM = 'https://instagram.com/solemio.tandil';
const DIRECCION = 'Tacuari 33, Tandil, Buenos Aires';
const MAPS_URL  = 'https://www.google.com/maps/search/?api=1&query=Tacuari+33,+Tandil,+Buenos+Aires,+Argentina';
const ATENCION  = ['Solo con reserva previa', 'Coordiná tu horario por WhatsApp'];

/* Mismas páginas que el nav de topbar.js (ver NAV_ITEMS ahí). El link
   a Pedidos lleva la clase admin-only-link, que ya oculta ese tipo de
   links para invitados vía CSS ([data-role="guest"] .admin-only-link
   en catalogo.css) — no hace falta que footer.js sepa el rol. */
const PAGINAS = [
  { href: 'landing.html',       label: 'Inicio' },
  { href: 'catalogo.html',      label: 'Catálogo' },
  { href: 'pedidos.html',       label: 'Pedidos', adminOnly: true },
  { href: 'pedido-estado.html', label: 'Mis pedidos' },
  { href: 'contacto.html',      label: 'Contacto' },
];

export function renderFooter() {
  const slot = document.getElementById('footer-slot');
  if (!slot) return;

  slot.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <span class="footer-logo">SoleMio</span>
        <p class="footer-tagline">Lencería &amp; corsetería en Tandil</p>
      </div>

      <div class="footer-col">
        <span class="footer-col-title">Páginas</span>
        ${PAGINAS.map(p => `
          <a href="${p.href}"${p.adminOnly ? ' class="admin-only-link"' : ''}>${p.label}</a>
        `).join('')}
      </div>

      <div class="footer-col">
        <span class="footer-col-title">Contacto</span>
        <a href="${WHATSAPP}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          WhatsApp
        </a>
        <a href="${INSTAGRAM}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5"/>
            <circle cx="12" cy="12" r="4"/>
            <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"/>
          </svg>
          Instagram
        </a>
        <a href="${MAPS_URL}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          ${DIRECCION}
        </a>
      </div>

      <div class="footer-col">
        <span class="footer-col-title">Atención</span>
        ${ATENCION.map(l => `<p>${l}</p>`).join('')}
      </div>
    </div>

    <div class="footer-bottom">
      © <span id="footer-year"></span> SoleMio. Todos los derechos reservados.
    </div>`;

  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}
