/**
 * 🧾 LECTORES DE VOUCHERS: qué IA lee los vouchers y en qué orden (respaldo automático).
 * Si el primero falla (saturado, sin cupo, caído), la hoja de Vouchers pasa AL MOMENTO al siguiente.
 * La hoja de Vouchers (vouchers_bot_cambios/src/Lectores.js) pide esta configuración a Cobranzas
 * (canal vch, acción «lectores», AsistenteVouchers.js) y la guarda 10 min; al cambiarla aquí se le avisa por su puente.
 *
 * Telegram (solo administradores):
 *   lectores                          → panel con el orden, botones ⬆️ subir · ⏸ apagar/▶ prender · 🔧 modelo, y uso de hoy
 *   lectores nvidia gemini groq       → poner ese orden de una vez (los que no nombre quedan apagados)
 *   lectores modelo groq <id>         → usar ese modelo (también: modelo nvidia <id>, modelo gemini <id>)
 *   lectores modelo gemini auto       → volver al modelo automático
 * Las claves son las ya guardadas: NVIDIA (mensaje nvapi-…), Groq (🎤 Clave de Groq); Gemini usa la de la hoja de Vouchers.
 * En las hojas: menú 🧠 Asistente IA → 🧾 Lectores de vouchers (LectoresVista.html), en Cobranzas y en la hoja de Vouchers
 *   (allá la ventana es la misma, copiada al desplegar; sus llamadas pasan por el canal vch: lect_ver / lect_guardar / lect_modelos).
 * NVIDIA y Groq no leen PDF: la hoja de Vouchers les manda cada página convertida en imagen. Funciones LECT_.
 */

var LECT_PROP_ = 'LECT_CFG';
var LECT_NOMBRES_ = { gemini: 'Gemini (Google)', nvidia: 'NVIDIA', groq: 'Groq' };
// Gemini 4 Hydrogen: el mejor Gemini gratis (nov. 2026; leyó bien los números difíciles en «comparar gemini»). Si se satura, la hoja pasa sola a 3.6 Flash, 3.8 Flash y Flash-Lite.
var LECT_MODELO_DEF_ = { gemini: 'gemini-4-hydrogen', nvidia: 'nvidia/nemotron-3.5-super-vl-120b-a12b', groq: '' };   // '' = automático
var LECT_RX_ = /^\s*\/?lectore?s?(\s|$)/i;

function LECT_cfg_() {
  var c = null;
  try { c = JSON.parse(PropertiesService.getScriptProperties().getProperty(LECT_PROP_) || 'null'); } catch (e) {}
  c = c || {};
  var orden = (c.orden || ['gemini', 'nvidia', 'groq']).filter(function (p) { return LECT_NOMBRES_[p]; });
  Object.keys(LECT_NOMBRES_).forEach(function (p) { if (orden.indexOf(p) < 0) orden.push(p); });
  var modelo = {};
  Object.keys(LECT_NOMBRES_).forEach(function (p) { modelo[p] = (c.modelo && c.modelo[p]) ? String(c.modelo[p]) : LECT_MODELO_DEF_[p]; });   // vacío = el de por defecto
  // 🧠 razonar: el modelo «piensa» antes de responder (más preciso en números difíciles, pero tarda más). Gemini no lo usa aquí.
  // NVIDIA razona POR DEFECTO (pedido del usuario: precisión antes que rapidez); se apaga solo si se elige expresamente.
  var razonar = { gemini: false, nvidia: !(c.razonar && c.razonar.nvidia === false), groq: !!(c.razonar && c.razonar.groq) };
  return { orden: orden, apagados: (c.apagados || []).filter(function (p) { return LECT_NOMBRES_[p]; }), modelo: modelo, razonar: razonar };
}

function LECT_guardar_(cfg) {
  PropertiesService.getScriptProperties().setProperty(LECT_PROP_, JSON.stringify(cfg));
  try { LECT_puente_('lectores', {}); } catch (e) {}   // que la hoja de Vouchers lo tome al instante (si no, en ≤10 min)
}

function LECT_puente_(op, p) { return RUCV_puente_(op, p); }   // RucVentana.js: la misma llave del Portal de Vouchers

/** Lo que pide la hoja de Vouchers (servidor a servidor, con su clave): orden activo, modelos y claves. */
function LECT_paraVouchers_() {
  var cfg = LECT_cfg_(), activos = cfg.orden.filter(function (p) { return cfg.apagados.indexOf(p) < 0; });
  if (!activos.length) activos = ['gemini'];
  var groqClave = typeof TGNV_groqClave_ === 'function' ? TGNV_groqClave_() : '', groqModelo = cfg.modelo.groq;
  if (!groqModelo && groqClave) { try { groqModelo = TGNV_groqModelo_(groqClave); } catch (e) { groqModelo = 'qwen/qwen3.8-27b'; } }
  return {
    ok: true, orden: activos,
    gemini: { modelo: cfg.modelo.gemini || '' },
    nvidia: { clave: CIA_nvClave_(), modelo: cfg.modelo.nvidia || LECT_MODELO_DEF_.nvidia, razonar: cfg.razonar.nvidia },
    groq: { clave: groqClave, modelo: groqModelo || 'qwen/qwen3.8-27b', prompt: TGNV_PROMPT_CORTO_, razonar: cfg.razonar.groq },
  };
}

/* ------------------------------------------------ Telegram */

function LECT_tg_(ctx, texto) {
  if (!LECT_RX_.test(texto || '')) return false;
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return false;   // para los demás es una pregunta más (la IA contesta)
  var pal = String(texto).trim().replace(/^\/?\S+\s*/, '').split(/\s+/).filter(Boolean);
  try {
    if (pal.length && /^razon/i.test(pal[0])) {   // lectores razonar nvidia si|no
      var pr = LECT_prov_(pal[1]);
      if (!pr || pr === 'gemini') throw new Error('Diga cuál: <code>lectores razonar nvidia si</code> o <code>lectores razonar groq no</code>');
      var cr = LECT_cfg_();
      cr.razonar[pr] = pal[2] ? /^(s|si|sí|1|on)$/i.test(pal[2]) : !cr.razonar[pr];
      LECT_guardar_(cr);
      LECT_panel_(ctx, '✅ ' + LECT_NOMBRES_[pr] + (cr.razonar[pr] ? ' ahora <b>razona</b> antes de responder (más preciso, más lento).' : ' ahora responde <b>sin razonar</b> (rápido).'));
      return true;
    }
    if (pal.length && /^modelos?$/i.test(pal[0])) {
      var p = LECT_prov_(pal[1]);
      if (!p) throw new Error('Diga de cuál: <code>lectores modelo gemini|nvidia|groq &lt;modelo&gt;</code>');
      if (!pal[2]) return LECT_modelos_(ctx, p), true;
      var cfg = LECT_cfg_();
      cfg.modelo[p] = /^(auto|automatico|automático)$/i.test(pal[2]) ? LECT_MODELO_DEF_[p] : pal[2];
      LECT_guardar_(cfg);
      LECT_panel_(ctx, '✅ ' + LECT_NOMBRES_[p] + ' usará <code>' + TG_esc_(cfg.modelo[p] || 'automático') + '</code>.');
      return true;
    }
    if (pal.length) {
      var orden = pal.map(LECT_prov_).filter(Boolean).filter(function (p, i, a) { return a.indexOf(p) === i; });
      if (!orden.length) throw new Error('No reconozco esos nombres. Use gemini, nvidia y groq, p. ej. <code>lectores gemini nvidia groq</code>');
      var c2 = LECT_cfg_();
      c2.apagados = Object.keys(LECT_NOMBRES_).filter(function (p) { return orden.indexOf(p) < 0; });
      c2.orden = orden.concat(c2.apagados);
      LECT_guardar_(c2);
      LECT_panel_(ctx, '✅ Orden guardado.');
      return true;
    }
    LECT_panel_(ctx);
  } catch (e) { TG_enviar_(ctx.chatId, '⚠️ ' + e.message); }
  return true;
}

function LECT_prov_(s) {
  s = String(s || '').toLowerCase();
  if (/^gem|^goo/.test(s)) return 'gemini';
  if (/^nv|^nem/.test(s)) return 'nvidia';
  if (/^gro|^grok/.test(s)) return 'groq';
  return '';
}

function LECT_textoPanel_(cfg) {
  var n = 0, uso = null;
  try { uso = LECT_puente_('lectores', {}); } catch (e) {}
  var lineas = ['🧾 <b>Lectores de vouchers</b> (si el primero falla, pasa al siguiente al momento)', ''];
  cfg.orden.forEach(function (p) {
    var off = cfg.apagados.indexOf(p) >= 0;
    lineas.push((off ? '⏸ ' : (++n) + '. ') + '<b>' + LECT_NOMBRES_[p] + '</b> · <code>' + TG_esc_(cfg.modelo[p] || 'automático') + '</code>' + (cfg.razonar[p] ? ' · 🧠 razona' : '') + (off ? ' <i>(apagado)</i>' : ''));
  });
  var faltan = [];
  if (cfg.apagados.indexOf('nvidia') < 0 && !CIA_nvClave_()) faltan.push('NVIDIA: mande su clave nvapi-… en un mensaje solo');
  if (cfg.apagados.indexOf('groq') < 0 && !TGNV_groqClave_()) faltan.push('Groq: falta la clave (menú 🤖 Telegram → 🎤 Clave de Groq)');
  if (faltan.length) lineas.push('', '⚠️ ' + faltan.join('\n⚠️ ') + ' (mientras tanto se salta).');
  if (uso && uso.ok && uso.hoy) {
    var u = uso.hoy, t = Object.keys(LECT_NOMBRES_).map(function (p) { return LECT_NOMBRES_[p].split(' ')[0] + ' ' + (u[p] || 0); }).join(' · ');
    lineas.push('', '📊 <b>Hoy leyeron</b>: ' + t + (u.fallos ? ' · ❌ ninguno pudo: ' + u.fallos : ''));
    if (uso.ultimo) lineas.push('<i>Último respaldo: ' + TG_esc_(uso.ultimo) + '</i>');
  } else if (uso && uso.error) lineas.push('', '<i>(La hoja de Vouchers no informó su uso: ' + TG_esc_(String(uso.error).slice(0, 120)) + ')</i>');
  lineas.push('', '<i>Los PDF también: a NVIDIA y Groq se les manda cada página como imagen. Recuerde: el uso gratis de NVIDIA es para pruebas según sus condiciones.</i>',
    '<i>🧠 Razonar = piensa antes de responder: más preciso con números difíciles (muchos ceros), pero tarda más (de 10 a 40 s). NVIDIA siempre recibe la imagen en detalle alto.</i>',
    '<i>También por texto: <code>lectores nvidia gemini groq</code> · <code>lectores modelo groq &lt;id&gt;</code> · <code>lectores razonar nvidia si</code></i>');
  return lineas.join('\n');
}

function LECT_teclado_(cfg) {
  var b = function (t, d) { return { text: t, callback_data: 'k:' + TG_guardarBoton_(d, 21600) }; };
  return cfg.orden.map(function (p, i) {
    var off = cfg.apagados.indexOf(p) >= 0, nom = LECT_NOMBRES_[p].split(' ')[0], fila = [];
    if (i > 0) fila.push(b('⬆️ ' + nom, { t: 'lect', a: 'subir', p: p }));
    fila.push(b((off ? '▶ Prender ' : '⏸ Apagar ') + nom, { t: 'lect', a: 'onoff', p: p }));
    fila.push(b('🔧 Modelo', { t: 'lect', a: 'modelos', p: p }));
    if (p !== 'gemini') fila.push(b(cfg.razonar[p] ? '🧠 Razona ✓' : '🧠 Razonar', { t: 'lect', a: 'razonar', p: p }));
    return fila;
  });
}

function LECT_panel_(ctx, aviso, editar) {
  var cfg = LECT_cfg_(), html = (aviso ? aviso + '\n\n' : '') + LECT_textoPanel_(cfg);
  if (editar && ctx.msgId && TG_editar_(ctx.chatId, ctx.msgId, html, LECT_teclado_(cfg))) return;
  TG_enviar_(ctx.chatId, html, LECT_teclado_(cfg));
}

/** Modelos que leen imágenes que tiene HOY cada proveedor, como botones. */
function LECT_modelos_(ctx, p) {
  TG_accion_(ctx.chatId, 'typing');
  var ids = [], cfg = LECT_cfg_();
  try { ids = LECT_listaModelos_(p); }
  catch (e) { return TG_enviar_(ctx.chatId, '⚠️ No pude ver los modelos de ' + LECT_NOMBRES_[p] + ': ' + TG_esc_(e.message)); }
  var b = function (t, d) { return [{ text: t, callback_data: 'k:' + TG_guardarBoton_(d, 21600) }]; };
  var teclado = [b('🤖 Automático' + (!cfg.modelo[p] || cfg.modelo[p] === LECT_MODELO_DEF_[p] ? ' ✓' : ''), { t: 'lect', a: 'modelo', p: p, m: '' })]
    .concat(ids.map(function (id) { return b((cfg.modelo[p] === id ? '✓ ' : '') + id.slice(0, 55), { t: 'lect', a: 'modelo', p: p, m: id }); }));
  TG_enviar_(ctx.chatId, '🔧 <b>Modelo de ' + LECT_NOMBRES_[p] + '</b> para leer vouchers (ahora: <code>' + TG_esc_(cfg.modelo[p] || 'automático') + '</code>)\n' +
    (ids.length ? 'Estos leen imágenes y su clave los ve hoy. Toque uno:' : 'No encontré otros modelos que lean imágenes.') +
    '\n<i>Antes de cambiarlo puede compararlo mandando una foto con la palabra «comparar».</i>', teclado);
}

/** Modelos que leen imágenes que la clave ve HOY (máx. 12). */
function LECT_listaModelos_(p) {
  var ids = [];
  {
    if (p === 'nvidia') {
      var r = UrlFetchApp.fetch('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: 'Bearer ' + CIA_nvClave_() }, muteHttpExceptions: true });
      ids = (JSON.parse(r.getContentText()).data || []).map(function (x) { return String(x.id); })
        .filter(function (id) { return /-vl\b|-vl-|vision|glimmer|muse|kimi-k3|gemma-4|llava|pixtral|phi-.*vision|nemotron.*vl/i.test(id); });
    } else if (p === 'groq') {
      var rg = UrlFetchApp.fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + TGNV_groqClave_() }, muteHttpExceptions: true });
      ids = (JSON.parse(rg.getContentText()).data || []).map(function (x) { return String(x.id); })
        .filter(function (id) { return /qwen3\.\d+-27b|muse|llama-4|vision|-vl/i.test(id); });
    } else {
      var k = PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)');
      var rm = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': k }, muteHttpExceptions: true });
      ids = (JSON.parse(rm.getContentText()).models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
        .map(function (m) { return String(m.name).replace(/^models\//, ''); })
        .filter(function (id) { return /^gemini-\d/.test(id) && !/tts|image|embed|audio|live|thinking|exp|robotics|computer/i.test(id); });
    }
  }
  return ids.sort().reverse().slice(0, 12);
}

function LECT_alBoton_(ctx, d) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  var cfg = LECT_cfg_(), p = d.p;
  if (!LECT_NOMBRES_[p]) return;
  if (d.a === 'modelos') return LECT_modelos_(ctx, p);
  if (d.a === 'subir') {
    var i = cfg.orden.indexOf(p);
    if (i > 0) { cfg.orden.splice(i, 1); cfg.orden.splice(i - 1, 0, p); }
    cfg.apagados = cfg.apagados.filter(function (x) { return x !== p; });
  } else if (d.a === 'onoff') {
    if (cfg.apagados.indexOf(p) >= 0) cfg.apagados = cfg.apagados.filter(function (x) { return x !== p; });
    else {
      if (cfg.orden.filter(function (x) { return cfg.apagados.indexOf(x) < 0 && x !== p; }).length === 0) return TG_enviar_(ctx.chatId, '⚠️ Debe quedar al menos un lector prendido.');
      cfg.apagados.push(p);
    }
    // los apagados van al final; los prendidos conservan su orden
    cfg.orden = cfg.orden.filter(function (x) { return cfg.apagados.indexOf(x) < 0; }).concat(cfg.orden.filter(function (x) { return cfg.apagados.indexOf(x) >= 0; }));
  } else if (d.a === 'razonar') {
    if (p === 'gemini') return;
    cfg.razonar[p] = !cfg.razonar[p];
  } else if (d.a === 'modelo') {
    cfg.modelo[p] = d.m || LECT_MODELO_DEF_[p];
    LECT_guardar_(cfg);
    return LECT_panel_(ctx, '✅ ' + LECT_NOMBRES_[p] + ' usará <code>' + TG_esc_(cfg.modelo[p] || 'automático') + '</code>.');
  } else return;
  LECT_guardar_(cfg);
  LECT_panel_(ctx, '✅ Guardado.', true);
}

/* ------------------------------------------------ 🧾 ventana en la hoja (Cobranzas y, por el canal vch, la hoja de Vouchers) */

function LECT_menuAbrir() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('LectoresVista').setWidth(640).setHeight(560), '🧾 Lectores de vouchers');
}

/** Lo que muestra la ventana: configuración, nombres, si falta clave y el uso de hoy (nunca las claves). */
function LECT_ver() {
  var cfg = LECT_cfg_(), uso = null;
  try { uso = LECT_puente_('lectores', {}); } catch (e) { uso = { error: e.message }; }
  return { cfg: cfg, nombres: LECT_NOMBRES_, def: LECT_MODELO_DEF_, uso: uso,
    clave: { gemini: true, nvidia: !!CIA_nvClave_(), groq: !!TGNV_groqClave_() } };
}

/** Guarda lo elegido en la ventana. quien: correo de quien lo cambió (queda en el registro). */
function LECT_guardarHoja(nuevo, quien) {
  var c = LECT_cfg_(), n = nuevo || {};
  var orden = (n.orden || []).filter(function (p, i, a) { return LECT_NOMBRES_[p] && a.indexOf(p) === i; });
  Object.keys(LECT_NOMBRES_).forEach(function (p) { if (orden.indexOf(p) < 0) orden.push(p); });
  var apagados = (n.apagados || []).filter(function (p) { return LECT_NOMBRES_[p]; });
  if (orden.filter(function (p) { return apagados.indexOf(p) < 0; }).length === 0) throw new Error('Debe quedar al menos un lector prendido.');
  Object.keys(LECT_NOMBRES_).forEach(function (p) {
    var m = n.modelo && n.modelo[p] != null ? String(n.modelo[p]).trim() : c.modelo[p];
    if (m && !/^[\w.\-\/:]{2,120}$/.test(m)) throw new Error('Nombre de modelo no válido: ' + m);
    c.modelo[p] = m || LECT_MODELO_DEF_[p];
    if (p !== 'gemini' && n.razonar && n.razonar[p] != null) c.razonar[p] = !!n.razonar[p];
  });
  c.orden = orden.filter(function (p) { return apagados.indexOf(p) < 0; }).concat(orden.filter(function (p) { return apagados.indexOf(p) >= 0; }));
  c.apagados = apagados;
  LECT_guardar_(c);
  console.log('🧾 Lectores cambiados desde la hoja por ' + (quien || Session.getActiveUser().getEmail() || '?') + ': ' + JSON.stringify(c));
  return LECT_ver();
}

function LECT_modelosHoja(p) {
  if (!LECT_NOMBRES_[p]) throw new Error('Lector desconocido.');
  return LECT_listaModelos_(p);
}
