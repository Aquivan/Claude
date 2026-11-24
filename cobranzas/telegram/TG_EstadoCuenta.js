/**
 * 📨 ESTADO DE CUENTA de un proveedor o cliente desde Telegram — el mismo de 🧩 Mesa de conciliación → 📊 Estado de cuenta →
 * 📨 Para enviar, armado en el servidor con los datos guardados (MESA_datos).
 *
 *   «estado de cuenta granix» · «/cuenta 20601234567» · 📋 Menú → 💰 Cobranzas → 📨 Estado de cuenta
 * Busca la contraparte por nombre o RUC (por pagar y por cobrar); si hay varias, se elige con botones.
 * Tarjeta con filtros (botones): 🏢 empresa · 💱 moneda · 📅 periodo · 👁 vista (📋 Resumen · 📑 Por tipo · 🔎 Detallado por fecha).
 * Muestra en el chat el resumen, los totales por tipo y las facturas pendientes; y manda: 📄 PDF · 🖼 Imagen (1.ª página)
 * · 📋 Texto (para copiar) · 📊 Excel (CSV). Solo usuarios autorizados del bot. Funciones ECS_.
 */

var ECS_RX_ = /^\s*(estado\s+de\s+cuenta)\b\s*(?:de\s+|del\s+)?(.*)$/i;   // texto libre: solo «estado de cuenta …» (/cuenta va por TG_comando_)
var ECS_PER_ = [['todo', 'Todo'], ['anio', 'Este año'], ['3m', 'Últimos 3 meses'], ['mesant', 'Mes anterior'], ['mes', 'Este mes']];
var ECS_VIS_ = [['res', '📋 Resumen'], ['tip', '📑 Por tipo'], ['det', '🔎 Detallado']];
var ECS_TIT_ = { fac: '🧾 Facturas', nd: '➕ Notas de débito', nc: '📄 Notas de crédito', ret: '🧾 Retenciones del IGV (3%)', det: '🏦 Detracciones (SPOT)',
  pago: '💳 Pagos (vouchers)', man: '💵 Pagos manuales y efectivo', otr: '✂️ Otros descuentos y compensaciones', dev: '↩️ Devoluciones' };
var ECS_ORDEN_ = ['fac', 'nd', 'nc', 'ret', 'det', 'pago', 'man', 'otr', 'dev'];

function ECS_tg_(ctx, texto) {
  var m = String(texto || '').match(ECS_RX_);
  if (!m) return false;
  ECS_buscarTG_(ctx, m[2].trim());
  return true;
}

/* ------------------------------------------------ datos (los de la Mesa, «guardado») */

var ECS_D_ = {};
function ECS_datos_(lado) {
  if (ECS_D_[lado]) return ECS_D_[lado];
  var d = MESA_datos(MESA_llaveNueva_('Telegram · estado de cuenta'), lado, true);
  var V = {}, movK = {}, movP = {}, porFu = {}, devuelto = {}, devDe = {};
  d.vouchers.forEach(function (v) { V[v.id] = v; porFu[v.fu] = v.id; (v.dups || []).forEach(function (f) { porFu[f] = v.id; }); });
  (d.movs || []).forEach(function (r) {
    var x = { k: r[0], f: r[1], mod: r[2], m: r[3], o: r[4], op: r[5], bco: r[6], mp: r[7], fu: r[8], id: r[9], nota: r[10] };
    (movK[x.k] = movK[x.k] || []).push(x);
    if (x.id) (movP[x.id] = movP[x.id] || []).push(x);
  });
  (d.devs || []).forEach(function (x) {
    var dev = porFu[x.de], id = x.a && porFu[x.a]; if (!id) return;
    devuelto[id] = ECS_r2_((devuelto[id] || 0) + x.m); (devDe[id] = devDe[id] || []).push({ de: dev, m: x.m });
  });
  ECS_D_[lado] = { d: d, V: V, movK: movK, movP: movP, devuelto: devuelto, devDe: devDe };
  return ECS_D_[lado];
}
function ECS_r2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function ECS_fm_(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function ECS_ff_(s) { var m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function ECS_nomEmp_(X, r) { var e = (X.d.empresas || []).filter(function (x) { return x.ruc === r; })[0]; return e ? e.nombre : (r || '¿?'); }
function ECS_g_(m) {
  if (m.mod === 'N/C') return 'nc'; if (m.mod === 'N/D') return 'nd'; if (m.mod === 'Retención') return 'ret'; if (m.mod === 'Detracción') return 'det';
  if (m.mod === 'Devolución') return 'dev'; if (m.mod === 'Otro descuento') return 'otr'; if (/Registro manual/.test(String(m.fu || ''))) return 'man'; return 'pago';
}

/** Las líneas del estado de cuenta (como ecDatos de la Mesa). */
function ECS_lineas_(X, lado, cr, er, mon) {
  var pagar = lado === 'Por pagar', L = [], vou = {}, cre = {};
  var docs = X.d.docs.filter(function (d) { return d.cr === cr && (!er || d.er === er) && d.mon === mon; });
  docs.forEach(function (d) {
    var nd = /^08_/.test(d.doc), nc = /^07_/.test(d.doc) || d.tot < 0;
    L.push({ f: d.f, doc: d.doc, con: (nc ? 'Nota de crédito' : nd ? 'Nota de débito' : 'Factura') + (d.ve ? ' · vence ' + ECS_ff_(d.ve) : '') + (er ? '' : ' · ' + ECS_nomEmp_(X, d.er)), cargo: nc ? 0 : d.tot, abono: nc ? -d.tot : 0, g: nc ? 'nc' : nd ? 'nd' : 'fac' });
    (X.movK[d.k] || []).forEach(function (m) {
      if (m.mod === 'Pago' && X.V[m.id]) { var v = X.V[m.id], x = vou[m.id] || (vou[m.id] = { f: v.f, doc: (v.bco + ' ' + v.op).trim(), apl: [], m: 0, v: v }); x.apl.push(d.doc + ' ' + ECS_fm_(m.m)); x.m = ECS_r2_(x.m + m.m); return; }
      if (m.mod === 'Retención') { var y = cre[m.op] || (cre[m.op] = { f: m.f, doc: String(m.op).replace(/^CRE\s*/, ''), apl: [], m: 0 }); y.apl.push(d.doc + ' ' + ECS_fm_(m.m)); y.m = ECS_r2_(y.m + m.m); return; }
      var g = ECS_g_(m), dlt = m.mod === 'N/D' ? m.m : -m.m;
      L.push({ f: m.f || d.f, doc: m.op || '', con: (m.mod === 'Devolución' ? 'Devolución ' + (m.op || '') : m.mod + (m.op ? ' ' + m.op : '')) + ' · aplicado a ' + d.doc, cargo: dlt > 0 ? dlt : 0, abono: dlt < 0 ? -dlt : 0, g: g });
    });
  });
  X.d.vouchers.forEach(function (v) {
    var c = pagar ? v.br : v.pr, e = pagar ? v.pr : v.br;
    if (c !== cr || (er && e && e !== er) || v.mon !== mon || v.dev) return;
    if (!vou[v.id]) vou[v.id] = { f: v.f, doc: (v.bco + ' ' + v.op).trim(), apl: [], m: 0, v: v };
  });
  Object.keys(vou).forEach(function (id) {
    var x = vou[id], v = x.v, aplTodo = (X.movP[id] || []).reduce(function (t, m) { return m.mod === 'Pago' ? t + m.m : t; }, 0);
    var aCuenta = ECS_r2_(Math.max(0, v.m - aplTodo));
    if (x.m + aCuenta <= 0.005) return;
    L.push({ f: x.f, doc: x.doc, con: (pagar ? 'Pago' : 'Cobro') + (x.apl.length ? ' · aplicado a ' + x.apl.join(', ') : '') + (aCuenta > 0.05 ? ' · a cuenta (sin factura) ' + ECS_fm_(aCuenta) : ''), cargo: 0, abono: ECS_r2_(x.m + aCuenta), g: 'pago' });
    (X.devDe[id] || []).forEach(function (q) { var w = X.V[q.de]; L.push({ f: w ? w.f : x.f, doc: w ? (w.bco + ' ' + w.op).trim() : '', con: 'Devolución ' + (pagar ? 'recibida del proveedor' : 'hecha al cliente') + ' (de ' + x.doc + ')', cargo: q.m, abono: 0, g: 'dev' }); });
  });
  Object.keys(cre).forEach(function (k) { var y = cre[k]; L.push({ f: y.f, doc: y.doc, con: 'Retención IGV 3% · aplicado a ' + y.apl.join(', '), cargo: 0, abono: y.m, g: 'ret' }); });
  var o = { fac: 0, dev: 1, ret: 2, det: 3, nc: 4, pago: 5 };
  L.sort(function (a, b) { return a.f < b.f ? -1 : a.f > b.f ? 1 : (o[a.g] || 9) - (o[b.g] || 9); });
  return { L: L, docs: docs };
}

function ECS_rango_(per) {
  var hoy = new Date(), z = function (d) { return Utilities.formatDate(d, 'America/Lima', 'yyyy-MM-dd'); }, y = hoy.getFullYear(), mo = hoy.getMonth();
  if (per === 'anio') return [y + '-01-01', z(hoy)];
  if (per === '3m') return [z(new Date(y, mo - 3, hoy.getDate())), z(hoy)];
  if (per === 'mesant') return [z(new Date(y, mo - 1, 1)), z(new Date(y, mo, 0))];
  if (per === 'mes') return [z(new Date(y, mo, 1)), z(hoy)];
  return ['', z(hoy)];
}

/** Todo lo calculado para un estado (st = {lado, cr, er, mon, per, vis}). */
function ECS_calc_(st) {
  var X = ECS_datos_(st.lado), x = ECS_lineas_(X, st.lado, st.cr, st.er, st.mon), r = ECS_rango_(st.per), de = r[0], ha = r[1];
  var ini = 0, per = [], R = {};
  x.L.forEach(function (l) { if (l.f > ha) return; var n = ECS_r2_(l.cargo - l.abono); if (de && l.f < de) { ini = ECS_r2_(ini + n); return; } per.push(l); R[l.g] = ECS_r2_((R[l.g] || 0) + l.cargo + l.abono); });
  var fin = ECS_r2_(ini + per.reduce(function (t, l) { return t + l.cargo - l.abono; }, 0));
  var ab = [0, 0, 0, 0, 0], pend = [];
  x.docs.forEach(function (d) {
    if (d.f > ha || d.tot <= 0) return;
    var s = d.tot; (X.movK[d.k] || []).forEach(function (m) { if ((m.f || d.f) <= ha) s += m.mod === 'N/D' ? m.m : -m.m; });
    s = ECS_r2_(s); if (s <= 0.05) return;
    var dd = Math.round((new Date(ha) - new Date(d.ve || d.f)) / 86400000), b = dd <= 0 ? 0 : dd <= 30 ? 1 : dd <= 60 ? 2 : dd <= 90 ? 3 : 4;
    ab[b] = ECS_r2_(ab[b] + s); pend.push({ d: d, s: s, dd: dd });
  });
  var d0 = x.docs[0] || {}, nomC = d0.cn || ((X.d.vouchers.filter(function (v) { return (st.lado === 'Por pagar' ? v.br : v.pr) === st.cr; })[0] || {}).bn) || st.cr;
  var emp = st.er ? (X.d.empresas || []).filter(function (e) { return e.ruc === st.er; })[0] : null;
  var mons = {}; X.d.docs.forEach(function (d) { if (d.cr === st.cr) mons[d.mon] = 1; });
  var emps = {}; X.d.docs.forEach(function (d) { if (d.cr === st.cr && d.er) emps[d.er] = ECS_nomEmp_(X, d.er); });
  return { X: X, de: de, ha: ha, ini: ini, per: per, fin: fin, R: R, ab: ab, pend: pend, nomC: nomC, nomE: emp ? (emp.razon || emp.nombre) : 'Grupo (todas las empresas)',
    sim: st.mon === 'USD' ? 'US$' : 'S/', mons: Object.keys(mons), emps: emps };
}

/* ------------------------------------------------ documento (PDF / imagen / texto / CSV) */

function ECS_html_(st, c) {
  var pagar = st.lado === 'Por pagar', e = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (q) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[q]; }); };
  var M = function (n) { return Math.abs(n) < 0.005 ? '–' : (n < 0 ? '(' + ECS_fm_(-n) + ')' : ECS_fm_(n)); };
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
  var css = 'body{font-family:Arial,sans-serif;font-size:10.5px;color:#111;margin:18px}h1{font-size:17px;margin:0}h2{font-size:12.5px;margin:14px 0 4px;border-bottom:1.5px solid #334155}' +
    'table{width:100%;border-collapse:collapse}th,td{border:1px solid #CBD5E1;padding:3px 5px;text-align:left}th{background:#F1F5F9}.n{text-align:right}.tot td{font-weight:bold;background:#F8FAFC}' +
    '.caja{border:1px solid #CBD5E1;border-radius:6px;padding:6px 8px;display:inline-block;vertical-align:top;width:31%;margin-right:1%}.et{color:#64748B;font-size:9px;text-transform:uppercase}.sub{color:#64748B}';
  var h = '<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    '<table style="border:none"><tr><td style="border:none"><div class="et">' + (pagar ? 'Emitido por (cliente)' : 'Emitido por (proveedor)') + '</div><b style="font-size:13px">' + e(c.nomE) + '</b>' + (st.er ? '<div>RUC ' + e(st.er) + '</div>' : '') + '</td>' +
    '<td style="border:none;text-align:right"><h1>ESTADO DE CUENTA</h1><div class="sub">' + (pagar ? 'Cuentas por pagar · Proveedor' : 'Cuentas por cobrar · Cliente') + '</div>Fecha de emisión: <b>' + ECS_ff_(hoy) + '</b></td></tr></table>' +
    '<div style="margin-top:8px"><div class="caja"><div class="et">' + (pagar ? 'Proveedor' : 'Cliente') + '</div><b>' + e(c.nomC) + '</b><div>RUC ' + e(st.cr) + '</div></div>' +
    '<div class="caja"><div class="et">Periodo</div><b>' + (c.de ? ECS_ff_(c.de) : 'Desde el inicio') + '</b> al <b>' + ECS_ff_(c.ha) + '</b><div class="et">Moneda</div>' + (st.mon === 'USD' ? 'Dólares (US$)' : 'Soles (S/)') + '</div>' +
    '<div class="caja" style="background:#F1F5F9"><div class="et">Saldo al ' + ECS_ff_(c.ha) + '</div><b style="font-size:15px;color:' + (c.fin > 0.05 ? '#B91C1C' : '#065F46') + '">' + c.sim + ' ' + ECS_fm_(Math.abs(c.fin)) + '</b><div class="sub">' + (c.fin > 0.05 ? (pagar ? 'pendiente de pago' : 'pendiente de cobro') : c.fin < -0.05 ? 'a favor' : 'cuenta cancelada') + '</div></div></div>';
  var filasRes = [['(+) Facturas emitidas', c.R.fac], ['(+) Notas de débito', c.R.nd], ['(−) Notas de crédito', -(c.R.nc || 0)], ['(−) Retenciones del IGV (3%)', -(c.R.ret || 0)], ['(−) Detracciones (SPOT)', -(c.R.det || 0)],
    ['(−) ' + (pagar ? 'Pagos realizados' : 'Cobros recibidos'), -((c.R.pago || 0) + (c.R.man || 0))], ['(−) Otros descuentos y compensaciones', -(c.R.otr || 0)], ['(+) Devoluciones', c.R.dev]].filter(function (r) { return Math.abs(r[1] || 0) > 0.005; });
  h += '<h2>Resumen del periodo</h2><table><tr><th>Concepto</th><th class="n">' + c.sim + '</th></tr><tr><td>Saldo inicial' + (c.de ? ' al ' + ECS_ff_(c.de) : '') + '</td><td class="n">' + M(c.ini) + '</td></tr>' +
    filasRes.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="n">' + M(r[1]) + '</td></tr>'; }).join('') + '<tr class="tot"><td>SALDO FINAL al ' + ECS_ff_(c.ha) + '</td><td class="n">' + c.sim + ' ' + M(c.fin) + '</td></tr></table>';
  h += '<h2>Antigüedad de saldos</h2><table><tr><th>Pendientes</th><th class="n">Por vencer</th><th class="n">1–30</th><th class="n">31–60</th><th class="n">61–90</th><th class="n">+90</th></tr><tr><td>' + c.pend.length + ' doc.</td>' + c.ab.map(function (v) { return '<td class="n">' + M(v) + '</td>'; }).join('') + '</tr></table>';
  if (c.pend.length) h += '<h2>Facturas pendientes</h2><table><tr><th>Documento</th><th>Emisión</th><th>Vence</th><th class="n">Días venc.</th><th class="n">Importe</th><th class="n">Saldo</th></tr>' +
    c.pend.sort(function (a, b) { return a.d.f < b.d.f ? -1 : 1; }).map(function (p) { return '<tr><td>' + e(p.d.doc) + (st.er ? '' : ' <span class="sub">' + e(ECS_nomEmp_(c.X, p.d.er)) + '</span>') + '</td><td>' + ECS_ff_(p.d.f) + '</td><td>' + (ECS_ff_(p.d.ve) || '—') + '</td><td class="n">' + (p.dd > 0 ? p.dd : 'por vencer') + '</td><td class="n">' + ECS_fm_(p.d.tot) + '</td><td class="n"><b>' + ECS_fm_(p.s) + '</b></td></tr>'; }).join('') +
    '<tr class="tot"><td colspan="5">Total pendiente</td><td class="n">' + ECS_fm_(c.pend.reduce(function (t, p) { return t + p.s; }, 0)) + '</td></tr></table>';
  if (st.vis === 'tip') {
    ECS_grupos_(c.per).forEach(function (G) {
      h += '<h2>' + ECS_TIT_[G.g].replace(/^\S+\s/, '') + ' · ' + G.l.length + ' · total ' + c.sim + ' ' + ECS_fm_(G.tot) + '</h2><table><tr><th style="width:62px">Fecha</th><th style="width:110px">Documento</th><th>Concepto</th><th class="n" style="width:80px">Monto</th></tr>' +
        G.l.map(function (l) { return '<tr><td>' + ECS_ff_(l.f) + '</td><td>' + e(l.doc) + '</td><td>' + e(l.con) + '</td><td class="n">' + ECS_fm_(l.cargo || l.abono) + '</td></tr>'; }).join('') +
        '<tr class="tot"><td colspan="3">Total (' + G.l.length + ')</td><td class="n">' + ECS_fm_(G.tot) + '</td></tr></table>';
    });
  } else if (st.vis === 'det') {
    var s = c.ini;
    h += '<h2>Movimientos del periodo</h2><table><tr><th style="width:62px">Fecha</th><th style="width:110px">Documento</th><th>Concepto</th><th class="n">Cargos</th><th class="n">Abonos</th><th class="n">Saldo</th></tr><tr><td colspan="5">Saldo inicial</td><td class="n">' + M(c.ini) + '</td></tr>' +
      c.per.map(function (l) { s = ECS_r2_(s + l.cargo - l.abono); return '<tr><td>' + ECS_ff_(l.f) + '</td><td>' + e(l.doc) + '</td><td>' + e(l.con) + '</td><td class="n">' + (l.cargo ? ECS_fm_(l.cargo) : '') + '</td><td class="n">' + (l.abono ? ECS_fm_(l.abono) : '') + '</td><td class="n">' + M(s) + '</td></tr>'; }).join('') +
      '<tr class="tot"><td colspan="5">Saldo final</td><td class="n">' + M(c.fin) + '</td></tr></table>';
  }
  h += '<p class="sub" style="margin-top:12px">Los paréntesis indican saldo a favor. Le agradeceremos revisar este estado de cuenta y comunicarnos cualquier diferencia dentro de los 10 días de recibido.</p>' +
    '<div class="sub" style="text-align:center;margin-top:10px">Generado el ' + ECS_ff_(hoy) + ' · Cuentas por Cobrar y Pagar</div></body></html>';
  return h;
}

function ECS_grupos_(L) {
  var G = {};
  L.forEach(function (l) { var g = ECS_TIT_[l.g] ? l.g : 'otr'; (G[g] = G[g] || []).push(l); });
  return ECS_ORDEN_.filter(function (g) { return G[g]; }).map(function (g) { return { g: g, l: G[g], tot: ECS_r2_(G[g].reduce(function (t, l) { return t + l.cargo + l.abono; }, 0)) }; });
}

function ECS_nombreArchivo_(st, c, ext) {
  return ('Estado de cuenta ' + c.nomC + ' ' + (st.er ? ECS_nomEmp_(c.X, st.er) + ' ' : '') + c.ha).replace(/[\\\/:*?"<>|]+/g, ' ').slice(0, 90) + '.' + ext;
}

function ECS_pdf_(st, c) {
  return Utilities.newBlob(ECS_html_(st, c), 'text/html', 'ec.html').getAs('application/pdf').setName(ECS_nombreArchivo_(st, c, 'pdf'));
}

/** Imagen (PNG/JPG) de la 1.ª página: el PDF pasa por la vista previa de Drive y se borra. */
function ECS_imagen_(st, c) {
  var tmp = DriveApp.createFile(ECS_pdf_(st, c).setName('ec_tmp.pdf')), token = ScriptApp.getOAuthToken(), url = '';
  try {
    [800, 1200, 1800, 2500, 3500, 5000].forEach(function (w) {
      if (url) return;
      Utilities.sleep(w);
      var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + tmp.getId() + '?fields=thumbnailLink', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      try { var t = JSON.parse(r.getContentText()).thumbnailLink; if (t) url = t.replace(/=s\d+/, '=s1700'); } catch (e) {}
    });
    if (!url) throw new Error('Drive no preparó la imagen a tiempo: pruebe 📄 PDF.');
    var img = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (img.getResponseCode() !== 200) throw new Error('no se pudo convertir en imagen (HTTP ' + img.getResponseCode() + ')');
    return img.getBlob().setName(ECS_nombreArchivo_(st, c, 'jpg'));
  } finally { try { tmp.setTrashed(true); } catch (e) {} }
}

function ECS_texto_(st, c) {
  var L = ['ESTADO DE CUENTA · ' + c.nomC + ' (RUC ' + st.cr + ')', c.nomE + ' · ' + (c.de ? ECS_ff_(c.de) : 'desde el inicio') + ' al ' + ECS_ff_(c.ha) + ' · ' + c.sim, ''];
  L.push('Saldo inicial: ' + ECS_fm_(c.ini));
  ECS_grupos_(c.per).forEach(function (G) {
    L.push('', ECS_TIT_[G.g].replace(/^\S+\s/, '').toUpperCase() + ' (' + G.l.length + ')');
    if (st.vis !== 'res') G.l.forEach(function (l) { L.push(ECS_ff_(l.f) + '  ' + l.doc + '  ' + ECS_fm_(l.cargo || l.abono)); });
    L.push('Total: ' + ECS_fm_(G.tot));
  });
  L.push('', 'SALDO FINAL: ' + c.sim + ' ' + ECS_fm_(c.fin) + (c.fin < -0.05 ? ' (a favor)' : ''));
  return L.join('\n');
}

function ECS_csv_(st, c) {
  var q = function (t) { t = String(t == null ? '' : t); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  var L = [['Grupo', 'Fecha', 'Documento', 'Concepto', 'Cargo', 'Abono'].join(';')];
  ECS_grupos_(c.per).forEach(function (G) {
    G.l.forEach(function (l) { L.push([ECS_TIT_[G.g].replace(/^\S+\s/, ''), ECS_ff_(l.f), l.doc, l.con, l.cargo ? l.cargo.toFixed(2) : '', l.abono ? l.abono.toFixed(2) : ''].map(q).join(';')); });
    L.push(['TOTAL ' + ECS_TIT_[G.g].replace(/^\S+\s/, ''), '', '', '', '', G.tot.toFixed(2)].map(q).join(';'));
  });
  L.push(['SALDO FINAL', '', '', '', c.fin.toFixed(2), ''].map(q).join(';'));
  return Utilities.newBlob('﻿' + L.join('\r\n'), 'text/csv', ECS_nombreArchivo_(st, c, 'csv'));
}

/* ------------------------------------------------ Telegram */

function ECS_norm_(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

function ECS_buscarTG_(ctx, q) {
  if (!q) {
    var ses = TG_sesion_(ctx.chatId); ses.esperando = { tipo: 'ecs_q' }; TG_guardarSesion_(ctx.chatId, ses);
    return TG_enviar_(ctx.chatId, '📨 <b>Estado de cuenta</b>: ¿de qué proveedor o cliente? Escriba su nombre o RUC (por ejemplo <i>granix</i> o <i>20601234567</i>).');
  }
  TG_accion_(ctx.chatId, 'typing');
  var nq = ECS_norm_(q), hall = {};
  ['Por pagar', 'Por cobrar'].forEach(function (lado) {
    ECS_datos_(lado).d.docs.forEach(function (d) {
      if (!d.cr) return;
      if (d.cr === q.replace(/\D/g, '') || ECS_norm_(d.cn).indexOf(nq) >= 0) {
        var k = lado + '|' + d.cr, x = hall[k] || (hall[k] = { lado: lado, cr: d.cr, cn: d.cn, n: 0, sal: 0, mon: {} });
        x.n++; x.sal += Math.max(0, d.sal); x.mon[d.mon] = 1;
      }
    });
  });
  var l = Object.keys(hall).map(function (k) { return hall[k]; }).sort(function (a, b) { return b.sal - a.sal; });
  if (!l.length) return TG_enviar_(ctx.chatId, '🔎 No encontré «' + TG_esc_(q) + '» en por pagar ni por cobrar. Pruebe con otra parte del nombre o el RUC.');
  if (l.length === 1) return ECS_tarjetaTG_(ctx, ECS_estado0_(l[0]));
  var b = function (x) { return [{ text: (x.lado === 'Por pagar' ? '💸 ' : '💰 ') + x.cn.slice(0, 34) + ' · ' + x.n + ' doc.', callback_data: 'k:' + TG_guardarBoton_({ t: 'ecs', st: ECS_estado0_(x) }, 21600) }]; };
  TG_tarjeta_(ctx, '🔎 Encontré ' + l.length + ' para «' + TG_esc_(q) + '». ¿Cuál?', l.slice(0, 10).map(b), { nuevo: true });
}

function ECS_estado0_(x) { return { lado: x.lado, cr: x.cr, er: '', mon: x.mon && x.mon.PEN ? 'PEN' : Object.keys(x.mon || { PEN: 1 })[0], per: 'todo', vis: 'tip' }; }

function ECS_tarjetaTG_(ctx, st) {
  TG_accion_(ctx.chatId, 'typing');
  var c = ECS_calc_(st), pagar = st.lado === 'Por pagar', F = ECS_fm_;
  var nom = function (arr, v) { return (arr.filter(function (x) { return x[0] === v; })[0] || ['', v])[1]; };
  var L = ['📨 <b>Estado de cuenta · ' + TG_esc_(c.nomC) + '</b>', '<i>' + (pagar ? 'Por pagar (proveedor)' : 'Por cobrar (cliente)') + ' · RUC ' + TG_esc_(st.cr) + '</i>',
    '🏢 ' + TG_esc_(st.er ? ECS_nomEmp_(c.X, st.er) : 'Todas las empresas') + ' · 💱 ' + c.sim + ' · 📅 ' + nom(ECS_PER_, st.per) + (c.de ? ' (' + ECS_ff_(c.de) + ' – ' + ECS_ff_(c.ha) + ')' : ''), ''];
  if (c.de) L.push('Saldo inicial: ' + F(c.ini));
  ECS_grupos_(c.per).forEach(function (G) { L.push(ECS_TIT_[G.g] + ' (' + G.l.length + '): <b>' + F(G.tot) + '</b>'); });
  L.push('', '<b>Saldo: ' + c.sim + ' ' + F(Math.abs(c.fin)) + '</b> ' + (c.fin > 0.05 ? (pagar ? '(por pagar)' : '(por cobrar)') : c.fin < -0.05 ? '(a favor)' : '✅ cancelada'));
  if (c.pend.length) {
    var venc = c.pend.filter(function (p) { return p.dd > 0; });
    L.push('⏳ ' + c.pend.length + ' factura(s) pendientes' + (venc.length ? ' · 🔴 ' + venc.length + ' vencida(s): ' + F(venc.reduce(function (t, p) { return t + p.s; }, 0)) : ''));
  }
  if (st.vis !== 'res') {
    if (st.vis === 'tip') ECS_grupos_(c.per).forEach(function (G) {
      L.push('', '<b>' + ECS_TIT_[G.g] + '</b>');
      G.l.slice(-8).forEach(function (l) { L.push('• ' + ECS_ff_(l.f) + ' ' + TG_esc_(l.doc) + ' · ' + F(l.cargo || l.abono)); });
      if (G.l.length > 8) L.push('<i>… y ' + (G.l.length - 8) + ' más (en 📄 PDF / 📋 Texto)</i>');
    });
    else {
      var s = c.ini; L.push('', '<b>Movimientos</b> (últimos 15)');
      var lin = c.per.map(function (l) { s = ECS_r2_(s + l.cargo - l.abono); return '• ' + ECS_ff_(l.f) + ' ' + TG_esc_(l.doc) + ' ' + (l.cargo ? '+' + F(l.cargo) : '−' + F(l.abono)) + ' → ' + F(s); });
      L = L.concat(lin.slice(-15));
    }
  }
  var b = function (t, d, stl) { var o = { text: t, callback_data: 'k:' + TG_guardarBoton_({ t: 'ecs', st: d.st || st, a: d.a || '' }, 21600) }; if (stl) o.style = stl; return o; };
  var con = function (k, v) { var x = JSON.parse(JSON.stringify(st)); x[k] = v; return { st: x }; };
  var sig = function (arr, v) { var i = arr.map(function (x) { return x[0]; }).indexOf(v); return arr[(i + 1) % arr.length][0]; };
  var emps = Object.keys(c.emps);
  var filas = [
    [b('🏢 ' + (st.er ? ECS_nomEmp_(c.X, st.er).slice(0, 16) : 'Todas') + ' ›', { a: 'emp' }), b('📅 ' + nom(ECS_PER_, st.per) + ' ›', con('per', sig(ECS_PER_, st.per)))],
    [b('👁 ' + nom(ECS_VIS_, st.vis) + ' ›', con('vis', sig(ECS_VIS_, st.vis)))].concat(c.mons.length > 1 ? [b('💱 ' + (st.mon === 'USD' ? 'US$' : 'S/') + ' ›', con('mon', st.mon === 'USD' ? 'PEN' : 'USD'))] : []),
    [b('📄 PDF', { a: 'pdf' }, 'primary'), b('🖼 Imagen', { a: 'img' }), b('📋 Texto', { a: 'txt' }), b('📊 Excel', { a: 'csv' })],
    [{ text: '📋 Menú', callback_data: 'm:', style: 'link' }]];
  if (emps.length < 2) filas[0].shift();
  TG_tarjeta_(ctx, L.join('\n'), filas);
}

function ECS_alBoton_(ctx, d) {
  var st = d.st;
  try {
    if (d.a === 'emp') {
      var c = ECS_calc_(st), b = function (t, er) { var x = JSON.parse(JSON.stringify(st)); x.er = er; return [{ text: t, callback_data: 'k:' + TG_guardarBoton_({ t: 'ecs', st: x }, 21600) }]; };
      return TG_tarjeta_(ctx, '🏢 ¿De qué empresa del grupo?', [b('Todas las empresas' + (!st.er ? ' ✓' : ''), '')].concat(Object.keys(c.emps).map(function (er) { return b(c.emps[er] + (st.er === er ? ' ✓' : ''), er); })));
    }
    if (d.a === 'pdf' || d.a === 'img' || d.a === 'txt' || d.a === 'csv') {
      TG_accion_(ctx.chatId, d.a === 'img' ? 'upload_photo' : 'upload_document');
      var cc = ECS_calc_(st), cap = '📨 Estado de cuenta · ' + TG_esc_(cc.nomC) + ' · ' + cc.sim + ' ' + ECS_fm_(cc.fin);
      if (d.a === 'pdf') return TG_enviarArchivo_(ctx.chatId, ECS_pdf_(st, cc), cap);
      if (d.a === 'csv') return TG_enviarArchivo_(ctx.chatId, ECS_csv_(st, cc), cap + ' · ábralo con Excel');
      if (d.a === 'txt') return TG_enviar_(ctx.chatId, '<pre>' + TG_esc_(ECS_texto_(st, cc)) + '</pre>');
      var img = ECS_imagen_(st, cc), r = TG_llamar_('sendPhoto', { chat_id: String(ctx.chatId), photo: img, caption: cap + (cc.per.length > 25 ? '\n(1.ª página; el completo en 📄 PDF)' : ''), parse_mode: 'HTML' });
      if (!r.ok) TG_enviarArchivo_(ctx.chatId, img, cap);
      return;
    }
    return ECS_tarjetaTG_(ctx, st);
  } catch (e) { TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
}
