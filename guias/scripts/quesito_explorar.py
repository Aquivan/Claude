"""
quesito_explorar.py — Proyecto "Guías de Remisión · Grupo".

Entra a Quesito.pe con la cuenta de UNA empresa y recorre, como una persona,
el camino para emitir una guía desde una factura:
  Comprobantes → Buscar Documento (serie y número) → Opciones →
  "Generar GUIA DE REMISIÓN REMITENTE" → formulario "Nueva Guía de Remisión".
Abre cada sección del formulario y anota TODOS sus campos (etiqueta, tipo,
si es obligatorio y las opciones de cada lista) para diseñar la hoja según
lo que Quesito realmente pide.

SOLO MIRA, NUNCA EMITE:
  - no hace clic en "Crear Guía" ni en nada parecido;
  - desde que llega al formulario, bloquea cualquier envío de datos
    (POST/PUT/DELETE) y rechaza cualquier ventana de confirmación;
  - las fotos se toman con los campos y las tablas TAPADOS (no salen nombres
    de clientes ni montos), porque el repositorio todavía es público;
  - el archivo de estructura guarda nombres de campos y opciones de listas,
    no los datos de clientes que vienen precargados.
La clave llega por variables de entorno (QUESITO_CORREO, QUESITO_CLAVE) y
nunca se imprime.

Uso:  python quesito_explorar.py --serie FQQ1 --numero 3648 [--salida pantallas]
"""
import argparse
import json
import os
import re
import sys
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

INICIO = os.environ.get("QUESITO_URL", "https://www.quesito.pe/login")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
# Solo se guardan las opciones de las listas de catálogo; las demás (p. ej. direcciones del cliente) solo se cuentan.
CATALOGO = re.compile(r"motivo|tipo|unidad|modalidad|transporte|serie|moneda|medida|document|indicador|categor|pa[ií]s|local|almac", re.I)
PELIGRO = re.compile(r"crear|emitir|enviar|guardar|anular|eliminar|registrar", re.I)

# Menús, botones y enlaces visibles FUERA de tablas (los de las tablas pueden llevar datos de clientes).
JS_NAVEGACION = """() => [...document.querySelectorAll('a,button,[role=button],[role=menuitem]')]
  .filter(e => e.offsetParent !== null && !e.closest('table,tbody'))
  .map(e => ((e.innerText || e.getAttribute('title') || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 50)
              + (e.getAttribute('href') && !e.getAttribute('href').startsWith('javascript') ? '  → ' + e.getAttribute('href').split('?')[0] : '')))
  .filter(t => t.trim())"""

# Estructura del formulario: secciones (encabezados) y campos con su etiqueta, sin los valores escritos.
JS_ESTRUCTURA = """() => {
  const vis = e => e.offsetParent !== null || e.type === 'hidden';
  const etiqueta = e => {
    if (e.id) { const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (l) return l.innerText.trim(); }
    const l2 = e.closest('label'); if (l2) return l2.innerText.trim();
    let p = e.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const l = p.querySelector('label,.control-label,.form-label,span.input-group-text,strong');
      if (l && !l.contains(e) && l.innerText.trim()) return l.innerText.trim();
    }
    return e.getAttribute('placeholder') || e.getAttribute('aria-label') || '';
  };
  const seccion = e => {
    let p = e;
    while (p && p !== document.body) {
      let h = p.querySelector(':scope > .card-header, :scope > .panel-heading, :scope > legend, :scope > h3, :scope > h4, :scope > h5, :scope > .box-header');
      if (h && h.innerText.trim()) return h.innerText.trim().replace(/\\s+/g, ' ').slice(0, 60);
      p = p.parentElement;
    }
    return '';
  };
  const campos = [...document.querySelectorAll('input,select,textarea')].filter(vis).map(e => {
    const c = { seccion: seccion(e), etiqueta: etiqueta(e).replace(/\\s+/g, ' ').slice(0, 80), tag: e.tagName.toLowerCase(),
      tipo: e.type || '', id: e.id || '', name: e.name || '', obligatorio: !!e.required, soloLectura: !!(e.readOnly || e.disabled),
      visible: e.offsetParent !== null, lleno: e.type === 'checkbox' || e.type === 'radio' ? e.checked : !!String(e.value || '').trim(),
      dentroDeTabla: !!e.closest('table'), maxlength: e.maxLength > 0 ? e.maxLength : null };
    if (e.tagName === 'SELECT') c.opciones = [...e.options].map(o => o.text.trim()).slice(0, 80);
    return c;
  });
  const secciones = [...document.querySelectorAll('.card-header,.panel-heading,legend,h3,h4,h5,.box-header,.accordion-button')]
    .filter(e => e.offsetParent !== null).map(e => e.innerText.trim().replace(/\\s+/g, ' ').slice(0, 60)).filter(Boolean);
  const tablas = [...document.querySelectorAll('table')].filter(vis).map(t => ({
    columnas: [...t.querySelectorAll('thead th')].map(th => th.innerText.trim()), filas: t.querySelectorAll('tbody tr').length }));
  return { url: location.pathname, titulo: document.title, secciones, campos, tablas };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serie", default="FQQ1")
    ap.add_argument("--numero", required=True)
    ap.add_argument("--salida", default="pantallas")
    a = ap.parse_args()
    correo, clave = os.environ.get("QUESITO_CORREO", ""), os.environ.get("QUESITO_CLAVE", "")
    if not (correo and clave):
        sys.exit("Faltan los secretos QUESITO_CORREO / QUESITO_CLAVE en el Environment de la empresa.")
    os.makedirs(a.salida, exist_ok=True)
    n, red, informe = [0], [], {"pasos": []}
    bloquear = [False]

    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA)
        pag = ctx.new_page()
        pag.on("dialog", lambda d: (print("  ⛔ Ventana de confirmación rechazada:", d.message[:120]), d.dismiss()))

        # Red: anotar a qué direcciones llama la página (sin datos) y, en el formulario, no dejar enviar nada.
        def ruta(route, req):
            u = urlsplit(req.url)
            if "quesito" in u.netloc and req.resource_type in ("xhr", "fetch", "document"):
                red.append(f"{req.method} {u.path}" + (" (campos: " + ", ".join(sorted(_campos_post(req))) + ")" if req.method != "GET" else ""))
            if bloquear[0] and req.method not in ("GET", "HEAD", "OPTIONS"):
                print("  ⛔ Envío bloqueado (solo se mira):", req.method, u.path)
                return route.abort()
            return route.continue_()
        ctx.route("**/*", ruta)

        def foto(nombre):
            n[0] += 1
            r = os.path.join(a.salida, f"{n[0]:02d}_{nombre}.png")
            tapar = [pag.locator("input:not([type=checkbox]):not([type=radio]):not([type=password]), textarea, select, td")]
            try:
                pag.screenshot(path=r, full_page=True, mask=tapar, mask_color="#9aa0a6")
                print("  📷", r)
            except Exception as e:
                print("  (sin foto:", str(e)[:80], ")")

        def anotar(nombre):
            try:
                pag.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            nav_ = pag.evaluate(JS_NAVEGACION)
            print(f"\n=== {nombre}  ({urlsplit(pag.url).path})")
            for t in dict.fromkeys(nav_):
                print("   ·", t)
            informe["pasos"].append({"paso": nombre, "url": urlsplit(pag.url).path, "navegacion": list(dict.fromkeys(nav_))})
            foto(nombre)

        def clic_texto(patron, donde=None, exacto=False):
            loc = (donde or pag).get_by_text(re.compile(patron, re.I), exact=exacto)
            for i in range(loc.count()):
                el = loc.nth(i)
                if el.is_visible():
                    txt = (el.inner_text() or "").strip()
                    if PELIGRO.search(txt) and not re.search(r"generar\s+gu[ií]a", txt, re.I):
                        raise RuntimeError("Me negué a hacer clic en: " + txt[:60])
                    el.click()
                    return txt
            return None

        try:
            # 1) Ingreso
            pag.goto(INICIO, wait_until="networkidle", timeout=60000)
            anotar("pantalla_ingreso")
            cap = pag.evaluate("""() => ({
                casilla: [...document.querySelectorAll('iframe[src*=recaptcha]')].some(f => /anchor/.test(f.src) && f.offsetParent !== null && !/size=invisible/.test(f.src)),
                invisible: !!document.querySelector('.grecaptcha-badge, iframe[src*="size=invisible"], script[src*="recaptcha/api.js?render="]'),
                imagen: !!document.querySelector('img[src*=captcha i]') })""")
            informe["captcha"] = cap
            print("\nCaptcha en el ingreso:", cap)
            if cap["casilla"] or cap["imagen"]:
                print("⚠️ Hay un captcha visible (casilla 'No soy un robot' o imagen). Me detengo aquí (no intento resolverlo).")
                sys.exit(1)
            # Ingreso en dos pasos: correo → "Continuar" → contraseña
            campo = pag.locator("input[type=email]:visible, input[name*=mail i]:visible, input[name*=correo i]:visible, input[name*=usuario i]:visible, input[name*=user i]:visible").first
            campo.fill(correo)
            clave_ = pag.locator("input[type=password]").first
            if not clave_.is_visible():
                pag.locator("button:has-text('Continuar'):visible, input[type=submit][value*=Continuar i]:visible").first.click()
                try:
                    pag.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    pass
                pag.wait_for_timeout(3000)
                anotar("despues_de_continuar")
                print("Campos visibles:", pag.evaluate("""() => [...document.querySelectorAll('input,button,select')].filter(e => e.offsetParent !== null)
                    .map(e => e.tagName + ' ' + (e.type || '') + ' ' + (e.name || e.id || '') + ' ' + (e.innerText || e.value && e.type === 'submit' ? (e.innerText || e.value).trim().slice(0, 30) : ''))"""))
                print("Mensajes:", pag.evaluate("""() => [...document.querySelectorAll('.alert,.error,.invalid-feedback,.help-block,.toast,.flash,[role=alert],.text-danger')]
                    .filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).filter(Boolean)"""))
                print("Captcha visible:", pag.evaluate("() => [...document.querySelectorAll('iframe[src*=recaptcha], iframe[src*=hcaptcha], iframe[src*=turnstile]')].filter(f => f.offsetParent !== null).map(f => f.src.split('?')[0])"))
                clave_ = pag.locator("input[type=password]:visible").first
                if not clave_.count() and pag.locator("iframe[src*='api2/anchor']").count():
                    if not captcha_google(pag, a.salida, foto):
                        sys.exit(1)
                    pag.locator("button:has-text('Continuar'):visible, input[type=submit][value*=Continuar i]:visible").first.click()
                    pag.wait_for_timeout(3000)
                    anotar("despues_del_captcha")
                    clave_ = pag.locator("input[type=password]:visible").first
                if not clave_.count():
                    sys.exit("❌ Después de 'Continuar' no apareció el campo de contraseña. Revise los datos de arriba.")
            clave_.fill(clave)
            pag.locator("button[type=submit]:visible, input[type=submit]:visible, button:has-text('Ingresar'):visible, button:has-text('Iniciar'):visible").first.click()
            pag.wait_for_load_state("networkidle", timeout=60000)
            pag.wait_for_timeout(2000)
            if pag.locator("input[type=password]").count() and pag.locator("input[type=password]").first.is_visible():
                anotar("sigue_en_ingreso")
                avisos = pag.evaluate("""() => [...document.querySelectorAll('.alert,.error,.invalid-feedback,.help-block,.toast,.flash,[role=alert]')]
                    .filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).filter(Boolean)""")
                print("Mensajes en pantalla:", avisos)
                print("Captcha después de 'Continuar':", pag.evaluate("() => [...document.querySelectorAll('iframe[src*=recaptcha]')].filter(f => f.offsetParent !== null).map(f => f.src.split('?')[0])"))
                sys.exit("❌ No pude entrar: sigue la pantalla de ingreso (¿clave, correo o captcha?). Revise la foto.")
            anotar("escritorio")

            # 2) Comprobantes
            if not clic_texto(r"^\s*Comprobantes\s*$"):
                clic_texto(r"Comprobantes")
            anotar("comprobantes")

            # 3) Buscar Documento: serie y número
            clic_texto(r"Buscar\s+Documento")
            pag.wait_for_timeout(1500)
            anotar("buscar_documento")
            modal = pag.locator(".modal.show, .modal.in, [role=dialog]").last
            caja = modal if modal.count() else pag
            entradas = caja.locator("input:visible")
            serie_ok = False
            for i in range(entradas.count()):
                e = entradas.nth(i)
                desc = " ".join(filter(None, [e.get_attribute("name"), e.get_attribute("id"), e.get_attribute("placeholder")])).lower()
                if "serie" in desc:
                    e.fill(a.serie); serie_ok = True
                elif "num" in desc or "correl" in desc:
                    e.fill(str(a.numero))
            if not serie_ok and entradas.count() >= 2:
                entradas.nth(0).fill(a.serie); entradas.nth(1).fill(str(a.numero))
            boton = caja.locator("button:has-text('Buscar'), input[type=submit], button[type=submit]").last
            boton.click()
            pag.wait_for_timeout(2500)
            anotar("resultado_busqueda")

            # 4) Opciones → Generar GUIA DE REMISIÓN REMITENTE
            fila = pag.locator("tr", has_text=f"{a.serie}").filter(has_text=str(a.numero)).first
            (fila.get_by_text(re.compile(r"Opciones", re.I)).first if fila.count() else pag.get_by_text(re.compile(r"Opciones", re.I)).first).click()
            pag.wait_for_timeout(1000)
            opciones = pag.evaluate("""() => [...document.querySelectorAll('.dropdown-menu.show a, .dropdown-menu.show button, .open .dropdown-menu a, [role=menu] [role=menuitem]')]
                .filter(e => e.offsetParent !== null).map(e => e.innerText.trim().replace(/\\s+/g, ' '))""")
            print("\n=== Menú Opciones de la factura:")
            for o in opciones:
                print("   ·", re.sub(r"\d{3,}", "N°", o))   # sin números de documentos
            informe["opciones_factura"] = [re.sub(r"\d{3,}", "N°", o) for o in opciones]
            foto("menu_opciones")
            if not clic_texto(r"Generar\s+GU[IÍ]A\s+DE\s+REMISI[OÓ]N\s+REMITENTE"):
                sys.exit("❌ No encontré 'Generar GUIA DE REMISIÓN REMITENTE' en Opciones.")

            # 5) Formulario: desde aquí NO se envía nada
            bloquear[0] = True
            pag.wait_for_load_state("networkidle", timeout=60000)
            pag.wait_for_timeout(3000)
            anotar("formulario_guia_inicial")
            # Abrir todas las secciones plegadas (encabezados con + / colapsables), sin tocar botones de acción
            abiertas = 0
            for sel in ["[data-toggle=collapse]", "[data-bs-toggle=collapse]", ".accordion-button.collapsed", ".card-header", ".panel-heading", ".box-header [data-widget=collapse]"]:
                loc = pag.locator(sel)
                for i in range(loc.count()):
                    el = loc.nth(i)
                    try:
                        if el.is_visible() and not PELIGRO.search(el.inner_text() or ""):
                            el.click(timeout=2000); abiertas += 1; pag.wait_for_timeout(400)
                    except Exception:
                        pass
            print(f"\n(Secciones desplegadas: {abiertas})")
            pag.wait_for_timeout(1500)
            est = pag.evaluate(JS_ESTRUCTURA)
            informe["formulario"] = est
            foto("formulario_guia_completo")
            print("\n=== FORMULARIO 'Nueva Guía de Remisión'")
            print("Secciones:", " | ".join(dict.fromkeys(est["secciones"])))
            for t in est["tablas"]:
                print("Tabla:", t["columnas"], "filas:", t["filas"])
            sec = None
            for c in est["campos"]:
                if c["tipo"] == "hidden":
                    continue
                if c["seccion"] != sec:
                    sec = c["seccion"]; print(f"\n  [{sec or '—'}]")
                extra = []
                if c["obligatorio"]: extra.append("obligatorio")
                if c["soloLectura"]: extra.append("solo lectura")
                if c["lleno"]: extra.append("precargado")
                if c["dentroDeTabla"]: extra.append("en tabla de productos")
                if not c["visible"]: extra.append("oculto")
                print(f"   - {c['etiqueta'] or '(sin etiqueta)'}  <{c['tag']} {c['tipo']} name={c['name'] or c['id']}>" + (f"  ({', '.join(extra)})" if extra else ""))
                if c.get("opciones") and not c["dentroDeTabla"] and CATALOGO.search(c["etiqueta"] + " " + c["name"] + " " + c["id"]):
                    print("       opciones:", " / ".join(c["opciones"][:25]) + (" …" if len(c["opciones"]) > 25 else ""))
            botones = [b for b in pag.evaluate(JS_NAVEGACION)]
            print("\nBotones del formulario (NO se presionó ninguno de acción):", " | ".join(dict.fromkeys(botones))[:1500])
        finally:
            informe["red"] = list(dict.fromkeys(red))
            # Listas que pueden traer datos de clientes o productos: se deja solo cuántas opciones tienen.
            for c in informe.get("formulario", {}).get("campos", []):
                if "opciones" in c and (c.get("dentroDeTabla") or not CATALOGO.search(c["etiqueta"] + " " + c["name"] + " " + c["id"])):
                    c["opciones"] = f"{len(c['opciones'])} opciones (no se guardan)"
            with open(os.path.join(a.salida, "estructura.json"), "w", encoding="utf-8") as f:
                json.dump(informe, f, ensure_ascii=False, indent=1)
            print("\n=== Direcciones que usa la página (para el robot):")
            for r in informe["red"]:
                print("   ", r)
            nav.close()


def captcha_google(pag, salida, foto):
    """Marca la casilla "No soy un robot". Si Google la acepta, sigue (True). Si pide imágenes,
    guarda la imagen del reto y la deja en el log (base64) para mostrársela a la persona; no la resuelve."""
    ancla = pag.frame_locator("iframe[src*='api2/anchor']").first
    ancla.locator("#recaptcha-anchor").click()
    print("\n☑️ Marqué 'No soy un robot'.")
    for _ in range(10):
        pag.wait_for_timeout(1000)
        if ancla.locator("#recaptcha-anchor[aria-checked=true]").count():
            print("✅ Google aceptó sin pedir imágenes.")
            return True
    reto = pag.locator("iframe[src*='api2/bframe']").first
    if not reto.is_visible():
        print("⚠️ No aceptó ni mostró imágenes.")
        foto("captcha_sin_reto")
        return False
    cuerpo = pag.frame_locator("iframe[src*='api2/bframe']").first
    try:
        texto = cuerpo.locator(".rc-imageselect-desc-wrapper, .rc-imageselect-instructions, .rc-doscaptcha-header").first.inner_text(timeout=5000)
    except Exception:
        texto = ""
    print("🧩 Google pide un reto de imágenes:", " ".join(texto.split()))
    if cuerpo.locator(".rc-doscaptcha-header").count():
        print("⛔ Google dice que hay 'consultas automáticas' desde esta red: no deja resolverlo.")
    ruta = os.path.join(salida, "captcha_reto.png")
    reto.screenshot(path=ruta)
    import base64
    with open(ruta, "rb") as f:
        print("CAPTCHA_PNG_BASE64_INICIO")
        b = base64.b64encode(f.read()).decode()
        for i in range(0, len(b), 4000):
            print(b[i:i + 4000])
        print("CAPTCHA_PNG_BASE64_FIN")
    print("(Por ahora no hay forma de enviar la respuesta: me detengo aquí.)")
    return False


def _campos_post(req):
    try:
        d = req.post_data or ""
    except Exception:
        return set()
    if d.startswith("{"):
        try:
            return set(json.loads(d).keys())
        except Exception:
            return set()
    return {kv.split("=")[0] for kv in d.split("&") if "=" in kv and "pass" not in kv.split("=")[0].lower()}


if __name__ == "__main__":
    main()
