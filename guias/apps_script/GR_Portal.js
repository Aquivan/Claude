/**
 * 🌐 Portal web de Guías — la misma hoja, desde el celular o la PC, SIN cuenta de Google.
 *
 * Es la aplicación web de este proyecto (se abre con un enlace). Cada persona entra con su usuario y PIN de la
 * pestaña 👥 Portal (los administra el dueño de la hoja) y ve solo lo que su permiso deja:
 *   ver = mirar guías, borrador y factura · armar = además crear y corregir · emitir = además emitir · admin = todo.
 * Todo se escribe en las mismas pestañas; el 🧾 Registro anota quién hizo qué («🌐 usuario»).
 *
 * SEGURIDAD: una aplicación web deja llamar a cualquier función pública del proyecto. Por eso:
 *   - el portal solo usa PT_entrar / PT_api / PT_fn, que revisan la sesión y el permiso en cada llamada;
 *   - las funciones públicas GR_… de la hoja empiezan con GR_guardia_(): sin sesión del portal solo funcionan
 *     desde la hoja abierta (con sus menús y ventanas), nunca desde el enlace.
 * Funciones PT_.
 */

var PT_HOJA_ = '👥 Portal';
var PT_PERMISOS_ = ['ver', 'armar', 'emitir', 'admin'];   // cada uno incluye a los anteriores
var PT_HORAS_ = 10;   // la sesión dura esto (luego se vuelve a poner el PIN)
var PT_SESION_ = null;   // sesión de ESTA llamada (la pone PT_api / PT_fn)

// Ventanas de la hoja que el portal reutiliza tal cual, y el permiso que pide cada función que llaman.
var PT_FN_ = {
  GR_datosBorrador: 'ver', GR_datosFactura: 'ver', GR_datosFormulario: 'ver', GR_datosProductos: 'ver', GR_borradorPdf: 'ver',
  GR_buscarDirecciones: 'ver', GR_buscarTransporte: 'ver', GR_datosBuscar: 'ver', GR_buscarFacturaDe: 'armar',
  GR_guardarBorrador: 'armar', GR_guardarFormulario: 'armar', GR_guardarProductos: 'armar', GR_crearGuiaRapida: 'armar',
  GR_agregarDirecciones: 'armar', GR_guardarTransporte: 'armar'
};

/**
 * Sin sesión del portal, solo desde la hoja abierta (menús y sus ventanas). La hoja se reconoce porque allí existe su
 * interfaz (SpreadsheetApp.getUi); desde la aplicación web no existe, así que un visitante del enlace no puede usarlas.
 */
function GR_guardia_() {
  if (PT_SESION_) return;
  try { SpreadsheetApp.getUi(); } catch (x) { throw new Error('Sin permiso.'); }
}

/* ============================================================ la página */

function doGet() {
  return HtmlService.createTemplateFromFile('GR_PortalVista').evaluate()
    .setTitle('🚚 Guías de remisión')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ============================================================ usuarios (pestaña 👥 Portal) */

var PT_COLS_ = ['Usuario', 'Nombre', 'PIN', 'Permiso', 'Activo', 'Último ingreso', 'Notas'];

function PT_hoja_(ss) {
  ss = ss || SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(PT_HOJA_);
  if (sh) return sh;
  sh = ss.insertSheet(PT_HOJA_);
  sh.getRange(1, 1, 1, PT_COLS_.length).setValues([PT_COLS_]).setFontWeight('bold').setBackground('#37474f').setFontColor('#fff');
  sh.setFrozenRows(1);
  [110, 180, 120, 90, 60, 140, 260].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('C1').setNote('Escriba el PIN (4 a 8 números). Al guardarlo se reemplaza por 🔒 (se guarda cifrado: nadie lo puede volver a leer). Para cambiarlo, escriba uno nuevo encima.');
  sh.getRange('D1').setNote('ver = mirar guías, borrador y factura · armar = además crear y corregir · emitir = además emitir · admin = todo.');
  sh.getRange('E1').setNote('Desmarque para quitar el acceso al instante.');
  sh.getRange('D2:D200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PT_PERMISOS_, true).build());
  sh.getRange('E2:E200').insertCheckboxes();
  sh.getRange('C2:C200').setNumberFormat('@');
  return sh;
}

function PT_hash_(pin) {
  var p = PropertiesService.getScriptProperties(), sal = p.getProperty('PT_SAL');
  if (!sal) { sal = Utilities.getUuid(); p.setProperty('PT_SAL', sal); }
  return '🔒' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + '|' + String(pin).trim())).slice(0, 32);
}

/** onEdit de 👥 Portal: el PIN escrito se guarda cifrado (lo llama onEdit de GR_Editar.js). */
function PT_alEditar_(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== PT_HOJA_ || e.range.getColumn() !== 3 || e.range.getRow() < 2) return;
  var v = String(e.range.getValue() || '').trim();
  if (!v || v.charAt(0) === '🔒') return;
  if (!/^\d{4,8}$/.test(v)) { e.range.setValue(''); e.range.setNote('⚠️ El PIN debe tener de 4 a 8 números. Vuelva a escribirlo.'); return; }
  e.range.setValue(PT_hash_(v)).setNote('PIN guardado ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'));
}

function PT_usuarios_() {
  var sh = PT_hoja_(), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, PT_COLS_.length).getValues().map(function (v, i) {
    return { fila: i + 2, u: String(v[0]).trim().toLowerCase(), n: String(v[1]).trim(), pin: String(v[2]).trim(), p: String(v[3]).trim() || 'ver', activo: v[4] === true };
  }).filter(function (x) { return x.u; });
}

function PT_nivel_(p) { return PT_PERMISOS_.indexOf(p); }

/* ============================================================ entrar / sesión */

/** usuario + PIN → {token, nombre, permiso}. 5 intentos fallidos bloquean al usuario 15 minutos. */
function PT_entrar(usuario, pin) {
  var u = String(usuario || '').trim().toLowerCase(), cache = CacheService.getScriptCache(), kf = 'pt_f_' + u;
  var fallos = Number(cache.get(kf) || 0);
  if (fallos >= 5) throw new Error('Demasiados intentos. Espere 15 minutos.');
  var x = PT_usuarios_().filter(function (y) { return y.u === u; })[0];
  Utilities.sleep(400);   // frena a quien pruebe PIN tras PIN
  if (!x || !x.activo || !x.pin || x.pin !== PT_hash_(pin)) {
    cache.put(kf, String(fallos + 1), 900);
    throw new Error('Usuario o PIN incorrecto.');
  }
  cache.remove(kf);
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('pt_s_' + token, JSON.stringify({ u: x.u, n: x.n, p: x.p }), PT_HORAS_ * 3600);
  try { PT_hoja_().getRange(x.fila, 6).setValue(new Date()); } catch (e) {}
  GR_registrar_('', '🌐 Entró al portal', x.u);
  return { token: token, nombre: x.n || x.u, permiso: x.p };
}

/** Revisa la sesión (y que el usuario siga activo y con permiso suficiente). */
function PT_sesion_(token, necesita) {
  var s = token ? CacheService.getScriptCache().get('pt_s_' + token) : null;
  if (!s) throw new Error('SESION: su sesión terminó. Vuelva a entrar.');
  s = JSON.parse(s);
  var x = PT_usuarios_().filter(function (y) { return y.u === s.u; })[0];
  if (!x || !x.activo) { CacheService.getScriptCache().remove('pt_s_' + token); throw new Error('SESION: su acceso fue desactivado.'); }
  s.p = x.p; s.n = x.n;   // el permiso vale el de la hoja AHORA (si el admin lo cambia, rige en la siguiente acción)
  if (necesita && PT_nivel_(s.p) < PT_nivel_(necesita)) throw new Error('Su usuario no tiene permiso para esto (pide «' + necesita + '»).');
  PT_SESION_ = s;
  return s;
}

/* ============================================================ API del portal */

/** Llamadas de las ventanas de la hoja reutilizadas (borrador, formulario, productos…): solo las de la lista PT_FN_. */
function PT_fn(token, nombre, args) {
  var nivel = PT_FN_[nombre];
  if (!nivel) throw new Error('Acción no permitida.');
  PT_sesion_(token, nivel);
  return globalThis[nombre].apply(null, args || []);
}

function PT_api(token, accion, d) {
  d = d || {};
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(GR_HOJA_);
  var filaDe = function (id) {
    var f = GR_filaDe_(sh, String(id || ''));
    if (!f) throw new Error('No encontré la guía ' + id + ' (¿la borraron?).');
    return f;
  };
  switch (accion) {
    case 'yo': { var s = PT_sesion_(token); return { nombre: s.n || s.u, permiso: s.p, usuario: s.u }; }
    case 'salir': CacheService.getScriptCache().remove('pt_s_' + token); return true;
    case 'lista': PT_sesion_(token, 'ver'); return PT_lista_(ss, sh);
    case 'empresas': {
      PT_sesion_(token, 'ver');
      var ctx = GR_contexto_(ss);
      return Object.keys(ctx.emp).filter(function (k) { return ctx.emp[k].activa; }).map(function (k) { return { nombre: k, serie: ctx.emp[k].serieFact || '' }; });
    }
    case 'vista': PT_sesion_(token, 'ver'); return PT_vista_(String(d.v || ''), String(d.id || ''), ss, sh);
    case 'traer': {
      PT_sesion_(token, 'armar');
      var r = GR_traerDatosFila_(ss, sh, filaDe(d.id));
      if (r.pedidas) GR_programarRevision_();
      GR_registrar_(d.id, '📥 Traer datos de la factura', '');
      return r.msgs.join('\n') || 'Nada que traer.';
    }
    case 'copiarTransporte': {
      PT_sesion_(token, 'armar');
      var m = GR_copiarTransporte_(ss, sh, filaDe(d.id));
      return m ? '🚛 Copié el ' + m : 'No hay una guía anterior con transporte, o ya estaba lleno.';
    }
    case 'conductor': {
      PT_sesion_(token, 'armar');
      var f = filaDe(d.id), g = GR_leerGuias_(sh, f, f)[0].r, dni = String(g.cdni || '').replace(/\D/g, '');
      if (!/^\d{8}$/.test(dni)) return 'Ponga primero el DNI del conductor (8 dígitos) en ✏️ Editar datos.';
      var n = GR_nombreDni_(dni);
      if (!n) return 'No encontré el DNI ' + dni + '.';
      if (!String(g.cnom).trim()) sh.getRange(f, GR_col_('cnom')).setValue(n.nom);
      if (!String(g.cape).trim()) sh.getRange(f, GR_col_('cape')).setValue(n.ape);
      GR_procesarFilas_(ss, f, f, ['cnom', 'cape']);
      return '👤 ' + n.nom + ' ' + n.ape + (String(g.clic).trim() ? '' : ' · falta la licencia (suele ser una letra + el DNI)');
    }
    case 'robot': {
      var modo = d.modo === 'emitir' ? 'emitir' : 'vista';
      PT_sesion_(token, modo === 'emitir' ? 'emitir' : 'armar');
      // emitir: el portal ya mostró los datos y la persona confirmó (d.confirmo); además se revisa que sea la misma guía.
      var res = GR_pedirRobotFila_(ss, sh, filaDe(d.id), modo, function (r) { return d.confirmo === true && String(r.id) === String(d.id); });
      return res;
    }
    case 'resultados': PT_sesion_(token, 'ver'); return { enCurso: GR_revisarResultados() };
    case 'vivo': PT_sesion_(token, 'ver'); return PropertiesService.getDocumentProperties().getProperty('GR_VIVO_URL') || '';
    case 'resumen': PT_sesion_(token, 'ver'); return PT_resumenEmitir_(ss, sh, filaDe(d.id));
    case 'catalogo': PT_sesion_(token, 'ver'); return PT_catalogo_(ss, String(d.nombre || ''));
    case 'guardarCatalogo': {
      PT_sesion_(token, d.nombre === GR_EMP_ ? 'admin' : 'armar');   // las empresas (series, partida) solo el admin
      return PT_guardarCatalogo_(ss, String(d.nombre || ''), Number(d.fila) || 0, d.valores || []);
    }
    case 'dniCatalogo': {
      PT_sesion_(token, 'armar');
      var n2 = GR_nombreDni_(String(d.dni || '').replace(/\D/g, ''));
      return n2 ? { nom: n2.nom, ape: n2.ape } : null;
    }
    case 'enVivo': {
      PT_sesion_(token, d.activar == null ? 'ver' : 'admin');
      var rv = GR_cob_('vivo', d.activar == null ? {} : { activar: !!d.activar });
      if (!rv.ok) throw new Error(rv.error || 'No pude hablar con el bot.');
      return { activo: !!rv.activo };
    }
  }
  throw new Error('Acción desconocida.');
}

/** Lo que se muestra antes de ✅ Emitir (lo mismo que pregunta la hoja). */
function PT_resumenEmitir_(ss, sh, fila) {
  var r = GR_leerGuias_(sh, fila, fila)[0].r, v = GR_validar_(r, GR_contexto_(ss));
  return { id: r.id, empresa: r.empresa, donde: String(r.via) === 'SUNAT' ? 'SUNAT SOL' : 'Quesito', comprobante: r.numero ? r.docrel + ' ' + r.serie + '-' + r.numero : (r.cotizacion ? 'cotización ' + r.cotizacion : ''),
    destinatario: r.dest || '(cliente de la factura)', llegada: r.ldir || '', fecha: PT_fecha_(r.fecha), faltas: v.faltas, estado: String(r.estado || '') };
}

function PT_fecha_(v) { return v instanceof Date ? Utilities.formatDate(v, 'America/Lima', 'dd/MM/yyyy') : String(v || ''); }

/** Guías para la lista (las más nuevas primero). */
function PT_lista_(ss, sh) {
  var ult = sh.getLastRow();
  if (ult < GR_FILA1_) return [];
  var pdfs = sh.getRange(GR_FILA1_, GR_col_('pdf'), ult - GR_FILA1_ + 1, 1).getFormulas();
  return GR_leerGuias_(sh, GR_FILA1_, ult).filter(function (x) { return String(x.r.id || '').trim(); }).map(function (x, i) {
    var r = x.r, pdf = (String(pdfs[x.fila - GR_FILA1_][0] || '').match(/HYPERLINK\("([^"]+)"/i) || [])[1] || (/^https?:/.test(String(r.pdf)) ? String(r.pdf) : '');
    return { id: String(r.id), estado: String(r.estado || ''), empresa: String(r.empresa || ''), via: String(r.via || 'Quesito'),
      comp: r.numero ? String(r.serie || '') + '-' + r.numero : (r.cotizacion ? 'Cot. ' + r.cotizacion : ''), dest: String(r.dest || ''), ndest: String(r.ndest || ''),
      fecha: PT_fecha_(r.fecha), llegada: String(r.ldir || ''), peso: r.peso ? Number(r.peso) : '', upeso: String(r.upeso || '').slice(0, 3),
      placa: String(r.placa || ''), conductor: [r.cnom, r.cape].filter(String).join(' '), transportista: String(r.tnom || ''), modalidad: String(r.modalidad || '').slice(5),
      guia: String(r.guia || ''), pdf: pdf, msg: String(r.msg || ''), actualizado: r.actualizado instanceof Date ? Utilities.formatDate(r.actualizado, 'America/Lima', 'dd/MM HH:mm') : '' };
  }).reverse();
}

/**
 * Ventanas de la hoja dentro del portal: el mismo HTML que abre el menú (mismos datos de inicio). El portal lo pone en un
 * marco y le presta google.script.run a través de PT_fn (con la sesión), así que no hay que mantener dos versiones.
 */
function PT_vista_(v, id, ss, sh) {
  var t, ctx;
  switch (v) {
    case 'borrador': t = HtmlService.createTemplateFromFile('GR_BorradorVista'); t.idGuia = id; break;
    case 'factura': t = HtmlService.createTemplateFromFile('GR_FacturaVista'); t.idGuia = id; break;
    case 'buscar': PT_sesion_permiso_('armar'); t = HtmlService.createTemplateFromFile('GR_BuscarVista'); t.idGuia = id; break;
    case 'productos': PT_sesion_permiso_('armar'); t = HtmlService.createTemplateFromFile('GR_ProductosVista'); t.idGuia = id; break;
    case 'formulario': PT_sesion_permiso_('armar'); t = HtmlService.createTemplateFromFile('GR_FormularioVista'); t.idGuia = id; break;
    case 'rapida':
      PT_sesion_permiso_('armar');
      ctx = GR_contexto_(ss);
      t = HtmlService.createTemplateFromFile('GR_RapidaVista');
      t.empresasJson = JSON.stringify(Object.keys(ctx.emp).filter(function (k) { return ctx.emp[k].activa; }).map(function (k) { return { nombre: k, serie: ctx.emp[k].serieFact || '' }; }));
      break;
    case 'transporte': {
      PT_sesion_permiso_('armar');
      var c = { id: id, ruc: '', placa: '' }, f = id ? GR_filaDe_(sh, id) : 0;
      if (f) { var r = GR_leerGuias_(sh, f, f)[0].r; c.ruc = String(r.truc || '').replace(/\D/g, ''); c.placa = String(r.placa || '').replace(/[^A-Z0-9]/gi, '').toUpperCase(); }
      t = HtmlService.createTemplateFromFile('GR_TransporteVista'); t.ctxJson = JSON.stringify(c); break;
    }
    case 'direcciones': case 'partida': {
      PT_sesion_permiso_('armar');
      var k = { id: id, ruc: '', nombre: '' }, f2 = id ? GR_filaDe_(sh, id) : 0;
      if (f2) {
        var g = GR_leerGuias_(sh, f2, f2)[0].r;
        k.ruc = String(g.ndest || '').replace(/\D/g, ''); k.nombre = String(g.dest || '');
        if (v === 'partida') { var emp = GR_contexto_(ss).emp[String(g.empresa).trim()] || {}; k.ruc = emp.ruc || ''; k.nombre = String(emp.razon || g.empresa || ''); k.para = 'p'; }
      }
      t = HtmlService.createTemplateFromFile('GR_DireccionesVista'); t.ctxJson = JSON.stringify(k); break;
    }
    default: throw new Error('Ventana desconocida.');
  }
  return t.evaluate().getContent();
}

function PT_sesion_permiso_(necesita) {
  if (!PT_SESION_ || PT_nivel_(PT_SESION_.p) < PT_nivel_(necesita)) throw new Error('Su usuario no tiene permiso para esto (pide «' + necesita + '»).');
}

/* ============================================================ catálogos (🏢 🚛 🚗 👤 📍) */

/** Una pestaña de catálogo: títulos, filas (con su número) y las listas desplegables de cada columna. */
function PT_catalogo_(ss, nombre) {
  var def = GR_CATALOGOS_[nombre];
  if (!def) throw new Error('Catálogo desconocido.');
  var sh = ss.getSheetByName(nombre), n = def.cols.length, ult = sh.getLastRow();
  var filas = ult >= 2 ? sh.getRange(2, 1, ult - 1, n).getDisplayValues().map(function (v, i) { return [i + 2].concat(v); })
    .filter(function (v) { return v.slice(1).some(function (x) { return String(x).trim(); }); }) : [];
  var reglas = sh.getRange(2, 1, 1, n).getDataValidations()[0], listas = [];
  for (var j = 0; j < n; j++) {
    var r = reglas[j], op = null;
    try {
      if (r && r.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) op = r.getCriteriaValues()[0].map(String);
      else if (r && r.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE)
        op = r.getCriteriaValues()[0].getDisplayValues().map(function (x) { return String(x[0]); }).filter(String).slice(0, 2000);
    } catch (e) {}
    listas.push(op);
  }
  return { nombre: nombre, nota: def.nota, cols: def.cols.map(function (c) { return c[0]; }), filas: filas, listas: listas };
}

/** Guarda una fila del catálogo (fila 0 = nueva, al final). Devuelve el catálogo actualizado. */
function PT_guardarCatalogo_(ss, nombre, fila, valores) {
  var def = GR_CATALOGOS_[nombre];
  if (!def) throw new Error('Catálogo desconocido.');
  var sh = ss.getSheetByName(nombre), n = def.cols.length;
  valores = def.cols.map(function (c, j) { return String(valores[j] == null ? '' : valores[j]).trim(); });
  if (!valores[0]) throw new Error('Falta «' + def.cols[0][0] + '».');
  if (nombre === GR_VEH_) valores[0] = GR_placa_(valores[0]);
  var ult = sh.getLastRow(), col1 = ult >= 2 ? sh.getRange(2, 1, ult - 1, 1).getDisplayValues().map(function (v) { return String(v[0]).trim().toUpperCase(); }) : [];
  var repetida = col1.indexOf(valores[0].toUpperCase());
  if (repetida >= 0 && repetida + 2 !== fila && nombre !== GR_DIR_) throw new Error('Ya existe «' + valores[0] + '» (fila ' + (repetida + 2) + '): edite esa.');
  if (fila >= 2) { if (fila > ult) throw new Error('Esa fila ya no existe: vuelva a abrir la lista.'); }
  else { fila = 1; col1.forEach(function (v, i) { if (v) fila = i + 2; }); fila++; }
  sh.getRange(fila, 1, 1, n).setValues([valores]);
  GR_registrar_('', (fila > ult ? '➕ ' : '✏️ ') + nombre, valores.slice(0, 3).join(' · '));
  return PT_catalogo_(ss, nombre);
}

/* ============================================================ menú de la hoja (solo el dueño) */

function GR_menuPortal() {
  GR_guardia_();
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive(), sh = PT_hoja_(ss);
  if (!PT_usuarios_().length) {
    var r = ui.prompt('🌐 Portal web · primer usuario', 'Escriba SU usuario para entrar al portal (ej. ivan). Después ponga su PIN en la columna PIN (se guarda cifrado).', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
    sh.getRange(2, 1, 1, 5).setValues([[r.getResponseText().trim().toLowerCase(), 'Administrador', '', 'admin', true]]);
  }
  // Quien no tenga PIN todavía: se pide aquí mismo (lo escribe la persona; se guarda cifrado 🔒).
  PT_usuarios_().filter(function (x) { return x.activo && !x.pin; }).forEach(function (x) {
    for (var intento = 0; intento < 3; intento++) {
      var r2 = ui.prompt('🔒 PIN para «' + x.u + '»', 'Escriba el PIN con el que «' + x.u + '» entrará al portal (de 4 a 8 números). Se guarda cifrado: anótelo, nadie lo podrá volver a ver.', ui.ButtonSet.OK_CANCEL);
      if (r2.getSelectedButton() !== ui.Button.OK) return;
      var pin = r2.getResponseText().trim();
      if (/^\d{4,8}$/.test(pin)) { sh.getRange(x.fila, 3).setValue(PT_hash_(pin)).setNote('PIN guardado ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm')); return; }
      ui.alert('El PIN debe tener de 4 a 8 números (sin letras ni espacios).');
    }
  });
  sh.activate();
  var url = PT_URL_ ? 'https://script.google.com/macros/s/' + PT_URL_ + '/exec' : '';
  var h = '<div style="font:13px Arial;line-height:1.55">' +
    (url ? '<b>Enlace del portal</b> (cópielo y compártalo solo con quien usted autorice):<br><input style="width:100%;padding:6px;margin:4px 0 10px" readonly onclick="this.select()" value="' + url + '">' +
      '<a href="' + url + '" target="_blank">Abrir el portal ↗</a><br><br>' : '⚠️ El portal todavía no está publicado: se publica solo al desplegar la hoja desde GitHub.<br><br>') +
    '<b>Para entrar</b>: en el portal escriba su <b>Usuario</b> (columna A de 👥 Portal) y el <b>PIN</b> que acaba de poner. Para cambiar un PIN, escriba uno nuevo en la columna PIN.<br><br>' +
    '<b>Usuarios</b> (pestaña 👥 Portal): Usuario · Nombre · <b>PIN</b> (4–8 números; al escribirlo se guarda cifrado 🔒) · <b>Permiso</b> · <b>Activo</b>.<br>' +
    '• <b>ver</b>: mira guías, borrador y factura · <b>armar</b>: además crea y corrige · <b>emitir</b>: además emite · <b>admin</b>: todo.<br>' +
    '• Desmarque <b>Activo</b> para quitar el acceso al instante. En 🧾 Registro queda quién hizo qué (🌐 usuario).<br><br>' +
    'En el celular (Android): abra el enlace en Chrome → menú ⋮ → <b>Agregar a la pantalla principal</b>.</div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(h).setWidth(560).setHeight(380), '🌐 Portal web de guías');
}
