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


JS_CLICABLES = """() => [...new Set([...document.querySelectorAll('a,button,li,[role=menuitem],[role=button],mat-list-item,.nav-link,.dropdown-toggle,span.menu,div.card')]
  .filter(e => e.offsetParent !== null).map(e => (e.innerText || '').trim().replace(/\\s+/g, ' ')).filter(t => t && t.length < 90))]"""


def volcar_portal(pag, clave):
    """Imprime lo que se ve en el portal: texto, opciones clicables y marcos."""
    for fr in pag.frames:
        if fr.url in ("about:blank", ""):
            continue
        try:
            txt = re.sub(r"\s+", " ", fr.evaluate("() => document.body ? document.body.innerText : ''"))
            print(f"  [marco] {fr.url[:200]}\n    texto: {txt[:2500].replace(clave, '***')}")
            print("    clicables:", fr.evaluate(JS_CLICABLES)[:120])
        except Exception as e:
            print("  (marco ilegible)", str(e)[:80])


PLATAFORMA = "https://e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm?pestana=*&agrupacion=*"


def plataforma(pag, ruc, usuario, clave, a, foto, registro):
    """Menú SOL de la NUEVA PLATAFORMA "Mis declaraciones y pagos" (cl-ti-itmenu2): ingresa,
    lista las opciones que hablan de detracciones y, con --codigos, abre cada una."""
    pag.goto(PLATAFORMA, wait_until="networkidle", timeout=60000)
    pag.wait_for_timeout(2000)
    if pag.locator("#txtRuc").count():
        pag.fill("#txtRuc", ruc); pag.fill("#txtUsuario", usuario); pag.fill("#txtContrasena", clave); pag.click("#btnAceptar")
        pag.wait_for_load_state("networkidle", timeout=60000)
    pag.wait_for_timeout(8000)
    print("Plataforma:", pag.url[:160], "|", pag.title())
    foto("plataforma")
    html = pag.content()
    open(os.path.join(a.salida, "plataforma.html"), "w", encoding="utf-8").write(html.replace(clave, "***"))
    print(f"HTML: {len(html)} caracteres")
    # Opciones del menú en el JSON de la página (cualquier forma {"name"/"id":"55.x", "description"/"nombre":...})
    vistos = set()
    for m in re.finditer(r'"(?:name|id|codigo|code)"\s*:\s*"(\d{1,3}(?:\.\d{1,3}){2,6})"[^{}]{0,400}', html):
        txt = m.group(0)
        if re.search(PATRON + r"|igv|renta mensual|pago", txt, re.I) and m.group(1) not in vistos:
            vistos.add(m.group(1))
            print("  OPCION", re.sub(r"\s+", " ", txt)[:300])
    for m in re.finditer(PATRON, html, re.I):
        k = html[max(0, m.start() - 300): m.end() + 200]
        print("  ~", re.sub(r"\s+", " ", k).replace(clave, "***")[:500], "| códigos:", re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3,6}\b", k))
    volcar_portal(pag, clave)
    for cod in [c.strip() for c in a.codigos.split(",") if c.strip()]:
        print(f"\n===== Opción {cod} =====")
        registro["activo"] = True
        try:
            pag.goto(PLATAFORMA.replace("pestana=*&agrupacion=*", "pestana=*&agrupacion=*&exe=" + cod), wait_until="networkidle", timeout=60000)
            pag.wait_for_timeout(10000)
            foto("plat_" + cod.replace(".", "_"))
            volcar_portal(pag, clave)
            for fr in pag.frames:
                try:
                    print("    campos", fr.url[:80], "\n      " + "\n      ".join(fr.evaluate(JS_FORMULARIO)[:60]))
                except Exception:
                    pass
            if a.periodo:
                consultar_detracciones(pag, a.periodo, foto, clave)
        except Exception as e:
            print("  (no se pudo)", str(e)[:150])
        registro["activo"] = False


def consultar_detracciones(pag, periodo, foto, clave):
    """En el formulario "Consulta de Pago de Detracciones" pone las fechas del mes y consulta
    cada tipo de pago (individual y masivo) en la cuenta convencional."""
    fr = next((f for f in pag.frames if "plataformaunica" in f.url and f.locator("#btnConsultar").count()), None)
    if not fr:
        print("  (no está el formulario de consulta)"); return
    anio, mes = int(periodo[:4]), int(periodo[4:6])
    ult = calendar.monthrange(anio, mes)[1]
    for tipo in ["pagosIndividuales", "pagosMasivos"]:
        print(f"\n  ---- Consultar {tipo} {periodo} ----")
        try:
            for sel, val in [("#fechaInicio", f"01/{mes:02d}/{anio}"), ("#fechaFin", f"{ult:02d}/{mes:02d}/{anio}")]:
                fr.evaluate("([s, v]) => { const e = document.querySelector(s); e.removeAttribute('readonly'); e.value = v; e.dispatchEvent(new Event('change', {bubbles: true})); }", [sel, val])
            fr.select_option("#tipoCuenta", "1")
            fr.select_option("#tipoConsulta", tipo)
            fr.click("#btnConsultar")
            pag.wait_for_timeout(9000)
            foto("consulta_" + tipo)
            txt = re.sub(r"\s+", " ", fr.evaluate("() => document.body.innerText"))
            print("    texto:", txt[:3000].replace(clave, "***"))
            print("    tablas:", fr.evaluate("""() => [...document.querySelectorAll('table')].map(t => [...t.rows].slice(0, 6).map(r => [...r.cells].map(c => c.innerText.trim()).join(' | ')))"""))
            print("    botones:", fr.evaluate(JS_CLICABLES)[:60])
            # Abrir la constancia del primer depósito: ¿PDF, ventana o modal?
            if tipo == "pagosIndividuales":
                num = fr.evaluate("""() => { const a = [...document.querySelectorAll('a,button')].find(e => /^\\d{8,10}$/.test((e.innerText||'').trim())); return a ? a.innerText.trim() : ''; }""")
                if num:
                    print(f"\n  ---- Clic en constancia {num} ----")
                    print("    elemento:", fr.evaluate("(n) => { const a = [...document.querySelectorAll('a,button')].find(e => (e.innerText||'').trim() === n); return a.outerHTML.slice(0, 400); }", num))
                    descargas = []
                    pag.context.on("page", lambda p: print("    [ventana nueva]", p.url[:200]))
                    pag.on("download", lambda d: descargas.append(d))
                    fr.get_by_text(num, exact=True).first.click(timeout=8000)
                    pag.wait_for_timeout(8000)
                    foto("constancia_" + num)
                    for d in descargas:
                        ruta = os.path.join("pantallas", "constancia_" + d.suggested_filename)
                        d.save_as(ruta)
                        print("    [descarga]", d.suggested_filename, os.path.getsize(ruta), "bytes")
                    vis = fr.evaluate("""() => [...document.querySelectorAll('.modal, [role=dialog], .ui-dialog')].filter(e => e.offsetParent !== null).map(e => e.innerText.replace(/\\s+/g, ' ').slice(0, 1500))""")
                    print("    modal visible:", vis)
                    print("    botones ahora:", [t for t in fr.evaluate(JS_CLICABLES) if re.search(r"imprim|descarg|pdf|cerrar|guardar", t, re.I)])
                    print("    botones constancia:", fr.evaluate("""() => [...document.querySelectorAll('button,a,input[type=button]')].filter(e => e.offsetParent !== null && /descarg|imprim|guardar/i.test(e.innerText || e.value || '')).map(e => e.outerHTML.slice(0, 250))"""))
                    for t in ["Descargar", "Guardar"]:
                        bs = fr.locator(f"button:visible:has-text('{t}'), a:visible:has-text('{t}'), input[type=button][value*='{t}']:visible")
                        n = bs.count()
                        if not n:
                            continue
                        descargas.clear()
                        try:
                            bs.nth(n - 1).click(timeout=8000)
                            pag.wait_for_timeout(8000)
                            for d in descargas:
                                ruta = os.path.join("pantallas", "constancia2_" + d.suggested_filename)
                                d.save_as(ruta)
                                cab = open(ruta, "rb").read(8)
                                print(f"    [descarga con '{t}']", d.suggested_filename, os.path.getsize(ruta), "bytes", cab)
                            if not descargas:
                                print(f"    (clic '{t}': sin descarga)")
                        except Exception as e:
                            print(f"    (clic '{t}' falló: {str(e)[:150]})")
                    # Alternativa: imprimir a PDF la página con la constancia dibujada
                    try:
                        ruta = os.path.join("pantallas", "constancia_impresa.pdf")
                        pag.pdf(path=ruta, format="A4")
                        print("    [pdf de la página]", os.path.getsize(ruta), "bytes")
                    except Exception as e:
                        print("    (pdf de página no:", str(e)[:100], ")")
                    return
        except Exception as e:
            print("    (no se pudo)", str(e)[:200])


def portal(pag, ruc, usuario, clave, a, foto, registro):
    """Entra como una persona: sunat.gob.pe/sol.html → "MIS DECLARACIONES Y PAGOS" → Ingresar,
    y busca dentro de ese portal las opciones de detracciones (consulta)."""
    pag.goto("https://www.sunat.gob.pe/sol.html", wait_until="networkidle", timeout=60000)
    foto("sol_html")
    enlaces = pag.evaluate("""() => [...document.querySelectorAll('a')].map(a => [(a.innerText||'').trim().slice(0,40), a.href,
        ((a.closest('div,section,li,td') || a).innerText || '').replace(/\\s+/g, ' ').slice(0, 160)])""")
    for t, h, ctx_ in enlaces:
        if h and "sunat" in h and not h.startswith("javascript"):
            print(f"  enlace sol.html: [{t}] {h[:160]}  «{ctx_}»")
    enlaces = [(t, h) for t, h, _ in enlaces]
    destino = None
    for t, h in enlaces:
        if re.search(r"ingresar", t, re.I) and h and "sunat" in h:
            print("  Ingresar →", h[:200])
            destino = destino or h          # el primero es MIS DECLARACIONES Y PAGOS
    if not destino:
        print("No se encontró el botón Ingresar"); return
    pag.goto(destino, wait_until="networkidle", timeout=60000)
    pag.wait_for_timeout(2000)
    print("Pantalla de ingreso:", pag.url[:200])
    foto("ingreso_portal")
    for sel_r, sel_u, sel_c, sel_b in [("#txtRuc", "#txtUsuario", "#txtContrasena", "#btnAceptar")]:
        pag.fill(sel_r, ruc); pag.fill(sel_u, usuario); pag.fill(sel_c, clave); pag.click(sel_b)
    registro["activo"] = True               # anotar lo que la aplicación pide al cargar (menú, opciones)
    pag.wait_for_load_state("networkidle", timeout=60000)
    pag.wait_for_timeout(12000)
    print("Después de ingresar:", pag.url[:200], "|", pag.title())
    foto("portal_dentro")
    volcar_portal(pag, clave)
    # Abrir los menús desplegables (la aplicación esconde las opciones hasta hacer clic)
    for t in pag.evaluate(JS_CLICABLES)[:40]:
        if re.search(r"salir|cerrar|ayuda|idioma|tutorial|mensaje", t, re.I) or len(t) > 60:
            continue
        try:
            pag.get_by_text(t, exact=True).first.click(timeout=4000)
            pag.wait_for_timeout(2500)
            nuevos = pag.evaluate(JS_CLICABLES)
            print(f"  [abrió '{t}'] →", nuevos[:60])
            if re.search(PATRON, pag.content(), re.I):
                print("  *** aparece texto de detracciones después de abrir:", t)
                foto("menu_" + re.sub(r"\W+", "_", t)[:30])
                break
        except Exception as e:
            print(f"  (no se abrió '{t}':", str(e)[:80], ")")
    html = pag.content()
    for m in re.finditer(PATRON, html, re.I):
        print("  ~", re.sub(r"\s+", " ", html[max(0, m.start() - 250): m.end() + 250]).replace(clave, "***")[:500])
    # Probar las consultas del portal (por si los pagos de detracciones aparecen ahí)
    for t in ["Consulta de Declaraciones y Pagos - Nueva Plataforma", "Consulta de Declaraciones y Pagos"]:
        try:
            print(f"\n===== Abrir: {t} =====")
            antes = len(pag.context.pages)
            pag.get_by_text(t).first.click(timeout=8000)
            pag.wait_for_timeout(10000)
            destino = pag.context.pages[-1] if len(pag.context.pages) > antes else pag
            destino.wait_for_load_state("networkidle", timeout=60000)
            print("  URL:", destino.url[:200])
            foto("consulta_" + re.sub(r"\W+", "_", t)[:25], destino)
            volcar_portal(destino, clave)
            if destino is not pag:
                destino.close()
            else:
                pag.go_back(); pag.wait_for_timeout(4000)
        except Exception as e:
            print("  (no se pudo)", str(e)[:150])
    # Opciones visibles que hablen de detracciones: hacer clic en las de consulta
    registro["activo"] = True
    textos = pag.evaluate("""(patron) => { const re = new RegExp(patron, 'i');
        return [...document.querySelectorAll('a,li,span,div,button')].filter(e => re.test((e.innerText||'').trim()) && (e.innerText||'').trim().length < 80)
          .map(e => (e.innerText||'').trim()); }""", PATRON)
    print("Opciones con detracciones:", sorted(set(textos))[:40])
    for t in sorted(set(textos)):
        if not re.search(r"consulta|constancia", t, re.I):
            continue
        print(f"\n===== Clic en: {t} =====")
        try:
            pag.get_by_text(t, exact=True).first.click(timeout=8000)
            pag.wait_for_timeout(7000)
            foto("clic_" + re.sub(r"\W+", "_", t)[:30])
            for fr in pag.frames:
                if fr.url in ("about:blank", "") or "gettime" in fr.url:
                    continue
                print(f"  [marco] {fr.url[:200]}")
                txt = re.sub(r"\s+", " ", fr.evaluate("() => document.body ? document.body.innerText : ''"))
                print(f"    texto: {txt[:1500]}")
                print("    campos:\n      " + "\n      ".join(fr.evaluate(JS_FORMULARIO)[:60]))
        except Exception as e:
            print("  (no se pudo)", str(e)[:150])
    registro["activo"] = False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modo", default="menu", choices=["menu", "opcion", "portal", "plataforma"])
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
            if not registro["activo"] or ESTATICO.search(r.url) or "api-seguridad" in r.url or "/rb_" in r.url:
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
            try:
                enviado = req.post_data
            except Exception:
                enviado = "(binario)"
            if enviado and "rb_" not in r.url:
                print(f"     enviado: {enviado[:500]}")
            print(f"  << HTTP {r.status}: {cuerpo}")
        ctx.on("response", al_responder)

        if a.modo in ("portal", "plataforma"):
            (portal if a.modo == "portal" else plataforma)(pag, ruc, usuario, clave, a, foto, registro)
            ctx.close(); nav.close()
            print("Listo. Fotos en", a.salida)
            return

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
            # Opciones del menú (JSON de la página) del bloque Declaraciones y pagos / Detracciones (12.4) y relacionadas
            for m in re.finditer(r'\{"name":"(1[23]\.(?:4|10|17)[\d.]*)","description":"([^"]*)"(?:,"invoke":"(\d)")?,"type":"(\w+)"(?:,"url":"([^"]*)")?', html):
                print("  OPCION", m.group(1), "|", m.group(2), "| tipo", m.group(4), "| invoke", m.group(3), "|", (m.group(5) or "").replace("\\/", "/"))
            for m in re.finditer(r"ejecuta\('MenuInternet\.htm\?action=(\w+)&amp;code=([\d.]+)',\w+,'([^']*)'", html):
                print("  ICONO", m.group(2), "|", m.group(1), "|", m.group(3))
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
                accion = "iconExecute" if codigo.startswith("icon:") else "execute"
                codigo = codigo.replace("icon:", "")
                if accion == "iconExecute":   # como el ícono del menú: abre la opción dentro del menú
                    pag.goto(MENU, wait_until="networkidle", timeout=60000)
                    try:
                        pag.evaluate(f"ejecuta('MenuInternet.htm?action=iconExecute&code={codigo}',false,'x','#nivel1_12','{codigo}')")
                    except Exception as e:
                        print("  (ejecuta falló)", str(e)[:120])
                        pag.goto(f"{MENU}?action=iconExecute&code={codigo}", wait_until="networkidle", timeout=60000)
                    pag.wait_for_load_state("networkidle", timeout=60000)
                else:
                    pag.goto(f"{MENU}?action={accion}&code={codigo}", wait_until="networkidle", timeout=60000)
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
