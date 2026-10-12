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

// Selectores de la fila de filtros: Empresa · Lado · Proveedor (lista) · Buscar · Ver
var RTN_SEL_DEF_ = ['(Todas)', '(Todos)', '(Todos)', '', 'Por atender (🔴🟠⏳)'];
var RTN_VER_ = ['Por atender (🔴🟠⏳)', 'Todas las facturas', '✅ Solo retenidas', '🔴🟠 Solo pagadas sin retener'];

/** Letra de columna (1 → A, 27 → AA). */
function RTN_letra_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Clave de vista: R = retenida, F = pagada sin retener / incompleta, P = retener al pagar. */
function RTN_clave_(estado) {
  return /✅/.test(estado) ? 'R' : /🔴|🟠/.test(estado) ? 'F' : 'P';
}

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
  sh.getRange(1, 1, sh.getMaxRows(), Math.min(sh.getMaxColumns(), 16)).clearDataValidations();
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

  // ---- Armar los datos: resumen, facturas (todas las sujetas) y vouchers
  var resumen = {}, detalle = [], vouchers = {};
  var ladoTxt = function (l) { return l === 'pagar' ? 'Debemos retener' : 'Nos deben retener'; };
  res.docs.forEach(function (d) {
    if (!d.rtn || !d.rtn.aplica) return;
    var empRuc = d.rtn.lado === 'pagar' ? d.receptorRuc : d.emisorRuc;
    var cpRuc = d.rtn.lado === 'pagar' ? d.emisorRuc : d.receptorRuc;
    var cpNom = (d.rtn.lado === 'pagar' ? d.emisorNombre : d.receptorNombre) || (padron[cpRuc] || {}).nombre || cpRuc;
    var empNom = cfg.nombreEmpresa[empRuc] || empRuc;
    var k = empRuc + '|' + d.rtn.lado + '|' + cpRuc;
    var s = resumen[k] = resumen[k] || { emp: empNom, lado: d.rtn.lado, cpRuc: cpRuc, cpNom: cpNom,
      n: 0, nOk: 0, esperada: 0, retenida: 0, falta: 0, pend: 0, nFalta: 0, nPend: 0, vouchers: {} };
    var falta = r2_(Math.max(0, d.rtn.esperada - d.rtn.retenida));
    var clave = RTN_clave_(d.rtn.estado);
    s.n++; s.esperada += d.rtn.esperada; s.retenida += d.rtn.retenida;
    if (clave === 'R') s.nOk++;
    if (clave === 'F') { s.falta += falta; s.nFalta++; }
    if (clave === 'P') { s.pend += falta; s.nPend++; }
    var pagos = d.movs.filter(function (m) { return m.modalidad === MODALIDAD.PAGO; });
    var rets = d.movs.filter(function (m) { return m.modalidad === MODALIDAD.RETENCION; });
    detalle.push([empNom, ladoTxt(d.rtn.lado), s.cpNom, cpRuc, etiquetaDoc_(d), d.fecha || '', d.moneda, d.total, d.rtn.esperada,
      d.rtn.retenida, falta, d.rtn.estado,
      pagos.map(function (m) { return (m.fecha ? fmt(m.fecha) + ' ' : '') + 'Op. ' + (m.operacion || 's/n') + (m.banco ? ' ' + m.banco : '') + ' · ' + Number(m.monto).toFixed(2); }).join('; '),
      rets.map(function (m) { return (m.operacion || 'retención') + ' · ' + Number(m.monto).toFixed(2); }).join('; '),
      d.rtn.motivo, clave]);
    // Vouchers (pagos) que cancelaron estas facturas
    pagos.forEach(function (m) {
      var kv = k + '|' + (m.pagoId || m.fuente || m.operacion);
      var v = vouchers[kv] = vouchers[kv] || { emp: empNom, lado: d.rtn.lado, cpNom: s.cpNom, cpRuc: cpRuc, fecha: m.fecha || '',
        op: m.operacion || '', banco: m.banco || '', monto: m.montoPago || '', moneda: m.monedaPago || d.moneda, docs: [],
        esperada: 0, retenida: 0, falta: 0, mal: false, fuente: m.fuente || '' };
      if (v.docs.indexOf(etiquetaDoc_(d)) < 0) {
        v.docs.push(etiquetaDoc_(d));
        v.esperada += d.rtn.esperada; v.retenida += d.rtn.retenida; v.falta += falta;
        if (clave !== 'R') v.mal = true;
      }
      s.vouchers[kv] = s.vouchers[kv] || false;
      if (clave !== 'R') s.vouchers[kv] = true;
    });
  });
  var filasRes = Object.keys(resumen).map(function (k) { return resumen[k]; })
    .sort(function (a, b) { return a.emp.localeCompare(b.emp) || a.lado.localeCompare(b.lado) || (b.falta + b.pend) - (a.falta + a.pend); })
    .map(function (s) {
      var vMal = Object.keys(s.vouchers).filter(function (x) { return s.vouchers[x]; }).length;
      return [s.emp, ladoTxt(s.lado), s.cpNom, s.cpRuc, s.n, s.nOk, r2_(s.esperada), r2_(s.retenida),
        s.nFalta, r2_(s.falta), s.nPend, r2_(s.pend), vMal];
    });
  detalle.sort(function (a, b) {
    return String(a[0]).localeCompare(b[0]) || String(a[1]).localeCompare(b[1]) || String(a[2]).localeCompare(b[2]) ||
      (a[5] instanceof Date && b[5] instanceof Date ? a[5] - b[5] : String(a[4]).localeCompare(b[4]));
  });
  var filasVou = Object.keys(vouchers).map(function (k) { return vouchers[k]; })
    .sort(function (a, b) {
      return a.emp.localeCompare(b.emp) || a.lado.localeCompare(b.lado) || a.cpNom.localeCompare(b.cpNom) ||
        (a.fecha instanceof Date && b.fecha instanceof Date ? a.fecha - b.fecha : 0);
    })
    .map(function (v) {
      var sit = v.mal ? (v.lado === 'pagar' ? '🔴 Se pagó sin retener (todo o parte)' : '🔴 Nos pagaron sin retener (todo o parte)')
        : (v.lado === 'pagar' ? '✅ Retenido' : '✅ El cliente retuvo');
      return [v.emp, ladoTxt(v.lado), v.cpNom, v.cpRuc, v.fecha, v.op, v.banco, v.moneda, v.monto, v.docs.join(', '),
        r2_(v.esperada), r2_(v.retenida), r2_(v.falta), sit, v.fuente, v.mal ? 'F' : 'R'];
    });

  // ---- Pestaña oculta con todos los datos; la visible los muestra con FILTER
  var encRes = ['Empresa', 'Lado', 'Proveedor / cliente', 'RUC', 'Facturas sujetas', '✅ Retenidas (N°)', 'Retención esperada S/', 'Ya retenido S/',
    '🔴 Pagadas sin retener (N°)', 'Falta retener S/', '⏳ Pendientes de pago (N°)', 'Retener al pagar S/', 'Vouchers con retención faltante (N°)'];
  var encDet = ['Empresa', 'Lado', 'Proveedor / cliente', 'RUC', 'Factura', 'Emisión', 'Moneda', 'Total', 'Retención esperada S/',
    'Retenido S/', 'Falta S/', 'Situación', 'Voucher(s) con que se pagó', 'Comprobante(s) de retención', 'Por qué'];
  var encVou = ['Empresa', 'Lado', 'Proveedor / cliente', 'RUC', 'Fecha', 'N° operación', 'Banco', 'Moneda', 'Monto del voucher',
    'Facturas que pagó (sujetas)', 'Retención esperada S/', 'Retenido S/', 'Falta S/', 'Situación', 'Dónde está el voucher'];
  // Columnas en la pestaña de datos
  var cR = 1, cD = cR + encRes.length + 1, cV = cD + encDet.length + 2, cL = cV + encVou.length + 2;
  var kD = cD + encDet.length, kV = cV + encVou.length;  // columna con la clave de vista (R/F/P)
  var Lt = RTN_letra_;
  var dat = ss.getSheetByName(RTN_DATOS_) || ss.insertSheet(RTN_DATOS_);
  dat.clear();
  if (dat.getMaxColumns() < cL + 1) dat.insertColumnsAfter(dat.getMaxColumns(), cL + 1 - dat.getMaxColumns());
  [cR + 3, cD + 3, cV + 3, cV + 5].forEach(function (c) { dat.getRange(Lt(c) + ':' + Lt(c)).setNumberFormat('@'); });
  dat.getRange(1, cR, 1, encRes.length).setValues([encRes]);
  if (filasRes.length) dat.getRange(2, cR, filasRes.length, encRes.length).setValues(filasRes);
  dat.getRange(1, cD, 1, encDet.length + 1).setValues([encDet.concat(['Vista'])]);
  if (detalle.length) dat.getRange(2, cD, detalle.length, encDet.length + 1).setValues(detalle);
  dat.getRange(1, cV, 1, encVou.length + 1).setValues([encVou.concat(['Vista'])]);
  if (filasVou.length) dat.getRange(2, cV, filasVou.length, encVou.length + 1).setValues(filasVou);
  dat.hideSheet();

  // ---- Selectores (se conservan entre actualizaciones)
  var props = PropertiesService.getDocumentProperties();
  var sel = JSON.parse(props.getProperty('rtn_filtros') || '[]');
  sel = RTN_SEL_DEF_.map(function (x, i) { return sel[i] == null || sel[i] === '' ? x : sel[i]; });
  if (RTN_VER_.indexOf(sel[4]) < 0) sel[4] = RTN_VER_[0];
  sh.getRange(fila, 1).setValue('🔎 FILTRAR · elija en las celdas amarillas (todo lo de abajo se filtra solo). En "Buscar" escriba parte de la razón social o del RUC.')
    .setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, 5).setValues([['Empresa', 'Lado', 'Proveedor / cliente (lista)', '🔎 Buscar razón social o RUC', 'Ver facturas']])
    .setFontWeight('bold').setFontColor(COLOR.TEXTO_SUAVE);
  var fSel = fila + 2;
  sh.getRange(fSel, 1, 1, 5).setValues([sel]).setBackground('#FFF8E1').setFontWeight('bold').setBorder(true, true, true, true, true, true);
  sh.getRange(fSel, 4).setNumberFormat('@');
  var empresasLista = ['(Todas)'];
  filasRes.forEach(function (r) { if (empresasLista.indexOf(r[0]) < 0) empresasLista.push(r[0]); });
  sh.getRange(fSel, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(empresasLista).setAllowInvalid(false).build());
  sh.getRange(fSel, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['(Todos)', 'Debemos retener', 'Nos deben retener']).build());
  sh.getRange(fSel, 5).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(RTN_VER_).setAllowInvalid(false).build());
  var sep = separadorFormula_(ss);
  var D = "'" + RTN_DATOS_ + "'!";
  var V = "'" + RTN_HOJA_ + "'!";
  var E = '$A$' + fSel, L = '$B$' + fSel, P = '$C$' + fSel, B = '$D$' + fSel, VER = '$E$' + fSel;
  /** Condición de FILTER para un bloque que empieza en la columna c0 de la pestaña de datos (kVista: columna de la vista). */
  var cond = function (c0, kVista, pref, sinProveedor) {
    pref = pref == null ? D : pref;
    var col = function (c) { return pref + Lt(c) + '2:' + Lt(c); };
    var x = '((' + V + E + '="(Todas)")+(' + col(c0) + '=' + V + E + '))*((' + V + L + '="(Todos)")+(' + col(c0 + 1) + '=' + V + L + '))';
    if (!sinProveedor) x += '*((' + V + P + '="(Todos)")+(' + V + P + '="")+(' + col(c0 + 2) + '=' + V + P + '))';
    x += '*((' + V + B + '="")+ISNUMBER(SEARCH(' + V + B + sep + ' ' + col(c0 + 2) + '&" "&' + col(c0 + 3) + ')))';
    if (kVista) {
      x += '*((' + V + VER + '="' + RTN_VER_[1] + '")+((' + V + VER + '="' + RTN_VER_[0] + '")*(' + col(kVista) + '<>"R"))+((' + V + VER + '="' +
        RTN_VER_[2] + '")*(' + col(kVista) + '="R"))+((' + V + VER + '="' + RTN_VER_[3] + '")*(' + col(kVista) + '="F")))';
    }
    return x + '*(' + col(c0) + '<>"")';
  };
  // Lista de proveedores/clientes según empresa, lado y lo escrito en "Buscar"
  dat.getRange(1, cL).setValue('(Todos)');
  var condLista = cond(cR, 0, '', true);
  dat.getRange(2, cL).setFormula('=IFERROR(SORT(UNIQUE(FILTER(' + Lt(cR + 2) + '2:' + Lt(cR + 2) + sep + ' ' + condLista + ')))' + sep + ' "")');
  sh.getRange(fSel, 3).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(dat.getRange(Lt(cL) + '1:' + Lt(cL) + '3000')).setAllowInvalid(true).build());
  props.setProperty('rtn_fila_filtros', String(fSel));
  var rango = function (c0, n) { return D + Lt(c0) + '2:' + Lt(c0 + n - 1); };
  var dinero = '#,##0.00;-#,##0.00;"-"';

  // ---- Resumen filtrado
  var nRes = Math.max(filasRes.length, 1);
  var fTot = fSel + 2;
  fila = fTot + 2;
  sh.getRange(fila, 1).setValue('1) RESUMEN POR EMPRESA Y PROVEEDOR / CLIENTE (solo facturas sujetas a retención)').setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, encRes.length).setValues([encRes]).setFontWeight('bold').setFontColor(COLOR.BLANCO)
    .setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  var r0 = fila + 2;
  sh.getRange(r0, 1).setFormula('=IFERROR(FILTER(' + rango(cR, encRes.length) + sep + ' ' + cond(cR, 0) + ')' + sep + ' "— sin resultados con estos filtros —")');
  sh.getRange(r0, 5, nRes, 2).setNumberFormat('0;-0;"-"');
  sh.getRange(r0, 7, nRes, 2).setNumberFormat(dinero);
  sh.getRange(r0, 9, nRes, 1).setNumberFormat('0;-0;"-"');
  sh.getRange(r0, 10, nRes, 1).setNumberFormat(dinero).setFontColor('#B91C1C').setFontWeight('bold');
  sh.getRange(r0, 11, nRes, 1).setNumberFormat('0;-0;"-"');
  sh.getRange(r0, 12, nRes, 1).setNumberFormat(dinero);
  sh.getRange(r0, 13, nRes, 1).setNumberFormat('0;-0;"-"').setFontColor('#B91C1C').setFontWeight('bold');
  // Totales de lo filtrado (encima del resumen)
  var col = function (c) { return c + r0 + ':' + c + (r0 + nRes - 1); };
  var tot = ['TOTAL de lo filtrado', '', '', ''];
  for (var c = 5; c <= encRes.length; c++) tot.push('=SUM(' + col(Lt(c)) + ')');
  sh.getRange(fTot, 1, 1, encRes.length).setValues([tot]).setFontWeight('bold').setBackground('#EEF3F8');
  sh.getRange(fTot, 7, 1, 2).setNumberFormat(dinero);
  sh.getRange(fTot, 10).setNumberFormat(dinero).setFontColor('#B91C1C');
  sh.getRange(fTot, 12).setNumberFormat(dinero);
  sh.getRange(fTot, 13).setFontColor('#B91C1C');

  // ---- Facturas una por una
  fila = r0 + nRes + 2;
  var nDet = Math.max(detalle.length, 1);
  var fFac = fila;
  sh.getRange(fila, 1).setValue('2) FACTURAS UNA POR UNA (según "Ver facturas") · ✅ retenida · 🔴 pagada sin retención · 🟠 incompleta · ⏳ retener al pagar')
    .setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, encDet.length).setValues([encDet]).setFontWeight('bold').setFontColor(COLOR.BLANCO)
    .setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  var d0 = fila + 2;
  sh.getRange(d0, 1).setFormula('=IFERROR(FILTER(' + rango(cD, encDet.length) + sep + ' ' + cond(cD, kD) + ')' + sep +
    ' "— sin facturas con estos filtros —")');
  sh.getRange(d0, 6, nDet, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(d0, 8, nDet, 4).setNumberFormat(dinero);
  sh.getRange(d0, 11, nDet, 1).setFontColor('#B91C1C').setFontWeight('bold');

  // ---- Vouchers que pagaron esas facturas
  fila = d0 + nDet + 2;
  var nVou = Math.max(filasVou.length, 1);
  var fVou = fila;
  sh.getRange(fila, 1).setValue('3) VOUCHERS / PAGOS DE ESAS FACTURAS (según "Ver facturas": "Por atender" muestra solo los que tienen retención faltante)')
    .setFontWeight('bold');
  sh.getRange(fila + 1, 1, 1, encVou.length).setValues([encVou]).setFontWeight('bold').setFontColor(COLOR.BLANCO)
    .setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  var v0 = fila + 2;
  sh.getRange(v0, 1).setFormula('=IFERROR(FILTER(' + rango(cV, encVou.length) + sep + ' ' + cond(cV, kV) + ')' + sep +
    ' "— sin vouchers con estos filtros —")');
  sh.getRange(v0, 5, nVou, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(v0, 9, nVou, 1).setNumberFormat(dinero);
  sh.getRange(v0, 11, nVou, 3).setNumberFormat(dinero);
  sh.getRange(v0, 13, nVou, 1).setFontColor('#B91C1C').setFontWeight('bold');

  // Accesos rápidos a cada sección
  var gid = sh.getSheetId();
  sh.getRange(fTot + 1, 1, 1, 3).setValues([[
    '=HYPERLINK("#gid=' + gid + '&range=A' + fFac + '"' + sep + ' "⬇ Ir a 2) Facturas")',
    '=HYPERLINK("#gid=' + gid + '&range=A' + fVou + '"' + sep + ' "⬇ Ir a 3) Vouchers")',
    '']]).setFontColor('#1D4ED8').setFontSize(9);

  // Colores de la situación
  var rDet = sh.getRange(d0, 12, nDet, 1), rVou = sh.getRange(v0, 14, nVou, 1);
  var regla = function (celda, emoji, n, color, rng) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=LEFT(' + celda + sep + n + ')="' + emoji + '"')
      .setBackground(color).setRanges([rng]).build();
  };
  sh.setConditionalFormatRules([
    regla('$L' + d0, '🔴', 2, '#FEE2E2', rDet), regla('$L' + d0, '🟠', 2, '#FFEDD5', rDet),
    regla('$L' + d0, '⏳', 1, '#FEF9C3', rDet), regla('$L' + d0, '✅', 1, '#DCFCE7', rDet),
    regla('$N' + v0, '🔴', 2, '#FEE2E2', rVou), regla('$N' + v0, '✅', 1, '#DCFCE7', rVou),
  ]);
  sh.getRange(1, 1, Math.max(sh.getLastRow(), v0 + nVou), 15).setFontSize(9);
  sh.getRange('A1').setFontSize(15);
  [150, 120, 230, 150, 150, 95, 95, 95, 110, 150, 110, 170, 260, 200, 260].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
  return { proveedores: filasRes.length, facturas: detalle.length, porAtender: detalle.filter(function (r) { return r[15] !== 'R'; }).length,
    vouchers: filasVou.length };
}

/** Guarda lo elegido en los filtros para que no se pierda al actualizar. */
function RTN_alEditar_(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== RTN_HOJA_) return;
    var props = PropertiesService.getDocumentProperties();
    var f = parseInt(props.getProperty('rtn_fila_filtros') || '0', 10);
    var n = RTN_SEL_DEF_.length;
    if (!f || e.range.getRow() !== f || e.range.getColumn() > n) return;
    var v = sh.getRange(f, 1, 1, n).getValues()[0].map(function (x, i) { return x === '' || x == null ? RTN_SEL_DEF_[i] : String(x); });
    var c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
    if (c1 <= 2 && c2 < 3) {
      v[2] = '(Todos)';  // al cambiar empresa o lado, el proveedor vuelve a "(Todos)"
      sh.getRange(f, 3).setValue('(Todos)');
    }
    if (c1 <= 4 && c2 >= 4 && v[3] && v[2] !== '(Todos)') {
      v[2] = '(Todos)';  // al escribir en "Buscar", la lista de proveedor no debe estorbar
      sh.getRange(f, 3).setValue('(Todos)');
    }
    props.setProperty('rtn_filtros', JSON.stringify(v));
  } catch (err) { /* nada */ }
}

function r2_(n) { return Math.round(n * 100) / 100; }
