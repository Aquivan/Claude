/**
 * 🤖 Telegram — llamadas a la API de bots y formato de los mensajes (HTML de Telegram).
 */

var TG_MAX_TEXTO_ = 3900;   // Telegram acepta 4096 caracteres por mensaje

function TG_token_() {
  return PropertiesService.getScriptProperties().getProperty(TG_PROP_.TOKEN) || '';
}

/** Llama a un método de la API. carga con un Blob adentro = se envía como archivo (multipart). */
function TG_llamar_(metodo, carga, reintentado) {
  var token = TG_token_();
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