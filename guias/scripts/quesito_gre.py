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
EXTRA_OBS = []   # lo que no se pudo poner en su propio campo (va en Observaciones)


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


def mostrar_todo(pag):
    """Para la foto: deja a la vista TODAS las secciones (traslado, transportista, conductor, partida, llegada).
    Quesito es un acordeón (abrir una cierra las otras): se fuerza que el cuerpo de cada sección se vea.
    Solo cambia cómo se ve la página: no envía nada."""
    try:
        n = pag.evaluate("""(titulos) => {
          const visible = e => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
          const campos = e => e && e.querySelector && e.querySelector('input:not([type=hidden]), select, textarea');
          const ver = e => { e.style.setProperty('display', 'block', 'important'); e.style.setProperty('height', 'auto', 'important');
            e.style.setProperty('visibility', 'visible', 'important'); e.style.setProperty('overflow', 'visible', 'important');
            e.style.setProperty('opacity', '1', 'important'); e.classList.add('in', 'show'); };
          let hechas = 0;
          const nodos = [...document.querySelectorAll('a, h1, h2, h3, h4, h5, h6, div, span, button, li')]
            .filter(e => visible(e) && titulos.some(t => (e.innerText || '').trim().toUpperCase().startsWith(t)) && !campos(e));
          titulos.forEach(t => {
            const ms = nodos.filter(e => (e.innerText || '').trim().toUpperCase().startsWith(t));
            const h = ms.find(e => !ms.some(o => o !== e && e.contains(o)));   // el más interno: el título mismo, no su caja
            if (!h) return;
            // el cuerpo: lo que sigue al título (en él o en uno de sus contenedores) y tiene campos
            for (let a = h, k = 0; a && k < 5; a = a.parentElement, k++) {
              let s = a.nextElementSibling;
              while (s && !campos(s)) s = s.nextElementSibling;
              if (s) { ver(s); s.querySelectorAll('.collapse, .panel-collapse, [style*="display: none"]').forEach(x => { if (campos(x)) ver(x); }); hechas++; break; }
            }
          });
          document.querySelectorAll('[data-parent], [data-bs-parent]').forEach(x => { x.removeAttribute('data-parent'); x.removeAttribute('data-bs-parent'); });
          return hechas; }""", ["DATOS DEL TRASLADO", "DATOS DEL TRANSPORTISTA", "DATOS DEL CONDUCTOR", "PUNTO DE PARTIDA", "PUNTO DE LLEGADA", "OBSERVACIONES"])
        paso(f"Foto: {n} sección(es) a la vista")
        pag.wait_for_timeout(500)
    except Exception as e:
        paso(f"Foto: no pude abrir las secciones ({str(e)[:80]})")


def foto(pag):
    mostrar_todo(pag)
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
    """Palabras que distinguen un producto: nombres y también códigos y lotes ("325", "1507")."""
    return {w for w in simple(t).split() if len(w) > 2}


def leer_pedido(texto):
    """"M&D 325 lote 1507: 10000; barra 5000" → [{"descripcion", "cantidad"}]. "total" o vacío → [] (todo)."""
    t = str(texto or "").strip()
    if not t or re.fullmatch(r"(?i)\s*(todo|total|todos|completo|toda la factura)\s*", t):
        return []
    out = []
    for parte in re.split(r"[;\n]+", t):
        parte = parte.strip()
        if not parte:
            continue
        m = re.search(r"[:=]?\s*(\d[\d.,]*)\s*(und|unid|unidades|niu|kg|cajas?|bolsas?|sacos?)?\s*$", parte, re.I)
        if not m:
            raise Alto(f"En «{parte}» no encontré la cantidad. Escríbalo así: «M&D 325 lote 1507: 10000» (o «total»). No se creó nada.")
        desc = parte[:m.start()].strip(" :=-")
        if re.fullmatch(r"(?i)\s*(todo|total)\s*", parte[m.start():]) or not desc:
            raise Alto(f"En «{parte}» falta el producto (código, nombre o lote). No se creó nada.")
        out.append({"descripcion": desc, "cantidad": num(m.group(1)), "pedido": True})
    return out


def productos(pag, c):
    """Deja en la guía solo los bienes del caso, con su cantidad (todo lo de la factura si coincide)."""
    ls = lineas(pag)
    bs = c.get("bienes") or leer_pedido(c.get("pedido"))
    if not ls:
        raise Alto("Quesito no trajo productos de la factura. No se creó nada.")
    if not bs and (c.get("todo_factura") or c.get("pedido") is not None):   # "¿Todo lo de la factura? = SI" o pedido "total": quedan todas
        paso(f"Productos: los {len(ls)} de la factura (todo)")
        return
    if len(bs) == len(ls) and all(abs(num(b.get("cantidad")) - num(l["cantidad"])) < 1e-6 for b, l in zip(bs, ls)):
        paso(f"Productos: los {len(ls)} de la factura, completos")
        return
    # Guía parcial o con otras cantidades: cada bien del caso con su línea (por descripción; si no, por orden).
    usadas, plan = set(), []
    for n, b in enumerate(bs):
        pb = palabras(b.get("descripcion"))
        puntos = sorted(((len(pb & palabras(l["texto"])) / max(1, len(pb)), l["i"]) for l in ls if l["i"] not in usadas), reverse=True)
        mejor = puntos[0] if puntos else (0, None)
        if b.get("pedido") and len(puntos) > 1 and puntos[1][0] == mejor[0] and mejor[0] > 0:   # "barra" calza con 2 líneas: no adivina
            textos = [l["texto"][:90] for l in ls if l["i"] in (puntos[0][1], puntos[1][1])]
            raise Alto(f"«{b.get('descripcion')}» calza con más de una línea de la factura: " + " | ".join(textos) +
                       ". Agregue el lote o el código (ej. «lote 1507: 10000»). No se creó nada.")
        i = mejor[1] if mejor[0] >= 0.5 else (ls[n]["i"] if len(bs) == len(ls) and not b.get("pedido") and ls[n]["i"] not in usadas else None)
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


def secundario(pag, boton, datos):
    """«+ Agregar vehículo / conductor» (solo arma campos en la pantalla) y llena los campos nuevos que aparecen.
    datos: {"placa": ...} o {"documento_numero", "nombre", "apellidos", "licencia"}; la clave se busca en el nombre del campo."""
    antes = set(pag.evaluate("() => [...document.querySelectorAll('input, select')].map(e => e.name).filter(Boolean)"))
    mostrar_todo(pag)   # el botón está dentro de una sección plegada (acordeón): se abre para verlo
    b = pag.get_by_text(re.compile(boton, re.I))
    if not b.count():
        paso("Secundario: no encontré el botón «" + boton + "»")
        return False
    vis = [b.nth(i) for i in range(b.count()) if b.nth(i).is_visible()] or [b.nth(b.count() - 1)]
    vis[0].evaluate("e => e.click()")   # clic de la página (aunque siga oculto): solo arma los campos
    pag.wait_for_timeout(800)
    nuevos = [n for n in pag.evaluate("() => [...document.querySelectorAll('input, select')].filter(e => e.type !== 'hidden').map(e => e.name).filter(Boolean)")
              if n not in antes]
    if not nuevos:
        return False
    puestos = 0
    for clave, valor in datos.items():
        if not valor:
            continue
        n = next((x for x in nuevos if clave in x.lower()), None)
        if clave == "nombre":   # "nombre" sin confundirse con "documento" ni "apellidos"
            n = next((x for x in nuevos if re.search(r"nombre", x, re.I) and not re.search(r"apellido|documento", x, re.I)), None)
        if not n:
            continue
        if n.endswith("]") and "tipo" in n.lower():
            continue
        pag.evaluate("""([n, v]) => { const e = document.querySelector(`[name="${n}"]`); if (!e) return;
            e.value = v; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); }""", [n, str(valor)])
        puestos += 1
    tipo = next((x for x in nuevos if "documento_tipo" in x.lower()), None)
    if tipo and "documento_numero" in datos:   # DNI
        pag.evaluate("""(n) => { const e = document.querySelector(`select[name="${n}"]`); if (!e) return;
            const o = [...e.options].find(o => /DNI|DOC\\.? ?NACI/i.test(o.text)); if (o) { e.value = o.value;
            if (window.jQuery) window.jQuery(e).val(o.value).trigger('change'); else e.dispatchEvent(new Event('change', {bubbles: true})); } }""", tipo)
    paso(f"Secundario: {puestos} dato(s) en {len(nuevos)} campo(s) nuevo(s)")
    return puestos > 0


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
    if c.get("fecha_emision"):   # vacío en la hoja = hoy (lo que Quesito ya trae)
        puesta = False
        for nombre in ("fecha_de_emision", "fecha_emision"):
            try:
                fecha_form(pag, nombre, c["fecha_emision"])
                puesta = True
                break
            except Alto:
                continue
        if not puesta:
            NOTAS.append(f"No encontré la fecha de emisión en Quesito: quedó la de hoy (no {c['fecha_emision']}).")
    if c.get("fecha"):
        fecha_form(pag, "fecha_de_inicio_de_traslado", c["fecha"])
        fecha_form(pag, "fecha_de_entrega_al_transportista", c.get("fecha_entrega") or c["fecha"])   # vacío = el día del traslado
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
    if privado and (not placas or not conductores):
        raise Alto("Faltan la placa y el chofer (DNI y licencia). No se creó nada.")
    if not privado and (placas or conductores) and not re.search(r"Placa N°|Conductor:", str(c.get("observaciones") or "")):
        # público pedido por el bot (no viene armado de la hoja): el vehículo y el chofer que se tengan van en Observaciones
        cons = t.get("constancias") or []
        for k, pl in enumerate(placas[:2]):
            EXTRA_OBS.append(f"Placa N°{k + 1}: {pl}" + (f" (Cert. MTC {cons[k]})" if len(cons) > k and cons[k] else ""))
        for ch in conductores[:1]:
            EXTRA_OBS.append(f"Conductor: {ch.get('nombre') or '-'}" + (f", DNI {ch.get('dni')}" if ch.get("dni") else "") + (f", Licencia {ch.get('licencia')}" if ch.get("licencia") else ""))
    if privado and (placas or conductores):   # público: el vehículo y el chofer (opcionales) van en Observaciones
        if placas:
            poner(pag, "transportista_placa_numero", placas[0])
            if (t.get("constancias") or [None])[0]:
                poner(pag, "tuc_vehiculo_principal", t["constancias"][0])
        if conductores:
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
        for k, pl in enumerate(placas[1:3], start=1):   # Quesito acepta hasta 2 vehículos secundarios
            cons = t.get("constancias") or []
            if not secundario(pag, r"Agregar\s+veh[ií]culo", {"placa": pl, "tuc": cons[k] if len(cons) > k else ""}):
                NOTAS.append(f"No pude poner la placa secundaria {pl} en su campo: va en Observaciones.")
                EXTRA_OBS.append(f"Placa N°{k + 1}: {pl}" + (f" (MTC {cons[k]})" if len(cons) > k else ""))
        for ch2 in conductores[1:3]:
            nom2, ape2 = separar_nombre(ch2.get("nombre") or "")
            if not secundario(pag, r"Agregar\s+conductor", {"documento_numero": re.sub(r"\D", "", str(ch2.get("dni") or "")), "nombre": nom2,
                                                              "apellidos": ape2, "licencia": ch2.get("licencia") or ""}):
                NOTAS.append("No pude poner el conductor secundario en su campo: va en Observaciones.")
                EXTRA_OBS.append(f"Conductor 2: {ch2.get('nombre') or ''}, DNI {ch2.get('dni') or ''}, Licencia {ch2.get('licencia') or ''}")
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
    obs = ". ".join([x for x in [str(c.get("observaciones") or "").strip().rstrip(".")] + EXTRA_OBS if x])   # solo lo que no tiene campo propio
    if obs:
        pag.evaluate(f"(v) => {{ const e = document.querySelector(\"textarea[name='{F}[observaciones]']\"); if (e) e.value = v; }}", (obs + ".")[:250])
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


def factura_de_cotizacion(pag, cot):
    """N° de cotización → "FQQ1-3702" (su CPE relacionado en Cotizaciones). Busca hacia atrás hasta 3 meses."""
    pag.goto(BASE + "/estimates", wait_until="networkidle", timeout=60000)
    hoy = time.localtime()
    desde_m, desde_a = (hoy.tm_mon - 3, hoy.tm_year) if hoy.tm_mon > 3 else (hoy.tm_mon + 9, hoy.tm_year - 1)
    puesto = pag.evaluate("""([dm, da, hd, hm, ha]) => {
      const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const sel = [...document.querySelectorAll('select')].filter(s => s.offsetParent !== null);
      const esDia = s => s.options.length >= 28 && s.options.length <= 32 && /^\\d{1,2}$/.test(s.options[0].text.trim());
      const esMes = s => [...s.options].some(o => /octubre|enero/i.test(o.text));
      const esAnio = s => [...s.options].some(o => /^20\\d\\d$/.test(o.text.trim()));
      const d = sel.filter(esDia), m = sel.filter(esMes), a = sel.filter(esAnio);
      if (d.length < 2 || m.length < 2 || a.length < 2) return false;
      const pon = (s, f) => { const o = [...s.options].find(f); if (o) { s.value = o.value; s.dispatchEvent(new Event('change', {bubbles: true})); } return !!o; };
      return pon(d[0], o => o.text.trim() === '1') && pon(m[0], o => o.text.trim().toLowerCase() === meses[dm - 1]) && pon(a[0], o => o.text.trim() === String(da))
        && pon(d[1], o => o.text.trim() === String(hd)) && pon(m[1], o => o.text.trim().toLowerCase() === meses[hm - 1]) && pon(a[1], o => o.text.trim() === String(ha)); }""",
        [desde_m, desde_a, hoy.tm_mday, hoy.tm_mon, hoy.tm_year])
    if puesto:
        b = pag.get_by_text(re.compile(r"^\s*Filtrar\s*$", re.I))
        if b.count():
            b.first.click()
            esperar(pag, 2500)
    for _ in range(30):   # página por página
        fila = pag.locator("tr").filter(has=pag.locator("td", has_text=re.compile(r"^\s*" + str(cot) + r"\s*$")))
        if fila.count():
            m = re.search(r"\b([FB][A-Z0-9]{3})\s*-\s*0*(\d+)", fila.first.inner_text())
            if not m:
                raise Alto(f"La cotización {cot} no tiene factura relacionada en Quesito todavía. No se creó nada.")
            return m.group(1), m.group(2)
        sig = pag.get_by_text(re.compile(r"Next", re.I))
        if not sig.count() or "disabled" in (sig.first.get_attribute("class") or "") or not sig.first.is_visible():
            break
        antes = pag.url
        sig.first.click()
        esperar(pag, 1500)
        if pag.url == antes:
            break
    raise Alto(f"No encontré la cotización {cot} en Quesito de esta empresa (últimos 3 meses). No se creó nada.")


# "OTROS", "-", "SIN DIRECCION"…: la factura no trae una dirección de verdad
SIN_DIRECCION = re.compile(r"(?i)^\s*(otros?|-+|\.+|s/?n|sin\s+direcci[oó]n|no\s+(tiene|indica|registra|domiciliado)|ninguna?|varios)\s*\.?\s*$")


def datos_pdf(txt, propio=""):
    """Cliente según el texto del PDF de la factura: {nombre, ruc, direccion} (lo que se encuentre con seguridad).
    El nombre debe tener letras (no "Cód. cliente: 5032565" ni un teléfono); el RUC no puede ser el de la propia empresa."""
    out = {}
    corta = lambda v: re.split(r"\s{3,}", v.strip())[0].strip()
    for pat in (r"SE[ÑN]OR\s*\(?ES\)?\s*:\s*(.+)", r"RAZ[OÓ]N\s+SOCIAL\s*(?:DEL\s+CLIENTE)?\s*:\s*(.+)",
                r"(?<![A-Z.])(?:CLIENTE|ADQUIRIENTE)\s*:\s*(.+)"):
        for m in re.finditer(pat, txt, re.I):
            v = corta(m.group(1))
            if len(re.findall(r"[A-Za-zÑñ]", v)) >= 3:
                out["nombre"] = v
                break
        if "nombre" in out:
            break
    for m in re.finditer(r"(?:R\.?\s?U\.?\s?C\.?|DNI)\s*(?:N[°ºo.]*)?\s*:?\s*(\d{11}|\d{8})\b", txt, re.I):
        if m.group(1) != propio:
            out["ruc"] = m.group(1)
            break
    m = re.search(r"DIRECCI[OÓ]N\s*(?:DEL\s+CLIENTE)?\s*:\s*(.+)", txt, re.I)
    if m and len(re.findall(r"[A-Za-z]", corta(m.group(1)))) >= 5 and not SIN_DIRECCION.match(corta(m.group(1))):
        out["direccion"] = corta(m.group(1))
    return out


def cliente_pdf(pag, fila):
    """Cliente según el PDF de la factura (fila de Comprobantes). {} si no se puede."""
    try:
        a = fila.locator("a", has_text=re.compile(r"^\s*PDF\s*$", re.I)).first
        h = a.get_attribute("href") if a.count() else ""
        if not h:
            return {}
        r = pag.context.request.get(h if h.startswith("http") else BASE + h)
        if not r.ok or r.body()[:4] != b"%PDF":
            return {}
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(r.body())
        txt = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True, timeout=30).stdout
        out = datos_pdf(txt, os.environ.get("RUC", ""))
        if len(r.body()) < 4_000_000:   # 📄 la factura misma, para verla desde la hoja (va al Drive del bot, nunca a GitHub)
            out["_pdf"] = base64.b64encode(r.body()).decode()
        return out
    except Exception:
        return {}


def leer_formulario(pag):
    """Lo que Quesito trajo de la factura al formulario de guía: cliente, productos y partida (solo lectura)."""
    d = pag.evaluate("""(F) => {
      const txt = n => { const e = document.querySelector(`[name="${F}[${n}]"]`); if (!e) return '';
        if (e.tagName === 'SELECT') { const o = e.options[e.selectedIndex]; return o && o.value ? o.text.trim() : ''; }
        return String(e.value || '').trim(); };
      return { cliente: txt('entity_id'), partida: { ubigeo: txt('partida_ubigeo'), direccion: txt('partida_direccion') } }; }""", F)
    d["lineas"] = [{"texto": re.sub(r"\s+", " ", l["texto"]).strip(), "cantidad": num(l["cantidad"])} for l in lineas(pag)]
    return d


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
    cot = re.sub(r"\D", "", str(c.get("cotizacion") or ""))
    if not m and not cot:
        fin(False, "Para Quesito la guía sale desde la factura: falta el número de la factura (ej. FQQ1-3648) o de la cotización. No se creó nada.")
        sys.exit(1)
    serie, numero = (m.group(1), m.group(2)) if m else ("", "")
    paso(f"Caso recibido · modo {modo} · " + (f"factura {serie}-{numero}" if m else f"cotización {cot}") + f" · {len(c.get('bienes') or [])} bien(es)")

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
            if not serie:   # solo la cotización: su factura relacionada
                serie, numero = factura_de_cotizacion(pag, cot)
                paso(f"La cotización {cot} es la factura {serie}-{numero}")
                pag.goto(BASE + "/invoices", wait_until="networkidle", timeout=60000)
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
            cli = cliente_pdf(pag, fila.first) if modo == "leer" else {}
            fila_txt = re.sub(r"\s+", " ", fila.first.inner_text())[:300] if modo == "leer" else ""
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
            if modo == "leer":   # 📥 solo leer lo que trae Quesito (cliente, productos, partida) para la hoja de Guías
                datos = leer_formulario(pag)
                pdf_fac = cli.pop("_pdf", "") if isinstance(cli, dict) else ""
                datos.update({"factura": f"{serie}-{numero}", "cotizacion": cot, "cliente_pdf": cli, "fila": fila_txt, "pdf": pdf_fac})
                r = bot({"accion": "gre_leido", "datos": datos})
                open(os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "gre_avisado"), "w").close()
                print(f"::notice title=Quesito leído::factura {serie}-{numero} · {len(datos.get('lineas') or [])} línea(s) · nada se creó" + ("" if r.get("ok") else " · el bot no lo recibió"))
                return
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
