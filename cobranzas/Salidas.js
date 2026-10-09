/**
 * Salidas.js
 * Escribe las hojas de resultado: 📋 Documentos, 💳 Movimientos,
 * ✅ Conciliar y 🎯 Panel.
 */

var ENC_DOCS_ = ['Empresa', 'Tipo', 'RUC contraparte', 'Contraparte', 'Documento', 'Emisión', 'Vence', 'Moneda',
  'Total', 'N/C', 'Retención', 'Detracción', 'Otros desc.', 'Pagado', 'Saldo', 'Estado', 'Días vencido',
  'Último pago', 'Producto', 'PDF', 'Clave'];
var ENC_MOVS_ = ['Fecha', 'Empresa que paga', 'RUC beneficiario', 'Beneficiario', 'Documento', 'Modalidad',
  'Monto aplicado', 'Moneda', 'N° operación', 'Banco', 'Monto del voucher', 'Origen', 'Nota', 'Fuente', 'Clave', 'ID pago'];

function nombreEmpresa_(cfg, ruc, nombre) {
  return cfg.nombreEmpresa[ruc] || nombre || ruc;
}

/** Una fila por documento y por empresa del grupo involucrada (cobrar y/o pagar). */
function construirFilasDocumentos_(res, cfg, hoy) {
  var filas = [];
  res.docs.forEach(function (d) {
    if (d.tipo === '07' || d.tipo === '08') return;
    if (!d.vence && d.fecha) {
      var dias = cfg.diasPorRuc[d.receptorRuc] || cfg.diasPorRuc[d.emisorRuc] || cfg.diasCredito;
      d.vence = new Date(d.fecha.getTime() + dias * 86400000);
    }
    var est = estadoDoc_(d, hoy);
    var ultimo = null;
    d.movs.forEach(function (m) { if (m.modalidad === MODALIDAD.PAGO && m.fecha && (!ultimo || m.fecha > ultimo)) ultimo = m.fecha; });
    var comun = [etiquetaDoc_(d), d.fecha || '', d.vence || '', d.moneda, d.total, d.nc - d.nd, d.retencion, d.detraccion,
      d.otros, d.pagado, d.saldo, est.estado, est.diasVencido || '', ultimo || '', (d.producto || '').slice(0, 200),
      d.linkPdf ? '=HYPERLINK("' + d.linkPdf + '";"📄")' : '', d.clave];
    if (cfg.grupo.indexOf(d.emisorRuc) !== -1) {
      filas.push([nombreEmpresa_(cfg, d.emisorRuc, d.emisorNombre), 'Por cobrar', d.receptorRuc, d.receptorNombre].concat(comun));
    }
    if (cfg.grupo.indexOf(d.receptorRuc) !== -1) {
      filas.push([nombreEmpresa_(cfg, d.receptorRuc, d.receptorNombre), 'Por pagar', d.emisorRuc, d.emisorNombre].concat(comun));
    }
  });
  filas.sort(function (a, b) {
    return String(a[0]).localeCompare(b[0]) || String(a[1]).localeCompare(b[1]) ||
      String(a[3]).localeCompare(b[3]) || ((a[5] || 0) - (b[5] || 0));
  });
  return filas;
}

function separadorFormula_(ss) {
  var loc = String(ss.getSpreadsheetLocale() || '');
  return /^(en|ja|zh|ko|he|th)/.test(loc) ? ',' : ';';
}

function escribirDocumentos_(ss, filas) {
  var sh = obtenerOCrearHoja_(ss, HOJA.DOCS);
  limpiarHoja_(sh);
  var sep = separadorFormula_(ss);
  var iPdf = ENC_DOCS_.indexOf('PDF');
  if (sep !== ';') filas.forEach(function (f) { if (f[iPdf]) f[iPdf] = f[iPdf].replace('";"', '"' + sep + '"'); });
  escribirTabla_(sh, 1, 1, ENC_DOCS_, filas);
  sh.setFrozenRows(1); sh.setFrozenColumns(5); sh.setRowHeight(1, 34);
  if (!filas.length) return;
  var n = filas.length;
  sh.getRange(2, 6, n, 2).setNumberFormat('dd/mm/yyyy');
  sh.getRange(2, 18, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(2, 9, n, 7).setNumberFormat('#,##0.00;-#,##0.00;"-"');
  sh.getRange(2, 3, n, 1).setNumberFormat('@');
  // Color de fila segun Estado con formato condicional (mucho mas rapido que
  // pintar celda por celda y se mantiene si el usuario filtra u ordena).
  var letraEstado = String.fromCharCode(65 + ENC_DOCS_.indexOf('Estado'));
  var rango = sh.getRange(2, 1, n, ENC_DOCS_.length);
  sh.setConditionalFormatRules(Object.keys(COLOR_ESTADO).map(function (est) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letraEstado + '2="' + est + '"')
      .setBackground(COLOR_ESTADO[est]).setRanges([rango]).build();
  }));
  rango.setFontSize(9).setVerticalAlignment('middle');
  sh.getRange(2, 15, n, 1).setFontWeight('bold');
  sh.getRange(1, 1, n + 1, ENC_DOCS_.length).createFilter();
  [110, 80, 95, 230, 105, 78, 78, 50, 95, 80, 80, 80, 70, 95, 95, 130, 60, 78, 260, 40, 10].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(ENC_DOCS_.length);
}

function escribirMovimientos_(ss, res, cfg) {
  var sh = obtenerOCrearHoja_(ss, HOJA.MOVS);
  limpiarHoja_(sh);
  var porClave = {};
  res.docs.forEach(function (d) { porClave[d.clave] = d; });
  var filas = res.movimientos.map(function (m) {
    var d = porClave[m.docClave];
    return [m.fecha || '', nombreEmpresa_(cfg, d.receptorRuc, d.receptorNombre), d.emisorRuc, d.emisorNombre, etiquetaDoc_(d),
      m.modalidad, m.monto, d.moneda, m.operacion, m.banco, m.montoPago || '', m.origen, m.nota, m.fuente, m.docClave, m.pagoId];
  });
  filas.sort(function (a, b) { return (b[0] || 0) - (a[0] || 0); });
  escribirTabla_(sh, 1, 1, ENC_MOVS_, filas);
  sh.setFrozenRows(1); sh.setRowHeight(1, 34);
  if (!filas.length) return;
  var n = filas.length;
  sh.getRange(2, 1, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(2, 7, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, 11, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, 3, n, 1).setNumberFormat('@');
  sh.getRange(2, 9, n, 1).setNumberFormat('@');
  sh.getRange(2, 1, n, ENC_MOVS_.length).setFontSize(9);
  sh.getRange(1, 1, n + 1, ENC_MOVS_.length).createFilter();
  [78, 120, 95, 230, 105, 90, 100, 55, 105, 80, 100, 120, 160, 110, 10, 10].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(15, 2);
}

function escribirConciliar_(ss, res, cfg) {
  var sh = obtenerOCrearHoja_(ss, HOJA.CONC);
  limpiarHoja_(sh);
  var fila = 1;
  sh.getRange(fila, 1, 1, 13).merge().setValue('✅ CONCILIAR — revisa lo que el sistema no pudo decidir solo')
    .setFontSize(13).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.OSCURO);
  sh.setRowHeight(fila, 32); fila++;
  sh.getRange(fila, 1, 1, 13).merge()
    .setValue('Marca ✔ para aplicar una sugerencia o ✖ para descartarla. Se aplica en la próxima actualización (máx. 10 min) o al usar 💼 Cobranzas → 🔄 Actualizar ahora. ' +
      'Para que un voucher se cruce exacto, escribe en el Sistema de Vouchers: ID Usuario (quién paga), ID Beneficiario y Tipo y Nº Doc. (ej. 01_E001-393,394).')
    .setWrap(true).setFontColor(COLOR.TEXTO_SUAVE).setFontSize(9);
  sh.setRowHeight(fila, 36); fila += 2;

  // ---- Sugerencias ----
  var porClave = {};
  res.docs.forEach(function (d) { porClave[d.clave] = d; });
  function quien(ruc, nombre) { return ruc ? nombreEmpresa_(cfg, ruc, nombre) + (cfg.grupo.indexOf(ruc) === -1 && ruc ? ' (' + ruc + ')' : '') : (nombre || '¿?'); }
  var sugTodas = res.sugerencias.slice().sort(function (a, b) { return (b.pago.fecha || 0) - (a.pago.fecha || 0); });
  var MAX_SUG = 300;
  var sug = sugTodas.slice(0, MAX_SUG);
  titulo_(sh, fila, '🟡 SUGERENCIAS POR REVISAR (' + sugTodas.length + ')' +
    (sugTodas.length > MAX_SUG ? ' · se muestran las ' + MAX_SUG + ' más recientes' : ''), '#92400E', '#FEF3C7'); fila++;
  var encS = ['✔ Aplicar', '✖ Descartar', 'Fecha', 'Operación', 'Banco', 'Monto', 'Moneda', 'Paga', 'Beneficiario', 'Factura(s) sugerida(s)', 'Saldo de esas facturas', 'Motivo', 'Fuente', 'ID pago', 'Claves'];
  var filasS = sug.map(function (s) {
    var d0 = s.docs[0];
    var saldo = s.docs.reduce(function (t, d) { return t + d.saldo; }, 0);
    return [false, false, s.pago.fecha || '', s.pago.operacion, s.pago.banco, s.pago.monto, s.pago.moneda,
      quien(s.pago.pagadorRuc || d0.receptorRuc, d0.receptorNombre), quien(d0.emisorRuc, d0.emisorNombre),
      s.docs.map(etiquetaDoc_).join(', '), saldo, s.nota, s.pago.fuente, s.pago.id, s.docs.map(function (d) { return d.clave; }).join(',')];
  });
  escribirTabla_(sh, fila, 1, encS, filasS);
  if (filasS.length) {
    sh.getRange(fila + 1, 1, filasS.length, 2).insertCheckboxes();
    sh.getRange(fila + 1, 3, filasS.length, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(fila + 1, 6, filasS.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(fila + 1, 11, filasS.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(fila + 1, 4, filasS.length, 1).setNumberFormat('@');
  }
  fila += filasS.length + 2;

  // ---- Avisos ----
  var avisos = res.errores.slice().sort(function (a, b) { return (a.pagoId ? 0 : 1) - (b.pagoId ? 0 : 1); });
  titulo_(sh, fila, '⚠️ AVISOS: referencias con error, pagos de más, N/C sin factura (' + avisos.length + ')', '#991B1B', '#FEE2E2'); fila++;
  var filasA = avisos.map(function (e) { return [e.tipo, e.detalle, e.fuente || '']; });
  escribirTabla_(sh, fila, 1, ['Tipo', 'Detalle', 'Fuente'], filasA);
  if (filasA.length) sh.getRange(fila + 1, 2, filasA.length, 1).setWrap(true);
  fila += filasA.length + 2;

  // ---- Sin cruzar ----
  var sc = res.sinCruzar.filter(function (s) { return s.relevante; })
    .sort(function (a, b) { return (b.pago.fecha || 0) - (a.pago.fecha || 0); });
  var otros = res.sinCruzar.length - sc.length;
  titulo_(sh, fila, '⚪ VOUCHERS SIN CRUZAR de empresas del grupo (' + sc.length + ')' +
    (otros ? ' · además ' + otros + ' sin RUC de quién paga ni beneficiario conocido' : ''), '#334155', '#F1F5F9'); fila++;
  var filasC = sc.map(function (s) {
    var p = s.pago;
    return [p.fecha || '', p.operacion, p.banco, p.monto, p.moneda, quien(p.pagadorRuc, ''), quien(p.beneficiarioRuc, p.beneficiarioNombre), s.motivo, p.fuente];
  });
  escribirTabla_(sh, fila, 1, ['Fecha', 'Operación', 'Banco', 'Monto', 'Moneda', 'Paga', 'Beneficiario', 'Motivo', 'Fuente'], filasC);
  if (filasC.length) {
    sh.getRange(fila + 1, 1, filasC.length, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(fila + 1, 4, filasC.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(fila + 1, 2, filasC.length, 1).setNumberFormat('@');
  }
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 15).setFontSize(9);
  sh.getRange(1, 1).setFontSize(13);
  [80, 85, 80, 95, 80, 95, 60, 170, 230, 210, 110, 230, 110, 10, 10].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(14, 2);
  sh.setFrozenRows(2);
}

function titulo_(sh, fila, texto, colorTexto, fondo) {
  sh.getRange(fila, 1, 1, 13).merge().setValue(texto).setFontWeight('bold').setFontSize(11)
    .setFontColor(colorTexto).setBackground(fondo);
  sh.setRowHeight(fila, 26);
}

/** 🎯 Panel: indicadores por empresa, antigüedad y top de saldos. */
function escribirPanel_(ss, filasDocs, res, cfg, liqs) {
  var sh = obtenerOCrearHoja_(ss, HOJA.PANEL);
  limpiarHoja_(sh);
  sh.setHiddenGridlines(true);
  var I = {}; ENC_DOCS_.forEach(function (n, i) { I[n] = i; });
  var hoy = new Date();

  // Saldos en soles (USD convertido con el TC del documento)
  var porEmp = {}, tops = { 'Por cobrar': {}, 'Por pagar': {} };
  var aging = { 'Por cobrar': [0, 0, 0, 0, 0], 'Por pagar': [0, 0, 0, 0, 0] };
  var docsPorClave = {}; res.docs.forEach(function (d) { docsPorClave[d.clave] = d; });
  cfg.grupo.forEach(function (r) {
    porEmp[nombreEmpresa_(cfg, r)] = { cob: 0, cobV: 0, pag: 0, pagV: 0, sobre: 0, falta: 0, sinCruzar: 0 };
  });
  filasDocs.forEach(function (f) {
    var d = docsPorClave[f[I['Clave']]];
    var tc = String(f[I['Moneda']]) === 'USD' ? (Number(d && d.tc) > 1 ? Number(d.tc) : 3.75) : 1;
    var saldo = Number(f[I['Saldo']]) * tc;
    var e = porEmp[f[0]] || (porEmp[f[0]] = { cob: 0, cobV: 0, pag: 0, pagV: 0, sobre: 0, falta: 0, sinCruzar: 0 });
    var estado = String(f[I['Estado']]);
    var dias = Number(f[I['Días vencido']]) || 0;
    if (estado.indexOf('Sobrepagado') !== -1) e.sobre++;
    if (estado.indexOf('Falta') !== -1) e.falta++;
    if (saldo <= 0.10) return;
    var cobrar = f[1] === 'Por cobrar';
    if (cobrar) { e.cob += saldo; if (dias > 0) e.cobV += saldo; } else { e.pag += saldo; if (dias > 0) e.pagV += saldo; }
    var b = dias <= 0 ? 0 : dias <= 30 ? 1 : dias <= 60 ? 2 : dias <= 90 ? 3 : 4;
    aging[f[1]][b] += saldo;
    var k = f[I['Contraparte']] + '|' + f[0];
    var t = tops[f[1]][k] || (tops[f[1]][k] = { nombre: f[I['Contraparte']], emp: f[0], saldo: 0, venc: 0 });
    t.saldo += saldo; if (dias > 0) t.venc += saldo;
  });
  res.sinCruzar.forEach(function (s) {
    var r = s.pago.pagadorRuc && cfg.grupo.indexOf(s.pago.pagadorRuc) !== -1 ? s.pago.pagadorRuc : s.pago.beneficiarioRuc;
    if (r && cfg.grupo.indexOf(r) !== -1) porEmp[nombreEmpresa_(cfg, r)].sinCruzar++;
  });
  var tot = { cob: 0, cobV: 0, pag: 0, pagV: 0 };
  Object.keys(porEmp).forEach(function (k) { ['cob', 'cobV', 'pag', 'pagV'].forEach(function (c) { tot[c] += porEmp[k][c]; }); });

  // ---- Encabezado ----
  sh.setColumnWidth(1, 16);
  sh.getRange('B2:M2').merge().setValue('💼  CUENTAS POR COBRAR Y POR PAGAR · GRUPO')
    .setFontSize(16).setFontWeight('bold').setFontColor('#F8FAFC').setBackground(COLOR.OSCURO).setVerticalAlignment('middle');
  sh.setRowHeight(2, 44);
  sh.getRange('B3:M3').merge().setValue('🕐 Actualizado: ' + Utilities.formatDate(hoy, 'America/Lima', 'dd/MM/yyyy HH:mm') +
    '   ·   🏢 ' + cfg.grupo.length + ' empresas   ·   📄 ' + liqs.length + ' liquidaciones SIRE leídas   ·   Montos en S/ (USD convertido al TC de cada factura)')
    .setFontSize(9).setFontColor('#7DD3FC').setBackground(COLOR.OSCURO);
  sh.setRowHeight(3, 24);

  // ---- Tarjetas ----
  var tarjetas = [
    ['POR COBRAR', tot.cob, '#065F46', '#D1FAE5'],
    ['COBRAR VENCIDO', tot.cobV, '#991B1B', '#FEE2E2'],
    ['POR PAGAR', tot.pag, '#1E3A8A', '#DBEAFE'],
    ['PAGAR VENCIDO', tot.pagV, '#991B1B', '#FEE2E2'],
    ['SUGERENCIAS POR REVISAR', res.sugerencias.length, '#92400E', '#FEF3C7'],
    ['VOUCHERS SIN CRUZAR', res.sinCruzar.filter(function (s) { return s.relevante; }).length, '#334155', '#F1F5F9'],
  ];
  tarjetas.forEach(function (t, i) {
    var c = 2 + i * 2;
    sh.getRange(5, c, 1, 2).merge().setValue(t[0]).setFontSize(8).setFontWeight('bold').setFontColor(t[2]).setBackground(t[3]).setHorizontalAlignment('center');
    sh.getRange(6, c, 1, 2).merge().setValue(t[1]).setFontSize(16).setFontWeight('bold').setFontColor(t[2]).setBackground(t[3])
      .setHorizontalAlignment('center').setNumberFormat(i < 4 ? '"S/ "#,##0' : '0');
  });
  sh.setRowHeight(5, 20); sh.setRowHeight(6, 38);

  // ---- Por empresa ----
  var fila = 8;
  sh.getRange(fila, 2, 1, 9).merge().setValue('🏢 POR EMPRESA').setFontWeight('bold').setFontColor(COLOR.AZUL); fila++;
  var encE = ['Empresa', 'Por cobrar', 'Cobrar vencido', 'Por pagar', 'Pagar vencido', 'Neto (cobrar − pagar)', 'Sobrepagados', 'Falta detr./ret.', 'Vouchers sin cruzar'];
  var filasE = Object.keys(porEmp).map(function (k) {
    var e = porEmp[k];
    return [k, e.cob, e.cobV, e.pag, e.pagV, e.cob - e.pag, e.sobre, e.falta, e.sinCruzar];
  });
  filasE.push(['TOTAL GRUPO', tot.cob, tot.cobV, tot.pag, tot.pagV, tot.cob - tot.pag, '', '', '']);
  escribirTabla_(sh, fila, 2, encE, filasE);
  sh.getRange(fila + 1, 3, filasE.length, 5).setNumberFormat('#,##0.00;-#,##0.00;"-"');
  sh.getRange(fila + filasE.length, 2, 1, encE.length).setFontWeight('bold').setBackground(COLOR.CABECERA);
  sh.getRange(fila + 1, 4, filasE.length, 1).setFontColor('#991B1B');
  sh.getRange(fila + 1, 6, filasE.length, 1).setFontColor('#991B1B');
  fila += filasE.length + 2;

  // ---- Antiguedad ----
  sh.getRange(fila, 2, 1, 4).merge().setValue('⏳ ANTIGÜEDAD DE SALDOS (días vencido)').setFontWeight('bold').setFontColor(COLOR.AZUL); fila++;
  var tramos = ['Al día', '1 – 30', '31 – 60', '61 – 90', 'Más de 90'];
  var filasG = tramos.map(function (t, i) { return [t, aging['Por cobrar'][i], aging['Por pagar'][i]]; });
  escribirTabla_(sh, fila, 2, ['Tramo', 'Por cobrar', 'Por pagar'], filasG);
  sh.getRange(fila + 1, 3, 5, 2).setNumberFormat('#,##0.00;-#,##0.00;"-"');
  fila += 7;

  // ---- Tops ----
  function top(tipo) {
    return Object.keys(tops[tipo]).map(function (k) { return tops[tipo][k]; })
      .sort(function (a, b) { return b.saldo - a.saldo; }).slice(0, 10)
      .map(function (t) { return [t.nombre, t.emp, t.saldo, t.venc]; });
  }
  sh.getRange(fila, 2, 1, 4).merge().setValue('📥 TOP 10 · QUIÉN NOS DEBE').setFontWeight('bold').setFontColor('#065F46');
  sh.getRange(fila, 8, 1, 4).merge().setValue('📤 TOP 10 · A QUIÉN DEBEMOS').setFontWeight('bold').setFontColor('#1E3A8A');
  fila++;
  var t1 = top('Por cobrar'), t2 = top('Por pagar');
  escribirTabla_(sh, fila, 2, ['Cliente', 'Empresa', 'Saldo', 'Vencido'], t1);
  escribirTabla_(sh, fila, 8, ['Proveedor', 'Empresa', 'Saldo', 'Vencido'], t2);
  if (t1.length) sh.getRange(fila + 1, 4, t1.length, 2).setNumberFormat('#,##0.00;-#,##0.00;"-"');
  if (t2.length) sh.getRange(fila + 1, 10, t2.length, 2).setNumberFormat('#,##0.00;-#,##0.00;"-"');

  sh.getRange(8, 2, sh.getLastRow(), 12).setFontSize(9);
  [16, 170, 105, 105, 105, 105, 115, 170, 105, 105, 105, 20, 20].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setColumnWidth(10, 115);
}

/**
 * 📂 Otros pagos: vouchers que NO pagan una factura (planilla, AFP, SUNAT,
 * honorarios, préstamos…). Resumen por categoría y empresa + detalle.
 */
function escribirOtrosPagos_(ss, res, cfg) {
  var sh = obtenerOCrearHoja_(ss, HOJA.OTROS);
  limpiarHoja_(sh);
  var lista = (res.sinFactura || []).slice().sort(function (a, b) { return (b.pago.fecha || 0) - (a.pago.fecha || 0); });
  sh.getRange(1, 1, 1, 11).merge().setValue('📂 OTROS PAGOS — vouchers sin factura de compra (planilla, AFP, SUNAT, honorarios, préstamos…)')
    .setFontSize(13).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.OSCURO);
  sh.setRowHeight(1, 32);
  sh.getRange(2, 1, 1, 11).merge()
    .setValue('Se clasifican con la tabla "PAGOS SIN FACTURA" de ⚙️ Config (puedes agregar palabras). Si un pago SÍ corresponde a una factura, escribe la factura en "Tipo y Nº Doc." del voucher y saldrá de aquí. ' +
      'También puedes escribir la categoría en "Tipo y Nº Doc." (ej. PLANILLA, AFP, PRESTAMO).')
    .setWrap(true).setFontSize(9).setFontColor(COLOR.TEXTO_SUAVE);
  sh.setRowHeight(2, 34);

  function quien(ruc) { return ruc ? nombreEmpresa_(cfg, ruc) : '¿?'; }
  function enSoles(p) { return String(p.moneda || 'PEN').toUpperCase() === 'USD' ? p.monto * 3.75 : p.monto; }

  // Resumen por categoria y empresa que paga
  var res1 = {};
  lista.forEach(function (x) {
    var k = x.categoria + '|' + quien(x.pago.pagadorRuc);
    var r = res1[k] || (res1[k] = { cat: x.categoria, emp: quien(x.pago.pagadorRuc), n: 0, total: 0 });
    r.n++; r.total += enSoles(x.pago);
  });
  var filasR = Object.keys(res1).map(function (k) { return res1[k]; })
    .sort(function (a, b) { return a.cat.localeCompare(b.cat) || b.total - a.total; })
    .map(function (r) { return [r.cat, r.emp, r.n, r.total]; });
  var fila = 4;
  sh.getRange(fila, 1, 1, 4).merge().setValue('RESUMEN POR CATEGORÍA (montos en S/, USD a 3.75 referencial)').setFontWeight('bold').setFontColor(COLOR.AZUL);
  fila++;
  escribirTabla_(sh, fila, 1, ['Categoría', 'Empresa que paga', 'Cantidad', 'Total S/'], filasR);
  if (filasR.length) sh.getRange(fila + 1, 4, filasR.length, 1).setNumberFormat('#,##0.00');
  fila += filasR.length + 3;

  sh.getRange(fila, 1, 1, 6).merge().setValue('DETALLE (' + lista.length + ')').setFontWeight('bold').setFontColor(COLOR.AZUL);
  fila++;
  var enc = ['Fecha', 'Empresa que paga', 'Beneficiario', 'Monto', 'Moneda', 'Operación', 'Banco', 'Categoría', 'Regla', 'Descripción', 'Fuente'];
  var filas = lista.map(function (x) {
    var p = x.pago;
    return [p.fecha || '', quien(p.pagadorRuc), p.beneficiarioNombre || '', p.monto, p.moneda, String(p.operacion || ''), p.banco,
      x.categoria, x.regla, p.descripcion || '', p.fuente];
  });
  escribirTabla_(sh, fila, 1, enc, filas);
  if (filas.length) {
    sh.getRange(fila + 1, 1, filas.length, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(fila + 1, 4, filas.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(fila + 1, 6, filas.length, 1).setNumberFormat('@');
    sh.getRange(fila, 1, filas.length + 1, enc.length).createFilter();
  }
  sh.getRange(4, 1, Math.max(sh.getLastRow() - 3, 1), 11).setFontSize(9);
  [80, 120, 240, 95, 55, 100, 80, 220, 120, 220, 110].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
}

/**
 * Hoja oculta _PagosNoAplicados: vouchers del grupo que no se aplicaron (o
 * sobraron) a ninguna factura. La usa 🔎 Consulta para mostrarlos debajo del
 * estado de cuenta de cada cliente/proveedor.
 */
var ENC_NO_APLICADOS_ = ['Empresa', 'Tipo', 'RUC contraparte', 'Contraparte', 'Fecha', 'Operación', 'Banco', 'Monto voucher',
  'Sin aplicar', 'Moneda', 'Referencia escrita', 'Situación', 'Fuente'];

function escribirNoAplicados_(ss, res, cfg) {
  var sh = obtenerOCrearHoja_(ss, HOJA.NO_APLICADOS);
  sh.clear();
  var motivo = {};
  res.sinCruzar.forEach(function (s) { motivo[s.pago.id] = s.motivo; });
  var filas = [];
  function agregar(p, sinAplicar, moneda, situacion) {
    var enGrupo = function (r) { return r && cfg.grupo.indexOf(r) !== -1; };
    if (enGrupo(p.pagadorRuc)) {
      filas.push([nombreEmpresa_(cfg, p.pagadorRuc, ''), 'Por pagar', p.beneficiarioRuc || '', p.beneficiarioNombre || '', p.fecha || '',
        p.operacion || '', p.banco || '', p.monto, sinAplicar, moneda, p.refs || '', situacion, p.fuente]);
    }
    if (enGrupo(p.beneficiarioRuc)) {
      filas.push([nombreEmpresa_(cfg, p.beneficiarioRuc, ''), 'Por cobrar', p.pagadorRuc || '', '', p.fecha || '',
        p.operacion || '', p.banco || '', p.monto, sinAplicar, moneda, p.refs || '', situacion, p.fuente]);
    }
  }
  (res.pagos || []).forEach(function (p) {
    if (p.aplicado || p.sinFactura || p.modalidad !== MODALIDAD.PAGO) return;
    agregar(p, p.monto, p.moneda, p.sugerido ? '🟡 Hay sugerencia por confirmar en ✅ Conciliar' : (motivo[p.id] || 'Sin aplicar'));
  });
  (res.remanentes || []).forEach(function (r) {
    agregar(r.pago, r.monto, r.moneda, '⚠️ Sobra después de cancelar ' + r.docs);
  });
  sh.getRange(1, 1, 1, ENC_NO_APLICADOS_.length).setValues([ENC_NO_APLICADOS_]);
  if (filas.length) sh.getRange(2, 1, filas.length, ENC_NO_APLICADOS_.length).setValues(filas);
  sh.hideSheet();
}
