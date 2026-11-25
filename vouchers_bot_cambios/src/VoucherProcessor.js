// ============================================================
// FUNCION PRINCIPAL (escaneo de la carpeta "Nuevos" de Drive)
// ============================================================

async function procesarVouchers() {
  // Evita que dos ejecuciones (trigger + clic manual + webhook Telegram) choquen entre si.
  const lock = LockService.getScriptLock();
  // ⚡ Si otra ejecución está trabajando, se espera hasta 30 s a que termine (suele ser poco) en vez de
  // reprogramar para dentro de 1 minuto (que Google a veces atrasa 1-3 min más).
  if (!lock.tryLock(30000)) {
    // Otra ejecucion (la de cada 10 min o la reparacion) esta trabajando: en vez de
    // esperar la siguiente vuelta de 10 min, se reintenta en 1 minuto.
    Logger.log('Ya hay otra ejecucion en curso. Se reintenta en 1 minuto.');
    try { programarReintentoAutomatico_(); } catch (e) {}
    return;
  }

  // 🧪 Prueba de modelos Gemini: si hay una versión nueva, la programa aparte (no demora este procesamiento).
  try { PG_asegurar_(); } catch (e) { Logger.log('Prueba Gemini: ' + e.message); }
  // 🏷 Títulos cortos de A–N (una sola vez; los demás programas ya reconocen el nombre viejo y el nuevo).
  try { VCH_titulosCortos_(); } catch (e) { Logger.log('Títulos cortos: ' + e.message); }
  try { VCH_columnasControl_(); } catch (e) { Logger.log('Columnas de control: ' + e.message); if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'columnas de control · ERROR', '', e.message); }

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
      const tIdx = Date.now();
      const ctx = crearContexto(hoja);
      if (typeof TIEMPOS_ !== 'undefined') TIEMPOS_.indices += Date.now() - tIdx;   // ⏱ leer la hoja (duplicados)
      Logger.log('[' + carpetas.tipo + '] Indices cargados. Filas existentes: ' + ctx.ultimaFila +
                 ' | Claves duplicado: ' + ctx.indiceDup.size);

      const listaArchivos = [];
      const it = carpetaEntrada.getFiles();
      while (it.hasNext()) listaArchivos.push(it.next());

      if (listaArchivos.length === 0) continue;
      if (!huboArchivos && typeof REG_anotar_ === 'function') {   // 🩺 si después no aparece su «fin», Google cortó la ejecución
        REG_anotar_('Vouchers', 'inicio', '', listaArchivos.length + ' archivo(s) en Entrada (' + carpetas.tipo + '): ' +
          listaArchivos.slice(0, 5).map(function (f) { return f.getName(); }).join(', '));
      }
      huboArchivos = true;

      const hayPDF = listaArchivos.some(function(f) { return TIPOS_PDF.has(f.getMimeType()); });
      if (hayPDF) cargarPdfLib();

      for (let k = 0; k < listaArchivos.length; k++) {
        if (Date.now() - inicioEjecucion > LIMITE) { tiempoExcedido = true; break; }

        const archivo = listaArchivos[k];
        const mime    = archivo.getMimeType();
        let nombre    = archivo.getName();
        // 🏷 Nombre repetido (VCH_evitarRepetido_): una imagen con un nombre que ya está en la hoja, o dos archivos con
        // el mismo nombre en esta vuelta → se le agrega « (2)», « (3)»… Los PDF se revisan en procesarArchivoPDF.
        try { nombre = VCH_evitarRepetido_(ctx, archivo, carpetas, TIPOS_IMAGEN.has(mime)); } catch (eN) { Logger.log('Nombre repetido (no se pudo revisar): ' + eN.message); }

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

    if (typeof REG_anotar_ === 'function') {   // 🩺 registro técnico: el resumen y lo que pasó (sin claves)
      const t = typeof TIEMPOS_ !== 'undefined' ? TIEMPOS_ : {};
      REG_anotar_('Vouchers', tiempoExcedido ? 'fin (pausado por tiempo)' : 'fin', seg,
        'procesados ' + procesados + ' · errores ' + conError + ' · apartados ' + apartados +
        ' · IA ' + Math.round((t.ia || 0) / 1000) + ' s en ' + (t.lecturas || 0) + ' lectura(s)' + (t.lector ? ' · último lector ' + t.lector : '') +
        ' · guardar ' + Math.round((t.escribir || 0) / 1000) + ' s\n' + REG_desglose_(t, seg) + '\n' + REG_logCorto_(String(Logger.getLog() || '')));
    }

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
    indicePag:   {},          // nombreArchivo -> ultima pagina procesada
    nombres:     new Set(),   // 🏷 nombres de archivo que ya están en la hoja (col. K)
    nombresRun:  {}           // 🏷 nombre -> id del archivo que lo usa en esta vuelta
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

    if (arch) ctx.nombres.add(arch);
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


// ============================================================
// 🏷 NOMBRES REPETIDOS
// ------------------------------------------------------------
// El nombre del archivo (columna K) es como el sistema encuentra el original (visor, reparar imágenes, deshacer
// tandas) y como retoma un PDF largo. Dos archivos DISTINTOS con el mismo nombre se confundían: un PDF nuevo con el
// nombre de otro ya terminado se pasaba a Procesados SIN leerlo. Ahora:
//   · imagen con un nombre que ya está en la hoja, o dos archivos con el mismo nombre en la misma vuelta → « (2)»…
//   · PDF con el nombre de otro ya procesado completo: si es IDÉNTICO (mismo contenido) se omite como antes; si es
//     otro documento, se renombra y se lee entero.
//   · PDF a medias o con páginas agregadas (mismo nombre, más páginas): sigue desde donde se quedó, como siempre.
// ============================================================

function VCH_evitarRepetido_(ctx, archivo, carpetas, esImagen) {
  let n = archivo.getName();
  const id = archivo.getId();
  if ((ctx.nombresRun[n] && ctx.nombresRun[n] !== id) || (esImagen && ctx.nombres.has(n))) n = VCH_renombrar_(ctx, archivo, carpetas);
  ctx.nombresRun[n] = id;
  return n;
}

/** Le pone al archivo el primer nombre libre «base (2).ext», «base (3).ext»… (ni en la hoja ni en las carpetas). */
function VCH_renombrar_(ctx, archivo, carpetas) {
  const viejo = archivo.getName();
  const m = viejo.match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/), base = m[1].replace(/\s\(\d+\)$/, ''), ext = m[2] || '';
  for (let i = 2; i < 1000; i++) {
    const n = base + ' (' + i + ')' + ext;
    if (ctx.nombres.has(n) || ctx.nombresRun[n]) continue;
    if (VCH_existeEn_(n, [carpetas.entrada, carpetas.procesados, CFG.CARPETA_DESCARTADOS_ID])) continue;
    archivo.setName(n);
    ctx.nombresRun[n] = archivo.getId();
    Logger.log('🏷 Nombre repetido: «' + viejo + '» → «' + n + '»');
    return n;
  }
  return viejo;
}

function VCH_existeEn_(nombre, ids) {
  return ids.some(function (id) { try { return DriveApp.getFolderById(id).getFilesByName(nombre).hasNext(); } catch (e) { return false; } });
}

/** ¿Hay en Procesados / Descartados otro archivo con este nombre y EXACTAMENTE el mismo contenido? */
function VCH_mismoContenido_(archivo, carpetas) {
  const nombre = archivo.getName(), id = archivo.getId();
  let firma = null;
  const dig = function (f) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, f.getBlob().getBytes())); };
  return [carpetas.procesados, CFG.CARPETA_DESCARTADOS_ID].some(function (cid) {
    try {
      const it = DriveApp.getFolderById(cid).getFilesByName(nombre);
      while (it.hasNext()) {
        const f = it.next();
        if (f.getId() === id || f.getSize() !== archivo.getSize()) continue;
        if (firma == null) firma = dig(archivo);
        if (dig(f) === firma) return true;
      }
    } catch (e) {}
    return false;
  });
}


// ============================================================
// 🏷 TÍTULOS CORTOS DE LA HOJA (A–N), una sola vez
// Cada título se cambia SOLO si hoy dice lo esperado (si alguien lo cambió a mano, se deja). Las posiciones no se
// mueven: el procesamiento sigue escribiendo A–N igual. Lo demás (O en adelante) no se toca.
// ============================================================
var VCH_TITULOS_ = [
  [/^fecha de dep/, 'Fecha depósito'], [/^numero de op|^n.? de op/, 'N° operación'], [/^banco/, 'Banco'], [/^moneda/, 'Moneda'],
  [/^monto/, 'Monto'], [/^proveedor/, 'Beneficiario'], [/^idcliente/, 'Doc. depositante'], [/^cliente/, 'Depositante'],
  [/^descripcion/, 'Descripción'], [/^voucher/, 'Imagen'], [/^archivo original/, 'Archivo'], [/^fecha de proc|^fecha proc/, 'Procesado'],
  [/^pagina/, 'Pág.'], [/^enviado por/, 'Canal']
];

function VCH_titulosCortos_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('VCH_TITULOS_CORTOS') === '1') return;
  const norma = function (t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); };
  const cambios = [];
  [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].forEach(function (nombre) {
    const h = obtenerHoja(nombre);
    if (!h || h.getLastColumn() < 14) return;
    const rg = h.getRange(1, 1, 1, 14), v = rg.getValues()[0], nuevo = v.slice();
    let n = 0;
    VCH_TITULOS_.forEach(function (x, i) { if (x[0].test(norma(v[i])) && v[i] !== x[1]) { nuevo[i] = x[1]; n++; } });
    if (n) { rg.setValues([nuevo]); cambios.push(nombre + ': ' + n); }
  });
  props.setProperty('VCH_TITULOS_CORTOS', '1');
  if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'títulos cortos', '', cambios.length ? 'Títulos cambiados · ' + cambios.join(' · ') : 'Nada que cambiar');
}
