/**
 * 🤖 Telegram — herramientas extra de la IA (se suman a las del analista de Cobranzas).
 * Leen SOLO LECTURA las otras hojas del grupo: Notificaciones · Grupo, Retenciones · Grupo,
 * Honorarios · Grupo, Detracciones · Grupo, las Liquidaciones IGV de SIRE y cualquier
 * Google Sheet que se nombre. Cada una devuelve {columnas, filas, nota?} como las demás.
 */

var TG_MAX_FILAS_HERR_ = 300;

var TGH_ = {
  notificaciones: function (c, a) {
    var mensajes = /mensaj/i.test(a.tipo || '');
    var t = TG_tablaLibro_(c, 'notificaciones', mensajes ? 'Mensajes' : 'Notificaciones');
    var res = TG_filtrar_(c, t, a, { fecha: 'Fecha publicación', quitar: /^(rutas|codigo)$/ });
    if (a.no_leidas === true) {
      var j = TG_col_(res.columnas, mensajes ? 'Leído' : 'Leída');
      if (j >= 0) res.filas = res.filas.filter(function (f) { return !f[j] || /^(no|false|0)$/i.test(String(f[j]).trim()); });
    }
    return TG_limitar_(res, a.max);
  },

  retenciones_sunat: function (c, a) {
    var tipo = /recib/i.test(a.tipo || '') ? 'Recibidas' : /detal|factura/i.test(a.tipo || '') ? 'Detalle' : 'Emitidas';
    var t = TG_tablaLibro_(c, 'retenciones', tipo);
    var contra = tipo === 'Recibidas' ? ['RUC agente', 'Agente de retención'] : ['RUC proveedor', /^Proveedor/];
    var res = TG_filtrar_(c, t, a, { fecha: tipo === 'Detalle' ? 'Fecha retención' : 'Fecha emisión', contraparte: contra, quitar: /^ruta$/ });
    res.nota = 'Pestaña ' + tipo + ' de Retenciones · Grupo' + (tipo === 'Emitidas' ? ' (la empresa retuvo al proveedor)' : tipo === 'Recibidas' ? ' (a la empresa le retuvieron)' : '');
    return TG_limitar_(res, a.max);
  },

  honorarios: function (c, a) {
    var t = TG_tablaLibro_(c, 'honorarios', 'Recibos');
    var res = TG_filtrar_(c, t, a, { fecha: 'Fecha emisión', contraparte: ['RUC emisor', /^Emisor/], contraArg: a.emisor || a.contraparte, quitar: /^ruta$/ });
    if (a.pendientes === true) {
      var j = TG_col_(res.columnas, 'Pendiente de pago');
      if (j >= 0) res.filas = res.filas.filter(function (f) { return aNumero_(f[j]) > 0 || /^si/i.test(String(f[j])); });
    }
    return TG_limitar_(res, a.max);
  },

  sire_liquidacion: function (c, a) {
    var anio = parseInt(a.anio || a.año, 10) || new Date().getFullYear();
    var rucs = a.empresa ? [ANA_empresa_(c, a.empresa)] : c.cfg.grupo;
    var res = { columnas: [], filas: [] }, faltan = [];
    rucs.forEach(function (ruc) {
      var libro = TG_libroSire_(ruc, anio);
      if (!libro) { faltan.push(ANA_nombreEmp_(c, ruc)); return; }
      var t = TG_tabla_(libro, 'Liquidacion');
      if (!res.columnas.length) res.columnas = ['empresa'].concat(t.columnas);
      t.filas.forEach(function (f) { if (f.some(function (v) { return v !== '' && v != null; })) res.filas.push([ANA_nombreEmp_(c, ruc)].concat(f)); });
    });
    if (faltan.length) res.nota = 'No hay hoja "Liquidacion IGV <RUC> - ' + anio + '" de: ' + faltan.join(', ');
    return res;
  },

  leer_libro: function (c, a) {
    var libro = TG_abrirLibro_(c, a.libro, a);
    if (!a.hoja) {
      return { columnas: ['pestaña', 'filas', 'columnas'], filas: libro.getSheets().filter(function (s) { return !s.isSheetHidden || !s.isSheetHidden(); }).map(function (s) {
        var t;
        try { t = TG_tabla_(libro, s.getName(), true); } catch (e) { t = { columnas: [], filas: [] }; }
        return [s.getName(), t.n || 0, t.columnas.join(' | ').slice(0, 400)];
      }) };
    }
    var nombre = TG_nombrePestana_(libro, a.hoja);
    var t = TG_tabla_(libro, nombre);
    var res = TG_filtrar_(c, t, { buscar: a.buscar }, {});
    return TG_limitar_(res, a.max_filas);
  },

  estado_descargas: function (c, a) {
    return TG_estadoTabla_(c.op.tg.cfg, a.proyecto);
  },

  lanzar_descarga: function (c, a) {
    var p = TG_proyectoDe_(a.proyecto);
    if (!p) throw new Error('proyecto desconocido "' + a.proyecto + '"; los que hay: ' + Object.keys(TG_PROYECTOS_).join(', '));
    var emp = String(a.empresa || 'todas').trim();
    var ruc = /^tod/i.test(emp) ? 'todas' : ANA_empresa_(c, emp);
    if (p === 'sire_rapido' && ruc !== 'todas') {   // ⚡ puede ser una o varias empresas
      var rs = [];
      emp.split(/\s*(?:,|;|\by\b)\s*/).filter(String).forEach(function (x) {
        var r = ANA_empresa_(c, x);
        if (!/^\d{11}$/.test(r)) throw new Error('no reconozco la empresa "' + x + '"');
        if (rs.indexOf(r) < 0) rs.push(r);
      });
      ruc = rs.join(',') || 'todas';
    }
    if (ruc !== 'todas' && !/^\d{11}(,\d{11})*$/.test(ruc)) throw new Error('no reconozco la empresa "' + emp + '"');
    var desde = String(a.desde || '').replace(/\D/g, '').slice(0, 6), hasta = String(a.hasta || '').replace(/\D/g, '').slice(0, 6);
    var acc = { t: 'descarga', proyecto: p, empresa: ruc, desde: desde, hasta: hasta };
    if (p === 'sire_rapido') {
      if (desde && hasta && hasta < desde) { var x0 = desde; desde = hasta; hasta = x0; acc.desde = desde; acc.hasta = hasta; }
      if ((hasta || desde) > TG_mes_(0)) throw new Error((hasta || desde) + ' todavía no empieza');
      if (desde && TGS_meses_(desde, hasta || TG_mes_(0)).length > TGS_MAX_MESES_) throw new Error('máximo ' + TGS_MAX_MESES_ + ' meses por vez');
      acc.tipo = /^compra/i.test(a.tipo || '') ? 'compra' : /^venta/i.test(a.tipo || '') ? 'venta' : 'ambos';
    }
    if (p === 'notificaciones' && !desde) acc.nuevas = !(a.todo === true || /^tod/i.test(String(a.desde || '')));
    c.op.tg.acciones.push(acc);
    return { columnas: ['propuesta'], filas: [[TG_textoDescarga_(acc, c.cfg)]],
      nota: 'Queda PROPUESTA: el usuario verá un botón 🚀 para confirmarla. En tu respuesta dile qué se va a descargar y que la confirme con el botón.' };
  },

  tipo_cambio: function () {
    var tc = TG_tipoCambio_();
    return { columnas: ['fecha', 'compra', 'venta', 'fuente'], filas: [[tc.fecha, tc.compra, tc.venta, 'SUNAT']] };
  },

  padron_ruc: function (c, a) {
    var ruc = String(a.ruc || '').replace(/\D/g, '');
    if (!/^\d{11}$/.test(ruc)) throw new Error('RUC inválido');
    var q = {}; q[ruc] = true;
    var p = PAD_leer_(c.ss, q);
    var x = p.mapa[ruc], ss = null;
    try { ss = SSCO_ruc_(c.ss, ruc); } catch (e) {}
    var txtSsco = ss ? SSCO_texto_(ss) + (ss.plazo ? ' Plazo para pedir revisión: ' + TG_fecha_(aFecha_(ss.plazo)) + ' (aprox.).' : '') : 'No figura en la lista de Sujetos Sin Capacidad Operativa';
    var nota = p.info + ' · ' + (PropertiesService.getDocumentProperties().getProperty('ssco_info') || '');
    if (!x) return { columnas: ['ruc', 'resultado', 'sin_capacidad_operativa'], filas: [[ruc, 'No figura en los padrones de agentes de retención, buenos contribuyentes ni agentes de percepción', txtSsco]], nota: nota };
    return { columnas: ['ruc', 'razon_social', 'agente_retencion_desde', 'buen_contribuyente_desde', 'agente_percepcion_desde', 'percepcion_combustible_desde', 'sin_capacidad_operativa'],
      filas: [[ruc, x.nombre, x.ar || '', x.bc || '', x.ap || '', x.apc || '', txtSsco]], nota: nota };
  },

  recordatorio: function (c, a) {
    var cuando = TG_fechaHora_(a.cuando);
    if (!cuando) throw new Error('"cuando" debe ser dd/mm/yyyy HH:mm');
    if (cuando.getTime() < Date.now() - 60000) throw new Error('esa fecha ya pasó (' + TG_fechaHoraTxt_(cuando) + ')');
    var r = TG_crearRecordatorio_(c.ss, c.op.tg.ctx.chatId, cuando, String(a.texto || '').trim(), a.repetir);
    return { columnas: ['id', 'cuando', 'texto', 'repetir'], filas: [[r.id, TG_fechaHoraTxt_(cuando), r.texto, r.repetir]], nota: 'Recordatorio creado.' };
  },

  vencimientos: function (c, a) {
    var lista = TGV_lista_(c.ss, c).filter(function (x) { return !x.sinCronograma; });
    if (a.empresa) { var r = ANA_empresa_(c, a.empresa); lista = lista.filter(function (x) { return x.ruc === r; }); }
    if (a.periodo) { var per = String(a.periodo).replace(/\D/g, '').slice(0, 6); lista = lista.filter(function (x) { return x.periodo === per; }); }
    if (a.pendientes === true) lista = lista.filter(function (x) { return !x.presentado; });
    var p = TGV_param_(c.ss);
    return { columnas: ['empresa', 'ruc', 'obligacion', 'periodo', 'vence', 'dias_que_faltan', 'estado', 'buen_contribuyente'],
      filas: lista.map(function (x) { return [x.nombre, x.ruc, TGV_OBLIG_[x.ob].corto, x.periodo, x.vence, x.faltan, x.presentado ? 'presentado' : (x.faltan < 0 ? 'VENCIDO sin marcar' : 'pendiente'), x.bc ? 'sí' : 'no']; }),
      nota: 'Cronograma SUNAT por último dígito del RUC (pestaña ' + TGV_HOJA_ + '). Avisos: IGV ' + p.dias.igv.join(',') + ' y SIRE ' + p.dias.sire.join(',') + ' días antes, a las ' + p.hora + ':00. ' +
        'El SIRE se marca presentado solo con el mensaje del Buzón; el IGV-Renta/PLAME con el botón o con marcar_presentado.' };
  },

  marcar_presentado: function (c, a) {
    var ruc = ANA_empresa_(c, a.empresa);
    if (!/^\d{11}$/.test(String(ruc))) throw new Error('no reconozco la empresa "' + a.empresa + '"');
    var per = String(a.periodo || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(per)) throw new Error('periodo debe ser AAAAMM');
    var ob = /sire|rvie|rce|regis/i.test(a.obligacion || '') ? 'sire' : 'igv';
    var nuevo = TGV_marcar_(c.ss, ruc, per, ob, 'chat con la IA');
    return { columnas: ['resultado'], filas: [[(nuevo ? 'Anotado como presentado: ' : 'Ya estaba anotado: ') + TGV_OBLIG_[ob].corto + ' ' + per + ' de ' + ruc]] };
  },

  ajustar_avisos_vencimientos: function (c, a) {
    var hecho = [];
    var lista = function (v) { return String(v).split(/[,;\s]+/).map(Number).filter(function (n) { return !isNaN(n) && n >= 0 && n <= 60; }).join(', '); };
    if (a.dias_igv != null) { TGV_cambiarParam_(c.ss, TGV_PARAM_[0][0], lista(a.dias_igv)); hecho.push('IGV ' + lista(a.dias_igv)); }
    if (a.dias_sire != null) { TGV_cambiarParam_(c.ss, TGV_PARAM_[1][0], lista(a.dias_sire)); hecho.push('SIRE ' + lista(a.dias_sire)); }
    if (a.hora != null) { TGV_cambiarParam_(c.ss, TGV_PARAM_[2][0], String(parseInt(a.hora, 10))); hecho.push('hora ' + parseInt(a.hora, 10)); }
    if (a.despues != null) { TGV_cambiarParam_(c.ss, TGV_PARAM_[3][0], String(parseInt(a.despues, 10))); hecho.push('después de vencido ' + parseInt(a.despues, 10) + ' días'); }
    if (a.empresas != null) { TGV_cambiarParam_(c.ss, TGV_PARAM_[4][0], String(a.empresas)); hecho.push('empresas: ' + (a.empresas || 'todas')); }
    return { columnas: ['cambiado'], filas: hecho.map(function (h) { return [h]; }) };
  },

  recordatorios: function (c) {
    var rs = TG_recordatorios_(c.ss, c.op.tg.ctx.chatId);
    return { columnas: ['id', 'cuando', 'texto', 'repetir'], filas: rs.map(function (r) { return [r.id, TG_fechaHoraTxt_(r.cuando), r.texto, r.repetir]; }) };
  },

  enviar_voucher: function (c, a) {
    var filas = (Array.isArray(a.filas) ? a.filas : [a.fila || a.voucher || '']).map(function (f) { return String(f || '').replace(/\s/g, ''); })
      .filter(function (f) { return /^[^!]+!\d+$/.test(f); });
    filas = filas.filter(function (f, k) { return filas.indexOf(f) === k; }).slice(0, 30);
    if (!filas.length) throw new Error('indique la(s) fila(s) del voucher como "Originales!2326" (columna fila de la herramienta vouchers)');
    var modo = /original|pdf|completo|archivo/i.test(a.modo || '') ? 'original' : 'imagen';
    c.op.tg.vouchers = { filas: filas, modo: modo };
    return { columnas: ['voucher', 'estado'], filas: filas.map(function (f) { return [f, modo === 'original' ? 'se enviará el archivo original completo' : 'se enviará la foto del voucher']; }),
      nota: 'Listo: el sistema los manda al chat. En tu respuesta solo confírmalo en una línea.' };
  },

  enviar_archivo: function (c, a) {
    var id = TG_idDrive_(a.enlace || a.url || a.link || a.id || a.pdf);
    if (!id) throw new Error('falta el enlace de Drive del archivo (columna PDF/enlace de la fila)');
    var f = DriveApp.getFileById(id);
    if (c.op.tg.archivos.length >= 10) throw new Error('ya hay 10 archivos para mandar');
    c.op.tg.archivos.push({ id: id, titulo: String(a.titulo || f.getName()) });
    return { columnas: ['archivo', 'estado'], filas: [[f.getName(), 'se enviará al chat']] };
  },
};

/* ============================================================ lectura de hojas */

/** ID de cada libro del grupo. */
function TG_idsLibros_(c) {
  var t = c.op && c.op.tg && c.op.tg.cfg && c.op.tg.cfg.repo ? c.op.tg.cfg : TG_cfg_(c.ss);
  return { notificaciones: t.idNotificaciones, honorarios: t.idHonorarios, retenciones: c.cfg.idRetenciones, detracciones: c.cfg.idDetracciones,
    vouchers: c.cfg.idVouchers, cobranzas: c.ss.getId() };
}

function TG_abrirLibro_(c, libro, a) {
  var k = normHeader_(libro || '');
  if (/^sire|liquidac/.test(k)) {
    var ruc = ANA_empresa_(c, a.empresa || '');
    if (!/^\d{11}$/.test(ruc)) throw new Error('para el libro SIRE indique la empresa');
    var l = TG_libroSire_(ruc, parseInt(a.anio, 10) || new Date().getFullYear());
    if (!l) throw new Error('no existe la Liquidacion IGV de esa empresa y año');
    return l;
  }
  var ids = TG_idsLibros_(c);
  var clave = Object.keys(ids).filter(function (n) { return k.indexOf(n.slice(0, 6)) === 0; })[0];
  var id = clave ? ids[clave] : TG_idDrive_(libro) || String(libro || '').replace(/^.*\/d\/([\w-]+).*$/, '$1');
  if (!id) throw new Error('libro desconocido "' + libro + '": use notificaciones, retenciones, honorarios, detracciones, cobranzas, vouchers, sire o el ID de una hoja');
  c._tgLibros = c._tgLibros || {};
  return c._tgLibros[id] = c._tgLibros[id] || SpreadsheetApp.openById(id);
}

function TG_tablaLibro_(c, libro, hoja) {
  var clave = libro + '|' + hoja;
  c._tgTablas = c._tgTablas || {};
  if (c._tgTablas[clave]) return c._tgTablas[clave];
  var l = TG_abrirLibro_(c, libro, {});
  return c._tgTablas[clave] = TG_tabla_(l, hoja);
}

function TG_libroSire_(ruc, anio) {
  var it = DriveApp.getFilesByName('Liquidacion IGV ' + ruc + ' - ' + anio);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return SpreadsheetApp.open(f); }
  return null;
}

function TG_nombrePestana_(libro, hoja) {
  var n = normHeader_(hoja);
  var hs = libro.getSheets().map(function (s) { return s.getName(); });
  return hs.filter(function (h) { return normHeader_(h) === n; })[0] || hs.filter(function (h) { return normHeader_(h).indexOf(n) !== -1; })[0] || hoja;
}

/**
 * Lee una pestaña con su encabezado (la fila con más textos entre las 6 primeras: las hojas del grupo
 * tienen título en la fila 1, nota en la 2 y encabezado en la 3). Las columnas de enlaces (PDF, Ver…)
 * traen la dirección del enlace en vez del texto "📄 Ver PDF". soloEnc = solo encabezado y cantidad.
 */
function TG_tabla_(libro, hoja, soloEnc) {
  var sh = libro.getSheetByName(hoja);
  if (!sh) throw new Error('no existe la pestaña "' + hoja + '" (hay: ' + libro.getSheets().map(function (s) { return s.getName(); }).join(', ') + ')');
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 1 || lc < 1) return { columnas: [], filas: [], n: 0 };
  var top = sh.getRange(1, 1, Math.min(6, lr), lc).getValues();
  var h = 0, mejor = -1;
  top.forEach(function (r, i) {
    var n = r.filter(function (v) { return typeof v === 'string' && v.trim() && v.length < 60; }).length;
    if (n >= 2 && n > mejor) { mejor = n; h = i; }   // empate: gana la de más arriba (el encabezado, no los datos)
  });
  var cols = top[h].map(function (v, j) { return String(v || '').trim() || 'col' + (j + 1); });
  var n = lr - (h + 1);
  if (soloEnc || n < 1) return { columnas: cols, filas: [], n: Math.max(0, n) };
  var v = sh.getRange(h + 2, 1, n, lc).getValues();
  cols.forEach(function (c, j) {
    if (!/pdf|constancia pdf|enlace|link|^ver\b|archivo|adjunto/i.test(c)) return;
    var rich;
    try { rich = sh.getRange(h + 2, j + 1, n, 1).getRichTextValues(); } catch (e) { return; }
    rich.forEach(function (r, i) {
      if (!r[0]) return;
      var urls = [];
      try { r[0].getRuns().forEach(function (run) { var u = run.getLinkUrl(); if (u && urls.indexOf(u) === -1) urls.push(u); }); } catch (e) { /* sin enlaces */ }
      if (!urls.length && r[0].getLinkUrl && r[0].getLinkUrl()) urls.push(r[0].getLinkUrl());
      if (urls.length) v[i][j] = urls.join(' ');
    });
  });
  var filas = v.filter(function (r) { return r.some(function (x) { return x !== '' && x != null; }); });
  return { columnas: cols, filas: filas, n: filas.length, hoja: hoja };
}

function TG_col_(cols, nombre) {
  if (nombre instanceof RegExp) {
    for (var i = 0; i < cols.length; i++) if (nombre.test(cols[i])) return i;
    return -1;
  }
  var n = normHeader_(nombre);
  for (var j = 0; j < cols.length; j++) if (normHeader_(cols[j]) === n) return j;
  for (var k = 0; k < cols.length; k++) if (normHeader_(cols[k]).indexOf(n) === 0) return k;
  return -1;
}

/**
 * Filtros comunes: empresa (RUC o nombre), desde/hasta (en la columna de fecha), periodo (AAAAMM),
 * contraparte (RUC o nombre en las columnas dadas), buscar (texto en toda la fila). Ordena por fecha, lo último primero.
 */
function TG_filtrar_(c, t, a, def) {
  var cols = t.columnas;
  var jRucEmp = TG_col_(cols, 'RUC empresa'), jEmp = TG_col_(cols, 'Empresa');
  var jF = def.fecha ? TG_col_(cols, def.fecha) : -1;
  var jPer = TG_col_(cols, 'Periodo');
  var jCR = def.contraparte ? TG_col_(cols, def.contraparte[0]) : -1, jCN = def.contraparte ? TG_col_(cols, def.contraparte[1]) : -1;
  var emp = a.empresa ? ANA_empresa_(c, a.empresa) : '';
  var nomEmp = emp ? normHeader_(ANA_nombreEmp_(c, emp)) : '';
  var contra = def.contraArg != null ? def.contraArg : a.contraparte;
  var per = String(a.periodo || '').replace(/\D/g, '');
  var buscar = a.buscar ? normHeader_(a.buscar) : '';
  var filas = t.filas.filter(function (f) {
    if (emp) {
      var okR = jRucEmp >= 0 && String(f[jRucEmp]).replace(/\D/g, '') === emp;
      var okN = jEmp >= 0 && (normHeader_(f[jEmp]) === nomEmp || normHeader_(f[jEmp]).indexOf(normHeader_(a.empresa)) !== -1);
      if (!okR && !okN) return false;
    }
    if (jF >= 0 && (a.desde || a.hasta) && !ANA_enFechas_(aFecha_(f[jF]), a.desde, a.hasta)) return false;
    if (per && jPer >= 0 && String(f[jPer]).replace(/\D/g, '').indexOf(per) !== 0) return false;
    if (contra && (jCR >= 0 || jCN >= 0) && !ANA_coincide_(contra, jCR >= 0 ? String(f[jCR]).replace(/\D/g, '') : '', jCN >= 0 ? f[jCN] : '')) return false;
    if (buscar && normHeader_(f.join(' ')).indexOf(buscar) === -1) return false;
    return true;
  });
  if (jF >= 0) filas.sort(function (x, y) { return (aFecha_(y[jF]) || 0) - (aFecha_(x[jF]) || 0); });
  var quedan = cols.map(function (cn, j) { return j; }).filter(function (j) { return !(def.quitar && def.quitar.test(normHeader_(cols[j]))); });
  return { columnas: quedan.map(function (j) { return cols[j]; }), filas: filas.map(function (f) { return quedan.map(function (j) { return f[j]; }); }) };
}

function TG_limitar_(res, max) {
  var m = Math.min(parseInt(max, 10) || TG_MAX_FILAS_HERR_, 1500);
  if (res.filas.length > m) { res.nota = (res.nota ? res.nota + ' · ' : '') + 'Se muestran ' + m + ' de ' + res.filas.length + ' filas (las más recientes); filtre por empresa o fechas para ver menos.'; res.filas = res.filas.slice(0, m); }
  return res;
}

/* ============================================================ tipo de cambio */

/** Tipo de cambio de hoy publicado por SUNAT. {fecha, compra, venta} */
function TG_tipoCambio_() {
  var cache = CacheService.getScriptCache();
  var g = cache.get('tg_tc');
  if (g) return JSON.parse(g);
  var r = UrlFetchApp.fetch('https://www.sunat.gob.pe/a/txt/tipoCambio.txt', { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('SUNAT no respondió el tipo de cambio (HTTP ' + r.getResponseCode() + ')');
  var p = r.getContentText().trim().split('|');   // 16/10/2026|3.712|3.720|
  if (p.length < 3 || !Number(p[1])) throw new Error('SUNAT devolvió un tipo de cambio raro: ' + r.getContentText().slice(0, 60));
  var tc = { fecha: p[0], compra: Number(p[1]), venta: Number(p[2]) };
  cache.put('tg_tc', JSON.stringify(tc), 3600);
  return tc;
}

/* ============================================================ fechas */

function TG_fechaHora_(s) {
  if (s instanceof Date) return s;
  var m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], m[4] != null ? +m[4] : 9, m[5] != null ? +m[5] : 0);
  m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] != null ? +m[4] : 9, m[5] != null ? +m[5] : 0);
  return null;
}

function TG_fechaHoraTxt_(d) {
  return d instanceof Date ? Utilities.formatDate(d, 'America/Lima', 'dd/MM/yyyy HH:mm') : String(d || '');
}
