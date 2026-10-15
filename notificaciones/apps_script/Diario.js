/**
 * Diario.js — descarga diaria PUNTUAL (patron recomendado por GitHub para cron).
 *
 * El programador de GitHub (cron) se atrasa horas o se salta dias. Por eso el
 * disparador diario de esta hoja (el que ya existia, misma funcion) ahora:
 *   1) Pregunta a GitHub si la descarga de hoy ya corrio.
 *   2) Si no, la PIDE en ese momento (workflow_dispatch: arranca en segundos).
 *   3) Revisa cada 8 minutos y, cuando GitHub termina, importa a la hoja.
 * El cron de GitHub queda solo de respaldo y no repite lo que ya corrio
 * (ambas corridas se llaman "Notificaciones · diario").
 */

var NOT_WORKFLOW_DIARIO_ = 'notificaciones-descargar.yml';
var NOT_TITULO_DIARIO_ = 'Notificaciones · diario';
var NOT_MAX_REVISIONES_ = 12;  // 12 x 8 min = hasta ~1.5 horas esperando a GitHub

/** Disparador diario (mismo nombre de siempre: los activadores ya instalados siguen funcionando). */
function NOT_actualizacionAutomatica() {
  var estado = 'nada';
  try {
    var cfg = NOT_leerConfig_();
    estado = NOT_estadoDiario_(cfg);
    if (estado === 'nada') {
      NOT_pedirDiario_(cfg);
      estado = 'corriendo';
    }
  } catch (e) {
    console.warn('Descarga diaria: no se pudo consultar/pedir a GitHub (' + e.message + '). Se importa lo que haya.');
    estado = 'listo';
  }
  if (estado === 'corriendo') {
    PropertiesService.getScriptProperties().setProperty('NOT_revisiones', '0');
    NOT_programarRevision_();
    return;
  }
  NOT_importarAhora_();
}

/** Revision cada 8 min hasta que GitHub termine; entonces importa. */
function NOT_importarTrasDescarga() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'NOT_importarTrasDescarga') ScriptApp.deleteTrigger(t);
  });
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('NOT_revisiones') || '0', 10) + 1;
  props.setProperty('NOT_revisiones', String(n));
  var estado = 'listo';
  try { estado = NOT_estadoDiario_(NOT_leerConfig_()); } catch (e) { console.warn(e.message); }
  if ((estado === 'corriendo' || estado === 'nada') && n < NOT_MAX_REVISIONES_) {
    NOT_programarRevision_();
    return;
  }
  NOT_importarAhora_();
}

function NOT_programarRevision_() {
  ScriptApp.newTrigger('NOT_importarTrasDescarga').timeBased().after(8 * 60 * 1000).create();
}

/** 'listo' (ya corrio bien), 'corriendo' (en curso o en cola) o 'nada' (todavia no corre). */
function NOT_estadoDiario_(cfg) {
  var p = NOT_api_(cfg, '/actions/workflows/' + NOT_WORKFLOW_DIARIO_ + '/runs?per_page=30');
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 200) throw new Error('GitHub respondio HTTP ' + r.getResponseCode());
  var desde = NOT_inicioVentana_();
  var estado = 'nada';
  (JSON.parse(r.getContentText()).workflow_runs || []).forEach(function (run) {
    if (run.display_title !== NOT_TITULO_DIARIO_ || new Date(run.created_at).getTime() < desde) return;
    if (run.status !== 'completed') estado = 'corriendo';
    else if (run.conclusion === 'success' && estado === 'nada' && NOT_descargoDeVerdad_(cfg, run.id)) estado = 'listo';
  });
  return estado;
}

/** true si la corrida descargó de verdad (sus trabajos "descargar" no se saltaron por haber otra reciente). */
function NOT_descargoDeVerdad_(cfg, runId) {
  try {
    var p = NOT_api_(cfg, '/actions/runs/' + runId + '/jobs?per_page=100');
    var r = UrlFetchApp.fetch(p.url, p);
    if (r.getResponseCode() !== 200) return true;
    return (JSON.parse(r.getContentText()).jobs || []).some(function (j) {
      return /^descargar/.test(j.name) && j.conclusion === 'success';
    });
  } catch (e) { return true; }
}

/** Desde cuando una corrida diaria cuenta como "la de ahora". */
function NOT_inicioVentana_() {
  // Las ultimas 5 horas (esta hoja descarga dos veces al dia).
  return Date.now() - 5 * 3600 * 1000;
}

function NOT_pedirDiario_(cfg) {
  var p = NOT_api_(cfg, '/actions/workflows/' + NOT_WORKFLOW_DIARIO_ + '/dispatches');
  p.method = 'post';
  p.contentType = 'application/json';
  p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: 'todas', desde: NOT_mesesAtras_(2), pdf: cfg.bajarPdf ? 'true' : 'false', diario: 'true' } });
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 204) throw new Error('GitHub respondio HTTP ' + r.getResponseCode() +
    ' (el token necesita permiso "Actions: Read and write").');
}

function NOT_mesesAtras_(n) {
  var hoy = new Date();
  return Utilities.formatDate(new Date(hoy.getFullYear(), hoy.getMonth() - n, 1), 'America/Lima', 'yyyyMM');
}
