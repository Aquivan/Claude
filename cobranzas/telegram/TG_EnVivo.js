/**
 * 📺 En vivo — ver la pantalla del robot (SUNAT / Quesito) mientras trabaja.  Prefijo TGEV_.
 *
 * Se activa o desactiva con «en vivo sí» / «en vivo no» (Telegram y WhatsApp) o desde la hoja de Guías (📺).
 * Con el modo activo, cada corrida de guía crea un enlace secreto (?vivo=…) que llega al chat o a la hoja; el robot
 * (guias/scripts/en_vivo.py) manda una foto cada ~2–3 s (accion gre_vivo) y la página la muestra sola. Las fotos solo
 * viven unos minutos en la caché (nada en Drive ni en GitHub). Solo se mira: no se puede tocar nada desde la página.
 */

var TGEV_PROP_ = 'GRE_EN_VIVO';
var TGEV_TROZO_ = 90000;   // la caché guarda hasta 100 KB por valor: la foto va en trozos

function TGEV_activo_() { return PropertiesService.getScriptProperties().getProperty(TGEV_PROP_) === 'SI'; }
function TGEV_poner_(si) { PropertiesService.getScriptProperties().setProperty(TGEV_PROP_, si ? 'SI' : 'NO'); return !!si; }

/** Al pedir una corrida: si está activo, abre la transmisión del caso y devuelve el enlace ('' si está apagado). */
function TGEV_iniciar_(c) {
  if (!TGEV_activo_() || !c || !c.id) return '';
  var cache = CacheService.getScriptCache(), tok = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  cache.put('tgv_t_' + tok, String(c.id), 21600);
  cache.put('tgv_on_' + c.id, '1', 3600);
  cache.remove('tgv_m_' + c.id);
  var url = TGEV_url_() + '?vivo=' + tok;
  try { TGG_avisar_(c, '📺 Véalo en vivo: ' + url + '\nEn GitHub pasa solo a 🎥 video y puede hacer clic y escribir; en su PC mire la ventana de Chrome. El enlace vence en unas horas.', null, false); } catch (e) {}   // también si la guía vino de la hoja
  return url;
}

function TGEV_url_() {
  return TG_urlWebApp_();   // la misma dirección pública que usa Telegram (la de la implementación vigente)
}

/** Foto que manda el robot (doPost canal=gh, ya validada la corrida). */
function TGEV_cuadroDelRobot_(q) {
  var caso = String(q.caso || ''), cache = CacheService.getScriptCache();
  if (!caso || !cache.get('tgv_on_' + caso) || !TGEV_activo_()) return { ok: true, vivo: false };
  var img = String(q.img || '');
  if (!img) return { ok: true, vivo: true };
  var m = {};
  try { m = JSON.parse(cache.get('tgv_m_' + caso) || '{}'); } catch (e) {}
  var trozos = {}, n = Math.ceil(img.length / TGEV_TROZO_), seq = (Number(m.seq) || 0) + 1;
  for (var i = 0; i < n; i++) trozos['tgv_i_' + caso + '_' + seq % 2 + '_' + i] = img.slice(i * TGEV_TROZO_, (i + 1) * TGEV_TROZO_);
  cache.putAll(trozos, 600);   // dos juegos alternados: quien lee nunca ve una foto a medio escribir
  cache.put('tgv_m_' + caso, JSON.stringify({ seq: seq, n: n, t: Date.now(), paso: String(q.paso || '').slice(0, 200) }), 600);
  cache.put('tgv_on_' + caso, '1', 3600);
  return { ok: true, vivo: true };
}

/** ¿Transmitir esta corrida? (el robot pregunta antes de preparar el video). */
function TGEV_infoRobot_(q) {
  var caso = String(q.caso || '');
  return { ok: true, vivo: !!(caso && TGEV_activo_() && CacheService.getScriptCache().get('tgv_on_' + caso)) };
}

/** 🎥 El robot de GitHub avisa que su video (noVNC por túnel temporal) está listo: la página 📺 pasa sola al video. */
function TGEV_vncDelRobot_(q) {
  var caso = String(q.caso || ''), url = String(q.url || '');
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/vnc\.html\?[\w=&%.-]+$/i.test(url)) return { ok: false, error: 'enlace no válido' };
  var cache = CacheService.getScriptCache();
  if (!caso || !cache.get('tgv_on_' + caso)) return { ok: false, error: 'en vivo apagado' };
  cache.put('tgv_v_' + caso, url, 3600);
  // También directo al chat: este enlace no pasa por Google (con varias cuentas de Google abiertas, la página 📺 a veces no abre).
  try { var c = TGG_leer_(TG_ss_(), caso); if (c) TGG_avisar_(c, '🎥 Video en vivo (puede hacer clic y escribir): ' + url + '\nSolo dura mientras el robot trabaja.', null, false); } catch (e) {}
  return { ok: true };
}

/** doGet ?vivo=… : la página que mira. */
function TGEV_pagina_(tok) {
  var t = HtmlService.createTemplate(TGEV_HTML_);
  t.tok = String(tok || '').replace(/[^a-f0-9]/gi, '');
  return t.evaluate().setTitle('📺 Robot en vivo').addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** La página pregunta cada 2 s (google.script.run). Solo devuelve la foto si hay una nueva. */
function TGEV_cuadro(tok, visto) {
  tok = String(tok || '').replace(/[^a-f0-9]/gi, '');
  var cache = CacheService.getScriptCache(), caso = tok && cache.get('tgv_t_' + tok);
  if (!caso) return { vencido: true };
  var m = {};
  try { m = JSON.parse(cache.get('tgv_m_' + caso) || '{}'); } catch (e) {}
  var r = { caso: caso, seq: m.seq || 0, t: m.t || 0, paso: m.paso || '', ahora: Date.now(), vnc: cache.get('tgv_v_' + caso) || '' };
  if (!m.seq || Number(visto) === m.seq) return r;
  var ks = [];
  for (var i = 0; i < m.n; i++) ks.push('tgv_i_' + caso + '_' + m.seq % 2 + '_' + i);
  var got = cache.getAll(ks), img = '';
  for (var j = 0; j < ks.length; j++) { if (!got[ks[j]]) return r; img += got[ks[j]]; }
  r.img = img;
  return r;
}

/** «en vivo», «en vivo sí/no», «ver en vivo»: texto de respuesta (sin HTML) o null si no es esto. */
function TGEV_comando_(texto) {
  var m = String(texto || '').trim().match(/^\/?(?:ver\s+(?:el\s+robot\s+)?)?en\s*vivo\b\s*[:,]?\s*(s[ií]|no|on|off|activ\w*|desactiv\w*|apag\w*|prend\w*|encend\w*)?\s*[.!]*$/i);
  if (!m) return null;
  var w = (m[1] || '').toLowerCase(), si;
  if (/^(s[ií]|on|activ|prend|encend)/.test(w)) si = TGEV_poner_(true);
  else if (/^(no|off|desactiv|apag)/.test(w)) si = TGEV_poner_(false);
  else si = TGEV_activo_();
  return si ? '📺 En vivo: ACTIVADO. Cuando el robot llene una guía (vista previa, emitir o leer la factura) le mando un enlace para mirar su pantalla mientras trabaja ' +
      '(cuando corre en GitHub se ve en 🎥 video y puede tocar la pantalla si hace falta; si no, fotos cada 2–3 s). Para apagarlo escriba «en vivo no».'
    : '📺 En vivo: DESACTIVADO. El robot trabaja sin transmitir. Para verlo mientras trabaja escriba «en vivo sí».';
}

var TGEV_HTML_ = [
  '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8"><style>',
  'body{margin:0;background:#11161c;color:#e0e6eb;font-family:Arial,Helvetica,sans-serif}',
  '.bar{position:sticky;top:0;display:flex;gap:10px;align-items:center;padding:8px 12px;background:#1b232c;font-size:13px;flex-wrap:wrap}',
  '.dot{width:10px;height:10px;border-radius:50%;background:#78909c;flex:none}.dot.on{background:#43a047;box-shadow:0 0 6px #43a047}.dot.off{background:#e53935}',
  '#paso{color:#b0bec5;flex:1;min-width:200px}#img{display:block;max-width:100%;margin:0 auto;background:#fff}',
  '#vid{display:block;width:100%;height:calc(100vh - 44px);border:0;background:#000}.bar a,.bar button{color:#90caf9;background:none;border:1px solid #37474f;border-radius:6px;padding:3px 8px;font:inherit;cursor:pointer;text-decoration:none}',
  '.vacio{padding:60px 16px;text-align:center;color:#90a4ae}</style></head><body>',
  '<div class="bar"><span class="dot" id="dot"></span><b id="est">Conectando…</b><span id="paso"></span><span id="modo"></span></div>',
  '<div id="caja"><div class="vacio" id="vacio">Esperando la primera imagen del robot (arranca en 1–2 minutos: prepara el navegador e ingresa)…</div></div>',
  '<script>',
  'var TOK = <?= tok ?>, visto = 0, img = null, ult = 0, VNC = "", enVideo = false, fotoSola = false;',
  'function video(si){var c=document.getElementById("caja");enVideo=si;',
  ' if(si){c.innerHTML=\'<iframe id="vid" allow="clipboard-read; clipboard-write" src="\'+VNC+\'"></iframe>\';img=null;}',
  ' else{c.innerHTML=\'<div class="vacio" id="vacio">Cargando la foto…</div>\';visto=0;}',
  ' document.getElementById("modo").innerHTML=si?\'<button onclick="fotoSola=true;video(false)">Ver fotos</button> <a target="_blank" href="\'+VNC+\'">Abrir aparte ↗</a>\':(VNC?\'<button onclick="fotoSola=false;video(true)">🎥 Ver video (y tocar)</button>\':"");}',
  'function hace(ms){var s=Math.round(ms/1000);return s<60?s+" s":Math.round(s/60)+" min";}',
  'function pinta(r){var d=document.getElementById("dot"),e=document.getElementById("est");',
  ' if(r.vencido){d.className="dot off";e.textContent="Este enlace ya venció.";document.getElementById("vacio").textContent="Pida otra vez la guía con el modo en vivo activo para tener un enlace nuevo.";return false;}',
  ' if(r.vnc&&!VNC){VNC=r.vnc;if(!fotoSola)video(true);}',
  ' if(r.img&&!enVideo){if(!img){img=document.createElement("img");img.id="img";var v=document.getElementById("vacio");v.parentNode.replaceChild(img,v);}img.src="data:image/jpeg;base64,"+r.img;visto=r.seq;}',
  ' var edad=r.t?r.ahora-r.t:0;',
  ' if(!r.t){d.className="dot";e.textContent="Esperando al robot…";}',
  ' else if(edad<20000||enVideo){d.className="dot on";e.textContent=enVideo?"🎥 En vivo (puede hacer clic y escribir)":"En vivo";}',
  ' else{d.className="dot";e.textContent="Sin cambios hace "+hace(edad)+" (terminó, está esperando su ✅ o se detuvo)";}',
  ' document.getElementById("paso").textContent=r.paso?"· "+r.paso:"";return true;}',
  'function pide(){google.script.run.withSuccessHandler(function(r){if(pinta(r))setTimeout(pide,2000);})',
  ' .withFailureHandler(function(){setTimeout(pide,5000);}).TGEV_cuadro(TOK,visto);}',
  'pide();',
  '</script></body></html>'
].join('\n');

/* ============================================================ 🖥 Quesito en la PC de la persona (ejecutor pc-quesito)
 * «en pc sí» / «en pc no» (o 🖥 en la hoja): las guías por Quesito corren en la PC (Chrome visible) si el ejecutor está
 * encendido (run.cmd abierto). Si la PC está apagada o no se puede saber, se usa GitHub como siempre. */

var TGPC_PROP_ = 'GRE_EN_PC';
function TGPC_activo_() { return PropertiesService.getScriptProperties().getProperty(TGPC_PROP_) === 'SI'; }
function TGPC_poner_(si) { PropertiesService.getScriptProperties().setProperty(TGPC_PROP_, si ? 'SI' : 'NO'); return !!si; }

/** ¿El ejecutor pc-quesito está conectado? {ok, motivo}. Se recuerda 1 minuto. */
function TGPC_estado_(cfg) {
  var cache = CacheService.getScriptCache(), k = 'tgpc_estado', x = cache.get(k);
  if (x) return JSON.parse(x);
  var r;
  try {
    var rs = (TG_gh_(cfg, '/actions/runners?per_page=50').runners || []).filter(function (u) {
      return (u.labels || []).some(function (l) { return l.name === 'pc-quesito'; }); });
    var on = rs.filter(function (u) { return u.status === 'online'; });
    r = on.length ? { ok: true, motivo: on[0].busy ? 'ocupada con otra guía (espera su turno)' : 'encendida' }
      : { ok: false, motivo: rs.length ? 'la PC no está conectada (abra «Robot de guías (encender)» / run.cmd)' : 'no hay ejecutor pc-quesito registrado' };
  } catch (e) {
    r = { ok: false, motivo: 'no puedo ver si la PC está encendida: el token de GitHub necesita el permiso «Administration: Read-only»' };
  }
  cache.put(k, JSON.stringify(r), 60);
  return r;
}

/** 'pc' o 'github' para una corrida de Quesito (y avisa por qué, si estaba activo pero no se puede). */
function TGPC_donde_(cfg, c) {
  if (!TGPC_activo_()) return 'github';
  var e = TGPC_estado_(cfg);
  if (c) c.pc_motivo = e.ok ? '' : e.motivo;
  return e.ok ? 'pc' : 'github';
}

function TGPC_comando_(texto) {
  var m = String(texto || '').trim().match(/^\/?(?:usar\s+(?:mi\s+)?|en\s+(?:mi\s+)?)pc\b\s*[:,]?\s*(s[ií]|no|on|off|activ\w*|desactiv\w*|apag\w*|encend\w*)?\s*[.!]*$/i);
  if (!m) return null;
  var w = (m[1] || '').toLowerCase(), si;
  if (/^(s[ií]|on|activ|encend)/.test(w)) si = TGPC_poner_(true);
  else if (/^(no|off|desactiv|apag)/.test(w)) si = TGPC_poner_(false);
  else si = TGPC_activo_();
  var est = '';
  try { var e = TGPC_estado_(TG_cfg_(TG_ss_())); est = '\nAhora la PC: ' + (e.ok ? '🟢 ' : '⚪ ') + e.motivo + '.'; } catch (x) {}
  return si ? '🖥 Quesito en su PC: ACTIVADO. Las guías por Quesito se harán en su PC, con Chrome visible en la pantalla, mientras esté abierta la ventana ' +
      '«Robot de guías» (run.cmd). Si la PC está apagada, uso GitHub como siempre. La primera vez inicie sesión en Quesito en esa ventana de Chrome.' + est +
      '\nPara volver a GitHub: «en pc no».'
    : '🖥 Quesito en su PC: DESACTIVADO. El robot trabaja en GitHub (con la sesión copiada). Para usar su PC: «en pc sí».' + est;
}
