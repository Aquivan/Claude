/**
 * Detracciones · Grupo — Drive.js
 * Convierte a PDF las Constancias de Depósito descargadas de SUNAT (HTML oficial,
 * detracciones/datos/<RUC>/<AAAA>/<MM>/constancias/<N°>.html) y las ordena en Drive:
 *   <carpeta de esta hoja>/PDF Detracciones/<RUC - Empresa>/<AAAA>/<NN_Mes>/
 *     2026-09-22 316028094 TARVOS TECNOLOGIA S.A.C.S 113.00.pdf
 * La pestaña oculta "_Archivos" recuerda qué constancia ya se copió (no se duplica).
 * En la pestaña Detracciones, la columna "Constancia PDF" enlaza a cada PDF.
 */

var DET_LIMITE_MS = 4.5 * 60 * 1000;  // Apps Script corta a los 6 minutos
var DET_MESES_CARPETA = ['01_Enero', '02_Febrero', '03_Marzo', '04_Abril', '05_Mayo', '06_Junio',
  '07_Julio', '08_Agosto', '09_Setiembre', '10_Octubre', '11_Noviembre', '12_Diciembre'];
var DET_COL = { EMPRESA: 1, RUC: 2, ROL: 3, FECHA: 4, CONSTANCIA: 7, PROVEEDOR: 9, ADQ: 10, MONTO: 13 };

function DET_mapaArchivos_() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DET_HOJA.ARCHIVOS);
  var mapa = {};
  if (!hoja || hoja.getLastRow() < 2) return mapa;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach(function (f) { if (f[0] && f[1]) mapa[f[0]] = f[1]; });
  return mapa;
}

function DET_guardarEnMapa_(nuevos) {
  if (!nuevos.length) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(DET_HOJA.ARCHIVOS);
  if (!hoja) {
    hoja = ss.insertSheet(DET_HOJA.ARCHIVOS);
    hoja.getRange(1, 1, 1, 4).setValues([['Ruta en GitHub', 'Id en Drive', 'Copiado', 'Nombre']]).setFontWeight('bold');
    hoja.hideSheet();
  }
  hoja.getRange(hoja.getLastRow() + 1, 1, nuevos.length, 4).setValues(nuevos);
}

function DET_subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return padre.createFolder(nombre);
}

function DET_limpiarNombre_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Constancias que están en la pestaña Detracciones y todavía no se copiaron. */
function DET_constanciasPendientes_(mapa) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DET_HOJA.DETALLE);
  if (!hoja || hoja.getLastRow() < 4) return [];
  var n = DET_ENC.length;
  var vistos = {};
  return hoja.getRange(4, 1, hoja.getLastRow() - 3, n).getValues().map(function (f) {
    return { ruta: String(f[n - 1] || ''), empresa: f[DET_COL.EMPRESA - 1], ruc: String(f[DET_COL.RUC - 1]), fecha: f[DET_COL.FECHA - 1],
      constancia: String(f[DET_COL.CONSTANCIA - 1]), nombre: /Me depositaron/.test(f[DET_COL.ROL - 1]) ? f[DET_COL.ADQ - 1] : f[DET_COL.PROVEEDOR - 1],
      monto: +f[DET_COL.MONTO - 1] || 0 };
  }).filter(function (p) {
    if (!p.ruta || mapa[p.ruta] || vistos[p.ruta]) return false;
    vistos[p.ruta] = 1;
    return true;
  });
}

/** El HTML de SUNAT sin scripts, listo para convertir a PDF. */
function DET_htmlLimpio_(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<link[^>]*>/gi, '');
}

function DET_ordenarConstancias_() {
  var inicio = Date.now();
  var cfg = DET_leerConfig_();
  if (!cfg.copiarConstancias) return { nuevos: 0, pendientes: 0, apagado: true };
  var mapa = DET_mapaArchivos_();
  var pendientes = DET_constanciasPendientes_(mapa);
  if (!pendientes.length) { DET_borrarContinuacion_(); return { nuevos: 0, pendientes: 0 }; }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var padres = DriveApp.getFileById(ss.getId()).getParents();
  var raiz = DET_subcarpeta_(padres.hasNext() ? padres.next() : DriveApp.getRootFolder(), cfg.carpetaPdf || 'PDF Detracciones');
  var cache = {}, nuevos = [], hechos = 0;
  for (var i = 0; i < pendientes.length && Date.now() - inicio < DET_LIMITE_MS; i += 20) {
    var lote = pendientes.slice(i, i + 20);
    var textos = DET_leerTextos_(cfg, lote.map(function (p) { return p.ruta; }));
    lote.forEach(function (p) {
      if (Date.now() - inicio > DET_LIMITE_MS || !textos[p.ruta]) return;
      try {
        var f = p.fecha instanceof Date ? p.fecha : new Date();
        var anio = String(f.getFullYear()), mes = f.getMonth() + 1;
        var clave = p.ruc + '|' + anio + '|' + mes;
        if (!cache[clave]) {
          var emp = DET_subcarpeta_(raiz, DET_limpiarNombre_(p.ruc + ' - ' + p.empresa));
          cache[clave] = DET_subcarpeta_(DET_subcarpeta_(emp, anio), DET_MESES_CARPETA[mes - 1]);
        }
        var nombre = DET_limpiarNombre_(Utilities.formatDate(f, 'America/Lima', 'yyyy-MM-dd') + ' ' + p.constancia + ' ' +
          String(p.nombre || '').slice(0, 50) + ' ' + p.monto.toFixed(2)) + '.pdf';
        var existe = cache[clave].getFilesByName(nombre);
        var archivo = existe.hasNext() ? existe.next() : null;
        if (!archivo) {
          var pdf = Utilities.newBlob(DET_htmlLimpio_(textos[p.ruta]), 'text/html', p.constancia + '.html').getAs('application/pdf').setName(nombre);
          archivo = cache[clave].createFile(pdf);
        }
        nuevos.push([p.ruta, archivo.getId(), new Date(), nombre]);
        hechos++;
      } catch (e) {
        console.warn('No se pudo copiar ' + p.ruta + ': ' + e.message);
      }
    });
    if (nuevos.length >= 40) { DET_guardarEnMapa_(nuevos); nuevos = []; }
  }
  DET_guardarEnMapa_(nuevos);
  var h = ss.getSheetByName(DET_HOJA.DETALLE);
  if (h) DET_ponerEnlaces_(h);
  var faltan = pendientes.length - hechos;
  var corto = Date.now() - inicio >= DET_LIMITE_MS;
  if (faltan > 0 && corto) DET_programarContinuacion_(); else DET_borrarContinuacion_();
  return { nuevos: hechos, pendientes: corto ? faltan : 0 };
}

/** Columna "Constancia PDF": enlace al PDF en Drive (o "—" si todavía no está). */
function DET_ponerEnlaces_(hoja) {
  var n = hoja.getLastRow() - 3;
  if (n < 1) return;
  var col = DET_ENC.length;
  var mapa = DET_mapaArchivos_();
  var celdas = hoja.getRange(4, col, n, 1).getValues().map(function (r) {
    var id = mapa[String(r[0] || '')];
    var t = SpreadsheetApp.newRichTextValue();
    if (!id) return [t.setText(r[0] ? '⏳ por copiar' : '—').build()];
    var texto = '📄 Ver constancia';
    return [t.setText(texto).setLinkUrl(0, texto.length, 'https://drive.google.com/file/d/' + id + '/view').build()];
  });
  hoja.getRange(4, col - 1, n, 1).setRichTextValues(celdas);
}

/** Si una tanda no terminó por tiempo, se programa la siguiente en 1 minuto. */
function DET_programarContinuacion_() {
  var ya = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'DET_continuarConstancias'; });
  if (!ya) ScriptApp.newTrigger('DET_continuarConstancias').timeBased().after(60 * 1000).create();
}

function DET_borrarContinuacion_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'DET_continuarConstancias') ScriptApp.deleteTrigger(t);
  });
}
