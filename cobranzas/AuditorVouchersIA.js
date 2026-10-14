/**
 * AuditorVouchersIA.js — 🧠 IA PURA para el 🔍 Auditor IA.
 *
 * Lee la hoja de vouchers SOLO en las columnas A–J y la entiende como lo haría
 * una persona a la que se le pega la tabla, sin depender de los encabezados:
 *
 *  1. PERFIL de cada columna por su CONTENIDO (cuántas celdas parecen fecha,
 *     monto, moneda, banco, N° de operación, RUC, nombre, factura…).
 *  2. La IA mira una muestra de filas (más ese perfil) y decide qué es cada
 *     columna, si la fila 1 es encabezado y si las fechas son dd/mm o mm/dd.
 *     Si no hay IA, se usa solo el perfil. El mapa queda guardado: solo se
 *     vuelve a preguntar si cambia la forma de la hoja.
 *  3. Las filas que no se entienden con ese mapa (columnas corridas, datos
 *     pegados en una celda, montos con texto…) se las da a la IA una por una
 *     para que saque fecha, monto, banco, operación, beneficiario, etc.
 *  4. La IA decide A QUIÉN se pagó cada voucher (proveedor de SIRE) y, si la
 *     fila no lo dice, QUÉ EMPRESA del grupo pagó; con la lista de
 *     proveedores, sus facturas pendientes por empresa y el historial de
 *     nombres ya conciliados.
 *  5. Pestaña 🔍 Vouchers leídos: cómo se leyó cada fila (para revisar).
 *
 * Todo lo que responde la IA queda guardado en "_Auditor vouchers IA"
 * (oculta): repetir la auditoría no vuelve a gastar IA en lo ya leído.
 * Funciones AUV_; la usa Auditor.js cuando el motor es "🧠 IA pura".
 */

var AUV_HOJA_ = '🔍 Vouchers leídos';
var AUV_CACHE_ = '_Auditor vouchers IA';
var AUV_COLS_ = 10;                       // A–J
var AUV_LETRAS_ = 'ABCDEFGHIJ'.split('');
var AUV_ROLES_ = ['fecha', 'operacion', 'banco', 'moneda', 'monto', 'beneficiario', 'ruc_beneficiario', 'empresa', 'usuario',
  'descripcion', 'factura', 'imagen', 'otro'];
var AUV_ROL_TXT_ = { fecha: 'Fecha', operacion: 'N° operación', banco: 'Banco', moneda: 'Moneda', monto: 'Monto',
  beneficiario: 'Beneficiario', ruc_beneficiario: 'RUC beneficiario', empresa: 'Empresa que paga', usuario: 'Usuario/cliente',
  descripcion: 'Descripción', factura: 'Factura(s)', imagen: 'Imagen', otro: '—' };
var AUV_IDENT_LOTE_ = 40;                 // vouchers por consulta al identificar proveedor
var AUV_FILAS_LOTE_ = 40;                 // filas raras por consulta
var AUV_MAX_RARAS_ = 240;                 // filas raras que la IA lee por corrida
var AUV_MAX_HOJA_ = 8000;                 // filas en 🔍 Vouchers leídos
var AUV_BANCOS_RE_ = /\b(BCP|BBVA|INTERBANK|SCOTIA\w*|BANBIF|BIF|PICHINCHA|MIBANCO|NACION|BN|CAJA|GNB|FALABELLA|RIPLEY|CITI\w*|ALFIN|YAPE|PLIN|CONTINENTAL|BANCO|CMAC|COMERCIO|CREDITO)\b/i;
var AUV_MONEDA_RE_ = /^(PEN|USD|S\/\.?|US\$|\$|SOLES?|D[OÓ]LARES?|EUR|MN|ME)$/i;
var AUV_MESES_ = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

/* ============================================================ utilidades */

function AUV_txt_(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }

function AUV_mkFecha_(y, mo, d) {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var f = new Date(y, mo - 1, d);
  return f.getMonth() === mo - 1 ? f : null;
}

/** Fecha desde un Date o un texto (dd/mm/yyyy, yyyy-mm-dd, 16-feb-2026, 16 de febrero de 2026…). */
function AUV_fecha_(v, mmdd) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  var s = AUV_txt_(v).toLowerCase();
  if (!s || !/\d/.test(s)) return null;
  var m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return AUV_mkFecha_(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
  if (m) {
    var a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    var d = a, mo = b;
    if (mmdd && a <= 12) { d = b; mo = a; }
    if (mo > 12 && d <= 12) { var t = d; d = mo; mo = t; }
    return AUV_mkFecha_(y, mo, d);
  }
  m = s.match(/(\d{1,2})(?:\s*de\s*|[\s\-\/.])*([a-zñ]{3})[a-zñ]*\.?(?:\s*de(?:l)?\s*|[\s\-\/.,])*(\d{2,4})/);
  if (m && AUV_MESES_[m[2]]) {
    var yy = +m[3];
    if (yy < 100) yy += 2000;
    return AUV_mkFecha_(yy, AUV_MESES_[m[2]], +m[1]);
  }
  return null;
}

/** Monto desde número o texto ("S/ 1,234.50", "1.234,50", "$ 980", "USD 1 200.00"). null si no es monto. */
function AUV_num_(v) {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var s = AUV_txt_(v);
  if (!s || !/\d/.test(s)) return null;
  var sinMoneda = s.replace(/soles?|d[oó]lares?|usd|pen|us\$|s\/\.?|\$|€|eur/ig, '');
  if (/[a-zñ]{2,}/i.test(sinMoneda)) return null;            // tiene palabras: no es un monto
  if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(s)) return null;   // es una fecha
  var t = sinMoneda.replace(/[^\d.,\-]/g, '');
  var lc = t.lastIndexOf(','), lp = t.lastIndexOf('.');
  if (lc > -1 && lp > -1) t = lc > lp ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lc > -1) t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  var n = parseFloat(t);
  return isNaN(n) ? null : n;
}

function AUV_moneda_(v, montoTxt) {
  var s = (AUV_txt_(v) + ' ' + AUV_txt_(montoTxt)).toUpperCase().replace(/S\/\.?/g, ' ');
  if (/US\$|USD|D[OÓ]LAR|\$|\bME\b/.test(s)) return 'USD';
  if (/EUR|€/.test(s)) return 'EUR';
  return 'PEN';
}

/** RUC de la empresa del grupo escrita en una celda (RUC, nombre o alias de ⚙️ Config). */
function AUV_empresaDe_(s, cfg) {
  s = AUV_txt_(s);
  if (!s) return '';
  var ms = s.match(/\d{11}/g) || [];
  for (var i = 0; i < ms.length; i++) if (cfg.grupo.indexOf(ms[i]) !== -1) return ms[i];
  var n = normHeader_(s);
  if (cfg.aliasEmpresa[n]) return cfg.aliasEmpresa[n];
  var ks = Object.keys(cfg.aliasEmpresa);
  for (var k = 0; k < ks.length; k++) {
    if (ks[k].length >= 3 && (' ' + n + ' ').indexOf(' ' + ks[k] + ' ') !== -1) return cfg.aliasEmpresa[ks[k]];
  }
  return '';
}

/** La fila tal como está: "A(fecha)=16/02/2026; B(operacion)=2922; …" (solo celdas con algo). */
function AUV_crudo_(r, columnas) {
  var out = [];
  for (var j = 0; j < AUV_COLS_; j++) {
    var s = AUV_txt_(r[j]);
    if (!s) continue;
    var rol = columnas && columnas[AUV_LETRAS_[j]];
    out.push(AUV_LETRAS_[j] + (rol && rol !== 'otro' ? '(' + rol + ')' : '') + '=' + s.slice(0, 90));
  }
  return out.join('; ');
}

/* ============================================================ memoria */

function AUV_cache_(ss) {
  var sh = ss.getSheetByName(AUV_CACHE_);
  if (!sh) {
    sh = ss.insertSheet(AUV_CACHE_);
    sh.getRange(1, 1, 1, 4).setValues([['Clave', 'Tipo', 'Dato (JSON)', 'Fecha']]);
    sh.hideSheet();
  }
  var map = {};
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
      if (!r[0]) return;
      try { map[r[1] + '|' + r[0]] = JSON.parse(r[2]); } catch (e) { /* fila dañada: se vuelve a preguntar */ }
    });
  }
  return { sh: sh, map: map, nuevos: [] };
}

function AUV_cacheGet_(c, tipo, clave) { return c.map[tipo + '|' + clave]; }

function AUV_cachePut_(c, tipo, clave, x) {
  c.map[tipo + '|' + clave] = x;
  c.nuevos.push([clave, tipo, JSON.stringify(x).slice(0, 45000), new Date()]);
}

function AUV_cacheGuardar_(c) {
  if (!c.nuevos.length) return;
  c.sh.getRange(c.sh.getLastRow() + 1, 1, c.nuevos.length, 4).setValues(c.nuevos);
  c.nuevos = [];
}

/* ===================================================== 1) perfil de columnas */

function AUV_perfil_(filas, j, cfg) {
  var p = { n: 0, fecha: 0, num: 0, dec: 0, ent: 0, simb: 0, moneda: 0, banco: 0, ruc: 0, rucGrupo: 0, empGrupo: 0,
    doc: 0, cod: 0, texto: 0, glosa: 0, url: 0, largo: 0, distintos: 0 };
  var vistos = {};
  filas.forEach(function (r) {
    var s = AUV_txt_(r[j]);
    if (!s) return;
    p.n++; p.largo += s.length; vistos[s.toUpperCase()] = 1;
    if (s.length <= 32 && AUV_fecha_(s) && !/^\d+([.,]\d+)?$/.test(s)) p.fecha++;
    var n = AUV_num_(s);
    if (n != null) {
      p.num++;
      if (/[.,]\d{2}$/.test(s)) p.dec++;
      if (/^\d+$/.test(s)) p.ent++;
      if (/S\/|\$|USD|PEN/i.test(s)) p.simb++;
    }
    if (AUV_MONEDA_RE_.test(s)) p.moneda++;
    if (s.length <= 40 && AUV_BANCOS_RE_.test(s)) p.banco++;
    var dig = s.replace(/\D/g, '');
    if (/^\d{11}$/.test(s.replace(/\s/g, '')) && /^(10|15|16|17|20)/.test(dig)) { p.ruc++; if (cfg.grupo.indexOf(dig) !== -1) p.rucGrupo++; }
    if (AUV_empresaDe_(s, cfg) && s.length <= 40) p.empGrupo++;
    if (/\b[FEB][A-Z0-9]{3}\s*-\s*\d+|\b0[1378]_|factura|\bfact?\b|\bft\b/i.test(s)) p.doc++;
    var sc = s.replace(/^(op(eraci[oó]n)?|nro|n[°º]|no|ref|tx|cod)[.:#\s-]*/i, '');
    if (/^[A-Z0-9\-]{3,24}$/i.test(sc) && (sc.match(/\d/g) || []).length >= 3 && !/[.,]\d{2}$/.test(sc) && !AUV_fecha_(sc)) p.cod++;
    if (/[a-záéíóúñ]{3,}/i.test(s)) p.texto++;
    if (/^(pago|pag\b|dep[oó]sito|dep\b|transf|abono|cargo|cobro|adelanto|anticipo|cancel|fact|pedido|compra|servicio|cuota|devoluc)/i.test(s)) p.glosa++;
    if (/^https?:|drive\.google|cellimage/i.test(s)) p.url++;
  });
  p.distintos = Object.keys(vistos).length;
  return p;
}

function AUV_perfilTxt_(p) {
  if (!p.n) return 'vacía';
  var pct = function (k) { return Math.round(100 * p[k] / p.n); };
  var x = [];
  [['fecha', 'fechas'], ['num', 'números'], ['dec', 'con 2 decimales'], ['moneda', 'monedas'], ['banco', 'bancos'], ['ruc', 'RUC'],
    ['empGrupo', 'empresas del grupo'], ['doc', 'facturas'], ['cod', 'códigos numéricos'], ['texto', 'texto'], ['glosa', 'glosas (pago, depósito…)'], ['url', 'enlaces/imagen']]
    .forEach(function (k) { if (p[k[0]]) x.push(pct(k[0]) + '% ' + k[1]); });
  x.push(Math.round(100 * p.distintos / p.n) + '% valores distintos', 'largo medio ' + Math.round(p.largo / p.n));
  return x.join(', ');
}

/** Letra del tipo que domina la columna (para saber si la hoja cambió de forma). */
function AUV_tipo_(p) {
  if (!p.n) return '-';
  var f = function (k) { return p[k] / p.n; };
  if (f('fecha') > 0.6) return 'F';
  if (f('moneda') > 0.6) return 'M';
  if (f('banco') > 0.6) return 'B';
  if (f('ruc') > 0.6) return 'R';
  if (f('num') > 0.6) return f('dec') > 0.3 ? 'D' : 'N';
  if (f('url') > 0.5) return 'U';
  return f('texto') > 0.5 ? (p.distintos / p.n < 0.15 ? 't' : 'T') : '?';
}

/** Mapa por contenido (sin IA): cada rol a la columna que mejor lo cumple. */
function AUV_mapaHeuristico_(enc, muestra, perf, cfg) {
  var H = (enc || []).map(normHeader_);
  var kw = { fecha: /fecha|date|\bdia\b/, operacion: /oper|n(ro|um)? ?op|transac|referencia|\bref\b|constancia|n(ro)? ?doc banc/, banco: /banco|bank|entidad/,
    moneda: /moneda|divisa|currency/, monto: /monto|importe|total|valor|amount/, beneficiario: /benef|proveedor|destinat|a nombre|pagado a|paid to|payee|supplier/,
    ruc_beneficiario: /ruc|id benef/, empresa: /empresa|idcliente|ordenante|pagador/, usuario: /usuario|cliente|enviado|registr/,
    descripcion: /descr|glosa|concepto|detalle|motivo/, factura: /factura|comprobante|tipo y n/, imagen: /imagen|foto|archivo|link/ };
  var f = function (p, k) { return p.n ? p[k] / p.n : 0; };
  var puntaje = function (rol, p, j) {
    if (!p.n) return 0;
    var uniq = p.distintos / p.n, med = p.largo / p.n, s = 0;
    switch (rol) {
      case 'fecha': s = f(p, 'fecha'); break;
      case 'monto': s = f(p, 'num') * (0.45 + 0.55 * Math.max(f(p, 'dec'), f(p, 'simb'))) * (f(p, 'ent') > 0.9 && med > 6 ? 0.5 : 1); break;
      case 'operacion': s = f(p, 'cod') * (0.5 + 0.5 * uniq) * (1 - f(p, 'dec')) * (1 - f(p, 'ruc')); break;
      case 'moneda': s = f(p, 'moneda'); break;
      case 'banco': s = f(p, 'banco'); break;
      case 'ruc_beneficiario': s = f(p, 'ruc') * (1 - f(p, 'rucGrupo')); break;
      case 'empresa': s = Math.max(f(p, 'rucGrupo'), f(p, 'empGrupo')); break;
      // a quién se paga cambia mucho de fila a fila; quién registra (usuario) se repite
      case 'beneficiario': s = f(p, 'texto') * Math.min(1, uniq / 0.35) * (1 - f(p, 'banco')) * (1 - f(p, 'empGrupo')) * (1 - f(p, 'glosa')) * (1 - f(p, 'url')) * (med >= 5 && med <= 60 ? 1 : 0.6); break;
      case 'usuario': s = f(p, 'texto') * (uniq < 0.3 ? 0.75 : 0.25) * (1 - f(p, 'banco')) * (1 - f(p, 'url')); break;
      case 'descripcion': s = (f(p, 'texto') * 0.45 + f(p, 'glosa') * 0.4 + (med > 25 ? 0.15 : 0)) * (1 - f(p, 'url')); break;
      case 'factura': s = f(p, 'doc'); break;
      case 'imagen': s = f(p, 'url'); break;
    }
    if (H[j] && kw[rol] && kw[rol].test(H[j])) s += 0.5;   // el encabezado ayuda, pero no manda
    return s;
  };
  var cand = [];
  ['fecha', 'monto', 'moneda', 'banco', 'operacion', 'ruc_beneficiario', 'empresa', 'factura', 'beneficiario', 'usuario', 'descripcion', 'imagen']
    .forEach(function (rol, prio) {
      perf.forEach(function (p, j) { var s = puntaje(rol, p, j); if (s >= 0.35) cand.push({ rol: rol, j: j, s: s, prio: prio }); });
    });
  cand.sort(function (a, b) { return b.s - a.s || a.prio - b.prio; });
  var columnas = {}, usado = {};
  AUV_LETRAS_.forEach(function (L) { columnas[L] = 'otro'; });
  cand.forEach(function (c) {
    if (usado[c.rol] || columnas[AUV_LETRAS_[c.j]] !== 'otro') return;
    usado[c.rol] = true; columnas[AUV_LETRAS_[c.j]] = c.rol;
  });
  var mapa = { columnas: columnas, origen: 'contenido', confianza: 0, nota: '' };
  AUV_completarMapa_(mapa, enc, muestra);
  return mapa;
}

/** Encabezado sí/no y formato de fecha (dd/mm o mm/dd) mirando los datos. */
function AUV_completarMapa_(mapa, enc, muestra) {
  var j = function (rol) { var L = Object.keys(mapa.columnas).filter(function (k) { return mapa.columnas[k] === rol; })[0]; return L ? AUV_LETRAS_.indexOf(L) : -1; };
  var jm = j('monto'), jf = j('fecha');
  if (mapa.encabezado == null) {
    var textos = (enc || []).filter(function (c) { return /[a-z]{3,}/i.test(c); }).length;
    mapa.encabezado = textos >= 2 && (jm < 0 || AUV_num_(enc[jm]) == null) && (jf < 0 || !AUV_fecha_(enc[jf]));
  }
  if (!mapa.formato && jf >= 0) {
    var dd = 0, mm = 0;
    muestra.forEach(function (r) {
      var m = AUV_txt_(r[jf]).match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}/);
      if (!m) return;
      if (+m[1] > 12) dd++;
      if (+m[2] > 12) mm++;
    });
    mapa.formato = mm > dd ? 'mm/dd' : 'dd/mm';
  }
  mapa.formato = mapa.formato || 'dd/mm';
}

/* ========================================================= 2) mapa con la IA */

var AUV_SISTEMA_MAPA_ = [
  'Eres experto en datos bancarios y contables de Perú. Te muestro las columnas A a J de una hoja donde se registran vouchers (pagos bancarios)',
  'de un grupo de empresas. La fila 1 puede ser encabezado o ya un dato; los encabezados pueden estar vacíos, mal escritos o no corresponder:',
  'decide por el CONTENIDO de las filas (te doy además un perfil calculado de cada columna).',
  'Asigna a cada columna UN rol: fecha (del depósito/pago), operacion (N° de operación/transacción/constancia), banco, moneda, monto (importe pagado),',
  'beneficiario (a quién se pagó: persona o empresa), ruc_beneficiario, empresa (la empresa del GRUPO que paga: su nombre corto o su RUC),',
  'usuario (quién lo envió / cliente / usuario), descripcion (glosa o concepto), factura (comprobantes que paga, ej. F001-123), imagen (foto o enlace), otro.',
  'Cada rol (menos "otro" e "imagen") va en UNA sola columna. Columna vacía = "otro". Indica el formato de las fechas: "dd/mm" (lo normal en Perú) o "mm/dd".',
  'Responde SOLO JSON: {"encabezado":true,"columnas":{"A":"fecha","B":"operacion","C":"banco","D":"moneda","E":"monto","F":"beneficiario","G":"empresa","H":"usuario","I":"descripcion","J":"imagen"},',
  ' "formato_fecha":"dd/mm","confianza":0,"nota":""}',
  '"confianza" 0-100. "nota": máx. 25 palabras con lo raro que viste (columnas corridas, montos con texto, etc.).',
].join('\n');

function AUV_textoMapa_(nombre, disp, perf, heur, cfg, idx) {
  var L = [];
  L.push('PESTAÑA: ' + nombre + ' (' + disp.length + ' filas)');
  L.push('EMPRESAS DEL GRUPO (RUC | nombre): ' + cfg.grupo.map(function (r) { return r + ' | ' + cfg.nombreEmpresa[r]; }).join(' ; '));
  L.push('');
  L.push('PERFIL CALCULADO DE CADA COLUMNA (sobre ' + idx.length + ' filas):');
  perf.forEach(function (p, j) { L.push(AUV_LETRAS_[j] + ': ' + AUV_perfilTxt_(p)); });
  L.push('');
  L.push('FILAS DE MUESTRA (fila | A | B | C | D | E | F | G | H | I | J):');
  var filas = [0].concat(idx.slice(0, 8), idx.slice(Math.floor(idx.length / 2), Math.floor(idx.length / 2) + 6), idx.slice(-6));
  var vistas = {};
  filas.forEach(function (i) {
    if (vistas[i] || !disp[i]) return;
    vistas[i] = true;
    L.push((i + 1) + ' | ' + disp[i].slice(0, AUV_COLS_).map(function (c) { return AUV_txt_(c).slice(0, 60); }).join(' | '));
  });
  L.push('');
  L.push('Lectura automática (puede estar mal): ' + AUV_LETRAS_.map(function (k) { return k + '=' + heur.columnas[k]; }).join(', '));
  return L.join('\n');
}

function AUV_validarMapa_(r, muestra) {
  var cols = r && r.columnas;
  if (!cols || typeof cols !== 'object') return null;
  var sin = { 'operación': 'operacion', 'descripción': 'descripcion', 'ruc beneficiario': 'ruc_beneficiario', 'ruc': 'ruc_beneficiario',
    'importe': 'monto', 'glosa': 'descripcion', 'concepto': 'descripcion', 'proveedor': 'beneficiario', 'cliente': 'usuario' };
  var out = {}, usado = {};
  AUV_LETRAS_.forEach(function (L) {
    var rol = String(cols[L] || cols[L.toLowerCase()] || 'otro').toLowerCase().trim();
    rol = sin[rol] || rol.replace(/\s+/g, '_');
    if (AUV_ROLES_.indexOf(rol) === -1) rol = 'otro';
    if (rol !== 'otro' && rol !== 'imagen' && usado[rol]) rol = 'otro';
    usado[rol] = true;
    out[L] = rol;
  });
  if (!usado.monto) return null;
  var jm = AUV_LETRAS_.indexOf(Object.keys(out).filter(function (k) { return out[k] === 'monto'; })[0]);
  var llenas = muestra.filter(function (f) { return AUV_txt_(f[jm]); });
  var buenas = llenas.filter(function (f) { return AUV_num_(f[jm]) != null; }).length;
  if (llenas.length >= 5 && buenas / llenas.length < 0.6) return null;   // la IA eligió mal el monto
  return { columnas: out, encabezado: r.encabezado === true || r.encabezado === 'true', formato: /mm\s*\/\s*dd/i.test(String(r.formato_fecha || '')) ? 'mm/dd' : 'dd/mm',
    origen: 'IA', confianza: Math.max(0, Math.min(100, parseInt(r.confianza, 10) || 0)), nota: String(r.nota || '').slice(0, 200) };
}

/** Mapa de columnas de una pestaña: guardado, o la IA lo decide, o por contenido. */
function AUV_mapa_(nombre, disp, cfg, ia, cont, cache) {
  var idx = [];
  var paso = Math.max(1, Math.floor((disp.length - 1) / 400));
  for (var i = 1; i < disp.length; i += paso) if (disp[i].some(function (c) { return AUV_txt_(c); })) idx.push(i);
  var muestra = idx.map(function (i) { return disp[i]; });
  var perf = [];
  for (var j = 0; j < AUV_COLS_; j++) perf.push(AUV_perfil_(muestra, j, cfg));
  var heur = AUV_mapaHeuristico_(disp[0], muestra, perf, cfg);
  var clave = hashTexto_(nombre + '|' + disp[0].slice(0, AUV_COLS_).join('¦') + '|' + perf.map(AUV_tipo_).join(''));
  var guardado = AUV_cacheGet_(cache, 'mapa', clave);
  if (guardado) return guardado;
  var mapa = heur;
  if (ia && ia.clave) {
    try {
      cont.consultas++;
      var r = IA_llamar_({ proveedor: ia.proveedor, modelo: ia.modelo, clave: ia.clave, sistema: AUV_SISTEMA_MAPA_,
        texto: AUV_textoMapa_(nombre, disp, perf, heur, cfg, idx), maxTokens: 1500 });
      var m = AUV_validarMapa_(r, muestra);
      if (m) {
        AUV_completarMapa_(m, disp[0], muestra);
        mapa = m;
        AUV_cachePut_(cache, 'mapa', clave, m);
        AUV_cacheGuardar_(cache);
      } else {
        heur.nota = 'La IA no dio un mapa coherente: se leyó por contenido.';
      }
    } catch (e) {
      cont.errores++; cont.ultimoError = e.message;
      heur.nota = 'La IA no respondió (' + String(e.message).slice(0, 60) + '): se leyó por contenido.';
    }
  }
  return mapa;
}

/* ================================================ 3) filas que la IA interpreta */

var AUV_SISTEMA_FILAS_ = [
  'Eres experto en vouchers bancarios de Perú. Te doy filas de una hoja de vouchers (columnas A–J; entre paréntesis el rol que suele tener',
  'cada columna) que NO se pudieron leer de forma automática: columnas corridas, datos pegados en una sola celda, montos con texto, fechas raras.',
  'Para cada fila saca los datos del pago leyendo TODAS sus celdas. Si la fila NO es un voucher (título, total, nota, fila sin monto), "es_voucher": false.',
  'fecha en dd/mm/yyyy. monto como número (sin S/, sin comas de miles). moneda PEN o USD. No inventes datos que no estén en la fila.',
  'Responde SOLO JSON: {"filas":[{"fila":12,"es_voucher":true,"fecha":"dd/mm/yyyy","monto":0,"moneda":"PEN","banco":"","operacion":"",',
  '"beneficiario":"","empresa":"","usuario":"","descripcion":"","factura":""}]}',
].join('\n');

function AUV_interpretarFilas_(nombre, raras, mapa, ia, cont, cache, deadline, estad) {
  var res = [];
  var preguntar = [];
  raras.forEach(function (x) {
    x.k = hashTexto_(nombre + '|' + x.r.slice(0, AUV_COLS_).join('¦'));
    var c = AUV_cacheGet_(cache, 'fila', x.k);
    if (c) { x.ia = c; res.push(x); } else preguntar.push(x);
  });
  if (!(ia && ia.clave)) { estad.sinLeer += preguntar.length; return res; }
  var hechas = 0;
  for (var i = 0; i < preguntar.length; i += AUV_FILAS_LOTE_) {
    if ((i > 0 && Date.now() > deadline) || estad.leidasIA >= AUV_MAX_RARAS_) { estad.pendientes += preguntar.length - i; break; }
    var lote = preguntar.slice(i, i + AUV_FILAS_LOTE_);
    try {
      if (cont.consultas) Utilities.sleep(IA_PROVEEDORES_[ia.proveedor].pausa);
      cont.consultas++;
      var r = IA_llamar_({ proveedor: ia.proveedor, modelo: ia.modelo, clave: ia.clave, sistema: AUV_SISTEMA_FILAS_, maxTokens: 8000,
        texto: 'PESTAÑA: ' + nombre + '\nFILAS:\n' + lote.map(function (x) { return 'fila ' + (x.i + 1) + ': ' + AUV_crudo_(x.r, mapa.columnas); }).join('\n') });
      var porFila = {};
      (Array.isArray(r.filas) ? r.filas : []).forEach(function (f) { porFila[parseInt(f.fila, 10)] = f; });
      lote.forEach(function (x) {
        var f = porFila[x.i + 1] || { es_voucher: false, nota: 'la IA no la devolvió' };
        AUV_cachePut_(cache, 'fila', x.k, f);
        x.ia = f; res.push(x); hechas++;
      });
      estad.leidasIA += lote.length;
      AUV_cacheGuardar_(cache);
    } catch (e) {
      cont.errores++; cont.ultimoError = e.message;
      estad.sinLeer += preguntar.length - i;
      break;
    }
  }
  return res;
}

/* =============================================== lectura completa de A–J */

function AUV_pago_(nombre, i, x, crudo, cfg) {
  var op = String(x.operacion == null ? '' : x.operacion).trim().replace(/^(op(eraci[oó]n)?|nro|n[°º]|ref|tx)[.:#\s-]+/i, '');
  var banco = AUV_txt_(x.banco);
  var monto = Math.abs(x.monto);
  var emp = AUV_empresaDe_(x.empresa, cfg) || AUV_empresaDe_(x.usuario, cfg);
  return {
    id: [banco.toUpperCase(), op, fmtFechaClave_(x.fecha), monto.toFixed(2)].join('|'),
    fecha: x.fecha, monto: monto, moneda: x.moneda || 'PEN', pagadorRuc: emp, _empComo: emp ? 'fila A–J' : '',
    beneficiarioRuc: aRuc_(x.rucBenef), beneficiarioNombre: AUV_txt_(x.beneficiario), refs: AUV_txt_(x.factura),
    banco: banco, operacion: op, modalidad: MODALIDAD.PAGO, fuente: nombre + '!' + (i + 1),
    descripcion: AUV_txt_(x.descripcion), enviadoPor: '', usuario: AUV_txt_(x.usuario), crudo: crudo,
  };
}

function AUV_leerPestana_(sh, nombre, cfg, ia, cont, cache, deadline, estad) {
  var last = sh.getLastRow();
  var nc = Math.min(AUV_COLS_, Math.max(1, sh.getLastColumn()));
  var disp = sh.getRange(1, 1, last, Math.min(nc, 9)).getDisplayValues();
  // J: se lee solo si trae texto (si es la imagen del voucher no se toca: hace lenta la hoja).
  if (nc >= 10) {
    var mj = sh.getRange(1, 10, Math.min(last, 40), 1).getDisplayValues();
    var conTexto = mj.filter(function (r) { var s = AUV_txt_(r[0]); return s && !/^(cellimage|https?:)/i.test(s); }).length;
    if (conTexto >= 3) {
      var cj = sh.getRange(1, 10, last, 1).getDisplayValues();
      disp.forEach(function (r, i) { r.push(cj[i][0]); });
    }
  }
  disp.forEach(function (r) { while (r.length < AUV_COLS_) r.push(''); });
  var mapa = AUV_mapa_(nombre, disp, cfg, ia, cont, cache);
  mapa.pestana = nombre;
  var col = {};
  Object.keys(mapa.columnas).forEach(function (L) {
    var rol = mapa.columnas[L];
    if (rol !== 'otro' && rol !== 'imagen') col[rol] = AUV_LETRAS_.indexOf(L);
  });
  // Fechas, montos y N° de operación tal como están guardados (fecha real, número real).
  var crudoDe = function (rol) { return col[rol] != null ? sh.getRange(1, col[rol] + 1, last, 1).getValues() : null; };
  var vF = crudoDe('fecha'), vM = crudoDe('monto'), vO = crudoDe('operacion');
  var mmdd = mapa.formato === 'mm/dd';
  var pagos = [], raras = [];
  for (var i = mapa.encabezado ? 1 : 0; i < disp.length; i++) {
    var r = disp[i];
    var llenas = r.filter(function (c) { return AUV_txt_(c); }).length;
    if (!llenas) continue;
    var g = function (rol) { return col[rol] != null ? r[col[rol]] : ''; };
    var fecha = AUV_fecha_(vF && vF[i][0] instanceof Date ? vF[i][0] : g('fecha'), mmdd);
    var montoTxt = g('monto');
    var monto = vM && typeof vM[i][0] === 'number' ? vM[i][0] : AUV_num_(montoTxt);
    var crudo = AUV_crudo_(r, mapa.columnas);
    if (!monto || !fecha) {
      // ¿Puede ser un voucher mal acomodado? (varias celdas con algún número con pinta de monto,
      // o todo pegado en una celda con fecha y monto)
      var todo = r.join(' ');
      if ((llenas >= 3 && /\d[.,]\d{2}\b|\d{3,}/.test(todo)) || (AUV_fecha_(todo) && /\d[.,]\d{2}\b/.test(todo))) raras.push({ i: i, r: r });
      continue;
    }
    pagos.push(AUV_pago_(nombre, i, {
      fecha: fecha, monto: monto, moneda: AUV_moneda_(g('moneda'), montoTxt), banco: g('banco'),
      operacion: vO && typeof vO[i][0] === 'number' ? String(vO[i][0]) : g('operacion'),
      beneficiario: g('beneficiario'), rucBenef: g('ruc_beneficiario'), descripcion: g('descripcion'), factura: g('factura'),
      empresa: g('empresa'), usuario: g('usuario'),
    }, crudo, cfg));
  }
  estad.raras += raras.length;
  AUV_interpretarFilas_(nombre, raras, mapa, ia, cont, cache, deadline, estad).forEach(function (x) {
    var f = x.ia || {};
    var fecha = AUV_fecha_(f.fecha), monto = AUV_num_(f.monto);
    if (!f.es_voucher || !fecha || !monto) { estad.noVoucher++; return; }
    var p = AUV_pago_(nombre, x.i, {
      fecha: fecha, monto: monto, moneda: /USD|\$|DOL/i.test(String(f.moneda)) ? 'USD' : 'PEN', banco: f.banco, operacion: f.operacion,
      beneficiario: f.beneficiario, rucBenef: '', descripcion: f.descripcion, factura: f.factura, empresa: f.empresa, usuario: f.usuario,
    }, AUV_crudo_(x.r, null), cfg);   // sin etiquetas: en esta fila las columnas no siguen el mapa
    p._filaIA = true;
    pagos.push(p);
    estad.porIA++;
  });
  mapa.leidos = pagos.length;
  return { pagos: pagos, mapa: mapa };
}

/**
 * Para el cálculo de Cobranzas (leerVouchers_): una pestaña sin los encabezados de siempre
 * se lee igual, A–J, con el mapa que ya decidió la IA (si existe) o por contenido.
 * Aquí no se llama a la IA (corre cada 10 minutos); solo se usa lo que ya respondió.
 */
function AUV_leerParaMotor_(sh, nombre, cfg) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var cache = ss && ss.getSheetByName(AUV_CACHE_) ? AUV_cache_(ss) : { map: {}, nuevos: [] };
    var estad = { raras: 0, porIA: 0, leidasIA: 0, noVoucher: 0, sinLeer: 0, pendientes: 0 };
    return AUV_leerPestana_(sh, nombre, cfg, null, { consultas: 0, errores: 0 }, cache, 0, estad).pagos;
  } catch (e) {
    console.warn('Vouchers ' + nombre + ': no se pudo leer sin encabezados: ' + e.message);
    return [];
  }
}

/** Lee todas las pestañas de vouchers (A–J) y junta los repetidos (Originales manda). */
function AUV_leer_(cfg, ia, cont, cache, deadline) {
  var res = { pagos: [], duplicados: [], mapas: [], estad: { raras: 0, porIA: 0, leidasIA: 0, noVoucher: 0, sinLeer: 0, pendientes: 0 } };
  if (!cfg.idVouchers) return res;
  var libro = SpreadsheetApp.openById(cfg.idVouchers);
  var pestanas = cfg.pestanasVouchers.slice().sort(function (a, b) {
    return (/original/i.test(b) ? 1 : 0) - (/original/i.test(a) ? 1 : 0);
  });
  var porClave = {};
  pestanas.forEach(function (nombre) {
    var sh = libro.getSheetByName(nombre);
    if (!sh || sh.getLastRow() < 1) return;
    var t = AUV_leerPestana_(sh, nombre, cfg, ia, cont, cache, deadline, res.estad);
    res.mapas.push(t.mapa);
    t.pagos.forEach(function (p) {
      var clave = p.operacion ? [p.banco.toUpperCase(), p.operacion, p.monto.toFixed(2)].join('|') : p.id;
      var previo = (porClave[clave] || []).filter(function (q) {
        return !q.fecha || !p.fecha || Math.abs(q.fecha.getTime() - p.fecha.getTime()) <= 5 * 86400000;
      })[0];
      if (previo) {
        if (!previo.pagadorRuc && p.pagadorRuc) { previo.pagadorRuc = p.pagadorRuc; previo._empComo = 'fila repetida ' + p.fuente; }
        if (!previo.refs && p.refs) previo.refs = p.refs;
        res.duplicados.push({ id: p.id, fuente: p.fuente, otra: previo.fuente, p: p });
        return;
      }
      (porClave[clave] = porClave[clave] || []).push(p);
      res.pagos.push(p);
    });
  });
  return res;
}

/* ============================================ 4) a quién se pagó (la IA) */

var AUV_SISTEMA_IDENT_ = [
  'Eres contador y auditor en Perú. Para cada voucher bancario (te doy la FILA tal como está en la hoja, columnas A–J) decide:',
  '1) "ruc": a qué PROVEEDOR de la lista se le pagó. Los nombres pueden venir mal escritos, abreviados, con el nombre comercial, sin S.A.C./E.I.R.L.,',
  '   con palabras pegadas, o el beneficiario puede estar en la descripción. Usa el HISTORIAL (nombres que ya se conciliaron antes con un RUC)',
  '   y los MONTOS: si el monto calza con facturas pendientes de un proveedor en esa empresa (total, suma de varias, o neto de retención 3% /',
  '   detracción 4-10-12%), es mucho más probable.',
  '2) "empresa": qué empresa del GRUPO pagó, SOLO si el voucher dice "empresa: ?" (deducirlo del usuario, cliente, descripción o cuenta).',
  '3) "categoria": proveedor | entre empresas del grupo | planilla/personal | impuestos/SUNAT/AFP | banco/comisión | préstamo/financiero | otro.',
  'Elige SOLO RUC de la lista de proveedores o de las empresas del grupo. Si no es ninguno, deja "ruc" vacío y pon la categoría. No inventes.',
  'Responde SOLO JSON: {"vouchers":[{"v":"V1","ruc":"","empresa":"","categoria":"proveedor","confianza":0,"motivo":""}]}',
  '"confianza" 0-100. "motivo" máx. 18 palabras (ej. "REQUIVA = INVERSIONES REQUIVA E.I.R.L.; monto = 2 facturas pendientes").',
].join('\n');

/** Proveedores de SIRE con sus pendientes por empresa (y algunos montos, para que la IA pueda cruzar por monto). */
function AUV_directorio_(docs, cfg, limite) {
  var dir = {};
  docs.forEach(function (d) {
    if (!d.provRuc || cfg.grupo.indexOf(d.provRuc) !== -1) return;
    var x = dir[d.provRuc] = dir[d.provRuc] || { ruc: d.provRuc, nombre: '', saldo: 0, porEmp: {} };
    if (!x.nombre && d.prov) x.nombre = d.prov;
    if (d.saldo <= 0.5) return;
    x.saldo += d.saldo;
    var e = x.porEmp[d.empresa] = x.porEmp[d.empresa] || { n: 0, s: 0, m: [] };
    e.n++; e.s += d.saldo;
    if (e.m.length < 6) e.m.push((d.moneda === 'USD' ? '$' : '') + d.saldo.toFixed(2));
  });
  var lista = Object.keys(dir).map(function (r) { return dir[r]; }).sort(function (a, b) { return b.saldo - a.saldo; }).slice(0, limite);
  return {
    validos: lista.reduce(function (o, d) { o[d.ruc] = true; return o; }, {}),
    texto: lista.map(function (d) {
      var emps = Object.keys(d.porEmp);
      return d.ruc + ' | ' + (d.nombre || '(sin nombre en SIRE)') + ' | ' + (emps.length ? emps.map(function (e) {
        var x = d.porEmp[e];
        return e + ' ' + x.n + ' fact. S/ ' + Math.round(x.s) + ' (' + x.m.join(', ') + (x.n > x.m.length ? ', …' : '') + ')';
      }).join('; ') : 'sin pendientes');
    }).join('\n'),
  };
}

/** Nombres escritos en vouchers que ya se conciliaron (y alias de ⚙️ Config) → RUC. */
function AUV_historial_(pagos, cfg) {
  var h = {};
  pagos.forEach(function (p) {
    if (!p._apl || !p._apl.length || !p._apl[0].provRuc || !p.beneficiarioNombre) return;
    h[normNombre_(p.beneficiarioNombre)] = { txt: p.beneficiarioNombre, ruc: p._apl[0].provRuc };
  });
  Object.keys(cfg.aliasNombre).forEach(function (n) { if (cfg.aliasNombre[n] && !h[n]) h[n] = { txt: n, ruc: cfg.aliasNombre[n] }; });
  return Object.keys(h).slice(0, 500).map(function (n) { return '"' + h[n].txt + '" → ' + h[n].ruc; }).join('\n');
}

function AUV_aplicarIdent_(p, x, cfg) {
  if (!p.pagadorRuc && x.empresa) { p.pagadorRuc = x.empresa; p._empComo = 'IA'; }
  p._cat = x.categoria || '';
  if (x.ruc) { p._prov = x.ruc; p._como = 'IA ' + x.confianza + '%: ' + x.motivo; }
  else p._como = 'IA: ' + (x.motivo || 'no es un proveedor de la lista');
}

/**
 * La IA decide el proveedor (y la empresa si falta) de los vouchers por
 * conciliar. Lo ya respondido se reusa. Devuelve cuántos faltan (por tiempo).
 */
function AUV_identificar_(lista, ctx) {
  var cfg = ctx.cfg, ia = ctx.ia, cache = ctx.cache, cont = ctx.cont;
  var hayIA = !!(ia && ia.clave);
  var preguntar = [], res = { hechos: 0, faltan: 0 };
  lista.forEach(function (p) {
    p._kIdent = hashTexto_(p.crudo + '|' + (p.pagadorRuc || '?'));
    var c = AUV_cacheGet_(cache, 'ident', p._kIdent);
    var reintentar = c && !c.ruc && c.t && Date.now() - c.t > 3 * 86400000;   // sin proveedor: se reintenta a los 3 días (pudo llegar la factura)
    if (c && !(reintentar && hayIA)) { AUV_aplicarIdent_(p, c, cfg); res.hechos++; return; }
    if (hayIA) { preguntar.push(p); return; }
    var det = CIA_detectarRuc_(p, { porCobrar: false }, cfg, ctx.nombres);   // sin IA: solo parecido de nombres
    p._prov = det.ruc; p._como = 'sin IA: ' + det.como;
  });
  if (!preguntar.length) return res;
  var gemini = IA_PROVEEDORES_[ia.proveedor].tipo === 'gemini';
  var dir = AUV_directorio_(ctx.docs, cfg, gemini ? 600 : 250);
  var hist = AUV_historial_(ctx.pagos, cfg);
  var grupo = cfg.grupo.map(function (r) { return r + ' | ' + cfg.nombreEmpresa[r]; }).join('\n');
  var cabeza = ['EMPRESAS DEL GRUPO (RUC | nombre):', grupo, '', 'PROVEEDORES (RUC | razón social | facturas pendientes por empresa: cantidad, saldo y montos):', dir.texto,
    '', 'HISTORIAL (nombre escrito en vouchers ya conciliados → RUC):', hist || '(vacío)', ''].join('\n');
  for (var i = 0; i < preguntar.length; i += AUV_IDENT_LOTE_) {
    if (i > 0 && Date.now() > ctx.deadline) { res.faltan = preguntar.length - i; preguntar.slice(i).forEach(function (p) { p._pendIdent = true; }); break; }
    var lote = preguntar.slice(i, i + AUV_IDENT_LOTE_);
    try {
      if (cont.consultas) Utilities.sleep(IA_PROVEEDORES_[ia.proveedor].pausa);
      cont.consultas++;
      var r = IA_llamar_({ proveedor: ia.proveedor, modelo: ia.modelo, clave: ia.clave, sistema: AUV_SISTEMA_IDENT_, maxTokens: 8000,
        texto: cabeza + 'VOUCHERS:\n' + lote.map(function (p, k) {
          return 'V' + (k + 1) + ' | empresa: ' + (p.pagadorRuc ? cfg.nombreEmpresa[p.pagadorRuc] + ' (' + p.pagadorRuc + ')' : '?') +
            ' | leído: ' + IA_fmtFecha_(p.fecha) + ' ' + p.moneda + ' ' + p.monto.toFixed(2) + (p.beneficiarioNombre ? ' · beneficiario: ' + p.beneficiarioNombre : '') +
            ' | fila ' + p.fuente + ': ' + p.crudo;
        }).join('\n') });
      var porV = {};
      (Array.isArray(r.vouchers) ? r.vouchers : []).forEach(function (a) {
        var k = parseInt(String(a.v || '').replace(/\D/g, ''), 10) - 1;
        if (k >= 0 && k < lote.length) porV[k] = a;
      });
      lote.forEach(function (p, k) {
        var a = porV[k] || {};
        var ruc = aRuc_(a.ruc), emp = aRuc_(a.empresa);
        var x = { ruc: dir.validos[ruc] || cfg.grupo.indexOf(ruc) !== -1 ? ruc : '', empresa: cfg.grupo.indexOf(emp) !== -1 ? emp : '',
          categoria: String(a.categoria || '').slice(0, 40), confianza: Math.max(0, Math.min(100, parseInt(a.confianza, 10) || 0)),
          motivo: String(a.motivo || (porV[k] ? '' : 'la IA no respondió este voucher')).slice(0, 160), t: Date.now() };
        if (ruc && !x.ruc) x.motivo = 'RUC ' + ruc + ' no está en la lista · ' + x.motivo;
        AUV_cachePut_(cache, 'ident', p._kIdent, x);
        AUV_aplicarIdent_(p, x, cfg);
        res.hechos++;
      });
      AUV_cacheGuardar_(cache);
    } catch (e) {
      // La IA falló (cuota, red): lo que falta se resuelve por parecido de nombres, sin quedarse en bucle.
      cont.errores++; cont.ultimoError = e.message;
      preguntar.slice(i).forEach(function (p) {
        var det = CIA_detectarRuc_(p, { porCobrar: false }, cfg, ctx.nombres);
        p._prov = det.ruc; p._como = 'IA no respondió; por nombre: ' + det.como;
      });
      break;
    }
  }
  return res;
}

/**
 * Lo que necesita el Auditor en modo IA pura: vouchers leídos de A–J, ya
 * marcados como aplicados (por Cobranzas) o con su proveedor según la IA.
 */
function AUV_preparar_(ss, cfg, par, ia, cont, docs, movs, nombres, deadline) {
  var cache = AUV_cache_(ss);
  var lect = AUV_leer_(cfg, ia, cont, cache, deadline);
  // Enlace con lo que ya lee Cobranzas (misma fila): así el voucher conserva su ID de pago y,
  // si en A–J no figura la empresa que paga, se toma la que ya tiene Cobranzas.
  var motor = leerVouchers_(cfg);
  var porFuente = {};
  motor.pagos.forEach(function (m) { porFuente[m.fuente] = m; });
  motor.duplicados.forEach(function (d) {
    var m = motor.pagos.filter(function (x) { return x.fuente === d.otra; })[0];
    if (m) porFuente[d.fuente] = m;
  });
  lect.pagos.forEach(function (p) {
    var m = porFuente[p.fuente];
    if (m && Math.abs(m.monto - p.monto) < 0.01) {
      p.id = m.id;
      if (!p.pagadorRuc && m.pagadorRuc) { p.pagadorRuc = m.pagadorRuc; p._empComo = 'Cobranzas (fuera de A–J)'; }
      p.enviadoPor = m.enviadoPor || '';
      if (!p.usuario) p.usuario = m.usuario || '';
    } else if (p._filaIA) {
      p._nota = 'fila leída solo por la IA: complétela en Vouchers para que Cobranzas la cuente';
    }
    var apl = movs.porPago[p.id];
    if (apl && apl.length && apl[0].provRuc) { p._apl = apl; p._prov = apl[0].provRuc; p._como = 'ya aplicado'; }
  });
  // Por conciliar dentro de los filtros: a quién se pagó
  var lista = lect.pagos.filter(function (p) {
    if (p._apl) return false;
    if (p.pagadorRuc && (cfg.grupo.indexOf(p.pagadorRuc) === -1 || (par.empresaRuc && p.pagadorRuc !== par.empresaRuc))) return false;
    if (!AUD_enFechas_(par, p.fecha) || (par.quien && AUD_quien_(p) !== par.quien)) return false;
    if (p.beneficiarioRuc) { p._prov = p.beneficiarioRuc; p._como = 'RUC escrito en la fila'; return false; }
    var alias = cfg.aliasNombre[normNombre_(p.beneficiarioNombre)];
    if (alias) { p._prov = alias; p._como = 'alias confirmado en ⚙️ Config'; return false; }
    return true;
  });
  var id = AUV_identificar_(lista, { cfg: cfg, ia: ia, cache: cache, cont: cont, deadline: deadline, docs: docs, nombres: nombres, pagos: lect.pagos });
  lect.identPend = id.faltan;
  lect.identHechos = id.hechos;
  lect.porIdentificar = lista.length;
  return lect;
}

/* ========================================= 5) pestaña 🔍 Vouchers leídos */

var AUV_ENC_ = ['Fila (hoja!fila)', 'Fecha', 'Banco', 'N° operación', 'Moneda', 'Monto', 'Beneficiario (como está escrito)', 'Empresa que paga',
  'De dónde salió la empresa', 'Proveedor según la IA', 'RUC', 'Cómo lo identificó', 'Categoría', 'Estado', 'Fila original (A–J)'];

function AUV_textoMapas_(mapas) {
  return mapas.map(function (m) {
    var cols = AUV_LETRAS_.filter(function (L) { return m.columnas[L] && m.columnas[L] !== 'otro'; })
      .map(function (L) { return L + '=' + AUV_ROL_TXT_[m.columnas[L]]; }).join(' · ');
    return m.pestana + ': ' + cols + '  (fila 1 ' + (m.encabezado ? 'es encabezado' : 'ya es dato') + ' · fechas ' + m.formato + ' · ' +
      (m.origen === 'IA' ? 'columnas reconocidas por la IA ' + m.confianza + '%' : 'columnas reconocidas por su contenido') +
      (m.nota ? ' · ' + m.nota : '') + ' · ' + (m.leidos || 0) + ' vouchers)';
  }).join('\n');
}

function AUV_escribirHoja_(ss, a, cfg, par) {
  var L = a.leidos;
  if (!L) return;
  var sh = ss.getSheetByName(AUV_HOJA_);
  if (!sh) {
    sh = ss.insertSheet(AUV_HOJA_);
    var base = ss.getSheetByName(AUD_HOJA_HALL_) || ss.getSheetByName(AUD_HOJA_);
    if (base) { ss.setActiveSheet(sh); ss.moveActiveSheet(base.getIndex() + 1); }
  }
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.getRange(1, 1, 1, 10).merge().setValue('🔍  VOUCHERS LEÍDOS POR LA IA · solo columnas A–J de la hoja de vouchers').setFontSize(14).setFontWeight('bold')
    .setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
  sh.getRange(2, 1, 1, 15).merge().setValue('Cómo se entendió cada pestaña (no importa el nombre de los encabezados):\n' + AUV_textoMapas_(L.mapas))
    .setWrap(true).setFontSize(9).setVerticalAlignment('top').setBackground('#F8FAFC');
  sh.setRowHeight(2, 22 + 16 * Math.max(1, L.mapas.length));
  var nombreEmp = function (r) { return r ? (cfg.nombreEmpresa[r] || r) : ''; };
  var filas = [];
  var enFiltro = function (p) {
    if (p.pagadorRuc && par.empresaRuc && p.pagadorRuc !== par.empresaRuc) return false;
    return AUD_enFechas_(par, p.fecha) && (!par.quien || AUD_quien_(p) === par.quien);
  };
  L.pagos.forEach(function (p) {
    if (!enFiltro(p)) return;
    var estado;
    if (p._apl) estado = '✔ Ya aplicado: ' + p._apl.map(function (m) { return m.doc + ' ' + m.monto.toFixed(2); }).join(', ');
    else if (!p.pagadorRuc) estado = '⚠️ No se sabe qué empresa pagó';
    else if (cfg.grupo.indexOf(p.pagadorRuc) === -1) estado = '— No es de una empresa del grupo';
    else if (p._prov && cfg.grupo.indexOf(p._prov) !== -1) estado = '↔ Entre empresas del grupo';
    else if (p._prov) estado = '🟡 Por conciliar (en el Auditor)';
    else if (p._pendIdent) estado = '⏳ Falta identificar (la IA sigue)';
    else estado = '❔ Sin proveedor de SIRE' + (p._cat ? ' (' + p._cat + ')' : '');
    if (p._nota) estado += ' · ' + p._nota;
    filas.push([p.fuente, p.fecha || '', p.banco, p.operacion, p.moneda, p.monto, p.beneficiarioNombre, nombreEmp(p.pagadorRuc) || '❔',
      p._empComo || '', p._prov ? (a.nombres[p._prov] || nombreEmp(p._prov)) : '', p._prov || '', p._como || '', p._cat || '', estado, p.crudo]);
  });
  L.duplicados.forEach(function (d) {
    var p = d.p;
    if (!enFiltro(p)) return;
    filas.push([p.fuente, p.fecha || '', p.banco, p.operacion, p.moneda, p.monto, p.beneficiarioNombre, nombreEmp(p.pagadorRuc), p._empComo || '',
      '', '', '', '', '⧉ Repetido de ' + d.otra + ' (se cuenta una vez)', p.crudo]);
  });
  filas.sort(function (x, y) { return (y[1] || 0) - (x[1] || 0); });
  var total = filas.length;
  filas = filas.slice(0, AUV_MAX_HOJA_);
  var cuenta = function (re) { return filas.filter(function (f) { return re.test(f[13]); }).length; };
  var e = L.estad;
  sh.getRange(3, 1, 1, 15).merge().setValue(total + ' vouchers en los filtros' + (total > filas.length ? ' (se muestran ' + filas.length + ')' : '') + ' · ✔ aplicados ' +
    cuenta(/^✔/) + ' · 🟡 por conciliar ' + cuenta(/^🟡/) + ' · ❔ sin proveedor ' + cuenta(/^❔/) + ' · ↔ entre empresas ' + cuenta(/^↔/) +
    ' · ⚠️ sin empresa ' + cuenta(/^⚠️/) + ' · ⧉ repetidos ' + cuenta(/^⧉/) + (cuenta(/^⏳/) ? ' · ⏳ por identificar ' + cuenta(/^⏳/) : '') +
    ' · filas raras ' + e.raras + ' (la IA leyó ' + e.porIA + ' como voucher, ' + e.noVoucher + ' no eran voucher' +
    (e.sinLeer + e.pendientes ? ', ' + (e.sinLeer + e.pendientes) + ' sin leer' : '') + ')')
    .setFontWeight('bold').setBackground('#EEF3F8').setWrap(true).setFontSize(9);
  sh.getRange(4, 1, 1, AUV_ENC_.length).setValues([AUV_ENC_]).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL)
    .setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(4);
  if (filas.length) {
    sh.getRange(5, 1, filas.length, AUV_ENC_.length).setValues(filas).setFontSize(9).setVerticalAlignment('top');
    sh.getRange(5, 2, filas.length, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(5, 4, filas.length, 1).setNumberFormat('@');
    sh.getRange(5, 6, filas.length, 1).setNumberFormat('#,##0.00');
    sh.getRange(5, 11, filas.length, 1).setNumberFormat('@');
    sh.getRange(5, 14, filas.length, 1).setBackgrounds(filas.map(function (f) {
      var s = f[13];
      return [/^✔/.test(s) ? '#DCFCE7' : /^🟡/.test(s) ? '#FEF9C3' : /^[⚠❔]/.test(s) ? '#FEE2E2' : /^⧉/.test(s) ? '#E5E7EB' : '#F8FAFC'];
    }));
  }
  sh.getRange(4, 1, Math.max(filas.length, 1) + 1, AUV_ENC_.length).createFilter();
  [110, 80, 80, 95, 55, 90, 200, 90, 120, 200, 95, 260, 110, 230, 420].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
}
