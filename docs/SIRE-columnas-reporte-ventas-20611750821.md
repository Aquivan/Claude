# Registro de Ventas SIRE (20611750821) — todos los comprobantes

Tabla generada automaticamente en cada ejecucion del workflow `sire-cadena-completa.yml`, con TODOS los comprobantes del ultimo reporte descargado (periodo **202609**, 2 comprobante(s)). Se actualiza sola cada vez que se agregan mas comprobantes. El .txt de ventas de SUNAT no trae fila de cabecera (a diferencia de compras); se le puso una cabecera por posicion. Se omite solo `Nro Final (Rango)` (siempre vacio).

| RUC | Apellidos y Nombres o Razón social | Periodo | CAR SUNAT | Fecha de emisión | Fecha Vcto/Pago | Tipo CP/Doc. | Serie del CDP | Nro CP o Doc. Nro Inicial (Rango) | Tipo Doc Identidad | Nro Doc Identidad | Apellidos Nombres/ Razón  Social | Campo 14 (SUNAT) | BI Gravada | Campo 16 (SUNAT) | IGV / IPM | Campo 18 (SUNAT) | Monto Exonerado | Campo 20 (SUNAT) | Campo 21 (SUNAT) | Campo 22 (SUNAT) | Campo 23 (SUNAT) | Campo 24 (SUNAT) | Total CP | Moneda | Tipo de Cambio | Fecha Emisión Doc Modificado | Tipo CP Modificado | Serie CP Modificado | Nro CP Modificado | Estado | Link PDF | Link XML |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|  |  | 202609 | 2061175082101E0010000000036 | 19/09/2026 |  | 01 | E001 | 36 | 6 | 20613700910 |  |  | 3061.02 |  | 550.98 |  |  |  |  |  |  |  | 3612 | PEN |  |  |  |  |  | YA-DESCARGADO | [2026/venta/202609/oficial/20611750821-01-E001-36.pdf](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/20611750821/2026/venta/202609/oficial/20611750821-01-E001-36.pdf) | [2026/venta/202609/oficial/20611750821-01-E001-36-XML.zip](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/20611750821/2026/venta/202609/oficial/20611750821-01-E001-36-XML.zip) |
|  |  | 202609 | 2061175082101E0010000000037 | 25/09/2026 |  | 01 | E001 | 37 | 6 | 20604044082 |  |  | 1464.41 |  | 263.59 |  |  |  |  |  |  |  | 1728 | PEN |  |  |  |  |  | YA-DESCARGADO | [2026/venta/202609/oficial/20611750821-01-E001-37.pdf](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/20611750821/2026/venta/202609/oficial/20611750821-01-E001-37.pdf) | [2026/venta/202609/oficial/20611750821-01-E001-37-XML.zip](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/20611750821/2026/venta/202609/oficial/20611750821-01-E001-37-XML.zip) |

## Qué significa cada columna

| Columna | Significado |
|---|---|
| `RUC` | RUC de la empresa que descarga el reporte |
| `Apellidos y Nombres o Razón social` | Razón social de la empresa que descarga el reporte |
| `Periodo` | Periodo tributario AAAAMM |
| `CAR SUNAT` | Código Único de Registro del comprobante en el libro electrónico |
| `Fecha de emisión` | Fecha de emisión del comprobante |
| `Fecha Vcto/Pago` | Fecha de vencimiento o pago pactada (si aplica) |
| `Tipo CP/Doc.` | Código de tipo de comprobante (Catálogo 01 SUNAT: `01`=Factura, `07`=Nota de Crédito, `08`=Nota de Débito) |
| `Serie del CDP` | Serie del comprobante |
| `Nro CP o Doc. Nro Inicial (Rango)` | Número del comprobante |
| `Tipo Doc Identidad` | Tipo de documento del cliente (`6`=RUC) |
| `Nro Doc Identidad` | RUC del cliente |
| `Apellidos Nombres/ Razón  Social` | Razón social o nombre del cliente |
| `Campo 14 (SUNAT)` | Campo de SUNAT del reporte de ventas cuyo nombre oficial no se pudo confirmar contra el manual (siempre 0 en los datos vistos hasta ahora; se muestra tal cual, sin interpretar, por si algun periodo lo usa). |
| `BI Gravada` | Base imponible gravada con IGV |
| `Campo 16 (SUNAT)` | Campo de SUNAT del reporte de ventas cuyo nombre oficial no se pudo confirmar contra el manual (siempre 0 en los datos vistos hasta ahora; se muestra tal cual, sin interpretar, por si algun periodo lo usa). |
| `IGV / IPM` | IGV/IPM de la base gravada |
| `Campo 18 (SUNAT)` | Campo de SUNAT del reporte de ventas cuyo nombre oficial no se pudo confirmar contra el manual (siempre 0 en los datos vistos hasta ahora; se muestra tal cual, sin interpretar, por si algun periodo lo usa). |
| `Monto Exonerado` | Monto de venta exonerada de IGV (confirmado: cuando BI/IGV estan en 0, este campo es igual al Total CP) |
| `Campo 20 (SUNAT)` | Campo de SUNAT del reporte de ventas cuyo nombre oficial no se pudo confirmar contra el manual (siempre 0 en los datos vistos hasta ahora; se muestra tal cual, sin interpretar, por si algun periodo lo usa). |
| `Campo 21 (SUNAT)` | Campo de SUNAT del reporte de ventas cuyo nombre oficial no se pudo confirmar contra el manual (siempre 0 en los datos vistos hasta ahora; se muestra tal cual, sin interpretar, por si algun periodo lo usa). |
| `Campo 22 (SUNAT)` | Campo de SUNAT del reporte de ventas cuyo nombre oficial no se pudo confirmar contra el manual (siempre 0 en los datos vistos hasta ahora; se muestra tal cual, sin interpretar, por si algun periodo lo usa). |
| `Campo 23 (SUNAT)` | Campo de SUNAT del reporte de ventas cuyo nombre oficial no se pudo confirmar contra el manual (siempre 0 en los datos vistos hasta ahora; se muestra tal cual, sin interpretar, por si algun periodo lo usa). |
| `Campo 24 (SUNAT)` | Campo de SUNAT del reporte de ventas cuyo nombre oficial no se pudo confirmar contra el manual (siempre 0 en los datos vistos hasta ahora; se muestra tal cual, sin interpretar, por si algun periodo lo usa). |
| `Total CP` | Importe total del comprobante |
| `Moneda` | Código de moneda (`PEN`=soles) |
| `Tipo de Cambio` | Tipo de cambio aplicado |
| `Fecha Emisión Doc Modificado` | Fecha de emisión del comprobante que la nota modifica (solo notas) |
| `Tipo CP Modificado` | Tipo del comprobante modificado (solo notas) |
| `Serie CP Modificado` | Serie del comprobante modificado (solo notas) |
| `Nro CP Modificado` | Número del comprobante modificado (solo notas) |
| `Estado` | Resultado de la descarga automática del PDF/XML (`OK-oficial`, `OK-representacion`, `YA-DESCARGADO`, `FALLO`, `SIN-PROCESAR`) |
| `Link PDF` | Link al PDF del comprobante, guardado en el repositorio de GitHub |
| `Link XML` | Link al XML (ZIP) del comprobante, guardado en el repositorio de GitHub |

---

*Generado automaticamente por el workflow `sire-cadena-completa.yml` a partir de `sire/20611750821/reporte_parseado_ventas.csv` y `resumen.txt` en cada ejecucion.*
