/* ================================================================
   theme.js — Tema claro/oscuro + set de íconos SVG compartidos
   Usado por login.js (solo initTheme) y catalogo.js (initTheme +
   toggleTheme + ICON).
   ================================================================ */
import { sb } from './supabase-client.js';

export const ICON = {
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
};

/* Aplica el tema guardado. Si existe #theme-btn en la página (solo en
   catálogo) también actualiza su ícono. Seguro de usar en login. */
export function initTheme() {
  const saved = localStorage.getItem('solemio-theme') || 'light';
  document.documentElement.dataset.theme = saved;
  const btn = document.getElementById('theme-btn');
  if (btn) btn.innerHTML = saved === 'dark' ? ICON.sun : ICON.moon;
}

export function toggleTheme() {
  const html   = document.documentElement;
  const isDark = html.dataset.theme === 'dark';
  html.dataset.theme = isDark ? 'light' : 'dark';
  const btn = document.getElementById('theme-btn');
  if (btn) btn.innerHTML = isDark ? ICON.moon : ICON.sun;
  localStorage.setItem('solemio-theme', html.dataset.theme);
}

/* ================================================================
   COLORES COMPARTIDOS
   ================================================================ */
export const COLOR_MAP = {
  'negro': '#1a1a1a', 'blanco': '#ffffff', 'crudo': '#f2ead9',
  'gris': '#9c9c9c', 'gris claro': '#cfcfcf', 'gris oscuro': '#555555',
  'rojo': '#c0392b', 'rosa': '#e8a0bf', 'rosa viejo': '#c98ba0',
  'fucsia': '#d6336c', 'bordo': '#7b1e3a', 'vino': '#722f37',
  'azul': '#2b4c8c', 'azul marino': '#1b2a4a', 'celeste': '#8ec9e0',
  'turquesa': '#1abc9c', 'verde': '#2e8b57', 'verde militar': '#556b2f',
  'amarillo': '#f1c40f', 'mostaza': '#c9a227', 'naranja': '#e07b39',
  'marron': '#6b4226', 'beige': '#d8c3a5', 'nude': '#e3c2a5',
  'camel': '#c19a6b', 'violeta': '#8e44ad', 'lila': '#c8a2c8',
  'morado': '#6c3483', 'dorado': '#caa94a', 'plateado': '#c0c0c0',
  'animal print': '#a67b5b', 'leopardo': '#a67b5b', 'coral': '#ff7f50',
  'salmon': '#fa8072',
};

export function normalizarColor(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/* Colores que el admin defini\u00f3 a mano (pisan/completan COLOR_MAP),
   ej. el tono exacto de "Natural" o un verde puntual. Se cargan una
   sola vez por p\u00e1gina con cargarColoresPersonalizados(). */
let coloresPersonalizados = null;

export async function cargarColoresPersonalizados() {
  if (coloresPersonalizados) return coloresPersonalizados;
  coloresPersonalizados = {};
  try {
    const { data, error } = await sb.from('colores_personalizados').select('nombre, hex');
    if (!error && data) {
      data.forEach(d => { coloresPersonalizados[d.nombre] = d.hex; });
    }
  } catch (_) {}
  return coloresPersonalizados;
}

export async function guardarColorPersonalizado(nombre, hex) {
  const clave = normalizarColor(nombre);
  if (!coloresPersonalizados) coloresPersonalizados = {};
  coloresPersonalizados[clave] = hex;
  try {
    const { error } = await sb
      .from('colores_personalizados')
      .upsert({ nombre: clave, hex }, { onConflict: 'nombre' });
    if (error) console.warn('No se pudo guardar el color personalizado:', error.message);
  } catch (err) {
    console.warn('No se pudo guardar el color personalizado:', err);
  }
}

export function hexDeColor(nombre) {
  const clave = normalizarColor(nombre);
  if (coloresPersonalizados && coloresPersonalizados[clave]) return coloresPersonalizados[clave];
  return COLOR_MAP[clave] || null;
}
