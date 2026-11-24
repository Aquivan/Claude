/**
 * ➕ IA NUEVAS para leer vouchers (cualquier servicio «compatible con OpenAI»: OpenRouter, Mistral, DeepSeek, Together,
 * Cerebras, SambaNova, Fireworks, Gemini de pago por su dirección compatible…). Se agregan pegando sus datos, sin programar:
 *   Telegram: /lectores → ➕ Agregar IA → pegar «nombre / url / modelo / clave» (el mensaje se borra: la clave no queda en el chat).
 *   Hoja: 🧠 Asistente IA → 🧾 Lectores de vouchers → ➕ Agregar IA (Cobranzas y Vouchers; en Vouchers por el canal vch).
 * Antes de guardar se PRUEBA: que responda y si lee imágenes (los vouchers son imágenes; si no lee, queda apagada).
 * Quedan como un lector más en /lectores: ⬆️ orden, ⏸ apagar, 🔧 modelos (varios en orden) y 🗑 quitar.
 * Se guardan: lista en la propiedad LECT_EXTRA (sin claves) y cada clave aparte en LECT_KEY_<id>. Nunca se muestran.
 * Ids: x1, x2… La hoja de Vouchers las recibe con su url en LECT_paraVouchers_ (Lectores.js de esa hoja usa c.url).
 */

var LECT_EXTRA_PROP_ = 'LECT_EXTRA';
var LECT_EXTRAS_LISTOS_ = false;
var LECT_MAX_EXTRAS_ = 6;

function LECT_extras_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(LECT_EXTRA_PROP_) || '[]'); } catch (e) { return []; }
}
function LECT_claveExtra_(id) { return PropertiesService.getScriptProperties().getProperty('LECT_KEY_' + id) || ''; }
function LECT_esExtra_(p) { return /^x\d+$/.test(String(p || '')); }
function LECT_extra_(id) { return LECT_extras_().filter(function (x) { return x.id === id; })[0] || null; }

/** Suma las IA agregadas a los nombres y modelos por defecto de esta ejecución (lo llama LECT_cfg_). */
function LECT_cargarExtras_() {
  if (LECT_EXTRAS_LISTOS_) return;
  LECT_EXTRAS_LISTOS_ = true;
  LECT_extras_().forEach(function (x) { LECT_NOMBRES_[x.id] = x.nombre; LECT_MODELO_DEF_[x.id] = x.modelo; });
}

/** «nombre: X / url: … / modelo: … / clave: …» (una por línea; acepta name, base, endpoint, model, key, api key, token). */
function LECT_parsearAlta_(texto) {
  var d = {};
  String(texto || '').split(/\r?\n/).forEach(function (l) {
    var m = l.match(/^\s*([\wáéíóú ]+?)\s*[:=]\s*(.+?)\s*$/i);
    if (!m) return;
    var k = m[1].toLowerCase().trim(), v = m[2].trim();
    if (/^(nombre|name|servicio)$/.test(k)) d.nombre = v;
    else if (/^(url|base|base url|endpoint|direcci[oó]n)$/.test(k)) d.url = v;
    else if (/^(modelo|model)$/.test(k)) d.modelo = v;
    else if (/^(clave|key|api ?key|token|llave)$/.test(k)) d.clave = v;
  });
  return d;
}

function LECT_urlBase_(url) {
  var u = String(url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (!/^https:\/\/[\w.-]+(:\d+)?(\/[\w.\-\/]*)?$/.test(u)) throw new Error('La url no es válida (debe empezar con https:// y ser la dirección «base», p. ej. https://openrouter.ai/api/v1).');
  return u;
}

// PNG 16×16 de un solo color: para ver si el modelo acepta imágenes (sin mandar ningún voucher real).
var LECT_PNG_PRUEBA_ = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGM4ISdHEmIY1TCqYfhqAADkYgQQ60fIxgAAAABJRU5ErkJggg==';

/** Prueba la IA: ¿responde? ¿lee imágenes? → {ok, vision, seg, error} */
function LECT_probarExtra_(url, modelo, clave) {
  var t0 = Date.now(), hdr = { Authorization: 'Bearer ' + clave };
  var pedir = function (contenido) {
    return UrlFetchApp.fetch(url + '/chat/completions', { method: 'post', contentType: 'application/json', headers: hdr, muteHttpExceptions: true,
      payload: JSON.stringify({ model: modelo, max_tokens: 20, temperature: 0, messages: [{ role: 'user', content: contenido }] }) });
  };
  var r = pedir('Responde solo: ok'), code = r.getResponseCode();
  if (code !== 200) {
    var msg = ''; try { var j = JSON.parse(r.getContentText()); msg = (j.error && (j.error.message || j.error)) || ''; } catch (e) { msg = r.getContentText(); }
    return { ok: false, error: 'HTTP ' + code + (code === 401 || code === 403 ? ' (clave inválida o sin permiso)' : code === 404 ? ' (url o modelo no existen)' : code === 429 ? ' (sin cupo ahora)' : '') + ': ' + String(msg).slice(0, 160) };
  }
  var seg = Math.round((Date.now() - t0) / 100) / 10;
  var rv = pedir([{ type: 'text', text: '¿De qué color es esta imagen? Una palabra.' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + LECT_PNG_PRUEBA_ } }]);
  return { ok: true, vision: rv.getResponseCode() === 200, seg: seg };
}

/** Agrega una IA (prueba antes). d = {nombre, url, modelo, clave} → {ok, id, vision, seg, texto} */
function LECT_agregarExtra_(d) {
  d = d || {};
  var nombre = String(d.nombre || '').trim().slice(0, 30), modelo = String(d.modelo || '').trim(), clave = String(d.clave || '').trim();
  if (!nombre || !d.url || !modelo || !clave) throw new Error('Faltan datos: se necesitan nombre, url, modelo y clave.');
  if (!/^[\w.\-\/:]{2,120}$/.test(modelo)) throw new Error('El nombre del modelo no es válido: ' + modelo);
  var url = LECT_urlBase_(d.url);
  var lista = LECT_extras_();
  if (lista.length >= LECT_MAX_EXTRAS_) throw new Error('Ya hay ' + LECT_MAX_EXTRAS_ + ' IA agregadas: quite una primero.');
  var pr = LECT_probarExtra_(url, modelo, clave);
  if (!pr.ok) throw new Error('No respondió: ' + pr.error + '. No se guardó nada.');
  var n = lista.reduce(function (m, x) { return Math.max(m, Number(String(x.id).slice(1)) || 0); }, 0) + 1, id = 'x' + n;
  lista.push({ id: id, nombre: nombre, url: url, modelo: modelo, vision: pr.vision });
  var props = PropertiesService.getScriptProperties();
  props.setProperty(LECT_EXTRA_PROP_, JSON.stringify(lista));
  props.setProperty('LECT_KEY_' + id, clave);
  LECT_EXTRAS_LISTOS_ = false;
  LECT_cargarExtras_();
  var cfg = LECT_cfg_();
  if (!pr.vision && cfg.apagados.indexOf(id) < 0) cfg.apagados.push(id);   // no lee imágenes: no sirve para vouchers (queda apagada)
  cfg.orden = cfg.orden.filter(function (x) { return cfg.apagados.indexOf(x) < 0; }).concat(cfg.orden.filter(function (x) { return cfg.apagados.indexOf(x) >= 0; }));
  LECT_guardar_(cfg);
  return { ok: true, id: id, vision: pr.vision, seg: pr.seg,
    texto: '✅ ' + nombre + ' agregada (respondió en ' + pr.seg + ' s). ' + (pr.vision ? 'Lee imágenes: quedó como un lector más, al final del orden.' : '⚠️ Este modelo NO lee imágenes: no sirve para vouchers y quedó apagado (sí podrá usarse para otras tareas de IA más adelante).') };
}

function LECT_quitarExtra_(id) {
  var lista = LECT_extras_(), x = lista.filter(function (e) { return e.id === id; })[0];
  if (!x) throw new Error('Esa IA ya no está.');
  var props = PropertiesService.getScriptProperties();
  props.setProperty(LECT_EXTRA_PROP_, JSON.stringify(lista.filter(function (e) { return e.id !== id; })));
  props.deleteProperty('LECT_KEY_' + id);
  var cfg = LECT_cfg_();
  cfg.orden = cfg.orden.filter(function (p) { return p !== id; });
  cfg.apagados = cfg.apagados.filter(function (p) { return p !== id; });
  delete cfg.modelo[id]; if (cfg.extra) delete cfg.extra[id];
  if (!cfg.orden.filter(function (p) { return cfg.apagados.indexOf(p) < 0; }).length) cfg.apagados = cfg.apagados.filter(function (p) { return p !== 'gemini'; });
  LECT_guardar_(cfg);
  delete LECT_NOMBRES_[id];
  return x.nombre;
}

/** Modelos que ofrece la IA agregada (su lista /models). */
function LECT_modelosExtra_(id) {
  var x = LECT_extra_(id);
  if (!x) return [];
  var r = UrlFetchApp.fetch(x.url + '/models', { headers: { Authorization: 'Bearer ' + LECT_claveExtra_(id) }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
  var j = JSON.parse(r.getContentText());
  var ids = (j.data || j.models || []).map(function (m) { return String(m.id || m.name || ''); }).filter(Boolean);
  var vis = ids.filter(function (s) { return /vl|vision|image|omni|gemini|gpt-4o|gpt-4\.1|gpt-5|pixtral|llava|qwen.*vl|claude|llama-4|gemma-3|gemma-4|mistral-medium|mistral-small/i.test(s); });
  return (vis.length ? vis : ids).slice(0, 30);
}

/* ------------------------------------------------ Telegram */

var LECT_TXT_ALTA_ = '➕ <b>Agregar una IA para leer vouchers</b>\n\nMande UN mensaje con estos 4 datos (uno por línea):\n' +
  '<code>nombre: OpenRouter\nurl: https://openrouter.ai/api/v1\nmodelo: qwen/qwen2.5-vl-72b-instruct\nclave: sk-xxxxxxxx</code>\n\n' +
  '• <b>url</b>: la dirección «base» compatible con OpenAI que da el servicio (suele terminar en /v1).\n' +
  '• <b>modelo</b>: uno que <b>lea imágenes</b> (los vouchers son fotos o páginas de PDF).\n' +
  '• La pruebo antes de guardarla y <b>borro su mensaje</b> para que la clave no quede en el chat.\n' +
  '<i>Sirve cualquier servicio «compatible con OpenAI»: OpenRouter, Mistral, DeepSeek, Together, Cerebras, SambaNova, Fireworks… Para cancelar, escriba «cancelar».</i>';

function LECT_altaPedirTG_(ctx) {
  var ses = TG_sesion_(ctx.chatId);
  ses.esperando = { tipo: 'lect_agregar' };
  TG_guardarSesion_(ctx.chatId, ses);
  TG_enviar_(ctx.chatId, LECT_TXT_ALTA_);
}

/** Respuesta con los datos (TG_alEsperado_). */
function LECT_altaTG_(ctx, texto) {
  if (/^\s*cancel/i.test(texto)) return TG_enviar_(ctx.chatId, 'Listo, no se agregó nada.');
  var d = LECT_parsearAlta_(texto);
  if (d.clave && ctx.msgId) { try { TG_borrar_(ctx.chatId, ctx.msgId); } catch (e) {} }   // 🔐 la clave no queda en el chat
  if (!d.nombre || !d.url || !d.modelo || !d.clave) {
    return TG_enviar_(ctx.chatId, '⚠️ Faltan datos (' + ['nombre', 'url', 'modelo', 'clave'].filter(function (k) { return !d[k]; }).join(', ') + '). ' +
      (d.clave ? 'Borré su mensaje por la clave. ' : '') + 'Toque ➕ Agregar IA de nuevo y mande los 4 datos.');
  }
  TG_accion_(ctx.chatId, 'typing');
  try {
    var r = LECT_agregarExtra_(d);
    LECT_panel_(Object.assign({}, ctx, { esBoton: false }), r.texto);
  } catch (e) { TG_enviar_(ctx.chatId, '❌ ' + TG_esc_(e.message)); }
}

/* ------------------------------------------------ hoja (LectoresVista.html) */

function LECT_agregarHoja(d) {
  var r = LECT_agregarExtra_(d);
  var v = LECT_ver(); v.aviso = r.texto; return v;
}
function LECT_quitarHoja(id) {
  var n = LECT_quitarExtra_(String(id || ''));
  var v = LECT_ver(); v.aviso = '🗑 ' + n + ' quitada.'; return v;
}
