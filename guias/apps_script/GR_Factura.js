/**
 * 🚚 Guías — datos de la factura desde el SIRE (ventas) que baja GitHub: cliente y productos con su cantidad.
 * Lee sire/<RUC>/historico/<AAAAMM>/reporte_parseado_ventas.csv del repositorio (columnas items_descripcion e
 * items_cantidad, sacadas del XML de cada factura).
 *   - Con N° de factura: llena el destinatario y, si la guía es parcial, la descripción de cada producto
 *     (se reconoce por la cantidad).
 *   - Sin N° de factura (solo cotización): busca la factura cuyos productos tienen esas cantidades.
 */

var GR_GH_ = { owner: 'Aquivan', repo: 'Claude', rama: 'claude/python-codes-izve18' };

function GR_menuToken() {
  var ui = SpreadsheetApp.getUi(), p = PropertiesService.getScriptProperties();
  var r = ui.prompt('🔑 Token de GitHub', 'Para leer las facturas del SIRE que guarda GitHub (el mismo token de las otras hojas del grupo, permiso de lectura de "Contents").\n' +
    (p.getProperty('GR_GITHUB_TOKEN') ? 'Ya hay uno guardado: escriba otro para cambiarlo.' : ''), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
  p.setProperty('GR_GITHUB_TOKEN', r.getResponseText().trim());
  ui.alert('Token guardado (solo en esta hoja, no en celdas).');
}

/** Texto de un archivo del repositorio, o null si no existe. */
function GR_ghTexto_(ruta) {
  var tok = PropertiesService.getScriptProperties().getProperty('GR_GITHUB_TOKEN');
  var url = tok ? 'https://api.github.com/repos/' + GR_GH_.owner + '/' + GR_GH_.repo + '/contents/' + ruta + '?ref=' + encodeURIComponent(GR_GH_.rama)
    : 'https://raw.githubusercontent.com/' + GR_GH_.owner + '/' + GR_GH_.repo + '/' + GR_GH_.rama + '/' + ruta;
  var op = { muteHttpExceptions: true, headers: tok ? { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github.raw' } : {} };
  var r = UrlFetchApp.fetch(url, op), c = r.getResponseCode();
  if (c === 404) return null;
  if (c === 401 || c === 403) throw new Error('GitHub no dejó leer (HTTP ' + c + '): ponga el token en 🚚 Guías → 🔑 Token de GitHub.');
  if (c >= 300) throw new Error('GitHub respondió HTTP ' + c + '.');
  return r.getContentText('UTF-8');
}

/** Facturas del SIRE de ventas de una empresa en un periodo: [{serie, numero, fecha, ruc, cliente, items:[{desc, cant}]}]. */
var GR_VENTAS_CACHE_ = {};
function GR_ventas_(ruc, periodo) {
  var k = ruc + '|' + periodo;
  if (GR_VENTAS_CACHE_[k]) return GR_VENTAS_CACHE_[k];
  var txt = GR_ghTexto_('sire/' + ruc + '/historico/' + periodo + '/reporte_parseado_ventas.csv'), out = [];
  if (txt) {
    var v = Utilities.parseCsv(txt.replace(/^﻿/, '')), h = v[0].map(function (x) { return GR_norm_(x); });
    var c = function (n) { return h.indexOf(GR_norm_(n)); };
    var iS = c('Serie del CDP'), iN = c('Nro CP o Doc. Nro Inicial (Rango)'), iF = c('Fecha de emisión'), iR = c('Nro Doc Identidad'),
      iC = c('Apellidos Nombres/ Razón Social'), iD = c('items_descripcion'), iQ = c('items_cantidad'), iT = c('Tipo CP/Doc.');
    v.slice(1).forEach(function (f) {
      if (iT >= 0 && ['01', '03', '1', '3'].indexOf(String(f[iT]).trim()) < 0) return;
      var ds = iD >= 0 ? String(f[iD] || '').split(' || ') : [], qs = iQ >= 0 ? String(f[iQ] || '').split(' || ') : [];
      out.push({ serie: String(f[iS]).trim(), numero: Number(f[iN]), fecha: f[iF], ruc: String(f[iR]).trim(), cliente: String(f[iC]).trim(),
        items: qs.map(function (q, i) { return { desc: String(ds[i] || '').trim(), cant: Number(String(q).replace(/,/g, '')) || 0 }; }).filter(function (x) { return x.cant > 0 || x.desc; }) });
    });
  }
  GR_VENTAS_CACHE_[k] = out;
  return out;
}

/** Periodos AAAAMM a revisar: el de la fecha de traslado, el anterior y el actual. */
function GR_periodos_(fecha) {
  var d = fecha instanceof Date ? fecha : new Date(), out = [];
  [0, -1].forEach(function (m) { var x = new Date(d.getFullYear(), d.getMonth() + m, 1); out.push(Utilities.formatDate(x, 'America/Lima', 'yyyyMM')); });
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMM');
  if (out.indexOf(hoy) < 0) out.unshift(hoy);
  return out;
}

/**
 * Empareja las líneas de la guía con los productos de la factura por cantidad:
 * igual → esa línea (completa); menor → la línea de la factura que queda sin usar con cantidad mayor (parcial).
 * Devuelve [{i (línea de la factura), completa}] o null si alguna no se puede reconocer sin dudas.
 */
function GR_emparejar_(items, cantidades) {
  var usados = {}, out = [];
  for (var j = 0; j < cantidades.length; j++) {
    var q = cantidades[j], i = -1;
    for (var a = 0; a < items.length; a++) if (!usados[a] && Math.abs(items[a].cant - q) < 0.001) { i = a; break; }
    if (i >= 0) { usados[i] = true; out.push({ i: i, completa: true }); continue; }
    var mayores = items.map(function (x, a) { return a; }).filter(function (a) { return !usados[a] && items[a].cant > q; });
    if (mayores.length !== 1) return null;
    usados[mayores[0]] = true; out.push({ i: mayores[0], completa: false });
  }
  return out;
}

/** Busca la factura: por serie-número, o (sin número) por las cantidades de sus productos. → {f, emp} o {error}. */
function GR_buscarFactura_(empresaRuc, serie, numero, fecha, cantidades) {
  var pers = GR_periodos_(fecha);
  for (var k = 0; k < pers.length; k++) {
    var fs = GR_ventas_(empresaRuc, pers[k]);
    if (numero) {
      var f = fs.filter(function (x) { return x.numero === Number(numero) && (!serie || x.serie === serie); })[0];
      if (f) return { f: f };
    }
  }
  if (numero) return { error: 'la factura ' + (serie || '') + '-' + numero + ' no está en el SIRE de ventas de ' + pers.join(', ') + ' (¿ya se descargó?)' };
  if (!cantidades || !cantidades.length) return { error: 'sin N° de factura ni productos con cantidad para buscarla' };
  var hits = [];
  pers.forEach(function (p) {
    GR_ventas_(empresaRuc, p).forEach(function (x) {
      if (cantidades.every(function (q) { return x.items.some(function (it) { return Math.abs(it.cant - q) < 0.001; }); })) hits.push(x);
    });
  });
  if (hits.length === 1) return { f: hits[0], porCantidad: true };
  return { error: hits.length ? hits.length + ' facturas tienen esas cantidades: ponga el N°' : 'ninguna factura del SIRE tiene esas cantidades (puede que aún no se emita o no se descargue)' };
}

/** Menú 🔎: para las filas seleccionadas de 🚚 Guías. */
function GR_menuTraerFactura() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet();
  if (sh.getName() !== GR_HOJA_) return SpreadsheetApp.getUi().alert('Seleccione una o varias filas de 🚚 Guías.');
  var rg = sh.getActiveRange(), f0 = Math.max(rg.getRow(), GR_FILA1_), f1 = rg.getLastRow(), msgs = [];
  for (var f = f0; f <= f1; f++) {
    try { var m = GR_traerFactura_(ss, f); if (m) msgs.push(m); } catch (e) { msgs.push('Fila ' + f + ': ⚠️ ' + e.message); }
  }
  SpreadsheetApp.getUi().alert('🔎 Datos de la factura', msgs.join('\n') || 'No había guías en esas filas.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Completa una guía con su factura del SIRE. Devuelve un texto con lo que hizo. */
function GR_traerFactura_(ss, fila) {
  var sh = ss.getSheetByName(GR_HOJA_), x = GR_leerGuias_(sh, fila, fila)[0].r, ctx = GR_contexto_(ss);
  if (!x.id) return '';
  var emp = ctx.emp[String(x.empresa).trim()];
  if (!emp) return x.id + ': falta la empresa';
  if (String(x.docrel) === 'Ninguno') return x.id + ': guía sin comprobante, no hay factura que leer';
  var lineas = ctx.prod[x.id] || [];
  var r = GR_buscarFactura_(emp.ruc, String(x.serie || emp.serieFact || '').toUpperCase(), String(x.numero || '').replace(/\D/g, ''), x.fecha,
    lineas.map(function (p) { return p.cant; }).filter(function (q) { return q > 0; }));
  if (r.error) return x.id + ': ' + r.error;
  var fac = r.f, hecho = [];
  var poner = function (k, v) { if (v !== '' && v != null && String(x[k]) !== String(v)) { sh.getRange(fila, GR_col_(k)).setValue(v); hecho.push(k); } };
  if (!x.serie) poner('serie', fac.serie);
  if (!x.numero) poner('numero', fac.numero);
  if (!x.ndest) { poner('tdest', fac.ruc.length === 11 ? GR_TIPODOC_[0] : GR_TIPODOC_[1]); poner('ndest', fac.ruc); poner('dest', fac.cliente); }
  // Productos: descripción por cantidad; y si la guía lleva todo lo de la factura.
  if (lineas.length) {
    var par = GR_emparejar_(fac.items, lineas.map(function (p) { return p.cant; }));
    if (!par) hecho.push('⚠️ no pude reconocer qué producto es cada línea por la cantidad: revíselas');
    else {
      GR_ponerDescripciones_(ss, x.id, par.map(function (pp) { return { desc: fac.items[pp.i].desc, completa: pp.completa ? 'SI' : 'NO' }; }));
      var todo = par.length === fac.items.length && par.every(function (pp) { return pp.completa; });
      poner('total', todo ? 'SI' : 'NO');
      hecho.push('productos');
    }
  }
  GR_procesarFilas_(ss, fila, fila, ['ndest', 'productos', 'serie', 'numero']);
  GR_registrar_(x.id, '🔎 Factura del SIRE', fac.serie + '-' + fac.numero + ' · ' + fac.cliente + (r.porCantidad ? ' (encontrada por cantidades)' : ''));
  return x.id + ': ' + fac.serie + '-' + fac.numero + ' de ' + fac.cliente + (r.porCantidad ? ' (encontrada por las cantidades)' : '') + (hecho.length ? ' → ' + hecho.join(', ') : ' (ya estaba completa)');
}

/** Escribe descripción y ¿Completa? en las líneas de 📦 Productos de esa guía (en su orden). */
function GR_ponerDescripciones_(ss, id, datos) {
  var p = ss.getSheetByName(GR_PROD_);
  if (p.getLastRow() < 2) return;
  var v = p.getRange(2, 1, p.getLastRow() - 1, 1).getValues(), k = 0;
  for (var i = 0; i < v.length && k < datos.length; i++) {
    if (String(v[i][0]) !== id) continue;
    var d = p.getRange(i + 2, 4);
    if (!String(d.getValue()).trim()) d.setValue(datos[k].desc);
    p.getRange(i + 2, 10).setValue(datos[k].completa);
    k++;
  }
}
