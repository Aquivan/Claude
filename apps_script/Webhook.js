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
    } else if (body.pendiente) {
      // ⏳ SUNAT aún no entregó el reporte (lento): no es un error. Se vuelve a pedir solo más tarde.
      anotarSirePendiente_(String(body.ruc), String(body.periodo), String(body.tipo || 'ambos'));
      respuesta = 'ok, ' + body.ruc + ' ' + body.periodo + ' pendiente en SUNAT: se vuelve a pedir en ' + SIRE_PEND_MIN_ + ' min';
    } else {
      quitarSirePendiente_(String(body.ruc), String(body.periodo));   // llegó: ya no está pendiente
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


// ---------------------------------------------------------------------------
// ⏳ SIRE pendiente en SUNAT. Cuando SUNAT está lenta, el robot no espera de más (no gasta GitHub): avisa
// «pendiente» y termina. Aquí se anota y, cada 30 min, se vuelve a pedir SOLO lo pendiente con la descarga
// rápida (sire-solo-reporte.yml). SUNAT entrega el MISMO pedido que quedó en curso. Hasta 8 intentos (4 h);
// después queda en el Registro como «no llegó». Los PDF/XML de esas facturas los trae la descarga diaria.
// ---------------------------------------------------------------------------

var SIRE_PEND_PROP_ = 'SIRE_PENDIENTES';
var SIRE_PEND_MIN_ = 30;
var SIRE_PEND_MAX_ = 8;

function leerSirePendientes_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty(SIRE_PEND_PROP_) || '{}'); }
function guardarSirePendientes_(p) { PropertiesService.getScriptProperties().setProperty(SIRE_PEND_PROP_, JSON.stringify(p)); }

function anotarSirePendiente_(ruc, periodo, tipo) {
  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    var p = leerSirePendientes_(), k = ruc + '|' + periodo;
    if (!p[k]) { p[k] = { ruc: ruc, periodo: periodo, tipo: tipo, desde: Date.now(), intentos: 0 }; registrarEnBitacora_('⏳ SIRE ' + ruc + ' ' + periodo + ': SUNAT aún no lo entrega (lento). Se vuelve a pedir solo cada ' + SIRE_PEND_MIN_ + ' min.'); }
    p[k].avisado = Date.now();
    guardarSirePendientes_(p);
  } finally { candado.releaseLock(); }
  var ya = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'reintentarSirePendientes'; });
  if (!ya) ScriptApp.newTrigger('reintentarSirePendientes').timeBased().after(SIRE_PEND_MIN_ * 60 * 1000).create();
}

function quitarSirePendiente_(ruc, periodo) {
  var p = leerSirePendientes_(), k = ruc + '|' + periodo;
  if (!p[k]) return;
  registrarEnBitacora_('✅ SIRE ' + ruc + ' ' + periodo + ': llegó (estaba pendiente en SUNAT desde ' +
    Utilities.formatDate(new Date(p[k].desde), 'America/Lima', 'dd/MM HH:mm') + ').');
  delete p[k];
  guardarSirePendientes_(p);
}

/** Activador: vuelve a pedir lo pendiente (una sola corrida rápida por mes, todas esas empresas juntas). */
function reintentarSirePendientes() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'reintentarSirePendientes') ScriptApp.deleteTrigger(t); });
  var p = leerSirePendientes_(), porPeriodo = {}, rendidos = [];
  Object.keys(p).forEach(function (k) {
    var x = p[k];
    if (x.intentos >= SIRE_PEND_MAX_) { rendidos.push(x); delete p[k]; return; }
    x.intentos++;
    (porPeriodo[x.periodo] = porPeriodo[x.periodo] || []).push(x.ruc);
  });
  guardarSirePendientes_(p);
  rendidos.forEach(function (x) {
    registrarEnBitacora_('❌ SIRE ' + x.ruc + ' ' + x.periodo + ': SUNAT no lo entregó en ' + SIRE_PEND_MAX_ + ' intentos (' +
      Math.round(SIRE_PEND_MAX_ * SIRE_PEND_MIN_ / 60) + ' h). Pídalo de nuevo más tarde (⚡ descarga rápida).');
  });
  var periodos = Object.keys(porPeriodo);
  if (!periodos.length) return;
  var cfg;
  try { cfg = cargarConfigGitHub_(); } catch (e) { registrarEnBitacora_('SIRE pendientes: ' + e.message); return; }
  periodos.forEach(function (per) {
    try {
      githubFetch_(cfg, '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO + '/actions/workflows/' + WORKFLOW_SOLO_REPORTE_ + '/dispatches', {
        method: 'post', payload: { ref: cfg.GITHUB_BRANCH, inputs: { ruc: porPeriodo[per].join(','), periodo: per, tipo: 'ambos' } } });
      registrarEnBitacora_('🔁 SIRE pendiente: vuelvo a pedir ' + per + ' de ' + porPeriodo[per].join(', ') + '.');
    } catch (e) { registrarEnBitacora_('SIRE pendientes: no se pudo pedir a GitHub ' + per + ': ' + e.message); }
  });
  // Si siguen pendientes, el robot avisará otra vez y se programa la siguiente vuelta.
}
