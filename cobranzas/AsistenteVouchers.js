/**
 * AsistenteVouchers.js — el 🧠 Asistente IA abierto desde la hoja de Vouchers (vouchers_ia/AsistenteIA.js).
 *
 * La hoja de Vouchers no tiene el código de Cobranzas: su 💬 Chat, su 📰 Resumen y su 📋 Analizar vouchers
 * procesados le piden a Cobranzas por su aplicación web (?canal=vch), con una clave propia que la hoja de
 * Vouchers registra sola la primera vez (como la app de WhatsApp). Así ambas hojas usan exactamente las mismas
 * funciones y lo que se mejora aquí sirve allá sin copiar nada. Funciones VCH_.
 */

var VCH_PROP_ = 'VCH_CLAVE';
var CIA_RESUMEN_TXT_ = 'Dame un resumen ejecutivo de cuentas por cobrar y por pagar del grupo: qué empresa tiene más por cobrar ' +
  'y por pagar, qué clientes están más atrasados, a qué proveedores debemos más (y qué vence esta semana), vouchers sin cruzar, retenciones y detracciones ' +
  'pendientes, y los riesgos que debo atender esta semana. Con cifras exactas.';

function VCH_doPost_(e) {
  var p = (e && e.parameter) || {}, props = PropertiesService.getScriptProperties(), guardada = props.getProperty(VCH_PROP_);
  if (p.accion === 'registrar') {
    if (!p.token || String(p.token).length < 24) return TGW_json_({ ok: false, error: 'clave inválida' });
    if (guardada && guardada !== p.token) return TGW_json_({ ok: false, error: 'ya hay otra clave registrada (borre VCH_CLAVE en Cobranzas para cambiarla)' });
    props.setProperty(VCH_PROP_, p.token);
    return TGW_json_({ ok: true });
  }
  if (!guardada || p.token !== guardada) return TGW_json_({ ok: false, error: 'Forbidden' });
  var q = {};
  try { q = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) {}
  var ss = TG_ss_();
  try {
    switch (p.accion) {
      case 'chat':   // 💬 lo mismo que CHAT_enviar, sobre la hoja de Cobranzas
        var op = {};
        try { op = { extraHerr: CHAT_herrExtra_(), extraSistema: CHAT_sistemaExtra_(), origen: '🧾 hoja de Vouchers' }; } catch (err) {}
        var r = CHAT_enviarEn_(ss, q.msg || {}, op);
        delete r.c; delete r.final;
        return TGW_json_(r);
      case 'aplicar': return TGW_json_(ANX_aplicarDet_(ss, q.ids || [], !!q.reemplazar));
      case 'deshacer': return TGW_json_({ mensaje: ANX_deshacer_(ss) });
      case 'resumen': return TGW_json_({ pedido: CIA_RESUMEN_TXT_ });
      case 'procesados':   // 📋 el mismo pedido que arma la hoja de Cobranzas
        var t = TGQ_buscar_(ss, String(q.texto || '').trim() || 'hoy');
        if (!t.tandas.length) return TGW_json_({ error: TGQ_texto_(t, false).replace(/\*/g, '') });
        return TGW_json_({ pedido: TGQ_promptAnalisis_(t.tandas.map(function (x) { return x.nombre; }), TGQ_filasIA_(t.tandas)) });
      case 'hoja':   // enlace a la hoja de Cobranzas (y a una pestaña) para lo que se trabaja allá
        var sh = q.pestana ? ss.getSheetByName(q.pestana) : null;
        return TGW_json_({ url: ss.getUrl() + (sh ? '#gid=' + sh.getSheetId() : '') });
    }
    return TGW_json_({ ok: false, error: 'accion desconocida' });
  } catch (err) {
    console.error('Asistente desde Vouchers: ' + (err && err.stack || err));
    return TGW_json_({ error: '❌ ' + (err && err.message || err) });
  }
}
