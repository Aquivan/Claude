/**
 * Notificaciones · Grupo — GitHub.js
 * Lee del repositorio los archivos que deja el workflow
 * "Notificaciones - descargar Buzón Electrónico (SUNAT SOL)":
 *   notificaciones/datos/<RUC>/notificaciones.csv | mensajes.csv | <AAAA>/<MM>/*.pdf
 */

var NOT_RUTA_DATOS = 'notificaciones/datos';

function NOT_api_(cfg, ruta, crudo) {
  if (!cfg.token) throw new Error('Falta el token de GitHub: menú 📬 Notificaciones → 🔑 Guardar token de GitHub.');
  return {
    url: 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + ruta,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: crudo ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    muteHttpExceptions: true,
  };
}

function NOT_pedir_(cfg, ruta, crudo) {
  var p = NOT_api_(cfg, ruta, crudo);
  var r = UrlFetchApp.fetch(p.url, p);
  var c = r.getResponseCode();
  if (c === 401 || c === 403) throw new Error('GitHub rechazó el token (HTTP ' + c + '). Revise el token con 🔑.');
  if (c === 404) return null;
  if (c >= 300) throw new Error('GitHub respondió HTTP ' + c + ' en ' + ruta);
  return r;
}

/** Lista todos los archivos de notificaciones/datos: [{path, sha, size}] (path relativo a datos/). */
function NOT_listarArchivos_(cfg) {
  var rama = encodeURIComponent(cfg.rama);
  var r = NOT_pedir_(cfg, '/contents/notificaciones?ref=' + rama);
  if (!r) throw new Error('No se encontró la carpeta notificaciones/ en la rama ' + cfg.rama + '.');
  var datos = JSON.parse(r.getContentText()).filter(function (x) { return x.name === 'datos' && x.type === 'dir'; })[0];
  if (!datos) return [];  // todavía no se descargó nada
  var t = NOT_pedir_(cfg, '/git/trees/' + datos.sha + '?recursive=1');
  var arbol = JSON.parse(t.getContentText());
  return (arbol.tree || []).filter(function (x) { return x.type === 'blob'; })
    .map(function (x) { return { path: x.path, sha: x.sha, size: x.size }; });
}

/** Descarga varios archivos de texto a la vez. rutas: relativas a notificaciones/datos/. */
function NOT_leerTextos_(cfg, rutas) {
  var res = {};
  for (var i = 0; i < rutas.length; i += 20) {
    var lote = rutas.slice(i, i + 20);
    var pedidos = lote.map(function (ruta) {
      var p = NOT_api_(cfg, '/contents/' + NOT_RUTA_DATOS + '/' + ruta + '?ref=' + encodeURIComponent(cfg.rama), true);
      return { url: p.url, headers: p.headers, muteHttpExceptions: true };
    });
    var resp = UrlFetchApp.fetchAll(pedidos);
    resp.forEach(function (r, k) {
      if (r.getResponseCode() === 200) res[lote[k]] = r.getContentText('UTF-8');
    });
  }
  return res;
}

/** Descarga un archivo binario (PDF) como Blob. */
function NOT_leerBlob_(cfg, ruta, nombre) {
  var r = NOT_pedir_(cfg, '/contents/' + NOT_RUTA_DATOS + '/' + ruta + '?ref=' + encodeURIComponent(cfg.rama), true);
  return r ? r.getBlob().setName(nombre) : null;
}

/** Empresas de empresas.json (las mismas de SIRE): [{ruc, nombre, activo}] */
function NOT_listarEmpresas_(cfg) {
  var r = NOT_pedir_(cfg, '/contents/empresas.json?ref=' + encodeURIComponent(cfg.rama), true);
  if (!r) return [];
  var d = JSON.parse(r.getContentText('UTF-8'));
  return (d.empresas || []).map(function (e) {
    return { ruc: String(e.ruc).trim(), nombre: String(e.nombre || '').trim(), activo: e.activo !== false };
  });
}

/** Pide a GitHub que corra la descarga de SUNAT (todas las empresas, mes anterior → mes actual). */
function NOT_menuPedirDescarga() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = NOT_leerConfig_();
    // Solo lo nuevo: en cada empresa se deja de revisar el buzón donde empieza lo ya descargado (rápido).
    NOT_despachar_(cfg, 'todas', cfg.bajarPdf, '', true);
    ui.alert('⬇ Pedido enviado. GitHub está revisando SOLO LO NUEVO del Buzón Electrónico de todas las empresas' +
      (cfg.bajarPdf ? ' (con PDF de las notificaciones nuevas).' : ' (solo la lista).') + '\n\nTarda unos minutos. Luego use 🔄 Actualizar todo.');
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

function NOT_despachar_(cfg, empresa, conPdf, desde, soloNuevas) {
  var p = NOT_api_(cfg, '/actions/workflows/notificaciones-descargar.yml/dispatches');
  p.method = 'post';
  p.contentType = 'application/json';
  p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: empresa, pdf: conPdf ? 'true' : 'false', desde: desde || '', solo_nuevas: soloNuevas ? 'true' : 'false' } });
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 204) throw new Error('GitHub respondió HTTP ' + r.getResponseCode() + ' (el token necesita permiso "Actions: Read and write").');
}

/** Elegir desde qué mes/fecha, una empresa (o todas) y si se baja el PDF. */
function NOT_menuPedirRango() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = NOT_leerConfig_();
    var r1 = ui.prompt('📅 Desde', 'Desde qué mes (AAAAMM, ej. 202601) o fecha (dd/mm/aaaa, ej. 15/03/2026).\nVacío = desde ' + cfg.desde + ' (Config). NUEVO = solo lo que falta (rápido). TODO = todo el buzón:', ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return;
    var t = String(r1.getResponseText() || '').trim();
    var soloNuevas = /^nuevo?s?$/i.test(t);
    var desde = /^todo$/i.test(t) || soloNuevas ? '' : (t || cfg.desde);
    if (desde && !/^\d{6}$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(desde)) { ui.alert('Fecha no válida: use AAAAMM o dd/mm/aaaa.'); return; }
    var empresas = NOT_listarEmpresas_(cfg).filter(function (e) { return e.activo; });
    var r2 = ui.prompt('🏢 Empresa', empresas.map(function (e, i) { return (i + 1) + ') ' + e.nombre + ' · ' + e.ruc; }).join('\n') +
      '\n\nNúmero de la empresa (vacío = todas):', ui.ButtonSet.OK_CANCEL);
    if (r2.getSelectedButton() !== ui.Button.OK) return;
    var k = parseInt(r2.getResponseText(), 10);
    var empresa = k >= 1 && k <= empresas.length ? empresas[k - 1].ruc : 'todas';
    var conPdf = ui.alert('📄 PDF', '¿Bajar el PDF de las notificaciones nuevas?\n\nSÍ = SUNAT las marca como leídas (igual que al abrirlas; la notificación ya surte efecto desde su depósito).\nNO = solo la lista.', ui.ButtonSet.YES_NO) === ui.Button.YES;
    NOT_despachar_(cfg, empresa, conPdf, desde, soloNuevas);
    ui.alert('⬇ Pedido enviado: ' + (empresa === 'todas' ? 'todas las empresas' : empresa) + ', ' + (soloNuevas ? 'solo lo nuevo' : 'desde ' + (desde || 'el inicio')) + (conPdf ? ', con PDF.' : ', solo lista.') +
      '\n\nTarda unos minutos. Luego use 🔄 Actualizar todo.');
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}
