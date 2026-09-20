# Registro de Compras SIRE (10420738248) — todos los comprobantes

Tabla generada automaticamente en cada ejecucion del workflow `sire-cadena-completa.yml`, con TODOS los comprobantes del ultimo reporte descargado (periodo **202609**, 1 comprobante(s)). Se actualiza sola cada vez que se agregan mas comprobantes. Se omiten las columnas que SUNAT siempre trae vacias (`Año`, `Nro Final (Rango)`, `COD. DAM O DSI`, `Clasif de Bss y Sss`, `ID Proyecto Operadores`, `PorcPart`, `CAR Orig/ Ind E o I`, y `CLU1`...`CLU39`).

| RUC | Apellidos y Nombres o Razón social | Periodo | CAR SUNAT | Fecha de emisión | Fecha Vcto/Pago | Tipo CP/Doc. | Serie del CDP | Nro CP o Doc. Nro Inicial (Rango) | Tipo Doc Identidad | Nro Doc Identidad | Apellidos Nombres/ Razón  Social | BI Gravado DG | IGV / IPM DG | BI Gravado DGNG | IGV / IPM DGNG | BI Gravado DNG | IGV / IPM DNG | Valor Adq. NG | ISC | ICBPER | Otros Trib/ Cargos | Total CP | Moneda | Tipo de Cambio | Fecha Emisión Doc Modificado | Tipo CP Modificado | Serie CP Modificado | Nro CP Modificado | IMB | Detracción | Tipo de Nota | Est. Comp. | Incal | Estado | Link PDF | Link XML |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10420738248 | LUQUE RAFAEL EDWIN | 202609 | 2060921493801F0010000002162 | 18/09/2026 | 18/09/2026 | 01 | F001 | 2162 | 6 | 20609214938 | SERVICIOS GRIFO ALTIPLANO EIRL | 415.25 | 74.75 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 490.00 | PEN | 1.000 |  |  |  |  | 0.00 |  |  | 1 | 0 | YA-DESCARGADO | [2026/compra/202609/oficial/20609214938-01-F001-2162.pdf](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/10420738248/2026/compra/202609/oficial/20609214938-01-F001-2162.pdf) | [2026/compra/202609/oficial/20609214938-01-F001-2162-XML.zip](https://github.com/Aquivan/Claude/blob/claude/python-codes-izve18/facturas_descargadas/10420738248/2026/compra/202609/oficial/20609214938-01-F001-2162-XML.zip) |

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
| `Apellidos Nombres/ Razón  Social` | Razón social o nombre del proveedor |
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
| `Estado` | Resultado de la descarga automática del PDF/XML (`OK-oficial`, `OK-representacion`, `YA-DESCARGADO`, `FALLO`, `SIN-PROCESAR`) |
| `Link PDF` | Link al PDF del comprobante, guardado en el repositorio de GitHub |
| `Link XML` | Link al XML (ZIP) del comprobante, guardado en el repositorio de GitHub |

---

*Generado automaticamente por el workflow `sire-cadena-completa.yml` a partir de `sire/10420738248/reporte_parseado.csv` y `resumen.txt` en cada ejecucion.*
