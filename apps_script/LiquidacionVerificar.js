/**
 * LiquidacionVerificar.js — ✔️ VERIFICACIÓN DE CADA COMPROBANTE en la Liquidación IGV (Detalle Compras / Detalle Ventas).
 *
 * Al armar la liquidación (construirLiquidacion_) se agregan AL FINAL de cada Detalle, después de «Origen»
 * (así las fórmulas del tablero no se mueven), estas columnas:
 *   · N/C aplicadas        suma de las notas de crédito (07) que modifican ese comprobante (mismo RUC contraparte)
 *   · N/C (detalle)        cuáles: «FC01-12 −150.00; …»
 *   · Total neto           Total CP menos esas N/C
 *   · Detracción pagada S/ constancia(s) de la hoja «Detracciones · Grupo» cuya referencia es ese comprobante
 *   · Constancia detracción número y fecha de pago
 *   · SSCO                 si la contraparte está en la lista SUNAT de Sujetos Sin Capacidad Operativa (hoja de Cobranzas)
 *   · Validez SUNAT        resultado de la API «Consulta Integrada de Comprobante de Pago» (lo llena el menú
 *                          ✅ Validar comprobantes…, que guarda cada respuesta en la pestaña oculta «_Validez» del archivo)
 * Y en el tablero «Liquidacion», dos columnas al final: «SIRE Ventas» y «SIRE Compras» por mes
 * (✅ Presentado / 🔵 Propuesta / — sin descarga), según lo último que bajó el robot (Aceptada_*.zip / Propuesta_*.zip).
 * Funciones LVER_.
 */

var LVER_COB_ID_ = '1o9nD0mwC-x33X5RXShRIn4PWNOWC5o_ehTJoY6G-Ez0';   // hoja «Cuentas por Cobrar y Pagar · Grupo» (Cobranzas)
var LVER_COLS_ = ['N/C aplicadas', 'N/C (detalle)', 'Total neto', 'Detracción pagada S/', 'Constancia detracción', 'SSCO', 'Validez SUNAT'];
var LVER_HOJA_VALIDEZ_ = '_Validez';
var LVER_CPE_TOKEN_URL_ = 'https://api-seguridad.sunat.gob.pe/v1/clientesextranet/CLIENT_ID/oauth2/token/';
var LVER_CPE_URL_ = 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/RUC/validarcomprobante';
var LVER_TOPE_MS_ = 270000;

/* ============================================================ al armar la liquidación */

/** Agrega las columnas de verificación a «Detalle Compras» y «Detalle Ventas», y el estado SIRE por mes al tablero. */
function LVER_aplicar_(ss, ruc, anio) {
  var fuentes = { ssco: {}, det: { compra: {}, venta: {} } };
  try { fuentes.ssco = LVER_ssco_(); } catch (e) { Logger.log('SSCO: ' + e.message); }
  try { fuentes.det = LVER_detracciones_(ruc); } catch (e) { Logger.log('Detracciones: ' + e.message); }
  var validez = LVER_leerValidez_(ss);
  [['Detalle Compras', 'compra'], ['Detalle Ventas', 'venta']].forEach(function (p) {
    try { LVER_detalle_(ss.getSheetByName(p[0]), p[1], ruc, fuentes, validez); } catch (e) { Logger.log('Verificación ' + p[0] + ': ' + e.message); }
  });
  try { LVER_estadoSire_(ss, ruc, anio); } catch (e) { Logger.log('Estado SIRE por mes: ' + e.message); }
}

/** Índices de las columnas que se usan (por nombre, como el resto de la liquidación). */
function LVER_indices_(enc) {
  var b = function (n) { return buscarIndiceColumna_(enc, n); };
  return { tipo: b('Tipo CP/Doc.'), serie: b('Serie del CDP'), num: b('Nro CP o Doc. Nro Inicial (Rango)'), ruc: b('Nro Doc Identidad'),
    total: b('Total CP'), mon: b('Moneda'), fecha: b('Fecha de emision'), mTipo: b('Tipo CP Modificado'), mSerie: b('Serie CP Modificado'), mNum: b('Nro CP Modificado') };
}
function LVER_tipo_(v) { var t = String(v == null ? '' : v).trim(); return /^\d$/.test(t) ? '0' + t : t; }
function LVER_num_(v) { var n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10); return isNaN(n) ? '' : String(n); }
function LVER_monto_(v) { if (typeof v === 'number') return v; var n = parseFloat(String(v || '').replace(/,/g, '')); return isNaN(n) ? 0 : n; }
/** Clave de un comprobante: RUC contraparte | tipo | serie | número (sin ceros). */
function LVER_clave_(ruc, tipo, serie, num) { return String(ruc || '').replace(/\D/g, '') + '|' + LVER_tipo_(tipo) + '|' + String(serie || '').trim().toUpperCase() + '|' + LVER_num_(num); }

function LVER_detalle_(sh, lado, ruc, fuentes, validez) {
  if (!sh || sh.getLastRow() < 2) return;
  var nCol = sh.getLastColumn(), enc = sh.getRange(1, 1, 1, nCol).getValues()[0].map(String);
  // Si ya estaban (liquidación vieja reescrita a medias), se reescriben en su lugar.
  var ini = enc.indexOf(LVER_COLS_[0]);
  if (ini < 0) ini = nCol; else { enc = enc.slice(0, ini); }
  var I = LVER_indices_(enc);
  if (I.tipo < 0 || I.serie < 0 || I.num < 0) return;
  var n = sh.getLastRow() - 1, v = sh.getRange(2, 1, n, enc.length).getValues();

  // N/C que modifican cada comprobante
  var nc = {};
  v.forEach(function (r) {
    if (LVER_tipo_(r[I.tipo]) !== '07' || I.mSerie < 0 || I.mNum < 0 || !r[I.mSerie]) return;
    var k = LVER_clave_(r[I.ruc], I.mTipo >= 0 && r[I.mTipo] ? r[I.mTipo] : '01', r[I.mSerie], r[I.mNum]);
    var x = nc[k] || (nc[k] = { m: 0, d: [] });
    var m = Math.abs(LVER_monto_(r[I.total]));
    x.m += m; x.d.push(String(r[I.serie]).trim() + '-' + LVER_num_(r[I.num]) + ' −' + m.toFixed(2));
  });

  var det = fuentes.det[lado] || {}, ssco = fuentes.ssco || {};
  var out = v.map(function (r) {
    var t = LVER_tipo_(r[I.tipo]), k = LVER_clave_(r[I.ruc], t, r[I.serie], r[I.num]);
    var x = nc[k], total = LVER_monto_(r[I.total]);
    var d = det[String(r[I.ruc]).replace(/\D/g, '') + '|' + String(r[I.serie]).trim().toUpperCase() + '|' + LVER_num_(r[I.num])];
    var s = ssco[String(r[I.ruc]).replace(/\D/g, '')];
    var vz = validez[LVER_claveValidez_(lado, ruc, r, I)];
    return [
      x ? -Math.round(x.m * 100) / 100 : '',
      x ? x.d.join('; ') : '',
      x ? Math.round((total - x.m) * 100) / 100 : '',
      d ? Math.round(d.m * 100) / 100 : '',
      d ? d.c.join(', ') : '',
      s ? '🔴 SSCO' + (s.publicada ? ' (publicado ' + s.publicada + ')' : '') : '',
      vz ? vz.texto : '',
    ];
  });
  sh.getRange(1, ini + 1, 1, LVER_COLS_.length).setValues([LVER_COLS_]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#6D28D9');
  sh.getRange(2, ini + 1, n, LVER_COLS_.length).setValues(out);
  sh.getRange(2, ini + 1, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, ini + 3, n, 2).setNumberFormat('#,##0.00');
  sh.getRange(1, ini + 1).setNote('✔️ Verificación (LiquidacionVerificar.js): N/C que modifican el comprobante, detracción pagada (hoja Detracciones · Grupo), lista SSCO de SUNAT y validez SUNAT (menú ✅ Validar comprobantes con SUNAT).');
  sh.getRange(1, ini + 7).setNote('Lo llena el menú SIRE SUNAT → ✅ Validar comprobantes con SUNAT (API Consulta Integrada). Vacío = aún no validado.');
  // filtro que incluya las columnas nuevas
  try { var f = sh.getFilter(); if (f) f.remove(); sh.getRange(1, 1, n + 1, ini + LVER_COLS_.length).createFilter(); } catch (e) {}
  // resaltar lo que necesita atención
  var fondos = out.map(function (o) {
    var c = o[5] ? '#FEE2E2' : /❌|NO EXISTE|ANULADO|NO AUTORIZADO|NO HABIDO|BAJA/.test(o[6]) ? '#FEF3C7' : null;
    return LVER_COLS_.map(function () { return c; });
  });
  sh.getRange(2, ini + 1, n, LVER_COLS_.length).setBackgrounds(fondos);
  try { sh.setColumnWidth(ini + 2, 220); sh.setColumnWidth(ini + 7, 230); } catch (e) {}
}

/* ------------------------------------------------ fuentes externas */

/** Lista SSCO que mantiene Cobranzas (pestaña «_SSCO SUNAT»): {ruc: {publicada}}. */
function LVER_ssco_() {
  var c = CacheService.getScriptCache(), z = c.get('lver_ssco');
  if (z) return JSON.parse(z);
  var sh = SpreadsheetApp.openById(LVER_COB_ID_).getSheetByName('_SSCO SUNAT'), m = {};
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r) {
    var ruc = String(r[0]).replace(/\D/g, '');
    if (ruc.length === 11) m[ruc] = { publicada: r[5] instanceof Date ? Utilities.formatDate(r[5], 'America/Lima', 'dd/MM/yyyy') : String(r[5] || '') };
  });
  try { c.put('lver_ssco', JSON.stringify(m), 3600); } catch (e) {}
  return m;
}

/**
 * Detracciones de la empresa (hoja «Detracciones · Grupo», cuyo ID está en ⚙️ Config de Cobranzas, B15):
 * {compra: {rucProveedor|serie|num: {m, c:[constancia dd/mm]}}, venta: {rucCliente|serie|num: …}}
 */
function LVER_detracciones_(ruc) {
  var res = { compra: {}, venta: {} };
  var cob = SpreadsheetApp.openById(LVER_COB_ID_), conf = cob.getSheetByName('⚙️ Config') || cob.getSheets().filter(function (s) { return /config/i.test(s.getName()); })[0];
  var id = conf ? String(conf.getRange('B15').getValue() || '').trim() : '';
  if (!id) return res;
  var sh = SpreadsheetApp.openById(id).getSheetByName('Detracciones');
  if (!sh || sh.getLastRow() < 4) return res;
  var v = sh.getRange(3, 1, sh.getLastRow() - 2, sh.getLastColumn()).getValues();
  var enc = v[0].map(function (h) { return normalizarEncabezado_(h); }), col = function (n) { return enc.indexOf(normalizarEncabezado_(n)); };
  var c = { cons: col('Constancia'), prov: col('RUC proveedor'), adq: col('RUC adquiriente'), ref: col('Ref. documento'), monto: col('Monto S/'), fecha: col('Fecha de pago') };
  if (c.cons < 0 || c.prov < 0 || c.adq < 0 || c.ref < 0 || c.monto < 0) return res;
  var vistos = {};
  v.slice(1).forEach(function (r) {
    var cons = String(r[c.cons]).trim(), m = LVER_monto_(r[c.monto]);
    if (!cons || !(m > 0) || vistos[cons]) return;
    vistos[cons] = 1;
    var prov = String(r[c.prov]).replace(/\D/g, ''), adq = String(r[c.adq]).replace(/\D/g, '');
    var lado = adq === ruc ? 'compra' : prov === ruc ? 'venta' : '';
    if (!lado) return;
    var otro = lado === 'compra' ? prov : adq;
    var f = c.fecha >= 0 && r[c.fecha] instanceof Date ? Utilities.formatDate(r[c.fecha], 'America/Lima', 'dd/MM/yyyy') : '';
    var refs = String(r[c.ref] || '').toUpperCase().match(/[A-Z0-9]{4}\s*-\s*0*\d+/g) || [];
    refs.forEach(function (x, i) {
      var p = x.replace(/\s/g, '').split('-'), k = otro + '|' + p[0] + '|' + LVER_num_(p[1]);
      var y = res[lado][k] || (res[lado][k] = { m: 0, c: [] });
      if (i === 0) y.m += m;   // una constancia de varias facturas: el monto va a la primera
      y.c.push(cons + (f ? ' (' + f + ')' : '') + (refs.length > 1 ? ' [' + refs.length + ' comprobantes]' : ''));
    });
  });
  return res;
}

/* ------------------------------------------------ estado SIRE por mes (tablero) */

/** «SIRE Ventas» / «SIRE Compras» por mes al final del tablero, según los ZIP que guardó el robot (Aceptada = presentado). */
function LVER_estadoSire_(ss, ruc, anio) {
  var sh = ss.getSheetByName('Liquidacion');
  if (!sh) return;
  var cfg = cargarConfigGitHub_();
  var resp = githubFetch_(cfg, '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO + '/git/trees/' + encodeURIComponent(cfg.GITHUB_BRANCH + ':sire/' + ruc + '/historico') + '?recursive=1', { aceptar404: true });
  var est = {};
  if (resp) (JSON.parse(resp.getContentText()).tree || []).forEach(function (t) {
    var m = String(t.path).match(/^(\d{6})\/(Aceptada|Propuesta)_(compra|venta)\.zip$/);
    if (!m || m[1].slice(0, 4) !== String(anio)) return;
    var k = m[1] + '|' + m[3];
    if (m[2] === 'Aceptada' || !est[k]) est[k] = m[2];
  });
  var ultima = sh.getLastColumn(), enc = sh.getRange(1, 1, 1, ultima).getValues()[0].map(String);
  var col = enc.indexOf('SIRE Ventas');
  col = col >= 0 ? col + 1 : ultima + 1;
  var txt = function (x) { return x === 'Aceptada' ? '✅ Presentado' : x === 'Propuesta' ? '🔵 Propuesta' : '—'; };
  var filas = [];
  for (var mes = 1; mes <= 12; mes++) {
    var p = anio + ('0' + mes).slice(-2);
    filas.push([txt(est[p + '|venta']), txt(est[p + '|compra'])]);
  }
  sh.getRange(1, col, 1, 2).setValues([['SIRE Ventas', 'SIRE Compras']]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#6D28D9');
  sh.getRange(2, col, 12, 2).setValues(filas).setHorizontalAlignment('center');
  sh.getRange(1, col).setNote('Estado del registro en el SIRE según la última descarga: ✅ Presentado (SUNAT entregó el registro generado/aceptado) · 🔵 Propuesta (el mes aún no se presenta: es la propuesta de SUNAT) · — sin descarga.');
  try { sh.setColumnWidth(col, 110); sh.setColumnWidth(col + 1, 110); } catch (e) {}
}

/* ============================================================ ✅ validez SUNAT (API Consulta Integrada) */

/** Clave de validación: RUC EMISOR|tipo|serie|número (compras: el proveedor; ventas: la propia empresa). */
function LVER_claveValidez_(lado, ruc, r, I) {
  var emisor = lado === 'compra' ? String(r[I.ruc]).replace(/\D/g, '') : String(ruc);
  return emisor + '|' + LVER_tipo_(r[I.tipo]) + '|' + String(r[I.serie]).trim().toUpperCase() + '|' + LVER_num_(r[I.num]);
}
function LVER_leerValidez_(ss) {
  var sh = ss.getSheetByName(LVER_HOJA_VALIDEZ_), m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) { if (r[0]) m[String(r[0])] = { estado: String(r[1]), texto: String(r[2]), cuando: r[3] }; });
  return m;
}

function menuValidarComprobantes() {
  var html = HtmlService.createHtmlOutput(LVER_HTML_).setWidth(560).setHeight(470);
  SpreadsheetApp.getUi().showModalDialog(html, '✅ Validar comprobantes con SUNAT');
}

function LVER_datos() {
  var emp = [];
  try { emp = listarEmpresasGitHub_(cargarConfigGitHub_(), true).map(function (e) { return { ruc: String(e.ruc), nombre: String(e.nombre || '') }; }); } catch (e) {}
  var c = PropertiesService.getUserProperties().getProperty('LVER_CPE');
  return { empresas: emp, anio: new Date().getFullYear(), conCred: !!c, cola: JSON.parse(PropertiesService.getScriptProperties().getProperty('LVER_COLA') || '[]') };
}
function LVER_guardarCred(c) {
  c = c || {};
  var o = { ruc: String(c.ruc || '').replace(/\D/g, ''), id: String(c.id || '').trim(), s: String(c.s || '').trim() };
  if (o.ruc.length !== 11 || !o.id || !o.s) throw new Error('Faltan datos: RUC de la empresa dueña de la credencial, client_id y client_secret.');
  LVER_token_(o, true);   // se prueba antes de guardar
  PropertiesService.getUserProperties().setProperty('LVER_CPE', JSON.stringify(o));
  return true;
}

/** Encola empresas/año y arranca. rucs: [] = todas. */
function LVER_validar(rucs, anio) {
  var cred = PropertiesService.getUserProperties().getProperty('LVER_CPE');
  if (!cred) throw new Error('Primero guarde la credencial de la API (client_id y client_secret).');
  if (!rucs || !rucs.length) rucs = listarEmpresasGitHub_(cargarConfigGitHub_(), true).map(function (e) { return String(e.ruc); });
  var cola = rucs.map(function (r) { return { ruc: r, anio: Number(anio) || new Date().getFullYear() }; });
  PropertiesService.getScriptProperties().setProperty('LVER_COLA', JSON.stringify(cola));
  return LVER_continuar();
}

/** Trabaja hasta ~4,5 min y, si queda algo, se programa de nuevo en 1 minuto. */
function LVER_continuar() {
  var props = PropertiesService.getScriptProperties(), t0 = Date.now();
  var cola = JSON.parse(props.getProperty('LVER_COLA') || '[]'), hechos = [];
  // el disparador corre como quien lo pidió: su credencial está en SUS propiedades (nunca en las del script)
  var cred = JSON.parse(PropertiesService.getUserProperties().getProperty('LVER_CPE') || 'null');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'LVER_continuar') ScriptApp.deleteTrigger(t); });
  if (!cola.length || !cred) return { listo: true, texto: cola.length ? 'Falta la credencial de la API.' : 'No hay nada pendiente.' };
  var token = LVER_token_(cred);
  while (cola.length && Date.now() - t0 < LVER_TOPE_MS_) {
    var it = cola[0], r = LVER_validarEmpresa_(it.ruc, it.anio, cred, token, t0);
    hechos.push(r.texto);
    if (r.completo) cola.shift(); else break;
  }
  props.setProperty('LVER_COLA', JSON.stringify(cola));
  if (cola.length) ScriptApp.newTrigger('LVER_continuar').timeBased().after(60000).create();
  return { listo: !cola.length, texto: hechos.join('\n') + (cola.length ? '\n⏳ Sigue sola en segundo plano (' + cola.length + ' empresa(s) por terminar).' : '') };
}

/** Valida lo que falta de una liquidación (nuevo, o «no existe» de hace más de 3 días) y repinta su columna. */
function LVER_validarEmpresa_(ruc, anio, cred, token, t0) {
  var ss;
  try { ss = obtenerOCrearSpreadsheetEnCarpeta_(obtenerCarpetaRUC_(obtenerCarpetaRaiz_(), ruc), 'Liquidacion IGV ' + ruc + ' - ' + anio); }
  catch (e) { return { completo: true, texto: ruc + ': no se encontró su liquidación ' + anio }; }
  var validez = LVER_leerValidez_(ss), pend = [], vistos = {};
  [['Detalle Compras', 'compra'], ['Detalle Ventas', 'venta']].forEach(function (p) {
    var sh = ss.getSheetByName(p[0]);
    if (!sh || sh.getLastRow() < 2) return;
    var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String), I = LVER_indices_(enc);
    if (I.tipo < 0 || I.serie < 0 || I.num < 0) return;
    sh.getRange(2, 1, sh.getLastRow() - 1, enc.length).getValues().forEach(function (r) {
      var t = LVER_tipo_(r[I.tipo]);
      if (['01', '03', '07', '08', '04'].indexOf(t) < 0 || !r[I.serie]) return;
      var k = LVER_claveValidez_(p[1], ruc, r, I);
      if (vistos[k]) return; vistos[k] = 1;
      var y = validez[k];
      if (y && !(y.estado === '0' && (!(y.cuando instanceof Date) || Date.now() - y.cuando.getTime() > 3 * 86400000))) return;
      var f = r[I.fecha], fecha = f instanceof Date ? Utilities.formatDate(f, 'America/Lima', 'dd/MM/yyyy') : String(f || '').trim().replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1');
      pend.push({ k: k, numRuc: k.split('|')[0], codComp: t, numeroSerie: String(r[I.serie]).trim().toUpperCase(), numero: Number(LVER_num_(r[I.num])), fechaEmision: fecha, monto: Math.abs(LVER_monto_(r[I.total])).toFixed(2) });
    });
  });
  var nuevos = [], url = LVER_CPE_URL_.replace('RUC', cred.ruc);
  for (var i = 0; i < pend.length && Date.now() - t0 < LVER_TOPE_MS_; i += 10) {
    var lote = pend.slice(i, i + 10);
    var resps = UrlFetchApp.fetchAll(lote.map(function (p) {
      return { url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ numRuc: p.numRuc, codComp: p.codComp, numeroSerie: p.numeroSerie, numero: p.numero, fechaEmision: p.fechaEmision, monto: p.monto }) };
    }));
    resps.forEach(function (rr, j) {
      var x = LVER_leerRespuesta_(rr);
      if (x) nuevos.push([lote[j].k, x.estado, x.texto, new Date()]);
    });
    if (resps.some(function (rr) { return rr.getResponseCode() === 429; })) Utilities.sleep(5000);
  }
  if (nuevos.length) {
    var sh = ss.getSheetByName(LVER_HOJA_VALIDEZ_) || ss.insertSheet(LVER_HOJA_VALIDEZ_);
    if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, 4).setValues([['Comprobante (emisor|tipo|serie|número)', 'estadoCp', 'Resultado', 'Consultado']]);
    // reemplaza los que ya estaban (reconsultas) y agrega los nuevos
    var todo = LVER_leerValidez_(ss);
    nuevos.forEach(function (n) { todo[n[0]] = { estado: n[1], texto: n[2], cuando: n[3] }; });
    var filas = Object.keys(todo).map(function (k) { return [k, todo[k].estado, todo[k].texto, todo[k].cuando]; });
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 4).clearContent();
    sh.getRange(2, 1, filas.length, 4).setValues(filas);
    try { sh.hideSheet(); } catch (e) {}
    // repinta la columna «Validez SUNAT»
    var fuentes = { ssco: {}, det: { compra: {}, venta: {} } };
    try { fuentes.ssco = LVER_ssco_(); } catch (e) {}
    try { fuentes.det = LVER_detracciones_(ruc); } catch (e) {}
    [['Detalle Compras', 'compra'], ['Detalle Ventas', 'venta']].forEach(function (p) { try { LVER_detalle_(ss.getSheetByName(p[0]), p[1], ruc, fuentes, LVER_leerValidez_(ss)); } catch (e) {} });
  }
  var completo = nuevos.length >= pend.length;
  var malos = nuevos.filter(function (n) { return n[1] !== '1' && n[1] !== '3'; }).length;
  return { completo: completo, texto: ruc + ' ' + anio + ': ' + nuevos.length + ' validado(s)' + (malos ? ' · ⚠️ ' + malos + ' a revisar' : '') + (completo ? '' : ' (faltan ' + (pend.length - nuevos.length) + ')') };
}

var LVER_EST_CP_ = { '0': '❌ NO EXISTE en SUNAT', '1': '✅ Aceptado', '2': '❌ ANULADO (baja)', '3': '✅ Autorizado (imprenta)', '4': '❌ NO AUTORIZADO' };
var LVER_EST_RUC_ = { '00': '', '01': 'RUC baja provisional', '02': 'RUC baja prov. de oficio', '03': 'RUC suspensión temporal', '10': 'RUC BAJA DEFINITIVA', '11': 'RUC BAJA DE OFICIO', '22': 'RUC inhabilitado' };
var LVER_DOMI_ = { '00': '', '09': 'domicilio pendiente', '11': 'domicilio por verificar', '12': 'NO HABIDO', '20': 'NO HALLADO' };
function LVER_leerRespuesta_(rr) {
  var cod = rr.getResponseCode();
  if (cod !== 200) return null;   // se reintenta en la próxima vuelta
  var j; try { j = JSON.parse(rr.getContentText()); } catch (e) { return null; }
  if (!j.success || !j.data) return { estado: 'E', texto: '⚠️ ' + String(j.message || 'sin respuesta').slice(0, 120) };
  var d = j.data, e = String(d.estadoCp), extra = [LVER_EST_RUC_[d.estadoRuc] || (d.estadoRuc ? 'RUC ' + d.estadoRuc : ''), LVER_DOMI_[d.condDomiRuc] || ''].filter(String);
  var obs = (d.observaciones || d.Observaciones || []).join('; ');
  return { estado: e, texto: (LVER_EST_CP_[e] || 'estado ' + e) + (extra.length ? ' · ' + extra.join(' · ') : '') + (obs ? ' · ' + obs.slice(0, 120) : '') };
}

/** Token de la API Consulta Integrada: SOLO client_id y client_secret (grant_type client_credentials). */
function LVER_token_(cred, probar) {
  var c = CacheService.getScriptCache(), k = 'lver_tk_' + cred.id.slice(0, 12), t = probar ? null : c.get(k);
  if (t) return t;
  var r = UrlFetchApp.fetch(LVER_CPE_TOKEN_URL_.replace('CLIENT_ID', encodeURIComponent(cred.id)), { method: 'post', muteHttpExceptions: true,
    contentType: 'application/x-www-form-urlencoded',
    payload: { grant_type: 'client_credentials', scope: 'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes', client_id: cred.id, client_secret: cred.s } });
  if (r.getResponseCode() !== 200) throw new Error('SUNAT no aceptó la credencial de la API (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 200));
  var d = JSON.parse(r.getContentText());
  if (!d.access_token) throw new Error('SUNAT no devolvió el token.');
  c.put(k, d.access_token, Math.max(60, Math.min(3000, Number(d.expires_in || 3600) - 300)));
  return d.access_token;
}

var LVER_HTML_ = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  'body{font:13px Arial,sans-serif;margin:0;padding:12px;color:#222}label{display:block;margin:8px 0 3px;color:#475569;font-size:12px}',
  'input,select{padding:6px;width:100%;box-sizing:border-box}.fila{display:flex;gap:8px}.fila>div{flex:1}',
  'button{padding:8px 14px;border:0;border-radius:6px;background:#1D4ED8;color:#fff;cursor:pointer;margin-top:10px}button.g{background:#6b7280}button:disabled{opacity:.5}',
  '#cred{border:1px solid #FDE68A;background:#FFFBEB;border-radius:8px;padding:8px;margin-top:10px}#out{margin-top:10px;white-space:pre-wrap}',
  '</style></head><body>',
  '<div style="color:#475569">Consulta cada factura, boleta y nota en la API <b>Consulta Integrada de Comprobantes</b> de SUNAT (¿existe?, ¿anulada?, RUC activo y habido) y escribe el resultado en la columna <b>Validez SUNAT</b> de la liquidación. Solo valida lo que falta; sigue sola en segundo plano si son muchas.</div>',
  '<div class="fila"><div><label>Empresa</label><select id="emp"></select></div><div><label>Año</label><input id="anio"></div></div>',
  '<div id="cred" style="display:none"><b>🔑 Credencial de la API (solo client_id y client_secret)</b><div style="color:#64748B;font-size:12px">Se genera en SOL → Credenciales de API SUNAT. Sirve una sola credencial para validar todo. Se guarda solo para usted.</div>',
  '<label>RUC de la empresa dueña de esa credencial</label><input id="cr" inputmode="numeric" maxlength="11">',
  '<div class="fila"><div><label>client_id</label><input id="ci" autocomplete="off"></div><div><label>client_secret</label><input id="cs" type="password" autocomplete="new-password"></div></div></div>',
  '<button id="bV" onclick="validar()">✅ Validar</button> <button class="g" onclick="document.getElementById(\'cred\').style.display=\'block\'">🔑 Cambiar credencial</button> <button class="g" onclick="google.script.host.close()">Cerrar</button>',
  '<div id="out"></div>',
  '<script>',
  'var D=null,$=function(i){return document.getElementById(i)};',
  'function esc(t){return String(t==null?"":t).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}',
  'google.script.run.withSuccessHandler(function(d){D=d;$("anio").value=d.anio;$("emp").innerHTML="<option value=\\"\\">🏢 Todas las empresas</option>"+d.empresas.map(function(e){return"<option value=\\""+e.ruc+"\\">"+esc(e.nombre)+" ("+e.ruc+")</option>"}).join("");if(!d.conCred)$("cred").style.display="block";if(d.cola&&d.cola.length)$("out").textContent="⏳ Hay una validación en curso ("+d.cola.length+" empresa(s) por terminar)."}).LVER_datos();',
  'function validar(){',
  ' var go=function(){$("bV").disabled=true;var t0=Date.now(),tm=setInterval(function(){$("out").textContent="⏳ Consultando a SUNAT… "+Math.round((Date.now()-t0)/1000)+" s"},1000);',
  '  google.script.run.withFailureHandler(function(e){clearInterval(tm);$("bV").disabled=false;$("out").textContent="❌ "+e.message}).withSuccessHandler(function(r){clearInterval(tm);$("bV").disabled=false;$("out").textContent=(r.listo?"✅ Listo\\n":"")+r.texto}).LVER_validar($("emp").value?[$("emp").value]:[],$("anio").value)};',
  ' if($("cred").style.display==="block"){var c={ruc:$("cr").value,id:$("ci").value,s:$("cs").value};if(!c.ruc||!c.id||!c.s)return alert("Complete RUC, client_id y client_secret.");',
  '  $("out").textContent="⏳ Probando la credencial con SUNAT…";google.script.run.withFailureHandler(function(e){$("out").textContent="❌ "+e.message}).withSuccessHandler(function(){$("cs").value="";$("cred").style.display="none";go()}).LVER_guardarCred(c);return}',
  ' go()}',
  '</script></body></html>'
].join('\n');
