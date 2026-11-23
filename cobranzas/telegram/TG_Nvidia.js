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
 * La prueba corre en SEGUNDO PLANO (un disparador en unos segundos): algunos modelos gigantes tardan y el bot no puede
 * quedarse esperando (Telegram reintenta y Google corta). Al terminar llega el resultado.
 */
function TGNV_probar_(ctx) {
  PropertiesService.getScriptProperties().setProperty('TGNV_PEND', String(ctx.chatId));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_correr') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('TGNV_correr').timeBased().after(5000).create();
  TG_enviar_(ctx.chatId, '⏳ Probando los modelos gratis de NVIDIA en segundo plano. Le aviso aquí en 1 a 4 minutos (puede seguir usando el bot).');
}

/** Disparador: hace la prueba y manda el resultado al chat que la pidió. */
function TGNV_correr() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_correr') ScriptApp.deleteTrigger(t); });
  var p = PropertiesService.getScriptProperties(), chatId = p.getProperty('TGNV_PEND');
  if (!chatId) return;
  p.deleteProperty('TGNV_PEND');
  TGNV_mostrar_({ chatId: chatId });
}

function TGNV_mostrar_(ctx) {
  var r;
  try { r = CIA_nvProbar(270000); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ NVIDIA: ' + TG_esc_(e.message)); }
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
