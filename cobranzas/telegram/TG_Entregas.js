/**
 * 🏷 ¿De quién son estos vouchers? — nombre de la tanda para la columna "Archivo Original".
 *
 * Al registrar varios vouchers juntos (📥 Registrar como voucher en Telegram, o reenviados por
 * WhatsApp) se pregunta UNA vez de quién son y de qué fecha, y cada archivo queda con el formato
 * de siempre: "18-10-26 Edit.jpg", "18-10-26 Edit 2.jpg", "18-10-26 Edit 3.pdf"…
 *   - Botones con los nombres más usados y uno ⭐ sugerido por la IA (quién paga en el voucher;
 *     aprende: si a "INVERSIONES PETRO SAC" se le puso "Petro", la próxima vez sugiere "Petro").
 *   - Se puede escribir o decir 🎤 "Edit", "Edit 15/10", "son de Edit de ayer".
 *   - El nombre NUNCA se repite (se revisa la columna "Archivo Original" de la hoja de Vouchers y
 *     Drive): la hoja de Vouchers busca el archivo por ese nombre para 🔧 reparar imágenes y para
 *     seguir un PDF a medias, y con dos iguales podría tomar el que no es.
 * Lo usan el bot de Telegram (aquí) y la app de WhatsApp (TGW_doPost_, accion=entrega).
 */

var TGE_PROP_NOMBRES_ = 'TGE_NOMBRES';      // {nombre: {n: veces, t: última vez}}
var TGE_PROP_APRENDIDO_ = 'TGE_APRENDIDO';  // {ORDENANTE NORMALIZADO: nombre elegido}
var TGE_PROP_PEND_ = 'TGE_P_';              // preguntas de Telegram sin contestar (la vigía las cierra)
var TGE_ESPERA_MIN_ = 20;
var TGE_MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var TGE_PREGUNTA_RX_ = /\?|¿|\b(cu[aá]nto|cu[aá]ntos|qu[eé]|cu[aá]l|cu[aá]les|d[oó]nde|c[oó]mo|cu[aá]ndo|qui[eé]n|por\s?qu[eé]|mand[ae]|env[ií]a|busca|dame|mu[eé]strame|hay)\b/i;

/* ============================================================ nombres y fechas */

function TGE_hoy_() { return Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd'); }

function TGE_corta_(iso) { var p = String(iso).split('-'); return p[2] + '-' + p[1] + '-' + p[0].slice(2); }

function TGE_norm_(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function TGE_limpiarNombre_(s) {
  var t = String(s || '').replace(/[\\\/:*?"<>|#\[\]{}]/g, ' ').replace(/[.,;!¡]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  if (t && t === t.toLowerCase()) t = t.replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  return t;
}

/**
 * "Edit", "Edit 15/10", "son de Edit de ayer", "de María del 12 de octubre", "Petro 15-10-26".
 * Devuelve {nombre, fecha:'yyyy-MM-dd', error} — nombre '' si no parece un nombre (ej. una pregunta).
 */
function TGE_interpretar_(texto) {
  var t = ' ' + String(texto || '').replace(/\s+/g, ' ').trim() + ' ';
  var out = { nombre: '', fecha: TGE_hoy_(), error: '' };
  if (!t.trim() || TGE_PREGUNTA_RX_.test(t) || t.trim().split(' ').length > 9) return out;
  if (/^\s*(ok|okey|oka|gracias|muchas gracias|listo|ya|si|sí|no|hola|bien|perfecto|vale|dale|chevere|chévere|genial|buenas|buenos dias|buenos días|👍|🙏|👌)[\s!.]*$/i.test(t)) return out;
  var hoy = new Date(TGE_hoy_() + 'T12:00:00'), f = null, m;
  var quitar = function (rx) { t = t.replace(rx, ' '); };
  if ((m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2}|\d{4}))?\b/))) {
    var a = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : hoy.getFullYear();
    f = new Date(a, Number(m[2]) - 1, Number(m[1]), 12);
    if (!m[3] && f > hoy) f.setFullYear(a - 1);
    if (f.getDate() !== Number(m[1])) f = 'mal';
    quitar(m[0]);
  } else if ((m = t.match(new RegExp('\\b(\\d{1,2})\\s+de\\s+(' + TGE_MESES_.join('|') + ')(?:\\s+(?:de|del)?\\s*(\\d{4}))?\\b', 'i')))) {
    var mes = TGE_MESES_.indexOf(m[2].toLowerCase()), anio = m[3] ? Number(m[3]) : hoy.getFullYear();
    f = new Date(anio, mes, Number(m[1]), 12);
    if (!m[3] && f > hoy) f.setFullYear(anio - 1);
    quitar(m[0]);
  } else if (/\b(anteayer|antier)\b/i.test(t)) { f = new Date(hoy.getTime() - 2 * 864e5); quitar(/\b(anteayer|antier)\b/ig); }
  else if (/\bayer\b/i.test(t)) { f = new Date(hoy.getTime() - 864e5); quitar(/\bayer\b/ig); }
  else if (/\bhoy\b/i.test(t)) { f = hoy; quitar(/\bhoy\b/ig); }
  if (f === 'mal' || (f && isNaN(f.getTime()))) { out.error = 'No entendí la fecha.'; return out; }
  if (f && f > hoy) { out.error = 'La fecha ' + Utilities.formatDate(f, 'America/Lima', 'dd-MM-yy') + ' todavía no llega.'; return out; }
  if (f) out.fecha = Utilities.formatDate(f, 'America/Lima', 'yyyy-MM-dd');
  // Palabras de relleno al inicio y al final: "son de", "es de", "entregado por", "del", "fecha"…
  t = t.replace(/^\s*(estos|estas|esos|esas|eso|esto|todos|todo)?\s*(son|es|eran|era)?\s*(los\s+)?(vouchers?\s+)?(de|del|por|entregad[oa]s?\s+por|me\s+(los?\s+)?(dio|dieron|trajo|trajeron|entreg[oó]))\s+/i, ' ');
  t = t.replace(/\s(de|del|el|la|fecha|con\s+fecha|d[ií]a)\s*$/i, ' ').replace(/^\s*(de|del)\s+/i, ' ');
  out.nombre = TGE_limpiarNombre_(t);
  return out;
}

/** Los nombres más usados (los últimos 60 días pesan más). */
function TGE_recientes_(max) {
  var d = {};
  try { d = JSON.parse(PropertiesService.getScriptProperties().getProperty(TGE_PROP_NOMBRES_) || '{}'); } catch (e) {}
  var ahora = Date.now();
  return Object.keys(d).map(function (k) { return { k: k, p: d[k].n * (ahora - d[k].t < 60 * 864e5 ? 3 : 1) + d[k].t / 1e13 }; })
    .sort(function (a, b) { return b.p - a.p; }).slice(0, max || 6).map(function (x) { return x.k; });
}

function TGE_usar_(nombre, ordenante) {
  var p = PropertiesService.getScriptProperties(), d = {};
  try { d = JSON.parse(p.getProperty(TGE_PROP_NOMBRES_) || '{}'); } catch (e) {}
  var actual = Object.keys(d).filter(function (k) { return k.toLowerCase() === nombre.toLowerCase(); })[0];
  if (actual && actual !== nombre) { d[nombre] = d[actual]; delete d[actual]; }
  d[nombre] = { n: ((d[nombre] || {}).n || 0) + 1, t: Date.now() };
  var claves = Object.keys(d).sort(function (a, b) { return d[b].t - d[a].t; });
  claves.slice(80).forEach(function (k) { delete d[k]; });
  p.setProperty(TGE_PROP_NOMBRES_, JSON.stringify(d));
  if (ordenante && TGE_norm_(ordenante)) {
    var apr = {};
    try { apr = JSON.parse(p.getProperty(TGE_PROP_APRENDIDO_) || '{}'); } catch (e) {}
    apr[TGE_norm_(ordenante)] = nombre;
    var ks = Object.keys(apr);
    if (ks.length > 150) ks.slice(0, ks.length - 150).forEach(function (k) { delete apr[k]; });
    p.setProperty(TGE_PROP_APRENDIDO_, JSON.stringify(apr));
  }
}

/**
 * ⭐ Quién paga según el primer voucher (IA) → el nombre que usted le suele poner.
 * adjunto = {base64, mime}. Devuelve {nombre, ordenante} o null.
 */
function TGE_sugerir_(adjunto) {
  if (!adjunto || !adjunto.base64) return null;
  var clave = PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)');
  if (!clave) return null;
  var r;
  try {
    r = IA_llamar_({ proveedor: 'Gemini (Google)', clave: clave, maxTokens: 200,
      sistema: 'Lees constancias de pago bancarias de Perú (Yape, Plin, BCP, Interbank, BBVA, Scotiabank, BN…).',
      texto: 'Devuelve solo JSON {"ordenante": "persona o empresa que PAGA (titular de la cuenta de ORIGEN o quien hace el depósito), tal como aparece; vacío si no figura", ' +
        '"beneficiario": "persona o empresa que RECIBE el dinero (cuenta de destino)"}. ' +
        'En un depósito o transferencia que solo muestra la cuenta de destino, el nombre que aparece es el BENEFICIARIO: deja "ordenante" vacío.',
      adjunto: { base64: adjunto.base64, mime: adjunto.mime } });
  } catch (e) { console.warn('Sugerir nombre: ' + e.message); return null; }
  return TGE_nombreDeOrdenante_(TGE_ordenanteReal_(r && r.ordenante, r && r.beneficiario));
}

/** El que paga, salvo que la IA haya repetido al que recibe (pasa con los tickets de depósito). */
function TGE_ordenanteReal_(ordenante, beneficiario) {
  var o = String(ordenante || '').trim(), b = String(beneficiario || '').trim();
  if (!o || (b && TGE_norm_(o) === TGE_norm_(b))) return '';
  return o;
}

/** "INVERSIONES PETRO SAC" → el nombre que usted le suele poner (aprendido), uno ya usado que coincida, o uno corto. */
function TGE_nombreDeOrdenante_(ord) {
  if (!ord) return null;
  var n = TGE_norm_(ord), apr = {};
  try { apr = JSON.parse(PropertiesService.getScriptProperties().getProperty(TGE_PROP_APRENDIDO_) || '{}'); } catch (e) {}
  if (apr[n]) return { nombre: apr[n], ordenante: ord };
  var pal = n.split(' ').filter(function (w) { return w.length > 2 && !/^(SAC|SRL|EIRL|SAA|SA|DEL|LOS|LAS|CIA|PERU)$/.test(w); });
  var conocido = TGE_recientes_(80).filter(function (x) {
    var nx = TGE_norm_(x);
    return nx && (n.indexOf(nx) >= 0 || pal.some(function (w) { return nx.split(' ').indexOf(w) >= 0; }));
  })[0];
  if (conocido) return { nombre: conocido, ordenante: ord };
  // Nombre corto como lo escribe usted: sin "Inversiones", "Corporación", "Grupo"… (INVERSIONES PETRO SAC → Petro).
  var propias = pal.filter(function (w) { return !/^(INVERSIONES|INVERSION|CORPORACION|CORP|GRUPO|EMPRESA|NEGOCIACIONES|NEGOCIOS|COMPANIA|COMERCIAL|E|Y)$/.test(w); });
  var corto = (propias.length ? propias : pal).slice(0, 2).join(' ').toLowerCase().replace(/(^|\s)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
  return { nombre: TGE_limpiarNombre_(corto || ord).slice(0, 24), ordenante: ord };
}

/**
 * Nombres finales SIN repetir para una tanda: "18-10-26 Edit.jpg", "18-10-26 Edit 2.pdf"…
 * exts = ['.jpg', '.pdf', …] en el orden de los archivos.
 */
function TGE_reservar_(ss, nombre, fechaIso, exts) {
  var base = TGE_corta_(fechaIso) + ' ' + nombre;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var usados = TGE_existentes_(ss, base);
    var cache = CacheService.getScriptCache(), ck = 'tge_r_' + TGE_norm_(base).replace(/ /g, '_').slice(0, 200);
    JSON.parse(cache.get(ck) || '[]').forEach(function (x) { usados[x] = true; });
    var n = 1, out = [];
    exts.forEach(function (ext) {
      var cand;
      do { cand = n === 1 ? base : base + ' ' + n; n++; } while (usados[cand.toLowerCase()]);
      usados[cand.toLowerCase()] = true;
      out.push(cand + String(ext || '').toLowerCase());
    });
    cache.put(ck, JSON.stringify(Object.keys(usados).slice(-400)), 21600);
    return out;
  } finally { lock.releaseLock(); }
}

// Nombres (sin extensión, en minúsculas) que ya empiezan con la base: en la columna "Archivo Original" y en Drive.
function TGE_existentes_(ss, base) {
  var usados = {}, b = base.toLowerCase();
  var anotar = function (nom) {
    var s = String(nom || '').trim().replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase();
    if (s.indexOf(b) === 0) usados[s] = true;
  };
  try {
    var libro = SpreadsheetApp.openById(leerConfig_(ss).idVouchers);
    libro.getSheets().forEach(function (h) {
      if (h.getLastRow() < 2) return;
      var enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
      var c = enc.map(function (x) { return String(x).trim().toLowerCase(); }).indexOf('archivo original');
      if (c < 0) return;
      h.getRange(2, c + 1, h.getLastRow() - 1, 1).getValues().forEach(function (f) { anotar(f[0]); });
    });
  } catch (e) { console.warn('Nombres en la hoja de Vouchers: ' + e.message); }
  try {
    var it = DriveApp.searchFiles('title contains "' + base.replace(/["\\]/g, '') + '" and trashed = false');
    for (var i = 0; it.hasNext() && i < 500; i++) anotar(it.next().getName());
  } catch (e) { console.warn('Nombres en Drive: ' + e.message); }
  return usados;
}

function TGE_ext_(nombre, mime) {
  var m = String(nombre || '').match(/\.[a-z0-9]{2,5}$/i);
  if (m) return m[0];
  return /pdf/i.test(mime || '') ? '.pdf' : /png/i.test(mime || '') ? '.png' : '.jpg';
}

/* ============================================================ WhatsApp (TGW_doPost_ accion=entrega) */

/**
 * q.modo = 'sugerir'  {adjunto}                            → {ok, sugerido, nombres}
 * q.modo = 'nombres'  {nombre | texto | audio, fecha?, exts, ordenante?}
 *                     → {ok, entendido, nombre, fecha, corta, nombres, dicho, error}
 *                       (sin exts solo interpreta: para "de Edit" escrito antes de reenviar)
 */
function TGE_wa_(q) {
  if (q.modo === 'sugerir') {
    var s = null;
    try { s = TGE_sugerir_(q.adjunto); } catch (e) {}
    return { ok: true, sugerido: s, nombres: TGE_recientes_(8) };
  }
  var dicho = '', it;
  if (q.nombre) it = { nombre: TGE_limpiarNombre_(q.nombre), fecha: q.fecha || TGE_hoy_(), error: '' };
  else {
    var texto = q.texto || '';
    if (q.audio && q.audio.base64) {
      try { dicho = texto = TG_transcribir_(TG_ss_(), Utilities.newBlob(Utilities.base64Decode(q.audio.base64), q.audio.mime || 'audio/ogg', 'voz.ogg')); }
      catch (e) { return { ok: false, error: 'No pude entender el audio: ' + e.message }; }
    }
    it = TGE_interpretar_(texto);
    if (q.fecha && !/\d/.test(texto)) it.fecha = q.fecha;
  }
  if (it.error) return { ok: true, entendido: false, error: it.error, dicho: dicho };
  if (!it.nombre) return { ok: true, entendido: false, dicho: dicho };
  var out = { ok: true, entendido: true, nombre: it.nombre, fecha: it.fecha, corta: TGE_corta_(it.fecha), dicho: dicho, nombres: [] };
  if ((q.exts || []).length) {
    out.nombres = TGE_reservar_(TG_ss_(), it.nombre, it.fecha, q.exts);
    TGE_usar_(it.nombre, q.ordenante || '');
  }
  return out;
}

/* ============================================================ Telegram (📥 Registrar como voucher) */

function TGE_preguntarTG_(ctx, adjs) {
  TG_accion_(ctx.chatId, 'typing');
  var sug = null;
  try {
    var f = DriveApp.getFileById(adjs[0].id);
    if (f.getSize() < 4 * 1024 * 1024) sug = TGE_sugerir_({ base64: Utilities.base64Encode(f.getBlob().getBytes()), mime: f.getMimeType() });
  } catch (e) {}
  var nombres = TGE_recientes_(6).filter(function (n) { return !sug || n.toLowerCase() !== sug.nombre.toLowerCase(); }).slice(0, sug ? 5 : 6);
  var datos = { t: 'entrega', adjs: adjs, nombres: (sug ? [sug.nombre] : []).concat(nombres), ordenante: sug ? sug.ordenante : '', sug: !!sug, fecha: TGE_hoy_() };
  var k = TG_guardarBoton_(datos);
  var ses = TG_sesion_(ctx.chatId); ses.esperando = { tipo: 'entrega', k: k }; TG_guardarSesion_(ctx.chatId, ses);
  var msg = TG_enviar_(ctx.chatId, TGE_textoPregunta_(datos), TGE_tecladoTG_(k, datos));
  PropertiesService.getScriptProperties().setProperty(TGE_PROP_PEND_ + k, JSON.stringify({ chatId: ctx.chatId, t: Date.now(), msg: msg }));
}

function TGE_textoPregunta_(d) {
  return '🏷 <b>¿De quién son ' + (d.adjs.length > 1 ? 'estos ' + d.adjs.length + ' vouchers' : 'este voucher') + '?</b>\n' +
    'Quedarán como <code>' + TG_esc_(TGE_corta_(d.fecha)) + ' Nombre</code>' + (d.adjs.length > 1 ? ', <code>… Nombre 2</code>…' : '') + '\n' +
    (d.sug ? '⭐ Según el voucher paga: <i>' + TG_esc_(d.ordenante) + '</i>\n' : '') +
    'Toque un nombre o escríbalo (o dígalo 🎤). Si es de otro día: <i>Edit 15/10</i> o <i>Edit ayer</i>.';
}

function TGE_tecladoTG_(k, d) {
  var filas = [], fila = [];
  d.nombres.forEach(function (n, i) {
    fila.push({ text: (i === 0 && d.sug ? '⭐ ' : '') + n, callback_data: 'k:' + k + ':n' + i });
    if (fila.length === 2) { filas.push(fila); fila = []; }
  });
  if (fila.length) filas.push(fila);
  var hoy = TGE_hoy_(), ayer = Utilities.formatDate(new Date(Date.now() - 864e5), 'America/Lima', 'yyyy-MM-dd');
  filas.push([{ text: (d.fecha === hoy ? '✔ ' : '') + 'Hoy', callback_data: 'k:' + k + ':fh' },
              { text: (d.fecha === ayer ? '✔ ' : '') + 'Ayer', callback_data: 'k:' + k + ':fa' },
              { text: (d.fecha !== hoy && d.fecha !== ayer ? '✔ ' + TGE_corta_(d.fecha) : '📅 Otra fecha'), callback_data: 'k:' + k + ':fo' }]);
  filas.push([{ text: '➖ Sin nombre (como antes)', callback_data: 'k:' + k + ':sin' }]);
  return filas;
}

function TGE_alBotonTG_(ctx, datos, op, k) {
  if (op === 'fh' || op === 'fa') {
    datos.fecha = op === 'fh' ? TGE_hoy_() : Utilities.formatDate(new Date(Date.now() - 864e5), 'America/Lima', 'yyyy-MM-dd');
    CacheService.getScriptCache().put('tg_b_' + k, JSON.stringify(datos), 21600);
    return TG_editar_(ctx.chatId, ctx.msgId, TGE_textoPregunta_(datos), TGE_tecladoTG_(k, datos));
  }
  if (op === 'fo') {
    return TG_enviar_(ctx.chatId, '📅 Escriba el nombre y la fecha, por ejemplo <i>Edit 15/10</i> o <i>Edit 15/10/26</i>.');
  }
  if (op === 'sin') return TGE_cerrarTG_(ctx, k, datos, null);
  var i = Number(String(op).slice(1));
  if (datos.nombres[i]) return TGE_cerrarTG_(ctx, k, datos, { nombre: datos.nombres[i], fecha: datos.fecha });
}

/** Texto o 🎤 voz mientras se esperaba el nombre. */
function TGE_alTextoTG_(ctx, e, texto) {
  var datos = TG_leerBoton_(e.k);
  if (!datos) return TG_preguntar_(ctx, texto, []);
  var it = TGE_interpretar_(texto);
  if (!/\d|ayer|antier|hoy/i.test(texto)) it.fecha = datos.fecha;
  var volver = function () { var s = TG_sesion_(ctx.chatId); s.esperando = e; TG_guardarSesion_(ctx.chatId, s); };
  if (it.error) { volver(); return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(it.error) + ' Escríbalo así: <i>Edit 15/10</i>.'); }
  if (!it.nombre) { volver(); return TG_preguntar_(ctx, texto, []); }   // era una pregunta: se contesta y se sigue esperando el nombre
  return TGE_cerrarTG_({ ss: ctx.ss, chatId: ctx.chatId }, e.k, datos, it);
}

function TGE_cerrarTG_(ctx, k, datos, it) {
  var props = PropertiesService.getScriptProperties(), pend = props.getProperty(TGE_PROP_PEND_ + k);
  if (!pend) return;   // ya se registraron (doble toque o la vigía llegó antes)
  props.deleteProperty(TGE_PROP_PEND_ + k);
  var msgId = JSON.parse(pend).msg || ctx.msgId;
  var ses = TG_sesion_(ctx.chatId);
  if (ses.esperando && ses.esperando.tipo === 'entrega') { ses.esperando = null; TG_guardarSesion_(ctx.chatId, ses); }
  var adjs = datos.adjs.slice();
  if (it && it.nombre) {
    var nombres = TGE_reservar_(ctx.ss, it.nombre, it.fecha, adjs.map(function (a) { return TGE_ext_(a.nombre, a.mime); }));
    adjs = adjs.map(function (a, i) { return { id: a.id, nombre: nombres[i], mime: a.mime, foto: a.foto }; });
    TGE_usar_(it.nombre, datos.ordenante && datos.nombres[0] === it.nombre ? datos.ordenante : '');
    if (msgId) TG_editar_(ctx.chatId, msgId, '🏷 <b>' + TG_esc_(TGE_corta_(it.fecha) + ' ' + it.nombre) + '</b> · ' + adjs.length + ' archivo(s)');
  } else if (msgId) TG_editar_(ctx.chatId, msgId, '➖ Sin nombre: quedan con el nombre de siempre.');
  return TG_registrarVouchers_(ctx, adjs);
}

/** Vigía: si nadie contestó en 20 min, se registran sin nombre (como antes). */
function TGE_vencidosTG_(ss) {
  var props = PropertiesService.getScriptProperties(), todo = props.getProperties();
  Object.keys(todo).filter(function (k) { return k.indexOf(TGE_PROP_PEND_) === 0; }).forEach(function (pk) {
    var x = {};
    try { x = JSON.parse(todo[pk]); } catch (e) {}
    if (Date.now() - (x.t || 0) < TGE_ESPERA_MIN_ * 60000) return;
    var k = pk.slice(TGE_PROP_PEND_.length), datos = TG_leerBoton_(k);
    if (!datos) { props.deleteProperty(pk); return; }
    TG_enviar_(x.chatId, '⌛ Nadie me dijo de quién eran: los registro con el nombre de siempre.');
    TGE_cerrarTG_({ ss: ss, chatId: x.chatId }, k, datos, null);
  });
}
