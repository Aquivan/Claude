// ============================================================
// 🧾 LECTORES DE VOUCHERS: respaldo automático entre IAs
// ------------------------------------------------------------
// llamarGemini (Gemini.js) pasa por aquí: se prueba cada lector en el
// orden configurado y, si uno falla (saturado, sin cupo, caído), se pasa
// AL MOMENTO al siguiente. Orden por defecto: Gemini → NVIDIA → Groq.
//
// El orden, los modelos y las claves de NVIDIA/Groq se configuran por
// Telegram en Cobranzas (comando «lectores», TG_Lectores.js). Esta hoja
// los pide a Cobranzas (asistente IA, VIA_llamar_ 'lectores') y los
// guarda 10 min en su caché; al cambiarlos, Cobranzas borra esa caché por
// el puente del portal (PV_Puente.js, op=lectores).
// Si Cobranzas no responde, se usa solo Gemini (como siempre).
//
// NVIDIA y Groq solo leen IMÁGENES: a ellos cada página del PDF se les
// manda convertida en imagen (vista previa de Drive a 2048 px, LEC_pdfAImagen_). Un
// lote de varias páginas lo lee Gemini; si falla, PdfProcessor.js lo pide
// página por página y ahí entran los de respaldo.
// Cuando el voucher NO lo leyó Gemini (o Gemini falló antes), la celda
// del N° de operación queda con una NOTA que dice quién lo leyó.
// Funciones LEC_.
// ============================================================

var LEC_NOMBRES_ = { gemini: 'Gemini', nvidia: 'NVIDIA', groq: 'Groq' };
/** ➕ Las IA agregadas en /lectores (x1, x2…) traen su nombre en la configuración. */
function LEC_nombresExtra_(cfg) {
  Object.keys(cfg || {}).forEach(function (k) { if (/^x\d+$/.test(k) && cfg[k] && cfg[k].nombre) LEC_NOMBRES_[k] = cfg[k].nombre; });
}
var LEC_ACHICADA_ = {};   // la última foto achicada para Groq (en esta ejecución)

function LEC_cfg_() {
  const cache = CacheService.getScriptCache();
  const t = cache.get('lec_cfg');
  if (t) { try { const c0 = JSON.parse(t); LEC_nombresExtra_(c0); return c0; } catch (e) {} }
  let cfg = { orden: ['gemini'] }, dura = 120;
  try {
    if (typeof VIA_llamar_ === 'function') {
      const r = VIA_llamar_('lectores', {});
      if (r && r.ok && r.orden && r.orden.length) { cfg = r; dura = 600; }
      else Logger.log('Lectores: Cobranzas no dio la configuración (' + ((r && r.error) || 'sin respuesta') + '). Se usa solo Gemini.');
    }
  } catch (e) { Logger.log('Lectores: ' + e.message + '. Se usa solo Gemini.'); }
  try { cache.put('lec_cfg', JSON.stringify(cfg), dura); } catch (e) {}
  LEC_nombresExtra_(cfg);
  return cfg;
}

function LEC_leer_(base64, mimeType, esPDF, totalPaginasLote) {
  const cfg = LEC_cfg_();
  // PDF de VARIAS páginas juntas (lote): solo Gemini; si falla, PdfProcessor.js lo vuelve a pedir página por página
  // y ahí sí entran los de respaldo (cada página se convierte en imagen).
  const loteVarias = esPDF && totalPaginasLote && totalPaginasLote > 1;
  let orden = (cfg.orden || ['gemini']).filter(function (p) {
    if (p === 'gemini') return true;
    return !loteVarias && cfg[p] && cfg[p].clave && cfg[p].modelo;
  });
  if (!orden.length) orden = ['gemini'];
  let imagen = null;   // la página del PDF como imagen (se hace una sola vez, la primera vez que se necesita)

  // ⚡ Si Gemini estuvo caído (503/429) hace menos de 5 min, se va directo al respaldo y Gemini queda al final
  // (antes se volvían a probar sus 4 modelos con CADA voucher: 15-17 s perdidos por voucher).
  const cacheL = CacheService.getScriptCache();
  if (orden.length > 1 && orden[0] === 'gemini' && cacheL.get('lec_gemini_caido')) {
    orden = orden.slice(1).concat(['gemini']);
    Logger.log('Gemini estuvo saturado hace poco: se lee primero con ' + orden[0] + '.');
  }
  const fallas = [];
  let ultimoError = null;
  for (let i = 0; i < orden.length; i++) {
    // En un lote de varias páginas, si hay respaldo, Gemini no espera: PdfProcessor.js reintenta página por página.
    const p = orden[i], hayOtro = i < orden.length - 1 || (loteVarias && (cfg.orden || []).some(function (x) { return x !== 'gemini' && cfg[x] && cfg[x].clave && cfg[x].modelo; }));
    try {
      let arr, modelo;
      if (p === 'gemini') {
        // Con respaldo: solo 2 modelos de Gemini (si están saturados, los otros suelen estarlo también).
        // Si en /lectores se eligieron VARIOS Gemini en orden, se prueban todos esos (en ese orden); si no, 2 con respaldo.
        const lista = (cfg.gemini && cfg.gemini.modelos) || [];
        const g = llamarGeminiSolo_(base64, mimeType, esPDF, totalPaginasLote,
          { sinEsperas: hayOtro, maxModelos: hayOtro ? Math.max(2, lista.length) : 0, modelo: cfg.gemini && cfg.gemini.modelo, modelos: lista });
        arr = g.vouchers; modelo = g.modelo;
      } else {
        if (esPDF && !imagen) imagen = LEC_pdfAImagen_(base64);
        // Varios modelos del mismo proveedor en el orden elegido en /lectores: si uno falla, el siguiente.
        let mods = (cfg[p].modelos && cfg[p].modelos.length) ? cfg[p].modelos : [cfg[p].modelo];
        const vivos = mods.filter(function (m) { return !LEC_caido_(p, m); });   // ⚡ los que fallaron hace < 2 min, al final
        if (vivos.length && vivos.length < mods.length) mods = vivos.concat(mods.filter(function (m) { return vivos.indexOf(m) < 0; }));
        let errM = null;
        for (let j = 0; j < mods.length && !arr; j++) {
          const c = Object.assign({}, cfg[p], { modelo: mods[j] });
          try {
            if (esPDF) arr = LEC_openai_(p, c, imagen, 'image/jpeg', true);
            else if (p === 'groq' && base64.length > 450000) {   // foto grande (~330 KB o más): Groq gratis la rechaza; se achica a 1280 px
              if (!LEC_ACHICADA_[base64.length]) {
                LEC_ACHICADA_ = {};
                LEC_ACHICADA_[base64.length] = LEC_vistaPrevia_(base64, mimeType, 1280);
              }
              arr = LEC_openai_(p, c, LEC_ACHICADA_[base64.length], 'image/jpeg', false);
            } else arr = LEC_openai_(p, c, base64, mimeType, false);
            modelo = mods[j];
          } catch (eM) {
            errM = eM;
            if (/HTTP (429|5\d\d)/.test(String(eM.message || eM))) LEC_marcarCaido_(p, mods[j], /HTTP 429/.test(String(eM.message || eM)) ? LEC_SEG_SIN_CUPO_ : 0);
            if (j < mods.length - 1) Logger.log(LEC_NOMBRES_[p] + ' · ' + String(mods[j]).split('/').pop() + ' falló: ' + String(eM.message || eM).slice(0, 120) + ' → se prueba ' + String(mods[j + 1]).split('/').pop());
          }
        }
        if (!arr) throw errM || new Error('sin respuesta');
      }
      const quien = LEC_NOMBRES_[p] + ' · ' + String(modelo || '').split('/').pop();
      if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.lector = quien;
      const nota = (p !== 'gemini' || fallas.length)
        ? '🤖 Leído por ' + quien + (fallas.length ? '\nAntes fallaron: ' + fallas.join(' | ') : '')
        : '';
      LEC_uso_(p, nota ? Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' ' + nota.replace(/\n/g, ' · ') : '');
      if (nota) {
        Logger.log(nota);
        (arr || []).forEach(function (v) { if (v && typeof v === 'object') v._lector = nota; });
      }
      return arr;
    } catch (e) {
      ultimoError = e;
      const msg = String(e && e.message || e);
      fallas.push(LEC_NOMBRES_[p] + ': ' + msg.slice(0, 90));
      if (p === 'gemini' && /API_SATURADA|HTTP_(429|5\d\d)/.test(msg)) { try { cacheL.put('lec_gemini_caido', '1', LEC_SEG_CAIDO_); } catch (e2) {} }
      Logger.log('Lector ' + LEC_NOMBRES_[p] + ' falló: ' + msg.slice(0, 200) + (hayOtro ? ' → se prueba el siguiente.' : ''));
    }
  }
  LEC_uso_('fallos', Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' ❌ ninguno pudo: ' + fallas.join(' | '));
  throw ultimoError || new Error('API_SATURADA');
}

// NVIDIA y Groq hablan el mismo idioma (formato OpenAI). Groq gratis no
// acepta las instrucciones completas (muy largas): usa las resumidas que
// manda Cobranzas.
function LEC_openai_(p, c, base64, mimeType, dePdf) {
  const q = LEC_openaiCarga_(p, c, base64, mimeType, dePdf), url = q.url, carga = q.carga;
  c = q.c;
  const pedir = function () {
    return UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + c.clave },
      payload: JSON.stringify(carga), muteHttpExceptions: true });
  };
  let r = pedir(), code = r.getResponseCode(), cuerpo = r.getContentText();
  if (code === 400 && carga.chat_template_kwargs && /kwargs|template/i.test(cuerpo)) {   // ese modelo no acepta el ajuste: sin él
    delete carga.chat_template_kwargs;
    r = pedir(); code = r.getResponseCode(); cuerpo = r.getContentText();
  }
  const img = carga.messages[1].content[1].image_url;
  if (code === 400 && img.detail && /detail/i.test(cuerpo)) {   // otro modelo elegido que no acepta «detalle alto»: sin él
    delete img.detail;
    r = pedir(); code = r.getResponseCode(); cuerpo = r.getContentText();
  }
  if (code !== 200) throw new Error('HTTP ' + code + (code === 429 ? ' (sin cupo por ahora)' : '') + ': ' + cuerpo.substring(0, 120));
  return LEC_openaiTexto_(cuerpo);
}

/** La consulta (formato OpenAI) para NVIDIA o Groq. → {url, carga, c} (c puede venir sin «razonar» si queda poco tiempo). */
function LEC_openaiCarga_(p, c, base64, mimeType, dePdf) {
  // ⏱ Si la ejecución ya lleva más de 4 min, sin razonar (responde en segundos): así no se pasa de los 6 min de Google.
  if (c.razonar && typeof INICIO_EJECUCION_ !== 'undefined' && Date.now() - INICIO_EJECUCION_ > 240000) {
    c = Object.assign({}, c, { razonar: false });
    Logger.log('Queda poco tiempo: ' + p + ' lee sin razonar.');
  }
  // ➕ IA agregada en /lectores (compatible con OpenAI): su propia dirección
  const url = c.url ? String(c.url).replace(/\/+$/, '') + '/chat/completions'
    : p === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions';
  const sistema = (p === 'groq' && c.prompt) ? c.prompt : (dePdf ? PROMPT_PDF : PROMPT_IMAGEN);
  const carga = {
    // 🧠 c.razonar (se elige en «lectores»): piensa antes de responder; necesita más espacio para su razonamiento.
    model: c.modelo, temperature: 0.1, max_tokens: p === 'groq' ? (c.razonar ? 4000 : 1500) : (c.razonar ? 8000 : 4000),
    messages: [
      { role: 'system', content: (c.razonar ? '' : '/no_think\n') + sistema },   // sin «razonar» responde en segundos
      { role: 'user', content: [
        { type: 'text', text: 'Analiza este comprobante y responde SOLO el JSON del formato indicado.' },
        { type: 'image_url', image_url: p === 'nvidia' ? { url: 'data:' + mimeType + ';base64,' + base64, detail: 'high' } : { url: 'data:' + mimeType + ';base64,' + base64 } }   // NVIDIA: la imagen en detalle ALTO (no la reduce)
      ] }
    ]
  };
  if (p === 'nvidia' && !c.razonar) carga.chat_template_kwargs = { thinking: false, enable_thinking: false };
  return { url: url, carga: carga, c: c };
}

/** Respuesta 200 de NVIDIA/Groq → vouchers. */
function LEC_openaiTexto_(cuerpo) {
  const ch = (JSON.parse(cuerpo).choices || [])[0] || {}, m = ch.message || {};
  let texto = String(m.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!texto) {   // algunos dejan la respuesta dentro de su «razonamiento»: vale el último JSON
    const raz = String(m.reasoning_content || m.reasoning || '');
    const i = Math.max(raz.lastIndexOf('[{'), raz.lastIndexOf('[ {'));
    texto = i >= 0 ? raz.slice(i) : raz.slice(Math.max(0, raz.lastIndexOf('{')));
  }
  const arr = parsearTextoVouchers_(texto);
  if (!arr.length && !/^\s*(```json\s*)?\[\s*\]/.test(texto)) throw new Error('respuesta sin JSON legible');
  return arr;
}

// ¿Hay algún lector de respaldo prendido y con clave? (PdfProcessor.js: si el lote falla, reintentar página por página)
function LEC_hayRespaldo_() {
  const cfg = LEC_cfg_();
  return (cfg.orden || []).some(function (p) { return p !== 'gemini' && cfg[p] && cfg[p].clave && cfg[p].modelo; });
}

var LEC_ULTIMA_MINI_ = null;   // la última página convertida para NVIDIA/Groq, en tamaño celda (base64 JPG)

// Una página de PDF -> imagen JPG (base64), para NVIDIA y Groq que no leen PDF.
// Es lo mismo que hace la hoja para la miniatura de la celda (ImageInsert.js):
// archivo temporal en Drive, su vista previa en buena resolución y se borra.
function LEC_pdfAImagen_(base64Pdf) { return LEC_vistaPrevia_(base64Pdf, MimeType.PDF, 2048); }   // 2048 px: lo más nítido que conviene (NVIDIA recomienda hasta ~2048)

// Imagen o PDF -> JPG de 'lado' px como máximo (vista previa de Drive). Sirve también para ACHICAR fotos
// grandes: Groq gratis rechaza las fotos de alta resolución («Request too large»: cuenta más tokens).
function LEC_vistaPrevia_(base64, mime, lado) {
  // 🔁 A veces Drive tarda en preparar la vista previa y responde 404 (pasó con las páginas 25-26 del 24/11: las terminó
  // leyendo Groq). Se intenta 2 veces con un archivo nuevo antes de pasar al siguiente lector.
  let ultimo = null;
  for (let intento = 1; intento <= 2; intento++) {
    try { return LEC_vistaPrevia1_(base64, mime, lado, intento); }
    catch (e) { ultimo = e; Logger.log('Vista previa de Drive (intento ' + intento + '): ' + e.message); }
  }
  throw ultimo;
}

function LEC_vistaPrevia1_(base64, mime, lado, intento) {
  const token = ScriptApp.getOAuthToken();
  let tmp = null;
  try {
    tmp = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(base64), mime, 'lector_respaldo_tmp'));
    const id = tmp.getId(), esperas = intento > 1 ? [1500, 2000, 3000, 4000, 5000] : [700, 900, 1200, 1600, 2200, 3000];
    let url = '';
    for (let i = 0; i < esperas.length && !url; i++) {
      Utilities.sleep(esperas[i]);
      try {
        const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=thumbnailLink',
          { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
        if (r.getResponseCode() === 200) {
          const j = JSON.parse(r.getContentText());
          if (j.thumbnailLink) url = j.thumbnailLink.replace(/=s\d+/, '=s' + lado);
        }
      } catch (e) {}
    }
    if (!url) url = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w' + lado;
    const img = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    // ⚡ Para la celda: la misma página en 800 px (como la de siempre) sin volver a subirla a Drive ni esperar otra
    // miniatura. PdfProcessor.js la usa si esa página tiene voucher (antes se repetía todo: ~3-8 s por voucher).
    if (mime === MimeType.PDF && /=s\d+/.test(url)) {
      try {
        const mini = UrlFetchApp.fetch(url.replace(/=s\d+/, '=s800'), { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
        if (mini.getResponseCode() === 200 && mini.getBlob().getBytes().length > 2000) LEC_ULTIMA_MINI_ = Utilities.base64Encode(mini.getBlob().getBytes());
      } catch (e) {}
    }
    if (img.getResponseCode() !== 200 || img.getBlob().getBytes().length < 2000)
      throw new Error('no se pudo convertir en imagen (HTTP ' + img.getResponseCode() + ')');
    return Utilities.base64Encode(img.getBlob().getBytes());
  } finally {
    if (tmp) { try { tmp.setTrashed(true); } catch (e) {} }
  }
}

// Cuántos leyó cada uno hoy (lo muestra «lectores» en Telegram) y el último respaldo.
function LEC_uso_(p, nota) {
  try {
    const props = PropertiesService.getScriptProperties();
    const hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd');
    let u = {};
    try { u = JSON.parse(props.getProperty('LEC_USO') || '{}'); } catch (e) {}
    if (u.dia !== hoy) u = { dia: hoy };
    u[p] = (u[p] || 0) + 1;
    props.setProperty('LEC_USO', JSON.stringify(u));
    if (nota) props.setProperty('LEC_ULTIMO', nota.slice(0, 400));
  } catch (e) {}
}

// Para el puente (PV_Puente.js, op=lectores): borra la caché (tomar la configuración nueva) y devuelve el uso.
function LEC_puente_() {
  try { CacheService.getScriptCache().remove('lec_cfg'); } catch (e) {}
  const props = PropertiesService.getScriptProperties();
  let u = {};
  try { u = JSON.parse(props.getProperty('LEC_USO') || '{}'); } catch (e) {}
  const hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd');
  return { ok: true, hoy: u.dia === hoy ? u : {}, ultimo: props.getProperty('LEC_ULTIMO') || '' };
}


// ============================================================
// ⚡ MEMORIA POR MODELO Y LECTURA EN PARALELO
// ------------------------------------------------------------
// · Un modelo que respondió saturado/sin cupo (429/5xx) se recuerda 2 min y se salta: no se vuelve a esperar
//   (a veces Google tarda 10-90 s en decir «saturado»). Si TODOS están marcados, se prueban igual.
// · LEC_sondeoGemini_: al empezar un PDF largo, una pregunta mínima EN PARALELO a todos los Gemini elegidos;
//   los que no responden quedan marcados y se va directo a los que sí (en el orden de /lectores).
//   (Google devuelve todas las respuestas juntas: no se puede saber cuál contestó primero.)
// · LEC_leerParalelo_: si Gemini falló el lote, las páginas van A LA VEZ a NVIDIA (antes una tras otra).
// ============================================================

var LEC_SEG_CAIDO_ = 60;   // «saturado»: 1 min sin probarlo (antes 2) — Gemini se vuelve a intentar antes

function LEC_caido_(p, m) {
  try { return !!CacheService.getScriptCache().get('lec_caido_' + p + '_' + String(m).replace(/[^\w.\-]/g, '_')); } catch (e) { return false; }
}
// seg: cuánto recordarlo. «Sin cupo» (429) dura más que «saturado» (503): el cupo gratis no vuelve en 2 minutos y
// reintentar solo gasta tiempo (y más cupo).
function LEC_marcarCaido_(p, m, seg) {
  try { CacheService.getScriptCache().put('lec_caido_' + p + '_' + String(m).replace(/[^\w.\-]/g, '_'), '1', seg || LEC_SEG_CAIDO_); } catch (e) {}
}
var LEC_SEG_SIN_CUPO_ = 900;   // 15 min

/** Pregunta mínima en paralelo a los Gemini elegidos (una vez cada 2 min como máximo). → texto para el registro. */
function LEC_sondeoGemini_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('lec_sondeo')) return '';
  cache.put('lec_sondeo', '1', LEC_SEG_CAIDO_);
  const cfg = LEC_cfg_(), lista = ((cfg.gemini && cfg.gemini.modelos) || []).slice(0, 6);
  if (lista.length < 2 || !CFG.API_KEY) return '';
  const t0 = Date.now();
  const resps = UrlFetchApp.fetchAll(lista.map(function (m) {
    return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + CFG.API_KEY,
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo: ok' }] }], generationConfig: { maxOutputTokens: 20, temperature: 0 } }) };
  }));
  const ok = [], mal = [];
  resps.forEach(function (r, i) {
    const code = r.getResponseCode();
    if (code === 200) ok.push(lista[i]);
    else { mal.push(lista[i] + ' (' + code + ')'); if (code === 429 || code >= 500) LEC_marcarCaido_('gemini', lista[i], code === 429 ? LEC_SEG_SIN_CUPO_ : 0); if (code === 404) marcarModeloNoDisponible_(lista[i]); }
  });
  const txt = '🔎 Sondeo de Gemini en paralelo (' + Math.round((Date.now() - t0) / 100) / 10 + ' s): responden ' + (ok.join(', ') || 'ninguno') +
    (mal.length ? ' · saturados/sin cupo: ' + mal.join(', ') : '');
  Logger.log(txt);
  if (!ok.length) { try { cache.put('lec_gemini_caido', '1', LEC_SEG_CAIDO_); } catch (e) {} }
  return txt;
}

/** Varias páginas de PDF (base64) a la vez con el primer lector de respaldo prendido (NVIDIA).
 *  → [{arr, mini, quien} | {error}] en el mismo orden, o null si no aplica (Groq gratis: de a una, ~3 imágenes/min). */
function LEC_leerParalelo_(pdfs) {
  const cfg = LEC_cfg_();
  if (!pdfs || pdfs.length < 2) return null;
  const p = (cfg.orden || []).filter(function (x) { return x !== 'gemini' && cfg[x] && cfg[x].clave && cfg[x].modelo; })[0];
  if (!p || p === 'groq') return null;
  const mods = (cfg[p].modelos && cfg[p].modelos.length) ? cfg[p].modelos : [cfg[p].modelo];
  const modelo = mods.filter(function (m) { return !LEC_caido_(p, m); })[0] || mods[0];
  const t0 = Date.now();
  const imgs = LEC_imagenesParalelo_(pdfs, 2048);
  const tImg = Date.now() - t0;
  const pet = [], idx = [];
  let c = Object.assign({}, cfg[p], { modelo: modelo });
  imgs.forEach(function (im, i) {
    if (!im) return;
    const q = LEC_openaiCarga_(p, c, im.jpg, 'image/jpeg', true);
    c = q.c;
    pet.push({ url: q.url, method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + c.clave },
      payload: JSON.stringify(q.carga), muteHttpExceptions: true });
    idx.push(i);
  });
  const out = pdfs.map(function () { return { error: 'no se pudo convertir en imagen' }; });
  if (!pet.length) return out;
  const t1 = Date.now(), resps = UrlFetchApp.fetchAll(pet);
  const quien = LEC_NOMBRES_[p] + ' · ' + String(modelo).split('/').pop();
  let bien = 0;
  resps.forEach(function (r, j) {
    const i = idx[j], code = r.getResponseCode();
    if (code !== 200) {
      out[i] = { error: 'HTTP ' + code };
      if (code === 429 || code >= 500) LEC_marcarCaido_(p, modelo, code === 429 ? LEC_SEG_SIN_CUPO_ : 0);
      return;
    }
    try { out[i] = { arr: LEC_openaiTexto_(r.getContentText()), mini: imgs[i].mini, quien: quien }; bien++; }
    catch (e) { out[i] = { error: String(e.message || e).slice(0, 80) }; }
  });
  if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.lector = quien;
  LEC_uso_(p, Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' 🤖 ' + bien + ' página(s) en paralelo por ' + quien);
  Logger.log('⚡ ' + pdfs.length + ' páginas EN PARALELO con ' + quien + ': imágenes ' + Math.round(tImg / 100) / 10 + ' s · lectura ' +
    Math.round((Date.now() - t1) / 100) / 10 + ' s · bien ' + bien + '/' + pdfs.length + (bien < pdfs.length ? ' (las demás, una por una)' : ''));
  return out;
}

/** Varias páginas de PDF → JPG a la vez (vistas previas de Drive): [{jpg (lado px), mini (800 px)} | null]. */
function LEC_imagenesParalelo_(pdfs, lado) {
  const token = ScriptApp.getOAuthToken(), auth = { Authorization: 'Bearer ' + token };
  const tmp = pdfs.map(function (b64, i) {
    try { return DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(b64), MimeType.PDF, 'lector_paralelo_' + i)); } catch (e) { return null; }
  });
  const urls = tmp.map(function () { return ''; });
  try {
    const esperas = [800, 1000, 1500, 2000, 3000, 4000, 5000];   // hasta ~17 s: Drive a veces tarda
    for (let r = 0; r < esperas.length; r++) {
      const falta = [];
      tmp.forEach(function (f, i) { if (f && !urls[i]) falta.push(i); });
      if (!falta.length) break;
      Utilities.sleep(esperas[r]);
      const resps = UrlFetchApp.fetchAll(falta.map(function (i) {
        return { url: 'https://www.googleapis.com/drive/v3/files/' + tmp[i].getId() + '?fields=thumbnailLink', headers: auth, muteHttpExceptions: true };
      }));
      resps.forEach(function (res, j) {
        try { const t = JSON.parse(res.getContentText()).thumbnailLink; if (res.getResponseCode() === 200 && t) urls[falta[j]] = t; } catch (e) {}
      });
    }
    const pedir = [];
    urls.forEach(function (u, i) {
      if (!u && tmp[i]) u = urls[i] = 'https://drive.google.com/thumbnail?id=' + tmp[i].getId() + '&sz=w' + lado;
      if (!u) return;
      const grande = /=s\d+/.test(u) ? u.replace(/=s\d+/, '=s' + lado) : u;
      const chica = /=s\d+/.test(u) ? u.replace(/=s\d+/, '=s800') : u.replace(/sz=w\d+/, 'sz=w800');
      pedir.push({ i: i, g: { url: grande, headers: auth, muteHttpExceptions: true }, c: { url: chica, headers: auth, muteHttpExceptions: true } });
    });
    const resps = pedir.length ? UrlFetchApp.fetchAll(pedir.map(function (x) { return x.g; }).concat(pedir.map(function (x) { return x.c; }))) : [];
    const out = pdfs.map(function () { return null; });
    pedir.forEach(function (x, j) {
      const g = resps[j], ch = resps[j + pedir.length];
      if (g.getResponseCode() === 200 && g.getBlob().getBytes().length > 2000) {
        out[x.i] = { jpg: Utilities.base64Encode(g.getBlob().getBytes()),
          mini: (ch.getResponseCode() === 200 && ch.getBlob().getBytes().length > 2000) ? Utilities.base64Encode(ch.getBlob().getBytes()) : null };
      }
    });
    return out;
  } finally {
    tmp.forEach(function (f) { if (f) { try { f.setTrashed(true); } catch (e) {} } });
  }
}
