/**
 * SoloReporte.gs
 * ⚡ "Actualizar solo reporte SIRE (rápido)": pide a GitHub SOLO el registro de compras y/o ventas
 * del SIRE (API oficial de SUNAT, sin navegador y sin bajar el PDF/XML de cada factura), para una
 * empresa, varias o todas, de un mes o de un rango de meses. Lo hace el workflow
 * sire-solo-reporte.yml (todas las empresas a la vez), que deja los datos en el mismo lugar que la
 * descarga completa. Al terminar cada empresa, el webhook instantáneo importa esos meses a Drive
 * (y la Liquidación IGV se actualiza sola); si no hay webhook, queda un seguimiento automático.
 * También se pide desde Telegram (/sire) y WhatsApp ("sire …").
 */

var WORKFLOW_SOLO_REPORTE_ = 'sire-solo-reporte.yml';

function menuSoloReporteSire() {
  var ui = SpreadsheetApp.getUi();
  var cfg;
  try { cfg = cargarConfigGitHub_(); } catch (e) { ui.alert('Error de configuracion', e.message, ui.ButtonSet.OK); return; }
  var empresas;
  try { empresas = listarEmpresasGitHub_(cfg, true); } catch (e) { ui.alert('Error leyendo empresas.json', e.message, ui.ButtonSet.OK); return; }
  if (!empresas.length) { ui.alert('No hay empresas activas en empresas.json.'); return; }

  // 1) Empresas
  var lista = empresas.map(function (e, i) { return (i + 1) + '. ' + e.nombre + ' (' + e.ruc + ')'; }).join('\n');
  var r1 = ui.prompt('⚡ Solo reporte SIRE - Paso 1/3: empresas',
    lista + '\n\nEscriba los números (ej. 1,3) o los RUC separados por coma.\nDéjelo vacío para TODAS.', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var elegidas = soloReporteEmpresas_(r1.getResponseText(), empresas);
  if (elegidas.error) { ui.alert(elegidas.error); return; }

  // 2) Mes o rango
  var mesActual = periodoActualStr_();
  var r2 = ui.prompt('⚡ Solo reporte SIRE - Paso 2/3: periodo',
    'Un mes: AAAAMM (ej. ' + mesActual + ')\nUn rango: AAAAMM-AAAAMM (ej. ' + mesActual.slice(0, 4) + '01-' + mesActual + ')\n\nVacío = mes actual (' + mesActual + ').', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var per = soloReportePeriodo_(r2.getResponseText(), mesActual);
  if (per.error) { ui.alert(per.error); return; }

  // 3) Compras, ventas o ambos
  var r3 = ui.prompt('⚡ Solo reporte SIRE - Paso 3/3: registro',
    'Escriba: compras, ventas o ambos.\nVacío = ambos.', ui.ButtonSet.OK_CANCEL);
  if (r3.getSelectedButton() !== ui.Button.OK) return;
  var t = normalizarTexto_(r3.getResponseText());
  var tipo = !t || /ambo|todo/.test(t) ? 'ambos' : /compr/.test(t) ? 'compra' : /vent/.test(t) ? 'venta' : '';
  if (!tipo) { ui.alert('Escriba compras, ventas o ambos.'); return; }

  var textoEmp = elegidas.todas ? 'TODAS las empresas (' + empresas.length + ')' : elegidas.lista.map(function (e) { return e.nombre; }).join(', ');
  var textoPer = per.periodos.length > 1 ? per.desde + ' a ' + per.hasta + ' (' + per.periodos.length + ' meses)' : per.desde;
  var textoTipo = tipo === 'ambos' ? 'compras y ventas' : tipo === 'compra' ? 'compras' : 'ventas';
  var ok = ui.alert('⚡ ¿Bajo solo el reporte?',
    'Empresas: ' + textoEmp + '\nPeriodo: ' + textoPer + '\nRegistro: ' + textoTipo +
    '\n\nSolo LEE el SIRE en SUNAT (sin PDF/XML de las facturas). Tarda 1 a 3 minutos por empresa y mes; las empresas van a la vez.',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  var cfgR = Object.assign({}, cfg, { GITHUB_WORKFLOW: WORKFLOW_SOLO_REPORTE_ });
  var ahora = Date.now();
  try {
    githubFetch_(cfgR, '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO + '/actions/workflows/' + WORKFLOW_SOLO_REPORTE_ + '/dispatches', {
      method: 'post',
      payload: { ref: cfg.GITHUB_BRANCH, inputs: {
        ruc: elegidas.todas ? '' : elegidas.lista.map(function (e) { return e.ruc; }).join(','),
        periodo: per.periodos.length > 1 ? per.desde + '-' + per.hasta : per.desde,
        tipo: tipo } }
    });
  } catch (e) {
    ui.alert('No se pudo pedir a GitHub', e.message + (/404/.test(e.message) ? '\n\n(¿Ya está subido sire-solo-reporte.yml a la rama ' + cfg.GITHUB_BRANCH + '?)' : ''), ui.ButtonSet.OK);
    return;
  }
  registrarEnBitacora_('⚡ Solo reporte SIRE pedido: ' + textoEmp + ' · ' + textoPer + ' · ' + textoTipo);

  var corrida = null;
  try { corrida = buscarCorridaRecienDisparada_(cfgR, ahora); } catch (e) {}
  var tieneWebhook = !!PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  var seguimiento;
  if (tieneWebhook) {
    seguimiento = '⚡ Webhook activo: cada empresa se importa a Drive apenas termina.';
  } else {
    programarSeguimiento_(per.periodos, elegidas.todas ? null : elegidas.lista.map(function (e) { return e.ruc; }).join(','), ahora, WORKFLOW_SOLO_REPORTE_);
    seguimiento = 'Se programó un seguimiento: cuando GitHub termine, se importa a Drive solo.';
  }
  ui.alert('⚡ Solo reporte SIRE pedido',
    textoEmp + '\n' + textoPer + ' · ' + textoTipo + '\n\n' + seguimiento +
    (corrida ? '\n\nCorrida: ' + corrida.html_url : '\n\nPuede ver el avance en la pestaña "Actions" de GitHub.'), ui.ButtonSet.OK);
}

/** "1,3" / RUCs / vacío → {todas, lista:[empresa]} o {error}. */
function soloReporteEmpresas_(texto, empresas) {
  var t = String(texto || '').trim();
  if (!t || /^tod/i.test(t)) return { todas: true, lista: empresas };
  var lista = [], malas = [];
  t.split(/[,;\s]+/).filter(String).forEach(function (x) {
    var e = null;
    if (/^\d{11}$/.test(x)) e = empresas.filter(function (y) { return y.ruc === x; })[0];
    else if (/^\d{1,2}$/.test(x)) e = empresas[Number(x) - 1];
    if (!e) malas.push(x);
    else if (lista.indexOf(e) < 0) lista.push(e);
  });
  if (malas.length) return { error: 'No reconozco: ' + malas.join(', ') + '. Use los números de la lista o RUC de empresas activas.' };
  if (!lista.length) return { error: 'No eligió ninguna empresa.' };
  return { todas: lista.length === empresas.length, lista: lista };
}

/** "202609" / "202601-202609" / vacío → {desde, hasta, periodos} o {error}. Máximo 36 meses, no futuros. */
function soloReportePeriodo_(texto, mesActual) {
  var t = String(texto || '').replace(/\s+/g, '');
  if (!t) t = mesActual;
  var m = t.match(/^(\d{6})(?:-(\d{6}))?$/);
  if (!m) return { error: 'Use AAAAMM (ej. 202609) o AAAAMM-AAAAMM (ej. 202601-202609).' };
  var desde = m[1], hasta = m[2] || m[1];
  var valido = function (p) { var mm = Number(p.slice(4)); return /^20\d\d/.test(p) && mm >= 1 && mm <= 12; };
  if (!valido(desde) || !valido(hasta)) return { error: 'Mes no válido (debe ser 01 a 12).' };
  if (hasta < desde) return { error: 'El rango está al revés: ' + desde + ' es después de ' + hasta + '.' };
  if (hasta > mesActual) return { error: hasta + ' todavía no empieza (estamos en ' + mesActual + ').' };
  var periodos = rangoPeriodosStr_(desde, hasta);
  if (periodos.length > 36) return { error: 'Son ' + periodos.length + ' meses: el máximo es 36 por vez.' };
  return { desde: desde, hasta: hasta, periodos: periodos };
}
