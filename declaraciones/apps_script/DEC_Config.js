/**
 * 📑 Declaraciones · Grupo — DEC_Config.js
 * Menú, parámetros (pestaña ⚙️ Config), token de GitHub y utilidades.
 *
 * Cómo funciona:
 *   1. Esta hoja pide a GitHub (robot «Declaraciones - descargar») que entre a SUNAT SOL de cada empresa
 *      (Mis declaraciones y pagos → Consulta de Declaraciones y Pagos) y baje las declaraciones
 *      PDT 621, 601 (PLAME) y 626 con su constancia PDF, incluidas las rectificatorias.
 *   2. El robot NO guarda nada en GitHub (es público): manda cada constancia directo a esta hoja
 *      (su aplicación web, DEC_Web.js) con una llave de un solo uso.
 *   3. La hoja guarda el PDF en Drive (PDF Declaraciones/<RUC - Empresa>/<AAAA>/<MM>/), anota la
 *      declaración y arma los reportes. Si hay rectificatorias, la ÚLTIMA presentada es la vigente y las
 *      anteriores quedan como respaldo (carpeta «Respaldo (anteriores)» del mes).
 *   4. Sola, una vez al mes (por defecto el día 28, cuando ya vencieron todas las empresas), pide los
 *      últimos 3 meses: así también recoge rectificatorias hechas después.
 */

var DEC_HOJA = {
  PANEL: '📊 Panel',
  DECL: '📄 Declaraciones',
  PERIODO: '🗂 Por periodo',
  TRIB: '🧾 Tributos',
  CAS: '🔢 Casillas',
  CONFIG: '⚙️ Config',
  AYUDA: '📖 Ayuda',
};

var DEC_FORMULARIOS = {
  '0621': 'PDT 621 IGV-Renta mensual',
  '0601': 'PDT 601 PLAME',
  '0626': 'PDT 626 Agentes de Retención IGV',
};

var DEC_PARAMETROS = [
  ['Repositorio', 'Aquivan/Claude', 'Dueño/nombre del repositorio de GitHub donde está el robot.'],
  ['Rama', 'claude/python-codes-izve18', 'Rama del repositorio donde se lanza el robot.'],
  ['Formularios', '0621,0601,0626', 'Formularios a bajar, separados por coma (0621 IGV-Renta, 0601 PLAME, 0626 Agentes de Retención).'],
  ['Día de la descarga mensual', '28', 'Día del mes en que se piden solas las declaraciones (después del último vencimiento del cronograma SUNAT, incluidos los buenos contribuyentes).'],
  ['Meses a revisar cada vez', '3', 'La descarga mensual revisa estos meses hacia atrás (para recoger rectificatorias hechas después).'],
  ['Carpeta de PDF', 'PDF Declaraciones', 'Carpeta (junto a esta hoja) donde se ordenan las constancias por empresa / año / mes.'],
  ['Última actualización', '', 'Se llena sola.'],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('📑 Declaraciones')
    .addItem('⬇ Pedir a SUNAT lo nuevo (últimos meses)', 'DEC_menuPedir')
    .addItem('⬇ Pedir a SUNAT: elegir periodos y empresa…', 'DEC_menuPedirRango')
    .addItem('🔎 Estado de la última descarga', 'DEC_menuEstado')
    .addSeparator()
    .addItem('🔄 Rehacer reportes', 'DEC_menuRehacer')
    .addItem('📂 Abrir carpeta de PDF', 'DEC_menuCarpeta')
    .addSeparator()
    .addItem('🧰 Preparar la hoja (primera vez)', 'DEC_menuPreparar')
    .addItem('⏰ Activar descarga mensual', 'DEC_activarMensual')
    .addItem('⏸ Desactivar descarga mensual', 'DEC_desactivarMensual')
    .addItem('🔑 Guardar token de GitHub', 'DEC_guardarToken')
    .addItem('🔌 Probar conexión con GitHub', 'DEC_probarConexion')
    .addSeparator()
    .addItem('❓ Ayuda', 'DEC_menuAyuda')
    .addToUi();
}

function DEC_ss_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!ss && DEC_HOJA_ID_) ss = SpreadsheetApp.openById(DEC_HOJA_ID_);
  if (ss && ss.getSpreadsheetTimeZone() !== 'America/Lima') ss.setSpreadsheetTimeZone('America/Lima');
  return ss;
}

/** Lee la pestaña ⚙️ Config (la crea con valores por defecto si no existe). */
function DEC_cfg_() {
  var ss = DEC_ss_();
  var hoja = ss.getSheetByName(DEC_HOJA.CONFIG) || DEC_crearConfig_(ss);
  DEC_completarConfig_(hoja);
  var mapa = {};
  hoja.getRange(4, 1, DEC_PARAMETROS.length, 2).getDisplayValues().forEach(function (f) { mapa[f[0]] = String(f[1] || '').trim(); });
  var v = function (i) { return mapa[DEC_PARAMETROS[i][0]] || DEC_PARAMETROS[i][1]; };
  var repo = v(0).split('/');
  return {
    owner: repo[0], repo: repo[1], rama: v(1),
    formularios: v(2).split(/[,\s]+/).filter(String).map(function (f) { return ('0000' + f.replace(/\D/g, '')).slice(-4); }),
    dia: Math.min(28, Math.max(1, parseInt(v(3), 10) || 28)),
    meses: Math.min(24, Math.max(1, parseInt(v(4), 10) || 3)),
    carpeta: v(5),
    token: PropertiesService.getScriptProperties().getProperty('DEC_GITHUB_TOKEN') || '',
  };
}

function DEC_crearConfig_(ss) {
  var hoja = ss.insertSheet(DEC_HOJA.CONFIG);
  hoja.getRange('A1').setValue('⚙️ Configuración').setFontSize(14).setFontWeight('bold');
  hoja.getRange('A2').setValue('El token de GitHub NO va aquí: use el menú 📑 Declaraciones → 🔑 Guardar token de GitHub.').setFontColor('#666666');
  hoja.getRange(3, 1, 1, 3).setValues([['Parámetro', 'Valor', 'Ayuda']]).setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff');
  hoja.getRange(4, 1, DEC_PARAMETROS.length, 3).setValues(DEC_PARAMETROS);
  hoja.getRange(4, 1, DEC_PARAMETROS.length, 1).setFontWeight('bold');
  hoja.getRange(4, 2, DEC_PARAMETROS.length, 1).setBackground('#fff8e1').setNumberFormat('@');
  hoja.getRange(4 + DEC_PARAMETROS.length - 1, 2).setBackground('#f3f3f3');
  hoja.setColumnWidth(1, 210); hoja.setColumnWidth(2, 260); hoja.setColumnWidth(3, 520);
  hoja.setFrozenRows(3);
  return hoja;
}

function DEC_completarConfig_(hoja) {
  var n = DEC_PARAMETROS.length;
  var act = hoja.getRange(4, 1, n, 1).getDisplayValues();
  if (act.every(function (f, i) { return f[0] === DEC_PARAMETROS[i][0]; })) return;
  var valores = {};
  hoja.getRange(4, 1, Math.max(hoja.getLastRow() - 3, 1), 2).getDisplayValues().forEach(function (f) { if (f[0]) valores[f[0]] = f[1]; });
  hoja.getRange(4, 1, n, 3).setValues(DEC_PARAMETROS.map(function (p) { return [p[0], valores[p[0]] !== undefined ? valores[p[0]] : p[1], p[2]]; }));
}

function DEC_marcar_(texto) {
  var hoja = DEC_ss_().getSheetByName(DEC_HOJA.CONFIG);
  if (hoja) hoja.getRange(4 + DEC_PARAMETROS.length - 1, 2).setValue(texto);
}

function DEC_ahora_() { return Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'); }

function DEC_guardarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('🔑 Token de GitHub',
    'Pegue un token de GitHub con permiso «Actions: Read and write» sobre el repositorio (puede usar el mismo de las hojas de ' +
    'Detracciones, Retenciones o Notificaciones). Se guarda oculto en las Propiedades del script, no en la hoja.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText().trim();
  if (!t) return;
  PropertiesService.getScriptProperties().setProperty('DEC_GITHUB_TOKEN', t);
  ui.alert('Token guardado. Ahora use 🔌 Probar conexión con GitHub.');
}

/** Llamada a la API de GitHub. */
function DEC_gh_(cfg, ruta, metodo, cuerpo) {
  if (!cfg.token) throw new Error('Falta el token de GitHub (menú 📑 Declaraciones → 🔑 Guardar token de GitHub).');
  var op = {
    method: metodo || 'get', muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  };
  if (cuerpo) op.payload = JSON.stringify(cuerpo);
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + ruta, op);
  var c = r.getResponseCode();
  if (c >= 300) throw new Error('GitHub respondió HTTP ' + c + (c === 401 || c === 403 ? ' (revise el token y su permiso «Actions: Read and write»)' : '') + ': ' + r.getContentText().slice(0, 200));
  var t = r.getContentText();
  return t ? JSON.parse(t) : {};
}

function DEC_probarConexion() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = DEC_cfg_();
    var w = DEC_gh_(cfg, '/actions/workflows/declaraciones-descargar.yml');
    ui.alert('✅ Conexión correcta con ' + cfg.owner + '/' + cfg.repo + '.\nRobot: «' + w.name + '» (' + w.state + ').\n' +
      'Aplicación web: ' + (DEC_DEPLOYMENT_ID_ ? 'publicada ✅' : '❌ falta publicarla (workflow «Desplegar Declaraciones»)'));
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

function DEC_menuCarpeta() {
  var f = DEC_carpetaRaiz_(DEC_cfg_());
  var html = HtmlService.createHtmlOutput('<p style="font:14px Arial">📂 <a href="' + f.getUrl() + '" target="_blank">Abrir «' + f.getName() + '»</a></p>').setWidth(320).setHeight(80);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Carpeta de PDF');
}

/* ------------------------------------------------------------ disparador mensual */

function DEC_activarMensual(silencioso) {
  DEC_desactivarMensual(true);
  var cfg = DEC_cfg_();
  ScriptApp.newTrigger('DEC_mensual').timeBased().onMonthDay(cfg.dia).atHour(7).inTimezone('America/Lima').create();
  if (silencioso !== true) SpreadsheetApp.getUi().alert('⏰ Listo: el día ' + cfg.dia + ' de cada mes, cerca de las 7 a. m., se piden a SUNAT las declaraciones de los últimos ' +
    cfg.meses + ' meses (solo se bajan las nuevas o rectificadas) y la hoja se actualiza sola.');
}

function DEC_desactivarMensual(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'DEC_mensual') ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getUi().alert('⏸ Descarga mensual desactivada. A mano se puede pedir cuando quiera.');
}

function DEC_mensualActivo_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'DEC_mensual'; });
}

/** Disparador mensual: pide los últimos meses (hasta el mes anterior). */
function DEC_mensual() {
  var cfg = DEC_cfg_();
  var r = DEC_pedir_(cfg, { empresa: 'todas', desde: DEC_mesAtras_(cfg.meses), hasta: DEC_mesAtras_(1) });
  DEC_marcar_(DEC_ahora_() + ' · descarga mensual pedida (' + r.desde + '–' + r.hasta + ')');
}

function DEC_mesAtras_(n) {
  var h = new Date();
  return Utilities.formatDate(new Date(h.getFullYear(), h.getMonth() - n, 1), 'America/Lima', 'yyyyMM');
}

/** 🧰 Arma las pestañas y activa la descarga mensual. */
function DEC_menuPreparar() {
  var ss = DEC_ss_();
  DEC_cfg_();
  DEC_hojaDecl_(ss);
  DEC_hojaAyuda_(ss);
  DEC_rehacer_();
  DEC_activarMensual(true);
  var cfg = DEC_cfg_();
  SpreadsheetApp.getUi().alert('🧰 Hoja lista.\n\n• Descarga mensual activada (día ' + cfg.dia + ').\n' +
    (cfg.token ? '' : '• Falta el token de GitHub: menú 📑 Declaraciones → 🔑 Guardar token de GitHub.\n') +
    '• Para bajar ya lo de los últimos meses: ⬇ Pedir a SUNAT lo nuevo.');
}
