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

  sheet.clear();
  sheet.clearFormats();
  sheet.clearNotes();
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

  var raiz = obtenerCarpetaRaiz_();
  var urlRaiz = raiz ? raiz.getUrl() : '';
  var anioActual = new Date().getFullYear();

  // -------------------------------------------------------------
  // 1. BANNER INSTITUCIONAL (Header)
  // -------------------------------------------------------------
  sheet.setRowHeight(1, 15);

  sheet.getRange('B2:H2').merge()
    .setValue('📊 SIRE SUNAT — PANEL DE CONTROL & NAVEGACIÓN CENTRAL')
    .setFontWeight('bold')
    .setFontSize(14)
    .setFontColor('#FFFFFF')
    .setBackground('#1E293B')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(2, 38);

  var fechaHora = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm:ss');
  var textoSub = 'Última actualización: ' + fechaHora + '  |  Empresas: ' + empresas.length + '  |  Año: ' + anioActual;
  sheet.getRange('B3:H3').merge()
    .setValue(textoSub)
    .setFontSize(9)
    .setFontColor('#94A3B8')
    .setBackground('#0F172A')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(3, 24);

  // -------------------------------------------------------------
  // 2. BOTONERA DE ACCESO RAPIDO (Cards / Links)
  // -------------------------------------------------------------
  sheet.setRowHeight(4, 12);

  var formulaDrive = urlRaiz ? '=HYPERLINK("' + urlRaiz + '", "📁 Abrir Carpeta Raíz en Google Drive")' : 'Carpeta no disponible';
  sheet.getRange('B5:D5').merge()
    .setValue(formulaDrive)
    .setFontWeight('bold')
    .setFontSize(10)
    .setFontColor('#1D4ED8')
    .setBackground('#EFF6FF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#93C5FD', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sheet.getRange('E5:H5').merge()
    .setValue('ℹ️ Usa el menú "SIRE SUNAT" arriba para Descargar, Importar o Generar Liquidaciones')
    .setFontSize(9)
    .setFontColor('#475569')
    .setBackground('#F8FAFC')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(5, 30);

  sheet.setRowHeight(6, 15);

  // -------------------------------------------------------------
  // 3. TABLA DE EMPRESAS Y PERIODOS
  // -------------------------------------------------------------
  var filaActual = 7;

  if (empresas.length === 0) {
    sheet.getRange(filaActual, 2, 1, 7).merge()
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
    if (carpetaEmpresa) {
      var itLiq = carpetaEmpresa.getFilesByName('Liquidacion IGV ' + ruc + ' - ' + anioActual);
      if (itLiq.hasNext()) {
        urlLiq = itLiq.next().getUrl();
      }
    }

    // --- Header de la Empresa ---
    sheet.getRange(filaActual, 2, 1, 4).merge()
      .setValue('🏢 ' + (indexEmpresa + 1) + '. ' + ruc + ' - ' + nombre)
      .setFontWeight('bold')
      .setFontSize(11)
      .setFontColor('#FFFFFF')
      .setBackground(activo ? '#1E40AF' : '#475569')
      .setVerticalAlignment('middle');

    var linkCarpeta = urlCarpetaEmp ? '=HYPERLINK("' + urlCarpetaEmp + '", "📂 Abrir en Drive")' : '(Sin carpeta)';
    sheet.getRange(filaActual, 6).merge()
      .setValue(linkCarpeta)
      .setFontWeight('bold')
      .setFontSize(9)
      .setFontColor('#FFFFFF')
      .setBackground(activo ? '#2563EB' : '#64748B')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    var linkLiq = urlLiq ? '=HYPERLINK("' + urlLiq + '", "📊 Liquidación ' + anioActual + '")' : '⚪ Sin liquidación';
    sheet.getRange(filaActual, 7, 1, 2).merge()
      .setValue(linkLiq)
      .setFontWeight('bold')
      .setFontSize(9)
      .setFontColor('#FFFFFF')
      .setBackground(urlLiq ? '#059669' : '#64748B')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    sheet.setRowHeight(filaActual, 28);
    filaActual++;

    // --- Cabecera de la Tabla Mensual ---
    var headersTabla = ['Mes', 'Periodo', 'Registro Ventas', 'Registro Compras', 'Archivos ZIP / XML', 'Planilla Liquidación', 'Estado', 'Última Actualización'];
    sheet.getRange(filaActual, 2, 1, headersTabla.length).setValues([headersTabla])
      .setFontWeight('bold')
      .setFontSize(9)
      .setFontColor('#334155')
      .setBackground('#E2E8F0')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(filaActual, 22);
    filaActual++;

    // Pre-escanear subcarpetas de Venta y Compra de esta empresa una sola vez
    var mapaArchivosEmpresa = preEscanearArchivosEmpresaRapido_(carpetaEmpresa, anioActual);

    // --- Filas de los 12 meses ---
    var filasMeses = [];
    var coloresFila = [];

    for (var m = 1; m <= 12; m++) {
      var mesNombre = MESES_NOMBRE_[m - 1];
      var periodoStr = anioActual + ('' + m).padStart(2, '0');

      var infoVenta = mapaArchivosEmpresa['venta_' + m] || { existe: false, url: '', tieneZip: false };
      var infoCompra = mapaArchivosEmpresa['compra_' + m] || { existe: false, url: '', tieneZip: false };

      var txtVenta = infoVenta.existe ? '=HYPERLINK("' + infoVenta.url + '", "📄 Venta ' + periodoStr + '")' : '⚪ Pendiente';
      var txtCompra = infoCompra.existe ? '=HYPERLINK("' + infoCompra.url + '", "📄 Compra ' + periodoStr + '")' : '⚪ Pendiente';
      
      var tieneZips = (infoVenta.tieneZip || infoCompra.tieneZip);
      var txtZip = tieneZips ? '📦 Guardados' : '⚪ No disponible';

      var txtLiqMes = urlLiq ? '=HYPERLINK("' + urlLiq + '", "📊 Ver IGV ' + mesNombre + '")' : '⚪ Pendiente';

      var estadoGlobal = '⚪ Sin descargar';
      var colorEstado = '#F1F5F9';
      if (infoVenta.existe && infoCompra.existe) {
        estadoGlobal = '🟢 Completo';
        colorEstado = '#DCFCE7';
      } else if (infoVenta.existe || infoCompra.existe) {
        estadoGlobal = '🟡 Parcial';
        colorEstado = '#FEF9C3';
      }

      // Fecha/hora de última actualización del archivo de Drive más reciente del mes
      var fechaActualizacion = '';
      var maxDate = null;
      if (infoVenta.existe && infoVenta.lastUpdated) {
        if (!maxDate || infoVenta.lastUpdated > maxDate) maxDate = infoVenta.lastUpdated;
      }
      if (infoCompra.existe && infoCompra.lastUpdated) {
        if (!maxDate || infoCompra.lastUpdated > maxDate) maxDate = infoCompra.lastUpdated;
      }
      if (maxDate) {
        fechaActualizacion = Utilities.formatDate(maxDate, 'America/Lima', 'dd/MM/yyyy HH:mm');
      }

      filasMeses.push([
        mesNombre,
        periodoStr,
        txtVenta,
        txtCompra,
        txtZip,
        txtLiqMes,
        estadoGlobal,
        fechaActualizacion
      ]);

      coloresFila.push(colorEstado);
    }

    var rangoDatos = sheet.getRange(filaActual, 2, 12, headersTabla.length);
    rangoDatos.setValues(filasMeses)
      .setFontSize(9)
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('center');

    sheet.getRange(filaActual, 4, 12, 2).setHorizontalAlignment('left');
    // Columna "Ultima Actualizacion" - texto, centrado
    sheet.getRange(filaActual, 9, 12, 1).setHorizontalAlignment('center').setFontColor('#64748B');

    for (var r = 0; r < 12; r++) {
      sheet.setRowHeight(filaActual + r, 20);
      sheet.getRange(filaActual + r, 8).setBackground(coloresFila[r]).setFontWeight('bold');
    }

    sheet.getRange(filaActual - 1, 2, 13, headersTabla.length)
      .setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    filaActual += 13;
    sheet.setRowHeight(filaActual, 16);
    filaActual++;
  });

  ajustarColumnasDashboard_(sheet);
  limpiarHojasVacias_(ss);
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
function ajustarColumnasDashboard_(sheet) {
  sheet.setColumnWidth(1, 20);  // Margen izquierdo
  sheet.setColumnWidth(2, 65);  // Mes
  sheet.setColumnWidth(3, 85);  // Periodo
  sheet.setColumnWidth(4, 190); // Registro Ventas (Link)
  sheet.setColumnWidth(5, 190); // Registro Compras (Link)
  sheet.setColumnWidth(6, 140); // Archivos ZIP / XML
  sheet.setColumnWidth(7, 160); // Planilla Liquidacion (Link)
  sheet.setColumnWidth(8, 120); // Estado
  sheet.setColumnWidth(9, 140); // Última Actualización
}

