/**
 * LiquidacionRetenciones.gs
 * «Retenciones del mes» de la liquidacion de IGV, AUTOMATICAS desde el proyecto
 * de Retenciones (retenciones/datos/<RUC>/<anio>/<mes>/cre.csv en GitHub).
 *
 * Solo cuentan los CRE RECIBIDOS (un cliente agente de retencion le retuvo IGV a
 * la empresa): ese monto se aplica contra el IGV del periodo. Los CRE EMITIDOS
 * (la empresa retuvo a sus proveedores) son una deuda que se declara y paga
 * aparte, no rebajan el IGV propio: no se suman aqui.
 *
 * Un CRE REVERTIDO (anulado ante SUNAT) se lista pero NO cuenta.
 * Se suma por la columna "Periodo" del CRE (periodo en que se emitio la
 * retencion), igual que lo informa SUNAT.
 */

var HOJA_RETENCIONES_ = 'Retenciones recibidas';
var ENCABEZADO_RETENCIONES_ = ['Periodo', 'Fecha emision', 'Comprobante', 'RUC agente', 'Agente de retencion',
  'Importe retenido S/', 'Importe pagado', 'Moneda', 'Estado', 'Cuenta en la liquidacion', 'Facturas', 'Observacion'];

/** CRE recibidos de la empresa en el anio (los 12 meses). [] si el proyecto de Retenciones aun no tiene datos. */
function leerRetencionesRecibidas_(cfg, ruc, anio) {
  var filas = [];
  for (var m = 1; m <= 12; m++) {
    var mm = ('0' + m).slice(-2);
    var txt = null;
    try { txt = leerArchivoTextoGitHub_(cfg, 'retenciones/datos/' + ruc + '/' + anio + '/' + mm + '/cre.csv'); }
    catch (e) { Logger.log('Retenciones ' + anio + mm + ': ' + e.message); }
    if (!txt) continue;
    var v = Utilities.parseCsv(txt.replace(/^﻿/, ''));
    if (v.length < 2) continue;
    var h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
    var c = function (n) { return h.indexOf(n); };
    v.slice(1).forEach(function (f) {
      if (String(f[c('tipo')] || '').trim().toLowerCase() !== 'recibido') return;
      if (String(f[c('empresa_ruc')] || ruc).trim() !== String(ruc)) return;
      var estado = String(f[c('estado')] || '').trim().toUpperCase();
      var cuenta = /REVERT|ANUL|BAJA/.test(estado) ? 'NO' : 'SI';
      filas.push([
        String(f[c('periodo')] || (anio + mm)).trim(),
        String(f[c('fecha_emision')] || '').trim(),
        String(f[c('comprobante')] || '').trim(),
        String(f[c('ruc_agente')] || '').trim(),
        String(f[c('agente')] || '').trim(),
        Number(String(f[c('importe_retenido')] || '0').replace(/,/g, '')) || 0,
        Number(String(f[c('importe_pagado')] || '0').replace(/,/g, '')) || 0,
        String(f[c('moneda')] || 'PEN').trim(),
        estado,
        cuenta,
        String(f[c('facturas')] || '').trim(),
        String(f[c('observacion')] || '').trim()
      ]);
    });
  }
  filas.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[2]).localeCompare(String(b[2])); });
  return filas;
}

/** Pestaña "Retenciones recibidas" de la liquidacion (la usa la formula de «Retenciones del mes»). */
function escribirRetenciones_(ss, filas) {
  var sh = obtenerOCrearHoja_(ss, HOJA_RETENCIONES_);
  sh.clearContents();
  sh.clearFormats();
  var n = ENCABEZADO_RETENCIONES_.length;
  sh.getRange(1, 1, 1, n).setValues([ENCABEZADO_RETENCIONES_])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#B45F06').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  if (filas.length) {
    sh.getRange(2, 1, filas.length, n).setValues(filas);
    sh.getRange(2, 1, filas.length, 1).setNumberFormat('@');
    sh.getRange(2, 6, filas.length, 2).setNumberFormat('#,##0.00');
    filas.forEach(function (f, i) {
      if (f[9] === 'NO') sh.getRange(i + 2, 1, 1, n).setFontColor('#9E9E9E').setFontLine('line-through');
    });
  } else {
    sh.getRange(2, 1).setValue('(El proyecto de Retenciones todavia no tiene CRE recibidos de esta empresa en el anio.)').setFontColor('#9E9E9E');
  }
  [70, 90, 95, 105, 260, 110, 110, 60, 85, 90, 70, 200].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1).setNote('Se llena sola desde el proyecto de Retenciones (CRE RECIBIDOS: lo que sus clientes le retuvieron). ' +
    'Los REVERTIDOS se muestran tachados y no cuentan. Se actualiza cada vez que se actualiza la liquidacion.');
  return sh;
}
