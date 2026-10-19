/**
 * 🧪 Probar modelos de IA con las claves guardadas (Gemini y Groq), para elegir con datos reales
 * cuál responde mejor y cuál está saturado. No cambia nada de la configuración: solo informa.
 * Y 🎤 guardar la clave de Groq (Whisper, para transcribir notas de voz).
 */

var TGM_PROP_GROQ_ = 'GROQ_KEY';
// Modelos a medir (además se listan todos los que la clave tiene habilitados).
var TGM_CANDIDATOS_ = ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

function TG_menuClaveGroq() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  var r = ui.prompt('🎤 Clave de Groq (audios)',
    'Pegue la clave de console.groq.com → API Keys (empieza con gsk_).\n' +
    (props.getProperty(TGM_PROP_GROQ_) ? 'Ya hay una guardada: deje vacío para conservarla, o escriba BORRAR.' : 'Se guarda solo en esta hoja (propiedades del script).'),
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var v = r.getResponseText().trim();
  if (!v) return;
  if (/^borrar$/i.test(v)) { props.deleteProperty(TGM_PROP_GROQ_); ui.alert('Clave de Groq borrada.'); return; }
  if (!/^gsk_\w{20,}$/.test(v)) { ui.alert('Esa clave no parece de Groq (debe empezar con gsk_).'); return; }
  var t = TGM_probarGroq_(v);
  if (!t.ok) { ui.alert('❌ Groq rechazó la clave: ' + t.error + '\nNo se guardó.'); return; }
  props.setProperty(TGM_PROP_GROQ_, v);
  ui.alert('✅ Clave de Groq guardada. Modelos de voz disponibles: ' + (t.whisper.join(', ') || 'ninguno') + '.');
}

function TG_menuProbarModelos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Probando cada modelo (unos segundos por modelo)…', '🧪 Modelos de IA', 60);
  var html = TGM_informe_();
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(720).setHeight(560), '🧪 Modelos de IA con sus claves');
}

function TGM_informe_() {
  var props = PropertiesService.getScriptProperties();
  var clave = props.getProperty('CIA_KEY_GEMINIGOOGLE') || (typeof IA_clave_ === 'function' ? IA_clave_('Gemini (Google)') : '');
  var filas = [], habilitados = [];
  if (!clave) filas.push(['Gemini', '—', '❌ No hay clave de Gemini guardada', '']);
  else {
    try { habilitados = TGM_listarGemini_(clave); } catch (e) { filas.push(['Gemini (lista)', '—', '❌ ' + e.message, '']); }
    var candidatos = TGM_CANDIDATOS_.slice();
    habilitados.filter(function (m) { return /^gemini-(\d+(\.\d+)?)-(flash|pro|argon)/.test(m) && !/(tts|image|live|embedding|preview-tts)/.test(m); })
      .slice(0, 12).forEach(function (m) { if (candidatos.indexOf(m) < 0) candidatos.push(m); });
    candidatos.forEach(function (m) {
      if (habilitados.length && habilitados.indexOf(m) < 0) { filas.push([m, '—', '⚪ No habilitado para su clave', '']); return; }
      var r = TGM_probarGemini_(clave, m);
      filas.push([m, r.ms != null ? (r.ms / 1000).toFixed(1) + ' s' : '—', r.ok ? '✅ Responde' : (r.codigo === 503 ? '🟠 Saturado (503)' : r.codigo === 429 ? '🟠 Sin cuota (429)' : '❌ ' + r.error), r.ok ? '' : String(r.detalle || '').slice(0, 120)]);
      Utilities.sleep(800);
    });
  }
  var groq = props.getProperty(TGM_PROP_GROQ_);
  if (!groq) filas.push(['Groq Whisper (audios)', '—', '⚪ Sin clave (menú 🤖 Telegram → 🎤 Clave de Groq)', '']);
  else {
    var g = TGM_probarGroq_(groq);
    filas.push(['Groq Whisper (audios)', g.ms != null ? (g.ms / 1000).toFixed(1) + ' s' : '—', g.ok ? '✅ Clave válida · ' + g.whisper.join(', ') : '❌ ' + g.error, '']);
  }
  props.setProperty('TGM_ULTIMA_PRUEBA', JSON.stringify({ fecha: new Date().toISOString(), filas: filas }).slice(0, 8000));
  var esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  return '<div style="font:13px Arial">' +
    '<p>Prueba hecha ahora con sus claves. Repítala a distintas horas: la saturación cambia durante el día.</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr style="background:#1a237e;color:#fff"><th style="padding:4px;text-align:left">Modelo</th><th>Tiempo</th><th style="text-align:left">Resultado</th><th style="text-align:left">Detalle</th></tr>' +
    filas.map(function (f) { return '<tr style="border-bottom:1px solid #ddd"><td style="padding:4px">' + esc(f[0]) + '</td><td style="text-align:center">' + esc(f[1]) + '</td><td>' + esc(f[2]) + '</td><td style="color:#777;font-size:11px">' + esc(f[3]) + '</td></tr>'; }).join('') +
    '</table>' +
    (habilitados.length ? '<p style="color:#555;font-size:11px">Modelos Gemini habilitados para su clave (' + habilitados.length + '): ' + esc(habilitados.join(', ')) + '</p>' : '') +
    '<p>Mande una captura de esta ventana para elegir la cadena de modelos.</p></div>';
}

function TGM_listarGemini_(clave) {
  var out = [], token = '';
  for (var i = 0; i < 5; i++) {
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : ''),
      { headers: { 'x-goog-api-key': clave }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
    var d = JSON.parse(r.getContentText());
    (d.models || []).forEach(function (m) {
      if ((m.supportedGenerationMethods || []).indexOf('generateContent') >= 0) out.push(String(m.name).replace(/^models\//, ''));
    });
    token = d.nextPageToken;
    if (!token) break;
  }
  return out.sort();
}

function TGM_probarGemini_(clave, modelo) {
  var t0 = Date.now();
  try {
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': clave },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde solo: OK' }] }], generationConfig: { maxOutputTokens: 20, temperature: 0 } })
    });
    var cod = r.getResponseCode(), ms = Date.now() - t0;
    if (cod === 200) return { ok: true, ms: ms };
    var err = {};
    try { err = JSON.parse(r.getContentText()).error || {}; } catch (e) {}
    return { ok: false, ms: ms, codigo: cod, error: 'HTTP ' + cod, detalle: err.message || '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function TGM_probarGroq_(clave) {
  var t0 = Date.now();
  try {
    var r = UrlFetchApp.fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + clave }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return { ok: false, error: 'HTTP ' + r.getResponseCode() };
    var ids = (JSON.parse(r.getContentText()).data || []).map(function (m) { return m.id; });
    return { ok: true, ms: Date.now() - t0, whisper: ids.filter(function (id) { return /whisper/i.test(id); }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
