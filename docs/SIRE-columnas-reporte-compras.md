# Registro de Compras SIRE — estructura de columnas

Estructura real del **Registro de Compras (RCE)** tal como queda en la hoja
"Reporte SIRE", con los nombres de cabecera oficiales de SUNAT en el mismo
orden en que se descargan, más las 3 columnas que el sistema agrega al
final (`Estado`, `Link PDF`, `Link XML`).

Se omiten las columnas que SUNAT trae en el archivo pero que siempre llegan
vacías (`Año`, `Nro Final (Rango)`, `COD. DAM O DSI`, `Clasif de Bss y Sss`,
`ID Proyecto Operadores`, `PorcPart`, `CAR Orig/ Ind E o I`, y `CLU1`...`CLU39`).

Ejemplo con 3 comprobantes reales (periodo 202607):

| RUC | Apellidos y Nombres o Razón social | Periodo | CAR SUNAT | Fecha de emisión | Fecha Vcto/Pago | Tipo CP/Doc. | Serie del CDP | Nro CP o Doc. Nro Inicial (Rango) | Tipo Doc Identidad | Nro Doc Identidad | Apellidos Nombres/ Razón Social | BI Gravado DG | IGV / IPM DG | BI Gravado DGNG | IGV / IPM DGNG | BI Gravado DNG | IGV / IPM DNG | Valor Adq. NG | ISC | ICBPER | Otros Trib/ Cargos | Total CP | Moneda | Tipo de Cambio | Fecha Emisión Doc Modificado | Tipo CP Modificado | Serie CP Modificado | Nro CP Modificado | IMB | Detracción | Tipo de Nota | Est. Comp. | Incal | Estado | Link PDF | Link XML |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20615366791 | CORPORACION EMPRESARIAL JENILE E.I.R.L. | 202607 | 2053703631201F0010000004593 | 02/07/2026 | 02/07/2026 | 01 | F001 | 4593 | 6 | 20537036312 | INDUSTRIA IMPERIAL S.A.C. | 640.68 | 115.32 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 756.00 | PEN | 1.000 | | | | | 0.00 | | | 1 | 0 | OK | [github.com/.../20537036312-01-F001-4593.pdf](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/oficial/20537036312-01-F001-4593.pdf) | [github.com/.../20537036312-01-F001-4593-XML.zip](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/oficial/20537036312-01-F001-4593-XML.zip) |
| 20615366791 | CORPORACION EMPRESARIAL JENILE E.I.R.L. | 202607 | 2051722256001F0020000052904 | 02/07/2026 | 02/08/2026 | 01 | F002 | 52904 | 6 | 20517222560 | CORPORACION LON S.A.C. | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 23820.60 | 0.00 | 0.00 | 0.00 | 23820.60 | PEN | 1.000 | | | | | 0.00 | D | | 1 | 0 | OK | [github.com/.../20517222560-01-F002-52904.pdf](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/oficial/20517222560-01-F002-52904.pdf) | [github.com/.../20517222560-01-F002-52904-XML.zip](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/oficial/20517222560-01-F002-52904-XML.zip) |
| 20615366791 | CORPORACION EMPRESARIAL JENILE E.I.R.L. | 202607 | 2060430160307E0010000000792 | 31/07/2026 | | 07 | E001 | 792 | 6 | 20604301603 | DISTRIBUIDORA DE PRODUCTOS MARINOS Y ALIMENTOS CASALI S.A.C. | -138135.59 | -24864.41 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | -163000.00 | PEN | 1.000 | 17/07/2026 | 01 | E001 | 3425 | 0.00 | | 01 | 1 | 0 | OK | [github.com/.../20604301603-F7-E001-792.pdf](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/oficial/20604301603-F7-E001-792.pdf) | [github.com/.../20604301603-07-E001-792-XML.zip](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/oficial/20604301603-07-E001-792-XML.zip) |

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
| `Tipo Doc Identidad` | Tipo de documento del proveedor (`6`=RUC) |
| `Nro Doc Identidad` | RUC del proveedor |
| `Apellidos Nombres/ Razón Social` | Razón social o nombre del proveedor |
| `BI Gravado DG` | Base imponible gravada — Destino Gravado |
| `IGV / IPM DG` | IGV de la base gravada DG |
| `BI Gravado DGNG` | Base imponible — Destino Gravado y No Gravado (uso mixto) |
| `IGV / IPM DGNG` | IGV de la base DGNG |
| `BI Gravado DNG` | Base imponible — Destino No Gravado |
| `IGV / IPM DNG` | IGV de la base DNG |
| `Valor Adq. NG` | Valor de adquisición No Gravado (exonerado/inafecto) |
| `ISC` | Impuesto Selectivo al Consumo |
| `ICBPER` | Impuesto a las bolsas plásticas |
| `Otros Trib/ Cargos` | Otros tributos o cargos del comprobante |
| `Total CP` | Importe total del comprobante |
| `Moneda` | Código de moneda (`PEN`=soles) |
| `Tipo de Cambio` | Tipo de cambio aplicado |
| `Fecha Emisión Doc Modificado` | Fecha de emisión del comprobante que la nota modifica (solo notas) |
| `Tipo CP Modificado` | Tipo del comprobante modificado (solo notas) |
| `Serie CP Modificado` | Serie del comprobante modificado (solo notas) |
| `Nro CP Modificado` | Número del comprobante modificado (solo notas) |
| `IMB` | Campo de uso interno de SUNAT (siempre `0.00` en los reportes observados) |
| `Detracción` | `D` = comprobante con detracción, vacío = sin detracción |
| `Tipo de Nota` | Motivo de la nota de crédito/débito (Catálogo 09 SUNAT), solo en notas |
| `Est. Comp.` | Estado del comprobante en el libro (`1` = vigente) |
| `Incal` | Indicador de comprobante observado por SUNAT (`0` = sin observación) |
| `Estado` | Resultado de la descarga automática del PDF/XML (`OK`, `FALLO`, `PENDIENTE`) |
| `Link PDF` | Link al PDF del comprobante, guardado en el repositorio de GitHub (`facturas_descargadas/oficial/...`) |
| `Link XML` | Link al XML (ZIP) del comprobante, guardado en el repositorio de GitHub (`facturas_descargadas/oficial/...`) |

---

*Ejemplo tomado de un reporte real (43 comprobantes, periodo 202607, RUC
20615366791) descargado por `scripts/sire_client.py` vía la cadena
automatizada `sire-cadena-completa.yml`. Los links de arriba son reales y
apuntan al repositorio de GitHub (no a Drive/Sheet) — así queda subido cada
PDF y XML tras la descarga.*
