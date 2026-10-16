/**
 * 🤖 Telegram — conversación con la IA.
 *
 * Usa el mismo analista de la hoja (💬 Chat con la IA: AnalistaIA.js +
 * AnalistaAdjuntos.js) con todas sus herramientas (facturas, vouchers,
 * aplicaciones, detracciones, verificar/cruzar vouchers, proponer cambios…) y le
 * suma las herramientas del asistente de Telegram (TG_Fuentes.js): Buzón SUNAT,
 * retenciones, honorarios, liquidaciones SIRE, cualquier hoja del grupo, estado
 * y lanzamiento de descargas, tipo de cambio, recordatorios y envío de archivos.
 */

var TG_SISTEMA_ = [
  'ESTÁS RESPONDIENDO POR TELEGRAM, en el celular del gerente o contador:',
  '- "respuesta": directa y breve (idealmente menos de 900 caracteres): primero la cifra o la conclusión, luego lo importante en viñetas "• ".',
  '  Usa **negrita** para cifras clave. Nada de tablas markdown en el texto. Montos con S/ o US$ y separador de miles.',
  '- "tablas": solo si aportan (máx. 3). Pocas columnas, las más útiles primero (las dos primeras van como título de cada fila).',
  '  Las tablas largas se mandan solas en Excel; no repitas su contenido en el texto.',
  '- Puedes agregar "sugerencias": hasta 3 preguntas cortas de seguimiento (máx. 45 caracteres c/u) que el usuario podría tocar como botón.',
  '- Si el usuario pide un archivo (PDF de una constancia, notificación, retención, recibo, voucher), usa enviar_archivo con su enlace.',
  '- Saludo o charla: responde amable y corto, sin herramientas. Preguntas generales de contabilidad o tributación peruana: responde como experto',
  '  (sin inventar cifras del grupo) y aclara si conviene confirmarlo en la norma vigente.',
  '',
  'HERRAMIENTAS EXTRA DEL ASISTENTE (además de las anteriores):',
  '- notificaciones {empresa, desde, hasta, buscar, tipo:"notificaciones"|"mensajes", no_leidas:true, max}: Buzón Electrónico SUNAT (hoja Notificaciones · Grupo):',
  '  fecha de publicación, surte efecto, tipo y N° de documento, asunto, etiqueta, leída, enlace al PDF. Lo más reciente primero.',
  '- retenciones_sunat {tipo:"emitidas"|"recibidas"|"detalle", empresa, contraparte, periodo:"AAAAMM", desde, hasta, buscar}: comprobantes de retención (CRE)',
  '  descargados de SUNAT. emitidas = la empresa retuvo a un proveedor; recibidas = un cliente agente de retención le retuvo; detalle = factura por factura.',
  '- honorarios {empresa, emisor, periodo, desde, hasta, pendientes:true, buscar}: recibos por honorarios RECIBIDOS (renta bruta, retención 4ta, neto, PDF).',
  '- sire_liquidacion {empresa, anio}: la Liquidación IGV del año de la empresa (hoja "Liquidacion IGV <RUC> - <año>" de SIRE): por mes ventas, compras, IGV,',
  '  saldo a favor, IGV por pagar, renta, etc. Úsala para "¿cuánto IGV pago?", "saldo a favor", "ventas del mes", "IR a cuenta".',
  '- leer_libro {libro:"notificaciones"|"retenciones"|"honorarios"|"detracciones"|"cobranzas"|"vouchers"|"sire" (con empresa y anio)|<ID o enlace de una Google Sheet>,',
  '  hoja, buscar, max_filas}: lee cualquier pestaña de esas hojas. Sin "hoja" devuelve la lista de pestañas con sus columnas.',
  '- estado_descargas {proyecto}: últimas corridas de GitHub (descargas automáticas de SUNAT: SIRE, retenciones, honorarios, notificaciones, detracciones):',
  '  si terminaron bien, con error, cuándo, qué empresa falló.',
  '- lanzar_descarga {proyecto:"sire"|"retenciones"|"honorarios"|"notificaciones"|"detracciones", empresa:"todas" o RUC/nombre, desde:"AAAAMM", hasta:"AAAAMM"}:',
  '  PROPONE pedir una descarga a SUNAT; el usuario la confirma con un botón (no se lanza sola). Para SIRE solo vale un periodo (desde).',
  '- tipo_cambio {}: tipo de cambio SUNAT de hoy (compra y venta).',
  '- padron_ruc {ruc}: si un RUC es agente de retención, buen contribuyente o agente de percepción (padrones SUNAT guardados).',
  '- recordatorio {cuando:"dd/mm/yyyy HH:mm", texto, repetir:"no"|"diario"|"semanal"|"mensual"}: crea un recordatorio para este chat',
  '  (calcula la fecha a partir de HOY; si no dicen hora usa 09:00). - recordatorios {}: lista los de este chat.',
  '- enviar_archivo {enlace, titulo}: manda al chat el archivo de Drive de ese enlace (PDF de constancia, notificación, CRE, recibo…). Máx. 10.',
  '- enviar_voucher {filas:["Originales!2326",…], modo:"imagen"|"original"}: manda al chat los vouchers de esas filas (máx. 30).',
  '  modo "imagen" (por defecto) = la FOTO de ese voucher solamente (varios llegan como álbum). modo "original" = el archivo completo del que',
  '  salió (PDF de varias páginas): úsalo SOLO si piden expresamente el PDF/archivo original/completo.',
  '  ÚSALA SIEMPRE que pidan ver, enviar, adjuntar o mandar la foto/imagen/voucher/comprobante de pagos: primero ubica las filas con la',
  '  herramienta vouchers (un voucher, los de un proveedor, los de un mes…) y luego llama enviar_voucher con esas filas. No respondas solo con texto.',
].join('\n');

// Nombres parecidos que la IA a veces usa para las herramientas nuevas.
var TG_ALIAS_ = { buzon: 'notificaciones', notificacion: 'notificaciones', mensajes: 'notificaciones', retencion_sunat: 'retenciones_sunat', cre: 'retenciones_sunat',
  honorario: 'honorarios', rhe: 'honorarios', recibos: 'honorarios', liquidacion: 'sire_liquidacion', sire: 'sire_liquidacion', igv: 'sire_liquidacion',
  libro: 'leer_libro', estado: 'estado_descargas', corridas: 'estado_descargas', descargar: 'lanzar_descarga', descarga: 'lanzar_descarga',
  cambio: 'tipo_cambio', tc: 'tipo_cambio', padron: 'padron_ruc', recordar: 'recordatorio', archivo_enviar: 'enviar_archivo', enviar: 'enviar_archivo', mandar_archivo: 'enviar_archivo',
  imagen_voucher: 'enviar_voucher', foto_voucher: 'enviar_voucher', adjuntar_voucher: 'enviar_voucher', ver_voucher: 'enviar_voucher', mandar_voucher: 'enviar_voucher', voucher_imagen: 'enviar_voucher' };

/**
 * Pregunta a la IA y contesta en el chat. adjs: archivos ya guardados en Drive [{id, nombre, mime}].
 */
function TG_preguntar_(ctx, texto, adjs) {
  var chatId = ctx.chatId;
  var ses = TG_sesion_(chatId);
  var t0 = Date.now();
  TG_accion_(chatId, 'typing');
  var estadoId = TG_enviar_(chatId, '⏳ <i>' + (adjs && adjs.length ? 'Leyendo ' + (adjs.length > 1 ? adjs.length + ' archivos' : 'el archivo') + '…' : 'Pensando…') + '</i>', null, { silencioso: true });
  var ultimoAviso = Date.now();
  var cfg;
  try { cfg = TG_cfg_(ctx.ss); } catch (e) { cfg = {}; }
  var op = {
    extraHerr: TGH_, extraSistema: TG_SISTEMA_, alias: TG_ALIAS_, sinHoja: true, filasCompletas: true, origen: '📱 telegram ' + (ctx.nombre || chatId),
    modelo: cfg.modelo || '', tg: { ctx: ctx, archivos: [], acciones: [], cfg: cfg },
    alPaso: function (pasos) {
      if (Date.now() - ultimoAviso < 4000) return;
      ultimoAviso = Date.now();
      var ult = pasos.slice(-3).map(function (p) { return '• ' + TG_esc_(TG_pasoLegible_(p)); }).join('\n');
      TG_editar_(chatId, estadoId, '⏳ <i>Revisando…</i>\n' + ult);
      TG_accion_(chatId, 'typing');
    },
  };
  // La IA ve los archivos nuevos y también los anteriores de la conversación (para preguntas de seguimiento).
  var anteriores = (ses.adj || []).filter(function (a) { return !(adjs || []).some(function (b) { return b.id === a.id; }); }).slice(-4);
  var todos = anteriores.concat(adjs || []).map(function (a) { return { id: a.id, nombre: a.nombre, mime: a.mime }; });
  var pregunta = texto || (adjs && adjs.length ? 'Analiza el/los archivo(s) adjunto(s) que acabo de mandar: qué son, si ya están registrados en la hoja de vouchers, ' +
    'si corresponden a alguna factura (¿ya se pagó?, ¿tiene N/C, retención o detracción?) y qué falta registrar.' : '');
  var r = CHAT_enviarEn_(ctx.ss, { texto: pregunta, nuevos: [], anteriores: todos, historial: ses.hist || [] }, op);
  TG_borrar_(chatId, estadoId);
  if (r.error) {
    TG_enviar_(chatId, TG_esc_(r.error), [[{ text: '🔁 Reintentar', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: texto || 'Analiza los archivos adjuntos' }) }]]);
    return;
  }
  TG_mostrarRespuesta_(ctx, r, op.tg, Math.round((Date.now() - t0) / 1000));
  ses = TG_sesion_(chatId);
  ses.hist = (ses.hist || []).concat([{ p: texto || '(archivos adjuntos)', r: r.respuesta }]);
  ses.adj = (ses.adj || []).concat((adjs || []).filter(function (a) { return !(ses.adj || []).some(function (b) { return b.id === a.id; }); }));
  TG_guardarSesion_(chatId, ses);
}

/** "R2 facturas {"empresa":"GRANIX"} → 14" → "facturas GRANIX (14)" */
function TG_pasoLegible_(p) {
  var m = String(p).match(/^\S+\s+(\S+)\s+(\{.*?\})?\s*→\s*(\d+)/);
  if (!m) return String(p).slice(0, 60);
  var args = {};
  try { args = JSON.parse(m[2] || '{}'); } catch (e) { args = {}; }
  var det = ['empresa', 'contraparte', 'texto', 'documento', 'buscar', 'proyecto', 'periodo'].map(function (k) { return args[k]; }).filter(Boolean).join(' ');
  return m[1].replace(/_/g, ' ') + (det ? ' ' + String(det).slice(0, 40) : '') + ' (' + m[3] + ')';
}

function TG_mostrarRespuesta_(ctx, r, tg, seg) {
  var chatId = ctx.chatId;
  var html = TG_md_(r.respuesta || '');
  var tablas = (r.tablas || []).filter(function (t) { return t.columnas && t.columnas.length; });
  tablas.slice(0, 3).forEach(function (t) { html += '\n\n' + TG_tablaHtml_({ titulo: t.titulo, columnas: t.columnas, filas: t.filas }, 8); });
  // Botones: sugerencias de seguimiento + Excel si hay tablas largas
  var teclado = [];
  var sug = (r.final && Array.isArray(r.final.sugerencias) ? r.final.sugerencias : []).filter(Boolean).slice(0, 3);
  sug.forEach(function (s) { teclado.push([{ text: '💬 ' + String(s).slice(0, 60), callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: String(s) }) }]); });
  // 🖼 Botones para ver la imagen de los vouchers que salen en las tablas (fila tipo "Originales!2326").
  var vistos = {};
  tablas.forEach(function (t) {
    var j = t.columnas.indexOf('fila');
    if (j < 0) return;
    t.filas.forEach(function (f) { var v = String(f[j] || ''); if (/^[^!]{1,20}![0-9]+$/.test(v)) vistos[v] = true; });
  });
  var enviados = tg.vouchers ? tg.vouchers.filas : [];
  var fuentes = Object.keys(vistos).filter(function (v) { return enviados.indexOf(v) < 0; }).slice(-6);
  for (var i = 0; i < fuentes.length; i += 3) {
    teclado.push(fuentes.slice(i, i + 3).map(function (v) { return { text: '🖼 ' + v, callback_data: 'v:' + v }; }));
  }
  var grandes = tablas.some(function (t) { return t.filas.length > 8 || t.columnas.length > 5; }) || tablas.length > 3;
  html += '\n\n<i>⏱ ' + seg + ' s</i>';
  TG_enviar_(chatId, html, teclado.length ? teclado : null);
  if (grandes) {
    try {
      TG_accion_(chatId, 'upload_document');
      var blob = TG_excel_(tablas, 'respuesta ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmm'));
      TG_enviarArchivo_(chatId, blob, '📊 Tablas completas (' + tablas.map(function (t) { return t.filas.length; }).reduce(function (a, b) { return a + b; }, 0) + ' filas)');
    } catch (e) {
      console.warn('Excel: ' + e.message);
      // Sin Excel: CSV de la tabla más grande
      var t = tablas.slice().sort(function (a, b) { return b.filas.length - a.filas.length; })[0];
      var csv = [t.columnas].concat(t.filas).map(function (f) { return f.map(function (v) { v = TG_valor_(v, ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
      TG_enviarArchivo_(chatId, Utilities.newBlob(csv, 'text/csv', 'tabla.csv'), '📊 ' + TG_esc_(t.titulo));
    }
  }
  // ✏️ Cambios propuestos en la hoja de vouchers
  if (r.cambios && r.cambios.length) TG_mostrarCambios_(ctx, r.cambios);
  // 🚀 Descargas propuestas
  (tg.acciones || []).forEach(function (a) { TG_proponerDescarga_(ctx, a); });
  // 📎 Archivos que pidió
  if (tg.vouchers) TG_mandarVouchers_(ctx, tg.vouchers.filas, tg.vouchers.modo);
  (tg.archivos || []).slice(0, 10).forEach(function (a) { TG_mandarArchivo_(ctx, a.id, a.titulo); });
}

function TG_mostrarCambios_(ctx, cambios) {
  var lineas = cambios.slice(0, 15).map(function (x, i) {
    return (i + 1) + '. <b>' + TG_esc_(x.fila) + '</b> · ' + TG_esc_(x.columna) + ': ' + (x.actual ? '<s>' + TG_esc_(x.actual) + '</s> → ' : '') +
      '<b>' + TG_esc_(x.nuevo) + '</b>' + (x.motivo ? '\n   <i>' + TG_esc_(String(x.motivo).slice(0, 160)) + '</i>' : '') + (x.aviso ? '\n   ' + (/ya tiene|no existe|distint|reemplaz|no se/i.test(x.aviso) ? '⚠️ ' : 'ℹ️ ') + TG_esc_(x.aviso) : '');
  });
  var ids = cambios.map(function (x) { return x.id; });
  var k = TG_guardarBoton_({ t: 'cambios', ids: ids });
  var hayDato = cambios.some(function (x) { return x.actual; });
  var botones = [[{ text: '✅ Escribir ' + (cambios.length > 1 ? 'los ' + cambios.length : 'el dato'), callback_data: 'k:' + k + ':si' }, { text: '✖ No', callback_data: 'k:' + k + ':no' }]];
  if (hayDato) botones.push([{ text: '✅ Escribir y reemplazar lo que ya tienen', callback_data: 'k:' + k + ':reemplazar' }]);
  TG_enviar_(ctx.chatId, '✏️ <b>Propongo escribir en la hoja de Vouchers</b> (' + cambios.length + '):\n' + lineas.join('\n') +
    (cambios.length > 15 ? '\n<i>… y ' + (cambios.length - 15) + ' más</i>' : '') + '\n\n<i>Solo se escriben celdas vacías (salvo que elija reemplazar). Se puede deshacer.</i>', botones);
}

function TG_aplicarCambios_(ctx, datos, op) {
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  if (op === 'no') return TG_enviar_(ctx.chatId, 'Listo, no escribí nada.');
  TG_accion_(ctx.chatId, 'typing');
  var r;
  try { r = ANX_aplicarDet_(ctx.ss, datos.ids, op === 'reemplazar'); } catch (e) { return TG_enviar_(ctx.chatId, '❌ ' + TG_esc_(e.message)); }
  var enlaces = (r.enlaces || []).slice(0, 5).map(function (e) { return '<a href="' + TG_esc_(e.url) + '">' + TG_esc_(e.fila) + '</a>'; }).join(' · ');
  TG_enviar_(ctx.chatId, TG_esc_(r.mensaje) + (enlaces ? '\n🔗 ' + enlaces : ''),
    /✅/.test(r.mensaje) ? [[{ text: '↩️ Deshacer', callback_data: 'k:' + TG_guardarBoton_({ t: 'deshacer' }) }]] : null);
}

function TG_deshacerCambios_(ctx) {
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  try { TG_enviar_(ctx.chatId, TG_esc_(ANX_deshacer_(ctx.ss))); } catch (e) { TG_enviar_(ctx.chatId, '❌ ' + TG_esc_(e.message)); }
}

/** ID de un archivo de Drive a partir de un enlace (o el ID mismo). */
function TG_idDrive_(x) {
  var s = String(x || '');
  var m = s.match(/\/d\/([\w-]{20,})/) || s.match(/[?&]id=([\w-]{20,})/) || s.match(/^([\w-]{25,})$/);
  return m ? m[1] : '';
}

function TG_mandarArchivo_(ctx, id, titulo) {
  try {
    var f = DriveApp.getFileById(id);
    var blob = f.getBlob();
    if (blob.getBytes().length > 45 * 1024 * 1024) return TG_enviar_(ctx.chatId, '📎 ' + TG_esc_(f.getName()) + ' pesa demasiado para Telegram: <a href="' + f.getUrl() + '">abrir en Drive</a>');
    blob.setName(f.getName());
    if (!TG_enviarArchivo_(ctx.chatId, blob, titulo ? '📎 ' + TG_esc_(titulo) : '')) TG_enviar_(ctx.chatId, '📎 <a href="' + f.getUrl() + '">' + TG_esc_(f.getName()) + '</a>');
  } catch (e) {
    TG_enviar_(ctx.chatId, '⚠️ No pude abrir ese archivo en Drive (' + TG_esc_(e.message) + ').');
  }
}

/**
 * Vouchers de la hoja de vouchers (filas "Originales!2326").
 * modo "imagen" (por defecto): la FOTO de ese voucher (la imagen de su celda; si no hay, el archivo si es una foto,
 * o la miniatura de la página si es PDF). Varios se mandan como álbum de 10 en 10.
 * modo "original": el archivo completo del que salió (PDF de varias páginas, etc.).
 */
function TG_mandarVouchers_(ctx, fuentes, modo) {
  var cfg = leerConfig_(ctx.ss);
  var libro = SpreadsheetApp.openById(cfg.idVouchers);
  var fotos = [], fallas = [];
  TG_accion_(ctx.chatId, modo === 'original' ? 'upload_document' : 'upload_photo');
  fuentes.forEach(function (f) {
    var x;
    try { x = TG_voucherBlob_(libro, f, modo); } catch (e) { x = { error: e.message }; }
    if (x.error) { fallas.push(f + ': ' + x.error); return; }
    if (modo === 'original' || !/^image\//.test(x.blob.getContentType() || '') || x.blob.getBytes().length > 9 * 1024 * 1024) {
      if (!TG_enviarArchivo_(ctx.chatId, x.blob, x.caption)) fallas.push(f + ': Telegram no aceptó el archivo');
      return;
    }
    fotos.push(x);
  });
  for (var i = 0; i < fotos.length; i += 10) {
    var lote = fotos.slice(i, i + 10);
    if (lote.length === 1) { TG_llamar_('sendPhoto', { chat_id: String(ctx.chatId), photo: lote[0].blob, caption: lote[0].caption, parse_mode: 'HTML' }); continue; }
    var carga = { chat_id: String(ctx.chatId), media: lote.map(function (x, k) { return { type: 'photo', media: 'attach://f' + k, caption: x.caption, parse_mode: 'HTML' }; }) };
    lote.forEach(function (x, k) { carga['f' + k] = x.blob.setName('f' + k + '.jpg'); });
    var r = TG_llamar_('sendMediaGroup', carga);
    if (!r.ok) lote.forEach(function (x) { TG_llamar_('sendPhoto', { chat_id: String(ctx.chatId), photo: x.blob, caption: x.caption, parse_mode: 'HTML' }); });
  }
  if (fallas.length) TG_enviar_(ctx.chatId, '⚠️ No pude mandar: ' + TG_esc_(fallas.slice(0, 8).join(' · ')));
}

function TG_mandarVoucher_(ctx, fuente, modo) { TG_mandarVouchers_(ctx, [fuente], modo || 'imagen'); }

/** {blob, caption} del voucher de una fila, o {error}. */
function TG_voucherBlob_(libro, fuente, modo) {
  var p = String(fuente).split('!');
  var sh = libro.getSheetByName(p[0]);
  if (!sh) return { error: 'no existe la pestaña ' + p[0] };
  var fila = parseInt(p[1], 10), nc = sh.getLastColumn();
  var enc = sh.getRange(1, 1, 1, nc).getDisplayValues()[0];
  var val = sh.getRange(fila, 1, 1, nc).getValues()[0];
  var txt = function (n) { var j = enc.map(normHeader_).indexOf(normHeader_(n)); return j >= 0 ? val[j] : ''; };
  var celda = function () {
    for (var j = 0; j < nc; j++) {
      var v = val[j];
      if (v && typeof v === 'object' && typeof v.getContentUrl === 'function') {
        try {
          var r = UrlFetchApp.fetch(v.getContentUrl(), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
          if (r.getResponseCode() === 200) return r.getBlob().setName('voucher ' + fuente.replace('!', ' fila ') + '.jpg');
        } catch (e) { /* sigue */ }
      }
    }
    return null;
  };
  var archivo = function () {
    for (var j = 0; j < nc; j++) {
      var s = String(val[j] == null ? '' : val[j]).trim();
      var id = TG_idDrive_(s);
      try {
        if (id) return DriveApp.getFileById(id);
        if (/\.(jpe?g|png|pdf|webp|heic|gif)$/i.test(s)) { var it = DriveApp.getFilesByName(s); if (it.hasNext()) return it.next(); }
      } catch (e) { /* sigue */ }
    }
    return null;
  };
  var blob = null;
  if (modo === 'original') {
    var f = archivo();
    blob = f ? f.getBlob().setName(f.getName()) : celda();
  } else {
    blob = celda();
    if (!blob) {
      var g = archivo();
      if (g) blob = /^image\//.test(g.getMimeType()) ? g.getBlob() : g.getThumbnail();
    }
  }
  if (!blob) return { error: 'sin imagen ni archivo del voucher en la fila' };
  var monto = txt('Monto'), fecha = val[0] instanceof Date ? TG_fecha_(val[0]) : String(val[0] || '');
  var pag = txt('Pagina');
  return { blob: blob, caption: '🖼 <b>' + TG_esc_(fuente) + '</b>' + (fecha ? ' · ' + TG_esc_(fecha) : '') +
    (monto !== '' ? ' · ' + TG_esc_(txt('Moneda') || '') + ' ' + TG_num_(aNumero_(monto)) : '') +
    (txt('Proveedor (Beneficiario)') ? '\n' + TG_esc_(String(txt('Proveedor (Beneficiario)')).slice(0, 60)) : '') +
    (modo === 'original' && pag ? '\n<i>Archivo completo · el voucher está en la página ' + TG_esc_(pag) + '</i>' : '') };
}

function TG_mandarExcel_(ctx, datos) {
  try { TG_enviarArchivo_(ctx.chatId, TG_excel_(datos.tablas, datos.nombre || 'tabla'), '📊 ' + TG_esc_(datos.nombre || 'Tabla')); }
  catch (e) { TG_enviar_(ctx.chatId, '⚠️ No pude armar el Excel: ' + TG_esc_(e.message)); }
}
