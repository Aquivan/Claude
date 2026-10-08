/**
 * Util.js
 * Funciones pequeñas compartidas: nombres de hojas, colores, lectura de
 * encabezados por nombre, conversion de numeros y fechas.
 */

var HOJA = {
  PANEL: '🎯 Panel',
  CONSULTA: '🔎 Consulta',
  DOCS: '📋 Documentos',
  MOVS: '💳 Movimientos',
  CONC: '✅ Conciliar',
  MANUAL: '✍️ Registro manual',
  CONFIG: '⚙️ Config',
  DECISIONES: '_Decisiones',
};

var COLOR = {
  OSCURO: '#0F172A', AZUL: '#1E3A5F', TEXTO_SUAVE: '#64748B', BORDE: '#CBD5E1',
  CABECERA: '#E2E8F0', BLANCO: '#FFFFFF',
};

// Fondo de fila segun estado del documento.
var COLOR_ESTADO = {
  '✅ Pagado': '#DCFCE7',
  '🟡 Parcial': '#FEF9C3',
  '⚪ Pendiente': '#F8FAFC',
  '🔴 Vencido': '#FEE2E2',
  '🔴 Parcial vencido': '#FEE2E2',
  '⚠️ Sobrepagado': '#EDE9FE',
  '🟣 Falta detracción': '#F3E8FF',
  '🟣 Falta retención': '#F3E8FF',
};

/** Normaliza un encabezado: minusculas, sin tildes, sin simbolos, un espacio. */
function normHeader_(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[º°ª.]/g, '').replace(/[^a-z0-9()/ ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Devuelve una funcion col(nombre...) que da el indice (0-based) de la
 * PRIMERA columna cuyo encabezado normalizado empieza con alguno de los
 * nombres dados, o -1.
 */
function indiceColumnas_(encabezados) {
  var norm = encabezados.map(normHeader_);
  return function () {
    for (var a = 0; a < arguments.length; a++) {
      var buscado = normHeader_(arguments[a]);
      for (var i = 0; i < norm.length; i++) if (norm[i] === buscado) return i;
    }
    for (var b = 0; b < arguments.length; b++) {
      var pref = normHeader_(arguments[b]);
      for (var j = 0; j < norm.length; j++) if (norm[j] && norm[j].indexOf(pref) === 0) return j;
    }
    return -1;
  };
}

function aNumero_(v) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return 0;
  var s = String(v).replace(/[^\d.,-]/g, '');
  if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) s = s.replace(/,/g, '');
  else if (s.indexOf(',') !== -1) s = s.replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function aFecha_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var m = String(v == null ? '' : v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = String(v == null ? '' : v).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

function aRuc_(v) {
  var s = String(v == null ? '' : v).replace(/\D/g, '');
  return s.length === 11 ? s : (s.length === 8 ? s : '');
}

function fmtFechaClave_(d) {
  return d ? Utilities.formatDate(d, 'America/Lima', 'yyyyMMdd') : '';
}

function hashTexto_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function obtenerOCrearHoja_(ss, nombre) {
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

/** Escribe una tabla (encabezado + filas) desde la fila/col dada con estilo de cabecera. */
function escribirTabla_(sheet, fila, col, encabezado, filas) {
  sheet.getRange(fila, col, 1, encabezado.length).setValues([encabezado])
    .setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL)
    .setVerticalAlignment('middle').setWrap(true);
  if (filas.length) sheet.getRange(fila + 1, col, filas.length, encabezado.length).setValues(filas);
}

/** Borra todo el contenido/formato de una hoja, incluidos filtros y agrupaciones. */
function limpiarHoja_(sheet) {
  var f = sheet.getFilter();
  if (f) f.remove();
  sheet.getBandings().forEach(function (b) { b.remove(); });
  var todo = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns());
  todo.breakApart();
  todo.clearDataValidations();
  sheet.clear();
  sheet.clearConditionalFormatRules();
  if (sheet.getMaxColumns() > 0) sheet.showColumns(1, sheet.getMaxColumns());
}

// ID de la Sheet "Cuentas por Cobrar y Pagar · Grupo" (para cuando el codigo
// corre fuera de la hoja, por ejemplo desde el enlace web).
var ID_HOJA_PRINCIPAL_ = '1o9nD0mwC-x33X5RXShRIn4PWNOWC5o_ehTJoY6G-Ez0';

function ssPrincipal_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(ID_HOJA_PRINCIPAL_);
}
