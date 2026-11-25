/**
 * ⏱ ÚLTIMA EJECUCIÓN de la hoja de Vouchers y 🗑 DESHACER UNA TANDA (cualquier PDF o foto, venga de donde venga).
 *
 * /ultima (o «última ejecución», o 📋 Menú → ⏱ Última ejecución): lee el 🩺 Registro técnico y muestra la última vuelta:
 *   cuándo empezó y terminó, si terminó / se pausó por tiempo (sigue sola) / Google la cortó, qué archivo, cuántos
 *   vouchers, qué IA leyó y el ⏱ desglose de tiempos; y las 4 vueltas anteriores.
 * 🗑 Deshacer una tanda (solo administradores): una «tanda» = las filas SEGUIDAS de un mismo archivo en una pestaña
 *   (columna «Archivo Original»). Si el mismo PDF se procesó dos veces, son dos tandas distintas: se borra solo la elegida.
 *   Antes se muestra cuántas filas y cuáles, y se confirma. No se hace si la hoja de Vouchers está procesando en ese
 *   momento (borrar filas a la mitad desordenaría lo que está escribiendo). Las filas se borran con su imagen; el archivo
 *   va a la papelera de Drive (30 días) solo si no queda otra tanda con ese nombre. Luego se recalcula Cobranzas.
 */

var TGX_RX_ = /^\s*\/?(ultima|última)(\s+ejecuci[oó]n)?\s*$|^\s*\/?(deshacer\s+tanda|tandas)\s*$/i;

function TGX_tg_(ctx, texto) {
  if (!TGX_RX_.test(texto || '')) return false;
  if (/tanda/i.test(texto)) TGX_listaTG_(ctx); else TGX_ultimaTG_(ctx);
  return true;
}

/* ------------------------------------------------ ⏱ última ejecución */

function TGX_ultimaTG_(ctx) {
  var filas = TGF_filas_(500).filter(function (r) { return r.s === 'Vouchers' && (/^inicio$/.test(r.e) || /^fin/.test(r.e)); });
  var b = function (t, d, st) { var o = { text: t, callback_data: typeof d === 'string' ? d : 'k:' + TG_guardarBoton_(d, 21600) }; if (st) o.style = st; return o; };
  var nav = [b('🔄 Actualizar', { t: 'tgx', a: 'ultima' }), b('📋 Procesados hoy', 'mc:procesados')];
  var admin = ctx.usuario && ctx.usuario.rol === 'admin';
  var pie = (admin ? [[b('🗑 Deshacer una tanda', { t: 'tgx', a: 'lista' }, 'danger')]] : []).concat([nav, [b('📋 Menú', 'm:', 'link')]]);
  if (!filas.length) return TG_tarjeta_(ctx, '⏱ <b>Última ejecución de Vouchers</b>\n\nNo hay vueltas registradas todavía.', pie);

  // Vueltas: cada «inicio» con el primer «fin» que viene después (filas: lo más nuevo primero)
  var vueltas = [];
  for (var i = filas.length - 1; i >= 0; i--) {
    var r = filas[i];
    if (r.e === 'inicio') vueltas.push({ ini: r, fin: null });
    else if (vueltas.length && !vueltas[vueltas.length - 1].fin) vueltas[vueltas.length - 1].fin = r;
  }
  vueltas.reverse();
  var ahora = Date.now();
  var estado = function (v) {
    if (!v.fin) return (ahora - TGF_fecha_(v.ini.f).getTime() > 7 * 60000) ? '✂️ Google la cortó (no terminó)' : '⏳ procesando ahora';
    return /pausado/.test(v.fin.e) ? '⏸ pausada por tiempo (sigue sola en 1-2 min)' : '✅ terminó';
  };
  var v = vueltas[0], f = v.fin, d = f ? f.d : '';
  var dur = f ? Number((d.match(/DESGLOSE ([\d.]+) s/) || [])[1]) || Math.round((TGF_fecha_(f.f) - TGF_fecha_(v.ini.f)) / 1000) : 0;
  var num = function (rx) { var m = d.match(rx); return m ? m[1] : '?'; };
  var L = ['⏱ <b>Última ejecución de Vouchers</b>', '',
    '🕐 ' + v.ini.f.slice(8, 10) + '/' + v.ini.f.slice(5, 7) + ' ' + v.ini.f.slice(11, 16) + (f ? ' → ' + f.f.slice(11, 16) + ' (' + TGX_mmss_(dur) + ')' : '') + ' · ' + estado(v),
    '📄 ' + TG_esc_(v.ini.d.replace(/^\d+ archivo\(s\) en Entrada \((\w+)\): /, '($1) ').slice(0, 160))];
  if (f) {
    L.push('📊 procesados ' + num(/procesados (\d+)/) + ' · errores ' + num(/errores (\d+)/) + (/último lector (.+?) · guardar/.test(d) ? ' · leyó ' + TG_esc_(d.match(/último lector (.+?) · guardar/)[1].trim()) : ''));
    var des = (d.match(/⏱ DESGLOSE[^\n]*/) || [''])[0];
    if (des) L.push('', '<i>' + TG_esc_(des.replace('⏱ DESGLOSE', '⏱ Desglose')) + '</i>');
    var extra = [];
    if (/Sondeo de Gemini[^\n]*/.test(d)) extra.push(d.match(/🔎 Sondeo de Gemini[^\n]*/) ? d.match(/🔎 Sondeo de Gemini[^\n]*/)[0] : '');
    if (/EN PARALELO/.test(d)) extra.push((d.match(/⚡ \d+ páginas EN PARALELO[^\n]*/) || [''])[0]);
    if (/segundo intento/.test(d)) extra.push('🔁 Gemini respondió en el segundo intento ' + (d.match(/segundo intento/g) || []).length + ' vez/veces');
    if (/Sin tiempo|Limite de tiempo/.test(d)) extra.push('⏸ quedó una parte para la siguiente vuelta');
    extra = extra.filter(Boolean);
    if (extra.length) L.push('', extra.map(function (x) { return '• ' + TG_esc_(x.slice(0, 180)); }).join('\n'));
  }
  if (vueltas.length > 1) {
    L.push('', '<b>Vueltas anteriores</b>');
    vueltas.slice(1, 5).forEach(function (x) {
      var s = x.fin ? Number((x.fin.d.match(/DESGLOSE ([\d.]+) s/) || [])[1]) || Math.round((TGF_fecha_(x.fin.f) - TGF_fecha_(x.ini.f)) / 1000) : 0;
      L.push('• ' + x.ini.f.slice(11, 16) + (s ? ' · ' + TGX_mmss_(s) : '') + ' · ' + estado(x).split(' (')[0] + (x.fin ? ' · ' + (x.fin.d.match(/procesados \d+ · errores \d+/) || [''])[0] : ''));
    });
  }
  return TG_tarjeta_(ctx, L.join('\n'), pie);
}

function TGX_mmss_(s) { s = Math.round(Number(s) || 0); return (s >= 60 ? Math.floor(s / 60) + ' min ' : '') + (s % 60) + ' s'; }

/* ------------------------------------------------ 🗑 tandas */

/** Las tandas (filas seguidas de un mismo archivo) de las pestañas de Vouchers, la más reciente primero. */
function TGX_tandas_(ss, max) {
  var cfg = leerConfig_(ss), libro = SpreadsheetApp.openById(cfg.idVouchers), out = [];
  // Solo las pestañas de vouchers (no los respaldos ocultos ni otras). Títulos nuevos primero («Archivo», «Procesado»):
  // desde el 25/11 la hoja usa títulos cortos y la columna «Archivo Original» que queda a la derecha es una copia suya.
  cfg.pestanasVouchers.forEach(function (nom) {
    var h = libro.getSheetByName(nom);
    if (!h || h.getLastRow() < 2) return;
    var col = indiceColumnas_(h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0]);
    var kA = col('Archivo', 'Archivo Original'), kP = col('Procesado', 'Fecha procesamiento', 'Fecha de procesamiento');
    if (kA < 0) return;
    var v = h.getRange(2, 1, h.getLastRow() - 1, Math.max(kA, kP) + 1).getDisplayValues(), cur = null;
    for (var i = 0; i < v.length; i++) {
      var nom = String(v[i][kA] || '').trim();
      if (cur && nom === cur.archivo) { cur.hasta = i + 2; cur.n++; if (kP >= 0) cur.fin = v[i][kP]; continue; }
      if (cur) out.push(cur);
      cur = nom ? { hoja: h.getName(), archivo: nom, desde: i + 2, hasta: i + 2, n: 1, ini: kP >= 0 ? v[i][kP] : '', fin: kP >= 0 ? v[i][kP] : '' } : null;
    }
    if (cur) out.push(cur);
  });
  var t = function (s) { var m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/); return m ? Number(m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2) + ('0' + m[4]).slice(-2) + m[5] + (m[6] || '00')) : 0; };
  out.sort(function (a, b) { return t(b.fin) - t(a.fin) || b.hasta - a.hasta; });
  return out.slice(0, max || 8);
}

function TGX_listaTG_(ctx, nombres) {
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo un administrador puede deshacer tandas.');
  TG_accion_(ctx.chatId, 'typing');
  var tandas = nombres && nombres.length ? TGX_tandas_(ctx.ss, 200).filter(function (t) { return nombres.indexOf(t.archivo) >= 0; }).slice(0, 10) : TGX_tandas_(ctx.ss, 8);
  var b = function (t, d, st) { var o = { text: t, callback_data: typeof d === 'string' ? d : 'k:' + TG_guardarBoton_(d, 21600) }; if (st) o.style = st; return o; };
  var filas = tandas.map(function (x) {
    return [b('🗑 ' + x.archivo.slice(0, 28) + ' · ' + String(x.fin).slice(0, 16) + ' · ' + x.n + ' fila(s)', { t: 'tgx', a: 'ver', x: x })];
  }).concat([[b('← Última ejecución', { t: 'tgx', a: 'ultima' }, 'link'), b('📋 Menú', 'm:', 'link')]]);
  TG_tarjeta_(ctx, '🗑 <b>Deshacer una tanda</b>\n\nToque la que quiere deshacer (las más recientes primero). Una tanda = las filas seguidas de un mismo archivo; ' +
    'si un PDF se procesó dos veces, aparece dos veces y se borra solo la que elija.\n<i>Antes le muestro qué se va a borrar.</i>', filas);
}

/** ¿La hoja de Vouchers está procesando ahora? (un «inicio» de hace menos de 7 min sin su «fin») */
function TGX_procesando_() {
  var f = TGF_filas_(60).filter(function (r) { return r.s === 'Vouchers' && (r.e === 'inicio' || /^fin/.test(r.e)); });
  return !!(f.length && f[0].e === 'inicio' && Date.now() - TGF_fecha_(f[0].f).getTime() < 7 * 60000);
}

/** La tanda sigue igual que cuando se ofreció (nadie borró o movió filas mientras tanto). */
function TGX_vigente_(ss, x) {
  return TGX_tandas_(ss, 50).filter(function (y) { return y.hoja === x.hoja && y.archivo === x.archivo && y.desde === x.desde && y.n === x.n; })[0] || null;
}

/** Borra las filas de la tanda y, si no queda otra con ese nombre, manda el archivo a la papelera. → {papelera, quedan} */
function TGX_deshacer_(ss, x, quien) {
  var libro = SpreadsheetApp.openById(leerConfig_(ss).idVouchers), h = libro.getSheetByName(x.hoja);
  h.deleteRows(x.desde, x.n);
  // Cada pestaña tiene su carpeta de procesados (Fotos ↔ «Fotos — procesadas», Originales ↔ «Originales — procesados»): se mira
  // SOLO esa. Antes, una tanda con el mismo nombre en la OTRA pestaña dejaba el archivo sin borrar (pasó con «04-11-26 Edit.pdf»).
  var quedan = TGX_tandas_(ss, 200).filter(function (y) { return y.archivo === x.archivo && y.hoja === x.hoja; }).length, papelera = 0;
  var carpeta = /foto/i.test(x.hoja) ? CTV_PROC_.Fotos : /original/i.test(x.hoja) ? CTV_PROC_.Originales : '';
  if (!quedan && carpeta) {
    try { var it = DriveApp.getFolderById(carpeta).getFilesByName(x.archivo); while (it.hasNext()) { it.next().setTrashed(true); papelera++; } } catch (e) {}
    // ✍️ sus reversos (carpeta «✍️ Reversos» dentro de procesados): «<nombre> · reversos.pdf», «<nombre> · pág N (…).pdf»
    // y «<nombre> (original con reversos).pdf»
    try {
      var base = String(x.archivo).replace(/\.pdf$/i, ''), fr = DriveApp.getFolderById(carpeta).getFoldersByName('✍️ Reversos');
      while (fr.hasNext()) {
        var fs = fr.next().getFiles();
        while (fs.hasNext()) {
          var f = fs.next(), n = f.getName();
          if (n.indexOf(base + ' · ') === 0 || n === base + ' (original con reversos).pdf') { f.setTrashed(true); papelera++; }
        }
      }
    } catch (e) {}
  }
  try { actualizarTodo_(true); } catch (e) {}
  console.log('🗑 Tanda deshecha por ' + quien + ': ' + x.hoja + ' filas ' + x.desde + '-' + x.hasta + ' · ' + x.archivo);
  return { papelera: papelera, quedan: quedan };
}

function TGX_alBoton_(ctx, d) {
  if (d.a === 'ultima') return TGX_ultimaTG_(ctx);
  if (!ctx.usuario || ctx.usuario.rol !== 'admin') return TG_enviar_(ctx.chatId, 'Solo un administrador puede deshacer tandas.');
  if (d.a === 'lista') return TGX_listaTG_(ctx, d.nombres);
  var x = d.x || {};
  var b = function (t, dd, st) { var o = { text: t, callback_data: typeof dd === 'string' ? dd : 'k:' + TG_guardarBoton_(dd, 21600) }; if (st) o.style = st; return o; };
  if (d.a === 'ver') {
    var otras = TGX_tandas_(ctx.ss, 200).filter(function (y) { return y.archivo === x.archivo && y.hoja === x.hoja && y.desde !== x.desde; }).length;
    return TG_tarjeta_(ctx, '🗑 <b>¿Deshacer esta tanda?</b>\n\n📄 <b>' + TG_esc_(x.archivo) + '</b>\n• Pestaña ' + TG_esc_(x.hoja) + ', filas ' + x.desde + ' a ' + x.hasta + ' (' + x.n + ' fila(s)), con sus imágenes\n' +
      '• Procesada: ' + TG_esc_(x.ini) + (x.fin !== x.ini ? ' → ' + TG_esc_(x.fin) : '') + '\n' +
      (otras ? '• El archivo NO se borra: hay ' + otras + ' tanda(s) más con ese nombre en ' + TG_esc_(x.hoja) + '.' : '• El archivo de la carpeta de procesados de ' + TG_esc_(x.hoja) + ' (y sus reversos ✍️, si tiene) va a la papelera de Drive (se recupera 30 días).') +
      '\n\n<i>Después se recalcula Cobranzas. Esto no se puede deshacer desde aquí.</i>',
      [[b('🗑 Sí, deshacer', { t: 'tgx', a: 'si', x: x }, 'danger'), b('← No', { t: 'tgx', a: 'lista' }, 'link')]]);
  }
  if (d.a === 'si') {
    if (TGX_procesando_()) return TG_tarjeta_(ctx, '⏳ La hoja de Vouchers está procesando en este momento: espere a que termine (1-5 min) y toque de nuevo.', [[b('🔁 Intentar de nuevo', { t: 'tgx', a: 'si', x: x }, 'danger'), b('← Volver', { t: 'tgx', a: 'lista' }, 'link')]]);
    if (!TGX_vigente_(ctx.ss, x)) return TG_tarjeta_(ctx, '⚠️ Esa tanda cambió (alguien borró o agregó filas). Vuelva a elegirla para ver lo actual.', [[b('🗑 Ver tandas', { t: 'tgx', a: 'lista' })]]);
    var rr = TGX_deshacer_(ctx.ss, x, ctx.nombre || ctx.chatId), papelera = rr.papelera, quedan = rr.quedan;
    return TG_tarjeta_(ctx, '✅ <b>Tanda deshecha</b>\n• ' + x.n + ' fila(s) borradas de ' + TG_esc_(x.hoja) + ' (' + TG_esc_(x.archivo) + ')' +
      (papelera ? '\n• ' + papelera + ' archivo(s) a la papelera de Drive' : quedan ? '\n• El archivo se dejó: hay otra tanda con ese nombre' : ''),
      [[b('🗑 Otra tanda', { t: 'tgx', a: 'lista' }), b('⏱ Última ejecución', { t: 'tgx', a: 'ultima' })], [b('📋 Menú', 'm:', 'link')]]);
  }
}


/* ------------------------------------------------ 🗑 en la hoja: 💼 Cobranzas → 📋 Vouchers procesados → 🗑 Deshacer una tanda */

function TGX_menuAbrir() {
  var h = '<div style="font:13px Arial;padding:4px"><p style="margin:0 0 8px;color:#475569">Una <b>tanda</b> = las filas seguidas de un mismo archivo en la hoja de Vouchers (si un PDF se procesó dos veces, sale dos veces). ' +
    'Al deshacer: se borran esas filas con sus imágenes y, si no queda otra tanda con ese nombre, el archivo va a la papelera de Drive (30 días). Después se recalcula Cobranzas.</p>' +
    '<div id="l">Cargando…</div><p id="m" style="font-weight:bold"></p></div>' +
    '<script>function e(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'var T=[];function pintar(l){T=l;document.getElementById("l").innerHTML=l.length?"<table style=\\"width:100%;border-collapse:collapse\\"><tr style=\\"background:#F1F5F9\\"><th align=left>Archivo</th><th align=left>Pestaña · filas</th><th align=left>Procesada</th><th></th></tr>"+l.map(function(x,i){return "<tr style=\\"border-top:1px solid #E2E8F0\\"><td>"+e(x.archivo)+"</td><td>"+e(x.hoja)+" "+x.desde+"–"+x.hasta+" ("+x.n+")</td><td>"+e(x.fin)+"</td><td><button onclick=\\"des("+i+")\\" style=\\"color:#B91C1C\\">🗑 Deshacer</button></td></tr>";}).join("")+"</table>":"No hay tandas.";}' +
    'function des(i){var x=T[i];if(!confirm("¿Deshacer "+x.archivo+"? Se borran "+x.n+" fila(s) de "+x.hoja+" ("+x.desde+"–"+x.hasta+") con sus imágenes."))return;document.getElementById("m").textContent="Deshaciendo…";' +
    'google.script.run.withSuccessHandler(function(r){document.getElementById("m").textContent=r.texto;pintar(r.tandas);}).withFailureHandler(function(er){document.getElementById("m").textContent="❌ "+(er.message||er);}).TGX_hojaDeshacer(x);}' +
    'google.script.run.withSuccessHandler(pintar).withFailureHandler(function(er){document.getElementById("l").textContent="❌ "+(er.message||er);}).TGX_hojaLista();</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(h).setWidth(720).setHeight(480), '🗑 Deshacer una tanda de vouchers');
}
function TGX_hojaLista() { return TGX_tandas_(ssPrincipal_(), 15); }
function TGX_hojaDeshacer(x) {
  var ss = ssPrincipal_();
  if (TGX_procesando_()) throw new Error('La hoja de Vouchers está procesando en este momento: espere 1-5 minutos y vuelva a intentar.');
  if (!TGX_vigente_(ss, x)) throw new Error('Esa tanda cambió (alguien borró o agregó filas). Cierre y vuelva a abrir esta ventana.');
  var quien = ''; try { quien = Session.getActiveUser().getEmail(); } catch (e) {}
  var r = TGX_deshacer_(ss, x, quien || 'hoja');
  return { texto: '✅ Deshecha: ' + x.n + ' fila(s) de ' + x.hoja + ' (' + x.archivo + ')' + (r.papelera ? ' · archivo a la papelera' : r.quedan ? ' · el archivo se dejó (hay otra tanda con ese nombre)' : ''), tandas: TGX_tandas_(ss, 15) };
}
