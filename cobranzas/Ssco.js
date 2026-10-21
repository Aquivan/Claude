/**
 * Ssco.js — ⚠️ Sujetos Sin Capacidad Operativa (SSCO) publicados por SUNAT.
 *
 * SUNAT publica cada mes (D. Leg. 1532) la relación de SSCO con resolución firme en
 *   https://www.sunat.gob.pe/padronesnotificaciones/sujeSinCapacidadOperativa.html
 * y sus datos en un Excel (Hoja1: RUC, Razón social, Domicilio fiscal, Resolución de atribución,
 * Fecha de emisión, Fecha en que quedó firme, representante legal, Fecha de publicación).
 * Los comprobantes de un SSCO no dan crédito fiscal ni sustentan costo o gasto; el comprador
 * tiene 30 días hábiles desde la publicación para pedir que SUNAT revise su caso.
 *
 *   _SSCO SUNAT (oculta)  la lista completa; se baja con los padrones (cada semana y con el menú).
 *   ⚠️ SSCO               proveedores / clientes / empresas del grupo que están en la lista, con sus
 *                         facturas, el plazo para pedir la revisión y el IGV en riesgo.
 *   📋 Documentos         el RUC y nombre del proveedor quedan en rojo con una nota.
 *   Telegram              aviso (con 📬 Notificaciones SUNAT), consulta "¿es SSCO?" y alerta en 🧾 Procesar.
 */

var SSCO_URL_ = 'https://www.sunat.gob.pe/padronesnotificaciones/ssco/sujesincapacidadOperativa.xlsx';
var SSCO_PAGINA_ = 'https://www.sunat.gob.pe/padronesnotificaciones/sujeSinCapacidadOperativa.html';
var SSCO_HOJA_ = '_SSCO SUNAT';
var SSCO_PESTANA_ = '⚠️ SSCO';
var SSCO_ENC_ = ['RUC', 'Razón social', 'Resolución de atribución', 'Emitida', 'Quedó firme', 'Publicada', 'Domicilio fiscal'];
var SSCO_ROJO_ = '#FECACA';

/* ============================================================ descarga y lectura */

/** Descarga el Excel de SUNAT y devuelve [[ruc, nombre, resolucion, emitida, firme, publicada, domicilio]]. */
function SSCO_bajar_() {
  var r = UrlFetchApp.fetch(SSCO_URL_, { muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' } });
  if (r.getResponseCode() !== 200) throw new Error('SUNAT respondió ' + r.getResponseCode());
  return SSCO_leerXlsx_(r.getBlob());
}

/** Lee la primera hoja de un .xlsx sin servicios extra (es un zip con XML). */
function SSCO_leerXlsx_(blob) {
  var partes = {};
  Utilities.unzip(blob.setContentType('application/zip')).forEach(function (b) { partes[b.getName()] = b; });
  var hoja = partes['xl/worksheets/sheet1.xml'];
  if (!hoja) throw new Error('el Excel no trae hojas');
  var dec = function (s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&');
  };
  var textos = [];
  if (partes['xl/sharedStrings.xml']) {
    (partes['xl/sharedStrings.xml'].getDataAsString('UTF-8').match(/<si>[\s\S]*?<\/si>/g) || []).forEach(function (si) {
      textos.push((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(function (t) { return dec(t.replace(/<[^>]+>/g, '')); }).join(''));
    });
  }
  var col = function (ref) { var l = ref.replace(/\d+/g, ''), n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + l.charCodeAt(i) - 64; return n - 1; };
  var filas = [];
  (hoja.getDataAsString('UTF-8').match(/<row[\s\S]*?<\/row>/g) || []).forEach(function (row) {
    var f = [];
    (row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(function (c) {
      var ref = (c.match(/\br="([A-Z]+)\d+"/) || [])[1];
      if (!ref) return;
      var t = (c.match(/\bt="(\w+)"/) || [])[1], v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      var val = t === 's' ? textos[+v] : t === 'inlineStr' ? dec((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '') : (v == null ? '' : dec(v));
      f[col(ref)] = val == null ? '' : val;
    });
    filas.push(f);
  });
  return SSCO_interpretar_(filas);
}

/** Filas crudas del Excel → [[ruc, nombre, resolucion, emitida, firme, publicada, domicilio]] (busca las columnas por su título). */
function SSCO_interpretar_(filas) {
  var iEnc = -1, I = {};
  for (var i = 0; i < Math.min(filas.length, 15) && iEnc < 0; i++) {
    var enc = (filas[i] || []).map(function (h) { return normHeader_(h); });
    if (enc.indexOf('ruc') >= 0) iEnc = i; else continue;
    var b = function (rx) { for (var j = 0; j < enc.length; j++) if (rx.test(enc[j] || '')) return j; return -1; };
    I = { ruc: enc.indexOf('ruc'), nombre: b(/razon social/), resol: b(/^resolucion/), emitida: b(/fecha de emision/),
      firme: b(/quedo firme|firme/), pub: b(/fecha de publicacion/), dom: b(/domicilio/) };
  }
  if (iEnc < 0) throw new Error('no encontré la columna RUC en el Excel');
  var fecha = function (v) {
    if (v === '' || v == null) return '';
    if (/^\d+(\.\d+)?$/.test(String(v))) return new Date(Math.round((Date.UTC(1899, 11, 30) + Number(v) * 864e5) / 864e5) * 864e5 + 12 * 36e5);
    return aFecha_(v) || '';
  };
  var out = [], visto = {};
  filas.slice(iEnc + 1).forEach(function (f) {
    var ruc = String(f[I.ruc] == null ? '' : f[I.ruc]).replace(/\.0+$/, '').replace(/\D/g, '');
    if (ruc.length !== 11 || visto[ruc]) return;
    visto[ruc] = true;
    var g = function (k) { return I[k] >= 0 && f[I[k]] != null ? String(f[I[k]]).trim() : ''; };
    out.push([ruc, g('nombre'), g('resol'), fecha(f[I.emitida]), fecha(f[I.firme]), fecha(f[I.pub]), g('dom')]);
  });
  if (!out.length) throw new Error('el Excel no trae RUC');
  return out;
}

/** Baja la lista y la guarda en _SSCO SUNAT. Devuelve un texto con el resultado (no lanza error). */
function SSCO_actualizar_(ss) {
  var filas;
  try { filas = SSCO_bajar_(); } catch (e) { return 'SSCO: ❌ ' + e.message + ' (queda la lista anterior)'; }
  var sh = ss.getSheetByName(SSCO_HOJA_);
  if (!sh) { sh = ss.insertSheet(SSCO_HOJA_); sh.hideSheet(); }
  sh.clear();
  sh.getRange(1, 1, 1, SSCO_ENC_.length).setValues([SSCO_ENC_]).setFontWeight('bold');
  sh.getRange(2, 1, filas.length, 1).setNumberFormat('@');
  sh.getRange(2, 1, filas.length, SSCO_ENC_.length).setValues(filas);
  sh.getRange(2, 4, filas.length, 3).setNumberFormat('dd/mm/yyyy');
  var ult = filas.reduce(function (m, f) { return f[5] && (!m || f[5] > m) ? f[5] : m; }, null);
  var info = 'SSCO: ' + filas.length + ' contribuyentes (última publicación ' + (ult ? Utilities.formatDate(ult, 'America/Lima', 'dd/MM/yyyy') : '?') + ')';
  var props = PropertiesService.getDocumentProperties();
  props.setProperty('ssco_info', info + ' · revisada el ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy'));
  return info;
}

/** Mapa ruc → {nombre, resolucion, emitida, firme, publicada}. Si nunca se bajó, la baja ahora. */
function SSCO_leer_(ss) {
  var sh = ss.getSheetByName(SSCO_HOJA_);
  if (!sh || sh.getLastRow() < 2) { SSCO_actualizar_(ss); sh = ss.getSheetByName(SSCO_HOJA_); }
  var mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;
  sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r) {
    var ruc = String(r[0]).replace(/\D/g, '');
    if (ruc.length === 11) mapa[ruc] = { nombre: String(r[1] || ''), resolucion: String(r[2] || ''), emitida: aFecha_(r[3]), firme: aFecha_(r[4]), publicada: aFecha_(r[5]) };
  });
  return mapa;
}

/** Un RUC (para el bot y 🧾 Procesar). null si no está en la lista. */
function SSCO_ruc_(ss, ruc) {
  ruc = String(ruc || '').replace(/\D/g, '');
  if (ruc.length !== 11) return null;
  var c = CacheService.getScriptCache(), k = 'ssco_' + ruc, x = c.get(k);
  if (x) return x === '-' ? null : JSON.parse(x);
  var m = SSCO_leer_(ss)[ruc] || null;
  if (m) m.plazo = SSCO_plazo_(m.publicada);
  c.put(k, m ? JSON.stringify(m) : '-', 21600);
  return m && JSON.parse(JSON.stringify(m));
}

/** Último día para pedir la revisión: 30 días hábiles (lunes a viernes) desde el día siguiente a la publicación. Aproximado: no descuenta feriados. */
function SSCO_plazo_(pub) {
  pub = aFecha_(pub);
  if (!pub) return null;
  var d = new Date(pub.getTime()), n = 0;
  while (n < 30) { d = new Date(d.getTime() + 864e5); if (d.getDay() !== 0 && d.getDay() !== 6) n++; }
  return d;
}

/** Texto corto para avisos: "⚠️ SSCO (Res. …, firme 10/09/2026, publicado 30/09/2026)". */
function SSCO_texto_(m) {
  var f = function (d) { d = aFecha_(d); return d ? Utilities.formatDate(d, 'America/Lima', 'dd/MM/yyyy') : '?'; };
  return '⚠️ Sujeto SIN CAPACIDAD OPERATIVA (SUNAT): ' + (m.resolucion || 'resolución firme') + ', firme ' + f(m.firme) + ', publicado ' + f(m.publicada) +
    '. Sus comprobantes no dan crédito fiscal ni sustentan gasto.';
}

/* ============================================================ hojas */

/** Pestaña ⚠️ SSCO y marcas en 📋 Documentos. Se llama en cada actualización. Devuelve cuántos proveedores/clientes coinciden. */
function SSCO_escribir_(ss, res, cfg) {
  var mapa = SSCO_leer_(ss), hoy = new Date(), grupo = {};
  (cfg.grupo || []).forEach(function (r) { grupo[String(r)] = true; });
  var por = {};   // empresa|lado|ruc → resumen
  var anotar = function (empresa, lado, ruc, nombre, d) {
    var k = empresa + '|' + lado + '|' + ruc;
    var x = por[k] = por[k] || { empresa: empresa, lado: lado, ruc: ruc, nombre: nombre, n: 0, total: 0, desde: null, hasta: null, docs: [] };
    if (!d) return;
    var soles = (d.total || 0) * (d.moneda === 'PEN' ? 1 : (d.tc || 1)) * (d.tipo === '07' || String(d.tipo) === '7' ? -1 : 1);
    x.n++; x.total += soles;
    if (d.fecha && (!x.desde || d.fecha < x.desde)) x.desde = d.fecha;
    if (d.fecha && (!x.hasta || d.fecha > x.hasta)) x.hasta = d.fecha;
    if (x.docs.length < 15) x.docs.push(etiquetaDoc_(d));
  };
  (res.docs || []).forEach(function (d) {
    if (mapa[d.emisorRuc] && grupo[d.receptorRuc]) anotar(nombreEmpresa_(cfg, d.receptorRuc, d.receptorNombre), 'Proveedor', d.emisorRuc, d.emisorNombre, d);
    if (mapa[d.receptorRuc] && grupo[d.emisorRuc]) anotar(nombreEmpresa_(cfg, d.emisorRuc, d.emisorNombre), 'Cliente', d.receptorRuc, d.receptorNombre, d);
  });
  Object.keys(grupo).forEach(function (ruc) { if (mapa[ruc]) anotar(nombreEmpresa_(cfg, ruc, ''), 'Empresa del grupo', ruc, mapa[ruc].nombre, null); });

  var f = function (d) { return d || ''; };
  var filas = Object.keys(por).map(function (k) {
    var x = por[k], m = mapa[x.ruc], plazo = SSCO_plazo_(m.publicada);
    var situacion = x.lado !== 'Proveedor' ? (x.lado === 'Cliente' ? 'Cliente en la lista (revise la cobranza)' : '🚨 Una empresa del grupo figura en la lista')
      : plazo && plazo >= hoy ? '🔴 Puede pedir revisión hasta el ' + Utilities.formatDate(plazo, 'America/Lima', 'dd/MM/yyyy')
      : '⚠️ Plazo de revisión vencido';
    return [x.empresa, x.lado, x.ruc, x.nombre || m.nombre, situacion, m.resolucion, f(m.firme), f(m.publicada), f(plazo),
      x.n, x.lado === 'Proveedor' ? Math.round(x.total * 100) / 100 : '', x.lado === 'Proveedor' ? Math.round(x.total * 18 / 118 * 100) / 100 : '',
      f(x.desde), f(x.hasta), x.docs.join(', ') + (x.n > x.docs.length ? '…' : '')];
  }).sort(function (a, b) { return (b[8] || 0) - (a[8] || 0) || String(a[0]).localeCompare(b[0]); });

  var sh = obtenerOCrearHoja_(ss, SSCO_PESTANA_);
  limpiarHoja_(sh);
  var info = PropertiesService.getDocumentProperties().getProperty('ssco_info') || '';
  sh.getRange('A1').setValue('⚠️ Sujetos Sin Capacidad Operativa (SSCO) que son sus proveedores o clientes').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2').setValue((Object.keys(mapa).length ? info : '❌ No se pudo bajar la lista de SUNAT todavía (se reintenta en la próxima actualización).'))
    .setFontColor(COLOR.TEXTO_SUAVE);
  sh.getRange('A3').setFormula('=HYPERLINK("' + SSCO_PAGINA_ + '"' + separadorFormula_(ss) + '"🔗 Ver la lista en SUNAT")');
  sh.getRange('A4').setValue('Las facturas de un SSCO no dan derecho a crédito fiscal ni sustentan costo o gasto (D. Leg. 1532). ' +
    'Si la compra fue real, tiene 30 días hábiles desde la publicación para pedir a SUNAT que revise su caso (plazo aproximado: no descuenta feriados).')
    .setFontColor('#7C2D12').setWrap(false);
  var ENC = ['Empresa', 'Lado', 'RUC', 'Razón social', 'Situación', 'Resolución SSCO', 'Quedó firme', 'Publicada', 'Plazo revisión (aprox.)',
    'Facturas', 'Total S/', 'IGV aprox. S/', 'Desde', 'Hasta', 'Documentos'];
  escribirTabla_(sh, 6, 1, ENC, filas);
  sh.setFrozenRows(6);
  if (filas.length) {
    var n = filas.length;
    sh.getRange(7, 7, n, 3).setNumberFormat('dd/mm/yyyy');
    sh.getRange(7, 13, n, 2).setNumberFormat('dd/mm/yyyy');
    sh.getRange(7, 11, n, 2).setNumberFormat('#,##0.00');
    sh.getRange(7, 3, n, 1).setNumberFormat('@');
    sh.getRange(7, 1, n, ENC.length).setFontSize(9).setVerticalAlignment('middle');
    sh.getRange(7, 5, n, 1).setFontWeight('bold').setFontColor('#B91C1C');
  } else {
    sh.getRange('A7').setValue(Object.keys(mapa).length ? '✅ Ningún proveedor ni cliente de sus facturas (SIRE) figura en la lista.' : '');
  }
  [120, 110, 95, 230, 230, 230, 80, 80, 95, 60, 95, 90, 78, 78, 300].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });

  SSCO_marcarDocumentos_(ss, mapa);
  return filas.length;
}

/** 📋 Documentos: RUC y nombre de la contraparte en rojo con una nota si está en la lista. */
function SSCO_marcarDocumentos_(ss, mapa) {
  var sh = ss.getSheetByName(HOJA.DOCS);
  if (!sh || sh.getLastRow() < 2) return;
  var iRuc = ENC_DOCS_.indexOf('RUC contraparte'), n = sh.getLastRow() - 1;
  var rucs = sh.getRange(2, iRuc + 1, n, 1).getValues();
  var notas = {};
  rucs.forEach(function (r, i) {
    var m = mapa[String(r[0]).replace(/\D/g, '')];
    if (!m) return;
    notas[i] = notas[i] || SSCO_texto_(m);
    sh.getRange(i + 2, iRuc + 1, 1, 2).setBackground(SSCO_ROJO_).setFontColor('#991B1B').setFontWeight('bold');
    sh.getRange(i + 2, iRuc + 1).setNote(notas[i]);
  });
}
