/**
 * AsistenteIA.js — modulo aparte del sistema de Cobranzas.
 *
 * Todo se ve en la pestaña "🧠 Asistente IA" y NO cambia ningun calculo:
 * el motor de cruce no lee esta pestaña. Hace dos cosas:
 *
 *  1. 💬 Pregúntale a tus datos: escribes una pregunta, marcas la casilla y
 *     la IA responde con un resumen de 📋 Documentos y ✅ Conciliar.
 *  2. 🔗 Facturas sugeridas por IA: para los vouchers SIN CRUZAR que ya
 *     tienen RUC del beneficiario, la IA elige la(s) factura(s) pendientes
 *     que mejor explican el pago (parcial, neto de detraccion/retencion,
 *     varias facturas). Al marcar ✔, se escribe en "Tipo y Nº Doc." del
 *     voucher SOLO si esa celda esta vacia; la siguiente actualizacion de
 *     Cobranzas lo cruza sola.
 *
 * Si la IA falla o se acaba el cupo gratis, Cobranzas sigue igual.
 * Las funciones de la IA (IA_llamar_, etc.) estan en IACliente.js.
 */

var IA_HOJA_ = '🧠 Asistente IA';
// [fila, parametro, valor inicial, ayuda]
var IA_PARAM_ = [
  [3, 'Proveedor de IA', 'Gemini (Google)', 'Para cambiar de IA: elige aquí y guarda su clave (menú 🧠 Asistente IA → 🔑 Guardar clave de IA).'],
  [4, 'Modelo', '', 'Vacío = el recomendado del proveedor.'],
  [5, 'Consultas a la IA por vuelta', 15, 'Bájalo si el plan gratis da error de límite.'],
  [6, 'Estado', '', 'Lo escribe el asistente.'],
];
var IA_F_PREG_ = 9;       // fila de la pregunta
var IA_F_RESP_ = 10;      // fila de la respuesta (B10:K16 combinadas)
var IA_F_TITULO_ = 19;
var IA_F_ENC_ = 20;
var IA_ENC_ = ['✔ Pasar', '✖ Descartar', 'Voucher', 'Fecha', 'Banco', 'N° operación', 'Monto', 'Paga',
  'Beneficiario', 'Doc(s) sugerido(s)', 'Saldo de esos docs', 'Confianza', 'Motivo', 'Estado', 'Clave'];
var IA_C_ = {}; IA_ENC_.forEach(function (n, i) { IA_C_[n] = i; });
var IA_PENDIENTE_ = '🟡 Pendiente';
var IA_RESUMEN_ = 'Dame un resumen ejecutivo: qué empresa del grupo tiene más por cobrar y por pagar, qué clientes están más atrasados, ' +
  'riesgos que debo atender esta semana y qué revisar en conciliación.';

// ---------------- Menu ----------------

function IA_agregarMenu_() {
  SpreadsheetApp.getUi().createMenu('🧠 Asistente IA')
    .addItem('⚙️ Instalar / reparar asistente', 'IA_menuInstalar')
    .addSeparator()
    .addItem('🔗 Buscar facturas con IA ahora', 'IA_menuBuscar')
    .addItem('✅ Pasar marcados ✔ al voucher', 'IA_menuPasar')
    .addItem('📰 Resumen IA de cobranzas', 'IA_menuResumen')
    .addSeparator()

    .addItem('🔑 Guardar clave de IA', 'IA_menuGuardarClave')
    .addItem('🧪 Probar conexión con la IA', 'IA_menuProbar')
    .addSeparator()
    .addItem('⏰ Activar búsqueda automática (cada hora)', 'IA_menuActivar')
    .addItem('⏸ Desactivar búsqueda automática', 'IA_menuDesactivar')
    .addToUi();
}

function IA_menuInstalar() {
  var ss = ssPrincipal_();
  IA_hoja_(ss);
  // Disparador "al editar" instalable: el simple onEdit no puede llamar a la IA.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'IA_alEditar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('IA_alEditar').forSpreadsheet(ss).onEdit().create();
  ss.setActiveSheet(ss.getSheetByName(IA_HOJA_));
  SpreadsheetApp.getUi().alert('Asistente IA listo. Guarda la clave del proveedor (🔑) y prueba la conexión (🧪).');
}

function IA_menuBuscar() {
  var ss = ssPrincipal_();
  ss.toast('Buscando facturas para vouchers sin cruzar…', '🧠 Asistente IA', 30);
  ss.toast(IA_buscarFacturas_(), '🧠 Asistente IA', 10);
}

function IA_menuPasar() {
  var ss = ssPrincipal_();
  if (!IA_tomarTurno_()) { ss.toast('El asistente está trabajando; intenta en un minuto.', '🧠 Asistente IA', 8); return; }
  try {
    var r = IA_aplicarMarcas_(IA_hoja_(ss), leerConfig_(ss));
    ss.toast(r.pasados + ' pasados al voucher, ' + r.descartados + ' descartados' + (r.fallidos ? ', ' + r.fallidos + ' con aviso' : '') +
      '. Cobranzas los cruzará en su próxima actualización.', '🧠 Asistente IA', 10);
  } finally { IA_soltarTurno_(); }
}

function IA_menuResumen() {
  var ss = ssPrincipal_();
  var sh = IA_hoja_(ss);
  sh.getRange(IA_F_PREG_, 2).setValue(IA_RESUMEN_);
  ss.setActiveSheet(sh);
  ss.toast('Preparando resumen…', '🧠 Asistente IA', 20);
  IA_responderPregunta_(ss, sh);
}

function IA_menuGuardarClave() {
  IA_pedirYGuardarClave_(IA_leerParam_(IA_hoja_(ssPrincipal_())).proveedor);
}

function IA_menuProbar() {
  var p = IA_leerParam_(IA_hoja_(ssPrincipal_()));
  var ui = SpreadsheetApp.getUi();
  try { ui.alert(IA_probar_(p.proveedor, p.modelo)); } catch (e) { ui.alert('❌ ' + e.message); }
}

function IA_menuActivar() {
  IA_menuDesactivar(true);
  ScriptApp.newTrigger('IA_vueltaAutomatica').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('Búsqueda automática activada (cada hora). Solo trabaja si Cobranzas se actualizó o hay marcas ✔/✖.');
}

function IA_menuDesactivar(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'IA_vueltaAutomatica') ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getUi().alert('Búsqueda automática desactivada.');
}

function IA_vueltaAutomatica() {
  try {
    var ss = ssPrincipal_();
    var props = PropertiesService.getScriptProperties();
    var ultimaCob = PropertiesService.getDocumentProperties().getProperty('ultimaActualizacion') || '';
    var marcas = IA_hayMarcas_(ss.getSheetByName(IA_HOJA_));
    if (!marcas && ultimaCob === props.getProperty('IA_ULTIMA_COB') && !Number(props.getProperty('IA_QUEDAN') || 0)) return;
    IA_buscarFacturas_();
    props.setProperty('IA_ULTIMA_COB', ultimaCob);
  } catch (e) {
    Logger.log('Asistente IA: ' + e.message);
  }
}

/** Disparador instalable: casilla "Preguntar". */
function IA_alEditar(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== IA_HOJA_ || e.range.getRow() !== IA_F_PREG_ || e.range.getColumn() !== 10) return;
    if (e.range.getValue() !== true) return;
    IA_responderPregunta_(sh.getParent(), sh);
  } catch (err) {
    Logger.log('Asistente IA (pregunta): ' + err.message);
  }
}

// ---------------- Pestaña ----------------

function IA_hoja_(ss) {
  var sh = ss.getSheetByName(IA_HOJA_);
  if (sh) return sh;
  sh = ss.insertSheet(IA_HOJA_);
  sh.getRange('A1').setValue('🧠 ASISTENTE IA · preguntas sobre tus datos y facturas sugeridas para vouchers sin cruzar (no cambia ningún cálculo)')
    .setFontWeight('bold').setFontSize(13).setFontColor(COLOR.AZUL);
  IA_PARAM_.forEach(function (r) { sh.getRange(r[0], 1, 1, 3).setValues([[r[1], r[2], r[3]]]); });
  sh.getRange(3, 1, IA_PARAM_.length, 1).setFontWeight('bold').setWrap(true);
  sh.getRange(3, 2, IA_PARAM_.length - 1, 1).setBackground('#FEF9C3');
  sh.getRange(3, 3, IA_PARAM_.length, 1).setFontColor(COLOR.TEXTO_SUAVE).setFontSize(9);
  sh.getRange('B3').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(IA_nombresProveedores_()).build());

  sh.getRange(8, 1, 1, 11).merge().setValue('💬 PREGÚNTALE A TUS DATOS · escribe la pregunta y marca la casilla "Preguntar"')
    .setFontWeight('bold').setFontColor('#1E40AF').setBackground('#DBEAFE');
  sh.getRange(IA_F_PREG_, 1).setValue('Pregunta').setFontWeight('bold');
  sh.getRange(IA_F_PREG_, 2, 1, 8).merge().setBackground('#FEF9C3').setWrap(true)
    .setValue('¿Qué clientes tienen más deuda vencida y desde cuándo?');
  sh.getRange(IA_F_PREG_, 10).insertCheckboxes();
  sh.getRange(IA_F_PREG_, 11).setValue('← Preguntar').setFontColor(COLOR.TEXTO_SUAVE);
  sh.getRange(IA_F_RESP_, 1).setValue('Respuesta').setFontWeight('bold');
  sh.getRange(IA_F_RESP_, 2, 7, 10).merge().setWrap(true).setVerticalAlignment('top').setBackground('#F8FAFC');
  sh.getRange(17, 2).setValue('Ejemplos: "¿Cuánto me debe <cliente> y qué facturas?", "¿Qué proveedores debo pagar esta semana?", ' +
    '"¿Qué empresa del grupo tiene más vencido?", "¿Por qué hay tantos vouchers sin cruzar?"').setFontColor(COLOR.TEXTO_SUAVE).setFontSize(9);
  sh.setRowHeight(IA_F_PREG_, 40);

  sh.getRange(IA_F_TITULO_, 1, 1, 13).merge()
    .setValue('🔗 FACTURAS SUGERIDAS POR IA para vouchers sin cruzar · marca ✔ y usa "✅ Pasar marcados ✔ al voucher". Solo se llena "Tipo y Nº Doc." si está vacío.')
    .setFontWeight('bold').setFontColor('#92400E').setBackground('#FEF3C7');
  sh.getRange(IA_F_ENC_, 1, 1, IA_ENC_.length).setValues([IA_ENC_])
    .setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  [170, 150, 95, 80, 80, 95, 85, 170, 210, 170, 100, 75, 280, 150, 10].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(IA_ENC_.length);
  return sh;
}

function IA_leerParam_(sh) {
  var v = sh.getRange(3, 2, IA_PARAM_.length, 1).getValues().map(function (r) { return r[0]; });
  var proveedor = String(v[0] || '').trim();
  if (!IA_PROVEEDORES_[proveedor]) proveedor = 'Gemini (Google)';
  return { proveedor: proveedor, modelo: String(v[1] || '').trim(), maxConsultas: Math.max(0, Math.min(60, parseInt(v[2], 10) || 15)) };
}

function IA_leerTabla_(sh) {
  var n = sh.getLastRow() - IA_F_ENC_;
  if (n <= 0) return [];
  return sh.getRange(IA_F_ENC_ + 1, 1, n, IA_ENC_.length).getValues().map(function (r, i) {
    return { fila: IA_F_ENC_ + 1 + i, valores: r, clave: String(r[IA_C_['Clave']] || ''), estado: String(r[IA_C_['Estado']] || '') };
  }).filter(function (t) { return t.clave; });
}

function IA_hayMarcas_(sh) {
  if (!sh) return false;
  return IA_leerTabla_(sh).some(function (t) {
    return (t.valores[0] === true || t.valores[1] === true) && (t.estado === IA_PENDIENTE_ || t.estado.indexOf('⚠️') === 0);
  });
}

// ---------------- 🔗 Facturas sugeridas ----------------

function IA_buscarFacturas_() {
  if (!IA_tomarTurno_()) return 'El asistente ya está trabajando; intenta en un minuto.';
  var ss = ssPrincipal_();
  var sh = IA_hoja_(ss);
  var t0 = Date.now();
  try {
    var p = IA_leerParam_(sh);
    var cfg = leerConfig_(ss);
    var marcas = IA_aplicarMarcas_(sh, cfg);
    var sinCruzar = IA_leerSinCruzar_(ss);
    var docs = IA_leerDocsPendientes_(ss, cfg);
    var pagos = leerVouchers_(cfg).pagos.filter(function (pg) { return sinCruzar[pg.fuente]; });

    var ya = {};
    IA_leerTabla_(sh).forEach(function (t) { ya[t.clave] = t; });
    var porRevisar = pagos.filter(function (pg) { return !ya[pg.id]; })
      .sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });

    var nuevas = [], consultas = 0, sinRuc = 0, sinDocs = 0, errores = 0, ultimoError = '';
    var prov = IA_PROVEEDORES_[p.proveedor];
    for (var i = 0; i < porRevisar.length && consultas < p.maxConsultas; i++) {
      if (Date.now() - t0 > 270000) break;
      var pg = porRevisar[i];
      if (!pg.beneficiarioRuc) { sinRuc++; continue; }
      var cands = IA_candidatos_(pg, docs);
      if (!cands.length) { sinDocs++; continue; }
      if (consultas > 0) Utilities.sleep(prov.pausa);
      consultas++;
      try {
        nuevas.push(IA_filaFacturas_(pg, IA_elegirFacturas_(pg, cands, sinCruzar[pg.fuente], p), cfg));
      } catch (e) {
        errores++; ultimoError = e.message;
        if (/clave|desconocido|40[013]/i.test(e.message)) break;
      }
    }
    IA_escribirFilas_(sh, nuevas, cfg);

    var quedan = porRevisar.length - nuevas.length - sinRuc - sinDocs;
    var msg = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' · ' + nuevas.length + ' sugerencias nuevas, ' +
      Math.max(0, quedan) + ' por revisar en la próxima vuelta' +
      (marcas.pasados ? ', ' + marcas.pasados + ' pasados al voucher' : '') +
      (sinRuc ? ' · ' + sinRuc + ' sin RUC beneficiario (complétalos con el Asistente IA de la hoja Vouchers)' : '') +
      (sinDocs ? ' · ' + sinDocs + ' sin facturas pendientes de ese beneficiario' : '') +
      (errores ? ' · ' + errores + ' errores de IA (último: ' + ultimoError.substring(0, 160) + ')' : '');
    sh.getRange(6, 2).setValue(msg);
    PropertiesService.getScriptProperties().setProperty('IA_QUEDAN', String(errores && !nuevas.length ? 0 : Math.max(0, quedan)));
    return msg;
  } catch (e) {
    try { sh.getRange(6, 2).setValue('❌ ' + e.message); } catch (e2) { /* nada */ }
    throw e;
  } finally {
    IA_soltarTurno_();
  }
}

/** Fuente ("Pestaña!fila") → motivo, de la seccion "⚪ VOUCHERS SIN CRUZAR" de ✅ Conciliar. */
function IA_leerSinCruzar_(ss) {
  var res = {};
  var sh = ss.getSheetByName(HOJA.CONC);
  if (!sh || sh.getLastRow() < 2) return res;
  var datos = sh.getRange(1, 1, sh.getLastRow(), 13).getValues();
  var i = 0;
  while (i < datos.length && String(datos[i][0]).indexOf('⚪ VOUCHERS SIN CRUZAR') !== 0) i++;
  if (i >= datos.length - 1) return res;
  var col = indiceColumnas_(datos[i + 1]);
  var cF = col('Fuente'), cM = col('Motivo');
  for (var j = i + 2; j < datos.length && datos[j][cF]; j++) res[String(datos[j][cF])] = String(datos[j][cM] || '');
  return res;
}

/** Documentos con saldo, indexados por RUC emisor (a quien se le paga). */
function IA_leerDocsPendientes_(ss, cfg) {
  var porEmisor = {};
  var sh = ss.getSheetByName(HOJA.DOCS);
  if (!sh || sh.getLastRow() < 2) return porEmisor;
  var datos = sh.getRange(1, 1, sh.getLastRow(), ENC_DOCS_.length).getValues();
  var I = {}; ENC_DOCS_.forEach(function (n, k) { I[n] = k; });
  var rucDeNombre = {};
  Object.keys(cfg.nombreEmpresa).forEach(function (ruc) { rucDeNombre[normHeader_(cfg.nombreEmpresa[ruc])] = ruc; });
  var vistos = {};
  for (var i = 1; i < datos.length; i++) {
    var r = datos[i];
    var saldo = aNumero_(r[I['Saldo']]);
    var clave = String(r[I['Clave']] || '');
    if (saldo <= 0.5 || !clave || vistos[clave]) continue;
    vistos[clave] = 1;
    var emisor = clave.split('|')[0];
    var receptor = r[I['Tipo']] === 'Por cobrar' ? String(r[I['RUC contraparte']]) : (rucDeNombre[normHeader_(r[I['Empresa']])] || cfg.aliasEmpresa[normHeader_(r[I['Empresa']])] || '');
    (porEmisor[emisor] = porEmisor[emisor] || []).push({
      doc: String(r[I['Documento']]), saldo: saldo, total: aNumero_(r[I['Total']]), moneda: String(r[I['Moneda']] || ''),
      emision: aFecha_(r[I['Emisión']]), vence: aFecha_(r[I['Vence']]), receptor: receptor, estado: String(r[I['Estado']] || ''),
      detraccion: aNumero_(r[I['Detracción']]), retencion: aNumero_(r[I['Retención']]), clave: clave,
    });
  }
  return porEmisor;
}

/** Hasta 25 facturas del beneficiario (y de quien paga, si se sabe), las mas cercanas al monto. */
function IA_candidatos_(pg, docs) {
  var lista = (docs[pg.beneficiarioRuc] || []).filter(function (d) {
    if (pg.pagadorRuc && d.receptor && d.receptor !== pg.pagadorRuc) return false;
    if (pg.fecha && d.emision && d.emision.getTime() > pg.fecha.getTime() + 5 * 86400000) return false;
    return true;
  });
  // Primero las de la misma moneda del voucher, luego las de saldo mas cercano al monto.
  function clave(d) { return (d.moneda && pg.moneda && d.moneda !== pg.moneda ? 1e12 : 0) + Math.abs(d.saldo - pg.monto); }
  return lista.sort(function (a, b) { return clave(a) - clave(b); }).slice(0, 25);
}

var IA_SISTEMA_FACT_ = [
  'Eres un asistente contable en Perú que concilia pagos con facturas. Te doy un voucher bancario y la lista de',
  'facturas pendientes del beneficiario. Elige la(s) factura(s) que este pago cancela o abona.',
  'Considera: pago exacto del saldo; pago neto de detracción (4%, 10% o 12% del total, depositada aparte);',
  'neto de retención (3%); suma de varias facturas; pago parcial (abono) de una factura; diferencias por redondeo',
  'o comisiones bancarias pequeñas. Prefiere facturas más antiguas y fechas coherentes con el pago.',
  'Si la moneda del voucher y de la factura difieren, solo elígela si el monto calza con un tipo de cambio razonable (3.3 a 4.0 soles por dólar).',
  'Usa EXACTAMENTE los códigos de documento de la lista. Si no hay una explicación razonable, devuelve lista vacía.',
  'Responde SOLO JSON: {"documentos":[],"tipo":"exacto|neto detraccion|neto retencion|varias|parcial|ninguno","confianza":0,"motivo":""}',
  '"confianza" 0-100; "motivo" máximo 25 palabras en español, menciona el cálculo (ej. 1,180 - 12% = 1,038.40).',
].join('\n');

function IA_elegirFacturas_(pg, cands, motivoMotor, p) {
  var texto = [
    'VOUCHER: fecha ' + IA_fmtFecha_(pg.fecha) + ' | banco ' + pg.banco + ' | operación ' + pg.operacion +
      ' | monto ' + pg.monto.toFixed(2) + ' ' + pg.moneda,
    'Beneficiario: ' + (pg.beneficiarioNombre || '') + ' (' + pg.beneficiarioRuc + ') | Paga: ' + (pg.pagadorRuc || '¿?'),
    'Glosa: ' + (pg.descripcion || '(vacía)') + ' | Referencia escrita: ' + (pg.refs || '(vacía)'),
    'Por qué el sistema no lo cruzó: ' + (motivoMotor || '¿?'),
    '',
    'FACTURAS PENDIENTES (documento | emisión | vence | total | saldo | moneda | estado):',
    cands.map(function (d) {
      return d.doc + ' | ' + IA_fmtFecha_(d.emision) + ' | ' + IA_fmtFecha_(d.vence) + ' | ' + d.total.toFixed(2) + ' | ' +
        d.saldo.toFixed(2) + ' | ' + d.moneda + ' | ' + d.estado;
    }).join('\n'),
  ].join('\n');
  var r = IA_llamar_({ proveedor: p.proveedor, modelo: p.modelo, sistema: IA_SISTEMA_FACT_, texto: texto });
  var validos = (Array.isArray(r.documentos) ? r.documentos : []).map(String).filter(function (x) {
    return cands.some(function (d) { return d.doc === x; });
  });
  var elegidos = cands.filter(function (d) { return validos.indexOf(d.doc) !== -1; });
  return {
    docs: elegidos, confianza: validos.length ? Math.max(0, Math.min(100, parseInt(r.confianza, 10) || 0)) : 0,
    motivo: (r.tipo && r.tipo !== 'ninguno' ? '[' + r.tipo + '] ' : '') + String(r.motivo || '').substring(0, 300),
  };
}

function IA_filaFacturas_(pg, s, cfg) {
  var f = new Array(IA_ENC_.length);
  f[IA_C_['✔ Pasar']] = false; f[IA_C_['✖ Descartar']] = false;
  f[IA_C_['Voucher']] = pg.fuente; f[IA_C_['Fecha']] = pg.fecha || ''; f[IA_C_['Banco']] = pg.banco;
  f[IA_C_['N° operación']] = pg.operacion; f[IA_C_['Monto']] = pg.monto;
  f[IA_C_['Paga']] = pg.pagadorRuc ? nombreEmpresa_(cfg, pg.pagadorRuc, pg.pagadorRuc) : '¿?';
  f[IA_C_['Beneficiario']] = (pg.beneficiarioNombre || nombreEmpresa_(cfg, pg.beneficiarioRuc, '')) + ' (' + pg.beneficiarioRuc + ')';
  f[IA_C_['Doc(s) sugerido(s)']] = s.docs.map(function (d) { return d.doc; }).join(',');
  f[IA_C_['Saldo de esos docs']] = s.docs.reduce(function (t, d) { return t + d.saldo; }, 0);
  f[IA_C_['Confianza']] = s.confianza / 100; f[IA_C_['Motivo']] = s.motivo;
  f[IA_C_['Estado']] = s.docs.length ? IA_PENDIENTE_ : '❔ Sin sugerencia';
  f[IA_C_['Clave']] = pg.id;
  return f;
}

function IA_escribirFilas_(sh, filas, cfg) {
  if (!filas.length) return;
  var desde = Math.max(sh.getLastRow(), IA_F_ENC_) + 1;
  var n = filas.length;
  sh.getRange(desde, 1, n, IA_ENC_.length).setValues(filas);
  sh.getRange(desde, 1, n, 2).insertCheckboxes();
  sh.getRange(desde, IA_C_['Fecha'] + 1, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(desde, IA_C_['Monto'] + 1, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(desde, IA_C_['Saldo de esos docs'] + 1, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(desde, IA_C_['Confianza'] + 1, n, 1).setNumberFormat('0%');
  sh.getRange(desde, IA_C_['N° operación'] + 1, n, 1).setNumberFormat('@');
  // Enlace directo a la fila del voucher en la hoja de Vouchers.
  try {
    var ssV = SpreadsheetApp.openById(cfg.idVouchers);
    var gids = {};
    var enlaces = filas.map(function (f) {
      var fuente = String(f[IA_C_['Voucher']]);
      var partes = fuente.split('!');
      if (!(partes[0] in gids)) { var hv = ssV.getSheetByName(partes[0]); gids[partes[0]] = hv ? hv.getSheetId() : null; }
      var b = SpreadsheetApp.newRichTextValue().setText(fuente);
      if (gids[partes[0]] != null) b.setLinkUrl('https://docs.google.com/spreadsheets/d/' + cfg.idVouchers + '/edit#gid=' + gids[partes[0]] + '&range=A' + partes[1]);
      return [b.build()];
    });
    sh.getRange(desde, IA_C_['Voucher'] + 1, n, 1).setRichTextValues(enlaces);
  } catch (e) { /* sin enlace: queda el texto */ }
  sh.getRange(desde, 1, n, IA_ENC_.length).setFontSize(9).setVerticalAlignment('middle');
}

// ---------------- Pasar al voucher ----------------

function IA_aplicarMarcas_(sh, cfg) {
  var res = { pasados: 0, descartados: 0, fallidos: 0 };
  var tabla = IA_leerTabla_(sh).filter(function (t) {
    var ok = t.valores[0] === true, no = t.valores[1] === true;
    return (ok || no) && (t.estado === IA_PENDIENTE_ || t.estado.indexOf('⚠️') === 0);
  });
  if (!tabla.length) return res;
  var ssV = null, cols = {};
  tabla.forEach(function (t) {
    var celdaEstado = sh.getRange(t.fila, IA_C_['Estado'] + 1);
    if (t.valores[1] === true) { celdaEstado.setValue('✖ Descartado'); res.descartados++; return; }
    var r;
    try {
      ssV = ssV || SpreadsheetApp.openById(cfg.idVouchers);
      r = IA_pasarDocs_(ssV, cols, String(t.valores[IA_C_['Voucher']]), t.clave, String(t.valores[IA_C_['Doc(s) sugerido(s)']] || '').trim());
    } catch (e) {
      r = '⚠️ ' + e.message;
    }
    celdaEstado.setValue(r);
    if (r.indexOf('✅') === 0) res.pasados++; else if (r.indexOf('⚠️') === 0) res.fallidos++;
  });
  return res;
}

/** Escribe los documentos en "Tipo y Nº Doc." del voucher, solo si esta vacia. */
function IA_pasarDocs_(ssV, cols, fuente, idPago, docs) {
  if (!docs) return '⚠️ Sin documentos: escribe alguno o marca ✖';
  var partes = fuente.split('!');
  var sh = ssV.getSheetByName(partes[0]);
  if (!sh) return '⚠️ No existe la pestaña ' + partes[0];
  if (!cols[partes[0]]) {
    var col = indiceColumnas_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    cols[partes[0]] = { op: col('Numero de oper', 'Numero de operacion'), monto: col('Monto'), refs: col('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc') };
  }
  var c = cols[partes[0]];
  if (c.refs < 0) return '⚠️ La pestaña ' + partes[0] + ' no tiene columna "Tipo y Nº Doc."';
  // id del pago = BANCO|operacion|yyyymmdd|monto: verificar que la fila siga siendo ese voucher.
  var id = idPago.split('|'), op = id[1], monto = Number(id[3]);
  var fila = parseInt(partes[1], 10);
  function coincide(f) {
    return String(sh.getRange(f, c.op + 1).getValue()).trim() === op && Math.abs(aNumero_(sh.getRange(f, c.monto + 1).getValue()) - monto) < 0.005;
  }
  if (!(fila >= 2 && fila <= sh.getLastRow() && coincide(fila))) {
    var n = sh.getLastRow() - 1, ops = sh.getRange(2, c.op + 1, n, 1).getValues(), montos = sh.getRange(2, c.monto + 1, n, 1).getValues();
    var hall = [];
    for (var i = 0; i < n; i++) if (String(ops[i][0]).trim() === op && Math.abs(aNumero_(montos[i][0]) - monto) < 0.005) hall.push(i + 2);
    if (hall.length !== 1) return '⚠️ No se encontró el voucher (¿se borró o cambió?)';
    fila = hall[0];
  }
  var celda = sh.getRange(fila, c.refs + 1);
  if (String(celda.getValue()).trim() !== '') return '✔ El voucher ya tenía documento';
  celda.setValue(docs);
  return '✅ Pasado ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm');
}

// ---------------- 💬 Pregúntale a tus datos ----------------

var IA_SISTEMA_PREG_ = [
  'Eres un analista financiero de cuentas por cobrar y por pagar de un grupo de empresas en Perú.',
  'Responde en español, claro y breve (máximo 250 palabras), con cifras concretas y viñetas cuando ayuden.',
  'Usa SOLO los datos que te doy. Si los datos no alcanzan para responder, dilo y sugiere dónde mirar en la hoja.',
  'Montos en soles (S/) salvo que se indique USD. No inventes nombres ni cifras.',
].join('\n');

function IA_responderPregunta_(ss, sh) {
  var celdaResp = sh.getRange(IA_F_RESP_, 2);
  var pregunta = String(sh.getRange(IA_F_PREG_, 2).getValue() || '').trim();
  try {
    if (!pregunta) { celdaResp.setValue('Escribe una pregunta en la celda amarilla.'); return; }
    celdaResp.setValue('⏳ Pensando…');
    SpreadsheetApp.flush();
    var p = IA_leerParam_(sh);
    var texto = IA_contextoDatos_(ss, pregunta) + '\n\nPREGUNTA: ' + pregunta;
    var r = IA_llamar_({ proveedor: p.proveedor, modelo: p.modelo, sistema: IA_SISTEMA_PREG_, texto: texto, json: false, maxTokens: 2000 });
    celdaResp.setValue(r + '\n\n— ' + p.proveedor + ', ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'));
  } catch (e) {
    celdaResp.setValue('❌ ' + e.message);
  } finally {
    sh.getRange(IA_F_PREG_, 10).setValue(false);
  }
}

/** Resumen compacto de los datos para la IA (no se manda la hoja completa). */
function IA_contextoDatos_(ss, pregunta) {
  var hoy = new Date();
  var lineas = ['FECHA DE HOY: ' + IA_fmtFecha_(hoy)];
  var sh = ss.getSheetByName(HOJA.DOCS);
  if (sh && sh.getLastRow() > 1) {
    var datos = sh.getRange(2, 1, sh.getLastRow() - 1, ENC_DOCS_.length).getValues();
    var I = {}; ENC_DOCS_.forEach(function (n, k) { I[n] = k; });
    var porEmp = {}, porCp = {}, mencionados = [];
    var pregNorm = normNombre_(pregunta);
    datos.forEach(function (r) {
      var saldo = aNumero_(r[I['Saldo']]);
      if (Math.abs(saldo) < 0.5) return;
      var dias = aNumero_(r[I['Días vencido']]);
      var mon = String(r[I['Moneda']] || 'PEN');
      var kE = r[I['Empresa']] + ' | ' + r[I['Tipo']] + ' | ' + mon;
      var e = porEmp[kE] = porEmp[kE] || { n: 0, saldo: 0, vencido: 0, v90: 0 };
      e.n++; e.saldo += saldo;
      if (dias > 0) e.vencido += saldo;
      if (dias > 90) e.v90 += saldo;
      var kC = r[I['Tipo']] + ' | ' + r[I['Empresa']] + ' | ' + r[I['Contraparte']] + ' (' + r[I['RUC contraparte']] + ') | ' + mon;
      var c = porCp[kC] = porCp[kC] || { tipo: r[I['Tipo']], n: 0, saldo: 0, vencido: 0, maxDias: 0, docs: [] };
      c.n++; c.saldo += saldo;
      if (dias > 0) c.vencido += saldo;
      c.maxDias = Math.max(c.maxDias, dias);
      c.docs.push(r[I['Documento']] + ' ' + IA_fmtFecha_(aFecha_(r[I['Emisión']])) + ' saldo ' + saldo.toFixed(2) + (dias > 0 ? ' (' + dias + ' d venc.)' : ''));
      var cpNorm = normNombre_(r[I['Contraparte']]);
      if (cpNorm && cpNorm.length >= 4 && pregNorm.indexOf(cpNorm.split(' ')[0]) !== -1 && mencionados.indexOf(kC) === -1) mencionados.push(kC);
    });
    lineas.push('', 'SALDOS POR EMPRESA (empresa | tipo | moneda: docs con saldo, saldo, vencido, vencido >90 días):');
    Object.keys(porEmp).sort().forEach(function (k) {
      var e = porEmp[k];
      lineas.push(k + ': ' + e.n + ' docs, ' + e.saldo.toFixed(2) + ', venc. ' + e.vencido.toFixed(2) + ', >90d ' + e.v90.toFixed(2));
    });
    ['Por cobrar', 'Por pagar'].forEach(function (tipo) {
      var top = Object.keys(porCp).filter(function (k) { return porCp[k].tipo === tipo; })
        .sort(function (a, b) { return porCp[b].saldo - porCp[a].saldo; }).slice(0, 30);
      lineas.push('', 'TOP 30 ' + tipo.toUpperCase() + ' (tipo | empresa | contraparte | moneda: docs, saldo, vencido, máx. días vencido):');
      top.forEach(function (k) {
        var c = porCp[k];
        lineas.push(k + ': ' + c.n + ' docs, ' + c.saldo.toFixed(2) + ', venc. ' + c.vencido.toFixed(2) + ', ' + c.maxDias + ' d');
      });
    });
    if (mencionados.length) {
      lineas.push('', 'DETALLE DE LAS CONTRAPARTES MENCIONADAS EN LA PREGUNTA:');
      mencionados.slice(0, 5).forEach(function (k) { lineas.push(k + ':'); porCp[k].docs.slice(0, 40).forEach(function (d) { lineas.push('  ' + d); }); });
    }
  } else {
    lineas.push('(La hoja 📋 Documentos está vacía: primero actualiza Cobranzas.)');
  }
  var conc = ss.getSheetByName(HOJA.CONC);
  if (conc && conc.getLastRow() > 1) {
    lineas.push('', 'CONCILIACIÓN (títulos de la hoja ✅ Conciliar):');
    conc.getRange(1, 1, conc.getLastRow(), 1).getValues().forEach(function (r) {
      var t = String(r[0] || '');
      if (/^(🟡|⚠️|⚪)/.test(t)) lineas.push(t);
    });
  }
  return lineas.join('\n');
}
