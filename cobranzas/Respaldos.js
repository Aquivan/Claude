/**
 * Respaldos.js
 * Cuida los datos que usted ingresa a mano:
 *  - Respaldo automático (con fecha y hora) cada vez que cambian: ✍️ Registro
 *    manual, 🔁 Reasignar retenciones, ⚙️ Config y las marcas ✔/✖ de Conciliar.
 *  - Aviso en ✅ Conciliar si desaparecen filas del registro manual o de
 *    reasignaciones (por si se borraron sin querer).
 *  - Las filas con datos piden confirmación de Google antes de editarlas o
 *    borrarlas (protección "solo advertencia"); agregar filas nuevas no pregunta.
 *  - Menú ♻️: guardar un respaldo ahora o restaurar uno (antes de restaurar se
 *    respalda lo actual, así siempre se puede volver atrás).
 */

var HOJA_RESPALDOS_ = '_Respaldos';
var RESPALDOS_POR_HOJA_ = 40;
var PARTE_RESPALDO_ = 45000;  // caracteres por celda (el límite de Sheets es 50 000)
var PROTECCION_DESC_ = '🔒 Datos ingresados a mano';

/** Qué se respalda (función, no variable: los nombres de hoja vienen de otros archivos). */
function hojasRespaldadas_() {
  return [
    { nombre: HOJA.MANUAL, desde: 2, cols: 10, proteger: true, contarBorrados: true },
    { nombre: HOJA_REASIGNAR_, desde: 4, cols: 6, proteger: true, contarBorrados: true },
    { nombre: HOJA.CONFIG, desde: 1, cols: 16 },
    { nombre: HOJA.DECISIONES, desde: 2, cols: 4 },
  ];
}

function bloqueHoja_(sh, def) {
  var ult = sh.getLastRow();
  if (ult < def.desde) return [];
  var v = sh.getRange(def.desde, 1, ult - def.desde + 1, def.cols).getValues();
  while (v.length && v[v.length - 1].join('') === '') v.pop();
  return v;
}

function filasConDatos_(v) { return v.filter(function (r) { return r.join('') !== ''; }).length; }

function serializar_(v) {
  return JSON.stringify(v.map(function (r) {
    return r.map(function (x) { return x instanceof Date ? { $d: x.getTime() } : x; });
  }));
}
function deserializar_(t) {
  return JSON.parse(t).map(function (r) {
    return r.map(function (x) { return x && typeof x === 'object' && x.$d != null ? new Date(x.$d) : x; });
  });
}

function hojaRespaldos_(ss) {
  var sh = ss.getSheetByName(HOJA_RESPALDOS_);
  if (sh) return sh;
  sh = ss.insertSheet(HOJA_RESPALDOS_);
  sh.getRange(1, 1, 1, 9).setValues([['Fecha', 'Hoja', 'Filas con datos', 'Motivo', 'Datos 1', 'Datos 2', 'Datos 3', 'Datos 4', 'Datos 5']])
    .setFontWeight('bold');
  sh.hideSheet();
  return sh;
}

/**
 * Guarda un respaldo de cada hoja manual que cambió desde el último.
 * Devuelve avisos si desaparecieron filas (posible borrado por error).
 */
function respaldarDatosManuales_(ss, motivo, forzar, soloHoja) {
  var props = PropertiesService.getDocumentProperties();
  var shR = null, avisos = [], nuevas = [];
  hojasRespaldadas_().forEach(function (def) {
    if (soloHoja && def.nombre !== soloHoja) return;
    var sh = ss.getSheetByName(def.nombre);
    if (!sh) return;
    var v = bloqueHoja_(sh, def);
    var txt = serializar_(v);
    var hash = hashTexto_(txt);
    var clave = 'resp_' + hashTexto_(def.nombre).slice(0, 8);
    var previo = JSON.parse(props.getProperty(clave) || 'null');
    if (!forzar && previo && previo.hash === hash) return;
    var filas = filasConDatos_(v);
    if (!previo && filas === 0 && !forzar) {  // hoja aún vacía: no guardar respaldos vacíos
      props.setProperty(clave, JSON.stringify({ hash: hash, filas: 0, fecha: '' }));
      return;
    }
    if (def.contarBorrados && previo && filas < previo.filas) {
      avisos.push({ tipo: 'Datos manuales borrados', detalle: 'En ' + def.nombre + ' había ' + previo.filas + ' filas con datos y ahora hay ' + filas +
        '. Si fue un error: 💼 Cobranzas → ♻️ Respaldos → Restaurar (respaldo del ' + previo.fecha + ').', fuente: def.nombre });
    }
    if (txt.length > PARTE_RESPALDO_ * 5) {
      avisos.push({ tipo: 'Respaldo', detalle: def.nombre + ' es muy grande para respaldar en la hoja; no se respaldó.', fuente: def.nombre });
      return;
    }
    var partes = [];
    for (var i = 0; i < 5; i++) partes.push(txt.slice(i * PARTE_RESPALDO_, (i + 1) * PARTE_RESPALDO_));
    var ahora = new Date();
    nuevas.push([ahora, def.nombre, filas, motivo].concat(partes));
    props.setProperty(clave, JSON.stringify({ hash: hash, filas: filas, fecha: Utilities.formatDate(ahora, 'America/Lima', 'dd/MM/yyyy HH:mm') }));
  });
  if (nuevas.length) {
    shR = hojaRespaldos_(ss);
    shR.getRange(shR.getLastRow() + 1, 1, nuevas.length, 9).setValues(nuevas);
    podarRespaldos_(shR);
  }
  return avisos;
}

/** Deja solo los últimos RESPALDOS_POR_HOJA_ de cada hoja. */
function podarRespaldos_(shR) {
  var n = shR.getLastRow() - 1;
  if (n <= RESPALDOS_POR_HOJA_) return;
  var hojas = shR.getRange(2, 2, n, 1).getValues().map(function (r) { return r[0]; });
  var cuenta = {}, borrar = [];
  for (var i = hojas.length - 1; i >= 0; i--) {
    cuenta[hojas[i]] = (cuenta[hojas[i]] || 0) + 1;
    if (cuenta[hojas[i]] > RESPALDOS_POR_HOJA_) borrar.push(i + 2);
  }
  borrar.forEach(function (fila) { shR.deleteRow(fila); });  // de abajo hacia arriba
}

/** Filas con datos: piden confirmación antes de editarlas (solo advertencia). */
function protegerDatosManuales_(ss, activar) {
  hojasRespaldadas_().forEach(function (def) {
    if (!def.proteger) return;
    var sh = ss.getSheetByName(def.nombre);
    if (!sh) return;
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
      if (p.getDescription() === PROTECCION_DESC_) p.remove();
    });
    if (!activar) return;
    var n = bloqueHoja_(sh, def).length;
    if (n < 1) return;
    sh.getRange(def.desde, 1, n, def.cols).protect().setDescription(PROTECCION_DESC_).setWarningOnly(true);
  });
}

/* ------------------------------------------------------------------ menú */

function menuRespaldarAhora() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  respaldarDatosManuales_(ss, 'manual', true);
  ss.toast('Respaldo guardado de: ' + hojasRespaldadas_().map(function (d) { return d.nombre; }).join(', '), '💾 Respaldo', 8);
}

function menuRestaurarRespaldo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var shR = ss.getSheetByName(HOJA_RESPALDOS_);
  if (!shR || shR.getLastRow() < 2) { ui.alert('Todavía no hay respaldos.'); return; }
  var n = shR.getLastRow() - 1;
  var filas = shR.getRange(2, 1, n, 4).getValues().map(function (r, i) { return { fila: i + 2, fecha: r[0], hoja: r[1], filas: r[2], motivo: r[3] }; });
  filas = filas.reverse().slice(0, 25);
  var lista = filas.map(function (f, i) {
    return (i + 1) + ') ' + Utilities.formatDate(new Date(f.fecha), 'America/Lima', 'dd/MM/yyyy HH:mm') + ' · ' + f.hoja + ' · ' + f.filas + ' filas · ' + f.motivo;
  }).join('\n');
  var r = ui.prompt('♻️ Restaurar respaldo', 'Últimos respaldos (el 1 es el más reciente):\n\n' + lista + '\n\nEscriba el número a restaurar:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var k = parseInt(r.getResponseText(), 10);
  if (!(k >= 1 && k <= filas.length)) { ui.alert('Número no válido.'); return; }
  var elegido = filas[k - 1];
  var ok = ui.alert('¿Restaurar ' + elegido.hoja + '?', 'Se reemplazará el contenido actual de "' + elegido.hoja + '" por el respaldo del ' +
    Utilities.formatDate(new Date(elegido.fecha), 'America/Lima', 'dd/MM/yyyy HH:mm') + ' (' + elegido.filas + ' filas).\n\n' +
    'Antes se guarda un respaldo de lo actual, así que podrá volver atrás.', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var def = hojasRespaldadas_().filter(function (d) { return d.nombre === elegido.hoja; })[0];
  var sh = ss.getSheetByName(elegido.hoja);
  if (!def || !sh) { ui.alert('No existe la hoja ' + elegido.hoja + '.'); return; }
  respaldarDatosManuales_(ss, 'antes de restaurar', true, elegido.hoja);
  var txt = shR.getRange(elegido.fila, 5, 1, 5).getValues()[0].join('');
  var v = deserializar_(txt);
  var actual = bloqueHoja_(sh, def).length;
  if (actual) sh.getRange(def.desde, 1, actual, def.cols).clearContent();
  if (v.length) sh.getRange(def.desde, 1, v.length, def.cols).setValues(v);
  respaldarDatosManuales_(ss, 'restaurado', true, elegido.hoja);
  ss.toast('Restaurado. Recalculando…', '♻️ Respaldo', 20);
  ss.toast(actualizarTodo_(true), '💼 Cobranzas', 10);
}
