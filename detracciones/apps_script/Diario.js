/**
 * Diario.js — descarga diaria PUNTUAL (patron recomendado por GitHub para cron).
 *
 * El programador de GitHub (cron) se atrasa horas o se salta dias. Por eso el
 * disparador diario de esta hoja (el que ya existia, misma funcion) ahora:
 *   1) Pregunta a GitHub si la descarga de hoy ya corrio.
 *   2) Si no, la PIDE en ese momento (workflow_dispatch: arranca en segundos).
 *   3) Revisa cada 8 minutos y, cuando GitHub termina, importa a la hoja.
 * El cron de GitHub queda solo de respaldo y no repite lo que ya corrio
 * (ambas corridas se llaman "Detracciones · diario").
 * Solo de LUNES A VIERNES (sábado y domingo no se pide nada; a mano sí se puede).
 */

var DET_WORKFLOW_DIARIO_ = 'detracciones-descargar.yml';
var DET_TITULO_DIARIO_ = 'Detracciones · diario';
var DET_MAX_REVISIONES_ = 12;  // 12 x 8 min = hasta ~1.5 horas esperando a GitHub

/** Disparador diario (mismo nombre de siempre: los activadores ya instalados siguen funcionando). */
function DET_actualizacionAutomatica() {
  // La descarga automática es solo de lunes a viernes (sábado y domingo solo se importa lo que haya).
  var dia = Number(Utilities.formatDate(new Date(), 'America/Lima', 'u'));   // 1 = lunes … 7 = domingo
  if (dia > 5) { DET_importarAhora_(); return; }
  var estado = 'nada';
  try {
    var cfg = DET_leerConfig_();
    estado = DET_estadoDiario_(cfg);
    if (estado === 'nada') {
      DET_pedirDiario_(cfg);
      estado = 'corriendo';
    }
  } catch (e) {
    console.warn('Descarga diaria: no se pudo consultar/pedir a GitHub (' + e.message + '). Se importa lo que haya.');
    estado = 'listo';
  }
  if (estado === 'corriendo') {
    PropertiesService.getScriptProperties().setProperty('DET_revisiones', '0');
    DET_programarRevision_();
    return;
  }
  DET_importarAhora_();
  DET_revisarFallas_();
}

/** Revision cada 8 min hasta que GitHub termine; entonces importa. */
function DET_importarTrasDescarga() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'DET_importarTrasDescarga') ScriptApp.deleteTrigger(t);
  });
  var props = PropertiesService.getScriptProperties();
  var n = parseInt(props.getProperty('DET_revisiones') || '0', 10) + 1;
  props.setProperty('DET_revisiones', String(n));
  var estado = 'listo';
  try { estado = DET_estadoDiario_(DET_leerConfig_()); } catch (e) { console.warn(e.message); }
  if ((estado === 'corriendo' || estado === 'nada') && n < DET_MAX_REVISIONES_) {
    DET_programarRevision_();
    return;
  }
  DET_importarAhora_();
  DET_revisarFallas_();
}

/* ------------------------------------------------------------ 🔁 reintento de las empresas que fallaron */

var DET_MAX_REINTENTOS_ = 1;   // por día: un solo reintento

/**
 * Después de la descarga diaria: las empresas que no terminaron bien (SUNAT lenta, sin respuesta, o SUNAT devolvió
 * vacío un mes que tenía depósitos) se vuelven a pedir en 1 hora, solo ellas. Un solo reintento por día.
 */
function DET_revisarFallas_() {
  try {
    var cfg = DET_leerConfig_(), res = DET_resultados_(), desde = DET_inicioVentana_();
    var fallaron = DET_listarEmpresas_(cfg).filter(function (e) { return e.activo; }).map(function (e) { return e.ruc; })
      .filter(function (ruc) { var x = res[ruc]; return !(x && x.t >= desde && x.ok); });
    var props = PropertiesService.getScriptProperties(), hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd');
    var r = {}; try { r = JSON.parse(props.getProperty('DET_REINT') || '{}'); } catch (e) {}
    if (r.d !== hoy) r = { d: hoy, n: 0 };
    if (!fallaron.length || r.n >= DET_MAX_REINTENTOS_) return;
    r.rucs = fallaron;
    props.setProperty('DET_REINT', JSON.stringify(r));
    ScriptApp.getProjectTriggers().forEach(function (x) { if (x.getHandlerFunction() === 'DET_reintentar') ScriptApp.deleteTrigger(x); });
    ScriptApp.newTrigger('DET_reintentar').timeBased().after(60 * 60 * 1000).create();
    console.log('Detracciones: ' + fallaron.length + ' empresa(s) con error; se reintentan en 1 hora.');
  } catch (e) { console.warn('Detracciones (revisar fallas): ' + e.message); }
}

function DET_reintentar() {
  ScriptApp.getProjectTriggers().forEach(function (x) { if (x.getHandlerFunction() === 'DET_reintentar') ScriptApp.deleteTrigger(x); });
  var props = PropertiesService.getScriptProperties(), r = {};
  try { r = JSON.parse(props.getProperty('DET_REINT') || '{}'); } catch (e) {}
  if (!r.rucs || !r.rucs.length) return;
  r.n = (r.n || 0) + 1;
  props.setProperty('DET_REINT', JSON.stringify(r));
  DET_despachar_(DET_leerConfig_(), r.rucs.join(','), '', '');
  ScriptApp.newTrigger('DET_trasReintento').timeBased().after(25 * 60 * 1000).create();
}

/** 25 min después del reintento: rehace las pestañas (si sigue fallando, ya no se vuelve a pedir ese día). */
function DET_trasReintento() {
  ScriptApp.getProjectTriggers().forEach(function (x) { if (x.getHandlerFunction() === 'DET_trasReintento') ScriptApp.deleteTrigger(x); });
  try { DET_importarAhora_(); } catch (e) { console.warn(e.message); }
  DET_revisarFallas_();
}

function DET_programarRevision_() {
  ScriptApp.newTrigger('DET_importarTrasDescarga').timeBased().after(8 * 60 * 1000).create();
}

/** 'listo' (ya corrio bien), 'corriendo' (en curso o en cola) o 'nada' (todavia no corre). */
function DET_estadoDiario_(cfg) {
  var p = DET_api_(cfg, '/actions/workflows/' + DET_WORKFLOW_DIARIO_ + '/runs?per_page=30');
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 200) throw new Error('GitHub respondio HTTP ' + r.getResponseCode());
  var desde = DET_inicioVentana_();
  var estado = 'nada';
  (JSON.parse(r.getContentText()).workflow_runs || []).forEach(function (run) {
    if (run.display_title !== DET_TITULO_DIARIO_ || new Date(run.created_at).getTime() < desde) return;
    if (run.status !== 'completed') estado = 'corriendo';
    // también una que terminó con error cuenta como hecha: el único reintento lo pide DET_revisarFallas_ (solo las empresas que fallaron)
    else if ((run.conclusion === 'success' || run.conclusion === 'failure') && estado === 'nada' && DET_descargoDeVerdad_(cfg, run.id)) estado = 'listo';
  });
  return estado;
}

/** true si la corrida descargó de verdad (sus trabajos "descargar" no se saltaron por haber otra reciente). */
function DET_descargoDeVerdad_(cfg, runId) {
  try {
    var p = DET_api_(cfg, '/actions/runs/' + runId + '/jobs?per_page=100');
    var r = UrlFetchApp.fetch(p.url, p);
    if (r.getResponseCode() !== 200) return true;
    return (JSON.parse(r.getContentText()).jobs || []).some(function (j) {
      return /^descargar/.test(j.name) && (j.conclusion === 'success' || j.conclusion === 'failure');
    });
  } catch (e) { return true; }
}

/** Desde cuando una corrida diaria cuenta como "la de ahora". */
function DET_inicioVentana_() {
  // Las ultimas 10 horas (esta hoja descarga una vez al dia).
  return Date.now() - 10 * 3600 * 1000;
}

function DET_pedirDiario_(cfg) {
  var p = DET_api_(cfg, '/actions/workflows/' + DET_WORKFLOW_DIARIO_ + '/dispatches');
  p.method = 'post';
  p.contentType = 'application/json';
  var w = DET_nuevaLlave_();   // el robot manda lo bajado a esta hoja con esta llave (Web.js)
  p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: 'todas', desde: '', diario: 'true', constancias: cfg.bajarConstancias ? 'true' : 'false', destino: w.destino, llave: w.llave } });
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 204) throw new Error('GitHub respondio HTTP ' + r.getResponseCode() +
    ' (el token necesita permiso "Actions: Read and write").');
}

function DET_mesesAtras_(n) {
  var hoy = new Date();
  return Utilities.formatDate(new Date(hoy.getFullYear(), hoy.getMonth() - n, 1), 'America/Lima', 'yyyyMM');
}
