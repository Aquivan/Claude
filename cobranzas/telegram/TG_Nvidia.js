/**
 * 🟩 NVIDIA desde Telegram: guardar la clave y probar los modelos gratis de hoy (ConciliacionIA.js → CIA_nvProbar).
 *   /nvidia            → si ya hay clave: prueba los modelos y deja elegir; si no: explica cómo mandarla.
 *   «nvapi-…» (mensaje) → solo un ADMINISTRADOR y en chat privado: el bot BORRA el mensaje al instante, guarda la clave
 *                         oculta (propiedades del script, la misma del 🧠 Asistente IA) y prueba los modelos.
 * La clave nunca se repite en ningún mensaje ni registro. Funciones TGNV_.
 */

var TGNV_RX_ = /^\s*nvapi-[A-Za-z0-9_\-]{20,}\s*$/;

/** Si el texto es una clave de NVIDIA, la atiende (y devuelve true). Va ANTES que la IA: la clave nunca se le manda a nadie. */
function TGNV_tg_(ctx, texto) {
  if (!TGNV_RX_.test(texto)) return false;
  try { TG_llamar_('deleteMessage', { chat_id: ctx.chatId, message_id: ctx.msgId }); } catch (e) {}
  if (ctx.grupo) { TG_enviar_(ctx.chatId, '🔒 Borré ese mensaje: las claves solo se mandan por chat privado con el bot.'); return true; }
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') { TG_enviar_(ctx.chatId, '🔒 Borré ese mensaje: solo un administrador puede guardar claves de IA.'); return true; }
  var k = String(texto).trim(), p = PropertiesService.getScriptProperties();
  p.setProperty('CIA_KEY_NVIDIA', k);
  p.setProperty('IA_KEY_NVIDIA', k);
  TG_enviar_(ctx.chatId, '🔑 <b>Clave de NVIDIA guardada</b> (borré su mensaje; no queda en el chat). Pruebo los modelos gratis de hoy…');
  TGNV_probar_(ctx);
  return true;
}

function TGNV_comando_(ctx) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('CIA_KEY_NVIDIA') && !p.getProperty('IA_KEY_NVIDIA'))
    return TG_enviar_(ctx.chatId, '🟩 <b>NVIDIA</b>: mande aquí su clave (empieza con <code>nvapi-</code>) como un mensaje solo. La borro al instante, la guardo oculta y pruebo qué modelos gratis responden hoy.');
  TG_accion_(ctx.chatId, 'typing');
  TGNV_probar_(ctx);
}

/**
 * La prueba corre en SEGUNDO PLANO y POR TANDAS (3 modelos por ejecución): si un modelo de NVIDIA no contesta, Google corta esa
 * ejecución sin aviso; por eso antes de cada tanda queda programada la siguiente (vigía): si la tanda murió, esos modelos se
 * anotan «no respondió a tiempo» y se sigue con el resto. Al terminar llega la tabla.
 */
function TGNV_probar_(ctx) {
  var c;
  try { c = CIA_nvCandidatos_(); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ NVIDIA: ' + TG_esc_(e.message)); }
  if (!c.cand.length) return TG_enviar_(ctx.chatId, '⚠️ Su clave ve ' + c.total + ' modelos pero ninguno de los que interesan (DeepSeek, Kimi, GLM, Nemotron, Mistral…).');
  PropertiesService.getScriptProperties().setProperty('TGNV_EST', JSON.stringify({ chat: String(ctx.chatId), total: c.total, cand: c.cand, i: 0, res: [], enCurso: null, t0: Date.now() }));
  TGNV_programar_(3000);
  TG_enviar_(ctx.chatId, '⏳ Probando ' + c.cand.length + ' modelos gratis de NVIDIA (de ' + c.total + ' que ve su clave), de a 3, en segundo plano. Le aviso tras cada tanda; si NVIDIA está lento puede tardar hasta 15 min.');
}

function TGNV_programar_(ms) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_paso') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('TGNV_paso').timeBased().after(ms).create();
}

/** Disparador: una tanda por ejecución. */
function TGNV_paso() {
  var p = PropertiesService.getScriptProperties(), est;
  try { est = JSON.parse(p.getProperty('TGNV_EST') || 'null'); } catch (e) { est = null; }
  if (!est) return;
  if (est.enCurso) {   // la ejecución anterior murió esperando a esos modelos
    est.enCurso.forEach(function (id) { est.res.push({ id: id, ok: false, s: 0, nota: CIA_nvNota_(id), error: 'no respondió a tiempo (muy lento o saturado)' }); });
    est.i += est.enCurso.length; est.enCurso = null;
  }
  if (est.i >= est.cand.length || Date.now() - est.t0 > 15 * 60000) {
    est.cand.slice(est.i).forEach(function (id) { est.res.push({ id: id, ok: false, s: 0, nota: CIA_nvNota_(id), error: 'no se alcanzó a probar (NVIDIA muy lento hoy)' }); });
    p.deleteProperty('TGNV_EST');
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_paso') ScriptApp.deleteTrigger(t); });
    return TGNV_mostrar_({ chatId: est.chat }, est);
  }
  var lote = est.cand.slice(est.i, est.i + 3);
  est.enCurso = lote;
  p.setProperty('TGNV_EST', JSON.stringify(est));
  TGNV_programar_(6.5 * 60000);   // vigía: si esta ejecución muere (Google corta a los 6 min), la próxima sigue
  var res;
  try { res = CIA_nvProbarLote_(CIA_nvClave_(), lote); }
  catch (e) { res = lote.map(function (id) { return { id: id, ok: false, s: 0, nota: CIA_nvNota_(id), error: String(e.message || e).slice(0, 80) }; }); }
  est.res = est.res.concat(res); est.i += lote.length; est.enCurso = null;
  p.setProperty('TGNV_EST', JSON.stringify(est));
  // avance: lo que ya respondió (para no esperar al final)
  if (est.i < est.cand.length) TG_enviar_(est.chat, '⏳ NVIDIA ' + est.i + ' de ' + est.cand.length + ': ' + res.map(function (x) { return (x.ok ? '✅ ' : '❌ ') + x.id.split('/').pop() + (x.ok ? ' ' + x.s + ' s' : ''); }).join(' · '), null, { silencioso: true });
  TGNV_programar_(2000);
}

function TGNV_mostrar_(ctx, est) {
  var res = est.res.slice().sort(function (a, b) { return (b.ok - a.ok) || a.s - b.s; });
  var r = { total: est.total, probados: res, elegido: PropertiesService.getScriptProperties().getProperty('IA_NVIDIA_MODELO') || '', segundos: Math.round((Date.now() - est.t0) / 1000) };
  var ok = r.probados.filter(function (m) { return m.ok; }), no = r.probados.filter(function (m) { return !m.ok; });
  var html = '🟩 <b>Modelos gratis de NVIDIA hoy</b> (su clave ve ' + r.total + '; probé ' + r.probados.length + ' en ' + r.segundos + ' s)\n' +
    (r.elegido ? 'Elegido ahora: <code>' + TG_esc_(r.elegido) + '</code>\n' : '') + '\n' +
    (ok.length ? ok.map(function (m) { return '✅ <code>' + TG_esc_(m.id) + '</code> · ' + m.s + ' s' + (m.nota ? '\n   <i>' + TG_esc_(m.nota) + '</i>' : ''); }).join('\n') : '❌ Ninguno respondió.') +
    (no.length ? '\n\n<i>No responden: ' + TG_esc_(no.map(function (m) { return m.id.split('/').pop() + ' (' + m.error + ')'; }).join(' · ').slice(0, 600)) + '</i>' : '') +
    (ok.length ? '\n\nToque uno para usarlo en el 🧠 Asistente IA:' : '');
  var teclado = ok.slice(0, 8).map(function (m) {
    return [{ text: '▶ Usar ' + m.id.split('/').pop().slice(0, 40), callback_data: 'k:' + TG_guardarBoton_({ t: 'nvusar', id: m.id }, 86400) }];
  });
  TG_enviar_(ctx.chatId, html, teclado.length ? teclado : null);
}

function TGNV_alBoton_(ctx, datos) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  try { CIA_nvElegir(datos.id); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
  TG_enviar_(ctx.chatId, '✅ El 🧠 Asistente IA usará <code>' + TG_esc_(datos.id) + '</code> (fila 11: «NVIDIA · modelo elegido»).');
}

/* ============================================================ 🧾 voucher con «nvidia»: Gemini vs NVIDIA */

var TGNV_LECTORES_ = [
  { nom: 'Gemini', prov: 'Gemini (Google)' },
  { nom: 'Nemotron Super VL', prov: 'NVIDIA · Nemotron 3.5 Super VL (lee imágenes)', nvidia: true },
  { nom: 'Groq', prov: 'Groq · visión', groq: true },
];

// 🆓 «comparar gemini»: los modelos de Gemini con versión GRATIS (página de precios de Google, nov. 2026), del más nuevo al más liviano.
// Solo se prueban los que la clave ve hoy (los demás se informan como «no disponible»).
var TGNV_GEMINI_GRATIS_ = [
  ['gemini-4-hydrogen', 'Gemini 4 Hydrogen'], ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-3.6-flash', 'Gemini 3.6 Flash'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'], ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite']
];
var TGNV_GEMINI_HOJA_ = 'gemini-4-hydrogen';   // el que usa la hoja de Vouchers si no se eligió otro en 🧾 lectores (LECT_MODELO_DEF_)

/** Lectores de esta prueba (se guardan en est: así el vigía usa los mismos). */
function TGNV_lectoresDe_(est) { return est.lect || TGNV_LECTORES_; }

// Groq gratis acepta pocos tokens por minuto: no caben las instrucciones completas (~6.000 tokens). Estas son las reglas esenciales.
var TGNV_PROMPT_CORTO_ = 'Eres contador experto en vouchers bancarios de Perú. Lee el comprobante y devuelve SOLO un array JSON:\n' +
  '[{"fecha":"DD/MM/YYYY","nOperacion":"","banco":"","moneda":"PEN|USD","monto":0,"proveedor":"","idCliente":"","cliente":"","descripcion":""}]\n' +
  'Reglas: proveedor = quien RECIBE el dinero (beneficiario/titular de la cuenta destino); cliente = quien paga; idCliente = RUC (11 dígitos) de quien paga si aparece. ' +
  'Pagos de tributos (SUNAT, ESSALUD, ONP, FORM 1662, BOLETA DE PAGO SUNAT): proveedor = "SUNAT" siempre y la empresa que paga va en cliente con su RUC en idCliente. ' +
  'Pago de servicios (luz, agua, teléfono, recaudación): proveedor = la empresa del servicio. Agentes BCP/BBVA: el agente NO es proveedor; el titular de la cuenta sí. ' +
  'nOperacion: el número de operación o secuencia (BCP: el de "OP-" o "NRO. OPE."), sin inventar. monto: lo que recibe el beneficiario (sin comisión ni ITF), número con punto decimal y sin miles; ignora asteriscos (S/****1,637.00 = 1637.00). ' +
  'fecha: DD/MM/YYYY (4/03/26 = 04/03/2026). descripcion: motivo corto (DEPOSITO EN EFECTIVO, TRANSFERENCIA, BOLETA DE PAGO SUNAT…). Si un dato no está, "". No inventes.';

/** Clave de Groq (la de 🎤 audios sirve) y el modelo que lee imágenes que tenga HOY (se busca en su lista; 6 h en memoria). */
function TGNV_groqClave_() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty('GROQ_KEY') || p.getProperty('IA_KEY_GROQ') || p.getProperty('CIA_KEY_GROQ') || '';
}
function TGNV_groqModelo_(clave) {
  var c = CacheService.getScriptCache(), m = c.get('tgnv_groq_vis');
  if (m) return m;
  var r = UrlFetchApp.fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + clave }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Groq respondió ' + r.getResponseCode() + ' al pedir sus modelos');
  var ids = (JSON.parse(r.getContentText()).data || []).map(function (x) { return String(x.id); });
  var pref = [/qwen\/qwen3\.\d+-27b/i, /muse/i, /llama-4-maverick/i, /llama-4-scout/i, /vision|-vl/i];
  for (var i = 0; i < pref.length && !m; i++) m = ids.filter(function (id) { return pref[i].test(id); }).sort().pop();
  if (!m) throw new Error('su clave de Groq no tiene hoy ningún modelo que lea imágenes');
  PropertiesService.getScriptProperties().setProperty('IA_GROQ_VISION', m);
  c.put('tgnv_groq_vis', m, 21600);
  return m;
}
var TGNV_CAMPOS_ = [['banco', 'Banco'], ['fecha', 'Fecha'], ['nOperacion', 'N° operación'], ['moneda', 'Moneda'], ['monto', 'Monto'],
  ['proveedor', 'Proveedor (beneficiario)'], ['cliente', 'Cliente (quién paga)'], ['idCliente', 'RUC del cliente'], ['descripcion', 'Descripción']];
var TGNV_SISTEMA_ = 'Eres un lector de comprobantes bancarios de Perú (vouchers de depósito o transferencia: BCP, BBVA, Interbank, Scotiabank, BN, cajas). ' +
  'Lee la imagen y responde SOLO un JSON con: banco, fecha (dd/mm/aaaa), operacion (número de operación tal cual), moneda (PEN o USD), ' +
  'monto (número con punto decimal, sin separador de miles), ordenante (quién paga), beneficiario (a quién se paga), ruc_beneficiario (11 dígitos si aparece), ' +
  'cuenta_destino (si aparece). Si un dato no está, pon "". No inventes nada.';

/** Foto (o PDF) con «nvidia» en el texto: se lee con Gemini y con los modelos de NVIDIA que leen imágenes, en segundo plano. No escribe en ninguna hoja. */
function TGNV_voucher_(ctx, blob, mime, m) {
  var modoGemini = /gemini/i.test(String((m && (m.caption || m.text)) || ''));   // «comparar gemini»: todos los Gemini gratis
  // La foto tal cual llega (la más grande): es la que lee la hoja de Vouchers, así la prueba es igual a lo real.
  // Para Groq, si es grande, se achica a 1280 px (TGNV_vistaPrevia_), igual que hace el respaldo automático.
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'La comparación de lectores es solo para administradores.');
  if (!modoGemini && !CIA_nvClave_()) return TG_enviar_(ctx.chatId, '🟩 Primero mande su clave de NVIDIA (nvapi-…) en un mensaje solo.');
  var f = IMP_carpeta_(ctx.ss).createFile(blob.setName('comparar voucher ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmmss')));
  var esPdf = /pdf/i.test(mime);
  var est = { chat: String(ctx.chatId), id: f.getId(), mime: mime, i: 0, res: [], enCurso: null, t0: Date.now(), pdf: esPdf };
  if (modoGemini) {
    var g = TGNV_geminiDisponibles_();
    est.modo = 'gemini'; est.noDisp = g.no;
    est.lect = g.si.map(function (x) { return { nom: x[1], prov: 'Gemini (Google)', modelo: x[0] }; });
    if (!est.lect.length) return TG_enviar_(ctx.chatId, '⚠️ Su clave de Gemini no ve hoy ninguno de los modelos gratis.');
    PropertiesService.getScriptProperties().setProperty('TGNV_VCH', JSON.stringify(est));
    TG_enviar_(ctx.chatId, '🧪 Leyendo el voucher con <b>' + est.lect.length + ' modelos gratis de Gemini</b> (' + est.lect.map(function (x) { return x.nom.replace('Gemini ', ''); }).join(', ') +
      '), uno tras otro, con las instrucciones reales del lector. Gemini 4 piensa antes de responder: puede tardar más. Le respondo apenas terminen. No se guarda nada.', null, { silencioso: true });
    return TGNV_leerTodo_(est);
  }
  var gh = (typeof LECT_cfg_ === 'function' && LECT_cfg_().modelo.gemini) || TGNV_GEMINI_HOJA_;   // el MISMO Gemini que lee en la hoja
  est.lect = [{ nom: 'Gemini · ' + gh.replace(/^gemini-/, ''), prov: 'Gemini (Google)', modelo: gh, base: true }].concat(TGNV_LECTORES_.slice(1));
  PropertiesService.getScriptProperties().setProperty('TGNV_VCH', JSON.stringify(est));
  TG_enviar_(ctx.chatId, '🧪 Leyendo el voucher con <b>Gemini</b>, <b>Nemotron Super VL</b> (NVIDIA) y <b>Groq</b>' +
    ' (instrucciones reales del lector). Le respondo apenas terminen. No se guarda nada en la hoja.' +
    (esPdf ? '\n<i>Es un PDF: a NVIDIA y Groq les mando la primera página convertida en imagen (como hará el respaldo automático).</i>' : ''), null, { silencioso: true });
  TGNV_leerTodo_(est);
}

/**
 * Lee con todos AHORA, uno tras otro, y responde apenas terminan (sin esperas entre lectores). Antes deja un VIGÍA
 * programado: si algún modelo se cuelga y Google corta esta ejecución, el vigía lo marca «no respondió a tiempo»
 * y sigue con los que faltan (TGNV_leerPaso).
 */
function TGNV_leerTodo_(est) {
  var p = PropertiesService.getScriptProperties();
  var lectores = TGNV_lectoresDe_(est);   // PDF: a NVIDIA y Groq se les manda la 1.ª página como imagen (TGNV_vistaPrevia_)
  TGNV_programarV_(6.5 * 60000);   // vigía
  while (est.i < lectores.length) {
    est.enCurso = est.i;
    p.setProperty('TGNV_VCH', JSON.stringify(est));
    est.res.push(TGNV_leerUno_(est, lectores[est.i]));
    est.i++; est.enCurso = null;
    p.setProperty('TGNV_VCH', JSON.stringify(est));
  }
  TGNV_terminar_(est);
}

function TGNV_programarV_(ms) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_leerPaso') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('TGNV_leerPaso').timeBased().after(ms).create();
}

function TGNV_terminar_(est) {
  PropertiesService.getScriptProperties().deleteProperty('TGNV_VCH');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGNV_leerPaso') ScriptApp.deleteTrigger(t); });
  try { DriveApp.getFileById(est.id).setTrashed(true); } catch (e) {}
  TGNV_compararMostrar_(est);
}

/** Vigía: solo corre si la lectura en el momento se cortó. Marca el que se colgó y sigue con el resto. */
function TGNV_leerPaso() {
  var p = PropertiesService.getScriptProperties(), est;
  try { est = JSON.parse(p.getProperty('TGNV_VCH') || 'null'); } catch (e) { est = null; }
  if (!est) return;
  var lectores = TGNV_lectoresDe_(est);   // PDF: a NVIDIA y Groq se les manda la 1.ª página como imagen (TGNV_vistaPrevia_)
  if (est.enCurso != null) { est.res.push({ nom: lectores[est.enCurso].nom, error: 'no respondió a tiempo' }); est.i++; est.enCurso = null; }
  if (Date.now() - est.t0 > 15 * 60000) {
    lectores.slice(est.i).forEach(function (L) { est.res.push({ nom: L.nom, error: 'no se alcanzó (muy lento hoy)' }); });
    est.i = lectores.length;
  }
  TGNV_leerTodo_(est);
}

/** Un lector: → {nom, s, d} o {nom, s, error} */
function TGNV_leerUno_(est, L) {
  var p = PropertiesService.getScriptProperties(), t1 = Date.now(), nom = L.nom;
  // Lo mismo que usa el respaldo automático (🧾 lectores): modelo elegido, 🧠 razonar y, para NVIDIA, imagen en detalle alto.
  var lc = typeof LECT_cfg_ === 'function' ? LECT_cfg_() : { modelo: {}, razonar: {} }, pensar = !!(L.nvidia ? lc.razonar.nvidia : L.groq ? lc.razonar.groq : false);
  if (pensar) nom += ' 🧠';
  try {
    var adjunto;
    var bytes = DriveApp.getFileById(est.id).getSize();
    if (est.pdf && (L.nvidia || L.groq)) adjunto = { base64: TGNV_vistaPrevia_(est, 2048), mime: 'image/jpeg' };   // no leen PDF: la página como imagen
    else if (L.groq && bytes > 330000) adjunto = { base64: TGNV_vistaPrevia_(est, 1280), mime: 'image/jpeg' };   // Groq gratis rechaza fotos grandes
    else { var blob = DriveApp.getFileById(est.id).getBlob(); adjunto = { base64: Utilities.base64Encode(blob.getBytes()), mime: est.mime }; }
    var pedido = 'Analiza este comprobante y responde SOLO el JSON del formato indicado.';
    var clave = L.nvidia ? CIA_nvClave_() : L.groq ? TGNV_groqClave_() : (p.getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)'));
    if (L.groq && !clave) throw new Error('no hay clave de Groq (menú 🤖 Telegram → 🎤 Clave de Groq)');
    var d;
    if (L.groq) {
      var modeloG = TGNV_groqModelo_(clave);
      nom = 'Groq · ' + modeloG.split('/').pop() + (pensar ? ' 🧠' : '');
      // Groq gratis: instrucciones resumidas (las completas no caben) y sin chat_template_kwargs (no lo acepta; basta /no_think).
      var pet = IA_peticion_({ proveedor: L.prov, clave: clave, modelo: modeloG, sinKwargs: true, pensar: pensar, sistema: TGNV_PROMPT_CORTO_, texto: pedido, maxTokens: pensar ? 4000 : 1500, adjunto: adjunto });
      var rg = UrlFetchApp.fetch(pet.url, pet.params), hd = rg.getHeaders() || {};
      var h = function (k) { return hd[k] || hd[k.toLowerCase()] || ''; };
      est.limGroq = { tokMin: h('x-ratelimit-limit-tokens'), tokQueda: h('x-ratelimit-remaining-tokens'), reqDia: h('x-ratelimit-limit-requests'), reqQueda: h('x-ratelimit-remaining-requests') };
      d = IA_respuesta_(pet, rg);
    } else {
      // Las MISMAS instrucciones del lector real de vouchers (TG_PromptVoucher.js); si faltaran, las cortas de prueba.
      var instr = typeof TGNV_PROMPT_VOUCHER_ === 'string' && TGNV_PROMPT_VOUCHER_ ? TGNV_PROMPT_VOUCHER_ : TGNV_SISTEMA_;
      d = IA_llamar_({ proveedor: L.prov, clave: clave, sistema: instr, texto: pedido, maxTokens: L.nvidia ? (pensar ? 16000 : 4000) : 16000, adjunto: adjunto,   // Gemini 4 piensa: su razonamiento también cuenta
        modelo: L.nvidia ? (lc.modelo.nvidia || '') : (L.modelo || ''), pensar: pensar, detalle: L.nvidia ? 'high' : '' });
    }
    return { nom: nom, s: Math.round((Date.now() - t1) / 100) / 10, d: d || {} };
  } catch (e) { return { nom: nom, s: Math.round((Date.now() - t1) / 100) / 10, error: String(e.message || e).slice(0, 120) }; }
}

/** Vista previa JPG de Drive (lado px): 1.ª página de un PDF o foto achicada (el archivo ya está en Drive). Se guarda en memoria para el siguiente lector. */
function TGNV_vistaPrevia_(est, lado) {
  var c = CacheService.getScriptCache(), k = 'tgnv_img_' + lado + '_' + est.id, b64 = c.get(k);
  if (b64) return b64;
  var token = ScriptApp.getOAuthToken(), url = '', esperas = [0, 800, 1200, 1800, 2500];
  for (var i = 0; i < esperas.length && !url; i++) {
    if (esperas[i]) Utilities.sleep(esperas[i]);
    var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + est.id + '?fields=thumbnailLink', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) { var j = JSON.parse(r.getContentText()); if (j.thumbnailLink) url = j.thumbnailLink.replace(/=s\d+/, '=s' + lado); }
  }
  if (!url) url = 'https://drive.google.com/thumbnail?id=' + est.id + '&sz=w' + lado;
  var img = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (img.getResponseCode() !== 200 || img.getBlob().getBytes().length < 2000) throw new Error('no pude convertir en imagen (HTTP ' + img.getResponseCode() + ')');
  b64 = Utilities.base64Encode(img.getBlob().getBytes());
  try { if (b64.length < 95000) c.put(k, b64, 900); } catch (e) {}
  return b64;
}

function TGNV_norm_(c, v) {
  var t = String(v == null ? '' : v).trim().toUpperCase();
  if (c === 'monto') { var n = parseFloat(t.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')); return isNaN(n) ? '' : n.toFixed(2); }
  if (c === 'operacion' || c === 'nOperacion' || c === 'idCliente' || c === 'ruc_beneficiario' || c === 'cuenta_destino') return t.replace(/[^0-9A-Z]/g, '').replace(/^0+/, '');
  if (c === 'fecha') { var m = t.match(/(\d{1,2})\D(\d{1,2})\D(\d{2,4})/); return m ? ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + (m[3].length === 2 ? '20' + m[3] : m[3]) : t; }
  return t.replace(/\s+/g, ' ');
}

function TGNV_compararMostrar_(est) {
  var res = est.res, gm = est.modo === 'gemini';
  var base = gm ? null : res.filter(function (x) { return x.d && /^Gemini/.test(x.nom); })[0];
  var lineas = [gm ? '🧪 <b>Lectura del voucher: todos los Gemini gratis</b>' : '🧪 <b>Lectura del voucher: Gemini vs NVIDIA y Groq</b>', ''];
  res.forEach(function (x) { lineas.push((x.error ? '❌ ' : '✅ ') + '<b>' + TG_esc_(x.nom) + '</b>' + (x.s != null ? ' · ' + x.s + ' s' : '') + (x.error ? ' — ' + TG_esc_(TGNV_errorCorto_(x.error)) : '')); });
  lineas.push('');
  TGNV_CAMPOS_.forEach(function (c) {
    var vals = res.filter(function (x) { return x.d; }).map(function (x) { return { nom: x.nom, v: String(x.d[c[0]] == null ? '' : x.d[c[0]]).trim() }; });
    if (!vals.some(function (v) { return v.v; })) return;
    var ref = base ? TGNV_norm_(c[0], base.d[c[0]]) : null;
    if (gm) {   // sin «el bueno»: vale lo que dice la MAYORÍA (si hay empate, nadie es referencia)
      var cuenta = {}; vals.forEach(function (v) { var k = TGNV_norm_(c[0], v.v); cuenta[k] = (cuenta[k] || 0) + 1; });
      var orden = Object.keys(cuenta).sort(function (a, b) { return cuenta[b] - cuenta[a]; });
      ref = orden.length && (orden.length === 1 || cuenta[orden[0]] > cuenta[orden[1]]) ? orden[0] : null;
    }
    lineas.push('<b>' + c[1] + '</b>');
    vals.forEach(function (v) {
      var marca = (base && v.nom === base.nom) || ref == null ? '•' : (TGNV_norm_(c[0], v.v) === ref ? '✅' : '⚠️');
      lineas.push('  ' + marca + ' ' + TG_esc_(v.nom) + ': ' + (v.v ? '<code>' + TG_esc_(v.v.slice(0, 60)) + '</code>' : '—'));
    });
  });
  if (est.limGroq && (est.limGroq.reqQueda || est.limGroq.tokQueda))
    lineas.push('', '📊 <b>Groq gratis</b>: le quedan ' + (est.limGroq.reqQueda || '?') + ' de ' + (est.limGroq.reqDia || '?') + ' pedidos hoy · ' +
      (est.limGroq.tokQueda || '?') + ' de ' + (est.limGroq.tokMin || '?') + ' tokens este minuto. <i>Groq usó instrucciones resumidas (las completas no caben en su límite gratis).</i>');
  if (gm && est.noDisp && est.noDisp.length) lineas.push('', '<i>No disponibles hoy para su clave: ' + TG_esc_(est.noDisp.join(', ')) + '</i>');
  lineas.push('', gm ? '<i>✅ = igual a lo que leyó la mayoría · ⚠️ = distinto (revise la foto: la mayoría también puede equivocarse). Para usar uno en la hoja: /lectores → 🔧 Modelo de Gemini. No se guardó nada.</i>'
    : '<i>✅ = igual a Gemini (el mismo modelo que lee en la hoja) · ⚠️ = distinto (revise la foto: Gemini también puede equivocarse). No se guardó nada.</i>');
  // 📌 guardar este voucher como PRUEBA del 🔭 vigía de modelos, con la lectura que usted diga que es la correcta (TG_Vigia.js)
  var buenas = res.filter(function (x) { return x.d && (x.d.nOperacion || x.d.monto); }).slice(0, 4);
  var teclado = buenas.map(function (x) {
    var d = {}; TGNV_CAMPOS_.forEach(function (c) { if (x.d[c[0]] != null && String(x.d[c[0]]).trim()) d[c[0]] = String(x.d[c[0]]).trim().slice(0, 120); });
    return [{ text: '📌 Guardar como prueba (correcto: ' + x.nom.replace(/^Gemini · /, 'Gemini ').slice(0, 28) + ')', callback_data: 'k:' + TG_guardarBoton_({ t: 'vig', a: 'guardar', id: est.id, d: d }, 21600) }];
  });
  if (teclado.length) lineas.push('<i>📌 Si una lectura está totalmente bien, guárdela como voucher de prueba: el 🔭 vigía la usa para probar modelos nuevos (/modelos).</i>');
  TG_enviar_(est.chat, lineas.join('\n'), teclado.length ? teclado : null);
}

/** Modelos gratis de Gemini que la clave ve hoy → {si: [[id, nombre]], no: [nombre]} */
function TGNV_geminiDisponibles_() {
  var k = PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)'), ids = null;
  try {
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=300', { headers: { 'x-goog-api-key': k }, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) ids = (JSON.parse(r.getContentText()).models || []).map(function (m) { return String(m.name).replace(/^models\//, ''); });
  } catch (e) {}
  if (!ids) return { si: TGNV_GEMINI_GRATIS_.slice(), no: [] };   // no se pudo ver la lista: se prueban todos (el que no exista dará error)
  return { si: TGNV_GEMINI_GRATIS_.filter(function (x) { return ids.indexOf(x[0]) >= 0; }), no: TGNV_GEMINI_GRATIS_.filter(function (x) { return ids.indexOf(x[0]) < 0; }).map(function (x) { return x[1]; }) };
}

/** Error de la IA en palabras simples (el JSON completo no se entiende en el chat). */
function TGNV_errorCorto_(e) {
  e = String(e || '');
  if (/\b503\b|overload|high demand|UNAVAILABLE/i.test(e)) return 'saturado en este momento (Google, 503): intente más tarde';
  if (/\b429\b/.test(e)) return 'sin cupo por ahora (429)';
  if (/\b404\b|not found/i.test(e)) return 'no disponible para su clave (404)';
  if (/\b413\b|too large/i.test(e)) return 'imagen demasiado grande para su límite gratis';
  return e.slice(0, 120);
}
