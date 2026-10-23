"""
ruc_por_nombre.py — Busca el RUC por nombre o razón social en el Padrón Reducido del RUC de SUNAT.

El padrón (padron_reducido_ruc.zip, ~390 MB, ~18 millones de filas "RUC|NOMBRE|ESTADO|CONDICION|UBIGEO|…")
es una descarga pública y gratuita de SUNAT. Se lee directo del ZIP, fila por fila, sin guardarlo en el
repositorio. Para cada nombre buscado devuelve los mejores candidatos con su puntaje.

Cómo compara (pensado para nombres de vouchers, que vienen cortados o abreviados):
  - normaliza: mayúsculas, sin tildes, Ñ→N, & → Y, sin puntuación y sin la forma societaria
    (S.A.C., E.I.R.L., S.R.L., SOCIEDAD ANONIMA CERRADA…), que se guarda aparte para desempatar;
  - candidatos: filas que contienen las palabras "fuertes" del nombre buscado (no cuentan DE, LA,
    CORPORACION, INVERSIONES… porque aparecen en miles de nombres);
  - puntaje 0–100: palabras en común sin importar el orden (SUNAT escribe a las personas
    APELLIDOS NOMBRES), iniciales y palabras cortadas valen como prefijo ("JUAN C" ≈ "JUAN CARLOS"),
    y suma si coincide la forma societaria o si el RUC está ACTIVO/HABIDO.

Uso:
  python ruc_por_nombre.py --padron padron_reducido_ruc.zip --entrada nombres.json --salida resultados.json
  entrada: ["NOMBRE 1", "NOMBRE 2", …] o [{"q": "NOMBRE", "tipo": "empresa|persona|"}]
Los nombres buscados no se imprimen (pueden ser de personas).
"""
import argparse
import io
import json
import re
import sys
import time
import unicodedata
import zipfile

FORMAS = [
    ("EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA", "EIRL"), ("SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA", "SRL"),
    ("SOCIEDAD DE RESPONSABILIDAD LIMITADA", "SRL"), ("SOCIEDAD ANONIMA CERRADA", "SAC"), ("SOCIEDAD ANONIMA ABIERTA", "SAA"),
    ("SOCIEDAD ANONIMA", "SA"), ("E I R L", "EIRL"), ("S C R L", "SRL"), ("S R L", "SRL"), ("S A C", "SAC"), ("S A A", "SAA"),
    ("S A", "SA"), ("EIRL", "EIRL"), ("SCRL", "SRL"), ("SRL", "SRL"), ("SAC", "SAC"), ("SAA", "SAA"), ("SA", "SA"),
]
FORMAS_RX = [(re.compile(r"(?:^| )" + f + r"(?= |$)"), c) for f, c in FORMAS]
# Palabras que no sirven para elegir candidatos (salen en demasiados nombres). Sí cuentan en el puntaje.
DEBILES = set("""DE DEL LA LAS LOS EL Y E EN A AL POR PARA CON SAN SANTA
CORPORACION CORP INVERSIONES INVERSION GRUPO EMPRESA EMPRESAS NEGOCIACIONES NEGOCIOS SERVICIOS SERVICIO
COMERCIAL COMERCIALIZADORA DISTRIBUIDORA DISTRIBUCIONES INDUSTRIAS INDUSTRIAL CONSTRUCTORA CONTRATISTAS
TRANSPORTES TRANSPORTE IMPORTACIONES EXPORTACIONES IMPORT EXPORT GENERALES GENERAL PERU PERUANA DEL PERU
MULTISERVICIOS ASOCIACION COOPERATIVA AGRICOLA AGROINDUSTRIAL CIA COMPANIA HNOS HERMANOS SUCESION INDIVISA""".split())
ABREV = {"CORP": "CORPORACION", "CIA": "COMPANIA", "HNOS": "HERMANOS", "DIST": "DISTRIBUIDORA", "INV": "INVERSIONES",
         "SERV": "SERVICIOS", "COM": "COMERCIAL", "IND": "INDUSTRIAS", "IMP": "IMPORTACIONES", "EXP": "EXPORTACIONES"}


def normalizar(texto):
    """→ (palabras, forma societaria). "Corp. Granix E.I.R.L." → (['CORPORACION','GRANIX'], 'EIRL')."""
    t = unicodedata.normalize("NFD", str(texto or "").upper())
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    t = t.replace("&", " Y ")
    t = re.sub(r"[^A-Z0-9 ]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    forma = ""
    for rx, c in FORMAS_RX:
        if rx.search(t):
            forma = forma or c
            t = rx.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip()
    # letras sueltas seguidas ("B B V A") → una palabra ("BBVA"), salvo que sean iniciales de persona al final
    t = re.sub(r"\b(?:[A-Z] ){2,}[A-Z]\b", lambda m: m.group(0).replace(" ", ""), t)
    palabras = [ABREV.get(p, p) for p in t.split()]
    return palabras, forma


def puntaje(q, c):
    """Palabras de lo buscado (q) contra las del padrón (c), 0–100, sin importar el orden.
    Una palabra de q vale si está igual en c, si es el comienzo de una de c (cortada o inicial)
    o si difiere en una letra (error de lectura del voucher)."""
    if not q or not c:
        return 0
    usadas, total, peso_total = set(), 0.0, 0.0
    for w in q:
        peso = 0.35 if w in DEBILES else (0.6 if len(w) == 1 else 1.0)
        peso_total += peso
        mejor, cual = 0.0, None
        for j, x in enumerate(c):
            if j in usadas:
                continue
            if w == x:
                s = 1.0
            elif len(w) == 1:
                s = 0.9 if x.startswith(w) else 0.0
            elif x.startswith(w) and len(w) >= 3:
                s = 0.92
            elif len(w) >= 5 and abs(len(w) - len(x)) <= 1 and _una_letra(w, x):
                s = 0.85
            else:
                s = 0.0
            if s > mejor:
                mejor, cual = s, j
        if cual is not None:
            usadas.add(cual)
        total += mejor * peso
    cobertura = total / peso_total
    # palabras fuertes del padrón que no aparecen en lo buscado bajan un poco (otro titular más largo)
    sobran = sum(1 for j, x in enumerate(c) if j not in usadas and x not in DEBILES)
    return max(0.0, min(100.0, 100 * cobertura - 6 * sobran))


def _una_letra(a, b):
    if len(a) == len(b):
        return sum(1 for x, y in zip(a, b) if x != y) == 1
    if len(a) > len(b):
        a, b = b, a
    for i in range(len(b)):
        if b[:i] + b[i + 1:] == a:
            return True
    return False


def preparar(consultas):
    """Para cada consulta, sus palabras, forma y las palabras fuertes completas que eligen candidatos."""
    out = []
    for i, x in enumerate(consultas):
        q = x if isinstance(x, str) else x.get("q", "")
        tipo = "" if isinstance(x, str) else (x.get("tipo") or "")
        palabras, forma = normalizar(q)
        fuertes = [w for w in palabras if w not in DEBILES and len(w) >= 3]
        # la última palabra puede venir cortada: no se exige igual, solo cuenta en el puntaje
        exigidas = fuertes[:-1] if len(fuertes) >= 3 else fuertes
        if not exigidas and palabras:
            exigidas = [max(palabras, key=len)]
        n = len(set(exigidas))
        # puede faltar una palabra exigida (cortada o mal leída en el voucher): esas filas van aparte
        out.append({"i": i, "q": q, "tipo": tipo, "palabras": palabras, "forma": forma, "exigidas": set(exigidas),
                    "todas": n, "minimo": max(1, n - 1)})
    return out


def buscar(lector, consultas, max_cand=300, top=3):
    """lector: iterable de líneas (texto) del padrón. Devuelve [{q, candidatos:[…]}] en el orden pedido."""
    qs = preparar(consultas)
    indice = {}   # palabra exigida → [consultas que la piden]
    for c in qs:
        for w in c["exigidas"]:
            indice.setdefault(w, []).append(c)
    cand = {c["i"]: [] for c in qs}        # filas con todas las palabras exigidas
    parciales = {c["i"]: [] for c in qs}   # filas a las que les falta una
    filas = 0
    for linea in lector:
        filas += 1
        partes = linea.rstrip("\r\n").split("|")
        if len(partes) < 2 or not partes[0][:2].isdigit():
            continue
        crudo = partes[1]
        # filtro barato: con solo letras ASCII basta partir el texto; con tildes o Ñ se normaliza
        if any(ord(ch) > 127 for ch in crudo):
            palabras_fila = set(normalizar(crudo)[0])
        else:
            palabras_fila = set(re.split(r"[^A-Z0-9]+", crudo.upper()))
        tocadas = {}
        for w in palabras_fila:
            for c in indice.get(w, ()):
                tocadas[c["i"]] = tocadas.get(c["i"], 0) + 1
        if not tocadas:
            continue
        for i, n in tocadas.items():
            c = qs[i]
            if n < c["minimo"]:
                continue
            lista = cand[i] if n >= c["todas"] else parciales[i]
            if len(lista) < max_cand * 4:
                lista.append((partes[0], crudo, partes[2] if len(partes) > 2 else "", partes[3] if len(partes) > 3 else "",
                              partes[4] if len(partes) > 4 else ""))
    resultados = []
    for c in qs:
        puntuados = []
        for ruc, nombre, estado, condicion, ubigeo in cand[c["i"]] + parciales[c["i"]]:
            pal, forma = normalizar(nombre)
            s = puntaje(c["palabras"], pal)
            if c["forma"] and forma:
                s += 3 if c["forma"] == forma else -6
            if c["tipo"] == "empresa" and ruc.startswith("10"):
                s -= 8
            if c["tipo"] == "persona" and ruc.startswith("20"):
                s -= 8
            if estado.strip().upper() == "ACTIVO":
                s += 2
            if condicion.strip().upper() == "HABIDO":
                s += 1
            puntuados.append((round(min(s, 100), 1), ruc, nombre.strip(), estado.strip(), condicion.strip(), ubigeo.strip()))
        puntuados.sort(key=lambda x: (-x[0], x[1]))
        mejores = [dict(zip(("puntaje", "ruc", "nombre", "estado", "condicion", "ubigeo"), p)) for p in puntuados[:top] if p[0] >= 45]
        resultados.append({"q": c["q"], "candidatos": mejores, "revisados": len(cand[c["i"]]) + len(parciales[c["i"]])})
    return resultados, filas


def lineas_zip(ruta):
    """Líneas del TXT dentro del ZIP, sin descomprimir a disco. El padrón no es UTF-8 (Windows-1252)."""
    z = zipfile.ZipFile(ruta)
    nombre = next(n for n in z.namelist() if n.lower().endswith(".txt"))
    with z.open(nombre) as f:
        texto = io.TextIOWrapper(f, encoding="cp1252", errors="replace", newline="")
        cabecera = texto.readline()
        if "RUC" not in cabecera.upper():
            print("⚠️ La primera línea no parece cabecera; se lee igual.")
        print("Cabecera del padrón:", cabecera.strip()[:200])
        for linea in texto:
            yield linea


def _bot(cuerpo):
    """Habla con el bot de Cobranzas (?canal=gh). Apps Script responde con una redirección que se sigue con GET."""
    import os
    import urllib.request
    url = os.environ["BOT_URL"]
    cuerpo = dict(cuerpo, run=os.environ.get("GITHUB_RUN_ID", ""))
    req = urllib.request.Request(url + ("&" if "?" in url else "?") + "canal=gh", data=json.dumps(cuerpo).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode() or "{}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--padron", required=True)
    ap.add_argument("--entrada", help="JSON con los nombres (prueba local)")
    ap.add_argument("--salida", help="JSON de resultados (prueba local)")
    ap.add_argument("--lote", help="lote del bot de Cobranzas: pide los nombres y le devuelve los candidatos")
    a = ap.parse_args()
    if a.lote == "prueba":
        # Prueba del padrón real con razones sociales de empresas (no personas): muestra formato y resultados.
        consultas = ["CORP GRANIX EIRL", "PROCESOS ALIMENTARIOS M & D", "DSM CORPORACION", "BANCO DE CREDITO DEL PERU",
                     "DISTRIB FASUE", "SGC LOGISTIC GROUP", "SUPERINTENDENCIA NACIONAL DE ADUANAS"]
        t0 = time.time()
        res, filas = buscar(lineas_zip(a.padron), consultas)
        for x in res:
            print(" ·", x["q"], "→", "; ".join(f'{c["ruc"]} {c["nombre"]} ({c["puntaje"]})' for c in x["candidatos"]) or "sin candidato",
                  f'[revisó {x["revisados"]}]')
        print(f"Padrón: {filas:,} filas en {time.time() - t0:.0f} s.")
        return
    if a.lote:
        r = _bot({"accion": "rpn_pendientes", "lote": a.lote})
        if not r.get("ok"):
            sys.exit("El bot no entregó los nombres: " + str(r.get("error")))
        consultas = r.get("consultas") or []
        t0 = time.time()
        try:
            res, filas = buscar(lineas_zip(a.padron), consultas)
            error = ""
        except Exception as e:   # el padrón no bajó o vino roto: se avisa igual
            res, filas, error = [{"q": (c if isinstance(c, str) else c.get("q", "")), "candidatos": []} for c in consultas], 0, str(e)[:200]
        r2 = _bot({"accion": "rpn_resultados", "lote": a.lote, "resultados": res, "error": error})
        con = sum(1 for x in res if x["candidatos"])
        print(f"Padrón: {filas:,} filas en {time.time() - t0:.0f} s. Nombres: {len(res)}, con candidato: {con}. Bot: {r2.get('ok')}")
        if error:
            sys.exit("Error leyendo el padrón: " + error)
        return
    consultas = json.load(open(a.entrada, encoding="utf-8"))
    if not consultas:
        json.dump([], open(a.salida, "w"))
        print("Sin nombres para buscar.")
        return
    t0 = time.time()
    res, filas = buscar(lineas_zip(a.padron) if a.padron.endswith(".zip") else open(a.padron, encoding="cp1252", errors="replace"), consultas)
    json.dump(res, open(a.salida, "w", encoding="utf-8"), ensure_ascii=False)
    con = sum(1 for r in res if r["candidatos"])
    print(f"Padrón: {filas:,} filas leídas en {time.time() - t0:.0f} s. Nombres: {len(res)}, con candidato: {con}.")


if __name__ == "__main__":
    sys.exit(main())
