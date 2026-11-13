/**
 * 🌐 Portal de Vouchers — la página, los usuarios (pestaña 👥 Portal), la sesión y el registro.
 *
 * Usuarios: Usuario · Nombre · PIN · Permiso · Activo · Último ingreso · Notas.
 * El PIN se guarda cifrado (🔒…): si el dueño escribe uno a mano en la hoja (4 a 8 números), el portal lo cifra la
 * próxima vez que lea la pestaña. Así el primer administrador se crea escribiendo su usuario y PIN en la hoja.
 */

/* ============================================================ la página */

function doGet(e) {
  // ?registrar=1 (lo llama el workflow al publicar): deja la dirección de este portal en los metadatos de la hoja de Vouchers,
  // para que el bot de Telegram (Cobranzas) abra el portal como Mini App. No devuelve ningún dato.
  if (e && e.parameter && e.parameter.registrar) {
    try { PV_registrarWeb_(); } catch (x) {}
    return ContentService.createTextOutput('ok');
  }
  try { PV_hojaUsuarios_(); } catch (e2) {}   // la primera vez crea 👥 Portal (con instrucciones)
  return HtmlService.createTemplateFromFile('PV_Vista').evaluate()
    .setTitle('🧾 Vouchers')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ============================================================ usuarios */

var PV_COLS_ = ['Usuario', 'Nombre', 'PIN', 'Permiso', 'Activo', 'Último ingreso', 'Notas'];

function PV_hojaUsuarios_() {
  var ss = PV_ss_(), sh = ss.getSheetByName(PV_HOJA_USU_);
  if (sh) return sh;
  sh = ss.insertSheet(PV_HOJA_USU_, ss.getNumSheets());
  sh.getRange(1, 1, 1, PV_COLS_.length).setValues([PV_COLS_]).setFontWeight('bold').setBackground('#37474f').setFontColor('#fff');
  sh.setFrozenRows(1);
  [110, 180, 130, 90, 60, 140, 320].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('C2:C300').setNumberFormat('@');
  sh.getRange('A1').setNote('Usuario para entrar al 🌐 portal web de Vouchers (sin espacios, ej. ivan).');
  sh.getRange('C1').setNote('Escriba el PIN (4 a 8 números). El portal lo cifra solo (queda 🔒…): nadie lo puede volver a leer. Para cambiarlo, escriba uno nuevo encima o use 👥 Usuarios en el portal.');
  sh.getRange('D1').setNote(PV_PERMISOS_.map(function (p) { return p + ' = ' + PV_PERM_TXT_[p]; }).join('\n'));
  sh.getRange('E1').setNote('Desmarque para quitar el acceso al instante.');
  sh.getRange('D2:D300').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PV_PERMISOS_, true).build());
  sh.getRange('E2:E300').insertCheckboxes();
  sh.getRange('G2').setValue('← Primer administrador: escriba su usuario en A2, su nombre en B2, un PIN de 4 a 8 números en C2, «admin» en D2 y marque E2. Luego entre al portal.');
  return sh;
}

function PV_hash_(pin) {
  var p = PropertiesService.getScriptProperties(), sal = p.getProperty('PV_SAL');
  if (!sal) { sal = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('PV_SAL', sal); }
  return '🔒' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + '|' + String(pin).trim())).slice(0, 32);
}

/** Usuarios de la pestaña. Los PIN escritos a mano se cifran aquí mismo. */
function PV_usuarios_() {
  var sh = PV_hojaUsuarios_(), n = sh.getLastRow();
  if (n < 2) return [];
  var v = sh.getRange(2, 1, n - 1, PV_COLS_.length).getValues();
  return v.map(function (x, i) {
    var pin = String(x[2] == null ? '' : x[2]).trim();
    if (pin && pin.indexOf('🔒') !== 0) {
      if (/^\d{4,8}$/.test(pin)) { pin = PV_hash_(pin); sh.getRange(i + 2, 3).setValue(pin).setNote('PIN guardado (cifrado) ' + PV_hoy_()); }
      else { sh.getRange(i + 2, 3).setValue('').setNote('⚠️ El PIN debe tener de 4 a 8 números. Vuelva a escribirlo.'); pin = ''; }
    }
    var perm = String(x[3] || '').trim().toLowerCase();
    return { fila: i + 2, u: String(x[0]).trim().toLowerCase(), n: String(x[1]).trim(), pin: pin, p: PV_PERMISOS_.indexOf(perm) >= 0 ? perm : 'ver',
      activo: x[4] === true, ult: x[5] instanceof Date ? Utilities.formatDate(x[5], PV_TZ_, 'dd/MM/yyyy HH:mm') : String(x[5] || ''), notas: String(x[6] || '') };
  }).filter(function (x) { return x.u && !/^←/.test(x.u); });
}

function PV_nivel_(p) { return PV_PERMISOS_.indexOf(p); }

/* ============================================================ entrar / sesión */

/** usuario + PIN → {token, nombre, permiso}. 5 intentos fallidos bloquean al usuario 15 minutos. */
function PV_entrar(usuario, pin) {
  var u = String(usuario || '').trim().toLowerCase(), cache = CacheService.getScriptCache(), kf = 'pv_f_' + u.slice(0, 60);
  if (!u || !String(pin || '').trim()) throw new Error('Escriba su usuario y su PIN.');
  var fallos = Number(cache.get(kf) || 0);
  if (fallos >= 5) throw new Error('Demasiados intentos. Espere 15 minutos.');
  var x = PV_usuarios_().filter(function (y) { return y.u === u; })[0];
  Utilities.sleep(400);   // frena a quien pruebe PIN tras PIN
  if (!x || !x.activo || !x.pin || x.pin !== PV_hash_(pin)) {
    cache.put(kf, String(fallos + 1), 900);
    if (!PV_usuarios_().length) throw new Error('Todavía no hay usuarios: el dueño de la hoja de Vouchers debe crear el primero en la pestaña «' + PV_HOJA_USU_ + '».');
    throw new Error('Usuario o PIN incorrecto.');
  }
  cache.remove(kf);
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('pv_s_' + token, JSON.stringify({ u: x.u, n: x.n, p: x.p }), PV_HORAS_ * 3600);
  try { PV_hojaUsuarios_().getRange(x.fila, 6).setValue(new Date()); } catch (e) {}
  PV_registrar_({ u: x.u }, '🔑 Entró al portal', '');
  return { token: token, nombre: x.n || x.u, permiso: x.p, usuario: x.u, puente: !!PV_PUENTE_URL_ };
}

/** Revisa la sesión (y que el usuario siga activo y con permiso suficiente). El permiso vale el de la hoja AHORA. */
function PV_sesion_(token, necesita) {
  var c = CacheService.getScriptCache(), s = token ? c.get('pv_s_' + String(token).slice(0, 80)) : null;
  if (!s) throw new Error('SESION: su sesión terminó. Vuelva a entrar.');
  s = JSON.parse(s);
  var x = PV_usuarios_().filter(function (y) { return y.u === s.u; })[0];
  if (!x || !x.activo) { c.remove('pv_s_' + token); throw new Error('SESION: su acceso fue desactivado.'); }
  s.p = x.p; s.n = x.n;
  if (necesita && PV_nivel_(s.p) < PV_nivel_(necesita)) throw new Error('Su usuario no tiene permiso para esto (pide «' + necesita + '»).');
  return s;
}

/* ============================================================ registro */

function PV_hojaRegistro_() {
  var ss = PV_ss_(), sh = ss.getSheetByName(PV_HOJA_REG_);
  if (sh) return sh;
  sh = ss.insertSheet(PV_HOJA_REG_, ss.getNumSheets());
  sh.getRange(1, 1, 1, 4).setValues([['Fecha', 'Usuario', 'Acción', 'Detalle']]).setFontWeight('bold').setBackground('#37474f').setFontColor('#fff');
  sh.setFrozenRows(1);
  [140, 110, 220, 600].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

/** Anota quién hizo qué (lo más nuevo arriba). Se guardan las últimas 5000 líneas. */
function PV_registrar_(s, accion, detalle) {
  try {
    var sh = PV_hojaRegistro_();
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 4).setValues([[new Date(), '🌐 ' + (s && s.u || ''), String(accion || ''), String(detalle || '').slice(0, 2000)]]);
    sh.getRange(2, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    if (sh.getMaxRows() > 5200) sh.deleteRows(5002, sh.getMaxRows() - 5001);
  } catch (e) { console.warn('Registro del portal: ' + e.message); }
}

function PV_leerRegistro_(n) {
  var sh = PV_hojaRegistro_(), ult = sh.getLastRow();
  if (ult < 2) return [];
  return sh.getRange(2, 1, Math.min(n || 300, ult - 1), 4).getDisplayValues();
}

/* ============================================================ administrar usuarios (desde el portal) */

function PV_listaUsuarios_() {
  return PV_usuarios_().map(function (x) { return { usuario: x.u, nombre: x.n, permiso: x.p, activo: x.activo, conPin: !!x.pin, ultimo: x.ult, notas: x.notas }; });
}

/** Crea o cambia un usuario. d = {usuario, nombre, permiso, activo, pin?, notas?}. */
function PV_guardarUsuario_(s, d) {
  var u = String(d.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(u)) throw new Error('Usuario: de 2 a 30 letras, números, punto, guion (sin espacios ni tildes).');
  var perm = String(d.permiso || 'ver').toLowerCase();
  if (PV_PERMISOS_.indexOf(perm) < 0) throw new Error('Permiso no válido.');
  var pin = String(d.pin || '').trim();
  if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('El PIN debe tener de 4 a 8 números.');
  var sh = PV_hojaUsuarios_(), lista = PV_usuarios_(), x = lista.filter(function (y) { return y.u === u; })[0];
  if (x && x.u === s.u && (perm !== 'admin' || d.activo === false)) throw new Error('No puede quitarse a sí mismo el permiso admin ni desactivarse.');
  if (!x && !pin) throw new Error('Un usuario nuevo necesita su PIN.');
  var fila = x ? x.fila : Math.max(sh.getLastRow() + 1, 2);
  if (!x && String(sh.getRange(2, 7).getValue()).indexOf('← Primer administrador') === 0) sh.getRange(2, 7).setValue('');
  sh.getRange(fila, 1, 1, 2).setValues([[u, String(d.nombre || '').trim()]]);
  sh.getRange(fila, 4).setValue(perm);
  sh.getRange(fila, 5).insertCheckboxes().setValue(d.activo !== false);
  if (d.notas != null) sh.getRange(fila, 7).setValue(String(d.notas).slice(0, 300));
  if (pin) sh.getRange(fila, 3).setNumberFormat('@').setValue(PV_hash_(pin)).setNote('PIN guardado (cifrado) ' + PV_hoy_() + ' por ' + s.u);
  PV_registrar_(s, x ? '✏️ Usuario cambiado' : '➕ Usuario nuevo', u + ' · ' + perm + (d.activo === false ? ' · inactivo' : '') + (pin ? ' · PIN nuevo' : ''));
  return PV_listaUsuarios_();
}

/** La dirección de este portal, en los metadatos de la hoja de Vouchers ('PV_WEB'): la usa el bot de Telegram (botón 🧾 Portal de Vouchers). */
function PV_registrarWeb_() {
  if (!PV_URL_) return;
  var ss = PV_ss_(), m = ss.createDeveloperMetadataFinder().withKey('PV_WEB').find();
  if (m.length && m[0].getValue() === PV_URL_) return;
  m.forEach(function (x) { try { x.remove(); } catch (e) {} });
  ss.addDeveloperMetadata('PV_WEB', PV_URL_, SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT);
}
