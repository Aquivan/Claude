/**
 * ExcelHelper.gs
 * Convierte el CSV que GitHub ya dejo listo (via GitHubSync.gs) a una hoja
 * bien estructurada: encabezados reales, tipos de dato (fecha/entero/decimal
 * /texto) detectados automaticamente, autofiltro, fila de encabezado
 * congelada, y ancho de columna ajustado al contenido (no al titulo).
 *
 * Logica portada 1:1 desde excel_converter.py (version Python original),
 * mas un parser de CSV consciente de comillas (ver parsearDelimitado_) --
 * el CSV que arma convertir_sire.py en GitHub usa el modulo csv de Python,
 * que SI encierra en comillas cualquier campo con una coma adentro (ej. una
 * razon social "ACME, S.A.C."); el split ingenuo de coma que tenia esta
 * funcion antes (para el TXT/CSV que bajaba directo de SUNAT) rompia esos
 * casos.
 */

// Nombres de columna OFICIALES del Registro de Ventas (RVIE), 40 columnas.
// Fuente: la propia fila de encabezado que SUNAT incluye en el archivo de
// PROPUESTA. Se usa solo como respaldo si por algun motivo el CSV que llega
// de GitHub no trajera encabezado (no deberia pasar -- convertir_sire.py
// siempre escribe uno, real o sintetico).
var COLUMNAS_VENTA_ = [
  'Ruc', 'Razon Social', 'Periodo', 'CAR SUNAT', 'Fecha de emisión',
  'Fecha Vcto/Pago', 'Tipo CP/Doc.', 'Serie del CDP',
  'Nro CP o Doc. Nro Inicial (Rango)', 'Nro Final (Rango)',
  'Tipo Doc Identidad', 'Nro Doc Identidad', 'Apellidos Nombres/ Razón Social',
  'Valor Facturado Exportación', 'BI Gravada', 'Dscto BI', 'IGV / IPM',
  'Dscto IGV / IPM', 'Mto Exonerado', 'Mto Inafecto', 'ISC', 'BI Grav IVAP',
  'IVAP', 'ICBPER', 'Otros Tributos', 'Total CP', 'Moneda', 'Tipo Cambio',
  'Fecha Emisión Doc Modificado', 'Tipo CP Modificado', 'Serie CP Modificado',
  'Nro CP Modificado', 'ID Proyecto Operadores Atribución', 'Tipo de Nota',
  'Est. Comp', 'Valor FOB Embarcado', 'Valor OP Gratuitas', 'Tipo Operación',
  'DAM / CP', 'CLU',
];

var COLUMNAS_COMPRA_ = [
  'Ruc', 'Razon Social', 'Periodo', 'CAR SUNAT', 'Fecha de emisión',
  'Fecha Vcto/Pago', 'Tipo CP/Doc.', 'Serie del CDP', 'Nro CP o Doc. Nro Inicial (Rango)',
  'Tipo Doc Identidad', 'Nro Doc Identidad', 'Apellidos Nombres/ Razón Social',
  'BI Gravado DG', 'IGV / IPM DG', 'BI Gravado DGNG', 'IGV / IPM DGNG',
  'BI Gravado DNG', 'IGV / IPM DNG', 'Valor Adq. NG', 'ISC', 'ICBPER',
  'Otros Trib/ Cargos', 'Total CP', 'Moneda', 'Tipo de Cambio',
  'Fecha Emisión Doc Modificado', 'Tipo CP Modificado', 'Serie CP Modificado',
  'Nro CP Modificado', 'IMB', 'Detracción', 'Tipo de Nota', 'Est. Comp.',
  'Incal', 'Estado'
];

var PATRONES_TEXTO_LARGO_ = ['razon social', 'raz. social', 'nombre', 'denominaci'];
var ANCHO_MINIMO_ = 58;
var ANCHO_MAXIMO_ = 95;
var ANCHO_MINIMO_TEXTO_LARGO_ = 180;
var ANCHO_MAXIMO_TEXTO_LARGO_ = 250;

/** Quita tildes/diacriticos y pasa a minusculas, para comparar nombres de
 * columna sin depender de acentos ("emisión" vs "emision"). */
function normalizarTexto_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Busca en el encabezado la columna de "Fecha de emision" POR NOMBRE (no por
 * posicion fija) -- asi funciona igual en Ventas y Compras aunque tengan
 * estructuras distintas, y no se rompe si SUNAT cambia el orden de columnas.
 * Excluye "Fecha Vcto/Pago" y "...Doc Modificado" (tienen 'fecha' pero no
 * 'emision', o tienen ambas pero son la fecha de OTRO documento). Devuelve
 * indice 0-based, o -1 si no se encuentra. */
function indiceColumnaFechaEmision_(encabezado) {
  for (var i = 0; i < encabezado.length; i++) {
    var h = normalizarTexto_(encabezado[i]);
    if (h.indexOf('fecha') !== -1 && h.indexOf('emision') !== -1 && h.indexOf('modific') === -1) {
      return i;
    }
  }
  return -1;
}

/** Valor comparable (timestamp) para ordenar por fecha. null si esta vacio o
 * no se pudo interpretar -- esas filas se mandan al final sin romper el orden
 * de las que si tienen fecha. */
function valorFechaOrden_(v) {
  if (v instanceof Date) return v.getTime();
  var texto = String(v || '').trim();
  if (!texto) return null;
  var f = intentarFecha_(texto);
  return f ? f.getTime() : null;
}

/** Ordena una matriz de filas por la columna de fecha de emision, ascendente.
 * Las filas sin fecha (vacias o sin poder interpretarse) van al final, en su
 * orden original. Si no se encuentra la columna, no cambia nada -- el
 * autofiltro que ya se crea en cada hoja igual permite reordenar a mano por
 * cualquier columna. */
function ordenarPorFechaEmision_(matriz, colFecha) {
  if (colFecha < 0) return matriz;
  var indices = matriz.map(function (_, i) { return i; });
  indices.sort(function (ia, ib) {
    var a = valorFechaOrden_(matriz[ia][colFecha]);
    var b = valorFechaOrden_(matriz[ib][colFecha]);
    if (a === null && b === null) return ia - ib;
    if (a === null) return 1;
    if (b === null) return -1;
    return a !== b ? a - b : ia - ib;
  });
  return indices.map(function (i) { return matriz[i]; });
}

/**
 * Ancho de columna en pixeles, proporcional al DATO mas largo de esa columna
 * (NO al titulo del encabezado): si una columna trae datos cortos (o esta
 * completamente vacia), se achica al minimo aunque el titulo sea largo -- el
 * titulo se puede ver cortado, eso es preferible a columnas anchas por gusto
 * del encabezado y no por el contenido real. Las columnas de texto largo
 * (razon social/nombre) usan un piso mas generoso.
 */
function ajustarAnchoColumnas_(sheet, encabezado, matriz, nCols) {
  var esTextoLargo = encabezado.map(function (h) {
    var hNorm = normalizarTexto_(h);
    return PATRONES_TEXTO_LARGO_.some(function (p) { return hNorm.indexOf(normalizarTexto_(p)) !== -1; });
  });
  var anchos = new Array(nCols).fill(0);
  for (var r = 0; r < matriz.length; r++) {
    for (var c = 0; c < nCols; c++) {
      var v = matriz[r][c];
      var largo = v instanceof Date ? 10 : String(v === null || v === undefined ? '' : v).length;
      if (largo > anchos[c]) anchos[c] = largo;
    }
  }
  for (var i = 0; i < nCols; i++) {
    var hNorm = normalizarTexto_(encabezado[i] || '');
    if (hNorm.indexOf('car') !== -1) {
      sheet.setColumnWidth(i + 1, 240); // Ancho suficiente para CAR SUNAT (27 caracteres)
      continue;
    }
    // items_descripcion: columna mediana sin wrap
    if (hNorm.indexOf('items_descripcion') !== -1) {
      sheet.setColumnWidth(i + 1, 220);
      continue;
    }
    // items_cantidad: columna angosta
    if (hNorm.indexOf('items_cantidad') !== -1) {
      sheet.setColumnWidth(i + 1, 100);
      continue;
    }
    if (hNorm === 'link pdf' || hNorm === 'link xml') {
      sheet.setColumnWidth(i + 1, 90);
      continue;
    }
    var pxPorCaracter = 7.3;
    var anchoPx = (anchos[i] + 2) * pxPorCaracter;
    if (esTextoLargo[i]) {
      anchoPx = Math.min(Math.max(anchoPx, ANCHO_MINIMO_TEXTO_LARGO_), ANCHO_MAXIMO_TEXTO_LARGO_);
    } else {
      anchoPx = Math.min(Math.max(anchoPx, ANCHO_MINIMO_), ANCHO_MAXIMO_);
    }
    sheet.setColumnWidth(i + 1, Math.round(anchoPx));
  }
}

function detectarDelimitador_(muestra) {
  var comas = (muestra.match(/,/g) || []).length;
  var barras = (muestra.match(/\|/g) || []).length;
  return comas > barras ? ',' : '|';
}

/**
 * Parser de texto delimitado consciente de comillas (estilo RFC 4180):
 * respeta comillas dobles, comillas escapadas (""), y campos que traigan el
 * delimitador o un salto de linea adentro entre comillas. Recorre TODO el
 * texto caracter a caracter (no linea por linea) porque un campo entre
 * comillas puede contener un salto de linea real.
 */
function parsearDelimitado_(texto, delim) {
  var filas = [];
  var fila = [];
  var campo = '';
  var enComillas = false;
  var i = 0;
  var n = texto.length;

  function cerrarCampo() { fila.push(campo.trim()); campo = ''; }
  function cerrarFila() { cerrarCampo(); filas.push(fila); fila = []; }

  while (i < n) {
    var c = texto.charAt(i);
    if (enComillas) {
      if (c === '"') {
        if (texto.charAt(i + 1) === '"') { campo += '"'; i += 2; continue; }
        enComillas = false; i++; continue;
      }
      campo += c; i++; continue;
    }
    if (c === '"' && campo === '') { enComillas = true; i++; continue; }
    if (c === delim) { cerrarCampo(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { cerrarFila(); i++; continue; }
    campo += c; i++;
  }
  if (campo !== '' || fila.length > 0) cerrarFila();

  return filas.filter(function (f) { return f.some(function (c) { return c !== ''; }); });
}

/** Quita el BOM de UTF-8 del inicio del texto. Los archivos de PROPUESTA de
 * SUNAT vienen con BOM; los de registro presentado no. Sin esto, el primer
 * encabezado aparece como "ï»¿Ruc" o "﻿Ruc". */
function quitarBOM_(texto) {
  return texto.replace(/^﻿/, '').replace(/^ï»¿/, '');
}

/** Devuelve {encabezado (o null), filas}. Detecta si la 1ra linea es encabezado. */
function leerFilas_(contenidoTexto) {
  if (!contenidoTexto || !contenidoTexto.trim()) return { encabezado: null, filas: [] };
  contenidoTexto = quitarBOM_(contenidoTexto);

  var delim = detectarDelimitador_(contenidoTexto.split(/\r\n|\n/)[0]);
  var todasLasFilas = parsearDelimitado_(contenidoTexto, delim);
  if (todasLasFilas.length === 0) return { encabezado: null, filas: [] };

  var primera = todasLasFilas[0];
  var esEncabezado = primera.some(function(celda) {
    var s = normalizarTexto_(celda);
    return s.indexOf('fecha') !== -1 || s.indexOf('tipo') !== -1 || s.indexOf('ruc') !== -1 ||
           s.indexOf('total') !== -1 || s.indexOf('car') !== -1 || s.indexOf('periodo') !== -1 ||
           s.indexOf('serie') !== -1 || s.indexOf('razon') !== -1 || s.indexOf('gravad') !== -1 ||
           s.indexOf('comprobante') !== -1 || s.indexOf('emision') !== -1 || s.indexOf('moneda') !== -1;
  });

  return esEncabezado
    ? { encabezado: primera, filas: todasLasFilas.slice(1) }
    : { encabezado: null, filas: todasLasFilas };
}

function intentarFecha_(valor) {
  var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  if (!m) return null;
  var d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function intentarNumero_(valor) {
  var v = valor.trim();
  if (!v) return null;
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  var n = Number(v);
  return isNaN(n) || !isFinite(n) ? null : n;
}

function esColumnaTextoFijo_(nombreCol) {
  var h = normalizarTexto_(nombreCol || '');
  if (!h) return false;
  var patronesTexto = [
    'car', 'ruc', 'serie', 'nro cp', 'nro doc', 'tipo cp', 'tipo doc',
    'tipo de nota', 'est. comp', 'incal', 'estado', 'periodo', 'moneda',
    'dam', 'clu', 'items_', 'link '
  ];
  return patronesTexto.some(function (p) { return h.indexOf(p) !== -1; });
}

/** Para cada columna: 'fecha' | 'decimal' | 'entero' | 'texto'. */
function inferirTipos_(encabezado, filas, nCols) {
  var tipos = [];
  for (var col = 0; col < nCols; col++) {
    var nomCol = (encabezado && col < encabezado.length) ? encabezado[col] : '';
    if (esColumnaTextoFijo_(nomCol)) {
      tipos.push('texto');
      continue;
    }

    var valores = [];
    for (var f = 0; f < filas.length; f++) {
      var v = (filas[f][col] || '').trim();
      if (v) valores.push(v);
    }
    if (valores.length === 0) {
      tipos.push('texto');
      continue;
    }
    if (valores.every(function (v) { return intentarFecha_(v) !== null; })) {
      tipos.push('fecha');
      continue;
    }
    if (valores.every(function (v) { return intentarNumero_(v) !== null; })) {
      var tieneDecimales = valores.some(function (v) { return v.indexOf('.') !== -1; });
      tipos.push(tieneDecimales ? 'decimal' : 'entero');
      continue;
    }
    tipos.push('texto');
  }
  return tipos;
}

/**
 * Escribe encabezado + datos en una hoja, con formato. tipoRegistro: 'venta' | 'compra'
 */
function escribirDatosEnHoja_(sheet, contenidoTexto, tipoRegistro) {
  var leido = leerFilas_(contenidoTexto);
  var encabezado = leido.encabezado;
  var filas = leido.filas;
  if (filas.length === 0) throw new Error('El archivo no tiene filas de datos');

  var nCols = filas.reduce(function (max, f) { return Math.max(max, f.length); }, 0);

  if (encabezado === null) {
    var base = tipoRegistro === 'venta' ? COLUMNAS_VENTA_ : COLUMNAS_COMPRA_;
    encabezado = [];
    for (var i = 0; i < nCols; i++) {
      encabezado.push(i < base.length ? base[i] : 'Campo ' + (i + 1));
    }
  } else {
    while (encabezado.length < nCols) encabezado.push('Campo ' + (encabezado.length + 1));
  }

  var tipos = inferirTipos_(encabezado, filas, nCols);

  // Encabezado
  sheet.getRange(1, 1, 1, nCols).setValues([encabezado])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#305496');
  sheet.setFrozenRows(1);

  // Datos: se arma una matriz de valores ya convertidos al tipo correspondiente
  var matriz = [];
  for (var r = 0; r < filas.length; r++) {
    var filaOut = [];
    for (var c = 0; c < nCols; c++) {
      var v = (filas[r][c] || '').trim();
      if (!v) {
        filaOut.push('');
      } else if (tipos[c] === 'fecha') {
        filaOut.push(intentarFecha_(v) || v);
      } else if (tipos[c] === 'decimal' || tipos[c] === 'entero') {
        var n = intentarNumero_(v);
        filaOut.push(n !== null ? n : v);
      } else {
        filaOut.push(v); // texto puro (CAR SUNAT, RUC, etc. nunca se tocan)
      }
    }
    matriz.push(filaOut);
  }

  // Se ordena por Fecha de emision (ascendente, sin fecha al final) para que
  // la hoja quede cronologica por defecto.
  matriz = ordenarPorFechaEmision_(matriz, indiceColumnaFechaEmision_(encabezado));

  if (matriz.length > 0) {
    sheet.getRange(2, 1, matriz.length, nCols).setValues(matriz);
  }

  // Garantizar altura de fila normal (sin wrap) para todas las filas de datos
  if (matriz.length > 0) {
    sheet.setRowHeightsForced(2, matriz.length, 21);
  }

  // Formato numerico/fecha por columna.
  for (var col = 0; col < nCols; col++) {
    var rango = sheet.getRange(2, col + 1, matriz.length, 1);
    if (tipos[col] === 'fecha') rango.setNumberFormat('dd/mm/yyyy');
    else if (tipos[col] === 'decimal') rango.setNumberFormat('#,##0.00');
    else if (tipos[col] === 'entero') rango.setNumberFormat('#,##0');
    else rango.setNumberFormat('@'); // Plain text: evita notación científica y ### en CAR SUNAT/RUC
  }

  // Autofiltro.
  var filtroExistente = sheet.getFilter();
  if (filtroExistente) filtroExistente.remove();
  sheet.getRange(1, 1, matriz.length + 1, nCols).createFilter();

  // Ancho de columna: segun el contenido MAS LARGO de cada columna.
  ajustarAnchoColumnas_(sheet, encabezado, matriz, nCols);

  // Colorear filas de Notas de Credito (07) en rojo claro y Notas de Debito (08) en naranja
  colorearNotasCredito_(sheet, encabezado, matriz.length);
}
