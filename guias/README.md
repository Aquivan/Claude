# 🚚 Guías de Remisión Remitente · Grupo

Hoja de Google **"Guías de Remisión · Grupo"** (código en `guias/apps_script/`, prefijo `GR_`): una sola hoja para todas
las empresas con **todo lo que pide SUNAT para la GRE Remitente** y el formulario de Quesito. Es la base para emitir
las guías en [Quesito](https://www.quesito.pe) con un robot (próxima etapa) y desde Telegram / WhatsApp.

## Pestañas

| Pestaña | Qué tiene |
|---|---|
| **🚚 Guías** | Una fila por guía, en grupos de colores: 🆔 Guía (ID, Estado, Empresa) · 🧾 Comprobante (cotización, factura/boleta, serie, número) · 👤 Destinatario · 🚚 Traslado (motivo cat. 20, modalidad cat. 18, fecha de inicio, ¿todo lo de la factura?, peso, unidad, bultos, vehículo M1/L) · 🏢 Transportista (público) · 🚗 Vehículo y conductor (privado) · 📍 Partida · 🏁 Llegada (ubigeo, dirección, cód. de local) · 📝 Observaciones y resumen de productos · ✅ Resultado (N° de guía, fecha, estado SUNAT, PDF, ticket, mensaje: lo llena el robot). Cada título tiene una nota con lo que va. |
| **📦 Productos** | Solo para guías **parciales** o **sin factura**: una fila por producto (ID guía, descripción como en la factura, unidad cat. 03, cantidad, lote). |
| **🏢 Empresas** | Empresa, RUC, razón social, correo de Quesito, serie de guía, partida (ubigeo, dirección, cód. de local), activa. Precargadas M&D y DSM (GRANIX inactiva). **La clave de Quesito no va en la hoja**: va como secreto en GitHub. |
| **🚛 Transportistas · 🚗 Vehículos · 👤 Conductores · 📍 Direcciones** | Lo que se repite: con el RUC del transportista se llenan su nombre y MTC; con el DNI del conductor, nombres, apellidos y licencia; con el RUC del cliente, su nombre y su dirección de llegada. |
| **🗺️ Ubigeos** | Catálogo 13 de SUNAT (UBIGEO INEI, 1 892 distritos). En las columnas de ubigeo se elige de la lista o se escribe el distrito ("santa anita") o el código. |
| **🧾 Registro · 📖 Ayuda** | Qué se hizo y cuándo · instrucciones. |

## Cómo funciona

- **ID** (`G-000001`) y **Estado** se ponen solos. `✏️ Borrador · falta: …` dice exactamente qué falta; `✅ Lista para emitir` cuando está completa (con "ojo:" si hay algo que revisar). `👁 Vista previa`, `⏳ Emitiendo`, `🚚 Emitida`, `⚠️ Error`, `🚫 Anulada` los pondrá el robot.
- **Columnas en gris** = no aplican (transporte público → sin vehículo ni conductor; privado → sin transportista; M1/L → sin placa ni conductor; cód. de local solo en el motivo 04; descripción solo en el motivo 13).
- **Reglas que revisa** (`GR_validar_`): RUC con dígito verificador (detecta RUC mal escritos, como `20447623673`), DNI de 8 dígitos, placa `ABC-123`, licencia, serie de 4 caracteres, con factura el destinatario va con RUC, fecha de inicio no anterior a hoy, peso > 0, partida y llegada con ubigeo válido y distintas, motivo 04 con códigos de local, motivo 13 con descripción, parcial o sin factura con productos.
- **Menú 🚚 Guías**: ➕ Nueva guía (formulario lateral con listas, búsqueda de distritos, autocompletado y productos) · ✏️ Editar · 📄 Duplicar (para varias guías de una misma factura) · 🔍 Revisar todas · 📦 Ver productos · 🧰 Preparar / reparar (nunca borra datos) · 📖 Ayuda.

## Despliegue

`deploy-guias.yml`: **crear-proyecto** (una vez) crea la hoja con su Apps Script y guarda `.clasp.json`; después cada push con cambios en `guias/apps_script/` sube el código. Al abrir la hoja por primera vez se arma sola (`onOpen`).

## Próximas etapas

1. Robot de Quesito (GitHub Actions + Playwright, como el de retenciones): con la cuenta de cada empresa (correo en 🏢 Empresas, clave como secreto `QUESITO_CLAVE` del Environment de su RUC), busca la factura, "Generar GUÍA DE REMISIÓN REMITENTE", deja solo los productos de 📦 si es parcial, llena traslado, transporte, partida, llegada y observaciones. **👁 Vista previa** se detiene antes de "Crear Guía de Remisión"; **✅ Emitir** solo con confirmación, y anota N° de guía, estado SUNAT y PDF.
2. Telegram y WhatsApp: "guía para la factura FQQ1-3525" → completa lo que falta preguntando → 👁 / ✅.
3. Importar el Excel actual y, después, facturas.

## 🧀 Emitir la guía en Quesito (robot)

Workflow **"GRE - Quesito (Remitente)"** (`gre-quesito.yml`, script `guias/scripts/quesito_gre.py`), pedido por el bot de
Telegram/WhatsApp con el mismo caso de la guía por SUNAT (`cobranzas/telegram/TG_GRE.js`): la persona escribe **«en quesito»**
(y «por sunat» para volver). Solo guías de **venta desde la factura** que la empresa emitió en Quesito.
- **👁 Vista previa**: busca la factura → «Generar GUIA DE REMISIÓN REMITENTE» → llena motivo, transporte, fechas, peso,
  bultos, transportista o vehículo y chofer, llegada (con su ubigeo) y, si es parcial, deja solo esos productos. Manda la foto
  al chat y **no crea nada**: además de no tocar «Crear», bloquea en la red todo envío de datos desde el formulario.
- **✅ Emitir**: solo con la huella del caso aprobado; devuelve el número (TQQ1-…) y el PDF.
- Si no está seguro (ubigeo de llegada, productos de una guía parcial, sesión vencida), se detiene y pregunta.
- Solo el vehículo y chofer principales por ahora.

## Explorar Quesito (solo mirar)

Workflow **"Guías - explorar Quesito (solo mirar)"** (`guias-quesito-explorar.yml`, script
`guias/scripts/quesito_explorar.py`): entra con la cuenta de una empresa, abre "Generar GUIA DE
REMISIÓN REMITENTE" desde una factura y anota todos los campos del formulario. No emite nada:
no presiona "Crear Guía", bloquea los envíos de datos y rechaza las confirmaciones. Necesita los
secretos `QUESITO_CORREO` y `QUESITO_CLAVE` en el Environment de la empresa (su RUC).

### Captcha de Quesito (lo resuelve la persona)

Al ingresar, Quesito muestra un reCAPTCHA de Google. El robot no lo resuelve: numera las casillas, deja
la foto en la rama temporal `quesito-captcha` y el bot de Cobranzas (`cobranzas/telegram/TG_Captcha.js`)
se la manda a los administradores de Telegram y a los números de WhatsApp. Se responde con los números
(`1 6 9`), `0` si ya no queda ninguna, `otra` para cambiar la imagen o `cancelar`. El robot marca las
casillas, pulsa Verificar y, si Google pide otra ronda, vuelve a preguntar. Solo se atiende a una
ejecución de `guias-quesito-*.yml` que esté corriendo (lo comprueba el bot con su token de GitHub).

### Sesión guardada (sin captcha) — `QUESITO_SESION`

Desde GitHub, Google no deja pasar el captcha. Por eso el robot entra con la sesión que la persona abre en su Chrome:
1. En Chrome (PC) instalar la extensión **Cookie-Editor** (de cookie-editor.com).
2. Entrar a Quesito de la empresa como siempre. Con la sesión abierta, pulsar el ícono de Cookie-Editor →
   **Export** → **JSON** (queda copiado).
3. GitHub → Settings → Environments → `<RUC>` → **Add secret**: nombre `QUESITO_SESION`, valor: pegar.
4. No pulsar "Cerrar sesión" en Quesito (eso la anula); basta cerrar la pestaña.

El robot muestra en el registro cuándo vence cada cookie (no sus valores). Si la sesión ya no sirve, avisa por
Telegram/WhatsApp y hay que repetir los pasos 2 y 3.
