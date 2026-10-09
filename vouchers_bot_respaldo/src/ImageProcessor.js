// ============================================================
// PROCESAMIENTO DE IMAGENES
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

  let alguno = false;

  for (let idx = 0; idx < vouchers.length; idx++) {
    const v      = vouchers[idx];
    const montoV = parsearMonto(v.monto);

    if (esDuplicadoCtx(ctx, v.nOperacion, v.banco, montoV)) {
      escribirFilaVoucher(ctx, {
        fecha: v.fecha, nOperacion: '[DUPLICADO]', banco: v.banco, moneda: v.moneda,
        monto: montoV, proveedor: v.proveedor, idCliente: v.idCliente,
        cliente: v.cliente, descripcion: v.descripcion
      }, nombre, idx + 1, 'Duplicado exacto', remitente);
      flushSeguro_();
      resumenes.push({ banco: v.banco, moneda: v.moneda, monto: montoV, nOperacion: v.nOperacion, duplicado: true });
      continue;
    }

    const fila = escribirFilaVoucher(ctx, v, nombre, idx + 1, null, remitente);
    registrarEnIndice(ctx, v.nOperacion, v.banco, montoV);
    insertarImagenBase64(ctx.hoja, fila, 10, base64, mime, nombre);
    flushSeguro_();   // UN solo flush por voucher
    alguno = true;
    resumenes.push({ banco: v.banco, moneda: v.moneda, monto: montoV, nOperacion: v.nOperacion, duplicado: false });
  }

  moverArchivo(archivo, carpetas.entrada, alguno ? carpetas.procesados : CFG.CARPETA_DESCARTADOS_ID);
  return resumenes;
}
