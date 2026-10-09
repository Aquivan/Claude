# Proyectos de este repositorio

Cada proyecto vive en **su propia carpeta**, con su propio despliegue. Nada se mezcla.

| Carpeta | Proyecto | Dónde corre | Cómo se sube |
|---|---|---|---|
| `apps_script/` | **Panel SIRE** (Descarga Sire completa, IGV por pagar, saldo a favor, IR) | Apps Script `1NmmMWj-…` (ver `.clasp.json` de la raíz) | Solo al hacer push con cambios en `apps_script/` (workflow `deploy-appsscript.yml`) |
| `cobranzas/` | **Cuentas por Cobrar y Pagar · Grupo** (+ su Asistente IA: `AsistenteIA.js`, `IACliente.js`) | Hoja Cobranzas, Apps Script `17EwOcmu…` (ver `cobranzas/.clasp.json`) | Solo al hacer push con cambios en `cobranzas/` (workflow `deploy-cobranzas.yml`) |
| `vouchers_ia/` | **Asistente IA de la hoja Vouchers** (solo los 2 archivos del asistente) | Hoja "Sistema de Vouchers", carpeta `asistente_ia/` del proyecto | Solo a mano (workflow `asistente-vouchers.yml`): agrega estos 2 archivos sin tocar el bot |
| `vouchers_bot_respaldo/` | **Copia de seguridad** del código completo que corre en la hoja "Sistema de Vouchers" (bot de Telegram + asistente) | — (solo respaldo, no se sube) | Se actualiza solo cada lunes y a mano (workflow `respaldo-vouchers-bot.yml`) |
| `retenciones/` | **Retenciones · Grupo** (CRE emitidos y recibidos de SUNAT, PDF/XML, hoja propia + PDF en Drive) | Hoja "Retenciones · Grupo" (Apps Script en `retenciones/apps_script/`) + GitHub Actions | Descarga: `retenciones-descargar.yml` (guarda datos solo). Hoja: `deploy-retenciones.yml`, solo con cambios en `retenciones/apps_script/` |
| `scripts/`, `sire/`, `facturas_descargadas/`, `docs/`, `empresas.json`, `facturas.csv` | **Descarga automática SIRE y facturas** (Python + datos) | GitHub Actions | Workflows `sire-*.yml` y `sunat-*.yml` (guardan datos solos) |

El código original del bot de Vouchers también está en el repositorio `Aquivan/voucher`, pero **no está al día** con lo que corre en la hoja: sus despliegues fallan desde agosto 2026 porque a ese repo le faltan las claves. La copia fiel es `vouchers_bot_respaldo/`.

## Reglas para proyectos nuevos

1. Una carpeta nueva por proyecto, con un `README.md` que diga qué hace y en qué hoja corre.
2. Su propio `.clasp.json` dentro de su carpeta y su propio workflow de despliegue.
3. Si un proyecto agrega algo a otro (como el Asistente IA en Vouchers), sus archivos van en una carpeta propia dentro de ese proyecto y con un prefijo de nombres propio (`IA_`), para que nunca se mezclen.
4. Las claves (API keys, tokens) nunca van en el código ni en GitHub: van en Propiedades del script o en Secrets.
