/**
 * Notificaciones · Grupo — Config.js
 * Menú, parámetros (pestaña "Config") y el token de GitHub.
 *
 * Cómo funciona (igual que SIRE, Retenciones y Honorarios):
 *   1. GitHub Actions entra al Buzón Electrónico SOL de cada empresa y guarda la
 *      lista de NOTIFICACIONES y MENSAJES (y los PDF de las notificaciones si se
 *      pide) en el repositorio, en notificaciones/datos/.
 *   2. Esta hoja lee esos archivos y arma Panel, Notificaciones y Mensajes, y copia
 *      los PDF a Drive ordenados por empresa / año / mes.
 */

var NOT_HOJA = {
  PANEL: 'Panel',
  NOTIF: 'Notificaciones',
  MENSAJES: 'Mensajes',
  CONFIG: 'Config',
  ARCHIVOS: '_Archivos',
};

var NOT_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
var NOT_MESES_CARPETA = ['01_Enero', '02_Febrero', '03_Marzo', '04_Abril', '05_Mayo', '06_Junio',
  '07_Julio', '08_Agosto', '09_Setiembre', '10_Octubre', '11_Noviembre', '12_Diciembre'];

var NOT_PARAMETROS = [
  ['Repositorio', 'Aquivan/Claude', 'Dueño/nombre del repositorio de GitHub donde se guardan los datos.'],
  ['Rama', 'claude/python-codes-izve18', 'Rama del repositorio que se lee.'],
  ['Desde (AAAAMM)', '202501', 'Se muestran las notificaciones publicadas desde este mes (las anteriores quedan guardadas, solo no se listan).'],
  ['Carpeta de PDF', 'PDF Notificaciones', 'Nombre de la carpeta (junto a esta hoja) donde se ordenan los PDF.'],
  ['Descargar PDF de SUNAT', 'SI', 'SI = al pedir a SUNAT lo nuevo también baja el PDF de cada notificación nueva (SUNAT la marca como leída, igual que al abrirla). NO = solo la lista.'],
  ['Copiar PDF a Drive', 'SI', 'SI = copia a Drive los PDF ya descargados, ordenados por empresa / año / mes. NO = no copia.'],
  ['Días para "nueva"', '15', 'Las notificaciones publicadas en los últimos N días se resaltan en amarillo.'],
  ['Última actualización', '', 'Se llena sola.'],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('📬 Notificaciones')
    .addItem('🔄 Actualizar todo (datos + PDF en Drive)', 'NOT_menuActualizarTodo')
    .addItem('📥 Solo actualizar datos', 'NOT_menuActualizarDatos')
    .addItem('📁 Solo ordenar PDF en Drive', 'NOT_menuOrdenarPdf')
    .addSeparator()
    .addItem('⬇ Pedir a SUNAT lo nuevo (GitHub)', 'NOT_menuPedirDescarga')
    .addItem('⬇ Pedir a SUNAT: una empresa o sin PDF…', 'NOT_menuPedirRango')
    .addSeparator()
    .addItem('⏰ Activar actualización diaria', 'NOT_activarDiario')
    .addItem('⏸ Desactivar actualización diaria', 'NOT_desactivarDiario')
    .addSeparator()
    .addItem('🔑 Guardar token de GitHub', 'NOT_guardarToken')
    .addItem('🔌 Probar conexión', 'NOT_probarConexion')
    .addToUi();
}

/** Lee la pestaña Config (la crea con valores por defecto si no existe). */
function NOT_leerConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(NOT_HOJA.CONFIG);
  if (!hoja) hoja = NOT_crearConfig_(ss);
  var valores = hoja.getRange(4, 1, NOT_PARAMETROS.length, 2).getDisplayValues();
  var mapa = {};
  valores.forEach(function (f) { mapa[f[0]] = String(f[1] || '').trim(); });
  var repo = (mapa['Repositorio'] || NOT_PARAMETROS[0][1]).split('/');
  return {
    owner: repo[0],
    repo: repo[1],
    rama: mapa['Rama'] || NOT_PARAMETROS[1][1],
    desde: (mapa['Desde (AAAAMM)'] || NOT_PARAMETROS[2][1]).replace(/\D/g, ''),
    carpetaPdf: mapa['Carpeta de PDF'] || NOT_PARAMETROS[3][1],
    bajarPdf: !/^NO/i.test(mapa['Descargar PDF de SUNAT'] || 'SI'),
    copiarPdf: !/^NO/i.test(mapa['Copiar PDF a Drive'] || 'SI'),
    diasNueva: parseInt(mapa['Días para "nueva"'], 10) || 15,
    token: PropertiesService.getScriptProperties().getProperty('NOT_GITHUB_TOKEN') || '',
  };
}

function NOT_crearConfig_(ss) {
  var hoja = ss.insertSheet(NOT_HOJA.CONFIG);
  hoja.getRange('A1').setValue('⚙️ Configuración').setFontSize(14).setFontWeight('bold');
  hoja.getRange('A2').setValue('El token de GitHub NO va aquí: use el menú 📬 Notificaciones → 🔑 Guardar token de GitHub.')
    .setFontColor('#666666');
  hoja.getRange(3, 1, 1, 3).setValues([['Parámetro', 'Valor', 'Ayuda']])
    .setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff');
  hoja.getRange(4, 1, NOT_PARAMETROS.length, 3).setValues(NOT_PARAMETROS);
  hoja.getRange(4, 1, NOT_PARAMETROS.length, 1).setFontWeight('bold');
  hoja.getRange(4, 2, NOT_PARAMETROS.length, 1).setBackground('#fff8e1').setNumberFormat('@');
  hoja.getRange(8, 2, 2, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO']).build());
  hoja.getRange(4 + NOT_PARAMETROS.length - 1, 2).setBackground('#f3f3f3');
  hoja.setColumnWidth(1, 170); hoja.setColumnWidth(2, 260); hoja.setColumnWidth(3, 460);
  hoja.setFrozenRows(3);
  return hoja;
}

function NOT_marcarActualizacion_(texto) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOT_HOJA.CONFIG);
  if (!hoja) return;
  var fila = 4 + NOT_PARAMETROS.length - 1;
  hoja.getRange(fila, 2).setValue(texto);
}

function NOT_guardarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('🔑 Token de GitHub',
    'Pegue un token de GitHub con permiso de lectura (Contents) sobre el repositorio ' +
    '(y Actions si quiere usar "Pedir a SUNAT lo nuevo"). Puede usar el mismo token de las hojas SIRE, Retenciones u Honorarios.\n' +
    'Se guarda oculto en las Propiedades del script, no en la hoja.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText().trim();
  if (!t) return;
  PropertiesService.getScriptProperties().setProperty('NOT_GITHUB_TOKEN', t);
  ui.alert('Token guardado. Ahora use 🔌 Probar conexión.');
}

function NOT_probarConexion() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = NOT_leerConfig_();
    var empresas = NOT_listarEmpresas_(cfg);
    var archivos = NOT_listarArchivos_(cfg);
    var cre = archivos.filter(function (a) { return /\/notificaciones\.csv$/.test(a.path); }).length;
    var pdf = archivos.filter(function (a) { return /\.pdf$/.test(a.path); }).length;
    ui.alert('✅ Conexión correcta con ' + cfg.owner + '/' + cfg.repo + ' (' + cfg.rama + ').\n\n' +
      'Empresas: ' + empresas.length + '\nMeses con datos: ' + cre + '\nPDF disponibles: ' + pdf);
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

/* ------------------------------------------------------------ disparadores */

function NOT_activarDiario() {
  NOT_desactivarDiario(true);
  ScriptApp.newTrigger('NOT_actualizacionAutomatica').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('NOT_actualizacionAutomatica').timeBased().everyDays(1).atHour(17).create();
  SpreadsheetApp.getUi().alert('⏰ Listo: la hoja se actualizará sola todos los días cerca de las 8 a. m. y 5 p. m. (después de que GitHub revisa el buzón).');
}

function NOT_desactivarDiario(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'NOT_actualizacionAutomatica') ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getUi().alert('⏸ Actualización diaria desactivada.');
}

/** Si una tanda de PDF no terminó por tiempo, se programa la siguiente en 1 minuto. */
function NOT_programarContinuacion_() {
  var ya = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'NOT_continuarPdf';
  });
  if (!ya) ScriptApp.newTrigger('NOT_continuarPdf').timeBased().after(60 * 1000).create();
}

function NOT_borrarContinuacion_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'NOT_continuarPdf') ScriptApp.deleteTrigger(t);
  });
}
