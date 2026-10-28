/**
 * 🚛 Guías — Buscar transportista y vehículos en el MTC (Registro Nacional de Transporte de Carga, consulta pública
 * sin captcha) y 👤 conductor por DNI (nombre de RENIEC vía apis.net.pe, sin clave).
 *   · Por RUC del transportista o por placa: N° de registro MTC, estado (habilitado / vigente hasta) y sus vehículos con el
 *     N° de constancia (certificado de habilitación vehicular), categoría, ejes y carga útil.
 *   · Se guarda en 🚛 Transportistas y 🚗 Vehículos y, si se abrió desde una guía, se pone en esa guía.
 * Los teléfonos que muestra el MTC NO se leen ni se guardan.
 * Funciones GR_.
 */

var GR_MTC_ = 'https://www.mtc.gob.pe/tramitesenlinea/tweb_tLinea/tw_consultadgtt/';

/* ---------------- MTC (ASP.NET: se lleva la sesión y los campos ocultos de una página a la otra) ---------------- */

function GR_mtcPagina_(pagina, campos, galleta) {
  var op = { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0' } };
  if (galleta) op.headers.Cookie = galleta;
  if (campos) { op.method = 'post'; op.payload = campos; }
  var r = UrlFetchApp.fetch(GR_MTC_ + pagina, op);
  if (r.getResponseCode() !== 200) throw new Error('el MTC respondió HTTP ' + r.getResponseCode() + ' (intente en un momento)');
  var h = r.getAllHeaders()['Set-Cookie'], g = galleta || '';
  if (h) g = [].concat(h).map(function (c) { return String(c).split(';')[0]; }).join('; ');
  return { html: r.getContentText('UTF-8'), galleta: g };
}

function GR_ocultos_(html) {
  var o = {};
  html.replace(/name="(__[A-Z]+)"[^>]*value="([^"]*)"/g, function (m, n, v) { o[n] = v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); });
  return o;
}

function GR_texto_(html) {
  return String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' | ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#209;|&Ntilde;/g, 'Ñ').replace(/&#241;|&ntilde;/g, 'ñ').replace(/\s+/g, ' ').replace(/(\|\s*)+/g, '| ');
}

/** Empresas del MTC por RUC ('2') o placa ('4'): [{codigo, nombre, ruc, …detalle}]. */
function GR_mtcBuscar_(tipo, valor) {
  var p1 = GR_mtcPagina_('Frm_rep_intra_mercancia.aspx'), d = GR_ocultos_(p1.html);
  d.rbOpciones = tipo; d.txtValor = valor; d.hdopcion = tipo; d.hdvalore = valor; d.hdopc = '';
  var p2 = GR_mtcPagina_('Frm_rep_intra_mercancia_display.aspx', d, p1.galleta), out = [], vistos = {};
  p2.html.replace(/toDetalle\('([^']+)','(\d+)'\)/g, function (m, cod, ruc) { if (!vistos[cod + ruc]) { vistos[cod + ruc] = 1; out.push({ codigo: cod, ruc: ruc }); } });
  return out.slice(0, 5).map(function (e) {
    var d2 = GR_ocultos_(p2.html); d2.hdpartida = e.codigo; d2.hdruc = e.ruc;
    try { return Object.assign(e, GR_mtcDetalle_(GR_mtcPagina_('Frm_rep_intra_mercancia_datos.aspx', d2, p2.galleta).html)); }
    catch (err) { e.error = err.message; return e; }
  });
}

/** Detalle de una empresa: nombre, dirección, estado, vigencia y vehículos (sin teléfonos). */
function GR_mtcDetalle_(html) {
  var t = GR_texto_(html), campo = function (et) { var m = t.match(new RegExp(et + '\\s*:\\s*\\|\\s*([^|]*)\\|')); return m ? m[1].trim() : ''; };
  var rs = t.match(/Raz[oó]n Social:\s*\|\s*([^|]*)\|\s*-\s*\|\s*([^|]*)\|/);
  var veh = [];
  (html.match(/<tr class="textDisplay">[\s\S]*?<\/tr>/g) || []).forEach(function (tr) {
    var c = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(function (td) { return GR_texto_(td).replace(/\|/g, '').trim(); });
    if (c.length >= 9 && /^[A-Z0-9]{6}$/.test(c[1])) veh.push({ placa: c[1], constancia: c[2], categoria: c[3], anio: c[5], ejes: c[6], carga: c[7] });
  });
  return { nombre: rs ? rs[2].trim() : '', direccion: campo('Direcci[oó]n'), estado: campo('Estado'), vigente: campo('Vigente Hasta'),
    modalidad: campo('Modalidad de Empresa'), vehiculos: veh };
}

/* ---------------- ventana ---------------- */

function GR_menuBuscarTransporte() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), f = sh.getActiveRange().getRow(), ctx = { id: '', ruc: '', placa: '' };
  if (sh.getName() === GR_HOJA_ && f >= GR_FILA1_) {
    var r = GR_leerGuias_(sh, f, f)[0].r;
    ctx.id = String(r.id || ''); ctx.ruc = String(r.truc || '').replace(/\D/g, ''); ctx.placa = String(r.placa || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } else if (sh.getName() === GR_TRA_ && f >= 2) ctx.ruc = String(sh.getRange(f, 1).getValue()).replace(/\D/g, '');
  else if (sh.getName() === GR_VEH_ && f >= 2) ctx.placa = String(sh.getRange(f, 1).getValue()).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  var t = HtmlService.createTemplateFromFile('GR_TransporteVista');
  t.ctxJson = JSON.stringify(ctx);
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(900).setHeight(620), '🚛 Transportista y vehículos (consulta MTC)');
}

/** Lo que pide la ventana: por RUC o por placa. */
function GR_buscarTransporte(valor) {
  var v = String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^\d{11}$/.test(v)) return { tipo: 'ruc', valor: v, empresas: GR_mtcBuscar_('2', v) };
  if (/^[A-Z0-9]{6}$/.test(v)) return { tipo: 'placa', valor: v, empresas: GR_mtcBuscar_('4', v) };
  throw new Error('Escriba el RUC del transportista (11 dígitos) o una placa (6 caracteres, ej. Z7B807).');
}

/**
 * Guarda lo elegido. d = {empresa:{ruc, nombre, codigo}, guardarEmpresa, vehiculos:[{placa, constancia, categoria, anio, ejes, carga}],
 * id, principal (placa), secundaria (placa), modo: 'publico'|'privado'}
 */
function GR_guardarTransporte(d) {
  var ss = SpreadsheetApp.getActive(), ctx = GR_contexto_(ss), hechos = [];
  var agregar = function (hoja, fila) { var h = ss.getSheetByName(hoja), ult = 1, last = h.getLastRow();
    if (last >= 2) h.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { if (String(r[0]).trim()) ult = i + 2; });
    h.getRange(ult + 1, 1, 1, fila.length).setValues([fila]); };
  var e = d.empresa || {};
  if (d.guardarEmpresa && e.ruc) {
    if (ctx.tra[e.ruc]) {   // ya estaba: se completa el MTC si faltaba
      var ht = ss.getSheetByName(GR_TRA_), vt = ht.getRange(2, 1, ht.getLastRow() - 1, 3).getValues();
      vt.forEach(function (r, i) { if (String(r[0]).replace(/\D/g, '') === e.ruc && !String(r[2]).trim() && e.codigo) ht.getRange(i + 2, 3).setValue(e.codigo); });
    } else { agregar(GR_TRA_, [e.ruc, e.nombre, e.codigo || '', 'SI']); hechos.push('transportista'); }
  }
  (d.vehiculos || []).forEach(function (v) {
    var pl = GR_placa_(v.placa), desc = [v.categoria, v.anio, v.ejes ? v.ejes + ' ejes' : '', v.carga ? 'carga ' + v.carga + ' kg' : '', e.nombre ? 'de ' + e.nombre : ''].filter(String).join(' · ');
    if (ctx.veh[pl]) {   // ya estaba: se completa el certificado si faltaba
      var hv = ss.getSheetByName(GR_VEH_), vv = hv.getRange(2, 1, hv.getLastRow() - 1, 6).getValues();
      vv.forEach(function (r, i) { if (GR_placa_(r[0]) === pl) { if (!String(r[5]).trim()) hv.getRange(i + 2, 6).setValue(v.constancia); if (!String(r[1]).trim()) hv.getRange(i + 2, 2).setValue(desc); } });
    } else { agregar(GR_VEH_, [pl, desc, 'NO', '', 'SI', v.constancia]); hechos.push('placa ' + pl); }
  });
  var guia = '';
  if (d.id) {
    var sh = ss.getSheetByName(GR_HOJA_), fila = GR_filaDe_(sh, d.id);
    if (fila) {
      var poner = function (k, val) { sh.getRange(fila, GR_col_(k)).setValue(val); };
      var cambiadas = [];
      if (d.modo === 'publico' && e.ruc) { poner('modalidad', GR_MODALIDAD_[0]); poner('truc', e.ruc); poner('tnom', e.nombre); poner('mtc', e.codigo || ''); cambiadas.push('truc', 'tnom', 'mtc', 'modalidad'); }
      [['placa', 'mtcveh', d.principal], ['placa2', 'mtcveh2', d.secundaria]].forEach(function (x) {
        if (!x[2]) return;
        poner(x[0], GR_placa_(x[2])); cambiadas.push(x[0]);
        var vv = (d.vehiculos || []).filter(function (v) { return v.placa === x[2]; })[0];
        if (vv && vv.constancia) { poner(x[1], vv.constancia); cambiadas.push(x[1]); }
      });
      if (d.modo === 'privado' && d.principal) { poner('modalidad', GR_MODALIDAD_[1]); cambiadas.push('modalidad'); }
      GR_procesarFilas_(ss, fila, fila, cambiadas);
      guia = d.id;
    }
  }
  GR_registrar_(d.id || '', '🚛 MTC', (e.nombre || '') + ' · ' + (hechos.join(', ') || 'sin cambios') + (guia ? ' · puesto en la guía' : ''));
  return { hechos: hechos, guia: guia };
}

/* ---------------- 👤 conductor por DNI ---------------- */

/** DNI → {nombres, apellidos} (RENIEC vía apis.net.pe). null si no se encuentra. */
function GR_nombreDni_(dni) {
  var cache = CacheService.getDocumentCache(), k = 'gr_dni_' + dni, g = cache.get(k);
  if (g) return JSON.parse(g);
  try {
    var r = UrlFetchApp.fetch('https://api.apis.net.pe/v1/dni?numero=' + dni, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r.getResponseCode() !== 200) return null;
    var j = JSON.parse(r.getContentText()), n = String(j.nombre || '').replace(/\s+/g, ' ').trim();
    if (!n) return null;
    var out = GR_partirNombre_(n);
    try { cache.put(k, JSON.stringify(out), 21600); } catch (e) {}
    return out;
  } catch (e) { return null; }
}

/** Menú: completa nombres y apellidos del conductor por su DNI (en la guía seleccionada o en 👤 Conductores). */
function GR_menuConductorDni() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), rg = sh.getActiveRange(), msgs = [];
  if (sh.getName() === GR_HOJA_) {
    GR_leerGuias_(sh, Math.max(rg.getRow(), GR_FILA1_), rg.getLastRow()).forEach(function (x) {
      var dni = String(x.r.cdni || '').replace(/\D/g, '');
      if (!/^\d{8}$/.test(dni)) return msgs.push((x.r.id || 'Fila ' + x.fila) + ': ponga el DNI del conductor (8 dígitos).');
      var n = GR_nombreDni_(dni);
      if (!n) return msgs.push(x.r.id + ': no encontré el DNI ' + dni + '.');
      if (!String(x.r.cnom).trim()) sh.getRange(x.fila, GR_col_('cnom')).setValue(n.nom);
      if (!String(x.r.cape).trim()) sh.getRange(x.fila, GR_col_('cape')).setValue(n.ape);
      GR_procesarFilas_(ss, x.fila, x.fila, ['cnom', 'cape']);
      msgs.push(x.r.id + ': ' + n.nom + ' ' + n.ape + (String(x.r.clic).trim() ? '' : ' · falta la licencia (búsquela en el brevete; suele ser una letra + el DNI)'));
    });
  } else if (sh.getName() === GR_CON_) {
    for (var f = Math.max(2, rg.getRow()); f <= rg.getLastRow(); f++) {
      var v = sh.getRange(f, 1, 1, 4).getValues()[0], dni = String(v[0]).replace(/\D/g, '');
      if (!/^\d{8}$/.test(dni)) continue;
      var n = GR_nombreDni_(dni);
      if (!n) { msgs.push(dni + ': no encontrado'); continue; }
      if (!String(v[1]).trim()) sh.getRange(f, 2).setValue(n.nom);
      if (!String(v[2]).trim()) sh.getRange(f, 3).setValue(n.ape);
      msgs.push(dni + ': ' + n.nom + ' ' + n.ape);
    }
  } else return SpreadsheetApp.getUi().alert('Seleccione la fila de la guía (o de 👤 Conductores) con el DNI del conductor.');
  ss.toast(msgs.join('\n') || 'No había DNI en esas filas.', '👤 Conductor por DNI', 10);
}
