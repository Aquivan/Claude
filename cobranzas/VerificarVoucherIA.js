/**
 * VerificarVoucherIA.js — 🖼 la IA mira el COMPROBANTE de cada voucher.
 *
 * Abre la imagen o el PDF del voucher (la imagen dentro de la celda, o el
 * archivo original en Drive, sin depender del nombre de la columna) y la IA
 * compara lo que dice el comprobante con lo escrito en la hoja: fecha, monto,
 * moneda, N° de operación, banco y beneficiario. Además da alertas: ilegible,
 * no es un comprobante de pago, operación rechazada o pendiente, señales de
 * edición, etc.
 *
 * Sin límite de cantidad: lo que no alcanza en una ejecución (6 min de
 * Google) queda en cola y sigue solo cada minuto. Los resultados quedan en la
 * pestaña 🖼 Vouchers verificados (una fila por voucher, se actualiza) y no se
 * vuelve a gastar IA en un voucher ya verificado si su fila no cambió.
 * Lo usa el 💬 analista (herramienta verificar_vouchers). Funciones VER_.
 */

var VER_HOJA_ = '🖼 Vouchers verificados';
var VER_COLA_ = '_Verificación cola';
var VER_MAX_BYTES_ = 12 * 1024 * 1024;
var VER_ENC_ = ['Fila (hoja!fila)', 'Empresa', 'Fecha (hoja)', 'Monto (hoja)', 'Operación (hoja)', 'Beneficiario (hoja)', 'Resultado', 'Diferencias',
  'Fecha (comprobante)', 'Monto (comprobante)', 'Moneda', 'Operación (comprobante)', 'Banco', 'Beneficiario (comprobante)', 'Ordenante', 'Alertas',
  'Comentario de la IA', 'Archivo', 'Verificado'];

var VER_SISTEMA_ = [
  'Eres auditor en Perú. Te doy la IMAGEN o el PDF de un comprobante bancario (constancia de transferencia, depósito, pago) y lo que se escribió en la hoja para ese voucher.',
  '1) Lee del comprobante: fecha, monto, moneda, N° de operación, banco, beneficiario (a quién se pagó), ordenante (quién pagó), cuenta destino y concepto.',
  '2) Compara con la hoja: fecha (un día de diferencia por corte bancario se acepta, pero dilo), monto EXACTO, moneda, N° de operación (ignora ceros a la izquierda',
  '   y prefijos como "Op."), banco y beneficiario (aunque esté abreviado o sin S.A.C.). Si en la hoja falta un dato, no es diferencia: dilo en el comentario.',
  '3) Alertas: ilegible o cortado, no es un comprobante de pago, operación pendiente/rechazada/programada, señales de edición, datos que no cuadran entre sí',
  '   dentro del mismo comprobante, beneficiario distinto al escrito. Si el archivo trae varios comprobantes, usa el de la página indicada o el que calce con el monto.',
  'Responde SOLO JSON: {"legible":true,"leido":{"fecha":"dd/mm/yyyy","monto":0,"moneda":"PEN","operacion":"","banco":"","beneficiario":"","ordenante":"",',
  '"cuenta_destino":"","concepto":""},"coincide":true,"diferencias":[{"campo":"monto","hoja":"","comprobante":""}],"alertas":[],"comentario":""}',
  '"comentario": máx. 30 palabras, en español.',
].join('\n');

/* ===================================================== el archivo del voucher */

/**
 * Comprobante de una fila de vouchers: imagen dentro de una celda, enlace de Drive o
 * nombre de archivo (jpg/png/pdf) en cualquier columna. {mime, base64, nombre, pagina} o {error}.
 */
function VER_comprobante_(libro, fuente, prov) {
  var p = fuente.split('!');
  var sh = libro.getSheetByName(p[0]);
  if (!sh) return { error: 'no existe la pestaña ' + p[0] };
  var fila = parseInt(p[1], 10), nc = sh.getLastColumn();
  var enc = sh.getRange(1, 1, 1, nc).getDisplayValues()[0].map(normHeader_);
  var val = sh.getRange(fila, 1, 1, nc).getValues()[0];
  var pagina = '';
  enc.forEach(function (h, j) { if (/^pagina|^page/.test(h) && val[j]) pagina = String(val[j]); });
  var blob = null, nombre = '';
  // 1) Imagen dentro de la celda
  for (var j = 0; j < nc && !blob; j++) {
    var v = val[j];
    if (v && typeof v === 'object' && typeof v.getContentUrl === 'function') {
      try {
        var r = UrlFetchApp.fetch(v.getContentUrl(), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
        if (r.getResponseCode() === 200) { blob = r.getBlob(); nombre = 'imagen en la celda ' + AUV_colLetra_(j); }
      } catch (e) { /* se intenta con el archivo */ }
    }
  }
  // 2) Enlace de Drive o 3) nombre del archivo original
  for (j = 0; j < nc && !blob; j++) {
    var s = String(val[j] == null ? '' : val[j]).trim();
    var id = (s.match(/\/d\/([\w-]{20,})|[?&]id=([\w-]{20,})/) || []).slice(1).filter(Boolean)[0];
    try {
      if (id) { var f = DriveApp.getFileById(id); blob = f.getBlob(); nombre = f.getName(); }
      else if (/\.(jpe?g|png|pdf|webp|heic|gif)$/i.test(s)) {
        var it = DriveApp.getFilesByName(s);
        if (it.hasNext()) { var g = it.next(); blob = g.getBlob(); nombre = g.getName(); }
      }
    } catch (e) { /* sin acceso a ese archivo */ }
  }
  if (!blob) return { error: 'sin imagen ni archivo del voucher en la fila' };
  var mime = blob.getContentType() || '';
  var esPdf = /pdf/i.test(mime);
  if ((esPdf && !prov.pdf) || blob.getBytes().length > VER_MAX_BYTES_) {
    // La IA elegida no lee PDF o el archivo es muy grande: se usa la miniatura (primera página).
    try {
      var th = id ? DriveApp.getFileById(id).getThumbnail() : null;
      if (!th && /\.(pdf|jpe?g|png)$/i.test(nombre)) { var it2 = DriveApp.getFilesByName(nombre); if (it2.hasNext()) th = it2.next().getThumbnail(); }
      if (!th) return { error: 'archivo ' + (esPdf ? 'PDF (la IA elegida no lee PDF)' : 'muy grande') + ': ' + nombre, nombre: nombre };
      blob = th; mime = 'image/png';
    } catch (e) { return { error: 'no se pudo preparar el archivo: ' + e.message, nombre: nombre }; }
  }
  if (!/^image\/|pdf/i.test(mime)) return { error: 'el archivo no es imagen ni PDF (' + mime + ')', nombre: nombre };
  return { mime: mime, base64: Utilities.base64Encode(blob.getBytes()), nombre: nombre, pagina: pagina };
}

function AUV_colLetra_(j) { var s = ''; j++; while (j > 0) { var m = (j - 1) % 26; s = String.fromCharCode(65 + m) + s; j = Math.floor((j - 1) / 26); } return s; }

/* ===================================================== verificar uno */

function VER_uno_(libro, p, ia, cfg) {
  var prov = IA_PROVEEDORES_[ia.proveedor];
  var base = { fuente: p.fuente, empresa: cfg.nombreEmpresa[p.pagadorRuc] || p.pagadorRuc || '', fecha: p.fecha, monto: p.monto, operacion: p.operacion,
    beneficiario: p.beneficiarioNombre, t: Date.now() };
  if (!prov.imagen) return VER_con_(base, { resultado: '❌ La IA elegida no lee imágenes (use Gemini u otra con imagen)' });
  var arch = VER_comprobante_(libro, p.fuente, prov);
  if (arch.error) return VER_con_(base, { resultado: '❌ Sin comprobante', comentario: arch.error, archivo: arch.nombre || '' });
  var r = IA_llamarSeguro_(ia, { sistema: VER_SISTEMA_, maxTokens: 2000,
    adjunto: { mime: arch.mime, base64: arch.base64 },
    texto: 'DATOS EN LA HOJA (' + p.fuente + '): fecha ' + IA_fmtFecha_(p.fecha) + ' · monto ' + p.moneda + ' ' + p.monto.toFixed(2) +
      ' · operación ' + (p.operacion || '-') + ' · banco ' + (p.banco || '-') + ' · beneficiario ' + (p.beneficiarioNombre || '-') +
      ' · empresa que paga ' + (cfg.nombreEmpresa[p.pagadorRuc] || '-') + (arch.pagina ? ' · página ' + arch.pagina + ' del archivo' : '') +
      '\nFILA COMPLETA A–J: ' + (p.crudo || '') });
  var L = r.leido || {};
  var difs = (Array.isArray(r.diferencias) ? r.diferencias : []).map(function (d) {
    return String(d.campo || '') + ': hoja ' + String(d.hoja == null ? '' : d.hoja) + ' / comprobante ' + String(d.comprobante == null ? '' : d.comprobante);
  });
  // Doble control del monto y la operación (lo más importante), por si la IA lo pasó por alto.
  var mC = AUV_num_(L.monto);
  if (mC != null && mC > 0 && Math.abs(mC - p.monto) > 0.01 && !difs.some(function (d) { return /^monto/i.test(d); })) difs.push('monto: hoja ' + p.monto.toFixed(2) + ' / comprobante ' + mC.toFixed(2));
  var dig = function (s) { return String(s || '').replace(/\D/g, '').replace(/^0+/, ''); };
  if (dig(L.operacion) && dig(p.operacion) && dig(L.operacion) !== dig(p.operacion) && !difs.some(function (d) { return /^operaci/i.test(d); }))
    difs.push('operación: hoja ' + p.operacion + ' / comprobante ' + L.operacion);
  var alertas = (Array.isArray(r.alertas) ? r.alertas : []).map(String).filter(Boolean);
  var res = r.legible === false ? '❓ Ilegible' : difs.length ? '⚠️ Diferencias' : alertas.length ? '🟠 Coincide con alertas' : '✔ Coincide';
  return VER_con_(base, { resultado: res, diferencias: difs.join(' · '), fechaC: L.fecha || '', montoC: mC != null ? mC : '', monedaC: L.moneda || '',
    operacionC: L.operacion || '', bancoC: L.banco || '', beneficiarioC: L.beneficiario || '', ordenante: L.ordenante || '',
    alertas: alertas.join(' · '), comentario: String(r.comentario || '').slice(0, 300), archivo: arch.nombre });
}

function VER_con_(base, x) { for (var k in x) base[k] = x[k]; return base; }

function VER_clave_(p) { return hashTexto_(p.fuente + '|' + p.crudo + '|' + p.monto); }

/**
 * Verifica la lista (con lo ya verificado guardado). Lo que no alcanza antes de
 * `deadline` se devuelve en `pendientes`.
 */
function VER_verificar_(ss, cfg, pagos, ia, deadline) {
  var cache = AUV_cache_(ss);
  var libro = SpreadsheetApp.openById(cfg.idVouchers);
  var hechos = [], pendientes = [], nuevos = 0, errores = 0, ultimoError = '';
  pagos.forEach(function (p) {
    var k = VER_clave_(p);
    var c = AUV_cacheGet_(cache, 'ver', k);
    if (c && !/^❌ La IA|^⚠️ Error/.test(c.resultado)) { hechos.push(c); return; }
    if ((nuevos > 0 && Date.now() > deadline) || errores >= 3) { pendientes.push(p.fuente); return; }
    var x;
    try {
      if (nuevos) Utilities.sleep(Math.min(IA_PROVEEDORES_[ia.proveedor].pausa, 2500));
      x = VER_uno_(libro, p, ia, cfg);
    } catch (e) {
      errores++; ultimoError = e.message;
      x = VER_con_({ fuente: p.fuente, empresa: cfg.nombreEmpresa[p.pagadorRuc] || '', fecha: p.fecha, monto: p.monto, operacion: p.operacion,
        beneficiario: p.beneficiarioNombre, t: Date.now() }, { resultado: '⚠️ Error de la IA', comentario: String(e.message).slice(0, 200) });
    }
    nuevos++;
    if (!/^⚠️ Error/.test(x.resultado)) AUV_cachePut_(cache, 'ver', k, x);
    hechos.push(x);
    if (nuevos % 5 === 0) AUV_cacheGuardar_(cache);
  });
  AUV_cacheGuardar_(cache);
  VER_escribir_(ss, hechos);
  return { hechos: hechos, pendientes: pendientes, nuevos: nuevos, error: ultimoError };
}

/* ===================================================== cola en segundo plano */

function VER_leerCola_(ss) {
  var sh = ss.getSheetByName(VER_COLA_);
  if (!sh) return null;
  try { return JSON.parse(sh.getRange(1, 1).getValue() || 'null'); } catch (e) { return null; }
}

function VER_guardarCola_(ss, cola) {
  var sh = ss.getSheetByName(VER_COLA_);
  if (!sh) { sh = ss.insertSheet(VER_COLA_); sh.hideSheet(); }
  sh.getRange(1, 1).setValue(cola && cola.fuentes.length ? JSON.stringify(cola) : '');
}

/** Agrega vouchers a la cola y programa la continuación. */
function VER_encolar_(ss, fuentes, modelo) {
  var cola = VER_leerCola_(ss) || { fuentes: [], modelo: modelo || '', inicio: Date.now(), hechos: 0 };
  fuentes.forEach(function (f) { if (cola.fuentes.indexOf(f) === -1) cola.fuentes.push(f); });
  VER_guardarCola_(ss, cola);
  VER_programar_();
  return cola.fuentes.length;
}

function VER_programar_() {
  VER_borrarTrigger_();
  ScriptApp.newTrigger('VER_continuar').timeBased().after(60 * 1000).create();
}

function VER_borrarTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'VER_continuar') ScriptApp.deleteTrigger(t); });
}

/** Continuación (cada minuto) hasta verificar todos los vouchers de la cola. */
function VER_continuar() {
  VER_borrarTrigger_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cola = VER_leerCola_(ss);
  if (!cola || !cola.fuentes.length) return;
  var t0 = Date.now();
  var cfg = leerConfig_(ss);
  var ia = CIA_ia_(CIA_hoja_(ss));
  ia.modelo = cola.modelo || '';
  var L = AUV_leerEnlazado_(cfg, null, { consultas: 0, errores: 0 }, AUV_cache_(ss), 0, AUD_leerMovs_(ss));
  var porFuente = {};
  L.pagos.forEach(function (p) { porFuente[p.fuente] = p; });
  var lista = cola.fuentes.map(function (f) { return porFuente[f]; }).filter(Boolean);
  var r = VER_verificar_(ss, cfg, lista, ia, t0 + 240000);
  cola.hechos += lista.length - r.pendientes.length;
  cola.fuentes = r.pendientes;
  VER_guardarCola_(ss, cola);
  VER_estado_(ss, cola.fuentes.length ? '⏳ Verificando comprobantes: ' + cola.hechos + ' listos, faltan ' + cola.fuentes.length +
    ' (sigue solo cada minuto)' + (r.error ? ' · último error: ' + r.error.slice(0, 80) : '') : '✅ Verificación de comprobantes terminada: ' + cola.hechos + ' vouchers. ' + AUD_ahora_());
  if (cola.fuentes.length) VER_programar_();
}

function VER_detener_(ss) {
  VER_borrarTrigger_();
  VER_guardarCola_(ss, null);
  VER_estado_(ss, '⏹ Verificación de comprobantes detenida ' + AUD_ahora_() + '. Lo ya verificado queda en la tabla.');
}

/* ===================================================== pestaña */

function VER_hoja_(ss) {
  var sh = ss.getSheetByName(VER_HOJA_);
  if (sh) return sh;
  sh = ss.insertSheet(VER_HOJA_);
  sh.getRange(1, 1, 1, 10).merge().setValue('🖼  VOUCHERS VERIFICADOS CONTRA SU COMPROBANTE (imagen o PDF)').setFontSize(14).setFontWeight('bold')
    .setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
  sh.getRange(3, 1, 1, VER_ENC_.length).setValues([VER_ENC_]).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true);
  sh.setFrozenRows(3);
  [110, 80, 80, 90, 90, 170, 130, 260, 80, 90, 55, 100, 80, 170, 150, 220, 260, 150, 85].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

function VER_estado_(ss, txt) { VER_hoja_(ss).getRange(2, 1, 1, 10).merge().setValue(txt).setFontWeight('bold').setFontSize(9).setBackground('#EEF3F8'); }

/** Escribe/actualiza las filas (una por voucher). */
function VER_escribir_(ss, xs) {
  if (!xs.length) return;
  var sh = VER_hoja_(ss);
  var n = Math.max(0, sh.getLastRow() - 3);
  var actuales = n ? sh.getRange(4, 1, n, VER_ENC_.length).getValues() : [];
  var pos = {};
  actuales.forEach(function (r, i) { if (r[0]) pos[r[0]] = i; });
  xs.forEach(function (x) {
    var fila = [x.fuente, x.empresa, x.fecha || '', x.monto, x.operacion, x.beneficiario, x.resultado, x.diferencias || '', x.fechaC || '', x.montoC == null ? '' : x.montoC,
      x.monedaC || '', x.operacionC || '', x.bancoC || '', x.beneficiarioC || '', x.ordenante || '', x.alertas || '', x.comentario || '', x.archivo || '', new Date(x.t || Date.now())];
    if (pos[x.fuente] != null) actuales[pos[x.fuente]] = fila; else { pos[x.fuente] = actuales.length; actuales.push(fila); }
  });
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(4, 1, actuales.length, VER_ENC_.length).setValues(actuales).setFontSize(9).setVerticalAlignment('top').setWrap(true);
  sh.getRange(4, 3, actuales.length, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(4, 4, actuales.length, 1).setNumberFormat('#,##0.00');
  sh.getRange(4, 10, actuales.length, 1).setNumberFormat('#,##0.00');
  sh.getRange(4, 5, actuales.length, 1).setNumberFormat('@');
  sh.getRange(4, 12, actuales.length, 1).setNumberFormat('@');
  sh.getRange(4, 19, actuales.length, 1).setNumberFormat('dd/mm HH:mm');
  sh.getRange(4, 7, actuales.length, 1).setBackgrounds(actuales.map(function (r) {
    var s = String(r[6]);
    return [/^✔/.test(s) ? '#DCFCE7' : /^⚠️|^❓/.test(s) ? '#FEE2E2' : /^🟠/.test(s) ? '#FFEDD5' : '#E5E7EB'];
  }));
  sh.getRange(3, 1, actuales.length + 1, VER_ENC_.length).createFilter();
}
