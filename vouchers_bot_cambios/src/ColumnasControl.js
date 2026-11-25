// ============================================================
// 🗂 COLUMNAS DE CONTROL (de la O en adelante), una sola vez — acordado con el usuario el 25/11/2026
// ------------------------------------------------------------
// Antes:  Revisado · Por retener · Retenido · ID Usuario · Empresa · ID Beneficiario · Tipo y Nº Doc · Adj. · Nota
// Ahora:  Empresa · RUC empresa · RUC beneficiario · Comprobantes · Control · Nota · Resultado
//   · Revisado ☑ → chip «👀 Revisado» y Adj. ☑ → chip «📄 Original físico» en «Control» (varias opciones por celda).
//   · Por retener / Retenido salen: la retención la dice «Resultado» (la escribe Cobranzas con el padrón SUNAT y los CRE).
//   · «RUC empresa» pasa de fórmula a valor; al elegir la Empresa se pone solo (onEdit) y se puede escribir otra empresa.
// Antes de tocar nada se copia todo lo de la O en adelante (con fórmulas, formatos y validaciones) a una pestaña oculta
// «🛟 Respaldo O+ <pestaña>». Si una columna no está, se salta. Las columnas propias que el usuario tenga se dejan al final.
// ============================================================

var CC_CONTROL_OPC_ = ['👀 Revisado', '📄 Original físico', '⚠️ Observado', '🔁 Pendiente corregir', '🧾 Retención manual'];
var CC_COLOR_ = '#0f766e';

function CC_norma_(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }

function CC_cols_(h) {
  const tit = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
  const col = function (re) { for (let i = 14; i < tit.length; i++) if (re.test(tit[i])) return i + 1; return -1; };   // solo de la O en adelante
  return {
    rev: col(/^revisado/), adj: col(/^adj/), pr: col(/^por retener/), ret: col(/^retenid/),
    idu: col(/^id usuario|^ruc empresa/), emp: col(/^empresa$/), idb: col(/^id benef|^ruc benef/), doc: col(/^tipo y n|^comprobantes/),
    nota: col(/^nota/), ctl: col(/^control$/), res: col(/^resultado$/), total: tit.length
  };
}

function VCH_columnasControl_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('VCH_COLUMNAS_CONTROL') === '1') return;
  const resumen = [];
  const mapaEmp = {};
  [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].forEach(function (nombre) {
    const h = obtenerHoja(nombre);
    if (!h || h.getLastColumn() < 15) return;
    const ss = h.getParent(), n = Math.max(1, h.getLastRow()), nc = h.getLastColumn();
    // 1) respaldo de O en adelante (valores, fórmulas, formatos, validaciones)
    const nomR = '🛟 Respaldo O+ ' + nombre;
    if (!ss.getSheetByName(nomR)) {
      const r = ss.insertSheet(nomR);
      h.getRange(1, 15, n, nc - 14).copyTo(r.getRange(1, 1));
      r.hideSheet();
    }
    let c = CC_cols_(h);
    // 2) RUC empresa: de fórmula a valor (lo que muestra hoy), y aprender Empresa → RUC
    if (c.idu > 0 && n > 1) {
      const rg = h.getRange(2, c.idu, n - 1, 1), ver = rg.getDisplayValues();
      rg.setNumberFormat('@').setValues(ver);
      if (c.emp > 0) {
        const emps = h.getRange(2, c.emp, n - 1, 1).getDisplayValues();
        emps.forEach(function (e, i) {
          const k = String(e[0]).trim(), ruc = String(ver[i][0]).replace(/\D/g, '');
          if (k && /^\d{11}$/.test(ruc)) { mapaEmp[k] = mapaEmp[k] || {}; mapaEmp[k][ruc] = (mapaEmp[k][ruc] || 0) + 1; }
        });
      }
    }
    // 3) «Control» y «Resultado» al final (Control con lo que ya estaba marcado)
    if (c.ctl < 0) {
      const col = h.getLastColumn() + 1;
      h.insertColumnAfter(h.getLastColumn());
      h.getRange(1, col).setValue('Control');
      if (n > 1) {
        const si = function (cc) { if (cc < 0) return null; return h.getRange(2, cc, n - 1, 1).getValues().map(function (x) { return x[0] === true || /^(true|si|sí|x|✔|✅)$/i.test(String(x[0]).trim()); }); };
        const rev = si(c.rev), adj = si(c.adj);
        const vals = [];
        for (let i = 0; i < n - 1; i++) {
          const chips = [];
          if (rev && rev[i]) chips.push('👀 Revisado');
          if (adj && adj[i]) chips.push('📄 Original físico');
          vals.push([chips.join(', ')]);
        }
        h.getRange(2, col, n - 1, 1).setValues(vals);
      }
      c = CC_cols_(h);
    }
    if (c.res < 0) {
      h.insertColumnAfter(h.getLastColumn());
      h.getRange(1, h.getLastColumn()).setValue('Resultado');
      c = CC_cols_(h);
    }
    // 4) quitar Revisado, Adj., Por retener, Retenido (de derecha a izquierda)
    [c.rev, c.adj, c.pr, c.ret].filter(function (x) { return x > 0; }).sort(function (a, b) { return b - a; })
      .forEach(function (x) { h.deleteColumn(x); });
    // 5) orden: Empresa · RUC empresa · RUC beneficiario · Comprobantes · Control · Nota · Resultado (desde la O)
    const orden = ['emp', 'idu', 'idb', 'doc', 'ctl', 'nota', 'res'];
    let pos = 15;
    orden.forEach(function (k) {
      const cur = CC_cols_(h)[k];
      if (cur < 0) return;
      if (cur !== pos) h.moveColumns(h.getRange(1, cur, 1, 1), pos);
      pos++;
    });
    // 6) títulos nuevos, color y línea entre N y O
    c = CC_cols_(h);
    const titulo = function (cc, t) { if (cc > 0) h.getRange(1, cc).setValue(t); };
    titulo(c.idu, 'RUC empresa'); titulo(c.idb, 'RUC beneficiario'); titulo(c.doc, 'Comprobantes');
    const ultima = h.getLastColumn();
    h.getRange(1, 15, 1, ultima - 14).setBackground(CC_COLOR_).setFontColor('#ffffff').setFontWeight('bold');
    h.getRange(1, 15, h.getMaxRows(), 1).setBorder(null, true, null, null, null, null, '#0f172a', SpreadsheetApp.BorderStyle.SOLID_THICK);
    // 7) validaciones: Control (lista; varias opciones se activan en la hoja), Empresa avisa pero no bloquea
    if (c.ctl > 0) {
      h.getRange(2, c.ctl, h.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(CC_CONTROL_OPC_, true).setAllowInvalid(true).build());
      h.setColumnWidth(c.ctl, 220);
    }
    if (c.emp > 0) {
      try {
        const regla = h.getRange(2, c.emp).getDataValidation();
        if (regla) {
          const nueva = regla.copy().setAllowInvalid(true).build();
          h.getRange(2, c.emp, h.getMaxRows() - 1, 1).setDataValidation(nueva);
        }
      } catch (e) { Logger.log('Empresa (validación): ' + e.message); }
    }
    if (c.res > 0) {
      h.setColumnWidth(c.res, 280);
      const rr = h.getRange(2, c.res, h.getMaxRows() - 1, 1);
      const reglas = h.getConditionalFormatRules().filter(function (x) { return !x.getRanges().some(function (g) { return g.getColumn() === c.res; }); });
      reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('⚠️').setBackground('#FEE2E2').setRanges([rr]).build());
      reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextContains('💰').setBackground('#FEF9C3').setRanges([rr]).build());
      reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('✅').setBackground('#DCFCE7').setRanges([rr]).build());
      h.setConditionalFormatRules(reglas);
    }
    resumen.push(nombre + ': listo');
  });
  // Empresa → RUC (el más usado para cada nombre), para ponerlo solo al elegir la Empresa
  const emp = {};
  Object.keys(mapaEmp).forEach(function (k) { emp[k] = Object.keys(mapaEmp[k]).sort(function (a, b) { return mapaEmp[k][b] - mapaEmp[k][a]; })[0]; });
  if (Object.keys(emp).length) props.setProperty('VCH_EMPRESAS', JSON.stringify(emp));
  props.setProperty('VCH_COLUMNAS_CONTROL', '1');
  if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'columnas de control', '', (resumen.join(' · ') || 'nada') + ' · empresas: ' + Object.keys(emp).join(', '));
}

/**
 * ✏️ Al editar la hoja (disparador simple): al elegir o escribir la «Empresa», se pone su «RUC empresa» (si se conoce).
 * Si se escribe a mano el RUC de una empresa nueva (fuera del grupo), se aprende para la próxima vez.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const h = e.range.getSheet(), nombre = h.getName();
    if ([CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].indexOf(nombre) < 0 || e.range.getRow() < 2 || e.range.getColumn() < 15) return;
    const tit = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
    const cEmp = tit.indexOf('empresa') + 1, cRuc = tit.indexOf('ruc empresa') + 1;
    if (cEmp < 1 || cRuc < 1) return;
    const props = PropertiesService.getScriptProperties();
    let mapa = {}; try { mapa = JSON.parse(props.getProperty('VCH_EMPRESAS') || '{}'); } catch (x) {}
    const c0 = e.range.getColumn(), c1 = c0 + e.range.getNumColumns() - 1, f0 = e.range.getRow(), nf = e.range.getNumRows();
    if (cEmp >= c0 && cEmp <= c1) {   // eligió / escribió la Empresa → su RUC
      const emps = h.getRange(f0, cEmp, nf, 1).getDisplayValues(), rucs = h.getRange(f0, cRuc, nf, 1);
      const actuales = rucs.getDisplayValues(), nuevos = emps.map(function (x, i) {
        const r = mapa[String(x[0]).trim()];
        return [r || (String(x[0]).trim() ? actuales[i][0] : '')];
      });
      rucs.setNumberFormat('@').setValues(nuevos);
    } else if (cRuc >= c0 && cRuc <= c1 && nf === 1) {   // escribió un RUC a mano: se aprende para esa Empresa
      const e1 = String(h.getRange(f0, cEmp).getDisplayValue()).trim(), r1 = String(h.getRange(f0, cRuc).getDisplayValue()).replace(/\D/g, '');
      if (e1 && /^\d{11}$/.test(r1) && !mapa[e1]) { mapa[e1] = r1; props.setProperty('VCH_EMPRESAS', JSON.stringify(mapa)); }
    }
  } catch (err) { /* nunca molestar al editar */ }
}
