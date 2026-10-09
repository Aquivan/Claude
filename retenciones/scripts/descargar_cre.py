"""
descargar_cre.py — Proyecto "Retenciones · Grupo".

Descarga de SUNAT (SOL) los Comprobantes de Retención Electrónicos (CRE)
EMITIDOS y RECIBIDOS de UNA empresa, mes por mes, con su PDF y XML oficiales,
y los deja ordenados igual que SIRE:

    retenciones/datos/<RUC>/<AAAA>/<MM>/cre.csv        un renglón por comprobante de retención
    retenciones/datos/<RUC>/<AAAA>/<MM>/detalle.csv    un renglón por factura retenida (sacado del XML)
    retenciones/datos/<RUC>/<AAAA>/<MM>/pdf/<RUC emisor>-<serie>-<número>.pdf
    retenciones/datos/<RUC>/<AAAA>/<MM>/xml/<RUC emisor>-<serie>-<número>.xml

Rutas en SUNAT (solo LECTURA, no emite ni revierte nada):
  - Lista:  menú 11.9.7.1.1 "Consulta del comprobante de retención electrónico"
            (los filtros "TODOS" de esa pantalla se envían como "000").
  - PDF/XML: API de consultas de comprobantes (menú 11.38.1.1.1), código 20 =
            Comprobante de Retención; es la misma vía que usa la descarga de facturas.

Las claves SOL llegan por variables de entorno (SUNAT_RUC, SUNAT_USUARIO,
SUNAT_CLAVE) y nunca se imprimen.

Uso:  python descargar_cre.py --periodo 202601 [--hasta 202609] [--salida retenciones/datos]
                              [--sin-archivos] [--diagnostico]
      (--hasta vacío = hasta el mes actual)
"""
import argparse
import base64
import calendar
import csv
import html
import http.cookiejar
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta, timezone

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
MENU = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
STATE = ("rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==")
CODIGO_MENU_CRE = "11.9.7.1.1"     # Consulta del comprobante de retención electrónico
CODIGO_MENU_API = "11.38.1.1.1"    # Consulta de comprobantes (da el token de la API de PDF/XML)
BASE_CRE = "https://ww1.sunat.gob.pe/ol-ti-itcpretencion/consulta"
API_CPE = "https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe/comprobantes"
TIMEOUT = 40
LIMA = timezone(timedelta(hours=-5))

REGIMENES = {"01": "Tasa 3%", "02": "Tasa 6%"}
TIPOS_DOC = {"01": "Factura", "03": "Boleta", "07": "Nota de crédito", "08": "Nota de débito",
             "12": "Ticket", "20": "Comprobante de retención"}

COLS_CRE = ["empresa_ruc", "tipo", "periodo", "fecha_emision", "comprobante", "serie", "numero",
            "ruc_agente", "agente", "ruc_proveedor", "proveedor", "regimen", "tasa",
            "importe_retenido", "importe_pagado", "moneda", "estado", "facturas", "correo_receptor",
            "pdf", "xml", "observacion"]
COLS_DET = ["empresa_ruc", "tipo", "periodo", "comprobante", "fecha_retencion", "ruc_agente",
            "ruc_proveedor", "proveedor", "doc_tipo", "doc_numero", "doc_fecha", "doc_moneda",
            "doc_importe_total", "pago_numero", "pago_fecha", "pago_importe", "tipo_cambio",
            "importe_retenido", "importe_pagado_neto"]


class SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class Sol:
    """Sesión de SOL con cookies, reintentos y pausas cortas entre pedidos."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.op_sin = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), SinRedireccion)
        self.ultima_url = ""

    def pedir(self, url, datos=None, headers=None, intentos=4, binario=False):
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
                    cuerpo = r.read()
                    return r.status, cuerpo if binario else cuerpo.decode("utf-8", errors="ignore")
            except urllib.error.HTTPError as e:
                cuerpo = e.read().decode("utf-8", errors="ignore")
                if e.code < 500 or i == intentos:
                    return e.code, cuerpo
                error = f"HTTP {e.code}"
            except Exception as e:  # timeouts, conexiones cortadas
                error = str(e)
            time.sleep(5 * i)
        raise RuntimeError(f"SUNAT no respondió en {url.split('?')[0]} tras {intentos} intentos ({error})")

    def ubicacion(self, url):
        """Devuelve la cabecera Location (sin seguir la redirección)."""
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with self.op_sin.open(req, timeout=TIMEOUT) as r:
                return r.headers.get("Location", "")
        except urllib.error.HTTPError as e:
            return e.headers.get("Location", "")

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

    def token_api(self):
        self.pedir(MENU, {"action": "prevApp"})
        loc = self.ubicacion(f"{MENU}?action=execute&code={CODIGO_MENU_API}")
        m = re.search(r"token=([^&]+)", loc or "")
        return urllib.parse.unquote(m.group(1)) if m else ""


# ---------------------------------------------------------------- utilidades

def periodos(desde, hasta):
    a, m = int(desde[:4]), int(desde[4:])
    fin = int(hasta)
    while a * 100 + m <= fin:
        yield f"{a}{m:02d}"
        m += 1
        if m > 12:
            a, m = a + 1, 1


def rango_mes(periodo):
    a, m = int(periodo[:4]), int(periodo[4:])
    return f"01/{m:02d}/{a}", f"{calendar.monthrange(a, m)[1]:02d}/{m:02d}/{a}"


def texto(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def fecha_ms(v):
    try:
        return datetime.fromtimestamp(float(v) / 1000, LIMA).strftime("%d/%m/%Y")
    except Exception:
        return str(v or "").strip()


def fecha_iso(s):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s or "")
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else (s or "")


def estados_de_pagina(pagina):
    """Busca en el JavaScript de la página la lista de estados (EMITIDO, REVERTIDO...)."""
    for m in re.finditer(r"\[\{[^\[\]]*?REVERTIDO[^\[\]]*?\}\]", pagina, re.S | re.I):
        try:
            return {str(x.get("codigo", "")).strip(): str(x.get("descripcionCorta") or x.get("descripcion") or "").strip()
                    for x in json.loads(m.group(0))}
        except Exception:
            continue
    return {}


def buscar(sol, tipo, fini, ffin, serie=""):
    st, t = sol.pedir(f"{BASE_CRE}/buscarComprobanteEmiRec", {
        "opcionTipoCompReten": tipo, "tipoDocReceptor": "000", "numDocReceptor": "",
        "serieCompReten": serie, "numeroCompReten": "", "fechaInicio": fini, "fechaFin": ffin,
        "estadoCompReten": "000",
    }, {"X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE_CRE}/iniConsulComp",
        "Accept": "application/json, text/javascript, */*; q=0.01"}, intentos=3)
    try:
        return st, json.loads(t)
    except Exception:
        return st, {"_error": texto(t)[:300]}


def bajar_archivo(sol, token, id_api, accion):
    """accion 01 = PDF, 02 = XML. Devuelve los bytes del archivo (sacado del zip) o None."""
    for intento in range(5):
        st, t = sol.pedir(f"{API_CPE}/{id_api}/{accion}?formato=x", headers={
            "Authorization": f"Bearer {token}", "Accept": "application/json, text/plain, */*",
            "Origin": "https://e-factura.sunat.gob.pe", "Referer": "https://e-factura.sunat.gob.pe/"},
            intentos=1)
        try:
            d = json.loads(t)
            raw = base64.b64decode(d["valArchivo"])
            try:
                zf = zipfile.ZipFile(io.BytesIO(raw))
                return zf.read(zf.namelist()[0])
            except zipfile.BadZipFile:
                return raw
        except Exception:
            time.sleep(4)
    return None


def detalle_html(sol, cre, diagnostico=False):
    """Respaldo cuando SUNAT no entrega el XML: detalle desde la pantalla de SUNAT."""
    q = urllib.parse.urlencode({k: str(cre.get(k, "")).strip() for k in ["codCpe", "numSerieCpe", "numCpe", "numRuc"]})
    _, t = sol.pedir(f"{BASE_CRE}/cargarDetalleComprobante?{q}", headers={"Referer": f"{BASE_CRE}/iniConsulComp"}, intentos=2)
    try:
        d = json.loads(t)
        tablas = [v for v in (d.values() if isinstance(d, dict) else []) if isinstance(v, list) and v and isinstance(v[0], dict)]
        filas_json = tablas[0] if tablas else []
        if diagnostico:
            print("    detalle (JSON) campos:", sorted(filas_json[0].keys()) if filas_json else list(d)[:20])
        return [{k: (fecha_ms(v) if k.lower().startswith("fec") and isinstance(v, (int, float)) else v) for k, v in f.items()}
                for f in filas_json], True
    except Exception:
        pass
    salida, cab = [], []
    for tabla in re.findall(r"<table.*?</table>", t, re.S | re.I):
        cab = [texto(x) for x in re.findall(r"<th[^>]*>(.*?)</th>", tabla, re.S | re.I)]
        utiles = [c for c in cab if c]
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tabla, re.S | re.I):
            celdas = [texto(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)]
            if utiles and len(celdas) >= len(utiles):
                salida.append(dict(zip(utiles, celdas)))
    if not salida:
        # Las filas vienen en una variable JavaScript (lista de objetos) que la pantalla dibuja.
        for m in re.finditer(r"(\[\s*\{.*?\}\s*\])\s*[;,)]", t, re.S):
            try:
                lista = json.loads(m.group(1))
            except Exception:
                continue
            if lista and isinstance(lista[0], dict) and len(lista[0]) >= 4:
                salida = [{k: (fecha_ms(v) if "fec" in k.lower() and isinstance(v, (int, float)) else v) for k, v in f.items()}
                          for f in lista]
                break
    if diagnostico:
        print("    detalle de pantalla: columnas", [c for c in cab if c], "| filas", len(salida),
              "| campos", sorted(salida[0].keys()) if salida else "-")
        if not salida:
            i = t.find("<tbody")
            print("    (fragmento)", re.sub(r"\s+", " ", t[i:i + 600] if i >= 0 else t[:600]))
    return salida, False


def mapear_detalle(fila):
    """Lleva una fila del detalle de pantalla (nombres de SUNAT) a las columnas de detalle.csv."""
    def norm(k):
        return re.sub(r"[^a-z]", "", html.unescape(k).lower().translate(str.maketrans("áéíóúñ", "aeioun")))
    out = {}
    serie = numero = ""
    for k, v in fila.items():
        n, v = norm(k), str(v if v is not None else "").strip()
        if not v:
            continue
        if "tipocambio" in n:
            out["tipo_cambio"] = v
        elif "pago" in n and ("nro" in n or "numero" in n or n.startswith("num")):
            out["pago_numero"] = v
        elif "tasa" in n:
            continue
        elif "neto" in n:
            out["importe_pagado_neto"] = v
        elif ("retenid" in n or "retencion" in n or "mtoret" in n) and "fecha" not in n:
            out["importe_retenido"] = v
        elif "fecha" in n and "pago" in n:
            out["pago_fecha"] = v
        elif "fecha" in n and "retencion" in n:
            out["fecha_retencion"] = v
        elif "fecha" in n:
            out.setdefault("doc_fecha", v)
        elif "moneda" in n:
            out["doc_moneda"] = v
        elif ("pago" in n or "pagado" in n) and ("monto" in n or "importe" in n):
            out["pago_importe"] = v
        elif ("total" in n or "importe" in n or "monto" in n) and "pago" not in n:
            out.setdefault("doc_importe_total", v)
        elif "tipo" in n:
            out["doc_tipo"] = TIPOS_DOC.get(v, v)
        elif "serie" in n and ("numero" in n or "nro" in n):
            out["doc_numero"] = v
        elif "serie" in n:
            serie = v
        elif "numero" in n or n.startswith("nro"):
            numero = v
    if serie or numero:
        out.setdefault("doc_numero", f"{serie}-{numero}".strip("-"))
    return out


# ------------------------------------------------------------------- PDF

def _monto(t):
    """'S/ 64200.00' -> ('PEN', '64200.00');  '$ 1545.63' -> ('USD', ...);  'null 0.00' -> ('', '')"""
    t = (t or "").strip()
    if t.lower().startswith("null"):
        return "", ""
    moneda = "USD" if t.startswith(("$", "US$", "USD")) else ("PEN" if t.startswith("S/") else "")
    m = re.search(r"-?[\d,]+(?:\.\d+)?", t)
    return moneda, (m.group(0).replace(",", "") if m else "")


def leer_pdf(ruta):
    """Lee el PDF oficial del CRE (cuando SUNAT no entrega un XML válido). Devuelve (cabecera, [facturas])."""
    try:
        txt = subprocess.run(["pdftotext", "-layout", ruta, "-"], capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return {}, []
    if not txt.strip():
        return {}, []
    cab = {}
    m = re.search(r"Se[ñn]or\(es\):\s+(.+)", txt)
    if m:
        cab["receptor"] = m.group(1).strip()
    m = re.search(r"Identificaci[óo]n:\s+\S*?-?(\d{8,11})", txt)
    if m:
        cab["ruc_receptor"] = m.group(1)
    m = re.search(r"R[ée]gimen retenci[óo]n:+\s+(.+)", txt)
    if m:
        cab["regimen"] = m.group(1).strip().title()
        t = re.search(r"(\d+(?:\.\d+)?)\s*%", m.group(1))
        if t:
            cab["tasa"] = t.group(1)
    lineas = txt.splitlines()
    for i, l in enumerate(lineas):
        if re.search(r"RUC:\s*\d{11}", l):
            for sig in lineas[i + 1:i + 4]:
                nombre = re.split(r"\s{2,}", sig.strip())[0] if sig.strip() else ""
                if nombre and not re.search(r"COMPROBANTE", nombre):
                    cab["emisor"] = nombre
                    break
            break
    m = re.search(r"Importes totales\s+([\d,.]+)\s+([\d,.]+)", txt)
    if m:
        cab["importe_retenido"], cab["importe_pagado"] = m.group(1).replace(",", ""), m.group(2).replace(",", "")
    facturas = []
    for l in lineas:
        tk = re.split(r"\s{2,}", l.strip())
        if len(tk) < 10 or not re.match(r"\d{2}/\d{2}/\d{4}$", tk[3]):
            continue
        mon_doc, total = _monto(tk[4])
        _, pagado = _monto(tk[6])
        retenido = tk[8].replace(",", "")
        sin_pago = not pagado and float(retenido or 0) == 0
        facturas.append({
            # Las filas sin pago ni retención son notas de crédito aplicadas (así figuran en el XML).
            "doc_tipo": "Nota de crédito" if sin_pago else tk[0].strip().capitalize(),
            "doc_numero": f"{tk[1]}-{tk[2]}", "doc_fecha": tk[3], "doc_moneda": mon_doc,
            "doc_importe_total": total, "pago_numero": "" if sin_pago else tk[5], "pago_fecha": "",
            "pago_importe": pagado, "tipo_cambio": "", "importe_retenido": "" if sin_pago else retenido,
            "fecha_retencion": "", "importe_pagado_neto": "" if sin_pago else tk[9].replace(",", ""),
        })
    if facturas:
        cab["moneda"] = "PEN"
    return cab, facturas


def xml_valido(contenido):
    return bool(contenido) and b"Retention" in contenido[:3000] and b"<error_message>" not in contenido[:500]


# ------------------------------------------------------------------ XML UBL

def _hijos(e, nombre):
    return [c for c in e if c.tag.rsplit("}", 1)[-1] == nombre]


def _uno(e, *ruta):
    for n in ruta:
        if e is None:
            return None
        h = _hijos(e, n)
        e = h[0] if h else None
    return e


def _txt(e, *ruta):
    x = _uno(e, *ruta)
    return (x.text or "").strip() if x is not None and x.text else ""


def leer_xml(contenido):
    """Lee un CRE UBL (Retention-1). Devuelve (cabecera, [facturas])."""
    raiz = ET.fromstring(contenido)
    cab = {
        "agente": _txt(raiz, "AgentParty", "PartyLegalEntity", "RegistrationName"),
        "proveedor": _txt(raiz, "ReceiverParty", "PartyLegalEntity", "RegistrationName"),
        "ruc_proveedor_xml": _txt(raiz, "ReceiverParty", "PartyIdentification", "ID"),
        "tasa": _txt(raiz, "SUNATRetentionPercent"),
        "regimen_xml": _txt(raiz, "SUNATRetentionSystemCode"),
        "importe_retenido": _txt(raiz, "TotalInvoiceAmount"),
        "importe_pagado": _txt(raiz, "SUNATTotalPaid"),
        "observacion": _txt(raiz, "Note"),
    }
    tot = _uno(raiz, "TotalInvoiceAmount")
    cab["moneda"] = tot.get("currencyID", "") if tot is not None else ""
    facturas = []
    for ref in _hijos(raiz, "SUNATRetentionDocumentReference"):
        doc = _uno(ref, "ID")
        total = _uno(ref, "TotalInvoiceAmount")
        info = _uno(ref, "SUNATRetentionInformation")
        facturas.append({
            "doc_tipo": TIPOS_DOC.get(doc.get("schemeID", "") if doc is not None else "", doc.get("schemeID", "") if doc is not None else ""),
            "doc_numero": (doc.text or "").strip() if doc is not None and doc.text else "",
            "doc_fecha": fecha_iso(_txt(ref, "IssueDate")),
            "doc_moneda": total.get("currencyID", "") if total is not None else "",
            "doc_importe_total": (total.text or "").strip() if total is not None and total.text else "",
            "pago_numero": _txt(ref, "Payment", "ID"),
            "pago_fecha": fecha_iso(_txt(ref, "Payment", "PaidDate")),
            "pago_importe": _txt(ref, "Payment", "PaidAmount"),
            "tipo_cambio": _txt(info, "ExchangeRate", "CalculationRate"),
            "importe_retenido": _txt(info, "SUNATRetentionAmount"),
            "fecha_retencion": fecha_iso(_txt(info, "SUNATRetentionDate")),
            "importe_pagado_neto": _txt(info, "SUNATNetTotalPaid"),
        })
    return cab, facturas


# --------------------------------------------------------------------- CSV

def leer_csv(ruta):
    if not os.path.exists(ruta):
        return []
    with open(ruta, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def guardar_csv(ruta, columnas, filas):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=columnas, extrasaction="ignore")
        w.writeheader()
        for f in filas:
            w.writerow({c: f.get(c, "") for c in columnas})


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--periodo", required=True, help="AAAAMM (primer mes)")
    ap.add_argument("--hasta", default="", help="AAAAMM último mes (vacío = mes actual)")
    ap.add_argument("--salida", default="retenciones/datos")
    ap.add_argument("--sin-archivos", action="store_true", help="no bajar PDF/XML")
    ap.add_argument("--diagnostico", action="store_true", help="más detalle técnico en el log (sin claves)")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    hasta = a.hasta or datetime.now(LIMA).strftime("%Y%m")
    lista_periodos = list(periodos(a.periodo, hasta))
    if not lista_periodos or len(lista_periodos) > 24:
        sys.exit("Rango de periodos inválido (máximo 24 meses)")

    sol = Sol()
    sol.login(ruc, usuario, clave)
    print("Login OK")
    pagina = sol.abrir_opcion(CODIGO_MENU_CRE)
    print("Consulta CRE abierta:", sol.ultima_url.split("?")[0])
    estados = estados_de_pagina(pagina)
    print("Estados de SUNAT:", estados or "(no se encontraron en la página; se guarda el código)")

    token = ""
    if not a.sin_archivos:
        token = sol.token_api()
        print("Token para PDF/XML:", "obtenido" if token else "NO obtenido (se guardará solo la lista)")
        sol.abrir_opcion(CODIGO_MENU_CRE)  # volver a la consulta de retenciones

    errores, total = 0, {}
    ya_mostro = [False]
    for periodo in lista_periodos:
        fini, ffin = rango_mes(periodo)
        carpeta = os.path.join(a.salida, ruc, periodo[:4], periodo[4:])
        cabeceras, detalles, resumen = [], [], {}
        for tipo in ["emitido", "recibido"]:
            lista = None
            for serie in ["", "E001"]:
                st, d = buscar(sol, tipo, fini, ffin, serie)
                if not (isinstance(d, dict) and "listaCompRetencion" in d):
                    print(f"  {periodo} {tipo}: serie='{serie}' -> HTTP {st} {d.get('_error', '')[:120]}")
                    time.sleep(2)
                    continue
                encontrados = d.get("listaCompRetencion") or []
                if lista is None or len(encontrados) > len(lista):
                    lista = encontrados
                if lista:
                    break
                time.sleep(1)
            if lista is None:
                resumen[tipo] = "ERROR"
                errores += 1
                continue
            resumen[tipo] = len(lista)
            if a.diagnostico and lista:
                print(f"    {tipo}: estados = {sorted(set(str(x.get('codEstadoCpe', '')).strip() for x in lista))}")

            for cre in lista:
                emisor = str(cre.get("numRuc", "")).strip()
                serie = str(cre.get("numSerieCpe", "")).strip()
                numero = str(cre.get("numCpe", "")).strip()
                base = f"{emisor}-{serie}-{numero}"
                receptor = str(cre.get("numDocRecep", "")).strip()
                cod_estado = str(cre.get("codEstadoCpe", "")).strip()
                fila = {
                    "empresa_ruc": ruc, "tipo": "Emitido" if tipo == "emitido" else "Recibido",
                    "periodo": periodo, "fecha_emision": fecha_ms(cre.get("fechaEmision")),
                    "comprobante": f"{serie}-{numero}", "serie": serie, "numero": numero,
                    "ruc_agente": emisor, "ruc_proveedor": receptor,
                    "regimen": REGIMENES.get(str(cre.get("codRegimenRet", "")).strip(), str(cre.get("codRegimenRet", "")).strip()),
                    "importe_retenido": cre.get("montoTotalRetenido", ""),
                    "estado": estados.get(cod_estado, cod_estado),
                    "correo_receptor": str(cre.get("codCorreoRecep", "") or "").strip(),
                    "observacion": str(cre.get("descObservacion", "") or "").strip(),
                }
                ruta_pdf = os.path.join(carpeta, "pdf", base + ".pdf")
                ruta_xml = os.path.join(carpeta, "xml", base + ".xml")
                if os.path.exists(ruta_xml):  # XML guardado antes que en realidad era un mensaje de error
                    with open(ruta_xml, "rb") as fh:
                        if not xml_valido(fh.read()):
                            os.remove(ruta_xml)
                if token:
                    id_api = f"{emisor}-20-{serie}-{numero}-{'1' if tipo == 'emitido' else '2'}"
                    for ruta, accion in [(ruta_xml, "02"), (ruta_pdf, "01")]:
                        if os.path.exists(ruta):
                            continue
                        contenido = bajar_archivo(sol, token, id_api, accion)
                        if contenido and accion == "02" and not xml_valido(contenido):
                            print(f"    SUNAT devolvió un XML con error para {base} (se usará el PDF)")
                            contenido = None
                        if contenido and accion == "01" and not contenido.startswith(b"%PDF"):
                            contenido = None
                        if contenido:
                            os.makedirs(os.path.dirname(ruta), exist_ok=True)
                            with open(ruta, "wb") as fh:
                                fh.write(contenido)
                        else:
                            print(f"    no se pudo bajar {'PDF' if accion == '01' else 'XML'} de {base}")
                        time.sleep(0.5)
                if os.path.exists(ruta_pdf):
                    fila["pdf"] = os.path.relpath(ruta_pdf, a.salida).replace(os.sep, "/")
                facturas = []
                if os.path.exists(ruta_xml):
                    fila["xml"] = os.path.relpath(ruta_xml, a.salida).replace(os.sep, "/")
                    try:
                        with open(ruta_xml, "rb") as fh:
                            cab, facturas = leer_xml(fh.read())
                        for k in ["agente", "proveedor", "tasa", "importe_pagado", "moneda"]:
                            if cab.get(k):
                                fila[k] = cab[k]
                        if cab.get("importe_retenido"):
                            fila["importe_retenido"] = cab["importe_retenido"]
                        if not fila["observacion"] and cab.get("observacion"):
                            fila["observacion"] = cab["observacion"]
                    except Exception as e:
                        print(f"    XML ilegible {base}: {str(e)[:100]}")
                if not facturas and not os.path.exists(ruta_xml) and os.path.exists(ruta_pdf):
                    cab, facturas = leer_pdf(ruta_pdf)
                    yo_agente = tipo == "emitido"
                    fila["agente"] = fila.get("agente") or (cab.get("emisor", ""))
                    fila["proveedor"] = fila.get("proveedor") or cab.get("receptor", "")
                    for k in ["tasa", "importe_pagado", "moneda"]:
                        if cab.get(k) and not fila.get(k):
                            fila[k] = cab[k]
                    if cab.get("regimen") and not fila.get("regimen"):
                        fila["regimen"] = cab["regimen"]
                    if facturas:
                        fila["observacion"] = ((fila["observacion"] + " ") if fila["observacion"] else "") + "(datos leídos del PDF: SUNAT no entregó el XML)"
                if not facturas and not os.path.exists(ruta_xml):
                    try:
                        filas_html, _ = detalle_html(sol, cre, a.diagnostico and not ya_mostro[0])
                        if a.diagnostico and filas_html and not ya_mostro[0]:
                            print("    detalle de pantalla, 1ra fila:", {k: str(v)[:30] for k, v in filas_html[0].items()})
                        ya_mostro[0] = ya_mostro[0] or bool(filas_html)
                        facturas = [mapear_detalle(f) for f in filas_html]
                        if facturas:
                            fila["observacion"] = (fila["observacion"] + " " if fila["observacion"] else "") + "(detalle desde pantalla SUNAT: sin XML)"
                    except Exception as e:
                        print(f"    sin detalle para {base}: {str(e)[:100]}")
                fila["facturas"] = len(facturas) if facturas else ""
                cabeceras.append(fila)
                for f in facturas:
                    det = {"empresa_ruc": ruc, "tipo": fila["tipo"], "periodo": periodo,
                           "comprobante": fila["comprobante"], "ruc_agente": emisor,
                           "ruc_proveedor": receptor, "proveedor": fila.get("proveedor", "")}
                    det.update(f)
                    if det.get("importe_retenido") and not det.get("fecha_retencion"):
                        # En el PDF la fecha de retención y de pago es la fecha del comprobante.
                        det["fecha_retencion"] = det.get("pago_fecha") or fila["fecha_emision"]
                        det["pago_fecha"] = det.get("pago_fecha") or fila["fecha_emision"]
                    detalles.append(det)
            time.sleep(1)

        if cabeceras:
            cabeceras.sort(key=lambda f: (f["tipo"], f["serie"], int(f["numero"]) if f["numero"].isdigit() else 0))
            guardar_csv(os.path.join(carpeta, "cre.csv"), COLS_CRE, cabeceras)
            guardar_csv(os.path.join(carpeta, "detalle.csv"), COLS_DET, detalles)
        pdfs = sum(1 for f in cabeceras if f.get("pdf"))
        total[periodo] = {"emitidos": resumen.get("emitido"), "recibidos": resumen.get("recibido"),
                          "facturas": len(detalles), "pdf": pdfs}
        print(f"{periodo}: emitidos={resumen.get('emitido')} recibidos={resumen.get('recibido')} "
              f"facturas={len(detalles)} pdf={pdfs}/{len(cabeceras)}")

    print("RESUMEN", json.dumps({"meses": total}, ensure_ascii=False))
    if errores:
        sys.exit(2)


if __name__ == "__main__":
    main()
