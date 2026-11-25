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

/**
 * Marca manual de retención del voucher (OPCIONAL): columna «Retención» (🟡 Por retener · ✅ Retenido · 🚫 No corresponde)
 * Solo esa columna (no mira «Control» ni ninguna otra). Devuelve 'por' | 'ret' | 'no' | ''.
 * Solo cambia el texto de «Resultado»; ningún cálculo de Cobranzas depende de esto.
 */
function RES_marca_(ret) {
  var t = normHeader_(ret);
  if (/no corresponde|sin retencion/.test(t)) return 'no';
  if (/retenido/.test(t)) return 'ret';
  if (/por retener/.test(t)) return 'por';
  return '';
}

var RES_MARCA_TXT_ = { por: '🟡 Por retener (marcado)', ret: '🧾 Retenido (marcado)', no: '🚫 Sin retención (marcado)' };

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
    var refs = String(p.refs || '').trim(), xs = porPago[p.id] || [], errs = errPorPago[p.id] || [], t, mk = p.retMarca || '';
    if (excluidos[p.id]) t = '🚫 Excluido (' + excluidos[p.id] + ')';
    else if (RX_DEVOLUCION_.test(refs)) t = '↩️ Devolución';
    else if (!xs.length) {
      var cat = refs ? categoriaPorTexto_(refs, cfg.categorias) : null;
      t = errs.length ? '⚠️ ' + errs[0].detalle : !refs ? '⏳ Sin comprobante' : cat ? '🏷 ' + (cat.categoria || cat.clave) : '⏳ Sin aplicar';
      if (mk) t += ' · ' + RES_MARCA_TXT_[mk];
    } else {
      var apl = xs.reduce(function (s, x) { return s + (x.m.monto || 0); }, 0), sobra = Math.round((p.monto - apl) * 100) / 100;
      t = sobra > 0.05 ? '💰 Sobran ' + RES_num_(sobra) : '✅ Aplicado';
      if (errs.length) t += ' · ⚠️ ' + errs[0].detalle;
      var docs = []; xs.forEach(function (x) { if (docs.indexOf(x.d) < 0) docs.push(x.d); });
      var rt = docs.filter(function (d) { return d.rtn && d.rtn.aplica; });
      if (rt.length) {
        var falta = rt.reduce(function (s, d) { return s + Math.max(0, (d.rtn.esperada || 0) - (d.rtn.retenida || 0)); }, 0);
        if (falta > 1) {
          if (mk === 'ret') t += ' · 🧾 Retenido (marcado) · ' + (p.fecha && Date.now() - p.fecha.getTime() > 7 * 86400000   // más de 7 días sin CRE: revisar
            ? '⚠️ sin CRE en SUNAT (' + RES_num_(falta) + ')' : 'CRE de SUNAT pendiente');
          else if (mk === 'no') t += ' · ⚠️ Marcado «no corresponde», pero el sistema calcula 3% (' + RES_num_(falta) + ')';
          else t += ' · ⚠️ Falta retención 3% (' + RES_num_(falta) + ')' + (mk === 'por' ? ' · 🟡 marcado por retener' : '');
        } else {
          var cres = [];
          rt.forEach(function (d) { d.movs.forEach(function (m) { if (m.modalidad === MODALIDAD.RETENCION && m.operacion && cres.indexOf(m.operacion) < 0) cres.push(m.operacion); }); });
          t += ' · 🧾 Retención aplicada' + (cres.length ? ' ' + cres.slice(0, 3).join(', ') : '');
        }
      } else if (docs.some(function (d) { return d.rtn; })) {
        if (mk === 'ret' || mk === 'por') t += ' · ' + RES_MARCA_TXT_[mk] + ' · ⚠️ el sistema calcula que no corresponde';
        else t += ' · No corresponde retención';
      } else if (mk) t += ' · ' + RES_MARCA_TXT_[mk];
    }
    mapa[p.fuente] = String(t).slice(0, 300);
  });
  (vch.duplicados || []).forEach(function (d) { if (d.fuente && !mapa[d.fuente]) mapa[d.fuente] = '🔁 Copia de ' + d.otra; });
  return mapa;
}

/**
 * 🧾 UNA SOLA VEZ (pedido del usuario el 25/11/2026): llena la columna «Retención» SOLO con los casos claros de hoy,
 * como valores fijos (sin fórmulas), y solo en celdas vacías:
 *   «Resultado» con «🧾 Retención aplicada» (CRE de SUNAT) → ✅ Retenido · «No corresponde retención» → 🚫 No corresponde.
 *   Sin comprobante, falta retener, o cualquier otro caso → se deja vacío.
 * Además borra la marca equivocada de Originales!2906 (pago a SUNAT, op. 5728), solo si sigue siendo esa.
 * Después NUNCA más se escribe en «Retención»: la llena solo el usuario.
 */
function RES_retencionInicial_(cfg, mapa) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('RES_RETENCION_INICIAL') === '1' || !cfg.idVouchers) return;
  var vs = SpreadsheetApp.openById(cfg.idVouchers), resumen = [], hay = false;
  cfg.pestanasVouchers.forEach(function (nombre) {
    var sh = vs.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(normHeader_);
    var c = enc.indexOf('retencion');
    if (c < 0) return;
    hay = true;
    var n = sh.getLastRow() - 1, rg = sh.getRange(2, c + 1, n, 1), cur = rg.getValues(), ret = 0, no = 0, borr = 0;
    var cOp = indiceColumnas_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0])('Numero de operacion');
    var nuevo = cur.map(function (x, i) {
      var v = String(x[0] || '').trim(), fila = i + 2;
      if (v) {
        if (/^originales$/i.test(nombre) && fila === 2906 && /retenido/i.test(v) && cOp >= 0 &&
            String(sh.getRange(fila, cOp + 1).getDisplayValue()).trim() === '5728') { borr++; return ['']; }
        return [x[0]];
      }
      var t = mapa[nombre + '!' + fila] || '';
      if (/Falta retención|marcado/.test(t)) return [''];
      if (/Retención aplicada/.test(t)) { ret++; return ['✅ Retenido']; }
      if (/No corresponde retención/.test(t)) { no++; return ['🚫 No corresponde']; }
      return [''];
    });
    if (ret + no + borr) rg.setValues(nuevo);
    resumen.push(nombre + ': ✅ ' + ret + ' · 🚫 ' + no + (borr ? ' · borrada fila 2906' : ''));
  });
  if (!hay) return;   // aún no existe la columna: se intenta en la próxima actualización
  props.setProperty('RES_RETENCION_INICIAL', '1');
  REG_anotar_('Cobranzas', 'retención inicial (una vez)', '', resumen.join(' · '));
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
