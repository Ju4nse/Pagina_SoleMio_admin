/* ================================================================
   contacto.js — Tema y acceso al catálogo desde la página de contacto
   ================================================================ */
import { initTheme, toggleTheme } from './theme.js';
import { irAlCatalogo }           from './supabase-client.js';

function init() {
  initTheme();
  document.getElementById('year').textContent = new Date().getFullYear();
}

window.verCatalogo = irAlCatalogo;
window.toggleTheme = toggleTheme;

init();
