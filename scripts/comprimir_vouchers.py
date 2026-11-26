#!/usr/bin/env python3
"""📦 Comprime (y parte si hace falta) un PDF de vouchers muy pesado (hoja Sistema de Vouchers: vouchers_bot_cambios/src/CompresionVouchers.js).

El repositorio es público: el nombre y el ID del archivo NO van en las entradas ni en el registro. Con el «lote» se le pide
a la hoja de Vouchers (canal=gh) el permiso temporal de Drive y el ID; se baja el PDF directo de Drive, y por cada página:
  1. se dibuja la página (con lo escrito y las etiquetas digitales) a buena resolución (PyMuPDF / MuPDF);
  2. se RECORTA el fondo que sobra alrededor del voucher (OpenCV: el papel es la zona clara más grande), con margen;
  3. se deja en ~1600 px del lado largo;
  4. se comprime como JPG con Jpegli (Google) si está, o Pillow;
y se arma el PDF con img2pdf (sin volver a comprimir). Si pasa de ~38 MB se parte. Se pide mover el original a
«📦 Originales grandes» y se suben las partes a la carpeta de Entrada con el mismo nombre (o «… (parte 1 de 2)»).
Cualquier error se devuelve a la hoja y el PDF sigue el proceso normal. El permiso no se imprime nunca.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

try:
    import cv2
    import fitz  # PyMuPDF
    import img2pdf
    import numpy as np
    from PIL import Image
except ImportError:
    if "--fallo" not in sys.argv:   # «Avisar si falló» corre aunque no se hayan instalado
        raise

LADO = 1600          # px del lado largo
CALIDAD = 80         # calidad JPG (Jpegli / Pillow)
MAX_PARTE = 38 * 1024 * 1024


def bot(cuerpo):
    """Llama a la hoja de Vouchers (doGet ?canal=gh). Solo responde a una corrida de este workflow que esté corriendo."""
    url = os.environ["BOT_URL"]
    q = dict(cuerpo, canal="gh", run=os.environ.get("GITHUB_RUN_ID", ""), lote=os.environ["LOTE"])
    q = {k: ("1" if v is True else "0" if v is False else str(v)) for k, v in q.items()}
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + urllib.parse.urlencode(q), method="GET")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode() or "{}")


def drive(token, metodo, url, datos=None, cabeceras=None):
    h = {"Authorization": "Bearer " + token}
    h.update(cabeceras or {})
    req = urllib.request.Request(url, data=datos, headers=h, method=metodo)
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read(), r.headers


def recortar(img):
    """Recorta el fondo alrededor del papel (zona clara más grande). Si no es claro, no recorta."""
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    g = cv2.GaussianBlur(g, (5, 5), 0)
    _, b = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b = cv2.morphologyEx(b, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    cs, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return img, False
    c = max(cs, key=cv2.contourArea)
    h, w = g.shape
    x, y, cw, ch = cv2.boundingRect(c)
    frac = (cw * ch) / float(w * h)
    if frac < 0.25 or frac > 0.92:   # no se encontró bien el papel, o ya casi no hay fondo
        return img, False
    m = int(0.03 * max(cw, ch))       # margen: que no se corte nada del borde (etiquetas, firmas)
    x0, y0, x1, y1 = max(0, x - m), max(0, y - m), min(w, x + cw + m), min(h, y + ch + m)
    return img[y0:y1, x0:x1], True


def a_jpg(img, cjpegli):
    pil = Image.fromarray(img)
    if cjpegli:
        with tempfile.TemporaryDirectory() as d:
            png, jpg = os.path.join(d, "p.png"), os.path.join(d, "p.jpg")
            pil.save(png)
            r = subprocess.run([cjpegli, png, jpg, "-q", str(CALIDAD)], capture_output=True)
            if r.returncode == 0 and os.path.exists(jpg):
                return open(jpg, "rb").read()
    out = io.BytesIO()
    pil.save(out, "JPEG", quality=CALIDAD - 5, optimize=True, progressive=True)
    return out.getvalue()


def main():
    cjpegli = shutil.which("cjpegli") or (os.path.exists("/tmp/jxl/tools/cjpegli") and "/tmp/jxl/tools/cjpegli") or ""
    motor = "Jpegli" if cjpegli else "Pillow"
    try:
        d = bot({"accion": "cmp_datos"})
        if not d.get("ok"):
            print("::error::El bot no dio los datos: " + str(d.get("error")))
            return 1
        token = d["token"]
        print("::add-mask::" + token)
        nombre, entrada = d["nombre"], d["entrada"]
        pdf, _ = drive(token, "GET", "https://www.googleapis.com/drive/v3/files/%s?alt=media&supportsAllDrives=true" % d["id"])
        print("Bajado: %.1f MB" % (len(pdf) / 1048576))
        doc = fitz.open(stream=pdf, filetype="pdf")
        paginas, recortadas = [], 0
        for p in doc:
            esc = LADO / max(p.rect.width, p.rect.height) * 1.6   # un poco más grande y luego se achica (mejor calidad)
            pix = p.get_pixmap(matrix=fitz.Matrix(esc, esc), alpha=False)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].copy()
            img, rec = recortar(img)
            recortadas += 1 if rec else 0
            h, w = img.shape[:2]
            f = LADO / float(max(h, w))
            if f < 1:
                img = cv2.resize(img, (int(w * f), int(h * f)), interpolation=cv2.INTER_AREA)
            paginas.append(a_jpg(img, cjpegli))
        # partes de hasta ~38 MB
        partes, act, peso = [], [], 0
        for j in paginas:
            if act and peso + len(j) > MAX_PARTE:
                partes.append(act); act, peso = [], 0
            act.append(j); peso += len(j)
        if act:
            partes.append(act)
        base = nombre[:-4] if nombre.lower().endswith(".pdf") else nombre
        archivos = []
        for i, imgs in enumerate(partes):
            nom = nombre if len(partes) == 1 else "%s (parte %d de %d).pdf" % (base, i + 1, len(partes))
            archivos.append((nom, img2pdf.convert(imgs, layout_fun=img2pdf.get_fixed_dpi_layout_fun((150, 150)))))
        total = sum(len(b) for _, b in archivos)
        print("Comprimido: %.1f MB → %.1f MB · %d pág · %d recortadas · %d parte(s) · %s" % (len(pdf) / 1048576, total / 1048576, len(paginas), recortadas, len(archivos), motor))
        # el original sale de Entrada y suben las partes
        r = bot({"accion": "cmp_mover"})
        if not r.get("ok"):
            raise RuntimeError("no se pudo mover el original: " + str(r.get("error")))
        for nom, b in archivos:
            meta = json.dumps({"name": nom, "parents": [entrada], "mimeType": "application/pdf"}).encode()
            _, cab = drive(token, "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", meta,
                           {"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/pdf", "X-Upload-Content-Length": str(len(b))})
            drive(token, "PUT", cab["Location"], b, {"Content-Type": "application/pdf"})
        bot({"accion": "cmp_fin", "ok": True, "mb": round(total / 1048576, 1), "partes": len(archivos), "paginas": len(paginas), "recortadas": recortadas, "motor": motor})
        return 0
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:300]
        print("::error::" + msg)
        try:
            bot({"accion": "cmp_fin", "ok": False, "error": msg})
        except Exception:  # noqa: BLE001
            pass
        return 1


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--fallo":
        try:
            bot({"accion": "cmp_fin", "ok": False, "error": sys.argv[2][:200]})
        except Exception as e:  # noqa: BLE001
            print("::warning::No se pudo avisar a la hoja: " + str(e)[:150])
        sys.exit(0)
    sys.exit(main())
