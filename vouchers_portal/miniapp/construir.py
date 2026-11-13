#!/usr/bin/env python3
"""
🧾 Mini App de Telegram del Portal de Vouchers.

Arma la página que se publica en GitHub Pages (rama gh-pages, carpeta vouchers/): es la MISMA página del portal
(vouchers_portal/apps_script/PV_Vista.html) servida fuera de Google, así:
  - no aparece el aviso «Esta aplicación la ha creado un usuario de Google Apps Script»;
  - carga telegram-web-app.js: entra sin PIN (su Telegram queda vinculado la primera vez), lector de QR, pantalla completa;
  - en vez de google.script.run llama al portal por POST (doPost de PV_Usuarios.js), con las mismas funciones públicas.

Uso: python3 construir.py <ID de la aplicación web del portal> <carpeta de salida>
(el workflow «Desplegar Portal de Vouchers» la corre; el ID no se imprime).
"""
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
VISTA = os.path.join(AQUI, "..", "apps_script", "PV_Vista.html")

PUENTE = """<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script>
/* 🧾 Mini App: google.script.run → POST al portal (mismas funciones públicas: PV_entrar, PV_entrarTelegram, PV_api) */
window.PV_MINI = { url: %s };
(function () {
  function llamar(f, args, ok, ko) {
    fetch(window.PV_MINI.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ f: f, args: args }), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok) { if (ok) ok(j.r); } else if (ko) ko(new Error((j && j.error) || 'Error del portal')); })
      .catch(function (e) { if (ko) ko(new Error('Sin conexión con el portal: ' + (e && e.message || e))); });
  }
  function corredor(ok, ko) {
    return new Proxy({}, { get: function (t, p) {
      if (p === 'withSuccessHandler') return function (h) { return corredor(h, ko); };
      if (p === 'withFailureHandler') return function (h) { return corredor(ok, h); };
      return function () { llamar(p, Array.prototype.slice.call(arguments), ok, ko); };
    } });
  }
  window.google = { script: { run: corredor(null, null) } };
})();
</script>
"""


def main():
    if len(sys.argv) < 3 or not sys.argv[1].startswith("AKfy"):
        sys.exit("Uso: construir.py <ID de la aplicación web del portal> <carpeta de salida>")
    url = "https://script.google.com/macros/s/%s/exec" % sys.argv[1]
    html = open(VISTA, encoding="utf-8").read()
    if "<head>" not in html:
        sys.exit("PV_Vista.html no tiene <head>")
    html = html.replace("<base target=\"_top\">", "", 1)
    html = html.replace("<head>", "<head>\n<title>🧾 Vouchers</title>\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n" + PUENTE % json.dumps(url), 1)
    out = os.path.join(sys.argv[2], "vouchers")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)
    with open(os.path.join(sys.argv[2], "index.html"), "w", encoding="utf-8") as fh:
        fh.write("<!doctype html><meta charset=\"utf-8\"><title>Mini Apps</title><p>Abra la Mini App desde el bot de Telegram.</p>")
    open(os.path.join(sys.argv[2], ".nojekyll"), "w").close()
    print("Mini App armada (%d KB)." % (len(html) // 1024))


if __name__ == "__main__":
    main()
