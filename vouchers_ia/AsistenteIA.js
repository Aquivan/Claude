// ============================================================
// 🧠 ASISTENTE IA de la hoja de Vouchers = el MISMO de Cuentas por Cobrar y Pagar (Cobranzas).
// ------------------------------------------------------------
// - El menú se arma solo con los mismos ítems del menú 🧠 Asistente IA de Cobranzas (MenuIA.js, lo genera
//   el despliegue asistente-vouchers.yml cada vez que cambia allá): lo que se mejora en Cobranzas aparece aquí.
// - 💬 Chat, 📰 Resumen y 📋 Analizar vouchers procesados funcionan AQUÍ: el chat es el mismo panel de Cobranzas
//   (ChatPanel.html, copiado al desplegar) y le pide las respuestas a Cobranzas (?canal=vch). Los ✅ escriben en
//   esta hoja de Vouchers igual que desde Cobranzas, y se pueden deshacer.
// - Lo que se trabaja en pestañas de Cobranzas (Auditor, conciliación, importar, claves) abre esa hoja.
// - El asistente ANTERIOR de esta hoja (sugerencias de RUC/factura y su pestaña "🧠 Asistente IA") se retiró:
//   su pestaña y su revisión automática se quitan solas (IA_vueltaAutomatica). Lo que hacía lo hace ahora el
//   chat ("completa los RUC y facturas de los vouchers de hoy") y 📋 Analizar vouchers procesados.
// - No usa el candado (LockService) del bot. Funciones VIA_ (e IA_ solo para el retiro y el menú).
// ============================================================

var VIA_URL_ = '__COBRANZAS_URL__';   // la aplicación web de Cobranzas: la pone el despliegue
var VIA_HOJA_VIEJA_ = '🧠 Asistente IA';

/** Lo llama onOpen() del bot (una línea que agregó el despliegue). */
function IA_agregarMenu_() { VIA_menu_(); }   // MenuIA.js

/* ---------------- conexión con Cobranzas ---------------- */

function VIA_llamar_(accion, cuerpo, token) {
  if (!/^https:\/\/script\.google\.com\//.test(VIA_URL_)) throw new Error('falta la dirección de Cobranzas (vuelva a desplegar el asistente).');
  var r = UrlFetchApp.fetch(VIA_URL_ + '?canal=vch&accion=' + encodeURIComponent(accion) + '&token=' + encodeURIComponent(token || VIA_clave_()), {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo || {}), muteHttpExceptions: true, followRedirects: true });
  var t = r.getContentText();
  try { return JSON.parse(t); } catch (e) {
    console.error('Cobranzas respondió HTTP ' + r.getResponseCode() + ': ' + t.replace(/<[^>]+>/g, ' ').slice(0, 300));
    return { error: '⚠️ Cobranzas no respondió bien (HTTP ' + r.getResponseCode() + '; quizá se estaba actualizando o tardó demasiado). Intente de nuevo en un minuto.' };
  }
}

// Clave entre esta hoja y Cobranzas: se crea y registra sola la primera vez.
function VIA_clave_() {
  var p = PropertiesService.getScriptProperties(), k = p.getProperty('VIA_CLAVE');
  if (k) return k;
  k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var r = VIA_llamar_('registrar', {}, k);
  if (!r || !r.ok) throw new Error('No pude conectar con Cobranzas: ' + ((r && r.error) || 'sin respuesta'));
  p.setProperty('VIA_CLAVE', k);
  return k;
}

/* ---------------- 💬 chat (el panel llama a estas funciones) ---------------- */

function VIA_menuAbrirChat() {
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('asistente_ia/ChatPanel').setTitle('💬 Chat con la IA'));
}

function VIA_enviar(msg) {
  try { return VIA_llamar_('chat', { msg: msg }); } catch (e) { return { error: '❌ ' + e.message }; }
}

function VIA_aplicar(ids, reemplazar) {
  try { return VIA_llamar_('aplicar', { ids: ids || [], reemplazar: !!reemplazar }); } catch (e) { return { error: '❌ ' + e.message }; }
}

function VIA_deshacer() {
  try { return VIA_llamar_('deshacer', {}); } catch (e) { return { error: '❌ ' + e.message }; }
}

/** 📊 Tablas completas: quedan en la pestaña 💬 Resultado IA de Cobranzas. */
function VIA_verResultado() { VIA_abrirCobranzas_('💬 Resultado IA', 'Las tablas completas de la última respuesta están en la pestaña 💬 Resultado IA.'); }

/** Pedido dejado por un menú (📰 Resumen, 📋 procesados): el panel lo envía solo al abrirse. */
function VIA_pendiente() {
  var up = PropertiesService.getUserProperties(), m = up.getProperty('VIA_AUTO') || '';
  if (m) up.deleteProperty('VIA_AUTO');
  return m;
}

function VIA_menuResumen() {
  var r = VIA_llamar_('resumen', {});
  if (r.error) return SpreadsheetApp.getUi().alert(r.error);
  PropertiesService.getUserProperties().setProperty('VIA_AUTO', r.pedido);
  VIA_menuAbrirChat();
}

function VIA_menuProcesados() {
  var ui = SpreadsheetApp.getUi();
  var p = ui.prompt('📋 Analizar vouchers procesados', '¿Qué tanda? Ej.: hoy · hoy sonia · 26-10-26 Sonia(Edit) · 14 de octubre', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var r = VIA_llamar_('procesados', { texto: p.getResponseText() || 'hoy' });
  if (r.error) return ui.alert(r.error);
  PropertiesService.getUserProperties().setProperty('VIA_AUTO', r.pedido);
  VIA_menuAbrirChat();
}

/**
 * 🔎 Identificar RUC de los proveedores de las FILAS SELECCIONADAS (Originales o Fotos): lo mismo que el botón del
 * aviso de Telegram. Cobranzas busca el RUC (alias, SIRE, otros vouchers, honorarios, retenciones) y, con ✅, lo
 * escribe en ID Beneficiario (solo celdas vacías; se deshace con ↩️ Deshacer últimos cambios de la IA).
 */
/** 🔎 La ventana de Identificar RUC: la MISMA de Cobranzas (cobranzas/RucVista.html, copiada al desplegar; RUCV_x → VIA_x). */
function VIA_rucHtml_(datos) { return HtmlService.createHtmlOutputFromFile('asistente_ia/RucVista').getContent().replace('__DATOS__', function () { return datos; }); }

function VIA_menuIdentificarRuc() {
  var ui = SpreadsheetApp.getUi(), sh = SpreadsheetApp.getActiveSheet(), nombre = sh.getName();
  var filas = [], vistas = {};
  if (/^(originales|fotos)$/i.test(nombre)) (sh.getActiveRangeList() ? sh.getActiveRangeList().getRanges() : [sh.getActiveRange()]).forEach(function (rg) {
    for (var i = rg.getRow(); i < rg.getRow() + rg.getNumRows() && filas.length < 2000; i++) {
      if (i >= 2 && !vistas[i]) { vistas[i] = 1; filas.push(nombre + '!' + i); }
    }
  });
  if (!filas.length) {   // sin filas elegidas: la ventana igual se abre, para ver 📂 las búsquedas anteriores
    var vacio = JSON.stringify({ filas: [], texto: '', ids: [], faltan: 0, detalle: [], sinFilas: true });
    return ui.showModalDialog(HtmlService.createHtmlOutput(VIA_rucHtml_(vacio)).setWidth(680).setHeight(580), '🔎 Identificar RUC de los proveedores');
  }
  SpreadsheetApp.getActiveSpreadsheet().toast('Buscando el RUC de ' + filas.length + ' fila(s)…', '🔎 Identificar RUC', 30);
  var r = VIA_llamar_('rucfilas', { filas: filas });
  if (r.error) return ui.alert(r.error);
  // Ventana (no un aviso que espera): así la ejecución termina y no se corta por el límite de tiempo de Google.
  var datos = JSON.stringify({ filas: filas, texto: r.texto || '', ids: (r.cambios || []).map(function (x) { return x.id; }), faltan: r.faltan || 0, detalle: r.detalle || [] })
    .replace(/</g, '\\u003c');
  var html = HtmlService.createHtmlOutput(VIA_rucHtml_(datos)).setWidth(680).setHeight(580);
  ui.showModalDialog(html, '🔎 Identificar RUC de los proveedores');
}

/**
 * 🔁 Cambiar Original ↔ Foto: la fila seleccionada (Originales o Fotos) o, si no hay, lo último que entró. Lo hace Cobranzas
 * (TG_CambiarTipo.js): pendiente → pasa a la otra carpeta de entrada; procesado → vacía sus filas, el archivo vuelve a la
 * entrada de la otra pestaña, se procesa de nuevo y lo escrito a mano se repone solo.
 */
function VIA_menuCambiarTipo() {
  var ui = SpreadsheetApp.getUi(), sh = SpreadsheetApp.getActiveSheet(), nombre = sh.getName(), ped = {};
  var fila = sh.getActiveRange() ? sh.getActiveRange().getRow() : 0;
  if (/^(originales|fotos)$/i.test(nombre) && fila >= 2 && String(sh.getRange(fila, 11).getValue() || '').trim()) {
    ped = { hoja: /^o/i.test(nombre) ? 'Originales' : 'Fotos', fila: fila };
    ped.hacia = ped.hoja === 'Fotos' ? 'Originales' : 'Fotos';
  } else {
    var r = ui.alert('🔁 Cambiar Original ↔ Foto', 'No hay una fila de voucher seleccionada: se usa lo ÚLTIMO que entró.\n\n¿Pasarlo a FOTOS? (No = pasarlo a ORIGINALES)', ui.ButtonSet.YES_NO_CANCEL);
    if (r === ui.Button.CANCEL || r === ui.Button.CLOSE) return;
    ped.hacia = r === ui.Button.YES ? 'Fotos' : 'Originales';
  }
  var pl = VIA_llamar_('cambiartipo', { paso: 'plan', pedido: ped });
  var txt = function (s) { return String(s || '').replace(/<[^>]+>/g, ''); };
  if (!pl || !pl.ok) return ui.alert(txt((pl && (pl.texto || pl.error)) || 'No se pudo.'));
  if (ui.alert('🔁 Cambiar Original ↔ Foto', txt(pl.texto) + '\n\n¿Lo hago?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var quien = ''; try { quien = Session.getActiveUser().getEmail(); } catch (e) {}
  var h = VIA_llamar_('cambiartipo', { paso: 'hacer', plan: pl.plan, quien: 'hoja de Vouchers · ' + quien });
  ui.alert(txt((h && (h.texto || h.error)) || 'Listo.'));
}

/** 🧩 Mesa de conciliación: es una página de Cobranzas (facturas de SIRE + estos vouchers); se abre con un enlace temporal. */
function VIA_menuMesa() {
  var quien = ''; try { quien = Session.getActiveUser().getEmail(); } catch (e) {}
  var r = VIA_llamar_('mesa', { quien: quien });
  if (!r || !r.url) return SpreadsheetApp.getUi().alert((r && r.error) || 'No pude abrir la Mesa de conciliación.');
  var html = '<div style="font:13px Arial;padding:6px">La Mesa muestra las facturas de SIRE (Cuentas por Cobrar y Pagar) a un lado y estos vouchers al otro, para cruzarlos con líneas. ' +
    'Lo que guarde se escribe aquí, en «Tipo y Nº Doc.», «ID Beneficiario» e «ID Usuario».' +
    '<p><a href="' + r.url + '" target="_blank" onclick="setTimeout(function(){google.script.host.close()},300)" style="background:#1D4ED8;color:#fff;padding:9px 14px;border-radius:6px;text-decoration:none">🧩 Abrir la Mesa de conciliación</a></p>' +
    '<p style="color:#64748b;font-size:11px">El enlace vale 6 horas desde el último uso. No lo comparta.</p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(210), '🧩 Mesa de conciliación');
}

/** 🔗 Completar Originales con lo trabajado en Fotos: la misma ventana de Cobranzas (VcoVista.html, copiada al desplegar). */
function VIA_menuVco() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('asistente_ia/VcoVista').setWidth(820).setHeight(620), '🔗 Completar Originales con lo trabajado en Fotos');
}
function VIA_quien_() { try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; } }
function VIA_vcoVer() { var r = VIA_llamar_('vco_ver', {}); if (r.error) throw new Error(r.error); return r; }
function VIA_vcoCopiar(id) { return VIA_llamar_('vco_copiar', { id: id, quien: VIA_quien_() }); }
function VIA_vcoDeshacer() { return VIA_llamar_('vco_deshacer', { quien: VIA_quien_() }); }

/** 🧾 Lectores de vouchers (qué IA lee y en qué orden): la misma ventana de Cobranzas (LectoresVista.html, copiada al desplegar). */
function VIA_menuLectores() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('asistente_ia/LectoresVista').setWidth(640).setHeight(560), '🧾 Lectores de vouchers');
}
function VIA_lectVer() { var r = VIA_llamar_('lect_ver', {}); if (r.error) throw new Error(r.error); return r; }
function VIA_lectGuardar(cfg) { var r = VIA_llamar_('lect_guardar', { cfg: cfg, quien: VIA_quien_() }); if (r.error) throw new Error(r.error); return r; }
function VIA_lectModelos(p) { var r = VIA_llamar_('lect_modelos', { p: p }); if (r.error) throw new Error(r.error); return r; }
/** 🤖 IA de cada tarea (audios, RUC…): la misma ventana de Cobranzas (IATVista.html, copiada al desplegar). */
function VIA_menuIAT() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('asistente_ia/IATVista').setWidth(620).setHeight(520), '🤖 IA de cada tarea');
}
function VIA_iatVer() { var r = VIA_llamar_('iat_ver', {}); if (r.error) throw new Error(r.error); return r; }
function VIA_iatGuardar(cfg) { var r = VIA_llamar_('iat_guardar', { cfg: cfg, quien: VIA_quien_() }); if (r.error) throw new Error(r.error); return r; }
function VIA_iatModelos(t, p) { var r = VIA_llamar_('iat_modelos', { t: t, p: p }); if (r.error) throw new Error(r.error); return r; }
function VIA_lectBuscar() { var r = VIA_llamar_('lect_buscar', {}); if (r.error) throw new Error(r.error); return r; }
function VIA_lectProbar(soloNuevos) { var r = VIA_llamar_('lect_probar', { soloNuevos: !!soloNuevos }); if (r.error) throw new Error(r.error); return r; }

function VIA_rucEscribir(ids) { try { return VIA_aplicar(ids, false); } catch (e) { return { error: e.message }; } }
function VIA_rucExternos(filas, todos) { try { return VIA_llamar_('rucexternos', { filas: filas, todos: !!todos }); } catch (e) { return { error: e.message }; } }
function VIA_rucOpciones(nombre) { try { return VIA_llamar_('rucopciones', { nombre: nombre }); } catch (e) { return { error: e.message }; } }
function VIA_rucAliasBorrar(prov) { try { return VIA_llamar_('rucaliasborrar', { prov: prov }); } catch (e) { return { error: e.message }; } }
/** 🔍 Leer el voucher con IA (la misma lectura de 🔁 Releer con IA, pero NO cambia la fila): para comparar el nombre escrito con el del voucher. */
function VIA_rucLeer(hoja, fila) {
  try {
    if (['Originales', 'Fotos'].indexOf(String(hoja)) === -1) throw new Error('Pestaña no válida.');
    return { id: RP_visorIniciar(String(hoja), Number(fila)) };
  } catch (e) { return { error: e.message }; }
}
/** Resultado de la lectura + RUC posibles para el nombre leído (fuentes propias de Cobranzas). Nunca escribe. */
function VIA_rucLeerEstado(id) {
  try {
    var r = RP_visorEstado(String(id));
    if (!r.listo) return { listo: false };
    if (r.error) return { listo: true, error: r.error };
    var v = (r.leidos || [])[0] || {}, prov = String(v.proveedor || '').trim(), ops = [];
    if (prov.length >= 3) { var o = VIA_llamar_('rucopciones', { nombre: prov }); ops = (o && o.opciones) || []; }
    return { listo: true, proveedor: prov, idv: String(v.idCliente || '').replace(/\D/g, ''), linea: (r.lineas || [])[0] || '', antes: r.antes || '', opciones: ops.slice(0, 8) };
  } catch (e) { return { listo: true, error: e.message }; }
}
/** 📋 Los vouchers SIN RUC de Originales y Fotos, para elegir en la ventana sin saber las filas.
 *  → {filas: [[hoja, fila, aaaammdd, fecha, banco, moneda, monto, proveedor, empresa, procesado aaaammdd, archivo]], ultimoProc} */
function VIA_rucCandidatos() { try { return VIA_llamar_('rucandidatos', {}); } catch (e) { return { error: e.message }; } }   // lo arma Cobranzas (RucVentana.js)

/** Busca el RUC de las filas elegidas en la ventana (lo mismo que abrir 🔎 Identificar RUC con esas filas seleccionadas). */
function VIA_rucFilas(filas) {
  try {
    filas = (filas || []).filter(function (k) { return /^(Originales|Fotos)!\d+$/.test(String(k)); }).slice(0, 300);
    var r = VIA_llamar_('rucfilas', { filas: filas });
    if (r.error) return r;
    return { filas: filas, texto: r.texto || '', ids: (r.cambios || []).map(function (x) { return x.id; }), faltan: r.faltan || 0, detalle: r.detalle || [] };
  } catch (e) { return { error: e.message }; }
}

function VIA_rucUltimas() { try { return VIA_llamar_('rucultimas', {}); } catch (e) { return { error: e.message }; } }
function VIA_rucEstado(id) { try { return VIA_llamar_('rucestado', { id: id }); } catch (e) { return { error: e.message }; } }
function VIA_rucOtro(nombre, filas) { try { return VIA_llamar_('rucotro', { nombre: nombre, filas: filas }); } catch (e) { return { error: e.message }; } }
function VIA_rucElegirVarios(lista) { try { return VIA_llamar_('rucelegirvarios', { lista: lista }); } catch (e) { return { error: e.message }; } }
function VIA_rucElegir(prov, filas, ruc, det, reemplazarAlias) { try { return VIA_llamar_('rucelegir', { prov: prov, filas: filas, ruc: ruc, det: det, reemplazarAlias: !!reemplazarAlias }); } catch (e) { return { error: e.message }; } }


/** Lo que se trabaja en pestañas de Cobranzas: enlace para abrir esa hoja (y decir qué usar allá). */
function VIA_abrirCobranzas_(pestana, nota) {
  var r = {};
  try { r = VIA_llamar_('hoja', { pestana: pestana || '' }); } catch (e) { r = { error: e.message }; }
  if (!r.url) return SpreadsheetApp.getUi().alert(r.error || 'No pude obtener el enlace de Cobranzas.');
  var html = '<div style="font:13px Arial;padding:6px">' + String(nota || '').replace(/</g, '&lt;') +
    '<p><a href="' + r.url + '" target="_blank" style="background:#1D4ED8;color:#fff;padding:8px 12px;border-radius:6px;text-decoration:none">📂 Abrir Cuentas por Cobrar y Pagar</a></p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(170), '🧠 Asistente IA');
}

/* ---------------- retiro del asistente anterior de esta hoja ---------------- */

function VIA_retirar_() {
  var hechos = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (['IA_vueltaAutomatica', 'IA_alEditar'].indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); hechos.push('revisión automática'); }
    });
  } catch (e) { Logger.log('Retiro del asistente: ' + e.message); }
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss && ss.getSheetByName(VIA_HOJA_VIEJA_);
  // Solo la pestaña del asistente anterior (su título dice ASISTENTE IA en A1).
  if (sh && /ASISTENTE IA/i.test(String(sh.getRange('A1').getValue())) && ss.getSheets().length > 1) { ss.deleteSheet(sh); hechos.push('pestaña ' + VIA_HOJA_VIEJA_); }
  return hechos.length ? 'Quitado: ' + hechos.join(', ') + '.' : 'No quedaba nada del asistente anterior.';
}

// El disparador viejo (cada 30 min) todavía llama a esta función: la primera vez limpia todo y no vuelve.
function IA_vueltaAutomatica() { VIA_retirar_(); }
function IA_alEditar() { VIA_retirar_(); }

function VIA_menuRetirar() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('🧹 Quitar el asistente anterior', 'Se borra la pestaña "' + VIA_HOJA_VIEJA_ + '" del asistente anterior y su revisión automática. ' +
    'No toca los vouchers ni las demás pestañas. ¿Seguir?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert(VIA_retirar_());
}
