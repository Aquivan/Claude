/**
 * 🚚 Guías — atajos del día a día:
 *   👁 Vista: ocultar las columnas que no aplican a la guía seleccionada (y volver a ver todas).
 *   ➕ Nueva guía rápida: empresa + factura (o cotización) → crea la fila, copia el transporte de la guía anterior
 *      (si se pide) y trae los datos de la factura de una vez.
 *   🚛 Copiar transporte de la guía anterior: placa, chofer, transportista y partida de la última guía.
 *   📋 Resumen del día: pestaña con las guías emitidas en una fecha (N° de guía, cliente, factura, PDF) y las pendientes.
 * Funciones GR_.
 */

var GR_RES_ = '📋 Resumen del día';
// Transporte y partida: lo que se repite cuando el mismo camión sale con varias guías.
var GR_TRANSPORTE_ = ['modalidad', 'm1', 'truc', 'tnom', 'mtc', 'placa', 'placa2', 'mtcveh', 'mtcveh2', 'cdni', 'cnom', 'cape', 'clic', 'plocal', 'pubi', 'pdir', 'pest', 'fecha'];

/* ---------------- 👁 vista ---------------- */

/** Oculta lo que no aplica a la guía de la fila seleccionada (las demás guías no cambian: solo es la vista). */
function GR_menuVistaGuia() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), f = sh.getActiveRange().getRow();
  if (sh.getName() !== GR_HOJA_ || f < GR_FILA1_) return SpreadsheetApp.getUi().alert('Haga clic en la fila de una guía de ' + GR_HOJA_ + '.');
  var r = GR_leerGuias_(sh, f, f)[0].r, t = function (k) { return String(r[k] == null ? '' : r[k]).trim(); };
  var mod = t('modalidad').slice(0, 2), mot = t('motivo').slice(0, 2), ocultar = {};
  if (mod === '02') ['truc', 'tnom', 'mtc'].forEach(function (k) { ocultar[k] = 1; });          // privado: sin transportista público
  if (t('m1') === 'SI') ['placa', 'placa2', 'mtcveh', 'mtcveh2', 'cdni', 'cnom', 'cape', 'clic'].forEach(function (k) { ocultar[k] = 1; });
  if (mot !== '13') ocultar.motivoTxt = 1;
  if (mot !== '04') { ocultar.pest = 1; ocultar.lest = 1; }
  if (t('docrel') === 'Ninguno') ['serie', 'numero', 'pedido', 'total'].forEach(function (k) { ocultar[k] = 1; });
  if (t('via') === 'SUNAT') ocultar.femision = 1;
  ['sunat', 'ticket', 'caso', 'actualizado'].forEach(function (k) { ocultar[k] = 1; });           // técnicas (siguen guardadas)
  GR_COLS_.forEach(function (c, j) { if (ocultar[c.k]) sh.hideColumns(j + 1); else sh.showColumns(j + 1); });
  ss.toast('Vista de la guía ' + r.id + ': ' + Object.keys(ocultar).length + ' columnas ocultas que no aplican. Para ver todo: 🚚 Guías → 👁 Ver todas las columnas.', '👁 Vista', 8);
}

function GR_menuVistaTodo() {
  var sh = SpreadsheetApp.getActive().getSheetByName(GR_HOJA_);
  sh.showColumns(1, GR_COLS_.length);
  SpreadsheetApp.getActive().toast('Se ven todas las columnas.', '👁 Vista', 4);
}

/* ---------------- 🚛 copiar transporte ---------------- */

/** La guía anterior (más arriba) que tiene transporte. → {fila, r} o null. */
function GR_guiaAnterior_(sh, fila) {
  if (fila <= GR_FILA1_) return null;
  var xs = GR_leerGuias_(sh, GR_FILA1_, fila - 1).reverse();
  return xs.filter(function (x) { return x.r.id && (String(x.r.placa).trim() || String(x.r.truc).trim()); })[0] || null;
}

/** Copia el transporte (y la partida y la fecha) de la guía anterior a la fila: solo en las celdas vacías. → texto o ''. */
function GR_copiarTransporte_(ss, sh, fila) {
  var ant = GR_guiaAnterior_(sh, fila);
  if (!ant) return '';
  var r = GR_leerGuias_(sh, fila, fila)[0].r, puestos = [];
  GR_TRANSPORTE_.forEach(function (k) {
    var v = ant.r[k];
    if (v === '' || v == null || String(r[k] == null ? '' : r[k]).trim() !== '') return;
    sh.getRange(fila, GR_col_(k)).setValue(v); puestos.push(k);
  });
  if (puestos.length) GR_procesarFilas_(ss, fila, fila, puestos);
  return puestos.length ? 'transporte de ' + ant.r.id + ' (' + [ant.r.placa, ant.r.cnom, ant.r.tnom].filter(function (x) { return String(x).trim(); }).join(' · ') + ')' : '';
}

function GR_menuCopiarTransporte() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), rg = sh.getActiveRange(), msgs = [];
  if (sh.getName() !== GR_HOJA_ || rg.getRow() < GR_FILA1_) return SpreadsheetApp.getUi().alert('Seleccione la(s) fila(s) de la(s) guía(s) en ' + GR_HOJA_ + '.');
  for (var f = Math.max(rg.getRow(), GR_FILA1_); f <= rg.getLastRow(); f++) {
    var id = String(sh.getRange(f, 1).getValue());
    if (!id) continue;
    var m = GR_copiarTransporte_(ss, sh, f);
    msgs.push(id + ': ' + (m ? 'copié el ' + m : 'nada que copiar (no hay una guía anterior con transporte, o ya estaba lleno)'));
  }
  ss.toast(msgs.join('\n') || 'No había guías en esas filas.', '🚛 Copiar transporte', 8);
}

/* ---------------- ➕ nueva guía rápida ---------------- */

function GR_menuNuevaRapida() {
  var ctx = GR_contexto_(SpreadsheetApp.getActive());
  var t = HtmlService.createTemplateFromFile('GR_RapidaVista');
  t.empresasJson = JSON.stringify(Object.keys(ctx.emp).filter(function (k) { return ctx.emp[k].activa; }).map(function (k) { return { nombre: k, serie: ctx.emp[k].serieFact || '' }; }));
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(460).setHeight(420), '➕ Nueva guía rápida');
}

/** d = {empresa, factura ("FQQ1-3702" o "3702"), cotizacion, copiar (bool)} → {id, fila, msgs} */
function GR_crearGuiaRapida(d) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(GR_HOJA_), ctx = GR_contexto_(ss), emp = ctx.emp[String(d.empresa || '').trim()];
  if (!emp) throw new Error('Elija la empresa.');
  var fac = String(d.factura || '').toUpperCase().replace(/\s/g, ''), cot = String(d.cotizacion || '').replace(/\D/g, ''), serie = '', numero = '';
  var m = fac.match(/^([A-Z0-9]{4})-?0*(\d+)$/);
  if (m) { serie = m[1]; numero = m[2]; }
  else if (/^\d+$/.test(fac)) { serie = emp.serieFact || ''; numero = String(Number(fac)); }
  else if (fac) throw new Error('Escriba la factura como FQQ1-3702 (o solo el número 3702).');
  if (!numero && !cot) throw new Error('Ponga el N° de factura o el de cotización.');
  if (numero && !serie) throw new Error('Esa empresa no tiene «Serie de factura» en 🏢 Empresas: escriba la factura completa (ej. FQQ1-3702).');
  // primera fila libre después de la última guía
  var ult = GR_FILA1_ - 1, last = sh.getLastRow();
  if (last >= GR_FILA1_) sh.getRange(GR_FILA1_, 1, last - GR_FILA1_ + 1, 1).getValues().forEach(function (v, i) { if (String(v[0]).trim()) ult = GR_FILA1_ + i; });
  var fila = ult + 1;
  sh.getRange(fila, GR_col_('empresa')).setValue(d.empresa);
  if (numero) { sh.getRange(fila, GR_col_('serie')).setValue(serie); sh.getRange(fila, GR_col_('numero')).setValue(Number(numero)); }
  if (cot) sh.getRange(fila, GR_col_('cotizacion')).setValue(cot);
  GR_procesarFilas_(ss, fila, fila, ['empresa', 'serie', 'numero', 'cotizacion']);   // ID y valores iniciales
  var msgs = [];
  if (d.copiar) { var cp = GR_copiarTransporte_(ss, sh, fila); msgs.push(cp ? '🚛 Copié el ' + cp : '🚛 No había una guía anterior con transporte para copiar.'); }
  var r = GR_traerDatosFila_(ss, sh, fila);
  if (r.pedidas) GR_programarRevision_();
  msgs = msgs.concat(r.msgs);
  var id = String(sh.getRange(fila, 1).getValue());
  sh.getRange(fila, GR_col_('estado')).activate();
  GR_registrar_(id, '➕ Nueva guía rápida', (numero ? serie + '-' + numero : 'cotización ' + cot));
  return { id: id, fila: fila, msgs: msgs };
}

/* ---------------- 📋 resumen del día ---------------- */

function GR_menuResumen() {
  var ui = SpreadsheetApp.getUi(), hoy = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy');
  var p = ui.prompt('📋 Resumen del día', 'Fecha (dd/mm/aaaa). Deje vacío para HOY (' + hoy + ').', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var txt = p.getResponseText().trim() || hoy, m = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return ui.alert('Escriba la fecha como 28/10/2026.');
  GR_resumen_(SpreadsheetApp.getActive(), new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

function GR_resumen_(ss, dia) {
  var sh = ss.getSheetByName(GR_HOJA_), last = sh.getLastRow();
  var clave = Utilities.formatDate(dia, 'America/Lima', 'yyyyMMdd'), titulo = Utilities.formatDate(dia, 'America/Lima', 'dd/MM/yyyy');
  var xs = last >= GR_FILA1_ ? GR_leerGuias_(sh, GR_FILA1_, last) : [];
  var pdfs = last >= GR_FILA1_ ? sh.getRange(GR_FILA1_, GR_col_('pdf'), last - GR_FILA1_ + 1, 1).getFormulas() : [];
  var dma = function (v) { return v instanceof Date ? Utilities.formatDate(v, 'America/Lima', 'yyyyMMdd') : ''; };
  var fila = function (x, i) {
    var r = x.r;
    return [r.guia || '', r.femi instanceof Date ? Utilities.formatDate(r.femi, 'America/Lima', 'HH:mm') : '', r.empresa, r.dest, r.ndest,
      r.numero ? r.serie + '-' + r.numero : (r.cotizacion ? 'Cot. ' + r.cotizacion : ''), String(r.productos || '').replace(/^\d+ producto\(s\):\s*/, ''),
      r.ldir, String(r.modalidad).slice(0, 2) === '01' ? 'Público: ' + r.tnom : 'Privado', r.placa + (r.placa2 ? ' / ' + r.placa2 : ''),
      String((r.cnom || '') + ' ' + (r.cape || '')).trim(), (pdfs[x.fila - GR_FILA1_] || [''])[0] || '', String(r.estado).split(' · ')[0], r.id];
  };
  var emitidas = xs.filter(function (x) { return x.r.id && String(x.r.estado).indexOf(GR_ESTADOS_.EMITIDA) === 0 && dma(x.r.femi) === clave; });
  var pendientes = xs.filter(function (x) { return x.r.id && !/^(🚚|🚫)/.test(String(x.r.estado)) && (dma(x.r.fecha) === clave || !(x.r.fecha instanceof Date)); });
  var res = ss.getSheetByName(GR_RES_) || ss.insertSheet(GR_RES_);
  res.clear(); res.setTabColor('#1565c0');
  var cab = ['N° guía', 'Hora', 'Empresa', 'Cliente', 'RUC / DNI', 'Factura', 'Productos', 'Llegada', 'Transporte', 'Placa(s)', 'Conductor', 'PDF', 'Estado', 'ID'];
  res.getRange(1, 1).setValue('📋 Guías del ' + titulo).setFontSize(14).setFontWeight('bold').setFontColor('#1565c0');
  res.getRange(2, 1).setValue(emitidas.length + ' emitida(s) · ' + pendientes.length + ' por emitir · generado ' +
    Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm')).setFontColor('#607d8b');
  var f = 4;
  var bloque = function (tit, lista, color) {
    res.getRange(f, 1).setValue(tit).setFontWeight('bold').setFontColor(color); f++;
    res.getRange(f, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground(color).setFontColor('#ffffff'); f++;
    if (!lista.length) { res.getRange(f, 1).setValue('(ninguna)').setFontColor('#9e9e9e'); f += 2; return; }
    var v = lista.map(fila);
    res.getRange(f, 1, v.length, cab.length).setValues(v.map(function (row) { return row.map(function (c, j) { return j === 11 ? '' : c; }); }));
    v.forEach(function (row, i) { if (row[11]) res.getRange(f + i, 12).setFormula(row[11]); });
    res.getRange(f, 1, v.length, cab.length).setWrap(true).setVerticalAlignment('top');
    f += v.length + 1;
  };
  bloque('🚚 Emitidas', emitidas, '#2e7d32');
  bloque('⏳ Por emitir (fecha de traslado ese día o sin fecha)', pendientes, '#e65100');
  [110, 50, 70, 200, 95, 90, 240, 240, 150, 110, 160, 70, 140, 75].forEach(function (w, i) { res.setColumnWidth(i + 1, w); });
  res.setFrozenRows(0);
  res.activate();
  ss.toast('Listo: ' + emitidas.length + ' emitida(s) y ' + pendientes.length + ' por emitir. Para imprimir: Archivo → Imprimir.', '📋 Resumen', 8);
}
