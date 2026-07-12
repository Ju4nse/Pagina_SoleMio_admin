/* ================================================================
   login.js — Autenticación (Supabase Auth + modo invitado)
   Backend propio de la pantalla de login.
   ================================================================ */
import { sb, esAdmin } from './supabase-client.js';
import { initTheme }   from './theme.js';

const GUEST_PASS = 'solemio';

/* ── RATE LIMITING — máx 5 intentos fallidos, bloqueo 5 min ──── */
const RATE = {
  MAX_INTENTOS:  5,
  BLOQUEO_MS:    5 * 60 * 1000,
  KEY_INTENTOS:  'solemio-login-intentos',
  KEY_BLOQUEADO: 'solemio-login-bloqueado',
};

function loginBloqueado() {
  const hasta = parseInt(localStorage.getItem(RATE.KEY_BLOQUEADO) || '0');
  if (Date.now() < hasta) return Math.ceil((hasta - Date.now()) / 60000);
  return 0;
}

function registrarIntentoFallido() {
  const intentos = parseInt(localStorage.getItem(RATE.KEY_INTENTOS) || '0') + 1;
  localStorage.setItem(RATE.KEY_INTENTOS, intentos);
  if (intentos >= RATE.MAX_INTENTOS) {
    localStorage.setItem(RATE.KEY_BLOQUEADO, Date.now() + RATE.BLOQUEO_MS);
    localStorage.removeItem(RATE.KEY_INTENTOS);
    return -1;
  }
  return RATE.MAX_INTENTOS - intentos;
}

function resetearIntentos() {
  localStorage.removeItem(RATE.KEY_INTENTOS);
  localStorage.removeItem(RATE.KEY_BLOQUEADO);
}

/* ── LOGIN ─────────────────────────────────────────────────────── */

async function doLogin() {
  const errEl = document.getElementById('login-error');
  const btnEl = document.querySelector('.login-btn');

  const minsBloqueado = loginBloqueado();
  if (minsBloqueado > 0) {
    errEl.textContent = `Demasiados intentos. Esperá ${minsBloqueado} min.`;
    return;
  }

  const user = document.getElementById('login-user').value.trim().slice(0, 128);
  const pass = document.getElementById('login-pass').value.slice(0, 128);

  if (!user || !pass) { errEl.textContent = 'Completá usuario y contraseña'; return; }

  errEl.textContent = '';
  btnEl.disabled    = true;
  btnEl.textContent = 'Verificando…';

  // ── Modo invitado ──────────────────────────────────────────
  if (user.toLowerCase() === 'invitado' && pass === GUEST_PASS) {
    resetearIntentos();
    sessionStorage.setItem('solemio-role', 'guest');
    window.location.href = 'catalogo.html';
    return;
  }

  // ── Admin: Supabase Auth ───────────────────────────────────
  const { error } = await sb.auth.signInWithPassword({ email: user, password: pass });

  if (error) {
    const restantes = registrarIntentoFallido();
    if (restantes === -1) {
      errEl.textContent = 'Demasiados intentos. Cuenta bloqueada 5 minutos.';
    } else {
      errEl.textContent = `Usuario o contraseña incorrectos (${restantes} intento${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''})`;
    }
    errEl.style.animation = 'none';
    errEl.offsetHeight;
    errEl.style.animation = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
    btnEl.disabled    = false;
    btnEl.textContent = 'Ingresar';
    return;
  }

  // Verificar que el email esté autorizado en la tabla `admins`
  const { data: { session } } = await sb.auth.getSession();
  const autorizado = session?.user?.email ? await esAdmin(session.user.email) : false;

  if (!autorizado) {
    await sb.auth.signOut();
    errEl.textContent = 'Usuario no autorizado como administrador';
    btnEl.disabled    = false;
    btnEl.textContent = 'Ingresar';
    return;
  }

  resetearIntentos();
  sessionStorage.setItem('solemio-role', 'admin');
  window.location.href = 'catalogo.html';
}

async function doGuestLogin() {
  sessionStorage.setItem('solemio-role', 'guest');
  window.location.href = 'catalogo.html?stock=in';
}

function togglePass() {
  const input = document.getElementById('login-pass');
  input.type  = input.type === 'password' ? 'text' : 'password';
}

/* ── INIT ──────────────────────────────────────────────────────── */

async function init() {
  initTheme();

  // Si ya hay una sesión de admin válida, saltear el login
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user && await esAdmin(session.user.email)) {
    sessionStorage.setItem('solemio-role', 'admin');
    window.location.href = 'catalogo.html';
  }
}

// ── Exponer funciones globales para los onclick del HTML ──────
window.doLogin      = doLogin;
window.doGuestLogin = doGuestLogin;
window.togglePass   = togglePass;

init();
