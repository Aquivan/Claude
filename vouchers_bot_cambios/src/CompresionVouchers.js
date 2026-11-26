// ============================================================
// 📦 PDF DE VOUCHERS MUY PESADOS → COMPRIMIR (y partir) CON UN ROBOT DE GITHUB
// ------------------------------------------------------------
// Todo vive en ESTA hoja (Sistema de Vouchers), sin depender de Cobranzas (pedido del usuario, 26/11/2026).
//
// Google Apps Script no puede abrir archivos de más de ~50 MB y esta hoja aparta los de más de CFG.MAX_MB_ARCHIVO.
// Si está ENCENDIDO (🤖 Vouchers → 📦 Comprimir PDF pesados) y hay 🔑 Token de GitHub, al empezar cada procesamiento
// se miran las carpetas de Entrada: un PDF de más de CMPV_MB_ MB se marca «📦 comprimiendo» y se lanza
// vouchers-comprimir.yml con un «lote» (el nombre y el ID del archivo NO van al registro público de GitHub).
// El robot llama aquí (doGet ?canal=gh, solo una corrida de ese workflow que esté corriendo) y pide un permiso
// temporal de Drive (1 h) y el ID; baja el PDF, recorta el fondo de cada voucher, lo deja en ~1600 px, comprime con
// Jpegli (Google) y arma el PDF (partido si pasa de ~38 MB); antes de subir pide mover el original a
// «Procesados/📦 Originales grandes» y sube las partes a Entrada con el mismo nombre.
// NADA de esto puede trabar el proceso normal: si está apagado, falta el token, GitHub no responde o el robot falla,
// la marca dice «📦 no se pudo comprimir» (o no se pone) y el PDF sigue como siempre («archivo grande»).
// Funciones CMPV_.
// ============================================================

var CMPV_MB_ = 45;   // igual a CFG.MAX_MB_ARCHIVO: lo de menos se procesa directo
var CMPV_WF_ = 'vouchers-comprimir.yml';
var CMPV_PROP_ = 'CMPV_L_';
var CMPV_TOKEN_ = 'VCH_GITHUB_TOKEN';
var CMPV_MARCA_ = '📦 comprimiendo';

function CMPV_activo_() { return PropertiesService.getScriptProperties().getProperty('VCH_COMPRIMIR') !== '0'; }

function CMPV_repo_() {
  var p = PropertiesService.getScriptProperties();
  return { repo: p.getProperty('VCH_GITHUB_REPO') || 'Aquivan/Claude', rama: p.getProperty('VCH_GITHUB_RAMA') || 'claude/python-codes-izve18' };
}

function CMPV_gh_(ruta, metodo, carga) {
  var token = PropertiesService.getScriptProperties().getProperty(CMPV_TOKEN_);
  if (!token) throw new Error('falta el 🔑 Token de GitHub (🤖 Vouchers → 📦 Comprimir PDF pesados)');
  var op = { method: metodo || 'get', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } };
  if (carga) { op.contentType = 'application/json'; op.payload = JSON.stringify(carga); }
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + CMPV_repo_().repo + ruta, op), c = r.getResponseCode();
  if (c === 401 || c === 403) throw new Error('GitHub rechazó el token (HTTP ' + c + '): revise que tenga permiso «Actions: Read and write»');
  if (c >= 300) throw new Error('GitHub respondió HTTP ' + c + ': ' + r.getContentText().slice(0, 150));
  return c === 204 || !r.getContentText() ? {} : JSON.parse(r.getContentText());
}

/** Al empezar cada procesamiento: lanza los PDF pesados que lleguen y vence los que se quedaron colgados. Nunca lanza error. */
function CMPV_revisar_() {
  try {
    var p = PropertiesService.getScriptProperties(), todo = p.getProperties(), hechos = [];
    // vencidos (más de 90 min sin terminar): el archivo vuelve al proceso normal
    Object.keys(todo).filter(function (k) { return k.indexOf(CMPV_PROP_) === 0; }).forEach(function (k) {
      var L = {}; try { L = JSON.parse(todo[k]); } catch (e) {}
      if (Date.now() - (L.t || 0) < 90 * 60000) return;
      p.deleteProperty(k);
      try {
        var fv = DriveApp.getFileById(L.id);
        if (L.movido) fv.moveTo(DriveApp.getFolderById(L.entrada));
        fv.setDescription('📦 no se pudo comprimir (el robot no terminó a tiempo)');
      } catch (e) {}
      if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'comprimir PDF · no terminó', '', String(L.nombre || ''));
    });
    if (!CMPV_activo_() || !todo[CMPV_TOKEN_]) return '';
    [CFG.CARPETA_ORIGINALES_ENTRADA_ID, CFG.CARPETA_FOTOS_ENTRADA_ID].forEach(function (idCarp) {
      if (!idCarp) return;
      var it;
      try { it = DriveApp.getFolderById(idCarp).getFiles(); } catch (e) { return; }
      while (it.hasNext()) {
        var f = it.next();
        if (!/pdf/i.test(f.getMimeType()) || f.getSize() < CMPV_MB_ * 1024 * 1024) continue;
        var d = String(f.getDescription() || '');
        if (d.indexOf('📦') === 0) continue;   // ya está en cola o ya se intentó
        var lote = Utilities.getUuid().replace(/-/g, '').slice(0, 16), mb = Math.round(f.getSize() / 1048576);
        p.setProperty(CMPV_PROP_ + lote, JSON.stringify({ id: f.getId(), nombre: f.getName(), entrada: idCarp, mb: mb, t: Date.now() }));
        try {
          f.setDescription(CMPV_MARCA_ + ' (lote ' + lote + ')');
          CMPV_gh_('/actions/workflows/' + CMPV_WF_ + '/dispatches', 'post', { ref: CMPV_repo_().rama, inputs: { lote: lote } });
          hechos.push(f.getName() + ' (' + mb + ' MB)');
        } catch (e) {
          p.deleteProperty(CMPV_PROP_ + lote);
          try { f.setDescription('📦 no se pudo comprimir: ' + String(e.message).slice(0, 150)); } catch (e2) {}
          if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'comprimir PDF · ERROR', '', f.getName() + ' · ' + e.message);
        }
      }
    });
    if (hechos.length && typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'comprimir PDF · enviado al robot', '', hechos.join(', '));
    return hechos.join(', ');
  } catch (e) {
    Logger.log('Comprimir PDF pesados: ' + e.message);
    return '';
  }
}

/** ¿La llamada viene de una corrida de vouchers-comprimir.yml que está corriendo ahora? */
function CMPV_runValido_(run) {
  run = String(run || '').replace(/\D/g, '');
  if (!run) return false;
  var c = CacheService.getScriptCache(), k = 'cmpv_run_' + run;
  if (c.get(k)) return true;
  var r = CMPV_gh_('/actions/runs/' + run);
  var ok = r && r.status !== 'completed' && /(^|\/)vouchers-comprimir\.ya?ml$/.test(String(r.path || ''));
  if (ok) c.put(k, '1', 120);
  return !!ok;
}

/** Carpeta «📦 Originales grandes» dentro de Procesados (Originales o Fotos, según de qué Entrada vino). */
function CMPV_carpetaGrandes_(entrada) {
  var proc = DriveApp.getFolderById(entrada === CFG.CARPETA_FOTOS_ENTRADA_ID ? CFG.CARPETA_FOTOS_PROCESADOS_ID : CFG.CARPETA_ORIGINALES_PROCESADOS_ID);
  var it = proc.getFoldersByName('📦 Originales grandes');
  return it.hasNext() ? it.next() : proc.createFolder('📦 Originales grandes');
}

/** doGet ?canal=gh&run=…&lote=…&accion=cmp_… (Diagnostico.js). Responde JSON. */
function CMPV_web_(q) {
  try {
    if (!CMPV_runValido_(q.run)) return { ok: false, error: 'Forbidden' };
    var p = PropertiesService.getScriptProperties(), lote = String(q.lote || '').replace(/\W/g, ''), k = CMPV_PROP_ + lote;
    var L = JSON.parse(p.getProperty(k) || 'null');
    if (!L) return { ok: false, error: 'lote desconocido o ya terminado' };
    if (q.accion === 'cmp_datos') {
      // 🔑 permiso temporal (1 h) para bajar el PDF y subir las partes (el robot lo enmascara y no lo guarda)
      return { ok: true, token: ScriptApp.getOAuthToken(), id: L.id, nombre: L.nombre, entrada: L.entrada, mb: L.mb };
    }
    if (q.accion === 'cmp_mover') {   // antes de subir: el original sale de Entrada (así no hay dos con el mismo nombre)
      var f = DriveApp.getFileById(L.id);
      f.moveTo(CMPV_carpetaGrandes_(L.entrada));
      f.setDescription('📦 original de un PDF comprimido (' + L.mb + ' MB) · ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'));
      L.movido = true; p.setProperty(k, JSON.stringify(L));
      return { ok: true };
    }
    if (q.accion !== 'cmp_fin') return { ok: false, error: 'accion desconocida' };
    p.deleteProperty(k);
    if (String(q.ok) !== '1') {
      try {
        var f2 = DriveApp.getFileById(L.id);
        if (L.movido) f2.moveTo(DriveApp.getFolderById(L.entrada));   // vuelve a Entrada: sigue el proceso normal
        f2.setDescription('📦 no se pudo comprimir: ' + String(q.error || '').slice(0, 150));
      } catch (e) {}
      if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'comprimir PDF · ERROR', '', L.nombre + ' · ' + String(q.error || '').slice(0, 300));
      return { ok: true };
    }
    if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'comprimir PDF · listo', '', L.nombre + ': ' + L.mb + ' MB → ' + q.mb + ' MB' +
      (Number(q.partes) > 1 ? ' en ' + q.partes + ' partes' : '') + ' · ' + q.paginas + ' pág · ' + (q.recortadas || 0) + ' recortadas · ' + (q.motor || ''));
    try { programarReintentoAutomatico_(); } catch (e) {}   // procesar las partes en ~1 minuto
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 200) };
  }
}

/** Menú: encender / apagar y guardar el token de GitHub. */
function CMPV_menu() {
  var ui = SpreadsheetApp.getUi(), p = PropertiesService.getScriptProperties(), activo = CMPV_activo_(), hayToken = !!p.getProperty(CMPV_TOKEN_);
  var r = ui.prompt('📦 Comprimir PDF pesados',
    'Ahora está ' + (activo ? 'ENCENDIDO' : 'APAGADO') + (hayToken ? '' : ' (pero FALTA el 🔑 token de GitHub: sin él no comprime)') + '.\n\n' +
    'Encendido: un PDF de más de ' + CMPV_MB_ + ' MB que llegue a Entrada (WhatsApp, Drive, 📤 Subir) se manda a un robot de GitHub que lo ' +
    'comprime (recorta el fondo, ~1600 px, Jpegli) y, si hace falta, lo parte; el original queda en «Procesados/📦 Originales grandes». ' +
    'Si el robot falla, el PDF sigue el proceso normal.\n\nEscriba:\n  1 = encender\n  0 = apagar\n  o pegue el 🔑 token de GitHub (el mismo de las otras hojas: permiso «Actions: Read and write»)',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText().trim();
  if (t === '1' || t === '0') {
    p.setProperty('VCH_COMPRIMIR', t);
    ui.alert(t === '1' ? '✅ Encendido.' + (hayToken ? '' : '\n\nFalta el token de GitHub: vuelva a este menú y péguelo.') : '⏸ Apagado.');
    return;
  }
  if (t.length < 20) { ui.alert('No entendí. Escriba 1, 0 o pegue el token.'); return; }
  p.setProperty(CMPV_TOKEN_, t);
  try {
    CMPV_gh_('/actions/workflows/' + CMPV_WF_);
    ui.alert('✅ Token guardado y probado con GitHub.' + (activo ? '' : '\n\nOjo: está APAGADO; escriba 1 en este menú para encenderlo.'));
  } catch (e) {
    ui.alert('⚠️ Token guardado, pero GitHub respondió: ' + e.message);
  }
}
