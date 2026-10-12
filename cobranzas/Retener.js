/**
 * Retener.js — ¿Qué facturas hay que retener? (Régimen de retenciones del IGV, 3%).
 *
 * Reglas (R.S. 037-2002/SUNAT y modificatorias, tasa 3% desde 01/03/2014):
 *   - Retiene el COMPRADOR si está designado agente de retención (desde la fecha
 *     del padrón de SUNAT) al pagar facturas o notas de débito.
 *   - NO se retiene si el proveedor es agente de retención, buen contribuyente,
 *     si la operación está sujeta a detracción (manda la detracción), si es
 *     boleta / recibo, o si el importe es ≤ S/ 700 (salvo que en un mismo pago
 *     se cancelen varias facturas que juntas superen S/ 700).
 *   - Si el proveedor es agente de percepción y la factura trae percepción, no
 *     se retiene: eso no viene en SIRE, así que se marca "Revisar".
 * La lista de agentes, buenos contribuyentes y agentes de percepción vive en la
 * pestaña oculta "_Padrones SUNAT" (se actualiza sola cada mes: Padrones.js).
 * Detracción: marca "D" del registro de compras SIRE + lista de proveedores
 * con detracción en ⚙️ Config (columnas R:S).
 *
 * Se ve en 📋 Documentos (columnas "¿Retener?" y "Retención esperada") y en la
 * pestaña 🧾 Retenciones (resumen por empresa y proveedor + lo que falta).
 */

var RTN_TASA_ = 0.03;
var RTN_MINIMO_ = 700;
var RTN_HOJA_ = '🧾 Retenciones';
var RTN_DATOS_ = '_Retenciones datos';

var RTN_EST_ = {
  OK: '✅ Retenido', PARCIAL: '🟠 Retención incompleta', FALTA: '🔴 Pagado sin retención', PEND: '⏳ Retener al pagar',
  C_OK: '✅ El cliente retuvo', C_PARCIAL: '🟠 El cliente retuvo de menos', C_FALTA: '🔴 Cobrado sin retención', C_PEND: '⏳ El cliente debe retener',
};

/** Proveedores que siempre venden con detracción (⚙️ Config, columnas R:S). */
function RTN_detraccionConfig_(ss) {
  var sh = ss.getSheetByName(HOJA.CONFIG);
  var res = {};
  if (!sh) return res;
  if (!sh.getRange('R1').getValue()) {
    sh.getRange('R1').setValue('PROVEEDORES CON DETRACCIÓN (no se les retiene)').setFontWeight('bold').setFontSize(12);
    sh.getRange('R2:S2').setValues([['RUC', 'Nota (ej. azúcar, transporte de carga)']])
      .setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true);
    sh.setColumnWidth(18, 120); sh.setColumnWidth(19, 260);
  }
  var ult = sh.getLastRow();
  if (ult < 3) return res;
  sh.getRange(3, 18, ult - 2, 2).getValues().forEach(function (r) {
    var ruc = aRuc_(r[0]);
    if (ruc) res[ruc] = String(r[1] || 'detracción');
  });
  return res;
}

/** Tipo de cambio del documento a soles (SIRE trae el TC; si no, 1). */
function RTN_enSoles_(d, monto) {
  return String(d.moneda || 'PEN').toUpperCase() === 'PEN' ? monto : monto * (d.tc && d.tc > 1 ? d.tc : 1);
}

/**
 * Evalúa todos los documentos. Deja en cada documento:
 *   d.rtn = { aplica: bool, motivo: '…', esperada: S/, estado: '…', lado: 'pagar'|'cobrar' }
 * Solo para documentos donde el comprador es agente de retención y alguna
 * empresa del grupo está involucrada.
 */
function RTN_evaluar_(res, cfg, padron, detrConfig) {
  var grupo = {};
  cfg.grupo.forEach(function (r) { grupo[r] = true; });
  // Pagos que cancelan varias facturas del mismo proveedor (para la regla de S/ 700)
  var porPago = {};
  res.docs.forEach(function (d) {
    d.movs.forEach(function (m) {
      if (m.modalidad !== MODALIDAD.PAGO || !m.pagoId) return;
      var k = m.pagoId + '|' + d.emisorRuc;
      porPago[k] = (porPago[k] || 0) + RTN_enSoles_(d, d.total);
    });
  });
  res.docs.forEach(function (d) {
    d.rtn = null;
    if (!grupo[d.emisorRuc] && !grupo[d.receptorRuc]) return;
    if (d.tipo !== '01' && d.tipo !== '08' && d.tipo !== '03') return;
    var comprador = padron[d.receptorRuc] || {}, proveedor = padron[d.emisorRuc] || {};
    var fecha = d.fecha || new Date();
    if (!comprador.ar || comprador.ar > fecha) return;  // el comprador no era agente de retención
    var lado = grupo[d.receptorRuc] ? 'pagar' : 'cobrar';
    var r = { aplica: false, motivo: '', esperada: 0, estado: '', lado: lado };
    var totalSoles = RTN_enSoles_(d, d.total + d.nd - d.nc);
    if (d.tipo === '03') r.motivo = 'No: boleta';
    else if (proveedor.ar && proveedor.ar <= fecha) r.motivo = 'No: el proveedor es agente de retención';
    else if (proveedor.bc && proveedor.bc <= fecha) r.motivo = 'No: el proveedor es buen contribuyente';
    else if (d.detraccionSire || detrConfig[d.emisorRuc] || d.detraccion > 0) r.motivo = 'No: sujeta a detracción';
    else if (totalSoles <= RTN_MINIMO_) {
      var suma = 0;
      d.movs.forEach(function (m) { if (m.pagoId) suma = Math.max(suma, porPago[m.pagoId + '|' + d.emisorRuc] || 0); });
      if (suma > RTN_MINIMO_) { r.aplica = true; r.motivo = 'Sí: ≤ S/700 pero se pagó junto con otras (S/ ' + suma.toFixed(2) + ')'; }
      else r.motivo = 'No: ≤ S/700 (salvo que se pague junto con otras facturas que sumen más)';
    } else { r.aplica = true; r.motivo = 'Sí: 3%'; }
    if (r.aplica && (proveedor.ap || proveedor.apc)) r.motivo += ' · Revisar: el proveedor es agente de percepción (si la factura cobró percepción, no se retiene)';
    if (r.aplica) {
      r.esperada = Math.round(totalSoles * RTN_TASA_ * 100) / 100;
      var retenida = RTN_enSoles_(d, d.retencion);
      var pagado = d.pagado > 0.005 || d.saldo <= 0.5;
      if (retenida >= r.esperada - 1) r.estado = lado === 'pagar' ? RTN_EST_.OK : RTN_EST_.C_OK;
      else if (retenida > 0.005) r.estado = lado === 'pagar' ? RTN_EST_.PARCIAL : RTN_EST_.C_PARCIAL;
      else if (pagado) r.estado = lado === 'pagar' ? RTN_EST_.FALTA : RTN_EST_.C_FALTA;
      else r.estado = lado === 'pagar' ? RTN_EST_.PEND : RTN_EST_.C_PEND;
      r.retenida = Math.round(retenida * 100) / 100;
    }
    d.rtn = r;
  });
}

/** Texto para la columna "¿Retener?" de 📋 Documentos. */
function RTN_textoColumna_(d) {
  if (!d.rtn) return '';
  return d.rtn.aplica ? d.rtn.estado + (d.rtn.motivo !== 'Sí: 3%' ? ' · ' + d.rtn.motivo.replace(/^Sí: /, '') : '') : d.rtn.motivo;
}

/* --------------------------------------------- pestaña 🧾 Retenciones */

function RTN_escribirHoja_(ss, res, cfg, padron, infoPadron) {
  var sh = ss.getSheetByName(RTN_HOJA_);
  if (!sh) {
    sh = ss.insertSheet(RTN_HOJA_);
    var docs = ss.getSheetByName(HOJA.DOCS);
    if (docs) { ss.setActiveSheet(sh); ss.moveActiveSheet(docs.getIndex() + 1); }
  }
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), Math.min(sh.getMaxColumns(), 14)).clearDataValidations();
  sh.getRange('A1:L1').merge().setValue('🧾  RETENCIONES DEL IGV (3%) · qué retener, qué falta y qué ya se retuvo').setFontSize(15)
    .setFontWeight('bold').setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
  sh.setRowHeight(1, 36);
  // Situación de las empresas del grupo
  var fmt = function (f) { return f ? Utilities.formatDate(f, 'America/Lima', 'dd/MM/yyyy') : ''; };
  var emp = cfg.grupo.map(function (ruc) {
    var p = padron[ruc] || {};
    return [cfg.nombreEmpresa[ruc] || ruc, ruc, p.ar ? '✅ Sí, desde ' + fmt(p.ar) : 'No', p.bc ? 'Sí, desde ' + fmt(p.bc) : 'No',
      p.ap || p.apc ? 'Sí' : 'No', p.ar ? 'Retiene 3% a sus proveedores (salvo excepciones)' : 'No retiene'];
  });
  sh.getRange(3, 1).setValue('EMPRESAS DEL GRUPO').setFontWeight('bold');
  sh.getRange(3, 3).setValue(infoPadron || '').setFontColor(COLOR.TEXTO_SUAVE).setFontSize(9);
  escribirTabla_(sh, 4, 1, ['Empresa', 'RUC', 'Agente de retención', 'Buen contribuyente', 'Agente de percepción', 'Qué significa'], emp);
  var fila = 4 + emp.length + 2;

  // Resumen por empresa y proveedor/cliente
  var resumen = {}, detalle = [];
  res.docs.forEach(function (d) {
    if (!d.rtn || !d.rtn.aplica) return;
    var empRuc = d.rtn.lado === 'pagar' ? d.receptorRuc : d.emisorRuc;
    var cpRuc = d.rtn.lado === 'pagar' ? d.emisorRuc : d.receptorRuc;
    var cpNom = (d.rtn.lado === 'pagar' ? d.emisorNombre : d.receptorNombre) || (padron[cpRuc] || {}).nombre || '';
    var k = empRuc + '|' + d.rtn.lado + '|' + cpRuc;
    var s = resumen[k] = resumen[k] || { emp: cfg.nombreEmpresa[empRuc] || empRuc, lado: d.rtn.lado, cpRuc: cpRuc, cpNom: cpNom,
      n: 0, esperada: 0, retenida: 0, falta: 0, pend: 0, nFalta: 0, nPend: 0 };
    s.n++; s.esperada += d.rtn.esperada; s.retenida += d.rtn.retenida;
    var falta = Math.max(0, d.rtn.esperada - d.rtn.retenida);
    if (/🔴|🟠/.test(d.rtn.estado)) { s.falta += falta; s.nFalta++; }
    if (/⏳/.test(d.rtn.estado)) { s.pend += falta; s.nPend++; }
    if (!/✅/.test(d.rtn.estado)) {
      var pagos = d.movs.filter(function (m) { return m.modalidad === MODALIDAD.PAGO; })
        .map(function (m) { return (m.operacion || 'pago') + ' · ' + Number(m.monto).toFixed(2); }).join('; ');
      detalle.push([s.emp, d.rtn.lado === 'pagar' ? 'Debemos retener' : 'Nos deben retener', cpNom, cpRuc, etiquetaDoc_(d), d.fecha || '',
        d.moneda, d.total, d.rtn.esperada, d.rtn.retenida, falta, d.rtn.estado, d.rtn.motivo, pagos]);
    }
  });
  var filasRes = Object.keys(resumen).map(function (k) { return resumen[k]; })
    .sort(function (a, b) { return a.emp.localeCompare(b.emp) || a.lado.localeCompare(b.lado) || (b.falta + b.pend) - (a.falta + a.pend); })
    .map(function (s) {
      return [s.emp, s.lado === 'pagar' ? 'Debemos retener' : 'Nos deben retener', s.cpNom || s.cpRuc, s.cpRuc, s.n, r2_(s.esperada), r2_(s.retenida),
        s.nFalta, r2_(s.falta), s.nPend, r2_(s.pend)];
    });
  var orden = function (e) { return /🔴/.test(e) ? 0 : /🟠/.test(e) ? 1 : 2; };
  detalle.forEach(function (r) { if (!r[2]) r[2] = r[3]; });
  detalle.sort(function (a, b) { return orden(a[11]) - orden(b[11]) || String(a[0]).localeCompare(b[0]) || String(a[2]).localeCompare(b[2]); });

  // Datos completos en una pestaña oculta; la visible los muestra con FILTER según los selectores.
  var encRes = ['Empresa', 'Lado', 'Proveedor / cliente', 'RUC', 'Facturas sujetas', 'Retención esperada S/', 'Ya retenido S/',
    'Pagadas sin retener (N°)', 'Falta retener S/', 'Pendientes de pago (N°)', 'Retener al pagar S/'];
  var encDet = ['Empresa', 'Lado', 'Proveedor / cliente', 'RUC', 'Documento', 'Emisión', 'Moneda', 'Total', 'Retención esperada S/',
    'Retenido S/', 'Falta S/', 'Situación', 'Por qué', 'Pagos aplicados'];
  var dat = ss.getSheetByName(RTN_DATOS_) || ss.insertSheet(RTN_DATOS_);
  dat.clear();
  dat.getRange('D:D').setNumberFormat('@');
  dat.getRange('P:P').setNumberFormat('@');
  dat.getRange(1, 1, 1, encRes.length).setValues([encRes]);
  if (filasRes.length) dat.getRange(2, 1, filasRes.length, encRes.length).setValues(filasRes);
  dat.getRange(1, 13, 1, encDet.length).setValues([encDet]);
  if (detalle.length) dat.getRange(2, 13, detalle.length, encDet.length).setValues(detalle);
  dat.hideSheet();

  // Selectores (se conservan entre actualizaciones)
  var props = PropertiesService.getDocumentProperties();
  var sel = JSON.parse(props.getProperty('rtn_filtros') || '["(Todas)","(Todos)","(Todos)"]');
  sh.getRange(fila, 1).setValue('🔎 FILTRAR (elija en las celdas amarillas; el resumen y las facturas se filtran solos)').setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, 3).setValues([['Empresa', 'Lado', 'Proveedor / cliente']]).setFontWeight('bold').setFontColor(COLOR.TEXTO_SUAVE);
  var fSel = fila + 2;
  var celdas = sh.getRange(fSel, 1, 1, 3);
  celdas.setValues([sel]).setBackground('#FFF8E1').setFontWeight('bold').setBorder(true, true, true, true, true, true);
  var empresasLista = ['(Todas)'];
  filasRes.forEach(function (r) { if (empresasLista.indexOf(r[0]) < 0) empresasLista.push(r[0]); });
  sh.getRange(fSel, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(empresasLista).setAllowInvalid(false).build());
  sh.getRange(fSel, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['(Todos)', 'Debemos retener', 'Nos deben retener']).build());
  var sep = separadorFormula_(ss);
  var D = "'" + RTN_DATOS_ + "'!";
  var E = '$A$' + fSel, L = '$B$' + fSel, P = '$C$' + fSel;
  var cond = function (col) {  // col: letras de Empresa, Lado, Proveedor en la pestaña de datos
    return '((' + E + '="(Todas)")+(' + D + col[0] + '2:' + col[0] + '=' + E + '))*((' + L + '="(Todos)")+(' + D + col[1] + '2:' + col[1] + '=' + L +
      '))*((' + P + '="(Todos)")+(' + D + col[2] + '2:' + col[2] + '=' + P + '))*(' + D + col[0] + '2:' + col[0] + '<>"")';
  };
  // Lista de proveedores/clientes según empresa y lado elegidos
  dat.getRange('AB1').setValue('(Todos)');
  var V = "'" + RTN_HOJA_ + "'!";
  dat.getRange('AB2').setFormula('=IFERROR(SORT(UNIQUE(FILTER(C2:C' + sep + ' ((' + V + E + '="(Todas)")+(A2:A=' + V + E + '))*((' +
    V + L + '="(Todos)")+(B2:B=' + V + L + '))*(C2:C<>""))))' + sep + ' "")');
  sh.getRange(fSel, 3).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(dat.getRange('AB1:AB2000')).setAllowInvalid(true).build());
  props.setProperty('rtn_fila_filtros', String(fSel));

  // Resumen filtrado
  var nRes = Math.max(filasRes.length, 1);
  var fTot = fSel + 2;
  fila = fTot + 1;
  sh.getRange(fila, 1).setValue('RESUMEN POR EMPRESA Y PROVEEDOR / CLIENTE (solo facturas sujetas a retención)').setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, encRes.length).setValues([encRes]).setFontWeight('bold').setFontColor(COLOR.BLANCO)
    .setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  var r0 = fila + 2;
  sh.getRange(r0, 1).setFormula('=IFERROR(FILTER(' + D + 'A2:K' + sep + ' ' + cond(['A', 'B', 'C']) + ')' + sep + ' "— sin resultados con estos filtros —")');
  sh.getRange(r0, 6, nRes, 6).setNumberFormat('#,##0.00;-#,##0.00;"-"');
  sh.getRange(r0, 5, nRes, 1).setNumberFormat('0');
  sh.getRange(r0, 8, nRes, 1).setNumberFormat('0;-0;"-"');
  sh.getRange(r0, 10, nRes, 1).setNumberFormat('0;-0;"-"');
  sh.getRange(r0, 9, nRes, 1).setFontColor('#B91C1C').setFontWeight('bold');
  // Totales de lo filtrado (encima del resumen)
  var col = function (c) { return c + r0 + ':' + c + (r0 + nRes - 1); };
  sh.getRange(fTot, 1, 1, 11).setValues([['TOTAL de lo filtrado', '', '', '',
    '=SUM(' + col('E') + ')', '=SUM(' + col('F') + ')', '=SUM(' + col('G') + ')', '=SUM(' + col('H') + ')', '=SUM(' + col('I') + ')',
    '=SUM(' + col('J') + ')', '=SUM(' + col('K') + ')']]).setFontWeight('bold').setBackground('#EEF3F8');
  sh.getRange(fTot, 6, 1, 6).setNumberFormat('#,##0.00;-#,##0.00;"-"');
  sh.getRange(fTot, 9).setFontColor('#B91C1C');

  // Facturas por atender filtradas
  fila = r0 + nRes + 2;
  var nDet = Math.max(detalle.length, 1);
  sh.getRange(fila, 1).setValue('FACTURAS POR ATENDER · 🔴 pagadas sin retención · 🟠 retención incompleta · ⏳ retener al pagar').setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, encDet.length).setValues([encDet]).setFontWeight('bold').setFontColor(COLOR.BLANCO)
    .setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  var d0 = fila + 2;
  sh.getRange(d0, 1).setFormula('=IFERROR(FILTER(' + D + 'M2:Z' + sep + ' ' + cond(['M', 'N', 'O']) + ')' + sep + ' "— sin facturas por atender con estos filtros —")');
  sh.getRange(d0, 6, nDet, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(d0, 8, nDet, 4).setNumberFormat('#,##0.00;-#,##0.00;"-"');
  var rango = sh.getRange(d0, 12, nDet, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($L' + d0 + sep + '2)="🔴"').setBackground('#FEE2E2').setRanges([rango]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($L' + d0 + sep + '2)="🟠"').setBackground('#FFEDD5').setRanges([rango]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT($L' + d0 + sep + '1)="⏳"').setBackground('#FEF9C3').setRanges([rango]).build(),
  ]);
  sh.getRange(1, 1, Math.max(sh.getLastRow(), d0 + nDet), 14).setFontSize(9);
  sh.getRange('A1').setFontSize(15);
  [150, 120, 230, 95, 110, 85, 60, 95, 110, 95, 90, 170, 300, 220].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
  return { proveedores: filasRes.length, porAtender: detalle.length };
}

/** Guarda lo elegido en los filtros para que no se pierda al actualizar. */
function RTN_alEditar_(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== RTN_HOJA_) return;
    var props = PropertiesService.getDocumentProperties();
    var f = parseInt(props.getProperty('rtn_fila_filtros') || '0', 10);
    if (!f || e.range.getRow() !== f || e.range.getColumn() > 3) return;
    var v = sh.getRange(f, 1, 1, 3).getValues()[0].map(function (x, i) { return String(x || (i ? '(Todos)' : '(Todas)')); });
    if (e.range.getColumn() <= 2 && e.range.getColumn() + e.range.getNumColumns() - 1 < 3) {
      v[2] = '(Todos)';  // al cambiar empresa o lado, el proveedor vuelve a "(Todos)"
      sh.getRange(f, 3).setValue('(Todos)');
    }
    props.setProperty('rtn_filtros', JSON.stringify(v));
  } catch (err) { /* nada */ }
}

function r2_(n) { return Math.round(n * 100) / 100; }
