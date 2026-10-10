/**
 * Importar.js — "📥 Importar mi análisis" (parte del módulo 🤝 Conciliar con IA).
 *
 * Usted sube su trabajo anterior (Excel/CSV como "GRANIX RETENCIONES ANALISIS",
 * pestaña PAGOS) o fotos/PDF de vouchers o facturas (los lee la IA de
 * 🤝 Conciliar con IA). El sistema:
 *   1. Guarda el archivo en una carpeta TEMPORAL de Drive (se borra sola a los 7 días).
 *   2. Lee cada fila: N° OP, fecha, monto, COD_SUNAT (RUC-tipo-serie-número),
 *      razón social, modalidad (pago, retención, N/C).
 *   3. Junta las filas de pago por N° OP ("OP-663" = "663" = "000663") y busca
 *      el voucher en Originales y en Fotos (mismo N°, monto y fecha ±5 días).
 *   4. Muestra en la pestaña "🤝 Importar" qué se completaría en cada voucher.
 *      Lo que no encuentra o le da duda NO lo adivina: lo lista con los
 *      vouchers posibles para que usted elija ("Voucher elegido ✏️").
 *   5. "✅ Completar vouchers marcados" escribe SOLO en celdas vacías:
 *      ID Beneficiario (RUC), Tipo y Nº Doc. (factura), Empresa e ID Usuario.
 *      Todo queda anotado en _ImportLog y se puede deshacer.
 * Las filas de retención y N/C del archivo no se escriben en vouchers: solo se
 * comparan con lo que Cobranzas ya tiene (SUNAT/SIRE), como aviso.
 */

var IMP_HOJA_ = '🤝 Importar';
var IMP_LOG_ = '_ImportLog';
var IMP_CARPETA_ = '🤝 Importaciones (temporal · se borran a los 7 días)';
var IMP_DIAS_ = 7;
var IMP_F_ENC_ = 8;
var IMP_ENC_ = ['✔ Completar', 'Estado', 'N° OP (archivo)', 'Fecha (archivo)', 'Monto (archivo)', 'Proveedor (archivo)',
  'RUC beneficiario ✏️', 'Factura(s) ✏️', 'Empresa ✏️', 'Voucher(s) encontrado(s)', 'Monto voucher', 'Beneficiario voucher (col. F)',
  'Se completará (solo celdas vacías)', 'Ya tenía otro dato (no se toca)', 'Posibles vouchers / dudas', 'Voucher elegido ✏️',
  'Origen (archivo · fila)', 'Resultado'];
var IMP_C_ = {}; IMP_ENC_.forEach(function (n, i) { IMP_C_[n] = i; });
var IMP_EST_ = { OK: '✅ Encontrado', LLENO: '✔ Nada nuevo que completar', DUDA: '🟠 Revisar', NO: '❌ No está en Vouchers', INFO: 'ℹ️ Solo informativo' };

/* ------------------------------------------------------------ menú */

function IMP_menuSubir() {
  var html = HtmlService.createHtmlOutputFromFile('ImportarDialogo').setWidth(560).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, '📥 Importar mi análisis (Excel, foto o PDF)');
}

/** Datos para el diálogo: empresas del grupo. */
function IMP_datosDialogo() {
  var cfg = leerConfig_(SpreadsheetApp.getActiveSpreadsheet());
  return {
    empresas: cfg.grupo.map(function (r) { return { ruc: r, nombre: cfg.nombreEmpresa[r] || r }; }),
    tieneClave: !!CIA_ia_(CIA_hoja_(SpreadsheetApp.getActiveSpreadsheet())).clave,
  };
}

/**
 * Recibe lo subido desde el diálogo.
 * datos = { empresaRuc, archivos: [{nombre, mime, base64, filas?: [[...]], hoja?}] }
 * (Excel/CSV llegan ya leídos en "filas"; fotos/PDF solo en base64.)
 */
function IMP_subir(datos) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return IMP_procesar_(ss, datos.archivos || [], String(datos.empresaRuc || ''), true);
}

/** Lee los archivos, los cruza con Vouchers y arma la pestaña 🤝 Importar. */
function IMP_procesar_(ss, archivos, empresaRuc, guardarCopia) {
  var cfg = leerConfig_(ss);
  var sh = IMP_hoja_(ss);
  IMP_limpiarTemporales_(true);
  var carpeta = guardarCopia ? IMP_carpeta_(ss) : null;
  var lote = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HH:mm');
  var filas = [], avisos = [];
  archivos.forEach(function (a) {
    if (carpeta) {
      try {
        var blob = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', lote.replace(':', '') + ' - ' + a.nombre);
        carpeta.createFile(blob);
      } catch (e) { avisos.push(a.nombre + ': no se pudo guardar la copia temporal (' + e.message + ')'); }
    }
    try {
      var leidas = a.filas ? IMP_leerTabla_(a.filas, a.nombre + (a.hoja ? ' · ' + a.hoja : ''), sh)
        : IMP_leerConIA_(sh, a);
      filas = filas.concat(leidas);
      if (!leidas.length) avisos.push(a.nombre + ': no se encontraron filas con N° de operación o monto.');
    } catch (e) { avisos.push(a.nombre + ': ' + e.message); }
  });
  var res = IMP_cruzar_(ss, cfg, filas, empresaRuc);
  IMP_escribir_(sh, res.tabla);
  var resumen = '📥 ' + lote + ' · ' + filas.length + ' filas leídas · ' + res.cuenta[IMP_EST_.OK] + ' encontrados para completar · ' +
    res.cuenta[IMP_EST_.LLENO] + ' sin nada nuevo · ' + res.cuenta[IMP_EST_.DUDA] + ' por revisar · ' + res.cuenta[IMP_EST_.NO] +
    ' no están en Vouchers' + (res.cuenta[IMP_EST_.INFO] ? ' · ' + res.cuenta[IMP_EST_.INFO] + ' retenciones/N/C (informativo)' : '');
  sh.getRange('B4').setValue(resumen + (avisos.length ? '\n⚠️ ' + avisos.join('\n⚠️ ') : ''));
  ss.setActiveSheet(sh);
  return resumen + (avisos.length ? '\n\n⚠️ ' + avisos.join('\n⚠️ ') : '') +
    '\n\nRevise la pestaña 🤝 Importar y use 🤝 Conciliar con IA → ✅ Completar vouchers marcados.';
}

/* ------------------------------- importar desde la carpeta de Drive */

/**
 * Alternativa a la ventana de subida (que falla con "PERMISSION_DENIED" cuando
 * el navegador tiene varias cuentas de Google abiertas): usted copia el Excel,
 * la foto o el PDF a la carpeta temporal en Drive y este menú los lee de ahí.
 */
function IMP_menuDesdeCarpeta() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var cfg = leerConfig_(ss);
  var carpeta = IMP_carpeta_(ss);
  var it = carpeta.getFiles(), lista = [];
  while (it.hasNext()) {
    var f = it.next();
    if (/\.(xlsx|csv)$|^image\/|pdf|spreadsheet|csv/i.test(f.getName() + ' ' + f.getMimeType())) lista.push(f);
  }
  var url = 'https://drive.google.com/drive/folders/' + carpeta.getId();
  if (!lista.length) {
    ui.alert('📂 La carpeta está vacía', 'Copie su Excel (.xlsx o .csv), foto o PDF a esta carpeta de Drive y vuelva a usar este menú:\n\n' +
      carpeta.getName() + '\n' + url + '\n\n(Está en la misma carpeta que esta hoja. Lo que deje ahí se borra solo a los ' + IMP_DIAS_ + ' días.)', ui.ButtonSet.OK);
    return;
  }
  lista.sort(function (a, b) { return b.getLastUpdated().getTime() - a.getLastUpdated().getTime(); });
  var txt = lista.slice(0, 20).map(function (f, i) { return (i + 1) + ') ' + f.getName(); }).join('\n');
  var r1 = ui.prompt('📂 Importar desde la carpeta', 'Archivos en la carpeta temporal:\n\n' + txt +
    '\n\nEscriba los números a importar (ej. 1 o 1,3) o deje vacío para el 1:', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var nums = (String(r1.getResponseText()).match(/\d+/g) || ['1']).map(Number).filter(function (n) { return n >= 1 && n <= Math.min(lista.length, 20); });
  if (!nums.length) { ui.alert('Número no válido.'); return; }
  var emps = cfg.grupo.map(function (r, i) { return (i + 1) + ') ' + (cfg.nombreEmpresa[r] || r) + ' · ' + r; }).join('\n');
  var r2 = ui.prompt('🏢 Empresa del grupo', 'Qué empresa pagó o cobró:\n\n' + emps + '\n\nEscriba el número (vacío = según la columna Empresa del archivo):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var k = parseInt(r2.getResponseText(), 10);
  var empresaRuc = k >= 1 && k <= cfg.grupo.length ? cfg.grupo[k - 1] : '';
  var archivos = [], avisos = [];
  nums.forEach(function (n) {
    var f = lista[n - 1], blob = f.getBlob(), nombre = f.getName(), mime = f.getMimeType();
    try {
      if (mime === MimeType.GOOGLE_SHEETS) {
        var sss = SpreadsheetApp.openById(f.getId());
        var hs = sss.getSheets().filter(function (h) { return /pago/i.test(h.getName()); })[0] || sss.getSheets()[0];
        archivos.push({ nombre: nombre, hoja: hs.getName(), filas: hs.getDataRange().getValues() });
      } else if (/\.xlsx$/i.test(nombre) || /openxmlformats-officedocument\.spreadsheetml/.test(mime)) {
        var x = IMP_xlsxFilas_(blob);
        archivos.push({ nombre: nombre, hoja: x.hoja, filas: x.filas });
      } else if (/\.csv$/i.test(nombre) || /csv/.test(mime)) {
        archivos.push({ nombre: nombre, filas: Utilities.parseCsv(blob.getDataAsString()) });
      } else {
        archivos.push({ nombre: nombre, mime: mime, base64: Utilities.base64Encode(blob.getBytes()) });
      }
    } catch (e) { avisos.push(nombre + ': ' + e.message); }
  });
  ss.toast('Leyendo ' + archivos.length + ' archivo(s) y buscando en Originales y Fotos…', '📥 Importar', 60);
  var msg;
  try { msg = IMP_procesar_(ss, archivos, empresaRuc, false); } catch (e) { msg = '❌ ' + e.message; }
  if (avisos.length) msg += '\n\n⚠️ ' + avisos.join('\n⚠️ ');
  IMP_estado_(IMP_hoja_(ss), msg.split('\n')[0]);
  ui.alert('📥 Importar', msg, ui.ButtonSet.OK);
}

/**
 * Lee un .xlsx sin servicios extra (es un zip de XML): la pestaña que diga
 * "PAGO" o la primera. Devuelve {hoja, filas}.
 */
function IMP_xlsxFilas_(blob) {
  blob.setContentType('application/zip');
  var partes = {};
  Utilities.unzip(blob).forEach(function (b) { partes[b.getName()] = b; });
  var leer = function (n) { return partes[n] ? XmlService.parse(partes[n].getDataAsString('UTF-8')).getRootElement() : null; };
  var hijos = function (el, nombre) { return el.getChildren().filter(function (c) { return c.getName() === nombre; }); };
  var texto = function (el) {  // texto de <si>/<is>: <t> directo o varios <r><t>
    var t = hijos(el, 't');
    if (t.length) return t[0].getText();
    return hijos(el, 'r').map(function (r) { var tt = hijos(r, 't'); return tt.length ? tt[0].getText() : ''; }).join('');
  };
  var comunes = [];
  var sst = leer('xl/sharedStrings.xml');
  if (sst) comunes = hijos(sst, 'si').map(texto);
  // Pestañas y su archivo
  var wb = leer('xl/workbook.xml'), rels = leer('xl/_rels/workbook.xml.rels');
  var destino = {};
  hijos(rels, 'Relationship').forEach(function (r) { destino[r.getAttribute('Id').getValue()] = r.getAttribute('Target').getValue(); });
  var hojas = [];
  hijos(wb, 'sheets').forEach(function (ss) {
    hijos(ss, 'sheet').forEach(function (h) {
      var rid = h.getAttributes().filter(function (a) { return a.getName() === 'id'; })[0];
      var t = rid ? destino[rid.getValue()] : '';
      if (t) hojas.push({ nombre: h.getAttribute('name').getValue(), ruta: 'xl/' + t.replace(/^\/?xl\//, '').replace(/^\//, '') });
    });
  });
  if (!hojas.length) throw new Error('El Excel no tiene pestañas legibles.');
  var hoja = hojas.filter(function (h) { return /pago/i.test(h.nombre); })[0] || hojas[0];
  var raiz = leer(hoja.ruta);
  if (!raiz) throw new Error('No se pudo leer la pestaña ' + hoja.nombre + '.');
  var col = function (ref) { var m = ref.match(/^([A-Z]+)/), n = 0; for (var i = 0; i < m[1].length; i++) n = n * 26 + m[1].charCodeAt(i) - 64; return n - 1; };
  var filas = [];
  hijos(raiz, 'sheetData').forEach(function (sd) {
    hijos(sd, 'row').forEach(function (row) {
      var r = parseInt(row.getAttribute('r').getValue(), 10) - 1;
      var fila = filas[r] = [];
      hijos(row, 'c').forEach(function (c) {
        var ref = c.getAttribute('r'), j = ref ? col(ref.getValue()) : fila.length;
        var tipo = c.getAttribute('t') ? c.getAttribute('t').getValue() : 'n';
        var v = hijos(c, 'v'), val = v.length ? v[0].getText() : '';
        if (tipo === 's') val = comunes[parseInt(val, 10)] || '';
        else if (tipo === 'inlineStr') { var is = hijos(c, 'is'); val = is.length ? texto(is[0]) : ''; }
        else if (tipo === 'n' && val !== '') val = Number(val);
        else if (tipo === 'b') val = val === '1';
        while (fila.length < j) fila.push('');
        fila[j] = val;
      });
    });
  });
  for (var i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = [];
  return { hoja: hoja.nombre, filas: filas };
}

/* ------------------------------------------------------------ hoja */

function IMP_hoja_(ss) {
  var sh = ss.getSheetByName(IMP_HOJA_);
  if (sh && sh.getRange('A1').getValue()) return sh;
  sh = sh || ss.insertSheet(IMP_HOJA_);
  sh.getRange('A1:L1').merge().setValue('📥  IMPORTAR MI ANÁLISIS · completar datos que faltan en Vouchers').setFontSize(15)
    .setFontWeight('bold').setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
  sh.setRowHeight(1, 38);
  sh.getRange('A3:A5').setValues([['Cómo usarlo'], ['Última importación'], ['Estado']]).setFontWeight('bold');
  sh.getRange('B3:L3').merge().setValue(
    '1) Menú 🤝 Conciliar con IA → 📥 Subir Excel, foto o PDF (elija la empresa: GRANIX, BKF…).  ' +
    '2) Revise abajo: ✅ se encontró el voucher, 🟠 hay duda (elija en "Voucher elegido ✏️", ej. Originales!120), ❌ no está en Vouchers.  ' +
    '3) Marque ✔ y use ✅ Completar vouchers marcados: SOLO llena celdas vacías (ID Beneficiario, Tipo y Nº Doc., Empresa, ID Usuario). ' +
    'Se puede deshacer. Los archivos subidos se borran solos a los ' + IMP_DIAS_ + ' días.')
    .setWrap(true).setFontSize(9).setFontColor(COLOR.TEXTO_SUAVE).setBackground('#F8FAFC').setVerticalAlignment('top');
  sh.setRowHeight(3, 62);
  sh.getRange('B4:L4').merge().setWrap(true).setFontSize(9);
  sh.getRange('B5:L5').merge().setWrap(true).setFontSize(9);
  sh.getRange(IMP_F_ENC_, 1, 1, IMP_ENC_.length).setValues([IMP_ENC_]).setFontWeight('bold')
    .setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(IMP_F_ENC_);
  [80, 150, 90, 85, 95, 180, 100, 150, 80, 150, 90, 180, 220, 200, 260, 130, 160, 200].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

function IMP_estado_(sh, t) { sh.getRange('B5').setValue(t); }

function IMP_escribir_(sh, tabla) {
  var n0 = sh.getLastRow() - IMP_F_ENC_;
  if (sh.getFilter()) sh.getFilter().remove();
  if (n0 > 0) {
    var r0 = sh.getRange(IMP_F_ENC_ + 1, 1, n0, IMP_ENC_.length);
    r0.clearContent(); r0.clearDataValidations(); r0.setBackground(null);
  }
  if (!tabla.length) return;
  var n = tabla.length, f0 = IMP_F_ENC_ + 1;
  sh.getRange(f0, 1, n, IMP_ENC_.length).setValues(tabla).setFontSize(9).setVerticalAlignment('middle').setWrap(true);
  sh.getRange(IMP_F_ENC_, 1, n + 1, IMP_ENC_.length).createFilter();
  sh.getRange(f0, 1, n, 1).insertCheckboxes();
  tabla.forEach(function (f, i) { if (f[0] === true) sh.getRange(f0 + i, 1).setValue(true); });
  sh.getRange(f0, IMP_C_['Fecha (archivo)'] + 1, n, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(f0, IMP_C_['Monto (archivo)'] + 1, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(f0, IMP_C_['Monto voucher'] + 1, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(f0, IMP_C_['RUC beneficiario ✏️'] + 1, n, 1).setNumberFormat('@');
  ['RUC beneficiario ✏️', 'Factura(s) ✏️', 'Empresa ✏️', 'Voucher elegido ✏️'].forEach(function (c) {
    sh.getRange(f0, IMP_C_[c] + 1, n, 1).setBackground('#FFF8E1');
  });
  IMP_pintar_(sh, tabla.map(function (f) { return f[IMP_C_['Estado']]; }), f0);
}

function IMP_pintar_(sh, estados, f0) {
  var fondos = estados.map(function (e) {
    e = String(e);
    return [e.indexOf('✅') === 0 ? '#DCFCE7' : e.indexOf('🟠') === 0 ? '#FFEDD5' : e.indexOf('❌') === 0 ? '#FEE2E2' :
      e.indexOf('✔') === 0 ? '#F1F5F9' : e.indexOf('ℹ️') === 0 ? '#EFF6FF' : null];
  });
  if (fondos.length) sh.getRange(f0, IMP_C_['Estado'] + 1, fondos.length, 1).setBackgrounds(fondos);
}

/* --------------------------------------------- leer Excel / CSV */

/** Fecha de una celda: texto, Date o número de serie de Excel (ej. 46091). */
function IMP_fecha_(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  return aFecha_(v);
}

/** Normaliza un N° de operación: "OP-000663" → "663". */
function IMP_opNorm_(s) {
  var d = String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, '');
  return d;
}
/** Uno o varios N° en una celda: "OP-663 / 664" → ["663","664"]. */
function IMP_ops_(s) {
  var m = String(s == null ? '' : s).match(/\d+/g) || [];
  return m.map(function (x) { return x.replace(/^0+/, ''); }).filter(function (x) { return x; });
}

/** "20610668241-1-E001-502" → {ruc, tipo:'01', serie:'E001', numero:502, codigo:'01_E001-502'} */
function IMP_codSunat_(s) {
  var m = String(s == null ? '' : s).toUpperCase().match(/(\d{11})\s*[-_ ]\s*(\d{1,2})\s*[-_ ]\s*([A-Z0-9]{4})\s*[-_ ]\s*0*(\d+)/);
  if (!m) return null;
  var tipo = normTipo_(m[2]);
  return { ruc: m[1], tipo: tipo, serie: m[3], numero: parseInt(m[4], 10), codigo: tipo + '_' + m[3] + '-' + parseInt(m[4], 10) };
}

function IMP_modalidad_(s) {
  var t = normHeader_(s);
  if (/reten/.test(t)) return 'RETENCION';
  if (/detrac/.test(t)) return 'DETRACCION';
  if (/(^|\s)(n ?c|nota de credito|nota credito)(\s|$)|credito/.test(t)) return 'NC';
  return 'PAGO';
}

var IMP_COLS_ = {
  cod: /^cod(igo)? ?sunat|^cod sunat|^codigo sunat/,
  op: /^(n|nro|num|numero|no)? ?op(e|er|eracion)?( |$)|operacion|^n op|^op$/,
  fecha: /^fecha/,
  monto: /^(monto|importe|pagado|pago|abono)/,
  modalidad: /^(modalidad|concepto|tipo de pago|tipo de mov|movimiento)/,
  razon: /^(razon social|razon|proveedor|beneficiario|cliente|nombre)/,
  ruc: /^ruc/,
  doc: /^(factura|documento|comprobante|serie|n doc|tipo y n)/,
  banco: /^banco/,
  moneda: /^moneda/,
  empresa: /^empresa/,
};

function IMP_mapear_(enc) {
  var m = {};
  enc.forEach(function (h, i) {
    var t = normHeader_(h);
    if (!t) return;
    Object.keys(IMP_COLS_).forEach(function (k) {
      if (m[k] == null && IMP_COLS_[k].test(t)) {
        if (k === 'doc' && IMP_COLS_.cod.test(t)) return;
        if (k === 'monto' && /fecha/.test(t)) return;
        m[k] = i;
      }
    });
  });
  return m;
}

/** Filas de una tabla (Excel/CSV ya leído) → filas normalizadas. */
function IMP_leerTabla_(filas, origen, sh) {
  var mejor = { i: -1, m: {}, n: 0 };
  for (var i = 0; i < Math.min(filas.length, 25); i++) {
    var m = IMP_mapear_(filas[i] || []);
    var n = Object.keys(m).length + (m.op != null ? 2 : 0) + (m.cod != null ? 2 : 0);
    if (n > mejor.n && (m.op != null || m.cod != null || m.monto != null)) mejor = { i: i, m: m, n: n };
  }
  if (mejor.i < 0 || (mejor.m.op == null && mejor.m.cod == null) || mejor.m.monto == null) {
    var ia = CIA_ia_(CIA_hoja_(SpreadsheetApp.getActiveSpreadsheet()));
    if (!ia.clave) throw new Error('No se reconocieron las columnas (N° OP, Monto, COD_SUNAT) y no hay clave de IA para que las identifique.');
    if (sh) IMP_estado_(sh, 'La IA está identificando las columnas de ' + origen + '…');
    mejor = IMP_mapearConIA_(ia, filas);
  }
  var c = mejor.m, res = [];
  for (var j = mejor.i + 1; j < filas.length; j++) {
    var r = filas[j] || [];
    var val = function (k) { return c[k] == null ? '' : r[c[k]]; };
    var monto = aNumero_(val('monto'));
    var cod = IMP_codSunat_(val('cod'));
    var opTxt = String(val('op') == null ? '' : val('op')).trim();
    if (!monto && !opTxt && !cod) continue;
    var docs = [];
    if (cod) docs.push(cod.codigo);
    else if (c.doc != null) parsearReferencias_(String(val('doc') || '')).refs.forEach(function (x) { docs.push(x.tipo + '_' + x.serie + '-' + x.numero); });
    res.push({
      origen: origen + ' · fila ' + (j + 1), modalidad: IMP_modalidad_(val('modalidad')),
      fecha: IMP_fecha_(val('fecha')), opTxt: opTxt, ops: IMP_ops_(opTxt), monto: Math.abs(monto),
      ruc: cod ? cod.ruc : aRuc_(val('ruc')), razon: String(val('razon') || '').trim(), docs: docs, cod: cod,
      banco: String(val('banco') || '').trim(), moneda: String(val('moneda') || '').trim(), empresa: String(val('empresa') || '').trim(),
    });
  }
  return res;
}

var IMP_SISTEMA_MAPA_ = 'Eres contador en Perú. Te doy las primeras filas de una hoja de cálculo de pagos a proveedores. ' +
  'Indica cuál fila es el encabezado y el índice (desde 0) de cada columna. Responde SOLO JSON: ' +
  '{"fila_encabezado":0,"columnas":{"op":null,"fecha":null,"monto":null,"cod":null,"ruc":null,"razon":null,"doc":null,"modalidad":null,"banco":null,"moneda":null}} ' +
  'op = N° de operación bancaria; cod = código tipo RUC-tipo-serie-número; doc = factura (serie-número); modalidad = pago/retención/nota de crédito. null si no existe.';

function IMP_mapearConIA_(ia, filas) {
  var txt = filas.slice(0, 12).map(function (r, i) { return 'Fila ' + i + ': ' + (r || []).map(function (x, j) { return j + '=' + String(x).slice(0, 30); }).join(' | '); }).join('\n');
  var r = IA_llamar_({ proveedor: ia.proveedor, clave: ia.clave, maxTokens: 600, sistema: IMP_SISTEMA_MAPA_, texto: txt });
  var m = {};
  Object.keys(r.columnas || {}).forEach(function (k) { if (r.columnas[k] != null && r.columnas[k] !== '') m[k] = Number(r.columnas[k]); });
  if (m.monto == null || (m.op == null && m.cod == null)) throw new Error('Ni la IA encontró las columnas de N° de operación y monto.');
  return { i: Number(r.fila_encabezado) || 0, m: m };
}

/* ------------------------------------------- leer foto / PDF con IA */

var IMP_SISTEMA_DOC_ = [
  'Eres contador en Perú. Lees fotos o PDF de vouchers/constancias de pago bancarias, facturas, o reportes de pagos.',
  'Extrae CADA pago o documento que veas. Responde SOLO JSON:',
  '{"filas":[{"tipo":"PAGO|RETENCION|NC|FACTURA","fecha":"dd/mm/aaaa","operacion":"","banco":"","moneda":"PEN|USD","monto":0,',
  '"ruc":"RUC de 11 dígitos del beneficiario o emisor de la factura","razon_social":"","documentos":["01_E001-502"]}]}',
  'PAGO = voucher/transferencia/depósito (operacion = N° de operación tal cual, sin inventar). FACTURA = factura sin pago.',
  'documentos: código tipo_serie-número (01 factura, 03 boleta, 07 nota de crédito). Si un dato no se ve, déjalo vacío. No inventes.',
].join('\n');

function IMP_leerConIA_(sh, a) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ia = CIA_ia_(CIA_hoja_(ss));
  if (!ia.clave) throw new Error('Para leer fotos o PDF falta la clave de IA (🤝 Conciliar con IA → 🔑 Guardar clave de IA).');
  if (/pdf/i.test(a.mime) && ia.proveedor.indexOf('Gemini') < 0) throw new Error('Los PDF solo los lee Gemini; elija Gemini en la fila 11 de 🤝 Conciliar con IA o suba una foto.');
  IMP_estado_(sh, 'La IA está leyendo ' + a.nombre + '…');
  var r = IA_llamar_({ proveedor: ia.proveedor, clave: ia.clave, maxTokens: 8000, sistema: IMP_SISTEMA_DOC_,
    texto: 'Extrae los pagos y documentos de este archivo: ' + a.nombre, adjunto: { mime: a.mime, base64: a.base64 } });
  return (r.filas || []).map(function (f, i) {
    var docs = [];
    (f.documentos || []).forEach(function (d) {
      parsearReferencias_(String(d)).refs.forEach(function (x) { docs.push(x.tipo + '_' + x.serie + '-' + x.numero); });
    });
    var tipo = String(f.tipo || 'PAGO').toUpperCase();
    return {
      origen: a.nombre + ' · IA ' + (i + 1), modalidad: /RETEN/.test(tipo) ? 'RETENCION' : /NC|CREDITO/.test(tipo) ? 'NC' : /FACT/.test(tipo) ? 'FACTURA' : 'PAGO',
      fecha: aFecha_(f.fecha), opTxt: String(f.operacion || ''), ops: IMP_ops_(f.operacion), monto: Math.abs(aNumero_(f.monto)),
      ruc: aRuc_(f.ruc), razon: String(f.razon_social || ''), docs: docs, cod: null,
      banco: String(f.banco || ''), moneda: String(f.moneda || ''), empresa: '',
    };
  }).filter(function (f) { return f.monto || f.ops.length; });
}

/* ------------------------------------------------ vouchers */

function IMP_pestanas_(cfg) {
  var t = cfg.pestanasVouchers.slice();
  ['Originales', 'Fotos'].forEach(function (n) { if (t.indexOf(n) < 0) t.push(n); });
  return t;
}

/** Lee Originales y Fotos (solo las columnas que se usan; nunca las de imágenes). */
function IMP_leerVouchers_(ssV, cfg) {
  var res = { lista: [], porOp: {}, porMonto: {}, cols: {} };
  IMP_pestanas_(cfg).forEach(function (nombre) {
    var sh = ssV.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var col = indiceColumnas_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    var c = {
      fecha: col('Fecha de depos', 'Fecha de deposito'), op: col('Numero de oper', 'Numero de operacion'), banco: col('Banco'),
      monto: col('Monto'), benef: col('Proveedor (Beneficiario)'), idUsuario: col('ID Usuario'), empresa: col('Empresa'),
      idBenef: col('ID Beneficiario'), refs: col('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc'),
    };
    res.cols[nombre] = c;
    var n = sh.getLastRow() - 1, datos = {};
    Object.keys(c).forEach(function (k) { if (c[k] >= 0) datos[k] = sh.getRange(2, c[k] + 1, n, 1).getValues(); });
    var v = function (k, i) { return datos[k] ? datos[k][i][0] : ''; };
    for (var i = 0; i < n; i++) {
      var monto = aNumero_(v('monto', i));
      if (!monto) continue;
      var x = {
        tab: nombre, fila: i + 2, fecha: aFecha_(v('fecha', i)), op: String(v('op', i)).trim(), opN: IMP_opNorm_(v('op', i)),
        banco: String(v('banco', i) || ''), monto: monto, benef: String(v('benef', i) || ''),
        idUsuario: String(v('idUsuario', i) || '').trim(), empresa: String(v('empresa', i) || '').trim(),
        idBenef: String(v('idBenef', i) || '').trim(), refs: String(v('refs', i) || '').trim(),
      };
      res.lista.push(x);
      if (x.opN) (res.porOp[x.opN] = res.porOp[x.opN] || []).push(x);
      (res.porMonto[Math.round(monto)] = res.porMonto[Math.round(monto)] || []).push(x);
    }
  });
  return res;
}

/** Texto que usan los vouchers en "Empresa" para ese RUC (el más usado); si no, el de ⚙️ Config. */
function IMP_textoEmpresa_(cfg, vs, ruc) {
  var cuenta = {};
  vs.lista.forEach(function (x) {
    if (x.empresa && cfg.aliasEmpresa[normHeader_(x.empresa)] === ruc) cuenta[x.empresa] = (cuenta[x.empresa] || 0) + 1;
  });
  var mejor = Object.keys(cuenta).sort(function (a, b) { return cuenta[b] - cuenta[a]; })[0];
  return mejor || cfg.nombreEmpresa[ruc] || '';
}

function IMP_desc_(x) {
  return x.tab + '!' + x.fila + ' (' + (x.fecha ? Utilities.formatDate(x.fecha, 'America/Lima', 'dd/MM/yyyy') : 's/f') +
    ' · OP ' + (x.op || '—') + ' · ' + x.monto.toFixed(2) + ' · ' + (x.benef || '').slice(0, 30) + ')';
}

/* ------------------------------------------------ cruce */

function IMP_cruzar_(ss, cfg, filas, empresaRuc) {
  var cuenta = {}; Object.keys(IMP_EST_).forEach(function (k) { cuenta[IMP_EST_[k]] = 0; });
  if (!filas.length) return { tabla: [], cuenta: cuenta };
  if (!cfg.idVouchers) throw new Error('Falta el ID de la hoja de Vouchers en ⚙️ Config.');
  var vs = IMP_leerVouchers_(SpreadsheetApp.openById(cfg.idVouchers), cfg);
  var tol = Math.max(0.05, cfg.tolerancia || 0);
  var movs = CIA_leerMovs_(ss);
  var tabla = [];
  var empTexto = {};
  function empresaDe(f) {
    var ruc = empresaRuc || (f.empresa ? cfg.aliasEmpresa[normHeader_(f.empresa)] || '' : '');
    if (!ruc) return { ruc: '', texto: '' };
    if (empTexto[ruc] == null) empTexto[ruc] = IMP_textoEmpresa_(cfg, vs, ruc);
    return { ruc: ruc, texto: empTexto[ruc] };
  }
  function cerca(a, b, dias) { return !a || !b || Math.abs(a.getTime() - b.getTime()) <= dias * 86400000; }

  // 1) Retenciones y N/C: solo informativo
  filas.filter(function (f) { return f.modalidad === 'RETENCION' || f.modalidad === 'NC' || f.modalidad === 'DETRACCION'; }).forEach(function (f) {
    var nota = '';
    if (f.cod) {
      var k = claveDoc_(f.cod.ruc, f.cod.tipo, f.cod.serie, f.cod.numero);
      var m = movs.porDoc[k] || [];
      var ret = m.filter(function (t) { return /reten/i.test(t); });
      if (f.modalidad === 'RETENCION') nota = ret.length ? 'Cobranzas ya tiene la retención: ' + ret.join('; ') : 'Cobranzas NO tiene retención para esa factura (revise 🔁 Reasignar retenciones o ✍️ Registro manual).';
      else nota = m.length ? 'Movimientos de esa factura en Cobranzas: ' + m.join('; ') : 'Sin movimientos en Cobranzas para ese documento.';
    } else nota = 'Sin COD_SUNAT: no se pudo comparar.';
    var e = empresaDe(f);
    tabla.push([false, IMP_EST_.INFO + ' · ' + (f.modalidad === 'RETENCION' ? 'Retención' : f.modalidad === 'NC' ? 'N/C' : 'Detracción'),
      f.opTxt, f.fecha || '', f.monto, f.razon, f.ruc, f.docs.join(','), e.texto, '', '', '', 'No se escribe en Vouchers', '', nota, '', f.origen, '']);
    cuenta[IMP_EST_.INFO]++;
  });

  // 2) Pagos: agrupar por N° OP + fecha (una OP puede pagar varias facturas)
  var grupos = [], porClave = {};
  filas.filter(function (f) { return f.modalidad === 'PAGO' || f.modalidad === 'FACTURA'; }).forEach(function (f) {
    var clave = f.ops.length ? f.ops.join('+') + '|' + fmtFechaClave_(f.fecha) : 'sin-op|' + tabla.length + '|' + grupos.length;
    var g = porClave[clave];
    if (!g) {
      g = porClave[clave] = { ops: f.ops, opTxt: f.opTxt, fecha: f.fecha, monto: 0, rucs: {}, razon: '', docs: [], origen: [], filas: [], factura: f.modalidad === 'FACTURA' };
      grupos.push(g);
    }
    g.monto += f.monto; g.filas.push(f);
    if (f.ruc) g.rucs[f.ruc] = true;
    if (!g.razon && f.razon) g.razon = f.razon;
    f.docs.forEach(function (d) { if (g.docs.indexOf(d) < 0) g.docs.push(d); });
    g.origen.push(f.origen.replace(/^.* · /, ''));
    if (!g.origen0) g.origen0 = f.origen.replace(/ · [^·]*$/, '');
    if (!g.empresa) g.empresa = f.empresa;
  });

  grupos.forEach(function (g) {
    g.monto = Math.round(g.monto * 100) / 100;
    var rucs = Object.keys(g.rucs);
    var e = empresaDe({ empresa: g.empresa });
    var dudas = [], estado, objetivos = [];
    if (rucs.length > 1) dudas.push('El archivo trae varios RUC para esta OP: ' + rucs.join(', '));
    var montoOk = function (x) { return Math.abs(x.monto - g.monto) <= tol; };
    var mismo = function (x) { return x.opN + '|' + x.monto.toFixed(2) + '|' + fmtFechaClave_(x.fecha); };
    var distintos = function (lista) { var s = {}; lista.forEach(function (x) { s[mismo(x)] = true; }); return Object.keys(s).length; };

    if (g.ops.length === 1) {
      var cands = vs.porOp[g.ops[0]] || [];
      var ok = cands.filter(function (x) { return montoOk(x) && cerca(x.fecha, g.fecha, 5); });
      if (ok.length && distintos(ok) === 1) objetivos = ok;
      else if (ok.length) { estado = IMP_EST_.DUDA; dudas.push('Hay varios vouchers con ese N° y monto: ' + ok.map(IMP_desc_).join(' | ')); }
      else if (cands.length) {
        estado = IMP_EST_.DUDA;
        var fOk = cands.filter(function (x) { return cerca(x.fecha, g.fecha, 5); });
        dudas.push((fOk.length ? 'Mismo N° de operación pero otro monto: ' : 'Mismo N° de operación pero otra fecha/monto: ') + (fOk.length ? fOk : cands).slice(0, 6).map(IMP_desc_).join(' | '));
      }
    } else if (g.ops.length > 1) {
      var porOp = g.ops.map(function (op) { return (vs.porOp[op] || []).filter(function (x) { return cerca(x.fecha, g.fecha, 5); }); });
      var suma = 0, unico = porOp.every(function (l) { return l.length && distintos(l) === 1; });
      porOp.forEach(function (l) { if (l.length) suma += l[0].monto; });
      if (unico && Math.abs(suma - g.monto) <= tol) porOp.forEach(function (l) { objetivos = objetivos.concat(l); });
      else if (porOp.some(function (l) { return l.length; })) {
        estado = IMP_EST_.DUDA;
        dudas.push('Varias OP en una celda; vouchers posibles: ' + [].concat.apply([], porOp).slice(0, 6).map(IMP_desc_).join(' | '));
      }
    }
    if (!objetivos.length && !estado) {
      // Sin N° o no encontrado por N°: buscar por monto y fecha (y nombre) como sugerencia
      var montos = g.factura ? [g.monto, Math.round(g.monto * 0.97 * 100) / 100] : [g.monto];
      var pos = [];
      montos.forEach(function (m) {
        [Math.round(m) - 1, Math.round(m), Math.round(m) + 1].forEach(function (k) {
          (vs.porMonto[k] || []).forEach(function (x) {
            if (Math.abs(x.monto - m) <= tol && cerca(x.fecha, g.fecha, g.factura ? 90 : 3) && pos.indexOf(x) < 0) pos.push(x);
          });
        });
      });
      if (g.razon) {
        var parecidos = pos.filter(function (x) { return CIA_parecido_(x.benef, g.razon) >= 0.5; });
        if (parecidos.length) pos = parecidos;
      }
      if (g.ops.length) {
        var fin = pos.filter(function (x) { return x.opN && g.ops.some(function (op) { return op.length >= 3 && (x.opN.slice(-op.length) === op || op.slice(-x.opN.length) === x.opN); }); });
        if (fin.length) pos = fin;
      }
      if (pos.length) {
        estado = IMP_EST_.DUDA;
        dudas.push((g.ops.length ? 'No hay voucher con N° ' + g.ops.join('/') + '; ' : '') + 'posibles por monto' + (g.razon ? ', fecha y nombre' : ' y fecha') + ': ' +
          pos.slice(0, 6).map(IMP_desc_).join(' | ') + (pos.length > 6 ? ' (+' + (pos.length - 6) + ')' : ''));
      } else {
        estado = IMP_EST_.NO;
        dudas.push(g.ops.length ? 'No hay ningún voucher con N° ' + g.ops.join('/') + ' en ' + IMP_pestanas_(cfg).join(' ni en ') + ', ni otro con ese monto y fecha.' : 'Sin N° de operación y sin voucher con ese monto y fecha.');
      }
    }

    var ruc = rucs.length === 1 ? rucs[0] : '';
    var plan = objetivos.length ? IMP_plan_(vs.cols, objetivos, { ruc: ruc, docs: g.docs.join(','), empTexto: e.texto, empRuc: e.ruc }) : { llenar: [], distinto: [], sinCol: [] };
    dudas = dudas.concat(plan.sinCol);
    if (objetivos.length) {
      estado = plan.llenar.length ? IMP_EST_.OK : IMP_EST_.LLENO;
      var nb = objetivos[0].benef;
      if (g.razon && nb && CIA_parecido_(nb, g.razon) < 0.45) dudas.push('Ojo: el beneficiario del voucher ("' + nb + '") no se parece a "' + g.razon + '".');
      if (rucs.length > 1) estado = IMP_EST_.DUDA;
    }
    cuenta[estado]++;
    tabla.push([estado === IMP_EST_.OK, estado, g.opTxt, g.fecha || '', g.monto, g.razon, ruc, g.docs.join(','), e.texto,
      objetivos.map(function (x) { return x.tab + '!' + x.fila; }).join(', '), objetivos.length ? objetivos[0].monto : '',
      objetivos.length ? objetivos[0].benef : '', plan.llenar.join(' · '), plan.distinto.join(' · '), dudas.join('\n'), '',
      g.origen0 + ' · ' + g.origen.join(', '), '']);
  });
  // Orden: primero lo que necesita su atención
  var orden = function (e) { e = String(e); return e.indexOf('🟠') === 0 ? 0 : e.indexOf('❌') === 0 ? 1 : e.indexOf('✅') === 0 ? 2 : e.indexOf('ℹ️') === 0 ? 3 : 4; };
  tabla.sort(function (a, b) { return orden(a[1]) - orden(b[1]); });
  return { tabla: tabla, cuenta: cuenta };
}

/** Qué se escribiría en cada voucher (solo celdas vacías) y qué ya tenía otro dato. */
function IMP_plan_(cols, objetivos, d) {
  var llenar = {}, distinto = {}, sinCol = {};
  objetivos.forEach(function (x) {
    var c = cols[x.tab];
    var revisar = function (campo, nombre, actual, nuevo, igual) {
      if (!nuevo) return;
      if (c[campo] < 0) { sinCol[x.tab + ' no tiene la columna ' + nombre + ' (se llena solo en las otras pestañas)'] = true; return; }
      if (!actual) llenar[nombre + ': ' + nuevo] = true;
      else if (!igual(actual, nuevo)) distinto[x.tab + '!' + x.fila + ' ' + nombre + ' tenía "' + actual + '"'] = true;
    };
    revisar('idBenef', 'ID Beneficiario', x.idBenef, d.ruc, function (a, b) { return aRuc_(a) === b; });
    revisar('refs', 'Tipo y Nº Doc.', x.refs, d.docs, IMP_mismosDocs_);
    revisar('empresa', 'Empresa', x.empresa, d.empTexto, function (a, b) { return normHeader_(a) === normHeader_(b); });
    revisar('idUsuario', 'ID Usuario', x.idUsuario, d.empRuc, function (a, b) { return aRuc_(a) === b; });
  });
  return { llenar: Object.keys(llenar), distinto: Object.keys(distinto), sinCol: Object.keys(sinCol) };
}

function IMP_mismosDocs_(a, b) {
  var k = function (s) { return parsearReferencias_(s).refs.map(function (r) { return r.tipo + '_' + r.serie + '-' + r.numero; }).sort().join(','); };
  return k(a) === k(b);
}

/* ------------------------------------------------ completar */

function IMP_menuAplicar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = IMP_hoja_(ss);
  var msg;
  try { msg = IMP_aplicar_(ss, sh); } catch (e) { msg = '❌ ' + e.message; }
  IMP_estado_(sh, msg);
  ss.toast(msg, '📥 Importar', 12);
}

function IMP_leerFilas_(sh) {
  var n = sh.getLastRow() - IMP_F_ENC_;
  if (n < 1) return [];
  return sh.getRange(IMP_F_ENC_ + 1, 1, n, IMP_ENC_.length).getValues().map(function (v, i) { return { fila: IMP_F_ENC_ + 1 + i, v: v }; });
}

/** "Originales!12, Fotos!5" o "12" (= Originales). */
function IMP_destinos_(txt) {
  return String(txt || '').split(/[,;\s]+/).map(function (p) {
    var m = p.match(/^(.+)!(\d+)$/);
    if (m) return { tab: m[1].trim(), fila: parseInt(m[2], 10) };
    if (/^\d+$/.test(p)) return { tab: 'Originales', fila: parseInt(p, 10) };
    return null;
  }).filter(Boolean);
}

function IMP_aplicar_(ss, sh) {
  var cfg = leerConfig_(ss);
  var filas = IMP_leerFilas_(sh).filter(function (t) { return t.v[0] === true; });
  if (!filas.length) return 'No hay filas marcadas con ✔.';
  var ssV = SpreadsheetApp.openById(cfg.idVouchers);
  var vs = IMP_leerVouchers_(ssV, cfg);
  var porPos = {};
  vs.lista.forEach(function (x) { porPos[x.tab + '!' + x.fila] = x; });
  var lote = 'L' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd-HHmmss');
  var log = [], hechos = 0, celdas = 0, avisos = 0;
  filas.forEach(function (t) {
    var v = t.v, celda = sh.getRange(t.fila, IMP_C_['Resultado'] + 1);
    var elegido = String(v[IMP_C_['Voucher elegido ✏️']] || '').trim();
    var dest = IMP_destinos_(elegido || v[IMP_C_['Voucher(s) encontrado(s)']]);
    if (String(v[IMP_C_['Estado']]).indexOf('ℹ️') === 0) { celda.setValue('ℹ️ Informativo: no se escribe'); return; }
    if (!dest.length) { celda.setValue('⚠️ Escriba en "Voucher elegido ✏️" la fila, ej. Originales!120'); avisos++; return; }
    var ruc = aRuc_(v[IMP_C_['RUC beneficiario ✏️']]);
    var docs = String(v[IMP_C_['Factura(s) ✏️']] || '').trim();
    var empTxt = String(v[IMP_C_['Empresa ✏️']] || '').trim();
    var empRuc = empTxt ? cfg.aliasEmpresa[normHeader_(empTxt)] || '' : '';
    Object.keys(cfg.nombreEmpresa).forEach(function (r) { if (cfg.nombreEmpresa[r] === empTxt) empRuc = r; });
    var ops = IMP_ops_(v[IMP_C_['N° OP (archivo)']]);
    var escritos = [], problemas = [];
    dest.forEach(function (d) {
      var x = porPos[d.tab + '!' + d.fila];
      if (!x) { problemas.push(d.tab + '!' + d.fila + ' no es un voucher'); return; }
      // Si la fila se movió (otra OP), no escribir: verificar que siga siendo el voucher propuesto
      if (!elegido && ops.length && ops.indexOf(x.opN) < 0) { problemas.push(d.tab + '!' + d.fila + ' ya no tiene la OP ' + ops.join('/') + ' (vuelva a importar)'); return; }
      var c = vs.cols[d.tab], shV = ssV.getSheetByName(d.tab);
      var poner = function (campo, nombre, actual, nuevo, texto) {
        if (!nuevo || c[campo] < 0 || String(actual).trim()) return;
        var r = shV.getRange(d.fila, c[campo] + 1);
        if (String(r.getValue()).trim()) return;  // releer: solo celdas vacías
        if (texto) r.setNumberFormat('@');
        r.setValue(nuevo);
        log.push([lote, new Date(), d.tab, d.fila, c[campo] + 1, nombre, nuevo, x.op]);
        escritos.push(nombre); celdas++;
      };
      poner('idBenef', 'ID Beneficiario', x.idBenef, ruc, true);
      poner('refs', 'Tipo y Nº Doc.', x.refs, docs, false);
      poner('empresa', 'Empresa', x.empresa, empTxt, false);
      poner('idUsuario', 'ID Usuario', x.idUsuario, empRuc, true);
    });
    var txt = escritos.length ? '✅ Completado ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ': ' +
      escritos.filter(function (e, i) { return escritos.indexOf(e) === i; }).join(', ') : '✔ Nada que completar (ya tenía datos)';
    if (problemas.length) { txt += ' · ⚠️ ' + problemas.join('; '); avisos++; }
    celda.setValue(txt);
    if (escritos.length) hechos++;
  });
  if (log.length) {
    var shL = IMP_hojaLog_(ss);
    shL.getRange(shL.getLastRow() + 1, 1, log.length, 8).setValues(log);
  }
  var r = celdas ? actualizarTodo_(true) : '';
  return hechos + ' vouchers completados (' + celdas + ' celdas, solo vacías)' + (avisos ? ' · ' + avisos + ' con aviso (ver Resultado)' : '') +
    (celdas ? ' · Se puede deshacer: 🤝 Conciliar con IA → ↩️ Deshacer última importación' : '') + (r ? ' · ' + r : '');
}

function IMP_hojaLog_(ss) {
  var sh = ss.getSheetByName(IMP_LOG_);
  if (sh) return sh;
  sh = ss.insertSheet(IMP_LOG_);
  sh.getRange(1, 1, 1, 8).setValues([['Lote', 'Fecha', 'Pestaña', 'Fila', 'Columna', 'Campo', 'Valor escrito', 'N° OP']]).setFontWeight('bold');
  sh.hideSheet();
  return sh;
}

function IMP_menuDeshacer() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var shL = ss.getSheetByName(IMP_LOG_);
  if (!shL || shL.getLastRow() < 2) { ui.alert('No hay importaciones aplicadas para deshacer.'); return; }
  var v = shL.getRange(2, 1, shL.getLastRow() - 1, 8).getValues();
  var lote = v[v.length - 1][0];
  var del = v.map(function (r, i) { return { r: r, fila: i + 2 }; }).filter(function (x) { return x.r[0] === lote; });
  var ok = ui.alert('↩️ Deshacer importación', 'Se borrarán las ' + del.length + ' celdas que se completaron en Vouchers el ' +
    Utilities.formatDate(new Date(del[0].r[1]), 'America/Lima', 'dd/MM/yyyy HH:mm') + '.\n\n' +
    'Solo se borra si la celda sigue con el mismo dato (si alguien la cambió después, se deja).', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var cfg = leerConfig_(ss);
  var ssV = SpreadsheetApp.openById(cfg.idVouchers);
  var borradas = 0, dejadas = 0;
  del.forEach(function (x) {
    var shV = ssV.getSheetByName(x.r[2]);
    if (!shV) { dejadas++; return; }
    var c = shV.getRange(x.r[3], x.r[4]);
    if (String(c.getValue()).trim() === String(x.r[6]).trim()) { c.clearContent(); borradas++; } else dejadas++;
  });
  for (var i = del.length - 1; i >= 0; i--) shL.deleteRow(del[i].fila);
  var r = borradas ? actualizarTodo_(true) : '';
  var msg = '↩️ Deshecho: ' + borradas + ' celdas borradas' + (dejadas ? ', ' + dejadas + ' se dejaron porque ya tenían otro dato' : '') + (r ? ' · ' + r : '');
  IMP_estado_(IMP_hoja_(ss), msg);
  ss.toast(msg, '📥 Importar', 12);
}

/* ------------------------------------------------ borrar / temporales */

function IMP_menuBorrar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('🧹 Borrar importación', 'Se borra la tabla de 🤝 Importar y los archivos subidos (carpeta temporal).\n\n' +
    'Lo que ya completó en Vouchers se queda (para quitarlo use ↩️ Deshacer).', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  var sh = IMP_hoja_(ss);
  IMP_escribir_(sh, []);
  sh.getRange('B4').setValue('');
  var n = IMP_limpiarTemporales_(false, 0);
  IMP_estado_(sh, 'Importación borrada ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' · ' + n + ' archivos temporales a la papelera');
}

function IMP_carpeta_(ss) {
  var padres = DriveApp.getFileById(ss.getId()).getParents();
  var base = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  var it = base.getFoldersByName(IMP_CARPETA_);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return base.createFolder(IMP_CARPETA_);
}

/**
 * Manda a la papelera los archivos subidos hace más de IMP_DIAS_ días.
 * soloSiToca: como mucho una vez al día (se llama desde la actualización automática).
 */
function IMP_limpiarTemporales_(soloSiToca, dias) {
  var props = PropertiesService.getDocumentProperties();
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd');
  if (soloSiToca && props.getProperty('imp_limpieza') === hoy) return 0;
  props.setProperty('imp_limpieza', hoy);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var padres = DriveApp.getFileById(ss.getId()).getParents();
  if (!padres.hasNext()) return 0;
  var it = padres.next().getFoldersByName(IMP_CARPETA_);
  if (!it.hasNext()) return 0;
  var limite = Date.now() - (dias == null ? IMP_DIAS_ : dias) * 86400000, n = 0;
  var fs = it.next().getFiles();
  while (fs.hasNext()) {
    var f = fs.next();
    if (f.getDateCreated().getTime() <= limite) { f.setTrashed(true); n++; }
  }
  return n;
}
