/**
 * 📥 ARCHIVOS DE MÁS DE 20 MB POR TELEGRAM — acordado con el usuario el 26/11/2026.
 *
 * La API de bots de Telegram no deja bajar archivos de más de 20 MB (getFile). La app normal sí (hasta 2 GB) por la
 * otra vía de Telegram (MTProto). Cuando llega un documento de más de 20 MB:
 *   1. aquí se guarda un «lote» (chat, n° de mensaje, nombre) y se lanza telegram-archivo-grande.yml (solo el lote va
 *      a GitHub: el repositorio es público);
 *   2. el robot pide aquí (doPost ?canal=gh, solo una corrida de ese workflow que esté corriendo) el token del bot y un
 *      permiso temporal de Drive (enmascarados), entra como el bot con las claves TG_API_ID / TG_API_HASH (secretos de
 *      GitHub), baja el mensaje y deja el archivo en la carpeta temporal de importaciones, como cualquier otro adjunto;
 *   3. avisa aquí y se muestra la tarjeta de siempre «📎 Recibí el archivo. ¿Qué hago?». Si va como voucher y pesa más
 *      de 45 MB, la hoja de Vouchers lo manda a comprimir sola.
 * Si algo falla, se le dice a la persona que lo mande por WhatsApp o Drive. Funciones TGB_.
 */

var TGB_MB_ = 20;
var TGB_WF_ = 'telegram-archivo-grande.yml';
var TGB_PROP_ = 'TGB_L_';

/** Desde TG_alArchivo_: true si el archivo es grande y se lo pasó al robot (ya se respondió a la persona). */
function TGB_intentar_(ctx, m, nombre) {
  var d = m && m.document;
  if (!d || !(Number(d.file_size) > TGB_MB_ * 1024 * 1024)) return false;
  var p = PropertiesService.getScriptProperties(), mb = Math.round(Number(d.file_size) / 1048576);
  // limpieza: lotes viejos (más de 2 h) que nunca terminaron
  var todo = p.getProperties();
  Object.keys(todo).forEach(function (k) {
    if (k.indexOf(TGB_PROP_) !== 0) return;
    var L = {}; try { L = JSON.parse(todo[k]); } catch (e) {}
    if (Date.now() - (L.t || 0) > 2 * 3600000) {
      p.deleteProperty(k);
      try { TG_enviar_(L.chat, '⚠️ No pude bajar «' + TG_esc_(L.nombre) + '» (' + L.mb + ' MB): el robot no terminó. Mándelo por WhatsApp o súbalo a Drive.'); } catch (e) {}
    }
  });
  var lote = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  p.setProperty(TGB_PROP_ + lote, JSON.stringify({ chat: String(ctx.chatId), msg: m.message_id, nombre: nombre, mb: mb, mime: d.mime_type || '', t: Date.now() }));
  try {
    var cfg = TG_cfg_(ctx.ss);
    TG_gh_(cfg, '/actions/workflows/' + TGB_WF_ + '/dispatches', 'post', { ref: cfg.rama, inputs: { lote: lote } });
  } catch (e) {
    p.deleteProperty(TGB_PROP_ + lote);
    TG_enviar_(ctx.chatId, '⚠️ «' + TG_esc_(nombre) + '» pesa ' + mb + ' MB (Telegram no deja a los bots bajar más de 20 MB) y no pude lanzar el robot que lo baja: ' +
      TG_esc_(e.message) + '\nMándelo por WhatsApp (hasta 100 MB) o súbalo a la carpeta de Entrada en Drive.');
    try { REG_anotar_('Telegram', 'archivo grande · ERROR', '', nombre + ' · ' + e.message); } catch (e2) {}
    return true;
  }
  var aviso = TG_enviar_(ctx.chatId, '📥 Recibí <b>' + TG_esc_(nombre) + '</b> (' + mb + ' MB). Telegram no deja a los bots bajarlo directo (más de 20 MB): ' +
    'lo baja un robot. Este mensaje se actualiza solo.', null, { responderA: m.message_id });
  if (aviso) {   // ⏳ para editar este mismo mensaje con el avance (TG_Avance.js)
    var Lx = JSON.parse(p.getProperty(TGB_PROP_ + lote) || 'null');
    if (Lx) { Lx.aviso = aviso; p.setProperty(TGB_PROP_ + lote, JSON.stringify(Lx)); }
  }
  try { REG_anotar_('Telegram', 'archivo grande · enviado al robot', '', mb + ' MB'); } catch (e) {}
  return true;
}

/** doPost ?canal=gh&accion=tgb_* (TG_Captcha.js ya validó que la corrida sea de telegram-archivo-grande.yml y esté en curso). */
function TGB_gh_(q) {
  var p = PropertiesService.getScriptProperties(), lote = String(q.lote || '').replace(/\W/g, ''), k = TGB_PROP_ + lote;
  var L = JSON.parse(p.getProperty(k) || 'null');
  if (!L) return { ok: false, error: 'lote desconocido o ya terminado' };
  var ss = TG_ss_();
  if (q.accion === 'tgb_datos') {
    var marca = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmm');
    // 🔑 token del bot y permiso temporal de Drive (1 h): el robot los enmascara y no los guarda
    return { ok: true, bot: TG_token_(), drive: ScriptApp.getOAuthToken(), chat: L.chat, msg: L.msg, nombre: L.nombre, mb: L.mb,
      carpeta: IMP_carpeta_(ss).getId(), titulo: 'telegram m' + L.msg + ' ' + marca + ' - ' + L.nombre };
  }
  if (q.accion === 'tgb_avance') { AVT_bajandoTG_(L, Number(q.mb) || 0, Number(q.total) || 0); return { ok: true }; }   // ⏳
  if (q.accion !== 'tgb_fin') return { ok: false, error: 'accion desconocida' };
  p.deleteProperty(k);
  if (!q.ok || !q.id) {
    TG_enviar_(L.chat, '⚠️ No pude bajar «' + TG_esc_(L.nombre) + '» (' + L.mb + ' MB): ' + TG_esc_(String(q.error || 'error del robot').slice(0, 200)) +
      '\nMándelo por WhatsApp (hasta 100 MB) o súbalo a la carpeta de Entrada en Drive.');
    try { REG_anotar_('Telegram', 'archivo grande · ERROR', '', L.nombre + ' · ' + String(q.error || '').slice(0, 300)); } catch (e) {}
    return { ok: true };
  }
  if (L.aviso) TG_editar_(L.chat, L.aviso, '📥 <b>' + TG_esc_(L.nombre) + '</b> (' + L.mb + ' MB): ✅ bajado' + (q.seg ? ' en ' + q.seg + ' s' : '') + '.');
  var f = DriveApp.getFileById(String(q.id));
  var mime = f.getMimeType() || L.mime || TG_mimePorNombre_(L.nombre) || 'application/octet-stream';
  var adj = { id: f.getId(), nombre: L.nombre, mime: mime, grupo: 'm' + L.msg, foto: false, t: Date.now(), mb: L.mb };
  if (Number(q.paginas) > 0) adj.paginas = Number(q.paginas);
  var ses = TG_sesion_(L.chat);
  ses.adj = (ses.adj || []).concat([adj]);
  TG_guardarSesion_(L.chat, ses);
  var kb = TG_guardarBoton_({ t: 'adj', grupo: adj.grupo, adj: adj,
    desc: '«' + L.nombre + '» (' + L.mb + ' MB' + (adj.paginas ? ', ' + adj.paginas + ' pág.' : '') + ')' });
  TG_cartaArchivo_({ ss: ss, chatId: L.chat }, kb, TG_leerBoton_(kb), true);
  try { REG_anotar_('Telegram', 'archivo grande · bajado', String(q.seg || ''), L.mb + ' MB' + (adj.paginas ? ' · ' + adj.paginas + ' pág' : '')); } catch (e) {}
  return { ok: true };
}
