/**
 * SireDirecto.js — 🧪 PRUEBA: bajar el reporte SIRE DIRECTO desde Apps Script (sin GitHub).
 *
 * Es el cliente antiguo (SireClient.gs, agosto 2026) con los arreglos que hoy usa scripts/sire_client.py:
 *   - token OAuth con usuario SOL + client_id/secret (password grant), reintentos cortos;
 *   - presentado → descarga oficial; si no → propuesta; «sin comprobantes» (1070/1815) = periodo vacío;
 *   - si SUNAT ya tiene un pedido en curso (42209) se espera ESE ticket;
 *   - archivo con Accept «todo» (*\/*) y los 6 parámetros del manual vigente;
 *   - ZIP: primero Utilities.unzip y, si falla con los ZIP de SUNAT, un lector propio (SDIR_unzip_).
 * NO escribe en las liquidaciones ni toca la descarga por GitHub: solo mide cuánto tarda, cuenta los
 * comprobantes, busca uno si se pide y deja el ZIP y el TXT en Drive («SIRE · prueba directa»).
 * Las credenciales se guardan solo para el usuario que las escribe (UserProperties), nunca se muestran.
 * Funciones SDIR_.
 */

var SDIR_TOKEN_URL_ = 'https://api-seguridad.sunat.gob.pe/v1/clientessol/CLIENT_ID/oauth2/token/';
var SDIR_BASE_ = 'https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros';
var SDIR_LIBRO_ = { venta: '140000', compra: '080000' };
var SDIR_TOPE_MS_ = 300000;   // Apps Script corta a los 6 min: se deja margen para bajar y leer el archivo

/* ------------------------------------------------ menú y ventana */

function menuSireDirecto() {
  var html = HtmlService.createHtmlOutput(SDIR_HTML_).setWidth(640).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, '🧪 Prueba: reporte SIRE directo (sin GitHub)');
}

function menuSireDirectoBorrar() {
  var p = PropertiesService.getUserProperties(), n = 0;
  Object.keys(p.getProperties()).forEach(function (k) { if (k.indexOf('SDIR_') === 0) { p.deleteProperty(k); n++; } });
  SpreadsheetApp.getUi().alert('🧪 Prueba SIRE directa', n ? 'Se borraron las credenciales de ' + n + ' empresa(s).' : 'No había credenciales guardadas.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Empresas (de empresas.json, si se puede leer) y cuáles ya tienen credenciales para la prueba. */
function SDIR_datos() {
  var emp = [];
  try { emp = listarEmpresasGitHub_(cargarConfigGitHub_(), true).map(function (e) { return { ruc: String(e.ruc), nombre: String(e.nombre || '') }; }); } catch (e) {}
  var p = PropertiesService.getUserProperties().getProperties();
  return { empresas: emp, conCred: Object.keys(p).filter(function (k) { return k.indexOf('SDIR_') === 0; }).map(function (k) { return k.slice(5); }), periodo: Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMM') };
}

function SDIR_guardarCred(ruc, c) {
  ruc = String(ruc || '').replace(/\D/g, '');
  if (ruc.length !== 11) throw new Error('RUC inválido.');
  c = c || {};
  var o = { u: SDIR_usuario_(ruc, c.u), c: String(c.c || ''), id: String(c.id || '').trim(), s: String(c.s || '').trim() };
  if (!o.u || !o.c || !o.id || !o.s) throw new Error('Faltan datos: usuario SOL, clave SOL, client_id y client_secret.');
  PropertiesService.getUserProperties().setProperty('SDIR_' + ruc, JSON.stringify(o));
  return true;
}

/* ------------------------------------------------ la prueba */

/**
 * → {ok, pasos:[{t, s}], total, modo, filas, encontrado:[{...}], url, aviso} o {error, pasos}
 * pasos: cada etapa con sus segundos (para comparar con GitHub).
 */
function SDIR_probar(ruc, periodo, tipo, buscar) {
  var t0 = Date.now(), tPaso = t0, pasos = [];
  var paso = function (t) { var n = Date.now(); pasos.push({ t: t, s: Math.round((n - tPaso) / 100) / 10 }); tPaso = n; };
  try {
    ruc = String(ruc || '').replace(/\D/g, '');
    periodo = String(periodo || '').replace(/\D/g, '');
    tipo = tipo === 'venta' ? 'venta' : 'compra';
    if (!/^\d{6}$/.test(periodo)) throw new Error('Periodo inválido (AAAAMM).');
    var raw = PropertiesService.getUserProperties().getProperty('SDIR_' + ruc);
    if (!raw) throw new Error('Faltan las credenciales de esta empresa.');
    var c = JSON.parse(raw), libro = SDIR_LIBRO_[tipo];

    var token = SDIR_token_(ruc, c); paso('🔑 Token de SUNAT (usuario SOL + API)');
    var presentado = SDIR_presentado_(token, periodo, libro); paso('📋 Estado del periodo: ' + (presentado ? 'presentado' : 'no presentado (propuesta)'));

    var modo = presentado ? 'oficial' : 'propuesta', archivos = null, ticket = '';
    var pedir = function (m) { return m === 'oficial' ? SDIR_pedirOficial_(token, periodo, tipo) : SDIR_pedirPropuesta_(token, periodo, tipo); };
    try {
      ticket = SDIR_pedirORetomar_(function () { return pedir(modo); }); paso('🎫 Pedido a SUNAT (ticket ' + ticket + ')');
      archivos = SDIR_esperar_(token, ticket, periodo, t0);
    } catch (e) {
      if (!SDIR_sinComprobantes_(e)) throw e;
      if (modo === 'oficial') {
        modo = 'propuesta';
        try { ticket = SDIR_pedirORetomar_(function () { return pedir('propuesta'); }); archivos = SDIR_esperar_(token, ticket, periodo, t0); }
        catch (e2) { if (!SDIR_sinComprobantes_(e2)) throw e2; archivos = []; modo = 'vacío'; }
      } else { archivos = []; modo = 'vacío'; }
    }
    if (archivos === 'pendiente') {
      paso('⏳ SUNAT todavía genera el reporte');
      return { ok: false, pendiente: true, ticket: ticket, pasos: pasos, total: Math.round((Date.now() - t0) / 1000),
        aviso: 'SUNAT no terminó en ' + Math.round(SDIR_TOPE_MS_ / 60000) + ' min (Apps Script corta a los 6). Pulse ▶ Probar de nuevo en un rato: se retoma el mismo pedido.' };
    }
    paso('⏱ SUNAT generó el reporte');
    if (!archivos.length) return { ok: true, pasos: pasos, total: Math.round((Date.now() - t0) / 1000), modo: modo, filas: 0, aviso: 'SUNAT dice que no hay comprobantes en ' + periodo + '.' };

    var carpeta = SDIR_carpeta_(), filas = 0, encontrados = [], zipMetodo = '', url = '';
    archivos.forEach(function (a) {
      var blob = SDIR_bajarArchivo_(token, a, libro);
      var nombre = a.nombre.indexOf('__') >= 0 ? a.nombre.split('__').pop() : a.nombre;
      paso('⬇️ Archivo bajado (' + Math.round(blob.getBytes().length / 1024) + ' KB)');
      var partes;
      try { partes = Utilities.unzip(blob.setContentType('application/zip')); zipMetodo = 'Utilities.unzip'; }
      catch (e) { partes = SDIR_unzip_(blob); zipMetodo = 'lector propio (Utilities.unzip falló: ' + String(e.message || e).slice(0, 80) + ')'; }
      paso('📦 ZIP abierto con ' + zipMetodo);
      partes.forEach(function (p) {
        if (!/\.txt$/i.test(p.getName() || '')) return;
        var txt = p.getDataAsString('UTF-8');
        if (txt.indexOf('�') >= 0) txt = p.getDataAsString('ISO-8859-1');
        var r = SDIR_leerTxt_(txt, buscar);
        filas += r.filas; encontrados = encontrados.concat(r.encontrados);
        url = carpeta.createFile(Utilities.newBlob(txt, 'text/plain', ruc + '_' + tipo + '_' + periodo + '_' + (p.getName() || 'reporte.txt'))).getUrl();
      });
      carpeta.createFile(blob.setName(ruc + '_' + tipo + '_' + periodo + '_' + nombre));
    });
    paso('📄 Leído y guardado en Drive');
    var res = { ok: true, pasos: pasos, total: Math.round((Date.now() - t0) / 1000), modo: modo, filas: filas, encontrado: encontrados.slice(0, 10), url: url, zip: zipMetodo };
    console.log('Prueba SIRE directa ' + ruc + ' ' + tipo + ' ' + periodo + ': ' + JSON.stringify({ total: res.total, modo: modo, filas: filas, zip: zipMetodo, pasos: pasos }));
    return res;
  } catch (e) {
    paso('❌ Error');
    console.warn('Prueba SIRE directa ' + ruc + ' ' + tipo + ' ' + periodo + ': ' + (e && e.message || e));
    return { ok: false, error: String(e && e.message || e).slice(0, 700), pasos: pasos, total: Math.round((Date.now() - t0) / 1000) };
  }
}

/* ------------------------------------------------ API SIRE */

function SDIR_token_(ruc, c) {
  var url = SDIR_TOKEN_URL_.replace('CLIENT_ID', encodeURIComponent(c.id)), ultimo = '';
  for (var i = 1; i <= 4; i++) {
    var r;
    try {
      r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/x-www-form-urlencoded', muteHttpExceptions: true,
        payload: { grant_type: 'password', scope: 'https://api-sire.sunat.gob.pe', client_id: c.id, client_secret: c.s, username: ruc + SDIR_usuario_(ruc, c.u), password: c.c } });
    } catch (e) { ultimo = 'red: ' + e.message; Utilities.sleep(i * 3000); continue; }
    var cod = r.getResponseCode(), t = r.getContentText();
    if (cod === 200) { var d = JSON.parse(t); if (d.access_token) return d.access_token; ultimo = 'sin access_token'; }
    else if (cod === 400 || cod === 401) throw new Error(/autenticacion del usuario|access_denied/i.test(t)
      ? 'SUNAT no aceptó el USUARIO SOL o la CLAVE SOL de esta empresa (el client_id sí lo reconoció). Revise: el usuario es solo el usuario SOL (sin el RUC delante), la clave SOL es la vigente y ese usuario es de la empresa ' + ruc + ' y tiene acceso al SIRE. Corríjalo con 🔑 Cambiar credenciales.'
      : /client|invalid_client|unauthorized_client/i.test(t)
        ? 'SUNAT no reconoce el client_id / client_secret (deben ser de la empresa ' + ruc + ', con el servicio MIGE RCE y RVIE - SIRE). Corríjalo con 🔑 Cambiar credenciales.'
        : 'SUNAT rechazó las credenciales (' + cod + '): ' + t.slice(0, 300));
    else ultimo = 'HTTP ' + cod + ': ' + t.slice(0, 200);
    Utilities.sleep(i * 3000);
  }
  throw new Error('No se pudo obtener el token de SUNAT: ' + ultimo);
}

/** Usuario SOL sin espacios, en mayúsculas y sin el RUC delante (si se escribió «20615366791USUARIO», queda «USUARIO»). */
function SDIR_usuario_(ruc, u) {
  u = String(u || '').replace(/\s+/g, '').toUpperCase();
  return u.indexOf(ruc) === 0 && u.length > 11 ? u.slice(11) : u;
}

/** GET a la API SIRE con los mismos reintentos que sire_client.py (429 y 5xx). Devuelve la respuesta. */
function SDIR_get_(url, params, token, accept) {
  var qs = Object.keys(params || {}).filter(function (k) { return params[k] != null; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  var u = url + (qs ? '?' + qs : ''), ultimo = '';
  for (var i = 1; i <= 4; i++) {
    var r;
    try { r = UrlFetchApp.fetch(u, { method: 'get', muteHttpExceptions: true, headers: { 'Content-Type': 'application/json', Accept: accept || 'application/json', Authorization: 'Bearer ' + token } }); }
    catch (e) { ultimo = 'red: ' + e.message; Utilities.sleep(i * 3000); continue; }
    var cod = r.getResponseCode();
    if (cod === 200) return r;
    if (cod === 429) { ultimo = 'límite 429'; Utilities.sleep(i * 10000); continue; }
    if (cod >= 500) { ultimo = 'HTTP ' + cod; Utilities.sleep(i * 3000); continue; }
    throw new Error('Error SUNAT ' + cod + ': ' + r.getContentText().slice(0, 500));
  }
  throw new Error('SUNAT no respondió tras 4 intentos (' + ultimo + ').');
}
function SDIR_json_(url, params, token) { return JSON.parse(SDIR_get_(url, params, token).getContentText()); }

function SDIR_presentado_(token, periodo, libro) {
  var data = SDIR_json_(SDIR_BASE_ + '/rvierce/padron/web/omisos/' + libro + '/periodos', {}, token), est = '';
  (data || []).forEach(function (ej) { (ej.lisPeriodos || []).forEach(function (p) { if (p.perTributario === periodo) est = String(p.desEstado || ''); }); });
  return /^presentado/i.test(est.trim());
}
function SDIR_pedirPropuesta_(token, periodo, tipo) {
  if (tipo === 'venta') return SDIR_json_(SDIR_BASE_ + '/rvie/propuesta/web/propuesta/' + periodo + '/exportapropuesta', { codTipoArchivo: '0' }, token).numTicket;
  return SDIR_json_(SDIR_BASE_ + '/rce/propuesta/web/propuesta/' + periodo + '/exportacioncomprobantepropuesta', { codTipoArchivo: '0', codOrigenEnvio: '2' }, token).numTicket;
}
function SDIR_pedirOficial_(token, periodo, tipo) {
  if (tipo === 'venta') return SDIR_json_(SDIR_BASE_ + '/rvierce/gestionlibro/web/registroslibros/descarga',
    { perTributario: periodo, codOrigenEnvio: '2', codTipoArchivo: '0', codProceso: '23', codLibro: SDIR_LIBRO_.venta }, token).numTicket;
  return SDIR_json_(SDIR_BASE_ + '/rce/ajustesposteriores/web/ajustesposteriores/' + periodo + '/solicitardescarga',
    { codTipoArchivo: '0', codMoneda: 'PEN', codProceso: '70', codOrigen: '2', lisPeriodos: periodo }, token).numTicket;
}
/** SUNAT solo deja un pedido en curso por libro: si responde 42209 con «Ticket: N», se espera ese. */
function SDIR_pedirORetomar_(pedir) {
  try { return pedir(); } catch (e) {
    var t = String(e.message || e), m = t.indexOf('42209') >= 0 && t.match(/Ticket:\s*(\d{8,})/);
    if (m) return m[1];
    throw e;
  }
}
function SDIR_sinComprobantes_(e) {
  var t = String(e && e.message || e);
  return /(^|\D)(1070|1815)(\D|$)/.test(t) || /No se ha encontrado|No existen documentos para exportar/.test(t);
}
/** Espera el ticket (3, 6, 12, 20, 28, 30… s) hasta el tope; 'pendiente' si no terminó a tiempo. */
function SDIR_esperar_(token, ticket, periodo, t0) {
  var pausa = 3000;
  while (true) {
    var data = SDIR_json_(SDIR_BASE_ + '/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets',
      { perIni: periodo, perFin: periodo, page: 1, perPage: 50, numTicket: ticket }, token);
    var reg = (data.registros || []).filter(function (r) { return r.numTicket === ticket || (r.detalleTicket && r.detalleTicket.numTicket === ticket); })[0];
    if (reg) {
      var det = reg.detalleTicket || {}, desc = ((det.desEstadoEnvio || '') + ' ' + (reg.desEstadoProceso || '')).toLowerCase();
      if (desc.indexOf('error') >= 0) throw new Error('SUNAT reportó error en el ticket ' + ticket + ': ' + JSON.stringify(reg).slice(0, 400));
      if (desc.indexOf('terminado') >= 0) {
        return (reg.archivoReporte || det.archivoReporte || []).filter(function (a) { return a.nomArchivoReporte; }).map(function (a) {
          return { nombre: a.nomArchivoReporte, codTipoArchivo: a.codTipoAchivoReporte || a.codTipoArchivoReporte, perTributario: reg.perTributario || periodo, codProceso: reg.codProceso, numTicket: reg.numTicket || ticket };
        });
      }
    }
    if (Date.now() - t0 + pausa > SDIR_TOPE_MS_) return 'pendiente';
    Utilities.sleep(pausa);
    pausa = Math.min(30000, pausa < 12000 ? pausa * 2 : pausa + 8000);
  }
}
function SDIR_bajarArchivo_(token, a, libro) {
  var params = { nomArchivoReporte: a.nombre, codTipoArchivoReporte: a.codTipoArchivo, codLibro: libro, perTributario: a.perTributario, codProceso: a.codProceso, numTicket: a.numTicket };
  var ultimo = '';
  for (var i = 0; i < 3; i++) {
    try {
      var b = SDIR_get_(SDIR_BASE_ + '/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte', params, token, '*/*').getBlob();
      if (b.getBytes().length) return b;
      ultimo = 'archivo vacío (0 bytes)';
    } catch (e) { ultimo = e.message; }
    if (i < 2) Utilities.sleep(i ? 30000 : 10000);
  }
  throw new Error('SUNAT no entregó el archivo ' + a.nombre + ': ' + ultimo);
}

/* ------------------------------------------------ ZIP y TXT */

/**
 * Lector de ZIP propio: Utilities.unzip falla con algunos ZIP de SUNAT. Cada archivo comprimido (deflate)
 * se envuelve como GZIP (cabecera + datos + CRC32 + tamaño, tomados del directorio del ZIP) y lo abre
 * Utilities.ungzip. Devuelve Blobs con su nombre.
 */
function SDIR_unzip_(blob) {
  var b = blob.getBytes(), u8 = function (i) { return b[i] & 255; };
  var u16 = function (i) { return u8(i) | (u8(i + 1) << 8); }, u32 = function (i) { return (u16(i) + u16(i + 2) * 65536); };
  var fin = -1;
  for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('El archivo de SUNAT no parece un ZIP.');
  var n = u16(fin + 10), pos = u32(fin + 16), out = [];
  for (var k = 0; k < n; k++) {
    if (u32(pos) !== 0x02014b50) throw new Error('ZIP dañado (directorio).');
    var metodo = u16(pos + 10), crc = u32(pos + 16), csize = u32(pos + 20), usize = u32(pos + 24);
    var ln = u16(pos + 28), le = u16(pos + 30), lc = u16(pos + 32), loc = u32(pos + 42);
    var nombre = Utilities.newBlob(b.slice(pos + 46, pos + 46 + ln)).getDataAsString('UTF-8');
    pos += 46 + ln + le + lc;
    if (/\/$/.test(nombre)) continue;
    if (u32(loc) !== 0x04034b50) throw new Error('ZIP dañado (cabecera de ' + nombre + ').');
    var ini = loc + 30 + u16(loc + 26) + u16(loc + 28), datos = b.slice(ini, ini + csize);
    var s = function (x) { x = x & 255; return x > 127 ? x - 256 : x; };
    var le32 = function (x) { return [s(x), s(x >>> 8), s(x >>> 16), s(x >>> 24)]; };
    if (metodo === 0) { out.push(Utilities.newBlob(datos, 'text/plain', nombre)); continue; }
    if (metodo !== 8) throw new Error('Compresión no soportada (' + metodo + ') en ' + nombre + '.');
    var gz = [31, -117, 8, 0, 0, 0, 0, 0, 0, -1].concat(datos, le32(crc), le32(usize));
    out.push(Utilities.ungzip(Utilities.newBlob(gz, 'application/x-gzip', nombre + '.gz')).setName(nombre));
  }
  return out;
}

/** Cuenta los comprobantes del TXT del SIRE (separado por «|», con encabezado) y busca «FN01-80» si se pidió. */
function SDIR_leerTxt_(txt, buscar) {
  var lin = String(txt || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (!lin.length) return { filas: 0, encontrados: [] };
  var cab = lin[0].split('|').map(function (h) { return h.trim(); });
  var col = function (re) { for (var i = 0; i < cab.length; i++) if (re.test(cab[i])) return i; return -1; };
  var iS = col(/^serie/i), iN = col(/^nro cp|^n.mero|nro cp o doc/i), iF = col(/fecha de emisi/i), iR = col(/^nro doc identidad/i), iRs = col(/apellidos nombres\s*\//i) >= 0 ? col(/apellidos nombres\s*\//i) : col(/raz.n social|apellidos/i), iT = col(/^total cp|^total/i), iMon = col(/^moneda|cod moneda/i);
  var m = String(buscar || '').toUpperCase().match(/([A-Z0-9]{4})\s*-\s*0*(\d+)/), enc = [];
  for (var j = 1; j < lin.length; j++) {
    if (!m || iS < 0 || iN < 0) continue;
    var c = lin[j].split('|');
    if (String(c[iS] || '').trim().toUpperCase() === m[1] && String(parseInt(c[iN], 10)) === m[2])
      enc.push({ serie: c[iS], numero: c[iN], fecha: iF >= 0 ? c[iF] : '', ruc: iR >= 0 ? c[iR] : '', nombre: iRs >= 0 ? c[iRs] : '', total: iT >= 0 ? c[iT] : '', moneda: iMon >= 0 ? c[iMon] : '' });
  }
  return { filas: lin.length - 1, encontrados: enc };
}

function SDIR_carpeta_() {
  var it = DriveApp.getFoldersByName('SIRE · prueba directa (Apps Script)');
  return it.hasNext() ? it.next() : DriveApp.createFolder('SIRE · prueba directa (Apps Script)');
}

/* ------------------------------------------------ ventana */

var SDIR_HTML_ = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  'body{font:13px Arial,sans-serif;margin:0;padding:12px;color:#222}label{display:block;margin:8px 0 3px;color:#475569;font-size:12px}',
  'input,select{padding:6px;width:100%;box-sizing:border-box}.fila{display:flex;gap:8px}.fila>div{flex:1}',
  'button{padding:8px 14px;border:0;border-radius:6px;background:#1D4ED8;color:#fff;cursor:pointer;margin-top:10px}button.g{background:#6b7280}button:disabled{opacity:.5}',
  '#cred{border:1px solid #FDE68A;background:#FFFBEB;border-radius:8px;padding:8px;margin-top:10px}.m{margin-top:10px}.e{color:#B91C1C}',
  'table{border-collapse:collapse;width:100%;margin-top:6px}td{border-bottom:1px solid #E2E8F0;padding:4px}td.n{text-align:right;white-space:nowrap}',
  '</style></head><body>',
  '<div style="color:#475569">Baja el registro del SIRE <b>directo desde Google</b>, sin GitHub, para medir si es más rápido. <b>No cambia nada</b> en las liquidaciones: solo mide, cuenta y guarda el archivo en Drive («SIRE · prueba directa»).</div>',
  '<div class="fila"><div><label>Empresa</label><select id="emp"></select><input id="rucM" placeholder="o escriba el RUC" style="margin-top:4px"></div>',
  '<div><label>Periodo (AAAAMM)</label><input id="per"></div></div>',
  '<div class="fila"><div><label>Registro</label><select id="tip"><option value="compra">Compras</option><option value="venta">Ventas</option></select></div>',
  '<div><label>Buscar un comprobante (opcional)</label><input id="bus" placeholder="ej. FN01-80"></div></div>',
  '<div id="cred" style="display:none"><b>🔑 Credenciales de esta empresa</b> <span style="color:#64748B;font-size:12px">(se guardan solo para usted; no se muestran ni se suben a ningún lado)</span>',
  '<div class="fila"><div><label>Usuario SOL</label><input id="cu" autocomplete="off"></div><div><label>Clave SOL</label><input id="cc" type="password" autocomplete="new-password"></div></div>',
  '<div class="fila"><div><label>client_id (API SUNAT)</label><input id="ci" autocomplete="off"></div><div><label>client_secret</label><input id="cs" type="password" autocomplete="new-password"></div></div></div>',
  '<button id="bP" onclick="probar()">▶ Probar</button> <button class="g" onclick="verCred()">🔑 Cambiar credenciales</button> <button class="g" onclick="google.script.host.close()">Cerrar</button>',
  '<div id="out" class="m"></div>',
  '<script>',
  'var D=null,$=function(i){return document.getElementById(i)};',
  'function esc(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}',
  'function ruc(){return ($("rucM").value||$("emp").value).replace(/\\D/g,"")}',
  'function marcarCred(){$("cred").style.display=D&&D.conCred.indexOf(ruc())<0?"block":"none"}',
  'function verCred(){$("cred").style.display="block"}',
  'google.script.run.withSuccessHandler(function(d){D=d;$("per").value=d.periodo;$("emp").innerHTML=d.empresas.map(function(e){return"<option value=\\""+e.ruc+"\\">"+esc(e.nombre)+" ("+e.ruc+")"+(d.conCred.indexOf(e.ruc)>=0?" 🔑":"")+"</option>"}).join("")||"<option value=\\"\\">(escriba el RUC)</option>";marcarCred()}).SDIR_datos();',
  '$("emp").onchange=marcarCred;$("rucM").oninput=marcarCred;',
  'function probar(){var r=ruc();if(r.length!==11)return alert("Elija la empresa o escriba su RUC.");',
  ' var go=function(){$("bP").disabled=true;var t0=Date.now(),tm=setInterval(function(){$("out").innerHTML="⏳ Hablando con SUNAT… "+Math.round((Date.now()-t0)/1000)+" s"},1000);',
  '  google.script.run.withFailureHandler(function(e){clearInterval(tm);$("bP").disabled=false;$("out").innerHTML="<div class=e>❌ "+esc(e.message)+"</div>"}).withSuccessHandler(function(x){clearInterval(tm);$("bP").disabled=false;pintar(x)}).SDIR_probar(r,$("per").value,$("tip").value,$("bus").value)};',
  ' if($("cred").style.display==="block"){var c={u:$("cu").value,c:$("cc").value,id:$("ci").value,s:$("cs").value};if(!c.u||!c.c||!c.id||!c.s)return alert("Complete las 4 credenciales.");',
  '  google.script.run.withFailureHandler(function(e){alert(e.message)}).withSuccessHandler(function(){D.conCred.push(r);$("cc").value="";$("cs").value="";$("cred").style.display="none";go()}).SDIR_guardarCred(r,c);return}',
  ' go()}',
  'function pintar(x){var h="<table>"+(x.pasos||[]).map(function(p){return"<tr><td>"+esc(p.t)+"</td><td class=n>"+p.s+" s</td></tr>"}).join("")+"<tr><td><b>Total</b></td><td class=n><b>"+x.total+" s</b></td></tr></table>";',
  ' if(x.error)h="<div class=e>❌ "+esc(x.error)+"</div>"+h;',
  ' if(x.aviso)h="<div>⚠️ "+esc(x.aviso)+"</div>"+h;',
  ' if(x.ok&&x.filas!=null)h="<div>✅ <b>"+x.filas+"</b> comprobante(s) · "+esc(x.modo)+(x.zip?" · ZIP: "+esc(x.zip):"")+(x.url?" · <a href=\\""+esc(x.url)+"\\" target=_blank>ver TXT en Drive</a>":"")+"</div>"+h;',
  ' if(x.ok&&$("bus").value.trim())h+=(x.encontrado&&x.encontrado.length?"<div class=m>🔎 Encontrado: "+x.encontrado.map(function(e){return esc(e.serie+"-"+e.numero+" · "+e.fecha+" · "+e.ruc+" "+e.nombre+" · "+e.moneda+" "+e.total)}).join("<br>")+"</div>":"<div class=m>🔎 <b>"+esc($("bus").value)+"</b> no está en lo que SUNAT entregó para ese periodo.</div>");',
  ' $("out").innerHTML=h}',
  '</script></body></html>'
].join('\n');
