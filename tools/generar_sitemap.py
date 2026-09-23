"""
generar_sitemap.py — Arma sitemap.xml con las páginas del sitio y una
entrada por cada producto que ve una clienta (disponible y no eliminado).

Correrlo desde la raíz del repo cada tanto (por ejemplo, después de
cargar o sacar productos) y subir el sitemap.xml que genera:

    python tools/generar_sitemap.py

Solo lee con la clave pública (la misma de js/supabase-client.js), no
necesita nada más. La carpeta tools/ no se publica (ver .assetsignore).
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

SITIO = 'https://solemiotandil.com.ar'
SUPABASE_URL = 'https://pktwpktmxbfapwjsugrx.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_Z2czITrIU3Y32ZLEjno9uw_oS2gGe6f'

# Direcciones tal como las sirve Cloudflare (sin ".html", que redirige)
PAGINAS = [
    ('/',          'weekly',  '1.0'),
    ('/catalogo',  'daily',   '0.9'),
    ('/contacto',  'monthly', '0.5'),
    ('/terminos',  'yearly',  '0.2'),
]


def productos_visibles():
    ids, desde, pagina = [], 0, 1000
    while True:
        consulta = urllib.parse.urlencode({
            'select': 'id',
            'disponible': 'eq.true',
            'eliminado': 'eq.false',
            'order': 'id.asc',
        })
        req = urllib.request.Request(
            f'{SUPABASE_URL}/rest/v1/productos?{consulta}',
            headers={
                'apikey': SUPABASE_ANON_KEY,
                'Range': f'{desde}-{desde + pagina - 1}',
            },
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            filas = json.load(r)
        ids += [f['id'] for f in filas]
        if len(filas) < pagina:
            return ids
        desde += pagina


def url_xml(loc, changefreq=None, priority=None):
    loc = loc.replace('&', '&amp;')
    partes = [f'    <loc>{loc}</loc>']
    if changefreq:
        partes.append(f'    <changefreq>{changefreq}</changefreq>')
    if priority:
        partes.append(f'    <priority>{priority}</priority>')
    return '  <url>\n' + '\n'.join(partes) + '\n  </url>'


def main():
    ids = productos_visibles()
    entradas = [url_xml(SITIO + ruta, freq, prio) for ruta, freq, prio in PAGINAS]
    entradas += [
        url_xml(f'{SITIO}/producto?id={urllib.parse.quote(pid, safe="")}', 'weekly', '0.6')
        for pid in ids
    ]
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + '\n'.join(entradas)
        + '\n</urlset>\n'
    )
    destino = Path(__file__).resolve().parent.parent / 'sitemap.xml'
    destino.write_text(xml, encoding='utf-8', newline='\n')
    print(f'sitemap.xml: {len(PAGINAS)} páginas + {len(ids)} productos')


if __name__ == '__main__':
    main()
