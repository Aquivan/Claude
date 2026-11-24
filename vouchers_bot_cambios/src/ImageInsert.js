// ============================================================
// INSERCION DE IMAGENES (optimizada + mas confiable)
// ------------------------------------------------------------
// Sondeo escalonado corto (~6.6s peor caso) y un SEGUNDO INTENTO completo
// si el primero falla. Si todos los intentos fallan, recien ahi se pone
// texto "Ver PDF (...)" en la celda, que luego "Reparar imagenes
// faltantes" puede reintentar con mas paciencia.
// ============================================================

// ⏱ Cuánto se va en poner imágenes (TIEMPOS_.imagen, Gemini.js). IMG_NIVEL_ evita contar dos veces cuando
// insertarImagenBase64 llama a insertarImagenDesdeBlob.
var IMG_NIVEL_ = 0;
function IMG_medir_(fn) {
  const t0 = Date.now();
  IMG_NIVEL_++;
  try { return fn(); } finally {
    IMG_NIVEL_--;
    if (!IMG_NIVEL_ && typeof TIEMPOS_ !== 'undefined') { TIEMPOS_.imagen += Date.now() - t0; TIEMPOS_.imagenes++; }
  }
}

function insertarImagenDesdeBlob(hoja, fila, columna, blob, referencia, modoReparacion) {
  return IMG_medir_(function () { return insertarImagenDesdeBlob_(hoja, fila, columna, blob, referencia, modoReparacion); });
}
function insertarImagenDesdeBlob_(hoja, fila, columna, blob, referencia, modoReparacion) {
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
  return IMG_medir_(function () { return insertarImagenBase64_(hoja, fila, columna, base64, mimeType, nombre); });
}
function insertarImagenBase64_(hoja, fila, columna, base64, mimeType, nombre) {
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


// ⏱ Imágenes que quedaron sin poner por falta de tiempo: «Reparar imágenes faltantes» (Repair.js) las pone en 2 min,
// en su propia ejecución. Disparador aparte (IMG_repararPronto) para no tocar el de cada 30 min si está activado.
function IMG_repararPronto_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'IMG_repararPronto') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('IMG_repararPronto').timeBased().after(2 * 60 * 1000).create();
}
async function IMG_repararPronto() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'IMG_repararPronto') ScriptApp.deleteTrigger(t); });
  await repararImagenesFaltantes();
}
