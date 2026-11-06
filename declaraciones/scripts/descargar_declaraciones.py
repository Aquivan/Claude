"""
descargar_declaraciones.py — Proyecto "Declaraciones · Grupo" (carpeta declaraciones/).

Baja de SUNAT SOL las DECLARACIONES presentadas de UNA empresa (por defecto PDT 621 IGV-Renta,
PDT 601 PLAME y PDT 626 Agentes de Retención), con su constancia oficial en PDF, desde
«Mis declaraciones y pagos» → Consultas → «Consulta de Declaraciones y Pagos» (menú 55.2.1.1.1).
Si hay rectificatorias, baja TODAS (cada presentación tiene su N° de orden); la hoja decide cuál
es la vigente (la última) y deja las anteriores como respaldo.

NADA se guarda en GitHub (el repositorio es público): cada constancia se manda directo a la hoja
«Declaraciones · Grupo» (su aplicación web), con una llave de un solo uso que la hoja crea al pedir la
descarga. El registro solo dice cuántas hay; nunca muestra montos, números de orden ni claves.

Cómo lo hace (igual que una persona, con un Chrome real): entra con la clave SOL, abre la consulta,
pone el rango de periodos, presiona Buscar (SUNAT responde la lista en /factoriaConsulta), y por cada
declaración nueva abre su constancia (llegan /factoriaConstanciaFormulario con tipo y tributos y
/factoriaDetalleFormulario con las casillas) y presiona «Guardar» (el PDF oficial). Solo LEE.

Variables: SUNAT_RUC, SUNAT_USUARIO, SUNAT_CLAVE (nunca se imprimen), DESTINO (URL de la hoja) y
LLAVE (llave de un solo uso).

Uso:  python descargar_declaraciones.py [--desde 202601] [--hasta 202609] [--formularios 0621,0601,0626] [--rehacer]
      Sin --desde: los últimos 3 periodos (el mes anterior y los 2 de antes).
      Exit 75 = SUNAT lenta o caída (se puede reintentar más tarde).
"""
import argparse
import base64
import datetime as dt
import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

PLATAFORMA = "https://e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm?pestana=*&agrupacion=*"
OPCION = "55.2.1.1.1"   # Consulta de Declaraciones y Pagos
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
CAMPOS_LISTA = ["codFor", "desFor", "numOrd", "perTri", "strPerTri", "strFecPres", "mtoPag", "nomEntFin",
                "numOpebco", "descMedpag", "descTipoDecla", "medioPres", "tipoForm", "numOrdOri", "semFor"]


class SunatLenta(Exception):
    pass


def periodos_por_defecto():
    hoy = dt.date.today()
    a, m = hoy.year, hoy.month
    lista = []
    for _ in range(3):
        m -= 1
        if m == 0:
            a, m = a - 1, 12
        lista.append(f"{a}{m:02d}")
    return lista[-1], lista[0]


def tramos(desde, hasta):
    """Un tramo por año (la consulta de SUNAT pide mes y año de inicio y de fin)."""
    a1, a2 = int(desde[:4]), int(hasta[:4])
    for a in range(a1, a2 + 1):
        ini = desde[4:6] if a == a1 else "01"
        fin = hasta[4:6] if a == a2 else "12"
        yield str(a), ini, fin


def enviar(destino, llave, datos, intentos=3):
    """Manda a la hoja (aplicación web de Apps Script). Devuelve su respuesta JSON."""
    cuerpo = json.dumps(dict(datos, llave=llave), ensure_ascii=False).encode("utf-8")
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(destino, data=cuerpo, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=120) as r:
                txt = r.read().decode("utf-8", "replace")
            res = json.loads(txt)
            if not res.get("ok"):
                raise RuntimeError(res.get("error") or "la hoja no aceptó el envío")
            return res
        except Exception as e:   # noqa: BLE001
            ultimo = e
    raise RuntimeError(f"No se pudo mandar a la hoja: {str(ultimo)[:200]}")


class Consulta:
    def __init__(self, pag, ruc, usuario, clave):
        self.pag = pag
        self.json = {}
        pag.context.on("response", self._respuesta)
        try:
            pag.goto(PLATAFORMA, wait_until="networkidle", timeout=90000)
        except Exception as e:
            raise SunatLenta(f"SUNAT SOL no cargó ({str(e)[:80]})")
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
        for paso in range(12):
            if re.search(r'"name":"55\.2\.1\.1\.1"', pag.content()):
                break
            if paso == 6:
                try:
                    pag.reload(wait_until="networkidle", timeout=90000)
                except Exception:
                    pass
            pag.wait_for_timeout(5000)
        else:
            raise SunatLenta("El menú de SUNAT SOL no mostró 'Consulta de Declaraciones y Pagos' (55.2.1.1.1).")
        pag.goto(f"{PLATAFORMA}&exe={OPCION}", wait_until="networkidle", timeout=90000)
        self.fr = None
        for _ in range(40):
            self.fr = next((f for f in pag.frames if "consultaDeclaracionInternet" in f.url
                            and f.locator("select#periodo_tributario_1").count()), None)
            if self.fr:
                break
            pag.wait_for_timeout(1000)
        if not self.fr:
            raise SunatLenta("No abrió el formulario de Consulta de Declaraciones y Pagos")
        pag.wait_for_timeout(2000)

    def _respuesta(self, r):
        for clave in ("factoriaConstanciaFormulario", "factoriaDetalleFormulario"):
            if f"/{clave}/" in r.url:
                try:
                    self.json[(clave, r.url.rstrip("/").split("/")[-1])] = r.json()
                except Exception:
                    pass

    def buscar(self, anio, mes_ini, mes_fin):
        fr = self.fr
        # La página carga la lista de años después: sin ella, «Buscar» no hace nada (pasó el 06/11/2026).
        for _ in range(60):
            if fr.evaluate("(a) => [...document.querySelectorAll('select option')].some(o => o.value === 'number:' + a)", anio):
                break
            self.pag.wait_for_timeout(1000)
        else:
            raise SunatLenta("La consulta de SUNAT no cargó la lista de años")
        self.pag.wait_for_timeout(1500)
        for intento in range(2):
            try:
                return self._buscar(anio, mes_ini, mes_fin)
            except SunatLenta:
                raise
            except Exception as e:   # noqa: BLE001
                if intento:
                    msg = fr.evaluate("() => [...document.querySelectorAll('.alert,.modal-body,.text-danger,.help-block')].filter(e => e.offsetParent !== null).map(e => e.innerText).join(' / ')")
                    raise SunatLenta("SUNAT no respondió la búsqueda" + (": " + re.sub(r"\d{5,}", "…", msg)[:150] if msg else ""))
                self.pag.wait_for_timeout(5000)

    def _buscar(self, anio, mes_ini, mes_fin):
        fr = self.fr
        fr.select_option("#numFormulario", ["Todos"])
        fr.evaluate("""([mi, mf, anio]) => {
            const sel = [...document.querySelectorAll('select')];
            const fija = (s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); };
            for (const [id, m] of [['periodo_tributario_1', mi], ['periodo_tributario_2', mf]]) {
              const e = document.getElementById(id); fija(e, m);
              const y = sel[sel.indexOf(e) + 1]; if (y) fija(y, 'number:' + anio);
            } }""", [mes_ini, mes_fin, anio])
        with self.pag.expect_response(lambda r: "/factoriaConsulta/" in r.url, timeout=60000) as info:
            fr.evaluate("() => { const b = [...document.querySelectorAll('button')].find(b => /Buscar/.test(b.innerText) && b.offsetParent !== null); b.click(); }")
        r = info.value
        if r.status >= 500:
            raise SunatLenta(f"SUNAT respondió HTTP {r.status} a la consulta")
        datos = r.json() if r.status == 200 else []
        self.pag.wait_for_timeout(2500)
        return datos if isinstance(datos, list) else []

    def constancia(self, num):
        """Abre la constancia de un N° de orden (en la tabla, o por la página si no está a la vista) y baja su PDF."""
        fr, pag = self.fr, self.pag
        for k in list(self.json):
            if k[1] == num:
                self.json.pop(k)
        hecho = fr.evaluate("""(num) => {
            const links = [...document.querySelectorAll("a[ng-click^='mostrarConstancia']")];
            for (const a of links) {
              const s = window.angular && angular.element(a).scope();
              if (s && s.constancia && String(s.constancia.numOrd) === num) { a.click(); return 'fila'; }
            }
            // No está en la página visible de la tabla: se abre con la misma función de la página.
            const a = links[0]; if (!a || !window.angular) return '';
            const s = angular.element(a).scope();
            let lista = null;
            for (let x = s; x && !lista; x = x.$parent) {
              for (const k of Object.keys(x)) {
                const v = x[k];
                if (Array.isArray(v) && v.length && v[0] && v[0].numOrd !== undefined && v.some(c => String(c.numOrd) === num)) { lista = v; break; }
              }
            }
            const c = lista && lista.find(c => String(c.numOrd) === num);
            if (!c) return '';
            s.$apply(() => s.mostrarConstancia(c));
            return 'pagina';
        }""", num)
        if not hecho:
            raise RuntimeError("no se encontró la fila en la tabla")
        for _ in range(60):
            if ("factoriaConstanciaFormulario", num) in self.json and ("factoriaDetalleFormulario", num) in self.json:
                break
            pag.wait_for_timeout(500)
        pag.wait_for_timeout(1500)
        with pag.expect_download(timeout=90000) as d:
            fr.locator("[ng-click='exportarConstancia()']:visible").first.click(timeout=15000)
        ruta = d.value.path()
        pdf = open(ruta, "rb").read()
        try:
            fr.evaluate("() => { const b = [...document.querySelectorAll(\"[ng-click='closeModal()']\")].find(e => e.offsetParent !== null); if (b) b.click(); }")
        except Exception:
            pass
        pag.wait_for_timeout(1200)
        if not pdf.startswith(b"%PDF"):
            raise RuntimeError("SUNAT no devolvió un PDF")
        return (pdf, self.json.get(("factoriaConstanciaFormulario", num)) or {},
                self.json.get(("factoriaDetalleFormulario", num)) or {})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default="")
    ap.add_argument("--hasta", default="")
    ap.add_argument("--formularios", default="0621,0601,0626")
    ap.add_argument("--rehacer", action="store_true", help="volver a bajar también las que la hoja ya tiene")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    destino, llave = os.environ.get("DESTINO", ""), os.environ.get("LLAVE", "")
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    if not (destino and llave):
        sys.exit("Falta DESTINO o LLAVE: esta descarga se pide desde la hoja «Declaraciones · Grupo».")
    d0, h0 = periodos_por_defecto()
    desde = re.sub(r"\D", "", a.desde) or d0
    hasta = re.sub(r"\D", "", a.hasta) or h0
    if desde > hasta:
        desde, hasta = hasta, desde
    forms = {f.strip().zfill(4) for f in a.formularios.split(",") if f.strip()}
    print(f"Empresa {ruc[:2]}…{ruc[-3:]} · periodos {desde}–{hasta} · formularios {', '.join(sorted(forms))}")

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA, accept_downloads=True)
        pag = ctx.new_page()
        try:
            c = Consulta(pag, ruc, usuario, clave)
            lista = []
            for anio, mi, mf in tramos(desde, hasta):
                lista += c.buscar(anio, mi, mf)
            items = []
            for x in lista:
                if str(x.get("codFor", "")).zfill(4) not in forms:
                    continue
                it = {k: x.get(k) for k in CAMPOS_LISTA}
                it["codFor"] = str(it["codFor"]).zfill(4)
                it["numOrd"] = str(it["numOrd"])
                it["empresa"] = str(x.get("strNumRuc") or "").strip()
                items.append(it)
            print(f"SUNAT tiene {len(items)} declaración(es) de esos formularios en el rango.")
            res = enviar(destino, llave, {"accion": "lista", "ruc": ruc, "desde": desde, "hasta": hasta,
                                          "formularios": sorted(forms), "items": items, "rehacer": a.rehacer})
            faltan = set(map(str, res.get("faltan", [])))
            pendientes = [it for it in items if it["numOrd"] in faltan]
            print(f"La hoja ya tiene {len(items) - len(pendientes)}; se bajan {len(pendientes)}.")
            bien, mal = 0, 0
            for i, it in enumerate(pendientes, 1):
                try:
                    pdf, cons, det = c.constancia(it["numOrd"])
                    enviar(destino, llave, {"accion": "guardar", "ruc": ruc, "item": it, "constancia": cons,
                                            "casillas": det, "pdf": base64.b64encode(pdf).decode()})
                    bien += 1
                    print(f"  {i}/{len(pendientes)} formulario {it['codFor']} · periodo {it.get('strPerTri', '')} · ✓")
                except Exception as e:   # noqa: BLE001
                    mal += 1
                    msg = re.sub(r"\d{5,}", "…", str(e))[:160]
                    print(f"  {i}/{len(pendientes)} formulario {it['codFor']} · periodo {it.get('strPerTri', '')} · ✗ {msg}")
            enviar(destino, llave, {"accion": "fin", "ruc": ruc, "bien": bien, "mal": mal, "total": len(items)})
            print(f"Listo: {bien} constancia(s) nuevas en la hoja" + (f", {mal} con error" if mal else "") + ".")
            if mal:
                sys.exit(1)
        except SunatLenta as e:
            print(f"SUNAT lenta o en mantenimiento: {e}")
            try:
                enviar(destino, llave, {"accion": "fin", "ruc": ruc, "error": "SUNAT lenta: " + str(e)[:150]})
            except Exception:
                pass
            sys.exit(75)
        except Exception as e:   # noqa: BLE001 — que la hoja sepa por qué no llegó nada
            msg = re.sub(r"\d{5,}", "…", str(e).splitlines()[0] if str(e) else type(e).__name__)[:150]
            print(f"Error: {msg}")
            try:
                enviar(destino, llave, {"accion": "fin", "ruc": ruc, "error": msg})
            except Exception:
                pass
            sys.exit(1)
        finally:
            ctx.close()
            nav.close()


if __name__ == "__main__":
    main()
