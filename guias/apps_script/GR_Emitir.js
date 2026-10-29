/**
 * 🚚 Guías — 👁 Vista previa y ✅ Emitir desde la hoja, con los mismos robots que usa el bot de Telegram/WhatsApp:
 *   Quesito (gre-quesito.yml, desde la factura) o SUNAT SOL (gre-sunat.yml), según la columna "Emitir en".
 *
 * La fila se manda al bot de Cobranzas (?canal=gr) como un caso de guía (el mismo de Telegram/WhatsApp): allí se piden
 * los robots y se guarda el resultado. La foto de la vista previa llega también al Telegram del administrador, con su ✅.
 * Cada minuto, mientras haya guías en curso, la hoja trae el resultado (Estado, N° de guía, PDF, mensaje).
 * Emitir: solo con la fila "✅ Lista para emitir" y confirmando aquí; el robot emite solo si el caso no cambió.
 * Funciones GR_.
 */

var GR_COB_URL_ = '__COBRANZAS_URL__';   // aplicación web de Cobranzas: la pone el despliegue (deploy-guias.yml)

var GR_MOTIVO_CASO_ = { '01': 'Venta', '02': 'Compra', '04': 'Traslado entre establecimientos de la misma empresa', '05': 'Consignación',
  '06': 'Devolución', '13': 'Otros' };

function GR_menuVista() { GR_pedirRobot_('vista'); }
function GR_menuEmitir() { GR_pedirRobot_('emitir'); }

/* ---------------- conexión con Cobranzas ---------------- */

function GR_cob_(accion, cuerpo, token) {
  if (!/^https:\/\/script\.google\.com\//.test(GR_COB_URL_)) throw new Error('falta la dirección del bot de Cobranzas (vuelva a desplegar la hoja de Guías).');
  var r = UrlFetchApp.fetch(GR_COB_URL_ + '?canal=gr&accion=' + encodeURIComponent(accion) + '&token=' + encodeURIComponent(token || GR_claveCob_()), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo || {}), muteHttpExceptions: true, followRedirects: true });
  try { return JSON.parse(r.getContentText()); }
  catch (e) { return { ok: false, error: 'el bot no respondió bien (HTTP ' + r.getResponseCode() + '; quizá se estaba actualizando). Intente en un minuto.' }; }
}

// Clave entre esta hoja y Cobranzas: se crea y registra sola la primera vez.
function GR_claveCob_() {
  var p = PropertiesService.getScriptProperties(), k = p.getProperty('GR_COB_CLAVE');
  if (k) return k;
  k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var r = GR_cob_('registrar', {}, k);
  if (!r || !r.ok) throw new Error('No pude conectar con el bot de Cobranzas: ' + ((r && r.error) || 'sin respuesta'));
  p.setProperty('GR_COB_CLAVE', k);
  return k;
}

/* ---------------- la fila → caso del bot ---------------- */

function GR_casoDeFila_(r, ctx) {
  var t = function (k) { return String(r[k] == null ? '' : r[k]).trim(); };
  var emp = ctx.emp[t('empresa')], mot = t('motivo').slice(0, 2);
  if (!emp) throw new Error('la empresa no está en 🏢 Empresas.');
  if (!GR_MOTIVO_CASO_[mot]) throw new Error('el motivo ' + t('motivo') + ' todavía no lo hacen los robots.');
  var dma = function (k) { return r[k] instanceof Date ? Utilities.formatDate(r[k], Session.getScriptTimeZone(), 'dd/MM/yyyy') : t(k); };
  var fecha = dma('fecha');
  var peso = Number(r.peso) || 0;
  if (/^TNE/.test(t('upeso'))) peso = peso * 1000;
  var prods = (ctx.prod[t('id')] || []).map(function (p) { return { descripcion: String(p.desc || ''), unidad: String(p.unidad || 'NIU'), cantidad: Number(p.cant) || 0 }; });
  var punto = function (x) {
    return { ruc: '', direccion: t(x + 'dir'), ubigeo: GR_codUbigeo_(t(x + 'ubi')), codigo_local: t(x + 'est') };
  };
  var privado = t('modalidad').slice(0, 2) === '02';
  var placas = [t('placa'), t('placa2')].map(function (p) { return p.toUpperCase().replace(/[^A-Z0-9]/g, ''); }).filter(String);
  var transporte = privado || placas.length || t('cdni') ? {
    modo: privado ? 'privado' : 'publico', ruc: t('truc').replace(/\D/g, ''), nombre: t('tnom'), mtc: t('mtc'),
    placas: placas, constancias: [t('mtcveh')].concat(t('placa2') ? [t('mtcveh2')] : []).map(function (x) { return x.replace(/\s/g, ''); }),   // en el orden de las placas
    registrar_vehiculos: privado || !!(placas.length && t('cdni')),   // público: opcional, se registran si hay placa y chofer
    conductores: t('cdni') ? [{ dni: t('cdni').replace(/\D/g, ''), nombre: (t('cape') ? t('cape') + ', ' : '') + t('cnom'), licencia: t('clic') }] : []
  } : { modo: 'publico', ruc: t('truc').replace(/\D/g, ''), nombre: t('tnom'), mtc: t('mtc'), placas: [], conductores: [], constancias: [] };
  var doc = t('docrel') || 'Factura', quesito = t('via') !== 'SUNAT';
  var pedido = quesito ? GR_partirPedido_(t('pedido')) : [];
  if (pedido.length) prods = [];   // "Producto y cantidad" manda sobre 📦 Productos (el robot lo busca en la factura de Quesito)
  var conFactura = doc !== 'Ninguno' && t('serie') && t('numero');
  return {
    empresa_ruc: emp.ruc, motivo: GR_MOTIVO_CASO_[mot], contraparte: { ruc: t('ndest').replace(/\D/g, ''), nombre: t('dest') },
    documento: !conFactura ? null : { tipo: doc === 'Boleta' ? 'Boleta de Venta' : 'Factura', numero: t('serie').toUpperCase() + '-' + t('numero'), ruc_emisor: emp.ruc },
    bienes: prods, todo_factura: t('total').toUpperCase() !== 'NO' && doc !== 'Ninguno' && !pedido.length, peso_kg: peso, bultos: Number(r.bultos) || null,
    cotizacion: quesito && !conFactura ? t('cotizacion').replace(/\D/g, '') : '', pedido: pedido.length ? t('pedido') : '',
    partida: punto('p'), llegada: punto('l'), transporte: transporte, fecha: fecha, observaciones: t('obsFinal') || t('obs'),
    via: quesito ? 'quesito' : '',
    fecha_emision: quesito ? dma('femision') : '', fecha_entrega: dma('fentrega')
  };
}

/* ---------------- 👁 / ✅ desde el menú ---------------- */

function GR_pedirRobot_(modo) {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet();
  if (sh.getName() !== GR_HOJA_ || sh.getActiveRange().getRow() < GR_FILA1_) return ui.alert('Seleccione una fila de la pestaña ' + GR_HOJA_ + '.');
  var fila = sh.getActiveRange().getRow(), x = GR_leerGuias_(sh, fila, fila)[0], r = x.r, ctx = GR_contexto_(ss);
  if (!r.id) return ui.alert('Esa fila está vacía.');
  if (String(r.estado).indexOf(GR_ESTADOS_.EMITIDA) === 0) return ui.alert('La guía ' + r.id + ' ya está emitida (' + r.guia + ').');
  if (String(r.estado).indexOf(GR_ESTADOS_.EMITIENDO) === 0) return ui.alert('La guía ' + r.id + ' se está emitiendo: espere el resultado (🔄).');
  var v = GR_validar_(r, ctx);
  if (v.faltas.length) return ui.alert('Antes complete: ' + v.faltas.join(', ') + '.');
  var donde = String(r.via) === 'SUNAT' ? 'SUNAT SOL' : 'Quesito';
  if (modo === 'emitir') {
    var ok = ui.alert('✅ Emitir la guía ' + r.id + ' en ' + donde,
      'Es una operación REAL ante SUNAT. Empresa ' + r.empresa + ' · ' + (r.numero ? r.docrel + ' ' + r.serie + '-' + r.numero : 'cotización ' + r.cotizacion) + ' · ' + (r.dest || '(cliente de la factura)') +
      '\nLlegada: ' + r.ldir + '\n\nSe emite tal como está la fila ahora (si después la cambia, no se emite). ¿Emitir?', ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
  }
  var caso;
  try { caso = GR_casoDeFila_(r, ctx); } catch (e) { return ui.alert('No se puede pedir: ' + e.message); }
  var c = GR_cob_('caso', { caso: String(r.caso || ''), hoja: r.id, datos: caso });
  if (!c.ok) return ui.alert('El bot no aceptó la guía: ' + (c.error || '') + ((c.faltan || []).length ? '\n' + c.faltan.join('\n') : ''));
  var p = GR_cob_('pedir', { caso: c.caso, modo: modo });
  var col = function (k) { return GR_col_(k); };
  sh.getRange(fila, col('caso')).setValue(c.caso);
  if (!p.ok) {
    sh.getRange(fila, col('msg')).setValue('⚠️ ' + (p.error || 'no se pudo pedir'));
    return ui.alert('No se pudo pedir al robot: ' + (p.error || ''));
  }
  if (p.vivo && p.donde !== 'pc') GR_abrirVivo_(p.vivo, r.id);   // 📺 modo en vivo activo (en la PC se ve el Chrome mismo)
  if (p.donde === 'pc') ss.toast('🖥 Se hace en su PC: mire la ventana de Chrome que se abre (no la use mientras trabaja).', '🚚 Guías', 10);
  else if (p.pc_motivo) ss.toast('🖥 No pude usar su PC (' + p.pc_motivo + '): se hace en GitHub.', '🚚 Guías', 10);
  var ahora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm');
  sh.getRange(fila, col('estado')).setValue(modo === 'emitir' ? GR_ESTADOS_.EMITIENDO + ' en ' + donde + ' (' + ahora + ')' : GR_ESTADOS_.VISTA + ' pedida en ' + donde + ' (' + ahora + ')');
  sh.getRange(fila, col('msg')).setValue(modo === 'emitir' ? 'Emitiendo… el resultado llega aquí solo (en 1–2 min) y al Telegram del administrador.'
    : 'Preparando la vista previa (no se emite). La foto llega al Telegram del administrador y aquí el enlace, en 2–4 min.');
  sh.getRange(fila, col('actualizado')).setValue(new Date());
  GR_programarRevision_();
  ss.toast(modo === 'emitir' ? 'Emitiendo la guía ' + r.id + ' en ' + donde + '…' : 'Vista previa de ' + r.id + ' en ' + donde + ' (no se emite)…', '🚚 Guías', 8);
}

/* ---------------- resultados (cada minuto mientras haya guías en curso) ---------------- */

function GR_programarRevision_() {
  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'GR_revisarResultados'; });
  if (!hay) ScriptApp.newTrigger('GR_revisarResultados').timeBased().everyMinutes(1).create();
}

function GR_menuResultados() { var n = GR_revisarResultados(); SpreadsheetApp.getActive().toast(n ? n + ' guía(s) en curso.' : 'No hay guías en curso.', '🚚 Guías', 5); }

/** Trae del bot el estado de las guías en curso. Devuelve cuántas siguen en curso (sin ninguna, se apaga solo). */
function GR_revisarResultados() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(GR_HOJA_), ult = sh.getLastRow();
  if (ult < GR_FILA1_) return 0;
  var filas = GR_leerGuias_(sh, GR_FILA1_, ult).filter(function (x) {
    var e = String(x.r.estado);
    return x.r.caso && (e.indexOf(GR_ESTADOS_.VISTA) === 0 || e.indexOf(GR_ESTADOS_.EMITIENDO) === 0 || String(x.r.msg).indexOf('📥 Leyendo') === 0);
  });
  if (!filas.length) { GR_apagarRevision_(); return 0; }
  var r = GR_cob_('estado', { casos: filas.map(function (x) { return String(x.r.caso); }) });
  if (!r.ok) return filas.length;
  var enCurso = 0, col = function (k) { return GR_col_(k); };
  filas.forEach(function (x) {
    var e = (r.casos || {})[String(x.r.caso)];
    if (!e) return;
    var poner = function (k, v) { if (String(x.r[k]) !== String(v)) sh.getRange(x.fila, col(k)).setValue(v); };
    var donde = e.via === 'quesito' ? 'Quesito' : 'SUNAT';
    if (String(x.r.msg).indexOf('📥 Leyendo') === 0) {   // 📥 Traer de Quesito (no se emitió nada)
      if (e.estado === 'Leído de Quesito' && e.leido) {
        var m;
        try { m = GR_aplicarLeido_(ss, x.fila, e.leido); } catch (err) { m = '⚠️ 📥 Quesito leyó la factura pero no pude completar la fila: ' + err.message; }
        sh.getRange(x.fila, col('msg')).setValue(m);
      } else if (e.estado === 'No leído') sh.getRange(x.fila, col('msg')).setValue('⚠️ 📥 ' + String(e.error || 'no se pudo leer en Quesito').slice(0, 480));
      else enCurso++;
      sh.getRange(x.fila, col('actualizado')).setValue(new Date());
      return;
    }
    if (e.estado === 'Emitida') {
      poner('estado', GR_ESTADOS_.EMITIDA); poner('guia', e.gre || ''); poner('sunat', 'Emitida en ' + donde);
      if (!x.r.femi) poner('femi', new Date());
      if (e.pdf) sh.getRange(x.fila, col('pdf')).setFormula('=HYPERLINK("' + e.pdf + '";"📄 PDF")');
      poner('msg', '✅ Guía ' + (e.gre || '') + ' emitida en ' + donde + '.');
      GR_registrar_(x.r.id, 'Emitida', e.gre || '');
    } else if (e.estado === 'Vista previa lista') {
      poner('estado', GR_ESTADOS_.VISTA + ' lista en ' + donde + ' (no emitida)');
      poner('msg', '👁 Revise la foto' + (e.imagen ? ' (' + e.imagen + ')' : ' en el Telegram del administrador') + '. Si está bien: 🚚 Guías → ✅ Emitir.');
      // La primera vez se avisa; después deja de revisar (si la aprueban en Telegram, 🔄 Traer resultados lo trae).
      if (String(x.r.estado).indexOf('lista en') < 0) enCurso++;
    } else if (e.estado === 'No emitida' || e.estado === 'Descartada') {
      poner('estado', GR_ESTADOS_.ERROR + ' · ' + String(e.error || e.estado).slice(0, 120));
      poner('msg', '⚠️ ' + String(e.error || e.estado).slice(0, 480));
    } else enCurso++;
    poner('actualizado', new Date());
  });
  if (!enCurso) GR_apagarRevision_();
  return enCurso;
}

function GR_apagarRevision_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'GR_revisarResultados') ScriptApp.deleteTrigger(t); });
}

/* ---------------- 📺 ver el robot en vivo (la pantalla de Quesito / SUNAT mientras trabaja) ---------------- */

function GR_menuEnVivo() {
  var ui = SpreadsheetApp.getUi(), r = GR_cob_('vivo', {});
  if (!r.ok) return ui.alert('No pude hablar con el bot: ' + (r.error || ''));
  var si = ui.alert('📺 Ver el robot en vivo', 'Ahora está ' + (r.activo ? 'ACTIVADO' : 'DESACTIVADO') + '.\n\n' +
    'Activado: cada vez que el robot llene una guía (vista previa, emitir o leer la factura) se abre una ventana con la pantalla del robot, ' +
    'que se actualiza sola cada 2–3 segundos (solo se mira, no se toca nada). Vale también para Telegram y WhatsApp.\n\n¿' +
    (r.activo ? 'Desactivarlo' : 'Activarlo') + '?', ui.ButtonSet.YES_NO);
  if (si !== ui.Button.YES) return;
  var x = GR_cob_('vivo', { activar: !r.activo });
  SpreadsheetApp.getActive().toast(x.ok ? (x.activo ? '📺 En vivo ACTIVADO' : 'En vivo desactivado') : '⚠️ ' + (x.error || ''), '🚚 Guías', 6);
}

function GR_menuAbrirVivo() {
  var u = PropertiesService.getDocumentProperties().getProperty('GR_VIVO_URL');
  if (!u) return SpreadsheetApp.getUi().alert('Todavía no hay transmisión. Active 📺 Ver el robot en vivo y pida una vista previa, emitir o traer datos.');
  GR_abrirVivo_(u, '');
}

function GR_abrirVivo_(url, id) {
  PropertiesService.getDocumentProperties().setProperty('GR_VIVO_URL', url);
  var e = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var h = '<div style="font-family:Arial;font-size:13px;margin-bottom:6px">El robot arranca en 1–2 min. ' +
    '<a href="' + e(url) + '" target="_blank">Abrir en pestaña aparte ↗</a> (más grande)</div>' +
    '<iframe src="' + e(url) + '" style="width:100%;height:600px;border:1px solid #cfd8dc;border-radius:6px"></iframe>';
  SpreadsheetApp.getUi().showModelessDialog(HtmlService.createHtmlOutput(h).setWidth(1000).setHeight(680), '📺 Robot en vivo' + (id ? ' · guía ' + id : ''));
}

/* ---------------- 🖥 Quesito en la PC (ejecutor pc-quesito: Chrome visible en la pantalla) ---------------- */

function GR_menuEnPc() {
  var ui = SpreadsheetApp.getUi(), r = GR_cob_('pc', {});
  if (!r.ok) return ui.alert('No pude hablar con el bot: ' + (r.error || ''));
  var e = r.estado || {};
  var si = ui.alert('🖥 Quesito en mi PC', 'Ahora está ' + (r.activo ? 'ACTIVADO' : 'DESACTIVADO') + '. La PC: ' + (e.ok ? '🟢 ' : '⚪ ') + (e.motivo || '?') + '.\n\n' +
    'Activado: las guías por Quesito (vista previa, emitir, traer datos) se hacen en su PC, con Chrome visible, mientras esté abierta la ventana ' +
    '«Robot de guías» (run.cmd). Si la PC está apagada, se usa GitHub como siempre. La primera vez inicie sesión en Quesito en esa ventana de Chrome.' +
    '\n\n¿' + (r.activo ? 'Desactivarlo' : 'Activarlo') + '?', ui.ButtonSet.YES_NO);
  if (si !== ui.Button.YES) return;
  var x = GR_cob_('pc', { activar: !r.activo });
  SpreadsheetApp.getActive().toast(x.ok ? (x.activo ? '🖥 Quesito en su PC: ACTIVADO' : 'Quesito en GitHub (PC desactivada)') : '⚠️ ' + (x.error || ''), '🚚 Guías', 6);
}
