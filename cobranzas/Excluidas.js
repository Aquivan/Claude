/**
 * 🚫 FACTURAS (y VOUCHERS u otros movimientos) EXCLUIDOS de Cobranzas y de todos los reportes (Mesa, Estado de cuenta, Para enviar, Telegram, vencimientos).
 *
 * Para los casos de excepción: una factura ANULADA (comunicación de baja) que igual aparece, una del año anterior que ya
 * se CANCELÓ antes de usar el sistema y sale como deuda, una DUPLICADA, etc. Se excluye desde la ficha 🔍 de la factura
 * (🧩 Mesa → 🔍 → 🚫 Excluir de los reportes) con su motivo; queda en la hoja «🚫 Facturas excluidas» (quién, cuándo,
 * por qué) y se puede volver a incluir (borrando la fila o con ↩️ en la Mesa). Las N/C - N/D que modifican una factura
 * excluida también salen (si no, quedarían «sin factura»). Lo general (todo lo de antes de una fecha) es la fecha
 * «Controlar documentos emitidos desde» de ⚙️ Configuración; esto es para casos puntuales.
 */

var EXC_HOJA_ = '🚫 Facturas excluidas';
var EXC_ENC_ = ['Clave', 'Documento', 'Proveedor / cliente', 'Empresa', 'Fecha', 'Moneda', 'Total', 'Motivo', 'Nota', 'Quién', 'Cuándo'];
var EXC_MOTIVOS_ = ['Anulada (comunicación de baja)', 'Cancelada antes del sistema (año anterior)', 'Duplicada', 'No corresponde a la empresa', 'Otro'];

function EXC_hoja_(ss, crear) {
  var sh = ss.getSheetByName(EXC_HOJA_);
  if (!sh && !crear) return null;
  if (!sh) {
    sh = ss.insertSheet(EXC_HOJA_);
    escribirTabla_(sh, 1, 1, EXC_ENC_, []);
    sh.setFrozenRows(1);
    sh.getRange('H2:H2000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(EXC_MOTIVOS_).setAllowInvalid(true).build());
    [200, 130, 260, 110, 90, 65, 100, 230, 260, 160, 130].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange('M1').setValue('ℹ️ Facturas que NO entran en Cobranzas ni en los reportes. Para volver a incluir una: borre su fila (o 🧩 Mesa → 📥 Saldos iniciales → 🚫 Excluidas → ↩️). La «Clave» es RUC emisor|tipo|serie|número: no la cambie.')
      .setWrap(true).setFontColor('#475569').setVerticalAlignment('top');
    sh.setColumnWidth(13, 380);
  }
  return sh;
}

/** {clave: motivo} de las facturas excluidas; {_p: {idPago: motivo}} de vouchers / movimientos («P|<id del pago>»). */
function EXC_mapa_(ss) {
  var sh = EXC_hoja_(ss, false), m = { _p: {} };
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(function (r) {
    var k = String(r[0] || '').trim();
    if (k.indexOf('P|') === 0) { m._p[k.slice(2)] = String(r[7] || 'Excluido'); return; }
    var p = k.split('|');
    if (p.length === 4 && p[0]) m[claveDoc_(p[0], p[1], p[2], p[3])] = String(r[7] || 'Excluida');
  });
  return m;
}

/** Saca los vouchers / pagos / retenciones excluidos antes del cruce. */
function EXC_filtrarPagos_(ss, pagos) {
  var m = EXC_mapa_(ss)._p, n = 0;
  if (!Object.keys(m).length) return { pagos: pagos, n: 0 };
  pagos = pagos.filter(function (p) { var f = m[String(p.id)]; if (f) n++; return !f; });
  return { pagos: pagos, n: n };
}

/** Saca las excluidas (y sus N/C - N/D) de la lista de documentos antes del cruce. */
function EXC_filtrar_(ss, docs) {
  var m = EXC_mapa_(ss), n = 0;
  if (Object.keys(m).length < 2) return { docs: docs, n: 0 };
  docs = docs.filter(function (d) {
    var t = normTipo_(d.tipo);
    var fuera = m[claveDoc_(d.emisorRuc, d.tipo, d.serie, d.numero)] ||
      ((t === '07' || t === '08') && d.modSerie && m[claveDoc_(d.emisorRuc, d.modTipo || '01', d.modSerie, d.modNumero)]);
    if (fuera) n++;
    return !fuera;
  });
  return { docs: docs, n: n };
}

function EXC_huella_(ss) {
  var sh = ss.getSheetByName(EXC_HOJA_);
  return sh && sh.getLastRow() > 1 ? hashTexto_(JSON.stringify(sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues())) : '';
}

/* ============================================================ 🧩 Mesa */

/** x = {k (clave), doc, cn, er, f, mon, tot, motivo, nota} */
function MESA_excluir(tk, x) {
  var quien = MESA_ok_(tk), ss = ssPrincipal_(), p = String(x.k || '').split('|');
  if (String(x.k).indexOf('P|') !== 0 && (p.length !== 4 || !p[0])) throw new Error('Documento no válido.');
  if (!x.motivo) throw new Error('Elija el motivo.');
  var sh = EXC_hoja_(ss, true), n = Math.max(0, sh.getLastRow() - 1);
  var ya = n && sh.getRange(2, 1, n, 1).getValues().some(function (r) { return String(r[0]) === String(x.k); });
  if (!ya) sh.appendRow([String(x.k), String(x.doc || ''), String(x.cn || ''), String(x.er || ''), String(x.f || ''), String(x.mon || ''), Number(x.tot) || 0,
    String(x.motivo).slice(0, 80), String(x.nota || '').slice(0, 300), String(quien || '').slice(0, 60), Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm')]);
  MESA_tocar_(); MESA_programarRecalculo_();
  return { mensaje: '🚫 ' + (x.doc || x.k) + ' excluido (' + x.motivo + '). Cobranzas se recalcula en ~1–2 min y deja de salir en los reportes. Para volver a incluirla: 📥 Saldos iniciales → 🚫 Excluidas.' };
}

function MESA_excluidas(tk) {
  MESA_ok_(tk);
  var sh = EXC_hoja_(ssPrincipal_(), false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, EXC_ENC_.length).getDisplayValues().map(function (r, i) { return { fila: i + 2, k: r[0], doc: r[1], cn: r[2], er: r[3], f: r[4], mon: r[5], tot: r[6], motivo: r[7], nota: r[8], quien: r[9], cuando: r[10] }; });
}

function MESA_incluir(tk, k) {
  MESA_ok_(tk);
  var sh = EXC_hoja_(ssPrincipal_(), false);
  if (!sh || sh.getLastRow() < 2) return { mensaje: 'No hay excluidas.' };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(), n = 0;
  for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]) === String(k)) { sh.deleteRow(i + 2); n++; }
  MESA_tocar_(); MESA_programarRecalculo_();
  return { mensaje: n ? '↩️ Vuelve a entrar en Cobranzas y los reportes (se recalcula en ~1–2 min).' : 'Ya no estaba excluida.' };
}

function EXC_menuAbrir() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setActiveSheet(EXC_hoja_(ss, true));
}
