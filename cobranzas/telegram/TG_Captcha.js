/**
 * 🧩 Captcha de Quesito resuelto por la persona (Telegram y WhatsApp).
 *
 * El robot de GitHub que entra a Quesito (guias/scripts/quesito_explorar.py) no resuelve captchas.
 * Cuando Google le pide "Selecciona todas las imágenes con …":
 *   1. numera las casillas, deja la foto en la rama quesito-captcha (<run>/<ronda>.png) y avisa aquí
 *      (doPost ?canal=gh, accion "captcha");
 *   2. aquí se manda la foto a los administradores de Telegram y a los números de WhatsApp;
 *   3. la persona responde los números ("1 6 9"), "0" si no hay ninguna u "otra" para cambiar la imagen;
 *   4. el robot pregunta cada pocos segundos (accion "respuesta"), marca esas casillas y pulsa Verificar.
 * Sin clave nueva: solo se atiende a una ejecución de GitHub de "guias-quesito" que esté corriendo
 * (se comprueba con el token de GitHub del bot) y la foto se baja del repositorio, no del pedido.
 */

var TGC_RAMA_ = 'quesito-captcha';
var TGC_RESP_RX_ = /^\s*(?:(\d{1,2}(?:\s*(?:[ ,;y\-]|e)\s*\d{1,2})*)|(0|ninguna?|ninguno|listo|verificar)|(otra|otro|cambiar|nueva)|(cancelar|parar))\s*\.?\s*$/i;

/** doPost con canal=gh (lo llama el robot de GitHub). */
function TGC_doPost_(e) {
  var q = {};
  try { q = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  try {
    var ss = TG_ss_(), cfg = TG_cfg_(ss), run = String(q.run || '').replace(/\D/g, '');
    if (!run || !TGC_runValido_(cfg, run)) return TGW_json_({ ok: false, error: 'Forbidden' });
    if (q.accion === 'captcha') return TGW_json_(TGC_avisar_(ss, cfg, run, q));
    if (q.accion === 'respuesta') {
      var x = CacheService.getScriptCache().get('tgc_resp_' + run + '_' + Number(q.ronda));
      return TGW_json_(x ? { ok: true, respuesta: x } : { ok: true, pendiente: true });
    }
    if (q.accion === 'fin') return TGW_json_(TGC_fin_(ss, run, q));
    return TGW_json_({ ok: false, error: 'accion desconocida' });
  } catch (err) {
    console.error('Captcha: ' + (err && err.stack || err));
    return TGW_json_({ ok: false, error: String(err && err.message || err) });
  }
}

/** Solo ejecuciones de "guias-quesito…" que siguen corriendo (se recuerda 2 min para no preguntar a GitHub en cada consulta). */
function TGC_runValido_(cfg, run) {
  var c = CacheService.getScriptCache();
  if (c.get('tgc_ok_' + run)) return true;
  var r = TG_gh_(cfg, '/actions/runs/' + run);
  var ok = r && r.status !== 'completed' && /(^|\/)guias-quesito[\w-]*\.ya?ml$/.test(String(r.path || ''));
  if (ok) c.put('tgc_ok_' + run, '1', 120);
  return !!ok;
}

/** Foto del reto desde la rama quesito-captcha del repositorio. */
function TGC_foto_(cfg, run, ronda) {
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.nombreRepo + '/contents/' + run + '/' + ronda + '.png?ref=' + TGC_RAMA_, {
    muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + cfg.github, Accept: 'application/vnd.github.raw' } });
  if (r.getResponseCode() !== 200) throw new Error('no encontré la imagen del captcha en GitHub (HTTP ' + r.getResponseCode() + ')');
  return r.getBlob().setContentType('image/png').setName('captcha.png');
}

function TGC_avisar_(ss, cfg, run, q) {
  var ronda = Number(q.ronda) || 1, foto = TGC_foto_(cfg, run, ronda);
  var titulo = '🧩 Quesito pide un captcha' + (q.empresa ? ' (' + q.empresa + ')' : '') + (ronda > 1 ? ' · ronda ' + ronda : '');
  var pregunta = String(q.pregunta || '').replace(/\s+/g, ' ').trim();
  var ayuda = 'Responda con los números de las casillas, por ejemplo 1 6 9. Si ya no queda ninguna: 0. Para otra imagen: otra. Tiene unos 2 minutos.' +
    (Number(q.casillas) === 16 ? '\nEs una sola foto partida en 16: marque TODAS las casillas donde se vea aunque sea un pedacito (bordes incluidos).' : '');
  if (q.aviso) ayuda = '⚠️ Google dijo: ' + String(q.aviso).slice(0, 150) + '\n' + ayuda;
  CacheService.getScriptCache().put('tgc_act', JSON.stringify({ run: run, ronda: ronda }), 600);
  var enviados = 0;
  TG_admins_(ss).forEach(function (a) {
    var r = TG_llamar_('sendPhoto', { chat_id: a.chatId, photo: foto, parse_mode: 'HTML',
      caption: '<b>' + TG_esc_(titulo) + '</b>\n' + (pregunta ? '<i>' + TG_esc_(pregunta) + '</i>\n' : '') + TG_esc_(ayuda).replace('1 6 9', '<code>1 6 9</code>') });
    if (r && r.ok) enviados++;
  });
  try { if (TGC_wa_({ tipo: 'foto', base64: Utilities.base64Encode(foto.getBytes()), texto: '*' + titulo + '*\n' + (pregunta ? '_' + pregunta + '_\n' : '') + ayuda })) enviados++; }
  catch (e) { console.error('Captcha por WhatsApp: ' + e.message); }
  return { ok: true, enviados: enviados };
}

function TGC_fin_(ss, run, q) {
  var c = CacheService.getScriptCache(), act = c.get('tgc_act');
  if (act && JSON.parse(act).run === run) c.remove('tgc_act');
  var txt = q.ok ? '✅ Captcha superado: el robot ya entró a Quesito.' : '⚠️ ' + (q.texto || 'El captcha no se pudo pasar.');
  TG_admins_(ss).forEach(function (a) { TG_enviar_(a.chatId, TG_esc_(txt)); });
  try { TGC_wa_({ tipo: 'texto', texto: txt }); } catch (e) {}
  return { ok: true };
}

/**
 * ¿Es la respuesta a un captcha que espera? (Telegram y WhatsApp). Devuelve el texto de acuse o null.
 * "1 6 9" / "1,6,9" / "1 y 6" → casillas · "0" / "ninguna" / "listo" → solo Verificar · "otra" → otra imagen · "cancelar".
 */
function TGC_respuesta_(texto) {
  var c = CacheService.getScriptCache(), act = c.get('tgc_act');
  if (!act) return null;
  var m = String(texto || '').match(TGC_RESP_RX_);
  if (!m) return null;
  act = JSON.parse(act);
  var k = 'tgc_resp_' + act.run + '_' + act.ronda, valor, acuse;
  if (m[1] && /^0+$/.test(m[1])) m = [m[0], '', '0'];   // "0" = ninguna (no es la casilla 0)
  if (m[1]) {
    var nums = m[1].split(/\D+/).filter(Boolean).map(Number).filter(function (n) { return n >= 1 && n <= 16; });
    nums = nums.filter(function (n, i) { return nums.indexOf(n) === i; });
    if (!nums.length) return null;
    valor = nums.join(','); acuse = '👍 Marcando ' + nums.join(', ') + '…';
  } else if (m[2]) { valor = '0'; acuse = '👍 Pulsando Verificar…'; }
  else if (m[3]) { valor = 'otra'; acuse = '🔄 Pidiendo otra imagen…'; }
  else { valor = 'cancelar'; acuse = '🛑 Cancelo el ingreso a Quesito.'; }
  c.put(k, valor, 600);
  c.remove('tgc_act');   // la siguiente ronda (si la hay) vuelve a avisar
  return acuse;
}

/** Envía a la app de WhatsApp (que lo manda a sus números autorizados). false si la app aún no se conectó. */
function TGC_wa_(cuerpo) {
  var p = PropertiesService.getScriptProperties(), url = p.getProperty('TGW_WA_URL'), clave = p.getProperty(TGW_PROP_);
  if (!url || !clave) return false;
  var r = UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'canal=cob&token=' + encodeURIComponent(clave), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo), muteHttpExceptions: true, followRedirects: true });
  return r.getResponseCode() < 300;
}
