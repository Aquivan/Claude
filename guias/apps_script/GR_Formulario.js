/**
 * 🚚 Guías — formulario lateral (➕ Nueva guía / ✏️ Editar). Escribe en la misma fila de 🚚 Guías y
 * en 📦 Productos; la revisión y el autollenado son los mismos que al escribir en la hoja.
 */

function GR_menuNueva() { GR_abrirFormulario_(''); }

function GR_menuEditar() {
  var sh = SpreadsheetApp.getActiveSheet(), f = sh.getActiveRange().getRow();
  var id = sh.getName() === GR_HOJA_ && f >= GR_FILA1_ ? String(sh.getRange(f, 1).getValue()) : '';
  if (!id) return SpreadsheetApp.getUi().alert('Seleccione una fila con guía en 🚚 Guías (o use ➕ Nueva guía).');
  GR_abrirFormulario_(id);
}

function GR_abrirFormulario_(id) {
  var t = HtmlService.createTemplateFromFile('GR_FormularioVista');
  t.idGuia = id;
  SpreadsheetApp.getUi().showSidebar(t.evaluate().setTitle(id ? '✏️ Guía ' + id : '➕ Nueva guía de remisión'));
}

/** Todo lo que el formulario necesita: listas, catálogos y (si edita) la guía con sus productos. */
function GR_datosFormulario(id) {
  var ss = SpreadsheetApp.getActive(), ctx = GR_contexto_(ss);
  var out = {
    listas: { motivos: GR_MOTIVOS_, modalidad: GR_MODALIDAD_, tipodoc: GR_TIPODOC_, docrel: GR_DOCREL_, pesos: GR_PESO_, unidades: GR_UNIDADES_ },
    empresas: Object.keys(ctx.emp).filter(function (k) { return ctx.emp[k].activa; }).map(function (k) { return { nombre: k, ruc: ctx.emp[k].ruc, ubi: ctx.emp[k].ubi, dir: ctx.emp[k].dir, est: ctx.emp[k].est }; }),
    tra: Object.keys(ctx.tra).map(function (k) { return { ruc: k, nom: ctx.tra[k].nom, mtc: ctx.tra[k].mtc }; }),
    veh: Object.keys(ctx.veh).map(function (k) { return { placa: k, desc: ctx.veh[k].desc, m1: ctx.veh[k].m1 }; }),
    con: Object.keys(ctx.con).map(function (k) { return { dni: k, nom: ctx.con[k].nom, ape: ctx.con[k].ape, lic: ctx.con[k].lic }; }),
    dir: ctx.dir,
    ubigeos: GR_UBIGEOS_.map(GR_etiquetaUbigeo_),
    guia: null, productos: [],
  };
  if (id) {
    var sh = ss.getSheetByName(GR_HOJA_), f = GR_filaDe_(sh, id);
    if (f) {
      var r = GR_leerGuias_(sh, f, f)[0].r;
      if (r.fecha instanceof Date) r.fecha = Utilities.formatDate(r.fecha, 'America/Lima', 'yyyy-MM-dd');
      GR_COLS_.forEach(function (c) { if (r[c.k] instanceof Date) r[c.k] = Utilities.formatDate(r[c.k], 'America/Lima', 'dd/MM/yyyy HH:mm'); });
      out.guia = r;
      out.productos = (ctx.prod[id] || []).map(function (p) { return { desc: p.desc, unidad: GR_UNIDADES_.filter(function (u) { return u.indexOf(p.unidad + ' ') === 0; })[0] || p.unidad, cant: p.cant, lote: p.lote }; });
    }
  }
  return out;
}

function GR_filaDe_(sh, id) {
  var ult = sh.getLastRow();
  if (!id || ult < GR_FILA1_) return 0;
  var v = sh.getRange(GR_FILA1_, 1, ult - GR_FILA1_ + 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === id) return GR_FILA1_ + i;
  return 0;
}

/** Guarda lo del formulario. g = {clave: valor} de GR_COLS_ + productos:[{desc, unidad, cant, lote}]. → {id, estado, fila}. */
function GR_guardarFormulario(g) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(GR_HOJA_);
  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    var f = g.id ? GR_filaDe_(sh, g.id) : 0;
    if (f) {
      var est = String(sh.getRange(f, GR_col_('estado')).getValue());
      if (GR_FIJOS_.some(function (s) { return est.indexOf(s) === 0; })) throw new Error('La guía ' + g.id + ' ya está ' + est + ': no se puede cambiar.');
    } else {
      f = Math.max(GR_ultimaFilaGuias_(sh) + 1, GR_FILA1_);
      g.id = '';
    }
    var actual = GR_leerGuias_(sh, f, f)[0].r;
    var editables = GR_COLS_.filter(function (c) { return c.g !== 'res' && ['id', 'estado', 'productos', 'obsFinal'].indexOf(c.k) < 0; });
    editables.forEach(function (c) {
      var v = g[c.k] == null ? '' : g[c.k];
      if (c.k === 'fecha' && v) { var p = String(v).split('-'); v = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
      if ((c.k === 'peso' || c.k === 'bultos') && v !== '') v = Number(v);
      actual[c.k] = v;
    });
    sh.getRange(f, 1, 1, GR_COLS_.length).setValues([GR_COLS_.map(function (c) { return actual[c.k] == null ? '' : actual[c.k]; })]);
    GR_procesarFilas_(ss, f, f, editables.map(function (c) { return c.k; }));
    var id = String(sh.getRange(f, 1).getValue());
    GR_guardarProductos_(ss, id, g.productos || []);
    GR_procesarFilas_(ss, f, f, ['productos']);
    var estado = String(sh.getRange(f, GR_col_('estado')).getValue());
    GR_registrar_(id, g.id ? 'Editada (formulario)' : 'Creada (formulario)', estado);
    sh.getRange(f, 1).activate();
    return { id: id, estado: estado, fila: f };
  } finally {
    lock.releaseLock();
  }
}

function GR_ultimaFilaGuias_(sh) {
  var ult = sh.getLastRow();
  if (ult < GR_FILA1_) return GR_FILA1_ - 1;
  var v = sh.getRange(GR_FILA1_, 1, ult - GR_FILA1_ + 1, 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]).trim()) return GR_FILA1_ + i;
  return GR_FILA1_ - 1;
}

/** Reemplaza los productos de esa guía en 📦 Productos. */
function GR_guardarProductos_(ss, id, productos) {
  var p = ss.getSheetByName(GR_PROD_);
  var ult = p.getLastRow();
  if (ult > 1) {
    var v = p.getRange(2, 1, ult - 1, 1).getValues();
    for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]) === id) p.deleteRow(i + 2);
  }
  var filas = productos.filter(function (x) { return String(x.desc || '').trim() || Number(x.cant) > 0; })
    .map(function (x, i) { return [id, i + 1, '', String(x.desc || '').trim(), x.unidad || GR_UNIDADES_[0], Number(x.cant) || '', String(x.lote || '').trim(), '']; });
  if (filas.length) {
    var desde = 2;
    var col = p.getLastRow() > 1 ? p.getRange(2, 1, p.getLastRow() - 1, 1).getValues() : [];
    while (desde - 2 < col.length && String(col[desde - 2][0]).trim()) desde++;
    p.getRange(desde, 1, filas.length, 8).setValues(filas);
  }
}

