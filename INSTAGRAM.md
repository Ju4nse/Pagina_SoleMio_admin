# Bandeja de Instagram — puesta en marcha

Cómo conectar los mensajes directos de **@solemio.tandil** con el panel admin (`mensajes.html`).

El código ya está en el repo. Falta la parte que no es código: la app de Meta, desplegar las funciones, cargar los secretos y correr el SQL. **Seguí los pasos en orden.**

---

## Cómo funciona

```
Cliente escribe por IG ─► Meta ─► ig-webhook (Edge Function) ─► tablas ig_* ─► realtime ─► mensajes.html
                                                                                   ▲
Admin responde en mensajes.html ─► ig-send (Edge Function) ─► Instagram API ───────┘ (se guarda y llega el eco)
```

**Edge Functions** (`supabase/functions/`):

| Función | Qué hace |
|---|---|
| `ig-webhook` | Recibe lo que manda Meta y lo guarda. Es pública; la seguridad es la firma HMAC. |
| `ig-send` | Manda respuestas. Solo admins. |
| `ig-sync` | Trae conversaciones anteriores (botón "Sincronizar"). Solo admins. |
| `ig-refresh` | Renueva el token cada semana, llamada por pg_cron. |

**Tablas** (`sql/2026-09-16_instagram_inbox.sql`):

- `ig_conversaciones`
- `ig_mensajes`
- `ig_config`: el token. Nadie lo puede leer desde el navegador.

### Limitaciones de Instagram (no se pueden evitar)

- **Ventana de 24 h:** solo se puede responder por API dentro de las 24 h del último mensaje del cliente. Pasado eso hay que contestar desde la app de Instagram (el panel lo avisa).
- **No se puede iniciar** una conversación desde el panel.
- **Historial:** de las conversaciones anteriores solo se pueden traer los **últimos 20 mensajes**, sin adjuntos.
- **Adjuntos y fotos de perfil** vienen como URLs que **vencen a los pocos días**.
- **Token:** dura 60 días y el cron lo renueva cada semana. Si el panel avisa que no se renueva, revisar el cron o generar uno nuevo (paso 3).

---

## ⚠️ Antes de empezar: la aprobación de Meta

- **Modo desarrollo** alcanza para probar todo, pero **solo con cuentas que tengan rol en la app** (una cuenta de Instagram de prueba).
- **Clientes reales:** hace falta que Meta apruebe la app. Eso es **Business Verification** del negocio más **App Review**, y puede tardar días o semanas. Conviene arrancar la verificación el primer día (paso 1.3).
- **Si Meta no la aprueba**, la alternativa gratis es la bandeja de Meta Business Suite.

---

## 1. Meta (con la dueña, compartiendo pantalla)

La cuenta de Instagram y la página de Facebook son de la dueña, así que estos pasos se hacen con su login.

1. **En la app de Instagram** (celular, cuenta @solemio.tandil):
   - Confirmar que la cuenta sea **profesional**.
   - Ir a Configuración → *Mensajes y respuestas a historias* → *Controles de mensajes* → *Herramientas conectadas* → activar **Permitir acceso a los mensajes**.
2. **Registrarse** en <https://developers.facebook.com> con su Facebook.
3. **En <https://business.facebook.com>:** crear o confirmar el portfolio del negocio e **iniciar la verificación del negocio** (Configuración → Centro de seguridad). Piden razón social, CUIT, dirección y teléfono o dominio.
4. **Crear la app:** developers.facebook.com → *Mis apps* → *Crear app* → caso de uso **"Administrar mensajes y contenido en Instagram"** (*Manage messaging & content on Instagram*) → tipo **Negocio**, vinculada al portfolio del paso 3.
5. **Sumar a Juanse:** *Roles de la app* → *Roles* → agregar a Juanse como **Administrador**. Desde acá Juanse puede hacer el resto solo.
6. **Pantalla *Configuración de la API con inicio de sesión de Instagram*:**
   - Anotar el **ID de la app de Instagram** y el **clave secreta de la app de Instagram**. La clave secreta va al paso 2; no la pegues en ningún archivo ni chat.
   - Anotar también la **clave secreta de la app** general: *Configuración de la app → Básica*.
   - *Generar tokens de acceso* → *Agregar cuenta* → loguear @solemio.tandil y aceptar los permisos → copiar el **token** (paso 3).
7. **Cuenta de prueba:** *Roles de la app* → agregar una cuenta personal de Instagram como **Instagram Tester**. Desde esa cuenta, aceptar la invitación en Instagram → Configuración → *Apps y sitios web* → *Invitaciones de prueba*.

## 2. Desplegar las Edge Functions (Juanse)

Desde la raíz del repo. No hace falta instalar nada: `npx` baja el CLI.

```bash
npx supabase@latest login
npx supabase@latest link --project-ref pktwpktmxbfapwjsugrx

# Secretos. Inventá valores largos al azar para VERIFY y CRON, por ejemplo con: openssl rand -hex 24
npx supabase@latest secrets set \
  IG_APP_SECRET='clave secreta de la app de Instagram (paso 1.6)' \
  META_APP_SECRET='clave secreta de la app general (paso 1.6)' \
  IG_VERIFY_TOKEN='un_valor_al_azar' \
  CRON_SECRET='otro_valor_al_azar'

npx supabase@latest functions deploy ig-webhook ig-send ig-sync ig-refresh
```

- `verify_jwt = false` ya está en `supabase/config.toml`: las funciones validan por su cuenta.
- **Si las funciones fallan con "Invalid API key"**, el proyecto tiene las claves legacy desactivadas. Hay que crear una *secret key* en Dashboard → Settings → API Keys y cargarla: `npx supabase@latest secrets set SB_SECRET_KEY='sb_secret_...'`.

## 3. Base de datos (SQL Editor de Supabase)

1. Correr **`sql/2026-09-16_instagram_inbox.sql`** entero.
2. **Cargar el token** del paso 1.6 (pegándolo solo en el editor, **nunca** en un archivo del repo):
   ```sql
   insert into public.ig_config (clave, valor, actualizado_en)
   values ('access_token', 'EL_TOKEN', now())
   on conflict (clave) do update set valor = excluded.valor, actualizado_en = now();
   ```
3. Correr **`sql/2026-09-16b_instagram_refresh_cron.sql`**, reemplazando `TU_CRON_SECRET_ACA` por el mismo `CRON_SECRET` del paso 2.

## 4. Conectar el webhook (Meta)

En la app de Meta, pantalla *Configuración de la API con inicio de sesión de Instagram* → **Configurar webhooks**:

1. **Completar el webhook y verificar:**
   - **URL de devolución de llamada:** `https://pktwpktmxbfapwjsugrx.supabase.co/functions/v1/ig-webhook`
   - **Token de verificación:** el mismo `IG_VERIFY_TOKEN` del paso 2.
   - Tocar *Verificar y guardar*.
2. **Suscribir los campos** `messages` y `message_echoes`.
3. **Activar la cuenta:** en la lista de cuentas, el interruptor de suscripción a webhooks de @solemio.tandil tiene que quedar **activado**.

Antes de conectarlo con Meta, se puede probar el handshake a mano. Tiene que devolver `123`:

```bash
curl "https://pktwpktmxbfapwjsugrx.supabase.co/functions/v1/ig-webhook?hub.mode=subscribe&hub.verify_token=EL_VERIFY_TOKEN&hub.challenge=123"
```

## 5. Probar (modo desarrollo, con la cuenta tester)

1. **Mensaje entrante:** con sesión de admin, abrir `catalogo.html` y, desde la cuenta tester, mandarle un DM a @solemio.tandil. Tiene que aparecer el aviso 💬 y el número en el ícono de chat.
2. **Hilo:** abrir `mensajes.html`, entrar a la conversación y ver que el contador se limpia.
3. **Responder desde el panel:** tiene que llegar al celular de la cuenta tester y verse **una sola vez** en el panel, con la aclaración "desde el panel".
4. **Responder desde la app de Instagram** (celular de la dueña): tiene que aparecer en el panel como "desde Instagram".
5. **Adjuntos:** mandar una foto y responder a una historia desde la cuenta tester.
6. **Sincronizar:** tocar *Sincronizar* y ver que aparecen las conversaciones anteriores.

**Si algo no llega:**
- Revisar los logs en Dashboard → Edge Functions → `ig-webhook` → Logs.
- Si dice "firma inválida", revisar `IG_APP_SECRET` y `META_APP_SECRET`.

## 6. Pasar a producción (clientes reales)

1. **Configuración de la app → Básica:**
   - **URL de la política de privacidad:** `https://solemiocatalogo.juansegundofrias.workers.dev/privacidad.html`
   - **Instrucciones de eliminación de datos:** `https://solemiocatalogo.juansegundofrias.workers.dev/privacidad.html#borrar-datos`
   - Ícono, categoría y email de contacto.
2. **Revisión de la app:** pedir **Acceso avanzado** para `instagram_business_basic` e `instagram_business_manage_messages`. Adjuntar un video mostrando la bandeja (recibir un mensaje, abrirlo, responder) y explicar que se usa para atender consultas de clientes de la tienda.
3. **Cuando lo aprueben** y la verificación del negocio esté completa, pasar la app a **Live** (modo *Publicada*).
4. **Repetir la prueba del paso 5** con una cuenta que **no** tenga rol en la app.
