# Detracciones · Grupo

Reporte multiempresa de detracciones (SPOT): los **depósitos** que cada empresa del
grupo hizo a la cuenta del Banco de la Nación de sus proveedores (como adquiriente),
descargados de SUNAT SOL, en una hoja propia: **"Detracciones · Grupo"**
(carpeta *Detracciones* de Drive: https://docs.google.com/spreadsheets/d/1p6c0G7KgIFGb4aWqeSMcRY9QNPxyePCwBg9T2wjXTIU/edit , Apps Script en `apps_script/`, `.clasp.json` ya guardado).

## De dónde salen los datos

SUNAT SOL → **Mis declaraciones y pagos** (nueva plataforma, menú `cl-ti-itmenu2`) →
Consultas → **Consulta de Pago de Detracciones** (opción `55.2.1.1.4`).

Esa pantalla consulta por *fecha de pago*, *tipo de cuenta* (Convencional / IVAP /
Ley 30737) y *tipo de pago* (individuales / masivos), y la página lo pide a SUNAT
en `e-plataformaunica.sunat.gob.pe/v1/recaudacion/tributaria/declapago/detracciones/t/consultar`
(JSON con constancia, comprobante, proveedor, adquiriente, bien o servicio, monto,
cuenta, NPD y origen).

Ojo: la opción antigua del menú SOL (12.4.1.1.2 "Consulta de detracciones") dice
"Acceso no autorizado" con los usuarios secundarios; la de la nueva plataforma sí abre.

## Partes

| Qué | Dónde |
|---|---|
| Descargador (Chrome real, solo lee) | `scripts/descargar_detracciones.py` |
| Descarga multiempresa | workflow `detracciones-descargar.yml`: todos los días ~7:17 a. m. (la hoja la pide a las 8 a. m. y el cron es respaldo), últimos 3 meses; a mano: empresa, desde/hasta (AAAAMM), IVAP |
| Datos | `datos/<RUC>/<AAAA>/<MM>/detracciones.csv` (mes = fecha de pago) y `masivos.json` si hubo pagos masivos |
| Constancias (opcional) | `datos/<RUC>/<AAAA>/<MM>/constancias/<N°>.html`: la **Constancia de Depósito oficial** de SUNAT (~5 KB c/u). Se baja como una persona: clic en el número de constancia y botón "Guardar". Solo se bajan las que faltan. Se activa/desactiva en la hoja (Config → *Descargar constancias de SUNAT* SI/NO) o en el workflow (casilla *constancias*) |
| Hoja | `apps_script/` → pestañas **Panel**, **Detracciones** (detalle), **Por proveedor**, **Por mes**, **Config** |
| Subir la hoja | workflow `deploy-detracciones.yml` (solo con cambios en `apps_script/`) |
| Explorador (para ubicar pantallas nuevas) | `scripts/explorar.py` + workflow `detracciones-explorar.yml` (modos `menu`, `opcion`, `portal`, `plataforma`) |

Columna **rol** de cada depósito: `COMPRA` = la empresa es el adquiriente (pagó la
detracción), `VENTA` = la empresa es el proveedor (un cliente le depositó).

## Cómo se busca

Por **fecha de pago, mes por mes** (01/MM al último día; el mes en curso hasta hoy) y con el
*Periodo Tributario* vacío: así salen todos los depósitos pagados en ese mes aunque sean de
periodos anteriores (ej. pagos de hoy de un periodo de hace 4 meses). En cada mes se consultan
pagos individuales y masivos (cuenta convencional; IVAP opcional).

## Menú de la hoja (🏦 Detracciones)

- 🔄 Actualizar todo (lee lo ya descargado de GitHub y pasa las constancias a PDF en Drive:
  `PDF Detracciones/<RUC - Empresa>/<AAAA>/<NN_Mes>/`, con enlace "📄 Ver constancia" al final de cada fila).
- 📄 Solo ordenar constancias en Drive.
- Config: *Descargar constancias de SUNAT* y *Copiar constancias a Drive* (SI/NO cada una).
- ⬇ Pedir a SUNAT lo nuevo (últimos 3 meses) / elegir meses y empresa.
- ⏰ Actualización diaria (8 a. m.: pide la descarga, espera y actualiza).
- 🔑 Token de GitHub (el mismo de las otras hojas) y 🔌 Probar conexión.

Las claves SOL están en los Environments de GitHub (uno por RUC) y nunca se imprimen.
