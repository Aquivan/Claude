/**
 * 📲 WhatsApp → la misma IA del asistente de Telegram.
 *
 * La app aparte "Vouchers WhatsApp" (vouchers_whatsapp/) llama a esta aplicación web con
 * doPost?canal=wa&token=… y una pregunta; aquí se contesta con el mismo analista y las
 * mismas herramientas que en Telegram, y se devuelve TODO en JSON (texto, tablas, fotos de
 * vouchers, archivos y Excel). Quien manda los mensajes por WhatsApp es la otra app.
 * No toca el flujo de Telegram: doPost solo desvía aquí cuando llega canal=wa.
 *
 * Clave: la primera llamada "registrar" deja la clave en TGW_SECRETO (solo si aún no hay).
 * Para cambiarla, borre la propiedad TGW_SECRETO y la app de WhatsApp registra otra sola.
 */

var TGW_PROP_ = 'TGW_SECRETO';
var TGW_MAX_ARCHIVOS_ = 10;

var TGW_SISTEMA_ = TG_SISTEMA_.replace('ESTÁS RESPONDIENDO POR TELEGRAM', 'ESTÁS RESPONDIENDO POR WHATSAPP') + '\n' + [
  '',
  'PARTICULARIDADES DE WHATSAPP:',
  '- No hay recordatorios ni avisos por WhatsApp: si los piden, di que se configuran en el bot de Telegram.',
  '- lanzar_descarga: el usuario la confirma con un botón aquí mismo en WhatsApp. Los cambios en la hoja se confirman en Telegram o en la hoja.',
  '- Las fotos de vouchers y los archivos sí se mandan por WhatsApp con enviar_voucher / enviar_archivo.',
].join('\n');

function TGW_doPost_(e) {
  var p = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  var guardada = props.getProperty(TGW_PROP_);
  if (p.accion === 'registrar') {
    if (!p.token || String(p.token).length < 24) return TGW_json_({ ok: false, error: 'clave inválida' });
    if (guardada && guardada !== p.token) return TGW_json_({ ok: false, error: 'ya hay otra clave registrada (borre TGW_SECRETO en Cobranzas para cambiarla)' });
    props.setProperty(TGW_PROP_, p.token);
    return TGW_json_({ ok: true });
  }
  if (!guardada || p.token !== guardada) return TGW_json_({ ok: false, error: 'Forbidden' });
  // La app de WhatsApp manda la dirección de "⚡ Procesar al instante" de la hoja de Vouchers: la usa también Telegram.
  try {
    var pu = JSON.parse((e.postData && e.postData.contents) || '{}')._pu;
    if (pu && /^https:\/\/script\.google\.com\//.test(pu) && props.getProperty('TGP_PROCESAR_URL') !== pu) props.setProperty('TGP_PROCESAR_URL', pu);
    // Y su propia dirección, para mandarle avisos (🧩 captcha de Quesito, TG_Captcha.js).
    var wu = JSON.parse((e.postData && e.postData.contents) || '{}')._wu;
    if (wu && /^https:\/\/script\.google\.com\//.test(wu) && props.getProperty('TGW_WA_URL') !== wu) props.setProperty('TGW_WA_URL', wu);
  } catch (err) {}
  if (p.accion === 'boton') return TGW_json_(TGW_boton_(p.k, p.op, p.numero));
  if (p.accion === 'procesar' || p.accion === 'deshacer') {   // 🧾 Procesar documento · ↩️ Deshacer (TG_Procesar.js, TG_Deshacer.js)
    try { var q0 = JSON.parse(e.postData.contents || '{}'); return TGW_json_(p.accion === 'procesar' ? TGP_wa_(q0) : TGU_wa_(q0)); }
    catch (err) { return TGW_json_({ ok: false, error: err.message }); }
  }
  if (p.accion === 'entrega') {   // 🏷 ¿de quién son estos vouchers? (ver TG_Entregas.js)
    try { return TGW_json_(TGE_wa_(JSON.parse(e.postData.contents || '{}'))); }
    catch (err) { return TGW_json_({ ok: false, error: err.message }); }
  }
  if (p.accion === 'captcha') {   // 🧩 respuesta al captcha de Quesito que la app de WhatsApp ya reconoció (TG_Captcha.js)
    try { var tc = TGC_respuesta_(JSON.parse(e.postData.contents || '{}').texto); return TGW_json_(tc ? { ok: true, texto: tc } : { ok: false }); }
    catch (err) { return TGW_json_({ ok: false, error: err.message }); }
  }
  if (p.accion === 'resultado') {
    var listo = CacheService.getScriptCache().get('tgw_r_' + p.id);
    return TGW_json_(listo ? JSON.parse(listo) : { ok: false, pendiente: true });
  }
  var q = JSON.parse(e.postData.contents || '{}');
  var r;
  try { r = TGW_responder_(q); } catch (err) { r = { ok: false, error: '❌ ' + (err && err.message || err) }; }
  // Se guarda por si la app de WhatsApp dejó de esperar (UrlFetch corta a los 60 s) y viene a buscarlo.
  try { CacheService.getScriptCache().put('tgw_r_' + q.id, JSON.stringify(r), 3600); }
  catch (err) { CacheService.getScriptCache().put('tgw_r_' + q.id, JSON.stringify(TGW_sinArchivos_(r)), 3600); }
  return TGW_json_(r);
}

function TGW_json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Si la respuesta con fotos no cabe en la caché (100 KB), al menos queda el texto.
function TGW_sinArchivos_(r) {
  var x = JSON.parse(JSON.stringify(r));
  if (x.archivos && x.archivos.length) x.respuesta = String(x.respuesta || '') + '\n\n(⚠️ Había ' + x.archivos.length + ' archivo(s) para mandar: vuelva a pedirlos.)';
  x.archivos = [];
  return x;
}

/** q = {id, numero, nombre, texto, adjuntos:[{base64, mime, nombre}], audio:{base64, mime}} */
function TGW_responder_(q) {
  var ss = TG_ss_();
  var clave = 'wa' + String(q.numero || '').replace(/\D/g, '');
  var ses = TG_sesion_(clave);
  var cfg;
  try { cfg = TG_cfg_(ss); } catch (e) { cfg = {}; }
  var ctx = { ss: ss, chatId: clave, nombre: q.nombre || q.numero };
  var op = {
    extraHerr: TGH_, extraSistema: TGW_SISTEMA_, alias: TG_ALIAS_, sinHoja: true, filasCompletas: true,
    origen: '📲 whatsapp ' + (q.nombre || q.numero), modelo: cfg.modelo || '', tg: { ctx: ctx, archivos: [], acciones: [], cfg: cfg }
  };
  var texto = String(q.texto || '').trim();
  // 🧩 "1 6 9" mientras el robot de Quesito espera la respuesta de un captcha.
  var capt = TGC_respuesta_(texto);
  if (capt) return { ok: true, respuesta: capt, tablas: [], sugerencias: [], archivos: [], avisos: [] };
  // 🔎 Respuesta a "Buscar con otro nombre" (el RUC de un voucher procesado, TG_Procesados.js).
  if (ses.esperando && ses.esperando.tipo === 'tgqnombre' && texto && !(q.adjuntos || []).length) {
    var eq = ses.esperando; ses.esperando = null; TG_guardarSesion_(clave, ses);
    if (!TGQ_RX_.test(texto)) return TGQ_nombreWA_(eq.acc, texto, clave);
  }
  var citaRuc = q.citado && texto && TGQ_citaEleccion_(clave, q.citado);   // citó «¿Cuál es el RUC de X?»
  if (citaRuc) return TGQ_nombreWA_(citaRuc, texto, clave);
  // 🔎 "ruc CORPORACION GRANIX": RUC por nombre (tus facturas y el padrón de SUNAT, RucPorNombre.js).
  if (/^\/?ruc\b/i.test(texto) && !/^\/?ruc\s+\d/i.test(texto)) {
    var rr;
    try { rr = RPN_consulta_(ss, texto, { origen: 'wa', chat: clave }); } catch (err) { rr = '⚠️ ' + err.message; }
    return { ok: true, respuesta: rr, tablas: [], sugerencias: [], archivos: [], avisos: [] };
  }
  // 🧾 "emitir" (lista de pendientes) o "emite la retención de F001-215" (o citando el mensaje): propuesta con botones.
  // 🚚 "guía" con fotos, ✏️ corrección pendiente o "emitir guía <caso>" (TG_GRE.js).
  // 📋 "procesados hoy sonia", "procesados 26-10-26 Sonia(Edit).pdf": lista por tanda y RUC que falte (TG_Procesados.js).
  if (TGQ_RX_.test(texto) && !(q.adjuntos || []).length) return TGQ_wa_(ss, texto, clave);
  var gre = TGG_atajoWA_(ss, q, clave);
  if (gre) return gre;
  var cre = TGR_atajoWA_(ss, texto, q.citado, clave);
  if (cre) return cre;
  var compl = TGR_completarWA_(ss, texto, q.citado, clave);   // ✏️ «completa el voucher Fotos!362 (con F003-37515)»
  if (compl) return compl;
  // ⚡ "sire granix 202601-202609": bajar solo el reporte del SIRE (se confirma con el botón 🚀).
  var sire = TGS_wa_(ss, texto);
  if (sire) return sire;
  // 🎤 Nota de voz: se transcribe igual que en Telegram y se pregunta lo dicho.
  var dicho = '';
  if (q.audio && q.audio.base64) {
    try { dicho = TG_transcribir_(ss, Utilities.newBlob(Utilities.base64Decode(q.audio.base64), q.audio.mime || 'audio/ogg', 'voz.ogg')); }
    catch (e) { return { ok: false, error: 'No pude entender el audio: ' + e.message + '\nPuede escribirme la pregunta.' }; }
    if (!dicho) return { ok: true, respuesta: '🎤 No escuché nada claro. ¿Me lo repite o lo escribe?', tablas: [], sugerencias: [], archivos: [], avisos: [] };
    texto = dicho;
  }
  // ↩️ Respondió (citó) un mensaje: la app de WhatsApp manda su texto en q.citado.
  var r = CHAT_enviarEn_(ss, { texto: q.citado ? TG_conCita_(texto, q.citado) : texto, nuevos: q.adjuntos || [], anteriores: (ses.adj || []).slice(-4), historial: ses.hist || [] }, op);
  if (r.error) return { ok: false, error: r.error };

  if (!op.tg.vouchers && TG_pideFotoVoucher_(texto)) {
    var filasV = TG_filasVoucherEn_(ss, r.respuesta);
    if (!filasV.length) filasV = TG_filasDeResultados_(r.c, texto);
    if (filasV.length) op.tg.vouchers = { filas: filasV.slice(0, 10), modo: /\b(pdf|original|completo)\b/i.test(texto) ? 'original' : 'imagen' };
  }

  var tablas = (r.tablas || []).filter(function (t) { return t.columnas && t.columnas.length; });
  var out = {
    ok: true, dicho: dicho,
    respuesta: String(r.respuesta || ''),
    tablas: tablas.slice(0, 3).map(function (t) { return { titulo: t.titulo, columnas: t.columnas, filas: t.filas.slice(0, 8).map(function (f) { return f.map(function (v, j) { return TG_valor_(v, t.columnas[j]); }); }), total: t.filas.length }; }),
    sugerencias: (r.final && Array.isArray(r.final.sugerencias) ? r.final.sugerencias : []).filter(Boolean).slice(0, 3),
    archivos: [], avisos: []
  };
  var grandes = tablas.some(function (t) { return t.filas.length > 8 || t.columnas.length > 5; }) || tablas.length > 3;
  if (grandes) {
    try { out.archivos.push(TGW_archivo_(TG_excel_(tablas, 'respuesta ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmm')), '📊 Tablas completas')); }
    catch (e) { out.avisos.push('No pude armar el Excel: ' + e.message); }
  }
  out.botones = [];
  if (r.cambios && r.cambios.length) {   // ✏️ asignar_voucher / proponer_cambio: ✅ aquí mismo (TGQ_botonWA_)
    var lc = r.cambios.slice(0, 12).map(function (x) { return '• ' + x.fila + ' · ' + x.columna + ': ' + x.nuevo + (x.aviso ? ' ⚠️ ' + x.aviso : ''); });
    out.botones.push({ k: TG_guardarBoton_({ t: 'cambios', ids: r.cambios.map(function (x) { return x.id; }) }),
      texto: '✏️ ¿Escribo ' + r.cambios.length + ' dato(s) en la hoja de Vouchers? (solo lo propuesto, se puede deshacer)\n' + lc.join('\n') + (r.cambios.length > 12 ? '\n…' : ''),
      opciones: [{ op: 'si', titulo: '✅ Escribir' }, { op: 'no', titulo: '✖ No' }] });
  }
  // 🚀 Descargas propuestas: el bot de WhatsApp las ofrece con botones (✔ / ✖) y la respuesta vuelve con accion=boton.
  if ((op.tg.cre || []).length) out.botones = out.botones.concat(TGR_botonesWA_(op.tg.cre));   // 🧾 proponer_retencion: 👁 / ✅
  if (!out.botones.length) delete out.botones;
  out.descargas = (op.tg.acciones || []).slice(0, 3).map(function (a) {
    return { k: TG_guardarBoton_(a), texto: TG_textoDescarga_(a, cfg.cob) };
  });

  if (op.tg.vouchers) {
    var libro = SpreadsheetApp.openById(leerConfig_(ss).idVouchers);
    op.tg.vouchers.filas.slice(0, TGW_MAX_ARCHIVOS_).forEach(function (f) {
      var x;
      try { x = TG_voucherBlob_(libro, f, op.tg.vouchers.modo, []); } catch (e) { x = { error: e.message }; }
      if (x.error) { out.avisos.push('No pude sacar el voucher ' + f + ': ' + x.error); return; }
      out.archivos.push(TGW_archivo_(x.blob, String(x.caption || f).replace(/<[^>]+>/g, '')));
    });
  }
  (op.tg.archivos || []).slice(0, TGW_MAX_ARCHIVOS_).forEach(function (a) {
    try {
      var file = DriveApp.getFileById(a.id);
      if (file.getSize() > 45 * 1024 * 1024) { out.avisos.push('📎 ' + file.getName() + ' pesa demasiado: ' + file.getUrl()); return; }
      out.archivos.push(TGW_archivo_(file.getBlob().setName(file.getName()), a.titulo));
    } catch (e) { out.avisos.push('No pude abrir un archivo de Drive: ' + e.message); }
  });
  out.archivos = out.archivos.slice(0, TGW_MAX_ARCHIVOS_);

  ses = TG_sesion_(clave);
  ses.hist = (ses.hist || []).concat([{ p: TG_preguntaParaMemoria_(texto, q.citado), r: out.respuesta }]);
  ses.adj = (ses.adj || []).concat(r.adjuntos || []).slice(-8);
  TG_guardarSesion_(clave, ses);
  return out;
}

function TGW_archivo_(blob, titulo) {
  return { nombre: blob.getName() || 'archivo', mime: blob.getContentType() || 'application/octet-stream', titulo: titulo || '',
    imagen: /^image\/(jpe?g|png)$/i.test(blob.getContentType() || '') && blob.getBytes().length <= 5 * 1024 * 1024,
    base64: Utilities.base64Encode(blob.getBytes()) };
}

/** Botón 🚀 Sí, descargar / ✖ Cancelar tocado en WhatsApp. */
function TGW_boton_(k, op, numero) {
  var acc = TG_leerBoton_(k);
  if (acc && acc.t === 'cre') return TGR_botonWA_(acc, k, op, numero);
  if (acc && acc.t === 'gre') return TGG_botonWA_(acc, k, op, numero);
  if (acc && acc.t === 'cambios') return TGQ_botonWA_(acc, op, numero);
  if (acc && acc.t === 'tgqia') return TGQ_iaWA_(acc, op, numero);   // 🤖 analizar la tanda con IA (TG_Procesados.js)
  if (acc && acc.t === 'rucelige') return TGQ_eligeWA_(acc, op, numero);   // 🤔 elegir el RUC entre opciones   // ✏️ escribir RUC en Vouchers (TG_Procesados.js)   // 🚚 guía de remisión (TG_GRE.js)   // 🧾 comprobante de retención (TG_Retener.js)
  if (!acc || acc.t !== 'descarga') return { ok: true, respuesta: 'Ese botón ya venció (duran 6 horas). Pídamelo de nuevo.' };
  if (TG_yaVisto_('wadesc' + k)) return { ok: true, respuesta: 'Esa descarga ya se pidió.' };
  if (op !== 'si') return { ok: true, respuesta: 'Listo, no pedí nada.' };
  var cfg = TG_cfg_(TG_ss_());
  var p = TG_PROYECTOS_[acc.proyecto];
  var inputs = p.inputs(acc);
  try { TG_gh_(cfg, '/actions/workflows/' + p.wf + '/dispatches', 'post', { ref: cfg.rama, inputs: inputs }); }
  catch (e) { return { ok: false, error: 'No se pudo pedir la descarga: ' + e.message }; }
  if (acc.proyecto === 'sire_rapido' && String(numero || '').replace(/\D/g, '')) {   // ⚡ avisa aquí mismo cuántos comprobantes trajo (TG_SireRapido.js)
    TG_seguir_('wa' + String(numero || '').replace(/\D/g, ''), p.wf, null, TG_textoDescarga_(acc, cfg.cob), { tipo: 'sire_rapido', titulo: TGS_titulo_(inputs) });
    return { ok: true, seguir: true, respuesta: '✅ *Pedido*: ' + TG_textoDescarga_(acc, cfg.cob) +
      '\nTarda 1 a 3 minutos por empresa y mes. Le escribo aquí cuando termine.' };
  }
  return { ok: true, respuesta: '✅ *Descarga pedida*: ' + TG_textoDescarga_(acc, cfg.cob) +
    '\nTarda unos minutos por empresa; la hoja se actualiza sola. Pregúnteme "¿cómo van las descargas?" para ver el estado.' };
}
