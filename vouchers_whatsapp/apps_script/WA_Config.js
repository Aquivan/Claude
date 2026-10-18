/**
 * 📲 Vouchers por WhatsApp — configuración y menú.
 *
 * Proyecto APARTE del bot de Telegram: tiene su propia hoja ("Vouchers
 * WhatsApp", pestaña Recibidos) y su propia aplicación web. No toca el
 * código de la hoja de Vouchers: solo deja los archivos en las mismas
 * carpetas de Entrada que ya revisa el sistema cada 10 minutos, y después
 * lee la hoja de Vouchers para avisar el resultado por WhatsApp.
 *
 * Claves (Propiedades del script; se llenan con el menú, nunca en el código):
 *   WA_TOKEN       token permanente de Meta (usuario del sistema).
 *   WA_PHONE_ID    "Identificador del número de teléfono" (WhatsApp → Configuración de la API).
 *   WA_WABA_ID     "Identificador de la cuenta de WhatsApp Business" (opcional).
 *   WA_PERMITIDOS  números que pueden mandar vouchers, ej. 51987654321,51911222333.
 *   WA_GAS_TOKEN   clave entre el puente de Cloudflare y esta app (se genera sola).
 *   WA_VERIFY      clave de verificación para Meta (se genera sola).
 */

var WA_GRAPH_ = 'https://graph.facebook.com/v25.0/';

// Datos de la app "Vouchers Bot" (no son secretos). Lo que se guarde con el menú los reemplaza.
var WA_FIJOS_ = {
  WA_PHONE_ID: '1219097671294680',   // número de prueba +1 555 199 0951
  WA_WABA_ID: '1414043013929024',    // Test WhatsApp Business Account
  WA_PERMITIDOS: '51XXXXXXXXX'
};

// Mismas carpetas y hoja que usa el sistema de Vouchers (vouchers_bot_respaldo/src/Config.js).
var WA_VOUCHERS_ = {
  hoja: '1CS0GZiKclm2SroNgrpiBZsavYVobqBv9rgKzjQDII1c',
  entrada: { original: '1GqjydN2oOYhwDvxPmZtr9TEJgjP65i2g', foto: '12si83gUAbe5kqbFopbMrFkdD3EvBsA72' },
  pestana: { original: 'Originales', foto: 'Fotos' }
};

var WA_MAX_MB_ = 45;
var WA_PESTANA_ = 'Recibidos';
var WA_CABECERA_ = ['Fecha', 'De', 'Número', 'Tipo', 'Archivo', 'KB', 'Estado', 'Resultado', 'ID mensaje', 'ID archivo', 'Avisado'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('📲 WhatsApp')
    .addItem('1. Configurar (token, número)', 'WA_menuConfigurar')
    .addItem('2. Datos para Cloudflare y Meta', 'WA_menuDatos')
    .addItem('3. Probar envío (Hello World)', 'WA_menuProbar')
    .addSeparator()
    .addItem('Estado', 'WA_menuEstado')
    .addItem('Números autorizados', 'WA_menuNumeros')
    .addItem('Conectar app a la cuenta (si no llegan mensajes)', 'WA_menuSuscribir')
    .addToUi();
}

function WA_props_() { return PropertiesService.getScriptProperties(); }
function WA_prop_(k) { return WA_props_().getProperty(k) || WA_FIJOS_[k] || ''; }

function WA_hoja_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  var id = WA_HOJA_ID_ || WA_prop_('WA_HOJA_ID');
  if (!ss && id) ss = SpreadsheetApp.openById(id);
  var h = ss.getSheetByName(WA_PESTANA_);
  if (!h) {
    h = ss.insertSheet(WA_PESTANA_, 0);
    h.getRange(1, 1, 1, WA_CABECERA_.length).setValues([WA_CABECERA_])
      .setBackground('#075e54').setFontColor('#ffffff').setFontWeight('bold');
    h.setFrozenRows(1);
    h.setColumnWidth(5, 280); h.setColumnWidth(8, 360);
  }
  return h;
}

function WA_urlApp_() {
  if (WA_DEPLOYMENT_ID_) return 'https://script.google.com/macros/s/' + WA_DEPLOYMENT_ID_ + '/exec';
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function WA_permitidos_() {
  return WA_prop_('WA_PERMITIDOS').split(/[,\s]+/).map(WA_soloDigitos_).filter(String);
}

function WA_soloDigitos_(s) { return String(s || '').replace(/\D/g, ''); }

function WA_asegurarClaves_() {
  var p = WA_props_();
  if (!p.getProperty('WA_GAS_TOKEN')) p.setProperty('WA_GAS_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  if (!p.getProperty('WA_VERIFY')) p.setProperty('WA_VERIFY', 'vouchers-' + Utilities.getUuid().slice(0, 8));
}

function WA_asegurarTrigger_() {
  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'WA_cadaMinuto'; });
  if (!hay) ScriptApp.newTrigger('WA_cadaMinuto').timeBased().everyMinutes(1).create();
}

// ---------------------------------------------------------------- menú

function WA_menuConfigurar() {
  var ui = SpreadsheetApp.getUi(), p = WA_props_();
  var pasos = [
    ['WA_TOKEN', 'Token PERMANENTE de Meta (usuario del sistema).\nDéjelo vacío para conservar el actual.'],
    ['WA_PHONE_ID', 'Identificador del número de teléfono\n(Meta → WhatsApp → Configuración de la API, debajo del número de prueba).'],
    ['WA_WABA_ID', 'Identificador de la cuenta de WhatsApp Business (opcional, mismo lugar).'],
    ['WA_PERMITIDOS', 'Su número de WhatsApp con código de país, sin + ni espacios\n(ej. 51987654321). Varios: sepárelos con comas.']
  ];
  for (var i = 0; i < pasos.length; i++) {
    var actual = WA_prop_(pasos[i][0]);
    var muestra = actual ? (pasos[i][0] === 'WA_TOKEN' ? ' (ya guardado)' : ' (actual: ' + actual + ')') : '';
    var r = ui.prompt('📲 WhatsApp (' + (i + 1) + '/4)', pasos[i][1] + muestra, ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var v = r.getResponseText().trim();
    if (v) p.setProperty(pasos[i][0], pasos[i][0] === 'WA_TOKEN' ? v : v.replace(/\s/g, ''));
  }
  WA_asegurarClaves_();
  WA_asegurarTrigger_();
  p.setProperty('WA_HOJA_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  WA_hoja_();
  WA_menuDatos();
}

function WA_menuDatos() {
  WA_asegurarClaves_();
  var url = WA_urlApp_();
  var filas = [
    ['<b>En Cloudflare</b> (Worker → Settings → Variables and Secrets)', ''],
    ['GAS_URL', url || '(aún no publicada: corra el workflow "Desplegar Vouchers WhatsApp")'],
    ['GAS_TOKEN', WA_prop_('WA_GAS_TOKEN')],
    ['VERIFY_TOKEN', WA_prop_('WA_VERIFY')],
    ['APP_SECRET', 'Meta → su app → Configuración de la app → Básica → Clave secreta de la app'],
    ['<b>En Meta</b> (WhatsApp → Configuración → Webhook)', ''],
    ['URL de devolución de llamada', 'la dirección de su Worker, ej. https://vouchers-wa.SU-CUENTA.workers.dev'],
    ['Token de verificación', WA_prop_('WA_VERIFY')],
    ['Campo a suscribir', 'messages']
  ];
  var html = '<div style="font:13px Arial;line-height:1.5">' + filas.map(function (f) {
    return f[1] === '' ? '<p style="margin:12px 0 4px">' + f[0] + '</p>'
      : '<div><span style="color:#555">' + f[0] + ':</span><br><input readonly onclick="this.select()" style="width:100%;font:12px monospace;padding:4px" value="' + String(f[1]).replace(/"/g, '&quot;') + '"></div>';
  }).join('') + '<p style="color:#888">Toque un cuadro para seleccionarlo y copiarlo.</p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(560), '📲 Datos para conectar');
}

function WA_menuProbar() {
  var ui = SpreadsheetApp.getUi(), nums = WA_permitidos_();
  if (!WA_prop_('WA_TOKEN') || !WA_prop_('WA_PHONE_ID') || !nums.length) { ui.alert('Primero use "1. Configurar".'); return; }
  var r = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', to: nums[0], type: 'template',
    template: { name: 'hello_world', language: { code: 'en_US' } }
  });
  ui.alert(r.ok ? '✅ Enviado a ' + nums[0] + '. Revise su WhatsApp.\nResponda cualquier cosa a ese chat: así el bot ya puede contestarle.'
    : '❌ Meta respondió: ' + r.error);
}

function WA_menuEstado() {
  var t = WA_prop_('WA_TOKEN'), id = WA_prop_('WA_PHONE_ID'), lineas = [];
  lineas.push('Token: ' + (t ? 'guardado' : 'FALTA'));
  lineas.push('Número (ID): ' + (id || 'FALTA'));
  if (t && id) {
    var r = WA_graph_('GET', id + '?fields=display_phone_number,verified_name,quality_rating');
    lineas.push(r.ok ? 'Meta: ✅ ' + (r.datos.display_phone_number || '') + ' · ' + (r.datos.verified_name || '') : 'Meta: ❌ ' + r.error);
  }
  lineas.push('Autorizados: ' + (WA_permitidos_().join(', ') || 'FALTA'));
  lineas.push('Aplicación web: ' + (WA_urlApp_() || 'sin publicar'));
  lineas.push('Revisión cada minuto: ' + (ScriptApp.getProjectTriggers().some(function (x) { return x.getHandlerFunction() === 'WA_cadaMinuto'; }) ? 'activa' : 'INACTIVA'));
  var ult = WA_prop_('WA_ULTIMO');
  lineas.push('Último aviso recibido: ' + (ult || 'ninguno todavía'));
  SpreadsheetApp.getUi().alert('📲 Estado', lineas.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function WA_menuNumeros() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Números autorizados', 'Actual: ' + (WA_permitidos_().join(', ') || '(ninguno)') +
    '\nEscriba la lista completa separada por comas (ej. 51987654321,51911222333):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  WA_props_().setProperty('WA_PERMITIDOS', r.getResponseText().split(/[,\s]+/).map(WA_soloDigitos_).filter(String).join(','));
  ui.alert('Guardado: ' + WA_permitidos_().join(', '));
}

function WA_menuSuscribir() {
  var ui = SpreadsheetApp.getUi(), waba = WA_prop_('WA_WABA_ID');
  if (!waba) { ui.alert('Falta el "Identificador de la cuenta de WhatsApp Business". Póngalo en "1. Configurar".'); return; }
  var r = WA_graph_('POST', waba + '/subscribed_apps', {});
  ui.alert(r.ok ? '✅ La app quedó conectada a la cuenta de WhatsApp. Mande un voucher de prueba.' : '❌ Meta respondió: ' + r.error);
}
