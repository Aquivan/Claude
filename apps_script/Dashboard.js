/**
 * Dashboard.js
 * Construye y actualiza la pestana principal "Panel de Control" (Caratula)
 * en la hoja de calculo unificada de forma ultra-rapida (en 2-3 segundos).
 */

function menuActualizarPanelDeControl() {
  var ui = SpreadsheetApp.getUi();
  var rucFiltro = preguntarEmpresaFiltroDashboard_();
  if (rucFiltro === null) return; // cancelado

  try {
    generarPanelDeControl_(rucFiltro || undefined);
    ui.alert('Panel de Control actualizado ✓',
      'El Panel de Control se ha actualizado con el estado mas reciente de Drive.',
      ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('Error actualizando Panel de Control: ' + e.message + '\n' + e.stack);
    ui.alert('Error', 'No se pudo actualizar el Panel de Control: ' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Pregunta al usuario el alcance del Panel (todas o un RUC específico).
 */
function preguntarEmpresaFiltroDashboard_() {
  var ui = SpreadsheetApp.getUi();
  var cfg;
  try { cfg = cargarConfigGitHub_(); } catch (e) { return ''; }
  var empresas;
  try { empresas = listarEmpresasGitHub_(cfg, false); } catch (e) { return ''; }

  if (!empresas || empresas.length <= 1) return '';

  var lista = empresas.map(function(e, i) {
    return (i + 1) + '. ' + e.ruc + ' - ' + e.nombre;
  }).join('\n');

  var resp = ui.prompt(
    '📊 Actualizar Panel de Control',
    'Empresas configuradas:\n' + lista + '\n\n' +
    'Escribe el RUC para mostrar SOLO esa empresa en el panel,\n' +
    'o deja en BLANCO para mostrar TODAS:',
    ui.ButtonSet.OK_CANCEL);

  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  return resp.getResponseText().trim();
}

/**
 * Escanea Drive ultra-rapido para construir la caratula interactiva.
 * rucFiltro: opcional, para filtrar solo una empresa.
 */
function generarPanelDeControl_(rucFiltro) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = obtenerOCrearHoja_(ss, 'Panel de Control');

  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);

  var ajustesPrevios = leerAjustesPanel_(sheet);   // montos escritos a mano en el resumen IGV (quedan en rojo)
  sheet.clear();
  sheet.clearFormats();
  sheet.clearNotes();
  sheet.clearConditionalFormatRules();
  sheet.setHiddenGridlines(false);

  var cfg = null;
  var empresas = [];
  try {
    cfg = cargarConfigGitHub_();
    empresas = listarEmpresasGitHub_(cfg, false);
    if (rucFiltro) {
      empresas = empresas.filter(function(e) { return e.ruc === rucFiltro; });
    }
  } catch (e) {}

  // Largo (en caracteres) del monto mas largo de cada columna H..M, para
  // ajustar el ancho de esas columnas al contenido al final.
  var largoMaxIgv = TITULOS_IGV_DASHBOARD_.map(function () { return 0; });
  // Lo mismo para B..G (largo del texto visible mas largo de cada columna) y
  // para los textos que ocupan varias columnas combinadas (nombre de empresa
  // en B..E y boton de carpeta raiz en B..D).
  var medidas = { tabla: [0, 0, 0, 0, 0, 0], nombreEmpresa: 0, carpetaRaiz: 0 };
  function medir(i, texto) {
    medidas.tabla[i] = Math.max(medidas.tabla[i], String(texto).length);
  }
  var ULT_COL = 7 + NUM_COLS_IGV_; // ultima columna del panel (M)

  var raiz = obtenerCarpetaRaiz_();
  var urlRaiz = raiz ? raiz.getUrl() : '';
  var anioActual = new Date().getFullYear();

  // -------------------------------------------------------------
  // 1. BANNER INSTITUCIONAL (Header)
  // -------------------------------------------------------------
  sheet.setRowHeight(1, 15);

  // Fila 2: Título principal (B..M: tabla B..G + resumen IGV/IR H..M)
  sheet.getRange(2, 2, 1, ULT_COL - 1).merge()
    .setValue('📊  SIRE SUNAT — PANEL DE CONTROL & NAVEGACIÓN')
    .setFontWeight('bold')
    .setFontSize(14)
    .setFontColor('#F8FAFC')
    .setBackground('#0F172A')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(2, 40);

  var fechaHora = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm:ss');
  var textoSub = '🕐  Actualizado: ' + fechaHora + '    ·    🏢  ' + empresas.length + ' empresa(s)    ·    📅  Año ' + anioActual;
  sheet.getRange(3, 2, 1, ULT_COL - 1).merge()
    .setValue(textoSub)
    .setFontSize(9)
    .setFontColor('#7DD3FC')
    .setBackground('#0F172A')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(3, 24);

  // Separador decorativo
  sheet.getRange(4, 2, 1, ULT_COL - 1).merge()
    .setBackground('#1E3A5F');
  sheet.setRowHeight(4, 4);

  // -------------------------------------------------------------
  // 2. BOTONERA DE ACCESO RAPIDO (Cards / Links)
  // -------------------------------------------------------------
  sheet.setRowHeight(5, 12);

  var textoDrive = urlRaiz ? '📁 Abrir carpeta raíz en Drive' : 'Carpeta no disponible';
  medidas.carpetaRaiz = textoDrive.length;
  var formulaDrive = urlRaiz ? '=HYPERLINK("' + urlRaiz + '", "' + textoDrive + '")' : textoDrive;
  sheet.getRange('B6:D6').merge()
    .setValue(formulaDrive)
    .setFontWeight('bold')
    .setFontSize(9)
    .setFontColor('#1E40AF')
    .setBackground('#DBEAFE')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#93C5FD', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sheet.getRange(6, 5, 1, ULT_COL - 4).merge()
    .setValue('ℹ️  Usa el menú  SIRE SUNAT  para Descargar archivos, Importar datos o Generar Liquidaciones IGV')
    .setFontSize(9)
    .setFontColor('#64748B')
    .setBackground('#F8FAFC')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(6, 30);

  sheet.setRowHeight(7, 14);

  // -------------------------------------------------------------
  // 3. TABLA DE EMPRESAS Y PERIODOS
  // -------------------------------------------------------------
  var filaActual = 8;

  if (empresas.length === 0) {
    sheet.getRange(filaActual, 2, 1, 6).merge()
      .setValue('No se encontraron empresas activas con el filtro seleccionado.')
      .setFontColor('#64748B')
      .setHorizontalAlignment('center');
    ajustarColumnasDashboard_(sheet);
    return;
  }

  // Mapa en memoria de carpetas para escaneo instantaneo
  var mapaCarpetasRaiz = {};
  if (raiz) {
    var itCRaiz = raiz.getFolders();
    while (itCRaiz.hasNext()) {
      var cF = itCRaiz.next();
      if (!cF.isTrashed()) mapaCarpetasRaiz[cF.getName()] = cF;
    }
  }

  empresas.forEach(function(emp, indexEmpresa) {
    var ruc = emp.ruc;
    var nombre = emp.nombre || ruc;
    var activo = emp.activo;

    // Buscar carpeta de empresa (sin llamadas lentas de red)
    var carpetaEmpresa = obtenerCarpetaEmpresaRapida_(raiz, mapaCarpetasRaiz, ruc, nombre);
    var urlCarpetaEmp = carpetaEmpresa ? carpetaEmpresa.getUrl() : '';

    // Buscar liquidacion IGV
    var urlLiq = '';
    var archivoLiq = null;
    if (carpetaEmpresa) {
      var itLiq = carpetaEmpresa.getFilesByName('Liquidacion IGV ' + ruc + ' - ' + anioActual);
      while (itLiq.hasNext()) {
        var fLiq = itLiq.next();
        if (fLiq.isTrashed()) continue;
        archivoLiq = fLiq;
        urlLiq = fLiq.getUrl();
        break;
      }
    }

    // Resumen IGV por periodo, leido (solo lectura) de la hoja "Liquidacion"
    var resumenIgv = leerResumenIgvLiquidacion_(archivoLiq);
    // Liquidacion a medio generar (p. ej. Google corto la ejecucion y quedo solo con titulos): se rehace aqui
    // mismo si queda tiempo; si no, el bloque lo dice claro (en vez de quedar vacio sin explicacion).
    if (archivoLiq && resumenIgv.incompleta) {
      if (Date.now() - INICIO_EJECUCION_ < 3 * 60 * 1000) {
        try {
          construirLiquidacion_(ruc, anioActual);
          resumenIgv = leerResumenIgvLiquidacion_(archivoLiq);
        } catch (eL) { Logger.log('Rehacer liquidacion ' + ruc + ': ' + eL.message); }
      } else {
        encolarLiquidaciones_([ruc + '|' + anioActual]);
      }
      if (resumenIgv.incompleta) resumenIgv.error = 'liquidación incompleta: se está rehaciendo, actualice el panel en unos minutos';
    }
    var liqConDatos = resumenIgv.error ? null : archivoLiq;   // las formulas solo se conectan a una liquidacion sana

    // -------------------------------------------------------
    // --- HEADER DE EMPRESA: B..G (6 columnas alineadas) ---
    var AZUL_EMP = activo ? '#1E3A5F' : '#374151';
    var AZUL_BTN = activo ? '#2563EB' : '#6B7280';
    var VERDE_BTN = urlLiq ? '#047857' : '#6B7280';

    // 1. Nombre empresa (col B-E, 4 columnas: B, C, D, E)
    var textoNombre = (activo ? '▶ ' : '■ ') + (indexEmpresa + 1) + '. ' + ruc + ' — ' + nombre;
    medidas.nombreEmpresa = Math.max(medidas.nombreEmpresa, textoNombre.length);
    sheet.getRange(filaActual, 2, 1, 4).merge()
      .setValue(textoNombre)
      .setFontWeight('bold').setFontSize(10).setFontColor('#F8FAFC')
      .setBackground(AZUL_EMP).setVerticalAlignment('middle').setWrap(true);   // un nombre largo baja de línea (no ensancha columnas)

    // 2. Botón: Abrir en Drive (col F)
    var linkCarpeta = urlCarpetaEmp ? '=HYPERLINK("' + urlCarpetaEmp + '", "📂 Abrir en Drive")' : '(Sin carpeta)';
    medir(4, urlCarpetaEmp ? '📂 Abrir en Drive' : '(Sin carpeta)');
    sheet.getRange(filaActual, 6)
      .setValue(linkCarpeta)
      .setFontWeight('bold').setFontSize(9).setFontColor('#FFFFFF')
      .setBackground(AZUL_BTN).setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(false, true, false, true, false, false, '#1E3A5F', SpreadsheetApp.BorderStyle.SOLID);

    // 3. Botón: Liquidación anual (col G)
    var linkLiq = urlLiq
      ? '=HYPERLINK("' + urlLiq + '", "📊 Liquidación ' + anioActual + '")'
      : '⚪ Sin liquidación';
    medir(5, urlLiq ? '📊 Liquidación ' + anioActual : '⚪ Sin liquidación');
    sheet.getRange(filaActual, 7)
      .setValue(linkLiq)
      .setFontWeight('bold').setFontSize(9).setFontColor('#FFFFFF')
      .setBackground(VERDE_BTN).setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(false, true, false, true, false, false, '#1E3A5F', SpreadsheetApp.BorderStyle.SOLID);

    // 4. Titulo del bloque Resumen IGV + IR (cols H..M)
    sheet.getRange(filaActual, 8, 1, NUM_COLS_IGV_).merge()
      .setValue(resumenIgv.error
        ? '💰 Resumen IGV e IR — ' + resumenIgv.error
        : '💰 Resumen IGV e IR (tomado de la Liquidación ' + anioActual + ')')
      .setFontWeight('bold').setFontSize(9).setFontColor('#FFFFFF')
      .setBackground('#674EA7').setHorizontalAlignment('center').setVerticalAlignment('middle');

    sheet.setRowHeight(filaActual, textoNombre.length > 44 ? 34 : 28);   // nombre largo: 2 líneas
    filaActual++;

    // --- CABECERA TABLA MENSUAL (6 columnas: B..G) ---
    var headersTabla = ['Mes', 'Período', 'Registro Ventas', 'Registro Compras', 'Estado', 'Última Actualización'];
    var NUM_COLS = headersTabla.length;
    headersTabla.forEach(function (h, i) { medir(i, h); });
    sheet.getRange(filaActual, 2, 1, NUM_COLS).setValues([headersTabla])
      .setFontWeight('bold').setFontSize(9)
      .setFontColor('#1E3A5F').setBackground('#BFDBFE')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.getRange(filaActual, 8, 1, NUM_COLS_IGV_).setValues([TITULOS_IGV_DASHBOARD_])
      .setFontWeight('bold').setFontSize(9).setWrap(true)
      .setFontColor('#3B2470').setBackground('#DDD3F3')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.getRange(filaActual, 9).setNote('IGV de las compras con fecha de este mes.');
    sheet.getRange(filaActual, 10).setNote('IGV de compras de meses pasados que llegaron recién a este SIRE (se usan este mes).');
    sheet.getRange(filaActual, 11).setNote('Crédito fiscal total del mes = compras del mes + compras de meses anteriores.');
    sheet.getRange(filaActual, 12).setNote('Resultado del mes (ya con saldo anterior, percepciones y retenciones): «Pagar» = IGV a pagar a SUNAT; «A favor» = saldo que pasa al mes siguiente.');
    sheet.setRowHeight(filaActual, 42); // titulos IGV en hasta 3 lineas
    filaActual++;

    // Pre-escanear subcarpetas de Venta y Compra de esta empresa una sola vez
    var mapaArchivosEmpresa = preEscanearArchivosEmpresaRapido_(carpetaEmpresa, anioActual);

    // --- FILAS DE LOS 12 MESES ---
    var filasMeses = [];
    var coloresFila = [];
    var filasIgv = [];

    for (var m = 1; m <= 12; m++) {
      var mesNombre = MESES_NOMBRE_[m - 1];
      var periodoStr = anioActual + ('' + m).padStart(2, '0');

      var infoVenta = mapaArchivosEmpresa['venta_' + m] || { existe: false, url: '', tieneZip: false };
      var infoCompra = mapaArchivosEmpresa['compra_' + m] || { existe: false, url: '', tieneZip: false };

      var txtVenta = infoVenta.existe
        ? '=HYPERLINK("' + infoVenta.url + '", "📄  Venta ' + periodoStr + '")'
        : (infoVenta.tieneZip ? '⏳ Pendiente import.' : '⚪ Pendiente');
      var txtCompra = infoCompra.existe
        ? '=HYPERLINK("' + infoCompra.url + '", "📄  Compra ' + periodoStr + '")'
        : (infoCompra.tieneZip ? '⏳ Pendiente import.' : '⚪ Pendiente');

      var estadoGlobal, colorEstado, colorFila;
      if (infoVenta.existe && infoCompra.existe) {
        estadoGlobal = '✅ Completo';
        colorEstado = '#166534';  // verde oscuro texto
        colorFila    = '#DCFCE7'; // fondo verde muy claro
      } else if (infoVenta.existe || infoCompra.existe) {
        estadoGlobal = '🟡 Parcial';
        colorEstado = '#92400E';
        colorFila    = '#FEF9C3';
      } else {
        estadoGlobal = '⚪ Sin datos';
        colorEstado = '#64748B';
        colorFila    = '#F8FAFC';
      }

      var maxDate = null;
      if (infoVenta.existe && infoVenta.lastUpdated && (!maxDate || infoVenta.lastUpdated > maxDate)) maxDate = infoVenta.lastUpdated;
      if (infoCompra.existe && infoCompra.lastUpdated && (!maxDate || infoCompra.lastUpdated > maxDate)) maxDate = infoCompra.lastUpdated;
      var fechaActualizacion = maxDate ? Utilities.formatDate(maxDate, 'America/Lima', 'dd/MM/yyyy HH:mm') : '';

      filasMeses.push([mesNombre, periodoStr, txtVenta, txtCompra, estadoGlobal, fechaActualizacion]);
      // Texto VISIBLE (sin la formula HYPERLINK) para medir el ancho
      [mesNombre, periodoStr,
        infoVenta.existe ? '📄  Venta ' + periodoStr : txtVenta,
        infoCompra.existe ? '📄  Compra ' + periodoStr : txtCompra,
        estadoGlobal, fechaActualizacion].forEach(function (t, i) { medir(i, t); });

      var igv = resumenIgv.porPeriodo[periodoStr];
      // IGV: un solo número, positivo = a pagar, negativo = saldo a favor (el formato lo dice con palabras)
      var neto = !igv ? '' : (typeof igv.aPagar === 'number' && igv.aPagar > 0) ? igv.aPagar
        : (typeof igv.aFavor === 'number' && igv.aFavor > 0) ? -igv.aFavor : (igv.aPagar === '' && igv.aFavor === '' ? '' : 0);
      var valoresIgv = igv
        ? [igv.debito, igv.creditoMes, igv.creditoAnt, igv.credito, neto, igv.irPagar]
        : TITULOS_IGV_DASHBOARD_.map(function () { return ''; });
      valoresIgv.forEach(function (v, k) {
        largoMaxIgv[k] = Math.max(largoMaxIgv[k], textoMonto_(v).length + (k === 4 && v ? 8 : 0));   // «Pagar » / «A favor »
      });
      filasIgv.push(valoresIgv);
      coloresFila.push({ fondo: colorFila, texto: colorEstado });
    }

    var rangoDatos = sheet.getRange(filaActual, 2, 12, NUM_COLS);
    rangoDatos.setValues(filasMeses).setFontSize(9).setVerticalAlignment('middle').setHorizontalAlignment('center');

    // Alineación izquierda para Ventas y Compras
    sheet.getRange(filaActual, 4, 12, 2).setHorizontalAlignment('left');
    // Última Actualización: color tenue
    sheet.getRange(filaActual, 7, 12, 1).setHorizontalAlignment('center').setFontColor('#94A3B8');

    for (var r = 0; r < 12; r++) {
      sheet.setRowHeight(filaActual + r, 20);
      // Fondo alternado suave en filas + color del estado
      var bgFila = (r % 2 === 0) ? coloresFila[r].fondo : mezclarConBlanco_(coloresFila[r].fondo);
      sheet.getRange(filaActual + r, 2, 1, NUM_COLS).setBackground(bgFila);
      sheet.getRange(filaActual + r, 6).setFontColor(coloresFila[r].texto).setFontWeight('bold');
    }

    // Borde de la tabla completa
    sheet.getRange(filaActual - 1, 2, 13, NUM_COLS)
      .setBorder(true, true, true, true, true, true, '#93C5FD', SpreadsheetApp.BorderStyle.SOLID);

    // --- BLOQUE RESUMEN IGV + IR (H..M): FORMULAS que leen la Liquidacion (se actualizan solas) ---
    var rangoIgv = sheet.getRange(filaActual, 8, 12, NUM_COLS_IGV_);
    var conFormulas = false;
    if (liqConDatos) {
      rangoIgv.setFormulas(formulasResumenIgv_(ss, sheet, liqConDatos, filaActual - 1));
      conFormulas = importrangeConectado_(ss, sheet, liqConDatos, filaActual - 1);
    }
    if (!conFormulas) {   // sin permiso para leer la liquidacion (o sin liquidacion): los montos como valores, como antes
      rangoIgv.setValues(filasIgv);
      if (liqConDatos) sheet.getRange(filaActual - 2, 8).setNote('Montos fijos (copiados de la liquidación al actualizar el panel): Google no dejó conectar este bloque con la liquidación. ' +
        'Para que se actualicen solos: abra la liquidación una vez desde «📊 Liquidación» y vuelva a actualizar el panel.');
    }
    rangoIgv.setFontSize(9).setVerticalAlignment('middle')
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00;-#,##0.00;"-"')
      .setBackground('#FAF7FF');
    // Total crédito (compras del mes + meses anteriores): en negrita, es el que se usa
    sheet.getRange(filaActual, 11, 12, 1).setFontWeight('bold').setBackground('#F1ECFB');
    // IGV del mes: "Pagar 12,130.86" (rojo) o "A favor 9,326.32" (verde) en una sola columna
    sheet.getRange(filaActual, 12, 12, 1).setNumberFormat('"Pagar "#,##0.00;"A favor "#,##0.00;"-"');
    // Colores segun el monto (formato condicional: siguen el valor aunque cambie la liquidacion).
    // Solo en celdas con formula: un monto escrito a mano se ve en rojo (ajuste), como en la liquidacion.
    coloresResumenIgv_(sheet, filaActual);
    if (!conFormulas) filasIgv.forEach(function (f, ri) {   // montos fijos: colores fijos
      var fila = filaActual + ri;
      if (typeof f[4] === 'number' && f[4] > 0) sheet.getRange(fila, 12).setFontColor('#B91C1C').setFontWeight('bold').setBackground('#FDECEC');
      else if (typeof f[4] === 'number' && f[4] < 0) sheet.getRange(fila, 12).setFontColor('#166534').setFontWeight('bold').setBackground('#E7F8EC');
      if (typeof f[5] === 'number' && f[5] > 0) sheet.getRange(fila, 13).setFontColor('#A64D79').setFontWeight('bold').setBackground('#FBEAF1');
      if (typeof f[2] === 'number' && f[2] !== 0) sheet.getRange(fila, 10).setFontColor('#92400E').setBackground('#FEF3C7');
    });
    aplicarAjustesPanel_(sheet, ajustesPrevios, ruc, filaActual);
    sheet.getRange(filaActual - 1, 8, 13, NUM_COLS_IGV_)
      .setBorder(true, true, true, true, true, true, '#C4B5FD', SpreadsheetApp.BorderStyle.SOLID);

    filaActual += 13;
    sheet.setRowHeight(filaActual, 18);
    filaActual++;
  });

  ajustarColumnasDashboard_(sheet, largoMaxIgv, medidas);
  limpiarHojasVacias_(ss);
}

/**
 * Texto con que se ve un monto en las columnas IGV (formato #,##0.00; el 0 y
 * los vacios se ven como "-"). Solo se usa para medir el ancho necesario.
 */
function textoMonto_(v) {
  if (typeof v !== 'number' || v === 0) return '-';
  var partes = Math.abs(v).toFixed(2).split('.');
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-' : '') + partes.join('.');
}

// Columnas H..M del Panel: resumen IGV e IR por mes, leido de la hoja "Liquidacion"
// de cada empresa (Liquidacion.js). Solo lectura: el Panel nunca escribe en
// la liquidacion.
var TITULOS_IGV_DASHBOARD_ = [
  'IGV Ventas (Débito)',
  'IGV Compras del mes',
  'IGV Compras de meses anteriores',
  'Total IGV Compras (Crédito)',
  'IGV: a pagar o saldo a favor',
  'IR por pagar (Pago a cuenta Renta)',
];
var NUM_COLS_IGV_ = TITULOS_IGV_DASHBOARD_.length;

/**
 * Lee de la hoja "Liquidacion" del archivo dado los montos IGV de cada mes.
 * Ubica las columnas por su TITULO (no por letra), asi sigue funcionando
 * aunque se agreguen columnas a la liquidacion en el futuro.
 * Devuelve { porPeriodo: { '202601': {debito, credito, creditoAnt, aPagar, aFavor, irPagar} }, error }
 */
function leerResumenIgvLiquidacion_(archivoLiq) {
  var res = { porPeriodo: {}, error: '' };
  if (!archivoLiq) { res.error = 'sin liquidación generada'; return res; }
  try {
    var hoja = SpreadsheetApp.openById(archivoLiq.getId()).getSheetByName('Liquidacion');
    if (!hoja || hoja.getLastRow() < 2 || hoja.getLastColumn() < 2) {
      res.error = hoja ? 'liquidación vacía' : 'falta la pestaña Liquidacion';
      res.incompleta = true;
      return res;
    }
    var datos = hoja.getRange(1, 1, Math.min(hoja.getLastRow(), 20), hoja.getLastColumn()).getValues();
    var enc = datos[0].map(function (t) { return String(t).trim(); });
    function col(clave) {
      var titulo = COLUMNAS_TABLERO_.filter(function (c) { return c.clave === clave; })[0].titulo;
      return enc.indexOf(titulo);
    }
    var iPer = col('periodo'), iDeb = col('debitoTotal'), iCred = col('creditoDgTotal'),
        iCredMes = col('creditoDgDelMes'), iCredAnt = col('creditoDgAnt'), iPagar = col('igvAPagar'), iFavor = col('saldoArrastrar');
    if ([iPer, iDeb, iCred, iCredAnt, iPagar, iFavor].indexOf(-1) !== -1) {
      res.error = 'columnas de la liquidación no reconocidas';
      res.incompleta = true;   // formato antiguo o a medias: se rehace
      return res;
    }
    // Pago a cuenta de renta: opcional (si no existiera, la columna IR queda vacia)
    var iRenta = col('pagoACuentaRenta');
    function num(v) { return typeof v === 'number' ? v : ''; }
    for (var i = 1; i < datos.length; i++) {
      var per = String(datos[i][iPer]).trim();
      if (!/^\d{6}$/.test(per)) continue;
      var favor = num(datos[i][iFavor]);
      res.porPeriodo[per] = {
        debito: num(datos[i][iDeb]),
        credito: num(datos[i][iCred]),
        // liquidacion antigua sin «del mes»: total - anteriores
        creditoMes: iCredMes !== -1 ? num(datos[i][iCredMes])
          : (typeof datos[i][iCred] === 'number' && typeof datos[i][iCredAnt] === 'number' ? datos[i][iCred] - datos[i][iCredAnt] : ''),
        creditoAnt: num(datos[i][iCredAnt]),
        aPagar: num(datos[i][iPagar]),
        // En la liquidacion el saldo a favor se guarda en negativo; aqui positivo
        aFavor: favor === '' ? '' : Math.abs(favor),
        irPagar: iRenta === -1 ? '' : num(datos[i][iRenta]),
      };
    }
    // Solo titulos y ningun mes: la liquidacion quedo a medio generar
    if (!Object.keys(res.porPeriodo).length) res.incompleta = true;
  } catch (e) {
    Logger.log('No se pudo leer la liquidacion ' + archivoLiq.getName() + ': ' + e.message);
    res.error = 'no se pudo leer la liquidación';
  }
  return res;
}

/**
 * Aclara ligeramente un color hex mezclándolo con blanco para filas alternas.
 */
function mezclarConBlanco_(hex) {
  if (!hex || hex.length < 7) return '#FFFFFF';
  var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  r = Math.round(r + (255-r)*0.35); g = Math.round(g + (255-g)*0.35); b = Math.round(b + (255-b)*0.35);
  return '#' + ('0'+r.toString(16)).slice(-2) + ('0'+g.toString(16)).slice(-2) + ('0'+b.toString(16)).slice(-2);
}

/**
 * Busca o renombra la carpeta de empresa rápidamente.
 */
function obtenerCarpetaEmpresaRapida_(raiz, mapaCarpetasRaiz, ruc, nombre) {
  var nombreDeseado = ruc + ' - ' + nombre;
  if (mapaCarpetasRaiz[nombreDeseado]) return mapaCarpetasRaiz[nombreDeseado];
  if (mapaCarpetasRaiz[ruc]) {
    var c = mapaCarpetasRaiz[ruc];
    c.setName(nombreDeseado);
    mapaCarpetasRaiz[nombreDeseado] = c;
    return c;
  }
  return obtenerCarpetaRUC_(raiz, ruc, nombre);
}

/**
 * Escanea la estructura de archivos de una empresa en Drive de forma instantánea.
 * NO abre los Spreadsheets (lo cual tardaba 4-5 minutos).
 */
function preEscanearArchivosEmpresaRapido_(carpetaEmpresa, anio) {
  var mapa = {};
  if (!carpetaEmpresa) return mapa;

  ['Venta', 'Compra'].forEach(function(tipoCap) {
    var tipoKey = tipoCap.toLowerCase();
    var itTipo = carpetaEmpresa.getFoldersByName(tipoCap);
    if (!itTipo.hasNext()) return;

    var itAnio = itTipo.next().getFoldersByName(String(anio));
    if (!itAnio.hasNext()) return;

    var cAnio = itAnio.next();
    var itMeses = cAnio.getFolders();

    while (itMeses.hasNext()) {
      var cMes = itMeses.next();
      if (cMes.isTrashed()) continue;

      var nomMes = cMes.getName();
      var numMes = MESES_CARPETA_.indexOf(nomMes) + 1;
      if (numMes < 1) continue;

      var perStr = anio + ('' + numMes).padStart(2, '0');
      var nombreBuscado = tipoCap + ' ' + perStr;

      var itArchivos = cMes.getFiles();
      var archivoEncontrado = null;
      var tieneZip = false;

      while (itArchivos.hasNext()) {
        var f = itArchivos.next();
        if (f.isTrashed()) continue;
        var fn = f.getName();
        if (fn === nombreBuscado) {
          archivoEncontrado = f;
        } else if (fn.toLowerCase().indexOf('.zip') !== -1 || fn.toLowerCase().indexOf('.xml') !== -1) {
          tieneZip = true;
        }
      }

      if (archivoEncontrado) {
        mapa[tipoKey + '_' + numMes] = {
          existe: true,
          url: archivoEncontrado.getUrl(),
          lastUpdated: archivoEncontrado.getLastUpdated(),
          tieneZip: tieneZip
        };
      } else if (tieneZip) {
        mapa[tipoKey + '_' + numMes] = {
          existe: false,
          url: '',
          lastUpdated: null,
          tieneZip: true
        };
      }
    }
  });

  return mapa;
}

/**
 * Ajusta anchos de columna para que el Panel de Control se vea visualmente perfecto.
 */
function ajustarColumnasDashboard_(sheet, largoMaxIgv, medidas) {
  sheet.setColumnWidth(1, 18);  // A: Margen izquierdo

  // B..G ajustadas al texto visible mas largo de cada columna (~6.2px por
  // caracter en letra 9 + margen chico), con un minimo para que no queden apretadas.
  var minimos = [38, 56, 80, 80, 88, 104];
  var anchos = minimos.map(function (min, i) {
    var largo = medidas ? medidas.tabla[i] : 0;
    return Math.max(min, Math.round(largo * 6.2 + 12));
  });
  if (medidas) {
    // Textos combinados: si no caben en la suma de sus columnas, el faltante
    // se reparte entre D y E (las de Registro Ventas/Compras).
    function asegurar(desde, hasta, px) {
      var suma = 0;
      for (var i = desde; i <= hasta; i++) suma += anchos[i];
      var falta = px - suma;
      if (falta > 0) {
        anchos[2] += Math.ceil(falta / 2);
        if (hasta >= 3) anchos[3] += Math.ceil(falta / 2);
        else anchos[2] += Math.ceil(falta / 2);
      }
    }
    // El nombre de la empresa (B..E) ya no ensancha columnas: si es largo baja de línea (setWrap arriba).
    asegurar(0, 2, Math.round(medidas.carpetaRaiz * 6.4 + 16));    // boton carpeta raiz B..D
  }
  anchos.forEach(function (w, i) { sheet.setColumnWidth(2 + i, w); });

  // H..M (resumen IGV e IR): ancho ajustado al monto mas largo de cada columna.
  // ~6.6px por caracter en letra 9 (negrita incluida) + margen chico; minimo 74px
  // para que el titulo quepa en 3 lineas.
  for (var k = 0; k < NUM_COLS_IGV_; k++) {
    var largo = largoMaxIgv ? largoMaxIgv[k] : 12;
    sheet.setColumnWidth(8 + k, Math.max(74, Math.round(largo * 6.6 + 12)));
  }
}



/* ===================== Resumen IGV con FORMULAS (lee la Liquidacion) ===================== */

var COL_AYUDA_IGV_ = 30;   // AD: aqui va el IMPORTRANGE de la liquidacion (columnas ocultas)
var ANCHO_AYUDA_IGV_ = 80; // AD..DE

/** Titulo de una columna de la liquidacion por su clave (asi las formulas siguen a la columna aunque se mueva). */
function tituloLiq_(clave) { return COLUMNAS_TABLERO_.filter(function (c) { return c.clave === clave; })[0].titulo; }

/**
 * Formulas H..M de los 12 meses. filaTit = fila de titulos del bloque (alli va el IMPORTRANGE oculto, que trae la
 * fila de titulos + los 12 meses de la liquidacion, alineados con las filas del panel).
 */
function formulasResumenIgv_(ss, sheet, archivoLiq, filaTit) {
  var S = separadorFormula_(ss);
  var ini = letraColumna_(COL_AYUDA_IGV_), fin = letraColumna_(COL_AYUDA_IGV_ + ANCHO_AYUDA_IGV_ - 1);
  var falta = COL_AYUDA_IGV_ + ANCHO_AYUDA_IGV_ - 1 - sheet.getMaxColumns();   // la hoja puede tener menos columnas
  if (falta > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), falta);
  sheet.getRange(filaTit, COL_AYUDA_IGV_).setFormula('=IMPORTRANGE("' + archivoLiq.getId() + '"' + S + '"Liquidacion!A1:' + letraColumna_(ANCHO_AYUDA_IGV_) + '13")');
  permitirImportrange_(ss, archivoLiq.getId());
  var filas = [];
  for (var i = 1; i <= 12; i++) {
    var r = filaTit + i;
    var X = function (clave) {
      return 'INDEX($' + ini + r + ':$' + fin + r + S + 'MATCH("' + tituloLiq_(clave) + '"' + S + '$' + ini + '$' + filaTit + ':$' + fin + '$' + filaTit + S + '0))';
    };
    filas.push([
      '=IFERROR(' + X('debitoTotal') + S + '"")',
      '=IFERROR(' + X('creditoDgDelMes') + S + '"")',
      '=IFERROR(' + X('creditoDgAnt') + S + '"")',
      '=IFERROR(' + X('creditoDgTotal') + S + '"")',
      // un solo numero: positivo = a pagar, negativo = saldo a favor
      '=IFERROR(IF(' + X('igvAPagar') + '>0' + S + X('igvAPagar') + S + '-ABS(' + X('saldoArrastrar') + '))' + S + '"")',
      '=IFERROR(' + X('pagoACuentaRenta') + S + '"")'
    ]);
  }
  sheet.hideColumns(COL_AYUDA_IGV_, ANCHO_AYUDA_IGV_);
  return filas;
}

/** ¿El IMPORTRANGE del bloque ya trae datos? Si no, reintenta el permiso y espera un poco; si sigue sin datos, false
 * (y se borra la formula oculta, para no dejar un error escondido). */
function importrangeConectado_(ss, sheet, archivoLiq, filaTit) {
  var celda = sheet.getRange(filaTit, COL_AYUDA_IGV_);
  for (var intento = 0; intento < 3; intento++) {
    SpreadsheetApp.flush();
    var v = celda.getValue();
    if (v !== '' && !/^#/.test(String(v))) return true;
    permitirImportrange_(ss, archivoLiq.getId());
    Utilities.sleep(1500 + intento * 1500);
    celda.setFormula(celda.getFormula());   // vuelve a calcular
  }
  celda.clearContent();
  return false;
}

/** Deja que este panel lea la liquidacion con IMPORTRANGE sin pedir «Permitir acceso» (mismo dueño). Si no se puede,
 * la primera vez la celda muestra #REF y basta tocar «Permitir acceso» una vez. */
function permitirImportrange_(ss, idOrigen) {
  try {
    UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/externaldata/addimportrangepermissions?donorDoc=' + idOrigen,
      { method: 'post', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  } catch (e) { Logger.log('IMPORTRANGE: ' + e.message); }
}

/** Colores por formato condicional en H..M de un bloque (solo celdas con formula). */
function coloresResumenIgv_(sheet, fila1) {
  var reglas = sheet.getConditionalFormatRules();
  var S = separadorFormula_(sheet.getParent());
  var regla = function (col, cond, fondo, letra) {
    var L = letraColumna_(col), rg = sheet.getRange(fila1, col, 12, 1);
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISFORMULA(' + L + fila1 + ')' + S + 'ISNUMBER(' + L + fila1 + ')' + S + L + fila1 + cond + ')')
      .setBackground(fondo).setFontColor(letra).setBold(true).setRanges([rg]).build();
  };
  reglas.push(regla(12, '>0', '#FDECEC', '#B91C1C'));   // L: pagar (rojo)
  reglas.push(regla(12, '<0', '#E7F8EC', '#166534'));   // L: a favor (verde)
  reglas.push(regla(13, '>0', '#FBEAF1', '#A64D79'));   // M: IR por pagar
  reglas.push(regla(10, '<>0', '#FEF3C7', '#92400E'));  // J: compras de meses anteriores (ambar)
  sheet.setConditionalFormatRules(reglas);
}

/**
 * Antes de rehacer el panel: montos que la persona escribio a mano en H..M (celda sin formula con valor) de los
 * bloques que YA eran formulas. Se guardan por RUC + periodo + columna, para volver a ponerlos (en rojo).
 */
function leerAjustesPanel_(sheet) {
  var out = {};
  var n = sheet.getLastRow();
  if (n < 10) return out;
  var vals = sheet.getRange(1, 2, n, 12).getValues(), forms = sheet.getRange(1, 8, n, 6).getFormulas();
  var ruc = '', conFormulas = false;
  for (var i = 0; i < n; i++) {
    var m = String(vals[i][0]).match(/^\s*[▶■]\s*\d+\.\s*(\d{11})/);
    if (m) { ruc = m[1]; conFormulas = false; continue; }
    var per = String(vals[i][1]).trim();
    if (!ruc || !/^\d{6}$/.test(per)) continue;
    if (forms[i].some(function (f) { return f; })) conFormulas = true;
    if (!conFormulas) continue;   // bloque antiguo (todo valores): nada es ajuste
    for (var k = 0; k < 6; k++) {
      var v = vals[i][6 + k];
      if (!forms[i][k] && v !== '' && v !== null) out[ruc + '|' + per + '|' + k] = v;
    }
  }
  return out;
}

/** Vuelve a poner los ajustes a mano de este bloque, en rojo con letra blanca (como en la liquidacion). */
function aplicarAjustesPanel_(sheet, ajustes, ruc, fila1) {
  for (var i = 0; i < 12; i++) {
    var per = String(sheet.getRange(fila1 + i, 3).getValue()).trim();
    for (var k = 0; k < 6; k++) {
      var v = ajustes[ruc + '|' + per + '|' + k];
      if (v === undefined) continue;
      sheet.getRange(fila1 + i, 8 + k).setValue(v).setBackground('#CC0000').setFontColor('#FFFFFF').setFontWeight('bold');
    }
  }
}
