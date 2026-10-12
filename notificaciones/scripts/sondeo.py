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
    vistos = set()
    for pal in ["buzon", "Buzon", "Buzón", "mensaje", "Mensaje", "notifica", "Notifica"]:
        for m in list(re.finditer(pal, menu))[:6]:
            trozo = re.sub(r"\s+", " ", menu[max(0, m.start() - 250):m.start() + 350])
            k = trozo[:80]
            if k in vistos:
                continue
            vistos.add(k)
            print(f"--- '{pal}':", trozo)
    print("\nACCIONES del menú (action=...):", sorted(set(re.findall(r"action=([A-Za-z]+)", menu))))
    print("URLs con buzon/mensaje/noti:", sorted(set(u for u in re.findall(r"""["']([^"'\s]{6,200})["']""", menu)
                                                    if re.search(r"buz|mensaj|notif|visor", u, re.I)))[:40])
    for f in re.finditer(r"function\s+(\w*(?:[Bb]uz|[Mm]ensaj|[Nn]otif|[Vv]isor)\w*)\s*\(([^)]*)\)\s*\{(.{0,600})", menu, re.S):
        print("FUNC:", f.group(1), "(", f.group(2), ")", re.sub(r"\s+", " ", f.group(3))[:600])
    # scripts externos del menú
    for src in sorted(set(re.findall(r'<script[^>]+src="([^"]+)"', menu)))[:30]:
        print("SCRIPT:", src)
    # probar acciones típicas de lista de mensajes (solo lectura)
    for acc in ["listarMensajes", "getMensajes", "listaMensajes", "consultarMensajes", "mensajes"]:
        st, t = sol.pedir(f"{MENU}?action={acc}", {"pagina": "1"}, intentos=1)
        print(f"\n### {acc}: HTTP {st}, {len(t)} chars:", texto(t)[:300])


if __name__ == "__main__":
    main()
