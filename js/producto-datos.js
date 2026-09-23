/* ================================================================
   producto-datos.js — Datos de un producto derivados de su fila de
   Supabase (foto, rango de talles, precio al público) y la info SEO
   de su ficha (título, descripción, URL, datos para Google).

   Sin dependencias del navegador ni de Supabase: lo usan tanto el
   sitio (producto.js, tarjeta-producto.js) como el Worker de Cloudflare
   (worker/index.js), que arma la vista previa de los links de producto
   para WhatsApp/Instagram antes de mandar la página. Así las dos
   versiones nunca dicen cosas distintas.
   ================================================================ */
import { nombreLegible, marcaLegible } from './texto.js';

export const SITIO = 'https://solemiotandil.com.ar';

export function resolverImagen(p) {
  return p.imagen_custom || p.imagen_scraper || p.imagen || '';
}

/* Precio al público: productos.precio es el costo, se muestra * 1.5 */
export function precioCliente(p) {
  return Math.round((p.precio || 0) * 1.5);
}

const ORDEN_LETRAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];

/* "100, 105, 110, 85, 90, 95" → "Talles 85 al 110". Con letras
   (S, M, L…) usa el mismo orden de siempre; si hay mezcla o un talle
   raro, muestra los primeros tres. */
export function resumenTalles(talles) {
  const lista = String(talles || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!lista.length) return '';
  if (lista.length === 1) return `Talle ${lista[0]}`;

  const numeros = lista.map(Number);
  if (numeros.every(n => Number.isFinite(n))) {
    return `Talles ${Math.min(...numeros)} al ${Math.max(...numeros)}`;
  }

  const posiciones = lista.map(t => ORDEN_LETRAS.indexOf(t.toUpperCase()));
  if (posiciones.every(i => i >= 0)) {
    const orden = [...lista].sort((a, b) =>
      ORDEN_LETRAS.indexOf(a.toUpperCase()) - ORDEN_LETRAS.indexOf(b.toUpperCase()));
    return lista.length <= 3
      ? `Talles ${orden.join(', ')}`
      : `Talles ${orden[0]} al ${orden[orden.length - 1]}`;
  }

  return `Talles ${lista.slice(0, 3).join(', ')}${lista.length > 3 ? '…' : ''}`;
}

/* Todo lo que va en el <head> de la ficha de un producto */
export function datosSEOProducto(p) {
  const nombre = nombreLegible(p.nombre, p.marca);
  const marca  = marcaLegible(p.marca);
  const talles = resumenTalles(p.talles);
  const precio = precioCliente(p);
  const url    = `${SITIO}/producto?id=${encodeURIComponent(p.id)}`;
  const imagen = resolverImagen(p);

  // Ej: "Corpiño reductor, talles 85 al 120 | SoleMio Tandil"
  const titulo = `${nombre}${talles ? `, ${talles.toLowerCase()}` : ''} | SoleMio Tandil`;

  const descripcion = [
    `${nombre}${marca && !nombre.includes(marca) ? ` de ${marca}` : ''}`,
    talles,
    precio ? `$${precio.toLocaleString('es-AR')}` : '',
  ].filter(Boolean).join(' · ')
    + `. Código ${p.id}. Lencería y corsetería en Tandil, consultas por WhatsApp.`;

  // Datos del producto para Google (precio, marca, disponibilidad, foto)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: nombre,
    sku: p.id,
    url,
    ...(imagen ? { image: [imagen] } : {}),
    ...(marca ? { brand: { '@type': 'Brand', name: marca } } : {}),
    description: descripcion,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'ARS',
      price: precio,
      availability: p.disponible ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: 'SoleMio', '@id': `${SITIO}/#tienda` },
    },
  };

  return { nombre, titulo, descripcion, url, imagen, precio, jsonLd };
}
