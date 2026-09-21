/* ================================================================
   pedidos.js — Panel de administración de pedidos entrantes
   Página exclusiva de admin: si no hay sesión de admin, redirige a
   login.html (a diferencia de catalogo.html, acá no hay modo invitado).
   ================================================================ */
import { sb, esAdmin }   from './supabase-client.js';
import { ICON, initTheme, toggleTheme } from './theme.js';
import { initCarritoUI } from './carrito.js';
import { renderTopbar }  from './topbar.js';
import { renderFooter }  from './footer.js';
import { initAlertasPedidos } from './pedidos-alertas.js';

/* ================================================================
   STATE
   ================================================================ */
let pedidos              = [];   // [{...pedido, items:[...]}]
let pedidoAbiertoId      = null;
let itemsEdicion         = {};   // item.id -> {disponible, talle, colores, cantidad} (borrador mientras el modal está abierto)
let variantesPorProducto = {};   // producto_id -> [{talle, color, stock}] (para elegir una combinación real)
let verArchivados        = false; // false: solo pedidos activos. true: solo los archivados.

const ESTADO_LABEL = {
  espera:      'En espera',
  revisado:    'Revisado',
  confirmado:  'Confirmado',
  cancelado:   'Cancelado',
};

/* ================================================================
   HELPERS
   ================================================================ */
function fmtARS(n) {
  return '$ ' + Math.round(n || 0).toLocaleString('es-AR');
}

function fmtFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/* talle/color/cantidad son lo que pidió el cliente (no se tocan);
   *_final es lo que el admin termina confirmando (si es null, no
   hubo cambios y vale lo mismo que el original). */
function talleFinal(it)    { return it.talle_final    ?? (it.talle    || ''); }
function colorFinal(it)    { return it.color_final    ?? (it.color    || ''); }
function cantidadFinal(it) { return it.cantidad_final ?? it.cantidad; }

/* Colores que se le ofrecen al cliente en vez del que pidió: varios
   (colores_opciones) o uno solo (color_final, como antes de poder
   elegir varios). null si se mantiene el color pedido. */
function coloresOfrecidos(it) {
  if (it.colores_opciones?.length) return it.colores_opciones;
  if (it.color_final != null && it.color_final !== (it.color || '')) return [it.color_final];
  return null;
}

// Con varios colores ofrecidos todavía no hay uno decidido: solo se
// muestra el talle (salvo que el color pedido esté entre las opciones).
function attrsItem(it) {
  const opciones = it.colores_opciones?.length ? it.colores_opciones : null;
  const color = opciones ? (opciones.includes(it.color) ? it.color : '') : colorFinal(it);
  return [talleFinal(it), color].filter(Boolean).join(' · ');
}

/* Lo que se guarda en la DB a partir de los colores tildados en el
   modal: 2 o más → colores_opciones; uno solo → color_final (null si
   es el mismo que pidió el cliente). */
function coloresAGuardar(it, colores) {
  const sel = (colores || []).filter(Boolean);
  if (sel.length > 1) return { color_final: null, colores_opciones: sel };
  const unico = sel[0] ?? (it.color || '');
  return { color_final: unico !== (it.color || '') ? unico : null, colores_opciones: null };
}

function mismosColores(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function pedidoAbierto() {
  return pedidos.find(x => x.id === pedidoAbiertoId);
}

function tallesDeVariantes(productoId) {
  return [...new Set((variantesPorProducto[productoId] || []).map(v => v.talle).filter(Boolean))];
}

function coloresParaTalle(productoId, talle) {
  return [...new Set(
    (variantesPorProducto[productoId] || [])
      .filter(v => !talle || v.talle === talle)
      .map(v => v.color).filter(Boolean)
  )];
}

function stockDeVariante(productoId, talle, color) {
  const fila = (variantesPorProducto[productoId] || [])
    .find(v => v.talle === (talle || '') && v.color === (color || ''));
  return fila ? fila.stock : null;
}

/* Heurística de normalización para wa.me con números argentinos:
   saca el 0 de larga distancia y agrega el prefijo 549 de celular.
   Revisar el link antes de enviarlo si el número no es estándar. */
function normalizarTelefonoAR(tel) {
  let digits = String(tel || '').replace(/\D/g, '');
  digits = digits.replace(/^0/, '');
  if (!digits.startsWith('54'))  digits = '54' + digits;
  if (!digits.startsWith('549')) digits = digits.replace(/^54/, '549');
  return digits;
}

function mensajeWhatsapp(p) {
  const disponibles   = p.items.filter(it => it.disponible === true);
  const noDisponibles = p.items.filter(it => it.disponible === false);

  let msg = `Hola ${p.cliente_nombre}! Te contamos cómo quedó tu pedido en SoleMio:\n\n`;
  msg += `Código de tu pedido: ${p.id}\n\n`;

  if (disponibles.length) {
    msg += 'Disponible:\n';
    disponibles.forEach(it => {
      const cant  = cantidadFinal(it);
      const attrs = attrsItem(it);
      msg += `- ${it.producto_nombre}${attrs ? ` (${attrs})` : ''} x${cant} — ${fmtARS(it.precio_unitario * cant)}\n`;

      if (talleFinal(it) !== (it.talle || '')) {
        msg += `  (cambiamos el talle: pediste "${it.talle || 'sin especificar'}", te confirmamos "${talleFinal(it)}")\n`;
      }
      msg += notaColoresWhatsapp(it);
      if (cant !== it.cantidad) {
        msg += `  (ajustamos la cantidad: pediste ${it.cantidad}, quedan confirmadas ${cant})\n`;
      }
    });
    msg += '\n';
  }

  if (noDisponibles.length) {
    msg += 'Sin stock (no se incluyen en el total):\n';
    noDisponibles.forEach(it => {
      const attrs = attrsItem(it);
      msg += `- ${it.producto_nombre}${attrs ? ` (${attrs})` : ''} x${cantidadFinal(it)}\n`;
      msg += notaColoresWhatsapp(it);
    });
    msg += '\n';
  }

  msg += `Total a pagar: ${fmtARS(p.monto_final)}\n\n¿Coordinamos el pago y la entrega?`;
  return msg;
}

/* Ej.:
     Vos elegiste NEGRO, no está disponible. Tenemos disponible en talle 95 estos colores:
     - BLANCO
     - NUDE
   Si el color pedido está entre las opciones, solo se suman las demás. */
function notaColoresWhatsapp(it) {
  const opciones = coloresOfrecidos(it);
  if (!opciones) return '';
  const talle    = talleFinal(it);
  const enTalle  = talle ? ` en talle ${talle}` : '';
  const lista    = cs => cs.map(c => `  - ${c}\n`).join('');

  if (it.color && opciones.includes(it.color)) {
    const otros = opciones.filter(c => c !== it.color);
    return otros.length ? `  También lo tenemos${enTalle} en:\n${lista(otros)}` : '';
  }

  const varios = opciones.length > 1;
  const pediste = it.color ? `Vos elegiste ${it.color}, no está disponible. ` : '';
  return `  ${pediste}Tenemos disponible${enTalle} ${varios ? 'estos colores' : 'este color'}:\n`
    + lista(opciones)
    + (varios ? '  Decinos cuál preferís.\n' : '');
}

function linkWhatsapp(p) {
  const tel = normalizarTelefonoAR(p.cliente_telefono);
  return `https://wa.me/${tel}?text=${encodeURIComponent(mensajeWhatsapp(p))}`;
}

async function copiarMensajeWhatsapp() {
  const p = pedidoAbierto();
  if (!p) return;
  const texto = mensajeWhatsapp(p);
  try {
    await navigator.clipboard.writeText(texto);
    alert('Mensaje copiado al portapapeles.');
  } catch (err) {
    console.warn('No se pudo copiar al portapapeles:', err);
    prompt('No se pudo copiar automáticamente. Copialo de acá:', texto);
  }
}

async function copiarCodigoPedido() {
  const p = pedidoAbierto();
  if (!p) return;
  try {
    await navigator.clipboard.writeText(p.id);
    alert('Código copiado al portapapeles.');
  } catch (err) {
    console.warn('No se pudo copiar al portapapeles:', err);
    prompt('No se pudo copiar automáticamente. Copialo de acá:', p.id);
  }
}

/* ================================================================
   CARGA DE DATOS
   ================================================================ */
async function cargarPedidos() {
  const { data: pedidosData, error } = await sb
    .from('pedidos')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Error cargando pedidos:', error.message);
    return;
  }

  const { data: itemsData, error: errItems } = await sb
    .from('pedido_items')
    .select('*')
    .order('id', { ascending: true });

  if (errItems) console.warn('Error cargando ítems de pedidos:', errItems.message);

  pedidos = (pedidosData || []).map(p => ({
    ...p,
    items: (itemsData || []).filter(it => it.pedido_id === p.id),
  }));

  renderPedidos();
}

/* ================================================================
   RENDER — LISTA
   ================================================================ */
function renderPedidos() {
  const q             = (document.getElementById('buscar-pedido')?.value || '').toLowerCase();
  const filtroEstado  = document.getElementById('filtro-estado')?.value  || '';
  const orden         = document.getElementById('orden-pedido')?.value  || 'fecha_desc';

  const lista = pedidos.filter(p => {
    if (!!p.archivado !== verArchivados) return false;
    const qOk = !q
      || p.cliente_nombre.toLowerCase().includes(q)
      || p.cliente_telefono.toLowerCase().includes(q);
    const estadoOk = !filtroEstado || p.estado === filtroEstado;
    return qOk && estadoOk;
  });

  const comparadores = {
    fecha_asc:     (a, b) => new Date(a.created_at) - new Date(b.created_at),
    fecha_desc:    (a, b) => new Date(b.created_at) - new Date(a.created_at),
    telefono_asc:  (a, b) => a.cliente_telefono.localeCompare(b.cliente_telefono, 'es', { numeric: true }),
    telefono_desc: (a, b) => b.cliente_telefono.localeCompare(a.cliente_telefono, 'es', { numeric: true }),
  };
  lista.sort(comparadores[orden] || comparadores.fecha_desc);

  const cont = document.getElementById('pedidos-lista');
  if (!cont) return;

  if (!lista.length) {
    cont.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        ${verArchivados ? 'No hay pedidos archivados' : 'No hay pedidos que coincidan'}
      </div>`;
    return;
  }

  cont.innerHTML = lista.map(p => `
    <article class="pedido-row" onclick="abrirPedidoUI('${p.id}')">
      <div class="pedido-row-main">
        <div class="pedido-row-cliente">${p.cliente_nombre}</div>
        <div class="pedido-row-meta">
          ${p.cliente_telefono} · ${fmtFecha(p.created_at)} · ${p.items.length} ítem${p.items.length !== 1 ? 's' : ''} · <span class="pedido-row-codigo">#${p.id.slice(0, 8)}</span>
        </div>
      </div>
      <div class="pedido-row-right">
        <span class="badge badge-estado-${p.estado}">${ESTADO_LABEL[p.estado] || p.estado}</span>
        <span class="badge ${p.pagado ? 'badge-pago-si' : 'badge-pago-no'}">${p.pagado ? 'Pagado' : 'Sin pagar'}</span>
        <span class="pedido-row-monto">${fmtARS(p.monto_final ?? p.monto_estimado)}</span>
      </div>
    </article>
  `).join('');
}

function toggleArchivados() {
  verArchivados = !verArchivados;
  const btn = document.getElementById('btn-ver-archivados');
  if (btn) {
    btn.textContent = verArchivados ? 'Ver activos' : 'Ver archivados';
    btn.classList.toggle('active', verArchivados);
  }
  renderPedidos();
}

/* ================================================================
   MODAL DETALLE / EDICIÓN
   ================================================================ */
async function abrirPedido(id) {
  const p = pedidos.find(x => x.id === id);
  if (!p) return;

  pedidoAbiertoId = id;
  itemsEdicion = {};
  p.items.forEach(it => {
    itemsEdicion[it.id] = {
      disponible: it.disponible,
      talle:      talleFinal(it),
      colores:    it.colores_opciones?.length ? [...it.colores_opciones] : [colorFinal(it)].filter(Boolean),
      cantidad:   cantidadFinal(it),
    };
  });
  variantesPorProducto = {};

  renderModalPedido(); // se muestra ya; las opciones de talle/color llegan un instante después

  const productoIds = [...new Set(p.items.map(it => it.producto_id).filter(Boolean))];
  if (!productoIds.length) return;

  const { data, error } = await sb
    .from('producto_talles')
    .select('producto_id, talle, color, stock')
    .in('producto_id', productoIds)
    .eq('activo', true)
    .order('orden', { ascending: true });

  if (error) { console.warn('Error cargando variantes:', error.message); return; }

  (data || []).forEach(d => {
    if (!variantesPorProducto[d.producto_id]) variantesPorProducto[d.producto_id] = [];
    variantesPorProducto[d.producto_id].push({ talle: d.talle, color: d.color || '', stock: d.stock ?? 0 });
  });

  // Productos sin ninguna fila en producto_talles, o cuyas filas
  // todavía no tienen color cargado (se guardaron antes de que
  // existiera la gestión de colores): se completan con el color del
  // texto legado (productos.color), cruzándolo con los talles reales
  // si ya hay stock cargado por talle.
  const idsIncompletos = productoIds.filter(pid => {
    const filas = variantesPorProducto[pid];
    return !filas?.length || !filas.some(v => v.color);
  });

  if (idsIncompletos.length) {
    const { data: textos, error: errTextos } = await sb
      .from('productos')
      .select('id, talles, color')
      .in('id', idsIncompletos);

    if (!errTextos) {
      (textos || []).forEach(prod => {
        const filasDB       = variantesPorProducto[prod.id];
        const coloresTexto  = (prod.color || '').split(',').map(c => c.trim()).filter(Boolean);

        if (filasDB && filasDB.length && coloresTexto.length) {
          variantesPorProducto[prod.id] = filasDB.flatMap(f =>
            coloresTexto.map(c => ({ talle: f.talle, color: c, stock: f.stock }))
          );
        } else if (!filasDB || !filasDB.length) {
          variantesPorProducto[prod.id] = variantesFallbackDesdeTexto(prod);
        }
      });
    } else {
      console.warn('Error cargando talles/color de texto:', errTextos.message);
    }
  }

  if (pedidoAbiertoId === id) renderModalPedido();
}

/* Fallback para productos sin filas en producto_talles todavía:
   arma las combinaciones desde el texto legado (mismo criterio que
   usa producto.js para el selector del cliente), sin stock por combo. */
function variantesFallbackDesdeTexto(producto) {
  const talles  = (producto.talles || '').split(',').map(t => t.trim()).filter(Boolean);
  const colores = (producto.color  || '').split(',').map(c => c.trim()).filter(Boolean);
  if (talles.length) {
    return colores.length
      ? talles.flatMap(t => colores.map(c => ({ talle: t, color: c, stock: null })))
      : talles.map(t => ({ talle: t, color: '', stock: null }));
  }
  return colores.map(c => ({ talle: '', color: c, stock: null }));
}

function cerrarPedido() {
  pedidoAbiertoId = null;
  limpiarIdDeLaUrl();
  document.getElementById('modal-pedido').innerHTML = '';
}

function renderModalPedido() {
  const p = pedidoAbierto();
  if (!p) return;

  const totalConfirmado = p.items.reduce((acc, it) => {
    const e = itemsEdicion[it.id];
    return acc + (e?.disponible === true ? it.precio_unitario * (parseInt(e.cantidad, 10) || 0) : 0);
  }, 0);

  document.getElementById('modal-pedido').innerHTML = `
    <div class="modal-overlay" id="mpe" onclick="if(event.target.id==='mpe') cerrarPedidoUI()">
      <div class="modal pedido-modal-grande">
        <div class="modal-title">Pedido de ${p.cliente_nombre}</div>

        <div class="pedido-detalle-cliente">
          <div><strong>${p.cliente_nombre}</strong> · ${p.cliente_telefono}</div>
          <div style="font-size:.78rem;color:var(--text-3);margin-top:.15rem">${fmtFecha(p.created_at)}</div>
          <div class="pedido-codigo-row">
            <span>Código: <span class="pedido-row-codigo">${p.id}</span></span>
            <button type="button" class="btn ghost sm" onclick="copiarCodigoPedidoUI()">Copiar</button>
          </div>
          ${p.nota ? `<div class="pedido-nota">"${p.nota}"</div>` : ''}
          <div class="pedido-pago-toggle">
            <span>Pago (uso interno, no lo ve el cliente):</span>
            <button type="button" class="toggle-disp toggle-si ${p.pagado ? 'activo' : ''}" onclick="marcarPagadoUI(true)">Pagado</button>
            <button type="button" class="toggle-disp toggle-no ${!p.pagado ? 'activo' : ''}" onclick="marcarPagadoUI(false)">No pagado</button>
          </div>
        </div>

        <div class="pedido-items-edit">
          ${p.items.map(it => renderItemEdit(it)).join('')}
        </div>

        <!-- Pie fijo abajo del modal: el total y "Guardar" siempre a
             la vista aunque el pedido tenga muchos productos. -->
        <div class="pedido-modal-pie">
          <div class="carrito-total">
            <span>Monto confirmado</span>
            <strong>${fmtARS(totalConfirmado)}</strong>
          </div>

          <div class="modal-footer">
            <button class="btn ghost" onclick="cerrarPedidoUI()">Cerrar</button>
            <button class="btn primary" onclick="guardarPedidoUI()">${ICON.check} Guardar cambios</button>
            ${p.estado !== 'espera' ? `
              <button class="btn ghost" onclick="copiarMensajeWhatsappUI()">Copiar mensaje</button>
              <a class="btn" target="_blank" rel="noopener" href="${linkWhatsapp(p)}">Reenviar por WhatsApp</a>
            ` : ''}
            <button class="btn ghost" onclick="archivarPedidoUI(${!p.archivado})">${p.archivado ? 'Desarchivar' : 'Archivar'}</button>
          </div>
        </div>
      </div>
    </div>`;
}

/* Fila editable de un ítem: el admin puede cambiar talle/color/cantidad
   (misma idea que el selector del cliente) y ve el stock real cargado
   en producto_talles para decidir si marca el ítem disponible o no. */
function renderItemEdit(it) {
  const e           = itemsEdicion[it.id] || {};
  const productoId  = it.producto_id;
  const talles      = tallesDeVariantes(productoId);
  const colores     = coloresParaTalle(productoId, e.talle);
  const sel         = e.colores || [];
  // Con varios colores tildados el stock va en cada chip, no acá abajo
  const stockActual = sel.length > 1 ? null : stockDeVariante(productoId, e.talle, sel[0] || '');
  const cantMax     = it.cantidad; // el admin nunca puede subir la cantidad pedida por el cliente
  const cantidad    = Math.min(cantMax, Math.max(1, parseInt(e.cantidad, 10) || 1));
  const subtotal    = it.precio_unitario * cantidad;

  const talleCambio = e.talle !== (it.talle || '');
  const colorCambio = !(sel.length === 1 && sel[0] === (it.color || '')) && !(sel.length === 0 && !it.color);
  const cantCambio  = cantidad !== it.cantidad;

  return `
    <div class="pedido-item-edit">
      <div class="pedido-item-edit-info">
        <div class="pedido-item-edit-nombre">
          <span class="pedido-item-edit-id">${it.producto_id || '—'}</span>${it.producto_nombre}
        </div>

        <div class="pedido-item-edit-variantes">
          <div class="pedido-item-edit-campo">
            ${talles.length ? `
              <select onchange="cambiarTalleItemUI(${it.id}, this.value)">
                ${talles.map(t => `<option value="${t}" ${e.talle === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>`
              : (e.talle ? `<span class="pedido-item-edit-attr-fijo">${e.talle}</span>` : '')}
            ${talleCambio ? `<span class="pedido-item-edit-cambio" title="Talle pedido originalmente">pidió: ${it.talle || '—'}</span>` : ''}
          </div>

          <div class="pedido-item-edit-campo pedido-item-edit-colores-campo">
            ${colores.length ? `
              <div class="pedido-item-edit-colores" title="Podés marcar varios colores para ofrecerle al cliente">
                ${colores.map(c => {
                  const st = stockDeVariante(productoId, e.talle, c);
                  return `<button type="button" class="pedido-color-chip ${sel.includes(c) ? 'activo' : ''}"
                    data-color="${escAttr(c)}" onclick="toggleColorItemUI(${it.id}, this.dataset.color)">
                    ${c}${st !== null ? ` <span class="pedido-color-chip-stock">(${st})</span>` : ''}</button>`;
                }).join('')}
              </div>`
              : (sel[0] ? `<span class="pedido-item-edit-attr-fijo">${sel[0]}</span>` : '')}
            ${colorCambio ? `<span class="pedido-item-edit-cambio" title="Color pedido originalmente">pidió: ${it.color || '—'}${sel.length > 1 ? ` · se le ofrecen ${sel.length} colores` : ''}</span>` : ''}
          </div>

          <div class="pedido-item-edit-campo pedido-item-edit-cant-wrap">
            <label>Cant.</label>
            <input type="number" min="1" max="${cantMax}" class="pedido-item-edit-cant" value="${cantidad}"
              onchange="cambiarCantidadItemUI(${it.id}, this.value)">
            <span class="pedido-item-edit-cant-max">de ${cantMax} pedidas</span>
          </div>
        </div>

        <div class="pedido-item-edit-precio">
          ${fmtARS(subtotal)}
          ${stockActual !== null ? `<span class="pedido-item-edit-stock">Stock actual: ${stockActual}</span>` : ''}
          ${cantCambio ? `<span class="pedido-item-edit-cambio">cantidad ajustada</span>` : ''}
        </div>
      </div>
      <div class="pedido-item-edit-toggle">
        <button type="button" class="toggle-disp toggle-si ${e.disponible === true ? 'activo' : ''}"
          onclick="marcarItemUI(${it.id}, true)">Disponible</button>
        <button type="button" class="toggle-disp toggle-no ${e.disponible === false ? 'activo' : ''}"
          onclick="marcarItemUI(${it.id}, false)">Sin stock</button>
      </div>
    </div>`;
}

function cambiarTalleItem(itemId, talle) {
  const e = itemsEdicion[itemId];
  const it = pedidoAbierto()?.items.find(x => x.id === itemId);
  if (!e || !it) return;

  e.talle = talle;
  const coloresValidos = coloresParaTalle(it.producto_id, talle);
  if (coloresValidos.length) {
    e.colores = (e.colores || []).filter(c => coloresValidos.includes(c));
    if (!e.colores.length) e.colores = [coloresValidos[0]];
  }

  renderModalPedido();
}

/* Tilda/destilda un color. Siempre queda al menos uno: con uno solo es
   el color que se confirma; con varios, son las opciones que se le
   ofrecen al cliente para que elija (ver notaColoresWhatsapp). */
function toggleColorItem(itemId, color) {
  const e = itemsEdicion[itemId];
  if (!e) return;
  const sel = e.colores || [];
  if (sel.includes(color)) {
    if (sel.length === 1) return;
    e.colores = sel.filter(c => c !== color);
  } else {
    const it = pedidoAbierto()?.items.find(x => x.id === itemId);
    // se mantiene el orden de la lista de colores, no el de los clics
    const orden = it ? coloresParaTalle(it.producto_id, e.talle) : [];
    e.colores = [...sel, color].sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
  }
  renderModalPedido();
}

function cambiarCantidadItem(itemId, cantidad) {
  const e  = itemsEdicion[itemId];
  const it = pedidoAbierto()?.items.find(x => x.id === itemId);
  if (!e || !it) return;
  // Tope: nunca se puede confirmar más de lo que el cliente pidió.
  e.cantidad = Math.min(it.cantidad, Math.max(1, parseInt(cantidad, 10) || 1));
  renderModalPedido();
}

function marcarItem(itemId, valor) {
  const e = itemsEdicion[itemId];
  if (!e) return;
  e.disponible = e.disponible === valor ? null : valor;
  renderModalPedido();
}

/* Marca de pago: uso exclusivo del admin, no forma parte del circuito
   espera → revisado → confirmado y no se expone al cliente. */
async function marcarPagado(valor) {
  const p = pedidoAbierto();
  if (!p || p.pagado === valor) return;

  const anterior = p.pagado;
  p.pagado = valor;
  renderModalPedido();
  renderPedidos();

  const { error } = await sb.from('pedidos').update({ pagado: valor }).eq('id', p.id);
  if (error) {
    console.warn('Error marcando pago:', error.message);
    p.pagado = anterior;
    renderModalPedido();
    renderPedidos();
    alert('No se pudo actualizar el estado de pago.');
  }
}

/* Archivar: solo saca el pedido de la vista principal del panel, no lo
   borra ni cambia su estado. Al archivar/desarchivar, el pedido deja
   de pertenecer a la vista actual (activos vs. archivados), así que
   el modal se cierra solo. */
async function archivarPedido(valor) {
  const p = pedidoAbierto();
  if (!p || p.archivado === valor) return;

  const anterior = p.archivado;
  p.archivado = valor;

  const { error } = await sb.from('pedidos').update({ archivado: valor }).eq('id', p.id);
  if (error) {
    console.warn('Error archivando pedido:', error.message);
    p.archivado = anterior;
    renderModalPedido();
    alert('No se pudo actualizar el archivo del pedido.');
    return;
  }

  cerrarPedido();
  renderPedidos();
}

async function guardarPedido() {
  const p = pedidos.find(x => x.id === pedidoAbiertoId);
  if (!p) return;

  const btn = document.querySelector('#modal-pedido .btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  try {
    let huboModificacion = false;

    for (const it of p.items) {
      const e = itemsEdicion[it.id];
      if (!e) continue;

      // Nunca se puede confirmar más de lo que el cliente pidió.
      const cantidad = Math.min(it.cantidad, Math.max(1, parseInt(e.cantidad, 10) || 1));

      const talleFinalNuevo    = e.talle !== (it.talle || '') ? e.talle : null;
      const colores            = coloresAGuardar(it, e.colores);
      const cantidadFinalNuevo = cantidad !== it.cantidad     ? cantidad : null;

      if (talleFinalNuevo !== null || colores.color_final !== null || colores.colores_opciones || cantidadFinalNuevo !== null) {
        huboModificacion = true;
      }

      const cambios = {};
      if (e.disponible      !== it.disponible)            cambios.disponible      = e.disponible ?? null;
      if (talleFinalNuevo    !== (it.talle_final    ?? null)) cambios.talle_final    = talleFinalNuevo;
      if (colores.color_final !== (it.color_final   ?? null)) cambios.color_final    = colores.color_final;
      if (!mismosColores(colores.colores_opciones, it.colores_opciones)) cambios.colores_opciones = colores.colores_opciones;
      if (cantidadFinalNuevo !== (it.cantidad_final ?? null)) cambios.cantidad_final = cantidadFinalNuevo;

      if (!Object.keys(cambios).length) continue; // sin cambios, no pegarle a la DB

      const { error } = await sb.from('pedido_items').update(cambios).eq('id', it.id);
      if (error) throw error;
    }

    const decisiones       = p.items.map(it => itemsEdicion[it.id]?.disponible ?? null);
    const todosRevisados   = decisiones.every(d => d !== null);
    const hayDisponibles   = decisiones.some(d => d === true);
    const hayNoDisponibles = decisiones.some(d => d === false);

    // "revisado" engloba tanto los pedidos donde se cambió talle/color/
    // cantidad de algún ítem como los que antes eran "confirmado parcial"
    // (mezcla de disponible/sin stock). "confirmado" queda para cuando
    // todo se confirma tal cual se pidió, sin cambios.
    let nuevoEstado = 'espera';
    if (todosRevisados) {
      if (!hayDisponibles)                        nuevoEstado = 'cancelado';
      else if (hayNoDisponibles || huboModificacion) nuevoEstado = 'revisado';
      else                                         nuevoEstado = 'confirmado';
    }

    const montoFinal = p.items.reduce((acc, it) => {
      const e = itemsEdicion[it.id];
      if (!e || e.disponible !== true) return acc;
      const cantidad = Math.min(it.cantidad, Math.max(1, parseInt(e.cantidad, 10) || 1));
      return acc + it.precio_unitario * cantidad;
    }, 0);

    const patch = { estado: nuevoEstado, monto_final: montoFinal };
    if (nuevoEstado !== 'espera') patch.confirmado_at = new Date().toISOString();

    const { error: errPedido } = await sb.from('pedidos').update(patch).eq('id', p.id);
    if (errPedido) throw errPedido;

    p.items.forEach(it => {
      const e = itemsEdicion[it.id];
      if (!e) return;
      const cantidad = Math.min(it.cantidad, Math.max(1, parseInt(e.cantidad, 10) || 1));
      it.disponible      = e.disponible ?? null;
      it.talle_final     = e.talle  !== (it.talle || '') ? e.talle  : null;
      Object.assign(it, coloresAGuardar(it, e.colores));
      it.cantidad_final  = cantidad !== it.cantidad       ? cantidad : null;
    });
    Object.assign(p, patch);

    renderPedidos();
    renderModalPedido();
  } catch (err) {
    console.warn('Error guardando pedido:', err);
    alert(`No se pudo guardar el pedido.\n(${err.message || err})`);
    if (btn) { btn.disabled = false; btn.textContent = `${ICON.check} Guardar cambios`; }
  }
}

/* ================================================================
   NUEVO PEDIDO (carga manual: venta presencial o armado por el admin)

   Se crea directo como confirmado con disponible=true en todos
   los ítems: el admin ya está viendo el stock real al armarlo, no
   hace falta el circuito de revisión espera → revisado → confirmar.
   ================================================================ */
let nuevoPedidoItems       = [];  // [{productoId, nombre, precioUnitario, talle, color, cantidad}]
let npBusquedaResultados   = [];
let npProductoSeleccionado = null; // {id, nombre, precio} mientras se configura talle/color/cantidad
let npVariantes            = [];   // producto_talles del producto seleccionado
let npTalleSel             = null;
let npColorSel             = null;
let npBuscarTimer          = null;
let npNombre               = ''; // se guarda acá (no solo en el input) porque el modal
let npTelefono             = ''; // se re-renderiza entero al elegir producto/talle/color
let npTermino              = ''; // ídem para la búsqueda de producto

function generarUUID() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function npTallesDisponibles() {
  return [...new Set(npVariantes.map(v => v.talle).filter(Boolean))];
}

function npColoresParaTalle(talle) {
  return [...new Set(npVariantes.filter(v => !talle || v.talle === talle).map(v => v.color).filter(Boolean))];
}

function npStockDeVariante(talle, color) {
  const fila = npVariantes.find(v => v.talle === (talle || '') && v.color === (color || ''));
  return fila ? fila.stock : null;
}

function abrirNuevoPedido() {
  nuevoPedidoItems       = [];
  npBusquedaResultados   = [];
  npProductoSeleccionado = null;
  npVariantes            = [];
  npTalleSel             = null;
  npColorSel             = null;
  npNombre               = '';
  npTelefono             = '';
  npTermino              = '';
  renderModalNuevoPedido();
}

function npActualizarNombre(v) {
  npNombre = v;
}

function npActualizarTelefono(v) {
  npTelefono = v;
}

function cerrarNuevoPedido() {
  document.getElementById('modal-nuevo-pedido').innerHTML = '';
}

function buscarProductoNuevoPedido(term) {
  npTermino = term;

  // Si estaba configurando un producto (panel de talle/color abierto),
  // buscar de nuevo lo cancela — ahí sí hace falta un render completo
  // porque ese panel desaparece. El resto del tiempo (tipeando sin
  // nada seleccionado) solo se actualiza la listita de resultados,
  // para no recrear el <input> en cada letra.
  if (npProductoSeleccionado) {
    npProductoSeleccionado = null;
    renderModalNuevoPedido();
  }

  clearTimeout(npBuscarTimer);
  npBuscarTimer = setTimeout(async () => {
    const q = term.trim();

    // Sin texto (recién enfocado el campo): lista predeterminada de
    // productos en vez de dejar el listado vacío.
    let query = sb.from('productos').select('id,nombre,marca,precio').eq('eliminado', false);
    if (q) {
      const safe = q.replace(/[,()]/g, ' ');
      query = query.or(`nombre.ilike.%${safe}%,marca.ilike.%${safe}%,id.ilike.%${safe}%`);
    }

    const { data, error } = await query.order('nombre', { ascending: true }).limit(12);
    if (!error) npBusquedaResultados = data || [];
    actualizarNPResultados();
  }, 300);
}

async function seleccionarProductoNuevoPedido(id) {
  npProductoSeleccionado = npBusquedaResultados.find(p => p.id === id) || null;
  npBusquedaResultados   = [];
  npVariantes            = [];
  npTalleSel             = null;
  npColorSel             = null;
  npTermino              = '';
  renderModalNuevoPedido();
  if (!npProductoSeleccionado) return;

  const { data, error } = await sb
    .from('producto_talles')
    .select('talle, color, stock, precio')
    .eq('producto_id', id)
    .eq('activo', true)
    .order('orden', { ascending: true });

  if (!error) npVariantes = (data || []).map(d => ({ talle: d.talle, color: d.color || '', stock: d.stock ?? 0, precio: d.precio ?? null }));

  // Productos viejos que todavía no tienen filas en producto_talles
  // (se cargaron antes de que existiera esa tabla): mismo fallback al
  // texto legado (productos.talles/color) que ya usa abrirPedido()
  // para pedidos ya hechos — si no, acá no aparecía ningún talle/color.
  if (!npVariantes.length && npProductoSeleccionado?.id === id) {
    const { data: prod, error: errProd } = await sb
      .from('productos')
      .select('talles, color')
      .eq('id', id)
      .maybeSingle();

    if (!errProd && prod) {
      npVariantes = variantesFallbackDesdeTexto(prod).map(v => ({ ...v, precio: null }));
    }
  }

  if (npProductoSeleccionado?.id === id) renderModalNuevoPedido();
}

/* Precio de la combinación elegida (con el mismo margen que el resto
   del sitio) — usa el precio propio de esa fila de producto_talles si
   existe (ver "Stock por combinación" en el modal de edición), o si no
   el precio general del producto seleccionado. */
function npPrecioSeleccionado() {
  const fila = npVariantes.find(v => v.talle === (npTalleSel || '') && v.color === (npColorSel || ''));
  const base = (fila && fila.precio != null) ? fila.precio : (npProductoSeleccionado?.precio || 0);
  return Math.round(base * 1.5);
}

function seleccionarTalleNP(talle) {
  npTalleSel = talle || null;
  const validos = npColoresParaTalle(npTalleSel);
  if (npColorSel && !validos.includes(npColorSel)) npColorSel = null;
  renderModalNuevoPedido();
}

function seleccionarColorNP(color) {
  npColorSel = color || null;
  renderModalNuevoPedido();
}

function agregarItemNuevoPedido() {
  const p = npProductoSeleccionado;
  if (!p) return;

  const cantInput = document.getElementById('np-cantidad');
  const cantidad  = Math.max(1, parseInt(cantInput?.value, 10) || 1);

  const idx = nuevoPedidoItems.findIndex(it =>
    it.productoId === p.id && it.talle === (npTalleSel || '') && it.color === (npColorSel || ''));

  if (idx >= 0) {
    nuevoPedidoItems[idx].cantidad += cantidad;
  } else {
    nuevoPedidoItems.push({
      productoId:     p.id,
      nombre:         p.nombre,
      precioUnitario: npPrecioSeleccionado(),
      talle:          npTalleSel || '',
      color:          npColorSel || '',
      cantidad,
    });
  }

  npProductoSeleccionado = null;
  npVariantes            = [];
  npTalleSel             = null;
  npColorSel             = null;

  renderModalNuevoPedido();
}

function quitarItemNuevoPedido(idx) {
  nuevoPedidoItems.splice(idx, 1);
  renderModalNuevoPedido();
}

async function crearPedidoManual() {
  const nombre   = npNombre.trim();
  const telefono = npTelefono.trim();

  if (!nombre) { alert('Ingresá el nombre del cliente.'); return; }
  if (!nuevoPedidoItems.length) { alert('Agregá al menos un producto.'); return; }

  const btn = document.getElementById('np-crear-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }

  const pedidoId = generarUUID();
  const monto    = nuevoPedidoItems.reduce((acc, it) => acc + it.precioUnitario * it.cantidad, 0);

  try {
    const { error: errPedido } = await sb.from('pedidos').insert({
      id:               pedidoId,
      cliente_nombre:   nombre,
      cliente_telefono: telefono || '—',
      monto_estimado:   monto,
      monto_final:      monto,
      estado:           'confirmado',
      confirmado_at:    new Date().toISOString(),
      nota:             'Pedido cargado por el admin (venta presencial).',
    });
    if (errPedido) throw errPedido;

    const filas = nuevoPedidoItems.map(it => ({
      pedido_id:       pedidoId,
      producto_id:     it.productoId,
      producto_nombre: it.nombre,
      talle:           it.talle,
      color:           it.color,
      cantidad:        it.cantidad,
      precio_unitario: it.precioUnitario,
      disponible:      true,
    }));

    const { error: errItems } = await sb.from('pedido_items').insert(filas);
    if (errItems) throw errItems;

    cerrarNuevoPedido();
    await cargarPedidos();
  } catch (err) {
    console.warn('Error creando pedido manual:', err);
    alert(`No se pudo crear el pedido.\n(${err.message || err})`);
    if (btn) { btn.disabled = false; btn.textContent = 'Crear pedido'; }
  }
}

// Sub-render de la lista de resultados: se actualiza sola (ver
// actualizarNPResultados()) para que buscar no tenga que reconstruir
// el modal entero — así el <input> nunca se recrea y no pierde ni el
// texto tipeado ni el foco/cursor mientras escribís.
function renderNPResultadosHTML() {
  return npBusquedaResultados.length ? `
    <div class="np-resultados">
      ${npBusquedaResultados.map(p => `
        <button type="button" class="np-resultado-item" onclick="seleccionarProductoNuevoPedidoUI('${p.id}')">
          <span>${p.nombre}${p.marca ? ` · ${p.marca}` : ''}</span>
          <span class="np-resultado-precio">${fmtARS(Math.round((p.precio || 0) * 1.5))}</span>
        </button>
      `).join('')}
    </div>` : '';
}

function actualizarNPResultados() {
  const el = document.getElementById('np-resultados');
  if (el) el.innerHTML = renderNPResultadosHTML();
}

// Contenido de adentro del modal: se reconstruye en cada cambio
// (elegir producto, talle, color, agregar ítem...), pero SOLO el
// contenido — ver renderModalNuevoPedido() para el porqué.
function renderNPBodyHTML() {
  const total = nuevoPedidoItems.reduce((acc, it) => acc + it.precioUnitario * it.cantidad, 0);

  return `
    <div class="modal-title">Nuevo pedido (venta presencial)</div>

    <div class="field-row">
      <div class="field">
        <label>Nombre del cliente</label>
        <input id="np-nombre" type="text" placeholder="Nombre y apellido" value="${npNombre}" oninput="npActualizarNombreUI(this.value)">
      </div>
      <div class="field">
        <label>Teléfono (opcional)</label>
        <input id="np-telefono" type="tel" placeholder="Opcional" value="${npTelefono}" oninput="npActualizarTelefonoUI(this.value)">
      </div>
    </div>

    <div class="field">
      <label>Buscar producto</label>
      <input id="np-buscar" type="text" placeholder="Nombre, marca o código…" autocomplete="off"
        value="${npTermino}"
        oninput="buscarProductoNuevoPedidoUI(this.value)"
        onfocus="buscarProductoNuevoPedidoUI(this.value)">
    </div>

    <div id="np-resultados">${renderNPResultadosHTML()}</div>

    ${npProductoSeleccionado ? renderConfigNP() : ''}

    <div class="pedido-items-edit" style="margin-top:1rem">
      ${nuevoPedidoItems.length ? nuevoPedidoItems.map((it, idx) => `
        <div class="pedido-item-edit">
          <div class="pedido-item-edit-info">
            <div class="pedido-item-edit-nombre">
              <span class="pedido-item-edit-id">${it.productoId}</span>${it.nombre}
            </div>
            <div style="font-size:.75rem;color:var(--text-3);margin-top:.2rem">
              ${[it.talle, it.color].filter(Boolean).join(' · ') || '&nbsp;'} · x${it.cantidad}
            </div>
            <div class="pedido-item-edit-precio">${fmtARS(it.precioUnitario * it.cantidad)}</div>
          </div>
          <button type="button" class="btn-quitar-item" onclick="quitarItemNuevoPedidoUI(${idx})" title="Quitar">✕</button>
        </div>
      `).join('') : `<div class="np-vacio">Todavía no agregaste productos.</div>`}
    </div>

    <div class="pedido-modal-pie">
      <div class="carrito-total">
        <span>Total</span>
        <strong>${fmtARS(total)}</strong>
      </div>

      <div class="modal-footer">
        <button class="btn ghost" onclick="cerrarNuevoPedidoUI()">Cancelar</button>
        <button class="btn primary" id="np-crear-btn" onclick="crearPedidoManualUI()">${ICON.check} Crear pedido</button>
      </div>
    </div>`;
}

function renderModalNuevoPedido() {
  const container = document.getElementById('modal-nuevo-pedido');
  if (!container) return;

  const modalExistente = container.querySelector('.modal');

  if (!modalExistente) {
    // Primera vez que se abre: crea el overlay y el cuadro del modal,
    // que traen su animación de entrada (ver .modal-overlay/.modal en
    // catalogo.css). Después de esto, esos dos elementos ya no se
    // vuelven a recrear.
    container.innerHTML = `
      <div class="modal-overlay" id="mnp" onclick="if(event.target.id==='mnp') cerrarNuevoPedidoUI()">
        <div class="modal pedido-modal-grande" id="np-modal-box">${renderNPBodyHTML()}</div>
      </div>`;
    return;
  }

  // Ya estaba abierto: solo se reemplaza el contenido de adentro, sin
  // tocar el `.modal` en sí — si no, cada cambio (elegir talle, agregar
  // un producto, etc.) reconstruye el cuadro entero, repite la
  // animación de entrada como si fuera la primera vez que se abre, y
  // resetea el scroll a cero. Se siente como si "recargara la página".
  const scrollPrevio = modalExistente.scrollTop;
  modalExistente.innerHTML = renderNPBodyHTML();
  modalExistente.scrollTop = scrollPrevio;
}

function renderConfigNP() {
  const p       = npProductoSeleccionado;
  const talles  = npTallesDisponibles();
  const colores = npColoresParaTalle(npTalleSel);
  const stock   = npStockDeVariante(npTalleSel, npColorSel);

  return `
    <div class="np-config">
      <div class="np-config-nombre">${p.nombre}</div>
      <div class="pedido-item-edit-variantes">
        ${talles.length ? `
          <select onchange="seleccionarTalleNPUI(this.value)">
            <option value="">Talle…</option>
            ${talles.map(t => `<option value="${t}" ${npTalleSel === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>` : ''}
        ${colores.length ? `
          <select onchange="seleccionarColorNPUI(this.value)">
            <option value="">Color…</option>
            ${colores.map(c => `<option value="${c}" ${npColorSel === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>` : ''}
        <div class="pedido-item-edit-cant-wrap">
          <label>Cant.</label>
          <input type="number" min="1" id="np-cantidad" class="pedido-item-edit-cant" value="1">
        </div>
      </div>
      <div class="pedido-item-edit-stock" style="margin-top:.4rem">
        Precio: ${fmtARS(npPrecioSeleccionado())}${stock !== null ? ` · Stock actual: ${stock}` : ''}
      </div>
      <div style="margin-top:.65rem">
        <button type="button" class="btn sm primary" onclick="agregarItemNuevoPedidoUI()">+ Agregar al pedido</button>
      </div>
    </div>`;
}

/* ================================================================
   LOGOUT
   ================================================================ */
async function doLogout() {
  const { error } = await sb.auth.signOut();
  if (error) console.error('[LOGOUT ERROR]', error);
  window.location.href = 'login.html';
}

/* ================================================================
   INIT / GUARDIA DE AUTENTICACIÓN — solo admin, sin modo invitado
   ================================================================ */
async function startApp() {
  document.getElementById('app').dataset.role = 'admin'; // página admin-only
  document.getElementById('app').style.display = 'flex';

  renderTopbar('pedidos');
  renderFooter();
  initAlertasPedidos('admin');
  initTheme();
  initCarritoUI();

  const badge = document.getElementById('role-badge');
  if (badge) { badge.textContent = 'Admin'; badge.className = 'role-badge admin'; }

  await cargarPedidos();
  abrirPedidoDeLaUrl();
}

/* pedidos.html?id=<uuid> (el link del aviso de Telegram) abre directo
   el modal de ese pedido. Si está archivado, se pasa a esa vista para
   que al cerrar el modal se lo vea en la lista. */
function abrirPedidoDeLaUrl() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return;
  const p = pedidos.find(x => x.id === id);
  if (!p) { alert('No se encontró ese pedido.'); limpiarIdDeLaUrl(); return; }
  if (!!p.archivado !== verArchivados) toggleArchivados();
  abrirPedido(id);
}

// Saca el ?id= al cerrar el modal: si no, recargar la página lo volvería a abrir.
function limpiarIdDeLaUrl() {
  if (new URLSearchParams(location.search).has('id')) {
    history.replaceState(null, '', location.pathname);
  }
}

// Sin sesión de admin → login, y después de entrar vuelve a este pedido
// (ver destinoAdmin en login.js). Se arma con "pedidos.html" fijo y no
// con location.pathname: Cloudflare puede servir la página como /pedidos.
function irAlLogin() {
  const id = new URLSearchParams(location.search).get('id');
  window.location.href = id
    ? 'login.html?volver=' + encodeURIComponent('pedidos.html?id=' + id)
    : 'login.html';
}

async function init() {
  const { data: { session } } = await sb.auth.getSession();

  if (session?.user && await esAdmin(session.user.email)) {
    await startApp();

    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') window.location.href = 'login.html';
    });
    return;
  }

  irAlLogin();
}

// ── Exponer funciones globales para los onclick del HTML ──────
window.toggleTheme    = toggleTheme;
window.doLogout       = doLogout;
window.renderPedidos  = renderPedidos;
window.abrirPedidoUI  = abrirPedido;
window.cerrarPedidoUI = cerrarPedido;
window.marcarItemUI   = marcarItem;
window.marcarPagadoUI = marcarPagado;
window.archivarPedidoUI = archivarPedido;
window.toggleArchivadosUI = toggleArchivados;
window.guardarPedidoUI = guardarPedido;
window.cambiarTalleItemUI    = cambiarTalleItem;
window.toggleColorItemUI     = toggleColorItem;
window.cambiarCantidadItemUI = cambiarCantidadItem;
window.copiarMensajeWhatsappUI = copiarMensajeWhatsapp;
window.copiarCodigoPedidoUI    = copiarCodigoPedido;
window.abrirNuevoPedidoUI            = abrirNuevoPedido;
window.cerrarNuevoPedidoUI           = cerrarNuevoPedido;
window.npActualizarNombreUI          = npActualizarNombre;
window.npActualizarTelefonoUI        = npActualizarTelefono;
window.buscarProductoNuevoPedidoUI   = buscarProductoNuevoPedido;
window.seleccionarProductoNuevoPedidoUI = seleccionarProductoNuevoPedido;
window.seleccionarTalleNPUI          = seleccionarTalleNP;
window.seleccionarColorNPUI          = seleccionarColorNP;
window.agregarItemNuevoPedidoUI      = agregarItemNuevoPedido;
window.quitarItemNuevoPedidoUI       = quitarItemNuevoPedido;
window.crearPedidoManualUI           = crearPedidoManual;

init();
