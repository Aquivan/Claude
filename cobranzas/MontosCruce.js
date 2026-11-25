/**
 * 🔒 MONTOS DE CRUCE: cuánto de un voucher va a cada factura, guardado en Cobranzas (no en la hoja de Vouchers).
 *
 * La celda «Tipo y Nº Doc.» de la hoja de Vouchers queda limpia, solo con las facturas (01_F001-11963,01_F001-13468).
 * Cuando en la 🧩 Mesa se elige «🔒 solo lo libre» (o se toca una línea y se escribe un monto), ese monto se guarda aquí:
 * hoja «🔒 Montos de cruce» (ID del voucher, voucher, factura, monto, quién, cuándo). Cobranzas lo aplica como si la celda
 * dijera 01_F001-13468=276.80 (el formato «=monto» escrito a mano en la hoja de Vouchers sigue funcionando; este manda).
 * El ID del voucher es banco|operación|fecha|monto (no cambia aunque se muevan filas).
 */

var MON_HOJA_ = '🔒 Montos de cruce';
var MON_ENC_ = ['ID voucher', 'Voucher (fila)', 'Factura', 'Monto', 'Quién', 'Cuándo'];

function MON_hoja_(ss, crear) {
  var sh = ss.getSheetByName(MON_HOJA_);
  if (!sh && !crear) return null;
  if (!sh) {
    sh = ss.insertSheet(MON_HOJA_);
    escribirTabla_(sh, 1, 1, MON_ENC_, []);
    sh.setFrozenRows(1);
    sh.getRange('A2:C3000').setNumberFormat('@'); sh.getRange('D2:D3000').setNumberFormat('#,##0.00');
    [260, 140, 160, 100, 160, 130].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange('H1').setValue('ℹ️ Cuánto de cada voucher va a cada factura cuando no es «lo que alcance» (lo pone la 🧩 Mesa). Así la hoja de Vouchers queda solo con las facturas. Borrar una fila = esa factura vuelve a tomar lo que alcance del voucher.')
      .setWrap(true).setFontColor('#475569').setVerticalAlignment('top');
    sh.setColumnWidth(8, 380);
  }
  return sh;
}

/** {idVoucher: {'01_F001-13468': 276.8, …}} */
function MON_mapa_(ss) {
  var sh = MON_hoja_(ss, false), m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    var id = String(r[0] || '').trim(), doc = String(r[2] || '').trim().toUpperCase(), monto = Number(r[3]);
    if (id && doc && monto >= 0 && r[3] !== '') (m[id] = m[id] || {})[doc] = Math.round(monto * 100) / 100;
  });
  return m;
}

function MON_clave_(r) { return normTipo_(r.tipo) + '_' + String(r.serie).toUpperCase() + '-' + parseInt(r.numero, 10); }

/** Antes del cruce: a los vouchers con montos guardados se les pone «=monto» en sus facturas (solo en memoria). */
function MON_aplicar_(ss, pagos) {
  var m = MON_mapa_(ss), n = 0;
  if (!Object.keys(m).length) return 0;
  pagos.forEach(function (p) {
    var mm = m[String(p.id)]; if (!mm || !p.refs) return;
    var pr; try { pr = parsearReferencias_(p.refs); } catch (e) { return; }
    if (!pr.refs.length) return;
    p.refs = pr.refs.map(function (r) {
      var c = MON_clave_(r), x = mm[c] != null ? mm[c] : r.monto;
      return c + (x != null ? '=' + Number(x).toFixed(2) : '');
    }).join(',') + (pr.noEntendido.length ? ' ' + pr.noEntendido.join(' ') : '');
    n++;
  });
  return n;
}

/** Al guardar desde la Mesa: reemplaza los montos de ese voucher (montos = {'01_F001-13468': 276.8} o {} para borrarlos). */
function MON_guardar_(ss, id, fu, montos, quien) {
  var sh = MON_hoja_(ss, true), n = Math.max(0, sh.getLastRow() - 1), cambio = false;
  if (n) {
    var v = sh.getRange(2, 1, n, 1).getValues();
    for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]) === String(id)) { sh.deleteRow(i + 2); cambio = true; }
  }
  var filas = Object.keys(montos || {}).map(function (doc) {
    return [String(id), String(fu || ''), String(doc).toUpperCase(), Math.round(Number(montos[doc]) * 100) / 100, String(quien || '').slice(0, 60), Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm')];
  });
  if (filas.length) { sh.getRange(sh.getLastRow() + 1, 1, filas.length, MON_ENC_.length).setValues(filas); cambio = true; }
  return cambio;
}

function MON_huella_(ss) {
  var sh = ss.getSheetByName(MON_HOJA_);
  return sh && sh.getLastRow() > 1 ? hashTexto_(JSON.stringify(sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues())) : '';
}
