/**
 * 📲 Vouchers por WhatsApp — recepción.
 *
 * El puente de Cloudflare reenvía aquí (doPost?token=...) cada aviso de Meta
 * que trae mensajes. Por cada foto o PDF: se baja de Meta, se guarda en la
 * carpeta de Entrada de Vouchers (Fotos u Originales) y se anota en la
 * pestaña Recibidos. No se contesta mensaje por mensaje: WA_cadaMinuto manda
 * UN aviso por tanda (y otro con el resultado), así un reenvío de 20
 * vouchers no llena el chat ni gasta respuestas.
 */

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.canal === 'cob') return WA_desdeCobranzas_(e, p);   // 🧩 aviso que manda Cobranzas (WA_Api.js)
    var clave = WA_prop_('WA_GAS_TOKEN');
    if (!clave || p.token !== clave) return WA_ok_('Forbidden');
    WA_props_().setProperty('WA_ULTIMO', Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm:ss'));
    WA_procesarAviso_(JSON.parse(e.postData.contents));
  } catch (err) {
    console.error('doPost WhatsApp: ' + (err && err.stack || err));
  }
  return WA_ok_('OK');
}

function doGet(e) {
  if (((e && e.parameter) || {}).p === 'privacidad') {
    return HtmlService.createHtmlOutput(WA_PRIVACIDAD_).setTitle('Política de privacidad · Vouchers Bot');
  }
  return WA_ok_('Vouchers WhatsApp activo ✅');
}

// Página que Meta pide para publicar la app (URL de la política de privacidad).
var WA_PRIVACIDAD_ =
  '<div style="font:15px/1.6 Arial;max-width:720px;margin:24px auto;padding:0 16px">' +
  '<h1>Política de privacidad — Vouchers Bot</h1>' +
  '<p>Vouchers Bot es una herramienta interna de AsecontAqui (Perú) para registrar comprobantes de pago ' +
  '(vouchers) que los propios usuarios autorizados reenvían por WhatsApp.</p>' +
  '<h2>Qué datos se tratan</h2><p>El número de WhatsApp y el nombre de perfil de quien envía, y las fotos o ' +
  'archivos PDF de vouchers que envía. De cada voucher se extraen fecha, banco, monto, número de operación y beneficiario.</p>' +
  '<h2>Para qué</h2><p>Únicamente para registrar y conciliar los pagos en las hojas de cálculo de la empresa y ' +
  'responder al remitente con el resultado. No se usan para publicidad ni se venden ni ceden a terceros.</p>' +
  '<h2>Dónde se guardan</h2><p>En Google Drive y Google Sheets de la empresa. Intervienen como encargados Meta ' +
  '(WhatsApp), Cloudflare y Google, conforme a la Ley N.° 29733 de Protección de Datos Personales y su reglamento.</p>' +
  '<h2>Quién puede usarlo</h2><p>Solo números autorizados por la empresa. Los demás reciben un aviso y sus mensajes no se procesan.</p>' +
  '<h2>Sus derechos</h2><p>Puede pedir acceso, rectificación o eliminación de sus datos al administrador de la empresa ' +
  'por el mismo chat de WhatsApp.</p><p style="color:#777">Actualizado: octubre de 2026.</p></div>';

// HtmlService (no ContentService): así lo que sigue a la redirección de Apps Script responde 200.
function WA_ok_(t) { return HtmlService.createHtmlOutput(t); }

function WA_procesarAviso_(aviso) {
  (aviso.entry || []).forEach(function (en) {
    (en.changes || []).forEach(function (ch) {
      var v = ch.value || {};
      var nombres = {};
      (v.contacts || []).forEach(function (c) { nombres[c.wa_id] = ((c.profile || {}).name) || ''; });
      (v.messages || []).forEach(function (m) {
        try { WA_procesarMensaje_(m, nombres[m.from] || ''); }
        catch (err) { console.error('Mensaje ' + m.id + ': ' + (err && err.stack || err)); }
      });
    });
  });
}

function WA_procesarMensaje_(m, nombre) {
  var cache = CacheService.getScriptCache();
  if (cache.get('wa_m_' + m.id)) return;
  cache.put('wa_m_' + m.id, '1', 21600);

  var de = WA_soloDigitos_(m.from), permitidos = WA_permitidos_();
  if (permitidos.indexOf(de) === -1) {   // sin lista no se acepta a nadie
    console.warn('Número no autorizado: ' + de);
    WA_enviarTexto_(de, permitidos.length ? '🚫 Este número no está autorizado para registrar vouchers. Pida que agreguen el ' + de + '.'
      : '🚫 Aún no hay números autorizados: en la hoja "Vouchers WhatsApp" use el menú 📲 WhatsApp → Números autorizados.');
    return;
  }

  if (m.type === 'interactive' && m.interactive) {
    var resp = m.interactive.button_reply || m.interactive.list_reply || {};
    var bid = String(resp.id || '');
    if (bid.indexOf('en:') === 0) WA_botonNombre_(de, bid);
    else if (bid.indexOf('pr:') === 0) WA_procesarBoton_(de, bid);     // 🧾 Procesar documento
    else if (bid.indexOf('un:') === 0) WA_deshacerBoton_(de, bid);     // ↩️ Deshacer
    else WA_boton_(de, bid);
    return;
  }
  if (m.type === 'text') {
    var cuerpo = ((m.text || {}).body || '').trim();
    WA_guardarTextoMsg_(m.id, cuerpo);   // por si después la persona cita su propio mensaje
    if (WA_captcha_(de, cuerpo)) return;   // 🧩 "1 6 9" / "0" para el captcha de Quesito (WA_Api.js)
    if (WA_comando_(de, cuerpo)) return;
    if (WA_procesarNombre_(de, cuerpo)) return;   // 🧾 nombre pedido con "🏷 Cambiar nombre"
    if (WA_greTexto_(m, de, nombre, cuerpo)) return;   // 🚚 "guía …": las fotos juntadas o las que esperan nombre (WA_Gre.js)
    // 🏷 ¿De quién son? — respuesta a la pregunta, o "de Edit" antes de reenviar.
    if (WA_respuestaNombre_(de, cuerpo).tomado) return;
    if (WA_esEtiqueta_(cuerpo) && WA_etiquetaPrevia_(de, cuerpo)) return;
    WA_preguntarIA_(m, de, nombre, cuerpo);
    return;
  }

  // 🎤 Nota de voz o audio: la IA lo transcribe y responde lo que se pidió.
  if (m.type === 'audio' && m.audio) {
    try { if (WA_greAudio_(de, m)) return; } catch (err) { console.error('Audio de guía: ' + err.message); }   // 🚚 WA_Gre.js
    try {
      var voz = WA_bajarMedia_(m.audio.id);
      var audio = { base64: Utilities.base64Encode(voz.getBytes()), mime: m.audio.mime_type || 'audio/ogg' };
      if (WA_prop_('WA_PRN_' + de)) {   // 🧾 "🏷 Cambiar nombre" dicho por voz
        var rv = WA_entrega_({ modo: 'nombres', audio: audio });
        if (rv && rv.entendido && WA_procesarNombre_(de, rv.nombre + ' ' + rv.corta)) return;
      }
      var rn = WA_respuestaNombre_(de, '', audio);   // 🏷 si se esperaba el nombre de una tanda
      if (rn.tomado) return;
      if (rn.dicho) WA_preguntarIA_(m, de, nombre, rn.dicho);
      else WA_preguntarIA_(m, de, nombre, '', [], audio);
    } catch (err) { WA_enviarTexto_(de, '⚠️ No pude bajar el audio: ' + err.message); }
    return;
  }

  var media = m.image || m.document || null;
  if (!media || (m.type !== 'image' && m.type !== 'document')) {
    if (['video', 'sticker'].indexOf(m.type) !== -1) WA_enviarTexto_(de, 'Entiendo textos, notas de voz, fotos y PDF 🙂');
    return;
  }

  var mime = media.mime_type || '';
  var esPdf = /pdf/i.test(mime), esImagen = /^image\//i.test(mime);
  if (!esPdf && !esImagen) { WA_anotar_(m, de, nombre, '', media.filename || mime, 0, 'Error', 'Solo fotos o PDF', ''); return; }

  var caption = media.caption || '';
  // 🚚 Fotos de una guía de remisión ("guía" en el comentario, o seguidas de una): se juntan, no van a vouchers.
  try { if (WA_greArchivo_(m, de, media, caption, mime, esPdf)) return; }
  catch (err) { WA_enviarTexto_(de, '⚠️ No pude guardar el archivo de la guía: ' + err.message); return; }
  // Foto/PDF con una pregunta en el comentario ("¿ya está pagado?", "ia …"): se le pregunta a la IA, no se registra.
  if (/\?\s*$/.test(caption) || /^\s*(ia|pregunta)\b/i.test(caption)) {
    try {
      var b = WA_bajarMedia_(media.id);
      WA_preguntarIA_(m, de, nombre, caption.replace(/^\s*(ia|pregunta)\b[:\s]*/i, ''),
        [{ base64: Utilities.base64Encode(b.getBytes()), mime: mime, nombre: media.filename || ('whatsapp' + (esPdf ? '.pdf' : '.jpg')) }]);
    } catch (err) { WA_enviarTexto_(de, '⚠️ No pude leer el archivo: ' + err.message); }
    return;
  }
  var tipo = /\boriginal\b/i.test(caption) ? 'original' : /\bfoto\b/i.test(caption) ? 'foto'
    : (WA_prop_('WA_MODO_' + de) || (esPdf ? 'original' : 'foto'));

  var archivo = WA_nombreArchivo_(media.filename, caption, esPdf ? '.pdf' : '.jpg', nombre || de, m.id);
  // 🏷 Espera en una carpeta aparte hasta saber de quién es (WA_Entregas.js); un nombre escrito en el comentario se respeta.
  var esperar = WA_preguntarNombre_();
  var propio = !!caption.replace(/\b(original|foto)\b/ig, '').trim();
  var blob, f;
  try {
    blob = WA_bajarMedia_(media.id).setName(archivo);
    f = (esperar ? WA_carpetaEspera_() : DriveApp.getFolderById(WA_VOUCHERS_.entrada[tipo])).createFile(blob);
  } catch (err) {
    WA_anotar_(m, de, nombre, tipo, archivo, 0, 'Error', String(err.message || err).slice(0, 200), '');
    return;
  }
  WA_anotar_(m, de, nombre, tipo, archivo, Math.round(blob.getBytes().length / 1024), esperar ? 'Espera' : 'En cola', esperar && propio ? 'nombre propio' : '', f.getId());
}

function WA_anotar_(m, de, nombre, tipo, archivo, kb, estado, resultado, idArchivo) {
  WA_hoja_().appendRow([new Date(), nombre, de, tipo, archivo, kb, estado, resultado, m.id, idArchivo, '']);
  WA_props_().setProperty('WA_TANDA_' + de, String(Date.now()));
}

// Igual que el bot de Telegram: nombre real del PDF, o el comentario, o fecha + quién lo mandó.
function WA_nombreArchivo_(real, caption, ext, quien, idMsg) {
  var sufijo = '_wa' + String(idMsg || '').replace(/[^A-Za-z0-9]/g, '').slice(-6);
  if (real) {
    var punto = real.lastIndexOf('.');
    return punto > 0 ? WA_limpio_(real.slice(0, punto)) + sufijo + real.slice(punto) : WA_limpio_(real) + sufijo + ext;
  }
  var cap = caption.replace(/\b(original|foto)\b/ig, '').trim();
  if (cap) return WA_limpio_(cap) + sufijo + ext;
  var fecha = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd_HHmmss');
  return fecha + '_' + (WA_limpio_(quien).toLowerCase() || 'whatsapp') + '_voucher' + sufijo + ext;
}

function WA_limpio_(t) {
  return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 80);
}

function WA_comando_(de, texto) {
  var t = texto.toLowerCase();
  if (/^modo\s+(original|foto|auto)/.test(t)) {
    var modo = t.match(/^modo\s+(\w+)/)[1];
    if (modo === 'auto') WA_props_().deleteProperty('WA_MODO_' + de); else WA_props_().setProperty('WA_MODO_' + de, modo);
    WA_enviarTexto_(de, modo === 'auto' ? '🔄 Modo automático: fotos → Fotos, PDF → Originales.'
      : (modo === 'original' ? '📄 Modo ORIGINAL' : '📸 Modo FOTO') + ' activado. Escriba "modo auto" para volver al automático.');
    return true;
  }
  if (/^estado[\s!.?]*$/.test(t)) { WA_enviarTexto_(de, WA_textoEstado_(de)); return true; }
  if (/^\/?(deshacer|desh[aá]z(lo)?|deshaga)\b/.test(t)) { WA_deshacerVer_(de); return true; }
  if (/^preguntar\s+nombres?\s+(si|sí|no)\b/.test(t)) {
    var si = !/\bno\b/.test(t);
    WA_props_().setProperty('WA_PREGUNTAR_NOMBRE', si ? '1' : '0');
    WA_enviarTexto_(de, si ? '🏷 Le preguntaré de quién son cada tanda de vouchers.' : '🏷 Ya no le pregunto de quién son: quedan con el nombre del archivo o la fecha.');
    return true;
  }
  if (!/^\/?(hola|ayuda|menu|menú|start|inicio|buenas|buenos dias|buenos días|buenas tardes|buenas noches)[\s!.¡]*$/.test(t)) return false;
  WA_enviarTexto_(de,
    '👋 *Vouchers por WhatsApp*\n\n' +
    'Reenvíeme las fotos o PDF de los vouchers (puede marcar varios y reenviarlos juntos). ' +
    'Los registro en la hoja de Vouchers y le aviso el resultado.\n\n' +
    '• Fotos → pestaña *Fotos* · PDF → *Originales*\n' +
    '• Escriba "original" o "foto" en el comentario para cambiarlo solo esa vez\n' +
    '• *modo original* / *modo foto* / *modo auto*\n' +
    '• *estado*: lo que está en cola\n' +
    '• 🧾 En la lista "¿De quién son?" elija *Revisar con IA*: lee cada página, ve si el voucher ya está y completa la factura\n' +
    '• ↩️ *deshacer*: deshace la última acción (filas, archivos y datos)\n' +
    '• 🏷 Al terminar cada tanda le pregunto *de quién son* (un toque). También puede escribir antes *de Edit* o *de Edit 15/10*. ' +
    '*preguntar nombre no* lo apaga\n\n' +
    '🧠 *Pregúnteme lo que necesite* (la misma IA del asistente de Telegram), por ejemplo:\n' +
    '• ¿Cuánto pagó Petro en octubre?\n' +
    '• Mándame la foto del voucher de Cecovasa\n' +
    '• ¿Hay notificaciones nuevas de SUNAT?\n' +
    '• Foto o PDF con una pregunta en el comentario: "¿ya está registrado?"\n' +
    '• 🎤 También puede mandarme una nota de voz\n\n' +
    '📖 *ayuda temas*: la guía completa paso a paso (vouchers, preguntas, guías, retenciones, SUNAT y palabras técnicas)');
  return true;
}

function WA_textoEstado_(de) {
  var datos = WA_hoja_().getDataRange().getValues().slice(1);
  var cola = datos.filter(function (r) { return String(r[2]) === de && (r[6] === 'En cola' || r[6] === 'Espera'); }).length;
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
  var deHoy = datos.filter(function (r) { return String(r[2]) === de && r[0] instanceof Date && Utilities.formatDate(r[0], 'America/Lima', 'yyyy-MM-dd') === hoy; }).length;
  return '📊 Hoy me envió ' + deHoy + ' archivo(s). En cola: ' + cola + '.' +
    (cola ? '\nEl sistema de Vouchers los procesa cada 10 minutos.' : '');
}
