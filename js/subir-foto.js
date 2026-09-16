/* ================================================================
   subir-foto.js — Subida de fotos de productos a Supabase Storage
   (bucket público "fotos-productos", escritura solo admin — ver
   sql/2026-09-16_storage_fotos_productos.sql).

   Antes de subir, achica la foto (lado mayor 1600px, JPEG) para que
   las fotos del celular no pesen varios MB: carga más rápido en el
   catálogo y no llena el espacio gratis de Storage.

   Las fotos se guardan en una carpeta por marca (ej. "lody-lingerie/…jpg"),
   según la marca escrita en el modal al momento de subir.
   ================================================================ */
import { sb } from './supabase-client.js';

const BUCKET   = 'fotos-productos';
const LADO_MAX = 1600;
const CALIDAD  = 0.85;

async function achicarImagen(file) {
  // GIFs se suben tal cual (el canvas perdería la animación)
  if (file.type === 'image/gif') return file;

  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';   // fondo blanco para PNGs con transparencia
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', CALIDAD));
  return blob || file;
}

/* "Lody Lingerie" -> "lody-lingerie". Storage no acepta tildes ni
   ciertos símbolos en las rutas, por eso se normaliza. */
function carpetaDeMarca(marca) {
  const slug = (marca || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'sin-marca';
}

/* Sube un archivo y devuelve su URL pública. Tira error si falla. */
export async function subirFotoProducto(file, marca) {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" no es una imagen`);

  const imagen = await achicarImagen(file);
  const ext    = imagen.type === 'image/gif' ? 'gif' : 'jpg';
  const ruta   = `${carpetaDeMarca(marca)}/${crypto.randomUUID()}.${ext}`;

  const { error } = await sb.storage.from(BUCKET).upload(ruta, imagen, {
    contentType:  imagen.type,
    cacheControl: '31536000',   // el nombre es único, nunca cambia el contenido
  });
  if (error) throw error;

  return sb.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
}
