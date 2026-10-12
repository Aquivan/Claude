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
    items = []
    for m in re.finditer(r'\{"name":"([\d.]+)","description":"([^"]*)"([^{}]*)\}', menu):
        url = (re.search(r'"url":"([^"]*)"', m.group(3)) or [None, ""])[1].replace("\\/", "/")
        tags = (re.search(r'"tags":"([^"]*)"', m.group(3)) or [None, ""])[1]
        items.append((m.group(1), m.group(2), url, tags))
    print("\nOPCIONES de Recibos por Honorarios / 4ta categoría:")
    elegidas = []
    for c, d, u, tg in items:
        txt = (c + " " + d + " " + u + " " + tg).lower()
        if c.startswith("11.5.") or "honorario" in txt or "rhe" in txt.split() or "cuarta" in txt:
            print("  ", c, "|", d, "|", u)
            if u and ("consult" in txt or "reporte" in txt or "recibid" in txt or "usuario" in txt):
                elegidas.append(c)
    for c in elegidas[:8]:
        sol.pedir(MENU, {"action": "prevApp"})
        _, t = sol.pedir(f"{MENU}?action=execute&code={c}")
        mostrar_pagina(c, t, sol.ultima_url)
        # funciones JS que llaman al servidor
        for m in re.finditer(r"(url\s*:\s*['\"][^'\"]+['\"]|action\s*=\s*['\"][^'\"]+['\"]|accion=[A-Za-z0-9_]+)", t):
            print("  JS:", m.group(0)[:150])


if __name__ == "__main__":
    main()
