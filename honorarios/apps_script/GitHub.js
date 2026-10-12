/**
 * Honorarios · Grupo — GitHub.js
 * Lee del repositorio los archivos que deja el workflow
 * "Honorarios - descargar RHE recibidos (SUNAT SOL)":
 *   honorarios/datos/<RUC>/<AAAA>/<MM>/rhe.csv | pdf/*.pdf | xml/*.xml
 */

var HON_RUTA_DATOS = 'honorarios/datos';

function HON_api_(cfg, ruta, crudo) {
  if (!cfg.token) throw new Error('Falta el token de GitHub: menú 🧑‍💼 Honorarios → 🔑 Guardar token de GitHub.');
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

function HON_pedir_(cfg, ruta, crudo) {
  var p = HON_api_(cfg, ruta, crudo);
  var r = UrlFetchApp.fetch(p.url, p);
  var c = r.getResponseCode();
  if (c === 401 || c === 403) throw new Error('GitHub rechazó el token (HTTP ' + c + '). Revise el token con 🔑.');
  if (c === 404) return null;
  if (c >= 300) throw new Error('GitHub respondió HTTP ' + c + ' en ' + ruta);
  return r;
}

/** Lista todos los archivos de honorarios/datos: [{path, sha, size}] (path relativo a datos/). */
function HON_listarArchivos_(cfg) {
  var rama = encodeURIComponent(cfg.rama);
  var r = HON_pedir_(cfg, '/contents/honorarios?ref=' + rama);
  if (!r) throw new Error('No se encontró la carpeta honorarios/ en la rama ' + cfg.rama + '.');
  var datos = JSON.parse(r.getContentText()).filter(function (x) { return x.name === 'datos' && x.type === 'dir'; })[0];
  if (!datos) return [];  // todavía no se descargó nada
  var t = HON_pedir_(cfg, '/git/trees/' + datos.sha + '?recursive=1');
  var arbol = JSON.parse(t.getContentText());
  return (arbol.tree || []).filter(function (x) { return x.type === 'blob'; })
    .map(function (x) { return { path: x.path, sha: x.sha, size: x.size }; });
}

/** Descarga varios archivos de texto a la vez. rutas: relativas a honorarios/datos/. */
function HON_leerTextos_(cfg, rutas) {
  var res = {};
  for (var i = 0; i < rutas.length; i += 20) {
    var lote = rutas.slice(i, i + 20);
    var pedidos = lote.map(function (ruta) {
      var p = HON_api_(cfg, '/contents/' + HON_RUTA_DATOS + '/' + ruta + '?ref=' + encodeURIComponent(cfg.rama), true);
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
function HON_leerBlob_(cfg, ruta, nombre) {
  var r = HON_pedir_(cfg, '/contents/' + HON_RUTA_DATOS + '/' + ruta + '?ref=' + encodeURIComponent(cfg.rama), true);
  return r ? r.getBlob().setName(nombre) : null;
}

/** Empresas de empresas.json (las mismas de SIRE): [{ruc, nombre, activo}] */
function HON_listarEmpresas_(cfg) {
  var r = HON_pedir_(cfg, '/contents/empresas.json?ref=' + encodeURIComponent(cfg.rama), true);
  if (!r) return [];
  var d = JSON.parse(r.getContentText('UTF-8'));
  return (d.empresas || []).map(function (e) {
    return { ruc: String(e.ruc).trim(), nombre: String(e.nombre || '').trim(), activo: e.activo !== false };
  });
}

/** Pide a GitHub que corra la descarga de SUNAT (todas las empresas, mes anterior → mes actual). */
function HON_menuPedirDescarga() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = HON_leerConfig_();
    var hoy = new Date();
    var ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    var desde = Utilities.formatDate(ant, 'America/Lima', 'yyyyMM');
    var p = HON_api_(cfg, '/actions/workflows/honorarios-descargar.yml/dispatches');
    p.method = 'post';
    p.contentType = 'application/json';
    p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: 'todas', periodo: desde, hasta: '', pdf: cfg.bajarPdf ? 'true' : 'false' } });
    var r = UrlFetchApp.fetch(p.url, p);
    if (r.getResponseCode() !== 204) throw new Error('GitHub respondió HTTP ' + r.getResponseCode() +
      ' (el token necesita permiso "Actions: Read and write").');
    ui.alert('⬇ Pedido enviado. GitHub está bajando de SUNAT los recibos por honorarios de ' + desde + ' al mes actual de todas las empresas' +
      (cfg.bajarPdf ? ' (con PDF).' : ' (sin PDF).') + '\n\n' +
      'Tarda unos minutos por empresa. Luego use 🔄 Actualizar todo.');
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}

/** Pide un rango de meses y si se quiere el PDF (para bajar meses antiguos o una sola empresa). */
function HON_menuPedirRango() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = HON_leerConfig_();
    var r1 = ui.prompt('⬇ Recibos por honorarios: rango', 'Meses a bajar, AAAAMM-AAAAMM (ej. 202601-202609). Vacío = desde ' + cfg.desde + ' hasta hoy:', ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return;
    var m = String(r1.getResponseText()).match(/(\d{6})(?:\D+(\d{6}))?/);
    var desde = m ? m[1] : cfg.desde, hasta = m && m[2] ? m[2] : '';
    var empresas = HON_listarEmpresas_(cfg).filter(function (e) { return e.activo; });
    var r2 = ui.prompt('🏢 Empresa', empresas.map(function (e, i) { return (i + 1) + ') ' + e.nombre + ' · ' + e.ruc; }).join('\n') +
      '\n\nNúmero de la empresa (vacío = todas):', ui.ButtonSet.OK_CANCEL);
    if (r2.getSelectedButton() !== ui.Button.OK) return;
    var k = parseInt(r2.getResponseText(), 10);
    var empresa = k >= 1 && k <= empresas.length ? empresas[k - 1].ruc : 'todas';
    var conPdf = ui.alert('📄 PDF', '¿Bajar también el PDF (y XML) de cada recibo?\n\nSÍ = más lento · NO = solo el listado.', ui.ButtonSet.YES_NO) === ui.Button.YES;
    var p = HON_api_(cfg, '/actions/workflows/honorarios-descargar.yml/dispatches');
    p.method = 'post';
    p.contentType = 'application/json';
    p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: empresa, periodo: desde, hasta: hasta, pdf: conPdf ? 'true' : 'false' } });
    var r = UrlFetchApp.fetch(p.url, p);
    if (r.getResponseCode() !== 204) throw new Error('GitHub respondió HTTP ' + r.getResponseCode() + ' (el token necesita permiso "Actions: Read and write").');
    ui.alert('⬇ Pedido enviado: ' + (empresa === 'todas' ? 'todas las empresas' : empresa) + ', ' + desde + ' a ' + (hasta || 'hoy') +
      (conPdf ? ', con PDF.' : ', sin PDF.') + '\n\nTarda unos minutos por empresa. Luego use 🔄 Actualizar todo.');
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}
