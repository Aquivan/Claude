// GENERADO por asistente-vouchers.yml desde el menú 🧠 Asistente IA de Cobranzas (no editar aquí).
// ↗ = se trabaja en la hoja de Cuentas por Cobrar y Pagar (abre esa hoja).
function VIA_menu_() {
  SpreadsheetApp.getUi().createMenu('🧠 Asistente IA')
    .addItem('❓ Ayuda: qué hace cada opción ↗', 'VIA_m_AYU_menuAbrir')
    .addItem('🧩 Mesa de conciliación (facturas ↔ vouchers, con líneas)', 'VIA_menuMesa')
    .addItem('💬 Chat con la IA (preguntas, fotos, PDF, Excel)', 'VIA_menuAbrirChat')
    .addItem('📰 Resumen de cobranzas y pagos con IA', 'VIA_menuResumen')
    .addItem('📋 Analizar vouchers procesados (factura, empresa, retención)', 'VIA_menuProcesados')
    .addItem('🔎 Identificar RUC de los proveedores (filas seleccionadas)', 'VIA_menuIdentificarRuc')
    .addItem('🔗 Completar Originales con lo trabajado en Fotos', 'VIA_menuVco')
    .addSeparator()
    .addItem('🔍 Auditor IA: abrir (compras y pagos de todas las empresas) ↗', 'VIA_m_AUD_menuAbrir')
    .addItem('▶ Auditar con IA (según los filtros) ↗', 'VIA_m_AUD_menuAuditar')
    .addItem('💬 Preguntar a la IA (celda amarilla) ↗', 'VIA_m_AUD_menuPreguntar')
    .addItem('✅ Aplicar cambios marcados de la IA ↗', 'VIA_m_ANX_menuAplicarMarcados')
    .addItem('↩️ Deshacer últimos cambios de la IA ↗', 'VIA_m_ANX_menuDeshacer')
    .addItem('⏹ Detener auditoría o verificación en curso ↗', 'VIA_m_AUD_menuDetener')
    .addSeparator()
    .addItem('📋 Abrir pestaña y cargar proveedores/clientes ↗', 'VIA_m_CIA_menuAbrir')
    .addItem('▶ Analizar la selección ↗', 'VIA_m_CIA_menuAnalizar')
    .addItem('✅ Aplicar lo aceptado ↗', 'VIA_m_CIA_menuAplicar')
    .addItem('🧹 Borrar propuestas ↗', 'VIA_m_CIA_menuBorrar')
    .addSeparator()
    .addItem('📄 Listar facturas y vouchers de la selección ↗', 'VIA_m_CIA_menuListar')
    .addSeparator()
    .addItem('📥 Subir mi análisis (Excel, foto o PDF) ↗', 'VIA_m_IMP_menuSubir')
    .addItem('📂 Importar desde la carpeta de Drive ↗', 'VIA_m_IMP_menuDesdeCarpeta')
    .addItem('✅ Completar vouchers marcados (importación) ↗', 'VIA_m_IMP_menuAplicar')
    .addItem('↩️ Deshacer última importación ↗', 'VIA_m_IMP_menuDeshacer')
    .addItem('🧹 Borrar importación y archivos subidos ↗', 'VIA_m_IMP_menuBorrar')
    .addSeparator()
    .addItem('🔑 Guardar clave de IA (de esta pestaña) ↗', 'VIA_m_CIA_menuGuardarClave')
    .addItem('🧪 Probar conexión con la IA ↗', 'VIA_m_CIA_menuProbar')
    .addSeparator()
    .addItem('🧹 Quitar el asistente anterior (pestaña vieja)', 'VIA_menuRetirar')
    .addToUi();
}

function VIA_m_AYU_menuAbrir() { VIA_abrirCobranzas_('', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ❓ Ayuda: qué hace cada opción.'); }
function VIA_m_AUD_menuAbrir() { VIA_abrirCobranzas_('', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 🔍 Auditor IA: abrir (compras y pagos de todas las empresas).'); }
function VIA_m_AUD_menuAuditar() { VIA_abrirCobranzas_('', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ▶ Auditar con IA (según los filtros).'); }
function VIA_m_AUD_menuPreguntar() { VIA_abrirCobranzas_('', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 💬 Preguntar a la IA (celda amarilla).'); }
function VIA_m_ANX_menuAplicarMarcados() { VIA_abrirCobranzas_('', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ✅ Aplicar cambios marcados de la IA.'); }
function VIA_m_ANX_menuDeshacer() { VIA_abrirCobranzas_('', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ↩️ Deshacer últimos cambios de la IA.'); }
function VIA_m_AUD_menuDetener() { VIA_abrirCobranzas_('', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ⏹ Detener auditoría o verificación en curso.'); }
function VIA_m_CIA_menuAbrir() { VIA_abrirCobranzas_('🤝 Conciliar con IA', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 📋 Abrir pestaña y cargar proveedores/clientes.'); }
function VIA_m_CIA_menuAnalizar() { VIA_abrirCobranzas_('🤝 Conciliar con IA', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ▶ Analizar la selección.'); }
function VIA_m_CIA_menuAplicar() { VIA_abrirCobranzas_('🤝 Conciliar con IA', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ✅ Aplicar lo aceptado.'); }
function VIA_m_CIA_menuBorrar() { VIA_abrirCobranzas_('🤝 Conciliar con IA', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 🧹 Borrar propuestas.'); }
function VIA_m_CIA_menuListar() { VIA_abrirCobranzas_('🤝 Conciliar con IA', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 📄 Listar facturas y vouchers de la selección.'); }
function VIA_m_IMP_menuSubir() { VIA_abrirCobranzas_('🤝 Importar', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 📥 Subir mi análisis (Excel, foto o PDF).'); }
function VIA_m_IMP_menuDesdeCarpeta() { VIA_abrirCobranzas_('🤝 Importar', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 📂 Importar desde la carpeta de Drive.'); }
function VIA_m_IMP_menuAplicar() { VIA_abrirCobranzas_('🤝 Importar', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ✅ Completar vouchers marcados (importación).'); }
function VIA_m_IMP_menuDeshacer() { VIA_abrirCobranzas_('🤝 Importar', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → ↩️ Deshacer última importación.'); }
function VIA_m_IMP_menuBorrar() { VIA_abrirCobranzas_('🤝 Importar', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 🧹 Borrar importación y archivos subidos.'); }
function VIA_m_CIA_menuGuardarClave() { VIA_abrirCobranzas_('🤝 Conciliar con IA', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 🔑 Guardar clave de IA (de esta pestaña).'); }
function VIA_m_CIA_menuProbar() { VIA_abrirCobranzas_('🤝 Conciliar con IA', 'Esto se trabaja en Cuentas por Cobrar y Pagar: allí use 🧠 Asistente IA → 🧪 Probar conexión con la IA.'); }
