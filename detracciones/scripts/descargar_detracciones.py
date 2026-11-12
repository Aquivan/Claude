"""
descargar_detracciones.py — Proyecto "Detracciones · Grupo".

Descarga de SUNAT SOL los DEPÓSITOS DE DETRACCIONES (SPOT) de UNA empresa, mes a
mes por fecha de pago, desde la opción de la nueva plataforma "Mis declaraciones
y pagos" → Consultas → "Consulta de Pago de Detracciones" (menú 55.2.1.1.4).

Lo bajado va DIRECTO a la hoja «Detracciones · Grupo» (su aplicación web), con la
llave de un solo uso que la hoja crea al pedir la descarga (variables DESTINO y
LLAVE). En el repositorio (público) NO se guarda nada, y el registro solo muestra
cuántos depósitos hubo por mes (sin montos, proveedores ni números de constancia).

Cuidado con SUNAT: a veces responde vacío un mes que sí tiene depósitos. Si un mes
llega vacío y la hoja ya tenía depósitos de ese mes, se vuelve a consultar; si
sigue vacío, NO se manda (se conservan los de la hoja) y la empresa queda «con
error» para que la hoja la reintente más tarde.

Cómo lo hace (igual que una persona, con un Chrome real): entra con la clave SOL,
abre la consulta, pone las fechas del mes, el tipo de cuenta y "Pagos individuales"
/ "Pagos masivos", presiona Consultar y lee la respuesta que SUNAT le da a la
página (ruta /v1/recaudacion/tributaria/declapago/detracciones/t/consultar).
Solo LEE; no paga ni modifica nada.

Las claves SOL llegan por variables de entorno (SUNAT_RUC, SUNAT_USUARIO,
SUNAT_CLAVE) y nunca se imprimen.

Uso:  DESTINO=... LLAVE=... python descargar_detracciones.py [--desde 202601] [--hasta 202609] [--ivap] [--constancias]
      Sin --desde: los últimos 3 meses (el actual y los 2 anteriores). DESTINO=prueba: no manda nada.
"""
import argparse
import calendar
import csv
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

PLATAFORMA = "https://e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm?pestana=*&agrupacion=*"
OPCION = "55.2.1.1.4"   # Consulta de Pago de Detracciones
API = "/detracciones/t/consultar"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
CUENTAS = {"1": "Convencional", "2": "Especial IVAP", "3": "Ley 30737"}
TIPOS = {"pagosIndividuales": "Individual", "pagosMasivos": "Masivo"}
COLS = ["empresa_ruc", "rol", "consulta", "tipo_cuenta", "num_cuenta", "fecha_pago", "periodo",
        "tipo_comprobante", "serie", "numero", "constancia", "ruc_proveedor", "proveedor",
        "tipo_doc_adquiriente", "doc_adquiriente", "adquiriente", "tipo_operacion", "tipo_bien",
        "monto", "npd", "origen", "num_presentacion", "usuario_sol"]


def meses(desde, hasta):
    a, m = int(desde[:4]), int(desde[4:6])
    while f"{a}{m:02d}" <= hasta:
        yield a, m
        m += 1
        if m == 13:
            a, m = a + 1, 1


def fila(r, ruc, consulta, cuenta):
    doc_adq = str(r.get("num_doc_adq") or "").strip()
    ruc_prov = str(r.get("num_ruc_proveedor") or "").strip()
    rol = "COMPRA" if doc_adq == ruc else ("VENTA" if ruc_prov == ruc else "OTRO")
    return {
        "empresa_ruc": ruc, "rol": rol, "consulta": consulta,
        "tipo_cuenta": CUENTAS.get(str(r.get("cod_tipcta") or cuenta), str(r.get("cod_tipcta") or "")),
        "num_cuenta": str(r.get("num_cuenta") or "").strip(),
        "fecha_pago": str(r.get("fec_pago_desc") or "").strip(),
        "periodo": str(r.get("per_tributario") or "").strip(),
        "tipo_comprobante": str(r.get("cod_tipcomprobante") or "").strip(),
        "serie": str(r.get("num_serie") or "").strip(),
        "numero": str(r.get("num_comprobante") or "").strip(),
        "constancia": str(r.get("num_constancia") or "").strip(),
        "ruc_proveedor": ruc_prov, "proveedor": re.sub(r"\s+", " ", str(r.get("des_prov") or "")).strip(),
        "tipo_doc_adquiriente": str(r.get("tip_doc_adq") or "").strip(), "doc_adquiriente": doc_adq,
        "adquiriente": re.sub(r"\s+", " ", str(r.get("des_adq") or "")).strip(),
        "tipo_operacion": str(r.get("tip_operacion") or "").strip(),
        "tipo_bien": str(r.get("tip_bien") or "").strip(),
        "monto": r.get("mto_deposito") if r.get("mto_deposito") is not None else r.get("mto_deposito_desc", ""),
        "npd": str(r.get("num_npd") or "").strip(), "origen": str(r.get("origen_desc") or "").strip(),
        "num_presentacion": str(r.get("num_pres") or "").strip(),
        "usuario_sol": str(r.get("cod_usuario_sol") or "").strip(),
    }


class Consulta:
    def __init__(self, pag, ruc, usuario, clave):
        self.pag = pag
        pag.goto(PLATAFORMA, wait_until="networkidle", timeout=90000)
        pag.wait_for_timeout(1500)
        if pag.locator("#txtRuc").count():
            pag.fill("#txtRuc", ruc)
            pag.fill("#txtUsuario", usuario)
            pag.fill("#txtContrasena", clave)
            pag.click("#btnAceptar")
            pag.wait_for_load_state("networkidle", timeout=90000)
        pag.wait_for_timeout(3000)
        if "MenuInternetPlataforma" not in pag.url:
            raise RuntimeError("No se pudo ingresar a SOL (¿clave o usuario?): " + pag.url.split("?")[0])
        # Cuando SUNAT está lenta el menú carga a medias: se espera un poco más (y se recarga una vez) antes de rendirse.
        opcion = r'"name":"55\.2\.1\.1\.4"'
        for paso in range(12):
            if re.search(opcion, pag.content()):
                break
            if paso == 6:
                try:
                    pag.reload(wait_until="networkidle", timeout=90000)
                except Exception:
                    pass
            pag.wait_for_timeout(5000)
        if not re.search(opcion, pag.content()):
            raise RuntimeError("El menú de SUNAT SOL no mostró 'Consulta de Pago de Detracciones' (55.2.1.1.4). "
                               "Casi siempre es SUNAT lenta o en mantenimiento (se reintenta más tarde); "
                               "si se repite varios días, revise que el usuario SOL tenga esa opción.")
        self.reabrir()
        self.url_vista = False

    def reabrir(self):
        """Abre (o vuelve a abrir) el formulario de la consulta: después de ver una constancia la
        página queda en la constancia y el botón Consultar ya no responde."""
        pag = self.pag
        pag.goto(f"{PLATAFORMA}&exe={OPCION}", wait_until="networkidle", timeout=90000)
        self.fr = None
        for _ in range(40):
            self.fr = next((f for f in pag.frames if "plataformaunica" in f.url and f.locator("#btnConsultar").count()), None)
            if self.fr:
                return
            pag.wait_for_timeout(1000)
        raise RuntimeError("No abrió el formulario de Consulta de Pago de Detracciones")

    def consultar(self, ini, fin, cuenta, tipo):
        fr = self.fr
        for intento in range(3):
            try:
                with self.pag.expect_response(lambda r: API in r.url, timeout=90000) as info:
                    for sel, val in [("#fechaInicio", ini), ("#fechaFin", fin)]:
                        fr.evaluate("([s, v]) => { const e = document.querySelector(s); e.removeAttribute('readonly');"
                                    " e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); }", [sel, val])
                    fr.select_option("#tipoCuenta", cuenta)
                    fr.select_option("#tipoConsulta", tipo)
                    fr.evaluate("() => { const e = document.querySelector('#periodo'); if (e && !e.disabled) e.value = ''; }")
                    fr.click("#btnConsultar")
                r = info.value
                d = r.json()
                if str(d.get("cod")) != "200":
                    msg = str(d.get("msg") or d)[:200]
                    if re.search(r"no se encontr", msg, re.I):
                        return []
                    raise RuntimeError(f"SUNAT respondió: {msg}")
                return d.get("resultado") or []
            except Exception as e:
                print(f"   (reintento {intento + 1}: {str(e)[:150]})")
                time.sleep(3 * (intento + 1))
                try:
                    self.reabrir()
                    fr = self.fr
                except Exception as e2:
                    print(f"   (no se pudo reabrir: {str(e2)[:100]})")
        raise RuntimeError(f"No se pudo consultar {ini}–{fin} cuenta {cuenta} {tipo}")

    def constancia(self, numero, indice):
        """Constancia de Depósito oficial (HTML de ~5 KB), igual que una persona: clic en el número
        de constancia (la página pide obtenerconstancia) y luego el botón "Guardar" (descargarconstancia).
        Debe llamarse justo después de consultar "Pagos individuales" (indice = posición en esa lista)."""
        fr, pag = self.fr, self.pag
        for intento in range(2):
            try:
                with pag.expect_response(lambda r: "obtenerconstancia" in r.url, timeout=30000) as inf:
                    fr.evaluate("([n, i]) => constancia(n, i)", [str(numero), indice])
                d = inf.value.json()
                datos = (d.get("resultado") or {}).get("constancia") or {}
                if str(d.get("cod")) != "200" or str(datos.get("numeroConstancia")) != str(numero):
                    raise RuntimeError(f"SUNAT no abrió la constancia ({str(d.get('msg') or '')[:80]})")
                with pag.expect_download(timeout=30000) as dl:
                    fr.evaluate("() => guardarConstancia()")
                with open(dl.value.path(), encoding="utf-8", errors="replace") as fh:
                    html = fh.read()
                if str(numero) in html:
                    return html
                raise RuntimeError("el archivo no trae el número de constancia")
            except Exception as e:
                print(f"     una constancia no se pudo bajar: {re.sub(chr(92) + 'd{6,}', '#', str(e))[:150]}")
                pag.wait_for_timeout(2000 * (intento + 1))
        return None

def enviar(destino, llave, datos, intentos=3):
    """Manda a la hoja (aplicación web de Apps Script) y devuelve su respuesta JSON. DESTINO=prueba: no manda nada."""
    if destino == "prueba":
        return {"ok": True, "meses": {}, "constancias": []} if datos.get("accion") == "estado" else {"ok": True}
    cuerpo = json.dumps(dict(datos, llave=llave), ensure_ascii=False).encode("utf-8")
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(destino, data=cuerpo, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=180) as r:
                res = json.loads(r.read().decode("utf-8", "replace"))
            if not res.get("ok"):
                raise RuntimeError(res.get("error") or "la hoja no aceptó el envío")
            return res
        except Exception as e:   # noqa: BLE001
            ultimo = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"No se pudo mandar a la hoja: {re.sub(r'https?://\S+', '<hoja>', str(ultimo))[:200]}")


def nombre_empresa(ruc):
    try:
        with open("empresas.json", encoding="utf-8") as fh:
            for e in json.load(fh).get("empresas", []):
                if str(e.get("ruc")) == ruc:
                    return str(e.get("nombre") or ruc)
    except Exception:   # noqa: BLE001
        pass
    return ruc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default="", help="AAAAMM (fecha de pago); vacío = hace 2 meses")
    ap.add_argument("--hasta", default="", help="AAAAMM; vacío = este mes")
    ap.add_argument("--ivap", action="store_true", help="consultar también la cuenta especial IVAP")
    ap.add_argument("--constancias", action="store_true",
                    help="bajar también la Constancia de Depósito de cada detracción (solo las que la hoja aún no tiene)")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    destino, llave = os.environ.get("DESTINO", ""), os.environ.get("LLAVE", "")
    if not (destino and (llave or destino == "prueba")):
        sys.exit("Falta la dirección y la llave de la hoja: pida la descarga desde la hoja «Detracciones · Grupo» "
                 "(menú 🏦 Detracciones) o desde el bot. Lo bajado ya no se guarda en el repositorio.")
    hoy = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()
    hasta = (a.hasta or hoy.strftime("%Y%m")).strip()
    if a.desde.strip():
        desde = a.desde.strip()
    else:
        m = hoy.month - 2
        desde = f"{hoy.year + (m - 1) // 12}{(m - 1) % 12 + 1:02d}"
    if not re.fullmatch(r"\d{6}", desde) or not re.fullmatch(r"\d{6}", hasta):
        sys.exit("--desde/--hasta deben ser AAAAMM")
    cuentas = ["1"] + (["2"] if a.ivap else [])
    empresa = nombre_empresa(ruc)
    print(f"Detracciones pagadas de {desde} a {hasta} · cuentas: {', '.join(CUENTAS[c] for c in cuentas)}")

    fallidos, conservados = [], []
    try:
        hoja = enviar(destino, llave, {"accion": "estado", "ruc": ruc})
        en_hoja, ya = hoja.get("meses") or {}, set(str(x) for x in hoja.get("constancias") or [])
        with sync_playwright() as p:
            nav = p.chromium.launch()
            ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA)
            pag = ctx.new_page()
            try:
                c = Consulta(pag, ruc, usuario, clave)
                total, fallidas = 0, 0
                for anio, mes in meses(desde, hasta):
                    ult = calendar.monthrange(anio, mes)[1]
                    fin_d = min(dt.date(anio, mes, ult), hoy)
                    if fin_d < dt.date(anio, mes, 1):
                        continue
                    ini, fin = f"01/{mes:02d}/{anio}", fin_d.strftime("%d/%m/%Y")
                    clave_mes = f"{anio}{mes:02d}"
                    antes = int(en_hoja.get(clave_mes) or 0)

                    def consultar_mes():
                        filas, crudos = {}, []
                        for cuenta in cuentas:
                            for tipo, nombre in TIPOS.items():
                                res = c.consultar(ini, fin, cuenta, tipo)
                                if tipo == "pagosIndividuales":
                                    crudos = res
                                for r in res:
                                    if r.get("num_constancia"):
                                        f = fila(r, ruc, nombre, cuenta)
                                        filas[(f["constancia"], f["num_presentacion"])] = f
                                time.sleep(1)
                        return filas, crudos

                    try:
                        filas, individuales = consultar_mes()
                        if not filas and antes:
                            # SUNAT a veces responde vacío: se vuelve a abrir la consulta y se pregunta otra vez
                            print(f"  {anio}-{mes:02d}: SUNAT respondió vacío y la hoja tiene {antes}; se vuelve a consultar…")
                            time.sleep(10)
                            c.reabrir()
                            filas, individuales = consultar_mes()
                    except Exception as e:   # noqa: BLE001
                        # No se pisa lo que ya estaba en la hoja de ese mes; se sigue con los demás.
                        print(f"  {anio}-{mes:02d}: NO se pudo consultar ({re.sub(chr(92) + 'd{6,}', '#', str(e))[:200]})")
                        fallidos.append(clave_mes)
                        continue
                    if not filas and antes:
                        print(f"  {anio}-{mes:02d}: SUNAT volvió a responder vacío; se CONSERVAN los {antes} depósitos de la hoja")
                        conservados.append(clave_mes)
                        continue
                    r = enviar(destino, llave, {"accion": "mes", "ruc": ruc, "periodo": clave_mes, "filas": list(filas.values())})
                    if r.get("conservado"):
                        conservados.append(clave_mes)
                    nuevas = 0
                    if a.constancias:
                        abierta = False
                        porc = {f["constancia"]: f for f in filas.values()}
                        # hay que volver a consultar «Pagos individuales» para abrir cada constancia desde su lista
                        pendientes = [(k, str(x.get("num_constancia") or "").strip()) for k, x in enumerate(individuales)]
                        pendientes = [(k, n) for k, n in pendientes if n and n not in ya]
                        if pendientes:
                            individuales = c.consultar(ini, fin, "1", "pagosIndividuales")
                            for k, x in enumerate(individuales):
                                num = str(x.get("num_constancia") or "").strip()
                                if not num or num in ya:
                                    continue
                                html = c.constancia(num, k)
                                abierta = True
                                if html:
                                    enviar(destino, llave, {"accion": "constancia", "ruc": ruc, "empresa": empresa, "periodo": clave_mes,
                                                            "num": num, "fila": porc.get(num) or {}, "html": html})
                                    ya.add(num)
                                    nuevas += 1
                                else:
                                    fallidas += 1
                        if abierta:
                            c.reabrir()
                    compras = sum(1 for f in filas.values() if f["rol"] == "COMPRA")
                    print(f"  {anio}-{mes:02d}: {len(filas)} depósitos (como adquiriente {compras}, como proveedor {len(filas) - compras})"
                          + (f" · constancias nuevas {nuevas}" if a.constancias else ""))
                    total += len(filas)
                print(f"Listo: {total} depósitos." + (f" Meses que fallaron: {', '.join(fallidos)}" if fallidos else "")
                      + (f" Meses conservados: {', '.join(conservados)}" if conservados else "")
                      + (f" Constancias que no se pudieron bajar: {fallidas} (se reintentan la próxima vez)" if fallidas else ""))
            finally:
                ctx.close()
                nav.close()
    except Exception as e:   # noqa: BLE001
        msg = re.sub(r"https?://\S+", "<hoja>", str(e))[:200]
        print(f"ERROR: {msg}")
        try:
            enviar(destino, llave, {"accion": "fin", "ruc": ruc, "ok": False, "error": msg})
        except Exception:   # noqa: BLE001
            pass
        sys.exit(1)
    malo = bool(fallidos or conservados)
    enviar(destino, llave, {"accion": "fin", "ruc": ruc, "ok": not malo, "fallidos": fallidos, "conservados": conservados,
                            "error": " · ".join(x for x in [("meses sin consultar: " + ", ".join(fallidos)) if fallidos else "",
                                                            ("SUNAT respondió vacío: " + ", ".join(conservados)) if conservados else ""] if x)})
    if malo:
        sys.exit(1)


if __name__ == "__main__":
    main()
