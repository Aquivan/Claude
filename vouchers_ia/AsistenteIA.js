// ============================================================
// 🧠 ASISTENTE IA de la hoja de Vouchers = el MISMO de Cuentas por Cobrar y Pagar (Cobranzas).
// ------------------------------------------------------------
// - El menú se arma solo con los mismos ítems del menú 🧠 Asistente IA de Cobranzas (MenuIA.js, lo genera
//   el despliegue asistente-vouchers.yml cada vez que cambia allá): lo que se mejora en Cobranzas aparece aquí.
// - 💬 Chat, 📰 Resumen y 📋 Analizar vouchers procesados funcionan AQUÍ: el chat es el mismo panel de Cobranzas
//   (ChatPanel.html, copiado al desplegar) y le pide las respuestas a Cobranzas (?canal=vch). Los ✅ escriben en
//   esta hoja de Vouchers igual que desde Cobranzas, y se pueden deshacer.
// - Lo que se trabaja en pestañas de Cobranzas (Auditor, conciliación, importar, claves) abre esa hoja.
// - El asistente ANTERIOR de esta hoja (sugerencias de RUC/factura y su pestaña "🧠 Asistente IA") se retiró:
//   su pestaña y su revisión automática se quitan solas (IA_vueltaAutomatica). Lo que hacía lo hace ahora el
//   chat ("completa los RUC y facturas de los vouchers de hoy") y 📋 Analizar vouchers procesados.
// - No usa el candado (LockService) del bot. Funciones VIA_ (e IA_ solo para el retiro y el menú).
// ============================================================

var VIA_URL_ = '__COBRANZAS_URL__';   // la aplicación web de Cobranzas: la pone el despliegue
var VIA_HOJA_VIEJA_ = '🧠 Asistente IA';

/** Lo llama onOpen() del bot (una línea que agregó el despliegue). */
function IA_agregarMenu_() { VIA_menu_(); }   // MenuIA.js

/* ---------------- conexión con Cobranzas ---------------- */

function VIA_llamar_(accion, cuerpo, token) {
  if (!/^https:\/\/script\.google\.com\//.test(VIA_URL_)) throw new Error('falta la dirección de Cobranzas (vuelva a desplegar el asistente).');
  var r = UrlFetchApp.fetch(VIA_URL_ + '?canal=vch&accion=' + encodeURIComponent(accion) + '&token=' + encodeURIComponent(token || VIA_clave_()), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo || {}), muteHttpExceptions: true, followRedirects: true });
  var t = r.getContentText();
  try { return JSON.parse(t); } catch (e) {
    console.error('Cobranzas respondió HTTP ' + r.getResponseCode() + ': ' + t.replace(/<[^>]+>/g, ' ').slice(0, 300));
    return { error: '⚠️ Cobranzas no respondió bien (HTTP ' + r.getResponseCode() + '; quizá se estaba actualizando o tardó demasiado). Intente de nuevo en un minuto.' };
  }
}

// Clave entre esta hoja y Cobranzas: se crea y registra sola la primera vez.
function VIA_clave_() {
  var p = PropertiesService.getScriptProperties(), k = p.getProperty('VIA_CLAVE');
  if (k) return k;
  k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var r = VIA_llamar_('registrar', {}, k);
  if (!r || !r.ok) throw new Error('No pude conectar con Cobranzas: ' + ((r && r.error) || 'sin respuesta'));
  p.setProperty('VIA_CLAVE', k);
  return k;
}

/* ---------------- 💬 chat (el panel llama a estas funciones) ---------------- */

function VIA_menuAbrirChat() {
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('asistente_ia/ChatPanel').setTitle('💬 Chat con la IA'));
}

function VIA_enviar(msg) {
  try { return VIA_llamar_('chat', { msg: msg }); } catch (e) { return { error: '❌ ' + e.message }; }
}

function VIA_aplicar(ids, reemplazar) {
  try { return VIA_llamar_('aplicar', { ids: ids || [], reemplazar: !!reemplazar }); } catch (e) { return { error: '❌ ' + e.message }; }
}

function VIA_deshacer() {
  try { return VIA_llamar_('deshacer', {}); } catch (e) { return { error: '❌ ' + e.message }; }
}

/** 📊 Tablas completas: quedan en la pestaña 💬 Resultado IA de Cobranzas. */
function VIA_verResultado() { VIA_abrirCobranzas_('💬 Resultado IA', 'Las tablas completas de la última respuesta están en la pestaña 💬 Resultado IA.'); }

/** Pedido dejado por un menú (📰 Resumen, 📋 procesados): el panel lo envía solo al abrirse. */
function VIA_pendiente() {
  var up = PropertiesService.getUserProperties(), m = up.getProperty('VIA_AUTO') || '';
  if (m) up.deleteProperty('VIA_AUTO');
  return m;
}

function VIA_menuResumen() {
  var r = VIA_llamar_('resumen', {});
  if (r.error) return SpreadsheetApp.getUi().alert(r.error);
  PropertiesService.getUserProperties().setProperty('VIA_AUTO', r.pedido);
  VIA_menuAbrirChat();
}

function VIA_menuProcesados() {
  var ui = SpreadsheetApp.getUi();
  var p = ui.prompt('📋 Analizar vouchers procesados', '¿Qué tanda? Ej.: hoy · hoy sonia · 26-10-26 Sonia(Edit) · 14 de octubre', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var r = VIA_llamar_('procesados', { texto: p.getResponseText() || 'hoy' });
  if (r.error) return ui.alert(r.error);
  PropertiesService.getUserProperties().setProperty('VIA_AUTO', r.pedido);
  VIA_menuAbrirChat();
}

/** Lo que se trabaja en pestañas de Cobranzas: enlace para abrir esa hoja (y decir qué usar allá). */
function VIA_abrirCobranzas_(pestana, nota) {
  var r = {};
  try { r = VIA_llamar_('hoja', { pestana: pestana || '' }); } catch (e) { r = { error: e.message }; }
  if (!r.url) return SpreadsheetApp.getUi().alert(r.error || 'No pude obtener el enlace de Cobranzas.');
  var html = '<div style="font:13px Arial;padding:6px">' + String(nota || '').replace(/</g, '&lt;') +
    '<p><a href="' + r.url + '" target="_blank" style="background:#1D4ED8;color:#fff;padding:8px 12px;border-radius:6px;text-decoration:none">📂 Abrir Cuentas por Cobrar y Pagar</a></p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(170), '🧠 Asistente IA');
}

/* ---------------- retiro del asistente anterior de esta hoja ---------------- */

function VIA_retirar_() {
  var hechos = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (['IA_vueltaAutomatica', 'IA_alEditar'].indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); hechos.push('revisión automática'); }
    });
  } catch (e) { Logger.log('Retiro del asistente: ' + e.message); }
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss && ss.getSheetByName(VIA_HOJA_VIEJA_);
  // Solo la pestaña del asistente anterior (su título dice ASISTENTE IA en A1).
  if (sh && /ASISTENTE IA/i.test(String(sh.getRange('A1').getValue())) && ss.getSheets().length > 1) { ss.deleteSheet(sh); hechos.push('pestaña ' + VIA_HOJA_VIEJA_); }
  return hechos.length ? 'Quitado: ' + hechos.join(', ') + '.' : 'No quedaba nada del asistente anterior.';
}

// El disparador viejo (cada 30 min) todavía llama a esta función: la primera vez limpia todo y no vuelve.
function IA_vueltaAutomatica() { VIA_retirar_(); }
function IA_alEditar() { VIA_retirar_(); }

function VIA_menuRetirar() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('🧹 Quitar el asistente anterior', 'Se borra la pestaña "' + VIA_HOJA_VIEJA_ + '" del asistente anterior y su revisión automática. ' +
    'No toca los vouchers ni las demás pestañas. ¿Seguir?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert(VIA_retirar_());
}
