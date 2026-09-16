// ================================================================
// ig-webhook — Recibe los mensajes de Instagram que manda Meta.
// Pública (verify_jwt = false): Meta no manda JWT de Supabase. La
// seguridad es la firma X-Hub-Signature-256 (HMAC con el app secret).
//
//   GET  → handshake de verificación al configurar el webhook en Meta.
//   POST → eventos: mensajes nuevos, ecos (lo que respondemos desde la
//          app de IG o desde el panel) y mensajes borrados.
//
// Siempre responde 200 una vez validada la firma, aunque falle algo
// adentro (se loguea): si no, Meta reintenta durante ~36 h y, si falla
// mucho, desactiva el webhook.
// ================================================================
import {
  actualizarPerfilSiHaceFalta,
  type Adjunto,
  db,
  enSegundoPlano,
  registrarMensaje,
} from "../_shared/ig.ts";

const VERIFY_TOKEN = Deno.env.get("IG_VERIFY_TOKEN") ?? "";

// Con "Instagram API with Instagram Login" la firma puede venir con el
// "Instagram app secret" (pantalla de configuración de Instagram) o con
// el app secret general de la app de Meta, según cómo esté armada. Se
// aceptan los dos para no depender de eso; el log dice cuál coincidió.
const SECRETOS: [string, string][] = [
  ["IG_APP_SECRET", Deno.env.get("IG_APP_SECRET") ?? ""],
  ["META_APP_SECRET", Deno.env.get("META_APP_SECRET") ?? ""],
].filter(([, v]) => v) as [string, string][];

Deno.serve(async (req) => {
  if (req.method === "GET") return handshake(req);
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text(); // la firma es sobre el body CRUDO, antes de parsear
  const firma = req.headers.get("X-Hub-Signature-256") ?? "";
  const valida = await firmaValida(raw, firma);
  if (!valida) {
    console.warn("Webhook con firma inválida — descartado");
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const payload = JSON.parse(raw);
    await procesar(payload);
  } catch (err) {
    console.error("Error procesando webhook:", err instanceof Error ? err.message : err, raw.slice(0, 2000));
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
});

function handshake(req: Request): Response {
  const u = new URL(req.url);
  const modo = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge") ?? "";

  if (modo === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

async function firmaValida(raw: string, header: string): Promise<boolean> {
  const recibida = header.replace(/^sha256=/, "").toLowerCase();
  if (!recibida || SECRETOS.length === 0) return false;

  for (const [nombre, secreto] of SECRETOS) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secreto),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
    const esperada = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
    if (igualesTiempoConstante(esperada, recibida)) {
      if (SECRETOS.length > 1) console.log(`Firma válida con ${nombre}`);
      return true;
    }
  }
  return false;
}

function igualesTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Un evento de mensajería, venga en entry.messaging[] (formato real) o
   en entry.changes[].value (formato del botón "Test" del dashboard). */
type Evento = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number | string;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_self?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
    reply_to?: { mid?: string; story?: { url?: string; id?: string } };
  };
};

async function procesar(payload: any): Promise<void> {
  if (payload?.object && payload.object !== "instagram") {
    console.warn(`Webhook de objeto inesperado: ${payload.object}`);
    return;
  }

  for (const entry of payload?.entry ?? []) {
    const cuentaId = String(entry?.id ?? "");
    const eventos: Evento[] = [
      ...(entry?.messaging ?? []),
      ...(entry?.changes ?? [])
        .filter((c: any) => c?.field === "messages" || c?.field === "message_echoes")
        .map((c: any) => c.value),
    ];

    for (const ev of eventos) {
      try {
        await procesarEvento(ev, cuentaId);
      } catch (err) {
        console.error("Error en evento:", err instanceof Error ? err.message : err, JSON.stringify(ev).slice(0, 1000));
      }
    }
  }
}

async function procesarEvento(ev: Evento, cuentaId: string): Promise<void> {
  const msg = ev.message;
  if (!msg?.mid) return; // reacciones, "visto", postbacks, etc.: no se guardan

  if (msg.is_deleted) {
    await db.from("ig_mensajes").update({ eliminado: true }).eq("mid", msg.mid);
    return;
  }

  // Eco = lo mandó nuestra cuenta (desde la app de IG o desde el panel).
  const saliente = !!msg.is_echo || (!!cuentaId && ev.sender?.id === cuentaId);
  const igsid = saliente ? ev.recipient?.id : ev.sender?.id;
  if (!igsid) return;

  const { conversacion_id, insertado } = await registrarMensaje({
    igsid,
    mid: msg.mid,
    direccion: saliente ? "saliente" : "entrante",
    texto: msg.text ?? (msg.is_unsupported ? "(Mensaje no compatible — ver en Instagram)" : null),
    adjuntos: adjuntosDe(msg),
    respuesta_a: msg.reply_to?.mid ?? null,
    es_eco: saliente,
    enviado_por: null,
    enviado_en: fechaDe(ev.timestamp),
  });

  if (insertado) console.log(`Mensaje ${saliente ? "saliente" : "entrante"} guardado en ${conversacion_id}`);

  enSegundoPlano(actualizarPerfilSiHaceFalta(igsid));
}

function adjuntosDe(msg: NonNullable<Evento["message"]>): Adjunto[] {
  const lista: Adjunto[] = (msg.attachments ?? []).map((a) => ({
    tipo: a.type ?? "archivo",
    url: a.payload?.url ?? null,
  }));
  if (msg.reply_to?.story) {
    lista.unshift({ tipo: "respuesta_historia", url: msg.reply_to.story.url ?? null });
  }
  return lista;
}

function fechaDe(ts: number | string | undefined): Date {
  const n = Number(ts);
  if (!n) return new Date();
  return new Date(n < 1e12 ? n * 1000 : n); // algunos payloads de prueba vienen en segundos
}
