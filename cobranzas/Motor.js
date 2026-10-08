/**
 * Motor.js
 * Motor de cruce PURO (sin llamadas a Google): recibe documentos SIRE,
 * pagos (vouchers + registro manual) y decisiones, y devuelve el saldo de
 * cada documento, los movimientos aplicados, las sugerencias a revisar y lo
 * que no se pudo cruzar. Al no tocar Sheets/Drive se puede probar fuera de
 * Apps Script con datos reales.
 *
 * Saldo de un documento:
 *   Total − N/C − Retención − Detracción − Otros descuentos − Pagos (+ N/D)
 *
 * Orden de aplicacion de un pago:
 *   1. Referenciado: el voucher dice a que factura(s) paga ("Tipo y Nº Doc.").
 *      El monto se reparte EN EL ORDEN escrito, cada factura toma lo que le
 *      falta; lo que sobra queda como remanente del voucher.
 *   2. Confirmado: una sugerencia que el usuario marco ✔ en Conciliar.
 *   3. Exacto (solo si el voucher no tiene referencia): mismo pagador y
 *      beneficiario, y el monto coincide con el saldo de UNA sola factura
 *      (o con el saldo neto de detraccion / retencion 3%).
 *   4. Sugerido (modo INTELIGENTE): monto cercano o suma de 2-3 facturas.
 *      NO se aplica hasta que el usuario lo confirme.
 */

var ORIGEN = {
  SIRE_NC: '📄 N/C SIRE',
  REFERENCIADO: '🟢 Referenciado',
  CONFIRMADO: '🟡 Confirmado',
  EXACTO: '🔵 Exacto',
  MANUAL: '✍️ Manual',
};

var MODALIDAD = {
  PAGO: 'Pago',
  RETENCION: 'Retención',
  DETRACCION: 'Detracción',
  NC: 'N/C',
  ND: 'N/D',
  OTRO: 'Otro descuento',
};

// Tasas para reconocer pagos netos (el cliente deposita el total menos la
// detraccion o menos la retencion del 3%).
var TASAS_DETRACCION_ = [0.04, 0.10, 0.12];
var TASA_RETENCION_ = 0.03;

function redondear2_(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** Clave de documento sin depender del CAR: emisor|tipo|serie|numero. */
function claveDoc_(emisorRuc, tipo, serie, numero) {
  return String(emisorRuc) + '|' + normTipo_(tipo) + '|' + String(serie).toUpperCase().trim() + '|' + parseInt(numero, 10);
}
function normTipo_(t) {
  var s = String(t == null ? '' : t).trim();
  if (!s) return '01';
  return ('0' + parseInt(s, 10)).slice(-2);
}

/**
 * Interpreta la columna "Tipo y Nº Doc." de Vouchers. Acepta:
 *   01_E001-393                 -> una factura
 *   01_E001-393,394             -> misma serie, varios numeros
 *   01_E001-393,01_E001-394     -> codigo completo cada vez
 *   E001-393 / 03_B001-12 / 01 E001 393 / espacios, ";", "/", " y "
 * Devuelve [{tipo, serie, numero, texto}] en el MISMO orden escrito y una
 * lista de partes que no se entendieron.
 */
function parsearReferencias_(texto) {
  var res = { refs: [], noEntendido: [] };
  if (texto == null) return res;
  var s = String(texto).toUpperCase().replace(/\s+Y\s+/g, ',').replace(/[;/|]/g, ',').trim();
  if (!s || s === '?' ) return res;
  // "01 E001 393" -> "01_E001-393"
  s = s.replace(/\b(\d{2})\s*[_\s]\s*([A-Z0-9]{4})\s*[-\s]\s*(\d+)/g, '$1_$2-$3');
  s = s.replace(/\b([A-Z][A-Z0-9]{3})\s+(\d+)\b/g, '$1-$2');
  var partes = s.split(/[,\s]+/).filter(function (p) { return p; });
  var tipoActual = '01', serieActual = null;
  partes.forEach(function (p) {
    var m;
    if ((m = p.match(/^(\d{1,2})_([A-Z0-9]{4})-0*(\d+)$/))) {
      tipoActual = normTipo_(m[1]); serieActual = m[2];
      res.refs.push({ tipo: tipoActual, serie: serieActual, numero: parseInt(m[3], 10), texto: p });
    } else if ((m = p.match(/^([A-Z0-9]{4})-0*(\d+)$/)) && /[A-Z]/.test(m[1])) {
      serieActual = m[1];
      res.refs.push({ tipo: tipoActual, serie: serieActual, numero: parseInt(m[2], 10), texto: p });
    } else if ((m = p.match(/^0*(\d+)$/)) && serieActual) {
      res.refs.push({ tipo: tipoActual, serie: serieActual, numero: parseInt(m[1], 10), texto: p });
    } else {
      res.noEntendido.push(p);
    }
  });
  return res;
}

/** Normaliza una razon social para compararla (sin tildes, puntos ni sufijos legales). */
function normNombre_(s) {
  if (!s) return '';
  var t = String(s).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9& ]/g, ' ')
    .replace(/\b(S A C|S A A|S A|E I R L|S R L|S C R L|SAC|SAA|SA|EIRL|SRL|SCRL|EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA|SOCIEDAD ANONIMA CERRADA|SOCIEDAD ANONIMA|SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA|SOCIEDAD DE RESPONSABILIDAD LIMITADA)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Ejecuta el cruce completo.
 * entrada = {
 *   docs: [{car, emisorRuc, emisorNombre, receptorRuc, receptorNombre, tipo, serie, numero,
 *           fecha(Date), vence(Date|null), moneda, total, tc, modTipo, modSerie, modNumero,
 *           producto, linkPdf}],
 *   pagos: [{id, fecha(Date), monto, moneda, pagadorRuc, beneficiarioRuc, beneficiarioNombre,
 *            refs(texto), banco, operacion, modalidad, fuente, esManual}],
 *   decisiones: { [pagoId]: {estado:'OK'|'NO', docs:[clave...]} },
 *   grupo: [ruc...], alias: {nombreNormalizado: ruc},
 *   opciones: {modo:'INTELIGENTE'|'ESTRICTO', tolerancia: 1.0, diasVentana: 120}
 * }
 */
function ejecutarCruce_(entrada) {
  var op = entrada.opciones || {};
  var modo = (op.modo || 'INTELIGENTE').toUpperCase();
  var tol = op.tolerancia != null ? op.tolerancia : 1.0;
  var ventanaMs = (op.diasVentana || 120) * 86400000;
  var grupo = {};
  (entrada.grupo || []).forEach(function (r) { grupo[String(r)] = true; });

  // ---------------- 1. Documentos (unicos por clave) ----------------
  var docs = {}, porTSN = {}, directorio = {};
  (entrada.docs || []).forEach(function (d) {
    var k = claveDoc_(d.emisorRuc, d.tipo, d.serie, d.numero);
    var ex = docs[k];
    if (ex) {
      // Mismo documento visto desde la otra empresa del grupo: completar datos.
      ['producto', 'linkPdf', 'vence', 'emisorNombre', 'receptorNombre', 'car'].forEach(function (c) {
        if (!ex[c] && d[c]) ex[c] = d[c];
      });
      return;
    }
    var doc = {};
    for (var c in d) doc[c] = d[c];
    doc.clave = k;
    doc.tipo = normTipo_(d.tipo);
    doc.serie = String(d.serie).toUpperCase().trim();
    doc.numero = parseInt(d.numero, 10);
    doc.total = Math.abs(Number(d.total) || 0);
    doc.nc = 0; doc.nd = 0; doc.retencion = 0; doc.detraccion = 0; doc.otros = 0; doc.pagado = 0;
    doc.movs = [];
    docs[k] = doc;
    var tsn = doc.tipo + '|' + doc.serie + '|' + doc.numero;
    (porTSN[tsn] = porTSN[tsn] || []).push(doc);
    [[d.emisorRuc, d.emisorNombre], [d.receptorRuc, d.receptorNombre]].forEach(function (par) {
      var n = normNombre_(par[1]);
      if (n && par[0]) {
        directorio[n] = directorio[n] || {};
        directorio[n][String(par[0])] = true;
      }
    });
  });
  var alias = entrada.alias || {};

  function resolverRucPorNombre(nombre) {
    var n = normNombre_(nombre);
    if (!n) return '';
    if (alias[n]) return String(alias[n]);
    var rucs = directorio[n] ? Object.keys(directorio[n]) : [];
    return rucs.length === 1 ? rucs[0] : '';
  }

  function pendiente(doc) {
    return redondear2_(doc.total + doc.nd - doc.nc - doc.retencion - doc.detraccion - doc.otros - doc.pagado);
  }

  var movimientos = [], errores = [], sugerencias = [], sinCruzar = [], remanentes = [];

  function registrarMov(doc, monto, pago, modalidad, origen, nota) {
    monto = redondear2_(monto);
    if (Math.abs(monto) < 0.005) return;
    switch (modalidad) {
      case MODALIDAD.NC: doc.nc += monto; break;
      case MODALIDAD.ND: doc.nd += monto; break;
      case MODALIDAD.RETENCION: doc.retencion += monto; break;
      case MODALIDAD.DETRACCION: doc.detraccion += monto; break;
      case MODALIDAD.OTRO: doc.otros += monto; break;
      default: doc.pagado += monto;
    }
    var mov = {
      docClave: doc.clave, car: doc.car || '', fecha: pago.fecha || null, modalidad: modalidad,
      monto: monto, moneda: doc.moneda, origen: origen, nota: nota || '',
      operacion: pago.operacion || '', banco: pago.banco || '', montoPago: pago.monto,
      monedaPago: pago.moneda || '', pagoId: pago.id || '', fuente: pago.fuente || '',
      pagadorRuc: doc.receptorRuc, beneficiarioRuc: doc.emisorRuc,
    };
    movimientos.push(mov);
    doc.movs.push(mov);
  }

  /** Monto del pago expresado en la moneda del documento. */
  function montoEnMonedaDoc(pago, doc) {
    var mp = String(pago.moneda || doc.moneda || 'PEN').toUpperCase();
    var md = String(doc.moneda || 'PEN').toUpperCase();
    if (mp === md) return pago.monto;
    var tc = Number(doc.tc) > 1 ? Number(doc.tc) : 0;
    if (!tc) return null;
    return mp === 'USD' ? pago.monto * tc : pago.monto / tc;
  }

  /** Reparte un pago entre documentos en orden (cada uno toma lo que le falta). */
  function repartir(pago, lista, origen, modalidad) {
    var restante = null, monedaRef = null;
    lista.forEach(function (doc, i) {
      var disponible = montoEnMonedaDoc({ monto: restante == null ? pago.monto : restante, moneda: restante == null ? pago.moneda : monedaRef }, doc);
      if (disponible == null) {
        errores.push({ tipo: 'Moneda', pagoId: pago.id, detalle: 'No se pudo convertir ' + pago.moneda + ' a ' + doc.moneda + ' para ' + etiquetaDoc_(doc), fuente: pago.fuente });
        return;
      }
      monedaRef = doc.moneda;
      var falta = pendiente(doc);
      var esUltimo = i === lista.length - 1;
      var toma;
      // Retencion/detraccion manual sobre UNA factura: se aplica el monto exacto
      // (aunque deje la factura sobrepagada, para que se note el error).
      if (modalidad !== MODALIDAD.PAGO && lista.length === 1) toma = disponible;
      else toma = Math.max(0, Math.min(disponible, falta));
      if (toma > 0) registrarMov(doc, toma, pago, modalidad, origen);
      else if (modalidad === MODALIDAD.PAGO && falta <= 0.005) {
        errores.push({ tipo: 'Ya pagada', pagoId: pago.id, detalle: etiquetaDoc_(doc) + ' ya estaba cancelada; no se le aplico nada de este pago', fuente: pago.fuente });
      }
      restante = redondear2_(disponible - toma);
      if (esUltimo && restante > 0.05) {
        remanentes.push({ pago: pago, monto: restante, moneda: doc.moneda, docs: lista.map(etiquetaDoc_).join(', ') });
      }
    });
  }

  // ---------------- 2. Notas de credito / debito de SIRE ----------------
  Object.keys(docs).forEach(function (k) {
    var d = docs[k];
    if (d.tipo !== '07' && d.tipo !== '08') return;
    if (!d.modSerie || !d.modNumero) {
      errores.push({ tipo: 'N/C sin referencia', detalle: etiquetaDoc_(d) + ' no indica a que documento modifica', fuente: 'SIRE' });
      return;
    }
    var objetivo = docs[claveDoc_(d.emisorRuc, d.modTipo || '01', d.modSerie, d.modNumero)];
    if (!objetivo) {
      errores.push({ tipo: 'N/C sin documento', detalle: etiquetaDoc_(d) + ' modifica ' + normTipo_(d.modTipo) + '_' + d.modSerie + '-' + d.modNumero + ', que no esta en SIRE', fuente: 'SIRE' });
      return;
    }
    d.esNota = true;
    registrarMov(objetivo, d.total, { fecha: d.fecha, operacion: d.serie + '-' + d.numero, id: 'SIRE:' + k, monto: d.total, moneda: d.moneda, fuente: 'SIRE' },
      d.tipo === '07' ? MODALIDAD.NC : MODALIDAD.ND, ORIGEN.SIRE_NC);
  });

  // ---------------- 3. Preparar pagos ----------------
  var pagos = (entrada.pagos || []).map(function (p) {
    var q = {};
    for (var c in p) q[c] = p[c];
    q.monto = Math.abs(Number(p.monto) || 0);
    q.pagadorRuc = p.pagadorRuc ? String(p.pagadorRuc).trim() : '';
    q.beneficiarioRuc = p.beneficiarioRuc ? String(p.beneficiarioRuc).trim() : resolverRucPorNombre(p.beneficiarioNombre);
    q.modalidad = p.modalidad || MODALIDAD.PAGO;
    q.parse = parsearReferencias_(p.refs);
    q.aplicado = false;
    return q;
  }).filter(function (p) { return p.monto > 0; });

  // Descuentos manuales primero (retencion, detraccion, otros), luego pagos por fecha.
  pagos.sort(function (a, b) {
    var ma = a.modalidad === MODALIDAD.PAGO ? 1 : 0, mb = b.modalidad === MODALIDAD.PAGO ? 1 : 0;
    if (ma !== mb) return ma - mb;
    var fa = a.fecha ? a.fecha.getTime() : 0, fb = b.fecha ? b.fecha.getTime() : 0;
    return fa - fb;
  });

  function buscarDocPorRef(ref, pago) {
    var lista = porTSN[ref.tipo + '|' + ref.serie + '|' + ref.numero] || [];
    if (pago.beneficiarioRuc) lista = lista.filter(function (d) { return d.emisorRuc === pago.beneficiarioRuc; });
    if (lista.length > 1 && pago.pagadorRuc) lista = lista.filter(function (d) { return d.receptorRuc === pago.pagadorRuc; });
    return lista.length === 1 ? lista[0] : (lista.length > 1 ? 'AMBIGUO' : null);
  }

  // ---------------- 4. Referenciados y 5. confirmados ----------------
  // Los pagos en efectivo con facturas indicadas se reparten JUNTOS (lote),
  // para poder reacomodar el dinero entre vouchers que comparten facturas.
  var dec = entrada.decisiones || {};
  var lote = [];
  function mismaMoneda(p, lista) {
    return lista.every(function (d) { return String(d.moneda || 'PEN').toUpperCase() === String(p.moneda || d.moneda || 'PEN').toUpperCase(); });
  }
  function encolar(p, lista, origen) {
    if (p.modalidad !== MODALIDAD.PAGO || !mismaMoneda(p, lista)) repartir(p, lista, origen, p.modalidad);
    else lote.push({ p: p, lista: lista, origen: origen });
    p.aplicado = true;
  }
  pagos.forEach(function (p) {
    p.parse.noEntendido.forEach(function (t) {
      errores.push({ tipo: 'Referencia no entendida', pagoId: p.id, detalle: '"' + t + '" en "' + p.refs + '"', fuente: p.fuente });
    });
    if (!p.parse.refs.length) return;
    var lista = [];
    p.parse.refs.forEach(function (ref) {
      var d = buscarDocPorRef(ref, p);
      var txt = ref.tipo + '_' + ref.serie + '-' + ref.numero;
      if (d === 'AMBIGUO') errores.push({ tipo: 'Referencia ambigua', pagoId: p.id, detalle: txt + ' existe para varios emisores; falta el RUC del beneficiario', fuente: p.fuente });
      else if (!d) errores.push({ tipo: 'Referencia no existe', pagoId: p.id, detalle: txt + (p.beneficiarioRuc ? ' no existe en SIRE para el RUC ' + p.beneficiarioRuc : ' no existe en SIRE'), fuente: p.fuente });
      else if (lista.indexOf(d) === -1) lista.push(d);
    });
    if (lista.length) encolar(p, lista, p.esManual ? ORIGEN.MANUAL : ORIGEN.REFERENCIADO);
  });
  pagos.forEach(function (p) {
    if (p.aplicado || !dec[p.id] || dec[p.id].estado !== 'OK') return;
    var lista = (dec[p.id].docs || []).map(function (k) { return docs[k]; }).filter(Boolean);
    if (lista.length) encolar(p, lista, ORIGEN.CONFIRMADO);
  });
  asignarLote(lote);

  /**
   * Reparto del lote: 1) cada voucher, por fecha, llena sus facturas en el
   * orden escrito; 2) si a un voucher le sobra dinero porque otra factura suya
   * ya la lleno otro voucher, se reacomoda: el otro voucher pasa esa parte a
   * una factura suya que aun tiene saldo. Asi el sobrante solo queda cuando de
   * verdad se pago de mas.
   */
  function asignarLote(lote) {
    lote.sort(function (a, b) {
      return (a.p.fecha ? a.p.fecha.getTime() : 0) - (b.p.fecha ? b.p.fecha.getTime() : 0);
    });
    var pend = {};
    function pd(d) { if (pend[d.clave] == null) pend[d.clave] = pendiente(d); return pend[d.clave]; }
    lote.forEach(function (e) {
      e.asign = e.lista.map(function () { return 0; });
      e.rem = e.p.monto;
      e.lista.forEach(function (d, i) {
        var x = Math.max(0, Math.min(e.rem, pd(d)));
        e.asign[i] += x; pend[d.clave] = redondear2_(pd(d) - x); e.rem = redondear2_(e.rem - x);
      });
    });
    // Caminos de reacomodo (como un flujo): desde el voucher con sobrante se
    // busca una cadena voucher→factura→otro voucher→otra factura... hasta una
    // factura que aun tenga saldo, y se corre el dinero a lo largo de la cadena.
    var usanDoc = {};
    lote.forEach(function (e) { e.lista.forEach(function (d) { (usanDoc[d.clave] = usanDoc[d.clave] || []).push(e); }); });
    function idx(e, d) { return e.lista.indexOf(d); }
    lote.forEach(function (v) {
      for (var intento = 0; intento < 50 && v.rem > 0.05; intento++) {
        var padre = {}, cola = [], destino = null;
        v.lista.forEach(function (d) { if (!padre[d.clave]) { padre[d.clave] = { e: v, prev: null, doc: d }; cola.push(d); } });
        while (cola.length && !destino) {
          var d = cola.shift();
          if (pd(d) > 0.05) { destino = d; break; }
          (usanDoc[d.clave] || []).forEach(function (w) {
            if (destino || w.asign[idx(w, d)] <= 0.005) return;
            w.lista.forEach(function (e) {
              if (destino || padre[e.clave]) return;
              padre[e.clave] = { e: w, prev: d, doc: e };
              if (pd(e) > 0.05) destino = e; else cola.push(e);
            });
          });
        }
        if (!destino) break;
        var x = Math.min(v.rem, pd(destino)), n = destino;
        while (padre[n.clave].prev) { var pp = padre[n.clave]; x = Math.min(x, pp.e.asign[idx(pp.e, pp.prev)]); n = pp.prev; }
        x = redondear2_(x);
        if (x <= 0.005) break;
        n = destino;
        pend[destino.clave] = redondear2_(pd(destino) - x);
        while (true) {
          var q = padre[n.clave], k = idx(q.e, n);
          q.e.asign[k] = redondear2_(q.e.asign[k] + x);
          if (!q.prev) { v.rem = redondear2_(v.rem - x); break; }
          var j = idx(q.e, q.prev);
          q.e.asign[j] = redondear2_(q.e.asign[j] - x);
          n = q.prev;
        }
      }
    });
    lote.forEach(function (e) {
      e.lista.forEach(function (d, i) { if (e.asign[i] > 0.005) registrarMov(d, e.asign[i], e.p, MODALIDAD.PAGO, e.origen); });
      if (e.rem > 0.05) {
        remanentes.push({ pago: e.p, monto: e.rem, moneda: e.lista[0].moneda, docs: e.lista.map(etiquetaDoc_).join(', ') });
        errores.push({ tipo: 'Pago de más', pagoId: e.p.id, detalle: 'Op. ' + (e.p.operacion || '') + ': sobran ' + e.rem.toFixed(2) + ' después de cancelar ' + e.lista.map(etiquetaDoc_).join(', '), fuente: e.p.fuente });
      }
    });
  }

  // ---------------- 6. Exactos y 7. sugerencias ----------------
  var porEmisor = {}, porReceptor = {};
  Object.keys(docs).forEach(function (k) {
    var d = docs[k];
    (porEmisor[d.emisorRuc] = porEmisor[d.emisorRuc] || []).push(d);
    (porReceptor[d.receptorRuc] = porReceptor[d.receptorRuc] || []).push(d);
  });
  function candidatos(p) {
    var base = p.beneficiarioRuc ? (porEmisor[p.beneficiarioRuc] || []) : (porReceptor[p.pagadorRuc] || []);
    return base.filter(function (d) {
      if (d.esNota || d.tipo === '07' || d.tipo === '08') return false;
      if (p.beneficiarioRuc && d.emisorRuc !== p.beneficiarioRuc) return false;
      if (p.pagadorRuc && d.receptorRuc !== p.pagadorRuc) return false;
      if (!p.beneficiarioRuc && !p.pagadorRuc) return false;
      // Sin RUC del beneficiario: solo facturas cuyo emisor se llame parecido
      if (!p.beneficiarioRuc && !nombreParecido_(p.beneficiarioNombre, d.emisorNombre)) return false;
      if (pendiente(d) <= 0.05) return false;
      if (p.fecha && d.fecha && Math.abs(p.fecha.getTime() - d.fecha.getTime()) > ventanaMs) return false;
      return true;
    });
  }
  function coincide(monto, saldo, tolerancia) {
    if (Math.abs(monto - saldo) <= tolerancia) return 'exacto';
    for (var i = 0; i < TASAS_DETRACCION_.length; i++) {
      if (Math.abs(monto - saldo * (1 - TASAS_DETRACCION_[i])) <= tolerancia) return 'neto de detracción ' + Math.round(TASAS_DETRACCION_[i] * 100) + '%';
    }
    if (Math.abs(monto - saldo * (1 - TASA_RETENCION_)) <= tolerancia) return 'neto de retención 3%';
    return '';
  }
  // Un rechazo (✖) se guarda como "<idPago>#NO#<claves>" para poder rechazar
  // varias opciones del mismo voucher.
  var rechazado = function (p, claves) { return !!dec[p.id + '#NO#' + claves.join(',')]; };

  pagos.forEach(function (p) {
    if (p.aplicado || p.modalidad !== MODALIDAD.PAGO) return;
    if (p.parse.refs.length) return; // tenia referencia pero no se encontro: no adivinar
    var cands = candidatos(p);
    var exactos = cands.filter(function (d) {
      var m = montoEnMonedaDoc(p, d);
      return m != null && coincide(m, pendiente(d), 0.05);
    });
    // Exacto solo si pagador Y beneficiario se conocen y hay una sola factura posible.
    if (exactos.length === 1 && p.pagadorRuc && p.beneficiarioRuc && !rechazado(p, [exactos[0].clave])) {
      var d = exactos[0];
      var tipoCoinc = coincide(montoEnMonedaDoc(p, d), pendiente(d), 0.05);
      registrarMov(d, Math.min(montoEnMonedaDoc(p, d), pendiente(d)), p, MODALIDAD.PAGO, ORIGEN.EXACTO, tipoCoinc === 'exacto' ? '' : tipoCoinc);
      p.aplicado = true;
      return;
    }
    if (modo !== 'INTELIGENTE') return;
    // Si no se sabe a quien se pago (sin RUC de beneficiario) se exige monto
    // exacto y nombre parecido, para no llenar Conciliar de coincidencias casuales.
    var tolP = p.beneficiarioRuc ? tol : 0.05;
    var props = [];
    cands.forEach(function (d) {
      var m = montoEnMonedaDoc(p, d);
      if (m == null) return;
      var c = coincide(m, pendiente(d), tolP);
      if (c) props.push({ docs: [d], nota: c === 'exacto' ? (exactos.length > 1 ? 'Monto igual en varias facturas' : 'Monto igual') : c });
    });
    // Suma de 2 o 3 facturas del mismo emisor/receptor
    var lim = p.beneficiarioRuc ? cands.slice(0, 30) : [];
    for (var i = 0; i < lim.length && props.length < 6; i++) {
      for (var j = i + 1; j < lim.length && props.length < 6; j++) {
        var s2 = pendiente(lim[i]) + pendiente(lim[j]);
        var m2 = montoEnMonedaDoc(p, lim[i]);
        if (m2 != null && lim[i].emisorRuc === lim[j].emisorRuc && lim[i].receptorRuc === lim[j].receptorRuc && Math.abs(m2 - s2) <= tol) {
          props.push({ docs: [lim[i], lim[j]], nota: 'Suma de 2 facturas' });
        }
        for (var k = j + 1; k < lim.length && props.length < 6; k++) {
          var s3 = s2 + pendiente(lim[k]);
          if (m2 != null && lim[k].emisorRuc === lim[i].emisorRuc && lim[k].receptorRuc === lim[i].receptorRuc && Math.abs(m2 - s3) <= tol) {
            props.push({ docs: [lim[i], lim[j], lim[k]], nota: 'Suma de 3 facturas' });
          }
        }
      }
    }
    props = props.filter(function (pr) { return !rechazado(p, pr.docs.map(function (d) { return d.clave; })); });
    if (props.length) {
      props.slice(0, 3).forEach(function (pr) {
        sugerencias.push({ pago: p, docs: pr.docs, nota: pr.nota + (props.length > 1 ? ' (' + props.length + ' opciones)' : '') });
      });
      p.sugerido = true;
    }
  });

  // ---------------- 8. Sin cruzar ----------------
  pagos.forEach(function (p) {
    if (p.aplicado || p.sugerido || p.modalidad !== MODALIDAD.PAGO) return;
    var motivo;
    if (p.parse.refs.length) motivo = 'La referencia escrita no se encontró en SIRE';
    else if (!p.pagadorRuc && !p.beneficiarioRuc) motivo = 'Falta RUC de quién paga y del beneficiario';
    else if (!p.beneficiarioRuc) motivo = 'Falta RUC del beneficiario (ID Beneficiario)';
    else if (!p.pagadorRuc) motivo = 'Falta RUC de quién paga (ID Usuario) y no hubo coincidencia única';
    else motivo = 'No hay factura pendiente con ese monto; escribe la factura en "Tipo y Nº Doc."';
    var relevante = grupo[p.pagadorRuc] || grupo[p.beneficiarioRuc];
    sinCruzar.push({ pago: p, motivo: motivo, relevante: !!relevante });
  });

  // ---------------- Resultado ----------------
  var lista = Object.keys(docs).map(function (k) {
    var d = docs[k];
    d.saldo = pendiente(d);
    return d;
  });
  return {
    docs: lista, movimientos: movimientos, sugerencias: sugerencias, sinCruzar: sinCruzar,
    remanentes: remanentes, errores: errores, pagos: pagos,
  };
}

/** ¿El nombre del voucher se parece a la razon social de la factura? */
function nombreParecido_(nombreVoucher, nombreDoc) {
  var a = normNombre_(nombreVoucher).split(' ').filter(function (t) { return t.length >= 3; });
  var b = normNombre_(nombreDoc).split(' ').filter(function (t) { return t.length >= 3; });
  if (!a.length || !b.length) return false;
  if (a[0] === b[0] && (a.length === 1 || b.indexOf(a[1]) !== -1 || a[1] === b[1])) return true;
  var comunes = a.filter(function (t) { return b.indexOf(t) !== -1; }).length;
  return comunes / a.length >= 0.6 && comunes >= 2;
}

function etiquetaDoc_(d) {
  return d.tipo + '_' + d.serie + '-' + d.numero;
}

/**
 * Estado de un documento ya cruzado.
 * hoy: Date. Devuelve {estado, diasVencido}.
 */
function estadoDoc_(d, hoy) {
  var s = d.saldo;
  var tot = d.total + d.nd;
  var dias = d.vence ? Math.floor((hoy.getTime() - d.vence.getTime()) / 86400000) : 0;
  if (d.tipo === '07' || d.tipo === '08') return { estado: 'Nota', diasVencido: 0 };
  if (s < -0.10) return { estado: '⚠️ Sobrepagado', diasVencido: 0 };
  if (Math.abs(s) <= 0.10) return { estado: '✅ Pagado', diasVencido: 0 };
  for (var i = 0; i < TASAS_DETRACCION_.length; i++) {
    if (Math.abs(s - tot * TASAS_DETRACCION_[i]) <= 1) return { estado: '🟣 Falta detracción', diasVencido: Math.max(0, dias) };
  }
  if (Math.abs(s - tot * TASA_RETENCION_) <= 1) return { estado: '🟣 Falta retención', diasVencido: Math.max(0, dias) };
  var pagadoAlgo = d.pagado + d.retencion + d.detraccion + d.otros + d.nc > 0.005;
  if (dias > 0) return { estado: pagadoAlgo ? '🔴 Parcial vencido' : '🔴 Vencido', diasVencido: dias };
  return { estado: pagadoAlgo ? '🟡 Parcial' : '⚪ Pendiente', diasVencido: 0 };
}
