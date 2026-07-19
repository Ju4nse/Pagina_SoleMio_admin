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

- El logo de la izquierda volvió a ser texto ("SoleMio", sin
  imagen), igual que en `landing.html` y `contacto.html`. En las 3
  páginas el texto ahora es un link que lleva a `landing.html`
  (home).
- Los botones circulares de la derecha (tema, cuenta, cerrar sesión)
  quedaron en el mismo orden y estilo visual que el ícono de login de
  `landing.html`/`contacto.html`, para que la posición sea consistente
  en todo el sitio.

## Nuevo: íconos coloreados y mapa embebido en Contacto

- Los íconos de WhatsApp e Instagram en `contacto.html` ahora tienen
  color: WhatsApp usa el verde de la paleta (`--green`/`--green-bg`,
  ya existía), e Instagram usa un rosa nuevo (`--pink`/`--pink-bg`)
  que agregué a `shared.css` para que quede dentro de la misma
  paleta del sitio (con su variante para modo oscuro también).
- Se agregó un mini mapa de Google Maps embebido (`<iframe>`, sin
  necesidad de API key) con la ubicación de Tacuari 33, Tandil, y un
  link "Ver en Google Maps" debajo que abre la ubicación completa en
  una pestaña nueva.

## Arreglado: flash de tema claro al cambiar de página

Al navegar entre páginas se veía un "flashazo" blanco antes de que se
aplicara el tema oscuro guardado. Pasaba porque `data-theme` se
fijaba recién cuando corría el JavaScript (`initTheme()`), que carga
después de que el navegador ya pintó la página con el tema claro por
defecto.

Se agregó un script chiquito e inline al principio del `<head>` de
las 4 páginas (`login.html`, `catalogo.html`, `landing.html`,
`contacto.html`) que lee el tema guardado en `localStorage` y lo
aplica **antes** de que se pinte nada, así no hay salto de color al
navegar. El `initTheme()` de cada módulo JS sigue corriendo igual
(actualiza el ícono del botón de tema), solo que ya no es el que
define el color inicial.

## Rediseño: estética editorial/boutique (fina, aireada)

Se rediseñó todo el sitio (landing, contacto, login, catálogo) para
que se vea más fino y liviano, inspirado en un mockup de referencia,
**sin adoptar Tailwind** (se mantuvo el sistema de CSS propio para
conservar el modo oscuro y no depender de un CDN no apto para
producción). Cambios principales, todos centralizados en
`shared.css`:

- **Tipografía:** los títulos ahora usan `Bodoni Moda` (serif fino)
  en vez de `DM Serif Display`. El texto de cuerpo sigue en `DM Sans`.
  Ambas están centralizadas en las variables `--font-serif` /
  `--font-sans`.
- **Paleta:** se agregó un acento cálido terracota
  (`--primary` / `--primary-dark` / `--primary-soft`) que reemplaza
  el negro puro en botones principales, precios, hovers y estados
  activos. El fondo pasó a un beige más cálido.
- **Esquinas más filosas:** `--radius` bajó de 10px a 2px y
  `--radius-lg` de 14px a 3px — look más editorial, menos "app".
- **Botones:** ahora en mayúsculas con tracking amplio, como en el
  mockup de referencia.
- Se agregó la clase `.frame` (marco fino tipo polaroid) para fotos,
  usada en el hero de la landing y en el mapa de contacto.

### Contenido de la landing — honestidad ante todo

El mockup de referencia mostraba secciones inventadas (multimarca
internacional, feed de Instagram con fotos de stock, newsletter). Se
adaptaron con contenido real de SoleMio en vez de copiarlas tal
cual:

- **Hero:** usa la foto del primer producto destacado como imagen
  (no una foto de stock ajena).
- **"Nuestra esencia":** texto genérico editable sobre la marca —
  revisalo y ajustalo a como realmente quieras presentar el local.
- **"Destacados":** la misma sección de antes, restyleada.
- **"Visitanos":** reemplaza el newsletter falso (no había backend
  para eso) por una CTA directa a WhatsApp/Instagram con la
  dirección y horarios reales.

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
