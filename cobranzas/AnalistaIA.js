/**
 * AnalistaIA.js — 💬 PREGUNTAR A LA IA, sin formato fijo.
 *
 * La pregunta es libre ("lístame todas las facturas de ALIF a BKF con sus N/C,
 * retenciones y los vouchers que podrían pagarlas", "concilia GRANIX con SOAL:
 * qué voucher va a cada factura y cuáles no se usan"…). La IA trabaja como un
 * analista con acceso a los datos: en cada paso pide lo que necesita con
 * HERRAMIENTAS (buscar la contraparte, traer facturas, N/C/retenciones/pagos
 * aplicados, vouchers A–J usados o sin usar, cualquier otra hoja, calculadora
 * de combinaciones) y al final responde con su análisis y las TABLAS que
 * armó, que se escriben en la pestaña 💬 Resultado IA.
 *
 * Los vouchers se leen de las columnas A–J (lector de AuditorVouchersIA.js,
 * sin depender de encabezados); si la IA lo pide ("ampliar"), también ve el
 * resto de columnas de esas filas. Funciones ANA_.
 */

var ANA_HOJA_ = '💬 Resultado IA';
var ANA_MAX_PASOS_ = 9;
var ANA_LIMITE_MS_ = 285000;
var ANA_MAX_FILAS_ = 600;            // filas por herramienta

var ANA_SISTEMA_ = [
  'Eres un analista contable y auditor senior en Perú (cuentas por pagar y por cobrar, SIRE, retenciones IGV 3%, detracciones SPOT, conciliación bancaria)',
  'de un GRUPO de empresas. Respondes CUALQUIER pregunta del gerente o contador sobre facturas, notas de crédito, retenciones, detracciones, pagos y vouchers.',
  'No tienes un formato fijo: decides qué datos necesitas, los pides con herramientas, los cruzas y respondes con tu análisis y las tablas que la pregunta pida.',
  '',
  'DATOS (todo viene de las hojas; nunca inventes):',
  '- facturas: comprobantes de SIRE por empresa del grupo, "Por pagar" (compras) y "Por cobrar" (ventas), con total, N/C, retención, detracción, otros, pagado, saldo y estado.',
  '- aplicaciones: lo que ya rebaja cada factura: Pago (voucher), Retención (CRE de SUNAT), Detracción, N/C (nota de crédito de SIRE), N/D, Otro.',
  '- vouchers: pagos bancarios leídos de la hoja de vouchers, columnas A–J (la fila original va en "fila_AJ"). "usado_en" dice a qué factura ya se aplicó;',
  '  vacío = SIN USAR (no considerado en ninguna factura). "proveedor_ia" es el proveedor que la IA ya reconoció para ese voucher (si lo hay).',
  '- Cualquier otra hoja (herramienta hojas / leer_hoja) si la pregunta necesita algo más.',
  '',
  'HERRAMIENTAS (args opcionales salvo que se diga):',
  '- contrapartes {texto}: busca proveedores/clientes por nombre o RUC; da RUC, nombre y por empresa: facturas, saldo, lado.',
  '- facturas {empresa, contraparte, lado:"Por pagar"|"Por cobrar", desde, hasta, con_saldo:true|false, estado, buscar}',
  '- aplicaciones {empresa, contraparte, documento, modalidad:"Pago"|"Retención"|"Detracción"|"N/C"|"N/D"|"Otro descuento", desde, hasta}',
  '- vouchers {empresa, contraparte, buscar (texto en la fila A–J), desde, hasta, monto, tolerancia, estado:"sin usar"|"usados"|"todos", ampliar:true}',
  '  (ampliar=true trae además las columnas de la fila fuera de A–J; úsalo solo si lo necesitas).',
  '- combinar {objetivo, montos:[{"id":"01_F001-1","monto":100.5}], max_items:4, tolerancia:1}: calculadora exacta; dice qué combinaciones suman el objetivo',
  '  (exacto, neto de retención 3% y neto de detracción 4/10/12%). Úsala para ver qué facturas paga un voucher o qué vouchers pagan una factura.',
  '- hojas {}: lista las hojas disponibles con sus columnas.   - leer_hoja {libro:"cobranzas"|"vouchers", hoja, buscar, max_filas}',
  'empresa = nombre corto o RUC de la empresa del grupo. contraparte = nombre (aunque esté mal escrito) o RUC. Fechas dd/mm/yyyy.',
  '',
  'PROTOCOLO: responde SIEMPRE un JSON.',
  'Para pedir datos: {"accion":"consultar","consultas":[{"id":"R1","herramienta":"facturas","args":{...}}, …]}  (puedes pedir varias a la vez; ids nuevos R1, R2…).',
  'Para terminar: {"accion":"responder","respuesta":"…","tablas":[…]}',
  '  "respuesta": en español, clara, con cifras exactas (S/ y USD) y tu conclusión profesional (qué falta pagar, qué voucher no se usa, qué regularizar).',
  '  "tablas": cada una {"titulo":"…","columnas":["…"],"filas":[[…]]} armada por ti, o {"titulo":"…","desde_resultado":"R1","columnas":["documento","total",…],"total":true}',
  '  para mostrar tal cual el resultado de una herramienta (más rápido para listas largas; "columnas" elige y ordena; "total": suma las columnas numéricas).',
  'Reglas: usa las herramientas antes de afirmar algo; si una búsqueda no trae nada, prueba otra forma (otro nombre, RUC, sin fechas). No pidas lo que ya tienes.',
  'Para conciliar: por cada factura con saldo, qué voucher(s) SIN USAR del mismo proveedor y empresa podrían pagarla (monto exacto, suma, neto de retención o detracción,',
  'fecha posterior a la factura); y al final los vouchers que no calzan con nada. Haz las cuentas con la herramienta combinar cuando haya dudas.',
].join('\n');

/* ============================================================ datos */

function ANA_ctx_(ss) {
  var cfg = leerConfig_(ss);
  return { ss: ss, cfg: cfg, resultados: {}, _docs: null, _movs: null, _vou: null };
}

function ANA_docs_(c) {
  if (c._docs) return c._docs;
  var sh = c.ss.getSheetByName(HOJA.DOCS);
  var res = [];
  if (sh && sh.getLastRow() >= 2) {
    var v = sh.getRange(1, 1, sh.getLastRow(), ENC_DOCS_.length).getValues();
    var I = {}; ENC_DOCS_.forEach(function (n, k) { I[n] = k; });
    for (var i = 1; i < v.length; i++) {
      var r = v[i];
      if (!r[I['Documento']]) continue;
      res.push({ empresa: String(r[I['Empresa']] || ''), lado: String(r[I['Tipo']] || ''), ruc: aRuc_(r[I['RUC contraparte']]) || String(r[I['RUC contraparte']] || ''),
        contraparte: String(r[I['Contraparte']] || ''), documento: String(r[I['Documento']]), emision: aFecha_(r[I['Emisión']]), vence: aFecha_(r[I['Vence']]),
        moneda: String(r[I['Moneda']] || ''), total: aNumero_(r[I['Total']]), nc: aNumero_(r[I['N/C']]), retencion: aNumero_(r[I['Retención']]),
        detraccion: aNumero_(r[I['Detracción']]), otros: aNumero_(r[I['Otros desc.']]), pagado: aNumero_(r[I['Pagado']]), saldo: aNumero_(r[I['Saldo']]),
        estado: String(r[I['Estado']] || ''), dias_vencido: aNumero_(r[I['Días vencido']]), retener: String(r[I['¿Retener? (IGV 3%)']] || ''),
        registro_sire: String(r[I['Registro SIRE']] || ''), producto: String(r[I['Producto']] || '').slice(0, 60) });
    }
  }
  // Nombre de la contraparte aunque alguna fila venga sin él
  var nom = {};
  res.forEach(function (d) { if (d.contraparte && !nom[d.ruc]) nom[d.ruc] = d.contraparte; });
  res.forEach(function (d) { if (!d.contraparte) d.contraparte = nom[d.ruc] || ''; });
  c.nombres = nom;
  return c._docs = res;
}

function ANA_movs_(c) {
  if (c._movs) return c._movs;
  var sh = c.ss.getSheetByName(HOJA.MOVS);
  var res = [];
  if (sh && sh.getLastRow() >= 2) {
    var v = sh.getDataRange().getValues();
    var col = indiceColumnas_(v[0]);
    var k = { fecha: col('Fecha'), emp: col('Empresa que paga'), ruc: col('RUC beneficiario'), benef: col('Beneficiario'), doc: col('Documento'),
      mod: col('Modalidad'), monto: col('Monto aplicado'), mon: col('Moneda'), op: col('N° operación'), banco: col('Banco'), mv: col('Monto del voucher'),
      origen: col('Origen'), nota: col('Nota'), fuente: col('Fuente'), id: col('ID pago') };
    for (var i = 1; i < v.length; i++) {
      var r = v[i];
      var g = function (x) { return x >= 0 ? r[x] : ''; };
      res.push({ fecha: aFecha_(g(k.fecha)), empresa: String(g(k.emp) || ''), ruc: String(g(k.ruc) || ''), contraparte: String(g(k.benef) || ''),
        documento: String(g(k.doc) || ''), modalidad: String(g(k.mod) || ''), monto: aNumero_(g(k.monto)), moneda: String(g(k.mon) || ''),
        referencia: String(g(k.op) || ''), banco: String(g(k.banco) || ''), monto_voucher: aNumero_(g(k.mv)), origen: String(g(k.origen) || ''),
        nota: String(g(k.nota) || ''), fuente: String(g(k.fuente) || ''), id_pago: String(g(k.id) || '') });
    }
  }
  return c._movs = res;
}

function ANA_vouchers_(c) {
  if (c._vou) return c._vou;
  var movs = AUD_leerMovs_(c.ss);
  var cache = AUV_cache_(c.ss);
  var lect = AUV_leerEnlazado_(c.cfg, null, { consultas: 0, errores: 0 }, cache, 0, movs);
  var nom = c.nombres || {};
  lect.pagos.forEach(function (p) {
    if (p._prov) return;
    var x = AUV_cacheGet_(cache, 'ident', hashTexto_(p.crudo + '|' + (p.pagadorRuc || '?')));
    if (x && x.ruc) { p._prov = x.ruc; p._como = 'IA ' + x.confianza + '%'; }
    else if (p.beneficiarioRuc) p._prov = p.beneficiarioRuc;
  });
  return c._vou = lect;
}

/* ============================================================ filtros */

function ANA_empresa_(c, txt) {
  txt = String(txt || '').trim();
  if (!txt) return '';
  return AUV_empresaDe_(txt, c.cfg) || txt;
}

function ANA_nombreEmp_(c, ruc) { return c.cfg.nombreEmpresa[ruc] || ruc; }

/** ¿La contraparte (RUC o nombre aunque esté mal escrito) es esta? */
function ANA_coincide_(arg, ruc, nombre) {
  arg = String(arg || '').trim();
  if (!arg) return true;
  var d = arg.replace(/\D/g, '');
  if (d.length === 11 || d.length === 8) return String(ruc) === d;
  var a = normNombre_(arg), n = normNombre_(nombre);
  if (!n) return false;
  if (n.indexOf(a) !== -1 || a.indexOf(n) !== -1) return true;
  var ta = IA_tokens_(arg);
  return ta.length > 0 && IA_similitud_(ta, IA_tokens_(nombre)) >= 0.6;
}

function ANA_enFechas_(f, desde, hasta) {
  if (!f) return !desde && !hasta;
  var d = desde ? AUV_fecha_(desde) : null, h = hasta ? AUV_fecha_(hasta) : null;
  return (!d || f >= d) && (!h || f <= h);
}

function ANA_txtIgual_(a, b) { return normHeader_(a) === normHeader_(b); }

/* ============================================================ herramientas */

var ANA_HERR_ = {
  contrapartes: function (c, a) {
    var t = String(a.texto || '').trim();
    var porRuc = {};
    ANA_docs_(c).forEach(function (d) {
      if (!ANA_coincide_(t, d.ruc, d.contraparte)) return;
      var x = porRuc[d.ruc] = porRuc[d.ruc] || { ruc: d.ruc, nombre: d.contraparte, detalle: {} };
      var k = d.empresa + ' (' + d.lado + ')';
      var e = x.detalle[k] = x.detalle[k] || { n: 0, saldo: 0 };
      e.n++; e.saldo += d.saldo > 0 ? d.saldo : 0;
    });
    var filas = Object.keys(porRuc).map(function (r) {
      var x = porRuc[r];
      return [x.ruc, x.nombre, Object.keys(x.detalle).map(function (k) { return k + ': ' + x.detalle[k].n + ' fact., saldo ' + x.detalle[k].saldo.toFixed(2); }).join('; ')];
    });
    // También nombres escritos en vouchers
    var vs = {};
    ANA_vouchers_(c).pagos.forEach(function (p) {
      if (p.beneficiarioNombre && ANA_coincide_(t, p._prov || '', p.beneficiarioNombre)) vs[p.beneficiarioNombre] = (vs[p.beneficiarioNombre] || 0) + 1;
    });
    Object.keys(vs).slice(0, 30).forEach(function (n) { filas.push(['(voucher)', n, vs[n] + ' voucher(s) con ese nombre de beneficiario']); });
    return { columnas: ['ruc', 'nombre', 'facturas por empresa'], filas: filas };
  },

  facturas: function (c, a) {
    var emp = ANA_empresa_(c, a.empresa);
    var sel = ANA_docs_(c).filter(function (d) {
      if (emp && !(ANA_txtIgual_(d.empresa, ANA_nombreEmp_(c, emp)) || ANA_txtIgual_(d.empresa, emp))) return false;
      if (a.lado && !ANA_txtIgual_(d.lado, a.lado)) return false;
      if (!ANA_coincide_(a.contraparte, d.ruc, d.contraparte)) return false;
      if ((a.desde || a.hasta) && !ANA_enFechas_(d.emision, a.desde, a.hasta)) return false;
      if (a.con_saldo === true && d.saldo <= 0.5) return false;
      if (a.con_saldo === false && d.saldo > 0.5) return false;
      if (a.estado && normHeader_(d.estado).indexOf(normHeader_(a.estado)) === -1) return false;
      if (a.buscar && normHeader_(d.documento + ' ' + d.producto).indexOf(normHeader_(a.buscar)) === -1) return false;
      return true;
    }).sort(function (x, y) { return (x.emision || 0) - (y.emision || 0); });
    var cols = ['empresa', 'lado', 'ruc', 'contraparte', 'documento', 'emision', 'vence', 'moneda', 'total', 'nc', 'retencion', 'detraccion', 'otros',
      'pagado', 'saldo', 'estado', 'dias_vencido', 'retener', 'registro_sire', 'producto'];
    return { columnas: cols, filas: sel.map(function (d) { return cols.map(function (k) { return d[k]; }); }) };
  },

  aplicaciones: function (c, a) {
    var emp = ANA_empresa_(c, a.empresa);
    var nom = c.nombres || (ANA_docs_(c), c.nombres);
  var sel = ANA_movs_(c).filter(function (m) {
    if (!m.contraparte) m.contraparte = nom[m.ruc] || '';
      if (emp && !(ANA_txtIgual_(m.empresa, ANA_nombreEmp_(c, emp)) || ANA_txtIgual_(m.empresa, emp))) return false;
      if (!ANA_coincide_(a.contraparte, m.ruc, m.contraparte)) return false;
      if (a.documento && normHeader_(m.documento).indexOf(normHeader_(a.documento)) === -1) return false;
      if (a.modalidad && !ANA_txtIgual_(m.modalidad, a.modalidad)) return false;
      if ((a.desde || a.hasta) && !ANA_enFechas_(m.fecha, a.desde, a.hasta)) return false;
      return true;
    });
    var cols = ['fecha', 'empresa', 'ruc', 'contraparte', 'documento', 'modalidad', 'monto', 'moneda', 'referencia', 'banco', 'monto_voucher', 'origen', 'nota', 'fuente'];
    return { columnas: cols, filas: sel.map(function (m) { return cols.map(function (k) { return m[k]; }); }) };
  },

  vouchers: function (c, a) {
    var L = ANA_vouchers_(c);
    var emp = ANA_empresa_(c, a.empresa);
    var nom = c.nombres || (ANA_docs_(c), c.nombres);
    var contraRucs = null;
    if (a.contraparte) {
      contraRucs = {};
      ANA_docs_(c).forEach(function (d) { if (ANA_coincide_(a.contraparte, d.ruc, d.contraparte)) contraRucs[d.ruc] = true; });
    }
    var monto = a.monto != null && a.monto !== '' ? aNumero_(a.monto) : null, tol = a.tolerancia != null ? aNumero_(a.tolerancia) : 1;
    var est = normHeader_(a.estado || 'todos');
    var sel = L.pagos.filter(function (p) {
      if (emp && p.pagadorRuc !== emp) return false;
      if ((a.desde || a.hasta) && !ANA_enFechas_(p.fecha, a.desde, a.hasta)) return false;
      if (monto != null && Math.abs(p.monto - monto) > tol) return false;
      if (/sin/.test(est) && p._apl) return false;
      if (/^usad/.test(est) && !p._apl) return false;
      if (a.buscar && normHeader_(p.crudo).indexOf(normHeader_(a.buscar)) === -1) return false;
      if (contraRucs) {
        var porRuc = p._prov && contraRucs[p._prov];
        var porNombre = ANA_coincide_(a.contraparte, '', p.beneficiarioNombre) || normHeader_(p.crudo).indexOf(normHeader_(a.contraparte)) !== -1;
        if (!porRuc && !porNombre) return false;
      }
      return true;
    }).sort(function (x, y) { return (x.fecha || 0) - (y.fecha || 0); });
    var cols = ['fila', 'fecha', 'empresa', 'banco', 'operacion', 'moneda', 'monto', 'beneficiario', 'proveedor_ia', 'usado_en', 'fila_AJ'];
    var filas = sel.map(function (p) {
      return [p.fuente, p.fecha, ANA_nombreEmp_(c, p.pagadorRuc) || '?', p.banco, p.operacion, p.moneda, p.monto, p.beneficiarioNombre,
        p._prov ? p._prov + ' ' + (nom[p._prov] || ANA_nombreEmp_(c, p._prov)) : '',
        p._apl ? p._apl.map(function (m) { return m.doc + ' ' + m.monto.toFixed(2); }).join(', ') : '', p.crudo];
    });
    if (a.ampliar && sel.length) {
      cols.push('otras_columnas');
      var extra = ANA_ampliar_(c, sel.slice(0, 300).map(function (p) { return p.fuente; }));
      filas.forEach(function (f) { f.push(extra[f[0]] || ''); });
    }
    return { columnas: cols, filas: filas };
  },

  combinar: function (c, a) {
    var obj = aNumero_(a.objetivo), tol = a.tolerancia != null ? aNumero_(a.tolerancia) : 1;
    var maxN = Math.min(5, Math.max(1, parseInt(a.max_items, 10) || 4));
    var xs = (Array.isArray(a.montos) ? a.montos : []).map(function (m) { return { id: String(m.id), monto: aNumero_(m.monto) }; })
      .filter(function (m) { return m.monto > 0; }).slice(0, maxN >= 4 ? 30 : 60);
    var res = [], vistos = 0;
    var probar = function (sel) {
      var s = 0; sel.forEach(function (x) { s += x.monto; });
      var tipos = [['exacto', 1], ['neto de retención 3%', 0.97], ['neto de detracción 4%', 0.96], ['neto de detracción 10%', 0.90], ['neto de detracción 12%', 0.88]];
      for (var k = 0; k < tipos.length; k++) {
        var neto = s * tipos[k][1];
        if (Math.abs(neto - obj) <= tol) { res.push([sel.map(function (x) { return x.id; }).join(' + '), redondear2_(s), tipos[k][0], redondear2_(obj - neto)]); return; }
      }
    };
    (function rec(ini, sel) {
      if (res.length >= 40 || ++vistos > 300000) return;
      if (sel.length) probar(sel);
      if (sel.length === maxN) return;
      for (var i = ini; i < xs.length; i++) rec(i + 1, sel.concat([xs[i]]));
    })(0, []);
    return { columnas: ['combinacion', 'suma', 'tipo', 'diferencia'], filas: res };
  },

  hojas: function (c) {
    var filas = [];
    c.ss.getSheets().forEach(function (sh) {
      if (sh.getLastRow() < 1) return;
      filas.push(['cobranzas', sh.getName(), sh.getLastRow(), sh.getRange(1, 1, 1, Math.min(sh.getLastColumn(), 25)).getDisplayValues()[0].filter(String).join(' | ').slice(0, 300)]);
    });
    if (c.cfg.idVouchers) {
      SpreadsheetApp.openById(c.cfg.idVouchers).getSheets().forEach(function (sh) {
        if (sh.getLastRow() < 1) return;
        filas.push(['vouchers', sh.getName(), sh.getLastRow(), sh.getRange(1, 1, 1, Math.min(sh.getLastColumn(), 25)).getDisplayValues()[0].filter(String).join(' | ').slice(0, 300)]);
      });
    }
    return { columnas: ['libro', 'hoja', 'filas', 'primera fila'], filas: filas };
  },

  leer_hoja: function (c, a) {
    var libro = /vouch/i.test(String(a.libro || '')) ? SpreadsheetApp.openById(c.cfg.idVouchers) : c.ss;
    var sh = libro.getSheetByName(String(a.hoja || ''));
    if (!sh) throw new Error('No existe la hoja "' + a.hoja + '" (use la herramienta hojas).');
    var n = sh.getLastRow(), nc = Math.min(sh.getLastColumn(), 30);
    if (n < 1) return { columnas: [], filas: [] };
    var v = sh.getRange(1, 1, n, nc).getDisplayValues();
    var b = normHeader_(a.buscar || '');
    var max = Math.min(parseInt(a.max_filas, 10) || 200, ANA_MAX_FILAS_);
    var filas = v.slice(1).map(function (r, i) { return [i + 2].concat(r); })
      .filter(function (r) { return !b || normHeader_(r.join(' ')).indexOf(b) !== -1; }).slice(0, max);
    return { columnas: ['fila'].concat(v[0].map(function (h, j) { return h || AUV_LETRAS_[j] || 'col' + (j + 1); })), filas: filas };
  },
};

/** Columnas fuera de A–J de esas filas de vouchers ("Encabezado=valor; …"). */
function ANA_ampliar_(c, fuentes) {
  var porHoja = {}, out = {};
  fuentes.forEach(function (f) { var p = f.split('!'); (porHoja[p[0]] = porHoja[p[0]] || []).push(+p[1]); });
  var libro = SpreadsheetApp.openById(c.cfg.idVouchers);
  Object.keys(porHoja).forEach(function (h) {
    var sh = libro.getSheetByName(h);
    if (!sh || sh.getLastColumn() <= AUV_COLS_) return;
    var nc = Math.min(sh.getLastColumn(), 30) - AUV_COLS_;
    var enc = sh.getRange(1, AUV_COLS_ + 1, 1, nc).getDisplayValues()[0];
    var filas = porHoja[h];
    var desde = Math.min.apply(null, filas), hasta = Math.max.apply(null, filas);
    var v = sh.getRange(desde, AUV_COLS_ + 1, hasta - desde + 1, nc).getDisplayValues();
    filas.forEach(function (f) {
      var r = v[f - desde];
      out[h + '!' + f] = r.map(function (x, j) { return x ? (enc[j] || AUV_LETRAS_.length + j + 1) + '=' + String(x).slice(0, 60) : ''; }).filter(Boolean).join('; ');
    });
  });
  return out;
}

/* ============================================================ conversación */

function ANA_fmt_(x) {
  if (x instanceof Date) return IA_fmtFecha_(x);
  if (typeof x === 'number') return Math.round(x * 100) / 100 === Math.round(x) ? String(x) : x.toFixed(2);
  return String(x == null ? '' : x).replace(/\s+/g, ' ');
}

/** Resultado de una herramienta como texto para la IA (con totales y recortado si es enorme). */
function ANA_textoRes_(id, herr, r, limite) {
  var L = [id + ' · ' + herr + ': ' + r.filas.length + ' fila(s)' + (r.error ? ' · ERROR: ' + r.error : '')];
  if (!r.filas.length) return L.join('\n');
  L.push(r.columnas.join(' | '));
  var tot = r.columnas.map(function () { return 0; }), num = r.columnas.map(function () { return true; });
  var largo = 0, mostradas = 0;
  for (var i = 0; i < r.filas.length; i++) {
    var f = r.filas[i];
    f.forEach(function (x, j) { if (typeof x === 'number') tot[j] += x; else if (x !== '' && x != null) num[j] = false; });
    var t = f.map(ANA_fmt_).join(' | ');
    if (largo + t.length < limite) { L.push(t); largo += t.length; mostradas++; }
  }
  if (mostradas < r.filas.length) L.push('…(se muestran ' + mostradas + ' de ' + r.filas.length + '; para la tabla completa use "desde_resultado":"' + id + '" o filtre más)');
  var sumas = r.columnas.map(function (cn, j) { return num[j] && /total|monto|saldo|pagado|nc|retencion|detraccion|otros|suma/i.test(cn) ? cn + '=' + tot[j].toFixed(2) : ''; }).filter(Boolean);
  if (sumas.length) L.push('TOTALES: ' + sumas.join(' · '));
  return L.join('\n');
}

function ANA_preguntar_(ss, pregunta, ia) {
  var t0 = Date.now();
  var c = ANA_ctx_(ss);
  var gemini = IA_PROVEEDORES_[ia.proveedor].tipo === 'gemini';
  var limRes = gemini ? 60000 : 12000, limTotal = gemini ? 700000 : 60000;
  var conv = ['PREGUNTA: ' + pregunta, '', 'EMPRESAS DEL GRUPO: ' + c.cfg.grupo.map(function (r) { return c.cfg.nombreEmpresa[r] + ' (' + r + ')'; }).join(', '),
    'HOY: ' + IA_fmtFecha_(new Date())];
  var pasos = [], consultas = 0, final = null;
  for (var paso = 0; paso <= ANA_MAX_PASOS_ && !final; paso++) {
    var apurar = paso === ANA_MAX_PASOS_ || Date.now() - t0 > ANA_LIMITE_MS_ - 60000;
    if (apurar) conv.push('', 'YA NO HAY MÁS CONSULTAS: responde ahora con "accion":"responder" usando lo que tienes.');
    var texto = conv.join('\n');
    if (texto.length > limTotal) texto = texto.slice(0, 2000) + '\n…(recortado)…\n' + texto.slice(-(limTotal - 2000));
    if (consultas) Utilities.sleep(Math.min(IA_PROVEEDORES_[ia.proveedor].pausa, 2000));
    consultas++;
    var r;
    try {
      r = IA_llamar_({ proveedor: ia.proveedor, modelo: ia.modelo, clave: ia.clave, sistema: ANA_SISTEMA_, texto: texto, maxTokens: 16000 });
    } catch (e) {
      if (!/JSON/i.test(e.message)) throw e;
      // Respondió sin JSON: se le recuerda el protocolo; en el último intento se acepta su texto como respuesta.
      if (!apurar) { conv.push('', 'Tu última respuesta no fue JSON válido. Responde SOLO con el JSON del protocolo.'); continue; }
      r = { respuesta: IA_llamar_({ proveedor: ia.proveedor, modelo: ia.modelo, clave: ia.clave, sistema: ANA_SISTEMA_, texto: texto, json: false, maxTokens: 8000 }), tablas: [] };
    }
    if (r && r.accion === 'consultar' && Array.isArray(r.consultas) && r.consultas.length && !apurar) {
      conv.push('', 'TÚ PEDISTE: ' + JSON.stringify(r.consultas).slice(0, 2000), 'RESULTADOS:');
      r.consultas.slice(0, 6).forEach(function (q, k) {
        var id = String(q.id || ('R' + (Object.keys(c.resultados).length + 1)));
        var h = String(q.herramienta || '');
        var res;
        try {
          if (!ANA_HERR_[h]) throw new Error('herramienta desconocida "' + h + '"');
          res = ANA_HERR_[h](c, q.args || {});
          res.filas = res.filas.slice(0, ANA_MAX_FILAS_ * 3);
        } catch (e) { res = { columnas: [], filas: [], error: e.message }; }
        c.resultados[id] = res;
        pasos.push(id + ' ' + h + ' ' + JSON.stringify(q.args || {}).slice(0, 150) + ' → ' + res.filas.length + (res.error ? ' ERROR ' + res.error : ''));
        conv.push(ANA_textoRes_(id, h, res, limRes));
      });
      continue;
    }
    if (r && (r.respuesta || r.tablas)) final = r;
    else if (apurar) final = { respuesta: String((r && (r.respuesta || r.texto)) || 'La IA no dio una respuesta.'), tablas: [] };
    else conv.push('', 'Responde con el JSON del protocolo ("consultar" o "responder").');
  }
  return { final: final || { respuesta: 'La IA no terminó.', tablas: [] }, pasos: pasos, consultas: consultas, seg: Math.round((Date.now() - t0) / 1000), c: c };
}

/* ============================================================ salida */

/** Arma las tablas pedidas (propias de la IA o tomadas de un resultado). */
function ANA_tablas_(c, tablas) {
  return (Array.isArray(tablas) ? tablas : []).slice(0, 8).map(function (t) {
    var cols, filas;
    if (t.desde_resultado && c.resultados[t.desde_resultado]) {
      var r = c.resultados[t.desde_resultado];
      var pedidas = Array.isArray(t.columnas) && t.columnas.length ? t.columnas : r.columnas;
      var idx = pedidas.map(function (n) { return r.columnas.indexOf(n); });
      cols = pedidas.filter(function (n, k) { return idx[k] >= 0; });
      idx = idx.filter(function (j) { return j >= 0; });
      filas = r.filas.map(function (f) { return idx.map(function (j) { return f[j]; }); });
    } else {
      cols = (Array.isArray(t.columnas) ? t.columnas : []).map(String);
      filas = (Array.isArray(t.filas) ? t.filas : []).filter(Array.isArray).map(function (f) {
        var x = f.slice(0, cols.length);
        while (x.length < cols.length) x.push('');
        return x.map(function (v) { return typeof v === 'string' && /^-?[\d,]*\.\d{2}$/.test(v.trim()) ? aNumero_(v) : v; });
      });
    }
    if (t.total && filas.length) {
      var tot = cols.map(function (n, j) {
        var esNum = filas.every(function (f) { return typeof f[j] === 'number' || f[j] === '' || f[j] == null; }) && filas.some(function (f) { return typeof f[j] === 'number'; });
        return esNum && !/dias|ruc|fila|operacion/i.test(n) ? redondear2_(filas.reduce(function (s, f) { return s + (Number(f[j]) || 0); }, 0)) : '';
      });
      tot[0] = 'TOTAL';
      filas.push(tot);
    }
    return { titulo: String(t.titulo || 'Tabla'), columnas: cols, filas: filas };
  }).filter(function (t) { return t.columnas.length; });
}

function ANA_escribir_(ss, pregunta, out, ia) {
  var sh = ss.getSheetByName(ANA_HOJA_) || ss.insertSheet(ANA_HOJA_);
  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.getRange(1, 1, 1, 12).merge().setValue('💬  RESULTADO DE LA IA').setFontSize(14).setFontWeight('bold').setFontColor('#F8FAFC').setBackground(COLOR.OSCURO);
  sh.getRange(2, 1).setValue('Pregunta').setFontWeight('bold');
  sh.getRange(2, 2, 1, 11).merge().setValue(pregunta).setWrap(true).setBackground('#FFF8E1');
  sh.getRange(3, 1).setValue('Respuesta').setFontWeight('bold').setVerticalAlignment('top');
  var resp = String(out.final.respuesta || '');
  sh.getRange(3, 2, 1, 11).merge().setValue(resp).setWrap(true).setVerticalAlignment('top').setBackground('#F8FAFC');
  sh.setRowHeight(3, Math.min(400, 21 + 15 * Math.ceil(resp.length / 150 + (resp.match(/\n/g) || []).length)));
  sh.getRange(4, 1, 1, 12).merge().setValue('— ' + ia.proveedor + (ia.modelo ? ' ' + ia.modelo : '') + ' · ' + AUD_ahora_() + ' · ' + out.seg + ' s · ' + out.consultas +
    ' consultas a la IA · datos revisados: ' + (out.pasos.join(' ; ') || 'ninguno')).setFontSize(8).setFontColor(COLOR.TEXTO_SUAVE).setWrap(true);
  var fila = 6, anchoMax = 2;
  var tablas = ANA_tablas_(out.c, out.final.tablas);
  tablas.forEach(function (t) {
    sh.getRange(fila, 1).setValue('📊 ' + t.titulo + ' (' + t.filas.length + ')').setFontWeight('bold').setFontSize(11);
    fila++;
    var n = t.columnas.length;
    anchoMax = Math.max(anchoMax, n);
    sh.getRange(fila, 1, 1, n).setValues([t.columnas]).setFontWeight('bold').setFontColor(COLOR.BLANCO).setBackground(COLOR.AZUL).setWrap(true);
    if (t.filas.length) {
      var rg = sh.getRange(fila + 1, 1, t.filas.length, n);
      rg.setValues(t.filas.map(function (f) { return f.map(function (v) { return v == null ? '' : v; }); })).setFontSize(9).setVerticalAlignment('top');
      t.columnas.forEach(function (cn, j) {
        var col = t.filas.map(function (f) { return f[j]; });
        if (col.some(function (v) { return v instanceof Date; })) sh.getRange(fila + 1, j + 1, t.filas.length, 1).setNumberFormat('dd/mm/yyyy');
        else if (col.some(function (v) { return typeof v === 'number'; }) && !/ruc|dias|fila/i.test(cn)) sh.getRange(fila + 1, j + 1, t.filas.length, 1).setNumberFormat('#,##0.00;-#,##0.00;"-"');
        else if (/ruc|operacion|documento/i.test(cn)) sh.getRange(fila + 1, j + 1, t.filas.length, 1).setNumberFormat('@');
      });
      if (t.filas[t.filas.length - 1][0] === 'TOTAL') sh.getRange(fila + t.filas.length, 1, 1, n).setFontWeight('bold').setBackground('#EEF3F8');
    }
    fila += t.filas.length + 2;
  });
  sh.setColumnWidth(1, 110);
  for (var j = 2; j <= Math.max(anchoMax, 12); j++) sh.setColumnWidth(j, 120);
  sh.setFrozenRows(1);
  return tablas;
}

/** 💬 Preguntar a la IA (menú): pregunta de la fila 15 del 🔍 Auditor IA, o en una ventana. */
function ANA_menuPreguntar_(ss) {
  var sh = AUD_hoja_(ss);
  var pregunta = String(sh.getRange(AUD_F_PREG_, 2).getValue() || '').trim();
  if (!pregunta) {
    var ui = SpreadsheetApp.getUi();
    var r = ui.prompt('💬 Preguntar a la IA', 'Escriba lo que necesita, como se lo diría a un contador. Ej.:\n' +
      '• Lista todas las facturas de ALIF a BKF con sus N/C, retenciones y los pagos o vouchers.\n' +
      '• Concilia GRANIX con SOAL: qué voucher va a cada factura y qué vouchers no están usados.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK || !String(r.getResponseText()).trim()) return 'Sin pregunta.';
    pregunta = String(r.getResponseText()).trim();
    sh.getRange(AUD_F_PREG_, 2).setValue(pregunta);
  }
  var cfg = leerConfig_(ss);
  var ia = AUD_ia_(ss, AUD_leerParam_(sh, cfg));
  if (!ia.clave) throw new Error('Falta la clave de IA: menú 🤝 Conciliar con IA → 🔑 Guardar clave de IA.');
  sh.getRange(AUD_F_RESP_, 2).setValue('⏳ La IA está revisando los datos (puede tardar 1 a 4 minutos)…');
  SpreadsheetApp.flush();
  var out = ANA_preguntar_(ss, pregunta, ia);
  var tablas = ANA_escribir_(ss, pregunta, out, ia);
  var resumen = String(out.final.respuesta || '');
  sh.getRange(AUD_F_RESP_, 2).setValue(resumen.slice(0, 45000) + (tablas.length ? '\n\n📊 ' + tablas.length + ' tabla(s) en la pestaña ' + ANA_HOJA_ + ': ' +
    tablas.map(function (t) { return t.titulo + ' (' + t.filas.length + ')'; }).join(' · ') : '') + '\n\n— ' + ia.proveedor + ' · ' + AUD_ahora_() + ' · ' + out.seg + ' s');
  var log = ss.getSheetByName(AUD_CHAT_);
  if (!log) { log = ss.insertSheet(AUD_CHAT_); log.getRange(1, 1, 1, 4).setValues([['Fecha', 'Datos revisados', 'Pregunta', 'Respuesta']]); log.hideSheet(); }
  log.appendRow([new Date(), out.pasos.join(' ; ').slice(0, 5000), pregunta, resumen.slice(0, 45000)]);
  if (tablas.length) ss.setActiveSheet(ss.getSheetByName(ANA_HOJA_));
  return 'Respuesta lista (' + out.seg + ' s' + (tablas.length ? ', ' + tablas.length + ' tabla(s) en ' + ANA_HOJA_ : '') + ').';
}
