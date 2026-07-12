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
