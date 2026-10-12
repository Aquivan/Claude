"""
sondeo.py — Proyecto "Notificaciones · Grupo" (solo LECTURA).
Entra a SOL y muestra cómo el menú carga el Buzón Electrónico (funciones JS,
direcciones y la respuesta de la lista de mensajes). No abre ningún mensaje
ni descarga adjuntos. Nunca imprime claves.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "retenciones", "scripts"))
from descargar_cre import Sol, MENU, texto  # noqa: E402


def main():
    sol = Sol()
    sol.login(os.environ["SUNAT_RUC"], os.environ["SUNAT_USUARIO"], os.environ["SUNAT_CLAVE"])
    print("Login OK.")
    sol.pedir(MENU, {"action": "prevApp"})
    _, menu = sol.pedir(MENU)
    print("Menú:", len(menu), "chars")
    sol.pedir(MENU, {"action": "prevApp"})
    st, t = sol.pedir(f"{MENU}?action=buzon")
    print("\n### action=buzon: HTTP", st, "URL final:", sol.ultima_url.split("?")[0], len(t), "chars")
    print("TITULO:", texto((re.search(r"<title>(.*?)</title>", t, re.S | re.I) or [None, ""])[1])[:120])
    print("TEXTO:", texto(t)[:800])
    for x in sorted(set(re.findall(r"""(?:src|href|action|url)\s*[:=]\s*["']([^"'\s]{4,250})["']""", t))):
        print("  REF:", x[:250])
    for f in re.finditer(r"(?:\$\.ajax|\$\.post|\$\.get|fetch|XMLHttpRequest|\.load)\s*\((.{0,400})", t, re.S):
        print("  AJAX:", re.sub(r"\s+", " ", f.group(1))[:400])
    # seguir iframes / scripts propios del buzón
    base = re.match(r"(https://[^/]+)", sol.ultima_url).group(1)
    for src in sorted(set(re.findall(r"""<(?:iframe|frame|script)[^>]+src=["']([^"']+)["']""", t, re.I)))[:15]:
        if src.startswith("//"):
            src = "https:" + src
        elif src.startswith("/"):
            src = base + src
        elif not src.startswith("http"):
            src = sol.ultima_url.rsplit("/", 1)[0] + "/" + src
        if re.search(r"jquery|bootstrap|moment|monitor247|html5shiv|respond", src, re.I):
            continue
        st2, t2 = sol.pedir(src, intentos=1)
        print(f"\n### {src.split('?')[0]}: HTTP {st2}, {len(t2)} chars")
        for x in sorted(set(re.findall(r"""["'](/[a-z][^"'\s]{6,200}|[a-zA-Z]+\.(?:htm|do|json)[^"'\s]{0,120})["']""", t2)))[:60]:
            print("   URL:", x)
        for f in re.finditer(r"(?:\$\.ajax|\$\.post|\$\.get|\.load|url\s*:)\s*\(?(.{0,300})", t2, re.S):
            print("   AJAX:", re.sub(r"\s+", " ", f.group(1))[:300])
        for f in re.finditer(r"function\s+(\w+)\s*\(", t2):
            pass
        print("   FUNCIONES:", sorted(set(re.findall(r"function\s+(\w+)\s*\(", t2)))[:80])


if __name__ == "__main__":
    main()
