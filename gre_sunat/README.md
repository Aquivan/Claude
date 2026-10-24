# GRE por SUNAT (Guía de Remisión Electrónica Remitente en SUNAT SOL)

Proyecto aparte para emitir guías de remisión remitente en el portal de SUNAT (SOL → Guía de Remisión
Electrónica → Emisión de GRE), por **compra** o **venta**, con los datos que la persona manda por **Telegram o
WhatsApp**: fotos/PDF de la factura, del ticket de despacho o balanza, de la tarjeta del transportista, o texto.

## Cómo se usa

1. Mande al bot las fotos con el texto **guía** (o toque 🚚 *Guía de remisión* en el menú del archivo). Puede
   agregar lo que sepa: `peso 30258.5`, `solo líneas 1 a 5`, `la mitad`, `registrar vehículo`, `fecha 25/10/2026`.
2. La IA lee todo y propone la guía:
   - **motivo**: *Compra* si la factura es para una empresa del grupo; *Venta* si la emite una empresa del grupo;
   - **bienes**: las líneas de la factura (todas o las que diga);
   - **peso**: el suyo; si no, el del ticket; si no, la suma de pesos por línea;
   - **partida / llegada**, **transportista** (RUC y MTC) y, si se piden, **placas y chofer**.
3. ✏️ *Corregir* (escriba el cambio en sus palabras) · 👁 *Vista previa* (el robot llena la guía en SUNAT, se
   detiene antes de *Emitir* y le manda la foto) · ✅ *Emitir* (pide confirmar; solo administradores en Telegram,
   o números autorizados con `/emitirwa` en WhatsApp).

## Piezas

| Pieza | Qué hace |
|---|---|
| `cobranzas/telegram/TG_GRE.js` | Bot: lectura con IA, propuesta, correcciones, registro en la pestaña **🚚 Guías SUNAT** |
| `.github/workflows/gre-sunat.yml` | Corre el robot (`modo` vista o emitir) con las claves SOL del Environment de la empresa |
| `scripts/gre_robot.py` | Llena las pantallas 1–6 de *Emisión de GRE* y para en la de *Emitir* |
| `scripts/sondeo_gre.py` + `gre-sunat-sondeo.yml` | Sondeo de solo lectura del formulario (para mantenimiento) |

## Seguridad

- El repositorio es público: a GitHub solo va **el código del caso**. El robot pide los datos al bot con el número
  de su corrida, y el bot solo responde a una corrida de `gre-sunat.yml` en curso. Las fotos de la vista previa
  van directo al chat (no a GitHub). Los registros de la corrida no muestran nombres ni números.
- Para **emitir**, la corrida trae la *huella* del caso (sha256 del texto exacto, 10 caracteres) que el bot calcula
  cuando la persona aprueba. Si el caso cambió después, el robot no emite.
- Nunca se guardan teléfonos.

## Pantallas de SUNAT (sondeo del 24/10/2026)

1. **Datos de emisión**: Remitente · ¿comercio exterior? (Sí/No) · motivo (Venta, Compra, Venta con entrega a
   terceros, Traslado entre establecimientos, Consignación, Devolución, …).
2. **Actores**: destinatario/proveedor (frecuentes o *Agregar* con RUC).
3. **Documentos relacionados**: Factura, Boleta, Liquidación de compra, Constancia de detracción, … (opcional).
4. **Bienes a transportar**: descripción, unidad (PK, NIU, KGM, …), cantidad · peso bruto total (KILOGRAMO/TONELADAS).
5. **Punto de partida y llegada**: establecimiento del remitente, de un tercero por RUC, u otra dirección.
6. **Datos de transporte**: público (RUC del transportista, registro MTC, fecha de entrega; opcional registrar
   vehículos y conductores) o privado (placas, conductores con DNI y licencia, fecha de inicio).
7. Última pantalla con **Emitir** (se conoce en la primera vista previa).
