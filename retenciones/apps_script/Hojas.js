/**
 * Retenciones · Grupo — Hojas.js
 * Arma las pestañas Panel, Emitidas, Recibidas y Detalle con lo descargado.
 */

var RET_COLOR = { titulo: '#1f3b5c', cabecera: '#1f3b5c', texto: '#ffffff', suave: '#eef3f8', revertido: '#fde7e9' };

var RET_ENC_EMITIDAS = ['Empresa', 'RUC empresa', 'Periodo', 'Fecha emisión', 'Comprobante', 'RUC proveedor',
  'Proveedor (retenido)', 'Régimen', 'Tasa %', 'Importe retenido S/', 'Importe pagado S/', 'Estado',
  'N° facturas', 'PDF', 'Observación', 'Ruta'];
var RET_ENC_RECIBIDAS = ['Empresa', 'RUC empresa', 'Periodo', 'Fecha emisión', 'Comprobante', 'RUC agente',
  'Agente de retención', 'Régimen', 'Tasa %', 'Importe retenido S/', 'Importe pagado S/', 'Estado',
  'N° facturas', 'PDF', 'Observación', 'Ruta'];
var RET_ENC_DETALLE = ['Empresa', 'Tipo', 'Periodo', 'Comprobante retención', 'Fecha retención', 'RUC agente',
  'RUC proveedor', 'Proveedor', 'Tipo doc.', 'N° documento', 'Fecha doc.', 'Moneda doc.', 'Importe total doc.',
  'N° pago', 'Fecha pago', 'Importe pagado', 'Tipo de cambio', 'Retenido S/', 'Neto pagado S/'];

/* ------------------------------------------------------------- utilidades */

function RET_num_(v) {
  var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/,/g, ''));
  return isNaN(n) ? '' : n;
}

function RET_fecha_(s) {
  var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  // Mediodía: así ningún cambio de zona horaria mueve la fecha al día anterior.
  return m ? new Date(+m[3], +m[2] - 1, +m[1], 12) : (s || '');
}

function RET_periodoTexto_(p) {
  p = String(p || '');
  return p.length === 6 ? p.slice(0, 4) + '-' + p.slice(4) : p;
}

function RET_csvObjetos_(texto) {
  if (!texto) return [];
  var filas = Utilities.parseCsv(texto.replace(/^﻿/, ''));
  if (filas.length < 2) return [];
  var enc = filas[0];
  return filas.slice(1).filter(function (f) { return f.join('') !== ''; }).map(function (f) {
    var o = {};
    enc.forEach(function (k, i) { o[k] = f[i] === undefined ? '' : f[i]; });
    return o;
  });
}

function RET_r2_(x) { return Math.round((x || 0) * 100) / 100; }

/** Abrevia formas societarias largas: "EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA" → "E.I.R.L." */
function RET_nombreCorto_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA/i, 'E.I.R.L.')
    .replace(/SOCIEDAD ANONIMA CERRADA/i, 'S.A.C.')
    .replace(/SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA/i, 'S.R.L.')
    .replace(/SOCIEDAD ANONIMA ABIERTA/i, 'S.A.A.')
    .replace(/SOCIEDAD ANONIMA$/i, 'S.A.');
}

function RET_esRevertido_(estado) { return /REVERT|ANULAD|BAJA/i.test(String(estado || '')); }

/* ------------------------------------------------------- lectura de datos */

/** Lee del repositorio todo lo descargado desde el mes "Desde". */
function RET_leerDatos_(cfg) {
  var archivos = RET_listarArchivos_(cfg);
  var desde = cfg.desde || '000000';
  var rutasCsv = archivos.map(function (a) { return a.path; }).filter(function (p) {
    var m = /^(\d{11})\/(\d{4})\/(\d{2})\/(cre|detalle)\.csv$/.exec(p);
    return m && (m[2] + m[3]) >= desde;
  });
  var textos = RET_leerTextos_(cfg, rutasCsv);
  var empresas = {};
  RET_listarEmpresas_(cfg).forEach(function (e) { if (e.activo) empresas[e.ruc] = e.nombre; });

  var cre = [], det = [];
  rutasCsv.forEach(function (ruta) {
    var filas = RET_csvObjetos_(textos[ruta]);
    if (/cre\.csv$/.test(ruta)) cre = cre.concat(filas); else det = det.concat(filas);
  });
  // Nombres por RUC: los del XML oficial de SUNAT (y si no, empresas.json). Sirven para
  // completar los comprobantes que SUNAT entregó sin XML.
  var nombres = {};
  Object.keys(empresas).forEach(function (r) { nombres[r] = RET_nombreCorto_(empresas[r]); });
  cre.forEach(function (c) {
    if (c.agente) nombres[c.ruc_agente] = RET_nombreCorto_(c.agente);
    if (c.proveedor) nombres[c.ruc_proveedor] = RET_nombreCorto_(c.proveedor);
  });
  cre.forEach(function (c) {
    c.agente = nombres[c.ruc_agente] || c.agente || '';
    c.proveedor = nombres[c.ruc_proveedor] || c.proveedor || '';
    if (empresas[c.empresa_ruc] !== undefined || nombres[c.empresa_ruc]) empresas[c.empresa_ruc] = nombres[c.empresa_ruc];
    c.empresa = nombres[c.empresa_ruc] || c.empresa_ruc;
  });
  det.forEach(function (d) { if (!d.proveedor || nombres[d.ruc_proveedor]) d.proveedor = nombres[d.ruc_proveedor] || d.proveedor; });
  det.forEach(function (d) { d.empresa = nombres[d.empresa_ruc] || d.empresa_ruc; });
  var orden = function (a, b) {
    return (a.empresa + a.periodo + a.serie).localeCompare(b.empresa + b.periodo + b.serie) ||
      (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0);
  };
  cre.sort(orden);
  return { cre: cre, det: det, empresas: empresas, pdfDisponibles: archivos.filter(function (a) { return /\.pdf$/.test(a.path); }).length };
}

/* ----------------------------------------------------------- escritura */

function RET_hoja_(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

/**
 * Escribe una tabla con título (fila 1), nota (fila 2), cabecera (fila 3) y datos desde la fila 4.
 * formatos: {indiceColumna: formatoNumero}
 */
function RET_escribirTabla_(nombre, titulo, nota, encabezados, filas, formatos, anchos) {
  var hoja = RET_hoja_(nombre);
  if (hoja.getFilter()) hoja.getFilter().remove();
  hoja.clear();
  hoja.getRange(1, 1).setValue(titulo).setFontSize(14).setFontWeight('bold').setFontColor(RET_COLOR.titulo);
  hoja.getRange(2, 1).setValue(nota).setFontColor('#666666');
  var n = encabezados.length;
  hoja.getRange(3, 1, 1, n).setValues([encabezados]).setFontWeight('bold')
    .setBackground(RET_COLOR.cabecera).setFontColor(RET_COLOR.texto).setWrap(true).setVerticalAlignment('middle');
  hoja.setFrozenRows(3);
  if (filas.length) {
    // Formatos antes de los valores: así "2026-08" o un RUC no se convierten en fecha/número.
    Object.keys(formatos || {}).forEach(function (i) {
      hoja.getRange(4, +i + 1, filas.length, 1).setNumberFormat(formatos[i]);
    });
    hoja.getRange(4, 1, filas.length, n).setValues(filas);
  }
  hoja.getRange(3, 1, Math.max(filas.length, 1) + 1, n).createFilter();
  (anchos || []).forEach(function (w, i) { if (w) hoja.setColumnWidth(i + 1, w); });
  var sobra = hoja.getMaxColumns() - n;
  if (sobra > 0) hoja.deleteColumns(n + 1, sobra);
  return hoja;
}

function RET_filasCre_(lista, recibidas) {
  return lista.map(function (c) {
    return [c.empresa, c.empresa_ruc, RET_periodoTexto_(c.periodo), RET_fecha_(c.fecha_emision), c.comprobante,
      recibidas ? c.ruc_agente : c.ruc_proveedor, recibidas ? c.agente : c.proveedor, c.regimen,
      RET_num_(c.tasa), RET_num_(c.importe_retenido), RET_num_(c.importe_pagado), c.estado,
      RET_num_(c.facturas), '', c.observacion, c.pdf || ''];
  });
}

function RET_escribirCre_(datos, recibidas) {
  var lista = datos.cre.filter(function (c) { return (c.tipo === 'Recibido') === recibidas; });
  var nombre = recibidas ? RET_HOJA.RECIBIDAS : RET_HOJA.EMITIDAS;
  var titulo = recibidas ? '📥 Retenciones RECIBIDAS (nos retuvieron)' : '📤 Retenciones EMITIDAS (retuvimos a proveedores)';
  var nota = lista.length + ' comprobantes · columna PDF = enlace al PDF oficial en Drive · los revertidos se marcan en rojo';
  var hoja = RET_escribirTabla_(nombre, titulo, nota, recibidas ? RET_ENC_RECIBIDAS : RET_ENC_EMITIDAS,
    RET_filasCre_(lista, recibidas), { 1: '@', 2: '@', 3: 'dd/mm/yyyy', 4: '@', 5: '@', 8: '0.00', 9: '#,##0.00', 10: '#,##0.00', 12: '0', 15: '@' },
    [230, 105, 75, 95, 95, 105, 260, 80, 60, 120, 120, 95, 70, 80, 200, 60]);
  hoja.hideColumns(RET_ENC_EMITIDAS.length);  // Ruta (uso interno)
  if (lista.length) {
    var fondos = lista.map(function (c) {
      var color = RET_esRevertido_(c.estado) ? RET_COLOR.revertido : null;
      return RET_ENC_EMITIDAS.map(function () { return color; });
    });
    hoja.getRange(4, 1, lista.length, RET_ENC_EMITIDAS.length).setBackgrounds(fondos);
  }
  RET_ponerEnlacesPdf_(hoja);
}

function RET_escribirDetalle_(datos) {
  var filas = datos.det.map(function (d) {
    return [d.empresa, d.tipo, RET_periodoTexto_(d.periodo), d.comprobante, RET_fecha_(d.fecha_retencion), d.ruc_agente,
      d.ruc_proveedor, d.proveedor, d.doc_tipo, d.doc_numero, RET_fecha_(d.doc_fecha), d.doc_moneda,
      RET_num_(d.doc_importe_total), d.pago_numero, RET_fecha_(d.pago_fecha), RET_num_(d.pago_importe),
      RET_num_(d.tipo_cambio), RET_num_(d.importe_retenido), RET_num_(d.importe_pagado_neto)];
  });
  RET_escribirTabla_(RET_HOJA.DETALLE, '🧾 Detalle: facturas incluidas en cada comprobante de retención',
    filas.length + ' facturas · del XML oficial de cada comprobante (o de su PDF cuando SUNAT no entregó el XML) · las notas de crédito aplicadas no tienen pago ni retención', RET_ENC_DETALLE, filas,
    { 2: '@', 3: '@', 4: 'dd/mm/yyyy', 5: '@', 6: '@', 9: '@', 10: 'dd/mm/yyyy', 13: '@', 12: '#,##0.00', 14: 'dd/mm/yyyy', 15: '#,##0.00', 16: '0.000', 17: '#,##0.00', 18: '#,##0.00' },
    [230, 80, 75, 110, 95, 105, 105, 240, 90, 110, 90, 70, 115, 60, 90, 110, 80, 105, 115]);
}

/** Panel: resumen por empresa y por mes (sin contar los revertidos en los importes). */
function RET_escribirPanel_(datos, cfg) {
  var hoja = RET_hoja_(RET_HOJA.PANEL);
  hoja.clear();
  hoja.getRange('A1').setValue('🧾 Retenciones · Grupo').setFontSize(18).setFontWeight('bold').setFontColor(RET_COLOR.titulo);
  hoja.getRange('A2').setValue('Actualizado: ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm') +
    '   ·   Desde: ' + RET_periodoTexto_(cfg.desde) + '   ·   Importes en soles, sin contar comprobantes revertidos.').setFontColor('#666666');

  // 1) Resumen por empresa
  var porEmpresa = {};
  Object.keys(datos.empresas).forEach(function (ruc) {
    porEmpresa[ruc] = { nombre: datos.empresas[ruc], en: 0, ei: 0, rn: 0, ri: 0, rev: 0, pdf: 0, total: 0 };
  });
  var periodos = {};
  datos.cre.forEach(function (c) {
    var e = porEmpresa[c.empresa_ruc] || (porEmpresa[c.empresa_ruc] = { nombre: c.empresa, en: 0, ei: 0, rn: 0, ri: 0, rev: 0, pdf: 0, total: 0 });
    e.total++;
    if (c.pdf) e.pdf++;
    if (RET_esRevertido_(c.estado)) { e.rev++; return; }
    var imp = RET_num_(c.importe_retenido) || 0;
    if (c.tipo === 'Recibido') { e.rn++; e.ri += imp; } else { e.en++; e.ei += imp; }
    periodos[c.periodo] = true;
  });
  var filas = Object.keys(porEmpresa).map(function (ruc) {
    var e = porEmpresa[ruc];
    return [e.nombre, ruc, e.en, RET_r2_(e.ei), e.rn, RET_r2_(e.ri), e.rev, e.total ? e.pdf + ' / ' + e.total : '—'];
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  var tot = filas.reduce(function (t, f) { return [t[0] + f[2], t[1] + f[3], t[2] + f[4], t[3] + f[5], t[4] + f[6]]; }, [0, 0, 0, 0, 0]);
  filas.push(['TOTAL GRUPO', '', tot[0], RET_r2_(tot[1]), tot[2], RET_r2_(tot[3]), tot[4], '']);

  var f0 = 4;
  hoja.getRange(f0, 1).setValue('Resumen por empresa').setFontWeight('bold').setFontSize(12);
  var enc = ['Empresa', 'RUC', 'Emitidas (n°)', 'Retuvimos S/', 'Recibidas (n°)', 'Nos retuvieron S/', 'Revertidos', 'PDF descargados'];
  hoja.getRange(f0 + 1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold')
    .setBackground(RET_COLOR.cabecera).setFontColor(RET_COLOR.texto).setWrap(true);
  hoja.getRange(f0 + 2, 2, filas.length, 1).setNumberFormat('@');
  hoja.getRange(f0 + 2, 1, filas.length, enc.length).setValues(filas);
  hoja.getRange(f0 + 2, 4, filas.length, 1).setNumberFormat('#,##0.00');
  hoja.getRange(f0 + 2, 6, filas.length, 1).setNumberFormat('#,##0.00');
  hoja.getRange(f0 + 1 + filas.length, 1, 1, enc.length).setFontWeight('bold').setBackground(RET_COLOR.suave);

  // 2) y 3) Matrices por mes
  var lista = Object.keys(periodos).sort();
  var fila = f0 + filas.length + 4;
  [['Emitido', '📤 Retuvimos por mes (S/)'], ['Recibido', '📥 Nos retuvieron por mes (S/)']].forEach(function (par) {
    hoja.getRange(fila, 1).setValue(par[1]).setFontWeight('bold').setFontSize(12);
    var cab = ['Empresa'].concat(lista.map(function (p) { return RET_MESES[+p.slice(4) - 1] + ' ' + p.slice(2, 4); })).concat(['Total']);
    hoja.getRange(fila + 1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold')
      .setBackground(RET_COLOR.cabecera).setFontColor(RET_COLOR.texto);
    var m = {};
    datos.cre.forEach(function (c) {
      if (c.tipo !== par[0] || RET_esRevertido_(c.estado)) return;
      var k = c.empresa;
      m[k] = m[k] || {};
      m[k][c.periodo] = (m[k][c.periodo] || 0) + (RET_num_(c.importe_retenido) || 0);
    });
    var nombres = Object.keys(m).sort();
    var cuerpo = nombres.map(function (nom) {
      var vals = lista.map(function (p) { return m[nom][p] ? RET_r2_(m[nom][p]) : ''; });
      return [nom].concat(vals).concat([RET_r2_(vals.reduce(function (s, v) { return s + (v || 0); }, 0))]);
    });
    if (!cuerpo.length) cuerpo = [['(sin comprobantes)'].concat(lista.map(function () { return ''; })).concat([''])];
    hoja.getRange(fila + 2, 1, cuerpo.length, cab.length).setValues(cuerpo);
    if (cab.length > 1) hoja.getRange(fila + 2, 2, cuerpo.length, cab.length - 1).setNumberFormat('#,##0.00');
    hoja.getRange(fila + 2, cab.length, cuerpo.length, 1).setFontWeight('bold');
    fila += cuerpo.length + 4;
  });

  hoja.setColumnWidth(1, 300); hoja.setColumnWidth(2, 110);
  for (var c = 3; c <= Math.max(8, lista.length + 2); c++) hoja.setColumnWidth(c, 105);
  hoja.setFrozenRows(2);
  hoja.setHiddenGridlines(true);
}

/** Ordena las pestañas y deja el Panel primero. */
function RET_ordenarPestanas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [RET_HOJA.PANEL, RET_HOJA.EMITIDAS, RET_HOJA.RECIBIDAS, RET_HOJA.DETALLE, RET_HOJA.CONFIG].forEach(function (n, i) {
    var h = ss.getSheetByName(n);
    if (h) { ss.setActiveSheet(h); ss.moveActiveSheet(i + 1); }
  });
  var arch = ss.getSheetByName(RET_HOJA.ARCHIVOS);
  if (arch) arch.hideSheet();
  ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (h && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h);
  });
  ss.setActiveSheet(ss.getSheetByName(RET_HOJA.PANEL));
}

/* -------------------------------------------------------------- acciones */

function RET_actualizarDatos_() {
  // La hoja debe estar en hora de Lima; si no, las fechas se ven un día antes.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSpreadsheetTimeZone() !== 'America/Lima') ss.setSpreadsheetTimeZone('America/Lima');
  var cfg = RET_leerConfig_();
  var datos = RET_leerDatos_(cfg);
  RET_escribirCre_(datos, false);
  RET_escribirCre_(datos, true);
  RET_escribirDetalle_(datos);
  RET_escribirPanel_(datos, cfg);
  RET_ordenarPestanas_();
  RET_marcarActualizacion_(Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'));
  return datos;
}

function RET_conCandado_(fn) {
  var candado = LockService.getScriptLock();
  if (!candado.tryLock(5000)) throw new Error('Ya hay una actualización en curso. Intente en unos minutos.');
  try { return fn(); } finally { candado.releaseLock(); }
}

function RET_menuActualizarDatos() {
  var ui = SpreadsheetApp.getUi();
  try {
    var d = RET_conCandado_(RET_actualizarDatos_);
    ui.alert('✅ Datos actualizados: ' + d.cre.length + ' comprobantes y ' + d.det.length + ' facturas.');
  } catch (e) { ui.alert('❌ ' + e.message); }
}

function RET_menuActualizarTodo() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = RET_conCandado_(function () {
      var d = RET_actualizarDatos_();
      var p = RET_ordenarPdf_(d.cre);
      return { d: d, p: p };
    });
    ui.alert('✅ Listo.\n\nComprobantes: ' + r.d.cre.length + '\nFacturas: ' + r.d.det.length +
      '\nPDF nuevos en Drive: ' + r.p.nuevos + (r.p.renombrados ? '\nPDF renombrados con el nombre del proveedor: ' + r.p.renombrados : '') + (r.p.pendientes ? '\nPDF que faltan (siguen solos en 1 minuto): ' + r.p.pendientes : ''));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

function RET_menuOrdenarPdf() {
  var ui = SpreadsheetApp.getUi();
  try {
    var p = RET_conCandado_(function () { return RET_ordenarPdf_(null); });
    ui.alert('📁 PDF nuevos en Drive: ' + p.nuevos + (p.pendientes ? '\nFaltan ' + p.pendientes + ' (siguen solos en 1 minuto).' : '\nTodos los PDF están en Drive.'));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

/** Importa a la hoja lo que GitHub ya descargo (antes era el disparador diario; ahora lo llama Diario.js). */
function RET_importarAhora_() {
  RET_conCandado_(function () {
    var d = RET_actualizarDatos_();
    RET_ordenarPdf_(d.cre);
  });
}

/** Disparador de continuación de PDF (cuando una tanda no alcanzó el tiempo). */
function RET_continuarPdf() {
  RET_borrarContinuacion_();
  RET_conCandado_(function () { RET_ordenarPdf_(null); });
}
