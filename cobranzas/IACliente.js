// ============================================================
// CLIENTE DE IA (comun) — una sola forma de llamar a cualquier IA.
// ------------------------------------------------------------
// Este mismo archivo existe igual en la hoja de Vouchers y en la de
// Cobranzas. Todas sus funciones empiezan con IA_ para no chocar con el
// resto del codigo.
//
// Las claves NUNCA se escriben en celdas ni en el codigo: se guardan en
// las Propiedades del script con el menu "🔑 Guardar clave de IA".
// Gemini, si no tiene clave propia, usa la del bot (GEMINI_API_KEY).
// ============================================================

// tipo 'gemini' = API propia de Google; 'openai' = formato estandar
// (/chat/completions) que aceptan Groq, Qwen, ChatGPT, DeepSeek, OpenRouter.
// El modelo se puede cambiar en la pestaña del asistente sin tocar codigo.
var IA_PROVEEDORES_ = {
  'Gemini (Google)':  { tipo: 'gemini', modelo: 'gemini-3.5-flash-lite', imagen: true, pdf: true, pausa: 4500 },
  'Groq':             { tipo: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions', modelo: 'openai/gpt-oss-20b', imagen: false, pausa: 2500 },
  'Qwen (Alibaba)':   { tipo: 'openai', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', modelo: 'qwen3.8-flash', imagen: true, pausa: 1000 },
  'OpenAI (ChatGPT)': { tipo: 'openai', url: 'https://api.openai.com/v1/chat/completions', modelo: 'gpt-5.4-nano', imagen: true, pausa: 1000 },
  'DeepSeek':         { tipo: 'openai', url: 'https://api.deepseek.com/chat/completions', modelo: 'deepseek-chat', imagen: false, pausa: 1000 },
  'OpenRouter':       { tipo: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions', modelo: 'qwen/qwen3.8-flash', imagen: true, pausa: 1500 },
};

function IA_nombresProveedores_() {
  return Object.keys(IA_PROVEEDORES_);
}

function IA_propClave_(proveedor) {
  return 'IA_KEY_' + String(proveedor).replace(/[^A-Za-z]/g, '').toUpperCase();
}

function IA_clave_(proveedor) {
  var p = PropertiesService.getScriptProperties();
  var k = p.getProperty(IA_propClave_(proveedor));
  if (!k && IA_PROVEEDORES_[proveedor] && IA_PROVEEDORES_[proveedor].tipo === 'gemini') k = p.getProperty('GEMINI_API_KEY');
  return k || '';
}

function IA_guardarClave_(proveedor, clave) {
  PropertiesService.getScriptProperties().setProperty(IA_propClave_(proveedor), String(clave).trim());
}

/**
 * Llama a la IA. opts = {proveedor, modelo, sistema, texto, adjunto:{base64,mime}|null,
 * json (default true), maxTokens}. Devuelve el objeto JSON (o el texto si json=false).
 */
function IA_llamar_(opts) {
  var prov = IA_PROVEEDORES_[opts.proveedor];
  if (!prov) throw new Error('Proveedor de IA desconocido: ' + opts.proveedor);
  var clave = opts.clave || IA_clave_(opts.proveedor);
  if (!clave) throw new Error('Falta la clave de ' + opts.proveedor + ' (menú 💼 Cobranzas → 🧠 Asistente IA → 🔑 Guardar clave de IA)');
  var modelo = String(opts.modelo || '').trim() || prov.modelo;
  var json = opts.json !== false;
  var maxTokens = opts.maxTokens || 1500;
  var url, carga, headers = {};

  if (prov.tipo === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent';
    headers['x-goog-api-key'] = clave;
    var partes = [{ text: opts.texto }];
    if (opts.adjunto) partes.push({ inline_data: { mime_type: opts.adjunto.mime, data: opts.adjunto.base64 } });
    carga = {
      systemInstruction: { parts: [{ text: opts.sistema }] },
      contents: [{ role: 'user', parts: partes }],
      generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, responseMimeType: json ? 'application/json' : 'text/plain' },
    };
  } else {
    url = prov.url;
    headers.Authorization = 'Bearer ' + clave;
    var contenido = opts.adjunto
      ? [{ type: 'text', text: opts.texto }, { type: 'image_url', image_url: { url: 'data:' + opts.adjunto.mime + ';base64,' + opts.adjunto.base64 } }]
      : opts.texto;
    carga = {
      model: modelo, temperature: 0.1, max_tokens: maxTokens,
      messages: [{ role: 'system', content: opts.sistema }, { role: 'user', content: contenido }],
    };
    if (json) carga.response_format = { type: 'json_object' };
  }

  var params = { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(carga), muteHttpExceptions: true };
  var resp, code;
  for (var intento = 0; intento < 2; intento++) {
    resp = UrlFetchApp.fetch(url, params);
    code = resp.getResponseCode();
    if (code === 429 || code >= 500) { Utilities.sleep(prov.pausa * 3); continue; }
    break;
  }
  if (code !== 200) {
    throw new Error('IA ' + opts.proveedor + ' respondió ' + code + ': ' + resp.getContentText().substring(0, 200));
  }
  var cuerpo = JSON.parse(resp.getContentText());
  var texto = '';
  if (prov.tipo === 'gemini') {
    var cand = (cuerpo.candidates || [])[0];
    texto = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
  } else {
    var ch = (cuerpo.choices || [])[0];
    texto = ch && ch.message ? (ch.message.content || '') : '';
  }
  if (!json) return String(texto).trim();
  return IA_extraerJson_(texto);
}

/** Saca el primer objeto {...} de un texto (algunas IA agregan texto alrededor). */
function IA_extraerJson_(texto) {
  var s = String(texto || '').replace(/```(json)?/gi, '');
  var i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i === -1 || j <= i) throw new Error('La IA no devolvió JSON: ' + s.substring(0, 120));
  try {
    return JSON.parse(s.substring(i, j + 1));
  } catch (e) {
    // A veces la IA agrega texto u otro bloque después: tomar solo el primer objeto completo.
    var nivel = 0, enTexto = false, escape = false;
    for (var k = i; k < s.length; k++) {
      var c = s.charAt(k);
      if (enTexto) {
        if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') enTexto = false;
      } else if (c === '"') enTexto = true;
      else if (c === '{') nivel++;
      else if (c === '}' && --nivel === 0) return JSON.parse(s.substring(i, k + 1));
    }
    throw e;
  }
}

/** RUC peruano valido (digito verificador) o DNI de 8 digitos. */
function IA_rucValido_(r) {
  r = String(r == null ? '' : r).replace(/\D/g, '');
  if (r.length === 8) return true;
  if (r.length !== 11 || !/^(10|15|16|17|20)/.test(r)) return false;
  var f = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], s = 0;
  for (var i = 0; i < 10; i++) s += Number(r.charAt(i)) * f[i];
  var d = 11 - (s % 11);
  if (d === 10) d = 0;
  if (d === 11) d = 1;
  return d === Number(r.charAt(10));
}

/** Encabezado normalizado: minusculas, sin tildes ni simbolos. */
function IA_normEnc_(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[º°ª.]/g, '').replace(/[^a-z0-9()/ ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Indice (0-based) de la primera columna que coincide (exacto, luego prefijo), o -1. */
function IA_col_(encabezados) {
  var norm = encabezados.map(IA_normEnc_);
  return function () {
    var i, a;
    for (a = 0; a < arguments.length; a++) {
      i = norm.indexOf(IA_normEnc_(arguments[a]));
      if (i !== -1) return i;
    }
    for (a = 0; a < arguments.length; a++) {
      var pref = IA_normEnc_(arguments[a]);
      for (i = 0; i < norm.length; i++) if (norm[i] && norm[i].indexOf(pref) === 0) return i;
    }
    return -1;
  };
}

/** Nombre de empresa normalizado (sin S.A.C., E.I.R.L., tildes ni simbolos). */
function IA_normNombre_(s) {
  if (!s) return '';
  return String(s).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9& ]/g, ' ')
    .replace(/\b(S A C|S A A|S A|E I R L|S R L|S C R L|SAC|SAA|SA|EIRL|SRL|SCRL|EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA|SOCIEDAD ANONIMA CERRADA|SOCIEDAD ANONIMA|SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA|SOCIEDAD DE RESPONSABILIDAD LIMITADA)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

var IA_PALABRAS_VACIAS_ = ['DEL', 'LOS', 'LAS', 'POR', 'PARA', 'CON', 'CIA', 'PAGO', 'PAG', 'TRANSF', 'TRANSFERENCIA', 'DEPOSITO', 'ABONO', 'CTA', 'CUENTA'];

function IA_tokens_(s) {
  return IA_normNombre_(s).split(' ').filter(function (t) { return t.length >= 3 && IA_PALABRAS_VACIAS_.indexOf(t) === -1; });
}

/** Parecido entre dos nombres, de 0 a 1. */
function IA_similitud_(a, b) {
  var ta = Array.isArray(a) ? a : IA_tokens_(a);
  var tb = Array.isArray(b) ? b : IA_tokens_(b);
  if (!ta.length || !tb.length) return 0;
  var comunes = ta.filter(function (t) { return tb.indexOf(t) !== -1; }).length;
  var s = comunes / Math.min(ta.length, tb.length);
  if (ta[0] === tb[0]) s += 0.2;
  return Math.min(1, s);
}

function IA_esFecha_(d) {
  return Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d.getTime());
}

function IA_fmtFecha_(d) {
  return IA_esFecha_(d) ? Utilities.formatDate(d, 'America/Lima', 'dd/MM/yyyy') : '';
}

function IA_aNumero_(v) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return 0;
  var s = String(v).replace(/[^\d.,-]/g, '');
  if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) s = s.replace(/,/g, '');
  else if (s.indexOf(',') !== -1) s = s.replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function IA_aFecha_(v) {
  if (IA_esFecha_(v)) return v;
  var m = String(v == null ? '' : v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = String(v == null ? '' : v).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

/** Evita que dos vueltas del asistente corran a la vez (sin usar el candado del resto del sistema). */
function IA_tomarTurno_() {
  var p = PropertiesService.getScriptProperties();
  var t = Number(p.getProperty('IA_EN_CURSO') || 0);
  if (Date.now() - t < 7 * 60000) return false;
  p.setProperty('IA_EN_CURSO', String(Date.now()));
  return true;
}

function IA_soltarTurno_() {
  PropertiesService.getScriptProperties().deleteProperty('IA_EN_CURSO');
}

/** Pide la clave del proveedor elegido y la guarda oculta en el script. */
function IA_pedirYGuardarClave_(proveedor) {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('🔑 Clave de ' + proveedor,
    'Pega aquí la clave (API key) de ' + proveedor + '.\nSe guarda oculta en el script; no queda en ninguna celda.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var k = String(r.getResponseText() || '').trim();
  if (!k) { ui.alert('No se guardó: la clave estaba vacía.'); return; }
  IA_guardarClave_(proveedor, k);
  ui.alert('Clave de ' + proveedor + ' guardada.');
}

/** Llamada minima para comprobar proveedor, modelo y clave. */
function IA_probar_(proveedor, modelo) {
  var t0 = Date.now();
  var r = IA_llamar_({ proveedor: proveedor, modelo: modelo, maxTokens: 200,
    sistema: 'Responde solo JSON.', texto: 'Responde exactamente {"ok": true, "saludo": "hola"}' });
  return '✅ ' + proveedor + ' respondió en ' + Math.round((Date.now() - t0) / 100) / 10 + ' s: ' + JSON.stringify(r);
}
