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
let itemsEdicion         = {};   // item.id -> {disponible, talle, color, cantidad} (borrador mientras el modal está abierto)
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

function attrsItem(it) {
  return [talleFinal(it), colorFinal(it)].filter(Boolean).join(' · ');
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
      if (colorFinal(it) !== (it.color || '')) {
        msg += `  (cambiamos el color: pediste "${it.color || 'sin especificar'}", te confirmamos "${colorFinal(it)}")\n`;
      }
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
    });
    msg += '\n';
  }

  msg += `Total a pagar: ${fmtARS(p.monto_final)}\n\n¿Coordinamos el pago y la entrega?`;
  return msg;
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
      color:      colorFinal(it),
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

        <div class="carrito-total" style="margin-top:1rem">
          <span>Monto confirmado</span>
          <strong>${fmtARS(totalConfirmado)}</strong>
        </div>

        <div class="modal-footer" style="flex-wrap:wrap;gap:.5rem">
          <button class="btn ghost" onclick="cerrarPedidoUI()">Cerrar</button>
          <button class="btn primary" onclick="guardarPedidoUI()">${ICON.check} Guardar cambios</button>
          ${p.estado !== 'espera' ? `
            <button class="btn ghost" onclick="copiarMensajeWhatsappUI()">Copiar mensaje</button>
            <a class="btn" target="_blank" rel="noopener" href="${linkWhatsapp(p)}">Reenviar por WhatsApp</a>
          ` : ''}
          <button class="btn ghost" onclick="archivarPedidoUI(${!p.archivado})">${p.archivado ? 'Desarchivar' : 'Archivar'}</button>
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
  const stockActual = stockDeVariante(productoId, e.talle, e.color);
  const cantMax     = it.cantidad; // el admin nunca puede subir la cantidad pedida por el cliente
  const cantidad    = Math.min(cantMax, Math.max(1, parseInt(e.cantidad, 10) || 1));
  const subtotal    = it.precio_unitario * cantidad;

  const talleCambio = e.talle !== (it.talle || '');
  const colorCambio = e.color !== (it.color || '');
  const cantCambio  = cantidad !== it.cantidad;

  return `
    <div class="pedido-item-edit">
      <div class="pedido-item-edit-info">
        <div class="pedido-item-edit-nombre">${it.producto_nombre}</div>

        <div class="pedido-item-edit-variantes">
          <div class="pedido-item-edit-campo">
            ${talles.length ? `
              <select onchange="cambiarTalleItemUI(${it.id}, this.value)">
                ${talles.map(t => `<option value="${t}" ${e.talle === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>`
              : (e.talle ? `<span class="pedido-item-edit-attr-fijo">${e.talle}</span>` : '')}
            ${talleCambio ? `<span class="pedido-item-edit-cambio" title="Talle pedido originalmente">pidió: ${it.talle || '—'}</span>` : ''}
          </div>

          <div class="pedido-item-edit-campo">
            ${colores.length ? `
              <select onchange="cambiarColorItemUI(${it.id}, this.value)">
                ${colores.map(c => `<option value="${c}" ${e.color === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>`
              : (e.color ? `<span class="pedido-item-edit-attr-fijo">${e.color}</span>` : '')}
            ${colorCambio ? `<span class="pedido-item-edit-cambio" title="Color pedido originalmente">pidió: ${it.color || '—'}</span>` : ''}
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
  if (e.color && !coloresValidos.includes(e.color)) e.color = coloresValidos[0] || '';

  renderModalPedido();
}

function cambiarColorItem(itemId, color) {
  const e = itemsEdicion[itemId];
  if (!e) return;
  e.color = color;
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
      const colorFinalNuevo    = e.color !== (it.color || '') ? e.color : null;
      const cantidadFinalNuevo = cantidad !== it.cantidad     ? cantidad : null;

      if (talleFinalNuevo !== null || colorFinalNuevo !== null || cantidadFinalNuevo !== null) {
        huboModificacion = true;
      }

      const cambios = {};
      if (e.disponible      !== it.disponible)            cambios.disponible      = e.disponible ?? null;
      if (talleFinalNuevo    !== (it.talle_final    ?? null)) cambios.talle_final    = talleFinalNuevo;
      if (colorFinalNuevo    !== (it.color_final    ?? null)) cambios.color_final    = colorFinalNuevo;
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
      it.color_final     = e.color  !== (it.color || '') ? e.color  : null;
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
  renderModalNuevoPedido();
}

function cerrarNuevoPedido() {
  document.getElementById('modal-nuevo-pedido').innerHTML = '';
}

function buscarProductoNuevoPedido(term) {
  npProductoSeleccionado = null; // si estaba configurando uno, buscar de nuevo lo cancela
  clearTimeout(npBuscarTimer);
  npBuscarTimer = setTimeout(async () => {
    const q = term.trim();
    if (!q) { npBusquedaResultados = []; renderModalNuevoPedido(); return; }

    const safe = q.replace(/[,()]/g, ' ');
    const { data, error } = await sb
      .from('productos')
      .select('id,nombre,marca,precio')
      .eq('eliminado', false)
      .or(`nombre.ilike.%${safe}%,marca.ilike.%${safe}%,id.ilike.%${safe}%`)
      .limit(12);

    if (!error) npBusquedaResultados = data || [];
    renderModalNuevoPedido();
  }, 300);
}

async function seleccionarProductoNuevoPedido(id) {
  npProductoSeleccionado = npBusquedaResultados.find(p => p.id === id) || null;
  npBusquedaResultados   = [];
  npVariantes            = [];
  npTalleSel             = null;
  npColorSel             = null;
  renderModalNuevoPedido();
  if (!npProductoSeleccionado) return;

  const { data, error } = await sb
    .from('producto_talles')
    .select('talle, color, stock, precio')
    .eq('producto_id', id)
    .eq('activo', true)
    .order('orden', { ascending: true });

  if (!error) npVariantes = (data || []).map(d => ({ talle: d.talle, color: d.color || '', stock: d.stock ?? 0, precio: d.precio ?? null }));
  renderModalNuevoPedido();
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
  const nombre   = document.getElementById('np-nombre')?.value.trim();
  const telefono = document.getElementById('np-telefono')?.value.trim();

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

function renderModalNuevoPedido() {
  const container = document.getElementById('modal-nuevo-pedido');
  if (!container) return;

  const total = nuevoPedidoItems.reduce((acc, it) => acc + it.precioUnitario * it.cantidad, 0);

  container.innerHTML = `
    <div class="modal-overlay" id="mnp" onclick="if(event.target.id==='mnp') cerrarNuevoPedidoUI()">
      <div class="modal pedido-modal-grande">
        <div class="modal-title">Nuevo pedido (venta presencial)</div>

        <div class="field-row">
          <div class="field">
            <label>Nombre del cliente</label>
            <input id="np-nombre" type="text" placeholder="Nombre y apellido">
          </div>
          <div class="field">
            <label>Teléfono (opcional)</label>
            <input id="np-telefono" type="tel" placeholder="Opcional">
          </div>
        </div>

        <div class="field">
          <label>Buscar producto</label>
          <input id="np-buscar" type="text" placeholder="Nombre, marca o código…" autocomplete="off"
            oninput="buscarProductoNuevoPedidoUI(this.value)">
        </div>

        ${npBusquedaResultados.length ? `
          <div class="np-resultados">
            ${npBusquedaResultados.map(p => `
              <button type="button" class="np-resultado-item" onclick="seleccionarProductoNuevoPedidoUI('${p.id}')">
                <span>${p.nombre}${p.marca ? ` · ${p.marca}` : ''}</span>
                <span class="np-resultado-precio">${fmtARS(Math.round((p.precio || 0) * 1.5))}</span>
              </button>
            `).join('')}
          </div>` : ''}

        ${npProductoSeleccionado ? renderConfigNP() : ''}

        <div class="pedido-items-edit" style="margin-top:1rem">
          ${nuevoPedidoItems.length ? nuevoPedidoItems.map((it, idx) => `
            <div class="pedido-item-edit">
              <div class="pedido-item-edit-info">
                <div class="pedido-item-edit-nombre">${it.nombre}</div>
                <div style="font-size:.75rem;color:var(--text-3);margin-top:.2rem">
                  ${[it.talle, it.color].filter(Boolean).join(' · ') || '&nbsp;'} · x${it.cantidad}
                </div>
                <div class="pedido-item-edit-precio">${fmtARS(it.precioUnitario * it.cantidad)}</div>
              </div>
              <button type="button" class="btn-quitar-item" onclick="quitarItemNuevoPedidoUI(${idx})" title="Quitar">✕</button>
            </div>
          `).join('') : `<div class="np-vacio">Todavía no agregaste productos.</div>`}
        </div>

        <div class="carrito-total" style="margin-top:1rem">
          <span>Total</span>
          <strong>${fmtARS(total)}</strong>
        </div>

        <div class="modal-footer">
          <button class="btn ghost" onclick="cerrarNuevoPedidoUI()">Cancelar</button>
          <button class="btn primary" id="np-crear-btn" onclick="crearPedidoManualUI()">${ICON.check} Crear pedido</button>
        </div>
      </div>
    </div>`;
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

  window.location.href = 'login.html';
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
window.cambiarColorItemUI    = cambiarColorItem;
window.cambiarCantidadItemUI = cambiarCantidadItem;
window.copiarMensajeWhatsappUI = copiarMensajeWhatsapp;
window.copiarCodigoPedidoUI    = copiarCodigoPedido;
window.abrirNuevoPedidoUI            = abrirNuevoPedido;
window.cerrarNuevoPedidoUI           = cerrarNuevoPedido;
window.buscarProductoNuevoPedidoUI   = buscarProductoNuevoPedido;
window.seleccionarProductoNuevoPedidoUI = seleccionarProductoNuevoPedido;
window.seleccionarTalleNPUI          = seleccionarTalleNP;
window.seleccionarColorNPUI          = seleccionarColorNP;
window.agregarItemNuevoPedidoUI      = agregarItemNuevoPedido;
window.quitarItemNuevoPedidoUI       = quitarItemNuevoPedido;
window.crearPedidoManualUI           = crearPedidoManual;

init();
