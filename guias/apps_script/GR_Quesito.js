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
  filas.forEach(function (fila) { var r = GR_traerDatosFila_(ss, sh, fila); msgs = msgs.concat(r.msgs); pedidas += r.pedidas; });
  if (pedidas) GR_programarRevision_();
  ss.toast(msgs.join('\n') || 'No había guías en esas filas.', '📥 Traer datos de la factura', 12);
}

/** 📥 de UNA fila (lo usan el menú y ➕ Nueva guía rápida). → {msgs, pedidas}: pedidas = 1 si se mandó a leer en Quesito. */
function GR_traerDatosFila_(ss, sh, fila) {
  var msgs = [], pedidas = 0;
  (function () {
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
      var sinCod = items.length && !items.every(function (it) { return /^\s*[A-Z&]{1,6}[\s-]?\d{2,5}\b/i.test(it.desc); });   // SIRE antiguo: sin el CÓD.
      if (quesito && dudosos) porQue.push('productos que se distinguen por el lote');
      else if (quesito && sinCod) porQue.push('el SIRE no trae el código del producto');
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
    if (c.vivo) PropertiesService.getDocumentProperties().setProperty('GR_VIVO_URL', c.vivo);   // 📺 se abre con «Abrir la última transmisión»
    var ojoM = (m.match(/Ojo: .*$/) || [''])[0];
    sh.getRange(fila, GR_col_('msg')).setValue('📥 Leyendo en Quesito ' + (fac ? 'la factura ' + fac : 'la cotización ' + cot) + ' (' + porQue.join('; ') + ')… 1–3 min, no se crea nada.' +
      (m ? ' Ya puse lo del SIRE.' + (ojoM ? ' ' + ojoM : '') : ''));
    sh.getRange(fila, GR_col_('actualizado')).setValue(new Date());
    pedidas++;
    msgs.push(r.id + ': ' + (sire ? '🔎 cliente del SIRE; ' : '') + '📥 Quesito (' + porQue.join('; ') + ')…');
  })();
  return { msgs: msgs, pedidas: pedidas };
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
  } else if (ruc && t('ndest').replace(/\D/g, '') === ruc && t('dest') === '' && nom) {   // ya tenía el RUC: falta solo el nombre
    poner('dest', nom); hecho.push('nombre del cliente');
  } else if (ruc && t('ndest').replace(/\D/g, '') !== ruc) {
    // En una venta el destinatario ES el cliente de la factura: el de la fila era de otra factura (o estaba mal) → se cambia.
    var viejo = t('ndest').replace(/\D/g, '');
    // Direcciones de 📍 que son de OTRO cliente (no del de la factura): si la llegada es una de ellas, no sirve.
    var dirViejo = ctx.dir.filter(function (q) { return q.doc && q.doc !== ruc && !/partida/i.test(q.uso); }).map(function (q) { return GR_norm_(q.dir); });
    var sets = { tdest: ruc.length === 11 ? GR_TIPODOC_[0] : GR_TIPODOC_[1], ndest: ruc, dest: nom };
    Object.keys(sets).forEach(function (k) { sh.getRange(fila, GR_col_(k)).setValue(sets[k]); x[k] = sets[k]; puestos[k] = sets[k]; });
    if (t('ldir') && dirViejo.indexOf(GR_norm_(t('ldir'))) >= 0 && !t('llocal')) {   // la llegada era la del cliente anterior
      ['ldir', 'lubi', 'lest'].forEach(function (k) { sh.getRange(fila, GR_col_(k)).setValue(''); x[k] = ''; });
      ojo.push('quité la llegada (era de otro cliente): ' + (cp.direccion ? 'puse la de la factura' : 'póngala o use 📥 otra vez para traerla de Quesito'));
    }
    hecho.push('cliente ' + (nom || ruc));
    ojo.push('el cliente de la fila (' + viejo + ') no era el de la factura: puse ' + ruc);
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
  // Sin dirección en la factura ni en 📍: el domicilio fiscal del cliente según SUNAT
  if (t('ldir') === '' && ruc && ruc.length === 11) {
    var fis = GR_domicilioFiscal_(ruc);
    if (fis) {
      poner('ldir', fis.direccion); if (t('lubi') === '') poner('lubi', fis.etiqueta);
      hecho.push('llegada (domicilio fiscal SUNAT)');
      ojo.push('la llegada es el domicilio fiscal del cliente: cámbiela si se entrega en un almacén (📍 Buscar direcciones por RUC)');
    }
  }
  // Productos: todo lo de la factura o lo que dice "Producto y cantidad"
  var ls = (d.lineas || []).map(GR_lineaQuesito_), prods = ctx.prod[t('id')] || [], previa = GR_facturaGuardada_(t('id'));
  // Otra factura, o lo de Quesito (con lotes) reemplaza lo del SIRE: 📦 se vuelve a armar
  if (prods.length && ls.length && (previa && previa !== String(d.factura || '') || d.fuente !== 'sire' && GR_fuenteGuardada_(t('id')) === 'sire')) {
    GR_reemplazarProductos_(ss, t('id'), []); prods = [];
  }
  if (ls.length) GR_guardarFactura_(t('id'), ls, d.factura, d.fuente);   // para 📦 Elegir productos y para «Producto y cantidad»
  if (d.pdf) try { PropertiesService.getDocumentProperties().setProperty('GR_FACPDF_' + t('id'), String(d.pdf)); } catch (e) {}   // 📄 Ver factura
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

/* ---------------- 📄 Ver factura (botón fijo arriba a la izquierda y menú) ---------------- */

function GR_menuVerFactura() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), ui = SpreadsheetApp.getUi();
  var f = sh.getActiveRange().getRow(), id = sh.getName() === GR_HOJA_ && f >= GR_FILA1_ ? String(sh.getRange(f, 1).getValue()) : '';
  if (!id) return ui.alert('📄 Ver factura', 'Haga clic en la fila de la guía (en ' + GR_HOJA_ + ') y vuelva a tocar el botón.', ui.ButtonSet.OK);
  var t = HtmlService.createTemplateFromFile('GR_FacturaVista');
  t.idGuia = id;
  ui.showModalDialog(t.evaluate().setWidth(960).setHeight(660), '📄 Factura de la guía ' + id);
}

/** Datos de la factura de una guía: cabecera del SIRE (si está), líneas (Quesito o SIRE) y el PDF (si Quesito lo trajo). */
function GR_datosFactura(id) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(GR_HOJA_), fila = GR_filaDe_(sh, id);
  if (!fila) throw new Error('No encontré la guía ' + id + '.');
  var r = GR_leerGuias_(sh, fila, fila)[0].r, ctx = GR_contexto_(ss), emp = ctx.emp[String(r.empresa).trim()] || {};
  var serie = String(r.serie || '').toUpperCase().trim(), numero = String(r.numero || '').replace(/\D/g, '');
  var out = { id: id, empresa: String(r.empresa || ''), factura: serie && numero ? serie + '-' + Number(numero) : '', cotizacion: String(r.cotizacion || ''),
    cliente: { ruc: String(r.ndest || ''), nombre: String(r.dest || '') }, llegada: String(r.ldir || ''), lineas: [], sire: null, pdf: '', error: '' };
  try { out.pdf = PropertiesService.getDocumentProperties().getProperty('GR_FACPDF_' + id) || ''; } catch (e) {}
  if (emp.ruc && serie && numero) {
    try {
      var b = GR_buscarFactura_(emp.ruc, serie, numero, r.fecha, []);
      if (b.f) {
        var f = b.f;
        out.sire = { fecha: f.fecha instanceof Date ? Utilities.formatDate(f.fecha, 'America/Lima', 'dd/MM/yyyy') : String(f.fecha || ''),
          ruc: f.ruc, cliente: f.cliente, total: String(f.total || ''), moneda: String(f.moneda || ''), bi: String(f.bi || ''), igv: String(f.igv || '') };
        out.lineas = (f.items || []).map(function (it) { return { desc: it.desc, cant: it.cant, lote: '' }; });
      } else out.error = b.error || '';
    } catch (e) { out.error = e.message; }
  }
  var fac = GR_facturaDe_(ss, id);   // las de Quesito (con lote) mandan sobre las del SIRE
  if (fac.deQuesito && fac.lineas.length && (!out.lineas.length || GR_fuenteGuardada_(id) !== 'sire'))
    out.lineas = fac.lineas.map(function (l) { return { desc: l.desc, cant: l.cant, lote: l.lote || '' }; });
  var ps = ctx.prod[id] || [];
  out.enGuia = ps.map(function (p) { return { desc: String(p.desc), cant: p.cant, lote: String(p.lote || '') }; });
  return out;
}

/** Pone (o repone) el botón «📄 Ver factura» en la esquina fija de 🚚 Guías. */
function GR_botonFactura_(sh) {
  sh.getImages().forEach(function (im) { try { if (im.getScript() === 'GR_menuVerFactura') im.remove(); } catch (e) {} });
  var im = sh.insertImage(Utilities.newBlob(Utilities.base64Decode(GR_BOTON_FACTURA_), 'image/png', 'ver factura.png'), 1, 1, 4, 3);
  im.setWidth(150).setHeight(32).assignScript('GR_menuVerFactura').setAltTextTitle('Ver factura de la fila seleccionada');
}

var GR_BOTON_FACTURA_ = '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';
