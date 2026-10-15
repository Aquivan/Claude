/**
 * Detracciones · Grupo — Hojas.js
 * Arma Panel, Detracciones, Por proveedor y Por mes con los depósitos descargados.
 *
 * Cada depósito tiene un "rol" visto desde la empresa:
 *   COMPRA = la empresa es el adquiriente (pagó la detracción a la cuenta del proveedor).
 *   VENTA  = la empresa es el proveedor (un cliente le depositó en su cuenta del Banco de la Nación).
 */

var DET_COLOR = { titulo: '#1f3b5c', cabecera: '#1f3b5c', texto: '#ffffff', nuevo: '#fff4c2', venta: '#e6f4ea', total: '#eef3f8' };

/** Anexos del SPOT (Resolución 183-2004/SUNAT y modificatorias). */
var DET_BIENES = {
  '001': 'Azúcar y melaza de caña', '003': 'Alcohol etílico', '004': 'Recursos hidrobiológicos', '005': 'Maíz amarillo duro',
  '007': 'Caña de azúcar', '008': 'Madera', '009': 'Arena y piedra', '010': 'Residuos, subproductos, desechos',
  '011': 'Bienes gravados por renuncia a la exoneración', '012': 'Intermediación laboral y tercerización', '013': 'Animales vivos',
  '014': 'Carnes y despojos comestibles', '015': 'Abonos, cueros y pieles de origen animal', '016': 'Aceite de pescado',
  '017': 'Harina, polvo y pellets de pescado', '019': 'Arrendamiento de bienes muebles', '020': 'Mantenimiento y reparación de bienes muebles',
  '021': 'Movimiento de carga', '022': 'Otros servicios empresariales', '023': 'Leche', '024': 'Comisión mercantil',
  '025': 'Fabricación de bienes por encargo', '026': 'Servicio de transporte de personas', '027': 'Transporte de carga',
  '028': 'Transporte de pasajeros', '030': 'Contratos de construcción', '031': 'Oro gravado con IGV', '032': 'Páprika y frutos del género capsicum',
  '034': 'Minerales metálicos no auríferos', '035': 'Bienes exonerados del IGV', '036': 'Oro y minerales metálicos exonerados del IGV',
  '037': 'Demás servicios gravados con IGV', '039': 'Minerales no metálicos', '040': 'Bien inmueble gravado con IGV', '041': 'Plomo',
  '099': 'Ley 30737',
};
var DET_OPERACIONES = {
  '01': 'Venta de bienes o prestación de servicios', '02': 'Retiro de bienes gravado con IGV', '03': 'Traslado de bienes fuera del centro de producción',
  '04': 'Venta a través de la Bolsa de Productos', '05': 'Venta de bienes exonerada del IGV',
};

var DET_ENC = ['Empresa', 'RUC empresa', 'Rol', 'Fecha de pago', 'Periodo', 'Comprobante', 'Constancia', 'RUC proveedor', 'Proveedor',
  'Adquiriente', 'Bien o servicio', 'Operación', 'Monto S/', 'Cuenta BN', 'Tipo de cuenta', 'N° pago (NPD)', 'Origen', 'Pago',
  'RUC adquiriente', 'Ref. documento', 'Constancia PDF', 'Ruta constancia'];

/* ------------------------------------------------------------- utilidades */

function DET_csvObjetos_(texto) {
  if (!texto) return [];
  var filas = Utilities.parseCsv(texto.replace(/^﻿/, ''));
  if (filas.length < 2) return [];
  var enc = filas[0];
  return filas.slice(1).filter(function (f) { return f.join('') !== ''; }).map(function (f) {
    var o = {};
    enc.forEach(function (k, i) { o[k] = f[i] === undefined ? '' : f[i]; });
    return o;
  });
}

function DET_nombreCorto_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
    .replace(/EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA/i, 'E.I.R.L.')
    .replace(/SOCIEDAD ANONIMA CERRADA/i, 'S.A.C.');
}

function DET_fecha_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : '';
}

function DET_bien_(c) { return c ? (c + ' - ' + (DET_BIENES[c] || 'Código ' + c)) : ''; }

function DET_comprobante_(r) {
  var tipo = { '01': 'Factura', '03': 'Boleta', '07': 'N. crédito', '08': 'N. débito', '12': 'Ticket', '14': 'Recibo serv. públicos' }[r.tipo_comprobante] || r.tipo_comprobante;
  var num = String(r.numero || '').replace(/^0+(?=\d)/, '');
  return (tipo ? tipo + ' ' : '') + (r.serie ? r.serie + '-' : '') + num;
}

/** Documento en el formato de Cuentas por Cobrar y Pagar: 01_F002-6757 (lo usa para descontar la detracción de la factura). */
function DET_ref_(r) {
  var num = String(r.numero || '').replace(/^0+(?=\d)/, '');
  return r.serie && num ? (r.tipo_comprobante || '01') + '_' + String(r.serie).toUpperCase() + '-' + num : '';
}

function DET_mesClave_(f) { return f instanceof Date ? Utilities.formatDate(f, 'America/Lima', 'yyyyMM') : ''; }

/* ------------------------------------------------------- lectura de datos */

function DET_leerDatos_(cfg) {
  var todos = DET_listarArchivos_(cfg).map(function (a) { return a.path; });
  var constancias = {};
  todos.forEach(function (p) { var m = /^(\d{11})\/\d{4}\/\d{2}\/constancias\/(\d+)\.html$/.exec(p); if (m) constancias[m[1] + '|' + m[2]] = p; });
  var rutas = todos
    .filter(function (p) {
      var m = /^(\d{11})\/(\d{4})\/(\d{2})\/detracciones\.csv$/.exec(p);
      return m && (m[2] + m[3]) >= (cfg.desde || '000000');
    });
  var textos = DET_leerTextos_(cfg, rutas);
  var empresas = {};
  DET_listarEmpresas_(cfg).forEach(function (e) { if (e.activo) empresas[e.ruc] = DET_nombreCorto_(e.nombre); });
  var filas = [], vistos = {};
  rutas.forEach(function (ruta) {
    DET_csvObjetos_(textos[ruta]).forEach(function (r) {
      var k = r.empresa_ruc + '|' + r.constancia + '|' + r.num_presentacion;
      if (vistos[k]) return;
      vistos[k] = 1;
      r.empresa = empresas[r.empresa_ruc] || r.empresa_ruc;
      r.fecha = DET_fecha_(r.fecha_pago);
      r.monto = +r.monto || 0;
      r.rutaConstancia = constancias[r.empresa_ruc + '|' + r.constancia] || '';
      filas.push(r);
    });
  });
  filas.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0) || a.empresa.localeCompare(b.empresa) || String(b.constancia).localeCompare(String(a.constancia)); });
  return { filas: filas, empresas: empresas, archivos: rutas.length };
}

/* ----------------------------------------------------------- escritura */

function DET_hoja_(nombre) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

function DET_limpiar_(hoja) {
  if (hoja.getFilter()) hoja.getFilter().remove();
  hoja.clear();
  hoja.getBandings().forEach(function (b) { b.remove(); });
}

function DET_cabecera_(rango) {
  return rango.setFontWeight('bold').setBackground(DET_COLOR.cabecera).setFontColor(DET_COLOR.texto).setWrap(true).setVerticalAlignment('middle');
}

function DET_escribirDetalle_(datos, cfg) {
  var hoja = DET_hoja_(DET_HOJA.DETALLE);
  DET_limpiar_(hoja);
  var limite = Date.now() - cfg.diasNuevo * 86400000;
  var filas = datos.filas.map(function (r) {
    return [r.empresa, r.empresa_ruc, r.rol === 'VENTA' ? 'Me depositaron (proveedor)' : r.rol === 'COMPRA' ? 'Pagué (adquiriente)' : r.rol,
      r.fecha, r.periodo, DET_comprobante_(r), r.constancia, r.ruc_proveedor, r.proveedor, r.adquiriente, DET_bien_(r.tipo_bien),
      DET_OPERACIONES[r.tipo_operacion] || r.tipo_operacion, r.monto, r.num_cuenta, r.tipo_cuenta, r.npd, r.origen, r.consulta,
      r.doc_adquiriente, DET_ref_(r), '', r.rutaConstancia];
  });
  var total = datos.filas.reduce(function (s, r) { return s + (r.rol !== 'VENTA' ? r.monto : 0); }, 0);
  hoja.getRange(1, 1).setValue('🏦 Depósitos de detracciones (SPOT) — SUNAT').setFontSize(14).setFontWeight('bold').setFontColor(DET_COLOR.titulo);
  hoja.getRange(2, 1).setValue(filas.length + ' depósitos desde ' + cfg.desde.slice(0, 4) + '-' + cfg.desde.slice(4) +
    ' · pagado como adquiriente S/ ' + total.toFixed(2) + ' · amarillo = pagados en los últimos ' + cfg.diasNuevo + ' días · verde = depósitos que nos hicieron los clientes')
    .setFontColor('#666666');
  var n = DET_ENC.length;
  DET_cabecera_(hoja.getRange(3, 1, 1, n).setValues([DET_ENC]));
  hoja.setFrozenRows(3);
  if (filas.length) {
    [2, 5, 7, 8, 14, 16, 19, 20].forEach(function (c) { hoja.getRange(4, c, filas.length, 1).setNumberFormat('@'); });
    hoja.getRange(4, 1, filas.length, n).setValues(filas);
    hoja.getRange(4, 4, filas.length, 1).setNumberFormat('dd/mm/yyyy');
    hoja.getRange(4, 13, filas.length, 1).setNumberFormat('#,##0.00');
    hoja.getRange(4, 1, filas.length, n).setBackgrounds(datos.filas.map(function (r) {
      var c = r.rol === 'VENTA' ? DET_COLOR.venta : (r.fecha instanceof Date && r.fecha.getTime() >= limite) ? DET_COLOR.nuevo : null;
      return DET_ENC.map(function () { return c; });
    }));
  }
  hoja.getRange(3, 1, Math.max(filas.length, 1) + 1, n).createFilter();
  [180, 100, 150, 90, 70, 140, 95, 100, 240, 200, 200, 160, 95, 100, 110, 115, 85, 80, 100, 120, 105, 60].forEach(function (w, i) { hoja.setColumnWidth(i + 1, w); });
  hoja.setFrozenColumns(1);
  var sobra = hoja.getMaxColumns() - n;
  if (sobra > 0) hoja.deleteColumns(n + 1, sobra);
  hoja.hideColumns(n);
  DET_ponerEnlaces_(hoja);
}

/** Agrupa filas por una clave: {clave: {n, monto, primero, ultimo, bienes{}, extra}} */
function DET_agrupar_(filas, clave, extra) {
  var g = {};
  filas.forEach(function (r) {
    var k = clave(r);
    var x = g[k] || (g[k] = { n: 0, monto: 0, primero: null, ultimo: null, bienes: {}, extra: extra(r) });
    x.n++; x.monto += r.monto;
    if (r.fecha instanceof Date) {
      if (!x.primero || r.fecha < x.primero) x.primero = r.fecha;
      if (!x.ultimo || r.fecha > x.ultimo) x.ultimo = r.fecha;
    }
    var b = DET_bien_(r.tipo_bien);
    x.bienes[b] = (x.bienes[b] || 0) + r.monto;
  });
  return g;
}

function DET_principal_(bienes) {
  return Object.keys(bienes).sort(function (a, b) { return bienes[b] - bienes[a]; }).join(' · ');
}

function DET_escribirProveedor_(datos) {
  var hoja = DET_hoja_(DET_HOJA.PROVEEDOR);
  DET_limpiar_(hoja);
  hoja.getRange(1, 1).setValue('🏭 Detracciones por proveedor (lo que pagamos)').setFontSize(14).setFontWeight('bold').setFontColor(DET_COLOR.titulo);
  var compras = datos.filas.filter(function (r) { return r.rol !== 'VENTA'; });
  var g = DET_agrupar_(compras, function (r) { return r.empresa_ruc + '|' + r.ruc_proveedor; },
    function (r) { return [r.empresa, r.ruc_proveedor, r.proveedor]; });
  var enc = ['Empresa', 'RUC proveedor', 'Proveedor', 'Bien o servicio', 'Depósitos', 'Monto S/', 'Primer pago', 'Último pago'];
  var filas = Object.keys(g).map(function (k) { var x = g[k]; return x.extra.concat([DET_principal_(x.bienes), x.n, x.monto, x.primero || '', x.ultimo || '']); })
    .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || b[5] - a[5]; });
  hoja.getRange(2, 1).setValue(filas.length + ' proveedores · ordenado por empresa y monto').setFontColor('#666666');
  DET_cabecera_(hoja.getRange(3, 1, 1, enc.length).setValues([enc]));
  hoja.setFrozenRows(3);
  var fila = 4;
  if (filas.length) {
    hoja.getRange(fila, 2, filas.length, 1).setNumberFormat('@');
    hoja.getRange(fila, 1, filas.length, enc.length).setValues(filas);
    hoja.getRange(fila, 6, filas.length, 1).setNumberFormat('#,##0.00');
    hoja.getRange(fila, 7, filas.length, 2).setNumberFormat('dd/mm/yyyy');
    hoja.getRange(3, 1, filas.length + 1, enc.length).createFilter();
    fila += filas.length;
  }
  // Clientes que nos depositaron (si la consulta de SUNAT los trae)
  var ventas = datos.filas.filter(function (r) { return r.rol === 'VENTA'; });
  if (ventas.length) {
    fila += 2;
    hoja.getRange(fila, 1).setValue('💚 Clientes que nos depositaron detracciones').setFontWeight('bold').setFontSize(12);
    var gv = DET_agrupar_(ventas, function (r) { return r.empresa_ruc + '|' + r.doc_adquiriente; },
      function (r) { return [r.empresa, r.doc_adquiriente, r.adquiriente]; });
    var encV = ['Empresa', 'RUC cliente', 'Cliente', 'Bien o servicio', 'Depósitos', 'Monto S/', 'Primer depósito', 'Último depósito'];
    var fv = Object.keys(gv).map(function (k) { var x = gv[k]; return x.extra.concat([DET_principal_(x.bienes), x.n, x.monto, x.primero || '', x.ultimo || '']); })
      .sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || b[5] - a[5]; });
    DET_cabecera_(hoja.getRange(fila + 1, 1, 1, encV.length).setValues([encV]));
    hoja.getRange(fila + 2, 2, fv.length, 1).setNumberFormat('@');
    hoja.getRange(fila + 2, 1, fv.length, encV.length).setValues(fv).setBackground(DET_COLOR.venta);
    hoja.getRange(fila + 2, 6, fv.length, 1).setNumberFormat('#,##0.00');
    hoja.getRange(fila + 2, 7, fv.length, 2).setNumberFormat('dd/mm/yyyy');
  }
  [180, 105, 280, 300, 80, 105, 95, 95].forEach(function (w, i) { hoja.setColumnWidth(i + 1, w); });
}

/** Matriz empresa × mes de pago. */
function DET_matriz_(filas, empresas) {
  var meses = {}, m = {};
  filas.forEach(function (r) {
    var k = DET_mesClave_(r.fecha);
    if (!k) return;
    meses[k] = 1;
    var e = m[r.empresa_ruc] || (m[r.empresa_ruc] = {});
    e[k] = (e[k] || 0) + r.monto;
  });
  var lista = Object.keys(meses).sort();
  var cuerpo = Object.keys(m).sort(function (a, b) { return (empresas[a] || a).localeCompare(empresas[b] || b); }).map(function (ruc) {
    var vals = lista.map(function (k) { return m[ruc][k] || 0; });
    return [empresas[ruc] || ruc].concat(vals).concat([vals.reduce(function (s, v) { return s + v; }, 0)]);
  });
  var tot = ['TOTAL'];
  for (var c = 1; c <= lista.length + 1; c++) tot.push(cuerpo.reduce(function (s, f) { return s + f[c]; }, 0));
  var enc = ['Empresa'].concat(lista.map(function (k) { return DET_MESES[+k.slice(4) - 1] + ' ' + k.slice(0, 4); })).concat(['Total']);
  return { enc: enc, cuerpo: cuerpo, total: tot };
}

function DET_escribirMatriz_(hoja, fila, titulo, mz) {
  hoja.getRange(fila, 1).setValue(titulo).setFontWeight('bold').setFontSize(12);
  DET_cabecera_(hoja.getRange(fila + 1, 1, 1, mz.enc.length).setValues([mz.enc]));
  var datos = mz.cuerpo.concat([mz.total]);
  hoja.getRange(fila + 2, 1, datos.length, mz.enc.length).setValues(datos);
  hoja.getRange(fila + 2, 2, datos.length, mz.enc.length - 1).setNumberFormat('#,##0.00;-#,##0.00;"–"');
  hoja.getRange(fila + 1 + datos.length, 1, 1, mz.enc.length).setFontWeight('bold').setBackground(DET_COLOR.total);
  hoja.getRange(fila + 2, mz.enc.length, datos.length, 1).setFontWeight('bold');
  return fila + 2 + datos.length;
}

function DET_escribirMes_(datos) {
  var hoja = DET_hoja_(DET_HOJA.MES);
  DET_limpiar_(hoja);
  hoja.getRange(1, 1).setValue('📅 Detracciones por mes de pago (S/)').setFontSize(14).setFontWeight('bold').setFontColor(DET_COLOR.titulo);
  hoja.getRange(2, 1).setValue('Por fecha de pago del depósito (no por periodo tributario). Útil para cuadrar con el Banco de la Nación y con el registro de compras.').setFontColor('#666666');
  var compras = datos.filas.filter(function (r) { return r.rol !== 'VENTA'; });
  var fila = DET_escribirMatriz_(hoja, 4, 'Pagado como adquiriente (compras)', DET_matriz_(compras, datos.empresas));
  var ventas = datos.filas.filter(function (r) { return r.rol === 'VENTA'; });
  if (ventas.length) DET_escribirMatriz_(hoja, fila + 2, 'Depositado por nuestros clientes (ventas)', DET_matriz_(ventas, datos.empresas));
  hoja.setColumnWidth(1, 220);
  for (var c = 2; c <= hoja.getMaxColumns(); c++) hoja.setColumnWidth(c, 95);
  hoja.setFrozenColumns(1);
}

function DET_escribirPanel_(datos, cfg) {
  var hoja = DET_hoja_(DET_HOJA.PANEL);
  DET_limpiar_(hoja);
  hoja.getRange('A1').setValue('🏦 Detracciones · Grupo').setFontSize(18).setFontWeight('bold').setFontColor(DET_COLOR.titulo);
  hoja.getRange('A2').setValue('Depósitos SPOT de SUNAT · actualizado: ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm') +
    '   ·   Desde: ' + cfg.desde.slice(0, 4) + '-' + cfg.desde.slice(4)).setFontColor('#666666');
  var mesActual = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMM');
  var hoy = new Date();
  var mesAnterior = Utilities.formatDate(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), 'America/Lima', 'yyyyMM');
  var porEmp = {};
  var nueva = function (nom) { return { nom: nom, n: 0, monto: 0, mes: 0, ant: 0, vn: 0, vmonto: 0, ult: null, prov: {} }; };
  Object.keys(datos.empresas).forEach(function (ruc) { porEmp[ruc] = nueva(datos.empresas[ruc]); });
  datos.filas.forEach(function (r) {
    var e = porEmp[r.empresa_ruc] || (porEmp[r.empresa_ruc] = nueva(r.empresa));
    var k = DET_mesClave_(r.fecha);
    if (r.rol === 'VENTA') { e.vn++; e.vmonto += r.monto; return; }
    e.n++; e.monto += r.monto;
    if (k === mesActual) e.mes += r.monto;
    if (k === mesAnterior) e.ant += r.monto;
    if (r.fecha instanceof Date && (!e.ult || r.fecha > e.ult)) e.ult = r.fecha;
    e.prov[r.ruc_proveedor] = 1;
  });
  var enc = ['Empresa', 'RUC', 'Depósitos pagados', 'Monto pagado S/', 'Este mes S/', 'Mes anterior S/', 'Proveedores', 'Último pago',
    'Depósitos recibidos', 'Monto recibido S/'];
  var filas = Object.keys(porEmp).map(function (ruc) {
    var e = porEmp[ruc];
    return [e.nom, ruc, e.n, e.monto, e.mes, e.ant, Object.keys(e.prov).length, e.ult || '', e.vn, e.vmonto];
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); });
  var tot = ['TOTAL GRUPO', '', 0, 0, 0, 0, '', '', 0, 0];
  filas.forEach(function (f) { [2, 3, 4, 5, 8, 9].forEach(function (c) { tot[c] += f[c]; }); });
  hoja.getRange(4, 1).setValue('Resumen por empresa').setFontWeight('bold').setFontSize(12);
  DET_cabecera_(hoja.getRange(5, 1, 1, enc.length).setValues([enc]));
  var todo = filas.concat([tot]);
  hoja.getRange(6, 2, todo.length, 1).setNumberFormat('@');
  hoja.getRange(6, 1, todo.length, enc.length).setValues(todo);
  [4, 5, 6, 10].forEach(function (c) { hoja.getRange(6, c, todo.length, 1).setNumberFormat('#,##0.00;-#,##0.00;"–"'); });
  hoja.getRange(6, 8, todo.length, 1).setNumberFormat('dd/mm/yyyy');
  hoja.getRange(5 + todo.length, 1, 1, enc.length).setFontWeight('bold').setBackground(DET_COLOR.total);
  hoja.getRange(6, 5, filas.length, 1).setBackground(DET_COLOR.nuevo).setFontWeight('bold');

  // Por bien o servicio
  var fila = 6 + todo.length + 2;
  var bienes = {};
  datos.filas.forEach(function (r) { if (r.rol !== 'VENTA') { var b = DET_bien_(r.tipo_bien); bienes[b] = bienes[b] || { n: 0, m: 0 }; bienes[b].n++; bienes[b].m += r.monto; } });
  var fb = Object.keys(bienes).map(function (b) { return [b, bienes[b].n, bienes[b].m]; }).sort(function (a, b) { return b[2] - a[2]; });
  hoja.getRange(fila, 1).setValue('Por bien o servicio (pagado)').setFontWeight('bold').setFontSize(12);
  DET_cabecera_(hoja.getRange(fila + 1, 1, 1, 3).setValues([['Bien o servicio', 'Depósitos', 'Monto S/']]));
  if (fb.length) {
    hoja.getRange(fila + 2, 1, fb.length, 3).setValues(fb);
    hoja.getRange(fila + 2, 3, fb.length, 1).setNumberFormat('#,##0.00');
  }

  // Últimos depósitos
  fila += fb.length + 4;
  var ult = datos.filas.slice(0, 15).map(function (r) {
    return [r.empresa, r.fecha, r.rol === 'VENTA' ? 'Recibido' : 'Pagado', r.rol === 'VENTA' ? r.adquiriente : r.proveedor, DET_comprobante_(r), r.constancia, r.monto];
  });
  hoja.getRange(fila, 1).setValue('🔔 Últimos 15 depósitos del grupo').setFontWeight('bold').setFontSize(12);
  DET_cabecera_(hoja.getRange(fila + 1, 1, 1, 7).setValues([['Empresa', 'Fecha de pago', 'Tipo', 'Proveedor / cliente', 'Comprobante', 'Constancia', 'Monto S/']]));
  if (ult.length) {
    hoja.getRange(fila + 2, 6, ult.length, 1).setNumberFormat('@');
    hoja.getRange(fila + 2, 1, ult.length, 7).setValues(ult);
    hoja.getRange(fila + 2, 2, ult.length, 1).setNumberFormat('dd/mm/yyyy');
    hoja.getRange(fila + 2, 7, ult.length, 1).setNumberFormat('#,##0.00');
  }
  hoja.setColumnWidth(1, 260);
  for (var c = 2; c <= 10; c++) hoja.setColumnWidth(c, 115);
  hoja.setColumnWidth(4, 230);
  hoja.setFrozenRows(2);
  hoja.setHiddenGridlines(true);
}

function DET_ordenarPestanas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [DET_HOJA.PANEL, DET_HOJA.DETALLE, DET_HOJA.PROVEEDOR, DET_HOJA.MES, DET_HOJA.CONFIG].forEach(function (n, i) {
    var h = ss.getSheetByName(n);
    if (h) { ss.setActiveSheet(h); ss.moveActiveSheet(i + 1); }
  });
  var arch = ss.getSheetByName(DET_HOJA.ARCHIVOS);
  if (arch) arch.hideSheet();
  ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(function (n) {
    var h = ss.getSheetByName(n);
    if (h && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h);
  });
  ss.setActiveSheet(ss.getSheetByName(DET_HOJA.PANEL));
}

/* -------------------------------------------------------------- acciones */

function DET_actualizarDatos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSpreadsheetTimeZone() !== 'America/Lima') ss.setSpreadsheetTimeZone('America/Lima');
  var cfg = DET_leerConfig_();
  var datos = DET_leerDatos_(cfg);
  DET_escribirDetalle_(datos, cfg);
  DET_escribirProveedor_(datos);
  DET_escribirMes_(datos);
  DET_escribirPanel_(datos, cfg);
  DET_ordenarPestanas_();
  DET_marcarActualizacion_(Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'));
  return datos;
}

function DET_conCandado_(fn) {
  var candado = LockService.getScriptLock();
  if (!candado.tryLock(5000)) throw new Error('Ya hay una actualización en curso. Intente en unos minutos.');
  try { return fn(); } finally { candado.releaseLock(); }
}

function DET_menuActualizar() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = DET_conCandado_(function () { var d = DET_actualizarDatos_(); return { d: d, c: DET_ordenarConstancias_() }; });
    var pagado = r.d.filas.reduce(function (s, x) { return s + (x.rol !== 'VENTA' ? x.monto : 0); }, 0);
    ui.alert('✅ Hoja actualizada: ' + r.d.filas.length + ' depósitos de ' + Object.keys(r.d.empresas).length + ' empresas.\nPagado como adquiriente: S/ ' + pagado.toFixed(2) +
      (r.c.apagado ? '\n\nCopia de constancias a Drive: desactivada en Config.' : '\n\nConstancias nuevas en Drive: ' + r.c.nuevos +
        (r.c.pendientes ? '\nFaltan ' + r.c.pendientes + ' (siguen solas en 1 minuto).' : '')));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

function DET_menuConstancias() {
  var ui = SpreadsheetApp.getUi();
  try {
    var c = DET_conCandado_(DET_ordenarConstancias_);
    ui.alert(c.apagado ? 'La copia de constancias a Drive está desactivada (Config → Copiar constancias a Drive = NO).' :
      '📄 Constancias nuevas en Drive: ' + c.nuevos + (c.pendientes ? '\nFaltan ' + c.pendientes + ' (siguen solas en 1 minuto).' : '\nTodas las constancias descargadas están en Drive.'));
  } catch (e) { ui.alert('❌ ' + e.message); }
}

/** Importa a la hoja lo que GitHub ya descargó (lo llama Diario.js). */
function DET_importarAhora_() {
  DET_conCandado_(function () { DET_actualizarDatos_(); DET_ordenarConstancias_(); });
}

function DET_continuarConstancias() {
  DET_borrarContinuacion_();
  DET_conCandado_(DET_ordenarConstancias_);
}
