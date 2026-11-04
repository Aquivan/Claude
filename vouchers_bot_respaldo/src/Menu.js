// ============================================================
// MENU DE LA HOJA DE CALCULO
// ============================================================

function onOpen() {
  try { IA_agregarMenu_(); } catch (e) { Logger.log('Menu Asistente IA: ' + e.message); }
  SpreadsheetApp.getUi()
    .createMenu('🤖 Vouchers')
    .addItem('📤 Subir vouchers (PDF o imagen, con el nombre que quiera)', 'SV_abrir')
    .addItem('▶ Procesar Nuevos Archivos (carpeta Drive)', 'procesarVouchers')
    .addItem('🪟 Visor de voucher: ventana flotante (voucher original en grande + 🔎 buscar y filtrar)', 'VV_abrirGrande')
    .addItem('👁 Visor de voucher: panel lateral', 'VV_abrir')
    .addItem('🔁 Volver a leer con IA la página de la fila seleccionada', 'RP_releerFilaActiva')
    .addItem('↩️ Deshacer la última relectura', 'RP_deshacer')
    .addSubMenu(SpreadsheetApp.getUi().createMenu('📂 Abrir carpetas en Drive')
      .addItem('📸 Fotos — procesadas (las que ya están en la hoja)', 'CV_fotosProcesadas')
      .addItem('📄 Originales — procesados (los que ya están en la hoja)', 'CV_originalesProcesados')
      .addSeparator()
      .addItem('📥 Fotos — entrada (por procesar)', 'CV_fotosEntrada')
      .addItem('📥 Originales — entrada (por procesar)', 'CV_originalesEntrada')
      .addItem('🗑 Descartados', 'CV_descartados')
      .addSeparator()
      .addItem('🗂 Todas las carpetas (una ventana con los 5 enlaces)', 'CV_todas'))
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
    .addSeparator()
    .addItem('❓ Ayuda: cómo funciona esta hoja (paso a paso)', 'AYV_menuAbrir')
    .addToUi();
}
