# GRE por SUNAT (Guía de Remisión Electrónica Remitente en SUNAT SOL)

Proyecto aparte para emitir guías de remisión remitente en el portal de SUNAT (SEE-SOL), por **venta** o
**compra**, con los datos que la persona manda por Telegram o WhatsApp (fotos de la factura, del ticket de
balanza, de la tarjeta del transportista, o texto). Mismo esquema seguro que los CRE de `retenciones/emision/`:
la IA arma una propuesta, la persona la revisa, el robot hace una **vista previa** y solo **emite** cuando la
persona aprueba ESA guía.

Etapa 1 (ahora): `scripts/sondeo_gre.py` + workflow `gre-sunat-sondeo.yml` — sondeo de SOLO LECTURA del
formulario de SUNAT (menú, secciones, campos, listas y botones), sin llenar ni enviar nada.
