/**
 * 🏷 ¿De quién son estos vouchers? (WhatsApp)
 *
 * Los archivos de una tanda esperan en una carpeta aparte ("en espera", estado Espera en
 * Recibidos) hasta que usted dice de quién son. Después se renombran con el formato de siempre
 * ("18-10-26 Edit.jpg", "18-10-26 Edit 2.jpg"…), pasan a la carpeta de Entrada de Vouchers y se
 * procesan. Así la hoja de Vouchers nunca los toma con el nombre provisional.
 *   - Lista con los nombres más usados y uno ⭐ sugerido por la IA (quién paga en el voucher).
 *   - Se puede escribir o decir 🎤 "Edit", "Edit 15/10", "son de Edit de ayer".
 *   - "de Edit" escrito ANTES de reenviar: la tanda siguiente toma ese nombre sin preguntar.
 *   - Si nadie contesta en 20 min, se procesan con el nombre de antes.
 * Los nombres, la sugerencia y la numeración sin repetir los da Cobranzas (TG_Entregas.js),
 * igual que en Telegram. "preguntar nombre no" lo apaga.
 */

var WA_ESPERA_NOMBRE_MS_ = 20 * 60 * 1000;
var WA_ETIQUETA_MS_ = 20 * 60 * 1000;
var WA_PREGUNTA_RX_ = /\?|¿|\b(cu[aá]nto|cu[aá]ntos|qu[eé]|cu[aá]l|cu[aá]les|d[oó]nde|c[oó]mo|cu[aá]ndo|qui[eé]n|por\s?qu[eé]|mand[ae]|env[ií]a|busca|dame|mu[eé]strame|hay)\b/i;

function WA_preguntarNombre_() { return WA_prop_('WA_PREGUNTAR_NOMBRE') !== '0'; }

function WA_carpetaEspera_() {
  var p = WA_props_(), id = p.getProperty('WA_ESPERA_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var padre = null;
  try { padre = DriveApp.getFileById(WA_HOJA_ID_ || WA_prop_('WA_HOJA_ID')).getParents().next(); } catch (e) {}
  var f = (padre || DriveApp.getRootFolder()).createFolder('Vouchers WhatsApp · en espera de nombre');
  p.setProperty('WA_ESPERA_ID', f.getId());
  return f;
}

function WA_leerJson_(k) { try { return JSON.parse(WA_prop_(k) || 'null'); } catch (e) { return null; } }

/** ¿Este texto contesta "¿de quién son?"? Corto y sin cara de pregunta. */
function WA_pareceNombre_(t) {
  t = String(t || '').trim();
  return !!t && t.split(/\s+/).length <= 8 && !WA_PREGUNTA_RX_.test(t) && !/^\//.test(t);
}

/** "de Edit", "son de Edit 15/10" escrito antes de reenviar. */
function WA_esEtiqueta_(t) {
  return /^\s*(son\s+|es\s+|estos\s+son\s+)?(de|del)\s+\S/i.test(t) && t.trim().split(/\s+/).length <= 6 && WA_pareceNombre_(t);
}

function WA_entrega_(cuerpo) {
  return WA_iaLlamar_({ token: WA_iaClave_(), accion: 'entrega' }, cuerpo);
}

/** WA_cadaMinuto: la tanda de "de" terminó de llegar y está en Espera. */
function WA_tandaEnEspera_(hoja, datos, de) {
  var filas = WA_filasEspera_(datos, de);
  if (!filas.length) return false;
  var etq = WA_leerJson_('WA_ETQ_' + de);
  if (etq && Date.now() - etq.t < WA_ETIQUETA_MS_) {
    WA_props_().deleteProperty('WA_ETQ_' + de);
    WA_finalizar_(de, { nombre: etq.nombre, fecha: etq.fecha });
    return true;
  }
  if (WA_leerJson_('WA_PREG_' + de)) return true;   // ya se preguntó: lo nuevo se suma a la misma tanda
  WA_preguntarDeQuien_(de, datos, filas);
  return true;
}

function WA_filasEspera_(datos, de) {
  var out = [];
  for (var i = 1; i < datos.length; i++) if (String(datos[i][2]) === de && datos[i][6] === 'Espera') out.push(i);
  return out;
}

function WA_preguntarDeQuien_(de, datos, filas) {
  var r = null;
  try {
    var f = DriveApp.getFileById(datos[filas[0]][9]);
    var adj = f.getSize() < 4 * 1024 * 1024 ? { base64: Utilities.base64Encode(f.getBlob().getBytes()), mime: f.getMimeType() } : null;
    r = WA_entrega_({ modo: 'sugerir', adjunto: adj });
  } catch (e) { console.warn('Sugerir nombre: ' + e.message); }
  if (!r || !r.ok) {   // sin Cobranzas no hay numeración segura: se sigue como antes
    WA_finalizar_(de, null);
    return;
  }
  var sug = r.sugerido;
  var nombres = (sug ? [sug.nombre] : []).concat((r.nombres || []).filter(function (n) { return !sug || n.toLowerCase() !== sug.nombre.toLowerCase(); }))
    .filter(String).slice(0, 5);
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
  var preg = { t: Date.now(), nombres: nombres, sug: !!sug, ordenante: sug ? sug.ordenante : '', fecha: hoy };
  WA_props_().setProperty('WA_PREG_' + de, JSON.stringify(preg));
  WA_listaNombre_(de, preg, filas.length, WA_pestanaEspera_(datos, filas));
}

/** 📂 Pestaña de la tanda en espera (columna D): 'foto', 'original' o '' (mezcla: cada uno según su tipo). */
function WA_pestanaEspera_(datos, filas) {
  var t = filas.map(function (i) { return datos[i][3] === 'original' ? 'original' : 'foto'; });
  return t.every(function (x) { return x === t[0]; }) ? (t[0] || 'foto') : '';
}

/** La lista "¿De quién son?" (también se vuelve a mandar al cambiar de pestaña, sin leer de nuevo con IA). */
function WA_listaNombre_(de, preg, n, pestana) {
  var nombres = preg.nombres, sug = preg.sug;
  var corta = Utilities.formatDate(new Date(), 'America/Lima', 'dd-MM-yy');
  var cuerpo = '🏷 *¿De quién son ' + (n > 1 ? 'estos ' + n + ' vouchers' : 'este voucher') + '?*\n' +
    'Quedarán como _' + corta + ' Nombre_' + (n > 1 ? ', _… Nombre 2_…' : '') + '\n' +
    (sug ? '⭐ Según el voucher paga: _' + preg.ordenante + '_\n' : '') +
    '📂 Pestaña: *' + (pestana === 'original' ? 'Originales' : pestana === 'foto' ? 'Fotos' : 'Fotos y Originales (según el archivo)') + '* (puede cambiarla en la lista)\n' +
    '\nElija de la lista o escríbame el nombre (o dígalo 🎤). Si es de otro día: *Edit 15/10* o *Edit ayer*.';
  var filasLista = nombres.map(function (nm, i) {
    var fila = { id: 'en:n' + i, title: ((i === 0 && sug ? '⭐ ' : '') + nm).slice(0, 24) };
    if (i === 0 && sug) fila.description = ('Según el voucher: ' + preg.ordenante).slice(0, 72);
    return fila;
  }).concat([
    { id: 'en:otro', title: '✍️ Otro nombre', description: 'Escríbalo o dígalo en una nota de voz' },
    { id: 'en:fecha', title: '📅 Es de otra fecha', description: 'Ej.: Edit 15/10 o Edit ayer' },
    !pestana ? { id: 'en:pfo', title: '📸 Todo como foto', description: 'Ahora cada uno va según su tipo: mandar todo a Fotos' }
      : pestana === 'original' ? { id: 'en:pfo', title: '📸 Enviar como foto', description: 'Ahora va a Originales: cambiar a la pestaña Fotos' }
      : { id: 'en:por', title: '📄 Enviar como original', description: 'Ahora va a Fotos: cambiar a la pestaña Originales' },
    { id: 'en:sin', title: '➖ Sin nombre', description: 'Como antes (nombre del archivo o la fecha)' },
    { id: 'en:ia', title: '🧾 Revisar con IA', description: 'Ve si ya está, registra solo el voucher y completa la factura' }
  ]);
  var s = WA_graph_('POST', WA_prop_('WA_PHONE_ID') + '/messages', {
    messaging_product: 'whatsapp', to: de, type: 'interactive',
    interactive: { type: 'list', body: { text: cuerpo.slice(0, 1024) },
      action: { button: 'Elegir nombre', sections: [{ title: 'Entregado por', rows: filasLista }] } }
  });
  if (!s.ok) WA_enviarTexto_(de, cuerpo + (nombres.length ? '\n\nUsados antes: ' + nombres.join(', ') : '') + '\n\nO escriba *sin nombre*, *original* o *foto*.');
}

/** 📸/📄 Cambia la pestaña de la tanda en espera y vuelve a mostrar la lista. */
function WA_cambiarPestanaEspera_(de, preg, pestana) {
  var hoja = WA_hoja_(), datos = hoja.getDataRange().getValues(), filas = WA_filasEspera_(datos, de);
  if (!filas.length) { WA_enviarTexto_(de, 'Esos vouchers ya se registraron 👍'); return; }
  filas.forEach(function (i) { hoja.getRange(i + 1, 4).setValue(pestana); });
  WA_listaNombre_(de, preg, filas.length, pestana);
}

/** Opción tocada en la lista (id "en:n0", "en:otro", "en:fecha", "en:sin"). */
function WA_botonNombre_(de, id) {
  var preg = WA_leerJson_('WA_PREG_' + de);
  if (!preg) { WA_enviarTexto_(de, 'Esos vouchers ya se registraron 👍'); return; }
  var op = String(id).slice(3);
  if (op === 'otro') { WA_enviarTexto_(de, '✍️ Escríbame el nombre (o dígalo 🎤).'); return; }
  if (op === 'fecha') { WA_enviarTexto_(de, '📅 Escríbame el nombre y la fecha, por ejemplo *Edit 15/10* o *Edit 15/10/26*.'); return; }
  if (op === 'sin') { WA_finalizar_(de, null); return; }
  if (op === 'pfo' || op === 'por') { WA_cambiarPestanaEspera_(de, preg, op === 'pfo' ? 'foto' : 'original'); return; }
  if (op === 'ia') { WA_revisarConIA_(de); return; }   // 🧾 Procesar documento (WA_Procesar.js)
  var nombre = preg.nombres[Number(op.slice(1))];
  if (nombre) WA_finalizar_(de, { nombre: nombre, fecha: preg.fecha, ordenante: preg.sug && op === 'n0' ? preg.ordenante : '' });
}

/**
 * Texto o 🎤 audio que llega mientras se espera el nombre. Devuelve true si lo tomó como nombre.
 * Con audio, si lo dicho no era un nombre devuelve el texto en .dicho para pasarlo a la IA.
 */
function WA_respuestaNombre_(de, texto, audio) {
  var preg = WA_leerJson_('WA_PREG_' + de);
  if (!preg) return { tomado: false };
  if (!audio && /^sin\s+nombre\b/i.test(texto)) { WA_finalizar_(de, null); return { tomado: true }; }
  var mp = !audio && String(texto).trim().match(/^(?:enviar\s+)?(?:a\s+|como\s+)?(originale?s?|fotos?)$/i);   // "original" / "foto"
  if (mp) { WA_cambiarPestanaEspera_(de, preg, /^o/i.test(mp[1]) ? 'original' : 'foto'); return { tomado: true }; }
  if (!audio && !WA_pareceNombre_(texto)) return { tomado: false };
  var r = WA_entrega_(audio ? { modo: 'nombres', audio: audio, fecha: preg.fecha } : { modo: 'nombres', texto: texto, fecha: preg.fecha });
  if (!r || !r.ok) { WA_enviarTexto_(de, '⚠️ ' + ((r && r.error) || 'No pude anotar el nombre.') + ' Escríbalo de nuevo o elija de la lista.'); return { tomado: true }; }
  if (r.error) { WA_enviarTexto_(de, '⚠️ ' + r.error + ' Escríbalo así: *Edit 15/10*.'); return { tomado: true }; }
  if (!r.entendido) return { tomado: false, dicho: r.dicho || '' };
  WA_finalizar_(de, { nombre: r.nombre, fecha: r.fecha, dicho: r.dicho });
  return { tomado: true };
}

/** "de Edit 15/10" antes de reenviar: se guarda para la próxima tanda (o se aplica a la que espera). */
function WA_etiquetaPrevia_(de, texto) {
  var r = WA_entrega_({ modo: 'nombres', texto: texto });
  if (!r || !r.ok || !r.entendido) return false;
  if (WA_leerJson_('WA_PREG_' + de)) { WA_finalizar_(de, { nombre: r.nombre, fecha: r.fecha }); return true; }
  WA_props_().setProperty('WA_ETQ_' + de, JSON.stringify({ nombre: r.nombre, fecha: r.fecha, t: Date.now() }));
  WA_enviarTexto_(de, '🏷 Listo: lo que me reenvíe ahora queda como *' + r.corta + ' ' + r.nombre + '*.');
  return true;
}

/**
 * Cierra la tanda en Espera: renombra (si hay nombre), pasa a Entrada y avisa.
 * it = {nombre, fecha:'yyyy-MM-dd', ordenante?, dicho?} o null (sin nombre: queda el de antes).
 */
function WA_finalizar_(de, it) {
  var hoja = WA_hoja_(), datos = hoja.getDataRange().getValues();
  var filas = WA_filasEspera_(datos, de);
  WA_props_().deleteProperty('WA_PREG_' + de);
  if (!filas.length) return;
  // Un PDF de varias páginas (orden de compra + voucher + factura…) no va entero a la hoja de Vouchers:
  // se revisa con IA para registrar solo la página del voucher (con el nombre que ya dio).
  if (filas.some(function (i) { return /\.pdf$/i.test(String(datos[i][4])) && WA_paginasPdf_(datos[i][9]) > 1; })) {
    WA_enviarTexto_(de, '📄 El PDF tiene varias páginas: lo reviso con IA para registrar *solo el voucher* y completar la factura.');
    WA_revisarConIA_(de, it && it.nombre ? it : null);
    return;
  }
  var nombres = null;
  if (it && it.nombre) {
    var aRenombrar = filas.filter(function (i) { return datos[i][7] !== 'nombre propio'; });
    var exts = aRenombrar.map(function (i) { var m = String(datos[i][4]).match(/\.[a-z0-9]{2,5}$/i); return m ? m[0] : '.jpg'; });
    var r = exts.length ? WA_entrega_({ modo: 'nombres', nombre: it.nombre, fecha: it.fecha, exts: exts, ordenante: it.ordenante || '' }) : { ok: true, nombres: [] };
    if (r && r.ok) { nombres = {}; aRenombrar.forEach(function (i, j) { nombres[i] = r.nombres[j]; }); }
    else WA_enviarTexto_(de, '⚠️ No pude ponerles el nombre (' + ((r && r.error) || 'sin respuesta') + '): van con el nombre de antes.');
  }
  filas.forEach(function (i) {
    var r0 = datos[i], nuevo = nombres && nombres[i] ? nombres[i] : r0[4], estado = 'En cola', res = '';
    try {
      var f = DriveApp.getFileById(r0[9]);
      if (nuevo !== r0[4]) f.setName(nuevo);
      f.moveTo(DriveApp.getFolderById(WA_VOUCHERS_.entrada[r0[3]]));
    } catch (e) { estado = 'Error'; res = 'No pude pasarlo a Entrada: ' + String(e.message).slice(0, 150); }
    datos[i][4] = nuevo; datos[i][6] = estado; datos[i][7] = res;
    hoja.getRange(i + 1, 5).setValue(nuevo);
    hoja.getRange(i + 1, 7, 1, 2).setValues([[estado, res]]);
  });
  if (it && it.nombre && nombres) {
    var corta = it.fecha.split('-'); corta = corta[2] + '-' + corta[1] + '-' + corta[0].slice(2);
    WA_enviarTexto_(de, (it.dicho ? '🎤 _' + it.dicho + '_\n' : '') + '🏷 *' + corta + ' ' + it.nombre + '* · ' + filas.length + ' archivo(s).');
  }
  if (WA_acuse_(hoja, datos, de)) WA_procesarAhora_();   // ⚡ procesa y avisa el resultado YA
}

/** WA_cadaMinuto: preguntas sin contestar → se procesan con el nombre de antes. */
function WA_vencidosNombre_(props) {
  Object.keys(props).filter(function (k) { return k.indexOf('WA_PREG_') === 0; }).forEach(function (k) {
    var x = null;
    try { x = JSON.parse(props[k]); } catch (e) {}
    if (x && Date.now() - x.t < WA_ESPERA_NOMBRE_MS_) return;
    var de = k.slice('WA_PREG_'.length);
    WA_enviarTexto_(de, '⌛ No me dijo de quién eran: los registro con el nombre de antes.');
    WA_finalizar_(de, null);
  });
}

/** Páginas de un PDF de Drive (sin abrirlo con una librería). 0 si no se sabe. */
function WA_paginasPdf_(id) {
  try {
    var t = DriveApp.getFileById(id).getBlob().getDataAsString('ISO-8859-1');
    var n = (t.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    (t.match(/\/Count\s+(\d+)/g) || []).forEach(function (x) { n = Math.max(n, Number(x.replace(/\D/g, ''))); });
    return n;
  } catch (e) { return 0; }
}
