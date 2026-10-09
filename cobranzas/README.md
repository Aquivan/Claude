# Cuentas por Cobrar y Pagar · Grupo

Sistema multiempresa en Google Sheets: cruza SIRE (Liquidaciones), vouchers y registro manual (retenciones, detracciones, N/C) y muestra Panel, Consulta, Documentos, Movimientos, Conciliar y Otros pagos. Se actualiza solo cada 10 minutos.

- Proyecto Apps Script: ver `.clasp.json`.
- `AsistenteIA.js` + `IACliente.js` → módulo aparte "🧠 Asistente IA" (preguntas sobre los datos y facturas sugeridas). El cruce no lo lee.
- Se sube solo al hacer push con cambios en esta carpeta (workflow `deploy-cobranzas.yml`).
