/* ================================================================
   supabase-client.js — Cliente Supabase compartido (singleton)
   Usado por login.js y catalogo.js. Evita crear múltiples
   instancias de GoTrueClient en la misma pestaña.
   ================================================================ */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL      = 'https://pktwpktmxbfapwjsugrx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Z2czITrIU3Y32ZLEjno9uw_oS2gGe6f';

export const sb = (() => {
  const KEY = '__solemio_sb__';
  if (window[KEY]) return window[KEY];
  window[KEY] = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storageKey:       'solemio-auth',
      autoRefreshToken: true,
      persistSession:   true,
    },
  });
  return window[KEY];
})();

/* Verifica si un email corresponde a un admin registrado en la tabla `admins` */
export async function esAdmin(email) {
  const { data, error } = await sb
    .from('admins')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  return !error && !!data;
}

/* Navega al catálogo: si ya hay una sesión de admin válida, entra como
   admin (sin tocar el rol invitado ni forzar el filtro de stock).
   Si no, entra como invitado. Usado desde los links "Catálogo" del
   sitio público (landing, contacto). */
export async function irAlCatalogo() {
  const { data: { session } } = await sb.auth.getSession();

  if (session?.user && await esAdmin(session.user.email)) {
    window.location.href = 'catalogo.html';
    return;
  }

  sessionStorage.setItem('solemio-role', 'guest');
  window.location.href = 'catalogo.html?stock=in';
}

/* Va al catálogo respetando la sesión activa: si ya sos admin, entra
   directo al catálogo de admin; si no, entra como invitado. Se usa
   desde el botón/link "Catálogo" en landing, contacto y login. */
export async function irACatalogo() {
  const { data: { session } } = await sb.auth.getSession();

  if (session?.user && await esAdmin(session.user.email)) {
    sessionStorage.removeItem('solemio-role');
    window.location.href = 'catalogo.html';
    return;
  }

  sessionStorage.setItem('solemio-role', 'guest');
  window.location.href = 'catalogo.html?stock=in';
}
