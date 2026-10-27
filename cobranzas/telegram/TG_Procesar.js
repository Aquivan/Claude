/**
 * 🧾 Procesar documento — un PDF o foto con voucher, factura, orden de compra, guía… (Telegram y WhatsApp).
 *
 *  1. La IA lee CADA página y dice qué es (voucher, factura, orden de compra, guía, otro).
 *  2. Cada voucher se busca en la hoja de Vouchers (N° de operación, o monto y fecha).
 *  3. Se empareja con la factura del mismo archivo (el pago puede ser el total o el total menos la
 *     retención del 3 % o la que diga la factura).
 *  4. Resumen + un botón ✅. Según el caso:
 *     - Voucher NO registrado: se separa SOLO su página (las demás no ensucian la hoja), se nombra
 *       "21-10-26 Nombre.pdf" (🏷, sin repetir) y va a la carpeta de Entrada; la hoja de Vouchers lo
 *       registra (imagen en la celda, archivo a Procesados) y después se completa la factura.
 *     - Registrado sin factura: solo se completa la factura (empresa, RUC del proveedor, factura).
 *     - Registrado y completo: nada que hacer.
 *     El archivo original queda en la carpeta temporal (se borra sola a los 7 días).
 *  5. Todo queda anotado para ↩️ Deshacer (TG_Deshacer.js).
 * Separar páginas y esperar el registro corre aparte (disparador TGP_trabajar, cada minuto mientras
 * haya trabajo), porque pdf-lib es asíncrono y la hoja de Vouchers tarda en procesar.
 */

var TGP_PROP_JOB_ = 'TGP_JOB_';
var TGP_PROP_MSG_ = 'TGP_MSG_';
var TGP_ESPERA_MAX_MIN_ = 45;
var TGP_SISTEMA_ = ANX_SISTEMA_ADJ_ + '\n' +
  'Agrega a cada documento: "pagina" = número de página del PDF donde está (1, 2…; en una foto, 1); ' +
  '"retencion" = monto de retención que figure en el documento (0 si no); "detraccion" = monto de detracción que figure (0 si no). ' +
  'Una orden de compra es tipo "orden de compra". El ticket o constancia de un depósito o transferencia es "voucher".';
var TGP_NOMBRES_TIPO_ = { voucher: 'voucher', factura: 'factura', boleta: 'boleta', 'orden de compra': 'orden de compra', guia: 'guía', 'guía': 'guía' };

function TGP_ctx_(ss) {
  var c = ANA_ctx_(ss);
  c.ia = AUD_ia_(ss, AUD_leerParam_(AUD_hoja_(ss), c.cfg));
  if (!c.ia.clave) throw new Error('falta la clave de IA (menú 🤝 Conciliar con IA → 🔑 Guardar clave de IA).');
  return c;
}

/** Lo que trae un archivo, página por página (la lectura se guarda: el mismo archivo no se vuelve a pagar). */
function TGP_leer_(c, adj) {
  var f = DriveApp.getFileById(adj.id), blob = f.getBlob(), mime = f.getMimeType();
  if (!/^image\/|pdf/i.test(mime)) return { error: 'solo fotos o PDF' };
  var bytes = blob.getBytes();
  var clave = hashTexto_('tgp|' + bytes.length + '|' + Utilities.base64Encode(bytes.slice(0, 3000)));
  var cache = AUV_cache_(c.ss), r = AUV_cacheGet_(cache, 'tgp', clave);
  if (!r) {
    r = IA_llamarSeguro_(c.ia, { sistema: TGP_SISTEMA_, maxTokens: 8000,
      adjunto: { mime: /pdf/i.test(mime) ? 'application/pdf' : mime, base64: Utilities.base64Encode(bytes) },
      texto: 'ARCHIVO: ' + adj.nombre + '\nExtrae todos los documentos que contiene, con su página.' });
    AUV_cachePut_(cache, 'tgp', clave, r);
    AUV_cacheGuardar_(cache);
  }
  return { docs: Array.isArray(r.documentos) ? r.documentos : [], obs: (r.legible === false ? 'ilegible. ' : '') + String(r.observaciones || ''), mime: mime };
}

function TGP_tipo_(d) {
  var t = String(d.tipo || '').toLowerCase();
  if (/voucher|constancia de (dep|transf|pago)|transferencia|dep[oó]sito/.test(t)) return 'voucher';
  if (/factura/.test(t)) return 'factura';
  return t || 'otro';
}

/** Factura que paga este voucher: total, total − retención (la del documento o 3 %), total − detracción. */
function TGP_emparejar_(v, facturas) {
  var m = AUV_num_(v.monto);
  var mejor = null;
  facturas.forEach(function (f) {
    var tot = AUV_num_(f.monto);
    if (!tot) return;
    var ret = AUV_num_(f.retencion) || 0, det = AUV_num_(f.detraccion) || 0;
    var opciones = [[tot, 'el total'], [tot - (ret || Math.round(tot * 3) / 100), 'el total menos la retención'], [tot - det, 'el total menos la detracción']];
    opciones.forEach(function (o) {
      if (!mejor && o[0] > 0 && Math.abs(o[0] - m) <= 0.05) mejor = { f: f, como: o[1] + ' (' + o[0].toFixed(2) + ')' };
    });
  });
  if (!mejor && facturas.length === 1) mejor = { f: facturas[0], como: '⚠️ el monto no cuadra con la factura: revíselo', noCuadra: true };
  return mejor;
}

/** Datos de la factura para la hoja: empresa del grupo, RUC del otro y "01_E001-4054". */
function TGP_datosFactura_(c, f) {
  if (!f) return null;
  var emi = aRuc_(f.ruc_emisor), rec = aRuc_(f.ruc_receptor), grupo = c.cfg.grupo || [];
  var compra = grupo.indexOf(rec) >= 0, venta = !compra && grupo.indexOf(emi) >= 0;
  return { serie: String(f.serie_numero || '').trim(), empresa: compra ? rec : venta ? emi : '', proveedor: compra ? emi : '',
    emisor: f.emisor || '', receptor: f.receptor || '', total: AUV_num_(f.monto), retencion: AUV_num_(f.retencion) || 0 };
}

/**
 * Lee los archivos y arma el plan. adjs = [{id, nombre, mime}] (archivos ya en Drive).
 * op = {canal:'tg'|'wa', destino, clave}. Devuelve {texto (HTML), k, hayAcciones, hayNuevos}.
 */
function TGP_analizar_(ss, adjs, op) {
  var c = TGP_ctx_(ss);
  var items = [], resumenArch = [], facturasTodas = [];
  var leidos = adjs.map(function (a) {
    var r;
    try { r = TGP_leer_(c, a); } catch (e) { r = { error: e.message }; }
    return { a: a, r: r };
  });
  leidos.forEach(function (x) {
    if (x.r.error) { resumenArch.push('⚠️ ' + TG_esc_(x.a.nombre) + ': ' + TG_esc_(x.r.error)); return; }
    var docs = x.r.docs;
    resumenArch.push('📄 <i>' + TG_esc_(x.a.nombre) + '</i>: ' + (docs.length ? docs.map(function (d) {
      var t = TGP_tipo_(d);
      return (TGP_NOMBRES_TIPO_[t] || t) + (t === 'factura' && d.serie_numero ? ' ' + TG_esc_(d.serie_numero) : '') + (d.pagina ? ' (p. ' + d.pagina + ')' : '');
    }).join(', ') : 'no encontré documentos') + (x.r.obs ? '\n   <i>' + TG_esc_(x.r.obs) + '</i>' : ''));
    docs.filter(function (d) { return TGP_tipo_(d) === 'factura'; }).forEach(function (f) { facturasTodas.push(f); });
  });
  var vouchers = [];
  leidos.forEach(function (x) {
    (x.r.docs || []).filter(function (d) { return TGP_tipo_(d) === 'voucher'; }).forEach(function (d) { vouchers.push({ a: x.a, d: d, mime: x.r.mime }); });
  });
  var cruce = { filas: vouchers.length ? TGP_buscarVouchers_(c, vouchers) : [] };   // búsqueda directa en la hoja (rápida)
  var libro = vouchers.length ? SpreadsheetApp.openById(c.cfg.idVouchers) : null;
  vouchers.forEach(function (v, i) {
    var fila = cruce.filas[i] || [], estado = String(fila[4] || ''), fuente = String(fila[6] || '');
    var par = TGP_emparejar_(v.d, facturasTodas);
    var fac = par ? TGP_datosFactura_(c, par.f) : null;
    var it = { n: i + 1, archivo: v.a, mime: v.mime, pagina: Number(v.d.pagina) || 0, fac: fac, cuadra: par ? par.como : '',
      v: { fecha: v.d.fecha || '', monto: AUV_num_(v.d.monto), moneda: v.d.moneda || 'PEN', operacion: String(v.d.operacion || ''), banco: v.d.banco || '',
        ordenante: v.d.ordenante || '', beneficiario: v.d.beneficiario || '' } };
    if (/^❌/.test(estado)) it.tipo = 'nuevo';
    else if (/^⚠️/.test(estado) || !fuente) { it.tipo = 'dudoso'; it.estado = estado.replace(/^⚠️\s*/, ''); }
    else {
      it.fuente = fuente;
      it.facturaActual = TGP_celda_(libro, fuente, ['Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc']);
      it.tipo = !it.facturaActual && fac && fac.serie ? 'completar' : 'listo';
    }
    if (it.tipo === 'nuevo') {
      var sug = TGE_nombreDeOrdenante_(TGE_ordenanteReal_(it.v.ordenante, it.v.beneficiario));
      it.nombre = sug ? sug.nombre : 'Voucher';
      it.ordenante = sug ? sug.ordenante : '';
    }
    items.push(it);
  });
  // Una sola fecha y nombre para todos los nuevos (como una tanda); se cambia con 🏷.
  var nuevos = items.filter(function (x) { return x.tipo === 'nuevo'; });
  var plan = { t: 'procesar', canal: op.canal, destino: op.destino, clave: op.clave, adjs: adjs, items: items,
    nombre: op.nombre || (nuevos.length ? nuevos[0].nombre : ''), ordenante: op.nombre ? '' : (nuevos.length ? nuevos[0].ordenante : ''),
    fecha: op.fecha || TGE_hoy_(), resumen: resumenArch, pestana: /^(foto|original)$/.test(op.pestana || '') ? op.pestana : '' };
  var k = TG_guardarBoton_(plan);
  var res = TGP_texto_(k, plan);
  var conFila = items.filter(function (x) { return x.fuente; })[0];   // 🧾 para "completa / emite la retención de la factura" sin decir cuál (TG_Retener.js)
  TGR_guardarUltimo_(op.clave, { doc: (facturasTodas[0] || {}).serie_numero || '', fila: conFila ? conFila.fuente : '' });
  TGP_recordar_(op.clave, adjs, facturasTodas, items, res.texto);
  return res;
}

/**
 * 🧠 Lo que se encontró queda en la memoria de la IA de ese chat: así "¿esta factura ya está retenida?"
 * (o responder al resumen) se entiende aunque la IA no haya hecho el análisis.
 */
function TGP_recordar_(clave, adjs, facturas, items, html) {
  var hechos = facturas.map(function (f) {
    return 'Factura ' + (f.serie_numero || '?') + (f.fecha ? ' del ' + f.fecha : '') + ' emitida por ' + (f.emisor || '?') + ' (RUC ' + (f.ruc_emisor || '?') + ')' +
      ' a ' + (f.receptor || '?') + ' (RUC ' + (f.ruc_receptor || '?') + ')' + (f.monto ? ', total ' + (f.moneda || '') + ' ' + f.monto : '') +
      (f.retencion ? ', retención indicada ' + f.retencion : '') + (f.detraccion ? ', detracción indicada ' + f.detraccion : '');
  }).concat(items.map(function (it) {
    return 'Voucher ' + it.v.banco + ' op ' + it.v.operacion + ' del ' + it.v.fecha + ' por ' + it.v.moneda + ' ' + it.v.monto +
      (it.fuente ? ': ya registrado en ' + it.fuente + (it.facturaActual ? ' con factura ' + it.facturaActual : '') : it.tipo === 'nuevo' ? ': todavía NO registrado' : ': dudoso') +
      (it.fac && it.fac.serie ? ' (paga la factura ' + it.fac.serie + ')' : '');
  }));
  TG_recordarEnChat_(clave, '(mandé ' + adjs.length + ' archivo(s) y el bot los revisó con 🧾 Procesar documento)',
    (hechos.length ? hechos.join('.\n') + '.\n\n' : '') + TG_plano_(html, 1200));
}

/**
 * ¿Ya está cada voucher en la hoja de Vouchers? Busca directo en sus pestañas (N° de operación,
 * o monto y fecha ±5 días), sin cargar todo el sistema. Filas como las de cruzar_vouchers:
 * [ref, fecha, monto, operacion, estado, coincide_por, voucher].
 */
function TGP_buscarVouchers_(c, vouchers) {
  var dig = function (s) { return String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, ''); };
  var pagos = [], libro = SpreadsheetApp.openById(c.cfg.idVouchers);
  libro.getSheets().forEach(function (h) {
    if (h.getLastRow() < 2) return;
    var col = indiceColumnas_(h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0]);
    var cO = col('Numero de oper', 'Numero de operacion'), cM = col('Monto'), cF = col('Fecha de depos', 'Fecha de deposito');
    if (cO < 0 || cM < 0) return;
    h.getRange(2, 1, h.getLastRow() - 1, Math.max(cO, cM, cF) + 1).getValues().forEach(function (r, i) {
      var op = String(r[cO] == null ? '' : r[cO]);
      if (/^\[/.test(op) || (!op && !r[cM])) return;   // [DUPLICADO], [OMITIDO], vacías
      pagos.push({ fuente: h.getName() + '!' + (i + 2), op: dig(op), monto: AUV_num_(r[cM]), fecha: cF >= 0 ? AUV_fecha_(r[cF]) : null });
    });
  });
  return vouchers.map(function (v, n) {
    var q = { op: dig(v.d.operacion), monto: AUV_num_(v.d.monto), fecha: AUV_fecha_(v.d.fecha) };
    var cand = [], como = '';
    if (q.op.length >= 3) {
      cand = pagos.filter(function (p) { return p.op === q.op || (q.op.length >= 5 && p.op.length >= 5 && p.op.slice(-6) === q.op.slice(-6)); });
      if (cand.length && q.monto) {
        var mismos = cand.filter(function (p) { return Math.abs(p.monto - q.monto) <= 0.05; });
        if (!mismos.length) return ['V' + (n + 1), q.fecha || '', q.monto, q.op, '⚠️ Misma operación con otro monto (' + cand[0].fuente + ')', 'N° de operación', cand[0].fuente];
        cand = mismos;
      }
      if (cand.length) como = 'N° de operación';
    }
    if (!cand.length && q.monto) {
      cand = pagos.filter(function (p) { return Math.abs(p.monto - q.monto) <= 0.05 && (!q.fecha || !p.fecha || Math.abs(p.fecha - q.fecha) <= 5 * 864e5); });
      if (cand.length) como = 'monto y fecha';
    }
    var estado = !cand.length ? '❌ No está en la hoja de vouchers'
      : cand.length > 1 ? '⚠️ ' + cand.length + ' posibles: ' + cand.slice(0, 4).map(function (p) { return p.fuente; }).join(', ')
      : '🟡 Registrado';
    return ['V' + (n + 1), q.fecha || '', q.monto, q.op, estado, como, cand.length === 1 ? cand[0].fuente : ''];
  });
}

/** El recálculo de Cuentas por Cobrar y Pagar va aparte (1 min después), para no hacer esperar el aviso. */
function TGP_recalcularLuego_() {
  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'TGP_recalcular'; });
  if (!hay) ScriptApp.newTrigger('TGP_recalcular').timeBased().after(60 * 1000).create();
}

function TGP_recalcular() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGP_recalcular') ScriptApp.deleteTrigger(t); });
  try { actualizarTodo_(true); } catch (e) { console.warn('Recalcular tras Procesar documento: ' + e.message); }
}

function TGP_celda_(libro, fuente, nombres) {
  var m = String(fuente).match(/^(.+)!(\d+)$/);
  if (!m) return '';
  var sh = libro.getSheetByName(m[1]);
  if (!sh) return '';
  var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var j = indiceColumnas_(enc).apply(null, nombres);
  return j < 0 ? '' : String(sh.getRange(Number(m[2]), j + 1).getDisplayValue()).trim();
}

function TGP_monto_(v) {
  var n = Number(v.monto || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (/USD|US\$|DOL/i.test(v.moneda) ? 'US$ ' : 'S/ ') + n;
}

/** Resumen del plan (HTML simple; WhatsApp lo pasa a su formato). */
function TGP_texto_(k, p) {
  var L = ['🧾 <b>Revisé ' + (p.adjs.length > 1 ? p.adjs.length + ' archivos' : 'el archivo') + '</b>'].concat(p.resumen);
  if (!p.items.length) L.push('\nNo encontré ningún voucher. No hay nada que registrar.');
  var acciones = 0, nuevos = 0;
  p.items.forEach(function (it) {
    var v = it.v, cab = '\n<b>Voucher ' + (p.items.length > 1 ? it.n + ' ' : '') + '</b>' + TG_esc_([v.banco, v.operacion ? 'op ' + v.operacion : '', v.fecha].filter(String).join(' · ')) + ' · <b>' + TGP_monto_(v) + '</b>';
    var fac = it.fac && it.fac.serie ? '\n   🧾 Factura ' + TG_esc_(it.fac.serie) + (it.fac.emisor ? ' de ' + TG_esc_(it.fac.emisor) : '') + ' · pago = ' + TG_esc_(it.cuadra) : '';
    var ssco = null;   // ⚠️ proveedor en la lista de Sujetos Sin Capacidad Operativa (Ssco.js)
    try { ssco = it.fac && it.fac.proveedor ? SSCO_ruc_(TG_ss_(), it.fac.proveedor) : null; } catch (e) {}
    var avisoSsco = !ssco ? '' : '\n   🚨 <b>' + TG_esc_(it.fac.emisor || it.fac.proveedor) + '</b>: ' + TG_esc_(SSCO_texto_(ssco)) +
      (ssco.plazo ? ' Puede pedir revisión hasta el ' + TG_fecha_(aFecha_(ssco.plazo)) + ' (aprox.).' : '');
    if (it.tipo === 'nuevo') {
      acciones++; nuevos++;
      L.push(cab + '\n   ❌ <b>No está registrado</b> → lo registro' + (it.pagina ? ' (solo la página ' + it.pagina + ')' : '') + fac + (fac ? ' → la completo al registrarse' : ''));
    } else if (it.tipo === 'completar') {
      acciones++;
      L.push(cab + '\n   🟡 Ya está en <b>' + TG_esc_(it.fuente) + '</b> sin factura' + fac + ' → la completo');
    } else if (it.tipo === 'listo') {
      L.push(cab + '\n   ✅ Ya está en <b>' + TG_esc_(it.fuente) + '</b>' + (it.facturaActual ? ' con factura ' + TG_esc_(it.facturaActual) : '') + ' → no hay nada que hacer');
    } else L.push(cab + '\n   ⚠️ ' + TG_esc_(it.estado || 'no estoy seguro si ya está') + ' → no lo toco; revíselo en la hoja');
    if (avisoSsco) L[L.length - 1] += avisoSsco;
  });
  if (nuevos) L.push('\n📂 Pestaña: <b>' + TGP_textoPestana_(p) + '</b>');
  if (nuevos) L.push('🏷 Se guardará como <b>' + TG_esc_(TGE_corta_(p.fecha) + ' ' + p.nombre) + '</b>' + (nuevos > 1 ? ', … 2…' : '') + ' (puede cambiarlo).');
  L.push('\n<i>El archivo original queda en la carpeta temporal (se borra sola en 7 días). Todo se puede deshacer.</i>');
  return { texto: L.join('\n'), k: k, hayAcciones: acciones > 0, hayNuevos: nuevos > 0, etiqueta: TGE_corta_(p.fecha) + ' ' + p.nombre, msg: p.msg || 0,
    pestana: TGP_pestanaEfectiva_(p), textoPestana: TGP_textoPestana_(p) };
}

/** 'foto' | 'original' | 'mixto' (PDF a Originales y fotos a Fotos, cuando no se eligió). */
function TGP_pestanaEfectiva_(p) {
  if (p.pestana) return p.pestana;
  var tipos = {};
  p.items.filter(function (x) { return x.tipo === 'nuevo'; }).forEach(function (x) { tipos[/pdf/i.test(x.mime) ? 'original' : 'foto'] = true; });
  var k = Object.keys(tipos);
  return k.length === 1 ? k[0] : 'mixto';
}

function TGP_textoPestana_(p) {
  var e = TGP_pestanaEfectiva_(p);
  return e === 'foto' ? 'Fotos' : e === 'original' ? 'Originales' : 'PDF → Originales, fotos → Fotos';
}

/** 📸 / 📄 Mandar a Fotos u Originales (todos los vouchers nuevos del resumen). */
function TGP_cambiarPestana_(k, pestana) {
  var p = TG_leerBoton_(k);
  if (!p) return { error: 'Ese resumen ya venció (dura 6 horas). Mándeme el archivo de nuevo.' };
  p.pestana = pestana === 'foto' ? 'foto' : 'original';
  CacheService.getScriptCache().put('tg_b_' + k, JSON.stringify(p), 21600);
  return TGP_texto_(k, p);
}

/** 🏷 Cambiar nombre/fecha de los vouchers nuevos ("Edit", "Edit 15/10"). */
function TGP_cambiarNombre_(k, texto) {
  var p = TG_leerBoton_(k);
  if (!p) return { error: 'Ese resumen ya venció (dura 6 horas). Mándeme el archivo de nuevo.' };
  var it = TGE_interpretar_(texto);
  if (it.error) return { error: it.error + ' Escríbalo así: Edit 15/10.' };
  if (!it.nombre) return { error: 'No entendí el nombre. Escríbalo así: Edit o Edit 15/10.' };
  p.nombre = it.nombre; p.fecha = it.fecha; p.ordenante = '';
  CacheService.getScriptCache().put('tg_b_' + k, JSON.stringify(p), 21600);
  return TGP_texto_(k, p);
}

/** ✅ Hacerlo. Completa facturas ya; los vouchers nuevos siguen en TGP_trabajar. Devuelve {texto, pendiente}. */
function TGP_ejecutar_(ss, k) {
  var p = TG_leerBoton_(k);
  if (!p) return { texto: 'Ese resumen ya venció (dura 6 horas). Mándeme el archivo de nuevo.' };
  if (TG_yaVisto_('tgp' + k)) return { texto: 'Eso ya se hizo.' };
  var c = TGP_ctx_(ss), lineas = [], lotes = [];
  var completar = p.items.filter(function (x) { return x.tipo === 'completar'; });
  if (completar.length) {
    c.cambios = [];
    completar.forEach(function (it) {
      try { ANX_HERR_.asignar_voucher(c, { fila: it.fuente, empresa: it.fac.empresa, proveedor_ruc: it.fac.proveedor, facturas: it.fac.serie, motivo: '🧾 Procesar documento: ' + it.fac.serie }); }
      catch (e) { lineas.push('⚠️ ' + it.fuente + ': ' + e.message); }
    });
    if (c.cambios.length) {
      ANX_guardarPropuestos_(ss, c.cambios);
      var r = ANX_aplicarDet_(ss, c.cambios.map(function (x) { return x.id; }), false, { sinRecalcular: true });
      if (r.lote) TGP_recalcularLuego_();
      if (r.lote) lotes.push(r.lote);
      lineas.push(r.mensaje.split(' · ')[0] + ': ' + completar.map(function (it) { return it.fuente + ' ← ' + it.fac.serie; }).join(', '));
    }
  }
  var accId = TGU_anotar_(p.clave, { id: k, desc: '🧾 Procesar ' + p.adjs.map(function (a) { return a.nombre; }).join(', '), lotes: lotes, archivos: [] });
  TGP_aTemporal_(ss, p.adjs);
  var nuevos = p.items.filter(function (x) { return x.tipo === 'nuevo'; });
  if (nuevos.length) {
    var job = { id: accId, canal: p.canal, destino: p.destino, clave: p.clave, estado: 'separar', t: Date.now(), nombre: p.nombre, fecha: p.fecha, ordenante: p.ordenante, pestana: p.pestana || '',
      items: nuevos.map(function (it) { return { archivo: it.archivo, mime: it.mime, pagina: it.pagina, fac: it.fac, v: it.v }; }) };
    PropertiesService.getScriptProperties().setProperty(TGP_PROP_JOB_ + accId, JSON.stringify(job));
    TGP_reprogramar_();
    lineas.push('📥 Separando ' + (nuevos.length > 1 ? 'los ' + nuevos.length + ' vouchers' : 'el voucher') + ' y mandándolo a la hoja de Vouchers como <b>' + TG_esc_(TGE_corta_(p.fecha) + ' ' + p.nombre) + '</b>… le aviso cuando quede registrado' + (nuevos.some(function (x) { return x.fac && x.fac.serie; }) ? ' y con la factura completada' : '') + '.');
  }
  if (!lineas.length) lineas.push('No había nada que hacer.');
  return { texto: '✅ ' + lineas.join('\n'), pendiente: nuevos.length > 0 };
}

/** ✖ Cancelar: no se registra nada; los archivos van a la carpeta temporal. */
function TGP_cancelar_(ss, k) {
  var p = TG_leerBoton_(k);
  if (p && !TG_yaVisto_('tgp' + k)) TGP_aTemporal_(ss, p.adjs);
  return 'Listo, no registré nada. El archivo queda en la carpeta temporal (se borra solo en 7 días).';
}

function TGP_aTemporal_(ss, adjs) {
  var tmp = IMP_carpeta_(ss);
  (adjs || []).forEach(function (a) {
    try {
      var f = DriveApp.getFileById(a.id), ya = false, it = f.getParents();
      while (it.hasNext()) if (it.next().getId() === tmp.getId()) ya = true;
      if (!ya) f.moveTo(tmp);
    } catch (e) { console.warn('Temporal: ' + e.message); }
  });
}

/* ============================================================ trabajo aparte (cada minuto) */

function TGP_programar_(minutos) {
  var hay = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'TGP_trabajar'; });
  if (!hay) ScriptApp.newTrigger('TGP_trabajar').timeBased().after(Math.max(1, minutos) * 60 * 1000).create();
}

/**
 * Borra los disparadores de TGP_trabajar (un disparador de una sola vez sigue listado después de correr) y deja
 * uno nuevo en 1 min. Se llama ANTES de trabajar: si la ejecución se corta (límite de 6 min), el trabajo sigue.
 */
function TGP_reprogramar_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGP_trabajar') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('TGP_trabajar').timeBased().after(60 * 1000).create();
}

/** Arranca el trabajo YA (en la misma ejecución del botón ✅), sin esperar al disparador. */
function TGP_trabajarYa_() {
  try { TGP_trabajar(true).catch(function (e) { console.error('Procesar documento: ' + (e && e.stack || e)); }); }
  catch (e) { console.error('Procesar documento: ' + e.message); }
}

/** ya = true cuando lo llama el botón (el disparador de respaldo queda por si esta ejecución se corta). */
async function TGP_trabajar(ya) {
  var props = PropertiesService.getScriptProperties();
  // Uno a la vez: si otra ejecución está trabajando, este disparador vuelve en un minuto.
  if (Date.now() - Number(props.getProperty('TGP_TRABAJANDO') || 0) < 5 * 60000) { if (!ya) TGP_reprogramar_(); return; }
  props.setProperty('TGP_TRABAJANDO', String(Date.now()));
  TGP_reprogramar_();   // respaldo antes de trabajar: un trabajo nunca queda huérfano
  var seguir = false;
  try { seguir = await TGP_vuelta_(props); } finally { props.deleteProperty('TGP_TRABAJANDO'); }
  if (!seguir) ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'TGP_trabajar') ScriptApp.deleteTrigger(t); });
}

async function TGP_vuelta_(props) {
  var ss = TG_ss_(), todo = props.getProperties(), seguir = false;
  var claves = Object.keys(todo).filter(function (x) { return x.indexOf(TGP_PROP_JOB_) === 0; });
  for (var i = 0; i < claves.length; i++) {
    var job = JSON.parse(todo[claves[i]]);
    try {
      if (job.estado === 'separar') {
        await TGP_separar_(ss, job);
        job.estado = 'esperar'; job.t1 = job.tSep = Date.now();
        props.setProperty(claves[i], JSON.stringify(job));
        TGP_procesarYa_();   // la hoja de Vouchers procesa en el momento: al volver, la fila ya suele estar
      }
      if (job.estado === 'esperar') {
        if (TGP_revisar_(ss, job)) { props.deleteProperty(claves[i]); continue; }
        if (Date.now() - job.t1 > TGP_ESPERA_MAX_MIN_ * 60000) {
          TGP_avisar_(job, '⏳ ' + job.items.length + ' voucher(s) siguen en la carpeta de Entrada: la hoja de Vouchers aún no los procesa. Cuando se registren, pídame completar la factura.');
          props.deleteProperty(claves[i]); continue;
        }
        props.setProperty(claves[i], JSON.stringify(job));
        seguir = true;
      }
    } catch (e) {
      console.error('Procesar documento: ' + (e && e.stack || e));
      TGP_avisar_(job, '❌ No pude terminar de procesar: ' + TG_esc_(e.message || e));
      props.deleteProperty(claves[i]);
    }
  }
  return seguir;
}

function TGP_cancelarTrabajo_(id) {
  PropertiesService.getScriptProperties().deleteProperty(TGP_PROP_JOB_ + id);
}

function TGP_pdfLib_() {
  if (typeof PDFLib !== 'undefined') return;
  eval(UrlFetchApp.fetch('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js').getContentText()
    .replace(/setTimeout\(.*?,.*?(\d*?)\)/g, 'Utilities.sleep($1);return t();'));
}

/** Separa la(s) página(s) de cada voucher nuevo, la nombra y la deja en Entrada. */
async function TGP_separar_(ss, job) {
  var cfg = TG_cfg_(ss);
  var porArchivo = {};
  job.items.forEach(function (it, i) { (porArchivo[it.archivo.id] = porArchivo[it.archivo.id] || []).push(i); });
  var ids = Object.keys(porArchivo);
  var exts = ids.map(function (id) { return /pdf/i.test(job.items[porArchivo[id][0]].mime) ? '.pdf' : TGE_ext_(job.items[porArchivo[id][0]].archivo.nombre, job.items[porArchivo[id][0]].mime); });
  var nombres = TGE_reservar_(ss, job.nombre, job.fecha, exts);
  TGE_usar_(job.nombre, job.ordenante || '');
  var creados = [];
  for (var n = 0; n < ids.length; n++) {
    var idxs = porArchivo[ids[n]], it0 = job.items[idxs[0]];
    var blob = DriveApp.getFileById(ids[n]).getBlob(), esPdf = /pdf/i.test(it0.mime);
    if (esPdf) {
      var paginas = idxs.map(function (i) { return job.items[i].pagina; }).filter(function (p) { return p > 0; });
      if (paginas.length) {
        TGP_pdfLib_();
        var doc = await PDFLib.PDFDocument.load(new Uint8Array(blob.getBytes()), { ignoreEncryption: true });
        var total = doc.getPageCount();
        var quedan = paginas.filter(function (p, j) { return p <= total && paginas.indexOf(p) === j; }).sort(function (a, b) { return a - b; });
        if (quedan.length && quedan.length < total) {
          var nuevo = await PDFLib.PDFDocument.create();
          var copias = await nuevo.copyPages(doc, quedan.map(function (p) { return p - 1; }));
          copias.forEach(function (pg) { nuevo.addPage(pg); });
          var bytes = await nuevo.save();
          blob = Utilities.newBlob([].slice.call(new Int8Array(bytes)), 'application/pdf', nombres[n]);
        }
      }
    }
    var aOriginales = job.pestana ? job.pestana === 'original' : esPdf;   // 📂 la pestaña elegida, o según el tipo
    var f = DriveApp.getFolderById(aOriginales ? cfg.carpetaOriginales : cfg.carpetaFotos).createFile(blob.setName(nombres[n]));
    idxs.forEach(function (i) { job.items[i].nuevo = { id: f.getId(), nombre: nombres[n] }; });
    creados.push({ id: f.getId(), nombre: nombres[n] });
  }
  TGU_agregar_(job.clave, job.id, { archivos: creados });
}

// Pide a la hoja de Vouchers que procese YA (la misma dirección del "⚡ Procesar al instante" de WhatsApp).
function TGP_procesarYa_() {
  var url = PropertiesService.getScriptProperties().getProperty('TGP_PROCESAR_URL');
  if (!url) return;
  try { UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }); } catch (e) { console.warn('Procesar al instante: ' + e.message); }
}

/** ¿Ya están las filas? Completa la factura y avisa. true = terminó. */
function TGP_revisar_(ss, job) {
  var idx = TGU_indiceArchivos_(ss), cfg = TG_cfg_(ss), entrada = [cfg.carpetaFotos, cfg.carpetaOriginales];
  var falta = job.items.some(function (it) {
    if (idx[it.nuevo.nombre]) return false;
    try { var ps = DriveApp.getFileById(it.nuevo.id).getParents(); while (ps.hasNext()) if (entrada.indexOf(ps.next().getId()) >= 0) return true; } catch (e) {}
    return false;   // salió de Entrada sin filas: se descartó
  });
  if (falta) return false;
  var tFilas = Date.now();
  var c = TGP_ctx_(ss), lineas = [], vistos = {};
  c.cambios = [];
  job.items.forEach(function (it) {
    var filas = (idx[it.nuevo.nombre] || []).filter(function (f) { return !vistos[f.hoja + f.fila]; });
    // La fila de este voucher: la de su monto si hay varias (un PDF con varias páginas de vouchers).
    var f = filas.filter(function (x) { return Math.abs(AUV_num_(x.monto) - it.v.monto) <= 0.05; })[0] || filas[0];
    if (!f) { lineas.push('❌ ' + TG_esc_(it.nuevo.nombre) + ': la hoja de Vouchers lo descartó (revise la carpeta Descartados).'); return; }
    vistos[f.hoja + f.fila] = true;
    var fuente = f.hoja + '!' + f.fila;
    if (/^\[DUPLICADO\]/.test(f.op)) { lineas.push('⚠️ ' + fuente + ': la hoja dice que ya estaba registrado (duplicado).'); return; }
    if (/^\[/.test(f.op)) { lineas.push('⚠️ ' + fuente + ': no pudo leer el voucher (' + TG_esc_(f.op) + ').'); return; }
    var l = '✅ <b>' + TG_esc_(it.nuevo.nombre) + '</b> registrado en <b>' + fuente + '</b> (' + TGP_monto_(it.v) + ')';
    TGR_guardarUltimo_(job.clave, { doc: it.fac && it.fac.serie || '', fila: fuente });
    if (it.fac && it.fac.serie) {
      try {
        ANX_HERR_.asignar_voucher(c, { fila: fuente, empresa: it.fac.empresa, proveedor_ruc: it.fac.proveedor, facturas: it.fac.serie, motivo: '🧾 Procesar documento: ' + it.fac.serie });
        l += ' · factura ' + TG_esc_(it.fac.serie);
      } catch (e) { l += ' · ⚠️ factura: ' + TG_esc_(e.message); }
    }
    lineas.push(l);
  });
  if (c.cambios.length) {
    ANX_guardarPropuestos_(ss, c.cambios);
    var r = ANX_aplicarDet_(ss, c.cambios.map(function (x) { return x.id; }), false, { sinRecalcular: true });
    if (r.lote) TGP_recalcularLuego_();
    if (r.lote) TGU_agregar_(job.clave, job.id, { lotes: [r.lote] });
    if (!/✅/.test(r.mensaje)) lineas.push('⚠️ ' + TG_esc_(r.mensaje));
  }
  var s = function (ms) { return Math.max(0, Math.round(ms / 1000)) + ' s'; }, fin = Date.now();
  var tiempos = job.tSep ? '\n⏱ <i>' + s(fin - job.t) + ' en total: separar ' + s(job.tSep - job.t) + ' · hoja de Vouchers ' + s(tFilas - job.tSep) +
    ' · factura ' + s(fin - tFilas) + '</i>' : '';
  // Aviso que llega tarde (el trabajo estuvo detenido): que se note que es de un envío anterior.
  var tarde = fin - job.t > 2 * 3600000 ? ' · <i>aviso atrasado de su envío del ' + Utilities.formatDate(new Date(job.t), 'America/Lima', 'dd/MM HH:mm') + '</i>' : '';
  TGP_avisar_(job, '🧾 <b>Listo</b>' + tarde + '\n' + lineas.join('\n') + (tarde ? '' : tiempos));
  return true;
}

function TGP_avisar_(job, html) {
  TG_recordarEnChat_(job.clave, '(resultado de 🧾 Procesar documento)', TG_plano_(html, 1500));   // 🧠 memoria de la IA
  if (job.canal === 'tg') {
    TG_enviar_(job.destino, html, [[{ text: '↩️ Deshacer todo', callback_data: 'k:' + TG_guardarBoton_({ t: 'deshacer' }) }]]);
    return;
  }
  // WhatsApp: se guarda y la app de WhatsApp lo recoge cada minuto (accion=procesar, modo=mensajes).
  var p = PropertiesService.getScriptProperties(), k = TGP_PROP_MSG_ + job.clave;
  var l = [];
  try { l = JSON.parse(p.getProperty(k) || '[]'); } catch (e) {}
  l.push(html + '\n\n<i>Escriba "deshacer" para deshacerlo todo.</i>');
  p.setProperty(k, JSON.stringify(l.slice(-10)));
}

/* ============================================================ Telegram */

function TGP_iniciarTG_(ctx, adjs) {
  TG_accion_(ctx.chatId, 'typing');
  TG_enviar_(ctx.chatId, '🧾 Leyendo ' + (adjs.length > 1 ? 'los ' + adjs.length + ' archivos' : 'el archivo') + ' página por página…', null, { silencioso: true });
  var r;
  try { r = TGP_analizar_(ctx.ss, adjs, { canal: 'tg', destino: ctx.chatId, clave: ctx.chatId }); }
  catch (e) { return TG_enviar_(ctx.chatId, '❌ No pude revisarlo: ' + TG_esc_(e.message)); }
  var msg = TG_enviar_(ctx.chatId, r.texto, TGP_tecladoTG_(r));
  var p = TG_leerBoton_(r.k);
  if (p && msg) { p.msg = msg; CacheService.getScriptCache().put('tg_b_' + r.k, JSON.stringify(p), 21600); }
  // Mientras espera ✅, "21-10-26 Edit" escrito directo cambia el nombre (TGP_nombreDirectoTG_).
  if (r.hayNuevos) { var ses = TG_sesion_(ctx.chatId); ses.procPend = r.k; TG_guardarSesion_(ctx.chatId, ses); }
}

/** "21-10-26 Edit" / "nombre Edit" (o la respuesta al resumen) con un resumen pendiente → cambia el nombre. */
function TGP_nombreDirectoTG_(ctx, ses, texto, m) {
  var k = ses.procPend, p = k && TG_leerBoton_(k);
  if (!p) return false;
  var mn = texto.match(/^\s*nombre\s*[:=]?\s+(.+)$/i) || texto.match(/^\s*(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\s+\S.*)$/);
  var alResumen = m.reply_to_message && p.msg && m.reply_to_message.message_id === p.msg;
  // Una pregunta respondiendo al resumen ("¿esta factura ya está retenida?") va a la IA, no es un nombre.
  var pregunta = /[?¿]/.test(texto) || /^\s*(qu[eé]|c[oó]mo|cu[aá]l(es)?|cu[aá]nto?s?|cu[aá]ndo|d[oó]nde|qui[eé]n|por\s?qu[eé]|est[aá]n?|ya|tiene|hay|es|son|se|me|dime|dame|mu[eé]strame|busca|revisa|y)\b/i.test(texto);
  if (!mn && !(alResumen && !pregunta && texto.trim().split(/\s+/).length <= 6)) return false;
  TGP_alNombreTG_(ctx, { tipo: 'procnombre', k: k }, mn ? mn[1] : texto);
  return true;
}

/** Cuántas páginas tiene un PDF (sin abrirlo con pdf-lib). 0 si no se sabe. */
function TGP_paginasPdf_(blob) {
  try {
    var t = Utilities.newBlob(blob.getBytes()).getDataAsString('ISO-8859-1');
    var n = (t.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    (t.match(/\/Count\s+(\d+)/g) || []).forEach(function (x) { n = Math.max(n, Number(x.replace(/\D/g, ''))); });
    return n;
  } catch (e) { return 0; }
}

/** ¿Algún archivo es un PDF de varias páginas? (orden de compra + voucher + factura…: va a 🧾 Procesar). */
function TGP_hayVariasPaginas_(adjs) {
  return (adjs || []).some(function (a) {
    try { var f = DriveApp.getFileById(a.id); return /pdf/i.test(f.getMimeType()) && TGP_paginasPdf_(f.getBlob()) > 1; } catch (e) { return false; }
  });
}

function TGP_tecladoTG_(r) {
  if (!r.hayAcciones) return null;
  var f = [[{ text: '✅ Hacerlo', callback_data: 'k:' + r.k + ':si' }]];
  if (r.hayNuevos) f[0].push({ text: '🏷 Cambiar nombre', callback_data: 'k:' + r.k + ':nom' });
  f[0].push({ text: '✖ Cancelar', callback_data: 'k:' + r.k + ':no' });
  if (r.hayNuevos) f.push([r.pestana === 'foto' ? { text: '📄 Mandar a Originales', callback_data: 'k:' + r.k + ':dor' }
    : { text: '📸 Mandar a Fotos', callback_data: 'k:' + r.k + ':dfo' }]);
  return f;
}

function TGP_alBotonTG_(ctx, op, k) {
  if (op === 'dfo' || op === 'dor') {   // 📸 / 📄: se corrige el mismo resumen
    var rp = TGP_cambiarPestana_(k, op === 'dfo' ? 'foto' : 'original');
    if (rp.error) return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(rp.error));
    return TG_editar_(ctx.chatId, ctx.msgId, rp.texto, TGP_tecladoTG_(rp));
  }
  if (op === 'nom') {
    var ses = TG_sesion_(ctx.chatId); ses.esperando = { tipo: 'procnombre', k: k }; TG_guardarSesion_(ctx.chatId, ses);
    return TG_enviar_(ctx.chatId, '🏷 Escríbame (o dígame 🎤) el nombre y, si es de otro día, la fecha: <i>Edit</i> o <i>15-10-26 Edit</i>.');
  }
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  var sp = TG_sesion_(ctx.chatId);
  if (sp.procPend === k) { delete sp.procPend; TG_guardarSesion_(ctx.chatId, sp); }
  if (op === 'no') return TG_enviar_(ctx.chatId, TG_esc_(TGP_cancelar_(ctx.ss, k)));
  TG_accion_(ctx.chatId, 'typing');
  var r;
  try { r = TGP_ejecutar_(ctx.ss, k); } catch (e) { return TG_enviar_(ctx.chatId, '❌ ' + TG_esc_(e.message)); }
  TG_enviar_(ctx.chatId, r.texto, r.pendiente ? null : [[{ text: '↩️ Deshacer todo', callback_data: 'k:' + TG_guardarBoton_({ t: 'deshacer' }) }]]);
  if (r.pendiente) TGP_trabajarYa_();
}

function TGP_alNombreTG_(ctx, e, texto) {
  var r = TGP_cambiarNombre_(e.k, texto);
  if (r.error) {
    var s = TG_sesion_(ctx.chatId); s.esperando = e; TG_guardarSesion_(ctx.chatId, s);
    return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(r.error));
  }
  // Se corrige el MISMO resumen (no se manda otro) y se confirma en una línea.
  if (r.msg && TG_editar_(ctx.chatId, r.msg, r.texto, TGP_tecladoTG_(r))) {
    return TG_enviar_(ctx.chatId, '🏷 Listo: se guardará como <b>' + TG_esc_(r.etiqueta) + '</b>. Toque ✅ Hacerlo en el resumen de arriba.');
  }
  TG_enviar_(ctx.chatId, r.texto, TGP_tecladoTG_(r));
}

/* ============================================================ WhatsApp (TGW_doPost_ accion=procesar) */

/**
 * q.modo: 'analizar' {numero, archivos:[{id, nombre, mime}], procesarUrl} → {ok, texto, k, hayAcciones, hayNuevos}
 *         'resultado' {numero}   (si la app de WhatsApp dejó de esperar a los 60 s)
 *         'hacer' / 'cancelar' {k} · 'nombre' {k, texto} · 'mensajes' {numero} → {mensajes, pendiente}
 */
function TGP_wa_(q) {
  var ss = TG_ss_(), clave = 'wa' + String(q.numero || '').replace(/\D/g, '');
  if (q.procesarUrl) PropertiesService.getScriptProperties().setProperty('TGP_PROCESAR_URL', q.procesarUrl);
  if (q.modo === 'analizar') {
    var r;
    try { r = TGP_analizar_(ss, q.archivos || [], { canal: 'wa', destino: String(q.numero), clave: clave, nombre: q.nombre || '', fecha: q.fecha || '', pestana: q.pestana || '' }); r.ok = true; }
    catch (e) { r = { ok: false, error: 'No pude revisarlo: ' + e.message }; }
    CacheService.getScriptCache().put('tgp_r_' + clave, JSON.stringify(r), 3600);
    return r;
  }
  if (q.modo === 'resultado') {
    var x = CacheService.getScriptCache().get('tgp_r_' + clave);
    return x ? JSON.parse(x) : { ok: false, pendiente: true };
  }
  if (q.modo === 'hacer') return Object.assign({ ok: true }, TGP_ejecutar_(ss, q.k));
  if (q.modo === 'cancelar') return { ok: true, texto: TGP_cancelar_(ss, q.k) };
  if (q.modo === 'nombre') { var n = TGP_cambiarNombre_(q.k, q.texto || ''); n.ok = !n.error; return n; }
  if (q.modo === 'trabajar') { TGP_trabajarYa_(); return { ok: true }; }
  if (q.modo === 'pestana') { var d = TGP_cambiarPestana_(q.k, q.pestana); d.ok = !d.error; return d; }
  if (q.modo === 'mensajes') {
    var p = PropertiesService.getScriptProperties(), m = [];
    try { m = JSON.parse(p.getProperty(TGP_PROP_MSG_ + clave) || '[]'); } catch (e) {}
    p.deleteProperty(TGP_PROP_MSG_ + clave);
    var pendiente = TGR_pendienteWA_(clave) || Object.keys(p.getProperties()).some(function (k) {
      if (k.indexOf(TGP_PROP_JOB_) !== 0) return false;
      try { return JSON.parse(p.getProperty(k)).clave === clave; } catch (e) { return false; }
    });
    return { ok: true, mensajes: m, pendiente: pendiente };
  }
  return { ok: false, error: 'modo desconocido' };
}
