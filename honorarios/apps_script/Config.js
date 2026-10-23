/**
 * Honorarios · Grupo — Config.js
 * Menú, parámetros (pestaña "Config") y el token de GitHub.
 *
 * Cómo funciona (igual que SIRE y Retenciones):
 *   1. GitHub Actions baja de SUNAT SOL los Recibos por Honorarios Electrónicos
 *      RECIBIDOS de cada empresa (con su PDF y XML si se pide) y los guarda en
 *      el repositorio, en honorarios/datos/.
 *   2. Esta hoja lee esos archivos y arma las pestañas Panel, Recibos y
 *      Por emisor, y copia los PDF a Drive ordenados por empresa / año / mes.
 * El token de GitHub va en Propiedades del script (menú 🔑), nunca en celdas.
 */

var HON_HOJA = {
  PANEL: 'Panel',
  RECIBOS: 'Recibos',
  EMISORES: 'Por emisor',
  CONFIG: 'Config',
  ARCHIVOS: '_Archivos',
};

var HON_MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
var HON_MESES_CARPETA = ['01_Enero', '02_Febrero', '03_Marzo', '04_Abril', '05_Mayo', '06_Junio',
  '07_Julio', '08_Agosto', '09_Setiembre', '10_Octubre', '11_Noviembre', '12_Diciembre'];

var HON_PARAMETROS = [
  ['Repositorio', 'Aquivan/Claude', 'Dueño/nombre del repositorio de GitHub donde se guardan los datos.'],
  ['Rama', 'claude/python-codes-izve18', 'Rama del repositorio que se lee.'],
  ['Desde (AAAAMM)', '202601', 'Primer mes que se muestra y que se pide a SUNAT.'],
  ['Carpeta de PDF', 'PDF Honorarios', 'Nombre de la carpeta (junto a esta hoja) donde se ordenan los PDF.'],
  ['Descargar PDF de SUNAT', 'SI', 'SI = al pedir a SUNAT lo nuevo también baja el PDF y XML de cada recibo (más lento). NO = solo el listado.'],
  ['Copiar PDF a Drive', 'SI', 'SI = copia a Drive los PDF ya descargados, ordenados por empresa / año / mes. NO = no copia (las filas quedan sin enlace).'],
  ['Última actualización', '', 'Se llena sola.'],
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🧑‍💼 Honorarios')
    .addItem('🔄 Actualizar todo (datos + PDF en Drive)', 'HON_menuActualizarTodo')
    .addItem('📥 Solo actualizar datos', 'HON_menuActualizarDatos')
    .addItem('📁 Solo ordenar PDF en Drive', 'HON_menuOrdenarPdf')
    .addSeparator()
    .addItem('⬇ Pedir a SUNAT lo nuevo (GitHub)', 'HON_menuPedirDescarga')
    .addItem('⬇ Pedir a SUNAT un rango de meses (con o sin PDF)…', 'HON_menuPedirRango')
    .addSeparator()
    .addItem('🤝 Conciliar con Vouchers (pagos, por pagar, retención por mes de pago)', 'HCO_menuConciliar')
    .addItem('💾 Guardar confirmaciones (✔ / ✖) de la conciliación', 'HCO_menuGuardar')
    .addSeparator()
    .addItem('⏰ Activar actualización diaria', 'HON_activarDiario')
    .addItem('⏸ Desactivar actualización diaria', 'HON_desactivarDiario')
    .addSeparator()
    .addItem('🔑 Guardar token de GitHub', 'HON_guardarToken')
    .addItem('🔌 Probar conexión', 'HON_probarConexion')
    .addToUi();
}

/** Lee la pestaña Config (la crea con valores por defecto si no existe). */
function HON_leerConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HON_HOJA.CONFIG);
  if (!hoja) hoja = HON_crearConfig_(ss);
  var valores = hoja.getRange(4, 1, HON_PARAMETROS.length, 2).getDisplayValues();
  var mapa = {};
  valores.forEach(function (f) { mapa[f[0]] = String(f[1] || '').trim(); });
  var repo = (mapa['Repositorio'] || HON_PARAMETROS[0][1]).split('/');
  return {
    owner: repo[0],
    repo: repo[1],
    rama: mapa['Rama'] || HON_PARAMETROS[1][1],
    desde: (mapa['Desde (AAAAMM)'] || HON_PARAMETROS[2][1]).replace(/\D/g, ''),
    carpetaPdf: mapa['Carpeta de PDF'] || HON_PARAMETROS[3][1],
    bajarPdf: !/^NO/i.test(mapa['Descargar PDF de SUNAT'] || 'SI'),
    copiarPdf: !/^NO/i.test(mapa['Copiar PDF a Drive'] || 'SI'),
    token: PropertiesService.getScriptProperties().getProperty('HON_GITHUB_TOKEN') || '',
  };
}

function HON_crearConfig_(ss) {
  var hoja = ss.insertSheet(HON_HOJA.CONFIG);
  hoja.getRange('A1').setValue('⚙️ Configuración').setFontSize(14).setFontWeight('bold');
  hoja.getRange('A2').setValue('El token de GitHub NO va aquí: use el menú 🧑‍💼 Honorarios → 🔑 Guardar token de GitHub.')
    .setFontColor('#666666');
  hoja.getRange(3, 1, 1, 3).setValues([['Parámetro', 'Valor', 'Ayuda']])
    .setFontWeight('bold').setBackground('#1f3b5c').setFontColor('#ffffff');
  hoja.getRange(4, 1, HON_PARAMETROS.length, 3).setValues(HON_PARAMETROS);
  hoja.getRange(4, 1, HON_PARAMETROS.length, 1).setFontWeight('bold');
  hoja.getRange(4, 2, HON_PARAMETROS.length, 1).setBackground('#fff8e1').setNumberFormat('@');
  hoja.getRange(8, 2, 2, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO']).build());
  hoja.getRange(4 + HON_PARAMETROS.length - 1, 2).setBackground('#f3f3f3');
  hoja.setColumnWidth(1, 170); hoja.setColumnWidth(2, 260); hoja.setColumnWidth(3, 460);
  hoja.setFrozenRows(3);
  return hoja;
}

function HON_marcarActualizacion_(texto) {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HON_HOJA.CONFIG);
  if (!hoja) return;
  var fila = 4 + HON_PARAMETROS.length - 1;
  hoja.getRange(fila, 2).setValue(texto);
}

function HON_guardarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('🔑 Token de GitHub',
    'Pegue un token de GitHub con permiso de lectura (Contents) sobre el repositorio ' +
    '(y Actions si quiere usar "Pedir a SUNAT lo nuevo"). Puede usar el mismo token de la hoja SIRE o Retenciones.\n' +
    'Se guarda oculto en las Propiedades del script, no en la hoja.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText().trim();
  if (!t) return;
  PropertiesService.getScriptProperties().setProperty('HON_GITHUB_TOKEN', t);
  ui.alert('Token guardado. Ahora use 🔌 Probar conexión.');
}

function HON_probarConexion() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = HON_leerConfig_();
    var empresas = HON_listarEmpresas_(cfg);
    var archivos = HON_listarArchivos_(cfg);
    var cre = archivos.filter(function (a) { return /\/rhe\.csv$/.test(a.path); }).length;
    var pdf = archivos.filter(function (a) { return /\.pdf$/.test(a.path); }).length;
    ui.alert('✅ Conexión correcta con ' + cfg.owner + '/' + cfg.repo + ' (' + cfg.rama + ').\n\n' +
      'Empresas: ' + empresas.length + '\nMeses con datos: ' + cre + '\nPDF disponibles: ' + pdf);
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

/* ------------------------------------------------------------ disparadores */

function HON_activarDiario() {
  HON_desactivarDiario(true);
  ScriptApp.newTrigger('HON_actualizacionAutomatica').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getUi().alert('⏰ Listo: la hoja se actualizará sola todos los días cerca de las 7 a. m.');
}

function HON_desactivarDiario(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'HON_actualizacionAutomatica') ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getUi().alert('⏸ Actualización diaria desactivada.');
}

/** Si una tanda de PDF no terminó por tiempo, se programa la siguiente en 1 minuto. */
function HON_programarContinuacion_() {
  var ya = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'HON_continuarPdf';
  });
  if (!ya) ScriptApp.newTrigger('HON_continuarPdf').timeBased().after(60 * 1000).create();
}

function HON_borrarContinuacion_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'HON_continuarPdf') ScriptApp.deleteTrigger(t);
  });
}
