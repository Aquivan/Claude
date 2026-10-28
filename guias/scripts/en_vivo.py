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
