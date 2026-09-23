/* ================================================================
   worker/index.js — Worker de Cloudflare que completa el <head> de las
   fichas de producto (producto.html?id=…) antes de mandarlas.

   Por qué: la ficha se arma con JavaScript en el navegador, pero la
   vista previa de un link en WhatsApp, Instagram o Facebook la arma un
   robot que NO ejecuta JavaScript — sin esto, cualquier producto
   compartido se veía con el logo y "SoleMio — Producto". Acá se buscan
   los datos del producto en Supabase y se ponen en el HTML: título,
   descripción, foto, precio, canonical y datos para Google.

   Solo corre para /producto y /producto.html (ver run_worker_first en
   wrangler.jsonc); el resto del sitio se sirve directo, como siempre.
   Si Supabase falla o tarda, la página sale igual que antes (con la
   vista previa genérica): el Worker nunca rompe la ficha.
   ================================================================ */
import { datosSEOProducto } from '../js/producto-datos.js';

// Misma clave pública que js/supabase-client.js (solo lectura, con RLS)
const SUPABASE_URL      = 'https://pktwpktmxbfapwjsugrx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Z2czITrIU3Y32ZLEjno9uw_oS2gGe6f';

// (no hay columna "imagen": ese campo lo agrega el catálogo en el navegador)
const CAMPOS = 'id,nombre,marca,precio,talles,imagen_custom,imagen_scraper,disponible';

async function buscarProducto(id) {
  const consulta = new URLSearchParams({
    select:     CAMPOS,
    id:         `eq.${id}`,
    eliminado:  'eq.false',
    disponible: 'eq.true', // lo que no ve una clienta no se anuncia
    limit:      '1',
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/productos?${consulta}`, {
    headers: { apikey: SUPABASE_ANON_KEY },
    signal:  AbortSignal.timeout(2500),
    // Cachea la respuesta 5 minutos en Cloudflare: compartir un link en
    // un grupo dispara varias visitas seguidas al mismo producto.
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}`);
  const filas = await res.json();
  return filas[0] || null;
}

function escAttr(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* Pone `contenido` en el atributo content de la etiqueta */
class PisarContenido {
  constructor(contenido) { this.contenido = contenido; }
  element(el) { el.setAttribute('content', this.contenido); }
}

export default {
  async fetch(request, env) {
    const respuesta = await env.ASSETS.fetch(request);

    const url = new URL(request.url);
    const id  = url.searchParams.get('id');
    const esHtml = (respuesta.headers.get('content-type') || '').includes('text/html');
    // /producto.html responde con una redirección a /producto: esa pasa tal cual
    if (!/^\/producto(\.html)?$/.test(url.pathname) || !id || respuesta.status !== 200 || !esHtml) {
      return respuesta;
    }

    let producto = null;
    try {
      producto = await buscarProducto(id);
    } catch (err) {
      console.warn('No se pudo buscar el producto para la vista previa:', id, err.message);
    }
    if (!producto) return respuesta;

    const seo = datosSEOProducto(producto);
    // "</" dentro del JSON cerraría el <script> antes de tiempo
    const jsonLd = JSON.stringify(seo.jsonLd).replace(/</g, '\\u003c');

    const agregados = `
<link rel="canonical" href="${escAttr(seo.url)}">
<meta property="og:url" content="${escAttr(seo.url)}">
<meta property="og:image:alt" content="${escAttr(seo.nombre)}">
<meta property="product:price:amount" content="${seo.precio}">
<meta property="product:price:currency" content="ARS">
<script type="application/ld+json" id="datos-producto">${jsonLd}</script>
`;

    let reescrita = new HTMLRewriter()
      .on('title', { element(el) { el.setInnerContent(seo.titulo); } })
      .on('meta[name="description"]',        new PisarContenido(seo.descripcion))
      .on('meta[property="og:type"]',        new PisarContenido('product'))
      .on('meta[property="og:title"]',       new PisarContenido(seo.nombre))
      .on('meta[property="og:description"]', new PisarContenido(seo.descripcion))
      .on('meta[name="twitter:title"]',       new PisarContenido(seo.nombre))
      .on('meta[name="twitter:description"]', new PisarContenido(seo.descripcion))
      .on('head', { element(el) { el.append(agregados, { html: true }); } });

    if (seo.imagen) {
      reescrita = reescrita
        .on('meta[property="og:image"]',  new PisarContenido(seo.imagen))
        .on('meta[name="twitter:image"]', new PisarContenido(seo.imagen))
        .on('meta[name="twitter:card"]',  new PisarContenido('summary_large_image'));
    }

    const final = reescrita.transform(respuesta);
    // El ETag es del archivo estático, no de esta versión con los datos
    // del producto: sin sacarlo, el navegador podría quedarse con una
    // vista previa vieja después de un cambio de precio o de foto.
    const headers = new Headers(final.headers);
    headers.delete('etag');
    return new Response(final.body, { status: final.status, headers });
  },
};
