// ============================================================
// FUNCION PRINCIPAL (escaneo de la carpeta "Nuevos" de Drive)
// ============================================================

async function procesarVouchers() {
  // Evita que dos ejecuciones (trigger + clic manual + webhook Telegram) choquen entre si.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    // Otra ejecucion (la de cada 10 min o la reparacion) esta trabajando: en vez de
    // esperar la siguiente vuelta de 10 min, se reintenta en 1 minuto.
    Logger.log('Ya hay otra ejecucion en curso. Se reintenta en 1 minuto.');
    try { programarReintentoAutomatico_(); } catch (e) {}
    return;
  }

  const inicioEjecucion = Date.now();
  const LIMITE = CFG.LIMITE_TIEMPO_MS;

  let procesados = 0;
  let conError   = 0;
  let apartados  = 0;
  let tiempoExcedido = false;

  try {
    reiniciarEstadoFormato_();

    const TIPOS_IMAGEN = new Set(['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/bmp','image/tiff']);
    const TIPOS_PDF    = new Set(['application/pdf']);

    let huboArchivos = false;

    for (let t = 0; t < TIPOS_VOUCHER.length && !tiempoExcedido; t++) {
      const carpetas       = carpetasParaTipo_(TIPOS_VOUCHER[t]);
      const carpetaEntrada = DriveApp.getFolderById(carpetas.entrada);
      const hoja           = obtenerHoja(carpetas.hojaNombre);
      asegurarCabeceras(hoja);

      // --- OPTIMIZACION CLAVE ---
      // Leemos la hoja UNA sola vez y armamos indices en memoria (uno por
      // pestaña: los duplicados se detectan solo dentro del mismo tipo).
      const ctx = crearContexto(hoja);
      Logger.log('[' + carpetas.tipo + '] Indices cargados. Filas existentes: ' + ctx.ultimaFila +
                 ' | Claves duplicado: ' + ctx.indiceDup.size);

      const listaArchivos = [];
      const it = carpetaEntrada.getFiles();
      while (it.hasNext()) listaArchivos.push(it.next());

      if (listaArchivos.length === 0) continue;
      huboArchivos = true;

      const hayPDF = listaArchivos.some(function(f) { return TIPOS_PDF.has(f.getMimeType()); });
      if (hayPDF) cargarPdfLib();

      for (let k = 0; k < listaArchivos.length; k++) {
        if (Date.now() - inicioEjecucion > LIMITE) { tiempoExcedido = true; break; }

        const archivo = listaArchivos[k];
        const mime    = archivo.getMimeType();
        const nombre  = archivo.getName();

        let mb = 0;
        try { mb = archivo.getSize() / (1024 * 1024); } catch (e) {}
        if (mb > CFG.MAX_MB_ARCHIVO) {
          Logger.log('APARTADO por tamano (' + mb.toFixed(1) + ' MB): ' + nombre);
          escribirFilaVoucher(ctx, {
            fecha:'', nOperacion:'[ARCHIVO GRANDE]', banco:'', moneda:'', monto:0,
            proveedor:'Archivo de ' + mb.toFixed(1) + ' MB. Comprimelo y vuelve a subirlo.',
            idCliente:'', cliente:'', descripcion:''
          }, nombre, 0, 'Muy pesado');
          flushSeguro_();
          moverArchivo(archivo, carpetas.entrada, CFG.CARPETA_DESCARTADOS_ID);
          apartados++;
          continue;
        }

        try {
          if (TIPOS_IMAGEN.has(mime)) {
            procesarArchivoImagen(archivo, ctx, '', carpetas);
            procesados++;
          } else if (TIPOS_PDF.has(mime)) {
            const resultado = await procesarArchivoPDF(archivo, ctx, inicioEjecucion, LIMITE, '', carpetas);
            if (resultado.seDetuvo) { tiempoExcedido = true; break; }
            procesados++;
          }
        } catch (err) {
          conError++;
          Logger.log('ERROR en ' + nombre + ': ' + err.message);
          escribirFilaVoucher(ctx, {
            fecha:'', nOperacion:'[ERROR]', banco:'', moneda:'', monto:0,
            proveedor:'Error tecnico: ' + err.message,
            idCliente:'', cliente:'', descripcion:''
          }, nombre, 0, 'Error tecnico');
          flushSeguro_();
        }
      }
    }

    if (!huboArchivos) {
      Logger.log('No hay archivos nuevos que procesar.');
      return;
    }

    const seg = Math.round((Date.now() - inicioEjecucion) / 1000);
    Logger.log('RESUMEN -> procesados: ' + procesados + ' | errores: ' + conError +
               ' | apartados: ' + apartados + ' | tiempo: ' + seg + 's');

    if (tiempoExcedido) {
      // Varios archivos (o un PDF largo) y no alcanzo a terminar el lote
      // en esta ejecucion: se programa un reintento automatico en 1
      // minuto en vez de dejar que solo el trigger de 10 min lo retome.
      programarReintentoAutomatico_();
    }

    try {
      if (tiempoExcedido) {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          'Pausado por limite de tiempo. Procesados: ' + procesados +
          '. Continua solo en la siguiente corrida automatica.',
          'SISTEMA PAUSADO', 20);
      } else if (conError > 0 || apartados > 0) {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          'Procesados: ' + procesados + ' | Con error: ' + conError +
          ' | Apartados: ' + apartados + '. Revisa la hoja.',
          'Terminado con avisos', 15);
      } else {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          'Procesados ' + procesados + ' archivo(s) en ' + seg + ' segundos.',
          'Completado', 6);
      }
    } catch (e) {}

  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ============================================================
// CONTEXTO: indices en memoria (el mayor ahorro de tiempo)
// ============================================================

function crearContexto(hoja) {
  const ultimaFila = hoja.getLastRow();

  const ctx = {
    hoja:        hoja,
    ultimaFila:  ultimaFila,
    indiceDup:   new Set(),   // clave "op|banco|monto"
    indicePag:   {}           // nombreArchivo -> ultima pagina procesada
  };

  if (ultimaFila < 2) return ctx;

  // Una sola lectura de B..M (cols 2 a 13) para armar ambos indices.
  const datos = hoja.getRange(2, 2, ultimaFila - 1, 12).getValues();

  for (let i = 0; i < datos.length; i++) {
    const row = datos[i];
    const op    = (row[0]  || '').toString().trim().toLowerCase(); // col B
    const banco = (row[1]  || '').toString().trim().toLowerCase(); // col C
    const monto = parseFloat(row[3]) || 0;                          // col E
    const arch  = (row[9]  || '').toString().trim();                // col K
    const pag   = parseInt(row[11], 10);                            // col M

    if (op) ctx.indiceDup.add(claveDuplicado(op, banco, monto));

    if (arch && !isNaN(pag)) {
      if (!ctx.indicePag[arch] || pag > ctx.indicePag[arch]) ctx.indicePag[arch] = pag;
    }
  }

  return ctx;
}

function claveDuplicado(op, banco, monto) {
  return op.toString().trim().toLowerCase() + '|' +
         (banco || '').toString().trim().toLowerCase() + '|' +
         (Math.round((parseFloat(monto) || 0) * 100) / 100).toFixed(2);
}

// O(1) en memoria, no vuelve a leer toda la hoja.
function esDuplicadoCtx(ctx, nOperacion, banco, monto) {
  if (!nOperacion || nOperacion.toString().trim() === '') return false;
  return ctx.indiceDup.has(claveDuplicado(nOperacion, banco, monto));
}

function obtenerUltimaPaginaProcesadaCtx(ctx, nombreArchivo) {
  return ctx.indicePag[nombreArchivo.trim()] || 0;
}

function registrarEnIndice(ctx, nOperacion, banco, monto) {
  if (nOperacion && nOperacion.toString().trim() !== '') {
    ctx.indiceDup.add(claveDuplicado(nOperacion, banco, monto));
  }
}

// ============================================================
// pdf-lib: se carga una sola vez por ejecucion, solo si hace falta.
// ============================================================

function cargarPdfLib() {
  if (typeof PDFLib !== 'undefined') return;
  Logger.log('Cargando pdf-lib...');
  eval(UrlFetchApp.fetch('https://cdn.jsdelivr.net/npm/pdf-lib/dist/pdf-lib.min.js')
    .getContentText()
    .replace(/setTimeout\(.*?,.*?(\d*?)\)/g, 'Utilities.sleep($1);return t();'));
  Logger.log('pdf-lib cargado');
}
