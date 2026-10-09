# Cuentas por Cobrar y Pagar · Grupo

Sistema multiempresa en Google Sheets: cruza SIRE (Liquidaciones), vouchers, retenciones de SUNAT (hoja Retenciones · Grupo) y registro manual (efectivo, compensaciones, detracciones, otros) y muestra Panel, Consulta, Documentos, Movimientos, Conciliar y Otros pagos. Se actualiza solo cada 10 minutos.

- Proyecto Apps Script: ver `.clasp.json`.
- `AsistenteIA.js` + `IACliente.js` → módulo aparte "🧠 Asistente IA" (preguntas sobre los datos y facturas sugeridas). El cruce no lo lee.
- `RetencionesSunat.js` → lee (solo lectura) la hoja **Retenciones · Grupo** (ID en ⚙️ Config, fila 12) y descuenta cada retención de SUNAT de su factura: por cobrar (nos retuvieron) y por pagar (retuvimos). No usa comprobantes revertidos; si la misma retención está en ✍️ Registro manual, usa la manual y avisa.
- 🔁 **Reasignar retenciones** (menú 💼 Cobranzas → 🔁 Reasignar una retención): cuando la factura retenida se anuló (toda o en parte) con N/C, pasa esa retención de SUNAT a otra(s) factura(s) que usted elija (todo o un monto). A la derecha, 💡 SUGERIDAS lista las facturas con N/C que quedaron a favor por una retención, con el exceso.
- ✍️ **Registro manual** (menú 💼 Cobranzas → ✍️ Registrar cobro/pago manual): cobros o pagos en efectivo, pagos por otro medio, compensaciones (cruce de cuentas), detracciones, otros descuentos o una retención que no esté en SUNAT.
- Se sube solo al hacer push con cambios en esta carpeta (workflow `deploy-cobranzas.yml`).
