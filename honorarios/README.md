# Honorarios · Grupo

Recibos por Honorarios Electrónicos **RECIBIDOS** (lo que personas independientes
emitieron a las empresas del grupo), bajados directamente de SUNAT SOL, para todas
las empresas activas de `empresas.json` (las mismas de SIRE).

## Cómo funciona

1. **GitHub Actions** (`.github/workflows/honorarios-descargar.yml`) entra a SOL de
   cada empresa (claves en su Environment = RUC) y usa la opción de SUNAT
   *11.5.1.1.14 "Consulta de RHE recibidos"* (solo lectura), mes por mes:
   - el listado completo del mes (fecha, recibo, estado, emisor, descripción,
     renta bruta, retención de 4ta, neto, pendiente de pago), y
   - **opcional**: el PDF y el XML oficial de cada recibo.

   Guarda en `honorarios/datos/<RUC>/<AAAA>/<MM>/rhe.csv`, `pdf/` y `xml/`.
   Corre solo todos los días (~6:22 a. m. de Lima, mes anterior y actual, con PDF)
   y a mano con: empresa (o todas), mes inicial y final, **PDF sí/no**, guardar.
2. **La hoja "Honorarios · Grupo"** (`honorarios/apps_script/`, menú 🧑‍💼 Honorarios)
   lee esos archivos y arma:
   - **Panel**: por empresa (recibos, renta bruta, retención de 4ta, neto,
     pendiente, revertidos, alertas, PDF) y por mes (renta bruta y retención
     de 4ta para PLAME / 0621).
   - **Recibos**: un renglón por recibo, con enlace al PDF en Drive; revertidos en
     rojo y en naranja los mayores a S/ 1,500 sin retención (¿suspensión de 4ta?).
   - **Por emisor**: cuánto se pagó a cada persona por empresa.
   - Copia los PDF a Drive: `PDF Honorarios/<RUC - Empresa>/<AAAA>/<NN_Mes>/E001-28 - NOMBRE.pdf`.
   - ⚙️ Config: desde qué mes, **Descargar PDF de SUNAT (SI/NO)**, **Copiar PDF a Drive (SI/NO)**.
   - Menú: ⬇ Pedir a SUNAT lo nuevo, o ⬇ un rango de meses / una empresa **con o sin PDF**.

El token de GitHub va solo en Propiedades del script (menú 🔑), nunca en celdas.
Nunca se imprimen claves SOL ni tokens. No toca otros proyectos.

## Archivos

- `scripts/descargar_rhe.py` — descargador (reusa el inicio de sesión SOL de `retenciones/scripts/descargar_cre.py`).
- `apps_script/` — Config.js (menú y parámetros), GitHub.js (lectura del repo y pedidos de descarga), Hojas.js (pestañas), Drive.js (PDF a Drive).
- Despliegue: `.github/workflows/deploy-honorarios.yml` (clasp, igual que Retenciones).
- Hoja: https://docs.google.com/spreadsheets/d/1-dJiKLIFfcVt5htxp7sewCMfy1ne9WUzD1PWKYuc_wk (carpeta Drive "Honorarios · Grupo").

## Descarga diaria puntual (y respaldo)

El programador de GitHub (cron) se atrasa horas y a veces se salta días. Por eso
el disparador diario de la hoja (`*_actualizacionAutomatica`, `Diario.js`) es el
que **pide** la descarga a GitHub a su hora (workflow_dispatch, arranca en
segundos), revisa cada 8 minutos y **importa cuando termina**. El cron del
workflow queda como **respaldo**: las corridas diarias se llaman igual
("… · diario"), van en fila (`concurrency`) y si una ya corrió, la otra no
descarga nada.


## 🤝 Conciliar con Vouchers (pagos, por pagar y retención por mes de pago)

Menú 🧑‍💼 Honorarios → 🤝 Conciliar con Vouchers (`apps_script/Conciliar.js`). Lee (solo lectura) la hoja
"Sistema de Vouchers" (Config → "ID hoja de Vouchers"; si está vacío la busca en Drive) y cruza cada recibo
no revertido con los pagos de la misma empresa a esa persona (por RUC 10, DNI o nombre), entre 15 días antes
y 180 días después de la emisión. Espera la RENTA NETA (bruta − retención de 4ta):

1. el voucher menciona el recibo (E001-68) · 2. un voucher por el neto exacto · 3. un voucher que paga varios
recibos del mismo emisor · 4. varios vouchers que pagan un recibo · 5. un voucher por la renta BRUTA
(⚠️ pagado sin descontar la retención) · 6. pago parcial. Lo que solo coincide por nombre queda 💡 sugerido.

Pestañas: 🤝 Conciliación (✔ / ✖ y 💾 Guardar confirmaciones, guardadas en `_Decisiones honorarios`),
💸 Por pagar (cuentas por pagar por emisor), ❓ Pagos sin recibo (¿falta el RHE?) y 🧾 Retención por pago
(la retención de 4ta por MES DE PAGO, que es la que va a la PLAME / 0621).
El bot de Telegram/WhatsApp (`/honorarios` y la herramienta `honorarios_conciliacion` de la IA) muestra lo por pagar.
