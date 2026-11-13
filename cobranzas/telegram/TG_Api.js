/**
 * 🤖 Telegram — llamadas a la API de bots y formato de los mensajes (HTML de Telegram).
 */

var TG_MAX_TEXTO_ = 3900;   // Telegram acepta 4096 caracteres por mensaje

function TG_token_() {
  return PropertiesService.getScriptProperties().getProperty(TG_PROP_.TOKEN) || '';
}

/** Llama a un método de la API. carga con un Blob adentro = se envía como archivo (multipart). */
var TG_CB_ = null;   // el botón que se está atendiendo en esta ejecución: {msgId, data, rm (teclado original)}

/**
 * ☑️ Botón tocado: en vez de quitar el teclado, se dejan los botones GRISES (desactivados, Bot API 10.3) y el tocado con ✔.
 * Así se ve qué se eligió y no se puede tocar dos veces. Devuelve null si el teclado no tiene botones de acción.
 */
function TG_deshabilitar_(rm, data) {
  var o; try { o = JSON.parse(JSON.stringify(rm)); } catch (e) { return null; }
  if (!o || !Array.isArray(o.inline_keyboard)) return null;
  var hay = false;
  o.inline_keyboard.forEach(function (fila) {
    (fila || []).forEach(function (b) {
      if (!b || !b.callback_data) return;
      hay = true;
      if (b.callback_data === data) b.text = '✔ ' + String(b.text || '').replace(/^\s*(✅|☑️|✔️?)?\s*/, '');
      else delete b.style;
      b.disabled = {};
    });
  });
  return hay ? o : null;
}

function TG_llamar_(metodo, carga, reintentado) {
  var token = TG_token_();
  var sinDes = carga && carga._sinDes; if (carga) delete carga._sinDes;
  if (metodo === 'editMessageReplyMarkup' && !sinDes && TG_CB_ && TG_CB_.rm && TG_CB_.data !== 'x' && carga && carga.reply_markup &&
      Array.isArray(carga.reply_markup.inline_keyboard) && !carga.reply_markup.inline_keyboard.length && String(carga.message_id) === String(TG_CB_.msgId)) {
    var gris = TG_deshabilitar_(TG_CB_.rm, TG_CB_.data);
    if (gris) {
      var rg = TG_llamar_('editMessageReplyMarkup', { chat_id: carga.chat_id, message_id: carga.message_id, reply_markup: gris, _sinColor: true, _sinDes: true });
      if (rg.ok || /not modified/i.test(rg.description || '')) return rg;
      // si Telegram no aceptara botones desactivados: se quita el teclado, como antes
    }
  }
  var sinColor = carga && carga._sinColor; if (carga) delete carga._sinColor;
  if (carga && carga.reply_markup && !sinColor) carga.reply_markup = TG_colorear_(carga.reply_markup);   // 🎨 botones verdes/rojos/azules
  if (!token) throw new Error('Falta conectar el bot (menú 🤖 Telegram → 1️⃣ Conectar bot).');
  var params = { method: 'post', muteHttpExceptions: true };
  var conArchivo = carga && Object.keys(carga).some(function (k) { return carga[k] && typeof carga[k].getBytes === 'function'; });
  if (conArchivo) {
    var p = {};
    Object.keys(carga).forEach(function (k) {
      var v = carga[k];
      if (v == null) return;
      p[k] = typeof v === 'object' && typeof v.getBytes !== 'function' ? JSON.stringify(v) : (typeof v.getBytes === 'function' ? v : String(v));
    });
    params.payload = p;
  } else {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(carga || {});
  }
  var r, j;
  try {
    r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + metodo, params);
    j = JSON.parse(r.getContentText());
  } catch (e) {
    j = { ok: false, description: 'sin respuesta de Telegram: ' + e.message };
  }
  if (!j.ok && !sinColor && carga && carga.reply_markup && /button|keyboard|style|reply.?markup/i.test(j.description || '')) {
    carga.reply_markup = TG_colorear_(carga.reply_markup, true);   // si Telegram no aceptara los colores: los mismos botones, sin color
    carga._sinColor = true;
    return TG_llamar_(metodo, carga, reintentado);
  }
  if (!j.ok && j.parameters && j.parameters.retry_after && !reintentado) {
    Utilities.sleep(Math.min(8, j.parameters.retry_after) * 1000);
    return TG_llamar_(metodo, carga, true);
  }
  if (!j.ok) console.warn('Telegram ' + metodo + ': ' + j.description);
  return j;
}

/**
 * Envía un texto (HTML de Telegram), partido en varios mensajes si es largo.
 * teclado: inline_keyboard [[{text, callback_data|url}]] o un reply_markup completo.
 * Devuelve el message_id del último mensaje (o 0 si falló).
 */
function TG_enviar_(chatId, html, teclado, opciones) {
  opciones = opciones || {};
  var trozos = TG_trozos_(String(html || ''));
  var id = 0;
  trozos.forEach(function (t, i) {
    var carga = { chat_id: chatId, text: t, parse_mode: 'HTML', disable_web_page_preview: true };
    if (opciones.responderA && i === 0) carga.reply_parameters = { message_id: opciones.responderA, allow_sending_without_reply: true };
    if (opciones.silencioso) carga.disable_notification = true;
    if (teclado && i === trozos.length - 1) carga.reply_markup = Array.isArray(teclado) ? { inline_keyboard: teclado } : teclado;
    var r = TG_llamar_('sendMessage', carga);
    if (!r.ok && /parse|entit/i.test(r.description || '')) {   // HTML mal armado: va como texto simple
      carga.text = TG_sinHtml_(t);
      delete carga.parse_mode;
      r = TG_llamar_('sendMessage', carga);
    }
    if (!r.ok && carga.reply_markup && /BUTTON|web_app|WEB_APP/i.test(r.description || '')) {   // 🧾 un botón Mini App no vale en este chat: va como enlace normal
      carga.reply_markup = JSON.parse(JSON.stringify(carga.reply_markup, function (k, v) { return v && v.web_app ? { text: v.text, url: v.web_app.url } : v; }));
      r = TG_llamar_('sendMessage', carga);
    }
    if (r.ok) id = r.result.message_id;
  });
  return id;
}

function TG_editar_(chatId, msgId, html, teclado) {
  var carga = { chat_id: chatId, message_id: msgId, text: TG_trozos_(String(html || ''))[0], parse_mode: 'HTML', disable_web_page_preview: true };
  if (teclado) carga.reply_markup = { inline_keyboard: teclado };
  var r = TG_llamar_('editMessageText', carga);
  if (!r.ok && /parse|entit/i.test(r.description || '')) { carga.text = TG_sinHtml_(carga.text); delete carga.parse_mode; r = TG_llamar_('editMessageText', carga); }
  return r.ok || /not modified/i.test(r.description || '');
}

/**
 * ✨ Mensaje enriquecido (Bot API 10.2+: sendRichMessage): títulos, listas, tablas y secciones que se abren (<details>).
 * rico = HTML enriquecido; respaldo = el HTML de siempre, que se usa si Telegram no acepta el enriquecido.
 * En grupos responde con un mensaje 👻 efímero (solo lo ve quien preguntó) cuando Telegram lo permite:
 * al tocar un botón (callback), al usar un comando efímero o al tocar un botón de otro efímero.
 * Si es un botón, cambia el mismo mensaje en vez de mandar otro. nuevo=true: siempre un mensaje nuevo y visible para todos.
 * respaldo puede ser una función (se arma solo si hace falta).
 */
function TG_mostrarRico_(ctx, rico, respaldo, teclado, nuevo) {
  var resp = respaldo;
  respaldo = function () { if (typeof resp === 'function') resp = resp(); return String(resp || ''); };
  var rm = teclado ? (Array.isArray(teclado) ? { inline_keyboard: teclado } : teclado) : undefined;
  var msg = { html: String(rico), skip_entity_detection: true };
  var ok = function (r) { return r && (r.ok || /not modified/i.test(r.description || '')); };
  if (!nuevo && ctx.grupo && ctx.deId) {   // 👻 efímero: los demás del grupo no lo ven
    var efi = function (texto) {
      if (ctx.efimeroMsg) {
        var e = { chat_id: ctx.chatId, receiver_user_id: Number(ctx.deId), ephemeral_message_id: ctx.efimeroMsg, reply_markup: rm };
        if (texto) { e.text = TG_trozos_(respaldo())[0]; e.parse_mode = 'HTML'; } else e.rich_message = msg;
        return TG_llamar_('editEphemeralMessageText', e);
      }
      var p = { receiver_user_id: Number(ctx.deId) };
      if (ctx.botonId) { p.callback_query_id = ctx.botonId; p.replace_callback_query_message = true; }
      else if (!ctx.efimeroId) return null;
      var c = { chat_id: ctx.chatId, ephemeral_message_parameters: p, reply_markup: rm };
      if (ctx.efimeroId) c.reply_parameters = { ephemeral_message_id: ctx.efimeroId };
      if (texto) { c.text = TG_trozos_(respaldo())[0]; c.parse_mode = 'HTML'; return TG_llamar_('sendMessage', c); }
      c.rich_message = msg;
      return TG_llamar_('sendRichMessage', c);
    };
    if (ok(efi(false)) || ok(efi(true))) return;
    if (ctx.efimeroMsg) return TG_enviar_(ctx.chatId, respaldo(), teclado);   // un efímero no se puede editar como mensaje normal
  }
  if (!nuevo && ctx.esBoton && ctx.msgId) {
    if (ok(TG_llamar_('editMessageText', { chat_id: ctx.chatId, message_id: ctx.msgId, rich_message: msg, reply_markup: rm }))) return;
    return TG_editarOEnviar_(ctx, respaldo(), teclado);
  }
  var r = TG_llamar_('sendRichMessage', { chat_id: ctx.chatId, rich_message: msg, reply_markup: rm });
  if (r.ok) return r.result.message_id;
  return TG_enviar_(ctx.chatId, respaldo(), teclado);
}

function TG_borrar_(chatId, msgId) {
  if (msgId) TG_llamar_('deleteMessage', { chat_id: chatId, message_id: msgId });
}

function TG_accion_(chatId, accion) {
  try { TG_llamar_('sendChatAction', { chat_id: chatId, action: accion || 'typing' }); } catch (e) { /* solo es el "escribiendo…" */ }
}

function TG_responderBoton_(id, texto, alerta) {
  TG_llamar_('answerCallbackQuery', { callback_query_id: id, text: texto ? String(texto).slice(0, 190) : undefined, show_alert: !!alerta });
}

/** Envía un archivo (Blob). */
function TG_enviarArchivo_(chatId, blob, caption) {
  TG_accion_(chatId, 'upload_document');
  var r = TG_llamar_('sendDocument', { chat_id: String(chatId), document: blob, caption: caption ? String(caption).slice(0, 1000) : undefined, parse_mode: 'HTML' });
  return r.ok;
}

/** Descarga un archivo que mandó la persona. Devuelve un Blob con nombre. */
function TG_bajarArchivo_(fileId, nombre) {
  var info = TG_llamar_('getFile', { file_id: fileId });
  if (!info.ok) {
    if (/too big/i.test(info.description || '')) throw new Error('el archivo pesa más de 20 MB (límite de Telegram para bots). Mándelo comprimido o en partes.');
    throw new Error('Telegram no entregó el archivo (' + (info.description || '') + ')');
  }
  var ruta = info.result.file_path;
  var r = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + TG_token_() + '/' + ruta, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('no se pudo bajar el archivo de Telegram (HTTP ' + r.getResponseCode() + ')');
  var blob = r.getBlob();
  var ext = ruta.indexOf('.') > -1 ? ruta.split('.').pop() : '';
  var n = nombre || ruta.split('/').pop();
  if (ext && n.indexOf('.') === -1) n += '.' + ext;
  blob.setName(n);
  var mime = TG_mimePorNombre_(n);
  if (mime) blob.setContentType(mime);
  return blob;
}

function TG_mimePorNombre_(n) {
  var ext = String(n).split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', oga: 'audio/ogg', ogg: 'audio/ogg',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', csv: 'text/csv', txt: 'text/plain',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[ext] || '';
}

/* ============================================================ formato */

function TG_esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function TG_sinHtml_(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Texto de la IA (con **negritas**, viñetas, `código`, ### títulos) → HTML de Telegram. */
function TG_md_(s) {
  var t = TG_esc_(String(s || '').replace(/\r/g, ''));
  t = t.replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/__([^_\n]+)__/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/^\s*[-*•]\s+/gm, '• ');
  t = t.replace(/^\s*\|?\s*-{3,}.*$/gm, '');          // líneas separadoras de tablas markdown
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** Parte un HTML en mensajes de ≤ TG_MAX_TEXTO_, cortando entre párrafos y sin romper <pre>. */
function TG_trozos_(html) {
  if (html.length <= TG_MAX_TEXTO_) return [html || '…'];
  var bloques = html.split(/\n(?=\n)|(?=<pre>)|(?<=<\/pre>)/);
  var res = [], actual = '';
  bloques.forEach(function (b) {
    if ((actual + b).length > TG_MAX_TEXTO_ && actual) { res.push(actual); actual = ''; }
    if (b.length > TG_MAX_TEXTO_) {   // un solo bloque enorme: va como texto simple en partes
      var plano = TG_sinHtml_(b);
      for (var i = 0; i < plano.length; i += TG_MAX_TEXTO_ - 100) res.push(TG_esc_(plano.slice(i, i + TG_MAX_TEXTO_ - 100)));
      return;
    }
    actual += b;
  });
  if (actual.trim()) res.push(actual);
  return res.length ? res : ['…'];
}

/** Número como en Perú: 12,345.67 */
function TG_num_(n, dec) {
  var x = Number(n) || 0;
  dec = dec == null ? 2 : dec;
  var s = Math.abs(x).toFixed(dec).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (x < 0 ? '-' : '') + s.join('.');
}

function TG_fecha_(d) {
  return d instanceof Date && !isNaN(d) ? Utilities.formatDate(d, 'America/Lima', 'dd/MM/yyyy') : (d == null ? '' : String(d));
}

function TG_valor_(v, col) {
  if (v instanceof Date) return TG_fecha_(v);
  if (typeof v === 'number' && !/ruc|fila|dias|operaci|numero|n°|codigo|año|anio|periodo/i.test(col || '')) return TG_num_(v);
  return v == null ? '' : String(v);
}

/**
 * Tabla para el celular: cada fila como una "tarjeta" corta (las tablas anchas no caben en un teléfono).
 * Devuelve HTML. maxFilas: cuántas se muestran (el resto va en el Excel).
 */
function TG_tablaHtml_(t, maxFilas) {
  maxFilas = maxFilas || 10;
  var cols = t.columnas || [];
  var filas = t.filas || [];
  var html = '📊 <b>' + TG_esc_(t.titulo || 'Tabla') + '</b>' + (filas.length ? ' <i>(' + filas.length + ')</i>' : ' <i>(sin filas)</i>') + '\n';
  var vistas = filas.slice(0, maxFilas);
  // Si es angosta (≤3 columnas cortas) va en columnas alineadas; si no, como tarjetas.
  var anchos = cols.map(function (c, j) {
    return Math.max(String(c).length, vistas.reduce(function (m, f) { return Math.max(m, TG_valor_(f[j], c).length); }, 0));
  });
  var total = anchos.reduce(function (s, a) { return s + a + 2; }, 0);
  if (cols.length <= 3 && total <= 38) {
    var lin = function (vals) { return vals.map(function (v, j) { var s = String(v).slice(0, anchos[j]); return /^-?[\d,]+(\.\d+)?$/.test(s) ? TG_pad_(s, anchos[j], true) : TG_pad_(s, anchos[j]); }).join('  '); };
    var pre = [lin(cols), cols.map(function (c, j) { return new Array(anchos[j] + 1).join('─'); }).join('  ')]
      .concat(vistas.map(function (f) { return lin(cols.map(function (c, j) { return TG_valor_(f[j], c); })); }));
    html += '<pre>' + TG_esc_(pre.join('\n')) + '</pre>';
  } else {
    html += vistas.map(function (f) {
      var vals = cols.map(function (c, j) { return TG_valor_(f[j], c); });
      var cab = vals.slice(0, 2).filter(Boolean).map(TG_esc_).join(' · ');
      var resto = cols.slice(2).map(function (c, j) { var v = vals[j + 2]; return v === '' ? '' : TG_esc_(c) + ': <b>' + TG_esc_(String(v).slice(0, 80)) + '</b>'; })
        .filter(Boolean).join(' · ');
      return '▪️ ' + (cab ? '<b>' + cab + '</b>' : '') + (resto ? '\n   ' + resto : '');
    }).join('\n');
  }
  if (filas.length > vistas.length) html += '\n<i>… y ' + (filas.length - vistas.length) + ' más (ver el Excel).</i>';
  return html;
}

function TG_pad_(s, n, derecha) {
  s = String(s);
  var r = new Array(Math.max(0, n - s.length) + 1).join(' ');
  return derecha ? r + s : s + r;
}

/** Excel (.xlsx) con una pestaña por tabla. Se arma en una hoja temporal que se borra al terminar. */
function TG_excel_(tablas, nombre) {
  var tmp = SpreadsheetApp.create('tmp telegram ' + Date.now());
  try {
    tablas.forEach(function (t, i) {
      var sh = i === 0 ? tmp.getSheets()[0] : tmp.insertSheet();
      sh.setName(String(t.titulo || 'Tabla ' + (i + 1)).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 90) || 'Tabla ' + (i + 1));
      var cols = t.columnas.length;
      var datos = [t.columnas].concat(t.filas.map(function (f) {
        var x = f.slice(0, cols);
        while (x.length < cols) x.push('');
        return x.map(function (v) { return v == null ? '' : v; });
      }));
      if (cols) {
        sh.getRange(1, 1, datos.length, cols).setValues(datos);
        sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('#FFFFFF');
        sh.setFrozenRows(1);
      }
    });
    SpreadsheetApp.flush();
    var r = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
    return r.getBlob().setName((nombre || 'tablas') + '.xlsx');
  } finally {
    try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e) { /* queda en Drive, no pasa nada */ }
  }
}

/** Guarda algo para un botón (los botones de Telegram solo llevan 64 caracteres). Devuelve la clave corta. */
function TG_guardarBoton_(datos, segundos) {
  var k = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  CacheService.getScriptCache().put('tg_b_' + k, JSON.stringify(datos), Math.min(segundos || 21600, 21600));   // Google guarda como máximo 6 horas
  return k;
}

function TG_leerBoton_(k) {
  var s = CacheService.getScriptCache().get('tg_b_' + k);
  return s ? JSON.parse(s) : null;
}


/** 🎨 Color de los botones según lo que hacen (Bot API: style = success verde · danger rojo · primary azul).
 *  quitar=true los deja sin color. Acepta el reply_markup como objeto o como texto JSON. */
function TG_colorear_(rm, quitar) {
  var texto = typeof rm === 'string', o;
  try { o = texto ? JSON.parse(rm) : rm; } catch (e) { return rm; }
  if (!o || !Array.isArray(o.inline_keyboard)) return rm;
  o.inline_keyboard.forEach(function (fila) {
    (fila || []).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      if (quitar) { delete b.style; return; }
      if (b.style || b.url || b.web_app) return;
      var t = String(b.text || '');
      if (/^\s*(✅|☑️|💾)|\b(emitir|confirmar|aprobar|está bien|esta bien|sí,|si,|guardar|aplicar)\b/i.test(t)) b.style = 'success';
      else if (/^\s*(🗑|✖|❌|🚫|⏹)|\b(descartar|cancelar|borrar|eliminar|detener)\b|^\s*no\b/i.test(t)) b.style = 'danger';
      else if (/^\s*(▶|🔄|📥|🧾 procesar|🔎 analizar)/i.test(t)) b.style = 'primary';
    });
  });
  return texto ? JSON.stringify(o) : o;
}
/**
 * 🧾 Mini App: comprueba que el «initData» que manda Telegram a la página de verdad lo firmó Telegram para ESTE bot
 * (HMAC-SHA256 con la clave derivada del token, según core.telegram.org/bots/webapps) y que no tiene más de 24 h.
 * → {ok, id, nombre, autorizado} — autorizado = está en la lista de usuarios activos del bot. El token nunca sale de aquí.
 */
function TG_verificarInitData_(ss, initData) {
  var token = TG_token_();
  if (!token) return { ok: false, error: 'El bot no está conectado.' };
  var pares = String(initData || '').split('&').filter(String).map(function (kv) {
    var i = kv.indexOf('='); return [decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '))];
  });
  var hash = '', resto = [];
  pares.forEach(function (p) { if (p[0] === 'hash') hash = p[1]; else if (p[0] !== 'signature') resto.push(p); });
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, error: 'Datos de Telegram incompletos.' };
  resto.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  var dcs = resto.map(function (p) { return p[0] + '=' + p[1]; }).join('\n');
  var bytes = function (s) { return Utilities.newBlob(s).getBytes(); };
  var secreto = Utilities.computeHmacSha256Signature(bytes(token), bytes('WebAppData'));
  var firma = Utilities.computeHmacSha256Signature(bytes(dcs), secreto)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  var d = 0; for (var i = 0; i < 64; i++) d |= firma.charCodeAt(i) ^ hash.charCodeAt(i);
  if (d !== 0) return { ok: false, error: 'La firma de Telegram no es válida.' };
  var m = {}; resto.forEach(function (p) { m[p[0]] = p[1]; });
  if (!(Number(m.auth_date) > 0) || Date.now() / 1000 - Number(m.auth_date) > 86400) return { ok: false, error: 'Los datos de Telegram vencieron: vuelva a abrir el portal desde el bot.' };
  var u = {}; try { u = JSON.parse(m.user || '{}'); } catch (e) { u = {}; }
  if (!u.id) return { ok: false, error: 'Telegram no mandó el usuario.' };
  var x = TG_usuario_(ss, String(u.id));
  return { ok: true, id: String(u.id), nombre: [u.first_name, u.last_name].filter(String).join(' '), autorizado: !!(x && x.activo) };
}
