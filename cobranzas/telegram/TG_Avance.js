/**
 * ⏳ AVANCE EN VIVO EN TELEGRAM Y WHATSAPP (pedido del usuario, 26/11/2026).
 *
 * Cuando alguien registra vouchers por Telegram (TG_registrarVouchers_) o WhatsApp (WA_finalizar_ → TGP_wa_ modo «seguir»),
 * aquí se anota quién sigue cada archivo. La hoja de Vouchers (Avance.js) manda su avance (canal=vch, accion «avance»):
 *   • Telegram: se EDITA un solo mensaje (cola → 🗜 reduciendo peso → 📖 leyendo pág x de N → ✅) y, cuando terminan
 *     todos sus archivos, ese mismo mensaje pasa a ser el 📋 Resultado, con ↩️ Deshacer, 💬 ¿A qué facturas? y 🔎 RUC.
 *   • WhatsApp no deja editar: solo avisos en los pasos importantes (reducir peso, la mitad de un PDF largo); el
 *     resultado lo sigue mandando el bot de WhatsApp como siempre.
 * Lo que se siguió así ya no se repite en el aviso de cada hora (TG_avisoVouchers_). Funciones AVT_.
 */

var AVT_TTL_ = 21600;   // 6 h (máximo de CacheService)

function AVT_clave_(nombre) {
  return String(nombre || '').replace(/\.(pdf|jpe?g|png|webp|gif|bmp|tiff?)$/i, '').replace(/\s*\(parte \d+ de \d+\)\s*$/i, '').trim().toLowerCase().slice(0, 200);
}

/** hechos = [{nombre, mb?, comprimir?}]; destino = {canal:'tg', chat, msg} | {canal:'wa', numero}. */
function AVT_seguir_(hechos, destino) {
  var c = CacheService.getScriptCache(), todo = {};
  var mk = destino.canal === 'tg' ? 'avtm_' + destino.chat + '_' + destino.msg : '';
  hechos.forEach(function (h) {
    var k = AVT_clave_(h.nombre);
    todo['avt_' + k] = JSON.stringify({ dest: destino, mk: mk, nombre: h.nombre, avisos: {} });
    todo['avt_rep_' + k] = '1';   // el aviso de cada hora no lo repite
  });
  if (mk) todo[mk] = JSON.stringify({ chat: destino.chat, msg: destino.msg, hechos: hechos, t0: Date.now() });
  c.putAll(todo, AVT_TTL_);
}

/** canal=vch accion «avance» (AsistenteVouchers.js): {nombre, estado}. */
function AVT_recibir_(q) {
  var c = CacheService.getScriptCache(), k = AVT_clave_(q.nombre), s = c.get('avt_' + k);
  if (!s) return { ok: true, seguido: false };
  var seg = JSON.parse(s), e = q.estado || {};
  c.put('avte_' + k, JSON.stringify(e), AVT_TTL_);
  try {
    if (seg.dest.canal === 'tg') AVT_mostrarTG_(seg.mk);
    else if (seg.dest.canal === 'wa') AVT_avisoWA_(c, k, seg, e);
  } catch (err) { console.warn('Avance: ' + err.message); }
  return { ok: true, seguido: true };
}

function AVT_linea_(e, nombre) {
  var n = '«' + TG_esc_(nombre) + '»';
  if (!e) return '🕐 ' + n + ': en cola';
  var pct = e.total ? Math.round(100 * (e.pag || 0) / e.total) : 0;
  var barra = e.total > 1 ? '\n      ' + '▓'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10)) + ' ' + pct + '%' : '';
  var cuenta = (e.nuevos ? ' · <b>' + e.nuevos + '</b> nuevo(s)' : '') + (e.repetidos ? ' · ' + e.repetidos + ' repetido(s)' : '');
  switch (e.etapa) {
    case 'cola': return '🕐 ' + n + ': en cola';
    case 'comprimir': return '🗜 ' + n + ': reduciendo peso' + (e.total ? ' · pág. ' + (e.pag || 0) + ' de ' + e.total + barra : (e.mb ? ' (' + e.mb + ' MB)…' : '…'));
    case 'comprimido': return '🗜 ' + n + ': ' + e.mb + ' → <b>' + e.mbFin + ' MB</b> ✓ · ahora se lee';
    case 'sinCambio': return '🗜 ' + n + ': no hizo falta reducir · ahora se lee';
    case 'reversos': return '✍️ ' + n + ': buscando reversos y anotaciones' + (e.total ? ' (' + e.total + ' pág.)' : '') + '…';
    case 'inicio': case 'leer': return '📖 ' + n + ': leyendo' + (e.total > 1 ? ' pág. ' + (e.pag || 0) + ' de ' + e.total : '…') + cuenta + barra;
    case 'pausa': return '⏸ ' + n + ': pág. ' + (e.pag || 0) + ' de ' + (e.total || '?') + cuenta + ' · sigue en ~1 min (límite de Google)' + barra;
    case 'fin': return '✅ ' + n + ': listo' + cuenta;
    case 'error': return '⚠️ ' + n + ': ' + TG_esc_(e.error || 'error');
    default: return '🕐 ' + n;
  }
}

/**
 * Pinta el mensaje de avance de Telegram. Si TODOS sus archivos terminaron (o fallaron), lo convierte en el 📋 Resultado.
 * extra = {tt} (tiempos de la hoja, cuando lo llama TG_registrarVouchers_).
 */
function AVT_mostrarTG_(mk, extra) {
  var c = CacheService.getScriptCache(), s = c.get(mk);
  if (!s) return false;
  var m = JSON.parse(s);
  if (extra && extra.tt) { m.tt = extra.tt; c.put(mk, JSON.stringify(m), AVT_TTL_); }
  var claves = m.hechos.map(function (h) { return 'avte_' + AVT_clave_(h.nombre); }), est = c.getAll(claves);
  var estados = claves.map(function (k) { try { return est[k] ? JSON.parse(est[k]) : null; } catch (x) { return null; } });
  var seg = Math.round((Date.now() - m.t0) / 1000), dur = seg >= 60 ? Math.floor(seg / 60) + ' min ' + (seg % 60) + ' s' : seg + ' s';
  var listos = estados.every(function (e) { return e && /^(fin|error)$/.test(e.etapa); });
  if (!listos) {
    return TG_editar_(m.chat, m.msg, '⏳ <b>Procesando</b> · ' + dur + '\n' + m.hechos.map(function (h, i) { return AVT_linea_(estados[i], h.nombre); }).join('\n') +
      '\n<i>Este mensaje se actualiza solo.</i>');
  }
  // ✅ todos terminaron: el mismo mensaje pasa a ser el 📋 Resultado
  var ss = TG_ss_(), r = TG_lineasResultado_(ss, m.hechos);
  var resumen = estados.map(function (e, i) { return e && e.etapa === 'error' ? '⚠️ «' + TG_esc_(m.hechos[i].nombre) + '»: ' + TG_esc_(e.error || 'error') : ''; }).filter(String);
  TG_editar_(m.chat, m.msg, '📋 <b>Resultado</b> · ' + dur + '\n' + r.lineas.join('\n') + (resumen.length ? '\n' + resumen.join('\n') : '') +
    (m.tt ? '\n<i>' + TG_esc_(m.tt) + '</i>' : ''), TG_botonesResultado_(r.filasRuc));
  return true;
}

/** WhatsApp: solo los pasos importantes (no se puede editar). El resultado final lo manda el bot de WhatsApp. */
function AVT_avisoWA_(c, k, seg, e) {
  var av = seg.avisos || {}, txt = '', n = '«' + seg.nombre + '»';
  if (e.etapa === 'comprimir' && !av.cmp) { av.cmp = 1; txt = '🗜 Reduciendo el peso de ' + n + (e.mb ? ' (' + e.mb + ' MB)' : '') + '…'; }
  else if (e.etapa === 'comprimido' && !av.cmpOk) { av.cmpOk = 1; txt = '🗜 ' + n + ': ' + e.mb + ' → *' + e.mbFin + ' MB*. Ahora lo leo.'; }
  else if ((e.etapa === 'leer' || e.etapa === 'pausa') && e.total >= 10 && (e.pag || 0) >= e.total / 2 && !av.mitad) {
    av.mitad = 1; txt = '📖 ' + n + ': voy en la página ' + e.pag + ' de ' + e.total + (e.nuevos ? ' · ' + e.nuevos + ' voucher(s) nuevo(s)' : '') + '. Le aviso al terminar.';
  } else if (e.etapa === 'inicio' && e.total >= 10 && !av.inicio) { av.inicio = 1; txt = '📖 Leyendo ' + n + ' (' + e.total + ' páginas): le aviso a la mitad y al terminar.'; }
  if (!txt) return;
  seg.avisos = av;
  c.put('avt_' + k, JSON.stringify(seg), AVT_TTL_);
  TGC_wa_({ tipo: 'texto', numero: String(seg.dest.numero), texto: txt });
}

/** Robot de archivos grandes de Telegram: edita el mensaje «📥 … lo baja un robot» (TG_Grandes.js). */
function AVT_bajandoTG_(L, mb, total) {
  if (!L || !L.aviso) return;
  var pct = total ? Math.round(100 * mb / total) : 0;
  TG_editar_(L.chat, L.aviso, '📥 <b>' + TG_esc_(L.nombre) + '</b> (' + L.mb + ' MB): bajándolo con el robot… ' + mb + ' de ' + (total || L.mb) + ' MB\n' +
    '▓'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10)) + ' ' + pct + '%');
}
