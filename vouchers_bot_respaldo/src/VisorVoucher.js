// ============================================================
// 👁 VISOR DE VOUCHER (panel a la derecha de la hoja)
// ------------------------------------------------------------
// Mientras el panel este abierto, al hacer clic en una fila muestra su voucher
// en grande (la misma imagen de la columna J) y los datos de la fila. Para
// apagarlo basta cerrar el panel. No publica nada: la imagen es la de la hoja
// y el PDF original se abre desde Drive con la cuenta de quien mira.
// Funciones VV_.
// ============================================================

function VV_abrir() {
  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutputFromFile('VisorVoucherVista').setTitle('👁 Visor de voucher'));
}

/** Ventana grande (flotante, se puede mover): el mismo visor. */
function VV_abrirGrande() {
  SpreadsheetApp.getUi().showModelessDialog(
    HtmlService.createHtmlOutputFromFile('VisorVoucherVista').setWidth(900).setHeight(680), '👁 Visor de voucher');
}

/** Hoja y fila seleccionadas ahora (el panel pregunta ~2 veces por segundo). */
function VV_seleccion() {
  const sh = SpreadsheetApp.getActiveSheet();
  const r = sh.getActiveRange();
  return { hoja: sh.getName(), fila: r ? r.getRow() : 0 };
}

/** Si la fila seleccionada cambio, devuelve sus datos; si no, {igual:true} (una sola llamada: mas rapido). */
function VV_estado(hoja, fila) {
  const s = VV_seleccion();
  if (s.hoja === hoja && s.fila === fila) return { igual: true };
  return VV_datos(s.hoja, s.fila);
}

/** Pase de un rato para que el visor baje el archivo original directo de Drive (solo en el navegador de quien mira). */
function VV_pase() {
  return ScriptApp.getOAuthToken();
}

/** ID del archivo original en Drive por su nombre (se recuerda 6 h para no buscar cada vez). */
function VV_idArchivo_(nombre) {
  if (!nombre) return null;
  const cache = CacheService.getScriptCache(), k = 'vv_id_' + Utilities.base64EncodeWebSafe(nombre).slice(0, 200);
  const g = cache.get(k);
  if (g) return JSON.parse(g);
  const f = buscarArchivoPorNombre(nombre);
  const r = f ? { id: f.getId(), mime: f.getMimeType() } : null;
  if (r) cache.put(k, JSON.stringify(r), 21600);
  return r;
}

/** Datos de una fila: imagen de la columna J, archivo (K), pagina (M) y las primeras columnas. */
function VV_datos(hoja, fila) {
  const sh = SpreadsheetApp.getActive().getSheetByName(hoja);
  if (!sh || fila < 2 || fila > sh.getLastRow()) return { hoja: hoja, fila: fila, vacio: true };
  const nCol = Math.min(sh.getLastColumn(), 13);
  const tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0];
  const val = sh.getRange(fila, 1, 1, nCol).getDisplayValues()[0];
  let img = '';
  try {
    const c = sh.getRange(fila, 10).getValue();   // J: imagen en la celda (CellImage)
    if (c && typeof c === 'object') img = (c.getContentUrl && c.getContentUrl()) || (c.getUrl && c.getUrl()) || '';
  } catch (e) {}
  const campos = [];
  for (let i = 0; i < Math.min(9, nCol); i++) {
    if (String(val[i]).trim()) campos.push([String(tit[i] || ('Col ' + (i + 1))).trim(), String(val[i]).trim()]);
  }
  return {
    hoja: hoja, fila: fila, img: img,
    texto: img ? '' : String(val[9] || '').trim(),   // "Ver PDF (...)" o vacio
    archivo: String(val[10] || '').trim(), pagina: String(val[12] || '').trim(), campos: campos,
    original: VV_idArchivo_(String(val[10] || '').trim())   // {id, mime}: el visor lo baja de Drive y muestra la pagina exacta
  };
}

/** Ir a otra fila de la misma pestaña (botones ◀ ▶ del visor). */
function VV_ir(hoja, fila) {
  const sh = SpreadsheetApp.getActive().getSheetByName(hoja);
  if (!sh) return;
  fila = Math.max(2, Math.min(fila, sh.getLastRow()));
  sh.setActiveRange(sh.getRange(fila, 1));
  return fila;
}

/** Enlace al archivo original en Drive (PDF o foto). */
function VV_urlArchivo(nombre) {
  const f = nombre ? buscarArchivoPorNombre(nombre) : null;
  return f ? f.getUrl() : '';
}
