// ============================================================
// INTEGRACION CON TELEGRAM
// ------------------------------------------------------------
// Flujo: Telegram llama a doPost(e) (webhook) cada vez que alguien manda
// un mensaje al bot -> validamos token secreto + chat autorizado ->
// descargamos la foto/PDF -> lo guardamos en la carpeta "Nuevos" (la
// misma que ya usa el escaneo manual/automatico) -> lo procesamos con la
// MISMA logica de Gemini que ya funciona -> respondemos en el chat con
// el resultado.
//
// El secreto del webhook viaja como query param (?token=...) porque
// Apps Script NO permite leer headers HTTP custom en doPost, asi que no
// podemos usar el "secret_token" nativo de Telegram por header.
// ============================================================

async function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (!CFG.TELEGRAM_WEBHOOK_SECRET || params.token !== CFG.TELEGRAM_WEBHOOK_SECRET) {
      Logger.log('doPost rechazado: token de webhook invalido o ausente.');
      return ContentService.createTextOutput('Forbidden');
    }

    const update = JSON.parse(e.postData.contents);

    if (!yaProcesadoUpdateTelegram(update.update_id)) {
      marcarUpdateTelegramProcesado(update.update_id);
      await manejarUpdateTelegram(update);
    } else {
      Logger.log('Update de Telegram duplicado, se ignora: ' + update.update_id);
    }
  } catch (err) {
    Logger.log('ERROR doPost: ' + err.message);
  }
  // Siempre respondemos 200 para que Telegram no siga reintentando.
  return ContentService.createTextOutput('OK');
}

function yaProcesadoUpdateTelegram(updateId) {
  return CacheService.getScriptCache().get('tg_update_' + updateId) !== null;
}

function marcarUpdateTelegramProcesado(updateId) {
  CacheService.getScriptCache().put('tg_update_' + updateId, '1', 21600); // 6 horas
}

// ------------------------------------------------------------
// Nombre del archivo que queda en la columna "Archivo Original".
// Tres capas, en orden:
//   1. Nombre real (solo si se manda como documento sin comprimir).
//   2. El comentario/caption escrito al enviar el archivo (tal cual).
//   3. Fecha + quien lo mando -- para que la columna sirva para lo mismo
//      que antes se hacia a mano (saber que dia y quien trajo el voucher)
//      incluso cuando Telegram no manda ningun nombre.
// ------------------------------------------------------------
function resolverNombreArchivoTelegram_(mensaje, remitenteObj, mimeDoc, esFotoComprimida) {
  if (mensaje.document && mensaje.document.file_name) {
    return mensaje.document.file_name;
  }

  const ext = esFotoComprimida ? '.jpg' : (mimeDoc === 'application/pdf' ? '.pdf' : '.jpg');

  if (mensaje.caption && mensaje.caption.trim()) {
    return sanitizarNombreArchivo_(mensaje.caption) + ext;
  }

  const ahora = new Date();
  const fecha = Utilities.formatDate(ahora, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss');
  const quien = remitenteCorto_(remitenteObj);
  return fecha + '_' + quien + '_voucher' + ext;
}

function remitenteCorto_(from) {
  from = from || {};
  const base = (from.username || from.first_name || 'desconocido').toString();
  return base.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'desconocido';
}

function sanitizarNombreArchivo_(texto) {
  return texto.toString().trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

async function manejarUpdateTelegram(update) {
  // Toques al boton "▶️ Continuar ahora" llegan como callback_query, no
  // como message -- se manejan aparte porque no traen foto/documento.
  if (update.callback_query) {
    await manejarCallbackTelegram_(update.callback_query);
    return;
  }

  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return;

  const chatId    = msg.chat.id;
  const chatIdStr = String(chatId);

  if (CFG.TELEGRAM_ALLOWED_CHAT_IDS.length > 0 && CFG.TELEGRAM_ALLOWED_CHAT_IDS.indexOf(chatIdStr) === -1) {
    Logger.log('Chat no autorizado intento usar el bot: ' + chatIdStr);
    enviarMensajeTelegram(chatId, '🚫 No estas autorizado para usar este bot. Contacta al administrador para que agregue tu chat_id (' + chatIdStr + ').');
    return;
  }

  const from = msg.from || {};
  const remitente = '@' + (from.username || from.first_name || 'desconocido') + ' (id ' + (from.id || chatId) + ')';

  if (msg.text && msg.text.trim().indexOf('/start') === 0) {
    enviarMensajeTelegram(chatId,
      '👋 Envíame la foto o el PDF de un voucher bancario y lo proceso automáticamente en la hoja.\n\n' +
      '📄 / 📸 Usa los botones de abajo para indicar si lo que envías en general es un *comprobante original* ' +
      '(PDF/documento formal) o una *foto* del comprobante. También puedes escribir "original" o "foto" en el ' +
      'comentario de un archivo puntual para anular el modo activo solo esa vez.\n\n' +
      'Si un PDF tiene muchas páginas y no termina en una sola pasada, te aparece un botón "▶️ Continuar ahora" ' +
      '(o escribe /continuar) para seguir al toque en vez de esperar los 10 minutos del proceso automático.',
      tecladoModos_());
    return;
  }

  if (msg.text && /^\/continuar\b/i.test(msg.text.trim())) {
    await continuarProcesamientoDesdeTelegram_(chatId);
    return;
  }

  if (msg.text && esBotonModo_(msg.text)) {
    const modo = msg.text.indexOf('ORIGINAL') !== -1 ? 'original' : 'foto';
    guardarModoChat_(chatIdStr, modo);
    enviarMensajeTelegram(chatId,
      (modo === 'original' ? '📄 Modo ORIGINAL activado.' : '📸 Modo FOTO activado.') +
      ' Los archivos que envíes ahora se guardan asi, salvo que el comentario del archivo diga lo contrario.',
      tecladoModos_());
    return;
  }

  let fileId = null;
  let nombreOriginal = null;
  let esPDF = false;
  let esFotoComprimida = false;
  let mimeDoc = '';

  if (msg.photo && msg.photo.length > 0) {
    // Las fotos comprimidas de Telegram NUNCA traen nombre de archivo (no es
    // un caso raro, es como funciona siempre la API), por eso se resuelve
    // el nombre con resolverNombreArchivoTelegram_ (caption o fecha+remitente).
    const mejor = msg.photo[msg.photo.length - 1]; // Telegram manda varios tamaños, el ultimo es el mas grande
    fileId = mejor.file_id;
    esFotoComprimida = true;
    nombreOriginal = resolverNombreArchivoTelegram_(msg, from, '', true);
  } else if (msg.document) {
    mimeDoc = msg.document.mime_type || '';
    if (mimeDoc === 'application/pdf' || mimeDoc.indexOf('image/') === 0) {
      fileId = msg.document.file_id;
      nombreOriginal = resolverNombreArchivoTelegram_(msg, from, mimeDoc, false);
      esPDF = mimeDoc === 'application/pdf';
    } else {
      enviarMensajeTelegram(chatId, '⚠️ Solo puedo procesar imagenes o PDF de vouchers.');
      return;
    }
  } else {
    return; // otros tipos de mensaje (stickers, audio, etc.) se ignoran en silencio
  }

  const tipo = determinarTipoVoucher_(msg, chatIdStr, esFotoComprimida);

  enviarMensajeTelegram(chatId,
    '📥 Recibido (' + (tipo === 'original' ? 'comprobante original' : 'foto') + '). Procesando el voucher...');

  try {
    const archivo = descargarArchivoTelegram(fileId, nombreOriginal, tipo);
    await procesarArchivoDesdeTelegram(archivo, esPDF, chatId, remitente, tipo);
  } catch (err) {
    Logger.log('ERROR procesando voucher de Telegram: ' + err.message);
    enviarMensajeTelegram(chatId, '❌ No se pudo procesar el voucher: ' + err.message);
  }
}

// ------------------------------------------------------------
// Modo activo por chat (ORIGINAL vs FOTO): botones persistentes +
// override puntual por comentario ("original"/"foto" en el caption).
// Prioridad: comentario del archivo > modo activo del chat > deteccion
// automatica (documento/PDF -> original, foto comprimida -> foto).
// ------------------------------------------------------------
function tecladoModos_() {
  return {
    keyboard: [[{ text: '📄 Modo: ORIGINAL' }, { text: '📸 Modo: FOTO' }]],
    resize_keyboard: true,
    is_persistent: true
  };
}

function esBotonModo_(texto) {
  return /Modo:\s*(ORIGINAL|FOTO)/i.test(texto);
}

function guardarModoChat_(chatIdStr, modo) {
  const props = PropertiesService.getScriptProperties();
  let modos = {};
  try { modos = JSON.parse(props.getProperty('TG_MODOS') || '{}'); } catch (e) {}
  modos[chatIdStr] = modo;
  props.setProperty('TG_MODOS', JSON.stringify(modos));
}

function obtenerModoChat_(chatIdStr) {
  try {
    const modos = JSON.parse(PropertiesService.getScriptProperties().getProperty('TG_MODOS') || '{}');
    return modos[chatIdStr] || null;
  } catch (e) {
    return null;
  }
}

function determinarTipoVoucher_(msg, chatIdStr, esFotoComprimida) {
  const caption = (msg.caption || '').toLowerCase();
  if (/\boriginal\b/.test(caption)) return 'original';
  if (/\bfoto\b/.test(caption)) return 'foto';

  const modo = obtenerModoChat_(chatIdStr);
  if (modo === 'original' || modo === 'foto') return modo;

  return esFotoComprimida ? 'foto' : 'original';
}

function descargarArchivoTelegram(fileId, nombreSugerido, tipo) {
  const urlInfo   = 'https://api.telegram.org/bot' + CFG.TELEGRAM_BOT_TOKEN + '/getFile?file_id=' + encodeURIComponent(fileId);
  const respInfo  = UrlFetchApp.fetch(urlInfo, { muteHttpExceptions: true });
  const info      = JSON.parse(respInfo.getContentText());

  if (!info.ok) {
    const desc = (info.description || '').toLowerCase();
    if (desc.indexOf('too big') > -1) {
      throw new Error('El archivo supera el limite de ' + CFG.TELEGRAM_MAX_MB_ARCHIVO + ' MB que permite la API de Telegram para bots. Comprimelo y vuelve a enviarlo.');
    }
    throw new Error('No se pudo obtener el archivo de Telegram: ' + (info.description || respInfo.getContentText().substring(0, 200)));
  }

  const filePath    = info.result.file_path;
  const urlDescarga = 'https://api.telegram.org/file/bot' + CFG.TELEGRAM_BOT_TOKEN + '/' + filePath;
  const respArchivo = UrlFetchApp.fetch(urlDescarga, { muteHttpExceptions: true });

  if (respArchivo.getResponseCode() !== 200) {
    throw new Error('Fallo al descargar el archivo de Telegram (HTTP ' + respArchivo.getResponseCode() + ')');
  }

  const blob      = respArchivo.getBlob();
  const extension = filePath.indexOf('.') > -1 ? filePath.split('.').pop() : 'bin';
  const nombreFinal = (nombreSugerido && nombreSugerido.indexOf('.') > -1)
    ? nombreSugerido
    : (nombreSugerido + '.' + extension);
  blob.setName(nombreFinal);

  const carpetas = carpetasParaTipo_(tipo);
  const carpeta = DriveApp.getFolderById(carpetas.entrada);
  return carpeta.createFile(blob);
}

async function procesarArchivoDesdeTelegram(archivo, esPDF, chatId, remitente, tipo) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    enviarMensajeTelegram(chatId, '⏳ Hay otro procesamiento en curso. Tu voucher ya quedo guardado y se procesara en la siguiente corrida automatica.');
    return;
  }

  try {
    reiniciarEstadoFormato_();
    const carpetas = carpetasParaTipo_(tipo);
    const hoja = obtenerHoja(carpetas.hojaNombre);
    asegurarCabeceras(hoja);
    const ctx = crearContexto(hoja);

    let mb = 0;
    try { mb = archivo.getSize() / (1024 * 1024); } catch (e) {}
    if (mb > CFG.MAX_MB_ARCHIVO) {
      moverArchivo(archivo, carpetas.entrada, CFG.CARPETA_DESCARTADOS_ID);
      enviarMensajeTelegram(chatId, '⚠️ El archivo pesa ' + mb.toFixed(1) + ' MB, supera el limite de ' + CFG.MAX_MB_ARCHIVO + ' MB. Comprimelo y vuelve a enviarlo.');
      return;
    }

    let resumenes = [];

    if (esPDF) {
      const inicio    = Date.now();
      const limiteTel = CFG.LIMITE_TIEMPO_TELEGRAM_MS;
      const resultado = await procesarArchivoPDF(archivo, ctx, inicio, limiteTel, remitente, carpetas);
      resumenes = resultado.resumenes;
      if (resultado.seDetuvo) {
        guardarChatEsperando_(chatId);
        programarReintentoAutomatico_();
        enviarBotonContinuar_(chatId,
          '⏳ El PDF tiene varias paginas, se proceso una parte. Sigue solo en 1 minuto, o toca el boton para adelantarlo.');
      }
    } else {
      resumenes = procesarArchivoImagen(archivo, ctx, remitente, carpetas);
    }

    enviarResumenTelegram(chatId, resumenes);
  } catch (err) {
    Logger.log('ERROR procesarArchivoDesdeTelegram: ' + err.message);
    enviarMensajeTelegram(chatId, '❌ Error tecnico procesando el voucher: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

function enviarResumenTelegram(chatId, resumenes) {
  if (!resumenes || resumenes.length === 0) {
    enviarMensajeTelegram(chatId, '⚠️ No se detecto ningun voucher legible en el archivo. Revisa la hoja para mas detalle.');
    return;
  }

  const texto = resumenes.map(function (r) {
    const monto = (typeof r.monto === 'number' ? r.monto : parsearMonto(r.monto)).toFixed(2);
    const linea = (r.duplicado ? '⚠️ DUPLICADO' : '✅') + ' ' + (r.banco || 'Banco desconocido') +
                  ' | ' + (r.moneda || '') + ' ' + monto +
                  '\nOp: ' + (r.nOperacion || 's/n');
    return linea;
  }).join('\n\n');

  enviarMensajeTelegram(chatId, texto);
}

// ============================================================
// BOTON "CONTINUAR AHORA" (teclado inline de Telegram)
// ------------------------------------------------------------
// Cuando un PDF largo se corta por el limite de tiempo, en vez de
// obligar a esperar el trigger de 10 min, se ofrece un boton para
// retomarlo al toque. Tambien se puede lograr lo mismo escribiendo
// "/continuar". Si al terminar esta pasada todavia queda contenido
// pendiente (otro PDF largo, u otra pagina), se vuelve a mandar el
// mismo boton -- se puede tocar tantas veces como haga falta hasta
// que no quede nada.
// ============================================================

async function manejarCallbackTelegram_(callback) {
  const chatId    = callback.message && callback.message.chat && callback.message.chat.id;
  if (!chatId) return;
  const chatIdStr = String(chatId);

  // Siempre se responde el callback (si no, el boton queda "cargando"
  // para siempre en el celular del usuario).
  responderCallbackTelegram_(callback.id);

  if (CFG.TELEGRAM_ALLOWED_CHAT_IDS.length > 0 && CFG.TELEGRAM_ALLOWED_CHAT_IDS.indexOf(chatIdStr) === -1) {
    return;
  }

  if (callback.data === 'continuar') {
    await continuarProcesamientoDesdeTelegram_(chatId);
  }
}

async function continuarProcesamientoDesdeTelegram_(chatId) {
  enviarMensajeTelegram(chatId, '🔄 Continuando el procesamiento...');
  const resultado = await procesarVouchersConResultado_();
  await manejarResultadoLote_(chatId, resultado, false);
}

// ============================================================
// ESTADO: que chat esta esperando el resultado de un lote pendiente.
// ------------------------------------------------------------
// Se usa para que el reintento automatico (Triggers.js) sepa a quien
// avisarle por Telegram cuando termina, aunque nadie haya tocado el
// boton. Si el lote pendiente vino de la carpeta de Drive (no de
// Telegram), simplemente no hay chat guardado y no se manda nada.
// ============================================================

function guardarChatEsperando_(chatId) {
  PropertiesService.getScriptProperties().setProperty('TG_CHAT_ESPERANDO', String(chatId));
}

function obtenerChatEsperando_() {
  return PropertiesService.getScriptProperties().getProperty('TG_CHAT_ESPERANDO') || null;
}

function limpiarChatEsperando_() {
  PropertiesService.getScriptProperties().deleteProperty('TG_CHAT_ESPERANDO');
}

// Logica compartida entre el boton/comando manual y el reintento
// automatico de 1 minuto: informa el resultado y decide si hace falta
// seguir insistiendo (reprogramando el reintento automatico) o si ya
// se puede dar por terminado el lote.
async function manejarResultadoLote_(chatId, resultado, esAutomatico) {
  let quedaPendiente = false;
  try {
    quedaPendiente = TIPOS_VOUCHER.some(function (tipo) {
      return DriveApp.getFolderById(carpetasParaTipo_(tipo).entrada).getFiles().hasNext();
    });
  } catch (e) {}

  if (chatId) {
    if (!resultado.ok) {
      enviarMensajeTelegram(chatId, '❌ Error continuando: ' + resultado.error);
    } else {
      const texto = resultado.filasNuevas > 0
        ? '✅ Se agregaron ' + resultado.filasNuevas + ' fila(s) mas a la hoja.'
        : 'No hubo filas nuevas en esta pasada.';

      if (quedaPendiente) {
        enviarBotonContinuar_(chatId, texto + '\n\n⏳ Todavia queda contenido pendiente' +
          (esAutomatico ? ' (sigue solo en 1 minuto, o toca el boton para adelantarlo).' : '.'));
      } else {
        enviarMensajeTelegram(chatId, texto + '\n\n🎉 Ya no queda nada pendiente en la carpeta.');
      }
    }
  }

  if (quedaPendiente && resultado.ok) {
    if (chatId) guardarChatEsperando_(chatId);
    programarReintentoAutomatico_();
  } else {
    limpiarChatEsperando_();
  }
}

// Variante de procesarVouchers() que informa cuantas filas se agregaron,
// para poder avisarle al usuario. No duplica logica: envuelve a la misma
// funcion que ya usan el escaneo de Drive y el diagnostico remoto.
async function procesarVouchersConResultado_() {
  const antes = filasTotalesAmbasPestanas_();
  let error = null;

  try {
    await procesarVouchers();
  } catch (err) {
    error = err.message;
  }

  const despues = filasTotalesAmbasPestanas_();

  return {
    ok: !error,
    error: error,
    filasNuevas: Math.max(despues - antes, 0)
  };
}

function filasTotalesAmbasPestanas_() {
  return TIPOS_VOUCHER.reduce(function (total, tipo) {
    try {
      const hoja = obtenerHoja(carpetasParaTipo_(tipo).hojaNombre);
      return total + (hoja ? hoja.getLastRow() : 0);
    } catch (e) {
      return total;
    }
  }, 0);
}

function enviarBotonContinuar_(chatId, texto) {
  if (!CFG.TELEGRAM_BOT_TOKEN) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: texto,
        reply_markup: {
          inline_keyboard: [[{ text: '▶️ Continuar ahora', callback_data: 'continuar' }]]
        }
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('Error enviando boton a Telegram: ' + e.message);
  }
}

function responderCallbackTelegram_(callbackQueryId) {
  if (!CFG.TELEGRAM_BOT_TOKEN) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TELEGRAM_BOT_TOKEN + '/answerCallbackQuery', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ callback_query_id: callbackQueryId }),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('Error respondiendo callback de Telegram: ' + e.message);
  }
}

function enviarMensajeTelegram(chatId, texto, replyMarkup) {
  if (!CFG.TELEGRAM_BOT_TOKEN) return;
  try {
    const payload = { chat_id: chatId, text: texto };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    UrlFetchApp.fetch('https://api.telegram.org/bot' + CFG.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('Error enviando mensaje a Telegram: ' + e.message);
  }
}

// ============================================================
// CONFIGURACION DESDE EL MENU
// ============================================================

function configurarApiKeyGemini() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('API Key de Gemini', 'Pega tu API Key de Google AI Studio (Gemini). Se guarda cifrada en las propiedades del script, nunca en el codigo:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const key = resp.getResponseText().trim();
  if (!key) { ui.alert('Vacio, cancelado.'); return; }
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  ui.alert('✅ API Key guardada.');
}

function configurarWebhookTelegram() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const tokenResp = ui.prompt('Configurar Telegram (1/2)', 'Pega el token del bot (obtenido con @BotFather):', ui.ButtonSet.OK_CANCEL);
  if (tokenResp.getSelectedButton() !== ui.Button.OK) return;
  const token = tokenResp.getResponseText().trim();
  if (!token) { ui.alert('Token vacio, cancelado.'); return; }

  const chatsResp = ui.prompt(
    'Configurar Telegram (2/2)',
    'IDs de chat/usuario de Telegram AUTORIZADOS para usar el bot, separados por coma.\n' +
    'Puedes obtener tu chat_id escribiendole a @userinfobot.\n' +
    'Dejalo vacio para permitir a cualquiera (NO recomendado en un sistema financiero).',
    ui.ButtonSet.OK_CANCEL
  );
  if (chatsResp.getSelectedButton() !== ui.Button.OK) return;

  props.setProperty('TELEGRAM_BOT_TOKEN', token);
  props.setProperty('TELEGRAM_ALLOWED_CHAT_IDS', chatsResp.getResponseText().trim());

  const resultado = activarWebhookTelegram_();
  if (resultado.ok) {
    ui.alert('✅ Bot de Telegram conectado correctamente.\n\nEnviale una foto de un voucher al bot para probar.');
  } else {
    ui.alert('❌ ' + resultado.error);
  }
}

// Version sin UI de la activacion del webhook, para poder llamarla tanto
// desde el menu (con ui.alert) como desde el endpoint de diagnostico
// (que no tiene contexto de interfaz).
function activarWebhookTelegram_() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) return { ok: false, error: 'Falta configurar el token del bot primero.' };

  let secreto = props.getProperty('TELEGRAM_WEBHOOK_SECRET');
  if (!secreto) {
    secreto = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TELEGRAM_WEBHOOK_SECRET', secreto);
  }

  const webAppUrl = ScriptApp.getService().getUrl();
  if (!webAppUrl) {
    return { ok: false, error: 'El proyecto todavia no esta implementado como Aplicacion Web.' };
  }

  const urlWebhook = webAppUrl + '?token=' + secreto;
  const resp = UrlFetchApp.fetch(
    'https://api.telegram.org/bot' + token + '/setWebhook?url=' + encodeURIComponent(urlWebhook),
    { muteHttpExceptions: true }
  );
  const resultado = JSON.parse(resp.getContentText());

  if (resultado.ok) {
    return { ok: true, mensaje: 'Webhook conectado correctamente.' };
  }
  return { ok: false, error: 'Telegram rechazo el webhook: ' + resultado.description };
}

function eliminarWebhookTelegram() {
  const ui = SpreadsheetApp.getUi();
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) { ui.alert('No hay ningun bot de Telegram configurado.'); return; }
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/deleteWebhook', { muteHttpExceptions: true });
  ui.alert('Webhook eliminado. El bot ya no recibira vouchers hasta que lo vuelvas a configurar.');
}
