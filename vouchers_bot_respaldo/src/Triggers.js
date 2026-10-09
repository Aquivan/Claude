// ============================================================
// TRIGGERS AUTOMATICOS Y VERIFICACION
// ============================================================

function crearTriggerAutomatico() {
  eliminarTriggerAutomatico();
  ScriptApp.newTrigger('procesarVouchers')
    .timeBased()
    .everyMinutes(10)     // valores validos: 1, 5, 10, 15, 30
    .create();
  Logger.log('Trigger creado: procesarVouchers cada 10 minutos.');
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('Procesamiento automatico activado (cada 10 min).', 'Listo', 6);
  } catch (e) {}
}

function eliminarTriggerAutomatico() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'procesarVouchers') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Triggers eliminados: ' + n);
}

function crearTriggerReparacion() {
  eliminarTriggerReparacion();
  ScriptApp.newTrigger('repararImagenesFaltantes')
    .timeBased()
    .everyMinutes(30)
    .create();
  Logger.log('Trigger de reparacion creado: cada 30 minutos.');
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('Reparacion automatica activada (cada 30 min).', 'Listo', 6);
  } catch (e) {}
}

function eliminarTriggerReparacion() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'repararImagenesFaltantes') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('Triggers de reparacion eliminados: ' + n);
}

// ============================================================
// REINTENTO AUTOMATICO DE UN SOLO USO
// ------------------------------------------------------------
// Distinto al trigger recurrente de cada 10 min: este SOLO se programa
// cuando una corrida se corta porque el lote (varios archivos, o un PDF
// largo) no termino en una sola ejecucion. Se dispara una vez, ~1 minuto
// despues, retoma justo donde quedo, y si todavia falta se vuelve a
// programar solo -- asi encadena automaticamente hasta vaciar la cola,
// sin que nadie tenga que esperar el trigger de 10 min ni tocar nada.
// ============================================================

function programarReintentoAutomatico_() {
  const yaProgramado = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'reintentoAutomaticoPendientes';
  });
  if (yaProgramado) {
    Logger.log('Ya hay un reintento automatico programado, no se duplica.');
    return;
  }
  ScriptApp.newTrigger('reintentoAutomaticoPendientes')
    .timeBased()
    .after(60 * 1000) // 1 minuto. Es un trigger de UNA sola vez.
    .create();
  Logger.log('Reintento automatico programado para dentro de 1 minuto.');
}

// Punto de entrada del trigger de una sola vez.
async function reintentoAutomaticoPendientes() {
  const chatId    = obtenerChatEsperando_();
  const resultado = await procesarVouchersConResultado_();
  await manejarResultadoLote_(chatId, resultado, true);
}

function verificarConfiguracion() {
  Logger.log('Verificando configuracion...');
  TIPOS_VOUCHER.forEach(function (tipo) {
    const carpetas = carpetasParaTipo_(tipo);
    try { Logger.log('[' + tipo + '] Carpeta Entrada: ' + DriveApp.getFolderById(carpetas.entrada).getName()); } catch(e) { Logger.log('ERROR: ' + e.message); }
    try { Logger.log('[' + tipo + '] Carpeta Procesados: ' + DriveApp.getFolderById(carpetas.procesados).getName()); } catch(e) { Logger.log('ERROR: ' + e.message); }
    try { Logger.log('[' + tipo + '] Hoja encontrada: ' + obtenerHoja(carpetas.hojaNombre).getName()); } catch(e) { Logger.log('ERROR: ' + e.message); }
  });
  try { Logger.log('Carpeta Descartados: ' + DriveApp.getFolderById(CFG.CARPETA_DESCARTADOS_ID).getName()); } catch(e) { Logger.log('ERROR: ' + e.message); }
  Logger.log('Modelo activo: ' + CFG.MODELO_GEMINI);
  Logger.log('Pausa entre paginas: ' + CFG.PAUSA_MS + ' ms');
  Logger.log('API Key de Gemini configurada: ' + (CFG.API_KEY ? 'si' : 'NO -- usa el menu para configurarla'));
  Logger.log('Bot de Telegram configurado: ' + (CFG.TELEGRAM_BOT_TOKEN ? 'si' : 'NO -- usa el menu para configurarlo'));
  Logger.log('Chats autorizados en Telegram: ' + (CFG.TELEGRAM_ALLOWED_CHAT_IDS.length ? CFG.TELEGRAM_ALLOWED_CHAT_IDS.join(', ') : '(ninguno restringido, revisar)'));

  const triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'procesarVouchers';
  });
  Logger.log('Triggers de procesamiento activos: ' + triggers.length);

  const triggersRep = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'repararImagenesFaltantes';
  });
  Logger.log('Triggers de reparacion activos: ' + triggersRep.length);

  const triggersReintento = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'reintentoAutomaticoPendientes';
  });
  Logger.log('Reintento automatico (1 min) pendiente ahora mismo: ' + (triggersReintento.length > 0 ? 'si' : 'no'));
}
