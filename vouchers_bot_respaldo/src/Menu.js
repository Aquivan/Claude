// ============================================================
// MENU DE LA HOJA DE CALCULO
// ============================================================

function onOpen() {
  try { IA_agregarMenu_(); } catch (e) { Logger.log('Menu Asistente IA: ' + e.message); }
  SpreadsheetApp.getUi()
    .createMenu('🤖 Vouchers')
    .addItem('▶ Procesar Nuevos Archivos (carpeta Drive)', 'procesarVouchers')
    .addSeparator()
    .addItem('⚙️ Verificar Configuracion', 'verificarConfiguracion')
    .addItem('⏰ Activar procesamiento automatico', 'crearTriggerAutomatico')
    .addItem('⏸ Desactivar procesamiento automatico', 'eliminarTriggerAutomatico')
    .addSeparator()
    .addItem('🔧 Reparar imagenes faltantes (Ver PDF o vacias)', 'repararImagenesFaltantes')
    .addItem('⏰ Activar reparacion automatica (cada 30 min)', 'crearTriggerReparacion')
    .addItem('⏸ Desactivar reparacion automatica', 'eliminarTriggerReparacion')
    .addSeparator()
    .addItem('🔑 Configurar API Key de Gemini', 'configurarApiKeyGemini')
    .addItem('📲 Configurar Bot de Telegram', 'configurarWebhookTelegram')
    .addItem('🚫 Desactivar Bot de Telegram', 'eliminarWebhookTelegram')
    .addSeparator()
    .addItem('🩺 Configurar diagnostico remoto', 'configurarDiagnosticoRemoto')
    .addItem('🚫 Desactivar diagnostico remoto', 'desactivarDiagnosticoRemoto')
    .addToUi();
}
