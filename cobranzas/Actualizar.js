/**
 * Actualizar.js
 * Orquesta una actualizacion completa: lee fuentes → ejecuta el motor →
 * escribe las hojas. Se ejecuta sola cada 10 minutos (solo si algo cambio:
 * vouchers, SIRE, registro manual, marcas ✔/✖ o configuracion) y desde el
 * menu 💼 Cobranzas → 🔄 Actualizar ahora.
 */

function actualizacionAutomatica() {
  try {
    actualizarTodo_(false);
  } catch (e) {
    Logger.log('Error en actualizacion automatica: ' + e.message + '\n' + e.stack);
  }
}

// Subir este numero cuando cambie la forma de calcular o escribir, para que la
// siguiente actualizacion automatica rehaga todo aunque los datos no cambien.
var VERSION_CALCULO_ = '3';

function huellaExterna_(ss, cfg, liqs) {
  var partes = ['v' + VERSION_CALCULO_, Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd')]; // cambia de dia: recalcular vencidos
  try { partes.push(DriveApp.getFileById(cfg.idVouchers).getLastUpdated().getTime()); } catch (e) { partes.push('sin-vouchers'); }
  liqs.forEach(function (l) { partes.push(l.id + ':' + l.actualizado); });
  var man = ss.getSheetByName(HOJA.MANUAL);
  if (man && man.getLastRow() > 1) partes.push(hashTexto_(JSON.stringify(man.getRange(2, 1, man.getLastRow() - 1, 10).getDisplayValues())));
  var conf = ss.getSheetByName(HOJA.CONFIG);
  if (conf) partes.push(hashTexto_(JSON.stringify(conf.getDataRange().getDisplayValues())));
  return partes.join('#');
}

function huellaMarcas_(ss) {
  var sh = ss.getSheetByName(HOJA.CONC);
  if (!sh || sh.getLastRow() < 2) return '';
  var v = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  var marcadas = [];
  v.forEach(function (r, i) { if (r[0] === true || r[1] === true) marcadas.push(i + ':' + r[0] + r[1]); });
  return marcadas.join(',');
}

function actualizarTodo_(forzar) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'Ya hay una actualización en curso; intenta en un minuto.';
  var inicio = Date.now();
  try {
    return actualizarTodoInterno_(forzar);
  } catch (e) {
    try { bitacora_(ssPrincipal_(), 'ERROR', inicio, e.message + ' | ' + String(e.stack || '').slice(0, 400)); } catch (e2) { /* sin bitacora */ }
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function actualizarTodoInterno_(forzar) {
  {
    var ss = ssPrincipal_();
    // La hoja debe estar en hora de Peru; si no, las fechas se ven un dia antes.
    if (ss.getSpreadsheetTimeZone() !== 'America/Lima') ss.setSpreadsheetTimeZone('America/Lima');
    var props = PropertiesService.getDocumentProperties();
    var cfg = leerConfig_(ss);
    var liqs = buscarLiquidaciones_(cfg);
    var huella = huellaExterna_(ss, cfg, liqs) + '|' + huellaMarcas_(ss);
    if (!forzar && huella === props.getProperty('huella')) return 'Sin cambios.';

    var t0 = Date.now();
    bitacora_(ss, 'Inicio', t0, forzar ? 'manual' : 'automática');
    var decisiones = leerYGuardarDecisiones_(ss);
    var docs = leerDocumentosSire_(cfg, liqs).filter(function (d) {
      var t = normTipo_(d.tipo);
      if (t === '07' || t === '08') return true; // notas: siempre (se aplican a su factura)
      if (cfg.tipos.indexOf(t) === -1) return false;
      return !cfg.desde || !d.fecha || d.fecha >= cfg.desde;
    });
    var vch = leerVouchers_(cfg);
    var manual = leerRegistroManual_(ss);

    var res = ejecutarCruce_({
      docs: docs, pagos: vch.pagos.concat(manual), decisiones: decisiones,
      grupo: cfg.grupo, alias: cfg.aliasNombre, categorias: cfg.categorias,
      opciones: { modo: cfg.modo, tolerancia: cfg.tolerancia, diasVentana: cfg.ventana },
    });
    vch.duplicados.forEach(function (d) {
      res.errores.unshift({ tipo: 'Voucher repetido', detalle: 'Mismo banco, operación, fecha y monto que ' + d.otra + ' (se tomó solo una vez)', fuente: d.fuente });
    });

    bitacora_(ss, 'Lectura y cruce', t0, docs.length + ' docs SIRE, ' + vch.pagos.length + ' vouchers, ' + manual.length + ' manuales');

    var hoy = new Date();
    var filasDocs = construirFilasDocumentos_(res, cfg, hoy);
    var t1 = Date.now();
    escribirDocumentos_(ss, filasDocs); bitacora_(ss, 'Documentos', t1, filasDocs.length + ' filas'); t1 = Date.now();
    escribirPanel_(ss, filasDocs, res, cfg, liqs); bitacora_(ss, 'Panel', t1, ''); t1 = Date.now();
    escribirMovimientos_(ss, res, cfg); bitacora_(ss, 'Movimientos', t1, res.movimientos.length + ' filas'); t1 = Date.now();
    escribirConciliar_(ss, res, cfg); bitacora_(ss, 'Conciliar', t1, res.sugerencias.length + ' sugerencias, ' + res.errores.length + ' avisos, ' + res.sinCruzar.length + ' sin cruzar'); t1 = Date.now();
    escribirOtrosPagos_(ss, res, cfg); bitacora_(ss, 'Otros pagos', t1, res.sinFactura.length + ' pagos sin factura'); t1 = Date.now();
    if (Date.now() - t0 < 300000) {
      try { renderConsulta_(ss); bitacora_(ss, 'Consulta', t1, ''); } catch (e) { bitacora_(ss, 'Consulta ERROR', t1, e.message); }
    } else {
      bitacora_(ss, 'Consulta omitida', t1, 'poco tiempo restante; se redibuja al cambiar un selector');
    }

    props.setProperty('huella', huellaExterna_(ss, cfg, liqs) + '|' + huellaMarcas_(ss));
    props.setProperty('ultimaActualizacion', new Date().toISOString());
    var aplicados = res.pagos.filter(function (p) { return p.aplicado && p.modalidad === MODALIDAD.PAGO; }).length;
    return 'Listo en ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + filasDocs.length + ' documentos de ' + liqs.length +
      ' liquidaciones, ' + aplicados + ' vouchers cruzados, ' + res.sugerencias.length + ' sugerencias por revisar.';
  }
}

/** Registra una etapa en la hoja oculta _Registro (para revisar tiempos y errores). */
function bitacora_(ss, etapa, desde, detalle) {
  var sh = ss.getSheetByName('_Registro');
  if (!sh) {
    sh = ss.insertSheet('_Registro');
    sh.getRange(1, 1, 1, 4).setValues([['Fecha', 'Etapa', 'Segundos', 'Detalle']]).setFontWeight('bold');
    sh.hideSheet();
  }
  sh.appendRow([new Date(), etapa, Math.round((Date.now() - desde) / 100) / 10, String(detalle || '').slice(0, 500)]);
  if (sh.getLastRow() > 400) sh.deleteRows(2, sh.getLastRow() - 300);
}
