"""
explorar.py — Proyecto "Detracciones · Grupo".

Recorre SUNAT SOL con un navegador Chrome real, SOLO LEYENDO, para ubicar las
opciones de detracciones (SPOT: constancias de depósito, consulta de
detracciones como adquiriente y como proveedor) y anotar qué envía cada
pantalla al buscar. Sirve para construir el descargador rápido (descargar_spot.py).
Guarda fotos de cada pantalla en --salida y escribe en el log:
  modo "menu":   todas las opciones del menú SOL cuyo texto habla de detracciones
                 (texto, código de opción e identificadores).
  modo "opcion": abre cada código de opción, muestra sus campos y textos, y si se
                 indica periodo pone las fechas del mes, presiona Buscar/Consultar
                 y anota cada pedido que la página hace a SUNAT y su respuesta.
Las claves SOL llegan por variables de entorno (SUNAT_RUC, SUNAT_USUARIO,
SUNAT_CLAVE) y nunca se imprimen.

Uso:  python explorar.py --modo menu
      python explorar.py --modo opcion --codigos 11.6.1.1.1,11.6.1.2.1 [--periodo 202609]
"""
import argparse
import calendar
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
MENU = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
STATE = ("rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
PATRON = r"detracc|spot|constancia(s)? de dep|dep[oó]sito(s)? de detr|cuenta de detr|banco de la naci"
ESTATICO = re.compile(r"\.(js|css|png|gif|jpg|jpeg|svg|woff2?|ttf|ico)(\?|$)", re.I)

JS_FORMULARIO = """() => [...document.querySelectorAll('input,select,button,a.btn,label,textarea')]
  .filter(e => e.offsetParent !== null)
  .map(e => [e.tagName, e.type || '', e.id || '', e.name || '',
             e.tagName === 'SELECT' ? [...e.options].map(o => o.value + '=' + o.text.trim()).slice(0, 15).join(';') :
             (e.value && e.type !== 'password' ? String(e.value).slice(0, 30) : ''),
             (e.innerText || '').trim().slice(0, 50)].join(' | '))"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modo", default="menu", choices=["menu", "opcion"])
    ap.add_argument("--codigos", default="")
    ap.add_argument("--periodo", default="")
    ap.add_argument("--salida", default="pantallas")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    os.makedirs(a.salida, exist_ok=True)
    n = [0]
    registro = {"activo": False}

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA)
        pag = ctx.new_page()

        def foto(nombre, pagina=None):
            n[0] += 1
            ruta = os.path.join(a.salida, f"{n[0]:02d}_{nombre}.png")
            try:
                (pagina or pag).screenshot(path=ruta, full_page=True)
            except Exception as e:
                print("  (foto no tomada:", str(e)[:80], ")")

        def al_responder(r):
            if not registro["activo"] or ESTATICO.search(r.url) or "api-seguridad" in r.url:
                return
            req = r.request
            if req.resource_type not in ("xhr", "fetch", "document"):
                return
            cuerpo = ""
            try:
                ct = r.headers.get("content-type", "")
                if "json" in ct or "text" in ct or "html" in ct:
                    cuerpo = re.sub(r"\s+", " ", r.text())[:700]
                else:
                    cuerpo = f"[{ct}]"
            except Exception:
                cuerpo = "(sin cuerpo)"
            print(f"  >> {req.method} {r.url[:180]}")
            if req.post_data:
                print(f"     enviado: {req.post_data[:500]}")
            print(f"  << HTTP {r.status}: {cuerpo}")
        ctx.on("response", al_responder)

        # Ingreso a SOL
        pag.goto(f"{SEC}/loginMenuSol?lang=es-PE&showDni=true&showLanguages=false&originalUrl={ORIG}&state={STATE}",
                 wait_until="networkidle", timeout=60000)
        pag.fill("#txtRuc", ruc)
        pag.fill("#txtUsuario", usuario)
        pag.fill("#txtContrasena", clave)
        pag.click("#btnAceptar")
        pag.wait_for_load_state("networkidle", timeout=60000)
        pag.wait_for_timeout(4000)
        print("Ingreso:", pag.url.split("?")[0], "|", pag.title())
        foto("menu_sol")

        if a.modo == "menu":
            html = pag.content()
            print(f"HTML del menú: {len(html)} caracteres")
            # 1) Elementos del menú cuyo texto habla de detracciones
            items = pag.evaluate("""(patron) => {
                const re = new RegExp(patron, 'i'); const out = [];
                for (const e of document.querySelectorAll('*')) {
                  const propio = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim();
                  if (!propio || !re.test(propio)) continue;
                  let cadena = [], x = e;
                  for (let i = 0; i < 6 && x; i++, x = x.parentElement) cadena.push((x.id || x.tagName) + (x.getAttribute && x.getAttribute('data-id') ? '[' + x.getAttribute('data-id') + ']' : ''));
                  const attrs = [...e.attributes].map(t => t.name + '=' + t.value.slice(0, 80)).join(' ');
                  out.push(propio.slice(0, 120) + '  ||  ' + attrs + '  ||  ' + cadena.join(' < '));
                }
                return out; }""", PATRON)
            print(f"--- {len(items)} elementos con texto de detracciones ---")
            for i in items:
                print("  *", i)
            # 2) Contexto en el HTML/JS (códigos de opción cerca del texto)
            vistos = set()
            for m in re.finditer(PATRON, html, re.I):
                s = html[max(0, m.start() - 300): m.end() + 200]
                k = s[250:350]
                if k in vistos:
                    continue
                vistos.add(k)
                codigos = re.findall(r"\b\d{1,2}(?:\.\d{1,2}){3,5}\b", s)
                print("  ~", re.sub(r"\s+", " ", s).replace(clave, "***")[:500], "| códigos:", codigos)
            open(os.path.join(a.salida, "menu.html"), "w", encoding="utf-8").write(html.replace(clave, "***"))
            # 3) Todas las opciones del menú con su código (para buscar a mano en el log)
            todas = pag.evaluate("""() => [...document.querySelectorAll('[id^=nivel], li[id], a[id]')]
                .map(e => (e.id || '') + ' = ' + ((e.innerText || '').trim().split('\\n')[0] || '').slice(0, 90)).filter(t => /\\d/.test(t)).slice(0, 4000)""")
            print(f"--- Opciones con id ({len(todas)}) que mencionan detracciones o depósitos ---")
            for t in todas:
                if re.search(PATRON + r"|dep[oó]sito", t, re.I):
                    print("  #", t)

        else:
            an = me = None
            if a.periodo:
                an, me = int(a.periodo[:4]), int(a.periodo[4:])
                fini, ffin = f"01/{me:02d}/{an}", f"{calendar.monthrange(an, me)[1]:02d}/{me:02d}/{an}"
            for codigo in [c.strip() for c in a.codigos.split(",") if c.strip()]:
                print(f"\n===== Opción {codigo} =====")
                registro["activo"] = True
                pag.goto(f"{MENU}?action=execute&code={codigo}", wait_until="networkidle", timeout=60000)
                pag.wait_for_timeout(5000)
                foto(f"opcion_{codigo}")
                for fr in pag.frames:
                    if fr.url in ("about:blank", "") or ESTATICO.search(fr.url):
                        continue
                    print(f"  [marco] {fr.url[:200]}")
                    try:
                        txt = re.sub(r"\s+", " ", fr.evaluate("() => document.body ? document.body.innerText : ''"))
                        print(f"    texto: {txt[:1200]}")
                        print("    campos:\n      " + "\n      ".join(fr.evaluate(JS_FORMULARIO)[:80]))
                    except Exception as e:
                        print("    (no se pudo leer el marco)", str(e)[:120])
                if a.periodo:
                    for fr in pag.frames:
                        try:
                            puestas = fr.evaluate("""([fini, ffin]) => {
                                const out = [];
                                for (const c of document.querySelectorAll('input')) {
                                  if (c.offsetParent === null || c.type === 'hidden') continue;
                                  const k = (c.id + ' ' + c.name + ' ' + (c.placeholder || '')).toLowerCase();
                                  if (!/fec|desde|hasta|inicio|fin|periodo/.test(k)) continue;
                                  const v = /periodo/.test(k) ? fini.slice(6) + fini.slice(3, 5) : (/fin|hasta/.test(k) ? ffin : fini);
                                  c.removeAttribute('readonly'); c.value = v;
                                  c.dispatchEvent(new Event('input', {bubbles: true})); c.dispatchEvent(new Event('change', {bubbles: true}));
                                  out.push((c.id || c.name) + '=' + v);
                                }
                                return out; }""", [fini, ffin])
                            if not puestas:
                                continue
                            print("  Fechas puestas:", puestas)
                            b = fr.locator("button, input[type=button], input[type=submit], a").filter(has_text=re.compile("Buscar|Consultar|Aceptar", re.I))
                            if b.count() == 0:
                                b = fr.locator("input[type=button][value*=uscar], input[type=button][value*=onsult], input[type=submit]")
                            if b.count():
                                b.first.click()
                                pag.wait_for_timeout(8000)
                                foto(f"resultado_{codigo}")
                                txt = re.sub(r"\s+", " ", fr.evaluate("() => document.body ? document.body.innerText : ''"))
                                print(f"    resultado: {txt[:2000]}")
                            break
                        except Exception as e:
                            print("  (no se pudo buscar en el marco)", str(e)[:150])
                registro["activo"] = False
        ctx.close()
        nav.close()
    print("Listo. Fotos en", a.salida)


if __name__ == "__main__":
    main()
