/**
 * 🚚 Guías — 📥 Traer de Quesito: con solo la empresa y el N° de factura (o de cotización) el robot de Quesito
 * (gre-quesito.yml, modo leer: NO crea nada) lee lo que trae la factura: cliente, su dirección y los productos con
 * sus cantidades. La fila se completa sola; lo que ya estaba escrito se respeta.
 * La columna "Producto y cantidad" dice qué lleva la guía sin llenar 📦 Productos:
 *   vacío o «total» = todo lo de la factura · «M&D 325 lote 1507: 10000; barra 5000» = solo eso.
 * Funciones GR_.
 */

function GR_menuLeerQuesito() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet();
  if (sh.getName() !== GR_HOJA_ || sh.getActiveRange().getRow() < GR_FILA1_) return ui.alert('Seleccione una o varias filas de la pestaña ' + GR_HOJA_ + '.');
  var rg = sh.getActiveRange(), ctx = GR_contexto_(ss), msgs = [], pedidas = 0;
  GR_leerGuias_(sh, Math.max(rg.getRow(), GR_FILA1_), rg.getLastRow()).slice(0, 10).forEach(function (x) {
    var r = x.r, t = function (k) { return String(r[k] == null ? '' : r[k]).trim(); };
    if (!r.id) return;
    var emp = ctx.emp[t('empresa')];
    if (!emp) return msgs.push(r.id + ': falta la empresa.');
    if (/^(🚚|⏳)/.test(t('estado'))) return msgs.push(r.id + ': ya está ' + (t('estado').indexOf('🚚') === 0 ? 'emitida' : 'emitiéndose') + '.');
    var fac = /^[A-Z0-9]{4}$/.test(t('serie').toUpperCase()) && /^\d+$/.test(t('numero')) ? t('serie').toUpperCase() + '-' + t('numero') : '';
    var cot = t('cotizacion').replace(/\D/g, '');
    if (!fac && !cot) return msgs.push(r.id + ': ponga el N° de factura (serie y número) o el N° de cotización.');
    var c = GR_cob_('leer', { caso: t('caso'), hoja: r.id, datos: { empresa_ruc: emp.ruc, via: 'quesito', motivo: 'Venta', cotizacion: fac ? '' : cot,
      documento: fac ? { tipo: 'Factura', numero: fac, ruc_emisor: emp.ruc } : null } });
    if (!c.ok || !c.caso) return msgs.push(r.id + ': ⚠️ ' + (c.error || 'el bot no aceptó el pedido'));
    sh.getRange(x.fila, GR_col_('caso')).setValue(c.caso);
    sh.getRange(x.fila, GR_col_('msg')).setValue('📥 Leyendo en Quesito ' + (fac ? 'la factura ' + fac : 'la cotización ' + cot) + '… (1–3 min, no se crea nada)');
    sh.getRange(x.fila, GR_col_('actualizado')).setValue(new Date());
    pedidas++;
    msgs.push(r.id + ': 📥 leyendo ' + (fac || 'cotización ' + cot) + '…');
  });
  if (pedidas) GR_programarRevision_();
  ss.toast(msgs.join('\n') || 'No había guías en esas filas.', '📥 Traer de Quesito', 10);
}

/** "M&D 325 lote 1507: 10000; barra 5000" → [{desc, cant}]; vacío o "total" → []. Lanza un error si falta la cantidad. */
function GR_partirPedido_(txt) {
  var t = String(txt == null ? '' : txt).trim();
  if (!t || /^(todo|total|todos|completo|toda la factura)$/i.test(t)) return [];
  return t.split(/[;\n]+/).map(function (s) { return s.trim(); }).filter(String).map(function (s) {
    var m = s.match(/[:=]?\s*(\d[\d.,]*)\s*(und|unid|unidades|niu|kg|cajas?|bolsas?|sacos?)?\s*$/i);
    if (!m) throw new Error('en «' + s + '» falta la cantidad (ej. «M&D 325 lote 1507: 10000» o «total»)');
    var desc = s.slice(0, m.index).replace(/^[\s:=-]+|[\s:=-]+$/g, '');
    if (!desc) throw new Error('en «' + s + '» falta el producto (código, nombre o lote)');
    return { desc: desc, cant: GR_numero_(m[1]) };
  });
}

/** "19,200.00" / "19.200" / "19200" → 19200 (igual que el robot). */
function GR_numero_(v) {
  var s = String(v == null ? '' : v).replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return Number(s) || 0;
}

function GR_palabras_(t) {
  return GR_norm_(t).split(' ').filter(function (w) { return w.length > 2; });
}

/** Cada pedido → la línea de la factura que le calza (por código, nombre o lote). Lanza un error si duda. */
function GR_calzarPedido_(pedido, lineas) {
  var usadas = {};
  return pedido.map(function (p) {
    var pb = GR_palabras_(p.desc), pts = [];
    lineas.forEach(function (l, i) {
      if (usadas[i]) return;
      var pl = GR_palabras_(l.desc || l.texto), n = pb.filter(function (w) { return pl.indexOf(w) >= 0; }).length;
      pts.push({ i: i, s: n / Math.max(1, pb.length) });
    });
    pts.sort(function (a, b) { return b.s - a.s; });
    if (!pts.length || pts[0].s < 0.5) throw new Error('«' + p.desc + '» no calza con ninguna línea de la factura');
    if (pts.length > 1 && pts[1].s === pts[0].s)
      throw new Error('«' + p.desc + '» calza con varias líneas de la factura (' + [pts[0], pts[1]].map(function (x) { return String(lineas[x.i].desc || lineas[x.i].texto).slice(0, 60); }).join(' | ') + '): agregue el lote o el código');
    usadas[pts[0].i] = true;
    return { i: pts[0].i, cant: p.cant };
  });
}

/** Una línea del formulario de Quesito ("M&D 325 BARRA … NIU 19200 … LOTE 1507 FV 150527") → producto de 📦. */
function GR_lineaQuesito_(l) {
  var t = String(l.texto || '').replace(/\b(Eliminar|Quitar|Borrar)\b/gi, ' ').replace(/Producto\s*-\s*Servicio\s*\(CAT[AÁ]LOGO\)/gi, ' ')
    .replace(/\bDetalle adicional\b|\bCantidad\b|\bDAM\b|M[AÁ]S INFO|\bU\.M\.|\bElegir\b/gi, ' ').replace(/\s+/g, ' ').trim();
  var u = t.match(/\b(NIU|KGM|BX|BG|SA|PK|TNE|LTR|GLL|BO|CA|DZN|MTR|ZZ)\b/);
  var lote = t.match(/\bLOTE\b[\s:.N°º]*[\w-]+(\s+F\.?\s*V\.?[\s:.]*[\w\/-]+)?/i);
  var unidad = GR_UNIDADES_.filter(function (x) { return u && x.indexOf(u[1] + ' ') === 0; })[0] || GR_UNIDADES_[0];
  return { desc: t.slice(0, 250), unidad: unidad, cant: Number(l.cantidad) || 0, lote: lote ? lote[0] : '' };
}

/** Pone en la fila lo que leyó el robot. Devuelve el texto para "Mensaje". */
function GR_aplicarLeido_(ss, fila, d) {
  var sh = ss.getSheetByName(GR_HOJA_), x = GR_leerGuias_(sh, fila, fila)[0].r, ctx = GR_contexto_(ss), hecho = [], ojo = [];
  var t = function (k) { return String(x[k] == null ? '' : x[k]).trim(); };
  var poner = function (k, v) { if (v !== '' && v != null && t(k) === '') { sh.getRange(fila, GR_col_(k)).setValue(v); x[k] = v; return true; } return false; };
  var emp = ctx.emp[t('empresa')] || {};
  // Factura (si se pidió por cotización)
  var mf = String(d.factura || '').match(/^([A-Z0-9]{4})-0*(\d+)$/);
  if (mf && poner('serie', mf[1]) | poner('numero', Number(mf[2]))) hecho.push('factura ' + d.factura);
  // Cliente: del PDF de la factura; si no, de la fila de Comprobantes o de la lista del formulario
  var cp = d.cliente_pdf || {}, ruc = String(cp.ruc || '').replace(/\D/g, ''), nom = String(cp.nombre || '').trim();
  if (!ruc) {
    var rs = (String(d.fila || '') + ' ' + String(d.cliente || '')).match(/\b(10|15|16|17|20)\d{9}\b/g) || [];
    ruc = rs.filter(function (q) { return q !== emp.ruc && GR_rucValido_(q); })[0] || '';
  }
  if (!nom && d.cliente) nom = String(d.cliente).replace(/^\s*\d{8,11}\s*[-–:]?\s*/, '').trim();
  if ((nom.match(/[A-Za-zÑñ]/g) || []).length < 3) nom = '';   // un código o un número no es un nombre
  if (ruc && t('ndest') === '') {
    poner('tdest', ruc.length === 11 ? GR_TIPODOC_[0] : GR_TIPODOC_[1]); poner('ndest', ruc); poner('dest', nom);
    hecho.push('cliente ' + (nom || ruc));
  }
  GR_procesarFilas_(ss, fila, fila, ['ndest', 'serie', 'numero']);   // 📍 Direcciones del cliente (si ya la tiene) llena la llegada
  x = GR_leerGuias_(sh, fila, fila)[0].r;
  // Llegada: si el cliente no tiene dirección en 📍, la de la factura (dirección fiscal: revísela si se entrega en otro lado)
  if (t('ldir') === '' && cp.direccion) {
    poner('ldir', cp.direccion);
    if (t('lubi') === '') poner('lubi', GR_ubigeoDeTexto_(cp.direccion));
    hecho.push('llegada (dirección de la factura)');
    ojo.push('la llegada es la dirección fiscal del cliente: cámbiela si se entrega en otro sitio' + (t('lubi') ? '' : ' (ponga el distrito)'));
  }
  // Productos: todo lo de la factura o lo que dice "Producto y cantidad"
  var ls = (d.lineas || []).map(GR_lineaQuesito_), prods = ctx.prod[t('id')] || [];
  if (ls.length) GR_guardarFactura_(t('id'), ls);   // para 📦 Elegir productos y para «Producto y cantidad»
  if (!ls.length) ojo.push('Quesito no trajo productos de la factura');
  else if (!prods.length) {
    var pedido = GR_partirPedido_(x.pedido), filas = [];
    if (!pedido.length) {
      filas = ls.map(function (p) { return { p: p, cant: p.cant, completa: 'SI' }; });
      sh.getRange(fila, GR_col_('total')).setValue('SI');
    } else {
      GR_calzarPedido_(pedido, ls).forEach(function (q) {
        var p = ls[q.i];
        if (p.cant && q.cant > p.cant + 1e-9) ojo.push('pide ' + q.cant + ' de «' + p.desc.slice(0, 40) + '» pero la factura tiene ' + p.cant);
        filas.push({ p: p, cant: q.cant, completa: p.cant && Math.abs(q.cant - p.cant) < 1e-9 ? 'SI' : 'NO' });
      });
      var todo = filas.length === ls.length && filas.every(function (f) { return f.completa === 'SI'; });
      sh.getRange(fila, GR_col_('total')).setValue(todo ? 'SI' : 'NO');
    }
    GR_agregarProductos_(ss, t('id'), filas);
    hecho.push(filas.length + ' producto(s) en 📦');
  }
  GR_procesarFilas_(ss, fila, fila, ['ldir', 'lubi', 'productos', 'total']);
  GR_registrar_(t('id'), '📥 De Quesito', (d.factura || '') + (d.cotizacion ? ' (cotización ' + d.cotizacion + ')' : '') + ' · ' + hecho.join(', '));
  return '📥 De Quesito: ' + (d.factura || '') + (hecho.length ? ' → ' + hecho.join(', ') : ' (ya estaba completa)') + (ojo.length ? '. Ojo: ' + ojo.join('; ') : '') + '.';
}

/** Agrega las líneas a 📦 Productos de esa guía (al final). */
function GR_agregarProductos_(ss, id, filas) {
  if (!filas.length) return;
  var p = ss.getSheetByName(GR_PROD_), ult = GR_ultimaFilaProductos_(p);
  var v = filas.map(function (f, i) { return [id, i + 1, '', f.p.desc, f.p.unidad, f.cant, f.p.lote, '', '', f.completa]; });
  if (p.getMaxRows() < ult + v.length) p.insertRowsAfter(p.getMaxRows(), ult + v.length - p.getMaxRows() + 50);
  p.getRange(ult + 1, 1, v.length, 10).setValues(v);
}

/* ---------------- 📦 Elegir productos y cantidades (ventana) ---------------- */

/** Líneas de la factura de una guía (las que trajo 📥; si no hay, las de 📦 completas). */
function GR_guardarFactura_(id, ls) {
  try {
    PropertiesService.getDocumentProperties().setProperty('GR_FAC_' + id, JSON.stringify(ls.slice(0, 40).map(function (l) {
      return { desc: String(l.desc).slice(0, 200), unidad: l.unidad, cant: Number(l.cant) || 0, lote: String(l.lote || '').slice(0, 60) }; })));
  } catch (e) { console.warn('GR_guardarFactura_: ' + e.message); }
}

function GR_facturaDe_(ss, id) {
  try { var v = PropertiesService.getDocumentProperties().getProperty('GR_FAC_' + id); if (v) return { lineas: JSON.parse(v), deQuesito: true }; } catch (e) {}
  var ps = GR_contexto_(ss).prod[id] || [];
  return { lineas: ps.map(function (p) { return { desc: String(p.desc), unidad: GR_UNIDADES_.filter(function (u) { return u.indexOf(p.unidad + ' ') === 0; })[0] || GR_UNIDADES_[0],
    cant: p.completa === 'SI' ? p.cant : 0, lote: String(p.lote || '') }; }), deQuesito: false };
}

/** Nombre corto para mostrar: "M&D 325 BARRA A BASE DE EXTRUIDOS" (sin lote ni cantidad). */
function GR_corto_(l) {
  var d = String(l.desc || '').replace(/Producto\s*-\s*Servicio\s*\(CAT[AÁ]LOGO\)/gi, ' ').replace(String(l.lote || '-'), ' ').replace(/\bNIU\b|\bKGM\b/g, ' ').replace(/\b\d[\d.,]*\b(?!\S*[A-Za-z])/g, function (m) {
    return /^\d{3}$/.test(m) ? m : ' '; }).replace(/\s+/g, ' ').trim();
  return d.replace(/\s+S\/\.?$/, '').slice(0, 70);
}

function GR_menuElegirProductos() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), ui = SpreadsheetApp.getUi();
  var f = sh.getActiveRange().getRow(), id = sh.getName() === GR_HOJA_ && f >= GR_FILA1_ ? String(sh.getRange(f, 1).getValue()) : '';
  if (!id) return ui.alert('Seleccione la fila de la guía en ' + GR_HOJA_ + '.');
  var t = HtmlService.createTemplateFromFile('GR_ProductosVista');
  t.idGuia = id;
  ui.showModalDialog(t.evaluate().setWidth(760).setHeight(520), '📦 Productos de la guía ' + id);
}

/** Lo que muestra la ventana: líneas de la factura y lo que ya va en la guía. */
function GR_datosProductos(id) {
  var ss = SpreadsheetApp.getActive(), fac = GR_facturaDe_(ss, id), ps = GR_contexto_(ss).prod[id] || [];
  var usadas = {};
  var lineas = fac.lineas.map(function (l, i) {
    var p = null;
    for (var j = 0; j < ps.length && !p; j++) if (!usadas[j] && String(ps[j].desc) === String(l.desc)) { usadas[j] = true; p = ps[j]; }
    return { i: i, nombre: GR_corto_(l), lote: l.lote, unidad: String(l.unidad).split(' - ')[0], factura: l.cant, va: !!p || !ps.length, cant: p ? p.cant : l.cant };
  });
  return { id: id, lineas: lineas, deQuesito: fac.deQuesito };
}

/** Guarda lo elegido: 📦 Productos de la guía, «Producto y cantidad» y «¿Todo lo de la factura?». */
function GR_guardarProductos(id, elegidos) {
  var ss = SpreadsheetApp.getActive(), fac = GR_facturaDe_(ss, id).lineas;
  var filas = (elegidos || []).filter(function (e) { return fac[e.i] && Number(e.cant) > 0; }).map(function (e) {
    var l = fac[e.i];
    return { p: l, cant: Number(e.cant), completa: l.cant && Math.abs(Number(e.cant) - l.cant) < 1e-9 ? 'SI' : 'NO' };
  });
  if (!filas.length) throw new Error('Elija al menos un producto con cantidad.');
  var malas = filas.filter(function (f) { return f.p.cant && f.cant > f.p.cant + 1e-9; });
  if (malas.length) throw new Error('«' + GR_corto_(malas[0].p) + '» lleva más (' + malas[0].cant + ') que la factura (' + malas[0].p.cant + ').');
  GR_reemplazarProductos_(ss, id, filas);
  var todo = filas.length === fac.length && filas.every(function (f) { return f.completa === 'SI'; });
  var sh = ss.getSheetByName(GR_HOJA_), fila = GR_filaDe_(sh, id);
  if (fila) {
    sh.getRange(fila, GR_col_('pedido')).setValue(todo ? 'total' : GR_textoPedido_(filas));
    sh.getRange(fila, GR_col_('total')).setValue(todo ? 'SI' : 'NO');
    GR_procesarFilas_(ss, fila, fila, ['productos', 'total']);
  }
  GR_registrar_(id, '📦 Productos elegidos', filas.length + ' de ' + fac.length + (todo ? ' (todo)' : ''));
  return { ok: true, texto: todo ? 'Todo lo de la factura' : filas.length + ' de ' + fac.length + ' producto(s)' };
}

/** "M&D 325 lote 1507: 19200; M&D 325 lote 2108: 30000" (lo que se lee en «Producto y cantidad»). */
function GR_textoPedido_(filas) {
  return filas.map(function (f) {
    var cod = (GR_corto_(f.p).match(/^\S+(\s+\d{2,})?/) || [GR_corto_(f.p)])[0];
    var lote = (String(f.p.lote).match(/LOTE[\s:.N°º]*([\w-]+)/i) || [])[1];
    return (cod + (lote ? ' lote ' + lote : '')).trim() + ': ' + f.cant;
  }).join('; ');
}

/** Cambia las líneas de 📦 Productos de una guía por estas (las demás guías no se tocan). */
function GR_reemplazarProductos_(ss, id, filas) {
  var p = ss.getSheetByName(GR_PROD_), ult = GR_ultimaFilaProductos_(p);
  var v = ult >= 2 ? p.getRange(2, 1, ult - 1, 10).getValues() : [];
  var otras = v.filter(function (r) { return String(r[0]).trim() !== id && String(r).replace(/,/g, '').trim() !== ''; });
  var nuevas = filas.map(function (f, i) { return [id, i + 1, '', f.p.desc, f.p.unidad, f.cant, f.p.lote, '', '', f.completa]; });
  var todo = otras.concat(nuevas);
  if (v.length) p.getRange(2, 1, v.length, 10).clearContent();
  if (p.getMaxRows() < todo.length + 1) p.insertRowsAfter(p.getMaxRows(), todo.length + 51 - p.getMaxRows());
  if (todo.length) p.getRange(2, 1, todo.length, 10).setValues(todo);
}

/** Al escribir «Producto y cantidad» a mano: 📦 Productos se pone igual (si se conoce la factura). */
function GR_pedidoA_Productos_(ss, id, texto) {
  var fac = GR_facturaDe_(ss, id);
  if (!fac.lineas.length) return;
  if (!fac.deQuesito) GR_guardarFactura_(id, fac.lineas);
  var ped = GR_partirPedido_(texto), filas;
  if (!ped.length) filas = fac.lineas.filter(function (l) { return l.cant > 0; }).map(function (l) { return { p: l, cant: l.cant, completa: 'SI' }; });
  else filas = GR_calzarPedido_(ped, fac.lineas).map(function (q) {
    var l = fac.lineas[q.i];
    return { p: l, cant: q.cant, completa: l.cant && Math.abs(q.cant - l.cant) < 1e-9 ? 'SI' : 'NO' };
  });
  if (filas.length) GR_reemplazarProductos_(ss, id, filas);
}
