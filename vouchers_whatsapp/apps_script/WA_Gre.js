/**
 * 🚚 Guía de remisión por SUNAT desde WhatsApp: junta las fotos/PDF de UNA guía y se los manda a Cobranzas
 * (cobranzas/telegram/TG_GRE.js), que arma la propuesta con sus botones. Tres formas:
 *
 *   1. ANTES: "emite guía" (y lo que sepa: "llegada Av. Mártires", "peso 30258.5") → luego manda o REENVÍA las
 *      fotos. Un minuto después del último archivo se arma sola (o al escribir "listo").
 *   2. CON COMENTARIO: foto/PDF con "guía" → lo que llegue en los 5 minutos siguientes se suma; al final "guía …".
 *   3. DESPUÉS: reenvió las fotos (quedaron en "¿De quién son?") y escribe "guía …" → salen de vouchers.
 * Mientras hay una guía abierta, los archivos de ese número NO van a vouchers. Esperan en una carpeta aparte y se
 * borran al mandarlos.
 */

var WA_GRE_RX_ = /\b(gu[ií]a(s)?|gre|remisi[oó]n)\b/i;
var WA_GRE_MIN_ = 5;          // la guía abierta espera archivos hasta 5 min
var WA_GRE_SOLA_MS_ = 60000;  // modo 1: se arma sola 1 min después del último archivo

function WA_greCarpeta_() {
  var id = WA_prop_('WA_GRE_CARPETA');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('Vouchers WhatsApp · guías (temporal)');
  WA_props_().setProperty('WA_GRE_CARPETA', f.getId());
  return f;
}

function WA_greTanda_(de) {
  try { return JSON.parse(WA_prop_('WA_GRE_' + de) || 'null'); } catch (e) { return null; }
}

function WA_greGuardar_(de, t) {
  WA_props_().setProperty('WA_GRE_' + de, JSON.stringify(t));
}

function WA_greVigente_(t) {
  return t && Date.now() - t.ultimo < WA_GRE_MIN_ * 60000;
}

/** ¿Este archivo es para una guía? Si es así lo guarda y responde. true si lo tomó. */
function WA_greArchivo_(m, de, media, caption, mime, esPdf) {
  var t = WA_greTanda_(de), vigente = WA_greVigente_(t);
  if (!WA_GRE_RX_.test(caption) && !vigente) return false;
  if (!vigente) t = { ids: [], textos: [], ultimo: 0, nombre: '' };
  var blob = WA_bajarMedia_(media.id).setName(media.filename || ('guia ' + m.id + (esPdf ? '.pdf' : '.jpg')));
  t.ids.push(WA_greCarpeta_().createFile(blob).getId());
  if (caption) t.textos.push(caption);
  t.ultimo = Date.now();
  WA_greGuardar_(de, t);
  if (t.ids.length === 1) WA_enviarTexto_(de, t.sola
    ? '🚚 Recibiendo los archivos de la guía… Cuando termine de mandarlos la armo sola (o escriba *listo*).'
    : '🚚 Recibí el archivo para la *guía de remisión*. Mande los demás (factura, ticket, tarjeta del transportista) y luego escriba *guía* con lo que sepa (ej. "guía llegada Av. Mártires").');
  return true;
}

/**
 * Textos de guía. true si lo tomó:
 *   · "listo" o "guía …" con archivos juntados (o en Espera de "¿De quién son?") → se manda todo a Cobranzas;
 *   · "emite guía …" sin archivos → abre la guía y espera las fotos (modo 1).
 */
function WA_greTexto_(m, de, nombre, cuerpo) {
  var t = WA_greTanda_(de), vigente = WA_greVigente_(t);
  var listo = /^\s*(listo|ya|eso es todo|termin[eé]|env[ií]a(la)?|arma(la)?)\s*[.!]*\s*$/i.test(cuerpo);
  if (!(WA_GRE_RX_.test(cuerpo) || (listo && vigente))) return false;
  if (vigente && WA_GRE_RX_.test(cuerpo) && !listo) t.textos.push(cuerpo);
  if (!vigente || !t.ids.length) {
    var esp = WA_greDesdeEspera_(de);
    if (esp && esp.ids.length) { t = esp; if (!listo) t.textos.push(cuerpo); }
  }
  if (t && t.ids.length) { WA_greMandar_(de, nombre, t, m.id); return true; }
  if (listo || !(/^\s*\/?gu[ií]a\b/i.test(cuerpo) || /\b(emit|emite|hac|haz|gener|sac|arm|crea|necesit|quiero)/i.test(cuerpo))) return false;
  // Sin archivos todavía: se abre la guía y se esperan las fotos.
  WA_greGuardar_(de, { ids: [], textos: [cuerpo], ultimo: Date.now(), sola: true, nombre: nombre });
  WA_enviarTexto_(de, '🚚 *Guía de remisión*: mande (o reenvíe) ahora la factura, el ticket y la tarjeta del transportista. ' +
    'Cuando terminen de llegar armo la propuesta sola (o escriba *listo*). Nada se emite sin su confirmación.');
  return true;
}

/** Manda los archivos juntados (y lo que se escribió) a Cobranzas. */
function WA_greMandar_(de, nombre, t, idMsg) {
  WA_props_().deleteProperty('WA_GRE_' + de);
  var adjuntos = [];
  t.ids.forEach(function (id) {
    try {
      var f = DriveApp.getFileById(id), b = f.getBlob();
      adjuntos.push({ base64: Utilities.base64Encode(b.getBytes()), mime: b.getContentType(), nombre: f.getName() });
      f.setTrashed(true);
    } catch (e) {}
  });
  var texto = t.textos.filter(Boolean).join(' · ');
  if (!/^\s*\/?gu[ií]a\b/i.test(texto)) texto = 'guía ' + texto;
  WA_enviarTexto_(de, '🚚 Leyendo ' + adjuntos.length + ' archivo(s) para la guía (no se registran como vouchers)…');
  WA_preguntarIA_({ id: idMsg || ('gre' + Date.now()) }, de, nombre || t.nombre || '', texto, adjuntos);
}

/** Archivos de este número que esperan "¿De quién son?": pasan a la guía (la fila queda como "Guía"). */
function WA_greDesdeEspera_(de) {
  var hoja = WA_hoja_(), datos = hoja.getDataRange().getValues(), filas = WA_filasEspera_(datos, de);
  if (!filas.length) return null;
  var t = { ids: [], textos: [], ultimo: Date.now() };
  filas.forEach(function (i) {
    if (datos[i][9]) t.ids.push(String(datos[i][9]));
    hoja.getRange(i + 1, 7, 1, 2).setValues([['Guía', '🚚 usado para guía de remisión']]);
  });
  WA_props_().deleteProperty('WA_PREG_' + de);   // ya no se pregunta de quién son
  return t;
}

/** WA_cadaMinuto: arma las guías abiertas con "emite guía" cuando dejaron de llegar archivos; avisa las vencidas. */
function WA_greCadaMinuto_(props) {
  Object.keys(props).filter(function (k) { return k.indexOf('WA_GRE_') === 0 && k !== 'WA_GRE_CARPETA'; }).forEach(function (k) {
    var de = k.slice('WA_GRE_'.length), t;
    try { t = JSON.parse(props[k]); } catch (e) { return; }
    var quieto = Date.now() - t.ultimo;
    if (t.sola && t.ids.length && quieto >= WA_GRE_SOLA_MS_) return WA_greMandar_(de, t.nombre, t);
    if (quieto >= WA_GRE_MIN_ * 60000) {
      WA_props_().deleteProperty(k);
      if (t.ids.length) WA_greMandar_(de, t.nombre, t);
      else WA_enviarTexto_(de, '⌛ No llegaron archivos para la guía. Cuando quiera, escriba de nuevo *emite guía*.');
    }
  });
}
