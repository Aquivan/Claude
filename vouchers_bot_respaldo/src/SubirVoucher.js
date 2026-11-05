// ============================================================
// 📤 SUBIR VOUCHERS DESDE LA HOJA (menú 🤖 Vouchers)
// ------------------------------------------------------------
// Ventana para elegir o arrastrar PDF e imágenes, ponerles el nombre que
// uno quiera y dejarlos en la carpeta de ENTRADA de Originales o de Fotos.
// Luego se procesan como cualquier otro (cada 10 min, o en ~1 minuto si se
// toca "▶ Procesar ahora"). El nombre importa: con él se encuentra después
// el archivo original (visor, reparar imágenes), por eso no se permite
// repetir uno que ya exista. Funciones SV_.
// ============================================================

/** Abre la ventana de subida. */
function SV_abrir() {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutputFromFile('SubirVoucherVista').setWidth(960).setHeight(660), '📤 Subir vouchers (PDF o imagen)');
}

/** Quita caracteres que Drive o el sistema no se llevan bien, y espacios de más. */
function SV_limpiarNombre_(n) {
  return String(n || '').replace(/[\\/:*?"<>|#\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}

/** ¿Ya existe un archivo con ese nombre (en entrada, procesados o descartados)? Devuelve los nombres repetidos. */
function SV_repetidos(nombres) {
  return (nombres || []).filter(function (n) { return n && buscarArchivoPorNombre(SV_limpiarNombre_(n)); });
}

/**
 * Sube un archivo. a = {nombre, mime, datos (base64), destino: 'original'|'foto'}.
 * Devuelve {ok, nombre, url} o {ok:false, error}.
 */
function SV_subir(a) {
  try {
    const nombre = SV_limpiarNombre_(a && a.nombre);
    if (!nombre) return { ok: false, error: 'Falta el nombre.' };
    if (!/^(application\/pdf|image\/)/.test(String(a.mime || ''))) return { ok: false, error: 'Solo PDF o imágenes.' };
    if (buscarArchivoPorNombre(nombre)) return { ok: false, error: 'Ya existe un archivo llamado «' + nombre + '». Cámbiele el nombre.' };
    const bytes = Utilities.base64Decode(String(a.datos || ''));
    if (bytes.length > CFG.MAX_MB_ARCHIVO * 1024 * 1024) return { ok: false, error: 'Pesa más de ' + CFG.MAX_MB_ARCHIVO + ' MB.' };
    const carpeta = DriveApp.getFolderById(carpetasParaTipo_(a.destino === 'foto' ? 'foto' : 'original').entrada);
    const f = carpeta.createFile(Utilities.newBlob(bytes, a.mime, nombre));
    return { ok: true, nombre: f.getName(), url: f.getUrl() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** ▶ Procesar ahora: programa el procesamiento para dentro de ~1 minuto (sin esperar la vuelta de 10 min). */
function SV_procesarPronto() {
  programarReintentoAutomatico_();
  return true;
}
