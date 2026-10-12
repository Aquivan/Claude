"""
descargar_rhe.py — Proyecto "Honorarios · Grupo".

Descarga de SUNAT (SOL) los Recibos por Honorarios Electrónicos RECIBIDOS
(también notas de crédito y otros ingresos de 4ta categoría) de UNA empresa,
mes por mes, y opcionalmente el PDF y XML oficial de cada recibo:

    honorarios/datos/<RUC>/<AAAA>/<MM>/rhe.csv                 un renglón por recibo
    honorarios/datos/<RUC>/<AAAA>/<MM>/pdf/<RUC emisor>-<serie>-<número>.pdf
    honorarios/datos/<RUC>/<AAAA>/<MM>/xml/<RUC emisor>-<serie>-<número>.xml

Ruta en SUNAT (solo LECTURA, no emite ni revierte nada):
  menú 11.5.1.1.14 "Consulta de RHE recibidos" (por rango de fechas de hasta 1 mes):
    - listado completo:  accion=descargaConsultaReceptor (texto separado por |)
    - cada recibo:       accion=CapturaCriterioConsultaRec2 (posirecibo = posición en la lista)
                         y luego accion=descargarrecibopdf / descargarreciboxml

Las claves SOL llegan por variables de entorno (SUNAT_RUC, SUNAT_USUARIO,
SUNAT_CLAVE) y nunca se imprimen. Reusa el inicio de sesión del proyecto
Retenciones (retenciones/scripts/descargar_cre.py).

Uso:  python descargar_rhe.py --periodo 202601 [--hasta 202609] [--salida honorarios/datos] [--sin-pdf]
"""
import argparse
import csv
import io
import os
import re
import sys
import time
import urllib.parse
import zipfile
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "retenciones", "scripts"))
from descargar_cre import Sol, MENU, LIMA, periodos, rango_mes, texto  # noqa: E402

CODIGO_MENU = "11.5.1.1.14"   # Consulta de RHE recibidos
URL = "https://ww1.sunat.gob.pe/ol-ti-itreciboelectronico/cpelec001Alias"
TIPOS = {"RH": "Recibo por honorarios", "NC": "Nota de crédito", "OI": "Otros ingresos 4ta"}

COLS = ["empresa_ruc", "periodo", "fecha_emision", "tipo", "comprobante", "serie", "numero", "estado",
        "emisor_tipo_doc", "emisor_ruc", "emisor", "tipo_renta", "gratuito", "descripcion", "observacion",
        "moneda", "renta_bruta", "retencion_renta", "renta_neta", "pendiente_pago", "pdf", "xml"]


def decodificar(b):
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        return b.decode("latin-1")


def num(s):
    s = str(s or "").strip().replace(",", "")
    try:
        return f"{float(s):.2f}"
    except ValueError:
        return ""


def buscar(sol, fini, ffin, filtro=None):
    """Hace la consulta del mes. filtro = (ruc, serie, número) para buscar un solo recibo."""
    sol.pedir(MENU, {"action": "prevApp"})
    sol.pedir(f"{MENU}?action=execute&code={CODIGO_MENU}")
    ruc, serie, numero = filtro or ("", "", "")
    datos = [("accion", "CapturaCriterioConsulatRec1"), ("tipocomprobante", "01;02;03;"), ("ruc_emisor", ruc),
             ("num_serie", serie), ("num_comprob", numero), ("fec_desde", fini), ("fec_hasta", ffin),
             ("tipocomprobante1", "01"), ("tipocomprobante1", "02"), ("tipocomprobante1", "03"), ("tipoestado", "00")]
    st, t = sol.pedir(URL, urllib.parse.urlencode(datos).encode(), binario=True)
    return st, decodificar(t)


def listado(sol):
    """Descarga el listado completo de la última consulta. Devuelve lista de dict."""
    st, b = sol.pedir(URL, {"accion": "descargaConsultaReceptor"}, binario=True)
    if st != 200 or not b:
        raise RuntimeError(f"SUNAT no entregó el listado (HTTP {st})")
    if b[:2] == b"PK":
        z = zipfile.ZipFile(io.BytesIO(b))
        b = z.read(z.namelist()[0])
    t = decodificar(b).replace("\r", "")
    lineas = [l for l in t.split("\n") if l.strip()]
    if not lineas or "|" not in lineas[0]:
        if re.search(r"no\s+(existe|se\s+encontr|hay)", texto(t), re.I):
            return []
        raise RuntimeError("Respuesta inesperada de SUNAT: " + texto(t)[:200])
    res = []
    for l in lineas[1:]:
        c = [x.strip() for x in l.split("|")]
        if len(c) < 16:
            continue
        serie, _, numero = c[2].partition("-")
        res.append({
            "fecha_emision": c[0], "tipo": c[1], "comprobante": c[2], "serie": serie, "numero": numero,
            "estado": c[3], "emisor_tipo_doc": c[4], "emisor_ruc": c[5], "emisor": re.sub(r"\s+", " ", c[6]),
            "tipo_renta": c[7], "gratuito": c[8], "descripcion": re.sub(r"\s+", " ", c[9]),
            "observacion": "" if c[10] in ("-", "") else c[10], "moneda": c[11],
            "renta_bruta": num(c[12]), "retencion_renta": num(c[13]), "renta_neta": num(c[14]),
            "pendiente_pago": num(c[15]),
        })
    return res


def elegir(sol, posicion, esperado):
    """Abre el detalle del recibo en la posición dada y verifica que sea el esperado."""
    st, d = sol.pedir(URL, {"posirecibo": str(posicion), "accion": "CapturaCriterioConsultaRec2"}, binario=True)
    d = texto(decodificar(d))
    return st == 200 and re.search(r"Nro:?\s*" + re.escape(esperado) + r"\b", d) is not None


def bajar(sol, accion, firma):
    for intento in range(3):
        st, b = sol.pedir(URL, {"accion": accion}, binario=True)
        if st == 200 and b:
            if b[:2] == b"PK":
                try:
                    z = zipfile.ZipFile(io.BytesIO(b))
                    b = z.read([n for n in z.namelist() if not n.endswith("/")][0])
                except Exception:
                    pass
            if b.lstrip()[:len(firma)] == firma:
                return b
        time.sleep(2 * (intento + 1))
    return None


def guardar_csv(ruta, filas):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        for r in filas:
            w.writerow({k: r.get(k, "") for k in COLS})


def mes(sol, ruc, periodo, salida, con_pdf):
    fini, ffin = rango_mes(periodo)
    carpeta = os.path.join(salida, ruc, periodo[:4], periodo[4:])
    st, _ = buscar(sol, fini, ffin)
    if st != 200:
        raise RuntimeError(f"la consulta respondió HTTP {st}")
    filas = listado(sol)
    for r in filas:
        r["empresa_ruc"], r["periodo"] = ruc, periodo
        base = f"{r['emisor_ruc']}-{r['serie']}-{r['numero']}"
        r["pdf"] = f"{ruc}/{periodo[:4]}/{periodo[4:]}/pdf/{base}.pdf"
        r["xml"] = f"{ruc}/{periodo[:4]}/{periodo[4:]}/xml/{base}.xml"
    nuevos = faltan = 0
    if con_pdf and filas:
        for i, r in enumerate(filas):
            rpdf, rxml = os.path.join(salida, r["pdf"]), os.path.join(salida, r["xml"])
            if os.path.exists(rpdf) and os.path.exists(rxml):
                continue
            ok = elegir(sol, i, r["comprobante"])
            if not ok:  # la posición no coincide: buscar ese recibo solo
                buscar(sol, fini, ffin, (r["emisor_ruc"], r["serie"], r["numero"]))
                ok = elegir(sol, 0, r["comprobante"])
                buscar(sol, fini, ffin)  # volver a la lista completa para los siguientes
            if not ok:
                faltan += 1
                continue
            pdf = bajar(sol, "descargarrecibopdf", b"%PDF")
            xml = bajar(sol, "descargarreciboxml", b"<")
            if pdf:
                os.makedirs(os.path.dirname(rpdf), exist_ok=True)
                open(rpdf, "wb").write(pdf)
                nuevos += 1
            else:
                faltan += 1
            if xml:
                os.makedirs(os.path.dirname(rxml), exist_ok=True)
                open(rxml, "wb").write(xml)
    for r in filas:  # solo se anota el archivo si existe
        if not os.path.exists(os.path.join(salida, r["pdf"])):
            r["pdf"] = ""
        if not os.path.exists(os.path.join(salida, r["xml"])):
            r["xml"] = ""
    if filas or os.path.isdir(carpeta):
        guardar_csv(os.path.join(carpeta, "rhe.csv"), filas)
    return len(filas), nuevos, faltan


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--periodo", required=True)
    ap.add_argument("--hasta", default="")
    ap.add_argument("--salida", default="honorarios/datos")
    ap.add_argument("--sin-pdf", action="store_true")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    hasta = a.hasta.strip() or datetime.now(LIMA).strftime("%Y%m")
    sol = Sol()
    sol.login(ruc, usuario, clave)
    print(f"Empresa {ruc}: login OK. Meses {a.periodo} a {hasta}. PDF: {'no' if a.sin_pdf else 'sí'}")
    errores = 0
    for p in periodos(a.periodo, hasta):
        try:
            n, nuevos, faltan = mes(sol, ruc, p, a.salida, not a.sin_pdf)
            print(f"  {p}: {n} recibos" + ("" if a.sin_pdf else f" · PDF nuevos {nuevos}" + (f" · sin PDF {faltan}" if faltan else "")))
        except Exception as e:
            errores += 1
            print(f"  {p}: ERROR {e}")
    if errores:
        print(f"Terminó con {errores} mes(es) con error (lo demás se guardó).")


if __name__ == "__main__":
    main()
