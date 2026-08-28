/**
 * Config.gs
 * Configuracion del sistema UNIFICADO: este Apps Script ya NO le habla a
 * SUNAT directamente (eso lo hace SOLO GitHub Actions, que corre con IP fija
 * y ya esta probado en produccion). Este archivo guarda:
 *
 *   - Credenciales de GitHub (para disparar el workflow y leer los CSV que
 *     ya genero) en Script Properties -- igual de privado que antes, nunca
 *     en el codigo.
 *   - Preferencias (liquidacion automatica al importar).
 *
 * NUNCA pongas el token de GitHub directamente en el codigo. Usa el menu
 * "SIRE SUNAT" > "Configurar GitHub" que aparece al abrir la hoja.
 */

var CLAVES_GITHUB_ = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_WORKFLOW'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SIRE SUNAT')
    .addItem('📊 Actualizar Panel de Control (Carátula)', 'menuActualizarPanelDeControl')
    .addSeparator()
    .addItem('1. Ejecutar TODAS las empresas activas ahora (dispara GitHub)', 'menuEjecutarTodas')
    .addItem('2. Ejecutar con un periodo especifico (todas las empresas)...', 'menuEjecutarPeriodoEspecifico')
    .addItem('3. Ejecutar "solo reintentar fallidas" (todas las empresas)', 'menuEjecutarSoloReintentarFallidas')
    .addItem('Ejecutar UNA sola empresa...', 'menuEjecutarUnaEmpresa')
    .addSeparator()
    .addItem('4. Importar resultados a Drive (periodo actual)', 'menuImportarPeriodoActual')
    .addItem('5. Importar resultados a Drive (periodo especifico)...', 'menuImportarPeriodoEspecifico')
    .addItem('6. Importar resultados a Drive (un RANGO de periodos)...', 'menuImportarRango')
    .addSeparator()
    .addItem('7. Ver estado de la ultima ejecucion en GitHub', 'menuVerEstadoGitHub')
    .addSeparator()
    .addItem('8. Generar/Actualizar planilla de liquidacion IGV...', 'menuGenerarLiquidacion')
    .addItem('Activar/Desactivar liquidacion automatica al importar', 'menuToggleLiquidacionAuto')
    .addItem('Vaciar valores manuales de una liquidacion (Percep/Retenc/Coef/Ajustes)',
      'menuLimpiarValoresManualesLiquidacion')
    .addSeparator()
    .addItem('⏰ Programar ejecución automática diaria (Hora Perú)...', 'menuProgramarEjecucionDiaria')
    .addItem('🚫 Desactivar ejecución automática diaria', 'menuDesactivarEjecucionDiaria')
    .addItem('Activar/cambiar importacion automatica periodica...', 'menuActivarImportacionAutomatica')
    .addItem('Desactivar importacion automatica periodica', 'menuDesactivarImportacionAutomatica')
    .addSeparator()
    .addItem('Configurar GitHub (token, repo, rama)', 'menuConfigurarGitHub')
    .addItem('Configurar Cloudflare R2 (opcional -- links de PDF/XML)', 'menuConfigurarR2')
    .addItem('Configurar webhook instantaneo (opcional -- ver Webhook.gs)', 'menuConfigurarWebhook')
    .addItem('Ver configuracion actual (sin mostrar el token)', 'menuVerConfiguracion')
    .addItem('Abrir carpeta de descargas en Drive', 'menuAbrirCarpetaDescargas')
    .addSeparator()
    .addItem('⚠️ Restablecer Drive y reimportar todo desde cero...', 'menuRestablecerDriveYReimportar')
    .addToUi();
}

function menuAbrirCarpetaDescargas() {
  var raiz = obtenerCarpetaRaiz_();
  var ui = SpreadsheetApp.getUi();
  ui.alert('Carpeta de descargas', raiz.getUrl(), ui.ButtonSet.OK);
}

/**
 * Prende/apaga si, al importar resultados, se actualiza tambien la planilla
 * de liquidacion IGV del anio correspondiente (de la empresa importada).
 * Default: DESACTIVADO -- la liquidacion es una hoja aparte y explicita
 * (menu "8."), no algo que se genere solo sin que lo pidas.
 */
function menuToggleLiquidacionAuto() {
  var props = PropertiesService.getScriptProperties();
  var actual = parsearBool_(leerPreferencia('LIQUIDACION_AUTO', 'false'));
  var nuevo = !actual;
  props.setProperty('LIQUIDACION_AUTO', nuevo ? 'true' : 'false');

  var ui = SpreadsheetApp.getUi();
  if (nuevo) {
    ui.alert('Liquidacion automatica: ACTIVADA',
      'A partir de ahora, cada vez que importes resultados (menus 4/5/6), se\n' +
      'actualiza tambien la planilla de liquidacion IGV del anio y RUC\n' +
      'correspondientes.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Liquidacion automatica: DESACTIVADA',
      'La planilla de liquidacion solo se genera/actualiza cuando entras\n' +
      'manualmente al menu "8. Generar/Actualizar planilla de liquidacion IGV".',
      ui.ButtonSet.OK);
  }
}

function parsearBool_(valor) {
  return String(valor).trim().toLowerCase() === 'true';
}

/**
 * Token de GitHub necesario: un Personal Access Token con permiso para
 * disparar workflows y leer el contenido del repo.
 *   - Fine-grained token (recomendado): sobre el repo "Aquivan/Claude",
 *     permisos "Actions: Read and write" + "Contents: Read-only".
 *   - Classic token: scope "repo" (y "workflow" si Github lo pide aparte).
 * Se genera en GitHub: Settings (de tu cuenta) > Developer settings >
 * Personal access tokens. Copialo apenas lo generes, GitHub no lo vuelve a
 * mostrar despues.
 */
function menuConfigurarGitHub() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var preguntas = [
    ['GITHUB_TOKEN', 'Personal Access Token de GitHub (permiso Actions + Contents sobre el repo)'],
    ['GITHUB_OWNER', 'Owner/organizacion del repo (ej: Aquivan)'],
    ['GITHUB_REPO', 'Nombre del repo (ej: Claude)'],
    ['GITHUB_BRANCH', 'Rama donde vive el workflow (ej: claude/python-codes-izve18)'],
    ['GITHUB_WORKFLOW', 'Nombre del archivo del workflow (ej: sire-cadena-completa.yml)'],
  ];

  for (var i = 0; i < preguntas.length; i++) {
    var clave = preguntas[i][0];
    var etiqueta = preguntas[i][1];
    var actual = props.getProperty(clave);
    var sufijo = actual ? ' (ya configurado, deja vacio para no cambiar)' : '';
    var resp = ui.prompt('Configurar GitHub', etiqueta + sufijo + ':', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) {
      ui.alert('Configuracion cancelada.');
      return;
    }
    var valor = resp.getResponseText().trim();
    if (valor) {
      props.setProperty(clave, valor);
    } else if (!actual) {
      ui.alert('"' + etiqueta + '" es obligatorio la primera vez. Vuelve a intentarlo.');
      return;
    }
  }
  ui.alert('Configuracion de GitHub guardada. Ya puedes usar las opciones de ejecucion/importacion del menu.');
}

/**
 * Cloudflare R2 es 100% OPCIONAL -- el proyecto funciona igual sin esto, y
 * si nunca lo configuras simplemente no aparecen las columnas "Link PDF"/
 * "Link XML" en las hojas. Sirve para tener un link directo y compartible a
 * cada PDF/XML, en vez de tener que abrir el repo privado de GitHub.
 *
 * Requisitos, del lado de GitHub (esto NO se configura desde aca, es aparte):
 *   1. Un bucket R2 creado en tu cuenta de Cloudflare.
 *   2. En empresas.json, poner "subir_pdf_r2": true en las empresas que
 *      quieras (GitHub sube el PDF/XML de esas al bucket automaticamente).
 *   3. 4 secrets en GitHub (Settings > Secrets and variables > Actions):
 *      R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 *   4. Que el bucket tenga acceso publico habilitado (o un dominio propio
 *      conectado) -- Cloudflare te da una URL base tipo
 *      "https://pub-xxxxxxxx.r2.dev" cuando activas el acceso publico del
 *      bucket. ESA url es la que se pide aca abajo.
 *
 * Aca en la hoja SOLO hace falta guardar esa URL base -- con eso, Apps
 * Script arma el link de cada archivo sin llamar a ningun lado (la ruta ya
 * se sabe de antemano: <url_base>/<ruc>/<misma ruta que en el repo>).
 */
function menuConfigurarR2() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var actual = props.getProperty('R2_URL_BASE');

  var resp = ui.prompt('Configurar Cloudflare R2 (opcional)',
    'URL base publica de tu bucket R2 (ej: https://pub-xxxxxxxx.r2.dev), ' +
    'sin barra al final.\n\n' +
    (actual ? ('Ya configurada: ' + actual + '\n') : '') +
    'Dejala vacia y aceptá para DESACTIVAR esta funcion (no se van a mostrar ' +
    'columnas de links).',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var valor = resp.getResponseText().trim().replace(/\/+$/, '');
  if (valor) {
    props.setProperty('R2_URL_BASE', valor);
    ui.alert('Cloudflare R2: ACTIVADO',
      'A partir de la proxima importacion, las hojas de Compra/Venta (y la ' +
      'Liquidacion) van a traer columnas "Link PDF"/"Link XML" para las ' +
      'empresas que tengan "subir_pdf_r2": true en empresas.json.\n\n' +
      'Si una empresa no tiene ese flag activado, o el archivo todavia no se ' +
      'subio a R2, esas columnas salen vacias -- no es un error.',
      ui.ButtonSet.OK);
  } else {
    props.deleteProperty('R2_URL_BASE');
    ui.alert('Cloudflare R2: DESACTIVADO. No se van a agregar columnas de links.');
  }
}

/** URL base de R2 configurada, o null si esta funcion opcional esta apagada. */
function obtenerR2UrlBase_() {
  return PropertiesService.getScriptProperties().getProperty('R2_URL_BASE') || null;
}

/**
 * Webhook instantaneo (ver Webhook.gs para la explicacion completa y los
 * pasos de despliegue): esto SOLO guarda el secreto de este lado. Falta
 * ademas desplegar la Web App (Deploy > New deployment) y cargar la URL +
 * el mismo secreto como 2 secrets en GitHub (SHEET_WEBHOOK_URL,
 * SHEET_WEBHOOK_SECRET) -- son pasos manuales que no se pueden hacer desde
 * este menu, se explican en el mensaje de confirmacion de abajo.
 */
function menuConfigurarWebhook() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var actual = props.getProperty('WEBHOOK_SECRET');

  var resp = ui.prompt('Configurar webhook instantaneo (opcional)',
    (actual ? 'Ya hay uno configurado (oculto). ' : '') +
    'Escribi una palabra secreta (para que nadie mas pueda llamar a este ' +
    'webhook -- despues la vas a pegar tambien en GitHub), o dejalo vacio ' +
    'para que se genere una automaticamente.',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var valor = resp.getResponseText().trim();
  if (!valor) valor = Utilities.getUuid();
  props.setProperty('WEBHOOK_SECRET', valor);

  ui.alert('Webhook: secreto guardado -- faltan 2 pasos manuales',
    'Secreto: ' + valor + '\n' +
    '(anotalo ahora, en "Ver configuracion" despues solo se ve oculto)\n\n' +
    '1. En el editor de Apps Script (script.google.com): Deploy > New ' +
    'deployment > tipo "Web app" (Execute as: Me, Who has access: Anyone) ' +
    '> Deploy. Copia la "Web app URL".\n\n' +
    '2. En GitHub: Settings > Secrets and variables > Actions, agrega:\n' +
    '   - SHEET_WEBHOOK_URL = esa URL\n' +
    '   - SHEET_WEBHOOK_SECRET = ' + valor + '\n\n' +
    'Recorda: cada vez que edites algun .gs despues de desplegar, hay que ' +
    'volver a Deploy > Manage deployments > editar > "New version" > Deploy.',
    ui.ButtonSet.OK);
}

function menuVerConfiguracion() {
  var props = PropertiesService.getScriptProperties();
  var lineas = [];
  CLAVES_GITHUB_.forEach(function (clave) {
    if (clave === 'GITHUB_TOKEN') {
      lineas.push(clave + ': ' + (props.getProperty(clave) ? 'configurado (oculto)' : 'FALTA'));
    } else {
      lineas.push(clave + ': ' + (props.getProperty(clave) || 'FALTA'));
    }
  });
  lineas.push('LIQUIDACION_AUTO: ' + leerPreferencia('LIQUIDACION_AUTO', 'false') +
    ' (default: false -- solo se genera por el menu "8.")');
  var trigger = buscarTriggerImportacionAutomatica_();
  var intervaloMin = leerPreferencia('IMPORTACION_INTERVALO_MIN', '15');
  lineas.push('Importacion automatica periodica: ' +
    (trigger ? ('ACTIVADA (cada ' + intervaloMin + ' min)') : 'desactivada'));
  var r2 = obtenerR2UrlBase_();
  lineas.push('Cloudflare R2 (links de PDF/XML, opcional): ' + (r2 ? ('ACTIVADO -- ' + r2) : 'desactivado'));
  var webhookSecreto = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  lineas.push('Webhook instantaneo (opcional): ' + (webhookSecreto ? 'configurado (oculto)' : 'desactivado') +
    ' -- ademas necesita la Web App desplegada y los secrets en GitHub, ver Webhook.gs');
  SpreadsheetApp.getUi().alert('Configuracion actual', lineas.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Lee la config de GitHub desde Script Properties y valida que este completa. */
function cargarConfigGitHub_() {
  var props = PropertiesService.getScriptProperties();
  var cfg = {};
  var faltantes = [];
  CLAVES_GITHUB_.forEach(function (clave) {
    var valor = props.getProperty(clave);
    if (!valor) faltantes.push(clave);
    cfg[clave] = valor;
  });
  if (faltantes.length > 0) {
    throw new Error(
      'Falta configurar: ' + faltantes.join(', ') +
      '. Ve al menu "SIRE SUNAT" > "Configurar GitHub".'
    );
  }
  return cfg;
}

/** Lee una preferencia opcional con valor por defecto. */
function leerPreferencia(clave, porDefecto) {
  var valor = PropertiesService.getScriptProperties().getProperty(clave);
  return valor ? valor : porDefecto;
}
