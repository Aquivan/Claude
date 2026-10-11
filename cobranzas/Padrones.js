/**
 * Padrones.js — Padrones de SUNAT guardados en Cuentas por Cobrar y Pagar.
 *
 * Pestaña oculta "_Padrones SUNAT": una fila por RUC con la fecha desde la que
 * es agente de retención, buen contribuyente, agente de percepción (venta
 * interna) o agente de percepción de combustibles. La usa Retener.js.
 *
 * Se actualiza sola una vez por semana (desde la actualización automática) y
 * con el menú 💼 Cobranzas → 🧾 Actualizar padrones SUNAT:
 *   1. Descarga directa de SUNAT (archivos *_TXT.zip, formato RUC|NOMBRE|DESDE|RESOLUCION).
 *   2. Si SUNAT no responde: copia desde la hoja de respaldo de ⚙️ Config
 *      (ID Sheet de padrones SUNAT, hoy "Agente Retenedor").
 */

var PAD_HOJA_ = '_Padrones SUNAT';
var PAD_ENC_ = ['RUC', 'Agente de retención desde', 'Buen contribuyente desde', 'Agente de percepción desde', 'Percepción combustible desde', 'Razón social'];
var PAD_DIAS_ = 7;
// [clave, columna (1-based), URL SUNAT, pestaña de la hoja de respaldo]
var PAD_FUENTES_ = [
  ['ar', 2, 'https://www.sunat.gob.pe/descarga/AgentRet/AgenRet_TXT.zip', 'Ag_Retencion'],
  ['bc', 3, 'https://www.sunat.gob.pe/descarga/BueCont/BueCont_TXT.zip', 'Buenos_Contribuyentes'],
  ['ap', 4, 'https://www.sunat.gob.pe/descarga/AgentRet/AgenPercVI_TXT.zip', 'Ag_Percepcion'],
  ['apc', 5, 'https://www.sunat.gob.pe/descarga/AgentRet/AgenPerc_TXT.zip', 'Ag_Perc_Combustible'],
];

/** Mapa ruc → {ar, bc, ap, apc (fechas)} solo de los RUC pedidos. */
function PAD_leer_(ss, rucs) {
  var sh = ss.getSheetByName(PAD_HOJA_);
  var info = PropertiesService.getDocumentProperties().getProperty('pad_info') || '';
  var mapa = {};
  if (!sh || sh.getLastRow() < 2) return { mapa: mapa, info: '⚠️ Aún no hay padrones SUNAT: menú 💼 Cobranzas → 🧾 Actualizar padrones SUNAT' };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < v.length; i++) {
    var ruc = String(v[i][0]);
    if (rucs && !rucs[ruc]) continue;
    mapa[ruc] = { ar: aFecha_(v[i][1]), bc: aFecha_(v[i][2]), ap: aFecha_(v[i][3]), apc: aFecha_(v[i][4]), nombre: String(v[i][5] || '') };
  }
  return { mapa: mapa, info: info };
}

/** "dd/mm/aaaa" o Date → Date (o null). */
function PAD_fecha_(v) {
  if (v instanceof Date) return v;
  var m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], 12) : null;
}

/** Descarga un padrón de SUNAT. Devuelve [[ruc, nombre, desde]] o lanza error. */
function PAD_bajarSunat_(url) {
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' } });
  if (r.getResponseCode() !== 200) throw new Error('SUNAT respondió ' + r.getResponseCode());
  var blob = r.getBlob().setContentType('application/zip');
  var archivos = Utilities.unzip(blob);
  if (!archivos.length) throw new Error('zip vacío');
  var txt = archivos[0].getDataAsString('ISO-8859-1');
  var filas = [];
  txt.split(/\r\n|\r|\n/).forEach(function (l) {  // SUNAT separa las líneas solo con CR
    var p = l.split('|');
    var ruc = aRuc_(p[0]);
    if (ruc && ruc.length === 11) filas.push([ruc, String(p[1] || '').replace(/^'|'$/g, '').trim(), PAD_fecha_(p[2])]);
  });
  if (!filas.length) throw new Error('el archivo no trae datos');
  return filas;
}

/** Lee un padrón desde la hoja de respaldo (pestañas con RUC, RAZON_SOCIAL, FECHA_DESDE). */
function PAD_leerRespaldo_(ssR, pestana) {
  var sh = ssR.getSheetByName(pestana);
  if (!sh || sh.getLastRow() < 2) throw new Error('la hoja de respaldo no tiene la pestaña ' + pestana);
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().map(function (r) {
    return [aRuc_(r[0]), String(r[1] || '').trim(), PAD_fecha_(r[2])];
  }).filter(function (r) { return r[0].length === 11; });
}

/** Actualiza la pestaña _Padrones SUNAT. Devuelve un texto con el resultado. */
function PAD_actualizar_(ss, cfg) {
  var porRuc = {}, origen = [], ssR = null;
  PAD_FUENTES_.forEach(function (f) {
    var filas = null, de = '';
    try { filas = PAD_bajarSunat_(f[2]); de = 'SUNAT'; } catch (e) {
      try {
        if (!cfg.idPadrones) throw new Error('sin hoja de respaldo');
        ssR = ssR || SpreadsheetApp.openById(cfg.idPadrones);
        filas = PAD_leerRespaldo_(ssR, f[3]); de = 'hoja de respaldo';
      } catch (e2) { origen.push(f[3] + ': ❌ ' + e.message + ' / ' + e2.message); return; }
    }
    filas.forEach(function (r) {
      var x = porRuc[r[0]] = porRuc[r[0]] || [r[0], '', '', '', '', ''];
      x[f[1] - 1] = r[2] || new Date(2002, 5, 1);
      if (!x[5] && r[1]) x[5] = r[1];
    });
    origen.push(f[3].replace(/_/g, ' ') + ': ' + filas.length + ' (' + de + ')');
  });
  var filas = Object.keys(porRuc).map(function (k) { return porRuc[k]; });
  if (!filas.length) return '❌ No se pudo leer ningún padrón: ' + origen.join(' · ');
  var sh = ss.getSheetByName(PAD_HOJA_);
  if (!sh) { sh = ss.insertSheet(PAD_HOJA_); sh.hideSheet(); }
  sh.clear();
  sh.getRange(1, 1, 1, PAD_ENC_.length).setValues([PAD_ENC_]).setFontWeight('bold');
  sh.getRange(2, 1, filas.length, 1).setNumberFormat('@');
  sh.getRange(2, 1, filas.length, PAD_ENC_.length).setValues(filas);
  sh.getRange(2, 2, filas.length, 4).setNumberFormat('dd/mm/yyyy');
  var info = 'Padrones SUNAT al ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy') + ' · ' + origen.join(' · ');
  var props = PropertiesService.getDocumentProperties();
  props.setProperty('pad_info', info);
  props.setProperty('pad_fecha', String(Date.now()));
  return info;
}

/** Desde la actualización automática: como mucho una vez cada PAD_DIAS_ días. */
function PAD_actualizarSiToca_(ss) {
  var props = PropertiesService.getDocumentProperties();
  var ult = Number(props.getProperty('pad_fecha') || 0);
  if (Date.now() - ult < PAD_DIAS_ * 86400000) return '';
  props.setProperty('pad_fecha', String(Date.now()));  // aunque falle, no reintentar en cada vuelta
  return PAD_actualizar_(ss, leerConfig_(ss));
}

function menuActualizarPadrones() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Descargando padrones de SUNAT (agentes de retención, buenos contribuyentes, percepción)…', '🧾 Padrones', 120);
  var msg;
  try { msg = PAD_actualizar_(ss, leerConfig_(ss)); } catch (e) { msg = '❌ ' + e.message; }
  ss.toast(msg, '🧾 Padrones', 15);
  if (msg.indexOf('❌') !== 0) ss.toast(actualizarTodo_(true), '💼 Cobranzas', 10);
}
