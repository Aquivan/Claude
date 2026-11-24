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

  const tAbrir     = Date.now();
  const nombre     = archivo.getName();
  const blob       = archivo.getBlob();
  const rawPdfData = new Uint8Array(blob.getBytes());
  const pdfDoc     = await PDFLib.PDFDocument.load(rawPdfData);
  const totalPags  = pdfDoc.getPageCount();
  if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.pdf += Date.now() - tAbrir;   // ⏱ abrir el PDF
  const miniPagina = {};   // ⚡ página → imagen 800 px ya hecha para NVIDIA/Groq (se reusa para la celda)

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

  // ⚡ PDF largo (más de un lote): primero se pregunta en paralelo qué Gemini está respondiendo (Lectores.js).
  if (totalPags - startIdx > Math.max(1, CFG.PAGINAS_POR_LOTE || 1) && typeof LEC_sondeoGemini_ === 'function') {
    const tSondeo = Date.now();
    try { LEC_sondeoGemini_(); } catch (eS) { Logger.log('Sondeo: ' + eS.message); }
    if (typeof TIEMPOS_ !== 'undefined') { TIEMPOS_.ia += Date.now() - tSondeo; TIEMPOS_.sondeo = (TIEMPOS_.sondeo || 0) + Date.now() - tSondeo; }
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
      const tSep     = Date.now();
      const loteDoc  = await PDFLib.PDFDocument.create();
      const copiadas = await loteDoc.copyPages(pdfDoc, indicesLote);
      copiadas.forEach(function (p) { loteDoc.addPage(p); });
      const loteBytes  = await loteDoc.save();
      const loteBlob   = Utilities.newBlob([...new Int8Array(loteBytes)], MimeType.PDF, 'lote_' + (loteInicio + 1) + '.pdf');
      const loteBase64 = Utilities.base64Encode(loteBlob.getBytes());
      if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.pdf += Date.now() - tSep;   // ⏱ separar las páginas del lote

      let vouchersLote, paginasLeidas = numPaginasLote, cortado = false;
      try {
        vouchersLote = numPaginasLote > 1
          ? llamarGemini(loteBase64, 'application/pdf', true, numPaginasLote)
          : llamarGemini(loteBase64, 'application/pdf', true);
      } catch (eGemini) {
        // 🧾 Lectores de respaldo (Lectores.js): el lote de varias paginas solo lo lee Gemini. Si fallo y hay
        // NVIDIA o Groq prendidos, se pide pagina por pagina: cada una prueba Gemini y luego los de respaldo
        // (que la reciben convertida en imagen).
        if (numPaginasLote <= 1 || typeof LEC_hayRespaldo_ !== 'function' || !LEC_hayRespaldo_()) throw eGemini;
        Logger.log('Lote pag. ' + (loteInicio + 1) + '-' + loteFin + ': Gemini fallo (' + eGemini.message + '). Se lee pagina por pagina con los lectores de respaldo.');
        vouchersLote = [];
        // ⚡ Las páginas del lote van A LA VEZ a NVIDIA (si queda tiempo para esperar la más lenta, ~100 s);
        // las que fallen se leen después una por una como siempre.
        let par = null;
        if (typeof LEC_leerParalelo_ === 'function' && Date.now() - inicioEjecucion < LIMITE - 100000) {
          const tSepP = Date.now(), pdfsPag = [];
          for (let k = 0; k < numPaginasLote; k++) {
            const d1 = await PDFLib.PDFDocument.create();
            const [pg] = await d1.copyPages(pdfDoc, [indicesLote[k]]);
            d1.addPage(pg);
            pdfsPag.push(Utilities.base64Encode(Utilities.newBlob([...new Int8Array(await d1.save())], MimeType.PDF, 'pag.pdf').getBytes()));
          }
          if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.pdf += Date.now() - tSepP;
          const tPar = Date.now();
          try { par = LEC_leerParalelo_(pdfsPag); } catch (ePar) { Logger.log('Lectura en paralelo falló: ' + ePar.message + ' → una por una.'); par = null; }
          if (typeof TIEMPOS_ !== 'undefined') { TIEMPOS_.ia += Date.now() - tPar; if (par) TIEMPOS_.lecturas += numPaginasLote; }
        }
        for (let k = 0; k < numPaginasLote; k++) {
          if (par && par[k] && par[k].arr) {
            const nota = '🤖 Leído por ' + par[k].quien + ' (en paralelo)';
            par[k].arr.forEach(function (v) { if (v && typeof v === 'object') { v.pagina = k + 1; v._lector = nota; vouchersLote.push(v); } });
            if (par[k].mini) miniPagina[indicesLote[k]] = par[k].mini;
            continue;
          }
          // ⏱ Cada página con respaldo puede tardar ~40 s: si no queda tiempo, se guarda lo leído y se sigue en la próxima
          // ejecución desde la página siguiente (antes se pasaba de los 6 min de Google y el PDF se quedaba atascado).
          if (Date.now() - inicioEjecucion > LIMITE - 45000) {
            paginasLeidas = k; cortado = true;
            Logger.log('Sin tiempo: se leyeron ' + k + ' de ' + numPaginasLote + ' páginas del lote; sigue en la próxima ejecución.');
            break;
          }
          const tUno = Date.now();
          const unoDoc = await PDFLib.PDFDocument.create();
          const [pagUno] = await unoDoc.copyPages(pdfDoc, [indicesLote[k]]);
          unoDoc.addPage(pagUno);
          const unoB64 = Utilities.base64Encode(Utilities.newBlob([...new Int8Array(await unoDoc.save())], MimeType.PDF, 'pag.pdf').getBytes());
          if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.pdf += Date.now() - tUno;
          if (typeof LEC_ULTIMA_MINI_ !== 'undefined') LEC_ULTIMA_MINI_ = null;
          let leidosK;
          try { leidosK = llamarGemini(unoB64, 'application/pdf', true) || []; }
          catch (eK) {
            // 💾 Si ya se leyeron páginas de este lote, se GUARDAN y se sigue desde esta en la próxima vuelta
            // (antes, si una página fallaba, se perdían también las ya leídas y se volvían a leer).
            if (k === 0) throw eK;
            paginasLeidas = k; cortado = true;
            Logger.log('Pág. ' + (indicesLote[k] + 1) + ': ninguna IA pudo (' + eK.message + '). Se guardan las ' + k + ' ya leídas; sigue en la próxima vuelta.');
            break;
          }
          leidosK.forEach(function (v) { v.pagina = k + 1; vouchersLote.push(v); });
          if (typeof LEC_ULTIMA_MINI_ !== 'undefined' && LEC_ULTIMA_MINI_) miniPagina[indicesLote[k]] = LEC_ULTIMA_MINI_;
        }
      }

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

      // ⚡ Imágenes para las celdas de TODAS las páginas con voucher nuevo, A LA VEZ (antes una por una, ~7 s cada una
      // esperando la miniatura de Drive). Las que ya trajo NVIDIA/Groq no se repiten. Si algo falla, cada una sigue como antes.
      if (typeof LEC_imagenesParalelo_ === 'function') {
        const faltan = [];
        for (let rel = 1; rel <= paginasLeidas; rel++) {
          const ig = loteInicio + (rel - 1);
          if (miniPagina[ig]) continue;
          if ((porPagina[rel] || []).some(function (v) { return !esDuplicadoCtx(ctx, v.nOperacion, v.banco, parsearMonto(v.monto)); })) faltan.push(ig);
        }
        if (faltan.length >= 2) {
          const tImgs = Date.now();
          try {
            const pdfsImg = [];
            for (let q = 0; q < faltan.length; q++) {
              const dI = await PDFLib.PDFDocument.create();
              const [pI] = await dI.copyPages(pdfDoc, [faltan[q]]);
              dI.addPage(pI);
              pdfsImg.push(Utilities.base64Encode(Utilities.newBlob([...new Int8Array(await dI.save())], MimeType.PDF, 'pag.pdf').getBytes()));
            }
            const imgs = LEC_imagenesParalelo_(pdfsImg, 800);
            let n = 0;
            imgs.forEach(function (im, q) { if (im && (im.mini || im.jpg)) { miniPagina[faltan[q]] = im.mini || im.jpg; n++; } });
            Logger.log('⚡ Imágenes de ' + n + '/' + faltan.length + ' páginas preparadas a la vez (' + Math.round((Date.now() - tImgs) / 100) / 10 + ' s).');
          } catch (eImg) { Logger.log('Imágenes a la vez: ' + eImg.message + ' → una por una.'); }
          if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.imagen += Date.now() - tImgs;
        }
      }

      for (let rel = 1; rel <= paginasLeidas; rel++) {
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

          // ⚡ Si NVIDIA/Groq leyó esta página, su imagen ya está hecha: va directo a la celda (sin Drive ni esperas).
          if (miniPagina[indiceGlobal] && IMG_medir_(function () { return _insertarBase64EnCelda(ctx.hoja, fila, 10, miniPagina[indiceGlobal], 'image/jpeg', 'Voucher ' + numeroPaginaReal); })) {
            if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.imagenReuso++;
            flushSeguro_();
            alguno = true;
            filasInsertadas++;
            resumenes.push({ banco: v.banco, moneda: v.moneda, monto: montoV, nOperacion: v.nOperacion, duplicado: false });
            continue;
          }
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

      if (cortado) { pdfIncompleto = true; break; }   // ⏱ lo que falta, en la próxima ejecución (1 min)

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
    if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.pausas += CFG.PAUSA_MS;
  }

  if (!pdfIncompleto) {
    moverArchivo(archivo, carpetas.entrada, (alguno || startIdx > 0) ? carpetas.procesados : CFG.CARPETA_DESCARTADOS_ID);
  }

  return { seDetuvo: pdfIncompleto, resumenes: resumenes };
}
