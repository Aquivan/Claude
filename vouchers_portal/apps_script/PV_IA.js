/**
 * 🧠 Portal de Vouchers — el MISMO 🧠 Asistente IA del menú de la hoja de Vouchers (que es el de Cobranzas):
 * 💬 Chat, 📋 Analizar vouchers procesados, 🔎 Identificar RUC, 🧩 Mesa de conciliación y 🔗 Completar Originales con Fotos.
 *
 * Cómo se conecta, sin claves nuevas: la hoja de Vouchers ya habla con Cobranzas (?canal=vch, con su clave). El portal le pide
 * esa conexión UNA vez por su puente (PV_Puente.js, protegido con la clave del puente) y la guarda en sus propiedades; desde
 * ahí llama a Cobranzas igual que la hoja. Nada de esto llega al navegador.
 */

// Qué puede pedir el portal y con qué permiso (todo lo que escribe pide «editar»).
var PV_IA_ACC_ = {
  chat: 'editar', aplicar: 'editar', deshacer: 'editar', procesados: 'editar',
  rucfilas: 'editar', rucexternos: 'editar', rucestado: 'editar', rucultimas: 'editar', rucaliasborrar: 'editar', rucotro: 'editar', rucelegir: 'editar', rucelegirvarios: 'editar', rucopciones: 'editar',
  mesa: 'editar', vco_ver: 'editar', vco_copiar: 'editar', vco_deshacer: 'editar'
};
// Lo que deja huella en la hoja: se anota en 🌐 Registro portal.
var PV_IA_REG_ = { aplicar: '🧠 Escribió lo propuesto por la IA', deshacer: '🧠 Deshizo lo último de la IA', rucelegir: '🔎 Eligió un RUC', rucelegirvarios: '🔎 Escribió varios RUC', rucaliasborrar: '🗑 Borró un alias',
  vco_copiar: '🔗 Copió de Fotos a Originales', vco_deshacer: '🔗 Deshizo la copia de Fotos', mesa: '🧩 Abrió la Mesa de conciliación' };

function PV_conexionIA_(nueva) {
  var p = PropertiesService.getScriptProperties();
  if (!nueva) { try { var g = JSON.parse(p.getProperty('PV_IA_CONEX') || 'null'); if (g && g.url && g.clave) return g; } catch (e) {} }
  var r = PV_puente_('conexionIA', {});
  if (!r.ok || !r.url || !r.clave) throw new Error(r.error || 'La hoja de Vouchers no tiene el 🧠 Asistente IA conectado con Cobranzas.');
  p.setProperty('PV_IA_CONEX', JSON.stringify({ url: r.url, clave: r.clave }));
  return r;
}

function PV_iaLlamar_(accion, cuerpo, otraVez) {
  var c = PV_conexionIA_(otraVez);
  var r = UrlFetchApp.fetch(c.url + '?canal=vch&accion=' + encodeURIComponent(accion) + '&token=' + encodeURIComponent(c.clave), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo || {}), muteHttpExceptions: true, followRedirects: true });
  var j;
  try { j = JSON.parse(r.getContentText()); }
  catch (e) { return { error: '⚠️ Cobranzas no respondió bien (HTTP ' + r.getResponseCode() + '; quizá se estaba actualizando o tardó demasiado). Intente de nuevo en un minuto.' }; }
  if (j && j.ok === false && /Forbidden/.test(j.error || '') && !otraVez) return PV_iaLlamar_(accion, cuerpo, true);   // la clave cambió: se vuelve a pedir
  return j;
}

/** Desde PV_api('ia'): revisa el permiso de esa acción, completa «quién» y anota lo que escribe. */
function PV_ia_(token, d) {
  var accion = String(d.accion || ''), nivel = PV_IA_ACC_[accion];
  if (!nivel) throw new Error('Acción de IA no permitida.');
  var s = PV_sesion_(token, nivel), cuerpo = d.cuerpo || {};
  if (accion === 'mesa' || accion === 'vco_copiar' || accion === 'vco_deshacer') cuerpo.quien = 'Portal · ' + s.u;
  var r = PV_iaLlamar_(accion, cuerpo);
  if (PV_IA_REG_[accion] && r && !r.error) {
    var det = accion === 'aplicar' ? (cuerpo.ids || []).length + ' cambio(s) · ' + String(r.mensaje || '').slice(0, 300)
      : accion === 'rucelegir' ? String(cuerpo.prov || '') + ' → ' + String(cuerpo.ruc || '') + ' (' + (cuerpo.filas || []).map(function (f) { return f.hoja + '!' + f.fila; }).join(', ') + ')'
      : accion === 'rucaliasborrar' ? String(cuerpo.prov || '') + ' · ' + String(r.mensaje || '').slice(0, 200)
      : accion === 'rucelegirvarios' ? (cuerpo.lista || []).map(function (x) { return String(x.prov || '') + ' → ' + String(x.ruc || ''); }).join('; ').slice(0, 400)
      : String(r.mensaje || '').slice(0, 300);
    PV_registrar_(s, PV_IA_REG_[accion], det);
  }
  return r;
}
