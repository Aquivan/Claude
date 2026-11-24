// ============================================================
// 🩺 REGISTRO TÉCNICO (para diagnosticar sin capturas de pantalla)
// ------------------------------------------------------------
// Cada vez que la hoja procesa archivos anota DOS filas en la hoja
// «🩺 Registro técnico (sistema)» (se crea sola en Drive, una sola vez):
//   · «inicio» con cuántos archivos hay en Entrada, y
//   · «fin» con lo procesado, el tiempo, quién leyó y el detalle del registro.
// Si hay un «inicio» sin su «fin», Google cortó esa ejecución (6 min).
// Lo nuevo va ARRIBA; se guardan las últimas 400 filas. No guarda claves.
// También la usa la app «Vouchers WhatsApp» (mismo nombre de hoja).
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

/** ⏱ En qué se fue el tiempo de una ejecución, paso por paso (segundos). t = TIEMPOS_ (Gemini.js), total en s. */
function REG_desglose_(t, total) {
  const s = function (ms) { return Math.round((ms || 0) / 100) / 10; };
  const ia = s(t.ia), fallo = s(t.gemFallo), img = s(t.imagen), pdf = s(t.pdf), idx = s(t.indices), esc = s(t.escribir), pau = s(t.pausas);
  const otros = Math.max(0, Math.round((Number(total) - ia - img - pdf - idx - esc - pau) * 10) / 10);
  const pct = function (x) { return total ? ' (' + Math.round(x / total * 100) + '%)' : ''; };
  return '⏱ DESGLOSE ' + total + ' s: IA ' + ia + ' s' + pct(ia) + (fallo ? ' [de eso, esperando a Gemini saturado: ' + fallo + ' s en ' + (t.gemFallos || 0) + ' intento(s)]' : '') +
    ' · imagen en celda ' + img + ' s' + pct(img) + ' en ' + (t.imagenes || 0) + (t.imagenReuso ? ' (' + t.imagenReuso + ' reusada(s) de NVIDIA/Groq)' : '') +
    ' · abrir/separar PDF ' + pdf + ' s' + pct(pdf) + ' · leer hoja (duplicados) ' + idx + ' s' + pct(idx) +
    (t.sondeo ? ' [sondeo de Gemini ' + s(t.sondeo) + ' s]' : '') + ' · escribir filas ' + esc + ' s' + pct(esc) + ' · pausas ' + pau + ' s' + pct(pau) + ' · otros (Drive, mover archivos…) ' + otros + ' s' + pct(otros);
}

/** El registro de la ejecución, corto: el COMIENZO y el FINAL (el medio es lo repetido). */
function REG_logCorto_(log) {
  if (log.length <= 2400) return log;
  return log.slice(0, 900) + '\n[…]\n' + log.slice(-1500);
}

function REG_anotar_(sistema, evento, segundos, detalle) {
  try {
    const sh = REG_hoja_();
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 5).setValues([["'" + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm:ss'), sistema, evento, segundos === '' ? '' : Number(segundos) || 0, String(detalle || '').slice(0, 3000)]]);
    if (sh.getLastRow() > 401) sh.deleteRows(402, sh.getLastRow() - 401);
  } catch (e) { Logger.log('Registro técnico: ' + e.message); }
}
