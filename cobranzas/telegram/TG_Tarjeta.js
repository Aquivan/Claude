/**
 * 🪪 TARJETAS: un mensaje con los botones ADENTRO (Bot API 10.3: mensajes enriquecidos con <tg-button>) que se
 * transforma en el mismo lugar en cada paso (menú → submenú → panel → «← Atrás»), como los flujos nuevos de Telegram.
 *
 * TG_tarjeta_(ctx, html, filas, opc)
 *   html  = el texto de siempre (HTML de Telegram: <b>, <i>, <code>, saltos de línea).
 *   filas = el teclado de siempre: [[{text, callback_data | url | web_app, style}]]. style: success (verde), danger (rojo),
 *           primary (azul) o link (como enlace, solo botones de acción). Si no trae, se colorea solo (TG_colorear_).
 *   opc.nuevo = true: siempre un mensaje nuevo (si no, al tocar un botón se cambia ESE mismo mensaje).
 * Si Telegram no acepta el mensaje enriquecido (app vieja, algún dato raro), sale como siempre: texto + botones debajo.
 * Se apaga sin tocar código con la propiedad TG_TARJETAS = 'no' (vuelve todo al formato anterior).
 */

function TG_tarjetasActivas_() {
  try { return PropertiesService.getScriptProperties().getProperty('TG_TARJETAS') !== 'no'; } catch (e) { return true; }
}

function TG_tarjeta_(ctx, html, filas, opc) {
  opc = opc || {};
  filas = (filas || []).filter(function (f) { return f && f.length; });
  var editar = !opc.nuevo && ctx.esBoton && ctx.msgId && !ctx.efimeroMsg;
  if (TG_tarjetasActivas_()) {
    var rico = { html: TG_tarjetaHtml_(ctx, html, filas), skip_entity_detection: true };
    var r = editar ? TG_llamar_('editMessageText', { chat_id: ctx.chatId, message_id: ctx.msgId, rich_message: rico })
      : TG_llamar_('sendRichMessage', { chat_id: ctx.chatId, rich_message: rico });
    if (r && (r.ok || /not modified/i.test(r.description || ''))) return editar ? ctx.msgId : r.result.message_id;
    console.warn('Tarjeta: Telegram no aceptó el mensaje enriquecido (' + (r && r.description) + '); va con botones debajo.');
  }
  var teclado = TG_tarjetaTeclado_(filas);
  if (editar && TG_editar_(ctx.chatId, ctx.msgId, html, teclado)) return ctx.msgId;
  return TG_enviar_(ctx.chatId, html, teclado);
}

/** El teclado de siempre, sin el estilo «link» (solo existe dentro de los mensajes enriquecidos). */
function TG_tarjetaTeclado_(filas) {
  return filas.map(function (f) {
    return f.map(function (b) { var c = {}; Object.keys(b).forEach(function (k) { if (!(k === 'style' && b[k] === 'link')) c[k] = b[k]; }); return c; });
  });
}

/** Texto + botones → HTML de mensaje enriquecido: párrafos <p> y una fila <tg-button-row> por cada fila de botones. */
function TG_tarjetaHtml_(ctx, html, filas) {
  var cuerpo = String(html || '').trim().split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  var color = TG_colorear_({ inline_keyboard: JSON.parse(JSON.stringify(filas)) }).inline_keyboard;
  var privado = /^\d+$/.test(String(ctx.chatId || ''));
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var botones = color.map(function (f) {
    return '<tg-button-row>' + f.slice(0, 8).map(function (b) {
      var st = b.style ? ' style="' + b.style + '"' : '';
      if (b.callback_data) return '<tg-button type="callback_data"' + st + ' data="' + esc(b.callback_data) + '">' + esc(b.text) + '</tg-button>';
      if (b.web_app && privado) return '<tg-button type="web_app"' + (b.style && b.style !== 'link' ? st : '') + ' url="' + esc(b.web_app.url) + '">' + esc(b.text) + '</tg-button>';
      var url = b.url || (b.web_app && b.web_app.url);
      if (url) return '<tg-button type="url"' + (b.style && b.style !== 'link' ? st : '') + ' url="' + esc(url) + '">' + esc(b.text) + '</tg-button>';
      return '<tg-button type="disabled">' + esc(b.text) + '</tg-button>';
    }).join('') + '</tg-button-row>';
  }).join('');
  return cuerpo + botones;
}

/** Botón de acción para una tarjeta (guardado 6 h, como los demás). */
function TG_bot_(texto, datos, estilo) {
  var b = { text: texto, callback_data: typeof datos === 'string' ? datos : 'k:' + TG_guardarBoton_(datos, 21600) };
  if (estilo) b.style = estilo;
  return b;
}

/* ------------------------------------------------ 📋 Menú por secciones (todo en el mismo mensaje) */

var TG_MENU_SECC_ = {
  cob: { t: '💰 Cobranzas', d: 'Lo que le deben, lo que debe y lo vencido.' },
  sunat: { t: '🏛 SUNAT', d: 'Buzón, detracciones, retenciones, honorarios y descargas.' },
  ia: { t: '🤖 IA y lectores', d: 'Qué IA lee los vouchers y hace cada tarea, y prueba de modelos.', admin: true },
  avisos: { t: '🔔 Avisos y recordatorios', d: 'Lo que el bot le avisa solo y sus recordatorios.' }
};

function TG_menuTarjeta_(ctx, secc) {
  var admin = ctx.usuario && ctx.usuario.rol === 'admin', menu = TG_bot_('📋 Menú', 'm:', 'link');
  var s = TG_MENU_SECC_[secc];
  if (!s || (s.admin && !admin)) {
    var bp = TG_botonPortal_(ctx.chatId), filas = bp ? [[bp]] : [];
    filas.push([TG_bot_('📊 Resumen de hoy', 'mc:resumen', 'primary'), TG_bot_('📌 Tablero fijo', 'mc:tablero')]);
    var secs = Object.keys(TG_MENU_SECC_).filter(function (k) { return admin || !TG_MENU_SECC_[k].admin; })
      .map(function (k) { return TG_bot_(TG_MENU_SECC_[k].t + ' ›', 'm:' + k); });
    for (var i = 0; i < secs.length; i += 2) filas.push(secs.slice(i, i + 2));
    filas.push([TG_bot_('❓ Ayuda', 'mc:ayuda'), TG_bot_('✖ Cerrar', 'm:x', 'link')]);
    var L = [TG_textoMenu_(), ''].concat(Object.keys(TG_MENU_SECC_).filter(function (k) { return admin || !TG_MENU_SECC_[k].admin; })
      .map(function (k) { return '<b>' + TG_MENU_SECC_[k].t + '</b> · ' + TG_MENU_SECC_[k].d; }));
    return TG_tarjeta_(ctx, L.join('\n'), filas);
  }
  var f = {
    cob: [[TG_bot_('💰 Por cobrar', 'mc:cobrar'), TG_bot_('💸 Por pagar', 'mc:pagar')], [TG_bot_('⏰ Vencidas', 'mc:vencidas'), TG_bot_('💱 Tipo de cambio', 'mc:tc')],
      [TG_bot_('🔄 Recalcular cobranzas', 'mc:actualizar', 'primary')]],
    sunat: [[TG_bot_('📬 Buzón SUNAT', 'mc:notificaciones'), TG_bot_('🏦 Detracciones', 'mc:detracciones')], [TG_bot_('🧾 Retenciones', 'mc:retenciones'), TG_bot_('🧑‍💼 Honorarios', 'mc:honorarios')],
      [TG_bot_('⚙️ Estado descargas', 'mc:estado'), TG_bot_('⬇ Descargar de SUNAT', 'mc:descargar', 'primary')]],
    ia: [[TG_bot_('🧾 Lectores de vouchers', 'm:lect')], [TG_bot_('🤖 IA de cada tarea', 'm:iat')], [TG_bot_('🔭 Probar modelos (vigía)', 'm:vig')]],
    avisos: [[TG_bot_('⏰ Recordatorios', 'mc:recordatorios'), TG_bot_('🔔 Mis avisos', 'mc:avisos')]]
  }[secc];
  return TG_tarjeta_(ctx, '📋 <b>Menú › ' + s.t + '</b>\n' + s.d + '\n\n<i>Toque una opción: la respuesta llega en un mensaje aparte y este menú queda aquí.</i>',
    f.concat([[TG_bot_('← Atrás', 'm:', 'link')]]));
}

/** Botones «m:…» (navegación del menú y de los paneles de IA). Los «mc:…» del menú ejecutan el comando en un mensaje
 *  APARTE (TG_Bot.js les quita msgId), para que el menú quede en su lugar y se pueda seguir eligiendo. */
function TG_menuBoton_(ctx, d) {
  if (d === 'x') return TG_tarjeta_(ctx, '📋 Menú cerrado. Escriba /menu cuando lo necesite.', []);
  var admin = ctx.usuario && ctx.usuario.rol === 'admin';
  if (d === 'lect' && admin) return LECT_panel_(ctx, '', true);
  if (d === 'iat' && admin) return IAT_panel_(ctx, '', true);
  if (d === 'vig' && admin) return VIG_panel_(ctx);
  return TG_menuTarjeta_(ctx, d);
}
