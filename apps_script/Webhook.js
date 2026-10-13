/**
 * Webhook.gs
 * Aviso INSTANTANEO opcional: en vez de que la Sheet pregunte cada tanto si
 * GitHub ya termino (menu "Activar/cambiar importacion automatica periodica"
 * en Config.gs, o el "seguimiento" de ~5 min tras usar el menu "Ejecutar"),
 * GitHub le avisa DIRECTO a esta hoja apenas termina una empresa+periodo, y
 * la Sheet importa al toque (segundos, no minutos). No hace falta preguntar
 * "¿ya termino?" si GitHub mismo te toca la puerta cuando termina.
 *
 * Es un agregado -- si nunca lo despliegas como Web App, todo el resto del
 * sistema sigue funcionando exactamente igual (seguimiento, importacion
 * periodica, importacion manual con los menus "4/5/6").
 *
 * COMO ACTIVARLO (pasos completos, en orden):
 *   1. Pega este archivo (y los demas .gs actualizados) en el proyecto.
 *   2. Menu "SIRE SUNAT" > "Configurar webhook instantaneo (opcional)" --
 *      genera/guarda un secreto en ESTA hoja.
 *   3. En el editor de Apps Script (script.google.com, no en la Sheet):
 *      Deploy > New deployment > tipo "Web app".
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      Deploy, y copia la "Web app URL" que te da (termina en /exec).
 *   4. En GitHub: Settings > Secrets and variables > Actions, agrega 2
 *      Repository secrets:
 *        - SHEET_WEBHOOK_URL = la URL del paso 3
 *        - SHEET_WEBHOOK_SECRET = el mismo secreto del paso 2
 *   5. La Web App corre una VERSION fija del codigo. El workflow
 *      deploy-appsscript.yml ya la pasa sola a la version nueva cada vez que
 *      sube el codigo (misma URL). Solo si editas a mano en el editor hay que
 *      hacer Deploy > Manage deployments > lapiz > "New version" > Deploy.
 */

/** Punto de entrada que Google llama cuando GitHub hace el POST. No se llama
 * nunca a mano -- Apps Script lo invoca solo cuando llega la peticion a la
 * URL de la Web App desplegada. */
function doPost(e) {
  var respuesta;
  try {
    var body = JSON.parse(e.postData.contents);
    var secretoEsperado = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');

    if (!secretoEsperado) {
      respuesta = 'ERROR: el webhook no esta configurado en esta hoja (falta el secreto -- ' +
        'usa el menu "Configurar webhook instantaneo").';
    } else if (body.secreto !== secretoEsperado) {
      respuesta = 'ERROR: secreto incorrecto.';
    } else if (!body.ruc || !body.periodo) {
      respuesta = 'ERROR: falta ruc o periodo en el aviso.';
    } else {
      // Se responde AL TOQUE y la importacion va a una cola que se procesa en
      // segundo plano, una empresa a la vez. Asi GitHub no se queda ~5 min por
      // empresa esperando (minutos que se cobran) y dos importaciones nunca se pisan.
      encolarImportacionWebhook_(String(body.ruc), String(body.periodo));
      respuesta = 'ok, ' + body.ruc + ' periodo ' + body.periodo + ' en cola para importar';
    }
  } catch (err) {
    respuesta = 'ERROR: ' + err.message;
    try { registrarEnBitacora_('Webhook instantaneo: ' + respuesta); } catch (e2) { /* ni la bitacora funciono, no hay mas donde avisar */ }
  }
  return ContentService.createTextOutput(respuesta);
}

// ---------------------------------------------------------------------------
// Cola de importaciones avisadas por GitHub (patron "responder y procesar
// aparte"). La cola vive en Propiedades del script; un activador de un solo
// uso la procesa con candado (una importacion a la vez) y, si se acerca el
// limite de 6 minutos de Google, deja lo que falta para la siguiente vuelta.
// ---------------------------------------------------------------------------

var COLA_WEBHOOK_ = 'COLA_WEBHOOK';
var LIMITE_COLA_WEBHOOK_MS_ = 4 * 60 * 1000;

function encolarImportacionWebhook_(ruc, periodo) {
  var candado = LockService.getDocumentLock();
  candado.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var cola = JSON.parse(props.getProperty(COLA_WEBHOOK_) || '[]');
    if (!cola.some(function (x) { return x.ruc === ruc && x.periodo === periodo; })) cola.push({ ruc: ruc, periodo: periodo });
    props.setProperty(COLA_WEBHOOK_, JSON.stringify(cola));
  } finally {
    candado.releaseLock();
  }
  programarColaWebhook_();
}

function programarColaWebhook_() {
  var ya = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'procesarColaWebhook'; });
  if (!ya) ScriptApp.newTrigger('procesarColaWebhook').timeBased().after(30 * 1000).create();
}

/** Activador: importa lo que GitHub aviso, una empresa a la vez. */
function procesarColaWebhook() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'procesarColaWebhook') ScriptApp.deleteTrigger(t);
  });
  var trabajo = LockService.getScriptLock();
  if (!trabajo.tryLock(5000)) { programarColaWebhook_(); return; }  // otra vuelta ya esta importando
  var inicio = Date.now();
  try {
    while (true) {
      if (Date.now() - inicio > LIMITE_COLA_WEBHOOK_MS_) { programarColaWebhook_(); return; }
      var item = sacarDeColaWebhook_();
      if (!item) return;
      try {
        ejecutarImportacion_([item.periodo], false, item.ruc);
        registrarEnBitacora_('Webhook instantaneo: ' + item.ruc + ' periodo ' + item.periodo + ' importado.');
      } catch (e) {
        registrarEnBitacora_('Webhook instantaneo: ERROR importando ' + item.ruc + ' ' + item.periodo + ': ' + e.message);
      }
    }
  } finally {
    trabajo.releaseLock();
  }
}

function sacarDeColaWebhook_() {
  var candado = LockService.getDocumentLock();
  candado.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var cola = JSON.parse(props.getProperty(COLA_WEBHOOK_) || '[]');
    var item = cola.shift() || null;
    props.setProperty(COLA_WEBHOOK_, JSON.stringify(cola));
    return item;
  } finally {
    candado.releaseLock();
  }
}
