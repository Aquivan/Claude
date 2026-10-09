// ============================================================
// PROCESAMIENTO DE PDF
// ------------------------------------------------------------
// Devuelve { seDetuvo, resumenes } en vez de solo un booleano, para que
// tanto el escaneo de carpeta (procesarVouchers) como el webhook de
// Telegram puedan reaccionar: el primero solo mira seDetuvo, el segundo
// ademas usa resumenes para responder en el chat.
//
// OPTIMIZACION: las paginas se procesan en LOTES (CFG.PAGINAS_POR_LOTE)
// en vez de una llamada a Gemini por pagina. Gemini soporta documentos de
// varias paginas en una sola llamada, asi que se arma un PDF temporal con
// varias paginas juntas, se le agrega al prompt la instruccion de decir en
// que pagina encontro cada voucher (ver envolverPromptParaLote_ en
// Prompts.js), y se reparten los resultados por pagina real. Esto reduce
// tanto el numero de llamadas a Gemini como las pausas fijas entre ellas
// -- sin necesitar una cuenta de pago, porque menos llamadas tambien
// significa menos riesgo de toparse con el limite de peticiones por
// minuto de la cuenta gratuita.
//
// La miniatura de imagen que va en la celda SI se sigue generando pagina
// por pagina (esa parte no se puede agrupar: cada fila necesita su propia
// imagen), pero ahora se genera solo cuando una pagina realmente tiene un
// voucher, no para todas las paginas del lote.
// ============================================================

async function procesarArchivoPDF(archivo, ctx, inicioEjecucion, LIMITE, remitente, carpetas) {
  remitente = remitente || '';
  carpetas  = carpetas || carpetasParaTipo_('original');
  cargarPdfLib();

  const nombre     = archivo.getName();
  const blob       = archivo.getBlob();
  const rawPdfData = new Uint8Array(blob.getBytes());
  const pdfDoc     = await PDFLib.PDFDocument.load(rawPdfData);
  const totalPags  = pdfDoc.getPageCount();

  const startIdx = obtenerUltimaPaginaProcesadaCtx(ctx, nombre);

  if (startIdx >= totalPags) {
    moverArchivo(archivo, carpetas.entrada, carpetas.procesados);
    return { seDetuvo: false, resumenes: [] };
  }

  if (startIdx > 0) {
    Logger.log('REANUDANDO: ' + nombre + ' desde pag. ' + (startIdx + 1) + '/' + totalPags);
  } else {
    Logger.log('Iniciando PDF de ' + totalPags + ' paginas: ' + nombre);
  }

  let pdfIncompleto = false;
  let alguno = false;
  const resumenes = [];
  const TAM_LOTE = Math.max(1, CFG.PAGINAS_POR_LOTE || 1);

  for (let loteInicio = startIdx; loteInicio < totalPags; loteInicio += TAM_LOTE) {
    if (Date.now() - inicioEjecucion > LIMITE) {
      Logger.log('Limite de tiempo antes del lote en pag. ' + (loteInicio + 1) + '/' + totalPags + '. Progreso guardado.');
      pdfIncompleto = true;
      break;
    }

    const loteFin = Math.min(loteInicio + TAM_LOTE, totalPags); // indice exclusivo
    const indicesLote = [];
    for (let i = loteInicio; i < loteFin; i++) indicesLote.push(i);
    const numPaginasLote = indicesLote.length;

    try {
      // Un solo PDF con todas las paginas del lote juntas, para UNA sola
      // llamada a Gemini (en vez de una por pagina).
      const loteDoc  = await PDFLib.PDFDocument.create();
      const copiadas = await loteDoc.copyPages(pdfDoc, indicesLote);
      copiadas.forEach(function (p) { loteDoc.addPage(p); });
      const loteBytes  = await loteDoc.save();
      const loteBlob   = Utilities.newBlob([...new Int8Array(loteBytes)], MimeType.PDF, 'lote_' + (loteInicio + 1) + '.pdf');
      const loteBase64 = Utilities.base64Encode(loteBlob.getBytes());

      const vouchersLote = numPaginasLote > 1
        ? llamarGemini(loteBase64, 'application/pdf', true, numPaginasLote)
        : llamarGemini(loteBase64, 'application/pdf', true);

      // Se agrupan los resultados por la pagina relativa (1..numPaginasLote)
      // que Gemini indico en cada voucher. Si viene sin "pagina" (lote de
      // una sola pagina, o el modelo no la incluyo) se asume la pagina 1.
      const porPagina = {};
      (vouchersLote || []).forEach(function (v) {
        let p = parseInt(v.pagina, 10);
        if (isNaN(p) || p < 1 || p > numPaginasLote) p = 1;
        if (!porPagina[p]) porPagina[p] = [];
        porPagina[p].push(v);
      });

      for (let rel = 1; rel <= numPaginasLote; rel++) {
        const indiceGlobal     = loteInicio + (rel - 1);
        const numeroPaginaReal = indiceGlobal + 1;
        const vouchersPage     = porPagina[rel] || [];
        let filasInsertadas    = 0;
        let miniBlobPagina     = null; // se arma solo si esta pagina de verdad tiene un voucher

        for (let j = 0; j < vouchersPage.length; j++) {
          const v      = vouchersPage[j];
          const montoV = parsearMonto(v.monto);

          if (esDuplicadoCtx(ctx, v.nOperacion, v.banco, montoV)) {
            Logger.log('  Pag.' + numeroPaginaReal + ' duplicado: ' + v.nOperacion + ' / ' + v.banco + ' / ' + montoV);
            escribirFilaVoucher(ctx, {
              fecha: v.fecha, nOperacion: '[DUPLICADO]', banco: v.banco, moneda: v.moneda,
              monto: montoV, proveedor: v.proveedor, idCliente: v.idCliente,
              cliente: v.cliente, descripcion: v.descripcion
            }, nombre, numeroPaginaReal, 'Duplicado exacto', remitente);
            flushSeguro_();
            resumenes.push({ banco: v.banco, moneda: v.moneda, monto: montoV, nOperacion: v.nOperacion, duplicado: true });
            filasInsertadas++;
            continue;
          }

          const fila = escribirFilaVoucher(ctx, v, nombre, numeroPaginaReal, null, remitente);
          registrarEnIndice(ctx, v.nOperacion, v.banco, montoV);

          if (!miniBlobPagina) {
            const miniDoc  = await PDFLib.PDFDocument.create();
            const [pagCop] = await miniDoc.copyPages(pdfDoc, [indiceGlobal]);
            miniDoc.addPage(pagCop);
            const miniBytes = await miniDoc.save();
            miniBlobPagina = Utilities.newBlob([...new Int8Array(miniBytes)], MimeType.PDF, 'pag_' + numeroPaginaReal + '.pdf');
          }
          insertarImagenDesdeBlob(ctx.hoja, fila, 10, miniBlobPagina, 'Voucher ' + numeroPaginaReal);
          flushSeguro_();   // UN solo flush por voucher
          alguno = true;
          filasInsertadas++;
          resumenes.push({ banco: v.banco, moneda: v.moneda, monto: montoV, nOperacion: v.nOperacion, duplicado: false });
        }

        if (filasInsertadas === 0) {
          escribirFilaVoucher(ctx, {
            fecha:'', nOperacion:'[OMITIDO]', banco:'', moneda:'', monto:0,
            proveedor:'Pagina sin voucher nuevo o legible', idCliente:'', cliente:'', descripcion:''
          }, nombre, numeroPaginaReal, 'Vacio / Ignorado', remitente);
          flushSeguro_();
        }
      }

    } catch (eLote) {
      if (eLote.message === 'API_SATURADA') {
        Logger.log('API agotada en el lote de pag. ' + (loteInicio + 1) + '-' + loteFin + '. Reanuda en la siguiente corrida.');
        pdfIncompleto = true;
        break;
      }
      Logger.log('Error en el lote de pag. ' + (loteInicio + 1) + '-' + loteFin + ': ' + eLote.message);
      // Se registra UNA fila de error para todo el lote (no se puede saber
      // cual pagina especifica fallo) y se avanza el checkpoint hasta el
      // final del lote, para no quedar atascado reintentando el mismo
      // lote roto una y otra vez.
      escribirFilaVoucher(ctx, {
        fecha:'', nOperacion:'[ERROR]', banco:'', moneda:'', monto:0,
        proveedor:'Error tecnico (lote pag. ' + (loteInicio + 1) + '-' + loteFin + '): ' + eLote.message,
        idCliente:'', cliente:'', descripcion:''
      }, nombre, loteFin, 'Error tecnico', remitente);
      flushSeguro_();
    }

    Utilities.sleep(CFG.PAUSA_MS);
  }

  if (!pdfIncompleto) {
    moverArchivo(archivo, carpetas.entrada, (alguno || startIdx > 0) ? carpetas.procesados : CFG.CARPETA_DESCARTADOS_ID);
  }

  return { seDetuvo: pdfIncompleto, resumenes: resumenes };
}
