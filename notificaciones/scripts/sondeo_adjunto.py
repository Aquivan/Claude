"""
sondeo_adjunto.py — Proyecto "Notificaciones · Grupo" (diagnóstico).
Para notificaciones cuyo adjunto llega vacío por la ruta de siempre, muestra cómo
lo baja la página de SUNAT (el JavaScript de goArchivoDescarga / bajarArchivo) y
prueba las otras rutas. Solo imprime tamaños y los primeros bytes; nunca claves.
Abre el detalle (ya están leídas: no cambia nada en SOL).

Uso: SUNAT_RUC=… python sondeo_adjunto.py 1090827938 [otro_codigo…]
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "retenciones", "scripts"))
from descargar_cre import Sol  # noqa: E402
from descargar_buzon import Buzon, VISOR  # noqa: E402

BASE = "https://ww1.sunat.gob.pe"


def firma(st, b):
    b = b or b""
    if isinstance(b, str):
        b = b.encode("utf-8", errors="ignore")
    tipo = "PDF" if b[:4] == b"%PDF" else "ZIP" if b[:2] == b"PK" else "HTML" if b"<html" in b[:400].lower() else "?"
    return f"HTTP {st} · {len(b)} bytes · {tipo} · {b[:60]!r}"


def trozos(js, patron, ancho=900):
    for m in re.finditer(patron, js):
        a = max(0, m.start() - 150)
        print("   …", re.sub(r"\s+", " ", js[a:m.start() + ancho]), "…\n")


def main():
    codigos = sys.argv[1:] or ["1090827938"]
    ruc = os.environ["SUNAT_RUC"]
    sol = Sol()
    sol.login(ruc, os.environ["SUNAT_USUARIO"], os.environ["SUNAT_CLAVE"])
    bz = Buzon(sol, ruc)
    print("Buzón abierto. idSistema:", bz.id_sistema)
    st, master = sol.pedir(bz.h["Referer"])
    print("\n### JS de la página del buzón (descarga de adjuntos)")
    trozos(master, r"function\s+addFileAdjunto|bajarArchivo|goArchivoDescarga|accion=archivo|descargarArchivo|verArchivo")
    for s in sorted(set(re.findall(r'<script[^>]+src="([^"]+)"', master))):
        if re.search(r"jquery|bootstrap|moment|respond|html5shiv|monitor|placeholder", s, re.I):
            continue
        url = s if s.startswith("http") else (BASE + s if s.startswith("/") else VISOR + "/" + s)
        st, js = sol.pedir(url, intentos=1)
        if re.search(r"bajarArchivo|goArchivoDescarga|accion=archivo", js):
            print(f"\n### {url.split('?')[0]} ({len(js)})")
            trozos(js, r"bajarArchivo|function\s+goArchivoDescarga|accion=archivo|visorPdf|PdfDescarga")
    for cod in codigos:
        print(f"\n================ notificación {cod}")
        st, t = sol.pedir(f"{VISOR}/obtenerDetalleNotiMen?codigoMensaje={cod}&tipoMsj=2", headers=bz.h)
        try:
            d = json.loads(t)
        except Exception:
            print("detalle no JSON:", t[:300]); continue
        print("campos:", {k: (v if not isinstance(v, str) or len(v) < 120 else f"<texto {len(v)}>") for k, v in d.items() if k != "listAttach"})
        print("listAttach:", d.get("listAttach"))
        print("url:", d.get("url"))
        print("cuerpo:", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", d.get("msjMensaje") or ""))[:300])
        sis = d.get("sistema")
        cuerpo = d.get("msjMensaje") or d.get("desMensaje") or ""
        if cuerpo:
            print("enlaces en el cuerpo:", re.findall(r"""(?:href|onclick)=["']([^"']{5,200})""", cuerpo)[:10])
        docs = re.findall(r"goArchivoDescarga\(\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?", cuerpo + " " + str(d.get("url") or ""))
        print("documentos en el cuerpo:", docs)
        print("cuerpo html:", cuerpo[:1500])
        for ida, an, otro in docs:
            for u, datos in [(f"{VISOR}/bajarArchivo", {"accion": "archivo", "idMensaje": cod, "idArchivo": ida, "sistema": an if an != "0" else sis}),
                             (f"{VISOR}/bajarArchivo/{ida}/{an}/{sis}/{ruc}", None), (f"{VISOR}/bajarArchivo/{ida}/0/{sis}/{ruc}", None),
                             (f"{VISOR}/bajarArchivo/{ida}/0/{bz.id_sistema}/{ruc}", None)]:
                try:
                    st, b = sol.pedir(u, datos, headers={"Referer": bz.h["Referer"]}, binario=True, intentos=1)
                    print("  DOC", u.replace(VISOR, "visor"), datos, "→", firma(st, b))
                except Exception as e:
                    print("  DOC", u.replace(VISOR, "visor"), datos, "→ error", str(e)[:100])
        for a in d.get("listAttach") or []:
            ca = a.get("codArchivo")
            if not ca:
                continue
            for u, datos in [(f"{VISOR}/bajarArchivo", {"accion": "archivo", "idMensaje": cod, "idArchivo": ca, "sistema": sis}),
                             (f"{VISOR}/bajarArchivo", {"cod_arch": ca, "anexo": 0, "sistema": sis})]:
                try:
                    st, b = sol.pedir(u, datos, headers={"Referer": bz.h["Referer"]}, binario=True, intentos=1)
                    print("  POST", datos, "→", firma(st, b))
                except Exception as e:
                    print("  POST", datos, "→ error", str(e)[:100])
            pruebas = [
                f"{VISOR}/bajarArchivo/{ca}/0/{sis}/{ruc}",
                f"{VISOR}/bajarArchivo/{ca}/1/{sis}/{ruc}",
                f"{VISOR}/bajarArchivo?accion=archivo&idMensaje={cod}&idArchivo={ca}&sistema={sis}",
                f"{VISOR}/bajarArchivo/{ca}/0/{bz.id_sistema}/{ruc}",
                f"{VISOR}/bajarArchivo/{ca}/1/{bz.id_sistema}/{ruc}",
                f"{VISOR}/bajarArchivo?accion=archivo&idMensaje={cod}&idArchivo={ca}",
                f"{VISOR}/bajarArchivo?accion=archivo&idMensaje={cod}&codArchivo={ca}",
                f"{VISOR}/bajarArchivo?accion=archivo&idMensaje={cod}&idArchivo={ca}&indicadorMsg=0",
                f"{VISOR}/bajarArchivo?accion=archivo&idArchivo={ca}&idMensaje={cod}&idAnexo=0",
            ]
            for u in pruebas:
                try:
                    st, b = sol.pedir(u, headers={"Referer": bz.h["Referer"]}, binario=True, intentos=1)
                    print(" ", u.replace(VISOR, "visor"), "→", firma(st, b))
                except Exception as e:
                    print(" ", u.replace(VISOR, "visor"), "→ error", str(e)[:100])


if __name__ == "__main__":
    main()
