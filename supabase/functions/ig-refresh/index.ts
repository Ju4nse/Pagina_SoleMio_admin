// ================================================================
// ig-refresh — Renueva el token de Instagram (dura 60 días). La llama
// el cron semanal de sql/2026-09-16b_instagram_refresh_cron.sql con el
// header x-cron-secret. Pública a nivel gateway (verify_jwt = false),
// protegida por ese secret.
// ================================================================
import { db, getToken, json } from "../_shared/ig.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "No autorizado" }, 401);
  }

  try {
    const actual = await getToken();
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", actual);

    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      console.error("No se pudo renovar el token:", msg);
      return json({ error: msg }, 502);
    }

    const { error } = await db.from("ig_config").upsert({
      clave: "access_token",
      valor: data.access_token,
      actualizado_en: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    const dias = Math.round((data.expires_in ?? 0) / 86400);
    console.log(`Token renovado, vence en ~${dias} días`);
    return json({ ok: true, vence_en_dias: dias });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error renovando token:", msg);
    return json({ error: msg }, 500);
  }
});
