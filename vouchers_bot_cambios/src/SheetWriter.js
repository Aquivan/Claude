// ============================================================
// COMPATIBILIDAD CON "TABLAS" DE GOOGLE SHEETS
// ------------------------------------------------------------
// PROBLEMA REAL QUE ESTO RESUELVE:
// Cuando la hoja esta convertida en una "Tabla" de Sheets, sus columnas
// quedan TIPADAS (Fecha, Numero, Texto...). Al intentar aplicar
// setNumberFormat() sobre una columna tipada, Sheets lanza:
//   "You can't set the number format of cells in a typed column."
//
// Lo traicionero es COMO se lanza ese error. Apps Script no ejecuta las
// operaciones de hoja en el momento: las agrupa en lote y las aplica
// despues. Por eso un try/catch envolviendo solo a setNumberFormat NO
// sirve -- la llamada "pasa" sin error, y la excepcion recien estalla en
// el siguiente SpreadsheetApp.flush(), que esta fuera de ese try. Ahi el
// error escapaba hasta el manejador general y convertia un voucher ya
// extraido correctamente en una fila [ERROR] con monto 0.
//
// SOLUCION:
// 1. Forzar el flush DENTRO del try, para que el error diferido se
//    capture justo donde corresponde.
// 2. Si falla, recordarlo en memoria y no volver a intentarlo en el resto
//    de la ejecucion (no tiene sentido reintentar 100 veces lo mismo).
// 3. En una Tabla no se pierde nada visualmente: la propia columna tipada
//    ya formatea fechas y montos por su cuenta.
//
// Resultado: el sistema funciona igual con Tabla o sin Tabla.
// ============================================================

// Estado de la ejecucion actual. Se reinicia al inicio de cada corrida
// (ver reiniciarEstadoFormato_), asi que si el usuario quita la Tabla el
// formato vuelve a aplicarse con normalidad sin tocar nada mas.
const ESTADO_FORMATO_ = { bloqueado: false };

function reiniciarEstadoFormato_() {
  ESTADO_FORMATO_.bloqueado = false;
}

function formatoNumericoBloqueado_() {
  return ESTADO_FORMATO_.bloqueado;
}

function flushSeguro_() {
  try {
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    Logger.log('  Aviso: flush con incidencias (' + e.message + '). Se continua.');
    return false;
  }
}

function aplicarFormatoNumerico_(hoja, fila) {
  if (ESTADO_FORMATO_.bloqueado) return;

  try {
    hoja.getRange(fila, 1).setNumberFormat('dd/MM/yyyy');
    hoja.getRange(fila, 5).setNumberFormat('#,##0.00');
    // Clave: forzamos aqui la aplicacion real para que, si la columna esta
    // tipada por una Tabla, el error salte DENTRO de este try.
    SpreadsheetApp.flush();
  } catch (e) {
    ESTADO_FORMATO_.bloqueado = true;
    Logger.log('Formato numerico deshabilitado para esta ejecucion: ' + e.message +
               ' | La hoja parece ser una "Tabla" de Sheets con columnas tipadas. ' +
               'No es un problema: la Tabla ya aplica su propio formato. ' +
               'Los datos se siguen escribiendo normalmente.');
  }
}

// ============================================================
// ESCRITURA EN LA HOJA
// ------------------------------------------------------------
// Ya NO llama a getLastRow() ni a flush() por dentro. La fila se lleva
// en memoria (ctx.ultimaFila) y el flush lo hace quien la invoca, una
// sola vez por voucher.
// ============================================================

function escribirFilaVoucher(ctx, voucher, nombreArchivo, numeroPagina, estadoColumnaJ, remitente) {
  const hoja      = ctx.hoja;
  const fila      = ctx.ultimaFila + 1;
  const fechaProc = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
  const monto     = parsearMonto(voucher.monto);
  const fechaOp   = parsearFecha(voucher.fecha);
  const origen    = remitente || 'Manual / Carpeta Drive';

  const filaValores = [
    fechaOp,
    voucher.nOperacion  || '',
    voucher.banco       || '',
    voucher.moneda      || '',
    monto,
    voucher.proveedor   || '',
    voucher.idCliente   || '',
    voucher.cliente     || '',
    voucher.descripcion || '',
    estadoColumnaJ || '',
    nombreArchivo,
    fechaProc,
    numeroPagina,
    origen
  ];

  // ⚡ Modo lote (ctx.diferir, PdfProcessor.js): la fila se guarda en memoria y se escriben TODAS las del lote juntas
  // con escribirPendientes_ (1 escritura + 1 formato + 1 confirmación por lote, en vez de 3-4 por voucher).
  if (ctx.diferir) {
    ctx.pend = ctx.pend || [];
    ctx.pend.push({ fila: fila, valores: filaValores, nota: voucher._lector || '',
      args: [voucher, nombreArchivo, numeroPagina, estadoColumnaJ, remitente] });
    ctx.ultimaFila = fila;
    const nomD = (nombreArchivo || '').trim();
    if (nomD && numeroPagina && (!ctx.indicePag[nomD] || numeroPagina > ctx.indicePag[nomD])) ctx.indicePag[nomD] = numeroPagina;
    return fila;
  }

  // ⚡ Primero la fila COMPLETA de una sola vez (1 escritura en vez de 14: varios segundos menos por voucher).
  // Si falla (una columna tipada por una "Tabla" de Sheets), recién ahí se escribe celda por celda como siempre.
  const tEscribir = Date.now();
  let filaOk = false;
  try {
    hoja.getRange(fila, 1, 1, filaValores.length).setValues([filaValores]);
    filaOk = true;
  } catch (eFila) {
    Logger.log('  Fila ' + fila + ' de una vez no se pudo (' + eFila.message + '): se escribe celda por celda.');
  }

  // --- ESCRITURA CELDA POR CELDA (solo si la fila completa falló) ---
  // Si una columna puntual esta tipada de forma incompatible por una
  // "Tabla" de Sheets, esa celda especifica queda vacia (se ve en el log),
  // pero las demas columnas se escriben normalmente y el procesamiento
  // NUNCA se detiene.
  for (let c = 0; c < filaValores.length && !filaOk; c++) {
    try {
      hoja.getRange(fila, c + 1).setValue(filaValores[c]);
    } catch (eCelda) {
      Logger.log('  Aviso: no se pudo escribir columna ' + (c + 1) + ' de la fila ' + fila +
                 ' (' + eCelda.message + '). Probablemente esa columna esta tipada de forma ' +
                 'incompatible por una "Tabla" de Sheets. Se omite solo esa celda y se continua.');
    }
  }

  // Confirmamos los valores ANTES de tocar el formato. Si alguna escritura
  // fallara de forma diferida, el error se captura aqui y no arrastra al
  // resto del procesamiento.
  flushSeguro_();

  aplicarFormatoNumerico_(hoja, fila);
  if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.escribir += Date.now() - tEscribir;   // ⏱ Diagnostico.js

  // 🧾 Si este voucher NO lo leyó Gemini (o Gemini falló antes), nota en el N° de operación: quién lo leyó (Lectores.js).
  if (voucher._lector) {
    try { hoja.getRange(fila, 2).setNote(voucher._lector); } catch (eNota) {}
  }

  ctx.ultimaFila = fila;

  // Mantenemos el indice de paginas al dia para este mismo run.
  const nom = (nombreArchivo || '').trim();
  if (nom && numeroPagina) {
    if (!ctx.indicePag[nom] || numeroPagina > ctx.indicePag[nom]) {
      ctx.indicePag[nom] = numeroPagina;
    }
  }

  return fila;
}

/** Escribe juntas las filas guardadas en modo lote (ctx.pend). Si la escritura junta falla (columna tipada por una
 *  «Tabla» de Sheets), se escriben una por una como siempre. */
function escribirPendientes_(ctx) {
  const pend = ctx.pend || [];
  ctx.pend = [];
  if (!pend.length) return;
  const t0 = Date.now(), hoja = ctx.hoja, primera = pend[0].fila;
  const seguidas = pend.every(function (p, i) { return p.fila === primera + i; });
  let ok = false;
  if (seguidas) {
    try {
      hoja.getRange(primera, 1, pend.length, pend[0].valores.length).setValues(pend.map(function (p) { return p.valores; }));
      SpreadsheetApp.flush();
      ok = true;
    } catch (e) { Logger.log('  Filas del lote juntas no se pudo (' + e.message + '): una por una.'); }
  }
  if (!ok) {   // como antes: fila por fila (y celda por celda si hace falta)
    const ult = ctx.ultimaFila;
    pend.forEach(function (p) {
      ctx.ultimaFila = p.fila - 1;
      const a = p.args;
      escribirFilaVoucher(ctx, a[0], a[1], a[2], a[3], a[4]);
    });
    ctx.ultimaFila = Math.max(ult, ctx.ultimaFila);
    if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.escribir += Date.now() - t0;
    return;
  }
  if (!ESTADO_FORMATO_.bloqueado) {
    try {
      hoja.getRange(primera, 1, pend.length, 1).setNumberFormat('dd/MM/yyyy');
      hoja.getRange(primera, 5, pend.length, 1).setNumberFormat('#,##0.00');
      SpreadsheetApp.flush();
    } catch (eF) {
      ESTADO_FORMATO_.bloqueado = true;
      Logger.log('Formato numerico deshabilitado para esta ejecucion: ' + eF.message);
    }
  }
  pend.forEach(function (p) { if (p.nota) { try { hoja.getRange(p.fila, 2).setNote(p.nota); } catch (eN) {} } });
  if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.escribir += Date.now() - t0;
}

function obtenerHoja(nombrePestana) {
  return SpreadsheetApp.openById(CFG.SPREADSHEET_ID).getSheetByName(nombrePestana || CFG.SHEET_ORIGINALES);
}

function asegurarCabeceras(hoja) {
  const CAB = [
    'Fecha depósito', 'N° operación', 'Banco', 'Moneda', 'Monto',
    'Beneficiario', 'Doc. depositante', 'Depositante',
    'Descripción', 'Imagen', 'Archivo', 'Procesado', 'Pág.',
    'Canal'
  ];
  if (hoja.getRange(1, 1, 1, CAB.length).getValues()[0].every(function(c) { return c === ''; })) {
    hoja.getRange(1, 1, 1, CAB.length).setValues([CAB])
      .setBackground('#1a237e').setFontColor('#ffffff').setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
}
