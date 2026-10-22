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
  TGR_proponerTG_(ctx, r.lista, TGR_encabezado_(r));
}

/** Manda las propuestas con sus botones 👁 Vista previa / ✅ Emitir (lo usan /emitir, el pedido escrito y la IA). */
function TGR_proponerTG_(ctx, lista, encabezado) {
  var filas = [], lineas = [];
  lista.slice(0, TGR_MAX_).forEach(function (p, i) {
    var k = TG_guardarBoton_({ t: 'cre', p: p });
    lineas.push(TGR_textoPropuesta_(p, i + 1));
    filas.push([{ text: '👁 ' + (i + 1) + ' Vista previa', callback_data: 'k:' + k + ':vp' }, { text: '✅ ' + (i + 1) + ' Emitir', callback_data: 'k:' + k + ':em' }]);
  });
  TG_enviar_(ctx.chatId, encabezado + '\n\n' + lineas.join('\n\n') +
    (lista.length > TGR_MAX_ ? '\n\n… y ' + (lista.length - TGR_MAX_) + ' más (emita estos primero).' : '') +
    '\n\n👁 <i>Vista previa</i> llena el comprobante en SUNAT sin emitir. ✅ <i>Emitir</i> le pide confirmar antes.', filas);
}

/* ============================================================ pedido escrito o desde la IA */

// "emite la retención de F001-215", "puedes emitir retención en sunat", "genera el CRE" (no "¿ya está emitida…?").
var TGR_PIDE_RX_ = /\b(emitir|emite|emita|emitas|em[ií]te(la|lo|las|los|me)\w*|generar|genera|genere|gen[eé]ra(la|lo)\w*|hacer|haz|hazme|sacar|saca|s[aá]ca(la|lo)\w*)\b/i;
var TGR_CRE_RX_ = /\b(retenci[oó]n(es)?|cre)\b/i;

/** ¿El texto pide emitir un comprobante de retención? */
function TGR_esPedido_(texto) {
  var t = String(texto || '');
  if (/^\s*\/?(emitir|retener|cre|retenciones por emitir|emitir retenciones)\s*$/i.test(t)) return true;
  return TGR_PIDE_RX_.test(t) && TGR_CRE_RX_.test(t) && !/emitid[oa]s?\b/i.test(t);
}

/** "F001-215", "01_F001-00000215", "E001 - 4054" → "F001-215" (sin ceros a la izquierda). '' si no hay. */
function TGR_normDoc_(t) {
  var m = String(t || '').toUpperCase().match(/\b([FE][A-Z0-9]{3})\s*-\s*0*(\d{1,8})\b/) || String(t || '').toUpperCase().match(/_([FE][A-Z0-9]{3})-0*(\d{1,8})\b/);
  return m ? m[1] + '-' + Number(m[2]) : '';
}

/**
 * Busca qué comprobante emitir. q = {doc:'F001-215', empresa:RUC, proveedor:texto}.
 * → {lista:[propuesta]} si hay algo que emitir, o {motivo:'…', filas:[…]} explicando por qué no (según la hoja).
 */
function TGR_buscar_(ss, cob, q) {
  var r = TGR_pendientes_(ss);
  var lista = r.lista.filter(function (p) {
    if (q.doc && !p.s.documentos.some(function (d) { return d.serie + '-' + Number(d.numero) === q.doc; })) return false;
    if (q.empresa && p.s.empresa_ruc !== q.empresa) return false;
    if (q.proveedor && !ANA_coincide_(q.proveedor, p.s.proveedor_ruc, p.proveedor)) return false;
    return true;
  });
  if (lista.length) return { lista: lista, r: r };
  if (!q.doc) return { motivo: r.lista.length ? 'Con esos datos no encontré un pago pendiente de comprobante.' : 'No hay pagos de este mes pendientes de comprobante de retención.', filas: [], r: r };
  return TGR_porQueNo_(ss, q, r);
}

/** Por qué una factura no está para emitir: lo que dice la hoja (📋 Documentos y la parte de vouchers de _Retenciones datos). */
function TGR_porQueNo_(ss, q, r) {
  var sh = ss.getSheetByName(HOJA.DOCS), filas = [];
  if (sh && sh.getLastRow() > 1) {
    var v = sh.getRange(1, 1, sh.getLastRow(), ENC_DOCS_.length).getValues(), I = {};
    v[0].forEach(function (h, j) { I[h] = j; });
    v.slice(1).forEach(function (x) {
      if (x[I['Tipo']] !== 'Por pagar' || TGR_normDoc_(x[I['Documento']]) !== q.doc) return;
      filas.push({ empresa: String(x[I['Empresa']]), contraparte: String(x[I['Contraparte']]), documento: String(x[I['Documento']]),
        total: aNumero_(x[I['Total']]), pagado: aNumero_(x[I['Pagado']]), estado: String(x[I['Estado']]),
        retener: String(x[I['¿Retener? (IGV 3%)']] || ''), esperada: aNumero_(x[I['Retención esperada S/']]) });
    });
  }
  if (!filas.length) return { motivo: 'No encontré la factura ' + q.doc + ' en Cuentas por Pagar (📋 Documentos). Si es nueva, actualice la hoja de Cobranzas.', filas: [], r: r };
  // Si la misma serie-número está en más de una fila (otra empresa del grupo), manda la que la hoja evaluó para retención.
  filas.sort(function (a, b) { return (b.retener ? 1 : 0) - (a.retener ? 1 : 0); });
  var f = filas[0], t = f.retener, motivo;
  if (!t) motivo = 'La hoja no evalúa retención para esta factura: la empresa compradora no era agente de retención en esa fecha.';
  else if (/^No:/.test(t)) motivo = 'No corresponde emitir comprobante de retención: ' + t.replace(/^No:\s*/, '') + ' (según la hoja de Cobranzas).';
  else if (/^✅/.test(t)) motivo = 'Ya está retenida: ' + t + '.';
  else if (/^⏳/.test(t)) motivo = 'Todavía no se pagó: se retiene S/ ' + TG_num_(f.esperada) + ' al pagarla (paga el total menos la retención y emite el comprobante ese mes).';
  else {
    motivo = 'La hoja la marca "' + t + '" (retención S/ ' + TG_num_(f.esperada) + '), pero no armé el comprobante: ';
    var vs = TGR_vouchersDe_(ss, q.doc), hoy = new Date(Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd') + 'T12:00:00');
    var minPago = new Date(hoy.getTime() - 5 * 864e5); minPago = new Date(minPago.getFullYear(), minPago.getMonth(), 1);
    if (!vs.length) motivo += 'en la hoja no hay un voucher aplicado a esta factura. Registre el voucher (o actualice Cobranzas) y vuelva a pedirlo.';
    else if (vs.some(function (x) { return x.moneda !== 'PEN'; })) motivo += 'el pago está en dólares: hágalo a mano en SOL.';
    else if (vs.every(function (x) { return x.fecha && x.fecha < minPago; })) motivo += 'el pago es del ' + Utilities.formatDate(vs[0].fecha, 'America/Lima', 'dd/MM/yyyy') +
      ' y SEE-SOL solo emite comprobantes con pagos del mes en curso: hágalo con su contador.';
    else motivo += 'al voucher le falta un dato (empresa, fecha o monto aplicado). Revíselo en 🧾 Retenciones.';
  }
  return { motivo: motivo, filas: filas, r: r };
}

/** Vouchers (parte "Debemos retener" de _Retenciones datos) que pagaron esa factura: [{fecha, moneda, situacion}]. */
function TGR_vouchersDe_(ss, doc) {
  var sh = ss.getSheetByName('_Retenciones datos'), out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(1, 1, sh.getLastRow(), Math.min(sh.getLastColumn(), 47)).getValues();
  var enc = v[0].map(String), c0 = enc.indexOf('Empresa', 30);
  if (c0 < 0) return out;
  var I = {}; enc.slice(c0, c0 + 16).forEach(function (h, j) { I[h] = c0 + j; });
  v.slice(1).forEach(function (r) {
    if (String(r[I['Lado']]) !== 'Debemos retener') return;
    var docs = String(r[I['Facturas que pagó (sujetas)']]).split(/\s*,\s*/).map(TGR_normDoc_);
    if (docs.indexOf(doc) >= 0) out.push({ fecha: aFecha_(r[I['Fecha']]), moneda: String(r[I['Moneda']]), situacion: String(r[I['Situación']]) });
  });
  return out;
}

/** Telegram: texto que pide emitir una retención (con la factura escrita o en el mensaje citado). true si lo atendió. */
function TGR_atajoTG_(ctx, texto) {
  if (!TGR_esPedido_(texto)) return false;
  TG_accion_(ctx.chatId, 'typing');
  var cob = TG_cfg_(ctx.ss).cob, x;
  var q = { doc: TGR_normDoc_(texto) || TGR_normDoc_(ctx.citado), empresa: '' };
  try { x = TGR_buscar_(ctx.ss, cob, q); } catch (e) { TG_enviar_(ctx.chatId, '⚠️ No pude leer las retenciones: ' + TG_esc_(e.message)); return true; }
  if (x.lista) { TGR_proponerTG_(ctx, x.lista, '🧾 <b>Comprobante de retención por emitir' + (q.doc ? ' · ' + q.doc : '') + '</b>'); return true; }
  TG_enviar_(ctx.chatId, '🧾 <b>' + (q.doc ? 'Factura ' + TG_esc_(q.doc) : 'Comprobantes de retención') + '</b>\n' + TG_esc_(x.motivo) + TGR_filasTexto_(x.filas),
    [[{ text: '🧾 Ver todos los pendientes', callback_data: 'c:emitir' }]]);
  return true;
}

function TGR_filasTexto_(filas, plano) {
  var e = plano ? String : TG_esc_;
  return filas.slice(0, 3).map(function (f) {
    return '\n• ' + e(f.empresa) + ' · ' + e(f.documento) + ' de ' + e(f.contraparte) + ': total S/ ' + TG_num_(f.total) +
      ', pagado S/ ' + TG_num_(f.pagado) + ' · ' + e(f.estado) + (f.retener ? ' · ¿Retener?: ' + e(f.retener) : '');
  }).join('');
}

/** Herramienta de la IA: proponer_retencion {factura, empresa, proveedor}. */
function TGR_paraIA_(c, a) {
  var emp = a.empresa ? ANA_empresa_(c, a.empresa) : '';
  var q = { doc: TGR_normDoc_(a.factura || a.documento || ''), empresa: /^\d{11}$/.test(emp) ? emp : '', proveedor: String(a.proveedor || '').trim() };
  var x = TGR_buscar_(c.ss, c.cfg, q);
  if (x.lista) {
    c.op.tg.cre = (c.op.tg.cre || []).concat(x.lista.slice(0, 5));
    return { columnas: ['comprobante', 'pago', 'retención S/'], filas: x.lista.slice(0, 5).map(function (p) { return [p.titulo, p.detalle, p.total]; }),
      nota: 'PROPUESTO: el usuario ve cada uno con botones 👁 Vista previa y ✅ Emitir (pide confirmar; solo administradores emiten). Tú NO emites: dile cuánto es y que toque el botón.' };
  }
  return { columnas: ['empresa', 'documento', 'proveedor', 'total', 'pagado', 'estado', '¿Retener? (hoja)'],
    filas: x.filas.map(function (f) { return [f.empresa, f.documento, f.contraparte, f.total, f.pagado, f.estado, f.retener]; }),
    nota: 'NO hay comprobante para emitir. Motivo (de la hoja, dilo tal cual y no lo recalcules): ' + x.motivo };
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

/** ¿Hay un CRE o un ⚡ SIRE solo reporte pedido desde este chat de WhatsApp que todavía no terminó? (para que la app siga preguntando) */
function TGR_pendienteWA_(clave) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('TG_SEGUIR') || '[]')
      .some(function (s) { return s.chat === clave && s.extra && (s.extra.tipo === 'cre' || s.extra.tipo === 'sire_rapido'); });
  } catch (e) { return false; }
}

/* ============================================================ WhatsApp */

/** WhatsApp: botones de las propuestas (el mismo formato que usa la app para 👁 / ✅). */
function TGR_botonesWA_(lista) {
  return lista.slice(0, 5).map(function (p, i) {
    return { k: TG_guardarBoton_({ t: 'cre', p: p }), texto: TGR_textoPropuesta_(p, i + 1),
      opciones: [{ op: 'vp', titulo: '👁 Vista previa' }, { op: 'em', titulo: '✅ Emitir' }] };
  });
}

/** WhatsApp: "emite la retención de F001-215" (o citando el mensaje). null si el texto no lo pide. */
function TGR_atajoWA_(ss, texto, citado) {
  if (!TGR_esPedido_(texto)) return null;
  var q = { doc: TGR_normDoc_(texto) || TGR_normDoc_(citado), empresa: '' };
  if (!q.doc) return TGR_listaWA_(ss);
  var x = TGR_buscar_(ss, TG_cfg_(ss).cob, q);
  if (x.lista) return { ok: true, respuesta: '🧾 *Comprobante de retención por emitir · ' + q.doc + '*', tablas: [], sugerencias: [], archivos: [], avisos: [], botones: TGR_botonesWA_(x.lista) };
  return { ok: true, respuesta: '🧾 *Factura ' + q.doc + '*\n' + x.motivo + TGR_filasTexto_(x.filas, true), tablas: [], sugerencias: [], archivos: [], avisos: [] };
}

function TGR_listaWA_(ss) {
  var r = TGR_pendientes_(ss), html = TGR_encabezado_(r);
  if (!r.lista.length) return { ok: true, respuesta: html + '\n\n✅ No hay pagos de este mes pendientes de comprobante.', tablas: [], sugerencias: [], archivos: [], avisos: [] };
  var botones = TGR_botonesWA_(r.lista);
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
