/**
 * 🤖 Telegram — 🔔 avisos automáticos (disparador TG_vigia, cada hora).
 *
 * Revisa lo NUEVO desde la vuelta anterior y avisa a cada persona según lo que
 * eligió en /avisos: notificaciones y mensajes del Buzón SUNAT, detracciones,
 * retenciones, recibos por honorarios, vouchers registrados, proveedores que SUNAT
 * publicó como Sujetos Sin Capacidad Operativa y descargas
 * automáticas que fallaron. A la hora del resumen manda el ☀️ resumen y las
 * facturas por vencer. Lo ya avisado se anota en la pestaña oculta _TG_Vistos
 * (la primera vez solo anota, para no mandar todo lo antiguo).
 * De 23:00 a 6:00 solo avisa errores.
 */

function TG_vigia() {
  var ss = TG_ss_();
  var cfg = TG_cfg_(ss);
  // 🏷 Vouchers que quedaron esperando "¿de quién son?": pasados 20 min se registran sin nombre.
  try { if (TG_token_()) TGE_vencidosTG_(ss); } catch (e) { console.warn('Vouchers sin nombre: ' + e.message); }
  // 🌙 Descargas de madrugada puntuales y ☀️ reloj del resumen a la hora exacta (TG_Noche.js).
  try { TGN_revisar_(cfg); } catch (e) { console.warn('Descargas de madrugada: ' + e.message); }
  try { TGN_relojResumen_(cfg); } catch (e) { console.warn('Reloj del resumen: ' + e.message); }
  if (!cfg.avisosActivos || !TG_token_()) return;
  var us = TG_usuarios_(ss).filter(function (u) { return u.activo; });
  if (!us.length) return;
  var para = function (codigo) { return us.filter(function (u) { return u.avisos.indexOf(codigo) >= 0; }); };
  var hora = Number(Utilities.formatDate(new Date(), 'America/Lima', 'H'));
  var noche = hora >= 23 || hora < 6;
  var c = TG_ctxDatos_(ss);
  var V = TG_vistos_(ss);
  var tareas = [
    ['err', TG_avisoErrores_],
    ['notif', TG_avisoNotificaciones_], ['notif', TG_avisoMensajes_], ['det', TG_avisoDetracciones_],
    ['ret', TG_avisoRetenciones_], ['hon', TG_avisoHonorarios_], ['vou', TG_avisoVouchers_], ['notif', TG_avisoSsco_],
  ];
  tareas.forEach(function (t) {
    if (noche && t[0] !== 'err') return;
    var destinos = para(t[0]);
    try {
      var msgs = t[1](c, V, cfg) || [];
      if (!destinos.length) return;   // igual se anotó como visto
      msgs.forEach(function (m) { destinos.forEach(function (u) { TG_enviar_(u.chatId, m.html, m.teclado || null); }); });
    } catch (e) { console.warn('Aviso ' + t[0] + ': ' + e.message); }
  });
  TG_guardarVistos_(ss, V);

  // 📅 Vencimientos SUNAT (IGV-Renta/PLAME, SIRE): a la hora elegida en la pestaña 📅 Vencimientos.
  // (tiene su propia hora, por eso no se salta de noche)
  try { TGV_activarParaTodos_(ss, us); TGV_avisar_(ss, para('oblig')); } catch (e) { console.warn('Vencimientos SUNAT: ' + e.message); }

  // ☀️ Resumen de la mañana y ⏰ vencimientos (respaldo del reloj TG_resumenManana: si a esa hora no salió, sale con el vigía dentro de las 3 horas siguientes)
  if (cfg.horaResumen >= 0 && hora >= cfg.horaResumen && hora < cfg.horaResumen + 3) TG_mandarResumenDia_(ss, us);
}

/** ☀️ Resumen de la mañana y ⏰ vencimientos: una sola vez al día (lo llama el reloj de la hora o el vigía). */
function TG_mandarResumenDia_(ss, us) {
  var props = PropertiesService.getScriptProperties();
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd');
  if (props.getProperty('TG_RESUMEN_DIA') === hoy) return;
  var para = function (codigo) { return us.filter(function (u) { return u.avisos.indexOf(codigo) >= 0; }); };
  props.setProperty('TG_RESUMEN_DIA', hoy);
  try {
    var r = para('resumen');
    if (r.length) {
      var html = '☀️ <b>Buenos días.</b>\n\n' + TG_textoResumen_(ss);
      r.forEach(function (u) { TG_enviar_(u.chatId, html, [[{ text: '⏰ Vencidas', callback_data: 'c:vencidas' }, { text: '📬 Buzón SUNAT', callback_data: 'c:notificaciones' }, { text: '📋 Menú', callback_data: 'c:menu' }]]); });
    }
  } catch (e) { console.warn('Resumen diario: ' + e.message); }
  try {
    para('venc').forEach(function (u) {
      if (u.avisos.indexOf('resumen') >= 0) return;   // ya va dentro del resumen
      TG_enviarVencidas_({ ss: ss, chatId: u.chatId, usuario: u }, '');
    });
  } catch (e) { console.warn('Vencimientos: ' + e.message); }
}


/* ============================================================ lo ya avisado */

function TG_vistos_(ss) {
  var sh = ss.getSheetByName(TG_HOJA_VISTOS_);
  if (!sh) { sh = ss.insertSheet(TG_HOJA_VISTOS_); sh.getRange(1, 1, 1, 3).setValues([['Fuente', 'Clave', 'Visto']]); sh.getRange('A:B').setNumberFormat('@'); sh.hideSheet(); }
  var mapa = {};
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { (mapa[r[0]] = mapa[r[0]] || {})[String(r[1])] = true; });
  return { sh: sh, mapa: mapa, nuevos: [] };
}

function TG_guardarVistos_(ss, V) {
  if (!V.nuevos.length) return;
  V.sh.getRange(V.sh.getLastRow() + 1, 1, V.nuevos.length, 3).setValues(V.nuevos);
}

/** Devuelve los items nuevos de una fuente (y los anota). La primera vez solo anota. */
function TG_nuevos_(V, fuente, items, clave) {
  var primera = !V.mapa[fuente];
  var m = V.mapa[fuente] = V.mapa[fuente] || {};
  var ahora = new Date();
  var res = [];
  if (primera) V.nuevos.push([fuente, '__inicio', ahora]);   // aunque hoy no haya nada: lo que llegue después ya es nuevo
  items.forEach(function (it) {
    var k = String(clave(it));
    if (!k || m[k]) return;
    m[k] = true;
    V.nuevos.push([fuente, k, ahora]);
    if (!primera) res.push(it);
  });
  return res;
}

/* ============================================================ cada fuente */

function TG_avisoNotificaciones_(c, V) {
  var t = TG_tablaLibro_(c, 'notificaciones', 'Notificaciones');
  var I = function (n) { return TG_col_(t.columnas, n); };
  var jE = I('Empresa'), jR = I('RUC empresa'), jF = I('Fecha publicación'), jS = I('Surte efecto'), jT = I('Tipo de documento'), jN = I('N° documento'), jA = I('Asunto'), jC = I('Código'), jP = I('PDF');
  var claveN = function (f) { return String(jC >= 0 && f[jC] ? f[jC] : [f[jR], f[jN], f[jF]].join('|')); };
  // 🆕 del /notificaciones: lo que trajo cada descarga, aunque nadie abra el buzón entre una y otra
  try { TG_notFoto_(t.filas.slice().sort(function (a, b) { return (aFecha_(b[jF]) || 0) - (aFecha_(a[jF]) || 0); }).map(claveN)); } catch (e) { console.warn('Foto del buzón: ' + e.message); }
  var nuevas = TG_nuevos_(V, 'notif', t.filas, claveN);
  if (!nuevas.length) return [];
  var botones = [], fila = [];
  var lineas = nuevas.slice(0, 10).map(function (f, i) {
    var pdf = jP >= 0 ? TG_idDrive_(String(f[jP]).split(' ')[0]) : '';
    if (pdf) { fila.push({ text: '📄 ' + (i + 1), callback_data: 'f:' + pdf }); if (fila.length === 5) { botones.push(fila); fila = []; } }
    return (i + 1) + '. <b>' + TG_esc_(f[jE]) + '</b> · ' + TG_esc_(TG_asunto_(f[jA], f[jT], f[jN])) + (f[jN] && String(f[jA]).indexOf(String(f[jN])) === -1 ? ' <i>(N° ' + TG_esc_(f[jN]) + ')</i>' : '') +
      '\n   publicada ' + TG_fecha_(aFecha_(f[jF]) || f[jF]) + (jS >= 0 && f[jS] ? ' · surte efecto ' + TG_fecha_(aFecha_(f[jS]) || f[jS]) : '');
  });
  if (fila.length) botones.push(fila);
  botones.push([{ text: '💬 ¿Qué debo hacer con esto?', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: 'Explícame las notificaciones SUNAT nuevas de hoy: qué son, qué plazo tienen y qué debo hacer con cada una.' }, 86400) }]);
  return [{ html: '📬 <b>' + (nuevas.length === 1 ? 'Nueva notificación' : nuevas.length + ' notificaciones nuevas') + ' en el Buzón SUNAT</b>\n\n' + lineas.join('\n') +
    (nuevas.length > 10 ? '\n<i>… y ' + (nuevas.length - 10) + ' más (/notificaciones)</i>' : ''), teclado: botones }];
}

function TG_avisoMensajes_(c, V) {
  var t = TG_tablaLibro_(c, 'notificaciones', 'Mensajes');
  var jE = TG_col_(t.columnas, 'Empresa'), jR = TG_col_(t.columnas, 'RUC empresa'), jF = TG_col_(t.columnas, 'Fecha publicación'), jA = TG_col_(t.columnas, 'Asunto'), jC = TG_col_(t.columnas, 'Código');
  var nuevas = TG_nuevos_(V, 'msj', t.filas, function (f) { return jC >= 0 && f[jC] ? f[jC] : [f[jR], f[jF], f[jA]].join('|'); });
  if (!nuevas.length) return [];
  return [{ html: '✉️ <b>' + nuevas.length + ' mensaje(s) nuevo(s) en el Buzón SUNAT</b>\n' + nuevas.slice(0, 10).map(function (f) {
    return '• <b>' + TG_esc_(f[jE]) + '</b> · ' + TG_fecha_(aFecha_(f[jF]) || f[jF]) + ' — ' + TG_esc_(String(f[jA]).slice(0, 140));
  }).join('\n') }];
}

function TG_avisoDetracciones_(c, V) {
  var filas = leerDetraccionesSunat_(c.cfg, []).filas;
  var nuevas = TG_nuevos_(V, 'det', filas, function (d) { return d.constancia; });
  if (!nuevas.length) return [];
  var total = nuevas.reduce(function (s, d) { return s + d.monto; }, 0);
  return [{ html: '🏦 <b>' + nuevas.length + ' detracción(es) nueva(s) · S/ ' + TG_num_(total) + '</b>\n' + nuevas.slice(0, 10).map(function (d) {
    return '• ' + TG_fecha_(d.fecha) + ' · ' + TG_esc_(ANA_nombreEmp_(c, d.adquirienteRuc) || d.adquiriente) + ' → ' + TG_esc_(String(d.proveedor).slice(0, 28)) + ' · ' + TG_esc_(d.documento) + ': <b>S/ ' + TG_num_(d.monto) + '</b>';
  }).join('\n') + (nuevas.length > 10 ? '\n<i>… y ' + (nuevas.length - 10) + ' más (/detracciones)</i>' : '') + '\n<i>Ya se descuentan solas de su factura en Cobranzas.</i>' }];
}

function TG_avisoRetenciones_(c, V) {
  var res = [];
  ['Emitidas', 'Recibidas'].forEach(function (h) {
    var t = TG_tablaLibro_(c, 'retenciones', h);
    var jE = TG_col_(t.columnas, 'Empresa'), jR = TG_col_(t.columnas, 'RUC empresa'), jC = TG_col_(t.columnas, 'Comprobante'), jI = TG_col_(t.columnas, 'Importe retenido S/'),
      jN = TG_col_(t.columnas, h === 'Emitidas' ? /^Proveedor/ : 'Agente de retención'), jF = TG_col_(t.columnas, 'Fecha emisión');
    var nuevas = TG_nuevos_(V, 'ret' + h, t.filas, function (f) { return [f[jR], f[jC]].join('|'); });
    if (!nuevas.length) return;
    res.push({ html: '🧾 <b>' + nuevas.length + ' retención(es) ' + (h === 'Emitidas' ? 'emitida(s) (retuvimos)' : 'recibida(s) (nos retuvieron)') + '</b> · S/ ' +
      TG_num_(nuevas.reduce(function (s, f) { return s + aNumero_(f[jI]); }, 0)) + '\n' + nuevas.slice(0, 10).map(function (f) {
        return '• ' + TG_esc_(f[jE]) + ' · ' + TG_esc_(f[jC]) + ' · ' + TG_esc_(String(f[jN] || '').slice(0, 28)) + ': S/ ' + TG_num_(aNumero_(f[jI])) + ' <i>(' + TG_fecha_(aFecha_(f[jF]) || f[jF]) + ')</i>';
      }).join('\n') });
  });
  return res;
}

/** ⚠️ Proveedores / clientes / empresas del grupo que aparecen en la lista SSCO (pestaña ⚠️ SSCO). La primera vez avisa lo que ya hay. */
function TG_avisoSsco_(c, V) {
  var sh = c.ss.getSheetByName(SSCO_PESTANA_);
  if (!sh || sh.getLastRow() < 7) return [];
  var filas = sh.getRange(7, 1, sh.getLastRow() - 6, 15).getValues().filter(function (f) { return /^\d{11}$/.test(String(f[2])); });
  var primera = !V.mapa.ssco;
  var nuevas = TG_nuevos_(V, 'ssco', filas, function (f) { return [f[0], f[2], TG_fecha_(aFecha_(f[7]))].join('|'); });
  if (primera) nuevas = filas;   // revisión inicial: lo que ya está en la lista también importa
  if (!nuevas.length) return [];
  return [{ html: '🚨 <b>' + nuevas.length + ' proveedor(es)/cliente(s) en la lista de Sujetos Sin Capacidad Operativa de SUNAT</b>\n' +
    'Sus facturas no dan crédito fiscal ni sustentan gasto.\n\n' + nuevas.slice(0, 12).map(function (f) {
      return '• ' + TG_esc_(f[0]) + ' · <b>' + TG_esc_(String(f[3]).slice(0, 40)) + '</b> (' + f[2] + ') · ' + TG_esc_(f[1]) +
        (f[9] ? ': ' + f[9] + ' factura(s)' + (f[10] ? ', S/ ' + TG_num_(aNumero_(f[10])) + ' (IGV aprox. S/ ' + TG_num_(aNumero_(f[11])) + ')' : '') : '') +
        '\n   ' + TG_esc_(f[4]);
    }).join('\n') + (nuevas.length > 12 ? '\n…' : '') + '\n\nDetalle en la pestaña <b>⚠️ SSCO</b> de Cuentas por Cobrar y Pagar.' }];
}

function TG_avisoHonorarios_(c, V) {
  var t = TG_tablaLibro_(c, 'honorarios', 'Recibos');
  var jE = TG_col_(t.columnas, 'Empresa'), jR = TG_col_(t.columnas, 'RUC empresa'), jC = TG_col_(t.columnas, 'Comprobante'), jRE = TG_col_(t.columnas, 'RUC emisor'),
    jN = TG_col_(t.columnas, /^Emisor/), jB = TG_col_(t.columnas, 'Renta bruta');
  var nuevas = TG_nuevos_(V, 'hon', t.filas, function (f) { return [f[jR], f[jC], f[jRE]].join('|'); });
  if (!nuevas.length) return [];
  return [{ html: '🧑‍💼 <b>' + nuevas.length + ' recibo(s) por honorarios nuevo(s)</b>\n' + nuevas.slice(0, 10).map(function (f) {
    return '• ' + TG_esc_(f[jE]) + ' · ' + TG_esc_(String(f[jN]).slice(0, 30)) + ' · ' + TG_esc_(f[jC]) + ': S/ ' + TG_num_(aNumero_(f[jB]));
  }).join('\n') }];
}

function TG_avisoVouchers_(c, V) {
  if (!c.cfg.idVouchers) return [];
  var libro = SpreadsheetApp.openById(c.cfg.idVouchers);
  var res = [];
  c.cfg.pestanasVouchers.forEach(function (p) {
    var t;
    try { t = TG_tabla_(libro, p); } catch (e) { return; }
    var jF = TG_col_(t.columnas, 'Fecha'), jO = TG_col_(t.columnas, 'Numero'), jB = TG_col_(t.columnas, 'Banco'), jMo = TG_col_(t.columnas, 'Moneda'),
      jM = TG_col_(t.columnas, 'Monto'), jP = TG_col_(t.columnas, 'Proveedor'), jEm = TG_col_(t.columnas, 'Empresa');
    var g = function (f, j) { return j >= 0 ? f[j] : ''; };
    var nuevas = TG_nuevos_(V, 'vou' + p, t.filas, function (f) { return [p, TG_fecha_(aFecha_(g(f, jF)) || g(f, jF)), g(f, jO), g(f, jM)].join('|'); });
    if (!nuevas.length) return;
    res.push({ html: '💳 <b>' + nuevas.length + ' voucher(s) nuevo(s)</b> en ' + TG_esc_(p) + '\n' + nuevas.slice(0, 10).map(function (f) {
      return '• ' + TG_fecha_(aFecha_(g(f, jF)) || g(f, jF)) + ' · ' + TG_esc_(g(f, jB)) + ' ' + (/USD|\$/.test(g(f, jMo)) ? 'US$ ' : 'S/ ') + TG_num_(aNumero_(g(f, jM))) +
        ' → ' + TG_esc_(String(g(f, jP)).slice(0, 30)) + (g(f, jEm) ? ' <i>(' + TG_esc_(g(f, jEm)) + ')</i>' : '');
    }).join('\n') + (nuevas.length > 10 ? '\n<i>… y ' + (nuevas.length - 10) + ' más</i>' : ''),
      teclado: [[{ text: '💬 ¿A qué facturas corresponden?', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: 'Los vouchers registrados hoy: ¿a qué facturas corresponden y cuáles todavía no se usan en ninguna?' }, 86400) }]] });
  });
  return res;
}

function TG_avisoErrores_(c, V, cfg) {
  if (!cfg.github) return [];
  var res = [];
  Object.keys(TG_PROYECTOS_).forEach(function (k) {
    var p = TG_PROYECTOS_[k];
    var runs = TG_ghRuns_(cfg, 5, p.wf).filter(function (r) { return r.status === 'completed'; });
    var malas = TG_nuevos_(V, 'err' + k, runs, function (r) { return r.id + '#' + (r.run_attempt || 1); })
      .filter(function (r) { return r.conclusion === 'failure' || r.conclusion === 'timed_out'; });
    malas.slice(0, 2).forEach(function (r) {
      var f = TG_ghJobsFallidos_(cfg, r.id);
      res.push({ html: '❌ <b>Falló la descarga de ' + p.nombre + '</b> · ' + TG_cuando_(r.created_at) + (f.length ? '\nEmpresas: ' + TG_esc_(f.map(function (x) { return TG_nombreEmpresa_(cfg, x); }).join(', ')) : '') +
        '\n<a href="' + r.html_url + '">ver en GitHub</a>',
        teclado: [[{ text: '🔁 Reintentar lo que falló', callback_data: 'rr:' + r.id }]] });
    });
  });
  return res;
}
