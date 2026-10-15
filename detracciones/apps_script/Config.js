/**
 * Detracciones · Grupo — Config.js
 * Menú, parámetros (pestaña "Config") y el token de GitHub.
 *
 * Cómo funciona (igual que SIRE, Retenciones, Honorarios y Notificaciones):
 *   1. GitHub Actions entra a SUNAT SOL de cada empresa (Mis declaraciones y pagos →
 *      Consulta de Pago de Detracciones) y guarda los depósitos de cada mes en el
 *      repositorio, en detracciones/datos/<RUC>/<AAAA>/<MM>/detracciones.csv.
 *   2. Esta hoja lee esos archivos y arma Panel, Detracciones, Por proveedor y Por mes.
 */

var DET_HOJA = {
  PANEL: 'Panel',
  DETALLE: 'Detracciones',
  PROVEEDOR: 'Por proveedor',
  MES: 'Por mes',
  CONFIG: 'Config',
};

var DET_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

var DET_PARAMETROS = [
  ['Repositorio', 'Aquivan/Claude', 'Dueño/nombre del repositorio de GitHub donde se guardan los datos.'],
  ['Rama', 'claude/python-codes-izve18', 'Rama del repositorio que se lee.'],
  ['Desde (AAAAMM)', '202601', 'Se muestran en la hoja los depósitos pagados desde este mes (fecha de pago).'],
  ['Días para "nuevo"', '7', 'Los depósitos pagados en los últimos N días se resaltan en amarillo.'],
  ['Última actualización', '', 'Se llena sola.'],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏦 Detracciones')
    .addItem('🔄 Actualizar hoja (lo ya descargado)', 'DET_menuActualizar')
    .addSeparator()
    .addItem('⬇ Pedir a SUNAT lo nuevo (últimos 3 meses, GitHub)', 'DET_menuPedirDescarga')
    .addItem('⬇ Pedir a SUNAT: elegir meses y empresa…', 'DET_menuPedirRango')
    .addSeparator()
    .addItem('⏰ Activar actualización diaria', 'DET_activarDiario')
    .addItem('⏸ Desactivar actualización diaria', 'DET_desactivarDiario')
    .addSeparator()
    .addItem('🔑 Guardar token de GitHub', 'DET_guardarToken')
    .addItem('🔌 Probar conexión', 'DET_probarConexion')
    .addToUi();
}

/** Lee la pestaña Config (la crea con valores por defecto si no existe). */
function DET_leerConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(DET_HOJA.CONFIG);
  if (!hoja) hoja = DET_crearConfig_(ss);
  var valores = hoja.getRange(4, 1, DET_PARAMETROS.length, 2).getDisplayValues();
  var mapa = {};
  valores.forEach(function (f) { mapa[f[0]] = String(f[1] || '').trim(); });
  var repo = (mapa['Repositorio'] || DET_PARAMETROS[0][1]).split('/');
  return {
    owner: repo[0],
    repo: repo[1],
    rama: mapa['Rama'] || DET_PARAMETROS[1][1],
    desde: (mapa['Desde (AAAAMM)'] || DET_PARAMETROS[2][1]).replace(/\D/g, ''),
    diasNuevo: parseInt(mapa['Días para "nuevo"'], 10) || 7,
    token: PropertiesService.getScriptProperties().getProperty('DET_GITHUB_TOKEN') || '',
  };
}

function DET_crearConfig_(ss) {
  var hoja = ss.insertSheet(DET_HOJA.CONFIG);
  hoja.getRange('A1').setValue('⚙️ Configuración').setFontSize(14).setFontWeight('bold');
  hoja.getRange('A2').setValue('El token de GitHub NO va aquí: use el menú 🏦 Detracciones → 🔑 Guardar token de GitHub.')
    .setFontColor('#666666');
  hoja.getRange(3, 1, 1, 3).setValues([['Parámetro', 'Valor', 'Ayuda']])
    .setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff');
  hoja.getRange(4, 1, DET_PARAMETROS.length, 3).setValues(DET_PARAMETROS);
  hoja.getRange(4, 1, DET_PARAMETROS.length, 1).setFontWeight('bold');
  hoja.getRange(4, 2, DET_PARAMETROS.length, 1).setBackground('#fff8e1').setNumberFormat('@');
  hoja.getRange(4 + DET_PARAMETROS.length - 1, 2).setBackground('#f3f3f3');
  hoja.setColumnWidth(1, 170); hoja.setColumnWidth(2, 260); hoja.setColumnWidth(3, 460);
  hoja.setFrozenRows(3);
  return hoja;
}

function DET_marcarActualizacion_(texto) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DET_HOJA.CONFIG);
  if (!hoja) return;
  hoja.getRange(4 + DET_PARAMETROS.length - 1, 2).setValue(texto);
}

function DET_guardarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('🔑 Token de GitHub',
    'Pegue un token de GitHub con permiso de lectura (Contents) sobre el repositorio ' +
    '(y Actions si quiere usar "Pedir a SUNAT lo nuevo"). Puede usar el mismo token de las hojas SIRE, Retenciones, Honorarios o Notificaciones.\n' +
    'Se guarda oculto en las Propiedades del script, no en la hoja.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText().trim();
  if (!t) return;
  PropertiesService.getScriptProperties().setProperty('DET_GITHUB_TOKEN', t);
  ui.alert('Token guardado. Ahora use 🔌 Probar conexión.');
}

function DET_probarConexion() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = DET_leerConfig_();
    var empresas = DET_listarEmpresas_(cfg);
    var meses = DET_listarArchivos_(cfg).filter(function (a) { return /\/detracciones\.csv$/.test(a.path); }).length;
    ui.alert('✅ Conexión correcta con ' + cfg.owner + '/' + cfg.repo + ' (' + cfg.rama + ').\n\n' +
      'Empresas: ' + empresas.length + '\nMeses con datos (todas las empresas): ' + meses);
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

/* ------------------------------------------------------------ disparadores */

function DET_activarDiario() {
  DET_desactivarDiario(true);
  ScriptApp.newTrigger('DET_actualizacionAutomatica').timeBased().everyDays(1).atHour(8).create();
  SpreadsheetApp.getUi().alert('⏰ Listo: todos los días cerca de las 8 a. m. se piden a SUNAT los depósitos de los últimos 3 meses y la hoja se actualiza sola.');
}

function DET_desactivarDiario(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['DET_actualizacionAutomatica', 'DET_importarTrasDescarga'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getUi().alert('⏸ Actualización diaria desactivada.');
}
