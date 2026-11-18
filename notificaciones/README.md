# Notificaciones · Grupo

Lista de **notificaciones y mensajes del Buzón Electrónico de SUNAT SOL** de todas
las empresas activas de `empresas.json` (las mismas de SIRE), con el **PDF** de cada
notificación (opcional), en una hoja de Google Sheets.

## Cómo funciona

1. **GitHub Actions** (`.github/workflows/notificaciones-descargar.yml`) entra al
   Buzón de cada empresa (claves SOL en su Environment = RUC) y usa las mismas
   direcciones que la página del buzón (`ol-ti-itvisornoti/visor`):
   - `listNotiMenPag`: lista completa de **notificaciones** (tipo 2) y **mensajes**
     (tipo 1): fecha de publicación, asunto, etiqueta, leído, adjuntos.
   - **Opcional** (`pdf`, por defecto sí para notificaciones): abre cada notificación
     **nueva** con adjunto (`obtenerDetalleNotiMen`) y baja sus PDF (`bajarArchivo`).
     ⚠️ Abrirla la marca como *leída* en SOL, igual que si una persona la abre; la
     notificación surte efecto desde su depósito (día hábil siguiente), se lea o no.
     La lista sola no marca nada.

   **Ya no guarda nada en el repositorio (es público).** Lo bajado va directo a la hoja
   (su aplicación web, `Web.js`) con una **llave de un solo uso** (6 h) que la hoja crea al pedir
   la descarga: `estado` (lo que la hoja ya tiene, para bajar solo lo nuevo), `archivo` (cada
   documento, que la hoja guarda directo en Drive), `lista` (notificaciones y mensajes de la
   empresa; si SUNAT responde vacío se conserva lo que había) y `fin` (en 3 min se rehacen las
   pestañas). Los datos quedan en la pestaña oculta `_Datos`. Lo descargado antes del cambio se
   migra una sola vez desde la última versión del repositorio que lo tenía (`NOT_REF_LEGADO_`).
   La pide la hoja (8 a. m. y 5 p. m., últimos 3 meses) o el bot de Cobranzas a través de la hoja
   (`TG_notPedir_`, metadatos `NOT_WEB` / `NOT_PUENTE`); ya no hay corrida programada de GitHub.
   A mano: **desde qué mes o fecha** (AAAAMM o dd/mm/aaaa, vacío = todo), empresa (o todas),
   PDF sí/no, adjuntos de mensajes sí/no.
   Cada notificación queda clasificada: Orden de Pago, Resolución de Ejecución
   Coactiva, Resolución de Conclusión, Carta, Requerimiento, Esquela, etc., con su N°.
2. **La hoja "Notificaciones · Grupo"** (`notificaciones/apps_script/`, menú 📬 Notificaciones):
   - **Panel**: por empresa (total, últimos N días, últimos 30 días, no leídas,
     coactiva/embargo, última notificación, mensajes), por tipo de documento y las
     15 últimas del grupo.
   - **Notificaciones**: una fila por notificación con fecha, *surte efecto* (día
     hábil siguiente, sin feriados), tipo, N°, asunto, etiqueta, leída y enlaces a
     los PDF en Drive. Amarillo = recientes, rojo = coactiva/embargo, azul = no leída.
   - **Mensajes**: avisos y reportes del buzón.
   - PDF en Drive: `PDF Notificaciones/<RUC - Empresa>/<AAAA>/<NN_Mes>/`.
   - ⚙️ Config: desde qué mes mostrar, **Descargar PDF de SUNAT (SI/NO)**,
     **Copiar PDF a Drive (SI/NO)**, días para "nueva".

El token de GitHub va solo en Propiedades del script (menú 🔑). Nunca se imprimen
claves SOL ni tokens. No toca otros proyectos. No existe un proyecto público que
haga esto: las direcciones se obtuvieron observando la página oficial del buzón.

## Archivos

- `scripts/descargar_buzon.py` — descargador (reusa el inicio de sesión SOL de `retenciones/scripts/descargar_cre.py`).
- `scripts/sondeo.py` — sondeo de solo lectura (lista, no abre mensajes).
- `apps_script/` — Config.js, GitHub.js, Hojas.js, Drive.js.
- Despliegue: `.github/workflows/deploy-notificaciones.yml` (clasp).
- Hoja: https://docs.google.com/spreadsheets/d/1gV56deyMd-11O_fpB7cBVKKoUu0nF9lyvHMGlIKbNOs (carpeta Drive "Notificaciones · Grupo").

## Descarga diaria puntual (y respaldo)

El disparador diario de la hoja (`NOT_actualizacionAutomatica`, `Diario.js`) **pide**
la descarga a GitHub a su hora (workflow_dispatch con la llave), revisa cada 8 minutos y
rehace las pestañas cuando termina (además, el robot avisa con `fin`). Las corridas
diarias se llaman igual ("Notificaciones · diario"), van en fila (`concurrency`) y si una
ya corrió, la otra no descarga nada.


## Qué se baja de cada notificación (16/10/2026)

Solo el **📄 documento**: la Carta, Orden de Pago, Resolución de Ejecución Coactiva, Esquela…,
es decir el enlace *Documento* del texto del mensaje. SUNAT no lo pone en la lista de adjuntos:
viene en los datos del cuerpo con su propio código de archivo (`id_archivo`). Se guarda como
`<código>-documento_<N°>.pdf`. La **constancia de depósito** (el adjunto de la lista) **no** se
guarda; las que se habían bajado antes se borraron (columna `revision` = 3).

Cada documento se pide con el **sistema** que indica su notificación y, si no llega, con la
descarga por POST del portal. Si un mensaje no trae enlace *Documento*, la fila lo dice.

Las corridas diarias que se saltan (porque otra acaba de descargar) ya no cuentan como
"descarga hecha": antes se saltaban en cadena y la descarga de la tarde no corría.
