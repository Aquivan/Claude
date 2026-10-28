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


def pagos_con_retencion(fr):
    """Solo consulta: botón de SUNAT "Pagos realizados con comprobantes de retención" de la factura que se está
    agregando. Devuelve los comprobantes que SUNAT ya tiene para ella (p. ej. ["E001-85"]) y cierra la ventana."""
    if not fr.query_selector("#btnConsultaCobrosModal") or not fr.is_visible("#btnConsultaCobrosModal"):
        return []
    fr.click("#btnConsultaCobrosModal")
    try:
        fr.wait_for_selector("#divModalCobrosRealizados", state="visible", timeout=15000)
    except Exception:
        return []
    fr.wait_for_timeout(1500)
    texto = fr.eval_on_selector("#divModalCobrosRealizados", "e => e.innerText")
    cre = sorted(set(re.findall(r"\b[EeRrPp]\d{3}\s*-\s*\d+\b", texto or "")))
    if fr.query_selector("#btnCerrarCobrosRealizados"):
        fr.click("#btnCerrarCobrosRealizados")
    fr.wait_for_timeout(800)
    if not fr.is_visible("#txtSerieDoc"):   # al cerrar puede volver a la pantalla principal: reabrir no hace falta, avisar
        print("  (la ventana de la factura se cerró al cerrar la consulta)")
    return [c.replace(" ", "").upper() for c in cre]


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

    # 2) Formulario del comprobante de retención
    pag.goto(f"{MENU}?action=execute&code={CODIGO_FORMULARIO}", wait_until="networkidle", timeout=60000)
    fr = marco_con(pag, "#txtNumDoc")
    print("Formulario abierto:", fr.url.split("?")[0])
    fr.wait_for_timeout(1500)
    if s.get("fecha_emision") and s["fecha_emision"] != hoy:
        poner(fr, "#txtFecEmision", s["fecha_emision"])
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
        previos = pagos_con_retencion(fr)
        if previos:
            print(f"  Documento {i}: SUNAT ya registra pagos con comprobante de retención: {', '.join(previos)}")
            if not d.get("permitir_retencion_previa"):
                fallar(fr, f"Documento {i}: ya tiene comprobante(s) de retención ({', '.join(previos)}). "
                           "Revise si falta retener algo antes de seguir")
        if d.get("notas_credito"):
            agregar_notas_credito(fr, i, d["notas_credito"])
        poner(fr, "#txtFecPago", d["fecha_pago"])
        fr.wait_for_timeout(800)
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solicitud", default="", help="archivo JSON (si no, variable SOLICITUD)")
    a = ap.parse_args()
    ruc, usuario, clave = claves_sol()
    s, docs, avisos_ok = leer_solicitud(open(a.solicitud, encoding="utf-8").read() if a.solicitud else os.environ.get("SOLICITUD", "{}"))
    print("Documentos:", len(docs), "| notas de crédito:", sum(len(d.get("notas_credito") or []) for d in docs), "| solo VISTA PRELIMINAR (no emite)")

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA)
        pag = ctx.new_page()
        pag.on("dialog", lambda d: (print("  Diálogo del navegador:", sin_datos(d.message)[:200]), d.dismiss()))
        vp, total_ret = preparar(pag, s, docs, avisos_ok, ruc, usuario, clave)
        print("Vista preliminar abierta:", vp.url.split("?")[0])
        aviso = vp.evaluate(JS_AVISO)
        if aviso:
            print("Avisos de SUNAT:", sin_datos(aviso)[:400])
        print("Botones y campos de la vista preliminar (para el siguiente paso):\n  " + "\n  ".join(vp.evaluate(JS_ESTRUCTURA)))
        print("::notice title=CRE vista::Vista preliminar lista: SUNAT aceptó todo. No se emitió nada.")
        print("\n✅ Llegó a la vista preliminar. NO se emitió nada: este programa no tiene el paso de emitir.")


if __name__ == "__main__":
    main()
