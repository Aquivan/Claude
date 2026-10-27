/**
 * AsistenteIA.js — el antiguo "🧠 Asistente IA" (pestaña de preguntas y facturas sugeridas) se RETIRÓ.
 * Su nombre ahora lo lleva el menú de la conciliación con IA (ConciliacionIA.js), que ya hace todo lo que
 * hacía este y más: 💬 Chat con la IA, 🔍 Auditor, ▶ Analizar, 📰 Resumen de cobranzas, vouchers procesados…
 *
 * Aquí solo queda:
 *  - IA_pasarDocs_: lo usa la conciliación para escribir la factura en el voucher.
 *  - El retiro: borra los disparadores del asistente anterior (búsqueda automática y al editar) y su pestaña
 *    "🧠 Asistente IA". Corre solo (los mismos disparadores viejos lo llaman, y la actualización de Cobranzas)
 *    o desde el menú 🧠 Asistente IA → 🧹 Quitar el asistente anterior. Las claves de IA guardadas no se tocan.
 */

var IA_HOJA_VIEJA_ = '🧠 Asistente IA';

/** Quita lo del asistente anterior. Devuelve qué hizo (texto). */
function IA_retirar_(ss) {
  var hechos = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (['IA_vueltaAutomatica', 'IA_alEditar'].indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); hechos.push('disparador ' + t.getHandlerFunction()); }
    });
  } catch (e) { Logger.log('Retiro del asistente (disparadores): ' + e.message); }
  ss = ss || SpreadsheetApp.getActiveSpreadsheet() || ssPrincipal_();
  var sh = ss && ss.getSheetByName(IA_HOJA_VIEJA_);
  // Solo la pestaña del asistente anterior (su título dice ASISTENTE IA en A1).
  if (sh && /ASISTENTE IA/i.test(String(sh.getRange('A1').getValue())) && ss.getSheets().length > 1) { ss.deleteSheet(sh); hechos.push('pestaña ' + IA_HOJA_VIEJA_); }
  return hechos.length ? 'Quitado: ' + hechos.join(', ') + '.' : 'No quedaba nada del asistente anterior.';
}

// Los disparadores viejos todavía llaman a estas funciones: se limpian solos la primera vez.
function IA_vueltaAutomatica() { IA_retirar_(ssPrincipal_()); }
function IA_alEditar() { IA_retirar_(ssPrincipal_()); }

function IA_menuRetirar() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('🧹 Quitar el asistente anterior', 'Se borra la pestaña "' + IA_HOJA_VIEJA_ + '" del asistente anterior y su búsqueda automática. ' +
    'No toca vouchers, facturas, la pestaña 🤝 Conciliar con IA ni las claves de IA. ¿Seguir?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert(IA_retirar_(SpreadsheetApp.getActiveSpreadsheet()));
}

function IA_pasarDocs_(ssV, cols, fuente, idPago, docs) {
  if (!docs) return '⚠️ Sin documentos: escribe alguno o marca ✖';
  var partes = fuente.split('!');
  var sh = ssV.getSheetByName(partes[0]);
  if (!sh) return '⚠️ No existe la pestaña ' + partes[0];
  if (!cols[partes[0]]) {
    var col = indiceColumnas_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    cols[partes[0]] = { op: col('Numero de oper', 'Numero de operacion'), monto: col('Monto'), refs: col('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc') };
  }
  var c = cols[partes[0]];
  if (c.refs < 0) return '⚠️ La pestaña ' + partes[0] + ' no tiene columna "Tipo y Nº Doc."';
  // id del pago = BANCO|operacion|yyyymmdd|monto: verificar que la fila siga siendo ese voucher.
  var id = idPago.split('|'), op = id[1], monto = Number(id[3]);
  var fila = parseInt(partes[1], 10);
  function coincide(f) {
    return String(sh.getRange(f, c.op + 1).getValue()).trim() === op && Math.abs(aNumero_(sh.getRange(f, c.monto + 1).getValue()) - monto) < 0.005;
  }
  if (!(fila >= 2 && fila <= sh.getLastRow() && coincide(fila))) {
    var n = sh.getLastRow() - 1, ops = sh.getRange(2, c.op + 1, n, 1).getValues(), montos = sh.getRange(2, c.monto + 1, n, 1).getValues();
    var hall = [];
    for (var i = 0; i < n; i++) if (String(ops[i][0]).trim() === op && Math.abs(aNumero_(montos[i][0]) - monto) < 0.005) hall.push(i + 2);
    if (hall.length !== 1) return '⚠️ No se encontró el voucher (¿se borró o cambió?)';
    fila = hall[0];
  }
  var celda = sh.getRange(fila, c.refs + 1);
  if (String(celda.getValue()).trim() !== '') return '✔ El voucher ya tenía documento';
  celda.setValue(docs);
  return '✅ Pasado ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm');
}
