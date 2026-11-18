/**
 * Notificaciones · Grupo — Web.js
 * Aplicación web de la hoja. El robot de GitHub ya NO guarda nada en el repositorio (es público): manda aquí la
 * lista de notificaciones y mensajes de cada empresa y cada PDF, con una LLAVE de un solo uso (vale 6 horas) que
 * la hoja crea al pedir la descarga. Acciones (doPost):
 *   estado  → lo que la hoja ya tiene de esa empresa (código → archivos / nota / revisión), para no repetir
 *   archivo → un documento de una notificación (base64): se guarda directo en Drive (PDF Notificaciones/…)
 *   lista   → la lista completa de una empresa y un tipo (notificaciones o mensajes): reemplaza la de la hoja
 *             (si llega vacía y la hoja tenía datos, se conservan: SUNAT a veces responde vacío)
 *   fin     → terminó una empresa: en 3 minutos se rehacen Panel, Notificaciones y Mensajes
 * doGet:
 *   ?registrar=1                        → deja en los metadatos de la hoja la dirección de esta aplicación web
 *   ?pedir=1&k=CLAVE&empresa=..&desde=.. → el bot de Cobranzas pide la descarga (clave en el metadato 'NOT_PUENTE')
 * Los datos quedan en la pestaña oculta «_Datos» (una fila por notificación o mensaje).
 */

var NOT_HOJA_DATOS_ = '_Datos';
var NOT_COLS_ = ['empresa_ruc', 'tipo', 'codigo', 'fecha_publicacion', 'fecha_envio', 'asunto', 'clase', 'documento',
  'etiqueta', 'leido', 'urgente', 'destacado', 'remitente', 'dependencia', 'adjuntos', 'archivos', 'nota_pdf', 'revision'];
var NOT_HORAS_LLAVE_ = 6;

/* ------------------------------------------------------------ llaves de un solo uso */

function NOT_llaves_() {
  var l = {};
  try { l = JSON.parse(PropertiesService.getScriptProperties().getProperty('NOT_LLAVES') || '{}'); } catch (e) { l = {}; }
  var ahora = Date.now();
  Object.keys(l).forEach(function (k) { if (!l[k] || l[k] < ahora) delete l[k]; });
  return l;
}

/** Crea una llave nueva (vale 6 horas) → {destino, llave} para mandar al robot. */
function NOT_nuevaLlave_() {
  if (!NOT_DEPLOYMENT_ID_) throw new Error('La aplicación web de esta hoja aún no está publicada (workflow «Desplegar Notificaciones (hoja)»).');
  var llave = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var l = NOT_llaves_();
  l[llave] = Date.now() + NOT_HORAS_LLAVE_ * 3600 * 1000;
  PropertiesService.getScriptProperties().setProperty('NOT_LLAVES', JSON.stringify(l));
  return { destino: 'https://script.google.com/macros/s/' + NOT_DEPLOYMENT_ID_ + '/exec', llave: llave };
}

function NOT_iguales_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ------------------------------------------------------------ pestaña _Datos */

function NOT_hojaDatos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var h = ss.getSheetByName(NOT_HOJA_DATOS_);
  if (h) return h;
  h = ss.insertSheet(NOT_HOJA_DATOS_);
  h.getRange(1, 1, 1, NOT_COLS_.length).setValues([NOT_COLS_]).setFontWeight('bold');
  h.getRange('A:Z').setNumberFormat('@');
  h.hideSheet();
  return h;
}

/** [{empresa_ruc, tipo, codigo, …}] */
function NOT_datosLeer_() {
  var h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOT_HOJA_DATOS_);
  if (!h || h.getLastRow() < 2) return [];
  var enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
  return h.getRange(2, 1, h.getLastRow() - 1, enc.length).getValues().map(function (f) {
    var o = {};
    enc.forEach(function (k, i) { o[k] = f[i] === null || f[i] === undefined ? '' : String(f[i]); });
    return o;
  }).filter(function (o) { return o.codigo; });
}

/** Reemplaza las filas de varias claves «ruc|tipo» (tipo: Notificación / Mensaje). porClave: {clave: [filas]} */
function NOT_datosReemplazar_(porClave) {
  var h = NOT_hojaDatos_();
  var quedan = NOT_datosLeer_().filter(function (o) { return !porClave[o.empresa_ruc + '|' + o.tipo]; });
  Object.keys(porClave).forEach(function (k) {
    porClave[k].forEach(function (f) { var o = {}; NOT_COLS_.forEach(function (c) { o[c] = f[c] === undefined || f[c] === null ? '' : String(f[c]); }); quedan.push(o); });
  });
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, Math.max(h.getLastColumn(), NOT_COLS_.length)).clearContent();
  h.getRange(1, 1, 1, NOT_COLS_.length).setValues([NOT_COLS_]);
  if (quedan.length) h.getRange(2, 1, quedan.length, NOT_COLS_.length).setNumberFormat('@')
    .setValues(quedan.map(function (o) { return NOT_COLS_.map(function (c) { return o[c] || ''; }); }));
}

/* ------------------------------------------------------------ aplicación web */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var json = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    if (p.registrar) { NOT_registrarWeb_(); return json({ ok: true }); }
    if (p.pedir) return json(NOT_webPedir_(p));
  } catch (x) { return json({ ok: false, error: String(x.message || x).slice(0, 300) }); }
  return ContentService.createTextOutput('Notificaciones · Grupo: aplicación web activa.');
}

function doPost(e) {
  var salida = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return salida({ ok: false, error: 'pedido ilegible' }); }
  if (!d.llave || !NOT_llaves_()[d.llave]) return salida({ ok: false, error: 'llave vencida o desconocida (pida la descarga desde la hoja)' });
  if (!/^\d{11}$/.test(String(d.ruc || ''))) return salida({ ok: false, error: 'RUC no válido' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) return salida({ ok: false, error: 'la hoja está ocupada; reintente' });
  try {
    if (d.accion === 'estado') return salida(NOT_webEstado_(d));
    if (d.accion === 'archivo') return salida(NOT_webArchivo_(d));
    if (d.accion === 'lista') return salida(NOT_webLista_(d));
    if (d.accion === 'fin') return salida(NOT_webFin_(d));
    return salida({ ok: false, error: 'acción desconocida' });
  } catch (x) {
    console.error(x);
    return salida({ ok: false, error: String(x.message || x).slice(0, 300) });
  } finally {
    lock.releaseLock();
  }
}

/** Lo que la hoja ya tiene de esa empresa: {notificaciones: {codigo: fila}, mensajes: {…}} */
function NOT_webEstado_(d) {
  if (!NOT_datosLeer_().length) { try { NOT_migrar_(NOT_leerConfig_()); } catch (x) { console.warn('Migración: ' + x.message); } }
  var res = { ok: true, notificaciones: {}, mensajes: {} };
  NOT_datosLeer_().forEach(function (o) {
    if (o.empresa_ruc !== d.ruc) return;
    res[o.tipo === 'Mensaje' ? 'mensajes' : 'notificaciones'][o.codigo] = o;
  });
  return res;
}

/** Un documento: se guarda directo en Drive y se anota en «_Archivos» con su ruta (RUC/AAAA/MM/código-nombre.ext). */
function NOT_webArchivo_(d) {
  var ruta = String(d.ruta || '');
  if (ruta.indexOf(d.ruc + '/') !== 0 || !/^\d{11}\/(\d{4}\/\d{2}|sin_fecha)\/[\w.\-]+$/.test(ruta) || !d.b64) return { ok: false, error: 'archivo incompleto' };
  if (NOT_mapaArchivos_()[ruta]) return { ok: true, ya: true };
  var cfg = NOT_leerConfig_();
  var f = NOT_fechaHora_(d.fecha) || new Date();
  var empresa = NOT_nombreEmpresa_(cfg, d.ruc);
  var blob = Utilities.newBlob(Utilities.base64Decode(d.b64), 'application/octet-stream', ruta.split('/').pop());
  var r = NOT_guardarEnDrive_(cfg, { ruta: ruta, empresa: empresa, ruc: d.ruc, fecha: f, clase: d.clase || '', doc: d.documento || '' }, blob, {});
  NOT_guardarEnMapa_([r]);
  return { ok: true };
}

/**
 * La lista completa de una empresa y un tipo. Si llega vacía y la hoja tenía datos de esa empresa, NO se borran.
 * El robot ya junta lo nuevo con lo que la hoja le dio en «estado».
 */
function NOT_webLista_(d) {
  var tipo = d.tipo === 'mensajes' ? 'Mensaje' : 'Notificación', clave = d.ruc + '|' + tipo;
  var filas = (d.filas || []).filter(function (f) { return f && f.codigo; }).map(function (f) { f.empresa_ruc = d.ruc; f.tipo = tipo; return f; });
  var antes = NOT_datosLeer_().filter(function (o) { return o.empresa_ruc + '|' + o.tipo === clave; }).length;
  if (!filas.length && antes > 0) return { ok: true, conservado: true, antes: antes };
  var o = {}; o[clave] = filas;
  NOT_datosReemplazar_(o);
  return { ok: true, antes: antes, ahora: filas.length };
}

function NOT_webFin_(d) {
  var res = {};
  try { res = JSON.parse(PropertiesService.getScriptProperties().getProperty('NOT_RESULTADOS') || '{}'); } catch (x) {}
  res[d.ruc] = { ok: !!d.ok, t: Date.now(), error: String(d.error || '').slice(0, 200) };
  PropertiesService.getScriptProperties().setProperty('NOT_RESULTADOS', JSON.stringify(res));
  try {
    ScriptApp.getProjectTriggers().forEach(function (x) { if (x.getHandlerFunction() === 'NOT_trasDescarga') ScriptApp.deleteTrigger(x); });
    ScriptApp.newTrigger('NOT_trasDescarga').timeBased().after(3 * 60 * 1000).create();
  } catch (x) { console.warn('No se pudo programar la actualización: ' + x.message); }
  return { ok: true };
}

/** Después de que el robot mandó lo bajado: rehace Panel, Notificaciones y Mensajes. */
function NOT_trasDescarga() {
  ScriptApp.getProjectTriggers().forEach(function (x) { if (x.getHandlerFunction() === 'NOT_trasDescarga') ScriptApp.deleteTrigger(x); });
  try { NOT_importarAhora_(); } catch (x) { console.warn('Notificaciones (actualizar tras descarga): ' + x.message); }
}

/* ------------------------------------------------------------ puente con las otras hojas del grupo */

function NOT_registrarWeb_() {
  if (!NOT_DEPLOYMENT_ID_) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet(), m = ss.createDeveloperMetadataFinder().withKey('NOT_WEB').find();
  if (m.length && m[0].getValue() === NOT_DEPLOYMENT_ID_) return;
  m.forEach(function (x) { try { x.remove(); } catch (e) {} });
  ss.addDeveloperMetadata('NOT_WEB', NOT_DEPLOYMENT_ID_, SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT);
}

/** Cobranzas (bot de Telegram) pide una descarga: como el robot ya no guarda en GitHub, la llave la pone esta hoja. */
function NOT_webPedir_(p) {
  var m = SpreadsheetApp.getActiveSpreadsheet().createDeveloperMetadataFinder().withKey('NOT_PUENTE').find();
  var clave = m.length ? String(m[0].getValue() || '') : '';
  if (clave.length < 40 || !p.k || !NOT_iguales_(p.k, clave)) return { ok: false, error: 'No autorizado' };
  var cfg = NOT_leerConfig_();
  var empresa = String(p.empresa || 'todas').split(/[,\s]+/).filter(function (r) { return /^\d{11}$/.test(r); }).join(',') || 'todas';
  var desde = /^\d{6}$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(p.desde || '')) ? String(p.desde) : '';
  if (String(p.diario) === 'true') NOT_pedirDiario_(cfg);
  else NOT_despachar_(cfg, empresa, String(p.pdf) === 'false' ? false : cfg.bajarPdf, desde, String(p.solo_nuevas) !== 'false' && !desde);
  return { ok: true };
}

/**
 * Lo descargado ANTES del cambio (cuando el robot lo guardaba en el repositorio): se copia una vez a «_Datos».
 * Los PDF de entonces que aún no estaban en Drive se copian después desde esa versión (NOT_REF_LEGADO_).
 */
function NOT_migrar_(cfg) {
  if (!NOT_REF_LEGADO_) return;
  var rutas = NOT_listarArchivos_(cfg, NOT_REF_LEGADO_).map(function (a) { return a.path; })
    .filter(function (p) { return /^\d{11}\/(notificaciones|mensajes)\.csv$/.test(p); });
  var textos = NOT_leerTextos_(cfg, rutas, NOT_REF_LEGADO_), porClave = {};
  rutas.forEach(function (ruta) {
    var ruc = ruta.slice(0, 11), tipo = /mensajes/.test(ruta) ? 'Mensaje' : 'Notificación';
    porClave[ruc + '|' + tipo] = NOT_csvObjetos_(textos[ruta]).map(function (r) { r.empresa_ruc = ruc; r.tipo = tipo; return r; });
  });
  if (Object.keys(porClave).length) NOT_datosReemplazar_(porClave);
  console.log('Notificaciones: migración desde el repositorio · ' + rutas.length + ' archivos de lista');
}

/** Nombre corto de la empresa (el mismo de las carpetas de Drive), guardado 6 horas en memoria. */
function NOT_nombreEmpresa_(cfg, ruc) {
  var c = CacheService.getScriptCache(), k = 'not_emp_' + ruc, v = c.get(k);
  if (v) return v;
  var nom = ruc;
  try { NOT_listarEmpresas_(cfg).forEach(function (e) { if (e.ruc === ruc) nom = NOT_nombreCorto_(e.nombre) || ruc; }); } catch (e) {}
  c.put(k, nom, 21600);
  return nom;
}
