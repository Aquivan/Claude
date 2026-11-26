#!/usr/bin/env python3
"""📥 Baja un archivo de más de 20 MB que le mandaron al bot de Telegram (proyecto Cobranzas: cobranzas/telegram/TG_Grandes.js).

La API de bots no deja bajar más de 20 MB; la otra vía de Telegram (MTProto, la de la app) sí, hasta 2 GB. El robot entra
COMO EL BOT (Telethon, con las claves TG_API_ID / TG_API_HASH de my.telegram.org guardadas como secretos de GitHub), lee
ese mensaje del chat, baja el archivo y lo sube a la carpeta temporal de importaciones de Drive. El repositorio es
público: el nombre, el chat y el mensaje NO van en las entradas ni en el registro; se le piden al bot con el «lote».
Los tokens se enmascaran y nunca se imprimen. Cualquier error se devuelve al bot, que le avisa a la persona.
"""
import asyncio
import json
import os
import sys
import tempfile
import time
import urllib.request



def bot(cuerpo):
    url = os.environ["BOT_URL"]
    cuerpo = dict(cuerpo, run=os.environ.get("GITHUB_RUN_ID", ""), lote=os.environ["LOTE"])
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "canal=gh", data=json.dumps(cuerpo).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode() or "{}")


def drive(token, metodo, url, datos=None, cabeceras=None):
    h = {"Authorization": "Bearer " + token}
    h.update(cabeceras or {})
    req = urllib.request.Request(url, data=datos, headers=h, method=metodo)
    with urllib.request.urlopen(req, timeout=900) as r:
        return r.read(), r.headers


def paginas_pdf(ruta):
    try:
        from pypdf import PdfReader
        return len(PdfReader(ruta).pages)
    except Exception:  # noqa: BLE001
        return 0


async def bajar(api_id, api_hash, token_bot, msg_id, destino):
    from telethon import TelegramClient   # aquí (no arriba): «Avisar si falló» corre aunque no se haya instalado
    from telethon.sessions import StringSession
    cli = TelegramClient(StringSession(), api_id, api_hash)
    await cli.start(bot_token=token_bot)
    try:
        # chat privado con el bot: el n° de mensaje de la API de bots es el mismo; sin «entity» basta el n°
        m = await cli.get_messages(None, ids=int(msg_id))
        if not m or not m.media:
            raise RuntimeError("no encontré el archivo en el mensaje de Telegram")
        ultimo = [0.0]

        def avance(hecho, total):
            if time.time() - ultimo[0] > 10:
                ultimo[0] = time.time()
                print("  bajando… %.0f de %.0f MB" % (hecho / 1048576, (total or 0) / 1048576))

        ruta = await cli.download_media(m, file=destino, progress_callback=avance)
        mime = getattr(getattr(m, "file", None), "mime_type", None) or "application/octet-stream"
        return ruta, mime
    finally:
        await cli.disconnect()


def main():
    t0 = time.time()
    try:
        api_id, api_hash = os.environ.get("TG_API_ID", "").strip(), os.environ.get("TG_API_HASH", "").strip()
        if not api_id or not api_hash:
            raise RuntimeError("faltan las claves de Telegram (secretos TG_API_ID y TG_API_HASH en GitHub)")
        print("::add-mask::" + api_hash)
        d = bot({"accion": "tgb_datos"})
        if not d.get("ok"):
            print("::error::El bot no dio los datos: " + str(d.get("error")))
            return 1
        for secreto in (d["bot"], d["drive"]):
            print("::add-mask::" + secreto)
        with tempfile.TemporaryDirectory() as tmp:
            ruta, mime = asyncio.run(bajar(int(api_id), api_hash, d["bot"], d["msg"], os.path.join(tmp, "archivo")))
            peso = os.path.getsize(ruta)
            print("Bajado: %.1f MB en %d s" % (peso / 1048576, time.time() - t0))
            pags = paginas_pdf(ruta) if "pdf" in mime.lower() else 0
            meta = json.dumps({"name": d["titulo"], "parents": [d["carpeta"]], "mimeType": mime}).encode()
            _, cab = drive(d["drive"], "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", meta,
                           {"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": str(peso)})
            with open(ruta, "rb") as fh:
                cuerpo, _ = drive(d["drive"], "PUT", cab["Location"], fh, {"Content-Type": mime, "Content-Length": str(peso)})   # sin cargarlo entero en memoria
            fid = json.loads(cuerpo.decode() or "{}").get("id")
            if not fid:
                raise RuntimeError("Drive no devolvió el archivo subido")
        print("Subido a Drive · %d pág · %d s" % (pags, time.time() - t0))
        bot({"accion": "tgb_fin", "ok": True, "id": fid, "paginas": pags, "seg": int(time.time() - t0)})
        return 0
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:300]
        print("::error::" + msg)
        try:
            bot({"accion": "tgb_fin", "ok": False, "error": msg})
        except Exception:  # noqa: BLE001
            pass
        return 1


def avisar_fallo(motivo):
    """Paso «Avisar si falló» del workflow: el bot le dice a la persona que lo mande por otro medio (si el lote sigue abierto)."""
    try:
        bot({"accion": "tgb_fin", "ok": False, "error": motivo[:200]})
    except Exception as e:  # noqa: BLE001
        print("::warning::No se pudo avisar al bot: " + str(e)[:150])
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--fallo":
        sys.exit(avisar_fallo(sys.argv[2]))
    sys.exit(main())
