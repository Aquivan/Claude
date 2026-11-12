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
  '</style></head><body><div class="bar" id="bar"></div><div id="msg" class="m"></div><div id="lista"></div><div id="ext"></div><details><summary class="s">Resumen de la búsqueda</summary><pre id="txt"></pre></details><script>',
  'var D=__DATOS__,K=0,DAT={};',
  'function $(i){return document.getElementById(i)}function msg(t,el,e){el=el||$("msg");el.textContent=t||"";el.className="m"+(e?" e":"")}',
  'function esc(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}',
  'function fm(n){return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}',
  'function nn(s){return String(s||"").toUpperCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^A-Z0-9]+/g," ").trim()}',
  '$("txt").textContent=D.texto;',
  '/* una tarjeta por NOMBRE (y sugerencia): lo que se elige vale para todos sus vouchers */',
  'var G=[],porK={};D.detalle.filter(function(f){return !f.ruc}).forEach(function(f){var k=nn(f.prov)+"|"+(f.sug||"");if(!f.prov)k="#"+f.k;var g=porK[k];if(!g){g=porK[k]={prov:f.prov,sug:f.sug,sugNombre:f.sugNombre,como:f.como,parecidos:f.parecidos||[],opciones:f.opciones||[],alias:f.alias||"",aliasNombre:f.aliasNombre||"",aliasRaro:!!f.aliasRaro,filas:[]};G.push(g)}g.filas.push(f)});',
  'function filasDe(g){return g.filas.map(function(f){return{hoja:f.hoja,fila:f.fila,col:f.col}})}',
  'function falla(i){return function(e){msg("❌ "+(e&&e.message||e),$("m"+i),1)}}',
  'function pintar(){',
  ' var nSug=G.filter(function(g){return g.sug&&!g.hecho}).length;',
  ' $("bar").innerHTML=(nSug?"<button class=\\"v\\" id=\\"w\\" onclick=\\"escribirMarcados()\\">✍️ Escribir los RUC marcados</button>":"")+',
  '  (G.some(function(g){return !g.hecho})?"<button onclick=\\"internetTodos()\\" title=\\"Busca en el padrón de SUNAT y con IA en internet, también los que ya tienen sugerencia\\">🌐 Buscar con IA en SUNAT e internet ("+G.filter(function(g){return !g.hecho}).length+" nombre(s))</button>":"")+',
  '  "<button class=\\"g\\" onclick=\\"ultimas()\\" title=\\"Vuelve a abrir los resultados de las búsquedas en SUNAT e internet de las últimas 6 horas, aunque haya cerrado la ventana\\">📂 Ver la última búsqueda</button><button class=\\"g\\" onclick=\\"google.script.host.close()\\">Cerrar</button>";',
  ' if(!G.length){$("lista").innerHTML=D.sinFilas?"<div class=\\"s\\">Para buscar RUC: cierre, seleccione las filas en Originales o Fotos y vuelva a abrir 🔎 Identificar RUC. Con 📂 puede ver las búsquedas anteriores.</div>":"<div class=\\"m\\">✅ Todas las filas elegidas ya tienen RUC.</div>";return}',
  ' $("lista").innerHTML=G.map(function(g,i){',
  '  var tot={};g.filas.forEach(function(f){tot[f.moneda]=(tot[f.moneda]||0)+f.monto});',
  '  var h="<div class=\\"card"+(g.hecho?" ok":"")+"\\"><div class=\\"t\\">"+esc(g.prov||"(sin nombre del proveedor)")+" · "+g.filas.length+" voucher(s) · "+Object.keys(tot).map(function(m){return m+" "+fm(tot[m])}).join(" + ")+"</div>";',
  '  h+="<div class=\\"vs\\">"+g.filas.map(function(f){return esc(f.k)+" · "+esc(f.fecha)+" · "+esc(f.moneda)+" "+fm(f.monto)}).join("<br>")+"</div>";',
  '  if(g.hecho)return h+"<div class=\\"m\\">"+esc(g.hecho)+"</div></div>";',
  '  if(g.sug)h+="<div class=\\"sug\\"><label><input type=\\"checkbox\\" id=\\"k"+i+"\\""+(g.aliasRaro&&g.sug===g.alias?"":" checked")+"> 💡 <b>"+esc(g.sug)+"</b> — <b style=\\"color:#1D4ED8\\">"+esc(g.sugNombre||"(nombre no hallado: verifíquelo en SUNAT)")+"</b><br><span class=\\"s\\">"+esc(g.como)+"</span></label> <button class=\\"r\\" onclick=\\"noEs("+i+")\\">❌ No es este</button></div>";',
  '  else if(g.opciones.length)h+="<div class=\\"s\\">❓ Sin RUC claro. Posibles:</div>"+selector(i,g.opciones);',
  '  else if(!g.parecidos.length)h+="<div class=\\"s\\">❓ No lo encontré en los vouchers, SIRE, recibos por honorarios ni retenciones.</div>";',
  '  if(g.alias)h+=(g.aliasRaro?"<div class=\\"sug\\" style=\\"background:#FEF2F2;border-color:#FCA5A5\\">⚠️ <b>Ojo:</b> el alias guardado para este nombre es <b>"+esc(g.alias)+"</b> — <b>"+esc(g.aliasNombre)+"</b>, un nombre muy distinto. Revise el voucher: puede ser correcto (se le pagó en nombre de esa empresa) o un alias equivocado.</div>":"")+"<label class=\\"s\\" style=\\"display:block;margin:4px 0\\"><input type=\\"checkbox\\" id=\\"a"+i+"\\" checked> 🔁 Si elijo otro RUC, actualizar el alias de este nombre (hoy: "+esc(g.alias)+(g.aliasNombre?" "+esc(g.aliasNombre):"")+")</label>";',
  '  if(g.parecidos.length)h+=parec(i,g);',
  '  h+="<div><button class=\\"g\\" onclick=\\"opciones("+i+")\\">📋 Más opciones (SIRE, honorarios, retenciones…)</button>"+(g.prov?" <button onclick=\\"iaNombre("+i+")\\" title=\\"Busca este nombre en el padrón de SUNAT y con IA en internet\\">🌐 Buscar con IA en SUNAT e internet</button>":"")+"</div>";',
  '  h+="<div><input type=\\"text\\" id=\\"q"+i+"\\" placeholder=\\"RUC (11 dígitos) u otro nombre para buscar\\"> <button onclick=\\"otro("+i+")\\">🔎 Usar este RUC / buscar otro nombre con IA</button></div>";',
  '  return h+"<div id=\\"o"+i+"\\"></div><div id=\\"r"+i+"\\"></div><div class=\\"m\\" id=\\"m"+i+"\\"></div></div>"}).join("")}',
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
  'function ultimas(){var c=$("ext");msg("Buscando las búsquedas anteriores…");google.script.run.withFailureHandler(function(e){msg("❌ "+(e&&e.message||e),null,1)}).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,null,1);return}var l=r.lista||[];',
  ' if(!l.length){msg("No hay búsquedas en SUNAT e internet de las últimas 6 horas.");return}msg("");',
  ' var d=document.createElement("div");d.className="card";d.innerHTML="<b>📂 Búsquedas anteriores (últimas 6 horas)</b>"+l.map(function(x){return "<div style=\\"display:flex;gap:6px;align-items:center;border-bottom:1px dashed #E2E8F0;padding:3px 0\\"><span style=\\"flex:1\\">"+esc(x.cuando)+" · "+esc(x.que)+" <span class=\\"s\\">"+(x.listo?"✅ lista · "+x.claros+" encontrado(s), "+x.elecciones+" por elegir":"⏳ todavía buscando")+"</span></span><button style=\\"padding:3px 8px\\" onclick=\\"verBusq(\'"+esc(x.id)+"\',this)\\">Ver</button></div>"}).join("");c.insertBefore(d,c.firstChild);d.scrollIntoView()}).VIA_rucUltimas()}',
  'function verBusq(id,b){b.disabled=true;var c=document.createElement("div"),m=document.createElement("div");m.className="m";c.appendChild(m);b.parentNode.parentNode.appendChild(c);msg("Abriendo…",m);',
  ' google.script.run.withFailureHandler(function(e){msg("❌ "+(e&&e.message||e),m,1)}).withSuccessHandler(function(r){r=r||{};if(r.error){msg(r.error,m,1);return}if(r.listo){msg("",m);mostrar(r,c)}else esperar(id,0,c,m)}).VIA_rucEstado(id)}',
  'pintar();',
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
