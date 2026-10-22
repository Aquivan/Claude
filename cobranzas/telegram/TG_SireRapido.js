/**
 * ⚡ SIRE solo reporte (rápido) desde Telegram (/sire) y WhatsApp ("sire …").
 *
 * Pide a GitHub (sire-solo-reporte.yml) SOLO el registro de compras y/o ventas del SIRE por la API
 * oficial de SUNAT, sin navegador ni PDF/XML: una empresa, varias o todas; un mes o un rango.
 * Ejemplos:  /sire                         → botones (empresa → periodo)
 *            /sire granix 202609           → GRANIX, setiembre 2026, compras y ventas
 *            /sire todas 202601-202609     → todas las empresas, enero a setiembre
 *            /sire granix, luque 09/2026 compras
 * Siempre se confirma con un botón. Al terminar avisa cuántos comprobantes trajo de cada empresa y
 * mes; la hoja "SIRE SUNAT" los importa a Drive sola (webhook) y la Liquidación IGV se actualiza.
 */

var TGS_MAX_MESES_ = 36;
var TGS_RELLENO_ = ['sire', 'rapido', 'solo', 'reporte', 'reportes', 'registro', 'registros', 'de', 'del', 'la', 'las', 'el', 'los',
  'y', 'e', 'a', 'al', 'hasta', 'desde', 'para', 'por', 'en', 'bajar', 'baja', 'actualizar', 'actualiza', 'descargar', 'descarga',
  'empresa', 'empresas', 'mes', 'meses', 'periodo', 'periodos', 'sunat', 'compras', 'compra', 'ventas', 'venta', 'ambos', 'todo',
  'este', 'actual', 'anterior', 'pasado', 'ano', 'anio', 'ultimos', 'ultimo', 'sin', 'pdf', 'xml', 'facturas'];

/**
 * Lee lo que escribió la persona → {acc} (lista para proponer) o {error}. vacio:true si no escribió nada.
 * acc = {t:'descarga', proyecto:'sire_rapido', empresa:'todas'|'ruc,ruc', desde, hasta, tipo}
 */
function TGS_interpretar_(cob, texto) {
  var t = normHeader_(String(texto || '').replace(/^\/?sire\b/i, ''));
  if (!t) return { vacio: true };
  var hoy = TG_mes_(0);

  // Periodos: 202609, 09/2026, 9-2026; "este mes", "mes anterior", "este año", "últimos N meses".
  var pers = [];
  t = t.replace(/\b(20\d\d)(0[1-9]|1[0-2])\b/g, function (x) { pers.push(x); return ' '; })
    .replace(/\b(0?[1-9]|1[0-2])\s*\/\s*(20\d\d)\b/g, function (x, m, a) { pers.push(a + ('0' + m).slice(-2)); return ' '; });
  if (/\b\d{6}\b/.test(t)) return { error: 'Ese periodo no es válido: use AAAAMM (ej. ' + hoy + ') o MM/AAAA.' };
  var desde = '', hasta = '';
  if (pers.length) { pers.sort(); desde = pers[0]; hasta = pers[pers.length - 1]; }
  else if (/\b(mes )?(anterior|pasado)\b/.test(t)) desde = hasta = TG_mes_(1);
  else if (/\b(ultimos?) (\d{1,2}) meses\b/.test(t)) { var n = Number(t.match(/\b(ultimos?) (\d{1,2}) meses\b/)[2]); desde = TG_mes_(Math.max(0, n - 1)); hasta = hoy; }
  else if (/\b(este )?(ano|anio)\b/.test(t)) { desde = hoy.slice(0, 4) + '01'; hasta = hoy; }
  else { desde = hasta = hoy; }
  if (hasta > hoy) return { error: hasta + ' todavía no empieza (estamos en ' + hoy + ').' };
  var meses = TGS_meses_(desde, hasta).length;
  if (meses > TGS_MAX_MESES_) return { error: 'Son ' + meses + ' meses: el máximo es ' + TGS_MAX_MESES_ + ' por vez.' };

  // Registro: compras, ventas o ambos.
  var c = /\bcompras?\b/.test(t), v = /\bventas?\b/.test(t);
  var tipo = c && !v ? 'compra' : v && !c ? 'venta' : 'ambos';

  // Empresas: RUC de 11 dígitos o nombres/alias de la hoja de Cobranzas; "todas" o nada = todas.
  var rucs = [];
  (t.match(/\b\d{11}\b/g) || []).forEach(function (r) { if (cob.grupo.indexOf(r) >= 0 && rucs.indexOf(r) < 0) rucs.push(r); });
  var malos = (t.match(/\b\d{11}\b/g) || []).filter(function (r) { return cob.grupo.indexOf(r) < 0; });
  if (malos.length) return { error: 'Este RUC no es del grupo: ' + malos.join(', ') };
  var resto = ' ' + t.replace(/\b\d{11}\b/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  Object.keys(cob.aliasEmpresa || {}).sort(function (a, b) { return b.length - a.length; }).forEach(function (al) {
    if (al.length < 3 || resto.indexOf(' ' + al + ' ') < 0) return;
    var r = cob.aliasEmpresa[al];
    if (rucs.indexOf(r) < 0) rucs.push(r);
    resto = resto.split(' ' + al + ' ').join(' ');
  });
  var todas = /\btodas?\b/.test(resto);
  var sobra = resto.replace(/\btodas?\b/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1 && TGS_RELLENO_.indexOf(w) < 0 && !/^\d+$/.test(w); });
  if (sobra.length && !rucs.length) return { error: 'No reconozco la empresa "' + sobra.join(' ') + '".', desconocido: true };
  return { acc: { t: 'descarga', proyecto: 'sire_rapido', empresa: todas || !rucs.length ? 'todas' : rucs.join(','), desde: desde, hasta: hasta, tipo: tipo } };
}

function TGS_meses_(desde, hasta) {
  var out = [], a = Number(desde.slice(0, 4)), m = Number(desde.slice(4));
  while (out.length <= 600) {
    var p = a + ('0' + m).slice(-2);
    out.push(p);
    if (p >= hasta) break;
    m++; if (m > 12) { m = 1; a++; }
  }
  return out;
}

var TGS_AYUDA_ = 'Ejemplos:\n/sire granix 202609\n/sire todas 202601-202609\n/sire granix, luque 09/2026 compras\n/sire mes anterior';

/** /sire [empresas] [periodo o rango] [compras|ventas] */
function TGS_comandoTG_(ctx, arg) {
  var cfg = TG_cfg_(ctx.ss);
  var r = TGS_interpretar_(cfg.cob, arg);
  if (r.vacio) return TG_asistenteDescarga_(Object.assign({}, ctx, { msgId: null }), 'p:sire_rapido');   // mensaje nuevo (no editar el de la persona)
  if (r.error) return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(r.error) + '\n\n' + TG_esc_(TGS_AYUDA_));
  TG_proponerDescarga_(ctx, r.acc);
}

/** WhatsApp: "sire …" escrito tal cual. Devuelve null si no parece un pedido (lo contesta la IA). */
function TGS_wa_(ss, texto) {
  if (!/^\s*sire\b/i.test(texto) || /\?/.test(texto)) return null;
  var cfg = TG_cfg_(ss);
  var r = TGS_interpretar_(cfg.cob, texto);
  if (r.error && r.desconocido) return null;   // p. ej. "sire de granix cuánto IGV…": mejor la IA
  if (r.error) return { ok: true, respuesta: '⚠️ ' + r.error + '\n\n' + TGS_AYUDA_.replace(/\//g, ''), tablas: [], sugerencias: [], archivos: [], avisos: [] };
  var acc = r.acc || { t: 'descarga', proyecto: 'sire_rapido', empresa: 'todas', desde: TG_mes_(0), hasta: TG_mes_(0), tipo: 'ambos' };
  return { ok: true, respuesta: '⚡ *SIRE solo reporte* (rápido, sin PDF/XML)' + (r.vacio ? '\n_Para otra empresa o mes:_\n' + TGS_AYUDA_.replace(/\//g, '') : ''),
    tablas: [], sugerencias: [], archivos: [], avisos: [], descargas: [{ k: TG_guardarBoton_(acc), texto: TG_textoDescarga_(acc, cfg.cob) }] };
}

/** Nombre que GitHub le pone a la corrida (run-name de sire-solo-reporte.yml): así se reconoce cuál es la de cada pedido. */
function TGS_titulo_(inputs) {
  return 'SIRE solo reporte · ' + (inputs.ruc || 'todas') + ' · ' + (inputs.periodo || 'mes actual') + ' · ' + (inputs.tipo || 'ambos');
}

/** Al terminar la corrida: cuántos comprobantes trajo por empresa y mes (de las anotaciones del workflow). */
function TGS_avisarFin_(cfg, s, r) {
  var notas = [];
  try {
    (TG_gh_(cfg, '/actions/runs/' + r.id + '/jobs?per_page=100').jobs || []).forEach(function (j) {
      notas = notas.concat(TG_gh_(cfg, '/check-runs/' + j.id + '/annotations') || []);
    });
  } catch (e) {}
  var lineas = [], problemas = [], vistas = {};
  notas.forEach(function (n) {
    if (vistas[n.title + '|' + n.message]) return;
    vistas[n.title + '|' + n.message] = true;
    var m = String(n.title || '').match(/^SIRE (reporte|sin reporte|sin guardar|solo reporte)\s*(\d{11})?/);
    if (!m) return;
    var quien = m[2] ? TG_nombreEmpresa_(cfg, m[2]) : '';
    var msg = String(n.message || '').replace(/\(oficial\)/g, '(presentado)').replace(/\s*;\s*$/, '').trim();
    if (m[1] === 'reporte') lineas.push('• <b>' + TG_esc_(quien) + '</b>: ' + TG_esc_(msg));
    else problemas.push('⚠️ ' + (quien ? '<b>' + TG_esc_(quien) + '</b>: ' : '') + TG_esc_(msg));
  });
  var ok = r.conclusion === 'success';
  var html = (ok ? '✅ <b>Reporte SIRE listo</b>' : '⚠️ <b>Reporte SIRE con problemas</b>') + ' (' + TG_duracion_(r) + '): ' + TG_esc_(s.texto) +
    (lineas.length ? '\n' + lineas.join('\n') : '') + (problemas.length ? '\n' + problemas.join('\n') : '') +
    (lineas.length ? '\n<i>La hoja SIRE lo pasa a Drive sola (y actualiza la Liquidación IGV).</i>' : '') +
    '\n<a href="' + r.html_url + '">ver en GitHub</a>';
  if (String(s.chat).indexOf('wa') === 0) return TGR_guardarWA_(s.chat, html);
  TG_enviar_(s.chat, html, ok ? null : [[{ text: '🔁 Reintentar lo que falló', callback_data: 'rr:' + r.id }]]);
}
