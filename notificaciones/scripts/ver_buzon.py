"""
ver_buzon.py — Proyecto "Notificaciones · Grupo" (solo LECTURA).
Entra a SOL con un navegador Chrome real, pulsa "Buzón Electrónico" y anota en
el log las direcciones que la página usa para listar los mensajes (pedido y
respuesta), con fotos de cada pantalla. NO abre ningún mensaje ni adjunto.
Las claves llegan por variables de entorno y nunca se imprimen.
"""
import os
import sys

from playwright.sync_api import sync_playwright

CID = "4f3b88b3-d9d6-402a-b85d-6a0bc857746a"
SEC = f"https://api-seguridad.sunat.gob.pe/v1/clientessol/{CID}/oauth2"
ORIG = "https://e-menu.sunat.gob.pe/cl-ti-itmenu/AutenticaMenuInternet.htm"
STATE = ("rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAADdAADZXhlcHQABnBhcmFtc3QASyomKiYvY2wtdGktaXRtZW51L01lbnVJbnRlcm5ldC5odG0mYjY0ZDI2YThiNWFmMDkxOTIzYjIzYjY0MDdhMWMxZGI0MWU3MzNhNnQABGV4ZWNweA==")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
IGNORAR = ("/a/js/", "/a/css/", "/a/imagenes/", ".png", ".jpg", ".gif", ".css", ".woff", "monitor247", "gettime", "google")


def main():
    salida = sys.argv[1] if len(sys.argv) > 1 else "pantallas"
    ruc, usuario, clave = (os.environ.get(k, "") for k in ["SUNAT_RUC", "SUNAT_USUARIO", "SUNAT_CLAVE"])
    os.makedirs(salida, exist_ok=True)
    n = [0]
    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="es-PE", user_agent=UA,
                              record_video_dir=salida, record_video_size={"width": 1366, "height": 900})
        pag = ctx.new_page()

        def foto(nombre, pagina=None):
            n[0] += 1
            (pagina or pag).screenshot(path=os.path.join(salida, f"{n[0]:02d}_{nombre}.png"), full_page=True)

        def al_responder(r):
            u = r.url
            if any(x in u for x in IGNORAR) or "j_security_check" in u:
                return
            if r.request.resource_type in ("xhr", "fetch", "document") :
                cuerpo = ""
                try:
                    cuerpo = r.text()[:1500].replace("\n", " ")
                except Exception:
                    pass
                pd = r.request.post_data or ""
                print(f"\n>> {r.request.method} {u[:300]}")
                if pd and "clave" not in pd.lower() and "password" not in pd.lower():
                    print("   ENVIA:", pd[:500])
                print(f"<< HTTP {r.status} {r.headers.get('content-type','')}: {cuerpo}")
        ctx.on("response", al_responder)

        pag.goto(f"{SEC}/loginMenuSol?lang=es-PE&showDni=true&showLanguages=false&originalUrl={ORIG}&state={STATE}",
                 wait_until="networkidle", timeout=60000)
        pag.fill("#txtRuc", ruc)
        pag.fill("#txtUsuario", usuario)
        pag.fill("#txtContrasena", clave)
        print("=== ingresando ===")
        pag.click("#btnAceptar")
        pag.wait_for_load_state("networkidle", timeout=60000)
        pag.wait_for_timeout(4000)
        foto("menu")
        print("\n=== pulsando Buzón Electrónico ===")
        pag.click("#aOpcionBuzon")
        pag.wait_for_timeout(12000)
        foto("buzon")
        for fr in pag.frames:
            print("FRAME:", fr.url[:200])
        for i, fr in enumerate(pag.frames):
            try:
                txt = fr.evaluate("() => document.body ? document.body.innerText.slice(0, 2500) : ''")
                if txt.strip():
                    print(f"\n--- texto del frame {i} ({fr.url[:120]}):\n{txt}")
            except Exception:
                pass
        ctx.close()
        nav.close()
    print("Listo.")


if __name__ == "__main__":
    main()
