// ============================================================
// PROCESAMIENTO DE IMAGENES  (copia en vouchers_bot_cambios: 🔁 repetidos sin fila, Repetidos.js — 26/11/2026)
// ------------------------------------------------------------
// remitente es opcional: '' (o ausente) para archivos que llegaron por la
// carpeta de Drive; una cadena tipo "@usuario (id 123456)" cuando el
// archivo llego por el bot de Telegram. Se guarda en la columna N.
//
// Devuelve un arreglo de resumenes [{banco, moneda, monto, nOperacion,
// duplicado}] para poder responder en el chat de Telegram con lo que se
// extrajo, sin tener que releer la hoja.
// ============================================================

function procesarArchivoImagen(archivo, ctx, remitente, carpetas) {
  remitente = remitente || '';
  carpetas  = carpetas || carpetasParaTipo_('foto');
  const nombre = archivo.getName();
  const mime   = archivo.getMimeType();
  const blob   = archivo.getBlob();
  const base64 = Utilities.base64Encode(blob.getBytes());

  const vouchers = llamarGemini(base64, mime, false);
  const resumenes = [];

  if (!vouchers || vouchers.length === 0) {
    escribirFilaVoucher(ctx, {
      fecha:'', nOperacion:'[OMITIDO]', banco:'', moneda:'', monto:0,
      proveedor:'Imagen sin voucher legible', idCliente:'', cliente:'', descripcion:''
    }, nombre, 1, 'Vacio / Ignorado', remitente);
    flushSeguro_();
    moverArchivo(archivo, carpetas.entrada, CFG.CARPETA_DESCARTADOS_ID);
    return resumenes;
  }

  let alguno = false, repetidos = 0;
  const filasFoto = [];   // ✍️ para «Anotación»

  for (let idx = 0; idx < vouchers.length; idx++) {
    const v      = vouchers[idx];
    const montoV = parsearMonto(v.monto);

    if (esDuplicadoCtx(ctx, v.nOperacion, v.banco, montoV)) {
      // 🔁 Repetido (Repetidos.js): NO se crea fila; se anota en la fila del voucher original (Canal + nota).
      const fOrig = REP_original_(ctx, v, montoV);
      REP_anotar_(ctx, fOrig, nombre, idx + 1, remitente);
      repetidos++;
      resumenes.push({ banco: v.banco, moneda: v.moneda, monto: montoV, nOperacion: v.nOperacion, duplicado: true, filaOriginal: fOrig });
      continue;
    }

    const casi = REP_casi_(ctx, v, montoV);   // ⚠️ mismo voucher con un dígito mal leído?
    const fila = escribirFilaVoucher(ctx, v, nombre, idx + 1, null, remitente);
    registrarEnIndice(ctx, v.nOperacion, v.banco, montoV, fila, v.fecha);
    if (casi) REP_marcarCasi_(ctx, fila, casi);
    insertarImagenBase64(ctx.hoja, fila, 10, base64, mime, nombre);
    filasFoto.push(fila);
    flushSeguro_();   // UN solo flush por voucher
    alguno = true;
    resumenes.push({ banco: v.banco, moneda: v.moneda, monto: montoV, nOperacion: v.nOperacion, duplicado: false });
  }

  REP_aplicar_(ctx);
  REV_anotarFoto_(ctx, base64, mime, filasFoto);   // ✍️ lo escrito a mano / etiquetas de la foto
  if (!alguno && repetidos) REP_moverArchivo_(archivo, carpetas);   // 🔁 la foto entera era repetida
  else moverArchivo(archivo, carpetas.entrada, alguno ? carpetas.procesados : CFG.CARPETA_DESCARTADOS_ID);
  return resumenes;
}
