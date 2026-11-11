/**
 * 🌐 Portal de Vouchers — la API que llama la página (una sola función pública con sesión y permiso en cada acción)
 * y el cliente del PUENTE con la hoja de Vouchers (🔁 volver a leer con IA, ↩️ deshacer, ⚡ procesar ya).
 */

function PV_api(token, accion, d) {
  d = d || {};
  var s;
  switch (accion) {
    case 'yo': s = PV_sesion_(token); return { nombre: s.n || s.u, permiso: s.p, usuario: s.u, puente: !!PV_PUENTE_URL_ };
    case 'salir': try { CacheService.getScriptCache().remove('pv_s_' + String(token).slice(0, 80)); } catch (e) {} return true;

    case 'indice': PV_sesion_(token, 'ver'); return PV_indice_();
    case 'fila': s = PV_sesion_(token, 'ver'); return PV_fila_(d.hoja, d.fila, PV_nivel_(s.p) >= PV_nivel_('editar'));
    case 'imagen': PV_sesion_(token, 'ver'); return PV_imagen_(d.hoja, d.fila);
    case 'original': PV_sesion_(token, 'ver'); return PV_original_(d.hoja, d.fila, d.n);
    case 'pendientes': PV_sesion_(token, 'ver'); return PV_pendientes_();

    case 'repetidos': PV_sesion_(token, 'subir'); return PV_repetidos_(d.nombres);
    case 'subir': s = PV_sesion_(token, 'subir'); return PV_subir_(s, d);
    case 'procesar': {
      s = PV_sesion_(token, 'subir');
      var r = PV_puente_('procesar', {});
      PV_registrar_(s, '⚡ Pidió procesar ya', r.ok ? 'en ~1 minuto' : (r.error || ''));
      return r;
    }

    case 'guardar': s = PV_sesion_(token, 'editar'); return PV_guardar_(s, d.hoja, d.fila, d.clave, d.cambios);
    case 'releer': {
      s = PV_sesion_(token, 'editar');
      PV_hoja_(d.hoja);
      var r1 = PV_puente_('releer', { hoja: d.hoja, fila: Number(d.fila) });
      if (r1.ok) PV_registrar_(s, '🔁 Releer con IA (leyendo)', d.hoja + ' fila ' + d.fila);
      return r1;
    }
    case 'releerEstado': PV_sesion_(token, 'editar'); return PV_puente_('releerEstado', { id: String(d.id || '') });
    case 'releerAplicar': {
      s = PV_sesion_(token, 'editar');
      var r2 = PV_puente_('releerAplicar', { id: String(d.id || ''), i: Number(d.i) || 0 });
      if (r2.ok) PV_registrar_(s, '🔁 Releyó con IA y reemplazó', (r2.mensaje || '').slice(0, 300));
      return r2;
    }
    case 'deshacer': {
      s = PV_sesion_(token, 'editar');
      var r3 = PV_puente_('deshacer', {});
      if (r3.ok) PV_registrar_(s, '↩️ Deshizo la última relectura', r3.u ? r3.u.hoja + ' fila ' + r3.u.fila : 'no había');
      return r3;
    }

    case 'usuarios': PV_sesion_(token, 'admin'); return { usuarios: PV_listaUsuarios_(), permisos: PV_PERMISOS_, textos: PV_PERM_TXT_ };
    case 'guardarUsuario': s = PV_sesion_(token, 'admin'); return PV_guardarUsuario_(s, d);
    case 'registro': PV_sesion_(token, 'admin'); return PV_leerRegistro_(Number(d.n) || 300);
    case 'enlace': PV_sesion_(token, 'admin'); return PV_URL_ ? 'https://script.google.com/macros/s/' + PV_URL_ + '/exec' : '';
  }
  throw new Error('Acción desconocida.');
}

/* ============================================================ puente con la hoja de Vouchers */

/**
 * Clave del puente: la genera este proyecto y la deja en los metadatos de la hoja de Vouchers (no se ven en la hoja
 * ni van al repositorio). El puente de la hoja (PV_Puente.js) la lee de ahí para comprobar que el pedido viene del portal.
 */
function PV_clavePuente_() {
  var ss = PV_ss_(), m = ss.createDeveloperMetadataFinder().withKey('PV_PUENTE').find();
  if (m.length && String(m[0].getValue() || '').length >= 40) return m[0].getValue();
  var k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  m.forEach(function (x) { try { x.remove(); } catch (e) {} });
  ss.addDeveloperMetadata('PV_PUENTE', k, SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT);
  return k;
}

function PV_puente_(op, p) {
  if (!PV_PUENTE_URL_) return { ok: false, error: 'El puente con la hoja de Vouchers no está configurado (falta publicar la hoja con PV_Puente.js).' };
  var q = { portal: '1', k: PV_clavePuente_(), op: op };
  Object.keys(p || {}).forEach(function (k) { q[k] = p[k]; });
  var url = PV_PUENTE_URL_ + '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
  var r;
  try { r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }); }
  catch (e) { return { ok: false, error: 'La hoja de Vouchers no respondió: ' + e.message }; }
  var txt = r.getContentText();
  try { var j = JSON.parse(txt); if (j && j.ok === false && /No autorizado/i.test(j.error || '')) j.error = 'La hoja de Vouchers todavía no tiene el puente del portal (o su clave cambió).'; return j; }
  catch (e) { return { ok: false, error: 'Respuesta rara de la hoja de Vouchers (código ' + r.getResponseCode() + ').' }; }
}
