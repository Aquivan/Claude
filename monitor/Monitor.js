/**
 * 🩺 Monitor de ejecuciones — copia la pantalla «Ejecuciones» de Apps Script (de TODOS sus proyectos) a la hoja
 * «🩺 Ejecuciones (monitor)», cada 5 minutos, para que el asistente la lea con el conector de Drive (sin capturas).
 * Proyecto aparte: no toca Cobranzas, Vouchers ni WhatsApp. Solo lee proyecto, función, tipo, estado, hora y duración.
 *
 * Una sola vez: abra este proyecto en script.google.com, elija la función «instalar» y toque ▶ Ejecutar
 * (Google pide permiso: Revisar permisos → su cuenta → Permitir). Para apagarlo: función «desinstalar».
 */

var MON_NOMBRE_ = '🩺 Ejecuciones (monitor)';

function instalar() {
  desinstalar();
  ScriptApp.newTrigger('MON_cada5').timeBased().everyMinutes(5).create();
  MON_cada5();
  Logger.log('✅ Listo: la hoja «' + MON_NOMBRE_ + '» se actualiza cada 5 minutos.');
}

function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function MON_hoja_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('MON_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create(MON_NOMBRE_); props.setProperty('MON_ID', ss.getId()); }
  return ss.getSheets()[0];
}

function MON_cada5() {
  var desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString(), filas = [], page = '';
  for (var i = 0; i < 10; i++) {
    var url = 'https://script.googleapis.com/v1/processes?pageSize=200&userProcessFilter.startTime=' + encodeURIComponent(desde) + (page ? '&pageToken=' + encodeURIComponent(page) : '');
    var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) {
      MON_hoja_().getRange(1, 1).setValue('❌ La API de Apps Script respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300) +
        ' (si dice que no está habilitada: script.google.com/home/usersettings → API de Google Apps Script → Activar)');
      return;
    }
    var j = JSON.parse(r.getContentText());
    (j.processes || []).forEach(function (p) {
      var ini = p.startTime ? new Date(p.startTime) : null, seg = parseFloat(String(p.duration || '').replace('s', '')) || '';
      filas.push([ini ? ini.getTime() : 0, ini ? Utilities.formatDate(ini, 'America/Lima', 'dd/MM/yyyy HH:mm:ss') : '', p.projectName || '', p.functionName || '',
        p.processType || '', p.processStatus || '', seg]);
    });
    page = j.nextPageToken;
    if (!page) break;
  }
  filas.sort(function (a, b) { return b[0] - a[0]; });   // lo más nuevo arriba
  filas = filas.map(function (f) { return f.slice(1); });
  var sh = MON_hoja_();
  sh.clearContents();
  sh.getRange(1, 1, 1, 6).setValues([['Inicio (Lima) · actualizado ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm'), 'Proyecto', 'Función', 'Tipo', 'Estado', 'Segundos']]);
  if (filas.length) sh.getRange(2, 1, Math.min(filas.length, 400), 6).setValues(filas.slice(0, 400));
}
