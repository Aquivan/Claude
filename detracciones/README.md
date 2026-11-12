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
| Descarga multiempresa | workflow `detracciones-descargar.yml`: una vez al día, **de lunes a viernes** (el bot la pide a las 3 a. m. y la hoja a las 8 a. m. si aún no corrió; sábado y domingo no corre sola), últimos 3 meses; a mano desde la hoja o el bot: empresa(s), desde/hasta (AAAAMM). **Solo la pide la hoja** (o el bot a través de la hoja): la hoja pone la dirección de su aplicación web y una llave de un solo uso (6 h) |
| Datos | **Ya no van al repositorio** (es público). El robot los manda directo a la hoja (`apps_script/Web.js`): cada mes de cada empresa se guarda en la pestaña oculta **_Datos**. El registro de GitHub solo dice cuántos depósitos hubo por mes (sin montos, proveedores ni números de constancia). Lo que había en `datos/` hasta el 12/11/2026 se pasó a la hoja una sola vez desde esa versión del repositorio (`DET_REF_LEGADO_`); la carpeta se quitó, pero sigue en el historial de git |
| Constancias (opcional) | La **Constancia de Depósito oficial** de SUNAT (HTML ~5 KB): el robot la manda a la hoja y la hoja la guarda como PDF en Drive. Solo se bajan las que la hoja aún no tiene. Config → *Descargar constancias de SUNAT* SI/NO |
| 🛡 SUNAT respondió vacío | Si un mes llega vacío y la hoja ya tenía depósitos de ese mes, el robot vuelve a consultar; si sigue vacío **no se borra nada** (y la hoja tampoco acepta un mes vacío encima de uno con datos). La empresa queda «con error» |
| 🔁 Reintento | Después de la descarga diaria, las empresas con error (SUNAT lenta, sin respuesta, o mes vacío) se vuelven a pedir **en 1 hora, solo ellas**, hasta 2 veces por día. 🔌 Probar conexión muestra las que fallaron |
| Hoja | `apps_script/` → pestañas **Panel**, **Detracciones** (detalle), **Por proveedor**, **Por mes**, **Config** |
| Subir la hoja | workflow `deploy-detracciones.yml` (solo con cambios en `apps_script/`) |
| Explorador (para ubicar pantallas nuevas) | `scripts/explorar.py` + workflow `detracciones-explorar.yml` (modos `menu`, `opcion`, `portal`, `plataforma`) |

**Se usa también en Cuentas por Cobrar y Pagar** (`cobranzas/DetraccionesSunat.js`, ⚙️ Config fila 15):
cada depósito se descuenta solo de su factura (columna *Ref. documento*, ej. `01_F002-6757`, y *RUC adquiriente*)
y la IA de Cobranzas puede consultarlos (herramienta `detracciones`).

Columna **rol** de cada depósito: `COMPRA` = la empresa es el adquiriente (pagó la
detracción), `VENTA` = la empresa es el proveedor (un cliente le depositó).

## Cómo se busca

Por **fecha de pago, mes por mes** (01/MM al último día; el mes en curso hasta hoy) y con el
*Periodo Tributario* vacío: así salen todos los depósitos pagados en ese mes aunque sean de
periodos anteriores (ej. pagos de hoy de un periodo de hace 4 meses). En cada mes se consultan
pagos individuales y masivos (cuenta convencional; IVAP opcional).

## Menú de la hoja (🏦 Detracciones)

- 🔄 Actualizar todo (rehace las pestañas con lo que llegó del robot y pasa a PDF las constancias que faltaban en Drive:
  `PDF Detracciones/<RUC - Empresa>/<AAAA>/<NN_Mes>/`, con enlace "📄 Ver constancia" al final de cada fila).
- 📄 Solo ordenar constancias en Drive.
- Config: *Descargar constancias de SUNAT* y *Copiar constancias a Drive* (SI/NO cada una).
- ⬇ Pedir a SUNAT lo nuevo (últimos 3 meses) / elegir meses y empresa.
- ⏰ Actualización diaria (8 a. m.: de lunes a viernes pide la descarga si aún no corrió, espera y actualiza; sábado y domingo solo actualiza la hoja).
- 🔑 Token de GitHub (el mismo de las otras hojas) y 🔌 Probar conexión.

Las claves SOL están en los Environments de GitHub (uno por RUC) o en el secreto `SUNAT_CLAVES`, y nunca se imprimen.
La dirección de la aplicación web y la llave se tapan en el registro antes de usarse.
