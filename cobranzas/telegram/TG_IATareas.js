/**
 * 🤖 IA DE CADA TAREA, con respaldo automático (como 🧾 lectores de vouchers, pero para todo lo demás).
 *   Parte 1: 🎤 audios (notas de voz → texto) y 🔎 RUC por internet. Parte 2: 📄 documentos (guías GRE, procesar, importar):
 *     Gemini (o la IA principal de la hoja) → NVIDIA → Groq, que reciben las fotos y la 1.ª página de cada PDF como imagen.
 *   Partes 3 y 4: 📊 análisis y 💬 chat (todo lo que pasa por IA_llamarSeguro_, AnalistaIA.js, más auditor/conciliación/
 *     importar/entregas): Gemini (o la IA principal) → NVIDIA → Groq, solo texto. En el chat se avisa quién respondió.
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
  docs: { nom: '📄 Documentos (guías, procesar, importar)', provs: ['gemini', 'nvidia', 'groq'] },
  analisis: { nom: '📊 Análisis (auditor, conciliación, RUC, resúmenes)', provs: ['gemini', 'nvidia', 'groq'] },
  chat: { nom: '💬 Chat (Telegram, WhatsApp, hoja)', provs: ['gemini', 'nvidia', 'groq'] },
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
  if (t === 'docs' && p !== 'gemini') return LECT_listaModelos_(p);
  if ((t === 'analisis' || t === 'chat') && p === 'nvidia') {
    var rn = UrlFetchApp.fetch('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: 'Bearer ' + CIA_nvClave_() }, muteHttpExceptions: true });
    return (JSON.parse(rn.getContentText()).data || []).map(function (x) { return String(x.id); })
      .filter(function (id) { return /deepseek|kimi|qwen|nemotron|mistral|glm|gpt-oss|llama|minimax|gemma/i.test(id) && !/embed|rerank|guard|safety|reward|parse|clip|retriever|pii|vila|cosmos/i.test(id); })
      .sort().reverse().slice(0, 20);
  }
  if ((t === 'analisis' || t === 'chat') && p === 'groq') return IAT_groqModelos_().filter(function (id) { return !/whisper|guard|tts|playai|orpheus|prompt-guard/i.test(id); }).sort().reverse();   // los que leen imágenes (como en vouchers)
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
  if (t === 'analisis' || t === 'chat') {   // texto: NVIDIA = el de 🟩 /nvidia o Nemotron; Groq = gpt-oss-120b
    if (p === 'nvidia') return PropertiesService.getScriptProperties().getProperty('IA_NVIDIA_MODELO') || LECT_cfg_().modelo.nvidia || 'nvidia/nemotron-3.5-super-vl-120b-a12b';
    if (p === 'groq') { var lg = IAT_listaModelos_('ruc', 'groq').filter(function (x) { return /gpt-oss/.test(x); }); return lg.filter(function (x) { return /120b/.test(x); })[0] || lg[0] || 'openai/gpt-oss-120b'; }
  }
  if (t === 'docs') {
    if (p === 'nvidia') return LECT_cfg_().modelo.nvidia || 'nvidia/nemotron-3.5-super-vl-120b-a12b';
    if (p === 'groq') return TGNV_groqModelo_(TGNV_groqClave_());
  }
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

function IAT_usoHoy_() {
  var u = {};
  try { u = JSON.parse(PropertiesService.getScriptProperties().getProperty('IAT_USO') || '{}'); } catch (e) {}
  return u.dia === Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd') ? u : {};
}

/** Sin t: resumen de todas las tareas. Con t: el detalle de esa tarea. */
function IAT_textoPanel_(t) {
  var u = IAT_usoHoy_(), L = [];
  if (!t) {
    L.push('🤖 <b>IA de cada tarea</b> (si la primera falla, pasa a la siguiente al momento)', '');
    var lc = LECT_cfg_(), act = lc.orden.filter(function (p) { return lc.apagados.indexOf(p) < 0; });
    L.push('🧾 <b>Vouchers</b>: ' + act.map(function (p) { return IAT_NOMPROV_[p]; }).join(' → ') + ' <i>(/lectores)</i>');
    Object.keys(IAT_TAREAS_).forEach(function (x) {
      var o = IAT_orden_(x), ut = u[x] || {};
      var hoy = IAT_TAREAS_[x].provs.filter(function (p) { return ut[p]; }).map(function (p) { return IAT_NOMPROV_[p] + ' ' + ut[p]; }).join(', ');
      L.push(IAT_TAREAS_[x].nom.split(' (')[0] + ': ' + o.map(function (p) { return IAT_NOMPROV_[p]; }).join(' → ') + (hoy ? ' · hoy: ' + hoy : '') + (ut.fallos ? ' · ❌ ' + ut.fallos : ''));
    });
    if (!TGNV_groqClave_()) L.push('', '⚠️ Falta la clave de Groq: sin ella no hay respaldo (menú 🤖 Telegram → 🎤 Clave de Groq).');
    if (!CIA_nvClave_()) L.push('⚠️ Falta la clave de NVIDIA (mándela al bot: nvapi-…).');
    L.push('', '<i>Toque ⚙️ en una tarea para cambiar su orden, prenderla/apagarla o elegir el modelo. En el chat, si responde el respaldo, se avisa al final de la respuesta.</i>');
    return L.join('\n');
  }
  var c = IAT_cfg_(t), n = 0, ut = u[t] || {};
  L.push('<b>' + IAT_TAREAS_[t].nom + '</b>', '');
  c.orden.forEach(function (p) {
    var off = c.apagados.indexOf(p) >= 0;
    L.push((off ? '⏸ ' : (++n) + '. ') + IAT_NOMPROV_[p] + ' · <code>' + TG_esc_(c.modelo[p] || 'automático') + '</code>' + (off ? ' <i>(apagado)</i>' : '') + (ut[p] ? ' · hoy ' + ut[p] : ''));
  });
  if (ut.fallos) L.push('❌ hoy ninguno pudo: ' + ut.fallos);
  if (ut.ultimo) L.push('<i>Último respaldo: ' + TG_esc_(ut.ultimo) + '</i>');
  var notas = { audio: '🎤 Groq usa Whisper, hecho para transcribir.', ruc: '🔎 Groq usa su búsqueda web (modelos gpt-oss o compound).',
    docs: '📄 NVIDIA y Groq reciben las fotos y la 1.ª página de cada PDF como imagen.', analisis: '📊 Solo texto. «Gemini» = la IA principal elegida en la hoja.',
    chat: '💬 Si responde el respaldo, el chat lo avisa al final de la respuesta.' };
  L.push('', '<i>' + (notas[t] || '') + '</i>');
  return L.join('\n');
}

function IAT_teclado_(t) {
  var b = function (tx, d) { return { text: tx, callback_data: 'k:' + TG_guardarBoton_(d, 21600) }; };
  if (!t) {
    var filas = [[b('🧾 Vouchers → /lectores', { t: 'iat', a: 'lectores' })]];
    Object.keys(IAT_TAREAS_).forEach(function (x) { filas.push([b('⚙️ ' + IAT_TAREAS_[x].nom.split(' (')[0], { t: 'iat', a: 'tarea', tarea: x })]); });
    return filas;
  }
  var c = IAT_cfg_(t), out = [];
  c.orden.forEach(function (p, i) {
    var off = c.apagados.indexOf(p) >= 0, fila = [];
    if (i > 0) fila.push(b('⬆️ ' + IAT_NOMPROV_[p], { t: 'iat', a: 'subir', tarea: t, p: p }));
    fila.push(b((off ? '▶ Prender ' : '⏸ Apagar ') + IAT_NOMPROV_[p], { t: 'iat', a: 'onoff', tarea: t, p: p }));
    fila.push(b('🔧 Modelo', { t: 'iat', a: 'modelos', tarea: t, p: p }));
    out.push(fila);
  });
  out.push([b('⬅️ Todas las tareas', { t: 'iat', a: 'volver' })]);
  return out;
}

function IAT_panel_(ctx, aviso, editar, t) {
  var html = (aviso ? aviso + '\n\n' : '') + IAT_textoPanel_(t);
  if (editar && ctx.msgId && TG_editar_(ctx.chatId, ctx.msgId, html, IAT_teclado_(t))) return;
  TG_enviar_(ctx.chatId, html, IAT_teclado_(t));
}

function IAT_alBoton_(ctx, d) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  if (d.a === 'lectores') return LECT_panel_(ctx);
  if (d.a === 'volver') return IAT_panel_(ctx, '', true);
  if (d.a === 'tarea') return IAT_panel_(ctx, '', true, d.tarea);
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
      return IAT_panel_(ctx, '✅ ' + IAT_NOMPROV_[p] + ' usará <code>' + TG_esc_(d.m || 'automático') + '</code>.', false, t);
    } else return;
    c.orden = c.orden.filter(function (x) { return c.apagados.indexOf(x) < 0; }).concat(c.orden.filter(function (x) { return c.apagados.indexOf(x) >= 0; }));
    IAT_guardar_(t, c);
    IAT_panel_(ctx, '✅ Guardado.', true, t);
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
  ['audio', 'ruc'].forEach(function (t) {   // los que leen imágenes ya los vigila el 🔭 de vouchers
    try { ahora[t] = IAT_listaModelos_(t, 'groq'); } catch (e) { return; }
    if (vistos && vistos[t]) ahora[t].forEach(function (m) { if (vistos[t].indexOf(m) < 0) out.push(IAT_TAREAS_[t].nom + ' · Groq <code>' + m + '</code>'); });
  });
  var g = vistos || {};
  Object.keys(ahora).forEach(function (t) { g[t] = ahora[t]; });
  props.setProperty('IAT_VISTOS', JSON.stringify(g));
  return out;
}

/* ------------------------------------------------ 📄 documentos con respaldo (Parte 2) */

/**
 * fnPrincipal: la lectura de siempre (Gemini o la IA principal de la hoja), sin tocar.
 * opts: {sistema, texto, adjunto | adjuntos:[{mime, base64, etiqueta}] | adjuntosFn: () → adjuntos, maxTokens, json}: lo mismo, para los de respaldo.
 */
function IAT_docs_(fnPrincipal, opts) { return IAT_conRespaldo_('docs', fnPrincipal, opts); }

/** La tarea t con respaldo: fnPrincipal es lo de siempre; los demás reciben opts (con archivos → lectura de documentos; sin → texto). */
function IAT_conRespaldo_(t, fnPrincipal, opts) {
  var orden = IAT_orden_(t), fallas = [], ultimo = null, cache = CacheService.getScriptCache();
  if (!orden.length) orden = ['gemini'];
  // Si la principal falló hace poco (≤5 min), se va directo al respaldo y la principal queda al final (no se pierde tiempo).
  if (orden.length > 1 && orden[0] === 'gemini' && cache.get('iat_caido_' + t)) orden = orden.slice(1).concat(['gemini']);
  for (var i = 0; i < orden.length; i++) {
    var p = orden[i];
    try {
      var conArch = !!(opts.adjunto || opts.adjuntos || opts.adjuntosFn);
      var r = p === 'gemini' ? fnPrincipal() : conArch ? IAT_docProveedor_(p, opts, t) : IAT_textoProveedor_(t, p, opts);
      IAT_uso_(t, p, fallas.length ? 'respondió ' + IAT_NOMPROV_[p] + ' (antes falló: ' + fallas.join(' | ') + ')' : '');
      if (p !== 'gemini') {
        if (r && typeof r === 'object' && !Array.isArray(r)) r._leidoPor = IAT_NOMPROV_[p];
        if (t === 'chat') {   // en el chat se avisa quién respondió
          var aviso = '\n\n🤖 Respondió ' + IAT_NOMPROV_[p] + ' (respaldo): Gemini no estaba disponible.';
          if (typeof r === 'string') r += aviso; else if (r && typeof r.respuesta === 'string') r.respuesta += aviso;
        }
      }
      return r;
    } catch (e) {
      ultimo = e; fallas.push(IAT_NOMPROV_[p] + ': ' + String(e.message || e).slice(0, 80));
      console.warn(t + ' con ' + p + ' falló: ' + (e.message || e));
      if (p === 'gemini' && /\b(429|500|502|503|504)\b|overload|saturad|UNAVAILABLE|quota/i.test(String(e.message || e))) { try { cache.put('iat_caido_' + t, '1', 300); } catch (e2) {} }
    }
  }
  IAT_uso_(t, 'fallos', '❌ ninguno pudo: ' + fallas.join(' | '));
  throw ultimo || new Error('la IA no respondió');
}

/** NVIDIA o Groq (formato OpenAI): fotos tal cual (Groq: achicadas si son grandes), PDF → 1.ª página como imagen, audios → texto. */
function IAT_docProveedor_(p, opts, t) {
  var clave = p === 'nvidia' ? CIA_nvClave_() : TGNV_groqClave_();
  if (!clave) throw new Error('falta la clave de ' + IAT_NOMPROV_[p]);
  if (!opts.adjuntos && opts.adjuntosFn) opts.adjuntos = opts.adjuntosFn();   // se arman solo si hace falta el respaldo
  var adjs = opts.adjuntos || (opts.adjunto ? [opts.adjunto] : []), partes = [{ type: 'text', text: String(opts.texto || 'Analiza los archivos.') }];
  var maxImg = p === 'groq' ? 3 : 6, nImg = 0, notas = [];
  adjs.forEach(function (a, i) {
    var mime = String(a.mime || ''), etiqueta = a.etiqueta || ('Archivo ' + (i + 1));
    try {
      if (/^audio\//i.test(mime)) {
        partes.push({ type: 'text', text: 'Nota de voz de la persona (' + etiqueta + '): ' + IAT_transcribir_(Utilities.newBlob(Utilities.base64Decode(a.base64), mime, 'voz.ogg')) });
        return;
      }
      if (!/^image\/|pdf/i.test(mime)) return;
      if (nImg >= maxImg) { notas.push(etiqueta); return; }
      var b64 = a.base64, m = mime;
      if (/pdf/i.test(mime)) { b64 = IAT_vistaPrevia_(a.base64, 'application/pdf', 2048); m = 'image/jpeg'; etiqueta += ' (1.ª página del PDF)'; }
      else if (p === 'groq' && b64.length > 450000) { b64 = IAT_vistaPrevia_(a.base64, mime, 1280); m = 'image/jpeg'; }
      partes.push({ type: 'text', text: etiqueta + ':' });
      var img = { url: 'data:' + m + ';base64,' + b64 };
      if (p === 'nvidia') img.detail = 'high';
      partes.push({ type: 'image_url', image_url: img });
      nImg++;
    } catch (e) { partes.push({ type: 'text', text: etiqueta + ': no se pudo abrir (' + e.message + ').' }); }
  });
  if (notas.length) partes.push({ type: 'text', text: '(No se enviaron por límite de imágenes: ' + notas.join(', ') + ')' });
  var razonar = !!(LECT_cfg_().razonar || {})[p], json = opts.json !== false;
  var carga = { model: IAT_cfg_(t || 'docs').modelo[p] || IAT_modelo_('docs', p), temperature: 0.1,
    max_tokens: p === 'groq' ? (razonar ? 4000 : 2500) : (razonar ? 16000 : Math.max(Number(opts.maxTokens) || 4000, 4000)),
    messages: [{ role: 'system', content: (razonar ? '' : '/no_think\n') + String(opts.sistema || '') + (json ? '\nResponde SOLO JSON.' : '') }, { role: 'user', content: partes }] };
  if (p === 'nvidia' && !razonar) carga.chat_template_kwargs = { thinking: false, enable_thinking: false };
  var url = p === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions';
  var pedir = function () { return UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + clave }, payload: JSON.stringify(carga), muteHttpExceptions: true }); };
  var r = pedir(), code = r.getResponseCode(), cuerpo = r.getContentText();
  if (code === 400 && carga.chat_template_kwargs && /kwargs|template/i.test(cuerpo)) { delete carga.chat_template_kwargs; r = pedir(); code = r.getResponseCode(); cuerpo = r.getContentText(); }
  if (code === 400 && /detail/i.test(cuerpo)) {
    partes.forEach(function (x) { if (x.image_url) delete x.image_url.detail; });
    r = pedir(); code = r.getResponseCode(); cuerpo = r.getContentText();
  }
  if (code !== 200) throw new Error(IAT_NOMPROV_[p] + ' respondió ' + code + ': ' + cuerpo.slice(0, 120));
  var msg = ((JSON.parse(cuerpo).choices || [])[0] || {}).message || {};
  var texto = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!texto) { var raz = String(msg.reasoning_content || msg.reasoning || ''); texto = json ? raz.slice(Math.max(0, raz.lastIndexOf('{'))) : raz; }
  return json ? IA_extraerJson_(texto) : texto;
}

/** Imagen o PDF (base64) → JPG de «lado» px como máximo (vista previa de Drive; el archivo temporal se borra). */
function IAT_vistaPrevia_(base64, mime, lado) {
  var token = ScriptApp.getOAuthToken(), tmp = null;
  try {
    tmp = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(base64), mime, 'ia_respaldo_tmp'));
    var id = tmp.getId(), url = '', esperas = [700, 900, 1200, 1600, 2200, 3000];
    for (var i = 0; i < esperas.length && !url; i++) {
      Utilities.sleep(esperas[i]);
      try {
        var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=thumbnailLink', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
        if (r.getResponseCode() === 200) { var j = JSON.parse(r.getContentText()); if (j.thumbnailLink) url = j.thumbnailLink.replace(/=s\d+/, '=s' + lado); }
      } catch (e) {}
    }
    if (!url) url = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + lado;
    var img = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (img.getResponseCode() !== 200 || img.getBlob().getBytes().length < 2000) throw new Error('no se pudo convertir en imagen (HTTP ' + img.getResponseCode() + ')');
    return Utilities.base64Encode(img.getBlob().getBytes());
  } finally { if (tmp) { try { tmp.setTrashed(true); } catch (e) {} } }
}

/** Solo texto (análisis y chat) con NVIDIA o Groq (formato OpenAI). */
function IAT_textoProveedor_(t, p, opts) {
  var clave = p === 'nvidia' ? CIA_nvClave_() : TGNV_groqClave_();
  if (!clave) throw new Error('falta la clave de ' + IAT_NOMPROV_[p]);
  var razonar = !!(LECT_cfg_().razonar || {})[p], json = opts.json !== false;
  var carga = { model: IAT_modelo_(t, p), temperature: 0.2, max_tokens: Math.min(Math.max(Number(opts.maxTokens) || 2000, razonar ? 8000 : 1500), p === 'groq' ? 8000 : 16000),
    messages: [{ role: 'system', content: (razonar ? '' : '/no_think\n') + String(opts.sistema || '') + (json ? '\nResponde SOLO JSON.' : '') },
      { role: 'user', content: String(opts.texto || '') }] };
  if (p === 'nvidia' && !razonar) carga.chat_template_kwargs = { thinking: false, enable_thinking: false };
  var url = p === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions';
  var pedir = function () { return UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + clave }, payload: JSON.stringify(carga), muteHttpExceptions: true }); };
  var r = pedir(), code = r.getResponseCode(), cuerpo = r.getContentText();
  if (code === 400 && carga.chat_template_kwargs && /kwargs|template/i.test(cuerpo)) { delete carga.chat_template_kwargs; r = pedir(); code = r.getResponseCode(); cuerpo = r.getContentText(); }
  if (code !== 200) throw new Error(IAT_NOMPROV_[p] + ' respondió ' + code + ': ' + cuerpo.slice(0, 120));
  var msg = ((JSON.parse(cuerpo).choices || [])[0] || {}).message || {};
  var texto = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!texto) { var raz = String(msg.reasoning_content || msg.reasoning || ''); texto = json ? raz.slice(Math.max(0, raz.lastIndexOf('{'))) : raz; }
  if (!texto) throw new Error(IAT_NOMPROV_[p] + ' respondió vacío');
  return json ? IA_extraerJson_(texto) : texto;
}
