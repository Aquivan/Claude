/**
 * 🩺 AVISOS DE FALLAS DEL SISTEMA por Telegram (aviso «🩺 Fallas del sistema» en 🔔 Mis avisos: se prende y se apaga
 * ahí, o con el botón 🔕 del mismo aviso; viene prendido para los administradores).
 *
 * Cada hora (TG_vigia) lee lo nuevo del 🩺 Registro técnico central (Cobranzas, SIRE, Declaraciones, Vouchers y
 * WhatsApp escriben ahí) y avisa SOLO lo que necesita atención:
 *   ❌ un proceso terminó con ERROR
 *   ✂️ un proceso empezó y no terminó (Google lo cortó a los 6 min)
 *   🧾 vouchers con error o que ninguna IA pudo leer
 *   📲 «procesar al instante» de WhatsApp no funcionó
 *   🧹 disparadores acumulados en algún proyecto (Google permite 20)
 * No avisa lo normal: Gemini saturado cuando el respaldo sí leyó, procesos lentos que terminaron bien.
 * De noche (23:00-6:00) no avisa: lo de la noche llega a la mañana siguiente.
 */

var TGF_CODIGO_ = 'fallas';

function TGF_aviso_(c, V, cfg) {
  var props = PropertiesService.getScriptProperties();
  var ahora = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm:ss');
  var ult = props.getProperty('TGF_ULT');
  if (!ult) { props.setProperty('TGF_ULT', ahora); return []; }   // primera vez: desde ahora (no lo antiguo)
  var filas = TGF_filas_(400);
  var hace = function (min) { return Utilities.formatDate(new Date(Date.now() - min * 60000), 'America/Lima', 'yyyy-MM-dd HH:mm:ss'); };
  var avisados = []; try { avisados = JSON.parse(props.getProperty('TGF_AVISADOS') || '[]'); } catch (e) {}
  var L = [];
  var clave = function (r) { return r.f + '|' + r.s + '|' + r.e; };

  filas.forEach(function (r) {
    if (r.f <= ult) return;
    var d = r.d;
    if (/·\s*ERROR$|^ERROR$/.test(r.e)) L.push('❌ <b>' + TG_esc_(r.s) + '</b> · ' + TG_esc_(r.e.replace(/\s*·\s*ERROR$/, '')) + ' falló (' + r.f.slice(11, 16) + '): <i>' + TG_esc_(TGF_primeraLinea_(d)) + '</i>');
    else if (r.s === 'Vouchers' && /^fin/.test(r.e)) {
      var m = d.match(/errores (\d+)/), err = m ? Number(m[1]) : 0;
      if (err > 0) L.push('🧾 <b>Vouchers</b> · ' + err + ' archivo(s) con error (' + r.f.slice(11, 16) + '). Revise la hoja de Vouchers.');
      if (/ninguno pudo/i.test(d)) L.push('🧾 <b>Vouchers</b> · ninguna IA pudo leer un voucher (' + r.f.slice(11, 16) + '): Gemini, NVIDIA y Groq fallaron.');
    } else if (r.s === 'WhatsApp' && /procesar al instante/.test(r.e) && (/"ok"\s*:\s*false/.test(d) || /❌/.test(d)))
      L.push('📲 <b>WhatsApp</b> · «procesar al instante» no funcionó (' + r.f.slice(11, 16) + '): <i>' + TG_esc_(TGF_primeraLinea_(d)) + '</i>');
    else if (r.e === 'disparadores' && /^⚠️/.test(d))
      L.push('🧹 <b>' + TG_esc_(r.s) + '</b> · disparadores acumulados: ' + TG_esc_(TGF_primeraLinea_(d).replace(/^⚠️\s*/, '')));
  });

  // ✂️ empezó y no terminó: «inicio» de hace 10 min o más (desde 15 min antes de la vuelta anterior) sin su fin / ERROR después
  var desde = Utilities.formatDate(new Date(TGF_fecha_(ult).getTime() - 15 * 60000), 'America/Lima', 'yyyy-MM-dd HH:mm:ss'), hasta = hace(10);
  filas.forEach(function (r) {
    if (r.f <= desde || r.f > hasta || !/(^|·\s*)inicio$/.test(r.e) || avisados.indexOf(clave(r)) >= 0) return;
    var base = r.e.replace(/\s*·?\s*inicio$/, '');
    var cerro = filas.some(function (x) {
      return x.s === r.s && x.f >= r.f && x !== r && (base ? x.e.indexOf(base + ' · ') === 0 && !/inicio$/.test(x.e) : /^fin/.test(x.e));
    });
    if (cerro) return;
    avisados.push(clave(r));
    L.push('✂️ <b>' + TG_esc_(r.s) + '</b> · ' + TG_esc_(base || 'procesamiento') + ' empezó a las ' + r.f.slice(11, 16) + ' y no terminó: Google lo cortó (límite de 6 min). Lo pendiente sigue en la próxima vuelta; si se repite, avíseme.');
  });

  props.setProperty('TGF_ULT', filas.length && filas[0].f > ahora ? filas[0].f : ahora);
  props.setProperty('TGF_AVISADOS', JSON.stringify(avisados.slice(-60)));
  if (!L.length) return [];
  var extra = L.length > 10 ? '\n<i>… y ' + (L.length - 10) + ' más (vea el 🩺 Registro técnico).</i>' : '';
  return [{ html: '🩺 <b>Fallas del sistema</b>\n\n' + L.slice(0, 10).join('\n') + extra +
    '\n\n<i>Para dejar de recibir estos avisos: 🔕 abajo, o 🔔 Mis avisos → 🩺 Fallas del sistema.</i>',
    teclado: [[{ text: '🔕 No avisarme fallas', callback_data: 'av:' + TGF_CODIGO_ }]] }];
}

/** Las últimas n filas del registro central, lo más nuevo primero: [{f, s, e, d}]. */
function TGF_filas_(n) {
  var sh = REG_hoja_(), k = Math.min(n, Math.max(0, sh.getLastRow() - 1));
  if (!k) return [];
  return sh.getRange(2, 1, k, 5).getDisplayValues().map(function (r) {
    var f = String(r[0]).replace(/^'/, '').trim();
    var m = f.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);   // filas antiguas que quedaron como fecha sola
    if (m) f = m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) + ' 00:00:00';
    return { f: f, s: String(r[1]), e: String(r[2]).trim(), d: String(r[4] || '') };
  }).filter(function (r) { return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.f); });
}

function TGF_fecha_(txt) {
  var m = String(txt).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  return m ? new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '-05:00') : new Date();
}

function TGF_primeraLinea_(d) { return String(d || '').split('\n')[0].slice(0, 160); }

/** Una sola vez: el aviso de fallas viene prendido para los administradores (cada uno lo puede apagar). */
function TGF_prenderAdmins_(ss, us) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('TGF_INI')) return;
  us.forEach(function (u) { if (u.rol === 'admin' && u.avisos.indexOf(TGF_CODIGO_) < 0) { u.avisos.push(TGF_CODIGO_); TG_guardarAvisos_(ss, u, u.avisos); } });
  props.setProperty('TGF_INI', '1');
}
