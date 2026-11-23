/**
 * 🟩 NVIDIA desde Telegram: guardar la clave y probar los modelos gratis de hoy (ConciliacionIA.js → CIA_nvProbar).
 *   /nvidia            → si ya hay clave: prueba los modelos y deja elegir; si no: explica cómo mandarla.
 *   «nvapi-…» (mensaje) → solo un ADMINISTRADOR y en chat privado: el bot BORRA el mensaje al instante, guarda la clave
 *                         oculta (propiedades del script, la misma del 🧠 Asistente IA) y prueba los modelos.
 * La clave nunca se repite en ningún mensaje ni registro. Funciones TGNV_.
 */

var TGNV_RX_ = /^\s*nvapi-[A-Za-z0-9_\-]{20,}\s*$/;

/** Si el texto es una clave de NVIDIA, la atiende (y devuelve true). Va ANTES que la IA: la clave nunca se le manda a nadie. */
function TGNV_tg_(ctx, texto) {
  if (!TGNV_RX_.test(texto)) return false;
  try { TG_llamar_('deleteMessage', { chat_id: ctx.chatId, message_id: ctx.msgId }); } catch (e) {}
  if (ctx.grupo) { TG_enviar_(ctx.chatId, '🔒 Borré ese mensaje: las claves solo se mandan por chat privado con el bot.'); return true; }
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') { TG_enviar_(ctx.chatId, '🔒 Borré ese mensaje: solo un administrador puede guardar claves de IA.'); return true; }
  var k = String(texto).trim(), p = PropertiesService.getScriptProperties();
  p.setProperty('CIA_KEY_NVIDIA', k);
  p.setProperty('IA_KEY_NVIDIA', k);
  TG_enviar_(ctx.chatId, '🔑 <b>Clave de NVIDIA guardada</b> (borré su mensaje; no queda en el chat). Pruebo los modelos gratis de hoy…');
  TGNV_probar_(ctx);
  return true;
}

function TGNV_comando_(ctx) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('CIA_KEY_NVIDIA') && !p.getProperty('IA_KEY_NVIDIA'))
    return TG_enviar_(ctx.chatId, '🟩 <b>NVIDIA</b>: mande aquí su clave (empieza con <code>nvapi-</code>) como un mensaje solo. La borro al instante, la guardo oculta y pruebo qué modelos gratis responden hoy.');
  TG_accion_(ctx.chatId, 'typing');
  TGNV_probar_(ctx);
}

/**
 * La prueba corre en SEGUNDO PLANO y POR TANDAS (3 modelos por ejecución): si un modelo de NVIDIA no contesta, Google corta esa
 * ejecución sin aviso; por eso antes de cada tanda queda programada la siguiente (vigía): si la tanda murió, esos modelos se
 * anotan «no respondió a tiempo» y se sigue con el resto. Al terminar llega la tabla.
 */
function TGNV_probar_(ctx) {
  var c;
  try { c = CIA_nvCandidatos_(); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ NVIDIA: ' + TG_esc_(e.message)); }
  if (!c.cand.length) return TG_enviar_(ctx.chatId, '⚠️ Su clave ve ' + c.total + ' modelos pero ninguno de los que interesan (DeepSeek, Kimi, GLM, Nemotron, Mistral…).');
  PropertiesService.getScriptProperties().setProperty('TGNV_EST', JSON.stringify({ chat: String(ctx.chatId), total: c.total, cand: c.cand, i: 0, res: [], enCurso: null, t0: Date.now() }));
  TGNV_programar_(3000);
  TG_enviar_(ctx.chatId, '⏳ Probando ' + c.cand.length + ' modelos gratis de NVIDIA (de ' + c.total + ' que ve su clave), de a 3, en segundo plano. Le aviso aquí en unos minutos.');
}

function TGNV_programar_(ms) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_paso') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('TGNV_paso').timeBased().after(ms).create();
}

/** Disparador: una tanda por ejecución. */
function TGNV_paso() {
  var p = PropertiesService.getScriptProperties(), est;
  try { est = JSON.parse(p.getProperty('TGNV_EST') || 'null'); } catch (e) { est = null; }
  if (!est) return;
  if (est.enCurso) {   // la ejecución anterior murió esperando a esos modelos
    est.enCurso.forEach(function (id) { est.res.push({ id: id, ok: false, s: 0, nota: CIA_nvNota_(id), error: 'no respondió a tiempo (muy lento o saturado)' }); });
    est.i += est.enCurso.length; est.enCurso = null;
  }
  if (est.i >= est.cand.length || Date.now() - est.t0 > 30 * 60000) {
    p.deleteProperty('TGNV_EST');
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_paso') ScriptApp.deleteTrigger(t); });
    return TGNV_mostrar_({ chatId: est.chat }, est);
  }
  var lote = est.cand.slice(est.i, est.i + 3);
  est.enCurso = lote;
  p.setProperty('TGNV_EST', JSON.stringify(est));
  TGNV_programar_(7 * 60000);   // vigía: si esta ejecución muere, la próxima sigue
  var res;
  try { res = CIA_nvProbarLote_(CIA_nvClave_(), lote); }
  catch (e) { res = lote.map(function (id) { return { id: id, ok: false, s: 0, nota: CIA_nvNota_(id), error: String(e.message || e).slice(0, 80) }; }); }
  est.res = est.res.concat(res); est.i += lote.length; est.enCurso = null;
  p.setProperty('TGNV_EST', JSON.stringify(est));
  TGNV_programar_(2000);
}

function TGNV_mostrar_(ctx, est) {
  var res = est.res.slice().sort(function (a, b) { return (b.ok - a.ok) || a.s - b.s; });
  var r = { total: est.total, probados: res, elegido: PropertiesService.getScriptProperties().getProperty('IA_NVIDIA_MODELO') || '', segundos: Math.round((Date.now() - est.t0) / 1000) };
  var ok = r.probados.filter(function (m) { return m.ok; }), no = r.probados.filter(function (m) { return !m.ok; });
  var html = '🟩 <b>Modelos gratis de NVIDIA hoy</b> (su clave ve ' + r.total + '; probé ' + r.probados.length + ' en ' + r.segundos + ' s)\n' +
    (r.elegido ? 'Elegido ahora: <code>' + TG_esc_(r.elegido) + '</code>\n' : '') + '\n' +
    (ok.length ? ok.map(function (m) { return '✅ <code>' + TG_esc_(m.id) + '</code> · ' + m.s + ' s' + (m.nota ? '\n   <i>' + TG_esc_(m.nota) + '</i>' : ''); }).join('\n') : '❌ Ninguno respondió.') +
    (no.length ? '\n\n<i>No responden: ' + TG_esc_(no.map(function (m) { return m.id.split('/').pop() + ' (' + m.error + ')'; }).join(' · ').slice(0, 600)) + '</i>' : '') +
    (ok.length ? '\n\nToque uno para usarlo en el 🧠 Asistente IA:' : '');
  var teclado = ok.slice(0, 8).map(function (m) {
    return [{ text: '▶ Usar ' + m.id.split('/').pop().slice(0, 40), callback_data: 'k:' + TG_guardarBoton_({ t: 'nvusar', id: m.id }, 86400) }];
  });
  TG_enviar_(ctx.chatId, html, teclado.length ? teclado : null);
}

function TGNV_alBoton_(ctx, datos) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  try { CIA_nvElegir(datos.id); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
  TG_enviar_(ctx.chatId, '✅ El 🧠 Asistente IA usará <code>' + TG_esc_(datos.id) + '</code> (fila 11: «NVIDIA · modelo elegido»).');
}

/* ============================================================ 🧾 voucher con «nvidia»: Gemini vs NVIDIA */

var TGNV_LECTORES_ = [
  { nom: 'Gemini', prov: 'Gemini (Google)' },
  { nom: 'Kimi K3.1 Pro', prov: 'NVIDIA · Kimi K3.1 Pro', nvidia: true },
  { nom: 'Nemotron Super VL', prov: 'NVIDIA · Nemotron 3.5 Super VL (lee imágenes)', nvidia: true },
];
var TGNV_CAMPOS_ = [['banco', 'Banco'], ['fecha', 'Fecha'], ['operacion', 'N° operación'], ['moneda', 'Moneda'], ['monto', 'Monto'],
  ['ordenante', 'Quién paga'], ['beneficiario', 'Beneficiario'], ['ruc_beneficiario', 'RUC beneficiario'], ['cuenta_destino', 'Cuenta destino']];
var TGNV_SISTEMA_ = 'Eres un lector de comprobantes bancarios de Perú (vouchers de depósito o transferencia: BCP, BBVA, Interbank, Scotiabank, BN, cajas). ' +
  'Lee la imagen y responde SOLO un JSON con: banco, fecha (dd/mm/aaaa), operacion (número de operación tal cual), moneda (PEN o USD), ' +
  'monto (número con punto decimal, sin separador de miles), ordenante (quién paga), beneficiario (a quién se paga), ruc_beneficiario (11 dígitos si aparece), ' +
  'cuenta_destino (si aparece). Si un dato no está, pon "". No inventes nada.';

/** Foto (o PDF) con «nvidia» en el texto: se lee con Gemini y con los modelos de NVIDIA que leen imágenes, en segundo plano. No escribe en ninguna hoja. */
function TGNV_voucher_(ctx, blob, mime) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'La comparación con NVIDIA es solo para administradores.');
  if (!CIA_nvClave_()) return TG_enviar_(ctx.chatId, '🟩 Primero mande su clave de NVIDIA (nvapi-…) en un mensaje solo.');
  var f = IMP_carpeta_(ctx.ss).createFile(blob.setName('nvidia prueba ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmmss')));
  var esPdf = /pdf/i.test(mime);
  PropertiesService.getScriptProperties().setProperty('TGNV_VCH', JSON.stringify({ chat: String(ctx.chatId), id: f.getId(), mime: mime, i: 0, res: [], enCurso: null, t0: Date.now(), pdf: esPdf }));
  TGNV_programarV_(2000);
  TG_enviar_(ctx.chatId, '🧪 Leyendo el voucher con <b>Gemini</b>' + (esPdf ? '' : ', <b>Kimi K3.1 Pro</b> y <b>Nemotron Super VL</b>') + ' en segundo plano (1 a 5 minutos). No se guarda nada en la hoja.' +
    (esPdf ? '\n<i>Es un PDF: NVIDIA solo lee imágenes; para compararlo mande una foto o captura del voucher.</i>' : ''));
}

function TGNV_programarV_(ms) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_leerPaso') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('TGNV_leerPaso').timeBased().after(ms).create();
}

/** Disparador: un lector por ejecución (con vigía: si uno se cuelga, se anota y sigue). */
function TGNV_leerPaso() {
  var p = PropertiesService.getScriptProperties(), est;
  try { est = JSON.parse(p.getProperty('TGNV_VCH') || 'null'); } catch (e) { est = null; }
  if (!est) return;
  var lectores = est.pdf ? TGNV_LECTORES_.slice(0, 1) : TGNV_LECTORES_;
  if (est.enCurso != null) { est.res.push({ nom: lectores[est.enCurso].nom, error: 'no respondió a tiempo' }); est.i++; est.enCurso = null; }
  if (est.i >= lectores.length || Date.now() - est.t0 > 30 * 60000) {
    p.deleteProperty('TGNV_VCH');
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_leerPaso') ScriptApp.deleteTrigger(t); });
    try { DriveApp.getFileById(est.id).setTrashed(true); } catch (e) {}
    return TGNV_compararMostrar_(est);
  }
  var L = lectores[est.i];
  est.enCurso = est.i;
  p.setProperty('TGNV_VCH', JSON.stringify(est));
  TGNV_programarV_(7 * 60000);   // vigía
  var t1 = Date.now(), r;
  try {
    var blob = DriveApp.getFileById(est.id).getBlob();
    var clave = L.nvidia ? CIA_nvClave_() : (p.getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)'));
    var d = IA_llamar_({ proveedor: L.prov, clave: clave, sistema: TGNV_SISTEMA_, texto: 'Lee este voucher.', maxTokens: 800,
      adjunto: { base64: Utilities.base64Encode(blob.getBytes()), mime: est.mime } });
    r = { nom: L.nom, s: Math.round((Date.now() - t1) / 100) / 10, d: d || {} };
  } catch (e) { r = { nom: L.nom, s: Math.round((Date.now() - t1) / 100) / 10, error: String(e.message || e).slice(0, 120) }; }
  est.res.push(r); est.i++; est.enCurso = null;
  p.setProperty('TGNV_VCH', JSON.stringify(est));
  TGNV_programarV_(2000);
}

function TGNV_norm_(c, v) {
  var t = String(v == null ? '' : v).trim().toUpperCase();
  if (c === 'monto') { var n = parseFloat(t.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')); return isNaN(n) ? '' : n.toFixed(2); }
  if (c === 'operacion' || c === 'ruc_beneficiario' || c === 'cuenta_destino') return t.replace(/[^0-9A-Z]/g, '').replace(/^0+/, '');
  if (c === 'fecha') { var m = t.match(/(\d{1,2})\D(\d{1,2})\D(\d{2,4})/); return m ? ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]) : t; }
  return t.replace(/\s+/g, ' ');
}

function TGNV_compararMostrar_(est) {
  var res = est.res, base = res.filter(function (x) { return x.nom === 'Gemini' && x.d; })[0];
  var lineas = ['🧪 <b>Lectura del voucher: Gemini vs NVIDIA</b>', ''];
  res.forEach(function (x) { lineas.push((x.error ? '❌ ' : '✅ ') + '<b>' + TG_esc_(x.nom) + '</b>' + (x.s != null ? ' · ' + x.s + ' s' : '') + (x.error ? ' — ' + TG_esc_(x.error) : '')); });
  lineas.push('');
  TGNV_CAMPOS_.forEach(function (c) {
    var vals = res.filter(function (x) { return x.d; }).map(function (x) { return { nom: x.nom, v: String(x.d[c[0]] == null ? '' : x.d[c[0]]).trim() }; });
    if (!vals.some(function (v) { return v.v; })) return;
    var ref = base ? TGNV_norm_(c[0], base.d[c[0]]) : null;
    lineas.push('<b>' + c[1] + '</b>');
    vals.forEach(function (v) {
      var marca = v.nom === 'Gemini' || ref == null ? '•' : (TGNV_norm_(c[0], v.v) === ref ? '✅' : '⚠️');
      lineas.push('  ' + marca + ' ' + TG_esc_(v.nom) + ': ' + (v.v ? '<code>' + TG_esc_(v.v.slice(0, 60)) + '</code>' : '—'));
    });
  });
  lineas.push('', '<i>✅ = igual a Gemini · ⚠️ = distinto (revise la foto: Gemini también puede equivocarse). No se guardó nada.</i>');
  TG_enviar_(est.chat, lineas.join('\n'));
}
