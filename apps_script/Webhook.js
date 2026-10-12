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
      ejecutarImportacion_([body.periodo], false, body.ruc);
      registrarEnBitacora_('Webhook instantaneo: ' + body.ruc + ' periodo ' + body.periodo + ' importado.');
      respuesta = 'ok, ' + body.ruc + ' periodo ' + body.periodo + ' importado';
    }
  } catch (err) {
    respuesta = 'ERROR: ' + err.message;
    try { registrarEnBitacora_('Webhook instantaneo: ' + respuesta); } catch (e2) { /* ni la bitacora funciono, no hay mas donde avisar */ }
  }
  return ContentService.createTextOutput(respuesta);
}
