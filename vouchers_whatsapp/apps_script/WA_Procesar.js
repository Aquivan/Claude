/**
 * 🧾 Procesar documento y ↩️ Deshacer (WhatsApp). El trabajo lo hace Cobranzas (TG_Procesar.js y
 * TG_Deshacer.js), igual que en Telegram; aquí solo se muestran el resumen y los botones.
 *
 * 🧾 En la lista "¿De quién son?" está "🧾 Revisar con IA": la IA lee cada página (voucher, factura,
 *    orden de compra, guía…), ve si el voucher ya está en la hoja y propone registrarlo (solo su
 *    página) y completar la factura. Con ✅ se hace; Cobranzas avisa aquí cuando queda registrado.
 * ↩️ "deshacer": muestra qué se deshace de la última acción (filas, archivos, datos) y pide confirmar.
 */

function WA_cobranzas_(accion, cuerpo) {
  return WA_iaLlamar_({ token: WA_iaClave_(), accion: accion }, cuerpo);
}

/** Opción "🧾 Revisar con IA" de la lista: los archivos en Espera van a Cobranzas en vez de registrarse. */
function WA_revisarConIA_(de, it) {
  var hoja = WA_hoja_(), datos = hoja.getDataRange().getValues(), filas = WA_filasEspera_(datos, de);
  if (!filas.length) { WA_enviarTexto_(de, 'Esos archivos ya se registraron 👍'); return; }
  WA_enviarTexto_(de, '🧾 Leyendo ' + (filas.length > 1 ? 'los ' + filas.length + ' archivos' : 'el archivo') + ' página por página…');
  filas.forEach(function (i) { hoja.getRange(i + 1, 7).setValue('Revisando'); hoja.getRange(i + 1, 11).setValue('resultado'); });
  WA_props_().deleteProperty('WA_PREG_' + de);
  var archivos = filas.map(function (i) { return { id: datos[i][9], nombre: datos[i][4], mime: /\.pdf$/i.test(datos[i][4]) ? 'application/pdf' : 'image/jpeg' }; });
  var r;
  try { r = WA_cobranzas_('procesar', { modo: 'analizar', numero: de, archivos: archivos, procesarUrl: WA_prop_('WA_PROCESAR_URL'),
    nombre: (it && it.nombre) || '', fecha: (it && it.fecha) || '', pestana: WA_prop_('WA_MODO_' + de) }); }   // 📂 su "modo foto/original"
  catch (e) {   // tardó más de 60 s: Cobranzas sigue y WA_cadaMinuto recoge el resultado
    WA_props_().setProperty('WA_PRA_' + de, String(Date.now()));
    WA_props_().setProperty('WA_HAY_PROC', '1');
    return;
  }
  WA_mostrarPlan_(de, r);
}

function WA_mostrarPlan_(de, r) {
  if (!r || !r.ok) { WA_enviarTexto_(de, '⚠️ ' + ((r && r.error) || 'No pude revisarlo.') + '\nMándemelo de nuevo o elija otra opción.'); return; }
  WA_trozos_(WA_md_(r.texto)).forEach(function (t) { WA_enviarTexto_(de, t); });
  WA_botonesPlan_(de, r, '¿Lo hago?');
}

// WhatsApp deja solo 3 botones: ✅ · 📸/📄 pestaña · ✖. El nombre se cambia escribiendo "nombre Edit 15/10".
function WA_botonesPlan_(de, r, pregunta) {
  if (!r.hayAcciones) return;
  WA_props_().setProperty('WA_PRK_' + de, r.k);
  var botones = [{ type: 'reply', reply: { id: 'pr:' + r.k + ':si', title: '✅ Hacerlo' } }];
  if (r.hayNuevos) {
    botones.push(r.pestana === 'foto' ? { type: 'reply', reply: { id: 'pr:' + r.k + ':dor', title: '📄 A Originales' } }
      : { type: 'reply', reply: { id: 'pr:' + r.k + ':dfo', title: '📸 A Fotos' } });
    pregunta += '\n_Para cambiar el nombre escriba: *nombre Edit* o *nombre Edit 15/10*._';
  }
  botones.push({ type: 'reply', reply: { id: 'pr:' + r.k + ':no', title: '✖ Cancelar' } });
  var s = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', to: de, type: 'interactive',
    interactive: { type: 'button', body: { text: pregunta }, action: { buttons: botones } }
  });
  if (!s.ok) WA_enviarTexto_(de, 'Responda *sí* para hacerlo o *no* para cancelar.');
}

/** Botones "pr:<k>:si|nom|no". */
function WA_procesarBoton_(de, id) {
  var p = String(id).split(':'), k = p[1], op = p[2];
  if (op === 'dfo' || op === 'dor') {   // 📸 / 📄 pestaña de la hoja de Vouchers
    var rp;
    try { rp = WA_cobranzas_('procesar', { modo: 'pestana', numero: de, k: k, pestana: op === 'dfo' ? 'foto' : 'original' }); } catch (e) { rp = { ok: false, error: e.message }; }
    if (!rp || !rp.ok) { WA_enviarTexto_(de, '⚠️ ' + ((rp && rp.error) || 'No respondió Cobranzas.')); return; }
    WA_botonesPlan_(de, rp, '📂 Listo: irá a la pestaña *' + rp.textoPestana + '*. ¿Lo hago?');
    return;
  }
  if (op === 'nom') {
    WA_props_().setProperty('WA_PRN_' + de, k);
    WA_enviarTexto_(de, '🏷 Escríbame (o dígame 🎤) el nombre y, si es de otro día, la fecha: *Edit* o *Edit 15/10*.');
    return;
  }
  WA_props_().deleteProperty('WA_PRK_' + de);
  var r;
  try { r = WA_cobranzas_('procesar', { modo: op === 'si' ? 'hacer' : 'cancelar', numero: de, k: k }); }
  catch (e) { r = { ok: false, error: e.message }; }
  if (!r || !r.ok) { WA_enviarTexto_(de, '⚠️ ' + ((r && r.error) || 'No respondió Cobranzas.')); return; }
  WA_marcarRevisando_(de, op === 'si' ? 'Revisado IA' : 'Cancelado', String(r.texto || '').replace(/<[^>]+>/g, '').slice(0, 300));
  WA_trozos_(WA_md_(r.texto)).forEach(function (t) { WA_enviarTexto_(de, t); });
  if (r.pendiente) { WA_props_().setProperty('WA_PROC_' + de, String(Date.now())); WA_props_().setProperty('WA_HAY_PROC', '1'); }
  else if (op === 'si') WA_enviarTexto_(de, '_Escriba *deshacer* si quiere deshacerlo todo._');
}

/** Texto (o voz ya transcrita) con el nombre pedido por "🏷 Cambiar nombre". true si lo tomó. */
function WA_procesarNombre_(de, texto) {
  // "nombre Edit 15/10" mientras hay un resumen esperando ✅
  var mn = String(texto || '').match(/^\s*nombre\s*[:=]?\s+(.+)$/i);
  if (mn && WA_prop_('WA_PRK_' + de)) { WA_props_().setProperty('WA_PRN_' + de, WA_prop_('WA_PRK_' + de)); texto = mn[1]; }
  var k = WA_prop_('WA_PRN_' + de);
  if (!k || !WA_pareceNombre_(texto)) return false;
  WA_props_().deleteProperty('WA_PRN_' + de);
  var r;
  try { r = WA_cobranzas_('procesar', { modo: 'nombre', numero: de, k: k, texto: texto }); } catch (e) { r = { ok: false, error: e.message }; }
  if (r && r.error) { WA_props_().setProperty('WA_PRN_' + de, k); WA_enviarTexto_(de, '⚠️ ' + r.error); return true; }
  if (!r || !r.ok) { WA_mostrarPlan_(de, r); return true; }
  // No se repite todo el resumen: solo el nombre nuevo y los botones.
  WA_botonesPlan_(de, r, '🏷 Listo: se guardará como *' + r.etiqueta + '*. ¿Lo hago?');
  return true;
}

function WA_marcarRevisando_(de, estado, resultado) {
  var hoja = WA_hoja_(), datos = hoja.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][2]) === de && datos[i][6] === 'Revisando') hoja.getRange(i + 1, 7, 1, 2).setValues([[estado, resultado]]);
  }
}

/** WA_cadaMinuto: resultados del análisis que tardó más de 60 s y avisos de "ya quedó registrado". */
function WA_seguirProcesar_(props) {
  var activo = false;
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('WA_PRA_') === 0) {
      var de = k.slice(7), r = WA_cobranzas_('procesar', { modo: 'resultado', numero: de });
      if (r && r.pendiente && Date.now() - Number(props[k]) < 10 * 60000) { activo = true; return; }
      WA_props_().deleteProperty(k);
      WA_mostrarPlan_(de, r && r.pendiente ? { ok: false, error: 'La revisión no terminó a tiempo.' } : r);
    }
    if (k.indexOf('WA_PROC_') === 0) {
      var de2 = k.slice(8), m = WA_cobranzas_('procesar', { modo: 'mensajes', numero: de2 });
      (m && m.mensajes || []).forEach(function (t) { WA_trozos_(WA_md_(t)).forEach(function (x) { WA_enviarTexto_(de2, x); }); });
      if (m && m.ok && !m.pendiente) WA_props_().deleteProperty(k); else activo = true;
    }
  });
  if (!activo) WA_props_().setProperty('WA_HAY_PROC', '0');
}

/* ============================================================ ↩️ deshacer */

function WA_deshacerVer_(de) {
  var r;
  try { r = WA_cobranzas_('deshacer', { modo: 'ver', numero: de }); } catch (e) { r = { ok: false, error: e.message }; }
  if (!r || !r.ok) { WA_enviarTexto_(de, '⚠️ ' + ((r && r.error) || 'No pude consultar.')); return; }
  WA_enviarTexto_(de, WA_md_(r.texto));
  if (!r.hay) return;
  var s = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', to: de, type: 'interactive',
    interactive: { type: 'button', body: { text: '¿Lo deshago todo?' }, action: { buttons: [
      { type: 'reply', reply: { id: 'un:si:' + r.id, title: '↩️ Sí, deshacer' } },
      { type: 'reply', reply: { id: 'un:no', title: '✖ No' } }] } }
  });
  if (!s.ok) WA_enviarTexto_(de, '⚠️ No pude mostrar los botones: ' + s.error);
}

function WA_deshacerBoton_(de, id) {
  var p = String(id).split(':');
  if (p[1] !== 'si') { WA_enviarTexto_(de, 'Listo, no deshice nada.'); return; }
  var r;
  try { r = WA_cobranzas_('deshacer', { modo: 'hacer', numero: de, id: p[2] }); } catch (e) { r = { ok: false, error: e.message }; }
  if (!r || !r.ok) { WA_enviarTexto_(de, '⚠️ ' + ((r && r.error) || 'No pude deshacer.')); return; }
  // Recibidos: esas filas quedan como "Deshecho".
  var nombres = r.nombres || [];
  if (nombres.length) {
    var hoja = WA_hoja_(), datos = hoja.getDataRange().getValues();
    for (var i = 1; i < datos.length; i++) {
      if (String(datos[i][2]) === de && nombres.indexOf(String(datos[i][4])) >= 0) hoja.getRange(i + 1, 7, 1, 2).setValues([['Deshecho', '↩️ deshecho por WhatsApp']]);
    }
  }
  WA_enviarTexto_(de, WA_md_(r.texto));
}

/** Anota en Cobranzas lo que se mandó a Entrada (para poder deshacerlo). */
function WA_anotarAccion_(de, desc, archivos) {
  if (!archivos.length) return;
  try { WA_cobranzas_('deshacer', { modo: 'anotar', numero: de, desc: desc, archivos: archivos }); }
  catch (e) { console.warn('No se pudo anotar para deshacer: ' + e.message); }
}
