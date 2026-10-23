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
import datetime
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
  const vis = e => e.offsetParent !== null || e.type === 'hidden' || e.tagName === 'SELECT' || /^despatch_advice\[/.test(e.name || '');
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
    if not (correo and clave) and not os.environ.get("QUESITO_SESION", "").strip():
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
                print("   ·", re.sub(r"\b\d{8}(\d{3})?\b.*", "[cliente]", t))
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
                    try:
                        el.click(timeout=5000)
                    except Exception:   # otra ventana (reveal-overlay) tapa el elemento: clic directo
                        el.evaluate("e => e.click()")
                    return txt
            return None

        try:
            sesion = os.environ.get("QUESITO_SESION", "").strip()
            if sesion:
                # 🍪 Sesión guardada: se entra con la sesión que la persona abrió en su Chrome (sin captcha).
                galletas = leer_sesion(sesion)
                ctx.add_cookies(galletas)
                print("\n🍪 Entrando con la sesión guardada (" + str(len(galletas)) + " cookies). Vencen:")
                for g in galletas:
                    vence = g.get("expires", -1)
                    print("   ·", g["name"], "→", "al cerrar el navegador (sesión)" if not vence or vence < 0 else datetime.datetime.utcfromtimestamp(vence).strftime("%d/%m/%Y %H:%M UTC"))
                # /login lleva al escritorio si la sesión vale; si no, se prueban direcciones típicas del panel.
                dentro = False
                for ruta in ["", "/escritorio", "/dashboard", "/panel", "/comprobantes"]:
                    try:
                        resp = pag.goto(INICIO.rsplit("/login", 1)[0] + ruta if ruta else INICIO, wait_until="networkidle", timeout=60000)
                    except Exception:
                        continue
                    pag.wait_for_timeout(1500)
                    en_login = "/login" in pag.url or pag.locator("input[type=password]:visible, input[name='user[email]']:visible").count()
                    del_panel = pag.get_by_text(re.compile(r"Comprobantes|Escritorio|Cerrar sesi[oó]n", re.I)).count()
                    if not en_login and resp and resp.status < 400 and del_panel and urlsplit(pag.url).path not in ("", "/"):
                        dentro = True
                        break
                if not dentro:
                    anotar("sesion_vencida")
                    msg = "La sesión guardada de Quesito ya no sirve (venció o se cerró). Entre a Quesito en su Chrome y vuelva a copiarla en QUESITO_SESION."
                    print("❌ " + msg)
                    if os.environ.get("BOT_URL") and os.environ.get("GITHUB_RUN_ID"):
                        _bot(os.environ["BOT_URL"], {"accion": "fin", "run": os.environ["GITHUB_RUN_ID"], "ok": False, "texto": msg})
                    sys.exit(1)
                print("✅ La sesión guardada funciona: entré sin captcha.")
            else:
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
                        pag.wait_for_timeout(3000)
                        if not pag.locator("input[type=password]:visible").count():
                            seguir = pag.locator("button:has-text('Continuar'):visible, input[type=submit][value*=Continuar i]:visible")
                            if seguir.count():
                                seguir.first.click()
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
            # Ventana de Quesito: serie, numero, tipo de documento (voucher_id) y botón "Buscar" (input submit name=commit).
            pag.locator("input[name=serie]:visible").first.fill(a.serie)
            pag.locator("input[name=numero]:visible").first.fill(str(a.numero))
            tipo = pag.locator("select[name=voucher_id]:visible")
            if tipo.count():
                ops = tipo.first.locator("option").all_inner_texts()
                elegido = next((o for o in ops if ("FACTURA" if a.serie.upper().startswith("F") else "BOLETA") in o.upper()), None)
                if elegido:
                    tipo.first.select_option(index=ops.index(elegido))
            # Enter en el número envía el formulario (a veces otra ventana de Quesito tapa el botón "Buscar").
            pag.locator("input[name=numero]:visible").first.press("Enter")
            pag.wait_for_timeout(2500)
            anotar("resultado_busqueda")

            # 4) Opciones → Generar GUIA DE REMISIÓN REMITENTE
            fila = pag.locator("tr", has_text=f"{a.serie}").filter(has_text=str(a.numero)).first
            opc = fila.get_by_text(re.compile(r"Opciones", re.I)).first if fila.count() else pag.get_by_text(re.compile(r"Opciones", re.I)).first
            try:
                opc.click(timeout=8000)
            except Exception:
                opc.evaluate("e => e.click()")
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
            for t in ["DATOS DEL TRASLADO", "DATOS DEL TRANSPORTISTA", "DATOS DEL CONDUCTOR", "DATOS DEL VEH", "PUNTO DE PARTIDA", "PUNTO DE LLEGADA", "OBSERVACIONES"]:
                loc = pag.get_by_text(re.compile("^\\s*" + t, re.I))
                for i in range(loc.count()):
                    try:
                        el = loc.nth(i)
                        if el.is_visible():
                            el.evaluate("e => e.click()"); abiertas += 1; pag.wait_for_timeout(700)
                            break   # un solo clic por sección (dos la vuelven a cerrar)
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
            botones = [re.sub(r"\b\d{8}(\d{3})?\b.*", "[cliente]", b) for b in pag.evaluate(JS_NAVEGACION)]
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
    se la pide resolver a la persona por Telegram/WhatsApp (resolver_con_persona)."""
    reto = pag.locator("iframe[src*='api2/bframe']").first
    if not (reto.count() and reto.is_visible()):
        # Casilla visible (las invisibles traen size=invisible y no tienen casilla)
        ancla = pag.frame_locator("iframe[src*='api2/anchor']:not([src*='size=invisible'])").first
        try:
            ancla.locator("#recaptcha-anchor").click(timeout=8000)
            print("\n☑️ Marqué 'No soy un robot'.")
        except Exception:
            print("\n(No hay casilla 'No soy un robot' para marcar: es un reCAPTCHA invisible.)")
        for _ in range(10):
            pag.wait_for_timeout(1000)
            if ancla.locator("#recaptcha-anchor[aria-checked=true]").count():
                print("✅ Google aceptó sin pedir imágenes.")
                return True
            if reto.count() and reto.is_visible():
                break
    else:
        print("\n(Google abrió directamente el reto de imágenes.)")
    if not reto.is_visible():
        print("⚠️ No aceptó ni mostró imágenes.")
        foto("captcha_sin_reto")
        return False
    return resolver_con_persona(pag, salida, foto, reto)


JS_NUMERAR = """() => {
  document.querySelectorAll('.tgc-n').forEach(e => e.remove());
  const t = [...document.querySelectorAll('td.rc-imageselect-tile')];
  t.forEach((td, i) => {
    const d = document.createElement('div');
    d.className = 'tgc-n'; d.textContent = i + 1;
    d.style.cssText = 'position:absolute;left:3px;top:3px;background:#d50000;color:#fff;font:bold 17px Arial;' +
      'padding:1px 7px;border-radius:10px;z-index:99;pointer-events:none;box-shadow:0 0 2px #000';
    td.style.position = 'relative'; td.appendChild(d);
  });
  return t.length;
}"""


def resolver_con_persona(pag, salida, foto, reto):
    """La persona resuelve el captcha desde Telegram/WhatsApp: se numeran las casillas, la foto va a la rama
    quesito-captcha, el bot de Cobranzas se la manda y aquí se espera su respuesta ("1 6 9", "0", "otra")."""
    bot, run, repo, tok = (os.environ.get(k, "") for k in ("BOT_URL", "GITHUB_RUN_ID", "GITHUB_REPOSITORY", "GITHUB_TOKEN"))
    if not (bot and run and repo and tok):
        foto("captcha_reto")
        print("⚠️ Falta la conexión con el bot (BOT_URL / GITHUB_TOKEN): no puedo pedir ayuda. Me detengo.")
        return False
    aviso = ""
    for ronda in range(1, 16):
        marco = next((f for f in pag.frames if "api2/bframe" in f.url), None)
        if not marco:
            return False
        if marco.locator(".rc-doscaptcha-header").count():
            print("⛔ Google dice que hay 'consultas automáticas' desde esta red: no deja resolverlo.")
            _bot(bot, {"accion": "fin", "run": run, "ok": False, "texto": "Google bloqueó el captcha desde la red de GitHub. Intente más tarde."})
            return False
        try:
            texto = " ".join(marco.locator(".rc-imageselect-desc-wrapper, .rc-imageselect-instructions").first.inner_text(timeout=5000).split())
        except Exception:
            texto = ""
        casillas = marco.evaluate(JS_NUMERAR)
        pag.wait_for_timeout(300)
        ruta = os.path.join(salida, f"captcha_{ronda}.png")
        reto.screenshot(path=ruta)
        print(f"\n🧩 Ronda {ronda}: {texto} ({casillas} casillas)")
        _subir_foto(repo, tok, f"{run}/{ronda}.png", ruta)
        r = _bot(bot, {"accion": "captcha", "run": run, "ronda": ronda, "pregunta": texto, "casillas": casillas, "aviso": aviso,
                       "empresa": os.environ.get("EMPRESA", "")})
        aviso = ""
        print("   Aviso al bot:", r)
        resp = None
        for _ in range(60):   # hasta 3 minutos
            pag.wait_for_timeout(3000)
            x = _bot(bot, {"accion": "respuesta", "run": run, "ronda": ronda})
            if x.get("respuesta"):
                resp = x["respuesta"]
                break
        if not resp:
            print("⌛ Nadie respondió a tiempo.")
            _bot(bot, {"accion": "fin", "run": run, "ok": False, "texto": "Nadie respondió el captcha a tiempo. Vuelva a lanzar el robot cuando pueda responder."})
            return False
        print("   Respuesta:", resp)
        if resp == "cancelar":
            return False
        if resp == "otra":
            marco.locator("#recaptcha-reload-button").click()
            pag.wait_for_timeout(2500)
            continue
        dinamico = "ya no quede ninguna" in texto.lower() or "none left" in texto.lower()
        if resp != "0":
            tiles = marco.locator("td.rc-imageselect-tile")
            for n in [int(x) for x in resp.split(",")]:
                if 1 <= n <= tiles.count():
                    tiles.nth(n - 1).click()
                    pag.wait_for_timeout(400)
        if dinamico and resp != "0":
            pag.wait_for_timeout(4500)   # aparecen fotos nuevas en las casillas marcadas: se vuelve a preguntar
            continue
        marco.locator("#recaptcha-verify-button").click()
        pag.wait_for_timeout(3500)
        if not reto.is_visible():
            print("✅ Captcha superado.")
            _bot(bot, {"accion": "fin", "run": run, "ok": True})
            return True
        marco = next((f for f in pag.frames if "api2/bframe" in f.url), None)
        if marco:
            aviso = " ".join(" ".join(marco.locator(s).first.inner_text() .split()) for s in
                             (".rc-imageselect-error-select-more", ".rc-imageselect-error-dynamic-more", ".rc-imageselect-incorrect-response")
                             if marco.locator(s).count() and marco.locator(s).first.is_visible())
        print("   Google pide otra ronda." + (f" Dijo: {aviso}" if aviso else ""))
    _bot(bot, {"accion": "fin", "run": run, "ok": False, "texto": "Google pidió 15 rondas sin aceptar; me detengo."})
    return False


def _bot(url, cuerpo):
    """Llama al bot de Cobranzas (?canal=gh). Apps Script responde con una redirección que se sigue con GET."""
    import urllib.request
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "canal=gh", data=json.dumps(cuerpo).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def _subir_foto(repo, tok, ruta_repo, archivo):
    """Deja la foto en la rama quesito-captcha (la crea vacía si no existe) con la API de GitHub."""
    import base64
    import urllib.request
    api = os.environ.get("GITHUB_API_URL", "https://api.github.com") + f"/repos/{repo}"
    h = {"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"}

    def llamar(metodo, ruta, cuerpo=None):
        req = urllib.request.Request(api + ruta, data=json.dumps(cuerpo).encode() if cuerpo is not None else None, headers=h, method=metodo)
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    with open(archivo, "rb") as f:
        contenido = base64.b64encode(f.read()).decode()
    llamar("PUT", f"/contents/{ruta_repo}", {"message": "Captcha de Quesito (temporal)", "content": contenido, "branch": "quesito-captcha"})


def leer_sesion(texto):
    """Cookies de Quesito copiadas del Chrome de la persona. Acepta el JSON que exporta la extensión
    Cookie-Editor ([{name, value, domain, path, expirationDate, httpOnly, secure, sameSite}, …]) o el texto
    "nombre=valor; nombre2=valor2". Los valores nunca se imprimen."""
    texto = texto.strip()
    out = []
    if texto.startswith("[") or texto.startswith("{"):
        datos = json.loads(texto)
        datos = datos if isinstance(datos, list) else datos.get("cookies", [])
        for c in datos:
            # Si al copiar/pegar el dominio quedó como enlace "[www.quesito.pe](https://…)", se limpia.
            dom = re.sub(r"^\[([^\]]+)\]\(.*\)$", r"\1", str(c.get("domain") or ".quesito.pe").strip())
            g = {"name": c["name"], "value": c["value"], "domain": dom, "path": c.get("path") or "/",
                 "httpOnly": bool(c.get("httpOnly")), "secure": bool(c.get("secure", True))}
            vence = c.get("expirationDate") or c.get("expires")
            if vence and float(vence) > 0:
                g["expires"] = float(vence)
            ss = str(c.get("sameSite") or "").lower()
            g["sameSite"] = {"strict": "Strict", "lax": "Lax", "no_restriction": "None", "none": "None"}.get(ss, "Lax")
            if g["sameSite"] == "None":
                g["secure"] = True
            out.append(g)
    else:
        for par in texto.split(";"):
            if "=" in par:
                n, v = par.strip().split("=", 1)
                out.append({"name": n.strip(), "value": v.strip(), "domain": "www.quesito.pe", "path": "/", "secure": True, "sameSite": "Lax"})
    out = [g for g in out if "quesito" in g["domain"] or os.environ.get("QUESITO_URL")]
    if not out:
        sys.exit("❌ QUESITO_SESION no trae cookies de quesito.pe. Vuelva a copiarla (ver guias/README.md).")
    return out


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
