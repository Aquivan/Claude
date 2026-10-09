"""
descargar_cre.py — Proyecto "Retenciones · Grupo".

Descarga de SUNAT (SOL) los Comprobantes de Retención Electrónicos (CRE)
EMITIDOS y RECIBIDOS de UNA empresa para UN periodo (mes) y los guarda en:

    retenciones/datos/<RUC>/<AAAAMM>_cre.csv       (un renglón por CRE)
    retenciones/datos/<RUC>/<AAAAMM>_detalle.csv   (un renglón por factura retenida)

Solo LEE en SUNAT (consulta "Consultar Emisión y Recepción" de SOL). No emite,
no revierte ni modifica nada. Las claves SOL llegan por variables de entorno
(SUNAT_RUC, SUNAT_USUARIO, SUNAT_CLAVE) y nunca se imprimen.

Uso:  python descargar_cre.py --periodo 202609 [--salida retenciones/datos] [--diagnostico]
"""
import argparse
import calendar
import csv
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
MENU = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
STATE = ("rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==")
CODIGO_MENU_CRE = "11.9.7.1.1"   # Consulta de Comprobante de Retención (emitidos y recibidos)
BASE_CRE = "https://ww1.sunat.gob.pe/ol-ti-itcpretencion/consulta"
TIMEOUT = 40


class Sol:
    """Sesion de SOL con cookies, reintentos y pausas cortas entre pedidos."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.ultima_url = ""

    def pedir(self, url, datos=None, headers=None, intentos=4):
        if isinstance(datos, dict):
            datos = urllib.parse.urlencode(datos).encode("utf-8")
        h = {"User-Agent": UA}
        h.update(headers or {})
        error = None
        for i in range(1, intentos + 1):
            try:
                req = urllib.request.Request(url, data=datos, headers=h)
                with self.op.open(req, timeout=TIMEOUT) as r:
                    self.ultima_url = r.geturl()
                    return r.status, r.read().decode("utf-8", errors="ignore")
            except urllib.error.HTTPError as e:
                cuerpo = e.read().decode("utf-8", errors="ignore")
                if e.code < 500 or i == intentos:
                    return e.code, cuerpo
                error = f"HTTP {e.code}"
            except Exception as e:  # timeouts, conexiones cortadas
                error = str(e)
            time.sleep(5 * i)
        raise RuntimeError(f"SUNAT no respondió en {url.split('?')[0]} tras {intentos} intentos ({error})")

    def login(self, ruc, usuario, clave):
        self.pedir(f"{SEC}/loginMenuSol?lang=es-PE&showDni=true&showLanguages=false"
                   f"&originalUrl={ORIG}&state={STATE}")
        _, t = self.pedir(f"{SEC}/j_security_check", {
            "tipo": "2", "dni": "", "custom_ruc": ruc, "j_username": usuario, "j_password": clave,
            "captcha": "", "originalUrl": ORIG, "state": STATE})
        if "Men" not in t:
            raise RuntimeError("Login SOL fallido (revisa las claves del Environment de esta empresa)")

    def abrir_opcion(self, codigo):
        self.pedir(MENU, {"action": "prevApp"})
        _, t = self.pedir(f"{MENU}?action=execute&code={codigo}")
        return t


def rango_mes(periodo):
    a, m = int(periodo[:4]), int(periodo[4:])
    ultimo = calendar.monthrange(a, m)[1]
    return f"01/{m:02d}/{a}", f"{ultimo:02d}/{m:02d}/{a}"


def texto(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def valores_combos(pagina):
    """Lee de la pagina los valores validos de tipo de documento y estado (si vienen en el HTML/JS)."""
    res = {}
    for nombre in ["lstTipoDocumento", "lstTipoEstado", "lstRegiPercep"]:
        m = re.search(nombre + r"\s*=\s*(\[.*?\]|\{.*?\})\s*;", pagina, re.S)
        if m:
            try:
                res[nombre] = json.loads(m.group(1))
            except Exception:
                res[nombre] = m.group(1)[:300]
    return res


def buscar(sol, tipo, fini, ffin, tipo_doc, estado):
    st, t = sol.pedir(f"{BASE_CRE}/buscarComprobanteEmiRec", {
        "opcionTipoCompReten": tipo, "tipoDocReceptor": tipo_doc, "numDocReceptor": "",
        "serieCompReten": "", "numeroCompReten": "", "fechaInicio": fini, "fechaFin": ffin,
        "estadoCompReten": estado,
    }, {"X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE_CRE}/iniConsulComp",
        "Accept": "application/json, text/javascript, */*; q=0.01"}, intentos=2)
    try:
        return st, json.loads(t)
    except Exception:
        return st, {"_error": texto(t)[:300]}


def detalle(sol, cre):
    q = urllib.parse.urlencode({k: str(cre.get(k, "")).strip() for k in ["codCpe", "numSerieCpe", "numCpe", "numRuc"]})
    _, t = sol.pedir(f"{BASE_CRE}/cargarDetalleComprobante?{q}", headers={"Referer": f"{BASE_CRE}/iniConsulComp"})
    try:
        return json.loads(t)
    except Exception:
        pass
    # HTML: tomar la(s) tabla(s) como filas de texto
    filas = []
    for tabla in re.findall(r"<table.*?</table>", t, re.S | re.I):
        cab = [texto(x) for x in re.findall(r"<th[^>]*>(.*?)</th>", tabla, re.S | re.I)]
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tabla, re.S | re.I):
            celdas = [texto(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)]
            if celdas:
                filas.append(dict(zip(cab, celdas)) if cab and len(cab) == len(celdas) else {"celdas": celdas})
    return {"_html_filas": filas, "_html_len": len(t)}


def plano(d, pref=""):
    """Aplana un dict (para CSV)."""
    out = {}
    for k, v in (d or {}).items():
        if isinstance(v, dict):
            out.update(plano(v, pref + k + "."))
        elif isinstance(v, list):
            out[pref + k] = json.dumps(v, ensure_ascii=False)
        else:
            out[pref + k] = v
    return out


def guardar_csv(ruta, filas):
    if not filas:
        return
    campos = []
    for f in filas:
        for k in f:
            if k not in campos:
                campos.append(k)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=campos)
        w.writeheader()
        for f in filas:
            w.writerow(f)


def periodos(desde, hasta):
    a, m = int(desde[:4]), int(desde[4:])
    fin = int(hasta)
    while a * 100 + m <= fin:
        yield f"{a}{m:02d}"
        m += 1
        if m > 12:
            a, m = a + 1, 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--periodo", required=True, help="AAAAMM (primer mes)")
    ap.add_argument("--hasta", default="", help="AAAAMM ultimo mes (vacio = solo --periodo)")
    ap.add_argument("--salida", default="retenciones/datos")
    ap.add_argument("--diagnostico", action="store_true", help="muestra estructura (sin nombres ni montos)")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    lista_periodos = list(periodos(a.periodo, a.hasta or a.periodo))
    if not lista_periodos or len(lista_periodos) > 24:
        sys.exit("Rango de periodos invalido (maximo 24 meses)")

    sol = Sol()
    sol.login(ruc, usuario, clave)
    print("Login OK")
    pagina = sol.abrir_opcion(CODIGO_MENU_CRE)
    print("Consulta CRE abierta:", sol.ultima_url.split("?")[0], f"({len(pagina)} caracteres)")
    if a.diagnostico:
        combos = valores_combos(pagina)
        print("Estados posibles:", json.dumps(combos.get("lstTipoEstado"), ensure_ascii=False)[:600])

    # "-" = "todos" en ambos filtros (confirmado en la prueba del 09/10/2026;
    # con valores vacios SUNAT responde HTTP 500).
    candidatos = [("-", "-"), ("6", "-"), ("-", "0")]
    elegido = None
    errores = 0
    resumen_total = {}
    for periodo in lista_periodos:
        fini, ffin = rango_mes(periodo)
        cabeceras, detalles, resumen = [], [], {}
        for tipo in ["emitido", "recibido"]:
            lista = None
            for td, es in ([elegido] if elegido else candidatos):
                st, d = buscar(sol, tipo, fini, ffin, td, es)
                ok = isinstance(d, dict) and "listaCompRetencion" in d
                if not ok:
                    print(f"  {periodo} {tipo}: tipoDoc='{td}' estado='{es}' -> HTTP {st} {d.get('_error', '')[:120]}")
                    time.sleep(2)
                    continue
                elegido = (td, es)
                lista = d.get("listaCompRetencion") or []
                break
            if lista is None:
                resumen[tipo] = "ERROR"
                errores += 1
                continue
            resumen[tipo] = len(lista)
            if a.diagnostico and lista:
                print(f"    campos de cada CRE ({tipo}):", sorted(lista[0].keys()))
            for cre in lista:
                fila = {"empresa_ruc": ruc, "periodo": periodo, "tipo": tipo}
                fila.update(plano(cre))
                cabeceras.append(fila)
                time.sleep(1)
                det = detalle(sol, cre)
                if a.diagnostico and not detalles:
                    print("    estructura del detalle:", json.dumps(
                        {k: (sorted(v[0].keys()) if isinstance(v, list) and v and isinstance(v[0], dict) else type(v).__name__)
                         for k, v in (det.items() if isinstance(det, dict) else [])}, ensure_ascii=False)[:800])
                items = []
                if isinstance(det, dict):
                    for v in det.values():
                        if isinstance(v, list) and v and isinstance(v[0], dict):
                            items = v
                            break
                for it in items:
                    f = {"empresa_ruc": ruc, "periodo": periodo, "tipo": tipo,
                         "cre_serie": str(cre.get("numSerieCpe", "")).strip(), "cre_numero": str(cre.get("numCpe", "")).strip(),
                         "cre_ruc_emisor": str(cre.get("numRuc", "")).strip()}
                    f.update(plano(it))
                    detalles.append(f)
            time.sleep(1)
        carpeta = os.path.join(a.salida, ruc)
        guardar_csv(os.path.join(carpeta, f"{periodo}_cre.csv"), cabeceras)
        guardar_csv(os.path.join(carpeta, f"{periodo}_detalle.csv"), detalles)
        resumen["lineas_detalle"] = len(detalles)
        resumen_total[periodo] = resumen
        print(f"{periodo}: emitidos={resumen.get('emitido')} recibidos={resumen.get('recibido')} lineas_detalle={len(detalles)}")

    print("RESUMEN", json.dumps({"ruc": ruc, "meses": resumen_total}, ensure_ascii=False))
    if errores:
        sys.exit(2)


if __name__ == "__main__":
    main()
