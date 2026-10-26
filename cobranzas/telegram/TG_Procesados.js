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
      prov: col('Proveedor (Beneficiario)'), ruc: col('ID Beneficiario'), refs: col('Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc'), op: col('Numero de oper', 'Numero de operacion') };
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
        op: v.op ? String(v.op[i][0] || '') : '' });
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
  TGQ_sugerir_(ss, cfg, lista, filas);
  return { q: q, tandas: lista, ampliado: ampliado };
}

function TGQ_orden_(dma) { var p = String(dma || '').split('-'); return p.length === 3 ? Number(p[2] + p[1] + p[0]) : 0; }

/**
 * RUC sugerido para cada voucher sin RUC, buscando en TODO lo que tenemos (en este orden, y dice dónde lo encontró):
 *   1. ⚙️ alias confirmados · 2. 📑 emisor de su factura en el SIRE · 3. 🧾 otros vouchers del mismo proveedor que ya tienen RUC ·
 *   4. 📑 nombre en las facturas del SIRE · 5. 🧑‍💼 emisores de recibos por honorarios · 6. 🧾 proveedores de retenciones (CRE).
 * Lo que siga sin RUC se busca después en el padrón de SUNAT y con IA en internet (TGQ_externos_).
 */
function TGQ_sugerir_(ss, cfg, tandas, todas) {
  var faltan = [];
  tandas.forEach(function (t) { t.filas.forEach(function (f) { if (!f.ruc) faltan.push(f); }); });
  if (!faltan.length) return;
  // Otros vouchers: nombre → RUC (solo si siempre es el mismo RUC)
  var porVoucher = {};
  (todas || []).forEach(function (f) {
    if (!f.ruc || !f.prov) return;
    var k = normNombre_(f.prov), x = porVoucher[k] = porVoucher[k] || { rucs: {}, n: 0, nombre: f.prov };
    x.rucs[f.ruc] = (x.rucs[f.ruc] || 0) + 1; x.n++;
  });
  var poolVouchers = Object.keys(porVoucher).map(function (k) {
    var r = Object.keys(porVoucher[k].rucs);
    return r.length === 1 ? { ruc: r[0], nombre: porVoucher[k].nombre, pal: RPN_palabras_(porVoucher[k].nombre), n: porVoucher[k].n } : null;
  }).filter(Boolean);
  var docs = [], porDoc = {}, mapa = {};
  try { docs = leerDocumentosSire_(cfg, buscarLiquidaciones_(cfg)); } catch (e) { Logger.log('Procesados — SIRE: ' + e.message); }
  docs.forEach(function (d) {
    if (!d.emisorRuc) return;
    porDoc[String(d.serie).toUpperCase() + '-' + Number(d.numero)] = d.emisorRuc;
    if (d.emisorNombre && !mapa[d.emisorRuc] && !cfg.nombreEmpresa[d.emisorRuc]) mapa[d.emisorRuc] = d.emisorNombre;
  });
  var poolSire = Object.keys(mapa).map(function (r) { return { ruc: r, nombre: mapa[r], pal: RPN_palabras_(mapa[r]) }; });
  var c = ANA_ctx_(ss);
  var fuentes = [
    { pool: poolVouchers, como: function (x) { return '🧾 otros vouchers de ' + x.nombre + ' ya tienen este RUC (' + x.n + ')'; } },
    { pool: poolSire, como: function (x) { return '📑 tus facturas del SIRE: ' + x.nombre; } },
    { pool: TGQ_pool_(c, 'honorarios', 'Recibos', 'RUC emisor', /^Emisor/), como: function (x) { return '🧑‍💼 recibos por honorarios: ' + x.nombre; } },
    { pool: TGQ_pool_(c, 'retenciones', 'Emitidas', 'RUC proveedor', /^Proveedor/), como: function (x) { return '🧾 retenciones (CRE): ' + x.nombre; } },
  ];
  faltan.forEach(function (f) {
    var alias = f.prov && cfg.aliasNombre[normNombre_(f.prov)];
    if (alias) { f.sug = alias; f.como = '⚙️ alias confirmado (Config)'; return; }
    var m = String(f.refs).toUpperCase().match(/([A-Z]\w{3})-0*(\d+)/), r = m && porDoc[m[1] + '-' + Number(m[2])];
    if (r && !cfg.nombreEmpresa[r]) { f.sug = r; f.como = '📑 emisor de su factura ' + m[1] + '-' + m[2] + ' en el SIRE'; return; }
    if (!f.prov) return;
    var duda = null;
    for (var i = 0; i < fuentes.length; i++) {
      var cands = RPN_buscarPropios_(fuentes[i].pool, f.prov);
      if (!cands[0]) continue;
      var x = fuentes[i].pool.filter(function (p) { return p.ruc === cands[0].ruc; })[0] || cands[0];
      if (RPN_claro_(cands)) { f.sug = cands[0].ruc; f.como = fuentes[i].como(x) + ' (' + cands[0].puntaje + ' pts)'; return; }
      if (!duda || cands[0].puntaje > duda.puntaje) duda = { puntaje: cands[0].puntaje, txt: cands[0].ruc + ' ' + cands[0].nombre + ' — ' + fuentes[i].como(x).split(':')[0] };
    }
    if (duda) f.posible = duda.txt;
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

/** Vuelta del padrón (desde RPN_gh_): propuesta con lo del padrón + internet, al mismo chat. */
function TGQ_trasPadron_(ex, res, error) {
  var ss = TG_ss_(), cambios = [], lineas = [], n = 0, porNombre = {};
  (res || []).forEach(function (r) { porNombre[normNombre_(r.q)] = r.candidatos || []; });
  Object.keys(ex.procesados || {}).forEach(function (k) {
    var lista = ex.procesados[k], prov = lista[0].prov, filasTxt = lista.map(function (f) { return f.hoja + '!' + f.fila; }).join(', ');
    var cands = (porNombre[k] || []).slice().sort(function (a, b) { return b.puntaje - a.puntaje; });
    var claro = cands.length && RPN_claro_(cands) && (!cands[0].estado || /ACTIVO/i.test(cands[0].estado));
    if (claro) {
      var como = '🏛 padrón de SUNAT: ' + cands[0].nombre + ' (' + cands[0].puntaje + ' pts' + (cands[0].estado ? ', ' + cands[0].estado : '') + ')';
      lista.forEach(function (f) {
        cambios.push({ id: String(++n), hoja: f.hoja, fila: f.fila, col: f.col, encabezado: 'ID Beneficiario', actual: '', nuevo: cands[0].ruc, motivo: prov + ' · ' + como });
      });
      lineas.push('✅ ' + prov + ' → ' + cands[0].ruc + '\n   ' + como + ' · filas ' + filasTxt);
      return;
    }
    var web = TGQ_internet_(prov);
    if (web) {
      lineas.push('🌐 ' + prov + ' → ¿' + web.ruc + ' ' + web.nombre + '?\n   IA en internet' + (web.fuente ? ' (' + web.fuente + ')' : '') +
        ' · no lo escribo solo: si es correcto, responda «en la fila ' + lista[0].fila + ' el RUC es ' + web.ruc + '»' +
        (cands[0] ? '\n   Padrón (dudoso): ' + cands.slice(0, 2).map(function (x) { return x.ruc + ' ' + x.nombre; }).join(' / ') : ''));
      return;
    }
    lineas.push('❓ ' + prov + ': no lo encontré' + (cands[0] ? ' claro. Padrón: ' + cands.slice(0, 3).map(function (x) { return x.ruc + ' ' + x.nombre + ' (' + x.puntaje + ')'; }).join(' / ')
      : ' en el padrón ni en internet') + ' · filas ' + filasTxt);
  });
  var texto = '🔎 Búsqueda externa (padrón de SUNAT + IA en internet)' + (error ? ' · ⚠️ ' + error : '') + ':\n' + (lineas.join('\n') || 'nada nuevo.');
  var vis = [];
  if (cambios.length) {
    ANX_guardarPropuestos_(ss, cambios);
    vis = cambios.map(function (x) { return { id: x.id, fila: x.hoja + '!' + x.fila, columna: 'ID Beneficiario', actual: '', nuevo: x.nuevo, motivo: x.motivo }; });
  }
  if (ex.origen === 'tg' && ex.chat) {
    TG_enviar_(ex.chat, TG_esc_(texto));
    if (vis.length) TG_mostrarCambios_({ chatId: ex.chat }, vis);
  } else if (ex.origen === 'wa') {
    var botones = vis.length ? { k: TG_guardarBoton_({ t: 'cambios', ids: vis.map(function (x) { return x.id; }) }),
      texto: '✏️ ¿Escribo ' + vis.length + ' RUC del padrón de SUNAT en la columna ID Beneficiario de Vouchers? (solo celdas vacías, se puede deshacer)',
      opciones: [{ op: 'si', titulo: '✅ Escribir RUC' }, { op: 'no', titulo: '✖ No' }] } : null;
    try { TGC_wa_({ tipo: 'texto', numero: String(ex.chat || '').replace(/\D/g, ''), texto: texto, botones: botones }); } catch (e) {}
  }
}

/** IA con búsqueda en Google: RUC de una empresa o persona peruana → {ruc, nombre, fuente} o null. El RUC se valida (dígito verificador). */
function TGQ_internet_(nombre) {
  var clave = '';
  try { clave = TGG_clave_(); } catch (e) { return null; }
  var pedido = 'Busca en internet el RUC (Perú, SUNAT, 11 dígitos) de: "' + nombre + '". Puede ser una empresa o una persona con negocio. ' +
    'Responde SOLO JSON: {"ruc":"11 dígitos o vacío","nombre":"razón social tal como figura","fuente":"página donde lo viste (dominio)","seguro":true|false}. ' +
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
  return out;
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

/* ============================================================ hoja (menú 💼 Cobranzas) */

function menuVouchersProcesados() {
  var ui = SpreadsheetApp.getUi();
  var p = ui.prompt('📋 Vouchers procesados', '¿Cuáles? Ej.: hoy · hoy sonia · ayer edit · 26-10-26 Sonia(Edit) · 14 de octubre · 2 últimos de sonia',
    ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  var ss = SpreadsheetApp.getActive(), r = TGQ_buscar_(ss, p.getResponseText() || 'hoy');
  var sh = ss.getSheetByName(TGQ_HOJA_) || ss.insertSheet(TGQ_HOJA_);
  sh.clear(); sh.clearConditionalFormatRules();
  try { sh.getRange(1, 1, sh.getMaxRows(), TGQ_ENC_.length).clearDataValidations(); } catch (e) {}
  sh.getRange(1, 1, 1, TGQ_ENC_.length).merge().setValue('📋 VOUCHERS PROCESADOS · ' + (p.getResponseText() || 'hoy') + (r.ampliado ? ' · ' + r.ampliado : '') +
    ' · Revise el RUC sugerido (puede cambiarlo), marque ✔ Escribir y use 💼 Cobranzas → 📋 Vouchers procesados → ✍️ Escribir los RUC marcados.')
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
    var ruc = String(r[7]).replace(/\D/g, ''), m = String(r[1]).match(/^(.+)!(\d+)$/);
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
