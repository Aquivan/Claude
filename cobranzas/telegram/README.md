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
| ✏️ **Completar datos** | Si falta un dato en la hoja de Vouchers (factura, RUC, empresa), lo propone. Se escribe solo al tocar ✅, y se puede deshacer con ↩️. Usa las mismas reglas que el 💬 Chat de la hoja. |
| 🎤 **Notas de voz** | Las transcribe con Gemini y las responde como si fueran texto. |
| 📊 **Excel** | Las listas largas también llegan en `.xlsx`. |
| ⚡ **Respuestas rápidas (sin IA)** | `/resumen`, `/cobrar`, `/pagar` (por empresa y top clientes o proveedores), `/vencidas`, `/notificaciones` (con 📄 PDF), `/detracciones` (con su constancia), `/retenciones`, `/honorarios`, `/tc` (tipo de cambio SUNAT). |
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
| `TG_Api.js` | API de Telegram: mensajes en HTML partidos a ≤3900 caracteres, botones, archivos, Excel |
| `TG_Config.js` | Pestaña 🤖 Telegram (parámetros y personas), menú, webhook y comandos del bot |
| `TG_Despliegue.js` | ID de la aplicación web. Lo **escribe el workflow** en cada despliegue; en el repositorio queda vacío |

- **Aplicación web:** `appsscript.json` tiene `webapp` con acceso `ANYONE_ANONYMOUS`, ejecutada como el dueño. La protegen el secreto del webhook y la lista de personas. El workflow `deploy-cobranzas.yml` la crea la primera vez y la vuelve a publicar cuando cambia el bot o la IA, o si la versión publicada tiene 3 días o más. Así ahorra versiones, porque Google permite 200 por proyecto. A mano: acción **publicar-bot**.
- **Claves** (token del bot, token de GitHub, secreto): solo en las Propiedades del script. Nunca van en celdas ni en el repositorio.
- **Pestañas nuevas** en la hoja de Cobranzas: `🤖 Telegram` (visible), y `_TG_Vistos` y `_TG_Recordatorios` (ocultas).
- Los archivos que llegan por Telegram se guardan en la carpeta temporal de importaciones de la hoja, igual que en el 💬 Chat; se borran solos a los 7 días.
- **Pruebas:** un simulador (Telegram, IA, GitHub y Drive falsos, con los datos reales del repositorio) cubre 80 casos: vinculación, mensajes repetidos, respuestas rápidas, chat con herramientas, fotos y álbumes, cambios ✅/↩️, voz, descargas, recordatorios, avisos, resumen diario y errores de la IA.
