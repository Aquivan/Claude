/**
 * ✖ /cancelar (también /detener, /parar) — pedido del usuario, 26/11/2026.
 *
 * Cancela TODO lo pendiente de esa persona (Telegram o WhatsApp):
 *   • la tarjeta «🏷 ¿De quién son?» (no se registra; ni la vigía de 20 min);
 *   • el resumen de 🧾 Procesar documento que espera ✅;
 *   • el robot que baja un archivo grande de Telegram (se detiene la corrida de GitHub);
 *   • los archivos que mandó y SIGUEN en la carpeta de Entrada de Vouchers (por leer, o leyéndose por partes, o
 *     esperando al robot que reduce el peso): van a la papelera de Drive (se recuperan 30 días) y no se leen más.
 * Lo que ya quedó registrado en la hoja NO se borra aquí: se deshace con ↩️ Deshacer. Funciones TGK_.
 */

/** clave = chatId de Telegram o 'wa<número>'. Devuelve las líneas de lo que se canceló. */
function TGK_cancelar_(ss, clave) {
  var hecho = [], p = PropertiesService.getScriptProperties(), todo = p.getProperties(), cfg = TG_cfg_(ss), esWA = String(clave).indexOf('wa') === 0;
  // 1) tarjetas «¿De quién son?» sin contestar
  Object.keys(todo).forEach(function (k) {
    if (k.indexOf(TGE_PROP_PEND_) !== 0) return;
    var x = {}; try { x = JSON.parse(todo[k]); } catch (e) {}
    if (String(x.chatId) !== String(clave)) return;
    p.deleteProperty(k);
    if (x.msg && !esWA) { try { TG_tarjeta_({ chatId: clave, msgId: x.msg, esBoton: true }, '✖ <b>Cancelado</b>: ese archivo no se registra.', []); } catch (e) {} }
    hecho.push('🏷 la pregunta «¿De quién son?» (no se registra)');
  });
  if (!esWA) {
    var ses = TG_sesion_(clave);
    if (ses.procPend) { try { TGP_cancelar_(ss, ses.procPend); } catch (e) {} delete ses.procPend; hecho.push('🧾 el resumen de Procesar documento'); }
    if (ses.esperando) { ses.esperando = null; }
    TG_guardarSesion_(clave, ses);
  }
  // 2) robot bajando un archivo grande de Telegram
  Object.keys(todo).forEach(function (k) {
    if (k.indexOf(TGB_PROP_) !== 0) return;
    var L = {}; try { L = JSON.parse(todo[k]); } catch (e) {}
    if (String(L.chat) !== String(clave)) return;
    p.deleteProperty(k);
    var lote = k.slice(TGB_PROP_.length);
    try {
      TG_ghRuns_(cfg, 10, TGB_WF_).filter(function (r) { return r.status !== 'completed' && String(r.display_title || '').indexOf(lote) >= 0; })
        .forEach(function (r) { TG_gh_(cfg, '/actions/runs/' + r.id + '/cancel', 'post'); });
    } catch (e) { console.warn('Cancelar robot: ' + e.message); }
    if (L.aviso) { try { TG_editar_(L.chat, L.aviso, '📥 <b>' + TG_esc_(L.nombre) + '</b>: ✖ cancelado.'); } catch (e) {} }
    hecho.push('📥 la descarga de «' + L.nombre + '»');
  });
  // 3) archivos suyos que siguen en Entrada (por nombre: también las partes que dejó el robot de reducir peso)
  var entradas = [cfg.carpetaOriginales, cfg.carpetaFotos].filter(Boolean), nombres = {};
  TGU_pila_(clave).filter(function (a) { return Date.now() - (a.t || 0) < 24 * 3600000; }).forEach(function (a) {
    (a.archivos || []).forEach(function (f) { if (f.nombre) nombres[String(f.nombre).replace(/\.[a-z0-9]{2,5}$/i, '')] = 1; });
  });
  entradas.forEach(function (id) {
    var it; try { it = DriveApp.getFolderById(id).getFiles(); } catch (e) { return; }
    while (it.hasNext()) {
      var f = it.next(), base = f.getName().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\s*\(parte \d+ de \d+\)\s*$/i, '');
      if (!nombres[base]) continue;
      try { f.setTrashed(true); hecho.push('📄 «' + f.getName() + '» (salió de la cola; está en la papelera de Drive)'); } catch (e) {}
    }
  });
  try { REG_anotar_(esWA ? 'WhatsApp' : 'Telegram', 'cancelar', '', hecho.length + ' cosa(s)'); } catch (e) {}
  return hecho;
}

/** Texto para la persona (HTML de Telegram; WhatsApp lo convierte). */
function TGK_texto_(hecho) {
  if (!hecho.length) return '✖ No había nada pendiente que cancelar.\n<i>Lo que ya está en la hoja se quita con ↩️ Deshacer.</i>';
  return '✖ <b>Cancelado</b>:\n• ' + hecho.map(TG_esc_).join('\n• ') +
    '\n<i>Si una parte ya alcanzó a registrarse en la hoja, quítela con ↩️ Deshacer (o en la hoja: ✨ Vouchers → 🗑 Deshacer una tanda).</i>';
}
