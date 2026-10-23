# Proyectos de este repositorio

Cada proyecto vive en **su propia carpeta**, con su propio despliegue. Nada se mezcla.

| Carpeta | Proyecto | Dónde corre | Cómo se sube |
|---|---|---|---|
| `apps_script/` | **Panel SIRE** (Descarga Sire completa, IGV por pagar, saldo a favor, IR) | Apps Script `1NmmMWj-…` (ver `.clasp.json` de la raíz) | Solo al hacer push con cambios en `apps_script/` (workflow `deploy-appsscript.yml`) |
| `cobranzas/` | **Cuentas por Cobrar y Pagar · Grupo** (+ su Asistente IA: `AsistenteIA.js`, `IACliente.js`) | Hoja Cobranzas, Apps Script `17EwOcmu…` (ver `cobranzas/.clasp.json`) | Solo al hacer push con cambios en `cobranzas/` (workflow `deploy-cobranzas.yml`) |
| `cobranzas/telegram/` | **🤖 Asistente de Telegram** (bot NUEVO, aparte del de Vouchers): chat con IA, fotos/PDF/voz, consultas de todos los proyectos, avisos, recordatorios y descargas de SUNAT. Ver su `README.md` | Dentro del proyecto de Cobranzas, como aplicación web (`doPost`) | Con `deploy-cobranzas.yml` (sube el código y vuelve a publicar la aplicación web cuando cambia el bot) |
| `vouchers_ia/` | **Asistente IA de la hoja Vouchers** (solo los 2 archivos del asistente) | Hoja "Sistema de Vouchers", carpeta `asistente_ia/` del proyecto | Solo a mano (workflow `asistente-vouchers.yml`): agrega estos 2 archivos sin tocar el bot |
| `vouchers_bot_respaldo/` | **Copia de seguridad** del código completo que corre en la hoja "Sistema de Vouchers" (bot de Telegram + asistente) | — (solo respaldo, no se sube) | Se actualiza solo cada lunes y a mano (workflow `respaldo-vouchers-bot.yml`) |
| `vouchers_whatsapp/` | **📲 Vouchers por WhatsApp** (aparte del bot de Telegram): reenvía fotos/PDF por WhatsApp → carpetas de Entrada de Vouchers, y avisa el resultado. Puente gratis en Cloudflare (`worker/`). Ver su `README.md` | Hoja propia "Vouchers WhatsApp" + aplicación web (`doPost`) | Con `deploy-vouchers-whatsapp.yml` (crea la hoja una vez; sube y publica en cada cambio) |
| `retenciones/` | **Retenciones · Grupo** (CRE emitidos y recibidos de SUNAT, PDF/XML, hoja propia + PDF en Drive) | Hoja "Retenciones · Grupo" (Apps Script en `retenciones/apps_script/`) + GitHub Actions | Descarga: `retenciones-descargar.yml` (guarda datos solo). Hoja: `deploy-retenciones.yml`, solo con cambios en `retenciones/apps_script/` |
| `honorarios/` | **Honorarios · Grupo** (Recibos por Honorarios Electrónicos RECIBIDOS de SUNAT, PDF/XML opcional, hoja propia + PDF en Drive) | Hoja "Honorarios · Grupo" (Apps Script en `honorarios/apps_script/`) + GitHub Actions | Descarga: `honorarios-descargar.yml` (guarda datos solo; PDF sí/no). Hoja: `deploy-honorarios.yml`, solo con cambios en `honorarios/apps_script/` |
| `notificaciones/` | **Notificaciones · Grupo** (Buzón Electrónico SUNAT SOL: notificaciones y mensajes de todas las empresas, PDF opcional, hoja propia + PDF en Drive) | Hoja "Notificaciones · Grupo" (Apps Script en `notificaciones/apps_script/`) + GitHub Actions | Descarga: `notificaciones-descargar.yml` (2 veces al día; PDF sí/no). Hoja: `deploy-notificaciones.yml`, solo con cambios en `notificaciones/apps_script/` |
| `detracciones/` | **Detracciones · Grupo** (depósitos de detracciones SPOT de todas las empresas, de SUNAT SOL → Mis declaraciones y pagos → Consulta de Pago de Detracciones; hoja propia) | Hoja "Detracciones · Grupo" (Apps Script en `detracciones/apps_script/`) + GitHub Actions | Descarga: `detracciones-descargar.yml` (diaria, últimos 3 meses; a mano por meses/empresa). Hoja: `deploy-detracciones.yml`, solo con cambios en `detracciones/apps_script/` |
| `guias/` | **🚚 Guías de Remisión · Grupo** (una hoja para todas las empresas con todos los datos de la GRE Remitente, catálogos, revisión automática y formulario; base del robot de Quesito). Ver su `README.md` | Hoja propia "Guías de Remisión · Grupo" (Apps Script en `guias/apps_script/`) | `deploy-guias.yml` (crea la hoja una vez; sube en cada cambio de `guias/apps_script/`) |
| `scripts/`, `sire/`, `facturas_descargadas/`, `docs/`, `empresas.json`, `facturas.csv` | **Descarga automática SIRE y facturas** (Python + datos) | GitHub Actions | Workflows `sire-*.yml` y `sunat-*.yml` (guardan datos solos); los días del bloque `mes_anterior` de `empresas.json` también bajan el mes anterior |

El código original del bot de Vouchers también está en el repositorio `Aquivan/voucher`, pero **no está al día** con lo que corre en la hoja: sus despliegues fallan desde agosto 2026 porque a ese repo le faltan las claves. La copia fiel es `vouchers_bot_respaldo/`.

## Reglas para proyectos nuevos

1. Una carpeta nueva por proyecto, con un `README.md` que diga qué hace y en qué hoja corre.
2. Su propio `.clasp.json` dentro de su carpeta y su propio workflow de despliegue.
3. Si un proyecto agrega algo a otro (como el Asistente IA en Vouchers), sus archivos van en una carpeta propia dentro de ese proyecto y con un prefijo de nombres propio (`IA_`), para que nunca se mezclen.
4. Las claves (API keys, tokens) nunca van en el código ni en GitHub: van en Propiedades del script o en Secrets.
