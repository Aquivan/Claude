/**
 * 📑 Declaraciones — catálogo de casillas (DEC_Catalogo.js).
 * Nombres OFICIALES de SUNAT, tomados de su propia pantalla «Detalle de la declaración» (Consulta de
 * Declaraciones y Pagos, plantillas del 621, 626 y PLAME 601). Cada fila: [sección, concepto, columna, casilla].
 * Columna: en el 621 «Base» / «IGV» / «IVAP» / «Renta»; en el PLAME, el tributo.
 */
var DEC_CAT_ = {
  '0621': [
    ['IGV · Ventas', 'Ventas netas gravadas', 'Base', '100'], ['IGV · Ventas', 'Ventas netas gravadas', 'IGV', '101'],
    ['IGV · Ventas', 'Ventas gravadas Ley 31556 (MYPE, tasa reducida)', 'Base', '154'], ['IGV · Ventas', 'Ventas gravadas Ley 31556 (MYPE, tasa reducida)', 'IGV', '155'],
    ['IGV · Ventas', 'Descuentos concedidos y/o devoluciones de ventas', 'Base', '102'], ['IGV · Ventas', 'Descuentos concedidos y/o devoluciones de ventas', 'IGV', '103'],
    ['IGV · Ventas', 'Ventas de bienes Ley 27037 (Amazonía)', 'Base', '160'], ['IGV · Ventas', 'Ventas de bienes Ley 27037 (Amazonía)', 'IGV', '161'],
    ['IGV · Ventas', 'Descuentos y devoluciones Ley 27037', 'Base', '162'], ['IGV · Ventas', 'Descuentos y devoluciones Ley 27037', 'IGV', '163'],
    ['IGV · Ventas', 'Exportaciones facturadas en el período', 'Base', '106'],
    ['IGV · Ventas', 'Exportaciones embarcadas en el período', 'Base', '127'],
    ['IGV · Ventas', 'Ventas no gravadas (sin considerar exportaciones)', 'Base', '105'],
    ['IGV · Ventas', 'Ventas no gravadas (sin efecto en ratio)', 'Base', '109'],
    ['IGV · Ventas', 'Otras ventas (num. 6.2, art. 6 del Reglamento)', 'Base', '112'],
    ['IGV · Ventas', 'Total IGV de ventas', 'IGV', '131'],
    ['IGV · Compras', 'Compras nacionales destinadas a ventas gravadas', 'Base', '107'], ['IGV · Compras', 'Compras nacionales destinadas a ventas gravadas', 'IGV', '108'],
    ['IGV · Compras', 'Compras nacionales destinadas a ventas gravadas Ley 31556', 'Base', '156'], ['IGV · Compras', 'Compras nacionales destinadas a ventas gravadas Ley 31556', 'IGV', '157'],
    ['IGV · Compras', 'Compras nacionales destinadas a ventas gravadas y no gravadas', 'Base', '110'], ['IGV · Compras', 'Compras nacionales destinadas a ventas gravadas y no gravadas', 'IGV', '111'],
    ['IGV · Compras', 'Compras nacionales destinadas a ventas no gravadas', 'Base', '113'],
    ['IGV · Compras', 'Importaciones destinadas a ventas gravadas', 'Base', '114'], ['IGV · Compras', 'Importaciones destinadas a ventas gravadas', 'IGV', '115'],
    ['IGV · Compras', 'Importaciones destinadas a ventas gravadas y no gravadas', 'Base', '116'], ['IGV · Compras', 'Importaciones destinadas a ventas gravadas y no gravadas', 'IGV', '117'],
    ['IGV · Compras', 'Importaciones destinadas a ventas no gravadas', 'Base', '119'],
    ['IGV · Compras', 'Compras internas no gravadas', 'Base', '120'],
    ['IGV · Compras', 'Compras importadas no gravadas', 'Base', '122'],
    ['IGV · Compras', 'Total crédito fiscal (IGV de compras)', 'IGV', '178'],
    ['IGV · Compras', 'Crédito fiscal especial', 'IGV', '172'],
    ['IGV · Compras', 'Coeficiente (prorrata)', '', '173'],
    ['IVAP', 'Ventas gravadas IVAP', 'Base', '340'], ['IVAP', 'Ventas gravadas IVAP', 'IVAP', '341'],
    ['IVAP', 'Otros créditos IVAP', 'IVAP', '182'],
    ['Renta', 'Ingresos netos', 'Base', '301'], ['Renta', 'Pago a cuenta calculado', 'Renta', '312'],
    ['Renta', 'Coeficiente', '', '380'], ['Renta', 'Porcentaje', '', '315'],
    ['Renta', 'Coeficiente calculado (aplicado al pago a cuenta)', '', '894'],
    ['Determinación', 'Impuesto resultante o saldo a favor', 'IGV', '140'], ['Determinación', 'Impuesto resultante o saldo a favor', 'IVAP', '353'], ['Determinación', 'Impuesto resultante o saldo a favor', 'Renta', '302'],
    ['Determinación', 'Saldo a favor del período anterior', 'IGV', '145'], ['Determinación', 'Saldo a favor del período anterior', 'IVAP', '351'], ['Determinación', 'Saldo a favor del período anterior', 'Renta', '303'],
    ['Determinación', 'Tributo a pagar o saldo a favor', 'IGV', '184'], ['Determinación', 'Tributo a pagar o saldo a favor', 'IVAP', '352'], ['Determinación', 'Tributo a pagar o saldo a favor', 'Renta', '304'],
    ['Determinación', 'Percepciones declaradas en el período', 'IGV', '171'],
    ['Determinación', 'Saldo de percepciones de períodos anteriores', 'IGV', '168'],
    ['Determinación', 'Saldo de percepciones no aplicadas', 'IGV', '164'],
    ['Determinación', 'Retenciones declaradas en el período', 'IGV', '179'],
    ['Determinación', 'Saldo de retenciones de períodos anteriores', 'IGV', '176'],
    ['Determinación', 'Saldo de retenciones no aplicadas', 'IGV', '165'],
    ['Determinación', 'Retenciones de tercera declaradas en el período', 'Renta', '326'],
    ['Determinación', 'Retenciones de tercera de períodos anteriores', 'Renta', '327'],
    ['Determinación', 'Compensación saldo a favor del exportador', 'IVAP', '347'], ['Determinación', 'Compensación saldo a favor del exportador', 'Renta', '305'],
    ['Determinación', 'ITAN (Impuesto Temporal a los Activos Netos)', 'Renta', '328'],
    ['Determinación', 'Otros créditos permitidos por ley', 'Renta', '306'],
    ['Determinación', 'Sub total', 'IGV', '681'], ['Determinación', 'Sub total', 'IVAP', '683'], ['Determinación', 'Sub total', 'Renta', '682'],
    ['Determinación', 'Pagos previos', 'IGV', '185'], ['Determinación', 'Pagos previos', 'IVAP', '342'], ['Determinación', 'Pagos previos', 'Renta', '317'],
    ['Determinación', 'Interés moratorio', 'IGV', '187'], ['Determinación', 'Interés moratorio', 'IVAP', '343'], ['Determinación', 'Interés moratorio', 'Renta', '319'],
    ['Determinación', 'Total deuda tributaria', 'IGV', '188'], ['Determinación', 'Total deuda tributaria', 'IVAP', '344'], ['Determinación', 'Total deuda tributaria', 'Renta', '324'],
  ],
  '0626': [
    ['Determinación', 'Retenciones efectuadas', '', '401'],
    ['Determinación', 'Pagos previos (efectivo, cheque o doc. valorado)', '', '402'],
    ['Determinación', 'Retención a pagar', '', '403'],
    ['Determinación', 'Interés moratorio', '', '404'],
    ['Determinación', 'Total deuda tributaria', '', '405'],
    ['Determinación', 'Importe a pagar', '', '410'],
  ],
  '0601': (function () {
    // columnas del PLAME (en el orden de la pantalla de SUNAT) y sus casillas por concepto
    var trib = ['EsSalud regular', 'EsSalud agrario (Ley 31110)', 'EsSalud +Vida', 'ONP (D.L. 19990)', 'Renta 5ta. retenciones', 'Renta 4ta. retenciones'];
    var filas = [
      ['Base imponible', ['452', '463', '454', '451', '455', '461']],
      ['Impuesto resultante', ['412', '423', '414', '411', '415', '421']],
      ['Pagos previos', ['502', '513', '504', '501', '505', '511']],
      ['Interés moratorio', ['702', '746', '704', '701', '705', '742']],
      ['Saldo a pagar', ['712', '750', '714', '711', '715', '745']],
      ['Importe a pagar', ['802', '813', '804', '801', '805', '811']],
    ];
    var out = [];
    filas.forEach(function (f) { f[1].forEach(function (c, i) { out.push(['Determinación', f[0], trib[i], c]); }); });
    out.push(['Determinación', 'Crédito EPS (Ley 26790)', 'EsSalud regular', '602']);
    out.push(['Determinación', 'Crédito EPS de períodos anteriores', 'EsSalud regular', '612']);
    out.push(['Determinación', 'Otras deducciones permitidas por ley', 'EsSalud regular', '605']);
    return out;
  })(),
};

/** Casillas que no son montos (RUC, período, fechas, horas, marcas): no van al reporte de casillas. */
var DEC_CAS_NO_MONTO_ = { '2': 1, '5': 1, '7': 1, '13': 1, '46': 1, '56': 1, '58': 1, '500': 1, '886': 1, '888': 1, '889': 1, '891': 1, '892': 1, '895': 1, '896': 1, '866': 1, '871': 1, '887': 1, '843': 1, '391': 1 };

/** {casilla: {sec, con, col, orden}} de un formulario. */
function DEC_catalogo_(form) {
  var m = {};
  (DEC_CAT_[form] || []).forEach(function (f, i) { m[f[3]] = { sec: f[0], con: f[1], col: f[2], orden: i }; });
  return m;
}

/** Valor numérico de una casilla («25762.00 » → 25762). */
function DEC_num_(cas, n) {
  var v = cas ? cas['C' + n] : null;
  if (v == null || v === '') return 0;
  var x = Number(String(v).trim());
  return isNaN(x) ? 0 : x;
}
