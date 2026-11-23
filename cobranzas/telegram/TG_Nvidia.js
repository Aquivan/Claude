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
