/**
 * Honorarios · Grupo — Hojas.js
 * Arma las pestañas Panel, Recibos y Por emisor con lo descargado de SUNAT.
 */

var HON_COLOR = { titulo: '#1f3b5c', cabecera: '#1f3b5c', texto: '#ffffff', suave: '#eef3f8', revertido: '#fde7e9', alerta: '#fff4e5' };
var HON_LIMITE_RET_ = 1500;  // un recibo mayor a S/ 1,500 lleva retención de 4ta (8%), salvo suspensión

var HON_ENC_RECIBOS = ['Empresa', 'RUC empresa', 'Periodo', 'Fecha emisión', 'Tipo', 'Comprobante', 'Estado',
  'RUC emisor', 'Emisor (quien emitió el recibo)', 'Descripción del servicio', 'Tipo renta', 'Moneda', 'Renta bruta',
  'Retención 4ta (IR)', 'Renta neta', 'Pendiente de pago', 'Observación', 'PDF', 'Ruta'];
var HON_ENC_EMISORES = ['Empresa', 'RUC emisor', 'Emisor', 'N° recibos', 'Renta bruta', 'Retención 4ta', 'Renta neta',
  'Pendiente de pago', 'Último recibo', 'Recibos > S/1,500 sin retención'];

/* ------------------------------------------------------------- utilidades */

function HON_num_(v) {
  var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/,/g, ''));
  return isNaN(n) ? '' : n;
}

function HON_fecha_(s) {
  var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
  // Mediodía: así ningún cambio de zona horaria mueve la fecha al día anterior.
  return m ? new Date(+m[3], +m[2] - 1, +m[1], 12) : (s || '');
}

function HON_periodoTexto_(p) {
  p = String(p || '');
  return p.length === 6 ? p.slice(0, 4) + '-' + p.slice(4) : p;
}

function HON_csvObjetos_(texto) {
  if (!texto) return [];
  var filas = Utilities.parseCsv(texto.replace(/^﻿/, ''));
  if (filas.length < 2) return [];
  var enc = filas[0];
  return filas.slice(1).filter(function (f) { return f.join('') !== ''; }).map(function (f) {
    var o = {};
    enc.forEach(function (k, i) { o[k] = f[i] === undefined ? '' : f[i]; });
    return o;
  });
}

function HON_r2_(x) { return Math.round((x || 0) * 100) / 100; }

function HON_nombreCorto_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA/i, 'E.I.R.L.')
    .replace(/SOCIEDAD ANONIMA CERRADA/i, 'S.A.C.')
    .replace(/SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA/i, 'S.R.L.');
}

function HON_esAnulado_(estado) { return /REVERT|ANULADO$|^ANULADO|BAJA/i.test(String(estado || '').replace(/NO ANULADO/i, '')); }

/** Notas de crédito restan. */
function HON_signo_(r) { return /^NC/i.test(r.tipo) ? -1 : 1; }

function HON_alerta_(r) {
  if (HON_esAnulado_(r.estado) || /^NC/i.test(r.tipo)) return '';
  var bruta = HON_num_(r.renta_bruta) || 0, ret = HON_num_(r.retencion_renta) || 0;
  return bruta > HON_LIMITE_RET_ && ret === 0 && /SOL/i.test(r.moneda || 'SOLES')
    ? '⚠️ Mayor a S/1,500 sin retención: ¿el emisor tiene suspensión de 4ta?' : '';
}

/* ------------------------------------------------------- lectura de datos */

function HON_leerDatos_(cfg) {
  var archivos = HON_listarArchivos_(cfg);
  var desde = cfg.desde || '000000';
  var rutasCsv = archivos.map(function (a) { return a.path; }).filter(function (p) {
    var m = /^(\d{11})\/(\d{4})\/(\d{2})\/rhe\.csv$/.exec(p);
    return m && (m[2] + m[3]) >= desde;
  });
  var textos = HON_leerTextos_(cfg, rutasCsv);
  var empresas = {};
  HON_listarEmpresas_(cfg).forEach(function (e) { if (e.activo) empresas[e.ruc] = HON_nombreCorto_(e.nombre); });
  var rec = [];
  rutasCsv.forEach(function (ruta) { rec = rec.concat(HON_csvObjetos_(textos[ruta])); });
  rec.forEach(function (r) { r.empresa = empresas[r.empresa_ruc] || r.empresa_ruc; });
  rec.sort(function (a, b) {
    return a.empresa.localeCompare(b.empresa) || String(a.periodo).localeCompare(String(b.periodo)) ||
      (HON_fecha_(a.fecha_emision) - HON_fecha_(b.fecha_emision)) || String(a.emisor).localeCompare(String(b.emisor));
  });
  return { rec: rec, empresas: empresas, pdfDisponibles: archivos.filter(function (a) { return /\.pdf$/.test(a.path); }).length };
}

/* ----------------------------------------------------------- escritura */

function HON_hoja_(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function HON_escribirTabla_(nombre, titulo, nota, encabezados, filas, formatos, anchos) {
  var hoja = HON_hoja_(nombre);
  if (hoja.getFilter()) hoja.getFilter().remove();
  hoja.clear();
  hoja.getRange(1, 1).setValue(titulo).setFontSize(14).setFontWeight('bold').setFontColor(HON_COLOR.titulo);
  hoja.getRange(2, 1).setValue(nota).setFontColor('#666666');
  var n = encabezados.length;
  hoja.getRange(3, 1, 1, n).setValues([encabezados]).setFontWeight('bold')
    .setBackground(HON_COLOR.cabecera).setFontColor(HON_COLOR.texto).setWrap(true).setVerticalAlignment('middle');
  hoja.setFrozenRows(3);
  if (filas.length) {
    Object.keys(formatos || {}).forEach(function (i) {
      hoja.getRange(4, +i + 1, filas.length, 1).setNumberFormat(formatos[i]);
    });
    hoja.getRange(4, 1, filas.length, n).setValues(filas);
  }
  hoja.getRange(3, 1, Math.max(filas.length, 1) + 1, n).createFilter();
  (anchos || []).forEach(function (w, i) { if (w) hoja.setColumnWidth(i + 1, w); });
  var sobra = hoja.getMaxColumns() - n;
  if (sobra > 0) hoja.deleteColumns(n + 1, sobra);
  return hoja;
}

function HON_escribirRecibos_(datos) {
  var filas = datos.rec.map(function (r) {
    var obs = [r.observacion, HON_alerta_(r)].filter(Boolean).join(' · ');
    return [r.empresa, r.empresa_ruc, HON_periodoTexto_(r.periodo), HON_fecha_(r.fecha_emision), r.tipo, r.comprobante, r.estado,
      r.emisor_ruc, r.emisor, r.descripcion, r.tipo_renta, r.moneda, HON_num_(r.renta_bruta), HON_num_(r.retencion_renta),
      HON_num_(r.renta_neta), HON_num_(r.pendiente_pago), obs, '', r.pdf || ''];
  });
  var anul = datos.rec.filter(function (r) { return HON_esAnulado_(r.estado); }).length;
  var alertas = datos.rec.filter(function (r) { return HON_alerta_(r); }).length;
  var hoja = HON_escribirTabla_(HON_HOJA.RECIBOS, '🧑‍💼 Recibos por honorarios RECIBIDOS (nos emitieron)',
    filas.length + ' recibos · ' + anul + ' revertidos/anulados (en rojo) · ' + alertas + ' mayores a S/1,500 sin retención (en naranja) · columna PDF = enlace al PDF oficial en Drive',
    HON_ENC_RECIBOS, filas,
    { 1: '@', 2: '@', 3: 'dd/mm/yyyy', 5: '@', 7: '@', 12: '#,##0.00', 13: '#,##0.00', 14: '#,##0.00', 15: '#,##0.00', 18: '@' },
    [200, 100, 75, 90, 45, 85, 100, 100, 250, 260, 50, 65, 100, 95, 100, 95, 240, 75, 60]);
  hoja.hideColumns(HON_ENC_RECIBOS.length);  // Ruta (uso interno)
  if (filas.length) {
    hoja.getRange(4, 1, filas.length, HON_ENC_RECIBOS.length).setBackgrounds(datos.rec.map(function (r) {
      var c = HON_esAnulado_(r.estado) ? HON_COLOR.revertido : HON_alerta_(r) ? HON_COLOR.alerta : null;
      return HON_ENC_RECIBOS.map(function () { return c; });
    }));
  }
  hoja.setFrozenColumns(1);
  HON_ponerEnlacesPdf_(hoja);
}

function HON_escribirEmisores_(datos) {
  var m = {};
  datos.rec.forEach(function (r) {
    if (HON_esAnulado_(r.estado)) return;
    var k = r.empresa_ruc + '|' + r.emisor_ruc, s = HON_signo_(r);
    var e = m[k] = m[k] || { emp: r.empresa, ruc: r.emisor_ruc, nom: r.emisor, n: 0, b: 0, ret: 0, net: 0, pen: 0, ult: null, al: 0 };
    e.n++; e.b += s * (HON_num_(r.renta_bruta) || 0); e.ret += s * (HON_num_(r.retencion_renta) || 0);
    e.net += s * (HON_num_(r.renta_neta) || 0); e.pen += HON_num_(r.pendiente_pago) || 0;
    var f = HON_fecha_(r.fecha_emision);
    if (f instanceof Date && (!e.ult || f > e.ult)) e.ult = f;
    if (HON_alerta_(r)) e.al++;
  });
  var filas = Object.keys(m).map(function (k) { return m[k]; })
    .sort(function (a, b) { return a.emp.localeCompare(b.emp) || b.b - a.b; })
    .map(function (e) { return [e.emp, e.ruc, e.nom, e.n, HON_r2_(e.b), HON_r2_(e.ret), HON_r2_(e.net), HON_r2_(e.pen), e.ult || '', e.al || '']; });
  HON_escribirTabla_(HON_HOJA.EMISORES, '👥 Por emisor: cuánto se pagó a cada persona (sin revertidos)',
    filas.length + ' emisores · las notas de crédito restan', HON_ENC_EMISORES, filas,
    { 1: '@', 4: '#,##0.00', 5: '#,##0.00', 6: '#,##0.00', 7: '#,##0.00', 8: 'dd/mm/yyyy', 9: '0' },
    [200, 100, 280, 80, 110, 100, 110, 110, 95, 120]);
}

/** Panel: resumen por empresa y por mes (sin revertidos/anulados). */
function HON_escribirPanel_(datos, cfg) {
  var hoja = HON_hoja_(HON_HOJA.PANEL);
  hoja.clear();
  hoja.getRange('A1').setValue('🧑‍💼 Honorarios · Grupo').setFontSize(18).setFontWeight('bold').setFontColor(HON_COLOR.titulo);
  hoja.getRange('A2').setValue('Recibos por honorarios RECIBIDOS · actualizado: ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm') +
    '   ·   Desde: ' + HON_periodoTexto_(cfg.desde) + '   ·   Importes sin revertidos/anulados; las N/C restan.').setFontColor('#666666');

  var porEmp = {}, periodos = {};
  Object.keys(datos.empresas).forEach(function (ruc) { porEmp[ruc] = { nom: datos.empresas[ruc], n: 0, anul: 0, b: 0, ret: 0, net: 0, pen: 0, pdf: 0, tot: 0, al: 0 }; });
  datos.rec.forEach(function (r) {
    var e = porEmp[r.empresa_ruc] || (porEmp[r.empresa_ruc] = { nom: r.empresa, n: 0, anul: 0, b: 0, ret: 0, net: 0, pen: 0, pdf: 0, tot: 0, al: 0 });
    e.tot++;
    if (r.pdf) e.pdf++;
    if (HON_esAnulado_(r.estado)) { e.anul++; return; }
    var s = HON_signo_(r);
    e.n++; e.b += s * (HON_num_(r.renta_bruta) || 0); e.ret += s * (HON_num_(r.retencion_renta) || 0);
    e.net += s * (HON_num_(r.renta_neta) || 0); e.pen += HON_num_(r.pendiente_pago) || 0;
    if (HON_alerta_(r)) e.al++;
    periodos[r.periodo] = true;
  });
  var filas = Object.keys(porEmp).map(function (ruc) {
    var e = porEmp[ruc];
    return [e.nom, ruc, e.n, HON_r2_(e.b), HON_r2_(e.ret), HON_r2_(e.net), HON_r2_(e.pen), e.anul, e.al, e.tot ? e.pdf + ' / ' + e.tot : '—'];
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  var t = filas.reduce(function (s, f) { return [s[0] + f[2], s[1] + f[3], s[2] + f[4], s[3] + f[5], s[4] + f[6], s[5] + f[7], s[6] + f[8]]; }, [0, 0, 0, 0, 0, 0, 0]);
  filas.push(['TOTAL GRUPO', '', t[0], HON_r2_(t[1]), HON_r2_(t[2]), HON_r2_(t[3]), HON_r2_(t[4]), t[5], t[6], '']);

  var f0 = 4;
  hoja.getRange(f0, 1).setValue('Resumen por empresa').setFontWeight('bold').setFontSize(12);
  var enc = ['Empresa', 'RUC', 'Recibos', 'Renta bruta S/', 'Retención 4ta S/', 'Renta neta S/', 'Pendiente de pago S/',
    'Revertidos / anulados', '> S/1,500 sin retención', 'PDF descargados'];
  hoja.getRange(f0 + 1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold')
    .setBackground(HON_COLOR.cabecera).setFontColor(HON_COLOR.texto).setWrap(true);
  hoja.getRange(f0 + 2, 2, filas.length, 1).setNumberFormat('@');
  hoja.getRange(f0 + 2, 1, filas.length, enc.length).setValues(filas);
  hoja.getRange(f0 + 2, 4, filas.length, 4).setNumberFormat('#,##0.00');
  hoja.getRange(f0 + 1 + filas.length, 1, 1, enc.length).setFontWeight('bold').setBackground(HON_COLOR.suave);

  var lista = Object.keys(periodos).sort();
  var fila = f0 + filas.length + 4;
  [['renta_bruta', '💵 Renta bruta por mes (S/)'], ['retencion_renta', '🏛 Retención de 4ta por mes (S/) — para declarar en PLAME / 0621']].forEach(function (par) {
    hoja.getRange(fila, 1).setValue(par[1]).setFontWeight('bold').setFontSize(12);
    var cab = ['Empresa'].concat(lista.map(function (p) { return HON_MESES[+p.slice(4) - 1] + ' ' + p.slice(2, 4); })).concat(['Total']);
    hoja.getRange(fila + 1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold')
      .setBackground(HON_COLOR.cabecera).setFontColor(HON_COLOR.texto);
    var m = {};
    datos.rec.forEach(function (r) {
      if (HON_esAnulado_(r.estado)) return;
      m[r.empresa] = m[r.empresa] || {};
      m[r.empresa][r.periodo] = (m[r.empresa][r.periodo] || 0) + HON_signo_(r) * (HON_num_(r[par[0]]) || 0);
    });
    var cuerpo = Object.keys(m).sort().map(function (nom) {
      var vals = lista.map(function (p) { return m[nom][p] ? HON_r2_(m[nom][p]) : ''; });
      return [nom].concat(vals).concat([HON_r2_(vals.reduce(function (s, v) { return s + (v || 0); }, 0))]);
    });
    if (!cuerpo.length) cuerpo = [['(sin recibos)'].concat(lista.map(function () { return ''; })).concat([''])];
    hoja.getRange(fila + 2, 1, cuerpo.length, cab.length).setValues(cuerpo);
    if (cab.length > 1) hoja.getRange(fila + 2, 2, cuerpo.length, cab.length - 1).setNumberFormat('#,##0.00');
    hoja.getRange(fila + 2, cab.length, cuerpo.length, 1).setFontWeight('bold');
    fila += cuerpo.length + 4;
  });
  hoja.setColumnWidth(1, 280); hoja.setColumnWidth(2, 110);
  for (var c = 3; c <= Math.max(10, lista.length + 2); c++) hoja.setColumnWidth(c, 105);
  hoja.setFrozenRows(2);
  hoja.setHiddenGridlines(true);
}

function HON_ordenarPestanas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [HON_HOJA.PANEL, HON_HOJA.RECIBOS, HON_HOJA.EMISORES, HON_HOJA.CONFIG].forEach(function (n, i) {
    var h = ss.getSheetByName(n);
    if (h) { ss.setActiveSheet(h); ss.moveActiveSheet(i + 1); }
  });
  var arch = ss.getSheetByName(HON_HOJA.ARCHIVOS);
  if (arch) arch.hideSheet();
  ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (h && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h);
  });
  ss.setActiveSheet(ss.getSheetByName(HON_HOJA.PANEL));
}

/* -------------------------------------------------------------- acciones */

function HON_actualizarDatos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSpreadsheetTimeZone() !== 'America/Lima') ss.setSpreadsheetTimeZone('America/Lima');
  var cfg = HON_leerConfig_();
  var datos = HON_leerDatos_(cfg);
  HON_escribirRecibos_(datos);
  HON_escribirEmisores_(datos);
  HON_escribirPanel_(datos, cfg);
  HON_ordenarPestanas_();
  HON_marcarActualizacion_(Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'));
  return datos;
}

function HON_conCandado_(fn) {
  var candado = LockService.getScriptLock();
  if (!candado.tryLock(5000)) throw new Error('Ya hay una actualización en curso. Intente en unos minutos.');
  try { return fn(); } finally { candado.releaseLock(); }
}

function HON_menuActualizarDatos() {
  var ui = SpreadsheetApp.getUi();
  try {
    var d = HON_conCandado_(HON_actualizarDatos_);
    ui.alert('✅ Datos actualizados: ' + d.rec.length + ' recibos.');
  } catch (e) { ui.alert('❌ ' + e.message); }
}

function HON_menuActualizarTodo() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = HON_conCandado_(function () {
      var d = HON_actualizarDatos_();
      return { d: d, p: HON_ordenarPdf_() };
    });
    ui.alert('✅ Listo.\n\nRecibos: ' + r.d.rec.length +
      (r.p.apagado ? '\nCopia de PDF a Drive: desactivada en Config.' : '\nPDF nuevos en Drive: ' + r.p.nuevos +
        (r.p.pendientes ? '\nPDF que faltan (siguen solos en 1 minuto): ' + r.p.pendientes : '')));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

function HON_menuOrdenarPdf() {
  var ui = SpreadsheetApp.getUi();
  try {
    var p = HON_conCandado_(function () { return HON_ordenarPdf_(); });
    ui.alert(p.apagado ? 'La copia de PDF a Drive está desactivada (Config → Copiar PDF a Drive = NO).' :
      '📁 PDF nuevos en Drive: ' + p.nuevos + (p.pendientes ? '\nFaltan ' + p.pendientes + ' (siguen solos en 1 minuto).' : '\nTodos los PDF están en Drive.'));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

/** Disparador diario. */
function HON_actualizacionAutomatica() {
  HON_conCandado_(function () {
    HON_actualizarDatos_();
    HON_ordenarPdf_();
  });
}

function HON_continuarPdf() {
  HON_borrarContinuacion_();
  HON_conCandado_(function () { HON_ordenarPdf_(); });
}
