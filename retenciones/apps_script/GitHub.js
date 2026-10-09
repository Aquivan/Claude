/**
 * Retenciones · Grupo — GitHub.js
 * Lee del repositorio los archivos que deja el workflow
 * "Retenciones - descargar CRE (SUNAT SOL)":
 *   retenciones/datos/<RUC>/<AAAA>/<MM>/cre.csv | detalle.csv | pdf/*.pdf
 */

var RET_RUTA_DATOS = 'retenciones/datos';

function RET_api_(cfg, ruta, crudo) {
  if (!cfg.token) throw new Error('Falta el token de GitHub: menú 🧾 Retenciones → 🔑 Guardar token de GitHub.');
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

function RET_pedir_(cfg, ruta, crudo) {
  var p = RET_api_(cfg, ruta, crudo);
  var r = UrlFetchApp.fetch(p.url, p);
  var c = r.getResponseCode();
  if (c === 401 || c === 403) throw new Error('GitHub rechazó el token (HTTP ' + c + '). Revise el token con 🔑.');
  if (c === 404) return null;
  if (c >= 300) throw new Error('GitHub respondió HTTP ' + c + ' en ' + ruta);
  return r;
}

/** Lista todos los archivos de retenciones/datos: [{path, sha, size}] (path relativo a datos/). */
function RET_listarArchivos_(cfg) {
  var rama = encodeURIComponent(cfg.rama);
  var r = RET_pedir_(cfg, '/contents/retenciones?ref=' + rama);
  if (!r) throw new Error('No se encontró la carpeta retenciones/ en la rama ' + cfg.rama + '.');
  var datos = JSON.parse(r.getContentText()).filter(function (x) { return x.name === 'datos' && x.type === 'dir'; })[0];
  if (!datos) return [];  // todavía no se descargó nada
  var t = RET_pedir_(cfg, '/git/trees/' + datos.sha + '?recursive=1');
  var arbol = JSON.parse(t.getContentText());
  return (arbol.tree || []).filter(function (x) { return x.type === 'blob'; })
    .map(function (x) { return { path: x.path, sha: x.sha, size: x.size }; });
}

/** Descarga varios archivos de texto a la vez. rutas: relativas a retenciones/datos/. */
function RET_leerTextos_(cfg, rutas) {
  var res = {};
  for (var i = 0; i < rutas.length; i += 20) {
    var lote = rutas.slice(i, i + 20);
    var pedidos = lote.map(function (ruta) {
      var p = RET_api_(cfg, '/contents/' + RET_RUTA_DATOS + '/' + ruta + '?ref=' + encodeURIComponent(cfg.rama), true);
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
function RET_leerBlob_(cfg, ruta, nombre) {
  var r = RET_pedir_(cfg, '/contents/' + RET_RUTA_DATOS + '/' + ruta + '?ref=' + encodeURIComponent(cfg.rama), true);
  return r ? r.getBlob().setName(nombre) : null;
}

/** Empresas de empresas.json (las mismas de SIRE): [{ruc, nombre, activo}] */
function RET_listarEmpresas_(cfg) {
  var r = RET_pedir_(cfg, '/contents/empresas.json?ref=' + encodeURIComponent(cfg.rama), true);
  if (!r) return [];
  var d = JSON.parse(r.getContentText('UTF-8'));
  return (d.empresas || []).map(function (e) {
    return { ruc: String(e.ruc).trim(), nombre: String(e.nombre || '').trim(), activo: e.activo !== false };
  });
}

/** Pide a GitHub que corra la descarga de SUNAT (todas las empresas, mes anterior → mes actual). */
function RET_menuPedirDescarga() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cfg = RET_leerConfig_();
    var hoy = new Date();
    var ant = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    var desde = Utilities.formatDate(ant, 'America/Lima', 'yyyyMM');
    var p = RET_api_(cfg, '/actions/workflows/retenciones-descargar.yml/dispatches');
    p.method = 'post';
    p.contentType = 'application/json';
    p.payload = JSON.stringify({ ref: cfg.rama, inputs: { empresa: 'todas', periodo: desde, hasta: '' } });
    var r = UrlFetchApp.fetch(p.url, p);
    if (r.getResponseCode() !== 204) throw new Error('GitHub respondió HTTP ' + r.getResponseCode() +
      ' (el token necesita permiso "Actions: Read and write").');
    ui.alert('⬇ Pedido enviado. GitHub está bajando de SUNAT los meses ' + desde + ' al actual de todas las empresas.\n\n' +
      'Tarda unos minutos por empresa. Luego use 🔄 Actualizar todo.');
  } catch (e) {
    ui.alert('❌ ' + e.message);
  }
}
