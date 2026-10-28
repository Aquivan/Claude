/**
 * 🚚 Guías — al escribir en la hoja: pone el ID, llena lo que ya se conoce (empresa → partida,
 * cliente → nombre y llegada, transportista, conductor, ubigeo por nombre) y revisa la fila (Estado).
 */

// 👁 Vista previa no queda fija: si la persona cambia un dato, la fila se vuelve a revisar (y la vista previa anterior ya no vale).
var GR_FIJOS_ = [GR_ESTADOS_.EMITIENDO, GR_ESTADOS_.EMITIDA, GR_ESTADOS_.ANULADA];

function onEdit(e) {
  try { GR_alEditar_(e); } catch (err) {
    console.warn('onEdit: ' + (err && err.stack || err));
    if (/versión anterior/.test(String(err && err.message))) try { e.source.toast(err.message, '🚚 Guías', 15); } catch (x) {}
  }
}

/**
 * Lo nuevo que se escribe en una guía se guarda en su pestaña para la próxima vez:
 * chofer completo → 👤 Conductores · placa → 🚗 Vehículos (con su certificado MTC) · transportista → 🚛 Transportistas.
 */
function GR_aprender_(ss, f0, f1, cambiadas) {
  var toca = function (ks) { return ks.some(function (k) { return cambiadas.indexOf(k) >= 0; }); };
  if (!toca(['cdni', 'cnom', 'cape', 'clic', 'placa', 'placa2', 'mtcveh', 'truc', 'tnom', 'mtc'])) return;
  var sh = ss.getSheetByName(GR_HOJA_), ctx = GR_contexto_(ss), nuevos = [];
  var agregar = function (hoja, fila) { var h = ss.getSheetByName(hoja), ult = 1, last = h.getLastRow();
    if (last >= 2) h.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { if (String(r[0]).trim()) ult = i + 2; });
    h.getRange(ult + 1, 1, 1, fila.length).setValues([fila]); };
  GR_leerGuias_(sh, f0, f1).forEach(function (x) {
    var r = x.r, t = function (k) { return String(r[k] == null ? '' : r[k]).trim(); };
    if (!r.id) return;
    var dni = t('cdni').replace(/\D/g, '');
    if (/^\d{8}$/.test(dni) && !ctx.con[dni] && t('cnom') && t('cape') && t('clic')) {
      agregar(GR_CON_, [dni, t('cnom'), t('cape'), t('clic').toUpperCase(), 'SI']); ctx.con[dni] = {}; nuevos.push('conductor ' + t('cnom'));
    }
    var mtcs = t('mtcveh').split(/[\/,;]+/).map(function (z) { return z.trim(); });
    [t('placa'), t('placa2')].forEach(function (pl, i) {
      pl = GR_placa_(pl);
      if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(pl) || ctx.veh[pl]) return;
      agregar(GR_VEH_, [pl, '', 'NO', t('empresa'), 'SI', mtcs[i] || '']); ctx.veh[pl] = {}; nuevos.push('placa ' + pl);
    });
    var ruc = t('truc').replace(/\D/g, '');
    if (GR_rucValido_(ruc) && !ctx.tra[ruc] && t('tnom')) {
      agregar(GR_TRA_, [ruc, t('tnom'), t('mtc'), 'SI']); ctx.tra[ruc] = {}; nuevos.push('transportista ' + t('tnom'));
    }
  });
  if (nuevos.length) ss.toast('Guardado para la próxima vez: ' + nuevos.join(', ') + '.', '🚚 Guías', 6);
}

function GR_alEditar_(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), n = sh.getName(), ss = sh.getParent();
  if (n === GR_HOJA_) {
    var f0 = Math.max(e.range.getRow(), GR_FILA1_), f1 = Math.min(e.range.getLastRow(), f0 + 300);
    if (f1 < f0) return;
    var c0 = e.range.getColumn(), c1 = e.range.getLastColumn();
    var cambiadas = GR_COLS_.filter(function (c, j) { return j + 1 >= c0 && j + 1 <= c1; }).map(function (c) { return c.k; });
    // Otra factura (o cotización, o empresa): lo que era de la factura anterior se quita antes de revisar la fila.
    var cambioDoc = ['serie', 'numero', 'cotizacion', 'empresa'].some(function (k) { return cambiadas.indexOf(k) >= 0; });
    if (cambioDoc && !(e.range.getNumCells() === 1 && String(e.oldValue == null ? '' : e.oldValue) === String(e.value == null ? '' : e.value))) {
      sh.getRange(f0, 1, f1 - f0 + 1, 1).getValues().forEach(function (v, i) {
        var id = String(v[0]);
        if (/^G-\d+$/.test(id)) try { GR_olvidarFactura_(ss, sh, f0 + i, id); } catch (err) { console.warn('olvidar ' + id + ': ' + err.message); }
      });
    }
    if (cambiadas.indexOf('pedido') >= 0) {   // «Producto y cantidad» escrito a mano → 📦 Productos igual
      sh.getRange(f0, 1, f1 - f0 + 1, GR_col_('pedido')).getValues().forEach(function (v) {
        var id = String(v[0]);
        if (/^G-\d+$/.test(id)) try { GR_pedidoA_Productos_(ss, id, v[GR_col_('pedido') - 1]); } catch (err) { console.warn('pedido ' + id + ': ' + err.message); }
      });
    }
    GR_procesarFilas_(ss, f0, f1, cambiadas);
    try { GR_aprender_(ss, f0, f1, cambiadas); } catch (err) { console.warn('aprender: ' + err.message); }
  } else if (n === GR_PROD_) {
    var ids = sh.getRange(Math.max(2, e.range.getRow()), 1, e.range.getNumRows(), 1).getValues().map(function (r) { return String(r[0]); });
    if (e.oldValue) ids.push(String(e.oldValue));
    GR_actualizarPorIds_(ss, ids);
  } else if (GR_CATALOGOS_[n] && e.range.getRow() > 1) {
    GR_normalizarCatalogo_(sh, e.range);
  }
}

/** Las columnas de la hoja son las del código (si no, nada se lee ni se escribe: iría a la columna equivocada). */
var GR_AL_DIA_ = false;
function GR_hojaAlDia_(sh) {
  if (GR_AL_DIA_) return;
  var tit = sh.getRange(2, 1, 1, GR_COLS_.length).getValues()[0].map(function (t) { return String(t).trim(); });
  var mal = GR_COLS_.filter(function (c, j) { return tit[j] !== c.t; });
  if (mal.length) throw new Error('la hoja tiene columnas de una versión anterior (falta «' + mal[0].t + '»). ' +
    'Use el menú 🚚 Guías → 🧰 Preparar / reparar la hoja (no borra datos) y vuelva a intentar.');
  GR_AL_DIA_ = true;
}

/** Lee la hoja de 🚚 Guías como objetos {fila, r:{clave: valor}}. */
function GR_leerGuias_(sh, f0, f1) {
  GR_hojaAlDia_(sh);
  var v = sh.getRange(f0, 1, f1 - f0 + 1, GR_COLS_.length).getValues();
  return v.map(function (fila, i) {
    var r = {};
    GR_COLS_.forEach(function (c, j) { r[c.k] = fila[j]; });
    return { fila: f0 + i, r: r, antes: fila.slice() };
  });
}

/** Autollenado + revisión de las filas f0..f1; escribe solo las celdas que cambian. */
function GR_procesarFilas_(ss, f0, f1, cambiadas) {
  var sh = ss.getSheetByName(GR_HOJA_), ctx = GR_contexto_(ss);
  var filas = GR_leerGuias_(sh, f0, f1);
  filas.forEach(function (x) {
    var r = x.r;
    var vacia = GR_COLS_.every(function (c) { return ['estado', 'id', 'obsFinal', 'productos'].indexOf(c.k) >= 0 || r[c.k] === '' || r[c.k] === null; });
    if (vacia) { r.id = ''; r.estado = ''; r.obsFinal = ''; r.productos = ''; }
    else {
      if (!r.id) { r.id = GR_nuevoId_(); GR_valoresIniciales_(r); }
      GR_autollenar_(r, cambiadas, ctx);
      GR_ponerEstado_(r, ctx);
    }
    GR_COLS_.forEach(function (c, j) {
      var a = x.antes[j], b = r[c.k];
      var igual = (a instanceof Date && b instanceof Date) ? a.getTime() === b.getTime() : String(a) === String(b);
      if (!igual) sh.getRange(x.fila, j + 1).setValue(b);
    });
  });
}

function GR_nuevoId_() {
  var lock = LockService.getDocumentLock();
  try { lock.waitLock(10000); } catch (e) {}
  try { return GR_siguienteId_(); } finally { try { lock.releaseLock(); } catch (e) {} }
}

function GR_siguienteId_() {
  var p = PropertiesService.getDocumentProperties(), n = Number(p.getProperty('GR_ULTIMO_ID') || 0) + 1;
  // Por si alguien borró la propiedad: no repetir un ID que ya está en la hoja.
  var sh = SpreadsheetApp.getActive().getSheetByName(GR_HOJA_);
  if (n === 1 && sh.getLastRow() >= GR_FILA1_) {
    sh.getRange(GR_FILA1_, 1, sh.getLastRow() - GR_FILA1_ + 1, 1).getValues().forEach(function (v) {
      var m = String(v[0]).match(/^G-(\d+)$/); if (m) n = Math.max(n, Number(m[1]) + 1);
    });
  }
  p.setProperty('GR_ULTIMO_ID', String(n));
  return 'G-' + ('00000' + n).slice(-6);
}

function GR_valoresIniciales_(r) {
  if (!r.via) r.via = 'Quesito';
  if (!r.docrel) r.docrel = 'Factura';
  if (!r.motivo) r.motivo = GR_MOTIVOS_[0];
  if (!r.total) r.total = 'SI';
  if (!r.upeso) r.upeso = GR_PESO_[0];
  if (!r.m1) r.m1 = 'NO';
  if (!r.tdest && r.docrel === 'Factura') r.tdest = GR_TIPODOC_[0];
}

/* ============================================================ catálogos en memoria */

function GR_tabla_(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().filter(function (f) { return String(f[0]).trim() !== ''; });
}

/** Catálogos y productos por ID, leídos una vez por edición. */
function GR_contexto_(ss) {
  var c = { emp: {}, tra: {}, veh: {}, con: {}, dir: [], local: {}, prod: {}, guias: [] };
  GR_tabla_(ss, GR_EMP_).forEach(function (f) {
    c.emp[String(f[0]).trim()] = { ruc: String(f[1]).replace(/\D/g, ''), razon: f[2], correo: f[3], serie: f[4], ubi: f[5], dir: f[6], est: GR_codLocal_(f[7]),
      activa: String(f[8]).toUpperCase() !== 'NO', serieFact: String(f[9] || '').toUpperCase().trim() };
  });
  GR_tabla_(ss, GR_TRA_).forEach(function (f) { c.tra[String(f[0]).replace(/\D/g, '')] = { nom: f[1], mtc: f[2] }; });
  GR_tabla_(ss, GR_VEH_).forEach(function (f) { c.veh[GR_placa_(f[0])] = { desc: f[1], m1: String(f[2]).toUpperCase() === 'SI', mtc: String(f[5] || '').trim() }; });
  GR_tabla_(ss, GR_CON_).forEach(function (f) { c.con[String(f[0]).replace(/\D/g, '')] = { nom: f[1], ape: f[2], lic: f[3] }; });
  GR_tabla_(ss, GR_DIR_).forEach(function (f) {
    var d = { local: String(f[0]).trim(), doc: String(f[1]).replace(/\D/g, ''), nom: f[2], uso: String(f[3] || 'Llegada'), ubi: f[4], dir: f[5], est: GR_codLocal_(f[6]) };
    c.dir.push(d); c.local[d.local] = d;
  });
  var p = ss.getSheetByName(GR_PROD_);
  if (p && p.getLastRow() > 1) p.getRange(2, 1, p.getLastRow() - 1, 10).getValues().forEach(function (f) {
    var id = String(f[0]).trim();
    if (!id) return;
    (c.prod[id] = c.prod[id] || []).push({ cod: f[2], desc: f[3], unidad: String(f[4]).split(' - ')[0], cant: Number(f[5]) || 0, lote: f[6],
      peso: Number(f[7]) || 0, bultos: Number(f[8]) || 0, completa: String(f[9] || '') });
  });
  c.hoy = new Date(); c.hoy.setHours(0, 0, 0, 0);
  return c;
}

/* ============================================================ autollenado */

function GR_autollenar_(r, cambiadas, ctx) {
  var cambio = function (k) { return cambiadas.indexOf(k) >= 0; };
  // Documento relacionado
  if (r.serie) r.serie = String(r.serie).toUpperCase().replace(/\s/g, '');
  if (r.numero !== '' && /^\d+$/.test(String(r.numero).trim())) r.numero = Number(r.numero);
  if (cambio('serie') && /^B/.test(r.serie) && r.docrel === 'Factura') r.docrel = 'Boleta';
  // "Producto y cantidad": «total» o vacío = todo lo de la factura; con productos = solo una parte
  if (cambio('pedido')) {
    var ped = []; try { ped = GR_partirPedido_(r.pedido); } catch (e) {}
    r.total = ped.length ? 'NO' : 'SI';
  }
  var emp = ctx.emp[String(r.empresa).trim()];
  if (emp && !r.serie && r.docrel === 'Factura' && emp.serieFact && !(String(r.cotizacion).trim() && !r.numero)) r.serie = emp.serieFact;
  // Locales de 📍 Direcciones (varios almacenes por empresa, direcciones de clientes)
  var pl = ctx.local[String(r.plocal).trim()];
  if (pl && (cambio('plocal') || !r.pubi)) { r.pubi = pl.ubi; r.pdir = pl.dir; r.pest = pl.est || r.pest; }
  // Dirección elegida de la lista (la de 📍 Direcciones): se completa como si se hubiera elegido el local
  [['p', 'pdir'], ['l', 'ldir']].forEach(function (x) {
    if (!cambio(x[1]) || !String(r[x[1]]).trim()) return;
    var dd = GR_norm_(r[x[1]]), q = ctx.dir.filter(function (d) { return GR_norm_(d.dir) === dd; })[0];
    if (q) { r[x[0] + 'local'] = q.local || r[x[0] + 'local']; r[x[0] + 'ubi'] = q.ubi || r[x[0] + 'ubi']; if (q.est) r[x[0] + 'est'] = q.est;
      if (x[0] === 'l' && !r.ndest && q.doc && (!emp || q.doc !== emp.ruc)) { r.ndest = q.doc; if (!r.dest) r.dest = q.nom; } }
  });
  var ll = ctx.local[String(r.llocal).trim()];
  if (ll && (cambio('llocal') || !r.lubi)) {
    r.lubi = ll.ubi; r.ldir = ll.dir; r.lest = ll.est || r.lest;
    if (!r.ndest && ll.doc && (!emp || ll.doc !== emp.ruc)) { r.ndest = ll.doc; if (!r.dest) r.dest = ll.nom; }
  }
  // Empresa → punto de partida (si no eligió local)
  if (emp && (cambio('empresa') || !r.pubi)) {
    if (!r.pubi && emp.ubi) r.pubi = emp.ubi;
    if (!r.pdir && emp.dir) r.pdir = emp.dir;
    if (!r.pest && emp.est) r.pest = emp.est;
  }
  // Destinatario: tipo por largo, nombre y llegada conocidos
  if (r.ndest !== '') {
    r.ndest = String(r.ndest).replace(/\D/g, '');
    // Al escribir el número, el tipo sigue al largo: 11 dígitos = RUC, 8 = DNI (los demás se eligen a mano).
    var porLargo = r.ndest.length === 11 ? GR_TIPODOC_[0] : r.ndest.length === 8 ? GR_TIPODOC_[1] : '';
    if (porLargo && (!r.tdest || (cambio('ndest') && /^[61] /.test(r.tdest)))) r.tdest = porLargo;
    if (cambio('ndest') || !r.dest || !r.lubi) {
      var dirs = ctx.dir.filter(function (d) { return d.doc === r.ndest; });
      if (!r.dest && dirs.length) r.dest = dirs[0].nom;
      var lle = dirs.filter(function (d) { return /llegada|ambos/i.test(d.uso); });
      if (!r.lubi && !r.ldir && lle.length === 1) { r.lubi = lle[0].ubi; r.ldir = lle[0].dir; if (!r.lest) r.lest = lle[0].est; }
    }
  }
  // Elegido por nombre (de la lista): se completa el resto
  if (cambio('tnom') && r.tnom && !r.truc) Object.keys(ctx.tra).some(function (k) {
    if (GR_norm_(ctx.tra[k].nom) !== GR_norm_(r.tnom)) return false; r.truc = k; return true; });
  if ((cambio('cnom') || cambio('cape') || cambio('clic')) && !r.cdni) Object.keys(ctx.con).some(function (k) {
    var c = ctx.con[k];
    var igual = (cambio('clic') && r.clic && String(c.lic).toUpperCase() === String(r.clic).toUpperCase()) ||
      (cambio('cnom') && r.cnom && GR_norm_(c.nom) === GR_norm_(r.cnom)) || (cambio('cape') && r.cape && GR_norm_(c.ape) === GR_norm_(r.cape));
    if (!igual) return false; r.cdni = k; return true; });
  if (cambio('dest') && r.dest && !r.ndest) {
    var dq = ctx.dir.filter(function (d) { return d.doc && GR_norm_(d.nom) === GR_norm_(r.dest); })[0];
    if (dq) r.ndest = dq.doc;
  }
  // Transportista
  if (r.truc !== '') {
    r.truc = String(r.truc).replace(/\D/g, '');
    var t = ctx.tra[r.truc];
    if (t) { if (!r.tnom) r.tnom = t.nom; if (!r.mtc && t.mtc) r.mtc = t.mtc; }
    if (!r.modalidad) r.modalidad = GR_MODALIDAD_[0];
  }
  // Vehículo y conductor
  if (r.placa) {
    r.placa = GR_placa_(r.placa);
    var v = ctx.veh[r.placa];
    if (v && v.m1 && cambio('placa')) r.m1 = 'SI';
    if (!r.modalidad) r.modalidad = GR_MODALIDAD_[1];
  }
  if (r.placa2) r.placa2 = GR_placa_(r.placa2);
  if (r.placa && !r.mtcveh) {
    var mt = [ctx.veh[r.placa], ctx.veh[r.placa2]].filter(function (x) { return x && x.mtc; }).map(function (x) { return x.mtc; });
    if (mt.length) r.mtcveh = mt.join('/');
  }
  if (r.cdni !== '') {
    r.cdni = String(r.cdni).replace(/\D/g, '');
    var co = ctx.con[r.cdni];
    if (co) { if (!r.cnom) r.cnom = co.nom; if (!r.cape) r.cape = co.ape; if (!r.clic) r.clic = co.lic; }
  }
  if (r.clic) r.clic = String(r.clic).toUpperCase().replace(/[\s-]/g, '');
  // "HENRRY NOEL CABANA MAMANI" en Nombres y sin apellidos → se parte (los dos últimos son los apellidos)
  if (r.cnom && !r.cape && String(r.cnom).trim().split(/\s+/).length >= 3) { var pn = GR_partirNombre_(r.cnom); r.cnom = pn.nom; r.cape = pn.ape; }
  ['pest', 'lest'].forEach(function (k) { if (r[k] !== '') r[k] = GR_codLocal_(r[k]); });
  // Ubigeos escritos a mano ("santa anita", "150137") → etiqueta de la lista
  [['pubi', 'pdir'], ['lubi', 'ldir']].forEach(function (x) { if (!r[x[0]] && r[x[1]]) r[x[0]] = GR_ubigeoDeTexto_(r[x[1]]); });
  ['pubi', 'lubi'].forEach(function (k) {
    if (!r[k]) return;
    var cod = GR_codUbigeo_(r[k]);
    var et = cod ? GR_ubigeos_()[cod] : GR_buscarUbigeo_(r[k]);
    if (et) r[k] = et;
  });
  // Productos de 📦 (resumen) y, si todos traen peso o bultos, la suma va a la guía
  var ps = ctx.prod[r.id] || [];
  r.productos = GR_resumenProductos_(ps);
  if (ps.length && ps.every(function (p) { return p.peso > 0; })) r.peso = Math.round(ps.reduce(function (t, p) { return t + p.peso; }, 0) * 100) / 100;
  // Un saco a medias sigue siendo un bulto: cada producto se redondea hacia arriba (SUNAT pide un entero)
  if (ps.length && ps.every(function (p) { return p.bultos > 0; })) r.bultos = ps.reduce(function (t, p) { return t + Math.ceil(p.bultos - 1e-9); }, 0);
  r.obsFinal = GR_observaciones_(r);
}

/**
 * Texto completo de Observaciones de la guía: lo escrito + los datos que Quesito no tiene como campo
 * (cotización, MTC, placas, conductor). Ej.: "Lote L-0828. Cotización N° 2780. N° Registro MTC: 1234567CNG.
 * Placa N°1: ABC-123. Conductor: JUAN PEREZ QUISPE, DNI 42424242, Licencia Q42424242."
 */
function GR_observaciones_(r) {
  var t = function (k) { return String(r[k] == null ? '' : r[k]).trim(); }, p = [];
  if (t('obs')) p.push(t('obs').replace(/\.\s*$/, ''));
  if (t('cotizacion')) p.push('Cotización N° ' + t('cotizacion'));
  // Placas, conductor y MTC tienen su propio campo en la guía (Quesito y SUNAT): no se repiten aquí.
  return p.length ? p.join('. ') + '.' : '';
}

function GR_resumenProductos_(ps) {
  if (!ps.length) return '';
  var n = function (x) { return Number(x).toLocaleString('en-US'); };
  return ps.length + ' producto(s): ' + ps.slice(0, 3).map(function (p) {
    return n(p.cant) + ' ' + p.unidad + ' ' + GR_corto_(p).slice(0, 28) + (p.lote ? ' (' + String(p.lote).slice(0, 20) + ')' : ''); }).join(' · ') + (ps.length > 3 ? ' …' : '');
}

/* ============================================================ revisión (Estado) */

function GR_ponerEstado_(r, ctx) {
  if (GR_FIJOS_.some(function (s) { return String(r.estado).indexOf(s) === 0; })) return;
  var v = GR_validar_(r, ctx);
  r.estado = v.faltas.length ? GR_ESTADOS_.BORRADOR + ' · falta: ' + v.faltas.join(', ') : GR_ESTADOS_.LISTA + (v.avisos.length ? ' · ojo: ' + v.avisos.join(', ') : '');
}

/** {faltas:[], avisos:[]} con todo lo que pide SUNAT para la GRE Remitente. */
function GR_validar_(r, ctx) {
  var F = [], A = [], txt = function (k) { return String(r[k] == null ? '' : r[k]).trim(); }, cod2 = function (k) { return txt(k).slice(0, 2); };
  // Empresa
  var emp = ctx.emp[txt('empresa')];
  if (!emp) F.push('empresa');
  else if (!emp.activa) F.push('empresa inactiva');
  else if (!emp.serie) A.push('serie de guía en 🏢 Empresas');
  // Documento relacionado
  var doc = txt('docrel') || 'Factura';
  if (doc !== 'Ninguno') {
    var soloCot = txt('via') !== 'SUNAT' && /\d/.test(txt('cotizacion')) && !txt('numero');   // Quesito busca la factura desde la cotización
    if (soloCot) A.push('sin N° de factura: se busca por la cotización (📥 Traer datos de la factura lo completa)');
    else if (!/^[A-Z0-9]{4}$/.test(txt('serie'))) F.push('serie (4 caracteres)');
    else if (doc === 'Factura' && !/^[FE]/.test(txt('serie'))) A.push('serie de factura empieza con F o E');
    else if (doc === 'Boleta' && !/^[BE]/.test(txt('serie'))) A.push('serie de boleta empieza con B o E');
    if (!soloCot && !/^\d{1,8}$/.test(txt('numero'))) F.push('número de ' + doc.toLowerCase());
  }
  // Destinatario
  // Con factura/boleta, Quesito toma el destinatario del comprobante: aquí es opcional (si se pone, se revisa).
  var td = cod2('tdest').trim(), nd = txt('ndest'), pideDest = doc === 'Ninguno' || nd !== '';
  if (pideDest) {
    if (!td) F.push('tipo doc. destinatario');
    else if (td === '6' && !GR_rucValido_(nd)) F.push(nd ? 'RUC destinatario inválido' : 'RUC destinatario');
    else if (td === '1' && !/^\d{8}$/.test(nd)) F.push('DNI destinatario (8 dígitos)');
    else if (!nd) F.push('N° doc. destinatario');
    if (doc === 'Factura' && td && td !== '6') F.push('con factura el destinatario va con RUC');
    if (!txt('dest')) F.push('nombre destinatario');
  }
  if (emp && nd && nd === emp.ruc && cod2('motivo') !== '04' && cod2('motivo') !== '18') A.push('destinatario = misma empresa (¿motivo 04?)');
  // Traslado
  var mot = cod2('motivo');
  if (!mot) F.push('motivo');
  if (mot === '13' && !txt('motivoTxt')) F.push('descripción del motivo 13');
  var mod = cod2('modalidad');
  if (!mod) F.push('modalidad (público/privado)');
  if (!(r.fecha instanceof Date)) F.push('fecha de inicio');
  else if (r.fecha < ctx.hoy) A.push('fecha de inicio ya pasó (SUNAT no acepta una anterior a la emisión)');
  // Fechas opcionales: emisión (vacío = hoy) y entrega al transportista (vacío = inicio del traslado)
  var fe = r.femision instanceof Date ? r.femision : null, fen = r.fentrega instanceof Date ? r.fentrega : null;
  if (txt('femision') && !fe) F.push('fecha de emisión (dd/mm/aaaa o vacía = hoy)');
  if (fe && fe < ctx.hoy) F.push('fecha de emisión pasada (SUNAT no la acepta; déjela vacía = hoy)');
  else if (fe && fe > ctx.hoy) A.push('fecha de emisión distinta de hoy: el robot la pone, pero revise que Quesito/SUNAT la acepten');
  if (fe && r.fecha instanceof Date && r.fecha < fe) F.push('inicio del traslado antes de la emisión');
  if (txt('fentrega') && !fen) F.push('fecha de entrega al transportista (dd/mm/aaaa o vacía)');
  if (fen && r.fecha instanceof Date && fen < r.fecha) A.push('entrega al transportista antes del inicio del traslado');
  if (txt('via') === 'SUNAT' && fe) A.push('en SUNAT SOL la emisión es siempre del día: la fecha de emisión no se usa');
  if (!(Number(r.peso) > 0)) F.push('peso bruto');
  if (!txt('upeso')) F.push('unidad de peso');
  if (txt('bultos') !== '' && !(Number(r.bultos) >= 0 && Number(r.bultos) % 1 === 0)) F.push('N° bultos (entero)');
  var parcial = txt('total') === 'NO' || doc === 'Ninguno';
  var prods = ctx.prod[txt('id')] || [], pedido = [];
  try { pedido = GR_partirPedido_(r.pedido); } catch (e) { F.push('producto y cantidad: ' + e.message); }
  if (parcial && !prods.length && !(pedido.length && txt('via') !== 'SUNAT')) F.push('productos en 📦 Productos (o escriba «Producto y cantidad»)');
  if (pedido.length && prods.length && txt('via') !== 'SUNAT') A.push('se usa «Producto y cantidad» (📦 Productos no se usa en esta guía)');
  if (prods.some(function (p) { return !(p.cant > 0) || !String(p.desc).trim() || (doc === 'Ninguno' && !p.unidad); })) F.push('productos sin descripción o cantidad');
  // Transporte
  if (mod === '01') {
    if (!GR_rucValido_(txt('truc'))) F.push(txt('truc') ? 'RUC transportista inválido' : 'RUC transportista');
    if (!txt('tnom')) F.push('razón social transportista');
    if (emp && txt('truc') === emp.ruc) A.push('el transportista es la misma empresa: eso es transporte PRIVADO');
    // Vehículo y chofer del transportista: OPCIONALES (si se ponen, se revisan y van en la guía)
    var algo = ['placa', 'placa2', 'cdni', 'cnom', 'cape', 'clic'].some(function (k) { return txt(k); });
    if (algo && txt('m1') !== 'SI') {
      if (txt('placa') && !/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(txt('placa'))) A.push('placa del transportista (ej. ABC-123)');
      if (txt('cdni') && !/^\d{8}$/.test(txt('cdni'))) A.push('DNI del chofer (8 dígitos)');
      var chofer = /^\d{8}$/.test(txt('cdni')) && txt('cnom') && txt('cape') && txt('clic');
      if (txt('cdni') && !chofer) A.push('chofer incompleto (DNI, nombres, apellidos y licencia)');
      if (txt('via') === 'SUNAT' && (!!txt('placa') !== !!chofer)) A.push('en SUNAT el vehículo y el chofer del transportista se registran juntos: ponga los dos o ninguno');
    }
  } else if (mod === '02' && txt('m1') !== 'SI') {
    if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(txt('placa'))) F.push(txt('placa') ? 'placa (ej. ABC-123)' : 'placa');
    if (txt('placa2') && !/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(txt('placa2'))) F.push('placa secundaria');
    if (!/^\d{8}$/.test(txt('cdni'))) F.push(txt('cdni') ? 'DNI conductor (8 dígitos)' : 'DNI conductor');
    if (!txt('cnom')) F.push('nombres conductor');
    if (!txt('cape')) F.push('apellidos conductor');
    if (!txt('clic')) F.push('licencia');
    else if (!/^[A-Z]\d{8}$/.test(txt('clic'))) A.push('licencia (formato usual Q12345678)');
  }
  // Partida y llegada
  var ub = GR_ubigeos_();
  ['p', 'l'].forEach(function (x) {
    var nom = x === 'p' ? 'partida' : 'llegada', c = GR_codUbigeo_(txt(x + 'ubi'));
    if (!c || !ub[c]) F.push('ubigeo ' + nom);
    if (txt(x + 'dir').length < 5) F.push('dirección ' + nom);
    else if (/^\s*(otros?|-+|\.+|s\/?n|sin\s+direcci[oó]n|no\s+(tiene|indica|registra|domiciliado)|ninguna?|varios)\s*\.?\s*$/i.test(txt(x + 'dir'))) F.push('dirección ' + nom + ' real (dice «' + txt(x + 'dir') + '»)');
    if (mot === '04' && !/^\d{4}$/.test(txt(x + 'est'))) F.push('cód. local ' + nom + ' (motivo 04)');
  });
  // La llegada es una dirección de 📍 de OTRO cliente (quedó de otra guía o de otra factura)
  var ndl = txt('ndest').replace(/\D/g, ''), dl = GR_norm_(txt('ldir'));
  var ajena = ndl && dl && cod2('motivo') === '01' && ctx.dir.filter(function (q) { return GR_norm_(q.dir) === dl && q.doc && q.doc !== ndl && !/partida/i.test(q.uso); })[0];
  if (ajena) A.push('la llegada es la dirección de ' + String(ajena.nom || ajena.doc).slice(0, 40) + ', no del cliente');
  if (txt('obsFinal').length > 500) A.push('observaciones muy largas (' + txt('obsFinal').length + ' caracteres)');
  // Lo que piden los robots (👁 Vista previa / ✅ Emitir).
  var quesito = txt('via') !== 'SUNAT';
  if (quesito && !(Number(r.bultos) >= 1)) F.push('N° bultos (Quesito lo pide)');
  if (quesito && doc === 'Ninguno') F.push('en Quesito la guía sale de la factura: ponga la factura o elija Emitir en = SUNAT');
  if (quesito && cod2('motivo') !== '01') A.push('el robot de Quesito por ahora solo hace ventas (motivo 01): use SUNAT para este motivo');
  if (!quesito && !(ctx.prod[txt('id')] || []).length) F.push('productos en 📦 para SUNAT (📥 Traer datos de la factura los llena)');
  if (String(txt('m1')).toUpperCase() === 'SI') A.push('vehículo M1/L: el robot aún no lo marca, revise en la vista previa');
  if (GR_codUbigeo_(txt('pubi')) && GR_codUbigeo_(txt('pubi')) === GR_codUbigeo_(txt('lubi')) && GR_norm_(txt('pdir')) === GR_norm_(txt('ldir'))) F.push('partida y llegada son iguales');
  return { faltas: F, avisos: A };
}

/* ============================================================ productos y catálogos */

/**
 * 📍 Direcciones: RUC/DNI revisado (col. B), ubigeo por nombre (col. E) y, si falta, un nombre de local
 * («BKF CORPORACION · COMAS») para que aparezca en las listas de «Local de partida / llegada» de las guías.
 */
function GR_normalizarDirecciones_(sh, f0, f1) {
  f0 = Math.max(2, f0); f1 = Math.min(f1, sh.getLastRow());
  if (f1 < f0) return;
  var v = sh.getRange(f0, 1, f1 - f0 + 1, 6).getValues(), todos = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  v.forEach(function (r, i) {
    var f = f0 + i, doc = String(r[1]).replace(/\D/g, ''), cd = sh.getRange(f, 2);
    if (!String(r[1]).trim() && !String(r[5]).trim() && !String(r[0]).trim()) { cd.setBackground(null).setNote(''); return; }
    if (String(r[1]).trim() && doc !== String(r[1]).trim()) cd.setValue(doc);
    var ok = !doc || (doc.length === 11 ? GR_rucValido_(doc) : /^\d{8}$/.test(doc));
    cd.setBackground(ok ? null : '#ffcdd2').setNote(ok ? '' : (doc.length === 11 ? 'RUC inválido: no cuadra el dígito verificador.' : 'RUC de 11 o DNI de 8 dígitos.'));
    var cu = sh.getRange(f, 5), u = String(r[4]);
    if (u) { var et = GR_codUbigeo_(u) ? GR_ubigeos_()[GR_codUbigeo_(u)] : GR_buscarUbigeo_(u); if (et && et !== u) { cu.setValue(et); u = et; } }
    else if (String(r[5]).trim()) { var eu = GR_ubigeoDeTexto_(r[5]); if (eu) { cu.setValue(eu); u = eu; } }
    if (!String(r[0]).trim() && (String(r[2]).trim() || doc)) {   // sin nombre de local: se arma uno
      var dist = ((u.match(/·\s*([^(]+)\(/) || [])[1] || '').trim();
      var base = (String(r[2]).trim().split(/\s+/).slice(0, 2).join(' ') || doc) + (dist ? ' · ' + dist : ''), loc = base, n = 2;
      while (todos.indexOf(loc) >= 0) loc = base + ' ' + n++;
      sh.getRange(f, 1).setValue(loc); todos.push(loc);
    }
  });
}

/** Recalcula las guías con esos IDs (cuando cambian sus productos). */
function GR_actualizarPorIds_(ss, ids) {
  ids = ids.filter(function (x) { return /^G-\d+$/.test(x); });
  if (!ids.length) return;
  var sh = ss.getSheetByName(GR_HOJA_), ult = sh.getLastRow();
  if (ult < GR_FILA1_) return;
  var col = sh.getRange(GR_FILA1_, 1, ult - GR_FILA1_ + 1, 1).getValues();
  col.forEach(function (v, i) { if (ids.indexOf(String(v[0])) >= 0) GR_procesarFilas_(ss, GR_FILA1_ + i, GR_FILA1_ + i, ['productos']); });
}

/** En los catálogos: RUC/DNI/placa ordenados y aviso en rojo si el RUC no es válido. */
function GR_normalizarCatalogo_(sh, rango) {
  var n = sh.getName();
  if (n === GR_DIR_) return GR_normalizarDirecciones_(sh, rango.getRow(), rango.getLastRow());   // la 1.ª columna es el nombre del local, no el RUC
  for (var f = rango.getRow(); f <= rango.getLastRow(); f++) {
    var c = sh.getRange(f, 1), v = String(c.getValue()).trim();
    if (!v) { c.setBackground(null).setNote(''); continue; }
    if (n === GR_VEH_) { c.setValue(GR_placa_(v)); continue; }
    var d = v.replace(/\D/g, '');
    var esRuc = n === GR_TRA_ || (n === GR_DIR_ && d.length === 11) || n === GR_EMP_;
    var celda = n === GR_EMP_ ? sh.getRange(f, 2) : c, val = n === GR_EMP_ ? String(sh.getRange(f, 2).getValue()).replace(/\D/g, '') : d;
    if (n !== GR_EMP_ && d !== v) c.setValue(d);
    var ok = esRuc ? GR_rucValido_(val) : (n === GR_CON_ || (n === GR_DIR_ && d.length === 8)) ? /^\d{8}$/.test(val) : true;
    celda.setBackground(ok ? null : '#ffcdd2').setNote(ok ? '' : (esRuc ? 'RUC inválido: no cuadra el dígito verificador (¿está bien escrito?).' : 'DNI de 8 dígitos.'));
    if (n === GR_EMP_ || n === GR_DIR_) {
      var cu = sh.getRange(f, n === GR_EMP_ ? 6 : 4), u = String(cu.getValue());
      if (u) { var et = GR_codUbigeo_(u) ? GR_ubigeos_()[GR_codUbigeo_(u)] : GR_buscarUbigeo_(u); if (et && et !== u) cu.setValue(et); }
    }
  }
}

/** Menú 🔍 Revisar todas. */
function GR_menuRevisar() {
  var ss = SpreadsheetApp.getActive();
  var r = GR_revisarTodo_(ss);
  ss.toast(r.lista + ' lista(s) para emitir · ' + r.borrador + ' con datos por completar.', '🔍 Revisión', 8);
}

function GR_revisarTodo_(ss) {
  var sh = ss.getSheetByName(GR_HOJA_), ult = sh.getLastRow(), out = { lista: 0, borrador: 0 };
  if (ult >= GR_FILA1_) GR_procesarFilas_(ss, GR_FILA1_, ult, []);
  if (ult >= GR_FILA1_) sh.getRange(GR_FILA1_, GR_col_('estado'), ult - GR_FILA1_ + 1, 1).getValues().forEach(function (v) {
    if (String(v[0]).indexOf(GR_ESTADOS_.LISTA) === 0) out.lista++; else if (String(v[0]).indexOf(GR_ESTADOS_.BORRADOR) === 0) out.borrador++;
  });
  return out;
}

function GR_menuDuplicar() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), f = sh.getActiveRange().getRow();
  if (sh.getName() !== GR_HOJA_ || f < GR_FILA1_) return SpreadsheetApp.getUi().alert('Seleccione una fila de 🚚 Guías.');
  var x = GR_leerGuias_(sh, f, f)[0].r;
  if (!x.id) return SpreadsheetApp.getUi().alert('Esa fila está vacía.');
  var nueva = Math.max(sh.getLastRow() + 1, GR_FILA1_);
  var idViejo = x.id;
  x.id = ''; x.estado = ''; x.fecha = ''; ['guia', 'femi', 'sunat', 'pdf', 'ticket', 'msg', 'actualizado'].forEach(function (k) { x[k] = ''; });
  sh.getRange(nueva, 1, 1, GR_COLS_.length).setValues([GR_COLS_.map(function (c) { return x[c.k]; })]);
  GR_procesarFilas_(ss, nueva, nueva, []);
  var idNuevo = sh.getRange(nueva, 1).getValue();
  var p = ss.getSheetByName(GR_PROD_), ps = p.getLastRow() > 1 ? p.getRange(2, 1, p.getLastRow() - 1, 10).getValues().filter(function (q) { return String(q[0]) === idViejo; }) : [];
  if (ps.length) { p.getRange(p.getLastRow() + 1, 1, ps.length, 10).setValues(ps.map(function (q) { q[0] = idNuevo; return q; })); GR_actualizarPorIds_(ss, [idNuevo]); }
  sh.getRange(nueva, GR_col_('fecha')).activate();
  ss.toast('Copia ' + idNuevo + ' de ' + idViejo + (ps.length ? ' (con ' + ps.length + ' producto(s))' : '') + '. Ponga la fecha de traslado y revise lo que cambie.', '📄 Duplicada', 8);
  GR_registrar_(idNuevo, 'Duplicada', 'Copia de ' + idViejo);
}

function GR_menuProductos() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), f = sh.getActiveRange().getRow();
  var id = sh.getName() === GR_HOJA_ && f >= GR_FILA1_ ? String(sh.getRange(f, 1).getValue()) : '';
  var p = ss.getSheetByName(GR_PROD_);
  p.activate();
  if (!id) return;
  var vals = p.getLastRow() > 1 ? p.getRange(2, 1, p.getLastRow() - 1, 1).getValues() : [];
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === id) return p.getRange(i + 2, 1).activate();
  var nueva = p.getLastRow() + 1;
  p.getRange(nueva, 1, 1, 2).setValues([[id, 1]]);
  p.getRange(nueva, 3).activate();
  ss.toast('Escriba aquí los productos de ' + id + ' (una fila por producto, con el mismo ID).', '📦 Productos', 8);
}
