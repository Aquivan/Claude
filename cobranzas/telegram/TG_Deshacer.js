/**
 * ↩️ Deshacer la última acción — TODO lo que hizo: datos escritos, filas de vouchers y archivos.
 *
 * Cada acción del bot que cambia algo se anota por persona (chat de Telegram o número de WhatsApp):
 *   - 📥 vouchers mandados a la carpeta de Entrada (Registrar como voucher, tandas de WhatsApp,
 *     🧾 Procesar documento): al deshacer, si el archivo sigue en Entrada se borra; si la hoja de
 *     Vouchers ya lo procesó, se borran sus filas (columna "Archivo Original" = ese nombre, con su
 *     imagen) y el archivo de Procesados.
 *   - ✏️ datos escritos por la IA (factura, RUC, empresa…): vuelven a como estaban (solo si nadie
 *     los cambió después).
 * Siempre se muestra antes qué se va a deshacer y se confirma con un botón. Los archivos van a la
 * papelera de Drive (se pueden recuperar 30 días). Se guardan las últimas 8 acciones por persona.
 */

var TGU_PROP_ = 'TGU_';
var TGU_MAX_ = 8;

function TGU_pila_(clave) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(TGU_PROP_ + clave) || '[]'); } catch (e) { return []; }
}

function TGU_guardarPila_(clave, pila) {
  var p = PropertiesService.getScriptProperties();
  if (!pila.length) p.deleteProperty(TGU_PROP_ + clave);
  else p.setProperty(TGU_PROP_ + clave, JSON.stringify(pila.slice(-TGU_MAX_)));
}

/** acc = {id?, desc, archivos:[{id, nombre}], lotes:['IA…']} */
function TGU_anotar_(clave, acc) {
  if (!clave) return '';
  var pila = TGU_pila_(clave);
  acc.id = acc.id || Utilities.getUuid().slice(0, 8);
  acc.t = Date.now();
  acc.archivos = acc.archivos || []; acc.lotes = (acc.lotes || []).filter(Boolean);
  pila.push(acc);
  TGU_guardarPila_(clave, pila);
  return acc.id;
}

/** Suma archivos o lotes a una acción ya anotada (lo que se hace después, p. ej. al registrarse el voucher). */
function TGU_agregar_(clave, id, extra) {
  var pila = TGU_pila_(clave);
  var acc = pila.filter(function (a) { return a.id === id; })[0];
  if (!acc) return;
  acc.archivos = acc.archivos.concat(extra.archivos || []);
  acc.lotes = acc.lotes.concat((extra.lotes || []).filter(Boolean));
  TGU_guardarPila_(clave, pila);
}

/** Dónde está hoy cada archivo de la acción: filas en la hoja de Vouchers y si sigue en Entrada. */
function TGU_estado_(ss, acc) {
  var cfg = TG_cfg_(ss), entrada = [cfg.carpetaFotos, cfg.carpetaOriginales];
  var idx = TGU_indiceArchivos_(ss);
  return acc.archivos.map(function (a) {
    var enEntrada = false, existe = false;
    try {
      var f = DriveApp.getFileById(a.id);
      existe = !f.isTrashed();
      var it = f.getParents();
      while (it.hasNext()) if (entrada.indexOf(it.next().getId()) >= 0) enEntrada = true;
    } catch (e) {}
    return { a: a, filas: idx[String(a.nombre).trim()] || [], enEntrada: enEntrada, existe: existe };
  });
}

/** "Archivo Original" → [{hoja, fila, op, monto}] en todas las pestañas de la hoja de Vouchers. */
function TGU_indiceArchivos_(ss) {
  var out = {};
  var libro = SpreadsheetApp.openById(leerConfig_(ss).idVouchers);
  libro.getSheets().forEach(function (h) {
    if (h.getLastRow() < 2) return;
    var enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim().toLowerCase(); });
    var k = enc.indexOf('archivo original');
    if (k < 0) return;
    var v = h.getRange(2, 1, h.getLastRow() - 1, k + 1).getValues();
    v.forEach(function (r, i) {
      var n = String(r[k] || '').trim();
      if (n) (out[n] = out[n] || []).push({ hoja: h.getName(), fila: i + 2, op: String(r[1] || ''), monto: r[4] });
    });
  });
  return out;
}

function TGU_celdasLote_(ss, lote) {
  var sh = ss.getSheetByName(IMP_LOG_);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().filter(function (r) { return String(r[0]) === lote; })
    .map(function (r) { return r[2] + '!' + r[3] + ' ' + r[5] + ' = ' + r[6]; });
}

/** Texto (HTML simple) de lo que se va a deshacer. null si no hay nada. */
function TGU_describir_(ss, clave) {
  var pila = TGU_pila_(clave), acc = pila[pila.length - 1];
  if (!acc) return null;
  var lineas = [];
  TGU_estado_(ss, acc).forEach(function (e) {
    if (e.filas.length) lineas.push('🗑 Borrar ' + e.filas.length + ' fila(s) de Vouchers (' + e.filas.slice(0, 3).map(function (f) { return f.hoja + '!' + f.fila; }).join(', ') + ') con su imagen, y el archivo <i>' + TG_esc_(e.a.nombre) + '</i>');
    else if (e.existe) lineas.push('🗑 Borrar el archivo <i>' + TG_esc_(e.a.nombre) + '</i>' + (e.enEntrada ? ' (aún no se procesó)' : ''));
  });
  acc.lotes.forEach(function (l) {
    var c = TGU_celdasLote_(ss, l);
    if (c.length) lineas.push('✏️ Quitar ' + c.length + ' dato(s) escritos: ' + TG_esc_(c.slice(0, 3).join(' · ')) + (c.length > 3 ? '…' : ''));
  });
  var cuando = Utilities.formatDate(new Date(acc.t), 'America/Lima', 'dd/MM HH:mm');
  return { acc: acc, texto: '↩️ <b>Deshacer la última acción</b> (' + cuando + '): ' + TG_esc_(acc.desc || '') + '\n\n' +
    (lineas.length ? lineas.map(function (l) { return '• ' + l; }).join('\n') : '• No queda nada por deshacer (ya se borró o se cambió a mano).') +
    '\n\n<i>Los archivos van a la papelera de Drive (se recuperan 30 días).</i>', vacio: !lineas.length };
}

/** Deshace la última acción de esa persona. Devuelve {texto, nombres:[archivos deshechos]}. */
function TGU_deshacer_(ss, clave, idEsperado) {
  var pila = TGU_pila_(clave), acc = pila[pila.length - 1];
  if (!acc) return { texto: 'No hay nada para deshacer.', nombres: [] };
  if (idEsperado && acc.id !== idEsperado) return { texto: 'Mientras tanto hubo otra acción: pídame "deshacer" de nuevo para ver qué se deshace.', nombres: [] };
  pila.pop();
  TGU_guardarPila_(clave, pila);
  var partes = [], nombres = [];
  // 1) Datos escritos (antes de borrar filas: si no, las filas se corren).
  acc.lotes.slice().reverse().forEach(function (l) {
    try { partes.push(ANX_deshacer_(ss, l)); } catch (e) { partes.push('⚠️ datos: ' + e.message); }
  });
  // 2) Trabajos de 🧾 Procesar todavía en curso: se cancelan.
  try { TGP_cancelarTrabajo_(acc.id); } catch (e) {}
  // 3) Filas y archivos (de abajo hacia arriba para no correr las filas).
  var est = TGU_estado_(ss, acc), libro = SpreadsheetApp.openById(leerConfig_(ss).idVouchers), filas = [];
  est.forEach(function (e) { e.filas.forEach(function (f) { filas.push(f); }); });
  filas.sort(function (a, b) { return a.hoja === b.hoja ? b.fila - a.fila : (a.hoja < b.hoja ? -1 : 1); });
  var borradas = 0;
  filas.forEach(function (f) {
    try { libro.getSheetByName(f.hoja).deleteRow(f.fila); borradas++; } catch (e) { partes.push('⚠️ no pude borrar ' + f.hoja + '!' + f.fila + ': ' + e.message); }
  });
  var archivos = 0;
  est.forEach(function (e) {
    nombres.push(e.a.nombre);
    if (!e.existe) return;
    try { DriveApp.getFileById(e.a.id).setTrashed(true); archivos++; } catch (err) { partes.push('⚠️ no pude borrar ' + e.a.nombre + ': ' + err.message); }
  });
  if (borradas) { try { actualizarTodo_(true); } catch (e) {} }
  var txt = '↩️ <b>Deshecho</b>: ' + TG_esc_(acc.desc || '') +
    (borradas ? '\n• ' + borradas + ' fila(s) borradas de la hoja de Vouchers' : '') +
    (archivos ? '\n• ' + archivos + ' archivo(s) a la papelera' : '') +
    partes.filter(function (p) { return !/^No hay cambios/.test(p); }).map(function (p) { return '\n• ' + TG_esc_(p); }).join('');
  return { texto: txt, nombres: nombres };
}

/* ============================================================ Telegram */

function TGU_preguntarTG_(ctx) {
  var d = TGU_describir_(ctx.ss, ctx.chatId);
  if (!d) return TG_enviar_(ctx.chatId, 'No hay ninguna acción mía para deshacer.');
  var k = TG_guardarBoton_({ t: 'deshacer2', id: d.acc.id });
  TG_enviar_(ctx.chatId, d.texto, [[{ text: '↩️ Sí, deshacer todo', callback_data: 'k:' + k + ':si' }, { text: '✖ No', callback_data: 'k:' + k + ':no' }]]);
}

function TGU_alBotonTG_(ctx, datos, op) {
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  if (op !== 'si') return TG_enviar_(ctx.chatId, 'Listo, no deshice nada.');
  TG_accion_(ctx.chatId, 'typing');
  var r;
  try { r = TGU_deshacer_(ctx.ss, ctx.chatId, datos.id); } catch (e) { return TG_enviar_(ctx.chatId, '❌ ' + TG_esc_(e.message)); }
  TG_enviar_(ctx.chatId, r.texto);
}

/* ============================================================ WhatsApp (TGW_doPost_ accion=deshacer) */

/** q.modo: 'anotar' {numero, desc, archivos} · 'ver' {numero} · 'hacer' {numero, id} */
function TGU_wa_(q) {
  var ss = TG_ss_(), clave = 'wa' + String(q.numero || '').replace(/\D/g, '');
  if (q.modo === 'anotar') return { ok: true, id: TGU_anotar_(clave, { desc: q.desc || '', archivos: q.archivos || [], lotes: q.lotes || [] }) };
  if (q.modo === 'ver') {
    var d = TGU_describir_(ss, clave);
    return d ? { ok: true, hay: !d.vacio, id: d.acc.id, texto: d.texto } : { ok: true, hay: false, texto: 'No hay ninguna acción mía para deshacer.' };
  }
  var r = TGU_deshacer_(ss, clave, q.id);
  return { ok: true, texto: r.texto, nombres: r.nombres };
}
