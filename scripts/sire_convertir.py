# sire_convertir.py — convierte el .txt del SIRE (compras o ventas) que bajó sire_client.py a un CSV limpio.
#
# Es una COPIA EXACTA del script que sire-cadena-completa.yml arma por dentro (/tmp/convertir_sire.py);
# la usa sire-solo-reporte.yml ("SIRE solo reporte", rápido). Si cambia uno, cambie el otro.
# Uso (desde la carpeta que contiene sire/<RUC>/extraido_<tipo>/):
#   python3 sire_convertir.py <compra|venta> <csv_salida> <facturas.csv> <RUC> <si|no>
import csv, glob, sys, os, calendar

# argv: tipo_reporte("compra"|"venta")  ruta_csv_salida  ruta_facturas_csv  ruc  incluir_pdf("si"|"no")
tipo_reporte, ruta_csv_salida, ruta_facturas_csv, ruc = sys.argv[1:5]
# Compatibilidad: si no viene el 5to argumento, se asume "si" (todo
# lo que se descarga del SIRE tambien va a facturas.csv -- el
# comportamiento de siempre).
incluir_pdf = (sys.argv[5] if len(sys.argv) > 5 else "si") == "si"

candidatos = glob.glob(f'sire/{ruc}/extraido_{tipo_reporte}/**/*.txt', recursive=True)
if not candidatos:
    # sire_client.py ya no escribe ningun archivo cuando SUNAT
    # confirma que no hay comprobantes en el periodo (ver el AVISO
    # "no tiene comprobantes... periodo vacio" en su salida) --
    # eso es un resultado valido, no un error, asi que se sigue
    # igual que el caso de "0 filas" mas abajo en vez de cortar el job.
    print(f"AVISO: no se encontro ningun .txt para {tipo_reporte} -- "
          "SUNAT no tiene comprobantes de este tipo en este periodo.")
    os.makedirs(os.path.dirname(ruta_csv_salida) or ".", exist_ok=True)
    open(ruta_csv_salida, "w").close()
    sys.exit(0)

# SUNAT a veces devuelve VARIOS .txt dentro del mismo zip (distintos
# sub-libros, ej. Registro de Compras vs Compras No Domiciliado) y solo
# uno trae filas reales; el resto vienen vacios (solo cabecera o ni
# eso). Elegir por fecha de modificacion no es confiable (todos se
# extraen casi al mismo instante) - se leen TODOS los candidatos y se
# usa el que tenga mas filas de datos.
mejor_origen = mejor_filas = None
for candidato in candidatos:
    with open(candidato, encoding="utf-8", errors="replace") as f:
        filas_c = [l.rstrip("\n").rstrip("\r").split("|") for l in f if l.strip() != ""]
    print(f"  {candidato}: {max(len(filas_c) - 1, 0)} fila(s) de datos")
    if mejor_filas is None or len(filas_c) > len(mejor_filas):
        mejor_origen, mejor_filas = candidato, filas_c

origen, filas = mejor_origen, mejor_filas
print(f"Usando archivo ({tipo_reporte}, el que tiene mas datos):", origen)
print(f"DEBUG primera fila cruda ({len(filas[0]) if filas else 0} campos): {filas[0] if filas else []}")

# No asumir si el .txt trae cabecera o no: SUNAT a veces la trae y
# a veces no segun el endpoint (propuesta vs descarga oficial), y
# eso puede variar entre compras y ventas o incluso entre
# ejecuciones. Se detecta dinamicamente: la primera columna
# siempre es el RUC propio (11 digitos) en una fila de DATOS; si la
# primera fila NO es un RUC de 11 digitos, ya es una fila de
# cabecera real de SUNAT y se usa tal cual (sin inventar nombres).
primer_campo = (filas[0][0].strip() if filas and filas[0] else "")
ya_tiene_header = not (primer_campo.isdigit() and len(primer_campo) == 11)
print(f"DEBUG primer campo: {primer_campo!r} -> ya_tiene_header={ya_tiene_header}")

# Ventas (RVIE): SUNAT SI trae cabecera real cuando el periodo
# todavia no esta "presentado" (te devuelve la PROPUESTA, que
# incluye una fila de encabezado -- ver el bug de BOM/case
# corregido el 2026-08-19 en idx_de_ mas abajo). Pero cuando el
# periodo YA esta presentado, te devuelve el registro oficial SIN
# fila de encabezado (confirmado el 2026-08-18 con datos reales:
# el primer campo es directamente el RUC numerico de 11 digitos).
# Para ese caso sin encabezado se le pega esta cabecera sintetica
# por posicion -- son los mismos 39 primeros nombres reales de la
# propuesta (que trae 40 campos con "CLU" al final; el registro
# oficial trae uno menos, sin ese ultimo campo), verificados el
# 2026-08-19 contra la propuesta real de un periodo no presentado.
# Solo se aplica cuando el numero de campos coincide exactamente
# (39); si SUNAT cambia el formato, se omite en vez de adivinar mal.
VENTAS_HEADERS = [
    "RUC", "Razon Social", "Periodo", "CAR SUNAT",
    "Fecha de emisión", "Fecha Vcto/Pago", "Tipo CP/Doc.", "Serie del CDP",
    "Nro CP o Doc. Nro Inicial (Rango)", "Nro Final (Rango)",
    "Tipo Doc Identidad", "Nro Doc Identidad", "Apellidos Nombres/ Razón Social",
    "Valor Facturado Exportación", "BI Gravada", "Dscto BI", "IGV / IPM",
    "Dscto IGV / IPM", "Mto Exonerado", "Mto Inafecto", "ISC",
    "BI Grav IVAP", "IVAP", "ICBPER", "Otros Tributos",
    "Total CP", "Moneda", "Tipo Cambio",
    "Fecha Emisión Doc Modificado", "Tipo CP Modificado", "Serie CP Modificado",
    "Nro CP Modificado", "ID Proyecto Operadores Atribución", "Tipo de Nota",
    "Est. Comp", "Valor FOB Embarcado", "Valor OP Gratuitas", "Tipo Operación",
    "DAM / CP",
]

if not ya_tiene_header:
    if tipo_reporte == "venta" and filas:
        num_cols = len(filas[0])
        if num_cols == len(VENTAS_HEADERS):
            filas = [VENTAS_HEADERS] + filas
        elif num_cols == len(VENTAS_HEADERS) + 1:
            filas = [VENTAS_HEADERS + ["CLU"]] + filas
        elif num_cols >= len(VENTAS_HEADERS):
            headers_gen = VENTAS_HEADERS + [f"Campo_{i}" for i in range(len(VENTAS_HEADERS) + 1, num_cols + 1)]
            filas = [headers_gen] + filas
        elif num_cols >= 15:
            headers_gen = VENTAS_HEADERS[:num_cols]
            filas = [headers_gen] + filas
        else:
            print(f"AVISO: el .txt de {tipo_reporte} no trae fila de cabecera y no se pudo "
                  f"etiquetar con seguridad ({num_cols} campos).")
            open(ruta_csv_salida, "w").close()
            sys.exit(0)
    else:
        print(f"AVISO: el .txt de {tipo_reporte} no trae fila de cabecera y no se pudo "
              "etiquetar con seguridad. Se omite.")
        open(ruta_csv_salida, "w").close()
        sys.exit(0)

os.makedirs(os.path.dirname(ruta_csv_salida) or ".", exist_ok=True)
if len(filas) < 2:
    print(f"AVISO: {tipo_reporte} no tiene comprobantes en este periodo.")
    open(ruta_csv_salida, "w").close()
    sys.exit(0)

with open(ruta_csv_salida, "w", newline="", encoding="utf-8") as out:
    csv.writer(out).writerows(filas)
print(f"OK: {len(filas)-1} fila(s) de {tipo_reporte} en {ruta_csv_salida}")

if not incluir_pdf:
    # El registro SIRE completo de {tipo_reporte} ya quedo guardado
    # arriba (ruta_csv_salida); lo unico que se salta es agregar
    # estas filas a facturas.csv, que es lo que despues dispara la
    # descarga de PDF/XML comprobante por comprobante. Permite
    # bajar TODO el registro (compra y venta) sin gastar tiempo/
    # llamadas bajando PDF/XML de un tipo que no se quiere (ver
    # empresas.json: campo "descarga_pdf_xml").
    print(f"OK: {tipo_reporte} configurado para NO bajar PDF/XML (descarga_pdf_xml). "
          "Se omite agregar a facturas.csv.")
    sys.exit(0)

# ---- Agrega filas a facturas.csv (lo que necesita la descarga de PDF/XML) ----
# Bug real encontrado el 2026-08-19: para el periodo del mes en curso
# (todavia no "presentado"), SUNAT devuelve la PROPUESTA, que SI trae
# cabecera real -- pero con un BOM pegado a la primera celda
# ('﻿Ruc') y con otra capitalizacion ('Ruc' en vez de 'RUC') que
# la del registro ya presentado. headers.index("RUC") tiraba
# ValueError y tumbaba todo el job. Se busca por nombre normalizado
# (sin BOM, sin espacios, sin importar mayus/minus) en vez de exigir
# coincidencia exacta.
def idx_de_(nombre):
    def normalizar(s):
        return s.strip().lstrip("﻿").strip().lower()
    objetivo = normalizar(nombre)
    normados = [normalizar(h) for h in headers]
    if objetivo not in normados:
        raise ValueError(f"Columna {nombre!r} no encontrada en la cabecera: {headers}")
    return normados.index(objetivo)

headers = [h.strip().lstrip("﻿").strip() for h in filas[0]]
idx_periodo = idx_de_("Periodo")
idx_tipo_cp = idx_de_("Tipo CP/Doc.")
idx_serie = idx_de_("Serie del CDP")
idx_numero = idx_de_("Nro CP o Doc. Nro Inicial (Rango)")
idx_ruc_propio = idx_de_("RUC")
idx_ruc_contraparte = idx_de_("Nro Doc Identidad")

# SIRE (Catalogo 01) -> codigo legacy que entiende la descarga de
# PDF/XML (Emitidas=ventas, Recibidas=compras - ver mapear_codcpe).
if tipo_reporte == "venta":
    TIPO_LEGACY = {"01": "10", "07": "13", "08": "15"}
else:
    TIPO_LEGACY = {"01": "11", "07": "14", "08": "16"}

existe_header = os.path.exists(ruta_facturas_csv) and os.path.getsize(ruta_facturas_csv) > 0
with open(ruta_facturas_csv, "a", newline="", encoding="utf-8") as out:
    w = csv.writer(out)
    if not existe_header:
        w.writerow(["tipo", "ruc_emisor", "serie", "numero", "fecha_desde", "fecha_hasta"])
    agregadas = no_soportadas = 0
    for fila in filas[1:]:
        if len(fila) <= max(idx_periodo, idx_tipo_cp, idx_serie, idx_numero,
                             idx_ruc_propio, idx_ruc_contraparte):
            continue
        tipo_cp = fila[idx_tipo_cp].strip()
        serie = fila[idx_serie].strip()
        numero = fila[idx_numero].strip()
        periodo = fila[idx_periodo].strip()
        # El "emisor" real del comprobante para la API de SUNAT: en
        # compras es el proveedor (Nro Doc Identidad); en ventas
        # somos nosotros mismos (columna RUC, constante).
        if tipo_reporte == "venta":
            ruc_emisor_real = fila[idx_ruc_propio].strip()
        else:
            ruc_emisor_real = fila[idx_ruc_contraparte].strip()
        if not (serie and numero and ruc_emisor_real):
            continue
        tipo_legacy = TIPO_LEGACY.get(tipo_cp)
        if not tipo_legacy:
            no_soportadas += 1
            continue
        fecha_desde = fecha_hasta = ""
        if len(periodo) == 6 and periodo.isdigit():
            anio, mes = int(periodo[:4]), int(periodo[4:6])
            ultimo_dia = calendar.monthrange(anio, mes)[1]
            fecha_desde = f"01/{mes:02d}/{anio}"
            fecha_hasta = f"{ultimo_dia:02d}/{mes:02d}/{anio}"
        w.writerow([tipo_legacy, ruc_emisor_real, serie, numero, fecha_desde, fecha_hasta])
        agregadas += 1
print(f"OK: {agregadas} factura(s) de {tipo_reporte} agregadas a {ruta_facturas_csv} "
      f"({no_soportadas} no soportada(s) todavia)")
