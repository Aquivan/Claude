/**
 * 📅 Vencimientos SUNAT (IGV-Renta y PLAME, SIRE) con avisos por Telegram.
 *
 * - Cronograma oficial de obligaciones mensuales (último dígito del RUC; Buenos Contribuyentes
 *   con su propia columna) en la pestaña "📅 Vencimientos" de esta hoja. Se intenta bajar solo
 *   de sunat.gob.pe; si no se puede, queda la tabla sembrada y se puede corregir a mano.
 * - Todo se personaliza en esa pestaña o desde el chat: qué días antes avisar (por obligación),
 *   a qué hora, qué empresas y qué obligaciones.
 * - Lo ya presentado se anota en "📅 Presentaciones": el SIRE se marca solo cuando llega al
 *   Buzón SUNAT el mensaje "Generación de Registro RVIE Y RCE del período AAAAMM"; el IGV-Renta
 *   (y PLAME, misma fecha) se marca con el botón "✅ Ya presenté" o en la hoja.
 * - Un aviso se repite (según los días elegidos) y, si vence sin marcarse, cada día hasta 5 días después.
 */

var TGV_HOJA_ = '📅 Vencimientos';
var TGV_HOJA_PRES_ = '📅 Presentaciones';
var TGV_GRUPOS_ = ['0', '1', '2-3', '4-5', '6-7', '8-9', 'BC'];
var TGV_OBLIG_ = {
  igv: { nombre: 'IGV-Renta y PLAME (PDT 621 / 601)', corto: 'IGV-Renta/PLAME' },
  sire: { nombre: 'SIRE: registros de ventas y compras (RVIE/RCE)', corto: 'SIRE' },
};
var TGV_PARAM_ = [
  ['Avisar IGV-Renta/PLAME (días antes)', '5, 2, 0', 'Días antes del vencimiento en que llega el aviso (0 = el mismo día). Ej.: 7, 3, 1, 0'],
  ['Avisar SIRE (días antes)', '5, 2, 0', 'Igual, para el SIRE (RVIE/RCE).'],
  ['Hora del aviso (0-23)', '8', 'Hora de Lima en que se manda el aviso del día.'],
  ['Avisar después de vencido (días)', '5', 'Si vence sin marcarse como presentado, se avisa cada día durante estos días.'],
  ['Empresas (vacío = todas)', '', 'RUCs o nombres separados por comas, si solo quiere algunas.'],
  ['Forzar Buen Contribuyente (RUC)', '', 'Normalmente se detecta solo con el padrón SUNAT; aquí puede forzar RUCs.'],
];
var TGV_FILA_CRONO_ = TGV_PARAM_.length + 6;   // fila del encabezado del cronograma

// Cronograma 2026 (periodo → vencimiento por último dígito; BC = Buenos Contribuyentes/UESP).
// Fuente: cronograma SUNAT de obligaciones mensuales 2026 (verificar en sunat.gob.pe).
var TGV_SEMILLA_ = {
  2026: [
    ['202601', '16/02/2026', '17/02/2026', '18/02/2026', '19/02/2026', '20/02/2026', '23/02/2026', '24/02/2026'],
    ['202602', '16/03/2026', '17/03/2026', '18/03/2026', '19/03/2026', '20/03/2026', '23/03/2026', '24/03/2026'],
    ['202603', '17/04/2026', '20/04/2026', '21/04/2026', '22/04/2026', '23/04/2026', '24/04/2026', '27/04/2026'],
    ['202604', '18/05/2026', '19/05/2026', '20/05/2026', '21/05/2026', '22/05/2026', '25/05/2026', '26/05/2026'],
    ['202605', '15/06/2026', '16/06/2026', '17/06/2026', '18/06/2026', '19/06/2026', '22/06/2026', '23/06/2026'],
    ['202606', '15/07/2026', '16/07/2026', '17/07/2026', '20/07/2026', '21/07/2026', '22/07/2026', '24/07/2026'],
    ['202607', '18/08/2026', '19/08/2026', '20/08/2026', '21/08/2026', '24/08/2026', '25/08/2026', '26/08/2026'],
    ['202608', '15/09/2026', '16/09/2026', '17/09/2026', '18/09/2026', '21/09/2026', '22/09/2026', '23/09/2026'],
    ['202609', '16/10/2026', '19/10/2026', '20/10/2026', '21/10/2026', '22/10/2026', '23/10/2026', '26/10/2026'],
    ['202610', '16/11/2026', '17/11/2026', '18/11/2026', '19/11/2026', '20/11/2026', '23/11/2026', '24/11/2026'],
    ['202611', '17/12/2026', '18/12/2026', '21/12/2026', '22/12/2026', '23/12/2026', '24/12/2026', '28/12/2026'],
    ['202612', '18/01/2027', '19/01/2027', '20/01/2027', '21/01/2027', '22/01/2027', '25/01/2027', '26/01/2027'],
  ],
};

/* ============================================================ hoja */

function TGV_hoja_(ss) {
  var sh = ss.getSheetByName(TGV_HOJA_);
  if (sh) return sh;
  sh = ss.insertSheet(TGV_HOJA_);
  sh.getRange(1, 1).setValue('📅 Vencimientos SUNAT · avisos por Telegram').setFontWeight('bold').setFontSize(13);
  sh.getRange(2, 1).setValue('Cambie los valores de la columna B. El bot lee esta pestaña cada vez que avisa.').setFontColor('#666');
  sh.getRange(3, 1, 1, 3).setValues([['Parámetro', 'Valor', 'Qué hace']]).setFontWeight('bold').setBackground('#e8eaf6');
  sh.getRange(4, 1, TGV_PARAM_.length, 3).setValues(TGV_PARAM_);
  sh.getRange(4, 2, TGV_PARAM_.length, 1).setNumberFormat('@').setBackground('#fff8e1');
  sh.getRange(TGV_FILA_CRONO_ - 1, 1).setValue('Cronograma SUNAT de obligaciones mensuales (vence según el último dígito del RUC)').setFontWeight('bold');
  sh.getRange(TGV_FILA_CRONO_, 1, 1, 9).setValues([['Periodo', 'Dígito 0', 'Dígito 1', 'Dígitos 2-3', 'Dígitos 4-5', 'Dígitos 6-7', 'Dígitos 8-9', 'Buenos Contrib./UESP', 'Fuente']])
    .setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
  sh.setFrozenRows(3);
  sh.setColumnWidth(1, 270); sh.setColumnWidth(2, 120); sh.setColumnWidth(3, 420);
  TGV_ponerCronograma_(sh, TGV_SEMILLA_[2026], 'Semilla 2026 (verifique en sunat.gob.pe)');
  return sh;
}

function TGV_hojaPres_(ss) {
  var sh = ss.getSheetByName(TGV_HOJA_PRES_);
  if (sh) return sh;
  sh = ss.insertSheet(TGV_HOJA_PRES_);
  sh.getRange(1, 1, 1, 7).setValues([['Periodo', 'RUC', 'Empresa', 'Obligación', 'Estado', 'Cómo', 'Fecha']]).setFontWeight('bold').setBackground('#e8eaf6');
  sh.getRange('A:B').setNumberFormat('@');
  sh.setFrozenRows(1);
  return sh;
}

/** Agrega o reemplaza filas del cronograma (por periodo). filas: [[periodo, d0, d1, d23, d45, d67, d89, bc], …] */
function TGV_ponerCronograma_(sh, filas, fuente) {
  var actual = TGV_leerCronograma_(sh);
  filas.forEach(function (f) { actual[String(f[0])] = { fechas: f.slice(1, 8), fuente: fuente }; });
  var pers = Object.keys(actual).sort();
  var desde = TGV_FILA_CRONO_ + 1;
  if (sh.getLastRow() >= desde) sh.getRange(desde, 1, sh.getLastRow() - desde + 1, 9).clearContent();
  if (!pers.length) return;
  sh.getRange(desde, 1, pers.length, 9).setNumberFormat('@');   // texto: que la hoja no lea 05/03 como 3 de mayo
  sh.getRange(desde, 1, pers.length, 9).setValues(pers.map(function (p) {
    return [p].concat(actual[p].fechas.map(function (d) { return d instanceof Date ? Utilities.formatDate(d, 'America/Lima', 'dd/MM/yyyy') : String(d); })).concat([actual[p].fuente || '']);
  }));
}

function TGV_leerCronograma_(sh) {
  var mapa = {}, desde = TGV_FILA_CRONO_ + 1;
  if (sh.getLastRow() < desde) return mapa;
  sh.getRange(desde, 1, sh.getLastRow() - desde + 1, 9).getValues().forEach(function (r) {
    var p = String(r[0]).replace(/\D/g, '');
    if (/^\d{6}$/.test(p)) mapa[p] = { fechas: r.slice(1, 8), fuente: r[8] };
  });
  return mapa;
}

function TGV_param_(ss) {
  var sh = TGV_hoja_(ss);
  var v = sh.getRange(4, 1, TGV_PARAM_.length, 2).getDisplayValues();
  var m = {};
  v.forEach(function (r) { m[r[0]] = String(r[1] || '').trim(); });
  var dias = function (s, def) {
    var l = String(s == null || s === '' ? def : s).split(/[,;\s]+/).map(Number).filter(function (n) { return !isNaN(n) && n >= 0 && n <= 60; });
    return l.length ? l : [5, 2, 0];
  };
  var p = TGV_PARAM_;
  return {
    dias: { igv: dias(m[p[0][0]], p[0][1]), sire: dias(m[p[1][0]], p[1][1]) },
    hora: Math.max(0, Math.min(23, parseInt(m[p[2][0]] || '8', 10) || 0)),
    despues: Math.max(0, parseInt(m[p[3][0]] || '5', 10) || 0),
    empresas: (m[p[4][0]] || '').split(/[,;]+/).map(function (s) { return s.trim(); }).filter(String),
    forzarBC: (m[p[5][0]] || '').split(/[,;\s]+/).map(function (s) { return s.replace(/\D/g, ''); }).filter(String),
  };
}

/** Cambia un parámetro desde el chat (nombre del parámetro → valor). */
function TGV_cambiarParam_(ss, nombre, valor) {
  var sh = TGV_hoja_(ss);
  var i = TGV_PARAM_.map(function (p) { return p[0]; }).indexOf(nombre);
  if (i < 0) throw new Error('parámetro desconocido');
  sh.getRange(4 + i, 2).setValue(valor);
}

/* ============================================================ cronograma oficial (sunat.gob.pe) */

var TGV_MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

/** Intenta bajar el cronograma del año de sunat.gob.pe. Devuelve cuántos periodos leyó (0 si no pudo). */
function TGV_bajarCronograma_(ss, anio) {
  var url = 'https://www.sunat.gob.pe/orientacion/cronogramas/' + anio + '/cObligacionMensual' + anio + '.html';
  var r;
  try { r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }); } catch (e) { return 0; }
  if (r.getResponseCode() !== 200) return 0;
  var filas = TGV_leerHtmlCronograma_(r.getContentText('ISO-8859-1'), anio);
  if (filas.length < 10) return 0;
  TGV_ponerCronograma_(TGV_hoja_(ss), filas, 'sunat.gob.pe ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy'));
  return filas.length;
}

/** Lee la tabla del cronograma: una fila por mes ("Enero"…) con 7 días (0, 1, 2-3, 4-5, 6-7, 8-9, BC). */
function TGV_leerHtmlCronograma_(html, anio) {
  var out = [];
  String(html).split(/<tr[\s>]/i).forEach(function (tr) {
    var celdas = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(function (c) {
      return c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    });
    if (celdas.length < 8) return;
    var mes = TGV_MESES_.indexOf(celdas[0].replace(/septiembre/, 'setiembre').replace(/[^a-zñ]/g, ''));
    if (mes < 0) return;
    var dias = celdas.slice(1).map(function (c) { var m = c.match(/\b([0-3]?\d)\b/); return m ? Number(m[1]) : null; })
      .filter(function (d) { return d && d <= 31; });
    if (dias.length < 7) return;
    var vMes = mes + 1, vAnio = anio;          // vence el mes siguiente al periodo
    if (vMes === 12) { vMes = 0; vAnio = anio + 1; }
    var periodo = anio + ('0' + (mes + 1)).slice(-2);
    out.push([periodo].concat(dias.slice(0, 7).map(function (d) { return ('0' + d).slice(-2) + '/' + ('0' + (vMes + 1)).slice(-2) + '/' + vAnio; })));
  });
  return out;
}

/* ============================================================ cálculo */

function TGV_aFecha_(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

function TGV_hoyLima_() {
  var s = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd').split('-');
  return new Date(Number(s[0]), Number(s[1]) - 1, Number(s[2]));
}

function TGV_dias_(desde, hasta) {
  return Math.round((Date.UTC(hasta.getFullYear(), hasta.getMonth(), hasta.getDate()) - Date.UTC(desde.getFullYear(), desde.getMonth(), desde.getDate())) / 86400000);
}

function TGV_periodoMenos_(hoy, n) {
  var d = new Date(hoy.getFullYear(), hoy.getMonth() - n, 1);
  return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2);
}

function TGV_columna_(ruc, esBC) {
  if (esBC) return 6;
  var d = Number(String(ruc).slice(-1));
  return d === 0 ? 0 : d === 1 ? 1 : d <= 3 ? 2 : d <= 5 ? 3 : d <= 7 ? 4 : 5;
}

function TGV_empresas_(ss, prm) {
  var cob = leerConfig_(ss);
  var lista = cob.grupo.map(function (ruc) { return { ruc: ruc, nombre: cob.nombreEmpresa[ruc] || ruc }; });
  if (prm.empresas.length) {
    var quiero = prm.empresas.map(normHeader_);
    lista = lista.filter(function (e) { return quiero.indexOf(normHeader_(e.ruc)) >= 0 || quiero.indexOf(normHeader_(e.nombre)) >= 0; });
  }
  var q = {};
  lista.forEach(function (e) { q[e.ruc] = true; });
  var pad = {};
  try { pad = PAD_leer_(ss, q).mapa; } catch (e) {}
  lista.forEach(function (e) { e.bc = prm.forzarBC.indexOf(e.ruc) >= 0 || !!(pad[e.ruc] && pad[e.ruc].bc); });
  return lista;
}

/** Presentaciones anotadas: {"ruc|periodo|ob": {estado, como, fecha}} */
function TGV_presentaciones_(ss) {
  var sh = TGV_hojaPres_(ss), m = {};
  if (sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(function (r) {
    var k = String(r[1]).replace(/\D/g, '') + '|' + String(r[0]).replace(/\D/g, '') + '|' + String(r[3]).toLowerCase();
    if (/presentad|✅|si/i.test(String(r[4]))) m[k] = { estado: r[4], como: r[5], fecha: r[6] };
  });
  return m;
}

function TGV_marcar_(ss, ruc, periodo, ob, como) {
  var pres = TGV_presentaciones_(ss);
  if (pres[ruc + '|' + periodo + '|' + ob]) return false;
  var nombre = leerConfig_(ss).nombreEmpresa[ruc] || ruc;
  TGV_hojaPres_(ss).appendRow([periodo, ruc, nombre, ob, '✅ Presentado', como, new Date()]);
  return true;
}

/** SIRE presentado: el Buzón SUNAT trae "Generación de Registro RVIE Y RCE del período AAAAMM". */
function TGV_detectarSire_(ss, c) {
  var t;
  try { t = TG_tablaLibro_(c, 'notificaciones', 'Mensajes'); } catch (e) { return 0; }
  if (!t || !t.columnas) return 0;
  var jA = TG_col_(t.columnas, 'Asunto'), jR = TG_col_(t.columnas, 'RUC empresa');
  if (jA < 0 || jR < 0) return 0;
  var n = 0, pres = TGV_presentaciones_(ss);
  t.filas.forEach(function (f) {
    var m = String(f[jA]).match(/Generaci.n de Registro RVIE Y RCE del per.odo (\d{6})/i);
    if (!m) return;
    var ruc = String(f[jR]).replace(/\D/g, '');
    if (pres[ruc + '|' + m[1] + '|sire']) return;
    if (TGV_marcar_(ss, ruc, m[1], 'sire', 'Buzón SUNAT (automático)')) { n++; pres[ruc + '|' + m[1] + '|sire'] = true; }
  });
  return n;
}

/**
 * Lista de obligaciones de los periodos recientes con su vencimiento y estado.
 * [{ruc, nombre, periodo, ob, vence: Date, faltan, presentado, sinCronograma}]
 */
function TGV_lista_(ss, c) {
  var prm = TGV_param_(ss);
  var crono = TGV_leerCronograma_(TGV_hoja_(ss));
  var hoy = TGV_hoyLima_();
  if (c) TGV_detectarSire_(ss, c);
  var pres = TGV_presentaciones_(ss);
  var out = [];
  var periodos = [TGV_periodoMenos_(hoy, 2), TGV_periodoMenos_(hoy, 1), TGV_periodoMenos_(hoy, 0)];
  TGV_empresas_(ss, prm).forEach(function (e) {
    periodos.forEach(function (per) {
      Object.keys(TGV_OBLIG_).forEach(function (ob) {
        var fila = crono[per];
        var vence = fila ? TGV_aFecha_(fila.fechas[TGV_columna_(e.ruc, e.bc)]) : null;
        if (!vence) { if (per === TGV_periodoMenos_(hoy, 1)) out.push({ ruc: e.ruc, nombre: e.nombre, periodo: per, ob: ob, sinCronograma: true }); return; }
        var faltan = TGV_dias_(hoy, vence);
        if (faltan > 40 || faltan < -Math.max(prm.despues, 10)) return;
        out.push({ ruc: e.ruc, nombre: e.nombre, bc: e.bc, periodo: per, ob: ob, vence: vence, faltan: faltan, presentado: !!pres[e.ruc + '|' + per + '|' + ob] });
      });
    });
  });
  return out.sort(function (a, b) { return (a.vence || 0) - (b.vence || 0) || a.nombre.localeCompare(b.nombre); });
}

function TGV_cuando_(x) {
  if (x.faltan === 0) return '<b>vence HOY</b>';
  if (x.faltan === 1) return 'vence <b>mañana</b>';
  if (x.faltan < 0) return '⚠️ <b>venció hace ' + (-x.faltan) + ' día(s)</b>';
  return 'vence en <b>' + x.faltan + ' días</b>';
}

function TGV_linea_(x) {
  var per = x.periodo.slice(4) + '/' + x.periodo.slice(0, 4);
  return (x.presentado ? '✅ ' : x.faltan < 0 ? '🔴 ' : x.faltan <= 2 ? '🟠 ' : '🟡 ') + '<b>' + TG_esc_(x.nombre) + '</b> · ' + TGV_OBLIG_[x.ob].corto + ' ' + per +
    ' · ' + Utilities.formatDate(x.vence, 'America/Lima', 'dd/MM') + (x.presentado ? ' · presentado' : ' · ' + TGV_cuando_(x)) + (x.bc ? ' <i>(Buen Contrib.)</i>' : '');
}

/* ============================================================ avisos (desde TG_vigia) */

/** Una vez al día, a la hora elegida: avisa lo que corresponde según los días configurados. */
function TGV_avisar_(ss, destinos) {
  var prm = TGV_param_(ss);
  var props = PropertiesService.getScriptProperties();
  var hoyTxt = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd');
  var hora = Number(Utilities.formatDate(new Date(), 'America/Lima', 'H'));
  if (props.getProperty('TGV_DIA') === hoyTxt || hora < prm.hora || hora > prm.hora + 3) return;
  props.setProperty('TGV_DIA', hoyTxt);
  TGV_cronogramaAlDia_(ss);
  var lista = TGV_lista_(ss, TG_ctxDatos_(ss));
  var hoy = lista.filter(function (x) {
    if (x.sinCronograma || x.presentado) return false;
    return x.faltan >= 0 ? prm.dias[x.ob].indexOf(x.faltan) >= 0 : -x.faltan <= prm.despues;
  });
  var faltaCrono = lista.filter(function (x) { return x.sinCronograma; });
  if (!hoy.length && !faltaCrono.length) return;
  var html = '📅 <b>Vencimientos SUNAT</b>\n' + hoy.map(TGV_linea_).join('\n') +
    (faltaCrono.length ? '\n\n⚠️ Falta el cronograma del periodo ' + faltaCrono[0].periodo + ' en la pestaña ' + TGV_HOJA_ + ' (no se pudo bajar de SUNAT).' : '');
  var teclado = TGV_botones_(hoy);
  destinos.forEach(function (u) { TG_enviar_(u.chatId, html, teclado); });
}

function TGV_botones_(items) {
  var t = items.filter(function (x) { return !x.presentado && !x.sinCronograma && x.ob === 'igv'; }).slice(0, 8).map(function (x) {
    return [{ text: '✅ Ya presenté ' + x.nombre.slice(0, 18) + ' ' + x.periodo.slice(4) + '/' + x.periodo.slice(2, 4),
      callback_data: 'k:' + TG_guardarBoton_({ t: 'venc', ruc: x.ruc, periodo: x.periodo, ob: x.ob }) }];
  });
  t.push([{ text: '📅 Ver todos', callback_data: 'c:vencimientos' }, { text: '⚙️ Cambiar avisos', callback_data: 'c:vencimientos ajustes' }]);
  return t;
}

/** Si falta el cronograma del periodo actual o el siguiente, lo intenta bajar de SUNAT (una vez por semana). */
function TGV_cronogramaAlDia_(ss) {
  var crono = TGV_leerCronograma_(TGV_hoja_(ss));
  var hoy = TGV_hoyLima_();
  var necesito = [TGV_periodoMenos_(hoy, 1), TGV_periodoMenos_(hoy, 0)];
  if (necesito.every(function (p) { return crono[p]; })) return;
  var props = PropertiesService.getScriptProperties();
  var semana = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyww');
  if (props.getProperty('TGV_BAJADO') === semana) return;
  props.setProperty('TGV_BAJADO', semana);
  necesito.filter(function (p) { return !crono[p]; }).map(function (p) { return Number(p.slice(0, 4)); })
    .filter(function (a, i, l) { return l.indexOf(a) === i; })
    .forEach(function (anio) { if (TGV_SEMILLA_[anio]) TGV_ponerCronograma_(TGV_hoja_(ss), TGV_SEMILLA_[anio], 'Semilla ' + anio); TGV_bajarCronograma_(ss, anio); });
}

/* ============================================================ comando /vencimientos y botones */

function TGV_comando_(ctx, arg) {
  var ss = ctx.ss, a = String(arg || '').trim().toLowerCase();
  if (/^ajustes?|^config/.test(a)) return TGV_enviarAjustes_(ctx);
  var m = a.match(/^(dias|días|aviso|avisos)\s+(igv|sire|todo|todos)?\s*([\d,\s]+)$/);
  if (m) {
    var dias = m[3].split(/[,\s]+/).filter(String).join(', ');
    if (m[2] !== 'sire') TGV_cambiarParam_(ss, TGV_PARAM_[0][0], dias);
    if (m[2] !== 'igv') TGV_cambiarParam_(ss, TGV_PARAM_[1][0], dias);
    return TG_enviar_(ctx.chatId, '✅ Avisos ' + (m[2] === 'igv' ? 'de IGV-Renta/PLAME' : m[2] === 'sire' ? 'del SIRE' : 'de IGV y SIRE') + ': <b>' + dias + '</b> días antes.');
  }
  m = a.match(/^hora\s+(\d{1,2})$/);
  if (m) { TGV_cambiarParam_(ss, TGV_PARAM_[2][0], m[1]); return TG_enviar_(ctx.chatId, '✅ El aviso de vencimientos llegará a las <b>' + m[1] + ':00</b>.'); }
  m = a.match(/^(?:despues|después|vencido)\s+(\d{1,2})$/);
  if (m) { TGV_cambiarParam_(ss, TGV_PARAM_[3][0], m[1]); return TG_enviar_(ctx.chatId, '✅ Si vence sin presentar, aviso cada día durante <b>' + m[1] + '</b> días.'); }
  TG_accion_(ctx.chatId, 'typing');
  var lista = TGV_lista_(ss, TG_ctxDatos_(ss)).filter(function (x) { return !x.sinCronograma; });
  var pend = lista.filter(function (x) { return !x.presentado && x.faltan >= -15; });
  var hechos = lista.filter(function (x) { return x.presentado && x.faltan >= -15; });
  var html = '📅 <b>Vencimientos SUNAT</b> (IGV-Renta/PLAME y SIRE)\n\n' +
    (pend.length ? '<b>Pendientes</b>\n' + pend.map(TGV_linea_).join('\n') : '✅ No hay nada pendiente.') +
    (hechos.length ? '\n\n<b>Ya presentado</b>\n' + hechos.slice(-10).map(TGV_linea_).join('\n') : '') +
    '\n\n<i>El SIRE se marca solo con el mensaje del Buzón SUNAT; el IGV con el botón ✅. Ajustes: /vencimientos ajustes</i>';
  TG_enviar_(ctx.chatId, html, TGV_botones_(pend));
}

function TGV_enviarAjustes_(ctx) {
  var p = TGV_param_(ctx.ss);
  TG_enviar_(ctx.chatId, '⚙️ <b>Avisos de vencimientos</b>\n' +
    '• IGV-Renta/PLAME: <b>' + p.dias.igv.join(', ') + '</b> días antes\n' +
    '• SIRE: <b>' + p.dias.sire.join(', ') + '</b> días antes\n' +
    '• Hora: <b>' + p.hora + ':00</b> · después de vencido: <b>' + p.despues + '</b> días\n' +
    '• Empresas: <b>' + (p.empresas.length ? TG_esc_(p.empresas.join(', ')) : 'todas') + '</b>\n\n' +
    'Para cambiar, escriba por ejemplo:\n<code>/vencimientos dias 7,3,1,0</code> (los dos)\n<code>/vencimientos dias igv 5,2,0</code>\n<code>/vencimientos dias sire 3,0</code>\n' +
    '<code>/vencimientos hora 9</code>\n<code>/vencimientos vencido 3</code>\n\nO edite la pestaña <b>' + TGV_HOJA_ + '</b> de la hoja (también el cronograma).');
}

/** Botón "✅ Ya presenté". */
function TGV_alBoton_(ctx, datos) {
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  var nuevo = TGV_marcar_(ctx.ss, datos.ruc, datos.periodo, datos.ob, 'Telegram · ' + (ctx.nombre || ctx.chatId));
  var nombre = leerConfig_(ctx.ss).nombreEmpresa[datos.ruc] || datos.ruc;
  TG_enviar_(ctx.chatId, (nuevo ? '✅ Anotado: ' : 'Ya estaba anotado: ') + '<b>' + TG_esc_(nombre) + '</b> · ' + TGV_OBLIG_[datos.ob].corto + ' ' +
    datos.periodo.slice(4) + '/' + datos.periodo.slice(0, 4) + ' presentado. No vuelvo a avisarlo.', [[{ text: '📅 Ver vencimientos', callback_data: 'c:vencimientos' }]]);
}

/** Línea para el ☀️ resumen de la mañana. */
function TGV_textoResumen_(ss) {
  var lista = TGV_lista_(ss, null).filter(function (x) { return !x.sinCronograma && !x.presentado && x.faltan <= 7 && x.faltan >= -15; });
  if (!lista.length) return '';
  return '📅 <b>Vencimientos SUNAT próximos</b>\n' + lista.slice(0, 8).map(TGV_linea_).join('\n') + (lista.length > 8 ? '\n… y ' + (lista.length - 8) + ' más (/vencimientos)' : '');
}

/** La primera vez, el aviso 📅 queda activado para todos (luego cada uno lo apaga en /avisos). */
function TGV_activarParaTodos_(ss, usuarios) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('TGV_ACTIVADO')) return;
  usuarios.forEach(function (u) { if (u.avisos.indexOf('oblig') < 0) { u.avisos.push('oblig'); TG_guardarAvisos_(ss, u, u.avisos); } });
  props.setProperty('TGV_ACTIVADO', '1');
}

/** Menú 💼 Cobranzas → 🤖 Telegram → 📅 Vencimientos SUNAT: abre la pestaña (la crea si no existe). */
function TGV_menuAbrir() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = TGV_hoja_(ss);
  TGV_hojaPres_(ss);
  ss.setActiveSheet(sh);
  ss.toast('Cambie los valores de la columna B (días antes, hora, empresas). El cronograma está más abajo.', '📅 Vencimientos', 8);
}
