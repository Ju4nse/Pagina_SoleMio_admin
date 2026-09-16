// ================================================================
// ig-sync — Trae conversaciones que ya existían en Instagram antes de
// conectar el webhook (o que se perdieron). Solo admins; lo dispara el
// botón "Sincronizar" de mensajes.html.
//
// Procesa de a POR_PAGINA conversaciones por llamada y devuelve un
// cursor: el panel la va llamando en loop hasta que el cursor vuelva
// null. Así cada llamada queda corta (límite de tiempo de las Edge
// Functions y rate limit de Meta).
//
// Límite de Meta: de cada conversación solo se pueden leer los últimos
// 20 mensajes, y sin adjuntos (el texto sí). Lo que entra de ahora en
// más por webhook llega completo.
//
// Body: { cursor?: string }
// Respuesta: { conversaciones, mensajes_nuevos, cursor: string | null }
// ================================================================
import {
  actualizarPerfilSiHaceFalta,
  cors,
  db,
  graph,
  json,
  registrarMensaje,
  requireAdmin,
} from "../_shared/ig.ts";

const POR_PAGINA = 5;
const PARALELO = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const email = await requireAdmin(req);
  if (email instanceof Response) return email;

  let cursor: string | undefined;
  try {
    cursor = (await req.json())?.cursor || undefined;
  } catch { /* body vacío = primera página */ }

  try {
    // Nuestros propios ids, para distinguir al cliente entre los participantes.
    const yo = await graph("/me", { params: { fields: "user_id,username" } });
    const propios = new Set([String(yo.id ?? ""), String(yo.user_id ?? "")].filter(Boolean));
    const esPropio = (p: { id?: string; username?: string }) =>
      propios.has(String(p?.id ?? "")) || (!!yo.username && p?.username === yo.username);

    const params: Record<string, string> = {
      platform: "instagram",
      fields: "id,updated_time,participants",
      limit: String(POR_PAGINA),
    };
    if (cursor) params.after = cursor;
    const pagina = await graph("/me/conversations", { params });

    let mensajesNuevos = 0;
    let conversaciones = 0;

    for (const conv of pagina.data ?? []) {
      const cliente = (conv.participants?.data ?? []).find((p: any) => !esPropio(p));
      if (!cliente?.id) continue;
      conversaciones++;

      const detalle = await graph(`/${conv.id}`, { params: { fields: "messages" } });
      const ids: string[] = (detalle.messages?.data ?? []).map((m: any) => m.id).filter(Boolean);

      const mensajes = await enTandas(ids, PARALELO, (id) =>
        graph(`/${id}`, { params: { fields: "id,created_time,from,to,message" } })
          .catch((err) => {
            // Meta da error para mensajes viejos (fuera de los últimos 20): se saltean.
            console.warn(`No se pudo leer el mensaje ${id}:`, err instanceof Error ? err.message : err);
            return null;
          })
      );

      for (const m of mensajes) {
        if (!m?.id) continue;
        const entrante = String(m.from?.id ?? "") === String(cliente.id)
          || (!!cliente.username && m.from?.username === cliente.username);
        const { insertado } = await registrarMensaje({
          igsid: String(cliente.id),
          mid: m.id,
          direccion: entrante ? "entrante" : "saliente",
          texto: m.message || "(Adjunto — ver en Instagram)",
          adjuntos: [],
          respuesta_a: null,
          es_eco: false,
          enviado_por: null,
          enviado_en: m.created_time ? new Date(m.created_time) : new Date(),
          sumar_no_leido: false, // lo viejo no cuenta como "sin leer"
        });
        if (insertado) mensajesNuevos++;
      }

      if (cliente.username) {
        await db.from("ig_conversaciones")
          .update({ username: cliente.username })
          .eq("igsid", String(cliente.id))
          .is("username", null);
      }
      await actualizarPerfilSiHaceFalta(String(cliente.id));
    }

    const siguiente = pagina.paging?.next ? (pagina.paging?.cursors?.after ?? null) : null;
    console.log(`Sync por ${email}: ${conversaciones} conversaciones, ${mensajesNuevos} mensajes nuevos`);
    return json({ conversaciones, mensajes_nuevos: mensajesNuevos, cursor: siguiente });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error sincronizando:", msg);
    return json({ error: `No se pudo sincronizar: ${msg}` }, 502);
  }
});

async function enTandas<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  }
  return out;
}
