"""📺 En vivo: mientras el robot trabaja, manda una foto de su navegador cada ~2–3 s al bot (Cobranzas), que la muestra
en una página que se actualiza sola (el enlace llega al chat o a la hoja de Guías). Solo si la persona lo activó
(«en vivo sí» en el bot o 📺 en la hoja): si está apagado, el bot contesta vivo=false y aquí solo se vuelve a preguntar
cada tanto. Las fotos NO van a los registros de GitHub (el repositorio es público): solo al bot, por HTTPS.

Toma las fotos por su cuenta (puerto de depuración de Chrome, en otro hilo) para no tocar lo que hace el robot."""
import base64
import json
import threading
import time
import urllib.request

PUERTO = 9333
_local = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def args():
    """Argumentos extra para chromium.launch(args=...)."""
    return [f"--remote-debugging-port={PUERTO}"]


def iniciar(bot, paso):
    """bot(cuerpo) → dict (el mismo que usa el robot); paso = lista con el paso actual en [0]."""
    try:
        from websockets.sync.client import connect   # noqa: F401
    except Exception:
        print("  (en vivo no disponible: falta websockets)", flush=True)
        return
    threading.Thread(target=_bucle, args=(bot, paso), daemon=True).start()


def _foto():
    from websockets.sync.client import connect
    lista = json.loads(_local.open(f"http://127.0.0.1:{PUERTO}/json/list", timeout=5).read().decode())
    pags = [t for t in lista if t.get("type") == "page" and str(t.get("url", "")).startswith("http")]
    if not pags:
        return ""
    with connect(pags[0]["webSocketDebuggerUrl"], max_size=None, open_timeout=5, close_timeout=2) as ws:
        ws.send(json.dumps({"id": 1, "method": "Page.captureScreenshot", "params": {"format": "jpeg", "quality": 45}}))
        fin = time.time() + 10
        while time.time() < fin:
            r = json.loads(ws.recv(timeout=10))
            if r.get("id") == 1:
                return (r.get("result") or {}).get("data", "")
    return ""


def _bucle(bot, paso):
    espera, encendido = 3, None
    while True:
        time.sleep(espera)
        try:
            img = _foto() if encendido is not False else ""
            r = bot({"accion": "gre_vivo", "img": img, "paso": str(paso[0] or "")[:200]}) or {}
            if r.get("vivo") is False:
                encendido, espera = False, 15   # apagado: se pregunta de nuevo cada 15 s (por si lo activan a mitad)
            elif r.get("ok"):
                if encendido is not True:
                    print("  📺 En vivo: enviando la pantalla al bot", flush=True)
                encendido, espera = True, 2.5
            else:
                espera = 6
        except Exception:
            espera = 6


# ============================================================ 🎥 Video en vivo (y se puede tocar) en GitHub
# Si la persona activó «en vivo», el robot de GitHub abre Chrome VISIBLE en una pantalla virtual (Xvfb) y la transmite con
# noVNC por un túnel temporal de Cloudflare (sin cuenta). El enlace (con su contraseña de un solo uso) va SOLO al bot:
# nunca se imprime en los registros de GitHub (el repositorio es público). Todo se apaga al terminar la corrida.

_PROCS = []


def _correr(cmd, salida=None):
    import subprocess
    p = subprocess.Popen(cmd, stdout=salida or subprocess.DEVNULL, stderr=subprocess.STDOUT if salida else subprocess.DEVNULL)
    _PROCS.append(p)
    return p


def video(bot, ancho=1366, alto=1000):
    """Prepara el video en vivo si el bot dice que está activo. True = hay pantalla (lanzar Chrome con headless=False)."""
    import os
    import platform
    import re
    import secrets
    import shutil
    import subprocess
    if platform.system() != "Linux" or os.environ.get("EN_PC") == "1":
        return False
    try:
        if not (bot({"accion": "gre_vivo_info"}) or {}).get("vivo"):
            return False
        print("  🎥 Video en vivo: preparando la pantalla…", flush=True)
        q = lambda *c: subprocess.run(list(c), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240)
        if not (shutil.which("x11vnc") and shutil.which("websockify") and shutil.which("xdotool") and os.path.isdir("/usr/share/novnc")):
            q("sudo", "apt-get", "update", "-qq")
            q("sudo", "apt-get", "install", "-y", "-qq", "xvfb", "x11vnc", "novnc", "websockify", "xdotool")
        cf = "/tmp/cloudflared"
        if not os.path.exists(cf):
            q("curl", "-fsSL", "-o", cf, "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64")
            os.chmod(cf, 0o755)
        if not (shutil.which("Xvfb") and shutil.which("x11vnc") and shutil.which("websockify") and os.path.exists(cf)):
            print("  🎥 Video en vivo no disponible (no se pudo instalar); sigo con fotos.", flush=True)
            return False
        import atexit
        atexit.register(apagar)
        os.environ["DISPLAY"] = ":99"
        _correr(["Xvfb", ":99", "-screen", "0", f"{ancho}x{alto}x24", "-nolisten", "tcp"])
        time.sleep(1.5)
        clave = secrets.token_urlsafe(6)[:8]   # VNC admite hasta 8 caracteres
        _correr(["x11vnc", "-display", ":99", "-rfbport", "5900", "-localhost", "-forever", "-shared", "-quiet", "-passwd", clave])
        _correr(["websockify", "--web", "/usr/share/novnc", "6080", "localhost:5900"])
        log = open("/tmp/cf.log", "w")   # la dirección del túnel queda aquí, no en el registro de GitHub
        _correr([cf, "tunnel", "--no-autoupdate", "--url", "http://localhost:6080"], salida=log)
        url = ""
        for _ in range(60):
            time.sleep(1)
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", open("/tmp/cf.log").read())
            if m:
                url = m.group(0)
                break
        if not url:
            print("  🎥 El túnel no respondió; sigo con fotos.", flush=True)
            return True   # la pantalla igual sirve (las fotos salen de ahí)
        enlace = f"{url}/vnc.html?autoconnect=1&resize=scale&reconnect=1&password={clave}"
        r = bot({"accion": "gre_vivo_vnc", "url": enlace}) or {}
        print("  🎥 Video en vivo listo (el enlace va solo al bot)." if r.get("ok") else "  🎥 El bot no recibió el video.", flush=True)
        return True
    except Exception as e:
        print("  🎥 Video en vivo no disponible (" + type(e).__name__ + "); sigo con fotos.", flush=True)
        return bool(_PROCS and _PROCS[0].poll() is None)   # hay pantalla si Xvfb sigue vivo


def args_video(ancho=1366, alto=1000):
    """Argumentos de Chrome para que ocupe toda la pantalla virtual."""
    return [f"--window-size={ancho},{alto}", "--window-position=0,0", "--start-maximized"]


def apagar():
    for p in _PROCS:
        try:
            p.terminate()
        except Exception:
            pass


def lanzar(p, pantalla, **kw):
    """chromium.launch con la pantalla virtual (le pasa DISPLAY: el proceso de Playwright arrancó antes de crearla).
    Si el Chrome visible no abre, se lanza normal (sin video): la guía nunca se detiene por esto."""
    import os
    a = args() + (args_video() if pantalla else [])
    if pantalla:
        try:   # visible y sin las marcas de «navegador automatizado» (para que una persona pueda iniciar sesión con captcha)
            return p.chromium.launch(headless=False, args=a + ["--disable-blink-features=AutomationControlled"], env=dict(os.environ),
                                     ignore_default_args=["--enable-automation"], **kw)
        except Exception as e:
            print("  🎥 Chrome visible no abrió (" + type(e).__name__ + "); sigo sin video.", flush=True)
    return p.chromium.launch(headless=True, args=a, **kw)


def zoom(veces=3):
    """Agranda la página en el Chrome visible (ctrl + «+»), para que en el celular se vea grande."""
    import shutil
    import subprocess
    if shutil.which("xdotool"):
        for _ in range(veces):
            subprocess.run(["xdotool", "key", "--clearmodifiers", "ctrl+plus"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            time.sleep(0.3)


def zoom_normal(pag=None):
    """Vuelve el Chrome visible al 100 % (si la persona agrandó con dos dedos en el video, la página queda «de celular»)."""
    import shutil
    import subprocess
    if shutil.which("xdotool"):
        for _ in range(2):
            subprocess.run(["xdotool", "key", "--clearmodifiers", "ctrl+0"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            time.sleep(0.4)
    if pag is not None:
        try:
            return pag.evaluate("() => [innerWidth, Math.round(devicePixelRatio * 100)]")
        except Exception:
            return None
