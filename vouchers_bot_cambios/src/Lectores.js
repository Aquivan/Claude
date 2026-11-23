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
var LEC_ACHICADA_ = {};   // la última foto achicada para Groq (en esta ejecución)

function LEC_cfg_() {
  const cache = CacheService.getScriptCache();
  const t = cache.get('lec_cfg');
  if (t) { try { return JSON.parse(t); } catch (e) {} }
  let cfg = { orden: ['gemini'] }, dura = 120;
  try {
    if (typeof VIA_llamar_ === 'function') {
      const r = VIA_llamar_('lectores', {});
      if (r && r.ok && r.orden && r.orden.length) { cfg = r; dura = 600; }
      else Logger.log('Lectores: Cobranzas no dio la configuración (' + ((r && r.error) || 'sin respuesta') + '). Se usa solo Gemini.');
    }
  } catch (e) { Logger.log('Lectores: ' + e.message + '. Se usa solo Gemini.'); }
  try { cache.put('lec_cfg', JSON.stringify(cfg), dura); } catch (e) {}
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

  const fallas = [];
  let ultimoError = null;
  for (let i = 0; i < orden.length; i++) {
    // En un lote de varias páginas, si hay respaldo, Gemini no espera: PdfProcessor.js reintenta página por página.
    const p = orden[i], hayOtro = i < orden.length - 1 || (loteVarias && (cfg.orden || []).some(function (x) { return x !== 'gemini' && cfg[x] && cfg[x].clave && cfg[x].modelo; }));
    try {
      let arr, modelo;
      if (p === 'gemini') {
        const g = llamarGeminiSolo_(base64, mimeType, esPDF, totalPaginasLote, { sinEsperas: hayOtro, modelo: cfg.gemini && cfg.gemini.modelo });
        arr = g.vouchers; modelo = g.modelo;
      } else {
        if (esPDF && !imagen) imagen = LEC_pdfAImagen_(base64);
        if (esPDF) arr = LEC_openai_(p, cfg[p], imagen, 'image/jpeg', true);
        else if (p === 'groq' && base64.length > 450000) {   // foto grande (~330 KB o más): Groq gratis la rechaza; se achica a 1280 px
          if (!LEC_ACHICADA_[base64.length]) {
            LEC_ACHICADA_ = {};
            LEC_ACHICADA_[base64.length] = LEC_vistaPrevia_(base64, mimeType, 1280);
          }
          arr = LEC_openai_(p, cfg[p], LEC_ACHICADA_[base64.length], 'image/jpeg', false);
        } else arr = LEC_openai_(p, cfg[p], base64, mimeType, false);
        modelo = cfg[p].modelo;
      }
      const quien = LEC_NOMBRES_[p] + ' · ' + String(modelo || '').split('/').pop();
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
  const url = p === 'nvidia' ? 'https://integrate.api.nvidia.com/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions';
  const sistema = (p === 'groq' && c.prompt) ? c.prompt : (dePdf ? PROMPT_PDF : PROMPT_IMAGEN);
  const carga = {
    // 🧠 c.razonar (se elige en «lectores»): piensa antes de responder; necesita más espacio para su razonamiento.
    model: c.modelo, temperature: 0.1, max_tokens: p === 'groq' ? (c.razonar ? 4000 : 1500) : (c.razonar ? 16000 : 4000),
    messages: [
      { role: 'system', content: (c.razonar ? '' : '/no_think\n') + sistema },   // sin «razonar» responde en segundos
      { role: 'user', content: [
        { type: 'text', text: 'Analiza este comprobante y responde SOLO el JSON del formato indicado.' },
        { type: 'image_url', image_url: p === 'nvidia' ? { url: 'data:' + mimeType + ';base64,' + base64, detail: 'high' } : { url: 'data:' + mimeType + ';base64,' + base64 } }   // NVIDIA: la imagen en detalle ALTO (no la reduce)
      ] }
    ]
  };
  if (p === 'nvidia' && !c.razonar) carga.chat_template_kwargs = { thinking: false, enable_thinking: false };
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

// Una página de PDF -> imagen JPG (base64), para NVIDIA y Groq que no leen PDF.
// Es lo mismo que hace la hoja para la miniatura de la celda (ImageInsert.js):
// archivo temporal en Drive, su vista previa en buena resolución y se borra.
function LEC_pdfAImagen_(base64Pdf) { return LEC_vistaPrevia_(base64Pdf, MimeType.PDF, 2048); }   // 2048 px: lo más nítido que conviene (NVIDIA recomienda hasta ~2048)

// Imagen o PDF -> JPG de 'lado' px como máximo (vista previa de Drive). Sirve también para ACHICAR fotos
// grandes: Groq gratis rechaza las fotos de alta resolución («Request too large»: cuenta más tokens).
function LEC_vistaPrevia_(base64, mime, lado) {
  const token = ScriptApp.getOAuthToken();
  let tmp = null;
  try {
    tmp = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(base64), mime, 'lector_respaldo_tmp'));
    const id = tmp.getId(), esperas = [700, 900, 1200, 1600, 2200, 3000];
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
