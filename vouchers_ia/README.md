# Asistente IA de la hoja "Sistema de Vouchers"

Sugiere el **ID Beneficiario** (RUC) y la **factura** de los vouchers que no lo tienen (pestañas Originales y Fotos). Solo escribe en el voucher cuando marcas ✔, y solo en celdas vacías.

- `AsistenteIA.js` → pestaña y menú "🧠 Asistente IA".
- `IACliente.js` → conexión con la IA (Gemini, Groq, Qwen, ChatGPT, DeepSeek, OpenRouter). Es igual al de `cobranzas/`.

En la hoja quedan en la carpeta `asistente_ia/`, separados del bot (`src/`). Se suben con el workflow `asistente-vouchers.yml`, que descarga lo que hay en la hoja, agrega solo estos 2 archivos más 1 línea en `onOpen()`, y sube eso mismo.
