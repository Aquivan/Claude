/**
 * Detracciones · Grupo — GitHub.js
 * Lee del repositorio los archivos que deja el workflow
 * "Detracciones - descargar depósitos (SUNAT SOL)":
 *   detracciones/datos/<RUC>/<AAAA>/<MM>/detracciones.csv
 */

var DET_RUTA_DATOS = 'detracciones/datos';

function DET_api_(cfg, ruta, crudo) {
  if (!cfg.token) throw new Error('Falta el token de GitHub: menú 🏦 Detracciones → 🔑 Guardar token de GitHub.');
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

function DET_pedir_(cfg, ruta, crudo) {
  var p = DET_api_(cfg, ruta, crudo);
  var r = UrlFetchApp.fetch(p.url, p);
  var c = r.getResponseCode();
  if (c === 401 || c === 403) throw new Error('GitHub rechazó el token (HTTP ' + c + '). Revise el token con 🔑.');
  if (c === 404) return null;
  if (c >= 300) throw new Error('GitHub respondió HTTP ' + c + ' en ' + ruta);
  return r;
}

/** Lista todos los archivos de detracciones/datos: [{path, sha, size}] (path relativo a datos/). */
function DET_listarArchivos_(cfg) {
  var r = DET_pedir_(cfg, '/contents/detracciones?ref=' + encodeURIComponent(cfg.rama));
  if (!r) throw new Error('No se encontró la carpeta detracciones/ en la rama ' + cfg.rama + '.');
  var datos = JSON.parse(r.getContentText()).filter(function (x) { return x.name === 'datos' && x.type === 'dir'; })[0];
  if (!datos) return [];  // todavía no se descargó nada
  var t = DET_pedir_(cfg, '/git/trees/' + datos.sha + '?recursive=1');
  return (JSON.parse(t.getContentText()).tree || []).filter(function (x) { return x.type === 'blob'; })
    .map(function (x) { return { path: x.path, sha: x.sha, size: x.size }; });
}

/** Descarga varios archivos de texto a la vez. rutas: relativas a detracciones/datos/. */
function DET_leerTextos_(cfg, rutas) {
  var res = {};
  for (var i = 0; i < rutas.length; i += 20) {
    var lote = rutas.slice(i, i + 20);
    var pedidos = lote.map(function (ruta) {
      var p = DET_api_(cfg, '/contents/' + DET_RUTA_DATOS + '/' + ruta + '?ref=' + encodeURIComponent(cfg.rama), true);
      return { url: p.url, headers: p.headers, muteHttpExceptions: true };
    });
    UrlFetchApp.fetchAll(pedidos).forEach(function (r, k) {
      if (r.getResponseCode() === 200) res[lote[k]] = r.getContentText('UTF-8');
    });
  }
  return res;
}

/** Empresas de empresas.json (las mismas de SIRE): [{ruc, nombre, activo}] */
function DET_listarEmpresas_(cfg) {
  var r = DET_pedir_(cfg, '/contents/empresas.json?ref=' + encodeURIComponent(cfg.rama), true);
  if (!r) return [];
  return (JSON.parse(r.getContentText('UTF-8')).empresas || []).map(function (e) {
    return { ruc: String(e.ruc).trim(), nombre: String(e.nombre || '').trim(), activo: e.activo !== false };
  });
}

function DET_despachar_(cfg, empresa, desde, hasta) {
  var p = DET_api_(cfg, '/actions/workflows/detracciones-descargar.yml/dispatches');
  p.method = 'post';
  p.contentType = 'application/json';
  p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: empresa, desde: desde || '', hasta: hasta || '' } });
  var r = UrlFetchApp.fetch(p.url, p);
  if (r.getResponseCode() !== 204) throw new Error('GitHub respondió HTTP ' + r.getResponseCode() + ' (el token necesita permiso "Actions: Read and write").');
}

/** Pide a GitHub la descarga de SUNAT: todas las empresas, últimos 3 meses. */
function DET_menuPedirDescarga() {
  var ui = SpreadsheetApp.getUi();
  try {
    DET_despachar_(DET_leerConfig_(), 'todas', '', '');
    ui.alert('⬇ Pedido enviado. GitHub está consultando en SUNAT los depósitos de detracciones de los últimos 3 meses de todas las empresas.\n\nTarda unos minutos. Luego use 🔄 Actualizar hoja.');
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

/** Elegir meses (desde/hasta) y una empresa (o todas). */
function DET_menuPedirRango() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = DET_leerConfig_();
    var r1 = ui.prompt('📅 Desde', 'Desde qué mes de pago (AAAAMM, ej. 202501):', ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return;
    var desde = String(r1.getResponseText() || '').trim();
    if (!/^\d{6}$/.test(desde)) { ui.alert('Mes no válido: use AAAAMM.'); return; }
    var r2 = ui.prompt('📅 Hasta', 'Hasta qué mes (AAAAMM). Vacío = este mes:', ui.ButtonSet.OK_CANCEL);
    if (r2.getSelectedButton() !== ui.Button.OK) return;
    var hasta = String(r2.getResponseText() || '').trim();
    if (hasta && !/^\d{6}$/.test(hasta)) { ui.alert('Mes no válido: use AAAAMM.'); return; }
    var empresas = DET_listarEmpresas_(cfg).filter(function (e) { return e.activo; });
    var r3 = ui.prompt('🏢 Empresa', empresas.map(function (e, i) { return (i + 1) + ') ' + e.nombre + ' · ' + e.ruc; }).join('\n') +
      '\n\nNúmero de la empresa (vacío = todas):', ui.ButtonSet.OK_CANCEL);
    if (r3.getSelectedButton() !== ui.Button.OK) return;
    var k = parseInt(r3.getResponseText(), 10);
    var empresa = k >= 1 && k <= empresas.length ? empresas[k - 1].ruc : 'todas';
    DET_despachar_(cfg, empresa, desde, hasta);
    ui.alert('⬇ Pedido enviado: ' + (empresa === 'todas' ? 'todas las empresas' : empresa) + ', de ' + desde + ' a ' + (hasta || 'este mes') +
      '.\n\nTarda unos minutos (un poco más si son muchos meses). Luego use 🔄 Actualizar hoja.');
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}
