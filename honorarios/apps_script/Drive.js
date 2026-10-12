/**
 * Honorarios · Grupo — Drive.js
 * Copia los PDF oficiales a Drive, ordenados igual que SIRE:
 *   <carpeta de esta hoja>/PDF Honorarios/<RUC - Empresa>/<AAAA>/<NN_Mes>/
 *     E001-28 - NOMBRE DEL EMISOR.pdf
 * La pestaña oculta "_Archivos" recuerda qué PDF ya se copió (no se duplica).
 */

var HON_LIMITE_MS = 4.5 * 60 * 1000;  // Apps Script corta a los 6 minutos
var HON_COL = { EMPRESA: 1, RUC: 2, PERIODO: 3, COMPROBANTE: 6, CONTRAPARTE: 9, PDF: 18, RUTA: 19 };

function HON_mapaArchivos_(conNombres) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HON_HOJA.ARCHIVOS);
  var mapa = {};
  if (!hoja || hoja.getLastRow() < 2) return mapa;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 4).getValues().forEach(function (f, i) {
    if (f[0] && f[1]) mapa[f[0]] = conNombres ? { id: f[1], nombre: f[3], fila: i + 2 } : f[1];
  });
  return mapa;
}

function HON_nombrePdf_(p) {
  return HON_limpiarNombre_(p.comprobante + (p.contraparte ? ' - ' + p.contraparte : '')) + '.pdf';
}

/** Filas de Recibos con su PDF (para copiar o renombrar). */
function HON_filasConPdf_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = [];
  var hoja = ss.getSheetByName(HON_HOJA.RECIBOS);
  if (!hoja || hoja.getLastRow() < 4) return res;
  hoja.getRange(4, 1, hoja.getLastRow() - 3, HON_COL.RUTA).getDisplayValues().forEach(function (f) {
    var ruta = f[HON_COL.RUTA - 1];
    if (ruta) res.push({ ruta: ruta, empresa: f[HON_COL.EMPRESA - 1], ruc: f[HON_COL.RUC - 1],
      periodo: f[HON_COL.PERIODO - 1], comprobante: f[HON_COL.COMPROBANTE - 1], contraparte: f[HON_COL.CONTRAPARTE - 1] });
  });
  return res;
}

/** Si un PDF ya copiado quedó sin el nombre del proveedor/agente (dato que llegó después), lo renombra. */
function HON_renombrarPdf_(inicio) {
  var mapa = HON_mapaArchivos_(true);
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HON_HOJA.ARCHIVOS);
  if (!hoja) return 0;
  var n = 0;
  HON_filasConPdf_().forEach(function (p) {
    var m = mapa[p.ruta];
    if (!m || Date.now() - inicio > HON_LIMITE_MS) return;
    var esperado = HON_nombrePdf_(p);
    if (m.nombre === esperado) return;
    try {
      var archivo = DriveApp.getFileById(m.id);
      if (archivo.getName() !== esperado) { archivo.setName(esperado); n++; }
      hoja.getRange(m.fila, 4).setValue(esperado);
    } catch (e) {
      console.warn('No se pudo renombrar ' + p.ruta + ': ' + e.message);
    }
  });
  return n;
}

function HON_guardarEnMapa_(nuevos) {
  if (!nuevos.length) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HON_HOJA.ARCHIVOS);
  if (!hoja) {
    hoja = ss.insertSheet(HON_HOJA.ARCHIVOS);
    hoja.getRange(1, 1, 1, 4).setValues([['Ruta en GitHub', 'Id en Drive', 'Copiado', 'Nombre']]).setFontWeight('bold');
    hoja.hideSheet();
  }
  hoja.getRange(1, 4).setValue('Nombre').setFontWeight('bold');
  hoja.getRange(hoja.getLastRow() + 1, 1, nuevos.length, 4).setValues(nuevos);
}

function HON_subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) return f;
  }
  return padre.createFolder(nombre);
}

function HON_carpetaPdf_(cfg) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var padres = DriveApp.getFileById(ss.getId()).getParents();
  var base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  return HON_subcarpeta_(base, cfg.carpetaPdf || 'PDF Honorarios');
}

function HON_limpiarNombre_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}

/** PDF que faltan copiar. */
function HON_pendientesPdf_(mapa) {
  return HON_filasConPdf_().filter(function (p) { return !mapa[p.ruta]; });
}

/** Copia los PDF que falten. Devuelve {nuevos, pendientes}. */
function HON_ordenarPdf_() {
  var inicio = Date.now();
  var cfg = HON_leerConfig_();
  if (!cfg.copiarPdf) return { nuevos: 0, pendientes: 0, renombrados: 0, apagado: true };
  var mapa = HON_mapaArchivos_();
  var pendientes = HON_pendientesPdf_(mapa);
  if (!pendientes.length) {
    var ren = HON_renombrarPdf_(inicio);
    HON_borrarContinuacion_();
    return { nuevos: 0, pendientes: 0, renombrados: ren };
  }

  var raiz = HON_carpetaPdf_(cfg);
  var cache = {};
  var carpeta = function (p) {
    var anio = p.periodo.slice(0, 4), mes = +p.periodo.slice(5, 7);
    var clave = p.ruc + '|' + anio + '|' + mes;
    if (!cache[clave]) {
      var emp = HON_subcarpeta_(raiz, HON_limpiarNombre_(p.ruc + ' - ' + p.empresa));
      cache[clave] = HON_subcarpeta_(HON_subcarpeta_(emp, anio), HON_MESES_CARPETA[mes - 1]);
    }
    return cache[clave];
  };

  var nuevos = [], hechos = 0;
  for (var i = 0; i < pendientes.length; i++) {
    if (Date.now() - inicio > HON_LIMITE_MS) break;
    var p = pendientes[i];
    var nombre = HON_nombrePdf_(p);
    try {
      var destino = carpeta(p);
      var existe = destino.getFilesByName(nombre);
      var archivo = existe.hasNext() ? existe.next() : null;
      if (!archivo) {
        var blob = HON_leerBlob_(cfg, p.ruta, nombre);
        if (!blob) continue;
        archivo = destino.createFile(blob.setContentType('application/pdf'));
      }
      nuevos.push([p.ruta, archivo.getId(), new Date(), nombre]);
      hechos++;
    } catch (e) {
      console.warn('No se pudo copiar ' + p.ruta + ': ' + e.message);
    }
    if (nuevos.length >= 25) { HON_guardarEnMapa_(nuevos); nuevos = []; }
  }
  HON_guardarEnMapa_(nuevos);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(HON_HOJA.RECIBOS);
  if (h) HON_ponerEnlacesPdf_(h);
  var renombrados = HON_renombrarPdf_(inicio);
  var faltan = pendientes.length - hechos;
  if (faltan > 0 && Date.now() - inicio > HON_LIMITE_MS) HON_programarContinuacion_(); else HON_borrarContinuacion_();
  return { nuevos: hechos, pendientes: Date.now() - inicio > HON_LIMITE_MS ? faltan : 0, renombrados: renombrados };
}

/** Pone el enlace "📄 Ver PDF" en la columna PDF de las filas que ya tienen su PDF en Drive. */
function HON_ponerEnlacesPdf_(hoja) {
  var n = hoja.getLastRow() - 3;
  if (n < 1) return;
  var mapa = HON_mapaArchivos_();
  var rutas = hoja.getRange(4, HON_COL.RUTA, n, 1).getDisplayValues();
  var celdas = rutas.map(function (r) {
    var id = mapa[r[0]];
    var t = SpreadsheetApp.newRichTextValue();
    if (id) t.setText('📄 Ver PDF').setLinkUrl('https://drive.google.com/file/d/' + id + '/view');
    else t.setText(r[0] ? '⏳' : 'sin PDF');
    return [t.build()];
  });
  hoja.getRange(4, HON_COL.PDF, n, 1).setRichTextValues(celdas).setHorizontalAlignment('center');
}
