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

function huellaExterna_(ss, cfg, liqs) {
  var partes = [Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd')]; // cambia de dia: recalcular vencidos
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
  try {
    var ss = ssPrincipal_();
    var props = PropertiesService.getDocumentProperties();
    var cfg = leerConfig_(ss);
    var liqs = buscarLiquidaciones_(cfg);
    var huella = huellaExterna_(ss, cfg, liqs) + '|' + huellaMarcas_(ss);
    if (!forzar && huella === props.getProperty('huella')) return 'Sin cambios.';

    var t0 = Date.now();
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
      grupo: cfg.grupo, alias: cfg.aliasNombre,
      opciones: { modo: cfg.modo, tolerancia: cfg.tolerancia, diasVentana: cfg.ventana },
    });
    vch.duplicados.forEach(function (d) {
      res.errores.unshift({ tipo: 'Voucher repetido', detalle: 'Mismo banco, operación, fecha y monto que ' + d.otra + ' (se tomó solo una vez)', fuente: d.fuente });
    });

    var hoy = new Date();
    var filasDocs = construirFilasDocumentos_(res, cfg, hoy);
    escribirDocumentos_(ss, filasDocs);
    escribirMovimientos_(ss, res, cfg);
    escribirConciliar_(ss, res, cfg);
    escribirPanel_(ss, filasDocs, res, cfg, liqs);
    try { renderConsulta_(ss); } catch (e) { Logger.log('Consulta: ' + e.message); }

    props.setProperty('huella', huellaExterna_(ss, cfg, liqs) + '|' + huellaMarcas_(ss));
    props.setProperty('ultimaActualizacion', new Date().toISOString());
    var aplicados = res.pagos.filter(function (p) { return p.aplicado && p.modalidad === MODALIDAD.PAGO; }).length;
    return 'Listo en ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + filasDocs.length + ' documentos de ' + liqs.length +
      ' liquidaciones, ' + aplicados + ' vouchers cruzados, ' + res.sugerencias.length + ' sugerencias por revisar.';
  } finally {
    lock.releaseLock();
  }
}
