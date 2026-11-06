/**
 * 📑 Declaraciones — reportes con formato de estudio contable (DEC_Reportes.js).
 * Solo cuenta lo VIGENTE (la última presentación de cada empresa + formulario + periodo).
 *   📒 IGV-Renta 621   : por empresa y año, los conceptos en filas y los meses en columnas (Ene…Dic + Total).
 *   👷 PLAME 601       : igual, con trabajadores, bases y aportes (EsSalud, ONP, renta de 5ta y 4ta).
 *   🧾 Retenciones 626 : igual, con las retenciones efectuadas y la deuda.
 *   🔢 Casillas        : cada casilla con su sección y nombre oficial de SUNAT.
 * Los totales del año son FÓRMULAS (=SUMA), así se pueden revisar y seguir usando.
 */

var DEC_MESES_ = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
var DEC_FMT_MONTO_ = '#,##0.00;[Red]-#,##0.00;"-"';
var DEC_COLOR_ = { cab: '#1f3b5c', cabTxt: '#ffffff', emp: '#dbe5f1', sec: '#eef3f9', total: '#fff4d6', borde: '#c9d3df', gris: '#6b7785' };

function DEC_sumaCas_(r, lista) { var c = r.datos.casillas || {}; return lista.reduce(function (s, n) { return s + DEC_num_(c, n); }, 0); }
function DEC_trib_(r, rx) { return (r.datos.tributos || []).filter(function (t) { return rx.test(t.nom); }).reduce(function (s, t) { return s + t.deuda; }, 0); }

/**
 * Arma una pestaña «matriz anual»: por cada empresa y año, un bloque con conceptos × meses.
 * conceptos: [{t: 'Título', sec: true}] o [{t: 'Concepto', f: function (r) → número | texto, tot: true|false, neg: true}]
 */
function DEC_matriz_(ss, nombre, titulo, form, conceptos, filas, nota) {
  var h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  h.clear(); h.clearConditionalFormatRules && h.clearConditionalFormatRules();
  var bloques = {};
  filas.forEach(function (r) {
    if (!r.vigente || r.form !== form) return;
    var k = r.empresa + '|' + r.ruc + '|' + r.periodo.slice(0, 4);
    (bloques[k] = bloques[k] || { empresa: r.empresa, ruc: r.ruc, anio: r.periodo.slice(0, 4), m: {} }).m[Number(r.periodo.slice(4, 6))] = r;
  });
  var claves = Object.keys(bloques).sort(function (a, b) {
    var x = bloques[a], y = bloques[b]; return x.empresa.localeCompare(y.empresa) || y.anio.localeCompare(x.anio);
  });
  var ancho = 14, v = [], estilos = [];   // estilos: [fila, tipo]
  v.push([titulo].concat(new Array(ancho - 1).fill(''))); estilos.push([1, 'titulo']);
  v.push([nota || 'Solo declaraciones vigentes (la última presentada). Montos en soles. «-» = cero.'].concat(new Array(ancho - 1).fill(''))); estilos.push([2, 'nota']);
  if (!claves.length) v.push(['Aún no hay declaraciones de este formulario.'].concat(new Array(ancho - 1).fill('')));
  var sep = DEC_sep_();
  claves.forEach(function (k) {
    var b = bloques[k];
    v.push(new Array(ancho).fill('')); estilos.push([v.length, 'blanco']);
    v.push([b.empresa + '  ·  RUC ' + b.ruc + '  ·  ' + b.anio].concat(new Array(ancho - 1).fill(''))); estilos.push([v.length, 'empresa']);
    v.push(['Concepto'].concat(DEC_MESES_, ['Total ' + b.anio])); estilos.push([v.length, 'cab']);
    conceptos.forEach(function (c) {
      if (c.sec) { v.push([c.t].concat(new Array(ancho - 1).fill(''))); estilos.push([v.length, 'sec']); return; }
      var fila = [c.t];
      for (var m = 1; m <= 12; m++) { var r = b.m[m]; fila.push(r ? c.f(r) : ''); }
      var n = v.length + 1;
      fila.push(c.tot === false ? '' : '=SUM(B' + n + ':M' + n + ')');
      v.push(fila); estilos.push([n, c.fuerte ? 'fuerte' : c.texto ? 'texto' : 'monto']);
    });
  });
  // escribir: formato ANTES de los valores (si no, Google convierte textos como «09/2026» en fechas)
  h.getRange(1, 1, v.length, ancho).setNumberFormat(DEC_FMT_MONTO_).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');
  h.getRange(1, 1, v.length, 1).setNumberFormat('@');
  estilos.forEach(function (e) { if (e[1] === 'texto' || e[1] === 'cab' || e[1] === 'empresa') h.getRange(e[0], 2, 1, ancho - 1).setNumberFormat('@'); });
  h.getRange(1, 1, v.length, ancho).setValues(v);
  estilos.forEach(function (e) {
    var rg = h.getRange(e[0], 1, 1, ancho);
    if (e[1] === 'titulo') h.getRange(e[0], 1).setFontSize(14).setFontWeight('bold').setFontColor(DEC_COLOR_.cab);
    else if (e[1] === 'nota') h.getRange(e[0], 1).setFontColor(DEC_COLOR_.gris).setFontStyle('italic');
    else if (e[1] === 'empresa') rg.setBackground(DEC_COLOR_.emp).setFontWeight('bold').setFontSize(11);
    else if (e[1] === 'cab') rg.setBackground(DEC_COLOR_.cab).setFontColor(DEC_COLOR_.cabTxt).setFontWeight('bold').setHorizontalAlignment('center');
    else if (e[1] === 'sec') rg.setBackground(DEC_COLOR_.sec).setFontWeight('bold').setFontColor(DEC_COLOR_.cab);
    else if (e[1] === 'fuerte') { rg.setFontWeight('bold').setBackground(DEC_COLOR_.total).setBorder(true, null, true, null, null, null, DEC_COLOR_.cab, SpreadsheetApp.BorderStyle.SOLID); }
    else if (e[1] === 'texto') h.getRange(e[0], 2, 1, ancho - 1).setHorizontalAlignment('center').setFontColor(DEC_COLOR_.gris);
    if (e[1] === 'monto' || e[1] === 'fuerte' || e[1] === 'texto') h.getRange(e[0], 1, 1, ancho).setBorder(null, null, true, null, null, null, DEC_COLOR_.borde, SpreadsheetApp.BorderStyle.SOLID);
    if (e[1] === 'monto' || e[1] === 'fuerte') h.getRange(e[0], ancho).setFontWeight('bold').setBackground(e[1] === 'fuerte' ? DEC_COLOR_.total : '#f7f9fc');
  });
  h.setColumnWidth(1, 330);
  for (var c = 2; c <= ancho; c++) h.setColumnWidth(c, c === ancho ? 115 : 92);
  h.setFrozenColumns(1);
  h.setHiddenGridlines(true);
  return h;
}

function DEC_reporte621_(ss, filas) {
  var C = function (lista) { return function (r) { return DEC_sumaCas_(r, lista); }; };
  DEC_matriz_(ss, DEC_HOJA.IGV, '📒 PDT 621 · IGV-Renta mensual', '0621', [
    { sec: true, t: 'IGV · VENTAS' },
    { t: 'Ventas netas gravadas (base)', f: C(['100', '154', '160']) },
    { t: 'Descuentos y devoluciones (base)', f: C(['102', '162']) },
    { t: 'IGV de ventas', f: function (r) { return DEC_sumaCas_(r, ['131']) || DEC_sumaCas_(r, ['101', '155', '161']) - DEC_sumaCas_(r, ['103', '163']); } },
    { t: 'Exportaciones (facturadas + embarcadas)', f: C(['106', '127']) },
    { t: 'Ventas no gravadas', f: C(['105', '109', '112']) },
    { sec: true, t: 'IGV · COMPRAS' },
    { t: 'Compras gravadas (base)', f: C(['107', '110', '114', '116', '156']) },
    { t: 'Compras no gravadas', f: C(['113', '119', '120', '122']) },
    { t: 'Crédito fiscal (IGV de compras)', f: function (r) { return DEC_sumaCas_(r, ['178']) || DEC_sumaCas_(r, ['108', '111', '115', '117', '157']); } },
    { sec: true, t: 'IGV · DETERMINACIÓN' },
    { t: 'Impuesto resultante o saldo a favor', f: C(['140']) },
    { t: 'Saldo a favor del período anterior', f: C(['145']) },
    { t: 'Percepciones aplicadas', f: function (r) { return DEC_sumaCas_(r, ['171', '168']) - DEC_sumaCas_(r, ['164']); } },
    { t: 'Retenciones aplicadas', f: function (r) { return DEC_sumaCas_(r, ['179', '176']) - DEC_sumaCas_(r, ['165']); } },
    { t: 'Saldo de percepciones/retenciones no aplicadas (pasa al mes siguiente)', f: C(['164', '165']), tot: false },
    { t: 'IGV a pagar', f: function (r) { return DEC_sumaCas_(r, ['188']) || DEC_trib_(r, /^IGV/i); }, fuerte: true },
    { sec: true, t: 'RENTA · PAGO A CUENTA' },
    { t: 'Ingresos netos', f: C(['301']) },
    { t: 'Coeficiente / porcentaje aplicado', f: function (r) { var c = r.datos.casillas || {}; return DEC_num_(c, '894') || DEC_num_(c, '380') || (DEC_num_(c, '315') ? DEC_num_(c, '315') / 100 : ''); }, tot: false },
    { t: 'Pago a cuenta calculado', f: C(['312']) },
    { t: 'Saldo a favor y créditos aplicados', f: C(['303', '305', '306', '326', '327', '328']) },
    { t: 'Renta a pagar', f: function (r) { return DEC_sumaCas_(r, ['324']) || DEC_trib_(r, /RENTA/i); }, fuerte: true },
    { sec: true, t: 'TOTAL' },
    { t: 'TOTAL A PAGAR (IGV + IVAP + Renta)', f: function (r) { return DEC_sumaCas_(r, ['188', '344', '324']) || r.deuda; }, fuerte: true },
    { t: 'Pagado con la declaración', f: function (r) { return r.pagado; } },
    { t: 'Fecha de presentación', f: function (r) { return r.fecha; }, tot: false, texto: true },
    { t: 'Tipo', f: function (r) { return r.presentaciones > 1 ? 'Rectif. (' + r.presentaciones + ')' : r.tipo; }, tot: false, texto: true },
  ], filas, 'Solo declaraciones vigentes (la última presentada). Montos en soles. «-» = cero. El coeficiente no se suma.');
  // el coeficiente con 4 decimales
  var h = ss.getSheetByName(DEC_HOJA.IGV);
  var a = h.getRange(1, 1, h.getLastRow(), 1).getValues();
  a.forEach(function (x, i) { if (/^Coeficiente/.test(x[0])) h.getRange(i + 1, 2, 1, 12).setNumberFormat('0.0000;-0.0000;"-"'); });
}

function DEC_reporte601_(ss, filas) {
  var C = function (lista) { return function (r) { return DEC_sumaCas_(r, lista); }; };
  var oT = function (lista, rx) { return function (r) { return DEC_sumaCas_(r, lista) || DEC_trib_(r, rx); }; };
  DEC_matriz_(ss, DEC_HOJA.PLAME, '👷 PDT 601 · PLAME (planilla electrónica)', '0601', [
    { sec: true, t: 'PERSONAL' },
    { t: 'Trabajadores', f: function (r) { return Number(r.datos.trabajadores || 0); }, tot: false },
    { t: 'Pensionistas', f: function (r) { return Number(r.datos.pensionistas || 0); }, tot: false },
    { t: 'Prestadores de servicios (4ta categoría)', f: function (r) { return Number(r.datos.personalCuarta || 0); }, tot: false },
    { sec: true, t: 'ESSALUD' },
    { t: 'Base imponible EsSalud', f: C(['452', '463', '454']) },
    { t: 'EsSalud (regular + agrario + +Vida)', f: oT(['412', '423', '414'], /ESSALUD/i) },
    { t: 'Crédito EPS y otras deducciones', f: C(['602', '605', '612']) },
    { sec: true, t: 'PENSIONES Y RENTA' },
    { t: 'Base imponible ONP', f: C(['451']) },
    { t: 'ONP (D.L. 19990)', f: oT(['411'], /SNP|ONP/i) },
    { t: 'Renta de 5ta categoría (retenciones)', f: oT(['415'], /5TA/i) },
    { t: 'Renta de 4ta categoría (retenciones)', f: oT(['421'], /4TA/i) },
    { sec: true, t: 'TOTAL' },
    { t: 'TOTAL A PAGAR', f: function (r) { return DEC_sumaCas_(r, ['802', '813', '804', '801', '805', '811']) || r.deuda; }, fuerte: true },
    { t: 'Pagado con la declaración', f: function (r) { return r.pagado; } },
    { t: 'Fecha de presentación', f: function (r) { return r.fecha; }, tot: false, texto: true },
    { t: 'Tipo', f: function (r) { return r.presentaciones > 1 ? 'Rectif. (' + r.presentaciones + ')' : r.tipo; }, tot: false, texto: true },
  ], filas, 'Solo declaraciones vigentes (la última presentada). Montos en soles. Las cantidades de personal no se suman.');
  var h = ss.getSheetByName(DEC_HOJA.PLAME);
  h.getRange(1, 1, h.getLastRow(), 1).getValues().forEach(function (x, i) { if (/^(Trabajadores|Pensionistas|Prestadores)/.test(x[0])) h.getRange(i + 1, 2, 1, 12).setNumberFormat('0;-0;"-"'); });
}

function DEC_reporte626_(ss, filas) {
  var C = function (lista) { return function (r) { return DEC_sumaCas_(r, lista); }; };
  DEC_matriz_(ss, DEC_HOJA.RET, '🧾 PDT 626 · Agentes de Retención del IGV', '0626', [
    { sec: true, t: 'DETERMINACIÓN DE LA DEUDA' },
    { t: 'Retenciones efectuadas', f: function (r) { return DEC_sumaCas_(r, ['401']) || DEC_trib_(r, /RETENC/i); } },
    { t: 'Pagos previos', f: C(['402']) },
    { t: 'Retención a pagar', f: C(['403']) },
    { t: 'Interés moratorio', f: C(['404']) },
    { t: 'TOTAL DEUDA TRIBUTARIA', f: function (r) { return DEC_sumaCas_(r, ['405']) || r.deuda; }, fuerte: true },
    { t: 'Pagado con la declaración', f: function (r) { return r.pagado; } },
    { t: 'Fecha de presentación', f: function (r) { return r.fecha; }, tot: false, texto: true },
    { t: 'Tipo', f: function (r) { return r.presentaciones > 1 ? 'Rectif. (' + r.presentaciones + ')' : r.tipo; }, tot: false, texto: true },
  ], filas);
}

/** 🔢 Casillas con su sección y nombre oficial (vigentes; solo montos con valor). */
function DEC_reporteCasillas_(ss, filas) {
  var out = [];
  filas.forEach(function (r) {
    if (!r.vigente) return;
    var cas = r.datos.casillas || {}, cat = DEC_catalogo_(r.form);
    Object.keys(cas).forEach(function (k) {
      var num = k.replace(/\D/g, '');
      if (DEC_CAS_NO_MONTO_[num]) return;
      var val = Number(String(cas[k]).trim());
      if (!val) return;
      var c = cat[num];
      out.push([r.empresa, r.ruc, r.periodo.slice(4) + '/' + r.periodo.slice(0, 4), DEC_corto_(r.form), r.numOrd,
        c ? c.sec : '(otras)', c ? c.con : 'Casilla ' + num, c ? c.col : '', num, val, c ? c.orden : 9999 + Number(num), r.periodo]);
    });
  });
  out.sort(function (a, b) { return a[0].localeCompare(b[0]) || b[11].localeCompare(a[11]) || a[3].localeCompare(b[3]) || a[10] - b[10]; });
  var h = ss.getSheetByName(DEC_HOJA.CAS) || ss.insertSheet(DEC_HOJA.CAS);
  h.clear();
  var cab = ['Empresa', 'RUC', 'Periodo', 'Formulario', 'N° orden', 'Sección', 'Concepto (nombre oficial SUNAT)', 'Columna', 'Casilla', 'Valor'];
  h.getRange(1, 1).setValue('🔢 Casillas de las declaraciones vigentes (con valor) — nombres oficiales de SUNAT').setFontSize(13).setFontWeight('bold').setFontColor(DEC_COLOR_.cab);
  h.getRange(2, 1, 1, cab.length).setValues([cab]).setBackground(DEC_COLOR_.cab).setFontColor('#fff').setFontWeight('bold');
  if (out.length) {
    h.getRange(3, 1, out.length, 9).setNumberFormat('@');
    h.getRange(3, 10, out.length, 1).setNumberFormat(DEC_FMT_MONTO_);
    h.getRange(3, 1, out.length, cab.length).setValues(out.map(function (x) { return x.slice(0, 10); }));
    h.getRange(2, 1, out.length + 1, cab.length).createFilter();
  }
  h.setFrozenRows(2); h.setColumnWidth(1, 230); h.setColumnWidth(6, 150); h.setColumnWidth(7, 380); h.setHiddenGridlines(true);
}
