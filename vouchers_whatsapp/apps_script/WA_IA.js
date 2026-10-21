/**
 * 📲 Preguntas libres por WhatsApp → la IA de Cobranzas (la misma del asistente de Telegram).
 *
 * Todo texto que no sea un comando (modo…, estado, hola) y toda foto/PDF con una pregunta en
 * el comentario ("¿esto ya está pagado?", "ia …") se manda a la aplicación web de Cobranzas
 * (doPost?canal=wa, ver cobranzas/telegram/TG_WhatsApp.js), que contesta con todas sus
 * herramientas. Aquí solo se entrega la respuesta: texto, tablas cortas, fotos de vouchers,
 * archivos y Excel. Si la IA tarda más de 60 s (límite de UrlFetch), WA_cadaMinuto la recoge.
 */

var WA_IA_DEPLOY_ = 'AKfycby_duhJaZtw6nUyOhuoXU1LRu46J-AV7Q5E-gZuSgEO4Of6hWsSIcEZblYxp5YagDdZ';   // web app de Cobranzas
var WA_IA_ESPERA_MS_ = 10 * 60 * 1000;

function WA_iaUrl_() {
  return 'https://script.google.com/macros/s/' + (WA_prop_('WA_IA_DEPLOY') || WA_IA_DEPLOY_) + '/exec';
}

function WA_iaLlamar_(params, cuerpo) {
  cuerpo = cuerpo || {};
  if (WA_prop_('WA_PROCESAR_URL')) cuerpo._pu = WA_prop_('WA_PROCESAR_URL');   // ⚡ para que Telegram también procese al instante
  var qs = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  var r = UrlFetchApp.fetch(WA_iaUrl_() + '?canal=wa&' + qs, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo || {}), muteHttpExceptions: true, followRedirects: true
  });
  var t = r.getContentText();
  try { return JSON.parse(t); } catch (e) { return { ok: false, error: 'La IA respondió HTTP ' + r.getResponseCode() + ': ' + t.replace(/<[^>]+>/g, ' ').slice(0, 150) }; }
}

// Clave entre esta app y Cobranzas: se crea y registra sola la primera vez.
function WA_iaClave_() {
  var p = WA_props_(), k = p.getProperty('WA_IA_CLAVE');
  if (k) return k;
  k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var r = WA_iaLlamar_({ accion: 'registrar', token: k });
  if (!r || !r.ok) throw new Error('No pude conectar con la IA de Cobranzas: ' + ((r && r.error) || 'sin respuesta'));
  p.setProperty('WA_IA_CLAVE', k);
  return k;
}

/** Marca el mensaje como leído y muestra "escribiendo…" (no cuenta como mensaje). */
function WA_escribiendo_(idMsg) {
  WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', status: 'read', message_id: idMsg, typing_indicator: { type: 'text' }
  });
}

function WA_preguntarIA_(m, de, nombre, texto, adjuntos, audio) {
  try { WA_escribiendo_(m.id); } catch (e) {}
  var r;
  try {
    r = WA_iaLlamar_({ token: WA_iaClave_() }, { id: m.id, numero: de, nombre: nombre, texto: texto, adjuntos: adjuntos || [], audio: audio || null });
  } catch (e) {
    // Lo más común: la IA tardó más de 60 s. Sigue trabajando en Cobranzas; WA_cadaMinuto busca el resultado.
    if (/clave|conectar/i.test(e.message)) { WA_enviarTexto_(de, '⚠️ ' + e.message); return; }
    WA_props_().setProperty('WA_IAP_' + m.id, JSON.stringify({ de: de, t: Date.now() }));
    WA_props_().setProperty('WA_HAY_IA', '1');
    return;
  }
  WA_entregarIA_(de, r);
}

/** WA_cadaMinuto: respuestas de la IA que tardaron más de 60 s. */
function WA_buscarRespuestasIA_(props) {
  Object.keys(props).filter(function (k) { return k.indexOf('WA_IAP_') === 0; }).forEach(function (k) {
    var x = JSON.parse(props[k]), id = k.slice('WA_IAP_'.length);
    var r = WA_iaLlamar_({ token: WA_iaClave_(), accion: 'resultado', id: id });
    if (r && r.pendiente) {
      if (Date.now() - x.t < WA_IA_ESPERA_MS_) return;
      r = { ok: false, error: 'La IA no terminó a tiempo. Pruebe de nuevo, quizá con una pregunta más concreta.' };
    }
    WA_props_().deleteProperty(k);
    WA_entregarIA_(x.de, r);
  });
}

function WA_entregarIA_(de, r) {
  if (!r || !r.ok) { WA_enviarTexto_(de, '⚠️ ' + ((r && r.error) || 'La IA no respondió.')); return; }
  var txt = (r.dicho ? '🎤 _' + r.dicho + '_\n\n' : '') + WA_md_(r.respuesta);
  (r.tablas || []).forEach(function (t) { txt += '\n\n' + WA_tablaTexto_(t); });
  if ((r.avisos || []).length) txt += '\n\n' + r.avisos.join('\n');
  if ((r.sugerencias || []).length) txt += '\n\n💬 _También puede preguntar:_\n' + r.sugerencias.map(function (s) { return '• ' + s; }).join('\n');
  WA_trozos_(txt.trim()).forEach(function (t) { WA_enviarTexto_(de, t); });
  (r.archivos || []).forEach(function (a) {
    try { WA_enviarArchivo_(de, a); }
    catch (e) { WA_enviarTexto_(de, '⚠️ No pude mandar ' + (a.titulo || a.nombre) + ': ' + e.message); }
  });
  (r.descargas || []).forEach(function (d) { WA_ofrecerDescarga_(de, d); });
}

/** 🚀 Descarga de SUNAT propuesta por la IA: se confirma con un botón, igual que en Telegram. */
function WA_ofrecerDescarga_(de, d) {
  var r = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', to: de, type: 'interactive',
    interactive: { type: 'button', body: { text: '🚀 *¿Pido esta descarga a SUNAT?*\n' + d.texto + '\n_Corre en GitHub, solo LEE en SUNAT._' },
      action: { buttons: [{ type: 'reply', reply: { id: 'dl:' + d.k + ':si', title: '🚀 Sí, descargar' } },
                          { type: 'reply', reply: { id: 'dl:' + d.k + ':no', title: '✖ Cancelar' } }] } }
  });
  if (!r.ok) WA_enviarTexto_(de, '⚠️ No pude mostrar los botones de la descarga: ' + r.error);
}

/** Botón tocado en WhatsApp (id "dl:<clave>:si|no"). */
function WA_boton_(de, id) {
  var p = String(id).split(':');
  if (p[0] !== 'dl') return;
  var r;
  try { r = WA_iaLlamar_({ token: WA_iaClave_(), accion: 'boton', k: p[1], op: p[2] }); }
  catch (e) { r = { ok: false, error: e.message }; }
  WA_entregarIA_(de, r);
}

// Markdown de la IA → formato de WhatsApp (*negrita*, _cursiva_).
function WA_md_(t) {
  return String(t || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s*(.+)$/gm, '*$1*')
    .replace(/<\/?b>/g, '*').replace(/<\/?i>/g, '_').replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

// Cada fila como una "tarjeta" corta: las dos primeras columnas de título, el resto "columna: valor".
function WA_tablaTexto_(t) {
  var cols = t.columnas || [];
  var lineas = (t.filas || []).map(function (f) {
    var titulo = [f[0], f[1]].filter(function (v) { return v !== '' && v != null; }).join(' · ');
    var resto = cols.slice(2).map(function (c, j) { var v = f[j + 2]; return v === '' || v == null ? '' : c + ': ' + v; }).filter(String).join(' | ');
    return '▪️ *' + titulo + '*' + (resto ? '\n   ' + resto : '');
  });
  var mas = (t.total || 0) > lineas.length ? '\n_… y ' + (t.total - lineas.length) + ' más (van en el Excel)_' : '';
  return '📋 *' + (t.titulo || 'Resultado') + '* (' + (t.total || lineas.length) + ')\n' + lineas.join('\n') + mas;
}

function WA_trozos_(t) {
  var out = [], max = 3800;
  while (t.length > max) {
    var corte = t.lastIndexOf('\n\n', max);
    if (corte < max / 2) corte = t.lastIndexOf('\n', max);
    if (corte < max / 2) corte = max;
    out.push(t.slice(0, corte));
    t = t.slice(corte).replace(/^\s+/, '');
  }
  if (t) out.push(t);
  return out;
}

/** a = {nombre, mime, titulo, imagen, base64}: se sube a Meta y se manda como foto o documento. */
function WA_enviarArchivo_(de, a) {
  var blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime, a.nombre);
  var r = UrlFetchApp.fetch(WA_GRAPH_ + WA_prop_('WA_PHONE_ID') + '/media', {
    method: 'post', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + WA_prop_('WA_TOKEN') },
    payload: { messaging_product: 'whatsapp', type: a.mime, file: blob }
  });
  var d = {};
  try { d = JSON.parse(r.getContentText()); } catch (e) {}
  if (!d.id) throw new Error((d.error && d.error.message) || ('HTTP ' + r.getResponseCode()));
  var cuerpo = { messaging_product: 'whatsapp', to: de };
  var cap = String(a.titulo || '').slice(0, 1000);
  if (a.imagen) { cuerpo.type = 'image'; cuerpo.image = { id: d.id, caption: cap }; }
  else { cuerpo.type = 'document'; cuerpo.document = { id: d.id, caption: cap, filename: a.nombre }; }
  var s = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', cuerpo);
  if (!s.ok) throw new Error(s.error);
}
