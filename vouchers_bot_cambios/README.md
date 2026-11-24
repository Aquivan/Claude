# Cambios para la hoja "Sistema de Vouchers"

Archivos que **reemplazan** a los de la hoja, aplicados a mano con Actions → **"Cambios en hoja Vouchers"**
(`revisar` muestra las diferencias, `subir` los sube). Solo se reemplaza un archivo si el que está en la
hoja es idéntico al de `vouchers_bot_respaldo/src/` (si alguien lo cambió a mano, no se toca nada), y
antes se guarda una copia del código de la hoja como artefacto de la corrida (90 días).

| Archivo | Cambio |
|---|---|
| `src/VoucherProcessor.js` | Si otra ejecución está ocupada, reintenta en 1 minuto en vez de esperar la vuelta de 10 min. |
| `src/PV_Puente.js` (nuevo) + `src/Diagnostico.js` | 🌐 Puente con el **Portal web de Vouchers** (`vouchers_portal/`): `doGet` con `?portal=1` responde SOLO JSON a 🔁 releer con IA, ↩️ deshacer y ⚡ procesar, con una clave que el portal deja en los metadatos de la hoja. |
| `src/AyudaVouchers.js` | ❓ Ayuda: cómo entran los vouchers por el 🌐 portal web. |
| `src/Gemini.js` | Si el modelo principal está saturado (429/5xx) o no existe (404), pasa al momento al siguiente: 3.6 Flash → 3.8 Flash → 3.5 Flash‑Lite (cambiable con la propiedad del script `MODELOS_GEMINI`). Solo si todos están ocupados espera 15 s y 30 s. |
| `src/Lectores.js` (nuevo) + `src/Gemini.js` + `src/SheetWriter.js` + `src/PV_Puente.js` + `src/PdfProcessor.js` | 🧾 **Respaldo automático entre IAs**: si Gemini falla, lee NVIDIA y luego Groq (orden, modelos y claves se eligen por Telegram con «lectores» en Cobranzas; esta hoja los pide por el 🧠 asistente y los guarda 10 min). PDF: cada página se convierte en imagen para NVIDIA/Groq; si falla un lote de varias páginas, `src/PdfProcessor.js` lo pide página por página. Nota en el N° de operación cuando no lo leyó Gemini. |
| `src/SheetWriter.js` + `src/VoucherProcessor.js` + `src/Gemini.js` + `src/Diagnostico.js` | ⚡ **Más rápido**: la fila se escribe de una sola vez (celda por celda solo si falla); si otra ejecución está trabajando se espera hasta 30 s en vez de reprogramar 1 min; «procesar al instante» devuelve ⏱ tiempos (leer con IA, guardar, resto) para mostrarlos en Telegram y WhatsApp. |
| `src/Registro.js` (nuevo) + `src/VoucherProcessor.js` | 🩺 **Registro técnico**: cada procesamiento anota «inicio» y «fin» (procesados, tiempos, quién leyó y el detalle del registro) en la hoja «🩺 Registro técnico (sistema)», que se crea sola en Drive. Un «inicio» sin «fin» = Google cortó la ejecución. La app de WhatsApp anota ahí sus «procesar al instante». |

Después del próximo respaldo semanal, `vouchers_bot_respaldo/` ya trae estos cambios.
