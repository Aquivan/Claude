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


PROHIBIDO = re.compile(r"emitir|guardar|grabar|enviar|firmar|confirmar", re.I)


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


def cerrar_avisos(fr, pag):
    """Un aviso (Aceptar / Entendido) se cierra para poder seguir mirando."""
    for t in ("Entendido", "Aceptar"):
        try:
            b = fr.locator("button:visible", has_text=t)
            if b.count():
                b.first.click(timeout=3000)
                pag.wait_for_timeout(1000)
        except Exception:
            pass


def cerrar_ventana(fr, pag):
    """Cierra la ventana abierta con su ×."""
    try:
        x = fr.locator("button.close:visible, [aria-label=Close]:visible, .close:visible").or_(fr.get_by_text("×", exact=True))
        n = x.count()
        print(f"   (cerrar ventana: {n} botones ×)")
        if n:
            x.last.click(timeout=3000)
    except Exception:
        pag.keyboard.press("Escape")
    pag.wait_for_timeout(1200)
    cerrar_avisos(fr, pag)


def pantalla(fr):
    try:
        return fr.evaluate("() => (document.body.innerText.match(/\\d\\. [^\\n]+/) || [''])[0]")
    except Exception:
        return ""


JS_MARCAR = """([t, m]) => {   // marca el campo que está junto a la etiqueta t (para hacer clic en él)
  const x = [...document.querySelectorAll('label,span,div,p,legend')].filter(e => e.offsetParent !== null && e.children.length < 3
    && e.innerText && e.innerText.trim().startsWith(t)).pop();
  if (!x) return 'sin etiqueta';
  let p = x; for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
    const c = p.querySelector('input[type=text],textarea,select'); if (c) { c.setAttribute('data-sondeo', m);
      return (c.closest('[class]') || c).className.toString().slice(0, 80) + ' | ' + p.outerHTML.replace(/\\s+/g, ' ').slice(0, 700); } }
  return 'sin campo';
}"""


def combo(fr, pag, etiqueta, elegir=None):
    """Abre la lista junto a la etiqueta, anota sus opciones y (si se pide) elige una."""
    marca = "c" + str(abs(hash(etiqueta)) % 10000)
    info = fr.evaluate(JS_MARCAR, [etiqueta, marca])
    print(f"   [{etiqueta}] {sin_datos(info)[:800]}")
    try:
        fr.locator(f"[data-sondeo={marca}]").click(timeout=4000)
        pag.wait_for_timeout(1200)
        ops = list(dict.fromkeys(fr.evaluate(JS_LISTA)))
        print(f"   Opciones [{etiqueta}]:", " / ".join(sin_datos(x) for x in ops)[:2000])
        if elegir:
            fr.locator(".ng-dropdown-panel .ng-option:visible, [role=option]:visible").filter(has_text=elegir).first.click(timeout=4000)
            pag.wait_for_timeout(800)
    except Exception as e:
        print(f"   (lista [{etiqueta}] no respondió:", str(e).splitlines()[0][:80], ")")


def llenar_prueba(fr, pag, actual):
    """Solo en el formulario (no se envía nada): lo mínimo para ver la pantalla siguiente."""
    if actual.startswith("4."):
        try:
            fr.get_by_role("button", name="Agregar").first.click(timeout=4000)
            pag.wait_for_timeout(2000)
            fr.locator("#descBien").fill("BIEN DE PRUEBA SONDEO")
            combo(fr, pag, "Unidad de medida del bien", "NIU - UNIDAD")
            fr.locator("[formcontrolname=cantidad], input[name=cantidad]").first.fill("1")
            fr.locator("button:visible", has_text="Agregar").last.click(timeout=4000)
            pag.wait_for_timeout(2000)
            combo(fr, pag, "Unidad de medida de peso bruto", "KILOGRAMO")
            fr.locator("[formcontrolname=pesoBruto], input[name=pesoBruto]").first.fill("1")
            print("   (bien de prueba puesto en el formulario)")
            print("   Tabla de bienes:", sin_datos(fr.evaluate("() => (document.querySelector('table') || {innerText: '-'}).innerText")).replace("\n", " / ")[:600])
            print("   Ventanas abiertas:", fr.evaluate("() => [...document.querySelectorAll('.modal')].filter(m => m.offsetParent !== null || getComputedStyle(m).display !== 'none').map(m => (m.innerText || '').trim().slice(0, 60))"))
        except Exception as e:
            print("   (no pude poner el bien de prueba:", str(e).splitlines()[0][:100], ")")
        cerrar_avisos(fr, pag)
    if actual.startswith("5."):
        agregar = fr.locator("button:visible", has_text=re.compile(r"^\s*Agregar\s*$"))
        # Partida de prueba: establecimiento de un tercero (RUC público de la propia SUNAT) → elegir local
        try:
            agregar.nth(0).click(timeout=4000)
            pag.wait_for_timeout(2000)
            ruc = fr.locator(".modal [formcontrolname=ruc], .modal input[name=ruc]").first
            ruc.fill("20131312955")
            ruc.press("Enter")
            pag.wait_for_timeout(1500)
            ruc.press("Tab")
            pag.wait_for_timeout(4000)
            filas = fr.locator(".modal table tbody tr")
            print(f"\n>>> Partida · tercero: {filas.count()} locales; primero:",
                  sin_datos(filas.first.inner_text()).replace("\t", " | ")[:200] if filas.count() else "-")
            print("   Botones de la ventana:", fr.evaluate("() => [...document.querySelectorAll('.modal button')].filter(b => b.offsetParent !== null).map(b => b.innerText.trim())"))
            fr.locator(".modal table tbody input[type=radio]").first.check(timeout=4000)
            fr.locator("button:visible", has_text=re.compile(r"^\s*Agregar\s*$")).last.click(timeout=4000)
            pag.wait_for_timeout(2500)
            cerrar_avisos(fr, pag)
        except Exception as e:
            print("   (partida de prueba no se pudo:", str(e).splitlines()[0][:100], ")")
            cerrar_ventana(fr, pag)
        # Partida "Otra dirección": solo anotar sus campos (después de lo anterior, si quedó la ventana libre)
        try:
            agregar2 = fr.locator("button:visible", has_text=re.compile(r"^\s*Agregar\s*$"))
            if agregar2.count() >= 2:
                agregar2.nth(0).click(timeout=4000)
                pag.wait_for_timeout(1500)
                fr.locator(".modal input[type=radio]").nth(1).check(timeout=4000)
                pag.wait_for_timeout(2000)
                print("\n>>> Partida · Otra dirección:")
                volcar(fr)
                sels = fr.locator(".modal ng-select")
                print("   Listas:", [sels.nth(j).get_attribute("formcontrolname") for j in range(sels.count())])
                cerrar_ventana(fr, pag)
        except Exception as e:
            print("   (otra dirección no se pudo ver:", str(e).splitlines()[0][:100], ")")
            cerrar_ventana(fr, pag)
        # Llegada de prueba: primer establecimiento del remitente
        try:
            fr.locator("button:visible", has_text=re.compile(r"^\s*Agregar\s*$")).last.click(timeout=4000)
            pag.wait_for_timeout(2000)
            fr.locator(".modal input[type=radio][name=name]").first.check(timeout=4000)
            fr.locator("button:visible", has_text=re.compile(r"^\s*Agregar\s*$")).last.click(timeout=4000)
            pag.wait_for_timeout(2500)
            cerrar_avisos(fr, pag)
        except Exception as e:
            print("   (llegada de prueba no se pudo:", str(e).splitlines()[0][:100], ")")
            cerrar_ventana(fr, pag)
        print("   Pantalla 5 tras la prueba:", sin_datos(fr.inner_text("body")[:700]).replace("\n", " / "))
    if actual.startswith("6."):
        def ventanas(titulo):
            ag = fr.locator("button:visible", has_text=re.compile(r"^\s*Agregar\s*$"))
            for j in range(ag.count()):
                try:
                    fr.locator("button:visible", has_text=re.compile(r"^\s*Agregar\s*$")).nth(j).click(timeout=4000)
                    pag.wait_for_timeout(2000)
                    cerrar_avisos(fr, pag)
                    print(f"\n>>> {titulo} · ventana Agregar {j + 1}:")
                    print("   Campos:", fr.evaluate("""() => [...document.querySelectorAll('.modal input, .modal select, .modal textarea, .modal ng-select')]
                        .filter(e => e.offsetParent !== null).map(e => (e.getAttribute('formcontrolname') || e.name || e.id || e.type) +
                        (e.type === 'radio' || e.type === 'checkbox' ? '(' + (e.parentElement.innerText || '').trim().slice(0, 40) + ')' : ''))"""))
                    print("   Texto:", sin_datos(fr.evaluate("() => [...document.querySelectorAll('.modal')].filter(m => m.offsetParent !== null).map(m => m.innerText).join(' || ')")).replace("\n", " / ")[:900])
                    sels = fr.locator(".modal ng-select:visible")
                    for k in range(sels.count()):
                        try:
                            sels.nth(k).click(timeout=3000)
                            pag.wait_for_timeout(1200)
                            print(f"   Lista {sels.nth(k).get_attribute('formcontrolname')}:", " / ".join(sin_datos(x) for x in dict.fromkeys(fr.evaluate(JS_LISTA)))[:700])
                            pag.keyboard.press("Escape")
                        except Exception:
                            pass
                except Exception as e:
                    print(f"   ({titulo}: Agregar {j + 1} no abrió:", str(e).splitlines()[0][:80], ")")
                cerrar_ventana(fr, pag)
        for modo in ("Transporte Público", "Transporte Privado"):
            try:
                fr.get_by_text(modo, exact=True).first.click(timeout=4000)
                pag.wait_for_timeout(2500)
                cerrar_avisos(fr, pag)
                print(f"\n######## {modo}")
                volcar(fr)
                ventanas(modo)
            except Exception as e:
                print(f"   ({modo} no se pudo:", str(e).splitlines()[0][:100], ")")


def recorrer(fr, pag, maximo=8):
    """Avanza pantalla por pantalla: anota, abre cada "Agregar" (y lo cierra), y pulsa Siguiente."""
    for _ in range(maximo):
        cerrar_avisos(fr, pag)
        actual = pantalla(fr)
        print(f"\n######## Pantalla: {sin_datos(actual)}")
        volcar(fr)
        agregar = fr.locator("button:visible", has_text="Agregar")
        for i in range(min(agregar.count(), 3)):
            try:
                agregar.nth(i).click(timeout=5000)
                pag.wait_for_timeout(2500)
                print(f"\n>>> Ventana «Agregar» n.º {i + 1}:")
                volcar(fr)
                listas = fr.locator(".modal.show input[type=text]:not([name]), [role=dialog] input[type=text]:not([name])")
                for j in range(min(listas.count(), 4)):   # listas desplegables de la ventana
                    try:
                        listas.nth(j).click(timeout=3000)
                        pag.wait_for_timeout(1200)
                        print(f"   Lista {j + 1}:", " / ".join(sin_datos(x) for x in dict.fromkeys(fr.evaluate(JS_LISTA)))[:1500])
                        pag.keyboard.press("Escape")
                    except Exception:
                        pass
            except Exception as e:
                print("   (no abrió Agregar:", str(e).splitlines()[0][:80], ")")
            cerrar_ventana(fr, pag)
        llenar_prueba(fr, pag, actual)
        try:
            fr.get_by_text("Siguiente", exact=True).first.click(timeout=6000)
        except Exception as e:
            print("\n>>> Siguiente no disponible:", " | ".join(str(e).splitlines()[:8])[:900])
            break
        pag.wait_for_timeout(4000)
        for _i in range(3):   # avisos al pasar: "¿Desea continuar?" → SI; "Atención…" → Entendido
            if pantalla(fr) != actual:
                break
            try:
                if "Desea continuar" in fr.inner_text("body"):
                    fr.get_by_role("button", name="SI", exact=True).last.click(timeout=4000)
                    pag.wait_for_timeout(3000)
            except Exception:
                pass
            cerrar_avisos(fr, pag)
            pag.wait_for_timeout(2500)
        if pantalla(fr) == actual:
            print("\n>>> SUNAT no deja pasar sin datos en esta pantalla. Mensaje:")
            try:
                print("   ", sin_datos(fr.inner_text("body")[-600:]).replace("\n", " / "))
            except Exception:
                pass
            cerrar_avisos(fr, pag)
            break


def asistente(fr, pag):
    """Emisión de GRE paso a paso, sin emitir. PASOS = acciones separadas por ";":
       texto → clic en ese texto · #id → clic en ese elemento · lista:texto → abrir y anotar opciones
       elegir:texto → elegir esa opción de la lista abierta. Cualquier botón de emitir/guardar se salta."""
    pasos = os.environ.get("PASOS") or ("Remitente;#rdNo;lista:css=input[type=text]:visible;elegir:Compra;Siguiente;"
                                        "#descTipoActor_2_0;Siguiente;auto")
    for paso in pasos.split(";"):
        paso = paso.strip()
        if not paso or PROHIBIDO.search(paso.split(":", 1)[-1]):
            continue
        tipo, _, val = paso.partition(":") if paso.startswith(("lista:", "elegir:", "html:")) else ("clic", "", paso)
        if paso == "auto":
            recorrer(fr, pag)
            continue
        if paso.startswith("tecla:"):
            pag.keyboard.press(paso[6:])
            pag.wait_for_timeout(1500)
            continue
        if tipo == "html":   # código del control que está junto a ese texto (para saber cómo manejarlo)
            h = fr.evaluate("""t => { const x = [...document.querySelectorAll('label,span,div,p')].find(e => e.children.length < 3 && e.innerText && e.innerText.trim().startsWith(t));
                if (!x) return 'no encontrado'; let p = x.parentElement; for (let i = 0; i < 2 && p && p.outerHTML.length < 600; i++) p = p.parentElement;
                return (p || x).outerHTML; }""", val)
            print(f"\n>>> HTML junto a «{val}»:", sin_datos(re.sub(r"\s+", " ", h))[:3000])
            continue
        try:
            if val.startswith(("#", "css=")):
                fr.locator(val[4:] if val.startswith("css=") else val).first.click(timeout=8000)
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
            cerrar_avisos(fr, pag)


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
