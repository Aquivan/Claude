# 📑 Declaraciones · Grupo

Baja de SUNAT SOL las **declaraciones presentadas** de todas las empresas, con su **constancia oficial en PDF**:

| Formulario | Qué es |
|---|---|
| **PDT 621** | IGV-Renta mensual |
| **PDT 601** | PLAME (planilla electrónica) |
| **PDT 626** | Agentes de Retención del IGV |

Se lee de **SUNAT SOL → Mis declaraciones y pagos → Consultas → Consulta de Declaraciones y Pagos** (menú 55.2.1.1.1), igual que una persona. **Solo lee.**

## Constancia y detalle
- **Constancia**: el comprobante de presentación (tributos y monto).
- **Detalle**: la declaración completa con todas sus casillas. Es el PDF oficial de SUNAT «Detalle de la declaración» y SUNAT lo da para el **PDT 621** y el **PDT 626**.
- Para el PLAME presentado con el PDT, SUNAT no da ese PDF, pero sus casillas igual quedan en la hoja.
- Si una declaración ya estaba sin detalle, la próxima descarga baja solo el detalle.

## Rectificatorias
Cada presentación tiene su **N° de orden** y se bajan **todas**. La **última presentada** de cada empresa + formulario + periodo es la **✅ Vigente** (la que cuentan los reportes). Las anteriores quedan como **🗄 Respaldo**, y su PDF pasa a la subcarpeta `Respaldo (anteriores)` del mes.

## Nada queda en GitHub
El repositorio es **público**, así que el robot **no guarda nada** en él. Cada constancia va **directo a la hoja** (su aplicación web) con una **llave de un solo uso** que la hoja crea al pedir la descarga y que vence en 6 horas.

- La dirección y la llave se tapan en el registro antes de usarse.
- El registro de GitHub solo dice cuántas declaraciones hubo: no muestra montos ni números de orden.

## Cómo se usa
1. Menú **📑 Declaraciones → 🔑 Guardar token de GitHub** (el mismo de las otras hojas, permiso *Actions: Read and write*).
2. **🧰 Preparar la hoja (primera vez)**: arma las pestañas y activa la **descarga mensual**.
3. **⬇ Pedir a SUNAT lo nuevo** (los últimos meses) o **⬇ elegir periodos y empresa…** (por ejemplo `202601-202610`, o con un RUC; con «rehacer» vuelve a bajar todo).

**Descarga mensual:**
- Corre sola el **día 28** de cada mes (se cambia en ⚙️ Config). Para entonces ya vencieron todas las empresas según el cronograma SUNAT, incluidos los buenos contribuyentes.
- Revisa los **últimos 3 meses**, así también recoge las rectificatorias hechas después.
- Solo baja lo que la hoja aún no tiene.

## Pestañas
| Pestaña | Qué tiene |
|---|---|
| 📊 Panel | Por empresa: último 621 / 601 / 626, cuántas hay, cuántas se rectificaron y **qué falta** (periodos ya vencidos sin presentar o sin bajar) |
| 📒 IGV-Renta 621 | Por empresa y año: ventas, compras, crédito fiscal, determinación del IGV, renta (ingresos, coeficiente, pago a cuenta) y total, mes a mes, con el **total del año como fórmula** |
| 👷 PLAME 601 | Igual: personal, bases y aportes (EsSalud, ONP, renta de 5ta y de 4ta) y total |
| 🧾 Retenciones 626 | Igual: retenciones efectuadas, pagos previos, interés y total |
| 🗂 Por periodo | Las tres declaraciones lado a lado por empresa y mes (fecha, tipo, IGV, Renta, trabajadores, retenciones, pagado) |
| 📄 Declaraciones | Todas las presentaciones (originales y rectificatorias) con estado y **📄 Ver PDF** |
| 🧾 Tributos | El detalle de tributos de cada declaración (total deuda, pagado, por pagar) |
| 🔢 Casillas | Las casillas con valor de las declaraciones vigentes, con su **sección y nombre oficial de SUNAT** (catálogo en `DEC_Catalogo.js`, tomado de la pantalla «Detalle de la declaración» de SUNAT) |
| ⚙️ Config / 📖 Ayuda | Parámetros y ayuda |

Los PDF quedan en Drive, en la carpeta `PDF Declaraciones/<RUC - Empresa>/<Año>/<Mes>/`, junto a la hoja.

## Archivos
| Archivo | Qué hace |
|---|---|
| `scripts/descargar_declaraciones.py` | Robot (Chrome real): entra a SOL, busca, abre cada constancia nueva, baja su PDF y lo manda a la hoja |
| `scripts/explorar.py` | Explorador de solo lectura (registro sin datos: montos y números tapados) |
| `apps_script/DEC_Config.js` | Menú, ⚙️ Config, token, descarga mensual, 🧰 Preparar |
| `apps_script/DEC_Pedir.js` | Crea la llave de un solo uso y lanza el robot; 🔎 Estado |
| `apps_script/DEC_Web.js` | Aplicación web: recibe la lista, cada constancia (PDF a Drive) y el fin |
| `apps_script/DEC_Hojas.js` | Vigente / respaldo, PDF a su carpeta, Panel, Por periodo, Tributos, ayuda |
| `apps_script/DEC_Reportes.js` | Reportes anuales 📒 621, 👷 601 y 🧾 626, y 🔢 Casillas |
| `apps_script/DEC_Catalogo.js` | Nombres oficiales de las casillas (621, 626, PLAME 601) |
| `apps_script/DEC_Despliegue.js` | ID de la aplicación web y de la hoja (lo escribe el workflow; vacío en el repositorio) |

**Robots de GitHub** (`.github/workflows/`):
- `declaraciones-descargar.yml`: la descarga. Solo la pide la hoja.
- `declaraciones-explorar.yml`: el sondeo, solo mira.
- `deploy-declaraciones.yml`: crea la hoja (una vez) y publica cada cambio.

**Claves:**
- Las claves SOL salen de `SUNAT_CLAVES` (una máquina para todas las empresas) o del Environment de cada empresa.
- El token de GitHub de la hoja queda en la propiedad `DEC_GITHUB_TOKEN` (menú 🔑).
