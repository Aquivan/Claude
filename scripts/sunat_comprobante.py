#!/usr/bin/env python3
"""
🔎 Consulta UN comprobante (o unos pocos) en SUNAT SOL → «Nueva consulta de comprobantes de pago» y devuelve sus datos
al bot de Cobranzas (cobranzas/SunatComprobante.js).

El repositorio es público: lo que se busca (RUC, serie, número) NO viene en las entradas del workflow; el robot se lo
pide al bot con el «lote» (canal=gh, solo una ejecución de sunat-comprobante.yml que esté corriendo) y le devuelve el
resultado. En el registro NO se imprime ningún dato del comprobante (solo cuántos se encontraron). Solo LEE en SUNAT.

Claves SOL: secreto SUNAT_CLAVES (una línea por empresa: RUC USUARIO CLAVE, o JSON) o, si no está, SUNAT_RUC /
SUNAT_USUARIO / SUNAT_CLAVE (una sola empresa). Mismo inicio de sesión que sunat-factura.yml.
"""
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import http.cookiejar
import base64
import io
import zipfile
import urllib.error
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
MENU = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
CD = "https://ww1.sunat.gob.pe/ol-ti-itconscpegem/consultar.do"
API = "https://api-cpe.sunat.gob.pe/v1/contribuyente/consultacpe/comprobantes"   # la de «descargar XML/PDF» (sunat-facturas-lote.yml)
COD_API = {"01": "01", "07": "F7", "08": "F8"}   # código que exige la API moderna (N/C = F7, N/D = F8)
# tipo de comprobante + lado → tipoConsulta de la app clásica (10/11 FE, 13/14 N/C, 15/16 N/D; emitida/recibida)
TIPO_CONSULTA = {("01", "emit"): "10", ("01", "recib"): "11", ("07", "emit"): "13", ("07", "recib"): "14",
                 ("08", "emit"): "15", ("08", "recib"): "16"}


def state_login():
    """El mismo «state» del inicio de sesión que usa sunat-factura.yml (se lee de ahí para no copiarlo)."""
    ruta = os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "sunat-factura.yml")
    m = re.search(r"STATE='([^']+)'", open(ruta, encoding="utf-8").read())
    if not m:
        sys.exit("No encontré el STATE del login en sunat-factura.yml")
    return m.group(1)


def leer_claves():
    texto = (os.environ.get("SUNAT_CLAVES") or "").strip()
    claves = {}
    if texto.startswith("{"):
        for r, v in json.loads(texto).items():
            if isinstance(v, dict):
                claves[str(r).strip()] = (str(v.get("usuario", "")).strip(), str(v.get("clave", "")))
    else:
        for linea in texto.splitlines():
            p = linea.strip().split(None, 2)
            if len(p) == 3 and p[0].isdigit():
                claves[p[0]] = (p[1], p[2].strip())
    uno = (os.environ.get("SUNAT_RUC") or "").strip()
    if uno and uno not in claves and os.environ.get("SUNAT_USUARIO"):
        claves[uno] = (os.environ["SUNAT_USUARIO"].strip(), os.environ.get("SUNAT_CLAVE", ""))
    for u, c in claves.values():   # enmascarar antes de usar
        for s in (u, c):
            if s:
                print(f"::add-mask::{s}", flush=True)
    return claves


def bot(cuerpo):
    url = os.environ["BOT_URL"]
    cuerpo = dict(cuerpo, run=os.environ.get("GITHUB_RUN_ID", ""))
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "canal=gh", data=json.dumps(cuerpo).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode() or "{}")


class Sol:
    def __init__(self, ruc, usuario, clave, state):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.op.addheaders = [("User-Agent", UA)]
        self.get(f"{SEC}/loginMenuSol?" + urllib.parse.urlencode({"lang": "es-PE", "showDni": "true", "showLanguages": "false",
                                                                   "originalUrl": ORIG, "state": state}))
        t = self.post(f"{SEC}/j_security_check", {"tipo": "2", "dni": "", "custom_ruc": ruc, "j_username": usuario,
                                                  "j_password": clave, "captcha": "", "originalUrl": ORIG, "state": state})
        if "Men" not in t:
            raise RuntimeError("no pude entrar a SUNAT SOL (revise la clave SOL de esa empresa)")
        self.consulta_abierta = False
        self.token = self._token_api()

    def _token_api(self):
        """Token de la API moderna (la misma que baja el XML y PDF oficiales): viene en la redirección del menú."""
        class NoSeguir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoSeguir)
        op.addheaders = [("User-Agent", UA)]
        try:
            self.post(MENU, {"action": "prevApp"})
            url = f"{MENU}?action=execute&code=11.38.1.1.1"
            for _ in range(5):
                try:
                    r = op.open(url, timeout=60)
                    loc = r.headers.get("Location") or ""
                except urllib.error.HTTPError as e:
                    loc = e.headers.get("Location") or ""
                m = re.search(r"token=([^&]+)", loc)
                if m:
                    return urllib.parse.unquote(m.group(1))
                if not loc:
                    return ""
                url = urllib.parse.urljoin(url, loc)
        except Exception:   # noqa: BLE001
            return ""
        return ""

    def xml_api(self, id_api, accion="02"):
        """02 = XML (zip), 01 = PDF (zip). Devuelve los bytes del archivo de adentro, o None. Reintenta: la API falla seguido."""
        if not self.token:
            return None
        for _ in range(5):
            try:
                req = urllib.request.Request(f"{API}/{id_api}/{accion}?formato=x", headers={
                    "Authorization": "Bearer " + self.token, "Accept": "application/json, text/plain, */*",
                    "Origin": "https://e-factura.sunat.gob.pe", "Referer": "https://e-factura.sunat.gob.pe/", "User-Agent": UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    d = json.loads(r.read().decode() or "{}")
                if d.get("valArchivo"):
                    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(d["valArchivo"])))
                    nombres = [n for n in z.namelist() if not n.endswith("/")]
                    if accion == "02":
                        nombres = [n for n in nombres if n.lower().endswith(".xml")] or nombres
                    if nombres:
                        return z.read(nombres[0])
            except Exception:   # noqa: BLE001
                pass
            time.sleep(4)
        return None

    def abrir_consulta(self):
        if not self.consulta_abierta:
            self.post(MENU, {"action": "prevApp"})
            self.get(f"{MENU}?action=execute&code=11.9.5.1.1")
            self.consulta_abierta = True

    def get(self, url, ref=None):
        req = urllib.request.Request(url, headers={"Referer": ref} if ref else {})
        with self.op.open(req, timeout=60) as r:
            b = r.read()
        try:
            return b.decode("utf-8")
        except UnicodeDecodeError:   # la consulta clásica de SUNAT responde en ISO-8859-1
            return b.decode("latin-1")

    def post(self, url, datos, ref=None):
        req = urllib.request.Request(url, data=urllib.parse.urlencode(datos).encode(),
                                     headers=dict({"Content-Type": "application/x-www-form-urlencoded"}, **({"Referer": ref} if ref else {})))
        with self.op.open(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace")

    def comprobante(self, tipo_consulta, ruc_emisor, serie, numero, desde, hasta):
        self.abrir_consulta()
        q = self.post(CD, {"action": "realizarConsulta", "buscarPor": "porDoc", "tipoConsulta": tipo_consulta, "rucEmisor": ruc_emisor,
                           "serie": serie, "numero": numero, "numDocideRecep": "", "fecDesde": desde, "fecHasta": hasta}, ref=CD)
        self.get(f"{CD}?action=mostrarListado&tipoConsulta={tipo_consulta}", ref=CD)
        h = self.get(f"{CD}?action=verImprimirFactura&rowIndex=0", ref=CD)
        if not re.search(r"COMPROBANTE|ELECTR[OÓ]NICA", h, re.I):
            return None, q
        return h, q


def a_texto(h):
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r"(?i)<br\s*/?>|</(tr|p|div|li|h\d)>", "\n", h)
    h = re.sub(r"(?i)</t[dh]>", " | ", h)
    t = html.unescape(re.sub(r"<[^>]+>", " ", h))
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return "\n".join(x.strip(" |") for x in t.splitlines() if x.strip(" |"))


def num(s):
    s = (s or "").replace(",", "")
    m = re.search(r"-?\d+(\.\d+)?", s)
    return float(m.group(0)) if m else 0.0


def parsear(h, c):
    """Datos de la representación impresa de SUNAT (como la que se ve en la web)."""
    t = a_texto(h)
    plano = " ".join(t.replace("|", " ").split())
    d = {"texto": t[:4000]}
    rucs = re.findall(r"\bRUC\s*:?\s*(\d{11})", plano)
    m = re.search(r"Fecha de Emisi.{0,3}n[^0-9]{0,20}(\d{2}/\d{2}/\d{4})", plano, re.I) or re.search(r"Emisi.{0,3}n[^0-9]{0,20}(\d{2}/\d{2}/\d{4})", plano, re.I)
    d["fecha"] = m.group(1) if m else ""
    m = re.search(r"Fecha de Vencimiento\s*:?\s*(\d{2}/\d{2}/\d{4})", plano) or re.search(r"Vencimiento[^0-9]{0,40}(\d{2}/\d{2}/\d{4})", plano)
    d["vence"] = m.group(1) if m else ""
    m = re.search(r"Tipo de Moneda\s*:?\s*([A-ZÁÉÍÓÚ ]{3,20}?)(?=\s+[A-Z][a-z]|\s*\||$)", plano)
    mon = (m.group(1) if m else "").upper()
    d["moneda"] = "USD" if ("DOLAR" in mon or "USD" in mon or "US$" in plano and "S/" not in plano) else "PEN"
    m = re.search(r"Importe Total\s*:?\s*(?:S/|US\$|\$)?\s*([\d,]+\.\d{2})", plano, re.I)
    d["total"] = num(m.group(1)) if m else 0.0
    m = re.search(r"Sumatoria IGV\s*:?\s*(?:S/|US\$|\$)?\s*([\d,]+\.\d{2})", plano, re.I) or re.search(r"\bIGV\b[^0-9]{0,20}([\d,]+\.\d{2})", plano)
    d["igv"] = num(m.group(1)) if m else 0.0
    m = re.search(r"Forma de pago\s*:?\s*(Contado|Cr[eé]dito)", plano, re.I)
    d["forma_pago"] = m.group(1).capitalize() if m else ""
    m = re.search(r"Se[ñn]or\(es\)\s*:?\s*(.+?)\s+(?:RUC|DNI|Direcci)", plano)
    receptor = m.group(1).strip(" :") if m else ""
    emisor_ruc = rucs[0] if rucs else c["emisor"]
    receptor_ruc = rucs[1] if len(rucs) > 1 else ""
    # razón social del emisor: lo que va antes de la dirección en el encabezado (primeras líneas)
    lineas = [x for x in t.splitlines() if x.strip()]
    emisor_nom = ""
    for x in lineas[:6]:
        if not re.search(r"FACTURA|BOLETA|NOTA|RUC|\d{11}|^[A-Z]{1}\d{3}-", x, re.I) and len(x) > 4:
            emisor_nom = x.split("|")[0].strip()
            break
    det = []
    for x in lineas:
        if re.match(r"^\d+(\.\d+)?\s*\|", x) and len(det) < 5:
            partes = [p.strip() for p in x.split("|") if p.strip()]
            desc = max(partes, key=len) if partes else ""
            if desc and not re.fullmatch(r"[\d.,\s]+", desc):
                det.append(desc)
    d.update({"emisor_ruc": emisor_ruc, "emisor_nombre": emisor_nom, "receptor_ruc": receptor_ruc, "receptor_nombre": receptor,
              "detalle": " || ".join(det)[:300], "estado": ""})
    m = re.search(r"Estado\s*:?\s*(ACEPTAD[OA]|ANULAD[OA]|RECHAZAD[OA]|DE BAJA)", plano, re.I)
    if m:
        d["estado"] = m.group(1).capitalize()
    return d



def _l(e):
    return e.tag.split("}")[-1] if isinstance(e.tag, str) else ""


def _hijos(e, nombre):
    return [x for x in e.iter() if _l(x) == nombre]


def _uno(e, *ruta):
    """Primer elemento que sigue la ruta de nombres locales (sin importar los espacios de nombres)."""
    actual = [e]
    for n in ruta:
        sig = []
        for a in actual:
            sig += [x for x in list(a) if _l(x) == n]
        if not sig:
            return None
        actual = sig
    return actual[0]


def _txt(e, *ruta):
    x = _uno(e, *ruta)
    return (x.text or "").strip() if x is not None and x.text else ""


def _fecha(iso):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", iso or "")
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else ""


def parsear_xml(datos):
    """Datos exactos del XML oficial (UBL 2.1 de SUNAT): factura, nota de crédito o de débito."""
    raiz = ET.fromstring(datos)
    tipo = _l(raiz)
    sup = _uno(raiz, "AccountingSupplierParty", "Party")
    cli = _uno(raiz, "AccountingCustomerParty", "Party")
    def ruc(p):
        return _txt(p, "PartyIdentification", "ID") if p is not None else ""
    def nombre(p):
        return (_txt(p, "PartyLegalEntity", "RegistrationName") or _txt(p, "PartyName", "Name")) if p is not None else ""
    total_e = _uno(raiz, "LegalMonetaryTotal", "PayableAmount")
    if total_e is None:   # (un Element sin hijos vale False: no usar «or»)
        total_e = _uno(raiz, "RequestedMonetaryTotal", "PayableAmount")
    total = float(total_e.text) if total_e is not None and total_e.text else 0.0
    igv = 0.0
    tt = _uno(raiz, "TaxTotal", "TaxAmount")
    if tt is not None and tt.text:
        igv = float(tt.text)
    forma, vences = "", []
    for pt in [x for x in list(raiz) if _l(x) == "PaymentTerms"]:
        pid, medio = _txt(pt, "ID"), _txt(pt, "PaymentMeansID")
        if pid.lower() == "formapago" and medio.lower() in ("contado", "credito"):
            forma = "Crédito" if medio.lower() == "credito" else "Contado"
        f = _txt(pt, "PaymentDueDate")
        if f:
            vences.append(f)
    vence = max(vences) if vences else _txt(raiz, "DueDate")
    det = []
    for ln in [x for x in list(raiz) if _l(x) in ("InvoiceLine", "CreditNoteLine", "DebitNoteLine")][:5]:
        desc = _txt(ln, "Item", "Description")
        if desc:
            det.append(" ".join(desc.split()))
    ref = _txt(raiz, "BillingReference", "InvoiceDocumentReference", "ID") or _txt(raiz, "DiscrepancyResponse", "ReferenceID")
    return {"emisor_ruc": ruc(sup), "emisor_nombre": nombre(sup), "receptor_ruc": ruc(cli), "receptor_nombre": nombre(cli),
            "fecha": _fecha(_txt(raiz, "IssueDate")), "vence": _fecha(vence), "moneda": _txt(raiz, "DocumentCurrencyCode") or "PEN",
            "total": total, "igv": igv, "forma_pago": forma, "detalle": " || ".join(det)[:300],
            "estado": "", "modifica": ref, "fuente": "XML oficial (API SUNAT)", "texto": "", "clase": tipo}


def buscar_xml(sol, c, emisor, recibida):
    """1º camino: el XML oficial por la API moderna (como la descarga de facturas). PDF oficial de paso."""
    cod = COD_API.get(c["tipo"])
    if not cod or not sol.token:
        return None
    id_api = f"{emisor}-{cod}-{c['serie']}-{int(c['numero'])}-{'2' if recibida else '1'}"
    x = sol.xml_api(id_api, "02")
    if not x:
        return None
    try:
        d = parsear_xml(x)
    except Exception:   # noqa: BLE001
        return None
    pdf = sol.xml_api(id_api, "01")
    if pdf and len(pdf) < 3_000_000:
        d["pdf_b64"] = base64.b64encode(pdf).decode()
    return d

def rangos(fecha):
    """Rangos de fecha a probar: el año de la fecha dictada, o este año y los dos anteriores."""
    hoy = datetime.date.today()
    if re.match(r"\d{2}/\d{2}/\d{4}$", fecha or ""):
        a = int(fecha[-4:])
        return [(f"01/01/{a}", f"31/12/{a}")]
    out = []
    for a in (hoy.year, hoy.year - 1, hoy.year - 2):
        fin = hoy.strftime("%d/%m/%Y") if a == hoy.year else f"31/12/{a}"
        out.append((f"01/01/{a}", fin))
    return out


def prueba(empresa):
    """Prueba real sin datos en el registro: toma un comprobante de compras de esa empresa del SIRE ya bajado (carpeta
    sire/<RUC>/historico del repositorio), lo busca en SUNAT por los dos caminos y solo imprime ✓ / ✗ (ningún valor)."""
    import csv
    import glob
    archivos = sorted(glob.glob(f"sire/{empresa}/historico/*/compras_aceptada.csv"))
    fila = None
    for a in reversed(archivos):
        filas = [r for r in csv.DictReader(open(a, encoding="utf-8-sig")) if str(r.get("Tipo CP/Doc.", "")).strip().lstrip("0") == "1"]
        if filas:
            fila = filas[len(filas) // 2]
            break
    if not fila:
        sys.exit("No hay compras del SIRE de esa empresa en el repositorio para probar.")
    c = {"i": 0, "empresa": empresa, "lado": "Por pagar", "ruc": fila["Nro Doc Identidad"].strip(), "tipo": "01",
         "serie": fila["Serie del CDP"].strip(), "numero": str(int(float(fila["Nro CP o Doc. Nro Inicial (Rango)"]))), "fecha": fila["Fecha de emisión"].strip()}
    total_sire = num(fila.get("Total CP", ""))
    claves = leer_claves()
    if empresa not in claves:
        sys.exit("Falta la clave SOL de esa empresa")
    t0 = time.time()
    sol = Sol(empresa, claves[empresa][0], claves[empresa][1], state_login())
    print(f"1. Entrar a SUNAT SOL: ✓ ({time.time() - t0:.0f} s)")
    print(f"2. Token de la API de descarga (XML/PDF): {'✓' if sol.token else '✗'}")
    t1 = time.time()
    d = buscar_xml(sol, c, c["ruc"], True)
    if d:
        campos = ["emisor_ruc", "emisor_nombre", "receptor_ruc", "fecha", "moneda", "total", "igv", "forma_pago", "detalle"]
        print(f"3. XML oficial: ✓ ({time.time() - t1:.0f} s) · " + " ".join(f"{k} {'✓' if d.get(k) else '✗'}" for k in campos) +
              f" · vence {'✓' if d.get('vence') else '—'} · PDF {'✓' if d.get('pdf_b64') else '✗'}")
        print(f"   total igual al del SIRE: {'✓' if abs(d['total'] - total_sire) < 0.02 else '✗'} · emisor correcto: {'✓' if d['emisor_ruc'] == c['ruc'] else '✗'} · receptor = la empresa: {'✓' if d['receptor_ruc'] == empresa else '✗'}")
    else:
        print(f"3. XML oficial: ✗ ({time.time() - t1:.0f} s)")
    t2 = time.time()
    h = None
    for desde, hasta in rangos(c["fecha"]):
        h, _ = sol.comprobante("11", c["ruc"], c["serie"], c["numero"], desde, hasta)
        if h:
            break
    if h:
        d2 = parsear(h, {"emisor": c["ruc"]})
        print(f"4. Consulta de comprobantes (respaldo): ✓ ({time.time() - t2:.0f} s) · fecha {'✓' if d2['fecha'] else '✗'} · total {'✓' if d2['total'] else '✗'}"
              f" · igual al SIRE {'✓' if abs(d2['total'] - total_sire) < 0.02 else '✗'} · moneda {'✓' if d2['moneda'] else '✗'}")
    else:
        print(f"4. Consulta de comprobantes (respaldo): ✗ ({time.time() - t2:.0f} s)")
    if not d and not h:
        sys.exit(1)


def main():
    lote = (os.environ.get("LOTE") or "").strip()
    if lote == "prueba":
        return prueba((os.environ.get("EMPRESA") or "").strip())
    if not lote:
        sys.exit("Falta el lote")
    r = bot({"accion": "scp_pendientes", "lote": lote})
    if not r.get("ok"):
        sys.exit("El bot no dio el lote: " + str(r.get("error")))
    consultas = r.get("consultas") or []
    print(f"Consultas: {len(consultas)}")
    claves, state = leer_claves(), state_login()
    resultados, error = [], ""
    por_empresa = {}
    for c in consultas:
        por_empresa.setdefault(c["empresa"], []).append(c)
    for emp, lista in por_empresa.items():
        if emp not in claves:
            for c in lista:
                resultados.append({"i": c["i"], "ok": False, "error": "no tengo la clave SOL de esa empresa del grupo (secreto SUNAT_CLAVES)"})
            continue
        try:
            bot({"accion": "scp_estado", "lote": lote, "estado": "🔐 entrando a SUNAT SOL…"})
            sol = Sol(emp, claves[emp][0], claves[emp][1], state)
        except Exception as e:   # noqa: BLE001
            for c in lista:
                resultados.append({"i": c["i"], "ok": False, "error": str(e)})
            continue
        for c in lista:
            recibida = c["lado"] == "Por pagar"
            tc = TIPO_CONSULTA.get((c["tipo"], "recib" if recibida else "emit"))
            if not tc:
                resultados.append({"i": c["i"], "ok": False, "error": "ese tipo de comprobante no se puede consultar aquí (solo factura, N/C y N/D)"})
                continue
            emisor = c["ruc"] if recibida else emp
            bot({"accion": "scp_estado", "lote": lote, "estado": "🔎 bajando el XML oficial del comprobante…"})
            d = buscar_xml(sol, c, emisor, recibida)
            if d:
                d.update({"i": c["i"], "ok": True})
                resultados.append(d)
                continue
            bot({"accion": "scp_estado", "lote": lote, "estado": "🔎 buscando en Consulta de comprobantes…"})
            hallado = None
            for desde, hasta in rangos(c.get("fecha")):
                try:
                    h, _ = sol.comprobante(tc, emisor, c["serie"], c["numero"], desde, hasta)
                except Exception as e:   # noqa: BLE001
                    h = None
                    error = str(e)[:200]
                if h:
                    hallado = h
                    break
                time.sleep(1)
            if not hallado:
                resultados.append({"i": c["i"], "ok": False, "error": "SUNAT no lo mostró en la consulta (¿RUC, serie, número o empresa del grupo correctos?)"})
                continue
            d = parsear(hallado, {"emisor": emisor})
            d.update({"i": c["i"], "ok": True})
            resultados.append(d)
    print(f"Encontrados: {sum(1 for x in resultados if x.get('ok'))} de {len(consultas)}")
    bot({"accion": "scp_resultados", "lote": lote, "resultados": resultados, "error": error})


if __name__ == "__main__":
    main()
