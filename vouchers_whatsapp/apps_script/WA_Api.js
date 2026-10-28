/**
 * 📲 Llamadas a la API de WhatsApp (Meta Graph).
 */

function WA_graph_(metodo, ruta, cuerpo) {
  var op = { method: metodo.toLowerCase(), muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + WA_prop_('WA_TOKEN') } };
  if (cuerpo) { op.contentType = 'application/json'; op.payload = JSON.stringify(cuerpo); }
  for (var intento = 1; intento <= 3; intento++) {
    var r = UrlFetchApp.fetch(WA_GRAPH_ + ruta, op), cod = r.getResponseCode(), datos = {};
    try { datos = JSON.parse(r.getContentText() || '{}'); } catch (e) {}
    if (cod >= 200 && cod < 300) {
      // Se recuerda el texto de cada mensaje enviado: si la persona lo responde (cita), la IA sabe de qué habla.
      if (cuerpo && /\/messages$/.test(ruta) && datos.messages && datos.messages[0]) WA_guardarTextoMsg_(datos.messages[0].id, WA_textoDeEnvio_(cuerpo));
      return { ok: true, datos: datos };
    }
    if ((cod === 429 || cod >= 500) && intento < 3) { Utilities.sleep(1500 * intento); continue; }
    var err = datos.error || {};
    return { ok: false, error: (err.message || ('HTTP ' + cod)) + (err.code ? ' (código ' + err.code + ')' : ''), datos: datos };
  }
}

// El enlace de descarga que da Meta vale 5 minutos y pide el mismo token.
function WA_bajarMedia_(mediaId) {
  var info = WA_graph_('GET', mediaId);
  if (!info.ok) throw new Error('Meta no entregó el archivo: ' + info.error);
  var tam = Number(info.datos.file_size || 0);
  if (tam > WA_MAX_MB_ * 1024 * 1024) throw new Error('Archivo de ' + Math.round(tam / 1048576) + ' MB: el máximo es ' + WA_MAX_MB_ + ' MB');
  var r = UrlFetchApp.fetch(info.datos.url, { headers: { Authorization: 'Bearer ' + WA_prop_('WA_TOKEN') }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Descarga falló (HTTP ' + r.getResponseCode() + ')');
  return r.getBlob().setContentType(info.datos.mime_type || r.getHeaders()['Content-Type'] || 'application/octet-stream');
}

function WA_enviarTexto_(a, texto) {
  if (!WA_prop_('WA_TOKEN') || !WA_prop_('WA_PHONE_ID')) return false;
  var r = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', to: a, type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: false }
  });
  if (!r.ok) console.error('No se pudo responder a ' + a + ': ' + r.error);
  return r.ok;
}

/* ============================================================ mensajes citados (responder a un mensaje) */

// Texto de un mensaje que mandamos (texto, botones, lista o pie de foto/documento).
function WA_textoDeEnvio_(c) {
  if (c.text && c.text.body) return c.text.body;
  if (c.interactive) return [c.interactive.header && c.interactive.header.text, c.interactive.body && c.interactive.body.text].filter(Boolean).join('\n');
  var m = c.image || c.document || c.video;
  return m && m.caption ? m.caption : (c.document && c.document.filename ? '📎 ' + c.document.filename : '');
}

// Se guarda 6 horas (lo mismo que la IA recuerda la conversación).
function WA_guardarTextoMsg_(id, texto) {
  texto = String(texto || '').trim();
  if (!id || !texto) return;
  try { CacheService.getScriptCache().put('wa_t_' + id, texto.slice(0, 2000), 21600); } catch (e) {}
  // Además, por 7 días, solo las referencias (factura, fila del voucher, operación): citar un mensaje de ayer sigue funcionando.
  var refs = WA_refs_(texto);
  if (!refs) return;
  try {
    var props = WA_props_(), m = JSON.parse(props.getProperty('WA_REFS') || '{}'), hoy = Date.now();
    m[id] = { r: refs, t: hoy };
    var ids = Object.keys(m).filter(function (k) { return hoy - m[k].t < 7 * 864e5; }).sort(function (a, b) { return m[b].t - m[a].t; }).slice(0, 250), n = {};
    ids.forEach(function (k) { n[k] = m[k]; });
    props.setProperty('WA_REFS', JSON.stringify(n));
  } catch (e) {}
}

// "F003-37515 · Fotos!362 · op 280698" del texto de un mensaje ('' si no tiene).
function WA_refs_(texto) {
  var t = String(texto || ''), out = [];
  (t.match(/\b[FEB][A-Z0-9]{3}\s*-\s*\d{1,8}\b/gi) || []).forEach(function (x) { x = 'factura ' + x.replace(/\s/g, '').toUpperCase(); if (out.indexOf(x) < 0) out.push(x); });
  (t.match(/\b(?:Fotos|Originales)!\d+/gi) || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
  (t.match(/\bop\.?\s*\d{3,}/gi) || []).forEach(function (x) { x = 'op ' + x.replace(/\D/g, ''); if (out.indexOf(x) < 0) out.push(x); });   // los vouchers del resultado
  return out.slice(0, 12).join(' · ');
}

/** Texto del mensaje al que la persona responde (m.context.id), o '' si no responde a ninguno o ya venció. */
function WA_textoCitado_(m) {
  var id = m && m.context && m.context.id;
  if (!id) return '';
  try {
    var t = CacheService.getScriptCache().get('wa_t_' + id);
    if (t) return t;
    var x = JSON.parse(WA_props_().getProperty('WA_REFS') || '{}')[id];
    return x ? '(mensaje anterior) ' + x.r : '';
  } catch (e) { return ''; }
}

/* ============================================================ avisos que manda Cobranzas */

/**
 * 🧩 Cobranzas pide mandar algo a los números autorizados (hoy: el captcha de Quesito para que la persona
 * responda las casillas). Usa la misma clave que esta app usa para hablar con Cobranzas.
 * Cuerpo: {tipo:'foto', base64, texto} o {tipo:'texto', texto}.
 */
function WA_desdeCobranzas_(e, p) {
  var clave = WA_props_().getProperty('WA_IA_CLAVE');
  if (!clave || p.token !== clave) return WA_ok_('Forbidden');
  try {
    var q = JSON.parse((e.postData && e.postData.contents) || '{}'), media = '';
    // Mientras haya un captcha esperando, las respuestas cortas ("1 6 9", "0") van directo a Cobranzas.
    if (q.tipo === 'foto') WA_props_().setProperty('WA_CAPTCHA_HASTA', String(Date.now() + 10 * 60000));
    else if (!q.numero) WA_props_().deleteProperty('WA_CAPTCHA_HASTA');   // un aviso a un solo número no corta un captcha
    if (q.tipo === 'foto' && q.base64) media = WA_subirImagen_(Utilities.newBlob(Utilities.base64Decode(q.base64), 'image/png', 'captcha.png'));
    // 🚚 'imagen' (p. ej. vista previa de una guía): sin captcha; con q.numero va solo a ese número autorizado.
    if (q.tipo === 'imagen' && q.base64) media = WA_subirImagen_(Utilities.newBlob(Utilities.base64Decode(q.base64), q.mime || 'image/jpeg', 'imagen.jpg'));
    var destinos = WA_permitidos_();
    // 📄 'documento' (p. ej. el PDF de una guía emitida): va adjunto, a un solo número autorizado.
    if (q.tipo === 'documento' && q.base64 && q.numero) {
      destinos.filter(function (a) { return String(a).replace(/\D/g, '') === String(q.numero).replace(/\D/g, ''); }).forEach(function (a) {
        try { WA_enviarArchivo_(a, { base64: q.base64, mime: q.mime || 'application/pdf', nombre: q.nombre || 'documento.pdf', titulo: q.texto || '' }); }
        catch (ed) { console.error('Documento de Cobranzas: ' + ed.message); WA_enviarTexto_(a, '⚠️ No pude adjuntar ' + (q.nombre || 'el archivo') + ': ' + ed.message); }
      });
      return WA_ok_('OK');
    }
    if (q.numero) destinos = destinos.filter(function (a) { return String(a).replace(/\D/g, '') === String(q.numero).replace(/\D/g, ''); });
    destinos.forEach(function (a) {
      if (media) {
        var r = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
          messaging_product: 'whatsapp', to: a, type: 'image', image: { id: media, caption: String(q.texto || '').slice(0, 1000) } });
        if (!r.ok) console.error('Foto para ' + a + ': ' + r.error);
      } else if (q.texto) WA_enviarTexto_(a, q.texto);
      if (q.botones && (q.botones.opciones || []).length) {   // p. ej. ✅ Emitir · ✏️ Modificar · 🗑 Descartar
        if (media) Utilities.sleep(3000);   // la foto tarda más en llegar: los botones van DEBAJO de ella, no antes
        try { WA_ofrecerBotones_(a, q.botones); }
        catch (eb) { console.error('Botones de Cobranzas: ' + eb.message); WA_enviarTexto_(a, '⚠️ No pude mostrar los botones: ' + eb.message); }
      }
    });
  } catch (err) {
    console.error('Aviso de Cobranzas: ' + (err && err.stack || err));
  }
  return WA_ok_('OK');
}

/** Sube una imagen a Meta y devuelve su id para mandarla. */
function WA_subirImagen_(blob) {
  var r = UrlFetchApp.fetch(WA_GRAPH_ + WA_prop_('WA_PHONE_ID') + '/media', {
    method: 'post', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + WA_prop_('WA_TOKEN') },
    payload: { messaging_product: 'whatsapp', type: blob.getContentType(), file: blob } });
  var d = {};
  try { d = JSON.parse(r.getContentText() || '{}'); } catch (err) {}
  if (!d.id) throw new Error('Meta no aceptó la imagen (HTTP ' + r.getResponseCode() + ')');
  return d.id;
}

/** 🧩 Respuesta al captcha de Quesito ("1 6 9", "0", "otra", "cancelar"). true si la tomó Cobranzas. */
function WA_captcha_(de, texto) {
  if (Number(WA_prop_('WA_CAPTCHA_HASTA') || 0) < Date.now()) return false;
  if (!/^\s*(\d{1,2}([\s,;y\-]+\d{1,2})*|0|ninguna?|ninguno|listo|verificar|otra|otro|cambiar|nueva|cancelar|parar)\s*\.?\s*$/i.test(texto)) return false;
  var r;
  try { r = WA_cobranzas_('captcha', { texto: texto }); } catch (e) { return false; }
  if (!r || !r.ok || !r.texto) return false;
  WA_enviarTexto_(de, r.texto);
  return true;
}
