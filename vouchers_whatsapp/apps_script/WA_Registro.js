// ============================================================
// 🩺 REGISTRO TÉCNICO (para diagnosticar sin capturas de pantalla)
// ------------------------------------------------------------
// Cada vez que la hoja procesa archivos anota DOS filas en la hoja
// «🩺 Registro técnico (sistema)» (se crea sola en Drive, una sola vez):
//   · «inicio» con cuántos archivos hay en Entrada, y
//   · «fin» con lo procesado, el tiempo, quién leyó y el detalle del registro.
// Si hay un «inicio» sin su «fin», Google cortó esa ejecución (6 min).
// Lo nuevo va ARRIBA; se guardan las últimas 400 filas. No guarda claves.
// Copia de vouchers_bot_cambios/src/Registro.js: la MISMA hoja (mismo nombre) para Vouchers y WhatsApp.
// ============================================================

var REG_NOMBRE_ = '🩺 Registro técnico (sistema)';

function REG_hoja_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('REG_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    const it = DriveApp.getFilesByName(REG_NOMBRE_);
    ss = it.hasNext() ? SpreadsheetApp.open(it.next()) : SpreadsheetApp.create(REG_NOMBRE_);
    props.setProperty('REG_ID', ss.getId());
  }
  const sh = ss.getSheets()[0];
  if (sh.getLastRow() === 0) { sh.appendRow(['Fecha', 'Sistema', 'Evento', 'Segundos', 'Detalle']); sh.setFrozenRows(1); }
  return sh;
}

function REG_anotar_(sistema, evento, segundos, detalle) {
  try {
    const sh = REG_hoja_();
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 5).setValues([["'" + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm:ss'), sistema, evento, segundos === '' ? '' : Number(segundos) || 0, String(detalle || '').slice(0, 3000)]]);
    if (sh.getLastRow() > 401) sh.deleteRows(402, sh.getLastRow() - 401);
  } catch (e) { Logger.log('Registro técnico: ' + e.message); }
}
