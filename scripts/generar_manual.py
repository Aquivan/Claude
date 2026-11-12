"""Genera el MANUAL DEL PROYECTO para personas que recién empiezan:
   docs/MANUAL_DEL_PROYECTO.xlsx  (Excel, una pestaña por tema)
   docs/MANUAL_DEL_PROYECTO.md    (el mismo contenido en texto, se lee directo en GitHub)

Cómo volver a generarlo (cada vez que se agrega o mejora algo):
   python3 scripts/generar_manual.py
Lo automático (archivos, funciones, robots de GitHub, propiedades, menús) se lee del propio código.
Lo explicado a mano (proyectos, claves, comandos, flujos, glosario, historial) está en este archivo:
al agregar una función nueva, sume una línea en la lista que corresponda y en HISTORIAL.
Nunca escriba aquí valores de claves, tokens, teléfonos ni datos de clientes: solo NOMBRES y dónde se cambian.
"""
import os, sys, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'scripts'))
from manual_recoger import recoger  # noqa: E402

D = recoger(RAIZ)

# ─────────────────────────────── contenido explicado a mano ───────────────────────────────

INICIO = [
    ('¿Qué es esto?', 'El manual de todo el sistema contable del grupo de empresas: qué hace cada parte, dónde está, cómo trabaja y dónde se cambian las claves. Está escrito para alguien que recién empieza.'),
    ('¿Cómo leerlo?', 'Empiece por «Mapa general» (la idea completa en 10 pasos) y «Proyectos». Si necesita cambiar una clave, vaya a «Claves y APIs». Si algo falla, vea «Flujos» y «Mantenimiento». Las pestañas «Archivos», «Funciones», «Robots GitHub», «Propiedades» y «Menús» se arman solas leyendo el código.'),
    ('¿Dónde está guardado?', 'En GitHub, repositorio Aquivan/Claude, carpeta docs/: MANUAL_DEL_PROYECTO.xlsx (este Excel) y MANUAL_DEL_PROYECTO.md (el mismo texto, se lee directo en GitHub).'),
    ('¿Cómo se actualiza?', 'Con «python3 scripts/generar_manual.py». Cada vez que se agrega o mejora algo, se suma su explicación en ese archivo (listas PROYECTOS, COMANDOS, FLUJOS, HISTORIAL…) y se vuelve a generar. Así el manual nunca queda viejo.'),
    ('Reglas de oro', '1) Las claves nunca van en el código ni en GitHub (solo en Secrets o Propiedades del script). 2) Nada se emite en SUNAT (guía o retención) sin aprobación expresa. 3) Las contraseñas y códigos SMS los escribe la persona, nunca un robot. 4) Toda función nueva se explica en la Ayuda (❓) y en este manual. 5) No se resuelven captchas automáticamente: los resuelve la persona.'),
    ('Generado', datetime.datetime.now().strftime('%d/%m/%Y %H:%M')),
]

MAPA = [
    (1, 'SUNAT', 'De SUNAT salen los datos: SIRE (compras y ventas), facturas PDF/XML, retenciones, detracciones, honorarios y Buzón Electrónico. También es donde se emiten guías (GRE) y retenciones (CRE).'),
    (2, 'Robots de GitHub (GitHub Actions)', 'Programas en Python que entran a SUNAT (API oficial del SIRE o el portal SOL con un navegador) y bajan los datos. Corren en máquinas de GitHub, a horas fijas o cuando se les pide. Archivos .yml en .github/workflows/ y scripts .py en cada carpeta.'),
    (3, 'Repositorio (GitHub)', 'Los robots guardan lo descargado en el repositorio: sire/, facturas_descargadas/, retenciones/datos/, detracciones/datos/, honorarios/datos/, notificaciones/datos/. Los PDF de facturas se suben además a Cloudflare R2 (enlaces públicos).'),
    (4, 'Hojas de Google (Apps Script)', 'Cada proyecto tiene su hoja de Google con código (Apps Script) que lee lo que dejó GitHub, lo ordena en pestañas y copia los PDF a Drive: Panel SIRE / Liquidación IGV, Retenciones, Honorarios, Notificaciones, Detracciones, Guías.'),
    (5, 'Sistema de Vouchers', 'Hoja aparte donde llegan los vouchers (fotos y PDF de pagos). Un bot de Telegram y la carpeta «Nuevos» de Drive los reciben; Gemini (IA de Google) los lee y escribe fecha, banco, operación, monto y beneficiario. Pestañas Originales y Fotos.'),
    (6, 'Cuentas por Cobrar y Pagar (Cobranzas)', 'El corazón. Junta las facturas del SIRE, los vouchers, el registro manual, retenciones y detracciones, y con el «motor de cruce» (Motor.js) calcula cuánto se debe de cada factura. Pestañas 📋 Documentos, 💳 Movimientos, ✅ Conciliar, 🔎 Consulta, 🎯 Panel.'),
    (7, 'Asistente IA', 'Dentro de Cobranzas (y también en la hoja de Vouchers): conciliar con IA, chat con la IA, auditor IA, importar análisis, RUC por nombre, y la 🧩 Mesa de conciliación (cruzar facturas y vouchers con líneas).'),
    (8, 'Bot de Telegram', 'Asistente nuevo que vive dentro de Cobranzas (carpeta cobranzas/telegram/). Responde preguntas, procesa vouchers, emite retenciones y guías (con aprobación), avisa novedades y vencimientos.'),
    (9, 'WhatsApp', 'Proyecto aparte (vouchers_whatsapp/) con su hoja. Meta → puente de Cloudflare (worker.js) → Apps Script. Recibe vouchers y usa la misma IA y los mismos comandos que Telegram.'),
    (10, 'Despliegue', 'Cuando se cambia el código y se sube a GitHub, un robot «Desplegar …» lo copia a la hoja correspondiente (con clasp). Así nunca se copia código a mano.'),
]

PROYECTOS = [
    ('Panel SIRE / Liquidación IGV', 'apps_script/', 'Hoja de control SIRE (todas las empresas)', 'Pide a GitHub el SIRE de compras y ventas, lo pone en hojas «Liquidacion IGV <RUC> - <año>», calcula IGV por pagar, saldo a favor y renta; carpetas en Drive por RUC/año/mes.', 'deploy-appsscript.yml'),
    ('Descarga SIRE y facturas', 'scripts/, sire/, facturas_descargadas/', 'GitHub Actions', 'Baja el SIRE por la API oficial (sire_client.py), lo convierte a CSV, baja PDF/XML de cada factura y los sube a R2. Corre cada día de madrugada.', 'sire-cadena-completa.yml, sire-solo-reporte.yml, sire-descargar.yml, sunat-*.yml'),
    ('Cuentas por Cobrar y Pagar · Grupo', 'cobranzas/', 'Hoja Cobranzas', 'Motor de cruce facturas ↔ pagos, estados de cuenta, conciliación, retenciones por emitir, SSCO, padrones, respaldos, Asistente IA y 🧩 Mesa de conciliación.', 'deploy-cobranzas.yml'),
    ('🧩 Mesa de conciliación', 'cobranzas/Mesa.js, MesaVista.html', 'Ventana en Cobranzas y en Vouchers (también por enlace desde el celular)', 'Facturas a un lado, vouchers al otro; se cruzan arrastrando líneas, con monto por línea, retenciones, devoluciones, pago sin voucher, estado de cuenta (antes/después), calculadora, historial y deshacer.', 'deploy-cobranzas.yml'),
    ('🔗 Fotos → Originales', 'cobranzas/VcoCopias.js, VcoVista.html', 'Cobranzas (automático) y menú', 'Si un voucher se trabajó primero como foto y luego llegó el original, copia lo trabajado (empresa, factura, RUC…) a Originales, solo en celdas vacías; avisa si dicen distinto.', 'deploy-cobranzas.yml'),
    ('🤖 Asistente de Telegram', 'cobranzas/telegram/', 'Dentro de Cobranzas (aplicación web)', 'Chat con IA, procesar vouchers, deshacer, emitir retenciones, guías, SIRE rápido, descargas, avisos, vencimientos, minutos de GitHub, Mesa por enlace.', 'deploy-cobranzas.yml'),
    ('🌐 Portal web de Vouchers', 'vouchers_portal/', 'Proyecto Apps Script aparte (aplicación web) sobre la hoja «Sistema de Vouchers»', 'La hoja de Vouchers desde el celular o la PC con enlace, usuario y PIN: buscar/filtrar, ver imagen y original, corregir, releer con IA, subir (foto, escanear a PDF), pendientes, resumen y usuarios por permiso (ver/subir/editar/admin).', 'deploy-vouchers-portal.yml'),
    ('📲 Vouchers por WhatsApp', 'vouchers_whatsapp/', 'Hoja «Vouchers WhatsApp» + puente Cloudflare', 'Recibe fotos/PDF por WhatsApp, los manda a la entrada de Vouchers y responde el resultado; mismas funciones que Telegram.', 'deploy-vouchers-whatsapp.yml'),
    ('Sistema de Vouchers (cambios)', 'vouchers_bot_cambios/src/', 'Hoja «Sistema de Vouchers»', 'Solo los archivos que se cambian del bot original: visor de voucher, releer página, reparar imágenes, subir voucher, prompts de Gemini, ayuda.', 'vouchers-bot-cambios.yml'),
    ('Asistente IA en Vouchers', 'vouchers_ia/', 'Hoja «Sistema de Vouchers»', 'Pone en la hoja de Vouchers el mismo 🧠 Asistente IA de Cobranzas (incluida la Mesa y Fotos→Originales), sin tocar el bot.', 'asistente-vouchers.yml'),
    ('Respaldo del bot de Vouchers', 'vouchers_bot_respaldo/', '— (solo copia)', 'Copia fiel del código que corre hoy en la hoja de Vouchers. Se actualiza sola los lunes.', 'respaldo-vouchers-bot.yml'),
    ('Retenciones · Grupo', 'retenciones/', 'Hoja propia + GitHub', 'Baja de SUNAT SOL los comprobantes de retención emitidos y recibidos (PDF/XML). Emisión de CRE con vista previa (retenciones/emision/).', 'retenciones-descargar.yml, retenciones-cre.yml, deploy-retenciones.yml'),
    ('Honorarios · Grupo', 'honorarios/', 'Hoja propia + GitHub', 'Baja los recibos por honorarios recibidos y los concilia con los vouchers.', 'honorarios-descargar.yml, deploy-honorarios.yml'),
    ('Notificaciones · Grupo', 'notificaciones/', 'Hoja propia + GitHub', 'Baja el Buzón Electrónico de SUNAT (notificaciones y mensajes, con PDF) dos veces al día.', 'notificaciones-descargar.yml, deploy-notificaciones.yml'),
    ('Detracciones · Grupo', 'detracciones/', 'Hoja propia + GitHub', 'Baja los depósitos de detracciones (SPOT) y sus constancias, una vez al día de lunes a viernes.', 'detracciones-descargar.yml, deploy-detracciones.yml'),
    ('🚚 Guías de Remisión · Grupo', 'guias/', 'Hoja propia + portal web', 'Una fila = una guía con todos sus datos; catálogos, revisión automática, formulario, portal para celular; emite con el robot de Quesito o de SUNAT.', 'deploy-guias.yml, gre-quesito.yml'),
    ('📑 Declaraciones · Grupo', 'declaraciones/', 'Hoja propia + aplicación web', 'Baja de SUNAT SOL las declaraciones PDT 621 (IGV-Renta), 601 (PLAME) y 626 (Agentes de Retención) con su constancia PDF, incluidas rectificatorias (la última es la vigente; las anteriores quedan de respaldo). Reportes por periodo, tributos y casillas. Nada queda en GitHub: los PDF van directo a la hoja con una llave de un solo uso. Sola una vez al mes (día 28).', 'declaraciones-descargar.yml, deploy-declaraciones.yml'),
    ('GRE por SUNAT', 'gre_sunat/', 'GitHub Actions (pedido por el bot)', 'Robot que llena la guía en SUNAT SOL: modo vista (se detiene antes de emitir) o emitir (solo con aprobación).', 'gre-sunat.yml'),
]

# Secretos de GitHub (Settings → Secrets and variables → Actions). Solo NOMBRES.
SECRETOS = {
    'SUNAT_RUC': 'RUC de la empresa con la que entra el robot a SUNAT SOL (va en cada «Environment» de empresa).',
    'SUNAT_USUARIO': 'Usuario SOL de esa empresa (Environment de la empresa).',
    'SUNAT_CLAVE': 'Clave SOL de esa empresa (Environment de la empresa).',
    'SUNAT_CLAVES': 'Lista de claves SOL de varias empresas en un solo secreto, para que una sola máquina baje varias (ahorra minutos). Se revisa con «Verificar SUNAT_CLAVES».',
    'SIRE_CLIENT_ID': 'ID de la aplicación de la API SIRE (se crea en SUNAT SOL → credenciales de API).',
    'SIRE_CLIENT_SECRET': 'Clave de esa aplicación de la API SIRE.',
    'R2_ACCOUNT_ID': 'Cuenta de Cloudflare R2 (donde se guardan los PDF de facturas).',
    'R2_ACCESS_KEY_ID': 'Llave de acceso a R2.',
    'R2_SECRET_ACCESS_KEY': 'Clave secreta de R2.',
    'R2_BUCKET': 'Nombre del «bucket» (depósito) de R2.',
    'SHEETS_WEBHOOK_URL': 'Dirección de la hoja SIRE a la que GitHub avisa al terminar (aviso instantáneo).',
    'SHEETS_WEBHOOK_SECRET': 'Secreto de ese aviso (lo comparte con la propiedad WEBHOOK_SECRET de la hoja).',
    'SHEET_WEBHOOK_URL': 'Igual que SHEETS_WEBHOOK_URL (nombre antiguo, se acepta cualquiera).',
    'SHEET_WEBHOOK_SECRET': 'Igual que SHEETS_WEBHOOK_SECRET (nombre antiguo).',
    'CLASPRC_JSON': 'Permiso de Google para que los robots de despliegue suban el código a las hojas (archivo .clasprc.json de clasp). Si vence, los «Desplegar …» fallan.',
    'SCRIPT_ID': 'ID del proyecto Apps Script del Panel SIRE.',
    'QUESITO_CORREO': 'Correo de la cuenta de Quesito.pe (guías).',
    'QUESITO_CLAVE': 'Clave de Quesito.pe.',
    'QUESITO_SESION': 'Galletas (cookies) de la sesión de Quesito. Solo aquí, nunca en archivos.',
}

CLAVES = [
    ('GitHub Secrets', 'Claves SOL, API SIRE, R2, Quesito, permiso de clasp', 'github.com/Aquivan/Claude → Settings → Secrets and variables → Actions (y «Environments» para cada empresa)', 'Se pega el valor nuevo con «Update». Nunca se ven después de guardadas. Lista en la pestaña «Robots GitHub» (columna Secretos).'),
    ('Clave de IA (Gemini y otras)', 'Gemini, Groq, Qwen, OpenAI, DeepSeek, OpenRouter', 'Hoja Cobranzas o Vouchers → menú 🧠 Asistente IA → 🔑 Guardar clave de IA (de esta pestaña); audios: 🎤 Guardar clave de Groq', 'Se guarda en Propiedades del script (IA_KEY_<PROVEEDOR>; Gemini usa también GEMINI_API_KEY del bot). El modelo se cambia en IACliente.js (IA_PROVEEDORES_) o en la pestaña del asistente. «🧪 Probar modelos» compara cuál responde mejor.'),
    ('Bot de Telegram (asistente)', 'Token de @BotFather', 'Hoja Cobranzas → menú 🤖 Telegram → 1️⃣ Conectar bot', 'Propiedad TG_BOT_TOKEN. El secreto del webhook (TG_WEBHOOK_SECRETO) se crea solo. Debe ser un bot distinto al de Vouchers.'),
    ('Bot de Telegram (Vouchers)', 'Token del bot original', 'Hoja Sistema de Vouchers → Propiedades del script', 'Propiedades TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ALLOWED_CHAT_IDS. No reutilizar en el asistente.'),
    ('Token de GitHub (para las hojas)', 'Permite a las hojas leer datos y lanzar robots', 'Cada hoja: menú → 🔑 Token de GitHub (Retenciones, Honorarios, Notificaciones, Detracciones, Guías, Telegram)', 'Propiedades RET_/HON_/NOT_/DET_/GR_/TG_GITHUB_TOKEN. Se crea en GitHub → Settings → Developer settings → Fine-grained tokens, con permiso «Actions: Read and write» y «Contents: Read» sobre Aquivan/Claude. Vence: renovarlo y pegarlo en cada hoja.'),
    ('WhatsApp (Meta)', 'Token de la app de Meta, número, verificación', 'Hoja Vouchers WhatsApp → menú 📲 WhatsApp → 1. Configurar; y 2. Datos para Cloudflare y Meta', 'Propiedades WA_* (WA_VERIFY, WA_GAS_TOKEN…). El puente Cloudflare (worker.js) usa sus propias variables: VERIFY_TOKEN, APP_SECRET, GAS_URL, GAS_TOKEN (en el panel de Cloudflare → Workers → Settings → Variables). Los números autorizados solo en el menú «Números autorizados».'),
    ('Token de GitHub de Declaraciones', 'La hoja Declaraciones lanza su robot', 'Hoja Declaraciones · Grupo → menú 📑 Declaraciones → 🔑 Guardar token de GitHub', 'Propiedad DEC_GITHUB_TOKEN (permiso «Actions: Read and write»). La llave de un solo uso para recibir las constancias la crea la hoja sola (DEC_LLAVES, vence en 6 h).'),
    ('Repositorio y rama', 'Dónde corren los robots', 'Hoja Cobranzas → pestaña 🤖 Telegram (Repositorio de GitHub, Rama de GitHub)', 'Si se cambia de repositorio o rama, se cambia ahí y en las pestañas Config de cada hoja.'),
    ('Límite de minutos', 'Minutos gratis de GitHub al mes', 'Propiedad del script TGM_LIMITE en Cobranzas', 'Por defecto 2000. Solo sirve para los avisos de % (comando «minutos»).'),
    ('Conexión Vouchers ↔ Cobranzas', 'El Asistente IA y la Mesa de la hoja de Vouchers usan Cobranzas', 'Propiedades VIA_CLAVE (Vouchers) y VCH_CLAVE (Cobranzas)', 'Se crean y registran solas la primera vez. Para cambiarla: borrar VCH_CLAVE en Cobranzas y VIA_CLAVE en Vouchers; se vuelve a crear sola.'),
]

PROPS = {
    'GEMINI_API_KEY': 'Clave de Gemini del bot de Vouchers (también la usa la IA si no hay otra).',
    'CIA_KEY_GEMINIGOOGLE': 'Clave de Gemini guardada por la conciliación con IA.',
    'MODELOS_GEMINI': 'Lista de modelos de Gemini a probar en orden.',
    'TGM_LIMITE': 'Límite de minutos de GitHub por mes (por defecto 2000).',
    'TGM_ESTADO': 'Lo que va contando el medidor de minutos (no tocar).',
    'MESA_ETAPA': 'Etapa del recálculo pedido por la Mesa (cola, cálculo, espera).',
    'MESA_ULTIMA': 'Hora de la última actualización hecha desde la Mesa.',
    'VCO_DESDE': 'Desde qué fecha se copian solos los datos de Fotos a Originales.',
    'VIA_CLAVE': 'Clave compartida hoja de Vouchers ↔ Cobranzas.',
    'WA_VERIFY': 'Palabra de verificación del webhook de WhatsApp (la misma en Cloudflare).',
    'WA_GAS_TOKEN': 'Secreto con el que el puente de Cloudflare entra a la hoja de WhatsApp.',
    'DEC_GITHUB_TOKEN': 'Token de GitHub de la hoja Declaraciones (lanza su robot).',
    'DEC_LLAVES': 'Llaves de un solo uso para recibir las constancias (las crea la hoja; vencen en 6 h).',
    'WEBHOOK_SECRET': 'Secreto del aviso instantáneo GitHub → hoja SIRE.',
    'HORA_EJECUCION_DIARIA_PERU': 'Hora de la descarga diaria puntual (hora de Lima).',
    'TGR_DIAS_ATRAS': 'Cuántos días atrás mira el bot los pagos sin retención.',
    'R2_URL_BASE': 'Dirección pública de Cloudflare R2 para los PDF de facturas.',
    'TGP_MODELO_LECTOR': 'Modelo de IA que lee los documentos en «Procesar documento».',
}

COMANDOS = [
    ('ayuda / /ayuda', 'Telegram y WhatsApp («ayuda temas»)', 'Centro de ayuda por temas (el mismo de la hoja).'),
    ('pregunta libre', 'Ambos', 'Cualquier pregunta: facturas por cobrar o pagar, N/C, pagos, vouchers, SIRE, retenciones, detracciones, honorarios, buzón.'),
    ('foto o PDF', 'Ambos', 'Analizar y cruzar, 📥 Registrar como voucher, 🧾 Procesar documento (lee cada página y completa la factura).'),
    ('/resumen /cobrar /pagar /vencidas', 'Telegram (y textos parecidos en WhatsApp)', 'Respuestas rápidas sin IA.'),
    ('/notificaciones /detracciones /retenciones /honorarios /tc', 'Telegram', 'Listas rápidas con PDF; tipo de cambio SUNAT.'),
    ('/emitir · emitir', 'Ambos', 'Retenciones (CRE) pendientes: 👁 vista previa y ✅ emitir (pide confirmar; solo autorizados).'),
    ('guía …', 'Ambos', 'Guía de remisión con fotos/PDF + datos; vista previa y emitir con aprobación (Quesito o SUNAT).'),
    ('/sire · sire granix 202609', 'Ambos', 'SIRE solo reporte (rápido) de una, varias o todas las empresas.'),
    ('/descargar · /estado', 'Telegram', 'Lanzar una descarga de SUNAT y ver cómo terminó cada robot (🔁 reintentar).'),
    ('procesados', 'Ambos', 'Vouchers registrados por tanda y completar el RUC que falte.'),
    ('releer Originales 2666', 'Ambos', 'Volver a leer con IA la página de una fila de Vouchers.'),
    ('ruc <nombre>', 'Ambos', 'Buscar el RUC por nombre en el padrón de SUNAT.'),
    ('deshacer · /deshacer', 'Ambos', 'Deshace TODO lo que hizo la última acción (filas, archivos, datos).'),
    ('mesa', 'Ambos', 'Manda el enlace de la 🧩 Mesa de conciliación para abrirla en el celular (vale 6 horas).'),
    ('minutos', 'Ambos', 'Cuántos minutos de GitHub se usaron este mes y cuáles robots gastan más.'),
    ('/vencimientos · vencimientos', 'Ambos', 'Cronograma SUNAT (IGV-Renta, PLAME, SIRE) por último dígito del RUC.'),
    ('en vivo sí / en vivo no', 'Ambos', 'Ver la pantalla del robot (SUNAT / Quesito) mientras trabaja.'),
    ('/avisos · /recordatorios · /usuarios · /olvidar', 'Telegram', 'Elegir avisos, ver recordatorios, aprobar personas (admin), empezar la conversación de cero.'),
]

FLUJOS = [
    ('Voucher que llega', '1) La persona manda la foto/PDF por Telegram, WhatsApp o lo sube a la carpeta «Nuevos». 2) La hoja de Vouchers lo lee con Gemini (VoucherProcessor.js) y escribe una fila en Originales o Fotos. 3) Cada 10 min Cobranzas lo lee (Fuentes.js), el motor lo cruza con la factura indicada en «Tipo y N° Doc.» o la sugiere (✅ Conciliar). 4) Si falta algo, se completa en la Mesa, en la hoja o por el bot.'),
    ('SIRE diario', '1) De madrugada se lanza «SIRE completo» (la hoja lo pide a hora exacta porque el reloj de GitHub se atrasa). 2) sire_client.py pide el reporte a la API de SUNAT; si SUNAT está lenta sale «pendiente» y se reintenta. 3) Se convierte a CSV, se bajan PDF/XML y se suben a R2. 4) Se avisa a la hoja SIRE, que importa a las Liquidaciones IGV. 5) Cobranzas lo lee en su próxima actualización.'),
    ('Cruce en la 🧩 Mesa', '1) Menú 🧠 Asistente IA → 🧩 Mesa (o «mesa» por el bot). 2) Elegir por pagar/cobrar, empresa o grupo. 3) Arrastrar desde ⦿ del voucher a la factura (o al revés); poner monto por línea si hace falta. 4) 💾 Guardar: escribe en la columna «Tipo y N° Doc.» del voucher y anota en _Mesa. 5) Cobranzas recalcula (⚡ Recalcular ahora para no esperar). 6) ↩️ Deshacer o 🧹 Quitar cruces si se equivocó.'),
    ('Retención (CRE)', '1) El motor detecta pagos a proveedores que debían retener 3% y no tienen CRE. 2) /emitir lista los pendientes. 3) 👁 Vista previa: el robot llena SUNAT SEE-SOL y se detiene. 4) ✅ Emitir solo con confirmación expresa. 5) El robot avisa el número del CRE.'),
    ('Guía de remisión (GRE)', '1) Fila en la hoja Guías, o fotos + texto por el bot. 2) 👁 Vista previa (Quesito o SUNAT, sin emitir). 3) ✅ Emitir con aprobación. 4) Si aparece captcha, la persona lo resuelve desde Telegram/WhatsApp.'),
    ('Declaraciones (PDT 621/601/626)', '1) El día 28 (o a mano: 📑 Declaraciones → ⬇ Pedir a SUNAT) la hoja crea una llave de un solo uso y lanza el robot. 2) El robot entra a SOL → Consulta de Declaraciones y Pagos, busca los últimos meses y le pregunta a la hoja cuáles le faltan. 3) Por cada una nueva abre la constancia, baja el PDF y lo manda a la hoja (nada queda en GitHub). 4) La hoja guarda el PDF en Drive, marca la última presentada como Vigente y las anteriores como Respaldo, y rehace 📊 Panel, 🗂 Por periodo, 🧾 Tributos y 🔢 Casillas.'),
    ('Devolución de un proveedor', 'En el registro manual o en la Mesa se marca «DEVOLUCION op <número>» con el monto; se une con línea al depósito, a la factura o a la N/C. Así el saldo a favor no queda «sin aplicar».'),
    ('Cambio de código', '1) Se cambia el archivo en la carpeta del proyecto. 2) Se explica en la Ayuda y en este manual. 3) Se sube a GitHub (rama de trabajo y luego la rama principal claude/python-codes-izve18). 4) El robot «Desplegar …» de esa carpeta lo pasa a la hoja. 5) Se prueba en la hoja.'),
]

MANTENIMIENTO = [
    ('Si un robot de SUNAT falla', 'Ver el mensaje en Telegram o /estado. «SUNAT lenta», «Timeout» o «HTTP 5xx» casi siempre es SUNAT: se reintenta solo o con 🔁. Si dice clave incorrecta, revisar SUNAT_CLAVE del Environment de esa empresa.'),
    ('Si un «Desplegar …» falla', 'Casi siempre es CLASPRC_JSON vencido: volver a iniciar sesión con clasp y pegar el .clasprc.json nuevo en el secreto.'),
    ('Si la IA no responde', 'Clave vencida o modelo saturado: «🧪 Probar modelos» y cambiar de modelo o pegar clave nueva (🔑 Guardar clave de IA).'),
    ('Si una hoja no ve datos nuevos', 'Revisar el token de GitHub de esa hoja (menú → 🔑) y que la rama en Config sea la correcta.'),
    ('Ramas de GitHub', 'Los robots y hojas usan la rama claude/python-codes-izve18. Los cambios se hacen en una rama de trabajo y se unen a esa.'),
    ('Respaldos', 'Cobranzas respalda sola el registro manual y reasignaciones (Respaldos.js). El código de Vouchers se respalda cada lunes en vouchers_bot_respaldo/.'),
    ('Repositorio público', 'Mientras el repositorio sea público, sus datos (facturas, buzón, etc.) se pueden ver. Se recomienda pasarlo a privado: GitHub → Settings → General → Danger Zone → Change visibility. Privado gasta minutos (2,000 gratis al mes): ver «minutos».'),
    ('Agregar una empresa', 'Agregarla en empresas.json, crear su Environment en GitHub con SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE (y su línea en SUNAT_CLAVES), y verificar con «Verificar SUNAT_CLAVES».'),
]

GLOSARIO = [
    ('Apps Script', 'El lenguaje de programación dentro de las hojas de Google (parecido a JavaScript). Archivos .js / .gs y pantallas .html.'),
    ('GitHub', 'Sitio donde se guarda el código y donde corren los robots (GitHub Actions).'),
    ('Workflow / robot (.yml)', 'Receta que le dice a GitHub qué programa correr, cuándo y con qué claves.'),
    ('Cron', 'Horario automático de un robot. Está en hora UTC: Lima = UTC − 5.'),
    ('Secret / Environment', 'Lugar seguro de GitHub donde se guardan claves. Un Environment agrupa las claves de una empresa.'),
    ('Propiedades del script', 'Lugar seguro de cada hoja de Google donde se guardan claves y ajustes (Extensiones → Apps Script → ⚙️ Configuración del proyecto).'),
    ('clasp', 'Herramienta de Google para subir código a Apps Script desde GitHub.'),
    ('Webhook / aplicación web', 'Dirección de internet de una hoja a la que Telegram, WhatsApp o GitHub le mandan mensajes (doPost / doGet).'),
    ('Disparador (trigger)', 'Tarea automática de la hoja (cada 10 min, cada hora, a una hora fija).'),
    ('SIRE', 'Sistema Integrado de Registros Electrónicos de SUNAT (registro de compras y ventas).'),
    ('SOL', 'SUNAT Operaciones en Línea: el portal con usuario y clave SOL.'),
    ('CRE', 'Comprobante de Retención Electrónico (3% del IGV).'),
    ('GRE', 'Guía de Remisión Electrónica.'),
    ('SPOT / detracción', 'Depósito en el Banco de la Nación que se descuenta al pagar ciertas facturas.'),
    ('RHE', 'Recibo por Honorarios Electrónico.'),
    ('SSCO', 'Sujetos Sin Capacidad Operativa (lista de SUNAT de empresas observadas).'),
    ('R2', 'Almacenamiento de archivos de Cloudflare donde están los PDF de facturas.'),
    ('Motor de cruce', 'Motor.js: decide qué pago va a qué factura y calcula el saldo.'),
    ('Prefijo (MESA_, TG_, VCO_…)', 'Las funciones de cada módulo empiezan con las mismas letras para no mezclarse. Si el nombre termina en «_» es interna (no aparece en menús).'),
    ('Minutos de GitHub', 'Tiempo de máquina que gastan los robots. Público = gratis; privado = 2,000 min gratis al mes.'),
]

# Cada mejora nueva: sumar una línea aquí (la más nueva arriba).
HISTORIAL = [
    ('12/11/2026', 'Identificar RUC: 🗑 borrar alias y 🔍 leer el voucher con IA', 'En cada tarjeta con alias, 🗑 Borrar este alias lo quita de Cobranzas → ⚙️ Config (todas las filas con ese nombre; deja nota). Nuevo botón 🔍 Leer el voucher con IA: la IA lee la imagen del voucher (la misma lectura de 🔁 Releer con IA, sin cambiar la fila), muestra el beneficiario que trae, avisa si es distinto al nombre escrito en la hoja y lista los RUC posibles de ese nombre (✅ Este) o lo busca en SUNAT e internet. En la hoja y en el portal.'),
    ('12/11/2026', 'Identificar RUC: ⚠️ alias con nombre distinto y 🔁 actualizar alias', 'Si el alias guardado en ⚙️ Config (columnas I:J) apunta a un RUC cuyo nombre no se parece al del voucher (ej. QUISPE RIVERA → ENVASES SELECTOS EIRL), la ventana lo marca en rojo con ⚠️ y deja la sugerencia SIN marcar; también en el texto de Telegram/WhatsApp. En cada tarjeta con alias hay una casilla «🔁 Si elijo otro RUC, actualizar el alias de este nombre» (marcada): al elegir otro RUC el alias se cambia en Config (con nota «antes …»). En la hoja y en el portal.'),
    ('12/11/2026', 'Identificar RUC: 📂 Ver la última búsqueda', 'Botón 📂 Ver la última búsqueda en la ventana 🔎 Identificar RUC (hoja y portal; en el portal también en 🧠 IA → 🔎 Identificar RUC): lista las búsquedas en SUNAT e internet de las últimas 6 horas (cuándo, qué, cuántos encontrados / por elegir) y con «Ver» vuelve a abrir su resultado para escribir lo que falte, aunque se haya cerrado la ventana. En la hoja, si se abre 🔎 Identificar RUC sin filas seleccionadas, la ventana igual se abre para usar ese botón.'),
    ('12/11/2026', 'Identificar RUC: ✍️ Escribir los marcados de una vez', 'Los RUC encontrados en SUNAT e internet que se marcan se escriben todos juntos y Cobranzas se recalcula una sola vez (antes una vez por proveedor: con 13 tardaba varios minutos y chocaba con otra escritura: «Ya hay una actualización en curso»). Si algo falla, lo dice.'),
    ('12/11/2026', 'Identificar RUC agrupado por nombre y 🌐 IA en cada tarjeta', 'Los vouchers con el mismo nombre de proveedor salen en una sola tarjeta (lista de vouchers, fecha, monto y total); el RUC elegido (sugerencia, nombre parecido, otras opciones, RUC escrito o búsqueda con IA) se escribe en todos a la vez. Cada tarjeta tiene su botón 🌐 Buscar con IA en SUNAT e internet (busca ese nombre sin escribir nada); la casilla sirve para buscar otro nombre o escribir el RUC. Si una búsqueda falla, lo dice. En la hoja de Vouchers y en el portal.'),
    ('12/11/2026', 'Identificar RUC: nombres parecidos a la vista', 'Cada voucher sin RUC muestra directamente la lista 🔤 Nombres parecidos: RUC — nombre — de dónde sale (otros vouchers, SIRE, honorarios, retenciones) y cuán parecido es, con ✅ Este en cada uno, para comparar y elegir. Si el prefijo del comprobante está mal anotado, se busca en los otros tipos por nombre y se avisa.'),
    ('12/11/2026', 'Identificar RUC: tipo de comprobante', 'El prefijo de «Tipo y Nº Doc.» se respeta (catálogo 10 SUNAT): 01_ factura, 02_ recibo por honorarios, 03_ boleta, 07_ N/C, 08_ N/D. Con 02_ solo se busca en los recibos por honorarios; con 01_ solo en facturas del SIRE.'),
    ('12/11/2026', 'Identificar RUC: siempre con su nombre', 'Cada RUC sugerido muestra la razón social o el nombre con que figura en nuestras fuentes (SIRE, honorarios, retenciones, vouchers); si no figura, lo dice para verificarlo en SUNAT. También en el texto de Telegram/WhatsApp, en la hoja de Vouchers y en el portal.'),
    ('12/11/2026', 'RUC por número de comprobante: corregido', 'Al identificar el RUC por el comprobante del voucher (ej. E001-17), antes se tomaba el emisor de cualquier comprobante con ese número (E001 lo usan miles de emisores). Ahora el nombre del emisor tiene que parecerse al del voucher; también se buscan los recibos por honorarios por su número; si el nombre no coincide queda solo como opción «⚠️ otro nombre». La sugerencia muestra el nombre del emisor.'),
    ('12/11/2026', 'Mesa: 📝 nota en el documento para enviar', 'En 📨 Para enviar, botón 📝 Nota: se escribe cualquier detalle y sale dentro del estado de cuenta o del análisis (arriba, debajo del encabezado, o abajo, antes de la firma), en el PDF, la imagen, la impresión, el texto copiado y el Excel. Se recuerda por proveedor o cliente y empresa en ese navegador.'),
    ('12/11/2026', 'Mesa: glosa opcional, PDF directo y copiar imagen', 'En 📒 Análisis y en 📨 Para enviar: casilla «Glosa» para mostrar u ocultar esa columna (también en Excel y copiar); ⬇ PDF que se descarga directo (A4, horizontal para el análisis, varias páginas); 📋 Copiar imagen al portapapeles para pegar con Ctrl+V en WhatsApp, correo o Word (si el navegador no deja, la descarga).'),
    ('12/11/2026', 'Mesa: razón social completa', 'En el estado de cuenta para enviar, el análisis y el Excel, la empresa del grupo sale con su razón social completa (columna «Razón social» de ⚙️ Config de Cobranzas; si está vacía, la de sus facturas entre empresas del grupo; si no, el alias).'),
    ('12/11/2026', 'Portal de Vouchers: 🧠 IA', 'Pestaña 🧠 IA (permiso editar) con el mismo Asistente IA del menú de la hoja: 💬 Chat (fotos, PDF, Excel; ✅ escribir lo propuesto y ↩️ deshacer), 📋 Analizar procesados, 🔎 Identificar RUC (también botón 🔎 RUC en Buscar y en el visor, con No es este / otras opciones / buscar con IA), 🔗 Completar Originales con Fotos y 🧩 Mesa de conciliación. Usa la conexión de la hoja de Vouchers con Cobranzas (por el puente), sin claves nuevas; todo queda en 🌐 Registro portal.'),
    ('12/11/2026', 'Portal de Vouchers: deshacer y quitar', '↩️ Deshacer mi última corrección (vuelve lo de antes de su último 💾 Guardar, solo si nadie cambió esas celdas después; nota en la hoja y registro) y 🗑 Quitar un voucher subido por error mientras sigue en la entrada (en 📥 Pendientes y en lo recién subido; va a la papelera de Drive 30 días; quien solo sube quita lo suyo).'),
    ('12/11/2026', 'Portal de Vouchers: Drive siempre en la app', 'En Android, 📲 Escanear con Google Drive abre la carpeta de entrada directo en la app de Drive (enlace intent), también desde incógnito u otro navegador, sin pedir iniciar sesión en la web; si la app no está, abre la web.'),
    ('12/11/2026', 'Portal de Vouchers: 📲 Escanear con Google Drive', 'Botón en 📤 Subir: elige Original o Foto y abre la app de Google Drive en la carpeta 📥 de entrada correspondiente para usar su escáner (+ → Escanear → Guardar); luego ⚡ Ya escaneé: procesar ahora. Requiere una cuenta de Google con acceso a la carpeta.'),
    ('12/11/2026', 'Mesa: filtros combinables en la lista', 'En 💳 Vouchers, botones que se combinan: 💳 Vouchers · 🧾 Retenciones · 🏦 Detracciones · ✍️ Manuales · 📄 N/C. La lista muestra juntos los tipos elegidos (por fecha o monto), cada uno con su color y su línea a la factura; las retenciones se pueden pasar a otra factura desde ahí (tocar la retención y luego la factura); detracciones, manuales y N/C abren la ficha de su factura.'),
    ('12/11/2026', 'Vouchers: 🔎 Identificar RUC con opciones', 'La ventana muestra cada voucher con su RUC sugerido: casilla para aceptarlo, ❌ No es este, 📋 Otras opciones (vouchers, empresas del grupo, SIRE, 🧑‍💼 recibos por honorarios, 🧾 retenciones), escribir un RUC o buscar por otro nombre con IA en el padrón de SUNAT e internet, y 🌐 buscar con IA todos los seleccionados aunque ya tengan sugerencia.'),
    ('12/11/2026', 'Portal de Vouchers: mejor recorte en fotos reales', 'Bordes automáticos por el color del papel desde el centro de la foto (funciona con papel celeste/amarillo sobre madera con brillos); ✨ Mejorar ya no resalta lo impreso al reverso ni deja manchas: papel blanco parejo y texto oscuro.'),
    ('12/11/2026', 'Mesa: análisis por factura', 'En 📒 Análisis (Detalle) cada factura es un bloque: línea separadora arriba, fondo alterno, y al final 🧾 «Saldo de la factura» con su compromiso, su amortización y su saldo destacado (rojo = por pagar, verde = a favor) y su estado (pendiente, vencida, cancelada en mm/aaaa, pagado de más). El saldo que va quedando en cada movimiento sale en gris. Compromiso − amortización = saldo en cada factura (también en Excel y copiar).'),
    ('12/11/2026', 'Portal de Vouchers: ✂️ recortar y mejorar', 'Al tomar foto (y en cada página del escáner o foto de galería): bordes del voucher automáticos con 4 esquinas movibles, enderezado de perspectiva, ✨ Mejorar (papel blanco, texto oscuro), girar; todo en el celular. El nombre sugerido sale en gris y se escribe encima sin borrar.'),
    ('11/11/2026', '🌐 Portal web de Vouchers', 'Proyecto aparte con su propia aplicación web: la hoja de Vouchers desde el celular o la PC con usuario y PIN (pestaña 👥 Portal). Buscar y filtrar (sin RUC, sin revisar, duplicados, por retener, empresa, banco, moneda, fechas, montos), ver la imagen y el archivo original (PDF en su página), corregir con confirmación y nota en la hoja, 🔁 releer con IA y ↩️ deshacer (por el puente de la hoja), 📤 subir con 📷 cámara o 📄 escanear varias fotos a un PDF, ⚡ procesar al instante, 📥 pendientes, 📊 resumen, 👥 usuarios y 🌐 registro. Solo 3 funciones públicas; el pase de Drive nunca llega al navegador.'),
    ('07/11/2026', 'Mesa: pago por el total en el análisis', 'En 📒 Análisis el depósito pagado de más se muestra por el total de la operación bajo la última factura que pagó (queda pagada de más, saldo negativo) y la devolución del proveedor va debajo de esa misma factura; «A cuenta» queda solo para depósitos sin factura.'),
    ('06/11/2026', 'Mesa: devoluciones en el análisis', 'En 📒 Análisis cada devolución del proveedor es una línea «Devolución» (cargo que reduce el saldo a favor): bajo la factura pagada de más o bajo el depósito «A cuenta» (lo pagado de más) del que se devolvió. Corregido el signo de las devoluciones ligadas a una factura en el estado para enviar y en 🔎 Detallado.'),
    ('06/11/2026', 'Mesa: cuadre del análisis', 'El 📒 Análisis muestra su cuadre (compromiso − amortización = saldo) y, en «Para enviar», el cruce con el saldo final del estado de cuenta por moneda; si los movimientos de un documento no llegan a su saldo en Cobranzas agrega una línea «Ajuste» y lo avisa; avisa los documentos sin tipo de cambio. La hoja ya no se recorta en el celular.'),
    ('06/11/2026', 'Mesa: 📒 análisis para enviar', 'En 📨 Estado de cuenta para enviar, tercer formato «📒 Análisis»: análisis de documentos del proveedor (o cliente) con encabezado formal, moneda soles/dólares/ambas, Detalle o Resumir y conformidad; 🖨 PDF horizontal, 🖼 imagen, 📋 copiar y ⬇ Excel.'),
    ('06/11/2026', 'Mesa: 📒 análisis de cuenta (tipo Contasis)', 'Nuevo nivel «📒 Análisis» en el Estado de cuenta: por proveedor o cliente, cada documento con compromiso, amortizaciones (pago, retención, detracción, N/C) con su documento y fecha, saldo acumulado y mes de cancelación; Detalle o Resumir; en soles y dólares, solo soles o solo dólares (tipo de cambio del SIRE, nueva columna «T.C.» en 📋 Documentos); totales por proveedor y general; ⬇ Excel, copiar e imprimir.'),
    ('06/11/2026', 'Mesa: con / sin empresa', 'Filtros «Con empresa» y «Sin empresa» en vouchers; en el Estado de cuenta y en el estado para enviar, selector «Vouchers con y sin empresa / Solo con empresa / Solo sin empresa».'),
    ('06/11/2026', 'Mesa: 📨 estado de cuenta para enviar', 'Formato de sistema contable (QuickBooks/Xero/SAP, carta de confirmación de saldos): resumen del periodo con saldo inicial y final, antigüedad de saldos, facturas pendientes, movimientos con saldo acumulado y conformidad; desde/hasta, resumido o detallado; PDF, imagen o copiar.'),
    ('06/11/2026', 'Mesa: ver comprobantes', 'En la ficha de cada factura y en 🧾 Retenciones: ver el comprobante de retención (PDF de la hoja Retenciones, con fecha, retenido y facturas) y la constancia de detracción en el visor.'),
    ('06/11/2026', 'Mesa: completar datos y RUC de varios', '✏️ Completar datos del voucher (empresa que paga, RUC y nombre del beneficiario, nota) escritos en la hoja de Vouchers; filtro Con RUC; 🔎 Buscar RUC de varios vouchers a la vez.'),
    ('06/11/2026', 'Declaraciones: detalle y reportes de contador', 'El robot también baja el PDF oficial «Detalle de la declaración» (621 y 626), también de las ya descargadas. Reportes anuales 📒 IGV-Renta 621, 👷 PLAME 601 y 🧾 Retenciones 626 (meses en columnas, total con fórmula); casillas con su nombre oficial de SUNAT; fechas y periodos con formato correcto.'),
    ('06/11/2026', 'Mesa: recalcular espera al guardado', '⚡ Recalcular ahora (y el recálculo automático) espera a que termine de escribirse lo que se está guardando —de usted o de otra persona— para no calcular con datos a medias.'),
    ('06/11/2026', 'Mesa: 💯 voucher completo', 'Tocando una línea: «Que este voucher pague completo esta factura»; los otros vouchers de la factura solo ponen lo que falte (montos por línea), y lo que les sobre sigue a sus otras facturas.'),
    ('06/11/2026', 'Mesa: orden por fecha y colores', 'Si dos vouchers pagan la misma factura, el más antiguo paga primero también cuando el otro tiene montos por línea (antes el de montos se adelantaba y la Mesa mostraba otra cosa). Colores más distinguibles (devoluciones en rosado, cambios sin guardar con franja morada) y leyenda fija arriba.'),
    ('06/11/2026', 'Mesa: reasignaciones sin huecos', 'Las filas nuevas de 🔁 Reasignar retenciones van al primer hueco de A–E (antes quedaban filas vacías por el cuadro 💡 SUGERIDAS de la derecha).'),
    ('06/11/2026', '📑 Declaraciones · Grupo', 'Proyecto nuevo: PDT 621, 601 PLAME y 626 con constancia PDF y rectificatorias (vigente + respaldo), reportes por periodo, tributos y casillas, descarga mensual el día 28. Los PDF van directo a la hoja (no a GitHub).'),
    ('06/11/2026', 'Detracciones de lunes a viernes', 'La descarga automática de detracciones corre una sola vez al día y solo de lunes a viernes (bot, hoja y reloj de GitHub). A mano se puede cualquier día.'),
    ('06/11/2026', 'Manual del proyecto', 'Este manual (Excel y Markdown) generado desde el código con scripts/generar_manual.py.'),
    ('06/11/2026', '⏱ Minutos de GitHub', 'Medición del mes cada 6 h, avisos al 50/75/90/100% (si el repositorio es privado), resumen los lunes y comando «minutos».'),
    ('06/11/2026', 'Robots de SUNAT más tolerantes', 'SIRE: si SUNAT está lenta queda «pendiente» y se reintenta (sin marcar error). Detracciones: espera hasta ~60 s el menú de SOL. Tiempos máximos en los robots para no gastar minutos colgados.'),
    ('11/2026', '🧩 Mesa de conciliación', 'Cruce con líneas facturas ↔ vouchers, por pagar y por cobrar; monto por línea, retenciones, devoluciones, pago sin voucher, estado de cuenta con antes/después, calculadora, visor de fotos y PDF, historial, deshacer, quitar cruces, ⚡ recalcular ahora; desde Cobranzas, Vouchers y el celular.'),
    ('11/2026', '🔗 Fotos → Originales', 'Copia automática y por menú de lo trabajado en Fotos a Originales, con vista previa y avisos de diferencias.'),
    ('11/2026', 'Visor «Únicos»', 'En el visor de Vouchers, «Únicos» prioriza Originales sobre Fotos.'),
]

# ─────────────────────────────── utilidades ───────────────────────────────

def cron_lima(c):
    try:
        m, h, dom, mon, dow = c.split()
        dias = {'*': 'todos los días', '1': 'los lunes', '1-5': 'de lunes a viernes', '1-6': 'de lunes a sábado'}.get(dow, 'días ' + dow)
        hs = []
        for x in h.split(','):
            hh = (int(x) - 5) % 24
            hs.append('%02d:%02d' % (hh, int(m)))
        return '%s a las %s (Lima)' % (dias, ' y '.join(hs))
    except Exception:
        return c


def tipo_funcion(nombre, en_menu):
    if nombre in en_menu:
        return 'Menú (se elige en la hoja)'
    if nombre in ('doGet', 'doPost'):
        return 'Entrada web (Telegram/WhatsApp/enlace)'
    if nombre in ('onOpen', 'onEdit', 'onInstall'):
        return 'Automática de la hoja'
    if nombre.endswith('_'):
        return 'Interna'
    return 'Pública (pantallas, disparadores u otras hojas)'


def carpeta_proyecto(f):
    p = f.split('/')
    return '/'.join(p[:2]) + '/' if len(p) > 2 and p[1] in ('telegram', 'apps_script', 'scripts', 'emision', 'src', 'worker') else p[0] + '/'

# ─────────────────────────────── armar las tablas ───────────────────────────────

en_menu = {m['fn'] for m in D['menus']}
TABLAS = []  # (pestaña, título, encabezados, filas, anchos)

TABLAS.append(('Inicio', 'Manual del proyecto · cómo leerlo', ['Tema', 'Explicación'], INICIO, [24, 120]))
TABLAS.append(('Mapa general', 'Cómo encaja todo, en 10 pasos', ['Paso', 'Parte', 'Qué hace'], MAPA, [6, 34, 120]))
TABLAS.append(('Proyectos', 'Proyectos del repositorio', ['Proyecto', 'Carpeta', 'Dónde corre', 'Qué hace', 'Robot que lo sube / corre'], PROYECTOS, [30, 30, 30, 80, 40]))

import re as _re


def limpiar(txt):
    """Las descripciones automáticas salen de los comentarios del código: se tapan números largos (RUC, operaciones,
    IDs), líneas de guiones y ejemplos con nombres de terceros, para que el manual no lleve datos de nadie."""
    txt = _re.sub(r'-{4,}|={4,}', ' ', txt)
    txt = _re.sub(r'\d[\d ]{6,}\d', '…', txt)
    txt = _re.sub(r'\b[A-ZÁÉÍÓÚÑ]{3,}(?: [A-ZÁÉÍÓÚÑ.&]{2,})* (?:S\.?A\.?C?\.?S?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?)\b\.?', '<empresa>', txt)
    return _re.sub(r'\s+', ' ', txt).strip()


arch = []
for a in sorted(D['arch'], key=lambda x: x['f']):
    a['d'] = limpiar(a['d'])
    tipo = 'Pantalla (HTML)' if a['f'].endswith('.html') else ('Python (robot de GitHub)' if a['f'].endswith('.py') else ('Cloudflare Worker' if 'worker' in a['f'] else 'Apps Script'))
    arch.append((carpeta_proyecto(a['f']), a['f'], tipo, a['d'] or '(pantalla o archivo sin descripción al inicio)', a['lineas'], len(a['fns']), ', '.join(a['fns'][:12]) + (' …' if len(a['fns']) > 12 else '')))
TABLAS.append(('Archivos', 'Cada archivo de código y qué hace (leído del comentario al inicio de cada archivo)', ['Carpeta', 'Archivo', 'Tipo', 'Qué hace', 'Líneas', 'Funciones', 'Primeras funciones'], arch, [26, 44, 18, 110, 8, 10, 60]))

fns = []
for a in sorted(D['arch'], key=lambda x: x['f']):
    for n in a['fns']:
        fns.append((a['f'], n, tipo_funcion(n, en_menu)))
TABLAS.append(('Funciones', 'Todas las funciones (filtre por archivo o por tipo)', ['Archivo', 'Función', 'Tipo'], fns, [48, 40, 44]))

rob = []
for w in D['wfs']:
    cu = '; '.join(cron_lima(c) for c in w['crons']) or ('Al subir cambios' if 'push' in w['trig'] else '') or 'Solo a pedido (botón, hoja o bot)'
    if w['crons'] and 'workflow_dispatch' in w['trig']:
        cu += '; también a pedido'
    rob.append((w['f'], w['name'], cu, ', '.join(w['inputs']), ', '.join(w['paths'])[:300], ', '.join(w['secrets']), ', '.join(w['jobs']), limpiar(w['desc'] or '')))
TABLAS.append(('Robots GitHub', 'Robots (workflows) en .github/workflows/ — en GitHub: pestaña Actions', ['Archivo', 'Nombre en GitHub', 'Cuándo corre', 'Datos que pide', 'Se lanza al cambiar', 'Secretos que usa', 'Trabajos', 'Qué hace'], rob, [30, 40, 40, 30, 40, 50, 22, 100]))

TABLAS.append(('Claves y APIs', 'Dónde se cambia cada clave (nunca se escribe su valor aquí)', ['Qué', 'Para qué', 'Dónde se cambia', 'Detalle'], CLAVES, [30, 40, 60, 100]))
sec = [(k, v) for k, v in sorted(SECRETOS.items())]
usados = sorted({s for w in D['wfs'] for s in w['secrets']} - set(SECRETOS))
sec += [(k, '(sin explicación todavía: agregarla en SECRETOS de scripts/generar_manual.py)') for k in usados]
TABLAS.append(('Secretos GitHub', 'Secretos de GitHub (Settings → Secrets and variables → Actions)', ['Nombre', 'Para qué sirve'], sec, [28, 120]))
props = [(k, PROPS.get(k, ''), ', '.join(v)) for k, v in sorted(D['props'].items())]
TABLAS.append(('Propiedades', 'Propiedades del script que lee el código (ajustes y claves guardadas en cada hoja)', ['Nombre', 'Para qué sirve', 'Archivo que la usa'], props, [32, 70, 90]))
men = [(m['menu'], m['item'], m['fn'], m['f']) for m in D['menus']]
TABLAS.append(('Menús', 'Opciones de los menús de las hojas y la función que ejecutan', ['Menú', 'Opción', 'Función', 'Archivo'], men, [36, 60, 34, 44]))
TABLAS.append(('Comandos bot', 'Comandos de Telegram y WhatsApp', ['Escribir', 'Dónde', 'Qué hace'], COMANDOS, [42, 34, 100]))
TABLAS.append(('Flujos', 'Paso a paso de los procesos principales', ['Proceso', 'Pasos'], FLUJOS, [28, 140]))
TABLAS.append(('Mantenimiento', 'Qué hacer cuando algo falla o se quiere cambiar', ['Caso', 'Qué hacer'], MANTENIMIENTO, [30, 140]))
TABLAS.append(('Glosario', 'Palabras técnicas en simple', ['Palabra', 'Significa'], GLOSARIO, [30, 120]))
TABLAS.append(('Historial', 'Mejoras agregadas (la más nueva arriba) — sumar una línea con cada cambio', ['Fecha', 'Mejora', 'Detalle'], HISTORIAL, [14, 34, 120]))

# ─────────────────────────────── Excel ───────────────────────────────

AZUL = PatternFill('solid', fgColor='1F3A5F')
GRIS = PatternFill('solid', fgColor='F1F5F9')
F = Font(name='Arial', size=10)
FB = Font(name='Arial', size=10, bold=True, color='FFFFFF')
FT = Font(name='Arial', size=14, bold=True, color='1F3A5F')
BORDE = Border(bottom=Side(style='thin', color='CBD5E1'))
ARRIBA = Alignment(wrap_text=True, vertical='top')

wb = Workbook()
wb.remove(wb.active)
for nombre, titulo, cab, filas, anchos in TABLAS:
    ws = wb.create_sheet(nombre[:31])
    ws['A1'] = titulo
    ws['A1'].font = FT
    for j, c in enumerate(cab, 1):
        x = ws.cell(row=3, column=j, value=c)
        x.font, x.fill, x.alignment = FB, AZUL, Alignment(wrap_text=True, vertical='center')
    for i, fila in enumerate(filas, 4):
        for j, v in enumerate(fila, 1):
            x = ws.cell(row=i, column=j, value=v)
            x.font, x.alignment, x.border = F, ARRIBA, BORDE
            if i % 2 == 1:
                x.fill = GRIS
    for j, w in enumerate(anchos, 1):
        ws.column_dimensions[get_column_letter(j)].width = w
    ws.freeze_panes = 'A4'
    if len(filas) > 10:
        ws.auto_filter.ref = 'A3:%s%d' % (get_column_letter(len(cab)), len(filas) + 3)

ind = wb['Inicio']
r = len(INICIO) + 6
ind.cell(row=r, column=1, value='Pestañas').font = Font(name='Arial', size=11, bold=True)
for k, (nombre, titulo, *_r) in enumerate(TABLAS[1:], r + 1):
    c = ind.cell(row=k, column=1, value=nombre)
    c.hyperlink = "#'%s'!A1" % nombre
    c.font = Font(name='Arial', size=10, color='1D4ED8', underline='single')
    ind.cell(row=k, column=2, value=titulo).font = F

os.makedirs(os.path.join(RAIZ, 'docs'), exist_ok=True)
xlsx = os.path.join(RAIZ, 'docs', 'MANUAL_DEL_PROYECTO.xlsx')
wb.save(xlsx)

# ─────────────────────────────── Markdown ───────────────────────────────

def md_celda(v):
    return str(v if v is not None else '').replace('|', '\\|').replace('\n', ' ')

md = ['# 📘 Manual del proyecto', '',
      '> Generado con `python3 scripts/generar_manual.py` — no editar a mano: los cambios se hacen en ese script. '
      'La versión Excel está en `docs/MANUAL_DEL_PROYECTO.xlsx`.', '']
md += ['## Índice', ''] + ['- [%s](#%s)' % (t[0], t[0].lower().replace(' ', '-')) for t in TABLAS] + ['']
for nombre, titulo, cab, filas, _ in TABLAS:
    if nombre == 'Funciones':
        md += ['## ' + nombre, '', titulo + ': ver la pestaña «Funciones» del Excel (%d funciones).' % len(filas), '']
        continue
    md += ['## ' + nombre, '', '*' + titulo + '*', '', '| ' + ' | '.join(cab) + ' |', '|' + '---|' * len(cab)]
    md += ['| ' + ' | '.join(md_celda(v) for v in f) + ' |' for f in filas]
    md.append('')
open(os.path.join(RAIZ, 'docs', 'MANUAL_DEL_PROYECTO.md'), 'w', encoding='utf-8').write('\n'.join(md))
print('Listo:', xlsx, '·', len(D['arch']), 'archivos ·', len(fns), 'funciones ·', len(D['wfs']), 'robots')
