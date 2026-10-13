/**
 * Diario.js — descarga diaria PUNTUAL (patron recomendado por GitHub para cron).
 *
 * El programador de GitHub (cron) se atrasa horas o se salta dias. Por eso el
 * disparador diario de esta hoja (el que ya existia, misma funcion) ahora:
 *   1) Pregunta a GitHub si la descarga de hoy ya corrio.
 *   2) Si no, la PIDE en ese momento (workflow_dispatch: arranca en segundos).
 *   3) Revisa cada 8 minutos y, cuando GitHub termina, importa a la hoja.
 * El cron de GitHub queda solo de respaldo y no repite lo que ya corrio
 * (ambas corridas se llaman "Honorarios · diario").
 */

var HON_WORKFLOW_DIARIO_ = 'honorarios-descargar.yml';
var HON_TITULO_DIARIO_ = 'Honorarios · diario';
var HON_MAX_REVISIONES_ = 12;  // 12 x 8 min = hasta ~1.5 horas esperando a GitHub

/** Disparador diario (mismo nombre de siempre: los activadores ya instalados siguen funcionando). */
function HON_actualizacionAutomatica() {
  var estado = 'nada';
  try {
    var cfg = HON_leerConfig_();
    estado = HON_estadoDiario_(cfg);
    if (estado === 'nada') {
      HON_pedirDiario_(cfg);
      estado = 'corriendo';
    }
  } catch (e) {
    console.warn('Descarga diaria: no se pudo consultar/pedir a GitHub (' + e.message + '). Se importa lo que haya.');
    estado = 'listo';
  }
  if (estado === 'corriendo') {
    PropertiesService.getScriptProperties().setProperty('HON_revisiones', '0');
    HON_programarRevision_();
    return;
  }
  HON_importarAhora_();
}

/** Revision cada 8 min hasta que GitHub termine; entonces importa. */
function HON_importarTrasDescarga() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'HON_importarTrasDescarga') ScriptApp.deleteTrigger(t);
  });
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('HON_revisiones') || '0', 10) + 1;
  props.setProperty('HON_revisiones', String(n));
  var estado = 'listo';
  try { estado = HON_estadoDiario_(HON_leerConfig_()); } catch (e) { console.warn(e.message); }
  if ((estado === 'corriendo' || estado === 'nada') && n < HON_MAX_REVISIONES_) {
    HON_programarRevision_();
    return;
  }
  HON_importarAhora_();
}

function HON_programarRevision_() {
  ScriptApp.newTrigger('HON_importarTrasDescarga').timeBased().after(8 * 60 * 1000).create();
}

/** 'listo' (ya corrio bien), 'corriendo' (en curso o en cola) o 'nada' (todavia no corre). */
function HON_estadoDiario_(cfg) {
  var p = HON_api_(cfg, '/actions/workflows/' + HON_WORKFLOW_DIARIO_ + '/runs?per_page=30');
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 200) throw new Error('GitHub respondio HTTP ' + r.getResponseCode());
  var desde = HON_inicioVentana_();
  var estado = 'nada';
  (JSON.parse(r.getContentText()).workflow_runs || []).forEach(function (run) {
    if (run.display_title !== HON_TITULO_DIARIO_ || new Date(run.created_at).getTime() < desde) return;
    if (run.status !== 'completed') estado = 'corriendo';
    else if (run.conclusion === 'success' && estado === 'nada') estado = 'listo';
  });
  return estado;
}

/** Desde cuando una corrida diaria cuenta como "la de ahora". */
function HON_inicioVentana_() {
  // Desde las 0:00 de hoy (hora Lima).
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
  return new Date(hoy + 'T05:00:00Z').getTime();
}

function HON_pedirDiario_(cfg) {
  var p = HON_api_(cfg, '/actions/workflows/' + HON_WORKFLOW_DIARIO_ + '/dispatches');
  p.method = 'post';
  p.contentType = 'application/json';
  p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: 'todas', periodo: HON_mesesAtras_(1), hasta: '', pdf: cfg.bajarPdf ? 'true' : 'false', diario: 'true' } });
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 204) throw new Error('GitHub respondio HTTP ' + r.getResponseCode() +
    ' (el token necesita permiso "Actions: Read and write").');
}

function HON_mesesAtras_(n) {
  var hoy = new Date();
  return Utilities.formatDate(new Date(hoy.getFullYear(), hoy.getMonth() - n, 1), 'America/Lima', 'yyyyMM');
}
