/**
 * Honorarios · Grupo — Conciliar.js
 * 🤝 Conciliar los recibos por honorarios RECIBIDOS con los pagos de la hoja "Sistema de Vouchers".
 *
 * Para cada recibo (no revertido) se espera un pago al emisor por la RENTA NETA (bruta − retención de 4ta).
 * Se buscan los vouchers de la misma empresa pagadora, dirigidos a esa persona (por su RUC 10, su DNI o su
 * nombre) y en fechas razonables (desde 15 días antes del recibo hasta 180 días después), en este orden:
 *   1. el voucher menciona el recibo (E001-68 en "Tipo y N° Doc" o en la descripción);
 *   2. un voucher por el neto exacto del recibo;
 *   3. un voucher que paga varios recibos del mismo emisor (suma de netos);
 *   4. varios vouchers que pagan un recibo (pago en partes);
 *   5. un voucher por la renta BRUTA de un recibo con retención: pagado, pero ⚠️ sin descontar la retención.
 * Lo que solo coincide por nombre (sin RUC/DNI en el voucher) queda como 💡 sugerido hasta marcar ✔.
 *
 * Pestañas que arma:
 *   🤝 Conciliación      un renglón por recibo: estado, voucher(s), diferencia, ✔ / ✖
 *   💸 Por pagar         lo pendiente por emisor (neto a pagar y retención a aplicar al pagar)
 *   ❓ Pagos sin recibo  pagos a personas sin un recibo que los sustente (¿falta pedir el RHE?)
 *   🧾 Retención por pago la retención de 4ta por MES DE PAGO (la que va a la PLAME / 0621)
 * Las ✔ / ✖ se guardan en la pestaña oculta _Decisiones honorarios y se respetan en cada conciliación.
 * La hoja de Vouchers solo se lee: no se cambia nada en ella.
 */

var HCO_HOJA = { CONC: '🤝 Conciliación', PAGAR: '💸 Por pagar', SIN: '❓ Pagos sin recibo', RET: '🧾 Retención por pago', DEC: '_Decisiones honorarios' };
var HCO_TOL_ = 0.5;          // diferencia aceptada en soles (redondeos del banco)
var HCO_ANTES_ = 15, HCO_DESPUES_ = 180;   // días de búsqueda alrededor de la emisión
var HCO_ENC_ = ['Empresa', 'Emisor', 'RUC emisor', 'Recibo', 'Emisión', 'Renta bruta', 'Retención 4ta', 'Neto a pagar', 'Pagado', 'Saldo',
  'Estado', 'Cómo se cruzó', 'Voucher(s)', 'Fecha de pago', '✔ Confirmar', '✖ No es', 'Clave'];

/* ============================================================ menú */

function HCO_menuConciliar() {
  var r = HCO_conciliar_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert('🤝 Conciliar con Vouchers', r.texto, SpreadsheetApp.getUi().ButtonSet.OK);
}

function HCO_menuGuardar() {
  var n = HCO_guardarDecisiones_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert('💾 Confirmaciones', n ? n + ' decisión(es) guardada(s). Vuelva a 🤝 Conciliar para ver el resultado.' :
    'No hay ✔ ni ✖ marcados en ' + HCO_HOJA.CONC + '.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ============================================================ vouchers */

/** Hoja de vouchers: el ID de Config o, si está vacío, la hoja "Sistema de Vouchers" de Drive (se anota en Config). */
function HCO_idVouchers_(ss) {
  var conf = ss.getSheetByName(HON_HOJA.CONFIG), id = '';
  var v = conf.getRange(4, 1, Math.max(conf.getLastRow() - 3, 1), 2).getDisplayValues();
  var fila = -1;
  v.forEach(function (f, i) { if (f[0] === 'ID hoja de Vouchers') { id = String(f[1]).trim(); fila = i + 4; } });
  if (id) return (id.match(/[-\w]{25,}/) || [id])[0];
  if (fila < 0) {   // hoja de Config de antes: se agrega el parámetro al final (no mueve los de arriba)
    fila = conf.getLastRow() + 1;
    conf.getRange(fila, 1, 1, 3).setValues([['ID hoja de Vouchers', '', 'Enlace o ID de la hoja "Sistema de Vouchers" (si está vacío se busca sola en Drive).']]);
    conf.getRange(fila, 1).setFontWeight('bold');
    conf.getRange(fila, 2).setBackground('#fff8e1').setNumberFormat('@');
  }
  var it = DriveApp.searchFiles("title contains 'Sistema de Vouchers' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  if (it.hasNext()) {
    id = it.next().getId();
    if (fila > 0) conf.getRange(fila, 2).setValue(id);
  }
  return id;
}

function HCO_norm_(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pagos de las pestañas Originales y Fotos (un mismo voucher en las dos se cuenta una vez). */
function HCO_leerVouchers_(id, empresas) {
  var ss = SpreadsheetApp.openById(id), out = [], vistos = {};
  var porNombre = {};
  Object.keys(empresas).forEach(function (ruc) { porNombre[HCO_norm_(empresas[ruc])] = ruc; });
  ss.getSheets().filter(function (h) { return /original|foto/i.test(h.getName()); })
    .sort(function (a, b) { return (/original/i.test(b.getName()) ? 1 : 0) - (/original/i.test(a.getName()) ? 1 : 0); })
    .forEach(function (h) {
      if (h.getLastRow() < 2) return;
      var enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(HCO_norm_);
      var col = function () {
        for (var a = 0; a < arguments.length; a++) for (var i = 0; i < enc.length; i++) if (enc[i].indexOf(HCO_norm_(arguments[a])) === 0) return i;
        return -1;
      };
      var c = { fecha: col('Fecha de depos'), op: col('Numero de oper'), banco: col('Banco'), moneda: col('Moneda'), monto: col('Monto'),
        nombre: col('Proveedor (Beneficiario)', 'Beneficiario'), idb: col('ID Beneficiario'), empresa: col('Empresa'), idu: col('ID Usuario'),
        idc: col('idCliente'), refs: col('Tipo y N Doc', 'Tipo y Nro Doc'), desc: col('Descripcion') };
      if (c.monto < 0 || c.fecha < 0) return;
      var n = h.getLastRow() - 1, cols = {};
      // solo las columnas de datos (las de imágenes hacen lenta la lectura)
      Object.keys(c).forEach(function (k) { if (c[k] >= 0 && !cols[c[k]]) cols[c[k]] = h.getRange(2, c[k] + 1, n, 1).getValues(); });
      var val = function (k, i) { return c[k] >= 0 ? cols[c[k]][i][0] : ''; };
      for (var i = 0; i < n; i++) {
        var monto = Number(String(val('monto', i)).replace(/[^\d.-]/g, ''));
        if (!monto) continue;
        var f = val('fecha', i); f = f instanceof Date ? f : HCO_fechaTxt_(f);
        var op = String(val('op', i) || '').trim(), banco = String(val('banco', i) || '').trim();
        var clave = [banco.toUpperCase(), op, monto.toFixed(2)].join('|');
        if (op && vistos[clave]) continue;
        vistos[clave] = true;
        var pagador = HCO_ruc_(val('idu', i)) || porNombre[HCO_norm_(val('empresa', i))] || HCO_ruc_(val('idc', i));
        if (pagador && !empresas[pagador]) pagador = '';
        out.push({ id: h.getName() + '!' + (i + 2), fecha: f, monto: monto, moneda: /USD|DOL|\$/i.test(String(val('moneda', i))) ? 'USD' : 'PEN',
          op: op, banco: banco, pagador: pagador, idb: String(val('idb', i) || '').replace(/\D/g, ''), nombre: String(val('nombre', i) || ''),
          texto: String(val('refs', i) || '') + ' ' + String(val('desc', i) || '') });
      }
    });
  return out;
}

function HCO_ruc_(v) { var s = String(v == null ? '' : v).replace(/\D/g, ''); return s.length === 11 ? s : ''; }

function HCO_fechaTxt_(s) {
  var m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  var a = +m[3] < 100 ? 2000 + (+m[3]) : +m[3];
  return new Date(a, +m[2] - 1, +m[1], 12);
}

/* ============================================================ nombres (bancos los cortan o cambian el orden) */

function HCO_palabras_(s) {
  return HCO_norm_(s).toUpperCase().split(' ').filter(function (w) { return w && ['DE', 'DEL', 'LA', 'LOS', 'Y', 'E'].indexOf(w) < 0; });
}

/** 0–100: palabras del voucher dentro del nombre de SUNAT (APELLIDOS NOMBRES), iniciales y cortes valen como prefijo. */
function HCO_parecido_(voucher, sunat) {
  var q = HCO_palabras_(voucher), c = HCO_palabras_(sunat);
  if (!q.length || !c.length) return 0;
  var usadas = {}, total = 0, peso = 0;
  q.forEach(function (w) {
    var p = w.length === 1 ? 0.6 : 1, mejor = 0, cual = -1;
    peso += p;
    c.forEach(function (x, j) {
      if (usadas[j]) return;
      var s = w === x ? 1 : (w.length === 1 ? (x.charAt(0) === w ? 0.9 : 0) : (w.length >= 3 && x.indexOf(w) === 0 ? 0.92 : 0));
      if (s > mejor) { mejor = s; cual = j; }
    });
    if (cual >= 0) usadas[cual] = true;
    total += mejor * p;
  });
  return Math.round(100 * total / peso);
}

/* ============================================================ conciliación */

function HCO_conciliar_(ss) {
  var cfg = HON_leerConfig_();
  var datos = HON_leerDatos_(cfg);
  var idV = HCO_idVouchers_(ss);
  if (!idV) return { texto: 'No encontré la hoja de Vouchers. Pegue su enlace en Config → "ID hoja de Vouchers".' };
  var vouchers = HCO_leerVouchers_(idV, datos.empresas);
  var dec = HCO_leerDecisiones_(ss);
  var DIA = 86400000;

  // Recibos a pagar (sin revertidos ni notas de crédito)
  var recibos = datos.rec.filter(function (r) { return !HON_esAnulado_(r.estado) && !/^NC/i.test(r.tipo); }).map(function (r) {
    var bruta = Number(HON_num_(r.renta_bruta)) || 0, ret = Number(HON_num_(r.retencion_renta)) || 0;
    var neto = Number(HON_num_(r.renta_neta)) || HON_r2_(bruta - ret);
    return { r: r, clave: [r.empresa_ruc, r.emisor_ruc, r.comprobante].join('|'), empresa: r.empresa_ruc, emisor: r.emisor_ruc,
      nombre: r.emisor, comp: r.comprobante, fecha: HON_fecha_(r.fecha_emision), bruta: bruta, ret: ret, neto: neto,
      moneda: /DOL|USD/i.test(r.moneda) ? 'USD' : 'PEN', pagos: [], como: '', estado: '', sugerido: false };
  });
  var usados = {};   // voucher id → recibos que paga

  // ¿Este voucher es para este emisor? 'id' (RUC/DNI en el voucher) · 'nombre' (solo por nombre) · ''
  var paraQuien = function (v, rc) {
    var dni = rc.emisor.slice(2, 10);
    if (v.idb) return v.idb === rc.emisor || v.idb === dni ? 'id' : '';
    return HCO_parecido_(v.nombre, rc.nombre) >= 85 ? 'nombre' : '';
  };
  var candidatos = function (rc) {
    return vouchers.filter(function (v) {
      if (usados[v.id] || v.moneda !== rc.moneda) return false;
      if (v.pagador && v.pagador !== rc.empresa) return false;
      if (rc.fecha instanceof Date && v.fecha instanceof Date &&
        (v.fecha < rc.fecha.getTime() - HCO_ANTES_ * DIA || v.fecha > rc.fecha.getTime() + HCO_DESPUES_ * DIA)) return false;
      return !!paraQuien(v, rc);
    });
  };
  // seguro = el voucher menciona el recibo: aunque solo coincida el nombre, no queda como sugerido
  var aplicar = function (rcs, vs, como, seguro) {
    vs.forEach(function (v) { usados[v.id] = rcs.map(function (x) { return x.clave; }); });
    rcs.forEach(function (rc) {
      rc.pagos = vs; rc.como = como;
      rc.sugerido = !seguro && vs.some(function (v) { return paraQuien(v, rc) === 'nombre'; }) && dec[rc.clave] !== vs.map(function (v) { return v.id; }).join(',');
    });
  };
  var igual = function (a, b) { return Math.abs(a - b) <= HCO_TOL_; };

  // 0. Decisiones guardadas: ✔ (este voucher paga este recibo) y ✖ (no es)
  recibos.forEach(function (rc) {
    var d = dec[rc.clave];
    if (!d || d === '✖') return;
    var vs = d.split(',').map(function (id) { return vouchers.filter(function (v) { return v.id === id; })[0]; }).filter(Boolean);
    if (vs.length) { aplicar([rc], vs, '✔ confirmado'); rc.sugerido = false; }
  });
  var libres = function () { return recibos.filter(function (rc) { return !rc.pagos.length; }); };
  var rechazado = function (rc, v) { return dec[rc.clave + '|✖'] && dec[rc.clave + '|✖'].indexOf(v.id) >= 0; };

  // 1. El voucher menciona el recibo
  libres().forEach(function (rc) {
    var num = String(rc.comp).split('-'), rx = new RegExp('\\b' + num[0] + '\\s*[-–]?\\s*0*' + (num[1] || 'x') + '\\b', 'i');
    var vs = candidatos(rc).filter(function (v) { return rx.test(v.texto) && !rechazado(rc, v); });
    if (vs.length === 1) aplicar([rc], vs, 'el voucher menciona el recibo', true);
  });
  // 2. Un voucher por el neto exacto
  libres().forEach(function (rc) {
    var vs = candidatos(rc).filter(function (v) { return igual(v.monto, rc.neto) && !rechazado(rc, v); })
      .sort(function (a, b) { return Math.abs(a.fecha - rc.fecha) - Math.abs(b.fecha - rc.fecha); });
    if (vs.length) aplicar([rc], [vs[0]], 'monto exacto (neto)');
  });
  // 3. Un voucher que paga varios recibos del mismo emisor
  var porEmisor = {};
  libres().forEach(function (rc) { (porEmisor[rc.empresa + '|' + rc.emisor] = porEmisor[rc.empresa + '|' + rc.emisor] || []).push(rc); });
  Object.keys(porEmisor).forEach(function (k) {
    var lista = porEmisor[k].slice(0, 12);
    if (lista.length < 2) return;
    var vs = candidatos(lista[0]);
    vs.forEach(function (v) {
      if (usados[v.id]) return;
      var combo = HCO_subconjunto_(lista.filter(function (rc) { return !rc.pagos.length; }), function (rc) { return rc.neto; }, v.monto);
      if (combo && combo.length >= 2) aplicar(combo, [v], 'un pago por ' + combo.length + ' recibos');
    });
  });
  // 4. Varios vouchers para un recibo (pago en partes)
  libres().forEach(function (rc) {
    var vs = candidatos(rc).filter(function (v) { return v.monto < rc.neto && !rechazado(rc, v); }).slice(0, 12);
    var combo = HCO_subconjunto_(vs, function (v) { return v.monto; }, rc.neto);
    if (combo && combo.length >= 2) aplicar([rc], combo, 'pagado en ' + combo.length + ' partes');
  });
  // 5. Pagado por la renta BRUTA: falta descontar la retención
  libres().forEach(function (rc) {
    if (!rc.ret) return;
    var vs = candidatos(rc).filter(function (v) { return igual(v.monto, rc.bruta) && !rechazado(rc, v); });
    if (vs.length) { aplicar([rc], [vs[0]], 'monto = renta BRUTA'); rc.sinRetener = true; }
  });
  // 6. Lo que queda: pagos parciales (un voucher menor al neto) para que se vea el saldo
  libres().forEach(function (rc) {
    var vs = candidatos(rc).filter(function (v) { return v.monto < rc.neto - HCO_TOL_ && !rechazado(rc, v); });
    if (vs.length === 1) { aplicar([rc], vs, 'pago parcial'); rc.parcial = true; }
  });

  var hoy = new Date(), comparte = {};
  recibos.forEach(function (rc) { rc.pagos.forEach(function (v) { comparte[v.id] = (comparte[v.id] || 0) + 1; }); });
  recibos.forEach(function (rc) {
    var pagado = rc.pagos.reduce(function (s, v) { return s + v.monto; }, 0);
    // un pago repartido entre varios recibos (también si se confirmó con ✔): a cada uno su neto
    if (rc.pagos.some(function (v) { return comparte[v.id] > 1; })) pagado = Math.min(pagado, rc.neto);
    if (rc.sinRetener) pagado = rc.neto;                     // pagó la bruta: el recibo queda pagado (la retención va aparte)
    rc.pagado = HON_r2_(pagado);
    rc.saldo = HON_r2_(Math.max(0, rc.neto - rc.pagado));
    var dias = rc.fecha instanceof Date ? Math.floor((hoy - rc.fecha) / DIA) : '';
    rc.estado = !rc.pagos.length ? '🔴 Por pagar' + (dias !== '' ? ' (' + dias + ' días)' : '') :
      rc.sinRetener ? '⚠️ Pagado SIN descontar la retención' : rc.parcial || rc.saldo > HCO_TOL_ ? '🟡 Pago parcial' :
      rc.sugerido ? '💡 Sugerido (por nombre): marque ✔ o ✖' : '✅ Pagado';
    rc.fechaPago = rc.pagos.length ? rc.pagos.reduce(function (m, v) { return v.fecha && (!m || v.fecha > m) ? v.fecha : m; }, null) : '';
  });

  HCO_escribirConciliacion_(recibos);
  HCO_escribirPorPagar_(recibos, datos.empresas);
  var sin = HCO_escribirSinRecibo_(vouchers, usados, recibos, datos.empresas);
  HCO_escribirRetencion_(recibos, datos.empresas);

  var cuenta = function (rx) { return recibos.filter(function (rc) { return rx.test(rc.estado); }).length; };
  return { texto: recibos.length + ' recibos cruzados con ' + vouchers.length + ' vouchers:\n' +
    '✅ ' + cuenta(/^✅/) + ' pagados · 💡 ' + cuenta(/^💡/) + ' sugeridos · 🟡 ' + cuenta(/^🟡/) + ' parciales · ⚠️ ' + cuenta(/^⚠️/) +
    ' sin descontar retención · 🔴 ' + cuenta(/^🔴/) + ' por pagar.\n❓ ' + sin + ' pago(s) a personas sin recibo.\n\n' +
    'Revise ' + HCO_HOJA.CONC + ' (marque ✔ o ✖ en los sugeridos y luego 💾 Guardar confirmaciones), ' + HCO_HOJA.PAGAR + ', ' +
    HCO_HOJA.SIN + ' y ' + HCO_HOJA.RET + '.' };
}

/** Subconjunto (hasta 12 elementos) cuya suma da 'meta' (±tolerancia). null si no hay. */
function HCO_subconjunto_(items, valor, meta) {
  var n = Math.min(items.length, 12), mejor = null;
  for (var m = 1; m < (1 << n); m++) {
    var s = 0, sel = [];
    for (var i = 0; i < n; i++) if (m & (1 << i)) { s += valor(items[i]); sel.push(items[i]); }
    if (Math.abs(s - meta) <= HCO_TOL_ && (!mejor || sel.length < mejor.length)) mejor = sel;
  }
  return mejor;
}

/* ============================================================ pestañas */

function HCO_txtVoucher_(v) {
  return [v.banco, v.op ? 'op ' + v.op : '', v.moneda + ' ' + v.monto.toFixed(2), v.id].filter(Boolean).join(' · ');
}

function HCO_escribirConciliacion_(recibos) {
  var filas = recibos.map(function (rc) {
    return [rc.r.empresa, rc.nombre, rc.emisor, rc.comp, rc.fecha, rc.bruta, rc.ret, rc.neto, rc.pagado, rc.saldo, rc.estado, rc.como,
      rc.pagos.map(HCO_txtVoucher_).join('\n'), rc.fechaPago || '', false, false, rc.clave + '#' + rc.pagos.map(function (v) { return v.id; }).join(',')];
  });
  var h = HON_escribirTabla_(HCO_HOJA.CONC, '🤝 Recibos por honorarios ↔ pagos (hoja de Vouchers)',
    'Neto a pagar = renta bruta − retención de 4ta. ✔ = el voucher sugerido sí paga el recibo · ✖ = no es (se buscará otro). Luego menú 🤝 → 💾 Guardar confirmaciones.',
    HCO_ENC_, filas, { 2: '@', 3: '@', 4: 'dd/mm/yyyy', 5: '#,##0.00', 6: '#,##0.00', 7: '#,##0.00', 8: '#,##0.00', 9: '#,##0.00', 13: 'dd/mm/yyyy' },
    [190, 230, 100, 85, 85, 95, 90, 95, 95, 85, 230, 170, 330, 90, 75, 65, 60]);
  if (filas.length) {
    h.getRange(4, 15, filas.length, 2).insertCheckboxes();
    h.getRange(4, 13, filas.length, 1).setWrap(true);
    h.getRange(4, 1, filas.length, HCO_ENC_.length).setBackgrounds(recibos.map(function (rc) {
      var c = /^✅/.test(rc.estado) ? '#e8f5e9' : /^💡/.test(rc.estado) ? '#e3f2fd' : /^🟡/.test(rc.estado) ? '#fff8e1' : /^⚠️/.test(rc.estado) ? '#fff3e0' : '#fdecea';
      return HCO_ENC_.map(function () { return c; });
    }));
  }
  h.hideColumns(HCO_ENC_.length);
  h.setFrozenColumns(2);
}

function HCO_escribirPorPagar_(recibos, empresas) {
  var g = {};
  recibos.filter(function (rc) { return rc.saldo > HCO_TOL_ && !/^⚠️/.test(rc.estado); }).forEach(function (rc) {
    var k = rc.empresa + '|' + rc.emisor;
    var x = g[k] = g[k] || { empresa: empresas[rc.empresa] || rc.empresa, emisor: rc.nombre, ruc: rc.emisor, n: 0, neto: 0, ret: 0, mas: null, lista: [] };
    x.n++; x.neto += rc.saldo; x.ret += rc.pagado ? 0 : rc.ret;
    if (rc.fecha instanceof Date && (!x.mas || rc.fecha < x.mas)) x.mas = rc.fecha;
    x.lista.push(rc.comp);
  });
  var hoy = new Date();
  var filas = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.neto - a.neto; }).map(function (x) {
    return [x.empresa, x.emisor, x.ruc, x.n, HON_r2_(x.neto), HON_r2_(x.ret), x.mas || '', x.mas ? Math.floor((hoy - x.mas) / 86400000) : '', x.lista.join(', ')];
  });
  HON_escribirTabla_(HCO_HOJA.PAGAR, '💸 Honorarios por pagar (cuentas por pagar)',
    'Neto pendiente de pagar a cada emisor. "Retención a aplicar" = lo que se descuenta del recibo y se paga a SUNAT en el mes en que se paga.',
    ['Empresa', 'Emisor', 'RUC emisor', 'Recibos', 'Neto pendiente', 'Retención a aplicar', 'Recibo más antiguo', 'Días', 'Recibos pendientes'],
    filas, { 2: '@', 4: '#,##0.00', 5: '#,##0.00', 6: 'dd/mm/yyyy' }, [190, 250, 100, 70, 110, 120, 100, 55, 300]);
}

function HCO_escribirSinRecibo_(vouchers, usados, recibos, empresas) {
  // Pagos a personas (RUC 10 / DNI en el voucher, o nombre igual al de un emisor) que no quedaron en ningún recibo.
  var emisores = {};
  recibos.forEach(function (rc) { emisores[rc.emisor] = rc.nombre; emisores[rc.emisor.slice(2, 10)] = rc.nombre; });
  var nombres = Object.keys(emisores).filter(function (k) { return k.length === 11; }).map(function (k) { return { ruc: k, nombre: emisores[k] }; });
  var filas = [];
  vouchers.forEach(function (v) {
    if (usados[v.id] || !v.pagador) return;
    var quien = '';
    if (v.idb && (v.idb.length === 8 || /^10/.test(v.idb))) quien = emisores[v.idb] || '(persona con ' + (v.idb.length === 8 ? 'DNI ' : 'RUC ') + v.idb + ')';
    else if (!v.idb) {
      var m = nombres.filter(function (e) { return HCO_parecido_(v.nombre, e.nombre) >= 85; })[0];
      if (m) quien = m.nombre + ' (por nombre)';
    }
    if (!quien) return;
    filas.push([empresas[v.pagador] || v.pagador, v.fecha || '', v.banco, v.op, v.moneda, v.monto, v.nombre, quien, v.id]);
  });
  HON_escribirTabla_(HCO_HOJA.SIN, '❓ Pagos a personas sin recibo por honorarios',
    'Vouchers a personas naturales que no cuadran con ningún recibo: ¿falta pedir el RHE?, ¿es un adelanto?, ¿es otro tipo de pago (planilla, reembolso)?',
    ['Empresa (paga)', 'Fecha', 'Banco', 'N° operación', 'Moneda', 'Monto', 'Beneficiario (voucher)', 'Parece ser', 'Voucher'],
    filas, { 1: 'dd/mm/yyyy', 3: '@', 5: '#,##0.00' }, [190, 90, 90, 110, 60, 95, 250, 260, 120]);
  return filas.length;
}

function HCO_escribirRetencion_(recibos, empresas) {
  // La retención de 4ta se declara y paga en el mes en que se PAGA el recibo (no en el de emisión).
  var g = {};
  recibos.filter(function (rc) { return rc.ret && rc.pagos.length && rc.fechaPago; }).forEach(function (rc) {
    var mes = Utilities.formatDate(rc.fechaPago, 'America/Lima', 'yyyy-MM');
    var k = rc.empresa + '|' + mes;
    var x = g[k] = g[k] || { empresa: empresas[rc.empresa] || rc.empresa, mes: mes, n: 0, bruta: 0, ret: 0, sin: 0 };
    x.n++; x.bruta += rc.bruta;
    if (rc.sinRetener) x.sin += rc.ret; else x.ret += rc.ret;
  });
  var filas = Object.keys(g).sort().map(function (k) { var x = g[k]; return [x.empresa, x.mes, x.n, HON_r2_(x.bruta), HON_r2_(x.ret), HON_r2_(x.sin)]; });
  HON_escribirTabla_(HCO_HOJA.RET, '🧾 Retención de 4ta por MES DE PAGO (PLAME / 0621)',
    'La retención se declara en el periodo en que se paga el honorario. "Sin descontar" = se pagó la renta bruta: la retención igual se debe a SUNAT.',
    ['Empresa', 'Mes de pago', 'Recibos pagados', 'Renta bruta', 'Retención retenida', 'Retención NO descontada'],
    filas, { 1: '@', 3: '#,##0.00', 4: '#,##0.00', 5: '#,##0.00' }, [200, 90, 110, 110, 130, 150]);
}

/* ============================================================ decisiones ✔ / ✖ */

function HCO_leerDecisiones_(ss) {
  var h = ss.getSheetByName(HCO_HOJA.DEC), d = {};
  if (!h || h.getLastRow() < 2) return d;
  h.getRange(2, 1, h.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (!r[0]) return;
    if (String(r[1]).indexOf('✖') === 0) d[r[0] + '|✖'] = (d[r[0] + '|✖'] || '') + String(r[1]).slice(1) + ',';
    else d[r[0]] = String(r[1]);
  });
  return d;
}

function HCO_guardarDecisiones_(ss) {
  var h = ss.getSheetByName(HCO_HOJA.CONC);
  if (!h || h.getLastRow() < 4) return 0;
  var v = h.getRange(4, 1, h.getLastRow() - 3, HCO_ENC_.length).getValues();
  var dec = ss.getSheetByName(HCO_HOJA.DEC);
  if (!dec) { dec = ss.insertSheet(HCO_HOJA.DEC); dec.getRange(1, 1, 1, 3).setValues([['Recibo', 'Voucher(s) o ✖voucher', 'Fecha']]); dec.hideSheet(); }
  var nuevas = [];
  v.forEach(function (r) {
    var p = String(r[16]).split('#'), clave = p[0], ids = p[1] || '';
    if (r[14] === true && ids) nuevas.push([clave, ids, new Date()]);
    else if (r[15] === true && ids) nuevas.push([clave, '✖' + ids, new Date()]);
  });
  if (nuevas.length) dec.getRange(dec.getLastRow() + 1, 1, nuevas.length, 3).setValues(nuevas);
  return nuevas.length;
}
