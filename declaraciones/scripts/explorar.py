"""
explorar.py — Proyecto "Declaraciones · Grupo" (carpeta declaraciones/). SOLO LECTURA.

Entra a SUNAT SOL (nueva plataforma «Mis declaraciones y pagos») como una persona y
ubica la consulta de DECLARACIONES presentadas (PDT 621 IGV-Renta, PDT 601 PLAME,
PDT 626 Agentes de Retención) para construir el descargador de sus constancias.

  modo "menu":   lista las opciones del menú (código y nombre) que hablan de declaraciones o consultas.
  modo "opcion": abre cada código, muestra marcos, campos y botones, y anota cada pedido que la
                 página hace a SUNAT. Con --periodo intenta consultar ese mes.

El repositorio es PÚBLICO: el registro solo muestra la ESTRUCTURA. Montos, RUC y números largos se
tapan («#»), no se guardan fotos ni archivos, y las claves (variables SUNAT_RUC, SUNAT_USUARIO,
SUNAT_CLAVE) nunca se imprimen.
"""
import argparse
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

PLATAFORMA = "https://e-menu.sunat.gob.pe/cl-ti-itmenu2/MenuInternetPlataforma.htm?pestana=*&agrupacion=*"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
PATRON = r"declarac|consulta|constancia|pdt|formulario|plame|621|601|626|retenc|presentad|rectific"
ESTATICO = re.compile(r"\.(js|css|png|gif|jpg|jpeg|svg|woff2?|ttf|ico|map)(\?|$)", re.I)
SECRETOS = []


def tapar(t):
    """Quita del texto lo que pueda ser dato: claves, montos, RUC/DNI y números de 4 o más cifras."""
    t = str(t)
    for s in SECRETOS:
        if s:
            t = t.replace(s, "***")
    t = re.sub(r"\d[\d,]*\.\d{1,2}\b", "#.##", t)
    t = re.sub(r"\d{4,}", lambda m: "#" * min(len(m.group(0)), 11), t)
    return re.sub(r"\s+", " ", t)


def estructura_json(v, nivel=0):
    """Forma de una respuesta JSON: llaves y tipos (sin valores), con un ejemplo tapado."""
    if nivel > 4:
        return "…"
    if isinstance(v, dict):
        return {k: estructura_json(x, nivel + 1) for k, x in list(v.items())[:40]}
    if isinstance(v, list):
        return [len(v), estructura_json(v[0], nivel + 1)] if v else [0]
    if isinstance(v, str):
        return "str:" + tapar(v)[:40]
    return type(v).__name__ + (":" + tapar(v) if isinstance(v, (int, float)) and abs(v) < 1000 else "")


JS_CAMPOS = """() => [...document.querySelectorAll('input,select,button,a,label,textarea,th,h1,h2,h3,h4,h5,legend,mat-select,mat-option')]
  .filter(e => e.offsetParent !== null)
  .map(e => [e.tagName, e.type || '', e.id || '', e.name || '', e.getAttribute('formcontrolname') || '',
             e.tagName === 'SELECT' ? [...e.options].map(o => o.value + '=' + o.text.trim()).slice(0, 40).join(';') : '',
             (e.innerText || e.value || '').trim().slice(0, 70)].join(' | ')).slice(0, 220)"""


def ingresar(pag, ruc, usuario, clave):
    pag.goto(PLATAFORMA, wait_until="networkidle", timeout=90000)
    pag.wait_for_timeout(1500)
    if pag.locator("#txtRuc").count():
        pag.fill("#txtRuc", ruc); pag.fill("#txtUsuario", usuario); pag.fill("#txtContrasena", clave)
        pag.click("#btnAceptar")
        pag.wait_for_load_state("networkidle", timeout=90000)
    for _ in range(12):
        pag.wait_for_timeout(5000)
        if re.search(r'"name":"\d+\.\d+', pag.content()):
            break
    print("Ingreso:", pag.url.split("?")[0], "|", pag.title())


def menu(pag):
    html = pag.content()
    vistos = {}
    for m in re.finditer(r'"(?:name|id|codigo|code)"\s*:\s*"(\d{1,3}(?:\.\d{1,3}){1,6})"([^{}]{0,500})', html):
        cod, resto = m.group(1), m.group(2)
        d = re.search(r'"(?:description|descripcion|nombre|title|label)"\s*:\s*"([^"]*)"', resto)
        vistos.setdefault(cod, d.group(1) if d else "")
    print(f"--- {len(vistos)} opciones en el menú ---")
    for cod in sorted(vistos, key=lambda c: [int(x) for x in c.split(".")]):
        print("  OPCION", cod, "|", tapar(vistos[cod])[:120])


def volcar(pag):
    for fr in pag.frames:
        if fr.url in ("about:blank", "") or ESTATICO.search(fr.url):
            continue
        try:
            print(f"  [marco] {fr.url.split('?')[0][:200]}")
            print("    texto:", tapar(fr.evaluate("() => document.body ? document.body.innerText : ''"))[:2500])
            print("    campos:\n      " + "\n      ".join(tapar(x) for x in fr.evaluate(JS_CAMPOS)))
            print("    tablas:", [tapar(x) for x in fr.evaluate(
                "() => [...document.querySelectorAll('table')].map(t => [...t.rows].slice(0, 3).map(r => [...r.cells].map(c => c.innerText.trim()).join(' | ')).join(' // '))")][:6])
        except Exception as e:
            print("    (marco ilegible)", str(e)[:100])


def marco_consulta(pag):
    return next((f for f in pag.frames if "consultaDeclaracionInternet" in f.url and f.locator("select#periodo_tributario_1").count()), None)


def buscar(pag, periodo):
    """Consulta un periodo (todos los formularios) y prueba el botón de la primera fila."""
    fr = marco_consulta(pag)
    if not fr:
        print("  (no está el formulario)"); return
    anio, mes = periodo[:4], periodo[4:6]
    print(f"\n  ---- Buscar periodo {mes}/{anio} ----")
    print("  selects:", [tapar(x) for x in fr.evaluate("""() => [...document.querySelectorAll('select')].map((s, i) => i + ':' + (s.id || s.name || s.getAttribute('ng-model') || '') + ':' + s.multiple + ':' + s.value)""")])
    try:
        fr.select_option("#numFormulario", ["Todos"])
    except Exception as e:
        print("  (formulario)", tapar(str(e))[:120])
    fr.evaluate("""([mes, anio]) => {
        const sel = [...document.querySelectorAll('select')];
        const fija = (s, v) => { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); };
        for (const id of ['periodo_tributario_1', 'periodo_tributario_2']) {
          const m = document.getElementById(id); fija(m, mes);
          const y = sel[sel.indexOf(m) + 1]; if (y) fija(y, 'number:' + anio);
        } }""", [mes, anio])
    print("  ng-models:", [tapar(x) for x in fr.evaluate("""() => [...document.querySelectorAll('select,input')].map(e => (e.getAttribute('ng-model') || e.id || '') + '=' + e.value)""")])
    print("  botones Buscar:", fr.evaluate("() => [...document.querySelectorAll('button')].filter(b => /Buscar/.test(b.innerText)).map(b => (b.offsetParent !== null) + ' ' + b.outerHTML.slice(0, 200))"))
    fr.evaluate("() => { const b = [...document.querySelectorAll('button')].find(b => /Buscar/.test(b.innerText) && b.offsetParent !== null); if (b) b.click(); }")
    pag.wait_for_timeout(12000)
    print("  mensajes:", tapar(fr.evaluate("() => [...document.querySelectorAll('.alert,.modal-body,.text-danger,.error,.mensaje')].filter(e => e.offsetParent !== null).map(e => e.innerText).join(' / ')"))[:600])
    filas = fr.evaluate("""() => [...document.querySelectorAll('table tr')].filter(r => r.offsetParent !== null).map(r => [...r.cells].map(c => c.innerText.trim()).join(' | '))""")
    print(f"  filas visibles ({len(filas)}):")
    for f in filas[:25]:
        print("    ", tapar(f))
    acciones = fr.evaluate("""() => { const r = [...document.querySelectorAll('table tbody tr')].find(r => r.offsetParent !== null && r.cells.length > 4);
        return r ? [...r.querySelectorAll('a,button,input,img,span[ng-click],i')].map(e => e.outerHTML.slice(0, 300)) : []; }""")
    print("  botones de la 1.ª fila:", [tapar(x) for x in acciones])
    for i in range(min(len(acciones), 4)):
        print(f"\n  ---- Clic en el botón {i} de la 1.ª fila ----")
        try:
            pag.wait_for_timeout(1500)
            el = fr.locator("table tbody tr:visible").first.locator("a,button,input,img,span[ng-click],i").nth(i)
            with pag.expect_download(timeout=20000) as d:
                el.click(timeout=8000)
            dd = d.value
            ruta = "/tmp/_decl_prueba"
            dd.save_as(ruta)
            print("    [descarga]", tapar(dd.suggested_filename), os.path.getsize(ruta), "bytes", open(ruta, "rb").read(5))
            os.remove(ruta)
        except Exception as e:
            print("    (sin descarga directa)", tapar(str(e))[:160])
            print("    ventanas:", [tapar(p.url.split("?")[0]) for p in pag.context.pages])
            print("    modal:", tapar(fr.evaluate("() => [...document.querySelectorAll('.modal,[role=dialog]')].filter(e => e.offsetParent !== null).map(e => e.innerText).join(' / ')"))[:800])
            print("    botones ahora:", [tapar(x) for x in fr.evaluate("() => [...document.querySelectorAll('button,a')].filter(e => e.offsetParent !== null && /pdf|descarg|imprim|constancia|detalle|cerrar|volver/i.test(e.innerText + e.title + e.className)).map(e => e.outerHTML.slice(0, 250))")][:15])
            for p2 in pag.context.pages[1:]:
                try:
                    p2.close()
                except Exception:
                    pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modo", default="menu", choices=["menu", "opcion"])
    ap.add_argument("--codigos", default="")
    ap.add_argument("--periodo", default="")
    a = ap.parse_args()
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    SECRETOS.extend([clave, usuario, ruc])
    registro = {"activo": False}

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA, accept_downloads=True)
        pag = ctx.new_page()

        def al_responder(r):
            if not registro["activo"] or ESTATICO.search(r.url) or "api-seguridad" in r.url:
                return
            if r.request.resource_type not in ("xhr", "fetch", "document"):
                return
            ct = r.headers.get("content-type", "")
            forma = f"[{ct}]"
            try:
                if "json" in ct:
                    forma = json.dumps(estructura_json(r.json()), ensure_ascii=False)[:1500]
            except Exception:
                pass
            print(f"  >> {r.request.method} {tapar(r.url.split('?')[0])[:180]} · HTTP {r.status} · {forma}")
            try:
                if r.request.post_data:
                    print("     enviado:", tapar(r.request.post_data)[:400])
            except Exception:
                pass
        ctx.on("response", al_responder)
        ctx.on("page", lambda pg: print("  [ventana nueva]", tapar(pg.url.split("?")[0])[:200]))
        pag.on("download", lambda d: print("  [descarga]", tapar(d.suggested_filename)))

        ingresar(pag, ruc, usuario, clave)
        menu(pag)
        if a.modo == "opcion":
            for cod in [c.strip() for c in a.codigos.split(",") if c.strip()]:
                print(f"\n===== Opción {cod} =====")
                registro["activo"] = True
                try:
                    pag.goto(f"{PLATAFORMA}&exe={cod}", wait_until="networkidle", timeout=90000)
                    pag.wait_for_timeout(12000)
                    volcar(pag)
                    if a.periodo and cod == "55.2.1.1.1":
                        buscar(pag, a.periodo)
                except Exception as e:
                    print("  (no se pudo)", tapar(str(e))[:200])
                registro["activo"] = False
        ctx.close(); nav.close()
    print("Listo (solo lectura; no se guardó nada).")


if __name__ == "__main__":
    main()
