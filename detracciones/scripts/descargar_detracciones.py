"""
descargar_detracciones.py — Proyecto "Detracciones · Grupo".

Descarga de SUNAT SOL los DEPÓSITOS DE DETRACCIONES (SPOT) de UNA empresa, mes a
mes por fecha de pago, desde la opción de la nueva plataforma "Mis declaraciones
y pagos" → Consultas → "Consulta de Pago de Detracciones" (menú 55.2.1.1.4).

    detracciones/datos/<RUC>/<AAAA>/<MM>/detracciones.csv   un renglón por constancia
    detracciones/datos/<RUC>/<AAAA>/<MM>/masivos.json       pagos masivos (si hay)

Cómo lo hace (igual que una persona, con un Chrome real): entra con la clave SOL,
abre la consulta, pone las fechas del mes, el tipo de cuenta y "Pagos individuales"
/ "Pagos masivos", presiona Consultar y guarda la respuesta que SUNAT le da a la
página (ruta /v1/recaudacion/tributaria/declapago/detracciones/t/consultar).
Solo LEE; no paga ni modifica nada.

Las claves SOL llegan por variables de entorno (SUNAT_RUC, SUNAT_USUARIO,
SUNAT_CLAVE) y nunca se imprimen.

Uso:  python descargar_detracciones.py [--desde 202601] [--hasta 202609] [--salida detracciones/datos] [--ivap]
      Sin --desde: los últimos 3 meses (el actual y los 2 anteriores).
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
        if not re.search(r'"name":"55\.2\.1\.1\.4"', pag.content()):
            raise RuntimeError("Este usuario SOL no tiene la opción 'Consulta de Pago de Detracciones' (55.2.1.1.4) "
                               "en Mis declaraciones y pagos.")
        pag.goto(f"{PLATAFORMA}&exe={OPCION}", wait_until="networkidle", timeout=90000)
        self.fr = None
        for _ in range(40):
            self.fr = next((f for f in pag.frames if "plataformaunica" in f.url and f.locator("#btnConsultar").count()), None)
            if self.fr:
                break
            pag.wait_for_timeout(1000)
        if not self.fr:
            raise RuntimeError("No abrió el formulario de Consulta de Pago de Detracciones")
        self.url_vista = False

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
                    fr.fill("#periodo", "")
                    fr.click("#btnConsultar")
                r = info.value
                if not self.url_vista:
                    print("   ruta:", re.sub(r"\d{11}", "<RUC>", r.url.split("?")[0]),
                          "· parámetros:", sorted(k.split("=")[0] for k in r.url.split("?", 1)[-1].split("&") if k))
                    self.url_vista = True
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
        raise RuntimeError(f"No se pudo consultar {ini}–{fin} cuenta {cuenta} {tipo}")


def guardar_csv(ruta, filas):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    filas.sort(key=lambda r: (r["fecha_pago"], r["constancia"]), reverse=True)
    with open(ruta, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        for r in filas:
            w.writerow({k: r.get(k, "") for k in COLS})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default="detracciones/datos")
    ap.add_argument("--desde", default="", help="AAAAMM (fecha de pago); vacío = hace 2 meses")
    ap.add_argument("--hasta", default="", help="AAAAMM; vacío = este mes")
    ap.add_argument("--ivap", action="store_true", help="consultar también la cuenta especial IVAP")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
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
    print(f"Empresa {ruc}: detracciones pagadas de {desde} a {hasta} · cuentas: {', '.join(CUENTAS[c] for c in cuentas)}")

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA)
        pag = ctx.new_page()
        try:
            c = Consulta(pag, ruc, usuario, clave)
            total = 0
            for anio, mes in meses(desde, hasta):
                ult = calendar.monthrange(anio, mes)[1]
                fin_d = min(dt.date(anio, mes, ult), hoy)
                if fin_d < dt.date(anio, mes, 1):
                    continue
                ini, fin = f"01/{mes:02d}/{anio}", fin_d.strftime("%d/%m/%Y")
                filas, masivos = {}, []
                for cuenta in cuentas:
                    for tipo, nombre in TIPOS.items():
                        res = c.consultar(ini, fin, cuenta, tipo)
                        for r in res:
                            if r.get("num_constancia"):
                                f = fila(r, ruc, nombre, cuenta)
                                filas[(f["constancia"], f["num_presentacion"])] = f
                            if tipo == "pagosMasivos":
                                masivos.append(r)
                        time.sleep(1)
                carpeta = os.path.join(a.salida, ruc, str(anio), f"{mes:02d}")
                guardar_csv(os.path.join(carpeta, "detracciones.csv"), list(filas.values()))
                if masivos:
                    with open(os.path.join(carpeta, "masivos.json"), "w", encoding="utf-8") as fh:
                        json.dump(masivos, fh, ensure_ascii=False, indent=1)
                monto = sum(float(f["monto"] or 0) for f in filas.values())
                compras = sum(1 for f in filas.values() if f["rol"] == "COMPRA")
                print(f"  {anio}-{mes:02d}: {len(filas)} depósitos (como adquiriente {compras}, "
                      f"como proveedor {len(filas) - compras}) · S/ {monto:,.2f}" + (f" · masivos {len(masivos)}" if masivos else ""))
                total += len(filas)
            print(f"Listo: {total} depósitos.")
        finally:
            ctx.close()
            nav.close()


if __name__ == "__main__":
    main()
