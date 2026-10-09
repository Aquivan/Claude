/**
 * Retenciones · Grupo — Drive.js
 * Copia los PDF oficiales a Drive, ordenados igual que SIRE:
 *   <carpeta de esta hoja>/PDF Retenciones/<RUC - Empresa>/<Emitidas|Recibidas>/<AAAA>/<NN_Mes>/
 *     E001-198 - NOMBRE DEL PROVEEDOR.pdf
 * La pestaña oculta "_Archivos" recuerda qué PDF ya se copió (no se duplica).
 */

var RET_LIMITE_MS = 4.5 * 60 * 1000;  // Apps Script corta a los 6 minutos
var RET_COL = { EMPRESA: 1, RUC: 2, PERIODO: 3, COMPROBANTE: 5, CONTRAPARTE: 7, PDF: 14, RUTA: 16 };

function RET_mapaArchivos_() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RET_HOJA.ARCHIVOS);
  var mapa = {};
  if (!hoja || hoja.getLastRow() < 2) return mapa;
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach(function (f) {
    if (f[0] && f[1]) mapa[f[0]] = f[1];
  });
  return mapa;
}

function RET_guardarEnMapa_(nuevos) {
  if (!nuevos.length) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(RET_HOJA.ARCHIVOS);
  if (!hoja) {
    hoja = ss.insertSheet(RET_HOJA.ARCHIVOS);
    hoja.getRange(1, 1, 1, 3).setValues([['Ruta en GitHub', 'Id en Drive', 'Copiado']]).setFontWeight('bold');
    hoja.hideSheet();
  }
  hoja.getRange(hoja.getLastRow() + 1, 1, nuevos.length, 3).setValues(nuevos);
}

function RET_subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) return f;
  }
  return padre.createFolder(nombre);
}

function RET_carpetaPdf_(cfg) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var padres = DriveApp.getFileById(ss.getId()).getParents();
  var base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  return RET_subcarpeta_(base, cfg.carpetaPdf || 'PDF Retenciones');
}

function RET_limpiarNombre_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}

/** Lee de las pestañas Emitidas y Recibidas los PDF que faltan copiar. */
function RET_pendientesPdf_(mapa) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = [];
  [[RET_HOJA.EMITIDAS, 'Emitidas'], [RET_HOJA.RECIBIDAS, 'Recibidas']].forEach(function (par) {
    var hoja = ss.getSheetByName(par[0]);
    if (!hoja || hoja.getLastRow() < 4) return;
    hoja.getRange(4, 1, hoja.getLastRow() - 3, RET_COL.RUTA).getDisplayValues().forEach(function (f) {
      var ruta = f[RET_COL.RUTA - 1];
      if (ruta && !mapa[ruta]) {
        res.push({ ruta: ruta, tipo: par[1], empresa: f[RET_COL.EMPRESA - 1], ruc: f[RET_COL.RUC - 1],
          periodo: f[RET_COL.PERIODO - 1], comprobante: f[RET_COL.COMPROBANTE - 1], contraparte: f[RET_COL.CONTRAPARTE - 1] });
      }
    });
  });
  return res;
}

/** Copia los PDF que falten. Devuelve {nuevos, pendientes}. */
function RET_ordenarPdf_() {
  var inicio = Date.now();
  var cfg = RET_leerConfig_();
  var mapa = RET_mapaArchivos_();
  var pendientes = RET_pendientesPdf_(mapa);
  if (!pendientes.length) { RET_borrarContinuacion_(); return { nuevos: 0, pendientes: 0 }; }

  var raiz = RET_carpetaPdf_(cfg);
  var cache = {};
  var carpeta = function (p) {
    var anio = p.periodo.slice(0, 4), mes = +p.periodo.slice(5, 7);
    var clave = p.ruc + '|' + p.tipo + '|' + anio + '|' + mes;
    if (!cache[clave]) {
      var emp = RET_subcarpeta_(raiz, RET_limpiarNombre_(p.ruc + ' - ' + p.empresa));
      cache[clave] = RET_subcarpeta_(RET_subcarpeta_(RET_subcarpeta_(emp, p.tipo), anio), RET_MESES_CARPETA[mes - 1]);
    }
    return cache[clave];
  };

  var nuevos = [], hechos = 0;
  for (var i = 0; i < pendientes.length; i++) {
    if (Date.now() - inicio > RET_LIMITE_MS) break;
    var p = pendientes[i];
    var nombre = RET_limpiarNombre_(p.comprobante + (p.contraparte ? ' - ' + p.contraparte : '')) + '.pdf';
    try {
      var destino = carpeta(p);
      var existe = destino.getFilesByName(nombre);
      var archivo = existe.hasNext() ? existe.next() : null;
      if (!archivo) {
        var blob = RET_leerBlob_(cfg, p.ruta, nombre);
        if (!blob) continue;
        archivo = destino.createFile(blob.setContentType('application/pdf'));
      }
      nuevos.push([p.ruta, archivo.getId(), new Date()]);
      hechos++;
    } catch (e) {
      console.warn('No se pudo copiar ' + p.ruta + ': ' + e.message);
    }
    if (nuevos.length >= 25) { RET_guardarEnMapa_(nuevos); nuevos = []; }
  }
  RET_guardarEnMapa_(nuevos);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [RET_HOJA.EMITIDAS, RET_HOJA.RECIBIDAS].forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (h) RET_ponerEnlacesPdf_(h);
  });
  var faltan = pendientes.length - hechos;
  if (faltan > 0 && Date.now() - inicio > RET_LIMITE_MS) RET_programarContinuacion_(); else RET_borrarContinuacion_();
  return { nuevos: hechos, pendientes: Date.now() - inicio > RET_LIMITE_MS ? faltan : 0 };
}

/** Pone el enlace "📄 Ver PDF" en la columna PDF de las filas que ya tienen su PDF en Drive. */
function RET_ponerEnlacesPdf_(hoja) {
  var n = hoja.getLastRow() - 3;
  if (n < 1) return;
  var mapa = RET_mapaArchivos_();
  var rutas = hoja.getRange(4, RET_COL.RUTA, n, 1).getDisplayValues();
  var celdas = rutas.map(function (r) {
    var id = mapa[r[0]];
    var t = SpreadsheetApp.newRichTextValue();
    if (id) t.setText('📄 Ver PDF').setLinkUrl('https://drive.google.com/file/d/' + id + '/view');
    else t.setText(r[0] ? '⏳' : '—');
    return [t.build()];
  });
  hoja.getRange(4, RET_COL.PDF, n, 1).setRichTextValues(celdas).setHorizontalAlignment('center');
}
