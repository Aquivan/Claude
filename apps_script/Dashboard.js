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

  // Fila 2: Título principal con gradiente oscuro
  sheet.getRange('B2:H2').merge()
    .setValue('📊  SIRE SUNAT — PANEL DE CONTROL & NAVEGACIÓN')
    .setFontWeight('bold')
    .setFontSize(15)
    .setFontColor('#F8FAFC')
    .setBackground('#0F172A')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(2, 42);

  var fechaHora = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm:ss');
  var textoSub = '🕐  Actualizado: ' + fechaHora + '    ·    🏢  ' + empresas.length + ' empresa(s)    ·    📅  Año ' + anioActual;
  sheet.getRange('B3:H3').merge()
    .setValue(textoSub)
    .setFontSize(9)
    .setFontColor('#7DD3FC')
    .setBackground('#0F172A')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(3, 26);

  // Separador decorativo
  sheet.getRange('B4:H4').merge()
    .setBackground('#1E3A5F');
  sheet.setRowHeight(4, 4);

  // -------------------------------------------------------------
  // 2. BOTONERA DE ACCESO RAPIDO (Cards / Links)
  // -------------------------------------------------------------
  sheet.setRowHeight(5, 14);

  var formulaDrive = urlRaiz ? '=HYPERLINK("' + urlRaiz + '", "📁  Abrir Carpeta Raíz en Google Drive")' : 'Carpeta no disponible';
  sheet.getRange('B6:C6').merge()
    .setValue(formulaDrive)
    .setFontWeight('bold')
    .setFontSize(9)
    .setFontColor('#1E40AF')
    .setBackground('#DBEAFE')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#93C5FD', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sheet.getRange('D6:H6').merge()
    .setValue('ℹ️  Usa el menú  SIRE SUNAT  para Descargar archivos, Importar datos o Generar Liquidaciones IGV')
    .setFontSize(9)
    .setFontColor('#64748B')
    .setBackground('#F8FAFC')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(6, 30);

  sheet.setRowHeight(7, 16);

  // -------------------------------------------------------------
  // 3. TABLA DE EMPRESAS Y PERIODOS
  // -------------------------------------------------------------
  var filaActual = 8;

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

    // -------------------------------------------------------
    // --- HEADER DE EMPRESA: número + nombre (col B-D) ---
    var AZUL_EMP = activo ? '#1E3A5F' : '#374151';
    var AZUL_BTN = activo ? '#2563EB' : '#6B7280';
    var VERDE_BTN = urlLiq ? '#047857' : '#6B7280';

    // Número e indicador activo/inactivo (col B)
    sheet.getRange(filaActual, 2).setValue(activo ? '▶' : '■')
      .setFontWeight('bold').setFontSize(14).setFontColor(activo ? '#38BDF8' : '#9CA3AF')
      .setBackground(AZUL_EMP).setHorizontalAlignment('center').setVerticalAlignment('middle');

    // Nombre empresa (col C-E)
    sheet.getRange(filaActual, 3, 1, 3).merge()
      .setValue((indexEmpresa + 1) + '.  ' + ruc + '  —  ' + nombre)
      .setFontWeight('bold').setFontSize(10).setFontColor('#E2E8F0')
      .setBackground(AZUL_EMP).setVerticalAlignment('middle');

    // Botón: Abrir en Drive (col F-G)
    var linkCarpeta = urlCarpetaEmp ? '=HYPERLINK("' + urlCarpetaEmp + '", "📂  Abrir en Drive")' : '(Sin carpeta)';
    sheet.getRange(filaActual, 6, 1, 2).merge()
      .setValue(linkCarpeta)
      .setFontWeight('bold').setFontSize(9).setFontColor('#FFFFFF')
      .setBackground(AZUL_BTN).setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(false, true, false, true, false, false, '#1E3A5F', SpreadsheetApp.BorderStyle.SOLID);

    // Botón: Liquidación anual (col H — solo 1 por empresa) (col H)
    var linkLiq = urlLiq
      ? '=HYPERLINK("' + urlLiq + '", "📊  Liquidación IGV ' + anioActual + '")'
      : '⚪  Sin liquidación';
    sheet.getRange(filaActual, 8)
      .setValue(linkLiq)
      .setFontWeight('bold').setFontSize(9).setFontColor('#FFFFFF')
      .setBackground(VERDE_BTN).setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(false, true, false, true, false, false, '#1E3A5F', SpreadsheetApp.BorderStyle.SOLID);

    sheet.setRowHeight(filaActual, 30);
    filaActual++;

    // --- CABECERA TABLA MENSUAL (6 columnas: sin ZIP/XML ni Liquidación mensual) ---
    var headersTabla = ['Mes', 'Período', 'Registro Ventas', 'Registro Compras', 'Estado', 'Última Actualización'];
    var NUM_COLS = headersTabla.length;
    sheet.getRange(filaActual, 2, 1, NUM_COLS).setValues([headersTabla])
      .setFontWeight('bold').setFontSize(9)
      .setFontColor('#1E3A5F').setBackground('#BFDBFE')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.setRowHeight(filaActual, 22);
    filaActual++;

    // Pre-escanear subcarpetas de Venta y Compra de esta empresa una sola vez
    var mapaArchivosEmpresa = preEscanearArchivosEmpresaRapido_(carpetaEmpresa, anioActual);

    // --- FILAS DE LOS 12 MESES ---
    var filasMeses = [];
    var coloresFila = [];

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

    filaActual += 13;
    sheet.setRowHeight(filaActual, 18);
    filaActual++;
  });

  ajustarColumnasDashboard_(sheet);
  limpiarHojasVacias_(ss);
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
function ajustarColumnasDashboard_(sheet) {
  sheet.setColumnWidth(1, 18);  // Margen izquierdo
  sheet.setColumnWidth(2, 40);  // B: Indicador activo (▶) / "Mes" en tabla
  sheet.setColumnWidth(3, 200); // C: Nombre empresa (parte de merge C-E) / "Período" en tabla
  sheet.setColumnWidth(4, 170); // D: (parte del merge C-E) / "Registro Ventas"
  sheet.setColumnWidth(5, 170); // E: (parte del merge C-E) / "Registro Compras"
  sheet.setColumnWidth(6, 145); // F: Botón Abrir en Drive (merge F-G) / "Estado"
  sheet.setColumnWidth(7, 145); // G: (parte merge F-G) / "Última Actualización"
  sheet.setColumnWidth(8, 155); // H: Botón Liquidación IGV (cabecera empresa únicamente)
}

