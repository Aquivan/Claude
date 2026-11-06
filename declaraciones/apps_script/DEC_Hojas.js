/**
 * 📑 Declaraciones — pestañas y reportes (DEC_Hojas.js).
 *   📄 Declaraciones : una fila por cada presentación (originales y rectificatorias), con su PDF.
 *   🗂 Por periodo    : el reporte: por empresa y periodo, lo VIGENTE de cada formulario (621 / 601 / 626).
 *   🧾 Tributos       : el detalle de tributos de cada declaración (total deuda, pagado, por pagar).
 *   🔢 Casillas       : las casillas de las declaraciones vigentes (para cruzar con la contabilidad).
 *   📊 Panel          : resumen por empresa y lo que falta presentar o bajar.
 * Vigente = la ÚLTIMA presentada de cada empresa + formulario + periodo; las anteriores son «respaldo»
 * (sus PDF pasan a la subcarpeta «Respaldo (anteriores)» del mes).
 */

var DEC_COLS_ = ['Empresa', 'RUC', 'Periodo', 'Formulario', 'Descripción', 'N° orden', 'N° orden original', 'Tipo',
  'Fecha presentación', 'Estado', 'Total deuda', 'Total pagado', 'Importe pagado (banco)', 'Banco', 'N° operación', 'Medio',
  'Tributos', 'Constancia', 'Detalle', 'Recibido', '_pdfId', '_detId', '_datos'];
var DEC_C_ = {}; DEC_COLS_.forEach(function (c, i) { DEC_C_[c] = i; });
var DEC_RESPALDO_ = 'Respaldo (anteriores)';

function DEC_hojaDecl_(ss) {
  ss = ss || DEC_ss_();
  var h = ss.getSheetByName(DEC_HOJA.DECL);
  if (h) return DEC_migrarDecl_(h);
  h = ss.insertSheet(DEC_HOJA.DECL);
  h.getRange(1, 1, 1, DEC_COLS_.length).setValues([DEC_COLS_]).setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff').setWrap(true);
  h.setFrozenRows(1);
  DEC_formatoDecl_(h);
  return h;
}

function DEC_formatoDecl_(h) {
  h.getRange('B:D').setNumberFormat('@'); h.getRange('F:G').setNumberFormat('@'); h.getRange('O:O').setNumberFormat('@');
  h.getRange('I:I').setNumberFormat('dd/mm/yyyy');
  h.getRange('K:M').setNumberFormat('#,##0.00;[Red]-#,##0.00;"-"');
  h.hideColumns(DEC_C_._pdfId + 1, 3);
  h.setColumnWidth(1, 230); h.setColumnWidth(5, 220); h.setColumnWidth(17, 320);
}

/** Hoja de la versión anterior (sin «Detalle»): agrega las columnas Detalle y _detId sin perder nada. */
function DEC_migrarDecl_(h) {
  var cab = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
  if (cab[DEC_C_.Detalle] === 'Detalle') return h;
  if (cab[17] === 'PDF' && cab[18] === 'Recibido' && cab[19] === '_pdfId' && cab[20] === '_datos') {
    h.showColumns(1, h.getLastColumn());
    h.insertColumnAfter(18); h.getRange(1, 19).setValue('Detalle');
    h.insertColumnAfter(21); h.getRange(1, 22).setValue('_detId');
    h.getRange(1, 18).setValue('Constancia');
    h.getRange(1, 1, 1, DEC_COLS_.length).setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff');
    // fechas que Google dejó como texto o con el día y el mes cambiados: se vuelven fechas reales
    var n = h.getLastRow() - 1;
    if (n > 0) {
      var f = h.getRange(2, 9, n, 1).getValues().map(function (x) { return [DEC_aFecha_(x[0])]; });
      h.getRange(2, 9, n, 1).setNumberFormat('dd/mm/yyyy').setValues(f);
    }
    DEC_formatoDecl_(h);
  }
  return h;
}

/** «20/10/2026» (o una fecha de Google) → Date. */
function DEC_aFecha_(v) {
  if (v instanceof Date) return v;
  var m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : v;
}

/** Filas de 📄 Declaraciones como objetos. */
function DEC_leerDecl_() {
  var h = DEC_hojaDecl_();
  var n = h.getLastRow() - 1;
  if (n < 1) return [];
  var v = h.getRange(2, 1, n, DEC_COLS_.length).getValues();
  var f = h.getRange(2, DEC_C_.Constancia + 1, n, 2).getFormulas();
  return v.map(function (r, i) {
    var datos = {};
    try { datos = JSON.parse(r[DEC_C_._datos] || '{}'); } catch (e) {}
    var url = (String(f[i][0]).match(/HYPERLINK\("([^"]+)"/) || [])[1] || '';
    var urlDet = (String(f[i][1]).match(/HYPERLINK\("([^"]+)"/) || [])[1] || '';
    return {
      fila: i + 2, empresa: String(r[0]), ruc: String(r[1]), periodo: String(r[2]), form: String(r[3]), desc: String(r[4]),
      numOrd: String(r[5]), numOrdOri: String(r[6]), tipo: String(r[7]), fecha: DEC_txtFecha_(r[8]), estado: String(r[9]),
      deuda: Number(r[10]) || 0, pagado: Number(r[11]) || 0, importe: Number(r[12]) || 0, banco: String(r[13]), operacion: String(r[14]),
      medio: String(r[15]), pdf: url, pdfId: String(r[DEC_C_._pdfId]), det: urlDet, detId: String(r[DEC_C_._detId] || ''), datos: datos,
    };
  });
}

/** Separador de argumentos de fórmula según el idioma de la hoja («,» en inglés, «;» en español). */
function DEC_sep_() {
  try { return /^en/i.test(DEC_ss_().getSpreadsheetLocale()) ? ',' : ';'; } catch (e) { return ';'; }
}

function DEC_txtFecha_(v) {
  return v instanceof Date ? Utilities.formatDate(v, 'America/Lima', 'dd/MM/yyyy') : String(v || '');
}

/** Agrega (o reemplaza, si ya estaba ese N° de orden) una declaración. */
function DEC_anotar_(x) {
  var h = DEC_hojaDecl_();
  var tributos = (x.datos.tributos || []).map(function (t) { return t.nom + ': ' + t.deuda.toFixed(2); }).join(' · ');
  var donde = DEC_filaDe_(h, x.numOrd), detF = '', detId = '';
  if (x.det) { detF = '=HYPERLINK("' + x.det + '"' + DEC_sep_() + '"🧾 Ver detalle")'; detId = x.detId; }
  else if (donde) { detF = h.getRange(donde, DEC_C_.Detalle + 1).getFormula(); detId = h.getRange(donde, DEC_C_._detId + 1).getValue(); }   // se conserva el detalle ya bajado
  var fila = [x.empresa, x.ruc, x.periodo, x.form, x.desc, x.numOrd, x.numOrdOri === '0' ? '' : x.numOrdOri, x.tipo, DEC_aFecha_(x.fecha), '',
    x.deuda, x.pagado, x.importe, x.banco, x.operacion, x.medio, tributos,
    '=HYPERLINK("' + x.pdf + '"' + DEC_sep_() + '"📄 Constancia")', detF, DEC_ahora_(), x.pdfId, detId, JSON.stringify(x.datos).slice(0, 49000)];
  if (!donde) donde = h.getLastRow() + 1;
  h.getRange(donde, 1, 1, fila.length).setValues([fila]);
}

function DEC_filaDe_(h, numOrd) {
  var n = h.getLastRow() - 1;
  if (n < 1) return 0;
  var ords = h.getRange(2, DEC_C_['N° orden'] + 1, n, 1).getDisplayValues();
  for (var i = 0; i < ords.length; i++) if (ords[i][0] === String(numOrd)) return i + 2;
  return 0;
}

/** Pone el PDF «Detalle de la declaración» en su fila. */
function DEC_ponerDetalle_(numOrd, url, id) {
  var h = DEC_hojaDecl_(), f = DEC_filaDe_(h, numOrd);
  if (!f) return false;
  h.getRange(f, DEC_C_.Detalle + 1).setFormula('=HYPERLINK("' + url + '"' + DEC_sep_() + '"🧾 Ver detalle")');
  h.getRange(f, DEC_C_._detId + 1).setValue(id);
  return true;
}

function DEC_clave_(r) { return r.ruc + '|' + r.form + '|' + r.periodo; }
function DEC_ordenFecha_(r) {
  var m = r.fecha.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return (m ? m[3] + m[2] + m[1] : '00000000') + ('000000000000' + r.numOrd).slice(-12);
}

function DEC_menuRehacer() {
  DEC_rehacer_();
  SpreadsheetApp.getUi().alert('🔄 Reportes al día.');
}

/** Marca vigentes / respaldo, ordena los PDF en Drive y rehace todos los reportes. */
function DEC_rehacer_() {
  var ss = DEC_ss_(), h = DEC_hojaDecl_(ss);
  var filas = DEC_leerDecl_();
  var grupos = {};
  filas.forEach(function (r) { (grupos[DEC_clave_(r)] = grupos[DEC_clave_(r)] || []).push(r); });
  Object.keys(grupos).forEach(function (k) {
    var g = grupos[k].sort(function (a, b) { return DEC_ordenFecha_(a) < DEC_ordenFecha_(b) ? -1 : 1; });
    g.forEach(function (r, i) {
      var nuevo = i === g.length - 1 ? '✅ Vigente' : '🗄 Respaldo (reemplazada por N° ' + g[g.length - 1].numOrd + ')';
      r.vigente = i === g.length - 1; r.presentaciones = g.length;
      if (r.estado !== nuevo) { if (r.pdfId) DEC_moverPdf_(r, r.pdfId); if (r.detId) DEC_moverPdf_(r, r.detId); }
      r.estado = nuevo;
    });
  });
  if (filas.length) {
    // ordenar: empresa, periodo (nuevo primero), formulario, fecha
    filas.sort(function (a, b) {
      return a.empresa.localeCompare(b.empresa) || b.periodo.localeCompare(a.periodo) || a.form.localeCompare(b.form) || (DEC_ordenFecha_(a) < DEC_ordenFecha_(b) ? -1 : 1);
    });
    var v = h.getRange(2, 1, filas.length, DEC_COLS_.length).getValues();
    var fm = h.getRange(2, 1, filas.length, DEC_COLS_.length).getFormulas();
    var porOrd = {};
    v.forEach(function (r, i) { porOrd[String(r[DEC_C_['N° orden']])] = { v: r, f: fm[i] }; });
    var salida = filas.map(function (r) {
      var o = porOrd[r.numOrd];
      var fila = o.v.slice();
      fila[DEC_C_.Estado] = r.estado;
      fila[DEC_C_.Constancia] = o.f[DEC_C_.Constancia] || fila[DEC_C_.Constancia];
      fila[DEC_C_.Detalle] = o.f[DEC_C_.Detalle] || fila[DEC_C_.Detalle];
      return fila;
    });
    h.getRange(2, 1, salida.length, DEC_COLS_.length).setValues(salida);
    h.getRange(2, 1, salida.length, DEC_COLS_.length).setBackgrounds(filas.map(function (r) {
      var c = r.vigente ? '#ffffff' : '#eeeeee';
      return DEC_COLS_.map(function () { return c; });
    }));
  }
  DEC_reportePeriodo_(ss, filas);
  DEC_reporte621_(ss, filas);
  DEC_reporte601_(ss, filas);
  DEC_reporte626_(ss, filas);
  DEC_reporteTributos_(ss, filas);
  DEC_reporteCasillas_(ss, filas);
  DEC_panel_(ss, filas);
  DEC_ordenPestanas_(ss);
}

/** Vigente → carpeta del mes; respaldo → «Respaldo (anteriores)» dentro del mes. */
function DEC_moverPdf_(r, id) {
  try {
    var f = DriveApp.getFileById(id);
    var padre = f.getParents().next();
    var mes = padre.getName() === DEC_RESPALDO_ ? padre.getParents().next() : padre;
    var destino = r.vigente ? mes : DEC_sub_(mes, DEC_RESPALDO_);
    if (destino.getId() !== padre.getId()) f.moveTo(destino);
  } catch (e) { console.warn('No se pudo mover el PDF: ' + e.message); }
}

function DEC_escribir_(ss, nombre, titulo, cab, filas, formatos) {
  var h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  h.clear(); h.getBandings().forEach(function (b) { b.remove(); });
  h.getRange(1, 1).setValue(titulo).setFontWeight('bold').setFontSize(12);
  h.getRange(2, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff').setWrap(true);
  if (filas.length) {
    (formatos || []).forEach(function (fmt) { h.getRange(3, fmt[0], filas.length, 1).setNumberFormat(fmt[1]); });   // ANTES de escribir
    h.getRange(3, 1, filas.length, cab.length).setValues(filas);
    h.getRange(3, 1, filas.length, cab.length).setFontFamily('Arial').setFontSize(10);
    h.getRange(3, 1, filas.length, cab.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  }
  h.getRange(1, 1).setFontColor('#1f3b5c').setFontSize(13);
  h.setFrozenRows(2); h.setHiddenGridlines(true);
  return h;
}

/** 🗂 Por periodo: lo vigente de cada formulario, por empresa y periodo. */
function DEC_reportePeriodo_(ss, filas) {
  var por = {};
  filas.forEach(function (r) {
    if (!r.vigente) return;
    var k = r.ruc + '|' + r.periodo;
    var x = por[k] = por[k] || { empresa: r.empresa, ruc: r.ruc, periodo: r.periodo, f: {} };
    x.f[r.form] = r;
  });
  var tipo = function (r) { return r ? (r.presentaciones > 1 ? 'Rectificada (' + r.presentaciones + ' presentaciones)' : r.tipo) : ''; };
  var suma = function (r, rx) { return r ? (r.datos.tributos || []).filter(function (t) { return rx.test(t.nom); }).reduce(function (s, t) { return s + t.deuda; }, 0) : ''; };
  var out = Object.keys(por).map(function (k) { return por[k]; }).sort(function (a, b) {
    return a.empresa.localeCompare(b.empresa) || b.periodo.localeCompare(a.periodo);
  }).map(function (x) {
    var a = x.f['0621'], b = x.f['0601'], c = x.f['0626'];
    var rect = [a, b, c].filter(function (r) { return r && r.presentaciones > 1; }).length;
    var tot = [a, b, c].reduce(function (s, r) { return s + (r ? r.deuda : 0); }, 0);
    var pag = [a, b, c].reduce(function (s, r) { return s + (r ? r.pagado : 0); }, 0);
    var fe = function (r) { return r ? DEC_aFecha_(r.fecha) : '—'; };
    return [x.empresa, x.ruc, x.periodo.slice(4) + '/' + x.periodo.slice(0, 4),
      fe(a), tipo(a), suma(a, /IGV/i), suma(a, /RENTA/i), a ? a.pagado : '',
      fe(b), tipo(b), b ? Number(b.datos.trabajadores || 0) : '', b ? b.deuda : '', b ? b.pagado : '',
      fe(c), tipo(c), c ? c.deuda : '', c ? c.pagado : '',
      rect || '', tot, pag];
  });
  var h = DEC_escribir_(ss, DEC_HOJA.PERIODO, '🗂 Declaraciones vigentes por periodo (la última presentada de cada formulario)',
    ['Empresa', 'RUC', 'Periodo', '621 · Presentada', '621 · Tipo', '621 · IGV (deuda)', '621 · Renta (deuda)', '621 · Pagado',
      '601 · Presentada', '601 · Tipo', '601 · Trabajadores', '601 · Total deuda', '601 · Pagado',
      '626 · Presentada', '626 · Tipo', '626 · Retenciones (deuda)', '626 · Pagado', 'Rectificadas', 'Total deuda', 'Total pagado'],
    out, [[2, '@'], [3, '@'], [4, 'dd/mm/yyyy'], [9, 'dd/mm/yyyy'], [14, 'dd/mm/yyyy'], [11, '0'], [6, DEC_FMT_MONTO_], [7, DEC_FMT_MONTO_], [8, DEC_FMT_MONTO_], [12, DEC_FMT_MONTO_], [13, DEC_FMT_MONTO_], [16, DEC_FMT_MONTO_], [17, DEC_FMT_MONTO_], [19, DEC_FMT_MONTO_], [20, DEC_FMT_MONTO_]]);
  h.setColumnWidth(1, 230);
  [[4, 8, '#e8f0fe'], [9, 13, '#e6f4ea'], [14, 17, '#fef7e0']].forEach(function (g) { h.getRange(2, g[0], 1, g[1] - g[0] + 1).setBackground(g[2]).setFontColor('#1f1f1f'); });
}

function DEC_reporteTributos_(ss, filas) {
  var out = [];
  filas.forEach(function (r) {
    (r.datos.tributos || []).forEach(function (t) {
      out.push([r.empresa, r.ruc, r.periodo.slice(4) + '/' + r.periodo.slice(0, 4), DEC_corto_(r.form), r.numOrd, r.vigente ? '✅ Vigente' : '🗄 Respaldo', t.cod, t.nom, t.deuda, t.pagado, t.porPagar]);
    });
  });
  DEC_escribir_(ss, DEC_HOJA.TRIB, '🧾 Tributos de cada declaración (vigentes y de respaldo)',
    ['Empresa', 'RUC', 'Periodo', 'Formulario', 'N° orden', 'Estado', 'Código', 'Tributo', 'Total deuda', 'Pagado', 'Por pagar'],
    out, [[2, '@'], [3, '@'], [4, '@'], [5, '@'], [7, '@'], [9, DEC_FMT_MONTO_], [10, DEC_FMT_MONTO_], [11, DEC_FMT_MONTO_]]).setColumnWidth(1, 230);
}

/** 📊 Panel: por empresa, últimos periodos y lo que falta. */
function DEC_panel_(ss, filas) {
  var cfg = DEC_cfg_();
  // Solo se exigen los periodos ya vencidos: el mes anterior recién cuenta desde el día de la descarga mensual.
  var hoyDia = Number(Utilities.formatDate(new Date(), 'America/Lima', 'd'));
  var meses = [];
  for (var i = cfg.meses + (hoyDia >= cfg.dia ? 0 : 1); i >= (hoyDia >= cfg.dia ? 1 : 2); i--) meses.push(DEC_mesAtras_(i));
  var emp = {};
  filas.forEach(function (r) {
    var e = emp[r.ruc] = emp[r.ruc] || { empresa: r.empresa, ruc: r.ruc, ult: {}, n: 0, rect: 0, tiene: {}, deuda: {}, det: 0, conDet: 0 };
    e.n++;
    if (r.vigente) e.deuda[r.periodo] = (e.deuda[r.periodo] || 0) + r.deuda;
    if (r.form === '0621' || r.form === '0626') { e.conDet++; if (r.det) e.det++; }
    if (!r.vigente) e.rect++;
    if (r.vigente && (!e.ult[r.form] || r.periodo > e.ult[r.form])) e.ult[r.form] = r.periodo;
    e.tiene[r.form + '|' + r.periodo] = 1;
  });
  var fmt = function (p) { return p ? p.slice(4) + '/' + p.slice(0, 4) : '—'; };
  var out = Object.keys(emp).map(function (k) { return emp[k]; }).sort(function (a, b) { return a.empresa.localeCompare(b.empresa); }).map(function (e) {
    var faltan = [];
    cfg.formularios.forEach(function (f) {
      if (!e.ult[f]) return;   // nunca presentó ese formulario: no se exige
      meses.forEach(function (p) { if (!e.tiene[f + '|' + p]) faltan.push(DEC_corto_(f) + ' ' + fmt(p)); });
    });
    var ultP = Object.keys(e.deuda).sort().pop();
    return [e.empresa, e.ruc, fmt(e.ult['0621']), fmt(e.ult['0601']), fmt(e.ult['0626']), ultP ? fmt(ultP) : '—', ultP ? e.deuda[ultP] : '',
      e.n, e.rect, e.conDet ? e.det + ' de ' + e.conDet : '—', faltan.length ? '⚠️ ' + faltan.join(' · ') : '✅ al día'];
  });
  var h = DEC_escribir_(ss, DEC_HOJA.PANEL, '📊 Declaraciones · Grupo — ' + DEC_ahora_() + ' · descarga mensual ' + (DEC_mensualActivo_() ? 'activada (día ' + cfg.dia + ')' : 'desactivada'),
    ['Empresa', 'RUC', 'Último PDT 621', 'Último PLAME 601', 'Último PDT 626', 'Último periodo', 'Deuda declarada del último periodo (621+601+626)', 'Declaraciones', 'De respaldo (rectificadas)', 'Detalles PDF (621 y 626)', 'Faltan en los últimos ' + cfg.meses + ' meses (sin presentar o sin bajar)'],
    out, [[2, '@'], [3, '@'], [4, '@'], [5, '@'], [6, '@'], [7, DEC_FMT_MONTO_], [8, '0'], [9, '0'], [10, '@']]);
  h.setColumnWidth(1, 260); h.setColumnWidth(7, 150); h.setColumnWidth(11, 420); h.setRowHeight(2, 42);
}

/* ------------------------------------------------------------ ayuda */

var DEC_AYUDA_ = [
  ['¿Qué hace esta hoja?', 'Baja de SUNAT SOL las declaraciones presentadas de todas las empresas: PDT 621 (IGV-Renta mensual), PDT 601 (PLAME) y PDT 626 (Agentes de Retención), con su constancia oficial en PDF, y arma un reporte ordenado.'],
  ['¿De dónde las saca?', 'SUNAT SOL → Mis declaraciones y pagos → Consultas → Consulta de Declaraciones y Pagos (la misma pantalla que usaría una persona; solo se LEE).'],
  ['¿Cuándo se bajan?', 'Solas, una vez al mes (día de ⚙️ Config, por defecto 28, cuando ya vencieron todas las empresas). Revisan los últimos meses para recoger rectificatorias hechas después. A mano: menú 📑 Declaraciones → ⬇ Pedir a SUNAT.'],
  ['Rectificatorias', 'Cada presentación tiene su N° de orden. Se bajan TODAS. La última presentada es la ✅ Vigente (es la que cuenta en los reportes); las anteriores quedan como 🗄 Respaldo y su PDF pasa a la carpeta «Respaldo (anteriores)» del mes.'],
  ['¿Dónde quedan los PDF?', 'En Drive, carpeta «PDF Declaraciones» junto a esta hoja: <RUC - Empresa>/<Año>/<Mes>/. Botón 📂 Abrir carpeta de PDF.'],
  ['¿Y GitHub?', 'El robot corre en GitHub pero NO guarda nada allí (el repositorio es público): manda cada constancia directo a esta hoja con una llave de un solo uso que vence en 6 horas. En el registro de GitHub solo aparece cuántas hubo.'],
  ['Pestañas', '📊 Panel (resumen por empresa, deuda del último periodo, detalles bajados y lo que falta) · 📒 IGV-Renta 621, 👷 PLAME 601 y 🧾 Retenciones 626 (por empresa y año: conceptos en filas, meses en columnas y el total del año con fórmula) · 🗂 Por periodo (las tres declaraciones lado a lado) · 📄 Declaraciones (todas las presentaciones con 📄 Constancia y 🧾 Detalle) · 🧾 Tributos · 🔢 Casillas (con su nombre oficial de SUNAT) · ⚙️ Config.'],
  ['Constancia y detalle', 'Constancia = el comprobante de presentación (tributos y monto). Detalle = la declaración completa con todas sus casillas, el PDF oficial de SUNAT «Detalle de la declaración»; SUNAT lo da para el PDT 621 y el 626 (para el PLAME presentado con el PDT no lo da, pero sus casillas sí están en la hoja). Ambos quedan en la misma carpeta del mes en Drive.'],
  ['Primera vez', '1) Menú 📑 Declaraciones → 🔑 Guardar token de GitHub (el mismo de las otras hojas). 2) 🧰 Preparar la hoja (activa la descarga mensual). 3) ⬇ Pedir a SUNAT lo nuevo, o elegir periodos (por ejemplo 202601-202610).'],
  ['Si algo falla', '🔎 Estado de la última descarga dice qué pasó por empresa. «SUNAT lenta» se arregla pidiendo de nuevo más tarde. Las que ya llegaron no se vuelven a bajar.'],
];

function DEC_hojaAyuda_(ss) {
  ss = ss || DEC_ss_();
  var h = ss.getSheetByName(DEC_HOJA.AYUDA) || ss.insertSheet(DEC_HOJA.AYUDA);
  h.clear();
  h.getRange(1, 1).setValue('📖 Ayuda — Declaraciones · Grupo').setFontWeight('bold').setFontSize(13);
  h.getRange(3, 1, DEC_AYUDA_.length, 2).setValues(DEC_AYUDA_).setWrap(true).setVerticalAlignment('top');
  h.getRange(3, 1, DEC_AYUDA_.length, 1).setFontWeight('bold');
  h.setColumnWidth(1, 200); h.setColumnWidth(2, 720);
}

function DEC_menuAyuda() {
  var html = '<div style="font:13px Arial;line-height:1.45">' + DEC_AYUDA_.map(function (a) {
    return '<p><b>' + a[0] + '</b><br>' + String(a[1]).replace(/</g, '&lt;') + '</p>';
  }).join('') + '</div>';
  SpreadsheetApp.getUi().showModelessDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(520), '❓ Ayuda');
}

/** Orden de las pestañas: primero el resumen y los reportes, al final el detalle y la configuración. */
function DEC_ordenPestanas_(ss) {
  [DEC_HOJA.PANEL, DEC_HOJA.IGV, DEC_HOJA.PLAME, DEC_HOJA.RET, DEC_HOJA.PERIODO, DEC_HOJA.DECL, DEC_HOJA.TRIB, DEC_HOJA.CAS, DEC_HOJA.AYUDA, DEC_HOJA.CONFIG].forEach(function (n, i) {
    var h = ss.getSheetByName(n); if (!h) return;
    ss.setActiveSheet(h); ss.moveActiveSheet(i + 1);
  });
  var p = ss.getSheetByName(DEC_HOJA.PANEL); if (p) ss.setActiveSheet(p);
}
