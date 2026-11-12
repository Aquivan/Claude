/**
 * 📑 Declaraciones — aplicación web (DEC_Web.js). Aquí llegan las constancias que manda el robot de GitHub.
 * Solo acepta pedidos con una llave vigente creada por esta hoja (DEC_Pedir.js). Acciones:
 *   lista   → el robot dice qué declaraciones hay en SUNAT; la hoja responde cuáles le faltan.
 *   guardar → una declaración con su PDF: se guarda en Drive y se anota en 📄 Declaraciones.
 *   fin     → terminó una empresa: se marcan vigentes / respaldo y se rehacen los reportes.
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var json = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  if (p.registrar) { try { DEC_registrarWeb_(); } catch (x) { console.warn(x); } return json({ ok: true }); }   // DEC_Previo.js
  if (p.previo) { try { return json(DEC_previo_(p)); } catch (x) { return json({ ok: false, error: String(x.message || x).slice(0, 300) }); } }
  return ContentService.createTextOutput('Declaraciones · Grupo: aplicación web activa.');
}

function doPost(e) {
  var salida = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return salida({ ok: false, error: 'pedido ilegible' }); }
  var llaves = DEC_llaves_();
  if (!d.llave || !llaves[d.llave]) return salida({ ok: false, error: 'llave vencida o desconocida (pida la descarga desde la hoja)' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(120000)) return salida({ ok: false, error: 'la hoja está ocupada; reintente' });
  try {
    if (d.accion === 'lista') return salida(DEC_webLista_(d));
    if (d.accion === 'guardar') return salida(DEC_webGuardar_(d));
    if (d.accion === 'fin') return salida(DEC_webFin_(d));
    if (d.accion === 'detalle') return salida(DEC_webDetalle_(d));
    return salida({ ok: false, error: 'acción desconocida' });
  } catch (x) {
    console.error(x);
    return salida({ ok: false, error: String(x.message || x).slice(0, 300) });
  } finally {
    lock.releaseLock();
  }
}

/** ¿Qué N° de orden faltan en la hoja? */
function DEC_webLista_(d) {
  var tengo = {}, sinDet = {};
  DEC_leerDecl_().forEach(function (r) {
    if (r.pdf && !d.rehacer) tengo[r.numOrd] = 1;
    if (r.pdf && !r.det && (r.form === '0621' || r.form === '0626') && !(r.datos && r.datos.sinDetalle)) sinDet[r.numOrd] = 1;
  });
  var faltan = (d.items || []).filter(function (it) { return !tengo[String(it.numOrd)]; }).map(function (it) { return String(it.numOrd); });
  // las que ya están pero sin su PDF «Detalle de la declaración» (621 y 626): el robot baja solo el detalle
  var faltanDetalle = (d.items || []).filter(function (it) { return tengo[String(it.numOrd)] && sinDet[String(it.numOrd)]; }).map(function (it) { return String(it.numOrd); });
  var res = DEC_resultados_();
  var emp = (d.items && d.items[0] && d.items[0].empresa) || (res[d.ruc] && res[d.ruc].empresa) || '';
  res[d.ruc] = { empresa: emp, t: DEC_ahora_(), total: (d.items || []).length, faltan: faltan.length, bien: 0, mal: 0, enCurso: true };
  DEC_guardarResultados_(res);
  return { ok: true, faltan: faltan, faltanDetalle: faltanDetalle };
}

function DEC_webGuardar_(d) {
  var it = d.item || {}, cons = d.constancia || {}, cfg = DEC_cfg_();
  var periodo = String(it.perTri || '').replace(/\D/g, '');
  if (periodo.length !== 6) {   // «09/2026» → 202609
    var m = String(it.strPerTri || '').match(/(\d{2})\/(\d{4})/);
    periodo = m ? m[2] + m[1] : periodo;
  }
  var tipo = cons.tipoDeclaracion || (String(it.numOrdOri || '0') !== '0' ? 'Rectificatoria' : 'Original');
  var form = String(it.codFor || '').slice(-4);
  var empresa = String(it.empresa || '').trim() || d.ruc;
  // PDF a Drive: <raíz>/<RUC - Empresa>/<AAAA>/<MM>/
  var carpeta = DEC_carpetaMes_(cfg, d.ruc, empresa, periodo);
  var nombre = periodo + ' ' + DEC_corto_(form) + ' N° ' + it.numOrd + ' ' + tipo + '.pdf';
  var previos = carpeta.getFilesByName(nombre);
  while (previos.hasNext()) previos.next().setTrashed(true);
  var archivo = carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf', nombre));
  var det = d.detalle ? DEC_guardarDetallePdf_(carpeta, nombre, d.detalle) : null;
  var tributos = (cons.tributos || []).map(function (t) {
    return { cod: String(t.codTri || ''), nom: String(t.descCodTri || '').trim(), deuda: Number(t.mtoTotDeu) || 0, pagado: Number(t.mtoPagtot) || 0, porPagar: Number(t.mtoResPag) || 0 };
  });
  var extra = { trabajadores: cons.trabajadores, pensionistas: cons.pensionistas, personalCuarta: cons.personalCuarta, tributos: tributos, casillas: d.casillas || {} };
  DEC_anotar_({
    empresa: empresa, ruc: d.ruc, periodo: periodo, form: form, desc: DEC_FORMULARIOS[form] || String(it.desFor || '').replace(/\uFFFD/g, 'ó').trim(),
    numOrd: String(it.numOrd), numOrdOri: String(it.numOrdOri || '0'), tipo: tipo, fecha: String(it.strFecPres || ''),
    deuda: tributos.reduce(function (s, t) { return s + t.deuda; }, 0), pagado: tributos.reduce(function (s, t) { return s + t.pagado; }, 0),
    importe: Number(it.mtoPag) || 0, banco: String(it.nomEntFin || '').trim(), operacion: String(it.numOpebco || '').trim(),
    medio: String(it.medioPres || '') === '02' ? 'PDT (aplicativo)' : String(it.medioPres || '') === '01' ? 'Portal SUNAT' : String(it.medioPres || ''),
    pdf: archivo.getUrl(), pdfId: archivo.getId(), det: det ? det.getUrl() : '', detId: det ? det.getId() : '', datos: extra,
  });
  var res = DEC_resultados_();
  if (res[d.ruc]) { res[d.ruc].bien = (res[d.ruc].bien || 0) + 1; res[d.ruc].t = DEC_ahora_(); DEC_guardarResultados_(res); }
  return { ok: true };
}

function DEC_webFin_(d) {
  var res = DEC_resultados_();
  var x = res[d.ruc] || {};
  x.t = DEC_ahora_(); x.enCurso = false;
  if (d.error) x.error = d.error; else { delete x.error; x.bien = d.bien || 0; x.mal = d.mal || 0; x.total = d.total || 0; }
  res[d.ruc] = x;
  DEC_guardarResultados_(res);
  DEC_rehacer_();
  DEC_marcar_(DEC_ahora_() + ' · ' + (x.empresa || d.ruc) + ': ' + (d.error ? 'SUNAT lenta' : (d.bien || 0) + ' nuevas'));
  return { ok: true };
}

function DEC_resultados_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('DEC_RESULTADOS') || '{}'); } catch (e) { return {}; }
}
function DEC_guardarResultados_(r) { PropertiesService.getScriptProperties().setProperty('DEC_RESULTADOS', JSON.stringify(r)); }

function DEC_corto_(form) {
  return { '0621': 'PDT 621', '0601': 'PLAME 601', '0626': 'PDT 626' }[form] || ('Form ' + form);
}

/* ------------------------------------------------------------ Drive */

function DEC_carpetaRaiz_(cfg) {
  var ss = DEC_ss_();
  var padre;
  try { padre = DriveApp.getFileById(ss.getId()).getParents().next(); } catch (e) { padre = DriveApp.getRootFolder(); }
  var it = padre.getFoldersByName(cfg.carpeta);
  return it.hasNext() ? it.next() : padre.createFolder(cfg.carpeta);
}

function DEC_sub_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

function DEC_carpetaMes_(cfg, ruc, empresa, periodo) {
  var raiz = DEC_carpetaRaiz_(cfg);
  var emp = null, it = raiz.getFolders();
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf(ruc) === 0) { emp = f; break; } }
  if (!emp) emp = raiz.createFolder(ruc + ' - ' + empresa);
  return DEC_sub_(DEC_sub_(emp, periodo.slice(0, 4)), periodo.slice(4, 6));
}

/** Guarda el PDF «Detalle de la declaración» junto a la constancia (mismo nombre + « - Detalle»). */
function DEC_guardarDetallePdf_(carpeta, nombreConstancia, b64) {
  var nombre = nombreConstancia.replace(/\.pdf$/i, '') + ' - Detalle.pdf';
  var previos = carpeta.getFilesByName(nombre);
  while (previos.hasNext()) previos.next().setTrashed(true);
  return carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', nombre));
}

/** Solo el detalle de una declaración que ya estaba (el robot lo bajó después). */
function DEC_webDetalle_(d) {
  var r = DEC_leerDecl_().filter(function (x) { return x.numOrd === String(d.numOrd); })[0];
  if (!r) return { ok: false, error: 'esa declaración no está en la hoja' };
  if (!d.detalle) {   // SUNAT no tiene el detalle de esta declaración (p. ej. presentada con el PDT): no se vuelve a pedir
    var h = DEC_hojaDecl_(), f = DEC_filaDe_(h, r.numOrd);
    r.datos.sinDetalle = true;
    if (f) { h.getRange(f, DEC_C_._datos + 1).setValue(JSON.stringify(r.datos).slice(0, 49000)); h.getRange(f, DEC_C_.Detalle + 1).setValue('— SUNAT no lo da'); }
    return { ok: true };
  }
  var carpeta;
  try { carpeta = DriveApp.getFileById(r.pdfId).getParents().next(); } catch (e) { carpeta = DEC_carpetaMes_(DEC_cfg_(), r.ruc, r.empresa, r.periodo); }
  var nombre;
  try { nombre = DriveApp.getFileById(r.pdfId).getName(); } catch (e) { nombre = r.periodo + ' ' + DEC_corto_(r.form) + ' N° ' + r.numOrd + ' ' + r.tipo + '.pdf'; }
  var f = DEC_guardarDetallePdf_(carpeta, nombre, d.detalle);
  DEC_ponerDetalle_(r.numOrd, f.getUrl(), f.getId());
  var res = DEC_resultados_();
  if (res[d.ruc]) { res[d.ruc].detalles = (res[d.ruc].detalles || 0) + 1; DEC_guardarResultados_(res); }
  return { ok: true };
}
