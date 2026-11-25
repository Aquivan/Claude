/**
 * RucVentana.js (ventana: RucVista.html) — 🔎 IDENTIFICAR RUC DE LOS PROVEEDORES, la misma ventana en todos lados:
 *   · menú 🧠 Asistente IA de esta hoja (menuIdentificarRucFilas),
 *   · menú 🧠 Asistente IA de la hoja de Vouchers (vouchers_ia: el workflow copia RucVista.html y cambia RUCV_x → VIA_x,
 *     que le piden lo mismo a Cobranzas por ?canal=vch),
 *   · 🧩 Mesa de conciliación (MESA_rucVentana / MESA_ruc: la ventana va dentro de la Mesa).
 * Todas usan las mismas funciones de TG_Procesados.js (TGQ_), así lo que se mejora sirve en las tres. Funciones RUCV_.
 */

function RUCV_ss_() { return TG_ss_(); }

/** HTML de la ventana con sus datos iniciales (filas ya buscadas o, sin filas, el selector de vouchers sin RUC). */
function RUCV_html_(datos) {
  var d = JSON.stringify(datos || { filas: [], texto: '', ids: [], faltan: 0, detalle: [], sinFilas: true }).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutputFromFile('RucVista').getContent().replace('__DATOS__', function () { return d; });
}

/** Menú 🧠 Asistente IA → 🔎 Identificar RUC: aquí no hay filas de Vouchers seleccionadas; se abre con el selector (📋 Elegir vouchers sin RUC). */
function menuIdentificarRucFilas() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(RUCV_html_(null)).setWidth(680).setHeight(580), '🔎 Identificar RUC de los proveedores');
}

/* ------------------------------------------------ lo que pide la ventana (los mismos nombres que en la hoja de Vouchers) */

function RUCV_try_(fn) { try { return fn(); } catch (e) { return { error: '❌ ' + (e && e.message || e) }; } }
function RUCV_rucEscribir(ids) { return RUCV_try_(function () { return ANX_aplicarDet_(RUCV_ss_(), ids || [], false); }); }
function RUCV_rucExternos(filas, todos) { return RUCV_try_(function () { return TGQ_rucExternos_(RUCV_ss_(), (filas || []).slice(0, 2000), !!todos); }); }
function RUCV_rucOpciones(nombre) { return RUCV_try_(function () { return TGQ_rucOpciones_(RUCV_ss_(), nombre); }); }
function RUCV_rucAliasBorrar(prov) { return RUCV_try_(function () { return TGQ_aliasBorrar_(RUCV_ss_(), prov); }); }
function RUCV_rucUltimas() { return RUCV_try_(function () { return TGQ_rucUltimas_(); }); }
function RUCV_rucEstado(id) { return RUCV_try_(function () { return TGQ_rucEstado_(String(id || '')); }); }
function RUCV_rucOtro(nombre, filas) { return RUCV_try_(function () { return TGQ_rucOtroNombre_(RUCV_ss_(), nombre, filas); }); }
function RUCV_rucElegirVarios(lista) { return RUCV_try_(function () { MESA_tocar_(); return TGQ_rucElegirVarios_(RUCV_ss_(), lista); }); }
function RUCV_rucElegir(prov, filas, ruc, det, reemplazarAlias) {
  return RUCV_try_(function () { MESA_tocar_(); return TGQ_rucElegirFilas_(RUCV_ss_(), prov, filas, ruc, det, !!reemplazarAlias); });
}
function RUCV_rucCandidatos() { return RUCV_try_(function () { return TGQ_rucCandidatos_(RUCV_ss_()); }); }
/** Busca el RUC de las filas elegidas (lo mismo que abrir la ventana con esas filas). */
function RUCV_rucFilas(filas) {
  return RUCV_try_(function () {
    filas = (filas || []).filter(function (k) { return /^(Originales|Fotos)!\d+$/.test(String(k)); }).slice(0, 300);
    var r = TGQ_rucDeFilas_(RUCV_ss_(), filas);
    if (r.error) return r;
    return { filas: filas, texto: r.texto || '', ids: (r.cambios || []).map(function (x) { return x.id; }), faltan: r.faltan || 0, detalle: r.detalle || [] };
  });
}

/* ------------------------------------------------ 🔍 Leer el voucher con IA: lo hace la hoja de Vouchers (su puente del portal) */

function RUCV_puente_(op, p) {
  var cfg = leerConfig_(RUCV_ss_());
  if (!cfg.idVouchers) throw new Error('Falta la hoja de Vouchers en ⚙️ Configuración.');
  var hoja = SpreadsheetApp.openById(cfg.idVouchers);
  var meta = function (k) { var m = hoja.createDeveloperMetadataFinder().withKey(k).find(); return m.length ? String(m[0].getValue() || '') : ''; };
  var url = meta('PV_HOJA'), k = meta('PV_PUENTE');
  if (!/^https:\/\/script\.google\.com\//.test(url) || k.length < 40)
    throw new Error('Para leer el voucher con IA desde aquí falta el puente con la hoja de Vouchers (se registra al desplegar el Portal de Vouchers). Mientras tanto use esta opción desde la hoja de Vouchers.');
  var q = { portal: '1', k: k, op: op };
  Object.keys(p || {}).forEach(function (x) { q[x] = p[x]; });
  var r = UrlFetchApp.fetch(url + '?' + Object.keys(q).map(function (x) { return x + '=' + encodeURIComponent(q[x]); }).join('&'), { muteHttpExceptions: true, followRedirects: true });
  try { return JSON.parse(r.getContentText()); } catch (e) { throw new Error('La hoja de Vouchers no respondió bien (código ' + r.getResponseCode() + ').'); }
}
function RUCV_rucLeer(hoja, fila) {
  return RUCV_try_(function () {
    if (['Originales', 'Fotos'].indexOf(String(hoja)) === -1) throw new Error('Pestaña no válida.');
    var r = RUCV_puente_('releer', { hoja: String(hoja), fila: Number(fila) });
    if (!r.ok) throw new Error(r.error || 'No se pudo leer.');
    return { id: r.id };
  });
}
/** Resultado de la lectura + RUC posibles para el nombre leído. Nunca escribe. */
function RUCV_rucLeerEstado(id) {
  try {
    var r = RUCV_puente_('releerEstado', { id: String(id || '') });
    if (!r.listo) return { listo: false };
    if (r.error) return { listo: true, error: r.error };
    var v = (r.leidos || [])[0] || {}, prov = String(v.proveedor || '').trim(), ops = [];
    if (prov.length >= 3) { var o = TGQ_rucOpciones_(RUCV_ss_(), prov); ops = (o && o.opciones) || []; }
    return { listo: true, proveedor: prov, idv: String(v.idCliente || '').replace(/\D/g, ''), linea: (r.lineas || [])[0] || '', antes: r.antes || '', opciones: ops.slice(0, 8) };
  } catch (e) { return { listo: true, error: e.message }; }
}

/** Funciones que la ventana puede pedir (desde la Mesa pasan por MESA_ruc con su llave). */
var RUCV_FN_ = {
  RUCV_rucEscribir: RUCV_rucEscribir, RUCV_rucExternos: RUCV_rucExternos, RUCV_rucOpciones: RUCV_rucOpciones, RUCV_rucAliasBorrar: RUCV_rucAliasBorrar,
  RUCV_rucUltimas: RUCV_rucUltimas, RUCV_rucEstado: RUCV_rucEstado, RUCV_rucOtro: RUCV_rucOtro, RUCV_rucElegirVarios: RUCV_rucElegirVarios,
  RUCV_rucElegir: RUCV_rucElegir, RUCV_rucCandidatos: RUCV_rucCandidatos, RUCV_rucFilas: RUCV_rucFilas, RUCV_rucLeer: RUCV_rucLeer, RUCV_rucLeerEstado: RUCV_rucLeerEstado
};

/* ------------------------------------------------ 📋 vouchers sin RUC de la hoja de Vouchers (para elegir sin saber las filas) */

/** → {filas: [[hoja, fila, aaaammdd, fecha, banco, moneda, monto, proveedor, empresa, procesado aaaammdd, archivo]], ultimoProc} */
function TGQ_rucCandidatos_(ss) {
  var cfg = leerConfig_(ss);
  if (!cfg.idVouchers) throw new Error('Falta la hoja de Vouchers en ⚙️ Configuración.');
  var vs = SpreadsheetApp.openById(cfg.idVouchers), out = [], ultimo = '', tz = vs.getSpreadsheetTimeZone() || 'America/Lima';
  var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); };
  ['Originales', 'Fotos'].forEach(function (nombre) {
    var sh = vs.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var nCol = sh.getLastColumn(), tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0].map(norm);
    var col = function (re, def) { var i = tit.findIndex(function (t) { return re.test(t); }); return i >= 0 ? i : def; };
    var I = { f: col(/^fecha de dep|^fecha dep/, 0), op: col(/^numero de op|^n.? de op|^n.? op/, 1), b: col(/^banco/, 2), mon: col(/^moneda/, 3), m: col(/^monto/, 4),
      p: col(/^proveedor|^beneficiario/, 5), emp: col(/^empresa/, -1), idb: col(/^id benef/, -1), proc: col(/^fecha de proc|^procesad/, 11), arch: col(/^archivo/, 10) };
    if (I.idb < 0) return;
    var n = sh.getLastRow() - 1, v = sh.getRange(2, 1, n, nCol).getValues();
    for (var r = 0; r < n; r++) {
      var x = v[r], pr = x[I.proc] instanceof Date ? Utilities.formatDate(x[I.proc], tz, 'yyyyMMdd') : '';
      if (pr > ultimo) ultimo = pr;
      var prov = String(x[I.p] || '').trim();
      if (!prov || String(x[I.idb] || '').replace(/\D/g, '') || /DUPLICADO/i.test(String(x[I.op] || ''))) continue;
      var f = x[I.f] instanceof Date ? x[I.f] : null;
      out.push([nombre, r + 2, f ? Utilities.formatDate(f, tz, 'yyyyMMdd') : '', f ? Utilities.formatDate(f, tz, 'dd/MM/yyyy') : String(x[I.f] || ''),
        String(x[I.b] || ''), String(x[I.mon] || ''), Number(x[I.m]) || 0, prov, I.emp >= 0 ? String(x[I.emp] || '') : '', pr, String(x[I.arch] || '')]);
    }
  });
  return { filas: out, ultimoProc: ultimo };
}
