"""
sondeo.py — Proyecto "Notificaciones · Grupo" (solo LECTURA).
Entra al Buzón Electrónico SOL sin navegador, lista notificaciones y mensajes
(solo la lista: NO abre ninguno) y busca en el código de la página cómo se
descargan los adjuntos. Nunca imprime claves.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "retenciones", "scripts"))
from descargar_cre import Sol, MENU  # noqa: E402

VISOR = "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor"


def main():
    sol = Sol()
    sol.login(os.environ["SUNAT_RUC"], os.environ["SUNAT_USUARIO"], os.environ["SUNAT_CLAVE"])
    print("Login OK.")
    sol.pedir(MENU, {"action": "prevApp"})
    st, master = sol.pedir(f"{MENU}?action=buzon&s=ww1")
    print("buzon:", st, sol.ultima_url.split("?")[0], len(master))
    tok = re.search(r'name="meta-token" content="([^"]+)"', master)
    print("meta-token:", "sí" if tok else "no")
    h = {"X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01",
         "Referer": sol.ultima_url}
    if tok:
        h["X-CSRF-TOKEN"] = tok.group(1)
    for tipo in ["2", "1"]:
        st, t = sol.pedir(f"{VISOR}/listNotiMenPag?tipoMsj={tipo}&codCarpeta=00&codEtiqueta=&page=1&des_asunto=&codMensaje=&tipoOrden=NADA", headers=h)
        try:
            d = json.loads(t)
            print(f"\n### tipoMsj={tipo}: total páginas {d.get('total')}, registros {d.get('records')}, filas {len(d.get('rows') or [])}")
            for r in (d.get("rows") or [])[:4]:
                print("   ", {k: r[k] for k in ["codMensaje", "indEstado", "desAsunto", "fecPublica", "codEtiqueta", "cantidadArchAdj", "indUrg", "codUsremisor"]})
            print("   campos:", sorted((d.get("rows") or [{}])[0].keys()))
        except Exception:
            print(f"### tipoMsj={tipo}: HTTP {st} no JSON:", t[:300])
    # Etiquetas y textos de la página principal
    for m in re.finditer(r"codEtiqueta[^\n]{0,200}", master):
        pass
    print("\nREFERENCIAS en la página del buzón:")
    for x in sorted(set(re.findall(r"""["']((?:\.\./|/ol-ti-itvisornoti/|visor/|ajax/|/cl-ti-)[^"'\s]{3,200})["']""", master))):
        print("  ", x)
    scripts = sorted(set(re.findall(r'<script[^>]+src="([^"]+)"', master)))
    print("SCRIPTS:", scripts)
    for s in scripts:
        if re.search(r"jquery|bootstrap|moment|respond|html5shiv|monitor", s, re.I):
            continue
        url = s if s.startswith("http") else ("https://ww1.sunat.gob.pe" + s if s.startswith("/") else VISOR + "/" + s)
        st, js = sol.pedir(url, intentos=1)
        print(f"\n### {url.split('?')[0]} HTTP {st} {len(js)}")
        for m in re.finditer(r"(descarg\w*|archivo\w*|adjunt\w*|etiqueta\w*)", js, re.I):
            pass
        for x in sorted(set(re.findall(r"""["']((?:\.\./|/ol-ti-itvisornoti/|visor/|ajax/|/cl-ti-)?[A-Za-z/]*(?:[Dd]escarg|[Aa]rchiv|[Aa]djunt|[Ee]tiquet|[Ll]eid|[Ll]ectur)[^"'\s]{0,150})["']""", js)))[:40]:
            print("   URL/TEXTO:", x)
        for m in re.finditer(r"function\s+(\w*(?:[Dd]escarg|[Aa]rchiv|[Aa]djunt|[Ee]tiquet)\w*)\s*\(([^)]*)\)\s*\{(.{0,500})", js, re.S):
            print("   FUNC:", m.group(1), "(", m.group(2), ")", re.sub(r"\s+", " ", m.group(3))[:500])
    # inline JS de la página
    for m in re.finditer(r"function\s+(\w*(?:[Dd]escarg|[Aa]rchiv|[Aa]djunt|[Ee]tiquet)\w*)\s*\(([^)]*)\)\s*\{(.{0,500})", master, re.S):
        print("FUNC (página):", m.group(1), "(", m.group(2), ")", re.sub(r"\s+", " ", m.group(3))[:500])


if __name__ == "__main__":
    main()
