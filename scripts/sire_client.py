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
import http.client
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URL = "https://api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/"
SIRE_BASE = "https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros"
COD_LIBRO_RVIE = "140000"
COD_LIBRO_RCE = "080000"
DEFAULT_TIMEOUT = 25  # Segundos por peticion para evitar cuelgues prolongados de socket

# Como se comporta SUNAT (medido en las corridas del 2026-11-05):
#   - Un pedido (ticket) sano termina en SEGUNDOS. Uno "atascado" puede quedar
#     "en proceso" 20+ minutos y no se destraba esperando; un pedido NUEVO
#     para la misma empresa sale en segundos (DSM: ticket ...747 atascado
#     20 min, el ...748 listo al instante).
#   - A veces el archivo de un ticket terminado da HTTP 500 una y otra vez.
# Por eso: espera CORTA por ticket y, si no sale, se pide otro (hasta
# MAX_PEDIDOS). Peor caso ~10 min por libro, no 45.
ESPERA_TICKET_SEG = 120          # tope de espera por ticket (despues queda PENDIENTE: no se gasta GitHub esperando)
ESPERAS_DESCARGA_SEG = (10, 30)  # reintentos del archivo de un ticket terminado
MAX_PEDIDOS = 2                  # solo si el archivo de un ticket terminado no se entrega


class SunatNoEntrega(RuntimeError):
    """Ticket atascado (atascado=True) o archivo que SUNAT no entrega (atascado=False)."""
    def __init__(self, texto, atascado=False, ticket=""):
        super().__init__(texto)
        self.atascado = atascado
        self.ticket = ticket


class SunatPendiente(RuntimeError):
    """SUNAT no entrego todavia: NO es un error nuestro ni de los datos. Se sale con el codigo
    PENDIENTE (75) y el workflow lo anota como «⏳ pendiente en SUNAT»; la hoja lo vuelve a pedir
    mas tarde y SUNAT entrega el MISMO pedido (si sigue en curso responde 42209 con su numero)."""
    def __init__(self, texto, ticket=""):
        super().__init__(texto)
        self.ticket = ticket


EXIT_PENDIENTE = 75


def autenticar(cfg, reintentos=4):
    url = TOKEN_URL.format(client_id=cfg["client_id"])
    payload = urllib.parse.urlencode({
        "grant_type": "password",
        "scope": "https://api-sire.sunat.gob.pe",
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "username": cfg["ruc"] + cfg["usuario_sol"],
        "password": cfg["clave_sol"],
    }).encode("utf-8")

    ultimo_error = None
    for intento in range(1, reintentos + 1):
        req = urllib.request.Request(
            url, data=payload, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        try:
            with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if "access_token" not in data:
                raise RuntimeError(f"Respuesta de autenticacion sin access_token: {data}")
            return data["access_token"]
        except urllib.error.HTTPError as e:
            if e.code in (400, 401):
                # Error de credenciales no recuperable con reintentos
                raise RuntimeError(f"Credenciales SUNAT rechazadas ({e.code}): {e.read()[:500]}")
            ultimo_error = f"HTTP {e.code}: {e.read()[:200]}"
        except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionResetError, http.client.RemoteDisconnected) as e:
            ultimo_error = f"Error de red / Timeout ({e})"
        except Exception as e:
            ultimo_error = str(e)

        if intento < reintentos:
            espera = intento * 3  # 3s, 6s, 9s (reintento rapido e inteligente sin largas esperas)
            print(f"AVISO: Fallo conexion con servidor de autenticacion SUNAT ({ultimo_error}). "
                  f"Reintentando en {espera}s (intento {intento + 1}/{reintentos})...")
            time.sleep(espera)

    raise RuntimeError(f"No se pudo autenticar contra SUNAT tras {reintentos} intentos. Ultimo error: {ultimo_error}")


def sire_get(url, params, token, accept="application/json", intentos=4):
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url_completa = f"{url}?{qs}" if qs else url
    req = urllib.request.Request(url_completa, headers={
        "Content-Type": "application/json",
        "Accept": accept,
        "Authorization": f"Bearer {token}",
    })

    ultimo_error = None
    for intento in range(1, intentos + 1):
        try:
            return urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                espera = 10 * intento  # 10s, 20s, 30s
                print(f"AVISO: Limite 429 alcanzado en SUNAT. Esperando {espera}s (intento {intento}/{intentos})...")
                time.sleep(espera)
                continue
            elif e.code in (500, 502, 503, 504):
                try:
                    cuerpo = e.read()[:300].decode("utf-8", "replace").strip()
                except Exception:
                    cuerpo = ""
                if cuerpo.lower().startswith("<"):
                    t = re.search(r"<title>(.*?)</title>", cuerpo, re.S | re.I)
                    cuerpo = f"pagina de error del servidor ({t.group(1).strip() if t else 'html'})"
                ultimo_error = f"HTTP {e.code} de SUNAT" + (f": {cuerpo}" if cuerpo else " (sin detalle)")
                espera = intento * 3  # 3s, 6s, 9s
                print(f"AVISO: SUNAT devolvio {ultimo_error[:200]}. Reintentando en {espera}s (intento {intento}/{intentos})...")
                time.sleep(espera)
                continue
            else:
                detalle = e.read()[:800].decode("utf-8", "replace")
                raise RuntimeError(f"Error SUNAT {e.code} en {url_completa}: {detalle}")
        except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionResetError, http.client.RemoteDisconnected) as e:
            ultimo_error = f"Error de red / Timeout ({e})"
            if intento < intentos:
                espera = intento * 3  # 3s, 6s, 9s
                print(f"AVISO: Timeout/fallo de red en llamada a SUNAT ({e}). Reintentando en {espera}s (intento {intento + 1}/{intentos})...")
                time.sleep(espera)
                continue
        except Exception as e:
            ultimo_error = str(e)
            if intento < intentos:
                time.sleep(intento * 3)
                continue

    raise RuntimeError(f"Error comunicando con SUNAT en {url_completa} tras {intentos} intentos. Ultimo error: {ultimo_error}")


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


def esperar_ticket(token, num_ticket, periodo, max_seg=None):
    """Consulta el ticket con pausas que crecen (3, 6, 12, 20, 30, 30... s)
    hasta max_seg. Registra en el log cada cambio de estado que da SUNAT.
    Si no termina, lanza SunatNoEntrega para que se pida OTRO ticket."""
    max_seg = max_seg or ESPERA_TICKET_SEG
    inicio = time.time()
    pausa, consultas, ultimo_estado = 3, 0, None
    while True:
        consultas += 1
        try:
            registro = consultar_estado_ticket(token, num_ticket, periodo)
        except RuntimeError as e:
            if str(e).startswith("Error SUNAT 4"):
                raise   # credenciales/parametros: esperar no lo arregla
            registro = None
            estado = f"error al consultar ({str(e)[:150]})"
        else:
            if registro is None:
                estado = "no aparece en la lista de SUNAT"
            else:
                detalle = registro.get("detalleTicket", {}) or {}
                estado = (f"{registro.get('desEstadoProceso', '')} / {detalle.get('desEstadoEnvio', '')}"
                          f" (cod {registro.get('codEstadoProceso', '?')})").strip()
                desc = f"{detalle.get('desEstadoEnvio', '')} {registro.get('desEstadoProceso', '')}".lower()
                if "error" in desc:
                    raise RuntimeError(f"SUNAT reporto error procesando el ticket {num_ticket}: {registro}")
                if "terminado" in desc:
                    print(f"SUNAT ticket {num_ticket}: terminado en {int(time.time() - inicio)} s.")
                    archivos = registro.get("archivoReporte") or detalle.get("archivoReporte") or []
                    return [{
                        "nombre": a["nomArchivoReporte"],
                        "codTipoArchivo": a.get("codTipoAchivoReporte") or a.get("codTipoArchivoReporte"),
                        "perTributario": registro.get("perTributario", periodo),
                        "codProceso": registro.get("codProceso"),
                        "numTicket": registro.get("numTicket", num_ticket),
                    } for a in archivos if a.get("nomArchivoReporte")]
        if estado != ultimo_estado:
            print(f"SUNAT ticket {num_ticket} a los {int(time.time() - inicio)} s: {estado}")
            ultimo_estado = estado
        if time.time() - inicio + pausa > max_seg:
            raise SunatNoEntrega(atascado=True, ticket=num_ticket, texto=f"el ticket {num_ticket} no termino en {max_seg} s "
                                 f"({consultas} consultas; ultimo estado: {estado})")
        time.sleep(pausa)
        pausa = min(30, pausa * 2 if pausa < 12 else pausa + 8)


def descargar_archivo(token, archivo, cod_libro, esperas_seg=None):
    """Baja el archivo de un ticket terminado; si SUNAT no lo entrega tras unos
    reintentos cortos lanza SunatNoEntrega (se pide otro ticket)."""
    esperas_seg = esperas_seg or ESPERAS_DESCARGA_SEG
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
    intentos = len(esperas_seg) + 1
    for n in range(1, intentos + 1):
        try:
            contenido = sire_get(url, params, token, accept="*/*", intentos=2).read()
            if len(contenido) > 0:
                return contenido
            ultimo_error = "archivo vacio (0 bytes)"
        except Exception as e:
            ultimo_error = str(e)[-300:]
        if n < intentos:
            print(f"AVISO: SUNAT no entrego '{archivo['nombre']}' (intento {n}/{intentos}): "
                  f"{ultimo_error[-200:]}. Nuevo intento en {esperas_seg[n - 1]} s...")
            time.sleep(esperas_seg[n - 1])
    raise SunatNoEntrega(ticket=archivo["numTicket"], texto=f"SUNAT no entrego el archivo '{archivo['nombre']}' "
                         f"del ticket {archivo['numTicket']} tras {intentos} intentos. Ultimo error: {ultimo_error}")


def descargar_periodo(token, periodo, tipo, formato="txt"):
    """tipo: 'venta' | 'compra'. Devuelve (lista de (nombre, bytes), modo).

    - Ticket que no termina a tiempo: NO se pide otro (SUNAT solo admite uno en curso por libro y
      respondera 42209 con ese mismo numero). Se deja PENDIENTE y se retoma en la siguiente corrida.
    - Ticket terminado cuyo archivo no se entrega (HTTP 500): se pide UN ticket nuevo; si tampoco,
      PENDIENTE. Asi no se gastan 10+ minutos de GitHub esperando a un SUNAT lento."""
    for pedido in range(1, MAX_PEDIDOS + 1):
        try:
            return _descargar_periodo_una_vez(token, periodo, tipo, formato)
        except SunatNoEntrega as e:
            if e.atascado or pedido == MAX_PEDIDOS:
                raise SunatPendiente(f"SUNAT todavia no entrega el {tipo} {periodo}: {e}", ticket=e.ticket)
            print(f"AVISO: {e}. Se pide un ticket nuevo a SUNAT ({pedido + 1}/{MAX_PEDIDOS}) en 20 s...")
            time.sleep(20)


def _ticket_en_curso(error):
    """SUNAT solo deja UN pedido de exportacion en curso por libro. Si ya hay
    uno, responde 422 / 42209 ("aun tiene un proceso ... en curso con Ticket:
    N"). Ese N es el pedido que hay que esperar: pedir otro no sirve."""
    texto = str(error)
    if "42209" not in texto:
        return None
    m = re.search(r"Ticket:\s*(\d{8,})", texto)
    return m.group(1) if m else None


def _pedir_o_retomar(pedir):
    """Pide un ticket; si SUNAT ya tiene uno en curso (de esta corrida o de
    una anterior), devuelve ESE para seguir esperandolo."""
    try:
        return pedir()
    except RuntimeError as e:
        num = _ticket_en_curso(e)
        if not num:
            raise
        print(f"SUNAT ya tiene el pedido {num} en curso (de un intento anterior): se espera ese.")
        return num


def _descargar_periodo_una_vez(token, periodo, tipo, formato="txt"):
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
        # Nuestros propios errores (ticket atascado, archivo no entregado)
        # NUNCA son "sin comprobantes": su texto trae el numero de ticket, y
        # un ticket como 20260300001815 contiene "1815" y antes se tomaba el
        # periodo como VACIO (se perdian los datos sin aviso).
        if isinstance(e, SunatNoEntrega):
            return False
        texto = str(e)
        # Codigos como numero suelto (no dentro de un numero de ticket).
        if re.search(r"(?<!\d)(1070|1815)(?!\d)", texto):
            return True
        return any(marca in texto for marca in (
            "No se ha encontrado", "No existen documentos para exportar",
        ))

    usar_oficial = periodo_presentado(token, periodo, cod_libro)
    # modo_efectivo: de donde salieron realmente los archivos devueltos (no
    # necesariamente igual a usar_oficial, por el fallback de abajo). None si
    # termino sin archivos (periodo vacio, no hay nada que rotular).
    modo_efectivo = "oficial" if usar_oficial else "propuesta"
    try:
        num_ticket = _pedir_o_retomar(pedir_oficial if usar_oficial else pedir_propuesta)
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
                num_ticket = _pedir_o_retomar(pedir_propuesta)
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

    try:
        archivos, modo = descargar_periodo(token, args.periodo, args.tipo, args.formato)
    except SunatPendiente as e:
        # Linea FIJA para el workflow: no es un error, es «⏳ pendiente en SUNAT».
        print(f"AVISO: {e}")
        print(f"PENDIENTE_SUNAT={e.ticket or '-'}")
        sys.exit(EXIT_PENDIENTE)
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
