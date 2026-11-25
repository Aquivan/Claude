// ============================================================
// ✍️ REVERSOS Y ANOTACIONES A MANO — acordado con el usuario el 25/11/2026
// ------------------------------------------------------------
// Al escanear (celular o escáner) se puede poner, justo después de cada voucher, su REVERSO cuando tiene algo
// escrito con lapicero (empresa, producto, apunte). Antes de leer el PDF como siempre:
//   1. Una consulta corta a Gemini clasifica cada página: frente (voucher) · reverso · otro, y copia SOLO lo escrito a
//      mano con lapicero (sin firmas, sellos ni rúbricas).
//   2. Si hay reversos: en «Entrada» queda un PDF LIMPIO solo con los frentes (mismo nombre) y se lee como siempre;
//      cada reverso va a «✍️ Reversos/páginas (para los enlaces)» (1 página, con franja «REVERSO del voucher pag. 2 - BBVA S/ …»)
//      y una copia COMPRIMIDA del original completo a «✍️ Reversos» (las páginas como JPG).
//   3. Lo escrito a mano va a la columna «✍️ Anotación» (columna O, al final de A–N) de la fila del voucher: «Reverso: Granix» / «Frente: …», con
//      enlace al reverso; si la IA duda, «(revisar)». La columna «Nota» no se toca.
// Automático; se apaga en 🤖 Vouchers → ✍️ Reversos y anotaciones (propiedad VCH_REVERSOS = '0').
// Si algo falla aquí, el PDF se lee como antes (nunca se detiene el proceso).
// ============================================================

var REV_CARPETA_ = '✍️ Reversos';
var REV_COLUMNA_ = '✍️ Anotación';
var REV_SUB_ = 'páginas (para los enlaces)';

function REV_activo_() { return PropertiesService.getScriptProperties().getProperty('VCH_REVERSOS') !== '0'; }

/** Mapa guardado de un archivo en curso: {pagLimpia: {t, id}} o null si aún no se revisó. */
function REV_anotLeer_(nombre) {
  const v = PropertiesService.getScriptProperties().getProperty('VCH_ANOT|' + String(nombre).trim());
  if (v == null) return null;
  try { return JSON.parse(v); } catch (e) { return {}; }
}
function REV_anotGuardar_(nombre, mapa) {
  let s = JSON.stringify(mapa || {});
  if (s.length > 8500) {   // límite de una propiedad: se acortan los textos
    Object.keys(mapa).forEach(function (k) { mapa[k].t = String(mapa[k].t).slice(0, 60); });
    s = JSON.stringify(mapa).slice(0, 8500);
  }
  PropertiesService.getScriptProperties().setProperty('VCH_ANOT|' + String(nombre).trim(), s);
}
function REV_anotBorrar_(nombre) { PropertiesService.getScriptProperties().deleteProperty('VCH_ANOT|' + String(nombre).trim()); }

function REV_empresas_() {
  try {
    const sh = SpreadsheetApp.openById(CFG.SPREADSHEET_ID).getSheetByName('🏢 Empresas');
    if (sh && sh.getLastRow() > 1) return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); }).filter(Boolean);
  } catch (e) {}
  return [];
}

function REV_prompt_(n, empresas) {
  return 'El PDF adjunto tiene ' + n + ' paginas escaneadas de vouchers bancarios de Peru (BCP, BBVA, Interbank, BanBif, Scotiabank, etc.). ' +
    'Para CADA pagina responde un objeto JSON con: "pagina" (1 a ' + n + '), "tipo" y "manuscrito", "dudoso".\n' +
    '"tipo":\n' +
    ' - "frente": la cara del voucher/constancia con datos de la operacion (monto, numero de operacion, fecha, cuenta).\n' +
    ' - "reverso": la parte de ATRAS de un voucher: NO tiene datos propios de una operacion; suele tener solo texto fijo impreso del banco ' +
    '(avisos como "Este comprobante es impreso en papel termico...", publicidad de canales, logos) y/o el texto del frente que se transparenta AL REVES (en espejo), ' +
    'y a veces algo escrito a mano.\n' +
    ' - "otro": cualquier otra cosa (hoja en blanco, documento que no es voucher).\n' +
    '"manuscrito": copia SOLO lo que una persona escribio A MANO con lapicero o lapiz en esa pagina (por ejemplo un nombre, una empresa, un producto, un numero de factura). ' +
    'NO copies texto impreso ni impresion termica, NI firmas, rubricas, iniciales sueltas, vistos, sellos o numeros de caja. Si no hay nada escrito a mano: "". ' +
    'Si una parte no se entiende, pon "?" en esa parte; no inventes.\n' +
    (empresas.length ? 'Si lo escrito a mano es claramente el nombre de una de estas empresas, escribelo EXACTAMENTE asi: ' + empresas.join(', ') + '. Si es otra cosa, copialo tal cual.\n' : '') +
    '"banco" y "monto": SOLO para paginas "frente", el banco y el importe del voucher tal como se ve (ej. "BBVA", "S/ 25,701.12"); en las demas "".\n' +
    '"dudoso": true si no estas seguro del tipo de pagina o de lo escrito a mano; si no, false.\n' +
    'Responde SOLO el arreglo JSON, un objeto por pagina, por ejemplo: [{"pagina":1,"tipo":"frente","manuscrito":"","dudoso":false},{"pagina":2,"tipo":"reverso","manuscrito":"GRANIX","dudoso":false}]';
}

/** Clasifica las páginas de un PDF (base64) con Gemini. Devuelve [{pagina,tipo,manuscrito,dudoso}]. */
function REV_clasificar_(base64, n, empresas) {
  const payload = {
    contents: [{ parts: [{ text: REV_prompt_(n, empresas) }, { inline_data: { mime_type: 'application/pdf', data: base64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' }
  };
  const modelos = modelosGemini_(['gemini-3.5-flash-lite'], false, false);   // ⚡ liviano primero: solo clasificar (antes 3 min)
  let ultimo = '';
  for (let m = 0; m < modelos.length; m++) {
    const resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelos[m] + ':generateContent?key=' + CFG.API_KEY,
      { method: 'POST', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    const code = resp.getResponseCode();
    if (code !== 200) { ultimo = modelos[m] + ' HTTP ' + code; continue; }
    const arr = parsearRespuestaGemini_(resp);
    if (Array.isArray(arr) && arr.length) return arr;
    ultimo = modelos[m] + ' sin respuesta';
  }
  throw new Error('No se pudo clasificar las páginas (' + ultimo + ')');
}

/**
 * 🗜 El escaneo completo como JPG por página (vista previa de Drive, 1400 px): pesa mucho menos y se lee igual.
 * Cada página conserva su tamaño; la que no se pudo convertir va como estaba.
 */
async function REV_comprimir_(pdfDoc) {
  const n = pdfDoc.getPageCount(), pdfs = [];
  for (let i = 0; i < n; i++) {
    const d1 = await PDFLib.PDFDocument.create();
    const [p1] = await d1.copyPages(pdfDoc, [i]);
    d1.addPage(p1);
    pdfs.push(Utilities.base64Encode(Utilities.newBlob([...new Int8Array(await d1.save())], MimeType.PDF, 'p.pdf').getBytes()));
  }
  const imgs = LEC_imagenesParalelo_(pdfs, 1400);
  const out = await PDFLib.PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const im = imgs[i];
    if (im && im.jpg) {
      const jpg = await out.embedJpg(new Uint8Array(Utilities.base64Decode(im.jpg)));   // los bytes de Apps Script vienen con signo: pdf-lib pide Uint8Array
      const orig = pdfDoc.getPage(i).getSize();
      const w = orig.width, h = orig.width * jpg.height / jpg.width;
      out.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    } else {
      const [pg] = await out.copyPages(pdfDoc, [i]);
      out.addPage(pg);
    }
  }
  return out;
}

/** Texto que la fuente básica del PDF puede dibujar (sin emojis; tildes fuera para no fallar). */
function REV_ascii_(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, ''); }

function REV_carpeta_(carpetas) {
  const proc = DriveApp.getFolderById(carpetas.procesados);
  const it = proc.getFoldersByName(REV_CARPETA_);
  return it.hasNext() ? it.next() : proc.createFolder(REV_CARPETA_);
}

/**
 * Antes de leer un PDF nuevo. Devuelve null (nada que hacer) o {anot, archivo?, pdfDoc?}:
 * archivo / pdfDoc = el PDF limpio (solo frentes) que se lee en lugar del original.
 */
async function REV_separar_(archivo, pdfDoc, nombre, carpetas) {
  const total = pdfDoc.getPageCount();
  const t0 = Date.now();
  const empresas = REV_empresas_();
  // 1) clasificar en tramos de 15 páginas
  const info = [];
  for (let ini = 0; ini < total; ini += 15) {
    const fin = Math.min(ini + 15, total), idx = [];
    for (let i = ini; i < fin; i++) idx.push(i);
    const d = await PDFLib.PDFDocument.create();
    (await d.copyPages(pdfDoc, idx)).forEach(function (p) { d.addPage(p); });
    const b64 = Utilities.base64Encode(Utilities.newBlob([...new Int8Array(await d.save())], MimeType.PDF, 'c.pdf').getBytes());
    const arr = REV_clasificar_(b64, idx.length, empresas);
    arr.forEach(function (o) {
      const p = parseInt(o && o.pagina, 10);
      if (p >= 1 && p <= idx.length) info[ini + p - 1] = { tipo: String(o.tipo || '').toLowerCase(), m: String(o.manuscrito || '').trim(), dud: o.dudoso === true,
        banco: String(o.banco || '').trim(), monto: String(o.monto || '').trim() };
    });
  }
  for (let i = 0; i < total; i++) if (!info[i]) info[i] = { tipo: 'frente', m: '', dud: false };   // sin dato: como siempre
  const hayRev = info.some(function (x) { return x.tipo === 'reverso'; });
  const hayMano = info.some(function (x) { return x.m; });
  const nRev = info.filter(function (x) { return x.tipo === 'reverso'; }).length;
  if (!hayRev && !hayMano) { REV_anotGuardar_(nombre, {}); return null; }

  // 2) página limpia de cada frente (1-based) y qué reverso le toca. Todos los reversos van JUNTOS en un solo PDF
  //    («<archivo> · reversos.pdf»), cada página con una etiqueta arriba: de qué voucher es (pág. del PDF en Procesados).
  const limpias = [], anot = {}, base = nombre.replace(/\.pdf$/i, '');
  const sinFrente = [], revs = [];   // revs: {i, etiqueta, k}
  const fmt = function (o, lado) { return o.m ? lado + ': ' + o.m + (o.dud ? ' (revisar)' : '') : ''; };
  for (let i = 0; i < total; i++) {
    const o = info[i];
    if (o.tipo === 'reverso') {
      const prev = i - 1;
      const tieneFrente = prev >= 0 && info[prev].tipo !== 'reverso';
      if (!tieneFrente) { sinFrente.push(i + 1); revs.push({ i: i, etiqueta: 'REVERSO SIN VOUCHER ANTES (pag. ' + (i + 1) + ' del escaneo original)' }); continue; }
      const k = String(limpias.length);   // página limpia del frente anterior (ya agregado)
      const f0 = info[prev];
      revs.push({ i: i, k: k, etiqueta: 'REVERSO del voucher pag. ' + k + (f0.banco || f0.monto ? ' - ' + [f0.banco, f0.monto].filter(Boolean).join(' ') : '') });
      const txt = fmt(o, 'Reverso') || 'Reverso (sin anotación)';
      anot[k] = anot[k] ? { t: anot[k].t + ' · ' + txt, id: '' } : { t: txt, id: '' };
      continue;
    }
    limpias.push(i);
    const tf = fmt(o, 'Frente');
    if (tf) anot[String(limpias.length)] = { t: tf, id: '' };
  }
  let carpeta = null, chico = null;
  if (revs.length) {
    carpeta = REV_carpeta_(carpetas);
    // 🗜 copia COMPRIMIDA de todo el escaneo (páginas como JPG): con ella se arman la copia del original y los reversos
    try { chico = await REV_comprimir_(pdfDoc); } catch (eC) { Logger.log('✍️ Comprimir: ' + eC.message + ' → sin comprimir'); chico = null; }
    const fuenteDoc = chico || pdfDoc;
    const d = await PDFLib.PDFDocument.create();
    const fuente = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const pags = await d.copyPages(fuenteDoc, revs.map(function (r) { return r.i; }));
    pags.forEach(function (pg, q) {
      d.addPage(pg);
      try {
        const mb = pg.getMediaBox(), w = mb.width, h = mb.height;
        const txt = REV_ascii_(revs[q].etiqueta);
        let fs = Math.max(8, Math.min(22, w / 32));
        while (fs > 6 && fuente.widthOfTextAtSize(txt, fs) > w - 20) fs -= 1;
        const alto = fs * 1.8;
        // franja AGREGADA arriba (la página crece; no tapa nada del reverso)
        pg.setMediaBox(mb.x, mb.y, w, h + alto);
        pg.setCropBox(mb.x, mb.y, w, h + alto);
        pg.drawRectangle({ x: mb.x, y: mb.y + h, width: w, height: alto, color: PDFLib.rgb(1, 0.95, 0.6) });
        pg.drawText(txt, { x: mb.x + 10, y: mb.y + h + fs * 0.55, size: fs, font: fuente, color: PDFLib.rgb(0.1, 0.1, 0.1) });
      } catch (eE) { Logger.log('✍️ Etiqueta del reverso: ' + eE.message); }
    });
    // (ya no se guarda un «· reversos.pdf» con todos juntos: repetía lo de «páginas» — pedido del usuario 25/11/2026)
    // 🔗 El visor de Drive siempre abre un PDF en la página 1: para que el enlace de «✍️ Anotación» muestre EXACTO su
    // reverso, cada uno se guarda también solo (1 página, con su franja) en la subcarpeta «páginas» (no estorba a la vista).
    let sub = null;
    for (let q = 0; q < revs.length; q++) {
      const k = revs[q].k;
      if (!k || !anot[k]) continue;
      try {
        if (!sub) { const it = carpeta.getFoldersByName(REV_SUB_); sub = it.hasNext() ? it.next() : carpeta.createFolder(REV_SUB_); }
        const u = await PDFLib.PDFDocument.create();
        const [pq] = await u.copyPages(d, [q]);
        u.addPage(pq);
        const f1 = sub.createFile(Utilities.newBlob([...new Int8Array(await u.save())], MimeType.PDF, base + ' · reverso del voucher pág ' + k + '.pdf'));
        anot[k].id = f1.getId();
      } catch (e1) { Logger.log('✍️ Reverso suelto pág ' + k + ': ' + e1.message); }
    }
  }

  let res = { anot: anot };
  if (hayRev) {
    carpeta = carpeta || REV_carpeta_(carpetas);
    // copia del original completo (por seguridad) y PDF limpio en Entrada con el mismo nombre
    if (chico) carpeta.createFile(Utilities.newBlob([...new Int8Array(await chico.save())], MimeType.PDF, base + ' (original con reversos).pdf'));
    else archivo.makeCopy(base + ' (original con reversos).pdf', carpeta);
    const limpio = await PDFLib.PDFDocument.create();
    (await limpio.copyPages(pdfDoc, limpias)).forEach(function (p) { limpio.addPage(p); });
    const bytes = await limpio.save();
    const entrada = DriveApp.getFolderById(carpetas.entrada);
    const nuevo = entrada.createFile(Utilities.newBlob([...new Int8Array(bytes)], MimeType.PDF, nombre));
    // el original ya quedó copiado en «✍️ Reversos»: se saca de Entrada (si no se puede, se deshace y se lee como antes)
    let fuera = false;
    try { archivo.setTrashed(true); fuera = true; } catch (eT) {
      try { entrada.removeFile(archivo); fuera = true; } catch (eR) { Logger.log('✍️ No pude sacar el original de Entrada: ' + eR.message); }
    }
    if (!fuera) { try { nuevo.setTrashed(true); } catch (eN) {} return null; }
    REV_anotGuardar_(nombre, anot);
    res.archivo = nuevo;
    res.pdfDoc = await PDFLib.PDFDocument.load(new Uint8Array(bytes));
  } else REV_anotGuardar_(nombre, anot);

  const det = total + ' pág · ' + nRev + ' reverso(s) · ' + Object.keys(anot).length + ' anotación(es)' +
    (sinFrente.length ? ' · ⚠️ reverso sin frente en pág ' + sinFrente.join(', ') : '') + ' · ' + Math.round((Date.now() - t0) / 1000) + ' s';
  Logger.log('✍️ Reversos: ' + nombre + ' · ' + det);
  if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'reversos y anotaciones', '', nombre + ' · ' + det);
  return res;
}

/**
 * Columna «✍️ Anotación»: la crea una sola vez como columna O, al final del bloque que llena el bot (A–N), con el mismo
 * formato de título que A–N; la línea gruesa queda después (entre «✍️ Anotación» y «Empresa»). Devuelve su número o -1.
 */
function REV_columna_(hoja) {
  const tit = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
  for (let i = 0; i < tit.length; i++) if (/anotaci/.test(tit[i])) return i + 1;
  const props = PropertiesService.getScriptProperties(), clave = 'VCH_COL_ANOTACION|' + hoja.getName();
  if (props.getProperty(clave) === '1') return -1;   // el usuario la borró: no se vuelve a crear
  hoja.insertColumnAfter(14);   // después de N («Canal»): el bot escribe A–N por posición, así no se mueve nada de A–N
  const col = 15;
  hoja.getRange(1, 14).copyTo(hoja.getRange(1, col), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  hoja.getRange(1, col).setValue(REV_COLUMNA_);
  hoja.getRange(1, col, hoja.getMaxRows(), 1).setBorder(null, null, null, false, null, null);
  hoja.getRange(1, col + 1, hoja.getMaxRows(), 1).setBorder(null, true, null, null, null, null, '#0f172a', SpreadsheetApp.BorderStyle.SOLID_THICK);
  hoja.setColumnWidth(col, 220);
  props.setProperty(clave, '1');
  return col;
}

/** Escribe las anotaciones pendientes del lote (ctx.anotPend = [{fila, t, id}]). */
function REV_escribir_(ctx) {
  const pend = ctx.anotPend || [];
  ctx.anotPend = [];
  if (!pend.length) return;
  try {
    const col = REV_columna_(ctx.hoja);
    if (col < 0) return;
    pend.forEach(function (a) {
      const rg = ctx.hoja.getRange(a.fila, col);
      if (a.id) rg.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(a.t).setLinkUrl('https://drive.google.com/file/d/' + a.id + '/view').build());
      else rg.setValue(a.t);
    });
  } catch (e) { Logger.log('✍️ Anotaciones: ' + e.message); }
}

function REV_menuInterruptor() {
  const props = PropertiesService.getScriptProperties(), ui = SpreadsheetApp.getUi();
  const activo = REV_activo_();
  const r = ui.alert('✍️ Reversos y anotaciones', 'Ahora está ' + (activo ? 'ACTIVADO' : 'APAGADO') + '.\n\n' +
    'Activado: si un PDF trae el reverso de un voucher (con algo escrito a mano) justo después de su frente, se separa a la carpeta «✍️ Reversos» y lo escrito pasa a la columna «✍️ Anotación».\n\n¿' +
    (activo ? 'Apagarlo' : 'Activarlo') + '?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  props.setProperty('VCH_REVERSOS', activo ? '0' : '1');
  ui.alert(activo ? '⏸ Apagado: los PDF se leen como antes.' : '✅ Activado.');
}
