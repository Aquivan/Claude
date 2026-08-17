/**
 * SireClient.gs
 * Cliente de la API SIRE de SUNAT, portado 1:1 desde la version Python ya
 * verificada contra produccion. Ver notas de cada funcion para el porque de
 * cada detalle -- varios fueron descubiertos a fuerza de depuracion real.
 *
 * Manuales de referencia (SIEMPRE usar la version vigente, no la primera que
 * salga en Google -- ver comentario largo en descargarArchivo_):
 *   https://cpe.sunat.gob.pe/node/158
 */

var TOKEN_URL_ = 'https://api-seguridad.sunat.gob.pe/v1/clientessol/CLIENT_ID/oauth2/token/';
var SIRE_BASE_ = 'https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros';
var COD_LIBRO_RVIE_ = '140000';
var COD_LIBRO_RCE_ = '080000';

/** Autentica y devuelve el access_token. cfg = {ruc, usuario_sol, clave_sol, client_id, client_secret} */
function autenticar_(cfg) {
  var url = TOKEN_URL_.replace('CLIENT_ID', cfg.client_id);
  var payload = {
    grant_type: 'password',
    scope: 'https://api-sire.sunat.gob.pe',
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    username: cfg.ruc + cfg.usuario_sol,
    password: cfg.clave_sol,
  };
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('No se pudo autenticar contra SUNAT (' + resp.getResponseCode() + '): ' +
      resp.getContentText().substring(0, 500));
  }
  var data = JSON.parse(resp.getContentText());
  if (!data.access_token) {
    throw new Error('Respuesta de autenticacion sin access_token: ' + resp.getContentText().substring(0, 500));
  }
  return data.access_token;
}

/**
 * GET generico contra la API SIRE, con reintento automatico en 429 (limite de
 * peticiones de SUNAT) y manejo del bug del header Accept (ver descargarArchivo_).
 */
function sireGet_(url, params, token, accept, intentos429) {
  if (accept === undefined) accept = 'application/json';
  if (intentos429 === undefined) intentos429 = 4;

  var qs = [];
  for (var k in params) {
    if (params[k] === undefined || params[k] === null) continue;
    qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  }
  var urlCompleta = url + (qs.length ? '?' + qs.join('&') : '');

  var resp = UrlFetchApp.fetch(urlCompleta, {
    method: 'get',
    headers: {
      'Content-Type': 'application/json',
      'Accept': accept,
      'Authorization': 'Bearer ' + token,
    },
    muteHttpExceptions: true,
  });

  var codigo = resp.getResponseCode();
  if (codigo === 429 && intentos429 > 0) {
    var espera = 30 * (5 - intentos429); // 30s, 60s, 90s, 120s -- igual que la version Python
    Utilities.sleep(espera * 1000);
    return sireGet_(url, params, token, accept, intentos429 - 1);
  }
  if (codigo !== 200) {
    var detalle = codigo === 429
      ? 'Limite de peticiones de SUNAT alcanzado; reintenta en unos minutos.'
      : resp.getContentText().substring(0, 300);
    throw new Error('Error SUNAT ' + codigo + ' en ' + urlCompleta + ': ' + detalle);
  }
  return resp;
}

/**
 * Endpoint compartido por RVIE y RCE para "descargar por periodo" (rvierce =
 * RVIE+RCE juntos en el path). Se usa para RVIE; para RCE hay un endpoint
 * dedicado distinto (ver solicitarDescargaRCE_) porque este devuelve ticket
 * "Terminado" pero archivo vacio para compras -- verificado en produccion.
 */
function solicitarDescargaRVIE_(token, periodo, codTipoArchivo, codProceso) {
  codTipoArchivo = codTipoArchivo || '0';
  codProceso = codProceso || '23';
  var url = SIRE_BASE_ + '/rvierce/gestionlibro/web/registroslibros/descarga';
  var data = JSON.parse(sireGet_(url, {
    perTributario: periodo,
    codOrigenEnvio: '2',
    codTipoArchivo: codTipoArchivo,
    codProceso: codProceso,
    codLibro: COD_LIBRO_RVIE_,
  }, token).getContentText());
  return data.numTicket;
}

/**
 * Compras (RCE). Usa el endpoint dedicado (manual Compras v28 seccion 5.51).
 * codProceso: el manual documenta 00/01/02 pero la API real los rechaza con
 * "1026 - Codigo Proceso no permitido". El valor que SI funciona es 70
 * ("Descarga RCE" del Anexo I de indicadores) -- verificado en produccion.
 */
function solicitarDescargaRCE_(token, periodo, codTipoArchivo, codProceso, codMoneda) {
  codTipoArchivo = codTipoArchivo || '0';
  codProceso = codProceso || '70';
  codMoneda = codMoneda || 'PEN';
  var url = SIRE_BASE_ + '/rce/ajustesposteriores/web/ajustesposteriores/' + periodo + '/solicitardescarga';
  var data = JSON.parse(sireGet_(url, {
    codTipoArchivo: codTipoArchivo,
    codMoneda: codMoneda,
    codProceso: codProceso,
    codOrigen: '2', // el manual v22 decia 1, es incorrecto -- confirmado 2
    lisPeriodos: periodo,
  }, token).getContentText());
  return data.numTicket;
}

/** Propuesta de Ventas (para periodos aun no "Presentados"). Manual Ventas v30 5.18. */
function solicitarPropuestaRVIE_(token, periodo, codTipoArchivo) {
  codTipoArchivo = codTipoArchivo || '0';
  var url = SIRE_BASE_ + '/rvie/propuesta/web/propuesta/' + periodo + '/exportapropuesta';
  var data = JSON.parse(sireGet_(url, { codTipoArchivo: codTipoArchivo }, token).getContentText());
  return data.numTicket;
}

/** Propuesta de Compras. Manual Compras v28 5.34. */
function solicitarPropuestaRCE_(token, periodo, codTipoArchivo) {
  codTipoArchivo = codTipoArchivo || '0';
  var url = SIRE_BASE_ + '/rce/propuesta/web/propuesta/' + periodo + '/exportacioncomprobantepropuesta';
  var data = JSON.parse(sireGet_(url, { codTipoArchivo: codTipoArchivo, codOrigenEnvio: '2' }, token).getContentText());
  return data.numTicket;
}

/** {perTributario: desEstado} para saber si un periodo ya esta "Presentado". */
function consultarPeriodos_(token, codLibro) {
  var url = SIRE_BASE_ + '/rvierce/padron/web/omisos/' + codLibro + '/periodos';
  var data = JSON.parse(sireGet_(url, {}, token).getContentText());
  var estados = {};
  (data || []).forEach(function (ejercicio) {
    (ejercicio.lisPeriodos || []).forEach(function (p) {
      estados[p.perTributario] = p.desEstado || '';
    });
  });
  return estados;
}

function periodoPresentado_(token, periodo, codLibro) {
  var estados = consultarPeriodos_(token, codLibro);
  var estado = (estados[periodo] || '').trim().toLowerCase();
  return estado.indexOf('presentado') === 0;
}

/** Devuelve el registro del ticket, o null si SUNAT aun no lo lista (recien creado). */
function consultarEstadoTicket_(token, numTicket, periodo) {
  var url = SIRE_BASE_ + '/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets';
  var data = JSON.parse(sireGet_(url, {
    perIni: periodo, perFin: periodo, page: 1, perPage: 50, numTicket: numTicket,
  }, token).getContentText());
  var registros = data.registros || [];
  for (var i = 0; i < registros.length; i++) {
    var r = registros[i];
    if (r.numTicket === numTicket || (r.detalleTicket && r.detalleTicket.numTicket === numTicket)) {
      return r;
    }
  }
  return null;
}

/**
 * Hace polling hasta que el ticket termine. El codigo de estado "terminado"
 * documentado en el manual (05) es INCORRECTO -- el real es 06, pero es mas
 * confiable buscar el texto "Terminado" en la descripcion en vez de un codigo
 * numerico (verificado empiricamente contra produccion 2026-08-11).
 * archivoReporte puede venir en el nivel raiz del registro o dentro de
 * detalleTicket segun el proceso -- se revisan ambos.
 */
function esperarTicket_(token, numTicket, periodo, intervaloSeg, maxIntentos) {
  intervaloSeg = intervaloSeg || 8;
  maxIntentos = maxIntentos || 40;

  for (var i = 0; i < maxIntentos; i++) {
    var registro = consultarEstadoTicket_(token, numTicket, periodo);
    if (registro === null) {
      Utilities.sleep(intervaloSeg * 1000);
      continue;
    }
    var detalle = registro.detalleTicket || {};
    var desc = ((detalle.desEstadoEnvio || '') + ' ' + (registro.desEstadoProceso || '')).toLowerCase();

    if (desc.indexOf('error') !== -1) {
      throw new Error('SUNAT reporto error procesando el ticket ' + numTicket + ': ' + JSON.stringify(registro));
    }
    if (desc.indexOf('terminado') !== -1) {
      var archivos = registro.archivoReporte || detalle.archivoReporte || [];
      return archivos
        .filter(function (a) { return !!a.nomArchivoReporte; })
        .map(function (a) {
          return {
            nombre: a.nomArchivoReporte,
            codTipoArchivo: a.codTipoAchivoReporte || a.codTipoArchivoReporte,
            perTributario: registro.perTributario || periodo,
            codProceso: registro.codProceso,
            numTicket: registro.numTicket || numTicket,
          };
        });
    }
    Utilities.sleep(intervaloSeg * 1000);
  }
  throw new Error('Timeout esperando el ticket ' + numTicket + ' (sigue en proceso en SUNAT)');
}

/**
 * Descarga el archivo binario (.zip). Devuelve un Blob.
 *
 * DOS bugs reales encontrados por depuracion, no documentados en ningun
 * manual de SUNAT (ni siquiera el vigente):
 *
 * 1) Si se manda Accept: application/json (como en el resto de llamadas),
 *    SUNAT responde 422 "El archivo solicitado no existe" AUNQUE EL ARCHIVO
 *    SI EXISTA. Con Accept: * / * lo sirve bien. Sin este fix, siempre falla.
 *
 * 2) El manual v22 (2024, el que aparece primero en buscadores) documenta
 *    este servicio con solo 3 parametros (nomArchivoReporte,
 *    codTipoArchivoReporte, codLibro). El manual VIGENTE (v30, jun-2026)
 *    agrego perTributario, codProceso y numTicket como OBLIGATORIOS. Sin
 *    ellos, SUNAT responde 200 con el archivo vacio (0 bytes) o un 500
 *    generico, sin ningun mensaje de error que lo explique.
 *
 * Por eso archivo debe ser el objeto completo devuelto por esperarTicket_
 * (no solo el nombre).
 */
function descargarArchivo_(token, archivo, codLibro, reintentos, esperaSeg) {
  reintentos = reintentos || 3;
  esperaSeg = esperaSeg || 8;
  var url = SIRE_BASE_ + '/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte';
  var params = {
    nomArchivoReporte: archivo.nombre,
    codTipoArchivoReporte: archivo.codTipoArchivo,
    codLibro: codLibro,
    perTributario: archivo.perTributario,
    codProceso: archivo.codProceso,
    numTicket: archivo.numTicket,
  };

  var ultimoError = null;
  for (var i = 0; i < reintentos; i++) {
    try {
      var resp = sireGet_(url, params, token, '*/*');
      var blob = resp.getBlob();
      if (blob.getBytes().length > 0) return blob;
      ultimoError = new Error('SUNAT devolvio el archivo vacio (0 bytes)');
    } catch (e) {
      ultimoError = e;
    }
    Utilities.sleep(esperaSeg * 1000);
  }
  throw new Error("No se pudo descargar '" + archivo.nombre + "' tras " + reintentos +
    ' intentos. Ultimo error: ' + ultimoError);
}

/**
 * Flujo completo por periodo. tipo: 'venta' | 'compra'. Devuelve un array de
 * {nombre, blob}. Si el periodo aun no esta "Presentado" (no se
 * genero/acepto el registro), no existe libro que descargar; en ese caso baja
 * la PROPUESTA de SUNAT, que es la informacion disponible para ese periodo.
 */
function descargarPeriodo_(token, periodo, tipo, formato) {
  formato = formato || 'txt';
  var codTipoArchivo = formato === 'csv' ? '1' : '0';
  var codLibro = tipo === 'venta' ? COD_LIBRO_RVIE_ : COD_LIBRO_RCE_;

  var numTicket;
  if (!periodoPresentado_(token, periodo, codLibro)) {
    numTicket = tipo === 'venta'
      ? solicitarPropuestaRVIE_(token, periodo, codTipoArchivo)
      : solicitarPropuestaRCE_(token, periodo, codTipoArchivo);
  } else if (tipo === 'venta') {
    numTicket = solicitarDescargaRVIE_(token, periodo, codTipoArchivo);
  } else {
    numTicket = solicitarDescargaRCE_(token, periodo, codTipoArchivo);
  }

  var archivos = esperarTicket_(token, numTicket, periodo);
  return archivos.map(function (archivo) {
    var blob = descargarArchivo_(token, archivo, codLibro);
    var nombreLimpio = archivo.nombre.indexOf('__') !== -1
      ? archivo.nombre.split('__').pop()
      : archivo.nombre;
    return { nombre: nombreLimpio, blob: blob };
  });
}
