/**
 * Mesa.js — 🧩 MESA DE CONCILIACIÓN: facturas (SIRE) a un lado, vouchers al otro, y se cruzan con líneas.
 *
 * Es la pantalla de «emparejar» de los sistemas contables (Xero «Find & Match», Odoo «Payments Matching»,
 * SAP «compensar partidas»), hecha sobre lo que ya calcula Cobranzas:
 *   - Facturas: 📋 Documentos (una empresa o todo el grupo, por pagar o por cobrar, con saldo o todas).
 *   - Vouchers: la hoja de Vouchers (cada voucher una sola vez: manda Originales, igual que el motor).
 *   - Cruces actuales: 💳 Movimientos (qué voucher pagó qué factura y cuánto, y si fue escrito, exacto o
 *     confirmado). Sugerencias del motor (✅ Conciliar) y de la IA: líneas punteadas, nada se aplica solo.
 * Al 💾 Guardar, lo único que se escribe es lo que la persona ya escribe a mano en la hoja de Vouchers:
 *   «Tipo y Nº Doc.» (las facturas, en orden), «ID Beneficiario» e «ID Usuario» (solo si están vacíos o si la
 *   persona aceptó reemplazar un RUC distinto). Quitar un cruce automático (exacto / confirmado) se guarda en
 *   _Decisiones para que el motor no lo vuelva a poner. Todo queda en _Mesa (quién, cuándo, antes → después)
 *   y con nota en la celda; ↩️ Deshacer vuelve atrás lo guardado si nadie cambió la celda después.
 * Varias personas a la vez: antes de escribir se compara la celda con lo que la persona vio al cargar; si otra
 *   persona la cambió, ese voucher no se toca y se avisa (sin candados en la hoja de Vouchers).
 * Se abre desde 🧠 Asistente IA (aquí y en la hoja de Vouchers), 💼 Cobranzas, o con un enlace (ventana aparte,
 *   celular, Telegram/WhatsApp «mesa»): la página es la aplicación web de Cobranzas con una llave temporal.
 * Funciones MESA_.
 */

var MESA_HOJA_LOG_ = '_Mesa';
var MESA_ENC_LOG_ = ['Fecha', 'Quién', 'Lote', 'Fuente', 'Columna', 'Antes', 'Después', 'ID pago'];
var MESA_TTL_ = 21600;   // la llave dura 6 h desde el último uso (se renueva con cada acción)

/* ============================================================ abrir y llave */

function MESA_menuAbrir() {
  var quien = '';
  try { quien = Session.getActiveUser().getEmail(); } catch (e) {}
  var tk = MESA_llaveNueva_(quien || 'hoja de Cobranzas');
  var html = MESA_html_(tk, 'hoja').setWidth(1500).setHeight(900);
  SpreadsheetApp.getUi().showModelessDialog(html, '🧩 Mesa de conciliación');
}

/** Enlace con llave nueva (para la hoja de Vouchers, Telegram y WhatsApp). */
function MESA_enlace_(quien) {
  var url = TG_urlWebApp_();
  if (!url) throw new Error('La aplicación web de Cobranzas aún no está publicada.');
  return url + '?mesa=' + MESA_llaveNueva_(quien);
}

function MESA_llaveNueva_(quien) {
  var tk = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  CacheService.getScriptCache().put('mesa_tk_' + tk, JSON.stringify({ q: String(quien || '').slice(0, 80) }), MESA_TTL_);
  return tk;
}

/** Valida la llave (y la renueva). Devuelve quién la pidió. */
function MESA_ok_(tk) {
  tk = String(tk || '').replace(/[^a-f0-9]/gi, '');
  var c = CacheService.getScriptCache(), v = tk && c.get('mesa_tk_' + tk);
  if (!v) throw new Error('La Mesa venció (más de 6 horas sin usarla). Ciérrela y ábrala de nuevo.');
  c.put('mesa_tk_' + tk, v, MESA_TTL_);
  try { return JSON.parse(v).q || ''; } catch (e) { return ''; }
}

/** doGet(?mesa=llave) */
function MESA_pagina_(tk) {
  try { MESA_ok_(tk); } catch (e) {
    return HtmlService.createHtmlOutput('<p style="font:15px Arial;padding:20px">⏰ ' + e.message.replace(/</g, '&lt;') +
      '<br><br>Pida un enlace nuevo: menú 🧠 Asistente IA → 🧩 Mesa de conciliación, o escriba «mesa» al bot.</p>').setTitle('🧩 Mesa de conciliación');
  }
  return MESA_html_(tk, 'web').setTitle('🧩 Mesa de conciliación').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function MESA_html_(tk, modo) {
  var t = HtmlService.createTemplateFromFile('MesaVista');
  t.TK = tk; t.MODO = modo;
  var url = ''; try { url = TG_urlWebApp_(); } catch (e) {}
  t.URL = url ? url + '?mesa=' + tk : '';
  return t.evaluate();
}

/* ============================================================ datos */

function MESA_fecha_(d) { return d instanceof Date && !isNaN(d.getTime()) ? Utilities.formatDate(d, 'America/Lima', 'yyyy-MM-dd') : ''; }

/**
 * Todo lo que necesita la pantalla para un lado («Por pagar» o «Por cobrar»):
 * {empresas, docs, vouchers, links, sug, ultima}
 */
function MESA_datos(tk, lado) {
  MESA_ok_(tk);
  lado = lado === 'Por cobrar' ? 'Por cobrar' : 'Por pagar';
  var ss = ssPrincipal_(), cfg = leerConfig_(ss);
  var rucDeNombre = {};
  cfg.grupo.forEach(function (r) { rucDeNombre[cfg.nombreEmpresa[r] || r] = r; });
  var empresas = cfg.grupo.map(function (r) { return { ruc: r, nombre: cfg.nombreEmpresa[r] || r }; });

  // ---- 📋 Documentos
  var docs = [], porClave = {};
  var shD = ss.getSheetByName(HOJA.DOCS);
  if (shD && shD.getLastRow() > 1) {
    var n = shD.getLastRow() - 1, enc = shD.getRange(1, 1, 1, shD.getLastColumn()).getValues()[0], c = indiceColumnas_(enc);
    var v = shD.getRange(2, 1, n, enc.length).getValues();
    var iPdf = c('PDF'), fPdf = iPdf >= 0 ? shD.getRange(2, iPdf + 1, n, 1).getFormulas() : null;
    var I = { emp: c('Empresa'), tipo: c('Tipo'), cr: c('RUC contraparte'), cn: c('Contraparte'), doc: c('Documento'), f: c('Emisión'), ve: c('Vence'),
      mon: c('Moneda'), tot: c('Total'), nc: c('N/C'), ret: c('Retención'), det: c('Detracción'), otr: c('Otros desc.'), pag: c('Pagado'),
      sal: c('Saldo'), est: c('Estado'), sire: c('Registro SIRE'), prod: c('Producto'), k: c('Clave') };
    v.forEach(function (r, i) {
      if (r[I.tipo] !== lado || !r[I.k]) return;
      var er = rucDeNombre[r[I.emp]] || '';
      var cr = String(r[I.cr] || '');
      var pdf = '';
      if (fPdf && fPdf[i][0]) { var m = fPdf[i][0].match(/HYPERLINK\("([^"]+)"/i); if (m) pdf = m[1]; }
      var d = {
        k: String(r[I.k]), er: er, cr: cr, cn: String(r[I.cn] || ''), doc: String(r[I.doc] || ''),
        f: MESA_fecha_(r[I.f]), ve: MESA_fecha_(r[I.ve]), mon: String(r[I.mon] || 'PEN'),
        tot: Number(r[I.tot]) || 0, nc: Number(r[I.nc]) || 0, ret: Number(r[I.ret]) || 0, det: Number(r[I.det]) || 0,
        otr: Number(r[I.otr]) || 0, pag: Number(r[I.pag]) || 0, sal: Number(r[I.sal]) || 0, est: String(r[I.est] || ''),
        sire: I.sire >= 0 ? String(r[I.sire] || '') : '', prod: I.prod >= 0 ? String(r[I.prod] || '').slice(0, 120) : '', pdf: pdf,
      };
      // Quién emite y quién recibe (para escribir ID Beneficiario / ID Usuario del voucher)
      if (lado === 'Por pagar') { d.emi = cr; d.rec = er; } else { d.emi = er; d.rec = cr; }
      docs.push(d); porClave[d.k] = d;
    });
  }

  // ---- Vouchers (una vez cada uno: Originales manda, como en el motor)
  var vch = leerVouchers_(cfg);
  var dups = {}, refsDeCopia = {};
  vch.duplicados.forEach(function (d) {
    (dups[d.otra] = dups[d.otra] || []).push(d.fuente);
    if ((d.tomados || []).indexOf('factura') >= 0) refsDeCopia[d.otra] = 1;   // la fila principal tenía «Tipo y Nº Doc.» vacío
  });
  var grupo = {}; cfg.grupo.forEach(function (r) { grupo[r] = 1; });
  var vouchers = [], porId = {};
  vch.pagos.forEach(function (p) {
    var pr = p.pagadorRuc || '', br = p.beneficiarioRuc || '';
    // Por pagar: paga una empresa del grupo (o no se sabe). Por cobrar: le pagan a una empresa del grupo.
    if (lado === 'Por pagar' ? (pr && !grupo[pr]) : !(grupo[br] || (!br && pr && !grupo[pr]))) return;
    var refs = String(p.refs || '').trim(), parse = parsearReferencias_(refs);
    var x = {
      id: p.id, fu: p.fuente, dups: dups[p.fuente] || [], f: MESA_fecha_(p.fecha), op: p.operacion || '', bco: p.banco || '',
      mon: p.moneda || 'PEN', m: p.monto, pr: pr, br: br, bn: p.beneficiarioNombre || '', us: p.usuario || '',
      des: String(p.descripcion || '').slice(0, 120), env: String(p.enviadoPor || '').slice(0, 40), refs: refs,
      antes: refsDeCopia[p.fuente] ? '' : refs,   // lo que dice HOY la celda de la fila principal (para no pisar cambios de otros)
      rl: parse.refs.map(function (q) { return q.tipo + '_' + q.serie + '-' + q.numero; }),
      rm: parse.refs.map(function (q) { return q.monto != null ? q.monto : null; }),   // monto por línea («=1500»)
    };
    if (RX_DEVOLUCION_.test(refs)) x.dev = 1;                                   // ↩️ devolución: no se cruza con facturas
    else if (refs && (parse.noEntendido.length || (!parse.refs.length && refs !== '?'))) x.esp = 1;   // texto especial (PLANILLA, «adelanto»…)
    vouchers.push(x); porId[x.id] = x;
  });

  // ---- Cruces actuales (💳 Movimientos)
  var links = [], rets = [];
  var shM = ss.getSheetByName(HOJA.MOVS);
  if (shM && shM.getLastRow() > 1) {
    var encM = shM.getRange(1, 1, 1, shM.getLastColumn()).getValues()[0], cm = indiceColumnas_(encM);
    var vm = shM.getRange(2, 1, shM.getLastRow() - 1, encM.length).getValues();
    var J = { mod: cm('Modalidad'), m: cm('Monto aplicado'), o: cm('Origen'), k: cm('Clave'), id: cm('ID pago'), op: cm('N° operación'), f: cm('Fecha'), fu: cm('Fuente') };
    var junta = {};
    vm.forEach(function (r) {
      var k = String(r[J.k] || ''), id = String(r[J.id] || '');
      // 🧾 Retenciones de SUNAT (y las ya reasignadas): para el modo «Retenciones»
      if (porClave[k] && r[J.mod] === MODALIDAD.RETENCION && /^(CRE|REASIG)\|/.test(id)) {
        var re = id.match(/^REASIG\|(\d+)\|(.*)$/);
        rets.push({ u: re ? re[2] : id, k: k, m: Number(r[J.m]) || 0, fila: re ? Number(re[1]) : 0, op: String(r[J.op] || ''), f: MESA_fecha_(r[J.f]) });
        return;
      }
      if (!porClave[k] || r[J.mod] !== MODALIDAD.PAGO || !porId[id]) return;
      var kk = id + '\u0001' + k;
      if (junta[kk]) { junta[kk].m = redondear2_(junta[kk].m + (Number(r[J.m]) || 0)); return; }
      junta[kk] = { p: id, k: k, m: Number(r[J.m]) || 0, o: String(r[J.o] || '') };
      links.push(junta[kk]);
    });
  }

  // ---- Sugerencias del motor (✅ Conciliar)
  var sug = [];
  var shC = ss.getSheetByName(HOJA.CONC);
  if (shC && shC.getLastRow() > 1) {
    var dc = shC.getDataRange().getValues(), ec = null;
    dc.forEach(function (r) {
      if (r[0] === '✔ Aplicar') { ec = indiceColumnas_(r); return; }
      if (!ec) return;
      if (typeof r[0] !== 'boolean') { ec = null; return; }   // terminó la tabla de sugerencias
      if (r[1] === true) return;                               // ✖ ya descartada
      var id = String(r[ec('ID pago')] || ''), ks = String(r[ec('Claves')] || '').split(',').filter(function (k) { return porClave[k]; });
      if (porId[id] && ks.length) sug.push({ p: id, ks: ks, n: String(r[ec('Motivo')] || ''), de: 'motor' });
    });
  }

  // ---- 🔁 Reasignar retenciones: filas que ya existen (para quitarlas desde la Mesa)
  var reas = [];
  var shR = ss.getSheetByName(HOJA_REASIGNAR_);
  if (shR && shR.getLastRow() > 3) {
    shR.getRange(4, 1, shR.getLastRow() - 3, 7).getDisplayValues().forEach(function (r, i) {
      if (r[0] || r[2] || r[3]) reas.push({ fila: i + 4, v: r.slice(0, 5), res: r[6] });
    });
  }

  var ultima = '';
  try { ultima = PropertiesService.getScriptProperties().getProperty('MESA_ULTIMA') || ''; } catch (e) {}
  try { ultima = PropertiesService.getDocumentProperties().getProperty('ultimaActualizacion') || ultima; } catch (e) {}
  return { lado: lado, empresas: empresas, docs: docs, vouchers: vouchers, links: links, sug: sug, ultima: ultima, rets: rets, reas: reas,
    modalidades: MODALIDADES_MANUAL_,
    recalculando: !!PropertiesService.getScriptProperties().getProperty('MESA_PEDIDO') };
}

/* ============================================================ guardar */

/**
 * cambios: [{id, fu, dups, antes, refs, quitar:[claves], benef, usu, reemplazar}]
 * Devuelve {mensaje, ok:[id], conflictos:[{id, fu, motivo}]}
 */
function MESA_guardar(tk, cambios) {
  var quien = MESA_ok_(tk);
  cambios = (cambios || []).slice(0, 500);
  if (!cambios.length) return { mensaje: 'No hay cambios.', ok: [], conflictos: [] };
  var ss = ssPrincipal_(), cfg = leerConfig_(ss);
  var ssV = SpreadsheetApp.openById(cfg.idVouchers);
  var lote = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4);
  var ahora = new Date(), firma = '🧩 Mesa · ' + (quien || '¿?') + ' · ' + Utilities.formatDate(ahora, 'America/Lima', 'dd/MM/yyyy HH:mm');
  var hojas = {}, log = [], dec = [], ok = [], conflictos = [], avisos = [];

  function hoja(nombre) {
    if (hojas[nombre]) return hojas[nombre];
    var sh = ssV.getSheetByName(nombre);
    if (!sh) return (hojas[nombre] = null);
    var c = indiceColumnas_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
    return (hojas[nombre] = { sh: sh, refs: c('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc'), benef: c('ID Beneficiario'), usu: c('ID Usuario') });
  }
  function celda(fuente, cual) {
    var p = String(fuente).split('!'), h = hoja(p[0]);
    if (!h || h[cual] < 0) return null;
    return h.sh.getRange(parseInt(p[1], 10), h[cual] + 1);
  }
  function escribir(rg, fuente, columna, antes, despues, id, texto) {
    if (String(despues) === String(antes)) return;
    if (/^\d{8,11}$/.test(String(despues))) rg.setNumberFormat('@');
    rg.setValue(despues);
    try { rg.setNote(firma + (texto ? '\n' + texto : '') + (antes !== '' ? '\nAntes: ' + antes : '')); } catch (e) {}
    log.push([ahora, quien, lote, fuente, columna, String(antes), String(despues), id]);
  }

  cambios.forEach(function (x) {
    try {
      var rR = celda(x.fu, 'refs');
      if (!rR) { conflictos.push({ id: x.id, fu: x.fu, motivo: 'No encontré la columna «Tipo y Nº Doc.» en ' + x.fu }); return; }
      var actual = String(rR.getDisplayValue() || '').trim();
      if (actual !== String(x.antes || '').trim()) {
        conflictos.push({ id: x.id, fu: x.fu, motivo: 'Otra persona cambió «Tipo y Nº Doc.» mientras usted trabajaba (ahora dice «' + actual + '»). Recargue y revise.' });
        return;
      }
      var nuevo = String(x.refs || '').trim();
      escribir(rR, x.fu, 'Tipo y Nº Doc.', actual, nuevo, x.id, nuevo ? 'Facturas: ' + nuevo : 'Se quitaron las facturas');
      // Copias del mismo voucher (Fotos): si tienen facturas escritas, se dejan iguales (si no, el motor tomaría las viejas)
      (x.dups || []).forEach(function (fu) {
        var rd = celda(fu, 'refs');
        if (!rd) return;
        var a = String(rd.getDisplayValue() || '').trim();
        if (a && a !== nuevo && !RX_DEVOLUCION_.test(a)) escribir(rd, fu, 'Tipo y Nº Doc.', a, nuevo, x.id, 'Igual que ' + x.fu);
      });
      if (nuevo && x.benef) {
        var rB = celda(x.fu, 'benef');
        if (rB) {
          var b = aRuc_(rB.getValue());
          if (!b) escribir(rB, x.fu, 'ID Beneficiario', '', String(x.benef), x.id, 'RUC del emisor de la factura');
          else if (b !== x.benef) {
            if (x.reemplazar) escribir(rB, x.fu, 'ID Beneficiario', b, String(x.benef), x.id, 'Reemplazado: el emisor de la factura es ' + x.benef);
            else avisos.push(x.fu + ': ID Beneficiario dice ' + b + ' y la factura es de ' + x.benef + ' (no lo cambié).');
          }
        }
      }
      if (nuevo && x.usu) {
        var rU = celda(x.fu, 'usu');
        if (rU && !aRuc_(rU.getValue())) escribir(rU, x.fu, 'ID Usuario', '', String(x.usu), x.id, 'Empresa que paga (receptor de la factura)');
      }
      // Cruces automáticos quitados: que el motor no los vuelva a poner
      (x.quitar || []).forEach(function (k) { dec.push([x.id + '#NO#' + k, 'NO', k, ahora]); });
      if (!nuevo) dec.push([x.id, 'NO', '', ahora]);   // anula un ✔ confirmado anterior
      ok.push(x.id);
    } catch (e) {
      conflictos.push({ id: x.id, fu: x.fu, motivo: e.message });
    }
  });

  if (dec.length) {
    var shDec = obtenerOCrearHoja_(ss, HOJA.DECISIONES);
    shDec.getRange(shDec.getLastRow() + 1, 1, dec.length, 4).setValues(dec);
    dec.forEach(function (d) { log.push([ahora, quien, lote, '_Decisiones', 'Decisión', '', d[0] + ' = NO', d[0].split('#')[0]]); });
  }
  if (log.length) {
    var shL = MESA_hojaLog_(ss);
    shL.getRange(shL.getLastRow() + 1, 1, log.length, MESA_ENC_LOG_.length).setValues(log);
    MESA_programarRecalculo_();
  }
  var msg = '💾 Guardado: ' + ok.length + ' voucher(s)' + (conflictos.length ? ' · ⚠️ ' + conflictos.length + ' sin guardar' : '') +
    (log.length ? ' · Cobranzas se recalcula en ~1 minuto.' : ' (no había nada distinto).');
  return { mensaje: msg, ok: ok, conflictos: conflictos, avisos: avisos, lote: log.length ? lote : '' };
}

/**
 * 🔁 Reasignar retenciones desde la Mesa: escribe (o borra) filas en la pestaña 🔁 Reasignar retenciones, igual
 * que a mano. nuevos: [{cre, agente, origen, destino, monto}] · quitar: [{fila, antes:[A..E]}]
 */
function MESA_reasignar(tk, nuevos, quitar) {
  var quien = MESA_ok_(tk);
  var ss = ssPrincipal_(), sh = hojaReasignar_(ss);
  var lote = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4);
  var ahora = new Date(), log = [], hechos = 0, avisos = [];
  (quitar || []).forEach(function (q) {
    var fila = Number(q.fila);
    if (!(fila >= 4)) return;
    var rg = sh.getRange(fila, 1, 1, 5), actual = rg.getDisplayValues()[0];
    if (JSON.stringify(actual.map(String)) !== JSON.stringify((q.antes || []).map(String))) { avisos.push('Fila ' + fila + ' cambió desde que abrió la Mesa: no la borré.'); return; }
    var crudo = rg.getValues()[0];
    sh.getRange(fila, 1, 1, 7).clearContent();
    log.push([ahora, quien, lote, HOJA_REASIGNAR_ + '!' + fila, 'Fila borrada', JSON.stringify(crudo), '', '']);
    hechos++;
  });
  (nuevos || []).forEach(function (x) {
    if (!x.cre || !x.origen || !x.destino) return;
    var fila = Math.max(4, sh.getLastRow() + 1);
    var valores = [String(x.cre), String(x.agente || ''), String(x.origen), String(x.destino), Number(x.monto) > 0 ? redondear2_(Number(x.monto)) : '',
      '🧩 Mesa · ' + (quien || '') + ' · ' + Utilities.formatDate(ahora, 'America/Lima', 'dd/MM/yyyy HH:mm')];
    sh.getRange(fila, 1, 1, 4).setNumberFormat('@');
    sh.getRange(fila, 1, 1, 6).setValues([valores]);
    log.push([ahora, quien, lote, HOJA_REASIGNAR_ + '!' + fila, 'Fila nueva', '', JSON.stringify(valores), '']);
    hechos++;
  });
  if (log.length) { var shL = MESA_hojaLog_(ss); shL.getRange(shL.getLastRow() + 1, 1, log.length, MESA_ENC_LOG_.length).setValues(log); MESA_programarRecalculo_(); }
  return { mensaje: '🔁 Retenciones: ' + hechos + ' cambio(s) en «' + HOJA_REASIGNAR_ + '»' + (hechos ? ' · Cobranzas se recalcula en ~1 minuto.' : '') + (avisos.length ? ' · ⚠️ ' + avisos.join(' ') : ''), lote: log.length ? lote : '', avisos: avisos };
}

/**
 * ✍️ Pago sin voucher (efectivo, compensación, retención o detracción manual…): una fila en ✍️ Registro manual,
 * igual que a mano. x = {fecha:'yyyy-mm-dd', modalidad, pagador, benef, doc, monto, moneda, op, banco, obs}
 */
function MESA_manual(tk, x) {
  var quien = MESA_ok_(tk);
  x = x || {};
  var monto = Number(x.monto);
  if (!(monto > 0)) return { error: 'Escriba un monto mayor a cero.' };
  if (!parsearReferencias_(x.doc).refs.length) return { error: 'Falta la factura (ej. 01_E001-123).' };
  if (MODALIDADES_MANUAL_.indexOf(x.modalidad) < 0) return { error: 'Elija la modalidad.' };
  var m = String(x.fecha || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  var fecha = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  var ss = ssPrincipal_(), sh = ss.getSheetByName(HOJA.MANUAL);
  if (!sh) return { error: 'Falta la hoja ' + HOJA.MANUAL + ' (⚙️ Instalar / reparar).' };
  // primera fila libre (columna Documento y Monto vacías)
  var n = Math.max(sh.getLastRow(), 1), v = n > 1 ? sh.getRange(2, 1, n - 1, 6).getValues() : [], fila = n + 1;
  for (var i = 0; i < v.length; i++) { if (!v[i][4] && !v[i][5] && !v[i][0]) { fila = i + 2; break; } }
  var ahora = new Date();
  var valores = [fecha, x.modalidad, String(x.pagador || ''), String(x.benef || ''), String(x.doc), redondear2_(monto), String(x.moneda || 'PEN'),
    String(x.op || ''), String(x.banco || (/efectivo/i.test(x.modalidad) ? 'EFECTIVO' : '')),
    (String(x.obs || '').trim() ? String(x.obs).trim() + ' · ' : '') + '🧩 Mesa · ' + (quien || '') + ' · ' + Utilities.formatDate(ahora, 'America/Lima', 'dd/MM/yyyy HH:mm')];
  sh.getRange(fila, 3, 1, 2).setNumberFormat('@');
  sh.getRange(fila, 1, 1, 10).setValues([valores]);
  var shL = MESA_hojaLog_(ss), lote = Utilities.formatDate(ahora, 'America/Lima', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4);
  shL.getRange(shL.getLastRow() + 1, 1, 1, MESA_ENC_LOG_.length).setValues([[ahora, quien, lote, HOJA.MANUAL + '!' + fila, 'Fila nueva', '', JSON.stringify(valores.map(function (z) { return z instanceof Date ? Utilities.formatDate(z, 'America/Lima', 'dd/MM/yyyy') : z; })), '']]);
  MESA_programarRecalculo_();
  return { mensaje: '✍️ Registrado en ' + HOJA.MANUAL + ' (fila ' + fila + '): ' + x.modalidad + ' ' + (x.moneda || 'PEN') + ' ' + redondear2_(monto).toFixed(2) + ' a ' + x.doc + '. Cobranzas se recalcula en ~1 minuto.', fila: fila, lote: lote };
}

function MESA_hojaLog_(ss) {
  var sh = ss.getSheetByName(MESA_HOJA_LOG_);
  if (!sh) {
    sh = ss.insertSheet(MESA_HOJA_LOG_);
    sh.getRange(1, 1, 1, MESA_ENC_LOG_.length).setValues([MESA_ENC_LOG_]).setFontWeight('bold');
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}

/** ↩️ Deshacer el último guardado de esta persona (solo lo que nadie cambió después). */
function MESA_deshacer(tk) {
  var quien = MESA_ok_(tk);
  var ss = ssPrincipal_(), sh = ss.getSheetByName(MESA_HOJA_LOG_);
  if (!sh || sh.getLastRow() < 2) return { mensaje: 'No hay nada guardado desde la Mesa.' };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, MESA_ENC_LOG_.length).getValues();
  // El guardado más reciente de esta persona que todavía no se deshizo (se puede deshacer uno tras otro)
  var deshechos = {}, lote = '';
  v.forEach(function (r) { if (/^↩️ /.test(String(r[2]))) deshechos[String(r[2]).slice(3)] = 1; });
  for (var i = v.length - 1; i >= 0; i--) {
    var l = String(v[i][2]);
    if (String(v[i][1]) === quien && !/^↩️/.test(l) && !deshechos[l]) { lote = l; break; }
  }
  if (!lote) return { mensaje: 'No encontré cambios suyos (sin deshacer) para deshacer.' };
  var cfg = leerConfig_(ss), ssV = SpreadsheetApp.openById(cfg.idVouchers), cols = {};
  var filas = v.filter(function (r) { return String(r[2]) === lote; }).reverse();
  var hechos = 0, saltados = [], log = [], ahora = new Date();
  filas.forEach(function (r) {
    var fuente = String(r[3]), columna = String(r[4]);
    if (columna === 'Fila nueva' || columna === 'Fila borrada') {   // ✍️ Registro manual / 🔁 Reasignar (en esta hoja)
      var q = fuente.split('!'), shX = ss.getSheetByName(q[0]), fx = parseInt(q[1], 10);
      if (!shX) return;
      var ncol = q[0] === HOJA.MANUAL ? 10 : 6;
      var rgx = shX.getRange(fx, 1, 1, ncol), act = rgx.getValues()[0].map(function (c) {
        return c instanceof Date ? Utilities.formatDate(c, 'America/Lima', 'dd/MM/yyyy') : c;
      });
      if (columna === 'Fila nueva') {
        var esperado = JSON.parse(String(r[6]) || '[]');
        var igual = act.every(function (c, i) {
          var e = esperado[i];
          if (e == null) return true;
          if (typeof e === 'number') return Math.abs(aNumero_(c) - e) < 0.005;
          return String(c).trim() === String(e).trim();
        });
        if (!igual) { saltados.push(fuente + ' (alguien la cambió)'); return; }
        shX.getRange(fx, 1, 1, q[0] === HOJA.MANUAL ? 10 : 7).clearContent();
      } else {
        if (act.some(function (c) { return String(c == null ? '' : c).trim(); })) { saltados.push(fuente + ' (ya tiene otros datos)'); return; }
        var vals = JSON.parse(String(r[5]) || '[]');
        if (vals.length) shX.getRange(fx, 1, 1, vals.length).setValues([vals]);
      }
      log.push([ahora, quien, '↩️ ' + lote, fuente, columna, String(r[6]), String(r[5]), '']);
      hechos++;
      return;
    }
    if (fuente === '_Decisiones') {
      var shDec = ss.getSheetByName(HOJA.DECISIONES), clave = String(r[6]).replace(/ = NO$/, '');
      if (!shDec || shDec.getLastRow() < 2) return;
      var dv = shDec.getRange(2, 1, shDec.getLastRow() - 1, 2).getValues();
      for (var j = dv.length - 1; j >= 0; j--) {
        if (String(dv[j][0]) === clave && dv[j][1] === 'NO') { shDec.deleteRow(j + 2); hechos++; break; }
      }
      return;
    }
    var p = fuente.split('!'), shV = ssV.getSheetByName(p[0]);
    if (!shV) return;
    if (!cols[p[0]]) cols[p[0]] = indiceColumnas_(shV.getRange(1, 1, 1, shV.getLastColumn()).getValues()[0]);
    var ci = columna === 'Tipo y Nº Doc.' ? cols[p[0]]('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc') : cols[p[0]](columna);
    if (ci < 0) return;
    var rg = shV.getRange(parseInt(p[1], 10), ci + 1), actual = String(rg.getDisplayValue() || '').trim();
    if (actual !== String(r[6]).trim()) { saltados.push(fuente + ' (' + columna + ' ya dice «' + actual + '»)'); return; }
    rg.setValue(r[5]);
    try { rg.setNote('↩️ Deshecho desde la Mesa · ' + quien + ' · ' + Utilities.formatDate(ahora, 'America/Lima', 'dd/MM/yyyy HH:mm')); } catch (e) {}
    log.push([ahora, quien, '↩️ ' + lote, fuente, columna, String(r[6]), String(r[5]), r[7]]);
    hechos++;
  });
  if (!log.length) log.push([ahora, quien, '↩️ ' + lote, '', '', '', '', '']);
  sh.getRange(sh.getLastRow() + 1, 1, log.length, MESA_ENC_LOG_.length).setValues(log);
  MESA_programarRecalculo_();
  return { mensaje: '↩️ Deshice ' + hechos + ' cambio(s) del guardado ' + lote + (saltados.length ? '. No toqué ' + saltados.length + ' porque alguien los cambió después: ' + saltados.slice(0, 5).join('; ') : '') + '. Cobranzas se recalcula en ~1 minuto.' };
}

/* ============================================================ recálculo después de guardar */

function MESA_programarRecalculo_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('MESA_PEDIDO', String(Date.now()));
  var ya = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'MESA_recalcular'; });
  if (!ya) ScriptApp.newTrigger('MESA_recalcular').timeBased().after(30 * 1000).create();
}

function MESA_recalcular() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'MESA_recalcular') ScriptApp.deleteTrigger(t); });
  var props = PropertiesService.getScriptProperties(), pedido = props.getProperty('MESA_PEDIDO');
  var r = '';
  try { r = actualizarTodo_(true); } catch (e) { r = 'ERROR ' + e.message; }
  if (/en curso/.test(r)) { ScriptApp.newTrigger('MESA_recalcular').timeBased().after(60 * 1000).create(); return; }
  if (props.getProperty('MESA_PEDIDO') === pedido) props.deleteProperty('MESA_PEDIDO');
  else ScriptApp.newTrigger('MESA_recalcular').timeBased().after(30 * 1000).create();   // alguien guardó mientras tanto
  props.setProperty('MESA_ULTIMA', new Date().toISOString());
}

/** La página pregunta si ya terminó el recálculo. */
function MESA_estado(tk) {
  MESA_ok_(tk);
  var p = PropertiesService.getScriptProperties();
  return { recalculando: !!p.getProperty('MESA_PEDIDO'), ultima: p.getProperty('MESA_ULTIMA') || '' };
}

/* ============================================================ ver voucher y factura */

/** Archivo para ver en la Mesa: {nombre, mime, b64} o {url} o {error}. tipo = 'v' (fuente) | 'f' (enlace PDF). */
function MESA_archivo(tk, tipo, ref) {
  MESA_ok_(tk);
  var ss = ssPrincipal_(), cfg = leerConfig_(ss);
  try {
    if (tipo === 'f') {
      var id = (String(ref).match(/[-\w]{25,}/) || [])[0];
      if (!id) return { url: String(ref) };
      return MESA_blob_(DriveApp.getFileById(id).getBlob(), String(ref));
    }
    var p = String(ref).split('!'), sh = SpreadsheetApp.openById(cfg.idVouchers).getSheetByName(p[0]);
    if (!sh) return { error: 'No existe la pestaña ' + p[0] };
    var fila = parseInt(p[1], 10), enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], c = indiceColumnas_(enc);
    var iArch = c('Archivo Original'), iPag = c('Pagina', 'Página');
    var archivo = iArch >= 0 ? String(sh.getRange(fila, iArch + 1).getValue() || '').trim() : '';
    var pagina = iPag >= 0 ? sh.getRange(fila, iPag + 1).getValue() : '';
    var norm = enc.map(normHeader_), celdaImg = null;
    for (var i = 0; i < norm.length; i++) {
      if (!/^voucher imagen|^imagen/.test(norm[i])) continue;
      var val = sh.getRange(fila, i + 1).getValue();
      if (val && typeof val === 'object' && typeof val.getContentUrl === 'function') { celdaImg = val; break; }
    }
    // Varios archivos con el mismo nombre: la imagen de la celda es la de ESTA fila
    var archivos = [];
    if (archivo) { var it = DriveApp.getFilesByName(archivo); while (it.hasNext() && archivos.length < 5) archivos.push(it.next()); }
    archivos.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    var info = { archivo: archivo, pagina: pagina, varios: archivos.length > 1 ? archivos.length : 0 };
    if (archivos.length === 1 || (archivos.length > 1 && !celdaImg)) {
      var r = MESA_blob_(archivos[0].getBlob(), archivos[0].getUrl());
      for (var k in info) r[k] = info[k];
      return r;
    }
    if (celdaImg) {
      var u = celdaImg.getContentUrl();
      try {
        var resp = UrlFetchApp.fetch(u, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
        if (resp.getResponseCode() === 200) { var rr = MESA_blob_(resp.getBlob(), ''); for (var k2 in info) rr[k2] = info[k2]; return rr; }
      } catch (e) {}
      info.url = u; return info;
    }
    info.error = 'No encontré la imagen ni el archivo «' + archivo + '» en Drive.';
    return info;
  } catch (e) {
    return { error: e.message };
  }
}

function MESA_blob_(blob, url) {
  var b = blob.getBytes();
  if (b.length > 12 * 1024 * 1024) return { url: url, error: 'El archivo es muy grande para verlo aquí (' + Math.round(b.length / 1048576) + ' MB).' };
  return { nombre: blob.getName(), mime: blob.getContentType(), b64: Utilities.base64Encode(b), url: url };
}

/* ============================================================ 🤖 IA y 🔎 RUC */

/**
 * La IA propone qué facturas paga cada voucher de UNA contraparte y empresa (la misma IA de 🤝 Conciliar con IA).
 * vids: vouchers a conciliar; ks: facturas candidatas (con saldo). Devuelve [{p, ks, n, conf}] (líneas punteadas).
 */
function MESA_ia(tk, vouchers, docs, contra) {
  MESA_ok_(tk);
  var ss = ssPrincipal_();
  var ia = CIA_ia_(CIA_hoja_(ss));
  if (!ia.clave) return { error: 'Falta la clave de IA: menú 🧠 Asistente IA → 🔑 Guardar clave de IA (de esta pestaña).' };
  var f = function (s) { var m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  var gv = (vouchers || []).slice(0, 40).map(function (v) {
    return { p: { fecha: f(v.f), banco: v.bco, operacion: v.op, monto: Number(v.m) || 0, moneda: v.mon, beneficiarioNombre: v.bn, descripcion: v.des }, regla: null, det: { ruc: contra.ruc || 'x', candidatos: [] } };
  });
  var ds = (docs || []).slice(0, 150).map(function (d) {
    return { doc: d.doc, k: d.k, emision: f(d.f), vence: f(d.ve), total: +d.tot || 0, nc: +d.nc || 0, retencion: +d.ret || 0, detraccion: +d.det || 0, pagado: +d.pag || 0, saldo: +d.sal || 0, moneda: d.mon };
  });
  if (!gv.length || !ds.length) return { error: 'Elija un proveedor (o cliente) con vouchers sin aplicar y facturas con saldo.' };
  var r = CIA_preguntarIA_(ia, gv, ds, { porCobrar: !!contra.porCobrar, nombre: contra.nombre || '', ruc: contra.ruc || '', empresa: contra.empresa || '' });
  var out = [];
  Object.keys(r).forEach(function (i) {
    var a = r[i];
    if (!a.docs.length) return;
    out.push({ p: vouchers[i].id, ks: a.docs.map(function (d) { return d.k; }), n: '🤖 ' + a.tipo + ' · ' + a.confianza + '% · ' + a.motivo, conf: a.confianza, de: 'ia' });
  });
  return { sug: out, mensaje: '🤖 La IA propuso ' + out.length + ' cruce(s) para ' + gv.length + ' voucher(s).' };
}

function MESA_filas_(fuentes) {
  return (fuentes || []).slice(0, 300).filter(function (f) { return /^[^!]+!\d+$/.test(String(f)); });
}
function MESA_rucRapido(tk, fuentes) { MESA_ok_(tk); return TGQ_rucDeFilas_(ssPrincipal_(), MESA_filas_(fuentes)); }
function MESA_rucAplicar(tk, ids) { MESA_ok_(tk); return ANX_aplicarDet_(ssPrincipal_(), ids || [], false); }
function MESA_rucExternos(tk, fuentes) { MESA_ok_(tk); return TGQ_rucExternos_(ssPrincipal_(), MESA_filas_(fuentes)); }
function MESA_rucEstado(tk, id) { MESA_ok_(tk); return TGQ_rucEstado_(String(id || '')); }
function MESA_rucOtro(tk, nombre, filas) { MESA_ok_(tk); return TGQ_rucOtroNombre_(ssPrincipal_(), nombre, filas); }
function MESA_rucElegir(tk, prov, filas, ruc, det) { MESA_ok_(tk); return TGQ_rucElegirFilas_(ssPrincipal_(), prov, filas, ruc, det); }

/* ============================================================ Telegram / WhatsApp: «mesa» */

var MESA_RX_ = /^\s*\/?(mesa|mesa de conciliaci[oó]n|abrir (la )?mesa)\s*[.!]?\s*$/i;

function MESA_textoEnlace_(quien) {
  var url = MESA_enlace_(quien);
  return { url: url, texto: '🧩 Mesa de conciliación (facturas ↔ vouchers). Ábrala aquí (vale 6 horas desde el último uso; no la reenvíe):\n' + url };
}
