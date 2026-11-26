// ============================================================
// 🔁 VOUCHERS REPETIDOS — acordado con el usuario el 26/11/2026
// ------------------------------------------------------------
// Antes, un voucher que ya estaba (mismo N° de operación, banco y monto en la pestaña) se escribía como fila «[DUPLICADO]».
// Ahora NO se crea fila:
//   · en la fila del voucher ORIGINAL, la columna «Canal» (N) dice «… · 🔁 2 veces» y su NOTA lista quién más lo mandó,
//     cuándo y con qué archivo/página («🔁 Recibido también: • 26/11 10:15 · Telegram: Sonia · «26-11-26 Sonia.jpg» pág 1»);
//   · si TODO el archivo era repetido (lo común: alguien reenvía la misma foto), va a «Procesados/🔁 Repetidos», no a
//     Procesados ni a Descartados.
// «Casi iguales» (mismo banco y monto, fecha a ≤ 5 días, N° de operación distinto en un solo carácter: un dígito mal leído)
// SÍ se registran, pero la nueva fila queda marcada en «Canal»: «⚠️ ¿repetido de Fotos!395?» (con nota) para revisar.
// Telegram / WhatsApp / Cobranzas leen esa nota para avisar «ya estaba registrado (Fotos!395)».
// ============================================================

var REP_CARPETA_ = '🔁 Repetidos';
var REP_COL_CANAL_ = 14;   // N

function REP_normOp_(op) { return String(op || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, ''); }

/** Índices de la pestaña (los llena crearContexto y registrarEnIndice). */
function REP_indexar_(ctx, op, banco, monto, fila, fecha) {
  if (!op || /^\[/.test(String(op))) return;
  ctx.filaDup = ctx.filaDup || {};
  ctx.porMonto = ctx.porMonto || {};
  ctx.filaDup[claveDuplicado(op, banco, monto)] = fila;
  const k = String(banco || '').trim().toLowerCase() + '|' + (Math.round((parseFloat(monto) || 0) * 100) / 100).toFixed(2);
  (ctx.porMonto[k] = ctx.porMonto[k] || []).push({ op: REP_normOp_(op), fila: fila, fecha: fecha instanceof Date ? fecha.getTime() : 0 });
}

/** Fila del voucher original de un duplicado exacto (0 si no se sabe). */
function REP_original_(ctx, v, monto) { return (ctx.filaDup || {})[claveDuplicado(v.nOperacion, v.banco, monto)] || 0; }

/** ¿Un solo carácter de diferencia? (cambiado, de más o de menos) */
function REP_unoDistinto_(a, b) {
  if (a === b || !a || !b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}

/** «Casi igual» a uno que ya está: fila del parecido o 0. */
function REP_casi_(ctx, v, monto) {
  const k = String(v.banco || '').trim().toLowerCase() + '|' + (Math.round((parseFloat(monto) || 0) * 100) / 100).toFixed(2);
  const lista = (ctx.porMonto || {})[k] || [], op = REP_normOp_(v.nOperacion);
  if (!op || !lista.length) return 0;
  let f = null; try { f = parsearFecha(v.fecha); } catch (e) {}
  const t = f instanceof Date ? f.getTime() : 0;
  for (let i = 0; i < lista.length; i++) {
    const x = lista[i];
    if (t && x.fecha && Math.abs(t - x.fecha) > 5 * 86400000) continue;
    if (op === x.op || REP_unoDistinto_(op, x.op)) return x.fila;   // igual salvo ceros/guiones, o un carácter distinto
  }
  return 0;
}

function REP_cuando_() { return Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'); }

/** Repetido exacto: se anota en la fila original (se aplica después de escribir las filas del lote). */
function REP_anotar_(ctx, filaOrig, nombre, pag, remitente) {
  if (!filaOrig) return;
  (ctx.repPend = ctx.repPend || []).push({ fila: filaOrig, tipo: 'rep',
    linea: '• ' + REP_cuando_() + ' · ' + (remitente || 'Carpeta Drive') + ' · «' + nombre + '»' + (pag ? ' pág ' + pag : '') });
}

/** Casi igual: la fila NUEVA queda marcada para revisar. */
function REP_marcarCasi_(ctx, filaNueva, filaParecida) {
  (ctx.repPend = ctx.repPend || []).push({ fila: filaNueva, tipo: 'casi',
    linea: '⚠️ ¿Repetido de ' + ctx.hoja.getName() + '!' + filaParecida + '? Mismo banco y monto, fecha cercana y N° de operación casi igual ' +
      '(¿un dígito mal leído?). Revise las dos: si es el mismo voucher, borre una; si son distintos, no haga nada.' });
}

/** Escribe en «Canal» (valor + nota) lo pendiente. */
function REP_aplicar_(ctx) {
  const pend = ctx.repPend || [];
  ctx.repPend = [];
  if (!pend.length) return;
  pend.forEach(function (p) {
    try {
      const c = ctx.hoja.getRange(p.fila, REP_COL_CANAL_);
      let nota = String(c.getNote() || ''), val = String(c.getDisplayValue() || '');
      const base = val.replace(/\s*·\s*(🔁 \d+ veces|⚠️ ¿repetido\?)/g, '').trim();
      if (p.tipo === 'rep') {
        if (nota.indexOf(p.linea.replace(/^• \S+ \S+ · /, '')) >= 0) return;   // ya anotado (relectura del mismo archivo)
        if (nota.indexOf('🔁 Recibido también:') < 0) nota = (nota ? nota + '\n\n' : '') + '🔁 Recibido también:';
        nota += '\n' + p.linea;
        const veces = (nota.match(/^• /mg) || []).length + 1;
        c.setValue(base + ' · 🔁 ' + veces + ' veces' + (/⚠️ ¿repetido\?/.test(val) ? ' · ⚠️ ¿repetido?' : ''));
      } else {
        if (nota.indexOf(p.linea) >= 0) return;
        nota = (nota ? nota + '\n\n' : '') + p.linea;
        c.setValue(val.indexOf('⚠️ ¿repetido?') >= 0 ? val : (val ? val + ' · ' : '') + '⚠️ ¿repetido?');
      }
      c.setNote(nota.slice(0, 9000));
    } catch (e) { Logger.log('🔁 Repetidos: ' + e.message); }
  });
  flushSeguro_();
}

/** Todo el archivo era repetido: va a «Procesados/🔁 Repetidos». */
function REP_moverArchivo_(archivo, carpetas) {
  try {
    const proc = DriveApp.getFolderById(carpetas.procesados);
    const it = proc.getFoldersByName(REP_CARPETA_);
    const dest = it.hasNext() ? it.next() : proc.createFolder(REP_CARPETA_);
    moverArchivo(archivo, carpetas.entrada, dest.getId());
  } catch (e) { Logger.log('🔁 Mover a Repetidos: ' + e.message); moverArchivo(archivo, carpetas.entrada, carpetas.procesados); }
}
