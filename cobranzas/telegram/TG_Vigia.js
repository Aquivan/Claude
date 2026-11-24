/**
 * 🔭 VIGÍA DE MODELOS DE IA para leer vouchers (Gemini, NVIDIA, Groq).
 *
 *   · Cada LUNES (~7 am) revisa solo qué modelos que leen imágenes ve hoy cada clave. Si hay NUEVOS, los prueba con los
 *     📌 vouchers de prueba y avisa a los administradores por Telegram con el ranking y un botón «⭐ Usar».
 *     También avisa si un modelo que se está usando DESAPARECIÓ, y una vez al mes re-prueba todo (¿sigue funcionando?).
 *   · Nunca cambia de modelo solo: siempre se elige con un toque (⭐ Usar) o en /lectores.
 *   · 📌 Vouchers de prueba: en el resultado de «comparar», botón «📌 Guardar como prueba (correcto: X)». Quedan en Drive
 *     (carpeta «🧪 Vouchers de prueba (lectores IA)») con la respuesta correcta en la descripción del archivo.
 *   · A mano: /modelos en Telegram (🔭 buscar nuevos · 🧪 probar todos · 📌 pruebas), o en la hoja:
 *     🧠 Asistente IA → 🧾 Lectores de vouchers (botones 🔭 y 🧪; ahí se ve la última prueba).
 *   · La prueba corre en SEGUNDO PLANO por tandas (Google corta a los 6 min): un vigía retoma si algo se cuelga.
 * Funciones VIG_.
 */

var VIG_CARPETA_ = '🧪 Vouchers de prueba (lectores IA)';
var VIG_MAX_PRUEBAS_ = 5;          // vouchers de prueba por corrida (los más recientes)
var VIG_MAX_POR_PROV_ = 8;         // modelos por proveedor en «probar todos»
var VIG_RX_ = /^\s*\/?modelos?(\s|$)/i;
var VIG_NOMPROV_ = { gemini: 'Gemini', nvidia: 'NVIDIA', groq: 'Groq' };

/* ------------------------------------------------ vouchers de prueba */

function VIG_carpeta_() {
  var ss = TG_ss_(), padres = DriveApp.getFileById(ss.getId()).getParents();
  var base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder(), it = base.getFoldersByName(VIG_CARPETA_);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return base.createFolder(VIG_CARPETA_);
}

/** [{id, nombre, mime, esp, fecha}] del más nuevo al más viejo. */
function VIG_pruebas_() {
  var out = [], it = VIG_carpeta_().getFiles();
  while (it.hasNext()) {
    var f = it.next(), esp = null;
    if (f.isTrashed()) continue;
    try { esp = JSON.parse(f.getDescription() || 'null'); } catch (e) {}
    if (esp) out.push({ id: f.getId(), nombre: f.getName(), mime: f.getMimeType(), esp: esp, fecha: f.getDateCreated().getTime() });
  }
  return out.sort(function (a, b) { return b.fecha - a.fecha; });
}

function VIG_guardarPrueba_(id, d) {
  var esp = {};
  TGNV_CAMPOS_.forEach(function (c) { if (d && d[c[0]] != null && String(d[c[0]]).trim()) esp[c[0]] = String(d[c[0]]).trim(); });
  if (!esp.nOperacion && !esp.monto) throw new Error('esa lectura no trae número de operación ni monto: no sirve como prueba.');
  var f = DriveApp.getFileById(id);
  if (f.isTrashed()) f.setTrashed(false);   // «comparar» la mandó a la papelera al terminar: se recupera
  f.moveTo(VIG_carpeta_());
  f.setName('prueba ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmm') + ' ' + (esp.banco || '') + ' ' + (esp.nOperacion || ''));
  f.setDescription(JSON.stringify(esp));
  return esp;
}

/* ------------------------------------------------ 🔭 buscar modelos */

function VIG_candidatos_() {
  var out = {}, errores = {};
  Object.keys(VIG_NOMPROV_).forEach(function (p) {
    try { out[p] = LECT_listaModelos_(p); } catch (e) { out[p] = []; errores[p] = String(e.message || e).slice(0, 100); }
  });
  return { modelos: out, errores: errores };
}

/** Compara con lo visto la última vez. → {modelos, nuevos:[{p,m}], perdidos:[{p,m}], primeraVez, errores} */
function VIG_buscar_() {
  var props = PropertiesService.getScriptProperties(), vistos = null;
  try { vistos = JSON.parse(props.getProperty('VIG_VISTOS') || 'null'); } catch (e) {}
  var c = VIG_candidatos_(), nuevos = [], perdidos = [], cfg = LECT_cfg_();
  Object.keys(c.modelos).forEach(function (p) {
    if (c.errores[p]) return;   // si no se pudo ver la lista, no se compara (no es «desapareció»)
    if (vistos && vistos[p]) c.modelos[p].forEach(function (m) { if (vistos[p].indexOf(m) < 0) nuevos.push({ p: p, m: m }); });
    var usado = cfg.modelo[p];
    if (usado && p !== 'groq' && c.modelos[p].length && c.modelos[p].indexOf(usado) < 0 && !LECT_listaContiene_(p, usado)) perdidos.push({ p: p, m: usado });
  });
  var guardar = vistos || {};
  Object.keys(c.modelos).forEach(function (p) { if (!c.errores[p]) guardar[p] = c.modelos[p]; });
  props.setProperty('VIG_VISTOS', JSON.stringify(guardar));
  props.setProperty('VIG_BUSCADO', String(Date.now()));
  return { modelos: c.modelos, errores: c.errores, nuevos: nuevos, perdidos: perdidos, primeraVez: !vistos };
}

/** La lista de LECT_ es la de «leen imágenes» y se corta en 12: antes de decir «desapareció», se mira la lista completa. */
function LECT_listaContiene_(p, m) {
  try {
    if (p === 'gemini') {
      var k = PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)');
      var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m), { headers: { 'x-goog-api-key': k }, muteHttpExceptions: true });
      return r.getResponseCode() === 200;
    }
    var r2 = UrlFetchApp.fetch('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: 'Bearer ' + CIA_nvClave_() }, muteHttpExceptions: true });
    return (JSON.parse(r2.getContentText()).data || []).some(function (x) { return String(x.id) === m; });
  } catch (e) { return true; }   // ante la duda, no alarmar
}

function VIG_textoBusqueda_(b) {
  var cfg = LECT_cfg_(), L = ['🔭 <b>Modelos que leen imágenes que ven hoy sus claves</b>', ''];
  Object.keys(VIG_NOMPROV_).forEach(function (p) {
    var nuevosP = b.nuevos.filter(function (x) { return x.p === p; }).map(function (x) { return x.m; });
    L.push('<b>' + VIG_NOMPROV_[p] + '</b>' + (b.errores[p] ? ' — ⚠️ ' + TG_esc_(b.errores[p]) : ''));
    (b.modelos[p] || []).forEach(function (m) {
      L.push('  ' + (nuevosP.indexOf(m) >= 0 ? '🆕 ' : '• ') + '<code>' + TG_esc_(m) + '</code>' + (VIG_enUso_(cfg, p) === m ? ' ⭐ en uso' : ''));
    });
  });
  if (b.primeraVez) L.push('', '<i>Primera revisión: desde ahora le aviso cuando aparezca uno nuevo.</i>');
  else if (!b.nuevos.length) L.push('', '<i>No hay modelos nuevos desde la última revisión.</i>');
  if (b.perdidos.length) L.push('', '⚠️ <b>Ya no aparece</b> el modelo en uso: ' + b.perdidos.map(function (x) { return VIG_NOMPROV_[x.p] + ' <code>' + TG_esc_(x.m) + '</code>'; }).join(', ') +
    '. La hoja sigue con los de reserva; elija otro en /lectores.');
  return L.join('\n');
}

/* ------------------------------------------------ 🧪 probar (en segundo plano, por tandas) */

/** items: [{p, m}] · chat: a quién responder ('' = a todos los administradores). → texto para mostrar */
function VIG_probar_(chat, items, motivo) {
  var pruebas = VIG_pruebas_().slice(0, VIG_MAX_PRUEBAS_);
  if (!pruebas.length) return '📌 Todavía no hay vouchers de prueba. Mande una foto al bot con «comparar» (o «comparar gemini») y, en el resultado, toque «📌 Guardar como prueba» en la lectura correcta. Con 3 a 5 vouchers distintos (BCP, BBVA, SUNAT, PDF…) la prueba es confiable.';
  var props = PropertiesService.getScriptProperties();
  var viejo = null; try { viejo = JSON.parse(props.getProperty('VIG_EST') || 'null'); } catch (e) {}
  if (viejo && Date.now() - viejo.t0 < 90 * 60000) return '⏳ Ya hay una prueba en marcha (' + viejo.k + ' de ' + viejo.items.length * viejo.tests.length + '). Le aviso al terminar.';
  var vistos = {}, its = [];
  (items || []).forEach(function (x) { var k = x.p + '|' + x.m; if (!vistos[k] && VIG_NOMPROV_[x.p] && x.m) { vistos[k] = 1; its.push({ p: x.p, m: x.m }); } });
  if (!its.length) return 'No hay modelos para probar.';
  var est = { chat: chat || '', motivo: motivo || '', items: its, tests: pruebas.map(function (t) { return { id: t.id, mime: t.mime, esp: t.esp }; }),
    k: 0, res: {}, enCurso: null, t0: Date.now() };
  props.setProperty('VIG_EST', JSON.stringify(est));
  VIG_programar_(1000);
  return '🧪 Probando <b>' + its.length + ' modelos</b> con <b>' + pruebas.length + ' vouchers de prueba</b> (' + its.length * pruebas.length + ' lecturas), en segundo plano. Puede tardar de 5 a 30 min; le aviso con el ranking al terminar.';
}

function VIG_todos_() {
  var c = VIG_candidatos_(), out = [];
  Object.keys(c.modelos).forEach(function (p) { c.modelos[p].slice(0, VIG_MAX_POR_PROV_).forEach(function (m) { out.push({ p: p, m: m }); }); });
  return out;
}

/** El modelo que usa cada lector (Groq «automático» = el que encuentra en su lista). */
function VIG_enUso_(cfg, p) {
  if (cfg.modelo[p]) return cfg.modelo[p];
  if (p === 'groq') { try { var k = TGNV_groqClave_(); return k ? TGNV_groqModelo_(k) : ''; } catch (e) { return ''; } }
  return '';
}

function VIG_actuales_() {
  var cfg = LECT_cfg_(), out = [];
  Object.keys(VIG_NOMPROV_).forEach(function (p) { var m = VIG_enUso_(cfg, p); if (cfg.apagados.indexOf(p) < 0 && m) out.push({ p: p, m: m }); });
  return out;
}

function VIG_programar_(ms) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'VIG_paso') ScriptApp.deleteTrigger(t); });
  if (ms) ScriptApp.newTrigger('VIG_paso').timeBased().after(ms).create();
}

/** Disparador: lee pares (modelo, voucher) hasta ~4 min y se reprograma. */
function VIG_paso__reg() {
  var props = PropertiesService.getScriptProperties(), est, t0 = Date.now();
  try { est = JSON.parse(props.getProperty('VIG_EST') || 'null'); } catch (e) { est = null; }
  if (!est) return VIG_programar_(0);
  var nT = est.tests.length, total = est.items.length * nT;
  if (est.enCurso != null) { VIG_anotar_(est, est.enCurso, null, 'no respondió a tiempo (más de 5 min)', 0); est.k = est.enCurso + 1; est.enCurso = null; }
  VIG_programar_(6.5 * 60000);   // vigía por si esta ejecución muere
  var lc = LECT_cfg_();
  while (est.k < total && Date.now() - t0 < 4.2 * 60000) {
    var k = est.k, it = est.items[Math.floor(k / nT)], r = est.res[it.p + '|' + it.m];
    if (r && r.noDisp) { est.k++; continue; }
    est.enCurso = k; props.setProperty('VIG_EST', JSON.stringify(est));
    var t1 = Date.now(), d = null, err = '';
    try { d = VIG_leer_(it.p, it.m, est.tests[k % nT], lc); } catch (e) { err = String(e.message || e); }
    VIG_anotar_(est, k, d, err, (Date.now() - t1) / 1000);
    est.k = k + 1; est.enCurso = null;
    props.setProperty('VIG_EST', JSON.stringify(est));
  }
  if (est.k < total) return VIG_programar_(15000);
  props.deleteProperty('VIG_EST');
  VIG_programar_(0);
  VIG_mostrar_(est);
}

function VIG_leer_(p, m, t, lc) {
  var f = DriveApp.getFileById(t.id), pdf = /pdf/i.test(t.mime), adj;
  if (pdf && p !== 'gemini') adj = { base64: TGNV_vistaPrevia_({ id: t.id }, 2048), mime: 'image/jpeg' };
  else if (p === 'groq' && f.getSize() > 330000) adj = { base64: TGNV_vistaPrevia_({ id: t.id }, 1280), mime: 'image/jpeg' };
  else adj = { base64: Utilities.base64Encode(f.getBlob().getBytes()), mime: t.mime };
  var pedido = 'Analiza este comprobante y responde SOLO el JSON del formato indicado.';
  var instr = typeof TGNV_PROMPT_VOUCHER_ === 'string' && TGNV_PROMPT_VOUCHER_ ? TGNV_PROMPT_VOUCHER_ : TGNV_SISTEMA_, d;
  if (p === 'gemini') {
    d = IA_llamar_({ proveedor: 'Gemini (Google)', clave: PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)'),
      modelo: m, sistema: instr, texto: pedido, maxTokens: 16000, adjunto: adj });
  } else if (p === 'nvidia') {
    var pn = !!lc.razonar.nvidia;
    d = IA_llamar_({ proveedor: 'NVIDIA · Nemotron 3.5 Super VL (lee imágenes)', clave: CIA_nvClave_(), modelo: m, sistema: instr, texto: pedido,
      maxTokens: pn ? 16000 : 4000, pensar: pn, detalle: 'high', adjunto: adj });
  } else {
    // Groq gratis: ~3 lecturas por minuto. Se espera lo necesario entre una y otra.
    var props = PropertiesService.getScriptProperties(), ult = Number(props.getProperty('VIG_GROQ_ULT') || 0), falta = 21000 - (Date.now() - ult);
    if (falta > 0) Utilities.sleep(falta);
    props.setProperty('VIG_GROQ_ULT', String(Date.now()));
    var pg = !!lc.razonar.groq;
    d = IA_llamar_({ proveedor: 'Groq · visión', clave: TGNV_groqClave_(), modelo: m, sinKwargs: true, pensar: pg, sistema: TGNV_PROMPT_CORTO_, texto: pedido,
      maxTokens: pg ? 4000 : 1500, adjunto: adj });
  }
  if (Array.isArray(d)) d = d[0] || {};
  return d || {};
}

function VIG_anotar_(est, k, d, err, seg) {
  var nT = est.tests.length, it = est.items[Math.floor(k / nT)], key = it.p + '|' + it.m, t = est.tests[k % nT];
  var r = est.res[key] || (est.res[key] = { campos: 0, ok: 0, lect: 0, fallos: 0, seg: 0, err: '', noDisp: false });
  if (err) {
    r.fallos++; r.err = TGNV_errorCorto_(err);
    if (/\b(404|403|401)\b|not found|permission|PERMISSION|quota.*(free|limit: ?0)|limit: ?0/i.test(err)) r.noDisp = true;
    return;
  }
  r.lect++; r.seg += seg;
  Object.keys(t.esp).forEach(function (c) {
    r.campos++;
    if (TGNV_norm_(c, d[c]) === TGNV_norm_(c, t.esp[c])) r.ok++;
  });
}

function VIG_ranking_(est) {
  var cfg = LECT_cfg_(), uso = {};
  Object.keys(VIG_NOMPROV_).forEach(function (p) { uso[p] = VIG_enUso_(cfg, p); });
  return est.items.map(function (it) {
    var r = est.res[it.p + '|' + it.m] || { campos: 0, ok: 0, lect: 0, fallos: 0, seg: 0, err: '', noDisp: true };
    return { p: it.p, m: it.m, pct: r.campos ? Math.round(r.ok / r.campos * 100) : -1, ok: r.ok, campos: r.campos, lect: r.lect, fallos: r.fallos,
      seg: r.lect ? Math.round(r.seg / r.lect * 10) / 10 : 0, err: r.err, noDisp: r.noDisp && !r.lect, enUso: uso[it.p] === it.m };
  }).sort(function (a, b) { return (a.noDisp - b.noDisp) || (b.pct - a.pct) || (a.fallos - b.fallos) || (a.seg - b.seg); });
}

function VIG_mostrar_(est) {
  var rk = VIG_ranking_(est), med = ['🥇', '🥈', '🥉'], n = 0;
  var L = ['🔭 <b>Prueba de modelos para leer vouchers</b>' + (est.motivo ? ' (' + TG_esc_(est.motivo) + ')' : ''),
    '<i>' + est.tests.length + ' vouchers de prueba · ' + Math.round((Date.now() - est.t0) / 60000) + ' min</i>', ''];
  rk.filter(function (x) { return !x.noDisp; }).forEach(function (x) {
    L.push((med[n++] || n + '.') + ' <b>' + VIG_NOMPROV_[x.p] + '</b> <code>' + TG_esc_(x.m.split('/').pop()) + '</code> · ' +
      (x.pct >= 0 ? '<b>' + x.pct + '%</b> (' + x.ok + '/' + x.campos + ' datos)' : '—') + ' · ' + x.seg + ' s' +
      (x.fallos ? ' · ❌ ' + x.fallos + ' fallo(s): ' + TG_esc_(x.err) : '') + (x.enUso ? ' · ⭐ en uso' : ''));
  });
  var nd = rk.filter(function (x) { return x.noDisp; });
  if (nd.length) L.push('', '<i>No disponibles para sus claves (o solo de pago): ' + TG_esc_(nd.map(function (x) { return x.m.split('/').pop(); }).join(', ')) + '</i>');
  L.push('', '<i>% = datos iguales a la respuesta correcta de sus vouchers de prueba (banco, fecha, N° de operación, monto, beneficiario…). Toque ⭐ para usar uno; nada cambia solo.</i>');
  var mejores = rk.filter(function (x) { return !x.noDisp && !x.enUso && x.pct >= 0; }).slice(0, 5);
  var teclado = mejores.map(function (x) {
    return [{ text: '⭐ Usar ' + x.m.split('/').pop().slice(0, 30) + ' (' + VIG_NOMPROV_[x.p] + ')', callback_data: 'k:' + TG_guardarBoton_({ t: 'vig', a: 'usar', p: x.p, m: x.m }, 21600) }];
  });
  PropertiesService.getScriptProperties().setProperty('VIG_ULTIMO', JSON.stringify({ fecha: Date.now(), motivo: est.motivo, pruebas: est.tests.length,
    rk: rk.slice(0, 25).map(function (x) { return { p: x.p, m: x.m, pct: x.pct, ok: x.ok, campos: x.campos, seg: x.seg, fallos: x.fallos, noDisp: x.noDisp, enUso: x.enUso }; }) }).slice(0, 8500));
  VIG_enviar_(est.chat, L.join('\n'), teclado.length ? teclado : null);
}

function VIG_enviar_(chat, html, teclado) {
  if (chat) return TG_enviar_(chat, html, teclado);
  TG_admins_(TG_ss_()).forEach(function (a) { try { TG_enviar_(a.chatId, html, teclado); } catch (e) {} });
}

/* ------------------------------------------------ ⏰ cada lunes */

function VIG_asegurar_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('VIG_TRIGGER') === '1') return;
  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'VIG_semanal'; });
  if (!hay) ScriptApp.newTrigger('VIG_semanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  props.setProperty('VIG_TRIGGER', '1');
}

function VIG_semanal__reg() {
  var b = VIG_buscar_(), props = PropertiesService.getScriptProperties(), ult = null;
  try { ult = JSON.parse(props.getProperty('VIG_ULTIMO') || 'null'); } catch (e) {}
  var hayPruebas = VIG_pruebas_().length > 0;
  try {   // 🤖 otras tareas (TG_IATareas.js): modelos nuevos de voz (Whisper) y de búsqueda web: solo aviso, se eligen en /ia
    var otros = IAT_nuevos_();
    if (otros.length) VIG_enviar_('', '🆕 <b>Modelos nuevos para otras tareas</b>:\n' + otros.join('\n') + '\n\n<i>Para usar uno: /ia → 🔧 en esa tarea.</i>');
  } catch (e) {}
  if (b.nuevos.length || b.perdidos.length) {
    VIG_enviar_('', '🆕 ' + VIG_textoBusqueda_(b) + (b.nuevos.length && !hayPruebas ? '\n\n📌 Para que los pruebe solo, guarde vouchers de prueba (resultado de «comparar» → 📌).' : ''));
    if (b.nuevos.length && hayPruebas) VIG_probar_('', b.nuevos.concat(VIG_actuales_()), 'modelos nuevos');
    return;
  }
  // una vez al mes: ¿los que se usan siguen funcionando y siguen siendo los mejores?
  if (hayPruebas && (!ult || Date.now() - ult.fecha > 28 * 86400000)) VIG_probar_('', VIG_todos_(), 'revisión mensual');
}

/* ------------------------------------------------ Telegram: /modelos */

function VIG_tg_(ctx, texto) {
  if (!VIG_RX_.test(texto || '')) return false;
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return false;
  var arg = String(texto).trim().replace(/^\/?\S+\s*/, '').toLowerCase();
  try {
    if (/^busc/.test(arg)) return VIG_tgBuscar_(ctx), true;
    if (/^prob/.test(arg)) return TG_enviar_(ctx.chatId, VIG_probar_(String(ctx.chatId), VIG_todos_(), 'a pedido')), true;
    if (/^prueba/.test(arg)) return VIG_tgPruebas_(ctx), true;
    VIG_panel_(ctx);
  } catch (e) { TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
  return true;
}

/** «prueba 2 nOperacion=D00005004567-1»: corrige la respuesta correcta de un voucher de prueba. */
var VIG_RX_CORR_ = /^\s*prueba\s+(\d+)\s+(\w+)\s*=\s*(.+)$/i;
function VIG_tgCorregir_(ctx, texto) {
  var m = String(texto || '').match(VIG_RX_CORR_);
  if (!m || !ctx.usuario || ctx.usuario.rol !== 'admin') return false;
  var pr = VIG_pruebas_()[Number(m[1]) - 1], campo = TGNV_CAMPOS_.filter(function (c) { return c[0].toLowerCase() === m[2].toLowerCase(); })[0];
  if (!pr) { TG_enviar_(ctx.chatId, 'No hay voucher de prueba ' + m[1] + ' (vea /modelos pruebas).'); return true; }
  if (!campo) { TG_enviar_(ctx.chatId, 'Dato desconocido. Use uno de: ' + TGNV_CAMPOS_.map(function (c) { return c[0]; }).join(', ')); return true; }
  pr.esp[campo[0]] = m[3].trim();
  DriveApp.getFileById(pr.id).setDescription(JSON.stringify(pr.esp));
  TG_enviar_(ctx.chatId, '✅ Prueba ' + m[1] + ': ' + campo[1] + ' = <code>' + TG_esc_(m[3].trim()) + '</code>');
  return true;
}

function VIG_panel_(ctx) {
  var props = PropertiesService.getScriptProperties(), ult = null, bus = Number(props.getProperty('VIG_BUSCADO') || 0), nP = VIG_pruebas_().length;
  try { ult = JSON.parse(props.getProperty('VIG_ULTIMO') || 'null'); } catch (e) {}
  var f = function (ms) { return Utilities.formatDate(new Date(ms), 'America/Lima', 'dd/MM HH:mm'); };
  var L = ['🔭 <b>Vigía de modelos de IA</b> (para leer vouchers)', '',
    'Cada lunes reviso si Gemini, NVIDIA o Groq sacaron modelos nuevos que leen imágenes; si hay, los pruebo con sus vouchers de prueba y le aviso con el ranking. Una vez al mes re-pruebo todo. Nunca cambio de modelo sin su ⭐.', '',
    '🔭 Última revisión: ' + (bus ? f(bus) : 'todavía no'),
    '📌 Vouchers de prueba: <b>' + nP + '</b>' + (nP < 3 ? ' <i>(conviene 3 a 5 distintos: guárdelos desde «comparar» → 📌)</i>' : '')];
  if (ult && ult.rk) {
    L.push('🧪 Última prueba: ' + f(ult.fecha) + (ult.motivo ? ' (' + TG_esc_(ult.motivo) + ')' : ''));
    ult.rk.filter(function (x) { return !x.noDisp; }).slice(0, 3).forEach(function (x, i) {
      L.push('   ' + ['🥇', '🥈', '🥉'][i] + ' ' + VIG_NOMPROV_[x.p] + ' <code>' + TG_esc_(x.m.split('/').pop()) + '</code> · ' + (x.pct >= 0 ? x.pct + '%' : '—') + ' · ' + x.seg + ' s' + (x.enUso ? ' ⭐' : ''));
    });
  }
  var b = function (t, d) { return { text: t, callback_data: 'k:' + TG_guardarBoton_(d, 21600) }; };
  TG_enviar_(ctx.chatId, L.join('\n'), [
    [b('🔭 Buscar modelos nuevos ahora', { t: 'vig', a: 'buscar' })],
    [b('🧪 Probar todos ahora', { t: 'vig', a: 'probar' }), b('🧪 Solo los que uso', { t: 'vig', a: 'actuales' })],
    [b('📌 Vouchers de prueba (' + nP + ')', { t: 'vig', a: 'pruebas' })]]);
}

function VIG_tgBuscar_(ctx) {
  TG_accion_(ctx.chatId, 'typing');
  var r = VIG_buscar_(), otros = [];
  try { otros = IAT_nuevos_(); } catch (e) {}
  var teclado = r.nuevos.length ? [[{ text: '🧪 Probar los ' + r.nuevos.length + ' nuevos (vs. los que uso)', callback_data: 'k:' + TG_guardarBoton_({ t: 'vig', a: 'probarNuevos', items: r.nuevos.slice(0, 15) }, 21600) }]] : null;
  TG_enviar_(ctx.chatId, VIG_textoBusqueda_(r) + (otros.length ? '\n\n🆕 <b>Otras tareas</b> (/ia):\n' + otros.join('\n') : ''), teclado);
}

function VIG_tgPruebas_(ctx) {
  var pr = VIG_pruebas_();
  if (!pr.length) return TG_enviar_(ctx.chatId, VIG_probar_(String(ctx.chatId), [], ''));
  var L = ['📌 <b>Vouchers de prueba</b> (se usan los ' + VIG_MAX_PRUEBAS_ + ' más recientes)', ''];
  pr.forEach(function (t, i) {
    L.push((i + 1) + '. ' + TG_esc_([t.esp.banco, t.esp.nOperacion, t.esp.moneda, t.esp.monto, t.esp.proveedor].filter(Boolean).join(' · ')) + (i >= VIG_MAX_PRUEBAS_ ? ' <i>(no se usa)</i>' : ''));
  });
  L.push('', '<i>Para corregir la respuesta correcta: «prueba 1 nOperacion=D00005004567-1» (datos: ' + TGNV_CAMPOS_.map(function (c) { return c[0]; }).join(', ') + ').</i>');
  var teclado = pr.slice(0, 10).map(function (t, i) { return [{ text: '🗑 Quitar ' + (i + 1), callback_data: 'k:' + TG_guardarBoton_({ t: 'vig', a: 'quitar', id: t.id }, 21600) }]; });
  TG_enviar_(ctx.chatId, L.join('\n'), teclado);
}

function VIG_alBoton_(ctx, d) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo para administradores.');
  var chat = String(ctx.chatId);
  try {
    switch (d.a) {
      case 'buscar': return VIG_tgBuscar_(ctx);
      case 'probar': return TG_enviar_(chat, VIG_probar_(chat, VIG_todos_(), 'a pedido'));
      case 'actuales': return TG_enviar_(chat, VIG_probar_(chat, VIG_actuales_(), 'los que se usan'));
      case 'probarNuevos': return TG_enviar_(chat, VIG_probar_(chat, (d.items || []).concat(VIG_actuales_()), 'modelos nuevos'));
      case 'pruebas': return VIG_tgPruebas_(ctx);
      case 'quitar': DriveApp.getFileById(d.id).setTrashed(true); return TG_enviar_(chat, '🗑 Voucher de prueba quitado.');
      case 'guardar': {
        var esp = VIG_guardarPrueba_(d.id, d.d);
        return TG_enviar_(chat, '📌 Guardado como voucher de prueba (' + VIG_pruebas_().length + ' en total): ' +
          TG_esc_([esp.banco, esp.nOperacion, esp.monto].filter(Boolean).join(' · ')) + '. Si algún dato no es correcto: /modelos → 📌 Vouchers de prueba.');
      }
      case 'usar': {
        var cfg = LECT_cfg_();
        cfg.modelo[d.p] = d.m;
        if (cfg.apagados.indexOf(d.p) >= 0) { cfg.apagados = cfg.apagados.filter(function (x) { return x !== d.p; }); cfg.orden = cfg.orden.filter(function (x) { return cfg.apagados.indexOf(x) < 0; }).concat(cfg.apagados); }
        LECT_guardar_(cfg);
        return TG_enviar_(chat, '⭐ ' + VIG_NOMPROV_[d.p] + ' usará <code>' + TG_esc_(d.m) + '</code>. El orden entre Gemini, NVIDIA y Groq se cambia en /lectores.');
      }
    }
  } catch (e) { TG_enviar_(chat, '⚠️ ' + TG_esc_(e.message)); }
}

/* ------------------------------------------------ para la ventana de la hoja (LectoresVista.html) */

function VIG_ultimoHoja_() {
  var ult = null; try { ult = JSON.parse(PropertiesService.getScriptProperties().getProperty('VIG_ULTIMO') || 'null'); } catch (e) {}
  return { ultimo: ult, pruebas: VIG_pruebas_().length, buscado: Number(PropertiesService.getScriptProperties().getProperty('VIG_BUSCADO') || 0) };
}
function LECT_buscarHoja() {
  var r = VIG_buscar_();
  return { texto: VIG_textoBusqueda_(r).replace(/<[^>]+>/g, ''), nuevos: r.nuevos };
}
function LECT_probarHoja(soloNuevos) {
  var items = soloNuevos ? VIG_buscar_().nuevos.concat(VIG_actuales_()) : VIG_todos_();
  return { texto: VIG_probar_('', items, 'a pedido desde la hoja').replace(/<[^>]+>/g, '') + ' (el resultado llega por Telegram a los administradores y aparece aquí al reabrir esta ventana).' };
}
