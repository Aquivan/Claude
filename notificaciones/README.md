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

   Guarda en `notificaciones/datos/<RUC>/notificaciones.csv`, `mensajes.csv` y
   `<AAAA>/<MM>/*.pdf`. Corre solo dos veces al día (~7:07 a. m. y ~4:07 p. m. de
   Lima, últimos 3 meses) y a mano: **desde qué mes o fecha** (AAAAMM o dd/mm/aaaa, vacío = todo),
   empresa (o todas), PDF sí/no, adjuntos de mensajes sí/no.
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

El programador de GitHub (cron) se atrasa horas y a veces se salta días. Por eso
el disparador diario de la hoja (`*_actualizacionAutomatica`, `Diario.js`) es el
que **pide** la descarga a GitHub a su hora (workflow_dispatch, arranca en
segundos), revisa cada 8 minutos y **importa cuando termina**. El cron del
workflow queda como **respaldo**: las corridas diarias se llaman igual
("… · diario"), van en fila (`concurrency`) y si una ya corrió, la otra no
descarga nada.


## Adjuntos que SUNAT entrega vacíos (verificado 15/10/2026)

Algunas *Resolución de Conclusión* (7 de GRANIX y 1 de JENILE) tienen su `constancia.pdf`
en el buzón, pero SUNAT la entrega con **0 bytes** (se probó con los dos tipos de anexo y
reintentos). No es un error de la descarga: el archivo viene vacío desde SUNAT. Esas filas
quedan con la columna `nota_pdf` y en la hoja dicen **⚠️ SUNAT lo entrega vacío**; se
reintentan cada día por si SUNAT lo corrige. Los demás 200 PDF tienen contenido (revisado).

Las corridas diarias que se saltan (porque otra acaba de descargar) ya no cuentan como
"descarga hecha": antes se saltaban en cadena y la descarga de la tarde no corría.
