/**
 * RucPorNombre.js — 🔎 RUC por nombre: completa el RUC de los vouchers que solo traen el nombre del
 * beneficiario (o de quien se pregunte por Telegram/WhatsApp).
 *
 * Busca en cascada, de lo más seguro a lo más amplio:
 *   1. Alias ya confirmados (⚙️ Config → ALIAS DE NOMBRES): esos vouchers ya se cruzan, no se buscan.
 *   2. Tus facturas del SIRE (emisores y clientes de las Liquidaciones IGV) y las empresas del grupo.
 *   3. El Padrón Reducido del RUC de SUNAT (descarga pública, ~18 millones de RUC), que revisa GitHub
 *      (workflow ruc-por-nombre.yml + scripts/ruc_por_nombre.py). Los nombres no viajan en GitHub: el
 *      robot se los pide al bot (canal=gh, solo una ejecución de ese workflow que esté corriendo) y le
 *      devuelve los candidatos.
 * Nada se da por bueno solo: la pestaña "🔎 RUC por nombre" propone el RUC y la persona marca ✔.
 * Con 💾 Guardar, los ✔ pasan a la tabla de alias de ⚙️ Config y el cruce los usa desde la próxima
 * actualización. La hoja de Vouchers no se toca.
 */

var RPN_HOJA_ = '🔎 RUC por nombre';
var RPN_WF_ = 'ruc-por-nombre.yml';
var RPN_ENC_ = ['Nombre (como viene en el voucher)', 'Vouchers', 'Monto total', 'RUC sugerido', 'Razón social', 'Fuente', 'Puntaje',
  'Otras opciones', '✔ Usar', 'Estado'];
var RPN_PROP_ = 'RPN_L_';
var RPN_SEGURO_ = 90;   // puntaje para sugerir sin dudas (igual hay que marcar ✔)
var RPN_DEBILES_ = ('DE DEL LA LAS LOS EL Y E EN A AL POR PARA CON SAN SANTA CORPORACION CORP INVERSIONES INVERSION GRUPO EMPRESA ' +
  'EMPRESAS NEGOCIACIONES NEGOCIOS SERVICIOS SERVICIO COMERCIAL COMERCIALIZADORA DISTRIBUIDORA DISTRIBUCIONES INDUSTRIAS ' +
  'INDUSTRIAL CONSTRUCTORA CONTRATISTAS TRANSPORTES TRANSPORTE IMPORTACIONES EXPORTACIONES GENERALES GENERAL PERU PERUANA ' +
  'MULTISERVICIOS ASOCIACION COOPERATIVA AGRICOLA AGROINDUSTRIAL CIA COMPANIA HNOS HERMANOS').split(' ');

/* ============================================================ comparar nombres (igual que scripts/ruc_por_nombre.py) */

/** Palabras del nombre sin forma societaria (normNombre_ de Motor.js) y con & → Y. */
function RPN_palabras_(s) {
  return normNombre_(String(s || '').replace(/&/g, ' Y ')).replace(/\b(?:[A-Z] ){2,}[A-Z]\b/g, function (m) { return m.replace(/ /g, ''); })
    .split(' ').filter(Boolean).map(function (p) { return { CORP: 'CORPORACION', CIA: 'COMPANIA', HNOS: 'HERMANOS' }[p] || p; });
}

/** 0–100: palabras de q dentro de c sin importar el orden; iniciales y palabras cortadas valen como prefijo. */
function RPN_puntaje_(q, c) {
  if (!q.length || !c.length) return 0;
  var usadas = {}, total = 0, pesoTotal = 0;
  q.forEach(function (w) {
    var peso = RPN_DEBILES_.indexOf(w) >= 0 ? 0.35 : (w.length === 1 ? 0.6 : 1);
    pesoTotal += peso;
    var mejor = 0, cual = -1;
    c.forEach(function (x, j) {
      if (usadas[j]) return;
      var s = w === x ? 1 : w.length === 1 ? (x.charAt(0) === w ? 0.9 : 0) : (w.length >= 3 && x.indexOf(w) === 0 ? 0.92 :
        (w.length >= 5 && Math.abs(w.length - x.length) <= 1 && CIA_lev_(w, x) === 1 ? 0.85 : 0));
      if (s > mejor) { mejor = s; cual = j; }
    });
    if (cual >= 0) usadas[cual] = true;
    total += mejor * peso;
  });
  var sobran = c.filter(function (x, j) { return !usadas[j] && RPN_DEBILES_.indexOf(x) < 0; }).length;
  return Math.max(0, Math.min(100, Math.round(100 * total / pesoTotal - 6 * sobran)));
}

/** Candidatos propios: RUC → nombre de las facturas del SIRE y de las empresas del grupo. */
function RPN_propios_(cfg) {
  var m = {};
  Object.keys(cfg.nombreEmpresa).forEach(function (r) { m[r] = cfg.nombreEmpresa[r]; });
  try {
    leerDocumentosSire_(cfg, buscarLiquidaciones_(cfg)).forEach(function (d) {
      if (d.emisorRuc && d.emisorNombre && !m[d.emisorRuc]) m[d.emisorRuc] = d.emisorNombre;
      if (d.receptorRuc && d.receptorNombre && !m[d.receptorRuc]) m[d.receptorRuc] = d.receptorNombre;
    });
  } catch (e) { Logger.log('RUC por nombre — SIRE: ' + e.message); }
  return Object.keys(m).map(function (r) { return { ruc: r, nombre: m[r], pal: RPN_palabras_(m[r]) }; });
}

/** Mejores candidatos propios para un nombre: [{ruc, nombre, puntaje}] (máx. 3, desde 45 puntos). */
function RPN_buscarPropios_(propios, nombre) {
  var q = RPN_palabras_(nombre);
  return propios.map(function (p) { return { ruc: p.ruc, nombre: p.nombre, puntaje: RPN_puntaje_(q, p.pal) }; })
    .filter(function (x) { return x.puntaje >= 45; })
    .sort(function (a, b) { return b.puntaje - a.puntaje; }).slice(0, 3);
}

/** ¿El primero gana sin dudas? (puntaje alto y bastante más que el segundo) */
function RPN_claro_(cands) {
  return cands.length && cands[0].puntaje >= RPN_SEGURO_ && (!cands[1] || cands[0].puntaje - cands[1].puntaje >= 8);
}

/* ============================================================ pestaña 🔎 RUC por nombre */

function menuBuscarRucPorNombre() {
  var r = RPN_buscarHoja_(SpreadsheetApp.getActive());
  SpreadsheetApp.getUi().alert('🔎 RUC por nombre', r.texto, SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuGuardarRucConfirmados() {
  var n = RPN_guardar_(SpreadsheetApp.getActive());
  SpreadsheetApp.getUi().alert('💾 RUC confirmados', n ? n + ' nombre(s) pasaron a ⚙️ Config → ALIAS DE NOMBRES. El cruce los usa desde la próxima 🔄 actualización.'
    : 'No hay filas con ✔ Usar marcadas (y un RUC de 11 dígitos).', SpreadsheetApp.getUi().ButtonSet.OK);
}

function RPN_hoja_(ss) {
  var sh = ss.getSheetByName(RPN_HOJA_);
  if (sh) return sh;
  sh = ss.insertSheet(RPN_HOJA_);
  sh.getRange(1, 1, 1, RPN_ENC_.length).merge().setValue('🔎 RUC POR NOMBRE · vouchers que traen el nombre del beneficiario pero no su RUC. ' +
    'Revise la sugerencia (o copie otra de "Otras opciones" en RUC sugerido), marque ✔ Usar y luego 💼 Cobranzas → 💾 Guardar RUC confirmados.')
    .setWrap(true).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.OSCURO);
  sh.setRowHeight(1, 48);
  sh.getRange(2, 1, 1, RPN_ENC_.length).setValues([RPN_ENC_]).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true);
  sh.setFrozenRows(2);
  [260, 70, 95, 105, 280, 140, 65, 380, 65, 200].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('D:D').setNumberFormat('@');
  sh.getRange('C:C').setNumberFormat('#,##0.00');
  return sh;
}

/** Busca los vouchers sin RUC del beneficiario, propone con lo propio y manda el resto al padrón. → {texto} */
function RPN_buscarHoja_(ss) {
  var guardados = RPN_guardar_(ss);   // lo ya marcado ✔ no se pierde al rehacer la lista
  var cfg = leerConfig_(ss);
  var grupos = {};
  leerVouchers_(cfg).pagos.forEach(function (p) {
    var nom = String(p.beneficiarioNombre || '').trim();
    if (p.beneficiarioRuc || !nom) return;
    var k = normNombre_(nom);
    if (!k || cfg.aliasNombre[k] || cfg.aliasEmpresa[normHeader_(nom)]) return;
    var g = grupos[k] = grupos[k] || { nombre: nom, n: 0, monto: 0 };
    g.n++; g.monto += Number(p.monto) || 0;
  });
  var lista = Object.keys(grupos).map(function (k) { return grupos[k]; }).sort(function (a, b) { return b.monto - a.monto; });
  var sh = RPN_hoja_(ss);
  if (sh.getLastRow() > 2) sh.getRange(3, 1, sh.getLastRow() - 2, RPN_ENC_.length).clearContent().clearDataValidations().setBackground(null);
  if (!lista.length) return { texto: (guardados ? '💾 ' + guardados + ' guardado(s). ' : '') + '✅ No hay vouchers con nombre y sin RUC (fuera de los alias ya confirmados).' };
  var propios = RPN_propios_(cfg), alPadron = [], filas = [];
  lista.forEach(function (g) {
    var c = RPN_buscarPropios_(propios, g.nombre);
    var claro = RPN_claro_(c);
    if (!claro) alPadron.push({ q: g.nombre });
    filas.push([g.nombre, g.n, g.monto, c[0] ? c[0].ruc : '', c[0] ? c[0].nombre : '', c[0] ? 'Tus facturas (SIRE)' : '', c[0] ? c[0].puntaje : '',
      RPN_otras_(c.slice(1)), false, claro ? '✅ Sugerido (revise y marque ✔)' : '⏳ Buscando en el padrón de SUNAT…']);
  });
  sh.getRange(3, 1, filas.length, RPN_ENC_.length).setValues(filas);
  sh.getRange(3, 9, filas.length, 1).insertCheckboxes();
  var lanzado = alPadron.length ? RPN_lanzar_(ss, alPadron.slice(0, 150), { origen: 'hoja' }) : '';
  return { texto: (guardados ? '💾 ' + guardados + ' guardado(s) en alias. ' : '') + lista.length + ' nombre(s) sin RUC en los vouchers: ' +
    (lista.length - alPadron.length) + ' encontrado(s) en tus facturas' +
    (alPadron.length ? '; ' + alPadron.length + ' se buscan en el padrón de SUNAT (unos 3–5 minutos). ' + lanzado : '.') +
    '\nRevise la pestaña ' + RPN_HOJA_ + ', marque ✔ Usar y luego 💾 Guardar RUC confirmados.' };
}

function RPN_otras_(c) {
  return c.map(function (x) { return x.ruc + ' ' + x.nombre + ' (' + x.puntaje + ')'; }).join('; ');
}

/** Pasa las filas con ✔ (y RUC válido) a la tabla de alias de ⚙️ Config. Devuelve cuántas. */
function RPN_guardar_(ss) {
  var sh = ss.getSheetByName(RPN_HOJA_);
  if (!sh || sh.getLastRow() < 3) return 0;
  var v = sh.getRange(3, 1, sh.getLastRow() - 2, RPN_ENC_.length).getValues();
  var cfgSh = ss.getSheetByName(HOJA.CONFIG), ya = {};
  var ult = Math.max(cfgSh.getLastRow(), 3);
  cfgSh.getRange(3, 9, ult - 2, 2).getValues().forEach(function (r) { if (r[0]) ya[normNombre_(r[0])] = true; });
  var nuevos = [];
  v.forEach(function (r, i) {
    var ruc = String(r[3]).replace(/\D/g, '');
    if (r[8] !== true || ruc.length !== 11 || ya[normNombre_(r[0])]) return;
    ya[normNombre_(r[0])] = true;
    nuevos.push([String(r[0]), ruc]);
    sh.getRange(i + 3, 9, 1, 2).setValues([[false, '💾 Guardado en alias']]);
  });
  if (!nuevos.length) return 0;
  // primera fila libre de la tabla de alias (columnas I:J)
  var col = cfgSh.getRange(3, 9, Math.max(ult - 2, 1), 1).getValues(), fila = 3;
  for (var k = col.length - 1; k >= 0; k--) if (String(col[k][0]).trim()) { fila = k + 4; break; }
  cfgSh.getRange(fila, 10, nuevos.length, 1).setNumberFormat('@');
  cfgSh.getRange(fila, 9, nuevos.length, 2).setValues(nuevos);
  return nuevos.length;
}

/* ============================================================ el robot de GitHub (padrón) */

/** Deja los nombres guardados para el robot y lo lanza. extra = {origen:'hoja'|'tg'|'wa', chat}. Devuelve un texto. */
function RPN_lanzar_(ss, consultas, extra) {
  var lote = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  PropertiesService.getScriptProperties().setProperty(RPN_PROP_ + lote, JSON.stringify({ consultas: consultas, extra: extra, t: Date.now() }));
  try {
    var cfg = TG_cfg_(ss);
    TG_gh_(cfg, '/actions/workflows/' + RPN_WF_ + '/dispatches', 'post', { ref: cfg.rama, inputs: { lote: lote } });
    return '';
  } catch (e) {
    PropertiesService.getScriptProperties().deleteProperty(RPN_PROP_ + lote);
    return '⚠️ No pude lanzar la búsqueda en el padrón: ' + e.message;
  }
}

/** doPost ?canal=gh de una ejecución de ruc-por-nombre.yml (validada en TG_Captcha.js). */
function RPN_gh_(q) {
  var p = PropertiesService.getScriptProperties(), k = RPN_PROP_ + String(q.lote || '').replace(/\W/g, '');
  var lote = JSON.parse(p.getProperty(k) || 'null');
  if (!lote) return { ok: false, error: 'lote desconocido o ya respondido' };
  if (q.accion === 'rpn_pendientes') return { ok: true, consultas: lote.consultas };
  if (q.accion !== 'rpn_resultados') return { ok: false, error: 'accion desconocida' };
  p.deleteProperty(k);
  var res = q.resultados || [], ex = lote.extra || {};
  if (ex.origen === 'hoja') RPN_ponerEnHoja_(TG_ss_(), res);
  else RPN_avisarChat_(ex, res, q.error);
  return { ok: true };
}

function RPN_ponerEnHoja_(ss, res) {
  var sh = ss.getSheetByName(RPN_HOJA_);
  if (!sh || sh.getLastRow() < 3) return;
  var porNombre = {};
  res.forEach(function (r) { porNombre[normNombre_(r.q)] = r.candidatos || []; });
  var v = sh.getRange(3, 1, sh.getLastRow() - 2, RPN_ENC_.length).getValues();
  v.forEach(function (r, i) {
    if (String(r[9]).indexOf('⏳') !== 0) return;
    var c = porNombre[normNombre_(r[0])];
    if (!c) return;
    var propio = r[3] ? [{ ruc: String(r[3]), nombre: String(r[4]), puntaje: Number(r[6]) || 0, fuente: r[5] }] : [];
    var todos = propio.concat(c.map(function (x) {
      return { ruc: x.ruc, nombre: x.nombre + (x.estado && x.estado !== 'ACTIVO' ? ' [' + x.estado + ']' : ''), puntaje: x.puntaje, fuente: 'Padrón SUNAT' };
    }));
    var vistos = {};
    todos = todos.filter(function (x) { if (vistos[x.ruc]) return false; vistos[x.ruc] = true; return true; })
      .sort(function (a, b) { return b.puntaje - a.puntaje; });
    var estado = !todos.length ? '❔ No encontrado (escriba el RUC si lo sabe)' : RPN_claro_(todos) ? '✅ Sugerido (revise y marque ✔)' : '🤔 Revisar: hay varias opciones';
    sh.getRange(i + 3, 4, 1, 5).setValues([[todos[0] ? todos[0].ruc : '', todos[0] ? todos[0].nombre : '', todos[0] ? todos[0].fuente : '',
      todos[0] ? todos[0].puntaje : '', RPN_otras_(todos.slice(1, 4))]]);
    sh.getRange(i + 3, 10).setValue(estado);
  });
}

/* ============================================================ Telegram y WhatsApp: "ruc NOMBRE" */

/** Texto con los candidatos (propios ya, padrón cuando vuelva). html=true para Telegram. */
function RPN_texto_(nombre, cands, html, fuente) {
  var b = function (t) { return html ? '<b>' + TG_esc_(t) + '</b>' : '*' + t + '*'; };
  var e = function (t) { return html ? TG_esc_(t) : t; };
  if (!cands.length) return '🔎 ' + b(nombre) + ': no lo encontré en ' + fuente + '.';
  return '🔎 ' + b(nombre) + ' · ' + fuente + ':\n' + cands.map(function (c, i) {
    return (i + 1) + '. ' + (html ? '<code>' + c.ruc + '</code>' : c.ruc) + ' ' + e(c.nombre) + (c.estado && c.estado !== 'ACTIVO' ? ' [' + e(c.estado) + ']' : '') + ' — ' + c.puntaje + ' pts';
  }).join('\n');
}

/** "ruc NOMBRE" / "/ruc NOMBRE" / "ruc vouchers". Devuelve el texto inmediato; el del padrón llega después. */
function RPN_consulta_(ss, texto, extra) {
  var html = extra.origen === 'tg';
  var nombre = String(texto || '').replace(/^\s*\/?ruc\b\s*(de\s+|del\s+)?/i, '').trim();
  if (!nombre) return '🔎 Escriba el nombre o la razón social: ' + (html ? '<code>/ruc CORPORACION GRANIX</code>' : '*ruc CORPORACION GRANIX*') +
    '\nO ' + (html ? '<code>/ruc vouchers</code>' : '*ruc vouchers*') + ' para revisar todos los vouchers sin RUC.';
  if (/^vouchers?$/i.test(nombre)) return RPN_buscarHoja_(ss).texto;
  var cfg = leerConfig_(ss);
  var alias = cfg.aliasNombre[normNombre_(nombre)];
  if (alias) return '🔎 ' + (html ? '<b>' + TG_esc_(nombre) + '</b>' : '*' + nombre + '*') + ' ya está confirmado en los alias: RUC ' + alias + '.';
  var propios = RPN_buscarPropios_(RPN_propios_(cfg), nombre);
  var r = RPN_texto_(nombre, propios, html, 'tus facturas (SIRE)');
  if (RPN_claro_(propios)) return r;
  var err = RPN_lanzar_(ss, [{ q: nombre }], extra);
  return r + '\n\n' + (err || '⏳ Lo busco también en el padrón de SUNAT; le aviso en unos 3–5 minutos.');
}

function RPN_avisarChat_(ex, res, error) {
  var r = res[0] || { q: '', candidatos: [] };
  if (ex.origen === 'tg' && ex.chat) {
    TG_enviar_(ex.chat, error ? '⚠️ Padrón de SUNAT: ' + TG_esc_(error) : RPN_texto_(r.q, r.candidatos || [], true, 'padrón de SUNAT'));
  } else if (ex.origen === 'wa') {
    try { TGC_wa_({ tipo: 'texto', texto: error ? '⚠️ Padrón de SUNAT: ' + error : RPN_texto_(r.q, r.candidatos || [], false, 'padrón de SUNAT') }); } catch (e) {}
  }
}
