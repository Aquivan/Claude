/**
 * ChatIA.js (panel: ChatPanel.html) — 💬 CHAT CON LA IA (panel a la derecha de la hoja).
 *
 * Como conversar con un contador: se escribe lo que se necesita y se pueden
 * ADJUNTAR fotos, PDF, Excel o CSV (también pegar una captura con Ctrl+V). La IA
 * los lee, los cruza con la hoja de vouchers y con las facturas de SIRE
 * (¿ya está registrado?, ¿en qué fila?, ¿ya se usó?, ¿la factura existe?, ¿tiene
 * N/C, retención?…), responde y, si falta un dato en la hoja de vouchers,
 * PROPONE escribirlo: usted marca ✅ y recién se escribe (solo celdas vacías salvo
 * que marque "reemplazar"; ↩️ deshace).
 * Los archivos subidos se guardan en la carpeta temporal de importaciones (se
 * borran solos a los 7 días) para poder seguir preguntando sobre ellos.
 * Las tablas completas quedan en la pestaña 💬 Resultado IA. Funciones CHAT_.
 */

function CHAT_menuAbrir() {
  var html = HtmlService.createHtmlOutputFromFile('ChatPanel').setTitle('💬 Chat con la IA');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Un mensaje del chat.
 * msg = { texto, nuevos: [{nombre, mime, base64}], anteriores: [{id, nombre, mime}], historial: [{p, r}] }
 * Devuelve { respuesta, tablas: [{titulo, columnas, filas, total}], cambios: [...], adjuntos: [{id, nombre, mime}], seg, detalle }.
 */
function CHAT_enviar(msg) {
  // Las mismas herramientas de solo lectura del asistente de Telegram/WhatsApp (procesados, buscar_ruc, honorarios…).
  var op = {};
  try { op = { extraHerr: CHAT_herrExtra_(), extraSistema: CHAT_sistemaExtra_() }; } catch (e) { Logger.log('Chat — herramientas extra: ' + e.message); }
  return CHAT_enviarEn_(SpreadsheetApp.getActiveSpreadsheet(), msg, op);
}

/**
 * Lo mismo que CHAT_enviar, sobre un libro dado. op (opcional, lo usa el 🤖 asistente de Telegram):
 * las de ANA_preguntar_ (extraHerr, extraSistema, alPaso) y además
 *   sinHoja: true = no reescribe la pestaña 💬 Resultado IA (los cambios propuestos igual se guardan para aprobarlos);
 *   filasCompletas: true = devuelve todas las filas de cada tabla, sin formatear (para armar un Excel);
 *   origen: texto para el registro (ej. '📱 telegram').
 * Devuelve además "final" (la respuesta tal cual de la IA) y "c" (el contexto: archivos o acciones que pidió la IA).
 */
function CHAT_enviarEn_(ss, msg, op) {
  op = op || {};
  try {
    var texto = String(msg.texto || '').trim();
    var nuevos = msg.nuevos || [], anteriores = msg.anteriores || [];
    if (!texto && !nuevos.length) return { error: 'Escriba un mensaje o adjunte un archivo.' };
    // Guardar lo subido en la carpeta temporal (para poder volver a usarlo en la conversación)
    IMP_limpiarTemporales_(true);
    var carpeta = IMP_carpeta_(ss);
    var marca = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmm');
    var guardados = nuevos.map(function (a) {
      var f = carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', 'chat ' + marca + ' - ' + a.nombre));
      return { id: f.getId(), nombre: a.nombre, mime: a.mime || f.getMimeType() };
    });
    var adjuntos = anteriores.concat(guardados).slice(-10);
    if (!texto) texto = 'Analiza el/los archivo(s) adjunto(s): qué son, si ya están registrados en la hoja de vouchers y si corresponden a alguna factura; y qué falta registrar.';

    var sh = AUD_hoja_(ss);
    var cfg = leerConfig_(ss);
    var ia = AUD_ia_(ss, AUD_leerParam_(sh, cfg));
    if (!ia.clave) return { error: 'Falta la clave de IA: menú 🤝 Conciliar con IA → 🔑 Guardar clave de IA.', adjuntos: adjuntos };
    if (!ia.modelo && IA_PROVEEDORES_[ia.proveedor].tipo === 'gemini' &&
        PropertiesService.getScriptProperties().getProperty('ANA_SIN_MODELO_FUERTE') !== ANA_MODELO_GEMINI_) { ia.modelo = ANA_MODELO_GEMINI_; ia.modeloAuto = true; }
    var previas = (msg.historial || []).slice(-4).map(function (h) { return { pregunta: h.p, respuesta: h.r }; });
    if (op.modelo) { ia.modelo = op.modelo; ia.modeloAuto = false; }
    var out = ANA_preguntar_(ss, texto + (adjuntos.length ? '\n(Archivos de la conversación: ' + adjuntos.map(function (a, i) { return 'A' + (i + 1) + ' ' + a.nombre; }).join(', ') + ')' : ''),
      ia, previas, adjuntos.map(function (a) { return { id: a.id, nombre: a.nombre, mime: a.mime }; }), op);
    if (out.c.erroresAdj && out.c.erroresAdj.length) out.final.respuesta = '⚠️ No se pudo leer: ' + out.c.erroresAdj.join(' · ') +
      '\nLos archivos siguen en la conversación: escriba "reintenta" en un momento y se vuelven a leer.\n\n' + String(out.final.respuesta || '');
    if (out.c.cambioModelo || ia.cambioModelo) out.final.respuesta = String(out.final.respuesta || '') + '\n\n(Google tenía un modelo saturado; se usó el otro modelo de Gemini.)';
    var tablas;
    if (op.sinHoja) {
      tablas = ANA_tablas_(out.c, out.final.tablas);
      if (out.c.cambios && out.c.cambios.length && !out.c.lotePropuestos) out.c.lotePropuestos = ANX_guardarPropuestos_(ss, out.c.cambios);
    } else tablas = ANA_escribir_(ss, texto, out, ia);
    var log = ss.getSheetByName(AUD_CHAT_);
    if (!log) { log = ss.insertSheet(AUD_CHAT_); log.getRange(1, 1, 1, 4).setValues([['Fecha', 'Datos revisados', 'Pregunta', 'Respuesta']]); log.hideSheet(); }
    log.appendRow([new Date(), ((op.origen || '💬 chat') + (adjuntos.length ? ' · ' + adjuntos.length + ' adjunto(s)' : '') + ' · ' + out.pasos.join(' ; ')).slice(0, 5000), texto, String(out.final.respuesta || '').slice(0, 45000)]);
    return {
      respuesta: String(out.final.respuesta || ''),
      tablas: tablas.map(function (t) {
        return { titulo: t.titulo, columnas: t.columnas, total: t.filas.length,
          filas: op.filasCompletas ? t.filas : t.filas.slice(0, 25).map(function (f) { return f.map(ANA_fmt_); }) };
      }),
      cambios: (out.c.cambios || []).map(function (x) {
        return { id: x.id, fila: x.hoja + '!' + x.fila, columna: x.encabezado, actual: x.actual, nuevo: x.nuevo, motivo: x.motivo, aviso: x.aviso, url: x.url || '' };
      }),
      adjuntos: adjuntos, seg: out.seg, final: out.final, c: op.sinHoja ? out.c : undefined, pasos: out.pasos,
      detalle: ia.proveedor + (ia.modelo ? ' ' + ia.modelo : '') + ' · ' + out.seg + ' s · revisó: ' + (out.pasos.join(' ; ') || '—'),
    };
  } catch (e) {
    console.error(e.stack);
    return { error: ANA_mensajeError_(e), adjuntos: (msg.anteriores || []) };
  }
}

function CHAT_aplicar(ids, reemplazar) {
  try { return ANX_aplicarDet_(SpreadsheetApp.getActiveSpreadsheet(), ids || [], !!reemplazar); }
  catch (e) { return { error: '❌ ' + e.message }; }
}

function CHAT_deshacer() {
  try { return { mensaje: ANX_deshacer_(SpreadsheetApp.getActiveSpreadsheet()) }; }
  catch (e) { return { error: '❌ ' + e.message }; }
}

/** Abre la pestaña con las tablas completas. */
function CHAT_verResultado() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ANA_HOJA_);
  if (sh) ss.setActiveSheet(sh);
}

/** Enlace a la carpeta temporal (para quien no puede subir desde el navegador). */
function CHAT_carpeta() {
  var c = IMP_carpeta_(SpreadsheetApp.getActiveSpreadsheet());
  return { nombre: c.getName(), url: 'https://drive.google.com/drive/folders/' + c.getId() };
}
