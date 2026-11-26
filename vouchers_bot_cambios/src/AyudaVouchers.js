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
    '• **📤 Desde esta hoja**: menú **✨ Vouchers → 📤 Subir vouchers**. Arrastre o elija PDF y fotos (varios a la vez), **cámbieles el nombre** si quiere (o use «Nombre para todos» para numerarlos), elija **📄 Originales** o **📷 Fotos** y toque **📤 Subir**. Luego **▶ Procesar ahora** (en ~1 minuto) o espere la vuelta de 10 minutos. No deja repetir un nombre que ya existe, porque con el nombre se encuentra después el original.',
    '• **🌐 Portal web (celular o PC, con usuario y PIN)**: 📷 Tomar foto, 📄 Escanear a PDF (varias fotos → un PDF) o elegir archivos, y ⚡ procesar al instante. El portal también busca, muestra el original, corrige datos y relee con IA. Usuarios en la pestaña **👥 Portal**; lo hecho queda en **🌐 Registro portal**.',
    '• **Carpeta de Drive de entrada**: deje los archivos ahí.',
    'El sistema los procesa **cada 10 minutos** (o al instante con ▶ Procesar). Si un PDF tiene muchas páginas y no termina, en Telegram toque **▶️ Continuar ahora** o escriba /continuar.',
    'Al terminar, el archivo pasa a la carpeta de **Procesados** (o a **Duplicados/Descartados** si ya estaba o no era un voucher).'
  ] },
  { id: 'columnas', e: '📋', t: 'Qué significa cada columna', p: [
    '• **Fecha depósito**, **N° operación**, **Banco**, **Moneda**, **Monto**: los datos del voucher.',
    '• **Beneficiario**: a quién se le pagó. **Doc. depositante** / **Depositante**: quién pagó (RUC o DNI y nombre, como se leen en el voucher).',
    '• **Descripción**: el tipo de operación (depósito, transferencia, pago SUNAT…).',
    '• **Imagen**: la miniatura. **Archivo** y **Pág.**: de qué archivo y qué página salió. **Procesado**: fecha y hora en que se leyó. **Canal**: cómo llegó (Telegram, WhatsApp, carpeta). Si llega un archivo con un nombre que ya existe, se renombra solo «(2)», «(3)».',
    '• ✍️ **Leer anotaciones de filas ya registradas**: seleccione una o varias filas → ✨ Vouchers → ✍️ Leer anotaciones de las filas seleccionadas. Lee lo escrito a mano y las etiquetas de su página y lo pone en «✍️ Anotación» (no cambia los datos del voucher). 🔁 Volver a leer también lo hace.',
    '• 📦 **PDF muy pesados** (más de 45 MB): si está encendido (✨ Vouchers → 📦 Comprimir PDF pesados; ahí mismo se pega una vez el 🔑 token de GitHub), un robot de GitHub lo comprime (recorta el fondo, ~1600 px, Jpegli de Google) y, si hace falta, lo parte; las partes vuelven a Entrada con el mismo nombre y el original queda en «Procesados/📦 Originales grandes». Si el robot falla, sigue como siempre («archivo grande»). Por Telegram, un archivo de más de 20 MB lo baja un robot (hasta 2 GB) y sigue igual.',
    '• 🏢 **Completar Empresa sola** (encendido; se apaga en ✨ Vouchers): donde «Empresa» está vacía se pone la empresa del grupo que pagó, por el RUC de «Doc. depositante» (manda), su DNI (con nota para revisar), el nombre del «Depositante», lo escrito a mano en «✍️ Anotación» o la «Nota»; también su RUC. Nunca cambia lo que ya está escrito; si las fuentes no coinciden no llena y deja nota. Cada celda lleva una nota «🏢 Completado solo… por: …». ↩️ Deshacer el último completado lo quita (y apaga el automático).',
    '• 🔁 **Vouchers repetidos**: si llega un voucher que ya está (mismo N° de operación, banco y monto), NO se crea otra fila: en la fila del original, «Canal» dice «🔁 2 veces» y su nota (pase el mouse) dice quién más lo mandó, cuándo y con qué archivo; si toda la foto o PDF era repetida, va a «Procesados/🔁 Repetidos». Si es casi igual (un dígito distinto en la operación, mismo banco y monto) se registra con «⚠️ ¿repetido?» en «Canal» para que lo revise.',
    '• 🗑 **Deshacer una tanda**: ✨ Vouchers → 🗑 Deshacer una tanda. Elija el archivo: se borran sus filas (con imágenes) y su PDF de Procesados y sus reversos van a la papelera de Drive (30 días). También desde Cobranzas y Telegram.',
    '• ✍️ **Reversos con anotaciones**: al escanear (celular o escáner), ponga el REVERSO justo después de su voucher cuando tenga algo escrito a mano (solo si tiene algo escrito). El sistema lo separa solo: en Procesados queda el PDF solo con los frentes, cada reverso (con una franja amarilla que dice de qué voucher es) y una copia comprimida del original completo van a la carpeta «✍️ Reversos», y lo escrito pasa a la columna «✍️ Anotación» («Reverso: Granix», «Frente: …» si está escrito al frente, «Etiqueta: libre» si se puso una etiqueta digital al tomar la foto; «(revisar)» si la IA duda). Se apaga en ✨ Vouchers → ✍️ Reversos y anotaciones.',
    '• De la O en adelante (lo que completa usted, la Mesa o el sistema; títulos en verde): **Empresa** (abreviatura; puede escribir otra de fuera del grupo) · **RUC empresa** (se pone solo al elegir la Empresa, según la pestaña **🏢 Empresas**: ahí corrige, agrega o borra empresas y su RUC) · **RUC beneficiario** · **Comprobantes** (01_ factura, 02_ recibo por honorarios, 03_ boleta…; con =monto si paga solo una parte) · **Control** (👀 Revisado, 📄 Original físico, ⚠️ Observado…: puede marcar varias; la lista se edita en Datos → Validación) · **Retención** (opcional: 🟡 Por retener · ✅ Retenido · 🚫 No corresponde; Resultado la compara con SUNAT; si la borra, todo sigue automático) · **Nota** · **✍️ Anotación** (lo escrito a mano con lapicero en el reverso o el frente del voucher, con enlace al reverso; lo llena el sistema) · **Resultado** (lo escribe Cobranzas: ✅ aplicado, 💰 sobra, ⚠️ problema, y la retención: aplicada con su CRE, falta, o no corresponde).',
    
    '• **Empresa**, **ID Beneficiario**, **ID Usuario**: datos para cruzar con las facturas (los sugiere el 🧠 Asistente IA).'
  ] },
  { id: 'visor', e: '🪟', t: 'Visor de voucher (ver y corregir)', p: [
    'Menú **✨ Vouchers → 🪟 Visor de voucher**. Haga clic en cualquier fila: aparece el **voucher original** en grande (la página exacta del PDF o la foto) y sus datos al lado.',
    '• **Corregir**: cambie un dato (se pinta de naranja) → **💾 Guardar** → **✅ Confirmar**. Se escribe en la celda. Antes revisa que la fila siga siendo el mismo voucher.',
    '• **Vistas**: 🖼 solo imagen · 🖼 📋 ambos · 📋 solo datos.',
    '• **Imagen**: − / + (o Ctrl + rueda), ↔ Ancho, ↕ Página, ⟳ girar, arrastrar para moverse. Una barra separa imagen y datos: arrástrela.',
    '• **◀ ▶** fila anterior o siguiente · **📋 Copiar** la imagen para pegarla en WhatsApp o correo · **📄** abre el original en Drive.',
    '• **🔎 Buscar**: abre a la izquierda un buscador sobre **Originales y Fotos** (o solo una): escriba n° de operación, nombre, monto o archivo, y filtre por **fecha, banco, moneda, monto, empresa, revisado, retención e ID Beneficiario** (en «⚙️ Más filtros»). **Duplicados**: Todos · **Únicos** (uno por voucher: si está en Originales y en Fotos, queda el de **Originales**) · **Solo duplicados** (mismo n° de operación, banco y monto; los repetidos salen juntos). Arriba ve cuántos son y la suma en S/ y US$.',
    '• Con un filtro puesto, **◀ ▶** (o las flechas ↑ ↓ del teclado) recorren **solo los resultados**, y el título dice «🔎 3 de 45». Al tocar un resultado se ve el voucher y se selecciona la fila en la hoja. **📋** copia la lista para pegarla en Excel o Sheets; **🔄** vuelve a leer la hoja; **✖ Limpiar** quita los filtros.',
    '• **🗗 Ventana aparte**: todo el visor en una ventana del navegador que se agranda arrastrando el borde o se lleva a otro monitor. Deje abierta la ventanita de Sheets (es la que avisa qué fila tocó).'
  ] },
  { id: 'menu', e: '🤖', t: 'Menú ✨ Vouchers', p: [
    '• **📤 Subir vouchers**: subir PDF o fotos desde la computadora, con el nombre que usted elija.',
    '• **▶ Procesar Nuevos Archivos**: procesa ya lo que está en la carpeta de entrada.',
    '• **🧪 Probar modelos Gemini**: pone a leer los mismos vouchers recientes a todos los modelos Gemini de su clave y anota en el 🩺 Registro técnico cuál acierta más, cuánto tarda y cuáles no están disponibles. No cambia nada.',
    '• **📂 Abrir carpetas en Drive**: Fotos y Originales procesados (los ya registrados), las de entrada (por procesar) y Descartados.',
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
    '• **Monto con comisión**: el monto del voucher es lo que RECIBE el proveedor («IMPORTE», «Importe transferido»), no la «Cancelación total» ni el «Importe cargado» (traen la comisión y el ITF del banco, que son gasto de la empresa). Ej.: recaudación BBVA IMPORTE 49,993 + comisión 7 = 50,000 → el monto es 49,993. Si un voucher antiguo quedó con el total, use 🔁 Volver a leer con IA.',
    '• **La IA leyó mal una página, o volvió a subir el archivo con una página cambiada** (el sistema solo lee las páginas nuevas del final): póngase en la fila y use **🔁 Volver a leer con IA la página de la fila seleccionada**. Muestra ANTES y AHORA y pide confirmar; no toca lo que usted agregó (columnas O en adelante). **↩️ Deshacer la última relectura** lo devuelve. También desde Telegram o WhatsApp: «volver a leer Originales 2666».',
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
