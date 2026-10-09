// ============================================================
// UTILIDADES
// ============================================================

function forzarVacio(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') {
    const v = valor.trim().toLowerCase();
    if (v === 'no especificado' || v === 'null' || v === 'n/a' ||
        v === 'ninguno' || v === '-' || v === 'sin dato') return '';
    return valor.trim();
  }
  return valor;
}

function parsearFecha(fechaStr) {
  if (!fechaStr) return '';
  const str   = fechaStr.toString().trim();
  const match = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    let d = parseInt(match[1], 10);
    let m = parseInt(match[2], 10) - 1;
    let a = parseInt(match[3], 10);
    if (a < 100) a += 2000;
    const fecha = new Date(a, m, d, 0, 0, 0);
    if (!isNaN(fecha.getTime())) return fecha;
  }
  return str;
}

function parsearMonto(valor) {
  if (!valor && valor !== 0) return 0;
  if (typeof valor === 'number') return valor;
  let str = valor.toString().replace(/[S\/\s\*]/g, '').trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(str)) {
    str = str.replace(/,/g, '');
  } else {
    str = str.replace(/[^0-9.]/g, '');
  }
  return parseFloat(str) || 0;
}

function moverArchivo(archivo, carpetaOrigenId, carpetaDestinoId) {
  try {
    DriveApp.getFolderById(carpetaDestinoId).addFile(archivo);
    DriveApp.getFolderById(carpetaOrigenId).removeFile(archivo);
  } catch (e) {
    Logger.log('  No se pudo mover el archivo: ' + e.message);
  }
}
