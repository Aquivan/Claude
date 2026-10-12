"""
sondeo.py — Proyecto "Honorarios · Grupo" (solo LECTURA).
Entra a SOL y muestra: las opciones del menú que hablan de Recibos por
Honorarios y, de la consulta de recibos RECIBIDOS, sus formularios, listas y
direcciones internas. No descarga ni guarda nada. Nunca imprime claves.
"""
import html
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "retenciones", "scripts"))
from descargar_cre import Sol, MENU, texto  # noqa: E402


def mostrar_pagina(nombre, t, url):
    print(f"\n======== {nombre} · URL final: {url.split('?')[0]} · {len(t)} chars")
    print("TITULO:", texto((re.search(r"<title>(.*?)</title>", t, re.S | re.I) or [None, ""])[1])[:120])
    for f in re.finditer(r"<form[^>]*>", t, re.I):
        print("FORM:", re.sub(r"\s+", " ", f.group(0))[:300])
    for sel in re.finditer(r'<select[^>]*(?:id|name)="?([\w.]+)"?[^>]*>(.*?)</select>', t, re.S | re.I):
        ops = re.findall(r'<option[^>]*value="?([^">]*)"?[^>]*>(.*?)</option>', sel.group(2), re.S | re.I)
        print("SELECT", sel.group(1), ":", "; ".join(v + "=" + texto(x) for v, x in ops)[:500])
    for i in re.finditer(r"<input[^>]*>", t, re.I):
        s = re.sub(r"\s+", " ", i.group(0))
        if "hidden" in s.lower() or "name=" in s.lower():
            print("INPUT:", re.sub(r'value="[^"]{40,}"', 'value="…"', s)[:200])
    urls = sorted(set(re.findall(r"""["'](\.{0,2}/?[A-Za-z0-9_/\-]+\.(?:do|htm|html|jsp)[^"'\s]*|/ol-[^"'\s]+|/cl-[^"'\s]+|https://[a-z0-9.\-]+sunat\.gob\.pe/[^"'\s]+)["']""", t)))
    print("DIRECCIONES:", urls[:60])
    for pal in ["fecha", "Periodo", "periodo", "accion", "action", "buscar", "consultar", "descargar", "exportar", "excel", "pdf"]:
        for m in list(re.finditer(pal, t))[:2]:
            print(f"--- '{pal}':", re.sub(r"\s+", " ", t[max(0, m.start() - 150):m.start() + 250]))


def main():
    sol = Sol()
    sol.login(os.environ["SUNAT_RUC"], os.environ["SUNAT_USUARIO"], os.environ["SUNAT_CLAVE"])
    print("Login OK.")
    sol.pedir(MENU, {"action": "prevApp"})
    _, menu = sol.pedir(MENU)
    print("Menú:", len(menu), "chars")
    import urllib.parse
    URL = "https://ww1.sunat.gob.pe/ol-ti-itreciboelectronico/cpelec001Alias"
    sol.pedir(MENU, {"action": "prevApp"})
    sol.pedir(f"{MENU}?action=execute&code=11.5.1.1.14")
    datos = [("accion", "CapturaCriterioConsulatRec1"), ("tipocomprobante", "01;02;03;"), ("ruc_emisor", ""),
             ("num_serie", ""), ("num_comprob", ""), ("fec_desde", "01/09/2026"), ("fec_hasta", "30/09/2026"),
             ("tipocomprobante1", "01"), ("tipocomprobante1", "02"), ("tipocomprobante1", "03"), ("tipoestado", "00")]
    st, t = sol.pedir(URL, urllib.parse.urlencode(datos).encode())
    print("Búsqueda:", st, len(t))
    # A) Descargar el listado completo
    st, b = sol.pedir(URL, {"accion": "descargaConsultaReceptor"}, binario=True)
    print("\n#### A) descargaConsultaReceptor: HTTP", st, len(b), "bytes; inicio:", b[:8])
    try:
        import zipfile, io
        z = zipfile.ZipFile(io.BytesIO(b)); print("ZIP:", z.namelist()); b = z.read(z.namelist()[0])
    except Exception:
        pass
    print(b[:2500].decode("latin-1"))
    # B) Detalle de un recibo
    st, d = sol.pedir(URL, {"posirecibo": "1", "accion": "CapturaCriterioConsultaRec2"}, binario=True)
    d = d.decode("latin-1")
    print("\n#### B) detalle: HTTP", st, len(d))
    print("TEXTO:", texto(d)[:1500])
    for f in re.finditer(r"<form[^>]*>.*?</form>", d, re.S | re.I):
        print("  FORM:", re.sub(r"\s+", " ", re.sub(r'value="[^"]{60,}"', 'value="…"', f.group(0)))[:600])
    for m2 in re.finditer(r"function\s+(\w+)\s*\(([^)]*)\)\s*\{(.{0,300})", d, re.S):
        print("  FUNC:", m2.group(1), "(", m2.group(2), ")", re.sub(r"\s+", " ", m2.group(3))[:300])
    for l in re.findall(r"(?:href|onclick|src)=[\"']([^\"']+)[\"']", d)[:30]:
        print("  LINK:", l[:200])


if __name__ == "__main__":
    main()
