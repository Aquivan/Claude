/**
 * Liquidacion.gs
 * Genera/actualiza una planilla de liquidacion de IGV a partir de los periodos
 * ya descargados en Drive (SIRE Descargas/<RUC>/Venta|Compra/<Anio>/<Mes>/).
 *
 * DISENO: el script SOLO refresca las hojas de detalle ("Detalle Ventas" /
 * "Detalle Compras"). El tablero "Liquidacion" es 100% formulas SUMIFS que
 * viven en la hoja -- para que puedas agregar columnas, cambiar criterios o
 * ajustar parametros sin tocar el codigo.
 *
 * SEPARACION "DEL MES" vs "ANTERIOR": al consolidar se agregan 2 columnas
 * calculadas al final del detalle: "Periodo Emision" (YYYYMM de la fecha de
 * emision) y "Origen" ("Del mes" o "Anterior"). Verificado contra datos reales
 * el 2026-08-11: en COMPRAS es habitual que SUNAT incluya comprobantes de
 * periodos anteriores (en un periodo real llego a ser el 61% de los registros
 * y casi la mitad del monto), por eso el tablero los muestra por separado.
 *
 * IMPORTANTE - LIMITE DE RESPONSABILIDAD: la agregacion de datos (sumas,
 * clasificacion, arrastre mes a mes) es mecanica y verificable. Las REGLAS
 * TRIBUTARIAS (prorrata del credito fiscal, que credito es computable, como
 * se aplican retenciones/percepciones) son criterio del contador: se dejan
 * como parametros y formulas VISIBLES en la hoja "Parametros", no quemadas en
 * el codigo. Cuadra un mes que ya tengas calculado antes de usar esto para una
 * declaracion real.
 */

var MESES_NOMBRE_ = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
  'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'];

var COLUMNAS_CANONICAS_VENTA_ = [
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
  'DAM / CP', 'CLU', 'items_descripcion', 'items_cantidad', 'Link PDF', 'Link XML'
];

var COL_VENTA_ = {
  periodo: 3, fechaEmision: 5,
  biGravada: 15, descuentoBI: 16, igv: 17, descuentoIGV: 18,
  exonerado: 19, inafecto: 20, exportacion: 14, total: 26,
  isc: 21, icbper: 24, otrosTributos: 25,
  totalCols: 44,
};

var COL_COMPRA_ = {
  periodo: 3, fechaEmision: 5,
  biDG: 15, igvDG: 16, biDGNG: 17, igvDGNG: 18, biDNG: 19, igvDNG: 20,
  valorAdqNG: 21, total: 25,
  isc: 22, icbper: 23, otrosTribCargos: 24,
  totalCols: 84,
};

/**
 * Boton para borrar TODOS los valores manuales del tablero de liquidacion:
 * Percepciones, Retenciones, Coeficiente Renta, Y cualquier celda de formula
 * que hayas sobreescrito a mano en otra columna (las que aparecen resaltadas
 * en rojo). Deja todo listo para recalcularse 100% automatico en la proxima
 * vez que corras "Actualizar". NO toca los datos descargados de SUNAT
 * (Detalle Ventas/Compras), ni borra el archivo. Pide confirmacion escrita
 * porque es irreversible.
 */
function menuLimpiarValoresManualesLiquidacion() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Vaciar valores manuales',
    'Esto borra Percepciones, Retenciones, Coeficiente Renta, y CUALQUIER\n' +
    'celda que hayas sobreescrito a mano (las resaltadas en rojo) en TODOS\n' +
    'los meses de la planilla de liquidacion. NO se puede deshacer.\n\n' +
    'Escribe BORRAR para confirmar:',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  if (resp.getResponseText().trim().toUpperCase() !== 'BORRAR') {
    ui.alert('Cancelado (no escribiste "BORRAR" exactamente).');
    return;
  }

  var cfg;
  var ruc;
  try {
    cfg = cargarConfigGitHub_();
    ruc = elegirRucEmpresa_(cfg);
  } catch (e) {
    ui.alert('Error de configuracion', e.message, ui.ButtonSet.OK);
    return;
  }
  if (!ruc) return; // cancelado

  var respAnio = ui.prompt('Anio', 'Anio de la planilla a vaciar (ej: 2026):', ui.ButtonSet.OK_CANCEL);
  if (respAnio.getSelectedButton() !== ui.Button.OK) return;
  var anio = parseInt(respAnio.getResponseText().trim(), 10);
  if (!anio) { ui.alert('Anio invalido.'); return; }

  var raiz = obtenerCarpetaRaiz_();
  var cRuc = obtenerCarpetaRUC_(raiz, ruc);
  var itArchivo = cRuc.getFilesByName('Liquidacion IGV ' + ruc + ' - ' + anio);
  if (!itArchivo.hasNext()) { ui.alert('No existe una planilla de liquidacion ' + anio + ' todavia.'); return; }

  var ss = SpreadsheetApp.open(itArchivo.next());
  var sheet = ss.getSheetByName('Liquidacion');
  if (!sheet) { ui.alert('La hoja "Liquidacion" no existe en ese archivo.'); return; }

  colsManualesLiquidacion_().forEach(function (col) {
    sheet.getRange(2, col, 12, 1).clearContent();
  });

  var overrides = leerOverridesFormula_(ss);
  overrides.forEach(function (o) {
    var col = indiceColumnaPorTitulo_(o.titulo);
    if (col === -1) return;
    sheet.getRange(o.fila, col).clearContent()
      .setBackground(null).setFontColor(null).setFontWeight('normal');
  });

  ui.alert('Listo. Se vaciaron los valores manuales y ' + overrides.length +
    ' ajuste(s) sobreescrito(s) de ' + anio + '.\n\n' +
    'Corre "Actualizar" para que esas celdas vuelvan a mostrar la formula automatica.');
}

function menuGenerarLiquidacion() {
  var ui = SpreadsheetApp.getUi();

  var cfg, ruc;
  try {
    cfg = cargarConfigGitHub_();
    ruc = elegirRucEmpresa_(cfg);
  } catch (e) {
    ui.alert('Error de configuracion', e.message, ui.ButtonSet.OK);
    return;
  }
  if (!ruc) return; // cancelado

  var resp = ui.prompt('Planilla de liquidacion IGV',
    'Anio a procesar para ' + ruc + ' (ej: 2026).\n\n' +
    'Se leeran los periodos que YA hayas IMPORTADO a Drive de ese anio\n' +
    '(menus "4/5/6. Importar resultados"). Si un mes no esta importado,\n' +
    'sale en cero.',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var anio = parseInt(resp.getResponseText().trim(), 10);
  if (!anio || anio < 2000 || anio > 2100) { ui.alert('Anio invalido.'); return; }

  try {
    var url = construirLiquidacion_(ruc, anio);
    ui.alert('Planilla generada',
      'Listo. Se creo/actualizo la planilla de liquidacion ' + anio + '.\n\n' + url +
      '\n\nRevisa la hoja "Parametros" para ajustar prorrata y saldo inicial.',
      ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('ERROR construyendo liquidacion: ' + e.message + '\n' + e.stack);
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}

/** Lee las filas de datos de un periodo ya descargado. Devuelve
 * {encabezado, filas}: encabezado es la fila de titulos real de SUNAT si la
 * hoja traia una (null si no traia), y filas es [] si el periodo no existe. */
function leerDetallePeriodo_(ruc, tipo, anio, mes) {
  var raiz = obtenerCarpetaRaiz_();
  var cRuc = obtenerCarpetaRUC_(raiz, ruc);
  var nombreTipo = tipo === 'venta' ? 'Venta' : 'Compra';

  var itTipo = cRuc.getFoldersByName(nombreTipo);
  if (!itTipo.hasNext()) return { encabezado: null, filas: [] };
  var itAnio = itTipo.next().getFoldersByName(String(anio));
  if (!itAnio.hasNext()) return { encabezado: null, filas: [] };
  var itMes = itAnio.next().getFoldersByName(MESES_CARPETA_[mes - 1]);
  if (!itMes.hasNext()) return { encabezado: null, filas: [] };

  var periodoStr = anio + ('' + mes).padStart(2, '0');
  var itArchivo = itMes.next().getFilesByName(nombreTipo + ' ' + periodoStr);
  if (!itArchivo.hasNext()) return { encabezado: null, filas: [] };

  var ss = SpreadsheetApp.open(itArchivo.next());
  var hojas = ss.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    if (hojas[i].getLastRow() > 1) {
      var rango = hojas[i].getDataRange();
      var valores = rango.getValues();
      // Las columnas "Link PDF"/"Link XML" son formulas HYPERLINK() (asi se
      // ven cortas en la hoja, "Abrir PDF" en vez de la URL completa) --
      // getValues() por si solo devuelve el TEXTO visible ("Abrir PDF"), sin
      // el link. Se pisan esas celdas con su formula real (via getFormulas())
      // para que el link siga funcionando aca tambien; el resto de columnas
      // (sin formula) queda con su valor normal, sin cambios.
      var formulas = rango.getFormulas();
      for (var f = 0; f < valores.length; f++) {
        for (var c = 0; c < valores[f].length; c++) {
          if (formulas[f][c]) valores[f][c] = formulas[f][c];
        }
      }
      // La hoja puede o no tener fila de encabezado: Compras siempre trae la de
      // SUNAT, y Ventas solo cuando es PROPUESTA (periodo no presentado). Se
      // detecta por si la primera celda es numerica (un RUC) o texto ("Ruc").
      // Se limpia el BOM por si quedo pegado de una descarga anterior.
      var primeraCelda = String(valores[0][0]).replace(/^﻿/, '').replace(/^ï»¿/, '').trim();
      var tieneEncabezado = isNaN(Number(primeraCelda)) || primeraCelda === '';
      return {
        encabezado: tieneEncabezado ? valores[0].map(String) : null,
        filas: tieneEncabezado ? valores.slice(1) : valores,
      };
    }
  }
  return { encabezado: null, filas: [] };
}

/** YYYYMM a partir de la fecha de emision (Date o texto dd/mm/yyyy). */
function periodoDeEmision_(valor) {
  if (valor instanceof Date) {
    return valor.getFullYear() + ('' + (valor.getMonth() + 1)).padStart(2, '0');
  }
  var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(valor).trim());
  return m ? (m[3] + m[2]) : '';
}

/**
 * Normaliza nombres de encabezado para comparar sin importar mayúsculas, minúsculas,
 * tildes, BOM o espacios.
 */
function normalizarEncabezado_(s) {
  if (!s) return '';
  return String(s)
    .replace(/^﻿/, '').replace(/^ï»¿/, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();
}

/**
 * Busca el índice de una columna por nombre normalizado (soporta variantes de nombres).
 */
function buscarIndiceColumna_(encabezados, nombreBuscado) {
  if (!encabezados || encabezados.length === 0) return -1;
  var normBuscado = normalizarEncabezado_(nombreBuscado);

  // Coincidencia exacta normalizada
  for (var i = 0; i < encabezados.length; i++) {
    var normActual = normalizarEncabezado_(encabezados[i]);
    if (normActual === normBuscado) return i;
  }

  // Coincidencias por patrones habituales
  for (var i = 0; i < encabezados.length; i++) {
    var normActual = normalizarEncabezado_(encabezados[i]);
    if (normBuscado === 'link pdf' && (normActual === 'link pdf' || normActual === 'link_pdf' || normActual === 'pdf link')) return i;
    if (normBuscado === 'link xml' && (normActual === 'link xml' || normActual === 'link_xml' || normActual === 'xml link')) return i;
    if (normBuscado === 'items_descripcion' && (normActual === 'items_descripcion' || normActual === 'items descripcion' || normActual.indexOf('descripcion') !== -1)) return i;
    if (normBuscado === 'items_cantidad' && (normActual === 'items_cantidad' || normActual === 'items cantidad' || normActual.indexOf('cantidad') !== -1)) return i;
    if (normBuscado === 'fecha de emision' && (normActual.indexOf('fecha') !== -1 && normActual.indexOf('emision') !== -1 && normActual.indexOf('modific') === -1)) return i;
    if (normBuscado === 'periodo' && normActual === 'periodo') return i;
    if (normBuscado === 'clu' && (normActual === 'clu' || normActual === 'clu39')) return i;
  }

  return -1;
}

/** Convierte una URL a una fórmula HYPERLINK limpia y clickeable. */
function formatearLinkCorto_(val, textoVisible) {
  if (!val) return '';
  var s = String(val).trim();
  if (s.indexOf('=HYPERLINK(') === 0) return s;
  if (/^https?:\/\//i.test(s)) {
    return '=HYPERLINK("' + s + '", "' + textoVisible + '")';
  }
  return s;
}

/** Consolida todos los meses del anio alineando 100% las columnas por su nombre de encabezado. */
function consolidarDetalle_(ruc, tipo, anio, cols) {
  var filas = [];
  var esVenta = (tipo === 'venta');
  var listaCanonicos = esVenta ? COLUMNAS_CANONICAS_VENTA_.slice() : [];

  var periodosLeidos = [];
  var encabezadoSUNATCompras = null;

  for (var mes = 1; mes <= 12; mes++) {
    var periodo = leerDetallePeriodo_(ruc, tipo, anio, mes);
    if (periodo.filas.length > 0) {
      periodosLeidos.push({ mes: mes, periodo: periodo });
      if (!esVenta && !encabezadoSUNATCompras && periodo.encabezado) {
        encabezadoSUNATCompras = periodo.encabezado;
      }
    }
  }

  if (!esVenta) {
    if (encabezadoSUNATCompras) {
      var baseEnc = [];
      for (var i = 0; i < encabezadoSUNATCompras.length; i++) {
        var h = normalizarEncabezado_(encabezadoSUNATCompras[i]);
        if (h !== 'link pdf' && h !== 'link xml' && h !== 'items_descripcion' && h !== 'items_cantidad' && h !== 'periodo emision' && h !== 'origen') {
          baseEnc.push(encabezadoSUNATCompras[i]);
        }
      }
      listaCanonicos = baseEnc.concat(['items_descripcion', 'items_cantidad', 'Link PDF', 'Link XML']);
    } else {
      listaCanonicos = [];
      for (var i = 1; i <= 80; i++) listaCanonicos.push('Campo ' + i);
      listaCanonicos.push('items_descripcion', 'items_cantidad', 'Link PDF', 'Link XML');
    }
  }

  periodosLeidos.forEach(function (item) {
    var mes = item.mes;
    var periodo = item.periodo;
    var datos = periodo.filas;
    var encMes = periodo.encabezado;
    Logger.log(tipo + ' ' + anio + '-' + mes + ': ' + datos.length + ' filas');

    var indicesMapeo = listaCanonicos.map(function (colName) {
      return encMes ? buscarIndiceColumna_(encMes, colName) : -1;
    });

    var idxPeriodo = encMes ? buscarIndiceColumna_(encMes, 'Periodo') : (cols.periodo - 1);
    var idxFecha = encMes ? buscarIndiceColumna_(encMes, 'Fecha de emision') : (cols.fechaEmision - 1);

    datos.forEach(function (fila) {
      var filaAlineada = [];
      for (var c = 0; c < listaCanonicos.length; c++) {
        var idx = indicesMapeo[c];
        var val = (idx !== -1 && idx < fila.length) ? fila[idx] : '';

        if (idx === -1 && !encMes && c < fila.length) {
          val = fila[c];
        }

        var nombreCol = listaCanonicos[c];
        if (nombreCol === 'Link PDF') {
          val = formatearLinkCorto_(val, 'Abrir PDF');
        } else if (nombreCol === 'Link XML') {
          val = formatearLinkCorto_(val, 'Abrir XML');
        }
        filaAlineada.push(val);
      }

      var periodoDeclarado = (idxPeriodo !== -1 && idxPeriodo < fila.length)
        ? String(fila[idxPeriodo]).trim() : String(filaAlineada[cols.periodo - 1] || '').trim();
      var fechaEmisionVal = (idxFecha !== -1 && idxFecha < fila.length)
        ? fila[idxFecha] : filaAlineada[cols.fechaEmision - 1];
      var perEmision = periodoDeEmision_(fechaEmisionVal);
      var origen = (perEmision && perEmision !== periodoDeclarado) ? 'Anterior' : 'Del mes';

      filas.push(filaAlineada.concat([perEmision, origen]));
    });
  });

  return {
    encabezado: listaCanonicos.concat(['Periodo Emision', 'Origen']),
    filas: filas
  };
}

/**
 * Separador de argumentos que Google Sheets espera al ESCRIBIR formulas por
 * codigo con Range.setValues()/setFormula(): depende de la configuracion
 * regional del documento (Archivo > Configuracion), NO del idioma de la
 * interfaz. La mayoria de locales en espanol (incluido es-PE / es-419) usan
 * punto y coma (;) porque la coma es el separador decimal; los locales en
 * ingles usan coma (,). Escribir el separador equivocado hace que Sheets
 * muestre #ERROR! en la celda entera, sin detalle util del error.
 */
function separadorFormula_(ss) {
  var target = ss || SpreadsheetApp.getActiveSpreadsheet();
  var locale = target ? (target.getSpreadsheetLocale() || '') : '';
  return /^en/i.test(locale) ? ',' : ';';
}

function letraColumna_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function obtenerMapeoColumnasHoja_(sheet) {
  var mapeo = {};
  if (!sheet || sheet.getLastColumn() < 1) return mapeo;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    var h = normalizarEncabezado_(headers[i]);
    if (h) mapeo[h] = i + 1;
  }
  return mapeo;
}

function buscarLetraColumnaPorPatron_(mapeo, patrones, colDefault) {
  for (var p = 0; p < patrones.length; p++) {
    var normP = normalizarEncabezado_(patrones[p]);
    if (mapeo[normP]) return letraColumna_(mapeo[normP]);
    for (var k in mapeo) {
      if (k.indexOf(normP) !== -1) {
        return letraColumna_(mapeo[k]);
      }
    }
  }
  return letraColumna_(colDefault);
}

function construirLiquidacion_(ruc, anio) {
  var raiz = obtenerCarpetaRaiz_();
  var cRuc = obtenerCarpetaRUC_(raiz, ruc);
  var nombreArchivo = 'Liquidacion IGV ' + ruc + ' - ' + anio;
  var ss = obtenerOCrearSpreadsheetEnCarpeta_(cRuc, nombreArchivo);

  var ventas = consolidarDetalle_(ruc, 'venta', anio, COL_VENTA_);
  var compras = consolidarDetalle_(ruc, 'compra', anio, COL_COMPRA_);
  Logger.log('Consolidado: ventas=' + ventas.filas.length + ' compras=' + compras.filas.length);

  if (ventas.filas.length === 0 && compras.filas.length === 0) {
    throw new Error('No se encontraron periodos descargados de ' + anio +
      '. Descarga primero con el menu "SIRE SUNAT".');
  }

  escribirDetalle_(ss, 'Detalle Ventas', ventas.filas, ventas.encabezado);
  escribirDetalle_(ss, 'Detalle Compras', compras.filas, compras.encabezado);
  escribirParametros_(ss);
  escribirTablero_(ss, anio);
  limpiarHojasVacias_(ss);
  return ss.getUrl();
}

function escribirDetalle_(ss, nombreHoja, filas, encabezado) {
  var sheet = obtenerOCrearHoja_(ss, nombreHoja);
  if (filas.length === 0) {
    sheet.getRange(1, 1).setValue('(sin datos descargados para este anio)');
    return;
  }

  sheet.clearContents();
  sheet.clearFormats();

  var nCols = encabezado.length;

  var idxFecha = indiceColumnaFechaEmision_(encabezado);
  if (idxFecha !== -1) {
    filas = ordenarPorFechaEmision_(filas, idxFecha);
  }

  sheet.getRange(1, 1, 1, nCols).setValues([encabezado])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#305496');
  sheet.setFrozenRows(1);
  sheet.getRange(2, 1, filas.length, nCols).setValues(filas);

  // --- Eliminar columnas CLU / de relleno completamente vacias ---
  // Solo se eliminan columnas secundarias de relleno (CLU1..CLU39 o Campo XX)
  // que esten completamente vacias, para no tocar columnas tributarias estandares.
  for (var c = nCols; c >= 1; c--) {
    if (c > sheet.getLastColumn()) continue;
    var nombreCol = normalizarEncabezado_(encabezado[c - 1]);
    var esColumnaRelleno = (nombreCol.indexOf('clu') === 0 || nombreCol.indexOf('campo ') === 0);
    if (!esColumnaRelleno) continue;

    var rangoCol = sheet.getRange(2, c, filas.length, 1).getValues();
    var tieneAlgo = rangoCol.some(function (celda) {
      var v = String(celda[0] || '').trim();
      return v !== '' && v !== '0';
    });
    if (!tieneAlgo) {
      sheet.deleteColumn(c);
    }
  }

  // Recalcular nCols y encabezado real tras eliminar columnas
  var nColsFinal = sheet.getLastColumn();
  var encFinal = sheet.getRange(1, 1, 1, nColsFinal).getValues()[0];

  var filtroExistente = sheet.getFilter();
  if (filtroExistente) filtroExistente.remove();
  sheet.getRange(1, 1, filas.length + 1, nColsFinal).createFilter();

  formatearColumnasFecha_(sheet, filas, nColsFinal);
  ajustarAnchoColumnasDetalle_(sheet, encFinal, filas);

  // --- Colorear filas de Notas de Credito en rojo claro ---
  colorearNotasCredito_(sheet, encFinal, filas.length);
}

/**
 * Pinta de rojo claro todas las filas cuya columna "Tipo CP/Doc." contenga
 * un codigo de Nota de Credito (07) o Nota de Debito (08) de SUNAT.
 * Funciona tanto en hojas mensuales como en "Detalle Ventas/Compras".
 */
function colorearNotasCredito_(sheet, encabezado, nFilasDatos) {
  if (!nFilasDatos || nFilasDatos <= 0 || !encabezado || encabezado.length === 0) return;

  // Buscar la columna "Tipo CP/Doc." o variantes
  var idxTipo = -1;
  for (var i = 0; i < encabezado.length; i++) {
    var h = String(encabezado[i] || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    if (h.indexOf('tipo') !== -1 && (h.indexOf('cp') !== -1 || h.indexOf('doc') !== -1 || h.indexOf('comprobante') !== -1 || h.indexOf('cdp') !== -1)) {
      idxTipo = i;
      break;
    }
  }
  if (idxTipo === -1) {
    for (var j = 0; j < encabezado.length; j++) {
      var h2 = String(encabezado[j] || '').trim().toLowerCase();
      if (h2 === 'tipo' || h2 === 'tipo_cp' || h2 === 'tipocp') {
        idxTipo = j;
        break;
      }
    }
  }
  if (idxTipo === -1) return;

  var nCols = sheet.getLastColumn();
  if (nCols < 1) nCols = encabezado.length;

  var valoresCol = sheet.getRange(2, idxTipo + 1, nFilasDatos, 1).getValues();
  for (var r = 0; r < valoresCol.length; r++) {
    var raw = valoresCol[r][0];
    var str = String(raw === null || raw === undefined ? '' : raw).trim();
    var num = parseInt(str, 10);

    // Nota de Credito: codigo 07, 7 o palabra credito
    if (str === '07' || str === '7' || num === 7 || str.toLowerCase().indexOf('credito') !== -1) {
      sheet.getRange(r + 2, 1, 1, nCols).setBackground('#FFCDD2'); // rojo claro suave y visible
    }
    // Nota de Debito: codigo 08, 8 o palabra debito
    else if (str === '08' || str === '8' || num === 8 || str.toLowerCase().indexOf('debito') !== -1) {
      sheet.getRange(r + 2, 1, 1, nCols).setBackground('#FFE0B2'); // naranja claro
    }
  }
}

function ajustarAnchoColumnasDetalle_(sheet, encabezado, filas) {
  var PATRON_TEXTO_LARGO = ['razon social', 'raz. social', 'nombre', 'denominaci'];
  var muestra = filas.slice(0, 30);
  for (var col = 0; col < encabezado.length; col++) {
    var nombre = normalizarEncabezado_(encabezado[col]);
    var colNum = col + 1;

    if (nombre.indexOf('car') !== -1) {
      sheet.setColumnWidth(colNum, 240);
    } else if (nombre.indexOf('items_descripcion') !== -1) {
      sheet.setColumnWidth(colNum, 220);
    } else if (nombre === 'link pdf' || nombre === 'link xml') {
      sheet.setColumnWidth(colNum, 90);
    } else if (nombre.indexOf('items_cantidad') !== -1) {
      sheet.setColumnWidth(colNum, 100);
    } else if (nombre === 'periodo emision' || nombre === 'origen') {
      sheet.setColumnWidth(colNum, 88);
    } else {
      var maxLen = 0;
      for (var r = 0; r < muestra.length; r++) {
        var v = muestra[r][col];
        var len = v instanceof Date ? 10 : String(v === null || v === undefined ? '' : v).length;
        if (len > maxLen) maxLen = len;
      }
      var esLargo = PATRON_TEXTO_LARGO.some(function (p) { return nombre.indexOf(p) !== -1; });
      var px = (maxLen + 2) * 7.3;
      if (esLargo) {
        px = Math.min(Math.max(px, 200), 330);
      } else {
        px = Math.min(Math.max(px, 55), 220);
      }
      sheet.setColumnWidth(colNum, Math.round(px));
    }
  }
}

/** Aplica formato por tipo a cada columna del detalle consolidado */
function formatearColumnasFecha_(sheet, filas, nCols) {
  if (filas.length === 0) return;
  var encabezado = sheet.getRange(1, 1, 1, nCols).getValues()[0];

  for (var c = 0; c < nCols; c++) {
    var nomCol = normalizarEncabezado_(encabezado[c]);
    var rango = sheet.getRange(2, c + 1, filas.length, 1);

    if (nomCol.indexOf('fecha') !== -1) {
      rango.setNumberFormat('dd/mm/yyyy');
    } else if (nomCol.indexOf('bi ') === 0 || nomCol.indexOf('igv') === 0 || nomCol.indexOf('mto') === 0 ||
      nomCol.indexOf('valor') === 0 || nomCol.indexOf('total') !== -1 || nomCol.indexOf('dscto') !== -1 ||
      nomCol.indexOf('isc') !== -1 || nomCol.indexOf('icbper') !== -1 || nomCol.indexOf('ivap') !== -1) {
      rango.setNumberFormat('#,##0.00');
    } else if (nomCol.indexOf('car') !== -1 || nomCol.indexOf('ruc') !== -1 || nomCol.indexOf('serie') !== -1 ||
      nomCol.indexOf('nro') !== -1 || nomCol.indexOf('tipo') !== -1 || nomCol.indexOf('periodo') !== -1) {
      rango.setNumberFormat('@'); // Plain text para evitar ###
    } else {
      rango.setNumberFormat('General');
    }
  }
}

// Filas de Parametros que son valores editables por el usuario (no texto fijo
// ni notas) -- se preservan al refrescar, igual que en el tablero Liquidacion.
var FILAS_PARAMETROS_EDITABLES_ = [3, 4, 5];

/** Lee B3:B5 de Parametros si la hoja ya existe, para no perderlos al
 * refrescar. Devuelve null si la hoja no existe todavia (primera vez). */
function leerParametrosPrevios_(ss) {
  var sheet = ss.getSheetByName('Parametros');
  if (!sheet || sheet.getLastRow() < 5) return null;
  var valores = {};
  FILAS_PARAMETROS_EDITABLES_.forEach(function (fila) {
    valores[fila] = sheet.getRange(fila, 2).getValue();
  });
  return valores;
}

function restaurarParametros_(sheet, valores) {
  if (!valores) return;
  FILAS_PARAMETROS_EDITABLES_.forEach(function (fila) {
    sheet.getRange(fila, 2).setValue(valores[fila]);
  });
}

function escribirParametros_(ss) {
  var valoresPrevios = leerParametrosPrevios_(ss);
  var sheet = obtenerOCrearHoja_(ss, 'Parametros');
  var datos = [
    ['PARAMETROS DE LA LIQUIDACION', ''],
    ['', ''],
    ['Saldo a favor de IGV al inicio del anio', 0],
    ['% de credito fiscal computable sobre compras DGNG (prorrata)', 1],
    ['Saldo de Percepciones/Retenciones NO aplicadas al inicio del anio', 0],
    ['', ''],
    ['NOTAS:', ''],
    ['- El "% prorrata" aplica solo a las compras DGNG (destinadas a operaciones', ''],
    ['  gravadas Y no gravadas a la vez). 1 = 100% computable. Ajustalo segun tu', ''],
    ['  calculo de prorrata. Las compras DNG (no gravadas) NO dan credito fiscal', ''],
    ['  y por eso el tablero las muestra aparte, sin sumarlas al credito.', ''],
    ['- El credito de compras DG se toma al 100%.', ''],
    ['- Las columnas de Percepciones y Retenciones del tablero son de CARGA MANUAL:', ''],
    ['  escribelas cada mes y el saldo a pagar se recalcula solo.', ''],
    ['- Si en un mes no se puede aplicar toda la percepcion/retencion (porque no', ''],
    ['  hay suficiente IGV resultante ese mes), el saldo sobrante SE ARRASTRA', ''],
    ['  automaticamente al mes siguiente (igual que el saldo a favor de IGV).', ''],
    ['- Estas formulas son visibles y editables. Si tu criterio tributario es otro,', ''],
    ['  cambialas directamente en la hoja "Liquidacion".', ''],
  ];
  sheet.getRange(1, 1, datos.length, 2).setValues(datos);

  // Se restauran los valores que ya habias puesto (saldo inicial de IGV,
  // prorrata, saldo inicial de percep/retenc) -- de lo contrario, cada vez
  // que se actualiza la liquidacion volverian a los defaults (0, 100%, 0).
  restaurarParametros_(sheet, valoresPrevios);

  sheet.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  sheet.getRange(3, 2, 3, 1).setBackground('#FFF2CC').setBorder(true, true, true, true, false, false);
  sheet.getRange(4, 2).setNumberFormat('0.00%');
  sheet.getRange(3, 2).setNumberFormat('#,##0.00');
  sheet.getRange(5, 2).setNumberFormat('#,##0.00');
  sheet.setColumnWidth(1, 430);
  sheet.setColumnWidth(2, 110);
}

/**
 * Definicion de columnas del tablero "Liquidacion", EN ORDEN, con nombre
 * simbolico ("clave") y grupo visual. Las formulas de cada fila se arman
 * referenciando estas claves (ver LETRA_ en escribirTablero_) en vez de
 * escribir letras de columna a mano -- asi, si se agrega/quita una columna,
 * no hay que volver a contar ni corregir formulas por todos lados.
 *
 * grupo: 'label' | 'venta' | 'compra' | 'igv' | 'percep' | 'renta'
 * (se usa para pintar la cabecera de cada bloque con un color distinto).
 */
var COLUMNAS_TABLERO_ = [
  { clave: 'mes', titulo: 'Mes', grupo: 'label' },
  { clave: 'periodo', titulo: 'Periodo', grupo: 'label' },
  { clave: 'ventaGravDelMes', titulo: 'Venta Gravada (del mes)', grupo: 'venta' },
  { clave: 'ventaGravAnt', titulo: 'Venta Gravada (anteriores)', grupo: 'venta' },
  { clave: 'ventaGravTotal', titulo: 'Venta Gravada TOTAL', grupo: 'venta' },
  { clave: 'debitoDelMes', titulo: 'Debito Fiscal (del mes)', grupo: 'venta' },
  { clave: 'debitoAnt', titulo: 'Debito Fiscal (anteriores)', grupo: 'venta' },
  { clave: 'debitoTotal', titulo: 'Debito Fiscal TOTAL', grupo: 'venta' },
  { clave: 'ventaNoGravDelMes', titulo: 'Venta No Gravada (del mes)', grupo: 'venta' },
  { clave: 'ventaNoGravAnt', titulo: 'Venta No Gravada (anteriores)', grupo: 'venta' },
  { clave: 'ventaNoGravTotal', titulo: 'Venta No Gravada TOTAL', grupo: 'venta' },
  { clave: 'ventaOtrosCargos', titulo: 'Otros Cargos Venta (ISC+ICBPER+Otros)', grupo: 'venta' },
  { clave: 'precioVenta', titulo: 'Precio Venta', grupo: 'venta' },
  { clave: 'compraDgDelMes', titulo: 'Compra DG (del mes)', grupo: 'compra' },
  { clave: 'compraDgAnt', titulo: 'Compra DG (anteriores)', grupo: 'compra' },
  { clave: 'compraDgTotal', titulo: 'Compra DG TOTAL', grupo: 'compra' },
  { clave: 'creditoDgDelMes', titulo: 'Credito Fiscal DG (del mes)', grupo: 'compra' },
  { clave: 'creditoDgAnt', titulo: 'Credito Fiscal DG (anteriores)', grupo: 'compra' },
  { clave: 'creditoDgTotal', titulo: 'Credito Fiscal DG TOTAL', grupo: 'compra' },
  { clave: 'compraDgng', titulo: 'Compra DGNG', grupo: 'compra' },
  { clave: 'igvDgng', titulo: 'IGV DGNG', grupo: 'compra' },
  { clave: 'compraDng', titulo: 'Compra DNG (sin credito)', grupo: 'compra' },
  { clave: 'igvDng', titulo: 'IGV DNG (sin credito)', grupo: 'compra' },
  { clave: 'compraNoGravDelMes', titulo: 'Compra No Gravada (del mes)', grupo: 'compra' },
  { clave: 'compraNoGravAnt', titulo: 'Compra No Gravada (anteriores)', grupo: 'compra' },
  { clave: 'compraNoGravTotal', titulo: 'Compra No Gravada TOTAL', grupo: 'compra' },
  { clave: 'compraOtrosCargos', titulo: 'Otros Cargos Compra (ISC+ICBPER+Otros)', grupo: 'compra' },
  { clave: 'precioCompra', titulo: 'Precio Compra', grupo: 'compra' },
  { clave: 'igvResultante', titulo: 'IGV Resultante', grupo: 'igv' },
  { clave: 'saldoAnt', titulo: 'Saldo a favor mes anterior', grupo: 'igv' },
  { clave: 'igvAcumulado', titulo: 'IGV acumulado', grupo: 'igv' },
  { clave: 'percepciones', titulo: 'Percepciones del mes', grupo: 'percep' },
  { clave: 'retenciones', titulo: 'Retenciones del mes', grupo: 'percep' },
  { clave: 'igvAPagar', titulo: 'IGV A PAGAR', grupo: 'percep' },
  { clave: 'saldoArrastrar', titulo: 'Saldo a favor a arrastrar', grupo: 'percep' },
  { clave: 'percepRetencArrastre', titulo: 'Percep/Retenc arrastradas (mes anterior)', grupo: 'percep' },
  { clave: 'saldoPercepRetencArrastrar', titulo: 'Saldo Percep/Retenc a arrastrar', grupo: 'percep' },
  { clave: 'ingresoNeto', titulo: 'Ingreso Neto (Vta Grav. + No Grav.)', grupo: 'renta' },
  { clave: 'coeficienteRenta', titulo: 'Coeficiente Renta', grupo: 'renta' },
  { clave: 'pagoACuentaRenta', titulo: 'Pago a Cuenta Renta', grupo: 'renta' },
];

// Color de fondo de la cabecera por grupo (letra blanca en todos).
var COLOR_GRUPO_ = {
  label: '#434343', venta: '#1155CC', compra: '#38761D',
  igv: '#674EA7', percep: '#B45F06', renta: '#A64D79',
};

// Version suave (pastel) de COLOR_GRUPO_, para pintar de fondo SOLO las
// columnas "importantes" de cada grupo (ver COLUMNAS_IMPORTANTES_ abajo) --
// no todo el bloque, para que el resaltado se note y no se vea cargado.
var COLOR_GRUPO_SUAVE_ = {
  label: null, venta: '#EAF1FE', compra: '#EAF7EE',
  igv: '#F2EAFB', percep: '#FDF1E6', renta: '#FBEAF1',
};

// Columnas que se consideran "principales" de cada grupo -- las que resumen
// o concluyen un bloque (TOTALES y resultados), no cada columna del detalle
// (del mes/anteriores). Son las unicas que llevan el fondo suave de
// COLOR_GRUPO_SUAVE_. IGV A PAGAR y Pago a Cuenta Renta no estan aca porque
// ya tienen su propio color bien distintivo (ver mas abajo en escribirTablero_).
var COLUMNAS_IMPORTANTES_ = [
  'ventaGravTotal', 'debitoTotal', 'ventaNoGravTotal', 'precioVenta',
  'compraDgTotal', 'creditoDgTotal', 'compraNoGravTotal', 'precioCompra',
  'igvResultante',
];

/** Indice de columna (1-indexado) de una clave. Lanza error si no existe
 * (para detectar typos de inmediato en vez de fallar silenciosamente). */
function indiceColumna_(clave) {
  for (var i = 0; i < COLUMNAS_TABLERO_.length; i++) {
    if (COLUMNAS_TABLERO_[i].clave === clave) return i + 1;
  }
  throw new Error('Clave de columna desconocida: ' + clave);
}

// Columnas de entrada MANUAL PURA (nunca tienen formula, son simples casillas
// para escribir). Son funciones (no un array fijo) para no depender del
// orden en que Apps Script cargue los archivos del proyecto.
function colsManualesLiquidacion_() {
  return ['percepciones', 'retenciones', 'coeficienteRenta'].map(indiceColumna_);
}

// Titulos (NO numero de columna -- ver nota mas abajo) que NUNCA se tratan
// como "override manual" aunque no tengan formula: etiquetas, las de entrada
// manual pura (arriba), y el arrastre interno mes a mes (saldo IGV y saldo
// percep/retenc) -- sobreescribirlas ahi rompe la cadena de arrastre; mejor
// ajustar en la columna de origen si hace falta (ej. Debito Fiscal).
function titulosSinOverride_() {
  return ['mes', 'periodo', 'percepciones', 'retenciones', 'coeficienteRenta',
    'saldoAnt', 'igvAcumulado', 'saldoArrastrar', 'percepRetencArrastre',
    'saldoPercepRetencArrastrar'].map(function (clave) {
      var col = COLUMNAS_TABLERO_.filter(function (c) { return c.clave === clave; })[0];
      return col ? col.titulo : null;
    });
}

/** Indice de columna (1-indexado) a partir del TITULO visible. -1 si esa
 * columna ya no existe en COLUMNAS_TABLERO_ (se elimino del codigo). */
function indiceColumnaPorTitulo_(titulo) {
  for (var i = 0; i < COLUMNAS_TABLERO_.length; i++) {
    if (COLUMNAS_TABLERO_[i].titulo === titulo) return i + 1;
  }
  return -1;
}

// Color con el que se resalta cualquier celda de formula que el usuario haya
// sobreescrito a mano (ver leerOverridesFormula_ / aplicarOverridesFormula_).
var COLOR_OVERRIDE_FONDO_ = '#CC0000';
var COLOR_OVERRIDE_TEXTO_ = '#FFFFFF';

/**
 * Recorre el tablero actual (antes de que se borre y reescriba) y detecta
 * cualquier celda de formula donde el usuario escribio un valor a mano
 * encima (getFormula() vacio = ya no es formula). Se usa para 2 cosas: no
 * perder ese valor al refrescar, y resaltarlo despues con un color llamativo
 * para que sea facil ver a simple vista que celdas se tocaron a mano.
 *
 * IMPORTANTE: guarda el TITULO de la columna (no el numero de columna). Si
 * se guardara por numero, agregar/quitar una columna en COLUMNAS_TABLERO_
 * (como paso con "Credito Fiscal computable") corre todo lo de despues una
 * posicion y los overrides quedan pegados en la celda equivocada -- eso fue
 * justamente el bug reportado ("ya no se resalta lo modificado").
 */
function leerOverridesFormula_(ss) {
  var sheet = ss.getSheetByName('Liquidacion');
  if (!sheet || sheet.getLastRow() < 2) return [];
  var ultimaCol = sheet.getLastColumn();
  var encabezados = sheet.getRange(1, 1, 1, ultimaCol).getValues()[0];
  var sinOverride = titulosSinOverride_();
  var overrides = [];
  for (var fila = 2; fila <= 13; fila++) {
    for (var col = 3; col <= ultimaCol; col++) {
      var titulo = encabezados[col - 1];
      if (sinOverride.indexOf(titulo) !== -1) continue;
      var celda = sheet.getRange(fila, col);
      var formula = celda.getFormula();
      var valor = celda.getValue();
      if (formula === '' && String(valor) !== '') {
        overrides.push({ fila: fila, titulo: titulo, valor: valor });
      }
    }
  }
  return overrides;
}

/** Vuelve a poner los valores manuales sobre las formulas recien escritas
 * (buscando la columna por TITULO, no por numero -- ver nota arriba), y los
 * resalta con COLOR_OVERRIDE_FONDO_/COLOR_OVERRIDE_TEXTO_. Si una columna ya
 * no existe (se elimino del codigo), ese override en particular se descarta
 * en silencio -- ya no hay donde ponerlo. */
function aplicarOverridesFormula_(sheet, overrides) {
  overrides.forEach(function (o) {
    var col = indiceColumnaPorTitulo_(o.titulo);
    if (col === -1) return;
    sheet.getRange(o.fila, col)
      .setValue(o.valor)
      .setBackground(COLOR_OVERRIDE_FONDO_)
      .setFontColor(COLOR_OVERRIDE_TEXTO_)
      .setFontWeight('bold');
  });
}

/** Lee los valores actuales de las columnas manuales del tablero (filas 2-13),
 * para poder restaurarlos despues de que escribirTablero_ vuelva a escribir
 * todas las formulas desde cero. Si la hoja no existe aun, devuelve null. */
function leerValoresManuales_(ss) {
  var sheet = ss.getSheetByName('Liquidacion');
  if (!sheet || sheet.getLastRow() < 2) return null;
  var valores = {};
  colsManualesLiquidacion_().forEach(function (col) {
    valores[col] = sheet.getRange(2, col, 12, 1).getValues();
  });
  return valores;
}

/** Vuelve a escribir los valores manuales guardados por leerValoresManuales_. */
function restaurarValoresManuales_(sheet, valores) {
  if (!valores) return;
  colsManualesLiquidacion_().forEach(function (col) {
    sheet.getRange(2, col, 12, 1).setValues(valores[col]);
  });
}

function escribirTablero_(ss, anio) {
  var valoresManualesPrevios = leerValoresManuales_(ss);
  var overridesPrevios = leerOverridesFormula_(ss);
  var sheet = obtenerOCrearHoja_(ss, 'Liquidacion');
  sheet.clearContents();
  sheet.clearFormats();

  var DV = "'Detalle Ventas'!";
  var DC = "'Detalle Compras'!";

  var sheetDV = ss.getSheetByName('Detalle Ventas');
  var sheetDC = ss.getSheetByName('Detalle Compras');

  var mapeoDV = obtenerMapeoColumnasHoja_(sheetDV);
  var mapeoDC = obtenerMapeoColumnasHoja_(sheetDC);

  // Mapeo dinamico de letras de columna en Detalle Ventas
  var letV = {
    periodo: buscarLetraColumnaPorPatron_(mapeoDV, ['periodo'], 3),
    origen: buscarLetraColumnaPorPatron_(mapeoDV, ['origen'], sheetDV ? sheetDV.getLastColumn() : 46),
    biGravada: buscarLetraColumnaPorPatron_(mapeoDV, ['bi gravada', 'base imponible gravada'], 15),
    descuentoBI: buscarLetraColumnaPorPatron_(mapeoDV, ['dscto bi', 'descuento bi'], 16),
    igv: buscarLetraColumnaPorPatron_(mapeoDV, ['igv / ipm', 'igv'], 17),
    descuentoIGV: buscarLetraColumnaPorPatron_(mapeoDV, ['dscto igv', 'descuento igv'], 18),
    exonerado: buscarLetraColumnaPorPatron_(mapeoDV, ['mto exonerado', 'monto exonerado', 'exonerado'], 19),
    inafecto: buscarLetraColumnaPorPatron_(mapeoDV, ['mto inafecto', 'monto inafecto', 'inafecto'], 20),
    exportacion: buscarLetraColumnaPorPatron_(mapeoDV, ['valor facturado exportacion', 'exportacion'], 14),
    isc: buscarLetraColumnaPorPatron_(mapeoDV, ['isc'], 21),
    icbper: buscarLetraColumnaPorPatron_(mapeoDV, ['icbper'], 24),
    otrosTributos: buscarLetraColumnaPorPatron_(mapeoDV, ['otros tributos', 'otros cargos', 'otros'], 25),
  };

  // Mapeo dinamico de letras de columna en Detalle Compras
  var letC = {
    periodo: buscarLetraColumnaPorPatron_(mapeoDC, ['periodo'], 3),
    origen: buscarLetraColumnaPorPatron_(mapeoDC, ['origen'], sheetDC ? sheetDC.getLastColumn() : 46),
    biDG: buscarLetraColumnaPorPatron_(mapeoDC, ['bi gravado dg', 'bi gravada dg', 'bi dg'], 15),
    igvDG: buscarLetraColumnaPorPatron_(mapeoDC, ['igv / ipm dg', 'igv dg'], 16),
    biDGNG: buscarLetraColumnaPorPatron_(mapeoDC, ['bi gravado dgng', 'bi dgng'], 17),
    igvDGNG: buscarLetraColumnaPorPatron_(mapeoDC, ['igv / ipm dgng', 'igv dgng'], 18),
    biDNG: buscarLetraColumnaPorPatron_(mapeoDC, ['bi gravado dng', 'bi dng'], 19),
    igvDNG: buscarLetraColumnaPorPatron_(mapeoDC, ['igv / ipm dng', 'igv dng'], 20),
    valorAdqNG: buscarLetraColumnaPorPatron_(mapeoDC, ['valor adq. ng', 'valor adq ng', 'no gravada'], 21),
    isc: buscarLetraColumnaPorPatron_(mapeoDC, ['isc'], 22),
    icbper: buscarLetraColumnaPorPatron_(mapeoDC, ['icbper'], 23),
    otrosTribCargos: buscarLetraColumnaPorPatron_(mapeoDC, ['otros trib/ cargos', 'otros trib', 'otros cargos'], 24),
  };

  var LETRA = {};
  COLUMNAS_TABLERO_.forEach(function (c, i) { LETRA[c.clave] = letraColumna_(i + 1); });

  var S = separadorFormula_(ss);

  function sumaV(colLetra, origen) {
    var base = 'SUMIFS(' + DV + '$' + colLetra + ':$' + colLetra +
      S + DV + '$' + letV.periodo + ':$' + letV.periodo + S + '$B{R}';
    if (origen) base += S + DV + '$' + letV.origen + ':$' + letV.origen + S + '"' + origen + '"';
    return base + ')';
  }
  function sumaC(colLetra, origen) {
    var base = 'SUMIFS(' + DC + '$' + colLetra + ':$' + colLetra +
      S + DC + '$' + letC.periodo + ':$' + letC.periodo + S + '$B{R}';
    if (origen) base += S + DC + '$' + letC.origen + ':$' + letC.origen + S + '"' + origen + '"';
    return base + ')';
  }

  var encabezado = COLUMNAS_TABLERO_.map(function (c) { return c.titulo; });

  sheet.getRange(1, 1, 1, encabezado.length).setValues([encabezado])
    .setFontWeight('bold').setFontColor('#FFFFFF')
    .setWrap(true).setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  var grupoActual = null, inicioGrupo = 1;
  for (var gi = 0; gi <= COLUMNAS_TABLERO_.length; gi++) {
    var grupo = gi < COLUMNAS_TABLERO_.length ? COLUMNAS_TABLERO_[gi].grupo : null;
    if (grupo !== grupoActual) {
      if (grupoActual !== null) {
        sheet.getRange(1, inicioGrupo, 1, gi - inicioGrupo + 1).setBackground(COLOR_GRUPO_[grupoActual]);
      }
      grupoActual = grupo;
      inicioGrupo = gi + 1;
    }
  }

  var filas = [];
  for (var m = 1; m <= 12; m++) {
    var r = m + 1;
    var per = anio + ('' + m).padStart(2, '0');
    function fv(colLetra, origen) { return sumaV(colLetra, origen).replace(/\{R\}/g, r); }
    function fc(colLetra, origen) { return sumaC(colLetra, origen).replace(/\{R\}/g, r); }
    function ref(clave, fila) { return LETRA[clave] + (fila === undefined ? r : fila); }

    var saldoAnterior = m === 1 ? '=Parametros!$B$3' : '=' + ref('saldoArrastrar', r - 1);
    var arrastrePercepRetenc = m === 1 ? '=Parametros!$B$5' : '=' + ref('saldoPercepRetencArrastrar', r - 1);

    filas.push([
      MESES_NOMBRE_[m - 1],
      per,
      '=' + fv(letV.biGravada, 'Del mes') + '+' + fv(letV.descuentoBI, 'Del mes'),
      '=' + fv(letV.biGravada, 'Anterior') + '+' + fv(letV.descuentoBI, 'Anterior'),
      '=' + ref('ventaGravDelMes') + '+' + ref('ventaGravAnt'),
      '=' + fv(letV.igv, 'Del mes') + '+' + fv(letV.descuentoIGV, 'Del mes'),
      '=' + fv(letV.igv, 'Anterior') + '+' + fv(letV.descuentoIGV, 'Anterior'),
      '=' + ref('debitoDelMes') + '+' + ref('debitoAnt'),
      '=' + fv(letV.exonerado, 'Del mes') + '+' + fv(letV.inafecto, 'Del mes') + '+' + fv(letV.exportacion, 'Del mes'),
      '=' + fv(letV.exonerado, 'Anterior') + '+' + fv(letV.inafecto, 'Anterior') + '+' + fv(letV.exportacion, 'Anterior'),
      '=' + ref('ventaNoGravDelMes') + '+' + ref('ventaNoGravAnt'),
      '=' + fv(letV.isc) + '+' + fv(letV.icbper) + '+' + fv(letV.otrosTributos),
      '=' + ref('ventaGravTotal') + '+' + ref('debitoTotal') + '+' + ref('ventaNoGravTotal') + '+' + ref('ventaOtrosCargos'),
      '=' + fc(letC.biDG, 'Del mes'),
      '=' + fc(letC.biDG, 'Anterior'),
      '=' + ref('compraDgDelMes') + '+' + ref('compraDgAnt'),
      '=' + fc(letC.igvDG, 'Del mes'),
      '=' + fc(letC.igvDG, 'Anterior'),
      '=' + ref('creditoDgDelMes') + '+' + ref('creditoDgAnt'),
      '=' + fc(letC.biDGNG),
      '=' + fc(letC.igvDGNG),
      '=' + fc(letC.biDNG),
      '=' + fc(letC.igvDNG),
      '=' + fc(letC.valorAdqNG, 'Del mes'),
      '=' + fc(letC.valorAdqNG, 'Anterior'),
      '=' + ref('compraNoGravDelMes') + '+' + ref('compraNoGravAnt'),
      '=' + fc(letC.isc) + '+' + fc(letC.icbper) + '+' + fc(letC.otrosTribCargos),
      '=' + ref('compraDgTotal') + '+' + ref('creditoDgTotal') + '+' + ref('compraDgng') + '+' +
      ref('igvDgng') + '+' + ref('compraDng') + '+' + ref('igvDng') + '+' + ref('compraNoGravTotal') +
      '+' + ref('compraOtrosCargos'),
      '=' + ref('debitoTotal') + '-(' + ref('creditoDgTotal') + '+' + ref('igvDgng') + '*Parametros!$B$4)',
      saldoAnterior,
      '=' + ref('igvResultante') + '+' + ref('saldoAnt'),
      0,
      0,
      '=MAX(0' + S + ref('igvAcumulado') + '-' + ref('percepciones') + '-' + ref('retenciones') +
      '-' + ref('percepRetencArrastre') + ')',
      '=MIN(0' + S + ref('igvAcumulado') + ')',
      arrastrePercepRetenc,
      '=MAX(0' + S + '(' + ref('percepciones') + '+' + ref('retenciones') + '+' + ref('percepRetencArrastre') +
      ')-MAX(0' + S + ref('igvAcumulado') + '))',
      '=' + ref('ventaGravTotal') + '+' + ref('ventaNoGravTotal'),
      0,
      '=' + ref('ingresoNeto') + '*' + ref('coeficienteRenta'),
    ]);
  }

  sheet.getRange(2, 1, filas.length, encabezado.length).setValues(filas);

  // Fondo suave SOLO en las columnas "principales" de cada grupo (ver
  // COLUMNAS_IMPORTANTES_), no en todo el bloque -- para que el resaltado
  // realmente llame la atencion hacia los totales/resultados en vez de
  // pintar todas las columnas de detalle. Va ANTES de los resaltados mas
  // especificos de abajo (carga manual en amarillo, IGV a pagar, override en
  // rojo) para que esos sigan viendose por encima sin que este fondo los tape.
  COLUMNAS_IMPORTANTES_.forEach(function (clave) {
    var col = indiceColumna_(clave);
    var grupo = COLUMNAS_TABLERO_[col - 1].grupo;
    if (COLOR_GRUPO_SUAVE_[grupo]) {
      sheet.getRange(2, col, filas.length, 1).setBackground(COLOR_GRUPO_SUAVE_[grupo]);
    }
  });

  // Se restauran los valores manuales que ya tenias escritos (Percepciones,
  // Retenciones, Coeficiente) -- de lo contrario, cada vez que se actualiza
  // la liquidacion se perderian y volverian a 0/vacio.
  restaurarValoresManuales_(sheet, valoresManualesPrevios);

  // Totales
  var filaTotal = filas.length + 2;
  sheet.getRange(filaTotal, 1).setValue('TOTAL').setFontWeight('bold');
  var colsSinTotal = ['saldoAnt', 'igvAcumulado', 'saldoArrastrar', 'percepRetencArrastre',
    'saldoPercepRetencArrastrar', 'coeficienteRenta'].map(indiceColumna_);
  for (var c = 3; c <= encabezado.length; c++) {
    // No tiene sentido totalizar saldos de arrastre / balances puntuales, ni
    // el coeficiente de renta (es una tasa, no un monto que se pueda sumar).
    if (colsSinTotal.indexOf(c) !== -1) continue;
    var L = letraColumna_(c);
    sheet.getRange(filaTotal, c).setFormula('=SUM(' + L + '2:' + L + '13)');
  }
  sheet.getRange(filaTotal, 1, 1, encabezado.length)
    .setFontWeight('bold').setBorder(true, null, null, null, null, null);

  // Formato
  sheet.getRange(2, 3, filas.length + 1, encabezado.length - 2).setNumberFormat('#,##0.00');
  sheet.getRange(2, 2, filas.length, 1).setNumberFormat('0');
  var colCoefRenta = indiceColumna_('coeficienteRenta');
  sheet.getRange(2, colCoefRenta, filas.length, 1).setNumberFormat('0.00%');
  // Columnas de carga manual (Percepciones / Retenciones / Coeficiente Renta) resaltadas
  sheet.getRange(2, indiceColumna_('percepciones'), filas.length, 2).setBackground('#FFF2CC');
  sheet.getRange(2, colCoefRenta, filas.length, 1).setBackground('#FFF2CC');
  // IGV a pagar y Pago a Cuenta Renta destacados
  sheet.getRange(2, indiceColumna_('igvAPagar'), filas.length, 1)
    .setBackground('#FCE4D6').setFontWeight('bold');
  sheet.getRange(2, indiceColumna_('pagoACuentaRenta'), filas.length, 1)
    .setBackground('#D9EAD3').setFontWeight('bold');

  // Se aplican AL FINAL (despues de todo el formato de arriba) las celdas que
  // hayas sobreescrito a mano en cualquier columna de formula (venta, compra,
  // debito/credito fiscal, IGV a pagar, etc.) -- en rojo con letra blanca,
  // para que el resaltado no quede tapado por el formato general de columna.
  // Para deshacer un ajuste puntual: borra el contenido de esa celda (Supr) y
  // vuelve a correr "Actualizar" -- regresa sola a la formula automatica.
  aplicarOverridesFormula_(sheet, overridesPrevios);

  sheet.setColumnWidth(1, 55);
  sheet.setColumnWidth(2, 75);
  for (var i = 3; i <= encabezado.length; i++) sheet.setColumnWidth(i, 115);
}
