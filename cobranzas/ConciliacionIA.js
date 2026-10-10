/**
 * ConciliacionIA.js — pestaña "🤝 Conciliar con IA".
 *
 * Concilia por proveedor o cliente: usted elige empresa del grupo, si es por
 * pagar o por cobrar, y la contraparte (o todas). Para cada voucher que aún no
 * está aplicado:
 *   1. Detecta el RUC del beneficiario a partir de su nombre (columna F del
 *      voucher) comparándolo con los proveedores/clientes de SIRE.
 *   2. Una regla rápida marca lo evidente (monto exacto, neto de retención 3%,
 *      neto de detracción, suma de facturas) y la IA propone el resto con su
 *      cálculo y confianza. De los vouchers solo se usan las columnas A–J
 *      (fecha, operación, banco, moneda, monto, beneficiario, cliente,
 *      descripción).
 *   3. Usted marca ✔ Aceptar (puede corregir las facturas) o ✖ Rechazar y usa
 *      "✅ Aplicar lo aceptado": queda como pago confirmado en Cobranzas (igual
 *      que un ✔ de ✅ Conciliar), el RUC detectado se guarda como alias en
 *      ⚙️ Config y, si lo activa, se escribe también en la hoja de Vouchers
 *      (solo en celdas vacías).
 * Las funciones de IA (IA_llamar_, IA_similitud_…) están en IACliente.js y el
 * proveedor/modelo se elige en la pestaña 🧠 Asistente IA.
 */

var CIA_HOJA_ = '🤝 Conciliar con IA';
var CIA_TODAS_ = '(Todas)';
var CIA_TODAS_CONTRA_ = '⭐ Todas las que tengan vouchers por conciliar';
var CIA_TIPOS_ = ['Por pagar (proveedores)', 'Por cobrar (clientes)'];
var CIA_F_ENC_ = 12;
var CIA_ENC_ = ['✔ Aceptar', '✖ Rechazar', 'Empresa', 'Contraparte', 'RUC contraparte', 'Fecha depósito', 'N° operación', 'Banco',
  'Moneda', 'Monto', 'Beneficiario (voucher, col. F)', 'Descripción', 'RUC detectado', 'Cómo se detectó',
  'Factura(s) propuesta(s) ✏️', 'Saldo de esas facturas', 'Diferencia', 'Tipo', 'Confianza', 'Motivo', 'Estado',
  'Voucher (fuente)', 'ID pago'];
var CIA_C_ = {}; CIA_ENC_.forEach(function (n, i) { CIA_C_[n] = i; });
var CIA_PEND_ = '🟡 Por revisar';
var CIA_LIMITE_MS_ = 270000;

/* --------------------------------------------------------------- hoja */

function CIA_hoja_(ss) {
  var sh = ss.getSheetByName(CIA_HOJA_);
  if (sh && sh.getRange('A1').getValue()) return sh;
  sh = sh || ss.insertSheet(CIA_HOJA_);
  sh.getRange('A1:K1').merge().setValue('🤝  CONCILIAR CON IA · por proveedor o cliente').setFontSize(15).setFontWeight('bold')
    .setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
  sh.setRowHeight(1, 38);
  var p = [
    ['Empresa del grupo', CIA_TODAS_], ['Ver', CIA_TIPOS_[0]], ['Proveedor / cliente', CIA_TODAS_CONTRA_],
    ['Vouchers desde (fecha)', ''], ['Analizar', 'Solo vouchers sin aplicar'],
    ['Al aplicar, escribir también en Vouchers', 'NO'], ['Estado', ''],
  ];
  sh.getRange(3, 1, p.length, 2).setValues(p);
  sh.getRange(3, 1, p.length, 1).setFontWeight('bold');
  sh.getRange(3, 2, p.length - 1, 1).setBackground('#FFF8E1');
  sh.getRange('B6').setNumberFormat('dd/mm/yyyy');
  sh.getRange('B7').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Solo vouchers sin aplicar', 'Todos los vouchers']).build());
  sh.getRange('B8').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['NO', 'SI']).build());
  sh.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CIA_TIPOS_).build());
  sh.getRange('D3:K8').merge().setValue(
    'Cómo usarlo:\n1) Elija empresa, Ver y el proveedor/cliente (la lista muestra sus facturas pendientes).\n' +
    '2) Menú 💼 Cobranzas → 🤝 Conciliar con IA → ▶ Analizar.\n' +
    '3) Revise cada propuesta: marque ✔ Aceptar (puede corregir "Factura(s) propuesta(s)", ej. 01_F001-123,124) o ✖ Rechazar.\n' +
    '4) Menú → ✅ Aplicar lo aceptado. Queda como pago confirmado y el RUC detectado se recuerda para los próximos vouchers.\n' +
    'La IA se elige en la pestaña 🧠 Asistente IA. Sin clave de IA, igual propone los casos evidentes.')
    .setWrap(true).setVerticalAlignment('top').setFontSize(9).setFontColor(COLOR.TEXTO_SUAVE).setBackground('#F8FAFC');
  sh.getRange(CIA_F_ENC_ - 1, 1).setValue('PROPUESTAS').setFontWeight('bold').setFontSize(12);
  sh.getRange(CIA_F_ENC_, 1, 1, CIA_ENC_.length).setValues([CIA_ENC_]).setFontWeight('bold')
    .setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(CIA_F_ENC_);
  sh.setColumnWidth(1, 190); sh.setColumnWidth(2, 260);
  [70, 70, 90, 180, 100, 85, 90, 70, 55, 95, 200, 160, 100, 130, 170, 100, 85, 100, 70, 280, 120, 110, 60].forEach(function (w, i) {
    if (i > 1) sh.setColumnWidth(i + 1, w);
  });
  sh.hideColumns(CIA_C_['ID pago'] + 1);
  return sh;
}

function CIA_leerParam_(sh, cfg) {
  var v = sh.getRange(3, 2, 6, 1).getValues().map(function (r) { return r[0]; });
  var empTxt = String(v[0] || '').trim();
  var empresaRuc = '';
  if (empTxt && empTxt !== CIA_TODAS_) empresaRuc = aRuc_(empTxt) || cfg.aliasEmpresa[normHeader_(empTxt)] || '';
  var contra = String(v[2] || '').trim();
  var mRuc = contra.match(/(\d{11}|\d{8})/);
  return {
    empresaRuc: empresaRuc, porCobrar: /cobrar/i.test(String(v[1])),
    contraRuc: contra && contra !== CIA_TODAS_CONTRA_ && mRuc ? mRuc[1] : '',
    desde: aFecha_(v[3]), todos: /todos/i.test(String(v[4])), escribirVouchers: /^SI/i.test(String(v[5]).trim()),
  };
}

function CIA_estado_(sh, txt) { sh.getRange('B9').setValue(txt); }

/* ------------------------------------------------- datos de Cobranzas */

/** Facturas de 📋 Documentos (con saldo o todas) para el lado elegido. */
function CIA_leerDocs_(ss, cfg, par) {
  var sh = ss.getSheetByName(HOJA.DOCS);
  var res = [];
  if (!sh || sh.getLastRow() < 2) return res;
  var v = sh.getRange(1, 1, sh.getLastRow(), ENC_DOCS_.length).getValues();
  var I = {}; ENC_DOCS_.forEach(function (n, k) { I[n] = k; });
  var tipo = par.porCobrar ? 'Por cobrar' : 'Por pagar';
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    if (r[I['Tipo']] !== tipo) continue;
    var clave = String(r[I['Clave']] || '');
    if (!clave) continue;
    var empresaRuc = par.porCobrar ? clave.split('|')[0] : (cfg.aliasEmpresa[normHeader_(r[I['Empresa']])] || '');
    if (!empresaRuc) {
      Object.keys(cfg.nombreEmpresa).forEach(function (ruc) { if (cfg.nombreEmpresa[ruc] === r[I['Empresa']]) empresaRuc = ruc; });
    }
    if (par.empresaRuc && empresaRuc !== par.empresaRuc) continue;
    res.push({
      empresaRuc: empresaRuc, empresa: String(r[I['Empresa']]), contraRuc: aRuc_(r[I['RUC contraparte']]),
      contra: String(r[I['Contraparte']] || ''), doc: String(r[I['Documento']]), emision: aFecha_(r[I['Emisión']]),
      vence: aFecha_(r[I['Vence']]), moneda: String(r[I['Moneda']] || 'PEN'), total: aNumero_(r[I['Total']]),
      nc: aNumero_(r[I['N/C']]), retencion: aNumero_(r[I['Retención']]), detraccion: aNumero_(r[I['Detracción']]),
      pagado: aNumero_(r[I['Pagado']]), saldo: aNumero_(r[I['Saldo']]), estado: String(r[I['Estado']] || ''), clave: clave,
    });
  }
  return res;
}

/** IDs de pago que ya están aplicados (aparecen en 💳 Movimientos). */
function CIA_pagosAplicados_(ss) {
  var sh = ss.getSheetByName(HOJA.MOVS);
  var res = {};
  if (!sh || sh.getLastRow() < 2) return res;
  var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var c = indiceColumnas_(enc)('ID pago');
  if (c < 0) return res;
  sh.getRange(2, c + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) res[r[0]] = true; });
  return res;
}

/** Lista de contrapartes para el desplegable (con sus facturas pendientes). */
function CIA_actualizarLista_(ss, sh, cfg) {
  sh = sh || CIA_hoja_(ss);
  cfg = cfg || leerConfig_(ss);
  var emp = [CIA_TODAS_].concat(cfg.grupo.map(function (r) { return cfg.nombreEmpresa[r] + ' · ' + r; }));
  sh.getRange('B3').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(emp).build());
  var par = CIA_leerParam_(sh, cfg);
  var g = {};
  CIA_leerDocs_(ss, cfg, par).forEach(function (d) {
    if (d.saldo <= 0.5 || !d.contraRuc || cfg.grupo.indexOf(d.contraRuc) !== -1 && !par.empresaRuc) return;
    var x = g[d.contraRuc] = g[d.contraRuc] || { nombre: d.contra, n: 0, saldo: 0 };
    x.n++; x.saldo += d.saldo;
  });
  var lista = Object.keys(g).sort(function (a, b) { return g[b].saldo - g[a].saldo; }).slice(0, 450).map(function (r) {
    return (g[r].nombre || 'Sin nombre').slice(0, 45) + ' · ' + r + ' · ' + g[r].n + ' fact. · S/ ' + Math.round(g[r].saldo).toLocaleString('en-US');
  });
  sh.getRange('B5').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([CIA_TODAS_CONTRA_].concat(lista)).setAllowInvalid(true).build());
  return lista.length;
}

/** Llamado desde onEdit (Consulta.js): al cambiar empresa o Ver, recarga la lista de contrapartes. */
function CIA_alEditar_(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== CIA_HOJA_) return;
  var a1 = e.range.getA1Notation();
  if (a1 !== 'B3' && a1 !== 'B4') return;
  sh.getRange('B5').setValue(CIA_TODAS_CONTRA_);
  var n = CIA_actualizarLista_(e.source, sh);
  e.source.toast(n + ' proveedores/clientes con saldo. Elija uno en "Proveedor / cliente" y luego ▶ Analizar.', '🤝 Conciliar con IA', 6);
}

/* ------------------------------------------------- detección de RUC */

/**
 * RUC de la contraparte de un voucher. Por pagar: el beneficiario (col. F);
 * por cobrar: quien paga. Devuelve {ruc, como, candidatos:[{ruc,nombre,score}]}.
 */
function CIA_detectarRuc_(p, par, cfg, nombres) {
  if (par.porCobrar) {
    var rucP = p.pagadorRuc && cfg.grupo.indexOf(p.pagadorRuc) === -1 ? p.pagadorRuc : '';
    if (rucP) return { ruc: rucP, como: 'RUC del cliente en el voucher', candidatos: [] };
  } else if (p.beneficiarioRuc) {
    return { ruc: p.beneficiarioRuc, como: 'ya tenía RUC', candidatos: [] };
  }
  var nombre = par.porCobrar ? (p.descripcion || p.beneficiarioNombre) : p.beneficiarioNombre;
  var alias = cfg.aliasNombre[normNombre_(nombre)];
  if (alias) return { ruc: alias, como: 'alias en ⚙️ Config', candidatos: [] };
  // Se comparan sin la forma societaria (S.A.C., E.I.R.L.…): "ALIF SAC" = "ALIF S.A.C."
  var tn = IA_tokens_(normNombre_(nombre));
  var cands = Object.keys(nombres).map(function (ruc) {
    return { ruc: ruc, nombre: nombres[ruc], score: IA_similitud_(tn, IA_tokens_(normNombre_(nombres[ruc]))) };
  }).filter(function (c) { return c.score >= 0.5; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 4);
  if (cands.length && cands[0].score >= 0.8 && (cands.length === 1 || cands[0].score - cands[1].score >= 0.15)) {
    return { ruc: cands[0].ruc, como: 'nombre parecido (' + Math.round(cands[0].score * 100) + '%)', candidatos: cands };
  }
  return { ruc: '', como: cands.length ? 'dudoso: lo decide la IA' : 'sin coincidencia', candidatos: cands };
}

/* ---------------------------------------- propuesta rápida (sin IA) */

/** Casos evidentes: exacto, neto de retención 3%, neto de detracción, suma de 2-3 facturas seguidas. */
function CIA_reglaRapida_(p, docs) {
  var tol = 0.6;
  var m = p.monto;
  var mismos = docs.filter(function (d) { return !p.moneda || d.moneda === p.moneda; });
  for (var i = 0; i < mismos.length; i++) {
    var d = mismos[i];
    if (Math.abs(d.saldo - m) <= tol) return { docs: [d], tipo: 'exacto', motivo: 'Saldo ' + d.saldo.toFixed(2) + ' = monto del voucher' };
  }
  for (i = 0; i < mismos.length; i++) {
    d = mismos[i];
    if (!d.retencion && Math.abs(d.saldo - d.total * 0.03 - m) <= tol) {
      return { docs: [d], tipo: 'neto retención', motivo: d.saldo.toFixed(2) + ' − 3% de ' + d.total.toFixed(2) + ' = ' + m.toFixed(2) };
    }
    var tasas = [0.04, 0.10, 0.12];
    for (var t = 0; t < tasas.length; t++) {
      if (!d.detraccion && Math.abs(d.saldo - d.total * tasas[t] - m) <= tol) {
        return { docs: [d], tipo: 'neto detracción', motivo: d.saldo.toFixed(2) + ' − ' + (tasas[t] * 100) + '% de ' + d.total.toFixed(2) + ' = ' + m.toFixed(2) };
      }
    }
  }
  for (i = 0; i < mismos.length; i++) {
    var suma = 0, sel = [];
    for (var j = i; j < Math.min(mismos.length, i + 3); j++) {
      suma += mismos[j].saldo; sel.push(mismos[j]);
      if (sel.length > 1 && Math.abs(suma - m) <= tol) return { docs: sel.slice(), tipo: 'varias', motivo: 'Suma de saldos ' + suma.toFixed(2) + ' = monto' };
    }
  }
  return null;
}

/* ---------------------------------------------------------------- IA */

var CIA_SISTEMA_ = [
  'Eres contador en Perú y concilias pagos bancarios (vouchers) con facturas de UN proveedor o cliente.',
  'Te doy los vouchers (V1, V2…) y las facturas con saldo pendiente. Asigna a cada voucher la(s) factura(s) que paga.',
  'Reglas: cada factura no puede recibir más que su saldo entre todos los vouchers; prefiere las facturas más antiguas;',
  'la fecha de la factura debe ser anterior o cercana a la del pago; considera pago exacto, neto de retención (3% del total),',
  'neto de detracción (4%, 10% o 12% del total, que se deposita aparte), suma de varias facturas, pago parcial (abono),',
  'redondeos o comisiones pequeñas. Si la moneda difiere, solo asigna si calza con un tipo de cambio entre 3.3 y 4.0.',
  'Si un voucher trae "candidatos de RUC", primero confirma cuál es el proveedor correcto según el nombre del beneficiario.',
  'Usa EXACTAMENTE los códigos de factura de la lista. Si no hay explicación razonable, deja la lista vacía.',
  'Responde SOLO JSON: {"asignaciones":[{"voucher":"V1","ruc":"","documentos":[],"tipo":"exacto|neto retencion|neto detraccion|varias|parcial|ninguno","confianza":0,"motivo":""}]}',
  '"confianza" 0-100; "motivo" máximo 30 palabras en español con el cálculo (ej. 1,180 − 12% = 1,038.40).',
].join('\n');

function CIA_preguntarIA_(ia, grupoVouchers, docs, contra) {
  var texto = [
    (contra.porCobrar ? 'CLIENTE: ' : 'PROVEEDOR: ') + contra.nombre + ' (RUC ' + contra.ruc + ') · empresa del grupo: ' + contra.empresa,
    '',
    'VOUCHERS (id | fecha | banco | operación | monto | moneda | beneficiario | descripción | pista del sistema):',
    grupoVouchers.map(function (x, k) {
      var p = x.p;
      return 'V' + (k + 1) + ' | ' + IA_fmtFecha_(p.fecha) + ' | ' + p.banco + ' | ' + p.operacion + ' | ' + p.monto.toFixed(2) + ' | ' +
        p.moneda + ' | ' + (p.beneficiarioNombre || '') + ' | ' + (p.descripcion || '') + ' | ' +
        (x.regla ? x.regla.tipo + ': ' + x.regla.docs.map(function (d) { return d.doc; }).join(',') : '-') +
        (x.det.ruc ? '' : ' | candidatos de RUC: ' + x.det.candidatos.map(function (c) { return c.ruc + ' ' + c.nombre; }).join('; '));
    }).join('\n'),
    '',
    'FACTURAS PENDIENTES (código | emisión | vence | total | N/C | retención | detracción | pagado | saldo | moneda):',
    docs.map(function (d) {
      return d.doc + ' | ' + IA_fmtFecha_(d.emision) + ' | ' + IA_fmtFecha_(d.vence) + ' | ' + d.total.toFixed(2) + ' | ' + d.nc.toFixed(2) + ' | ' +
        d.retencion.toFixed(2) + ' | ' + d.detraccion.toFixed(2) + ' | ' + d.pagado.toFixed(2) + ' | ' + d.saldo.toFixed(2) + ' | ' + d.moneda;
    }).join('\n'),
  ].join('\n');
  var r = IA_llamar_({ proveedor: ia.proveedor, modelo: ia.modelo, sistema: CIA_SISTEMA_, texto: texto, maxTokens: 4000 });
  var res = {};
  (Array.isArray(r.asignaciones) ? r.asignaciones : []).forEach(function (a) {
    var k = parseInt(String(a.voucher || '').replace(/\D/g, ''), 10) - 1;
    if (!(k >= 0 && k < grupoVouchers.length)) return;
    var validos = (Array.isArray(a.documentos) ? a.documentos : []).map(String).filter(function (x) {
      return docs.some(function (d) { return d.doc === x; });
    });
    res[k] = {
      docs: docs.filter(function (d) { return validos.indexOf(d.doc) !== -1; }),
      tipo: String(a.tipo || ''), confianza: Math.max(0, Math.min(100, parseInt(a.confianza, 10) || 0)),
      motivo: String(a.motivo || '').slice(0, 300), ruc: aRuc_(a.ruc),
    };
  });
  return res;
}

/* ------------------------------------------------------------ analizar */

function CIA_menuAbrir() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = CIA_hoja_(ss);
  var n = CIA_actualizarLista_(ss, sh);
  ss.setActiveSheet(sh);
  ss.toast(n + ' proveedores/clientes con saldo en la lista. Elija y use ▶ Analizar.', '🤝 Conciliar con IA', 8);
}

function CIA_menuAnalizar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Analizando vouchers y facturas…', '🤝 Conciliar con IA', 60);
  var msg;
  try { msg = CIA_analizar_(ss); } catch (e) { msg = '❌ ' + e.message; }
  CIA_estado_(CIA_hoja_(ss), msg);
  ss.toast(msg, '🤝 Conciliar con IA', 12);
}

function CIA_analizar_(ss) {
  var t0 = Date.now();
  var sh = CIA_hoja_(ss);
  var cfg = leerConfig_(ss);
  var par = CIA_leerParam_(sh, cfg);
  var ia = IA_leerParam_(IA_hoja_(ss));
  var hayIA = !!IA_clave_(ia.proveedor);
  var docs = CIA_leerDocs_(ss, cfg, par);
  var nombres = {};
  docs.forEach(function (d) { if (d.contraRuc && d.contra) nombres[d.contraRuc] = d.contra; });
  var pend = docs.filter(function (d) { return d.saldo > 0.5; });

  var aplicados = par.todos ? {} : CIA_pagosAplicados_(ss);
  var yaEnTabla = {};
  CIA_leerTabla_(sh).forEach(function (t) { if (/^[✅✖]/.test(t.estado)) yaEnTabla[t.id] = true; });  // ya decididos

  // Vouchers del lado elegido
  var nombreEmp = {};
  cfg.grupo.forEach(function (r) { nombreEmp[r] = IA_tokens_(normNombre_(cfg.nombreEmpresa[r])); });
  var vouchers = leerVouchers_(cfg).pagos.filter(function (p) {
    if (aplicados[p.id] || yaEnTabla[p.id]) return false;
    if (par.desde && p.fecha && p.fecha < par.desde) return false;
    if (par.porCobrar) {
      // cobro: el beneficiario es la empresa del grupo
      var benef = p.beneficiarioRuc && cfg.grupo.indexOf(p.beneficiarioRuc) !== -1 ? p.beneficiarioRuc : '';
      if (!benef) cfg.grupo.forEach(function (r) { if (!benef && IA_similitud_(IA_tokens_(normNombre_(p.beneficiarioNombre)), nombreEmp[r]) >= 0.8) benef = r; });
      p._empresa = benef;
    } else {
      p._empresa = p.pagadorRuc && cfg.grupo.indexOf(p.pagadorRuc) !== -1 ? p.pagadorRuc : '';
    }
    if (!p._empresa) return false;
    return !par.empresaRuc || p._empresa === par.empresaRuc;
  });

  // Agrupar por contraparte detectada
  var grupos = {}, sinContra = 0;
  vouchers.forEach(function (p) {
    var det = CIA_detectarRuc_(p, par, cfg, nombres);
    var ruc = det.ruc;
    if (!ruc && det.candidatos.length) ruc = det.candidatos[0].ruc;  // la IA confirma
    if (!ruc) { sinContra++; return; }
    if (par.contraRuc && ruc !== par.contraRuc && !det.candidatos.some(function (c) { return c.ruc === par.contraRuc; })) return;
    if (par.contraRuc) ruc = par.contraRuc;
    var k = p._empresa + '|' + ruc;
    (grupos[k] = grupos[k] || []).push({ p: p, det: det });
  });

  var claves = Object.keys(grupos).sort(function (a, b) { return grupos[b].length - grupos[a].length; });
  var filas = [], consultas = 0, errores = 0, ultimoError = '', hechos = 0;
  for (var g = 0; g < claves.length; g++) {
    if (Date.now() - t0 > CIA_LIMITE_MS_) break;
    var empRuc = claves[g].split('|')[0], contraRuc = claves[g].split('|')[1];
    var docsC = pend.filter(function (d) { return d.contraRuc === contraRuc && d.empresaRuc === empRuc; })
      .sort(function (a, b) { return (a.emision || 0) - (b.emision || 0); }).slice(0, 80);
    var lista = grupos[claves[g]].sort(function (a, b) { return (a.p.fecha || 0) - (b.p.fecha || 0); }).slice(0, 40);
    // Solo facturas emitidas antes del último pago del grupo (+15 días de margen).
    var ultimoPago = lista.reduce(function (m, x) { return x.p.fecha && x.p.fecha > m ? x.p.fecha : m; }, null);
    if (ultimoPago) {
      var tope = ultimoPago.getTime() + 15 * 86400000;
      docsC = docsC.filter(function (d) { return !d.emision || d.emision.getTime() <= tope; });
    }
    lista.forEach(function (x) { x.regla = docsC.length ? CIA_reglaRapida_(x.p, docsC) : null; });
    var resIA = {};
    var contra = { ruc: contraRuc, nombre: nombres[contraRuc] || contraRuc, empresa: cfg.nombreEmpresa[empRuc] || empRuc, porCobrar: par.porCobrar };
    if (hayIA && docsC.length) {
      if (consultas > 0) Utilities.sleep(IA_PROVEEDORES_[ia.proveedor].pausa);
      consultas++;
      try { resIA = CIA_preguntarIA_(ia, lista, docsC, contra); } catch (e) { errores++; ultimoError = e.message; }
    }
    lista.forEach(function (x, k) {
      var a = resIA[k];
      var prop = a && a.docs.length ? { docs: a.docs, tipo: a.tipo, motivo: '[IA] ' + a.motivo, confianza: a.confianza / 100 }
        : x.regla ? { docs: x.regla.docs, tipo: x.regla.tipo, motivo: '[Regla] ' + x.regla.motivo, confianza: 0.95 }
        : { docs: [], tipo: docsC.length ? 'ninguno' : 'sin facturas pendientes', motivo: a ? '[IA] ' + a.motivo : (docsC.length ? (hayIA ? 'La IA no encontró una explicación' : 'Sin clave de IA: solo se proponen casos evidentes') : 'Este proveedor/cliente no tiene facturas con saldo'), confianza: 0 };
      var rucDet = x.det.ruc || (a && a.ruc) || contraRuc;
      var como = x.det.ruc ? x.det.como : (a && a.ruc ? 'IA eligió entre candidatos' : x.det.como);
      filas.push(CIA_fila_(x.p, prop, contra, rucDet, como, cfg));
    });
    hechos++;
  }
  CIA_escribir_(ss, sh, filas, cfg);
  var faltan = claves.length - hechos;
  return Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm') + ' · ' + filas.length + ' propuestas de ' + hechos + ' proveedor(es)/cliente(s)' +
    (faltan > 0 ? ' · faltan ' + faltan + ': vuelva a ▶ Analizar' : '') +
    (sinContra ? ' · ' + sinContra + ' vouchers sin proveedor reconocible' : '') +
    (hayIA ? ' · IA: ' + ia.proveedor + ' (' + consultas + ' consultas)' : ' · sin clave de IA (menú 🧠 Asistente IA → 🔑)') +
    (errores ? ' · ' + errores + ' errores de IA: ' + ultimoError.slice(0, 120) : '');
}

function CIA_fila_(p, prop, contra, rucDet, como, cfg) {
  var f = new Array(CIA_ENC_.length);
  var saldo = prop.docs.reduce(function (s, d) { return s + d.saldo; }, 0);
  f[CIA_C_['✔ Aceptar']] = false; f[CIA_C_['✖ Rechazar']] = false;
  f[CIA_C_['Empresa']] = contra.empresa; f[CIA_C_['Contraparte']] = contra.nombre; f[CIA_C_['RUC contraparte']] = contra.ruc;
  f[CIA_C_['Fecha depósito']] = p.fecha || ''; f[CIA_C_['N° operación']] = p.operacion; f[CIA_C_['Banco']] = p.banco;
  f[CIA_C_['Moneda']] = p.moneda; f[CIA_C_['Monto']] = p.monto;
  f[CIA_C_['Beneficiario (voucher, col. F)']] = p.beneficiarioNombre; f[CIA_C_['Descripción']] = p.descripcion;
  f[CIA_C_['RUC detectado']] = rucDet; f[CIA_C_['Cómo se detectó']] = como;
  f[CIA_C_['Factura(s) propuesta(s) ✏️']] = prop.docs.map(function (d) { return d.doc; }).join(',');
  f[CIA_C_['Saldo de esas facturas']] = prop.docs.length ? redondear2_(saldo) : '';
  f[CIA_C_['Diferencia']] = prop.docs.length ? redondear2_(p.monto - saldo) : '';
  f[CIA_C_['Tipo']] = prop.tipo; f[CIA_C_['Confianza']] = prop.confianza; f[CIA_C_['Motivo']] = prop.motivo;
  f[CIA_C_['Estado']] = prop.docs.length ? CIA_PEND_ : '❔ Sin propuesta';
  f[CIA_C_['Voucher (fuente)']] = p.fuente; f[CIA_C_['ID pago']] = p.id;
  return f;
}

function CIA_leerTabla_(sh) {
  var n = sh.getLastRow() - CIA_F_ENC_;
  if (n < 1) return [];
  return sh.getRange(CIA_F_ENC_ + 1, 1, n, CIA_ENC_.length).getValues().map(function (v, i) {
    return { fila: CIA_F_ENC_ + 1 + i, v: v, id: String(v[CIA_C_['ID pago']] || ''), estado: String(v[CIA_C_['Estado']] || '') };
  }).filter(function (t) { return t.id; });
}

/** Reemplaza las propuestas aún pendientes por las nuevas; conserva lo ya aplicado o rechazado. */
function CIA_escribir_(ss, sh, filas, cfg) {
  var nuevasIds = {};
  filas.forEach(function (f) { nuevasIds[f[CIA_C_['ID pago']]] = true; });
  // Se conserva lo aplicado/rechazado y las propuestas de otros vouchers; se reemplaza lo re-analizado.
  var quedan = CIA_leerTabla_(sh).filter(function (t) { return !nuevasIds[t.id]; }).map(function (t) { return t.v; });
  var todas = filas.concat(quedan);
  var n0 = sh.getLastRow() - CIA_F_ENC_;
  if (n0 > 0) {
    var r0 = sh.getRange(CIA_F_ENC_ + 1, 1, n0, CIA_ENC_.length);
    r0.clearContent(); r0.clearDataValidations(); r0.setBackground(null);
  }
  if (!todas.length) return;
  var n = todas.length, f0 = CIA_F_ENC_ + 1;
  sh.getRange(f0, 1, n, CIA_ENC_.length).setValues(todas).setFontSize(9).setVerticalAlignment('middle');
  sh.getRange(f0, 1, n, 2).insertCheckboxes();
  todas.forEach(function (f, i) {
    if (f[0] === true) sh.getRange(f0 + i, 1).setValue(true);
    if (f[1] === true) sh.getRange(f0 + i, 2).setValue(true);
  });
  sh.getRange(f0, CIA_C_['Fecha depósito'] + 1, n, 1).setNumberFormat('dd/mm/yyyy');
  [CIA_C_['Monto'], CIA_C_['Saldo de esas facturas'], CIA_C_['Diferencia']].forEach(function (c) { sh.getRange(f0, c + 1, n, 1).setNumberFormat('#,##0.00'); });
  sh.getRange(f0, CIA_C_['Confianza'] + 1, n, 1).setNumberFormat('0%');
  sh.getRange(f0, CIA_C_['Factura(s) propuesta(s) ✏️'] + 1, n, 1).setBackground('#FFF8E1');
  var fondos = todas.map(function (f) {
    var e = String(f[CIA_C_['Estado']]);
    var c = e.indexOf('✅') === 0 ? '#DCFCE7' : e.indexOf('✖') === 0 ? '#F1F5F9' : f[CIA_C_['Confianza']] >= 0.8 ? '#EFF6FF' : null;
    return [c];
  });
  sh.getRange(f0, CIA_C_['Estado'] + 1, n, 1).setBackgrounds(fondos);
}

/* ------------------------------------------------------------- aplicar */

function CIA_menuAplicar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var msg;
  try { msg = CIA_aplicar_(ss); } catch (e) { msg = '❌ ' + e.message; }
  CIA_estado_(CIA_hoja_(ss), msg);
  ss.toast(msg, '🤝 Conciliar con IA', 12);
}

function CIA_aplicar_(ss) {
  var sh = CIA_hoja_(ss);
  var cfg = leerConfig_(ss);
  var par = CIA_leerParam_(sh, cfg);
  var tabla = CIA_leerTabla_(sh).filter(function (t) {
    return (t.v[0] === true || t.v[1] === true) && (t.estado === CIA_PEND_ || t.estado === '❔ Sin propuesta' || t.estado.indexOf('⚠️') === 0);
  });
  if (!tabla.length) return 'No hay filas marcadas con ✔ o ✖ pendientes.';
  // Facturas por código y emisor (para armar la clave del documento)
  var porCodigo = {};
  CIA_leerDocs_(ss, cfg, { porCobrar: par.porCobrar, empresaRuc: '' }).forEach(function (d) {
    porCodigo[d.empresaRuc + '|' + d.contraRuc + '|' + d.doc] = d.clave;
  });
  var shDec = obtenerOCrearHoja_(ss, HOJA.DECISIONES);
  var decs = [], alias = [], ok = 0, no = 0, mal = 0, ssV = null, cols = {};
  var aliasExist = cfg.aliasNombre;
  tabla.forEach(function (t) {
    var v = t.v, celda = sh.getRange(t.fila, CIA_C_['Estado'] + 1);
    if (v[1] === true) { celda.setValue('✖ Rechazado'); no++; return; }
    var empRuc = cfg.aliasEmpresa[normHeader_(v[CIA_C_['Empresa']])] || '';
    Object.keys(cfg.nombreEmpresa).forEach(function (r) { if (cfg.nombreEmpresa[r] === v[CIA_C_['Empresa']]) empRuc = r; });
    var contraRuc = aRuc_(v[CIA_C_['RUC detectado']]) || aRuc_(v[CIA_C_['RUC contraparte']]);
    var refs = parsearReferencias_(String(v[CIA_C_['Factura(s) propuesta(s) ✏️']] || ''));
    if (!refs.refs.length) { celda.setValue('⚠️ Escriba la(s) factura(s), ej. 01_F001-123'); mal++; return; }
    var claves = [], faltan = [];
    refs.refs.forEach(function (ref) {
      var cod = ref.tipo + '_' + ref.serie + '-' + ref.numero;
      var k = porCodigo[empRuc + '|' + contraRuc + '|' + cod];
      if (k) claves.push(k); else faltan.push(cod);
    });
    if (faltan.length) { celda.setValue('⚠️ No están en 📋 Documentos de esa contraparte: ' + faltan.join(', ')); mal++; return; }
    decs.push([t.id, 'OK', claves.join(','), new Date()]);
    // Recordar el RUC del nombre del voucher (para que los próximos se reconozcan solos)
    var nombre = String(v[CIA_C_['Beneficiario (voucher, col. F)']] || '');
    if (!par.porCobrar && nombre && contraRuc && !aliasExist[normNombre_(nombre)] && !/ya tenía/.test(String(v[CIA_C_['Cómo se detectó']]))) {
      alias.push([nombre, contraRuc]); aliasExist[normNombre_(nombre)] = contraRuc;
    }
    var txt = '✅ Aplicado ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm');
    if (par.escribirVouchers) {
      try {
        ssV = ssV || SpreadsheetApp.openById(cfg.idVouchers);
        var r1 = IA_pasarDocs_(ssV, cols, String(v[CIA_C_['Voucher (fuente)']]), t.id, refs.refs.map(function (r) { return r.tipo + '_' + r.serie + '-' + r.numero; }).join(','));
        var r2 = par.porCobrar ? '' : CIA_escribirRucVoucher_(ssV, String(v[CIA_C_['Voucher (fuente)']]), contraRuc);
        txt += ' · Vouchers: ' + r1.replace(/^✅ /, '') + (r2 ? ', ' + r2 : '');
      } catch (e) { txt += ' · Vouchers: ' + e.message; }
    }
    celda.setValue(txt);
    ok++;
  });
  if (decs.length) shDec.getRange(shDec.getLastRow() + 1, 1, decs.length, 4).setValues(decs);
  if (alias.length) {
    var shC = ss.getSheetByName(HOJA.CONFIG);
    var col = shC.getRange(3, 9, Math.max(shC.getLastRow(), 3), 1).getValues();
    var fila = 3; while (fila - 3 < col.length && col[fila - 3][0] !== '') fila++;
    shC.getRange(fila, 9, alias.length, 2).setValues(alias);
    shC.getRange(fila, 10, alias.length, 1).setNumberFormat('@');
  }
  var r = ok ? actualizarTodo_(true) : '';
  CIA_escribir_(ss, sh, [], cfg);  // repinta colores
  return ok + ' aplicados, ' + no + ' rechazados' + (mal ? ', ' + mal + ' con aviso (ver Estado)' : '') +
    (alias.length ? ' · ' + alias.length + ' RUC recordados en ⚙️ Config (alias)' : '') + (r ? ' · ' + r : '');
}

/** Escribe el RUC en "ID Beneficiario" del voucher si está vacío. */
function CIA_escribirRucVoucher_(ssV, fuente, ruc) {
  var partes = fuente.split('!');
  var sh = ssV.getSheetByName(partes[0]);
  if (!sh || !ruc) return '';
  var c = indiceColumnas_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0])('ID Beneficiario');
  if (c < 0) return '';
  var celda = sh.getRange(parseInt(partes[1], 10), c + 1);
  if (String(celda.getValue()).trim() !== '') return 'RUC ya estaba';
  celda.setNumberFormat('@').setValue(ruc);
  return 'RUC escrito';
}
