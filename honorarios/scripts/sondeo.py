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
    codigos = {}
    for m in re.finditer(r"[Hh]onorario", menu):
        trozo = menu[max(0, m.start() - 400):m.start() + 400]
        for c in re.findall(r"\b(\d{1,2}(?:\.\d{1,2}){2,6})\b", trozo):
            codigos[c] = 1
        print("--- menú:", re.sub(r"\s+", " ", html.unescape(trozo))[:800])
    # Todas las opciones con su nombre (formato del menú: código y texto cercanos)
    print("\nOPCIONES CON 'Honorario' / 'Recibo':")
    for m in re.finditer(r'(\d{1,2}(?:\.\d{1,2}){3,6})[^<>{}]{0,200}?(Recibo[^"<]{0,120}|Honorario[^"<]{0,120})', menu):
        print("  ", m.group(1), "→", texto(m.group(2))[:120])
    for c in sorted(codigos):
        if c.count(".") < 3:
            continue
        sol.pedir(MENU, {"action": "prevApp"})
        _, t = sol.pedir(f"{MENU}?action=execute&code={c}")
        if "honorario" in t.lower() or "recibo" in t.lower():
            mostrar_pagina(c, t, sol.ultima_url)


if __name__ == "__main__":
    main()
