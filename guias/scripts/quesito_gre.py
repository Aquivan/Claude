"""
quesito_gre.py — Guía de Remisión Remitente en Quesito.pe desde una factura (proyecto "Guías de Remisión · Grupo").

El caso es el mismo que arma el bot para la guía por SUNAT (cobranzas/telegram/TG_GRE.js): el robot lo pide al bot
(accion gre_caso) con el código del caso; los datos (chofer, placas, cliente) nunca pasan por GitHub.

Camino (el mismo que recorre quesito_explorar.py):
  Comprobantes → Buscar Documento (serie y número de la factura) → Opciones → "Generar GUIA DE REMISIÓN REMITENTE"
  → formulario "Nueva Guía de Remisión" (Quesito ya trae cliente, productos, partida y la factura relacionada)
  → se llenan traslado, peso, bultos, transporte, llegada y, si hace falta, cantidades / líneas de una guía parcial.

Seguridad:
  - modo vista: llena todo, manda la foto al chat y NO crea la guía. Además de no tocar "Crear Guía", bloquea en la red
    todo envío de datos a Quesito desde el formulario (POST/PUT/PATCH/DELETE): ni por error se puede crear.
    Queda abierta unos minutos esperando ✅ Emitir (accion gre_espera, como el robot de SUNAT).
  - modo emitir (o aprobado en la vista): solo con la clave de ESTE caso (huella sha256 del caso que aprobó la persona).
  - Si no está seguro (ubigeo de llegada, líneas de productos, sesión vencida), se detiene y pregunta; no adivina.
  - Nunca imprime claves ni datos de clientes en el registro (el repositorio es público).

Entra con la sesión copiada del Chrome de la persona (secreto QUESITO_SESION del Environment de la empresa), sin captcha.
"""
import base64
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from quesito_explorar import leer_sesion   # noqa: E402  (mismo lector de la sesión copiada)

BASE = "https://www.quesito.pe"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
F = "despatch_advice"
MOTIVOS = {"venta": "01", "compra": "02", "traslado entre establecimientos de la misma empresa": "04", "consignacion": "05",
           "devolucion": "06", "otros": "13", "venta sujeta a confirmacion del comprador": "14"}
ESPERA_MIN = 12
PASO = [""]
NOTAS = []   # avisos para la persona (lo que no se pudo poner, lo que conviene revisar)


class Alto(Exception):
    """Se detiene sin crear la guía y le explica a la persona qué falta."""


def simple(t):
    t = unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]", " ", t)).strip().upper()


def paso(t):
    PASO[0] = t
    print("•", t, flush=True)


def bot(cuerpo):
    url = os.environ.get("BOT_URL", "")
    if not url:
        return {"ok": False, "error": "sin BOT_URL"}
    cuerpo = dict(cuerpo, run=os.environ.get("GITHUB_RUN_ID", ""), caso=os.environ.get("CASO", ""))
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "canal=gh", data=json.dumps(cuerpo).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode() or "{}")
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def fin(ok, texto, **extra):
    bot(dict({"accion": "gre_fin", "ok": ok, "texto": texto}, **extra))
    open(os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "gre_avisado"), "w").close()


def foto(pag):
    return pag.screenshot(type="jpeg", quality=70, full_page=True)


def esperar(pag, ms=1200):
    try:
        pag.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    pag.wait_for_timeout(ms)


# ============================================================ ubigeo (catálogo 13 de SUNAT, el mismo de la hoja de Guías)

def ubigeos():
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps_script", "GR_Ubigeos.js")
    return [x.split("|") for x in re.findall(r"'(\d{6}\|[^']+)'", open(ruta, encoding="utf-8").read())]


def ubigeo_de(direccion, dado=""):
    """Código de 6 dígitos de una dirección ("... SANTA ANITA - LIMA - LIMA"). '' si no es seguro (no adivina).
    - Un distrito cuenta aunque falte una palabra de título ("GREGORIO ALBARRACIN LANCHIPA" = "CORONEL GREGORIO ALBARRACIN LANCHIPA").
    - El distrito que se llama igual que su provincia (LIMA, TACNA) solo vale si no hay otro distrito en la dirección y el nombre
      aparece al menos dos veces ("CERCADO DE LIMA - LIMA - LIMA"); "Calle 1 Tacna" no dice en qué distrito de Tacna es."""
    if re.fullmatch(r"\d{6}", str(dado or "").strip()):
        return str(dado).strip()
    d = " " + simple(direccion) + " "
    pal = set(d.split())
    veces = lambda t: len(re.findall(r"(?<= )" + re.escape(t) + r"(?= )", d))
    cands = []
    for cod, dep, prov, dist in ubigeos():
        sd, sp, sdp = simple(dist), simple(prov), simple(dep)
        w = sd.split()
        presentes = sum(1 for x in w if x in pal)
        completo = " " + sd + " " in d
        if not (completo or (len(w) >= 3 and presentes >= len(w) - 1)):
            continue
        capital = sd == sp
        extra = (2 if (" " + sp + " " in d and (not capital or veces(sp) >= 2)) else 0) + (1 if " " + sdp + " " in d and sdp != sp else 0)
        cands.append({"cod": cod, "capital": capital, "puntos": extra, "largo": presentes, "veces": veces(sd) if completo else 1})
    if not cands:
        return ""
    otros = [c for c in cands if not c["capital"]]
    if otros:
        otros.sort(key=lambda c: (c["puntos"], c["largo"]), reverse=True)
        top = [c for c in otros if (c["puntos"], c["largo"]) == (otros[0]["puntos"], otros[0]["largo"])]
        # Seguro: un solo mejor, y confirmado por la provincia/departamento o con nombre largo (2+ palabras).
        return top[0]["cod"] if len(top) == 1 and (top[0]["puntos"] >= 2 or top[0]["largo"] >= 2) else ""
    caps = [c for c in cands if c["veces"] >= 2]
    return caps[0]["cod"] if len(caps) == 1 else ""


# ============================================================ formulario de Quesito

def poner(pag, nombre, valor, campo="input"):
    """Escribe en un campo del formulario aunque esté plegado (los de Rails van igual en el envío)."""
    sel = f"{campo}[name='{F}[{nombre}]']"
    if not pag.locator(sel).count():
        raise Alto(f"No encontré el campo «{nombre}» en el formulario de Quesito (¿cambió la página?). No se creó nada.")
    pag.evaluate("""([s, v]) => { const e = document.querySelector(s); e.value = v;
        e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); }""", [sel, str(valor)])


def elegir(pag, nombre, texto_o_valor, por="texto"):
    """Elige en un <select> (también los que muestra select2) por el texto de la opción o por su valor."""
    sel = f"select[name='{F}[{nombre}]']"
    if not pag.locator(sel).count():
        raise Alto(f"No encontré la lista «{nombre}» en Quesito. No se creó nada.")
    ok = pag.evaluate("""([s, q, por]) => {
        const e = document.querySelector(s);
        const norm = t => (t || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase().trim();
        const o = [...e.options].find(o => por === 'valor' ? o.value === q : norm(o.text).startsWith(norm(q)) || norm(o.text) === norm(q));
        if (!o) return false;
        e.value = o.value;
        if (window.jQuery) { window.jQuery(e).val(o.value).trigger('change'); } else e.dispatchEvent(new Event('change', {bubbles: true}));
        return true; }""", [sel, str(texto_o_valor), por])
    if not ok:
        raise Alto(f"En Quesito no está la opción «{texto_o_valor}» de «{nombre}». No se creó nada.")


def fecha_form(pag, nombre, ddmmaaaa):
    d, m, a = [int(x) for x in re.findall(r"\d+", ddmmaaaa)[:3]]
    for parte, v in (("3i", d), ("2i", m), ("1i", a)):
        elegir(pag, f"{nombre}({parte})", str(v), por="valor")


def abrir_secciones(pag):
    for t in ["DATOS DEL TRASLADO", "DATOS DEL TRANSPORTISTA", "DATOS DEL CONDUCTOR", "PUNTO DE PARTIDA", "PUNTO DE LLEGADA", "OBSERVACIONES"]:
        loc = pag.get_by_text(re.compile("^\\s*" + t, re.I))
        for i in range(loc.count()):
            el = loc.nth(i)
            try:
                if el.is_visible():
                    el.evaluate("e => e.click()")   # un solo clic por sección (dos la vuelven a cerrar)
                    pag.wait_for_timeout(500)
                    break
            except Exception:
                pass


def lineas(pag):
    """Productos que Quesito trajo de la factura: [{i, descripcion, cantidad}] (las no eliminadas)."""
    return pag.evaluate("""(F) => [...document.querySelectorAll(`input[name^="${F}[despatch_advice_lines_attributes]"][name$="[cantidad]"]`)]
      .map(e => { const i = (e.name.match(/\\[(\\d+)\\]\\[cantidad\\]/) || [])[1];
        const caja = e.closest('.nested-fields, .fields, tr, .row, .item') || e.parentElement;
        const borrar = document.querySelector(`input[name="${F}[despatch_advice_lines_attributes][${i}][_destroy]"]`);
        const vivo = caja && caja.offsetParent !== null && !(borrar && /^(1|true)$/.test(borrar.value));
        const txt = caja ? caja.innerText.replace(/\\s+/g, ' ').trim() : '';
        const det = document.querySelector(`input[name="${F}[despatch_advice_lines_attributes][${i}][descripcion]"]`);
        return { i: Number(i), cantidad: e.value, texto: txt.slice(0, 160) + ' ' + (det ? det.value : ''), vivo }; })
      .filter(x => x.vivo)""", F)


def eliminar_linea(pag, i):
    caja = pag.locator(f"input[name='{F}[despatch_advice_lines_attributes][{i}][cantidad]']").first
    ok = caja.evaluate("""e => { const c = e.closest('.nested-fields, .fields, tr, .row, .item') || e.parentElement;
        const a = [...c.querySelectorAll('a, button')].find(x => /eliminar|quitar|borrar/i.test(x.innerText || x.title || ''));
        if (!a) return false; a.click(); return true; }""")
    if not ok:
        raise Alto("No pude quitar una línea de producto en Quesito (guía parcial). No se creó nada.")
    pag.wait_for_timeout(600)


def num(v):
    """"1,250.50" / "1250,5" / 30 → float (0 si no se entiende)."""
    t = str(v if v is not None else "").strip().replace(" ", "")
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", t):
        t = t.replace(",", "")
    t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return 0.0


def palabras(t):
    return {w for w in simple(t).split() if len(w) > 2 and not w.isdigit()}


def productos(pag, c):
    """Deja en la guía solo los bienes del caso, con su cantidad (todo lo de la factura si coincide)."""
    ls = lineas(pag)
    bs = c.get("bienes") or []
    if not ls:
        raise Alto("Quesito no trajo productos de la factura. No se creó nada.")
    if len(bs) == len(ls) and all(abs(num(b.get("cantidad")) - num(l["cantidad"])) < 1e-6 for b, l in zip(bs, ls)):
        paso(f"Productos: los {len(ls)} de la factura, completos")
        return
    # Guía parcial o con otras cantidades: cada bien del caso con su línea (por descripción; si no, por orden).
    usadas, plan = set(), []
    for n, b in enumerate(bs):
        pb = palabras(b.get("descripcion"))
        mejor = max(((len(pb & palabras(l["texto"])) / max(1, len(pb)), l["i"]) for l in ls if l["i"] not in usadas), default=(0, None))
        i = mejor[1] if mejor[0] >= 0.5 else (ls[n]["i"] if len(bs) == len(ls) and ls[n]["i"] not in usadas else None)
        if i is None:
            raise Alto(f"No reconocí en la factura de Quesito el bien «{str(b.get('descripcion'))[:60]}». Revise los bienes del caso. No se creó nada.")
        usadas.add(i)
        plan.append((i, b))
    for i, b in plan:
        if num(b.get("cantidad")) <= 0:
            raise Alto(f"La cantidad de «{str(b.get('descripcion'))[:60]}» no es válida. No se creó nada.")
        poner(pag, f"despatch_advice_lines_attributes][{i}][cantidad", ("%f" % num(b.get("cantidad"))).rstrip("0").rstrip("."))
    for l in ls:
        if l["i"] not in usadas:
            eliminar_linea(pag, l["i"])
    paso(f"Productos: {len(plan)} de {len(ls)} línea(s) de la factura (guía parcial o con otras cantidades)")
    NOTAS.append(f"Guía parcial: {len(plan)} de {len(ls)} productos de la factura, con las cantidades del caso.")


def separar_nombre(nombre):
    """"PEREZ GOMEZ, JUAN CARLOS" o "JUAN CARLOS PEREZ GOMEZ" → (nombres, apellidos)."""
    n = re.sub(r"\s+", " ", str(nombre or "")).strip()
    if "," in n:
        ap, no = [x.strip() for x in n.split(",", 1)]
        return no, ap
    w = n.split(" ")
    if len(w) >= 3:
        return " ".join(w[:-2]), " ".join(w[-2:])
    return (w[0], " ".join(w[1:])) if len(w) == 2 else (n, "")


def llenar(pag, c):
    abrir_secciones(pag)
    motivo = MOTIVOS.get(simple(c.get("motivo")).lower())
    if not motivo:
        raise Alto(f"El motivo «{c.get('motivo')}» no lo manejo todavía en Quesito. No se creó nada.")
    elegir(pag, "shipping_priority_level_id", motivo)
    t = c.get("transporte") or {}
    privado = t.get("modo") == "privado"
    elegir(pag, "transport_mode_id", "02" if privado else "01")
    pag.wait_for_timeout(800)
    if c.get("fecha"):
        fecha_form(pag, "fecha_de_inicio_de_traslado", c["fecha"])
        fecha_form(pag, "fecha_de_entrega_al_transportista", c["fecha"])
    if num(c.get("peso_kg")) <= 0:
        raise Alto("Falta el peso bruto (kg). No se creó nada.")
    if num(c.get("bultos")) < 1:
        raise Alto("Quesito pide el número de bultos: dígamelo (ej. «bultos 20»). No se creó nada.")
    poner(pag, "peso_bruto_total", f"{num(c['peso_kg']):.2f}")
    elegir(pag, "peso_bruto_unidad_de_medida", "KGM")
    poner(pag, "numero_de_bultos", int(num(c.get("bultos"))))
    productos(pag, c)
    if not privado:
        ruc = re.sub(r"\D", "", str(t.get("ruc") or ""))
        if len(ruc) != 11:
            raise Alto("Falta el RUC del transportista. No se creó nada.")
        elegir(pag, "transportista_documento_tipo", "RUC")
        poner(pag, "transportista_documento_numero", ruc)
        poner(pag, "transportista_denominacion", t.get("nombre") or "")
        if t.get("mtc") and not t.get("sin_mtc"):
            poner(pag, "mtc", t["mtc"])
    placas = [re.sub(r"[^A-Z0-9]", "", p.upper()) for p in (t.get("placas") or [])]
    conductores = t.get("conductores") or []
    if privado or t.get("registrar_vehiculos"):
        if not placas or not conductores:
            raise Alto("Faltan la placa y el chofer (DNI y licencia). No se creó nada.")
        poner(pag, "transportista_placa_numero", placas[0])
        if (t.get("constancias") or [None])[0]:
            poner(pag, "tuc_vehiculo_principal", t["constancias"][0])
        ch = conductores[0]
        dni = re.sub(r"\D", "", str(ch.get("dni") or ""))
        if len(dni) != 8:
            raise Alto("El DNI del chofer no tiene 8 dígitos. No se creó nada.")
        elegir(pag, "conductor_documento_tipo", "DNI")
        poner(pag, "conductor_documento_numero", dni)
        nombres, apellidos = separar_nombre(ch.get("nombre"))
        poner(pag, "conductor_nombre", nombres)
        poner(pag, "conductor_apellidos", apellidos)
        poner(pag, "conductor_numero_licencia", ch.get("licencia") or "")
        if len(placas) > 1 or len(conductores) > 1:
            NOTAS.append("Vehículos o choferes secundarios (" + ", ".join(placas[1:]) + ") no los pongo en Quesito todavía: solo el principal.")
    # Partida: Quesito trae la del local; se cambia solo si el caso dice otra dirección clara.
    act = pag.evaluate(f"() => (document.querySelector(\"input[name='{F}[partida_direccion]']\") || {{}}).value || ''")
    pd = (c.get("partida") or {}).get("direccion") or ""
    if pd and len(palabras(pd) & palabras(act)) < max(2, len(palabras(pd)) // 2):
        ub = ubigeo_de(pd, (c.get("partida") or {}).get("ubigeo"))
        if not ub:
            raise Alto("La partida del caso no es la del local de Quesito y no pude saber su distrito (ubigeo). Escriba el distrito, provincia "
                       "y departamento de la partida. No se creó nada.")
        poner(pag, "partida_direccion", pd)
        poner(pag, "partida_ubigeo", ub)
        NOTAS.append("Partida cambiada a la del caso (Quesito traía la del local).")
    ll = c.get("llegada") or {}
    ub = ubigeo_de(ll.get("direccion"), ll.get("ubigeo"))
    if not ub:
        raise Alto("No pude saber el distrito (ubigeo) de la llegada: escriba la dirección con distrito, provincia y departamento "
                   "(ej. «Av. Los Frutales 123, Santa Anita, Lima, Lima»). No se creó nada.")
    poner(pag, "llegada_direccion", ll.get("direccion"))
    poner(pag, "llegada_ubigeo", ub)
    if c.get("observaciones"):
        pag.evaluate(f"(v) => {{ const e = document.querySelector(\"textarea[name='{F}[observaciones]']\"); if (e) e.value = v; }}", str(c["observaciones"])[:250])
    paso("Formulario lleno")


def boton_crear(pag):
    """El botón que crea la guía: el envío del formulario de despatch_advices (no los de otras ventanas)."""
    b = pag.locator(f"form[action*='despatch_advices'] input[type=submit][name=commit], form[action*='despatch_advices'] button[type=submit]")
    vis = [b.nth(i) for i in range(b.count()) if b.nth(i).is_visible()]
    if len(vis) != 1:
        raise Alto(f"No encontré un único botón para crear la guía en Quesito (hay {len(vis)}). No se creó nada.")
    return vis[0]


def errores(pag):
    return pag.evaluate("""() => [...document.querySelectorAll('.alert-danger, .error, .invalid-feedback, .help-inline, .text-danger, #error_explanation li, .field_with_errors + span')]
      .filter(e => e.offsetParent !== null).map(e => e.innerText.trim()).filter(Boolean).slice(0, 8)""")


def bajar_pdf(pag):
    """PDF de la guía creada: el enlace PDF de su página (con la misma sesión). Base64 o ''."""
    hrefs = pag.evaluate("""() => [...document.querySelectorAll('a[href]')].filter(a => /\\.pdf|pdf/i.test(a.href + ' ' + a.innerText))
      .map(a => a.href)""")
    for h in hrefs:
        try:
            r = pag.context.request.get(h)
            if r.ok and r.body()[:4] == b"%PDF":
                return base64.b64encode(r.body()).decode()
        except Exception:
            pass
    return ""


def esperar_decision(huella):
    hasta = time.time() + ESPERA_MIN * 60
    while time.time() < hasta:
        r = bot({"accion": "gre_espera", "hasta": int(hasta * 1000)})
        if r.get("decision") == "emitir":
            return r.get("confirmar") == huella
        if r.get("decision") == "cerrar":
            return False
        time.sleep(8)
    r = bot({"accion": "gre_espera", "fin": True})
    return r.get("decision") == "emitir" and r.get("confirmar") == huella


def main():
    modo = os.environ.get("MODO", "vista")
    ruc = os.environ.get("RUC", "")
    sesion = os.environ.get("QUESITO_SESION", "").strip()
    r = bot({"accion": "gre_caso"})
    if not r.get("ok") or not r.get("datos"):
        sys.exit("El bot no entregó el caso: " + str(r.get("error", ""))[:150])
    texto = r["datos"]
    huella = hashlib.sha256(texto.encode("utf-8")).hexdigest()[:10]
    c = json.loads(texto)
    if c.get("empresa_ruc") != ruc:
        fin(False, "El caso es de otra empresa que la de esta corrida. No se creó nada.")
        sys.exit("El caso es de otra empresa")
    if modo == "emitir" and os.environ.get("CONFIRMAR", "") != huella:
        fin(False, "La confirmación no corresponde a este caso (¿se cambió algo después de aprobar?). No se creó nada.")
        sys.exit("Clave de confirmación incorrecta")
    if not sesion:
        fin(False, "Falta la sesión de Quesito de esta empresa (secreto QUESITO_SESION). No se creó nada.")
        sys.exit(1)
    d = c.get("documento") or {}
    m = re.match(r"^\s*([A-Z0-9]{4})\s*-\s*0*(\d+)\s*$", str(d.get("numero") or "").upper())
    if not m:
        fin(False, "Para Quesito la guía sale desde la factura: falta el número de la factura (ej. FQQ1-3648). No se creó nada.")
        sys.exit(1)
    serie, numero = m.group(1), m.group(2)
    paso(f"Caso recibido · modo {modo} · factura {serie}-{numero} · {len(c.get('bienes') or [])} bien(es)")

    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA)
        pag = ctx.new_page()
        pag.on("dialog", lambda dl: (print("  Ventana de confirmación rechazada"), dl.dismiss()))
        permitir = [False]   # 🔒 hasta que la persona apruebe, ningún envío de datos sale del formulario

        def red(route, req):
            u = urlsplit(req.url)
            if permitir[0] is False and en_formulario[0] and req.method not in ("GET", "HEAD", "OPTIONS") and "quesito" in u.netloc \
                    and not u.path.startswith(("/pin_session", "/find_", "/entities/find", "/products/find")):
                print("  ⛔ Envío bloqueado (vista previa):", req.method, u.path)
                return route.abort()
            return route.continue_()
        en_formulario = [False]
        tocado = [False]   # ya se tocó «Crear»: desde aquí nunca se dice "no se creó nada"
        ctx.route("**/*", red)
        try:
            ctx.add_cookies(leer_sesion(sesion))
            pag.goto(BASE + "/invoices", wait_until="networkidle", timeout=60000)
            if "/login" in pag.url or pag.locator("input[type=password]:visible").count():
                raise Alto("La sesión guardada de Quesito venció: entre a Quesito en su Chrome, cópiela con Cookie-Editor (Export → JSON) "
                           "y péguela en el secreto QUESITO_SESION de la empresa en GitHub. No se creó nada.")
            paso("Dentro de Quesito (sesión guardada)")
            # Buscar la factura
            pag.get_by_text(re.compile(r"Buscar\s+Documento", re.I)).first.click()
            pag.wait_for_timeout(1200)
            pag.locator("input[name=serie]:visible").first.fill(serie)
            pag.locator("input[name=numero]:visible").first.fill(numero)
            tipo = pag.locator("select[name=voucher_id]:visible")
            if tipo.count():
                ops = tipo.first.locator("option").all_inner_texts()
                el = next((o for o in ops if ("FACTURA" if serie.startswith("F") else "BOLETA") in o.upper()), None)
                if el:
                    tipo.first.select_option(index=ops.index(el))
            pag.locator("input[name=numero]:visible").first.press("Enter")
            esperar(pag, 2500)
            fila = pag.locator("tr", has_text=serie).filter(has_text=re.compile(r"\b0*" + numero + r"\b"))
            if not fila.count():
                raise Alto(f"No encontré la factura {serie}-{numero} en Quesito de esta empresa. No se creó nada.")
            opc = fila.first.get_by_text(re.compile(r"Opciones", re.I)).first
            try:
                opc.click(timeout=8000)
            except Exception:
                opc.evaluate("e => e.click()")
            pag.wait_for_timeout(1200)
            gen = pag.get_by_text(re.compile(r"Generar\s+GU[IÍ]A\s+DE\s+REMISI[OÓ]N\s+REMITENTE", re.I))
            vis = [gen.nth(i) for i in range(gen.count()) if gen.nth(i).is_visible()]
            if not vis:
                raise Alto("En Opciones de la factura no apareció «Generar GUIA DE REMISIÓN REMITENTE». No se creó nada.")
            en_formulario[0] = True
            vis[0].click()
            esperar(pag, 3000)
            if "/despatch_advices/new" not in pag.url:
                raise Alto("No se abrió el formulario de guía de Quesito. No se creó nada.")
            paso("Formulario de guía abierto (con la factura)")
            llenar(pag, c)
            crear = boton_crear(pag)
            img = base64.b64encode(foto(pag)).decode()
            if modo != "emitir":
                bot({"accion": "gre_vista", "imagen": img, "huella": huella, "notas": NOTAS[:5], "via": "quesito"})
                print("::notice title=GRE Quesito vista::Vista previa enviada al chat. No se creó nada.")
                if not esperar_decision(huella):
                    paso("Nadie aprobó a tiempo (o pidieron cambios): cierro sin crear la guía")
                    return
                paso("La persona aprobó: creo la guía en la misma pantalla")
            # ===== CREAR (aprobado con la huella de este caso) =====
            permitir[0] = True
            antes = pag.url
            tocado[0] = True
            crear.click()
            esperar(pag, 4000)
            if pag.url == antes or "/new" in pag.url:
                er = errores(pag)
                raise Alto("Quesito no creó la guía" + (": " + " · ".join(er) if er else " (revise la foto)") + ". No quedó emitida.")
            num = re.search(r"\b(T[A-Z0-9]{3})\s*-\s*0*(\d+)\b", pag.inner_text("body"))
            numero_gre = f"{num.group(1)}-{num.group(2)}" if num else ""
            if not numero_gre:
                fin(False, "Se tocó «Crear» pero no leí el número de la guía. Revise en Quesito → Guías de Remisión antes de reintentar.",
                    imagen=base64.b64encode(foto(pag)).decode(), dudoso=True)
                print("::warning title=GRE Quesito sin confirmar::No leí el número")
                sys.exit(2)
            print(f"::notice title=GRE emitida::{numero_gre}")
            fin(True, "Guía creada en Quesito", numero=numero_gre, pdf=bajar_pdf(pag), imagen=base64.b64encode(foto(pag)).decode())
        except Exception as e:
            try:
                img = base64.b64encode(foto(pag)).decode()
            except Exception:
                img = ""
            if tocado[0]:   # se tocó «Crear»: puede haber quedado creada
                print(f"::warning title=GRE Quesito sin confirmar::{type(e).__name__} después de tocar Crear")
                fin(False, "Se tocó «Crear» en Quesito pero no pude confirmar el resultado (" + (str(e) if isinstance(e, Alto) else type(e).__name__) +
                    "). Revise en Quesito → Guías de Remisión antes de volver a intentar.", imagen=img, dudoso=True)
                sys.exit(2)
            print(f"::error title=GRE Quesito no creada::{e if isinstance(e, Alto) else type(e).__name__ + ' en ' + PASO[0]}")
            fin(False, str(e) if isinstance(e, Alto) else f"El robot de Quesito se detuvo en «{PASO[0]}» ({type(e).__name__}). No se creó nada.", imagen=img)
            sys.exit(1)
        finally:
            nav.close()


if __name__ == "__main__":
    main()
