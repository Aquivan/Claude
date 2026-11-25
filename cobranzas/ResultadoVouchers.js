/**
 * 📋 COLUMNA «Resultado» DE LA HOJA DE VOUCHERS: cómo quedó cada voucher después del cruce (la escribe Cobranzas).
 *
 *   ✅ Aplicado · 💰 Sobran 11.72 · ⏳ Sin comprobante · ⏳ Sin aplicar · ⚠️ <problema> · ↩️ Devolución · 🏷 PLANILLA
 *   · 🔁 Copia de Originales!123 · 🚫 Excluido
 *   + retención de sus facturas: «🧾 Retención aplicada CRE E001-242» · «⚠️ Falta retención 3% (285.36)» · «No corresponde retención»
 *
 * La columna la crea la hoja de Vouchers (ColumnasControl.js). Si no existe, no se hace nada. Solo se escribe si algo
 * cambió (la huella de Cobranzas se guarda al final, así esta escritura no provoca otro recálculo).
 */

function RES_num_(n) { return (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** {fuente: texto} para cada voucher. */
function RES_textos_(res, vch, cfg, excluidos) {
  var porPago = {}, errPorPago = {}, mapa = {};
  res.docs.forEach(function (d) {
    d.movs.forEach(function (m) { if (m.pagoId && m.modalidad === MODALIDAD.PAGO) (porPago[m.pagoId] = porPago[m.pagoId] || []).push({ m: m, d: d }); });
  });
  (res.errores || []).forEach(function (e) { if (e.pagoId) (errPorPago[e.pagoId] = errPorPago[e.pagoId] || []).push(e); });
  vch.pagos.forEach(function (p) {
    if (!p.fuente) return;
    var refs = String(p.refs || '').trim(), xs = porPago[p.id] || [], errs = errPorPago[p.id] || [], t;
    if (excluidos[p.id]) t = '🚫 Excluido (' + excluidos[p.id] + ')';
    else if (RX_DEVOLUCION_.test(refs)) t = '↩️ Devolución';
    else if (!xs.length) {
      var cat = refs ? categoriaPorTexto_(refs, cfg.categorias) : null;
      t = errs.length ? '⚠️ ' + errs[0].detalle : !refs ? '⏳ Sin comprobante' : cat ? '🏷 ' + (cat.categoria || cat.clave) : '⏳ Sin aplicar';
    } else {
      var apl = xs.reduce(function (s, x) { return s + (x.m.monto || 0); }, 0), sobra = Math.round((p.monto - apl) * 100) / 100;
      t = sobra > 0.05 ? '💰 Sobran ' + RES_num_(sobra) : '✅ Aplicado';
      if (errs.length) t += ' · ⚠️ ' + errs[0].detalle;
      var docs = []; xs.forEach(function (x) { if (docs.indexOf(x.d) < 0) docs.push(x.d); });
      var rt = docs.filter(function (d) { return d.rtn && d.rtn.aplica; });
      if (rt.length) {
        var falta = rt.reduce(function (s, d) { return s + Math.max(0, (d.rtn.esperada || 0) - (d.rtn.retenida || 0)); }, 0);
        if (falta > 1) t += ' · ⚠️ Falta retención 3% (' + RES_num_(falta) + ')';
        else {
          var cres = [];
          rt.forEach(function (d) { d.movs.forEach(function (m) { if (m.modalidad === MODALIDAD.RETENCION && m.operacion && cres.indexOf(m.operacion) < 0) cres.push(m.operacion); }); });
          t += ' · 🧾 Retención aplicada' + (cres.length ? ' ' + cres.slice(0, 3).join(', ') : '');
        }
      } else if (docs.some(function (d) { return d.rtn; })) t += ' · No corresponde retención';
    }
    mapa[p.fuente] = String(t).slice(0, 300);
  });
  (vch.duplicados || []).forEach(function (d) { if (d.fuente && !mapa[d.fuente]) mapa[d.fuente] = '🔁 Copia de ' + d.otra; });
  return mapa;
}

/** Escribe la columna «Resultado» de cada pestaña de vouchers (solo si cambió algo). Devuelve cuántas celdas cambió. */
function RES_escribir_(cfg, mapa) {
  if (!cfg.idVouchers) return 0;
  var vs = SpreadsheetApp.openById(cfg.idVouchers), cambios = 0;
  cfg.pestanasVouchers.forEach(function (nombre) {
    var sh = vs.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var c = indiceColumnas_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0])('Resultado');
    if (c < 0) return;
    var n = sh.getLastRow() - 1, rg = sh.getRange(2, c + 1, n, 1), cur = rg.getValues(), hubo = 0;
    var nuevo = cur.map(function (x, i) { var v = mapa[nombre + '!' + (i + 2)] || ''; if (String(x[0]) !== v) hubo++; return [v]; });
    if (hubo) { rg.setValues(nuevo); cambios += hubo; }
  });
  return cambios;
}
