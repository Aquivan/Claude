/**
 * 📑 Declaraciones — 📅 descarga ANTES del aviso de vencimientos (DEC_Previo.js).
 *
 * Los avisos de vencimientos SUNAT están en la hoja de Cobranzas (bot de Telegram). Los días en que toca avisar, unas
 * 2 horas antes, Cobranzas pide aquí bajar SOLO el periodo que vence y SOLO de las empresas que aún no tienen esa
 * declaración. Así, a la hora del aviso, lo ya presentado (PDT 621 IGV-Renta / 601 PLAME) se marca solo y no se avisa.
 *
 *   doGet ?registrar=1                       → deja en los metadatos de esta hoja la dirección de su aplicación web
 *                                              (el workflow de despliegue la llama; así Cobranzas sabe a dónde pedir).
 *   doGet ?previo=1&k=CLAVE&rucs=..&periodo=AAAAMM → lanza el robot para esas empresas y ese periodo.
 *
 * La CLAVE la crea Cobranzas en los metadatos de esta hoja ('DEC_PUENTE'; no se ven y no van al repositorio).
 * Un mismo pedido (empresas + periodo) no se repite en 10 horas.
 */

function DEC_registrarWeb_() {
  if (!DEC_DEPLOYMENT_ID_) return;
  var ss = DEC_ss_(), m = ss.createDeveloperMetadataFinder().withKey('DEC_WEB').find();
  if (m.length && m[0].getValue() === DEC_DEPLOYMENT_ID_) return;
  m.forEach(function (x) { try { x.remove(); } catch (e) {} });
  ss.addDeveloperMetadata('DEC_WEB', DEC_DEPLOYMENT_ID_, SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT);
}

function DEC_iguales_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function DEC_previo_(p) {
  var m = DEC_ss_().createDeveloperMetadataFinder().withKey('DEC_PUENTE').find();
  var clave = m.length ? String(m[0].getValue() || '') : '';
  if (clave.length < 40 || !p.k || !DEC_iguales_(p.k, clave)) return { ok: false, error: 'No autorizado' };
  var per = String(p.periodo || '').replace(/\D/g, '');
  if (!/^20\d{4}$/.test(per)) return { ok: false, error: 'periodo no válido' };
  var rucs = String(p.rucs || '').split(/[,\s]+/).filter(function (r) { return /^\d{11}$/.test(r); })
    .filter(function (r, i, l) { return l.indexOf(r) === i; }).slice(0, 30).sort();
  if (!rucs.length) return { ok: false, error: 'sin empresas' };
  var props = PropertiesService.getScriptProperties(), hechos = {};
  try { hechos = JSON.parse(props.getProperty('DEC_PREVIOS') || '{}'); } catch (e) { hechos = {}; }
  var ahora = Date.now(), clv = per + '|' + rucs.join(',');
  Object.keys(hechos).forEach(function (k) { if (ahora - hechos[k] > 24 * 3600 * 1000) delete hechos[k]; });
  if (hechos[clv] && ahora - hechos[clv] < 10 * 3600 * 1000) return { ok: true, repetido: true, mensaje: 'Ya se pidió hace poco.' };
  DEC_pedir_(DEC_cfg_(), { empresa: rucs.join(','), desde: per, hasta: per });
  hechos[clv] = ahora;
  props.setProperty('DEC_PREVIOS', JSON.stringify(hechos));
  return { ok: true, mensaje: 'Pedido a SUNAT: ' + rucs.length + ' empresa(s), periodo ' + per + '.' };
}
