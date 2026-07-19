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
