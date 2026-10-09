# Retenciones · Grupo (en construcción)

Proyecto aparte para descargar automáticamente de SUNAT los **comprobantes de retención (CRE) emitidos y recibidos** de las empresas de SIRE, desde enero 2026, y mostrarlos en su propia hoja de Google Sheets.

No comparte código ni hojas con Cobranzas, SIRE ni Vouchers.

## Estructura

| Ruta | Qué es |
|---|---|
| `scripts/descargar_cre.py` | Entra a SUNAT SOL (opción 11.9.7.1.1 "Consulta de comprobantes de retención") y baja los CRE emitidos y recibidos de un mes, con su detalle. |
| `datos/<RUC>/<AAAAMM>_cre.csv` | Cabecera de cada CRE (emitido / recibido). |
| `datos/<RUC>/<AAAAMM>_detalle.csv` | Comprobantes retenidos dentro de cada CRE. |
| `../.github/workflows/retenciones-descargar.yml` | Ejecuta la descarga para una empresa y un mes (manual). |
| `../.github/workflows/retenciones-sondeo.yml` | Sondeo de solo lectura usado en la investigación. |

## Cómo se ejecuta

GitHub → Actions → **Retenciones - descargar CRE (SUNAT SOL)** → Run workflow:
- `ruc`: empresa (usa su Environment con las claves SOL ya existentes).
- `periodo`: AAAAMM.
- `diagnostico`: muestra detalle técnico en el log (nunca claves).
- `guardar`: si se marca, guarda los CSV en `retenciones/datos/`.

## Fases

1. **(actual)** Descarga de 1 empresa y 1 mes, emitidos y recibidos, con detalle.
2. Todas las empresas de SIRE desde enero 2026 + cuadre con la cuenta de control SUNAT (12.8.2.1.2).
3. Hoja propia "Retenciones · Grupo" (Panel, Recibidas, Emitidas, Consulta, Config) con su Apps Script en esta carpeta.
