/**
 * 📋 Vouchers procesados — ver lo que se registró (por tanda) y completar el RUC del proveedor que falte.
 *
 * La tanda es la columna "Archivo Original" de la hoja de Vouchers: "26-10-26 Sonia", "26-10-26 Sonia(Edit)",
 * "14-05-26 Edit Voucher"… (fecha dd-mm-aa + nombre). Se entiende lo que la persona escribe o dice:
 *   procesados hoy · procesados hoy sonia · procesados ayer edit · procesados de 26-10-26 Sonia(Edit).pdf ·
 *   procesados del archivo original 14-05-26 Edit Voucher.pdf · procesados del 14 de octubre · los 2 últimos procesados de sonia
 * Para cada voucher sin RUC del proveedor busca uno: alias confirmados (⚙️ Config), la factura del voucher en el SIRE
 * y el nombre en tus facturas. Escribir el RUC en la hoja de Vouchers se confirma con un botón y se puede deshacer (↩️).
 * Telegram (/procesados), WhatsApp ("procesados …"), la hoja (menú 💼 Cobranzas) y la IA (herramienta vouchers_procesados).
 */

var TGQ_RX_ = /\bprocesad[oa]s?\b/i;
var TGQ_HOJA_ = '📋 Procesados';
var TGQ_ENC_ = ['Tanda (Archivo Original)', 'Fila', 'Fecha', 'Monto', 'Moneda', 'Proveedor (beneficiario)', 'RUC en Vouchers',
  'RUC sugerido', 'Cómo se encontró', '✔ Escribir'];
var TGQ_MESES_ = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12, ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
var TGQ_NUMEROS_ = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
var TGQ_NO_NOMBRE_ = ('procesado procesados procesada procesadas voucher vouchers archivo archivos original originales pdf hoy ayer anteayer antier ' +
  'del de la el los las lo que se ha han dia dias este esta ano anio ultimo ultimos ultima ultimas reciente recientes completa completar completame ' +
  'completalo completalos ruc rucs muestrame muestra mostrar ver veo lista listar listame dame quiero por favor con sin falta faltan todos todas ' +
  'tanda tandas lote lotes hoja enviados enviado subidos subido proveedor proveedores beneficiario pendientes mandame manda envia enviame cuales ' +
  'cual son fue fueron registrados registrado para mis sus como esta estan revisa revisar dime hecho hechos nombre nombres').split(' ');

function TGQ_simple_(t) {
  return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function TGQ_dma_(d) { return Utilities.formatDate(d, 'America/Lima', 'dd-MM-yy'); }

/** Lo que pide la persona → {fechas:["26-10-26"], nombres:["sonia"], archivos:[{fecha, nombre}], ultimos, porDefecto} */
function TGQ_interpretar_(texto) {
  var t = TGQ_simple_(texto), q = { fechas: [], nombres: [], archivos: [], ultimos: 0, porDefecto: false };
  var hoy = new Date(), anio = Number(Utilities.formatDate(hoy, 'America/Lima', 'yyyy'));
  var dia = function (n) { return TGQ_dma_(new Date(hoy.getTime() - n * 86400000)); };
  var agregar = function (f) { if (q.fechas.indexOf(f) < 0) q.fechas.push(f); };
  // Nombres de archivo/tanda escritos tal cual: "26-10-26 Sonia(Edit).pdf", "14-05-26 Edit Voucher.pdf"
  t = t.replace(/\b(\d{2})-(\d{2})-(\d{2})\s+([a-z][a-z0-9()&.\- ]*?)(?:\.pdf)?(?=\s+(?:y|o|del?|archivo|original)\b|[,;]|$)/g, function (m, d, mm, a, nom) {
    q.archivos.push({ fecha: d + '-' + mm + '-' + a, nombre: TGQ_nombreTanda_(nom) });
    return ' ';
  });
  if (/\bhoy\b/.test(t)) agregar(dia(0));
  if (/\bayer\b/.test(t)) agregar(dia(1));
  if (/\b(anteayer|antier|antes de ayer)\b/.test(t)) agregar(dia(2));
  t = t.replace(/\b(\d{1,2})[-\/.](\d{1,2})(?:[-\/.](\d{2,4}))?\b/g, function (m, d, mm, a) {
    var y = a ? Number(a.length === 2 ? '20' + a : a) : anio;
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(d) >= 1 && Number(d) <= 31) agregar(('0' + d).slice(-2) + '-' + ('0' + mm).slice(-2) + '-' + String(y).slice(-2));
    return ' ';
  });
  t = t.replace(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+(?:de\s+|del\s+)?(\d{4}|este ano|este anio|este año))?/g, function (m, d, mes, a) {
    var mm = TGQ_MESES_[mes];
    if (!mm) return m;
    var y = a && /^\d{4}$/.test(a) ? Number(a) : anio;
    agregar(('0' + d).slice(-2) + '-' + ('0' + mm).slice(-2) + '-' + String(y).slice(-2));
    return ' ';
  });
  var u = t.match(/\b(\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:ultim[oa]s?|recientes?)\b/) ||
    t.match(/\bultim[oa]s?\s+(\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
  if (u) q.ultimos = Number(u[1]) || TGQ_NUMEROS_[u[1]] || 0;
  else if (/\b(el|la) ultim[oa]\b/.test(t)) q.ultimos = 1;
  t.replace(/[^a-zñ ]/g, ' ').split(' ').forEach(function (w) {
    if (w.length >= 3 && TGQ_NO_NOMBRE_.indexOf(w) < 0 && !TGQ_MESES_[w] && !TGQ_NUMEROS_[w] && q.nombres.indexOf(w) < 0) q.nombres.push(w);
  });
  if (!q.fechas.length && !q.archivos.length && !q.nombres.length) { q.fechas.push(dia(0)); q.porDefecto = true; }
  return q;
}

/** Nombre de la tanda sin la fecha, la extensión ni la palabra "voucher" (para comparar). */
function TGQ_nombreTanda_(s) {
  return TGQ_simple_(s).replace(/\.pdf$/, '').replace(/\bvouchers?\b/g, ' ').replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

function TGQ_partirTanda_(archivo) {
  var a = TGQ_simple_(archivo).replace(/\.pdf$/, '');
  var m = a.match(/^(\d{2}-\d{2}-\d{2})\s*(.*)$/);
  return { fecha: m ? m[1] : '', nombre: TGQ_nombreTanda_(m ? m[2] : a) };
}

function TGQ_coincide_(q, archivo, conFecha, exacto) {
  var p = TGQ_partirTanda_(archivo);
  if (q.archivos.length) {
    return q.archivos.some(function (x) {
      return p.fecha === x.fecha && (!x.nombre || p.nombre === x.nombre || (!exacto && (p.nombre.indexOf(x.nombre) >= 0 || x.nombre.indexOf(p.nombre) >= 0)));
    });
  }
  if (conFecha && q.fechas.length && q.fechas.indexOf(p.fecha) < 0) return false;
  if (!q.nombres.length) return true;
  var pal = p.nombre.split(' ');
  return q.nombres.some(function (n) { return pal.indexOf(n) >= 0 || p.nombre.indexOf(n) >= 0; });
}

/** Lee la hoja de Vouchers y arma las tandas pedidas, con RUC sugerido donde falte. */
function TGQ_buscar_(ss, texto) {
  var q = TGQ_interpretar_(texto), cfg = leerConfig_(ss);
  if (!cfg.idVouchers) throw new Error('falta el ID de la hoja de Vouchers en ⚙️ Config.');
  var libro = SpreadsheetApp.openById(cfg.idVouchers), filas = [];
  libro.getSheets().forEach(function (h) {
    if (h.getLastRow() < 2) return;
    var enc = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0], col = indiceColumnas_(enc);
    var c = { archivo: col('Archivo Original'), fecha: col('Fecha de depos', 'Fecha de deposito'), monto: col('Monto'), moneda: col('Moneda'),
      prov: col('Proveedor (Beneficiario)'), ruc: col('ID Beneficiario'), refs: col('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc'), op: col('Numero de oper', 'Numero de operacion'),
      empresa: col('Empresa'), idUsuario: col('ID Usuario') };
    if (c.archivo < 0 || c.monto < 0) return;
    var desde = Math.max(2, h.getLastRow() - 5000), n = h.getLastRow() - desde + 1;
    var leer = function (j) { return j >= 0 ? h.getRange(desde, j + 1, n, 1).getValues() : null; };
    var v = {}; Object.keys(c).forEach(function (k) { v[k] = leer(c[k]); });
    for (var i = 0; i < n; i++) {
      var archivo = String(v.archivo[i][0] || '').trim();
      if (!archivo || !aNumero_(v.monto[i][0])) continue;
      filas.push({ hoja: h.getName(), fila: desde + i, archivo: archivo, colRuc: c.ruc + 1,
        fecha: v.fecha ? aFecha_(v.fecha[i][0]) : null, monto: aNumero_(v.monto[i][0]), moneda: v.moneda ? String(v.moneda[i][0] || 'PEN') : 'PEN',
        prov: v.prov ? String(v.prov[i][0] || '').trim() : '', ruc: v.ruc ? aRuc_(v.ruc[i][0]) : '', refs: v.refs ? String(v.refs[i][0] || '') : '',
        op: v.op ? String(v.op[i][0] || '') : '', empresa: v.empresa ? String(v.empresa[i][0] || '').trim() : '',
        idUsuario: v.idUsuario ? aRuc_(v.idUsuario[i][0]) : '' });
    }
  });
  // Palabras que no son nombre de ninguna tanda ("porfa", "revisame"…) no filtran.
  if (q.nombres.length) {
    var conocidas = {};
    filas.forEach(function (f) { TGQ_partirTanda_(f.archivo).nombre.split(' ').forEach(function (w) { conocidas[w] = true; }); });
    var validos = q.nombres.filter(function (n) { return conocidas[n]; });
    if (validos.length) q.nombres = validos;
  }
  if (!q.fechas.length && !q.archivos.length && !q.ultimos) q.ultimos = 3;   // "procesados sonia": sus 3 últimas tandas
  // Un archivo escrito tal cual ("26-10-26 Sonia(Edit).pdf"): primero el nombre exacto; si no hay, el parecido.
  var elegidas = filas.filter(function (f) { return TGQ_coincide_(q, f.archivo, true, true); }), ampliado = '';
  if (!elegidas.length && q.archivos.length) elegidas = filas.filter(function (f) { return TGQ_coincide_(q, f.archivo, true); });
  if (!elegidas.length && q.porDefecto) {   // hoy no hay: lo último que se procesó
    var fechas = filas.map(function (f) { return TGQ_partirTanda_(f.archivo).fecha; }).filter(Boolean);
    var ult = fechas.sort(function (a, b) { return TGQ_orden_(b) - TGQ_orden_(a); })[0];
    if (ult) { q.fechas = [ult]; elegidas = filas.filter(function (f) { return TGQ_coincide_(q, f.archivo, true); }); ampliado = 'Hoy no hay procesados; muestro lo último (' + ult + ').'; }
  } else if (!elegidas.length && q.nombres.length && q.fechas.length) {   // ese día no: lo último de esa persona
    var suyas = filas.filter(function (f) { return TGQ_coincide_(q, f.archivo, false); });
    var ult2 = suyas.map(function (f) { return TGQ_partirTanda_(f.archivo).fecha; }).sort(function (a, b) { return TGQ_orden_(b) - TGQ_orden_(a); })[0];
    if (ult2) { q.fechas = [ult2]; elegidas = suyas.filter(function (f) { return TGQ_partirTanda_(f.archivo).fecha === ult2; }); ampliado = 'Ese día no hay de ' + q.nombres.join(', ') + '; muestro lo último (' + ult2 + ').'; }
  }
  // Tandas, la más reciente primero (y "los N últimos")
  var tandas = {}, orden = [];
  elegidas.forEach(function (f) {
    if (!tandas[f.archivo]) { tandas[f.archivo] = { nombre: f.archivo, filas: [], ultimaFila: 0 }; orden.push(f.archivo); }
    tandas[f.archivo].filas.push(f);
    tandas[f.archivo].ultimaFila = Math.max(tandas[f.archivo].ultimaFila, f.fila);
  });
  orden.sort(function (a, b) { return TGQ_orden_(TGQ_partirTanda_(b).fecha) - TGQ_orden_(TGQ_partirTanda_(a).fecha) || tandas[b].ultimaFila - tandas[a].ultimaFila; });
  if (q.ultimos) orden = orden.slice(0, q.ultimos);
  var lista = orden.map(function (k) { return tandas[k]; });
  TGQ_sugerir_(ss, cfg, lista);
  return { q: q, tandas: lista, ampliado: ampliado };
}

function TGQ_orden_(dma) { var p = String(dma || '').split('-'); return p.length === 3 ? Number(p[2] + p[1] + p[0]) : 0; }

/**
 * Fuentes para encontrar el RUC de un proveedor, en este orden (cada una dice dónde lo encontró):
 *   1. ⚙️ alias confirmados · 2. 📑 emisor de su factura en el SIRE · 3. 🧾 otros vouchers del mismo proveedor que ya tienen RUC ·
 *   4. 📑 nombre en las facturas del SIRE · 5. 🧑‍💼 emisores de recibos por honorarios · 6. 🧾 proveedores de retenciones (CRE).
 * Después (aparte): 🏛 padrón de SUNAT (robot, 3–5 min) y 🌐 IA con búsqueda en internet.
 */
function TGQ_fuentes_(ss, cfg) {
  var porVoucher = {};
  try {
    leerVouchers_(cfg).pagos.forEach(function (p) {
      if (!p.beneficiarioRuc || !p.beneficiarioNombre) return;
      var k = normNombre_(p.beneficiarioNombre), x = porVoucher[k] = porVoucher[k] || { rucs: {}, n: 0, nombre: p.beneficiarioNombre };
      x.rucs[p.beneficiarioRuc] = (x.rucs[p.beneficiarioRuc] || 0) + 1; x.n++;
    });
  } catch (e) { Logger.log('RUC — vouchers: ' + e.message); }
  var poolVouchers = Object.keys(porVoucher).map(function (k) {
    var r = Object.keys(porVoucher[k].rucs);   // solo si siempre llevan el mismo RUC
    return r.length === 1 ? { ruc: r[0], nombre: porVoucher[k].nombre, pal: RPN_palabras_(porVoucher[k].nombre), n: porVoucher[k].n } : null;
  }).filter(Boolean);
  var docs = [], porDoc = {}, mapa = {};
  try { docs = leerDocumentosSire_(cfg, buscarLiquidaciones_(cfg)); } catch (e) { Logger.log('RUC — SIRE: ' + e.message); }
  docs.forEach(function (d) {
    if (!d.emisorRuc) return;
    porDoc[String(d.serie).toUpperCase() + '-' + Number(d.numero)] = d.emisorRuc;
    if (d.emisorNombre && !mapa[d.emisorRuc] && !cfg.nombreEmpresa[d.emisorRuc]) mapa[d.emisorRuc] = d.emisorNombre;
  });
  var c = ANA_ctx_(ss);
  return { cfg: cfg, porDoc: porDoc, fuentes: [
    { pool: poolVouchers, como: function (x) { return '🧾 otros vouchers de ' + x.nombre + ' ya tienen este RUC (' + x.n + ')'; } },
    { pool: Object.keys(mapa).map(function (r) { return { ruc: r, nombre: mapa[r], pal: RPN_palabras_(mapa[r]) }; }), como: function (x) { return '📑 tus facturas del SIRE: ' + x.nombre; } },
    { pool: TGQ_pool_(c, 'honorarios', 'Recibos', 'RUC emisor', /^Emisor/), como: function (x) { return '🧑‍💼 recibos por honorarios: ' + x.nombre; } },
    { pool: TGQ_pool_(c, 'retenciones', 'Emitidas', 'RUC proveedor', /^Proveedor/), como: function (x) { return '🧾 retenciones (CRE): ' + x.nombre; } },
  ] };
}

/** Candidatos para un nombre (y su factura, si se sabe): {sug, como} si hay uno claro; si no {opciones:[{ruc, nombre, puntaje, fuente}]}. */
function TGQ_candidatos_(fx, nombre, refs) {
  var alias = nombre && fx.cfg.aliasNombre[normNombre_(nombre)];
  if (alias) return { sug: alias, como: '⚙️ alias confirmado (Config)', opciones: [] };
  var m = String(refs || '').toUpperCase().match(/([A-Z]\w{3})-0*(\d+)/), r = m && fx.porDoc[m[1] + '-' + Number(m[2])];
  if (r && !fx.cfg.nombreEmpresa[r]) return { sug: r, como: '📑 emisor de su factura ' + m[1] + '-' + m[2] + ' en el SIRE', opciones: [] };
  var opciones = [];
  if (!nombre) return { opciones: opciones };
  for (var i = 0; i < fx.fuentes.length; i++) {
    var cands = RPN_buscarPropios_(fx.fuentes[i].pool, nombre);
    if (!cands[0]) continue;
    var x = fx.fuentes[i].pool.filter(function (p) { return p.ruc === cands[0].ruc; })[0] || cands[0];
    if (RPN_claro_(cands)) return { sug: cands[0].ruc, como: fx.fuentes[i].como(x) + ' (' + cands[0].puntaje + ' pts)', opciones: [] };
    cands.forEach(function (cd) {
      if (opciones.some(function (o) { return o.ruc === cd.ruc; })) return;
      var y = fx.fuentes[i].pool.filter(function (p) { return p.ruc === cd.ruc; })[0] || cd;
      opciones.push({ ruc: cd.ruc, nombre: cd.nombre, puntaje: cd.puntaje, fuente: fx.fuentes[i].como(y).split(':')[0] });
    });
  }
  return { opciones: opciones.sort(function (a, b) { return b.puntaje - a.puntaje; }).slice(0, 4) };
}

/** RUC sugerido para cada voucher sin RUC de las tandas (todas las fuentes de TGQ_fuentes_). */
function TGQ_sugerir_(ss, cfg, tandas) {
  var faltan = [];
  tandas.forEach(function (t) { t.filas.forEach(function (f) { if (!f.ruc) faltan.push(f); }); });
  if (!faltan.length) return;
  var fx = TGQ_fuentes_(ss, cfg);
  faltan.forEach(function (f) {
    var r = TGQ_candidatos_(fx, f.prov, f.refs);
    if (r.sug) { f.sug = r.sug; f.como = r.como; return; }
    if (r.opciones[0]) f.posible = r.opciones[0].ruc + ' ' + r.opciones[0].nombre + ' — ' + r.opciones[0].fuente;
    f.opciones = r.opciones;
  });
}

/** [{ruc, nombre, pal}] de una pestaña de otra hoja del grupo (Honorarios, Retenciones…). [] si no se puede leer. */
function TGQ_pool_(c, libro, hoja, colRuc, colNombre) {
  try {
    var t = TG_tablaLibro_(c, libro, hoja), jr = TG_col_(t.columnas, colRuc), jn = TG_col_(t.columnas, colNombre), m = {};
    if (jr < 0 || jn < 0) return [];
    t.filas.forEach(function (f) { var r = aRuc_(f[jr]); if (r && f[jn] && !m[r]) m[r] = String(f[jn]); });
    return Object.keys(m).map(function (r) { return { ruc: r, nombre: m[r], pal: RPN_palabras_(m[r]) }; });
  } catch (e) { Logger.log('Procesados — ' + libro + ': ' + e.message); return []; }
}

/* ============================================================ padrón SUNAT + IA en internet (en segundo plano) */

/**
 * Lo que siga sin RUC se pide al robot del padrón de SUNAT (ruc-por-nombre.yml). Cuando vuelve (RPN_gh_ → TGQ_trasPadron_),
 * lo que el padrón no resolvió se busca con IA en internet, y llega un 2.º mensaje con lo encontrado y el botón ✅.
 */
function TGQ_externos_(ss, tandas, origen, chat) {
  var faltan = [], filas = {};
  tandas.forEach(function (t) {
    t.filas.forEach(function (f) {
      if (f.ruc || f.sug || !f.prov || f.colRuc < 1) return;
      var k = normNombre_(f.prov);
      if (!filas[k]) faltan.push({ q: f.prov });
      (filas[k] = filas[k] || []).push({ hoja: f.hoja, fila: f.fila, col: f.colRuc, prov: f.prov });
    });
  });
  if (!faltan.length) return '';
  var err = RPN_lanzar_(ss, faltan.slice(0, 30), { origen: origen, chat: chat, procesados: filas });
  return err || '⏳ Busco ' + faltan.length + ' proveedor(es) sin RUC en el padrón de SUNAT y, si no queda claro, con IA en internet. Le aviso aquí en 3–5 minutos.';
}

/** Vuelta del padrón (desde RPN_gh_): propuesta con lo del padrón + internet, al mismo chat; si hay dudas, botones para elegir. */
function TGQ_trasPadron_(ex, res, error) {
  var ss = TG_ss_(), cambios = [], lineas = [], elecciones = [], n = 0, porNombre = {};
  var est = function (x) { return x.estado && !/^ACTIVO$/i.test(x.estado) ? ' [' + x.estado + (x.condicion ? ' · ' + x.condicion : '') + ']' : ''; };
  (res || []).forEach(function (r) { porNombre[normNombre_(r.q)] = r.candidatos || []; });
  Object.keys(ex.procesados || {}).forEach(function (k) {
    var lista = ex.procesados[k], prov = lista[0].prov, filasTxt = lista.map(function (f) { return f.hoja + '!' + f.fila; }).join(', ');
    var cands = (porNombre[k] || []).slice().sort(function (a, b) { return b.puntaje - a.puntaje; });
    var claro = cands.length && RPN_claro_(cands) && (!cands[0].estado || /^ACTIVO$/i.test(cands[0].estado));
    if (claro) {
      var como = '🏛 padrón de SUNAT: ' + cands[0].nombre + ' (' + cands[0].puntaje + ' pts, ACTIVO)';
      lista.forEach(function (f) {
        cambios.push({ id: String(++n), hoja: f.hoja, fila: f.fila, col: f.col, encabezado: 'ID Beneficiario', actual: '', nuevo: cands[0].ruc, motivo: prov + ' · ' + como });
      });
      lineas.push('✅ ' + prov + ' → ' + cands[0].ruc + '\n   ' + como + ' · filas ' + filasTxt);
      return;
    }
    // Dudoso: opciones del padrón (las 3 mejores) y la de internet, para que la persona elija con un botón.
    var opciones = cands.slice(0, 3).map(function (x) { return { ruc: x.ruc, nombre: x.nombre, det: '🏛 padrón ' + x.puntaje + ' pts' + est(x) }; });
    var web = TGQ_internet_(prov);
    if (web && !opciones.some(function (o) { return o.ruc === web.ruc; })) {
      if (opciones.length >= 3) opciones.pop();
      opciones.unshift({ ruc: web.ruc, nombre: web.nombre, det: '🌐 internet' + (web.fuente ? ' (' + web.fuente + ')' : '') });
    } else if (web) opciones.forEach(function (o) { if (o.ruc === web.ruc) o.det += ' · 🌐 también en internet'; });
    if (!opciones.length) { lineas.push('❓ ' + prov + ': no lo encontré en el padrón ni en internet · filas ' + filasTxt); return; }
    lineas.push('🤔 ' + prov + ': hay ' + opciones.length + ' opción(es) · filas ' + filasTxt + ' (elija abajo)');
    elecciones.push({ prov: prov, filas: lista, opciones: opciones });
  });
  var texto = '🔎 Búsqueda externa (padrón de SUNAT + IA en internet)' + (error ? ' · ⚠️ ' + error : '') + ':\n' + (lineas.join('\n') || 'nada nuevo.');
  var vis = [];
  if (cambios.length) {
    ANX_guardarPropuestos_(ss, cambios);
    vis = cambios.map(function (x) { return { id: x.id, fila: x.hoja + '!' + x.fila, columna: 'ID Beneficiario', actual: '', nuevo: x.nuevo, motivo: x.motivo }; });
  }
  var numero = String(ex.chat || '').replace(/\D/g, '');
  if (ex.origen === 'tg' && ex.chat) {
    TG_enviar_(ex.chat, TG_esc_(texto));
    if (vis.length) TG_mostrarCambios_({ chatId: ex.chat }, vis);
  } else if (ex.origen === 'wa') {
    var botones = vis.length ? { k: TG_guardarBoton_({ t: 'cambios', ids: vis.map(function (x) { return x.id; }) }),
      texto: '✏️ ¿Escribo ' + vis.length + ' RUC del padrón de SUNAT en la columna ID Beneficiario de Vouchers? (solo celdas vacías, se puede deshacer)',
      opciones: [{ op: 'si', titulo: '✅ Escribir RUC' }, { op: 'no', titulo: '✖ No' }] } : null;
    try { TGC_wa_({ tipo: 'texto', numero: numero, texto: texto, botones: botones }); } catch (e) {}
  }
  elecciones.forEach(function (el) { TGQ_preguntarEleccion_(ex, el); });
}

/** "¿Cuál es el RUC de …?" con un botón por opción (Telegram: todas + Ninguno; WhatsApp: hasta 3). */
function TGQ_preguntarEleccion_(ex, el) {
  var k = TG_guardarBoton_({ t: 'rucelige', prov: el.prov, filas: el.filas, opciones: el.opciones });
  // Para responder (citando) este mensaje con el nombre o el RUC, sin tocar 🔎 (TGQ_citaEleccion_).
  CacheService.getScriptCache().put('tgq_e_' + ex.chat + '_' + normNombre_(el.prov), JSON.stringify({ prov: el.prov, filas: el.filas }), 21600);
  var filasTxt = el.filas.map(function (f) { return f.hoja + '!' + f.fila; }).join(', ');
  var detalle = el.opciones.map(function (o, i) { return (i + 1) + '. ' + o.ruc + ' ' + o.nombre + ' — ' + o.det; }).join('\n');
  if (ex.origen === 'tg' && ex.chat) {
    var teclado = el.opciones.map(function (o, i) {
      return [{ text: (i + 1) + '. ' + o.ruc + ' ' + String(o.nombre).slice(0, 38), callback_data: 'k:' + k + ':' + i }];
    }).concat([[{ text: '🔎 Buscar con otro nombre (o escribir el RUC)', callback_data: 'k:' + k + ':n' }], [{ text: '✖ Ninguno', callback_data: 'k:' + k + ':x' }]]);
    TG_enviar_(ex.chat, '🤔 <b>¿Cuál es el RUC de ' + TG_esc_(el.prov) + '?</b> (' + TG_esc_(filasTxt) + ')\n' + TG_esc_(detalle) +
      '\n<i>Al elegir lo escribo en ID Beneficiario (se puede deshacer) y lo guardo como alias para la próxima. ' +
      '¿No es ninguno? Toque 🔎 o responda (cite) este mensaje con el nombre completo o el RUC.</i>', teclado);
  } else if (ex.origen === 'wa') {
    try {
      TGC_wa_({ tipo: 'texto', numero: String(ex.chat || '').replace(/\D/g, ''), texto: '🤔 *¿Cuál es el RUC de ' + el.prov + '?* (' + filasTxt + ')\n' + detalle +
        '\nAl elegir lo escribo en ID Beneficiario (se puede deshacer) y lo guardo como alias. ¿No es ninguno? Responda (cite) este mensaje con el nombre completo o el RUC.',
        botones: { k: k, texto: 'Elija el RUC de ' + String(el.prov).slice(0, 60), opciones: el.opciones.slice(0, 3).map(function (o, i) {
          return { op: String(i), titulo: (i + 1) + '. ' + o.ruc };
        }) } });
      TGC_wa_({ tipo: 'texto', numero: String(ex.chat || '').replace(/\D/g, ''), texto: '', botones: { k: k,   // WhatsApp: máx. 3 botones por mensaje
        texto: '¿No es ninguno para ' + String(el.prov).slice(0, 60) + '? Puedo buscar con el nombre completo que usted me escriba (o escríbame el RUC).',
        opciones: [{ op: 'n', titulo: '🔎 Otro nombre' }, { op: 'x', titulo: '✖ Ninguno' }] } });
    } catch (e) {}
  }
}

/** Escribe el RUC elegido en esas filas y lo guarda como alias del nombre. → texto del resultado. */
function TGQ_elegir_(acc, op, clave) {
  if (op === 'x' || !acc.opciones[Number(op)]) return 'Listo, no escribí nada. Si sabe el RUC, escríbamelo: «en la fila ' + (acc.filas[0] || {}).fila + ' el RUC es …».';
  var o = acc.opciones[Number(op)], ss = TG_ss_(), n = 0;
  if (TG_yaVisto_('rucelige' + acc.prov + o.ruc + acc.filas.map(function (f) { return f.fila; }).join(','))) return 'Eso ya se escribió.';
  var cambios = acc.filas.map(function (f) {
    return { id: String(++n), hoja: f.hoja, fila: f.fila, col: f.col, encabezado: 'ID Beneficiario', actual: '', nuevo: o.ruc, motivo: acc.prov + ' · elegido por la persona: ' + o.nombre + ' (' + o.det + ')' };
  });
  ANX_guardarPropuestos_(ss, cambios);
  var r = ANX_aplicarDet_(ss, cambios.map(function (x) { return x.id; }), false);
  if (r.lote) TGU_anotar_(clave, { desc: '✏️ RUC de ' + acc.prov, lotes: [r.lote] });
  var alias = TGQ_alias_(ss, acc.prov, o.ruc);
  return r.mensaje + (alias ? '\n💾 ' + acc.prov + ' → ' + o.ruc + ' quedó como alias (⚙️ Config): la próxima vez sale solo.' : '');
}

/** Agrega nombre → RUC a la tabla de alias de ⚙️ Config (columnas I:J) si no estaba. */
function TGQ_alias_(ss, nombre, ruc) {
  var cfgSh = ss.getSheetByName(HOJA.CONFIG);
  if (!cfgSh || !nombre) return false;
  var ult = Math.max(cfgSh.getLastRow(), 3), col = cfgSh.getRange(3, 9, ult - 2, 1).getValues(), fila = 3;
  for (var i = 0; i < col.length; i++) if (normNombre_(col[i][0]) === normNombre_(nombre)) return false;
  for (var k = col.length - 1; k >= 0; k--) if (String(col[k][0]).trim()) { fila = k + 4; break; }
  cfgSh.getRange(fila, 10).setNumberFormat('@');
  cfgSh.getRange(fila, 9, 1, 2).setValues([[String(nombre), String(ruc)]]);
  return true;
}

function TGQ_eligeTG_(ctx, datos, op) {
  TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
  if (op === 'n') {
    var pn;
    try { pn = TGQ_pedirNombre_(ctx.chatId, datos); } catch (e) { pn = '❌ ' + e.message + '\nResponda (cite) la pregunta con el nombre completo o el RUC.'; }
    return TG_enviar_(ctx.chatId, TG_esc_(pn));
  }
  var t;
  try { t = TGQ_elegir_(datos, op, ctx.chatId); } catch (e) { t = '❌ ' + e.message; }
  TG_enviar_(ctx.chatId, TG_esc_(t), /✅/.test(t) ? [[{ text: '↩️ Deshacer', callback_data: 'k:' + TG_guardarBoton_({ t: 'deshacer' }) }]] : null);
}

function TGQ_eligeWA_(acc, op, numero) {
  if (op === 'n') return { ok: true, respuesta: TGQ_pedirNombre_('wa' + String(numero || '').replace(/\D/g, ''), acc) };
  var t;
  try { t = TGQ_elegir_(acc, op, 'wa' + String(numero || '').replace(/\D/g, '')); } catch (e) { t = '❌ ' + e.message; }
  return { ok: true, respuesta: t + (/✅/.test(t) ? '\nSi algo salió mal, escriba *deshacer*.' : '') };
}

/** 🔎 "Buscar con otro nombre": el próximo mensaje de la persona es el nombre (o el RUC) a buscar para esas filas. */
function TGQ_pedirNombre_(clave, acc) {
  var ses = TG_sesion_(clave);
  ses.esperando = { tipo: 'tgqnombre', acc: { prov: acc.prov, filas: acc.filas } };
  TG_guardarSesion_(clave, ses);
  return '✍️ Escríbame el nombre completo o la razón social con la que busco el RUC de «' + acc.prov + '» (filas ' +
    acc.filas.map(function (f) { return f.hoja + '!' + f.fila; }).join(', ') + ').\nEj.: DISTRIBUIDORA EXCLUSIVA DE PRODUCTOS DE CALIDAD · ' +
    'SUPERINTENDENCIA NACIONAL DE ADUANAS Y DE ADMINISTRACION TRIBUTARIA. Si ya sabe el RUC, escríbalo (11 dígitos) y lo anoto.';
}

/** Citó una pregunta «¿Cuál es el RUC de X?»: {prov, filas} de esa pregunta, o null. */
function TGQ_citaEleccion_(chat, citado) {
  var m = String(citado || '').replace(/\*/g, '').match(/¿Cu[aá]l es el RUC de (.+?)\?/);
  var s = m && CacheService.getScriptCache().get('tgq_e_' + chat + '_' + normNombre_(m[1].trim()));
  return s ? JSON.parse(s) : null;
}

/** Telegram: el nombre (o RUC) escrito tras 🔎 o citando la pregunta. */
function TGQ_nombreTG_(ctx, acc, texto) {
  TG_accion_(ctx.chatId, 'typing');
  var tq;
  try { tq = TGQ_otroNombre_(acc, texto, 'tg', ctx.chatId); } catch (err) { tq = '❌ ' + err.message; }
  return TG_enviar_(ctx.chatId, TG_esc_(tq), /✅/.test(tq) ? [[{ text: '↩️ Deshacer', callback_data: 'k:' + TG_guardarBoton_({ t: 'deshacer' }) }]] : null);
}

/** WhatsApp: lo mismo; devuelve la respuesta para TGW_responder_. */
function TGQ_nombreWA_(acc, texto, clave) {
  var tq;
  try { tq = TGQ_otroNombre_(acc, texto, 'wa', clave); } catch (err) { tq = '❌ ' + err.message; }
  return { ok: true, respuesta: tq + (/✅/.test(tq) ? '\nSi algo salió mal, escriba *deshacer*.' : ''), tablas: [], sugerencias: [], archivos: [], avisos: [] };
}

/**
 * Respuesta a 🔎: con un RUC válido lo escribe; con un nombre busca en las fuentes propias y con IA en internet (al momento,
 * con botones para elegir) y además en el padrón de SUNAT (llega en 3–5 min). El alias se guarda con el nombre del voucher.
 */
function TGQ_otroNombre_(acc, texto, origen, chat) {
  var ss = TG_ss_(), t = String(texto || '').trim(), ruc = (t.replace(/[\s.-]/g, '').match(/\b\d{11}\b/) || [''])[0];
  if (ruc) {
    if (!TGQ_rucValido_(ruc)) { TGQ_pedirNombre_(chat, acc); return '⚠️ ' + ruc + ' no es un RUC válido (dígito verificador). Revíselo y escríbalo de nuevo (o el nombre).'; }
    return TGQ_elegir_({ prov: acc.prov, filas: acc.filas, opciones: [{ ruc: ruc, nombre: t, det: '✍️ escrito por usted' }] }, '0', chat);
  }
  if (t.length < 3) { TGQ_pedirNombre_(chat, acc); return 'Necesito un nombre un poco más completo: escríbalo de nuevo.'; }
  var opciones = [];
  try {
    var r = TGQ_candidatos_(TGQ_fuentes_(ss, leerConfig_(ss)), t, '');
    if (r.sug) opciones.push({ ruc: r.sug, nombre: t, det: r.como });
    (r.opciones || []).forEach(function (o) { opciones.push({ ruc: o.ruc, nombre: o.nombre, det: o.fuente + ' ' + o.puntaje + ' pts' }); });
  } catch (e) { Logger.log('Procesados — otro nombre: ' + e.message); }
  var web = TGQ_internet_(t);
  if (web) {
    var ya = opciones.filter(function (o) { return o.ruc === web.ruc; })[0];
    if (ya) ya.det += ' · 🌐 también en internet';
    else opciones.unshift({ ruc: web.ruc, nombre: web.nombre, det: '🌐 internet' + (web.fuente ? ' (' + web.fuente + ')' : '') });
  }
  var pad = {}; pad[normNombre_(t)] = acc.filas;
  var err = RPN_lanzar_(ss, [{ q: t }], { origen: origen, chat: chat, procesados: pad });
  var tras = err ? '' : '\n⏳ También lo busco en el padrón de SUNAT con ese nombre; le aviso en 3–5 minutos.';
  if (!opciones.length) return '🔎 Con «' + t + '» no encontré nada en sus hojas ni en internet.' + tras;
  TGQ_preguntarEleccion_({ origen: origen, chat: chat }, { prov: acc.prov, filas: acc.filas, opciones: opciones.slice(0, 4) });
  return '🔎 Con «' + t + '» encontré ' + Math.min(opciones.length, 4) + ' opción(es): elija arriba.' + tras;
}

/** IA con búsqueda en Google: RUC de una empresa o persona peruana → {ruc, nombre, fuente} o null. El RUC se valida (dígito verificador). */
function TGQ_internet_(nombre) {
  var clave = '';
  try { clave = TGG_clave_(); } catch (e) { return null; }
  var pedido = 'Busca en internet el RUC (Perú, SUNAT, 11 dígitos) de: "' + nombre + '". Puede ser una empresa o una persona con negocio. ' +
    'Responde SOLO JSON: {"ruc":"11 dígitos o vacío","nombre":"razón social tal como figura","fuente":"página donde lo viste (dominio)","seguro":true|false}. ' +
    'Si es una sigla o nombre comercial (ej. SUNAT, DSM), busca la razón social que le corresponde. ' +
    'Si hay varias personas o empresas con nombre parecido y no puedes distinguir, seguro=false. No inventes.';
  for (var i = 0; i < TGG_MODELOS_.length; i++) {
    try {
      var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + TGG_MODELOS_[i] + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': clave },
        payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: pedido }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0 } }) });
      if (r.getResponseCode() !== 200) continue;
      var cand = (JSON.parse(r.getContentText()).candidates || [])[0];
      var t = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
      var j = t ? IA_extraerJson_(t) : null, ruc = j ? String(j.ruc || '').replace(/\D/g, '') : '';
      return ruc && TGQ_rucValido_(ruc) && j.seguro !== false ? { ruc: ruc, nombre: String(j.nombre || ''), fuente: String(j.fuente || '').slice(0, 80) } : null;
    } catch (e) { Logger.log('Procesados — internet: ' + e.message); }
  }
  return null;
}

/** RUC peruano válido: 11 dígitos, empieza en 10/15/16/17/20 y dígito verificador correcto. */
function TGQ_rucValido_(r) {
  if (!/^(10|15|16|17|20)\d{9}$/.test(r)) return false;
  var f = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], s = 0;
  for (var i = 0; i < 10; i++) s += Number(r.charAt(i)) * f[i];
  var d = 11 - (s % 11);
  return (d === 10 ? 0 : d === 11 ? 1 : d) === Number(r.charAt(10));
}

/** Cambios para escribir los RUC sugeridos en la hoja de Vouchers (los guarda como propuestos). → [{id, fila(texto), columna, nuevo, motivo}] */
function TGQ_cambios_(ss, tandas) {
  var cambios = [], n = 0;
  tandas.forEach(function (t) {
    t.filas.forEach(function (f) {
      if (f.ruc || !f.sug || f.colRuc < 1) return;
      cambios.push({ id: String(++n), hoja: f.hoja, fila: f.fila, col: f.colRuc, encabezado: 'ID Beneficiario', actual: '', nuevo: f.sug,
        motivo: (f.prov || 'proveedor') + ' · ' + f.como });
    });
  });
  if (!cambios.length) return [];
  ANX_guardarPropuestos_(ss, cambios);
  return cambios.map(function (x) { return { id: x.id, fila: x.hoja + '!' + x.fila, columna: 'ID Beneficiario', actual: '', nuevo: x.nuevo, motivo: x.motivo }; });
}

/** Texto del resumen (html para Telegram, *negrita* para WhatsApp). */
function TGQ_texto_(r, html) {
  var b = function (s) { return html ? '<b>' + TG_esc_(s) + '</b>' : '*' + s + '*'; };
  var e = html ? TG_esc_ : String;
  var q = r.q, pedido = q.archivos.length ? q.archivos.map(function (a) { return a.fecha + ' ' + a.nombre; }).join(', ')
    : (q.fechas.join(', ') || 'todas las fechas') + (q.nombres.length ? ' · ' + q.nombres.join(', ') : '') + (q.ultimos ? ' · últimas ' + q.ultimos : '');
  if (!r.tandas.length) return '📋 No encontré vouchers procesados de ' + e(pedido) + '.\nPruebe: ' + b('procesados hoy') + ', ' + b('procesados ayer sonia') +
    ', ' + b('procesados 26-10-26 Sonia') + ' o ' + b('procesados del 14 de octubre') + '.';
  var total = 0, sinRuc = 0, conSug = 0, L = [];
  r.tandas.forEach(function (t) {
    L.push('');
    L.push('🗂 ' + b(t.nombre) + ' · ' + t.filas.length + ' voucher(s)');
    t.filas.forEach(function (f) {
      total++;
      var estado = f.ruc ? '✅ RUC ' + f.ruc : f.sug ? (conSug++, sinRuc++, '💡 falta RUC → ' + f.sug + ' (' + f.como + ')') :
        (sinRuc++, '❓ falta RUC' + (f.posible ? ' (¿' + f.posible + '?)' : '') + (f.prov ? '' : ' · sin nombre del proveedor'));
      L.push('• ' + f.hoja + '!' + f.fila + ' · ' + (f.fecha ? Utilities.formatDate(f.fecha, 'America/Lima', 'dd/MM') : '') + ' · ' + f.moneda + ' ' +
        Number(f.monto).toFixed(2) + ' · ' + e((f.prov || '(sin proveedor)').slice(0, 40)) + '\n   ' + e(estado));
    });
  });
  if (L.length > 90) L = L.slice(0, 90).concat(['…']);
  return '📋 ' + b('Vouchers procesados') + ' · ' + e(pedido) + (r.ampliado ? '\n' + e(r.ampliado) : '') + '\n' + r.tandas.length + ' tanda(s) · ' + total +
    ' voucher(s) · ' + (sinRuc ? sinRuc + ' sin RUC del proveedor' + (conSug ? ' (' + conSug + ' con RUC sugerido)' : '') : 'todos con RUC ✅') + L.join('\n') +
    '';
}

/* ============================================================ 🤖 análisis con IA de la tanda */

var TGQ_MAX_IA_ = 15;   // vouchers por análisis (los que les falta algo primero)

/**
 * Pedido para la IA (Telegram, WhatsApp o 💬 chat de la hoja) sobre las filas de la tanda: a qué factura / recibo por
 * honorarios corresponde cada pago, qué empresa del grupo paga, si la foto del voucher ya dice la factura, y cuáles
 * están pendientes de emitir retención. La IA solo PROPONE (asignar_voucher / proponer_cambio / proponer_retencion):
 * se escribe o emite cuando la persona aprueba con ✅.
 * filas = [{fila:"Originales!12", fecha, monto, moneda, prov, ruc, refs, empresa, op}]
 */
function TGQ_promptAnalisis_(nombres, filas) {
  var falta = function (f) { return (!f.refs ? 1 : 0) + (!f.empresa ? 1 : 0) + (!f.ruc ? 1 : 0); };
  var lista = filas.slice().sort(function (a, b) { return falta(b) - falta(a); }).slice(0, TGQ_MAX_IA_);
  var L = lista.map(function (f) {
    var fecha = f.fecha instanceof Date ? Utilities.formatDate(f.fecha, 'America/Lima', 'dd/MM/yyyy') : String(f.fecha || '');
    return '- ' + f.fila + ' · ' + fecha + ' · ' + f.moneda + ' ' + Number(f.monto).toFixed(2) + ' · ' + (f.prov || '(sin proveedor)') +
      ' · RUC: ' + (f.ruc || 'FALTA') + ' · empresa: ' + (f.empresa || 'FALTA') + ' · factura: ' + (f.refs || 'FALTA') + (f.op ? ' · op ' + f.op : '');
  });
  return 'Analiza los vouchers procesados de ' + nombres.join(', ') + ' (' + lista.length + (filas.length > lista.length ? ' de ' + filas.length : '') + '):\n' +
    L.join('\n') + '\n\n' +
    'Para CADA voucher:\n' +
    '1. Abre su imagen con verificar_vouchers y mira si el voucher mismo dice la factura, el recibo o el concepto (glosa, referencia, nombre).\n' +
    '2. Busca qué comprobante paga: facturas por pagar del proveedor (facturas / combinar: exacto, neto de retención 3% o de detracción) ' +
    'o recibo por honorarios (honorarios_conciliacion). Si el RUC falta, búscalo con buscar_ruc.\n' +
    '3. Decide qué empresa del grupo hizo el pago (la que tiene esa factura por pagar o la cuenta de origen del voucher).\n' +
    '4. Si hay datos que lo respalden, llama asignar_voucher {fila, empresa, proveedor_ruc, facturas, motivo} (o proponer_cambio para un solo dato). ' +
    'No propongas lo que ya está escrito ni lo que sea dudoso: en ese caso da las opciones y pregunta.\n' +
    '5. Retención: indica qué vouchers están PENDIENTES DE EMITIR RETENCIÓN (CRE): la empresa pagadora es agente de retención, el proveedor no es ' +
    'buen contribuyente ni agente de retención (padron_ruc), el comprobante supera S/ 700 y no hay CRE ya emitido (retenciones_sunat). ' +
    'Para esos llama proponer_retencion {factura, empresa, proveedor}.\n' +
    'Responde con una tabla: fila, monto, proveedor, factura o recibo, empresa, RUC, ¿se ve en la foto?, ¿retener?, propuesta; y al final la lista de retenciones pendientes.';
}

/** Filas de las tandas en el formato de TGQ_promptAnalisis_. */
function TGQ_filasIA_(tandas) {
  var out = [];
  tandas.forEach(function (t) { t.filas.forEach(function (f) {
    out.push({ fila: f.hoja + '!' + f.fila, fecha: f.fecha, monto: f.monto, moneda: f.moneda, prov: f.prov, ruc: f.ruc || (f.sug ? f.sug + ' (sugerido, falta escribir)' : ''),
      refs: f.refs, empresa: f.empresa, op: f.op });
  }); });
  return out;
}

var TGQ_TXT_IA_ = '🤖 ¿Analizo con IA a qué factura o recibo por honorarios corresponde cada voucher, qué empresa del grupo pagó (también mirando la foto) ' +
  'y cuáles están pendientes de emitir retención? Solo propongo: usted aprueba con ✅.';

/* ============================================================ Telegram */

function TGQ_tg_(ctx, texto) {
  TG_accion_(ctx.chatId, 'typing');
  var r;
  try { r = TGQ_buscar_(ctx.ss, texto); } catch (e) { return TG_enviar_(ctx.chatId, '❌ ' + TG_esc_(e.message)); }
  TG_enviar_(ctx.chatId, TGQ_texto_(r, true));
  var cambios = TGQ_cambios_(ctx.ss, r.tandas);
  if (cambios.length) TG_mostrarCambios_(ctx, cambios);   // ✅ Escribir · ✖ No (TG_IA.js) · ↩️ Deshacer
  var ext = TGQ_externos_(ctx.ss, r.tandas, 'tg', ctx.chatId);
  if (ext) TG_enviar_(ctx.chatId, TG_esc_(ext));
  if (r.tandas.length) {   // 🤖 el botón pregunta a la IA (t:'sug' → TG_preguntar_)
    var pedido = TGQ_promptAnalisis_(r.tandas.map(function (t) { return t.nombre; }), TGQ_filasIA_(r.tandas));
    TG_enviar_(ctx.chatId, TG_esc_(TGQ_TXT_IA_), [[{ text: '🤖 Analizar con IA (factura, empresa, retención)', callback_data: 'k:' + TG_guardarBoton_({ t: 'sug', texto: pedido }) }]]);
  }
}

/* ============================================================ WhatsApp */

function TGQ_wa_(ss, texto, clave) {
  var r;
  try { r = TGQ_buscar_(ss, texto); } catch (e) { return { ok: true, respuesta: '❌ ' + e.message, tablas: [], sugerencias: [], archivos: [], avisos: [] }; }
  var out = { ok: true, respuesta: TGQ_texto_(r, false), tablas: [], sugerencias: [], archivos: [], avisos: [] };
  var ext = TGQ_externos_(ss, r.tandas, 'wa', clave);
  if (ext) out.respuesta += '\n\n' + ext;
  var cambios = TGQ_cambios_(ss, r.tandas);
  if (cambios.length) {
    var k = TG_guardarBoton_({ t: 'cambios', ids: cambios.map(function (x) { return x.id; }), clave: clave });
    out.botones = [{ k: k, texto: '✏️ ¿Escribo ' + cambios.length + ' RUC sugerido(s) en la columna ID Beneficiario de la hoja de Vouchers? (solo celdas vacías, se puede deshacer)',
      opciones: [{ op: 'si', titulo: '✅ Escribir RUC' }, { op: 'no', titulo: '✖ No' }] }];
  }
  if (r.tandas.length) {
    var pedido = TGQ_promptAnalisis_(r.tandas.map(function (t) { return t.nombre; }), TGQ_filasIA_(r.tandas));
    (out.botones = out.botones || []).push({ k: TG_guardarBoton_({ t: 'tgqia', texto: pedido }), texto: TGQ_TXT_IA_,
      opciones: [{ op: 'si', titulo: '🤖 Analizar con IA' }, { op: 'no', titulo: '✖ No' }] });
  }
  return out;
}

/** Botón 🤖 Analizar con IA en WhatsApp: la misma pregunta que si la escribiera (TGW_responder_). */
function TGQ_iaWA_(acc, op, numero) {
  if (op !== 'si') return { ok: true, respuesta: 'Listo, no analizo nada. Puede pedírmelo cuando quiera con sus palabras.' };
  return TGW_responder_({ numero: numero, texto: acc.texto });
}

/** Botón ✅/✖ de cambios en la hoja de Vouchers desde WhatsApp. */
function TGQ_botonWA_(acc, op, numero) {
  if (op !== 'si') return { ok: true, respuesta: 'Listo, no escribí nada.' };
  if (TG_yaVisto_('wacamb' + acc.ids.join(','))) return { ok: true, respuesta: 'Eso ya se escribió.' };
  var ss = TG_ss_(), r;
  try { r = ANX_aplicarDet_(ss, acc.ids, false); } catch (e) { return { ok: true, respuesta: '❌ ' + e.message }; }
  if (r.lote) TGU_anotar_('wa' + String(numero || '').replace(/\D/g, ''), { desc: '✏️ RUC escritos en Vouchers', lotes: [r.lote] });
  return { ok: true, respuesta: r.mensaje + ((r.enlaces || []).length ? '\n🔗 ' + r.enlaces.slice(0, 5).map(function (x) { return x.fila + ': ' + x.url; }).join('\n') : '') +
    (r.lote ? '\nSi algo salió mal, escriba *deshacer*.' : '') };
}

/* ============================================================ IA (herramienta) */

function TGQ_herramienta_(c, a) {
  var r = TGQ_buscar_(c.ss || TG_ss_(), String(a.consulta || a.texto || 'hoy'));
  var filas = [];
  r.tandas.forEach(function (t) {
    t.filas.forEach(function (f) {
      filas.push([t.nombre, f.hoja + '!' + f.fila, f.fecha ? Utilities.formatDate(f.fecha, 'America/Lima', 'dd/MM/yyyy') : '', f.moneda, f.monto, f.prov, f.op,
        f.ruc || '', f.ruc ? '' : (f.sug || ''), f.ruc ? '' : (f.como || f.posible || '')]);
    });
  });
  return { columnas: ['tanda', 'fila', 'fecha', 'moneda', 'monto', 'proveedor', 'operacion', 'ruc_beneficiario', 'ruc_sugerido', 'como_se_encontro'], filas: filas,
    nota: (r.ampliado ? r.ampliado + ' ' : '') + 'Para escribir un RUC sugerido usa proponer_cambio {fila, campo:"id_beneficiario", valor}. ' +
      'O dile a la persona que escriba "procesados …" para ver el botón ✅.' };
}

/* ============================================================ IA: buscar_ruc (chat de la hoja, Telegram y WhatsApp) */

/** Herramienta de la IA: RUC de un nombre en todas las fuentes (y en internet si no queda claro), diciendo dónde lo encontró. */
function TGQ_buscarRucHerr_(c, a) {
  var nombre = String(a.nombre || a.proveedor || '').trim();
  if (!nombre) return { columnas: [], filas: [], nota: 'Indique el nombre del proveedor.' };
  var fx = c._tgqFx = c._tgqFx || TGQ_fuentes_(c.ss || TG_ss_(), c.cfg || leerConfig_(c.ss || TG_ss_()));
  var r = TGQ_candidatos_(fx, nombre, a.factura || '');
  var filas = r.sug ? [[r.sug, '', 100, r.como, 'seguro']] : r.opciones.map(function (o) { return [o.ruc, o.nombre, o.puntaje, o.fuente, 'dudoso']; });
  if (!r.sug && a.internet !== false) {
    var web = TGQ_internet_(nombre);
    if (web) filas.push([web.ruc, web.nombre, '', '🌐 IA en internet' + (web.fuente ? ' (' + web.fuente + ')' : '') + ' · RUC válido', 'verificar']);
  }
  return { columnas: ['ruc', 'nombre', 'puntaje', 'donde_se_encontro', 'confianza'], filas: filas,
    nota: (r.sug ? 'Encontrado con seguridad. ' : filas.length ? 'No hay uno seguro: muestra las opciones y pregunta cuál es. ' : 'No se encontró en las fuentes propias ni en internet. ') +
      'Para escribirlo en Vouchers usa proponer_cambio {fila, campo:"id_beneficiario", valor}. El padrón completo de SUNAT se consulta con 📋 Vouchers procesados → 🏛 (hoja) o escribiendo "procesados …" / "ruc NOMBRE" en el bot.' };
}

/** Herramientas extra para el 💬 Chat con la IA de la hoja (las de solo lectura del asistente + buscar_ruc). */
function CHAT_herrExtra_() {
  var h = {};
  ['vouchers_procesados', 'buscar_ruc', 'honorarios', 'honorarios_conciliacion', 'retenciones_sunat', 'notificaciones', 'sire_liquidacion', 'leer_libro', 'padron_ruc']
    .forEach(function (k) { if (TGH_[k]) h[k] = TGH_[k]; });
  // 🧾 En la hoja no hay botón para emitir: dice qué retención falta y que se emite desde Telegram o WhatsApp.
  h.proponer_retencion = function (c, a) {
    var x = TGR_paraIA_({ ss: c.ss, cfg: c.cfg, op: { tg: { cre: [] } } }, a);
    if (/^PROPUESTO/.test(x.nota)) x.nota = 'PENDIENTE DE EMITIR. Desde la hoja no se emite: dile que escriba en Telegram o WhatsApp ' +
      '«emite la retención de ' + (a.factura || 'esa factura') + '» para ver 👁 Vista previa y ✅ Emitir.';
    return x;
  };
  return h;
}

function CHAT_sistemaExtra_() {
  var nombres = Object.keys(CHAT_herrExtra_()), out = [], tomar = false;
  String(TG_SISTEMA_).split('\n').forEach(function (l) {
    var m = l.match(/^- ([a-z_]+) [{(]/);
    if (m) tomar = nombres.indexOf(m[1]) >= 0;
    else if (!/^ {2}/.test(l)) tomar = false;
    if (tomar) out.push(l);
  });
  return 'HERRAMIENTAS EXTRA (otras hojas del grupo y búsqueda de RUC):\n' + out.join('\n');
}

/* ============================================================ hoja: padrón de SUNAT + internet para los que faltan */

function menuBuscarExternosProcesados() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(TGQ_HOJA_);
  if (!sh || sh.getLastRow() < 3) return ui.alert('Primero use 📋 Ver procesados.');
  var v = sh.getRange(3, 1, sh.getLastRow() - 2, TGQ_ENC_.length).getValues(), nombres = {}, consultas = [];
  v.forEach(function (r) {
    if (r[6] || /^\d{11}$/.test(String(r[7]).trim()) || !r[5]) return;
    var k = normNombre_(r[5]);
    if (!nombres[k]) { nombres[k] = true; consultas.push({ q: String(r[5]) }); }
  });
  if (!consultas.length) return ui.alert('No hay proveedores sin RUC (o ya tienen uno sugerido).');
  var err = RPN_lanzar_(ss, consultas.slice(0, 30), { origen: 'hojaProc' });
  v.forEach(function (r, i) { if (nombres[normNombre_(r[5])] && !r[6]) sh.getRange(i + 3, 9).setValue('⏳ Buscando en el padrón de SUNAT e internet…'); });
  ui.alert('🏛 Padrón e internet', err || 'Busco ' + consultas.length + ' proveedor(es) en el padrón de SUNAT y, si no queda claro, con IA en internet. ' +
    'En 3–5 minutos la columna «RUC sugerido» tendrá una lista para elegir (▼) y «Cómo se encontró» las opciones con su fuente.', ui.ButtonSet.OK);
}

/** Vuelta del padrón para la pestaña 📋 Procesados (RPN_gh_). */
function TGQ_padronEnHoja_(res) {
  var ss = TG_ss_(), sh = ss.getSheetByName(TGQ_HOJA_);
  if (!sh || sh.getLastRow() < 3) return;
  var porNombre = {}, web = {};
  (res || []).forEach(function (r) { porNombre[normNombre_(r.q)] = (r.candidatos || []).slice().sort(function (a, b) { return b.puntaje - a.puntaje; }); });
  var v = sh.getRange(3, 1, sh.getLastRow() - 2, TGQ_ENC_.length).getValues();
  v.forEach(function (r, i) {
    var k = normNombre_(r[5]), cands = porNombre[k];
    if (!cands || r[6]) return;
    var est = function (x) { return x.estado && !/^ACTIVO$/i.test(x.estado) ? ' [' + x.estado + ']' : ''; };
    var opciones = cands.slice(0, 3).map(function (x) { return x.ruc + ' · ' + x.nombre + ' · 🏛 padrón ' + x.puntaje + ' pts' + est(x); });
    var claro = cands.length && RPN_claro_(cands) && (!cands[0].estado || /^ACTIVO$/i.test(cands[0].estado));
    if (!claro) {
      if (web[k] === undefined) web[k] = TGQ_internet_(r[5]);
      if (web[k] && !cands.some(function (x) { return x.ruc === web[k].ruc; })) opciones.unshift(web[k].ruc + ' · ' + web[k].nombre + ' · 🌐 internet' + (web[k].fuente ? ' (' + web[k].fuente + ')' : ''));
    }
    var celda = sh.getRange(i + 3, 8);
    if (opciones.length) celda.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(opciones, true).setAllowInvalid(true).build());
    if (claro) { celda.setValue(cands[0].ruc); sh.getRange(i + 3, 10).setValue(true); }
    sh.getRange(i + 3, 9).setValue(claro ? '🏛 padrón de SUNAT: ' + cands[0].nombre + ' (' + cands[0].puntaje + ' pts, ACTIVO)' :
      opciones.length ? '🤔 Elija en ▼ «RUC sugerido» y marque ✔:\n' + opciones.join('\n') : '❓ No está en el padrón ni en internet: escriba el RUC si lo sabe');
  });
}

/* ============================================================ hoja (menú 💼 Cobranzas) */

function menuVouchersProcesados() {
  var ui = SpreadsheetApp.getUi();
  var p = ui.prompt('📋 Vouchers procesados', '¿Cuáles? Ej.: hoy · hoy sonia · ayer edit · 26-10-26 Sonia(Edit) · 14 de octubre · 2 últimos de sonia',
    ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var ss = SpreadsheetApp.getActive(), r = TGQ_buscar_(ss, p.getResponseText() || 'hoy');
  PropertiesService.getDocumentProperties().setProperty('TGQ_ULTIMA', p.getResponseText() || 'hoy');   // para 🤖 Analizar con IA
  var sh = ss.getSheetByName(TGQ_HOJA_) || ss.insertSheet(TGQ_HOJA_);
  sh.clear(); sh.clearConditionalFormatRules();
  try { sh.getRange(1, 1, sh.getMaxRows(), TGQ_ENC_.length).clearDataValidations(); } catch (e) {}
  sh.getRange(1, 1, 1, TGQ_ENC_.length).merge().setValue('📋 VOUCHERS PROCESADOS · ' + (p.getResponseText() || 'hoy') + (r.ampliado ? ' · ' + r.ampliado : '') +
    ' · Revise el RUC sugerido (o elija en ▼), marque ✔ Escribir y use 💼 Cobranzas → 📋 Vouchers procesados → ✍️ Escribir los RUC marcados. Los que falten: 🏛 Buscar en padrón e internet. ' +
    'Factura, empresa y retención: 🤖 Analizar con IA.')
    .setWrap(true).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.OSCURO);
  sh.setRowHeight(1, 48);
  sh.getRange(2, 1, 1, TGQ_ENC_.length).setValues([TGQ_ENC_]).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true);
  sh.setFrozenRows(2);
  var filas = [];
  r.tandas.forEach(function (t) {
    t.filas.forEach(function (f) {
      filas.push([t.nombre, f.hoja + '!' + f.fila, f.fecha || '', f.monto, f.moneda, f.prov, f.ruc || '', f.ruc ? '' : (f.sug || ''),
        f.ruc ? '✅ ya tiene RUC' : (f.como || (f.posible ? '¿' + f.posible + '? (revise)' : '❓ sin sugerencia: escriba el RUC')), false]);
    });
  });
  if (filas.length) {
    sh.getRange(3, 7, filas.length, 2).setNumberFormat('@');
    sh.getRange(3, 1, filas.length, TGQ_ENC_.length).setValues(filas);
    sh.getRange(3, 10, filas.length, 1).insertCheckboxes();
    sh.getRange(3, 3, filas.length, 1).setNumberFormat('dd/MM/yyyy');
    sh.getRange(3, 4, filas.length, 1).setNumberFormat('#,##0.00');
    filas.forEach(function (f, i) { if (f[7]) sh.getRange(i + 3, 10).setValue(true); });   // los sugeridos ya vienen marcados
    var k = 0;
    r.tandas.forEach(function (t) {
      t.filas.forEach(function (f) {
        if (!f.ruc && !f.sug && (f.opciones || []).length) {   // dudosos: lista para elegir
          sh.getRange(k + 3, 8).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(f.opciones.map(function (o) {
            return o.ruc + ' · ' + o.nombre + ' · ' + o.fuente + ' ' + o.puntaje + ' pts'; }), true).setAllowInvalid(true).build());
        }
        k++;
      });
    });
  }
  [190, 110, 85, 95, 60, 260, 110, 110, 300, 80].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.activate();
  ui.alert('📋 Vouchers procesados', TGQ_texto_(r, false).replace(/\*/g, '').slice(0, 1500), ui.ButtonSet.OK);
}

function menuEscribirRucProcesados() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(TGQ_HOJA_);
  if (!sh || sh.getLastRow() < 3) return ui.alert('Primero use 📋 Vouchers procesados.');
  var v = sh.getRange(3, 1, sh.getLastRow() - 2, TGQ_ENC_.length).getValues(), cfg = leerConfig_(ss);
  var libro = SpreadsheetApp.openById(cfg.idVouchers), cols = {}, cambios = [], n = 0;
  v.forEach(function (r) {
    var ruc = (String(r[7]).match(/\b\d{11}\b/) || [''])[0], m = String(r[1]).match(/^(.+)!(\d+)$/);
    if (r[9] !== true || r[6] || ruc.length !== 11 || !m) return;
    if (cols[m[1]] === undefined) {
      var h = libro.getSheetByName(m[1]);
      cols[m[1]] = h ? indiceColumnas_(h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0])('ID Beneficiario') + 1 : 0;
    }
    if (cols[m[1]] < 1) return;
    cambios.push({ id: String(++n), hoja: m[1], fila: Number(m[2]), col: cols[m[1]], encabezado: 'ID Beneficiario', actual: '', nuevo: ruc,
      motivo: (r[5] || 'proveedor') + ' · desde 📋 Procesados' });
  });
  if (!cambios.length) return ui.alert('No hay filas con ✔ Escribir, sin RUC en Vouchers y con un RUC de 11 dígitos.');
  ANX_guardarPropuestos_(ss, cambios);
  var res = ANX_aplicarDet_(ss, cambios.map(function (x) { return x.id; }), false);
  ui.alert('✍️ RUC en Vouchers', res.mensaje + (res.lote ? '\nPara deshacer: 💼 Cobranzas → ↩️ Deshacer (o «deshacer» en el bot).' : ''), ui.ButtonSet.OK);
}

/** 🤖 Analizar con IA la tanda de 📋 Procesados: abre el 💬 Chat con la IA con el pedido ya enviado (se aprueba con ✅ en el panel). */
function menuAnalizarIAProcesados() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  var q = PropertiesService.getDocumentProperties().getProperty('TGQ_ULTIMA');
  var p = ui.prompt('🤖 Analizar con IA', '¿Qué tanda? (Enter = ' + (q || 'hoy') + ')\nEj.: hoy sonia · 26-10-26 Sonia(Edit) · 14 de octubre', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var r = TGQ_buscar_(ss, String(p.getResponseText() || '').trim() || q || 'hoy');
  if (!r.tandas.length) return ui.alert(TGQ_texto_(r, false).replace(/\*/g, ''));
  var pedido = TGQ_promptAnalisis_(r.tandas.map(function (t) { return t.nombre; }), TGQ_filasIA_(r.tandas));
  PropertiesService.getUserProperties().setProperty('CHAT_AUTO', pedido);
  CHAT_menuAbrir();
}

/** Lo usa ChatPanel.html al abrir: un pedido dejado por un menú (se envía solo una vez). */
function CHAT_pendiente() {
  var up = PropertiesService.getUserProperties(), m = up.getProperty('CHAT_AUTO') || '';
  if (m) up.deleteProperty('CHAT_AUTO');
  return m;
}
