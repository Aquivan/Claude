/**
 * 🚚 Guías — 📥 importar datos preparados desde el Excel de guías (una hoja de Google con 3 columnas:
 * tipo | clave | json). Tipos: TRA (transportista), VEH (vehículo), CON (conductor), DIR (local / dirección),
 * GUIA (una guía con sus productos). No duplica: los catálogos se agregan si su clave no está, y una guía
 * no se vuelve a agregar si ya hay otra de la misma empresa, cotización, fecha, placa, partida y llegada.
 */

function GR_menuImportar() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('📥 Importar datos', 'Pegue el enlace (o el ID) de la hoja "Guías · datos para importar":', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var m = r.getResponseText().match(/[-\w]{25,}/);
  if (!m) return ui.alert('No reconozco ese enlace.');
  var res = GR_importar_(SpreadsheetApp.getActive(), SpreadsheetApp.openById(m[0]).getSheets()[0].getDataRange().getValues());
  ui.alert('📥 Importación', res, ui.ButtonSet.OK);
}

/** filas = [[tipo, clave, json], …] (la primera puede ser el encabezado). Devuelve el resumen en texto. */
function GR_importar_(ss, filas) {
  var cuenta = { TRA: 0, VEH: 0, CON: 0, DIR: 0, GUIA: 0, repetidas: 0 };
  var datos = filas.filter(function (f) { return /^(TRA|VEH|CON|DIR|GUIA)$/.test(String(f[0]).trim()); })
    .map(function (f) { return { tipo: String(f[0]).trim(), clave: String(f[1]).trim(), o: JSON.parse(String(f[2])) }; });
  // Catálogos (antes que las guías, para que el autollenado los use)
  var cat = { TRA: [GR_TRA_, function (o) { return [o.ruc, o.nom, o.mtc || '', 'SI']; }],
    VEH: [GR_VEH_, function (o) { return [o.placa, o.desc || '', o.m1 ? 'SI' : 'NO', o.empresa || '', 'SI', o.mtc || '']; }],
    CON: [GR_CON_, function (o) { return [o.dni, o.nom, o.ape, o.lic || '', 'SI']; }],
    DIR: [GR_DIR_, function (o) { return [o.local, o.doc || '', o.nom || '', o.uso || 'Llegada', o.ubi || '', o.dir || '', o.est || '', o.nota || '']; }] };
  Object.keys(cat).forEach(function (t) {
    var sh = ss.getSheetByName(cat[t][0]), ya = {};
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (v) { ya[String(v[0]).trim().toUpperCase()] = true; });
    var nuevas = datos.filter(function (d) { return d.tipo === t && !ya[d.clave.toUpperCase()]; }).map(function (d) { ya[d.clave.toUpperCase()] = true; return cat[t][1](d.o); });
    if (!nuevas.length) return;
    var desde = sh.getLastRow() + 1;
    sh.getRange(desde, 1, nuevas.length, nuevas[0].length).setValues(nuevas);
    cuenta[t] = nuevas.length;
  });
  // Guías
  var g = ss.getSheetByName(GR_HOJA_), I = GR_idx_();
  var clave = function (r) {
    var f = r.fecha instanceof Date ? Utilities.formatDate(r.fecha, 'America/Lima', 'yyyy-MM-dd') : String(r.fecha || '').slice(0, 10);
    return [r.empresa, r.cotizacion, r.numero, f, GR_placa_(r.placa), r.plocal, r.llocal].map(function (x) { return String(x == null ? '' : x).trim().toUpperCase(); }).join('|');
  };
  var existentes = {};
  var ult = GR_ultimaFilaGuias_(g);
  if (ult >= GR_FILA1_) GR_leerGuias_(g, GR_FILA1_, ult).forEach(function (x) { existentes[clave(x.r)] = true; });
  var guias = datos.filter(function (d) { return d.tipo === 'GUIA'; });
  var filaNueva = ult + 1, nuevas = [];
  guias.forEach(function (d) {
    var o = d.o;
    if (o.fecha) { var p = String(o.fecha).split('-'); o.fecha = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
    if (existentes[clave(o)]) { cuenta.repetidas++; return; }
    existentes[clave(o)] = true;
    var fila = GR_COLS_.map(function (c) { return o[c.k] == null || c.k === 'id' || c.k === 'estado' ? '' : o[c.k]; });
    g.getRange(filaNueva, 1, 1, fila.length).setValues([fila]);
    GR_procesarFilas_(ss, filaNueva, filaNueva, GR_COLS_.map(function (c) { return c.k; }));   // pone ID y autollena
    nuevas.push({ fila: filaNueva, id: String(g.getRange(filaNueva, 1).getValue()), productos: o.productos || [] });
    filaNueva++;
  });
  // Productos de cada guía nueva y revisión final
  var p = ss.getSheetByName(GR_PROD_), prods = [];
  nuevas.forEach(function (n) {
    n.productos.forEach(function (x, i) {
      prods.push([n.id, i + 1, x.cod || '', x.desc || '', x.unidad || GR_UNIDADES_[0], Number(x.cant) || '', x.lote || '', Number(x.peso) || '', Number(x.bultos) || '', x.completa || '']);
    });
  });
  if (prods.length) p.getRange(Math.max(GR_ultimaFilaProductos_(p) + 1, 2), 1, prods.length, 10).setValues(prods);
  nuevas.forEach(function (n) { GR_procesarFilas_(ss, n.fila, n.fila, ['productos']); });
  cuenta.GUIA = nuevas.length;
  GR_registrar_('', '📥 Importación', JSON.stringify(cuenta));
  var listas = 0;
  nuevas.forEach(function (n) { if (String(g.getRange(n.fila, GR_col_('estado')).getValue()).indexOf(GR_ESTADOS_.LISTA) === 0) listas++; });
  return 'Guías nuevas: ' + cuenta.GUIA + ' (' + listas + ' ✅ listas para emitir)' + (cuenta.repetidas ? ' · ya estaban: ' + cuenta.repetidas : '') +
    '\nAgregados a los catálogos: ' + cuenta.TRA + ' transportista(s), ' + cuenta.VEH + ' vehículo(s), ' + cuenta.CON + ' conductor(es), ' + cuenta.DIR + ' local(es)/dirección(es).';
}

function GR_ultimaFilaProductos_(p) {
  var ult = p.getLastRow();
  if (ult < 2) return 1;
  var v = p.getRange(2, 1, ult - 1, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]).trim()) return i + 2;
  return 1;
}
