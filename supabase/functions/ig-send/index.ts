// ================================================================
// ig-send — Manda una respuesta de texto a un cliente de Instagram
// desde el panel (mensajes.html). Solo admins.
//
// Body: { conversacion_id: uuid, texto: string }
// Respuestas: 200 { ok, mid } · 400 datos inválidos · 401/403 sin
// permiso · 404 conversación inexistente · 409 ventana de 24 h cerrada
// · 502 Instagram rechazó el envío.
// ================================================================
import { cors, db, GraphError, graph, json, registrarMensaje, requireAdmin } from "../_shared/ig.ts";

const VENTANA_MS = 24 * 60 * 60 * 1000;
const MAX_CARACTERES = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const email = await requireAdmin(req);
  if (email instanceof Response) return email;

  let body: { conversacion_id?: string; texto?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body inválido" }, 400);
  }

  const texto = (body.texto ?? "").trim();
  if (!body.conversacion_id || !texto) return json({ error: "Falta la conversación o el texto" }, 400);
  if (texto.length > MAX_CARACTERES) {
    return json({ error: `El mensaje supera los ${MAX_CARACTERES} caracteres que permite Instagram` }, 400);
  }

  const { data: conv, error } = await db
    .from("ig_conversaciones")
    .select("igsid, ultimo_entrante_en")
    .eq("id", body.conversacion_id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!conv) return json({ error: "La conversación no existe" }, 404);

  const ultimo = conv.ultimo_entrante_en ? new Date(conv.ultimo_entrante_en).getTime() : 0;
  if (Date.now() - ultimo > VENTANA_MS) {
    return json({
      error: "Pasaron más de 24 h desde el último mensaje del cliente: Instagram no deja responder desde acá. Contestale desde la app de Instagram.",
      codigo: "ventana_cerrada",
    }, 409);
  }

  let respuesta: { message_id?: string };
  try {
    respuesta = await graph("/me/messages", {
      method: "POST",
      body: { recipient: { id: conv.igsid }, message: { text: texto } },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Instagram rechazó el envío:", msg, err instanceof GraphError ? JSON.stringify(err.detalle) : "");
    return json({ error: `Instagram rechazó el envío: ${msg}` }, 502);
  }

  const mid = respuesta.message_id;
  if (mid) {
    try {
      await registrarMensaje({
        igsid: conv.igsid,
        mid,
        direccion: "saliente",
        texto,
        adjuntos: [],
        respuesta_a: null,
        es_eco: false,
        enviado_por: email,
        enviado_en: new Date(),
        sumar_no_leido: false,
      });
    } catch (err) {
      // El mensaje YA salió: no devolver error (el admin lo reenviaría
      // duplicado). El eco del webhook lo va a terminar guardando igual.
      console.error("Enviado pero no se pudo guardar:", err instanceof Error ? err.message : err);
    }
  }

  return json({ ok: true, mid: mid ?? null });
});
