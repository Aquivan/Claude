"""
ver_pantallas.py — Proyecto "Retenciones · Grupo".

Hace la MISMA consulta de comprobantes de retencion que descargar_cre.py, pero
con un navegador Chrome real, como lo haria una persona, y guarda una FOTO de
cada pantalla y un VIDEO del recorrido en retenciones/pantallas/ para verlo
con los propios ojos. Solo LEE en SUNAT. Las claves llegan por variables de
entorno (SUNAT_RUC, SUNAT_USUARIO, SUNAT_CLAVE) y nunca se imprimen; la clave
se ve como puntos (campo de contrasena).

Tambien anota en el log que datos envia la pagina de SUNAT al presionar
"Buscar", para comparar con lo que envia descargar_cre.py.

Uso:  python ver_pantallas.py --periodo 202608 [--salida retenciones/pantallas]
"""
import argparse
import calendar
import os
import re
import sys

from playwright.sync_api import sync_playwright

CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
MENU = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
STATE = ("rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==")
CODIGO_MENU_CRE = "11.9.7.1.1"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")

# Lista de elementos del formulario (id, name, tipo, texto) para el log.
JS_FORMULARIO = """() => [...document.querySelectorAll('input,select,button,a.btn,label')]
  .filter(e => e.offsetParent !== null)
  .map(e => [e.tagName, e.type || '', e.id || '', e.name || '', e.value && e.type !== 'password' ? String(e.value).slice(0, 30) : '',
             (e.innerText || '').trim().slice(0, 40)].join(' | '))"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--periodo", required=True, help="AAAAMM")
    ap.add_argument("--salida", default="retenciones/pantallas")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    an, me = int(a.periodo[:4]), int(a.periodo[4:])
    fini, ffin = f"01/{me:02d}/{an}", f"{calendar.monthrange(an, me)[1]:02d}/{me:02d}/{an}"
    os.makedirs(a.salida, exist_ok=True)
    n = [0]

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA,
                              record_video_dir=a.salida, record_video_size={"width": 1366, "height": 900})
        pag = ctx.new_page()

        def foto(nombre, pagina=None):
            n[0] += 1
            ruta = os.path.join(a.salida, f"{n[0]:02d}_{nombre}.png")
            (pagina or pag).screenshot(path=ruta, full_page=True)
            print("Foto:", ruta)

        # Anotar lo que la pagina envia a SUNAT al buscar (sin claves: es otra pantalla).
        def al_responder(r):
            if "buscarComprobante" in r.url or "cargarDetalle" in r.url:
                print("  >> La pagina envio a", r.url.split("?")[0].rsplit("/", 1)[-1], ":", r.request.post_data)
                try:
                    print("  << SUNAT respondio (HTTP", r.status, "):", r.text()[:600])
                except Exception as e:
                    print("  << (no se pudo leer la respuesta)", e)
        ctx.on("response", al_responder)

        # 1) Pantalla de ingreso a SOL
        pag.goto(f"{SEC}/loginMenuSol?lang=es-PE&showDni=true&showLanguages=false"
                 f"&originalUrl={ORIG}&state={STATE}", wait_until="networkidle", timeout=60000)
        foto("pantalla_ingreso_SOL")
        try:
            pag.fill("#txtRuc", ruc)
            pag.fill("#txtUsuario", usuario)
            pag.fill("#txtContrasena", clave)
            foto("datos_escritos_clave_oculta")
            pag.click("#btnAceptar")
        except Exception as e:
            print("No se encontraron los campos de ingreso esperados:", str(e)[:200])
            print("Campos visibles:", "\n".join(pag.evaluate(JS_FORMULARIO)))
            foto("ingreso_no_reconocido")
            sys.exit(1)
        pag.wait_for_load_state("networkidle", timeout=60000)
        pag.wait_for_timeout(3000)
        print("Despues de ingresar:", pag.url.split("?")[0], "| titulo:", pag.title())
        foto("menu_SOL_despues_de_ingresar")

        # 2) Abrir la opcion "Consulta del comprobante de retencion electronico"
        pag.goto(f"{MENU}?action=execute&code={CODIGO_MENU_CRE}", wait_until="networkidle", timeout=60000)
        pag.wait_for_timeout(3000)
        print("Pagina abierta:", pag.url.split("?")[0], "| titulo:", pag.title())
        foto("consulta_retenciones_vacia")
        print("Elementos del formulario:\n  " + "\n  ".join(pag.evaluate(JS_FORMULARIO)))

        # 3) Buscar RECIBIDOS y luego EMITIDOS del mes, con fechas del mes
        for tipo, patron in [("recibidos", r"recib"), ("emitidos", r"emit")]:
            print(f"--- Buscando {tipo} del {fini} al {ffin} ---")
            marcado = pag.evaluate("""(patron) => {
                const re = new RegExp(patron, 'i');
                for (const r of document.querySelectorAll('input[type=radio]')) {
                  const etiqueta = (r.labels && r.labels[0] ? r.labels[0].innerText : '') + ' ' + r.value + ' ' + (r.parentElement ? r.parentElement.innerText : '');
                  if (re.test(etiqueta)) { r.click(); return r.id || r.value; }
                }
                for (const s of document.querySelectorAll('select')) {
                  for (const o of s.options) if (re.test(o.text + ' ' + o.value)) {
                    s.value = o.value; s.dispatchEvent(new Event('change', {bubbles: true})); return s.id + '=' + o.value; }
                }
                return null; }""", patron)
            print("  Opcion marcada:", marcado)
            fechas = pag.evaluate("""([fini, ffin]) => {
                const campos = [...document.querySelectorAll('input')].filter(e => e.offsetParent !== null && /fec|desde|hasta|inicio|fin/i.test(e.id + ' ' + e.name));
                const hechos = [];
                for (const c of campos) {
                  const k = (c.id + ' ' + c.name).toLowerCase();
                  const v = /fin|hasta/.test(k) ? ffin : fini;
                  c.removeAttribute('readonly'); c.value = v;
                  c.dispatchEvent(new Event('input', {bubbles: true})); c.dispatchEvent(new Event('change', {bubbles: true}));
                  hechos.push((c.id || c.name) + '=' + v);
                }
                return hechos; }""", [fini, ffin])
            print("  Fechas puestas:", fechas)
            foto(f"filtros_{tipo}")
            boton = pag.locator("button, input[type=button], input[type=submit], a").filter(has_text=re.compile("Buscar|Consultar", re.I))
            if boton.count() == 0:
                boton = pag.locator("input[type=button][value*=uscar], input[type=submit][value*=uscar]")
            if boton.count() == 0:
                print("  No se encontro el boton Buscar")
                continue
            boton.first.click()
            pag.wait_for_timeout(6000)
            foto(f"resultado_{tipo}")
            # Si hay algun mensaje emergente (dialogo), fotografiarlo y cerrarlo
            for sel in [".modal.in", ".modal.show", ".ui-dialog", ".bootbox"]:
                if pag.locator(sel).count():
                    foto(f"mensaje_{tipo}")
                    try:
                        pag.locator(f"{sel} button").first.click()
                    except Exception:
                        pass
                    break

        ctx.close()
        nav.close()
    for f in os.listdir(a.salida):
        if f.endswith(".webm"):
            os.replace(os.path.join(a.salida, f), os.path.join(a.salida, "video_recorrido.webm"))
    print("Listo. Fotos y video en", a.salida)


if __name__ == "__main__":
    main()
