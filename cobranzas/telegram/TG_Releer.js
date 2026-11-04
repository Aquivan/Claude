/**
 * 🔁 Volver a leer con IA la página de una fila de la hoja de Vouchers (Telegram y WhatsApp).
 *
 *   «volver a leer Originales 2666» · «releer Fotos!382» · «relee originales fila 2666»
 *
 * Busca el archivo de la fila (columna K, la versión MÁS NUEVA si se volvió a subir con el mismo nombre), saca la
 * página de la columna M, la IA la lee y muestra ANTES / AHORA con ✅ Reemplazar. Solo cambia A..I (datos del
 * voucher) y la fecha de proceso; la imagen (J) se rehace sola con la reparación automática de la hoja de Vouchers.
 * No toca lo que la persona agregó (columnas O en adelante). Botón ↩️ Deshacer. Lo mismo está en la hoja de
 * Vouchers: menú 🤖 Vouchers → 🔁 Volver a leer con IA la página de la fila seleccionada.
 */

var TGRL_RX_ = /\b(?:vuelv[ae]s?|volver)\s+a\s+leer\b|\brele(?:er|e|é|a)\b/i;
var TGRL_FILA_RX_ = /\b(originales?|fotos?)\s*!?\s*(?:fila\s*)?(\d{2,6})\b/i;

/** ¿Es un pedido de releer? → {hoja, fila} | {ayuda:true} | null */
function TGRL_pedido_(texto) {
  var t = String(texto || '');
  if (!TGRL_RX_.test(t)) return null;
  var m = t.match(TGRL_FILA_RX_);
  if (!m) return /\bfila\b/i.test(t) ? { ayuda: true } : null;   // «vuelve a leer este voucher» (con archivo) sigue a la IA
  return { hoja: /^o/i.test(m[1]) ? 'Originales' : 'Fotos', fila: Number(m[2]) };
}

var TGRL_AYUDA_ = '🔁 Para volver a leer con IA la página de un voucher dígame la pestaña y la fila, por ejemplo: ' +
  '«volver a leer Originales 2666» o «releer Fotos 382».';

/** Telegram: texto del chat. */
function TGRL_tg_(ctx, texto) {
  var p = TGRL_pedido_(texto);
  if (!p) return false;
  if (p.ayuda) { TG_enviar_(ctx.chatId, TG_esc_(TGRL_AYUDA_)); return true; }
  TG_enviar_(ctx.chatId, '🔁 Leyendo otra vez con IA <b>' + p.hoja + '!' + p.fila + '</b>…');
  TGRL_correr_(ctx.ss || TG_ss_(), p.hoja, p.fila, String(ctx.chatId));
  return true;
}

/** WhatsApp: devuelve la respuesta inmediata; el resultado llega después (TGC_wa_). */
function TGRL_wa_(ss, texto, numero) {
  var p = TGRL_pedido_(texto);
  if (!p) return null;
  if (p.ayuda) return { ok: true, respuesta: TGRL_AYUDA_ };
  TGRL_correr_(ss, p.hoja, p.fila, 'wa' + String(numero || '').replace(/\D/g, ''));
  return { ok: true, respuesta: '🔁 Leyendo otra vez con IA *' + p.hoja + '!' + p.fila + '*… le mando el resultado en un momento.' };
}

/** pdf-lib es asíncrono: el trabajo termina dentro de esta misma ejecución (como TGP_trabajarYa_). */
function TGRL_correr_(ss, hoja, fila, chat) {
  try {
    TGRL_leer_(ss, hoja, fila, chat).catch(function (e) { TGRL_decir_(chat, '❌ No pude volver a leer ' + hoja + '!' + fila + ': ' + (e && e.message || e)); });
  } catch (e) { TGRL_decir_(chat, '❌ No pude volver a leer ' + hoja + '!' + fila + ': ' + e.message); }
}

function TGRL_decir_(chat, texto, botonesTG, botonesWA) {
  if (String(chat).indexOf('wa') === 0) { try { TGC_wa_({ tipo: 'texto', numero: String(chat).slice(2), texto: texto, botones: botonesWA || null }); } catch (e) {} }
  else TG_enviar_(chat, TG_esc_(texto).replace(/\*([^*\n]+)\*/g, '<b>$1</b>'), botonesTG || null);
}

async function TGRL_leer_(ss, hoja, fila, chat) {
  var cfg = TG_cfg_(ss);
  if (!cfg.idVouchers) throw new Error('falta el ID de la hoja de Vouchers en ⚙️ Config');
  var sh = SpreadsheetApp.openById(cfg.idVouchers).getSheetByName(hoja);
  if (!sh) throw new Error('no existe la pestaña ' + hoja);
  if (fila < 2 || fila > sh.getLastRow()) throw new Error('la fila ' + fila + ' no tiene datos');
  var v = sh.getRange(fila, 1, 1, 14).getValues()[0];
  var archivo = String(v[10] || '').trim(), pagina = parseInt(v[12], 10) || 1;
  if (!archivo) throw new Error('la fila no tiene «Archivo Original» (columna K)');
  var f = TGRL_archivo_(archivo);
  if (!f) throw new Error('no encontré el archivo «' + archivo + '» en Drive');
  var mime = f.getMimeType(), esPdf = /pdf/i.test(mime), base64;
  if (esPdf) {
    TGP_pdfLib_();
    var doc = await PDFLib.PDFDocument.load(new Uint8Array(f.getBlob().getBytes()));
    var total = doc.getPageCount();
    if (pagina > total) throw new Error('«' + archivo + '» tiene ' + total + ' páginas y la fila dice página ' + pagina);
    var uno = await PDFLib.PDFDocument.create();
    var cop = await uno.copyPages(doc, [pagina - 1]);
    uno.addPage(cop[0]);
    var bytes = await uno.save();
    base64 = Utilities.base64Encode(Utilities.newBlob([].slice.call(new Int8Array(bytes)), 'application/pdf').getBytes());
    mime = 'application/pdf';
  } else base64 = Utilities.base64Encode(f.getBlob().getBytes());
  var c = TGP_ctx_(ss);
  var r = IA_llamarSeguro_(c.ia, { sistema: TGP_SISTEMA_, maxTokens: 4000, adjunto: { mime: mime, base64: base64 },
    texto: 'Página ' + pagina + ' del archivo ' + archivo + '. Extrae los vouchers. El N° de operación cópialo dígito por dígito, con los ceros del inicio y del final.' });
  var docs = TGP_docsDe_(r, mime).docs.filter(function (d) { return TGP_tipo_(d) === 'voucher'; });
  if (!docs.length) throw new Error('la IA no encontró ningún voucher legible en la página ' + pagina + ' de «' + archivo + '». No cambié nada');
  if (!esPdf && docs.length > 1 && pagina <= docs.length) docs = [docs[pagina - 1]].concat(docs.filter(function (x, i) { return i !== pagina - 1; }));
  var nuevos = docs.slice(0, 5).map(function (d) {
    return { fecha: String(d.fecha || ''), op: String(d.operacion || '').trim(), banco: String(d.banco || ''), moneda: TGP_moneda_(d.moneda) || 'PEN',
      monto: AUV_num_(d.monto), prov: String(d.beneficiario || ''), cliente: String(d.ordenante || ''), desc: String(d.concepto || '') };
  });
  var antes = { fecha: v[0] instanceof Date ? Utilities.formatDate(v[0], 'America/Lima', 'dd/MM/yyyy') : String(v[0] || ''), op: String(v[1] || ''),
    banco: String(v[2] || ''), moneda: String(v[3] || ''), monto: AUV_num_(v[4]), prov: String(v[5] || '') };
  // ¿Ese N° de operación ya está en otra fila de la pestaña? (se anota como [DUPLICADO], igual que al procesar)
  var datos = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues(), dig = function (x) { return String(x || '').replace(/\D/g, '').replace(/^0+/, ''); };
  nuevos.forEach(function (n) {
    n.dup = 0;
    if (!dig(n.op)) return;
    for (var i = 0; i < datos.length; i++) {
      if (i + 2 !== fila && dig(datos[i][1]) === dig(n.op) && Math.abs(AUV_num_(datos[i][4]) - n.monto) <= 0.05) { n.dup = i + 2; break; }
    }
  });
  var extra = sh.getLastColumn() > 14 ? sh.getRange(fila, 15, 1, sh.getLastColumn() - 14).getValues()[0] : [];
  var agregado = extra.some(function (x) { return x !== '' && x !== false && x !== null; });
  var k = TG_guardarBoton_({ t: 'rlee', hoja: hoja, fila: fila, nuevos: nuevos, esPdf: esPdf });
  var linea = function (x) {
    return [x.fecha, x.banco, x.op ? 'op ' + x.op : 'sin op', (x.moneda === 'USD' || /USD|US\$/i.test(x.moneda) ? 'US$ ' : 'S/ ') + TGP_num_(x.monto), String(x.prov || '').slice(0, 40)]
      .filter(String).join(' · ');
  };
  var txt = '🔁 *' + hoja + '!' + fila + '* · ' + archivo + ' · página ' + pagina +
    '\n(versión del ' + Utilities.formatDate(f.getDateCreated(), 'America/Lima', 'dd/MM/yyyy HH:mm') + ')\n\nANTES: ' + linea(antes) +
    (nuevos.length === 1 ? '\nAHORA: ' + linea(nuevos[0]) : '\n\nEn la página leí ' + nuevos.length + ' vouchers:\n' + nuevos.map(function (x, i) { return (i + 1) + ') ' + linea(x); }).join('\n')) +
    (nuevos.some(function (x) { return x.dup; }) ? '\n\n⚠️ ' + nuevos.filter(function (x) { return x.dup; }).map(function (x) { return 'op ' + x.op + ' ya está en la fila ' + x.dup; }).join('; ') + ': se anota como [DUPLICADO].' : '') +
    (agregado ? '\n\nℹ️ La fila tiene datos agregados (revisado, empresa, factura…): no los toco, revíselos después.' : '') +
    '\n\n¿Reemplazo los datos de la fila? (se puede deshacer)';
  var tg = nuevos.map(function (x, i) { return [{ text: nuevos.length > 1 ? '✅ Poner el ' + (i + 1) : '✅ Reemplazar', callback_data: 'k:' + k + ':' + i }]; })
    .concat([[{ text: '✖ No cambiar', callback_data: 'k:' + k + ':no' }]]);
  var wa = { k: k, texto: '¿Reemplazo ' + hoja + '!' + fila + '?', opciones: nuevos.slice(0, 2).map(function (x, i) {
    return { op: String(i), titulo: nuevos.length > 1 ? '✅ Poner el ' + (i + 1) : '✅ Reemplazar' }; }).concat([{ op: 'no', titulo: '✖ No cambiar' }]) };
  TGRL_decir_(chat, txt, tg, wa);
}

/** Botón: '0'..'4' reemplazar con ese voucher · 'no' · 'u' deshacer. Devuelve el texto de respuesta. */
function TGRL_boton_(acc, op, chat) {
  if (op === 'no') return 'Listo, no cambié nada.';
  var cfg = TG_cfg_(TG_ss_()), sh = SpreadsheetApp.openById(cfg.idVouchers).getSheetByName(acc.hoja);
  if (op === 'u') {
    if (!acc.previo) return 'No hay nada que deshacer.';
    acc.previo.forEach(function (x, j) { try { sh.getRange(acc.fila, j + 1).setValue(x && x.d ? new Date(x.d) : x); } catch (e) {} });
    try { sh.getRange(acc.fila, 2).setNote(acc.notaPrevia || ''); } catch (e) {}
    return '↩️ ' + acc.hoja + '!' + acc.fila + ' volvió a como estaba (la imagen se rehace sola con la reparación automática).';
  }
  var n = (acc.nuevos || [])[Number(op)];
  if (!n) return 'Esa opción ya no existe.';
  if (TG_yaVisto_('rlee' + acc.hoja + acc.fila + op + JSON.stringify(n).length)) return 'Eso ya se hizo.';
  var previo = sh.getRange(acc.fila, 1, 1, 9).getValues()[0], notaPrevia = sh.getRange(acc.fila, 2).getNote();
  var p = n.fecha.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  var fecha = p ? new Date(Number(p[3]) < 100 ? 2000 + Number(p[3]) : Number(p[3]), Number(p[2]) - 1, Number(p[1])) : n.fecha;
  var valores = [fecha, n.dup ? '[DUPLICADO]' : n.op, n.banco, n.moneda, n.monto, n.prov, null, n.cliente || null, n.desc || null];
  valores.forEach(function (x, j) {
    if (x === null) return;   // idCliente / cliente / descripción: solo si la IA los trae
    try { sh.getRange(acc.fila, j + 1).setValue(x); } catch (e) { console.warn('Releer col ' + (j + 1) + ': ' + e.message); }
  });
  var ahora = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm:ss');
  try { sh.getRange(acc.fila, 12).setValue(ahora); } catch (e) {}
  try {
    sh.getRange(acc.fila, 2).setNote('🔁 Releído con IA ' + ahora.slice(0, 16) + ' (' + (String(chat).indexOf('wa') === 0 ? 'WhatsApp' : 'Telegram') + ').\nAntes: ' +
      [previo[0] instanceof Date ? Utilities.formatDate(previo[0], 'America/Lima', 'dd/MM/yyyy') : previo[0], previo[2], 'op ' + previo[1], previo[3] + ' ' + previo[4], previo[5]].join(' · ') +
      (notaPrevia ? '\n\n' + notaPrevia : ''));
  } catch (e) {}
  // Imagen: si es un PDF se vacía la celda J y la reparación automática de la hoja de Vouchers pone la página nueva.
  if (acc.esPdf) { try { sh.getRange(acc.fila, 10).clearContent(); } catch (e) {} }
  acc.previo = previo.map(function (x) { return x instanceof Date ? { d: x.getTime() } : x; });
  acc.notaPrevia = notaPrevia;
  acc.kDeshacer = TG_guardarBoton_(acc);
  return '✅ ' + acc.hoja + '!' + acc.fila + ' actualizada' + (n.dup ? ' (como [DUPLICADO]: el op ' + n.op + ' ya está en la fila ' + n.dup + ')' : '') + '.' +
    (acc.esPdf ? ' La imagen de la página se pone sola en unos minutos (reparación automática).' : '');
}

function TGRL_botonTG_(ctx, datos, op) {
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  var t = TGRL_boton_(datos, op, String(ctx.chatId));
  var undo = datos.kDeshacer && op !== 'u' && op !== 'no' ? [[{ text: '↩️ Deshacer', callback_data: 'k:' + datos.kDeshacer + ':u' }]] : null;
  TG_enviar_(ctx.chatId, TG_esc_(t), undo);
}

function TGRL_botonWA_(acc, op, numero) {
  var t;
  try { t = TGRL_boton_(acc, op, 'wa' + String(numero || '').replace(/\D/g, '')); } catch (e) { return { ok: true, respuesta: '❌ ' + e.message }; }
  var out = { ok: true, respuesta: t };
  if (acc.kDeshacer && op !== 'u' && op !== 'no') out.botones = [{ k: acc.kDeshacer, texto: '¿Algo salió mal?', opciones: [{ op: 'u', titulo: '↩️ Deshacer' }] }];
  return out;
}

/** El archivo con ese nombre más nuevo (si se volvió a subir con el mismo nombre). */
function TGRL_archivo_(nombre) {
  var it = DriveApp.getFilesByName(nombre), mejor = null;
  while (it.hasNext()) {
    var f = it.next();
    try { if (f.isTrashed()) continue; } catch (e) {}
    if (!/pdf|^image\//i.test(f.getMimeType())) continue;
    if (!mejor || f.getDateCreated() > mejor.getDateCreated()) mejor = f;
  }
  return mejor;
}
