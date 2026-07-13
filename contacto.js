/* ================================================================
   contacto.js — Tema y acceso al catálogo desde la página de contacto
   ================================================================ */
import { initTheme, toggleTheme } from './theme.js';

function verCatalogo() {
  sessionStorage.setItem('solemio-role', 'guest');
  window.location.href = 'catalogo.html?stock=in';
}

function init() {
  initTheme();
  document.getElementById('year').textContent = new Date().getFullYear();
}

window.verCatalogo = verCatalogo;
window.toggleTheme = toggleTheme;

init();
