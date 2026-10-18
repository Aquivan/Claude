/**
 * Auditor.js — 🔍 AUDITOR IA de compras y pagos (multiempresa).
 *
 * Trabaja como lo haria un auditor de cuentas por pagar, pero con la IA:
 *
 *  1. EXPEDIENTE por empresa × proveedor: junta TODAS sus facturas de compra
 *     (SIRE: aceptadas y propuestas), N/C, retenciones y detracciones, los
 *     vouchers ya aplicados y los vouchers que faltan conciliar. Si el mismo
 *     proveedor tiene facturas en OTRA empresa del grupo, tambien se avisa.
 *  2. REGLAS DE AUDITORIA (codigo, objetivas): pagos duplicados, empresa que
 *     paga equivocada, facturas sobrepagadas o vencidas, retencion o
 *     detraccion no descontada, anticipos sin factura, pagos fraccionados,
 *     beneficiario con otro nombre, facturas pagadas pero no anotadas en SIRE.
 *  3. LA IA CONCILIA el expediente completo como contador: que factura(s)
 *     paga cada voucher y con cuanto (pago total, parcial, neto de retencion
 *     3% o de detraccion, varias facturas, anticipo), escribe su dictamen del
 *     proveedor y sus propios hallazgos.
 *  4. EL CODIGO VERIFICA cada propuesta de la IA (las facturas existen, la
 *     suma cuadra con el voucher, no excede el saldo, misma moneda). Si no
 *     cuadra, se marca "⚠️ revisar" y baja la confianza: la IA propone, las
 *     cuentas las comprueba el sistema.
 *  5. Las propuestas van a la tabla de 🤝 Conciliar con IA (✔ Aceptar /
 *     ✖ Rechazar → ✅ Aplicar lo aceptado), igual que siempre.
 *  6. 💬 PREGUNTA A LA IA: cualquier pregunta sobre lo filtrado; la IA
 *     responde con los expedientes, facturas, vouchers y hallazgos.
 *
 * MOTOR (fila 13):
 *   🧠 IA pura (por defecto): los vouchers se leen SOLO de las columnas A–J y
 *      la IA reconoce cada columna por su contenido (no importan los
 *      encabezados), lee las filas desordenadas, decide proveedor y empresa
 *      de cada pago, concilia sin cálculos auxiliares y da los hallazgos
 *      (AuditorVouchersIA.js). Pestaña 🔍 Vouchers leídos para revisar.
 *   ⚙️ IA + reglas: como antes (reglas fijas + cálculos auxiliares).
 *
 * Filtros: empresa, proveedor (nombre o RUC), quien registro el voucher,
 * fechas, facturas con saldo o todas, vouchers sin aplicar o todos, y la
 * profundidad (solo lo que falta conciliar o auditar todo).
 * Si son muchos proveedores, sigue solo en segundo plano (cada minuto) hasta
 * terminar. Usa la IA y la clave de 🤝 Conciliar con IA (fila 11 / menu 🔑).
 * Modulo aparte: funciones AUD_; no cambia ningun calculo de Cobranzas hasta
 * que usted acepta y aplica una propuesta.
 */

var AUD_HOJA_ = '🔍 Auditor IA';
var AUD_HOJA_HALL_ = '🔍 Hallazgos';
var AUD_DATOS_ = '_Auditor IA';
var AUD_CHAT_ = '_Auditor chat';
var AUD_TODAS_ = '(Todas)';
var AUD_TODOS_ = '(Todos)';
var AUD_PROF_ = ['Rápida: solo proveedores con vouchers por conciliar', 'Completa: auditar todos los proveedores filtrados'];
var AUD_FACT_ = ['Con saldo pendiente', 'Todas'];
var AUD_VOUCH_ = ['Sin aplicar', 'Todos'];
var AUD_MOTOR_ = ['🧠 IA pura: vouchers A–J, la IA decide todo', '⚙️ IA + reglas del sistema (cálculos auxiliares)'];
var AUD_F_MOTOR_ = 13;          // fila del motor de conciliación
var AUD_F_PREG_ = 15;           // fila de la pregunta
var AUD_F_RESP_ = 16;           // primera fila de la respuesta (16-24)
var AUD_F_KPI_ = 26;
var AUD_F_ENC_ = 28;            // encabezado de expedientes
var AUD_LIMITE_MS_ = 255000;    // margen antes de los 6 min de Google
var AUD_MAX_VOUCH_ = 35;        // vouchers por consulta a la IA
var AUD_MAX_DOCS_ = 120;        // facturas por consulta a la IA
var AUD_TOL_ = 1.0;             // tolerancia en soles
var AUD_MAX_IA_ = 60;           // expedientes que la IA revisa por cada ▶ (los de mayor riesgo primero)

var AUD_ENC_ = ['Semáforo', 'Empresa', 'Proveedor', 'RUC', 'Facturas', 'Total facturado', 'Saldo pendiente', 'Vencido > 30 días',
  'Vouchers', 'Monto vouchers', 'Sin aplicar (N°)', 'Sin aplicar S/', 'Saldo − sin aplicar', 'Propuestas IA', 'Hallazgos (alta/media/baja)',
  'Dictamen de la IA', 'Auditado'];
var AUD_ENC_HALL_ = ['Severidad', 'Tipo', 'Empresa', 'Proveedor', 'RUC', 'Detalle', 'Evidencia', 'Monto S/', 'Recomendación', 'Origen', 'Detectado'];

/* ================================================================ menú */

function AUD_menuAbrir() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = AUD_hoja_(ss);
  AUD_actualizarListas_(ss, sh, leerConfig_(ss));
  ss.setActiveSheet(sh);
  ss.toast('Elija los filtros (celdas amarillas) y use ▶ Auditar con IA, o escriba una pregunta en la fila ' + AUD_F_PREG_ + '.', '🔍 Auditor IA', 8);
}

function AUD_menuAuditar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Armando los expedientes por proveedor…', '🔍 Auditor IA', 60);
  var msg;
  try { msg = AUD_iniciar_(ss); } catch (e) { msg = '❌ ' + e.message; console.error(e.stack); }
  AUD_estado_(AUD_hoja_(ss), msg);
  ss.toast(msg, '🔍 Auditor IA', 12);
}

function AUD_menuPreguntar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('La IA está revisando los datos para responder…', '🔍 Auditor IA', 60);
  var msg;
  try { msg = ANA_menuPreguntar_(ss); } catch (e) {
    msg = ANA_mensajeError_(e); console.error(e.stack);
    AUD_hoja_(ss).getRange(AUD_F_RESP_, 2).setValue(msg);
    if (ss.getSheetByName(ANA_HOJA_)) ss.getSheetByName(ANA_HOJA_).getRange(3, 2).setValue(msg);
  }
  ss.toast(msg, '🔍 Auditor IA', 8);
}

function AUD_menuDetener() {
  AUD_borrarContinuacion_();
  if (VER_leerCola_(SpreadsheetApp.getActiveSpreadsheet())) VER_detener_(SpreadsheetApp.getActiveSpreadsheet());
  PropertiesService.getScriptProperties().deleteProperty('AUD_ESTADO');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  AUD_estado_(AUD_hoja_(ss), '⏹ Auditoría detenida ' + AUD_ahora_() + '. Lo ya auditado queda en las tablas.');
  ss.toast('Auditoría detenida.', '🔍 Auditor IA', 5);
}

/* ================================================================ hoja */

var AUD_AYUDA_ = 'Cómo usarlo (menú 💼 Cobranzas → 🤝 Conciliar con IA → 🔍 Auditor IA):\n' +
  '1) Filtre en las celdas amarillas (vacío = todo).\n' +
  '2) ▶ Auditar con IA: arma el expediente de cada proveedor y la IA concilia (si son muchos, sigue sola cada minuto).\n' +
  '   🧠 IA pura (fila ' + AUD_F_MOTOR_ + '): la IA lee los vouchers SOLO en las columnas A–J, reconoce cada columna por su contenido (aunque no tenga encabezado), ' +
  'interpreta las filas desordenadas, decide a qué proveedor y empresa corresponde cada pago, qué facturas paga y qué hallazgos hay. Vea cómo leyó cada fila en 🔍 Vouchers leídos.\n' +
  '   ⚙️ IA + reglas: además el sistema calcula combinaciones exactas y aplica reglas fijas de auditoría.\n' +
  '3) Revise 🔍 Hallazgos y las propuestas en 🤝 Conciliar con IA: ✔ Aceptar / ✖ Rechazar → ✅ Aplicar lo aceptado (nada se aplica solo).\n' +
  '4) 💬 Pregunte lo que quiera en la fila ' + AUD_F_PREG_ + ' (o deje vacío y se abre una ventana) y use 💬 Preguntar a la IA: la IA busca sola facturas, N/C, retenciones, pagos, ' +
  'vouchers A–J (usados o sin usar) y otras hojas, y arma las tablas en la pestaña 💬 Resultado IA. No usa los filtros de arriba: lo que pida en la pregunta manda.\n' +
  'En la columna Motivo el sistema solo anota si la suma de la IA cuadra (✔ cuadra / ⚠️ revisar); no cambia lo que la IA decidió. Usa la IA y la clave de 🤝 Conciliar con IA.';

function AUD_hoja_(ss) {
  var sh = ss.getSheetByName(AUD_HOJA_);
  if (sh && sh.getRange('A1').getValue()) { AUD_asegurarMotor_(sh); return sh; }
  sh = sh || ss.insertSheet(AUD_HOJA_);
  var base = ss.getSheetByName(CIA_HOJA_);
  if (base) { ss.setActiveSheet(sh); ss.moveActiveSheet(base.getIndex() + 1); }
  sh.getRange('A1:Q1').merge().setValue('🔍  AUDITOR IA · compras y pagos de todas las empresas').setFontSize(15).setFontWeight('bold')
    .setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
  sh.setRowHeight(1, 38);
  var p = [
    ['Empresa del grupo', AUD_TODAS_],
    ['Proveedor (nombre o RUC)', ''],
    ['Registrado por (voucher)', AUD_TODOS_],
    ['Desde (fecha)', ''],
    ['Hasta (fecha)', ''],
    ['Facturas', AUD_FACT_[0]],
    ['Vouchers', AUD_VOUCH_[0]],
    ['Profundidad', AUD_PROF_[0]],
    ['Modelo de IA (opcional)', ''],
    ['Estado', ''],
  ];
  sh.getRange(3, 1, p.length, 2).setValues(p);
  sh.getRange(3, 1, p.length, 1).setFontWeight('bold');
  sh.getRange(3, 2, p.length - 1, 1).setBackground('#FFF8E1');
  sh.getRange('B6:B7').setNumberFormat('dd/mm/yyyy');
  sh.getRange('B4').setNumberFormat('@');
  sh.getRange('B8').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(AUD_FACT_).build());
  sh.getRange('B9').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(AUD_VOUCH_).build());
  sh.getRange('B10').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(AUD_PROF_).build());
  sh.getRange('D3:Q11').merge().setValue(AUD_AYUDA_).setWrap(true).setVerticalAlignment('top').setFontSize(9)
    .setFontColor(COLOR.TEXTO_SUAVE).setBackground('#F8FAFC');
  sh.getRange(AUD_F_PREG_ - 1, 1).setValue('💬 PREGUNTA A LA IA').setFontWeight('bold').setFontSize(11);
  sh.getRange(AUD_F_PREG_ - 1, 2).setValue(AUD_EJ_PREG_)
    .setFontSize(8).setFontColor(COLOR.TEXTO_SUAVE);
  sh.getRange(AUD_F_PREG_, 1).setValue('Su pregunta').setFontWeight('bold');
  sh.getRange(AUD_F_PREG_, 2, 1, 16).merge().setBackground('#FFF8E1').setWrap(true).setFontSize(10);
  sh.setRowHeight(AUD_F_PREG_, 40);
  sh.getRange(AUD_F_RESP_, 1).setValue('Respuesta').setFontWeight('bold').setVerticalAlignment('top');
  sh.getRange(AUD_F_RESP_, 2, 9, 16).merge().setWrap(true).setVerticalAlignment('top').setFontSize(10).setBackground('#F8FAFC');
  sh.getRange(AUD_F_ENC_ - 1, 1).setValue('EXPEDIENTES POR EMPRESA Y PROVEEDOR').setFontWeight('bold').setFontSize(12);
  sh.getRange(AUD_F_ENC_, 1, 1, AUD_ENC_.length).setValues([AUD_ENC_]).setFontWeight('bold').setFontColor(COLOR.BLANCO)
    .setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  sh.setColumnWidth(1, 165); sh.setColumnWidth(2, 120);
  [70, 120, 230, 95, 65, 100, 100, 95, 65, 100, 70, 95, 105, 70, 95, 420, 95].forEach(function (w, i) { if (i > 1) sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(2);
  AUD_asegurarMotor_(sh);
  return sh;
}

var AUD_EJ_PREG_ = 'Pregunte libre, ej.: «lista todas las facturas de ALIF a BKF con sus N/C, retenciones y los pagos o vouchers» · ' +
  '«concilia GRANIX con SOAL: qué voucher va a cada factura y cuáles no están usados» · «¿qué vouchers de setiembre no se usaron?»';

/** Fila 13: motor de conciliación (las hojas creadas antes no la tenían) y textos de ayuda al día. */
function AUD_asegurarMotor_(sh) {
  if (String(sh.getRange(AUD_F_PREG_ - 1, 2).getValue()) !== AUD_EJ_PREG_) {
    sh.getRange(AUD_F_PREG_ - 1, 2).setValue(AUD_EJ_PREG_);
    sh.getRange('D3').setValue(AUD_AYUDA_);
  }
  var c = sh.getRange(AUD_F_MOTOR_, 1, 1, 2);
  if (String(c.getValues()[0][0] || '') === 'Motor de conciliación') return;
  c.setValues([['Motor de conciliación', AUD_MOTOR_[0]]]);
  sh.getRange(AUD_F_MOTOR_, 1).setFontWeight('bold');
  sh.getRange(AUD_F_MOTOR_, 2).setBackground('#FFF8E1')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(AUD_MOTOR_).build());
  sh.getRange('D3').setValue(AUD_AYUDA_);
}

function AUD_estado_(sh, txt) { sh.getRange('B12').setValue(txt); }
function AUD_ahora_() { return Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM HH:mm'); }

/** Listas de empresa y de "registrado por" (las de proveedor se escriben a mano: nombre o RUC). */
function AUD_actualizarListas_(ss, sh, cfg, vouchers) {
  var emp = [AUD_TODAS_].concat(cfg.grupo.map(function (r) { return cfg.nombreEmpresa[r] + ' · ' + r; }));
  sh.getRange('B3').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(emp).setAllowInvalid(false).build());
  var quienes = {};
  (vouchers || []).forEach(function (p) { var q = AUD_quien_(p); if (q) quienes[q] = true; });
  var lista = [AUD_TODOS_].concat(Object.keys(quienes).sort()).slice(0, 400);
  sh.getRange('B5').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(lista).setAllowInvalid(true).build());
}

/** Quien registro el voucher: "Enviado por" (Telegram/manual) o, si no, el usuario. */
function AUD_quien_(p) { return String(p.enviadoPor || p.usuario || '').trim(); }

function AUD_leerParam_(sh, cfg, valores) {
  var v = valores || sh.getRange(3, 2, AUD_F_MOTOR_ - 2, 1).getValues().map(function (r) { return r[0]; });
  var empTxt = String(v[0] || '').trim();
  var empresaRuc = '';
  if (empTxt && empTxt !== AUD_TODAS_) empresaRuc = aRuc_(empTxt.split('·').pop()) || cfg.aliasEmpresa[normHeader_(empTxt)] || '';
  var prov = String(v[1] || '').trim();
  var quien = String(v[2] || '').trim();
  var hasta = aFecha_(v[4]);
  return {
    empresaRuc: empresaRuc,
    prov: prov, provRuc: (prov.match(/\d{11}|\d{8}/) || [''])[0], provTokens: prov && !/^\d+$/.test(prov) ? IA_tokens_(prov) : [],
    quien: quien && quien !== AUD_TODOS_ ? quien : '',
    desde: aFecha_(v[3]), hasta: hasta ? new Date(hasta.getTime() + 86399000) : null,
    todasFacturas: /^todas/i.test(String(v[5])),
    todosVouchers: /^todos/i.test(String(v[6])),
    completa: /^completa/i.test(String(v[7])),
    modelo: String(v[8] || '').trim(),
    pura: !/^⚙/.test(String(v[AUD_F_MOTOR_ - 3] || '').trim()),   // vacío = IA pura
  };
}

/* ======================================================== lectura */

/** Facturas "Por pagar" de 📋 Documentos (con todo lo que necesita el auditor). */
function AUD_leerDocs_(ss, cfg) {
  var sh = ss.getSheetByName(HOJA.DOCS);
  var res = [];
  if (!sh || sh.getLastRow() < 2) return res;
  var v = sh.getRange(1, 1, sh.getLastRow(), ENC_DOCS_.length).getValues();
  var I = {}; ENC_DOCS_.forEach(function (n, k) { I[n] = k; });
  var porNombre = {};
  cfg.grupo.forEach(function (r) { porNombre[cfg.nombreEmpresa[r]] = r; });
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    if (r[I['Tipo']] !== 'Por pagar') continue;
    var clave = String(r[I['Clave']] || '');
    if (!clave) continue;
    var empNom = String(r[I['Empresa']] || '');
    var empRuc = porNombre[empNom] || cfg.aliasEmpresa[normHeader_(empNom)] || '';
    res.push({
      empresaRuc: empRuc, empresa: empNom, provRuc: aRuc_(r[I['RUC contraparte']]), prov: String(r[I['Contraparte']] || ''),
      doc: String(r[I['Documento']]), emision: aFecha_(r[I['Emisión']]), vence: aFecha_(r[I['Vence']]),
      moneda: String(r[I['Moneda']] || 'PEN'), total: aNumero_(r[I['Total']]), nc: aNumero_(r[I['N/C']]),
      retencion: aNumero_(r[I['Retención']]), detraccion: aNumero_(r[I['Detracción']]), otros: aNumero_(r[I['Otros desc.']]),
      pagado: aNumero_(r[I['Pagado']]), saldo: aNumero_(r[I['Saldo']]), estado: String(r[I['Estado']] || ''),
      diasVencido: aNumero_(r[I['Días vencido']]), producto: String(r[I['Producto']] || '').slice(0, 60),
      retener: String(r[I['¿Retener? (IGV 3%)']] || ''), retEsperada: aNumero_(r[I['Retención esperada S/']]),
      registro: String(r[I['Registro SIRE']] || ''), clave: clave,
    });
  }
  return res;
}

/** Movimientos aplicados: por voucher (ID pago) y por documento (clave). */
function AUD_leerMovs_(ss) {
  var res = { porPago: {}, porDoc: {} };
  var sh = ss.getSheetByName(HOJA.MOVS);
  if (!sh || sh.getLastRow() < 2) return res;
  var v = sh.getDataRange().getValues();
  var col = indiceColumnas_(v[0]);
  var c = { fecha: col('Fecha'), benef: col('RUC beneficiario'), doc: col('Documento'), mod: col('Modalidad'), monto: col('Monto aplicado'),
    clave: col('Clave'), id: col('ID pago'), op: col('N° operación'), origen: col('Origen') };
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    var m = { fecha: aFecha_(r[c.fecha]), provRuc: aRuc_(r[c.benef]), doc: String(r[c.doc] || ''), modalidad: String(r[c.mod] || ''),
      monto: aNumero_(r[c.monto]), clave: String(r[c.clave] || ''), id: String(r[c.id] || ''), op: String(r[c.op] || ''), origen: String(r[c.origen] || '') };
    if (m.id && m.modalidad === MODALIDAD.PAGO) (res.porPago[m.id] = res.porPago[m.id] || []).push(m);
    if (m.clave) (res.porDoc[m.clave] = res.porDoc[m.clave] || []).push(m);
  }
  return res;
}

/** ¿El proveedor cumple el filtro de nombre o RUC? */
function AUD_provCoincide_(par, ruc, nombre) {
  if (!par.prov) return true;
  if (par.provRuc) return ruc === par.provRuc;
  if (String(ruc).indexOf(par.prov) !== -1) return true;
  var n = normNombre_(nombre);
  if (n.indexOf(normNombre_(par.prov)) !== -1) return true;
  return par.provTokens.length && IA_similitud_(par.provTokens, IA_tokens_(nombre)) >= 0.75;
}

function AUD_enFechas_(par, f) {
  if (!f) return true;
  return (!par.desde || f >= par.desde) && (!par.hasta || f <= par.hasta);
}

/**
 * Arma los expedientes {clave: {empRuc, empresa, provRuc, prov, docs, sin, apl, otras}}.
 * - docs: facturas de esa empresa con ese proveedor.
 * - sin: vouchers de esa empresa al proveedor que aun no estan aplicados.
 * - apl: vouchers ya aplicados (con a que facturas).
 * La contraparte de un voucher sin aplicar se reconoce por RUC, alias o nombre
 * parecido (y lo dudoso lo decide la IA con la lista de proveedores).
 */
function AUD_armar_(ss, cfg, par, ia, contador, ident, deadline) {
  // ident: {idVoucher: {prov, como}} de la primera vuelta (al continuar no se vuelve a preguntar a la IA).
  var docs = AUD_leerDocs_(ss, cfg);
  var movs = AUD_leerMovs_(ss);
  var nombres = {}, porProv = {};
  docs.forEach(function (d) {
    if (d.provRuc && d.prov) nombres[d.provRuc] = d.prov;
    if (d.provRuc) (porProv[d.provRuc] = porProv[d.provRuc] || []).push(d);
  });
  // 🧠 IA pura: vouchers leídos de A–J por la IA, con proveedor y empresa decididos por la IA (AuditorVouchersIA.js).
  var leidos = par.pura ? AUV_preparar_(ss, cfg, par, ia, contador, docs, movs, nombres, deadline || Date.now() + 200000) : null;
  var lv = leidos || leerVouchers_(cfg);
  var vouchers = lv.pagos.filter(function (p) {
    return p.pagadorRuc && cfg.grupo.indexOf(p.pagadorRuc) !== -1 && p.moneda !== '' &&
      (!par.empresaRuc || p.pagadorRuc === par.empresaRuc) && AUD_enFechas_(par, p.fecha) && (!par.quien || AUD_quien_(p) === par.quien);
  });

  // Contraparte de cada voucher (en IA pura ya la decidió la IA)
  var dudosos = [];
  if (!leidos) vouchers.forEach(function (p) {
    var apl = movs.porPago[p.id];
    if (apl && apl.length && apl[0].provRuc) { p._prov = apl[0].provRuc; p._como = 'ya aplicado'; p._apl = apl; return; }
    if (ident && ident[p.id]) { p._prov = ident[p.id].prov; p._como = ident[p.id].como; return; }
    var det = CIA_detectarRuc_(p, { porCobrar: false }, cfg, nombres);
    p._prov = det.ruc; p._como = det.como; p._cands = det.candidatos;
    if (!det.ruc && det.candidatos.length) dudosos.push(p);
  });
  // Lo dudoso: la IA elige el proveedor con la lista completa (por empresa)
  if (!leidos && dudosos.length && ia && ia.clave && !ident) {
    var porEmp = {};
    dudosos.forEach(function (p) { (porEmp[p.pagadorRuc] = porEmp[p.pagadorRuc] || []).push(p); });
    Object.keys(porEmp).forEach(function (emp) {
      var dir = {};
      docs.forEach(function (d) {
        if (!d.provRuc || cfg.grupo.indexOf(d.provRuc) !== -1) return;
        var x = dir[d.provRuc] = dir[d.provRuc] || { ruc: d.provRuc, nombre: nombres[d.provRuc] || d.prov, n: 0, saldo: 0 };
        if (d.saldo > 0.5 && d.empresaRuc === emp) { x.n++; x.saldo += d.saldo; }
      });
      var directorio = Object.keys(dir).map(function (r) { return dir[r]; })
        .sort(function (a, b) { return b.saldo - a.saldo || b.n - a.n; }).slice(0, 450);
      var lista = porEmp[emp];
      for (var i = 0; i < lista.length; i += 60) {
        var trozo = lista.slice(i, i + 60);
        try {
          contador.consultas++;
          var r = CIA_iaRucs_(ia, trozo, directorio, false);
          trozo.forEach(function (p, k) {
            if (r[k] && r[k].ruc) { p._prov = r[k].ruc; p._como = 'IA ' + r[k].confianza + '%: ' + r[k].motivo; }
            else if (p._cands && p._cands[0] && p._cands[0].score >= 0.7) { p._prov = p._cands[0].ruc; p._como = 'nombre parecido (' + Math.round(p._cands[0].score * 100) + '%), sin confirmar'; }
          });
        } catch (e) { contador.errores++; contador.ultimoError = e.message; }
        Utilities.sleep(IA_PROVEEDORES_[ia.proveedor].pausa);
      }
    });
  }

  // Expedientes
  var exp = {}, sinProv = [];
  var tomar = function (emp, prov) {
    var k = emp + '|' + prov;
    return exp[k] = exp[k] || { clave: k, empRuc: emp, empresa: cfg.nombreEmpresa[emp] || emp, provRuc: prov,
      prov: nombres[prov] || '', docs: [], sin: [], apl: [], otras: [] };
  };
  docs.forEach(function (d) {
    if (!d.empresaRuc || !d.provRuc) return;
    if (par.empresaRuc && d.empresaRuc !== par.empresaRuc) return;
    if (!AUD_provCoincide_(par, d.provRuc, d.prov)) return;
    // "Con saldo pendiente": todo lo que se debe, de cualquier fecha. "Todas": las emitidas en el rango.
    if (par.todasFacturas) { if (!AUD_enFechas_(par, d.emision)) return; }
    else if (d.saldo <= 0.5) return;
    tomar(d.empresaRuc, d.provRuc).docs.push(d);
  });
  vouchers.forEach(function (p) {
    if (!p._prov) { if (!p._apl) sinProv.push(p); return; }
    if (cfg.grupo.indexOf(p._prov) !== -1) return;  // pagos entre empresas del grupo: los ve Cobranzas
    if (!AUD_provCoincide_(par, p._prov, nombres[p._prov] || p.beneficiarioNombre)) return;
    if (p._apl) { if (par.todosVouchers || par.completa) tomar(p.pagadorRuc, p._prov).apl.push(p); return; }
    tomar(p.pagadorRuc, p._prov).sin.push(p);
  });
  // Otras empresas del grupo con facturas pendientes de este proveedor
  Object.keys(exp).forEach(function (k) {
    var e = exp[k];
    if (!e.prov) e.prov = (e.sin[0] && e.sin[0].beneficiarioNombre) || e.provRuc;
    var otras = {};
    (porProv[e.provRuc] || []).forEach(function (d) {
      if (d.empresaRuc === e.empRuc || d.saldo <= 0.5) return;
      var o = otras[d.empresaRuc] = otras[d.empresaRuc] || { empresa: d.empresa, n: 0, saldo: 0 };
      o.n++; o.saldo += d.saldo;
    });
    e.otras = Object.keys(otras).map(function (r) { return otras[r]; });
    e.docs.sort(function (a, b) { return (a.emision || 0) - (b.emision || 0); });
    e.sin.sort(function (a, b) { return (a.fecha || 0) - (b.fecha || 0); });
  });
  return { exp: exp, sinProv: sinProv, vouchers: vouchers, docs: docs, movs: movs, nombres: nombres, duplicados: lv.duplicados,
    leidos: leidos, identPend: leidos ? leidos.identPend : 0 };
}

/* ============================================ reglas de auditoría (código) */

function AUD_h_(sev, tipo, e, detalle, evidencia, monto, recom) {
  return { sev: sev, tipo: tipo, empresa: e.empresa, prov: e.prov, ruc: e.provRuc, detalle: detalle, evidencia: evidencia || '',
    monto: monto == null ? '' : redondear2_(monto), recom: recom || '', origen: 'Regla', clave: e.clave || '' };
}

function AUD_lista_(xs, n) {
  return xs.slice(0, n || 6).join(', ') + (xs.length > (n || 6) ? ' y ' + (xs.length - (n || 6)) + ' más' : '');
}

function AUD_vdesc_(p) {
  return IA_fmtFecha_(p.fecha) + ' op ' + (p.operacion || 's/n') + ' ' + p.moneda + ' ' + p.monto.toFixed(2);
}

/**
 * Hallazgos objetivos (no gastan IA). Devuelve una lista de hallazgos.
 * Se miran solo los expedientes y vouchers que pasaron los filtros.
 */
function AUD_reglas_(a, cfg) {
  var res = [], hoy = new Date();
  var expDe = function (emp, prov) {
    return a.exp[emp + '|' + prov] || { clave: emp + '|' + prov, empresa: cfg.nombreEmpresa[emp] || emp, prov: a.nombres[prov] || prov, provRuc: prov };
  };

  // R1 · Posible pago duplicado: misma empresa, mismo beneficiario y monto, otra operación, a 3 días o menos.
  var grupos = {};
  a.vouchers.forEach(function (p) {
    var benef = p._prov || normNombre_(p.beneficiarioNombre);
    if (!benef) return;
    var k = p.pagadorRuc + '|' + benef + '|' + p.moneda + '|' + p.monto.toFixed(2);
    (grupos[k] = grupos[k] || []).push(p);
  });
  Object.keys(grupos).forEach(function (k) {
    var g = grupos[k].sort(function (x, y) { return (x.fecha || 0) - (y.fecha || 0); });
    for (var i = 1; i < g.length; i++) {
      var x = g[i - 1], y = g[i];
      if (!x.fecha || !y.fecha || Math.abs(y.fecha - x.fecha) > 3 * 86400000 || x.operacion === y.operacion) continue;
      res.push(AUD_h_('🔴 Alta', 'Posible pago duplicado', expDe(y.pagadorRuc, y._prov || ''),
        'Dos pagos del mismo monto al mismo beneficiario con ' + Math.round(Math.abs(y.fecha - x.fecha) / 86400000) + ' día(s) de diferencia.',
        AUD_vdesc_(x) + ' (' + x.fuente + ') · ' + AUD_vdesc_(y) + ' (' + y.fuente + ')', y.monto,
        'Confirme con el banco si son dos pagos reales. Si uno es error, pida la devolución o úselo como anticipo de la próxima factura.'));
    }
  });

  // R8 · Pagos fraccionados el mismo día (cada uno ≤ S/ 700 pero juntos más): evita la retención del 3%.
  var dia = {};
  a.vouchers.forEach(function (p) {
    if (!p._prov || !p.fecha || p.moneda !== 'PEN' || p.monto > 700) return;
    var k = p.pagadorRuc + '|' + p._prov + '|' + fmtFechaClave_(p.fecha);
    (dia[k] = dia[k] || []).push(p);
  });
  Object.keys(dia).forEach(function (k) {
    var g = dia[k], suma = g.reduce(function (s, p) { return s + p.monto; }, 0);
    if (g.length < 2 || suma <= 700) return;
    res.push(AUD_h_('🟠 Media', 'Pago fraccionado (≤ S/ 700 c/u)', expDe(g[0].pagadorRuc, g[0]._prov),
      g.length + ' pagos el mismo día que suman S/ ' + suma.toFixed(2) + '. Si la empresa es agente de retención, el monto conjunto obliga a retener 3%.',
      g.map(AUD_vdesc_).join(' · '), suma, 'Revise si correspondía retener el 3% por el pago conjunto.'));
  });

  Object.keys(a.exp).forEach(function (k) {
    var e = a.exp[k];
    var conSaldo = e.docs.filter(function (d) { return d.saldo > 0.5; });
    // R2 · Facturas pagadas de más
    e.docs.filter(function (d) { return d.saldo < -1; }).forEach(function (d) {
      res.push(AUD_h_('🔴 Alta', 'Factura pagada de más', e, d.doc + ': se aplicó ' + Math.abs(d.saldo).toFixed(2) + ' más que su total.',
        d.doc, -d.saldo, 'Verifique si un voucher se aplicó a la factura equivocada o si hay saldo a favor con el proveedor.'));
    });
    // R3 · Facturas vencidas sin pagar
    var venc = conSaldo.filter(function (d) { return d.diasVencido > 30; });
    if (venc.length) {
      var montoV = venc.reduce(function (s, d) { return s + d.saldo; }, 0);
      var masVieja = venc.reduce(function (m, d) { return d.diasVencido > m.diasVencido ? d : m; }, venc[0]);
      res.push(AUD_h_(masVieja.diasVencido > 90 ? '🔴 Alta' : '🟠 Media', 'Facturas vencidas sin pagar', e,
        venc.length + ' factura(s) vencidas hace más de 30 días; la más antigua ' + masVieja.doc + ' (' + masVieja.diasVencido + ' días).',
        AUD_lista_(venc.map(function (d) { return d.doc + ' ' + d.saldo.toFixed(2); })), montoV,
        'Programe el pago o confirme con el proveedor si ya se pagó (puede haber un voucher sin registrar o sin factura escrita).'));
    }
    // R4 · Pagado por la empresa equivocada / R5 · Pago sin factura pendiente
    if (e.sin.length && !conSaldo.length) {
      var montoS = e.sin.reduce(function (s, p) { return s + p.monto; }, 0);
      var viejos = e.sin.filter(function (p) { return p.fecha && hoy - p.fecha > 15 * 86400000; });
      if (e.otras.length) {
        res.push(AUD_h_('🔴 Alta', 'Pago con la empresa equivocada', e,
          e.empresa + ' pagó a este proveedor pero no le debe nada; las facturas pendientes están en ' +
          e.otras.map(function (o) { return o.empresa + ' (' + o.n + ' por S/ ' + Math.round(o.saldo) + ')'; }).join(', ') + '.',
          AUD_lista_(e.sin.map(AUD_vdesc_), 4), montoS, 'Confirme qué empresa debía pagar. Si fue un error, regularice entre empresas del grupo o corrija la empresa del voucher.'));
      } else if (viejos.length) {
        res.push(AUD_h_('🟠 Media', 'Pago sin factura pendiente (anticipo)', e,
          viejos.length + ' voucher(s) de hace más de 15 días sin ninguna factura pendiente de este proveedor.',
          AUD_lista_(viejos.map(AUD_vdesc_), 4), viejos.reduce(function (s, p) { return s + p.monto; }, 0),
          'Pida la factura al proveedor (puede no estar emitida o estar en otro mes de SIRE) o regístrelo como anticipo.'));
      }
    }
    // R6 · Retención del 3% no aplicada
    var ret = e.docs.filter(function (d) { return /^🔴|^🟠/.test(d.retener); });
    if (ret.length) {
      var falta = ret.reduce(function (s, d) { return s + Math.max(0, d.retEsperada - d.retencion); }, 0);
      res.push(AUD_h_('🔴 Alta', 'Retención IGV 3% no aplicada', e,
        ret.length + ' factura(s) pagadas sin retener (o de menos) siendo la empresa agente de retención.',
        AUD_lista_(ret.map(function (d) { return d.doc; })), falta,
        'Emita el comprobante de retención (CRE) y declárelo en el PDT 626; si ya se pagó completo, el 3% se descuenta del próximo pago o se asume.'));
    }
    // R7 · Detracción no depositada
    var det = e.docs.filter(function (d) { return d.estado === '🟣 Falta detracción'; });
    if (det.length) {
      res.push(AUD_h_('🟠 Media', 'Detracción pendiente de depositar', e, det.length + ' factura(s) pagadas al proveedor pero falta la detracción.',
        AUD_lista_(det.map(function (d) { return d.doc + ' ' + d.saldo.toFixed(2); })), det.reduce(function (s, d) { return s + d.saldo; }, 0),
        'Deposite la detracción en el Banco de la Nación (cuenta del proveedor) y registre la constancia; sin ella no se usa el crédito fiscal.'));
    }
    // R10 · Pagada pero no anotada en el registro de compras
    var noAnot = e.docs.filter(function (d) { return /^🟡/.test(d.registro) && d.pagado > 0.5; });
    if (noAnot.length) {
      res.push(AUD_h_('🟠 Media', 'Pagada pero no anotada en SIRE', e,
        noAnot.length + ' factura(s) ya pagadas que quedaron fuera de la aceptada del registro de compras: crédito fiscal no tomado.',
        AUD_lista_(noAnot.map(function (d) { return d.doc; })), noAnot.reduce(function (s, d) { return s + d.total; }, 0),
        'Anótelas en el registro de compras (dentro de los 12 meses siguientes a la emisión) para usar el crédito fiscal.'));
    }
    // R9 · Beneficiario del voucher con otro nombre
    var raros = e.apl.filter(function (p) {
      return p.beneficiarioNombre && e.prov && !cfg.aliasNombre[normNombre_(p.beneficiarioNombre)] && CIA_parecido_(p.beneficiarioNombre, e.prov) < 0.35;
    });
    if (raros.length) {
      res.push(AUD_h_('🟢 Baja', 'Beneficiario con otro nombre', e,
        raros.length + ' pago(s) aplicados a este proveedor salieron a nombre de otra persona/empresa.',
        AUD_lista_(raros.map(function (p) { return '"' + p.beneficiarioNombre + '" ' + AUD_vdesc_(p); }), 3),
        raros.reduce(function (s, p) { return s + p.monto; }, 0), 'Confirme que el pago llegó al proveedor (nombre comercial, factoring o tercero autorizado).'));
    }
  });

  // R11 · Vouchers sin proveedor reconocible
  var porEmp = {};
  a.sinProv.forEach(function (p) { (porEmp[p.pagadorRuc] = porEmp[p.pagadorRuc] || []).push(p); });
  Object.keys(porEmp).forEach(function (emp) {
    var g = porEmp[emp];
    res.push(AUD_h_('🟢 Baja', 'Vouchers sin proveedor reconocible', { empresa: cfg.nombreEmpresa[emp] || emp, prov: '', provRuc: '', clave: '' },
      g.length + ' voucher(s) cuyo beneficiario no coincide con ningún proveedor de SIRE (planilla, impuestos, servicios sin factura, personas).',
      AUD_lista_(g.map(function (p) { return '"' + (p.beneficiarioNombre || '?') + '" ' + p.monto.toFixed(2); }), 5),
      g.reduce(function (s, p) { return s + p.monto; }, 0), 'Revise 📂 Otros pagos o complete el RUC del beneficiario en el voucher.'));
  });
  return res;
}

/* ======================================================== la IA concilia */

var AUD_SISTEMA_ = [
  'Eres auditor y contador senior en Perú, experto en cuentas por pagar, SIRE, SPOT (detracciones) y régimen de retenciones del IGV.',
  'Recibes el EXPEDIENTE de UNA empresa compradora con UN proveedor: sus facturas (con saldo), los vouchers bancarios por conciliar,',
  'los pagos que ya están aplicados y si el proveedor tiene deudas con otras empresas del grupo. Tu trabajo:',
  '1) CONCILIAR: decide qué factura(s) paga cada voucher (V1, V2…) y CUÁNTO del voucher va a cada una (en la moneda del voucher).',
  '2) AUDITAR: detecta problemas y escribe un DICTAMEN breve del estado de la cuenta con este proveedor.',
  '',
  'Cómo se paga en Perú (úsalo para explicar los montos):',
  '- Detracción (SPOT): el comprador deposita 4%, 10% o 12% del total en el Banco de la Nación aparte; al proveedor le transfiere total − detracción.',
  '- Retención IGV: si la empresa es agente de retención, paga total − 3% (no aplica a facturas ≤ S/ 700 salvo que un mismo pago junte más de S/ 700).',
  '- Las N/C reducen el saldo. Hay pagos parciales (cuotas) y un voucher puede pagar varias facturas. Puede haber redondeos o comisiones de pocos soles.',
  '- Si el voucher trae "factura escrita", esa referencia manda salvo que el monto la contradiga claramente.',
  '- Sin referencia, lo normal es pagar primero las facturas más antiguas (FIFO). Un pago no suele ser anterior a la factura (salvo anticipo, hasta 5 días).',
  '- Facturas en USD y voucher en PEN (o al revés): solo si calza con un tipo de cambio entre 3.3 y 4.0; dilo en la razón.',
  '- Los "CÁLCULOS AUXILIARES" ya están verificados por el sistema: úsalos, no recalcules de memoria.',
  '',
  'Reglas estrictas:',
  '- Usa SOLO códigos de factura y vouchers de la lista. No inventes. Si un voucher no se explica, ponlo en "sin_factura" con la razón.',
  '- La suma de "monto" de un voucher no puede pasar el monto del voucher. Una factura no puede recibir más que su saldo.',
  '- "monto" es lo que sale del voucher para esa factura (si es neto de detracción/retención, el monto neto).',
  '- Hallazgos: solo lo que el expediente muestre (duplicados, pagos de más, empresa equivocada, retención/detracción no descontada,',
  '  facturas antiguas impagas, anticipos, beneficiario distinto, montos que no calzan). No repitas lo obvio.',
  '',
  'Responde SOLO JSON con esta forma:',
  '{"asignaciones":[{"voucher":"V1","facturas":[{"doc":"01_F001-123","monto":1180.00}],"tipo":"total|parcial|varias|neto detraccion|neto retencion|anticipo|otro","confianza":0,"razon":""}],',
  ' "sin_factura":[{"voucher":"V3","razon":""}],',
  ' "hallazgos":[{"severidad":"alta|media|baja","tipo":"","detalle":"","evidencia":"","monto":0,"recomendacion":""}],',
  ' "dictamen":"", "semaforo":"verde|amarillo|rojo"}',
  '"confianza" 0-100. "razon" máx. 35 palabras, con el cálculo (ej. 01_F001-9 1,180.00 − 12% = 1,038.40). "dictamen" máx. 70 palabras, en español.',
].join('\n');

/** Instrucciones para la IA: en IA pura no hay cálculos auxiliares, la IA hace las cuentas y lee la fila original. */
function AUD_sistema_(pura) {
  if (!pura) return AUD_SISTEMA_;
  return AUD_SISTEMA_.split('\n').map(function (l) {
    if (/CÁLCULOS AUXILIARES/.test(l)) {
      return '- Haz TÚ las cuentas, con cuidado y a 2 decimales: prueba 1 factura, varias (sobre todo seguidas por fecha), netos de retención 3% y de detracción 4/10/12%, ' +
        'pagos a cuenta y diferencias de pocos soles. Escribe la cuenta en "razon" (ej. 8,454.52 + 10,951.30 = 19,405.82).\n' +
        '- Cada voucher viene con su FILA ORIGINAL de la hoja (columnas A–J): léela completa (descripción, factura escrita, usuario), no solo el monto.';
    }
    return l;
  }).join('\n');
}

var AUD_TASAS_DET_ = [0.04, 0.10, 0.12];

/**
 * Cálculos auxiliares para un voucher, como los arma un auditor (los hace el
 * código, exactos, para que la IA no sume de memoria):
 *   - 1 o 2 facturas cualesquiera;
 *   - 3 a 8 facturas SEGUIDAS por fecha (así se paga un lote; nunca saltadas al azar,
 *     que con muchas facturas siempre "calzan" por casualidad);
 * y para cada grupo: saldo exacto, neto de retención 3% (solo si las facturas
 * están sujetas a retención) o neto de detracción 4/10/12% (facturas > S/ 700).
 * Ordena: menos facturas primero, exacto antes que neto, la más antigua primero.
 */
function AUD_pistas_(p, docs) {
  var m = p.monto, res = [];
  var cand = docs.filter(function (d) {
    return d.saldoVivo > 0.5 && d.moneda === p.moneda && (!d.emision || !p.fecha || d.emision.getTime() <= p.fecha.getTime() + 15 * 86400000);
  }).slice(0, 40);
  var sujetaRet = function (d) { return !d.retencion && /^(⏳|🔴|🟠|Sí)/.test(d.retener); };
  var conDet = function (d) { return !d.detraccion && d.total > 700; };
  function probar(sel, orden) {
    var G = 0, T = 0;
    sel.forEach(function (d) { G += d.saldoVivo; T += d.total; });
    var tol = sel.length <= 2 ? 0.5 : 0.1;
    var tipo = '';
    if (Math.abs(G - m) <= tol) tipo = 'exacto';
    else if (sel.every(sujetaRet) && Math.abs(G - 0.03 * T - m) <= tol + 0.05 * sel.length) tipo = 'neto retención 3%';
    else if (sel.length <= 2 && sel.every(conDet)) {
      for (var t = 0; t < AUD_TASAS_DET_.length && !tipo; t++) {
        if (Math.abs(G - Math.round(AUD_TASAS_DET_[t] * T) - m) <= 1 || Math.abs(G - AUD_TASAS_DET_[t] * T - m) <= tol) tipo = 'neto detracción ' + (AUD_TASAS_DET_[t] * 100) + '%';
      }
    }
    if (tipo) res.push({ n: sel.length, exacto: tipo === 'exacto' ? 0 : 1, orden: orden,
      txt: sel.map(function (d) { return d.doc; }).join(' + ') + ' = ' + tipo + ' (saldo ' + G.toFixed(2) + ')' });
  }
  var i, j;
  for (i = 0; i < cand.length; i++) probar([cand[i]], i);
  for (i = 0; i < cand.length; i++) for (j = i + 1; j < cand.length; j++) probar([cand[i], cand[j]], i * 100 + j);
  for (var n = 3; n <= 8; n++) for (i = 0; i + n <= cand.length; i++) probar(cand.slice(i, i + n), i);
  return res.sort(function (x, y) { return x.n - y.n || x.exacto - y.exacto || x.orden - y.orden; })
    .slice(0, 4).map(function (x) { return x.txt; });
}

function AUD_texto_(e, sin, docs, pura) {
  var f2 = function (n) { return Number(n || 0).toFixed(2); };
  var L = [];
  L.push('EMPRESA COMPRADORA: ' + e.empresa + ' (RUC ' + e.empRuc + ')');
  L.push('PROVEEDOR: ' + e.prov + ' (RUC ' + e.provRuc + ')');
  if (e.otras.length) L.push('OJO: este proveedor también tiene facturas pendientes con otras empresas del grupo: ' +
    e.otras.map(function (o) { return o.empresa + ' ' + o.n + ' fact. S/ ' + Math.round(o.saldo); }).join('; '));
  L.push('');
  L.push('FACTURAS CON SALDO (código | emisión | vence | moneda | total | N/C | retención | detracción | pagado | saldo | retención IGV | registro SIRE | producto):');
  docs.forEach(function (d) {
    L.push([d.doc, IA_fmtFecha_(d.emision), IA_fmtFecha_(d.vence), d.moneda, f2(d.total), f2(d.nc), f2(d.retencion), f2(d.detraccion),
      f2(d.pagado), f2(d.saldoVivo), d.retener || '-', d.registro || '-', d.producto || '-'].join(' | '));
  });
  if (!docs.length) L.push('(no hay facturas con saldo de este proveedor en esta empresa)');
  L.push('');
  if (pura) {
    L.push('VOUCHERS POR CONCILIAR (id | leído: fecha, moneda y monto | cómo se reconoció el proveedor | FILA ORIGINAL A–J):');
    sin.forEach(function (p, k) {
      L.push(['V' + (k + 1), IA_fmtFecha_(p.fecha) + ' ' + p.moneda + ' ' + f2(p.monto), p._como || '-', p.fuente + ': ' + (p.crudo || '')].join(' | '));
    });
  } else {
    L.push('VOUCHERS POR CONCILIAR (id | fecha | banco | operación | moneda | monto | beneficiario escrito | descripción | factura escrita | cómo se reconoció el proveedor):');
    sin.forEach(function (p, k) {
      L.push(['V' + (k + 1), IA_fmtFecha_(p.fecha), p.banco, p.operacion || 's/n', p.moneda, f2(p.monto), p.beneficiarioNombre || '-',
        p.descripcion || '-', p.refs || '-', p._como || '-'].join(' | '));
    });
  }
  var pistas = [];
  if (!pura) {
  sin.forEach(function (p, k) {
    var ps = AUD_pistas_(p, docs);
    if (ps.length) pistas.push('V' + (k + 1) + ': ' + ps.join(' ; '));
  });
  L.push('');
  L.push('CÁLCULOS AUXILIARES (verificados por el sistema):');
  L.push(pistas.length ? pistas.join('\n') : '(ninguna combinación de 1 a 4 facturas calza exacta: puede ser pago parcial, a cuenta o de otro proveedor)');
  }
  if (e.apl.length) {
    L.push('');
    L.push('PAGOS YA APLICADOS (para detectar duplicados; NO los vuelvas a asignar) (fecha | operación | monto | aplicado a):');
    e.apl.slice(-40).forEach(function (p) {
      L.push([IA_fmtFecha_(p.fecha), p.operacion || 's/n', p.moneda + ' ' + f2(p.monto),
        (p._apl || []).map(function (m) { return m.doc + ' ' + f2(m.monto); }).join(', ')].join(' | '));
    });
  }
  return L.join('\n');
}

/**
 * Verifica lo que propuso la IA. Devuelve {props, sinFactura, hallazgos, dictamen, semaforo}.
 * props: [{p, docs:[d], montos:[n], tipo, confianza(0-1), razon, verif}]
 */
function AUD_verificar_(r, sin, docs) {
  var porDoc = {};
  docs.forEach(function (d) { porDoc[d.doc] = d; });
  var res = { props: [], sinFactura: [], hallazgos: [], dictamen: String(r.dictamen || '').slice(0, 600),
    semaforo: String(r.semaforo || '').toLowerCase() };
  var vId = function (x) { var k = parseInt(String(x || '').replace(/\D/g, ''), 10) - 1; return k >= 0 && k < sin.length ? k : -1; };
  var usados = {};
  (Array.isArray(r.asignaciones) ? r.asignaciones : []).forEach(function (a) {
    var k = vId(a.voucher);
    if (k < 0 || usados[k]) return;
    var p = sin[k];
    var items = (Array.isArray(a.facturas) ? a.facturas : []).map(function (f) {
      return { d: porDoc[String(f.doc || '').trim()], monto: aNumero_(f.monto), cod: String(f.doc || '') };
    });
    var malos = items.filter(function (x) { return !x.d; }).map(function (x) { return x.cod; });
    items = items.filter(function (x) { return x.d && x.monto > 0; });
    if (!items.length) {
      if (malos.length) res.sinFactura.push({ p: p, razon: 'La IA citó facturas que no existen en el expediente: ' + malos.join(', ') });
      return;
    }
    usados[k] = true;
    var avisos = [], graves = [];
    if (malos.length) avisos.push('ignoré ' + malos.join(', ') + ' (no existen)');
    var suma = items.reduce(function (s, x) { return s + x.monto; }, 0);
    var dif = redondear2_(p.monto - suma);
    if (dif < -AUD_TOL_) graves.push('reparte ' + suma.toFixed(2) + ', más que el voucher');
    else if (dif > AUD_TOL_) avisos.push('sobran ' + dif.toFixed(2) + ' del voucher');
    var neto = /neto/i.test(String(a.tipo || ''));
    items.forEach(function (x) {
      if (x.d.moneda !== p.moneda) avisos.push(x.d.doc + ' en ' + x.d.moneda);
      if (x.monto > x.d.saldoVivo + AUD_TOL_) graves.push(x.d.doc + ' recibe ' + x.monto.toFixed(2) + ' y su saldo es ' + x.d.saldoVivo.toFixed(2));
      if (x.d.emision && p.fecha && p.fecha.getTime() < x.d.emision.getTime() - 5 * 86400000) avisos.push('pago anterior a ' + x.d.doc);
    });
    var conf = Math.max(0, Math.min(100, parseInt(a.confianza, 10) || 0)) / 100;
    if (graves.length) conf = Math.min(conf, 0.3); else if (avisos.length) conf = Math.min(conf, 0.6);
    // Lo que queda por pagar de cada factura para los siguientes vouchers
    items.forEach(function (x) {
      x.d.saldoVivo = neto && items.length === 1 ? 0 : Math.max(0, redondear2_(x.d.saldoVivo - x.monto));
    });
    res.props.push({
      p: p, docs: items.map(function (x) { return x.d; }), montos: items.map(function (x) { return x.monto; }),
      tipo: String(a.tipo || ''), confianza: conf, razon: String(a.razon || '').slice(0, 300),
      verif: graves.length ? '✖ no cuadra: ' + graves.join('; ') : avisos.length ? '⚠️ revisar: ' + avisos.join('; ') : '✔ cuadra',
    });
  });
  (Array.isArray(r.sin_factura) ? r.sin_factura : []).forEach(function (s) {
    var k = vId(s.voucher);
    if (k >= 0 && !usados[k]) { usados[k] = true; res.sinFactura.push({ p: sin[k], razon: String(s.razon || '').slice(0, 300) }); }
  });
  (Array.isArray(r.hallazgos) ? r.hallazgos : []).slice(0, 15).forEach(function (h) {
    var s = String(h.severidad || '').toLowerCase();
    res.hallazgos.push({ sev: /alta/.test(s) ? '🔴 Alta' : /media/.test(s) ? '🟠 Media' : '🟢 Baja', tipo: String(h.tipo || 'Observación').slice(0, 80),
      detalle: String(h.detalle || '').slice(0, 500), evidencia: String(h.evidencia || '').slice(0, 300),
      monto: aNumero_(h.monto) || '', recom: String(h.recomendacion || '').slice(0, 300) });
  });
  return res;
}

/** Concilia un expediente con la IA (en tandas si es grande). */
function AUD_auditarExp_(e, ia, contador, pura) {
  var docs = e.docs.filter(function (d) { return d.saldo > 0.5; });
  docs.forEach(function (d) { d.saldoVivo = d.saldo; });
  var out = { props: [], sinFactura: [], hallazgos: [], dictamen: '', semaforo: '' };
  var tandas = [];
  for (var i = 0; i < e.sin.length; i += AUD_MAX_VOUCH_) tandas.push(e.sin.slice(i, i + AUD_MAX_VOUCH_));
  if (!tandas.length) tandas.push([]);  // auditoría completa: dictamen aunque no haya vouchers por conciliar
  tandas.forEach(function (sin, t) {
    var ultimo = sin.reduce(function (m, p) { return p.fecha && p.fecha > m ? p.fecha : m; }, null);
    var ds = docs.filter(function (d) {
      return d.saldoVivo > 0.5 && (!ultimo || !d.emision || d.emision.getTime() <= ultimo.getTime() + 15 * 86400000);
    }).slice(0, AUD_MAX_DOCS_);
    if (contador.consultas > 0) Utilities.sleep(IA_PROVEEDORES_[ia.proveedor].pausa);
    contador.consultas++;
    try {
      var r = IA_llamar_({ proveedor: ia.proveedor, modelo: ia.modelo, clave: ia.clave, sistema: AUD_sistema_(pura),
        texto: AUD_texto_(e, sin, ds, pura), maxTokens: 16000 });
      var v = AUD_verificar_(r, sin, ds);
      out.props = out.props.concat(v.props);
      out.sinFactura = out.sinFactura.concat(v.sinFactura);
      out.hallazgos = out.hallazgos.concat(v.hallazgos);
      if (v.dictamen) out.dictamen = (tandas.length > 1 ? out.dictamen + (out.dictamen ? ' ' : '') : '') + v.dictamen;
      if (v.semaforo) out.semaforo = AUD_peorSemaforo_(out.semaforo, v.semaforo);
    } catch (err) {
      contador.errores++; contador.ultimoError = err.message;
      out.dictamen = out.dictamen || '⚠️ La IA no respondió (' + err.message.slice(0, 120) + ').';
    }
  });
  return out;
}

function AUD_peorSemaforo_(a, b) {
  var orden = { rojo: 3, amarillo: 2, verde: 1 };
  return (orden[b] || 0) > (orden[a] || 0) ? b : a;
}

/* ======================================= sin IA: solo lo evidente (exacto) */

function AUD_sinIA_(e) {
  var docs = e.docs.filter(function (d) { return d.saldo > 0.5; });
  docs.forEach(function (d) { d.saldoVivo = d.saldo; });
  var out = { props: [], sinFactura: [], hallazgos: [], dictamen: 'Sin clave de IA: solo se proponen los pagos que calzan exacto (menú 💼 Cobranzas → 🤝 Conciliar con IA → 🔑).', semaforo: '' };
  var porDoc = {};
  docs.forEach(function (d) { porDoc[d.doc] = d; });
  e.sin.forEach(function (p) {
    var ps = AUD_pistas_(p, docs);
    if (!ps.length) return;
    var cods = ps[0].split(' = ')[0].split(' + ');
    var ds = cods.map(function (c) { return porDoc[c]; }).filter(Boolean);
    var tipo = ps[0].split(' = ')[1].replace(/\s*\(.*$/, '');
    // Lo que sale del voucher para cada factura (si es neto, se reparte en proporción).
    var bruto = ds.reduce(function (t, d) { return t + d.saldoVivo; }, 0);
    var montos = ds.map(function (d) { return redondear2_(bruto ? p.monto * d.saldoVivo / bruto : 0); });
    ds.forEach(function (d) { d.saldoVivo = 0; });
    out.props.push({ p: p, docs: ds, montos: montos, tipo: tipo, confianza: 0.9, razon: 'Regla: ' + ps[0], verif: '✔ cuadra' });
  });
  return out;
}

/* ======================================================= almacenamiento */

function AUD_store_(ss) {
  var sh = ss.getSheetByName(AUD_DATOS_);
  if (!sh) {
    sh = ss.insertSheet(AUD_DATOS_);
    sh.getRange(1, 1).setValue('estado');
    sh.getRange(2, 1, 1, 7).setValues([['Expediente', 'Huella', 'Auditado', 'Semáforo', 'Dictamen', 'Propuestas', 'Hallazgos IA (JSON)']]);
    sh.hideSheet();
  }
  var map = {};
  if (sh.getLastRow() >= 3) {
    sh.getRange(3, 1, sh.getLastRow() - 2, 7).getValues().forEach(function (r, i) {
      if (!r[0]) return;
      var h = [];
      try { h = JSON.parse(r[6] || '[]'); } catch (e) { h = []; }
      map[r[0]] = { fila: i + 3, huella: r[1], auditado: r[2], semaforo: r[3], dictamen: r[4], nProp: r[5], hallazgos: h };
    });
  }
  return { sh: sh, map: map };
}

function AUD_guardarRes_(store, clave, x) {
  var json = JSON.stringify(x.hallazgos || []);
  if (json.length > 45000) json = JSON.stringify((x.hallazgos || []).slice(0, 20));
  var fila = [clave, x.huella, new Date(), x.semaforo || '', x.dictamen || '', x.nProp || 0, json];
  var ant = store.map[clave];
  var n = ant ? ant.fila : Math.max(store.sh.getLastRow() + 1, 3);
  store.sh.getRange(n, 1, 1, 7).setValues([fila]);
  store.map[clave] = { fila: n, huella: x.huella, auditado: fila[2], semaforo: fila[3], dictamen: fila[4], nProp: fila[5], hallazgos: x.hallazgos || [] };
}

/** Huella del expediente: si no cambió nada desde la última auditoría, no se vuelve a pagar la IA. */
function AUD_huella_(e, pura) {
  var s = (pura ? 'IA pura|' : '') + e.docs.map(function (d) { return d.doc + ':' + d.saldo.toFixed(2); }).join(',') + '|' +
    e.sin.map(function (p) { return p.id; }).join(',') + '|' + e.apl.length;
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(b);
}

function AUD_leerEstado_(ss) {
  var sh = ss.getSheetByName(AUD_DATOS_);
  if (!sh) return null;
  try { return JSON.parse(sh.getRange(1, 2).getValue() || 'null'); } catch (e) { return null; }
}

function AUD_guardarEstado_(ss, est) {
  var sh = AUD_store_(ss).sh;
  sh.getRange(1, 2).setValue(est ? JSON.stringify(est) : '');
}

function AUD_programarContinuacion_() {
  AUD_borrarContinuacion_();
  ScriptApp.newTrigger('AUD_continuar').timeBased().after(60 * 1000).create();
}

function AUD_borrarContinuacion_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'AUD_continuar') ScriptApp.deleteTrigger(t);
  });
}

/* ========================================================= orquestación */

function AUD_ia_(ss, par) {
  var ia = CIA_ia_(CIA_hoja_(ss));
  ia.modelo = par.modelo || '';
  return ia;
}

/** Filtros tal como están en la hoja (se guardan para seguir con los mismos aunque luego cambien las celdas). */
function AUD_valoresParam_(sh) {
  return sh.getRange(3, 2, AUD_F_MOTOR_ - 2, 1).getDisplayValues().map(function (r) { return r[0]; });
}

/**
 * ▶ Auditar con IA: arma todo, aplica las reglas y empieza la cola de la IA.
 * En IA pura, si la IA todavía está leyendo e identificando vouchers, guarda lo
 * hecho y sigue sola cada minuto (fase "ident") antes de conciliar.
 */
function AUD_iniciar_(ss, valores, vueltas, contAnt) {
  var t0 = Date.now();
  var sh = AUD_hoja_(ss);
  var cfg = leerConfig_(ss);
  valores = valores || AUD_valoresParam_(sh);
  var par = AUD_leerParam_(sh, cfg, valores);
  var ia = AUD_ia_(ss, par);
  var cont = contAnt || { consultas: 0, errores: 0, ultimoError: '' };
  AUD_borrarContinuacion_();
  var a = AUD_armar_(ss, cfg, par, ia, cont, null, t0 + 200000);
  AUD_actualizarListas_(ss, sh, cfg, a.vouchers);
  if (a.identPend) {
    vueltas = (vueltas || 0) + 1;
    AUV_escribirHoja_(ss, a, cfg, par);
    if (vueltas > 25) {
      AUD_guardarEstado_(ss, null);
      return '⚠️ La IA no terminó de identificar los vouchers en 25 vueltas (quedan ' + a.identPend + '). Acote con los filtros (empresa o fechas) y vuelva a ▶.';
    }
    AUD_guardarEstado_(ss, { fase: 'ident', par: valores, vueltas: vueltas, cont: cont });
    AUD_programarContinuacion_();
    return '⏳ La IA está leyendo los vouchers (A–J): ' + a.leidos.identHechos + ' de ' + a.leidos.porIdentificar +
      ' identificados (sigue sola cada minuto; puede cerrar la hoja; vea 🔍 Vouchers leídos) · IA ' + ia.proveedor + ': ' + cont.consultas + ' consultas' +
      (cont.errores ? ' · ' + cont.errores + ' errores (' + String(cont.ultimoError).slice(0, 100) + ')' : '');
  }
  var ident = {};
  a.vouchers.forEach(function (p) { if (p._prov && /^IA |sin confirmar/.test(p._como || '')) ident[p.id] = { prov: p._prov, como: p._como }; });
  var store = AUD_store_(ss);
  // Riesgo de cada expediente: vouchers por conciliar, hallazgos graves y deuda vencida.
  var graves = {};
  (par.pura ? [] : AUD_reglas_(a, cfg)).forEach(function (h) { if (h.sev === '🔴 Alta') graves[h.clave] = (graves[h.clave] || 0) + 1; });
  var riesgo = function (k) {
    var m = AUD_metricas_(a.exp[k]);
    return m.ms + (graves[k] || 0) * 50000 + m.venc * 0.2 + (m.ns ? 1e7 : 0);
  };
  var cola = [], iguales = 0;
  Object.keys(a.exp).forEach(function (k) {
    var e = a.exp[k];
    if (!(e.sin.length || (par.completa && e.docs.length))) return;
    var ant = store.map[k];
    if (ant && ant.huella === AUD_huella_(e, par.pura) && ia.clave) { iguales++; return; }
    cola.push(k);
  });
  cola.sort(function (x, y) { return riesgo(y) - riesgo(x); });
  var pendientesDespues = Math.max(0, cola.length - AUD_MAX_IA_);
  if (ia.clave) cola = cola.slice(0, AUD_MAX_IA_);
  var est = { par: valores, cola: cola, total: cola.length,
    hechos: 0, iguales: iguales, despues: pendientesDespues, cont: cont, ident: ident, inicio: Date.now() };
  AUD_guardarEstado_(ss, est);
  return AUD_procesar_(ss, sh, cfg, par, ia, a, est, store, t0);
}

/** Continuación automática (cada minuto) mientras quede cola. */
function AUD_continuar() {
  AUD_borrarContinuacion_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var est = AUD_leerEstado_(ss);
  if (est && est.fase === 'ident') {   // IA pura: sigue leyendo/identificando vouchers
    var m;
    try { m = AUD_iniciar_(ss, est.par, est.vueltas, est.cont); } catch (e) { m = '❌ ' + e.message; }
    AUD_estado_(AUD_hoja_(ss), m);
    return;
  }
  if (!est || !est.cola || !est.cola.length) return;
  var t0 = Date.now();
  var sh = AUD_hoja_(ss);
  var cfg = leerConfig_(ss);
  var par = AUD_leerParam_(sh, cfg, est.par);  // los filtros de cuando se empezó (aunque luego se cambien las celdas)
  var ia = AUD_ia_(ss, par);
  var a = AUD_armar_(ss, cfg, par, ia, est.cont, est.ident || {}, t0 + 90000);
  try {
    var msg = AUD_procesar_(ss, sh, cfg, par, ia, a, est, AUD_store_(ss), t0);
    AUD_estado_(sh, msg);
  } catch (e) {
    AUD_estado_(sh, '❌ ' + e.message);
  }
}

function AUD_procesar_(ss, sh, cfg, par, ia, a, est, store, t0) {
  var filasCIA = [];
  while (est.cola.length && Date.now() - t0 < AUD_LIMITE_MS_) {
    var k = est.cola.shift();
    var e = a.exp[k];
    if (!e) continue;
    var out = ia.clave ? AUD_auditarExp_(e, ia, est.cont, par.pura) : AUD_sinIA_(e);
    filasCIA = filasCIA.concat(AUD_filasPropuestas_(e, out, cfg));
    var sem = out.semaforo || '';
    AUD_guardarRes_(store, k, { huella: AUD_huella_(e, par.pura), semaforo: sem, dictamen: out.dictamen, nProp: out.props.length, hallazgos: out.hallazgos });
    est.hechos++;
    if (est.hechos % 5 === 0) AUD_guardarEstado_(ss, est);
  }
  if (filasCIA.length) {
    var shC = CIA_hoja_(ss);
    CIA_asegurarModo_(shC);
    shC.getRange('B4').setValue(CIA_TIPOS_[0]);  // las propuestas del auditor son "Por pagar"
    CIA_escribir_(ss, shC, filasCIA, cfg);
  }
  var reglas = par.pura ? [] : AUD_reglas_(a, cfg);
  AUD_render_(ss, sh, a, reglas, store, cfg, par);
  var c = est.cont;
  var base = AUD_ahora_() + ' · ' + Object.keys(a.exp).length + ' expedientes · ' +
    (par.pura ? '🧠 IA pura' + AUD_textoLeidos_(a) : reglas.length + ' hallazgos por reglas');
  var iaTxt = ia.clave ? ' · IA ' + ia.proveedor + (ia.modelo ? ' ' + ia.modelo : '') + ': ' + c.consultas + ' consultas' : ' · sin clave de IA: solo reglas y pagos exactos';
  var errTxt = c.errores ? ' · ' + c.errores + ' errores de IA (' + String(c.ultimoError).slice(0, 100) + ')' : '';
  if (est.cola.length) {
    AUD_guardarEstado_(ss, est);
    AUD_programarContinuacion_();
    return '⏳ Auditando: ' + est.hechos + ' de ' + est.total + ' proveedores (sigue solo cada minuto; puede cerrar la hoja) · ' + base + iaTxt + errTxt;
  }
  AUD_guardarEstado_(ss, null);
  return '✅ Auditoría lista ' + base + ' · ' + est.hechos + ' proveedores revisados por la IA' +
    (est.iguales ? ' (' + est.iguales + ' sin cambios, se reusó la auditoría anterior)' : '') +
    (est.despues ? ' · quedan ' + est.despues + ' de menor riesgo: vuelva a ▶ Auditar para seguir' : '') + iaTxt + errTxt +
    ' · Propuestas en 🤝 Conciliar con IA.';
}

/** Filas para la tabla de propuestas de 🤝 Conciliar con IA. */
function AUD_filasPropuestas_(e, out, cfg) {
  var contra = { ruc: e.provRuc, nombre: e.prov, empresa: e.empresa, porCobrar: false };
  var filas = out.props.map(function (pr) {
    var detalle = pr.docs.map(function (d, i) { return d.doc + ': ' + pr.montos[i].toFixed(2); }).join('; ');
    var prop = { docs: pr.docs, tipo: pr.tipo, confianza: pr.confianza,
      motivo: '[Auditor IA · ' + pr.verif + '] ' + detalle + ' — ' + pr.razon };
    var f = CIA_fila_(pr.p, prop, contra, e.provRuc, pr.p._como || '', cfg);
    if (/^✖/.test(pr.verif)) f[CIA_C_['Estado']] = '⚠️ Revisar: la suma no cuadra';
    return f;
  });
  out.sinFactura.forEach(function (s) {
    filas.push(CIA_fila_(s.p, { docs: [], tipo: 'sin factura', confianza: 0, motivo: '[Auditor IA] ' + s.razon }, contra, e.provRuc, s.p._como || '', cfg));
  });
  return filas;
}

/* ============================================================ dibujar */

var AUD_SEV_ORDEN_ = { '🔴 Alta': 0, '🟠 Media': 1, '🟢 Baja': 2 };

/** Hallazgos de reglas + los de la IA guardados para estos expedientes. */
function AUD_todosHallazgos_(a, reglas, store) {
  var res = reglas.slice();
  Object.keys(a.exp).forEach(function (k) {
    var r = store.map[k], e = a.exp[k];
    if (!r || !r.hallazgos) return;
    r.hallazgos.forEach(function (h) {
      res.push({ sev: h.sev, tipo: h.tipo, empresa: e.empresa, prov: e.prov, ruc: e.provRuc, detalle: h.detalle, evidencia: h.evidencia,
        monto: h.monto, recom: h.recom, origen: 'IA', clave: k, fecha: r.auditado });
    });
  });
  return res.sort(function (x, y) {
    return (AUD_SEV_ORDEN_[x.sev] || 3) - (AUD_SEV_ORDEN_[y.sev] || 3) || String(x.empresa).localeCompare(y.empresa) ||
      String(x.prov).localeCompare(y.prov);
  });
}

function AUD_metricas_(e) {
  var m = { n: e.docs.length, total: 0, saldo: 0, venc: 0, nv: e.sin.length + e.apl.length, mv: 0, ns: e.sin.length, ms: 0 };
  e.docs.forEach(function (d) { m.total += d.total; if (d.saldo > 0.5) m.saldo += d.saldo; if (d.saldo > 0.5 && d.diasVencido > 30) m.venc += d.saldo; });
  e.sin.forEach(function (p) { m.mv += p.monto; m.ms += p.monto; });
  e.apl.forEach(function (p) { m.mv += p.monto; });
  return m;
}

/** " · 1,234 vouchers leídos de A–J (5 filas raras leídas por la IA, 3 repetidos)". */
function AUD_textoLeidos_(a) {
  var L = a.leidos;
  if (!L) return '';
  return ' · ' + L.pagos.length + ' vouchers leídos de A–J' + (L.estad.porIA || L.duplicados.length ?
    ' (' + [L.estad.porIA ? L.estad.porIA + ' filas desordenadas leídas por la IA' : '', L.duplicados.length ? L.duplicados.length + ' repetidos' : '']
      .filter(Boolean).join(', ') + ')' : '');
}

function AUD_render_(ss, sh, a, reglas, store, cfg, par) {
  var hall = AUD_todosHallazgos_(a, reglas, store);
  var cuenta = {};
  hall.forEach(function (h) {
    var c = cuenta[h.clave] = cuenta[h.clave] || [0, 0, 0];
    c[AUD_SEV_ORDEN_[h.sev] != null ? AUD_SEV_ORDEN_[h.sev] : 2]++;
  });
  var filas = Object.keys(a.exp).map(function (k) {
    var e = a.exp[k], m = AUD_metricas_(e), r = store.map[k] || {}, c = cuenta[k] || [0, 0, 0];
    var sem = r.semaforo === 'rojo' || c[0] ? '🔴' : r.semaforo === 'amarillo' || c[1] || m.ns ? '🟡' : '🟢';
    return [sem, e.empresa, e.prov, e.provRuc, m.n, redondear2_(m.total), redondear2_(m.saldo), redondear2_(m.venc), m.nv, redondear2_(m.mv),
      m.ns, redondear2_(m.ms), redondear2_(m.saldo - m.ms), r.nProp || '', c[0] + ' / ' + c[1] + ' / ' + c[2], r.dictamen || '', r.auditado || ''];
  }).sort(function (x, y) {
    var o = { '🔴': 0, '🟡': 1, '🟢': 2 };
    return o[x[0]] - o[y[0]] || y[6] + y[11] - (x[6] + x[11]);
  });
  // KPIs
  var tot = filas.reduce(function (t, f) { t.s += f[6]; t.v += f[7]; t.ns += f[10]; t.ms += f[11]; return t; }, { s: 0, v: 0, ns: 0, ms: 0 });
  var sev = [0, 0, 0];
  hall.forEach(function (h) { sev[AUD_SEV_ORDEN_[h.sev] != null ? AUD_SEV_ORDEN_[h.sev] : 2]++; });
  var fmt = function (n) { return 'S/ ' + Math.round(n).toLocaleString('en-US'); };
  sh.getRange(AUD_F_KPI_, 1, 1, 17).breakApart();
  sh.getRange(AUD_F_KPI_, 1).setValue('RESUMEN').setFontWeight('bold');
  sh.getRange(AUD_F_KPI_, 2, 1, 16).merge().setValue(filas.length + ' expedientes · saldo por pagar ' + fmt(tot.s) + ' (vencido > 30 días ' + fmt(tot.v) + ') · ' +
    tot.ns + ' vouchers por conciliar ' + fmt(tot.ms) + ' · hallazgos: 🔴 ' + sev[0] + ' · 🟠 ' + sev[1] + ' · 🟢 ' + sev[2] +
    (a.sinProv.length ? ' · ' + a.sinProv.length + ' vouchers sin proveedor reconocible' : ''))
    .setFontWeight('bold').setBackground('#EEF3F8').setWrap(true);
  // Tabla de expedientes
  if (sh.getFilter()) sh.getFilter().remove();
  var n0 = sh.getLastRow() - AUD_F_ENC_;
  if (n0 > 0) sh.getRange(AUD_F_ENC_ + 1, 1, n0, AUD_ENC_.length).clearContent().setBackground(null);
  sh.getRange(AUD_F_ENC_, 1, 1, AUD_ENC_.length).setValues([AUD_ENC_]);
  if (filas.length) {
    var f0 = AUD_F_ENC_ + 1, n = filas.length;
    sh.getRange(f0, 1, n, AUD_ENC_.length).setValues(filas).setFontSize(9).setVerticalAlignment('middle');
    sh.getRange(f0, 4, n, 1).setNumberFormat('@');
    [6, 7, 8, 10, 12, 13].forEach(function (c) { sh.getRange(f0, c, n, 1).setNumberFormat('#,##0.00;-#,##0.00;"-"'); });
    sh.getRange(f0, 17, n, 1).setNumberFormat('dd/mm HH:mm');
    sh.getRange(f0, 16, n, 1).setWrap(true);
    sh.getRange(f0, 1, n, 1).setBackgrounds(filas.map(function (f) { return [f[0] === '🔴' ? '#FEE2E2' : f[0] === '🟡' ? '#FEF9C3' : '#DCFCE7']; }));
    sh.getRange(AUD_F_ENC_, 1, n + 1, AUD_ENC_.length).createFilter();
  }
  AUD_escribirHallazgos_(ss, hall);
  if (a.leidos && par) AUV_escribirHoja_(ss, a, cfg, par);
}

function AUD_escribirHallazgos_(ss, hall) {
  var sh = ss.getSheetByName(AUD_HOJA_HALL_);
  if (!sh) {
    sh = ss.insertSheet(AUD_HOJA_HALL_);
    var base = ss.getSheetByName(AUD_HOJA_);
    if (base) { ss.setActiveSheet(sh); ss.moveActiveSheet(base.getIndex() + 1); }
  }
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.getRange(1, 1, 1, 8).merge().setValue('🔍  HALLAZGOS DE AUDITORÍA · compras y pagos').setFontSize(14).setFontWeight('bold')
    .setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
  sh.getRange(2, 1).setValue('Origen "IA" = análisis de la IA sobre el expediente · "Regla" = cálculo objetivo del sistema (solo con el motor ⚙️ IA + reglas). Filtre por severidad, tipo, empresa o proveedor.')
    .setFontSize(9).setFontColor(COLOR.TEXTO_SUAVE);
  sh.getRange(3, 1, 1, AUD_ENC_HALL_.length).setValues([AUD_ENC_HALL_]).setFontWeight('bold').setFontColor(COLOR.BLANCO)
    .setBackground(COLOR.AZUL).setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(3);
  var filas = hall.map(function (h) {
    return [h.sev, h.tipo, h.empresa, h.prov, h.ruc, h.detalle, h.evidencia, h.monto, h.recom, h.origen, h.fecha || new Date()];
  });
  if (filas.length) {
    sh.getRange(4, 1, filas.length, AUD_ENC_HALL_.length).setValues(filas).setFontSize(9).setVerticalAlignment('top').setWrap(true);
    sh.getRange(4, 5, filas.length, 1).setNumberFormat('@');
    sh.getRange(4, 8, filas.length, 1).setNumberFormat('#,##0.00;-#,##0.00;""');
    sh.getRange(4, 11, filas.length, 1).setNumberFormat('dd/mm HH:mm');
    sh.getRange(4, 1, filas.length, 1).setBackgrounds(filas.map(function (f) {
      return [f[0] === '🔴 Alta' ? '#FEE2E2' : f[0] === '🟠 Media' ? '#FFEDD5' : '#DCFCE7'];
    }));
  }
  sh.getRange(3, 1, Math.max(filas.length, 1) + 1, AUD_ENC_HALL_.length).createFilter();
  [85, 190, 110, 200, 95, 380, 300, 90, 320, 60, 85].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
}
