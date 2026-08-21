"""
sire_client.py
Cliente de la API SIRE de SUNAT. Corre dentro de GitHub Actions (no Apps
Script) por velocidad y para mantener todo el proyecto en un solo lugar.

Contiene los mismos detalles reales descubiertos por depuracion contra
produccion que ya estaban documentados en la version de Apps Script:

  - El header Accept debe ser "*/*" al descargar el archivo binario; con
    "application/json" SUNAT responde 422 "El archivo solicitado no existe"
    aunque el archivo SI exista.
  - El manual vigente (v30, jun-2026) exige perTributario, codProceso y
    numTicket como parametros OBLIGATORIOS al descargar el archivo - el
    manual viejo (v22) solo documentaba 3 parametros y sin los otros 3
    SUNAT responde 200 con el archivo vacio (0 bytes).
  - Compras (RCE) usa un endpoint dedicado distinto al de Ventas (RVIE), y
    el codProceso real que funciona es 70, no 00/01/02 como dice el manual.
  - codOrigen debe ser "2", no "1" (el manual viejo lo tenia mal).
  - El estado "terminado" del ticket se detecta por texto en la
    descripcion, no por el codigo numerico documentado (que esta mal).

Manual de referencia (usar siempre la version vigente): https://cpe.sunat.gob.pe/node/158
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

TOKEN_URL = "https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/"
SIRE_BASE = "https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros"
COD_LIBRO_RVIE = "140000"
COD_LIBRO_RCE = "080000"


def autenticar(cfg):
    url = TOKEN_URL.format(client_id=cfg["client_id"])
    payload = urllib.parse.urlencode({
        "grant_type": "password",
        "scope": "https://api-sire.sunat.gob.pe",
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "username": cfg["ruc"] + cfg["usuario_sol"],
        "password": cfg["clave_sol"],
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST",
                                  headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"No se pudo autenticar contra SUNAT ({e.code}): {e.read()[:500]}")
    if "access_token" not in data:
        raise RuntimeError(f"Respuesta de autenticacion sin access_token: {data}")
    return data["access_token"]


def sire_get(url, params, token, accept="application/json", intentos429=4):
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url_completa = f"{url}?{qs}" if qs else url
    req = urllib.request.Request(url_completa, headers={
        "Content-Type": "application/json",
        "Accept": accept,
        "Authorization": f"Bearer {token}",
    })
    try:
        return urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        if e.code == 429 and intentos429 > 0:
            espera = 30 * (5 - intentos429)  # 30s, 60s, 90s, 120s
            time.sleep(espera)
            return sire_get(url, params, token, accept, intentos429 - 1)
        detalle = "Limite de peticiones de SUNAT alcanzado; reintenta en unos minutos." \
            if e.code == 429 else e.read()[:300]
        raise RuntimeError(f"Error SUNAT {e.code} en {url_completa}: {detalle}")


def solicitar_descarga_rvie(token, periodo, cod_tipo_archivo="0", cod_proceso="23"):
    url = f"{SIRE_BASE}/rvierce/gestionlibro/web/registroslibros/descarga"
    data = json.loads(sire_get(url, {
        "perTributario": periodo, "codOrigenEnvio": "2",
        "codTipoArchivo": cod_tipo_archivo, "codProceso": cod_proceso,
        "codLibro": COD_LIBRO_RVIE,
    }, token).read())
    return data["numTicket"]


def solicitar_descarga_rce(token, periodo, cod_tipo_archivo="0", cod_proceso="70", cod_moneda="PEN"):
    url = f"{SIRE_BASE}/rce/ajustesposteriores/web/ajustesposteriores/{periodo}/solicitardescarga"
    data = json.loads(sire_get(url, {
        "codTipoArchivo": cod_tipo_archivo, "codMoneda": cod_moneda,
        "codProceso": cod_proceso, "codOrigen": "2", "lisPeriodos": periodo,
    }, token).read())
    return data["numTicket"]


def solicitar_propuesta_rvie(token, periodo, cod_tipo_archivo="0"):
    url = f"{SIRE_BASE}/rvie/propuesta/web/propuesta/{periodo}/exportapropuesta"
    data = json.loads(sire_get(url, {"codTipoArchivo": cod_tipo_archivo}, token).read())
    return data["numTicket"]


def solicitar_propuesta_rce(token, periodo, cod_tipo_archivo="0"):
    url = f"{SIRE_BASE}/rce/propuesta/web/propuesta/{periodo}/exportacioncomprobantepropuesta"
    data = json.loads(sire_get(url, {"codTipoArchivo": cod_tipo_archivo, "codOrigenEnvio": "2"}, token).read())
    return data["numTicket"]


def consultar_periodos(token, cod_libro):
    url = f"{SIRE_BASE}/rvierce/padron/web/omisos/{cod_libro}/periodos"
    data = json.loads(sire_get(url, {}, token).read())
    estados = {}
    for ejercicio in data or []:
        for p in ejercicio.get("lisPeriodos", []):
            estados[p["perTributario"]] = p.get("desEstado", "")
    return estados


def periodo_presentado(token, periodo, cod_libro):
    estados = consultar_periodos(token, cod_libro)
    estado = estados.get(periodo, "").strip().lower()
    return estado.startswith("presentado")


def consultar_estado_ticket(token, num_ticket, periodo):
    url = f"{SIRE_BASE}/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets"
    data = json.loads(sire_get(url, {
        "perIni": periodo, "perFin": periodo, "page": 1, "perPage": 50, "numTicket": num_ticket,
    }, token).read())
    for r in data.get("registros", []):
        if r.get("numTicket") == num_ticket or r.get("detalleTicket", {}).get("numTicket") == num_ticket:
            return r
    return None


def esperar_ticket(token, num_ticket, periodo, intervalo_seg=8, max_intentos=40):
    for _ in range(max_intentos):
        registro = consultar_estado_ticket(token, num_ticket, periodo)
        if registro is None:
            time.sleep(intervalo_seg)
            continue
        detalle = registro.get("detalleTicket", {}) or {}
        desc = f"{detalle.get('desEstadoEnvio', '')} {registro.get('desEstadoProceso', '')}".lower()

        if "error" in desc:
            raise RuntimeError(f"SUNAT reporto error procesando el ticket {num_ticket}: {registro}")
        if "terminado" in desc:
            archivos = registro.get("archivoReporte") or detalle.get("archivoReporte") or []
            return [{
                "nombre": a["nomArchivoReporte"],
                "codTipoArchivo": a.get("codTipoAchivoReporte") or a.get("codTipoArchivoReporte"),
                "perTributario": registro.get("perTributario", periodo),
                "codProceso": registro.get("codProceso"),
                "numTicket": registro.get("numTicket", num_ticket),
            } for a in archivos if a.get("nomArchivoReporte")]
        time.sleep(intervalo_seg)
    raise RuntimeError(f"Timeout esperando el ticket {num_ticket} (sigue en proceso en SUNAT)")


def descargar_archivo(token, archivo, cod_libro, reintentos=3, espera_seg=8):
    url = f"{SIRE_BASE}/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte"
    params = {
        "nomArchivoReporte": archivo["nombre"],
        "codTipoArchivoReporte": archivo["codTipoArchivo"],
        "codLibro": cod_libro,
        "perTributario": archivo["perTributario"],
        "codProceso": archivo["codProceso"],
        "numTicket": archivo["numTicket"],
    }
    ultimo_error = None
    for _ in range(reintentos):
        try:
            resp = sire_get(url, params, token, accept="*/*")
            contenido = resp.read()
            if len(contenido) > 0:
                return contenido
            ultimo_error = RuntimeError("SUNAT devolvio el archivo vacio (0 bytes)")
        except Exception as e:
            ultimo_error = e
        time.sleep(espera_seg)
    raise RuntimeError(f"No se pudo descargar '{archivo['nombre']}' tras {reintentos} intentos. "
                        f"Ultimo error: {ultimo_error}")


def descargar_periodo(token, periodo, tipo, formato="txt"):
    """tipo: 'venta' | 'compra'. Devuelve lista de (nombre_limpio, bytes)."""
    cod_tipo_archivo = "1" if formato == "csv" else "0"
    cod_libro = COD_LIBRO_RVIE if tipo == "venta" else COD_LIBRO_RCE

    def pedir_propuesta():
        return (solicitar_propuesta_rvie(token, periodo, cod_tipo_archivo) if tipo == "venta"
                else solicitar_propuesta_rce(token, periodo, cod_tipo_archivo))

    def pedir_oficial():
        return (solicitar_descarga_rvie(token, periodo, cod_tipo_archivo) if tipo == "venta"
                else solicitar_descarga_rce(token, periodo, cod_tipo_archivo))

    def es_error_sin_comprobantes(e):
        # SUNAT devuelve varios codigos distintos para decir lo mismo: "este
        # RUC no tiene comprobantes de este tipo en este periodo" (nada raro,
        # pasa seguido a mitad de mes, con RUCs de poco movimiento, o con el
        # primer periodo de un rango largo que todavia no tenia operaciones).
        # NO es un error real, en ninguno de los 2 puntos donde puede salir
        # (al pedir la descarga/ticket, o al consultar su estado):
        #   - 1070 "No se ha encontrado informacion de comprobantes..."
        #   - 1815 "No existen documentos para exportar." (confirmado real:
        #     BKF 20609309793 y GRANIX 20447969531, periodo 202601, venta,
        #     corrida del 2026-08-21 -- tumbaba el job entero por esto).
        texto = str(e)
        return any(marca in texto for marca in (
            "1070", "No se ha encontrado",
            "1815", "No existen documentos para exportar",
        ))

    usar_oficial = periodo_presentado(token, periodo, cod_libro)
    # modo_efectivo: de donde salieron realmente los archivos devueltos (no
    # necesariamente igual a usar_oficial, por el fallback de abajo). None si
    # termino sin archivos (periodo vacio, no hay nada que rotular).
    modo_efectivo = "oficial" if usar_oficial else "propuesta"
    try:
        num_ticket = pedir_oficial() if usar_oficial else pedir_propuesta()
        archivos = esperar_ticket(token, num_ticket, periodo)
    except RuntimeError as e:
        if not es_error_sin_comprobantes(e):
            raise
        if usar_oficial:
            # SUNAT a veces marca el periodo como "presentado" en el padron
            # pero el libro oficial todavia no tiene comprobantes generados.
            # En ese caso se cae a la propuesta como respaldo, igual que si
            # no estuviera presentado, sin reemplazar el intento oficial
            # cuando este SI tiene datos.
            print(f"AVISO: periodo {periodo} figura como presentado pero la descarga "
                  f"oficial de {tipo} no tiene comprobantes; se usa la propuesta como respaldo.")
            modo_efectivo = "propuesta"
            try:
                num_ticket = pedir_propuesta()
                archivos = esperar_ticket(token, num_ticket, periodo)
            except RuntimeError as e2:
                if not es_error_sin_comprobantes(e2):
                    raise
                print(f"AVISO: {periodo}/{tipo} no tiene comprobantes ni en oficial ni en "
                      "propuesta -- se trata como periodo vacio (0 comprobantes), no como error.")
                archivos = []
                modo_efectivo = None
        else:
            # Ya se estaba pidiendo la propuesta directamente (periodo no
            # presentado) y SUNAT confirma que no hay comprobantes: periodo
            # vacio, no hay a que otro endpoint caer.
            print(f"AVISO: {periodo}/{tipo} no tiene comprobantes en la propuesta -- "
                  "se trata como periodo vacio (0 comprobantes), no como error.")
            archivos = []
            modo_efectivo = None

    resultado = []
    for archivo in archivos:
        contenido = descargar_archivo(token, archivo, cod_libro)
        nombre = archivo["nombre"].split("__")[-1] if "__" in archivo["nombre"] else archivo["nombre"]
        resultado.append((nombre, contenido))
    return resultado, modo_efectivo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ruc", required=True)
    ap.add_argument("--usuario-sol", required=True)
    ap.add_argument("--clave-sol", required=True)
    ap.add_argument("--client-id", required=True)
    ap.add_argument("--client-secret", required=True)
    ap.add_argument("--periodo", required=True, help="AAAAMM, ej. 202608")
    ap.add_argument("--tipo", choices=["venta", "compra"], required=True)
    ap.add_argument("--formato", choices=["txt", "csv"], default="txt")
    ap.add_argument("--out-dir", default="sire")
    args = ap.parse_args()

    import os
    os.makedirs(args.out_dir, exist_ok=True)

    print(f"Autenticando contra SUNAT (RUC {args.ruc})...")
    token = autenticar({
        "ruc": args.ruc, "usuario_sol": args.usuario_sol, "clave_sol": args.clave_sol,
        "client_id": args.client_id, "client_secret": args.client_secret,
    })
    print("Token OK. Solicitando descarga...")

    archivos, modo = descargar_periodo(token, args.periodo, args.tipo, args.formato)
    if not archivos:
        # SUNAT confirmo que no hay comprobantes de este tipo en este periodo
        # (0 comprobantes es un resultado valido, no un error) -- se sale sin
        # escribir ningun archivo y con exit 0, para que el resto del
        # pipeline lo trate como "periodo vacio" en vez de cortar todo el job.
        print(f"SUNAT confirma que no hay comprobantes de {args.tipo} en el periodo "
              f"{args.periodo}. No se escribe ningun archivo (periodo vacio, no es un error).")
        return

    for nombre, contenido in archivos:
        ruta = os.path.join(args.out_dir, nombre)
        with open(ruta, "wb") as f:
            f.write(contenido)
        print(f"OK: {ruta} ({len(contenido)} bytes)")

    # Linea de salida FIJA y facil de "grep-ear" desde el workflow (ver paso
    # "Guardar copia historica del periodo"), para saber sin ambiguedad si lo
    # que se acaba de descargar es la propuesta o el registro ya presentado.
    print(f"MODO_DESCARGA={modo}")


if __name__ == "__main__":
    main()
