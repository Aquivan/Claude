/**
 * 🤖 Telegram — respuestas rápidas SIN IA (al instante, desde los botones del menú):
 * resumen del día, cartera por cobrar / por pagar, vencidas, Buzón SUNAT,
 * detracciones, retenciones, honorarios, tipo de cambio, recordatorios y avisos.
 */

/** Contexto de datos como el del analista (para reusar sus lectores y filtros). */
function TG_ctxDatos_(ss) {
  var c = ANA_ctx_(ss);
  c.op = { tg: { cfg: TG_cfg_(ss), archivos: [], acciones: [] } };
  return c;
}

function TG_rucEmpresa_(c, nombre) {
  var n = normHeader_(nombre);
  var r = Object.keys(c.cfg.nombreEmpresa).filter(function (k) { return normHeader_(c.cfg.nombreEmpresa[k]) === n; })[0];
  return r || ANA_empresa_(c, nombre);
}

function TG_monedas_(lista, campo) {
  var t = { PEN: 0, USD: 0 };
  lista.forEach(function (d) { t[/USD|US\$|DOLAR/i.test(d.moneda) ? 'USD' : 'PEN'] += Number(d[campo || 'saldo']) || 0; });
  return t;
}

/** «S/ 1,200.00 + US$ 300.00»; si solo hay dólares, solo «US$ 300.00» (sin «S/ 0.00»). */
function TG_montos_(t) {
  var usd = Math.abs(t.USD) > 0.005, pen = Math.abs(t.PEN) > 0.005 || !usd;
  return (pen ? 'S/ ' + TG_num_(t.PEN) : '') + (pen && usd ? ' + ' : '') + (usd ? 'US$ ' + TG_num_(t.USD) : '');
}

/** Nombre de 40 caracteres como máximo; si se corta, con el final del RUC para distinguir nombres parecidos. */
function TG_nombreCorto_(nombre, ruc) {
  nombre = String(nombre || ruc || '').trim();
  return nombre.length <= 40 ? nombre : nombre.slice(0, 38).trim() + '… ·' + String(ruc || '').slice(-4);
}

/** Asunto de una notificación sin repetir "Notificación de…" ni el número dos veces. */
function TG_asunto_(asunto, tipo, numero) {
  var a = String(asunto || '').replace(/^Notificaci[oó]n( de)?\s*/i, '').replace(/ en Buz[oó]n Electr[oó]nico SOL\s*$/i, '').trim();
  if (!a) a = [tipo, numero].filter(Boolean).join(' ');
  return a.charAt(0).toUpperCase() + a.slice(1, 140);
}

function TG_hoy_() {
  var d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

/* ============================================================ resumen del día */

function TG_enviarResumen_(ctx) {
  TG_accion_(ctx.chatId, 'typing');
  // ✨ Con tablas (mensaje enriquecido); si Telegram no lo acepta, el texto de siempre.
  TG_mostrarRico_(ctx, TG_textoResumen_(ctx.ss, true), function () { return TG_textoResumen_(ctx.ss); }, [
    [{ text: '💰 Por cobrar', callback_data: 'c:cobrar' }, { text: '💸 Por pagar', callback_data: 'c:pagar' }, { text: '⏰ Vencidas', callback_data: 'c:vencidas' }],
    [{ text: '📬 Buzón SUNAT', callback_data: 'c:notificaciones' }, { text: '⚙️ Últimas descargas', callback_data: 'c:estado' }],
    [{ text: '💬 Analiza el día con IA', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: 'Dame un análisis del estado de hoy del grupo: qué cobrar primero, qué pagar, qué notificaciones SUNAT atender y qué riesgos ves.' }) }],
  ]);
}

/** rico=true: HTML enriquecido con tablas (TG_mostrarRico_); si no, el HTML de siempre (también para el aviso de la mañana). */
function TG_textoResumen_(ss, rico) {
  var c = TG_ctxDatos_(ss);
  var cfg = c.op.tg.cfg;
  var hoy = TG_hoy_();
  var dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];   // en español (formatDate da el día en inglés)
  var fecha = dias[Number(Utilities.formatDate(new Date(), 'America/Lima', 'u')) % 7] + ' ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy');
  var partes = [rico ? '<h2>📊 Resumen · ' + fecha + '</h2>' : '📊 <b>Resumen · ' + fecha + '</b>'];
  var bloque = function (fn) { try { var s = fn(); if (s) partes.push(s); } catch (e) { console.warn('Resumen: ' + e.message); } };
  bloque(function () {
    var docs = ANA_docs_(c).filter(function (d) { return d.saldo > 0.5; });
    var lin = [], filas = [];
    ['Por cobrar', 'Por pagar'].forEach(function (lado) {
      var ds = docs.filter(function (d) { return d.lado === lado; });
      if (!ds.length) return;
      var venc = ds.filter(function (d) { return d.dias_vencido > 0; });
      var ic = lado === 'Por cobrar' ? '💰' : '💸';
      // 2 columnas para que entre en la pantalla del celular: documentos y vencido van en una segunda línea
      filas.push('<tr><td>' + ic + ' <b>' + lado + '</b><br><i>' + ds.length + ' doc.</i></td><td align="right"><b>' + TG_montos_(TG_monedas_(ds)) + '</b>' +
        (venc.length ? '<br>⚠️ vencido ' + TG_montos_(TG_monedas_(venc)) + ' (' + venc.length + ')' : '') + '</td></tr>');
      lin.push(ic + ' <b>' + lado + ':</b> ' + TG_montos_(TG_monedas_(ds)) + ' <i>(' + ds.length + ' doc.)</i>' +
        (venc.length ? '\n   ⚠️ vencido: ' + TG_montos_(TG_monedas_(venc)) + ' <i>(' + venc.length + ')</i>' : ''));
    });
    var lim = new Date(hoy.getTime() + cfg.diasVence * 86400000);
    var pronto = docs.filter(function (d) { return d.vence && d.vence >= hoy && d.vence <= lim; });
    if (pronto.length) {
      filas.push('<tr><td>⏰ Vencen en ' + cfg.diasVence + ' días<br><i>' + pronto.length + ' doc.</i></td><td align="right">' + TG_montos_(TG_monedas_(pronto)) + '</td></tr>');
      lin.push('⏰ <b>Vencen en ' + cfg.diasVence + ' días:</b> ' + pronto.length + ' doc. · ' + TG_montos_(TG_monedas_(pronto)));
    }
    if (rico) return filas.length ? '<table bordered striped compact><tr><th>Cuentas</th><th>Saldo</th></tr>' + filas.join('') + '</table>' : '';
    return lin.join('\n');
  });
  bloque(function () {
    var t = TG_tablaLibro_(c, 'notificaciones', 'Notificaciones');
    var jF = TG_col_(t.columnas, 'Fecha publicación'), jL = TG_col_(t.columnas, 'Leída');
    var hace7 = new Date(hoy.getTime() - 6 * 86400000);
    var semana = t.filas.filter(function (f) { var d = aFecha_(f[jF]); return d && d >= hace7; });
    var hoyN = semana.filter(function (f) { var d = aFecha_(f[jF]); return d && d >= hoy; }).length;
    var sinLeer = jL >= 0 ? t.filas.filter(function (f) { return !f[jL] || /^(no|false)$/i.test(String(f[jL])); }).length : 0;
    return '📬 <b>Buzón SUNAT:</b> ' + (hoyN ? '<b>' + hoyN + ' nueva(s) hoy</b> · ' : '') + semana.length + ' en los últimos 7 días' + (sinLeer ? ' · ' + sinLeer + ' sin leer' : '');
  });
  bloque(function () {
    var mes = TG_mes_(0);
    var det = leerDetraccionesSunat_(c.cfg, []).filas.filter(function (d) { return d.fecha && Utilities.formatDate(d.fecha, 'America/Lima', 'yyyyMM') === mes; });
    if (!det.length) return '';
    return '🏦 <b>Detracciones del mes:</b> ' + det.length + ' depósito(s) · S/ ' + TG_num_(det.reduce(function (s, d) { return s + d.monto; }, 0));
  });
  bloque(function () {
    var mes = TG_mes_(0), lin = [];
    ['Emitidas', 'Recibidas'].forEach(function (h) {
      var t = TG_tablaLibro_(c, 'retenciones', h);
      var jP = TG_col_(t.columnas, 'Periodo'), jI = TG_col_(t.columnas, 'Importe retenido S/');
      var fs = t.filas.filter(function (f) { return String(f[jP]).replace(/\D/g, '') === mes; });
      if (fs.length) lin.push(h.toLowerCase() + ' ' + fs.length + ' (S/ ' + TG_num_(fs.reduce(function (s, f) { return s + aNumero_(f[jI]); }, 0)) + ')');
    });
    return lin.length ? '🧾 <b>Retenciones del mes:</b> ' + lin.join(' · ') : '';
  });
  bloque(function () {
    var t = TG_tablaLibro_(c, 'honorarios', 'Recibos');
    var jP = TG_col_(t.columnas, 'Pendiente de pago');
    var pend = jP >= 0 ? t.filas.filter(function (f) { return aNumero_(f[jP]) > 0; }) : [];
    return pend.length ? '🧑‍💼 <b>Honorarios pendientes de pago:</b> ' + pend.length + ' · S/ ' + TG_num_(pend.reduce(function (s, f) { return s + aNumero_(f[jP]); }, 0)) : '';
  });
  bloque(function () {
    if (!cfg.github) return '';
    var ok = 0, mal = [], ultima = '';
    Object.keys(TG_PROYECTOS_).forEach(function (k) {
      var r = TG_ghRuns_(cfg, 1, TG_PROYECTOS_[k].wf)[0];
      if (!r) return;
      if (r.created_at > ultima) ultima = r.created_at;
      if (r.conclusion === 'success' || r.status !== 'completed') ok++; else mal.push(TG_PROYECTOS_[k].nombre.replace(/^\S+\s/, ''));
    });
    if (!ok && !mal.length) return '';
    return '⚙️ <b>Descargas SUNAT:</b> ' + (mal.length ? '❌ con error: ' + TG_esc_(mal.join(', ')) + ' · ' : '') + '✅ ' + ok + ' bien' +
      (ultima ? ' · última ' + TG_cuando_(ultima) : '') + ' (detalle: ⚙️ Últimas descargas)';
  });
  bloque(function () { return TGV_textoResumen_(ss); });
  bloque(function () { var tc = TG_tipoCambio_(); return '💱 <b>Tipo de cambio SUNAT:</b> compra ' + tc.compra.toFixed(3) + ' · venta ' + tc.venta.toFixed(3); });
  return rico ? TG_resumenRico_(partes) : partes.join('\n\n');
}

/** ✨ Las líneas «📬 <b>Tema:</b> detalle» van a una tabla Tema | Detalle; los bloques de varias líneas, como título y lista. */
function TG_resumenRico_(partes) {
  var html = partes[0], filas = [], listas = '';   // una sola tabla de temas; las listas van después
  partes.slice(1).forEach(function (p) {
    if (/^<table/.test(p)) { html += p; return; }
    var lin = String(p).split('\n'), m = lin[0].match(/^(\S+)\s*<b>([^<]+?):?<\/b>:?\s*(.*)$/);
    if (m && lin.length === 1) { filas.push('<tr><td>' + m[1] + ' ' + m[2] + '</td><td>' + m[3] + '</td></tr>'); return; }
    listas += '<h3>' + (m ? m[1] + ' ' + m[2] + (m[3] ? ': ' + m[3] : '') : lin[0]) + '</h3><ul>' + lin.slice(1).map(function (l) { return '<li>' + l.replace(/^\s*[•·-]\s*/, '') + '</li>'; }).join('') + '</ul>';
  });
  if (filas.length) html += '<table bordered striped compact><tr><th>Tema</th><th>Detalle</th></tr>' + filas.join('') + '</table>';
  return html + listas;
}

/* ============================================================ cartera */

function TG_enviarCartera_(ctx, lado, empresa) {
  TG_accion_(ctx.chatId, 'typing');
  var c = TG_ctxDatos_(ctx.ss);
  var ruc = empresa ? TG_rucEmpresa_(c, empresa) : '';
  var nomEmp = ruc ? ANA_nombreEmp_(c, ruc) : '';
  var docs = ANA_docs_(c).filter(function (d) {
    return d.lado === lado && d.saldo > 0.5 && (!ruc || ANA_txtIgual_(d.empresa, nomEmp) || ANA_txtIgual_(d.empresa, ruc));
  });
  var icono = lado === 'Por cobrar' ? '💰' : '💸';
  var ladoC = lado === 'Por cobrar' ? 'c' : 'p';
  if (!docs.length) return TG_enviar_(ctx.chatId, icono + ' <b>' + lado + (nomEmp ? ' · ' + TG_esc_(nomEmp) : '') + ':</b> no hay saldos pendientes. 🎉');
  var html = icono + ' <b>' + lado + (nomEmp ? ' · ' + TG_esc_(nomEmp) : ' · todo el grupo') + '</b>\nSaldo: <b>' + TG_montos_(TG_monedas_(docs)) + '</b> en ' + docs.length + ' documento(s)';
  var venc = docs.filter(function (d) { return d.dias_vencido > 0; });
  if (venc.length) html += '\n⚠️ Vencido: <b>' + TG_montos_(TG_monedas_(venc)) + '</b> (' + venc.length + ')';
  // ✨ La misma información en tablas (mensaje enriquecido); html queda de respaldo.
  var tabla = function (cab, filas) { return '<table bordered striped compact><tr>' + cab.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>' + filas.join('') + '</table>'; };
  var celdas = function (vals) { return '<tr>' + vals.map(function (v, i) { return '<td' + (i && /^(S\/|US\$|[\d—⚠])/.test(String(v).replace(/<[^>]+>/g, '')) ? ' align="right"' : '') + '>' + v + '</td>'; }).join('') + '</tr>'; };
  var rico = '<h2>' + icono + ' ' + lado + (nomEmp ? ' · ' + TG_esc_(nomEmp) : ' · todo el grupo') + '</h2><p>Saldo: <b>' + TG_montos_(TG_monedas_(docs)) + '</b> en ' + docs.length + ' documento(s)' +
    (venc.length ? '<br>⚠️ Vencido: <b>' + TG_montos_(TG_monedas_(venc)) + '</b> (' + venc.length + ')' : '') + '</p>';
  var botones = [];
  if (!ruc) {
    var porEmp = {};
    docs.forEach(function (d) { (porEmp[d.empresa] = porEmp[d.empresa] || []).push(d); });
    var empOrden = Object.keys(porEmp).sort(function (a, b) { return TG_monedas_(porEmp[b]).PEN - TG_monedas_(porEmp[a]).PEN; });
    rico += '<h3>Por empresa</h3>' + tabla(['Empresa', 'Saldo', 'Doc.', 'Vencido'], empOrden.map(function (e) {
      var v = porEmp[e].filter(function (d) { return d.dias_vencido > 0; });
      return celdas([TG_esc_(e), '<b>' + TG_montos_(TG_monedas_(porEmp[e])) + '</b>', porEmp[e].length, v.length ? '⚠️ ' + TG_montos_(TG_monedas_(v)) : '—']);
    }));
    html += '\n\n<b>Por empresa:</b>\n' + empOrden.map(function (e) {
      var v = porEmp[e].filter(function (d) { return d.dias_vencido > 0; });
      return '• <b>' + TG_esc_(e) + '</b>: ' + TG_montos_(TG_monedas_(porEmp[e])) + (v.length ? ' <i>(vencido ' + TG_montos_(TG_monedas_(v)) + ')</i>' : '');
    }).join('\n');
    var fila = [];
    Object.keys(porEmp).forEach(function (e) {
      var r = TG_rucEmpresa_(c, e);
      if (!/^\d{11}$/.test(r)) return;
      fila.push({ text: e, callback_data: 'emp:' + ladoC + ':' + r });
      if (fila.length === 3) { botones.push(fila); fila = []; }
    });
    if (fila.length) botones.push(fila);
  }
  var porContra = {};
  docs.forEach(function (d) { var k = d.ruc + '|' + d.contraparte; (porContra[k] = porContra[k] || []).push(d); });
  var top = Object.keys(porContra).sort(function (a, b) { return TG_monedas_(porContra[b]).PEN + TG_monedas_(porContra[b]).USD * 3.7 - TG_monedas_(porContra[a]).PEN - TG_monedas_(porContra[a]).USD * 3.7; });
  html += '\n\n<b>' + (lado === 'Por cobrar' ? 'Clientes' : 'Proveedores') + ' con más saldo:</b>\n' + top.slice(0, 10).map(function (k, i) {
    var ds = porContra[k];
    var maxV = ds.reduce(function (m, d) { return Math.max(m, d.dias_vencido || 0); }, 0);
    return (i + 1) + '. ' + TG_esc_(TG_nombreCorto_(k.split('|')[1], k.split('|')[0])) + ': <b>' + TG_montos_(TG_monedas_(ds)) + '</b> <i>(' + ds.length + (maxV > 0 ? ', hasta ' + maxV + ' días vencido' : '') + ')</i>';
  }).join('\n') + (top.length > 10 ? '\n<i>… y ' + (top.length - 10) + ' más</i>' : '');
  var N = 15;   // en tabla caben más filas que en el texto
  rico += '<h3>' + (lado === 'Por cobrar' ? 'Clientes' : 'Proveedores') + ' con más saldo</h3>' +
    tabla(['#', lado === 'Por cobrar' ? 'Cliente' : 'Proveedor', 'Saldo', 'Doc.', 'Días vencido'], top.slice(0, N).map(function (k, i) {
      var ds = porContra[k], maxV = ds.reduce(function (m, d) { return Math.max(m, d.dias_vencido || 0); }, 0);
      return celdas([i + 1, TG_esc_(TG_nombreCorto_(k.split('|')[1], k.split('|')[0])), '<b>' + TG_montos_(TG_monedas_(ds)) + '</b>', ds.length, maxV > 0 ? '⚠️ ' + maxV : '—']);
    })) + (top.length > N ? '<p><i>… y ' + (top.length - N) + ' más (📊 Excel con el detalle)</i></p>' : '');
  botones.push([{ text: '📊 Excel con el detalle', callback_data: 'k:' + TG_guardarBoton_({ t: 'cartxls', lado: lado, ruc: ruc }) }]);
  botones.push([{ text: '💬 Analizar con IA', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: 'Analiza las cuentas ' + lado.toLowerCase() + (nomEmp ? ' de ' + nomEmp : ' del grupo') + ': qué está vencido, qué priorizar y qué vouchers sin usar podrían cubrirlas.' }) }]);
  TG_mostrarRico_(ctx, rico, html, botones, true);
}

function TG_excelCartera_(ctx, datos) {
  var c = TG_ctxDatos_(ctx.ss);
  var nomEmp = datos.ruc ? ANA_nombreEmp_(c, datos.ruc) : '';
  var cols = ['empresa', 'ruc', 'contraparte', 'documento', 'emision', 'vence', 'moneda', 'total', 'nc', 'retencion', 'detraccion', 'pagado', 'saldo', 'estado', 'dias_vencido'];
  var docs = ANA_docs_(c).filter(function (d) { return d.lado === datos.lado && d.saldo > 0.5 && (!datos.ruc || ANA_txtIgual_(d.empresa, nomEmp)); })
    .sort(function (a, b) { return (b.dias_vencido || 0) - (a.dias_vencido || 0); });
  var t = { titulo: datos.lado + (nomEmp ? ' ' + nomEmp : ''), columnas: cols, filas: docs.map(function (d) { return cols.map(function (k) { return d[k]; }); }) };
  TG_mandarExcel_(ctx, { tablas: [t], nombre: t.titulo });
}

function TG_enviarVencidas_(ctx, empresa) {
  TG_accion_(ctx.chatId, 'typing');
  var c = TG_ctxDatos_(ctx.ss);
  var cfg = c.op.tg.cfg;
  var ruc = empresa ? TG_rucEmpresa_(c, empresa) : '';
  var hoy = TG_hoy_(), lim = new Date(hoy.getTime() + cfg.diasVence * 86400000);
  var docs = ANA_docs_(c).filter(function (d) { return d.saldo > 0.5 && (!ruc || ANA_txtIgual_(d.empresa, ANA_nombreEmp_(c, ruc))); });
  var html = '⏰ <b>Vencidas y por vencer</b>' + (ruc ? ' · ' + TG_esc_(ANA_nombreEmp_(c, ruc)) : '');
  ['Por cobrar', 'Por pagar'].forEach(function (lado) {
    var ds = docs.filter(function (d) { return d.lado === lado; });
    var venc = ds.filter(function (d) { return d.dias_vencido > 0; }).sort(function (a, b) { return b.dias_vencido - a.dias_vencido; });
    var pronto = ds.filter(function (d) { return d.vence && d.vence >= hoy && d.vence <= lim; }).sort(function (a, b) { return a.vence - b.vence; });
    html += '\n\n' + (lado === 'Por cobrar' ? '💰' : '💸') + ' <b>' + lado + '</b>';
    if (!venc.length && !pronto.length) { html += ': nada vencido ni por vencer ✅'; return; }
    if (venc.length) html += '\n⚠️ Vencido: <b>' + TG_montos_(TG_monedas_(venc)) + '</b> (' + venc.length + ')\n' + venc.slice(0, 8).map(function (d) {
      return '• ' + TG_esc_(d.contraparte.slice(0, 28)) + ' · ' + TG_esc_(d.documento) + ': ' + (/USD/.test(d.moneda) ? 'US$ ' : 'S/ ') + TG_num_(d.saldo) + ' <i>(' + d.dias_vencido + ' d)</i>';
    }).join('\n') + (venc.length > 8 ? '\n<i>… y ' + (venc.length - 8) + ' más</i>' : '');
    if (pronto.length) html += '\n🕒 Vencen en ' + cfg.diasVence + ' días: <b>' + TG_montos_(TG_monedas_(pronto)) + '</b>\n' + pronto.slice(0, 6).map(function (d) {
      return '• ' + TG_esc_(d.contraparte.slice(0, 28)) + ' · ' + TG_esc_(d.documento) + ': ' + TG_num_(d.saldo) + ' <i>(' + TG_fecha_(d.vence) + ')</i>';
    }).join('\n');
  });
  TG_enviar_(ctx.chatId, html, [[{ text: '📊 Excel por cobrar', callback_data: 'k:' + TG_guardarBoton_({ t: 'cartxls', lado: 'Por cobrar', ruc: ruc }) },
    { text: '📊 Excel por pagar', callback_data: 'k:' + TG_guardarBoton_({ t: 'cartxls', lado: 'Por pagar', ruc: ruc }) }]]);
}

/* ============================================================ SUNAT y demás hojas */

/**
 * 📬 Buzón SUNAT. Marca 🆕 lo que llegó en la última descarga (desde la vez anterior que cambió la lista),
 * 🔵 lo no leído y 🔴 lo de cobranza coactiva / embargo. arg: empresa, «sin leer», «nuevas» o «coactivas».
 */
function TG_enviarNotificaciones_(ctx, arg) {
  TG_accion_(ctx.chatId, 'typing');
  arg = String(arg || '').trim();
  var filtro = /sin\s*leer|no\s*le[ií]d/i.test(arg) ? 'sinleer' : /^nuev/i.test(arg) ? 'nuevas' : /coactiv|embargo/i.test(arg) ? 'coactivas' : '';
  var cambiaVista = !!filtro || /^todas$/i.test(arg);   // botones de este mismo mensaje: se cambia el mensaje
  var empresa = cambiaVista ? '' : arg;
  var c = TG_ctxDatos_(ctx.ss);
  var res;
  try { res = TGH_.notificaciones(c, { empresa: empresa, max: 400 }); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ No pude leer la hoja de Notificaciones: ' + TG_esc_(e.message)); }
  if (!res.filas.length) return TG_enviar_(ctx.chatId, '📬 No hay notificaciones' + (empresa ? ' de ' + TG_esc_(empresa) : '') + ' en la hoja.');
  var I = function (n) { return TG_col_(res.columnas, n); };
  var jE = I('Empresa'), jR = I('RUC empresa'), jF = I('Fecha publicación'), jT = I('Tipo de documento'), jN = I('N° documento'), jA = I('Asunto'), jL = I('Leída'), jP = I('PDF'), jC = I('Código');
  var fecha = function (f) { return aFecha_(f[jF]) || null; };
  var filas = res.filas.slice().sort(function (a, b) { return (fecha(b) || 0) - (fecha(a) || 0); });
  var clave = function (f) { return String(jC >= 0 && f[jC] ? f[jC] : [f[jR], f[jN], f[jF]].join('|')); };
  var foto = empresa ? TG_notFoto_(null) : TG_notFoto_(filas.map(clave));   // con empresa solo se consulta (no cambia la foto)
  var esNueva = function (f) { return foto.n.indexOf(clave(f)) >= 0; };
  var sinLeer = function (f) { return jL >= 0 && (!f[jL] || /^(no|false|0)$/i.test(String(f[jL]).trim())); };
  var coact = function (f) { return /coactiva|embargo/i.test(String(f[jT]) + ' ' + String(f[jA])); };
  var cuenta = { nuevas: filas.filter(esNueva).length, sinleer: filas.filter(sinLeer).length, coactivas: filas.filter(coact).length };
  var lista = filas.filter(filtro === 'nuevas' ? esNueva : filtro === 'sinleer' ? sinLeer : filtro === 'coactivas' ? coact : function () { return true; }).slice(0, 15);
  var titulo = { nuevas: '🆕 Nuevas de la última descarga', sinleer: '🔵 Sin leer', coactivas: '🔴 Cobranza coactiva / embargo' }[filtro] || 'Últimas ' + lista.length;
  var marcas = function (f) { return (esNueva(f) ? '🆕' : '') + (coact(f) ? '🔴' : '') + (sinLeer(f) ? '🔵' : ''); };
  var emp = function (f) { return String(f[jE] || '').replace(/\s+(E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?A\.?\s?C\.?|S\.?\s?R\.?\s?L\.?|S\.?\s?A\.?)$/i, ''); };
  var botones = [], fila = [];
  var pdfDe = function (f, i) {
    var pdf = jP >= 0 ? TG_idDrive_(String(f[jP]).split(' ')[0]) : '';
    if (pdf) { fila.push({ text: '📄 ' + (i + 1), callback_data: 'f:' + pdf }); if (fila.length === 5) { botones.push(fila); fila = []; } }
    return pdf;
  };
  var cuandoFoto = foto.f ? Utilities.formatDate(new Date(foto.f), 'America/Lima', 'dd/MM HH:mm') : '';
  var resumen = [cuenta.nuevas ? '🆕 <b>' + cuenta.nuevas + '</b> nueva(s) en la última descarga' + (cuandoFoto ? ' (' + cuandoFoto + ')' : '') : '🆕 nada nuevo en la última descarga',
    '🔵 <b>' + cuenta.sinleer + '</b> sin leer', cuenta.coactivas ? '🔴 <b>' + cuenta.coactivas + '</b> de cobranza coactiva / embargo' : ''].filter(String);
  // respaldo (texto de siempre) y ✨ enriquecido (tabla)
  var html = '📬 <b>Buzón SUNAT · ' + titulo + '</b>' + (empresa ? ' · ' + TG_esc_(empresa) : '') + '\n' + resumen.join('\n') + '\n\n', rico = '';
  if (!lista.length) html += 'No hay notificaciones en esta lista. ✅';
  var filasRico = lista.map(function (f, i) {
    var pdf = pdfDe(f, i), m = marcas(f), asunto = TG_esc_(TG_asunto_(f[jA], f[jT], f[jN]));
    html += (i + 1) + '. ' + (m ? m + ' ' : '') + '<b>' + TG_esc_(emp(f)) + '</b> · ' + TG_fecha_(fecha(f) || f[jF]) + (pdf ? ' · 📄' : '') + '\n   ' + asunto + '\n';
    var dest = esNueva(f) || sinLeer(f) || coact(f);
    return '<tr><td align="center">' + (i + 1) + (m ? '<br>' + m : '') + '</td><td>' + (dest ? '<b>' + TG_esc_(emp(f)) + '</b>' : TG_esc_(emp(f))) + '<br><i>' + TG_fecha_(fecha(f) || f[jF]) + '</i>' + (pdf ? ' 📄' : '') +
      '</td><td>' + (coact(f) ? '<mark>' + asunto + '</mark>' : asunto) + '</td></tr>';
  });
  if (fila.length) botones.push(fila);
  rico = '<h2>📬 Buzón SUNAT · ' + titulo + '</h2>' + (empresa ? '<p><b>' + TG_esc_(empresa) + '</b></p>' : '') + '<ul><li>' + resumen.join('</li><li>') + '</li></ul>' +
    (lista.length ? '<table bordered striped compact><tr><th>#</th><th>Empresa · fecha</th><th>Notificación</th></tr>' + filasRico.join('') + '</table>' : '<p>No hay notificaciones en esta lista. ✅</p>') +
    '<footer>🆕 nueva en la última descarga · 🔵 sin leer · 🔴 coactiva o embargo · 📄 n = mandarme el PDF</footer>';
  var vistas = [];
  if (filtro !== 'nuevas' && cuenta.nuevas) vistas.push({ text: '🆕 Solo nuevas (' + cuenta.nuevas + ')', callback_data: 'c:notificaciones nuevas' });
  if (filtro !== 'sinleer' && cuenta.sinleer) vistas.push({ text: '🔵 Sin leer (' + cuenta.sinleer + ')', callback_data: 'c:notificaciones sin leer' });
  if (filtro !== 'coactivas' && cuenta.coactivas) vistas.push({ text: '🔴 Coactivas (' + cuenta.coactivas + ')', callback_data: 'c:notificaciones coactivas' });
  if (filtro) vistas.push({ text: '📬 Todas', callback_data: 'c:notificaciones todas' });
  for (var v = 0; v < vistas.length; v += 2) botones.push(vistas.slice(v, v + 2));
  botones.push([{ text: '⬇ Revisar el buzón ahora', callback_data: 'dw:e:notificaciones:todas' }]);
  TG_mostrarRico_(ctx, rico, html + (lista.length ? '\n<i>🆕 nueva · 🔵 sin leer · 🔴 coactiva · 📄 n = mandarme el PDF</i>' : ''), botones, !(cambiaVista && ctx.esBoton));
}

/**
 * Qué notificaciones son 🆕: guarda la lista de claves (las 400 más recientes). Cuando aparece alguna que no estaba
 * (llegó una descarga con novedades), esas quedan como «nuevas» hasta la siguiente descarga con novedades.
 * claves=null: solo leer. La primera vez nada es nuevo.
 */
function TG_notFoto_(claves) {
  var props = PropertiesService.getScriptProperties(), k = 'TG_NOT_FOTO';
  var foto; try { foto = JSON.parse(props.getProperty(k) || 'null'); } catch (e) { foto = null; }
  if (!claves) return foto || { v: [], n: [], f: 0 };
  claves = claves.slice(0, 400);
  if (!foto) { foto = { v: claves, n: [], f: 0 }; }
  else {
    var antes = {}; foto.v.forEach(function (x) { antes[x] = 1; });
    var hasta = claves.slice(0, 60).filter(function (x) { return !antes[x]; });   // solo entre las recientes (las viejas que salen del tope no son nuevas)
    if (hasta.length) { foto.n = hasta; foto.f = Date.now(); }
    foto.v = claves;
  }
  try { props.setProperty(k, JSON.stringify(foto)); } catch (e) { foto.v = foto.v.slice(0, 250); try { props.setProperty(k, JSON.stringify(foto)); } catch (e2) {} }
  return foto;
}

function TG_enviarDetracciones_(ctx, empresa) {
  TG_accion_(ctx.chatId, 'typing');
  var c = TG_ctxDatos_(ctx.ss);
  var ruc = empresa ? TG_rucEmpresa_(c, empresa) : '';
  var mes = TG_mes_(0), mesAnt = TG_mes_(1);
  var todas = leerDetraccionesSunat_(c.cfg, []).filas.filter(function (d) { return !ruc || d.adquirienteRuc === ruc || d.proveedorRuc === ruc; });
  var deMes = function (m) { return todas.filter(function (d) { return d.fecha && Utilities.formatDate(d.fecha, 'America/Lima', 'yyyyMM') === m; }); };
  var este = deMes(mes), ant = deMes(mesAnt);
  if (!todas.length) return TG_enviar_(ctx.chatId, '🏦 No hay detracciones en la hoja' + (ruc ? ' de ' + TG_esc_(ANA_nombreEmp_(c, ruc)) : '') + '.');
  var suma = function (l) { return l.reduce(function (s, d) { return s + d.monto; }, 0); };
  var html = '🏦 <b>Detracciones' + (ruc ? ' · ' + TG_esc_(ANA_nombreEmp_(c, ruc)) : '') + '</b>\nEste mes: <b>' + este.length + ' · S/ ' + TG_num_(suma(este)) + '</b>' +
    '\nMes anterior: ' + ant.length + ' · S/ ' + TG_num_(suma(ant));
  if (!ruc && este.length) {
    var porEmp = {};
    este.forEach(function (d) { var k = ANA_nombreEmp_(c, d.adquirienteRuc); porEmp[k] = (porEmp[k] || 0) + d.monto; });
    html += '\n\n<b>Pagadas este mes por empresa:</b>\n' + Object.keys(porEmp).map(function (k) { return '• ' + TG_esc_(k) + ': S/ ' + TG_num_(porEmp[k]); }).join('\n');
  }
  var ult = todas.slice().sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); }).slice(0, 6);
  var botones = [], fila = [];
  html += '\n\n<b>Últimas:</b>\n' + ult.map(function (d, i) {
    if (d.pdf) { fila.push({ text: '📄 ' + (i + 1), callback_data: 'f:' + TG_idDrive_(d.pdf) }); }
    return (i + 1) + '. ' + TG_fecha_(d.fecha) + ' · ' + TG_esc_(String(d.proveedor).slice(0, 28)) + ' · ' + TG_esc_(d.documento) + ': <b>S/ ' + TG_num_(d.monto) + '</b>';
  }).join('\n');
  if (fila.length) botones.push(fila);
  botones.push([{ text: '💬 ¿Qué detracciones faltan pagar?', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: 'Qué facturas de compra con detracción todavía no tienen su depósito de detracción, y qué depósitos no se aplicaron a ninguna factura.' }) }]);
  TG_enviar_(ctx.chatId, html, botones);
}

function TG_enviarRetenciones_(ctx, empresa) {
  TG_accion_(ctx.chatId, 'typing');
  var c = TG_ctxDatos_(ctx.ss);
  var mes = TG_mes_(0), mesAnt = TG_mes_(1);
  var html = '🧾 <b>Retenciones (CRE de SUNAT)</b>' + (empresa ? ' · ' + TG_esc_(empresa) : '');
  try {
    ['Emitidas', 'Recibidas'].forEach(function (h) {
      var r = TGH_.retenciones_sunat(c, { tipo: h, empresa: empresa, max: 2000 });
      var jP = TG_col_(r.columnas, 'Periodo'), jI = TG_col_(r.columnas, 'Importe retenido S/'), jE = TG_col_(r.columnas, 'Empresa');
      var de = function (m) { return r.filas.filter(function (f) { return String(f[jP]).replace(/\D/g, '') === m; }); };
      var s = function (l) { return l.reduce(function (t, f) { return t + aNumero_(f[jI]); }, 0); };
      var e1 = de(mes), e0 = de(mesAnt);
      html += '\n\n<b>' + (h === 'Emitidas' ? '📤 Emitidas (retuvimos)' : '📥 Recibidas (nos retuvieron)') + '</b>\nEste mes: <b>' + e1.length + ' · S/ ' + TG_num_(s(e1)) + '</b> · mes anterior: ' + e0.length + ' · S/ ' + TG_num_(s(e0));
      if (!empresa && e1.length) {
        var pe = {};
        e1.forEach(function (f) { pe[f[jE]] = (pe[f[jE]] || 0) + aNumero_(f[jI]); });
        html += '\n' + Object.keys(pe).map(function (k) { return '• ' + TG_esc_(k) + ': S/ ' + TG_num_(pe[k]); }).join('\n');
      }
    });
  } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ No pude leer Retenciones: ' + TG_esc_(e.message)); }
  TG_enviar_(ctx.chatId, html, [[{ text: '🧾 Por emitir', callback_data: 'c:emitir' },
    { text: '💬 Retenciones por aplicar', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: 'Qué retenciones recibidas de SUNAT no se aplicaron a ninguna factura por cobrar, y qué facturas con retención todavía no tienen su CRE.' }) }]]);
}

function TG_enviarHonorarios_(ctx, empresa) {
  TG_accion_(ctx.chatId, 'typing');
  var c = TG_ctxDatos_(ctx.ss);
  var r;
  try { r = TGH_.honorarios(c, { empresa: empresa, max: 3000 }); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ No pude leer Honorarios: ' + TG_esc_(e.message)); }
  var jP = TG_col_(r.columnas, 'Periodo'), jB = TG_col_(r.columnas, 'Renta bruta'), jR = TG_col_(r.columnas, 'Retención 4ta'), jPend = TG_col_(r.columnas, 'Pendiente de pago'),
    jEm = TG_col_(r.columnas, /^Emisor/), jE = TG_col_(r.columnas, 'Empresa');
  var mes = TG_mes_(0);
  var e1 = r.filas.filter(function (f) { return String(f[jP]).replace(/\D/g, '') === mes; });
  var s = function (l, j) { return l.reduce(function (t, f) { return t + aNumero_(f[j]); }, 0); };
  var pend = jPend >= 0 ? r.filas.filter(function (f) { return aNumero_(f[jPend]) > 0; }) : [];
  var html = '🧑‍💼 <b>Recibos por honorarios recibidos</b>' + (empresa ? ' · ' + TG_esc_(empresa) : '') +
    '\nEste mes: <b>' + e1.length + '</b> · renta bruta S/ ' + TG_num_(s(e1, jB)) + ' · retención 4ta S/ ' + TG_num_(s(e1, jR)) +
    (pend.length ? '\n\n⏳ <b>Pendientes de pago: ' + pend.length + ' · S/ ' + TG_num_(s(pend, jPend)) + '</b>\n' + pend.slice(0, 8).map(function (f) {
      return '• ' + TG_esc_(String(f[jEm]).slice(0, 30)) + ' (' + TG_esc_(f[jE]) + '): S/ ' + TG_num_(aNumero_(f[jPend]));
    }).join('\n') : '\n\n✅ Sin recibos pendientes de pago.');
  // 🤝 Si ya se concilió con los vouchers, lo pendiente sale de ahí (más exacto que el dato de SUNAT).
  try {
    var pp = TGH_.honorarios_conciliacion(c, { tipo: 'por_pagar', empresa: empresa, max: 300 });
    if (pp.filas.length) {
      var kE = TG_col_(pp.columnas, 'Emisor'), kN = TG_col_(pp.columnas, 'Neto pendiente'), kD = TG_col_(pp.columnas, 'Días');
      html += '\n\n💸 <b>Por pagar según los vouchers: S/ ' + TG_num_(s(pp.filas, kN)) + '</b> (' + pp.filas.length + ' emisor(es))\n' +
        pp.filas.slice(0, 8).map(function (f) { return '• ' + TG_esc_(String(f[kE]).slice(0, 30)) + ': S/ ' + TG_num_(aNumero_(f[kN])) + (f[kD] !== '' ? ' · ' + f[kD] + ' días' : ''); }).join('\n');
    }
    var sr = TGH_.honorarios_conciliacion(c, { tipo: 'sin_recibo', empresa: empresa, max: 300 });
    if (sr.filas.length) html += '\n❓ ' + sr.filas.length + ' pago(s) a personas sin recibo por honorarios.';
  } catch (e) {}
  TG_enviar_(ctx.chatId, html);
}

function TG_enviarTipoCambio_(ctx) {
  try {
    var tc = TG_tipoCambio_();
    TG_enviar_(ctx.chatId, '💱 <b>Tipo de cambio SUNAT · ' + TG_esc_(tc.fecha) + '</b>\nCompra: <b>' + tc.compra.toFixed(3) + '</b>\nVenta: <b>' + tc.venta.toFixed(3) + '</b>');
  } catch (e) { TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
}

function TG_actualizarCobranzas_(ctx) {
  var id = TG_enviar_(ctx.chatId, '🔄 <i>Recalculando Cuentas por Cobrar y Pagar (SIRE, vouchers, retenciones, detracciones)…</i>');
  TG_accion_(ctx.chatId, 'typing');
  var r;
  try { r = actualizarTodo_(true); } catch (e) { r = '❌ ' + e.message; }
  TG_editar_(ctx.chatId, id, '🔄 <b>Cobranzas recalculada</b>\n' + TG_esc_(r), [[{ text: '📊 Ver resumen', callback_data: 'c:resumen' }]]);
}

/* ============================================================ avisos (cada persona) */

function TG_enviarAvisos_(ctx, cambiar) {
  var u = TG_usuario_(ctx.ss, ctx.chatId) || ctx.usuario;
  var avisos = u.avisos.slice();
  if (cambiar) {
    var i = avisos.indexOf(cambiar);
    if (i >= 0) avisos.splice(i, 1); else avisos.push(cambiar);
    TG_guardarAvisos_(ctx.ss, u, avisos);
  }
  var cfg = TG_cfg_(ctx.ss);
  var vig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'TG_vigia'; });
  var teclado = TG_AVISOS_.map(function (a) { return [{ text: (avisos.indexOf(a[0]) >= 0 ? '✅ ' : '⬜ ') + a[1], callback_data: 'av:' + a[0] }]; });
  teclado.push([{ text: 'Listo', callback_data: 'x' }]);
  var html = '🔔 <b>Mis avisos</b> · toque para activar o desactivar.' + (cfg.horaResumen >= 0 ? '\nEl ☀️ resumen llega a las ' + cfg.horaResumen + ':00.' : '') +
    (!vig || !cfg.avisosActivos ? '\n\n⚠️ <i>Los avisos automáticos están apagados en la hoja (menú 🤖 Telegram → 🔔 Activar avisos).</i>' : '');
  if (cambiar && ctx.msgId) TG_editar_(ctx.chatId, ctx.msgId, html, teclado);
  else TG_enviar_(ctx.chatId, html, teclado);
}

/* ============================================================ recordatorios */

var TG_ENC_REC_ = ['ID', 'Chat', 'Cuándo', 'Texto', 'Repetir', 'Estado', 'Creado'];

function TG_hojaRec_(ss) {
  var sh = ss.getSheetByName(TG_HOJA_REC_);
  if (!sh) {
    sh = ss.insertSheet(TG_HOJA_REC_);
    sh.getRange(1, 1, 1, TG_ENC_REC_.length).setValues([TG_ENC_REC_]).setFontWeight('bold');
    sh.getRange('A:B').setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}

function TG_crearRecordatorio_(ss, chatId, cuando, texto, repetir) {
  if (!texto) throw new Error('falta el texto del recordatorio');
  repetir = /dia|diar/i.test(repetir || '') ? 'diario' : /seman/i.test(repetir || '') ? 'semanal' : /mes|mensu/i.test(repetir || '') ? 'mensual' : 'no';
  var sh = TG_hojaRec_(ss);
  var id = 'R' + Utilities.formatDate(new Date(), 'America/Lima', 'MMddHHmmss') + Math.floor(Math.random() * 10);
  sh.appendRow([id, String(chatId), cuando, texto, repetir, 'pendiente', new Date()]);
  TG_programarRecordatorio_(ss);
  return { id: id, texto: texto, repetir: repetir };
}

function TG_recordatorios_(ss, chatId) {
  var sh = TG_hojaRec_(ss);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, TG_ENC_REC_.length).getValues().map(function (r, i) {
    return { fila: i + 2, id: String(r[0]), chat: String(r[1]), cuando: r[2] instanceof Date ? r[2] : TG_fechaHora_(r[2]), texto: String(r[3]), repetir: String(r[4] || 'no'), estado: String(r[5]) };
  }).filter(function (r) { return r.estado === 'pendiente' && (!chatId || r.chat === String(chatId)); })
    .sort(function (a, b) { return a.cuando - b.cuando; });
}

function TG_enviarRecordatorios_(ctx) {
  var rs = TG_recordatorios_(ctx.ss, ctx.chatId);
  var teclado = rs.slice(0, 15).map(function (r) {
    return [{ text: '🗑 ' + TG_fechaHoraTxt_(r.cuando).slice(0, 16) + ' · ' + r.texto.slice(0, 30), callback_data: 'k:' + TG_guardarBoton_({ t: 'recq', id: r.id }) }];
  });
  teclado.push([{ text: '➕ Nuevo recordatorio', callback_data: 'c:recordar' }]);
  TG_enviar_(ctx.chatId, rs.length ? '⏰ <b>Sus recordatorios</b> (' + rs.length + ')\n' + rs.slice(0, 15).map(function (r) {
    return '• <b>' + TG_fechaHoraTxt_(r.cuando) + '</b> · ' + TG_esc_(r.texto) + (r.repetir !== 'no' ? ' <i>(' + r.repetir + ')</i>' : '');
  }).join('\n') + '\n\n<i>Toque uno para borrarlo.</i>' : '⏰ No tiene recordatorios. Dígame por ejemplo: <i>"recuérdame el viernes 10am revisar las detracciones de BKF"</i>.', teclado);
}

function TG_quitarRecordatorio_(ctx, id) {
  var r = TG_recordatorios_(ctx.ss, ctx.chatId).filter(function (x) { return x.id === id; })[0];
  if (!r) return TG_enviar_(ctx.chatId, 'Ese recordatorio ya no existe.');
  TG_hojaRec_(ctx.ss).getRange(r.fila, 6).setValue('borrado');
  TG_programarRecordatorio_(ctx.ss);
  TG_enviar_(ctx.chatId, '🗑 Borrado: ' + TG_esc_(r.texto));
}

/** Un solo disparador, a la hora del recordatorio más próximo. */
function TG_programarRecordatorio_(ss) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TG_recordar') ScriptApp.deleteTrigger(t); });
  var rs = TG_recordatorios_(ss, null);
  if (!rs.length) return;
  var cuando = new Date(Math.max(rs[0].cuando.getTime(), Date.now() + 60000));
  ScriptApp.newTrigger('TG_recordar').timeBased().at(cuando).create();
}

/** Disparador: manda los recordatorios que ya tocan. */
function TG_recordar() {
  var ss = TG_ss_();
  var sh = TG_hojaRec_(ss);
  TG_recordatorios_(ss, null).forEach(function (r) {
    if (r.cuando.getTime() > Date.now() + 90000) return;
    TG_enviar_(r.chat, '⏰ <b>Recordatorio</b>\n' + TG_esc_(r.texto), [[{ text: '💬 Ayúdame con esto', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: r.texto }, 86400) }]]);
    if (r.repetir === 'no') { sh.getRange(r.fila, 6).setValue('enviado'); return; }
    var n = new Date(r.cuando.getTime());
    do {
      if (r.repetir === 'diario') n.setDate(n.getDate() + 1);
      else if (r.repetir === 'semanal') n.setDate(n.getDate() + 7);
      else n.setMonth(n.getMonth() + 1);
    } while (n.getTime() < Date.now());
    sh.getRange(r.fila, 3).setValue(n);
  });
  TG_programarRecordatorio_(ss);
}
