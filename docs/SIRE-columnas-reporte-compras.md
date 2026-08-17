# Columnas del reporte SIRE (Registro de Compras Electrónico)

Documentación de las columnas reales que trae el reporte de **Compras (RCE)**
descargado desde la API oficial de SUNAT (`scripts/sire_client.py`), tal como
llega en `sire/reporte_parseado.csv`.

El archivo original de SUNAT trae **80 columnas** con los nombres de cabecera
oficiales. De esas, **46 nunca traen datos** en nuestros reportes reales
(son campos que SUNAT reserva pero no usa en este tipo de operación, o que
solo aplican a un tipo de compra que esta empresa no realiza) y se omiten
aqui:

- `Año`, `Nro Final (Rango)`, `COD. DAM O DSI`, `Clasif de Bss y Sss`,
  `ID Proyecto Operadores`, `PorcPart`, `CAR Orig/ Ind E o I`
- Las 39 columnas `CLU1` a `CLU39` (campos reservados de SUNAT para
  detalle de casilleros/clusters, no usados en este libro)

Quedan las **34 columnas con datos reales**, documentadas abajo en el mismo
orden en que aparecen en el archivo.

## Datos del comprobante

| # | Columna | Qué contiene | Ejemplo real |
|---|---------|--------------|---------------|
| 1 | `RUC` | RUC de la empresa (siempre el mismo: la que descarga el reporte) | `20615366791` |
| 2 | `Apellidos y Nombres o Razón social` | Razón social de la empresa que descarga el reporte | `CORPORACION EMPRESARIAL JENILE E.I.R.L.` |
| 3 | `Periodo` | Periodo tributario, formato AAAAMM | `202607` (julio 2026) |
| 4 | `CAR SUNAT` | Código Único de Registro: identificador único que SUNAT asigna a cada comprobante dentro del libro electrónico | `2053703631201F0010000004593` |
| 5 | `Fecha de emisión` | Fecha en que se emitió el comprobante | `02/07/2026` |
| 6 | `Fecha Vcto/Pago` | Fecha de vencimiento o pago pactada (solo viene en algunos comprobantes, ej. facturas con crédito) | `02/08/2026` |
| 7 | `Tipo CP/Doc.` | Código de tipo de comprobante (Catálogo 01 SUNAT) | `01` = Factura, `07` = Nota de Crédito |
| 8 | `Serie del CDP` | Serie del comprobante | `E001`, `F001`, `F002` |
| 9 | `Nro CP o Doc. Nro Inicial (Rango)` | Número del comprobante | `4593` |

## Proveedor (emisor del comprobante)

| # | Columna | Qué contiene | Ejemplo real |
|---|---------|--------------|---------------|
| 10 | `Tipo Doc Identidad` | Tipo de documento del proveedor (Catálogo SUNAT) | `6` = RUC |
| 11 | `Nro Doc Identidad` | Número de documento del proveedor (RUC) | `20537036312` |
| 12 | `Apellidos Nombres/ Razón Social` | Razón social o nombre del proveedor | `INDUSTRIA IMPERIAL S.A.C.` |

## Importes

| # | Columna | Qué contiene | Ejemplo real |
|---|---------|--------------|---------------|
| 13 | `BI Gravado DG` | Base imponible gravada — Destino Gravado (operación afecta a IGV, uso 100% gravado) | `640.68` |
| 14 | `IGV / IPM DG` | IGV correspondiente a la base gravada DG | `115.32` |
| 15 | `BI Gravado DGNG` | Base imponible — Destino Gravado y No Gravado (compras de uso mixto) | `0.00` |
| 16 | `IGV / IPM DGNG` | IGV correspondiente a DGNG | `0.00` |
| 17 | `BI Gravado DNG` | Base imponible — Destino No Gravado | `0.00` |
| 18 | `IGV / IPM DNG` | IGV correspondiente a DNG | `0.00` |
| 19 | `Valor Adq. NG` | Valor de adquisición No Gravado (operaciones exoneradas, inafectas o sin derecho a crédito fiscal) | `23820.60` |
| 20 | `ISC` | Impuesto Selectivo al Consumo | `0.00` |
| 21 | `ICBPER` | Impuesto al Consumo de Bolsas Plásticas | `0.00` |
| 22 | `Otros Trib/ Cargos` | Otros tributos o cargos incluidos en el comprobante | `0.00` |
| 23 | `Total CP` | Importe total del comprobante | `756.00` |
| 24 | `Moneda` | Código de moneda | `PEN` (soles) |
| 25 | `Tipo de Cambio` | Tipo de cambio aplicado (si la moneda no es soles) | `1.000` |

## Solo para Notas de Crédito/Débito (comprobante que modifican)

Estas 4 columnas solo traen datos cuando `Tipo CP/Doc.` es una nota (`07`,
`08`); en facturas y boletas quedan vacías.

| # | Columna | Qué contiene | Ejemplo real |
|---|---------|--------------|---------------|
| 26 | `Fecha Emisión Doc Modificado` | Fecha de emisión del comprobante original que la nota modifica | `17/07/2026` |
| 27 | `Tipo CP Modificado` | Tipo del comprobante original modificado | `01` (Factura) |
| 28 | `Serie CP Modificado` | Serie del comprobante original modificado | `E001` |
| 29 | `Nro CP Modificado` | Número del comprobante original modificado | `3425` |

## Otros indicadores

| # | Columna | Qué contiene | Ejemplo real |
|---|---------|--------------|---------------|
| 30 | `IMB` | Campo de SUNAT de uso interno (siempre `0.00` en los reportes observados; no tiene efecto en el procesamiento) | `0.00` |
| 31 | `Detracción` | Indicador de si la operación está sujeta a detracción | `D` = con detracción (vacío = sin detracción) |
| 32 | `Tipo de Nota` | Motivo de la nota de crédito/débito (Catálogo 09 SUNAT). Solo en notas | `01` = Anulación de la operación |
| 33 | `Est. Comp.` | Estado del comprobante en el libro | `1` = comprobante válido/vigente |
| 34 | `Incal` | Indicador de comprobante "no calificado" u observado por SUNAT | `0` = sin observación |

---

*Generado a partir de un reporte real (43 comprobantes, periodo 202607,
RUC 20615366791) descargado por `scripts/sire_client.py` vía la cadena
automatizada `sire-cadena-completa.yml`.*
