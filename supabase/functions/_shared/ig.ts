// ================================================================
// _shared/ig.ts — Código común de las Edge Functions de Instagram
// (ig-webhook, ig-send, ig-sync, ig-refresh). Ver INSTAGRAM.md.
//
// Usa "Instagram API with Instagram Login" (graph.instagram.com). El
// token de acceso NO es un secret de la función: vive en la tabla
// ig_config porque vence a los 60 días y ig-refresh lo reescribe.
// ================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

// Si Meta deja de aceptar esta versión, alcanza con subirla acá.
export const GRAPH_VERSION = "v25.0";
export const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;

export const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Service role: saltea RLS. SUPABASE_SERVICE_ROLE_KEY la inyecta
// Supabase sola; SB_SECRET_KEY es por si el proyecto tiene las claves
// "legacy" desactivadas y hay que pasarle una secret key nueva (sb_secret_…)
// a mano con `supabase secrets set SB_SECRET_KEY=...`.
export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/* Verifica que quien llama sea un admin de SoleMio (tabla `admins`, el
   mismo criterio que esAdmin() en js/supabase-client.js). Devuelve el
   email, o un Response de error listo para devolver. Se valida acá y no
   con verify_jwt del gateway para que funcione igual con las claves JWT
   nuevas o las legacy. */
export async function requireAdmin(req: Request): Promise<string | Response> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Falta iniciar sesión" }, 401);

  const { data, error } = await db.auth.getUser(jwt);
  const email = data?.user?.email;
  if (error || !email) return json({ error: "Sesión inválida o vencida" }, 401);

  const { data: fila } = await db.from("admins").select("email").eq("email", email).maybeSingle();
  if (!fila) return json({ error: "No autorizado" }, 403);

  return email;
}

export async function getToken(): Promise<string> {
  const { data, error } = await db
    .from("ig_config")
    .select("valor")
    .eq("clave", "access_token")
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer ig_config: ${error.message}`);
  if (!data?.valor) throw new Error("No hay token de Instagram cargado en ig_config (ver INSTAGRAM.md)");
  return data.valor;
}

export class GraphError extends Error {
  constructor(message: string, public status: number, public detalle: unknown) {
    super(message);
  }
}

/* Llamada a la Graph API de Instagram. `path` puede ser relativo
   ("/me/messages") o una URL completa (los links "next" de paginación,
   que ya traen el access_token). */
export async function graph(
  path: string,
  opts: { method?: "GET" | "POST"; params?: Record<string, string>; body?: unknown } = {},
): Promise<any> {
  const url = new URL(path.startsWith("http") ? path : GRAPH + path);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", await getToken());
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new GraphError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data?.error ?? data);
  }
  return data;
}

export type Adjunto = { tipo: string; url: string | null };

export type MensajeNuevo = {
  igsid: string;          // el CLIENTE (nunca nuestra cuenta)
  mid: string;
  direccion: "entrante" | "saliente";
  texto: string | null;
  adjuntos: Adjunto[];
  respuesta_a: string | null;
  es_eco: boolean;
  enviado_por: string | null;
  enviado_en: Date;
  sumar_no_leido?: boolean;
};

/* Inserta un mensaje vía ig_registrar_mensaje (ver
   sql/2026-09-16_instagram_inbox.sql): crea la conversación si hace
   falta, ignora duplicados y actualiza contadores. */
export async function registrarMensaje(m: MensajeNuevo): Promise<{ conversacion_id: string; insertado: boolean }> {
  const { data, error } = await db.rpc("ig_registrar_mensaje", {
    p_igsid: m.igsid,
    p_mid: m.mid,
    p_direccion: m.direccion,
    p_texto: m.texto,
    p_adjuntos: m.adjuntos,
    p_respuesta_a: m.respuesta_a,
    p_es_eco: m.es_eco,
    p_enviado_por: m.enviado_por,
    p_enviado_en: m.enviado_en.toISOString(),
    p_sumar_no_leido: m.sumar_no_leido ?? true,
  });
  if (error) throw new Error(`ig_registrar_mensaje: ${error.message}`);
  return data;
}

const DOS_DIAS_MS = 2 * 24 * 60 * 60 * 1000;

/* Trae nombre/usuario/foto del cliente si todavía no los tenemos o si
   tienen más de 2 días (la foto es una URL que vence). Best-effort: si
   falla (ej. el cliente bloqueó la cuenta) se loguea y sigue. */
export async function actualizarPerfilSiHaceFalta(igsid: string, forzar = false): Promise<void> {
  try {
    const { data: conv } = await db
      .from("ig_conversaciones")
      .select("perfil_actualizado_en")
      .eq("igsid", igsid)
      .maybeSingle();

    const ultima = conv?.perfil_actualizado_en ? new Date(conv.perfil_actualizado_en).getTime() : 0;
    if (!forzar && Date.now() - ultima < DOS_DIAS_MS) return;

    const perfil = await graph(`/${igsid}`, { params: { fields: "name,username,profile_pic" } });
    await db.from("ig_conversaciones").update({
      nombre: perfil.name ?? null,
      username: perfil.username ?? null,
      foto_url: perfil.profile_pic ?? null,
      perfil_actualizado_en: new Date().toISOString(),
    }).eq("igsid", igsid);
  } catch (err) {
    console.warn(`No se pudo actualizar el perfil de ${igsid}:`, err instanceof Error ? err.message : err);
  }
}

/* Deja correr una promesa después de responder (EdgeRuntime.waitUntil),
   así el webhook le contesta rápido a Meta. */
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
export function enSegundoPlano(p: Promise<unknown>): void {
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
  else p.catch((e) => console.warn(e));
}
