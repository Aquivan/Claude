/**
 * 📲 Llamadas a la API de WhatsApp (Meta Graph).
 */

function WA_graph_(metodo, ruta, cuerpo) {
  var op = { method: metodo.toLowerCase(), muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + WA_prop_('WA_TOKEN') } };
  if (cuerpo) { op.contentType = 'application/json'; op.payload = JSON.stringify(cuerpo); }
  for (var intento = 1; intento <= 3; intento++) {
    var r = UrlFetchApp.fetch(WA_GRAPH_ + ruta, op), cod = r.getResponseCode(), datos = {};
    try { datos = JSON.parse(r.getContentText() || '{}'); } catch (e) {}
    if (cod >= 200 && cod < 300) return { ok: true, datos: datos };
    if ((cod === 429 || cod >= 500) && intento < 3) { Utilities.sleep(1500 * intento); continue; }
    var err = datos.error || {};
    return { ok: false, error: (err.message || ('HTTP ' + cod)) + (err.code ? ' (código ' + err.code + ')' : ''), datos: datos };
  }
}

// El enlace de descarga que da Meta vale 5 minutos y pide el mismo token.
function WA_bajarMedia_(mediaId) {
  var info = WA_graph_('GET', mediaId);
  if (!info.ok) throw new Error('Meta no entregó el archivo: ' + info.error);
  var tam = Number(info.datos.file_size || 0);
  if (tam > WA_MAX_MB_ * 1024 * 1024) throw new Error('Archivo de ' + Math.round(tam / 1048576) + ' MB: el máximo es ' + WA_MAX_MB_ + ' MB');
  var r = UrlFetchApp.fetch(info.datos.url, { headers: { Authorization: 'Bearer ' + WA_prop_('WA_TOKEN') }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Descarga falló (HTTP ' + r.getResponseCode() + ')');
  return r.getBlob().setContentType(info.datos.mime_type || r.getHeaders()['Content-Type'] || 'application/octet-stream');
}

function WA_enviarTexto_(a, texto) {
  if (!WA_prop_('WA_TOKEN') || !WA_prop_('WA_PHONE_ID')) return false;
  var r = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', to: a, type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: false }
  });
  if (!r.ok) console.error('No se pudo responder a ' + a + ': ' + r.error);
  return r.ok;
}
