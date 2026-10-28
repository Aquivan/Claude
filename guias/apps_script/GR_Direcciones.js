/**
 * 🚚 Guías — 📍 Buscar direcciones por RUC: los locales (almacenes, tiendas, sucursales) que el RUC tiene registrados en
 * SUNAT, del «Padrón reducido de locales anexos» que SUNAT publica cada día (padron_reducido_local_anexo.zip, ~14 MB).
 * Se eligen en una ventana y se agregan a 📍 Direcciones (Llegada / Partida / Ambos) y, si se abrió desde una guía,
 * uno se usa como su llegada (o partida). Lo de cada RUC queda guardado un día para no volver a bajar el padrón.
 * Funciones GR_.
 */

var GR_ANEXOS_URLS_ = ['https://www.sunat.gob.pe/descargaPRR/padron_reducido_local_anexo.zip', 'https://www2.sunat.gob.pe/padron_reducido_local_anexo.zip'];

function GR_menuBuscarDirecciones() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), f = sh.getActiveRange().getRow(), ctx = { ruc: '', nombre: '', id: '', para: 'l' };
  if (sh.getName() === GR_HOJA_ && f >= GR_FILA1_) {
    var r = GR_leerGuias_(sh, f, f)[0].r;
    ctx.id = String(r.id || '');
    ctx.ruc = String(r.ndest || '').replace(/\D/g, '');
    ctx.nombre = String(r.dest || '');
    if (sh.getActiveRange().getColumn() >= GR_col_('plocal') && sh.getActiveRange().getColumn() <= GR_col_('pest')) {   // clic en PARTIDA
      var emp = GR_contexto_(ss).emp[String(r.empresa).trim()] || {};
      ctx.ruc = emp.ruc || ''; ctx.nombre = String(emp.razon || r.empresa || ''); ctx.para = 'p';
    }
  } else if (sh.getName() === GR_DIR_ && f >= 2) {
    var v = sh.getRange(f, 1, 1, 3).getValues()[0];
    ctx.ruc = String(v[1] || '').replace(/\D/g, ''); ctx.nombre = String(v[2] || '');
  }
  var t = HtmlService.createTemplateFromFile('GR_DireccionesVista');
  t.ctxJson = JSON.stringify(ctx);
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(860).setHeight(600), '📍 Direcciones por RUC (locales registrados en SUNAT)');
}

/** "JR.|TAMBOMACHAY|URB.|CINCUENTENARIO|-|-|-|11|-|C1" → "JR. TAMBOMACHAY MZA. C1 LOTE. 11 URB. CINCUENTENARIO - JULIACA - SAN ROMAN - PUNO". */
function GR_direccionAnexo_(c, ubigeo) {
  var v = function (i) { var x = String(c[i] == null ? '' : c[i]).trim(); return x === '-' ? '' : x; };
  var p = [];
  if (v(2) || v(3)) p.push((v(2) + ' ' + v(3)).trim());
  if (v(6)) p.push('NRO. ' + v(6));
  if (v(7)) p.push('KM. ' + v(7));
  if (v(8)) p.push('INT. ' + v(8));
  if (v(11)) p.push('MZA. ' + v(11));
  if (v(9)) p.push('LOTE. ' + v(9));
  if (v(10)) p.push('DPTO. ' + v(10));
  if (v(4) || v(5)) p.push((v(4) + ' ' + v(5)).trim());
  var l = (GR_UBIGEOS_.filter(function (x) { return x.slice(0, 6) === ubigeo; })[0] || '').split('|');   // código|DEPARTAMENTO|PROVINCIA|DISTRITO
  return p.join(' ') + (l.length > 3 ? ' - ' + l[3] + ' - ' + l[2] + ' - ' + l[1] : '');
}

/** Locales del RUC según SUNAT: [{ubigeo, etiqueta, direccion}] (guardado 1 día por RUC). */
function GR_anexosDe_(ruc) {
  var cache = CacheService.getDocumentCache(), k = 'gr_anx_' + ruc, guardado = cache.get(k);
  if (guardado) return JSON.parse(guardado);
  var blob = null, ultimo = '';
  for (var i = 0; i < GR_ANEXOS_URLS_.length && !blob; i++) {
    try {
      var r = UrlFetchApp.fetch(GR_ANEXOS_URLS_[i], { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.getResponseCode() === 200) blob = r.getBlob(); else ultimo = 'HTTP ' + r.getResponseCode();
    } catch (e) { ultimo = e.message; }
  }
  if (!blob) throw new Error('No pude bajar el padrón de locales de SUNAT (' + ultimo + '). Intente en unos minutos.');
  blob.setContentType('application/zip');
  var txt = Utilities.unzip(blob)[0].getDataAsString('ISO-8859-1'), clave = '\n' + ruc + '|', out = [], pos = txt.indexOf(clave);
  while (pos >= 0) {
    var fin = txt.indexOf('\n', pos + 1), linea = txt.substring(pos + 1, fin < 0 ? txt.length : fin).replace(/\r$/, '');
    var c = linea.split('|'), ub = String(c[1] || '').trim();
    out.push({ ubigeo: ub, etiqueta: GR_ubigeos_()[ub] || ub, direccion: GR_direccionAnexo_(c, ub) });
    pos = txt.indexOf(clave, pos + 1);
  }
  txt = null;
  try { cache.put(k, JSON.stringify(out), 86400); } catch (e) {}
  return out;
}

/** Lo que muestra la ventana: los locales de SUNAT y los que ya están en 📍 Direcciones para ese RUC. */
function GR_buscarDirecciones(ruc) {
  ruc = String(ruc || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(ruc)) throw new Error('Escriba un RUC de 11 dígitos (las personas con DNI no tienen locales registrados).');
  var ss = SpreadsheetApp.getActive(), ctx = GR_contexto_(ss);
  var ya = ctx.dir.filter(function (d) { return d.doc === ruc; }).map(function (d) { return { local: d.local, direccion: String(d.dir), uso: d.uso, ubigeo: String(d.ubi) }; });
  var anexos = GR_anexosDe_(ruc), norm = ya.map(function (d) { return GR_norm_(d.direccion); });
  anexos.forEach(function (a) { a.yaEsta = norm.indexOf(GR_norm_(a.direccion)) >= 0; });
  var nombre = (ctx.dir.filter(function (d) { return d.doc === ruc && d.nom; })[0] || {}).nom || '';
  return { ruc: ruc, nombre: String(nombre), anexos: anexos, ya: ya };
}

/**
 * Guarda lo elegido. d = {ruc, nombre, items:[{direccion, ubigeo (código o etiqueta), uso}], id (guía), usar: índice en items o -1, para: 'l'|'p'}.
 * → {agregadas, guia}
 */
function GR_agregarDirecciones(d) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(GR_DIR_), ctx = GR_contexto_(ss), ruc = String(d.ruc || '').replace(/\D/g, '');
  var nombre = String(d.nombre || '').trim(), existentes = ctx.dir.map(function (x) { return x.doc + '|' + GR_norm_(x.dir); });
  var locales = ctx.dir.map(function (x) { return x.local; }), nuevas = [], usado = null;
  (d.items || []).forEach(function (it, i) {
    var etq = GR_ubigeos_()[GR_codUbigeo_(it.ubigeo)] || it.ubigeo || '';
    var dist = (etq.match(/·\s*([^(]+)\(/) || [])[1] || '';
    var base = ((nombre || ruc).split(/\s+/).slice(0, 2).join(' ') + ' · ' + dist.trim()).trim(), local = base, n = 2;
    while (locales.indexOf(local) >= 0) local = base + ' ' + n++;
    var clave = ruc + '|' + GR_norm_(it.direccion);
    if (existentes.indexOf(clave) < 0) {
      locales.push(local); existentes.push(clave);
      nuevas.push([local, ruc, nombre, it.uso || 'Llegada', etq, it.direccion, '', 'De SUNAT (locales anexos)']);
    } else local = (ctx.dir.filter(function (x) { return x.doc === ruc && GR_norm_(x.dir) === GR_norm_(it.direccion); })[0] || {}).local || '';
    if (i === Number(d.usar)) usado = { local: local, etq: etq, dir: it.direccion };
  });
  if (nuevas.length) {
    var ult = 1, last = sh.getLastRow();   // última fila con local, RUC o dirección (las listas desplegables no cuentan)
    if (last >= 2) sh.getRange(2, 1, last - 1, 6).getValues().forEach(function (r, i) { if (String(r[0]).trim() || String(r[1]).trim() || String(r[5]).trim()) ult = i + 2; });
    if (sh.getMaxRows() < ult + nuevas.length) sh.insertRowsAfter(sh.getMaxRows(), ult + nuevas.length - sh.getMaxRows() + 20);
    sh.getRange(ult + 1, 1, nuevas.length, 8).setValues(nuevas);
  }
  var guia = '';
  if (d.id && usado) {
    var g = ss.getSheetByName(GR_HOJA_), fila = GR_filaDe_(g, d.id), x = d.para === 'p' ? 'p' : 'l';
    if (fila) {
      if (usado.local) g.getRange(fila, GR_col_(x + 'local')).setValue(usado.local);
      g.getRange(fila, GR_col_(x + 'ubi')).setValue(usado.etq);
      g.getRange(fila, GR_col_(x + 'dir')).setValue(usado.dir);
      GR_procesarFilas_(ss, fila, fila, [x + 'local', x + 'ubi', x + 'dir']);
      guia = d.id;
    }
  }
  GR_registrar_(d.id || '', '📍 Direcciones de SUNAT', ruc + ' · ' + nuevas.length + ' agregada(s)' + (guia ? ' · usada en la guía' : ''));
  return { agregadas: nuevas.length, guia: guia };
}
