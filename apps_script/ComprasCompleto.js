/**
 * ComprasCompleto.gs
 * Pestaña "Compras SIRE completo" de cada Liquidacion IGV (solo COMPRAS).
 *
 * SUNAT entrega cada mes dos versiones del registro de compras:
 *   - PROPUESTA: lo que SUNAT propone. Incluye tambien facturas de meses
 *     anteriores que aun no se anotaron (por eso una misma factura se repite
 *     en varias propuestas).
 *   - ACEPTADA: lo que realmente se registro/declaro ese mes.
 * GitHub guarda ambas por mes (historico/<AAAAMM>/compras_propuesta.csv y
 * compras_aceptada.csv, convertidas desde los .zip de SUNAT).
 *
 * Esta pestaña junta TODAS las facturas del anio, UNA sola vez cada una, con
 * prioridad Aceptada > Propuesta, y al final dice su estado:
 *   ✅ Anotada (periodo en que se anoto)
 *   🟡 No anotada: estuvo en la propuesta de un mes que YA tiene aceptada y quedo fuera
 *   🔵 En propuesta de un mes que aun no tiene aceptada (todavia por declarar)
 * "Detalle Compras" NO cambia (sigue alimentando el calculo del IGV); solo se
 * le agrega al final la columna "Fuente SIRE" (Aceptada / Propuesta).
 */

var HOJA_COMPRAS_COMPLETO_ = 'Compras SIRE completo';
var EST_ANOTADA_ = '✅ Anotada';
var EST_PENDIENTE_ = '🟡 No anotada (quedó fuera de la aceptada)';
var EST_POR_DECLARAR_ = '🔵 En propuesta, periodo aún sin aceptada';

/** Clave unica de una factura: RUC emisor | tipo | serie | numero (sin ceros a la izquierda). */
function claveFacturaCompra_(ruc, tipo, serie, numero) {
  return [String(ruc || '').trim(), String(tipo || '').trim(), String(serie || '').trim().toUpperCase(),
    String(numero || '').trim().replace(/^0+(?=\d)/, '')].join('|');
}

/** Lee compras_<version>.csv de un periodo: {enc, filas} o null si no existe. */
function leerVersionCompras_(cfg, ruc, periodo, version) {
  var texto = leerArchivoTextoGitHub_(cfg, 'sire/' + ruc + '/historico/' + periodo + '/compras_' + version + '.csv');
  if (!texto) return null;
  var filas = parsearDelimitado_(quitarBOM_(texto), ',');
  if (!filas.length) return null;
  return { enc: filas[0].map(function (h) { return String(h).trim(); }), filas: filas.slice(1) };
}

/**
 * Junta propuestas y aceptadas del anio. Devuelve:
 *   { enc: [...columnas SUNAT], facturas: {clave: {...}}, aceptadas: {periodo: {clave:true}},
 *     propuestas: {periodo: {clave:true}} }  o null si no hay nada en GitHub.
 */
function juntarVersionesCompras_(cfg, ruc, anio) {
  var hoy = new Date();
  var periodos = [];
  for (var m = 1; m <= 12; m++) periodos.push(anio + ('0' + m).slice(-2));
  // Para saber si una pendiente se anoto despues (en el anio siguiente).
  var siguientes = [];
  if (anio < hoy.getFullYear()) {
    for (var m2 = 1; m2 <= 12; m2++) siguientes.push((anio + 1) + ('0' + m2).slice(-2));
  }
  var res = { enc: null, facturas: {}, aceptadas: {}, propuestas: {}, leidos: 0 };

  function idx(enc, nombre) { return buscarIndiceColumna_(enc, nombre); }
  function recorrer(version, periodo, delAnio) {
    var d = leerVersionCompras_(cfg, ruc, periodo, version);
    if (!d) return;
    res.leidos++;
    if (!res.enc && delAnio) res.enc = d.enc;
    var iRuc = idx(d.enc, 'Nro Doc Identidad'), iTipo = idx(d.enc, 'Tipo CP/Doc.'),
      iSerie = idx(d.enc, 'Serie del CDP'), iNum = idx(d.enc, 'Nro CP o Doc. Nro Inicial (Rango)');
    if (iRuc < 0 || iSerie < 0 || iNum < 0) return;
    var marca = version === 'aceptada' ? res.aceptadas : res.propuestas;
    marca[periodo] = marca[periodo] || {};
    d.filas.forEach(function (f) {
      if (f.length < 6) return;
      var k = claveFacturaCompra_(f[iRuc], iTipo >= 0 ? f[iTipo] : '', f[iSerie], f[iNum]);
      marca[periodo][k] = true;
      var x = res.facturas[k];
      if (!x) {
        if (!delAnio) return;  // del anio siguiente solo interesa para el estado
        x = res.facturas[k] = { fila: null, enc: null, anotada: '', propuestas: [] };
      }
      if (version === 'aceptada') {
        if (!x.anotada || periodo < x.anotada) {
          x.anotada = periodo;
          if (delAnio || !x.fila) { x.fila = f; x.enc = d.enc; }
        }
      } else {
        if (delAnio && x.propuestas.indexOf(periodo) < 0) x.propuestas.push(periodo);
        if (!x.anotada && delAnio) { x.fila = f; x.enc = d.enc; }  // la propuesta mas reciente
      }
    });
  }
  // Primero aceptadas (prioridad), luego propuestas en orden de periodo.
  periodos.forEach(function (p) { recorrer('aceptada', p, true); });
  periodos.forEach(function (p) { recorrer('propuesta', p, true); });
  siguientes.forEach(function (p) { recorrer('aceptada', p, false); });
  return res.leidos ? res : null;
}

/** "Fuente SIRE" para cada fila de Detalle Compras (Aceptada / Propuesta del periodo de la fila). */
function agregarFuenteSireCompras_(compras, versiones) {
  if (!versiones || !compras || !compras.filas.length) return;
  var enc = compras.encabezado;
  var iPer = buscarIndiceColumna_(enc, 'Periodo'), iRuc = buscarIndiceColumna_(enc, 'Nro Doc Identidad'),
    iTipo = buscarIndiceColumna_(enc, 'Tipo CP/Doc.'), iSerie = buscarIndiceColumna_(enc, 'Serie del CDP'),
    iNum = buscarIndiceColumna_(enc, 'Nro CP o Doc. Nro Inicial (Rango)');
  if (iPer < 0 || iRuc < 0 || iSerie < 0 || iNum < 0) return;
  compras.encabezado = enc.concat(['Fuente SIRE']);
  compras.filas = compras.filas.map(function (f) {
    var p = String(f[iPer]).trim();
    var k = claveFacturaCompra_(f[iRuc], iTipo >= 0 ? f[iTipo] : '', f[iSerie], f[iNum]);
    var fuente = (versiones.aceptadas[p] || {})[k] ? 'Aceptada' : (versiones.propuestas[p] || {})[k] ? 'Propuesta' : '';
    return f.concat([fuente]);
  });
}

/** Escribe la pestaña "Compras SIRE completo". compras = Detalle Compras ya consolidado (para los links). */
function escribirComprasCompleto_(ss, versiones, compras, ruc) {
  var sheet = obtenerOCrearHoja_(ss, HOJA_COMPRAS_COMPLETO_);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();
  if (!versiones || !versiones.enc) {
    sheet.getRange(1, 1).setValue('(aun no hay propuestas/aceptadas de compras de este anio en GitHub)');
    return;
  }
  var base = versiones.enc;
  var NUM = /^(bi |igv|valor|isc|icbper|otros|total|tipo de cambio|imb|porcpart)/;
  var esNum = base.map(function (h) { return NUM.test(normalizarEncabezado_(h)); });

  // Links PDF/XML que ya tiene Detalle Compras (misma factura).
  var links = {};
  if (compras && compras.filas.length) {
    var e = compras.encabezado;
    var iR = buscarIndiceColumna_(e, 'Nro Doc Identidad'), iT = buscarIndiceColumna_(e, 'Tipo CP/Doc.'),
      iS = buscarIndiceColumna_(e, 'Serie del CDP'), iN = buscarIndiceColumna_(e, 'Nro CP o Doc. Nro Inicial (Rango)'),
      iP = buscarIndiceColumna_(e, 'Link PDF'), iX = buscarIndiceColumna_(e, 'Link XML');
    if (iR >= 0 && iS >= 0 && iN >= 0) {
      compras.filas.forEach(function (f) {
        var k = claveFacturaCompra_(f[iR], iT >= 0 ? f[iT] : '', f[iS], f[iN]);
        if (!links[k]) links[k] = [iP >= 0 ? f[iP] : '', iX >= 0 ? f[iX] : ''];
      });
    }
  }

  var iFecha = buscarIndiceColumna_(base, 'Fecha de emision');
  var filas = [];
  Object.keys(versiones.facturas).forEach(function (k) {
    var x = versiones.facturas[k];
    if (!x.fila) return;
    var fila = base.map(function (h, i) {
      var j = x.enc === base ? i : buscarIndiceColumna_(x.enc, h);
      var v = j >= 0 && j < x.fila.length ? x.fila[j] : '';
      if (esNum[i] && v !== '' && !isNaN(Number(v))) return Number(v);
      return v;
    });
    var fecha = iFecha >= 0 ? String(fila[iFecha]) : '';
    var lk = links[k] || ['', ''];
    var anotarHasta = '';
    if (!x.anotada) {
      var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha);
      if (m) {
        var t = Number(m[3]) * 12 + (Number(m[2]) - 1) + 12;
        anotarHasta = ('0' + (t % 12 + 1)).slice(-2) + '/' + Math.floor(t / 12);
      }
    }
    var fueraDeAceptada = x.propuestas.some(function (p) { return !!versiones.aceptadas[p]; });
    var estado = x.anotada ? EST_ANOTADA_ : fueraDeAceptada ? EST_PENDIENTE_ : EST_POR_DECLARAR_;
    filas.push(fila.concat([lk[0], lk[1], periodoDeEmision_(fecha),
      estado, x.anotada || '', x.propuestas.sort().join(', '), anotarHasta]));
  });
  if (!filas.length) {
    sheet.getRange(1, 1).setValue('(sin facturas de compras en las propuestas/aceptadas de este anio)');
    return;
  }
  if (iFecha >= 0) filas = ordenarPorFechaEmision_(filas, iFecha);
  var enc = base.concat(['Link PDF', 'Link XML', 'Periodo Emision', 'Estado SIRE', 'Periodo en que se anoto',
    'Propuestas en que aparecio', 'Anotar hasta (12 meses, referencial)']);
  var n = filas.length, nc = enc.length;
  sheet.getRange(1, 1, 1, nc).setValues([enc]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#305496');
  sheet.getRange(1, nc - 3, 1, 4).setBackground('#7C2D12');
  sheet.setFrozenRows(1);
  sheet.getRange(2, 1, n, nc).setValues(filas);
  base.forEach(function (h, i) { if (esNum[i]) sheet.getRange(2, i + 1, n, 1).setNumberFormat('#,##0.00'); });
  var colEstado = nc - 3;
  sheet.getRange(1, 1, n + 1, nc).createFilter();
  try { colorearNotasCredito_(sheet, enc, n); } catch (eNc) {}
  sheet.getRange(2, colEstado, n, 1).setBackgrounds(filas.map(function (f) {
    return [f[colEstado - 1] === EST_ANOTADA_ ? '#DCFCE7' : f[colEstado - 1] === EST_PENDIENTE_ ? '#FEF3C7' : '#DBEAFE'];
  }));
  try { ajustarAnchoColumnasDetalle_(sheet, enc, filas); } catch (eA) {}
  var cuenta = function (e) { return filas.filter(function (f) { return f[colEstado - 1] === e; }).length; };
  sheet.getRange(1, 1).setNote('Todas las facturas de compras del año (propuestas + aceptadas de SUNAT), una sola vez cada una. ' +
    'Prioridad: Aceptada > Propuesta. ' + cuenta(EST_ANOTADA_) + ' anotadas, ' + cuenta(EST_PENDIENTE_) + ' no anotadas (quedaron fuera), ' +
    cuenta(EST_POR_DECLARAR_) + ' en propuesta de meses aún sin aceptada. ' +
    'Filtra la columna "Estado SIRE" para ver las pendientes. "Anotar hasta" es referencial (12 meses desde la emisión): confírmalo con tu contador.');
  try { sheet.hideColumns(1, 4); } catch (eH) {}
}
