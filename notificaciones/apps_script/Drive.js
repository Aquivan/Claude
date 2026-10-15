/**
 * Notificaciones · Grupo — Drive.js
 * Copia los PDF de las notificaciones a Drive, ordenados igual que SIRE:
 *   <carpeta de esta hoja>/PDF Notificaciones/<RUC - Empresa>/<AAAA>/<NN_Mes>/
 *     2026-09-21 Resolución de Ejecución Coactiva 211-006-0033228 - documento.pdf
 * La pestaña oculta "_Archivos" recuerda qué PDF ya se copió (no se duplica).
 * En la pestaña Notificaciones, la columna PDF muestra un enlace por archivo.
 */

var NOT_LIMITE_MS = 4.5 * 60 * 1000;  // Apps Script corta a los 6 minutos
var NOT_COL = { EMPRESA: 1, RUC: 2, FECHA: 3, CLASE: 5, DOC: 6, PDF: 11, RUTAS: 13 };

function NOT_mapaArchivos_() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOT_HOJA.ARCHIVOS);
  var mapa = {};
  if (!hoja || hoja.getLastRow() < 2) return mapa;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach(function (f) { if (f[0] && f[1]) mapa[f[0]] = f[1]; });
  return mapa;
}

function NOT_guardarEnMapa_(nuevos) {
  if (!nuevos.length) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(NOT_HOJA.ARCHIVOS);
  if (!hoja) {
    hoja = ss.insertSheet(NOT_HOJA.ARCHIVOS);
    hoja.getRange(1, 1, 1, 4).setValues([['Ruta en GitHub', 'Id en Drive', 'Copiado', 'Nombre']]).setFontWeight('bold');
    hoja.hideSheet();
  }
  hoja.getRange(hoja.getLastRow() + 1, 1, nuevos.length, 4).setValues(nuevos);
}

function NOT_subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return padre.createFolder(nombre);
}

function NOT_limpiarNombre_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
}

/** Archivos de la pestaña Notificaciones: [{ruta, empresa, ruc, fecha, clase, doc}] */
function NOT_archivosEnHoja_() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOT_HOJA.NOTIF);
  var res = [];
  if (!hoja || hoja.getLastRow() < 4) return res;
  var v = hoja.getRange(4, 1, hoja.getLastRow() - 3, NOT_COL.RUTAS).getValues();
  v.forEach(function (f) {
    String(f[NOT_COL.RUTAS - 1] || '').split(';').filter(function (x) { return /^\d{11}\//.test(x); }).forEach(function (ruta) {
      res.push({ ruta: ruta, empresa: f[NOT_COL.EMPRESA - 1], ruc: String(f[NOT_COL.RUC - 1]), fecha: f[NOT_COL.FECHA - 1],
        clase: f[NOT_COL.CLASE - 1], doc: f[NOT_COL.DOC - 1] });
    });
  });
  return res;
}

function NOT_ordenarPdf_() {
  var inicio = Date.now();
  var cfg = NOT_leerConfig_();
  if (!cfg.copiarPdf) return { nuevos: 0, pendientes: 0, apagado: true };
  var mapa = NOT_mapaArchivos_();
  var pendientes = NOT_archivosEnHoja_().filter(function (p) { return !mapa[p.ruta]; });
  if (!pendientes.length) { NOT_borrarContinuacion_(); return { nuevos: 0, pendientes: 0 }; }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var padres = DriveApp.getFileById(ss.getId()).getParents();
  var raiz = NOT_subcarpeta_(padres.hasNext() ? padres.next() : DriveApp.getRootFolder(), cfg.carpetaPdf || 'PDF Notificaciones');
  var cache = {}, nuevos = [], hechos = 0;
  for (var i = 0; i < pendientes.length; i++) {
    if (Date.now() - inicio > NOT_LIMITE_MS) break;
    var p = pendientes[i];
    var f = p.fecha instanceof Date ? p.fecha : new Date();
    var anio = String(f.getFullYear()), mes = f.getMonth() + 1;
    var clave = p.ruc + '|' + anio + '|' + mes;
    try {
      if (!cache[clave]) {
        var emp = NOT_subcarpeta_(raiz, NOT_limpiarNombre_(p.ruc + ' - ' + p.empresa));
        cache[clave] = NOT_subcarpeta_(NOT_subcarpeta_(emp, anio), NOT_MESES_CARPETA[mes - 1]);
      }
      var archivoOriginal = p.ruta.split('/').pop().replace(/^\d+-/, '');
      var mExt = /\.[a-z0-9]{2,4}$/i.exec(archivoOriginal);
      var ext = mExt ? mExt[0].toLowerCase() : '.pdf';
      var base = mExt ? archivoOriginal.slice(0, mExt.index) : archivoOriginal;
      var nombre = NOT_limpiarNombre_(Utilities.formatDate(f, 'America/Lima', 'yyyy-MM-dd') + ' ' + p.clase + ' ' + (p.doc || '') +
        ' - ' + base) + ext;
      var existe = cache[clave].getFilesByName(nombre);
      var archivo = existe.hasNext() ? existe.next() : null;
      if (!archivo) {
        var blob = NOT_leerBlob_(cfg, p.ruta, nombre);
        if (!blob) continue;
        var tipos = { '.pdf': 'application/pdf', '.zip': 'application/zip', '.jpg': 'image/jpeg', '.png': 'image/png' };
        archivo = cache[clave].createFile(blob.setContentType(tipos[ext] || 'application/octet-stream'));
      }
      nuevos.push([p.ruta, archivo.getId(), new Date(), nombre]);
      hechos++;
    } catch (e) {
      console.warn('No se pudo copiar ' + p.ruta + ': ' + e.message);
    }
    if (nuevos.length >= 25) { NOT_guardarEnMapa_(nuevos); nuevos = []; }
  }
  NOT_guardarEnMapa_(nuevos);
  var h = ss.getSheetByName(NOT_HOJA.NOTIF);
  if (h) NOT_ponerEnlacesPdf_(h);
  var faltan = pendientes.length - hechos;
  var corto = Date.now() - inicio > NOT_LIMITE_MS;
  if (faltan > 0 && corto) NOT_programarContinuacion_(); else NOT_borrarContinuacion_();
  return { nuevos: hechos, pendientes: corto ? faltan : 0 };
}

/** Columna PDF: un enlace por archivo ("📄 documento · 📄 constancia"). */
function NOT_ponerEnlacesPdf_(hoja) {
  var n = hoja.getLastRow() - 3;
  if (n < 1) return;
  var mapa = NOT_mapaArchivos_();
  var rutas = hoja.getRange(4, NOT_COL.RUTAS, n, 1).getValues();
  var celdas = rutas.map(function (r) {
    var lista = String(r[0] || '').split(';').filter(function (x) { return /^\d{11}\//.test(x); });
    var t = SpreadsheetApp.newRichTextValue();
    if (!lista.length) return [t.setText(/^⚠️/.test(String(r[0])) ? (/vac[ií]o/.test(String(r[0])) ? '⚠️ SUNAT lo entrega vacío' : '⚠️ no se pudo bajar') : '—').build()];
    var partes = lista.map(function (ruta) {
      var nom = ruta.split('/').pop().replace(/^\d+-/, '').replace(/\.[a-z0-9]{2,4}$/i, '');
      return { texto: '📄 ' + (/constancia/i.test(nom) ? 'constancia' : nom.slice(0, 22)), id: mapa[ruta] };
    });
    var texto = partes.map(function (p) { return p.texto; }).join('  ');
    t.setText(texto);
    var pos = 0;
    partes.forEach(function (p) {
      if (p.id) t.setLinkUrl(pos, pos + p.texto.length, 'https://drive.google.com/file/d/' + p.id + '/view');
      pos += p.texto.length + 2;
    });
    return [t.build()];
  });
  hoja.getRange(4, NOT_COL.PDF, n, 1).setRichTextValues(celdas);
}
