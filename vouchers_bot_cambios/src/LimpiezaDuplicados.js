// ============================================================
// 🧹 LIMPIEZA DE LAS FILAS «[DUPLICADO]» ANTIGUAS — pedido del usuario 26/11/2026 («con mucho cuidado»)
// ------------------------------------------------------------
// Desde el 26/11 un repetido ya no crea fila (Repetidos.js). Las filas «[DUPLICADO]» de antes perdieron su N° de operación,
// así que su original se busca por lo que sí conservan: banco + moneda + monto + fecha (mismo día) y, si hay más de uno,
// el beneficiario. Dos pasos:
//   1. VISTA PREVIA (no toca nada): «🧹 Limpieza de duplicados — vista previa.csv» en Procesados de Fotos con lo que se
//      haría con cada fila: original encontrado / dudoso (varios) / sin original.
//   2. APLICAR (solo cuando LIMP_APLICAR_ = true, después de revisarlo con el usuario): respaldo completo de la pestaña
//      (copia oculta «🛟 Respaldo duplicados <pestaña>»), en la fila original se anota en «Canal» + nota quién más lo
//      mandó (como Repetidos.js), el archivo que quede sin filas pasa a «Procesados/🔁 Repetidos» y se borran SOLO las
//      filas con original seguro. Las dudosas y sin original no se tocan.
// ============================================================

var LIMP_APLICAR_ = false;

function LIMP_dia_(f) { return f instanceof Date ? Utilities.formatDate(f, 'America/Lima', 'yyyy-MM-dd') : String(f || '').trim(); }
function LIMP_norm_(t) { return String(t || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, ''); }

/** Plan para una pestaña: [{fila, datos…, orig, candidatos, motivo}] */
function LIMP_plan_(h) {
  const n = h.getLastRow() - 1;
  if (n < 1) return [];
  const v = h.getRange(2, 1, n, 14).getValues();
  const porClave = {};
  v.forEach(function (r, i) {
    const op = String(r[1] || '').trim();
    if (!op || op.charAt(0) === '[') return;
    const k = String(r[2]).trim().toUpperCase() + '|' + String(r[3]).trim().toUpperCase() + '|' + (Math.round((Number(r[4]) || 0) * 100) / 100).toFixed(2) + '|' + LIMP_dia_(r[0]);
    (porClave[k] = porClave[k] || []).push(i);
  });
  const plan = [];
  v.forEach(function (r, i) {
    if (String(r[1] || '').trim() !== '[DUPLICADO]') return;
    const k = String(r[2]).trim().toUpperCase() + '|' + String(r[3]).trim().toUpperCase() + '|' + (Math.round((Number(r[4]) || 0) * 100) / 100).toFixed(2) + '|' + LIMP_dia_(r[0]);
    let c = porClave[k] || [];
    if (c.length > 1) {
      const b = LIMP_norm_(r[5]);
      const mismos = c.filter(function (j) { const o = LIMP_norm_(v[j][5]); return b && o && (o === b || o.indexOf(b) === 0 || b.indexOf(o) === 0); });
      if (mismos.length === 1) c = mismos;
    }
    plan.push({
      fila: i + 2, fecha: LIMP_dia_(r[0]), banco: r[2], moneda: r[3], monto: r[4], benef: r[5], archivo: String(r[10] || '').trim(),
      procesado: r[11] instanceof Date ? Utilities.formatDate(r[11], 'America/Lima', 'dd/MM/yyyy HH:mm') : String(r[11] || ''), pag: r[12], canal: String(r[13] || ''),
      orig: c.length === 1 ? c[0] + 2 : 0, candidatos: c.map(function (j) { return j + 2; }),
      motivo: c.length === 1 ? 'original seguro' : c.length ? 'dudoso: ' + c.length + ' posibles' : 'sin original (mismo banco, moneda, monto y fecha)'
    });
  });
  return plan;
}

function LIMP_csv_(filas) {
  return filas.map(function (r) { return r.map(function (x) { const s = String(x == null ? '' : x); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\n');
}

/**
 * 🔁 Los dudosos (varios posibles originales) y los sin original se vuelven a LEER con la IA (RP_leer_, el mismo «Volver a
 * leer»): con su N° de operación real se busca el original EXACTO (op + banco + monto). Si un archivo/página tiene varios
 * vouchers (p. ej. un financiamiento de 2 registros), cada fila [DUPLICADO] de esa página toma el voucher en su orden.
 */
async function LIMP_releer_(t, h, plan) {
  const pend = plan.filter(function (p) { return !p.orig && p.archivo; });
  if (!pend.length) return 0;
  const n = h.getLastRow() - 1, v = h.getRange(2, 1, n, 5).getValues(), porClave = {};
  v.forEach(function (r, i) { if (String(r[1] || '').charAt(0) !== '[' && r[1]) porClave[claveDuplicado(r[1], r[2], r[4])] = i + 2; });
  const grupos = {};
  pend.forEach(function (p) { const k = p.archivo + '|' + (p.pag || 1); (grupos[k] = grupos[k] || []).push(p); });
  let hechos = 0;
  for (const k in grupos) {
    const g = grupos[k];
    if (Date.now() - INICIO_EJECUCION_ > 150000) { g.forEach(function (p) { p.motivo += ' · sin tiempo para releer'; }); continue; }
    try {
      const r = await RP_leer_(t, g[0].fila);
      g.forEach(function (p, i) {
        const x = r.leidos[i];
        if (!x || !x.nOperacion) { p.motivo += ' · releído: sin voucher ' + (i + 1); return; }
        const o = porClave[claveDuplicado(x.nOperacion, x.banco, x.monto)];
        p.opReleida = x.nOperacion;
        if (o) { p.orig = o; p.motivo = 'original seguro (releído: op ' + x.nOperacion + ')'; hechos++; }
        else p.motivo += ' · releído op ' + x.nOperacion + ': no está en la hoja';
      });
    } catch (e) { g.forEach(function (p) { p.motivo += ' · no se pudo releer (' + String(e.message).slice(0, 60) + ')'; }); }
  }
  return hechos;
}

/**
 * 🟩 Repetidos que el sistema viejo NO marcó (las filas en verde del usuario: mismo banco, moneda, monto y fecha). Por cada
 * grupo así, si los N° de operación son iguales salvo ceros/guiones o un carácter (¿un dígito mal leído?), se vuelven a
 * LEER las dos filas con la IA: si la operación releída es la MISMA, es repetido confirmado (queda la fila más antigua);
 * si no, son vouchers distintos (p. ej. un financiamiento de 2 registros) y no se tocan. Máx. 40 relecturas por vuelta.
 */
async function LIMP_grupos_(t, h, plan) {
  const n = h.getLastRow() - 1;
  if (n < 1) return { grupos: 0, distintos: 0, releidas: 0 };
  const v = h.getRange(2, 1, n, 14).getValues(), g = {};
  v.forEach(function (r, i) {
    const op = String(r[1] || '').trim();
    if (!op || op.charAt(0) === '[') return;
    const k = String(r[2]).trim().toUpperCase() + '|' + String(r[3]).trim().toUpperCase() + '|' + (Math.round((Number(r[4]) || 0) * 100) / 100).toFixed(2) + '|' + LIMP_dia_(r[0]);
    (g[k] = g[k] || []).push(i);
  });
  let grupos = 0, distintos = 0, releidas = 0;
  const cache = {};
  const releer = async function (i) {
    if (cache[i] !== undefined) return cache[i];
    if (releidas >= 40 || Date.now() - INICIO_EJECUCION_ > 150000) return (cache[i] = null);   // ⏱ máx. 2½ min: deja tiempo a los vouchers nuevos
    releidas++;
    try {
      const r = await RP_leer_(t, i + 2), propio = REP_normOp_(v[i][1]);
      let mejor = r.leidos[0];   // en una página con varios vouchers: el de operación más parecida a la de la fila
      r.leidos.forEach(function (x) { const o = REP_normOp_(x.nOperacion); if (o === propio || (REP_unoDistinto_(o, propio) && REP_normOp_(mejor.nOperacion) !== propio)) mejor = x; });
      return (cache[i] = REP_normOp_(mejor && mejor.nOperacion));
    } catch (e) { return (cache[i] = null); }
  };
  for (const k in g) {
    const idx = g[k];
    if (idx.length < 2) continue;
    grupos++;
    for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
      const i = idx[a], j = idx[b], oi = REP_normOp_(v[i][1]), oj = REP_normOp_(v[j][1]);
      if (!(oi === oj || REP_unoDistinto_(oi, oj))) { distintos++; continue; }
      // Mismo archivo y operación con 1 dígito distinto = vouchers SEGUIDOS de un mismo escaneo (operaciones correlativas
      // como 9553 / 9554): son distintos. Así salió al releer los primeros casos (26/11). No se relee.
      if (oi !== oj && String(v[i][10]).trim() === String(v[j][10]).trim()) { distintos++; continue; }
      // Misma operación (salvo ceros / guiones), mismo banco, monto y fecha: es el MISMO voucher (no hace falta la IA).
      const ri = oi === oj ? oi : await releer(i), rj = oi === oj ? oj : await releer(j);
      const base = { fecha: LIMP_dia_(v[j][0]), banco: v[j][2], moneda: v[j][3], monto: v[j][4], benef: v[j][5], archivo: String(v[j][10] || '').trim(),
        procesado: v[j][11] instanceof Date ? Utilities.formatDate(v[j][11], 'America/Lima', 'dd/MM/yyyy HH:mm') : String(v[j][11] || ''), pag: v[j][12], canal: String(v[j][13] || ''),
        candidatos: [i + 2], fila: j + 2, verde: true };
      if (ri && rj && ri === rj) plan.push(Object.assign(base, { orig: i + 2, motivo: (oi === oj ? 'repetido: misma operación ' + ri : 'repetido confirmado (releído: op ' + ri + ')') + ' en ' + (i + 2) + ' y ' + (j + 2) + (String(v[i][10]).trim() === String(v[j][10]).trim() ? ' (mismo archivo)' : ' (archivos distintos)') }));
      else plan.push(Object.assign(base, { orig: 0, motivo: ri && rj ? 'distintos al releer (op ' + ri + ' / ' + rj + '): no se toca' : 'casi igual, no se pudo releer: revisar a mano' }));
    }
  }
  return { grupos: grupos, distintos: distintos, releidas: releidas };
}

async function VCH_limpiezaDuplicados_() {
  const props = PropertiesService.getScriptProperties(), estado = props.getProperty('VCH_LIMP_DUP4') || '';
  if (estado === 'hecho' || (estado === 'vista' && !LIMP_APLICAR_)) return;
  const tabs = [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS], planes = {}, infoG = {};
  for (let q = 0; q < tabs.length; q++) {   // primero las [DUPLICADO] (pocas, releer seguro) de las dos pestañas…
    const t = tabs[q], h = obtenerHoja(t);
    planes[t] = h ? LIMP_plan_(h) : [];
    if (h && planes[t].length) { try { await LIMP_releer_(t, h, planes[t]); } catch (e) { Logger.log('🧹 Releer: ' + e.message); } }
  }
  for (let q = 0; q < tabs.length; q++) {   // …después los repetidos no marcados
    const t = tabs[q], h = obtenerHoja(t);
    if (h) { try { infoG[t] = await LIMP_grupos_(t, h, planes[t]); } catch (e) { Logger.log('🧹 Grupos: ' + e.message); } }
  }

  // 1) vista previa (siempre se rehace)
  const filas = [['Pestaña', 'Fila a quitar', 'Fecha', 'Banco', 'Moneda', 'Monto', 'Beneficiario', 'Archivo', 'Pág', 'Procesado', 'Canal', 'Resultado', 'Fila original', 'Posibles']];
  tabs.forEach(function (t) {
    planes[t].forEach(function (p) {
      filas.push([t, p.fila, p.fecha, p.banco, p.moneda, p.monto, p.benef, p.archivo, p.pag, p.procesado, p.canal, p.motivo, p.orig || '', p.candidatos.join(' ')]);
    });
  });
  const resumen = tabs.map(function (t) {
    const pl = planes[t];
    const d = pl.filter(function (p) { return !p.verde; }), vv = pl.filter(function (p) { return p.verde; }), gi = infoG[t] || {};
    return t + ': ' + d.length + ' [DUPLICADO] (' + d.filter(function (p) { return p.orig; }).length + ' con original seguro) · ' +
      (gi.grupos || 0) + ' grupos mismo banco/monto/fecha: ' + vv.filter(function (p) { return p.orig; }).length + ' repetidos confirmados, ' +
      vv.filter(function (p) { return !p.orig; }).length + ' a revisar, ' + (gi.distintos || 0) + ' pares distintos · ' + (gi.releidas || 0) + ' relecturas IA';
  }).join(' | ');
  try {
    const carp = DriveApp.getFolderById(CFG.CARPETA_FOTOS_PROCESADOS_ID), nom = '🧹 Limpieza de duplicados — ' + (LIMP_APLICAR_ ? 'aplicada' : 'vista previa') + '.csv';
    const it = carp.getFilesByName(nom); while (it.hasNext()) it.next().setTrashed(true);
    carp.createFile(nom, LIMP_csv_(filas), MimeType.CSV);
  } catch (e) { Logger.log('🧹 CSV: ' + e.message); }
  if (!LIMP_APLICAR_) {
    props.setProperty('VCH_LIMP_DUP4', 'vista');
    if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'limpieza duplicados · vista previa', '', resumen);
    return;
  }

  // 2) aplicar (solo los de original seguro)
  const hechos = [];
  tabs.forEach(function (t) {
    const h = obtenerHoja(t);
    if (!h) return;
    const tit = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
    const pl = planes[t].filter(function (p) {
      if (!p.orig) return false;
      if (h.getLastColumn() <= 14) return true;
      const ext = h.getRange(p.fila, 15, 1, h.getLastColumn() - 14).getDisplayValues()[0];   // de la O en adelante
      const propio = ext.some(function (x, k) { const nm = tit[14 + k] || ''; return String(x).trim() && !/^resultado|anotaci/.test(nm); });
      if (propio) { p.motivo += ' · NO se borra: la fila tiene datos puestos a mano (empresa, comprobantes…)'; return false; }
      return true;
    });
    if (!pl.length) return;
    const ss = h.getParent(), nomR = '🛟 Respaldo duplicados ' + t;
    if (!ss.getSheetByName(nomR)) { const r = h.copyTo(ss).setName(nomR); r.hideSheet(); }
    // a) notas en la fila original (antes de borrar: las notas se mueven con su celda)
    pl.forEach(function (p) {
      const c = h.getRange(p.orig, 14);
      let nota = String(c.getNote() || '');
      const linea = '• ' + p.procesado + ' · ' + (p.canal || 'Carpeta Drive') + ' · «' + p.archivo + '»' + (p.pag ? ' pág ' + p.pag : '') + ' (limpieza 26/11)';
      if (nota.indexOf('«' + p.archivo + '»' + (p.pag ? ' pág ' + p.pag : '')) >= 0) return;
      if (nota.indexOf('🔁 Recibido también:') < 0) nota = (nota ? nota + '\n\n' : '') + '🔁 Recibido también:';
      nota += '\n' + linea;
      const veces = (nota.match(/^• /mg) || []).length + 1;
      const base = String(c.getDisplayValue() || '').replace(/\s*·\s*🔁 \d+ veces/g, '').trim();
      c.setNote(nota.slice(0, 9000)).setValue(base + ' · 🔁 ' + veces + ' veces');
    });
    // b) borrar las filas [DUPLICADO] seguras, de abajo hacia arriba (rangos seguidos de una vez)
    const borrar = pl.map(function (p) { return p.fila; }).sort(function (a, b) { return b - a; });
    for (let i = 0; i < borrar.length;) {
      let j = i; while (j + 1 < borrar.length && borrar[j + 1] === borrar[j] - 1) j++;
      h.deleteRows(borrar[j], i === j ? 1 : borrar[i] - borrar[j] + 1);
      i = j + 1;
    }
    // c) archivos que quedaron sin filas → Procesados/🔁 Repetidos
    const nn = h.getLastRow() - 1, quedan = {};
    if (nn > 0) h.getRange(2, 11, nn, 1).getValues().forEach(function (r) { quedan[String(r[0]).trim()] = 1; });
    const carpetas = t === CFG.SHEET_FOTOS ? carpetasParaTipo_('foto') : carpetasParaTipo_('original');
    let movidos = 0;
    const vistos = {};
    pl.forEach(function (p) {
      if (!p.archivo || quedan[p.archivo] || vistos[p.archivo]) return;
      vistos[p.archivo] = 1;
      try {
        const proc = DriveApp.getFolderById(carpetas.procesados), it = proc.getFilesByName(p.archivo);
        const fr = proc.getFoldersByName(REP_CARPETA_), dest = fr.hasNext() ? fr.next() : proc.createFolder(REP_CARPETA_);
        while (it.hasNext()) { it.next().moveTo(dest); movidos++; }
      } catch (e) { Logger.log('🧹 Mover ' + p.archivo + ': ' + e.message); }
    });
    hechos.push(t + ': ' + borrar.length + ' fila(s) borradas, ' + movidos + ' archivo(s) a 🔁 Repetidos');
  });
  props.setProperty('VCH_LIMP_DUP4', 'hecho');
  if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'limpieza duplicados · aplicada', '', hechos.join(' | ') + ' · ' + resumen);
}
