// ============================================================
// 🔁 VOLVER A LEER LA PAGINA DE UNA FILA (con IA)
// ------------------------------------------------------------
// Para cuando la IA leyo mal un voucher o cuando se volvio a subir el
// archivo con una pagina cambiada (el sistema recuerda hasta que pagina
// proceso cada archivo y no vuelve a leer las anteriores).
//
// Se elige una fila (Originales o Fotos) -> se busca su archivo (columna K,
// la version MAS NUEVA si hay varias con el mismo nombre) -> se saca la
// pagina de la columna M -> Gemini la lee con el mismo prompt de siempre ->
// se muestra ANTES / AHORA y se pide confirmar. Solo se reemplazan A..I
// (datos del voucher), la imagen (J) y la fecha de proceso (L). Lo que la
// persona agrego (columnas O en adelante: revisado, empresa, factura...)
// NO se toca. Queda una nota en la columna B con lo de antes, y el menu
// "↩️ Deshacer la ultima relectura" lo devuelve.
// ============================================================

const RP_COLS_ = 9;   // A..I: fecha, op, banco, moneda, monto, proveedor, idCliente, cliente, descripcion

async function RP_releerFilaActiva() {
  const ui = SpreadsheetApp.getUi();
  const hoja = SpreadsheetApp.getActiveSheet();
  if ([CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].indexOf(hoja.getName()) === -1) {
    ui.alert('🔁 Volver a leer', 'Póngase en una fila de la pestaña "' + CFG.SHEET_ORIGINALES + '" o "' + CFG.SHEET_FOTOS + '".', ui.ButtonSet.OK);
    return;
  }
  const fila = hoja.getActiveRange().getRow();
  if (fila < 2) { ui.alert('🔁 Volver a leer', 'Elija una fila con un voucher (no el encabezado).', ui.ButtonSet.OK); return; }
  let r;
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('Leyendo la página otra vez con IA…', '🔁 Volver a leer', 60);
    r = await RP_leer_(hoja.getName(), fila);
  } catch (e) {
    ui.alert('🔁 Volver a leer', '❌ ' + e.message, ui.ButtonSet.OK);
    return;
  }
  let elegido = 0;
  if (r.leidos.length > 1) {
    const resp = ui.prompt('🔁 Volver a leer · fila ' + fila,
      'En la página leí ' + r.leidos.length + ' vouchers:\n\n' + r.leidos.map(function (v, i) { return (i + 1) + ') ' + RP_linea_(v); }).join('\n') +
      '\n\n¿Cuál pongo en esta fila? (escriba el número)', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    elegido = (parseInt(resp.getResponseText(), 10) || 0) - 1;
    if (elegido < 0 || elegido >= r.leidos.length) { ui.alert('Número no válido. No cambié nada.'); return; }
  }
  const nuevo = r.leidos[elegido];
  const msg = 'Archivo: ' + r.archivo + ' · página ' + r.pagina + '\n(versión del ' + r.version + ')\n\n' +
    'ANTES:  ' + RP_linea_(r.antes) + '\nAHORA:  ' + RP_linea_(nuevo) +
    (r.dup ? '\n\n⚠️ Ese N° de operación ya está en la fila ' + r.dup + ': se anotará como [DUPLICADO].' : '') +
    (r.agregado ? '\n\nℹ️ La fila tiene datos agregados a mano (columnas O en adelante): se mantienen. Revíselos después.' : '') +
    '\n\n¿Reemplazo los datos de la fila ' + fila + '? (se puede deshacer desde el menú)';
  if (ui.alert('🔁 Volver a leer · fila ' + fila, msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const res = RP_escribir_(hoja.getName(), fila, nuevo, r.dup, 'menú de la hoja');
  await RP_imagen_(hoja.getName(), fila, r);
  ui.alert('🔁 Volver a leer', '✅ Fila ' + fila + ' actualizada' + (res.dup ? ' (marcada como duplicado)' : '') + '.', ui.ButtonSet.OK);
}

/** Lee otra vez la pagina de hoja!fila. NO escribe nada. */
async function RP_leer_(nombreHoja, fila) {
  const hoja = obtenerHoja(nombreHoja);
  if (!hoja) throw new Error('No existe la pestaña ' + nombreHoja + '.');
  if (fila < 2 || fila > hoja.getLastRow()) throw new Error('La fila ' + fila + ' no tiene datos.');
  const v = hoja.getRange(fila, 1, 1, 14).getValues()[0];
  const archivo = String(v[10] || '').trim(), pagina = parseInt(v[12], 10) || 1;
  if (!archivo) throw new Error('La fila ' + fila + ' no tiene "Archivo Original" (columna K).');
  const f = RP_archivoMasNuevo_(archivo);
  if (!f) throw new Error('No encontré el archivo "' + archivo + '" en las carpetas de vouchers.');
  const esPdf = /pdf/i.test(f.getMimeType()) || /\.pdf$/i.test(archivo);
  let base64, mime, paginaBlob = null, leidos;
  if (esPdf) {
    cargarPdfLib();
    const doc = await PDFLib.PDFDocument.load(new Uint8Array(f.getBlob().getBytes()));
    const total = doc.getPageCount();
    if (pagina > total) throw new Error('El archivo "' + archivo + '" tiene ' + total + ' páginas; la fila dice página ' + pagina + '.');
    const uno = await PDFLib.PDFDocument.create();
    const [p] = await uno.copyPages(doc, [pagina - 1]);
    uno.addPage(p);
    paginaBlob = Utilities.newBlob([...new Int8Array(await uno.save())], MimeType.PDF, 'pag_' + pagina + '.pdf');
    base64 = Utilities.base64Encode(paginaBlob.getBytes()); mime = 'application/pdf';
    leidos = llamarGemini(base64, mime, true);
  } else {
    const b = f.getBlob();
    base64 = Utilities.base64Encode(b.getBytes()); mime = f.getMimeType();
    leidos = llamarGemini(base64, mime, false);
    // en una imagen con varios vouchers, la columna M es el N° de voucher dentro de la imagen
    if (leidos && leidos.length > 1 && pagina <= leidos.length) leidos = [leidos[pagina - 1]].concat(leidos.filter(function (x, i) { return i !== pagina - 1; }));
  }
  if (!leidos || !leidos.length) throw new Error('La IA no encontró ningún voucher legible en la página ' + pagina + ' de "' + archivo + '". No cambié nada.');
  leidos.forEach(function (x) { x.monto = parsearMonto(x.monto); });
  const antes = { fecha: v[0], nOperacion: v[1], banco: v[2], moneda: v[3], monto: v[4], proveedor: v[5] };
  // ¿El N° nuevo ya está en otra fila de la misma pestaña?
  let dup = 0;
  const n = leidos[0];
  if (n.nOperacion) {
    const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 5).getValues(), clave = claveDuplicado(n.nOperacion, n.banco, n.monto);
    for (let i = 0; i < datos.length; i++) {
      if (i + 2 !== fila && claveDuplicado(datos[i][1], datos[i][2], datos[i][4]) === clave) { dup = i + 2; break; }
    }
  }
  const extra = hoja.getLastColumn() > 14 ? hoja.getRange(fila, 15, 1, hoja.getLastColumn() - 14).getValues()[0] : [];
  const agregado = extra.some(function (x) { return x !== '' && x !== false && x !== null; });
  return { archivo: archivo, pagina: pagina, version: Utilities.formatDate(f.getDateCreated(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'),
    leidos: leidos, antes: antes, dup: dup, agregado: agregado, base64: base64, mime: mime, paginaBlob: paginaBlob, esPdf: esPdf };
}

/** Escribe A..I y L (guarda lo de antes para deshacer). */
function RP_escribir_(nombreHoja, fila, v, dup, quien) {
  const hoja = obtenerHoja(nombreHoja);
  const previo = hoja.getRange(fila, 1, 1, RP_COLS_).getValues()[0];
  const notaPrev = hoja.getRange(fila, 2).getNote();
  PropertiesService.getScriptProperties().setProperty('RP_ULTIMA', JSON.stringify({ hoja: nombreHoja, fila: fila, valores: previo.map(function (x) {
    return x instanceof Date ? { d: x.getTime() } : x; }), nota: notaPrev, t: Date.now() }));
  const valores = [parsearFecha(v.fecha), dup ? '[DUPLICADO]' : (v.nOperacion || ''), v.banco || '', v.moneda || '', parsearMonto(v.monto),
    v.proveedor || '', v.idCliente || '', v.cliente || '', v.descripcion || ''];
  for (let c = 0; c < valores.length; c++) {
    try { hoja.getRange(fila, c + 1).setValue(valores[c]); } catch (e) { Logger.log('Releer: columna ' + (c + 1) + ': ' + e.message); }
  }
  try { hoja.getRange(fila, 12).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')); } catch (e) {}
  const cuando = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  try {
    hoja.getRange(fila, 2).setNote('🔁 Releído con IA ' + cuando + ' (' + (quien || '') + ').\nAntes: ' +
      RP_linea_({ fecha: previo[0], nOperacion: previo[1], banco: previo[2], moneda: previo[3], monto: previo[4], proveedor: previo[5] }) +
      (notaPrev ? '\n\n' + notaPrev : ''));
  } catch (e) {}
  flushSeguro_();
  return { dup: !!dup };
}

/** Imagen de la pagina en la columna J (si falla, queda la de antes). */
async function RP_imagen_(nombreHoja, fila, r) {
  const hoja = obtenerHoja(nombreHoja);
  try {
    if (r.esPdf && r.paginaBlob) insertarImagenDesdeBlob(hoja, fila, 10, r.paginaBlob, 'Voucher ' + r.pagina);
    else insertarImagenBase64(hoja, fila, 10, r.base64, r.mime, r.archivo);
  } catch (e) { Logger.log('Releer: imagen fila ' + fila + ': ' + e.message); }
  flushSeguro_();
}

function RP_deshacer() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const u = JSON.parse(props.getProperty('RP_ULTIMA') || 'null');
  if (!u) { ui.alert('↩️ Deshacer', 'No hay ninguna relectura para deshacer.', ui.ButtonSet.OK); return; }
  if (ui.alert('↩️ Deshacer', '¿Devuelvo la fila ' + u.fila + ' de ' + u.hoja + ' a como estaba antes de volver a leerla?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  RP_deshacer_();
  ui.alert('↩️ Deshacer', '✅ Fila ' + u.fila + ' devuelta (la imagen queda la de la página releída).', ui.ButtonSet.OK);
}

function RP_deshacer_() {
  const props = PropertiesService.getScriptProperties();
  const u = JSON.parse(props.getProperty('RP_ULTIMA') || 'null');
  if (!u) return null;
  const hoja = obtenerHoja(u.hoja);
  u.valores.forEach(function (x, c) {
    try { hoja.getRange(u.fila, c + 1).setValue(x && x.d ? new Date(x.d) : x); } catch (e) {}
  });
  try { hoja.getRange(u.fila, 2).setNote(u.nota || ''); } catch (e) {}
  props.deleteProperty('RP_ULTIMA');
  flushSeguro_();
  return u;
}

/** Si hay varios archivos con el mismo nombre (se volvio a subir), el mas nuevo. */
function RP_archivoMasNuevo_(nombre) {
  const carpetas = [CFG.CARPETA_ORIGINALES_PROCESADOS_ID, CFG.CARPETA_FOTOS_PROCESADOS_ID, CFG.CARPETA_DESCARTADOS_ID,
    CFG.CARPETA_ORIGINALES_ENTRADA_ID, CFG.CARPETA_FOTOS_ENTRADA_ID];
  let mejor = null;
  carpetas.forEach(function (id) {
    try {
      const it = DriveApp.getFolderById(id).getFilesByName(nombre);
      while (it.hasNext()) { const f = it.next(); if (!mejor || f.getDateCreated() > mejor.getDateCreated()) mejor = f; }
    } catch (e) {}
  });
  return mejor;
}

function RP_linea_(v) {
  const f = v.fecha instanceof Date ? Utilities.formatDate(v.fecha, Session.getScriptTimeZone(), 'dd/MM/yyyy') : String(v.fecha || '');
  const m = Number(parsearMonto(v.monto) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return [f, v.banco, v.nOperacion ? 'op ' + v.nOperacion : 'sin op', (String(v.moneda || '').toUpperCase().indexOf('USD') >= 0 ? 'US$ ' : 'S/ ') + m,
    String(v.proveedor || '').slice(0, 40)].filter(String).join(' · ');
}
