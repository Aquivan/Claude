/**
 * 🩺 Registro técnico — Retenciones. Cada proceso automático anota su «inicio» y su «fin» (segundos, ok o el error).
 * Un «inicio» sin su «fin» = Google cortó esa ejecución (6 min). Lo nuevo va arriba; se guardan las últimas 1000 filas.
 * Lo lee el asistente (conector de Drive) para diagnosticar sin capturas. Nunca guarda claves ni datos de clientes.
 * Modo propia: «central» = hoja «🩺 Registro técnico (sistema)» en Drive (la misma de Vouchers y WhatsApp);
 * «propia» = pestaña «🩺 Registro» de esta misma hoja (este proyecto solo tiene permiso sobre su hoja: no se agregan permisos).
 * GENERADO por scripts/registro_tecnico.py: no editar aquí.
 */
var REG_SISTEMA_ = 'Retenciones';
var REG_MODO_ = 'propia';
var REG_NOMBRE_ = '🩺 Registro técnico (sistema)';

function REG_hoja_() {
  if (REG_MODO_ === 'propia') {
    var ssp = SpreadsheetApp.getActiveSpreadsheet(), shp = ssp.getSheetByName('🩺 Registro');
    if (!shp) { shp = ssp.insertSheet('🩺 Registro'); shp.appendRow(['Fecha', 'Sistema', 'Evento', 'Segundos', 'Detalle']); shp.setFrozenRows(1); try { shp.hideSheet(); } catch (e) {} }
    return shp;
  }
  var props = PropertiesService.getScriptProperties(), ss = null, id = props.getProperty('REG_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    var it = DriveApp.getFilesByName(REG_NOMBRE_);
    ss = it.hasNext() ? SpreadsheetApp.open(it.next()) : SpreadsheetApp.create(REG_NOMBRE_);
    props.setProperty('REG_ID', ss.getId());
  }
  var sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) { sh.appendRow(['Fecha', 'Sistema', 'Evento', 'Segundos', 'Detalle']); sh.setFrozenRows(1); }
  return sh;
}

function REG_anotar_(sistema, evento, segundos, detalle) {
  try {
    var sh = REG_hoja_();
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 5).setValues([["'" + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm:ss'), sistema || REG_SISTEMA_, evento, segundos === '' ? '' : Number(segundos) || 0, String(detalle || '').slice(0, 3000)]]);
    if (sh.getLastRow() > 1001) sh.deleteRows(1002, sh.getLastRow() - 1001);
  } catch (e) { try { console.warn('Registro técnico: ' + e.message); } catch (e2) {} }
}

/* ------------------------------------------------ 🧹 disparadores de una vez (…timeBased().after(…)) */
// Los procesos que se programan «de una vez» (continuar en 1 min, después de una descarga…). Al ejecutarse, cada uno
// borra EXACTAMENTE el disparador que lo despertó (e.triggerUid): si Google no lo borra solo, quedaría en la lista,
// el código que pregunta «¿ya hay uno programado?» creería que sí y el proceso no volvería a programarse (pasó en
// Vouchers: un PDF largo esperaba la vuelta de 10 min en vez de seguir al minuto). Si Google ya lo borró, no pasa nada.
// Ninguno de estos procesos tiene además un disparador que se repite (lo revisa scripts/registro_tecnico.py).
var REG_UNA_VEZ_ = ["RET_continuarPdf", "RET_importarTrasDescarga"];

function REG_disparadorUsado_(e) {
  try {
    if (!e || !e.triggerUid) return;
    var uid = String(e.triggerUid);
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getUniqueId() === uid && REG_UNA_VEZ_.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
    });
  } catch (x) { try { console.warn('Disparador usado: ' + x.message); } catch (x2) {} }
}

/** Una vez al día: cuántos disparadores tiene este proyecto (Google permite 20). ⚠️ si se acumulan. */
function REG_revisarDisparadores_() {
  var props = PropertiesService.getScriptProperties(), hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
  if (props.getProperty('REG_DISP_DIA') === hoy) return;
  props.setProperty('REG_DISP_DIA', hoy);
  var cuenta = {}, total = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { var h = t.getHandlerFunction(); cuenta[h] = (cuenta[h] || 0) + 1; total++; });
  var dobles = Object.keys(cuenta).filter(function (h) { return REG_UNA_VEZ_.indexOf(h) >= 0 && cuenta[h] > 1; });
  var alerta = total >= 15 || dobles.length;
  REG_anotar_(REG_SISTEMA_, 'disparadores', total, (alerta ? '⚠️ ' : '') + total + ' de 20 permitidos' +
    (dobles.length ? ' · repetidos (de una vez): ' + dobles.map(function (h) { return h + ' ×' + cuenta[h]; }).join(', ') : '') +
    ' · ' + Object.keys(cuenta).map(function (h) { return h + (cuenta[h] > 1 ? ' ×' + cuenta[h] : ''); }).join(', '));
}

/** Ejecuta fn anotando inicio/fin. opc.inicio: anotar también el inicio · opc.soloLento: s — si terminó bien y más rápido, no se anota. */
function REG_envolver_(nombre, fn, args, opc) {
  opc = opc || {};
  var t0 = Date.now();
  if (REG_UNA_VEZ_.indexOf(nombre) >= 0) REG_disparadorUsado_(args && args[0]);
  try { REG_revisarDisparadores_(); } catch (x) {}
  if (opc.inicio) REG_anotar_(REG_SISTEMA_, nombre + ' · inicio', '', '');
  try {
    var r = fn.apply(null, args || []);
    var seg = Math.round((Date.now() - t0) / 100) / 10;
    if (!opc.soloLento || seg >= opc.soloLento) REG_anotar_(REG_SISTEMA_, nombre + ' · fin', seg, 'ok');
    return r;
  } catch (e) {
    REG_anotar_(REG_SISTEMA_, nombre + ' · ERROR', Math.round((Date.now() - t0) / 100) / 10, String(e && (e.stack || e.message) || e).slice(0, 1500));
    throw e;
  }
}

/* ------------------------------------------------ procesos automáticos envueltos */

function RET_actualizacionAutomatica() { return REG_envolver_('RET_actualizacionAutomatica', RET_actualizacionAutomatica__reg, arguments, { inicio: true }); }
function RET_importarTrasDescarga() { return REG_envolver_('RET_importarTrasDescarga', RET_importarTrasDescarga__reg, arguments, { inicio: true }); }
function RET_continuarPdf() { return REG_envolver_('RET_continuarPdf', RET_continuarPdf__reg, arguments, { inicio: true }); }
