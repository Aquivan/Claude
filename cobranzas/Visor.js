/**
 * Visor.js
 * Barra lateral que muestra la imagen del voucher de la fila seleccionada
 * (en Consulta, Movimientos o Conciliar). La barra pregunta cada 1.5 s cual
 * es la fila activa; si en esa fila hay una "Fuente" de voucher
 * (ej. Originales!123) trae la imagen guardada en el Sistema de Vouchers.
 */

function abrirVisorVoucher() {
  var html = HtmlService.createHtmlOutputFromFile('Visor').setTitle('🖼 Visor de vouchers');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Devuelve la fuente de voucher de la fila activa ('' si no hay). */
function fuenteFilaActiva_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getActiveSheet();
  var fila = sh.getActiveRange().getRow();
  var ancho = Math.min(sh.getLastColumn(), 20);
  if (ancho < 1) return '';
  var v = sh.getRange(fila, 1, 1, ancho).getDisplayValues()[0];
  for (var i = 0; i < v.length; i++) {
    if (/^[^!]+![0-9]+$/.test(v[i]) && v[i].indexOf(HOJA.MANUAL) !== 0) return v[i];
  }
  return '';
}

/** Llamado por la barra lateral. ultima = fuente que ya esta mostrando. */
function voucherSeleccionado(ultima) {
  var fuente = fuenteFilaActiva_();
  if (!fuente) return { fuente: '' };
  if (fuente === ultima) return { fuente: fuente, igual: true };
  var cache = CacheService.getUserCache();
  var enCache = cache.get('v:' + fuente);
  if (enCache) return JSON.parse(enCache);

  var cfg = leerConfig_(SpreadsheetApp.getActiveSpreadsheet());
  var partes = fuente.split('!');
  var sh = SpreadsheetApp.openById(cfg.idVouchers).getSheetByName(partes[0]);
  if (!sh) return { fuente: fuente, error: 'No existe la pestaña ' + partes[0] + ' en Vouchers' };
  var fila = parseInt(partes[1], 10);
  var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = indiceColumnas_(enc);
  var datos = sh.getRange(fila, 1, 1, enc.length).getValues()[0];
  var res = {
    fuente: fuente,
    fecha: datos[col('Fecha de depos')] instanceof Date ? Utilities.formatDate(datos[col('Fecha de depos')], 'America/Lima', 'dd/MM/yyyy') : String(datos[col('Fecha de depos')] || ''),
    operacion: String(datos[col('Numero de oper')] || ''), banco: String(datos[col('Banco')] || ''),
    monto: datos[col('Monto')], moneda: String(datos[col('Moneda')] || ''),
    beneficiario: String(datos[col('Proveedor (Beneficiario)')] || ''), descripcion: String(datos[col('Descripcion')] || ''),
    archivo: String(datos[col('Archivo Original')] || ''), refs: String(datos[col('Tipo y N Doc')] || ''),
    imagen: '', enlace: '',
  };
  // Imagen dentro de la celda (columnas "Voucher Imagen")
  var norm = enc.map(normHeader_);
  for (var i = 0; i < norm.length && !res.imagen; i++) {
    if (norm[i] !== 'voucher imagen') continue;
    var val = sh.getRange(fila, i + 1).getValue();
    if (val && typeof val === 'object' && typeof val.getContentUrl === 'function') {
      try { res.imagen = val.getContentUrl(); } catch (e) { /* sin url */ }
    }
  }
  // Si no hay imagen en celda: buscar el archivo original en Drive
  if (!res.imagen && res.archivo) {
    var it = DriveApp.getFilesByName(res.archivo);
    if (it.hasNext()) {
      var f = it.next();
      res.enlace = f.getUrl();
      try {
        var th = f.getThumbnail();
        if (th) res.imagen = 'data:image/png;base64,' + Utilities.base64Encode(th.getBytes());
      } catch (e) { /* sin miniatura */ }
    }
  }
  try { cache.put('v:' + fuente, JSON.stringify(res), 1800); } catch (e) { /* muy grande para cache */ }
  return res;
}
