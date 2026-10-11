/**
 * Config.js
 * Menu, instalacion (crea hojas y disparador automatico) y lectura de la
 * hoja ⚙️ Config.
 */

var EMPRESAS_INICIALES_ = [
  ['20615366791', 'JENILE', 'CORPORACION EMPRESARIAL JENILE E.I.R.L.'],
  ['20447623669', 'M&D', 'PROCESOS ALIMENTARIOS M&D E.I.R.L.'],
  ['20447968216', 'DSM', 'DSM CORPORACION E.I.R.L.'],
  ['20609309793', 'BKF', 'BKF CORPORACION E.I.R.L.'],
  ['20447969531', 'GRANIX', 'CORPORACION GRANIX E.I.R.L.'],
  ['10420738248', 'LUQUE', 'LUQUE RAFAEL EDWIN'],
  ['20611750821', 'FIVA', 'FIVA'],
];

// Pagos que NO tienen factura de compra (no deben quedar como "sin cruzar").
// Palabra o frase (en beneficiario, descripcion o "Tipo y Nº Doc.") → categoria.
var CATEGORIAS_INICIALES_ = [
  ['AFP', '🏦 Aportes AFP'], ['PRIMA', '🏦 Aportes AFP'], ['PROFUTURO', '🏦 Aportes AFP'], ['HABITAT', '🏦 Aportes AFP'], ['INTEGRA', '🏦 Aportes AFP'],
  ['ESSALUD', '🩺 EsSalud / EPS'], ['EPS', '🩺 EsSalud / EPS'], ['ONP', '🏛 Tributos SUNAT'],
  ['SUNAT', '🏛 Tributos SUNAT'], ['1662', '🏛 Tributos SUNAT'], ['DETRACCION', '🏛 Tributos SUNAT'],
  ['PLANILLA', '👥 Planilla'], ['REMUNERACION', '👥 Planilla'], ['HABERES', '👥 Planilla'], ['SUELDO', '👥 Planilla'],
  ['GRATIFICACION', '👥 Planilla'], ['CTS', '👥 Planilla'], ['VACACIONES', '👥 Planilla'],
  ['RXH', '🧾 Recibo por honorarios'], ['HONORARIOS', '🧾 Recibo por honorarios'], ['RECIBO POR HONORARIOS', '🧾 Recibo por honorarios'],
  ['PRESTAMO', '💳 Préstamos y cuotas'], ['PAGO DE CUOTA', '💳 Préstamos y cuotas'], ['CUOTA', '💳 Préstamos y cuotas'], ['COBRO TARJETA DE CREDITO', '💳 Préstamos y cuotas'],
  ['RETIRO EN EFECTIVO', '💵 Retiro de efectivo'], ['COMISION', '🏦 Gastos bancarios'], ['ITF', '🏦 Gastos bancarios'],
  ['ALQUILER', '🏠 Alquileres'], ['OTROS', '📦 Otros pagos'],
];

// Modos de cruce (de mas estricto a mas amplio).
var MODOS_ = ['SOLO REFERENCIADOS', 'ESTRICTO', 'INTELIGENTE'];
var MODOS_AYUDA_ = 'SOLO REFERENCIADOS = solo lo escrito en el voucher (Tipo y Nº Doc.), lo que confirmaste con ✔ y el registro manual. ' +
  'ESTRICTO = además cruza solo por monto exacto (🔵 Exacto). INTELIGENTE = además propone sugerencias en ✅ Conciliar';

var PARAMETROS_ = [
  // [fila, nombre, valor por defecto, nota]
  [3, 'ID Sheet de Vouchers', '1CS0GZiKclm2SroNgrpiBZsavYVobqBv9rgKzjQDII1c', 'Sistema de Vouchers'],
  [4, 'Pestañas de vouchers', 'Originales,Fotos', 'Separadas por coma'],
  [5, 'Años SIRE a leer', '', 'Vacío = año actual y anterior. Lee las hojas "Liquidacion IGV <RUC> - <año>"'],
  [6, 'Días de crédito por defecto', 30, 'Si SIRE no trae fecha de vencimiento'],
  [7, 'Modo de cruce', 'INTELIGENTE', MODOS_AYUDA_],
  [8, 'Tolerancia sugerencias (S/)', 1, 'Diferencia máxima para proponer una sugerencia'],
  [9, 'Ventana de días para sugerencias', 120, 'Distancia máxima entre fecha de pago y de factura'],
  [10, 'Controlar documentos emitidos desde', '', 'dd/mm/aaaa. Vacío = todo lo que hay en SIRE. Úsalo para no ver como deuda lo antiguo que ya se pagó sin voucher'],
  [11, 'Tipos de comprobante a controlar', '01', '01 = Factura, 03 = Boleta, 14 = Servicios públicos, 02 = Recibo por honorarios… separados por coma. Las N/C y N/D siempre se aplican'],
  [12, 'ID Sheet de Retenciones', '1YpgrLWya8jPIhxurz0wvRuAf4A-Ts6K79NZhkBk6zpw', 'Hoja "Retenciones · Grupo" (comprobantes de retención de SUNAT). Sus retenciones se descuentan solas de cada factura. Vacío = no usar'],
  [13, 'Pedir confirmación al editar datos manuales', 'SI', 'SI = Google pregunta antes de cambiar o borrar una fila ya ingresada en ✍️ Registro manual o 🔁 Reasignar retenciones (agregar filas no pregunta). Hay respaldo automático: menú ♻️'],
  [14, 'ID Sheet de padrones SUNAT (respaldo)', '1AfYaSDwdaZfOQFXbUtJKr86e4waM-IT6VZVpQOtcMFE', 'Hoja "Agente Retenedor" (pestañas Ag_Retencion, Buenos_Contribuyentes, Ag_Percepcion). Se usa solo si la descarga directa de SUNAT falla. Los padrones quedan guardados en la pestaña oculta _Padrones SUNAT'],
];

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('💼 Cobranzas')
    .addItem('🔄 Actualizar ahora', 'menuActualizarAhora')
    .addSubMenu(ui.createMenu('🎚 Modo de cruce y actualizar')
      .addItem('🟢 Solo referenciados (lo escrito en el voucher)', 'menuModoReferenciados')
      .addItem('🔵 Estricto (+ exactos por monto)', 'menuModoEstricto')
      .addItem('🟡 Inteligente (+ sugerencias)', 'menuModoInteligente'))
    .addItem('🖼 Abrir visor de vouchers', 'abrirVisorVoucher')
    .addItem('✍️ Registrar cobro/pago manual (efectivo, compensación…)', 'menuNuevoRegistroManual')
    .addItem('🔁 Reasignar una retención a otra factura', 'menuReasignarRetencion')
    .addItem('🧾 Actualizar padrones SUNAT (agentes de retención, buenos contribuyentes)', 'menuActualizarPadrones')

    .addSubMenu(ui.createMenu('♻️ Respaldos de datos manuales')
      .addItem('💾 Guardar respaldo ahora', 'menuRespaldarAhora')
      .addItem('♻️ Restaurar un respaldo', 'menuRestaurarRespaldo'))
    .addSeparator()
    .addItem('⚙️ Instalar / reparar', 'menuInstalar')
    .addToUi();
  // Menu del Asistente IA (modulo aparte, ver AsistenteIA.js). Si fallara,
  // no afecta al menu de Cobranzas.
  try { IA_agregarMenu_(); } catch (e) { Logger.log('Menu Asistente IA: ' + e.message); }
  // Menú propio de 🤝 Conciliar con IA (módulo aparte, ver ConciliacionIA.js).
  try { CIA_agregarMenu_(); } catch (e) { Logger.log('Menu Conciliar con IA: ' + e.message); }
}

function menuActualizarAhora() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Leyendo SIRE y vouchers…', '💼 Cobranzas', 30);
  var r = actualizarTodo_(true);
  ss.toast(r, '💼 Cobranzas', 8);
}

/** Lleva a ✍️ Registro manual, en la primera fila libre, con la fecha de hoy. */
function menuNuevoRegistroManual() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HOJA.MANUAL);
  if (!sh) { SpreadsheetApp.getUi().alert('Falta la hoja ' + HOJA.MANUAL + '. Use ⚙️ Instalar / reparar.'); return; }
  asegurarRegistroManual_(sh);
  var fila = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(fila, 1).setValue(new Date());
  sh.getRange(fila, 2).setValue('Cobro / pago en efectivo');
  sh.getRange(fila, 7).setValue('PEN');
  ss.setActiveSheet(sh);
  sh.setActiveRange(sh.getRange(fila, 3));
  ss.toast('Complete: RUC de quien paga, RUC del emisor de la factura, Documento(s) (ej. 01_E001-123) y Monto. ' +
    'Cambie la Modalidad si no es efectivo. Luego 💼 Cobranzas → 🔄 Actualizar ahora.', '✍️ Registro manual', 15);
}

/** Abre 🔁 Reasignar retenciones en la primera fila libre. */
function menuReasignarRetencion() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = hojaReasignar_(ss);
  var fila = 4;
  var v = sh.getRange(4, 1, Math.max(sh.getLastRow() - 3, 1), 4).getValues();
  while (fila - 4 < v.length && v[fila - 4].join('') !== '') fila++;
  ss.setActiveSheet(sh);
  sh.setActiveRange(sh.getRange(fila, 1));
  ss.toast('Escriba el comprobante de retención, la factura original y a qué factura(s) pasarla. ' +
    'Vea a la derecha las 💡 SUGERIDAS. Luego 💼 Cobranzas → 🔄 Actualizar ahora.', '🔁 Reasignar retención', 15);
}

function menuModoReferenciados() { cambiarModoYActualizar_('SOLO REFERENCIADOS'); }
function menuModoEstricto() { cambiarModoYActualizar_('ESTRICTO'); }
function menuModoInteligente() { cambiarModoYActualizar_('INTELIGENTE'); }

/** Cambia el modo en ⚙️ Config (celda B7) y recalcula todo con ese modo. */
function cambiarModoYActualizar_(modo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HOJA.CONFIG);
  sh.getRange('B7').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MODOS_).build()).setValue(modo);
  sh.getRange('C7').setValue(MODOS_AYUDA_);
  ss.toast('Modo ' + modo + ': recalculando…', '💼 Cobranzas', 30);
  ss.toast('Modo ' + modo + ' · ' + actualizarTodo_(true), '💼 Cobranzas', 10);
}

function menuInstalar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  instalar_(ss);
  ss.toast('Hojas listas. Primera actualización en curso…', '💼 Cobranzas', 30);
  var r = actualizarTodo_(true);
  SpreadsheetApp.getUi().alert('Instalación lista ✓',
    r + '\n\nDesde ahora se actualiza sola cada 10 minutos. Para ver la imagen de un voucher: menú 💼 Cobranzas → 🖼 Abrir visor de vouchers, y haz clic en cualquier fila con pago.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function instalar_(ss) {
  var orden = [HOJA.PANEL, HOJA.CONSULTA, HOJA.DOCS, HOJA.MOVS, HOJA.CONC, HOJA.OTROS, HOJA.MANUAL, HOJA.CONFIG];
  orden.forEach(function (n, i) {
    var sh = obtenerOCrearHoja_(ss, n);
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  crearConfig_(ss);
  crearRegistroManual_(ss);
  var dec = obtenerOCrearHoja_(ss, HOJA.DECISIONES);
  if (dec.getLastRow() === 0) dec.getRange(1, 1, 1, 4).setValues([['ID pago', 'Estado (OK/NO)', 'Documentos', 'Fecha']]).setFontWeight('bold');
  dec.hideSheet();
  // Quitar la "Hoja 1" vacia de un archivo nuevo
  ss.getSheets().forEach(function (sh) {
    if (orden.indexOf(sh.getName()) === -1 && sh.getName() !== HOJA.DECISIONES && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  // Disparador automatico cada 10 minutos (sin duplicar)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'actualizacionAutomatica') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('actualizacionAutomatica').timeBased().everyMinutes(10).create();
  ss.setActiveSheet(ss.getSheetByName(HOJA.PANEL));
}

function crearConfig_(ss) {
  var sh = ss.getSheetByName(HOJA.CONFIG);
  if (sh.getRange('A1').getValue()) {
    // Ya existe: no pisar lo que el usuario cambio, solo agregar parametros nuevos
    PARAMETROS_.forEach(function (p) {
      if (!sh.getRange(p[0], 1).getValue()) sh.getRange(p[0], 1, 1, 3).setValues([[p[1], p[2], p[3]]]);
    });
    crearTablaCategorias_(sh);
    return;
  }
  sh.getRange('A1').setValue('PARÁMETROS').setFontWeight('bold').setFontSize(12);
  sh.getRange('A2:C2').setValues([['Parámetro', 'Valor', 'Ayuda']]);
  PARAMETROS_.forEach(function (p) { sh.getRange(p[0], 1, 1, 3).setValues([[p[1], p[2], p[3]]]); });
  sh.getRange('B7').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MODOS_).build());

  sh.getRange('E1').setValue('EMPRESAS DEL GRUPO').setFontWeight('bold').setFontSize(12);
  sh.getRange('E2:G2').setValues([['RUC', 'Alias (como se escribe en Vouchers → Empresa)', 'Razón social']]);
  sh.getRange(3, 5, EMPRESAS_INICIALES_.length, 3).setValues(EMPRESAS_INICIALES_);

  sh.getRange('I1').setValue('ALIAS DE NOMBRES (voucher sin RUC → RUC)').setFontWeight('bold').setFontSize(12);
  sh.getRange('I2:J2').setValues([['Nombre como aparece en el voucher', 'RUC']]);

  sh.getRange('L1').setValue('DÍAS DE CRÉDITO POR CONTRAPARTE').setFontWeight('bold').setFontSize(12);
  sh.getRange('L2:M2').setValues([['RUC', 'Días']]);
  crearTablaCategorias_(sh);

  [sh.getRange('A2:C2'), sh.getRange('E2:G2'), sh.getRange('I2:J2'), sh.getRange('L2:M2')].forEach(function (r) {
    r.setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true);
  });
  sh.getRange('E:E').setNumberFormat('@'); sh.getRange('J:J').setNumberFormat('@'); sh.getRange('L:L').setNumberFormat('@');
  sh.setColumnWidth(1, 230); sh.setColumnWidth(2, 330); sh.setColumnWidth(3, 380);
  sh.setColumnWidth(5, 110); sh.setColumnWidth(6, 170); sh.setColumnWidth(7, 300);
  sh.setColumnWidth(9, 280); sh.setColumnWidth(10, 110); sh.setColumnWidth(12, 110); sh.setColumnWidth(13, 70);
  sh.setFrozenRows(2);
}

function crearRegistroManual_(ss) {
  var sh = ss.getSheetByName(HOJA.MANUAL);
  if (sh.getRange('A1').getValue()) return;
  var enc = ['Fecha', 'Modalidad', 'RUC quien paga', 'RUC beneficiario (emisor de la factura)', 'Documento(s) ej. 01_E001-123,124',
    'Monto', 'Moneda', 'N° operación / comprobante', 'Banco', 'Observación'];
  escribirTabla_(sh, 1, 1, enc, []);
  sh.setFrozenRows(1);

  sh.getRange('G2:G2000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['PEN', 'USD']).build());
  sh.getRange('C2:D2000').setNumberFormat('@');
  sh.getRange('A2:A2000').setNumberFormat('dd/mm/yyyy');
  sh.getRange('F2:F2000').setNumberFormat('#,##0.00');
  [100, 120, 120, 150, 220, 110, 70, 170, 100, 260].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setRowHeight(1, 42);
  asegurarRegistroManual_(sh);
  sh.setColumnWidth(12, 320);
}

/** Tabla de categorias de pagos sin factura (columnas O:P). No pisa si ya existe. */
function crearTablaCategorias_(sh) {
  if (sh.getRange('O1').getValue()) return;
  sh.getRange('O1').setValue('PAGOS SIN FACTURA (palabra → categoría)').setFontWeight('bold').setFontSize(12);
  sh.getRange('O2:P2').setValues([['Palabra o frase (en beneficiario, descripción o Tipo y Nº Doc.)', 'Categoría']])
    .setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true);
  sh.getRange(3, 15, CATEGORIAS_INICIALES_.length, 2).setValues(CATEGORIAS_INICIALES_);
  sh.setColumnWidth(15, 260); sh.setColumnWidth(16, 220);
}

/** Lee la configuracion de la hoja ⚙️ Config. */
function leerConfig_(ss) {
  var sh = ss.getSheetByName(HOJA.CONFIG);
  if (!sh) throw new Error('Falta la hoja ' + HOJA.CONFIG + '. Usa 💼 Cobranzas → ⚙️ Instalar / reparar.');
  // Parámetros agregados después de instalar (ej. ID de Retenciones): se escriben si faltan.
  PARAMETROS_.forEach(function (p) {
    if (!sh.getRange(p[0], 1).getValue()) sh.getRange(p[0], 1, 1, 3).setValues([[p[1], p[2], p[3]]]);
  });
  var v = sh.getRange('B3:B14').getValues().map(function (r) { return r[0]; });
  var anioActual = new Date().getFullYear();
  var anios = String(v[2] || '').split(/[,; ]+/).map(function (x) { return parseInt(x, 10); }).filter(Boolean);
  if (!anios.length) anios = [anioActual - 1, anioActual];

  var ult = Math.max(sh.getLastRow(), 3);
  var emp = sh.getRange(3, 5, ult - 2, 3).getValues().filter(function (r) { return aRuc_(r[0]); });
  var alias = sh.getRange(3, 9, ult - 2, 2).getValues().filter(function (r) { return r[0] && aRuc_(r[1]); });
  var dias = sh.getRange(3, 12, ult - 2, 2).getValues().filter(function (r) { return aRuc_(r[0]) && r[1] !== ''; });

  var cfg = {
    idVouchers: String(v[0] || '').trim(),
    pestanasVouchers: String(v[1] || 'Originales').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    anios: anios,
    diasCredito: Number(v[3]) || 30,
    modo: /SOLO|REFERENC/i.test(String(v[4])) ? 'SOLO REFERENCIADOS' : String(v[4] || 'INTELIGENTE').toUpperCase().trim(),
    tolerancia: v[5] === '' ? 1 : Number(v[5]),
    ventana: Number(v[6]) || 120,
    desde: aFecha_(v[7]),
    tipos: String(v[8] || '01').split(/[,; ]+/).filter(Boolean).map(normTipo_),
    idRetenciones: String(v[9] || '').trim(),
    confirmarManual: !/^NO/i.test(String(v[10] || 'SI').trim()),
    idPadrones: String(v[11] || '').trim(),
    grupo: emp.map(function (r) { return aRuc_(r[0]); }),
    nombreEmpresa: {}, aliasEmpresa: {}, aliasNombre: {}, diasPorRuc: {},
  };
  emp.forEach(function (r) {
    var ruc = aRuc_(r[0]);
    cfg.nombreEmpresa[ruc] = r[1] || r[2] || ruc;
    if (r[1]) cfg.aliasEmpresa[normHeader_(r[1])] = ruc;
    if (r[2]) cfg.aliasEmpresa[normHeader_(r[2])] = ruc;
  });
  alias.forEach(function (r) { cfg.aliasNombre[normNombre_(r[0])] = aRuc_(r[1]); });
  dias.forEach(function (r) { cfg.diasPorRuc[aRuc_(r[0])] = Number(r[1]); });
  // Categorias de pagos sin factura (si la tabla aun no existe se crea con las iniciales)
  crearTablaCategorias_(sh);
  var ultCat = Math.max(sh.getLastRow(), 3);
  cfg.categorias = sh.getRange(3, 15, ultCat - 2, 2).getValues()
    .filter(function (r) { return String(r[0]).trim() && String(r[1]).trim(); })
    .map(function (r) { return { clave: String(r[0]).trim(), categoria: String(r[1]).trim() }; })
    // frases largas primero (ej. "RECIBO POR HONORARIOS" antes que "HONORARIOS")
    .sort(function (a, b) { return b.clave.length - a.clave.length; });
  return cfg;
}
