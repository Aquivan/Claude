# 📲 Vouchers por WhatsApp

Reenvíe (uno o varios a la vez) las fotos y PDF de vouchers que le llegan por WhatsApp
al número del bot. Se guardan en las carpetas de **Entrada** del sistema de Vouchers
(fotos → *Fotos*, PDF → *Originales*), el sistema los procesa como siempre (cada 10 min)
y el bot le responde **un** mensaje por tanda y **otro** con el resultado
(banco · monto · operación · proveedor, o si fue duplicado / ilegible).

Todo es gratis: número de prueba de Meta, puente en Cloudflare (plan gratuito) y Apps Script.
Es un proyecto **aparte** del bot de Telegram: no cambia el código de la hoja de Vouchers.

```
WhatsApp ──► Meta ──► Cloudflare Worker ──► Apps Script "Vouchers WhatsApp" ──► Drive (Entrada)
                     (firma + 200 al instante)   (baja el archivo, anota)          │
             ◄──────────── acuse / resultado ◄── lee la hoja de Vouchers ◄─────────┘ (cada 10 min)
```

## Partes

| Carpeta | Qué es |
|---|---|
| `worker/worker.js` | Puente en Cloudflare: verifica a Meta, comprueba la firma, contesta 200 y reenvía solo los mensajes. |
| `apps_script/` | Hoja "Vouchers WhatsApp" (pestaña **Recibidos**) + aplicación web `doPost`. Menú **📲 WhatsApp**. |
| `.github/workflows/deploy-vouchers-whatsapp.yml` | Crea la hoja (una vez), sube el código y publica la aplicación web. |

## Puesta en marcha (una sola vez)

1. **Meta** (developers.facebook.com → su app → WhatsApp → Configuración de la API):
   anote el *Identificador del número de teléfono* y el de la *cuenta de WhatsApp Business*;
   su número debe estar en **Para** (destinatarios). En *Configuración de la app → Básica*
   está la **Clave secreta de la app** (APP_SECRET).
2. **Token permanente**: business.facebook.com → Configuración → Usuarios del sistema →
   Agregar (Administrador) → Asignar activos (la app, control total) → Generar token
   (permisos `whatsapp_business_messaging` y `whatsapp_business_management`, caducidad *Nunca*).
3. **Hoja** ([Vouchers WhatsApp](https://docs.google.com/spreadsheets/d/1QtUYgJeZ_nHpnCNiyTXTEfA3FL99gIR-dfMDaohLKEc/edit)):
   menú **📲 WhatsApp → 1. Configurar** (Google pide permisos la primera vez: *Revisar permisos → Permitir*).
   Solo hay que pegar el **token permanente**: el ID del número (1219097671294680), el de la cuenta
   (1414043013929024) y el número autorizado (51XXXXXXXXX) ya vienen puestos; pulse Aceptar en blanco para dejarlos.
4. **Cloudflare** (dash.cloudflare.com → Workers & Pages → Create → Worker "vouchers-wa"):
   *Edit code* → pegue `worker/worker.js` → *Deploy*. En *Settings → Variables and Secrets*
   agregue `GAS_URL`, `GAS_TOKEN`, `VERIFY_TOKEN` (salen en **📲 WhatsApp → 2. Datos**) y `APP_SECRET`.
   Abrir la dirección del Worker debe decir "Puente WhatsApp listo ✅".
5. **Webhook en Meta** (WhatsApp → Configuración → Webhook → Editar): URL = la del Worker,
   token de verificación = `VERIFY_TOKEN` → *Verificar y guardar* → en *Campos del webhook*
   suscriba **messages**.
6. **Probar**: menú **3. Probar envío** (le llega "Hello World"), respóndale "hola" y
   reenvíe un voucher. Si no llega nada: menú *Conectar app a la cuenta*.

## Uso en WhatsApp

- Reenvíe fotos o PDF (puede marcar varios). "original" / "foto" en el comentario cambia la pestaña solo esa vez.
- `modo original`, `modo foto`, `modo auto` · `estado` · `hola` (ayuda) · cualquier otra cosa → 🧠 IA.
- Solo los números de **Números autorizados** pueden mandar vouchers.

## 🧠 Preguntas libres (la misma IA del asistente de Telegram)

Todo texto que no sea un comando se le pregunta a la IA de Cobranzas (`cobranzas/telegram/TG_WhatsApp.js`,
entrada `doPost?canal=wa` de la misma aplicación web del bot de Telegram): vouchers, facturas, cartera,
Buzón SUNAT, retenciones, honorarios, detracciones, IGV, tipo de cambio… Devuelve texto, tablas cortas,
**fotos de vouchers**, archivos y Excel, y el bot de WhatsApp los manda. Una foto/PDF con una pregunta en el
comentario ("¿ya está registrado?" o "ia …") se analiza con la IA en vez de registrarse.

- La clave entre las dos apps se crea y registra sola la primera vez (`WA_IA_CLAVE` aquí, `TGW_SECRETO` en Cobranzas).
- Si la IA tarda más de 60 s, la respuesta se recoge en el minuto siguiente (`WA_cadaMinuto`).
- Recordatorios, descargas de SUNAT y cambios en la hoja se confirman en Telegram.

## Límites honestos

- El número de prueba de Meta solo habla con hasta 5 números que usted autorice en Meta.
- 1.000 respuestas gratis al mes por número (el bot manda ~2 por tanda).
- Máximo 45 MB por archivo. El enlace de Meta para bajar el archivo dura 5 min (se baja al instante).
- Si el sistema de Vouchers no procesa un archivo en 45 min, el bot lo avisa como "Revisar".
