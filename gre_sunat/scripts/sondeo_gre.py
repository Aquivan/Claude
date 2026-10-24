"""
sondeo_gre.py — Proyecto "GRE por SUNAT" (carpeta gre_sunat/). Sondeo de SOLO LECTURA.

Entra a SUNAT SOL con la cuenta de UNA empresa, busca en el menú las opciones de Guía de Remisión
Electrónica (Remitente) y, en las de emisión, anota la estructura del formulario: secciones, etiquetas,
nombres de campos, listas y botones. NO llena ni envía nada (no toca "Emitir" ni "Guardar").
Las claves llegan por variables de entorno (SUNAT_RUC, SUNAT_USUARIO, SUNAT_CLAVE) y nunca se imprimen;
los números largos y correos que pudiera mostrar la página se tapan (el repositorio es público).
"""
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

# Opciones del menú SOL con su código (el menú las trae aunque estén plegadas).
JS_MENU = """() => [...document.querySelectorAll('[id], a, li, span')]
  .map(e => ({t: (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim(), id: e.id || '',
              on: (e.getAttribute && (e.getAttribute('onclick') || e.getAttribute('href') || e.getAttribute('data-codigo') || '')) || ''}))
  .filter(x => x.t.length < 90 && /remisi|gu[ií]a|traslado|GRE/i.test(x.t))"""

# Estructura visible del formulario: etiquetas, campos (sin valores), listas y botones.
JS_ESTRUCTURA = """() => {
  const vis = e => e.offsetParent !== null;
  const lab = e => { if (e.id) { const l = document.querySelector('label[for="' + e.id + '"]'); if (l) return l.innerText.trim(); }
    let p = e.parentElement; for (let i = 0; i < 4 && p; i++, p = p.parentElement) { const l = p.querySelector('label'); if (l && l.innerText.trim()) return l.innerText.trim(); }
    return e.getAttribute('placeholder') || e.getAttribute('aria-label') || e.getAttribute('formcontrolname') || ''; };
  const campos = [...document.querySelectorAll('input,select,textarea,p-dropdown,p-calendar,p-autocomplete,mat-select')].filter(e => vis(e) || e.tagName === 'SELECT')
    .map(e => ({tag: e.tagName.toLowerCase(), tipo: e.type || '', id: e.id || '', name: e.name || e.getAttribute('formcontrolname') || '',
      etiqueta: lab(e).replace(/\\s+/g, ' ').slice(0, 70), obligatorio: !!(e.required || e.getAttribute('aria-required') === 'true'),
      opciones: e.tagName === 'SELECT' ? [...e.options].map(o => o.text.trim()).slice(0, 40) : undefined}));
  const titulos = [...document.querySelectorAll('h1,h2,h3,h4,h5,legend,.card-header,.panel-heading,.p-panel-title,.p-accordion-header,.nav-link,.p-tabview-title')]
    .filter(vis).map(e => e.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 60);
  const botones = [...document.querySelectorAll('button,a.btn,input[type=button],input[type=submit]')].filter(vis)
    .map(e => (e.innerText || e.value || e.getAttribute('title') || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 60);
  return {url: location.pathname, titulo: document.title, titulos, campos, botones};
}"""


def sin_datos(t):
    t = re.sub(r"\b\d{6,}\b", "#####", str(t))
    return re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "***@***", t)


PROHIBIDO = re.compile(r"emitir|guardar|grabar|enviar|firmar|confirmar|aceptar", re.I)


def volcar(fr):
    est = fr.evaluate(JS_ESTRUCTURA)
    print("Secciones:", " | ".join(sin_datos(t) for t in dict.fromkeys(est["titulos"])))
    for c in est["campos"]:
        linea = f"   - {sin_datos(c['etiqueta']) or '(sin etiqueta)'}  <{c['tag']} {c['tipo']} id={c['id']} name={c['name']}>"
        if c["obligatorio"]:
            linea += " (obligatorio)"
        print(linea)
        if c.get("opciones"):
            print("       opciones:", " / ".join(sin_datos(x) for x in c["opciones"][:25]))
    print("Botones:", " | ".join(sin_datos(b) for b in dict.fromkeys(est["botones"])))
    print("Texto visible:", sin_datos(fr.inner_text("body")[:2500]).replace("\n", " / "))


JS_LISTA = """() => [...document.querySelectorAll('li,[role=option],.dropdown-item,.p-dropdown-item,mat-option,option,.ng-option')]
  .filter(e => e.offsetParent !== null).map(e => e.innerText.replace(/\\s+/g, ' ').trim()).filter(t => t && t.length < 120)"""


def asistente(fr, pag):
    """Emisión de GRE paso a paso, sin emitir. PASOS = acciones separadas por ";":
       texto → clic en ese texto · #id → clic en ese elemento · lista:texto → abrir y anotar opciones
       elegir:texto → elegir esa opción de la lista abierta. Cualquier botón de emitir/guardar se salta."""
    pasos = os.environ.get("PASOS") or "Remitente;#rdNo;lista:Seleccione;elegir:Compra;Siguiente;Siguiente"
    for paso in pasos.split(";"):
        paso = paso.strip()
        if not paso or PROHIBIDO.search(paso.split(":", 1)[-1]):
            continue
        tipo, _, val = paso.partition(":") if paso.startswith(("lista:", "elegir:")) else ("clic", "", paso)
        try:
            if val.startswith("#"):
                fr.locator(val).first.click(timeout=8000)
            elif tipo == "elegir":
                fr.locator('li,[role=option],.dropdown-item,.p-dropdown-item,mat-option,.ng-option') \
                  .filter(has_text=val).first.click(timeout=8000)
            else:
                fr.get_by_text(val, exact=True).first.click(timeout=8000)
        except Exception as e:
            print(f"\n>>> No pude «{paso}»:", str(e).splitlines()[0][:100])
            if tipo != "lista":
                break
        pag.wait_for_timeout(3000)
        print(f"\n>>> Después de «{paso}»")
        if tipo == "lista":
            print("Opciones de la lista:", " / ".join(sin_datos(x) for x in dict.fromkeys(fr.evaluate(JS_LISTA)))[:2500])
        else:
            volcar(fr)


def main():
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)

        def ingresar():
            ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA)
            pag = ctx.new_page()
            pag.on("dialog", lambda d: d.dismiss())   # solo mirar: cualquier confirmación se rechaza
            pag.goto(f"{SEC}/loginMenuSol?lang=es-PE&showDni=true&showLanguages=false&originalUrl={ORIG}&state={STATE}",
                     wait_until="networkidle", timeout=60000)
            pag.fill("#txtRuc", ruc)
            pag.fill("#txtUsuario", usuario)
            pag.fill("#txtContrasena", clave)
            pag.click("#btnAceptar")
            pag.wait_for_load_state("networkidle", timeout=60000)
            pag.wait_for_timeout(3000)
            return ctx, pag

        ctx, pag = ingresar()
        print("Ingreso a SOL: OK")

        # 1) Opciones del menú que hablan de guías de remisión
        opciones = []
        for fr in pag.frames:
            try:
                opciones += fr.evaluate(JS_MENU)
            except Exception:
                pass
        vistos, codigos = set(), []
        print("\n=== Opciones del menú (guía / remisión / traslado):")
        for o in opciones:
            # id "nivel4_62_1_1_1_1" → código 62.1.1.1.1 (el primer número es el nivel del menú, no va)
            m = re.match(r"nivel4_(\d+(?:_\d+){4})$", o["id"])
            cod = m.group(1).replace("_", ".") if m else ""
            clave_o = (o["t"], cod)
            if clave_o in vistos:
                continue
            vistos.add(clave_o)
            print(f"   · {o['t']}  [id={o['id'][:40]} código={cod}]")
            if cod and re.search(r"emis|emitir", o["t"], re.I) and re.search(r"GRE|gu[ií]a", o["t"]) \
                    and not re.search(r"masiva|transportista|complementaria|eventos", o["t"], re.I) and cod not in codigos:
                codigos.append(cod)
        extra = [c.strip() for c in os.environ.get("CODIGOS", "").split(",") if c.strip()]
        codigos = extra or codigos
        print("\nCódigos de emisión a revisar:", codigos[:5] or "ninguno (pase CODIGOS en el workflow)")

        # 2) Cada opción de emisión: estructura del formulario (sin valores)
        for cod in codigos[:5]:
            print(f"\n================ Opción {cod}")
            # Como una persona: entrar de nuevo y hacer clic en el menú nivel por nivel
            # (recargar el menú con goto lo deja vacío: SUNAT corta la navegación con ERR_ABORTED)
            ctx.close()
            ctx, pag = ingresar()
            p_ = cod.split(".")
            ids = [f"nivel1_{p_[0]}", f"nivel2_{'_'.join(p_[:2])}", f"nivel3_{'_'.join(p_[:3])}", f"nivel4_{'_'.join(p_)}"]
            for i in ids:
                r = "no existe"
                for fr in pag.frames:
                    try:
                        r = fr.evaluate("""i => { const e = document.getElementById(i); if (!e) return 'no existe';
                            const a = e.querySelector('a') || e; a.click();
                            return 'ok ' + (e.getAttribute('onclick') || a.getAttribute('onclick') || a.getAttribute('href') || '').slice(0, 120); }""", i)
                    except Exception:
                        continue
                    if r != "no existe":
                        break
                print(f"   clic {i}: {sin_datos(r)}")
                pag.wait_for_timeout(1500)
            pag.wait_for_timeout(15000)
            print("   Dirección:", sin_datos(pag.url.split("?")[0]))
            try:
                print("   Texto:", sin_datos(pag.inner_text("body")[:300]).replace("\n", " / "))
            except Exception:
                pass
            marcos = [f for pg in ctx.pages for f in pg.frames]   # la aplicación puede abrirse en otra pestaña
            print(f"   Pestañas: {len(ctx.pages)} · marcos: {len(marcos)} ·",
                  ", ".join(sin_datos(f.url.split("?")[0])[-60:] for f in marcos))
            for fr in marcos:
                try:
                    est = fr.evaluate(JS_ESTRUCTURA)
                except Exception:
                    continue
                if not est["campos"] and not est["botones"]:
                    continue
                print(f"\n--- Marco {sin_datos(est['url'])[:80]} · {sin_datos(est['titulo'])[:60]}")
                print("Secciones:", " | ".join(sin_datos(t) for t in dict.fromkeys(est["titulos"])))
                for c in est["campos"]:
                    linea = f"   - {sin_datos(c['etiqueta']) or '(sin etiqueta)'}  <{c['tag']} {c['tipo']} id={c['id']} name={c['name']}>"
                    if c["obligatorio"]:
                        linea += " (obligatorio)"
                    print(linea)
                    if c.get("opciones"):
                        print("       opciones:", " / ".join(sin_datos(x) for x in c["opciones"][:25]))
                print("Botones:", " | ".join(sin_datos(b) for b in dict.fromkeys(est["botones"])))
                if "emitir-gre" in est["url"]:
                    asistente(fr, pag)
        nav.close()


if __name__ == "__main__":
    main()
