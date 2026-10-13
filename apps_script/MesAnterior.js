/**
 * MesAnterior.gs
 * Interruptor de la DESCARGA AUTOMATICA DEL MES ANTERIOR (registro SIRE:
 * propuesta, o aceptada si el periodo ya se presento).
 *
 * El interruptor vive en empresas.json (bloque "mes_anterior"). La corrida
 * programada de la 1:00 AM hora Peru de "SIRE completo"
 * (sire-cadena-completa.yml) lo lee y, si esta activo y hoy es uno de sus
 * dias (por defecto 3 y 11), agrega el mes anterior de todas las empresas
 * activas. Lo importado llega a esta hoja como siempre (Propuesta AAAAMM.zip).
 *
 * Desde aqui solo se LEE el interruptor y se le PIDE a GitHub que lo cambie
 * (dispara "SIRE completo" con mes_anterior = activar/desactivar/cambiar, que
 * no descarga nada), asi el token no necesita escribir en el repo.
 */

var MES_ANT_WORKFLOW_ = 'sire-cadena-completa.yml';

function menuDescargaMesAnterior() {
  var ui = SpreadsheetApp.getUi();
  var cfg;
  try { cfg = cargarConfigGitHub_(); } catch (e) {
    ui.alert('Falta configurar GitHub', 'Usa primero "Configurar GitHub (token, repo, rama)".', ui.ButtonSet.OK);
    return;
  }
  var rama = ramaPrincipalGitHub_(cfg);
  var actual = leerInterruptorMesAnterior_(cfg, rama);
  var dias = (actual.dias || []).join(', ');
  var estado = (actual.activo ? '✅ ACTIVADA' : '⛔ DESACTIVADA') + '\n' +
    'Días del mes: ' + (dias || '—') + ' · 1:00 AM hora Perú\n' +
    'Qué baja: registro SIRE (' + (actual.tipo || 'ambos') + ') del mes anterior' +
    (actual.pdf_xml && actual.pdf_xml !== 'ninguno' ? ' + PDF/XML (' + actual.pdf_xml + ')' : ' (sin PDF/XML)') + '\n';

  var resp = ui.prompt('📅 Descarga automática del mes anterior',
    estado + '\nEscribe el número de lo que quieres hacer:\n' +
    '  1 = Activar\n' +
    '  2 = Desactivar\n' +
    '  3 = Cambiar los días (ej. 3,11 o solo 11)\n' +
    '  4 = Cambiar si baja también PDF/XML\n' +
    '  5 = Descargar AHORA el mes anterior (una vez)\n',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var op = resp.getResponseText().trim();
  var inputs = { mes_anterior: '', mes_anterior_dias: '', mes_anterior_pdf: '' };

  if (op === '1') {
    inputs.mes_anterior = 'activar';
  } else if (op === '2') {
    inputs.mes_anterior = 'desactivar';
  } else if (op === '3') {
    var r = ui.prompt('Días del mes', 'Días separados por coma, del 1 al 28 (ej. 3,11 o solo 11).\nAhora: ' + (dias || '—'),
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    var lista = (r.getResponseText().match(/\d+/g) || []).map(Number);
    if (!lista.length || lista.some(function (d) { return d < 1 || d > 28; })) {
      ui.alert('Días no válidos', 'Deben ser números del 1 al 28 (así existen en todos los meses).', ui.ButtonSet.OK);
      return;
    }
    inputs.mes_anterior = 'cambiar';
    inputs.mes_anterior_dias = lista.join(',');
  } else if (op === '4') {
    var p = ui.prompt('PDF/XML', 'Escribe: ninguno (solo el registro / propuesta), ambos, compra o venta.\nAhora: ' +
      (actual.pdf_xml || 'ninguno'), ui.ButtonSet.OK_CANCEL);
    if (p.getSelectedButton() !== ui.Button.OK) return;
    var v = p.getResponseText().trim().toLowerCase();
    if (['ninguno', 'ambos', 'compra', 'venta'].indexOf(v) < 0) {
      ui.alert('Valor no válido', 'Debe ser: ninguno, ambos, compra o venta.', ui.ButtonSet.OK);
      return;
    }
    inputs.mes_anterior = 'cambiar';
    inputs.mes_anterior_pdf = v;
  } else if (op === '5') {
    inputs.mes_anterior = 'descargar-ahora';
  } else {
    ui.alert('Opción no válida', 'Escribe un número del 1 al 5.', ui.ButtonSet.OK);
    return;
  }

  try {
    githubFetch_(cfg, '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO + '/actions/workflows/' + MES_ANT_WORKFLOW_ + '/dispatches', {
      method: 'post',
      payload: { ref: rama, inputs: {
        tipo: 'ambos', modo: 'completo', mes_anterior: inputs.mes_anterior,
        mes_anterior_dias: inputs.mes_anterior_dias, mes_anterior_pdf: inputs.mes_anterior_pdf,
      } },
    });
  } catch (e) {
    ui.alert('No se pudo enviar a GitHub', e.message, ui.ButtonSet.OK);
    return;
  }
  ui.alert('Enviado a GitHub ✓',
    inputs.mes_anterior === 'descargar-ahora'
      ? 'GitHub empieza ya la descarga del mes anterior para todas las empresas activas. Llegará a esta hoja sola al terminar cada empresa.'
      : 'GitHub aplica el cambio en 1 minuto aprox. Vuelve a abrir este menú para ver el estado nuevo.',
    ui.ButtonSet.OK);
}

/** Rama principal del repo (donde vive el interruptor y corre lo programado). */
function ramaPrincipalGitHub_(cfg) {
  try {
    var r = githubFetch_(cfg, '/repos/' + cfg.GITHUB_OWNER + '/' + cfg.GITHUB_REPO);
    return JSON.parse(r.getContentText()).default_branch || cfg.GITHUB_BRANCH;
  } catch (e) {
    return cfg.GITHUB_BRANCH;
  }
}

/** Bloque "mes_anterior" de empresas.json (en la rama principal). */
function leerInterruptorMesAnterior_(cfg, rama) {
  try {
    var texto = leerArchivoTextoGitHub_({
      GITHUB_TOKEN: cfg.GITHUB_TOKEN, GITHUB_OWNER: cfg.GITHUB_OWNER, GITHUB_REPO: cfg.GITHUB_REPO, GITHUB_BRANCH: rama,
    }, 'empresas.json');
    var data = texto ? JSON.parse(texto) : {};
    return data.mes_anterior || { activo: false, dias: [] };
  } catch (e) {
    return { activo: false, dias: [] };
  }
}
