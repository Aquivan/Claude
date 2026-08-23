# Google Apps Script para Google Sheets (SIRE + Comprobantes)

Esta carpeta contiene el código de Google Apps Script que corre en la hoja de cálculo de Google Sheets conectada a este repositorio.

## Archivos incluidos:
- `Config.gs`: Parámetros de configuración (Token de GitHub, Propietario, Repositorio, URL base de Cloudflare R2 / Webhook).
- `GitHubSync.gs`: Sincronización e importación automática de los reportes CSV descargados (Compras, Ventas, Histórico) y menú de ejecución de workflows.
- `Webhook.gs`: Endpoint de Web App para recibir avisos instantáneos de GitHub Actions cuando finaliza cada empresa/periodo.
- `appsscript.json`: Manifiesto de configuración de Apps Script.
