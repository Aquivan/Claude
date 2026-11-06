/**
 * 📑 Declaraciones — pedir la descarga a GitHub (DEC_Pedir.js).
 * Crea una LLAVE de un solo uso (vale 6 horas) y lanza el robot «Declaraciones - descargar» con la
 * dirección de esta hoja y esa llave. El robot manda cada constancia aquí (DEC_Web.js); nada queda en GitHub.
 */

var DEC_WORKFLOW_ = 'declaraciones-descargar.yml';
var DEC_HORAS_LLAVE_ = 6;

function DEC_urlWeb_() {
  if (!DEC_DEPLOYMENT_ID_) throw new Error('La aplicación web de esta hoja aún no está publicada (workflow «Desplegar Declaraciones (hoja)»).');
  return 'https://script.google.com/macros/s/' + DEC_DEPLOYMENT_ID_ + '/exec';
}

function DEC_llaves_() {
  var p = PropertiesService.getScriptProperties(), l = {};
  try { l = JSON.parse(p.getProperty('DEC_LLAVES') || '{}'); } catch (e) { l = {}; }
  var ahora = Date.now();
  Object.keys(l).forEach(function (k) { if (!l[k] || l[k].vence < ahora) delete l[k]; });
  return l;
}

/** opts: {empresa, desde, hasta, rehacer} → lanza el robot. */
function DEC_pedir_(cfg, opts) {
  var llave = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var l = DEC_llaves_();
  l[llave] = { vence: Date.now() + DEC_HORAS_LLAVE_ * 3600 * 1000, pedido: DEC_ahora_(), empresa: opts.empresa || 'todas', desde: opts.desde || '', hasta: opts.hasta || '' };
  PropertiesService.getScriptProperties().setProperty('DEC_LLAVES', JSON.stringify(l));
  DEC_gh_(cfg, '/actions/workflows/' + DEC_WORKFLOW_ + '/dispatches', 'post', {
    ref: cfg.rama,
    inputs: {
      empresa: String(opts.empresa || 'todas'), desde: String(opts.desde || ''), hasta: String(opts.hasta || ''),
      formularios: cfg.formularios.join(','), rehacer: opts.rehacer ? 'true' : 'false',
      destino: DEC_urlWeb_(), llave: llave,
    },
  });
  PropertiesService.getScriptProperties().setProperty('DEC_ULTIMO_PEDIDO', JSON.stringify({ t: DEC_ahora_(), empresa: opts.empresa || 'todas', desde: opts.desde || '', hasta: opts.hasta || '' }));
  return { desde: opts.desde || 'últimos meses', hasta: opts.hasta || 'mes anterior' };
}

function DEC_menuPedir() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = DEC_cfg_();
    var r = DEC_pedir_(cfg, { empresa: 'todas', desde: DEC_mesAtras_(cfg.meses), hasta: DEC_mesAtras_(1) });
    ui.alert('⬇ Pedido a SUNAT (' + r.desde + ' a ' + r.hasta + ', todas las empresas).\n\nTarda unos minutos por empresa. ' +
      'Las constancias llegan solas a esta hoja; vea el avance con 🔎 Estado de la última descarga.');
  } catch (e) { ui.alert('❌ ' + e.message); }
}

function DEC_menuPedirRango() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('⬇ Pedir a SUNAT',
    'Escriba los periodos y (opcional) el RUC, por ejemplo:\n   202601-202609\n   202601-202609 20447969531\n   202609\n' +
    'Agregue «rehacer» al final para volver a bajar también las que ya están.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText();
  var per = t.match(/\b(20\d{4})\b(?:\s*-\s*(20\d{4})\b)?/);
  var ruc = t.match(/\b(\d{11})\b/);
  if (!per) { ui.alert('No entendí los periodos. Ejemplo: 202601-202609'); return; }
  try {
    var cfg = DEC_cfg_();
    DEC_pedir_(cfg, { empresa: ruc ? ruc[1] : 'todas', desde: per[1], hasta: per[2] || per[1], rehacer: /rehacer/i.test(t) });
    ui.alert('⬇ Pedido: ' + per[1] + (per[2] ? ' a ' + per[2] : '') + ' · ' + (ruc ? 'RUC ' + ruc[1] : 'todas las empresas') + '.');
  } catch (e) { ui.alert('❌ ' + e.message); }
}

/** Texto con el estado de la última descarga (también lo usa el bot). */
function DEC_textoEstado_() {
  var p = PropertiesService.getScriptProperties();
  var ped = {}, res = {};
  try { ped = JSON.parse(p.getProperty('DEC_ULTIMO_PEDIDO') || '{}'); } catch (e) {}
  try { res = JSON.parse(p.getProperty('DEC_RESULTADOS') || '{}'); } catch (e) {}
  var lineas = ['Último pedido: ' + (ped.t || '—') + (ped.empresa ? ' · ' + ped.empresa + ' · ' + (ped.desde || 'últimos meses') + '–' + (ped.hasta || '') : '')];
  var rucs = Object.keys(res);
  if (!rucs.length) lineas.push('Aún no llegó nada del robot.');
  rucs.sort().forEach(function (r) {
    var x = res[r];
    lineas.push((x.error ? '⚠️ ' : x.mal ? '🟡 ' : '✅ ') + (x.empresa || r) + ': ' + (x.error ? x.error :
      (x.total || 0) + ' en SUNAT · ' + (x.bien || 0) + ' nuevas' + (x.mal ? ' · ' + x.mal + ' con error' : '')) + ' (' + (x.t || '') + ')');
  });
  lineas.push('Descarga mensual: ' + (DEC_mensualActivo_() ? 'activada' : 'desactivada'));
  return lineas.join('\n');
}

function DEC_menuEstado() {
  var cfg = DEC_cfg_(), extra = '';
  try {
    var runs = DEC_gh_(cfg, '/actions/workflows/' + DEC_WORKFLOW_ + '/runs?per_page=1').workflow_runs || [];
    if (runs.length) extra = '\n\nRobot de GitHub: ' + (runs[0].status === 'completed' ? (runs[0].conclusion === 'success' ? '✅ terminó bien' : '⚠️ terminó con ' + runs[0].conclusion) : '⏳ trabajando') + '\n' + runs[0].html_url;
  } catch (e) { extra = '\n\n(GitHub: ' + e.message + ')'; }
  SpreadsheetApp.getUi().alert('🔎 Estado\n\n' + DEC_textoEstado_() + extra);
}
