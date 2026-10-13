/**
 * Diario.js — descarga diaria PUNTUAL (patron recomendado por GitHub para cron).
 *
 * El programador de GitHub (cron) se atrasa horas o se salta dias. Por eso el
 * disparador diario de esta hoja (el que ya existia, misma funcion) ahora:
 *   1) Pregunta a GitHub si la descarga de hoy ya corrio.
 *   2) Si no, la PIDE en ese momento (workflow_dispatch: arranca en segundos).
 *   3) Revisa cada 8 minutos y, cuando GitHub termina, importa a la hoja.
 * El cron de GitHub queda solo de respaldo y no repite lo que ya corrio
 * (ambas corridas se llaman "Retenciones · diario").
 */

var RET_WORKFLOW_DIARIO_ = 'retenciones-descargar.yml';
var RET_TITULO_DIARIO_ = 'Retenciones · diario';
var RET_MAX_REVISIONES_ = 12;  // 12 x 8 min = hasta ~1.5 horas esperando a GitHub

/** Disparador diario (mismo nombre de siempre: los activadores ya instalados siguen funcionando). */
function RET_actualizacionAutomatica() {
  var estado = 'nada';
  try {
    var cfg = RET_leerConfig_();
    estado = RET_estadoDiario_(cfg);
    if (estado === 'nada') {
      RET_pedirDiario_(cfg);
      estado = 'corriendo';
    }
  } catch (e) {
    console.warn('Descarga diaria: no se pudo consultar/pedir a GitHub (' + e.message + '). Se importa lo que haya.');
    estado = 'listo';
  }
  if (estado === 'corriendo') {
    PropertiesService.getScriptProperties().setProperty('RET_revisiones', '0');
    RET_programarRevision_();
    return;
  }
  RET_importarAhora_();
}

/** Revision cada 8 min hasta que GitHub termine; entonces importa. */
function RET_importarTrasDescarga() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'RET_importarTrasDescarga') ScriptApp.deleteTrigger(t);
  });
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('RET_revisiones') || '0', 10) + 1;
  props.setProperty('RET_revisiones', String(n));
  var estado = 'listo';
  try { estado = RET_estadoDiario_(RET_leerConfig_()); } catch (e) { console.warn(e.message); }
  if ((estado === 'corriendo' || estado === 'nada') && n < RET_MAX_REVISIONES_) {
    RET_programarRevision_();
    return;
  }
  RET_importarAhora_();
}

function RET_programarRevision_() {
  ScriptApp.newTrigger('RET_importarTrasDescarga').timeBased().after(8 * 60 * 1000).create();
}

/** 'listo' (ya corrio bien), 'corriendo' (en curso o en cola) o 'nada' (todavia no corre). */
function RET_estadoDiario_(cfg) {
  var p = RET_api_(cfg, '/actions/workflows/' + RET_WORKFLOW_DIARIO_ + '/runs?per_page=30');
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 200) throw new Error('GitHub respondio HTTP ' + r.getResponseCode());
  var desde = RET_inicioVentana_();
  var estado = 'nada';
  (JSON.parse(r.getContentText()).workflow_runs || []).forEach(function (run) {
    if (run.display_title !== RET_TITULO_DIARIO_ || new Date(run.created_at).getTime() < desde) return;
    if (run.status !== 'completed') estado = 'corriendo';
    else if (run.conclusion === 'success' && estado === 'nada') estado = 'listo';
  });
  return estado;
}

/** Desde cuando una corrida diaria cuenta como "la de ahora". */
function RET_inicioVentana_() {
  // Desde las 0:00 de hoy (hora Lima).
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
  return new Date(hoy + 'T05:00:00Z').getTime();
}

function RET_pedirDiario_(cfg) {
  var p = RET_api_(cfg, '/actions/workflows/' + RET_WORKFLOW_DIARIO_ + '/dispatches');
  p.method = 'post';
  p.contentType = 'application/json';
  p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: 'todas', periodo: RET_mesesAtras_(1), hasta: '', diario: 'true' } });
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 204) throw new Error('GitHub respondio HTTP ' + r.getResponseCode() +
    ' (el token necesita permiso "Actions: Read and write").');
}

function RET_mesesAtras_(n) {
  var hoy = new Date();
  return Utilities.formatDate(new Date(hoy.getFullYear(), hoy.getMonth() - n, 1), 'America/Lima', 'yyyyMM');
}
