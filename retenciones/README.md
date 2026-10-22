# Retenciones · Grupo

Descarga automáticamente de SUNAT los **comprobantes de retención (CRE) emitidos y recibidos** de las empresas de SIRE (desde enero 2026), con su **PDF y XML oficiales**, y los muestra en su propia hoja de Google Sheets con los PDF ordenados en Drive.

No comparte código ni hojas con Cobranzas, SIRE ni Vouchers.

- **Hoja:** "Retenciones · Grupo" (https://docs.google.com/spreadsheets/d/1YpgrLWya8jPIhxurz0wvRuAf4A-Ts6K79NZhkBk6zpw), dentro de la carpeta de Drive "Retenciones · Grupo" (https://drive.google.com/drive/folders/1evkFKBWQXKIY-eeKqEsBB2Ajv2WAHebH).
- **PDF en Drive:** `Retenciones · Grupo/PDF Retenciones/<RUC - Empresa>/<Emitidas|Recibidas>/<AAAA>/<NN_Mes>/E001-198 - PROVEEDOR.pdf`.

## Cómo funciona (igual que SIRE)

1. **GitHub Actions** entra a SUNAT SOL de cada empresa y baja los comprobantes:
   - lista: menú 11.9.7.1.1 "Consulta del comprobante de retención electrónico" (filtros "TODOS" = `000`);
   - PDF y XML: API de consulta de comprobantes (menú 11.38.1.1.1, código 20 = Comprobante de Retención).
   Se guardan en `retenciones/datos/<RUC>/<AAAA>/<MM>/`.
2. **La hoja** (Apps Script en `apps_script/`) lee esos archivos y arma las pestañas, y copia los PDF a Drive.

## Emitir comprobantes de retención

**Desde el bot:** en Telegram `/emitir` (o el botón 🧾 Por emitir de `/retenciones`); en WhatsApp escriba **emitir**.
Lista los pagos de este mes que se hicieron sin su CRE (según la hoja de Cobranzas) con dos botones:
**👁 Vista previa** (llena el CRE en SUNAT y se detiene antes de Emitir) y **✅ Emitir** (pide "Sí, emitir").
En Telegram solo un administrador puede emitir; en WhatsApp, los números que un administrador autorice con
`/emitirwa <número>`. El resultado llega al mismo chat: "✅ Comprobante de retención emitido: E001-…" o el motivo.

`emision/emitir_cre.py` (flujo `retenciones-cre.yml`, modo emitir) emite solo si: la clave de confirmación es la
de ESA solicitud (sha256 de empresa|proveedor|total, la pone el bot al confirmar), SUNAT calcula exactamente el total
aprobado, la factura no tiene ya un comprobante (lo consulta en SUNAT) y no hay avisos sin autorizar.
Los pagos de meses anteriores ya no se pueden emitir por SEE-SOL y los de dólares se hacen a mano.


`emision/vista_cre.py` prepara un CRE en **SEE-SOL** (menú 11.5.8.1.1 "Emitir Comprobante de Retención") con un navegador
real y **se detiene en la Vista preliminar: no emite** (no tiene ese paso). Valida el RUC del proveedor, agrega cada
factura (SUNAT trae su fecha y total), sus **notas de crédito** (serie y número; SUNAT trae fecha e importe y las resta),
la fecha y el importe del pago, y comprueba que el 3 % que calcula SUNAT sea el esperado. En el registro no imprime
montos, nombres ni RUC. Se corre con `retenciones-cre-vista.yml` (empresa + solicitud en JSON).

- `emision/beta_see_del.py` + `retenciones-emision-beta.yml`: prueba del otro camino (SEE-Del Contribuyente, XML firmado)
  en el entorno de pruebas de SUNAT, con datos ficticios.
- `emision/sondeo_sol.py` + `retenciones-emision-sondeo.yml`: sondeo de solo lectura del formulario de SUNAT.

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

## Descarga diaria puntual (y respaldo)

El programador de GitHub (cron) se atrasa horas y a veces se salta días. Por eso
el disparador diario de la hoja (`*_actualizacionAutomatica`, `Diario.js`) es el
que **pide** la descarga a GitHub a su hora (workflow_dispatch, arranca en
segundos), revisa cada 8 minutos y **importa cuando termina**. El cron del
workflow queda como **respaldo**: las corridas diarias se llaman igual
("… · diario"), van en fila (`concurrency`) y si una ya corrió, la otra no
descarga nada.

