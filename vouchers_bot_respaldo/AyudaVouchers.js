// ============================================================
// ❓ AYUDA DE LA HOJA "SISTEMA DE VOUCHERS"
// ------------------------------------------------------------
// Ventana con indice y buscador (AyudaVouchersVista.html), escrita para
// alguien que nunca uso el sistema. ⚠️ Cada funcion nueva de esta hoja
// debe sumarse aqui (ver PROYECTOS.md del repositorio). Funciones AYV_.
// Formato: **negrita**, "• " vinetas, "1. " pasos.
// ============================================================

const AYV_SECCIONES_ = [
  { id: 'inicio', e: '👋', t: 'Qué es esta hoja', p: [
    'Aquí se guarda **cada voucher** (constancia de depósito o transferencia bancaria) del grupo: una fila por voucher, con su **imagen** y sus datos.',
    'Los datos (banco, número de operación, monto, fecha, a quién se pagó) los **lee la inteligencia artificial (IA)** de la foto o del PDF. Usted solo revisa y corrige si hace falta.',
    'Hay dos pestañas: **Originales** (PDF o documentos formales del banco) y **Fotos** (fotos tomadas con el celular).',
    'Con estos datos, la hoja de **Cuentas por Cobrar y Pagar** sabe qué factura se pagó con qué voucher.'
  ] },
  { id: 'entrar', e: '📥', t: 'Cómo entran los vouchers', p: [
    '• **Telegram (bot de Vouchers)**: mande la foto o el PDF. Con los botones elija si en general manda **originales** o **fotos**; o escriba «original» / «foto» en el comentario de un archivo puntual.',
    '• **WhatsApp**: reenvíe las fotos o PDF (puede marcar varios a la vez). Al terminar la tanda le pregunta de quién son.',
    '• **📤 Desde esta hoja**: menú **🤖 Vouchers → 📤 Subir vouchers**. Arrastre o elija PDF y fotos (varios a la vez), **cámbieles el nombre** si quiere (o use «Nombre para todos» para numerarlos), elija **📄 Originales** o **📷 Fotos** y toque **📤 Subir**. Luego **▶ Procesar ahora** (en ~1 minuto) o espere la vuelta de 10 minutos. No deja repetir un nombre que ya existe, porque con el nombre se encuentra después el original.',
    '• **Carpeta de Drive de entrada**: deje los archivos ahí.',
    'El sistema los procesa **cada 10 minutos** (o al instante con ▶ Procesar). Si un PDF tiene muchas páginas y no termina, en Telegram toque **▶️ Continuar ahora** o escriba /continuar.',
    'Al terminar, el archivo pasa a la carpeta de **Procesados** (o a **Duplicados/Descartados** si ya estaba o no era un voucher).'
  ] },
  { id: 'columnas', e: '📋', t: 'Qué significa cada columna', p: [
    '• **Fecha de depósito**, **Número de operación**, **Banco**, **Moneda**, **Monto**: los datos del voucher.',
    '• **Proveedor (Beneficiario)**: a quién se le pagó. **idCliente** / **Cliente (usuario)**: quién pagó.',
    '• **Descripción**: el tipo de operación (depósito, transferencia, pago SUNAT…).',
    '• **Voucher (imagen)**: la miniatura. **Archivo Original** y **Página**: de qué archivo y qué página salió.',
    '• **Revisado Voucher**: márquelo cuando usted ya lo revisó.',
    '• **Por Retener** / **Retenido**: si a ese pago le corresponde retención y si ya se emitió.',
    '• **Empresa**, **ID Beneficiario**, **ID Usuario**: datos para cruzar con las facturas (los sugiere el 🧠 Asistente IA).'
  ] },
  { id: 'visor', e: '🪟', t: 'Visor de voucher (ver y corregir)', p: [
    'Menú **🤖 Vouchers → 🪟 Visor de voucher**. Haga clic en cualquier fila: aparece el **voucher original** en grande (la página exacta del PDF o la foto) y sus datos al lado.',
    '• **Corregir**: cambie un dato (se pinta de naranja) → **💾 Guardar** → **✅ Confirmar**. Se escribe en la celda. Antes revisa que la fila siga siendo el mismo voucher.',
    '• **Vistas**: 🖼 solo imagen · 🖼 📋 ambos · 📋 solo datos.',
    '• **Imagen**: − / + (o Ctrl + rueda), ↔ Ancho, ↕ Página, ⟳ girar, arrastrar para moverse. Una barra separa imagen y datos: arrástrela.',
    '• **◀ ▶** fila anterior o siguiente · **📋 Copiar** la imagen para pegarla en WhatsApp o correo · **📄** abre el original en Drive.',
    '• **🔎 Buscar**: abre a la izquierda un buscador sobre **Originales y Fotos** (o solo una): escriba n° de operación, nombre, monto o archivo, y filtre por **fecha, banco, moneda, monto, empresa, revisado, retención e ID Beneficiario** (en «⚙️ Más filtros»). **Duplicados**: Todos · **Únicos** (uno por voucher) · **Solo duplicados** (mismo n° de operación, banco y monto; los repetidos salen juntos). Arriba ve cuántos son y la suma en S/ y US$.',
    '• Con un filtro puesto, **◀ ▶** (o las flechas ↑ ↓ del teclado) recorren **solo los resultados**, y el título dice «🔎 3 de 45». Al tocar un resultado se ve el voucher y se selecciona la fila en la hoja. **📋** copia la lista para pegarla en Excel o Sheets; **🔄** vuelve a leer la hoja; **✖ Limpiar** quita los filtros.',
    '• **🗗 Ventana aparte**: todo el visor en una ventana del navegador que se agranda arrastrando el borde o se lleva a otro monitor. Deje abierta la ventanita de Sheets (es la que avisa qué fila tocó).'
  ] },
  { id: 'menu', e: '🤖', t: 'Menú 🤖 Vouchers', p: [
    '• **📤 Subir vouchers**: subir PDF o fotos desde la computadora, con el nombre que usted elija.',
    '• **▶ Procesar Nuevos Archivos**: procesa ya lo que está en la carpeta de entrada.',
    '• **⚙️ Verificar Configuración**: revisa carpetas, claves y conexiones.',
    '• **⏰ Activar / ⏸ Desactivar procesamiento automático** (cada 10 minutos).',
    '• **🔧 Reparar imágenes faltantes**: rehace las que quedaron como «Ver PDF» o vacías. También hay reparación automática cada 30 minutos.',
    '• **🔑 Configurar API Key de Gemini**: la clave de la IA (solo una vez).',
    '• **📲 Configurar / 🚫 Desactivar Bot de Telegram**.',
    '• **🩺 Diagnóstico remoto**: permite revisar el sistema a distancia sin compartir claves.'
  ] },
  { id: 'ia', e: '🧠', t: 'Asistente IA de esta hoja', p: [
    'Para los vouchers **sin RUC**, la IA sugiere a quién corresponden (**ID Beneficiario**) y qué factura pagan. Usted revisa y aprueba.',
    '1. Menú **🧠 Asistente IA → ▶ Sugerir ahora** (todas las pestañas, o solo Originales / solo Fotos).',
    '2. Revise las sugerencias; marque ✔ las correctas.',
    '3. **✅ Pasar marcados ✔ al voucher**: recién ahí se escribe.',
    '• **⏰ Activar automático** (cada 30 min) para que sugiera solo.',
    '• **➕ Agregar columnas ID** si faltan · **🔑 Guardar clave** y **🧪 Probar conexión** la primera vez.',
    'La IA puede equivocarse: confirme siempre con la imagen (el 🪟 Visor ayuda).'
  ] },
  { id: 'problemas', e: '🛠', t: 'Si algo no sale bien', p: [
    '• **La imagen dice «Ver PDF» o está vacía**: 🔧 Reparar imágenes faltantes.',
    '• **Un dato está mal leído**: corríjalo en la celda o en el 🪟 Visor.',
    '• **No se procesó un archivo**: ⚙️ Verificar Configuración, y revise que esté en la carpeta de entrada; ▶ Procesar.',
    '• **Se registró algo por error** (por WhatsApp): escriba **deshacer**.',
    '• **Dudas**: pregunte al asistente de Telegram o WhatsApp («¿ya está registrado el voucher 4079 de BCP?»).'
  ] },
  { id: 'glosario', e: '📚', t: 'Palabras técnicas', p: [
    '• **IA (inteligencia artificial)**: programa que lee imágenes y textos y propone datos. Aquí se usa **Gemini**, de Google; su **API Key** es la clave para usarla.',
    '• **Original / Foto**: PDF o documento del banco vs. foto con el celular (la IA los lee distinto).',
    '• **Drive**: donde están las carpetas de entrada, procesados y descartados.',
    '• **Disparador (trigger)**: tarea que corre sola cada cierto tiempo (procesar, reparar, sugerir).',
    '• **Bot**: el asistente de Telegram o WhatsApp que recibe sus archivos.',
    '• **RUC / ID Beneficiario**: el número que identifica a la empresa o persona que recibió el pago.'
  ] }
];

function AYV_menuAbrir() {
  const t = HtmlService.createTemplateFromFile('AyudaVouchersVista');
  t.datos = JSON.stringify(AYV_SECCIONES_);
  SpreadsheetApp.getUi().showModelessDialog(t.evaluate().setWidth(980).setHeight(680), '❓ Ayuda · Sistema de Vouchers');
}
