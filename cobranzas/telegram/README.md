# 🤖 Asistente de Telegram · Grupo

Un bot de Telegram que reúne **todos los proyectos** del repositorio en el celular:
chat con IA (texto, fotos, PDF, Excel y notas de voz), consultas al instante,
avisos automáticos y descargas de SUNAT.

Vive **dentro de la hoja "Cuentas por Cobrar y Pagar · Grupo"** (proyecto Apps
Script de `cobranzas/`), en esta carpeta `telegram/`, con funciones `TG_`. Está ahí
porque esa hoja ya tiene la IA analista, los vouchers, SIRE, las retenciones y las
detracciones. Desde ahí también lee las hojas de Notificaciones y Honorarios, las
Liquidaciones IGV de SIRE, y consulta o lanza los workflows de GitHub.

> Es un bot **nuevo**, distinto del bot de Vouchers. No use el token del bot de
> Vouchers: Telegram solo deja conectar un bot a un lugar a la vez, y el de Vouchers
> dejaría de registrar.

## Qué puede hacer

| | |
|---|---|
| 💬 **Chat con IA** | Preguntas libres sobre facturas por cobrar o pagar, N/C, pagos y vouchers (con conciliación). También SIRE (IGV por pagar, saldo a favor), retenciones, detracciones, honorarios, el Buzón SUNAT y el estado de las descargas. Recuerda la conversación por 6 horas (`/olvidar` empieza de cero). |
| 📷 **Fotos, PDF, Excel** | Lee vouchers, facturas, estados de cuenta o notificaciones. Si llegan con texto, responde ese texto. Si llegan sin texto, ofrece **🔎 Analizar y cruzar**, **📥 Registrar como voucher** (lo copia a la carpeta de entrada del Sistema de Vouchers) o **✍️ escribir la pregunta**. Los álbumes se analizan juntos. |
| 🧾 **Procesar documento** | Botón al mandar una foto o PDF (también en WhatsApp: "🧾 Revisar con IA"). La IA lee **cada página** (voucher, factura, orden de compra, guía…), busca el voucher en la hoja de Vouchers y lo empareja con la factura (total, o total menos retención/detracción). Con ✅: si **no está registrado**, separa **solo la página del voucher**, la nombra (🏷) y la manda a Entrada; cuando la hoja de Vouchers la registra, **completa la factura** (empresa, RUC del proveedor, factura). Si ya está **sin factura**, solo la completa. Si ya está completo, no hace nada. El original queda en la carpeta temporal (7 días). `TG_Procesar.js` (el trabajo largo corre en el disparador `TGP_trabajar`). |
| ↩️ **Deshacer todo** | `/deshacer` o escribir *deshacer* (también en WhatsApp): muestra qué hizo la **última acción** y, al confirmar, borra las filas que creó en Vouchers (con su imagen), manda sus archivos a la papelera de Drive y devuelve los datos escritos a como estaban. Vale para 🧾 Procesar, 📥 Registrar como voucher, tandas de WhatsApp y ✏️ cambios aprobados. `TG_Deshacer.js`. |
| 🧾 **Emitir retenciones** | `/emitir` (y en WhatsApp **emitir**): pagos de este mes hechos sin su comprobante de retención, con **👁 Vista previa** (SUNAT sin emitir) y **✅ Emitir** (pide confirmar; solo administradores, en WhatsApp los números autorizados con `/emitirwa`). Corre en GitHub (`retenciones-cre.yml`) y avisa el número del CRE o por qué no se emitió (`TG_Retener.js`). |
| 🏷 **¿De quién son?** | Al tocar **📥 Registrar como voucher** pregunta de quién son (botones con los nombres más usados y uno ⭐ sugerido por la IA según quién paga; **Hoy / Ayer / 📅 Otra fecha**; **➖ Sin nombre**; **📄 Enviar como original / 📸 Enviar como foto** para elegir la pestaña, y dice a cuál va). En WhatsApp también se escribe *original* o *foto*. También se escribe o se dice 🎤: *Edit 15/10*. Quedan como `18-10-26 Edit.jpg`, `18-10-26 Edit 2.jpg`… sin repetir nunca un nombre (la hoja de Vouchers busca por ese nombre para reparar imágenes). Lo mismo para WhatsApp, con la misma numeración (`TG_Entregas.js`). Sin respuesta en 20 min se registran con el nombre de antes. |
| ✏️ **Completar datos** | Si falta un dato en la hoja de Vouchers (factura, RUC, empresa), lo propone. Se escribe solo al tocar ✅, y se puede deshacer con ↩️. Usa las mismas reglas que el 💬 Chat de la hoja. |
| 🎤 **Notas de voz** | Las transcribe con Gemini y las responde como si fueran texto. |
| 📊 **Excel** | Las listas largas también llegan en `.xlsx`. |
| ⚡ **Respuestas rápidas (sin IA)** | `/resumen`, `/cobrar`, `/pagar` (por empresa y top clientes o proveedores), `/vencidas`, `/notificaciones` (con 📄 PDF), `/detracciones` (con su constancia), `/retenciones`, `/honorarios`, `/tc` (tipo de cambio SUNAT). |
| ⚡ **SIRE solo reporte** | `/sire` (botones) o `/sire granix 202601-202609`: baja solo el registro de compras y/o ventas del SIRE, rápido, de una, varias o todas las empresas y de un mes o un rango. Por WhatsApp: `sire granix 202609`. La hoja SIRE lo importa sola a Drive. |
| ⬇ **Descargas de SUNAT** | `/descargar`: se elige proyecto, empresa y periodo, y se lanza el workflow de GitHub. `/estado`: muestra cómo terminó la última corrida de cada descarga y qué empresa falló, con un botón 🔁 Reintentar. Avisa cuando termina. La IA también puede **proponer** una descarga, pero nunca la lanza sin el botón. |
| 🔔 **Avisos automáticos** | Cada hora avisa lo **nuevo**: notificaciones y mensajes del Buzón SUNAT, detracciones, retenciones, recibos por honorarios, vouchers registrados y descargas que fallaron. Cada persona elige sus avisos con `/avisos`. Por la mañana manda el ☀️ resumen con las facturas por vencer. De 23:00 a 6:00 solo avisa errores. |
| ⏰ **Recordatorios** | Por ejemplo: *"recuérdame el lunes 9am declarar IGV de GRANIX cada mes"*. Pueden ser diarios, semanales o mensuales. `/recordatorios` los lista y deja borrarlos. |
| 🔒 **Seguridad** | Solo responde a las personas autorizadas en la pestaña **🤖 Telegram**. Para vincularse se usa un código de 6 dígitos que da la hoja. Un administrador puede aprobar o quitar personas (`/usuarios`). Solo consulta y propone: nunca paga ni presenta nada en SUNAT. |

## Instalación (una sola vez)

1. **Crear el bot.** En Telegram, abra **@BotFather**, escriba `/newbot` y elija un nombre (ej. *Asistente Grupo*) y un usuario (ej. `grupo_asistente_bot`). Copie el **token** que le da.
2. **Conectarlo.** Abra la hoja **Cuentas por Cobrar y Pagar** y recárguela. Vaya a **🤖 Telegram → 1️⃣ Conectar bot** y pegue el token. Si Google pide permisos, acéptelos. La hoja muestra un **código de 6 dígitos**.
3. **Vincular su Telegram.** Abra el bot (enlace `t.me/<usuario del bot>`), toque **INICIAR** y envíe el código. La primera persona queda como **administrador**. Para sumar a otras personas use **🤖 Telegram → 2️⃣ Vincular**, o apruebe la solicitud que le llega al bot cuando alguien le escribe.
4. **🔑 Token de GitHub.** Use el mismo de las hojas de Detracciones, Retenciones o Notificaciones; necesita el permiso *Actions: Read and write*. Sirve para `/estado`, `/descargar` y los avisos de errores.
5. **🔔 Activar avisos automáticos.** Se revisa cada hora.

Si **1️⃣ Conectar** dice que la aplicación web no está publicada, espere a que termine el workflow **Desplegar Cobranzas** y vuelva a intentar.

## Cómo está hecho

| Archivo | Qué hace |
|---|---|
| `TG_Bot.js` | `doPost` (entrada de Telegram, valida el secreto `?token=` y descarta los repetidos), personas autorizadas, comandos, botones, fotos, PDF y voz |
| `TG_IA.js` | Chat con la IA: usa `CHAT_enviarEn_` / `ANA_preguntar_` de la hoja (mismas herramientas y reglas) y le **suma** las del bot. Formato para el celular, Excel, ✏️ cambios con ✅ |
| `TG_Fuentes.js` | Herramientas extra de la IA: `notificaciones`, `retenciones_sunat`, `honorarios`, `sire_liquidacion`, `leer_libro` (cualquier hoja), `estado_descargas`, `lanzar_descarga`, `tipo_cambio`, `padron_ruc`, `recordatorio(s)`, `enviar_archivo` |
| `TG_Resumen.js` | Respuestas rápidas sin IA, avisos por persona, recordatorios |
| `TG_Avisos.js` | `TG_vigia` (disparador cada hora): avisa lo nuevo una sola vez. Lo ya avisado se guarda en `_TG_Vistos`; la primera vez solo anota |
| `TG_GitHub.js` | Estado de las corridas, `/descargar` paso a paso, 🔁 reintentar, aviso al terminar (`TG_seguirDescargas`) |
| `TG_SireRapido.js` | ⚡ `/sire` y WhatsApp `sire …`: SIRE **solo reporte** (rápido, sin PDF/XML) de una, varias o todas las empresas, un mes o un rango (`/sire granix, luque 202601-202609 compras`, `/sire todas mes anterior`). Siempre con botón 🚀; al terminar dice cuántos comprobantes trajo por empresa y mes |
| `TG_Api.js` | API de Telegram: mensajes en HTML partidos a ≤3900 caracteres, botones, archivos, Excel |
| `TG_Config.js` | Pestaña 🤖 Telegram (parámetros y personas), menú, webhook y comandos del bot |
| `TG_Despliegue.js` | ID de la aplicación web. Lo **escribe el workflow** en cada despliegue; en el repositorio queda vacío |

- **Aplicación web:** `appsscript.json` tiene `webapp` con acceso `ANYONE_ANONYMOUS`, ejecutada como el dueño. La protegen el secreto del webhook y la lista de personas. El workflow `deploy-cobranzas.yml` la crea la primera vez y la vuelve a publicar cuando cambia el bot o la IA, o si la versión publicada tiene 3 días o más. Así ahorra versiones, porque Google permite 200 por proyecto. A mano: acción **publicar-bot**.
- **Claves** (token del bot, token de GitHub, secreto): solo en las Propiedades del script. Nunca van en celdas ni en el repositorio.
- **Pestañas nuevas** en la hoja de Cobranzas: `🤖 Telegram` (visible), y `_TG_Vistos` y `_TG_Recordatorios` (ocultas).
- Los archivos que llegan por Telegram se guardan en la carpeta temporal de importaciones de la hoja, igual que en el 💬 Chat; se borran solos a los 7 días.
- **Pruebas:** un simulador (Telegram, IA, GitHub y Drive falsos, con los datos reales del repositorio) cubre 79 casos: vinculación, mensajes repetidos, respuestas rápidas, chat con herramientas, fotos y álbumes, cambios ✅/↩️, voz, descargas, recordatorios, avisos, resumen diario y errores de la IA.
- **🧾 Pedir la retención escribiendo**: "emite / genera / saca la retención de F001-215" (o "¿puedes emitir la retención en SUNAT?" citando el mensaje de la factura) en Telegram o WhatsApp muestra la propuesta con 👁 Vista previa / ✅ Emitir sin pasar por la IA (`TGR_atajoTG_` / `TGR_atajoWA_`); si no corresponde, explica el motivo que calculó la hoja (columna "¿Retener? (IGV 3%)", voucher no aplicado, pago de otro mes, dólares). La IA también tiene `proponer_retencion` y la regla de que el tope de S/ 700 es sobre el total con IGV y lo decide la hoja. "¿Ya está emitida…?" sigue siendo una consulta para la IA.
- **↩️ Responder (citar) un mensaje** (Telegram y WhatsApp): si la persona responde a un mensaje del bot (o a uno suyo), la IA recibe ese texto junto con la pregunta (`TG_conCita_`), así "¿esta factura ya está retenida?" se entiende. En Telegram llega en `reply_to_message` (o solo la parte citada, `quote`); en WhatsApp la app guarda 6 horas el texto de cada mensaje enviado y recibido (`WA_guardarTextoMsg_`) y lo manda como `citado`. Lo que encuentra **🧾 Procesar documento** (facturas con emisor/RUC, vouchers y dónde están) y su resultado final quedan en la memoria de la IA del chat (`TGP_recordar_`). Una pregunta respondiendo al resumen ya no se toma como nombre de la tanda.
- **📲 WhatsApp** (`TG_WhatsApp.js`): la app aparte `vouchers_whatsapp/` manda aquí las preguntas libres (`doPost?canal=wa`, clave propia `TGW_SECRETO` que se registra sola la primera vez) y recibe en JSON la respuesta de la misma IA: texto, tablas, fotos de vouchers, archivos y Excel. Tiene su propia sesión por número (`wa<número>`) y no manda nada por Telegram; el flujo de Telegram no cambia.
- **📅 Vencimientos SUNAT** (`TG_Vencimientos.js`): IGV-Renta y PLAME (misma fecha, R.S. 281-2022 Anexo I: 11°–17° día hábil) y SIRE (RVIE/RCE: Anexo II, 10°–16° día hábil, o sea siempre 1 día hábil antes que el IGV; se calcula de la misma tabla con los feriados de Perú) de cada empresa según el cronograma de obligaciones mensuales (último dígito del RUC; Buenos Contribuyentes con su columna, detectados con el padrón SUNAT). Pestaña **📅 Vencimientos**: parámetros editables (días antes de avisar por obligación —por defecto 5, 2 y 0—, hora, días de aviso después de vencido, empresas) y el cronograma (sembrado con 2026; se intenta bajar solo de sunat.gob.pe y se puede corregir a mano). Pestaña **📅 Presentaciones**: el SIRE se marca solo con el mensaje del Buzón "Generación de Registro RVIE Y RCE del período AAAAMM"; el IGV con el botón **✅ Ya presenté**. Aviso en el vigía a la hora elegida, en el ☀️ resumen y con `/vencimientos` (`/vencimientos ajustes`, `/vencimientos dias igv 7,3,1`, `/vencimientos hora 9`). La IA tiene `vencimientos`, `marcar_presentado` y `ajustar_avisos_vencimientos`. Solo avisa por Telegram.
