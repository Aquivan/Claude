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

function VCH_limpiezaDuplicados_() {
  const props = PropertiesService.getScriptProperties(), estado = props.getProperty('VCH_LIMP_DUP') || '';
  if (estado === 'hecho' || (estado === 'vista' && !LIMP_APLICAR_)) return;
  const tabs = [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS], planes = {};
  tabs.forEach(function (t) { const h = obtenerHoja(t); planes[t] = h ? LIMP_plan_(h) : []; });

  // 1) vista previa (siempre se rehace)
  const filas = [['Pestaña', 'Fila [DUPLICADO]', 'Fecha', 'Banco', 'Moneda', 'Monto', 'Beneficiario', 'Archivo', 'Pág', 'Procesado', 'Canal', 'Resultado', 'Fila original', 'Posibles']];
  tabs.forEach(function (t) {
    planes[t].forEach(function (p) {
      filas.push([t, p.fila, p.fecha, p.banco, p.moneda, p.monto, p.benef, p.archivo, p.pag, p.procesado, p.canal, p.motivo, p.orig || '', p.candidatos.join(' ')]);
    });
  });
  const resumen = tabs.map(function (t) {
    const pl = planes[t];
    return t + ': ' + pl.length + ' [DUPLICADO] · ' + pl.filter(function (p) { return p.orig; }).length + ' con original seguro · ' +
      pl.filter(function (p) { return !p.orig && p.candidatos.length; }).length + ' dudosos · ' + pl.filter(function (p) { return !p.candidatos.length; }).length + ' sin original';
  }).join(' | ');
  try {
    const carp = DriveApp.getFolderById(CFG.CARPETA_FOTOS_PROCESADOS_ID), nom = '🧹 Limpieza de duplicados — ' + (LIMP_APLICAR_ ? 'aplicada' : 'vista previa') + '.csv';
    const it = carp.getFilesByName(nom); while (it.hasNext()) it.next().setTrashed(true);
    carp.createFile(nom, LIMP_csv_(filas), MimeType.CSV);
  } catch (e) { Logger.log('🧹 CSV: ' + e.message); }
  if (!LIMP_APLICAR_) {
    props.setProperty('VCH_LIMP_DUP', 'vista');
    if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'limpieza duplicados · vista previa', '', resumen);
    return;
  }

  // 2) aplicar (solo los de original seguro)
  const hechos = [];
  tabs.forEach(function (t) {
    const h = obtenerHoja(t), pl = planes[t].filter(function (p) { return p.orig; });
    if (!h || !pl.length) return;
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
  props.setProperty('VCH_LIMP_DUP', 'hecho');
  if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'limpieza duplicados · aplicada', '', hechos.join(' | ') + ' · ' + resumen);
}
