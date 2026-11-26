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

// ============================================================
// 🧾 COLUMNA «Retención» (OPCIONAL), una sola vez — acordado con el usuario el 25/11/2026
// ------------------------------------------------------------
// Al lado de «Control»: 🟡 Por retener · ✅ Retenido · 🚫 No corresponde (una sola opción). Cobranzas la lee solo si
// existe (por su título) y la combina con lo automático en «Resultado»; si se borra o se renombra, nada se rompe.
// Se llena con lo que tenían los checks antiguos (del respaldo «🛟 Respaldo O+ …»):
//   Retenido ☑ → ✅ Retenido · Por retener ☑ + Revisado ☑ → ✅ Retenido · Por retener ☑ solo → 🟡 Por retener.
// ============================================================

var CC_RET_OPC_ = ['🟡 Por retener', '✅ Retenido', '🚫 No corresponde'];

function VCH_columnaRetencion_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('VCH_COLUMNAS_CONTROL') !== '1' || props.getProperty('VCH_COL_RETENCION') === '1') return;
  const resumen = [];
  [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].forEach(function (nombre) {
    const h = obtenerHoja(nombre);
    if (!h || h.getLastColumn() < 15) return;
    let tit = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
    if (tit.indexOf('retencion') >= 0) { resumen.push(nombre + ': ya estaba'); return; }
    const cCtl = tit.indexOf('control') + 1;
    if (cCtl < 1) { resumen.push(nombre + ': sin «Control»'); return; }
    h.insertColumnAfter(cCtl);
    const col = cCtl + 1, n = h.getLastRow();
    h.getRange(1, col).setValue('Retención').setBackground(CC_COLOR_).setFontColor('#ffffff').setFontWeight('bold');
    h.setColumnWidth(col, 140);
    // marcas antiguas desde el respaldo (misma fila)
    let pr = 0, rt = 0;
    const resp = h.getParent().getSheetByName('🛟 Respaldo O+ ' + nombre);
    if (resp && resp.getLastRow() > 1 && n > 1) {
      const rt0 = resp.getRange(1, 1, 1, resp.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
      const ix = function (re) { for (let i = 0; i < rt0.length; i++) if (re.test(rt0[i])) return i; return -1; };
      const iRev = ix(/^revisado/), iPr = ix(/^por retener/), iRet = ix(/^retenid/);
      if (iPr >= 0 || iRet >= 0) {
        const filas = Math.min(n, resp.getLastRow()) - 1;
        const v = resp.getRange(2, 1, filas, resp.getLastColumn()).getValues();
        const si = function (x) { return x === true || /^(true|si|sí|x|✔|✅)$/i.test(String(x).trim()); };
        const vals = v.map(function (r) {
          const p = iPr >= 0 && si(r[iPr]), ret = iRet >= 0 && si(r[iRet]), rev = iRev >= 0 && si(r[iRev]);
          if (ret || (p && rev)) { rt++; return ['✅ Retenido']; }
          if (p) { pr++; return ['🟡 Por retener']; }
          return [''];
        });
        if (pr + rt) h.getRange(2, col, vals.length, 1).setValues(vals);
      }
    }
    try {
      h.getRange(2, col, h.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(CC_RET_OPC_, true).setAllowInvalid(true).build());
    } catch (e) { Logger.log('Retención (validación): ' + e.message); }
    resumen.push(nombre + ': lista · por retener ' + pr + ' · retenido ' + rt);
  });
  props.setProperty('VCH_COL_RETENCION', '1');
  if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'columna retención', '', resumen.join(' · ') || 'nada');
}

// ============================================================
// 🏢 PESTAÑA «🏢 Empresas» (Empresa → RUC), visible y editable por el usuario — acordado el 25/11/2026
// ------------------------------------------------------------
// Se crea UNA vez con lo aprendido hasta hoy (propiedad VCH_EMPRESAS). Desde ahí manda la pestaña: el usuario corrige,
// agrega o borra filas. Al elegir la «Empresa» en Originales / Fotos se pone su RUC; si se escribe a mano el RUC de una
// empresa que no está, se agrega como fila nueva. Si la pestaña se borra, no se recrea y nada se rompe (solo deja de
// ponerse el RUC solo).
// ============================================================

var CC_HOJA_EMP_ = '🏢 Empresas';

function VCH_hojaEmpresas_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('VCH_HOJA_EMPRESAS') === '1') return;
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  let sh = ss.getSheetByName(CC_HOJA_EMP_), n = 0;
  if (!sh) {
    let mapa = {}; try { mapa = JSON.parse(props.getProperty('VCH_EMPRESAS') || '{}'); } catch (x) {}
    sh = ss.insertSheet(CC_HOJA_EMP_);
    sh.getRange('A:B').setNumberFormat('@');
    const filas = [['Empresa', 'RUC']].concat(Object.keys(mapa).sort().map(function (k) { return [k, String(mapa[k])]; }));
    n = filas.length - 1;
    sh.getRange(1, 1, filas.length, 2).setValues(filas);
    sh.getRange(1, 1, 1, 2).setBackground(CC_COLOR_).setFontColor('#ffffff').setFontWeight('bold');
    sh.setFrozenRows(1); sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 140);
    sh.getRange('D1').setValue('ℹ️ Empresa (tal como la escribe en la columna «Empresa» de Originales / Fotos) y su RUC de 11 dígitos. ' +
      'Al elegir la Empresa en un voucher, su «RUC empresa» se pone solo con este RUC. Corrija, agregue o borre filas aquí. ' +
      'Si escribe a mano el RUC de una empresa que no está, se agrega sola como fila nueva.').setWrap(true).setFontColor('#475569').setVerticalAlignment('top');
    sh.setColumnWidth(4, 420);
  }
  props.setProperty('VCH_HOJA_EMPRESAS', '1');
  if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'pestaña empresas', '', n ? n + ' empresa(s)' : 'ya existía');
}

/** {Empresa: RUC}. Desde que existe la pestaña, manda solo ella (antes, lo aprendido en VCH_EMPRESAS). */
function CC_mapaEmpresas_(ss) {
  const sh = ss.getSheetByName(CC_HOJA_EMP_), m = {};
  if (sh) {
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) {
      const k = String(r[0]).trim(), ruc = String(r[1]).replace(/\D/g, '');
      if (k && /^\d{11}$/.test(ruc) && !m[k]) m[k] = ruc;
    });
    return { mapa: m, hoja: sh };
  }
  if (PropertiesService.getScriptProperties().getProperty('VCH_HOJA_EMPRESAS') === '1') return { mapa: m, hoja: null };   // la borró el usuario
  try { return { mapa: JSON.parse(PropertiesService.getScriptProperties().getProperty('VCH_EMPRESAS') || '{}'), hoja: null }; } catch (x) { return { mapa: m, hoja: null }; }
}

/**
 * ✏️ CORRECCIÓN A MANO DE LO QUE PUSO EL SISTEMA (26/11/2026): si la persona cambia una celda de Empresa, RUC empresa,
 * RUC beneficiario o ✍️ Anotación que había llenado el sistema (nota «🏢 Completado solo…», «🔎 Completado solo por
 * nombre…», «♻️ Devuelta…», o la columna ✍️ Anotación que es toda del sistema), la nota de la celda suma
 * «✏️ Corregido a mano el … (antes decía: …)». Así se distingue lo puesto por el sistema de lo corregido.
 */
var CC_MARCAS_SISTEMA_ = /🏢 Completado solo|🔎 Completado solo por nombre|♻️ Devuelta|⚠️ Depositó con DNI/;
function CC_marcarCorreccion_(e, h, tit) {
  const c0 = e.range.getColumn(), nc = e.range.getNumColumns(), f0 = e.range.getRow(), nf = e.range.getNumRows();
  if (nf * nc > 300) return;
  const cuando = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm');
  for (let j = 0; j < nc; j++) {
    const nom = tit[c0 - 1 + j] || '';
    const esAnot = /anotaci/.test(nom);
    if (!esAnot && !/^(empresa|ruc empresa|ruc beneficiario)$/.test(nom)) continue;
    const rg = h.getRange(f0, c0 + j, nf, 1), notas = rg.getNotes(), vals = rg.getDisplayValues();
    let cambio = false;
    for (let i = 0; i < nf; i++) {
      const nota = String(notas[i][0] || '');
      if (!esAnot && !CC_MARCAS_SISTEMA_.test(nota)) continue;   // nunca la llenó el sistema: es suya, no hace falta marcar
      const antes = nf === 1 && nc === 1 && e.oldValue !== undefined ? String(e.oldValue) : '';
      const ahora = String(vals[i][0] || '');
      if (antes && antes === ahora) continue;
      const linea = '✏️ ' + (ahora ? 'Corregido' : 'Borrado') + ' a mano el ' + cuando + (antes ? ' (antes decía: ' + antes.slice(0, 80) + ')' : '');
      notas[i][0] = (nota ? nota + '\n' : '') + linea;
      cambio = true;
    }
    if (cambio) rg.setNotes(notas);
  }
}

/**
 * ✏️ Al editar la hoja (disparador simple): al elegir o escribir la «Empresa», se pone su «RUC empresa» (según «🏢 Empresas»).
 * Si se escribe a mano el RUC de una empresa que no está en «🏢 Empresas», se agrega allí como fila nueva.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const h = e.range.getSheet(), nombre = h.getName();
    if ([CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].indexOf(nombre) < 0 || e.range.getRow() < 2 || e.range.getColumn() < 15) return;
    const tit = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
    try { CC_marcarCorreccion_(e, h, tit); } catch (eM) { /* nunca molestar al editar */ }
    const cEmp = tit.indexOf('empresa') + 1, cRuc = tit.indexOf('ruc empresa') + 1;
    if (cEmp < 1 || cRuc < 1) return;
    const em = CC_mapaEmpresas_(h.getParent()), mapa = em.mapa;
    const c0 = e.range.getColumn(), c1 = c0 + e.range.getNumColumns() - 1, f0 = e.range.getRow(), nf = e.range.getNumRows();
    if (cEmp >= c0 && cEmp <= c1) {   // eligió / escribió la Empresa → su RUC
      const emps = h.getRange(f0, cEmp, nf, 1).getDisplayValues(), rucs = h.getRange(f0, cRuc, nf, 1);
      const actuales = rucs.getDisplayValues(), nuevos = emps.map(function (x, i) {
        const r = mapa[String(x[0]).trim()];
        return [r || (String(x[0]).trim() ? actuales[i][0] : '')];
      });
      rucs.setNumberFormat('@').setValues(nuevos);
    } else if (cRuc >= c0 && cRuc <= c1 && nf === 1 && em.hoja) {   // RUC a mano de una empresa nueva → fila en «🏢 Empresas»
      const e1 = String(h.getRange(f0, cEmp).getDisplayValue()).trim(), r1 = String(h.getRange(f0, cRuc).getDisplayValue()).replace(/\D/g, '');
      if (e1 && /^\d{11}$/.test(r1) && !mapa[e1]) em.hoja.appendRow([e1, r1]);
    }
  } catch (err) { /* nunca molestar al editar */ }
}
