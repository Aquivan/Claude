/**
 * 🚚 Guías — 📥 Traer datos de la factura: con solo la empresa y el N° de factura (o de cotización) se completa la fila
 * (cliente, dirección, productos y cantidades). Lo que ya estaba escrito se respeta.
 *   1. 🔎 SIRE de ventas (lo baja el robot de GitHub): al instante, sin sesión. Cliente y productos.
 *   2. 📥 Quesito (gre-quesito.yml, modo leer: NO crea nada), solo cuando hace falta: factura que aún no está en el
 *      SIRE (la de hoy), solo la cotización, productos que se distinguen por el lote, o falta la dirección de llegada.
 *   Guías por SUNAT (empresas sin Quesito): solo el SIRE.
 * La columna "Producto y cantidad" dice qué lleva la guía sin llenar 📦 Productos:
 *   vacío o «total» = todo lo de la factura · «M&D 325 lote 1507: 10000; barra 5000» = solo eso.
 * Funciones GR_.
 */

function GR_menuLeerQuesito() { GR_menuTraerDatos(); }   // nombre anterior del menú

function GR_menuTraerDatos() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet();
  if (sh.getName() !== GR_HOJA_ || sh.getActiveRange().getRow() < GR_FILA1_) return ui.alert('Seleccione una o varias filas de la pestaña ' + GR_HOJA_ + '.');
  var rg = sh.getActiveRange(), msgs = [], pedidas = 0;
  var filas = GR_leerGuias_(sh, Math.max(rg.getRow(), GR_FILA1_), rg.getLastRow()).slice(0, 10).map(function (x) { return x.fila; });
  filas.forEach(function (fila) {
    var x = GR_leerGuias_(sh, fila, fila)[0], r = x.r, t = function (k) { return String(r[k] == null ? '' : r[k]).trim(); };
    if (!r.id) return;
    var ctx = GR_contexto_(ss), emp = ctx.emp[t('empresa')];
    if (!emp) return msgs.push(r.id + ': falta la empresa.');
    if (/^(🚚|⏳)/.test(t('estado'))) return msgs.push(r.id + ': ya está ' + (t('estado').indexOf('🚚') === 0 ? 'emitida' : 'emitiéndose') + '.');
    var serie = t('serie').toUpperCase(), numero = t('numero').replace(/\D/g, '');
    var fac = /^[A-Z0-9]{4}$/.test(serie) && numero ? serie + '-' + Number(numero) : '';
    var cot = t('cotizacion').replace(/\D/g, ''), quesito = t('via') !== 'SUNAT';
    if (!fac && !cot) return msgs.push(r.id + ': ponga el N° de factura (serie y número) o el N° de cotización.');
    // 1) 🔎 SIRE: al instante
    var sire = null, porQue = [];
    if (fac) {
      try { var b = GR_buscarFactura_(emp.ruc, serie, numero, r.fecha, []); if (b.f) sire = b.f; else porQue.push('no está en el SIRE todavía'); }
      catch (e) { porQue.push('SIRE: ' + e.message); }
    } else porQue.push('solo hay cotización');
    var m = '';
    if (sire) {
      var items = sire.items || [], nombres = items.map(function (it) { return GR_norm_(it.desc); });
      var dudosos = items.length > 1 && nombres.some(function (n, i) { return nombres.indexOf(n) !== i; });   // mismo producto, distinto lote
      var d = { fuente: 'sire', factura: fac, cliente_pdf: { ruc: sire.ruc, nombre: sire.cliente },
        lineas: dudosos && quesito ? [] : items.map(function (it) { return { texto: it.desc, cantidad: it.cant }; }) };
      try { m = GR_aplicarLeido_(ss, fila, d); } catch (e) { m = '⚠️ ' + e.message; }
      var y = GR_leerGuias_(sh, fila, fila)[0].r;
      if (quesito && dudosos) porQue.push('productos que se distinguen por el lote');
      else if (quesito && !String(y.ldir || '').trim()) porQue.push('falta la dirección de llegada');
      else {   // con el SIRE basta
        sh.getRange(fila, GR_col_('msg')).setValue(m);
        sh.getRange(fila, GR_col_('actualizado')).setValue(new Date());
        return msgs.push(r.id + ': 🔎 ' + m.replace(/^\S+\s/, ''));
      }
    }
    if (!quesito) {   // guía por SUNAT: no hay Quesito que mirar
      sh.getRange(fila, GR_col_('msg')).setValue(m || '⚠️ ' + porQue.join('; ') + '. Vuelva a intentar cuando el robot baje el SIRE, o llene los productos en 📦.');
      return msgs.push(r.id + ': ' + (m ? '🔎 listo' : '⚠️ ' + porQue.join('; ')));
    }
    // 2) 📥 Quesito: solo lo que falta (no crea nada)
    var c = GR_cob_('leer', { caso: t('caso'), hoja: r.id, datos: { empresa_ruc: emp.ruc, via: 'quesito', motivo: 'Venta', cotizacion: fac ? '' : cot,
      documento: fac ? { tipo: 'Factura', numero: fac, ruc_emisor: emp.ruc } : null } });
    if (!c.ok || !c.caso) {
      sh.getRange(fila, GR_col_('msg')).setValue((m ? m + ' ' : '') + '⚠️ Quesito: ' + (c.error || 'el bot no aceptó el pedido'));
      return msgs.push(r.id + ': ' + (m ? '🔎 del SIRE; ' : '') + '⚠️ Quesito: ' + (c.error || 'el bot no aceptó el pedido'));
    }
    sh.getRange(fila, GR_col_('caso')).setValue(c.caso);
    sh.getRange(fila, GR_col_('msg')).setValue('📥 Leyendo en Quesito ' + (fac ? 'la factura ' + fac : 'la cotización ' + cot) + ' (' + porQue.join('; ') + ')… 1–3 min, no se crea nada.' +
      (m ? ' Ya puse lo del SIRE.' : ''));
    sh.getRange(fila, GR_col_('actualizado')).setValue(new Date());
    pedidas++;
    msgs.push(r.id + ': ' + (sire ? '🔎 cliente del SIRE; ' : '') + '📥 Quesito (' + porQue.join('; ') + ')…');
  });
  if (pedidas) GR_programarRevision_();
  ss.toast(msgs.join('\n') || 'No había guías en esas filas.', '📥 Traer datos de la factura', 12);
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
  var puestos = {};
  var poner = function (k, v) { if (v !== '' && v != null && t(k) === '') { sh.getRange(fila, GR_col_(k)).setValue(v); x[k] = v; puestos[k] = v; return true; } return false; };
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
  var ls = (d.lineas || []).map(GR_lineaQuesito_), prods = ctx.prod[t('id')] || [], previa = GR_facturaGuardada_(t('id'));
  // Otra factura, o lo de Quesito (con lotes) reemplaza lo del SIRE: 📦 se vuelve a armar
  if (prods.length && ls.length && (previa && previa !== String(d.factura || '') || d.fuente !== 'sire' && GR_fuenteGuardada_(t('id')) === 'sire')) {
    GR_reemplazarProductos_(ss, t('id'), []); prods = [];
  }
  if (ls.length) GR_guardarFactura_(t('id'), ls, d.factura, d.fuente);   // para 📦 Elegir productos y para «Producto y cantidad»
  if (!ls.length && d.fuente !== 'sire') ojo.push('Quesito no trajo productos de la factura');
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
  // Lo que puso 📥 (para quitarlo solo si después cambian la factura y nadie lo tocó)
  try { PropertiesService.getDocumentProperties().setProperty('GR_AUTO_' + t('id'), JSON.stringify(Object.assign({ factura: String(d.factura || '') }, puestos))); } catch (e) {}
  GR_registrar_(t('id'), d.fuente === 'sire' ? '🔎 Del SIRE' : '📥 De Quesito', (d.factura || '') + (d.cotizacion ? ' (cotización ' + d.cotizacion + ')' : '') + ' · ' + hecho.join(', '));
  return (d.fuente === 'sire' ? '🔎 Del SIRE: ' : '📥 De Quesito: ') + (d.factura || '') + (hecho.length ? ' → ' + hecho.join(', ') : ' (ya estaba completa)') + (ojo.length ? '. Ojo: ' + ojo.join('; ') : '') + '.';
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
function GR_guardarFactura_(id, ls, factura, fuente) {
  try {
    PropertiesService.getDocumentProperties().setProperty('GR_FAC_' + id, JSON.stringify({ f: String(factura || ''), s: fuente || 'quesito', l: ls.slice(0, 40).map(function (l) {
      return { desc: String(l.desc).slice(0, 200), unidad: l.unidad, cant: Number(l.cant) || 0, lote: String(l.lote || '').slice(0, 60) }; }) }));
  } catch (e) { console.warn('GR_guardarFactura_: ' + e.message); }
}

/** Factura de la que salieron los datos guardados de esta guía ('' si no se sabe). */
function GR_facturaGuardada_(id) {
  try { var v = JSON.parse(PropertiesService.getDocumentProperties().getProperty('GR_FAC_' + id) || 'null'); return v && !Array.isArray(v) ? v.f || '' : ''; }
  catch (e) { return ''; }
}

function GR_fuenteGuardada_(id) {
  try { var v = JSON.parse(PropertiesService.getDocumentProperties().getProperty('GR_FAC_' + id) || 'null'); return v && !Array.isArray(v) ? v.s || 'quesito' : ''; }
  catch (e) { return ''; }
}

/**
 * Cambió la factura, la cotización o la empresa de una guía que ya tenía datos de otra factura: se quita lo que era
 * de la anterior (productos de 📦, «Producto y cantidad» y el cliente y la llegada que puso 📥, si nadie los cambió).
 * Devuelve el texto para «Mensaje» o '' si no había nada que quitar.
 */
function GR_olvidarFactura_(ss, sh, fila, id) {
  var props = PropertiesService.getDocumentProperties(), auto = {};
  try { auto = JSON.parse(props.getProperty('GR_AUTO_' + id) || '{}'); } catch (e) {}
  var hayFac = !!props.getProperty('GR_FAC_' + id), prods = (GR_contexto_(ss).prod[id] || []).length;
  if (!hayFac && !prods && !auto.factura) return '';
  props.deleteProperty('GR_FAC_' + id); props.deleteProperty('GR_AUTO_' + id);
  if (prods) GR_reemplazarProductos_(ss, id, []);
  var r = GR_leerGuias_(sh, fila, fila)[0].r, quitado = prods ? ['productos'] : [];
  ['tdest', 'ndest', 'dest', 'ldir', 'lubi'].forEach(function (k) {
    if (auto[k] && String(r[k]) === String(auto[k])) { sh.getRange(fila, GR_col_(k)).setValue(''); if (k === 'ndest') quitado.push('cliente'); if (k === 'ldir') quitado.push('llegada'); }
  });
  if (String(r.pedido || '').trim()) { sh.getRange(fila, GR_col_('pedido')).setValue(''); quitado.push('«Producto y cantidad»'); }
  sh.getRange(fila, GR_col_('total')).setValue('SI');
  var m = '🔄 Cambió la factura: quité lo que era de la anterior (' + (quitado.join(', ') || 'datos guardados') + '). Use 🚚 Guías → 📥 Traer datos de la factura.' +
    (!auto.factura && r.ndest ? ' Revise también el cliente.' : '');
  sh.getRange(fila, GR_col_('msg')).setValue(m);
  return m;
}

function GR_facturaDe_(ss, id) {
  try {
    var v = JSON.parse(PropertiesService.getDocumentProperties().getProperty('GR_FAC_' + id) || 'null');
    if (v) return { lineas: Array.isArray(v) ? v : v.l || [], deQuesito: true, factura: Array.isArray(v) ? '' : v.f || '' };
  } catch (e) {}
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
