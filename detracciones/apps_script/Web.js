/**
 * Detracciones · Grupo — Web.js
 * Aplicación web de la hoja. El robot de GitHub ya NO guarda nada en el repositorio (es público): manda aquí
 * cada mes de depósitos y cada constancia, con una LLAVE de un solo uso (vale 6 horas) que la hoja crea al
 * pedir la descarga. Acciones (doPost):
 *   estado     → cuántos depósitos tiene la hoja por mes y qué constancias ya tiene (para no repetir)
 *   mes        → reemplaza los depósitos de una empresa y un mes (si SUNAT devuelve vacío y había datos, se conservan)
 *   constancia → la Constancia de Depósito (HTML oficial): se guarda como PDF en Drive
 *   fin        → terminó una empresa (bien o con error): se anota para reintentar las que fallaron
 * doGet:
 *   ?registrar=1                          → deja en los metadatos de la hoja la dirección de esta aplicación web
 *   ?pedir=1&k=CLAVE&empresa=..&desde=..   → otra hoja del grupo (Cobranzas / bot) pide la descarga; la clave
 *                                            está en los metadatos de esta hoja ('DET_PUENTE')
 * Los depósitos quedan en la pestaña oculta «_Datos» (una fila por depósito).
 */

var DET_HOJA_DATOS_ = '_Datos';
var DET_COLS_ = ['empresa_ruc', 'rol', 'consulta', 'tipo_cuenta', 'num_cuenta', 'fecha_pago', 'periodo',
  'tipo_comprobante', 'serie', 'numero', 'constancia', 'ruc_proveedor', 'proveedor',
  'tipo_doc_adquiriente', 'doc_adquiriente', 'adquiriente', 'tipo_operacion', 'tipo_bien',
  'monto', 'npd', 'origen', 'num_presentacion', 'usuario_sol'];
var DET_HORAS_LLAVE_ = 6;

/* ------------------------------------------------------------ llaves de un solo uso */

function DET_llaves_() {
  var l = {};
  try { l = JSON.parse(PropertiesService.getScriptProperties().getProperty('DET_LLAVES') || '{}'); } catch (e) { l = {}; }
  var ahora = Date.now();
  Object.keys(l).forEach(function (k) { if (!l[k] || l[k] < ahora) delete l[k]; });
  return l;
}

/** Crea una llave nueva (vale 6 horas) → {destino, llave} para mandar al robot. */
function DET_nuevaLlave_() {
  if (!DET_DEPLOYMENT_ID_) throw new Error('La aplicación web de esta hoja aún no está publicada (workflow «Desplegar Detracciones (hoja)»).');
  var llave = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var l = DET_llaves_();
  l[llave] = Date.now() + DET_HORAS_LLAVE_ * 3600 * 1000;
  PropertiesService.getScriptProperties().setProperty('DET_LLAVES', JSON.stringify(l));
  return { destino: 'https://script.google.com/macros/s/' + DET_DEPLOYMENT_ID_ + '/exec', llave: llave };
}

function DET_iguales_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ------------------------------------------------------------ pestaña _Datos */

function DET_hojaDatos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(DET_HOJA_DATOS_);
  if (h) return h;
  h = ss.insertSheet(DET_HOJA_DATOS_);
  h.getRange(1, 1, 1, DET_COLS_.length + 1).setValues([['clave'].concat(DET_COLS_)]).setFontWeight('bold');
  h.getRange('A:Z').setNumberFormat('@');
  h.hideSheet();
  return h;
}

/** [{clave, ...columnas}] */
function DET_datosLeer_() {
  var h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DET_HOJA_DATOS_);
  if (!h || h.getLastRow() < 2) return [];
  var enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
  return h.getRange(2, 1, h.getLastRow() - 1, enc.length).getValues().map(function (f) {
    var o = {};
    enc.forEach(function (k, i) { o[k] = f[i] === null || f[i] === undefined ? '' : String(f[i]); });
    return o;
  }).filter(function (o) { return o.clave; });
}

/** Reemplaza los depósitos de varias claves (ruc|AAAAMM) de una vez. porClave: {clave: [filas]} */
function DET_datosReemplazar_(porClave) {
  var h = DET_hojaDatos_();
  var quitar = {};
  Object.keys(porClave).forEach(function (k) { quitar[k] = 1; });
  var quedan = DET_datosLeer_().filter(function (o) { return !quitar[o.clave]; });
  Object.keys(porClave).forEach(function (k) {
    porClave[k].forEach(function (f) { var o = { clave: k }; DET_COLS_.forEach(function (c) { o[c] = f[c] === undefined || f[c] === null ? '' : String(f[c]); }); quedan.push(o); });
  });
  var enc = ['clave'].concat(DET_COLS_);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, Math.max(h.getLastColumn(), enc.length)).clearContent();
  h.getRange(1, 1, 1, enc.length).setValues([enc]);
  if (quedan.length) h.getRange(2, 1, quedan.length, enc.length).setNumberFormat('@')
    .setValues(quedan.map(function (o) { return enc.map(function (c) { return o[c] || ''; }); }));
}

/** Depósitos por mes de una empresa (con «desde» AAAA-MM-DD: solo los pagados desde ese día). */
function DET_contarPorMes_(ruc, desde) {
  var n = {};
  DET_datosLeer_().forEach(function (o) {
    var p = o.clave.split('|');
    if (p[0] === ruc && (!desde || String(o.fecha_pago) >= desde)) n[p[1]] = (n[p[1]] || 0) + 1;
  });
  return n;
}

/* ------------------------------------------------------------ aplicación web */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var json = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    if (p.registrar) { DET_registrarWeb_(); return json({ ok: true }); }
    if (p.pedir) return json(DET_webPedir_(p));
  } catch (x) { return json({ ok: false, error: String(x.message || x).slice(0, 300) }); }
  return ContentService.createTextOutput('Detracciones · Grupo: aplicación web activa.');
}

function doPost(e) {
  var salida = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return salida({ ok: false, error: 'pedido ilegible' }); }
  if (!d.llave || !DET_llaves_()[d.llave]) return salida({ ok: false, error: 'llave vencida o desconocida (pida la descarga desde la hoja)' });
  if (!/^\d{11}$/.test(String(d.ruc || ''))) return salida({ ok: false, error: 'RUC no válido' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) return salida({ ok: false, error: 'la hoja está ocupada; reintente' });
  try {
    if (d.accion === 'estado') return salida(DET_webEstado_(d));
    if (d.accion === 'mes') return salida(DET_webMes_(d));
    if (d.accion === 'constancia') return salida(DET_webConstancia_(d));
    if (d.accion === 'fin') return salida(DET_webFin_(d));
    return salida({ ok: false, error: 'acción desconocida' });
  } catch (x) {
    console.error(x);
    return salida({ ok: false, error: String(x.message || x).slice(0, 300) });
  } finally {
    lock.releaseLock();
  }
}

function DET_webEstado_(d) {
  var cons = [];
  Object.keys(DET_rutasConstancias_()).forEach(function (k) { var p = k.split('|'); if (p[0] === d.ruc) cons.push(p[1]); });
  return { ok: true, meses: DET_contarPorMes_(d.ruc, DET_fechaIso_(d.desde)), constancias: cons };
}

function DET_fechaIso_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : ''; }

/**
 * Un mes de una empresa. Si llega vacío y la hoja tenía depósitos de ese mes, NO se borran (SUNAT a veces responde vacío).
 * Con «desde» (AAAA-MM-DD; la descarga de los últimos 30 días empieza a mitad de mes) solo se reemplaza desde ese día:
 * los depósitos de días anteriores del mismo mes se quedan.
 */
function DET_webMes_(d) {
  var mes = String(d.periodo || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(mes)) return { ok: false, error: 'mes no válido' };
  var desde = DET_fechaIso_(d.desde), clave = d.ruc + '|' + mes;
  var filas = (d.filas || []).filter(function (f) { return f && f.constancia; });
  var antes = DET_contarPorMes_(d.ruc, desde)[mes] || 0;
  if (!filas.length && antes > 0) return { ok: true, conservado: true, antes: antes };
  if (desde) filas = DET_datosLeer_().filter(function (o) { return o.clave === clave && String(o.fecha_pago) < desde; }).concat(filas);
  var o = {}; o[clave] = filas;
  DET_datosReemplazar_(o);
  return { ok: true, antes: antes, ahora: filas.length };
}

function DET_webConstancia_(d) {
  var mes = String(d.periodo || '').replace(/\D/g, ''), num = String(d.num || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(mes) || !num || !d.html) return { ok: false, error: 'constancia incompleta' };
  var ruta = d.ruc + '/' + mes.slice(0, 4) + '/' + mes.slice(4) + '/constancias/' + num + '.html';
  if (DET_mapaArchivos_()[ruta]) return { ok: true, ya: true };
  var f = d.fila || {};
  var p = { ruta: ruta, empresa: d.empresa || d.ruc, ruc: d.ruc, fecha: DET_fecha_(f.fecha_pago) || new Date(), constancia: num,
    nombre: f.rol === 'VENTA' ? f.adquiriente : f.proveedor, monto: +f.monto || 0 };
  var cfg = DET_leerConfig_();
  DET_guardarEnMapa_([DET_guardarPdf_(cfg, p, d.html, {})]);
  return { ok: true };
}

function DET_webFin_(d) {
  var res = DET_resultados_();
  res[d.ruc] = { ok: !!d.ok, t: Date.now(), error: String(d.error || '').slice(0, 200), conservados: (d.conservados || []).slice(0, 12), fallidos: (d.fallidos || []).slice(0, 12) };
  PropertiesService.getScriptProperties().setProperty('DET_RESULTADOS', JSON.stringify(res));
  // en 3 minutos (cuando terminen las demás empresas) se rehacen las pestañas solas
  try {
    ScriptApp.getProjectTriggers().forEach(function (x) { if (x.getHandlerFunction() === 'DET_trasDescarga') ScriptApp.deleteTrigger(x); });
    ScriptApp.newTrigger('DET_trasDescarga').timeBased().after(3 * 60 * 1000).create();
  } catch (e) { console.warn('No se pudo programar la actualización: ' + e.message); }
  return { ok: true };
}

/** Después de que el robot mandó lo bajado: rehace Panel, Detracciones, Por proveedor y Por mes, y reintenta las que fallaron. */
function DET_trasDescarga() {
  ScriptApp.getProjectTriggers().forEach(function (x) { if (x.getHandlerFunction() === 'DET_trasDescarga') ScriptApp.deleteTrigger(x); });
  try { DET_importarAhora_(); } catch (e) { console.warn('Detracciones (actualizar tras descarga): ' + e.message); }
  DET_revisarFallas_();
}

function DET_resultados_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('DET_RESULTADOS') || '{}'); } catch (e) { return {}; }
}

/* ------------------------------------------------------------ puente con las otras hojas del grupo */

function DET_registrarWeb_() {
  if (!DET_DEPLOYMENT_ID_) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet(), m = ss.createDeveloperMetadataFinder().withKey('DET_WEB').find();
  if (m.length && m[0].getValue() === DET_DEPLOYMENT_ID_) return;
  m.forEach(function (x) { try { x.remove(); } catch (e) {} });
  ss.addDeveloperMetadata('DET_WEB', DET_DEPLOYMENT_ID_, SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT);
}

/** Cobranzas (bot de Telegram) pide una descarga: como el robot ya no guarda en GitHub, la llave la pone esta hoja. */
function DET_webPedir_(p) {
  var m = SpreadsheetApp.getActiveSpreadsheet().createDeveloperMetadataFinder().withKey('DET_PUENTE').find();
  var clave = m.length ? String(m[0].getValue() || '') : '';
  if (clave.length < 40 || !p.k || !DET_iguales_(p.k, clave)) return { ok: false, error: 'No autorizado' };
  var cfg = DET_leerConfig_();
  var empresa = String(p.empresa || 'todas').split(/[,\s]+/).filter(function (r) { return /^\d{11}$/.test(r); }).join(',') || 'todas';
  var desde = /^\d{6}$/.test(String(p.desde || '')) ? String(p.desde) : '', hasta = /^\d{6}$/.test(String(p.hasta || '')) ? String(p.hasta) : '';
  if (String(p.diario) === 'true') DET_pedirDiario_(cfg); else DET_despachar_(cfg, empresa, desde, hasta);
  return { ok: true };
}
