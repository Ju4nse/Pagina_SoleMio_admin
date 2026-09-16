/* ================================================================
   mensajes.js — Bandeja de mensajes directos de Instagram
   (@solemio.tandil). Página exclusiva de admin: si no hay sesión de
   admin, redirige a login.html (mismo criterio que pedidos.js).

   Los mensajes los guardan las Edge Functions de supabase/functions/
   (ig-webhook cuando Meta los manda); acá solo se leen de las tablas
   ig_conversaciones / ig_mensajes, se escucha realtime, y para
   responder se llama a la función ig-send. Ver INSTAGRAM.md.

   Todo lo que viene de Instagram (textos, nombres, URLs) es contenido
   de terceros: siempre pasa por esc() / urlSegura() antes de ir al
   innerHTML.
   ================================================================ */
import { sb, esAdmin }   from './supabase-client.js';
import { initTheme, toggleTheme } from './theme.js';
import { initCarritoUI } from './carrito.js';
import { renderTopbar }  from './topbar.js';
import { renderFooter }  from './footer.js';
import { initAlertasPedidos, setConversacionAbiertaIG } from './pedidos-alertas.js';

/* ================================================================
   STATE
   ================================================================ */
let conversaciones = [];     // filas de ig_conversaciones
let abiertaId      = null;   // id de la conversación abierta
let mensajes       = [];     // filas de ig_mensajes de la abierta, por enviado_en
let enviando       = false;
let sincronizando  = false;

const VENTANA_MS        = 24 * 60 * 60 * 1000;
const AVISO_TOKEN_DIAS  = 45;   // el token dura 60; el cron lo renueva cada 7
const MENSAJES_POR_HILO = 300;

/* ================================================================
   HELPERS
   ================================================================ */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* Solo URLs https (las de la CDN de Meta). Cualquier otra cosa
   (javascript:, data:, etc.) se descarta. */
function urlSegura(u) {
  return typeof u === 'string' && /^https:\/\//i.test(u) ? u : '';
}

function fmtHora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDia(iso) {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString())  return 'Hoy';
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/* Hora en la lista: "14:32" si es de hoy, "12/09" si no. */
function fmtCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return fmtHora(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

function nombreDe(c) {
  if (c?.nombre)   return c.nombre;
  if (c?.username) return '@' + c.username;
  return 'Usuario de Instagram';
}

function avatarHtml(c, clase = 'ig-avatar') {
  const inicial = esc((c?.nombre || c?.username || '?').trim().charAt(0).toUpperCase());
  const foto = urlSegura(c?.foto_url);
  // Si la foto no carga (URL vencida), el listener de 'error' la saca
  // y queda la inicial de fondo.
  return `<span class="${clase}" aria-hidden="true">${inicial}${foto ? `<img src="${esc(foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
}

function linkInstagram(c) {
  return c?.username ? `https://ig.me/m/${encodeURIComponent(c.username)}` : 'https://www.instagram.com/direct/inbox/';
}

function ventanaAbierta(c) {
  if (!c?.ultimo_entrante_en) return false;
  return Date.now() - new Date(c.ultimo_entrante_en).getTime() < VENTANA_MS;
}

function conversacionAbierta() {
  return conversaciones.find(c => c.id === abiertaId) || null;
}

function mostrarAviso(html, tipo = 'info') {
  const el = document.getElementById('ig-aviso');
  if (!html) { el.hidden = true; el.innerHTML = ''; return; }
  el.className = `ig-aviso ${tipo}`;
  el.innerHTML = html;
  el.hidden = false;
}

/* Error de supabase.functions.invoke: el mensaje útil viene en el body
   JSON de la respuesta ({ error: "..." }), no en error.message. */
async function mensajeDeError(error) {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return body.error;
  } catch (_) {}
  return error?.message || 'Error desconocido';
}

/* ================================================================
   CARGA DE DATOS
   ================================================================ */
async function cargarConversaciones() {
  const { data, error } = await sb
    .from('ig_conversaciones')
    .select('*')
    .order('ultimo_mensaje_en', { ascending: false, nullsFirst: false });

  if (error) {
    const faltaMigracion = /ig_conversaciones/.test(error.message) && /(exist|schema cache|not find)/i.test(error.message);
    document.getElementById('ig-lista').innerHTML = `
      <div class="empty">${faltaMigracion
        ? 'Falta correr la migración <code>sql/2026-09-16_instagram_inbox.sql</code> en Supabase.'
        : 'No se pudieron cargar las conversaciones: ' + esc(error.message)}</div>`;
    return;
  }

  conversaciones = data || [];
  renderLista();
}

async function cargarMensajes(convId) {
  const { data, error } = await sb
    .from('ig_mensajes')
    .select('*')
    .eq('conversacion_id', convId)
    .order('enviado_en', { ascending: false })
    .limit(MENSAJES_POR_HILO);

  if (convId !== abiertaId) return; // se cambió de conversación mientras cargaba
  if (error) {
    document.getElementById('ig-mensajes').innerHTML =
      `<div class="empty">No se pudieron cargar los mensajes: ${esc(error.message)}</div>`;
    return;
  }
  mensajes = (data || []).reverse();
  renderMensajes(true);
}

async function revisarToken() {
  const { data, error } = await sb.rpc('ig_estado_token');
  if (error) return; // migración sin correr: ya lo avisa la lista
  if (!data) {
    mostrarAviso('Todavía no hay un token de Instagram cargado, así que no entran ni salen mensajes. Ver <strong>INSTAGRAM.md</strong> en el repo.', 'alerta');
    return;
  }
  const dias = Math.floor((Date.now() - new Date(data).getTime()) / 86400000);
  if (dias >= AVISO_TOKEN_DIAS) {
    mostrarAviso(`El token de Instagram no se renueva hace ${dias} días (vence a los 60). Revisá el cron <code>ig-refresh-token</code> o generá un token nuevo en Meta.`, 'alerta');
  }
}

/* ================================================================
   RENDER — LISTA DE CONVERSACIONES
   ================================================================ */
function renderLista() {
  const cont = document.getElementById('ig-lista');
  const q = (document.getElementById('ig-buscar').value || '').trim().toLowerCase();

  const lista = conversaciones
    .filter(c => !q || (c.username || '').toLowerCase().includes(q) || (c.nombre || '').toLowerCase().includes(q))
    .sort((a, b) => new Date(b.ultimo_mensaje_en || 0) - new Date(a.ultimo_mensaje_en || 0));

  if (!lista.length) {
    cont.innerHTML = `<div class="empty">${q
      ? 'Ninguna conversación coincide con la búsqueda.'
      : 'Todavía no hay conversaciones. Tocá <strong>Sincronizar</strong> para traer las últimas de Instagram, o esperá a que entre un mensaje.'}</div>`;
    return;
  }

  cont.innerHTML = lista.map(c => `
    <button type="button" class="ig-conv${c.id === abiertaId ? ' activa' : ''}${c.no_leidos > 0 ? ' no-leida' : ''}"
            onclick="abrirConversacionUI('${c.id}')">
      ${avatarHtml(c)}
      <span class="ig-conv-body">
        <span class="ig-conv-top">
          <span class="ig-conv-nombre">${esc(nombreDe(c))}</span>
          <span class="ig-conv-hora">${esc(fmtCorta(c.ultimo_mensaje_en))}</span>
        </span>
        <span class="ig-conv-bottom">
          <span class="ig-conv-preview">${esc(c.ultimo_mensaje_texto || '')}</span>
          ${c.no_leidos > 0 ? `<span class="ig-conv-badge">${c.no_leidos > 99 ? '99+' : c.no_leidos}</span>` : ''}
        </span>
      </span>
    </button>`).join('');
}

/* ================================================================
   RENDER — HILO ABIERTO
   ================================================================ */
function renderHiloHead() {
  const c = conversacionAbierta();
  if (!c) return;
  document.getElementById('ig-hilo-head').innerHTML = `
    <button type="button" class="icon-btn ig-volver" onclick="cerrarConversacionUI()" aria-label="Volver a la lista">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    ${avatarHtml(c, 'ig-avatar ig-avatar-sm')}
    <div class="ig-hilo-quien">
      <div class="ig-hilo-nombre">${esc(nombreDe(c))}</div>
      ${c.username && c.nombre ? `<div class="ig-hilo-user">@${esc(c.username)}</div>` : ''}
    </div>
    <a class="btn sm ghost" href="${esc(linkInstagram(c))}" target="_blank" rel="noopener">Abrir en Instagram</a>`;
}

function adjuntoHtml(a) {
  const url = urlSegura(a?.url);
  const tipo = a?.tipo || 'archivo';

  const etiqueta = {
    respuesta_historia: 'Respondió a tu historia',
    story_mention:      'Te mencionó en su historia',
    share:              'Compartió una publicación',
    ig_reel:            'Compartió un reel',
    reel:               'Compartió un reel',
  }[tipo];

  let cuerpo;
  if (!url) {
    cuerpo = `<span class="ig-adj-vencido">Adjunto no disponible — ver en Instagram</span>`;
  } else if (tipo === 'video') {
    cuerpo = `<video src="${esc(url)}" controls preload="metadata"></video>`;
  } else if (tipo === 'audio') {
    cuerpo = `<audio src="${esc(url)}" controls preload="none"></audio>`;
  } else if (['image', 'sticker', 'animated_image', 'respuesta_historia', 'story_mention', 'share', 'ig_reel', 'reel'].includes(tipo)) {
    // Historias y publicaciones compartidas a veces son video: si la
    // imagen no carga, el listener de 'error' deja un link en su lugar.
    cuerpo = `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-adjunto></a>`;
  } else {
    cuerpo = `<a class="ig-adj-link" href="${esc(url)}" target="_blank" rel="noopener">Ver adjunto</a>`;
  }

  return `<div class="ig-adj">${etiqueta ? `<div class="ig-adj-etiqueta">${esc(etiqueta)}</div>` : ''}${cuerpo}</div>`;
}

function renderMensajes(scrollAlFinal = false) {
  const cont = document.getElementById('ig-mensajes');
  const cercaDelFinal = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 80;

  if (!mensajes.length) {
    cont.innerHTML = `<div class="empty">No hay mensajes guardados de esta conversación.</div>`;
    renderVentana();
    return;
  }

  let diaPrevio = '';
  cont.innerHTML = mensajes.map(m => {
    const dia = fmtDia(m.enviado_en);
    const separador = dia !== diaPrevio ? `<div class="ig-dia">${esc(dia)}</div>` : '';
    diaPrevio = dia;

    const adjuntos = Array.isArray(m.adjuntos) ? m.adjuntos : [];
    const meta = [
      fmtHora(m.enviado_en),
      m.direccion === 'saliente' ? (m.enviado_por ? 'desde el panel' : 'desde Instagram') : '',
    ].filter(Boolean).join(' · ');

    return `${separador}
      <div class="ig-msg ${m.direccion}${m.eliminado ? ' eliminado' : ''}" title="${esc(m.enviado_por || '')}">
        ${m.eliminado ? `<div class="ig-msg-texto"><em>Mensaje eliminado</em></div>` : `
          ${adjuntos.map(adjuntoHtml).join('')}
          ${m.texto ? `<div class="ig-msg-texto">${esc(m.texto)}</div>` : ''}`}
        <div class="ig-msg-meta">${esc(meta)}</div>
      </div>`;
  }).join('');

  if (scrollAlFinal || cercaDelFinal) cont.scrollTop = cont.scrollHeight;
  renderVentana();
}

/* Estado de la ventana de 24 h: habilita o no el composer. */
function renderVentana() {
  const c = conversacionAbierta();
  const aviso = document.getElementById('ig-ventana');
  const texto = document.getElementById('ig-texto');
  const btn   = document.getElementById('ig-btn-enviar');
  if (!c) return;

  const abierta = ventanaAbierta(c);
  texto.disabled = !abierta || enviando;
  btn.disabled   = !abierta || enviando;

  if (abierta) {
    const hasta = new Date(new Date(c.ultimo_entrante_en).getTime() + VENTANA_MS);
    const mismoDia = hasta.toDateString() === new Date().toDateString();
    aviso.className = 'ig-ventana';
    aviso.textContent = `Podés responder desde acá hasta ${mismoDia ? 'hoy' : 'mañana'} a las ${fmtHora(hasta)}.`;
  } else {
    aviso.className = 'ig-ventana cerrada';
    aviso.innerHTML = c.ultimo_entrante_en
      ? `Pasaron más de 24 h desde el último mensaje de esta persona: Instagram no deja responder desde acá hasta que vuelva a escribir. Podés contestarle <a href="${esc(linkInstagram(c))}" target="_blank" rel="noopener">desde la app de Instagram</a>.`
      : `Esta persona todavía no escribió: Instagram no deja iniciar conversaciones desde acá.`;
  }
}

/* ================================================================
   ACCIONES
   ================================================================ */
async function abrirConversacion(id, { actualizarUrl = true } = {}) {
  if (!conversaciones.some(c => c.id === id)) return;

  abiertaId = id;
  mensajes = [];
  setConversacionAbiertaIG(id);

  document.getElementById('ig-inbox').classList.add('hilo-abierto');
  document.getElementById('ig-hilo-vacio').hidden = true;
  document.getElementById('ig-hilo').hidden = false;
  document.getElementById('ig-mensajes').innerHTML = `<div class="empty">Cargando mensajes…</div>`;
  document.getElementById('ig-texto').value = '';
  autoAltura(document.getElementById('ig-texto'));

  if (actualizarUrl) history.replaceState(null, '', `?c=${encodeURIComponent(id)}`);

  renderHiloHead();
  renderVentana();
  renderLista();
  await Promise.all([cargarMensajes(id), marcarLeida(id)]);
}

function cerrarConversacion() {
  abiertaId = null;
  mensajes = [];
  setConversacionAbiertaIG(null);
  document.getElementById('ig-inbox').classList.remove('hilo-abierto');
  document.getElementById('ig-hilo').hidden = true;
  document.getElementById('ig-hilo-vacio').hidden = false;
  history.replaceState(null, '', location.pathname);
  renderLista();
}

async function marcarLeida(id) {
  const c = conversaciones.find(x => x.id === id);
  if (!c || !c.no_leidos || document.visibilityState !== 'visible') return;
  c.no_leidos = 0;
  renderLista();
  const { error } = await sb.from('ig_conversaciones').update({ no_leidos: 0 }).eq('id', id);
  if (error) console.warn('No se pudo marcar como leída:', error.message);
}

async function enviar(event) {
  event.preventDefault();
  const c = conversacionAbierta();
  const input = document.getElementById('ig-texto');
  const texto = input.value.trim();
  if (!c || !texto || enviando) return;

  enviando = true;
  renderVentana();
  const btn = document.getElementById('ig-btn-enviar');
  btn.textContent = 'Enviando…';

  const { error } = await sb.functions.invoke('ig-send', {
    body: { conversacion_id: c.id, texto },
  });

  enviando = false;
  btn.textContent = 'Enviar';

  if (error) {
    const msg = await mensajeDeError(error);
    mostrarAviso(`No se pudo enviar: ${esc(msg)}`, 'error');
    renderVentana();
    input.focus();
    return;
  }

  mostrarAviso('');
  input.value = '';
  autoAltura(input);
  renderVentana();
  input.focus();
  // ig-send ya guardó el mensaje antes de responder: se recarga por si
  // el evento de realtime todavía no llegó.
  if (c.id === abiertaId) await cargarMensajes(c.id);
}

/* Trae conversaciones anteriores desde Instagram, de a páginas (ver
   supabase/functions/ig-sync). */
async function sincronizar() {
  if (sincronizando) return;
  sincronizando = true;

  const btn   = document.getElementById('ig-btn-sync');
  const label = document.getElementById('ig-btn-sync-label');
  btn.disabled = true;

  let cursor = null, totalConv = 0, totalMsg = 0;
  try {
    do {
      label.textContent = totalConv ? `Sincronizando… (${totalConv})` : 'Sincronizando…';
      const { data, error } = await sb.functions.invoke('ig-sync', { body: { cursor } });
      if (error) throw new Error(await mensajeDeError(error));
      totalConv += data.conversaciones || 0;
      totalMsg  += data.mensajes_nuevos || 0;
      cursor = data.cursor;
      await cargarConversaciones();
    } while (cursor);

    mostrarAviso(`Listo: se revisaron ${totalConv} conversaciones y se agregaron ${totalMsg} mensajes.`, 'ok');
  } catch (err) {
    mostrarAviso(`La sincronización se cortó${totalConv ? ` después de ${totalConv} conversaciones` : ''}: ${esc(err.message)}`, 'error');
  } finally {
    sincronizando = false;
    btn.disabled = false;
    label.textContent = 'Sincronizar';
    if (abiertaId) cargarMensajes(abiertaId);
  }
}

function teclaComposer(event) {
  // Enter envía, Shift+Enter hace salto de línea (como en Instagram web).
  // En pantallas táctiles Enter queda como salto de línea.
  if (event.key === 'Enter' && !event.shiftKey && !matchMedia('(pointer: coarse)').matches) {
    event.preventDefault();
    document.getElementById('ig-composer').requestSubmit();
  }
}

function autoAltura(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

/* ================================================================
   REALTIME
   ================================================================ */
function suscribirRealtime() {
  sb.channel('ig-inbox')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ig_conversaciones' },
      ({ new: fila }) => {
        if (!conversaciones.some(c => c.id === fila.id)) conversaciones.push(fila);
        renderLista();
      })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ig_conversaciones' },
      ({ new: fila }) => {
        const i = conversaciones.findIndex(c => c.id === fila.id);
        if (i === -1) conversaciones.push(fila); else conversaciones[i] = fila;
        renderLista();
        if (fila.id === abiertaId) {
          renderHiloHead();
          renderVentana();
          if (fila.no_leidos > 0) marcarLeida(fila.id);
        }
      })
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ig_mensajes' },
      ({ new: fila }) => {
        if (fila.conversacion_id !== abiertaId || mensajes.some(m => m.id === fila.id)) return;
        mensajes.push(fila);
        mensajes.sort((a, b) => new Date(a.enviado_en) - new Date(b.enviado_en));
        renderMensajes();
      })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'ig_mensajes' },
      ({ new: fila }) => {
        const i = mensajes.findIndex(m => m.id === fila.id);
        if (i === -1) return;
        mensajes[i] = fila;
        renderMensajes();
      })
    .subscribe();
}

/* Imágenes que no cargan (URLs de Meta vencidas). 'error' no burbujea,
   por eso se escucha en fase de captura sobre toda la bandeja. */
function initFallbackImagenes() {
  document.getElementById('ig-inbox').addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;

    if (img.hasAttribute('data-adjunto')) {
      const link = img.closest('a');
      const aviso = document.createElement('span');
      aviso.className = 'ig-adj-vencido';
      aviso.textContent = 'Adjunto vencido o no disponible — ver en Instagram';
      (link || img).replaceWith(aviso);
    } else {
      img.remove(); // avatar: queda la inicial
    }
  }, true);
}

/* ================================================================
   LOGOUT
   ================================================================ */
async function doLogout() {
  const { error } = await sb.auth.signOut();
  if (error) console.error('[LOGOUT ERROR]', error);
  window.location.href = 'login.html';
}

/* ================================================================
   INIT / GUARDIA DE AUTENTICACIÓN — solo admin, sin modo invitado
   ================================================================ */
async function startApp() {
  document.getElementById('app').dataset.role = 'admin'; // página admin-only
  document.getElementById('app').style.display = 'flex';

  renderTopbar('mensajes');
  renderFooter();
  initAlertasPedidos('admin');
  initTheme();
  initCarritoUI();

  const badge = document.getElementById('role-badge');
  if (badge) { badge.textContent = 'Admin'; badge.className = 'role-badge admin'; }

  initFallbackImagenes();
  suscribirRealtime();
  revisarToken();

  await cargarConversaciones();

  const inicial = new URLSearchParams(location.search).get('c');
  if (inicial) abrirConversacion(inicial, { actualizarUrl: false });

  // La ventana de 24 h se va cerrando sola con el tiempo.
  setInterval(() => { renderVentana(); }, 60 * 1000);

  // Al volver a la pestaña, marcar como leído lo que llegó mientras tanto.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && abiertaId) marcarLeida(abiertaId);
  });
}

async function init() {
  const { data: { session } } = await sb.auth.getSession();

  if (session?.user && await esAdmin(session.user.email)) {
    await startApp();

    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') window.location.href = 'login.html';
    });
    return;
  }

  window.location.href = 'login.html';
}

// ── Exponer funciones globales para los onclick del HTML ──────
window.toggleTheme           = toggleTheme;
window.doLogout              = doLogout;
window.renderListaUI         = renderLista;
window.abrirConversacionUI   = (id) => abrirConversacion(id);
window.cerrarConversacionUI  = cerrarConversacion;
window.enviarUI              = enviar;
window.sincronizarUI         = sincronizar;
window.teclaComposerUI       = teclaComposer;
window.autoAlturaUI          = autoAltura;

init();
