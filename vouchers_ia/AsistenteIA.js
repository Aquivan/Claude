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
    return ui.showModalDialog(HtmlService.createHtmlOutput(VIA_RUC_HTML_.replace('__DATOS__', vacio)).setWidth(680).setHeight(580), '🔎 Identificar RUC de los proveedores');
  }
  SpreadsheetApp.getActiveSpreadsheet().toast('Buscando el RUC de ' + filas.length + ' fila(s)…', '🔎 Identificar RUC', 30);
  var r = VIA_llamar_('rucfilas', { filas: filas });
  if (r.error) return ui.alert(r.error);
  // Ventana (no un aviso que espera): así la ejecución termina y no se corta por el límite de tiempo de Google.
  var datos = JSON.stringify({ filas: filas, texto: r.texto || '', ids: (r.cambios || []).map(function (x) { return x.id; }), faltan: r.faltan || 0, detalle: r.detalle || [] })
    .replace(/</g, '\\u003c');
  var html = HtmlService.createHtmlOutput(VIA_RUC_HTML_.replace('__DATOS__', datos)).setWidth(680).setHeight(580);
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
function VIA_rucCandidatos() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), out = [], ultimo = '', tz = ss.getSpreadsheetTimeZone() || 'America/Lima';
    var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); };
    ['Originales', 'Fotos'].forEach(function (nombre) {
      var sh = ss.getSheetByName(nombre);
      if (!sh || sh.getLastRow() < 2) return;
      var nCol = sh.getLastColumn(), tit = sh.getRange(1, 1, 1, nCol).getDisplayValues()[0].map(norm);
      var col = function (re, def) { var i = tit.findIndex(function (t) { return re.test(t); }); return i >= 0 ? i : def; };
      var I = { f: col(/^fecha de dep/, 0), op: col(/^numero de op|^n.? de op/, 1), b: col(/^banco/, 2), mon: col(/^moneda/, 3), m: col(/^monto/, 4),
        p: col(/^proveedor/, 5), emp: col(/^empresa/, -1), idb: col(/^id benef/, -1), proc: col(/^fecha de proc|^procesad/, 11), arch: col(/^archivo original/, 10) };
      if (I.idb < 0) return;
      var n = sh.getLastRow() - 1, v = sh.getRange(2, 1, n, nCol).getValues();
      for (var r = 0; r < n; r++) {
        var x = v[r], pr = x[I.proc] instanceof Date ? Utilities.formatDate(x[I.proc], tz, 'yyyyMMdd') : '';
        if (pr > ultimo) ultimo = pr;
        var prov = String(x[I.p] || '').trim();
        if (!prov || String(x[I.idb] || '').replace(/\D/g, '') || /DUPLICADO/i.test(String(x[I.op] || ''))) continue;
        var f = x[I.f] instanceof Date ? x[I.f] : null;
        out.push([nombre, r + 2, f ? Utilities.formatDate(f, tz, 'yyyyMMdd') : '', f ? Utilities.formatDate(f, tz, 'dd/MM/yyyy') : String(x[I.f] || ''),
          String(x[I.b] || ''), String(x[I.mon] || ''), Number(x[I.m]) || 0, prov, I.emp >= 0 ? String(x[I.emp] || '') : '', pr, String(x[I.arch] || '')]);
      }
    });
    return { filas: out, ultimoProc: ultimo };
  } catch (e) { return { error: e.message }; }
}

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

var VIA_RUC_HTML_ = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  'body{font:13px Arial,sans-serif;margin:0;padding:10px;color:#222}button{padding:6px 10px;margin:3px 4px 3px 0;border:0;border-radius:6px;cursor:pointer;background:#1D4ED8;color:#fff;font-size:12.5px}',
  'button.g{background:#6b7280}button.v{background:#047857}button.r{background:#fff;color:#B91C1C;border:1px solid #FCA5A5}button:disabled{opacity:.5}',
  '.m{margin:4px 0;color:#065f46;font-size:12px}.e{color:#B91C1C}.card{border:1px solid #CBD5E1;border-radius:8px;padding:8px;margin:7px 0}.card.ok{border-color:#86EFAC;background:#F0FDF4}',
  '.t{font-weight:bold}.s{color:#475569;font-size:12px}.sug{background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;padding:5px;margin:5px 0}input[type=text]{padding:5px;width:55%}select{max-width:100%;padding:4px}',
  'details{margin:6px 0}pre{white-space:pre-wrap;background:#f6f8fa;border:1px solid #ddd;border-radius:6px;padding:8px;max-height:200px;overflow:auto;font:11.5px Arial}.bar{position:sticky;top:0;background:#fff;padding:4px 0 6px;border-bottom:1px solid #E2E8F0;z-index:2}',
  '.vs{font-size:11.5px;color:#475569;margin:3px 0 0 6px}',
  '</style></head><body><div class="bar" id="bar"></div><div id="msg" class="m"></div><div id="pk"></div><div id="lista"></div><div id="ext"></div><details><summary class="s">Resumen de la búsqueda</summary><pre id="txt"></pre></details><script>',
  'var D=__DATOS__,K=0,DAT={};',
  'function $(i){return document.getElementById(i)}function msg(t,el,e){el=el||$("msg");el.textContent=t||"";el.className="m"+(e?" e":"")}',
  'function esc(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}',
  'function fm(n){return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}',
  'function nn(s){return String(s||"").toUpperCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^A-Z0-9]+/g," ").trim()}',
  '$("txt").textContent=D.texto;',
  '/* una tarjeta por NOMBRE (y sugerencia): lo que se elige vale para todos sus vouchers */',
  'var G=[],porK={};function armar(){G=[];porK={};D.detalle.filter(function(f){return !f.ruc}).forEach(function(f){var k=nn(f.prov)+"|"+(f.sug||"");if(!f.prov)k="#"+f.k;var g=porK[k];if(!g){g=porK[k]={prov:f.prov,sug:f.sug,sugNombre:f.sugNombre,como:f.como,parecidos:f.parecidos||[],opciones:f.opciones||[],alias:f.alias||"",aliasNombre:f.aliasNombre||"",aliasRaro:!!f.aliasRaro,filas:[]};G.push(g)}g.filas.push(f)});$("txt").textContent=D.texto||""}armar();',
  'function filasDe(g){return g.filas.map(function(f){return{hoja:f.hoja,fila:f.fila,col:f.col}})}',
  'function falla(i){return function(e){msg("❌ "+(e&&e.message||e),$("m"+i),1)}}',
  'function pintar(){',
  ' var nSug=G.filter(function(g){return g.sug&&!g.hecho}).length;',
  ' $("bar").innerHTML=(nSug?"<button class=\\"v\\" id=\\"w\\" onclick=\\"escribirMarcados()\\">✍️ Escribir los RUC marcados</button>":"")+',
  '  (G.some(function(g){return !g.hecho})?"<button onclick=\\"internetTodos()\\" title=\\"Busca en el padrón de SUNAT y con IA en internet, también los que ya tienen sugerencia\\">🌐 Buscar con IA en SUNAT e internet ("+G.filter(function(g){return !g.hecho}).length+" nombre(s))</button>":"")+',
  '  "<button class=\\"g\\" onclick=\\"elegir()\\" title=\\"Los vouchers sin RUC: últimos procesados, 7 o 30 días o todos; por empresa, banco o nombre\\">📋 Elegir vouchers sin RUC</button><button class=\\"g\\" onclick=\\"ultimas()\\" title=\\"Vuelve a abrir los resultados de las búsquedas en SUNAT e internet de las últimas 6 horas, aunque haya cerrado la ventana\\">📂 Ver la última búsqueda</button><button class=\\"g\\" onclick=\\"google.script.host.close()\\">Cerrar</button>";',
  ' if(!G.length){$("lista").innerHTML=D.sinFilas?"":"<div class=\\"m\\">✅ Todas las filas elegidas ya tienen RUC.</div>";return}',
  ' $("lista").innerHTML=G.map(function(g,i){',
  '  var tot={};g.filas.forEach(function(f){tot[f.moneda]=(tot[f.moneda]||0)+f.monto});',
  '  var h="<div class=\\"card"+(g.hecho?" ok":"")+"\\"><div class=\\"t\\">"+esc(g.prov||"(sin nombre del proveedor)")+" · "+g.filas.length+" voucher(s) · "+Object.keys(tot).map(function(m){return m+" "+fm(tot[m])}).join(" + ")+"</div>";',
  '  h+="<div class=\\"vs\\">"+g.filas.map(function(f){return esc(f.k)+" · "+esc(f.fecha)+" · "+esc(f.moneda)+" "+fm(f.monto)}).join("<br>")+"</div>";',
  '  if(g.hecho)return h+"<div class=\\"m\\">"+esc(g.hecho)+"</div></div>";',
  '  if(g.sug)h+="<div class=\\"sug\\"><label><input type=\\"checkbox\\" id=\\"k"+i+"\\""+(g.aliasRaro&&g.sug===g.alias?"":" checked")+"> 💡 <b>"+esc(g.sug)+"</b> — <b style=\\"color:#1D4ED8\\">"+esc(g.sugNombre||"(nombre no hallado: verifíquelo en SUNAT)")+"</b><br><span class=\\"s\\">"+esc(g.como)+"</span></label> <button class=\\"r\\" onclick=\\"noEs("+i+")\\">❌ No es este</button></div>";',
  '  else if(g.opciones.length)h+="<div class=\\"s\\">❓ Sin RUC claro. Posibles:</div>"+selector(i,g.opciones);',
  '  else if(!g.parecidos.length)h+="<div class=\\"s\\">❓ No lo encontré en los vouchers, SIRE, recibos por honorarios ni retenciones.</div>";',
  '  if(g.alias)h+=(g.aliasRaro?"<div class=\\"sug\\" style=\\"background:#FEF2F2;border-color:#FCA5A5\\">⚠️ <b>Ojo:</b> el alias guardado para este nombre es <b>"+esc(g.alias)+"</b> — <b>"+esc(g.aliasNombre)+"</b>, un nombre muy distinto. Revise el voucher: puede ser correcto (se le pagó en nombre de esa empresa) o un alias equivocado.</div>":"")+"<label class=\\"s\\" style=\\"display:block;margin:4px 0\\"><input type=\\"checkbox\\" id=\\"a"+i+"\\" checked> 🔁 Si elijo otro RUC, actualizar el alias de este nombre (hoy: "+esc(g.alias)+(g.aliasNombre?" "+esc(g.aliasNombre):"")+")</label><button class=\\"r\\" style=\\"padding:2px 8px\\" onclick=\\"borrarAlias("+i+")\\" title=\\"Quita el alias de este nombre en Cobranzas → Config: ya no se sugerirá solo\\">🗑 Borrar este alias</button>";',
  '  if(g.parecidos.length)h+=parec(i,g);',
  '  h+="<div><button class=\\"g\\" onclick=\\"opciones("+i+")\\">📋 Más opciones (SIRE, honorarios, retenciones…)</button>"+(g.prov?" <button onclick=\\"iaNombre("+i+")\\" title=\\"Busca este nombre en el padrón de SUNAT y con IA en internet\\">🌐 Buscar con IA en SUNAT e internet</button>":"")+" <button class=\\"g\\" onclick=\\"leer("+i+")\\" title=\\"La IA lee la imagen del voucher (no cambia la fila) y busca el RUC del nombre que trae\\">🔍 Leer el voucher con IA</button></div>";',
  '  h+="<div><input type=\\"text\\" id=\\"q"+i+"\\" placeholder=\\"RUC (11 dígitos) u otro nombre para buscar\\"> <button onclick=\\"otro("+i+")\\">🔎 Usar este RUC / buscar otro nombre con IA</button></div>";',
  '  return h+"<div id=\\"l"+i+"\\"></div><div id=\\"o"+i+"\\"></div><div id=\\"r"+i+"\\"></div><div class=\\"m\\" id=\\"m"+i+"\\"></div></div>"}).join("")}',
  'function parec(i,g){return "<div class=\\"s\\" style=\\"margin-top:5px\\">🔤 <b>Nombres parecidos</b> (compare el nombre y elija):</div>"+g.parecidos.map(function(o,j){return "<div style=\\"display:flex;gap:6px;align-items:center;border-bottom:1px dashed #E2E8F0;padding:3px 0\\"><span style=\\"flex:1\\"><b>"+esc(o.ruc)+"</b> — <b style=\\"color:#1D4ED8\\">"+esc(o.nombre)+"</b> <span class=\\"s\\">"+esc(o.det)+(o.ruc===g.sug?" · ← sugerido":"")+"</span></span><button class=\\"v\\" style=\\"padding:3px 8px\\" onclick=\\"elegirP("+i+","+j+")\\">✅ Este</button></div>"}).join("")}',
  'function selector(i,ops){var k=++K;DAT["s"+k]=ops;return "<select id=\\"s"+k+"\\">"+ops.map(function(o,j){return "<option value=\\""+j+"\\">"+esc(o.ruc+" "+o.nombre+" — "+o.det)+"</option>"}).join("")+"</select> <button class=\\"v\\" onclick=\\"elegir("+i+","+k+")\\">✅ Es este</button>"}',
  'function hecho(i,ruc,nom,y){var g=G[i];g.hecho="✅ "+ruc+" "+(nom||"")+" en "+g.filas.length+" voucher(s) · "+((y&&y.mensaje)||"escrito");g.sug="";pintar()}',
  'function reemp(i){var c=$("a"+i);return !!(c&&c.checked)}',
  'function reempProv(p){var r=false;G.forEach(function(g,i){if(nn(g.prov)===nn(p)&&reemp(i))r=true});return r}',
  'function escribirRuc(i,ruc,nom,det){var g=G[i];msg("Escribiendo "+ruc+" en "+g.filas.length+" voucher(s)…",$("m"+i));',
  ' google.script.run.withFailureHandler(falla(i)).withSuccessHandler(function(y){y=y||{};if(y.error){msg(y.error,$("m"+i),1);return}hecho(i,ruc,nom,y)}).VIA_rucElegir(g.prov,filasDe(g),ruc,det,reemp(i))}',
  'function elegirP(i,j){var o=G[i].parecidos[j];escribirRuc(i,o.ruc,o.nombre,o.nombre+" — "+o.det)}',
  'function elegir(i,k){var o=DAT["s"+k][Number($("s"+k).value)];escribirRuc(i,o.ruc,o.nombre,o.nombre+" — "+o.det)}',
  'function noEs(i){var g=G[i];g.rechazado=g.sug;g.sug="";pintar();msg("Quité la sugerencia "+g.rechazado+". Compare los nombres parecidos o busque otro.",$("m"+i))}',
  'function opciones(i){var g=G[i];if(!g.prov){msg("Sin nombre del proveedor: escriba el RUC o un nombre.",$("m"+i),1);return}',
  ' msg("Buscando más opciones de «"+g.prov+"»… (puede tardar unos segundos)",$("m"+i));',
  ' google.script.run.withFailureHandler(falla(i)).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,$("m"+i),1);return}',
  '  var ya={};g.parecidos.forEach(function(o){ya[o.ruc]=1});var ops=(r.opciones||[]).filter(function(o){return o.ruc!==g.rechazado&&!ya[o.ruc]});',
  '  if(!ops.length){msg(r.texto||"No hay más opciones en las fuentes propias. Pruebe 🔎 buscar con IA (SUNAT e internet).",$("m"+i));return}',
  '  msg("",$("m"+i));$("o"+i).innerHTML="<div class=\\"s\\">Más opciones:</div>"+selector(i,ops)}).VIA_rucOpciones(g.prov)}',
  'function iaNombre(i){var g=G[i],m=$("m"+i);msg("⏳ Busco «"+g.prov+"» en el padrón de SUNAT y con IA en internet (3–5 min). Deje la ventana abierta.",m);',
  ' google.script.run.withFailureHandler(falla(i)).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,m,1);return}if(r.id)esperar(r.id,0,$("r"+i),m);else msg(r.texto||"",m)}).VIA_rucOtro(g.prov,filasDe(g))}',
  'function otro(i){var g=G[i],v=String($("q"+i).value||"").trim(),m=$("m"+i),dg=v.replace(/\\D/g,"");',
  ' if(/^\\d{11}$/.test(dg)&&dg.length===v.replace(/[\\s.-]/g,"").length){escribirRuc(i,dg,"(escrito a mano)","RUC escrito por la persona");return}',
  ' if(v.length<3){msg("Escriba el RUC (11 dígitos) o un nombre de al menos 3 letras.",m,1);return}',
  ' msg("⏳ Busco «"+v+"» en el padrón de SUNAT y con IA en internet (3–5 min). Deje la ventana abierta.",m);',
  ' google.script.run.withFailureHandler(falla(i)).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,m,1);return}if(r.id)esperar(r.id,0,$("r"+i),m);else msg(r.texto||"",m)}).VIA_rucOtro(v,filasDe(g))}',
  'function escribirMarcados(){var ids=[],cuales=[];G.forEach(function(g,i){var c=$("k"+i);if(g.sug&&c&&c.checked){g.filas.forEach(function(f){if(f.id)ids.push(f.id)});cuales.push(g)}});',
  ' if(!ids.length){msg("No hay ninguno marcado.",null,1);return}$("w").disabled=true;msg("Escribiendo "+ids.length+"…");',
  ' google.script.run.withFailureHandler(function(e){msg("❌ "+(e&&e.message||e),null,1)}).withSuccessHandler(function(x){x=x||{};msg(x.mensaje||x.error||"Listo.",null,!!x.error);if(!x.error){cuales.forEach(function(g){g.hecho="✅ "+g.sug+" "+(g.sugNombre||"")+" escrito en "+g.filas.length+" voucher(s)";g.sug=""});pintar()}}).VIA_rucEscribir(ids)}',
  'function internetTodos(){var fs=[];G.forEach(function(g){if(!g.hecho)g.filas.forEach(function(f){fs.push(f.k)})});msg("⏳ Lanzando la búsqueda en el padrón de SUNAT y con IA en internet…");',
  ' google.script.run.withFailureHandler(function(e){msg("❌ "+(e&&e.message||e),null,1)}).withSuccessHandler(function(r){r=r||{};msg(r.error||r.texto||"",null,!!r.error);if(r.id)esperar(r.id,0,$("ext"),$("msg"))}).VIA_rucExternos(fs,true)}',
  'function esperar(id,n,cont,m){setTimeout(function(){google.script.run.withFailureHandler(function(e){msg("❌ "+(e&&e.message||e),m,1)}).withSuccessHandler(function(r){r=r||{};',
  ' if(r.error){msg(r.error,m,1);return}',
  ' if(!r.listo&&n>=120){msg("⚠️ La búsqueda tardó más de 30 min. Cierre y vuelva a intentarlo en un rato.",m,1);return}',
  ' if(!r.listo){msg((r.etapa||"⏳ Buscando en el padrón de SUNAT e internet…")+" ("+Math.round((n+1)*15/60*10)/10+" min) — deje esta ventana abierta",m);esperar(id,n+1,cont,m);return}',
  ' msg("",m);mostrar(r,cont)}).VIA_rucEstado(id)},15000)}',
  'function mostrar(r,cont){var h="<pre>"+esc(r.texto)+"</pre>",cl=r.claros||[];',
  ' if(cl.length){var k=++K;DAT["c"+k]=cl;h+="<div class=\\"card\\"><b>✅ Encontrados (desmarque si alguno no es):</b>";',
  '  cl.forEach(function(x,i){h+="<br><label><input type=\\"checkbox\\" id=\\"c"+k+"_"+i+"\\" checked> "+esc(x.prov)+" → <b>"+esc(x.ruc)+"</b> <b style=\\"color:#1D4ED8\\">"+esc(x.nombre)+"</b> · "+esc(x.filasTxt||"")+"</label>"});',
  '  h+="<br><button class=\\"v\\" onclick=\\"claros("+k+")\\">✍️ Escribir los marcados</button><div id=\\"mc"+k+"\\" class=\\"m\\"></div></div>"}',
  ' else if(r.ids&&r.ids.length){var k2=++K;DAT["i"+k2]=r.ids;h+="<button class=\\"v\\" onclick=\\"this.disabled=true;google.script.run.withSuccessHandler(function(x){msg((x&&(x.mensaje||x.error))||\'Listo.\',$(\'mi"+k2+"\'))}).VIA_rucEscribir(DAT[\'i"+k2+"\'])\\">✍️ Escribir "+r.ids.length+" RUC encontrados</button><div id=\\"mi"+k2+"\\" class=\\"m\\"></div>"}',
  ' (r.elecciones||[]).forEach(function(el){var k=++K;DAT["e"+k]=el;',
  '  h+="<div class=\\"card\\">🤔 <b>"+esc(el.prov)+"</b> ("+esc(el.filasTxt||el.filas.map(function(f){return f.hoja+"!"+f.fila}).join(", "))+")<br>";',
  '  if(el.opciones.length)h+="<select id=\\"es"+k+"\\">"+el.opciones.map(function(o,j){return "<option value=\\""+j+"\\">"+esc(o.ruc+" "+o.nombre+" — "+o.det)+"</option>"}).join("")+"<option value=\\"-1\\">— Ninguno de estos —</option></select> <button class=\\"v\\" onclick=\\"elegirEl("+k+")\\">✅ Es este</button>";',
  '  else h+="<i>No lo encontré. Escriba el RUC o pruebe otro nombre en la tarjeta de ese nombre.</i>";',
  '  h+="<div id=\\"me"+k+"\\" class=\\"m\\"></div></div>"});',
  ' var d=document.createElement("div");d.innerHTML=h;cont.appendChild(d)}',
  'function claros(k){var cl=DAT["c"+k],sel=cl.filter(function(x,i){return $("c"+k+"_"+i).checked}),m=$("mc"+k);',
  ' if(!sel.length){msg("No marcó ninguno: no escribí nada.",m);return}var b=document.querySelector("#mc"+k).previousElementSibling;if(b)b.disabled=true;',
  ' msg("⏳ Escribiendo "+sel.length+" de una vez y recalculando Cobranzas una sola vez (hasta 1–2 min)…",m);',
  ' google.script.run.withFailureHandler(function(e){if(b)b.disabled=false;msg("❌ "+(e&&e.message||e)+" — revise la hoja: lo ya escrito queda; puede volver a intentar.",m,1)}).withSuccessHandler(function(y){y=y||{};msg(y.error?"❌ "+y.error:(y.mensaje||"Listo."),m,!!y.error)})',
  '  .VIA_rucElegirVarios(sel.map(function(x){return{prov:x.prov,filas:x.filas,ruc:x.ruc,det:x.nombre+" — "+x.como,reemplazarAlias:reempProv(x.prov)}}))}',
  'function elegirEl(k){var el=DAT["e"+k],j=Number($("es"+k).value),m=$("me"+k);if(j<0){msg("No escribí nada para "+el.prov+".",m);return}',
  ' var o=el.opciones[j];msg("Escribiendo "+o.ruc+"…",m);google.script.run.withFailureHandler(function(e){msg("❌ "+(e&&e.message||e),m,1)}).withSuccessHandler(function(y){msg((y&&(y.mensaje||y.error))||"Listo.",m)}).VIA_rucElegir(el.prov,el.filas,o.ruc,o.nombre+" — "+o.det,reempProv(el.prov))}',
  'function nucleo(s){return nn(s).replace(/ /g,"").replace(/(EIRL|SAC|SRL|SAA|SCRL|SA)$/,"")}',
  'function nombreDistinto(a,b){var x=nucleo(a),y=nucleo(b);return !(x&&y&&(x.indexOf(y)>=0||y.indexOf(x)>=0))}',
  'function borrarAlias(i){var g=G[i],m=$("m"+i);if(!confirm("¿Borrar el alias de «"+g.prov+"» ("+g.alias+")? Ya no se sugerirá solo."))return;msg("Borrando el alias…",m);',
  ' google.script.run.withFailureHandler(falla(i)).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,m,1);return}var viejo=g.alias;g.alias="";g.aliasRaro=false;if(g.sug===viejo){g.sug="";g.sugNombre=""}g.parecidos=g.parecidos.filter(function(o){return o.ruc!==viejo});pintar();msg(r.mensaje||"Listo.",$("m"+i))}).VIA_rucAliasBorrar(g.prov)}',
  'function leer(i){var g=G[i],f=g.filas[0],m=$("m"+i);msg("🔍 La IA está leyendo el voucher "+f.k+(g.filas.length>1?" (el primero de "+g.filas.length+")":"")+"… (20–60 s)",m);',
  ' google.script.run.withFailureHandler(falla(i)).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,m,1);return}leerEsperar(i,r.id,0)}).VIA_rucLeer(f.hoja,f.fila)}',
  'function leerEsperar(i,id,n){var m=$("m"+i);setTimeout(function(){google.script.run.withFailureHandler(falla(i)).withSuccessHandler(function(r){r=r||{};',
  ' if(!r.listo){if(n>=45){msg("⚠️ La lectura tardó demasiado. Inténtelo de nuevo.",m,1);return}msg("🔍 Leyendo el voucher… ("+((n+1)*4)+" s)",m);leerEsperar(i,id,n+1);return}',
  ' if(r.error){msg("❌ "+r.error,m,1);return}msg("",m);leido(i,r)}).VIA_rucLeerEstado(id)},4000)}',
  'function leido(i,r){var g=G[i],k=++K;DAT["l"+k]=r.opciones||[];var dif=r.proveedor&&nombreDistinto(r.proveedor,g.prov);',
  ' var h="<div class=\\"sug\\" style=\\"background:#EFF6FF;border-color:#BFDBFE\\">📄 <b>La IA leyó en el voucher:</b> beneficiario <b>"+esc(r.proveedor||"(no se lee)")+"</b><br><span class=\\"s\\">"+esc(r.linea)+(r.idv?" · RUC/DNI que aparece en el voucher: "+esc(r.idv)+" (verifique de quién es)":"")+"</span>";',
  ' if(dif)h+="<div class=\\"e\\" style=\\"margin-top:3px\\">⚠️ En la hoja dice «"+esc(g.prov)+"». Si el voucher es de otro, corrija la fila con 🔁 Releer con IA (visor del voucher) o a mano.</div>";',
  ' if(DAT["l"+k].length)h+="<div class=\\"s\\" style=\\"margin-top:4px\\">RUC posibles para «"+esc(r.proveedor)+"»:</div>"+DAT["l"+k].map(function(o,j){return "<div style=\\"display:flex;gap:6px;align-items:center;border-bottom:1px dashed #E2E8F0;padding:3px 0\\"><span style=\\"flex:1\\"><b>"+esc(o.ruc)+"</b> — <b style=\\"color:#1D4ED8\\">"+esc(o.nombre)+"</b> <span class=\\"s\\">"+esc(o.det)+"</span></span><button class=\\"v\\" style=\\"padding:3px 8px\\" onclick=\\"elegirL("+i+","+k+","+j+")\\">✅ Este</button></div>"}).join("");',
  ' else if(r.proveedor)h+="<div class=\\"s\\">No encontré «"+esc(r.proveedor)+"» en vouchers, SIRE, honorarios ni retenciones.</div>";',
  ' if(r.proveedor){DAT["n"+k]=r.proveedor;h+="<button onclick=\\"iaLeido("+i+","+k+")\\">🌐 Buscar «"+esc(r.proveedor)+"» con IA en SUNAT e internet</button>"}',
  ' $("l"+i).innerHTML=h+"</div>"}',
  'function elegirL(i,k,j){var o=DAT["l"+k][j];escribirRuc(i,o.ruc,o.nombre,o.nombre+" — "+o.det+" · leído en el voucher")}',
  'function iaLeido(i,k){var g=G[i],v=DAT["n"+k],m=$("m"+i);msg("⏳ Busco «"+v+"» en el padrón de SUNAT y con IA en internet (3–5 min). Deje la ventana abierta.",m);',
  ' google.script.run.withFailureHandler(falla(i)).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,m,1);return}if(r.id)esperar(r.id,0,$("r"+i),m);else msg(r.texto||"",m)}).VIA_rucOtro(v,filasDe(g))}',
  'function ultimas(){var c=$("ext");msg("Buscando las búsquedas anteriores…");google.script.run.withFailureHandler(function(e){msg("❌ "+(e&&e.message||e),null,1)}).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,null,1);return}var l=r.lista||[];',
  ' if(!l.length){msg("No hay búsquedas en SUNAT e internet de las últimas 6 horas.");return}msg("");',
  ' var d=document.createElement("div");d.className="card";d.innerHTML="<b>📂 Búsquedas anteriores (últimas 6 horas)</b>"+l.map(function(x){return "<div style=\\"display:flex;gap:6px;align-items:center;border-bottom:1px dashed #E2E8F0;padding:3px 0\\"><span style=\\"flex:1\\">"+esc(x.cuando)+" · "+esc(x.que)+" <span class=\\"s\\">"+(x.listo?"✅ lista · "+x.claros+" encontrado(s), "+x.elecciones+" por elegir":"⏳ todavía buscando")+"</span></span><button style=\\"padding:3px 8px\\" onclick=\\"verBusq(\'"+esc(x.id)+"\',this)\\">Ver</button></div>"}).join("");c.insertBefore(d,c.firstChild);d.scrollIntoView()}).VIA_rucUltimas()}',
  'function verBusq(id,b){b.disabled=true;var c=document.createElement("div"),m=document.createElement("div");m.className="m";c.appendChild(m);b.parentNode.parentNode.appendChild(c);msg("Abriendo…",m);',
  ' google.script.run.withFailureHandler(function(e){msg("❌ "+(e&&e.message||e),m,1)}).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,m,1);return}if(r.listo){msg("",m);mostrar(r,c)}else esperar(id,0,c,m)}).VIA_rucEstado(id)}',
  '/* 📋 elegir los vouchers sin RUC sin saber las filas */',
  'var C=null,PM="proc",PF={};',
  'function ymd(n){var d=new Date();d.setDate(d.getDate()-n);return d.getFullYear()+("0"+(d.getMonth()+1)).slice(-2)+("0"+d.getDate()).slice(-2)}',
  'function elegir(){$("pk").innerHTML="<div class=\\"card\\">⏳ Buscando los vouchers sin RUC…</div>";google.script.run.withFailureHandler(function(e){$("pk").innerHTML="<div class=\\"card e\\">❌ "+esc(e&&e.message||e)+"</div>"}).withSuccessHandler(function(r){r=r||{};if(r.error){$("pk").innerHTML="<div class=\\"card e\\">❌ "+esc(r.error)+"</div>";return}C=r;PF={};',
  ' var em={},bc={};C.filas.forEach(function(x){if(x[8])em[x[8]]=1;var r=resp(x[10]);if(r)bc[r]=1});',
  ' var op=function(o,t){return "<option value=\\"\\">"+t+"</option>"+Object.keys(o).sort().map(function(k){return "<option>"+esc(k)+"</option>"}).join("")};',
  ' $("pk").innerHTML="<div class=\\"card\\" style=\\"border-color:#93C5FD\\"><b>📋 Vouchers sin RUC</b> <span class=\\"s\\">(elija cuáles revisar; no hace falta saber las filas)</span><div id=\\"pkR\\" style=\\"margin:6px 0\\"></div>"+',
  '  "<select id=\\"pkE\\" onchange=\\"pkPintar()\\">"+op(em,"Todas las empresas")+"</select> <select id=\\"pkB\\" onchange=\\"pkPintar()\\" title=\\"Quién trajo el voucher (del nombre del archivo de la tanda)\\">"+op(bc,"Todos los responsables")+"</select> <select id=\\"pkM\\" onchange=\\"pkPintar()\\"><option value=\\"\\">S/ y US$</option><option value=\\"PEN\\">Solo S/</option><option value=\\"USD\\">Solo US$</option></select> "+',
  '  "<input type=\\"text\\" id=\\"pkQ\\" placeholder=\\"Nombre del proveedor…\\" oninput=\\"pkPintar()\\" style=\\"width:40%\\"><div id=\\"pkBar\\" style=\\"margin-top:6px\\"></div><div id=\\"pkL\\" style=\\"max-height:260px;overflow:auto;border-top:1px solid #E2E8F0;margin-top:4px\\"></div></div>";pkPintar()}).VIA_rucCandidatos()}',
  'function resp(a){a=String(a||"").replace(/\\.(pdf|jpe?g|png|heic|webp)$/i,"").replace(/^\\s*\\d{1,2}[-\\/.]\\d{1,2}[-\\/.]\\d{2,4}\\s*/,"");a=a.replace(/[()\\[\\]_.,-]+/g," ").replace(/\\b(edit(ado)?|vouchers?|scan(eo)?|img|image|imagen|foto|fotos|copia|whatsapp|wa|documento|doc|pdf|pagina|p[aá]g)\\b/gi," ").replace(/\\b\\d+\\b/g," ").replace(/\\s+/g," ").trim();return a?a.split(" ").map(function(w){return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()}).join(" "):""}',
  'function usd(m){return /USD|US\$|DOLAR/i.test(String(m))}',
  'function pkBase(){var e=$("pkE").value,b=$("pkB").value,m=$("pkM").value,q=nn($("pkQ").value),pl=q?q.split(" "):[];return C.filas.filter(function(x){if(e&&x[8]!==e)return false;if(b&&resp(x[10])!==b)return false;if(m&&(m==="USD")!==usd(x[5]))return false;var n=nn(x[7]);for(var i=0;i<pl.length;i++)if(n.indexOf(pl[i])<0)return false;return true})}',
  'function pkModos(){var d=C.ultimoProc||"",d7=ymd(7),d30=ymd(30);return[{k:"proc",t:"📥 Últimos procesados"+(d?" ("+d.slice(6,8)+"/"+d.slice(4,6)+")":""),f:function(x){return d&&x[9]===d}},{k:"d7",t:"📅 Últimos 7 días",f:function(x){return x[2]&&x[2]>=d7}},{k:"d30",t:"📅 Últimos 30 días",f:function(x){return x[2]&&x[2]>=d30}},{k:"todos",t:"📋 Todos los que faltan",f:function(){return true}}]}',
  'function pkPintar(){var base=pkBase(),ms=pkModos(),m=ms.filter(function(x){return x.k===PM})[0]||ms[0];',
  ' $("pkR").innerHTML=ms.map(function(x){return "<button class=\\""+(x.k===m.k?"":"g")+"\\" onclick=\\"PM=\x27"+x.k+"\x27;PF={};pkPintar()\\">"+esc(x.t)+" <b>("+base.filter(x.f).length+")</b></button>"}).join("");',
  ' var vis=base.filter(m.f).sort(function(a,b){return String(b[2]).localeCompare(String(a[2]))||b[1]-a[1]});',
  ' if(!vis.length){$("pkBar").innerHTML="";$("pkL").innerHTML="<div class=\\"m\\">✅ No hay vouchers sin RUC con esos filtros.</div>";return}',
  ' $("pkL").innerHTML=vis.slice(0,300).map(function(x){var k=x[0]+"!"+x[1];return "<label style=\\"display:block;padding:4px 0;border-bottom:1px solid #F1F5F9\\"><input type=\\"checkbox\\" data-k=\\""+esc(k)+"\\""+(PF[k]?"":" checked")+" onchange=\\"PF[this.dataset.k]=!this.checked;pkCuenta()\\"> <b>"+esc(x[7])+"</b> <span class=\\"s\\">"+esc(x[3])+" · "+esc(x[5])+" "+fm(x[6])+(x[8]?" · "+esc(x[8]):"")+(resp(x[10])?" · 👤 "+esc(resp(x[10])):"")+" · "+esc(k)+"</span></label>"}).join("")+(vis.length>300?"<div class=\\"s\\">… y "+(vis.length-300)+" más (use los filtros).</div>":"");',
  ' pkCuenta()}',
  'function pkMarcados(){return Array.prototype.slice.call(document.querySelectorAll("#pkL input:checked")).map(function(c){return c.dataset.k})}',
  'function pkCuenta(){var k=pkMarcados().length;$("pkBar").innerHTML="<button class=\\"g\\" onclick=\\"pkTodos(true)\\">☑ Todos</button><button class=\\"g\\" onclick=\\"pkTodos(false)\\">☐ Ninguno</button><button class=\\"v\\" onclick=\\"pkBuscar()\\""+(k?"":" disabled")+">🔎 Buscar RUC de los marcados ("+k+")</button>"+(k>150?" <span class=\\"s\\">Se buscan de 150 en 150, los más nuevos primero.</span>":"")}',
  'function pkTodos(s){document.querySelectorAll("#pkL input").forEach(function(c){c.checked=s;PF[c.dataset.k]=!s});pkCuenta()}',
  'function pkBuscar(){var fs=pkMarcados().slice(0,150);if(!fs.length)return;$("pkBar").innerHTML="⏳ Buscando el RUC de "+fs.length+" voucher(s)… (puede tardar un minuto)";',
  ' google.script.run.withFailureHandler(function(e){$("pkBar").innerHTML="<span class=\\"e\\">❌ "+esc(e&&e.message||e)+"</span>"}).withSuccessHandler(function(r){r=r||{};if(r.error){$("pkBar").innerHTML="<span class=\\"e\\">❌ "+esc(r.error)+"</span>";return}D=r;armar();$("pk").innerHTML="";$("ext").innerHTML="";msg("");pintar()}).VIA_rucFilas(fs)}',
  'pintar();',
  'if(D.sinFilas||!G.length)elegir();',
  '</script></body></html>'
].join('\n');

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
