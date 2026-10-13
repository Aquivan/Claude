"""Convierte los .zip crudos de SUNAT de COMPRAS de un periodo en dos CSV
legibles por la hoja de Google (Apps Script no abre bien estos .zip):

  sire/<RUC>/historico/<AAAAMM>/Propuesta_compra.zip -> compras_propuesta.csv
  sire/<RUC>/historico/<AAAAMM>/Aceptada_compra.zip  -> compras_aceptada.csv

Se quitan las columnas CLU (vacias). La Liquidacion IGV los usa para armar la
pestaña "Compras SIRE completo" (todas las facturas, sin duplicar, con su
estado: anotada en una aceptada o solo en propuesta).

Uso:
  python3 scripts/sire_versiones_compras.py <carpeta_periodo> [<carpeta_periodo> ...]
  python3 scripts/sire_versiones_compras.py --todo sire        (todas las empresas y periodos)
"""
import csv
import io
import os
import sys
import zipfile

VERSIONES = (('Propuesta_compra.zip', 'compras_propuesta.csv'), ('Aceptada_compra.zip', 'compras_aceptada.csv'))
CABECERA_RESPALDO = None  # se toma de la primera propuesta/aceptada con cabecera


def leer_zip(ruta):
    """Filas del .txt con mas datos dentro del zip (SUNAT a veces trae varios)."""
    mejor = []
    with zipfile.ZipFile(ruta) as zf:
        for nombre in zf.namelist():
            if not nombre.lower().endswith('.txt'):
                continue
            texto = zf.read(nombre).decode('utf-8', 'replace').lstrip('﻿')
            filas = [l.rstrip('\r').split('|') for l in texto.split('\n') if l.strip()]
            if len(filas) > len(mejor):
                mejor = filas
    return mejor


def tiene_cabecera(fila):
    primero = (fila[0] if fila else '').strip()
    return not (primero.isdigit() and len(primero) == 11)


def convertir(carpeta):
    global CABECERA_RESPALDO
    hechos = []
    for zip_nombre, csv_nombre in VERSIONES:
        ruta_zip = os.path.join(carpeta, zip_nombre)
        if not os.path.exists(ruta_zip):
            continue
        filas = leer_zip(ruta_zip)
        if filas and tiene_cabecera(filas[0]):
            cab, datos = filas[0], filas[1:]
            CABECERA_RESPALDO = CABECERA_RESPALDO or cab
        elif filas and CABECERA_RESPALDO and len(filas[0]) <= len(CABECERA_RESPALDO):
            cab, datos = CABECERA_RESPALDO[:len(filas[0])], filas
        elif filas:
            print(f'AVISO: {ruta_zip} no trae cabecera; se omite.')
            continue
        else:
            cab, datos = [], []
        utiles = [i for i, h in enumerate(cab) if not h.strip().upper().startswith('CLU') and h.strip()]
        salida = io.StringIO()
        w = csv.writer(salida)
        if cab:
            w.writerow([cab[i].strip() for i in utiles])
            for f in datos:
                if len(f) > 5:
                    w.writerow([(f[i].strip() if i < len(f) else '') for i in utiles])
        destino = os.path.join(carpeta, csv_nombre)
        nuevo = salida.getvalue()
        viejo = open(destino, encoding='utf-8').read() if os.path.exists(destino) else None
        if nuevo != viejo:
            with open(destino, 'w', encoding='utf-8', newline='') as f:
                f.write(nuevo)
        hechos.append(f'{csv_nombre} ({len(datos)} filas)')
    return hechos


def main(args):
    carpetas = []
    if args[:1] == ['--todo']:
        raiz = args[1] if len(args) > 1 else 'sire'
        for ruc in sorted(os.listdir(raiz)):
            hist = os.path.join(raiz, ruc, 'historico')
            if os.path.isdir(hist):
                carpetas += [os.path.join(hist, p) for p in sorted(os.listdir(hist))]
    else:
        carpetas = args
    for c in carpetas:
        hechos = convertir(c)
        if hechos:
            print(c + ': ' + ', '.join(hechos))


if __name__ == '__main__':
    main(sys.argv[1:])
