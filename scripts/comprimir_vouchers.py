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
import time
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
BLANCO_DELTA = 105  # ✂️ qué tan oscuro debe ser algo (gris) para contar como contenido; lo de color cuenta siempre (26/11: con 75 lo transparentado del reverso frenaba el recorte)


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


def recortar_blanco(img):
    """✂️ Opcional: recorta el papel en blanco alrededor de lo impreso / escrito / sellos / etiquetas (con margen).
    Lo que se transparenta del reverso (gris claro) NO cuenta como contenido; el filo del escáner tampoco."""
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    h, w = g.shape
    papel = float(np.percentile(g, 90))
    tinta = g < papel - BLANCO_DELTA                       # impreso / escrito oscuro (lo transparentado queda fuera)
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    tinta = tinta | ((hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 60))   # de COLOR: etiquetas, tinta azul, sellos
    tinta = tinta.astype(np.uint8) * 255
    b = int(0.015 * max(h, w))
    tinta[:b, :] = 0; tinta[-b:, :] = 0; tinta[:, :b] = 0; tinta[:, -b:] = 0
    tinta = cv2.morphologyEx(tinta, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))   # polvo
    tinta = cv2.dilate(tinta, np.ones((15, 15), np.uint8))
    n, _, st, _ = cv2.connectedComponentsWithStats(tinta)
    cajas = [st[i] for i in range(1, n) if st[i][4] > 0.0004 * h * w]
    if not cajas:
        return img, False
    x0 = min(c[0] for c in cajas); y0 = min(c[1] for c in cajas)
    x1 = max(c[0] + c[2] for c in cajas); y1 = max(c[1] + c[3] for c in cajas)
    m = max(25, int(0.04 * max(h, w)))
    x0, y0, x1, y1 = max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m)
    if (x1 - x0) * (y1 - y0) > 0.9 * w * h:   # casi no hay blanco que quitar
        return img, False
    return img[y0:y1, x0:x1], True


def a_jpg(img, cjpegli, calidad=CALIDAD):
    """JPG con Jpegli (o Pillow). img puede ser color (RGB) o gris (2D)."""
    pil = Image.fromarray(img)
    if cjpegli:
        with tempfile.TemporaryDirectory() as d:
            png, jpg = os.path.join(d, "p.png"), os.path.join(d, "p.jpg")
            pil.save(png)
            r = subprocess.run([cjpegli, png, jpg, "-q", str(calidad)], capture_output=True)
            if r.returncode == 0 and os.path.exists(jpg):
                return open(jpg, "rb").read()
    out = io.BytesIO()
    pil.save(out, "JPEG", quality=calidad - 5, optimize=True, progressive=True)
    return out.getvalue()


# ---------- 26/11/2026: grises con papel blanco, recorte por texto (RapidOCR) y copia buscable ----------
# Prueba con 30 páginas reales: «grises + papel blanco puro, calidad 72» se lee igual que el color (N° op, monto y fecha)
# y pesa ~45 % menos. Las páginas con COLOR (etiquetas, tinta azul) siguen en color.

def ocr_motor():
    """RapidOCR (mismos modelos PP-OCRv5 de PaddleOCR, más liviano). Si no está, None: se recorta como antes y sin copia buscable."""
    try:
        from rapidocr import RapidOCR
        return RapidOCR()
    except Exception as e:  # noqa: BLE001
        print("::warning::Sin RapidOCR (" + str(e)[:100] + "): recorte clásico y sin copia buscable")
        return None


def ocr(motor, img):
    """[(caja[4 puntos], texto)] de la página."""
    if motor is None:
        return []
    try:
        r = motor(img)
        if r.boxes is None:
            return []
        return [([(float(x), float(y)) for x, y in b], str(t)) for b, t in zip(r.boxes, r.txts or [])]
    except Exception as e:  # noqa: BLE001
        print("  OCR falló en una página: " + str(e)[:80])
        return []


def tiene_color(img):
    """¿La página tiene algo de color que valga la pena (etiqueta, tinta azul, sello)?"""
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    return float(((hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 60)).mean()) > 0.002


def papel_blanco(img):
    """Gris con el papel blanco puro: divide por el fondo (sombras, reverso transparentado) y lleva a blanco lo más claro."""
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    chico = cv2.resize(g, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    fondo = cv2.resize(cv2.medianBlur(cv2.dilate(chico, np.ones((7, 7), np.uint8)), 21), (g.shape[1], g.shape[0]), interpolation=cv2.INTER_LINEAR)
    n = np.clip(g.astype(np.float32) / np.maximum(fondo, 1) * 255, 0, 255)
    n = np.clip((n - 40) * 255 / (255 - 40), 0, 255)
    return np.clip(n * 255 / 215, 0, 255).astype(np.uint8)


def papel_blanco_color(img):
    """Como papel_blanco pero en color: cada canal se divide por su fondo (el papel queda blanco, la etiqueta conserva su color)."""
    out = np.empty_like(img)
    for k in range(3):
        g = img[:, :, k]
        chico = cv2.resize(g, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
        fondo = cv2.resize(cv2.medianBlur(cv2.dilate(chico, np.ones((7, 7), np.uint8)), 21), (g.shape[1], g.shape[0]), interpolation=cv2.INTER_LINEAR)
        n = np.clip(g.astype(np.float32) / np.maximum(fondo, 1) * 255, 0, 255)
        n = np.clip((n - 40) * 255 / (255 - 40), 0, 255)
        out[:, :, k] = np.clip(n * 255 / 215, 0, 255).astype(np.uint8)
    # las zonas de color (etiquetas, tinta azul, sellos) quedan tal cual
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    col = cv2.dilate(((hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 60)).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    out[col] = img[col]
    return out


def caja_contenido(img, lineas):
    """Caja de todo el texto que encontró el OCR + lo de color (etiquetas), con margen. None si no hay texto."""
    h, w = img.shape[:2]
    xs, ys = [], []
    for caja, _ in lineas:
        xs += [p[0] for p in caja]; ys += [p[1] for p in caja]
    if not xs:
        return None
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    col = ((hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 60)).astype(np.uint8)
    n, _, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(col, np.ones((9, 9), np.uint8)))
    for i in range(1, n):
        if st[i][4] > 0.002 * h * w:
            xs += [st[i][0], st[i][0] + st[i][2]]; ys += [st[i][1], st[i][1] + st[i][3]]
    m = max(20, int(0.025 * max(h, w)))
    x0, y0, x1, y1 = max(0, int(min(xs)) - m), max(0, int(min(ys)) - m), min(w, int(max(xs)) + m), min(h, int(max(ys)) + m)
    if (x1 - x0) * (y1 - y0) > 0.95 * w * h:
        return None
    return x0, y0, x1, y1


def preparar(img, cjpegli, motor, blanco):
    """Una página/foto ya recortada al papel → (jpg, ancho, alto, líneas OCR en esa imagen, recortó blancos?)."""
    h, w = img.shape[:2]
    f = LADO / float(max(h, w))
    if f < 1:
        img = cv2.resize(img, (int(w * f), int(h * f)), interpolation=cv2.INTER_AREA)
    lineas = ocr(motor, img)
    rb = False
    if blanco:
        c = caja_contenido(img, lineas) if lineas else None
        if c:
            x0, y0, x1, y1 = c
            img = img[y0:y1, x0:x1]
            lineas = [([(x - x0, y - y0) for x, y in caja], t) for caja, t in lineas]
            rb = True
        else:
            img, rb = recortar_blanco(img)   # sin texto detectado: el recorte de antes
            if rb:
                lineas = []   # las posiciones ya no calzan
    if tiene_color(img):
        jpg = a_jpg(papel_blanco_color(img), cjpegli, 75)   # etiquetas / tinta de color: en color, con el papel blanco
    else:
        jpg = a_jpg(papel_blanco(img), cjpegli, 72)      # el resto: gris con papel blanco
    return jpg, img.shape[1], img.shape[0], lineas, rb


def pdf_buscable(paginas):
    """PDF con las MISMAS imágenes + el texto invisible del OCR (para buscar con Ctrl+F). No lo lee la IA."""
    doc = fitz.open()
    for jpg, w, h, lineas in paginas:
        k = 72.0 / 150
        pg = doc.new_page(width=w * k, height=h * k)
        pg.insert_image(pg.rect, stream=jpg)
        for caja, t in lineas:
            if not t.strip():
                continue
            xs = [p[0] for p in caja]; ys = [p[1] for p in caja]
            alto = max(4.0, (max(ys) - min(ys)) * k)
            try:
                pg.insert_text((min(xs) * k, max(ys) * k - alto * 0.2), t, fontsize=alto * 0.8, render_mode=3)
            except Exception:  # noqa: BLE001
                pass
    return doc.tobytes(garbage=3, deflate=True)


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
        base = nombre.rsplit(".", 1)[0] if "." in nombre[-6:] else nombre
        es_foto = str(d.get("mime", "")).startswith("image/")
        recortadas, blancos, archivos = 0, 0, []
        blanco = bool(d.get("blanco"))   # ✂️ la persona pidió también recortar los blancos
        motor_ocr = ocr_motor()
        buscable = None
        if es_foto:   # 🗜 una foto: se recorta, se achica y queda como JPG
            img = cv2.imdecode(np.frombuffer(pdf, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                raise RuntimeError("no se pudo abrir la imagen")
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            img, rec = recortar(img)
            recortadas += 1 if rec else 0
            jpg, _, _, _, rb = preparar(img, cjpegli, motor_ocr, blanco)
            blancos += 1 if rb else 0
            archivos.append((nombre if nombre.lower().endswith((".jpg", ".jpeg")) else base + ".jpg", jpg, "image/jpeg"))
            npag = 1
        else:
            doc = fitz.open(stream=pdf, filetype="pdf")
            paginas, conocr, ultimo = [], [], time.time()
            for p in doc:
                if time.time() - ultimo > 15:   # ⏳ avance en vivo (la hoja se lo pasa a Telegram / WhatsApp)
                    ultimo = time.time()
                    try:
                        bot({"accion": "cmp_avance", "pag": len(paginas), "total": len(doc)})
                    except Exception:  # noqa: BLE001
                        pass
                esc = LADO / max(p.rect.width, p.rect.height) * 1.6   # un poco más grande y luego se achica (mejor calidad)
                pix = p.get_pixmap(matrix=fitz.Matrix(esc, esc), alpha=False)
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].copy()
                img, rec = recortar(img)
                recortadas += 1 if rec else 0
                jpg, w, h, lineas, rb = preparar(img, cjpegli, motor_ocr, blanco)
                blancos += 1 if rb else 0
                paginas.append(jpg)
                conocr.append((jpg, w, h, lineas))
            npag = len(paginas)
            # 🔎 copia buscable (aparte: la que lee la IA va solo con imágenes)
            if motor_ocr is not None and d.get("buscables"):
                try:
                    buscable = pdf_buscable(conocr)
                except Exception as eb:  # noqa: BLE001
                    print("::warning::No se pudo armar la copia buscable: " + str(eb)[:120])
            # partes de hasta ~38 MB
            partes, act, peso = [], [], 0
            for j in paginas:
                if act and peso + len(j) > MAX_PARTE:
                    partes.append(act); act, peso = [], 0
                act.append(j); peso += len(j)
            if act:
                partes.append(act)
            for i, imgs in enumerate(partes):
                nom = nombre if len(partes) == 1 else "%s (parte %d de %d).pdf" % (base, i + 1, len(partes))
                archivos.append((nom, img2pdf.convert(imgs, layout_fun=img2pdf.get_fixed_dpi_layout_fun((150, 150))), "application/pdf"))
        total = sum(len(b) for _, b, _ in archivos)
        print("Comprimido: %.1f MB → %.1f MB · %d pág · %d recortadas · %d sin blancos · %d parte(s) · %s" % (len(pdf) / 1048576, total / 1048576, npag, recortadas, blancos, len(archivos), motor))
        if len(archivos) == 1 and total >= len(pdf) * 0.9 and not blancos and not buscable:   # casi no baja (ya estaba liviano): queda el original
            print("No hacía falta: el original ya pesaba poco.")
            bot({"accion": "cmp_fin", "ok": True, "sinCambio": True})
            return 0
        # el original sale de Entrada y suben las partes
        r = bot({"accion": "cmp_mover"})
        if not r.get("ok"):
            raise RuntimeError("no se pudo mover el original: " + str(r.get("error")))
        for nom, b, tipo in archivos:
            meta = json.dumps({"name": nom, "parents": [entrada], "mimeType": tipo}).encode()
            _, cab = drive(token, "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", meta,
                           {"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": tipo, "X-Upload-Content-Length": str(len(b))})
            drive(token, "PUT", cab["Location"], b, {"Content-Type": tipo})
        if buscable:   # 🔎 copia buscable en «Procesados/🔎 Buscables» (no entra a la cola de lectura)
            try:
                meta = json.dumps({"name": base + " (buscable).pdf", "parents": [d["buscables"]], "mimeType": "application/pdf"}).encode()
                _, cab = drive(token, "POST", "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", meta,
                               {"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/pdf", "X-Upload-Content-Length": str(len(buscable))})
                drive(token, "PUT", cab["Location"], buscable, {"Content-Type": "application/pdf"})
                print("Copia buscable: %.1f MB" % (len(buscable) / 1048576))
            except Exception as eb:  # noqa: BLE001
                print("::warning::No se pudo subir la copia buscable: " + str(eb)[:120])
                buscable = None
        bot({"accion": "cmp_fin", "ok": True, "mb": round(total / 1048576, 1), "partes": len(archivos), "paginas": npag, "recortadas": recortadas, "blancos": blancos,
             "motor": motor + (" + RapidOCR" if motor_ocr is not None else ""), "buscable": bool(buscable)})
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
