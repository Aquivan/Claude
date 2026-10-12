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
