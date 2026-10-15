"""
descargar_buzon.py — Proyecto "Notificaciones · Grupo".

Descarga del Buzón Electrónico de SUNAT SOL de UNA empresa:
  - la lista completa de NOTIFICACIONES (órdenes de pago, resoluciones de
    ejecución coactiva, cartas, requerimientos, etc.) y de MENSAJES, y
  - opcional: los PDF adjuntos de cada notificación (constancia y documento).

    notificaciones/datos/<RUC>/notificaciones.csv     un renglón por notificación
    notificaciones/datos/<RUC>/mensajes.csv           un renglón por mensaje
    notificaciones/datos/<RUC>/<AAAA>/<MM>/<código>-<archivo>.pdf

Rutas en SUNAT (las mismas que usa la página del buzón):
  visor/listNotiMenPag    lista paginada (tipoMsj 2 = notificaciones, 1 = mensajes)
  visor/obtenerDetalleNotiMen + visor/bajarArchivo   adjuntos (solo si se piden PDF)

OJO: abrir el detalle para bajar el PDF lo marca como "leído" en SOL, igual que
si una persona lo abriera. La notificación surte efecto desde su depósito en el
buzón (día hábil siguiente), se lea o no. La lista sola NO marca nada.

Las claves SOL llegan por variables de entorno (SUNAT_RUC, SUNAT_USUARIO,
SUNAT_CLAVE) y nunca se imprimen.

Uso:  python descargar_buzon.py [--desde 202601 | 15/03/2026] [--salida notificaciones/datos] [--sin-pdf] [--pdf-mensajes]
      --desde: solo lo publicado desde ese mes (AAAAMM) o fecha (dd/mm/aaaa). Vacío = todo.
"""
import argparse
import csv
import html
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "retenciones", "scripts"))
from descargar_cre import Sol, MENU  # noqa: E402

VISOR = "https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor"
COLS = ["empresa_ruc", "tipo", "codigo", "fecha_publicacion", "fecha_envio", "asunto", "clase", "documento",
        "etiqueta", "leido", "urgente", "destacado", "remitente", "dependencia", "adjuntos", "archivos"]
CLASES = [
    (r"ejecuci[oó]n coactiva", "Resolución de Ejecución Coactiva"),
    (r"orden(es)? de pago", "Orden de Pago"),
    (r"resoluci[oó]n de determinaci[oó]n", "Resolución de Determinación"),
    (r"resoluci[oó]n de multa", "Resolución de Multa"),
    (r"conclusi[oó]n", "Resolución de Conclusión"),
    (r"fraccionamiento|aplazamiento", "Fraccionamiento"),
    (r"requerimiento", "Requerimiento"),
    (r"esquela", "Esquela"),
    (r"carta", "Carta"),
    (r"embargo|retenci[oó]n bancaria", "Embargo"),
    (r"devoluci[oó]n", "Devolución"),
    (r"compensaci[oó]n", "Compensación"),
    (r"error material", "Error material"),
    (r"resoluci[oó]n", "Otra resolución"),
]


def arreglar(s):
    """Algunos asuntos llegan con tildes rotas (NotificaciÃ³n) o con &oacute;."""
    s = html.unescape(str(s or ""))
    if "Ã" in s or "Â" in s:
        try:
            s = s.encode("latin-1").decode("utf-8")
        except Exception:
            pass
    return re.sub(r"\s+", " ", s).strip()


def clase(asunto):
    for patron, nombre in CLASES:
        if re.search(patron, asunto, re.I):
            return nombre
    return "Otro"


def documento(asunto):
    m = re.search(r"N[°º]?\s*[:.]?\s*([0-9][0-9A-Z\-]{5,})", asunto, re.I)
    return m.group(1) if m else ""


class Buzon:
    def __init__(self, sol, ruc):
        self.sol, self.ruc = sol, ruc
        sol.pedir(MENU, {"action": "prevApp"})
        st, master = sol.pedir(f"{MENU}?action=buzon&s=ww1")
        if "visornoti" not in sol.ultima_url:
            raise RuntimeError("No se pudo abrir el Buzón Electrónico")
        tok = re.search(r'name="meta-token" content="([^"]+)"', master)
        self.h = {"X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01",
                  "Referer": sol.ultima_url}
        if tok:
            self.h["X-CSRF-TOKEN"] = tok.group(1)
        m = re.search(r'id="idSistema"[^>]*value="([^"]*)"', master) or re.search(r'value="([^"]*)"[^>]*id="idSistema"', master)
        self.id_sistema = m.group(1) if m else "1"
        self.etiquetas = {}
        m = re.search(r"listEtiquetas\s*=\s*(\[.*?\]);", master, re.S)
        if m:
            try:
                for e in json.loads(m.group(1)):
                    self.etiquetas[str(e.get("codEtiqueta"))] = arreglar(e.get("descEtiqueta"))
            except Exception:
                pass
        for c, d in re.findall(r"id=['\"]Etiq_(\w+)['\"][^>]*name=['\"]([^'\"]+)['\"]", master):
            self.etiquetas.setdefault(c, arreglar(d))

    def lista(self, tipo, desde=None):
        """La lista viene de la más reciente a la más antigua: se corta al pasar la fecha 'desde'."""
        filas, pagina, total = [], 1, 1
        while pagina <= total:
            st, t = self.sol.pedir(f"{VISOR}/listNotiMenPag?tipoMsj={tipo}&codCarpeta=00&codEtiqueta=&page={pagina}"
                                   f"&des_asunto=&codMensaje=&tipoOrden=NADA", headers=self.h)
            d = json.loads(t)
            total = int(d.get("total") or 1)
            rows = d.get("rows") or []
            if desde:
                dentro = [r for r in rows if (fecha_clave(r.get("fecPublica")) or "99999999") >= desde]
                filas += dentro
                if len(dentro) < len(rows):
                    break
            else:
                filas += rows
            pagina += 1
            time.sleep(0.5)
        return filas

    def adjuntos(self, cod, tipo):
        st, t = self.sol.pedir(f"{VISOR}/obtenerDetalleNotiMen?codigoMensaje={cod}&tipoMsj={tipo}", headers=self.h)
        d = json.loads(t)
        anexo = 1 if d.get("tieneDocumentosAnexos") else 0
        lista = [(a["codArchivo"], a.get("nomArchivo") or "archivo.pdf", anexo)
                 for a in (d.get("listAttach") or []) if a.get("codArchivo")]
        if not lista:
            print(f"   {cod}: SUNAT no lista adjuntos (HTTP {st}; campos: {sorted(d.keys())[:15]})")
        return lista

    def bajar(self, cod_archivo, anexo, nombre=""):
        """Devuelve (bytes, extensión) o (None, motivo). Prueba el tipo de anexo indicado y el otro,
        y acepta cualquier archivo (PDF, ZIP, imagen…), no solo PDF."""
        motivo = ""
        for intento in range(3):
            for an in (anexo, 1 - anexo):
                st, b = self.sol.pedir(f"{VISOR}/bajarArchivo/{cod_archivo}/{an}/{self.id_sistema}/{self.ruc}",
                                       headers={"Referer": self.h["Referer"]}, binario=True)
                if st == 200 and b:
                    if b[:4] == b"%PDF":
                        return b, ".pdf"
                    if b[:2] == b"PK":
                        return b, ".zip"
                    if b[:3] == b"\xff\xd8\xff":
                        return b, ".jpg"
                    if b[:8] == b"\x89PNG\r\n\x1a\n":
                        return b, ".png"
                    cab = b[:300].decode("utf-8", errors="ignore").lower()
                    if "<html" not in cab and "<!doctype" not in cab and len(b) > 200:
                        ext = os.path.splitext(nombre)[1].lower() or ".bin"
                        return b, ext
                    motivo = f"HTTP {st}, respondió una página en vez del archivo: {' '.join(cab.split())[:120]}"
                else:
                    motivo = f"HTTP {st}, {len(b or b'')} bytes"
            time.sleep(2 * (intento + 1))
        return None, motivo

def fecha_clave(s):
    """'05/10/2026 21:34:56' → '20261005'."""
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", str(s or ""))
    return f"{m.group(3)}{m.group(2)}{m.group(1)}" if m else ""


def desde_clave(s):
    """'202601' → '20260101'; '15/03/2026' → '20260315'; vacío → None."""
    s = (s or "").strip()
    if not s:
        return None
    if re.fullmatch(r"\d{6}", s):
        return s + "01"
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}{int(m.group(2)):02d}{int(m.group(1)):02d}"
    if re.fullmatch(r"\d{8}", s):
        return s
    raise SystemExit(f"--desde no válido: {s} (use AAAAMM o dd/mm/aaaa)")


def nombre_archivo(s):
    return re.sub(r"[^\w.\-]+", "_", s)[:80]


def leer_previo(ruta):
    if not os.path.exists(ruta):
        return {}
    with open(ruta, encoding="utf-8") as f:
        return {r["codigo"]: r for r in csv.DictReader(f)}


def guardar(ruta, filas):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    filas.sort(key=lambda r: (r["fecha_publicacion"][6:10], r["fecha_publicacion"][3:5], r["fecha_publicacion"][:2],
                              r["fecha_publicacion"][11:]), reverse=True)
    with open(ruta, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        for r in filas:
            w.writerow({k: r.get(k, "") for k in COLS})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default="notificaciones/datos")
    ap.add_argument("--desde", default="", help="AAAAMM o dd/mm/aaaa; vacío = todo")
    ap.add_argument("--sin-pdf", action="store_true", help="no abrir notificaciones ni bajar sus PDF")
    ap.add_argument("--pdf-mensajes", action="store_true", help="bajar también los adjuntos de los MENSAJES")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    sol = Sol()
    sol.login(ruc, usuario, clave)
    bz = Buzon(sol, ruc)
    carpeta = os.path.join(a.salida, ruc)
    desde = desde_clave(a.desde)
    print(f"Empresa {ruc}: buzón abierto. Desde: {desde or 'todo'}. PDF de notificaciones: {'no' if a.sin_pdf else 'sí'}")
    for tipo, nombre, con_pdf in [("2", "notificaciones", not a.sin_pdf), ("1", "mensajes", a.pdf_mensajes)]:
        ruta = os.path.join(carpeta, f"{nombre}.csv")
        previo = leer_previo(ruta)
        filas, nuevas, pdfs = [], 0, 0
        for r in bz.lista(tipo, desde):
            cod = str(r.get("codMensaje"))
            asunto = arreglar(r.get("desAsunto"))
            fila = {
                "empresa_ruc": ruc, "tipo": "Notificación" if tipo == "2" else "Mensaje", "codigo": cod,
                "fecha_publicacion": r.get("fecPublica") or "", "fecha_envio": r.get("fecEnvio") or "",
                "asunto": re.sub(r"^ASUNTO:\s*", "", asunto), "clase": clase(asunto), "documento": documento(asunto),
                "etiqueta": bz.etiquetas.get(str(r.get("codEtiqueta")), "") if str(r.get("codEtiqueta")) != "00" else "",
                "leido": "SI" if str(r.get("indEstado")) == "1" else "NO", "urgente": "SI" if r.get("indUrg") else "",
                "destacado": "SI" if r.get("indDesta") else "", "remitente": r.get("codUsremisor") or "",
                "dependencia": r.get("codDepen") or "", "adjuntos": r.get("cantidadArchAdj") or 0,
                "archivos": (previo.get(cod) or {}).get("archivos", ""),
            }
            if cod not in previo:
                nuevas += 1
            if con_pdf and int(fila["adjuntos"] or 0) > 0 and not fila["archivos"]:
                f = fila["fecha_publicacion"]
                sub = f"{f[6:10]}/{f[3:5]}" if len(f) >= 10 else "sin_fecha"
                guardados = []
                try:
                    for cod_arch, nom, anexo in bz.adjuntos(cod, tipo):
                        b, ext = bz.bajar(cod_arch, anexo, nom)
                        if not b:
                            print(f"   {cod} ({fila['clase']}): no se pudo bajar '{nom}' ({ext}); se reintenta en la próxima corrida")
                            continue
                        rel = f"{ruc}/{sub}/{cod}-{nombre_archivo(nom)}"
                        if not rel.lower().endswith(ext):
                            rel = re.sub(r"\.(pdf|bin)$", "", rel, flags=re.I) + ext
                        os.makedirs(os.path.dirname(os.path.join(a.salida, rel)), exist_ok=True)
                        open(os.path.join(a.salida, rel), "wb").write(b)
                        guardados.append(rel)
                        pdfs += 1
                except Exception as e:
                    print(f"   {cod}: no se pudo bajar el adjunto ({e})")
                fila["archivos"] = ";".join(guardados)
            filas.append(fila)
        vistos = {f["codigo"] for f in filas}
        filas += [r for c, r in previo.items() if c not in vistos and desde and fecha_clave(r.get("fecha_publicacion")) < desde]
        guardar(ruta, filas)
        print(f"  {nombre}: {len(filas)} (nuevas {nuevas})" + (f" · PDF bajados {pdfs}" if con_pdf else ""))


if __name__ == "__main__":
    main()
