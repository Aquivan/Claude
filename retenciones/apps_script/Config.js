/**
 * Retenciones · Grupo — Config.js
 * Menú, parámetros (pestaña "Config") y el token de GitHub.
 *
 * Cómo funciona (igual que SIRE):
 *   1. GitHub Actions baja de SUNAT los comprobantes de retención (CRE) con su
 *      PDF y XML y los guarda en el repositorio, en retenciones/datos/.
 *   2. Esta hoja lee esos archivos y arma las pestañas Panel, Emitidas,
 *      Recibidas y Detalle, y copia los PDF a Drive ordenados por
 *      empresa / Emitidas|Recibidas / año / mes.
 * El token de GitHub va en Propiedades del script (menú 🔑), nunca en celdas.
 */

var RET_HOJA = {
  PANEL: 'Panel',
  EMITIDAS: 'Emitidas',
  RECIBIDAS: 'Recibidas',
  DETALLE: 'Detalle',
  CONFIG: 'Config',
  ARCHIVOS: '_Archivos',
};

var RET_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
var RET_MESES_CARPETA = ['01_Enero', '02_Febrero', '03_Marzo', '04_Abril', '05_Mayo', '06_Junio',
  '07_Julio', '08_Agosto', '09_Setiembre', '10_Octubre', '11_Noviembre', '12_Diciembre'];

var RET_PARAMETROS = [
  ['Repositorio', 'Aquivan/Claude', 'Dueño/nombre del repositorio de GitHub donde se guardan los datos.'],
  ['Rama', 'claude/python-codes-izve18', 'Rama del repositorio que se lee.'],
  ['Desde (AAAAMM)', '202601', 'Primer mes que se muestra y que se pide a SUNAT.'],
  ['Carpeta de PDF', 'PDF Retenciones', 'Nombre de la carpeta (junto a esta hoja) donde se ordenan los PDF.'],
  ['Última actualización', '', 'Se llena sola.'],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🧾 Retenciones')
    .addItem('🔄 Actualizar todo (datos + PDF en Drive)', 'RET_menuActualizarTodo')
    .addItem('📥 Solo actualizar datos', 'RET_menuActualizarDatos')
    .addItem('📁 Solo ordenar PDF en Drive', 'RET_menuOrdenarPdf')
    .addSeparator()
    .addItem('⬇ Pedir a SUNAT lo nuevo (GitHub)', 'RET_menuPedirDescarga')
    .addSeparator()
    .addItem('⏰ Activar actualización diaria', 'RET_activarDiario')
    .addItem('⏸ Desactivar actualización diaria', 'RET_desactivarDiario')
    .addSeparator()
    .addItem('🔑 Guardar token de GitHub', 'RET_guardarToken')
    .addItem('🔌 Probar conexión', 'RET_probarConexion')
    .addToUi();
}

/** Lee la pestaña Config (la crea con valores por defecto si no existe). */
function RET_leerConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(RET_HOJA.CONFIG);
  if (!hoja) hoja = RET_crearConfig_(ss);
  var valores = hoja.getRange(4, 1, RET_PARAMETROS.length, 2).getDisplayValues();
  var mapa = {};
  valores.forEach(function (f) { mapa[f[0]] = String(f[1] || '').trim(); });
  var repo = (mapa['Repositorio'] || RET_PARAMETROS[0][1]).split('/');
  return {
    owner: repo[0],
    repo: repo[1],
    rama: mapa['Rama'] || RET_PARAMETROS[1][1],
    desde: (mapa['Desde (AAAAMM)'] || RET_PARAMETROS[2][1]).replace(/\D/g, ''),
    carpetaPdf: mapa['Carpeta de PDF'] || RET_PARAMETROS[3][1],
    token: PropertiesService.getScriptProperties().getProperty('RET_GITHUB_TOKEN') || '',
  };
}

function RET_crearConfig_(ss) {
  var hoja = ss.insertSheet(RET_HOJA.CONFIG);
  hoja.getRange('A1').setValue('⚙️ Configuración').setFontSize(14).setFontWeight('bold');
  hoja.getRange('A2').setValue('El token de GitHub NO va aquí: use el menú 🧾 Retenciones → 🔑 Guardar token de GitHub.')
    .setFontColor('#666666');
  hoja.getRange(3, 1, 1, 3).setValues([['Parámetro', 'Valor', 'Ayuda']])
    .setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff');
  hoja.getRange(4, 1, RET_PARAMETROS.length, 3).setValues(RET_PARAMETROS);
  hoja.getRange(4, 1, RET_PARAMETROS.length, 1).setFontWeight('bold');
  hoja.getRange(4, 2, RET_PARAMETROS.length, 1).setBackground('#fff8e1').setNumberFormat('@');
  hoja.getRange(4 + RET_PARAMETROS.length - 1, 2).setBackground('#f3f3f3');
  hoja.setColumnWidth(1, 170); hoja.setColumnWidth(2, 260); hoja.setColumnWidth(3, 460);
  hoja.setFrozenRows(3);
  return hoja;
}

function RET_marcarActualizacion_(texto) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RET_HOJA.CONFIG);
  if (!hoja) return;
  var fila = 4 + RET_PARAMETROS.length - 1;
  hoja.getRange(fila, 2).setValue(texto);
}

function RET_guardarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('🔑 Token de GitHub',
    'Pegue un token de GitHub con permiso de lectura (Contents) sobre el repositorio ' +
    '(y Actions si quiere usar "Pedir a SUNAT lo nuevo"). Puede usar el mismo token de la hoja SIRE.\n' +
    'Se guarda oculto en las Propiedades del script, no en la hoja.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText().trim();
  if (!t) return;
  PropertiesService.getScriptProperties().setProperty('RET_GITHUB_TOKEN', t);
  ui.alert('Token guardado. Ahora use 🔌 Probar conexión.');
}

function RET_probarConexion() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = RET_leerConfig_();
    var empresas = RET_listarEmpresas_(cfg);
    var archivos = RET_listarArchivos_(cfg);
    var cre = archivos.filter(function (a) { return /\/cre\.csv$/.test(a.path); }).length;
    var pdf = archivos.filter(function (a) { return /\.pdf$/.test(a.path); }).length;
    ui.alert('✅ Conexión correcta con ' + cfg.owner + '/' + cfg.repo + ' (' + cfg.rama + ').\n\n' +
      'Empresas: ' + empresas.length + '\nMeses con datos: ' + cre + '\nPDF disponibles: ' + pdf);
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

/* ------------------------------------------------------------ disparadores */

function RET_activarDiario() {
  RET_desactivarDiario(true);
  ScriptApp.newTrigger('RET_actualizacionAutomatica').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getUi().alert('⏰ Listo: la hoja se actualizará sola todos los días cerca de las 7 a. m.');
}

function RET_desactivarDiario(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'RET_actualizacionAutomatica') ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getUi().alert('⏸ Actualización diaria desactivada.');
}

/** Si una tanda de PDF no terminó por tiempo, se programa la siguiente en 1 minuto. */
function RET_programarContinuacion_() {
  var ya = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'RET_continuarPdf';
  });
  if (!ya) ScriptApp.newTrigger('RET_continuarPdf').timeBased().after(60 * 1000).create();
}

function RET_borrarContinuacion_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'RET_continuarPdf') ScriptApp.deleteTrigger(t);
  });
}
