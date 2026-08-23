/**
 * GitHubSync.gs
 * Reemplaza a SireClient.gs + ZipHelper.gs del sistema anterior. Aquel
 * hablaba DIRECTO con SUNAT desde Apps Script (y necesitaba un parser de zip
 * manual porque Utilities.unzip() fallaba con los zips de SUNAT). Aca ya no
 * hace falta nada de eso: SOLO GitHub Actions le habla a SUNAT (corre con IP
 * fija, evita el problema de IP rotativa de Apps Script que ya se investigo
 * antes). Este archivo solo habla con la API de GitHub, con texto/JSON
 * plano -- no hay ningun .zip que descomprimir.
 *
 * Flujo: "disparar" pide a GitHub que corra el workflow (que YA procesa
 * TODAS las empresas activas de empresas.json en una sola corrida, una tras
 * otra). "importar" lee los CSV que ese workflow ya dejo guardados en el
 * repo y los trae a Drive -- son dos pasos separados a proposito (ver nota
 * en menuEjecutarTodas, Main.gs) para no depender de que Apps Script se
 * quede esperando una corrida larga sin que la maten por el limite de
 * tiempo de ejecucion.
 */

function githubApiUrl_(ruta) {
  return 'https://api.github.com' + ruta;
}

function githubHeaders_(cfg) {
  return {
    'Authorization': 'Bearer ' + cfg.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** GET/POST generico contra la API de GitHub, con manejo de errores legible. */
function githubFetch_(cfg, ruta, opciones) {
  opciones = opciones || {};
  var params = {
    method: opciones.method || 'get',
    headers: githubHeaders_(cfg),
    muteHttpExceptions: true,
  };
  if (opciones.payload) {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(opciones.payload);
  }
  var resp = UrlFetchApp.fetch(githubApiUrl_(ruta), params);
  var codigo = resp.getResponseCode();
  if (opciones.aceptar404 && codigo === 404) return null;
  if (codigo < 200 || codigo >= 300) {
    throw new Error('GitHub API ' + codigo + ' en ' + ruta + ': ' +
      resp.getContentText().substring(0, 400));
  }
  return resp;
}

/**
 * Dispara el workflow (equivalente a apretar "Run workflow" en GitHub, pero
 * desde la hoja). El workflow YA recorre todas las empresas activas de
 * empresas.json solo -- no hace falta dispararlo una vez por empresa, SALVO
 * que quieras correr solo UNA (inputs.ruc).
 * inputs: {periodo, tipo, modo, ruc} -- cualquiera puede venir vacio/omitido
 * salvo tipo/modo que el workflow espera con un valor (usa 'ambos'/'completo').
 * ruc vacio = todas las empresas activas; ruc con valor = SOLO esa empresa
 * (que igual debe estar activo:true en empresas.json).
 */
function dispararWorkflowGitHub_(cfg, inputs) {
  var ruta = '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO +
    '/actions/workflows/' + cfg.GITHUB_WORKFLOW + '/dispatches';
  githubFetch_(cfg, ruta, {
    method: 'post',
    payload: {
      ref: cfg.GITHUB_BRANCH,
      inputs: {
        periodo: inputs.periodo || '',
        tipo: inputs.tipo || 'ambos',
        modo: inputs.modo || 'completo',
        ruc: inputs.ruc || '',
      },
    },
  });
}

/**
 * El endpoint de "dispatch" no devuelve el ID de la corrida que acaba de
 * crear (limitacion de la API de GitHub, no es un error de este codigo).
 * Para poder mostrarle al usuario un link directo a la corrida, se espera
 * unos segundos y se busca la corrida mas reciente de este workflow que haya
 * arrancado despues del momento en que se disparo -- sin bloquear a esperar
 * a que TERMINE (eso puede tardar varios minutos y Apps Script mata la
 * ejecucion a los 6/30 minutos).
 */
function buscarCorridaRecienDisparada_(cfg, desdeMs) {
  var ruta = '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO +
    '/actions/workflows/' + cfg.GITHUB_WORKFLOW +
    '/runs?branch=' + encodeURIComponent(cfg.GITHUB_BRANCH) +
    '&event=workflow_dispatch&per_page=5';
  for (var intento = 0; intento < 6; intento++) {
    Utilities.sleep(3000);
    var data = JSON.parse(githubFetch_(cfg, ruta).getContentText());
    var corridas = data.workflow_runs || [];
    for (var i = 0; i < corridas.length; i++) {
      var creada = new Date(corridas[i].created_at).getTime();
      if (creada >= desdeMs - 5000) return corridas[i];
    }
  }
  return null; // no se encontro todavia -- no es un error, GitHub puede tardar en listarla
}

/** Info de la corrida mas reciente del workflow (para el menu "Ver estado"). */
function obtenerUltimaCorridaGitHub_(cfg) {
  var ruta = '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO +
    '/actions/workflows/' + cfg.GITHUB_WORKFLOW + '/runs?per_page=1';
  var data = JSON.parse(githubFetch_(cfg, ruta).getContentText());
  var corridas = data.workflow_runs || [];
  return corridas.length > 0 ? corridas[0] : null;
}

/**
 * Busca, entre las corridas MAS RECIENTES del workflow, la primera que haya
 * arrancado en/despues de 'desdeMs' -- a diferencia de
 * obtenerUltimaCorridaGitHub_ (que trae "la ultima, sea cual sea"), esta se
 * usa para el seguimiento automatico despues de un dispatch propio, para no
 * confundirse con OTRA corrida mas reciente que haya arrancado por otro lado
 * mientras tanto (el cron diario, u otra persona/sesion disparando a mano).
 * Un solo intento (no bloquea con sleep) -- quien la llama es responsable de
 * reintentar mas tarde si todavia no aparece.
 */
function buscarCorridaDesde_(cfg, desdeMs) {
  var ruta = '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO +
    '/actions/workflows/' + cfg.GITHUB_WORKFLOW +
    '/runs?branch=' + encodeURIComponent(cfg.GITHUB_BRANCH) +
    '&event=workflow_dispatch&per_page=10';
  var data = JSON.parse(githubFetch_(cfg, ruta).getContentText());
  var corridas = data.workflow_runs || [];
  for (var i = 0; i < corridas.length; i++) {
    var creada = new Date(corridas[i].created_at).getTime();
    if (creada >= desdeMs - 5000) return corridas[i];
  }
  return null; // todavia no aparece (o quedo mas atras de las ultimas 10)
}

/**
 * Lee un archivo del repo (rama configurada) y devuelve su contenido como
 * texto UTF-8, o null si no existe (404 -- por ejemplo, un periodo que
 * GitHub todavia no proceso). La API de GitHub entrega el contenido en
 * base64 para cualquier archivo de texto.
 */
function leerArchivoTextoGitHub_(cfg, rutaArchivo) {
  var ruta = '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO +
    '/contents/' + rutaArchivo + '?ref=' + encodeURIComponent(cfg.GITHUB_BRANCH);
  var resp = githubFetch_(cfg, ruta, { aceptar404: true });
  if (resp === null) return null;
  var data = JSON.parse(resp.getContentText());
  if (data.encoding !== 'base64') {
    throw new Error('Formato inesperado leyendo ' + rutaArchivo + ' (encoding=' + data.encoding + ')');
  }
  // El contenido base64 que devuelve GitHub viene con saltos de linea cada
  // 60 caracteres (formato RFC 2045) -- Utilities.base64Decode los tolera bien.
  var bytes = Utilities.base64Decode(data.content, Utilities.Charset.UTF_8);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

/**
 * Igual que leerArchivoTextoGitHub_, pero para archivos BINARIOS (zip, pdf) --
 * devuelve un Blob en vez de forzarlo a texto (que corromperia los bytes).
 * null si no existe. OJO: la API de Contents de GitHub no sirve el campo
 * "content" para archivos de mas de 1MB (devuelve vacio) -- no es un
 * problema esperado para estos .zip (son solo los comprobantes de un
 * periodo), pero si algun dia una empresa tiene un volumen enorme, esto
 * devolveria un blob vacio en vez de tirar error.
 */
function leerArchivoBinarioGitHub_(cfg, rutaArchivo, nombreParaBlob) {
  var ruta = '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO +
    '/contents/' + rutaArchivo + '?ref=' + encodeURIComponent(cfg.GITHUB_BRANCH);
  var resp = githubFetch_(cfg, ruta, { aceptar404: true });
  if (resp === null) return null;
  var data = JSON.parse(resp.getContentText());
  if (data.encoding !== 'base64') {
    throw new Error('Formato inesperado leyendo ' + rutaArchivo + ' (encoding=' + data.encoding + ')');
  }
  var bytes = Utilities.base64Decode(data.content);
  return Utilities.newBlob(bytes, 'application/zip', nombreParaBlob || rutaArchivo.split('/').pop());
}

/**
 * empresas.json vive en la raiz del repo y es la MISMA fuente de verdad que
 * ya usa el workflow (preparar_empresas) -- se lee de ahi en vez de
 * duplicar la lista de empresas ademas dentro de Apps Script, para que
 * activar/desactivar una empresa en un solo lugar (GitHub) alcance para
 * ambos sistemas.
 */
function listarEmpresasGitHub_(cfg, soloActivas) {
  var contenido = leerArchivoTextoGitHub_(cfg, 'empresas.json');
  if (!contenido) throw new Error('No se encontro empresas.json en el repo/rama configurados.');
  var data = JSON.parse(contenido);
  var empresas = data.empresas || [];
  return soloActivas === false ? empresas : empresas.filter(function (e) { return e.activo; });
}

/**
 * CSV de un periodo ya procesado por GitHub, para una empresa+tipo. Lee de
 * la copia historica (sire/<ruc>/historico/<periodo>/...), que a diferencia
 * de sire/<ruc>/reporte_parseado*.csv NO se pisa entre corridas -- cada
 * periodo queda guardado en su propia ruta para siempre (ver el paso
 * "Guardar copia historica del periodo" en el workflow). Devuelve null si
 * ese periodo todavia no se proceso para esa empresa/tipo.
 */
function leerCsvHistoricoGitHub_(cfg, ruc, tipo, periodoStr) {
  var nombreArchivo = tipo === 'venta' ? 'reporte_parseado_ventas.csv' : 'reporte_parseado.csv';
  var ruta = 'sire/' + ruc + '/historico/' + periodoStr + '/' + nombreArchivo;
  return leerArchivoTextoGitHub_(cfg, ruta);
}

/**
 * resumen.txt de un periodo ya procesado (mismo mecanismo de historico que
 * leerCsvHistoricoGitHub_). Devuelve un array de {factura, archivoPdf,
 * archivoXml, tipo} -- tipo ('compra'|'venta') se deduce de la RUTA del
 * archivo (resumen.txt no trae una columna de tipo propia, compra y venta
 * quedan mezclados en el mismo archivo), para poder filtrar por tipo al
 * cruzar contra la hoja de Compra o de Venta por separado. Null si ese
 * periodo no tiene resumen.txt guardado (ej. no se descargaron PDF/XML ese
 * periodo, modalidad_descarga='sire').
 */
function leerResumenHistoricoGitHub_(cfg, ruc, periodoStr) {
  var contenido = leerArchivoTextoGitHub_(cfg, 'sire/' + ruc + '/historico/' + periodoStr + '/resumen.txt');
  if (!contenido) return null;

  var filas = parsearDelimitado_(quitarBOM_(contenido), ',');
  if (filas.length === 0) return [];
  var encabezado = filas[0].map(function (h) { return h.trim().toLowerCase(); });
  var idxFactura = encabezado.indexOf('factura');
  var idxPdf = encabezado.indexOf('archivo_pdf');
  var idxXml = encabezado.indexOf('archivo_xml');
  if (idxFactura === -1 || idxPdf === -1 || idxXml === -1) return [];

  return filas.slice(1).map(function (fila) {
    var archivoPdf = (fila[idxPdf] || '').trim();
    var archivoXml = (fila[idxXml] || '').trim();
    var ruta = archivoPdf || archivoXml;
    var tipo = ruta.indexOf('/venta/') !== -1 ? 'venta' : (ruta.indexOf('/compra/') !== -1 ? 'compra' : null);
    return {
      factura: (fila[idxFactura] || '').trim(),
      archivoPdf: archivoPdf,
      archivoXml: archivoXml,
      tipo: tipo,
    };
  });
}
