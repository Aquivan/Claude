// ============================================================
// INSERCION DE IMAGENES (optimizada + mas confiable)
// ------------------------------------------------------------
// Sondeo escalonado corto (~6.6s peor caso) y un SEGUNDO INTENTO completo
// si el primero falla. Si todos los intentos fallan, recien ahi se pone
// texto "Ver PDF (...)" en la celda, que luego "Reparar imagenes
// faltantes" puede reintentar con mas paciencia.
// ============================================================

function insertarImagenDesdeBlob(hoja, fila, columna, blob, referencia, modoReparacion) {
  const token = ScriptApp.getOAuthToken();
  const maxIntentos = modoReparacion ? 4 : 2;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    let tempFile = null;
    try {
      tempFile = DriveApp.createFile(blob);
      const tempId = tempFile.getId();

      let esperas;
      if (!modoReparacion) {
        esperas = (intento === 1) ? [700, 900, 1200, 1600, 2200] : [3000, 4000];
      } else {
        esperas = [2000, 3000, 4000, 5000, 6000];
      }
      let thumbUrl = '';

      for (let i = 0; i < esperas.length; i++) {
        Utilities.sleep(esperas[i]);
        try {
          const res = UrlFetchApp.fetch(
            'https://www.googleapis.com/drive/v3/files/' + tempId + '?fields=thumbnailLink',
            { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
          );
          if (res.getResponseCode() === 200) {
            const j = JSON.parse(res.getContentText());
            if (j.thumbnailLink) {
              thumbUrl = j.thumbnailLink.replace(/=s\d+/, '=s800');
              break;
            }
          }
        } catch (e) {}
      }

      // Plan B dentro del mismo intento: miniatura publica de Drive.
      if (!thumbUrl) {
        thumbUrl = 'https://drive.google.com/thumbnail?id=' + tempId + '&sz=w800';
      }

      const imgReq = UrlFetchApp.fetch(thumbUrl, {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });

      if (imgReq.getResponseCode() === 200) {
        const b64 = Utilities.base64Encode(imgReq.getBlob().getBytes());
        if (_insertarBase64EnCelda(hoja, fila, columna, b64, 'image/jpeg', referencia)) {
          return true;
        }
      } else {
        Logger.log('  Miniatura HTTP ' + imgReq.getResponseCode() + ' (intento ' + intento + ') ref. ' + referencia);
      }

    } catch (e) {
      Logger.log('  Fallo miniatura intento ' + intento + ' ref. ' + referencia + ': ' + e.message);
    } finally {
      if (tempFile) { try { tempFile.setTrashed(true); } catch (ef) {} }
    }
  }

  try {
    hoja.getRange(fila, columna).setValue('Ver PDF (' + referencia + ')');
  } catch (eTexto) {
    Logger.log('  No se pudo escribir el texto de reemplazo en fila ' + fila + ': ' + eTexto.message);
  }
  return false;
}

// Inserta base64 como CellImage. Devuelve true/false segun exito.
function _insertarBase64EnCelda(hoja, fila, columna, base64Img, mimeType, referencia) {
  if (!base64Img || base64Img.length < 500) {
    Logger.log('  base64 invalido ref. ' + referencia + ' (largo: ' + (base64Img ? base64Img.length : 0) + ')');
    return false;
  }
  try {
    const cellImage = SpreadsheetApp.newCellImage()
      .setSourceUrl('data:' + mimeType + ';base64,' + base64Img)
      .build();
    hoja.getRange(fila, columna).setValue(cellImage);
    return true;
  } catch (e) {
    Logger.log('  CellImage fallo ref. ' + referencia + ': ' + e.message);
    return false;
  }
}

// Para imagenes sueltas (png/jpg). Si la imagen es muy pesada, se salta el
// intento directo y va por Drive, que ademas la reduce de tamano.
function insertarImagenBase64(hoja, fila, columna, base64, mimeType, nombre) {
  const PESADA = 1500000; // ~1.5 MB en base64

  if (base64 && base64.length >= 500 && base64.length < PESADA) {
    if (_insertarBase64EnCelda(hoja, fila, columna, base64, mimeType, nombre)) return;
    Logger.log('  Imagen directa fallo para ' + nombre + '. Intentando via Drive...');
  }

  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, nombre);
    insertarImagenDesdeBlob(hoja, fila, columna, blob, nombre);
  } catch (e2) {
    Logger.log('  Todos los metodos fallaron para ' + nombre + ': ' + e2.message);
    hoja.getRange(fila, columna).setValue('[imagen no disponible]');
  }
}
