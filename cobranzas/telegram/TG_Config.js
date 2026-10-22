/**
 * 🤖 ASISTENTE DE TELEGRAM — configuración, personas autorizadas y menú.
 *
 * El bot vive dentro de esta hoja (Cuentas por Cobrar y Pagar) porque aquí ya
 * están la IA analista, los vouchers, SIRE, retenciones y detracciones; además
 * lee las hojas de Notificaciones, Honorarios y las Liquidaciones SIRE, y
 * consulta/lanza las descargas de GitHub. Todo el código del bot está en la
 * carpeta telegram/ y sus funciones empiezan con TG_ (no se mezcla con el resto).
 *
 * Claves (token del bot, token de GitHub, secreto del webhook): SOLO en las
 * Propiedades del script, nunca en celdas ni en el código.
 */

var TG_HOJA_ = '🤖 Telegram';
var TG_HOJA_REC_ = '_TG_Recordatorios';
var TG_HOJA_VISTOS_ = '_TG_Vistos';
var TG_HOJA_LOG_ = '_TG_Registro';

var TG_PROP_ = {
  TOKEN: 'TG_BOT_TOKEN', SECRETO: 'TG_WEBHOOK_SECRETO', GITHUB: 'TG_GITHUB_TOKEN', SS: 'TG_SS_ID',
  CODIGO: 'TG_CODIGO_VINCULO', BOT: 'TG_BOT_USUARIO', URL: 'TG_WEBAPP_URL',
};

// [clave, nombre en la hoja, valor por defecto, nota]
var TG_PARAMETROS_ = [
  ['repo', 'Repositorio de GitHub', 'Aquivan/Claude', 'Dueño/nombre del repositorio donde corren las descargas de SUNAT.'],
  ['rama', 'Rama de GitHub', 'claude/python-codes-izve18', 'Rama donde se lanzan las descargas.'],
  ['idNotificaciones', 'ID Sheet de Notificaciones', '1gV56deyMd-11O_fpB7cBVKKoUu0nF9lyvHMGlIKbNOs', 'Hoja "Notificaciones · Grupo" (Buzón Electrónico SUNAT).'],
  ['idHonorarios', 'ID Sheet de Honorarios', '1-dJiKLIFfcVt5htxp7sewCMfy1ne9WUzD1PWKYuc_wk', 'Hoja "Honorarios · Grupo" (recibos por honorarios recibidos).'],
  ['carpetaOriginales', 'Carpeta de vouchers originales (entrada)', '1GqjydN2oOYhwDvxPmZtr9TEJgjP65i2g', 'Carpeta "Nuevos" del Sistema de Vouchers para PDF/originales (📥 Registrar como voucher).'],
  ['carpetaFotos', 'Carpeta de vouchers fotos (entrada)', '12si83gUAbe5kqbFopbMrFkdD3EvBsA72', 'Carpeta "Nuevos" del Sistema de Vouchers para fotos.'],
  ['avisos', 'Avisos automáticos', 'SI', 'SI = revisa cada hora y avisa lo nuevo (cada persona elige sus avisos con /avisos). NO = no avisa.'],
  ['horaResumen', 'Hora del resumen diario', '8', 'Hora de Lima (0–23) del ☀️ resumen de la mañana. Vacío = sin resumen.'],
  ['diasVence', 'Avisar facturas que vencen en (días)', '3', 'Facturas por cobrar/pagar que vencen dentro de estos días (se avisa una vez al día).'],
  ['modelo', 'Modelo de IA del chat', '', 'Vacío = el mismo de 🤝 Conciliar con IA (proveedor y clave de esa pestaña).'],
];

// Avisos que cada persona puede activar o desactivar (/avisos).
var TG_AVISOS_ = [
  ['notif', '📬 Notificaciones y mensajes SUNAT nuevos (y proveedores en la lista SSCO)'],
  ['det', '🏦 Detracciones nuevas'],
  ['ret', '🧾 Retenciones nuevas'],
  ['hon', '🧑‍💼 Recibos por honorarios nuevos'],
  ['vou', '💳 Vouchers nuevos registrados'],
  ['venc', '⏰ Facturas por vencer y vencidas'],
  ['oblig', '📅 Vencimientos SUNAT (IGV-Renta/PLAME, SIRE)'],
  ['err', '❌ Descargas automáticas con error'],
  ['resumen', '☀️ Resumen de la mañana'],
];

var TG_ENC_USUARIOS_ = ['Chat ID', 'Nombre', 'Rol', 'Activo', 'Avisos', 'Desde', 'Último uso'];

/* ============================================================ libro y parámetros */

/** El libro de Cobranzas, también cuando el bot corre como aplicación web (sin hoja abierta). */
function TG_ss_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty(TG_PROP_.SS);
    if (!id) throw new Error('Falta abrir una vez el menú 🤖 Telegram → 1️⃣ Conectar bot en la hoja de Cobranzas.');
    ss = SpreadsheetApp.openById(id);
    // El resto del sistema usa getActiveSpreadsheet(): se lo dejamos puesto.
    try { SpreadsheetApp.setActiveSpreadsheet(ss); } catch (e) { /* sin efecto en algunos contextos */ }
  }
  return ss;
}

function TG_hoja_(ss) {
  var sh = ss.getSheetByName(TG_HOJA_);
  if (!sh) {
    sh = ss.insertSheet(TG_HOJA_);
    sh.getRange(1, 1, 1, 7).merge().setValue('🤖  ASISTENTE DE TELEGRAM  ·  chat con IA, consultas, avisos y descargas de SUNAT desde el celular')
      .setFontSize(12).setFontWeight('bold').setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
    sh.getRange(2, 1, 1, 7).merge().setValue('Menú 🤖 Telegram: 1️⃣ Conectar bot → 2️⃣ Vincular mi Telegram. Las claves se guardan ocultas (no en celdas). ' +
      'Agregue o quite personas en la tabla de abajo (Activo = NO para bloquear).').setFontSize(9).setFontColor(COLOR.TEXTO_SUAVE).setWrap(true);
    sh.getRange(3, 1, 1, 3).setValues([['Parámetro', 'Valor', 'Nota']]).setFontWeight('bold').setBackground(COLOR.CABECERA);
    sh.getRange(4, 1, TG_PARAMETROS_.length, 3).setValues(TG_PARAMETROS_.map(function (p) { return [p[1], p[2], p[3]]; }));
    sh.getRange(4, 2, TG_PARAMETROS_.length, 1).setNumberFormat('@').setBackground('#FFF8E1');
    sh.getRange(4, 3, TG_PARAMETROS_.length, 1).setFontSize(9).setFontColor(COLOR.TEXTO_SUAVE).setWrap(true);
    var f = 4 + TG_PARAMETROS_.length + 1;
    sh.getRange(f, 1, 1, 7).merge().setValue('👥 PERSONAS AUTORIZADAS (solo ellas pueden usar el bot)').setFontWeight('bold').setFontColor('#F8FAFC').setBackground(COLOR.AZUL);
    sh.getRange(f + 1, 1, 1, TG_ENC_USUARIOS_.length).setValues([TG_ENC_USUARIOS_]).setFontWeight('bold').setBackground(COLOR.CABECERA);
    sh.getRange(f + 2, 1, 200, 1).setNumberFormat('@');
    sh.setColumnWidth(1, 250); sh.setColumnWidth(2, 260); sh.setColumnWidth(3, 420);
    sh.setFrozenRows(1);
  }
  TG_completarParametros_(sh);
  return sh;
}

/** Agrega los parámetros nuevos (versiones futuras) antes de la tabla de personas. */
function TG_completarParametros_(sh) {
  var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 4), 1).getValues().map(function (r) { return String(r[0]); });
  var faltan = TG_PARAMETROS_.filter(function (p) { return v.indexOf(p[1]) === -1; });
  if (!faltan.length) return;
  var ultimo = 3;
  TG_PARAMETROS_.forEach(function (p) { var i = v.indexOf(p[1]); if (i + 1 > ultimo) ultimo = i + 1; });
  sh.insertRowsAfter(ultimo, faltan.length);
  sh.getRange(ultimo + 1, 1, faltan.length, 3).setValues(faltan.map(function (p) { return [p[1], p[2], p[3]]; }));
  sh.getRange(ultimo + 1, 2, faltan.length, 1).setNumberFormat('@').setBackground('#FFF8E1');
}

/** {repo, owner, nombreRepo, rama, idNotificaciones, …} + lo de ⚙️ Config (vouchers, retenciones, detracciones, empresas). */
function TG_cfg_(ss) {
  ss = ss || TG_ss_();
  var sh = TG_hoja_(ss);
  var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 4), 2).getDisplayValues();
  var porNombre = {};
  v.forEach(function (r) { if (r[0]) porNombre[String(r[0]).trim()] = String(r[1]).trim(); });
  var t = {};
  TG_PARAMETROS_.forEach(function (p) { t[p[0]] = porNombre[p[1]] != null ? porNombre[p[1]] : p[2]; });
  var partes = String(t.repo || '').split('/');
  t.owner = partes[0] || '';
  t.nombreRepo = partes[1] || '';
  t.avisosActivos = !/^NO/i.test(t.avisos || 'SI');
  t.horaResumen = t.horaResumen === '' ? -1 : parseInt(t.horaResumen, 10);
  t.diasVence = parseInt(t.diasVence, 10) || 3;
  t.cob = leerConfig_(ss);
  t.github = PropertiesService.getScriptProperties().getProperty(TG_PROP_.GITHUB) || '';
  return t;
}

/* ============================================================ personas autorizadas */

function TG_filaEncUsuarios_(sh) {
  var v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 4), 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === 'Chat ID') return i + 1;
  // Hoja vieja o borrada a mano: se rehace la tabla al final.
  var f = sh.getLastRow() + 2;
  sh.getRange(f, 1, 1, TG_ENC_USUARIOS_.length).setValues([TG_ENC_USUARIOS_]).setFontWeight('bold').setBackground(COLOR.CABECERA);
  return f;
}

/** [{fila, chatId, nombre, rol, activo, avisos:[…], desde, ultimo}] */
function TG_usuarios_(ss) {
  var sh = TG_hoja_(ss);
  var f = TG_filaEncUsuarios_(sh);
  var n = sh.getLastRow() - f;
  if (n < 1) return [];
  return sh.getRange(f + 1, 1, n, TG_ENC_USUARIOS_.length).getValues().map(function (r, i) {
    return {
      fila: f + 1 + i, chatId: String(r[0]).trim(), nombre: String(r[1] || ''), rol: /admin/i.test(r[2]) ? 'admin' : 'usuario',
      activo: !/^(NO|FALSE)$/i.test(String(r[3]).trim()), avisos: String(r[4] || '').split(/[,; ]+/).filter(Boolean),
      desde: r[5], ultimo: r[6],
    };
  }).filter(function (u) { return /^-?\d+$/.test(u.chatId); });
}

function TG_usuario_(ss, chatId) {
  chatId = String(chatId);
  return TG_usuarios_(ss).filter(function (u) { return u.chatId === chatId; })[0] || null;
}

function TG_agregarUsuario_(ss, chatId, nombre, rol) {
  var ya = TG_usuario_(ss, chatId);
  var sh = TG_hoja_(ss);
  if (ya) {
    sh.getRange(ya.fila, 3, 1, 2).setValues([[ya.rol === 'admin' ? 'admin' : rol, 'SI']]);
    return TG_usuario_(ss, chatId);
  }
  var f = TG_filaEncUsuarios_(sh);
  var fila = Math.max(sh.getLastRow(), f) + 1;
  sh.getRange(fila, 1).setNumberFormat('@');
  sh.getRange(fila, 1, 1, TG_ENC_USUARIOS_.length).setValues([[String(chatId), nombre || '', rol, 'SI',
    TG_AVISOS_.map(function (a) { return a[0]; }).join(','), new Date(), '']]);
  return TG_usuario_(ss, chatId);
}

function TG_guardarAvisos_(ss, u, avisos) {
  TG_hoja_(ss).getRange(u.fila, 5).setValue(avisos.join(','));
}

function TG_desactivarUsuario_(ss, chatId) {
  var u = TG_usuario_(ss, chatId);
  if (u) TG_hoja_(ss).getRange(u.fila, 4).setValue('NO');
  return u;
}

/** Último uso (como mucho una escritura cada 10 minutos por persona). */
function TG_marcarUso_(ss, u) {
  var c = CacheService.getScriptCache();
  if (c.get('tg_uso_' + u.chatId)) return;
  c.put('tg_uso_' + u.chatId, '1', 600);
  try { TG_hoja_(ss).getRange(u.fila, 7).setValue(new Date()); } catch (e) { /* no es importante */ }
}

function TG_admins_(ss) {
  return TG_usuarios_(ss).filter(function (u) { return u.activo && u.rol === 'admin'; });
}

/* ============================================================ menú de la hoja */

function TG_agregarMenu_() {
  SpreadsheetApp.getUi().createMenu('🤖 Telegram')
    .addItem('1️⃣ Conectar bot (token de @BotFather)', 'TG_menuConectar')
    .addItem('2️⃣ Vincular mi Telegram (código)', 'TG_menuVincular')
    .addItem('🔑 Token de GitHub (descargas y estado)', 'TG_menuTokenGitHub')
    .addSeparator()
    .addItem('🔔 Activar avisos automáticos (cada hora)', 'TG_menuActivarAvisos')
    .addItem('🔕 Desactivar avisos automáticos', 'TG_menuDesactivarAvisos')
    .addItem('🧪 Enviarme un mensaje de prueba', 'TG_menuProbar')
    .addItem('📋 Ver estado del bot', 'TG_menuEstado')
    .addItem('🎤 Guardar clave de Groq (audios)', 'TG_menuClaveGroq')
    .addItem('🧪 Probar modelos de IA (cuál responde, cuál está saturado)', 'TG_menuProbarModelos')
    .addSeparator()
    .addItem('⛔ Desconectar bot', 'TG_menuDesconectar')
    .addToUi();
}

function TG_menuConectar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  props.setProperty(TG_PROP_.SS, ss.getId());
  TG_hoja_(ss);
  var actual = props.getProperty(TG_PROP_.TOKEN);
  var r = ui.prompt('🤖 Conectar el bot de Telegram (1/1)',
    '1. En Telegram abra @BotFather, escriba /newbot y siga los pasos (nombre y usuario del bot).\n' +
    '   Use un bot NUEVO: el token del bot de Vouchers no sirve (ese bot dejaría de registrar vouchers).\n' +
    '2. Copie el TOKEN que le da (ej. 123456:ABC-…) y péguelo aquí.\n\n' +
    (actual ? 'Ya hay un token guardado: deje vacío para usar el mismo y solo reconectar.\n' : '') +
    'Se guarda oculto en el script (no queda en ninguna celda).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var token = String(r.getResponseText() || '').trim();
  if (token) {
    if (!/^\d+:[\w-]{20,}$/.test(token)) { ui.alert('Ese token no parece válido (debe verse como 123456789:ABCdef…).'); return; }
    props.setProperty(TG_PROP_.TOKEN, token);
  } else if (!actual) { ui.alert('No se guardó nada: el token estaba vacío.'); return; }
  var res = TG_conectarWebhook_();
  if (!res.ok) { ui.alert('❌ No se pudo conectar', res.error, ui.ButtonSet.OK); return; }
  var codigo = TG_nuevoCodigo_();
  ui.alert('✅ Bot conectado: @' + res.bot,
    'Ahora vincule su Telegram:\n\n1. Abra el bot: https://t.me/' + res.bot + '\n2. Toque INICIAR y envíe este código:\n\n        ' + codigo +
    '\n\n(vale 30 minutos; la primera persona que se vincula queda como administrador).\n\n' +
    'Para lanzar descargas y ver su estado, guarde también el 🔑 Token de GitHub (el mismo de las otras hojas).', ui.ButtonSet.OK);
}

function TG_menuVincular() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty(TG_PROP_.SS, ss.getId());
  var bot = PropertiesService.getScriptProperties().getProperty(TG_PROP_.BOT);
  if (!bot) { SpreadsheetApp.getUi().alert('Primero conecte el bot (🤖 Telegram → 1️⃣ Conectar bot).'); return; }
  var codigo = TG_nuevoCodigo_();
  SpreadsheetApp.getUi().alert('🔗 Vincular un Telegram',
    'La persona debe abrir https://t.me/' + bot + ' y enviar este código:\n\n        ' + codigo +
    '\n\nVale 30 minutos y para una sola persona. ' + (TG_admins_(ss).length ? 'Quedará como usuario (cambie el Rol a admin en la pestaña ' + TG_HOJA_ + ' si corresponde).' : 'Será el administrador.'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function TG_nuevoCodigo_() {
  var codigo = String(Math.floor(100000 + Math.random() * 900000));
  PropertiesService.getScriptProperties().setProperty(TG_PROP_.CODIGO, codigo + '|' + (Date.now() + 30 * 60000));
  return codigo;
}

/** ¿El código es el vigente? (se usa una sola vez) */
function TG_usarCodigo_(texto) {
  var m = String(texto || '').match(/\b(\d{6})\b/);
  if (!m) return false;
  var props = PropertiesService.getScriptProperties();
  var g = String(props.getProperty(TG_PROP_.CODIGO) || '').split('|');
  if (g[0] !== m[1] || Date.now() > Number(g[1] || 0)) return false;
  props.deleteProperty(TG_PROP_.CODIGO);
  return true;
}

function TG_menuTokenGitHub() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('🔑 Token de GitHub',
    'Pegue el token de GitHub (el mismo que usan las hojas de Detracciones, Retenciones o Notificaciones; necesita permiso "Actions: Read and write" ' +
    'sobre el repositorio). Sirve para ver el estado de las descargas y lanzarlas desde Telegram. Se guarda oculto.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = String(r.getResponseText() || '').trim();
  if (!t) { ui.alert('No se guardó: estaba vacío.'); return; }
  PropertiesService.getScriptProperties().setProperty(TG_PROP_.GITHUB, t);
  try {
    var cfg = TG_cfg_(SpreadsheetApp.getActiveSpreadsheet());
    var runs = TG_ghRuns_(cfg, 1);
    ui.alert('✅ Token guardado. GitHub respondió bien (' + (runs.length ? 'última corrida: ' + runs[0].name : 'sin corridas') + ').');
  } catch (e) {
    ui.alert('Token guardado, pero GitHub respondió: ' + e.message);
  }
}

function TG_menuActivarAvisos() {
  TG_instalarVigia_();
  SpreadsheetApp.getUi().alert('🔔 Avisos activados: el bot revisa cada hora lo nuevo (SUNAT, detracciones, retenciones, honorarios, vouchers, vencimientos, ' +
    'descargas con error) y manda el ☀️ resumen de la mañana. Cada persona elige sus avisos en Telegram con /avisos.');
}

function TG_menuDesactivarAvisos() {
  TG_quitarVigia_();
  SpreadsheetApp.getUi().alert('🔕 Avisos automáticos desactivados (el chat sigue funcionando).');
}

function TG_instalarVigia_() {
  TG_quitarVigia_();
  ScriptApp.newTrigger('TG_vigia').timeBased().everyHours(1).create();
}

function TG_quitarVigia_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'TG_vigia') ScriptApp.deleteTrigger(t);
  });
}

function TG_menuProbar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var us = TG_usuarios_(ss).filter(function (u) { return u.activo; });
  if (!us.length) { SpreadsheetApp.getUi().alert('Todavía no hay personas vinculadas (🤖 Telegram → 2️⃣ Vincular mi Telegram).'); return; }
  var ok = 0;
  us.forEach(function (u) { if (TG_enviar_(u.chatId, '🧪 <b>Mensaje de prueba</b> desde la hoja de Cuentas por Cobrar y Pagar. Todo funciona ✅')) ok++; });
  SpreadsheetApp.getUi().alert('Mensaje enviado a ' + ok + ' de ' + us.length + ' persona(s).');
}

function TG_menuEstado() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var lineas = [];
  if (!props.getProperty(TG_PROP_.TOKEN)) lineas.push('❌ Bot sin conectar (1️⃣ Conectar bot).');
  else {
    var w = TG_llamar_('getWebhookInfo', {});
    var info = w.result || {};
    lineas.push('Bot: @' + (props.getProperty(TG_PROP_.BOT) || '?'));
    lineas.push('Webhook: ' + (info.url ? '✅ conectado' : '❌ sin conectar'));
    if (info.pending_update_count) lineas.push('Mensajes en espera: ' + info.pending_update_count);
    if (info.last_error_message) lineas.push('Último error de Telegram: ' + info.last_error_message + ' (' + new Date(info.last_error_date * 1000).toLocaleString() + ')');
  }
  lineas.push('GitHub: ' + (props.getProperty(TG_PROP_.GITHUB) ? '✅ token guardado' : '— sin token (🔑)'));
  var vig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'TG_vigia'; });
  lineas.push('Avisos automáticos: ' + (vig ? '✅ activos (cada hora)' : '🔕 desactivados'));
  var us = TG_usuarios_(ss);
  lineas.push('Personas: ' + us.filter(function (u) { return u.activo; }).length + ' activas de ' + us.length);
  ui.alert('📋 Estado del asistente de Telegram', lineas.join('\n'), ui.ButtonSet.OK);
}

function TG_menuDesconectar() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('⛔ Desconectar bot', '¿Desconectar el bot? Dejará de responder hasta que lo vuelva a conectar (las personas y la configuración se conservan).', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  try { TG_llamar_('deleteWebhook', {}); } catch (e) { /* ya estaba desconectado */ }
  TG_quitarVigia_();
  ui.alert('Bot desconectado.');
}

/* ============================================================ webhook */

/** URL pública de la aplicación web (la deja el despliegue en TG_Despliegue.js). */
function TG_urlWebApp_() {
  if (typeof TG_DEPLOYMENT_ID_ !== 'undefined' && TG_DEPLOYMENT_ID_) return 'https://script.google.com/macros/s/' + TG_DEPLOYMENT_ID_ + '/exec';
  var guardada = PropertiesService.getScriptProperties().getProperty(TG_PROP_.URL);
  if (guardada) return guardada;
  var u = '';
  try { u = ScriptApp.getService().getUrl() || ''; } catch (e) { u = ''; }
  return /\/exec$/.test(u) ? u : '';
}

function TG_conectarWebhook_() {
  var props = PropertiesService.getScriptProperties();
  var me = TG_llamar_('getMe', {});
  if (!me.ok) return { ok: false, error: 'Telegram no reconoce el token (' + (me.description || 'sin respuesta') + '). Cópielo de nuevo desde @BotFather.' };
  props.setProperty(TG_PROP_.BOT, me.result.username);
  var url = TG_urlWebApp_();
  if (!url) return { ok: false, error: 'La aplicación web todavía no está publicada. Se publica sola al desplegar la hoja desde GitHub (workflow "Desplegar Cobranzas"); espere unos minutos y vuelva a intentar.' };
  var secreto = props.getProperty(TG_PROP_.SECRETO);
  if (!secreto) { secreto = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty(TG_PROP_.SECRETO, secreto); }
  var r = TG_llamar_('setWebhook', { url: url + '?token=' + secreto, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true, max_connections: 20 });
  if (!r.ok) return { ok: false, error: 'Telegram rechazó la dirección del bot: ' + (r.description || '') };
  TG_llamar_('setMyCommands', { commands: TG_COMANDOS_.map(function (c) { return { command: c[0], description: c[1] }; }) });
  TG_llamar_('setMyDescription', { description: 'Asistente del grupo: pregunte lo que quiera de cuentas por cobrar y pagar, SUNAT, detracciones, retenciones, honorarios y vouchers. Mande fotos, PDF o notas de voz.' });
  return { ok: true, bot: me.result.username };
}

// Comandos que Telegram muestra en el botón "Menú".
var TG_COMANDOS_ = [
  ['menu', '📋 Menú principal'],
  ['resumen', '📊 Resumen de hoy (todo el grupo)'],
  ['cobrar', '💰 Cuentas por cobrar'],
  ['pagar', '💸 Cuentas por pagar'],
  ['vencidas', '⏰ Facturas vencidas y por vencer'],
  ['vencimientos', '📅 Vencimientos SUNAT: IGV, PLAME, SIRE (y sus avisos)'],
  ['deshacer', '↩️ Deshacer la última acción (datos, vouchers y archivos)'],
  ['notificaciones', '📬 Buzón SUNAT (últimas notificaciones)'],
  ['detracciones', '🏦 Detracciones del mes'],
  ['retenciones', '🧾 Retenciones del mes'],
  ['emitir', '🧾 Emitir comprobantes de retención pendientes'],
  ['honorarios', '🧑‍💼 Recibos por honorarios'],
  ['estado', '⚙️ Estado de las descargas de SUNAT'],
  ['descargar', '⬇ Pedir una descarga a SUNAT'],
  ['sire', '⚡ SIRE: bajar solo el reporte (rápido; varias empresas o meses)'],
  ['actualizar', '🔄 Recalcular Cuentas por Cobrar y Pagar'],
  ['tc', '💱 Tipo de cambio SUNAT de hoy'],
  ['voucher', '🖼 Foto de un voucher (ej. /voucher Originales!2326)'],
  ['recordatorios', '⏰ Mis recordatorios'],
  ['avisos', '🔔 Elegir mis avisos'],
  ['olvidar', '🧹 Empezar una conversación nueva'],
  ['ayuda', '❓ Qué puedo hacer'],
];
