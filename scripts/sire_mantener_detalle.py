"""
sire_mantener_detalle.py — al guardar un reporte SIRE nuevo, conserva las columnas que solo trae la cadena completa
(items_descripcion, items_cantidad, enlaces de PDF/XML…) del CSV que ya estaba en el histórico.

El «SIRE solo reporte» (rápido) baja solo el registro de SUNAT: sin esto, al guardar su CSV se perdían los productos de cada
factura que había leído la cadena completa (y la hoja de Guías decía «0 productos»).

Uso: python3 sire_mantener_detalle.py <csv_nuevo> <csv_existente>   (reescribe <csv_nuevo>)
"""
import csv
import re
import sys

CLAVE = ("Tipo CP/Doc.", "Serie del CDP", "Nro CP o Doc. Nro Inicial (Rango)")


def leer(ruta):
    with open(ruta, encoding="utf-8-sig", newline="") as f:
        filas = list(csv.reader(f))
    return (filas[0], filas[1:]) if filas else ([], [])


def clave(cab, fila):
    v = []
    for k in CLAVE:
        i = cab.index(k) if k in cab else -1
        x = fila[i].strip() if 0 <= i < len(fila) else ""
        v.append(x.lstrip("0") or "0" if k != "Serie del CDP" else x.upper())
    return tuple(v)


def main(nuevo, existente):
    try:
        c_ex, f_ex = leer(existente)
    except FileNotFoundError:
        return
    c_nu, f_nu = leer(nuevo)
    # solo el detalle que agrega la cadena completa (no columnas que SUNAT renombró entre versiones)
    extra = [k for k in c_ex if k and k not in c_nu and (k.startswith("items_") or re.search(r"(?i)link|pdf|xml", k))]
    if not extra or not all(k in c_nu for k in CLAVE) or not all(k in c_ex for k in CLAVE):
        return
    viejos = {clave(c_ex, f): f for f in f_ex}
    idx = [c_ex.index(k) for k in extra]
    salida = [c_nu + extra]
    conservadas = 0
    for f in f_nu:
        v = viejos.get(clave(c_nu, f))
        add = [(v[i] if v and i < len(v) else "") for i in idx]
        conservadas += 1 if v and any(add) else 0
        salida.append(f + add)
    with open(nuevo, "w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(salida)
    print(f"Detalle conservado ({', '.join(extra)}): {conservadas} comprobante(s).")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
