# Google Apps Script para Google Sheets (SIRE + Comprobantes)

Esta carpeta contiene el código de Google Apps Script que corre en la hoja de cálculo de Google Sheets conectada a este repositorio.

## Archivos incluidos:
- `Config.gs`: Parámetros de configuración (Token de GitHub, Propietario, Repositorio, URL base de Cloudflare R2 / Webhook).
- `GitHubSync.gs`: Sincronización e importación automática de los reportes CSV descargados (Compras, Ventas, Histórico) y menú de ejecución de workflows.
- `Webhook.gs`: Endpoint de Web App para recibir avisos instantáneos de GitHub Actions cuando finaliza cada empresa/periodo. Al subir el código, `deploy-appsscript.yml` también pasa la Web App a la versión nueva (si no, lo que llega por GitHub corre código viejo, p. ej. el Panel sin Resumen IGV e IR).
- `appsscript.json`: Manifiesto de configuración de Apps Script.
- `MesAnterior.gs`: menú **📅 Descarga automática del mes anterior**. El interruptor es el bloque `mes_anterior` de `empresas.json`; la corrida programada de la 1:00 AM hora Perú de **SIRE completo** (`sire-cadena-completa.yml`) lo revisa y, si está activo y hoy es uno de sus días (por defecto 3 y 11), agrega el mes anterior de todas las empresas activas antes del mes actual. Se activa/desactiva/cambia desde este menú, desde GitHub (Run workflow de *SIRE completo* con la opción `mes_anterior`) o editando `empresas.json`.
