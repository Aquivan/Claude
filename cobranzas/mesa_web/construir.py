#!/usr/bin/env python3
"""
🧩 Mesa de conciliación fuera de Google (GitHub Pages, carpeta mesa/): la MISMA página (cobranzas/MesaVista.html)
sin el aviso de Apps Script. En vez de google.script.run llama a Cobranzas por POST (?canal=mesa → MESA_doPost_ de
Mesa.js), solo a las funciones MESA_* de la página, que igual exigen la llave temporal (?k=…, vale 6 horas).

Uso: python3 construir.py <ID de la aplicación web de Cobranzas> <carpeta de salida>   (lo corre «Desplegar Cobranzas»)
"""
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
VISTA = os.path.join(AQUI, "..", "MesaVista.html")
PLANTILLA = "var TK = '<?= TK ?>', MODO = '<?= MODO ?>', URLM = '<?= URL ?>';"

PUENTE = """<script>
/* 🧩 google.script.run → POST a Cobranzas (?canal=mesa), solo funciones MESA_* (cada una revisa la llave) */
(function () {
  var URLC = %s, URLG = %s;
  /* Si no hay conexión: reintenta 2 veces; si sigue, ofrece abrir la MISMA Mesa (misma llave) en la versión de Google. */
  function aviso() {
    if (document.getElementById('mesaRespaldo')) return;
    var k = new URLSearchParams(location.search).get('k') || '';
    var d = document.createElement('div'); d.id = 'mesaRespaldo';
    d.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:10px;padding:10px;font:14px Arial;box-shadow:0 4px 14px rgba(0,0,0,.2)';
    d.innerHTML = '⚠️ Este navegador no pudo conectarse con Cobranzas. <a style="font-weight:bold;color:#1D4ED8" href="' + URLG + '?mesa=' + encodeURIComponent(k) + '">Abrir la Mesa en la versión de Google</a> (mismo enlace) o toque 🔄 Recargar.';
    document.body.appendChild(d);
  }
  function llamar(f, args, ok, ko, intento) {
    intento = intento || 0;
    fetch(URLC, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ f: f, args: args }), redirect: 'follow', credentials: 'omit' })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var j; try { j = JSON.parse(txt); } catch (e) { throw new Error('respuesta rara de Cobranzas'); }
        if (j && j.ok) { if (ok) ok(j.r); } else if (ko) ko(new Error((j && j.error) || 'Error de la Mesa'));
      })
      .catch(function (e) {
        if (intento < 2) return setTimeout(function () { llamar(f, args, ok, ko, intento + 1); }, 1500 * (intento + 1));
        aviso();
        if (ko) ko(new Error('Sin conexión con Cobranzas: ' + (e && e.message || e)));
      });
  }
  function corredor(ok, ko) {
    return new Proxy({}, { get: function (t, p) {
      if (p === 'withSuccessHandler') return function (h) { return corredor(h, ko); };
      if (p === 'withFailureHandler') return function (h) { return corredor(ok, h); };
      return function () { llamar(p, Array.prototype.slice.call(arguments), ok, ko); };
    } });
  }
  window.google = { script: { run: corredor(null, null) } };
  window.MESA_WEB = true;
})();
</script>
"""


def main():
    if len(sys.argv) < 3 or not sys.argv[1].startswith("AKfy"):
        sys.exit("Uso: construir.py <ID de la aplicación web de Cobranzas> <carpeta de salida>")
    url = "https://script.google.com/macros/s/%s/exec?canal=mesa" % sys.argv[1]
    html = open(VISTA, encoding="utf-8").read()
    if PLANTILLA not in html:
        sys.exit("MesaVista.html cambió: no encontré la línea de la llave")
    if "<?" in html.replace(PLANTILLA, ""):
        sys.exit("MesaVista.html tiene otras marcas de plantilla de Apps Script: revise construir.py")
    html = html.replace(PLANTILLA, "var TK = new URLSearchParams(location.search).get('k') || '', MODO = 'web', URLM = location.href;")
    html = html.replace('<base target="_top">', "", 1)
    google = "https://script.google.com/macros/s/%s/exec" % sys.argv[1]
    html = html.replace("<head>", "<head>\n<title>🧩 Mesa de conciliación</title>\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" + PUENTE % (json.dumps(url), json.dumps(google)), 1)
    os.makedirs(sys.argv[2], exist_ok=True)
    with open(os.path.join(sys.argv[2], "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)
    print("Mesa armada (%d KB)." % (len(html) // 1024))


if __name__ == "__main__":
    main()
