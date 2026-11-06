/**
 * VcoCopias.js — 🔗 COMPLETAR ORIGINALES CON LO TRABAJADO EN FOTOS (prefijo VCO_).
 *
 * Un mismo voucher puede llegar primero como foto (pestaña Fotos), trabajarse ahí (RUC, factura, empresa,
 * retención, revisado, nota) y después llegar el original (pestaña Originales). Cobranzas ya cuenta uno solo
 * (manda Originales) y toma de la copia lo que falte, pero la hoja de Originales quedaba con esas celdas vacías.
 * Este módulo copia a la fila de Originales lo que se completó en su copia de Fotos:
 *   - Mismo voucher = mismo banco, N° de operación y monto, con fechas a 5 días o menos (la misma regla del motor).
 *     Si hay más de un Original posible, no se toca (se avisa).
 *   - Solo celdas VACÍAS del Original (casillas sin marcar). Lo que lee la IA (fecha, monto, operación…) no se toca.
 *   - Si el Original y la Foto dicen cosas DISTINTAS en una columna, no se escribe nada en esa columna: aviso.
 *   - Cada celda escrita lleva una nota «🔗 Copiado de Fotos!N» y queda en _Mesa para ↩️ Deshacer.
 * Tres formas de uso:
 *   1. Solo, en cada actualización de Cobranzas: para los Originales que llegan desde que se activó
 *      (Fecha Procesamiento >= VCO_DESDE). Los avisos de diferencias van a ✅ Conciliar → Avisos.
 *   2. Menú 🧠 Asistente IA → 🔗 Completar Originales con lo trabajado en Fotos (aquí y en la hoja de Vouchers):
 *      muestra todos los pares (también los antiguos), qué se copiaría y las diferencias; copia solo con ✅.
 *   3. ↩️ Deshacer en la misma ventana.
 */

var VCO_COLS_ = [
  ['ID Usuario'], ['Empresa'], ['ID Beneficiario'], ['Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc'],
  ['Por Retener'], ['Retenido'], ['Revisado Voucher', 'Revisado'], ['Nota'],
];

function VCO_vacio_(v) { return v === '' || v == null || v === false || String(v).trim() === '' || /^false$/i.test(String(v).trim()); }
function VCO_norm_(v) {
  if (v === true || /^true$/i.test(String(v))) return 'TRUE';
  var s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ');
  return /^\d[\d\s.-]{7,}$/.test(s) ? s.replace(/\D/g, '') : s;
}

/** Lee una pestaña de Vouchers: {sh, nombre, filas:[{fila, clave, fecha, proc, val:{col:valor}}], col:{nombre:índice}} */
function VCO_leer_(ssV, nombre) {
  var sh = ssV.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return null;
  var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], c = indiceColumnas_(enc);
  var I = { fecha: c('Fecha de depos', 'Fecha de deposito'), op: c('Numero de oper', 'Numero de operacion'), banco: c('Banco'), monto: c('Monto'),
    proc: c('Fecha Procesamiento', 'Fecha proc') };
  if (I.op < 0 || I.monto < 0) return null;
  var cols = {};
  VCO_COLS_.forEach(function (alts) { var i = c.apply(null, alts); if (i >= 0) cols[alts[0]] = { i: i, titulo: String(enc[i]) }; });
  var n = sh.getLastRow() - 1, leer = function (i) { return i >= 0 ? sh.getRange(2, i + 1, n, 1).getValues() : null; };
  var vF = leer(I.fecha), vO = leer(I.op), vB = leer(I.banco), vM = leer(I.monto), vP = leer(I.proc), vc = {};
  Object.keys(cols).forEach(function (k) { vc[k] = leer(cols[k].i); });
  var filas = [];
  for (var r = 0; r < n; r++) {
    var op = String(vO[r][0] == null ? '' : vO[r][0]).trim(), monto = aNumero_(vM[r][0]);
    if (!op || !monto) continue;
    var val = {};
    Object.keys(vc).forEach(function (k) { val[k] = vc[k][r][0]; });
    filas.push({ fila: r + 2, clave: [String(vB ? vB[r][0] : '').trim().toUpperCase(), op, monto.toFixed(2)].join('|'),
      fecha: vF ? aFecha_(vF[r][0]) : null, proc: vP && vP[r][0] instanceof Date ? vP[r][0] : null, val: val });
  }
  return { sh: sh, nombre: nombre, filas: filas, cols: cols };
}

/**
 * Compara Originales y Fotos. desde (Date|null): solo Originales procesados desde esa fecha.
 * → {pares, copias:[{o, f, col, titulo, valor, fila}], conflictos:[{o, f, col, vo, vf}], ambiguos:[…]}
 */
function VCO_analizar_(cfg, desde) {
  var ssV = SpreadsheetApp.openById(cfg.idVouchers);
  var O = VCO_leer_(ssV, 'Originales'), F = VCO_leer_(ssV, 'Fotos');
  var res = { pares: 0, copias: [], conflictos: [], ambiguos: [], ssV: ssV, O: O };
  if (!O || !F) return res;
  var porClave = {};
  O.filas.forEach(function (x) { (porClave[x.clave] = porClave[x.clave] || []).push(x); });
  // Primero se junta cada Original con su(s) foto(s): si un Original tiene más de una foto posible, no se toca.
  var fotosDe = {};
  F.filas.forEach(function (f) {
    var cands = (porClave[f.clave] || []).filter(function (o) { return !o.fecha || !f.fecha || Math.abs(o.fecha - f.fecha) <= 5 * 86400000; });
    if (!cands.length) return;
    if (cands.length > 1) { res.ambiguos.push({ f: 'Fotos!' + f.fila, o: cands.map(function (o) { return 'Originales!' + o.fila; }).join(', ') + ' (más de un Original posible)' }); return; }
    (fotosDe[cands[0].fila] = fotosDe[cands[0].fila] || { o: cands[0], fs: [] }).fs.push(f);
  });
  Object.keys(fotosDe).forEach(function (k) {
    var o = fotosDe[k].o, fs = fotosDe[k].fs;
    if (fs.length > 1) { res.ambiguos.push({ f: fs.map(function (f) { return 'Fotos!' + f.fila; }).join(', '), o: 'Originales!' + o.fila + ' (más de una foto posible)' }); return; }
    var f = fs[0];
    if (desde && (!o.proc || o.proc < desde)) return;
    res.pares++;
    Object.keys(O.cols).forEach(function (k) {
      if (!F.cols[k]) return;
      var vo = o.val[k], vf = f.val[k];
      if (VCO_vacio_(vf)) return;
      if (VCO_vacio_(vo)) res.copias.push({ o: 'Originales!' + o.fila, f: 'Fotos!' + f.fila, col: k, titulo: O.cols[k].titulo, fila: o.fila, ci: O.cols[k].i, valor: vf });
      else if (VCO_norm_(vo) !== VCO_norm_(vf)) res.conflictos.push({ o: 'Originales!' + o.fila, f: 'Fotos!' + f.fila, col: O.cols[k].titulo, vo: String(vo), vf: String(vf) });
    });
  });
  return res;
}

/** Escribe las copias (volviendo a verificar que la celda siga vacía). → {hechos, lote} */
function VCO_escribir_(ss, an, copias, quien) {
  if (!copias.length) return { hechos: 0, lote: '' };
  var sh = an.O.sh, ahora = new Date(), log = [], hechos = 0;
  var lote = 'VCO-' + Utilities.formatDate(ahora, 'America/Lima', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4);
  var cuando = Utilities.formatDate(ahora, 'America/Lima', 'dd/MM/yyyy HH:mm');
  copias.forEach(function (x) {
    var rg = sh.getRange(x.fila, x.ci + 1), actual = rg.getValue();
    if (!VCO_vacio_(actual)) return;
    var nuevo = x.valor;
    if (/^(ID |RUC)/i.test(x.titulo) && /^\d{8,11}$/.test(String(nuevo).trim())) { rg.setNumberFormat('@'); nuevo = String(nuevo).trim(); }
    rg.setValue(nuevo);
    try { if (nuevo !== true) rg.setNote('🔗 Copiado de ' + x.f + ' (mismo voucher: banco, operación y monto) · ' + cuando + ' · ' + (quien || 'automático')); } catch (e) {}
    log.push([ahora, quien || 'automático', lote, x.o, x.titulo, actual === false ? false : '', nuevo, '']);
    hechos++;
  });
  if (log.length) { var shL = MESA_hojaLog_(ss); shL.getRange(shL.getLastRow() + 1, 1, log.length, MESA_ENC_LOG_.length).setValues(log); }
  return { hechos: hechos, lote: log.length ? lote : '' };
}

/** 1. Automático (cada actualización de Cobranzas): Originales que llegaron desde que se activó. → avisos para ✅ Conciliar */
function VCO_auto_(ss, cfg) {
  var props = PropertiesService.getScriptProperties(), desde = props.getProperty('VCO_DESDE');
  if (!desde) { props.setProperty('VCO_DESDE', String(Date.now())); return { hechos: 0, avisos: [] }; }   // primera vez: desde ahora
  var an = VCO_analizar_(cfg, new Date(Number(desde)));
  var r = VCO_escribir_(ss, an, an.copias, 'automático');
  var avisos = an.conflictos.map(function (c) {
    return { tipo: 'Original ≠ Foto', detalle: c.o + ' y su copia ' + c.f + ' dicen distinto en «' + c.col + '»: «' + c.vo + '» / «' + c.vf + '». Revise cuál es el correcto (no se copió nada).', fuente: c.o };
  });
  return { hechos: r.hechos, avisos: avisos, pares: an.pares };
}

/* ---------------------------------------------------------------- 2. menú con vista previa */

function VCO_menuAbrir() {
  var html = HtmlService.createHtmlOutputFromFile('VcoVista').setWidth(820).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, '🔗 Completar Originales con lo trabajado en Fotos');
}

/** Vista previa de todo (también lo antiguo). Guarda la lista para copiar exactamente eso. */
function VCO_ver_() {
  var ss = ssPrincipal_(), cfg = leerConfig_(ss);
  var an = VCO_analizar_(cfg, null);
  var id = Utilities.getUuid().slice(0, 8);
  var lista = an.copias.map(function (x) { return { o: x.o, f: x.f, col: x.col, titulo: x.titulo, fila: x.fila, ci: x.ci, valor: x.valor === true ? true : String(x.valor) }; });
  CacheService.getScriptCache().put('vco_' + id, JSON.stringify(lista), 21600);
  return { id: id, pares: an.pares, copias: lista.slice(0, 1500), nCopias: lista.length, conflictos: an.conflictos.slice(0, 300), nConflictos: an.conflictos.length, ambiguos: an.ambiguos.slice(0, 100) };
}

function VCO_copiar_(id, quien) {
  var lista = JSON.parse(CacheService.getScriptCache().get('vco_' + String(id || '').replace(/[^a-f0-9-]/gi, '')) || 'null');
  if (!lista) return { mensaje: 'La vista previa venció. Vuelva a abrir la ventana.' };
  var ss = ssPrincipal_(), cfg = leerConfig_(ss);
  var an = { O: { sh: SpreadsheetApp.openById(cfg.idVouchers).getSheetByName('Originales') } };
  var r = VCO_escribir_(ss, an, lista, quien || '');
  if (r.hechos) MESA_programarRecalculo_();
  return { mensaje: r.hechos ? '🔗 Copié ' + r.hechos + ' dato(s) a Originales (cada celda con nota «🔗 Copiado de Fotos!…»). Cobranzas se recalcula en ~1 minuto.' + (r.hechos < lista.length ? ' ' + (lista.length - r.hechos) + ' ya no estaban vacíos y se dejaron.' : '') : 'No se copió nada (esas celdas ya tenían dato).' };
}

function VCO_deshacer_(quien) {
  var r = MESA_deshacerQuien_(quien || '', 'VCO-');
  if (/^No encontré/.test(r.mensaje)) r = MESA_deshacerQuien_('automático', 'VCO-');   // lo que copió la actualización automática
  return r;
}

// En la hoja de Cobranzas (la ventana llama a estas):
function VCO_ver() { return VCO_ver_(); }
function VCO_copiar(id) { var q = ''; try { q = Session.getActiveUser().getEmail(); } catch (e) {} return VCO_copiar_(id, q || 'hoja de Cobranzas'); }
function VCO_deshacer() { var q = ''; try { q = Session.getActiveUser().getEmail(); } catch (e) {} return VCO_deshacer_(q || 'hoja de Cobranzas'); }
