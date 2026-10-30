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
function VV_abrirGrande(ancho, alto) {
  ancho = Math.max(700, Math.min(Number(ancho) || 1180, 3000)); alto = Math.max(450, Math.min(Number(alto) || 720, 2000));
  SpreadsheetApp.getUi().showModelessDialog(
    HtmlService.createHtmlOutputFromFile('VisorVoucherVista').setWidth(ancho).setHeight(alto), '👁 Visor de voucher');
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
  let f = buscarArchivoPorNombre(nombre) || VV_buscarEnTodoDrive_(nombre);
  const r = f ? { id: f.getId(), mime: f.getMimeType() } : null;
  cache.put(k, JSON.stringify(r), r ? 21600 : 600);   // si no está, se vuelve a buscar en 10 min
  return r;
}

/**
 * Si no está en las carpetas del sistema (lo movieron, lo subieron a otra carpeta o le cambiaron la extensión),
 * se busca en todo el Drive de quien mira: primero el nombre exacto, luego sin extensión, luego que empiece igual.
 */
function VV_buscarEnTodoDrive_(nombre) {
  const q = function (t) { return String(t).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); };
  const base = String(nombre).replace(/\.[A-Za-z0-9]{2,5}$/, '');
  const intentos = ["title = '" + q(nombre) + "'", "title = '" + q(base) + "'", "title contains '" + q(base.slice(0, 60)) + "'"];
  for (let i = 0; i < intentos.length; i++) {
    try {
      const it = DriveApp.searchFiles(intentos[i] + " and trashed = false and (mimeType = 'application/pdf' or mimeType contains 'image/')");
      if (!it.hasNext()) continue;
      const f = it.next();
      if (i < 2 || !it.hasNext()) return f;   // «empieza igual» solo si hay uno: no mostrar el voucher de otro archivo
    } catch (e) {}
  }
  return null;
}

/** La imagen de la celda (J) como data:… (el enlace que da Google vence; así se ve igual). */
function VV_imagenCelda(hoja, fila) {
  const sh = SpreadsheetApp.getActive().getSheetByName(hoja);
  if (!sh) return '';
  const c = sh.getRange(fila, 10).getValue();
  const url = c && typeof c === 'object' && !(c instanceof Date) ? ((c.getContentUrl && c.getContentUrl()) || (c.getUrl && c.getUrl()) || '') : '';
  if (!url) return '';
  const r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return '';
  const b = r.getBlob();
  return 'data:' + (b.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(b.getBytes());
}

/** Datos de una fila: el original (K, pagina M), la imagen de la celda (J) y TODAS las columnas para ver y corregir. */
function VV_datos(hoja, fila) {
  const sh = SpreadsheetApp.getActive().getSheetByName(hoja);
  if (!sh || fila < 2 || fila > sh.getLastRow()) return { hoja: hoja, fila: fila, vacio: true };
  const nCol = sh.getLastColumn();
  const rg = sh.getRange(fila, 1, 1, nCol);
  const tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0];
  const ver = rg.getDisplayValues()[0], crudo = rg.getValues()[0], formulas = rg.getFormulas()[0], reglas = rg.getDataValidations()[0];
  let img = '';
  try {
    const c = crudo[9];   // J: imagen en la celda (CellImage)
    if (c && typeof c === 'object' && !(c instanceof Date)) img = (c.getContentUrl && c.getContentUrl()) || (c.getUrl && c.getUrl()) || '';
  } catch (e) {}
  const cols = [];
  for (let i = 0; i < nCol; i++) {
    if (i === 9) continue;   // J es la imagen
    const t = String(tit[i] || '').trim();
    if (!t && !String(ver[i]).trim()) continue;
    const c = { c: i + 1, t: t || ('Col ' + (i + 1)), v: String(ver[i]), tipo: 'texto' };
    const r = reglas[i];
    if (formulas[i]) c.tipo = 'formula';
    else if (r && r.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX) { c.tipo = 'check'; c.v = crudo[i] === true; }
    else if (r && r.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) { c.tipo = 'lista'; c.op = (r.getCriteriaValues()[0] || []).map(String); }
    else if (r && r.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      try { c.tipo = 'lista'; c.op = r.getCriteriaValues()[0].getDisplayValues().map(function (x) { return String(x[0]); }).filter(String).slice(0, 300); } catch (e) { c.tipo = 'texto'; }
    }
    else if (crudo[i] instanceof Date) c.tipo = 'fecha';
    else if (typeof crudo[i] === 'number') c.tipo = 'numero';
    cols.push(c);
  }
  return {
    hoja: hoja, fila: fila, img: img,
    texto: img ? '' : String(ver[9] || '').trim(),   // "Ver PDF (...)" o vacio
    archivo: String(ver[10] || '').trim(), pagina: String(ver[12] || '').trim(), cols: cols,
    clave: { b: String(ver[1]), k: String(ver[10]) },   // para comprobar al guardar que sigue siendo el mismo voucher
    original: VV_idArchivo_(String(ver[10] || '').trim())   // {id, mime}: el visor lo baja de Drive y muestra la pagina exacta
  };
}

/** Guarda lo corregido en el visor (ya confirmado por la persona). cambios = {columna: valor}. Devuelve los datos nuevos. */
function VV_guardar(hoja, fila, clave, cambios) {
  const sh = SpreadsheetApp.getActive().getSheetByName(hoja);
  if (!sh) throw new Error('No encontré la pestaña ' + hoja + '.');
  const ver = sh.getRange(fila, 1, 1, Math.max(11, sh.getLastColumn())).getDisplayValues()[0];
  if (!clave || String(ver[1]) !== String(clave.b) || String(ver[10]) !== String(clave.k)) {
    throw new Error('La fila ' + fila + ' ya no es el mismo voucher (¿se ordenó la hoja o entraron filas nuevas?). No guardé nada: vuelva a seleccionarlo.');
  }
  Object.keys(cambios || {}).forEach(function (k) {
    const col = parseInt(k, 10);
    if (!(col >= 1) || col === 10) return;
    const celda = sh.getRange(fila, col);
    if (celda.getFormula()) return;   // las formulas no se tocan
    let v = cambios[k], m;
    if (v === true || v === false) { celda.setValue(v); return; }
    v = String(v == null ? '' : v).trim();
    const antes = celda.getValue();
    if (antes instanceof Date && (m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) v = new Date(Number(m[3].length === 2 ? '20' + m[3] : m[3]), Number(m[2]) - 1, Number(m[1]));
    else if (typeof antes === 'number' && v !== '' && !isNaN(Number(v.replace(/,/g, '')))) v = Number(v.replace(/,/g, ''));
    celda.setValue(v);
  });
  return VV_datos(hoja, fila);
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

/**
 * 🔎 Índice para el buscador del visor: todas las filas de Originales y Fotos con los datos para filtrar
 * (fecha, banco, moneda, monto, proveedor, empresa, marcas) y la clave de duplicado (la misma que usa el
 * procesador: n° de operación | banco | monto). Se filtra en el navegador: así cada cambio de filtro es al instante.
 */
function VV_indice() {
  const ss = SpreadsheetApp.getActive();
  const hojas = [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS];
  const norma = function (t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); };
  const filas = [];
  hojas.forEach(function (nombre, h) {
    const sh = ss.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    const nCol = sh.getLastColumn(), n = sh.getLastRow() - 1;
    const tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0].map(norma);
    const col = function (re, def) { const i = tit.findIndex(function (t) { return re.test(t); }); return i >= 0 ? i : def; };
    const iF = col(/^fecha de dep/, 0), iOp = col(/^numero de op|^n.? de op/, 1), iB = col(/^banco/, 2), iMon = col(/^moneda/, 3), iM = col(/^monto/, 4), iP = col(/^proveedor/, 5);
    const iCli = col(/^cliente/, 7), iDes = col(/^descripcion/, 8), iArch = col(/^archivo original/, 10), iPag = col(/^pagina/, 12);
    const iRev = col(/^revisado/, -1), iPR = col(/^por retener/, -1), iRet = col(/^retenido/, -1), iEmp = col(/^empresa/, -1), iIdB = col(/^id benef/, -1);
    const rg = sh.getRange(2, 1, n, nCol), ver = rg.getDisplayValues(), crudo = rg.getValues();
    for (let r = 0; r < n; r++) {
      const v = ver[r], c = crudo[r];
      if (!String(v[iOp] || '').trim() && !String(v[iM] || '').trim() && !String(v[iP] || '').trim()) continue;   // fila vacía
      const f = c[iF] instanceof Date ? Utilities.formatDate(c[iF], 'America/Lima', 'yyyyMMdd') : '';
      const op = String(c[iOp] == null ? '' : c[iOp]).trim();
      const si = function (i) { return i >= 0 && (c[i] === true || /^(true|si|sí|x|✔)$/i.test(String(v[i]).trim())); };
      filas.push([h, r + 2, f, v[iF], v[iOp], v[iB], v[iMon], Number(c[iM]) || 0, v[iP], iEmp >= 0 ? v[iEmp] : '',
        si(iRev) ? 1 : 0, si(iPR) ? 1 : 0, si(iRet) ? 1 : 0, iIdB >= 0 ? v[iIdB] : '', v[iCli], v[iDes], v[iArch], v[iPag],
        op ? claveDuplicado(op, c[iB], c[iM]) : '',
        norma(v.filter(function (x, i) { return i !== 9; }).join(' | '))]);
    }
  });
  return { hojas: hojas, filas: filas };
}
