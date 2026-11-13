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
  var URLC = %s;
  function llamar(f, args, ok, ko) {
    fetch(URLC, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ f: f, args: args }), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { if (ok) ok(j.r); } else if (ko) ko(new Error((j && j.error) || 'Error de la Mesa')); })
      .catch(function (e) { if (ko) ko(new Error('Sin conexión con Cobranzas: ' + (e && e.message || e))); });
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
    html = html.replace("<head>", "<head>\n<title>🧩 Mesa de conciliación</title>\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" + PUENTE % json.dumps(url), 1)
    os.makedirs(sys.argv[2], exist_ok=True)
    with open(os.path.join(sys.argv[2], "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)
    print("Mesa armada (%d KB)." % (len(html) // 1024))


if __name__ == "__main__":
    main()
