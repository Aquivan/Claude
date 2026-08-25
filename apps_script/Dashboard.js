/**
 * Dashboard.js
 * Construye y actualiza la pestana principal "Panel de Control" (Caratula)
 * en la hoja de calculo unificada.
 *
 * Funcionalidades:
 *   - Banner institucional con resumen de empresas y carpetas de Drive.
 *   - Accesos directos / Botones para abrir la carpeta raiz de SIRE en Drive,
 *     la carpeta de cada empresa, sus planillas de liquidacion IGV y las hojas mensuales.
 *   - Matriz por empresa y periodo con indicadores de estado:
 *       🟢 Descargado (con enlace directo al Sheet de Venta o Compra)
 *       ⚪ Pendiente (sin archivo en Drive todavia)
 */

function menuActualizarPanelDeControl() {
  var ui = SpreadsheetApp.getUi();
  try {
    generarPanelDeControl_();
    ui.alert('Panel de Control actualizado', 'El Panel de Control se ha actualizado con el estado mas reciente de Drive y GitHub.', ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('Error actualizando Panel de Control: ' + e.message + '\n' + e.stack);
    ui.alert('Error', 'No se pudo actualizar el Panel de Control: ' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Escanea Drive y GitHub para construir la caratula interactiva.
 */
function generarPanelDeControl_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = obtenerOCrearHoja_(ss, 'Panel de Control');

  // Asegurar que sea la primera pestana
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
  } catch (e) {}

  var raiz = obtenerCarpetaRaiz_();
  var urlRaiz = raiz ? raiz.getUrl() : '';
  var anioActual = new Date().getFullYear();

  // -------------------------------------------------------------
  // 1. BANNER INSTITUCIONAL (Header)
  // -------------------------------------------------------------
  sheet.setRowHeight(1, 15); // margen superior

  // Titulo principal
  sheet.getRange('B2:H2').merge()
    .setValue('📊 SIRE SUNAT — PANEL DE CONTROL & NAVEGACIÓN CENTRAL')
    .setFontWeight('bold')
    .setFontSize(14)
    .setFontColor('#FFFFFF')
    .setBackground('#1E293B')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(2, 38);

  // Subtitulo con metadatos
  var fechaHora = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm:ss');
  var textoSub = 'Última actualización: ' + fechaHora + '  |  Empresas registradas: ' + empresas.length + '  |  Año: ' + anioActual;
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
  sheet.setRowHeight(4, 12); // espacio

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

  sheet.setRowHeight(6, 15); // espacio

  // -------------------------------------------------------------
  // 3. TABLA DE EMPRESAS Y PERIODOS
  // -------------------------------------------------------------
  var filaActual = 7;

  if (empresas.length === 0) {
    sheet.getRange(filaActual, 2, 1, 7).merge()
      .setValue('No se encontraron empresas configuradas en empresas.json o falta configurar GitHub.')
      .setFontColor('#64748B')
      .setHorizontalAlignment('center');
    ajustarColumnasDashboard_(sheet);
    return;
  }

  // Iterar por cada empresa
  empresas.forEach(function(emp, indexEmpresa) {
    var ruc = emp.ruc;
    var nombre = emp.nombre || ruc;
    var activo = emp.activo;

    // Buscar carpeta de la empresa en Drive
    var carpetaEmpresa = null;
    var urlCarpetaEmp = '';
    try {
      carpetaEmpresa = obtenerCarpetaRUC_(raiz, ruc, nombre);
      if (carpetaEmpresa) urlCarpetaEmp = carpetaEmpresa.getUrl();
    } catch (e) {}

    // Buscar si existe planilla de liquidacion para este anio
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
    var headersTabla = ['Mes', 'Periodo', 'Registro Ventas', 'Registro Compras', 'Archivos ZIP / XML', 'Planilla Liquidación', 'Estado'];
    sheet.getRange(filaActual, 2, 1, headersTabla.length).setValues([headersTabla])
      .setFontWeight('bold')
      .setFontSize(9)
      .setFontColor('#334155')
      .setBackground('#E2E8F0')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(filaActual, 22);
    filaActual++;

    // --- Filas de los 12 meses ---
    var filasMeses = [];
    var coloresFila = [];

    for (var m = 1; m <= 12; m++) {
      var mesNombre = MESES_NOMBRE_[m - 1];
      var periodoStr = anioActual + ('' + m).padStart(2, '0');

      // Consultar archivos de ese mes en Drive
      var infoVenta = buscarArchivoPeriodoDrive_(carpetaEmpresa, 'venta', anioActual, m, periodoStr);
      var infoCompra = buscarArchivoPeriodoDrive_(carpetaEmpresa, 'compra', anioActual, m, periodoStr);

      var txtVenta = infoVenta.existe ? '=HYPERLINK("' + infoVenta.url + '", "📄 Venta (' + infoVenta.filas + ' filas)")' : '⚪ Pendiente';
      var txtCompra = infoCompra.existe ? '=HYPERLINK("' + infoCompra.url + '", "📄 Compra (' + infoCompra.filas + ' filas)")' : '⚪ Pendiente';
      
      var tieneZips = (infoVenta.tieneZip || infoCompra.tieneZip);
      var txtZip = tieneZips ? '📦 Guardados' : '⚪ No disponible';

      var txtLiqMes = urlLiq ? '=HYPERLINK("' + urlLiq + '", "📊 Ver IGV ' + mesNombre + '")' : '⚪ Pendiente';

      var estadoGlobal = '⚪ Sin descargar';
      var colorEstado = '#F1F5F9';
      if (infoVenta.existe && infoCompra.existe) {
        estadoGlobal = '🟢 Completo';
        colorEstado = '#DCFCE7'; // Verde claro
      } else if (infoVenta.existe || infoCompra.existe) {
        estadoGlobal = '🟡 Parcial';
        colorEstado = '#FEF9C3'; // Amarillo claro
      }

      filasMeses.push([
        mesNombre,
        periodoStr,
        txtVenta,
        txtCompra,
        txtZip,
        txtLiqMes,
        estadoGlobal
      ]);

      coloresFila.push(colorEstado);
    }

    // Escribir los 12 meses
    var rangoDatos = sheet.getRange(filaActual, 2, 12, headersTabla.length);
    rangoDatos.setValues(filasMeses)
      .setFontSize(9)
      .setVerticalAlignment('middle')
      .setHorizontalAlignment('center');

    // Aplicar alineacion a la izquierda en columnas de links
    sheet.getRange(filaActual, 4, 12, 2).setHorizontalAlignment('left');

    // Aplicar colores de estado y bordes
    for (var r = 0; r < 12; r++) {
      sheet.setRowHeight(filaActual + r, 20);
      sheet.getRange(filaActual + r, 8).setBackground(coloresFila[r]).setFontWeight('bold');
    }

    // Bordes exteriores de la tabla
    sheet.getRange(filaActual - 1, 2, 13, headersTabla.length)
      .setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);

    filaActual += 13;
    sheet.setRowHeight(filaActual, 16); // Separador entre empresas
    filaActual++;
  });

  ajustarColumnasDashboard_(sheet);

  // Borrar "Sheet1" si todavia existe y ya tenemos el Panel de Control
  limpiarHojasVacias_(ss);
}

/**
 * Busca si un archivo de periodo existe en su respectiva subcarpeta en Drive.
 */
function buscarArchivoPeriodoDrive_(carpetaEmpresa, tipo, anio, mes, periodoStr) {
  if (!carpetaEmpresa) return { existe: false, url: '', filas: 0, tieneZip: false };

  var nombreTipo = (tipo === 'venta' ? 'Venta' : 'Compra');
  var itTipo = carpetaEmpresa.getFoldersByName(nombreTipo);
  if (!itTipo.hasNext()) return { existe: false, url: '', filas: 0, tieneZip: false };

  var itAnio = itTipo.next().getFoldersByName(String(anio));
  if (!itAnio.hasNext()) return { existe: false, url: '', filas: 0, tieneZip: false };

  var itMes = itAnio.next().getFoldersByName(MESES_CARPETA_[mes - 1]);
  if (!itMes.hasNext()) return { existe: false, url: '', filas: 0, tieneZip: false };

  var cMes = itMes.next();
  var itArchivo = cMes.getFilesByName(nombreTipo + ' ' + periodoStr);

  var tieneZip = false;
  var itZips = cMes.getFiles();
  while (itZips.hasNext()) {
    var fn = itZips.next().getName().toLowerCase();
    if (fn.indexOf('.zip') !== -1 || fn.indexOf('.xml') !== -1) {
      tieneZip = true;
      break;
    }
  }

  if (itArchivo.hasNext()) {
    var file = itArchivo.next();
    var filasCount = 0;
    try {
      var ssTemp = SpreadsheetApp.open(file);
      var sh = ssTemp.getSheetByName('Datos') || ssTemp.getSheets()[0];
      if (sh) filasCount = Math.max(0, sh.getLastRow() - 1);
    } catch (e) {}

    return {
      existe: true,
      url: file.getUrl(),
      filas: filasCount,
      tieneZip: tieneZip
    };
  }

  return { existe: false, url: '', filas: 0, tieneZip: tieneZip };
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
}
