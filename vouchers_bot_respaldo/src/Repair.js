// ============================================================
// REPARACION DE IMAGENES FALTANTES ("Ver PDF (Voucher N)")
// ------------------------------------------------------------
// Corre POR SEPARADO del procesamiento principal. Revisa la hoja buscando
// filas donde la columna J quedo como texto en vez de imagen, localiza el
// archivo original (ya en Procesados/Duplicados) y reintenta con esperas
// largas.
// ============================================================

async function repararImagenesFaltantes() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('Ya hay una ejecucion en curso. Se omite la reparacion.');
    return;
  }

  const inicio = Date.now();
  const LIMITE = CFG.LIMITE_TIEMPO_MS;
  let reparadas = 0;
  let fallidas  = 0;
  let pendientesRestantesTotal = 0;

  try {
    for (let t = 0; t < TIPOS_VOUCHER.length; t++) {
      if (Date.now() - inicio > LIMITE) break;
      const carpetas = carpetasParaTipo_(TIPOS_VOUCHER[t]);
      const resultado = await repararImagenesEnHoja_(obtenerHoja(carpetas.hojaNombre), inicio, LIMITE);
      reparadas += resultado.reparadas;
      fallidas  += resultado.fallidas;
      pendientesRestantesTotal += resultado.pendientesRestantes;
    }

    if (reparadas === 0 && fallidas === 0) {
      Logger.log('No hay imagenes pendientes de reparar.');
      try { SpreadsheetApp.getActiveSpreadsheet().toast('No hay nada que reparar. Todo en orden.', 'Reparacion', 5); } catch(e) {}
      return;
    }

    Logger.log('RESUMEN REPARACION (ambas pestañas) -> reparadas: ' + reparadas + ' | fallidas: ' + fallidas +
               ' | pendientes restantes: ' + pendientesRestantesTotal);

    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Reparadas: ' + reparadas + ' | Sin exito: ' + fallidas +
        (pendientesRestantesTotal > 0 ? ' | Quedan para la siguiente corrida' : ''),
        'Reparacion de imagenes', 10);
    } catch (e) {}

    // Aviso por Telegram: la miniatura de un PDF a veces no queda lista a
    // tiempo (limitacion real de como Drive genera miniaturas, no un bug),
    // y esta reparacion la corrige sola en segundo plano. Como esto corre
    // sin que nadie este mirando la hoja, se avisa por chat para que quede
    // visible que paso, en vez de que solo se note revisando la hoja.
    if (reparadas > 0 || fallidas > 0) {
      notificarReparacionTelegram_(reparadas, fallidas, pendientesRestantesTotal);
    }

  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Repara las imagenes faltantes de UNA pestaña. Devuelve
// {reparadas, fallidas, pendientesRestantes} para que repararImagenesFaltantes
// pueda sumar los resultados de las dos pestañas (Originales y Fotos).
async function repararImagenesEnHoja_(hoja, inicio, LIMITE) {
  let reparadas = 0;
  let fallidas  = 0;

  const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return { reparadas: 0, fallidas: 0, pendientesRestantes: 0 };

    // Leemos J (Voucher Imagen), K (Archivo Original), M (Pagina) de una vez.
    const rango   = hoja.getRange(2, 10, ultimaFila - 1, 4); // columnas J..M
    const valores = rango.getValues();

    const pendientes = [];
    for (let i = 0; i < valores.length; i++) {
      const val = valores[i][0]; // columna J
      if (typeof val === 'string' && val.indexOf('Ver PDF') === 0) {
        pendientes.push({
          fila:          i + 2,
          archivo:       (valores[i][1] || '').toString().trim(), // K
          pagina:        parseInt(valores[i][3], 10) || 0          // M
        });
      }
    }

    if (pendientes.length === 0) {
      return { reparadas: 0, fallidas: 0, pendientesRestantes: 0 };
    }

    Logger.log('Filas pendientes de reparar (' + hoja.getName() + '): ' + pendientes.length);

    let pdfLibCargado = false;
    const cachePdf = {}; // nombreArchivo -> PDFDocument ya cargado

    for (let p = 0; p < pendientes.length; p++) {
      if (Date.now() - inicio > LIMITE) {
        Logger.log('Limite de tiempo alcanzado. Quedan pendientes para la proxima corrida.');
        break;
      }

      const item = pendientes[p];
      const esPDF = /\.pdf$/i.test(item.archivo);

      try {
        if (esPDF && item.pagina > 0) {
          if (!pdfLibCargado) {
            cargarPdfLib();
            pdfLibCargado = true;
          }

          let pdfDoc = cachePdf[item.archivo];
          if (!pdfDoc) {
            const archivoOriginal = buscarArchivoPorNombre(item.archivo);
            if (!archivoOriginal) {
              Logger.log('  No se encontro el archivo original: ' + item.archivo);
              fallidas++;
              continue;
            }
            const rawBytes = new Uint8Array(archivoOriginal.getBlob().getBytes());
            pdfDoc = await PDFLib.PDFDocument.load(rawBytes);
            cachePdf[item.archivo] = pdfDoc;
          }

          const idx = item.pagina - 1;
          if (idx < 0 || idx >= pdfDoc.getPageCount()) {
            Logger.log('  Pagina fuera de rango para ' + item.archivo + ' pag ' + item.pagina);
            fallidas++;
            continue;
          }

          const miniDoc  = await PDFLib.PDFDocument.create();
          const [pagCop] = await miniDoc.copyPages(pdfDoc, [idx]);
          miniDoc.addPage(pagCop);
          const bytes    = await miniDoc.save();
          const miniBlob = Utilities.newBlob([...new Int8Array(bytes)], MimeType.PDF, 'pag_' + item.pagina + '.pdf');

          const ok = insertarImagenDesdeBlob(hoja, item.fila, 10, miniBlob, 'Voucher ' + item.pagina, true);
          if (ok) { reparadas++; Logger.log('  Reparada fila ' + item.fila); }
          else    { fallidas++;  Logger.log('  Sigue sin poder insertarse fila ' + item.fila); }

        } else {
          // Imagen suelta (png/jpg): re-descargamos el archivo original y reintentamos.
          const archivoOriginal = buscarArchivoPorNombre(item.archivo);
          if (!archivoOriginal) {
            Logger.log('  No se encontro el archivo original: ' + item.archivo);
            fallidas++;
            continue;
          }
          const ok = insertarImagenDesdeBlob(hoja, item.fila, 10, archivoOriginal.getBlob(), item.archivo, true);
          if (ok) { reparadas++; Logger.log('  Reparada fila ' + item.fila); }
          else    { fallidas++;  Logger.log('  Sigue sin poder insertarse fila ' + item.fila); }
        }

      } catch (e) {
        fallidas++;
        Logger.log('  Error reparando fila ' + item.fila + ': ' + e.message);
      }

      Utilities.sleep(500); // pausa corta entre reparaciones para no saturar Drive
    }

  return { reparadas: reparadas, fallidas: fallidas, pendientesRestantes: pendientes.length - reparadas - fallidas };
}

function notificarReparacionTelegram_(reparadas, fallidas, pendientesRestantes) {
  if (!CFG.TELEGRAM_BOT_TOKEN || CFG.TELEGRAM_ALLOWED_CHAT_IDS.length === 0) return;

  let texto = '🔧 Reparacion automatica de imagenes:\n';
  if (reparadas > 0) texto += '✅ ' + reparadas + ' imagen(es) que habian quedado como texto ("Ver PDF") ya se corrigieron.\n';
  if (fallidas > 0)  texto += '⚠️ ' + fallidas + ' no se pudieron reparar todavia, se reintentan en la proxima pasada.\n';
  if (pendientesRestantes > 0) texto += '⏳ Quedan ' + pendientesRestantes + ' pendientes para la siguiente corrida.';

  CFG.TELEGRAM_ALLOWED_CHAT_IDS.forEach(function (chatId) {
    try { enviarMensajeTelegram(chatId, texto.trim()); } catch (e) {}
  });
}

// Busca un archivo por nombre en las carpetas relevantes (en ese orden).
function buscarArchivoPorNombre(nombre) {
  const carpetas = [
    CFG.CARPETA_ORIGINALES_PROCESADOS_ID, CFG.CARPETA_FOTOS_PROCESADOS_ID,
    CFG.CARPETA_DESCARTADOS_ID,
    CFG.CARPETA_ORIGINALES_ENTRADA_ID, CFG.CARPETA_FOTOS_ENTRADA_ID
  ];
  for (let i = 0; i < carpetas.length; i++) {
    try {
      const it = DriveApp.getFolderById(carpetas[i]).getFilesByName(nombre);
      if (it.hasNext()) return it.next();
    } catch (e) {}
  }
  return null;
}
