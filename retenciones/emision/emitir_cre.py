"""
emitir_cre.py — EMITE un Comprobante de Retención Electrónico (CRE) en SUNAT SEE-SOL (menú 11.5.8.1.1).

Llena el comprobante igual que vista_cre.py (misma función preparar) y, solo si todo cuadra, toca "Emitir".
Seguros (si uno falla, NO se emite nada):
  1. CONFIRMAR debe ser la clave de ESTA solicitud: sha256("empresa|proveedor|total retención")[:10]. La calcula el
     bot cuando la persona aprueba ese comprobante (✅ Emitir → "Sí, emitir"); otra solicitud o un monto distinto
     no sirven.
  2. Cada documento debe traer su retención esperada y el total que calcula SUNAT debe ser exactamente ese.
  3. Si SUNAT ya tiene un comprobante de retención para una factura, se detiene (no duplica).
  4. Los avisos de SUNAT al agregar facturas se aceptan solo si están en "aceptar_avisos" (autorizados).

Al terminar escribe el número (E001-…) como anotación "CRE emitido" (el bot la lee) y en el resumen de la corrida.
Las claves llegan por variables de entorno y nunca se imprimen; no imprime montos ni nombres.
"""
import base64
import hashlib
import json
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

from vista_cre import JS_AVISO, UA, alto, claves_sol, leer_solicitud, num, preparar, simple, sin_datos


def clave_confirmacion(empresa, proveedor, total):
    return hashlib.sha256(f"{empresa}|{proveedor}|{total:.2f}".encode()).hexdigest()[:10]


# Ventana de SUNAT visible (cualquier modal abierto) con su texto y botones.
JS_VENTANA = """() => { const m = [...document.querySelectorAll('.modal.in, .modal[style*="display: block"], .bootbox')]
    .find(x => x.offsetParent !== null || getComputedStyle(x).display === 'block');
  if (!m) return null;
  const bs = [...m.querySelectorAll('button')].filter(b => b.offsetParent !== null)
    .map((b, i) => { b.dataset.robot = 'b' + i; return {sel: '[data-robot="b' + i + '"]', texto: b.innerText.trim()}; });
  return {texto: (m.querySelector('.modal-content') || m).innerText.replace(/\\s+/g, ' ').trim(), botones: bs}; }"""


def salida(nombre, valor):
    for var, linea in [("GITHUB_OUTPUT", f"{nombre}={valor}\n"), ("GITHUB_STEP_SUMMARY", f"- **{nombre}**: {valor}\n")]:
        if os.environ.get(var):
            with open(os.environ[var], "a", encoding="utf-8") as f:
                f.write(linea)


def bot(cuerpo):
    """Manda algo al bot de Cobranzas (?canal=gh). Sin BOT_URL no hace nada: la emisión no depende de esto."""
    url = os.environ.get("BOT_URL", "")
    if not url:
        return {"ok": False, "error": "sin BOT_URL"}
    cuerpo = dict(cuerpo, run=os.environ.get("GITHUB_RUN_ID", ""))
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "canal=gh", data=json.dumps(cuerpo).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode() or "{}")
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def bajar_pdf(pag):
    """PDF del comprobante recién emitido (botón PDF / Descargar / Imprimir en cualquier marco). Base64 o ''.
    Acepta descarga, pestaña nueva o la respuesta PDF misma. Nunca toca Emitir ni nada que cambie datos."""
    ctx = pag.context
    for f in pag.frames:   # avisos informativos primero
        try:
            b = f.locator(".modal button:visible, .bootbox button:visible", has_text=re.compile(r"^\s*(Aceptar|Entendido|Cerrar)\s*$"))
            if b.count():
                b.last.click(timeout=3000)
                pag.wait_for_timeout(800)
        except Exception:
            pass
    for rx in (r"^\s*(Descargar\s*)?PDF\s*$", r"\bPDF\b", r"Descargar(?!.*XML)", r"Imprimir"):
        for f in pag.frames:
            try:
                b = f.locator("button:visible, a:visible", has_text=re.compile(rx, re.I))
                if b.count():
                    b = b.first
                else:   # botones <input type=button value="PDF">
                    b = next((x for x in f.locator("input[type=button]:visible, input[type=submit]:visible").all()
                              if re.search(rx, x.get_attribute("value") or "", re.I)), None)
                    if b is None:
                        continue
            except Exception:
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
                b.click(timeout=5000)
            except Exception:
                continue
            for _ in range(40):   # hasta 20 s
                pag.wait_for_timeout(500)
                if capturado:
                    break
                if len(ctx.pages) > paginas:
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
            if capturado.get("dl"):
                with open(capturado["dl"], "rb") as fh:
                    capturado["pdf"] = fh.read()
            if capturado.get("pdf", b"")[:4] == b"%PDF":
                return base64.b64encode(capturado["pdf"]).decode()
    return ""


def main():
    ruc, usuario, clave = claves_sol()
    s, docs, avisos_ok = leer_solicitud(os.environ.get("SOLICITUD", "{}"))
    if any(d.get("retencion") in (None, "") for d in docs):
        alto("Para emitir, cada documento debe traer su retención esperada.")
    total = round(sum(num(d["retencion"]) for d in docs), 2)
    k = clave_confirmacion(ruc, s["proveedor_ruc"], total)
    if os.environ.get("CONFIRMAR", "") != k:
        alto("La clave de confirmación no corresponde a esta solicitud (empresa, proveedor y total).")
    print("Clave de confirmación: OK · documentos:", len(docs))

    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA)
        pag = ctx.new_page()
        pag.on("dialog", lambda d: (print("  Diálogo del navegador:", sin_datos(d.message)[:200]), d.accept()))
        vp, total_sunat = preparar(pag, s, docs, avisos_ok, ruc, usuario, clave)
        print("Vista preliminar abierta.")
        if abs(total_sunat - total) > 0.005:
            alto("El total de retención que calcula SUNAT no es el que se aprobó.")
        aviso = vp.evaluate(JS_AVISO)
        if aviso:
            alto(f"La vista preliminar muestra un aviso de SUNAT: {sin_datos(aviso)[:300]}")
        if not vp.query_selector("#btnEmitir"):
            alto("No encontré el botón Emitir en la vista preliminar.")

        # ===== EMITIR (aprobado por la persona con la clave de esta solicitud) =====
        print("Tocando Emitir…")
        vp.click("#btnEmitir")
        numero, ultimo = "", ""
        for _ in range(120):   # hasta 60 s
            pag.wait_for_timeout(500)
            for f in pag.frames:
                try:
                    v = f.evaluate(JS_VENTANA)
                except Exception:
                    v = None
                if v and v["texto"] and v["texto"] != ultimo:
                    ultimo = v["texto"]
                    t = simple(v["texto"])
                    m = re.search(r"\b([EF]\d{3})\s*-\s*(\d+)\b", v["texto"])
                    if m and re.search(r"emiti|generad|registrad|exito", t):
                        numero = f"{m.group(1)}-{m.group(2)}"
                        break
                    # La pregunta "¿Está seguro de emitir…?" es la misma emisión que la persona aprobó.
                    acepta = next((b for b in v["botones"] if simple(b["texto"]) in ("aceptar", "si", "emitir", "confirmar")), None)
                    if acepta and re.search(r"emiti|emision|seguro|confirm", t) and not re.search(r"exceden|mayor determinacion|error|no se pudo", t):
                        print(f"  SUNAT pide confirmar la emisión: «{sin_datos(v['texto'])[:160]}» → {acepta['texto']}")
                        f.click(acepta["sel"])
                        continue
                    if re.search(r"error|no se pudo|invalid|rechaz", t):
                        salida("resultado", "error")
                        alto(f"Al emitir, SUNAT respondió: {sin_datos(v['texto'])[:300]}")
            if numero:
                break
            for f in pag.frames:   # también puede mostrarlo en la página (no en una ventana)
                try:
                    t = f.inner_text("body")
                except Exception:
                    continue
                m = re.search(r"\b(E\d{3})\s*-\s*(\d+)\b", t or "")
                if m and re.search(r"emiti|generad|exito", simple(t)):
                    numero = f"{m.group(1)}-{m.group(2)}"
                    break
            if numero:
                break
        if not numero:
            print("::warning title=CRE sin confirmar::Se tocó Emitir pero no leí el número. Revise en SOL → Consultar emisión antes de reintentar.")
            salida("resultado", "sin confirmar")
            sys.exit(2)
        print(f"::notice title=CRE emitido::{numero}")
        print(f"✅ Comprobante de retención emitido: {numero}")
        salida("comprobante", numero)
        salida("resultado", "emitido")
        # 📄 El PDF va directo al bot (no se sube a GitHub: el repositorio es público). Si falla, el CRE igual quedó emitido.
        try:
            pdf = bajar_pdf(pag)
        except Exception as e:
            pdf = ""
            print("  No pude bajar el PDF:", str(e)[:150])
        if pdf:
            r = bot({"accion": "cre_pdf", "numero": numero, "pdf": pdf})
            print("PDF del comprobante enviado al bot." if r.get("ok") else f"::warning title=CRE sin PDF::No pude mandar el PDF al bot ({r.get('error', '')[:120]}).")
        else:
            print("::warning title=CRE sin PDF::No encontré el botón para bajar el PDF; llega con la próxima descarga de Retenciones.")


if __name__ == "__main__":
    main()
