/**
 * 📊 Tablero fijo en el chat (Bot API 10.4: widgets HTML, solo en chat privado).
 *
 * /tablero manda una tarjeta que el bot ACTUALIZA SOLA (cada hora, con el vigía): lo que vence en los próximos 7 días
 * (IGV-Renta, PLAME, SIRE de cada empresa). El widget no tiene red: muestra lo que el bot le pone en «chat_data»
 * (JSON de hasta 1024 bytes) con editMessageWidgetData. Si Telegram no acepta el widget, se manda el mismo tablero
 * como mensaje enriquecido.
 */

var TGT_PROP_ = 'TGT_TAB_';   // + chatId → message_id del tablero

var TGT_HTML_ = '<style>body{margin:0;font:13px system-ui,sans-serif;color:var(--tg-theme-text-color)}' +
  'h4{margin:8px 10px 4px}.r{display:flex;justify-content:space-between;gap:8px;padding:5px 10px;border-top:1px solid rgba(127,127,127,.25)}' +
  '.k{font-weight:600;white-space:nowrap}.s{color:var(--tg-theme-hint-color);font-size:11px;padding:5px 10px}</style>' +
  '<h4>📊 Tablero · vence en 7 días</h4><div id="l"></div><div class="s" id="t"></div>' +
  '<script>var W=window.TelegramWidget;function fila(a,b){var r=document.createElement("div");r.className="r";var x=document.createElement("span");x.textContent=a;' +
  'var y=document.createElement("span");y.className="k";y.textContent=b;r.appendChild(x);r.appendChild(y);return r}' +
  'function p(){var d={};try{d=JSON.parse(W&&W.chatData||"{}")||{}}catch(e){}var l=document.getElementById("l");l.innerHTML="";' +
  '(d.v||[]).forEach(function(x){l.appendChild(fila(x[0],x[1]))});if(!(d.v||[]).length)l.appendChild(fila(d.t?"✅ Nada por vencer":"Cargando…",""));' +
  'if(d.m)l.appendChild(fila("… y "+d.m+" más",""));document.getElementById("t").textContent=d.t?"Actualizado "+d.t:""}' +
  'if(W){W.onEvent("chatDataChanged",p);if(W.ready)W.ready()}p();</script>';

/** Los datos del tablero (≤ 1024 bytes). */
function TGT_datos_(ss) {
  var lista = [];
  try { lista = TGV_lista_(ss, null).filter(function (x) { return !x.sinCronograma && !x.presentado && x.faltan <= 7 && x.faltan >= -5; }); } catch (e) { lista = []; }
  var v = lista.map(function (x) {
    var cuando = x.faltan < 0 ? '🔴 venció ' + (-x.faltan) + 'd' : x.faltan === 0 ? '🟠 HOY' : x.faltan === 1 ? '🟠 mañana' : (x.faltan <= 2 ? '🟠 ' : '🟡 ') + x.faltan + ' días';
    return [String(x.nombre).slice(0, 18) + ' · ' + TGV_OBLIG_[x.ob].corto, cuando];
  });
  var d = { v: [], t: Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') };
  for (var i = 0; i < v.length; i++) {
    d.v.push(v[i]);
    if (Utilities.newBlob(JSON.stringify(d)).getBytes().length > 950) { d.v.pop(); d.m = v.length - i; break; }
  }
  return d;
}

/** /tablero */
function TGT_enviar_(ctx) {
  var d = TGT_datos_(ctx.ss), props = PropertiesService.getScriptProperties();
  var teclado = { inline_keyboard: [[{ text: '📅 Ver vencimientos', callback_data: 'c:vencimientos' }, { text: '📋 Menú', callback_data: 'c:menu' }]] };
  var r = TG_llamar_('sendWidget', { chat_id: ctx.chatId, html: TGT_HTML_, chat_data: JSON.stringify(d), reply_markup: teclado });
  if (r.ok && r.result && r.result.message_id) {
    var viejo = props.getProperty(TGT_PROP_ + ctx.chatId);
    if (viejo) TG_borrar_(ctx.chatId, viejo);   // un solo tablero por chat: se quita el anterior
    props.setProperty(TGT_PROP_ + ctx.chatId, String(r.result.message_id));
    try { TG_llamar_('pinChatMessage', { chat_id: ctx.chatId, message_id: r.result.message_id, disable_notification: true }); } catch (e) {}
    return;
  }
  // Telegram no aceptó el widget: el mismo tablero como mensaje enriquecido (no se actualiza solo)
  var rico = '<h3>📊 Tablero · vence en 7 días</h3>' + (d.v.length ? '<ul>' + d.v.map(function (x) { return '<li>' + TG_esc_(x[0]) + ' — <b>' + TG_esc_(x[1]) + '</b></li>'; }).join('') + '</ul>' : '<p>✅ Nada por vencer.</p>') +
    '<p><i>Actualizado ' + d.t + '</i></p>';
  TG_mostrarRico_(ctx, rico, '📊 <b>Tablero</b>\n' + (d.v.length ? d.v.map(function (x) { return '• ' + TG_esc_(x[0]) + ' — <b>' + TG_esc_(x[1]) + '</b>'; }).join('\n') : '✅ Nada por vencer.'), teclado.inline_keyboard, true);
}

/** Cada hora (vigía): pone al día los tableros abiertos. */
function TGT_actualizar_(ss) {
  var props = PropertiesService.getScriptProperties(), todas = props.getProperties(), d = null;
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(TGT_PROP_) !== 0) return;
    d = d || TGT_datos_(ss);
    var r = TG_llamar_('editMessageWidgetData', { chat_id: k.slice(TGT_PROP_.length), message_id: Number(todas[k]), chat_data: JSON.stringify(d) });
    if (!r.ok && /not found|can't be edited|MESSAGE_ID_INVALID/i.test(r.description || '')) props.deleteProperty(k);   // lo borraron
  });
}
