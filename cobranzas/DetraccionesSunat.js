/**
 * DetraccionesSunat.js
 * Lee (SOLO LECTURA) la hoja "Detracciones · Grupo" (depósitos de detracciones SPOT
 * descargados de SUNAT: Mis declaraciones y pagos → Consulta de Pago de Detracciones)
 * y convierte cada depósito en un descuento de modalidad "Detracción" para el motor:
 *  - Por pagar: lo que la empresa depositó en la cuenta del Banco de la Nación del
 *    proveedor baja el saldo de SU factura.
 *  - Por cobrar: lo que un cliente nos depositó baja el saldo de NUESTRA factura.
 * Así deja de verse "🟣 Falta detracción" en facturas cuya detracción ya se pagó, y
 * cada movimiento lleva el enlace a la constancia en PDF (si la hoja la copió a Drive).
 * Si la misma detracción ya está en ✍️ Registro manual, se usa la manual y se avisa.
 */

var ORIGEN_DETRACCION_SUNAT_ = '🏦 Detracción SUNAT';

/** Devuelve { pagos: [...], avisos: [...], filas: [...] } (vacío si no hay hoja configurada). */
function leerDetraccionesSunat_(cfg, manual) {
  var res = { pagos: [], avisos: [], filas: [] };
  if (!cfg.idDetracciones) return res;
  var sh;
  try {
    sh = SpreadsheetApp.openById(cfg.idDetracciones).getSheetByName('Detracciones');
  } catch (e) {
    res.avisos.push({ tipo: 'Detracciones SUNAT', detalle: 'No se pudo abrir la hoja de Detracciones (' + e.message + ')', fuente: 'Detracciones · Grupo' });
    return res;
  }
  if (!sh || sh.getLastRow() < 4) return res;
  var rango = sh.getRange(3, 1, sh.getLastRow() - 2, sh.getLastColumn());
  var v = rango.getValues();
  var col = indiceColumnas_(v[0]);
  var c = {
    empresa: col('RUC empresa'), fecha: col('Fecha de pago'), periodo: col('Periodo'), constancia: col('Constancia'),
    proveedor: col('RUC proveedor'), nomProv: col('Proveedor'), adq: col('RUC adquiriente'), nomAdq: col('Adquiriente'),
    ref: col('Ref. documento'), monto: col('Monto S/'), bien: col('Bien o servicio'), pdf: col('Constancia PDF'),
  };
  if (c.constancia < 0 || c.proveedor < 0 || c.adq < 0 || c.ref < 0 || c.monto < 0) {
    res.avisos.push({ tipo: 'Detracciones SUNAT', detalle: 'La pestaña Detracciones no tiene las columnas esperadas (actualice la hoja Detracciones · Grupo con 🔄)', fuente: 'Detracciones · Grupo' });
    return res;
  }
  // Enlace a la constancia en PDF (la columna "Constancia PDF" es un texto con enlace).
  var enlaces = [];
  if (c.pdf >= 0) {
    enlaces = sh.getRange(4, c.pdf + 1, v.length - 1, 1).getRichTextValues().map(function (r) {
      var url = r[0] && r[0].getLinkUrl();
      return url || '';
    });
  }

  // Detracciones ya registradas a mano (para no descontarlas dos veces).
  var manuales = {};
  (manual || []).forEach(function (m) {
    if (m.modalidad !== MODALIDAD.DETRACCION) return;
    parsearReferencias_(m.refs).refs.forEach(function (ref) {
      manuales[(m.beneficiarioRuc || '') + '|' + claveRef_(ref)] = true;
    });
  });

  var vistos = {};
  v.slice(1).forEach(function (r, i) {
    var constancia = String(r[c.constancia]).trim();
    var monto = aNumero_(r[c.monto]);
    if (!constancia || !(monto > 0)) return;
    // El mismo depósito aparece en las dos empresas cuando proveedor y cliente son del grupo.
    if (vistos[constancia]) return;
    vistos[constancia] = true;
    var adq = aRuc_(r[c.adq]), prov = aRuc_(r[c.proveedor]);
    var fila = {
      constancia: constancia, fecha: aFecha_(r[c.fecha]), periodo: c.periodo >= 0 ? String(r[c.periodo]) : '', monto: monto,
      adquirienteRuc: adq, adquiriente: c.nomAdq >= 0 ? String(r[c.nomAdq]) : '', proveedorRuc: prov,
      proveedor: c.nomProv >= 0 ? String(r[c.nomProv]) : '', documento: String(r[c.ref] || '').trim(),
      bien: c.bien >= 0 ? String(r[c.bien]) : '', pdf: enlaces[i] || '', fuente: 'Detracciones · Grupo · Detracciones!' + (i + 4),
    };
    res.filas.push(fila);
    var parse = parsearReferencias_(fila.documento);
    if (!parse.refs.length) {
      res.avisos.push({ tipo: 'Detracción sin comprobante', detalle: 'Constancia ' + constancia + ' (S/ ' + monto.toFixed(2) + ', ' + fila.proveedor + ') no indica a qué factura corresponde', fuente: fila.fuente });
      return;
    }
    if (manuales[prov + '|' + claveRef_(parse.refs[0])] || manuales['|' + claveRef_(parse.refs[0])]) {
      res.avisos.push({ tipo: 'Detracción duplicada', detalle: 'Constancia ' + constancia + ' (' + fila.documento + ') ya está en ✍️ Registro manual: se usó la manual. Puede borrar la fila manual, ahora llega sola de SUNAT.', fuente: 'Detracciones · Grupo' });
      return;
    }
    res.pagos.push({
      id: 'DET|' + constancia, fecha: fila.fecha, monto: monto, moneda: 'PEN',
      pagadorRuc: adq, beneficiarioRuc: prov, refs: fila.documento,
      operacion: 'Constancia ' + constancia, banco: 'Banco de la Nación', modalidad: MODALIDAD.DETRACCION,
      esManual: true, origen: ORIGEN_DETRACCION_SUNAT_,
      fuente: fila.fuente + (fila.pdf ? ' · ' + fila.pdf : ''),
    });
  });
  return res;
}
