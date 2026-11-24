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

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
MENU = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
CD = "https://ww1.sunat.gob.pe/ol-ti-itconscpegem/consultar.do"
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
        self.post(MENU, {"action": "prevApp"})
        self.get(f"{MENU}?action=execute&code=11.9.5.1.1")

    def get(self, url, ref=None):
        req = urllib.request.Request(url, headers={"Referer": ref} if ref else {})
        with self.op.open(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace")

    def post(self, url, datos, ref=None):
        req = urllib.request.Request(url, data=urllib.parse.urlencode(datos).encode(),
                                     headers=dict({"Content-Type": "application/x-www-form-urlencoded"}, **({"Referer": ref} if ref else {})))
        with self.op.open(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace")

    def comprobante(self, tipo_consulta, ruc_emisor, serie, numero, desde, hasta):
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
    m = re.search(r"Fecha de Emisi[oó]n\s*:?\s*(\d{2}/\d{2}/\d{4})", plano)
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


def main():
    lote = (os.environ.get("LOTE") or "").strip()
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
            bot({"accion": "scp_estado", "lote": lote, "estado": "🔎 buscando el comprobante en SUNAT…"})
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
