"""
gre_robot.py — Guía de Remisión Electrónica (GRE) Remitente en SUNAT SOL ("Emisión de GRE", menú 62.1.1.1.1).

  MODO=vista   llena todas las pantallas con el caso y se detiene en la última (la de "Emitir"): saca la foto
               y se la manda al chat que la pidió por el bot. NO emite.
  MODO=emitir  igual, y recién ahí toca "Emitir" — solo si CONFIRMAR es la huella de ESTE caso
               (sha256 del texto exacto del caso, 10 caracteres), que el bot calcula cuando la persona aprueba.

El caso (proveedor/destinatario, bienes, chofer, placas…) NO viaja en los datos de la corrida (el repositorio es
público): el robot se lo pide al bot con el número de corrida, y el bot solo responde a una corrida de
gre-sunat.yml que esté en curso. Los registros de la corrida solo dicen en qué pantalla va, sin nombres ni números.

Caso (JSON):
{"id": "...", "empresa_ruc": "...", "motivo": "Compra" | "Venta" | ...,
 "contraparte": {"ruc": "...", "nombre": "..."},           # proveedor (compra) o destinatario (venta)
 "documento": {"tipo": "Factura", "numero": "F251-00056475", "ruc_emisor": "..."},   # opcional
 "bienes": [{"descripcion": "...", "unidad": "PK", "cantidad": 10}], "peso_kg": 30258.5,
 "partida": {"ruc": "..." | "", "direccion": "..."}, "llegada": {"ruc": "..." | "", "direccion": "..."},
 "transporte": {"modo": "publico" | "privado", "ruc": "...", "mtc": "...", "registrar_vehiculos": false,
                "placas": ["AON949"], "conductores": [{"dni": "...", "licencia": "...", "nombre": "..."}]},
 "fecha": "dd/mm/aaaa"}
"""
import base64
import hashlib
import json
import os
import re
import sys
import unicodedata
import urllib.request

from playwright.sync_api import sync_playwright

CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
STATE = ("rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
MENU_GRE = ["nivel1_62", "nivel2_62_1", "nivel3_62_1_1", "nivel4_62_1_1_1_1"]   # Emisión de GRE
AGREGAR = re.compile(r"^\s*Agregar\s*$")
OPCION = ".ng-dropdown-panel .ng-option:visible, [role=option]:visible, li:visible"


class Alto(Exception):
    """Motivo para no seguir. `detalle` va solo al chat (p. ej. la lista de locales), nunca al registro de la corrida."""
    def __init__(self, texto, detalle="", opciones=None):
        super().__init__(texto)
        self.detalle = detalle
        self.opciones = opciones   # locales para que la persona elija con un número (van solo al bot)


def simple(t):
    t = unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", t).strip()


def sin_datos(t):
    t = re.sub(r"\b[A-Z]{1,3}\d?-?\d{5,}\b", "#####", str(t))
    t = re.sub(r"\b\d{5,}\b", "#####", t)
    return re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "***@***", t)


PASO_ACTUAL = [""]


def paso(texto):
    if not texto.startswith(" "):
        PASO_ACTUAL[0] = texto
    print(f"• {texto}", flush=True)


# ============================================================ bot (Cobranzas, ?canal=gh)

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
    open(os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "gre_avisado"), "w").close()   # el paso "se cayó" no repite el aviso


# ============================================================ ayudas de pantalla

def llenar(campo, valor):
    """Escribe solo si el campo está habilitado y no tiene ya ese valor (SUNAT bloquea los que completa sola)."""
    if not campo.count() or not campo.is_enabled() or not campo.is_editable():
        return False
    if (campo.input_value() or "").strip() != str(valor):
        campo.fill(str(valor), timeout=8000)
    return True


def esperar(pag, ms=1500):
    pag.wait_for_timeout(ms)


OBSERVACIONES = []   # avisos de SUNAT que se aceptaron con «SI» (van con la vista previa)


def seguir_observacion(fr, pag):
    """«Mensaje de Observación … ¿Desea continuar?» (placa o DNI que SUNAT no tiene registrado): es solo un aviso, se responde SI.
    Nunca toca una confirmación de emitir."""
    for _ in range(3):
        m = fr.locator(".modal:visible").filter(has_text=re.compile(r"desea continuar", re.I))
        if not m.count():
            return
        txt = re.sub(r"\s+", " ", m.last.inner_text()).strip()
        if re.search(r"emiti|emisi[oó]n de la gu|firmar|enviar", txt, re.I):
            return
        si = m.last.locator("button:visible", has_text=re.compile(r"^\s*(SI|Sí|Si|SÍ)\s*$"))
        if not si.count():
            return
        nota = re.sub(r"^\s*Mensaje de Observaci[oó]n\s*", "", txt).replace("NO SI", "").strip()[:160]
        OBSERVACIONES.append(nota)
        paso(f"   aviso de SUNAT aceptado: {sin_datos(nota)}")
        si.last.click(timeout=4000)
        esperar(pag, 1200)


def cerrar_avisos(fr, pag):
    """Avisos informativos de SUNAT (Entendido / Aceptar / ¿Desea continuar? → SI). Devuelve sus textos."""
    vistos = []
    seguir_observacion(fr, pag)
    for _ in range(3):
        b = fr.locator(".modal button:visible", has_text=re.compile(r"^\s*(Entendido|ENTENDIDO|Aceptar)\s*$"))
        if not b.count():
            break
        try:
            vistos.append(fr.evaluate("() => [...document.querySelectorAll('.modal')].filter(m => m.offsetParent !== null).map(m => m.innerText).join(' ')"))
            b.last.click(timeout=3000)
            esperar(pag, 900)
        except Exception:
            break
    return vistos


def pantalla(fr):
    try:
        return fr.evaluate("() => (document.body.innerText.match(/\\d\\. [^\\n]+/) || [''])[0]")
    except Exception:
        return ""


def modal(fr):
    return fr.locator(".modal:visible").last


def boton_agregar_modal(fr):
    """Botón que confirma la ventana: SUNAT lo llama «Agregar» en unas y «Aceptar» en otras (transportista)."""
    return modal(fr).locator("button:visible", has_text=re.compile(r"^\s*(Agregar|Aceptar)\s*$")).last


def combo(fr, pag, etiqueta, elegir, dentro=None):
    """ng-select junto a la etiqueta: abre y elige la opción que empieza (o contiene) con `elegir`."""
    base = dentro or fr
    marca = "c" + hashlib.md5(etiqueta.encode()).hexdigest()[:6]
    ok = fr.evaluate("""([t, m]) => {
      const x = [...document.querySelectorAll('label,strong,span,div,p')].filter(e => e.offsetParent !== null && e.children.length < 3
        && e.innerText && e.innerText.trim().startsWith(t)).pop();
      if (!x) return false;
      let p = x; for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        const c = p.querySelector('ng-select input, input[type=text], select'); if (c) { c.setAttribute('data-robot', m); return true; } }
      return false; }""", [etiqueta, marca])
    if not ok:
        raise Alto(f"no encontré la lista «{etiqueta}»")
    campo = base.locator(f"[data-robot={marca}]") if dentro else fr.locator(f"[data-robot={marca}]")
    campo.click(timeout=5000)
    esperar(pag, 1000)
    ops = fr.locator(OPCION)
    textos = [simple(t) for t in ops.all_inner_texts()]
    obj = simple(elegir)
    i = next((j for j, t in enumerate(textos) if t.startswith(obj)), None)
    if i is None:
        i = next((j for j, t in enumerate(textos) if obj in t), None)
    if i is None:
        pag.keyboard.press("Escape")
        raise Alto(f"en la lista «{etiqueta}» no está la opción «{elegir}»")
    ops.nth(i).click(timeout=4000)
    esperar(pag, 700)


def campos_faltantes(fr):
    """Nombres (la etiqueta que se ve en pantalla) de los campos que SUNAT marca como inválidos o vacíos obligatorios."""
    try:
        return fr.evaluate("""() => {
          const vis = e => e && e.offsetParent !== null;
          const etiqueta = e => { let p = e; for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
              const l = p.querySelector('label'); if (l && l.innerText.trim()) return l.innerText.trim(); }
            return e.getAttribute('formcontrolname') || e.name || e.id || '?'; };
          const malos = [...document.querySelectorAll('input.ng-invalid, ng-select.ng-invalid, select.ng-invalid, textarea.ng-invalid')]
            .filter(vis).filter(e => !e.closest('.modal'));
          const modal = [...document.querySelectorAll('.modal')].filter(vis).map(m => 'ventana abierta: ' + (m.innerText || '').trim().split('\\n')[0]);
          return [...new Set(malos.map(etiqueta).concat(modal))].slice(0, 8);
        }""")
    except Exception:
        return []


def siguiente(fr, pag):
    actual = pantalla(fr)
    b = fr.get_by_text("Siguiente", exact=True).first
    try:
        b.click(timeout=8000)
    except Exception:
        faltan = campos_faltantes(fr)
        paso(f"   campos que SUNAT marca como faltantes: {[sin_datos(x) for x in faltan]}")
        raise Alto(f"SUNAT no deja pasar de «{actual}»: falta un dato obligatorio" +
                   (f" ({', '.join(faltan)[:300]})" if faltan else ""))
    esperar(pag, 3000)
    for _ in range(4):   # "No se ha registrado ningún … ¿Desea continuar?" → SI · avisos → Entendido
        if pantalla(fr) != actual:
            return
        try:
            if "Desea continuar" in fr.inner_text("body"):
                fr.get_by_role("button", name="SI", exact=True).last.click(timeout=4000)
                esperar(pag, 2500)
        except Exception:
            pass
        cerrar_avisos(fr, pag)
        esperar(pag, 2000)
    if pantalla(fr) == actual:
        txt = " ".join(cerrar_avisos(fr, pag))
        raise Alto(f"SUNAT no deja pasar de «{actual}»" + (f": {sin_datos(txt)[:200]}" if txt else ""))


COMUNES = {"av", "jr", "cal", "mz", "lt", "lote", "nro", "urb", "de", "la", "el", "los", "las", "del", "y"}


def puntaje(a, b):
    """Coincidencia entre dos direcciones: palabras en común (sin las de siempre: av, mz, lote…)."""
    pa = {w for w in re.findall(r"[a-z0-9]+", simple(a)) if len(w) > 1 and w not in COMUNES}
    pb = {w for w in re.findall(r"[a-z0-9]+", simple(b)) if len(w) > 1 and w not in COMUNES}
    return len(pa & pb)


def elegir_fila(fr, pag, p, alerta, cual):
    """En la tabla de la ventana abierta marca el local del caso: el que la persona eligió (fila exacta) o el más parecido."""
    m = modal(fr)
    filas = m.locator("table tbody tr")
    buscar = m.locator("input[type=search], label:has-text('Buscar') input").first
    if p.get("fila") and buscar.count():   # la tabla puede tener varias páginas: se filtra por la dirección elegida
        buscar.fill(p["direccion"][:40])
        esperar(pag, 1200)
    n = filas.count()
    if not n or "No hay registros" in (filas.first.inner_text() or "") or "ningún" in simple(filas.first.inner_text() or ""):
        if p.get("fila") and buscar.count():
            buscar.fill("")
            esperar(pag, 1000)
            n = filas.count()
        if not n:
            raise Alto(alerta)
    celdas = [filas.nth(i).evaluate("f => [...f.querySelectorAll('td')].map(t => t.innerText.trim()).filter(Boolean)") for i in range(n)]
    textos = [" · ".join(x) for x in celdas]
    if p.get("fila"):
        exacta = [i for i in range(n) if simple(textos[i]) == simple(p["fila"])]
        if exacta:
            filas.nth(exacta[0]).locator("input[type=radio]").first.check(timeout=4000)
            return exacta[0]
    pts = [puntaje(p["direccion"], t) for t in textos]
    mejor = max(range(n), key=lambda i: pts[i])
    palabras = lambda t: frozenset(w for w in re.findall(r"[a-z]+", simple(t)) if len(w) > 1 and w not in COMUNES | {"domicilio", "fiscal"})
    unico = len({palabras(textos[i]) for i in range(n) if pts[i] == pts[mejor]}) == 1   # empate de la misma dirección: vale la primera
    # Basta una palabra ("Mártires") si solo un local la tiene; si empatan, hacen falta 2 o más y ganar.
    if n > 1 and not (pts[mejor] >= 1 and unico):
        lista = "\n".join(f"{i + 1}) " + re.sub(r"\s+", " ", t).strip()[:110] for i, t in enumerate(textos[:20]))
        raise Alto(alerta + ": ninguna dirección registrada coincide con la del caso (o hay varias iguales).",
                   f"Locales que SUNAT tiene registrados:\n{lista}\n\nResponda solo con el número (ej. «7») y vuelvo a preparar la vista previa.",
                   {"cual": cual, "lista": [{"fila": textos[i], "direccion": (celdas[i] or [""])[-1]} for i in range(min(n, 20))]})
    filas.nth(mejor).locator("input[type=radio]").first.check(timeout=4000)
    return mejor


# ============================================================ pantallas

def ingresar(nav, ruc, usuario, clave):
    ctx = nav.new_context(viewport={"width": 1366, "height": 1000}, locale="es-PE", user_agent=UA)
    pag = ctx.new_page()
    pag.set_default_timeout(15000)
    pag.on("dialog", lambda d: d.dismiss())
    pag.goto(f"{SEC}/loginMenuSol?lang=es-PE&showDni=true&showLanguages=false&originalUrl={ORIG}&state={STATE}",
             wait_until="networkidle", timeout=60000)
    pag.fill("#txtRuc", ruc)
    pag.fill("#txtUsuario", usuario)
    pag.fill("#txtContrasena", clave)
    pag.click("#btnAceptar")
    pag.wait_for_load_state("networkidle", timeout=60000)
    esperar(pag, 3000)
    for i in MENU_GRE:   # se abre con clics, como una persona (ir directo a la dirección lo corta SUNAT)
        for f in pag.frames:
            try:
                if f.evaluate("i => { const e = document.getElementById(i); if (!e) return false; (e.querySelector('a') || e).click(); return true; }", i):
                    break
            except Exception:
                continue
        esperar(pag, 1500)
    for _ in range(30):
        fr = next((f for f in pag.frames if "emitir-gre" in f.url), None)
        if fr:
            try:
                fr.get_by_text("Remitente", exact=True).first.wait_for(timeout=2000)
                return ctx, pag, fr
            except Exception:
                pass
        esperar(pag, 1000)
    raise Alto("no se abrió «Emisión de GRE» en SOL")


def p1_datos(fr, pag, c):
    paso("1. Datos de emisión")
    fr.get_by_text("Remitente", exact=True).first.click(timeout=8000)
    esperar(pag, 1500)
    fr.locator("#rdNo").check(timeout=5000)
    fr.locator("input[type=text]:visible").first.click(timeout=5000)
    esperar(pag, 1000)
    ops = fr.locator(OPCION)
    textos = [simple(t) for t in ops.all_inner_texts()]
    if simple(c["motivo"]) not in textos:
        raise Alto(f"SUNAT no tiene el motivo «{c['motivo']}»")
    ops.nth(textos.index(simple(c["motivo"]))).click()
    esperar(pag, 800)
    siguiente(fr, pag)


def p2_actores(fr, pag, c):
    paso("2. Actores")
    ruc = re.sub(r"\D", "", c["contraparte"]["ruc"])
    if not ruc:
        return siguiente(fr, pag)   # traslado sin contraparte (p. ej. entre establecimientos)
    radios = fr.locator("input[type=radio][name^=descTipoActor]")
    for i in range(radios.count()):   # ¿ya es frecuente?
        fila = radios.nth(i).locator("xpath=ancestor::tr[1]")
        if fila.count() and ruc in re.sub(r"\D", "", fila.inner_text()):
            radios.nth(i).check()
            paso("   contraparte elegida de las frecuentes")
            return siguiente(fr, pag)
    fr.locator("button:visible", has_text=AGREGAR).first.click(timeout=5000)
    esperar(pag, 1500)
    m = modal(fr)
    m.locator("#nroDocumento").fill(ruc)
    m.locator("#nroDocumento").press("Tab")
    esperar(pag, 3500)
    rs = m.locator("[formcontrolname=razonSocial], input[name=razonSocial]").first
    if rs.count() and not rs.input_value().strip():
        rs.fill(c["contraparte"].get("nombre", ""))
    boton_agregar_modal(fr).click(timeout=5000)
    esperar(pag, 2000)
    cerrar_avisos(fr, pag)
    siguiente(fr, pag)


def p3_documentos(fr, pag, c):
    paso("3. Documentos relacionados")
    cerrar_avisos(fr, pag)
    d = c.get("documento") or {}
    if d.get("numero"):
        fr.locator("button:visible", has_text=AGREGAR).first.click(timeout=5000)
        esperar(pag, 1500)
        combo(fr, pag, "Tipo de documento relacionado", d.get("tipo") or "Factura")
        esperar(pag, 1200)
        m = modal(fr)
        nombres = m.evaluate("m => [...m.querySelectorAll('input')].filter(e => e.offsetParent !== null).map(e => e.getAttribute('formcontrolname') || e.name || e.id)")
        paso(f"   campos del documento: {nombres}")
        numero = str(d["numero"]).strip().upper()
        serie = re.match(r"^\s*([A-Z0-9]{1,4})\s*-\s*0*(\d+)\s*$", numero)
        if "serieDocumento" in nombres and serie:   # SUNAT pide serie y número por separado: F251 · 56475
            llenar(m.locator("[formcontrolname=serieDocumento], #serieDocumento").first, serie.group(1))
            numero = serie.group(2)
        llenar(m.locator("[formcontrolname=nroDocumento], #nroDocumento").first, numero)
        for n in nombres:   # el documento de un tercero pide el RUC de quien lo emitió (a veces SUNAT ya lo trae y lo bloquea)
            if n and re.search(r"ruc|emisor", n, re.I) and d.get("ruc_emisor"):
                llenar(m.locator(f"[formcontrolname={n}]").first, d["ruc_emisor"])
        boton_agregar_modal(fr).click(timeout=5000)
        esperar(pag, 2000)
        avisos = cerrar_avisos(fr, pag)
        if avisos and fr.locator(".modal:visible").count():
            raise Alto(f"SUNAT no aceptó el documento relacionado: {sin_datos(' '.join(avisos))[:200]}")
    siguiente(fr, pag)


def p4_bienes(fr, pag, c):
    paso(f"4. Bienes a transportar ({len(c['bienes'])})")
    for b in c["bienes"]:
        fr.locator("button:visible", has_text=AGREGAR).first.click(timeout=5000)
        esperar(pag, 1500)
        fr.locator("#descBien").fill(str(b["descripcion"])[:250])
        combo(fr, pag, "Unidad de medida del bien", f"{b.get('unidad') or 'NIU'} - ")
        fr.locator("[formcontrolname=cantidad], input[name=cantidad]").first.fill(str(b["cantidad"]))
        boton_agregar_modal(fr).click(timeout=5000)
        esperar(pag, 1500)
        avisos = cerrar_avisos(fr, pag)
        if fr.locator("#descBien:visible").count():
            raise Alto(f"SUNAT no aceptó un bien: {sin_datos(' '.join(avisos))[:200]}")
    combo(fr, pag, "Unidad de medida de peso bruto", "KILOGRAMO")
    fr.locator("[formcontrolname=pesoBruto], input[name=pesoBruto]").first.fill(f"{float(c['peso_kg']):.3f}".rstrip("0").rstrip("."))
    bultos = fr.locator("[formcontrolname*=ulto]:visible, input[name*=ulto]:visible")   # "Número de bultos", si SUNAT lo pide
    if c.get("bultos") and bultos.count():
        bultos.first.fill(str(int(c["bultos"])))
    siguiente(fr, pag)


def punto(fr, pag, n, p, cual):
    fr.locator("button:visible", has_text=AGREGAR).nth(n).click(timeout=5000)
    esperar(pag, 2000)
    m = modal(fr)
    radios = m.locator("input[type=radio]:not([name=name])")
    etiquetas = [simple(radios.nth(i).locator("xpath=..").inner_text()) for i in range(radios.count())]
    ruc = re.sub(r"\D", "", p.get("ruc") or "")
    if ruc:
        i = next((j for j, t in enumerate(etiquetas) if "tercero" in t), None)
        if i is not None:
            radios.nth(i).check()
            esperar(pag, 1200)
        campo = m.locator("[formcontrolname=ruc], input[name=ruc]").first
        campo.fill(ruc)
        campo.press("Enter")
        esperar(pag, 1500)
        campo.press("Tab")
        esperar(pag, 4000)
    else:
        i = next((j for j, t in enumerate(etiquetas) if "remitente" in t), None)
        if i is not None:
            radios.nth(i).check()
            esperar(pag, 2000)
    elegir_fila(fr, pag, p, f"no encontré el establecimiento de {cual} en SUNAT", cual)
    boton_agregar_modal(fr).click(timeout=5000)
    esperar(pag, 2500)
    cerrar_avisos(fr, pag)


def p5_puntos(fr, pag, c):
    paso("5. Punto de partida y llegada")
    punto(fr, pag, 0, c["partida"], "partida")
    punto(fr, pag, 1, c["llegada"], "llegada")
    siguiente(fr, pag)


def fecha(fr, pag, nombre, valor):
    """Fecha en el calendario de SUNAT (ngbDatepicker de solo lectura): se escribe quitando el bloqueo y, si no la toma,
    se elige en el calendario (mes, año y día)."""
    f = fr.locator(f"input[name={nombre}]").first
    if not f.count() or not f.is_visible() or not f.is_enabled() or (f.input_value() or "").strip() == valor:
        return
    f.evaluate("e => { e.removeAttribute('readonly'); e.readOnly = false; }")
    try:
        f.fill(valor, timeout=4000)
        f.dispatch_event("input")
        f.dispatch_event("change")
        f.press("Tab")
    except Exception:
        pass
    esperar(pag, 800)
    if (f.input_value() or "").strip() != valor:   # con el calendario, como una persona
        d, mes, a = (int(x) for x in valor.split("/"))
        boton = f.locator("xpath=following::button[1]").first
        (boton if boton.count() else f).click(timeout=4000)
        esperar(pag, 800)
        cal = fr.locator("ngb-datepicker:visible").last
        sel = cal.locator("select")
        if sel.count() >= 2:
            sel.nth(0).select_option(str(mes))
            sel.nth(1).select_option(str(a))
            esperar(pag, 400)
        dia = cal.locator(".ngb-dp-day:not(.disabled) div:not(.outside)", has_text=re.compile(rf"^\s*{d}\s*$")).first
        dia.click(timeout=4000)
        esperar(pag, 800)
    pag.keyboard.press("Escape")
    if (f.input_value() or "").strip() != valor:
        raise Alto("SUNAT no aceptó la fecha del traslado")


def p6_transporte(fr, pag, c):
    t = c["transporte"]
    paso(f"6. Datos de transporte ({t['modo']})")
    fr.get_by_text("Transporte Público" if t["modo"] == "publico" else "Transporte Privado", exact=True).first.click(timeout=5000)
    esperar(pag, 2500)
    cerrar_avisos(fr, pag)
    if t["modo"] == "publico":
        fr.locator("button:visible", has_text=AGREGAR).first.click(timeout=5000)
        esperar(pag, 1500)
        m = modal(fr)
        m.locator("[formcontrolname=nroRuc]").fill(re.sub(r"\D", "", t["ruc"]))
        m.locator("[formcontrolname=nroRuc]").press("Tab")
        esperar(pag, 3500)
        seguir_observacion(fr, pag)
        m = modal(fr)
        mtc = m.locator("[formcontrolname=nroRegistroMTC]").first
        if t.get("mtc") and not t.get("sin_mtc") and not (mtc.input_value() or "").strip():   # si SUNAT ya lo trae, se deja
            llenar(mtc, t["mtc"])
        boton_agregar_modal(fr).click(timeout=5000)
        esperar(pag, 2000)
        avisos = cerrar_avisos(fr, pag)
        if fr.locator("[formcontrolname=nroRuc]:visible").count():
            raise Alto(f"SUNAT no aceptó al transportista: {sin_datos(' '.join(avisos))[:200]}")
        if t.get("registrar_vehiculos"):
            fr.get_by_text("Registrar vehículos y conductores del transportista").first.click()
            esperar(pag, 2000)
            vehiculos_conductores(fr, pag, t)
        fecha(fr, pag, "d1", c["fecha"])   # entrega de bienes al transportista
        fecha(fr, pag, "d2", c["fecha"])   # inicio de traslado (si SUNAT la muestra)
    else:
        vehiculos_conductores(fr, pag, t)
        fecha(fr, pag, "d2", c["fecha"])
    siguiente(fr, pag)


def vehiculos_conductores(fr, pag, t):
    """Vehículos (el primero es el principal) y conductores: cada uno con su ventana Agregar."""
    def abrir(seccion):
        x = fr.evaluate("""s => { const h = [...document.querySelectorAll('*')].find(e => e.children.length < 2 && (e.innerText || '').trim() === s);
            if (!h) return false; let p = h; for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
              const b = [...p.querySelectorAll('button')].find(b => /^\\s*Agregar\\s*$/.test(b.innerText)); if (b) { b.setAttribute('data-robot', 'ag'); return true; } }
            return false; }""", seccion)
        if not x:
            raise Alto(f"no encontré «{seccion}»")
        fr.locator("[data-robot=ag]").click(timeout=5000)
        fr.evaluate("() => document.querySelectorAll('[data-robot=ag]').forEach(e => e.removeAttribute('data-robot'))")
        esperar(pag, 1500)
        cerrar_avisos(fr, pag)
    constancias = t.get("constancias") or []
    for n, placa in enumerate(t.get("placas") or []):   # en orden: la primera es el vehículo principal
        abrir("Datos de vehículos")
        m = modal(fr)
        m.locator("[formcontrolname=placaVehiculo]").fill(re.sub(r"[^A-Z0-9]", "", placa.upper()))
        m.locator("[formcontrolname=placaVehiculo]").press("Tab")
        esperar(pag, 2500)
        seguir_observacion(fr, pag)   # «No encontramos … el número de placa … ¿Desea continuar?» → SI
        m = modal(fr)
        campos = m.evaluate("m => [...m.querySelectorAll('input')].filter(e => e.offsetParent !== null).map(e => e.getAttribute('formcontrolname') || e.name || e.id)")
        paso(f"   vehículo {n + 1} ({'principal' if n == 0 else 'secundario'}) · campos: {campos}")
        # Si SUNAT pide la constancia/TUC/certificado del vehículo, va la que corresponde a esa placa (en el mismo orden).
        for nombre in campos:
            if re.search(r"tuc|certific|habilit|constanc|inscrip", nombre or "", re.I) and n < len(constancias):
                m.locator(f"[formcontrolname={nombre}]").first.fill(constancias[n])
        boton_agregar_modal(fr).click(timeout=5000)
        esperar(pag, 2000)
        avisos = cerrar_avisos(fr, pag)
        if fr.locator("[formcontrolname=placaVehiculo]:visible").count():
            raise Alto(f"SUNAT no aceptó la placa del vehículo {n + 1}: {sin_datos(' '.join(avisos))[:200]}")
    for cd in t.get("conductores") or []:
        abrir("Datos de conductores")
        m = modal(fr)
        # SUNAT pide primero la licencia: con ella completa sola el tipo de documento, el DNI y el nombre (y los bloquea).
        lic = m.locator("[formcontrolname=nroLicencia]").first
        llenar(lic, cd.get("licencia", ""))
        lic.press("Tab")
        esperar(pag, 3500)
        seguir_observacion(fr, pag)
        m = modal(fr)
        doc = m.locator("[formcontrolname=nroDocIdentidad]").first
        if doc.count() and doc.is_enabled() and not (doc.input_value() or "").strip():   # SUNAT no lo encontró: se escribe a mano
            try:
                combo(fr, pag, "Tipo de documento", "DOCUMENTO NACIONAL")
            except Exception:
                pass
            esperar(pag, 800)
            if llenar(doc, cd["dni"]):
                doc.press("Tab")
                esperar(pag, 3000)
                seguir_observacion(fr, pag)
        m = modal(fr)
        llenar(m.locator("[formcontrolname=nombreApellidos]").first, cd.get("nombre", "")) if not (
            m.locator("[formcontrolname=nombreApellidos]").first.input_value() or "").strip() else None
        paso(f"   conductor · licencia {'ok' if (lic.input_value() or '').strip() else 'vacía'} · documento "
             f"{'ok' if (doc.input_value() or '').strip() else 'vacío'}")
        boton_agregar_modal(fr).click(timeout=5000)
        esperar(pag, 2000)
        cerrar_avisos(fr, pag)


def final(fr, pag):
    """Pasa las pantallas que queden (datos adicionales, resumen…) hasta la que tiene el botón Emitir."""
    for _ in range(4):
        cerrar_avisos(fr, pag)
        actual = pantalla(fr)
        botones = [b.strip() for b in fr.locator("button:visible").all_inner_texts()]
        paso(f"{sin_datos(actual)} · botones: {', '.join(sin_datos(b) for b in botones if b)[:200]}")
        emitir = fr.locator("button:visible", has_text=re.compile(r"^\s*(Emitir|Emitir GRE|Generar)\s*$", re.I))
        if emitir.count():
            return emitir.first
        siguiente(fr, pag)
    raise Alto("no llegué a la pantalla con el botón Emitir")


def foto(pag, fr):
    try:
        el = fr.frame_element()
        alto_ = fr.evaluate("() => document.documentElement.scrollHeight")
        pag.set_viewport_size({"width": 1366, "height": min(max(1000, alto_ + 260), 6000)})
        esperar(pag, 800)
        return el.screenshot(type="jpeg", quality=80)
    except Exception:
        return pag.screenshot(type="jpeg", quality=80, full_page=True)


def leer_numero(pag, fr):
    for _ in range(90):
        esperar(pag, 1000)
        try:
            txt = fr.inner_text("body")
        except Exception:
            continue
        m = re.search(r"\b(EG\d{2}|T\d{3})\s*-\s*(\d+)\b", txt)
        if m and re.search(r"emiti|generad|registrad|exito", simple(txt)):
            return f"{m.group(1)}-{m.group(2)}"
        b = fr.locator(".modal button:visible", has_text=re.compile(r"^\s*(SI|Sí|Si|Aceptar|Confirmar|Emitir)\s*$"))
        if b.count() and re.search(r"seguro|confirm|desea emitir", simple(txt)):
            paso("SUNAT pide confirmar la emisión: confirmo (es la que se aprobó)")
            b.last.click()
        if re.search(r"error|no se pudo|rechaz", simple(" ".join(fr.locator(".modal:visible").all_inner_texts()))):
            raise Alto("SUNAT respondió con un error al emitir: " + sin_datos(" ".join(fr.locator(".modal:visible").all_inner_texts()))[:200])
    return ""


def bajar_pdf(pag, fr):
    for rx in (r"PDF", r"Descargar", r"Imprimir"):
        b = fr.locator("button:visible, a:visible", has_text=re.compile(rx, re.I))
        if not b.count():
            continue
        try:
            with pag.expect_download(timeout=30000) as d:
                b.first.click()
            with open(d.value.path(), "rb") as f:
                return base64.b64encode(f.read()).decode()
        except Exception:
            continue
    return ""


def main():
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    modo = os.environ.get("MODO", "vista")
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    r = bot({"accion": "gre_caso"})
    if not r.get("ok") or not r.get("datos"):
        sys.exit("El bot no entregó el caso: " + str(r.get("error", ""))[:150])
    texto = r["datos"]
    huella = hashlib.sha256(texto.encode("utf-8")).hexdigest()[:10]
    c = json.loads(texto)
    if c.get("empresa_ruc") != ruc:
        fin(False, "El caso es de otra empresa que la de esta corrida.")
        sys.exit("El caso es de otra empresa")
    if modo == "emitir" and os.environ.get("CONFIRMAR", "") != huella:
        fin(False, "La confirmación no corresponde a este caso (¿se cambió algo después de aprobar?). No se emitió nada.")
        sys.exit("Clave de confirmación incorrecta")
    paso(f"Caso recibido · modo {modo} · {len(c['bienes'])} bien(es)")

    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
        pag = fr = None
        try:
            ctx, pag, fr = ingresar(nav, ruc, usuario, clave)
            p1_datos(fr, pag, c)
            p2_actores(fr, pag, c)
            p3_documentos(fr, pag, c)
            p4_bienes(fr, pag, c)
            p5_puntos(fr, pag, c)
            p6_transporte(fr, pag, c)
            emitir = final(fr, pag)
            img = base64.b64encode(foto(pag, fr)).decode()
            if modo != "emitir":
                bot({"accion": "gre_vista", "imagen": img, "huella": huella, "notas": OBSERVACIONES[:5]})
                print("::notice title=GRE vista::Vista previa enviada al chat. No se emitió nada.")
                return
            # ===== EMITIR (aprobado por la persona con la huella de este caso) =====
            paso("Tocando Emitir…")
            emitir.click()
            numero = leer_numero(pag, fr)
            if not numero:
                fin(False, "Se tocó Emitir pero no leí el número de la guía. Revise en SOL → Consulta de GRE antes de reintentar.",
                    imagen=base64.b64encode(foto(pag, fr)).decode(), dudoso=True)
                print("::warning title=GRE sin confirmar::No leí el número")
                sys.exit(2)
            print(f"::notice title=GRE emitida::{numero}")
            fin(True, "Guía emitida", numero=numero, pdf=bajar_pdf(pag, fr), imagen=base64.b64encode(foto(pag, fr)).decode())
        except Alto as e:
            print(f"::error title=GRE no emitida::{sin_datos(e)}")
            try:
                img = base64.b64encode(foto(pag, fr)).decode() if fr else ""
            except Exception:
                img = ""
            fin(False, str(e) + ("\n\n" + e.detalle if e.detalle else ""), imagen=img, opciones=e.opciones)
            sys.exit(1)
        except Exception as e:   # error inesperado: se avisa al chat con la foto de dónde quedó (nada se emitió)
            print(f"::error title=GRE robot::{type(e).__name__} en {sin_datos(PASO_ACTUAL[0])}")
            try:
                img = base64.b64encode(foto(pag, fr)).decode() if fr else ""
            except Exception:
                img = ""
            fin(False, f"El robot no pudo seguir en «{PASO_ACTUAL[0]}». Le mando la foto de dónde quedó.", imagen=img)
            raise


if __name__ == "__main__":
    main()
