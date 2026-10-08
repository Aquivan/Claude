// ============================================================
// ASISTENTE IA (modulo aparte) — sugiere el ID Beneficiario (RUC) y,
// cuando se puede, la factura de los vouchers que aun no lo tienen.
// ------------------------------------------------------------
// - Todo se ve en la pestaña "🧠 Asistente IA" de esta misma hoja.
// - SOLO LEE las pestañas de vouchers y (si hay acceso) la hoja de
//   Cobranzas. Lo unico que escribe fuera de su pestaña es, cuando tu
//   marcas ✔, el ID Beneficiario / Tipo y Nº Doc del voucher, y SOLO si
//   esa celda esta vacia (nunca sobrescribe).
// - No usa el candado (LockService) del bot de Telegram: nunca lo frena.
// - Si la IA falla o se acaba el cupo gratis, no pasa nada: reintenta en
//   la siguiente vuelta. El resto del sistema no depende de este modulo.
// - Primero busca en lo que ya conoce (vouchers ya llenados, SIRE, alias
//   de Cobranzas). Solo consulta a la IA cuando no hay coincidencia exacta.
// ============================================================

var IA_HOJA_ = '🧠 Asistente IA';
var IA_ID_COBRANZAS_ = '1o9nD0mwC-x33X5RXShRIn4PWNOWC5o_ehTJoY6G-Ez0';

// [fila, parametro, valor inicial, ayuda]
var IA_PARAM_ = [
  [3, 'Proveedor de IA', 'Gemini (Google)', 'Gemini usa la misma clave del bot. Otro proveedor: menú 🧠 Asistente IA → 🔑 Guardar clave de IA.'],
  [4, 'Modelo', '', 'Vacío = el recomendado del proveedor.'],
  [5, 'Leer la foto si el voucher no trae nombre', 'Sí', 'Solo con proveedores que leen imágenes (Gemini, Qwen, ChatGPT, OpenRouter).'],
  [6, 'Consultas a la IA por vuelta', 10, 'Bájalo si el plan gratis da error de límite.'],
  [7, 'Revisar vouchers desde', '', 'Fecha dd/mm/aaaa. Vacío = todos.'],
  [8, 'Pestañas de vouchers', 'Originales,Fotos', 'Separadas por coma.'],
  [9, 'ID hoja Cobranzas (facturas SIRE)', IA_ID_COBRANZAS_, 'Solo se lee. Vacío = no usar SIRE.'],
  [10, 'Estado', '', 'Lo escribe el asistente.'],
];
var IA_FILA_TITULO_ = 12;
var IA_FILA_ENC_ = 13;
var IA_ENC_ = ['✔ Pasar', '✖ Descartar', 'Voucher', 'Fecha', 'Banco', 'N° operación', 'Monto',
  'Beneficiario (según voucher)', 'RUC sugerido', 'Nombre sugerido', 'Doc(s) sugerido(s)', 'Confianza',
  'Cómo se obtuvo', 'Motivo', 'Estado', 'Clave'];
var IA_C_ = {}; IA_ENC_.forEach(function (n, i) { IA_C_[n] = i; });
var IA_PENDIENTE_ = '🟡 Pendiente';

// ---------------- Menu ----------------

function IA_agregarMenu_() {
  SpreadsheetApp.getUi().createMenu('🧠 Asistente IA')
    .addItem('▶ Sugerir ahora', 'IA_menuSugerir')
    .addItem('✅ Pasar marcados ✔ al voucher', 'IA_menuPasar')
    .addSeparator()
    .addItem('🔑 Guardar clave de IA', 'IA_menuGuardarClave')
    .addItem('🧪 Probar conexión con la IA', 'IA_menuProbar')
    .addSeparator()
    .addItem('⏰ Activar automático (cada 30 min)', 'IA_menuActivar')
    .addItem('⏸ Desactivar automático', 'IA_menuDesactivar')
    .addToUi();
}

function IA_menuSugerir() {
  var ss = IA_ss_();
  ss.toast('Buscando vouchers sin ID Beneficiario…', '🧠 Asistente IA', 30);
  ss.toast(IA_vuelta_(true), '🧠 Asistente IA', 10);
}

function IA_menuPasar() {
  var ss = IA_ss_();
  if (!IA_tomarTurno_()) { ss.toast('El asistente está trabajando; intenta en un minuto.', '🧠 Asistente IA', 8); return; }
  try {
    var r = IA_aplicarMarcas_(ss, IA_hoja_(ss));
    ss.toast(r.pasados + ' pasados al voucher, ' + r.descartados + ' descartados' + (r.fallidos ? ', ' + r.fallidos + ' con aviso' : '') + '.', '🧠 Asistente IA', 10);
  } finally { IA_soltarTurno_(); }
}

function IA_menuGuardarClave() {
  IA_pedirYGuardarClave_(IA_leerParam_(IA_hoja_(IA_ss_())).proveedor);
}

function IA_menuProbar() {
  var p = IA_leerParam_(IA_hoja_(IA_ss_()));
  var ui = SpreadsheetApp.getUi();
  try { ui.alert(IA_probar_(p.proveedor, p.modelo)); } catch (e) { ui.alert('❌ ' + e.message); }
}

function IA_menuActivar() {
  IA_menuDesactivar(true);
  ScriptApp.newTrigger('IA_vueltaAutomatica').timeBased().everyMinutes(30).create();
  IA_hoja_(IA_ss_());
  SpreadsheetApp.getUi().alert('Asistente IA automático activado (cada 30 min). Solo trabaja si hay vouchers nuevos o marcas ✔/✖.');
}

function IA_menuDesactivar(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'IA_vueltaAutomatica') ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getUi().alert('Asistente IA automático desactivado.');
}

function IA_vueltaAutomatica() {
  try {
    var ss = IA_ss_();
    var props = PropertiesService.getScriptProperties();
    var mod = DriveApp.getFileById(ss.getId()).getLastUpdated().getTime();
    var antes = Number(props.getProperty('IA_ULTIMA_MOD') || 0);
    var quedan = Number(props.getProperty('IA_QUEDAN') || 0);
    if (mod <= antes && !quedan) return;
    IA_vuelta_(false);
  } catch (e) {
    Logger.log('Asistente IA: ' + e.message);
  }
}

// ---------------- Vuelta principal ----------------

function IA_ss_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
}

function IA_vuelta_(manual) {
  if (!IA_tomarTurno_()) return 'El asistente ya está trabajando; intenta en un minuto.';
  var ss = IA_ss_();
  var sh = IA_hoja_(ss);
  var t0 = Date.now();
  try {
    var p = IA_leerParam_(sh);
    var marcas = IA_aplicarMarcas_(ss, sh);
    var vch = IA_leerVouchersIA_(ss, p.pestanas);
    var cob = IA_leerCobranzas_(p.idCobranzas);
    var dir = IA_directorio_(vch.filas, cob);

    // Filas que ya estan en la tabla (no se vuelven a consultar).
    var tabla = IA_leerTabla_(sh);
    var porClave = {};
    tabla.forEach(function (t) { porClave[t.clave] = t; });

    // Pendientes que el usuario ya completo a mano en el voucher.
    var completadas = 0;
    vch.filas.forEach(function (v) {
      var t = porClave[v.clave];
      if (t && t.estado === IA_PENDIENTE_ && IA_rucValido_(v.idBenef)) {
        sh.getRange(t.fila, IA_C_['Estado'] + 1).setValue('✔ Ya completado en voucher');
        completadas++;
      }
    });

    var porRevisar = vch.filas.filter(function (v) {
      return v.monto > 0 && !IA_rucValido_(v.idBenef) && !porClave[v.clave] && (!p.desde || !v.fecha || v.fecha >= p.desde);
    }).sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });

    var nuevas = [], consultas = 0, errores = 0, ultimoError = '';
    var prov = IA_PROVEEDORES_[p.proveedor];
    for (var i = 0; i < porRevisar.length; i++) {
      if (Date.now() - t0 > 270000) break;
      var v = porRevisar[i];
      var sug = IA_sugerirDirectorio_(v, dir, cob);
      if (!sug) {
        if (consultas >= p.maxConsultas) continue;
        if (consultas > 0) Utilities.sleep(prov ? prov.pausa : 2000);
        consultas++;
        try {
          sug = IA_sugerirConIA_(v, dir, cob, p);
        } catch (e) {
          errores++; ultimoError = e.message;
          if (/clave|desconocido|40[013]/i.test(e.message)) break; // sin clave o modelo mal escrito: no insistir
          continue;
        }
      }
      nuevas.push(IA_filaTabla_(v, sug));
    }
    IA_escribirFilas_(ss, sh, nuevas, vch.hojas);

    var quedan = porRevisar.length - nuevas.length;
    var msg = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' · ' + nuevas.length + ' sugerencias nuevas (' +
      consultas + ' consultas a la IA), ' + quedan + ' por revisar en la próxima vuelta' +
      (marcas.pasados ? ', ' + marcas.pasados + ' pasados al voucher' : '') +
      (completadas ? ', ' + completadas + ' ya completados a mano' : '') +
      (cob.error ? ' · Cobranzas no disponible: ' + cob.error : '') +
      (vch.sinColumna.length ? ' · Sin columna ID Beneficiario en: ' + vch.sinColumna.join(', ') : '') +
      (errores ? ' · ' + errores + ' errores de IA (último: ' + ultimoError.substring(0, 160) + ')' : '');
    sh.getRange(10, 2).setValue(msg);
    SpreadsheetApp.flush();
    var props = PropertiesService.getScriptProperties();
    props.setProperty('IA_QUEDAN', String(errores && !nuevas.length ? 0 : quedan));
    props.setProperty('IA_ULTIMA_MOD', String(DriveApp.getFileById(ss.getId()).getLastUpdated().getTime()));
    return msg;
  } catch (e) {
    try { sh.getRange(10, 2).setValue('❌ ' + e.message); } catch (e2) { /* nada */ }
    throw e;
  } finally {
    IA_soltarTurno_();
  }
}

// ---------------- Pestaña y parametros ----------------

function IA_hoja_(ss) {
  var sh = ss.getSheetByName(IA_HOJA_);
  if (sh) return sh;
  sh = ss.insertSheet(IA_HOJA_);
  sh.getRange('A1').setValue('🧠 ASISTENTE IA · sugiere el ID Beneficiario y la factura de los vouchers que no lo tienen')
    .setFontWeight('bold').setFontSize(13).setFontColor('#1E3A5F');
  IA_PARAM_.forEach(function (r) { sh.getRange(r[0], 1, 1, 3).setValues([[r[1], r[2], r[3]]]); });
  sh.getRange(3, 1, IA_PARAM_.length, 1).setFontWeight('bold');
  sh.getRange(3, 2, IA_PARAM_.length - 1, 1).setBackground('#FEF9C3');
  sh.getRange(3, 3, IA_PARAM_.length, 1).setFontColor('#64748B').setFontSize(9);
  sh.getRange('B3').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(IA_nombresProveedores_()).build());
  sh.getRange('B5').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No']).build());
  sh.getRange('B7').setNumberFormat('dd/mm/yyyy');
  sh.getRange('B9').setNumberFormat('@');
  sh.getRange(IA_FILA_TITULO_, 1).setValue('SUGERENCIAS · marca ✔ y usa el menú "✅ Pasar marcados ✔ al voucher" (o espera la vuelta automática). Solo se llenan celdas vacías del voucher. Puedes corregir el RUC o los documentos antes de marcar ✔.')
    .setFontWeight('bold').setFontColor('#92400E');
  sh.getRange(IA_FILA_ENC_, 1, 1, IA_ENC_.length).setValues([IA_ENC_])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1E3A5F').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(IA_FILA_ENC_);
  // Columnas A-B tambien llevan los parametros de arriba: anchos de compromiso.
  [170, 150, 95, 80, 80, 95, 85, 220, 100, 220, 160, 75, 110, 260, 150, 10].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(3, 1, IA_PARAM_.length, 1).setWrap(true);
  sh.hideColumns(IA_ENC_.length);
  return sh;
}

function IA_leerParam_(sh) {
  var v = sh.getRange(3, 2, IA_PARAM_.length, 1).getValues().map(function (r) { return r[0]; });
  var proveedor = String(v[0] || '').trim();
  if (!IA_PROVEEDORES_[proveedor]) proveedor = 'Gemini (Google)';
  return {
    proveedor: proveedor,
    modelo: String(v[1] || '').trim(),
    leerFoto: String(v[2] || '').trim().toLowerCase().charAt(0) === 's',
    maxConsultas: Math.max(0, Math.min(60, parseInt(v[3], 10) || 10)),
    desde: IA_aFecha_(v[4]),
    pestanas: String(v[5] || 'Originales,Fotos').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    idCobranzas: String(v[6] || '').trim(),
  };
}

function IA_leerTabla_(sh) {
  var n = sh.getLastRow() - IA_FILA_ENC_;
  if (n <= 0) return [];
  return sh.getRange(IA_FILA_ENC_ + 1, 1, n, IA_ENC_.length).getValues().map(function (r, i) {
    return { fila: IA_FILA_ENC_ + 1 + i, valores: r, clave: String(r[IA_C_['Clave']] || ''), estado: String(r[IA_C_['Estado']] || '') };
  }).filter(function (t) { return t.clave; });
}

// ---------------- Lectura de vouchers ----------------

/** Lee solo las columnas de datos (nunca las de imagen) de las pestañas de vouchers. */
function IA_leerVouchersIA_(ss, pestanas) {
  var res = { filas: [], hojas: {}, sinColumna: [] };
  pestanas.forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var c = IA_columnasVoucher_(enc);
    if (c.idBenef < 0) { res.sinColumna.push(nombre); return; }
    res.hojas[nombre] = { gid: sh.getSheetId(), c: c };
    var n = sh.getLastRow() - 1;
    var cols = {};
    Object.keys(c).forEach(function (k) {
      if (c[k] >= 0 && !cols[c[k]]) cols[c[k]] = sh.getRange(2, c[k] + 1, n, 1).getValues();
    });
    function val(k, i) { return c[k] >= 0 ? cols[c[k]][i][0] : ''; }
    for (var i = 0; i < n; i++) {
      var monto = IA_aNumero_(val('monto', i));
      var op = String(val('op', i) == null ? '' : val('op', i)).trim();
      var fecha = IA_aFecha_(val('fecha', i));
      res.filas.push({
        hoja: nombre, fila: i + 2, fecha: fecha, op: op, banco: String(val('banco', i) || '').trim(),
        moneda: String(val('moneda', i) || 'PEN').trim(), monto: monto,
        benef: String(val('benef', i) || '').trim(), idCliente: String(val('idCliente', i) || '').trim(),
        cliente: String(val('cliente', i) || '').trim(), descripcion: String(val('descripcion', i) || '').trim(),
        archivo: String(val('archivo', i) || '').trim(), pagina: val('pagina', i),
        idUsuario: String(val('idUsuario', i) || '').replace(/\D/g, ''), empresa: String(val('empresa', i) || '').trim(),
        idBenef: String(val('idBenef', i) || '').replace(/\D/g, ''), refs: String(val('refs', i) || '').trim(),
        clave: [nombre, i + 2, op, monto.toFixed(2)].join('|'),
      });
    }
  });
  return res;
}

function IA_columnasVoucher_(enc) {
  var col = IA_col_(enc);
  return {
    fecha: col('Fecha de depos', 'Fecha de deposito'), op: col('Numero de oper', 'Numero de operacion'),
    banco: col('Banco'), moneda: col('Moneda'), monto: col('Monto'), benef: col('Proveedor (Beneficiario)'),
    idCliente: col('idCliente'), cliente: col('Cliente (usuario)'), descripcion: col('Descripcion'),
    archivo: col('Archivo Original'), pagina: col('Pagina'), idUsuario: col('ID Usuario'), empresa: col('Empresa'),
    idBenef: col('ID Beneficiario'), refs: col('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc'),
  };
}

// ---------------- Lectura de Cobranzas (solo lectura) ----------------

function IA_leerCobranzas_(id) {
  var res = { contrapartes: [], alias: [], empresas: [], docsPorEmisor: {}, error: '' };
  if (!id) return res;
  try {
    var ss = SpreadsheetApp.openById(id);
    var conf = ss.getSheetByName('⚙️ Config');
    if (conf && conf.getLastRow() >= 3) {
      conf.getRange(3, 5, conf.getLastRow() - 2, 6).getValues().forEach(function (r) {
        var ruc = String(r[0] || '').replace(/\D/g, '');
        if (ruc) res.empresas.push({ ruc: ruc, nombres: [r[1], r[2]].filter(Boolean) });
        var rucAlias = String(r[5] || '').replace(/\D/g, '');
        if (r[4] && rucAlias) res.alias.push({ nombre: r[4], ruc: rucAlias });
      });
    }
    var sh = ss.getSheetByName('📋 Documentos');
    if (sh && sh.getLastRow() > 1) {
      var datos = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
      var col = IA_col_(datos[0]);
      var c = { empresa: col('Empresa'), tipo: col('Tipo'), ruc: col('RUC contraparte'), nombre: col('Contraparte'),
        doc: col('Documento'), emision: col('Emision'), moneda: col('Moneda'), total: col('Total'),
        saldo: col('Saldo'), clave: col('Clave') };
      var vistosCp = {}, vistosDoc = {};
      for (var i = 1; i < datos.length; i++) {
        var r = datos[i];
        var ruc = String(r[c.ruc] || '').replace(/\D/g, '');
        if (ruc && !vistosCp[ruc + r[c.nombre]]) { vistosCp[ruc + r[c.nombre]] = 1; res.contrapartes.push({ ruc: ruc, nombre: r[c.nombre] }); }
        var saldo = IA_aNumero_(r[c.saldo]);
        var clave = String(r[c.clave] || '');
        if (saldo <= 0.5 || !clave || vistosDoc[clave]) continue;
        vistosDoc[clave] = 1;
        var emisor = clave.split('|')[0];
        (res.docsPorEmisor[emisor] = res.docsPorEmisor[emisor] || []).push({
          doc: String(r[c.doc] || ''), saldo: saldo, total: IA_aNumero_(r[c.total]), moneda: String(r[c.moneda] || ''),
          emision: IA_aFecha_(r[c.emision]), tipo: String(r[c.tipo] || ''), empresa: String(r[c.empresa] || ''),
          contraparte: String(r[c.nombre] || ''),
        });
      }
    }
  } catch (e) {
    res.error = e.message;
  }
  return res;
}

// ---------------- Directorio nombre → RUC ----------------

function IA_directorio_(filas, cob) {
  var porNorm = {}, porRuc = {};
  function agregar(nombre, ruc, peso) {
    ruc = String(ruc || '').replace(/\D/g, '');
    var norm = IA_normNombre_(nombre);
    if (!norm || !IA_rucValido_(ruc)) return;
    var m = porNorm[norm] = porNorm[norm] || {};
    m[ruc] = (m[ruc] || 0) + peso;
    if (!porRuc[ruc]) porRuc[ruc] = { ruc: ruc, nombre: String(nombre).trim(), tokens: [] };
    IA_tokens_(nombre).forEach(function (t) { if (porRuc[ruc].tokens.indexOf(t) === -1) porRuc[ruc].tokens.push(t); });
  }
  filas.forEach(function (v) { if (v.benef && IA_rucValido_(v.idBenef)) agregar(v.benef, v.idBenef, 1); });
  cob.contrapartes.forEach(function (c) { agregar(c.nombre, c.ruc, 1); });
  cob.empresas.forEach(function (e) { e.nombres.forEach(function (n) { agregar(n, e.ruc, 2); }); });
  cob.alias.forEach(function (a) { agregar(a.nombre, a.ruc, 5); });
  return { porNorm: porNorm, lista: Object.keys(porRuc).map(function (k) { return porRuc[k]; }) };
}

/** Coincidencia exacta del nombre con un solo RUC (o uno claramente dominante). */
function IA_sugerirDirectorio_(v, dir, cob) {
  var m = dir.porNorm[IA_normNombre_(v.benef)];
  if (!m) return null;
  var rucs = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
  if (rucs.length > 1 && m[rucs[0]] < 2 * m[rucs[1]]) return null;
  var ruc = rucs[0];
  var info = dir.lista.filter(function (d) { return d.ruc === ruc; })[0];
  var docs = IA_docsPorMonto_(cob.docsPorEmisor[ruc] || [], v.monto);
  return { ruc: ruc, nombre: info ? info.nombre : v.benef, docs: docs.map(function (d) { return d.doc; }),
    confianza: 95, origen: '📒 Ya conocido', motivo: 'Mismo nombre que en vouchers/SIRE ya registrados' +
      (docs.length ? '; factura con saldo igual al monto' : '') };
}

/** Facturas pendientes cuyo saldo (o neto de retencion/detraccion) es igual al monto. Solo si hay una. */
function IA_docsPorMonto_(docs, monto) {
  var tasas = [0, 0.03, 0.04, 0.10, 0.12];
  var hits = docs.filter(function (d) {
    return tasas.some(function (t) { return Math.abs(d.saldo * (1 - t) - monto) <= 1 || Math.abs(d.total * (1 - t) - monto) <= 1; });
  });
  return hits.length === 1 ? hits : [];
}

// ---------------- Consulta a la IA ----------------

var IA_SISTEMA_BENEF_ = [
  'Eres un asistente contable en Perú. Te doy los datos de un voucher bancario (un pago) y una lista de posibles',
  'beneficiarios (RUC y nombre) tomada de los registros de la empresa. Debes decir a quién se le pagó.',
  'Reglas:',
  '- Elige SOLO un RUC de la lista de candidatos, salvo que el RUC esté escrito en el voucher o en la imagen.',
  '- Si no estás razonablemente seguro, deja "ruc" vacío. Es mejor no sugerir que sugerir mal.',
  '- Si te doy facturas pendientes, indica cuál(es) paga este voucher usando exactamente el código dado',
  '  (ej. 01_E001-393). Puede pagarse neto de detracción (4%, 10%, 12%) o de retención (3%), o ser un pago parcial.',
  '  Si no es claro, deja "documentos" vacío.',
  '- Si parece planilla, honorarios, SUNAT, AFP, préstamo o pago a persona natural, dilo en "motivo".',
  'Responde SOLO JSON: {"ruc":"","nombre":"","documentos":[],"confianza":0,"motivo":""}',
  '"confianza" es 0-100. "motivo" máximo 25 palabras, en español.',
].join('\n');

function IA_sugerirConIA_(v, dir, cob, p) {
  var claves = IA_tokens_(v.benef + ' ' + v.descripcion + ' ' + v.cliente);
  var candidatos = dir.lista.map(function (d) { return { d: d, s: IA_similitud_(claves, d.tokens) }; })
    .filter(function (x) { return x.s > 0; })
    .sort(function (a, b) { return b.s - a.s; })
    .slice(0, 12).map(function (x) { return x.d; });

  var lineasDocs = [];
  candidatos.slice(0, 5).forEach(function (d) {
    (cob.docsPorEmisor[d.ruc] || []).slice()
      .sort(function (a, b) { return Math.abs(a.saldo - v.monto) - Math.abs(b.saldo - v.monto); })
      .slice(0, 6).forEach(function (x) {
        lineasDocs.push(d.ruc + ' | ' + x.doc + ' | ' + IA_fmtFecha_(x.emision) + ' | saldo ' + x.saldo.toFixed(2) + ' | total ' + x.total.toFixed(2) + ' ' + x.moneda);
      });
  });

  var texto = [
    'VOUCHER',
    'Fecha: ' + IA_fmtFecha_(v.fecha) + ' | Banco: ' + v.banco + ' | Operación: ' + v.op + ' | Monto: ' + v.monto.toFixed(2) + ' ' + v.moneda,
    'Beneficiario escrito en el voucher: ' + (v.benef || '(vacío)'),
    'Ordenante / cliente: ' + [v.cliente, v.idCliente].filter(Boolean).join(' ') ,
    'Descripción / glosa: ' + (v.descripcion || '(vacía)'),
    'Empresa que paga: ' + [v.empresa, v.idUsuario].filter(Boolean).join(' '),
    '',
    'CANDIDATOS (RUC - nombre):',
    candidatos.length ? candidatos.map(function (d) { return d.ruc + ' - ' + d.nombre; }).join('\n') : '(ninguno parecido)',
    '',
    'FACTURAS PENDIENTES DE LOS CANDIDATOS (RUC emisor | documento | emisión | saldo | total):',
    lineasDocs.length ? lineasDocs.join('\n') : '(sin datos de SIRE)',
  ].join('\n');

  var prov = IA_PROVEEDORES_[p.proveedor];
  var adjunto = null;
  if (!v.benef && p.leerFoto && prov.imagen) adjunto = IA_adjuntoVoucher_(v, prov);
  if (adjunto) texto += '\n\nSe adjunta la imagen del voucher' + (v.pagina ? ' (página ' + v.pagina + ')' : '') + '.';

  var r = IA_llamar_({ proveedor: p.proveedor, modelo: p.modelo, sistema: IA_SISTEMA_BENEF_, texto: texto, adjunto: adjunto });
  var ruc = String(r.ruc || '').replace(/\D/g, '');
  var conf = Math.max(0, Math.min(100, parseInt(r.confianza, 10) || 0));
  var motivo = String(r.motivo || '').substring(0, 300);
  if (!ruc) return { ruc: '', nombre: '', docs: [], confianza: conf, origen: '🤖 IA', motivo: motivo || 'La IA no encontró beneficiario', sinSugerencia: true };
  if (!IA_rucValido_(ruc)) return { ruc: '', nombre: '', docs: [], confianza: 0, origen: '🤖 IA', motivo: 'La IA dio un RUC inválido (' + ruc + '): descartado', sinSugerencia: true };
  var conocido = dir.lista.some(function (d) { return d.ruc === ruc; });
  if (!conocido) { conf = Math.min(conf, 50); motivo = '⚠️ RUC no está en tus registros. ' + motivo; }
  var pendientes = cob.docsPorEmisor[ruc] || [];
  var docs = (Array.isArray(r.documentos) ? r.documentos : []).map(String).filter(function (x) {
    return pendientes.some(function (d) { return d.doc === x; });
  });
  if (!docs.length) docs = IA_docsPorMonto_(pendientes, v.monto).map(function (d) { return d.doc; });
  var info = dir.lista.filter(function (d) { return d.ruc === ruc; })[0];
  return { ruc: ruc, nombre: info ? info.nombre : String(r.nombre || ''), docs: docs, confianza: conf,
    origen: adjunto ? '🤖 IA (con foto)' : '🤖 IA', motivo: motivo };
}

/** Imagen o PDF original del voucher (de la carpeta Procesados), si el proveedor puede leerlo. */
function IA_adjuntoVoucher_(v, prov) {
  try {
    if (!v.archivo) return null;
    var carpetaId = v.hoja === CFG.SHEET_FOTOS ? CFG.CARPETA_FOTOS_PROCESADOS_ID : CFG.CARPETA_ORIGINALES_PROCESADOS_ID;
    var it = DriveApp.getFolderById(carpetaId).getFilesByName(v.archivo);
    if (!it.hasNext()) return null;
    var blob = it.next().getBlob();
    var mime = blob.getContentType();
    if (blob.getBytes().length > 4 * 1024 * 1024) return null;
    if (mime === 'application/pdf' && !prov.pdf) return null;
    if (mime !== 'application/pdf' && mime.indexOf('image/') !== 0) return null;
    return { base64: Utilities.base64Encode(blob.getBytes()), mime: mime };
  } catch (e) {
    return null;
  }
}

// ---------------- Escritura de la tabla ----------------

function IA_filaTabla_(v, s) {
  var f = new Array(IA_ENC_.length);
  f[IA_C_['✔ Pasar']] = false; f[IA_C_['✖ Descartar']] = false;
  f[IA_C_['Voucher']] = v.hoja + '!' + v.fila;
  f[IA_C_['Fecha']] = v.fecha || ''; f[IA_C_['Banco']] = v.banco; f[IA_C_['N° operación']] = v.op;
  f[IA_C_['Monto']] = v.monto; f[IA_C_['Beneficiario (según voucher)']] = v.benef;
  f[IA_C_['RUC sugerido']] = s.ruc; f[IA_C_['Nombre sugerido']] = s.nombre;
  f[IA_C_['Doc(s) sugerido(s)']] = (s.docs || []).join(','); f[IA_C_['Confianza']] = s.confianza / 100;
  f[IA_C_['Cómo se obtuvo']] = s.origen; f[IA_C_['Motivo']] = s.motivo;
  f[IA_C_['Estado']] = s.sinSugerencia ? '❔ Sin sugerencia' : IA_PENDIENTE_;
  f[IA_C_['Clave']] = v.clave;
  return { valores: f, gid: null, hoja: v.hoja, fila: v.fila };
}

function IA_escribirFilas_(ss, sh, nuevas, hojas) {
  if (!nuevas.length) return;
  var desde = Math.max(sh.getLastRow(), IA_FILA_ENC_) + 1;
  var n = nuevas.length;
  sh.getRange(desde, 1, n, IA_ENC_.length).setValues(nuevas.map(function (x) { return x.valores; }));
  sh.getRange(desde, 1, n, 2).insertCheckboxes();
  sh.getRange(desde, IA_C_['Fecha'] + 1, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(desde, IA_C_['Monto'] + 1, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(desde, IA_C_['Confianza'] + 1, n, 1).setNumberFormat('0%');
  sh.getRange(desde, IA_C_['N° operación'] + 1, n, 1).setNumberFormat('@');
  sh.getRange(desde, IA_C_['RUC sugerido'] + 1, n, 1).setNumberFormat('@');
  // Enlace a la fila del voucher (clic → va directo a esa fila).
  var enlaces = nuevas.map(function (x) {
    var h = hojas[x.hoja];
    var texto = x.hoja + '!' + x.fila;
    return [h ? SpreadsheetApp.newRichTextValue().setText(texto).setLinkUrl('#gid=' + h.gid + '&range=A' + x.fila).build()
      : SpreadsheetApp.newRichTextValue().setText(texto).build()];
  });
  sh.getRange(desde, IA_C_['Voucher'] + 1, n, 1).setRichTextValues(enlaces);
  sh.getRange(desde, 1, n, IA_ENC_.length).setFontSize(9).setVerticalAlignment('middle');
}

// ---------------- Pasar al voucher ----------------

/**
 * ✔ → escribe RUC y documentos en el voucher SOLO si esas celdas estan
 * vacias. ✖ → marca la sugerencia como descartada (no se vuelve a sugerir).
 */
function IA_aplicarMarcas_(ss, sh) {
  var res = { pasados: 0, descartados: 0, fallidos: 0 };
  var tabla = IA_leerTabla_(sh);
  var abiertas = {};
  tabla.forEach(function (t) {
    var ok = t.valores[IA_C_['✔ Pasar']] === true, no = t.valores[IA_C_['✖ Descartar']] === true;
    var vigente = t.estado === IA_PENDIENTE_ || t.estado.indexOf('⚠️') === 0;
    if (!vigente || (!ok && !no)) return;
    var celdaEstado = sh.getRange(t.fila, IA_C_['Estado'] + 1);
    if (no) { celdaEstado.setValue('✖ Descartado'); res.descartados++; return; }
    var r = IA_pasarAlVoucher_(ss, t.clave, t.valores[IA_C_['RUC sugerido']], t.valores[IA_C_['Doc(s) sugerido(s)']], abiertas);
    celdaEstado.setValue(r);
    if (r.indexOf('✅') === 0) res.pasados++; else if (r.indexOf('⚠️') === 0) res.fallidos++;
  });
  return res;
}

function IA_pasarAlVoucher_(ss, clave, rucTexto, docsTexto, abiertas) {
  var partes = clave.split('|');
  var hojaNombre = partes[0], fila = parseInt(partes[1], 10), op = partes[2], monto = Number(partes[3]);
  var sh = ss.getSheetByName(hojaNombre);
  if (!sh) return '⚠️ No existe la pestaña ' + hojaNombre;
  if (!abiertas[hojaNombre]) {
    abiertas[hojaNombre] = IA_columnasVoucher_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
  }
  var c = abiertas[hojaNombre];
  // Verificar que la fila siga siendo el mismo voucher (por si se ordenaron o borraron filas).
  if (!IA_mismaFila_(sh, fila, c, op, monto)) {
    fila = IA_buscarFila_(sh, c, op, monto);
    if (!fila) return '⚠️ No se encontró el voucher (¿se borró o cambió?)';
  }
  var ruc = String(rucTexto || '').replace(/\D/g, '');
  var docs = String(docsTexto || '').trim();
  var hecho = [];
  if (ruc && IA_rucValido_(ruc) && c.idBenef >= 0) {
    var celda = sh.getRange(fila, c.idBenef + 1);
    if (String(celda.getValue()).trim() === '') { celda.setValue(ruc.length === 8 ? "'" + ruc : ruc); hecho.push('RUC'); }
  } else if (ruc) {
    return '⚠️ RUC inválido: corrígelo y vuelve a marcar ✔';
  }
  if (docs && c.refs >= 0) {
    var celdaDoc = sh.getRange(fila, c.refs + 1);
    if (String(celdaDoc.getValue()).trim() === '') { celdaDoc.setValue(docs); hecho.push('Doc'); }
  }
  if (!hecho.length) return '✔ Ya completado en voucher';
  return '✅ Pasado ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' (' + hecho.join(' + ') + ')';
}

function IA_mismaFila_(sh, fila, c, op, monto) {
  if (fila < 2 || fila > sh.getLastRow()) return false;
  var vOp = c.op >= 0 ? String(sh.getRange(fila, c.op + 1).getValue()).trim() : '';
  var vMonto = c.monto >= 0 ? IA_aNumero_(sh.getRange(fila, c.monto + 1).getValue()) : 0;
  return vOp === op && Math.abs(vMonto - monto) < 0.005;
}

function IA_buscarFila_(sh, c, op, monto) {
  if (c.op < 0 || c.monto < 0 || !op) return 0;
  var n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  var ops = sh.getRange(2, c.op + 1, n, 1).getValues();
  var montos = sh.getRange(2, c.monto + 1, n, 1).getValues();
  var encontradas = [];
  for (var i = 0; i < n; i++) {
    if (String(ops[i][0]).trim() === op && Math.abs(IA_aNumero_(montos[i][0]) - monto) < 0.005) encontradas.push(i + 2);
  }
  return encontradas.length === 1 ? encontradas[0] : 0;
}
