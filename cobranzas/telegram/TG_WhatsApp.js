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
  '- lanzar_descarga y los cambios en la hoja se CONFIRMAN en Telegram o en la hoja: dilo al proponerlos.',
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

/** q = {id, numero, nombre, texto, adjuntos:[{base64, mime, nombre}]} */
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
  var r = CHAT_enviarEn_(ss, { texto: texto, nuevos: q.adjuntos || [], anteriores: (ses.adj || []).slice(-4), historial: ses.hist || [] }, op);
  if (r.error) return { ok: false, error: r.error };

  if (!op.tg.vouchers && TG_pideFotoVoucher_(texto)) {
    var filasV = TG_filasVoucherEn_(ss, r.respuesta);
    if (!filasV.length) filasV = TG_filasDeResultados_(r.c, texto);
    if (filasV.length) op.tg.vouchers = { filas: filasV.slice(0, 10), modo: /\b(pdf|original|completo)\b/i.test(texto) ? 'original' : 'imagen' };
  }

  var tablas = (r.tablas || []).filter(function (t) { return t.columnas && t.columnas.length; });
  var out = {
    ok: true,
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
  if (r.cambios && r.cambios.length) out.avisos.push('✏️ Propuse ' + r.cambios.length + ' cambio(s) en la hoja de Vouchers: confírmelos en Telegram o en la hoja.');
  (op.tg.acciones || []).forEach(function () { out.avisos.push('🚀 La descarga propuesta se confirma en Telegram (/descargas).'); });

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
  ses.hist = (ses.hist || []).concat([{ p: texto || '(archivos adjuntos)', r: out.respuesta }]);
  ses.adj = (ses.adj || []).concat(r.adjuntos || []).slice(-8);
  TG_guardarSesion_(clave, ses);
  return out;
}

function TGW_archivo_(blob, titulo) {
  return { nombre: blob.getName() || 'archivo', mime: blob.getContentType() || 'application/octet-stream', titulo: titulo || '',
    imagen: /^image\/(jpe?g|png)$/i.test(blob.getContentType() || '') && blob.getBytes().length <= 5 * 1024 * 1024,
    base64: Utilities.base64Encode(blob.getBytes()) };
}
