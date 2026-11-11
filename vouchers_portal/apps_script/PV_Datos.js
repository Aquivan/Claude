/**
 * 🌐 Portal de Vouchers — los datos: índice para buscar, una fila con su imagen y su archivo original,
 * corregir, subir y lo que espera en las carpetas. Misma lógica que el 👁 Visor y el 📤 Subir de la hoja
 * (VisorVoucher.js, SubirVoucher.js), pero leyendo la hoja por su ID (este proyecto no está dentro de ella)
 * y sin entregar nunca el «pase» de Drive al navegador: los archivos los baja el servidor.
 */

var PV_NORMA_ = function (t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); };

function PV_hoja_(nombre) {
  if (PV_HOJAS_.indexOf(String(nombre)) < 0) throw new Error('Pestaña no válida.');
  var sh = PV_ss_().getSheetByName(nombre);
  if (!sh) throw new Error('No encontré la pestaña ' + nombre + '.');
  return sh;
}

/** Columnas (base 0) por su título, con las mismas posiciones de siempre si no las encuentra. */
function PV_columnas_(tit) {
  tit = tit.map(PV_NORMA_);
  var col = function (re, def) { var i = tit.findIndex(function (t) { return re.test(t); }); return i >= 0 ? i : def; };
  return {
    f: col(/^fecha de dep/, 0), op: col(/^numero de op|^n.? de op/, 1), b: col(/^banco/, 2), mon: col(/^moneda/, 3), m: col(/^monto/, 4),
    p: col(/^proveedor/, 5), cli: col(/^cliente/, 7), des: col(/^descripcion/, 8), arch: col(/^archivo original/, 10), pag: col(/^pagina/, 12),
    rev: col(/^revisado/, -1), pr: col(/^por retener/, -1), ret: col(/^retenido/, -1), emp: col(/^empresa/, -1), idb: col(/^id benef/, -1),
    idu: col(/^id usuario/, -1), doc: col(/^tipo y n/, -1), nota: col(/^nota/, -1)
  };
}

/** Clave de duplicado: la misma que usa el procesador de la hoja (n° de operación | banco | monto). */
function PV_claveDup_(op, banco, monto) {   // = claveDuplicado() de VoucherProcessor.js de la hoja
  return String(op).trim().toLowerCase() + '|' + String(banco || '').trim().toLowerCase() + '|' + (Math.round((parseFloat(monto) || 0) * 100) / 100).toFixed(2);
}

/**
 * 🔎 Índice de las dos pestañas para buscar y filtrar en el navegador (cada filtro es instantáneo).
 * Cada fila: [h, fila, aaaammdd, fecha, op, banco, moneda, monto, proveedor, empresa, revisado, porRetener, retenido,
 *             idBenef, cliente, descripcion, archivo, pagina, claveDup, idUsuario, doc, nota]
 */
function PV_indice_() {
  var ss = PV_ss_(), filas = [];
  PV_HOJAS_.forEach(function (nombre, h) {
    var sh = ss.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var nCol = sh.getLastColumn(), n = sh.getLastRow() - 1, I = PV_columnas_(sh.getRange(1, 1, 1, nCol).getDisplayValues()[0]);
    var rg = sh.getRange(2, 1, n, nCol), ver = rg.getDisplayValues(), crudo = rg.getValues();
    var si = function (v, c, i) { return i >= 0 && (c[i] === true || /^(true|si|sí|x|✔|✅)$/i.test(String(v[i]).trim())) ? 1 : 0; };
    var tx = function (v, i) { return i >= 0 ? String(v[i] || '').trim() : ''; };
    for (var r = 0; r < n; r++) {
      var v = ver[r], c = crudo[r];
      if (!tx(v, I.op) && !tx(v, I.m) && !tx(v, I.p)) continue;   // fila vacía
      var f = c[I.f] instanceof Date ? Utilities.formatDate(c[I.f], PV_TZ_, 'yyyyMMdd') : '';
      filas.push([h, r + 2, f, tx(v, I.f), tx(v, I.op), tx(v, I.b), tx(v, I.mon), Number(c[I.m]) || 0, tx(v, I.p), tx(v, I.emp),
        si(v, c, I.rev), si(v, c, I.pr), si(v, c, I.ret), tx(v, I.idb), tx(v, I.cli), tx(v, I.des).slice(0, 160), tx(v, I.arch), tx(v, I.pag),
        tx(v, I.op) && !/DUPLICADO/i.test(tx(v, I.op)) ? PV_claveDup_(c[I.op], c[I.b], c[I.m]) : '', tx(v, I.idu), tx(v, I.doc).slice(0, 120), tx(v, I.nota).slice(0, 120)]);
    }
  });
  return { hojas: PV_HOJAS_, filas: filas, t: PV_hoy_() };
}

/** Datos de una fila (todas las columnas para ver y corregir) y lo que se sabe de su archivo original. */
function PV_fila_(hoja, fila, puedeEditar) {
  var sh = PV_hoja_(hoja);
  fila = Number(fila);
  if (!(fila >= 2) || fila > sh.getLastRow()) return { hoja: hoja, fila: fila, vacio: true };
  var nCol = sh.getLastColumn(), rg = sh.getRange(fila, 1, 1, nCol);
  var tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0];
  var ver = rg.getDisplayValues()[0], crudo = rg.getValues()[0], formulas = rg.getFormulas()[0], reglas = rg.getDataValidations()[0];
  var conImagen = false;
  try { var j = crudo[9]; conImagen = !!(j && typeof j === 'object' && !(j instanceof Date)); } catch (e) {}
  var cols = [];
  for (var i = 0; i < nCol; i++) {
    if (i === 9) continue;   // J es la imagen
    var t = String(tit[i] || '').trim();
    if (!t && !String(ver[i]).trim()) continue;
    var c = { c: i + 1, t: t || ('Col ' + (i + 1)), v: String(ver[i]), tipo: 'texto' }, r = reglas[i];
    if (formulas[i] || i === 10 || i === 11) c.tipo = 'fijo';   // fórmulas, archivo (K) y fecha de proceso (L) no se cambian aquí
    else if (r && r.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX) { c.tipo = 'check'; c.v = crudo[i] === true; }
    else if (r && r.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) { c.tipo = 'lista'; c.op = (r.getCriteriaValues()[0] || []).map(String); }
    else if (r && r.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      try { c.tipo = 'lista'; c.op = r.getCriteriaValues()[0].getDisplayValues().map(function (x) { return String(x[0]); }).filter(String).slice(0, 300); } catch (e) { c.tipo = 'texto'; }
    }
    else if (crudo[i] instanceof Date) c.tipo = 'fecha';
    else if (typeof crudo[i] === 'number') c.tipo = 'numero';
    cols.push(c);
  }
  var archivo = String(ver[10] || '').trim(), vers = archivo ? PV_archivosPorNombre_(archivo) : [];
  return {
    hoja: hoja, fila: fila, conImagen: conImagen, texto: conImagen ? '' : String(ver[9] || '').trim(),
    archivo: archivo, pagina: parseInt(ver[12], 10) || 1, cols: cols, editar: !!puedeEditar,
    clave: { b: String(ver[1]), k: archivo },   // al guardar se comprueba que siga siendo el mismo voucher
    nota: (function () { try { return sh.getRange(fila, 2).getNote(); } catch (e) { return ''; } })(),
    versiones: vers.slice(0, 6).map(function (f) { return { fecha: Utilities.formatDate(f.getDateCreated(), PV_TZ_, 'dd/MM/yyyy HH:mm'), mime: f.getMimeType(), mb: Math.round(f.getSize() / 104857.6) / 10, donde: PV_dondeEsta_(f) }; })
  };
}

/** La imagen de la celda (J) como data:… (la baja el servidor; el navegador no recibe ningún permiso). */
function PV_imagen_(hoja, fila) {
  var c = PV_hoja_(hoja).getRange(Number(fila), 10).getValue();
  var url = c && typeof c === 'object' && !(c instanceof Date) ? ((c.getContentUrl && c.getContentUrl()) || (c.getUrl && c.getUrl()) || '') : '';
  if (!url) return '';
  var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return '';
  var b = r.getBlob();
  return 'data:' + (b.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(b.getBytes());
}

/** Archivos con ese nombre en las carpetas del sistema (el más nuevo primero). Solo esas carpetas: nunca otro Drive. */
function PV_archivosPorNombre_(nombre) {
  var out = [], vistos = {};
  Object.keys(PV_CARP_).forEach(function (k) {
    try {
      var it = DriveApp.getFolderById(PV_CARP_[k].id).getFilesByName(nombre);
      while (it.hasNext()) { var f = it.next(); if (!vistos[f.getId()]) { vistos[f.getId()] = 1; out.push(f); } }
    } catch (e) {}
  });
  return out.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
}

function PV_dondeEsta_(f) {
  try {
    var ps = f.getParents();
    while (ps.hasNext()) { var id = ps.next().getId(); for (var k in PV_CARP_) if (PV_CARP_[k].id === id) return PV_CARP_[k].t; }
  } catch (e) {}
  return '';
}

/** El archivo original de la fila (versión n: 0 = la más nueva), para verlo o descargarlo. */
function PV_original_(hoja, fila, n) {
  var nombre = String(PV_hoja_(hoja).getRange(Number(fila), 11).getDisplayValue() || '').trim();
  if (!nombre) throw new Error('Esta fila no tiene archivo original (columna K).');
  var vs = PV_archivosPorNombre_(nombre), f = vs[Number(n) || 0];
  if (!f) throw new Error('No encontré «' + nombre + '» en las carpetas de vouchers (¿lo movieron o lo renombraron?).');
  if (f.getSize() > PV_MAX_VER_MB_ * 1048576) throw new Error('El archivo pesa más de ' + PV_MAX_VER_MB_ + ' MB: ábralo desde la hoja.');
  return { nombre: f.getName(), mime: f.getMimeType(), b64: Utilities.base64Encode(f.getBlob().getBytes()), versiones: vs.length };
}

/** Guarda lo corregido (ya confirmado por la persona). cambios = {columna: valor}. Devuelve la fila al día. */
function PV_guardar_(s, hoja, fila, clave, cambios) {
  var sh = PV_hoja_(hoja);
  fila = Number(fila);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Otra persona está guardando: intente de nuevo en unos segundos.');
  var hechos = [];
  try {
    var nCol = Math.max(13, sh.getLastColumn()), ver = sh.getRange(fila, 1, 1, nCol).getDisplayValues()[0];
    var tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0];
    if (!clave || String(ver[1]) !== String(clave.b) || String(ver[10]) !== String(clave.k)) {
      throw new Error('La fila ' + fila + ' ya no es el mismo voucher (¿se ordenó la hoja o entraron filas nuevas?). No guardé nada: búsquelo otra vez.');
    }
    Object.keys(cambios || {}).forEach(function (k) {
      var col = parseInt(k, 10);
      if (!(col >= 1) || col > nCol || col === 10 || col === 11 || col === 12) return;   // imagen, archivo y fecha de proceso: no
      var celda = sh.getRange(fila, col);
      if (celda.getFormula()) return;   // las fórmulas no se tocan
      var v = cambios[k], antes = celda.getValue(), m;
      if (v === true || v === false) { celda.setValue(v); hechos.push((tit[col - 1] || 'Col ' + col) + ': ' + ver[col - 1] + ' → ' + v); return; }
      v = String(v == null ? '' : v).trim();
      if (antes instanceof Date && (m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) v = new Date(Number(m[3].length === 2 ? '20' + m[3] : m[3]), Number(m[2]) - 1, Number(m[1]));
      else if (typeof antes === 'number' && v !== '' && !isNaN(Number(v.replace(/,/g, '')))) v = Number(v.replace(/,/g, ''));
      celda.setValue(v);
      hechos.push((tit[col - 1] || 'Col ' + col) + ': «' + ver[col - 1] + '» → «' + (v instanceof Date ? Utilities.formatDate(v, PV_TZ_, 'dd/MM/yyyy') : v) + '»');
    });
    if (hechos.length) {
      try {
        var nota = sh.getRange(fila, 2).getNote();
        sh.getRange(fila, 2).setNote(('✏️ Corregido en el portal por ' + s.u + ' ' + PV_hoy_() + ':\n' + hechos.join('\n') + (nota ? '\n\n' + nota : '')).slice(0, 4000));
      } catch (e) {}
      SpreadsheetApp.flush();
    }
  } finally { lock.releaseLock(); }
  if (hechos.length) PV_registrar_(s, '✏️ Corrigió ' + hoja + ' fila ' + fila, hechos.join(' · '));
  return PV_fila_(hoja, fila, true);
}

/* ============================================================ subir */

function PV_limpiarNombre_(n) {
  return String(n || '').replace(/[\\/:*?"<>|#\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}

/** ¿Cuáles de estos nombres ya existen (en entrada, procesados o descartados)? */
function PV_repetidos_(nombres) {
  return (nombres || []).slice(0, 50).filter(function (n) { n = PV_limpiarNombre_(n); return n && PV_archivosPorNombre_(n).length; });
}

/** Sube un archivo a la carpeta de ENTRADA de Originales o de Fotos. a = {nombre, mime, datos (base64), destino}. */
function PV_subir_(s, a) {
  var nombre = PV_limpiarNombre_(a && a.nombre);
  if (!nombre) return { ok: false, error: 'Falta el nombre.' };
  var mime = String(a.mime || '');
  if (!/^(application\/pdf|image\/(jpeg|png|webp|heic|heif|gif))$/.test(mime)) return { ok: false, error: 'Solo PDF o imágenes (JPG, PNG, WEBP, HEIC).' };
  if (!/\.[a-z0-9]{2,5}$/i.test(nombre)) nombre += mime === 'application/pdf' ? '.pdf' : '.' + mime.split('/')[1].replace('jpeg', 'jpg');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'El sistema está ocupado: intente de nuevo.' };
  try {
    if (PV_archivosPorNombre_(nombre).length) return { ok: false, error: 'Ya existe un archivo llamado «' + nombre + '». Cámbiele el nombre.' };
    var bytes = Utilities.base64Decode(String(a.datos || ''));
    if (!bytes.length) return { ok: false, error: 'El archivo llegó vacío.' };
    if (bytes.length > PV_MAX_MB_ * 1048576) return { ok: false, error: 'Pesa más de ' + PV_MAX_MB_ + ' MB.' };
    var dest = a.destino === 'foto' ? PV_CARP_.fe : PV_CARP_.oe;
    var f = DriveApp.getFolderById(dest.id).createFile(Utilities.newBlob(bytes, mime, nombre));
    f.setDescription('Subido desde el 🌐 portal por ' + s.u + ' el ' + PV_hoy_());
    PV_registrar_(s, '📤 Subió un voucher', nombre + ' → ' + dest.t + ' (' + Math.round(bytes.length / 1024) + ' KB)');
    return { ok: true, nombre: f.getName(), destino: dest.t };
  } finally { lock.releaseLock(); }
}

/* ============================================================ carpetas */

/** Lo que espera en Entrada (por procesar) y lo último descartado. */
function PV_pendientes_() {
  var lista = function (k, max) {
    var out = [];
    try {
      var it = DriveApp.getFolderById(PV_CARP_[k].id).getFiles();
      while (it.hasNext() && out.length < 400) {
        var f = it.next();
        out.push({ nombre: f.getName(), t: f.getDateCreated().getTime(), fecha: Utilities.formatDate(f.getDateCreated(), PV_TZ_, 'dd/MM/yyyy HH:mm'),
          kb: Math.round(f.getSize() / 1024), mime: f.getMimeType(), por: String(f.getDescription() || '').replace(/^Subido desde el 🌐 portal por /, '').split(' el ')[0] });
      }
    } catch (e) { out.push({ nombre: '⚠️ ' + e.message, t: 0, fecha: '', kb: 0 }); }
    out.sort(function (a, b) { return b.t - a.t; });
    return out.slice(0, max);
  };
  return { originales: lista('oe', 200), fotos: lista('fe', 200), descartados: lista('de', 40), t: PV_hoy_() };
}
