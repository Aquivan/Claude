/**
 * Notificaciones · Grupo — Hojas.js
 * Arma Panel, Notificaciones y Mensajes con lo descargado del Buzón Electrónico.
 */

var NOT_COLOR = { titulo: '#1f3b5c', cabecera: '#1f3b5c', texto: '#ffffff', suave: '#eef3f8', nueva: '#fff4c2', coactiva: '#fde7e9', noLeida: '#e8f0fe' };

var NOT_ENC_NOTIF = ['Empresa', 'RUC empresa', 'Fecha publicación', 'Surte efecto (día hábil siguiente)', 'Tipo de documento',
  'N° documento', 'Asunto', 'Etiqueta', 'Leída', 'Adjuntos', 'PDF', 'Código', 'Rutas'];
var NOT_ENC_MSJ = ['Empresa', 'RUC empresa', 'Fecha publicación', 'Asunto', 'Leído', 'Adjuntos', 'Código'];

/* ------------------------------------------------------------- utilidades */

function NOT_fechaHora_(s) {
  var m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(String(s || '').trim());
  return m ? new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0) : '';
}

/** Día hábil siguiente al depósito (sin feriados: solo salta sábado y domingo). */
function NOT_surteEfecto_(f) {
  if (!(f instanceof Date)) return '';
  var d = new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1, 12);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

function NOT_csvObjetos_(texto) {
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

function NOT_nombreCorto_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA/i, 'E.I.R.L.')
    .replace(/SOCIEDAD ANONIMA CERRADA/i, 'S.A.C.');
}

function NOT_esCoactiva_(r) { return /coactiva|embargo/i.test(r.clase + ' ' + r.asunto); }

/* ------------------------------------------------------- lectura de datos */

function NOT_leerDatos_(cfg) {
  var archivos = NOT_listarArchivos_(cfg);
  var rutas = archivos.map(function (a) { return a.path; }).filter(function (p) { return /^\d{11}\/(notificaciones|mensajes)\.csv$/.test(p); });
  var textos = NOT_leerTextos_(cfg, rutas);
  var empresas = {};
  NOT_listarEmpresas_(cfg).forEach(function (e) { if (e.activo) empresas[e.ruc] = NOT_nombreCorto_(e.nombre); });
  var desde = cfg.desde || '000000';
  var notif = [], msj = [];
  rutas.forEach(function (ruta) {
    NOT_csvObjetos_(textos[ruta]).forEach(function (r) {
      r.empresa = empresas[r.empresa_ruc] || r.empresa_ruc;
      r.fecha = NOT_fechaHora_(r.fecha_publicacion);
      var p = r.fecha instanceof Date ? Utilities.formatDate(r.fecha, 'America/Lima', 'yyyyMM') : '';
      if (p && p < desde) return;
      (/notificaciones\.csv$/.test(ruta) ? notif : msj).push(r);
    });
  });
  var orden = function (a, b) { return (b.fecha || 0) - (a.fecha || 0) || a.empresa.localeCompare(b.empresa); };
  notif.sort(orden); msj.sort(orden);
  return { notif: notif, msj: msj, empresas: empresas };
}

/* ----------------------------------------------------------- escritura */

function NOT_hoja_(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function NOT_escribirTabla_(nombre, titulo, nota, encabezados, filas, formatos, anchos) {
  var hoja = NOT_hoja_(nombre);
  if (hoja.getFilter()) hoja.getFilter().remove();
  hoja.clear();
  hoja.getRange(1, 1).setValue(titulo).setFontSize(14).setFontWeight('bold').setFontColor(NOT_COLOR.titulo);
  hoja.getRange(2, 1).setValue(nota).setFontColor('#666666');
  var n = encabezados.length;
  hoja.getRange(3, 1, 1, n).setValues([encabezados]).setFontWeight('bold')
    .setBackground(NOT_COLOR.cabecera).setFontColor(NOT_COLOR.texto).setWrap(true).setVerticalAlignment('middle');
  hoja.setFrozenRows(3);
  if (filas.length) {
    Object.keys(formatos || {}).forEach(function (i) { hoja.getRange(4, +i + 1, filas.length, 1).setNumberFormat(formatos[i]); });
    hoja.getRange(4, 1, filas.length, n).setValues(filas);
  }
  hoja.getRange(3, 1, Math.max(filas.length, 1) + 1, n).createFilter();
  (anchos || []).forEach(function (w, i) { if (w) hoja.setColumnWidth(i + 1, w); });
  var sobra = hoja.getMaxColumns() - n;
  if (sobra > 0) hoja.deleteColumns(n + 1, sobra);
  return hoja;
}

function NOT_escribirNotificaciones_(datos, cfg) {
  var limite = Date.now() - cfg.diasNueva * 86400000;
  var filas = datos.notif.map(function (r) {
    return [r.empresa, r.empresa_ruc, r.fecha, NOT_surteEfecto_(r.fecha), r.clase, r.documento, r.asunto, r.etiqueta,
      r.leido, +r.adjuntos || 0, '', r.codigo, r.archivos || (r.nota_pdf ? '⚠️ ' + r.nota_pdf : '')];
  });
  var nuevas = datos.notif.filter(function (r) { return r.fecha instanceof Date && r.fecha.getTime() >= limite; }).length;
  var coact = datos.notif.filter(NOT_esCoactiva_).length;
  var hoja = NOT_escribirTabla_(NOT_HOJA.NOTIF, '📬 Notificaciones del Buzón Electrónico SUNAT',
    filas.length + ' notificaciones · ' + nuevas + ' de los últimos ' + cfg.diasNueva + ' días (amarillo) · ' + coact +
    ' de cobranza coactiva / embargo (rojo) · no leídas en azul · "Surte efecto" = día hábil siguiente al depósito (sin contar feriados)',
    NOT_ENC_NOTIF, filas, { 1: '@', 2: 'dd/mm/yyyy hh:mm', 3: 'dd/mm/yyyy', 5: '@', 9: '0', 11: '@', 12: '@' },
    [190, 100, 120, 110, 190, 150, 420, 160, 55, 65, 150, 95, 60]);
  hoja.hideColumns(NOT_ENC_NOTIF.length);
  hoja.hideColumns(NOT_ENC_NOTIF.length - 1);
  if (filas.length) {
    hoja.getRange(4, 1, filas.length, NOT_ENC_NOTIF.length).setBackgrounds(datos.notif.map(function (r) {
      var c = NOT_esCoactiva_(r) ? NOT_COLOR.coactiva : (r.fecha instanceof Date && r.fecha.getTime() >= limite) ? NOT_COLOR.nueva :
        r.leido === 'NO' ? NOT_COLOR.noLeida : null;
      return NOT_ENC_NOTIF.map(function () { return c; });
    }));
    hoja.getRange(4, 7, filas.length, 1).setWrap(true);
  }
  hoja.setFrozenColumns(1);
  NOT_ponerEnlacesPdf_(hoja);
}

function NOT_escribirMensajes_(datos) {
  var filas = datos.msj.map(function (r) { return [r.empresa, r.empresa_ruc, r.fecha, r.asunto, r.leido, +r.adjuntos || 0, r.codigo]; });
  var hoja = NOT_escribirTabla_(NOT_HOJA.MENSAJES, '✉️ Mensajes del Buzón (avisos, reportes, recordatorios)',
    filas.length + ' mensajes · no son notificaciones de actos administrativos · no leídos en azul',
    NOT_ENC_MSJ, filas, { 1: '@', 2: 'dd/mm/yyyy hh:mm', 5: '0', 6: '@' }, [190, 100, 120, 520, 60, 70, 95]);
  if (filas.length) {
    hoja.getRange(4, 1, filas.length, NOT_ENC_MSJ.length).setBackgrounds(datos.msj.map(function (r) {
      var c = r.leido === 'NO' ? NOT_COLOR.noLeida : null;
      return NOT_ENC_MSJ.map(function () { return c; });
    }));
  }
}

function NOT_escribirPanel_(datos, cfg) {
  var hoja = NOT_hoja_(NOT_HOJA.PANEL);
  hoja.clear();
  hoja.getRange('A1').setValue('📬 Notificaciones · Grupo').setFontSize(18).setFontWeight('bold').setFontColor(NOT_COLOR.titulo);
  hoja.getRange('A2').setValue('Buzón Electrónico SUNAT · actualizado: ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm') +
    '   ·   Desde: ' + cfg.desde.slice(0, 4) + '-' + cfg.desde.slice(4)).setFontColor('#666666');
  var limite = Date.now() - cfg.diasNueva * 86400000;
  var limite30 = Date.now() - 30 * 86400000;
  var clases = {};
  datos.notif.forEach(function (r) { clases[r.clase] = (clases[r.clase] || 0) + 1; });
  var listaClases = Object.keys(clases).sort(function (a, b) { return clases[b] - clases[a]; });
  var porEmp = {};
  Object.keys(datos.empresas).forEach(function (ruc) { porEmp[ruc] = { nom: datos.empresas[ruc], t: 0, n: 0, d30: 0, nl: 0, co: 0, ult: null, c: {}, m: 0, mnl: 0 }; });
  datos.notif.forEach(function (r) {
    var e = porEmp[r.empresa_ruc] || (porEmp[r.empresa_ruc] = { nom: r.empresa, t: 0, n: 0, d30: 0, nl: 0, co: 0, ult: null, c: {}, m: 0, mnl: 0 });
    e.t++;
    var ms = r.fecha instanceof Date ? r.fecha.getTime() : 0;
    if (ms >= limite) e.n++;
    if (ms >= limite30) e.d30++;
    if (r.leido === 'NO') e.nl++;
    if (NOT_esCoactiva_(r)) e.co++;
    if (r.fecha instanceof Date && (!e.ult || r.fecha > e.ult)) e.ult = r.fecha;
    e.c[r.clase] = (e.c[r.clase] || 0) + 1;
  });
  datos.msj.forEach(function (r) { var e = porEmp[r.empresa_ruc]; if (e) { e.m++; if (r.leido === 'NO') e.mnl++; } });
  var enc = ['Empresa', 'RUC', 'Notificaciones', 'Últimos ' + cfg.diasNueva + ' días', 'Últimos 30 días', 'No leídas',
    'Coactiva / embargo', 'Última notificación', 'Mensajes', 'Mensajes no leídos'];
  var filas = Object.keys(porEmp).map(function (ruc) {
    var e = porEmp[ruc];
    return [e.nom, ruc, e.t, e.n, e.d30, e.nl, e.co, e.ult || '', e.m, e.mnl];
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  hoja.getRange(4, 1).setValue('Resumen por empresa').setFontWeight('bold').setFontSize(12);
  hoja.getRange(5, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground(NOT_COLOR.cabecera).setFontColor(NOT_COLOR.texto).setWrap(true);
  hoja.getRange(6, 2, filas.length, 1).setNumberFormat('@');
  hoja.getRange(6, 1, filas.length, enc.length).setValues(filas);
  hoja.getRange(6, 8, filas.length, 1).setNumberFormat('dd/mm/yyyy');
  hoja.getRange(6, 4, filas.length, 1).setBackground(NOT_COLOR.nueva).setFontWeight('bold');
  hoja.getRange(6, 7, filas.length, 1).setBackground(NOT_COLOR.coactiva).setFontWeight('bold');

  var fila = 6 + filas.length + 2;
  hoja.getRange(fila, 1).setValue('Por tipo de documento').setFontWeight('bold').setFontSize(12);
  var cab = ['Empresa'].concat(listaClases).concat(['Total']);
  hoja.getRange(fila + 1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground(NOT_COLOR.cabecera).setFontColor(NOT_COLOR.texto).setWrap(true);
  var cuerpo = Object.keys(porEmp).sort(function (a, b) { return porEmp[a].nom.localeCompare(porEmp[b].nom); }).map(function (ruc) {
    var e = porEmp[ruc];
    return [e.nom].concat(listaClases.map(function (c) { return e.c[c] || ''; })).concat([e.t]);
  });
  if (cuerpo.length) hoja.getRange(fila + 2, 1, cuerpo.length, cab.length).setValues(cuerpo);

  fila += cuerpo.length + 4;
  var ultimas = datos.notif.slice(0, 15).map(function (r) { return [r.empresa, r.fecha, NOT_surteEfecto_(r.fecha), r.clase, r.documento, r.asunto]; });
  hoja.getRange(fila, 1).setValue('🔔 Últimas 15 notificaciones del grupo').setFontWeight('bold').setFontSize(12);
  var encU = ['Empresa', 'Publicada', 'Surte efecto', 'Tipo', 'N° documento', 'Asunto'];
  hoja.getRange(fila + 1, 1, 1, encU.length).setValues([encU]).setFontWeight('bold').setBackground(NOT_COLOR.cabecera).setFontColor(NOT_COLOR.texto);
  if (ultimas.length) {
    hoja.getRange(fila + 2, 5, ultimas.length, 1).setNumberFormat('@');
    hoja.getRange(fila + 2, 1, ultimas.length, encU.length).setValues(ultimas);
    hoja.getRange(fila + 2, 2, ultimas.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    hoja.getRange(fila + 2, 3, ultimas.length, 1).setNumberFormat('dd/mm/yyyy');
  }
  hoja.setColumnWidth(1, 260);
  for (var c = 2; c <= Math.max(10, cab.length); c++) hoja.setColumnWidth(c, 115);
  hoja.setColumnWidth(6, 115);
  hoja.setFrozenRows(2);
  hoja.setHiddenGridlines(true);
}

function NOT_ordenarPestanas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [NOT_HOJA.PANEL, NOT_HOJA.NOTIF, NOT_HOJA.MENSAJES, NOT_HOJA.CONFIG].forEach(function (n, i) {
    var h = ss.getSheetByName(n);
    if (h) { ss.setActiveSheet(h); ss.moveActiveSheet(i + 1); }
  });
  var arch = ss.getSheetByName(NOT_HOJA.ARCHIVOS);
  if (arch) arch.hideSheet();
  ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (h && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h);
  });
  ss.setActiveSheet(ss.getSheetByName(NOT_HOJA.PANEL));
}

/* -------------------------------------------------------------- acciones */

function NOT_actualizarDatos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSpreadsheetTimeZone() !== 'America/Lima') ss.setSpreadsheetTimeZone('America/Lima');
  var cfg = NOT_leerConfig_();
  var datos = NOT_leerDatos_(cfg);
  NOT_escribirNotificaciones_(datos, cfg);
  NOT_escribirMensajes_(datos);
  NOT_escribirPanel_(datos, cfg);
  NOT_ordenarPestanas_();
  NOT_marcarActualizacion_(Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'));
  return datos;
}

function NOT_conCandado_(fn) {
  var candado = LockService.getScriptLock();
  if (!candado.tryLock(5000)) throw new Error('Ya hay una actualización en curso. Intente en unos minutos.');
  try { return fn(); } finally { candado.releaseLock(); }
}

function NOT_menuActualizarDatos() {
  var ui = SpreadsheetApp.getUi();
  try {
    var d = NOT_conCandado_(NOT_actualizarDatos_);
    ui.alert('✅ Datos actualizados: ' + d.notif.length + ' notificaciones y ' + d.msj.length + ' mensajes.');
  } catch (e) { ui.alert('❌ ' + e.message); }
}

function NOT_menuActualizarTodo() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = NOT_conCandado_(function () { var d = NOT_actualizarDatos_(); return { d: d, p: NOT_ordenarPdf_() }; });
    ui.alert('✅ Listo.\n\nNotificaciones: ' + r.d.notif.length + '\nMensajes: ' + r.d.msj.length +
      (r.p.apagado ? '\nCopia de PDF a Drive: desactivada en Config.' : '\nPDF nuevos en Drive: ' + r.p.nuevos +
        (r.p.pendientes ? '\nPDF que faltan (siguen solos en 1 minuto): ' + r.p.pendientes : '')));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

function NOT_menuOrdenarPdf() {
  var ui = SpreadsheetApp.getUi();
  try {
    var p = NOT_conCandado_(function () { return NOT_ordenarPdf_(); });
    ui.alert(p.apagado ? 'La copia de PDF a Drive está desactivada (Config → Copiar PDF a Drive = NO).' :
      '📁 PDF nuevos en Drive: ' + p.nuevos + (p.pendientes ? '\nFaltan ' + p.pendientes + ' (siguen solos en 1 minuto).' : '\nTodos los PDF están en Drive.'));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

/** Importa a la hoja lo que GitHub ya descargo (antes era el disparador diario; ahora lo llama Diario.js). */
function NOT_importarAhora_() {
  NOT_conCandado_(function () { NOT_actualizarDatos_(); NOT_ordenarPdf_(); });
}

function NOT_continuarPdf() {
  NOT_borrarContinuacion_();
  NOT_conCandado_(function () { NOT_ordenarPdf_(); });
}
