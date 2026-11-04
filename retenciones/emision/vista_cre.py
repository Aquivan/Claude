"""
vista_cre.py — Prepara un Comprobante de Retención Electrónico (CRE) en SUNAT SEE-SOL (menú 11.5.8.1.1)
con un navegador real y se DETIENE en la "Vista preliminar". NO EMITE: este programa no tiene ningún paso
para emitir. Sirve para comprobar que el comprobante se llena bien antes de hacerlo de verdad.

Solicitud (JSON, en --solicitud o en la variable SOLICITUD):
  {"proveedor_ruc": "20537036312", "fecha_emision": "22/10/2026" (opcional: hoy), "observacion": "",
   "documentos": [{"tipo": "01", "serie": "F001", "numero": "4800",
                   "notas_credito": [{"serie": "FC01", "numero": "12"}]   (opcional: SUNAT trae su fecha e importe),
                   "fecha_pago": "02/10/2026", "importe_pago": 7119.00,
                   "retencion": 213.57 (opcional: se compara con lo que calcula SUNAT)}]}

Las claves llegan por variables de entorno (SUNAT_RUC, SUNAT_USUARIO, SUNAT_CLAVE) y nunca se imprimen.
El repositorio es público: en el registro no se imprimen montos, nombres ni RUC, solo OK/NO.
"""
import argparse
import json
import os
import re
import unicodedata
import sys
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
MENU = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm"
STATE = ("rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==")
CODIGO_FORMULARIO = "11.5.8.1.1"   # Comprobantes de retención → Emitir (aquí solo se llena y se ve la vista preliminar)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
LIMA = timezone(timedelta(hours=-5))

# Botones y campos visibles (sin valores) para el registro.
JS_ESTRUCTURA = """() => [...document.querySelectorAll('input,select,button,a.btn,textarea')]
  .filter(e => e.offsetParent !== null)
  .map(e => [e.tagName, e.type || '', e.id || '', e.name || '', (e.innerText || e.value || '').trim().slice(0, 40)].join(' | '))"""
# Solo el mensaje de SUNAT (ventana de aviso) y los errores de los campos marcados en rojo.
JS_AVISO = """() => {
  const vis = e => e && e.offsetParent !== null;
  const out = [];
  const m = document.querySelector('#idModalMensaje');
  if (m && m.classList.contains('in')) out.push((document.querySelector('#lblModalMensaje') || m).innerText.trim());
  document.querySelectorAll('.help-block, span.error, label.error').forEach(e => { if (vis(e) && e.innerText.trim()) out.push(e.innerText.trim()); });
  document.querySelectorAll('.has-error input, .has-error select').forEach(e => { if (vis(e)) out.push('campo en rojo: ' + (e.id || e.name)); });
  return out.join(' / '); }"""
# Ventana de SUNAT que pide confirmar (Sí/No): {texto, si} o null.
# Filas de una tabla de la pantalla (facturas del comprobante o notas de crédito).
JS_FILAS = """(t) => { try { return jQuery(t).DataTable().rows().count(); } catch (e) {
  return [...document.querySelectorAll(t + ' tbody tr')].filter(r => !r.querySelector('.dataTables_empty')).length; } }"""
JS_CONFIRMA = """() => { const m = document.querySelector('#idModalMensaje');
  if (!m || !m.classList.contains('in')) return null;
  const d = document.querySelector('#btnModalDer'), i = document.querySelector('#btnModalIzq');
  const caja = m.querySelector('.modal-content') || m;
  return {texto: caja.innerText.replace(/\\s+/g, ' ').trim(),
          der: d && d.offsetParent !== null ? d.innerText.trim() : '', izq: i && i.offsetParent !== null ? i.innerText.trim() : ''}; }"""


def simple(t):
    """Minúsculas, sin tildes y con un solo espacio (SUNAT a veces escribe las tildes con otra codificación)."""
    t = unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", t).strip().lower()


def sin_datos(t):
    return re.sub(r"\d", "#", t or "")


def num(v):
    return round(float(str(v).replace(",", "")), 2)


def poner(fr, selector, valor):
    """Escribe en un campo (también en los de fecha con calendario) y avisa a la página del cambio."""
    fr.evaluate("""([sel, val]) => { const e = document.querySelector(sel); e.disabled = false; e.readOnly = false;
        e.value = val; ['input', 'keyup', 'change', 'blur'].forEach(t => e.dispatchEvent(new Event(t, {bubbles: true})));
        if (window.jQuery) jQuery(e).trigger('change').trigger('keyup').trigger('blur'); }""", [selector, valor])


def valor(fr, selector):
    return fr.eval_on_selector(selector, "e => e.value") or ""


def esperar_valor(fr, selector, ms=20000):
    fr.wait_for_function("(s) => { const e = document.querySelector(s); return e && e.value && e.value.trim() !== ''; }",
                         arg=selector, timeout=ms)
    return valor(fr, selector)


def marco_con(pag, selector, ms=45000):
    """La aplicación puede abrirse dentro de un marco del menú SOL: busca el que tenga el selector."""
    fin = datetime.now().timestamp() + ms / 1000
    while datetime.now().timestamp() < fin:
        for fr in pag.frames:
            try:
                if fr.query_selector(selector):
                    return fr
            except Exception:
                pass
        pag.wait_for_timeout(500)
    raise RuntimeError(f"No apareció {selector} en la página de SUNAT")


def alto(texto):
    """Se detiene sin emitir y deja el motivo como anotación (el bot de Telegram/WhatsApp la lee y la cuenta)."""
    print(f"::error title=CRE no emitido::{texto.replace(chr(10), ' ')}")
    sys.exit(f"❌ {texto} · No se emitió nada.")


def fallar(fr, texto):
    aviso = ""
    try:
        aviso = fr.evaluate(JS_AVISO)
    except Exception:
        pass
    alto(texto + (f" · SUNAT dice: {sin_datos(aviso)[:300]}" if aviso else ""))


def pagos_con_retencion(fr, factura=""):
    """Solo consulta: botón de SUNAT "Pagos realizados con comprobantes de retención" de la factura que se está
    agregando. Devuelve los pagos que SUNAT ya tiene con comprobante: [{"cre": "E001-237", "fecha": "15/10/2026",
    "montos": [51546.39, 1546.39, 50000.0]}] (la factura misma no se cuenta como comprobante) y cierra la ventana."""
    if not fr.query_selector("#btnConsultaCobrosModal") or not fr.is_visible("#btnConsultaCobrosModal"):
        return []
    fr.click("#btnConsultaCobrosModal")
    try:
        fr.wait_for_selector("#divModalCobrosRealizados", state="visible", timeout=15000)
    except Exception:
        return []
    fr.wait_for_timeout(1500)
    filas = fr.eval_on_selector("#divModalCobrosRealizados", """e => [...e.querySelectorAll('tbody tr')]
        .filter(r => !r.querySelector('.dataTables_empty'))
        .map(r => [...r.querySelectorAll('td')].map(c => c.innerText.trim()))""") or []
    texto = fr.eval_on_selector("#divModalCobrosRealizados", "e => e.innerText") or ""
    if fr.query_selector("#btnCerrarCobrosRealizados"):
        fr.click("#btnCerrarCobrosRealizados")
    fr.wait_for_timeout(800)
    if not fr.is_visible("#txtSerieDoc"):   # al cerrar puede volver a la pantalla principal: reabrir no hace falta, avisar
        print("  (la ventana de la factura se cerró al cerrar la consulta)")
    fac = factura.replace(" ", "").upper()
    def es_cre(t):
        t = t.replace(" ", "").upper()
        try:
            return not (fac and t.split("-")[0] == fac.split("-")[0] and int(t.split("-")[1]) == int(fac.split("-")[1]))
        except Exception:
            return t != fac
    pagos = []
    for celdas in filas:
        unido = " | ".join(celdas)
        cres = [c.replace(" ", "").upper() for c in re.findall(r"\b[EeRrPp]\d{3}\s*-\s*\d+\b", unido) if es_cre(c)]
        if not cres:
            continue
        fecha = (re.findall(r"\b\d{2}/\d{2}/\d{4}\b", unido) or [""])[0]
        montos = [num(m) for m in re.findall(r"\b\d{1,3}(?:,\d{3})*\.\d{2}\b|\b\d+\.\d{2}\b", unido)]
        pagos.append({"cre": cres[0], "fecha": fecha, "montos": montos})
    if not pagos:   # tabla sin filas legibles: al menos los números de comprobante (sin la factura)
        for c in sorted(set(re.findall(r"\b[EeRrPp]\d{3}\s*-\s*\d+\b", texto))):
            if es_cre(c):
                pagos.append({"cre": c.replace(" ", "").upper(), "fecha": "", "montos": []})
    return pagos


JS_CORRELATIVO = """(n) => {   // «Número correlativo de pago»: la casilla junto a esa etiqueta
  const lab = [...document.querySelectorAll('label, td, span, div')].find(e => /correlativo\\s+de\\s+pago/i.test(e.innerText || '') && e.children.length < 3);
  let inp = lab && lab.htmlFor ? document.getElementById(lab.htmlFor) : null;
  if (!inp && lab) { const g = lab.closest('.form-group, tr, .row') || lab.parentElement; inp = g && g.querySelector('input:not([type=hidden])'); }
  if (!inp) return '';
  inp.disabled = false; inp.readOnly = false; inp.value = String(n);
  ['input', 'keyup', 'change', 'blur'].forEach(t => inp.dispatchEvent(new Event(t, {bubbles: true})));
  if (window.jQuery) jQuery(inp).trigger('change');
  return inp.id || inp.name || 'ok'; }"""


def agregar_notas_credito(fr, i, notas):
    """Dentro de la factura: '¿Tiene nota de crédito? Sí' → serie/número → Validar → Agregar → Cerrar."""
    fr.click("#optNotaCredSI")
    fr.wait_for_selector("#txtNumSerCpeRelNotaCred", state="visible", timeout=20000)
    for j, nc in enumerate(notas, 1):
        fr.select_option("#cmbTipoDocNotaCred", str(nc.get("tipo", "07")))
        fr.fill("#txtNumSerCpeRelNotaCred", str(nc["serie"]).upper())
        fr.fill("#txtNumCpeRelNotaCred", str(int(str(nc["numero"]))))
        fr.click("#btnValidarNotaCredito")
        try:
            esperar_valor(fr, "#txtImpTotNotaCred")
        except Exception:
            fallar(fr, f"Documento {i}, nota de crédito {j}: SUNAT no la encontró o no la acepta")
        antes = fr.evaluate(JS_FILAS, "#tblNotaCredito")
        fr.click("#btnAgregarNotaCredito")
        fr.wait_for_timeout(1500)
        if fr.evaluate(JS_FILAS, "#tblNotaCredito") <= antes:
            fallar(fr, f"Documento {i}, nota de crédito {j}: no se pudo agregar")
        print(f"  Nota de crédito {j}: validada por SUNAT y agregada")
    fr.click("#btnCerrarAddNotaCredito")
    fr.wait_for_selector("#txtImpCobro", state="visible", timeout=20000)
    fr.wait_for_timeout(800)


def leer_solicitud(texto):
    """Solicitud JSON → (dict, documentos, avisos autorizados). Sale con error si le falta algo."""
    s = json.loads(texto or "{}")
    docs = s.get("documentos") or []
    if not re.fullmatch(r"\d{11}", str(s.get("proveedor_ruc", ""))) or not docs:
        alto("La solicitud necesita proveedor_ruc (11 dígitos) y al menos un documento")
    # Avisos de SUNAT que el usuario autorizó aceptar en ESTA solicitud (texto que debe aparecer en el aviso).
    return s, docs, [simple(a) for a in (s.get("aceptar_avisos") or []) if simple(a)]


def claves_sol():
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    if not (ruc and usuario and clave):
        sys.exit("Faltan SUNAT_RUC / SUNAT_USUARIO / SUNAT_CLAVE")
    return ruc, usuario, clave


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


CODIGO_CONSULTA = "11.9.7.1.1"   # Comprobantes de retención → Consulta (solo lee)
BASE_CONSULTA = "https://ww1.sunat.gob.pe/ol-ti-itcpretencion/consulta"


def ultimo_emitido_sunat(pag):
    """Solo consulta: fecha (date) del último comprobante de retención emitido por la empresa en los últimos 60 días,
    leída de SUNAT en esta misma sesión. None si no se pudo (sigue con las fechas que mandó el bot)."""
    try:
        for intento in range(2):
            try:
                pag.goto(f"{MENU}?action=execute&code={CODIGO_CONSULTA}", wait_until="domcontentloaded", timeout=60000)
                break
            except Exception:
                pag.wait_for_timeout(2500)
        pag.wait_for_timeout(4000)
        hoy = datetime.now(LIMA)
        ini = (hoy - timedelta(days=60)).strftime("%d/%m/%Y")
        mejor = None
        for serie in ["", "E001"]:
            r = pag.context.request.post(f"{BASE_CONSULTA}/buscarComprobanteEmiRec", form={
                "opcionTipoCompReten": "emitido", "tipoDocReceptor": "000", "numDocReceptor": "", "serieCompReten": serie,
                "numeroCompReten": "", "fechaInicio": ini, "fechaFin": hoy.strftime("%d/%m/%Y"), "estadoCompReten": "000"},
                headers={"X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE_CONSULTA}/iniConsulComp",
                         "Accept": "application/json, text/javascript, */*; q=0.01"}, timeout=60000)
            try:
                d = r.json()
            except Exception:
                continue
            for cre in d.get("listaCompRetencion") or []:
                v = cre.get("fechaEmision")
                if isinstance(v, (int, float)):
                    f = datetime.fromtimestamp(v / 1000, LIMA).date()
                else:
                    try:
                        f = datetime.strptime(str(v)[:10], "%d/%m/%Y").date()
                    except Exception:
                        continue
                if not mejor or f > mejor:
                    mejor = f
            if d.get("listaCompRetencion"):
                break
        if mejor:
            print(f"Último comprobante emitido según SUNAT (consulta de hoy): {mejor.strftime('%d/%m/%Y')}")
            print(f"::notice title=Último CRE en SUNAT::{mejor.strftime('%d/%m/%Y')}")
        else:
            print("Consulta de emitidos en SUNAT: sin comprobantes en los últimos 60 días (o no respondió)")
        return mejor
    except Exception as e:
        print("Consulta de emitidos en SUNAT: no se pudo (" + type(e).__name__ + "); sigo con las fechas del bot")
        return None


class FechaFueraDeRango(Exception):
    """SUNAT: «La fecha de emisión debe estar en un rango de N días antes…» (aparece recién al agregar la factura)."""
    def __init__(self, antes):
        super().__init__(f"fecha fuera de rango ({antes} días antes)")
        self.antes = antes


def preparar_seguro(p, nav_args, s, docs, avisos_ok, ruc, usuario, clave, al_dialogo_fn, lanzar=None):
    """preparar() con su navegador; si SUNAT dice que la fecha de emisión está fuera de su rango (N días antes de hoy),
    se queda solo con las fechas permitidas, avisa al bot (para las próximas) y vuelve a empezar UNA vez.
    Devuelve (nav, pag, vp, total_ret)."""
    for intento in range(2):
        nav = lanzar() if lanzar else p.chromium.launch(args=nav_args)
        # Hora de PERÚ en el navegador (el servidor de GitHub está en UTC: de noche ya era «mañana» y el calendario
        # de SUNAT calculaba mal los días permitidos)
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA, timezone_id="America/Lima")
        pag = ctx.new_page()
        pag.on("dialog", al_dialogo_fn)
        if intento == 0:
            en_vivo_iniciar()
        try:
            vp, total_ret = preparar(pag, s, docs, avisos_ok, ruc, usuario, clave)
            return nav, pag, vp, total_ret
        except FechaFueraDeRango as e:
            hoy = datetime.now(LIMA).replace(hour=12, minute=0, second=0, microsecond=0)
            piso = hoy - timedelta(days=e.antes)
            antes = s.get("fechas_emision") or []
            validas = [f for f in antes if datetime.strptime(f, "%d/%m/%Y").replace(tzinfo=LIMA) >= piso.replace(hour=0)]
            print(f"SUNAT solo permite fechas de emisión desde {e.antes} día(s) antes de hoy: pruebo de nuevo con {validas[:1] or ['hoy']}")
            _bot_vivo({"accion": "cre_rango", "antes": e.antes})   # el bot lo recuerda para las próximas solicitudes
            s = dict(s, fechas_emision=validas or [hoy.strftime("%d/%m/%Y")])
            try:
                nav.close()
            except Exception:
                pass
            if intento == 1:
                alto("SUNAT no aceptó ninguna fecha de emisión permitida")
    alto("SUNAT no aceptó ninguna fecha de emisión permitida")


# Calendario de la página (cualquier tipo: bootstrap-datepicker, datetimepicker, jQuery UI…): busca el día por su
# atributo de fecha (data-day="29/10/2026", data-date=…) o, si no tiene, por el número dentro del mes que se ve.
JS_ELEGIR_DIA = r"""([d, m, y]) => {
  const vis = x => x && x.offsetParent !== null && x.getBoundingClientRect().width > 0;
  const pops = [...document.querySelectorAll('[class*="picker"], [class*="calendar"], [class*="datepicker"]')]
    .filter(x => vis(x) && x.tagName !== 'INPUT' && x.querySelector('td'));
  const pop = pops[pops.length - 1];
  const libs = window.jQuery ? Object.keys(jQuery.fn).filter(k => /picker|calend/i.test(k)) : [];
  if (!pop) return {r: 'sin calendario', libs: libs};
  const dd = String(d).padStart(2, '0'), mm = String(m).padStart(2, '0'), full = dd + '/' + mm + '/' + y;
  const ts = [Date.UTC(y, m - 1, d), new Date(y, m - 1, d).getTime()].map(String);
  const enc = (pop.querySelector('.picker-switch, .datepicker-switch, .ui-datepicker-title, thead th[colspan]') || {}).innerText || '';
  const info = {libs: libs, pop: pop.className.slice(0, 80), enc: enc.trim().slice(0, 40)};
  const bloqueada = c => /disabled|unselectable|inactive/i.test(c.className + ' ' + ((c.parentElement || {}).className || '')) || c.getAttribute('aria-disabled') === 'true';
  let c = [...pop.querySelectorAll('[data-day], [data-date], [data-value]')].find(x => vis(x) &&
      [x.getAttribute('data-day'), x.getAttribute('data-date'), x.getAttribute('data-value')].some(v => v === full || ts.includes(v)));
  if (!c) {   // sin atributo: por el número, solo días del mes que se está viendo (no los grises de otros meses)
    const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const meses2 = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const t = enc.toLowerCase();
    let mv = meses.findIndex(x => t.includes(x)); if (mv < 0) mv = meses2.findIndex(x => t.includes(x));
    const av = Number((t.match(/\d{4}/) || [0])[0]);
    if (mv >= 0 && av && (av * 12 + mv + 1) !== (y * 12 + m)) {
      const ir = (av * 12 + mv + 1) > (y * 12 + m) ? pop.querySelector('.prev, [data-action="previous"], .ui-datepicker-prev, th.prev')
                                                   : pop.querySelector('.next, [data-action="next"], .ui-datepicker-next, th.next');
      if (ir) { ir.click(); return Object.assign({r: 'mover'}, info); }
      return Object.assign({r: 'sin flecha'}, info);
    }
    c = [...pop.querySelectorAll('td, td a, td span, td button')].find(x => vis(x) && x.innerText.trim() === String(d) &&
      !/\bold\b|\bnew\b|other-month|othermonth/i.test(x.className + ' ' + ((x.parentElement || {}).className || '')));
  }
  if (!c) {   // para revisar: cómo son las celdas de días (sin datos de nadie)
    info.dia = [...pop.querySelectorAll('td')].filter(vis).slice(0, 4).map(x => x.className + ':' + x.innerText.trim() + ':' + (x.getAttribute('data-day') || '')).join(' ; ');
    return Object.assign({r: 'no encontré el día'}, info);
  }
  info.dia = c.tagName + '.' + c.className.slice(0, 40) + ' ' + ['data-day', 'data-date', 'data-value'].map(a => c.getAttribute(a) ? a + '=' + c.getAttribute(a) : '').join(' ');
  if (bloqueada(c)) return Object.assign({r: 'día bloqueado'}, info);
  c.click();
  return Object.assign({r: 'ok'}, info); }"""


# El calendario de SUNAT es «bootstrap-datetimepicker» (jQuery.fn.datetimepicker): se le pide la fecha por su propia
# función, que es lo mismo que hace al tocar el día (respeta la fecha mínima/máxima que SUNAT le puso).
JS_FECHA_API = r"""([sel, full]) => {
  const $ = window.jQuery; if (!$) return {r: 'sin jquery'};
  const inp = $(sel);
  const dp = inp.data('DateTimePicker') || inp.parent().data('DateTimePicker') || inp.closest('.input-group, .date').data('DateTimePicker');
  if (!dp) return {r: 'sin api'};
  const fmt = x => x && x.format ? x.format('DD/MM/YYYY') : (x === false || x == null ? '' : String(x));
  const info = {};
  try { info.min = fmt(dp.minDate()); info.max = fmt(dp.maxDate()); } catch (e) {}
  try { dp.date(window.moment ? moment(full, 'DD/MM/YYYY') : full); } catch (e) { return Object.assign({r: 'error ' + e.message}, info); }
  try { dp.hide(); } catch (e) {}
  inp.trigger('change'); inp.trigger('blur');
  return Object.assign({r: 'ok', val: inp.val()}, info); }"""


def a_fecha(t):
    try:
        d, m, y = [int(x) for x in t.split("/")]
        return datetime(y, m, d)
    except Exception:
        return None


RANGO_CAL = [("", "")]
FUERA_RANGO = [False]


def poner_fecha_calendario(fr, sel, f):
    """Pone la fecha como una persona: abre el calendario (📅 al lado de la casilla) y toca el día. Escribirla como texto
    hacía que SUNAT la borrara. Deja en el registro cómo es el calendario (sin datos de nadie) para revisar si falla."""
    d, m, y = [int(x) for x in f.split("/")]
    antes = valor(fr, sel)
    try:   # 1) por la función del calendario
        api = fr.evaluate(JS_FECHA_API, [sel, f]) or {}
        fr.wait_for_timeout(700)
        ahora = valor(fr, sel)
        print(f"    calendario {f} (función): {api.get('r')} · casilla {antes or '—'} → {ahora or '—'}"
              + (f" · SUNAT permite del {api.get('min') or '?'} al {api.get('max') or '?'}" if api.get('min') or api.get('max') else ""))
        RANGO_CAL[0] = (api.get("min") or "", api.get("max") or "")
        if ahora == f:
            return True
        mn, mx, fe = a_fecha(api.get("min") or ""), a_fecha(api.get("max") or ""), a_fecha(f)
        if fe and ((mn and fe < mn) or (mx and fe > mx)):
            FUERA_RANGO[0] = True
            return False   # el calendario de SUNAT no deja esa fecha: no hace falta tocar días
    except Exception as e:
        print(f"    calendario {f} (función): error {type(e).__name__}")
    try:   # cerrar un calendario que haya quedado abierto del intento anterior (si no, el clic lo cerraba en vez de abrirlo)
        fr.page.keyboard.press("Escape")
        fr.evaluate("() => { if (window.jQuery) try { jQuery('.datepicker, .bootstrap-datetimepicker-widget').hide(); } catch (e) {} if (document.activeElement) document.activeElement.blur(); }")
        fr.wait_for_timeout(300)
    except Exception:
        pass
    try:
        abre = None
        for q in [f"{sel} ~ .input-group-addon", f"{sel} ~ span.input-group-addon", f"{sel} ~ .input-group-btn button",
                  f"{sel} ~ span", f"{sel} + span", f"{sel} ~ button", f"{sel} ~ i"]:
            el = fr.query_selector(q)
            if el and el.is_visible():
                abre = el
                break
        (abre or fr.query_selector(sel)).click()
        res = {}
        for i in range(5):
            fr.wait_for_timeout(500)
            res = fr.evaluate(JS_ELEGIR_DIA, [d, m, y]) or {}
            if res.get("r") == "sin calendario" and i < 2:   # el 📅 no lo abrió: probar tocando la casilla
                try:
                    fr.click(sel, timeout=3000)
                except Exception:
                    fr.focus(sel)
                continue
            if res.get("r") != "mover":
                break
        fr.wait_for_timeout(700)
        ahora = valor(fr, sel)
        print(f"    calendario {f}: {res.get('r')} · casilla {antes or '—'} → {ahora or '—'} · "
              f"[{', '.join(res.get('libs') or [])}] {res.get('pop', '')} | {res.get('enc', '')} | {res.get('dia', '')}")
        if res.get("r") == "día bloqueado":
            FUERA_RANGO[0] = True
        if ahora != f:   # cerrar el calendario si quedó abierto
            try:
                fr.page.keyboard.press("Escape")
            except Exception:
                pass
        return ahora == f
    except Exception as e:
        print(f"    calendario {f}: error {type(e).__name__}")
        return False


def elegir_fecha(fr, s, hoy):
    """Fecha de emisión: prueba las fechas en orden (la del pago, la del último CRE de la empresa, luego desde 5 días
    atrás hasta hoy; las arma el bot en "fechas_emision") y se queda con la primera que SUNAT acepta.
    Si ninguna lo deja, se queda con hoy (lo que SUNAT pone solo)."""
    fechas = [f for f in (s.get("fechas_emision") or [s.get("fecha_emision") or hoy]) if f]
    no_pude = []   # fechas que el robot NO logró poner (no es que SUNAT las rechace): no se pasa a hoy sin avisar
    for f in fechas:
        if f == hoy:
            if no_pude:   # las anteriores no se pudieron poner (falla del robot, no de SUNAT): no pasar a hoy callado
                fallar(fr, f"No pude poner la fecha de emisión en el calendario de SUNAT ({', '.join(no_pude)}). "
                           "No uso la fecha de hoy sin su permiso; revise el registro del robot")
            poner(fr, "#txtFecEmision", hoy)
            print("Fecha de emisión:", f)
            print(f"::notice title=Fecha de emisión::{f}")
            FECHA_ELEGIDA[0] = f
            return f
        FUERA_RANGO[0] = False
        poner_fecha_calendario(fr, "#txtFecEmision", f)
        fr.wait_for_timeout(1500)
        aviso = ""
        try:
            aviso = fr.evaluate(JS_AVISO)
        except Exception:
            pass
        puesto = valor(fr, "#txtFecEmision")
        if puesto == f and not re.search(r"(?i)fecha", aviso or ""):
            print("Fecha de emisión:", f)
            print(f"::notice title=Fecha de emisión::{f}")
            FECHA_ELEGIDA[0] = f
            return f
        rechazo = FUERA_RANGO[0] or re.search(r"(?i)fecha|rango|d[ií]as", aviso or "")
        if not rechazo:
            no_pude.append(f)
        print(f"  {'SUNAT no aceptó' if rechazo else 'No pude poner'} la fecha {f}" + (f": {sin_datos(aviso)[:150]}" if aviso else ""))
        try:   # cerrar el aviso de SUNAT antes de probar la siguiente
            fr.click("#idModalMensaje button:visible", timeout=2000)
        except Exception:
            pass
    if no_pude:   # el robot falló al elegir la fecha: se detiene en vez de emitir con la de hoy
        fallar(fr, f"No pude poner la fecha de emisión en el calendario de SUNAT ({', '.join(no_pude)}). "
                   "No uso la fecha de hoy sin su permiso; revise el registro del robot")
    poner(fr, "#txtFecEmision", hoy)
    print("Fecha de emisión: hoy (ninguna de las anteriores fue aceptada)")
    print(f"::notice title=Fecha de emisión::{hoy} (SUNAT no aceptó las fechas anteriores)")
    FECHA_ELEGIDA[0] = hoy
    return hoy


def preparar(pag, s, docs, avisos_ok, ruc, usuario, clave):
    """Llena el comprobante en SEE-SOL y abre la Vista preliminar. NO emite.
    Devuelve (marco de la vista preliminar, total de retención que calculó SUNAT)."""
    hoy = datetime.now(LIMA).strftime("%d/%m/%Y")
    total_ret = 0.0
    # 1) Ingreso a SOL
    pag.goto(f"{SEC}/loginMenuSol?lang=es-PE&showDni=true&showLanguages=false&originalUrl={ORIG}&state={STATE}",
             wait_until="networkidle", timeout=60000)
    pag.fill("#txtRuc", ruc)
    pag.fill("#txtUsuario", usuario)
    pag.fill("#txtContrasena", clave)
    pag.click("#btnAceptar")
    pag.wait_for_load_state("networkidle", timeout=60000)
    pag.wait_for_timeout(2500)
    pasar_avisos_sol(pag)   # «datos de contacto», campañas: se pasan sin confirmar nada
    print("Ingreso a SOL: OK")

    # 1b) Último comprobante de retención EMITIDO según SUNAT (Consulta, ahora mismo; el Sheet puede estar atrasado):
    #     la fecha de emisión nunca puede ser anterior a esa (los comprobantes van en orden).
    ultimo = ultimo_emitido_sunat(pag)
    if ultimo:
        fechas = [f for f in (s.get("fechas_emision") or []) if datetime.strptime(f, "%d/%m/%Y").date() >= ultimo]
        s = dict(s, fechas_emision=fechas or [hoy])

    # 2) Formulario del comprobante de retención. SOL a veces muestra un aviso al salir del menú («¿salir de la
    #    página?») que cortaba la carga (ERR_ABORTED): se acepta ese aviso y se reintenta.
    fr = None
    for intento in range(3):
        try:
            pag.goto(f"{MENU}?action=execute&code={CODIGO_FORMULARIO}", wait_until="domcontentloaded", timeout=60000)
            fr = marco_con(pag, "#txtNumDoc", 40000)
            break
        except Exception as e:
            print(f"  Abrir el formulario: intento {intento + 1} sin éxito ({type(e).__name__})")
            pag.wait_for_timeout(3000)
            pasar_avisos_sol(pag)
    if fr is None:
        alto("SUNAT no abrió el formulario de comprobantes de retención (3 intentos)")
    print("Formulario abierto:", fr.url.split("?")[0])
    fr.wait_for_timeout(1500)
    elegir_fecha(fr, s, hoy)
    fr.select_option("#cmbRegiPercep", "01")   # Tasa 3%
    if s.get("observacion"):
        fr.fill("#txtObs", s["observacion"][:250])

    # 3) Proveedor
    fr.fill("#txtNumDoc", str(s["proveedor_ruc"]))
    fr.click("#btnValidar")
    try:
        esperar_valor(fr, "#txtRazonSocial")
    except Exception:
        fallar(fr, "SUNAT no validó el RUC del proveedor")
    print("Proveedor validado por SUNAT: OK")

    # 4) Cada factura pagada (con sus notas de crédito)
    for i, d in enumerate(docs, 1):
        fr.click("#btnAnadir")
        try:
            fr.wait_for_selector("#txtSerieDoc", state="visible", timeout=20000)
        except Exception:
            fallar(fr, "No se abrió el cuadro para agregar la factura (¿la empresa es agente de retención a esa fecha?)")
        fr.select_option("#cmbTipoDocPerp", str(d.get("tipo", "01")))
        fr.fill("#txtSerieDoc", str(d["serie"]).upper())
        fr.fill("#txtNumDocDlg", str(int(str(d["numero"]))))
        fr.click("#btnValidarDlg")
        try:
            esperar_valor(fr, "#txtImpTot")
        except Exception:
            fallar(fr, f"Documento {i}: SUNAT no lo encontró o no lo acepta")
        factura = f'{str(d["serie"]).upper()}-{int(str(d["numero"]))}'
        previos = pagos_con_retencion(fr, factura)
        correlativo = 1
        if previos:
            lista = ", ".join(p["cre"] + (f" ({p['fecha']})" if p["fecha"] else "") for p in previos)
            print(f"  Documento {i}: SUNAT ya registra {len(previos)} pago(s) con comprobante de retención: {lista}")
            # PAGOS PARCIALES: cada pago lleva su propio comprobante. Solo se detiene si ESTE pago ya tiene el suyo
            # (mismo monto de pago, de neto pagado o de retención) o si la suma de pagos pasaría el total de la factura.
            pago = num(d["importe_pago"])
            ret_esp = num(d["retencion"]) if d.get("retencion") not in (None, "") else round(pago * 0.03, 2)
            neto_esp = round(pago - ret_esp, 2)
            ya = [p for p in previos if any(abs(m - x) <= 0.05 for m in p["montos"] for x in (pago, neto_esp))
                  and any(abs(m - ret_esp) <= 0.05 for m in p["montos"])]
            if ya:
                fallar(fr, f"Documento {i}: este pago ya tiene su comprobante de retención ({ya[0]['cre']}"
                           f"{' del ' + ya[0]['fecha'] if ya[0]['fecha'] else ''}). No se emite otro")
            if any(not p["montos"] for p in previos):
                fallar(fr, f"Documento {i}: ya tiene comprobante(s) de retención ({lista}) y no pude leer sus montos "
                           "para saber si este pago es otro. Revíselo en SOL antes de seguir")
            total_fac = num(valor(fr, "#txtImpTot") or 0)
            # importe de cada pago anterior: el mayor monto de su fila que no sea el total de la factura
            pagado_antes = sum(max([m for m in p["montos"] if not total_fac or abs(m - total_fac) > 0.05] or [0])
                               for p in previos)
            if total_fac and pagado_antes + pago > total_fac + 0.05:
                fallar(fr, f"Documento {i}: con este pago se pasaría el total de la factura (ya pagado con retención "
                           f"S/ {pagado_antes:,.2f} + este S/ {pago:,.2f} > total S/ {total_fac:,.2f}). Revíselo en SOL")
            correlativo = len(previos) + 1
            print(f"  Documento {i}: pago parcial N° {correlativo} (los anteriores ya tienen comprobante) ✅")
        if d.get("notas_credito"):
            agregar_notas_credito(fr, i, d["notas_credito"])
        poner(fr, "#txtFecPago", d["fecha_pago"])
        fr.wait_for_timeout(800)
        if correlativo > 1:   # «Número correlativo de pago»: 2, 3… para los pagos parciales
            campo = fr.evaluate(JS_CORRELATIVO, correlativo)
            if not campo:
                fallar(fr, f"Documento {i}: no encontré la casilla «Número correlativo de pago» para poner el pago N° {correlativo}")
            fr.wait_for_timeout(600)
            print(f"  Número correlativo de pago: {correlativo}")
        poner(fr, "#txtImpCobro", f'{num(d["importe_pago"]):.2f}')
        fr.wait_for_timeout(1200)
        ret = num(valor(fr, "#txtImpPerc") or 0)
        neto = num(valor(fr, "#txtMontoTotal") or 0)
        tc = num(valor(fr, "#txtTipCamb") or 1)
        esperado = num(d["retencion"]) if d.get("retencion") not in (None, "") else None
        ok = esperado is None or abs(ret - esperado) < 0.015
        cuadra = abs(neto + ret - num(d["importe_pago"]) * tc) < 0.02
        print(f"Documento {i}: validado por SUNAT · retención {'= a la esperada ✅' if ok else '≠ a la esperada ❌'}"
              f" · pago − retención = neto {'✅' if cuadra else '❌'}")
        if not ok or not cuadra:
            fallar(fr, f"Documento {i}: los montos no cuadran")
        total_ret += ret   # lo que calculó SUNAT (emitir lo compara con lo aprobado antes de tocar Emitir)
        antes = fr.evaluate(JS_FILAS, "#tblDocuRela")
        fr.click("#btnModalAddDocu")
        agregado = False
        for _ in range(40):   # hasta 20 s: SUNAT consulta los pagos anteriores de la factura
            fr.wait_for_timeout(500)
            c = fr.evaluate(JS_CONFIRMA)
            if c and c["texto"]:   # la ventana se abre vacía y SUNAT pone el texto después
                # Si SUNAT pregunta algo, el robot NO contesta por usted: se detiene y muestra la pregunta.
                # Solo acepta los avisos que el usuario autorizó por escrito en la solicitud ("aceptar_avisos").
                permitido = next((a for a in avisos_ok if a in simple(c["texto"])), None)
                boton = "#btnModalIzq" if simple(c["izq"]) == "aceptar" else "#btnModalDer" if simple(c["der"]) == "aceptar" else ""
                if permitido and not boton:   # por si el botón no es btnModalIzq/Der: el que diga "Aceptar" en esa ventana
                    boton = fr.evaluate("""() => { const b = [...document.querySelectorAll('#idModalMensaje button')]
                        .find(x => x.offsetParent !== null && x.innerText.trim().toLowerCase() === 'aceptar');
                        if (!b) return ''; b.id = b.id || 'btnAceptarAvisoSunat'; return '#' + b.id; }""")
                rango = re.search(r"(?i)rango de\s*(\d+)\s*d\S*as antes", c["texto"])
                if rango:   # la fecha de emisión elegida está fuera de lo que SUNAT permite: se vuelve a empezar con otra
                    try:
                        fr.click("#btnModalIzq:visible, #btnModalDer:visible", timeout=2000)
                    except Exception:
                        pass
                    raise FechaFueraDeRango(int(rango.group(1)))
                if not permitido or not boton:
                    fallar(fr, f"Documento {i}: SUNAT pregunta «{sin_datos(c['texto'])[:300]}». El robot no responde por usted")
                print(f"  SUNAT avisa «{sin_datos(c['texto'])[:200]}» → Aceptar (autorizado por el usuario: «{permitido}»; solo agrega la factura a la lista)")
                fr.click(boton)
                fr.wait_for_timeout(800)
                continue
            if fr.evaluate(JS_FILAS, "#tblDocuRela") > antes:
                agregado = True
                break
        if not agregado:
            c = fr.evaluate(JS_CONFIRMA)
            fallar(fr, f"Documento {i}: no se pudo agregar (cuadro abierto: {'sí' if fr.is_visible('#txtSerieDoc') else 'no'}"
                       + (f"; ventana de SUNAT abierta, botones [{c['izq']}] [{c['der']}]" if c else "") + ")")
    print("Documentos en el comprobante:", fr.evaluate(JS_FILAS, "#tblDocuRela"), "de", len(docs))

    # 5) Vista preliminar (aquí se detiene: este programa no emite)
    fr.click("#btnVistPrel")
    pag.wait_for_load_state("networkidle", timeout=60000)
    pag.wait_for_timeout(2500)
    vp = marco_con(pag, "body", 30000)
    for f in pag.frames:
        if "VistaPreliminar" in f.url or f.query_selector("button, input[type=button]"):
            vp = f
    return vp, round(total_ret, 2)


def al_dialogo(d):
    """Avisos del navegador: el de «salir de la página» se ACEPTA (si no, la navegación se corta); los demás se cierran."""
    print("  Diálogo del navegador:", d.type, sin_datos(d.message)[:200])
    try:
        d.accept() if d.type == "beforeunload" else d.dismiss()
    except Exception:
        pass


# 📺 En vivo (opcional): con el modo activo en el bot, fotos de la pantalla cada ~3 s al bot (no a GitHub).
def _bot_vivo(cuerpo):
    import urllib.request
    url = os.environ.get("BOT_URL", "")
    if not url or not os.environ.get("CASO_VIVO"):
        return {"ok": False}
    acc = str(cuerpo.get("accion", "gre_vivo")).replace("gre_vivo", "cre_vivo")   # 📺 fotos / 🎥 video / rango de fechas
    c = dict(cuerpo, accion=acc, caso=os.environ["CASO_VIVO"], run=os.environ.get("GITHUB_RUN_ID", ""))
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "canal=gh", data=json.dumps(c).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except Exception:
        return {"ok": False}


def en_vivo_args():
    if not os.environ.get("CASO_VIVO"):
        return []
    try:
        import en_vivo
        return en_vivo.args()
    except Exception:
        return []


FECHA_ELEGIDA = [""]


def mandar_foto(pag, texto):
    """🖼 Foto de la pantalla (la vista preliminar) directo al chat por el bot. Nunca va al registro de GitHub."""
    try:
        import base64
        img = base64.b64encode(pag.screenshot(type="jpeg", quality=70, full_page=True)).decode()
        r = _bot_vivo({"accion": "cre_foto", "img": img, "texto": texto})
        print("  🖼 Foto de la vista preliminar enviada al chat." if r.get("ok") else "  🖼 No pude mandar la foto al chat.")
    except Exception as e:
        print("  🖼 Foto no enviada (" + type(e).__name__ + ")")


def en_vivo_lanzador(p):
    """🎥 Si «en vivo» está activo: Chrome VISIBLE en una pantalla virtual que se ve como video (se puede mirar en vivo,
    no solo fotos). Si no se puede, el de siempre. Devuelve la función que abre el navegador, o None."""
    if not os.environ.get("CASO_VIVO") or not os.environ.get("BOT_URL"):
        return None
    try:
        import en_vivo
        pantalla = en_vivo.video(_bot_vivo)
        if pantalla:
            os.environ["VIDEO_ACTIVO"] = "1"
        return lambda: en_vivo.lanzar(p, pantalla)
    except Exception as e:
        print("  (video en vivo no disponible:", type(e).__name__, ")")
        return None


def en_vivo_iniciar():
    if not os.environ.get("CASO_VIVO") or not os.environ.get("BOT_URL"):
        return
    try:
        import en_vivo
        en_vivo.iniciar(_bot_vivo, ["CRE"])
    except Exception as e:
        print("  (en vivo no disponible:", type(e).__name__, ")")


def main():
    sys.stdout.reconfigure(line_buffering=True)   # el registro con la hora real de cada paso
    ap = argparse.ArgumentParser()
    ap.add_argument("--solicitud", default="", help="archivo JSON (si no, variable SOLICITUD)")
    a = ap.parse_args()
    ruc, usuario, clave = claves_sol()
    s, docs, avisos_ok = leer_solicitud(open(a.solicitud, encoding="utf-8").read() if a.solicitud else os.environ.get("SOLICITUD", "{}"))
    print("Documentos:", len(docs), "| notas de crédito:", sum(len(d.get("notas_credito") or []) for d in docs), "| solo VISTA PRELIMINAR (no emite)")

    with sync_playwright() as p:
        nav, pag, vp, total_ret = preparar_seguro(p, en_vivo_args(), s, docs, avisos_ok, ruc, usuario, clave, al_dialogo,
                                                  lanzar=en_vivo_lanzador(p))
        print("Vista preliminar abierta:", vp.url.split("?")[0])
        aviso = vp.evaluate(JS_AVISO)
        if aviso:
            print("Avisos de SUNAT:", sin_datos(aviso)[:400])
        print("Botones y campos de la vista preliminar (para el siguiente paso):\n  " + "\n  ".join(vp.evaluate(JS_ESTRUCTURA)))
        print("::notice title=CRE vista::Vista preliminar lista: SUNAT aceptó todo. No se emitió nada.")
        print("\n✅ Llegó a la vista preliminar. NO se emitió nada: este programa no tiene el paso de emitir.")
        mandar_foto(pag, "👁 Vista preliminar de SUNAT (NO se emitió nada)" +
                    (f" · fecha de emisión {FECHA_ELEGIDA[0]}" if FECHA_ELEGIDA[0] else "") +
                    ". Si está bien, toque ✅ Emitir en el mensaje del comprobante.")
        if os.environ.get("VIDEO_ACTIVO"):   # 🎥 el video sigue 3 minutos más para que alcance a mirarlo
            print("  🎥 Dejo la vista preliminar en el video 3 minutos.")
            pag.wait_for_timeout(180000)


if __name__ == "__main__":
    main()
