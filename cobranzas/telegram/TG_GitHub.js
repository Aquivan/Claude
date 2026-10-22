/**
 * 🤖 Telegram — descargas de SUNAT en GitHub: estado de las corridas, pedir una
 * descarga (paso a paso con botones o desde el chat con la IA), reintentar lo
 * que falló y avisar cuando termina. Usa el 🔑 Token de GitHub guardado en el script.
 */

var TG_PROYECTOS_ = {
  sire: { nombre: '📑 SIRE (compras, ventas y PDF/XML)', wf: 'sire-cadena-completa.yml', unPeriodo: true,
    inputs: function (x) { return { periodo: x.desde || '', ruc: x.empresa === 'todas' ? '' : x.empresa }; } },
  // ⚡ Solo el registro (sin PDF/XML), varias empresas y rango de meses: ver TG_SireRapido.js.
  sire_rapido: { nombre: '⚡ SIRE solo reporte (rápido)', wf: 'sire-solo-reporte.yml',
    inputs: function (x) {
      var d = x.desde || '', h = x.hasta || TG_mes_(0);
      return { ruc: x.empresa === 'todas' ? '' : x.empresa, periodo: !d ? '' : d === h ? d : d + '-' + h, tipo: x.tipo || 'ambos' };
    } },
  retenciones: { nombre: '🧾 Retenciones (CRE)', wf: 'retenciones-descargar.yml',
    inputs: function (x) { return { empresa: x.empresa, periodo: x.desde || TG_mes_(0), hasta: x.hasta || '' }; } },
  honorarios: { nombre: '🧑‍💼 Recibos por honorarios', wf: 'honorarios-descargar.yml',
    inputs: function (x) { return { empresa: x.empresa, periodo: x.desde || TG_mes_(0), hasta: x.hasta || '' }; } },
  notificaciones: { nombre: '📬 Buzón SUNAT', wf: 'notificaciones-descargar.yml',
    inputs: function (x) { return { empresa: x.empresa, desde: x.desde || '', solo_nuevas: !x.desde && x.nuevas !== false ? 'true' : 'false' }; } },
  detracciones: { nombre: '🏦 Detracciones', wf: 'detracciones-descargar.yml',
    inputs: function (x) { return { empresa: x.empresa, desde: x.desde || '', hasta: x.hasta || '' }; } },
};

function TG_proyectoDe_(txt) {
  var n = normHeader_(txt || '');
  if (TG_PROYECTOS_[n]) return n;
  if (/rapid|solo (el )?(reporte|registro)|sin (pdf|xml|factura)/.test(n)) return 'sire_rapido';
  if (/sire|compra|venta|registro/.test(n)) return 'sire';
  if (/reten|cre/.test(n)) return 'retenciones';
  if (/honor|rhe|recibo/.test(n)) return 'honorarios';
  if (/notif|buzon|mensaj/.test(n)) return 'notificaciones';
  if (/detrac|spot|constanc/.test(n)) return 'detracciones';
  return '';
}

/** AAAAMM de hace n meses. */
function TG_mes_(n) {
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return Utilities.formatDate(d, 'America/Lima', 'yyyyMM');
}

/* ============================================================ API de GitHub */

function TG_gh_(cfg, ruta, metodo, carga) {
  if (!cfg.github) throw new Error('falta el 🔑 Token de GitHub (hoja de Cobranzas → menú 🤖 Telegram → 🔑 Token de GitHub).');
  var p = { method: metodo || 'get', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + cfg.github, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (carga) { p.contentType = 'application/json'; p.payload = JSON.stringify(carga); }
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.nombreRepo + ruta, p);
  var c = r.getResponseCode();
  if (c === 401 || c === 403) throw new Error('GitHub rechazó el token (HTTP ' + c + '): revise que tenga permiso "Actions: Read and write".');
  if (c >= 300) throw new Error('GitHub respondió HTTP ' + c + ': ' + r.getContentText().slice(0, 150));
  return c === 204 || !r.getContentText() ? {} : JSON.parse(r.getContentText());
}

function TG_ghRuns_(cfg, n, wf) {
  var ruta = (wf ? '/actions/workflows/' + wf + '/runs' : '/actions/runs') + '?per_page=' + (n || 10);
  return (TG_gh_(cfg, ruta).workflow_runs || []);
}

function TG_ghJobsFallidos_(cfg, runId) {
  var js = TG_gh_(cfg, '/actions/runs/' + runId + '/jobs?per_page=100').jobs || [];
  var out = [];
  js.filter(function (j) { return j.conclusion === 'failure' || j.conclusion === 'timed_out'; }).forEach(function (j) {
    var m = String(j.name).match(/\((\d{11})\)|(\d{11})/);
    if (m) { out.push(m[1] || m[2]); return; }
    // "descargar (todas)": todas las empresas en una máquina; las que fallaron vienen en su anotación.
    if (/todas/.test(j.name)) {
      try {
        var notas = TG_gh_(cfg, '/check-runs/' + j.id + '/annotations') || [];
        var rucs = [];
        notas.forEach(function (n) { if (/Empresas que fallaron/.test(n.title || '')) rucs = rucs.concat(String(n.message).match(/\d{11}/g) || []); });
        if (rucs.length) { out = out.concat(rucs); return; }
      } catch (e) {}
    }
    out.push(j.name);
  });
  return out;
}

function TG_iconoRun_(r) {
  if (r.status !== 'completed') return '⏳';
  return { success: '✅', failure: '❌', cancelled: '⚪', skipped: '⚪', timed_out: '⌛' }[r.conclusion] || '⚠️';
}

function TG_cuando_(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd');
  var dia = Utilities.formatDate(d, 'America/Lima', 'yyyyMMdd');
  var hora = Utilities.formatDate(d, 'America/Lima', 'HH:mm');
  if (dia === hoy) return 'hoy ' + hora;
  var ayer = Utilities.formatDate(new Date(Date.now() - 86400000), 'America/Lima', 'yyyyMMdd');
  return (dia === ayer ? 'ayer ' : Utilities.formatDate(d, 'America/Lima', 'dd/MM ')) + hora;
}

function TG_duracion_(r) {
  var a = new Date(r.run_started_at || r.created_at).getTime(), b = new Date(r.updated_at).getTime();
  var min = Math.max(0, Math.round((b - a) / 60000));
  return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
}

/* ============================================================ estado */

/** Para la IA: últimas corridas de cada descarga. */
function TG_estadoTabla_(cfg, proyecto) {
  var ps = proyecto ? [TG_proyectoDe_(proyecto)].filter(Boolean) : Object.keys(TG_PROYECTOS_);
  var filas = [];
  ps.forEach(function (k) {
    TG_ghRuns_(cfg, 3, TG_PROYECTOS_[k].wf).forEach(function (r) {
      var fallidas = r.conclusion === 'failure' ? TG_ghJobsFallidos_(cfg, r.id).join(', ') : '';
      filas.push([k, TG_iconoRun_(r) + ' ' + (r.status === 'completed' ? r.conclusion : r.status), TG_cuando_(r.created_at), TG_duracion_(r), r.display_title || r.name, fallidas, r.html_url]);
    });
  });
  return { columnas: ['proyecto', 'estado', 'cuando', 'duracion', 'titulo', 'empresas_que_fallaron', 'enlace'], filas: filas };
}

function TG_enviarEstado_(ctx) {
  var cfg = TG_cfg_(ctx.ss);
  TG_accion_(ctx.chatId, 'typing');
  var lineas = [], botones = [];
  try {
    Object.keys(TG_PROYECTOS_).forEach(function (k) {
      var p = TG_PROYECTOS_[k];
      var rs = TG_ghRuns_(cfg, 4, p.wf);
      if (!rs.length) { lineas.push('⚪ <b>' + p.nombre + '</b> · sin corridas'); return; }
      var r = rs[0];
      var lin = TG_iconoRun_(r) + ' <b>' + p.nombre + '</b> · ' + TG_cuando_(r.created_at) + (r.status === 'completed' ? ' (' + TG_duracion_(r) + ')' : ' · en curso');
      if (r.conclusion === 'failure') {
        var f = TG_ghJobsFallidos_(cfg, r.id);
        lin += '\n   falló: ' + TG_esc_(f.map(function (x) { return TG_nombreEmpresa_(cfg, x); }).join(', ') || 'ver detalle');
        botones.push([{ text: '🔁 Reintentar ' + p.nombre.replace(/^\S+\s/, ''), callback_data: 'rr:' + r.id }]);
      }
      var ok = rs.filter(function (x) { return x.conclusion === 'success'; })[0];
      if (r.conclusion !== 'success' && ok) lin += '\n   último bueno: ' + TG_cuando_(ok.created_at);
      lin += ' · <a href="' + r.html_url + '">ver</a>';
      lineas.push(lin);
    });
  } catch (e) {
    return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message));
  }
  botones.push([{ text: '⬇ Pedir una descarga', callback_data: 'c:descargar' }, { text: '🔄 Actualizar', callback_data: 'c:estado' }]);
  TG_enviar_(ctx.chatId, '⚙️ <b>Descargas de SUNAT</b> (última corrida de cada una)\n\n' + lineas.join('\n\n'), botones);
}

function TG_nombreEmpresa_(cfg, ruc) {
  return (cfg.cob && cfg.cob.nombreEmpresa[ruc]) || ruc;
}

function TG_reintentarRun_(ctx, datos) {
  var cfg = TG_cfg_(ctx.ss);
  try {
    TG_gh_(cfg, '/actions/runs/' + datos.id + '/rerun-failed-jobs', 'post');
    TG_seguir_(ctx.chatId, null, datos.id, 'Reintento de ' + datos.nombre);
    TG_enviar_(ctx.chatId, '🔁 Reintentando lo que falló de ' + TG_esc_(datos.nombre) + '. Le aviso cuando termine.');
  } catch (e) {
    TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message));
  }
}

/* ============================================================ pedir una descarga */

/** Paso a paso con botones: proyecto → empresa → periodo → confirmar. paso = "p:<proy>", "e:<proy>:<emp>", "t:<proy>:<emp>:<periodo>" */
function TG_asistenteDescarga_(ctx, paso) {
  var cfg = TG_cfg_(ctx.ss);
  var p = String(paso || '').split(':');
  if (!paso) {
    return TG_enviar_(ctx.chatId, '⬇ <b>¿Qué descargo de SUNAT?</b>', Object.keys(TG_PROYECTOS_).map(function (k) {
      return [{ text: TG_PROYECTOS_[k].nombre, callback_data: 'dw:p:' + k }];
    }).concat([[{ text: '⚙️ Ver estado de las descargas', callback_data: 'c:estado' }]]));
  }
  if (p[0] === 'p') {
    var filas = [[{ text: '🏢 Todas las empresas', callback_data: 'dw:e:' + p[1] + ':todas' }]];
    var fila = [];
    cfg.cob.grupo.forEach(function (ruc) {
      fila.push({ text: cfg.cob.nombreEmpresa[ruc] || ruc, callback_data: 'dw:e:' + p[1] + ':' + ruc });
      if (fila.length === 3) { filas.push(fila); fila = []; }
    });
    if (fila.length) filas.push(fila);
    return TG_editarOEnviar_(ctx, TG_PROYECTOS_[p[1]].nombre + '\n<b>¿De qué empresa?</b>', filas);
  }
  if (p[0] === 'e') {
    var proy = TG_PROYECTOS_[p[1]];
    var base = 'dw:t:' + p[1] + ':' + p[2] + ':';
    var opciones = p[1] === 'notificaciones'
      ? [[{ text: '🆕 Solo lo nuevo (rápido)', callback_data: base + 'n' }],
        [{ text: 'Este mes', callback_data: base + 'm0' }, { text: 'Últimos 3 meses', callback_data: base + 'm3' }],
        [{ text: 'Todo el año', callback_data: base + 'y' }, { text: 'Todo el buzón (lento)', callback_data: base + 'todo' }]]
      : proy.unPeriodo
      ? [[{ text: 'Este mes (' + TG_mes_(0) + ')', callback_data: base + TG_mes_(0) }, { text: 'Mes anterior (' + TG_mes_(1) + ')', callback_data: base + TG_mes_(1) }]]
      : [[{ text: 'Este mes', callback_data: base + 'm0' }, { text: 'Mes anterior', callback_data: base + 'm1' }],
        [{ text: 'Últimos 3 meses', callback_data: base + 'm3' }, { text: 'Todo el año', callback_data: base + 'y' }]];
    return TG_editarOEnviar_(ctx, proy.nombre + ' · ' + (p[2] === 'todas' ? 'todas las empresas' : TG_esc_(TG_nombreEmpresa_(cfg, p[2]))) + '\n<b>¿Qué periodo?</b>' +
      (p[1] === 'sire_rapido' ? '\n<i>Otro rango o varias empresas: escriba, por ejemplo, /sire granix, luque 202601-202609</i>' : ''), opciones);
  }
  if (p[0] === 't') {
    var per = p[3], desde = '', hasta = '';
    if (/^\d{6}$/.test(per)) desde = per;
    else if (per === 'm0') desde = TG_mes_(0);
    else if (per === 'm1') { desde = TG_mes_(1); hasta = TG_mes_(1); }
    else if (per === 'm3') desde = TG_mes_(2);
    else if (per === 'y') desde = new Date().getFullYear() + '01';
    if (p[1] === 'notificaciones' && per === 'm0') desde = TG_mes_(0);
    var acc = { t: 'descarga', proyecto: p[1], empresa: p[2], desde: desde, hasta: hasta };
    if (p[1] === 'notificaciones' && !desde) acc.nuevas = per !== 'todo';
    TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
    return TG_proponerDescarga_(ctx, acc);
  }
}

function TG_editarOEnviar_(ctx, html, teclado) {
  if (ctx.msgId && TG_editar_(ctx.chatId, ctx.msgId, html, teclado)) return;
  TG_enviar_(ctx.chatId, html, teclado);
}

function TG_textoDescarga_(acc, cob) {
  var p = TG_PROYECTOS_[acc.proyecto];
  var emp = acc.empresa === 'todas' ? 'todas las empresas' : String(acc.empresa).split(',').map(function (r) { return (cob && cob.nombreEmpresa[r]) || r; }).join(', ');
  if (acc.proyecto === 'sire_rapido') {
    var h = acc.hasta || TG_mes_(0), d = acc.desde || h;
    return p.nombre + ' · ' + emp + ' · ' + (d === h ? d : d + ' a ' + h) + ' · ' + ({ compra: 'solo compras', venta: 'solo ventas' }[acc.tipo] || 'compras y ventas');
  }
  var per = acc.desde ? (acc.hasta && acc.hasta !== acc.desde ? acc.desde + ' a ' + acc.hasta : (p.unPeriodo || acc.hasta ? acc.desde : 'desde ' + acc.desde)) :
    (acc.proyecto === 'detracciones' ? 'últimos 3 meses' : acc.proyecto === 'notificaciones' ? (acc.nuevas === false ? 'todo el buzón' : 'solo lo nuevo') : 'este mes');
  return p.nombre + ' · ' + emp + ' · ' + per;
}

function TG_proponerDescarga_(ctx, acc) {
  var cfg = TG_cfg_(ctx.ss);
  var k = TG_guardarBoton_(acc);
  TG_enviar_(ctx.chatId, '🚀 <b>¿Pido esta descarga a SUNAT?</b>\n' + TG_esc_(TG_textoDescarga_(acc, cfg.cob)) +
    '\n<i>Corre en GitHub (unos minutos por empresa). Solo LEE en SUNAT. Le aviso cuando termine y la hoja respectiva se actualiza sola.</i>',
    [[{ text: '🚀 Sí, descargar', callback_data: 'k:' + k + ':si' }, { text: '✖ Cancelar', callback_data: 'k:' + k + ':no' }]]);
}

function TG_confirmarDescarga_(ctx, acc, op) {
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  if (op === 'no') return TG_enviar_(ctx.chatId, 'Cancelado, no pedí nada.');
  if (TG_yaVisto_('desc' + ctx.chatId + '_' + ctx.msgId)) return;   // doble toque
  var cfg = TG_cfg_(ctx.ss);
  var p = TG_PROYECTOS_[acc.proyecto];
  var inputs = p.inputs(acc);
  try {
    TG_gh_(cfg, '/actions/workflows/' + p.wf + '/dispatches', 'post', { ref: cfg.rama, inputs: inputs });
  } catch (e) {
    return TG_enviar_(ctx.chatId, '⚠️ No se pudo pedir la descarga: ' + TG_esc_(e.message));
  }
  TG_seguir_(ctx.chatId, p.wf, null, TG_textoDescarga_(acc, cfg.cob), acc.proyecto === 'sire_rapido' ? { tipo: 'sire_rapido', titulo: TGS_titulo_(inputs) } : null);
  TG_enviar_(ctx.chatId, '✅ <b>Descarga pedida</b>: ' + TG_esc_(TG_textoDescarga_(acc, cfg.cob)) + '\nLe aviso cuando termine. Mientras tanto puede seguir preguntándome.',
    [[{ text: '⚙️ Ver estado', callback_data: 'c:estado' }]]);
}

/* ============================================================ seguimiento (avisar al terminar) */

function TG_seguir_(chatId, wf, runId, texto, extra) {
  var props = PropertiesService.getScriptProperties();
  var lista = JSON.parse(props.getProperty('TG_SEGUIR') || '[]');
  lista.push({ chat: chatId, wf: wf, run: runId, texto: texto, desde: Date.now(), extra: extra || null });
  props.setProperty('TG_SEGUIR', JSON.stringify(lista.slice(-20)));
  TG_programarSeguimiento_(4);
}

function TG_programarSeguimiento_(min) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TG_seguirDescargas') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('TG_seguirDescargas').timeBased().after(min * 60000).create();
}

/** Disparador: revisa las descargas pedidas desde Telegram y avisa las que terminaron. */
function TG_seguirDescargas() {
  var props = PropertiesService.getScriptProperties();
  var lista = JSON.parse(props.getProperty('TG_SEGUIR') || '[]');
  if (!lista.length) return;
  var ss = TG_ss_();
  var cfg = TG_cfg_(ss);
  var quedan = [];
  lista.forEach(function (s) {
    try {
      var r = null;
      if (s.run) r = TG_gh_(cfg, '/actions/runs/' + s.run);
      else {
        // Si se sabe el nombre de la corrida (⚡ SIRE solo reporte), solo vale la que se llama así.
        r = TG_ghRuns_(cfg, 10, s.wf).filter(function (x) { return x.event === 'workflow_dispatch' && new Date(x.created_at).getTime() >= s.desde - 90000 &&
            (!s.extra || !s.extra.titulo || x.display_title === s.extra.titulo); })
          .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); })[0] || null;
        if (r) s.run = r.id;
      }
      var edad = Date.now() - s.desde;
      if (!r) { if (edad < 30 * 60000) quedan.push(s); return; }
      if (r.status !== 'completed' || (s.run && r.run_attempt && r.updated_at && new Date(r.updated_at).getTime() < s.desde)) {
        if (edad < 4 * 3600000) quedan.push(s);
        else if (String(s.chat).indexOf('wa') !== 0) TG_enviar_(s.chat, '⏳ ' + TG_esc_(s.texto) + ' sigue corriendo después de 4 horas: <a href="' + r.html_url + '">ver en GitHub</a>');
        return;
      }
      if (s.extra && s.extra.tipo === 'cre') return TGR_avisarFin_(cfg, s, r);   // 🧾 comprobante de retención (TG_Retener.js)
      if (s.extra && s.extra.tipo === 'sire_rapido') return TGS_avisarFin_(cfg, s, r);   // ⚡ SIRE solo reporte (TG_SireRapido.js)
      var fallidas = r.conclusion === 'failure' ? TG_ghJobsFallidos_(cfg, r.id) : [];
      var botones = fallidas.length ? [[{ text: '🔁 Reintentar lo que falló', callback_data: 'rr:' + r.id }]] : null;
      TG_enviar_(s.chat, TG_iconoRun_(r) + ' <b>' + (r.conclusion === 'success' ? 'Descarga terminada' : 'La descarga terminó con problemas') + '</b>: ' + TG_esc_(s.texto) +
        ' (' + TG_duracion_(r) + ')' + (fallidas.length ? '\nFalló: ' + TG_esc_(fallidas.map(function (x) { return TG_nombreEmpresa_(cfg, x); }).join(', ')) : '') +
        '\n<a href="' + r.html_url + '">ver en GitHub</a>' + (r.conclusion === 'success' ? '\n<i>La hoja respectiva toma los datos en su próxima actualización.</i>' : ''), botones);
    } catch (e) {
      console.warn('Seguimiento: ' + e.message);
      if (Date.now() - s.desde < 4 * 3600000) quedan.push(s);
    }
  });
  props.setProperty('TG_SEGUIR', JSON.stringify(quedan));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TG_seguirDescargas') ScriptApp.deleteTrigger(t); });
  if (quedan.length) TG_programarSeguimiento_(5);
}
