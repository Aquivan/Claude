/**
 * 🚚 Guía de remisión por SUNAT desde WhatsApp: junta las fotos/PDF y lo que la persona escribe para UNA guía y se
 * lo manda todo junto a Cobranzas (cobranzas/telegram/TG_GRE.js), donde la IA lo analiza de una vez.
 *
 *   1. ANTES: "emite guía" (y lo que sepa) → luego manda o REENVÍA las fotos y escribe lo que quiera ("compra",
 *      "partida Tacna", "llegada Av. Mártires"). Un minuto después del último mensaje se arma sola (o con "listo").
 *   2. CON COMENTARIO: foto/PDF con "guía" → igual que 1.
 *   3. DESPUÉS: reenvió las fotos (quedaron en "¿De quién son?") y escribe "guía …" → salen de vouchers.
 * Mientras la guía está abierta, los archivos y textos de ese número NO van a vouchers ni a la IA general.
 * Cada archivo y cada texto se guarda en su propia propiedad: varios reenvíos que llegan a la vez no se pisan.
 */

var WA_GRE_RX_ = /\b(gu[ií]a(s)?|gre|remisi[oó]n)\b/i;
var WA_GRE_MIN_ = 5;          // la guía abierta espera hasta 5 min sin mensajes
var WA_GRE_SOLA_MS_ = 60000;  // se arma sola 1 min después del último mensaje (si ya hay archivos)

function WA_greCarpeta_() { return WA_carpetaFija_('WA_GRE_CARPETA', 'Vouchers WhatsApp · guías (temporal)'); }

/**
 * Carpeta de trabajo única (junto a la hoja de Vouchers): la guardada si sigue viva; si no, una que ya se llame así;
 * recién al final se crea. Así varias fotos que llegan a la vez no crean carpetas repetidas, y si alguien la borra
 * (va a la papelera) se usa o crea otra en vez de seguir guardando en la papelera.
 */
function WA_carpetaFija_(prop, nombre) {
  var p = WA_props_(), id = p.getProperty(prop);
  if (id) { try { var g = DriveApp.getFolderById(id); if (!g.isTrashed()) return g; } catch (e) {} }
  var padre = null;
  try { padre = DriveApp.getFileById(WA_HOJA_ID_ || WA_prop_('WA_HOJA_ID')).getParents().next(); } catch (e) {}
  var donde = [padre || DriveApp.getRootFolder()].concat(padre ? [DriveApp.getRootFolder()] : []), f = null;
  donde.forEach(function (d) {
    if (f) return;
    var it = d.getFoldersByName(nombre);
    while (it.hasNext() && !f) { var x = it.next(); if (!x.isTrashed()) f = x; }
  });
  if (!f) f = (padre || DriveApp.getRootFolder()).createFolder(nombre);
  p.setProperty(prop, f.getId());
  return f;
}

/** Estado de la guía abierta de este número: {abierta, ultimo, nombre, ids:[...], textos:[...]} o null. */
function WA_greTanda_(de) {
  var p = WA_props_().getProperties(), meta = null;
  try { meta = JSON.parse(p['WA_GRE_' + de] || 'null'); } catch (e) {}
  if (!meta) return null;
  var arch = Object.keys(p).filter(function (k) { return k.indexOf('WA_GREA_' + de + '_') === 0; }).sort();
  var txt = Object.keys(p).filter(function (k) { return k.indexOf('WA_GRET_' + de + '_') === 0; }).sort();
  meta.ids = arch.map(function (k) { return p[k]; });
  meta.textos = txt.map(function (k) { return p[k]; });
  meta.claves = arch.concat(txt);
  var ult = Math.max.apply(null, [meta.ultimo || 0].concat(meta.claves.map(function (k) { var x = k.split('_'); return Number(x[x.length - 2]) || 0; })));
  meta.ultimo = ult;
  return meta;
}

function WA_greVigente_(t) {
  return t && Date.now() - t.ultimo < WA_GRE_MIN_ * 60000;
}

function WA_greAbrir_(de, nombre) {
  WA_props_().setProperty('WA_GRE_' + de, JSON.stringify({ ultimo: Date.now(), nombre: nombre || '' }));
}

function WA_greAnotarTexto_(de, texto) {
  WA_props_().setProperty('WA_GRET_' + de + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000), String(texto).slice(0, 1500));
}

/** 🎤 Nota de voz con la guía abierta: se guarda como archivo de la guía (la IA la escucha junto con todo). true si la tomó. */
function WA_greAudio_(de, m) {
  if (!WA_greVigente_(WA_greTanda_(de))) return false;
  var blob = WA_bajarMedia_(m.audio.id).setName('nota de voz ' + m.id + '.ogg');
  WA_props_().setProperty('WA_GREA_' + de + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000), WA_greCarpeta_().createFile(blob).getId());
  WA_enviarTexto_(de, '🎤 Escuchado: lo tomo para la guía.');
  return true;
}

/** ¿Este archivo es para una guía? Si es así lo guarda (sin pisar a otros) y responde. true si lo tomó. */
function WA_greArchivo_(m, de, media, caption, mime, esPdf) {
  var t = WA_greTanda_(de), vigente = WA_greVigente_(t);
  if (!WA_GRE_RX_.test(caption) && !vigente) return false;
  if (!vigente) WA_greAbrir_(de, '');
  var blob = WA_bajarMedia_(media.id).setName(media.filename || ('guia ' + m.id + (esPdf ? '.pdf' : '.jpg')));
  var id = WA_greCarpeta_().createFile(blob).getId();
  WA_props_().setProperty('WA_GREA_' + de + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000), id);
  if (caption && !/^\s*gu[ií]a\s*$/i.test(caption)) WA_greAnotarTexto_(de, caption);
  if (!t || !t.ids || !t.ids.length) WA_enviarTexto_(de, '🚚 Recibiendo los archivos de la guía… Puede escribirme o dictarme lo que quiera agregar. ' +
    'Un minuto después de su último mensaje armo la propuesta (o escriba *listo*).');
  return true;
}

/**
 * Textos de guía. true si lo tomó:
 *   · con la guía abierta: CUALQUIER texto se anota para la guía ("listo" la manda ya);
 *   · "guía …" con archivos en Espera de "¿De quién son?" → salen de vouchers y se manda;
 *   · "emite guía …" sin archivos → abre la guía y espera las fotos.
 */
function WA_greTexto_(m, de, nombre, cuerpo) {
  if (/^\s*\/?(pdf|m[aá]nd[ae]me el pdf|env[ií]a(me)? el pdf|reenv[ií]a(me)? el pdf)\b/i.test(cuerpo)) return false;   // lo contesta Cobranzas
  var t = WA_greTanda_(de), vigente = WA_greVigente_(t);
  var listo = /^\s*(listo|ya|eso es todo|termin[eé]|env[ií]a(la)?|arma(la)?)\s*[.!]*\s*$/i.test(cuerpo);
  // 🛑 "olvidar", "detener", "cancelar"…: cierra la guía que se estaba juntando (no se emite nada).
  if (vigente && /^\s*\/?(olvid\w*|deten\w*|det[eé]n|cancel\w*|anul\w*|salir|par[ae]r?|basta|no\s+(quiero|va)|borra\w*|descarta\w*)\b/i.test(cuerpo)) {
    WA_greCerrar_(de, t);
    WA_enviarTexto_(de, '🗑 Listo: dejé de juntar la guía nueva. No se emitió nada.');
    return true;
  }
  // Una guía que ya existe ("emitir guía fab56cac", o «emitir guía» respondiendo a su vista previa): la atiende Cobranzas.
  var caso = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/i.test(cuerpo);
  var soloEmitir = /^\s*\/?(emitir|emite|em[ií]tel[ao]|emitirl[ao])(\s+(la\s+)?gu[ií]a)?\s*[.!]*\s*$/i.test(cuerpo);
  if (caso || soloEmitir) {
    if (vigente && !(t.ids || []).length) WA_greCerrar_(de, t);   // la guía "nueva" vacía que se abrió por error
    if (caso || !vigente || !(t.ids || []).length) return false;
  }
  if (vigente) {
    if (!listo) WA_greAnotarTexto_(de, cuerpo);
    t = WA_greTanda_(de);
    if (listo && t.ids.length) { WA_greMandar_(de, nombre, t, m.id); return true; }
    if (listo) { WA_enviarTexto_(de, '🚚 Todavía no me llegó ningún archivo para la guía. Mándelos (o reenvíelos) y escriba *listo*.'); return true; }
    if (!t.ids.length) {
      var esp0 = WA_greDesdeEspera_(de);   // ¿las fotos ya habían llegado y esperaban nombre?
      if (esp0) { WA_greMandar_(de, nombre, WA_greTanda_(de), m.id); return true; }
    }
    WA_enviarTexto_(de, '📝 Anotado para la guía.');
    return true;
  }
  if (!WA_GRE_RX_.test(cuerpo) || /\bpdf\b/i.test(cuerpo)) return false;   // "pdf guía …" lo contesta Cobranzas con el archivo
  WA_greAbrir_(de, nombre);
  WA_greAnotarTexto_(de, cuerpo);
  if (WA_greDesdeEspera_(de)) { WA_greMandar_(de, nombre, WA_greTanda_(de), m.id); return true; }
  if (!(/^\s*\/?gu[ií]a\b/i.test(cuerpo) || /\b(emit|emite|hac|haz|gener|sac|arm|crea|necesit|quiero)/i.test(cuerpo))) {
    WA_props_().getKeys().filter(function (k) { return k === 'WA_GRE_' + de || k.indexOf('WA_GRET_' + de + '_') === 0; }).forEach(function (k) { WA_props_().deleteProperty(k); });
    return false;   // habla de guías pero no pide una: va a la IA general
  }
  WA_enviarTexto_(de, '🚚 *Guía de remisión*: mande (o reenvíe) la factura, el ticket y la tarjeta del transportista, y escríbame o dícteme lo que sepa. ' +
    'Un minuto después de su último mensaje armo la propuesta (o escriba *listo*). Nada se emite sin su confirmación.');
  return true;
}

/** Cierra la guía que se estaba juntando: borra lo anotado y manda a la papelera los archivos temporales. */
function WA_greCerrar_(de, t) {
  t = t || WA_greTanda_(de);
  (t && t.ids || []).forEach(function (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} });
  ((t && t.claves) || []).concat(['WA_GRE_' + de]).forEach(function (k) { WA_props_().deleteProperty(k); });
}

/** Manda los archivos y TODO lo escrito a Cobranzas (la IA lo analiza junto). */
function WA_greMandar_(de, nombre, t, idMsg) {
  (t.claves || []).concat(['WA_GRE_' + de]).forEach(function (k) { WA_props_().deleteProperty(k); });
  var adjuntos = [];
  t.ids.forEach(function (id) {
    try {
      var f = DriveApp.getFileById(id), b = f.getBlob();
      adjuntos.push({ base64: Utilities.base64Encode(b.getBytes()), mime: b.getContentType(), nombre: f.getName() });
      f.setTrashed(true);
    } catch (e) {}
  });
  var texto = t.textos.filter(Boolean).join('\n');
  if (!/^\s*\/?gu[ií]a\b/i.test(texto)) texto = 'guía\n' + texto;
  WA_enviarTexto_(de, '🚚 Analizando ' + adjuntos.length + ' archivo(s) y lo que me escribió (no se registran como vouchers)…');
  WA_preguntarIA_({ id: idMsg || ('gre' + Date.now()) }, de, nombre || t.nombre || '', texto, adjuntos);
}

/** Archivos de este número que esperan "¿De quién son?": pasan a la guía abierta (la fila queda como "Guía"). true si había. */
function WA_greDesdeEspera_(de) {
  var hoja = WA_hoja_(), datos = hoja.getDataRange().getValues(), filas = WA_filasEspera_(datos, de);
  if (!filas.length) return false;
  filas.forEach(function (i, n) {
    if (datos[i][9]) WA_props_().setProperty('WA_GREA_' + de + '_' + Date.now() + '_' + n, String(datos[i][9]));
    hoja.getRange(i + 1, 7, 1, 2).setValues([['Guía', '🚚 usado para guía de remisión']]);
  });
  WA_props_().deleteProperty('WA_PREG_' + de);   // ya no se pregunta de quién son
  return true;
}

/** WA_cadaMinuto: arma las guías abiertas cuando la persona dejó de mandar; avisa las vencidas sin archivos. */
function WA_greCadaMinuto_(props) {
  Object.keys(props).filter(function (k) { return /^WA_GRE_\d+$/.test(k); }).forEach(function (k) {
    var de = k.slice('WA_GRE_'.length), t = WA_greTanda_(de);
    if (!t) return;
    var quieto = Date.now() - t.ultimo;
    if (t.ids.length && quieto >= WA_GRE_SOLA_MS_) return WA_greMandar_(de, t.nombre, t);
    if (quieto >= WA_GRE_MIN_ * 60000) {
      t.claves.concat([k]).forEach(function (x) { WA_props_().deleteProperty(x); });
      WA_enviarTexto_(de, '⌛ No llegaron archivos para la guía. Cuando quiera, escriba de nuevo *emite guía*.');
    }
  });
}
