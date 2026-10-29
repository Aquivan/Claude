/**
 * 🚚 Guías desde la hoja "Guías de Remisión · Grupo" (guias/apps_script/GR_Emitir.js).  Prefijo TGGH_.
 *
 * La hoja manda una fila ya lista (?canal=gr) y aquí se convierte en un caso de guía, el MISMO que arma el bot por
 * Telegram/WhatsApp (TG_GRE.js): mismos robots (SUNAT o Quesito), misma huella para emitir y mismo registro en la
 * pestaña 🚚 Guías SUNAT. La foto de la vista previa va al Telegram del primer administrador (con su ✅ Emitir) y
 * queda en Drive para que la hoja muestre el enlace. La hoja se registra sola con una clave propia la primera vez.
 */

var TGGH_PROP_ = 'TGGH_CLAVE';

function TGGH_doPost_(e) {
  var p = (e && e.parameter) || {}, props = PropertiesService.getScriptProperties(), guardada = props.getProperty(TGGH_PROP_);
  if (p.accion === 'registrar') {
    if (!p.token || String(p.token).length < 24) return TGW_json_({ ok: false, error: 'clave inválida' });
    if (guardada && guardada !== p.token) return TGW_json_({ ok: false, error: 'ya hay otra clave registrada (borre TGGH_CLAVE en Cobranzas para cambiarla)' });
    props.setProperty(TGGH_PROP_, p.token);
    return TGW_json_({ ok: true });
  }
  if (!guardada || p.token !== guardada) return TGW_json_({ ok: false, error: 'Forbidden' });
  var q = {};
  try { q = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) {}
  var ss = TG_ss_();
  try {
    if (p.accion === 'caso') return TGW_json_(TGGH_caso_(ss, q));
    if (p.accion === 'pedir') {
      var c = TGG_leer_(ss, String(q.caso || ''));
      if (!c) return TGW_json_({ ok: false, error: 'caso desconocido' });
      if (q.modo === 'emitir' && c.estado === 'Emitida') return TGW_json_({ ok: false, error: 'ya está emitida (' + c.gre + ')' });
      var como = TGG_pedir_(ss, c, q.modo === 'emitir' ? 'emitir' : 'vista');
      return TGW_json_({ ok: true, como: como || '', vivo: c.vivo_url || '', donde: c.donde || '', pc_motivo: c.pc_motivo || '' });
    }
    if (p.accion === 'leer') {   // 📥 solo leer la factura (o cotización) en Quesito: cliente y productos para completar la fila
      var r = TGGH_caso_(ss, q);
      if (!r.caso) return TGW_json_(r);
      var cl = TGG_leer_(ss, r.caso), cfg = TG_cfg_(ss);
      cl.estado = 'Leyendo Quesito…'; cl.solo_leer = true; cl.leido = null; cl.ultimo_error = '';
      TGG_guardar_(ss, cl);
      var dn = TGPC_donde_(cfg, cl);   // 🖥 en la PC si lo activó y está encendida
      TG_gh_(cfg, '/actions/workflows/' + TGG_WF_QUESITO_ + '/dispatches', 'post', { ref: cfg.rama, inputs: { ruc: cl.empresa_ruc, caso: cl.id, modo: 'leer', confirmar: '', donde: dn } });
      return TGW_json_({ ok: true, caso: cl.id, vivo: TGEV_iniciar_(cl), donde: dn });
    }
    if (p.accion === 'pc') {   // 🖥 Quesito en la PC
      if (q.activar != null) TGPC_poner_(!!q.activar);
      return TGW_json_({ ok: true, activo: TGPC_activo_(), estado: TGPC_estado_(TG_cfg_(ss)) });
    }
    if (p.accion === 'vivo') return TGW_json_({ ok: true, activo: q.activar == null ? TGEV_activo_() : TGEV_poner_(!!q.activar) });   // 📺 en vivo
    if (p.accion === 'estado') {
      var out = {};
      (q.casos || []).slice(0, 50).forEach(function (id) {
        var x = TGG_leer_(ss, String(id));
        if (!x) return;
        var url = function (fid) { try { return fid ? DriveApp.getFileById(fid).getUrl() : ''; } catch (err) { return ''; } };
        out[x.id] = { estado: x.estado || '', gre: x.gre || '', via: x.via || '', error: x.ultimo_error || '', pdf: url(x.pdf), imagen: url(x.vista_img), leido: x.leido ? Object.assign({}, x.leido, { pdf: url(x.leido.pdf) }) : null };
      });
      return TGW_json_({ ok: true, casos: out });
    }
    return TGW_json_({ ok: false, error: 'accion desconocida' });
  } catch (err) {
    console.error('Guías desde la hoja: ' + (err && err.stack || err));
    return TGW_json_({ ok: false, error: String(err && err.message || err) });
  }
}

/** Crea (o actualiza, si aún no se emitió) el caso con los datos de la fila. {ok, caso, faltan} */
function TGGH_caso_(ss, q) {
  var d = q.datos || {}, empresas = TGG_empresas_(ss), ruc = String(d.empresa_ruc || '').replace(/\D/g, '');
  if (!empresas[ruc]) return { ok: false, error: 'la empresa ' + ruc + ' no está en ⚙️ Config de Cobranzas' };
  var c = q.caso ? TGG_leer_(ss, String(q.caso)) : null;
  if (c && /Emitida|Emitiendo/.test(c.estado || '')) return { ok: false, error: 'ese caso ya está ' + c.estado.toLowerCase() + (c.gre ? ' (' + c.gre + ')' : '') };
  if (!c) c = { id: Utilities.getUuid().replace(/-/g, '').slice(0, 8), creado: new Date().toISOString(), archivos: [], mensajes: [] };
  if (c.espera_run) c.decision = 'cerrar';   // una vista previa anterior que espera: se cierra sin emitir
  ['motivo', 'contraparte', 'documento', 'bienes', 'peso_kg', 'bultos', 'partida', 'llegada', 'transporte', 'fecha', 'observaciones', 'via', 'todo_factura', 'cotizacion', 'pedido', 'fecha_emision', 'fecha_entrega']
    .forEach(function (k) { c[k] = d[k]; });
  c.empresa_ruc = ruc; c.empresa = empresas[ruc];
  c.origen = 'hoja'; c.hoja = String(q.hoja || '');
  c.mensajes = ['(desde la hoja de Guías, ' + c.hoja + ')'];
  c.preguntas_ia = []; c.entendido = 'Desde la hoja de Guías (' + c.hoja + ')'; c.ultimo_error = ''; c.opciones = null;
  if (!c.chat) { var a = TG_admins_(ss)[0]; c.chat = a ? String(a.chatId) : ''; }   // la foto y el resultado también van al Telegram
  c.estado = 'Propuesta';
  var faltan = TGG_faltan_(c);
  TGG_guardar_(ss, c);
  return { ok: !faltan.length, caso: c.id, faltan: faltan, error: faltan.length ? 'faltan datos' : '' };
}
