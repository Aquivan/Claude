/**
 * 📦 PDF DE VOUCHERS MUY PESADOS → COMPRIMIR (y partir) CON UN ROBOT DE GITHUB — acordado con el usuario el 26/11/2026.
 *
 * Google Apps Script no puede abrir archivos de más de ~50 MB y la hoja de Vouchers aparta los de más de 45 MB. Si está
 * ENCENDIDO (💼 Cobranzas → 📦 Comprimir PDF pesados), en cada actualización (cada 10 min) se miran las carpetas de
 * Entrada de Vouchers: un PDF de más de CMP_MB_ MB se marca «📦 comprimiendo» y se lanza vouchers-comprimir.yml con un
 * «lote» (el nombre y el ID del archivo NO van en el registro público). El robot pide aquí (canal=gh, solo una corrida
 * de ese workflow que esté corriendo) un permiso temporal de Drive (1 h) y el ID; baja el PDF, recorta el fondo de cada
 * voucher, lo deja en ~1600 px, comprime con Jpegli (Google) y arma el PDF (partido si pasa de ~38 MB); antes de subir
 * pide mover el original a «Procesados/📦 Originales grandes» y sube las partes a Entrada con el mismo nombre.
 * NADA de esto puede trabar el proceso normal: si GitHub no responde o falla, la marca dice «📦 no se pudo comprimir» y
 * la hoja de Vouchers sigue como siempre (le avisa «archivo grande»). Lo mismo si se apaga.
 */

var CMP_MB_ = 45;   // igual al límite de la hoja de Vouchers (CFG.MAX_MB_ARCHIVO): lo de menos se procesa directo
var CMP_WF_ = 'vouchers-comprimir.yml';
var CMP_PROP_ = 'CMP_L_';
var CMP_MARCA_ = '📦 comprimiendo';

function CMP_activo_() { return PropertiesService.getScriptProperties().getProperty('CMP_ACTIVO') !== '0'; }

/** Cada actualización: lanza los PDF pesados que lleguen y vence los que se quedaron colgados. */
function CMP_revisar_() {
  if (!CMP_activo_()) return '';
  var ss = TG_ss_(), cfg = TG_cfg_(ss), p = PropertiesService.getScriptProperties(), todo = p.getProperties(), hechos = [];
  // vencidos (más de 90 min sin terminar): el archivo vuelve al proceso normal
  Object.keys(todo).filter(function (k) { return k.indexOf(CMP_PROP_) === 0; }).forEach(function (k) {
    var L = {}; try { L = JSON.parse(todo[k]); } catch (e) {}
    if (Date.now() - (L.t || 0) < 90 * 60000) return;
    p.deleteProperty(k);
    try { DriveApp.getFileById(L.id).setDescription('📦 no se pudo comprimir (el robot no terminó a tiempo)'); } catch (e) {}
    REG_anotar_('Vouchers', 'comprimir PDF · no terminó', '', String(L.nombre || ''));
  });
  [cfg.carpetaOriginales, cfg.carpetaFotos].forEach(function (idCarp) {
    if (!idCarp) return;
    var it;
    try { it = DriveApp.getFolderById(idCarp).getFiles(); } catch (e) { return; }
    while (it.hasNext()) {
      var f = it.next();
      if (!/pdf/i.test(f.getMimeType()) || f.getSize() < CMP_MB_ * 1024 * 1024) continue;
      var d = String(f.getDescription() || '');
      if (d.indexOf('📦') === 0) continue;   // ya está en cola o ya se intentó
      var lote = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
      p.setProperty(CMP_PROP_ + lote, JSON.stringify({ id: f.getId(), nombre: f.getName(), entrada: idCarp, mb: Math.round(f.getSize() / 1048576), t: Date.now() }));
      try {
        f.setDescription(CMP_MARCA_ + ' (lote ' + lote + ')');
        TG_gh_(cfg, '/actions/workflows/' + CMP_WF_ + '/dispatches', 'post', { ref: cfg.rama, inputs: { lote: lote } });
        hechos.push(f.getName() + ' (' + Math.round(f.getSize() / 1048576) + ' MB)');
      } catch (e) {
        p.deleteProperty(CMP_PROP_ + lote);
        try { f.setDescription('📦 no se pudo comprimir: ' + String(e.message).slice(0, 150)); } catch (e2) {}
        REG_anotar_('Vouchers', 'comprimir PDF · ERROR', '', f.getName() + ' · ' + e.message);
      }
    }
  });
  if (hechos.length) REG_anotar_('Vouchers', 'comprimir PDF · enviado al robot', '', hechos.join(', '));
  return hechos.join(', ');
}

/** Carpeta «📦 Originales grandes» dentro de Procesados (Originales o Fotos, según de qué Entrada vino). */
function CMP_carpetaGrandes_(cfg, entrada) {
  var proc = DriveApp.getFolderById(entrada === cfg.carpetaFotos ? CTV_PROC_.Fotos : CTV_PROC_.Originales), it = proc.getFoldersByName('📦 Originales grandes');
  return it.hasNext() ? it.next() : proc.createFolder('📦 Originales grandes');
}

/** doPost ?canal=gh de una corrida de vouchers-comprimir.yml (validada en TG_Captcha.js). */
function CMP_gh_(q) {
  var p = PropertiesService.getScriptProperties(), lote = String(q.lote || '').replace(/\W/g, ''), k = CMP_PROP_ + lote;
  var L = JSON.parse(p.getProperty(k) || 'null');
  if (!L) return { ok: false, error: 'lote desconocido o ya terminado' };
  var cfg = TG_cfg_(TG_ss_());
  if (q.accion === 'cmp_datos') {
    // 🔑 permiso temporal (1 h) para bajar el PDF y subir las partes (el robot lo enmascara y no lo guarda)
    return { ok: true, token: ScriptApp.getOAuthToken(), id: L.id, nombre: L.nombre, entrada: L.entrada, mb: L.mb };
  }
  if (q.accion === 'cmp_mover') {   // antes de subir: el original sale de Entrada (así no hay dos con el mismo nombre)
    var f = DriveApp.getFileById(L.id);
    f.moveTo(CMP_carpetaGrandes_(cfg, L.entrada));
    f.setDescription('📦 original de un PDF comprimido (' + L.mb + ' MB) · ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'));
    L.movido = true; p.setProperty(k, JSON.stringify(L));
    return { ok: true };
  }
  if (q.accion !== 'cmp_fin') return { ok: false, error: 'accion desconocida' };
  p.deleteProperty(k);
  if (!q.ok) {
    try {
      var f2 = DriveApp.getFileById(L.id);
      if (L.movido) f2.moveTo(DriveApp.getFolderById(L.entrada));   // vuelve a Entrada: sigue el proceso normal
      f2.setDescription('📦 no se pudo comprimir: ' + String(q.error || '').slice(0, 150));
    } catch (e) {}
    REG_anotar_('Vouchers', 'comprimir PDF · ERROR', '', L.nombre + ' · ' + String(q.error || '').slice(0, 300));
    return { ok: true };
  }
  REG_anotar_('Vouchers', 'comprimir PDF · listo', '', L.nombre + ': ' + L.mb + ' MB → ' + q.mb + ' MB' + (Number(q.partes) > 1 ? ' en ' + q.partes + ' partes' : '') +
    ' · ' + q.paginas + ' pág · ' + (q.recortadas || 0) + ' recortadas · ' + (q.motor || ''));
  return { ok: true };
}

function menuCmpInterruptor() {
  var ui = SpreadsheetApp.getUi(), activo = CMP_activo_();
  if (ui.alert('📦 Comprimir PDF pesados de vouchers', 'Ahora está ' + (activo ? 'ENCENDIDO' : 'APAGADO') + '.\n\nEncendido: un PDF de más de ' + CMP_MB_ + ' MB que llegue a Entrada (WhatsApp, Drive, 📤 Subir) ' +
    'se manda a un robot de GitHub que lo comprime (recorta el fondo, ~1600 px, Jpegli) y, si hace falta, lo parte; el original queda en «📦 Originales grandes». ' +
    'Si el robot falla, el PDF sigue el proceso normal.\n\n¿' + (activo ? 'Apagarlo' : 'Encenderlo') + '?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('CMP_ACTIVO', activo ? '0' : '1');
  ui.alert(activo ? '⏸ Apagado.' : '✅ Encendido.');
}
