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
import time
import unicodedata
import urllib.request

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "guias", "scripts"))
try:
    import en_vivo   # 📺 la pantalla al bot, si la persona lo activó
except Exception:
    en_vivo = None

CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
STATE = ("rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
MENU_GRE = ["nivel1_62", "nivel2_62_1", "nivel3_62_1_1", "nivel4_62_1_1_1_1"]   # Emisión de GRE
MENU_CONSULTA = ["nivel1_62", "nivel2_62_1", "nivel3_62_1_5", "nivel4_62_1_5_1_1"]   # Consulta de GRE
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
    # En modo pdf el resultado es solo el PDF: nunca cambia el estado de la guía emitida.
    accion = "gre_pdf" if os.environ.get("MODO") == "pdf" else "gre_fin"
    bot(dict({"accion": accion, "ok": ok, "texto": texto}, **extra))
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


class SunatCaida(Exception):
    """SUNAT dice que sus servicios no están disponibles por unos minutos."""


def sunat_caida(fr):
    """¿SUNAT muestra «en estos momentos no se puede acceder a los servicios de SUNAT… reintentar»?"""
    try:
        t = " ".join(fr.locator(".modal:visible").all_inner_texts())
    except Exception:
        return False
    return bool(re.search(r"no se puede acceder a los servicios|reintentar en \d+ minutos|servicio no disponible", t, re.I))


def cerrar_avisos(fr, pag):
    """Avisos informativos de SUNAT (Entendido / Aceptar / ¿Desea continuar? → SI). Devuelve sus textos."""
    vistos = []
    if sunat_caida(fr):
        raise SunatCaida("SUNAT no está disponible por unos minutos")
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


CARGANDO_JS = """() => [...document.querySelectorAll('[class*=spinner], [class*=loading], [class*=loader], .blockUI, .cdk-overlay-backdrop')]
  .some(e => e.offsetParent !== null && e.getBoundingClientRect().width > 20)"""


def esperar_carga(fr, pag, max_s=25):
    """Espera a que SUNAT termine de cargar (el círculo que gira). True si terminó."""
    for _ in range(max_s * 2):
        try:
            if not fr.evaluate(CARGANDO_JS):
                return True
        except Exception:
            return True
        pag.wait_for_timeout(500)
    paso(f"   SUNAT siguió cargando {max_s} s")
    return False


def confirmar_modal(fr, pag):
    """Toca Agregar/Aceptar de la ventana cuando SUNAT lo habilita (espera a que termine de cargar)."""
    listo = esperar_carga(fr, pag)
    b = boton_agregar_modal(fr)
    for _ in range(40):
        if b.count() and b.is_enabled():
            b.click(timeout=5000)
            return
        pag.wait_for_timeout(500)
    vacios = modal(fr).evaluate("""m => [...m.querySelectorAll('input')].filter(e => e.offsetParent !== null && e.type !== 'checkbox'
        && e.type !== 'radio' && !e.value).map(e => (e.closest('div') && e.closest('div').parentElement && e.closest('div').parentElement.querySelector('label')
        || {innerText: e.getAttribute('formcontrolname') || '?'}).innerText.trim())""")
    if not listo or fr.evaluate(CARGANDO_JS):
        raise SunatCaida("SUNAT se quedó cargando")
    raise Alto("SUNAT no deja agregar: faltan " + (", ".join(vacios)[:200] or "datos en la ventana"))


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
        try:   # estado de la pantalla (sin datos personales): cuántas filas tiene cada tabla y qué campos están vacíos
            estado = fr.evaluate("""() => {
              const vis = e => e && e.offsetParent !== null;
              const tablas = [...document.querySelectorAll('table')].filter(vis).map(t => t.querySelectorAll('tbody tr').length);
              const vacios = [...document.querySelectorAll('input, select, textarea')].filter(vis)
                .filter(e => e.type !== 'checkbox' && e.type !== 'radio' && !e.value && !e.closest('.modal'))
                .map(e => (e.getAttribute('formcontrolname') || e.name || e.id || '?') + (e.disabled ? '(bloq)' : ''));
              const marcas = [...document.querySelectorAll('input[type=checkbox], input[type=radio]')].filter(vis)
                .map(e => (e.getAttribute('formcontrolname') || e.name || e.id || '?') + '=' + (e.checked ? 1 : 0));
              const rojo = [...document.querySelectorAll('.text-danger, .invalid-feedback, small')].filter(vis)
                .map(e => e.innerText.trim()).filter(Boolean).slice(0, 6);
              const sig = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Siguiente');
              return {tablas, vacios, marcas, rojo, siguiente_bloqueado: sig ? sig.disabled : null};
            }""")
            paso(f"   estado: {sin_datos(json.dumps(estado, ensure_ascii=False))[:900]}")
            if not faltan:
                faltan = [f"vacíos: {', '.join(estado.get('vacios', [])[:6])}"] + estado.get("rojo", [])[:3]
        except Exception:
            pass
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


ABREV = {"pque": "parque", "pq": "parque", "prq": "parque", "ind": "industrial", "indust": "industrial", "mza": "mz",
         "manzana": "mz", "lte": "lt", "lote": "lt", "lot": "lt", "avenida": "av", "jiron": "jr", "calle": "cal",
         "carretera": "carr", "car": "carr", "km": "km"}


def fichas(t):
    """Palabras de una dirección, con abreviaturas unificadas (PQUE = PARQUE, Z.I. = ZONA INDUSTRIAL) y manzana/lote
    pegados a su valor (MZ-E → mz:e, LT-4 Y 14 → lt:4, 14)."""
    t = re.sub(r"\bz\s*\.?\s*i\b\.?", " zona industrial ", simple(t))
    w = [ABREV.get(x, x) for x in re.findall(r"[a-z0-9]+", t)]
    out = set()
    for i, x in enumerate(w):
        if x in ("mz", "lt", "km") and i + 1 < len(w):
            out.add(f"{x}:{w[i + 1]}")
        elif (len(x) > 1 or x.isdigit()) and x not in COMUNES:
            out.add(x)
    return out


def puntaje(a, b):
    """Coincidencia entre dos direcciones: palabras en común (sin las de siempre: av, de, la…); manzana y lote valen doble."""
    comun = fichas(a) & fichas(b)
    return sum(2 if ":" in x else 1 for x in comun)


PAGINAR_JS = """([m, hacia]) => {
  const modal = [...document.querySelectorAll('.modal')].filter(e => e.offsetParent !== null).pop();
  if (!modal) return false;
  const rx = hacia === 'sig' ? /^(siguiente|next|›|»|>)$/i : /^(anterior|previous|‹|«|<)$/i;
  const cls = hacia === 'sig' ? /next/i : /prev/i;
  const b = [...modal.querySelectorAll('a, button, li, span')].filter(e => e.offsetParent !== null)
    .find(e => rx.test((e.innerText || '').trim()) || cls.test(e.className || ''));
  if (!b) return false;
  const off = x => x && (/disabled/.test(x.className || '') || x.disabled || x.getAttribute('aria-disabled') === 'true');
  if (off(b) || off(b.parentElement)) return false;
  (b.querySelector('a') || b).click();
  return true;
}"""


def leer_filas(m):
    filas = m.locator("table tbody tr")
    out = []
    for i in range(filas.count()):
        c = filas.nth(i).evaluate("f => [...f.querySelectorAll('td')].map(t => t.innerText.trim()).filter(Boolean)")
        if c and not re.search(r"no hay registros|ningun", simple(" ".join(c))):
            out.append(c)
    return out


def todas_las_filas(fr, pag):
    """La lista de locales de SUNAT viene en páginas de 10: se recorren todas (o se pide mostrar todas)."""
    m = modal(fr)
    largo = m.locator("select[name$=_length], .dataTables_length select").first
    if largo.count():
        try:
            ops = largo.locator("option").all_inner_texts()
            nums = [o for o in ops if re.sub(r"\D", "", o)]
            if nums:
                largo.select_option(label=max(nums, key=lambda o: int(re.sub(r"\D", "", o) or 0)))
                esperar(pag, 1000)
        except Exception:
            pass
    vistas, todas = set(), []
    for _ in range(20):
        nuevas = 0
        for c in leer_filas(m):
            k = " · ".join(c)
            if k not in vistas:
                vistas.add(k); todas.append(c); nuevas += 1
        if not nuevas or not fr.evaluate(PAGINAR_JS, [None, "sig"]):
            break
        esperar(pag, 900)
    return todas


def marcar_fila(fr, pag, celdas):
    """Marca la fila con esas celdas: la busca con «Buscar» (filtra todas las páginas) o recorriendo las páginas."""
    m = modal(fr)
    clave = simple(" · ".join(celdas))
    buscar = m.locator("input[type=search], label:has-text('Buscar') input").first
    if buscar.count():
        buscar.fill(celdas[-1][:40])
        esperar(pag, 1200)
    for _ in range(25):
        filas = m.locator("table tbody tr")
        for i in range(filas.count()):
            c = filas.nth(i).evaluate("f => [...f.querySelectorAll('td')].map(t => t.innerText.trim()).filter(Boolean)")
            if simple(" · ".join(c)) == clave:
                filas.nth(i).locator("input[type=radio]").first.check(timeout=4000)
                return True
        if not fr.evaluate(PAGINAR_JS, [None, "sig"]):
            break
        esperar(pag, 900)
    if buscar.count():   # el filtro no lo encontró: desde la primera página, sin filtro
        buscar.fill("")
        esperar(pag, 1000)
        for _ in range(20):
            if not fr.evaluate(PAGINAR_JS, [None, "ant"]):
                break
            esperar(pag, 600)
        return marcar_fila_sin_buscar(fr, pag, clave)
    return False


def marcar_fila_sin_buscar(fr, pag, clave):
    m = modal(fr)
    for _ in range(25):
        filas = m.locator("table tbody tr")
        for i in range(filas.count()):
            c = filas.nth(i).evaluate("f => [...f.querySelectorAll('td')].map(t => t.innerText.trim()).filter(Boolean)")
            if simple(" · ".join(c)) == clave:
                filas.nth(i).locator("input[type=radio]").first.check(timeout=4000)
                return True
        if not fr.evaluate(PAGINAR_JS, [None, "sig"]):
            return False
        esperar(pag, 900)
    return False


def elegir_fila(fr, pag, p, alerta, cual):
    """Marca el local del caso entre TODOS los que SUNAT tiene (todas las páginas): el que la persona eligió (fila exacta)
    o el más parecido. Si no hay uno claro, manda la lista completa al chat para elegir con un número."""
    celdas = todas_las_filas(fr, pag)
    if not celdas:
        raise Alto(alerta)
    textos = [" · ".join(x) for x in celdas]
    n = len(textos)
    paso(f"   {cual}: SUNAT tiene {n} local(es)")
    elegido, ia = None, {}
    if p.get("fila"):
        elegido = next((i for i in range(n) if simple(textos[i]) == simple(p["fila"])), None)
    if elegido is None and n > 1:   # la IA elige con todo el contexto (lo que dijo la persona, ticket, factura)
        ia = bot({"accion": "gre_elegir", "cual": cual, "lista": textos[:80]})
        if ia.get("ok") and ia.get("seguro") and 1 <= int(ia.get("numero") or 0) <= n:
            elegido = int(ia["numero"]) - 1
            paso(f"   la IA eligió el local {elegido + 1} de {n}")
        else:
            paso(f"   la IA no está segura ({'ok' if ia.get('ok') else 'sin respuesta'}): uso la comparación de palabras")
    if elegido is None:
        pts = [puntaje(p["direccion"], t) for t in textos]
        mejor = max(range(n), key=lambda i: pts[i])
        palabras = lambda t: frozenset(w for w in re.findall(r"[a-z]+", simple(t)) if len(w) > 1 and w not in COMUNES | {"domicilio", "fiscal"})
        unico = len({palabras(textos[i]) for i in range(n) if pts[i] == pts[mejor]}) == 1   # empate de la misma dirección: vale la primera
        # Basta una palabra ("Mártires") si solo un local la tiene; si empatan, hacen falta 2 o más y ganar.
        if n > 1 and not (pts[mejor] >= 1 and unico):
            # Primero los más parecidos a lo que dijo la persona (hasta 25); el número que responda es de ESTA lista.
            sugeridos = [int(x) - 1 for x in (ia.get("candidatos") or []) if 1 <= int(x) <= n]
            orden = (sugeridos + [i for i in sorted(range(n), key=lambda i: -pts[i]) if i not in sugeridos])[:25]
            lista = "\n".join(f"{k + 1}) " + re.sub(r"\s+", " ", textos[i]).strip()[:85] for k, i in enumerate(orden))
            raise Alto(alerta + ": no hay un local que coincida claramente con «" + str(p["direccion"])[:60] + "».",
                       f"SUNAT tiene {n} locales; estos son los más parecidos:\n{lista}\n\n"
                       "Responda solo con el número (ej. «3») y vuelvo a preparar la vista previa. Si no está, dígame otra parte de la dirección.",
                       {"cual": cual, "lista": [{"fila": textos[i], "direccion": (celdas[i] or [""])[-1]} for i in orden]})
        elegido = mejor
    if not marcar_fila(fr, pag, celdas[elegido]):
        raise Alto(alerta + ": encontré el local pero SUNAT no me dejó marcarlo.")
    return elegido


# ============================================================ pantallas

def pasar_avisos_sol(pag, rondas=4):
    """Pantallas que SOL pone a veces al ingresar: «Informativo» sobre «datos de contacto» (botón Finalizar, que solo
    cierra el aviso), «Continuar sin confirmar», campañas («Omitir», «Ahora no», «Cerrar»). Se pasan sin confirmar ni
    actualizar nada. Devuelve cuántas pasó."""
    hechos = 0
    for _ in range(rondas):
        tocado = False
        for f in pag.frames:
            for t in ("Finalizar", "Continuar sin confirmar", "Omitir", "Ahora no", "Cerrar", "Aceptar"):
                try:
                    b = f.get_by_text(t, exact=True)
                    for i in range(b.count()):
                        el = b.nth(i)
                        if not el.is_visible():
                            continue
                        if t in ("Finalizar", "Aceptar", "Cerrar"):   # solo dentro de un aviso informativo, nunca de un formulario
                            caja = el.evaluate("e => { const m = e.closest('.modal, .modal-dialog, [role=dialog], .ui-dialog'); return m ? m.innerText : ''; }")
                            if not re.search(r"(?i)informativo|datos de contacto|c[oó]digo de verificaci[oó]n|campa[nñ]a|comunicado", caja or ""):
                                continue
                        el.click(timeout=3000)
                        pag.wait_for_timeout(1500)
                        hechos += 1
                        tocado = True
                        break
                except Exception:
                    continue
        if not tocado:
            break
    if hechos:
        print(f"  Avisos de SOL al ingresar: {hechos} (pasados sin confirmar nada)")
    return hechos


def ingresar(nav, ruc, usuario, clave, menu=None, marco="emitir-gre", listo="Remitente"):
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
    # Pantallas que SOL pone a veces después de ingresar (campañas, «confirme sus datos»): se pasan sin aceptar nada.
    pasar_avisos_sol(pag)
    for i in (menu or MENU_GRE):   # se abre con clics, como una persona (ir directo a la dirección lo corta SUNAT)
        for f in pag.frames:
            try:
                if f.evaluate("i => { const e = document.getElementById(i); if (!e) return false; (e.querySelector('a') || e).click(); return true; }", i):
                    break
            except Exception:
                continue
        esperar(pag, 1500)
    for _ in range(30):
        fr = next((f for f in pag.frames if marco in f.url), None)
        if fr:
            try:
                fr.get_by_text(listo, exact=True).first.wait_for(timeout=2000)
                return ctx, pag, fr
            except Exception:
                pass
        esperar(pag, 1000)
    # Casi siempre es SOL lento o caído por un momento: se reintenta como una caída (nada se llenó todavía).
    e = SunatCaida("no se abrió «" + ("Consulta de GRE" if marco == "consultagre" else "Emisión de GRE") + "» en SOL")
    e.ctx, e.pag = ctx, pag
    raise e


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
    confirmar_modal(fr, pag)
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
        confirmar_modal(fr, pag)
        esperar(pag, 2000)
        avisos = cerrar_avisos(fr, pag)
        if avisos and fr.locator(".modal:visible").count():
            raise Alto(f"SUNAT no aceptó el documento relacionado: {sin_datos(' '.join(avisos))[:200]}")
    siguiente(fr, pag)


def clave_bien(t):
    return re.sub(r"[^a-z0-9]", "", simple(t))


def filas_bienes(fr):
    """Filas que ya tiene la tabla de bienes (SUNAT las trae solas de la factura electrónica relacionada)."""
    return fr.evaluate("""() => {
      const vis = e => e && e.offsetParent !== null;
      const t = [...document.querySelectorAll('table')].filter(vis).filter(t => !t.closest('.modal'))
        .find(t => /descripci/i.test(t.innerText) && /cantidad/i.test(t.innerText));
      if (!t) return [];
      return [...t.querySelectorAll('tbody tr')].filter(vis).map((r, i) => {
        const c = [...r.querySelectorAll('td')].map(x => x.innerText.trim());
        const nums = c.filter(x => /^[\\d.,]+$/.test(x)).map(x => parseFloat(x.replace(/,/g, '')));
        const desc = c.filter(x => /[a-zA-Z]{3}/.test(x)).sort((a, b) => b.length - a.length)[0] || '';
        return {i, desc, cant: nums.length ? nums[nums.length - 1] : null};
      }).filter(f => f.desc);
    }""")


def quitar_fila_bien(fr, pag, i):
    """Quita la fila i de la tabla de bienes (botón ×/papelera de la fila) y confirma si SUNAT pregunta."""
    ok = fr.evaluate("""i => {
      const vis = e => e && e.offsetParent !== null;
      const t = [...document.querySelectorAll('table')].filter(vis).filter(t => !t.closest('.modal'))
        .find(t => /descripci/i.test(t.innerText) && /cantidad/i.test(t.innerText));
      const r = t && [...t.querySelectorAll('tbody tr')].filter(vis)[i];
      if (!r) return false;
      const b = [...r.querySelectorAll('button, a, i, span')].reverse()
        .find(e => /^\\s*[×xX✕]\\s*$/.test(e.innerText || '') || /trash|delete|remove|close|elimin|times/i.test(e.className + ' ' + (e.title || '')));
      if (!b) return false;
      b.click(); return true;
    }""", i)
    if not ok:
        return False
    esperar(pag, 1000)
    conf = fr.locator(".modal:visible").filter(has_text=re.compile(r"elimin|quitar|borrar|desea", re.I))
    if conf.count():
        conf.last.locator("button:visible", has_text=re.compile(r"^\s*(SI|Sí|Si|Aceptar|Eliminar)\s*$")).last.click(timeout=4000)
        esperar(pag, 1000)
    return True


def p4_bienes(fr, pag, c):
    paso(f"4. Bienes a transportar ({len(c['bienes'])})")
    esperar(pag, 1500)
    cerrar_avisos(fr, pag)
    # Con una factura electrónica relacionada, SUNAT ya trae sus líneas: no se vuelven a agregar (antes salían duplicadas).
    # Se quitan las que la guía no lleva (o con otra cantidad) y se agregan solo las que falten.
    pendientes = list(c["bienes"])
    traidas = filas_bienes(fr)
    if traidas:
        quitar = []
        for f in traidas:
            k = clave_bien(f["desc"])
            j = next((n for n, b in enumerate(pendientes) if clave_bien(b["descripcion"]) == k
                      or (len(k) > 8 and (clave_bien(b["descripcion"]).startswith(k) or k.startswith(clave_bien(b["descripcion"]))))), None)
            if j is not None and f["cant"] is not None and abs(float(f["cant"]) - float(pendientes[j]["cantidad"])) < 0.001:
                pendientes.pop(j)   # ya está, con la misma cantidad
            else:
                quitar.append(f["i"])
        paso(f"   SUNAT trajo {len(traidas)} línea(s) de la factura · quedan {len(traidas) - len(quitar)} · a quitar {len(quitar)} · a agregar {len(pendientes)}")
        for i in sorted(quitar, reverse=True):
            if not quitar_fila_bien(fr, pag, i):
                raise Alto("SUNAT trajo las líneas de la factura y no pude quitar las que la guía no lleva. "
                           "Dígame si la guía va por el total de la factura.")
    for b in pendientes:
        fr.locator("button:visible", has_text=AGREGAR).first.click(timeout=5000)
        esperar(pag, 1500)
        fr.locator("#descBien").fill(str(b["descripcion"])[:250])
        combo(fr, pag, "Unidad de medida del bien", f"{b.get('unidad') or 'NIU'} - ")
        fr.locator("[formcontrolname=cantidad], input[name=cantidad]").first.fill(str(b["cantidad"]))
        confirmar_modal(fr, pag)
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
    confirmar_modal(fr, pag)
    esperar(pag, 2500)
    cerrar_avisos(fr, pag)


def p5_puntos(fr, pag, c):
    paso("5. Punto de partida y llegada")
    punto(fr, pag, 0, c["partida"], "partida")
    punto(fr, pag, 1, c["llegada"], "llegada")
    siguiente(fr, pag)


def fecha(fr, pag, nombre, valor, obligatoria=True):
    """Fecha en el calendario de SUNAT (ngbDatepicker bloqueado para escribir): se elige con el botón 📅 (mes, año y día),
    como una persona. Si el calendario no abre, se intenta escribirla quitando el bloqueo."""
    f = fr.locator(f"input[name={nombre}]").first
    if not f.count() or not f.is_visible():
        return
    if (f.input_value() or "").strip() == valor:
        return
    d, mes, a = (int(x) for x in valor.split("/"))
    try:
        boton = f.locator("xpath=ancestor::*[.//button][1]//button").first
        boton.click(timeout=4000)
        esperar(pag, 900)
        cal = fr.locator("ngb-datepicker:visible").last
        cal.wait_for(timeout=4000)
        sel = cal.locator("select")
        if sel.count() >= 2:
            sel.nth(0).select_option(str(mes))
            sel.nth(1).select_option(str(a))
            esperar(pag, 500)
        cal.locator(".ngb-dp-day:not(.disabled) > div:not(.outside)", has_text=re.compile(rf"^\s*{d}\s*$")).first.click(timeout=4000)
        esperar(pag, 900)
    except Exception as e:
        paso(f"   calendario de {nombre}: {type(e).__name__}; pruebo escribiendo")
        try:
            f.evaluate("e => { e.removeAttribute('readonly'); e.readOnly = false; e.disabled = false; }")
            f.fill(valor, timeout=4000)
            f.press("Tab")
        except Exception:
            pass
        esperar(pag, 800)
    pag.keyboard.press("Escape")
    ok = (f.input_value() or "").strip() == valor
    paso(f"   fecha {nombre}: {'puesta' if ok else 'NO quedó'}")
    if not ok and obligatoria:
        raise Alto("SUNAT no aceptó la fecha del traslado (" + ("entrega al transportista" if nombre == "d1" else "inicio de traslado") + ")")


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
        confirmar_modal(fr, pag)
        esperar(pag, 2000)
        avisos = cerrar_avisos(fr, pag)
        if fr.locator("[formcontrolname=nroRuc]:visible").count():
            raise Alto(f"SUNAT no aceptó al transportista: {sin_datos(' '.join(avisos))[:200]}")
        if t.get("registrar_vehiculos"):
            fr.get_by_text("Registrar vehículos y conductores del transportista").first.click()
            esperar(pag, 2000)
            vehiculos_conductores(fr, pag, t)
        fecha(fr, pag, "d1", c["fecha"])   # entrega de bienes al transportista
        fecha(fr, pag, "d2", c["fecha"])   # inicio de traslado (SUNAT la muestra también en público)
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
        # Constancia MTC de esa placa (en el mismo orden). SUNAT suele traer sola la TUCE; si está vacía se pone la constancia,
        # y si trae otra (p. ej. la carreta: TUCE 23M… y constancia 231800410) la constancia va como autorización especial del MTC.
        if n < len(constancias):
            cons = constancias[n]
            tarjeta = m.locator("[formcontrolname=nroTarjeta]").first
            actual = (tarjeta.input_value() or "").strip() if tarjeta.count() else ""
            if tarjeta.count() and not actual:
                llenar(tarjeta, cons)
            elif actual and re.sub(r"\W", "", actual) != re.sub(r"\W", "", cons):
                elegido = False
                for op in ("MTC", "MINISTERIO DE TRANSPORTES"):
                    try:
                        combo(fr, pag, "Entidad emisora", op)
                        elegido = True
                        break
                    except Alto:
                        continue
                aut = m.locator("[formcontrolname=nroAutorizacion]").first
                if elegido and llenar(aut, cons):
                    paso(f"   vehículo {n + 1}: autorización especial MTC puesta")
                else:
                    paso(f"   vehículo {n + 1}: no pude poner la autorización MTC (entidad {'ok' if elegido else 'no encontrada'})")
        confirmar_modal(fr, pag)
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
        esperar_carga(fr, pag)   # SUNAT busca el nombre del conductor; a veces tarda
        m = modal(fr)
        llenar(m.locator("[formcontrolname=nombreApellidos]").first, cd.get("nombre", "")) if not (
            m.locator("[formcontrolname=nombreApellidos]").first.input_value() or "").strip() else None
        paso(f"   conductor · licencia {'ok' if (lic.input_value() or '').strip() else 'vacía'} · documento "
             f"{'ok' if (doc.input_value() or '').strip() else 'vacío'}")
        confirmar_modal(fr, pag)
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


def bajar_pdf(pag, fr, boton=None):
    """PDF de la guía recién emitida. SUNAT primero muestra «Atención Contribuyente… Entendido» y el botón «Descargar PDF»
    puede bajar el archivo o abrirlo en otra pestaña: se acepta cualquiera de las dos y también la respuesta PDF misma."""
    try:
        for _ in range(3):   # avisos informativos (sin tocar nada más)
            b = fr.locator(".modal button:visible", has_text=re.compile(r"^\s*(Entendido|Aceptar)\s*$"))
            if not b.count():
                break
            b.last.click(timeout=3000)
            esperar(pag, 800)
    except Exception:
        pass
    ctx = pag.context
    for rx in ([None] if boton is not None else (r"^\s*Descargar PDF\s*$", r"\bPDF\b", r"Imprimir")):
        b = boton if boton is not None else fr.locator("button:visible, a:visible", has_text=re.compile(rx, re.I))
        if not b.count():
            continue
        capturado = {}

        def al_responder(r):
            try:
                if "pdf" in (r.headers.get("content-type") or "").lower() and "pdf" not in capturado:
                    capturado["pdf"] = r.body()
            except Exception:
                pass

        def al_bajar(d):
            try:
                capturado["dl"] = d.path()
            except Exception:
                pass

        ctx.on("response", al_responder)
        pag.on("download", al_bajar)
        paginas = len(ctx.pages)
        try:
            b.first.click(timeout=5000)
        except Exception:
            continue
        for _ in range(40):   # hasta 20 s
            pag.wait_for_timeout(500)
            if capturado:
                break
            if len(ctx.pages) > paginas:   # se abrió en otra pestaña
                nueva = ctx.pages[-1]
                try:
                    nueva.wait_for_load_state("load", timeout=15000)
                    nueva.on("download", al_bajar)
                    if nueva.url.startswith("http"):
                        r = ctx.request.get(nueva.url)
                        if "pdf" in (r.headers.get("content-type") or "").lower():
                            capturado["pdf"] = r.body()
                    elif nueva.url.startswith("blob:"):
                        datos = nueva.evaluate("""async u => { const b = await (await fetch(u)).blob();
                            return await new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result.split(',')[1]); f.readAsDataURL(b); }); }""", nueva.url)
                        if datos:
                            return datos
                except Exception:
                    pass
                pag.wait_for_timeout(1500)
                if capturado:
                    break
        try:
            ctx.remove_listener("response", al_responder)
            pag.remove_listener("download", al_bajar)
        except Exception:
            pass
        if capturado.get("pdf"):
            return base64.b64encode(capturado["pdf"]).decode()
        if capturado.get("dl"):
            with open(capturado["dl"], "rb") as f:
                return base64.b64encode(f.read()).decode()
    paso("   no pude bajar el PDF")
    return ""


CAMPOS_JS = """() => [...document.querySelectorAll('input, select, ng-select')].filter(e => e.offsetParent !== null
  && e.type !== 'hidden').map(e => { let l = ''; let p = e; for (let i = 0; i < 4 && p && !l; i++, p = p.parentElement) {
    const x = p.querySelector('label'); if (x) l = x.innerText.trim(); }
  return {n: e.getAttribute('formcontrolname') || e.name || e.id || '', t: e.type || e.tagName, l: l.slice(0, 60)}; })"""


def consultar_pdf(fr, pag, numero):
    """Consulta de GRE → GRE emitidas → Individual → serie y número → PDF. Solo consulta: no cambia nada en SUNAT."""
    m = re.match(r"\s*([A-Z0-9]{4})\s*-\s*0*(\d+)", numero.upper())
    if not m:
        raise Alto(f"el número de guía «{numero}» no tiene la forma EG07-00000502")
    serie, corr = m.group(1), m.group(2)
    paso("1. Consulta de GRE · emitidas · individual")
    for t in ("GRE emitidas", "Individual"):
        try:
            fr.get_by_text(t, exact=True).first.click(timeout=5000)
            esperar(pag, 600)
        except Exception:
            pass
    siguiente(fr, pag)
    esperar_carga(fr, pag)
    campos = fr.evaluate(CAMPOS_JS)
    paso(f"   pantalla «{sin_datos(pantalla(fr))}» · campos: {[(c['n'], c['l']) for c in campos]}")
    botones = [b.strip() for b in fr.locator("button:visible").all_inner_texts() if b.strip()]
    paso(f"   botones: {botones[:15]}")
    # 2. Criterios de búsqueda: tipo de GRE (radio «GRE - Remitente»), serie y número.
    try:
        fr.get_by_text("GRE - Remitente", exact=True).first.click(timeout=5000)
        esperar(pag, 600)
    except Exception:
        paso("   no encontré «GRE - Remitente»")
    for num in (corr, corr.zfill(8)):
        llenar(fr.locator("[formcontrolname=serie]").first, serie)
        llenar(fr.locator("[formcontrolname=numero]").first, num)
        fr.locator("[formcontrolname=numero]").first.press("Tab")
        esperar(pag, 800)
        b = fr.get_by_text("Siguiente", exact=True).first
        for _ in range(10):
            if b.is_enabled():
                break
            pag.wait_for_timeout(500)
        if b.is_enabled():
            b.click(timeout=5000)
            esperar(pag, 2500)
            esperar_carga(fr, pag)
            if "2. Criterios" not in pantalla(fr):
                break
        paso(f"   SUNAT no aceptó el número con {len(num)} dígitos")
    esperar(pag, 3000)
    esperar_carga(fr, pag)
    cerrar_avisos(fr, pag)
    paso(f"   resultado: «{sin_datos(pantalla(fr))}» · botones: {[b.strip() for b in fr.locator('button:visible, a:visible').all_inner_texts() if b.strip()][:20]}")
    # 3. Resultado: tabla con íconos sin texto; el PDF es la columna «Descargar representación».
    marcado = fr.evaluate("""() => {
      const t = [...document.querySelectorAll('table')].find(x => x.offsetParent !== null && /representaci/i.test(x.innerText));
      if (!t) return false;
      const ths = [...t.querySelectorAll('thead th, tr:first-child th')];
      const i = ths.findIndex(h => /representaci/i.test(h.innerText));
      const fila = t.querySelector('tbody tr');
      if (i < 0 || !fila) return false;
      const celda = fila.querySelectorAll('td')[i];
      const b = celda && (celda.querySelector('a, button, i, span, img') || celda);
      if (!b) return false;
      b.setAttribute('data-robot', 'pdf'); return true; }""")
    pdf = bajar_pdf(pag, fr, fr.locator("[data-robot=pdf]").first) if marcado else ""
    if not pdf:
        pdf = bajar_pdf(pag, fr)
    if not pdf:   # resultado en tabla: abrir la fila de esa guía
        fila = fr.locator("table tbody tr", has_text=re.compile(serie + r"\s*-\s*0*" + corr + r"\b")).first
        if fila.count():
            try:
                fila.locator("a, button, i, span[class*=icon]").first.click(timeout=4000)
                esperar(pag, 2500)
                cerrar_avisos(fr, pag)
                pdf = bajar_pdf(pag, fr)
            except Exception:
                pass
    return pdf


ESPERA_MIN = 12   # minutos que la vista previa queda abierta esperando ✅ Emitir


def esperar_decision(huella):
    """Pregunta al bot cada pocos segundos si la persona aprobó (emitir) o cambió algo (cerrar). True = emitir esta misma guía."""
    hasta = time.time() + ESPERA_MIN * 60
    while time.time() < hasta:
        r = bot({"accion": "gre_espera", "hasta": int(hasta * 1000)})
        if r.get("decision") == "emitir":
            return r.get("confirmar") == huella
        if r.get("decision") == "cerrar":
            return False
        time.sleep(8)
    r = bot({"accion": "gre_espera", "fin": True})   # último aviso: si justo aprobó, se emite igual
    return r.get("decision") == "emitir" and r.get("confirmar") == huella


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
    if modo == "pdf":
        numero = str(r.get("gre") or "")
        with sync_playwright() as p:
            pantalla = en_vivo.video(bot) if en_vivo else False   # 🎥 video en vivo (si está activo)
            nav = en_vivo.lanzar(p, pantalla, executable_path=os.environ.get("CHROMIUM") or None) if en_vivo \
                else p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
            if en_vivo:
                en_vivo.iniciar(bot, PASO_ACTUAL)
            pag = None
            try:
                ctx, pag, fr = ingresar(nav, ruc, usuario, clave, MENU_CONSULTA, "consultagre", "GRE emitidas")
                pdf = consultar_pdf(fr, pag, numero)
            except Exception as e:
                print(f"::error title=GRE pdf::{type(e).__name__}: {sin_datos(e)}")
                img = ""
                try:
                    img = base64.b64encode(pag.screenshot(type="jpeg", quality=70, full_page=True)).decode() if pag else ""
                except Exception:
                    pass
                fin(False, f"No pude bajar el PDF de SUNAT ({sin_datos(e)[:120]}). Puede descargarlo en SOL → Consulta de GRE.", imagen=img)
                sys.exit(1)
            if not pdf:
                fin(False, "Encontré la consulta pero no pude bajar el PDF. Puede descargarlo en SOL → Consulta de GRE.",
                    imagen=base64.b64encode(pag.screenshot(type="jpeg", quality=70, full_page=True)).decode())
                sys.exit(1)
            fin(True, "PDF de la guía", pdf=pdf)
            print("::notice title=GRE pdf::PDF enviado al chat")
        return
    if modo == "emitir" and os.environ.get("CONFIRMAR", "") != huella:
        fin(False, "La confirmación no corresponde a este caso (¿se cambió algo después de aprobar?). No se emitió nada.")
        sys.exit("Clave de confirmación incorrecta")
    paso(f"Caso recibido · modo {modo} · {len(c['bienes'])} bien(es)")

    with sync_playwright() as p:
        pantalla = en_vivo.video(bot) if en_vivo else False   # 🎥 video en vivo (si está activo)
        nav = en_vivo.lanzar(p, pantalla, executable_path=os.environ.get("CHROMIUM") or None) if en_vivo \
            else p.chromium.launch(executable_path=os.environ.get("CHROMIUM") or None)
        if en_vivo:
            en_vivo.iniciar(bot, PASO_ACTUAL)
        pag = fr = None
        try:
            # SUNAT a veces dice «en estos momentos no se puede acceder a los servicios… reintentar en 5 minutos»:
            # se espera y se empieza de nuevo (hasta 3 veces). Nunca después de tocar Emitir.
            for intento in range(1, 4):
                ctx = None
                try:
                    ctx, pag, fr = ingresar(nav, ruc, usuario, clave)
                    p1_datos(fr, pag, c)
                    p2_actores(fr, pag, c)
                    p3_documentos(fr, pag, c)
                    p4_bienes(fr, pag, c)
                    p5_puntos(fr, pag, c)
                    p6_transporte(fr, pag, c)
                    emitir = final(fr, pag)
                    break
                except Exception as e:
                    ctx, pag = getattr(e, "ctx", ctx), getattr(e, "pag", pag)
                    if not (isinstance(e, SunatCaida) or (fr and sunat_caida(fr))):
                        raise
                    if intento == 3:
                        raise Alto("SUNAT no respondió bien en 3 intentos (~7 minutos): " + (str(e) if isinstance(e, SunatCaida) else "servicio no disponible") +
                                   ". No se emitió nada. Escríbame «vuelve a intentar» en un rato y lo hago de nuevo.")
                    espera = 150 if intento == 1 else 240
                    paso(f"SUNAT no responde bien (intento {intento}: {e}): espero {espera // 60} min y empiezo de nuevo")
                    if intento == 1:
                        bot({"accion": "gre_aviso", "texto": "⏳ SUNAT no responde bien en este momento (" + str(e)[:80] + "). "
                             "Espero unos minutos y lo vuelvo a intentar solo. No se emitió nada."})
                    OBSERVACIONES.clear()
                    try:
                        ctx.close()
                    except Exception:
                        pass
                    fr = None
                    time.sleep(espera)
            img = base64.b64encode(foto(pag, fr)).decode()
            if modo != "emitir":
                bot({"accion": "gre_vista", "imagen": img, "huella": huella, "notas": OBSERVACIONES[:5]})
                print("::notice title=GRE vista::Vista previa enviada al chat. No se emitió nada.")
                # La pantalla queda abierta unos minutos: si la persona aprueba, se emite aquí mismo (sin volver a llenar).
                if not esperar_decision(huella):
                    paso("Nadie aprobó a tiempo (o pidieron cambios): cierro sin emitir")
                    return
                paso("La persona aprobó la emisión: emito en la misma pantalla de la vista previa")
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
                img = base64.b64encode(foto(pag, fr) if fr else pag.screenshot(type="jpeg", quality=70)).decode() if pag else ""
            except Exception:
                img = ""
            fin(False, str(e) + ("\n\n" + e.detalle if e.detalle else ""), imagen=img, opciones=e.opciones)
            sys.exit(1)
        except Exception as e:   # error inesperado: se avisa al chat con la foto de dónde quedó (nada se emitió)
            print(f"::error title=GRE robot::{type(e).__name__} en {sin_datos(PASO_ACTUAL[0])}")
            try:
                img = base64.b64encode(foto(pag, fr) if fr else pag.screenshot(type="jpeg", quality=70)).decode() if pag else ""
            except Exception:
                img = ""
            fin(False, f"El robot no pudo seguir en «{PASO_ACTUAL[0]}». Le mando la foto de dónde quedó.", imagen=img)
            raise


if __name__ == "__main__":
    main()
