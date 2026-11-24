// ============================================================
// 🧪 PRUEBA DE MODELOS GEMINI (con la clave de ESTA hoja)
// ------------------------------------------------------------
// Pone a leer los MISMOS vouchers reales recientes (3 fotos + 1 PDF ya
// procesados) a todos los modelos Gemini que ve la clave, y anota en el
// «🩺 Registro técnico (sistema)» un ranking:
//   · acierto: % de datos (fecha, N° operación, monto, moneda, banco, RUC,
//     beneficiario) iguales a lo que leyó la MAYORÍA de los modelos,
//   · segundos promedio por voucher,
//   · errores (404 = la clave no tiene ese modelo, 429 = sin cupo,
//     503 = Google saturado).
// No cambia nada de la hoja ni mueve archivos: solo lee y anota.
//
// Arranca SOLA una vez por cada valor de PG_VERSION_ (al subir una versión
// nueva de este archivo): procesarVouchers llama a PG_asegurar_(), que
// programa PG_paso. La prueba corre en tandas de ~4 min (límite de 6 min
// de Google) y se reprograma hasta terminar. Para repetirla: menú
// «🧪 Probar modelos Gemini» o cambiar PG_VERSION_.
// ============================================================

var PG_VERSION_ = '2026-11-24b';
var PG_FIJOS_ = ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.7-flash',
  'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash'];
var PG_MAX_MODELOS_ = 20;
// Los de solo pago o sin cupo gratis (429 siempre en la prueba del 24/11) no se prueban: gastan tiempo.
var PG_SALTAR_ = /pro|omni|nano-banana|transcribe|customtools|-preview$/i;
var PG_CAMPOS_ = ['fecha', 'nOperacion', 'monto', 'moneda', 'banco', 'idCliente', 'proveedor'];

/** Lo llama procesarVouchers: si hay una versión nueva de la prueba, la programa (cuesta una lectura de propiedad). */
function PG_asegurar_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('PG_VER') === PG_VERSION_) return;
  props.setProperty('PG_VER', PG_VERSION_);
  PG_iniciar_('automática (versión ' + PG_VERSION_ + ')');
}

/** Menú: repetir la prueba cuando uno quiera. */
function PG_probarAhora() {
  const msg = PG_iniciar_('pedida desde el menú');
  try { SpreadsheetApp.getUi().alert('🧪 Prueba de modelos Gemini', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

function PG_iniciar_(motivo) {
  const props = PropertiesService.getScriptProperties();
  let viejo = null;
  try { viejo = JSON.parse(props.getProperty('PG_EST') || 'null'); } catch (e) {}
  if (viejo && Date.now() - viejo.t0 < 60 * 60000) return 'Ya hay una prueba en marcha. El resultado sale en el 🩺 Registro técnico.';
  PG_borrarRes_();
  const est = { motivo: motivo, t0: Date.now(), modelos: [], archivos: [], k: 0, res: {} };
  props.setProperty('PG_EST', JSON.stringify(est));
  PG_programar_(30000);
  REG_anotar_('Vouchers', 'prueba Gemini · inicio', '', motivo);
  return 'La prueba empezó en segundo plano (tarda de 5 a 20 min). El resultado sale en el 🩺 Registro técnico.';
}

function PG_programar_(ms) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'PG_paso') ScriptApp.deleteTrigger(t); });
  if (ms) ScriptApp.newTrigger('PG_paso').timeBased().after(ms).create();
}

/** Modelos Gemini que ve la clave (los que generan texto y leen imágenes). */
function PG_modelos_() {
  let ids = [];
  try {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=300&key=' + CFG.API_KEY, { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      ids = (JSON.parse(r.getContentText()).models || []).filter(function (m) {
        return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0;
      }).map(function (m) { return String(m.name).replace(/^models\//, ''); }).filter(function (id) {
        return /^gemini-/.test(id) && !/tts|image|live|audio|embed|native|computer|robotic|learnlm|aqa|exp-|veo|imagen/i.test(id);
      });
    }
  } catch (e) {}
  const lista = PG_FIJOS_.slice();
  ids.sort().reverse().forEach(function (id) { if (lista.indexOf(id) < 0 && !PG_SALTAR_.test(id)) lista.push(id); });
  return { probar: lista.slice(0, PG_MAX_MODELOS_), vistos: ids };
}

/** ¿A qué modelo apunta cada alias «-latest»? Google lo dice en los datos del modelo (versión, nombre y descripción). */
function PG_alias_(ids) {
  const alias = ids.filter(function (id) { return /latest/i.test(id); });
  if (!alias.length) return '';
  return alias.map(function (id) {
    try {
      const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + id + '?key=' + CFG.API_KEY, { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) return id + ' → (Google respondió ' + r.getResponseCode() + ')';
      const m = JSON.parse(r.getContentText());
      return id + ' → versión «' + (m.version || '?') + '» · nombre «' + (m.displayName || '?') + '»' +
        (m.description ? ' · ' + String(m.description).replace(/\s+/g, ' ').slice(0, 220) : '') +
        (m.inputTokenLimit ? ' · entrada ' + m.inputTokenLimit + ' tokens' : '');
    } catch (e) { return id + ' → (error: ' + String(e.message || e).slice(0, 80) + ')'; }
  }).join('\n');
}

/** 3 fotos y 1 PDF (chico) de los ya procesados, los más recientes. */
function PG_archivos_() {
  function recientes(idCarpeta, filtro, n) {
    const out = [], it = DriveApp.getFolderById(idCarpeta).getFiles();
    let c = 0;
    while (it.hasNext() && c < 300) {
      const f = it.next(); c++;
      if (filtro(f)) out.push({ id: f.getId(), mime: f.getMimeType(), t: f.getDateCreated().getTime() });
    }
    return out.sort(function (a, b) { return b.t - a.t; }).slice(0, n);
  }
  const fotos = recientes(CFG.CARPETA_FOTOS_PROCESADOS_ID, function (f) { return /^image\//.test(f.getMimeType()) && f.getSize() < 4000000; }, 3);
  const pdfs = recientes(CFG.CARPETA_ORIGINALES_PROCESADOS_ID, function (f) { return f.getMimeType() === 'application/pdf' && f.getSize() < 400000; }, 1);
  return fotos.concat(pdfs).map(function (x, i) { return { id: x.id, mime: x.mime, n: (x.mime === 'application/pdf' ? 'PDF' : 'foto') + ' ' + (i + 1) }; });
}

/** Disparador: lee pares (modelo, archivo) hasta ~4 min y se reprograma. */
function PG_paso() {
  const props = PropertiesService.getScriptProperties(), t0 = Date.now();
  let est = null;
  try { est = JSON.parse(props.getProperty('PG_EST') || 'null'); } catch (e) {}
  if (!est) return PG_programar_(0);
  est.res = PG_cargarRes_(est);
  PG_programar_(7 * 60000);   // vigía: si esta ejecución muere, sigue en 7 min
  if (!est.modelos.length) {
    const m = PG_modelos_();
    est.modelos = m.probar;
    try { REG_anotar_('Vouchers', 'alias de Gemini', '', PG_alias_(m.vistos.length ? m.vistos : PG_FIJOS_) || 'La clave no ve alias «-latest».'); } catch (e) {}
    props.setProperty('PG_VISTOS', m.vistos.join(', ').slice(0, 3000));
    est.archivos = PG_archivos_();
    if (!est.archivos.length) {
      props.deleteProperty('PG_EST'); PG_programar_(0);
      REG_anotar_('Vouchers', 'prueba Gemini · fin', 0, 'No encontré vouchers procesados para usar de prueba.');
      return;
    }
  }
  const nA = est.archivos.length, total = est.modelos.length * nA, blobs = {};
  while (est.k < total && Date.now() - t0 < 4 * 60000) {
    const k = est.k, mod = est.modelos[Math.floor(k / nA)], a = est.archivos[k % nA];
    const r = est.res[mod] || (est.res[mod] = { l: [], err: '', nd: false });
    est.k++;
    if (r.nd) continue;
    if (!blobs[a.id]) blobs[a.id] = Utilities.base64Encode(DriveApp.getFileById(a.id).getBlob().getBytes());
    const t1 = Date.now(), x = PG_leer_(mod, blobs[a.id], a.mime);
    const seg = Math.round((Date.now() - t1) / 100) / 10;
    if (x.err) {
      r.err = x.err; r.l.push({ a: k % nA, e: x.err.slice(0, 12), s: seg });
      if (/^(404|403|400)/.test(x.err)) r.nd = true;
    } else r.l.push({ a: k % nA, d: x.d, s: seg });
    PG_guardarEst_(est);
  }
  PG_guardarEst_(est);
  if (est.k < total) return PG_programar_(20000);
  props.deleteProperty('PG_EST');
  PG_borrarRes_();
  PG_programar_(0);
  PG_informe_(est);
}

// Los resultados de cada modelo van en su propia propiedad (PG_R_<n>): todos juntos pasarían el límite de 9 KB por propiedad.
function PG_guardarEst_(est) {
  const props = PropertiesService.getScriptProperties(), copia = {};
  Object.keys(est).forEach(function (k) { if (k !== 'res') copia[k] = est[k]; });
  est.modelos.forEach(function (m, i) { if (est.res[m]) props.setProperty('PG_R_' + i, JSON.stringify(est.res[m])); });
  props.setProperty('PG_EST', JSON.stringify(copia));
}
function PG_cargarRes_(est) {
  const todas = PropertiesService.getScriptProperties().getProperties(), res = est.res || {};
  (est.modelos || []).forEach(function (m, i) { if (todas['PG_R_' + i]) { try { res[m] = JSON.parse(todas['PG_R_' + i]); } catch (e) {} } });
  return res;
}
function PG_borrarRes_() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(function (k) { if (/^PG_R_\d+$/.test(k)) props.deleteProperty(k); });
}

/** Una lectura directa (sin respaldos ni memoria de 404). → {d:'campo|campo…'} o {err:'503 …'} */
function PG_leer_(modelo, base64, mime) {
  const pdf = mime === 'application/pdf';
  const payload = { contents: [{ parts: [{ text: pdf ? PROMPT_PDF : PROMPT_IMAGEN }, { inline_data: { mime_type: mime, data: base64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 32768, responseMimeType: 'application/json' } };
  for (let intento = 0; intento < 2; intento++) {
    let resp;
    try {
      resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent?key=' + CFG.API_KEY,
        { method: 'POST', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    } catch (e) { return { err: 'red ' + String(e.message || e).slice(0, 60) }; }
    const code = resp.getResponseCode();
    if (code === 200) {
      try {
        const v = parsearRespuestaGemini_(resp)[0] || {};
        return { d: PG_CAMPOS_.map(function (c) { return PG_norm_(c, v[c]); }).join('|') };
      } catch (e) { return { err: 'respuesta ilegible' }; }
    }
    if ((code === 503 || code === 500) && intento === 0) { Utilities.sleep(6000); continue; }
    let msg = '';
    try { msg = (JSON.parse(resp.getContentText()).error || {}).message || ''; } catch (e) {}
    return { err: code + ' ' + String(msg).slice(0, 90) };
  }
}

function PG_norm_(c, v) {
  let s = String(v == null ? '' : v).trim().toUpperCase();
  if (c === 'monto') { const n = parseFloat(s.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? '' : n.toFixed(2); }
  if (c === 'nOperacion' || c === 'idCliente') return s.replace(/[^0-9A-Z]/g, '').replace(/^0+/, '');
  if (c === 'proveedor' || c === 'banco') return s.normalize('NFD').replace(/[^A-Z]/g, '').slice(0, 10);
  return s.replace(/\s+/g, '').replace(/\|/g, '');
}

function PG_informe_(est) {
  const nA = est.archivos.length, mods = est.modelos;
  // Lo «correcto» de cada archivo y campo = lo que leyó la mayoría de los modelos que respondieron.
  const mayoria = [];
  for (let a = 0; a < nA; a++) {
    mayoria.push(PG_CAMPOS_.map(function (c, i) {
      const votos = {};
      mods.forEach(function (m) { ((est.res[m] || {}).l || []).forEach(function (x) { if (x.a === a && x.d) { const v = x.d.split('|')[i]; if (v) votos[v] = (votos[v] || 0) + 1; } }); });
      let mejor = '', n = 0;
      Object.keys(votos).forEach(function (v) { if (votos[v] > n) { mejor = v; n = votos[v]; } });
      return n >= 2 ? mejor : '';   // con un solo voto no hay mayoría: ese dato no se califica
    }));
  }
  const filas = mods.map(function (m) {
    const r = est.res[m] || { l: [] }, ok = r.l.filter(function (x) { return x.d; });
    let bien = 0, campos = 0, seg = 0;
    ok.forEach(function (x) {
      seg += x.s;
      x.d.split('|').forEach(function (v, i) { const esp = mayoria[x.a][i]; if (esp) { campos++; if (v === esp) bien++; } });
    });
    const errs = r.l.filter(function (x) { return x.e; }).map(function (x) { return x.e.split(' ')[0]; });
    return { m: m, nd: r.nd && !ok.length, err: r.err, lect: ok.length, intentos: r.l.length, pct: campos ? Math.round(bien / campos * 100) : -1,
      bien: bien, campos: campos, seg: ok.length ? Math.round(seg / ok.length * 10) / 10 : 0, errs: errs };
  }).sort(function (a, b) { return (a.nd - b.nd) || (b.pct - a.pct) || (b.lect - a.lect) || (a.seg - b.seg); });
  const L = ['Archivos: ' + est.archivos.map(function (a) { return a.n; }).join(', ') + ' · ' + Math.round((Date.now() - est.t0) / 60000) + ' min'];
  let n = 0;
  filas.filter(function (f) { return !f.nd; }).forEach(function (f) {
    L.push((++n) + '. ' + f.m + ' · acierto ' + (f.pct >= 0 ? f.pct + '% (' + f.bien + '/' + f.campos + ')' : '—') +
      ' · ' + f.seg + ' s · leyó ' + f.lect + '/' + f.intentos + (f.errs.length ? ' · errores: ' + f.errs.join(',') : ''));
  });
  const nd = filas.filter(function (f) { return f.nd; });
  if (nd.length) L.push('NO disponibles para la clave: ' + nd.map(function (f) { return f.m + ' (' + f.err.slice(0, 80) + ')'; }).join(' · '));
  L.push('Modelos que ve la clave: ' + (PropertiesService.getScriptProperties().getProperty('PG_VISTOS') || '(no se pudo ver la lista)'));
  REG_anotar_('Vouchers', 'prueba Gemini · fin', Math.round((Date.now() - est.t0) / 1000), L.join('\n'));
}
