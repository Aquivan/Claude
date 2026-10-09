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
      esManual: true, origen: ORIGEN_RETENCION_SUNAT_,
      fuente: 'Retenciones · Grupo · Detalle!' + (i + 4),
    });
  });
  return res;
}

function claveRef_(ref) { return ref.tipo + '|' + ref.serie + '|' + ref.numero; }
