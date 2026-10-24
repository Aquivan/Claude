/**
 * 🚚 Guía de remisión por SUNAT desde WhatsApp: junta las fotos/PDF de UNA guía y se los manda a Cobranzas
 * (cobranzas/telegram/TG_GRE.js), que arma la propuesta con sus botones.
 *
 *   · Foto o PDF con el comentario "guía" (o "gre", "remisión") → empieza la guía; lo que llegue de ese número en
 *     los 5 minutos siguientes (con o sin comentario) se suma a la misma guía, NO a vouchers.
 *   · Después la persona escribe "guía" (y lo que sepa: "peso 30258.5", "llegada Av. Mártires") → se manda todo junto.
 * Los archivos esperan en una carpeta aparte y se borran al mandarlos.
 */

var WA_GRE_RX_ = /\b(gu[ií]a(s)?|gre|remisi[oó]n)\b/i;
var WA_GRE_MIN_ = 5;

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

/** ¿Este archivo es para una guía? Si es así lo guarda y responde. true si lo tomó. */
function WA_greArchivo_(m, de, media, caption, mime, esPdf) {
  var t = WA_greTanda_(de), vigente = t && Date.now() - t.ultimo < WA_GRE_MIN_ * 60000;
  if (!WA_GRE_RX_.test(caption) && !vigente) return false;
  if (!vigente) t = { ids: [], textos: [], ultimo: 0 };
  var blob = WA_bajarMedia_(media.id).setName(media.filename || ('guia ' + m.id + (esPdf ? '.pdf' : '.jpg')));
  t.ids.push(WA_greCarpeta_().createFile(blob).getId());
  if (caption) t.textos.push(caption);
  t.ultimo = Date.now();
  WA_props_().setProperty('WA_GRE_' + de, JSON.stringify(t));
  if (t.ids.length === 1) WA_enviarTexto_(de, '🚚 Recibí el archivo para la *guía de remisión*. Mande los demás (factura, ticket, tarjeta del transportista) y luego escriba *guía* con lo que sepa (ej. "guía llegada Av. Mártires").');
  return true;
}

/** Texto "guía …" con archivos juntados: se manda todo a Cobranzas. true si lo tomó. */
function WA_greTexto_(m, de, nombre, cuerpo) {
  var t = WA_greTanda_(de);
  if (!t || !t.ids.length || !WA_GRE_RX_.test(cuerpo)) return false;
  WA_props_().deleteProperty('WA_GRE_' + de);
  var adjuntos = [];
  t.ids.forEach(function (id) {
    try {
      var f = DriveApp.getFileById(id), b = f.getBlob();
      adjuntos.push({ base64: Utilities.base64Encode(b.getBytes()), mime: b.getContentType(), nombre: f.getName() });
      f.setTrashed(true);
    } catch (e) {}
  });
  var texto = /^\s*\/?gu[ií]a\b/i.test(cuerpo) ? cuerpo : 'guía ' + cuerpo;
  if (t.textos.length) texto += ' · ' + t.textos.join(' · ');
  WA_enviarTexto_(de, '🚚 Leyendo ' + adjuntos.length + ' archivo(s) para la guía…');
  WA_preguntarIA_(m, de, nombre, texto, adjuntos);
  return true;
}
