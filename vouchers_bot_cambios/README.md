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

Después del próximo respaldo semanal, `vouchers_bot_respaldo/` ya trae estos cambios.
