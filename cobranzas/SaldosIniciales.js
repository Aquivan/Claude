/**
 * 📥 SALDOS INICIALES Y FACTURAS FUERA DE SIRE
 *
 * Una sola hoja para las facturas (o boletas, N/D) que el sistema no trae solo:
 *   · las que quedaron PENDIENTES del año anterior (o de antes de la fecha «Controlar documentos emitidos desde»),
 *   · la rara factura que SUNAT no tiene en el SIRE.
 * Entran de cualquier origen: pegadas desde Excel / Contasis / otro programa contable (se reconocen las columnas solas),
 * elegidas de lo que SÍ está en el SIRE pero quedó antes del corte, o escritas una por una (Mesa ➕ o en la hoja).
 *
 * Cada fila se vuelve una factura más (Cobranzas, Mesa, Estado de cuenta, Para enviar, Telegram, vencimientos) con la
 * marca «📥 Saldo inicial» o «📥 Fuera de SIRE». Si se pone un SALDO menor que el total, lo pagado antes del corte va
 * como un movimiento «📥 Pagado antes del corte» (así se ve de dónde sale el saldo), y lo que en el sistema sea de antes
 * del corte para esa factura (vouchers, N/C, retenciones de ese tiempo) NO se vuelve a descontar: ya está en el saldo.
 * Si la misma factura llega después en el SIRE, se usa la del SIRE (no se duplica) y se mantiene lo pagado antes.
 */

var INI_HOJA_ = '📥 Saldos iniciales';
var INI_ENC_ = ['Empresa (RUC del grupo)', 'Lado', 'RUC proveedor / cliente', 'Nombre proveedor / cliente', 'Tipo', 'Serie', 'Número',
  'Fecha emisión', 'Vence', 'Moneda', 'Total', 'Saldo al corte (vacío = total)', 'Fecha de corte', 'Origen', 'Observación', 'Cargado'];
var INI_NCOL_ = INI_ENC_.length;
var INI_TIPOS_ = ['01 Factura', '03 Boleta', '08 Nota de débito', '07 Nota de crédito', '14 Servicios públicos', '02 Recibo por honorarios'];

function INI_hoja_(ss, crear) {
  var sh = ss.getSheetByName(INI_HOJA_);
  if (!sh && !crear) return null;
  if (!sh) sh = ss.insertSheet(INI_HOJA_);
  if (String(sh.getRange(1, 1).getValue()) !== INI_ENC_[0]) {
    escribirTabla_(sh, 1, 1, INI_ENC_, []);
    sh.setFrozenRows(1); sh.setRowHeight(1, 42);
    sh.getRange('A2:A3000').setNumberFormat('@'); sh.getRange('C2:C3000').setNumberFormat('@');
    sh.getRange('F2:G3000').setNumberFormat('@');
    sh.getRange('H2:I3000').setNumberFormat('dd/mm/yyyy'); sh.getRange('M2:M3000').setNumberFormat('dd/mm/yyyy');
    sh.getRange('K2:L3000').setNumberFormat('#,##0.00');
    sh.getRange('B2:B3000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Por pagar', 'Por cobrar']).build());
    sh.getRange('E2:E3000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(INI_TIPOS_).setAllowInvalid(true).build());
    sh.getRange('J2:J3000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['PEN', 'USD']).build());
    [120, 90, 110, 260, 110, 70, 80, 95, 95, 65, 100, 120, 95, 110, 220, 140].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.getRange('R1').setValue('ℹ️ Aquí van las facturas que el sistema no trae solo: las que quedaron PENDIENTES antes del corte ' +
      '(año anterior) y las que no están en el SIRE. Lado: «Por pagar» = la factura se la emitió un proveedor a la empresa; ' +
      '«Por cobrar» = la empresa se la emitió a un cliente. «Saldo al corte» = lo que faltaba pagar en esa fecha (vacío = el total). ' +
      'La forma más fácil de llenarla: 🧩 Mesa → 📥 Saldos iniciales (pegar desde Excel o Contasis, elegir del SIRE o una por una).')
      .setWrap(true).setFontColor('#475569').setVerticalAlignment('top');
    sh.setColumnWidth(18, 420);
  }
  return sh;
}

/** Fecha de corte por defecto: el día antes de «Controlar documentos emitidos desde», o el 31/12 del año pasado. */
function INI_corteDefecto_(cfg) {
  if (cfg && cfg.desde) return new Date(cfg.desde.getFullYear(), cfg.desde.getMonth(), cfg.desde.getDate() - 1);
  return new Date(new Date().getFullYear() - 1, 11, 31);
}

/* ============================================================ lectura para el cruce */

/** Lo de la hoja como documentos (iguales a los del SIRE) + los «pagado antes del corte». */
function INI_leer_(ss, cfg) {
  var res = { docs: [], pagos: [], cortes: {}, avisos: [], n: 0 };
  var sh = INI_hoja_(ss, false);
  if (!sh || sh.getLastRow() < 2) return res;
  var grupo = {}; (cfg.grupo || []).forEach(function (r) { grupo[r] = 1; });
  var corte0 = INI_corteDefecto_(cfg);
  sh.getRange(2, 1, sh.getLastRow() - 1, INI_NCOL_).getValues().forEach(function (r, i) {
    var fila = i + 2, emp = aRuc_(r[0]), otro = aRuc_(r[2]), serie = String(r[5] || '').toUpperCase().trim(), num = parseInt(String(r[6]).replace(/\D/g, ''), 10);
    var total = Math.abs(INI_num_(r[10]));
    if (!emp && !otro && !serie && !total) return;
    var donde = INI_HOJA_ + '!' + fila;
    if (!emp || !grupo[emp]) return res.avisos.push({ tipo: 'Saldo inicial', detalle: 'Fila ' + fila + ': la empresa «' + r[0] + '» no es del grupo', fuente: donde });
    if (!otro) return res.avisos.push({ tipo: 'Saldo inicial', detalle: 'Fila ' + fila + ': falta el RUC del proveedor o cliente', fuente: donde });
    if (!serie || !num) return res.avisos.push({ tipo: 'Saldo inicial', detalle: 'Fila ' + fila + ': falta la serie o el número', fuente: donde });
    if (!total) return res.avisos.push({ tipo: 'Saldo inicial', detalle: 'Fila ' + fila + ': falta el total', fuente: donde });
    var cobrar = /cobrar/i.test(String(r[1])), tipo = normTipo_(String(r[4]).match(/\d+/) ? String(r[4]).match(/\d+/)[0] : '01');
    var fecha = aFecha_(r[7]), vence = aFecha_(r[8]), corte = aFecha_(r[12]) || corte0;
    var saldoTxt = String(r[11] == null ? '' : r[11]).trim(), saldo = saldoTxt === '' ? null : Math.abs(INI_num_(r[11]));
    var origen = String(r[13] || '').trim(), fuera = /fuera|no est/i.test(origen) || (fecha && fecha > corte);
    var nombre = String(r[3] || '').trim(), mon = /usd|us\$|dol/i.test(String(r[9])) ? 'USD' : 'PEN';
    var d = {
      car: '', tipo: tipo, serie: serie, numero: num, fecha: fecha, vence: vence, moneda: mon, total: total, tc: 1,
      modTipo: '', modSerie: '', modNumero: '', producto: String(r[14] || ''), linkPdf: '', detraccionSire: false,
      estadoSire: fuera ? '📥 Fuera de SIRE' : '📥 Saldo inicial' + (origen ? ' (' + origen + ')' : ''), fuente: donde,
      emisorRuc: cobrar ? emp : otro, emisorNombre: cobrar ? '' : nombre, receptorRuc: cobrar ? otro : emp, receptorNombre: cobrar ? nombre : '',
    };
    res.docs.push(d); res.n++;
    if (saldo != null) {
      var k = claveDoc_(d.emisorRuc, tipo, serie, num);
      res.cortes[k] = { corte: corte, emisor: d.emisorRuc, ref: tipo + '_' + serie + '-' + num };
      var antes = redondear2_(total - saldo);
      if (antes > 0.005) res.pagos.push({
        id: ['INICIAL', fila, fmtFechaClave_(corte), antes.toFixed(2), d.serie + '-' + num].join('|'),
        fecha: corte, monto: antes, moneda: mon, pagadorRuc: d.receptorRuc, beneficiarioRuc: d.emisorRuc,
        refs: tipo + '_' + serie + '-' + num, operacion: 'Pagado antes del corte ' + Utilities.formatDate(corte, 'America/Lima', 'dd/MM/yyyy'),
        banco: '📥 Saldo inicial', modalidad: MODALIDAD.OTRO, esManual: true, fuente: donde,
      });
      else if (saldo > total + 0.005) res.avisos.push({ tipo: 'Saldo inicial', detalle: 'Fila ' + fila + ': el saldo (' + saldo.toFixed(2) + ') es mayor que el total (' + total.toFixed(2) + ')', fuente: donde });
    }
  });
  return res;
}

/**
 * Lo de ANTES del corte de una factura con saldo inicial ya está en ese saldo: no se descuenta otra vez.
 * Quita las N/C - N/D de antes del corte que la modifican y los pagos (vouchers, retenciones, detracciones, manuales)
 * de antes del corte que la mencionan.
 */
function INI_filtrarAntesDelCorte_(ini, docs, pagos) {
  var ks = Object.keys(ini.cortes || {});
  if (!ks.length) return { docs: docs, pagos: pagos, quitados: 0 };
  var quitados = 0;
  docs = docs.filter(function (d) {
    var t = normTipo_(d.tipo);
    if (t !== '07' && t !== '08') return true;
    var c = ini.cortes[claveDoc_(d.emisorRuc, d.modTipo || '01', d.modSerie, d.modNumero)];
    if (c && d.fecha && d.fecha <= c.corte) { quitados++; return false; }
    return true;
  });
  var porRef = {};
  ks.forEach(function (k) { var c = ini.cortes[k]; porRef[c.ref] = porRef[c.ref] || []; porRef[c.ref].push(c); });
  pagos = pagos.filter(function (p) {
    if (!p.fecha || /^INICIAL\|/.test(String(p.id || ''))) return true;
    var refs; try { refs = parsearReferencias_(p.refs).refs; } catch (e) { return true; }
    var toca = refs.some(function (r) {
      return (porRef[normTipo_(r.tipo) + '_' + String(r.serie).toUpperCase() + '-' + parseInt(r.numero, 10)] || []).some(function (c) {
        return (!p.beneficiarioRuc || p.beneficiarioRuc === c.emisor) && p.fecha <= c.corte;
      });
    });
    if (toca) quitados++;
    return !toca;
  });
  return { docs: docs, pagos: pagos, quitados: quitados };
}

/** Para la huella (si cambia la hoja, Cobranzas se recalcula). */
function INI_huella_(ss) {
  var sh = ss.getSheetByName(INI_HOJA_);
  if (!sh || sh.getLastRow() < 2) return '';
  return hashTexto_(JSON.stringify(sh.getRange(2, 1, sh.getLastRow() - 1, 13).getDisplayValues()));
}

/* ============================================================ 📋 pegar desde Excel / Contasis / otro programa */

/** Número de texto contable: «1,234.56», «1.234,56», «(1,234.56)», «S/ 95.00», «-», «1,234.56-». */
function INI_num_(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).trim();
  if (!s || /^[-–—]+$/.test(s)) return 0;
  var neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^-/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  var c = s.lastIndexOf(','), p = s.lastIndexOf('.');
  if (c > p) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56
  else s = s.replace(/,/g, '');                              // 1,234.56
  var n = parseFloat(s);
  return isNaN(n) ? 0 : (neg ? -n : n);
}

function INI_fecha_(v) {
  if (v instanceof Date) return aFecha_(v);
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  if (/^\d{5}$/.test(s)) { var d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }   // número de Excel
  return null;
}

/** «FT», «FAC», «01», «Factura», «BV», «NC», «ND»… → código SUNAT. */
function INI_tipo_(v, serie) {
  var s = normHeader_(v);
  if (/^0?1$|^f(t|a|ac|act)?$|factura/.test(s)) return '01';
  if (/^0?3$|^b(v|o|ol)?$|boleta/.test(s)) return '03';
  if (/^0?7$|^nc$|credito/.test(s)) return '07';
  if (/^0?8$|^nd$|debito/.test(s)) return '08';
  if (/^14$|servicio/.test(s)) return '14';
  if (/^0?2$|^rh$|honorario/.test(s)) return '02';
  if (/^\d{1,2}$/.test(s)) return ('0' + s).slice(-2);
  return /^B/i.test(String(serie || '')) ? '03' : '01';
}

/** «F001-10892», «01-F001-10892», «F001 / 00010892», «FT F001-10892» → {tipo, serie, numero}. */
function INI_doc_(txt) {
  var s = String(txt == null ? '' : txt).toUpperCase().trim();
  var m = s.match(/(?:^|[^A-Z0-9])(?:(\d{2})\s*[-_ ]\s*)?([A-Z][A-Z0-9]{3}|\d{4})\s*[-\/ ]\s*0*(\d{1,10})\b/);
  if (!m) return null;
  return { tipo: m[1] || '', serie: m[2], numero: parseInt(m[3], 10) };
}

/** Columnas que se reconocen por su encabezado (en cualquier orden y con cualquier nombre parecido). */
var INI_COLS_ = [
  ['cuenta', /^(cta|cuenta)( contable)?$|^cuenta$/],
  ['ruc', /\bruc\b|anexo|cod(igo)? (aux|anexo|prov|cli)|doc(umento)? ident|nro doc ident|n doc ident/],
  ['nombre', /razon|nombre|proveedor|cliente|auxiliar|beneficiario|girado/],
  ['tipo', /^(t d|td|t doc|tipo( de)?( cp| doc| documento| comprobante)?|doc tipo|clase)$/],
  ['serie', /^serie/],
  ['numero', /^(n|nro|num|numero|no)( de)?( doc| documento| comprobante| cp)?$|^(documento|comprobante|nro comprobante|n documento)$|serie numero|serie y numero/],
  ['fecha', /^(fecha|f)( de)?( emision| emi| doc| documento)?$|^f emis|emision/],
  ['vence', /venc|vcto/],
  ['moneda', /^(moneda|mon|mn me|tipo moneda)$/],
  ['total', /^(total|importe|monto|compromiso|cargo|debe|importe total|monto original|total cp|importe original)( s\/| mn| me| us\$| soles| dolares)?$/],
  ['pagado', /amortiz|abono|haber|pagado|cancelado|pagos/],
  ['saldo', /^saldo|pendiente|por pagar|por cobrar/],
  ['glosa', /glosa|detalle|concepto|descripcion|observ/],
  ['empresa', /^empresa$|ruc empresa|razon empresa/],
];

/**
 * filas: arreglo de filas (texto pegado ya partido o lo leído de un Excel). opc: {empresa, lado, corte, nombreEmpresa}.
 * Devuelve {filas: [...listas para la hoja...], mapa, encabezado, omitidas, avisos}.
 */
function INI_parsear_(filas, opc, cfg) {
  opc = opc || {};
  filas = (filas || []).map(function (r) { return (r || []).map(function (c) { return c instanceof Date ? Utilities.formatDate(c, 'America/Lima', 'dd/MM/yyyy') : String(c == null ? '' : c).trim(); }); })
    .filter(function (r) { return r.some(function (c) { return c; }); });
  // 1) la fila de encabezados: la que más columnas reconoce (en las 25 primeras)
  var mejor = { i: -1, n: 0, mapa: {} };
  filas.slice(0, 25).forEach(function (r, i) {
    var mapa = {}, n = 0;
    r.forEach(function (c, j) {
      var h = normHeader_(c); if (!h || h.length > 40) return;
      INI_COLS_.some(function (def) {
        if (def[0] === 'saldo' || def[0] === 'total' || def[0] === 'pagado') { if (def[1].test(h)) { (mapa[def[0]] = mapa[def[0]] || []).push({ j: j, h: h }); n++; return true; } return false; }
        if (mapa[def[0]] == null && def[1].test(h)) { mapa[def[0]] = j; n++; return true; }
        return false;
      });
    });
    if (n > mejor.n) mejor = { i: i, n: n, mapa: mapa };
  });
  var M = mejor.n >= 3 ? mejor.mapa : {}, enc = mejor.n >= 3 ? filas[mejor.i] : [];
  var cuerpo = mejor.n >= 3 ? filas.slice(mejor.i + 1) : filas;
  var grupo = (cfg && cfg.grupo) || [], corte = opc.corte ? INI_fecha_(opc.corte) : INI_corteDefecto_(cfg);
  var col = function (k, r) { return M[k] == null || typeof M[k] === 'object' ? '' : r[M[k]] || ''; };
  // de varias columnas de montos (soles / dólares), la de la moneda de la fila
  var monto = function (k, r, usd) {
    var cs = M[k]; if (!cs || !cs.length) return null;
    var elegida = cs.filter(function (x) { return usd ? /us|\$|dol|\bme\b|extranj/.test(x.h) : /s\/|\bmn\b|sol|nacional/.test(x.h); })[0];
    var valores = cs.map(function (x) { return r[x.j]; }).filter(function (v) { return String(v || '').trim() !== ''; });
    var v = elegida && String(r[elegida.j] || '').trim() !== '' ? r[elegida.j] : valores[0];
    return v == null || String(v).trim() === '' ? null : INI_num_(v);
  };
  var out = [], omit = { cero: 0, sinDoc: 0, sinRuc: 0, total: 0 }, avisos = [], actual = { ruc: '', nombre: '' };
  var grupoDe = function (linea) { var g = linea.match(/\b(\d{11})\b\s*[-–:·]?\s*([A-ZÁÉÍÓÚÑ0-9&.,' ]{3,})/i); return g && !/total/i.test(linea) ? { ruc: g[1], nombre: g[2].trim() } : null; };
  if (mejor.n >= 3) filas.slice(0, mejor.i).forEach(function (r) { var g = grupoDe(r.join(' ')); if (g) actual = g; });   // título del grupo antes de los encabezados
  cuerpo.forEach(function (r) {
    var linea = r.join(' ');
    if (/^\s*(total|sub ?total|saldo (final|total)|totales)\b/i.test(normHeader_(r.filter(String)[0] || ''))) { omit.total++; return; }
    // RUC y nombre: de su columna, o de una fila-título del grupo («20604785775 UNIDAD DE PROCESAMIENTOS …») como en Contasis
    var ruc = aRuc_(col('ruc', r)), nombre = col('nombre', r);
    var doc = null;
    if (M.serie != null && col('serie', r)) doc = INI_doc_(col('numero', r) ? col('serie', r) + '-' + col('numero', r) : col('serie', r));   // «Serie» + «Número», o «Serie-Número» en una
    if ((!doc || !doc.numero) && M.numero != null) doc = INI_doc_(col('numero', r));
    if (!doc || !doc.numero) doc = INI_doc_(linea.replace(/\b\d{8,11}\b/g, ' '));
    if (!doc || !doc.numero) {
      var g = grupoDe(linea);
      if (g) { actual = g; return; }
      omit.sinDoc++; return;
    }
    if (!ruc) { ruc = actual.ruc; nombre = nombre || actual.nombre; }
    if (!ruc) { omit.sinRuc++; return; }
    var monTxt = col('moneda', r), usd = /us|\$|dol|^me$|^2$/i.test(monTxt);
    var tot = monto('total', r, usd), sal = monto('saldo', r, usd), pag = monto('pagado', r, usd);
    if (tot == null && sal != null && pag != null) tot = sal + pag;
    if (tot == null) tot = sal;
    if (sal == null && tot != null && pag != null) sal = tot - pag;
    if (!tot && !sal) { omit.cero++; return; }
    if (sal != null && Math.abs(sal) < 0.005) { omit.cero++; return; }   // ya cancelada al corte: no es saldo inicial
    var tipo = INI_tipo_(col('tipo', r) || doc.tipo, doc.serie);
    var lado = opc.lado || (/^4/.test(col('cuenta', r)) ? 'Por pagar' : /^1/.test(col('cuenta', r)) ? 'Por cobrar' : 'Por pagar');
    var emp = aRuc_(col('empresa', r)) || opc.empresa || '';
    var fe = INI_fecha_(col('fecha', r)), ve = INI_fecha_(col('vence', r));
    out.push([emp, lado, ruc, nombre, INI_TIPOS_.filter(function (t) { return t.indexOf(tipo) === 0; })[0] || tipo, doc.serie, String(doc.numero),
      fe, ve, usd ? 'USD' : 'PEN', Math.abs(tot), sal == null ? '' : Math.abs(sal), corte, opc.origen || 'Pegado', col('glosa', r), '']);
  });
  if (mejor.n < 3) avisos.push('No encontré la fila de títulos: leí cada línea buscando RUC, documento y montos. Revise la vista previa.');
  if (out.some(function (x) { return !x[0]; })) avisos.push('Falta la empresa del grupo: elíjala arriba.');
  out.forEach(function (x) { if (x[0] && grupo.length && grupo.indexOf(x[0]) < 0) avisos.push('La empresa ' + x[0] + ' no es del grupo.'); });
  var mapaTxt = {};
  Object.keys(M).forEach(function (k) { mapaTxt[k] = typeof M[k] === 'object' ? M[k].map(function (x) { return enc[x.j]; }).join(' / ') : enc[M[k]]; });
  return { filas: out, mapa: mapaTxt, omitidas: omit, avisos: avisos.filter(function (a, i, s) { return s.indexOf(a) === i; }) };
}

/** Texto pegado (Excel / Contasis / CSV) → filas. */
function INI_partir_(texto) {
  var lineas = String(texto || '').replace(/\r/g, '').split('\n');
  var sep = lineas.some(function (l) { return l.indexOf('\t') >= 0; }) ? '\t' : (lineas.filter(function (l) { return l.split(';').length > 3; }).length > lineas.length / 3 ? ';' : ',');
  return lineas.map(function (l) {
    if (sep !== ',') return l.split(sep);
    var out = [], cur = '', q = false;   // CSV con comillas
    for (var i = 0; i < l.length; i++) { var ch = l[i]; if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out;
  });
}

/** Agrega (o actualiza si ya está: misma empresa, lado, RUC, tipo, serie y número). */
function INI_agregar_(ss, filas, quien) {
  var sh = INI_hoja_(ss, true), n = Math.max(0, sh.getLastRow() - 1);
  var actuales = n ? sh.getRange(2, 1, n, INI_NCOL_).getValues() : [];
  var clave = function (r) { return [aRuc_(r[0]), /cobrar/i.test(r[1]) ? 'C' : 'P', aRuc_(r[2]), String(r[4]).slice(0, 2), String(r[5]).toUpperCase().trim(), parseInt(String(r[6]).replace(/\D/g, ''), 10)].join('|'); };
  var idx = {}; actuales.forEach(function (r, i) { idx[clave(r)] = i; });
  var nuevos = [], cambiados = 0, ahora = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm') + (quien ? ' · ' + String(quien).slice(0, 40) : '');
  (filas || []).forEach(function (r) {
    r = r.slice(0, INI_NCOL_); while (r.length < INI_NCOL_) r.push('');
    r[7] = r[7] ? INI_fecha_(r[7]) || r[7] : ''; r[8] = r[8] ? INI_fecha_(r[8]) || r[8] : ''; r[12] = r[12] ? INI_fecha_(r[12]) || r[12] : '';
    r[10] = INI_num_(r[10]); r[11] = String(r[11]).trim() === '' ? '' : INI_num_(r[11]); r[15] = ahora;
    var k = clave(r);
    if (idx[k] != null) { sh.getRange(idx[k] + 2, 1, 1, INI_NCOL_).setValues([r]); cambiados++; }
    else { idx[k] = -1; nuevos.push(r); }
  });
  if (nuevos.length) sh.getRange(sh.getLastRow() + 1, 1, nuevos.length, INI_NCOL_).setValues(nuevos);
  return { nuevos: nuevos.length, cambiados: cambiados };
}

/* ============================================================ 🔎 elegir del SIRE lo que quedó antes del corte */

/** Facturas del SIRE de esa empresa y lado emitidas ANTES del corte (no entran solas si hay fecha «desde»). */
function INI_delSire_(cfg, empresa, lado, q, corte) {
  corte = corte ? INI_fecha_(corte) : INI_corteDefecto_(cfg);
  var cobrar = /cobrar/i.test(lado), qn = normHeader_(q || ''), out = [];
  var liqs = buscarLiquidaciones_(cfg).filter(function (l) { return l.ruc === empresa; });
  leerDocumentosSire_(cfg, liqs).forEach(function (d) {
    if (!d.fecha || d.fecha > corte) return;
    if (cobrar ? d.emisorRuc !== empresa : d.receptorRuc !== empresa) return;
    var t = normTipo_(d.tipo); if (t === '07') return;
    var ruc = cobrar ? d.receptorRuc : d.emisorRuc, nom = cobrar ? d.receptorNombre : d.emisorNombre;
    if (qn && normHeader_(ruc + ' ' + nom + ' ' + d.serie + '-' + d.numero).indexOf(qn) < 0) return;
    out.push([empresa, cobrar ? 'Por cobrar' : 'Por pagar', ruc, nom, INI_TIPOS_.filter(function (x) { return x.indexOf(t) === 0; })[0] || t, String(d.serie).toUpperCase(), String(parseInt(d.numero, 10)),
      Utilities.formatDate(d.fecha, 'America/Lima', 'dd/MM/yyyy'), d.vence ? Utilities.formatDate(d.vence, 'America/Lima', 'dd/MM/yyyy') : '', d.moneda, Math.abs(d.total), '', Utilities.formatDate(corte, 'America/Lima', 'dd/MM/yyyy'), 'SIRE', d.producto ? String(d.producto).slice(0, 80) : '', '']);
  });
  var vistos = {};
  out = out.filter(function (r) { var k = r[2] + r[5] + r[6]; if (vistos[k]) return false; vistos[k] = 1; return true; });
  out.sort(function (a, b) { return a[3].localeCompare(b[3]) || INI_fecha_(a[7]) - INI_fecha_(b[7]); });
  return { filas: out.slice(0, 1500), total: out.length, corte: Utilities.formatDate(corte, 'America/Lima', 'dd/MM/yyyy') };
}

/* ============================================================ 🧩 desde la Mesa */

function MESA_iniInfo(tk) {
  MESA_ok_(tk);
  var ss = ssPrincipal_(), cfg = leerConfig_(ss), sh = INI_hoja_(ss, false);
  return { corte: Utilities.formatDate(INI_corteDefecto_(cfg), 'America/Lima', 'yyyy-MM-dd'), desde: cfg.desde ? Utilities.formatDate(cfg.desde, 'America/Lima', 'dd/MM/yyyy') : '',
    filas: sh ? Math.max(0, sh.getLastRow() - 1) : 0, url: sh ? ss.getUrl() + '#gid=' + sh.getSheetId() : '' };
}
/** Vista previa de lo pegado (texto) o de un Excel leído en la página (filas). No escribe nada. */
function MESA_iniVista(tk, texto, filas, empresa, lado, corte) {
  MESA_ok_(tk);
  var cfg = leerConfig_(ssPrincipal_());
  var r = INI_parsear_(filas && filas.length ? filas : INI_partir_(texto), { empresa: aRuc_(empresa), lado: lado || '', corte: corte, origen: filas && filas.length ? 'Excel' : 'Pegado' }, cfg);
  r.filas = r.filas.map(INI_paraPagina_);
  return r;
}
function MESA_iniSire(tk, empresa, lado, q, corte) {
  MESA_ok_(tk);
  var cfg = leerConfig_(ssPrincipal_());
  if (!aRuc_(empresa)) throw new Error('Elija la empresa.');
  var r = INI_delSire_(cfg, aRuc_(empresa), lado, q, corte);
  r.filas = r.filas.map(INI_paraPagina_);
  return r;
}
/** Guarda las filas elegidas (de cualquier origen) y recalcula Cobranzas por detrás. */
function MESA_iniGuardar(tk, filas) {
  var quien = MESA_ok_(tk), ss = ssPrincipal_(), cfg = leerConfig_(ss);
  filas = (filas || []).slice(0, 3000);
  var malas = filas.filter(function (r) { return cfg.grupo.indexOf(aRuc_(r[0])) < 0 || !aRuc_(r[2]) || !r[5] || !r[6]; });
  if (malas.length) throw new Error(malas.length + ' fila(s) sin empresa del grupo, RUC, serie o número. Corríjalas en la vista previa.');
  var r = INI_agregar_(ss, filas, quien);
  MESA_tocar_(); MESA_programarRecalculo_();
  return { mensaje: '📥 ' + r.nuevos + ' factura(s) agregadas' + (r.cambiados ? ' y ' + r.cambiados + ' actualizada(s)' : '') + ' en «' + INI_HOJA_ + '». Cobranzas se recalcula en ~1–2 min y la Mesa se recarga sola.' };
}
function INI_paraPagina_(r) {
  return r.map(function (c) { return c instanceof Date ? Utilities.formatDate(c, 'America/Lima', 'dd/MM/yyyy') : c; });
}

/** Menú de la hoja: crea (si falta) y abre la hoja. */
function INI_menuAbrir() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = INI_hoja_(ss, true);
  ss.setActiveSheet(sh);
  SpreadsheetApp.getUi().alert('📥 Saldos iniciales', 'Aquí van las facturas pendientes de antes del corte (año anterior) y las que no están en el SIRE.\n\n' +
    'Puede escribirlas o pegarlas aquí en el mismo orden de columnas, o usar la 🧩 Mesa → 📥 Saldos iniciales: pegar desde Excel / Contasis (reconoce las columnas solo), elegir del SIRE o una por una.\n\n' +
    'Después use 🔄 Actualizar ahora (o espere la actualización automática).', SpreadsheetApp.getUi().ButtonSet.OK);
}
