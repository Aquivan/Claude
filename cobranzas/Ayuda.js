/**
 * ❓ Centro de ayuda — el MISMO contenido, ordenado por temas, en tres lugares:
 *   • la hoja (menú 💼 Cobranzas / 🧠 Asistente IA → ❓ Ayuda): ventana con índice y buscador (AyudaVista.html);
 *   • Telegram: /ayuda (botones por tema) y /ayuda <tema>;
 *   • WhatsApp: «ayuda temas» (lista numerada) y «ayuda 3» o «ayuda guías».
 * Escrito para alguien que NUNCA usó el sistema: qué hace cada cosa, cómo se usa paso a paso y qué significan las
 * palabras técnicas. ⚠️ Cada función nueva que se agregue al sistema debe sumarse aquí (ver PROYECTOS.md).
 * Formato del texto: **negrita**, líneas que empiezan con «• » son viñetas, «1. » pasos. Prefijo AYU_.
 */

var AYU_SECCIONES_ = [
  { id: 'inicio', e: '👋', t: 'Empiece aquí: qué es este sistema', p: [
    'Es un conjunto de **hojas de Google** y **asistentes** que trabajan juntos para el grupo de empresas. Usted pregunta o manda documentos; el sistema busca, cruza y propone. **Nada importante se hace sin su ✅**.',
    '**Las hojas** (cada una en su propio archivo de Google Sheets):',
    '• 💼 **Cuentas por Cobrar y Pagar**: qué nos deben, qué debemos y con qué voucher se pagó cada factura.',
    '• 🧾 **Sistema de Vouchers**: cada constancia de depósito o transferencia, con su imagen y sus datos (los lee la IA).',
    '• 🚚 **Guías de Remisión**: arma y emite las guías de traslado (en Quesito o en SUNAT).',
    '• 🧾 **Retenciones**, 🏦 **Detracciones**, 🧑‍💼 **Honorarios**, 📬 **Notificaciones SUNAT** y ⚡ **Panel SIRE**: lo que se baja de SUNAT, ordenado por empresa.',
    '**Los asistentes**:',
    '• 🤖 **Telegram** y 📲 **WhatsApp**: pregunte con sus palabras (o con voz), mande fotos y PDF, pida guías y retenciones.',
    '• 🧠 **Asistente IA** dentro de las hojas: chat, auditoría y conciliación con inteligencia artificial.',
    '• ⚙️ **Robots** (en GitHub): entran a SUNAT, SIRE y Quesito a bajar o llenar datos, solos o cuando usted los pide.',
    'Si no sabe por dónde empezar: escriba su pregunta en Telegram o WhatsApp tal como se la diría a una persona.'
  ] },
  { id: 'cobranzas', e: '💼', t: 'Cuentas por Cobrar y Pagar (la hoja)', p: [
    'Muestra, por empresa, **cada factura** de ventas (por cobrar) y de compras (por pagar), cuánto se pagó, con qué voucher y cuánto falta. Los datos vienen del SIRE de SUNAT y del Sistema de Vouchers.',
    '**Menú 💼 Cobranzas**:',
    '• 🔄 **Actualizar ahora**: vuelve a calcular todo con los datos más recientes. También corre solo.',
    '• 🎚 **Modo de cruce**: cómo se juntan facturas y pagos. 🟢 **Solo referenciados** = solo lo que el voucher dice claramente (lo más seguro) · 🔵 **Estricto** = además los montos exactos · 🟡 **Inteligente** = además sugerencias que usted revisa.',
    '• 🖼 **Abrir visor de vouchers**: ve la imagen del voucher de la fila.',
    '• ✍️ **Registrar cobro/pago manual**: para pagos sin voucher (efectivo, compensación).',
    '• 🔁 **Reasignar una retención** a otra factura.',
    '• 🧾 **Actualizar padrones SUNAT**: agentes de retención, buenos contribuyentes y SSCO (sirven para saber si corresponde retener).',
    '• 📋 **Vouchers procesados**: ver lo que entró (por día o por tanda), buscar el RUC que falta (padrón SUNAT e internet), escribirlo en Vouchers y analizar con IA a qué factura corresponde.',
    '• 🔎 **RUC por nombre**: encuentra el RUC de un nombre (en sus facturas y en el padrón) y lo recuerda como alias.',
    '• ♻️ **Respaldos**: guarda o restaura lo que se escribió a mano.',
    '• ⚙️ **Instalar / reparar**: si algo se ve raro, vuelve a armar la hoja sin borrar datos.'
  ] },
  { id: 'ia', e: '🧠', t: 'Asistente IA en la hoja (inteligencia artificial)', p: [
    'La **IA** (inteligencia artificial, Gemini de Google) lee textos, fotos y PDF, entiende preguntas en español y **propone**. La hoja revisa con reglas fijas lo que la IA dice antes de mostrarlo, y **nada se escribe sin que usted lo apruebe**.',
    '**Menú 🧠 Asistente IA**:',
    '• 💬 **Chat con la IA**: un panel para preguntar sobre sus datos y adjuntar fotos, PDF o Excel.',
    '• 📰 **Resumen** de cobranzas y pagos en palabras.',
    '• 🔍 **Auditor IA**: revisa compras y pagos de todas las empresas según los filtros, marca en amarillo lo dudoso. Puede **preguntar** sobre una celda amarilla, **aplicar** los cambios que marque ✔, **deshacer** los últimos o **detener** una revisión larga.',
    '• 📋 **Conciliación por proveedor o cliente**: carga sus facturas y vouchers, la IA propone qué pago va con qué factura; usted acepta y **aplica**. También puede **listar** facturas y vouchers de la selección.',
    '• 📥 **Importar su análisis** (Excel, foto o PDF, o una carpeta de Drive): la IA lo lee y completa los vouchers marcados. Se puede **deshacer**.',
    '• 🔑 **Guardar clave de IA** y 🧪 **Probar conexión**: solo la primera vez o si la IA deja de responder.',
    '**Consejo**: la IA puede equivocarse. Revise siempre lo propuesto (sobre todo montos y RUC) antes de aplicar.'
  ] },
  { id: 'telegram', e: '🤖', t: 'Asistente de Telegram', p: [
    '**Pregunte con sus palabras** (escrito o 🎤 nota de voz). Busca en todas las hojas. Ejemplos:',
    '• ¿Cuánto nos debe GRANIX y desde cuándo?',
    '• Facturas de ALIF por pagar con su detracción',
    '• ¿Qué notificaciones llegaron esta semana?',
    '• Mándame la constancia de la detracción de la F002-6757',
    '**Fotos y PDF**: mande un voucher, factura, estado de cuenta o notificación. Si escribe algo junto, responde eso; si no, le pregunta qué hacer: 🧾 procesar el documento, 🔎 analizar y cruzar, 📥 registrarlo como voucher o 🚚 armar una guía.',
    '**Comandos útiles** (también en el botón ☰ Menú):',
    '• /resumen · /cobrar · /pagar · /vencidas · /detracciones · /retenciones · /honorarios',
    '• /emitir (comprobantes de retención) · /descargar · /estado · /sire · /tc (tipo de cambio)',
    '• /ruc (RUC por nombre) · /voucher (foto de un voucher) · /actualizar',
    '• /avisos (qué le aviso solo) · /recordatorios · /olvidar (empezar de cero) · **deshacer** (la última acción)',
    '**/resumen**, **/cobrar** y **/pagar** llegan en **tablas** (saldo, documentos y vencido por empresa y por cliente o proveedor). Si su Telegram es antiguo, llegan como texto: actualice la app para verlas.',
    'Las listas largas llegan también en **Excel**. Si responde citando un mensaje, el asistente entiende de qué habla.',
    '**/ayuda** llega en un solo mensaje con títulos y listas: toque un tema y se abre ahí mismo. **En un grupo**, la ayuda le llega 👻 **solo a usted** (los demás no la ven), al tocar un botón o si usa /ayuda como comando privado (aparece marcado en el ☰ Menú).'
  ] },
  { id: 'whatsapp', e: '📲', t: 'WhatsApp', p: [
    '**Vouchers por WhatsApp**: reenvíe las fotos o PDF (puede marcar varios). Se registran en la hoja de Vouchers y le avisa el resultado.',
    '• Fotos van a la pestaña **Fotos** y los PDF a **Originales**. Escriba «original» o «foto» en el comentario para cambiarlo esa vez, o **modo original / modo foto / modo auto**.',
    '• **estado**: lo que está en cola · **deshacer**: anula la última acción.',
    '• Al terminar cada tanda le pregunta **de quién son** (un toque). Elija **Revisar con IA** para que lea cada página y complete la factura.',
    '**Preguntas**: lo mismo que en Telegram (la misma IA): escriba o mande nota de voz.',
    '**Guías y retenciones**: igual que en Telegram, con botones. Para emitir siempre le pide confirmar.',
    '**Ayuda**: escriba **ayuda temas** para esta guía, o **ayuda 3** / **ayuda guías** para un tema.'
  ] },
  { id: 'vouchers', e: '🖼', t: 'Sistema de Vouchers (cómo entran y se revisan)', p: [
    'Cada voucher (constancia bancaria) se guarda como una fila con su **imagen**, banco, número de operación, monto, fecha y beneficiario. Esos datos los **lee la IA** de la foto o del PDF.',
    '**Cómo entran**: por Telegram o WhatsApp (reenviando), o dejándolos en la carpeta de Drive de entrada. El sistema los procesa cada pocos minutos.',
    '**En la hoja de Vouchers** (menú 🤖 Vouchers):',
    '• 🪟 **Visor de voucher**: clic en una fila y ve el voucher **original** en grande (la página exacta del PDF), con los datos al lado para **corregirlos**; 📋 copiar imagen; 🗗 ventana aparte que se agranda.',
    '• 🔧 **Reparar imágenes**: rehace las que quedaron como «Ver PDF» o vacías.',
    '• 🧠 **Asistente IA**: sugiere el ID del beneficiario y la factura de los vouchers sin RUC; usted marca ✔ y pasa.',
    'La hoja de Vouchers tiene su propio ❓ Ayuda con el detalle.'
  ] },
  { id: 'retenciones', e: '🧾', t: 'Retenciones (emitir comprobantes CRE)', p: [
    'Cuando la empresa es **agente de retención**, al pagar ciertas facturas retiene un 3 % y debe emitir un **Comprobante de Retención Electrónico (CRE)** en SUNAT.',
    '1. Escriba **/emitir** (o «emite la retención de F001-215»).',
    '2. El asistente muestra lo pendiente con la regla **¿Retener?** (revisa padrones, montos y si el proveedor es buen contribuyente).',
    '3. Toque ✅ y **confirme**: recién ahí el robot lo emite en SUNAT y le manda el PDF.',
    '• «envíame la constancia de retención de …» le reenvía el PDF de una ya emitida.',
    '🔒 Nunca se emite nada sin su confirmación de ESE comprobante.'
  ] },
  { id: 'guias', e: '🚚', t: 'Guías de remisión (traslado de mercadería)', p: [
    'La **guía de remisión** (GRE) acompaña la mercadería. Se emite en **Quesito** (desde la factura) o en **SUNAT SOL**.',
    '**Desde Telegram o WhatsApp**:',
    '1. Mande la factura, el ticket o la tarjeta del vehículo y escriba **guía** (o «emite guía»); luego **listo**.',
    '2. Revise el resumen. Corrija con sus palabras («es privado», «peso 30000», «llegada Av. Mártires»).',
    '3. Toque **✅ Está bien**: el robot la llena **sin emitir** y le manda la **foto de la vista previa**.',
    '4. Si está bien, **✅ Emitir** y confirme. Le llega el número y el PDF.',
    '• «guía f4e71027» vuelve a abrir un caso · «pdf guía EG07-502» le manda el PDF · «en quesito» / «por sunat» cambia dónde se emite.',
    '**Desde la hoja Guías de Remisión**: menú 🚚 Guías, pasos 1 a 6 (crear, traer datos, completar, ver borrador, vista previa, emitir). Su pestaña 📖 Ayuda tiene el detalle.',
    '**Ver al robot trabajar**: escriba **en vivo sí**. Le llega un enlace 📺 y luego uno 🎥 de video donde puede hacer clic (por ejemplo, resolver el captcha si Quesito pide iniciar sesión).',
    '**Usar su PC**: con la ventana «Robot de guías» abierta y **en pc sí**, Quesito se llena en el Chrome de su PC, a la vista.'
  ] },
  { id: 'sunat', e: '⬇', t: 'SUNAT: descargas automáticas y a pedido', p: [
    'Los robots bajan de SUNAT, solos, varias veces por semana: **SIRE** (compras y ventas), **retenciones**, **detracciones**, **honorarios** y el **Buzón SOL** (notificaciones).',
    '• **/estado**: si las descargas automáticas corrieron bien.',
    '• **/descargar**: pedir una ahora (le pregunta qué y de qué empresa).',
    '• **/sire**: solo el reporte del SIRE, rápido (ej. «/sire granix 202601-202609», «/sire todas mes anterior»).',
    '• **/avisos**: elija qué quiere que le avise solo (notificaciones nuevas, vencimientos, errores).',
    '• **/notificaciones** (📬 Buzón SUNAT): tabla con marcas **🆕 nueva** (llegó en la última descarga), **🔵 sin leer** y **🔴 coactiva o embargo**. Botones para ver **solo nuevas**, **sin leer** o **coactivas**, y **📄 n** para recibir el PDF. Ojo: al bajar el PDF de SUNAT, SUNAT la marca como leída.',
    'Cada tema tiene su hoja (Retenciones, Detracciones, Honorarios, Notificaciones, Panel SIRE) con los PDF en Drive.'
  ] },
  { id: 'seguridad', e: '🔒', t: 'Seguridad y buenas prácticas', p: [
    '• El asistente **consulta y propone**; para escribir en una hoja, emitir una guía o un CRE **siempre pide su ✅**.',
    '• **deshacer** (Telegram/WhatsApp) o ↩️ en los menús anula la última acción.',
    '• Las **claves** (SUNAT SOL, Quesito, IA) no están en las hojas: están guardadas como secretos.',
    '• No mande contraseñas ni códigos por chat. Si un robot necesita iniciar sesión, usted lo hace en su ventana o en el video.',
    '• Si algo se ve raro, pregunte: «¿por qué esta factura sale pendiente?». El asistente explica.'
  ] },
  { id: 'glosario', e: '📚', t: 'Palabras técnicas (glosario)', p: [
    '• **IA (inteligencia artificial)**: programa que entiende texto e imágenes y propone respuestas. Aquí se usa Gemini, de Google.',
    '• **SIRE**: registro de compras y ventas que SUNAT arma con las facturas electrónicas. De ahí salen las facturas de la hoja.',
    '• **SOL**: la clave de SUNAT Operaciones en Línea de cada empresa.',
    '• **Voucher**: constancia de un depósito o transferencia bancaria.',
    '• **Cruce / conciliación**: juntar cada pago (voucher) con la factura que paga.',
    '• **Retención** y **CRE**: el 3 % que retiene un agente de retención, y el comprobante que lo acredita.',
    '• **Detracción (SPOT)**: porcentaje que el cliente deposita en la cuenta del Banco de la Nación del proveedor.',
    '• **Padrón**: listas oficiales de SUNAT (agentes de retención, buenos contribuyentes, SSCO).',
    '• **GRE**: guía de remisión electrónica. **Quesito**: el sistema de facturación donde también se emiten guías.',
    '• **Vista previa**: el robot llena todo pero NO emite; usted revisa la foto.',
    '• **Robot / GitHub**: programas que corren en servidores de GitHub y hacen el trabajo repetitivo en las páginas web.',
    '• **Sesión / captcha**: «sesión» = haber iniciado sesión en una página; «captcha» = la prueba de «no soy un robot».',
    '• **En vivo / video 🎥**: ver la pantalla del robot mientras trabaja (y poder hacer clic).',
    '• **Ejecutor de la PC**: programa en su computadora que deja que el robot use su Chrome.',
    '• **Drive**: donde se guardan los PDF y fotos. **Apps Script**: el código que vive dentro de las hojas.'
  ] }
];

/** Sección por id, número (1…) o palabra («guías», «whatsapp»). */
function AYU_buscar_(q) {
  q = String(q || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!q) return null;
  var n = parseInt(q, 10);
  if (n >= 1 && n <= AYU_SECCIONES_.length) return AYU_SECCIONES_[n - 1];
  var plano = function (t) { return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  return AYU_SECCIONES_.filter(function (s) { return s.id === q || plano(s.t).indexOf(q) >= 0; })[0] ||
    AYU_SECCIONES_.filter(function (s) { return plano(s.p.join(' ')).indexOf(q) >= 0; })[0] || null;
}

/** Texto para Telegram (HTML) o WhatsApp (*negrita*). */
function AYU_texto_(s, canal) {
  var tg = canal !== 'wa';
  var fmt = function (t) {
    var x = tg ? TG_esc_(t) : String(t);
    return x.replace(/\*\*(.+?)\*\*/g, tg ? '<b>$1</b>' : '*$1*');
  };
  return (tg ? '<b>' + s.e + ' ' + TG_esc_(s.t) + '</b>' : '*' + s.e + ' ' + s.t + '*') + '\n\n' + s.p.map(fmt).join('\n');
}

function AYU_indiceTexto_(canal) {
  var tg = canal !== 'wa';
  return (tg ? '❓ <b>Centro de ayuda</b>' : '❓ *Centro de ayuda*') + '\nElija un tema' + (tg ? '' : ' (escriba *ayuda* y el número, ej. *ayuda 8*)') + ':\n\n' +
    AYU_SECCIONES_.map(function (s, i) { return (i + 1) + '. ' + s.e + ' ' + s.t; }).join('\n');
}

/** ✨ Contenido de un tema en HTML enriquecido de Telegram: viñetas → lista, «1. » → pasos numerados. */
function AYU_ricoCuerpo_(s) {
  var html = '', lista = '';
  var cerrar = function () { if (lista) { html += '</' + lista + '>'; lista = ''; } };
  s.p.forEach(function (t) {
    var m = String(t).match(/^(•\s|(\d+)\.\s)/), tipo = !m ? '' : m[2] ? 'ol' : 'ul';
    var x = TG_esc_(m ? t.slice(m[0].length) : t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (tipo !== lista) { cerrar(); if (tipo) { html += tipo === 'ol' ? '<ol start="' + m[2] + '">' : '<ul>'; lista = tipo; } }
    html += tipo ? '<li>' + x + '</li>' : '<p>' + x + '</p>';
  });
  cerrar();
  return html;
}

/** ✨ Índice enriquecido: todos los temas en un solo mensaje, cada uno se abre tocándolo (<details>). */
function AYU_ricoIndice_() {
  return '<h2>❓ Centro de ayuda</h2><p>Toque un tema para abrirlo aquí mismo, o use los botones de abajo.</p>' +
    AYU_SECCIONES_.map(function (s) { return '<details><summary>' + s.e + ' ' + TG_esc_(s.t) + '</summary>' + AYU_ricoCuerpo_(s) + '</details>'; }).join('') +
    '<footer>En la hoja: menú ❓ Ayuda · En WhatsApp: escriba «ayuda temas»</footer>';
}

/** Telegram: /ayuda (índice con botones) y /ayuda <tema>. */
function AYU_telegram_(ctx, arg) {
  var s = AYU_buscar_(arg);
  var botones = [], fila = [];
  AYU_SECCIONES_.forEach(function (x) {
    fila.push({ text: x.e + ' ' + x.t.split(/[:(]/)[0].trim().slice(0, 28), callback_data: 'c:ayuda ' + x.id });
    if (fila.length === 2) { botones.push(fila); fila = []; }
  });
  if (fila.length) botones.push(fila);
  // ✨ Mensaje enriquecido (títulos, listas, temas que se abren); si Telegram no lo acepta, el HTML de siempre.
  // Desde un botón se cambia el MISMO mensaje; en grupos llega 👻 solo a quien lo pidió (TG_mostrarRico_).
  if (!s) return TG_mostrarRico_(ctx, AYU_ricoIndice_(), AYU_indiceTexto_('tg'), botones);
  var i = AYU_SECCIONES_.indexOf(s), sig = AYU_SECCIONES_[i + 1];
  var nav = [{ text: '📖 Temas', callback_data: 'c:ayuda' }];
  if (sig) nav.push({ text: 'Siguiente: ' + sig.e + ' ' + sig.t.split(/[:(]/)[0].trim().slice(0, 22) + ' ▶', callback_data: 'c:ayuda ' + sig.id });
  return TG_mostrarRico_(ctx, '<h2>' + s.e + ' ' + TG_esc_(s.t) + '</h2>' + AYU_ricoCuerpo_(s), AYU_texto_(s, 'tg'), [nav]);
}

/** WhatsApp: «ayuda temas», «ayuda 3», «ayuda guías». null si no es un pedido de ayuda. */
function AYU_whatsapp_(texto) {
  var m = String(texto || '').trim().match(/^\/?(?:ayuda|help|instrucciones|c[oó]mo (?:se )?usa)\s*(.*)$/i);
  if (!m) return null;
  var arg = m[1].replace(/^(de|del|sobre|temas?)\s*/i, '').trim();
  var s = AYU_buscar_(arg);
  var txt = s ? AYU_texto_(s, 'wa') + '\n\n📖 *ayuda temas*: ver todos los temas' : AYU_indiceTexto_('wa');
  return { ok: true, respuesta: txt, tablas: [], sugerencias: [], archivos: [], avisos: [] };
}

/* ---------------- en la hoja: ventana con índice y buscador ---------------- */

function AYU_menuAbrir() {
  var t = HtmlService.createTemplateFromFile('AyudaVista');
  t.datos = JSON.stringify(AYU_SECCIONES_);
  SpreadsheetApp.getUi().showModelessDialog(t.evaluate().setWidth(980).setHeight(680), '❓ Centro de ayuda');
}
