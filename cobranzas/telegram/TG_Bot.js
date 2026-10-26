/**
 * 🤖 Telegram — entrada del bot (aplicación web) y manejo de cada mensaje.
 *
 * Telegram llama a doPost con cada mensaje o botón. Se valida el secreto del
 * webhook (?token=…, Apps Script no deja leer cabeceras) y que la persona esté
 * autorizada en la pestaña 🤖 Telegram. Cada mensaje se procesa una sola vez
 * (Telegram reintenta si tardamos: los repetidos se descartan).
 */

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.canal === 'wa') return TGW_doPost_(e);   // 📲 preguntas que llegan por WhatsApp (TG_WhatsApp.js)
    if (p.canal === 'gh') return TGC_doPost_(e);   // 🧩 captcha de Quesito que pide el robot de GitHub (TG_Captcha.js)
    var secreto = PropertiesService.getScriptProperties().getProperty(TG_PROP_.SECRETO);
    if (!secreto || p.token !== secreto) return ContentService.createTextOutput('Forbidden');
    var u = JSON.parse(e.postData.contents);
    if (TG_yaVisto_('u' + u.update_id)) return TG_ok_();
    TG_manejar_(u);
  } catch (err) {
    console.error('Telegram doPost: ' + (err && err.stack || err));
  }
  return TG_ok_();
}

/** Respuesta 200 directa (la de ContentService redirige y Telegram lo toma como error y reintenta). */
function TG_ok_() {
  return HtmlService.createHtmlOutput('OK');
}

function doGet() {
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">🤖 Asistente de Cuentas por Cobrar y Pagar: activo.</p>');
}

/** true si la clave ya se vio (y la marca). */
function TG_yaVisto_(clave) {
  var c = CacheService.getScriptCache();
  if (c.get('tg_v_' + clave)) return true;
  c.put('tg_v_' + clave, '1', 21600);
  return false;
}

function TG_manejar_(u) {
  var ss = TG_ss_();
  if (u.callback_query) return TG_alBoton_(ss, u.callback_query);
  var m = u.message;
  if (!m || !m.chat) return;
  var chatId = String(m.chat.id);
  var grupo = m.chat.type !== 'private';
  var texto = String(m.text || m.caption || '').trim();
  var bot = PropertiesService.getScriptProperties().getProperty(TG_PROP_.BOT) || '';
  // En grupos solo contesta comandos, menciones o respuestas a sus mensajes.
  if (grupo) {
    var mencion = bot && texto.toLowerCase().indexOf('@' + bot.toLowerCase()) !== -1;
    var respuesta = m.reply_to_message && m.reply_to_message.from && m.reply_to_message.from.username === bot;
    if (!mencion && !respuesta && texto.charAt(0) !== '/') return;
    if (bot) texto = texto.replace(new RegExp('@' + bot, 'ig'), '').trim();
  }
  var nombre = [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(' ') || (m.chat.title || '');
  var usuario = TG_usuario_(ss, chatId);

  // ¿No autorizado? Puede estar mandando el código de vinculación.
  if (!usuario || !usuario.activo) {
    if (TG_usarCodigo_(texto)) {
      var rol = TG_admins_(ss).length ? 'usuario' : 'admin';
      usuario = TG_agregarUsuario_(ss, chatId, nombre, rol);
      TG_enviar_(chatId, '✅ <b>¡Listo, ' + TG_esc_(nombre || 'bienvenido') + '!</b> Su Telegram quedó vinculado' + (rol === 'admin' ? ' como <b>administrador</b>' : '') + '.\n\n' + TG_textoBienvenida_(), TG_tecladoFijo_());
      TG_enviar_(chatId, TG_textoMenu_(), TG_tecladoMenu_());
      TG_admins_(ss).forEach(function (a) { if (a.chatId !== chatId) TG_enviar_(a.chatId, '👤 ' + TG_esc_(nombre) + ' (ID ' + chatId + ') se vinculó al bot con un código.'); });
      return;
    }
    if (usuario && !usuario.activo) { TG_enviar_(chatId, '🔒 Su acceso está desactivado. Pida al administrador que lo active.'); return; }
    TG_enviar_(chatId, '🔒 <b>Asistente privado del grupo.</b>\nSu ID de Telegram es <code>' + chatId + '</code>.\n' +
      'Para usarlo envíe el código de 6 dígitos que da la hoja de Cobranzas (menú 🤖 Telegram → Vincular), o espere a que un administrador lo autorice.');
    if (!TG_yaVisto_('pide' + chatId)) {
      var k = TG_guardarBoton_({ t: 'alta', chat: chatId, nombre: nombre }, 86400);
      TG_admins_(ss).forEach(function (a) {
        TG_enviar_(a.chatId, '👤 <b>' + TG_esc_(nombre || 'Alguien') + '</b> (ID ' + chatId + (m.from && m.from.username ? ', @' + TG_esc_(m.from.username) : '') + ') quiere usar el bot.',
          [[{ text: '✅ Autorizar', callback_data: 'k:' + k }, { text: '🚫 Ignorar', callback_data: 'x' }]]);
      });
    }
    return;
  }
  TG_marcarUso_(ss, usuario);
  var ctx = { ss: ss, chatId: chatId, usuario: usuario, nombre: nombre, msgId: m.message_id };
  // ↩️ Respondió (citó) un mensaje: la IA recibe ese texto (o solo la parte que citó) para saber de qué habla.
  if (m.reply_to_message) ctx.citado = (m.quote && m.quote.text) || m.reply_to_message.text || m.reply_to_message.caption || '';
  // 🧩 "1 6 9" mientras el robot de Quesito espera la respuesta de un captcha.
  var capt = m.text && TGC_respuesta_(texto);
  if (capt) return TG_enviar_(chatId, capt);
  // 🔎 "ruc CORPORACION GRANIX": RUC por nombre (tus facturas y el padrón de SUNAT, RucPorNombre.js).
  if (m.text && /^ruc\s+(de\s+|del\s+)?[a-záéíóúñ&]/i.test(texto)) return TG_enviar_(chatId, RPN_consulta_(ss, texto, { origen: 'tg', chat: chatId }));

  // Archivos: fotos, documentos, notas de voz y audios.
  if (m.photo || m.document || m.voice || m.audio || m.video_note) return TG_alArchivo_(ctx, m, texto);
  if (m.sticker) { TG_enviar_(chatId, '😊'); return; }
  if (m.location || m.contact || m.video) { TG_enviar_(chatId, 'Por ahora entiendo textos, fotos, PDF, Excel y notas de voz.'); return; }
  if (!texto) return;

  // Un asistente paso a paso que espera un dato (ej. el texto de un recordatorio).
  var ses = TG_sesion_(chatId);
  if (ses.esperando && texto.charAt(0) !== '/') return TG_alEsperado_(ctx, ses, texto);

  if (ses.procPend && texto.charAt(0) !== '/' && TGP_nombreDirectoTG_(ctx, ses, texto, m)) return;   // 🧾 "21-10-26 Edit"
  if (/^\/?(deshacer|desh[aá]z(lo)?|deshaga)\b/i.test(texto)) return TGU_preguntarTG_(ctx);   // ↩️ la última acción, todo
  if (texto.charAt(0) === '/') return TG_comando_(ctx, texto);
  var atajo = TG_ATAJOS_[texto];
  if (atajo) return TG_comando_(ctx, atajo);
  if (TGQ_RX_.test(texto)) return TGQ_tg_(ctx, texto);   // 📋 "procesados hoy sonia" (TG_Procesados.js)
  if (TGG_datoTG_(ctx, texto)) return;   // 🚚 dato suelto para la guía abierta ("es privado", "peso 30000")
  if (TGG_atajoTG_(ctx, texto)) return;   // 🚚 "emite la guía de remisión" (antes o después de las fotos) · "listo"
  if (TGR_atajoTG_(ctx, texto)) return;   // 🧾 "emite la retención de F001-215" (o citando el mensaje)
  TG_preguntar_(ctx, texto, []);
}

/* ============================================================ sesión (memoria de la conversación) */

function TG_sesion_(chatId) {
  var s = CacheService.getScriptCache().get('tg_s_' + chatId);
  var ses = s ? JSON.parse(s) : null;
  return ses || { hist: [], adj: [], esperando: null };
}

function TG_guardarSesion_(chatId, ses) {
  ses.hist = (ses.hist || []).slice(-6).map(function (h) { return { p: String(h.p).slice(0, 600), r: String(h.r).slice(0, 1500) }; });
  ses.adj = (ses.adj || []).slice(-8);
  var s = JSON.stringify(ses);
  if (s.length > 90000) { ses.hist = ses.hist.slice(-2); s = JSON.stringify(ses); }
  CacheService.getScriptCache().put('tg_s_' + chatId, s, 21600);   // la conversación se recuerda 6 horas
}

/* ============================================================ comandos */

// Botones del teclado fijo (abajo del chat) → comando.
var TG_ATAJOS_ = {
  '📊 Resumen': '/resumen', '📋 Menú': '/menu', '💰 Por cobrar': '/cobrar', '💸 Por pagar': '/pagar',
  '📬 SUNAT': '/notificaciones', '⬇ Descargar': '/descargar', '❓ Ayuda': '/ayuda',
};

function TG_tecladoFijo_() {
  return { keyboard: [[{ text: '📊 Resumen' }, { text: '💰 Por cobrar' }, { text: '💸 Por pagar' }],
    [{ text: '📬 SUNAT' }, { text: '⬇ Descargar' }, { text: '📋 Menú' }]],
    resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Pregunte lo que quiera o mande una foto…' };
}

function TG_tecladoMenu_() {
  return [
    [{ text: '📊 Resumen de hoy', callback_data: 'c:resumen' }],
    [{ text: '💰 Por cobrar', callback_data: 'c:cobrar' }, { text: '💸 Por pagar', callback_data: 'c:pagar' }, { text: '⏰ Vencidas', callback_data: 'c:vencidas' }],
    [{ text: '📬 Buzón SUNAT', callback_data: 'c:notificaciones' }, { text: '🏦 Detracciones', callback_data: 'c:detracciones' }],
    [{ text: '🧾 Retenciones', callback_data: 'c:retenciones' }, { text: '🧑‍💼 Honorarios', callback_data: 'c:honorarios' }],
    [{ text: '⚙️ Estado descargas', callback_data: 'c:estado' }, { text: '⬇ Descargar de SUNAT', callback_data: 'c:descargar' }],
    [{ text: '🔄 Recalcular cobranzas', callback_data: 'c:actualizar' }, { text: '💱 Tipo de cambio', callback_data: 'c:tc' }],
    [{ text: '⏰ Recordatorios', callback_data: 'c:recordatorios' }, { text: '🔔 Mis avisos', callback_data: 'c:avisos' }, { text: '❓ Ayuda', callback_data: 'c:ayuda' }],
  ];
}

function TG_textoMenu_() {
  return '📋 <b>Menú</b> · elija una opción o simplemente <b>escríbame</b> su pregunta, mande una <b>foto/PDF</b> o una <b>nota de voz</b>.';
}

function TG_textoBienvenida_() {
  return 'Soy el asistente de <b>Cuentas por Cobrar y Pagar</b> del grupo. Puede:\n' +
    '💬 <b>Preguntarme lo que quiera</b>: <i>"¿cuánto nos debe Granix?"</i>, <i>"facturas vencidas de JENILE"</i>, <i>"¿se pagó la detracción de la F002-6757?"</i>\n' +
    '📷 <b>Mandar fotos o PDF</b> de vouchers, facturas o notificaciones (con o sin pregunta): los leo, los cruzo y le digo qué falta.\n' +
    '🎤 <b>Hablarme</b> con una nota de voz.\n' +
    '⬇ <b>Pedir descargas a SUNAT</b> y ver si las automáticas corrieron.\n' +
    '🔔 <b>Recibir avisos</b>: notificaciones SUNAT nuevas, detracciones, retenciones, vencimientos, errores.\n' +
    '⏰ <b>Recordatorios</b>: <i>"recuérdame el lunes 9am pagar AFP"</i>.';
}

function TG_comando_(ctx, texto) {
  var m = texto.replace(/^\//, '').split(/\s+/);
  var cmd = m[0].toLowerCase().replace(/@.*$/, '');
  var arg = m.slice(1).join(' ').trim();
  var chatId = ctx.chatId;
  switch (cmd) {
    case 'start':
      TG_enviar_(chatId, '👋 <b>Hola' + (ctx.nombre ? ', ' + TG_esc_(ctx.nombre.split(' ')[0]) : '') + '.</b> ' + TG_textoBienvenida_(), TG_tecladoFijo_());
      return TG_enviar_(chatId, TG_textoMenu_(), TG_tecladoMenu_());
    case 'menu': return TG_enviar_(chatId, TG_textoMenu_(), TG_tecladoMenu_());
    case 'ayuda': case 'help': return TG_enviar_(chatId, TG_textoAyuda_(), [[{ text: '📋 Menú', callback_data: 'c:menu' }]]);
    case 'resumen': case 'hoy': return TG_enviarResumen_(ctx);
    case 'cobrar': return TG_enviarCartera_(ctx, 'Por cobrar', arg);
    case 'pagar': return TG_enviarCartera_(ctx, 'Por pagar', arg);
    case 'vencidas': return TG_enviarVencidas_(ctx, arg);
    case 'vencimientos': case 'obligaciones': case 'cronograma': return TGV_comando_(ctx, arg);
    case 'notificaciones': case 'buzon': case 'sunat': return TG_enviarNotificaciones_(ctx, arg);
    case 'detracciones': return TG_enviarDetracciones_(ctx, arg);
    case 'retenciones': return TG_enviarRetenciones_(ctx, arg);
    case 'emitir': case 'retener': case 'cre': return TGR_comandoTG_(ctx);   // 🧾 comprobantes de retención por emitir
    case 'emitirwa': return TGR_emitirWA_(ctx, arg);
    case 'guia': case 'gre': return TGG_atajoTG_(ctx, '/guia ' + arg);   // 🚚 guía de remisión por SUNAT
    case 'pdf': if (TGG_atajoTG_(ctx, '/pdf guía ' + arg)) return; break;   // 📄 PDF de una guía emitida
    case 'procesados': case 'procesado': return TGQ_tg_(ctx, 'procesados ' + (arg || 'hoy'));   // 📋 vouchers procesados por tanda
    case 'honorarios': return TG_enviarHonorarios_(ctx, arg);
    case 'estado': return TG_enviarEstado_(ctx);
    case 'descargar': return TG_asistenteDescarga_(ctx, null);
    case 'sire': return TGS_comandoTG_(ctx, arg);   // ⚡ SIRE solo reporte (rápido): /sire granix 202601-202609
    case 'ruc': return TG_enviar_(chatId, RPN_consulta_(ctx.ss, arg, { origen: 'tg', chat: chatId }));   // 🔎 RUC por nombre
    case 'actualizar': return TG_actualizarCobranzas_(ctx);
    case 'tc': case 'cambio': return TG_enviarTipoCambio_(ctx);
    case 'recordatorios': return TG_enviarRecordatorios_(ctx);
    case 'recordar': case 'recuerdame':
      if (arg) return TG_preguntar_(ctx, 'Crea un recordatorio: ' + arg, []);
      var ses = TG_sesion_(chatId); ses.esperando = { tipo: 'recordar' }; TG_guardarSesion_(chatId, ses);
      return TG_enviar_(chatId, '⏰ ¿Qué le recuerdo y cuándo? Ej.: <i>"el 20 a las 9am declarar IGV de GRANIX"</i>');
    case 'avisos': return TG_enviarAvisos_(ctx, null);
    case 'olvidar': case 'nuevo': case 'reset':
      TG_guardarSesion_(chatId, { hist: [], adj: [], esperando: null });
      return TG_enviar_(chatId, '🧹 Listo, empezamos una conversación nueva (olvidé lo anterior y los archivos que me mandó).');
    case 'id': return TG_enviar_(chatId, 'Su ID de Telegram: <code>' + chatId + '</code>');
    case 'usuarios':
      if (ctx.usuario.rol !== 'admin') return TG_enviar_(chatId, 'Solo para administradores.');
      return TG_enviarUsuarios_(ctx);
    case 'buscar': if (arg) return TG_preguntar_(ctx, 'Busca en todas las fuentes: ' + arg, []); break;
    case 'voucher': case 'vouchers': {
      // /voucher Originales!2326 [Fotos!12 …] [original] [diag] → manda la foto directo (sin IA); diag = paso a paso
      var fil = TG_filasVoucherEn_(ctx.ss, arg);
      if (!fil.length) return TG_enviar_(chatId, 'Escriba la fila del voucher, por ejemplo: <code>/voucher Originales!2326</code>  (agregue <code>original</code> para el PDF completo o <code>diag</code> para ver el detalle).');
      var resto = arg.replace(/[^\s!]+\s*!\s*\d+/g, ' ');
      return TG_mandarVouchers_(ctx, fil, /\b(original|pdf|completo)\b/i.test(resto) ? 'original' : 'imagen', /\bdiag/i.test(resto));
    }
  }
  if (arg || cmd.length > 2) return TG_preguntar_(ctx, texto.replace(/^\//, ''), []);
  return TG_enviar_(chatId, 'No conozco ese comando. ' + TG_textoMenu_(), TG_tecladoMenu_());
}

function TG_textoAyuda_() {
  return '❓ <b>Qué puedo hacer</b>\n\n' +
    '💬 <b>Pregúnteme en sus palabras</b> (texto o 🎤 voz). Busco en Cuentas por Cobrar y Pagar, vouchers, SIRE, retenciones, detracciones, honorarios, el Buzón SUNAT y las descargas. Ejemplos:\n' +
    '• <i>¿Cuánto nos debe GRANIX y desde cuándo?</i>\n• <i>Facturas de ALIF por pagar con su detracción</i>\n• <i>¿Qué notificaciones llegaron esta semana a JENILE?</i>\n' +
    '• <i>¿Cuánto IGV por pagar tiene M&amp;D en setiembre?</i>\n• <i>Mándame la constancia de la detracción de la F002-6757</i>\n• <i>Concilia los vouchers sin usar de BKF</i>\n\n' +
    '📷 <b>Fotos y PDF</b>: mande un voucher, factura, estado de cuenta o notificación. Si escribe algo junto a la foto, respondo eso; si no, le pregunto qué hacer ' +
    '(analizar y cruzar, o registrarlo en el Sistema de Vouchers). Si falta un dato en la hoja de vouchers, se lo propongo y usted toca ✅ para escribirlo.\n\n' +
    '📊 Las listas largas se las mando también en <b>Excel</b>.\n' +
    '⬇ <b>/descargar</b> pide a SUNAT (SIRE, retenciones, honorarios, buzón, detracciones) · <b>/estado</b> dice si las automáticas corrieron.\n' +
    '⚡ <b>/sire</b> baja solo el reporte del SIRE, rápido (ej. <code>/sire granix 202601-202609</code>, <code>/sire todas mes anterior</code>).\n' +
    '🔔 <b>/avisos</b> elige qué le aviso solo · ⏰ <b>/recordatorios</b> · 🧹 <b>/olvidar</b> empieza de cero.\n\n' +
    '🔒 Solo consulto y propongo: nunca pago ni presento nada en SUNAT, y lo que se escribe en las hojas siempre se lo pregunto antes.';
}

/** Respuesta a algo que el bot estaba esperando (paso a paso). */
function TG_alEsperado_(ctx, ses, texto) {
  var e = ses.esperando;
  ses.esperando = null;
  TG_guardarSesion_(ctx.chatId, ses);
  if (e.tipo === 'recordar') return TG_preguntar_(ctx, 'Crea un recordatorio: ' + texto, []);
  if (e.tipo === 'pregunta_adj') return TG_preguntar_(ctx, texto, e.adj || []);
  if (e.tipo === 'entrega') return TGE_alTextoTG_(ctx, e, texto);
  if (e.tipo === 'procnombre') return TGP_alNombreTG_(ctx, e, texto);
  if (e.tipo === 'gre') { if (TGG_editarTG_(ctx, e.id, texto, e.pregunta)) return; return TG_preguntar_(ctx, texto, []); }   // 🚚 ✏️ corregir la guía
  return TG_preguntar_(ctx, texto, []);
}

/* ============================================================ archivos (fotos, PDF, voz) */

function TG_alArchivo_(ctx, m, texto) {
  var chatId = ctx.chatId;
  var fileId, nombre, voz = false;
  if (m.photo) { var g = m.photo[m.photo.length - 1]; fileId = g.file_id; nombre = 'foto ' + m.message_id + '.jpg'; }
  else if (m.document) { fileId = m.document.file_id; nombre = m.document.file_name || ('archivo ' + m.message_id); }
  else if (m.voice || m.audio || m.video_note) { var a = m.voice || m.audio || m.video_note; fileId = a.file_id; nombre = (m.audio && m.audio.file_name) || ('voz ' + m.message_id + '.ogg'); voz = true; }
  var blob;
  try { blob = TG_bajarArchivo_(fileId, nombre); } catch (e) { return TG_enviar_(chatId, '⚠️ No pude bajar el archivo: ' + TG_esc_(e.message)); }

  if (voz) {
    TG_accion_(chatId, 'typing');
    var dicho;
    try { dicho = TG_transcribir_(ctx.ss, blob); } catch (e) { return TG_enviar_(chatId, '⚠️ No pude entender el audio: ' + TG_esc_(e.message) + '\nPuede escribirme la pregunta.'); }
    if (!dicho) return TG_enviar_(chatId, '🎤 No escuché nada claro. ¿Me lo repite o lo escribe?');
    TG_enviar_(chatId, '🎤 <i>' + TG_esc_(dicho) + '</i>', null, { silencioso: true, responderA: ctx.msgId });
    var ses0 = TG_sesion_(chatId);
    if (ses0.esperando) return TG_alEsperado_(ctx, ses0, dicho);
    if (TG_ATAJOS_[dicho]) return TG_comando_(ctx, TG_ATAJOS_[dicho]);
    if (TGG_datoTG_(ctx, dicho)) return;   // 🚚 lo dicho es para la guía abierta
    return TG_preguntar_(ctx, dicho, []);
  }

  var mime = blob.getContentType() || TG_mimePorNombre_(nombre) || 'application/octet-stream';
  if (!/^image\/|pdf|spreadsheet|csv|excel|text\//i.test(mime) && !/\.(xlsx|csv|txt|pdf|jpe?g|png)$/i.test(nombre)) {
    return TG_enviar_(chatId, '⚠️ Ese tipo de archivo (' + TG_esc_(mime) + ') no lo puedo leer. Mande foto, PDF, Excel (.xlsx), CSV o texto.');
  }
  // Se guarda en la carpeta temporal de importaciones (se borra sola a los 7 días), como el 💬 Chat de la hoja.
  var grupo = m.media_group_id ? 'g' + m.media_group_id : 'm' + m.message_id;
  var marca = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmm');
  var f = IMP_carpeta_(ctx.ss).createFile(blob.setName('telegram ' + grupo + ' ' + marca + ' - ' + nombre));
  var adj = { id: f.getId(), nombre: nombre, mime: mime, grupo: grupo, foto: !!m.photo, t: Date.now() };
  var ses = TG_sesion_(chatId);
  ses.adj = (ses.adj || []).concat([adj]);
  TG_guardarSesion_(chatId, ses);
  // 🚚 Antes escribió "emite guía": los archivos se juntan para la guía (sin preguntar qué hacer) hasta "listo".
  if (ses.greEsp && Date.now() - ses.greEsp < 10 * 60000 && !texto) {
    if (!m.media_group_id || !TG_yaVisto_('albumgre' + m.media_group_id))
      TG_enviar_(chatId, '📎 Recibido para la guía. Cuando termine de mandar todo escriba <b>listo</b>.', null, { silencioso: true });
    return;
  }

  if (texto && TGG_PIDE_RX_.test(texto)) return TGG_desdeAdjTG_(ctx, TG_adjDelGrupo_(ctx.ss, grupo, adj), texto);   // 🚚 fotos + "guía"
  if (texto) return TG_preguntar_(ctx, texto, TG_adjDelGrupo_(ctx.ss, grupo, adj));
  // Sin pregunta: se pregunta qué hacer (una sola vez por álbum de fotos).
  if (m.media_group_id && TG_yaVisto_('album' + m.media_group_id)) return;
  var k = TG_guardarBoton_({ t: 'adj', grupo: grupo, adj: adj });
  TG_enviar_(chatId, '📎 <b>Recibí ' + (m.media_group_id ? 'sus archivos' : (m.photo ? 'la foto' : 'el archivo')) + '.</b> ¿Qué hago?', [
    [{ text: '🧾 Procesar documento (registrar y completar factura)', callback_data: 'k:' + k + ':proc' }],
    [{ text: '🔎 Analizar y cruzar con las hojas', callback_data: 'k:' + k + ':ana' }],
    [{ text: '📥 Registrar como voucher', callback_data: 'k:' + k + ':vou' }],
    TGG_abierta_(chatId) ? [{ text: '🚚 Agregar a la guía ' + TGG_abierta_(chatId), callback_data: 'k:' + k + ':grea' }, { text: '🚚 Guía nueva', callback_data: 'k:' + k + ':gre' }]
      : [{ text: '🚚 Guía de remisión (SUNAT)', callback_data: 'k:' + k + ':gre' }],
    [{ text: '✍️ Le escribo mi pregunta', callback_data: 'k:' + k + ':preg' }],
  ], { responderA: ctx.msgId });
}

/** Todos los archivos de un álbum (llegan en mensajes separados). */
function TG_adjDelGrupo_(ss, grupo, uno) {
  if (grupo.charAt(0) !== 'g') return uno ? [uno] : [];
  var res = [];
  var it = IMP_carpeta_(ss).searchFiles('title contains "telegram ' + grupo + ' "');
  while (it.hasNext()) {
    var f = it.next();
    var n = f.getName().replace(/^telegram \S+ \S+ \S+ - /, '');
    res.push({ id: f.getId(), nombre: n, mime: f.getMimeType(), foto: /^image\//.test(f.getMimeType()) });
  }
  if (uno && !res.some(function (a) { return a.id === uno.id; })) res.push(uno);
  return res.slice(0, 10);
}

/** Nota de voz → texto (Gemini entiende audio). */
function TG_transcribir_(ss, blob) {
  var props = PropertiesService.getScriptProperties();
  var clave = props.getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)');
  if (!clave) throw new Error('para entender audios hace falta la clave de Gemini (pestaña 🤝 Conciliar con IA → 🔑).');
  var mime = blob.getContentType();
  if (!/^audio\//.test(mime)) mime = 'audio/ogg';
  var t = IA_llamar_({ proveedor: 'Gemini (Google)', clave: clave, json: false, maxTokens: 1500,
    sistema: 'Transcribe exactamente lo que dice el audio, en español de Perú, sin agregar nada. Si no se entiende nada responde vacío.',
    texto: 'Transcribe este audio.', adjunto: { mime: mime, base64: Utilities.base64Encode(blob.getBytes()) } });
  return String(t || '').replace(/^["“]|["”]$/g, '').trim();
}

/** 📥 Copia los archivos a la carpeta de entrada del Sistema de Vouchers (su proceso automático los registra). */
function TG_registrarVouchers_(ctx, adjs) {
  var cfg = TG_cfg_(ctx.ss);
  var n = 0, errores = [], hechos = [];
  adjs.forEach(function (a) {
    try {
      var esFoto = a.pestana ? a.pestana === 'foto' : (a.foto || /^image\//.test(a.mime));   // 📂 elegida en "¿De quién son?"
      var destino = DriveApp.getFolderById(esFoto ? cfg.carpetaFotos : cfg.carpetaOriginales);
      var copia = DriveApp.getFileById(a.id).makeCopy(a.nombre, destino);
      hechos.push({ id: copia.getId(), nombre: a.nombre });
      n++;
    } catch (e) { errores.push(a.nombre + ': ' + e.message); }
  });
  if (hechos.length) TGU_anotar_(ctx.chatId, { desc: '📥 ' + hechos.length + ' voucher(s) a la hoja de Vouchers: ' + hechos.map(function (h) { return h.nombre; }).slice(0, 3).join(', '), archivos: hechos });
  // ⚡ Que la hoja de Vouchers los procese YA y se responda con el resultado (sin esperar su vuelta de 10 min).
  if (hechos.length && PropertiesService.getScriptProperties().getProperty('TGP_PROCESAR_URL')) {
    TG_accion_(ctx.chatId, 'typing');
    TGP_procesarYa_();
    var idx = {};
    try { idx = TGU_indiceArchivos_(ctx.ss); } catch (e) {}
    var lineas = hechos.map(function (h) {
      var f = idx[h.nombre] || [];
      if (!f.length) return '⏳ ' + TG_esc_(h.nombre) + ': aún en cola (máx. 10 min)';
      return f.map(function (x) {
        return /^\[DUPLICADO\]/.test(x.op) ? '⚠️ ' + x.hoja + '!' + x.fila + ': ya estaba registrado (duplicado)'
          : /^\[/.test(x.op) ? '❌ ' + TG_esc_(h.nombre) + ': no se encontró un voucher legible'
          : '✅ <b>' + x.hoja + '!' + x.fila + '</b> · op ' + TG_esc_(x.op) + ' · ' + Number(x.monto || 0).toFixed(2);
      }).join('\n');
    });
    TG_enviar_(ctx.chatId, '📋 <b>Resultado</b>\n' + lineas.join('\n'), [[{ text: '↩️ Deshacer', callback_data: 'k:' + TG_guardarBoton_({ t: 'deshacer' }) }]]);
    return;
  }
  TG_enviar_(ctx.chatId, (n ? '📥 <b>' + n + ' archivo(s) enviados al Sistema de Vouchers</b> (carpeta de entrada de ' +
    (adjs.some(function (a) { return a.foto; }) ? 'fotos' : 'originales') + '). Se registran en la próxima vuelta automática de esa hoja; ' +
    'después aparecen aquí y en Cobranzas.' : '') + (errores.length ? '\n⚠️ ' + TG_esc_(errores.join('; ')) : ''),
    [[{ text: '🔎 Analizarlos también', callback_data: 'k:' + TG_guardarBoton_({ t: 'adjs', adjs: adjs }) + ':ana' }]]);
}

/* ============================================================ botones */

function TG_alBoton_(ss, q) {
  var chatId = String(q.message && q.message.chat ? q.message.chat.id : q.from.id);
  var d = String(q.data || '');
  var usuario = TG_usuario_(ss, String(q.from.id)) || TG_usuario_(ss, chatId);
  if (!usuario || !usuario.activo) { TG_responderBoton_(q.id, '🔒 No autorizado', true); return; }
  if (TG_yaVisto_('b' + q.id)) return;
  var ctx = { ss: ss, chatId: chatId, usuario: usuario, nombre: q.from.first_name || '', msgId: q.message && q.message.message_id };
  if (d === 'x') { TG_responderBoton_(q.id, 'Listo'); TG_llamar_('editMessageReplyMarkup', { chat_id: chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } }); return; }
  if (d.indexOf('c:') === 0) { TG_responderBoton_(q.id); return TG_comando_(ctx, '/' + d.slice(2)); }
  if (d.indexOf('av:') === 0) { TG_responderBoton_(q.id); return TG_enviarAvisos_(ctx, d.slice(3)); }
  if (d.indexOf('dw:') === 0) { TG_responderBoton_(q.id); return TG_asistenteDescarga_(ctx, d.slice(3)); }
  if (d.indexOf('f:') === 0) { TG_responderBoton_(q.id, '📎 Enviando…'); return TG_mandarArchivo_(ctx, d.slice(2), ''); }
  if (d.indexOf('v:') === 0) { TG_responderBoton_(q.id, '🖼 Enviando el voucher…'); return TG_mandarVoucher_(ctx, d.slice(2), 'imagen'); }
  if (d.indexOf('rr:') === 0) { TG_responderBoton_(q.id); return TG_reintentarRun_(ctx, { id: d.slice(3), nombre: 'la descarga' }); }
  if (d.indexOf('emp:') === 0) {   // cartera de una empresa: emp:<lado>:<ruc>
    TG_responderBoton_(q.id);
    var p = d.split(':');
    return TG_enviarCartera_(ctx, p[1] === 'c' ? 'Por cobrar' : 'Por pagar', p[2]);
  }
  if (d.indexOf('k:') !== 0) { TG_responderBoton_(q.id); return; }
  var partes = d.split(':');
  var datos = TG_leerBoton_(partes[1]);
  var op = partes[2] || '';
  if (!datos) { TG_responderBoton_(q.id, '⌛ Este botón ya venció (duran 6 horas). Vuelva a pedirlo.', true); return; }
  TG_responderBoton_(q.id);
  switch (datos.t) {
    case 'alta':
      if (usuario.rol !== 'admin') return TG_enviar_(chatId, 'Solo un administrador puede autorizar.');
      TG_agregarUsuario_(ss, datos.chat, datos.nombre, 'usuario');
      TG_editar_(chatId, ctx.msgId, '✅ ' + TG_esc_(datos.nombre) + ' (ID ' + datos.chat + ') quedó autorizado.');
      TG_enviar_(datos.chat, '✅ <b>Un administrador le dio acceso.</b>\n\n' + TG_textoBienvenida_(), TG_tecladoFijo_());
      return TG_enviar_(datos.chat, TG_textoMenu_(), TG_tecladoMenu_());
    case 'baja':
      if (usuario.rol !== 'admin') return;
      TG_desactivarUsuario_(ss, datos.chat);
      return TG_editar_(chatId, ctx.msgId, '🚫 ' + TG_esc_(datos.nombre) + ' ya no puede usar el bot (puede reactivarlo en la pestaña ' + TG_HOJA_ + ').');
    case 'adj': case 'adjs':
      var adjs = datos.adjs || TG_adjDelGrupo_(ss, datos.grupo, datos.adj);
      TG_llamar_('editMessageReplyMarkup', { chat_id: chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
      if (op === 'vou' && TGP_hayVariasPaginas_(adjs)) {   // PDF de varias páginas: registrar solo la del voucher
        TG_enviar_(ctx.chatId, '📄 El PDF tiene varias páginas: lo reviso con IA para registrar <b>solo el voucher</b> y completar la factura.');
        return TGP_iniciarTG_(ctx, adjs);
      }
      if (op === 'vou') return TGE_preguntarTG_(ctx, adjs);   // 🏷 primero: ¿de quién son?
      if (op === 'proc') return TGP_iniciarTG_(ctx, adjs);
      if (op === 'gre') return TGG_desdeAdjTG_(ctx, adjs, '');
      if (op === 'grea') return TGG_agregarTG_(ctx, adjs);
      if (op === 'preg') {
        var ses = TG_sesion_(chatId); ses.esperando = { tipo: 'pregunta_adj', adj: adjs }; TG_guardarSesion_(chatId, ses);
        return TG_enviar_(chatId, '✍️ Escriba (o diga 🎤) su pregunta sobre ' + (adjs.length > 1 ? 'esos ' + adjs.length + ' archivos' : 'ese archivo') + '.');
      }
      return TG_preguntar_(ctx, '', adjs);
    case 'sug': return TG_preguntar_(ctx, datos.texto, []);
    case 'cambios': return TG_aplicarCambios_(ctx, datos, op);
    case 'rucelige': return TGQ_eligeTG_(ctx, datos, op);   // 🤔 elegir el RUC entre opciones (TG_Procesados.js)
    case 'deshacer': return TG_deshacerCambios_(ctx);
    case 'archivo': return TG_mandarArchivo_(ctx, datos.id, datos.titulo);
    case 'descarga': return TG_confirmarDescarga_(ctx, datos, op);
    case 'venc': return TGV_alBoton_(ctx, datos);
    case 'entrega': return TGE_alBotonTG_(ctx, datos, op, partes[1]);
    case 'procesar': return TGP_alBotonTG_(ctx, op, partes[1]);
    case 'deshacer2': return TGU_alBotonTG_(ctx, datos, op);
    case 'cre': return TGR_alBotonTG_(ctx, datos, op, partes[1]);   // 🧾 emitir comprobante de retención
    case 'gre': return TGG_alBotonTG_(ctx, datos, op);   // 🚚 guía de remisión por SUNAT
    case 'rerun': return TG_reintentarRun_(ctx, datos);
    case 'recq': return TG_quitarRecordatorio_(ctx, datos.id);
    case 'excel': return TG_mandarExcel_(ctx, datos);
    case 'cartxls': return TG_excelCartera_(ctx, datos);
  }
}

function TG_enviarUsuarios_(ctx) {
  var us = TG_usuarios_(ctx.ss);
  var filas = us.map(function (u) {
    var k = TG_guardarBoton_({ t: 'baja', chat: u.chatId, nombre: u.nombre });
    return [{ text: (u.activo ? '🟢 ' : '⚪ ') + u.nombre + ' · ' + u.rol + (u.activo && u.chatId !== ctx.chatId ? '  (🚫 quitar)' : ''), callback_data: u.activo && u.chatId !== ctx.chatId ? 'k:' + k : 'x' }];
  });
  TG_enviar_(ctx.chatId, '👥 <b>Personas con acceso</b> (' + us.filter(function (u) { return u.activo; }).length + ' activas). Toque una para quitarle el acceso. ' +
    'Para dar acceso: menú 🤖 Telegram → Vincular en la hoja, o autorice cuando le llegue la solicitud.', filas);
}
