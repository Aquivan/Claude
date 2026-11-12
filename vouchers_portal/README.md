# 🌐 Portal web de Vouchers

La hoja **«Sistema de Vouchers»** desde el **celular o la PC**, con un enlace, **usuario y PIN** (no hace falta cuenta de Google).
Es como el portal de Guías, pero para vouchers.

## Qué se puede hacer

| Pestaña | Qué hace | Permiso |
|---|---|---|
| 🔎 **Buscar** | Busca en Originales y Fotos (n° de operación, proveedor, RUC, monto, empresa…) y filtra por pestaña, moneda, fechas, banco, empresa, montos y marcas: *Sin RUC, Sin revisar, Duplicados, Por retener, Sin empresa*. Muestra cuántos hay y la suma en S/ y US$. | ver |
| 👁 **Ver un voucher** | La **imagen de la hoja** o el **archivo original** (PDF en la página exacta de la fila, o la foto), con zoom, ◀ ▶ y ⬇ descargar. Si hay varios archivos con el mismo nombre, se puede ver cada versión. | ver |
| ✏️ **Corregir** | Cambia los datos de la fila. Antes de guardar muestra qué cambia; comprueba que la fila siga siendo el mismo voucher; deja una nota en la columna B con quién y qué cambió. No toca la imagen (J), el archivo (K), la fecha de proceso (L) ni fórmulas. | editar |
| ↩️ **Deshacer mi última corrección** | Vuelve lo de antes de su último 💾 Guardar (en cualquier voucher), solo si la fila sigue siendo el mismo voucher y nadie cambió esas celdas después; deja nota y registro. | editar |
| 🗑 **Quitar** | Un voucher subido por error mientras sigue en la entrada (📥 Pendientes o recién subido): va a la papelera de Drive (30 días). Quien solo sube, quita lo suyo. | subir |
| 🔁 **Releer con IA** / ↩️ **Deshacer** | La IA de la hoja vuelve a leer la página y muestra ANTES / AHORA para elegir (igual que el visor de la hoja). | editar |
| 📤 **Subir** | Cada foto de la cámara pasa por **✂️ Recortar**: el portal **encuentra solo los bordes** del voucher (4 esquinas que se mueven con el dedo), lo **endereza** (corrige la perspectiva si la foto salió en ángulo) y con **✨ Mejorar** deja el papel blanco y el texto oscuro; ⟳ girar, 🎯 auto, ⬜ toda la foto. Las fotos de la galería y las páginas del escáner tienen su botón ✂️. El **nombre sugerido sale en gris**: se escribe encima, sin borrar (vacío = el gris; la extensión se agrega sola). 📷 **Tomar foto** con la cámara, 📄 **Escanear a PDF** (varias fotos con la cámara → un solo PDF, una página por foto; se pueden girar, ordenar o quitar) o elegir fotos/PDF. Nombre (no se repite uno que ya existe) y destino Original / Foto. Con ⚡ la hoja los procesa en ~1 minuto. | subir |
| 📥 **Pendientes** | Lo que espera en las carpetas de entrada y lo último descartado. | ver |
| 📊 **Resumen** | Totales, sin RUC, sin revisar, duplicados, por retener, por mes y por banco (tocando un cuadro se filtra). | ver |
| 👥 **Usuarios** | Crear usuarios, cambiar PIN y permiso, desactivar; enlace del portal y registro de quién hizo qué. | admin |

Permisos: **ver** < **subir** < **editar** < **admin** (cada uno incluye a los anteriores).

## Cómo funciona (y por qué es seguro)

- Es un **proyecto de Apps Script aparte** (`vouchers_portal/apps_script/`, prefijo `PV_`) con su propia aplicación web
  («ejecutar como: dueño», «acceso: cualquiera»). Lee y escribe la hoja de Vouchers **por su ID** y sus carpetas de Drive.
- **Solo 3 funciones públicas**: `doGet` (la página), `PV_entrar` (usuario + PIN → sesión de 10 h) y `PV_api` (revisa la
  sesión y el permiso en **cada** acción). Todo lo demás termina en `_`, así que desde la página no se puede llamar nada más.
  *No se hizo dentro del proyecto de la hoja de Vouchers a propósito*: ese proyecto tiene funciones públicas sin permiso
  (p. ej. la que entrega el «pase» de Drive del visor) que cualquiera podría llamar si su aplicación web sirviera una página.
- Los archivos (imagen de la celda, original) los **baja el servidor** y los manda a la página; el navegador nunca recibe
  permisos de Drive. Solo se abren archivos de las 5 carpetas del sistema.
- **PIN** cifrado (SHA-256 con sal propia del proyecto). 5 intentos fallidos bloquean 15 minutos. Desmarcar «Activo» corta
  el acceso al instante (aunque la persona tenga la página abierta).
- **🌐 Registro portal** (pestaña de la hoja): entradas, subidas, correcciones (antes → después), relecturas, usuarios.

### Puente con la hoja de Vouchers

Lo que necesita la IA y los procesos de la hoja (🔁 releer, ↩️ deshacer, ⚡ procesar) se pide a la aplicación web de la hoja:
`doGet` de su `Diagnostico.js` con `?portal=1&k=CLAVE&op=…` → `PV_Puente.js` (en `vouchers_bot_cambios/src/`). Responde **solo
JSON**. La CLAVE la genera el portal y la guarda en los **metadatos de la hoja** (no se ven en la hoja ni van al repositorio);
el puente la lee de ahí. La dirección de la hoja la pone el workflow al publicar (no queda en el repositorio).

## Puesta en marcha

1. **Actions → «Desplegar Portal de Vouchers» → crear-proyecto** (una vez): crea el proyecto, sube el código y publica.
2. **Actions → «Cambios en hoja Vouchers» → revisar** y luego **subir**: agrega el puente a la hoja (solo si su código es el del respaldo).
3. Dar permisos (una vez, el dueño): abrir el proyecto del portal (el enlace sale en el aviso del paso 1), elegir **doGet** y **▶ Ejecutar** → permitir.
4. Primer administrador: en la hoja de Vouchers, pestaña **👥 Portal** (se crea sola la primera vez que alguien abre el
   portal; si no está, ábralo una vez): **A2** su usuario, **B2** su nombre, **C2** un PIN de 4 a 8 números, **D2** `admin`,
   **E2** ✔. El portal cifra el PIN solo.
5. Entrar al portal; en **👥 Usuarios** está el enlace para compartir y se crean los demás usuarios.

En el celular: Chrome → menú ⋮ → **Agregar a la pantalla principal** (iPhone: Safari → Compartir → Agregar a inicio).

## Despliegue

`deploy-vouchers-portal.yml`: con cada push a `vouchers_portal/apps_script/` sube el código y vuelve a publicar la **misma**
dirección (escribe `PV_Despliegue.js` con las direcciones del portal y de la hoja de Vouchers).
