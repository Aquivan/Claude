/**
 * Fuentes.js
 * Lee (SOLO LECTURA) las fuentes:
 *  - SIRE: pestañas "Detalle Ventas" y "Detalle Compras" de las hojas
 *    "Liquidacion IGV <RUC> - <año>" que genera el sistema SIRE en Drive.
 *  - Vouchers: pestañas Originales/Fotos del Sistema de Vouchers.
 *  - Registro manual y decisiones (✔/✖) de esta misma hoja.
 */

/** Busca en Drive las liquidaciones de las empresas del grupo y años configurados. */
function buscarLiquidaciones_(cfg) {
  var res = [];
  var it = DriveApp.searchFiles("title contains 'Liquidacion IGV ' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  while (it.hasNext()) {
    var f = it.next();
    var m = f.getName().match(/^Liquidacion IGV (\d{11}) - (\d{4})$/);
    if (!m || cfg.grupo.indexOf(m[1]) === -1 || cfg.anios.indexOf(+m[2]) === -1) continue;
    res.push({ ruc: m[1], anio: +m[2], id: f.getId(), actualizado: f.getLastUpdated().getTime() });
  }
  return res;
}

/** Lee los documentos SIRE de todas las liquidaciones encontradas. */
function leerDocumentosSire_(cfg, liquidaciones) {
  var docs = [];
  liquidaciones.forEach(function (lq) {
    var ss = SpreadsheetApp.openById(lq.id);
    [['Detalle Ventas', 'V'], ['Detalle Compras', 'C']].forEach(function (par) {
      var sh = ss.getSheetByName(par[0]);
      if (!sh || sh.getLastRow() < 2) return;
      var datos = sh.getDataRange().getValues();
      var col = indiceColumnas_(datos[0]);
      var iLink = col('Link PDF');
      var formulasLink = iLink >= 0 ? sh.getRange(1, iLink + 1, datos.length, 1).getFormulas() : null;
      var c = {
        car: col('CAR SUNAT'), fecha: col('Fecha de emision'), vence: col('Fecha Vcto/Pago'), tipo: col('Tipo CP/Doc'),
        serie: col('Serie del CDP'), numero: col('Nro CP o Doc Nro Inicial (Rango)', 'Nro CP'),
        rucCp: col('Nro Doc Identidad'), nombreCp: col('Apellidos Nombres/ Razon Social'),
        nombrePropio: par[1] === 'V' ? col('Razon Social') : col('Apellidos y Nombres o Razon social'),
        total: col('Total CP'), moneda: col('Moneda'), tc: col('Tipo Cambio', 'Tipo de Cambio'),
        modTipo: col('Tipo CP Modificado'), modSerie: col('Serie CP Modificado'), modNumero: col('Nro CP Modificado'),
        producto: col('items_descripcion'),
      };
      for (var i = 1; i < datos.length; i++) {
        var r = datos[i];
        var rucCp = aRuc_(r[c.rucCp]);
        if (!r[c.serie] || r[c.numero] === '' || r[c.numero] == null) continue;
        var link = '';
        if (formulasLink && formulasLink[i][0]) {
          var mm = formulasLink[i][0].match(/HYPERLINK\("([^"]+)"/i);
          if (mm) link = mm[1];
        }
        var base = {
          car: String(r[c.car] || ''), tipo: r[c.tipo], serie: r[c.serie], numero: r[c.numero],
          fecha: aFecha_(r[c.fecha]), vence: aFecha_(r[c.vence]), moneda: String(r[c.moneda] || 'PEN').toUpperCase(),
          total: aNumero_(r[c.total]), tc: aNumero_(r[c.tc]) || 1,
          modTipo: c.modTipo >= 0 ? r[c.modTipo] : '', modSerie: c.modSerie >= 0 ? r[c.modSerie] : '',
          modNumero: c.modNumero >= 0 ? r[c.modNumero] : '', producto: c.producto >= 0 ? String(r[c.producto] || '') : '',
          linkPdf: link,
        };
        if (par[1] === 'V') {
          base.emisorRuc = lq.ruc; base.emisorNombre = String(r[c.nombrePropio] || '');
          base.receptorRuc = rucCp; base.receptorNombre = String(r[c.nombreCp] || '');
        } else {
          base.emisorRuc = rucCp; base.emisorNombre = String(r[c.nombreCp] || '');
          base.receptorRuc = lq.ruc; base.receptorNombre = String(r[c.nombrePropio] || '');
        }
        docs.push(base);
      }
    });
  });
  return docs;
}

/** Lee los vouchers de las pestañas configuradas. Solo columnas de datos (no imagenes). */
function leerVouchers_(cfg) {
  var res = { pagos: [], duplicados: [] };
  if (!cfg.idVouchers) return res;
  var ss = SpreadsheetApp.openById(cfg.idVouchers);
  var vistos = {};
  cfg.pestanasVouchers.forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 2) return;
    var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var col = indiceColumnas_(enc);
    var c = {
      fecha: col('Fecha de depos', 'Fecha de deposito'), op: col('Numero de oper', 'Numero de operacion'),
      banco: col('Banco'), moneda: col('Moneda'), monto: col('Monto'), benefNombre: col('Proveedor (Beneficiario)'),
      idCliente: col('idCliente'), descripcion: col('Descripcion'), archivo: col('Archivo Original'),
      idUsuario: col('ID Usuario'), empresa: col('Empresa'), idBenef: col('ID Beneficiario'),
      refs: col('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc'), porRetener: col('Por Retener'),
    };
    // Leer solo hasta la ultima columna util (evita cargar columnas de imagenes al final)
    var ultima = Math.max.apply(null, Object.keys(c).map(function (k) { return c[k]; })) + 1;
    var datos = sh.getRange(2, 1, sh.getLastRow() - 1, ultima).getValues();
    datos.forEach(function (r, i) {
      var monto = aNumero_(r[c.monto]);
      var fecha = aFecha_(r[c.fecha]);
      if (!monto) return;
      var op = String(r[c.op] == null ? '' : r[c.op]).trim();
      var banco = String(r[c.banco] || '').trim();
      var id = [banco.toUpperCase(), op, fmtFechaClave_(fecha), monto.toFixed(2)].join('|');
      var fuente = nombre + '!' + (i + 2);
      if (vistos[id]) { res.duplicados.push({ id: id, fuente: fuente, otra: vistos[id] }); return; }
      vistos[id] = fuente;
      var pagador = c.idUsuario >= 0 ? aRuc_(r[c.idUsuario]) : '';
      if (!pagador && c.empresa >= 0 && r[c.empresa]) pagador = cfg.aliasEmpresa[normHeader_(r[c.empresa])] || '';
      if (!pagador && c.idCliente >= 0) pagador = aRuc_(r[c.idCliente]);
      res.pagos.push({
        id: id, fecha: fecha, monto: monto, moneda: String(r[c.moneda] || 'PEN').toUpperCase().trim(),
        pagadorRuc: pagador,
        beneficiarioRuc: c.idBenef >= 0 ? aRuc_(r[c.idBenef]) : '',
        beneficiarioNombre: c.benefNombre >= 0 ? String(r[c.benefNombre] || '') : '',
        refs: c.refs >= 0 ? String(r[c.refs] || '') : '',
        banco: banco, operacion: op, modalidad: MODALIDAD.PAGO, fuente: fuente,
        descripcion: c.descripcion >= 0 ? String(r[c.descripcion] || '') : '',
      });
    });
  });
  return res;
}

/** Lee la hoja ✍️ Registro manual como pagos/descuentos manuales. */
function leerRegistroManual_(ss) {
  var sh = ss.getSheetByName(HOJA.MANUAL);
  if (!sh || sh.getLastRow() < 2) return [];
  var datos = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  var mapa = { 'retencion': MODALIDAD.RETENCION, 'detraccion': MODALIDAD.DETRACCION, 'pago': MODALIDAD.PAGO, 'otro descuento': MODALIDAD.OTRO };
  var res = [];
  datos.forEach(function (r, i) {
    var monto = aNumero_(r[5]);
    if (!monto || !r[4]) return;
    var fecha = aFecha_(r[0]);
    res.push({
      id: ['MANUAL', i + 2, fmtFechaClave_(fecha), monto.toFixed(2), String(r[4])].join('|'),
      fecha: fecha, monto: monto, moneda: String(r[6] || 'PEN').toUpperCase(),
      pagadorRuc: aRuc_(r[2]), beneficiarioRuc: aRuc_(r[3]), refs: String(r[4]),
      operacion: String(r[7] || ''), banco: String(r[8] || ''),
      modalidad: mapa[normHeader_(r[1])] || MODALIDAD.RETENCION, esManual: true,
      fuente: HOJA.MANUAL + '!' + (i + 2),
    });
  });
  return res;
}

/**
 * Pasa las marcas ✔/✖ de la hoja ✅ Conciliar a la hoja oculta _Decisiones
 * (para que no se pierdan al reescribir Conciliar) y devuelve todas.
 */
function leerYGuardarDecisiones_(ss) {
  var shDec = obtenerOCrearHoja_(ss, HOJA.DECISIONES);
  var dec = {};
  if (shDec.getLastRow() > 1) {
    shDec.getRange(2, 1, shDec.getLastRow() - 1, 3).getValues().forEach(function (r) {
      if (r[0]) dec[r[0]] = { estado: r[1], docs: String(r[2] || '').split(',').filter(Boolean) };
    });
  }
  var shC = ss.getSheetByName(HOJA.CONC);
  var nuevas = 0;
  if (shC && shC.getLastRow() > 1) {
    var datos = shC.getDataRange().getValues();
    var enc = null;
    datos.forEach(function (r) {
      if (r[0] === '✔ Aplicar') { enc = indiceColumnas_(r); return; }
      if (!enc) return;
      var iId = enc('ID pago'), iDocs = enc('Claves');
      if (iId < 0 || !r[iId]) return;
      var ok = r[0] === true, no = r[1] === true;
      if (!ok && !no) return;
      var docsDec = String(r[iDocs] || '').split(',').filter(Boolean);
      dec[ok ? r[iId] : r[iId] + '#NO#' + docsDec.join(',')] = { estado: ok ? 'OK' : 'NO', docs: docsDec };
      nuevas++;
    });
  }
  if (nuevas) {
    var filas = Object.keys(dec).map(function (k) { return [k, dec[k].estado, dec[k].docs.join(','), new Date()]; });
    shDec.getRange(2, 1, Math.max(shDec.getLastRow() - 1, 1), 4).clearContent();
    shDec.getRange(2, 1, filas.length, 4).setValues(filas);
  }
  return dec;
}
