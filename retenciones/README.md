# Retenciones · Grupo

Descarga automáticamente de SUNAT los **comprobantes de retención (CRE) emitidos y recibidos** de las empresas de SIRE (desde enero 2026), con su **PDF y XML oficiales**, y los muestra en su propia hoja de Google Sheets con los PDF ordenados en Drive.

No comparte código ni hojas con Cobranzas, SIRE ni Vouchers.

- **Hoja:** "Retenciones · Grupo", dentro de la carpeta de Drive "Retenciones · Grupo".
- **PDF en Drive:** `Retenciones · Grupo/PDF Retenciones/<RUC - Empresa>/<Emitidas|Recibidas>/<AAAA>/<NN_Mes>/E001-198 - PROVEEDOR.pdf`.

## Cómo funciona (igual que SIRE)

1. **GitHub Actions** entra a SUNAT SOL de cada empresa y baja los comprobantes:
   - lista: menú 11.9.7.1.1 "Consulta del comprobante de retención electrónico" (filtros "TODOS" = `000`);
   - PDF y XML: API de consulta de comprobantes (menú 11.38.1.1.1, código 20 = Comprobante de Retención).
   Se guardan en `retenciones/datos/<RUC>/<AAAA>/<MM>/`.
2. **La hoja** (Apps Script en `apps_script/`) lee esos archivos y arma las pestañas, y copia los PDF a Drive.

## Estructura

| Ruta | Qué es |
|---|---|
| `scripts/descargar_cre.py` | Descarga de SUNAT (lista + PDF + XML). El detalle de facturas se saca del XML oficial. |
| `scripts/ver_pantallas.py` | La misma consulta con un navegador Chrome real: fotos de cada pantalla y video, para verlo con sus propios ojos. |
| `apps_script/` | Código de la hoja (Config, GitHub, Hojas, Drive). Se sube con `deploy-retenciones.yml`. |
| `datos/<RUC>/<AAAA>/<MM>/cre.csv` | Un renglón por comprobante de retención. |
| `datos/<RUC>/<AAAA>/<MM>/detalle.csv` | Un renglón por factura retenida (del XML). |
| `datos/<RUC>/<AAAA>/<MM>/pdf/` y `xml/` | PDF y XML oficiales: `<RUC emisor>-<serie>-<número>`. |
| `../.github/workflows/retenciones-descargar.yml` | Descarga (una empresa o `todas`, rango de meses). |
| `../.github/workflows/retenciones-ver-pantallas.yml` | Fotos y video del recorrido (en "Artifacts", 3 días). |
| `../.github/workflows/deploy-retenciones.yml` | Sube el código de la hoja (solo cambios en `apps_script/`). |
| `../.github/workflows/retenciones-sondeo.yml` | Sondeo de solo lectura usado en la investigación. |

## Pestañas de la hoja

- **Panel**: resumen por empresa (emitidas, recibidas, revertidos, PDF) y matrices por mes.
- **Emitidas**: lo que retuvimos a proveedores. **Recibidas**: lo que nos retuvieron clientes. Cada fila tiene "📄 Ver PDF".
- **Detalle**: cada factura incluida en cada comprobante (importe, pago, retenido, neto).
- **Config**: repositorio, rama, mes "desde", carpeta de PDF.

Menú **🧾 Retenciones**: actualizar todo, solo datos, solo PDF, pedir a SUNAT lo nuevo, actualización diaria, token de GitHub, probar conexión.
El token de GitHub se guarda con el menú 🔑 (Propiedades del script), nunca en celdas ni en el repositorio.
