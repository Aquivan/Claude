/**
 * 🔁 Cambiar un voucher de ORIGINAL a FOTO (o al revés), esté pendiente o ya procesado.
 *
 * Telegram / WhatsApp: «cambia el último a foto», «pasa Originales 2705 a fotos», «era original» (el último).
 * Hoja de Vouchers y Cobranzas: menú 🧠 Asistente IA → 🔁 Cambiar Original ↔ Foto. Portal: 📥 Pendientes y el visor.
 *
 *  • PENDIENTE (el archivo todavía está en la carpeta de entrada): se mueve a la entrada de la otra pestaña.
 *  • YA PROCESADO: «deshacer y volver a procesar»:
 *      1. se guardan los datos escritos a mano en sus filas (columnas O en adelante: RUC, facturas, empresa, revisado, nota…);
 *      2. las filas de ese archivo se VACÍAN (no se borran: así ninguna otra fila cambia de número y no se rompen cruces);
 *      3. el archivo vuelve a la carpeta de entrada de la otra pestaña y la hoja de Vouchers lo procesa de nuevo;
 *      4. cuando aparecen las filas nuevas, CTV_reponer vuelve a poner los datos guardados (solo en celdas vacías).
 *    La unidad es el ARCHIVO: si un PDF trae varios vouchers, se cambian todos (se avisa antes).
 * Funciones CTV_.
 */

var CTV_HOJAS_ = ['Originales', 'Fotos'];
var CTV_PROC_ = { Originales: '1FM3wLUAGcFD5_yGiOuhLzLpAL9Sc7ki2', Fotos: '1RCiyPbj-s2k5ou8TQ3UIBA9vu6kUo3vE' };   // carpetas «procesados» (Config.js de la hoja de Vouchers)
var CTV_FILA_RX_ = /\b(originales?|fotos?)\s*!?\s*(?:fila\s*)?(\d{2,6})\b/i;
var CTV_PROP_ = 'CTV_REPONER';

function CTV_entrada_(ss, hoja) { var c = TG_cfg_(ss); return hoja === 'Fotos' ? c.carpetaFotos : c.carpetaOriginales; }
function CTV_otra_(h) { return h === 'Fotos' ? 'Originales' : 'Fotos'; }
function CTV_norm_(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** «cambia el último a foto», «pasa Originales 2705 a fotos», «el último era original» → {hacia, hoja?, fila?} | null */
function CTV_pedido_(texto) {
  var t = String(texto || '');
  var a = t.match(/\b(?:cambi\w*|pas[ae]\w*|pasar|muev\w*|mover|convi[eé]rt\w*)\b[\s\S]{0,60}?\b(?:a|como|en)\s+(?:la\s+pesta[ñn]a\s+(?:de\s+)?)?(fotos?|originale?s?)\b/i);
  var b = !a && t.match(/\b(?:era|es)\s+(?:un[ao]?\s+)?(fotos?|originale?s?)\b/i);
  var m = a || b;
  if (!m) return null;
  var f = t.match(CTV_FILA_RX_), ultimo = /(^|[^a-z])[uú]ltim[oa]\b/i.test(t);
  if (b && !f && !ultimo) return null;   // «era foto» solo si dice cuál (el último o una fila)
  var hacia = /^f/i.test(m[1]) ? 'Fotos' : 'Originales';
  var p = { hacia: hacia };
  if (f) { p.hoja = /^o/i.test(f[1]) ? 'Originales' : 'Fotos'; p.fila = Number(f[2]); if (p.hoja === hacia) return null; }
  return p;
}

/** Lo último que entró: un archivo aún en entrada, o el último procesado (por «Fecha Procesamiento»). */
function CTV_ultimo_(ss, ssV) {
  var mejor = null;
  CTV_HOJAS_.forEach(function (h) {
    try {
      var it = DriveApp.getFolderById(CTV_entrada_(ss, h)).getFiles();
      while (it.hasNext()) { var f = it.next(); var t = f.getDateCreated().getTime(); if (!mejor || t > mejor.t) mejor = { t: t, pendiente: true, hoja: h, archivo: f.getName(), file: f }; }
    } catch (e) { /* sin acceso a esa carpeta */ }
  });
  CTV_HOJAS_.forEach(function (h) {
    var sh = ssV.getSheetByName(h);
    if (!sh || sh.getLastRow() < 2) return;
    var n = Math.min(400, sh.getLastRow() - 1), ini = sh.getLastRow() - n + 1;
    var v = sh.getRange(ini, 11, n, 2).getValues();   // K archivo, L fecha de proceso
    for (var i = v.length - 1; i >= 0; i--) {
      var d = v[i][1] instanceof Date ? v[i][1].getTime() : 0, a = String(v[i][0] || '').trim();
      if (a && d && (!mejor || d > mejor.t)) mejor = { t: d, pendiente: false, hoja: h, archivo: a, fila: ini + i };
    }
  });
  return mejor;
}

/** Qué se va a hacer (sin hacer nada todavía). → {ok, texto, plan} */
function CTV_plan_(ss, pedido) {
  var cfg = leerConfig_(ss), ssV = SpreadsheetApp.openById(cfg.idVouchers);
  var x;
  if (pedido.hoja && pedido.fila) {
    var sh = ssV.getSheetByName(pedido.hoja);
    if (!sh || pedido.fila < 2 || pedido.fila > sh.getLastRow()) return { ok: false, texto: 'No encontré la fila ' + pedido.hoja + '!' + pedido.fila + '.' };
    var a = String(sh.getRange(pedido.fila, 11).getValue() || '').trim();
    if (!a) return { ok: false, texto: 'La fila ' + pedido.hoja + '!' + pedido.fila + ' no tiene «Archivo Original» (columna K).' };
    x = { pendiente: false, hoja: pedido.hoja, archivo: a, fila: pedido.fila };
  } else {
    x = CTV_ultimo_(ss, ssV);
    if (!x) return { ok: false, texto: 'No encontré ningún voucher reciente.' };
  }
  var hacia = pedido.hacia || CTV_otra_(x.hoja);
  if (x.hoja === hacia) return { ok: false, texto: '«' + x.archivo + '» ya está como ' + (hacia === 'Fotos' ? '📸 Foto' : '📄 Original') + '.' };
  var plan = { pendiente: x.pendiente, desde: x.hoja, hacia: hacia, archivo: x.archivo, filas: [] };
  if (x.pendiente) {
    return { ok: true, plan: plan, texto: '🔁 «' + x.archivo + '» todavía está por procesar (entrada de ' + x.hoja + '). Lo paso a la entrada de <b>' + hacia + '</b>.' };
  }
  var shO = ssV.getSheetByName(x.hoja), k = shO.getRange(2, 11, shO.getLastRow() - 1, 1).getValues();
  k.forEach(function (r, i) { if (String(r[0] || '').trim() === x.archivo) plan.filas.push(i + 2); });
  if (!plan.filas.length) return { ok: false, texto: 'No encontré filas de «' + x.archivo + '» en ' + x.hoja + '.' };
  return { ok: true, plan: plan, texto: '🔁 «' + x.archivo + '» ya está procesado en <b>' + x.hoja + '</b> (' + plan.filas.length + ' voucher(s): fila' + (plan.filas.length > 1 ? 's ' : ' ') +
    plan.filas.join(', ') + '). Lo vuelvo a procesar como <b>' + hacia + '</b>:\n• esas filas se vacían (no se borran);\n• el archivo vuelve a la carpeta de entrada de ' + hacia +
    ' y la hoja lo procesa de nuevo (unos minutos);\n• lo escrito a mano (RUC, facturas, empresa, revisado, nota) se vuelve a poner solo en las filas nuevas.' };
}

/** Hacerlo. → {ok, texto} */
function CTV_hacer_(ss, plan, quien) {
  var cfg = leerConfig_(ss), ssV = SpreadsheetApp.openById(cfg.idVouchers);
  var destino = DriveApp.getFolderById(CTV_entrada_(ss, plan.hacia));
  if (plan.pendiente) {
    var origen = DriveApp.getFolderById(CTV_entrada_(ss, plan.desde)), it = origen.getFilesByName(plan.archivo), f = null;
    while (it.hasNext()) { var g = it.next(); if (!f || g.getDateCreated() > f.getDateCreated()) f = g; }
    if (!f) return { ok: false, texto: '«' + plan.archivo + '» ya no está en la entrada de ' + plan.desde + ' (quizá ya se procesó). Vuelva a intentarlo.' };
    f.moveTo(destino);
    return { ok: true, texto: '✅ «' + plan.archivo + '» pasó a la entrada de <b>' + plan.hacia + '</b>: se procesa como ' + (plan.hacia === 'Fotos' ? '📸 Foto' : '📄 Original') + ' en la próxima vuelta de la hoja (≤ 10 min).' };
  }
  // ya procesado: comprobar que las filas siguen siendo de ese archivo
  var sh = ssV.getSheetByName(plan.desde), nCol = sh.getLastColumn(), tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0];
  var guardadas = [];
  for (var i = 0; i < plan.filas.length; i++) {
    var fila = plan.filas[i], v = sh.getRange(fila, 1, 1, nCol).getValues()[0];
    if (String(v[10] || '').trim() !== plan.archivo) return { ok: false, texto: '⚠️ La fila ' + plan.desde + '!' + fila + ' cambió mientras tanto: no hice nada. Vuelva a pedirlo.' };
    var datos = {};
    for (var c = 14; c < nCol; c++) {   // columnas O en adelante: lo agregado a mano
      var val = v[c];
      if (val === '' || val === null || val === false) continue;
      datos[tit[c]] = val instanceof Date ? { d: val.toISOString() } : val;
    }
    guardadas.push({ pag: Number(v[12]) || 0, op: String(v[1] || ''), datos: datos });
  }
  // el archivo (la versión más nueva, en «procesados» de la pestaña de origen)
  var f2 = null, it2 = DriveApp.getFolderById(CTV_PROC_[plan.desde]).getFilesByName(plan.archivo);
  while (it2.hasNext()) { var h = it2.next(); if (!h.isTrashed() && (!f2 || h.getDateCreated() > f2.getDateCreated())) f2 = h; }
  if (!f2) return { ok: false, texto: '⚠️ No encontré el archivo «' + plan.archivo + '» en la carpeta de procesados de ' + plan.desde + ': no hice nada.' };
  // vaciar las filas (sin borrarlas) y mover el archivo
  plan.filas.forEach(function (fila) { sh.getRange(fila, 1, 1, nCol).clearContent().clearNote(); });
  try { sh.getRange(plan.filas[0], 2).setNote('🔁 ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm') + ' · ' + (quien || '') + ': «' + plan.archivo + '» se pasó a ' + plan.hacia + ' y se vuelve a procesar ahí.'); } catch (e) { /* sin nota */ }
  f2.moveTo(destino);
  var p = PropertiesService.getScriptProperties(), lista = [];
  try { lista = JSON.parse(p.getProperty(CTV_PROP_) || '[]'); } catch (e) { lista = []; }
  lista.push({ archivo: plan.archivo, hacia: plan.hacia, filas: guardadas, t: Date.now(), n: 0, quien: quien || '' });
  p.setProperty(CTV_PROP_, JSON.stringify(lista.slice(-20)));
  CTV_programar_();
  var conDatos = guardadas.filter(function (g) { return Object.keys(g.datos).length; }).length;
  return { ok: true, texto: '✅ «' + plan.archivo + '» se vuelve a procesar como <b>' + plan.hacia + '</b>: vacié ' + plan.filas.length + ' fila(s) de ' + plan.desde +
    ' y el archivo está en la entrada de ' + plan.hacia + ' (la hoja lo procesa en ≤ 10 min).' + (conDatos ? ' Lo escrito a mano de ' + conDatos + ' fila(s) se repone solo en las filas nuevas.' : '') };
}

function CTV_programar_() {
  if (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'CTV_reponer'; })) return;
  ScriptApp.newTrigger('CTV_reponer').timeBased().after(3 * 60 * 1000).create();
}

/** Cada 3 min mientras haya algo: cuando aparecen las filas nuevas, repone lo escrito a mano (solo en celdas vacías). */
function CTV_reponer() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'CTV_reponer') ScriptApp.deleteTrigger(t); });
  var p = PropertiesService.getScriptProperties(), lista = [];
  try { lista = JSON.parse(p.getProperty(CTV_PROP_) || '[]'); } catch (e) { lista = []; }
  if (!lista.length) return;
  var ss = ssPrincipal_(), ssV = SpreadsheetApp.openById(leerConfig_(ss).idVouchers), quedan = [];
  lista.forEach(function (x) {
    try {
      var sh = ssV.getSheetByName(x.hacia), nCol = sh.getLastColumn(), tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0];
      var n = sh.getLastRow() - 1, k = n > 0 ? sh.getRange(2, 1, n, nCol).getValues() : [], filas = [];
      k.forEach(function (r, i) { if (String(r[10] || '').trim() === x.archivo) filas.push({ fila: i + 2, pag: Number(r[12]) || 0, v: r }); });
      if (!filas.length) { if (++x.n < 20) quedan.push(x); return; }   // aún no se procesa (hasta ~1 hora)
      x.filas.forEach(function (g, j) {
        if (!Object.keys(g.datos).length) return;
        var dest = filas.filter(function (f) { return g.pag && f.pag === g.pag; })[0] || filas[j];
        if (!dest) return;
        Object.keys(g.datos).forEach(function (cab) {
          var c = tit.indexOf(cab);
          if (c < 14 || dest.v[c] !== '' && dest.v[c] !== null && dest.v[c] !== false) return;   // solo O en adelante y solo si está vacía
          var val = g.datos[cab];
          sh.getRange(dest.fila, c + 1).setValue(val && val.d ? new Date(val.d) : val);
        });
        try { sh.getRange(dest.fila, 2).setNote('🔁 Repuesto lo escrito a mano antes de pasar de ' + CTV_otra_(x.hacia) + ' a ' + x.hacia + (x.quien ? ' (' + x.quien + ')' : '')); } catch (e) { /* sin nota */ }
      });
    } catch (e) { console.warn('CTV_reponer: ' + e.message); if (++x.n < 20) quedan.push(x); }
  });
  p.setProperty(CTV_PROP_, JSON.stringify(quedan));
  if (quedan.length) CTV_programar_();
}

/* ============================================================ Telegram */

function CTV_tg_(ctx, texto) {
  var ped = CTV_pedido_(texto);
  if (!ped) return false;
  var r;
  try { r = CTV_plan_(ctx.ss || TG_ss_(), ped); } catch (e) { r = { ok: false, texto: '⚠️ ' + e.message }; }
  if (!r.ok) { TG_enviar_(ctx.chatId, TG_esc_(r.texto)); return true; }
  var k = TG_guardarBoton_({ t: 'ctv', plan: r.plan });
  TG_enviar_(ctx.chatId, r.texto.replace(/&(?!lt;|gt;|amp;)/g, '&amp;'), [[{ text: '✅ Sí, cambiar', callback_data: 'k:' + k + ':si' }, { text: '✖ Cancelar', callback_data: 'k:' + k + ':no' }]]);
  return true;
}

function CTV_alBoton_(ctx, datos, op) {
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  if (op !== 'si') return TG_enviar_(ctx.chatId, 'Cancelado: no cambié nada.');
  var r;
  try { r = CTV_hacer_(ctx.ss || TG_ss_(), datos.plan, 'Telegram · ' + (ctx.nombre || ctx.chatId)); } catch (e) { r = { texto: '⚠️ ' + e.message }; }
  TG_enviar_(ctx.chatId, r.texto);
}

/* ============================================================ WhatsApp (confirmación con «sí») */

function CTV_wa_(ss, texto, clave) {
  var ses = TG_sesion_(clave), t = String(texto || '').trim();
  if (ses.esperando && ses.esperando.tipo === 'ctv') {
    var pl = ses.esperando.plan; ses.esperando = null; TG_guardarSesion_(clave, ses);
    if (/^(s[ií]|si,? cambia\w*|ok|dale|confirmo)\b/i.test(t)) {
      var r1; try { r1 = CTV_hacer_(ss, pl, 'WhatsApp'); } catch (e) { r1 = { texto: '⚠️ ' + e.message }; }
      return TG_sinHtml_(r1.texto);
    }
    if (/^(no|cancela\w*)\b/i.test(t)) return 'Cancelado: no cambié nada.';
  }
  var ped = CTV_pedido_(t);
  if (!ped) return null;
  var r;
  try { r = CTV_plan_(ss, ped); } catch (e) { r = { ok: false, texto: '⚠️ ' + e.message }; }
  if (!r.ok) return r.texto;
  ses = TG_sesion_(clave); ses.esperando = { tipo: 'ctv', plan: r.plan }; TG_guardarSesion_(clave, ses);
  return TG_sinHtml_(r.texto) + '\n\nResponda *sí* para hacerlo o *no* para cancelar.';
}

/* ============================================================ hojas (menú) y portal (canal vch) */

/** Menú 🧠 Asistente IA → 🔁 Cambiar Original ↔ Foto (Cobranzas; en la hoja de Vouchers lo llama VIA_menuCambiarTipo). */
function CTV_menuCambiar() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('🔁 Cambiar Original ↔ Foto', 'Escriba qué y a dónde, por ejemplo:\n   el último a foto\n   Originales 2705 a foto\n   Fotos 382 a original', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText();
  var ped = CTV_pedido_('cambia ' + t) || (/\b(fotos?|originale?s?)\b/i.test(t) ? { hacia: /\bfoto/i.test(t) ? 'Fotos' : 'Originales' } : null);
  if (!ped) return ui.alert('No entendí. Ejemplo: «el último a foto» o «Originales 2705 a foto».');
  var ss = ssPrincipal_(), pl = CTV_plan_(ss, ped);
  if (!pl.ok) return ui.alert(TG_sinHtml_(pl.texto));
  if (ui.alert('🔁 Cambiar Original ↔ Foto', TG_sinHtml_(pl.texto) + '\n\n¿Lo hago?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var quien = ''; try { quien = Session.getActiveUser().getEmail(); } catch (e) {}
  ui.alert(TG_sinHtml_(CTV_hacer_(ss, pl.plan, 'hoja · ' + quien).texto));
}

/** canal vch: {paso:'plan'|'hacer', pedido | plan, quien} */
function CTV_vch_(ss, q) {
  if (q.paso === 'hacer') return CTV_hacer_(ss, q.plan || {}, String(q.quien || 'hoja de Vouchers').slice(0, 80));
  var ped = q.pedido || {};
  ped = { hacia: ped.hacia === 'Fotos' || ped.hacia === 'Originales' ? ped.hacia : '', hoja: CTV_HOJAS_.indexOf(ped.hoja) >= 0 ? ped.hoja : '', fila: Number(ped.fila) || 0 };
  if (!ped.hacia && !ped.hoja) return { ok: false, texto: 'Falta a dónde (Fotos u Originales).' };
  return CTV_plan_(ss, ped);
}
