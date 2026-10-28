/**
 * 🚚 Guías — arma y repara las pestañas (nunca borra datos). Se arma solo la primera vez que se abre
 * la hoja; después, menú 🚚 Guías → 🧰 Preparar / reparar la hoja.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🚚 Guías')
    .addItem('➕ Nueva guía rápida (solo empresa y factura)', 'GR_menuNuevaRapida')
    .addItem('➕ Nueva guía (formulario)', 'GR_menuNueva')
    .addItem('✏️ Editar la guía seleccionada', 'GR_menuEditar')
    .addItem('📄 Duplicar la guía seleccionada', 'GR_menuDuplicar')
    .addItem('🚛 Copiar transporte de la guía anterior', 'GR_menuCopiarTransporte')
    .addSeparator()
    .addItem('🔍 Revisar todas las guías', 'GR_menuRevisar')
    .addItem('📦 Ver productos de la guía seleccionada', 'GR_menuProductos')
    .addItem('📥 Traer datos de la factura (SIRE o Quesito)', 'GR_menuTraerDatos')
    .addItem('📦 Elegir productos y cantidades de la guía', 'GR_menuElegirProductos')
    .addItem('📄 Ver la factura de la guía (vista previa)', 'GR_menuVerFactura')
    .addItem('📍 Buscar direcciones por RUC (locales en SUNAT)', 'GR_menuBuscarDirecciones')
    .addItem('🚛 Buscar transportista o placa en el MTC (certificados)', 'GR_menuBuscarTransporte')
    .addItem('👤 Completar conductor por DNI (nombre)', 'GR_menuConductorDni')
    .addSeparator()
    .addItem('👁 Vista previa de la guía seleccionada (no emite)', 'GR_menuVista')
    .addItem('✅ Emitir la guía seleccionada', 'GR_menuEmitir')
    .addItem('🔄 Traer resultados del robot', 'GR_menuResultados')
    .addItem('📋 Resumen del día (emitidas y por emitir)', 'GR_menuResumen')
    .addSeparator()
    .addItem('👁 Ver solo lo que aplica a la guía seleccionada', 'GR_menuVistaGuia')
    .addItem('👁 Ver todas las columnas', 'GR_menuVistaTodo')
    .addSeparator()
    .addItem('📥 Importar datos (del Excel de guías)', 'GR_menuImportar')
    .addItem('🔑 Token de GitHub (para leer facturas del SIRE)', 'GR_menuToken')
    .addSeparator()
    .addItem('🧰 Preparar / reparar la hoja', 'GR_menuPreparar')
    .addItem('📖 Ayuda', 'GR_menuAyuda')
    .addToUi();
  var ss = SpreadsheetApp.getActive();
  // Si el código trae una versión nueva de la hoja (columnas, listas), se repara sola al abrir.
  var props = PropertiesService.getDocumentProperties();
  if (ss.getSheetByName(GR_HOJA_) && props.getProperty('GR_VERSION') !== String(GR_VERSION_)) {
    try { GR_preparar_(ss); props.setProperty('GR_VERSION', String(GR_VERSION_)); ss.toast('La hoja se actualizó (columnas y listas nuevas). No se borró ningún dato.', '🚚 Guías', 8); }
    catch (e) { ss.toast('La hoja necesita actualizarse: use el menú 🚚 Guías → 🧰 Preparar / reparar la hoja (no borra datos).', '🚚 Guías', 30); }
  }
  if (!ss.getSheetByName(GR_HOJA_)) {
    try { GR_preparar_(ss); props.setProperty('GR_VERSION', String(GR_VERSION_)); ss.toast('La hoja quedó lista. Empiece por 🏢 Empresas (serie de guía y dirección de partida).', '🚚 Guías', 10); }
    catch (e) { ss.toast('No se pudo armar sola: use 🚚 Guías → 🧰 Preparar / reparar la hoja. (' + e.message + ')', '🚚 Guías', 15); }
  }
}

function GR_menuPreparar() {
  var ss = SpreadsheetApp.getActive();
  GR_preparar_(ss);
  PropertiesService.getDocumentProperties().setProperty('GR_VERSION', String(GR_VERSION_));
  GR_revisarTodo_(ss);
  ss.toast('Pestañas, listas y formatos al día. No se borró ningún dato.', '🚚 Guías', 6);
}

function GR_menuAyuda() { SpreadsheetApp.getActive().getSheetByName(GR_AYU_).activate(); }

/** Crea lo que falte y vuelve a poner encabezados, formatos y listas. */
function GR_preparar_(ss) {
  var g = GR_hojaGuias_(ss);
  GR_hojaProductos_(ss);
  Object.keys(GR_CATALOGOS_).forEach(function (n) { GR_hojaCatalogo_(ss, n); });
  GR_hojaUbigeos_(ss);
  GR_hojaRegistro_(ss);
  GR_hojaAyuda_(ss);
  GR_validacionesGuias_(ss, g);
  GR_validacionesCatalogos_(ss);
  // Orden de las pestañas.
  [GR_HOJA_, GR_PROD_, GR_EMP_, GR_TRA_, GR_VEH_, GR_CON_, GR_DIR_, GR_REG_, GR_AYU_, GR_UBI_].forEach(function (n, i) {
    var sh = ss.getSheetByName(n);
    if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); }
  });
  var h1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Hoja1');
  if (h1 && h1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h1);
  g.activate();
}

function GR_hoja_(ss, nombre, color) {
  var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  if (color) sh.setTabColor(color);
  return sh;
}

/** Mezcla un color con blanco (f = 0..1, cuánto blanco). */
function GR_aclarar_(hex, f) {
  var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  var m = function (c) { return ('0' + Math.round(c + (255 - c) * f).toString(16)).slice(-2); };
  return '#' + m(r) + m(g) + m(b);
}

function GR_letra_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* ============================================================ 🚚 Guías */

/**
 * Si los títulos cambiaron (columnas nuevas o en otro orden) y ya hay datos, los reacomoda por el título de
 * su columna para que nada quede corrido. alias = {título viejo: título nuevo}.
 */
function GR_reacomodar_(sh, filaTit, titulos, alias) {
  var ultC = sh.getLastColumn(), ultF = sh.getLastRow();
  if (ultC < 1 || ultF <= filaTit) return;
  var viejos = sh.getRange(filaTit, 1, 1, ultC).getValues()[0].map(function (t) { t = String(t).trim(); return (alias && alias[t]) || t; });
  if (viejos.slice(0, titulos.length).join('|') === titulos.join('|')) return;
  var datos = sh.getRange(filaTit + 1, 1, ultF - filaTit, ultC).getValues();
  var nuevos = datos.map(function (f) {
    return titulos.map(function (t) { var j = viejos.indexOf(t); return j >= 0 ? f[j] : ''; });
  });
  sh.getRange(filaTit + 1, 1, datos.length, ultC).clearContent();
  if (sh.getMaxColumns() < titulos.length) sh.insertColumnsAfter(sh.getMaxColumns(), titulos.length - sh.getMaxColumns());
  sh.getRange(filaTit + 1, 1, nuevos.length, titulos.length).setValues(nuevos);
}

function GR_hojaGuias_(ss) {
  var sh = GR_hoja_(ss, GR_HOJA_, '#e65100'), n = GR_COLS_.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  // Las listas viejas se quitan ANTES de mover datos (si no, un dato movido choca con la lista de la columna vieja).
  sh.getRange(GR_FILA1_, 1, sh.getMaxRows() - GR_FILA1_ + 1, sh.getMaxColumns()).clearDataValidations();
  GR_reacomodar_(sh, 2, GR_COLS_.map(function (c) { return c.t; }));
  if (sh.getMaxRows() < 500) sh.insertRowsAfter(sh.getMaxRows(), 500 - sh.getMaxRows());
  // Fila 1: bandas por grupo. Primero se descongelan las columnas: una banda no puede quedar mitad fija y mitad móvil.
  sh.setFrozenColumns(0);
  sh.getRange(1, 1, 1, Math.max(n, sh.getLastColumn())).breakApart();
  var ini = 0;
  for (var i = 1; i <= n; i++) {
    if (i < n && GR_COLS_[i].g === GR_COLS_[ini].g) continue;
    var grp = GR_GRUPOS_[GR_COLS_[ini].g], r = sh.getRange(1, ini + 1, 1, i - ini);
    if (i - ini > 1) r.merge();
    r.setValue(grp[0]).setBackground(grp[1]).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
    ini = i;
  }
  // Fila 2: títulos con su nota.
  sh.getRange(2, 1, 1, n).setValues([GR_COLS_.map(function (c) { return c.t; })])
    .setFontWeight('bold').setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center').setFontColor('#263238');
  // Se limpian formatos y listas de la zona de datos antes de aplicarlos: si cambió el orden de las columnas, nada queda corrido.
  var zona = sh.getRange(GR_FILA1_, 1, sh.getMaxRows() - GR_FILA1_ + 1, n);
  zona.clearDataValidations().setBackground(null).setFontColor(null).setFontSize(10).setWrap(false);
  GR_COLS_.forEach(function (c, j) {
    var col = GR_GRUPOS_[c.g][1];
    sh.getRange(2, j + 1).setBackground(GR_aclarar_(col, 0.82)).setNote(c.n || '')
      .setBorder(null, null, true, null, null, null, col, SpreadsheetApp.BorderStyle.SOLID_THICK);
    sh.setColumnWidth(j + 1, c.w);
    var datos = sh.getRange(GR_FILA1_, j + 1, sh.getMaxRows() - GR_FILA1_ + 1, 1);
    datos.setNumberFormat(c.f || '@');
    if (c.g === 'res' || c.k === 'obsFinal' || c.k === 'productos' || c.k === 'total') datos.setBackground('#f5f5f5').setFontColor('#37474f');   // automáticas
    if (c.k === 'obsFinal') datos.setWrap(true).setFontSize(9);
  });
  sh.setRowHeight(1, 40); sh.setRowHeight(2, 44);
  sh.setFrozenRows(2); sh.setFrozenColumns(GR_COLS_.filter(function (c) { return c.g === 'id'; }).length);   // fija toda la banda 🆔 GUÍA
  sh.getRange(GR_FILA1_, 1, sh.getMaxRows() - GR_FILA1_ + 1, n).setVerticalAlignment('middle');
  sh.getRange(GR_FILA1_, GR_col_('id'), sh.getMaxRows() - GR_FILA1_ + 1, 1).setFontColor('#607d8b').setFontSize(9);
  sh.getRange(GR_FILA1_, GR_col_('estado'), sh.getMaxRows() - GR_FILA1_ + 1, 1).setWrap(true).setFontSize(9);
  GR_formatoCondicional_(sh);
  try { GR_botonFactura_(sh); } catch (e) { console.warn('botón Ver factura: ' + e.message); }   // 📄 fijo arriba a la izquierda
  // ID, estado y resultado los pone el sistema: aviso si alguien los cambia a mano.
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (/^GR /.test(p.getDescription())) p.remove(); });
  [['id', 'estado'], ['guia', 'actualizado']].forEach(function (par) {
    sh.getRange(GR_FILA1_, GR_col_(par[0]), sh.getMaxRows() - GR_FILA1_ + 1, GR_col_(par[1]) - GR_col_(par[0]) + 1)
      .protect().setDescription('GR ' + par[0] + ' (lo llena el sistema)').setWarningOnly(true);
  });
  return sh;
}

function GR_formatoCondicional_(sh) {
  var n = GR_COLS_.length, filas = sh.getMaxRows() - GR_FILA1_ + 1, L = function (k) { return GR_letra_(GR_col_(k)); };
  var rango = function (k1, k2) { return sh.getRange(GR_FILA1_, GR_col_(k1), filas, GR_col_(k2 || k1) - GR_col_(k1) + 1); };
  var reglas = [];
  var est = rango('estado');
  [[GR_ESTADOS_.BORRADOR, '#fff8e1', '#8d6e00'], [GR_ESTADOS_.LISTA, '#e8f5e9', '#1b5e20'], [GR_ESTADOS_.VISTA, '#e3f2fd', '#0d47a1'],
   [GR_ESTADOS_.EMITIENDO, '#ede7f6', '#4527a0'], [GR_ESTADOS_.EMITIDA, '#c8e6c9', '#1b5e20'], [GR_ESTADOS_.ERROR, '#ffebee', '#b71c1c'],
   [GR_ESTADOS_.ANULADA, '#eceff1', '#78909c']].forEach(function (e) {
    reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith(e[0]).setBackground(e[1]).setFontColor(e[2]).setRanges([est]).build());
  });
  var gris = function (r, formula) {
    reglas.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground('#eceff1').setFontColor('#9e9e9e').setRanges([r]).build());
  };
  var f = GR_FILA1_;
  gris(rango('truc', 'mtc'), '=LEFT($' + L('modalidad') + f + ',2)="02"');                                   // privado: sin transportista
  gris(rango('placa', 'clic'), '=$' + L('m1') + f + '="SI"');   // M1/L: sin vehículo ni conductor
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(LEFT($' + L('modalidad') + f + ',2)="01",$' + L('m1') + f + '<>"SI")')
    .setBackground('#f3f8f3').setFontColor('#546e7a').setRanges([rango('placa', 'clic')]).build());   // público: opcional (tono suave, no gris)
  gris(rango('motivoTxt'), '=LEFT($' + L('motivo') + f + ',2)<>"13"');
  gris(rango('pest'), '=LEFT($' + L('motivo') + f + ',2)<>"04"');
  gris(rango('lest'), '=LEFT($' + L('motivo') + f + ',2)<>"04"');
  gris(rango('serie', 'numero'), '=$' + L('docrel') + f + '="Ninguno"');
  // Fila de una guía emitida o anulada: toda en verde/gris suave.
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH($' + L('estado') + f + ',"^🚚")').setBackground('#f1f8e9')
    .setRanges([sh.getRange(f, GR_col_('empresa'), filas, GR_col_('productos') - GR_col_('empresa') + 1)]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=REGEXMATCH($' + L('estado') + f + ',"^🚫")').setFontColor('#9e9e9e').setStrikethrough(true)
    .setRanges([sh.getRange(f, GR_col_('empresa'), filas, GR_col_('productos') - GR_col_('empresa') + 1)]).build());
  sh.setConditionalFormatRules(reglas);
}

function GR_validacionesGuias_(ss, sh) {
  var filas = sh.getMaxRows() - GR_FILA1_ + 1;
  var emp = ss.getSheetByName(GR_EMP_), ubi = ss.getSheetByName(GR_UBI_), dir = ss.getSheetByName(GR_DIR_);
  GR_COLS_.forEach(function (c) {
    if (!c.v) return;
    var r = sh.getRange(GR_FILA1_, GR_col_(c.k), filas, 1), b = SpreadsheetApp.newDataValidation();
    if (Array.isArray(c.v)) b.requireValueInList(c.v, true).setAllowInvalid(false);
    else if (c.v === 'empresas') b.requireValueInRange(emp.getRange('A2:A'), true).setAllowInvalid(false).setHelpText('Elija una empresa de 🏢 Empresas.');
    else if (c.v === 'ubigeo') b.requireValueInRange(ubi.getRange('E2:E'), true).setAllowInvalid(true)
      .setHelpText('Elija el distrito de la lista, o escriba su nombre (ej. "santa anita") o el código de 6 dígitos y se completa solo.');
    else if (c.v === 'fecha') b.requireDate().setAllowInvalid(false).setHelpText('Fecha, ej. 28/08/2026.');
    else if (c.v === 'locales') b.requireValueInRange(dir.getRange('A2:A'), true).setAllowInvalid(true).setHelpText('Elija un local de 📍 Direcciones (o deje vacío y escriba la dirección).');
    else if (/^cat:/.test(c.v)) {   // lista de un catálogo (🚗 🚛 👤 📍): se elige o se escribe uno nuevo (la hoja lo aprende)
      var pz = c.v.split(':'), hc = ss.getSheetByName({ dir: GR_DIR_, tra: GR_TRA_, veh: GR_VEH_, con: GR_CON_ }[pz[1]]);
      if (!hc) return;
      b.requireValueInRange(hc.getRange(pz[2] + '2:' + pz[2]), true).setAllowInvalid(true).setHelpText('Elija de la lista o escriba uno nuevo (se guarda solo en su pestaña).');
    }
    else if (c.v === 'direcciones') b.requireValueInRange(dir.getRange('F2:F'), true).setAllowInvalid(true).setHelpText('Elija una dirección de 📍 Direcciones o escriba una nueva.');
    r.setDataValidation(b.build());
  });
}

/* ============================================================ 📦 Productos */

function GR_hojaProductos_(ss) {
  var sh = GR_hoja_(ss, GR_PROD_, '#ef6c00');
  var cols = [['ID guía', 85], ['N°', 40], ['Código', 90], ['Descripción del producto', 320], ['Unidad', 130], ['Cantidad', 85], ['Lote / detalle adicional', 220], ['Peso (opcional)', 90], ['Bultos (opcional)', 80], ['¿Completa?', 80]];
  GR_reacomodar_(sh, 1, cols.map(function (c) { return c[0]; }));
  sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[0]; })]).setFontWeight('bold').setBackground('#ef6c00').setFontColor('#ffffff')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  cols.forEach(function (c, i) { sh.setColumnWidth(i + 1, c[1]); });
  sh.getRange(1, 1).setNote('Solo para guías PARCIALES (¿Todo lo de la factura? = NO) o sin factura: una fila por producto que va en esa guía.\n' +
    'ID guía = el ID de la fila en 🚚 Guías (ej. G-000012). En Quesito se dejan solo estos productos con estas cantidades.');
  sh.getRange(1, 4).setNote('Como figura en la factura (📥 Traer datos de la factura lo llena, del SIRE o de Quesito): el robot busca la línea por este nombre.');
  sh.getRange(1, 10).setNote('SI = va toda la cantidad de esa línea de la factura; NO = solo una parte (la cantidad de esta fila).');
  sh.getRange(1, 8).setNote('Si todos los productos de la guía tienen peso (o bultos), la guía los suma sola.');
  sh.setRowHeight(1, 36); sh.setFrozenRows(1);
  if (sh.getMaxRows() < 300) sh.insertRowsAfter(sh.getMaxRows(), 300 - sh.getMaxRows());
  var n = sh.getMaxRows() - 1;
  sh.getRange(2, 6, n, 1).setNumberFormat('#,##0.###');
  sh.getRange(2, 8, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(2, 9, n, 1).setNumberFormat('#,##0.##');
  sh.getRange(2, 10, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(GR_SINO_, true).setAllowInvalid(false).build());
  sh.getRange(2, 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName(GR_HOJA_).getRange('A' + GR_FILA1_ + ':A'), true)
    .setAllowInvalid(false).setHelpText('ID de la guía en 🚚 Guías.').build());
  sh.getRange(2, 5, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(GR_UNIDADES_, true).setAllowInvalid(false).build());
  sh.getRange(2, 6, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false).setHelpText('Cantidad mayor que 0.').build());
  if (!sh.getBandings().length) sh.getRange(1, 1, sh.getMaxRows(), cols.length).applyRowBanding(SpreadsheetApp.BandingTheme.ORANGE, true, false);
  return sh;
}

/* ============================================================ catálogos */

function GR_hojaCatalogo_(ss, nombre) {
  var d = GR_CATALOGOS_[nombre], sh = GR_hoja_(ss, nombre, d.color), n = d.cols.length;
  GR_reacomodar_(sh, 1, d.cols.map(function (c) { return c[0]; }), { 'Nombre': 'Nombre (empresa o cliente)' });
  sh.getRange(1, 1, 1, n).setValues([d.cols.map(function (c) { return c[0]; })]).setFontWeight('bold').setBackground(d.color).setFontColor('#ffffff')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  d.cols.forEach(function (c, i) { sh.setColumnWidth(i + 1, c[1]); });
  sh.getRange(1, 1).setNote(d.nota);
  sh.setRowHeight(1, 32); sh.setFrozenRows(1);
  if (sh.getMaxRows() < 200) sh.insertRowsAfter(sh.getMaxRows(), 200 - sh.getMaxRows());
  if (!sh.getBandings().length) sh.getRange(1, 1, sh.getMaxRows(), n).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
  sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');   // RUC, DNI y placas como texto (no pierden ceros)
  if (nombre === GR_EMP_ && sh.getLastRow() < 2) sh.getRange(2, 1, GR_EMPRESAS_INICIALES_.length, n).setValues(GR_EMPRESAS_INICIALES_);
  if (nombre === GR_EMP_) sh.getRange(2, 2, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  return sh;
}

function GR_validacionesCatalogos_(ss) {
  var ubi = ss.getSheetByName(GR_UBI_).getRange('E2:E');
  var lista = function (sh, col, valores) {
    sh.getRange(2, col, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build());
  };
  var ubigeo = function (sh, col) {
    sh.getRange(2, col, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(ubi, true).setAllowInvalid(true)
      .setHelpText('Elija el distrito o escriba su nombre / código de 6 dígitos.').build());
  };
  Object.keys(GR_CATALOGOS_).forEach(function (nom) {
    var sh = ss.getSheetByName(nom);
    sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).clearDataValidations();
  });
  var e = ss.getSheetByName(GR_EMP_); ubigeo(e, 6); lista(e, 9, GR_SINO_);
  e.getRange(2, 8, e.getMaxRows() - 1, 1).setNumberFormat('@');
  lista(ss.getSheetByName(GR_TRA_), 4, GR_SINO_);
  var v = ss.getSheetByName(GR_VEH_); lista(v, 3, GR_SINO_); lista(v, 5, GR_SINO_);
  v.getRange(2, 4, v.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(e.getRange('A2:A'), true).setAllowInvalid(true).build());
  lista(ss.getSheetByName(GR_CON_), 5, GR_SINO_);
  var d = ss.getSheetByName(GR_DIR_); lista(d, 4, ['Llegada', 'Partida', 'Ambos']); ubigeo(d, 5);
  try { GR_normalizarDirecciones_(d, 2, d.getLastRow()); } catch (e) { console.warn('Direcciones: ' + e.message); }   // locales sin nombre
  d.getRange(2, 2, d.getMaxRows() - 1, 1).setNumberFormat('@'); d.getRange(2, 7, d.getMaxRows() - 1, 1).setNumberFormat('@');
  // Serie de factura por defecto (FQQ1) en las empresas que ya estaban sin ella.
  if (e.getLastRow() > 1) e.getRange(2, 1, e.getLastRow() - 1, 10).getValues().forEach(function (f, i) {
    if (String(f[0]).trim() && !String(f[9]).trim() && String(f[8]).toUpperCase() !== 'NO') e.getRange(i + 2, 10).setValue('FQQ1');
    var cod = GR_codLocal_(f[7]); if (String(f[7]) !== '' && cod !== String(f[7])) e.getRange(i + 2, 8).setValue(cod);
  });
}

/* ============================================================ 🗺️ Ubigeos, 🧾 Registro, 📖 Ayuda */

function GR_hojaUbigeos_(ss) {
  var sh = GR_hoja_(ss, GR_UBI_, '#90a4ae');
  if (sh.getLastRow() - 1 === GR_UBIGEOS_.length) return sh;
  sh.clear();
  var filas = GR_UBIGEOS_.map(function (l) { var p = l.split('|'); return [p[0], p[1], p[2], p[3], GR_etiquetaUbigeo_(l)]; });
  sh.getRange(1, 1, 1, 5).setValues([['Código', 'Departamento', 'Provincia', 'Distrito', 'Etiqueta (lo que se elige en las listas)']])
    .setFontWeight('bold').setBackground('#546e7a').setFontColor('#ffffff');
  sh.getRange(2, 1, filas.length, 1).setNumberFormat('@');
  sh.getRange(2, 1, filas.length, 5).setValues(filas);
  sh.setFrozenRows(1);
  [70, 130, 160, 200, 320].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 1).setNote('Catálogo 13 de SUNAT (UBIGEO del INEI). No hace falta editarlo.');
  sh.protect().setDescription('GR ubigeos').setWarningOnly(true);
  return sh;
}

function GR_hojaRegistro_(ss) {
  var sh = GR_hoja_(ss, GR_REG_, '#455a64');
  sh.getRange(1, 1, 1, 5).setValues([['Fecha', 'ID guía', 'Acción', 'Detalle', 'Quién']]).setFontWeight('bold').setBackground('#455a64').setFontColor('#ffffff');
  [140, 85, 160, 480, 160].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
  sh.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm:ss');
  return sh;
}

function GR_registrar_(id, accion, detalle) {
  var sh = SpreadsheetApp.getActive().getSheetByName(GR_REG_);
  if (!sh) return;
  var quien = '';
  try { quien = Session.getActiveUser().getEmail(); } catch (e) {}
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 5).setValues([[new Date(), id || '', accion, detalle || '', quien]]);
}

function GR_hojaAyuda_(ss) {
  var sh = GR_hoja_(ss, GR_AYU_, '#1565c0');
  sh.clear();
  var L = [
    ['🚚 GUÍAS DE REMISIÓN REMITENTE · GRUPO', ''],
    ['', ''],
    ['1. Una vez', 'En 🏢 Empresas complete por cada empresa: correo de Quesito, serie de guía (ej. TQQ1), ubigeo y dirección de partida. La CLAVE de Quesito no va en la hoja: se guarda como secreto en GitHub.'],
    ['', 'En 🚛 Transportistas, 🚗 Vehículos, 👤 Conductores y 📍 Direcciones ponga los que usa siempre: así cada guía se llena sola.'],
    ['2. Cada guía', 'Menú 🚚 Guías → ➕ Nueva guía (formulario), o escriba directo una fila en 🚚 Guías. El ID se pone solo.'],
    ['', 'Con la empresa se llena la partida; con el RUC del cliente, su nombre y su dirección de llegada; con el RUC del transportista, su nombre y MTC; con el DNI del conductor, sus datos.'],
    ['', 'Columnas en gris = no aplican (ej. transporte público → no se pide vehículo ni conductor).'],
    ['⚡ Lo mínimo', 'Empresa + N° de factura (serie y número) o solo el N° de cotización + transporte. Luego 🚚 Guías → 📥 Traer datos de la factura: primero mira el SIRE (al instante); si hace falta (factura de hoy, solo cotización, lotes o dirección) lee Quesito (1–3 min, no crea nada).'],
    ['', '"Producto y cantidad" (opcional): vacío o «total» = todo lo de la factura. Una parte: «M&D 325 lote 1507: 10000» o «barra: 5000» (varios con ;). Si una palabra calza con dos líneas, se le pide el lote.'],
    ['3. Parcial', 'Si la guía NO lleva todo lo de la factura: escriba "Producto y cantidad", o ponga "¿Todo lo de la factura?" = NO y los productos en 📦 Productos con el mismo ID.'],
    ['4. Estado', '✏️ Borrador = falta algo (el estado dice qué). ✅ Lista para emitir = completa. 👁 Vista previa / ⏳ Emitiendo / 🚚 Emitida / ⚠️ Error los pone el robot.'],
    ['5. Emitir', 'Menú 🚚 Guías → 👁 Vista previa (llena todo en Quesito o SUNAT sin crear; la foto llega al Telegram y aquí el enlace) y luego ✅ Emitir (pide confirmar). El N° de guía y el PDF llegan solos a la fila.'],
    ['', ''],
    ['Reglas que revisa', '• RUC con dígito verificador (detecta RUC mal escritos) · DNI de 8 dígitos · placa ABC-123'],
    ['', '• Fecha de inicio de traslado no anterior a hoy (SUNAT no acepta una fecha anterior a la emisión)'],
    ['', '• Público: RUC y razón social del transportista · Privado: placa, DNI, nombres, apellidos y licencia del conductor (salvo vehículos M1 o L)'],
    ['', '• Partida y llegada con UBIGEO válido y dirección; distintas entre sí · Motivo 04: códigos de local · Motivo 13: descripción'],
    ['', '• Parcial o sin factura: al menos un producto con cantidad en 📦 Productos'],
  ];
  sh.getRange(1, 1, L.length, 2).setValues(L).setWrap(true).setVerticalAlignment('top');
  sh.getRange(1, 1, 1, 2).merge().setFontSize(14).setFontWeight('bold').setBackground('#1565c0').setFontColor('#ffffff');
  sh.getRange(3, 1, L.length - 2, 1).setFontWeight('bold').setFontColor('#1565c0');
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 820);
  return sh;
}
