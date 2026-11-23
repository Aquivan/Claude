/**
 * 🤖 IA DE CADA TAREA, con respaldo automático (como 🧾 lectores de vouchers, pero para todo lo demás).
 *   Parte 1: 🎤 audios (notas de voz → texto) y 🔎 RUC por internet.
 *     · 🎤 Audios: Gemini (entiende audio) → si falla, Groq Whisper (hecho para transcribir; usa la clave de Groq 🎤).
 *     · 🔎 RUC por internet: Gemini con búsqueda de Google → si falla, Groq con búsqueda web (modelos gpt-oss / compound).
 *   El orden, prender/apagar y el modelo de cada uno se eligen en Telegram con /ia (o en la hoja: 🧠 Asistente IA →
 *   🤖 IA de cada tarea). Los vouchers siguen en /lectores (es la fila 🧾 del mismo panel).
 *   Uso de hoy por tarea y proveedor (IAT_USO). El 🔭 vigía (TG_Vigia.js) también avisa de modelos nuevos de voz y de búsqueda.
 * Funciones IAT_.
 */

var IAT_PROP_ = 'IAT_CFG';
var IAT_TAREAS_ = {
  audio: { nom: '🎤 Audios (notas de voz)', provs: ['gemini', 'groq'] },
  ruc: { nom: '🔎 RUC por internet', provs: ['gemini', 'groq'] },
};
var IAT_NOMPROV_ = { gemini: 'Gemini', groq: 'Groq', nvidia: 'NVIDIA' };
var IAT_RX_ = /^\s*\/?ia(\s|$)/i;

/* ------------------------------------------------ configuración */

function IAT_cfg_(t) {
  var todo = {};
  try { todo = JSON.parse(PropertiesService.getScriptProperties().getProperty(IAT_PROP_) || '{}') || {}; } catch (e) {}
  var c = todo[t] || {}, provs = IAT_TAREAS_[t].provs;
  var orden = (c.orden || provs).filter(function (p) { return provs.indexOf(p) >= 0; });
  provs.forEach(function (p) { if (orden.indexOf(p) < 0) orden.push(p); });
  var modelo = {};
  provs.forEach(function (p) { modelo[p] = (c.modelo && c.modelo[p]) ? String(c.modelo[p]) : ''; });   // '' = automático
  return { orden: orden, apagados: (c.apagados || []).filter(function (p) { return provs.indexOf(p) >= 0; }), modelo: modelo };
}

function IAT_guardar_(t, c) {
  var props = PropertiesService.getScriptProperties(), todo = {};
  try { todo = JSON.parse(props.getProperty(IAT_PROP_) || '{}') || {}; } catch (e) {}
  todo[t] = c;
  props.setProperty(IAT_PROP_, JSON.stringify(todo));
}

/** Proveedores prendidos, en orden. */
function IAT_orden_(t) { var c = IAT_cfg_(t); return c.orden.filter(function (p) { return c.apagados.indexOf(p) < 0; }); }

function IAT_uso_(t, p, nota) {
  try {
    var props = PropertiesService.getScriptProperties(), hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd'), u = {};
    try { u = JSON.parse(props.getProperty('IAT_USO') || '{}'); } catch (e) {}
    if (u.dia !== hoy) u = { dia: hoy };
    u[t] = u[t] || {}; u[t][p] = (u[t][p] || 0) + 1;
    if (nota) u[t].ultimo = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' ' + String(nota).slice(0, 160);
    props.setProperty('IAT_USO', JSON.stringify(u));
  } catch (e) {}
}

/* ------------------------------------------------ modelos de cada proveedor */

function IAT_groqModelos_() {
  var k = TGNV_groqClave_();
  if (!k) throw new Error('falta la clave de Groq (menú 🤖 Telegram → 🎤 Clave de Groq)');
  var c = CacheService.getScriptCache(), t = c.get('iat_groq_ids');
  if (t) return JSON.parse(t);
  var r = UrlFetchApp.fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + k }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Groq respondió ' + r.getResponseCode() + ' al pedir sus modelos');
  var ids = (JSON.parse(r.getContentText()).data || []).map(function (x) { return String(x.id); });
  c.put('iat_groq_ids', JSON.stringify(ids), 3600);
  return ids;
}

/** Modelos que sirven para la tarea t y el proveedor p (para elegir en 🔧 y para el 🔭 vigía). */
function IAT_listaModelos_(t, p) {
  if (p === 'groq') {
    var ids = IAT_groqModelos_();
    if (t === 'audio') return ids.filter(function (id) { return /whisper/i.test(id); }).sort();
    return ids.filter(function (id) { return /gpt-oss|compound/i.test(id); }).sort().reverse();
  }
  // Gemini: los que entienden audio / buscan en internet son los Flash y Pro de texto
  var k = PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)');
  var rm = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=300', { headers: { 'x-goog-api-key': k }, muteHttpExceptions: true });
  return (JSON.parse(rm.getContentText()).models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
    .map(function (m) { return String(m.name).replace(/^models\//, ''); })
    .filter(function (id) { return /^gemini-\d/.test(id) && !/tts|image|embed|live|thinking|exp|robotics|computer|transcribe|omni|nano|decision/i.test(id); })
    .sort().reverse().slice(0, 12);
}

/** Modelo a usar: el elegido o el automático. */
function IAT_modelo_(t, p) {
  var m = IAT_cfg_(t).modelo[p];
  if (m) return m;
  if (p === 'groq') {
    var l = IAT_listaModelos_(t, 'groq');
    if (t === 'audio') return l.filter(function (x) { return /large-v3$/.test(x); })[0] || l.filter(function (x) { return /large/.test(x); })[0] || l[0] || 'whisper-large-v3';
    return l.filter(function (x) { return /gpt-oss-120b/.test(x); })[0] || l.filter(function (x) { return /gpt-oss/.test(x); })[0] || l[0] || 'openai/gpt-oss-120b';
  }
  return '';   // Gemini automático: lo de siempre de cada función
}

/* ------------------------------------------------ 🎤 audios */

/** Nota de voz → texto, con respaldo. Lo usan Telegram, WhatsApp, guías y entregas (TG_transcribir_). */
function IAT_transcribir_(blob) {
  var orden = IAT_orden_('audio'), fallas = [], ultimo = null;
  if (!orden.length) orden = ['gemini'];
  for (var i = 0; i < orden.length; i++) {
    var p = orden[i];
    try {
      var txt = p === 'groq' ? IAT_audioGroq_(blob) : IAT_audioGemini_(blob);
      IAT_uso_('audio', p, fallas.length ? 'leyó ' + IAT_NOMPROV_[p] + ' (antes falló: ' + fallas.join(' | ') + ')' : '');
      return txt;
    } catch (e) {
      ultimo = e; fallas.push(IAT_NOMPROV_[p] + ': ' + String(e.message || e).slice(0, 80));
      console.warn('Audio con ' + p + ' falló: ' + (e.message || e));
    }
  }
  IAT_uso_('audio', 'fallos', '❌ ninguno pudo: ' + fallas.join(' | '));
  throw ultimo || new Error('no se pudo transcribir');
}

function IAT_audioGemini_(blob) {
  var clave = PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)');
  if (!clave) throw new Error('para entender audios hace falta la clave de Gemini (pestaña 🧠 Asistente IA → 🔑).');
  var mime = blob.getContentType();
  if (!/^audio\//.test(mime)) mime = 'audio/ogg';
  var t = IA_llamar_({ proveedor: 'Gemini (Google)', clave: clave, json: false, maxTokens: 1500, modelo: IAT_cfg_('audio').modelo.gemini || '',
    sistema: 'Transcribe exactamente lo que dice el audio, en español de Perú, sin agregar nada. Si no se entiende nada responde vacío.',
    texto: 'Transcribe este audio.', adjunto: { mime: mime, base64: Utilities.base64Encode(blob.getBytes()) } });
  return String(t || '').replace(/^["“]|["”]$/g, '').trim();
}

function IAT_audioGroq_(blob) {
  var k = TGNV_groqClave_();
  if (!k) throw new Error('falta la clave de Groq');
  var nom = String(blob.getName() || '');
  if (!/\.\w{2,4}$/.test(nom)) blob = blob.copyBlob().setName('voz.' + ((/mpeg|mp3/.test(blob.getContentType())) ? 'mp3' : /wav/.test(blob.getContentType()) ? 'wav' : /mp4|m4a/.test(blob.getContentType()) ? 'm4a' : 'ogg'));
  var r = UrlFetchApp.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'post', headers: { Authorization: 'Bearer ' + k }, muteHttpExceptions: true,
    payload: { file: blob, model: IAT_modelo_('audio', 'groq'), language: 'es', response_format: 'json', temperature: '0' } });
  if (r.getResponseCode() !== 200) throw new Error('Groq respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 150));
  return String(JSON.parse(r.getContentText()).text || '').trim();
}

/* ------------------------------------------------ 🔎 RUC por internet con Groq (búsqueda web) */

/** nombres → {nombre: {ruc, nombre, fuente} | null}. Los que fallaron (error de Groq) NO vienen: siguen pendientes. */
function IAT_rucGroq_(nombres) {
  var out = {}, k = TGNV_groqClave_();
  if (!k || !nombres.length) return out;
  var modelo = IAT_modelo_('ruc', 'groq'), compound = /compound/i.test(modelo), n = 0;
  nombres.slice(0, 10).forEach(function (nombre) {
    if (n++) Utilities.sleep(1500);
    var pedido = 'Busca en internet el RUC (Perú, SUNAT, 11 dígitos) de: "' + nombre + '". Puede ser una empresa o una persona con negocio. ' +
      'Responde SOLO JSON: {"ruc":"11 dígitos o vacío","nombre":"razón social tal como figura","fuente":"página donde lo viste (dominio)","seguro":true|false}. ' +
      'Si es una sigla o nombre comercial (ej. SUNAT, DSM), busca la razón social que le corresponde. ' +
      'Si hay varias personas o empresas con nombre parecido y no puedes distinguir, seguro=false. No inventes.';
    var carga = { model: modelo, temperature: 0, max_tokens: 2000, messages: [{ role: 'user', content: pedido }] };
    if (!compound) carga.tools = [{ type: 'browser_search' }];   // gpt-oss: búsqueda web incorporada de Groq (compound ya la trae)
    try {
      var r = UrlFetchApp.fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + k }, payload: JSON.stringify(carga), muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) { console.warn('RUC Groq ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 150)); return; }
      var ch = (JSON.parse(r.getContentText()).choices || [])[0] || {}, t = String((ch.message || {}).content || '');
      var j = t ? IA_extraerJson_(t) : null, ruc = j ? String(j.ruc || '').replace(/\D/g, '') : '';
      out[nombre] = ruc && TGQ_rucValido_(ruc) && j.seguro !== false ? { ruc: ruc, nombre: String(j.nombre || ''), fuente: 'Groq · ' + String(j.fuente || '').slice(0, 70) } : null;
    } catch (e) { console.warn('RUC Groq: ' + e.message); }
  });
  return out;
}

/* ------------------------------------------------ Telegram: /ia */

function IAT_tg_(ctx, texto) {
  if (!IAT_RX_.test(texto || '')) return false;
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return false;
  try { IAT_panel_(ctx); } catch (e) { TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
  return true;
}

function IAT_textoPanel_() {
  var u = {}, L = ['🤖 <b>IA de cada tarea</b> (si la primera falla, pasa a la siguiente al momento)', ''];
  try { u = JSON.parse(PropertiesService.getScriptProperties().getProperty('IAT_USO') || '{}'); } catch (e) {}
  if (u.dia !== Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd')) u = {};
  // 🧾 vouchers: su propio panel
  var lc = LECT_cfg_(), act = lc.orden.filter(function (p) { return lc.apagados.indexOf(p) < 0; });
  L.push('<b>🧾 Vouchers</b>: ' + act.map(function (p) { return IAT_NOMPROV_[p] + (lc.modelo[p] ? ' <code>' + TG_esc_(lc.modelo[p].split('/').pop()) + '</code>' : ''); }).join(' → ') + ' · <i>se cambia en /lectores</i>');
  Object.keys(IAT_TAREAS_).forEach(function (t) {
    var c = IAT_cfg_(t), n = 0, ut = u[t] || {};
    L.push('', '<b>' + IAT_TAREAS_[t].nom + '</b>');
    c.orden.forEach(function (p) {
      var off = c.apagados.indexOf(p) >= 0, m = c.modelo[p];
      L.push('  ' + (off ? '⏸ ' : (++n) + '. ') + IAT_NOMPROV_[p] + ' · <code>' + TG_esc_(m || 'automático') + '</code>' + (off ? ' <i>(apagado)</i>' : '') + (ut[p] ? ' · hoy ' + ut[p] : ''));
    });
    if (ut.fallos) L.push('  ❌ hoy ninguno pudo: ' + ut.fallos);
    if (ut.ultimo) L.push('  <i>Último respaldo: ' + TG_esc_(ut.ultimo) + '</i>');
  });
  if (!TGNV_groqClave_()) L.push('', '⚠️ Falta la clave de Groq: sin ella no hay respaldo (menú 🤖 Telegram → 🎤 Clave de Groq).');
  L.push('', '<i>🔎 RUC con Groq usa su búsqueda web (modelos gpt-oss o compound). 🎤 Audios con Groq usa Whisper, hecho para transcribir. El 🔭 vigía (/modelos) avisa si salen modelos nuevos.</i>');
  return L.join('\n');
}

function IAT_teclado_() {
  var b = function (t, d) { return { text: t, callback_data: 'k:' + TG_guardarBoton_(d, 21600) }; }, filas = [[b('🧾 Vouchers → /lectores', { t: 'iat', a: 'lectores' })]];
  Object.keys(IAT_TAREAS_).forEach(function (t) {
    var c = IAT_cfg_(t), corto = IAT_TAREAS_[t].nom.split(' ')[0];
    c.orden.forEach(function (p, i) {
      var off = c.apagados.indexOf(p) >= 0, fila = [];
      if (i > 0) fila.push(b(corto + ' ⬆️ ' + IAT_NOMPROV_[p], { t: 'iat', a: 'subir', tarea: t, p: p }));
      fila.push(b(corto + (off ? ' ▶ ' : ' ⏸ ') + IAT_NOMPROV_[p], { t: 'iat', a: 'onoff', tarea: t, p: p }));
      fila.push(b(corto + ' 🔧 ' + IAT_NOMPROV_[p], { t: 'iat', a: 'modelos', tarea: t, p: p }));
      filas.push(fila);
    });
  });
  return filas;
}

function IAT_panel_(ctx, aviso, editar) {
  var html = (aviso ? aviso + '\n\n' : '') + IAT_textoPanel_();
  if (editar && ctx.msgId && TG_editar_(ctx.chatId, ctx.msgId, html, IAT_teclado_())) return;
  TG_enviar_(ctx.chatId, html, IAT_teclado_());
}

function IAT_alBoton_(ctx, d) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  if (d.a === 'lectores') return LECT_panel_(ctx);
  var t = d.tarea, p = d.p;
  if (!IAT_TAREAS_[t] || IAT_TAREAS_[t].provs.indexOf(p) < 0) return;
  var c = IAT_cfg_(t);
  try {
    if (d.a === 'modelos') {
      TG_accion_(ctx.chatId, 'typing');
      var ids = IAT_listaModelos_(t, p);
      var b = function (tx, x) { return [{ text: tx, callback_data: 'k:' + TG_guardarBoton_(x, 21600) }]; };
      var tecl = [b('🤖 Automático' + (!c.modelo[p] ? ' ✓' : ''), { t: 'iat', a: 'modelo', tarea: t, p: p, m: '' })]
        .concat(ids.slice(0, 12).map(function (id) { return b((c.modelo[p] === id ? '✓ ' : '') + id.slice(0, 55), { t: 'iat', a: 'modelo', tarea: t, p: p, m: id }); }));
      return TG_enviar_(ctx.chatId, '🔧 <b>' + IAT_TAREAS_[t].nom + ' · ' + IAT_NOMPROV_[p] + '</b> (ahora: <code>' + TG_esc_(c.modelo[p] || 'automático') + '</code>). Toque uno:', tecl);
    }
    if (d.a === 'subir') { var i = c.orden.indexOf(p); if (i > 0) { c.orden.splice(i, 1); c.orden.splice(i - 1, 0, p); } c.apagados = c.apagados.filter(function (x) { return x !== p; }); }
    else if (d.a === 'onoff') {
      if (c.apagados.indexOf(p) >= 0) c.apagados = c.apagados.filter(function (x) { return x !== p; });
      else {
        if (c.orden.filter(function (x) { return x !== p && c.apagados.indexOf(x) < 0; }).length === 0) return TG_enviar_(ctx.chatId, '⚠️ Debe quedar al menos uno prendido.');
        c.apagados.push(p);
      }
    } else if (d.a === 'modelo') {
      c.modelo[p] = d.m || '';
      IAT_guardar_(t, c);
      return IAT_panel_(ctx, '✅ ' + IAT_TAREAS_[t].nom + ': ' + IAT_NOMPROV_[p] + ' usará <code>' + TG_esc_(d.m || 'automático') + '</code>.');
    } else return;
    c.orden = c.orden.filter(function (x) { return c.apagados.indexOf(x) < 0; }).concat(c.orden.filter(function (x) { return c.apagados.indexOf(x) >= 0; }));
    IAT_guardar_(t, c);
    IAT_panel_(ctx, '✅ Guardado.', true);
  } catch (e) { TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
}

/* ------------------------------------------------ hoja: 🧠 Asistente IA → 🤖 IA de cada tarea (IATVista.html) */

function IAT_menuAbrir() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('IATVista').setWidth(620).setHeight(520), '🤖 IA de cada tarea');
}
function IAT_ver() {
  var u = {};
  try { u = JSON.parse(PropertiesService.getScriptProperties().getProperty('IAT_USO') || '{}'); } catch (e) {}
  if (u.dia !== Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd')) u = {};
  var tareas = {};
  Object.keys(IAT_TAREAS_).forEach(function (t) { tareas[t] = { nom: IAT_TAREAS_[t].nom, cfg: IAT_cfg_(t), uso: u[t] || {} }; });
  var lc = LECT_cfg_();
  return { tareas: tareas, nombres: IAT_NOMPROV_, groq: !!TGNV_groqClave_(),
    vouchers: lc.orden.filter(function (p) { return lc.apagados.indexOf(p) < 0; }).map(function (p) { return IAT_NOMPROV_[p] + (lc.modelo[p] ? ' ' + lc.modelo[p].split('/').pop() : ''); }).join(' → ') };
}
function IAT_guardarHoja(n, quien) {
  Object.keys(IAT_TAREAS_).forEach(function (t) {
    var x = n && n[t]; if (!x) return;
    var provs = IAT_TAREAS_[t].provs, c = IAT_cfg_(t);
    var orden = (x.orden || []).filter(function (p, i, a) { return provs.indexOf(p) >= 0 && a.indexOf(p) === i; });
    provs.forEach(function (p) { if (orden.indexOf(p) < 0) orden.push(p); });
    var ap = (x.apagados || []).filter(function (p) { return provs.indexOf(p) >= 0; });
    if (orden.filter(function (p) { return ap.indexOf(p) < 0; }).length === 0) throw new Error(IAT_TAREAS_[t].nom + ': debe quedar al menos uno prendido.');
    provs.forEach(function (p) {
      var m = x.modelo && x.modelo[p] != null ? String(x.modelo[p]).trim() : c.modelo[p];
      if (m && !/^[\w.\-\/:]{2,120}$/.test(m)) throw new Error('Nombre de modelo no válido: ' + m);
      c.modelo[p] = m || '';
    });
    c.orden = orden.filter(function (p) { return ap.indexOf(p) < 0; }).concat(orden.filter(function (p) { return ap.indexOf(p) >= 0; }));
    c.apagados = ap;
    IAT_guardar_(t, c);
  });
  console.log('🤖 IA de cada tarea cambiada desde la hoja por ' + (quien || Session.getActiveUser().getEmail() || '?'));
  return IAT_ver();
}
function IAT_modelosHoja(t, p) {
  if (!IAT_TAREAS_[t] || IAT_TAREAS_[t].provs.indexOf(p) < 0) throw new Error('Tarea o proveedor desconocido.');
  return IAT_listaModelos_(t, p);
}

/* ------------------------------------------------ 🔭 para el vigía: modelos nuevos de voz y de búsqueda (Groq) */

/** → ['🎤 Audios · Groq whisper-xyz', …] nuevos desde la última vez (la primera vez solo los anota). Gemini ya lo cubre el vigía de vouchers. */
function IAT_nuevos_() {
  var props = PropertiesService.getScriptProperties(), vistos = null, out = [], ahora = {};
  try { vistos = JSON.parse(props.getProperty('IAT_VISTOS') || 'null'); } catch (e) {}
  Object.keys(IAT_TAREAS_).forEach(function (t) {
    try { ahora[t] = IAT_listaModelos_(t, 'groq'); } catch (e) { return; }
    if (vistos && vistos[t]) ahora[t].forEach(function (m) { if (vistos[t].indexOf(m) < 0) out.push(IAT_TAREAS_[t].nom + ' · Groq <code>' + m + '</code>'); });
  });
  var g = vistos || {};
  Object.keys(ahora).forEach(function (t) { g[t] = ahora[t]; });
  props.setProperty('IAT_VISTOS', JSON.stringify(g));
  return out;
}
