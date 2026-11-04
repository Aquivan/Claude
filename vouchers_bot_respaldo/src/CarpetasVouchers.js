// ============================================================
// 📂 ABRIR CARPETAS EN DRIVE (menú Vouchers)
// Fotos / Originales procesados (donde quedan los archivos ya registrados), las de entrada (donde se dejan los
// nuevos para procesar) y Descartados. Abre la carpeta en una pestaña nueva; si el navegador bloquea la ventana,
// queda el enlace para tocarlo.
// ============================================================

function CV_carpetas_() {
  return [
    { k: 'fp', t: '📸 Fotos — procesadas', d: 'Las fotos que ya se registraron en la pestaña Fotos', id: CFG.CARPETA_FOTOS_PROCESADOS_ID },
    { k: 'op', t: '📄 Originales — procesados', d: 'Los PDF/originales que ya se registraron en la pestaña Originales', id: CFG.CARPETA_ORIGINALES_PROCESADOS_ID },
    { k: 'fe', t: '📥 Fotos — entrada', d: 'Fotos que esperan ser procesadas (se procesan solas o con ▶ Procesar Nuevos Archivos)', id: CFG.CARPETA_FOTOS_ENTRADA_ID },
    { k: 'oe', t: '📥 Originales — entrada', d: 'PDF/originales que esperan ser procesados', id: CFG.CARPETA_ORIGINALES_ENTRADA_ID },
    { k: 'de', t: '🗑 Descartados', d: 'Archivos que el sistema no pudo leer o eran duplicados', id: CFG.CARPETA_DESCARTADOS_ID }
  ];
}

function CV_abrir_(k) {
  var lista = CV_carpetas_().filter(function (c) { return !k || c.k === k; });
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px">' + lista.map(function (c) {
    var url = 'https://drive.google.com/drive/folders/' + c.id;
    return '<p style="margin:10px 0"><a href="' + url + '" target="_blank" style="font-weight:bold">' + c.t + ' ↗</a><br>' +
      '<span style="color:#666;font-size:12px">' + c.d + '</span></p>';
  }).join('') + '</div>' +
    (lista.length === 1 ? '<script>var w = window.open("https://drive.google.com/drive/folders/' + lista[0].id + '", "_blank");' +
      'if (w) setTimeout(function () { google.script.host.close(); }, 800);</script>' : '');
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(lista.length === 1 ? 140 : 380),
    lista.length === 1 ? 'Abriendo carpeta…' : '📂 Carpetas de Vouchers en Drive');
}

function CV_fotosProcesadas() { CV_abrir_('fp'); }
function CV_originalesProcesados() { CV_abrir_('op'); }
function CV_fotosEntrada() { CV_abrir_('fe'); }
function CV_originalesEntrada() { CV_abrir_('oe'); }
function CV_descartados() { CV_abrir_('de'); }
function CV_todas() { CV_abrir_(''); }
