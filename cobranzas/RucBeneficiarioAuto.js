/**
 * 🔎 RUC DEL BENEFICIARIO SOLO, POR NOMBRE — acordado con el usuario el 26/11/2026.
 *
 * En cada actualización de Cobranzas (si está encendido: 💼 Cobranzas → 🔎 RUC por nombre → Completar solo), en la hoja de
 * Vouchers, SOLO donde «RUC beneficiario» está vacío y hay nombre de beneficiario, se pone el RUC cuando es CLARO:
 *   · el nombre del voucher y el nombre que tiene ese RUC en sus facturas del SIRE (o en las empresas del grupo) coinciden
 *     casi al 100 % EN LOS DOS SENTIDOS (todas las palabras de uno están en el otro; forma societaria y puntos no cuentan);
 *   · y ningún otro RUC se le parece (el segundo, por debajo de 80).
 *   · Un alias ya confirmado (⚙️ Config) solo se usa si su RUC TAMBIÉN pasa esa comparación de nombres (por si se guardó mal).
 * Cada celda lleva una nota «🔎 Completado solo por nombre … = … (RUC …)» y el lote se guarda para ↩️ Deshacer (solo las
 * celdas que siguen como las dejó; deshacer apaga el automático para que no las vuelva a llenar).
 */

var RBA_MARCA_ = '🔎 Completado solo por nombre';
var RBA_CARPETA_ = '🔎 RUC beneficiario (lotes para deshacer)';

function RBA_activo_() { return PropertiesService.getScriptProperties().getProperty('RBA_ACTIVO') !== '0'; }

function RBA_carpeta_(ss) {
  var padre = DriveApp.getFileById(ss.getId()).getParents().next(), it = padre.getFoldersByName(RBA_CARPETA_);
  return it.hasNext() ? it.next() : padre.createFolder(RBA_CARPETA_);
}

/** Nombre del voucher → {ruc, nombre, puntaje} si es claro; null si no. */
function RBA_resolver_(nombre, propios, cfg) {
  var q = RPN_palabras_(nombre);
  if (q.length < 2 && !(q.length === 1 && q[0].length >= 6)) return null;   // nombres de una palabra corta: muy ambiguos
  var cands = propios.map(function (p) {
    var a = RPN_puntaje_(q, p.pal), b = a >= 80 ? RPN_puntaje_(p.pal, q) : 0;
    return { ruc: p.ruc, nombre: p.nombre, ida: a, vuelta: b, min: Math.min(a, b) };
  }).filter(function (x) { return x.ida >= 60; }).sort(function (x, y) { return y.min - x.min || y.ida - x.ida; });
  if (!cands.length || cands[0].min < 95) return null;
  if (cands[1] && Math.max(cands[1].min, cands[1].ida) >= 80 && cands[1].ruc !== cands[0].ruc) return null;   // otro parecido: no es claro
  var alias = cfg.aliasNombre[normNombre_(nombre)];
  if (alias && alias !== cands[0].ruc) return null;   // el alias guardado dice otro RUC: no se arriesga
  return { ruc: cands[0].ruc, nombre: cands[0].nombre, puntaje: cands[0].min, alias: !!alias };
}

/** Desde actualizarTodoInterno_: res.docs (SIRE) y vch.pagos (vouchers). */
function RBA_completar_(cfg, res, vch) {
  if (!RBA_activo_() || !cfg.idVouchers) return '';
  var m = {};
  Object.keys(cfg.nombreEmpresa).forEach(function (r) { m[r] = cfg.razonEmpresa[r] || cfg.nombreEmpresa[r]; });
  res.docs.forEach(function (d) {
    if (d.emisorRuc && d.emisorNombre && !m[d.emisorRuc]) m[d.emisorRuc] = d.emisorNombre;
    if (d.receptorRuc && d.receptorNombre && !m[d.receptorRuc]) m[d.receptorRuc] = d.receptorNombre;
  });
  var propios = Object.keys(m).filter(function (r) { return /^\d{11}$/.test(r); }).map(function (r) { return { ruc: r, nombre: m[r], pal: RPN_palabras_(m[r]) }; });
  if (!propios.length) return '';
  // por pestaña: filas sin RUC beneficiario y con nombre
  var porNombre = {}, filas = {};
  vch.pagos.forEach(function (p) {
    if (!p.fuente || p.beneficiarioRuc || !String(p.beneficiarioNombre || '').trim()) return;
    var k = normNombre_(p.beneficiarioNombre);
    if (!k) return;
    porNombre[k] = porNombre[k] || p.beneficiarioNombre;
    var t = p.fuente.split('!')[0];
    (filas[t] = filas[t] || []).push({ fila: Number(p.fuente.split('!')[1]), k: k, nombre: p.beneficiarioNombre, op: p.operacion, monto: p.monto });
  });
  var resueltos = {};
  Object.keys(porNombre).forEach(function (k) { var r = RBA_resolver_(porNombre[k], propios, cfg); if (r) resueltos[k] = r; });
  if (!Object.keys(resueltos).length) return '';
  var libro = SpreadsheetApp.openById(cfg.idVouchers), cuando = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm');
  var lote = { cuando: cuando, filas: [] }, total = 0;
  Object.keys(filas).forEach(function (t) {
    var h = libro.getSheetByName(t);
    if (!h || h.getLastRow() < 2) return;
    var col = indiceColumnas_(h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0]);
    var c = col('RUC beneficiario', 'ID Beneficiario');
    if (c < 0) return;
    var n = h.getLastRow() - 1, rg = h.getRange(2, c + 1, n, 1), val = rg.getValues(), notas = rg.getNotes(), cambio = 0;
    filas[t].forEach(function (x) {
      var r = resueltos[x.k], i = x.fila - 2;
      if (!r || i < 0 || i >= n || String(val[i][0]).trim()) return;
      val[i][0] = r.ruc;
      notas[i][0] = (String(notas[i][0] || '') + '\n' + RBA_MARCA_ + ' el ' + cuando + ': «' + String(x.nombre).trim() + '» = «' + r.nombre + '» (' +
        (r.alias ? 'alias confirmado y ' : '') + 'sus facturas SIRE, ' + r.puntaje + '/100) → RUC ' + r.ruc).trim();
      lote.filas.push({ hoja: t, op: String(x.op || ''), monto: Number(x.monto) || 0, ruc: r.ruc });
      cambio++;
    });
    if (!cambio) return;
    rg.setNumberFormat('@'); rg.setValues(val); rg.setNotes(notas);
    total += cambio;
  });
  if (!total) return '';
  try { RBA_carpeta_(ssPrincipal_()).createFile('lote ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmmss') + '.json', JSON.stringify(lote), MimeType.PLAIN_TEXT); }
  catch (e) { console.warn('RUC beneficiario (lote): ' + e.message); }
  return total + ' RUC de beneficiario puesto(s) por nombre (' + Object.keys(resueltos).length + ' nombre(s) claros)';
}

/** ↩️ Deshace el lote más reciente (solo las celdas que siguen como las dejó). */
function RBA_deshacer_() {
  var ss = ssPrincipal_(), cfg = leerConfig_(ss), it = RBA_carpeta_(ss).getFiles(), f = null;
  while (it.hasNext()) { var x = it.next(); if (!f || x.getName() > f.getName()) f = x; }
  if (!f) return 'No hay ningún completado para deshacer.';
  var lote = JSON.parse(f.getBlob().getDataAsString()), libro = SpreadsheetApp.openById(cfg.idVouchers), n = 0, otras = 0;
  var hojas = {};
  lote.filas.forEach(function (x) { (hojas[x.hoja] = hojas[x.hoja] || []).push(x); });
  Object.keys(hojas).forEach(function (t) {
    var h = libro.getSheetByName(t);
    if (!h || h.getLastRow() < 2) return;
    var col = indiceColumnas_(h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0]), c = col('RUC beneficiario', 'ID Beneficiario');
    if (c < 0) return;
    var nn = h.getLastRow() - 1, v = h.getRange(2, 1, nn, 5).getValues(), rg = h.getRange(2, c + 1, nn, 1), val = rg.getValues(), notas = rg.getNotes();
    var idx = {};
    v.forEach(function (r, i) { idx[String(r[1]).trim() + '|' + (Math.round((Number(r[4]) || 0) * 100) / 100)] = i; });
    hojas[t].forEach(function (x) {
      var i = idx[x.op.trim() + '|' + (Math.round(x.monto * 100) / 100)];
      if (i === undefined) return;
      if (String(val[i][0]).trim() !== x.ruc || String(notas[i][0]).indexOf(RBA_MARCA_ + ' el ' + lote.cuando) < 0) { otras++; return; }
      val[i][0] = '';
      notas[i][0] = String(notas[i][0]).split('\n').filter(function (l) { return l.indexOf(RBA_MARCA_ + ' el ' + lote.cuando) < 0; }).join('\n');
      n++;
    });
    rg.setValues(val); rg.setNotes(notas);
  });
  f.setTrashed(true);
  return '↩️ Deshecho: se quitaron ' + n + ' RUC de beneficiario puestos el ' + lote.cuando + '.' + (otras ? ' ' + otras + ' no se tocaron (ya los habían cambiado).' : '');
}

function menuRbaInterruptor() {
  var props = PropertiesService.getScriptProperties(), ui = SpreadsheetApp.getUi(), activo = RBA_activo_();
  if (ui.alert('🔎 Completar RUC del beneficiario solo', 'Ahora está ' + (activo ? 'ENCENDIDO' : 'APAGADO') + '.\n\nEncendido: en cada actualización, donde «RUC beneficiario» está vacío se pone el RUC SOLO si el nombre del voucher ' +
    'coincide casi al 100 % con el de ese RUC en sus facturas del SIRE y ningún otro se le parece. Nunca cambia lo ya escrito.\n\n¿' + (activo ? 'Apagarlo' : 'Encenderlo') + '?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  props.setProperty('RBA_ACTIVO', activo ? '0' : '1');
  ui.alert(activo ? '⏸ Apagado.' : '✅ Encendido: se completa en la próxima actualización.');
}

function menuRbaDeshacer() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('↩️ Deshacer el último completado de RUC beneficiario', '¿Quito los RUC que el sistema puso solo en su último lote? (los que usted cambió después no se tocan). El automático queda apagado.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('RBA_ACTIVO', '0');
  ui.alert('↩️ Deshacer', RBA_deshacer_() + '\n\nPara volver a encenderlo: 💼 Cobranzas → 🔎 RUC por nombre → Completar solo.', ui.ButtonSet.OK);
}
