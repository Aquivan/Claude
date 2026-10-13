/**
 * Consulta.js
 * Pestaña 🔎 Consulta: estado de cuenta por Empresa ⇄ Cliente/Proveedor.
 * Se redibuja al cambiar cualquier selector (onEdit) y en cada actualizacion.
 * Lee de 📋 Documentos y 💳 Movimientos (no vuelve a leer SIRE ni vouchers).
 */

var CONSULTA_ = { EMPRESA: 'B4', VER: 'D4', CONTRA: 'F4', MOSTRAR: 'J4', FILA_ENC: 9, LISTA_COL: 26 };
var TIPO_DOC_ = { '01': 'Factura', '03': 'Boleta', '07': 'Nota de crédito', '08': 'Nota de débito', '02': 'Recibo honorarios', '12': 'Ticket', '14': 'Servicio público' };

function onEdit(e) {
  try { CIA_alEditar_(e); } catch (err0) { /* pestaña 🤝 Conciliar con IA: no afecta a Consulta */ }
  try { RTN_alEditar_(e); } catch (err1) { /* filtros de 🧾 Retenciones */ }
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== HOJA.CONSULTA) return;
    var a1 = e.range.getA1Notation();
    if ([CONSULTA_.EMPRESA, CONSULTA_.VER, CONSULTA_.CONTRA, CONSULTA_.MOSTRAR].indexOf(a1) === -1) return;
    if (a1 === CONSULTA_.EMPRESA || a1 === CONSULTA_.VER) sh.getRange(CONSULTA_.CONTRA).setValue('(Todas)');
    renderConsulta_(e.source);
  } catch (err) {
    e.source.toast('No se pudo actualizar la consulta: ' + err.message, '🔎 Consulta', 6);
  }
}

function leerTablaHoja_(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return { enc: [], filas: [] };
  var v = sh.getDataRange().getValues();
  return { enc: v[0], filas: v.slice(1) };
}

function prepararSelectores_(sh, empresas) {
  if (sh.getRange('B3').getValue() === 'Empresa') return;
  sh.getRange('B1:M1').merge().setValue('🔎  CONSULTA · ESTADO DE CUENTA').setFontSize(15).setFontWeight('bold')
    .setFontColor('#F8FAFC').setBackground(COLOR.OSCURO).setVerticalAlignment('middle');
  sh.setRowHeight(1, 40);
  sh.getRange('B2:M2').merge().setValue('Elige empresa, si quieres ver lo que te deben (Por cobrar) o lo que debes (Por pagar), y el cliente/proveedor. ' +
    'Para ver la imagen de un voucher: menú 💼 Cobranzas → 🖼 Abrir visor de vouchers y haz clic en la fila del pago.')
    .setFontSize(9).setFontColor(COLOR.TEXTO_SUAVE).setWrap(true);
  sh.setRowHeight(2, 30);
  [['B3', 'Empresa'], ['D3', 'Ver'], ['F3', 'Cliente / Proveedor'], ['J3', 'Mostrar']].forEach(function (p) {
    sh.getRange(p[0]).setValue(p[1]).setFontSize(8).setFontWeight('bold').setFontColor(COLOR.TEXTO_SUAVE);
  });
  sh.getRange('F4:H4').merge();
  [CONSULTA_.EMPRESA, CONSULTA_.VER, 'F4:H4', CONSULTA_.MOSTRAR].forEach(function (a) {
    sh.getRange(a).setBackground('#FEF9C3').setFontWeight('bold').setBorder(true, true, true, true, false, false, '#EAB308', SpreadsheetApp.BorderStyle.SOLID);
  });
  sh.getRange(CONSULTA_.EMPRESA).setValue(empresas[0] || '(Todas)');
  sh.getRange(CONSULTA_.VER).setValue('Por pagar')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Por pagar', 'Por cobrar']).build());
  sh.getRange(CONSULTA_.CONTRA).setValue('(Todas)');
  sh.getRange(CONSULTA_.MOSTRAR).setValue('Con saldo');
  sh.setRowHeight(4, 26);
  sh.setColumnWidth(1, 16);
  [190, 80, 210, 165, 105, 80, 105, 105, 140, 80, 210, 110].forEach(function (w, i) { sh.setColumnWidth(i + 2, w); });
  sh.setFrozenRows(CONSULTA_.FILA_ENC);
}

function renderConsulta_(ss) {
  var sh = obtenerOCrearHoja_(ss, HOJA.CONSULTA);
  var D = leerTablaHoja_(ss, HOJA.DOCS), M = leerTablaHoja_(ss, HOJA.MOVS);
  var cd = indiceColumnas_(D.enc), cm = indiceColumnas_(M.enc);
  var empresas = [];
  D.filas.forEach(function (f) { if (empresas.indexOf(f[0]) === -1) empresas.push(f[0]); });
  empresas.sort();
  prepararSelectores_(sh, empresas);
  sh.getRange(CONSULTA_.EMPRESA).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['(Todas)'].concat(empresas)).build());

  var emp = sh.getRange(CONSULTA_.EMPRESA).getValue();
  var ver = sh.getRange(CONSULTA_.VER).getValue() || 'Por pagar';
  var contra = String(sh.getRange(CONSULTA_.CONTRA).getValue() || '(Todas)');
  var mostrar = sh.getRange(CONSULTA_.MOSTRAR).getValue() || 'Con saldo';
  sh.getRange(CONSULTA_.MOSTRAR).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Con saldo', 'Con nota de crédito', 'Todo']).build());

  var iRuc = cd('RUC contraparte'), iCp = cd('Contraparte'), iSaldo = cd('Saldo'), iEstado = cd('Estado'), iReg = cd('Registro SIRE');
  var base = D.filas.filter(function (f) { return (emp === '(Todas)' || f[0] === emp) && f[1] === ver; });

  // Lista de clientes/proveedores (columna oculta Z) para el desplegable
  var cps = {};
  base.forEach(function (f) {
    var k = f[iCp] + ' · ' + f[iRuc];
    cps[k] = (cps[k] || 0) + Math.max(0, Number(f[iSaldo]) || 0);
  });
  var lista = ['(Todas)'].concat(Object.keys(cps).sort(function (a, b) { return cps[b] - cps[a] || a.localeCompare(b); }));
  sh.getRange(1, CONSULTA_.LISTA_COL, sh.getMaxRows(), 1).clearContent();
  sh.getRange(1, CONSULTA_.LISTA_COL, lista.length, 1).setValues(lista.map(function (x) { return [x]; }));
  sh.getRange(CONSULTA_.CONTRA).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sh.getRange(1, CONSULTA_.LISTA_COL, lista.length, 1), true).setAllowInvalid(true).build());
  sh.hideColumns(CONSULTA_.LISTA_COL);

  var rucSel = contra === '(Todas)' ? '' : (contra.split(' · ').pop() || '');
  var iNc = cd('N/C');
  function conNc(f) { return Math.abs(Number(f[iNc]) || 0) > 0.005; }
  // Todos los documentos de la seleccion (para los totales) y los que se listan segun "Mostrar".
  var todos = base.filter(function (f) { return !rucSel || String(f[iRuc]) === rucSel; });
  function seMuestra(f) {
    if (mostrar === 'Con saldo') return Math.abs(Number(f[iSaldo]) || 0) > 0.10;
    if (mostrar === 'Con nota de crédito') return conNc(f);
    return true;
  }
  var docs = todos.filter(seMuestra).sort(function (a, b) { return String(a[iCp]).localeCompare(b[iCp]) || ((a[cd('Emisión')] || 0) - (b[cd('Emisión')] || 0)); });

  var movsPorClave = {};
  var mClave = cm('Clave');
  M.filas.forEach(function (m) { (movsPorClave[m[mClave]] = movsPorClave[m[mClave]] || []).push(m); });

  // ---- Resumen (siempre de TODOS los documentos de la seleccion, aunque el detalle este filtrado) ----
  var sum = { tot: 0, nc: 0, ret: 0, det: 0, pag: 0, saldo: 0 };
  todos.forEach(function (f) {
    sum.tot += Number(f[cd('Total')]) || 0; sum.nc += Number(f[cd('N/C')]) || 0; sum.ret += Number(f[cd('Retención')]) || 0;
    sum.det += Number(f[cd('Detracción')]) || 0; sum.pag += Number(f[cd('Pagado')]) || 0; sum.saldo += Number(f[iSaldo]) || 0;
  });
  var limpiar = sh.getRange(6, 2, Math.max(sh.getMaxRows() - 5, 1), 12);
  limpiar.breakApart(); limpiar.clear();
  var tarjetas = [['FACTURADO', sum.tot], ['NOTAS DE CRÉDITO', sum.nc], ['RETENCIONES', sum.ret], ['DETRACCIONES', sum.det], ['PAGADO', sum.pag], ['SALDO', sum.saldo]];
  tarjetas.forEach(function (t, i) {
    var c = 2 + i * 2;
    var fuerte = i === 5;
    sh.getRange(6, c, 1, 2).merge().setValue(t[0]).setFontSize(8).setFontWeight('bold').setHorizontalAlignment('center')
      .setFontColor(fuerte ? '#FFFFFF' : COLOR.AZUL).setBackground(fuerte ? '#B91C1C' : '#E0E7FF');
    sh.getRange(7, c, 1, 2).merge().setValue(t[1]).setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center')
      .setNumberFormat('#,##0.00').setFontColor(fuerte ? '#FFFFFF' : COLOR.AZUL).setBackground(fuerte ? '#B91C1C' : '#E0E7FF');
  });
  sh.setRowHeight(7, 30);
  var ocultos = todos.length - docs.length;
  if (ocultos > 0) {
    var ocultosNc = todos.filter(function (f) { return !seMuestra(f) && conNc(f); }).length;
    sh.getRange(8, 2, 1, 12).merge().setValue('ℹ️ Totales de los ' + todos.length + ' documentos. En el detalle se ocultan ' + ocultos +
      (mostrar === 'Con saldo' ? ' ya cancelados' : '') + (ocultosNc ? ' (' + ocultosNc + ' con nota de crédito)' : '') +
      '. Para verlos, cambia "Mostrar" a "Todo" o "Con nota de crédito".').setFontSize(8).setFontColor(COLOR.TEXTO_SUAVE);
  }

  // ---- Detalle ----
  var enc = ['Documento / Movimiento', 'Fecha', 'Cliente / Proveedor', 'Concepto', 'Operación', 'Banco', 'Importe', 'Saldo', 'Estado / Origen', 'Vence', 'Detalle', 'Fuente'];
  var filas = [], fondos = [], negritas = [];
  var LIMITE = 4000, cpActual = null;
  for (var i = 0; i < docs.length && filas.length < LIMITE; i++) {
    var f = docs[i];
    if (!rucSel && f[iCp] !== cpActual) {
      cpActual = f[iCp];
      var sub = docs.filter(function (x) { return x[iCp] === cpActual; }).reduce(function (t, x) { return t + (Number(x[iSaldo]) || 0); }, 0);
      filas.push(['▸ ' + cpActual + '  (' + f[iRuc] + ')', '', '', '', '', '', '', sub, '', '', '', '']);
      fondos.push(COLOR.AZUL); negritas.push(true);
    }
    var doc = String(f[cd('Documento')]);
    var tipoNom = TIPO_DOC_[doc.slice(0, 2)] || 'Documento';
    var regSire = iReg >= 0 ? String(f[iReg] || '') : '';
    if (regSire) tipoNom += ' · ' + regSire;
    filas.push([doc, f[cd('Emisión')], f[iCp], tipoNom, '', '', f[cd('Total')], f[iSaldo], f[iEstado], f[cd('Vence')], String(f[cd('Producto')] || '').slice(0, 80), '']);
    fondos.push(COLOR_ESTADO[f[iEstado]] || COLOR.BLANCO); negritas.push(true);
    (movsPorClave[f[cd('Clave')]] || []).sort(function (a, b) { return (a[0] || 0) - (b[0] || 0); }).forEach(function (m) {
      var mod = m[cm('Modalidad')];
      var etiqueta = mod === MODALIDAD.NC ? 'Nota de crédito ' + m[cm('N° operación')] : mod === MODALIDAD.ND ? 'Nota de débito ' + m[cm('N° operación')] : mod;
      filas.push(['      └ ' + etiqueta, m[cm('Fecha')], '', mod, String(m[cm('N° operación')]), m[cm('Banco')],
        -Number(m[cm('Monto aplicado')]), '', origenConsulta_(m[cm('Origen')]), '', m[cm('Nota')], m[cm('Fuente')]]);
      fondos.push(COLOR.BLANCO); negritas.push(false);
    });
  }
  escribirTabla_(sh, CONSULTA_.FILA_ENC, 2, enc, filas);
  if (filas.length) {
    var r0 = CONSULTA_.FILA_ENC + 1, n = filas.length;
    sh.getRange(r0, 2, n, enc.length).setBackgrounds(fondos.map(function (c) { return enc.map(function () { return c; }); }))
      .setFontWeights(negritas.map(function (b) { return enc.map(function () { return b ? 'bold' : 'normal'; }); }))
      .setFontSize(9).setVerticalAlignment('middle');
    sh.getRange(r0, 3, n, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(r0, 11, n, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(r0, 8, n, 2).setNumberFormat('#,##0.00;-#,##0.00;"-"');
    sh.getRange(r0, 6, n, 1).setNumberFormat('@');
    var colores = fondos.map(function (c) { return enc.map(function () { return c === COLOR.AZUL ? '#FFFFFF' : '#0F172A'; }); });
    sh.getRange(r0, 2, n, enc.length).setFontColors(colores);
  }
  if (docs.length && filas.length >= LIMITE) {
    sh.getRange(CONSULTA_.FILA_ENC + filas.length + 2, 2).setValue('… se muestran las primeras ' + LIMITE + ' filas. Elige un cliente/proveedor para ver el detalle completo.')
      .setFontColor(COLOR.TEXTO_SUAVE);
  }
  if (!docs.length) {
    sh.getRange(CONSULTA_.FILA_ENC + 1, 2).setValue('Sin documentos para esta selección.').setFontColor(COLOR.TEXTO_SUAVE);
  }

  // ---- Vouchers de esta seleccion que no se aplicaron a ninguna factura ----
  var fila = CONSULTA_.FILA_ENC + Math.max(filas.length, 1) + 3;
  var NA = leerTablaHoja_(ss, HOJA.NO_APLICADOS), cn = indiceColumnas_(NA.enc);
  var nombreSel = rucSel ? contra.split(' · ')[0] : '';
  var noAp = NA.filas.filter(function (r) {
    if ((emp !== '(Todas)' && r[0] !== emp) || r[1] !== ver) return false;
    if (!rucSel) return true;
    var ruc = String(r[cn('RUC contraparte')] || '');
    if (ruc) return ruc === rucSel;
    return !!nombreSel && nombreParecido_(r[cn('Contraparte')], nombreSel);
  }).sort(function (a, b) { return (b[cn('Fecha')] || 0) - (a[cn('Fecha')] || 0); });
  var totNoAp = noAp.reduce(function (t, r) { return t + (Number(r[cn('Sin aplicar')]) || 0); }, 0);
  sh.getRange(fila, 2, 1, 12).merge().setValue('💳 VOUCHERS DE ESTA SELECCIÓN QUE NO SE APLICARON A NINGUNA FACTURA (' + noAp.length + ')' +
    (noAp.length ? ' · sin aplicar: ' + totNoAp.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''))
    .setFontWeight('bold').setFontSize(10).setFontColor('#92400E').setBackground('#FEF3C7');
  fila++;
  if (noAp.length) {
    var filasNa = noAp.slice(0, 500).map(function (r) {
      return [r[cn('Fecha')], String(r[cn('Operación')]), r[cn('Banco')], r[cn('Contraparte')] || r[cn('RUC contraparte')], r[cn('Monto voucher')],
        r[cn('Sin aplicar')], r[cn('Moneda')], r[cn('Referencia escrita')], r[cn('Situación')], r[cn('Fuente')]];
    });
    escribirTabla_(sh, fila, 2, ['Fecha', 'Operación', 'Banco', 'Beneficiario / Cliente', 'Monto voucher', 'Sin aplicar', 'Moneda',
      'Factura escrita en el voucher', 'Por qué no se aplicó', 'Fuente'], filasNa);
    var nNa = filasNa.length;
    sh.getRange(fila + 1, 2, nNa, 10).setFontSize(9).setVerticalAlignment('middle');
    sh.getRange(fila + 1, 2, nNa, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(fila + 1, 3, nNa, 1).setNumberFormat('@');
    sh.getRange(fila + 1, 6, nNa, 2).setNumberFormat('#,##0.00');
    fila += nNa + 1;
  } else {
    sh.getRange(fila, 2).setValue('Ninguno: todos los vouchers de esta selección están aplicados a facturas.').setFontColor(COLOR.TEXTO_SUAVE).setFontSize(9);
    fila++;
  }
  // ---- Todos los vouchers de esta selección (aplicados o no), para compararlos con el Sistema de Vouchers ----
  fila = escribirTodosLosVouchers_(sh, fila + 1, todos, movsPorClave, cd, cm, noAp, cn);
  sh.getRange(fila + 1, 2, 1, 12).merge().setValue('Origen de cada pago: 🟢 Referenciado en voucher = la factura está escrita en "Tipo y Nº Doc." · ' +
    '🔵 Exacto · sin ref. = el sistema lo cruzó solo por monto (no está escrita en el voucher) · 🟡 Confirmado con ✔ = sugerencia que aprobaste · ' +
    '✍️ Manual = Registro manual · 📄 N/C SIRE = nota de crédito').setFontSize(8).setFontColor(COLOR.TEXTO_SUAVE).setWrap(true);
  sh.setRowHeight(fila + 1, 28);
}

// Como se muestra el origen de cada pago en la Consulta (mas claro que en Movimientos).
// Funcion (no variable global) porque ORIGEN se define en otro archivo.
function origenConsulta_(o) {
  if (o === ORIGEN.REFERENCIADO) return '🟢 Referenciado en voucher';
  if (o === ORIGEN.EXACTO) return '🔵 Exacto · sin ref.';
  if (o === ORIGEN.CONFIRMADO) return '🟡 Confirmado con ✔';
  return o;
}

/**
 * Lista en la Consulta TODOS los vouchers de la selección: los aplicados a
 * facturas (de Movimientos) y los que no se aplicaron o sobraron (No aplicados).
 * Un voucher = una fila (se junta por su fuente, ej. "Originales!1827").
 * Devuelve la fila siguiente libre.
 */
function escribirTodosLosVouchers_(sh, fila, todos, movsPorClave, cd, cm, noAp, cn) {
  var vou = {}, orden = [];
  var tomar = function (clave, base) {
    if (!vou[clave]) { vou[clave] = base; orden.push(clave); }
    return vou[clave];
  };
  todos.forEach(function (f) {
    (movsPorClave[f[cd('Clave')]] || []).forEach(function (m) {
      if (m[cm('Modalidad')] !== MODALIDAD.PAGO) return;
      var clave = String(m[cm('Fuente')] || m[cm('ID pago')] || '');
      if (!clave) return;
      var v = tomar(clave, { fecha: m[cm('Fecha')], op: String(m[cm('N° operación')] || ''), banco: m[cm('Banco')], monto: m[cm('Monto del voucher')],
        aplicado: 0, sinAplicar: 0, moneda: m[cm('Moneda')], docs: [], fuente: m[cm('Fuente')], situacion: '' });
      v.aplicado += Number(m[cm('Monto aplicado')]) || 0;
      var doc = String(f[cd('Documento')]);
      if (v.docs.indexOf(doc) < 0) v.docs.push(doc);
    });
  });
  noAp.forEach(function (r) {
    var clave = String(r[cn('Fuente')] || '');
    if (!clave) return;
    var v = tomar(clave, { fecha: r[cn('Fecha')], op: String(r[cn('Operación')] || ''), banco: r[cn('Banco')], monto: r[cn('Monto voucher')],
      aplicado: 0, sinAplicar: 0, moneda: r[cn('Moneda')], docs: [], fuente: r[cn('Fuente')], situacion: '' });
    v.sinAplicar += Number(r[cn('Sin aplicar')]) || 0;
    v.situacion = String(r[cn('Situación')] || '');
  });
  var lista = orden.map(function (k) { return vou[k]; })
    .sort(function (a, b) { return (b.fecha instanceof Date ? b.fecha : 0) - (a.fecha instanceof Date ? a.fecha : 0); });
  var total = lista.reduce(function (t, v) { return t + (Number(v.monto) || 0); }, 0);
  var fmt = function (n) { return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  sh.getRange(fila, 2, 1, 12).merge().setValue('📒 TODOS LOS VOUCHERS DE ESTA SELECCIÓN (' + lista.length + ')' +
    (lista.length ? ' · total vouchers: ' + fmt(total) : '') + ' · aplicados y sin aplicar, para cuadrar con el Sistema de Vouchers')
    .setFontWeight('bold').setFontSize(10).setFontColor('#1E3A8A').setBackground('#DBEAFE');
  fila++;
  if (!lista.length) {
    sh.getRange(fila, 2).setValue('Ningún voucher para esta selección.').setFontColor(COLOR.TEXTO_SUAVE).setFontSize(9);
    return fila + 1;
  }
  var filas = lista.slice(0, 500).map(function (v) {
    var estado = !v.aplicado ? '❌ Sin aplicar' : v.sinAplicar > 0.05 ? '🟠 Aplicado en parte' : '✅ Aplicado';
    var porQue = v.sinAplicar > 0.05 ? v.situacion : '';
    return [v.fecha || '', v.op, v.banco, v.monto, v.aplicado ? r2_(v.aplicado) : '', v.sinAplicar ? r2_(v.sinAplicar) : '', v.moneda,
      v.docs.join(', '), estado, porQue, v.fuente];
  });
  escribirTabla_(sh, fila, 2, ['Fecha', 'Operación', 'Banco', 'Monto voucher', 'Aplicado a facturas', 'Sin aplicar', 'Moneda',
    'Facturas a las que se aplicó', 'Estado', 'Por qué sobra', 'Fuente'], filas);
  var n = filas.length;
  sh.getRange(fila + 1, 2, n, 11).setFontSize(9).setVerticalAlignment('middle');
  sh.getRange(fila + 1, 2, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(fila + 1, 3, n, 1).setNumberFormat('@');
  sh.getRange(fila + 1, 5, n, 3).setNumberFormat('#,##0.00;-#,##0.00;"-"');
  sh.getRange(fila + 1, 10, n, 1).setBackgrounds(filas.map(function (r) {
    return [/^✅/.test(r[8]) ? '#DCFCE7' : /^🟠/.test(r[8]) ? '#FFEDD5' : '#FEE2E2'];
  }));
  return fila + n + 1;
}
