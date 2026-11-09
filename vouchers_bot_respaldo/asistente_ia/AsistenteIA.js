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

var VIA_URL_ = 'https://script.google.com/macros/s/AKfycby_duhJaZtw6nUyOhuoXU1LRu46J-AV7Q5E-gZuSgEO4Of6hWsSIcEZblYxp5YagDdZ/exec';   // la aplicación web de Cobranzas: la pone el despliegue
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
function VIA_menuIdentificarRuc() {
  var ui = SpreadsheetApp.getUi(), sh = SpreadsheetApp.getActiveSheet(), nombre = sh.getName();
  if (!/^(originales|fotos)$/i.test(nombre)) return ui.alert('🔎 Identificar RUC', 'Seleccione las filas en la pestaña Originales o Fotos.', ui.ButtonSet.OK);
  var filas = [], vistas = {};
  (sh.getActiveRangeList() ? sh.getActiveRangeList().getRanges() : [sh.getActiveRange()]).forEach(function (rg) {
    for (var i = rg.getRow(); i < rg.getRow() + rg.getNumRows() && filas.length < 2000; i++) {
      if (i >= 2 && !vistas[i]) { vistas[i] = 1; filas.push(nombre + '!' + i); }
    }
  });
  if (!filas.length) return ui.alert('🔎 Identificar RUC', 'Seleccione una o varias filas de vouchers (no el encabezado).', ui.ButtonSet.OK);
  SpreadsheetApp.getActiveSpreadsheet().toast('Buscando el RUC de ' + filas.length + ' fila(s)…', '🔎 Identificar RUC', 30);
  var r = VIA_llamar_('rucfilas', { filas: filas });
  if (r.error) return ui.alert(r.error);
  // Ventana (no un aviso que espera): así la ejecución termina y no se corta por el límite de tiempo de Google.
  var datos = JSON.stringify({ filas: filas, texto: r.texto || '', ids: (r.cambios || []).map(function (x) { return x.id; }), faltan: r.faltan || 0 })
    .replace(/</g, '\\u003c');
  var html = HtmlService.createHtmlOutput(VIA_RUC_HTML_.replace('__DATOS__', datos)).setWidth(680).setHeight(580);
  ui.showModalDialog(html, '🔎 Identificar RUC de los proveedores');
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

function VIA_rucEscribir(ids) { try { return VIA_aplicar(ids, false); } catch (e) { return { error: e.message }; } }
function VIA_rucExternos(filas) { try { return VIA_llamar_('rucexternos', { filas: filas }); } catch (e) { return { error: e.message }; } }
function VIA_rucEstado(id) { try { return VIA_llamar_('rucestado', { id: id }); } catch (e) { return { error: e.message }; } }
function VIA_rucOtro(nombre, filas) { try { return VIA_llamar_('rucotro', { nombre: nombre, filas: filas }); } catch (e) { return { error: e.message }; } }
function VIA_rucElegir(prov, filas, ruc, det) { try { return VIA_llamar_('rucelegir', { prov: prov, filas: filas, ruc: ruc, det: det }); } catch (e) { return { error: e.message }; } }

var VIA_RUC_HTML_ = "<!doctype html><html><head><meta charset=\"utf-8\"><style>body{font:13px Arial,sans-serif;margin:0;padding:10px;color:#222}pre{white-space:pre-wrap;background:#f6f8fa;border:1px solid #ddd;border-radius:6px;padding:8px;max-height:250px;overflow:auto;font:12px Arial}button{padding:7px 11px;margin:4px 4px 4px 0;border:0;border-radius:6px;cursor:pointer;background:#1D4ED8;color:#fff}button.g{background:#6b7280}button:disabled{opacity:.5}#msg,.m{margin:6px 0;color:#065f46}.el{border:1px solid #ddd;border-radius:6px;padding:6px;margin:6px 0}select{max-width:100%}input{padding:5px}</style></head><body><pre id=\"txt\"></pre><div id=\"msg\"></div><div id=\"bot\"></div><div id=\"ext\"></div><script>\nvar D=__DATOS__,K=0,DAT={};\nfunction $(i){return document.getElementById(i)}\nfunction msg(t,el){(el||$(\"msg\")).textContent=t}\nfunction esc(t){return String(t==null?\"\":t).replace(/[&<>\"]/g,function(c){return{\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",\"\\\"\":\"&quot;\"}[c]})}\nfunction fin(el){return function(x){msg((x&&(x.mensaje||x.error||x.texto))||\"Listo.\",el)}}\n$(\"txt\").textContent=D.texto;\nvar b=\"\";\nif(D.ids.length)b+=\"<button id=\\\"w\\\" onclick=\\\"escribir()\\\">✍️ Escribir \"+D.ids.length+\" RUC en ID Beneficiario</button>\";\nif(D.faltan)b+=\"<button id=\\\"x\\\" onclick=\\\"externos()\\\">🏛 Buscar los \"+D.faltan+\" que faltan en el padrón SUNAT e internet</button>\";\nb+=\"<button class=\\\"g\\\" onclick=\\\"google.script.host.close()\\\">Cerrar</button>\";\n$(\"bot\").innerHTML=b;\nfunction escribir(){$(\"w\").disabled=true;msg(\"Escribiendo…\");google.script.run.withSuccessHandler(fin()).VIA_rucEscribir(D.ids)}\nfunction externos(){$(\"x\").disabled=true;msg(\"Lanzando la búsqueda…\");\n google.script.run.withSuccessHandler(function(r){r=r||{};msg(r.error||r.texto||\"\");if(r.id)esperar(r.id,0,$(\"ext\"),$(\"msg\"))}).VIA_rucExternos(D.filas)}\nfunction esperar(id,n,cont,m){setTimeout(function(){google.script.run.withSuccessHandler(function(r){r=r||{};\n if(r.error){msg(r.error,m);return}\n if(!r.listo&&n>=120){msg(\"⚠️ La búsqueda tardó más de 30 min. Cierre y vuelva a intentarlo en un rato.\",m);return}\n if(!r.listo){msg((r.etapa||\"⏳ Buscando en el padrón de SUNAT e internet…\")+\" (\"+Math.round((n+1)*15/60*10)/10+\" min) — deje esta ventana abierta\",m);esperar(id,n+1,cont,m);return}\n msg(\"\",m);mostrar(r,cont)}).VIA_rucEstado(id)},15000)}\nfunction mostrar(r,cont){var h=\"<pre>\"+esc(r.texto)+\"</pre>\";\n var cl=r.claros||[];\n if(cl.length){var k=++K;DAT[\"c\"+k]=cl;h+=\"<div class=\\\"el\\\"><b>✅ Encontrados (desmarque si alguno no es):</b>\";\n  cl.forEach(function(x,i){h+=\"<br><label><input type=\\\"checkbox\\\" id=\\\"c\"+k+\"_\"+i+\"\\\" checked> \"+esc(x.prov)+\" → <b>\"+esc(x.ruc)+\"</b> \"+esc(x.nombre)+\" · \"+esc(x.filasTxt||\"\")+\"</label>\"});\n  h+=\"<br><button onclick=\\\"claros(\"+k+\")\\\">✍️ Escribir los marcados</button><div id=\\\"mc\"+k+\"\\\" class=\\\"m\\\"></div></div>\"}\n else if(r.ids&&r.ids.length){var k2=++K;DAT[\"i\"+k2]=r.ids;h+=\"<button onclick=\\\"this.disabled=true;google.script.run.withSuccessHandler(fin($('mi\"+k2+\"'))).VIA_rucEscribir(DAT['i\"+k2+\"'])\\\">✍️ Escribir \"+r.ids.length+\" RUC encontrados</button><div id=\\\"mi\"+k2+\"\\\" class=\\\"m\\\"></div>\"}\n (r.elecciones||[]).forEach(function(el){var k=++K;DAT[\"e\"+k]=el;\n  h+=\"<div class=\\\"el\\\">🤔 <b>\"+esc(el.prov)+\"</b> (\"+esc(el.filasTxt||el.filas.map(function(f){return f.hoja+\"!\"+f.fila}).join(\", \"))+\")<br>\";\n  if(el.opciones.length){h+=\"<select id=\\\"s\"+k+\"\\\">\"+el.opciones.map(function(o,j){return \"<option value=\\\"\"+j+\"\\\">\"+esc(o.ruc+\" \"+o.nombre+\" — \"+o.det)+\"</option>\"}).join(\"\")+\n   \"<option value=\\\"-1\\\">— Ninguno de estos —</option></select> <button onclick=\\\"elegir(\"+k+\")\\\">✅ Es este</button><br>\"}\n  else h+=\"<i>No lo encontré. Escriba el RUC o pruebe con otro nombre:</i><br>\";\n  h+=\"<input id=\\\"t\"+k+\"\\\" placeholder=\\\"RUC (11 dígitos) u otro nombre para buscar\\\" style=\\\"width:60%\\\"> <button onclick=\\\"otro(\"+k+\")\\\">🔎 Usar / buscar</button>\"+\n   \"<div id=\\\"m\"+k+\"\\\" class=\\\"m\\\"></div><div id=\\\"r\"+k+\"\\\"></div></div>\"});\n var d=document.createElement(\"div\");d.innerHTML=h;cont.appendChild(d)}\nfunction claros(k){var cl=DAT[\"c\"+k],sel=cl.filter(function(x,i){return $(\"c\"+k+\"_\"+i).checked}),m=$(\"mc\"+k);\n if(!sel.length){msg(\"No marcó ninguno: no escribí nada.\",m);return}\n var res=[],i=0;msg(\"Escribiendo \"+sel.length+\"…\",m);\n (function sig(){if(i>=sel.length){msg(res.join(\" · \"),m);return}var x=sel[i++];\n  google.script.run.withSuccessHandler(function(y){res.push(x.prov+\": \"+((y&&(y.mensaje||y.error))||\"listo\"));sig()}).VIA_rucElegir(x.prov,x.filas,x.ruc,x.nombre+\" — \"+x.como)})()}\nfunction elegir(k){var el=DAT[\"e\"+k],j=Number($(\"s\"+k).value),m=$(\"m\"+k);\n if(j<0){msg(\"Listo, no escribí nada para \"+el.prov+\". Puede escribir el RUC u otro nombre abajo.\",m);return}\n var o=el.opciones[j];msg(\"Escribiendo \"+o.ruc+\"…\",m);google.script.run.withSuccessHandler(fin(m)).VIA_rucElegir(el.prov,el.filas,o.ruc,o.nombre+\" — \"+o.det)}\nfunction otro(k){var el=DAT[\"e\"+k],v=String($(\"t\"+k).value||\"\").trim(),m=$(\"m\"+k),dg=v.replace(/\\D/g,\"\");\n if(/^\\d{11}$/.test(dg)&&dg.length===v.replace(/[\\s.-]/g,\"\").length){msg(\"Escribiendo \"+dg+\"…\",m);google.script.run.withSuccessHandler(fin(m)).VIA_rucElegir(el.prov,el.filas,dg,\"RUC escrito por la persona\");return}\n if(v.length<3){msg(\"Escriba el RUC (11 dígitos) o un nombre de al menos 3 letras.\",m);return}\n msg(\"Lanzando la búsqueda de «\"+v+\"»…\",m);\n google.script.run.withSuccessHandler(function(r){r=r||{};msg(r.error||r.texto||\"\",m);if(r.id)esperar(r.id,0,$(\"r\"+k),m)}).VIA_rucOtro(v,el.filas)}\n</script></body></html>";

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
