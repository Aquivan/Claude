/**
 * RetencionesSunat.js
 * Lee (SOLO LECTURA) la hoja "Retenciones · Grupo" (comprobantes de retención
 * descargados de SUNAT) y convierte cada factura retenida en un descuento de
 * modalidad "Retención" para el motor de cruce:
 *  - Por cobrar: lo que un cliente nos retuvo baja el saldo de NUESTRA factura.
 *  - Por pagar: lo que retuvimos a un proveedor baja el saldo de SU factura.
 * No se usan los comprobantes REVERTIDOS ni las notas de crédito incluidas en
 * un comprobante (no tienen retención). Si la misma retención ya está en
 * ✍️ Registro manual, se usa la manual y se avisa (no se descuenta dos veces).
 */

var ORIGEN_RETENCION_SUNAT_ = '🧾 Retención SUNAT';

var TIPO_DOC_RETENCION_ = { 'factura': '01', 'boleta': '03', 'boleta de venta': '03', 'nota de debito': '08' };

/** Devuelve { pagos: [...], avisos: [...], actualizado: ms } o vacío si no hay hoja configurada. */
function leerRetencionesSunat_(cfg, manual) {
  var res = { pagos: [], avisos: [], actualizado: 0 };
  if (!cfg.idRetenciones) return res;
  var ss;
  try {
    ss = SpreadsheetApp.openById(cfg.idRetenciones);
    res.actualizado = DriveApp.getFileById(cfg.idRetenciones).getLastUpdated().getTime();
  } catch (e) {
    res.avisos.push({ tipo: 'Retenciones SUNAT', detalle: 'No se pudo abrir la hoja de Retenciones (' + e.message + ')', fuente: 'Retenciones · Grupo' });
    return res;
  }

  // Estado de cada comprobante (EMITIDO / REVERTIDO), por RUC del agente + número.
  var estados = {};
  [['Emitidas', 'RUC empresa'], ['Recibidas', 'RUC agente']].forEach(function (par) {
    var sh = ss.getSheetByName(par[0]);
    if (!sh || sh.getLastRow() < 4) return;
    var v = sh.getRange(3, 1, sh.getLastRow() - 2, sh.getLastColumn()).getValues();
    var col = indiceColumnas_(v[0]);
    var iAg = col(par[1]), iCre = col('Comprobante'), iEst = col('Estado');
    if (iAg < 0 || iCre < 0 || iEst < 0) return;
    v.slice(1).forEach(function (r) { estados[aRuc_(r[iAg]) + '|' + String(r[iCre]).trim()] = String(r[iEst]).toUpperCase(); });
  });

  var sh = ss.getSheetByName('Detalle');
  if (!sh || sh.getLastRow() < 4) return res;
  var v = sh.getRange(3, 1, sh.getLastRow() - 2, sh.getLastColumn()).getValues();
  var col = indiceColumnas_(v[0]);
  var c = {
    cre: col('Comprobante retención'), fecha: col('Fecha retención'), agente: col('RUC agente'),
    proveedor: col('RUC proveedor'), tipo: col('Tipo doc.'), doc: col('N° documento'), moneda: col('Moneda doc.'),
    tc: col('Tipo de cambio'), retenido: col('Retenido S/'),
  };
  if (c.cre < 0 || c.doc < 0 || c.retenido < 0 || c.agente < 0 || c.proveedor < 0) {
    res.avisos.push({ tipo: 'Retenciones SUNAT', detalle: 'La pestaña Detalle no tiene las columnas esperadas', fuente: 'Retenciones · Grupo' });
    return res;
  }

  // Retenciones ya registradas a mano (para no descontarlas dos veces).
  var manuales = {};
  (manual || []).forEach(function (m) {
    if (m.modalidad !== MODALIDAD.RETENCION) return;
    parsearReferencias_(m.refs).refs.forEach(function (ref) {
      manuales[(m.beneficiarioRuc || '') + '|' + claveRef_(ref)] = true;
    });
  });

  var vistos = {};
  v.slice(1).forEach(function (r, i) {
    var retenido = aNumero_(r[c.retenido]);
    if (!retenido || retenido <= 0) return;  // notas de crédito dentro del comprobante
    var agente = aRuc_(r[c.agente]), proveedor = aRuc_(r[c.proveedor]);
    var cre = String(r[c.cre]).trim();
    if (/REVERT/.test(estados[agente + '|' + cre] || '')) return;
    var tipoTxt = normHeader_(r[c.tipo]);
    var tipo = /^\d{1,2}$/.test(tipoTxt) ? normTipo_(tipoTxt) : (TIPO_DOC_RETENCION_[tipoTxt] || '01');
    var doc = String(r[c.doc]).toUpperCase().replace(/\s+/g, '');
    var ref = tipo + '_' + doc;
    var parse = parsearReferencias_(ref);
    if (!parse.refs.length) return;
    // La misma retención aparece en las dos empresas cuando ambas son del grupo.
    var clave = agente + '|' + cre + '|' + claveRef_(parse.refs[0]);
    if (vistos[clave]) return;
    vistos[clave] = true;
    if (manuales[proveedor + '|' + claveRef_(parse.refs[0])] || manuales['|' + claveRef_(parse.refs[0])]) {
      res.avisos.push({ tipo: 'Retención duplicada', detalle: cre + ' (' + ref + ') ya está en ✍️ Registro manual: se usó la manual. Puede borrar la fila manual, ahora llega sola de SUNAT.', fuente: 'Retenciones · Grupo' });
      return;
    }
    var moneda = String(c.moneda >= 0 ? r[c.moneda] : 'PEN').toUpperCase() || 'PEN';
    var tc = c.tc >= 0 ? aNumero_(r[c.tc]) : 0;
    var monto = retenido, monedaPago = 'PEN';
    if (moneda === 'USD' && tc > 1) { monto = Math.round(retenido / tc * 100) / 100; monedaPago = 'USD'; }
    res.pagos.push({
      id: 'CRE|' + agente + '|' + cre + '|' + doc,
      fecha: aFecha_(r[c.fecha]), monto: monto, moneda: monedaPago,
      pagadorRuc: agente, beneficiarioRuc: proveedor, refs: ref,
      operacion: 'CRE ' + cre, banco: '', modalidad: MODALIDAD.RETENCION,
      esManual: true, origen: ORIGEN_RETENCION_SUNAT_, cre: cre.replace(/^([A-Z0-9]{4})-0*(\d+)$/, function (a, s1, n1) { return s1 + '-' + parseInt(n1, 10); }),
      refClave: claveRef_(parse.refs[0]), montoSoles: retenido,
      fuente: 'Retenciones · Grupo · Detalle!' + (i + 4),
    });
  });
  return res;
}

function claveRef_(ref) { return ref.tipo + '|' + ref.serie + '|' + ref.numero; }

/* ===================== Reasignar retenciones =====================
 * Cuando una factura con retención luego se anula (toda o en parte) con N/C,
 * la retención puede pasarse a otra(s) factura(s). Se indica en la hoja
 * 🔁 Reasignar retenciones; a la derecha el sistema sugiere los casos.
 */
var HOJA_REASIGNAR_ = '🔁 Reasignar retenciones';
var ORIGEN_RETENCION_REASIGNADA_ = '🔁 Retención reasignada';
var ENC_REASIGNAR_ = ['Comprobante de retención (ej. E001-123)', 'RUC agente (quien retuvo; opcional)',
  'Factura original (ej. 01_FN01-19)', 'Pasar a factura(s) (ej. 01_FN01-25 o 01_FN01-25,26)',
  'Monto S/ (vacío = toda la retención; o ponga el Exceso sugerido para que la factura quede en cero)', 'Observación', 'Resultado (lo llena el sistema)'];
var ENC_SUGERIDAS_ = ['Empresa', 'Tipo', 'Factura', 'RUC contraparte', 'Moneda', 'Total', 'N/C', 'Base (Total − N/C)',
  'Retención correcta (3%)', 'Retención aplicada', 'Exceso a reasignar', 'Comprobante(s) de retención', 'RUC agente', 'Saldo actual'];

function hojaReasignar_(ss) {
  var sh = ss.getSheetByName(HOJA_REASIGNAR_);
  if (sh) return sh;
  sh = ss.insertSheet(HOJA_REASIGNAR_);
  sh.getRange('A1').setValue('🔁 REASIGNAR RETENCIONES (pasar una retención a otra factura)').setFontWeight('bold').setFontSize(12);
  sh.getRange('A2').setValue('Úselo cuando la factura retenida se anuló (toda o en parte) con nota de crédito y usted decide aplicar esa retención a otra factura. ' +
    'Llene una fila por caso; se aplica al actualizar. Para deshacer, borre la fila.').setFontColor(COLOR.TEXTO_SUAVE).setWrap(true);
  sh.getRange('A2:G2').merge();
  sh.getRange(3, 1, 1, ENC_REASIGNAR_.length).setValues([ENC_REASIGNAR_]).setFontWeight('bold')
    .setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  sh.getRange('A4:D500').setNumberFormat('@');
  sh.getRange('E4:E500').setNumberFormat('#,##0.00');
  sh.getRange('G4:G500').setFontColor(COLOR.TEXTO_SUAVE);
  [150, 130, 150, 220, 150, 220, 300].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setRowHeight(2, 36); sh.setRowHeight(3, 48);
  sh.setFrozenRows(3);
  return sh;
}

/** Lee las filas de reasignación. */
function leerReasignaciones_(ss) {
  var sh = hojaReasignar_(ss);
  if (sh.getLastRow() < 4) return [];
  var res = [];
  sh.getRange(4, 1, sh.getLastRow() - 3, 5).getValues().forEach(function (r, i) {
    var cre = String(r[0] || '').toUpperCase().replace(/\s+/g, '');
    if (!cre && !r[2] && !r[3]) return;
    var mc = cre.match(/^([A-Z0-9]{4})-0*(\d+)$/);
    res.push({
      fila: i + 4, creTexto: cre, cre: mc ? mc[1] + '-' + parseInt(mc[2], 10) : '', agente: aRuc_(r[1]),
      origen: parsearReferencias_(String(r[2] || '')).refs[0] || null,
      destino: String(r[3] || '').trim(), monto: aNumero_(r[4]),
    });
  });
  return res;
}

/**
 * Aplica las reasignaciones a los descuentos de retención de SUNAT:
 * quita el monto de la factura original y crea un descuento nuevo hacia la(s)
 * factura(s) indicada(s). Escribe el resultado de cada fila.
 */
function aplicarReasignaciones_(ss, ret) {
  var lista = leerReasignaciones_(ss);
  if (!lista.length) return;
  var sh = ss.getSheetByName(HOJA_REASIGNAR_);
  var resultados = {};
  lista.forEach(function (x) {
    var msg;
    if (!x.cre || !x.origen || !x.destino) {
      msg = '⚠️ Falta dato: comprobante de retención, factura original y factura(s) destino.';
    } else if (!parsearReferencias_(x.destino).refs.length) {
      msg = '⚠️ No se entiende la factura destino. Escriba por ejemplo 01_FN01-25';
    } else {
      var p = ret.pagos.filter(function (q) {
        return q.cre === x.cre && (!x.agente || q.pagadorRuc === x.agente) && q.refClave === claveRef_(x.origen);
      })[0];
      if (!p) {
        msg = '⚠️ No se encontró la retención ' + x.creTexto + ' sobre ' + x.origen.texto + ' en la hoja de Retenciones (¿revertida o ya reasignada?).';
      } else {
        var montoSoles = x.monto > 0 ? Math.min(x.monto, p.montoSoles) : p.montoSoles;
        var frac = p.montoSoles ? montoSoles / p.montoSoles : 1;
        var mover = Math.round(p.monto * frac * 100) / 100;
        p.monto = Math.round((p.monto - mover) * 100) / 100;
        p.montoSoles = Math.round((p.montoSoles - montoSoles) * 100) / 100;
        ret.pagos.push({
          id: 'REASIG|' + x.fila + '|' + p.id, fecha: p.fecha, monto: mover, moneda: p.moneda,
          pagadorRuc: p.pagadorRuc, beneficiarioRuc: p.beneficiarioRuc, refs: x.destino,
          operacion: 'CRE ' + p.cre + ' (antes ' + x.origen.texto + ')', banco: '', modalidad: MODALIDAD.RETENCION,
          esManual: true, origen: ORIGEN_RETENCION_REASIGNADA_, cre: p.cre, refClave: '', montoSoles: montoSoles,
          fuente: HOJA_REASIGNAR_ + '!' + x.fila,
        });
        msg = '✅ S/ ' + montoSoles.toFixed(2) + ' de ' + p.cre + ' pasan de ' + x.origen.texto + ' a ' + x.destino +
          (p.montoSoles > 0.005 ? ' (quedan S/ ' + p.montoSoles.toFixed(2) + ' en la original)' : '');
      }
    }
    if (msg.indexOf('⚠️') === 0) ret.avisos.push({ tipo: 'Reasignar retención', detalle: 'Fila ' + x.fila + ': ' + msg.slice(3), fuente: HOJA_REASIGNAR_ });
    resultados[x.fila] = msg;
  });
  ret.pagos = ret.pagos.filter(function (q) { return q.monto > 0.005; });
  var n = sh.getLastRow() - 3;
  if (n > 0) {
    var col = [];
    for (var f = 4; f < 4 + n; f++) col.push([resultados[f] || '']);
    sh.getRange(4, 7, n, 1).setValues(col);
  }
}

/**
 * A la derecha de 🔁 Reasignar retenciones: facturas cuya retención es mayor al
 * 3% de su base (Total − N/C + N/D). Pasa cuando la factura se anuló toda o en
 * parte con nota de crédito después de retenerla. El exceso se puede reasignar.
 */
function escribirSugeridasReasignar_(ss, res, cfg) {
  var sh = hojaReasignar_(ss);
  var c0 = 9;
  sh.getRange(1, c0, Math.max(sh.getMaxRows(), 4), ENC_SUGERIDAS_.length).clearContent();
  sh.getRange(1, c0).setValue('💡 SUGERIDAS: facturas con retención mayor al 3% de (Total − N/C)').setFontWeight('bold').setFontSize(12);
  sh.getRange(2, c0).setValue('Copie el caso a la izquierda: comprobante de retención, factura, a qué factura pasarlo y el monto ' +
    '(el "Exceso a reasignar", o una parte). Se actualiza solo.').setFontColor(COLOR.TEXTO_SUAVE);
  sh.getRange(3, c0, 1, ENC_SUGERIDAS_.length).setValues([ENC_SUGERIDAS_]).setFontWeight('bold')
    .setFontColor(COLOR.BLANCO).setBackground('#7C3AED').setWrap(true).setVerticalAlignment('middle');
  var filas = [];
  res.docs.forEach(function (d) {
    if (d.tipo === '07' || d.tipo === '08') return;
    var movsRet = d.movs.filter(function (m) { return m.origen === ORIGEN_RETENCION_SUNAT_; });
    if (!movsRet.length) return;
    var retSunat = movsRet.reduce(function (s, m) { return s + m.monto; }, 0);
    var base = Math.max(0, d.total + d.nd - d.nc);
    var debida = redondear2_(base * TASA_RETENCION_);
    var exceso = redondear2_(Math.min(d.retencion - debida, retSunat));
    if (exceso <= 0.05) return;
    var esCobrar = cfg.grupo.indexOf(d.emisorRuc) !== -1;
    var empresaRuc = esCobrar ? d.emisorRuc : d.receptorRuc;
    var cres = movsRet.map(function (m) { return String(m.operacion).replace(/^CRE /, ''); })
      .filter(function (x, k, a) { return a.indexOf(x) === k; });
    filas.push([nombreEmpresa_(cfg, empresaRuc, ''), esCobrar ? 'Por cobrar' : 'Por pagar', etiquetaDoc_(d),
      esCobrar ? d.receptorRuc : d.emisorRuc, d.moneda, d.total, d.nc - d.nd, redondear2_(base), debida,
      redondear2_(d.retencion), exceso, cres.join(', '), d.receptorRuc, redondear2_(d.saldo)]);
  });
  filas.sort(function (a, b) { return b[10] - a[10]; });
  if (filas.length) {
    sh.getRange(4, c0, filas.length, ENC_SUGERIDAS_.length).setValues(filas);
    sh.getRange(4, c0 + 5, filas.length, 6).setNumberFormat('#,##0.00');
    sh.getRange(4, c0 + 13, filas.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(4, c0 + 10, filas.length, 1).setFontWeight('bold').setFontColor('#7C3AED');
  } else {
    sh.getRange(4, c0).setValue('Sin casos por ahora ✓ (todas las retenciones cuadran con el 3%)');
  }
  [130, 85, 115, 105, 60, 95, 95, 105, 100, 100, 105, 150, 105, 95].forEach(function (w, i) { sh.setColumnWidth(c0 + i, w); });
  return filas.length;
}
