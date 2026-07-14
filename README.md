# SoleMio — Panel (estructura reorganizada)

Reorganización del proyecto original: **login** y **catálogo** ahora son
páginas independientes, cada una con su propio HTML, CSS y JS ("backend"
cliente que habla con Supabase).

## Estructura de archivos

```
index.html           → redirige a landing.html (punto de entrada del hosting)

landing.html          → recibidor público: hero + novedades del catálogo
landing.css           → estilos exclusivos de la landing
landing.js             → carga las novedades desde Supabase, acceso invitado

contacto.html          → página de contacto (Instagram, WhatsApp, dirección/horarios)
contacto.css           → estilos exclusivos de contacto
contacto.js             → tema + acceso invitado desde contacto

login.html           → pantalla de login
login.css            → estilos exclusivos del login
login.js             → lógica de autenticación (admin + invitado, rate limiting)

catalogo.html         → panel de catálogo (sin pestañas: es la única vista)
catalogo.css           → estilos exclusivos del catálogo
catalogo.js             → lógica del catálogo (CRUD de productos, modal
                          de cuenta con cambio de contraseña, logout)

shared.css           → tokens de color, reset, botones y campos de formulario
                        (usado por todas las páginas)
site.css              → header y footer compartidos entre landing.html y
                        contacto.html
supabase-client.js    → cliente Supabase singleton + helper esAdmin()
theme.js              → tema claro/oscuro + set de íconos SVG compartidos

logo.png              → logo (sin cambios)
compras.json          → sin cambios (revisar si sigue en uso)
```

## Cómo funciona la navegación entre páginas

Como ahora son dos páginas HTML separadas (no una sola SPA), el rol de la
sesión se pasa entre ellas así:

- **Admin**: la sesión persiste vía Supabase Auth (`storageKey: 'solemio-auth'`
  en `localStorage`), por lo que `catalogo.html` puede verificarla al cargar
  sin volver a pedir usuario/contraseña.
- **Invitado**: no hay sesión real de Supabase, así que `login.js` guarda
  `sessionStorage.setItem('solemio-role', 'guest')` antes de redirigir, y
  `catalogo.js` lo lee al iniciar. Se borra al cerrar sesión.
- Si `catalogo.html` se abre directamente sin sesión válida ni rol de
  invitado, redirige automáticamente a `login.html`.
- Si `login.html` detecta una sesión de admin ya activa, redirige directo a
  `catalogo.html` (para no mostrar el login de nuevo).

- Desde `catalogo.html` ahora se puede volver: el logo lleva a
  `landing.html`, y hay links "Inicio" / "Catálogo" / "Contacto" en la
  barra superior.
- Esa misma barra "Inicio / Catálogo / Contacto" se ve siempre en
  `landing.html`, `contacto.html` y `catalogo.html`. En `login.html`
  no aparece, solo queda el link chico "← Volver al sitio".
- **Corregido:** si ya iniciaste sesión como admin y tocás "Catálogo"
  desde `landing.html` o `contacto.html`, ahora te lleva al catálogo
  como admin (con todas las funciones de edición), en vez de pisar tu
  sesión con el modo invitado. Lo resuelve `irAlCatalogo()` en
  `supabase-client.js`, que chequea si hay una sesión de admin válida
  antes de decidir a dónde mandarte.

## Cambio: "Novedades" ahora es "Destacados" (curado a mano)

Antes la sección mostraba los últimos 8 productos por `id`
(aproximación poco confiable de "lo más nuevo"). Ahora es 100%
manual: en el panel de admin, al editar un producto hay un checkbox
**"Destacado"**. Solo los productos marcados como destacado **y** que
además tengan stock (`stock = true`) aparecen en la sección
"Destacados" de `landing.html`.

### ⚠️ Acción requerida en Supabase

La tabla `productos` necesita una columna nueva `destacado` de tipo
`boolean` (default `false`). Si no existe, el checkbox del panel no
va a poder guardar el valor. Para agregarla:

```sql
alter table productos add column destacado boolean default false;
```

Corrélo una vez en el SQL Editor de Supabase.

## Nuevo: landing (recibidor) y página de contacto

- `landing.html` es ahora la puerta de entrada del sitio (`index.html`
  redirige ahí). Muestra un hero con el logo, un botón "Ver catálogo"
  (entra directo como invitado, sin pedir login) y una grilla de
  "Novedades" con los últimos 8 productos cargados en Supabase
  (ordenados por `id` descendente, se filtran los marcados como
  `oculto`).
- `contacto.html` tiene tarjetas de Instagram, WhatsApp y
  dirección/horarios.
- El acceso de administrador (`login.html`) ahora es un ícono de
  usuario 👤 en el header de `landing.html` y `contacto.html` (al lado
  del botón de tema), no un link de texto en el footer.
- `index.html` siempre redirige a `landing.html` sin condiciones (no
  depende de si hay una sesión activa ni de nada más), así que la
  landing es siempre el punto de entrada del sitio.

### ✓ Datos de contacto ya cargados

Los datos reales ya están puestos en `landing.html` y `contacto.html`:

| Dato | Valor |
|---|---|
| WhatsApp | `+54 2494 00-3595` (link: `wa.me/542494003595`) |
| Instagram | [@solemio.tandil](https://www.instagram.com/solemio.tandil/) |
| Dirección | Tacuari 33, Tandil, Buenos Aires |
| Horarios | Lunes a sábados: 10 a 13 hs y 17 a 20:30 hs |

Si el link de WhatsApp no abre bien un chat en tu celular al probarlo,
puede ser porque el número necesita el "9" que usa Argentina para
líneas móviles en el formato `wa.me` (`549` + código de área + número,
sin el 0 ni el 15). Probalo y avisame si hay que ajustarlo.

## Cambios recientes: se quitaron Compras y Sincronizar

Se eliminaron por completo las pestañas de "Compras" y "Sincronizar"
(historial de ventas, registro de compras, stats, y el runner de
GitHub Actions). Como quedaba una sola sección, también se sacó el
sistema de pestañas: `catalogo.html` ahora muestra el catálogo
directamente.

"Cambiar contraseña" se mantuvo, pero se movió a un modal propio
(ícono de cuenta 👤 en la barra superior, visible solo para admin)
en vez de estar dentro de la pestaña de Sincronizar.

Si en algún momento necesitás recuperar la lógica de compras o de
sincronización con GitHub Actions, están en la versión anterior del
proyecto (podés revisar el historial de commits del repo).

## Corrección incluida

El HTML original llamaba a `openViewModal()`, que apunta a un contenedor
`#modal-view`, pero ese `<div>` no existía en `index.html` (solo estaban
`#modal-prod` y `#modal-compra`). Se agregó `<div id="modal-view"></div>`
en `catalogo.html`.

## Pendiente / a revisar

- El token de GitHub Actions (`gh-token`) queda en el navegador
  (`sessionStorage`/`localStorage`); considerá si querés que además
  quede protegido por rol admin en la UI (ya lo está, solo lo ve un
  admin logueado).
- `compras.json` en el repo original está vacío/no se referencia desde
  el código — revisá si todavía lo necesitás.
