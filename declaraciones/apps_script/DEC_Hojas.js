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
  'Tributos', 'PDF', 'Recibido', '_pdfId', '_datos'];
var DEC_C_ = {}; DEC_COLS_.forEach(function (c, i) { DEC_C_[c] = i; });
var DEC_RESPALDO_ = 'Respaldo (anteriores)';
var DEC_CASILLAS_ = {   // nombres de las casillas más usadas (el resto se muestra con su número)
  '0621': { '100': 'Ventas netas gravadas (base imponible)', '101': 'IGV de las ventas', '107': 'Compras gravadas destinadas a ventas gravadas (base)', '108': 'IGV de esas compras', '301': 'Ingresos netos (renta)' },
};

function DEC_hojaDecl_(ss) {
  ss = ss || DEC_ss_();
  var h = ss.getSheetByName(DEC_HOJA.DECL);
  if (h) return h;
  h = ss.insertSheet(DEC_HOJA.DECL);
  h.getRange(1, 1, 1, DEC_COLS_.length).setValues([DEC_COLS_]).setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff').setWrap(true);
  h.setFrozenRows(1);
  h.getRange('B:C').setNumberFormat('@'); h.getRange('D:D').setNumberFormat('@'); h.getRange('F:G').setNumberFormat('@'); h.getRange('O:O').setNumberFormat('@');
  h.getRange('K:M').setNumberFormat('#,##0.00');
  h.hideColumns(DEC_C_._pdfId + 1, 2);
  h.setColumnWidth(1, 230); h.setColumnWidth(5, 200); h.setColumnWidth(17, 300);
  return h;
}

/** Filas de 📄 Declaraciones como objetos. */
function DEC_leerDecl_() {
  var h = DEC_hojaDecl_();
  var n = h.getLastRow() - 1;
  if (n < 1) return [];
  var v = h.getRange(2, 1, n, DEC_COLS_.length).getValues();
  var f = h.getRange(2, DEC_C_.PDF + 1, n, 1).getFormulas();
  return v.map(function (r, i) {
    var datos = {};
    try { datos = JSON.parse(r[DEC_C_._datos] || '{}'); } catch (e) {}
    var url = (String(f[i][0]).match(/HYPERLINK\("([^"]+)"/) || [])[1] || '';
    return {
      fila: i + 2, empresa: String(r[0]), ruc: String(r[1]), periodo: String(r[2]), form: String(r[3]), desc: String(r[4]),
      numOrd: String(r[5]), numOrdOri: String(r[6]), tipo: String(r[7]), fecha: DEC_txtFecha_(r[8]), estado: String(r[9]),
      deuda: Number(r[10]) || 0, pagado: Number(r[11]) || 0, importe: Number(r[12]) || 0, banco: String(r[13]), operacion: String(r[14]),
      medio: String(r[15]), pdf: url, pdfId: String(r[DEC_C_._pdfId]), datos: datos,
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
  var fila = [x.empresa, x.ruc, x.periodo, x.form, x.desc, x.numOrd, x.numOrdOri === '0' ? '' : x.numOrdOri, x.tipo, x.fecha, '',
    x.deuda, x.pagado, x.importe, x.banco, x.operacion, x.medio, tributos,
    '=HYPERLINK("' + x.pdf + '"' + DEC_sep_() + '"📄 Ver PDF")', DEC_ahora_(), x.pdfId, JSON.stringify(x.datos).slice(0, 49000)];
  var n = h.getLastRow() - 1, donde = 0;
  if (n > 0) {
    var ords = h.getRange(2, DEC_C_['N° orden'] + 1, n, 1).getDisplayValues();
    for (var i = 0; i < ords.length; i++) if (ords[i][0] === x.numOrd) { donde = i + 2; break; }
  }
  if (!donde) donde = h.getLastRow() + 1;
  h.getRange(donde, 1, 1, fila.length).setValues([fila]);
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
      if (r.estado !== nuevo && r.pdfId) DEC_moverPdf_(r);
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
      fila[DEC_C_.PDF] = o.f[DEC_C_.PDF] || fila[DEC_C_.PDF];
      return fila;
    });
    h.getRange(2, 1, salida.length, DEC_COLS_.length).setValues(salida);
    h.getRange(2, 1, salida.length, DEC_COLS_.length).setBackgrounds(filas.map(function (r) {
      var c = r.vigente ? '#ffffff' : '#eeeeee';
      return DEC_COLS_.map(function () { return c; });
    }));
  }
  DEC_reportePeriodo_(ss, filas);
  DEC_reporteTributos_(ss, filas);
  DEC_reporteCasillas_(ss, filas);
  DEC_panel_(ss, filas);
}

/** Vigente → carpeta del mes; respaldo → «Respaldo (anteriores)» dentro del mes. */
function DEC_moverPdf_(r) {
  try {
    var f = DriveApp.getFileById(r.pdfId);
    var padre = f.getParents().next();
    var mes = padre.getName() === DEC_RESPALDO_ ? padre.getParents().next() : padre;
    var destino = r.vigente ? mes : DEC_sub_(mes, DEC_RESPALDO_);
    if (destino.getId() !== padre.getId()) f.moveTo(destino);
  } catch (e) { console.warn('No se pudo mover el PDF: ' + e.message); }
}

function DEC_escribir_(ss, nombre, titulo, cab, filas, formatos) {
  var h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  h.clear();
  h.getRange(1, 1).setValue(titulo).setFontWeight('bold').setFontSize(12);
  h.getRange(2, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff').setWrap(true);
  if (filas.length) {
    h.getRange(3, 1, filas.length, cab.length).setValues(filas);
    (formatos || []).forEach(function (fmt) { h.getRange(3, fmt[0], filas.length, 1).setNumberFormat(fmt[1]); });
  }
  h.setFrozenRows(2);
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
    return [x.empresa, x.ruc, x.periodo.slice(4) + '/' + x.periodo.slice(0, 4),
      a ? a.fecha : '—', tipo(a), suma(a, /IGV/i), suma(a, /RENTA/i), a ? a.pagado : '',
      b ? b.fecha : '—', tipo(b), b ? Number(b.datos.trabajadores || 0) : '', b ? b.deuda : '', b ? b.pagado : '',
      c ? c.fecha : '—', tipo(c), c ? c.deuda : '', c ? c.pagado : '',
      rect || '', tot, pag];
  });
  var h = DEC_escribir_(ss, DEC_HOJA.PERIODO, '🗂 Declaraciones vigentes por periodo (la última presentada de cada formulario)',
    ['Empresa', 'RUC', 'Periodo', '621 · Presentada', '621 · Tipo', '621 · IGV (deuda)', '621 · Renta (deuda)', '621 · Pagado',
      '601 · Presentada', '601 · Tipo', '601 · Trabajadores', '601 · Total deuda', '601 · Pagado',
      '626 · Presentada', '626 · Tipo', '626 · Retenciones (deuda)', '626 · Pagado', 'Rectificadas', 'Total deuda', 'Total pagado'],
    out, [[6, '#,##0.00'], [7, '#,##0.00'], [8, '#,##0.00'], [12, '#,##0.00'], [13, '#,##0.00'], [16, '#,##0.00'], [17, '#,##0.00'], [19, '#,##0.00'], [20, '#,##0.00']]);
  h.setColumnWidth(1, 230);
  [[4, 8, '#e8f0fe'], [9, 13, '#e6f4ea'], [14, 17, '#fef7e0']].forEach(function (g) { h.getRange(2, g[0], 1, g[1] - g[0] + 1).setBackground(g[2]).setFontColor('#1f1f1f'); });
}

function DEC_reporteTributos_(ss, filas) {
  var out = [];
  filas.forEach(function (r) {
    (r.datos.tributos || []).forEach(function (t) {
      out.push([r.empresa, r.ruc, r.periodo, r.form, r.numOrd, r.vigente ? '✅ Vigente' : '🗄 Respaldo', t.cod, t.nom, t.deuda, t.pagado, t.porPagar]);
    });
  });
  DEC_escribir_(ss, DEC_HOJA.TRIB, '🧾 Tributos de cada declaración (vigentes y de respaldo)',
    ['Empresa', 'RUC', 'Periodo', 'Formulario', 'N° orden', 'Estado', 'Código', 'Tributo', 'Total deuda', 'Pagado', 'Por pagar'],
    out, [[3, '@'], [5, '@'], [9, '#,##0.00'], [10, '#,##0.00'], [11, '#,##0.00']]).setColumnWidth(1, 230);
}

function DEC_reporteCasillas_(ss, filas) {
  var out = [];
  filas.forEach(function (r) {
    if (!r.vigente) return;
    var cas = r.datos.casillas || {}, nombres = DEC_CASILLAS_[r.form] || {};
    Object.keys(cas).forEach(function (k) {
      var num = k.replace(/\D/g, '');
      if (['2', '13', '58'].indexOf(num) >= 0) return;   // RUC, fecha y hora de presentación
      var val = Number(String(cas[k]).trim());
      if (!val) return;   // vacías, cero o texto
      out.push([r.empresa, r.ruc, r.periodo, r.form, r.numOrd, Number(num), nombres[num] || 'Casilla ' + num, val]);
    });
  });
  out.sort(function (a, b) { return a[0].localeCompare(b[0]) || b[2].localeCompare(a[2]) || a[3].localeCompare(b[3]) || a[5] - b[5]; });
  DEC_escribir_(ss, DEC_HOJA.CAS, '🔢 Casillas de las declaraciones vigentes (solo las que tienen valor)',
    ['Empresa', 'RUC', 'Periodo', 'Formulario', 'N° orden', 'Casilla', 'Descripción', 'Valor'],
    out, [[3, '@'], [5, '@'], [8, '#,##0.00']]).setColumnWidth(1, 230);
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
    var e = emp[r.ruc] = emp[r.ruc] || { empresa: r.empresa, ruc: r.ruc, ult: {}, n: 0, rect: 0, tiene: {} };
    e.n++;
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
    return [e.empresa, e.ruc, fmt(e.ult['0621']), fmt(e.ult['0601']), fmt(e.ult['0626']), e.n, e.rect, faltan.length ? '⚠️ ' + faltan.join(' · ') : '✅ al día'];
  });
  var h = DEC_escribir_(ss, DEC_HOJA.PANEL, '📊 Declaraciones · Grupo — ' + DEC_ahora_() + ' · descarga mensual ' + (DEC_mensualActivo_() ? 'activada (día ' + cfg.dia + ')' : 'desactivada'),
    ['Empresa', 'RUC', 'Último PDT 621', 'Último PLAME 601', 'Último PDT 626', 'Declaraciones', 'De respaldo (rectificadas)', 'Faltan en los últimos ' + cfg.meses + ' meses (sin presentar o sin bajar)'],
    out, []);
  h.setColumnWidth(1, 230); h.setColumnWidth(8, 420);
  ss.setActiveSheet(h); ss.moveActiveSheet(1);
}

/* ------------------------------------------------------------ ayuda */

var DEC_AYUDA_ = [
  ['¿Qué hace esta hoja?', 'Baja de SUNAT SOL las declaraciones presentadas de todas las empresas: PDT 621 (IGV-Renta mensual), PDT 601 (PLAME) y PDT 626 (Agentes de Retención), con su constancia oficial en PDF, y arma un reporte ordenado.'],
  ['¿De dónde las saca?', 'SUNAT SOL → Mis declaraciones y pagos → Consultas → Consulta de Declaraciones y Pagos (la misma pantalla que usaría una persona; solo se LEE).'],
  ['¿Cuándo se bajan?', 'Solas, una vez al mes (día de ⚙️ Config, por defecto 28, cuando ya vencieron todas las empresas). Revisan los últimos meses para recoger rectificatorias hechas después. A mano: menú 📑 Declaraciones → ⬇ Pedir a SUNAT.'],
  ['Rectificatorias', 'Cada presentación tiene su N° de orden. Se bajan TODAS. La última presentada es la ✅ Vigente (es la que cuenta en los reportes); las anteriores quedan como 🗄 Respaldo y su PDF pasa a la carpeta «Respaldo (anteriores)» del mes.'],
  ['¿Dónde quedan los PDF?', 'En Drive, carpeta «PDF Declaraciones» junto a esta hoja: <RUC - Empresa>/<Año>/<Mes>/. Botón 📂 Abrir carpeta de PDF.'],
  ['¿Y GitHub?', 'El robot corre en GitHub pero NO guarda nada allí (el repositorio es público): manda cada constancia directo a esta hoja con una llave de un solo uso que vence en 6 horas. En el registro de GitHub solo aparece cuántas hubo.'],
  ['Pestañas', '📊 Panel (resumen y lo que falta) · 🗂 Por periodo (el reporte: lo vigente de 621, 601 y 626 por empresa y mes) · 📄 Declaraciones (todas las presentaciones con su PDF) · 🧾 Tributos · 🔢 Casillas · ⚙️ Config.'],
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
