/**
 * 🩺 Registro técnico — Detracciones. Cada proceso automático anota su «inicio» y su «fin» (segundos, ok o el error).
 * Un «inicio» sin su «fin» = Google cortó esa ejecución (6 min). Lo nuevo va arriba; se guardan las últimas 1000 filas.
 * Lo lee el asistente (conector de Drive) para diagnosticar sin capturas. Nunca guarda claves ni datos de clientes.
 * Modo propia: «central» = hoja «🩺 Registro técnico (sistema)» en Drive (la misma de Vouchers y WhatsApp);
 * «propia» = pestaña «🩺 Registro» de esta misma hoja (este proyecto solo tiene permiso sobre su hoja: no se agregan permisos).
 * GENERADO por scripts/registro_tecnico.py: no editar aquí.
 */
var REG_SISTEMA_ = 'Detracciones';
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
    sh.getRange(2, 1, 1, 5).setValues([[new Date(), sistema || REG_SISTEMA_, evento, segundos === '' ? '' : Number(segundos) || 0, String(detalle || '').slice(0, 3000)]]);
    if (sh.getLastRow() > 1001) sh.deleteRows(1002, sh.getLastRow() - 1001);
  } catch (e) { try { console.warn('Registro técnico: ' + e.message); } catch (e2) {} }
}

/** Ejecuta fn anotando inicio/fin. opc.inicio: anotar también el inicio · opc.soloLento: s — si terminó bien y más rápido, no se anota. */
function REG_envolver_(nombre, fn, args, opc) {
  opc = opc || {};
  var t0 = Date.now();
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

function DET_actualizacionAutomatica() { return REG_envolver_('DET_actualizacionAutomatica', DET_actualizacionAutomatica__reg, arguments, { inicio: true }); }
function DET_trasDescarga() { return REG_envolver_('DET_trasDescarga', DET_trasDescarga__reg, arguments, { inicio: true }); }
function DET_importarTrasDescarga() { return REG_envolver_('DET_importarTrasDescarga', DET_importarTrasDescarga__reg, arguments, { inicio: true }); }
function DET_continuarConstancias() { return REG_envolver_('DET_continuarConstancias', DET_continuarConstancias__reg, arguments, { inicio: true }); }
function DET_reintentar() { return REG_envolver_('DET_reintentar', DET_reintentar__reg, arguments, {}); }
function DET_trasReintento() { return REG_envolver_('DET_trasReintento', DET_trasReintento__reg, arguments, {}); }
