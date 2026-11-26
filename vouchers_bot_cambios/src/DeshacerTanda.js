// ============================================================
// 🗑 DESHACER UNA TANDA desde la hoja de Vouchers (menú ✨ Vouchers) — pedido del usuario 26/11/2026
// ------------------------------------------------------------
// Una «tanda» = las filas SEGUIDAS de un mismo archivo (columna «Archivo») en Originales o Fotos. Al deshacer:
//   · se borran esas filas (con su imagen);
//   · si no queda otra tanda con ese nombre en esa pestaña, su PDF/foto de Procesados va a la papelera de Drive (30 días);
//   · sus reversos ✍️ («<nombre> · …» y «<nombre> (original con reversos).pdf» en «✍️ Reversos» y sus subcarpetas) también.
// Igual que 🗑 Deshacer una tanda de Cobranzas y de Telegram. Cobranzas se recalcula sola en su próxima vuelta.
// No se hace mientras la hoja está procesando (borrar filas a la mitad desordenaría lo que escribe).
// ============================================================

function VDT_col_(h, nombres) {
  const tit = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
  for (let n = 0; n < nombres.length; n++) { const i = tit.indexOf(nombres[n]); if (i >= 0) return i; }
  return -1;
}

function VDT_tandas_(max) {
  const out = [];
  [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].forEach(function (nom) {
    const h = obtenerHoja(nom);
    if (!h || h.getLastRow() < 2) return;
    const kA = VDT_col_(h, ['archivo', 'archivo original']), kP = VDT_col_(h, ['procesado', 'fecha procesamiento', 'fecha de procesamiento']);
    if (kA < 0) return;
    const v = h.getRange(2, 1, h.getLastRow() - 1, Math.max(kA, kP) + 1).getDisplayValues();
    let cur = null;
    for (let i = 0; i < v.length; i++) {
      const a = String(v[i][kA] || '').trim();
      if (cur && a === cur.archivo) { cur.hasta = i + 2; cur.n++; if (kP >= 0) cur.fin = v[i][kP]; continue; }
      if (cur) out.push(cur);
      cur = a ? { hoja: nom, archivo: a, desde: i + 2, hasta: i + 2, n: 1, fin: kP >= 0 ? v[i][kP] : '' } : null;
    }
    if (cur) out.push(cur);
  });
  const t = function (s) { const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/); return m ? Number(m[3] + ('0' + m[2]).slice(-2) + ('0' + m[1]).slice(-2) + ('0' + m[4]).slice(-2) + m[5] + (m[6] || '00')) : 0; };
  out.sort(function (a, b) { return t(b.fin) - t(a.fin) || b.hasta - a.hasta; });
  return out.slice(0, max || 15);
}

function VDT_lista() { return VDT_tandas_(15); }

function VDT_deshacer(x) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('La hoja de Vouchers está procesando en este momento: espere 1-5 minutos y vuelva a intentar.');
  try {
    const vig = VDT_tandas_(200).filter(function (y) { return y.hoja === x.hoja && y.archivo === x.archivo && y.desde === x.desde && y.n === x.n; })[0];
    if (!vig) throw new Error('Esa tanda cambió (alguien borró o agregó filas). Cierre y vuelva a abrir esta ventana.');
    obtenerHoja(x.hoja).deleteRows(x.desde, x.n);
    const quedan = VDT_tandas_(500).filter(function (y) { return y.hoja === x.hoja && y.archivo === x.archivo; }).length;
    let papelera = 0;
    const proc = x.hoja === CFG.SHEET_FOTOS ? CFG.CARPETA_FOTOS_PROCESADOS_ID : CFG.CARPETA_ORIGINALES_PROCESADOS_ID;
    if (!quedan && proc) {
      try {
        const carpeta = DriveApp.getFolderById(proc);
        const it = carpeta.getFilesByName(x.archivo);
        while (it.hasNext()) { it.next().setTrashed(true); papelera++; }
        const base = String(x.archivo).replace(/\.pdf$/i, ''), fr = carpeta.getFoldersByName(REV_CARPETA_);
        while (fr.hasNext()) {
          const dirR = fr.next(), dirs = [dirR], sub = dirR.getFolders();
          while (sub.hasNext()) dirs.push(sub.next());
          dirs.forEach(function (dir) {
            const fs = dir.getFiles();
            while (fs.hasNext()) {
              const f = fs.next(), nm = f.getName();
              if (nm.indexOf(base + ' · ') === 0 || nm === base + ' (original con reversos).pdf') { f.setTrashed(true); papelera++; }
            }
          });
        }
      } catch (e) { Logger.log('🗑 Archivos: ' + e.message); }
    }
    if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'tanda deshecha', '', x.hoja + ' filas ' + x.desde + '-' + (x.desde + x.n - 1) + ' · ' + x.archivo + ' · ' + papelera + ' archivo(s) a la papelera');
    return {
      texto: '✅ Deshecha: ' + x.n + ' fila(s) de ' + x.hoja + ' (' + x.archivo + ')' +
        (papelera ? ' · ' + papelera + ' archivo(s) a la papelera de Drive (con sus reversos, si tenía)' : quedan ? ' · el archivo se dejó: hay otra tanda con ese nombre' : '') +
        '. Cobranzas se actualiza sola en unos minutos.',
      tandas: VDT_tandas_(15)
    };
  } finally { lock.releaseLock(); }
}

function VDT_menuAbrir() {
  const h = '<div style="font:13px Arial;padding:4px"><p style="margin:0 0 8px;color:#475569">Una <b>tanda</b> = las filas seguidas de un mismo archivo (si un PDF se procesó dos veces, sale dos veces). ' +
    'Al deshacer se borran esas filas con sus imágenes y, si no queda otra tanda con ese nombre, el archivo de Procesados y sus reversos ✍️ van a la papelera de Drive (30 días).</p>' +
    '<div id="l">Cargando…</div><p id="m" style="font-weight:bold"></p></div>' +
    '<script>function e(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}' +
    'var T=[];function pintar(l){T=l;document.getElementById("l").innerHTML=l.length?"<table style=\\"width:100%;border-collapse:collapse\\"><tr style=\\"background:#F1F5F9\\"><th align=left>Archivo</th><th align=left>Pestaña · filas</th><th align=left>Procesada</th><th></th></tr>"+l.map(function(x,i){return "<tr style=\\"border-top:1px solid #E2E8F0\\"><td>"+e(x.archivo)+"</td><td>"+e(x.hoja)+" "+x.desde+"–"+x.hasta+" ("+x.n+")</td><td>"+e(x.fin)+"</td><td><button onclick=\\"des("+i+")\\" style=\\"color:#B91C1C\\">🗑 Deshacer</button></td></tr>";}).join("")+"</table>":"No hay tandas.";}' +
    'function des(i){var x=T[i];if(!confirm("¿Deshacer "+x.archivo+"? Se borran "+x.n+" fila(s) de "+x.hoja+" ("+x.desde+"–"+x.hasta+") con sus imágenes."))return;document.getElementById("m").textContent="Deshaciendo…";' +
    'google.script.run.withSuccessHandler(function(r){document.getElementById("m").textContent=r.texto;pintar(r.tandas);}).withFailureHandler(function(er){document.getElementById("m").textContent="❌ "+(er.message||er);}).VDT_deshacer(x);}' +
    'google.script.run.withSuccessHandler(pintar).withFailureHandler(function(er){document.getElementById("l").textContent="❌ "+(er.message||er);}).VDT_lista();</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(h).setWidth(720).setHeight(480), '🗑 Deshacer una tanda de vouchers');
}
