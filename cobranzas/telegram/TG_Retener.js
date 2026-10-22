/**
 * 🧾 Emitir comprobantes de retención (CRE) pendientes — Telegram y WhatsApp.  Prefijo TGR_.
 *
 * Lee de Cuentas por Cobrar y Pagar los pagos a proveedores que se hicieron SIN su comprobante de
 * retención (pestaña _Retenciones datos, parte de vouchers: "🔴 Se pagó sin retener") y arma por cada
 * pago la solicitud del CRE: facturas, notas de crédito, fecha e importe del pago y 3 % esperado.
 *
 *   👁 Vista previa → GitHub (retenciones-cre.yml, modo vista) llena el CRE en SEE-SOL y se detiene
 *                     antes de "Emitir". No emite nada.
 *   ✅ Emitir        → pide confirmar ("Sí, emitir") y recién ahí GitHub emite (modo emitir) con la
 *                     clave de ESA solicitud: sha256("empresa|proveedor|total")[:10]. El robot emite solo
 *                     si SUNAT calcula ese mismo total y la factura no tiene ya un comprobante.
 * En Telegram solo un administrador puede emitir; en WhatsApp, los números que un administrador
 * autorice con /emitirwa <número>. El resultado (número del CRE o el motivo) llega al mismo chat.
 */

var TGR_WF_ = 'retenciones-cre.yml';
var TGR_PROP_WA_ = 'TGR_WA_ADMINS';
var TGR_MAX_ = 8;

/* ============================================================ propuestas desde la hoja */

/** {lista:[propuesta], fuera:n, otras:n, hoja:'dd/mm hh:mm'}. Propuesta = {k, titulo, s (solicitud), total, falta}. */
function TGR_pendientes_(ss) {
  var cfg = leerConfig_(ss), rucDe = {};
  Object.keys(cfg.nombreEmpresa || {}).forEach(function (r) { rucDe[String(cfg.nombreEmpresa[r])] = r; });
  var sh = ss.getSheetByName('_Retenciones datos');
  if (!sh || sh.getLastRow() < 2) return { lista: [], fuera: 0, otras: 0 };
  var v = sh.getRange(1, 1, sh.getLastRow(), Math.min(sh.getLastColumn(), 47)).getValues();
  var enc = v[0].map(String), c0 = enc.indexOf('Empresa', 30);   // tercera tabla: vouchers
  if (c0 < 0) return { lista: [], fuera: 0, otras: 0 };
  var I = {}; enc.slice(c0, c0 + 16).forEach(function (h, j) { I[h] = c0 + j; });

  var movs = TGR_movimientos_(ss), docs = TGR_documentos_(ss);
  var hoy = new Date(Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd') + 'T12:00:00');
  var minEmision = new Date(hoy.getTime() - 5 * 864e5);
  var minPago = new Date(minEmision.getFullYear(), minEmision.getMonth(), 1);
  var out = { lista: [], fuera: 0, otras: 0 };
  v.slice(1).forEach(function (r) {
    if (String(r[I['Lado']]) !== 'Debemos retener' || !/^(🔴|🟠)/.test(String(r[I['Situación']])) || !(aNumero_(r[I['Falta S/']]) > 0)) return;
    var empresa = String(r[I['Empresa']]), empresaRuc = rucDe[empresa] || '', prov = String(r[I['RUC']]).replace(/\D/g, '');
    var fecha = aFecha_(r[I['Fecha']]), op = String(r[I['N° operación']]);
    if (!fecha || !empresaRuc || String(r[I['Moneda']]) !== 'PEN') { out.otras++; return; }
    if (fecha < minPago || fecha > hoy) { out.fuera++; return; }   // SEE-SOL: el pago debe ser del mes de emisión
    var docsS = [], total = 0;
    String(r[I['Facturas que pagó (sujetas)']]).split(/\s*,\s*/).filter(String).forEach(function (etq) {
      var m = etq.match(/^(\d{2})_([A-Z0-9]{4})-(\d+)$/i);
      if (!m || m[1] !== '01') return;
      var mv = movs[[empresa, prov, etq].join('|')] || { pagos: {}, nc: [] };
      var aplicado = mv.pagos[op] || 0, d = docs[[empresa, prov, etq].join('|')];
      if (!aplicado) return;
      var neto = d ? d.total - d.nc : 0;
      var bruto = Math.round(aplicado / 0.97 * 100) / 100;     // se pagó descontando el 3 % …
      if (neto && bruto > neto + 0.05) bruto = aplicado;         // … o se pagó completo sin descontar
      var ret = Math.round(bruto * 3) / 100;
      total += ret;
      docsS.push({ tipo: '01', serie: m[2].toUpperCase(), numero: m[3], notas_credito: mv.nc,
        fecha_pago: Utilities.formatDate(fecha, 'America/Lima', 'dd/MM/yyyy'), importe_pago: bruto, retencion: ret });
    });
    if (!docsS.length) { out.otras++; return; }
    total = Math.round(total * 100) / 100;
    var emision = fecha.getMonth() === hoy.getMonth() ? hoy : new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0, 12);
    var s = { empresa_ruc: empresaRuc, proveedor_ruc: prov, fecha_emision: Utilities.formatDate(emision, 'America/Lima', 'dd/MM/yyyy'),
      observacion: '', documentos: docsS };
    out.lista.push({
      titulo: empresa + ' → ' + String(r[I['Proveedor / cliente']]).slice(0, 40),
      detalle: 'Pago ' + Utilities.formatDate(fecha, 'America/Lima', 'dd/MM') + ' · ' + r[I['Banco']] + ' op ' + op + ' · ' +
        docsS.map(function (x) { return x.serie + '-' + x.numero + (x.notas_credito.length ? ' (con N/C ' + x.notas_credito.map(function (n) { return n.serie + '-' + n.numero; }).join(', ') + ')' : ''); }).join(', '),
      s: s, total: total, falta: aNumero_(r[I['Falta S/']]), empresa: empresa, proveedor: String(r[I['Proveedor / cliente']])
    });
  });
  out.lista.sort(function (a, b) { return a.s.documentos[0].fecha_pago < b.s.documentos[0].fecha_pago ? 1 : -1; });
  return out;
}

/** Monto aplicado por voucher y notas de crédito de cada factura: clave "empresa|ruc|01_F001-1". */
function TGR_movimientos_(ss) {
  var sh = ss.getSheetByName(HOJA.MOVS), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(1, 1, sh.getLastRow(), ENC_MOVS_.length).getValues(), I = {};
  v[0].forEach(function (h, j) { I[h] = j; });
  v.slice(1).forEach(function (r) {
    var k = [r[I['Empresa que paga']], String(r[I['RUC beneficiario']]).replace(/\D/g, ''), r[I['Documento']]].join('|');
    var x = out[k] = out[k] || { pagos: {}, nc: [] }, mod = String(r[I['Modalidad']]), op = String(r[I['N° operación']]);
    if (mod === 'Pago') x.pagos[op] = (x.pagos[op] || 0) + aNumero_(r[I['Monto aplicado']]);
    var m = op.match(/^([A-Z0-9]{4})-(\d+)$/i);
    if (mod === 'N/C' && m) x.nc.push({ serie: m[1].toUpperCase(), numero: m[2] });
  });
  return out;
}

/** Total y N/C de cada factura por pagar: clave "empresa|ruc|01_F001-1". */
function TGR_documentos_(ss) {
  var sh = ss.getSheetByName(HOJA.DOCS), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(1, 1, sh.getLastRow(), ENC_DOCS_.length).getValues(), I = {};
  v[0].forEach(function (h, j) { I[h] = j; });
  v.slice(1).forEach(function (r) {
    if (r[I['Tipo']] !== 'Por pagar') return;
    out[[r[I['Empresa']], String(r[I['RUC contraparte']]).replace(/\D/g, ''), r[I['Documento']]].join('|')] =
      { total: aNumero_(r[I['Total']]), nc: aNumero_(r[I['N/C']]) };
  });
  return out;
}

/** Clave de confirmación (la misma que calcula retenciones/emision/emitir_cre.py). */
function TGR_clave_(s) {
  var total = s.documentos.reduce(function (t, d) { return t + Number(d.retencion); }, 0);
  var txt = s.empresa_ruc + '|' + s.proveedor_ruc + '|' + (Math.round(total * 100) / 100).toFixed(2);
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, txt, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 10);
}

function TGR_pedir_(cfg, s, modo) {
  TG_gh_(cfg, '/actions/workflows/' + TGR_WF_ + '/dispatches', 'post', { ref: cfg.rama, inputs: {
    ruc: s.empresa_ruc, solicitud: JSON.stringify(s), modo: modo, confirmar: modo === 'emitir' ? TGR_clave_(s) : '' } });
}

function TGR_textoPropuesta_(p, n) {
  return (n ? n + '. ' : '') + '<b>' + TG_esc_(p.titulo) + '</b>\n   ' + TG_esc_(p.detalle) +
    '\n   Retención: <b>S/ ' + TG_num_(p.total) + '</b>' + (Math.abs(p.total - p.falta) > 1 ? ' <i>(la hoja dice S/ ' + TG_num_(p.falta) + ': revise con 👁 Vista previa)</i>' : '');
}

function TGR_encabezado_(r) {
  return '🧾 <b>Comprobantes de retención por emitir</b> (' + r.lista.length + ')\n' +
    '<i>Pagos de este mes que se hicieron sin su CRE, según la hoja de Cobranzas. Si alguno ya se emitió, el robot lo ve en SUNAT y no lo duplica.</i>' +
    (r.fuera ? '\n⌛ ' + r.fuera + ' pago(s) de meses anteriores ya no se pueden emitir por SEE-SOL (fuera de plazo): revíselos con su contador.' : '') +
    (r.otras ? '\n⚠️ ' + r.otras + ' pago(s) en dólares o sin datos completos: hágalos a mano en SOL.' : '');
}

/* ============================================================ Telegram */

function TGR_comandoTG_(ctx) {
  TG_accion_(ctx.chatId, 'typing');
  var r;
  try { r = TGR_pendientes_(ctx.ss); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ No pude leer las retenciones: ' + TG_esc_(e.message)); }
  if (!r.lista.length) return TG_enviar_(ctx.chatId, TGR_encabezado_(r) + '\n\n✅ No hay pagos de este mes pendientes de comprobante.');
  var filas = [], lineas = [];
  r.lista.slice(0, TGR_MAX_).forEach(function (p, i) {
    var k = TG_guardarBoton_({ t: 'cre', p: p });
    lineas.push(TGR_textoPropuesta_(p, i + 1));
    filas.push([{ text: '👁 ' + (i + 1) + ' Vista previa', callback_data: 'k:' + k + ':vp' }, { text: '✅ ' + (i + 1) + ' Emitir', callback_data: 'k:' + k + ':em' }]);
  });
  TG_enviar_(ctx.chatId, TGR_encabezado_(r) + '\n\n' + lineas.join('\n\n') +
    (r.lista.length > TGR_MAX_ ? '\n\n… y ' + (r.lista.length - TGR_MAX_) + ' más (emita estos primero).' : '') +
    '\n\n👁 <i>Vista previa</i> llena el comprobante en SUNAT sin emitir. ✅ <i>Emitir</i> le pide confirmar antes.', filas);
}

function TGR_alBotonTG_(ctx, datos, op, k) {
  var cfg = TG_cfg_(ctx.ss), p = datos.p;
  if (op === 'no') return TG_editarOEnviar_(ctx, '✖ No se emitió nada.', null);
  if (op === 'em') {
    return TG_enviar_(ctx.chatId, '⚠️ <b>¿Emito este comprobante de retención en SUNAT?</b>\n' + TGR_textoPropuesta_(p, 0) +
      '\n\nEs una operación real ante SUNAT. El robot emite solo si SUNAT calcula exactamente S/ ' + TG_num_(p.total) + ' y la factura no tiene ya un comprobante.',
      [[{ text: '✅ Sí, emitir', callback_data: 'k:' + k + ':ok' }, { text: '✖ No', callback_data: 'k:' + k + ':no' }]]);
  }
  if (op === 'ok' && (!ctx.usuario || ctx.usuario.rol !== 'admin')) return TG_enviar_(ctx.chatId, 'Solo un administrador puede emitir comprobantes de retención.');
  if (op === 'ok' || op === 'vp') {
    var modo = op === 'ok' ? 'emitir' : 'vista';
    if (TG_yaVisto_('cre' + modo + k)) return TG_enviar_(ctx.chatId, 'Eso ya se pidió.');
    if (op === 'ok') TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
    try { TGR_pedir_(cfg, p.s, modo); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ No pude pedirlo a GitHub: ' + TG_esc_(e.message)); }
    TG_seguir_(ctx.chatId, TGR_WF_, null, p.titulo, { tipo: 'cre', modo: modo, k: k, total: p.total });
    return TG_enviar_(ctx.chatId, (modo === 'emitir' ? '🧾 <b>Emitiendo</b> en SUNAT' : '👁 <b>Preparando la vista previa</b> en SUNAT (no se emite)') +
      ': ' + TG_esc_(p.titulo) + '\nTarda 1–2 minutos; le aviso aquí el resultado.');
  }
}

/** /emitirwa 51987654321 → autoriza (o quita) ese número de WhatsApp para emitir. Solo administradores. */
function TGR_emitirWA_(ctx, arg) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  var props = PropertiesService.getScriptProperties(), l = (props.getProperty(TGR_PROP_WA_) || '').split(',').filter(String);
  var n = String(arg || '').replace(/\D/g, '');
  if (n) l = l.indexOf(n) >= 0 ? l.filter(function (x) { return x !== n; }) : l.concat([n]);
  props.setProperty(TGR_PROP_WA_, l.join(','));
  TG_enviar_(ctx.chatId, '📲 Números de WhatsApp que pueden emitir comprobantes de retención: ' + (l.length ? l.join(', ') : 'ninguno') +
    '\n<i>Escriba /emitirwa y el número para agregarlo o quitarlo.</i>');
}

/* ============================================================ resultado (lo llama TG_seguirDescargas) */

function TGR_avisarFin_(cfg, s, r) {
  var notas = [];
  try {
    (TG_gh_(cfg, '/actions/runs/' + r.id + '/jobs').jobs || []).forEach(function (j) {
      notas = notas.concat(TG_gh_(cfg, '/check-runs/' + j.id + '/annotations') || []);
    });
  } catch (e) {}
  var nota = function (rx) { return notas.filter(function (n) { return rx.test(n.title || ''); })[0]; };
  var ok = nota(/^CRE emitido/), vista = nota(/^CRE vista/), no = nota(/^CRE no emitido/), sin = nota(/^CRE sin confirmar/);
  var html, k = s.extra.k;
  if (ok) html = '✅ <b>Comprobante de retención emitido: ' + TG_esc_(ok.message) + '</b>\n' + TG_esc_(s.texto) + ' · S/ ' + TG_num_(s.extra.total) +
    '\n<i>El PDF y el XML llegan con la próxima descarga de Retenciones.</i>';
  else if (vista) html = '👁 <b>Vista previa lista</b>: ' + TG_esc_(s.texto) + '\nSUNAT aceptó todo y calculó S/ ' + TG_num_(s.extra.total) + '. <b>No se emitió nada.</b>';
  else if (sin) html = '⚠️ <b>Se tocó Emitir pero no confirmé el número</b>: ' + TG_esc_(s.texto) + '\nRevise en SOL → Consultar emisión antes de volver a intentar.';
  else if (no) html = '⛔ <b>No se emitió</b>: ' + TG_esc_(s.texto) + '\n' + TG_esc_(no.message);
  else html = '❌ <b>El robot de retenciones falló</b>: ' + TG_esc_(s.texto) + '. No se emitió nada.';
  html += '\n<a href="' + r.html_url + '">ver en GitHub</a>';
  if (String(s.chat).indexOf('wa') === 0) return TGR_guardarWA_(s.chat, html + (vista ? '\n\nPara emitirlo, escriba *emitir* y toque ✅ Emitir.' : ''));
  TG_enviar_(s.chat, html, vista && k ? [[{ text: '✅ Emitir', callback_data: 'k:' + k + ':em' }]] : null);
}

function TGR_guardarWA_(clave, html) {
  var p = PropertiesService.getScriptProperties(), k = TGP_PROP_MSG_ + clave, l = [];
  try { l = JSON.parse(p.getProperty(k) || '[]'); } catch (e) {}
  l.push(html);
  p.setProperty(k, JSON.stringify(l.slice(-10)));
}

/** ¿Hay un CRE pedido desde este chat de WhatsApp que todavía no terminó? (para que la app siga preguntando) */
function TGR_pendienteWA_(clave) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('TG_SEGUIR') || '[]')
      .some(function (s) { return s.chat === clave && s.extra && s.extra.tipo === 'cre'; });
  } catch (e) { return false; }
}

/* ============================================================ WhatsApp */

function TGR_listaWA_(ss) {
  var r = TGR_pendientes_(ss), html = TGR_encabezado_(r);
  if (!r.lista.length) return { ok: true, respuesta: html + '\n\n✅ No hay pagos de este mes pendientes de comprobante.', tablas: [], sugerencias: [], archivos: [], avisos: [] };
  var botones = r.lista.slice(0, 5).map(function (p, i) {
    return { k: TG_guardarBoton_({ t: 'cre', p: p }), texto: TGR_textoPropuesta_(p, i + 1),
      opciones: [{ op: 'vp', titulo: '👁 Vista previa' }, { op: 'em', titulo: '✅ Emitir' }] };
  });
  return { ok: true, respuesta: html + (r.lista.length > 5 ? '\n\nLe muestro los 5 más recientes.' : ''), tablas: [], sugerencias: [], archivos: [], avisos: [], botones: botones };
}

function TGR_botonWA_(acc, k, op, numero) {
  var cfg = TG_cfg_(TG_ss_()), p = acc.p, clave = 'wa' + String(numero || '').replace(/\D/g, '');
  if (op === 'no') return { ok: true, respuesta: '✖ No se emitió nada.' };
  if (op === 'em') return { ok: true, respuesta: '⚠️ *¿Emito este comprobante de retención en SUNAT?*\n' + TGR_textoPropuesta_(p, 0) +
    '\n\nEs una operación real ante SUNAT. El robot emite solo si SUNAT calcula exactamente S/ ' + TG_num_(p.total) + '.',
    botones: [{ k: k, texto: '¿Emitir?', opciones: [{ op: 'ok', titulo: '✅ Sí, emitir' }, { op: 'no', titulo: '✖ No' }] }] };
  var permitidos = (PropertiesService.getScriptProperties().getProperty(TGR_PROP_WA_) || '').split(',');
  if (op === 'ok' && permitidos.indexOf(clave.slice(2)) < 0)
    return { ok: true, respuesta: 'Este número no está autorizado para emitir. Un administrador lo autoriza en Telegram con /emitirwa ' + clave.slice(2) + '. La 👁 vista previa sí la puede pedir.' };
  if (op !== 'ok' && op !== 'vp') return { ok: true, respuesta: 'No entendí ese botón.' };
  var modo = op === 'ok' ? 'emitir' : 'vista';
  if (TG_yaVisto_('cre' + modo + k)) return { ok: true, respuesta: 'Eso ya se pidió.' };
  try { TGR_pedir_(cfg, p.s, modo); } catch (e) { return { ok: false, error: 'No pude pedirlo a GitHub: ' + e.message }; }
  TG_seguir_(clave, TGR_WF_, null, p.titulo, { tipo: 'cre', modo: modo, k: k, total: p.total });
  return { ok: true, seguir: true, respuesta: (modo === 'emitir' ? '🧾 *Emitiendo* en SUNAT' : '👁 *Preparando la vista previa* en SUNAT (no se emite)') +
    ': ' + p.titulo + '\nTarda 1–2 minutos; le aviso aquí el resultado.' };
}
