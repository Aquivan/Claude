/**
 * AnalistaAdjuntos.js — 📎 archivos adjuntos y ✏️ cambios propuestos del 💬 analista.
 *
 * ADJUNTOS (desde el 💬 Chat con la IA, o un archivo de Drive que se nombre en la pregunta):
 *  - Foto o PDF: la IA lo lee y saca cada documento que trae (voucher/constancia,
 *    factura, N/C, comprobante de retención, estado de cuenta…) con sus datos.
 *  - Excel (.xlsx), CSV, Google Sheets o texto: se leen sus filas tal cual.
 *  Cada adjunto queda como resultado "A1", "A2"… para que la IA lo cruce con los
 *  vouchers y las facturas, y para mostrarlo en tablas.
 *
 * HERRAMIENTAS NUEVAS del analista:
 *  - ver_adjunto: volver a mirar una foto/PDF con una pregunta concreta.
 *  - abrir_archivo: abrir un archivo de Drive por nombre o enlace como adjunto.
 *  - cruzar_vouchers: por cada pago (de un adjunto o dado por la IA) busca si ya
 *    está en la hoja de vouchers (N° de operación, o monto y fecha) y si ya se usó.
 *  - proponer_cambio: propone escribir un dato en la hoja de vouchers (factura,
 *    ID beneficiario, empresa…). NO se escribe nada hasta que usted lo aprueba
 *    (✅ en el chat o ✔ en 💬 Resultado IA); solo en celdas vacías salvo que marque
 *    "reemplazar"; queda registrado y se puede ↩️ deshacer.
 * Funciones ANX_.
 */

var ANX_CAMBIOS_ = '_Cambios IA';
var ANX_ENC_CAMBIOS_ = ['Lote', 'ID', 'Estado', 'Pestaña', 'Fila', 'Columna', 'Encabezado', 'Valor actual', 'Valor nuevo', 'Motivo', 'Fecha', 'Aplicado (lote)'];
var ANX_MAX_FILAS_ADJ_ = 3000;
// Campo (como lo nombra la IA) → encabezados posibles en la hoja de vouchers
var ANX_CAMPOS_ = {
  factura: ['Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc', 'Factura'], facturas: ['Tipo y N Doc', 'Tipo y Nro Doc', 'Tipo y No Doc'],
  id_beneficiario: ['ID Beneficiario', 'RUC Beneficiario'], ruc_beneficiario: ['ID Beneficiario', 'RUC Beneficiario'],
  empresa: ['Empresa'], id_usuario: ['ID Usuario', 'RUC Empresa'], ruc_empresa: ['ID Usuario'],
  por_retener: ['Por Retener'], retenido: ['Retenido'], revisado: ['Revisado Voucher'], nota: ['Nota', 'Observacion'],
  beneficiario: ['Proveedor (Beneficiario)'], descripcion: ['Descripcion'],
};

var ANX_SISTEMA_ADJ_ = [
  'Eres contador y auditor en Perú. Te doy un archivo (foto o PDF). Identifica CADA documento que contiene y extrae sus datos con exactitud.',
  'Tipos: voucher (constancia de transferencia/depósito/pago bancario), factura, boleta, nota de crédito, nota de débito, comprobante de retención (CRE),',
  'constancia de detracción, estado de cuenta, guía, otro. En un estado de cuenta o una lista, cada movimiento es un documento.',
  'Responde SOLO JSON: {"documentos":[{"tipo":"","fecha":"dd/mm/yyyy","monto":0,"moneda":"PEN","operacion":"","banco":"","beneficiario":"","ordenante":"",',
  '"cuenta":"","ruc_emisor":"","emisor":"","ruc_receptor":"","receptor":"","serie_numero":"","doc_referencia":"","igv":0,"concepto":""}],',
  '"legible":true,"observaciones":""}',
  'monto = importe pagado (voucher) o total del comprobante. serie_numero ej. "F001-123". doc_referencia = factura que modifica o que paga, si figura.',
  'Deja vacío lo que no se ve; no inventes. "observaciones": máx. 40 palabras (ilegible, cortado, señales de edición, operación rechazada…).',
].join('\n');

var ANX_COLS_ADJ_ = ['tipo', 'fecha', 'monto', 'moneda', 'operacion', 'banco', 'beneficiario', 'ordenante', 'cuenta', 'ruc_emisor', 'emisor',
  'ruc_receptor', 'receptor', 'serie_numero', 'doc_referencia', 'igv', 'concepto'];

/* ============================================================ leer adjuntos */

/** Blob de un adjunto: {id} (Drive), {base64, mime} o un Blob. */
function ANX_blob_(a) {
  if (a.id) { var f = DriveApp.getFileById(a.id); return { blob: f.getBlob(), nombre: a.nombre || f.getName(), mime: f.getMimeType(), id: a.id }; }
  var b = Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', a.nombre || 'adjunto');
  return { blob: b, nombre: a.nombre || 'adjunto', mime: a.mime || b.getContentType() };
}

/**
 * Lee un adjunto y lo deja como resultado A<n>. Devuelve el texto que verá la IA.
 * Lo que la IA ya leyó de una foto/PDF se guarda (por archivo) y no se vuelve a pagar.
 */
function ANX_leer_(c, a, n) {
  var id = 'A' + n;
  var x = ANX_blob_(a);
  var mime = String(x.mime || ''), nombre = x.nombre;
  var res;
  if (mime === MimeType.GOOGLE_SHEETS) {
    var sss = SpreadsheetApp.openById(x.id);
    res = ANX_tabla_(sss.getSheets()[0].getDataRange().getValues(), nombre + ' · ' + sss.getSheets()[0].getName());
  } else if (/\.xlsx$/i.test(nombre) || /spreadsheetml/.test(mime)) {
    var xl = IMP_xlsxFilas_(x.blob);
    res = ANX_tabla_(xl.filas, nombre + ' · ' + xl.hoja);
  } else if (/\.csv$/i.test(nombre) || /csv/.test(mime)) {
    res = ANX_tabla_(Utilities.parseCsv(x.blob.getDataAsString()), nombre);
  } else if (/^text\//.test(mime) || /\.txt$/i.test(nombre)) {
    var t = x.blob.getDataAsString().slice(0, 30000);
    res = { columnas: ['linea', 'texto'], filas: t.split(/\r?\n/).map(function (l, i) { return [i + 1, l]; }).filter(function (f) { return f[1].trim(); }), tipo: 'texto' };
  } else if (/^image\/|pdf/i.test(mime)) {
    res = ANX_leerImagen_(c, x, nombre);
  } else {
    res = { columnas: [], filas: [], error: 'tipo de archivo no soportado (' + mime + '): use foto, PDF, Excel .xlsx, CSV o texto' };
  }
  res.nombre = nombre; res.fuente = x; res.n = n;
  c.resultados[id] = res;
  c.adjuntos = c.adjuntos || [];
  c.adjuntos[n - 1] = res;
  return ANA_textoRes_(id, 'ADJUNTO "' + nombre + '"' + (res.tipo ? ' (' + res.tipo + ')' : ''), res, c.limRes || 40000) +
    (res.observaciones ? '\nOBSERVACIONES DE LA LECTURA: ' + res.observaciones : '');
}

/** Filas de una hoja/Excel/CSV: la primera fila con varios textos es el encabezado. */
function ANX_tabla_(filas, origen) {
  filas = (filas || []).filter(function (r) { return r && r.some(function (v) { return v !== '' && v != null; }); });
  if (!filas.length) return { columnas: [], filas: [], tipo: 'tabla', error: 'el archivo no tiene filas con datos' };
  var h = 0;
  for (var i = 0; i < Math.min(10, filas.length); i++) {
    if (filas[i].filter(function (v) { return typeof v === 'string' && /[a-z]{3,}/i.test(v); }).length >= 2) { h = i; break; }
  }
  var ancho = filas.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  var enc = [];
  for (var j = 0; j < ancho; j++) enc.push(String(filas[h][j] == null || filas[h][j] === '' ? 'col' + (j + 1) : filas[h][j]).trim());
  var datos = filas.slice(h + 1, h + 1 + ANX_MAX_FILAS_ADJ_).map(function (r) {
    var x = [];
    for (var k = 0; k < ancho; k++) x.push(r[k] == null ? '' : r[k]);
    return x;
  });
  return { columnas: ['fila'].concat(enc), filas: datos.map(function (r, k) { return [h + k + 2].concat(r); }), tipo: 'tabla · ' + origen };
}

function ANX_leerImagen_(c, x, nombre) {
  var ia = c.ia;
  var prov = IA_PROVEEDORES_[ia.proveedor];
  if (!prov.imagen) return { columnas: [], filas: [], error: 'la IA elegida no lee imágenes: use Gemini' };
  var esPdf = /pdf/i.test(x.mime);
  var blob = x.blob;
  if (esPdf && !prov.pdf) {
    if (!x.id) return { columnas: [], filas: [], error: 'la IA elegida no lee PDF: use Gemini' };
    blob = DriveApp.getFileById(x.id).getThumbnail();
  }
  var bytes = blob.getBytes();
  var clave = hashTexto_(nombre + '|' + bytes.length + '|' + Utilities.base64Encode(bytes.slice(0, 2000)));
  var cache = AUV_cache_(c.ss);
  var r = AUV_cacheGet_(cache, 'adj', clave);
  if (!r) {
    r = IA_llamarSeguro_(ia, { sistema: ANX_SISTEMA_ADJ_, maxTokens: 8000,
      adjunto: { mime: esPdf && prov.pdf ? 'application/pdf' : (blob.getContentType() || 'image/png'), base64: Utilities.base64Encode(bytes) },
      texto: 'ARCHIVO: ' + nombre + '\nExtrae todos los documentos que contiene.' });
    c.consultasExtra = (c.consultasExtra || 0) + 1;
    AUV_cachePut_(cache, 'adj', clave, r);
    AUV_cacheGuardar_(cache);
  }
  var docs = Array.isArray(r.documentos) ? r.documentos : [];
  return {
    columnas: ['doc'].concat(ANX_COLS_ADJ_),
    filas: docs.map(function (d, i) { return [i + 1].concat(ANX_COLS_ADJ_.map(function (k) { var v = d[k]; return k === 'monto' || k === 'igv' ? (AUV_num_(v) || '') : (v == null ? '' : String(v)); })); }),
    tipo: esPdf ? 'PDF' : 'imagen', observaciones: (r.legible === false ? 'ILEGIBLE. ' : '') + String(r.observaciones || ''),
  };
}

/* ============================================================ herramientas */

var ANX_HERR_ = {
  ver_adjunto: function (c, a) {
    var n = parseInt(String(a.n || a.adjunto || 1).replace(/\D/g, ''), 10) || 1;
    var adj = (c.adjuntos || [])[n - 1];
    if (!adj || !adj.fuente) throw new Error('no hay adjunto A' + n);
    if (!/^image\/|pdf/i.test(adj.fuente.mime)) throw new Error('A' + n + ' no es foto ni PDF: sus filas ya están en el resultado A' + n);
    var prov = IA_PROVEEDORES_[c.ia.proveedor];
    var blob = adj.fuente.blob;
    var resp = IA_llamarSeguro_(c.ia, { json: false, maxTokens: 3000,
      sistema: 'Eres auditor contable en Perú. Mira el archivo y responde la pregunta con exactitud, en español, citando lo que se ve. No inventes.',
      adjunto: { mime: /pdf/i.test(adj.fuente.mime) && prov.pdf ? 'application/pdf' : blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) },
      texto: String(a.pregunta || 'Describe el documento y todos sus datos.') });
    c.consultasExtra = (c.consultasExtra || 0) + 1;
    return { columnas: ['respuesta'], filas: [[String(resp)]] };
  },

  abrir_archivo: function (c, a) {
    var t = String(a.nombre || a.enlace || a.archivo || '').trim();
    if (!t) throw new Error('indique "nombre" o "enlace" del archivo de Drive');
    var id = (t.match(/\/d\/([\w-]{20,})|[?&]id=([\w-]{20,})/) || []).slice(1).filter(Boolean)[0];
    if (!id) {
      var it = IMP_carpeta_(c.ss).getFilesByName(t);
      if (!it.hasNext()) it = DriveApp.getFilesByName(t);
      if (!it.hasNext()) {
        var lista = [], fs = IMP_carpeta_(c.ss).getFiles();
        while (fs.hasNext() && lista.length < 30) lista.push(fs.next().getName());
        throw new Error('no encontré "' + t + '" en Drive. En la carpeta de importaciones hay: ' + (lista.join(', ') || '(vacía)'));
      }
      id = it.next().getId();
    }
    var n = (c.adjuntos || []).length + 1;
    var txt = ANX_leer_(c, { id: id }, n);
    var r = c.resultados['A' + n];
    return { columnas: r.columnas, filas: r.filas, nota: 'Quedó como adjunto A' + n + '. ' + txt.split('\n')[0], error: r.error };
  },

  cruzar_vouchers: function (c, a) {
    var pagos = [];
    if (Array.isArray(a.pagos) && a.pagos.length) {
      pagos = a.pagos.map(function (p, i) { return { ref: p.ref || p.id || ('P' + (i + 1)), fecha: AUV_fecha_(p.fecha), monto: AUV_num_(p.monto), operacion: p.operacion, banco: p.banco }; });
    } else {
      var src = c.resultados[String(a.adjunto || a.resultado || 'A1')];
      if (!src) throw new Error('no existe el resultado ' + (a.adjunto || 'A1'));
      var cols = a.columnas || {};
      var idx = function (k, alt) {
        var nombre = cols[k];
        var j = nombre != null ? src.columnas.indexOf(nombre) : -1;
        if (j < 0 && nombre != null) j = src.columnas.map(normHeader_).indexOf(normHeader_(nombre));
        for (var q = 0; j < 0 && q < alt.length; q++) j = src.columnas.indexOf(alt[q]);
        return j;
      };
      var jf = idx('fecha', ['fecha']), jm = idx('monto', ['monto', 'total']), jo = idx('operacion', ['operacion']), jb = idx('banco', ['banco']);
      if (jm < 0 && jo < 0) throw new Error('indique en "columnas" cuál es el monto y/o el N° de operación del adjunto (columnas: ' + src.columnas.join(', ') + ')');
      pagos = src.filas.map(function (f) {
        return { ref: (a.adjunto || 'A1') + ':' + f[0], fecha: jf >= 0 ? AUV_fecha_(f[jf]) : null, monto: jm >= 0 ? AUV_num_(f[jm]) : null,
          operacion: jo >= 0 ? f[jo] : '', banco: jb >= 0 ? f[jb] : '' };
      }).filter(function (p) { return p.monto || p.operacion; });
    }
    var dias = a.dias != null ? Number(a.dias) : 5;
    var L = ANA_vouchers_(c);
    var nom = c.nombres || (ANA_docs_(c), c.nombres);
    var dig = function (s) { return String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, ''); };
    var porOp = {};
    L.pagos.forEach(function (p) { var d = dig(p.operacion); if (d.length >= 3) (porOp[d] = porOp[d] || []).push(p); });
    var repetidos = {};   // el mismo voucher en otra fila/pestaña (se cuenta una vez)
    L.duplicados.forEach(function (d) { (repetidos[d.otra] = repetidos[d.otra] || []).push(d.fuente); });
    var filas = pagos.map(function (q) {
      var dq = dig(q.operacion), cand = [], como = '';
      if (dq.length >= 3) {
        cand = (porOp[dq] || []).slice();
        if (!cand.length && dq.length >= 5) Object.keys(porOp).forEach(function (k) { if (k.length >= 5 && (k.slice(-6) === dq.slice(-6))) cand = cand.concat(porOp[k]); });
        if (cand.length) como = 'N° de operación';
        if (cand.length && q.monto) { var mismos = cand.filter(function (p) { return Math.abs(p.monto - q.monto) <= 0.05; }); if (mismos.length) cand = mismos; else como += ' (¡monto distinto!)'; }
      }
      if (!cand.length && q.monto) {
        cand = L.pagos.filter(function (p) {
          return Math.abs(p.monto - q.monto) <= 0.05 && (!q.fecha || !p.fecha || Math.abs(p.fecha - q.fecha) <= dias * 86400000);
        });
        if (cand.length) como = 'monto' + (q.fecha ? ' y fecha ±' + dias + ' días' : ' (sin fecha)');
      }
      var p = cand[0];
      var estado = !cand.length ? '❌ No está en la hoja de vouchers' : cand.length > 1 ? '⚠️ ' + cand.length + ' posibles: ' + cand.slice(0, 5).map(function (x) { return x.fuente; }).join(', ')
        : p._apl ? '✅ Registrado y usado' : '🟡 Registrado, sin usar en ninguna factura';
      if (/distinto/.test(como)) estado = '⚠️ Misma operación con otro monto';
      if (p && repetidos[p.fuente]) como += ' · también está en ' + repetidos[p.fuente].join(', ');
      return [q.ref, q.fecha || '', q.monto == null ? '' : q.monto, q.operacion || '', estado, como, p ? p.fuente : '', p ? ANA_nombreEmp_(c, p.pagadorRuc) : '',
        p ? p.beneficiarioNombre : '', p && p._prov ? p._prov + ' ' + (nom[p._prov] || '') : '',
        p && p._apl ? p._apl.map(function (m) { return m.doc + ' ' + m.monto.toFixed(2); }).join(', ') : '', p ? p.crudo : ''];
    });
    return { columnas: ['ref', 'fecha', 'monto', 'operacion', 'estado', 'coincide_por', 'voucher', 'empresa', 'beneficiario', 'proveedor_ia', 'usado_en', 'fila_AJ'], filas: filas };
  },

  /** Asignar un voucher de una vez: empresa, ID usuario (RUC empresa), ID beneficiario (RUC proveedor) y factura(s). */
  asignar_voucher: function (c, a) {
    var emp = AUV_empresaDe_(String(a.empresa || ''), c.cfg) || (c.cfg.grupo.indexOf(aRuc_(a.empresa)) !== -1 ? aRuc_(a.empresa) : '');
    var prov = aRuc_(a.proveedor_ruc || a.id_beneficiario || a.ruc_proveedor || a.proveedor || '');
    var facts = a.facturas || a.factura || '';
    if (Array.isArray(facts)) facts = facts.join(',');
    var pedidos = [];
    if (emp) { pedidos.push(['empresa', c.cfg.nombreEmpresa[emp] || emp]); pedidos.push(['id_usuario', emp]); }
    if (prov) pedidos.push(['id_beneficiario', prov]);
    if (String(facts).trim()) pedidos.push(['factura', String(facts)]);
    if (!pedidos.length) throw new Error('indique empresa, proveedor_ruc y/o facturas');
    var filas = [], errores = [];
    pedidos.forEach(function (p) {
      try {
        var r = ANX_HERR_.proponer_cambio(c, { fila: a.fila, campo: p[0], valor: p[1], motivo: a.motivo || '' });
        filas = filas.concat(r.filas);
      } catch (e) { errores.push(p[0] + ': ' + e.message); }
    });
    return { columnas: ['id', 'fila', 'columna', 'valor_actual', 'valor_nuevo', 'aviso'], filas: filas,
      nota: (errores.length ? 'No se pudo: ' + errores.join(' · ') + '. ' : '') + 'Nada se escribe todavía: el usuario lo aprueba con ✅.' };
  },

  proponer_cambio: function (c, a) {
    var fuente = String(a.fila || a.voucher || '').replace(/\s/g, '');
    var m = fuente.match(/^(.+)!(\d+)$/);
    if (!m) throw new Error('"fila" debe ser como Originales!120 (la fila del voucher)');
    var libro = SpreadsheetApp.openById(c.cfg.idVouchers);
    var sh = libro.getSheetByName(m[1]);
    if (!sh) throw new Error('no existe la pestaña ' + m[1] + ' en Vouchers');
    var fila = parseInt(m[2], 10);
    if (fila < 2 || fila > sh.getLastRow()) throw new Error('la fila ' + fila + ' no tiene datos en ' + m[1]);
    var enc = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var campo = String(a.campo || a.columna || '').trim();
    var col = ANX_columna_(enc, campo);
    if (col < 0) throw new Error('no encuentro la columna "' + campo + '" en ' + m[1] + '; columnas: ' + enc.filter(String).join(', '));
    var actual = sh.getRange(fila, col + 1).getDisplayValue();
    var nuevo = ANX_normalizar_(c, String(enc[col]), String(a.valor == null ? '' : a.valor).trim());
    if (!nuevo) throw new Error('falta "valor"');
    c.cambios = c.cambios || [];
    var id = 'C' + (c.cambios.length + 1);
    var aviso = !String(actual).trim() ? 'celda vacía: se puede escribir' :
      String(actual).trim() === nuevo ? 'ya tiene ese mismo dato: no hace falta' : 'ya tiene «' + actual + '»: solo se cambia si marca "reemplazar"';
    if (String(actual).trim() !== nuevo) {
      c.cambios.push({ id: id, hoja: m[1], fila: fila, col: col + 1, encabezado: String(enc[col]), actual: String(actual), nuevo: nuevo,
        motivo: String(a.motivo || '').slice(0, 300), aviso: aviso, url: ANX_url_(c.cfg.idVouchers, sh, sh.getRange(fila, col + 1).getA1Notation()) });
    }
    return { columnas: ['id', 'fila', 'columna', 'valor_actual', 'valor_nuevo', 'aviso'], filas: [[String(actual).trim() === nuevo ? '-' : id, fuente, String(enc[col]), actual, nuevo, aviso]],
      nota: 'Nada se escribe todavía: el usuario lo aprueba con ✅ en el chat o ✔ en 💬 Resultado IA.' };
  },
};

/**
 * Deja el valor como lo usa la hoja: Empresa = nombre corto del grupo, ID Usuario /
 * ID Beneficiario = RUC (11 dígitos), Factura = "01_F001-123" (varias separadas por coma).
 */
function ANX_normalizar_(c, encabezado, v) {
  var h = normHeader_(encabezado);
  if (/^empresa/.test(h)) { var r = AUV_empresaDe_(v, c.cfg); return r ? (c.cfg.nombreEmpresa[r] || v) : v; }
  if (/^id usuario/.test(h)) { var e = aRuc_(v) || AUV_empresaDe_(v, c.cfg); return e || v; }
  if (/^id benef|^ruc/.test(h)) return aRuc_(v) || v;
  if (/^tipo y n|factura/.test(h)) {
    return v.split(/[,;\s]+/).filter(Boolean).map(function (t) {
      t = t.toUpperCase().replace(/^(FACTURA|FACT|FT)[:.\s]*/, '');
      if (/^\d{2}_/.test(t)) return t;
      var m = t.match(/^([A-Z]\w{3})-0*(\d+)$/);
      if (!m) return t;
      return (/^B/.test(m[1]) ? '03' : /^(07|NC)/.test(m[1]) ? '07' : '01') + '_' + m[1] + '-' + m[2];
    }).join(',');
  }
  return v;
}

/** Columna de la hoja de vouchers para un campo ("factura", "ID Beneficiario"…). -1 si no está. */
function ANX_columna_(enc, campo) {
  var col = indiceColumnas_(enc);
  var k = normHeader_(campo).replace(/\s+/g, '_');
  var nombres = ANX_CAMPOS_[k] || [campo];
  var j = col.apply(null, nombres);
  if (j < 0) j = col(campo);
  return j;
}

/* ============================================================ cambios */

function ANX_hojaCambios_(ss) {
  var sh = ss.getSheetByName(ANX_CAMBIOS_);
  if (sh) return sh;
  sh = ss.insertSheet(ANX_CAMBIOS_);
  sh.getRange(1, 1, 1, ANX_ENC_CAMBIOS_.length).setValues([ANX_ENC_CAMBIOS_]).setFontWeight('bold');
  sh.hideSheet();
  return sh;
}

/** Guarda los cambios propuestos de una respuesta (para aprobarlos después). Devuelve el lote. */
function ANX_guardarPropuestos_(ss, cambios) {
  if (!cambios || !cambios.length) return '';
  var lote = 'P' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd-HHmmss');
  cambios.forEach(function (x) { x.id = lote + '-' + x.id; });
  var sh = ANX_hojaCambios_(ss);
  sh.getRange(sh.getLastRow() + 1, 1, cambios.length, ANX_ENC_CAMBIOS_.length).setValues(cambios.map(function (x) {
    return [lote, x.id, 'propuesto', x.hoja, x.fila, x.col, x.encabezado, x.actual, x.nuevo, x.motivo, new Date(), ''];
  }));
  return lote;
}

/**
 * Aplica los cambios aprobados (por ID). Solo celdas vacías, salvo `reemplazar`.
 * Se registra en _ImportLog (el mismo registro de ↩️ Deshacer) y en _Cambios IA.
 */
function ANX_aplicar_(ss, ids, reemplazar) { return ANX_aplicarDet_(ss, ids, reemplazar).mensaje; }

/** Enlace que abre la hoja de vouchers en esa pestaña y celda(s). */
function ANX_url_(idLibro, sh, a1) {
  return 'https://docs.google.com/spreadsheets/d/' + idLibro + '/edit#gid=' + sh.getSheetId() + '&range=' + a1;
}

/** Como ANX_aplicar_, pero devuelve también los enlaces a las filas cambiadas: {mensaje, enlaces:[{fila, rango, url}]}. */
function ANX_aplicarDet_(ss, ids, reemplazar) {
  var sh = ANX_hojaCambios_(ss);
  if (sh.getLastRow() < 2 || !ids || !ids.length) return { mensaje: 'No hay cambios para aplicar.', enlaces: [] };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, ANX_ENC_CAMBIOS_.length).getValues();
  var quiero = {};
  ids.forEach(function (i) { quiero[String(i)] = true; });
  var cfg = leerConfig_(ss);
  var libro = SpreadsheetApp.openById(cfg.idVouchers);
  var lote = 'IA' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd-HHmmss');
  var log = [], hechos = 0, saltados = [], filas = {};
  var cuando = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm');
  v.forEach(function (r, i) {
    if (!quiero[r[1]] || r[2] !== 'propuesto') return;
    var shV = libro.getSheetByName(r[3]);
    if (!shV) { saltados.push(r[1] + ': no existe ' + r[3]); return; }
    var celda = shV.getRange(r[4], r[5]);
    var antes = String(celda.getDisplayValue()).trim();
    if (antes && !reemplazar) { saltados.push(r[3] + '!' + r[4] + ' ' + r[6] + ' ya tiene «' + antes + '»'); sh.getRange(i + 2, 3).setValue('no aplicado: ya tenía dato'); return; }
    if (/^(id |ruc)/i.test(String(r[6])) || /^\d{8,11}$/.test(String(r[8]))) celda.setNumberFormat('@');
    celda.setValue(r[8]);
    try { celda.setNote('✏️ Escrito por la IA ' + cuando + (r[9] ? ': ' + String(r[9]).slice(0, 250) : '') + (antes ? '\nAntes: ' + antes : '')); } catch (e) { /* sin nota */ }
    var k = r[3] + '!' + r[4];
    var f = filas[k] = filas[k] || { hoja: r[3], fila: r[4], min: r[5], max: r[5], sh: shV };
    f.min = Math.min(f.min, r[5]); f.max = Math.max(f.max, r[5]);
    log.push([lote, new Date(), r[3], r[4], r[5], r[6], r[8], '', antes]);
    sh.getRange(i + 2, 3, 1, 1).setValue('aplicado');
    sh.getRange(i + 2, 12).setValue(lote);
    hechos++;
  });
  if (log.length) {
    var shL = IMP_hojaLog_(ss);
    shL.getRange(shL.getLastRow() + 1, 1, log.length, 9).setValues(log);
  }
  var r2 = hechos ? actualizarTodo_(true) : '';
  var enlaces = Object.keys(filas).map(function (k) {
    var f = filas[k];
    var a1 = f.sh.getRange(f.fila, f.min, 1, f.max - f.min + 1).getA1Notation();
    return { fila: k, rango: a1, url: ANX_url_(cfg.idVouchers, f.sh, a1) };
  });
  return {
    mensaje: (hechos ? '✅ ' + hechos + ' dato(s) escritos en Vouchers' : 'No se escribió nada') + (saltados.length ? ' · se dejaron ' + saltados.length + ': ' + saltados.slice(0, 5).join('; ') : '') +
      (hechos ? ' · cada celda escrita lleva una nota "✏️ Escrito por la IA" · se puede deshacer (↩️)' : '') + (r2 ? ' · ' + r2 : ''),
    enlaces: enlaces,
  };
}

/** Deshace el último lote de cambios de la IA (solo si la celda sigue con lo que se escribió). */
function ANX_deshacer_(ss) {
  var shL = ss.getSheetByName(IMP_LOG_);
  if (!shL || shL.getLastRow() < 2) return 'No hay cambios de la IA para deshacer.';
  var v = shL.getRange(2, 1, shL.getLastRow() - 1, 9).getValues();
  var lotes = v.map(function (r) { return String(r[0]); }).filter(function (l) { return /^IA/.test(l); });
  if (!lotes.length) return 'No hay cambios de la IA para deshacer.';
  var lote = lotes[lotes.length - 1];
  var cfg = leerConfig_(ss);
  var libro = SpreadsheetApp.openById(cfg.idVouchers);
  var vueltos = 0, dejados = 0, borrar = [];
  v.forEach(function (r, i) {
    if (String(r[0]) !== lote) return;
    borrar.push(i + 2);
    var shV = libro.getSheetByName(r[2]);
    if (!shV) { dejados++; return; }
    var c = shV.getRange(r[3], r[4]);
    if (String(c.getDisplayValue()).trim() !== String(r[6]).trim()) { dejados++; return; }
    if (String(r[8]).trim()) c.setValue(r[8]); else c.clearContent();
    try { if (/^✏️ Escrito por la IA/.test(String(c.getNote()))) c.setNote(''); } catch (e) { /* sin nota */ }
    vueltos++;
  });
  for (var k = borrar.length - 1; k >= 0; k--) shL.deleteRow(borrar[k]);
  var shC = ss.getSheetByName(ANX_CAMBIOS_);
  if (shC && shC.getLastRow() >= 2) {
    var w = shC.getRange(2, 1, shC.getLastRow() - 1, ANX_ENC_CAMBIOS_.length).getValues();
    w.forEach(function (r, i) { if (r[11] === lote) shC.getRange(i + 2, 3).setValue('deshecho'); });
  }
  var r2 = vueltos ? actualizarTodo_(true) : '';
  return '↩️ Deshecho: ' + vueltos + ' dato(s) vueltos a como estaban' + (dejados ? ', ' + dejados + ' se dejaron porque alguien los cambió después' : '') + (r2 ? ' · ' + r2 : '');
}

/** Menú: aplica los cambios marcados con ✔ en la pestaña 💬 Resultado IA. */
function ANX_menuAplicarMarcados() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ANA_HOJA_);
  if (!sh) { SpreadsheetApp.getUi().alert('No hay cambios propuestos (pestaña ' + ANA_HOJA_ + ').'); return; }
  var v = sh.getDataRange().getValues();
  var ids = [], reemplazar = false;
  v.forEach(function (r) {
    if (r[0] === true && /^P\d{8}-\d{6}-C\d+$/.test(String(r[1]))) ids.push(String(r[1]));
    if (String(r[0]) === 'Reemplazar si ya tiene dato' && r[1] === true) reemplazar = true;
  });
  if (!ids.length) { SpreadsheetApp.getUi().alert('Marque con ✔ los cambios a aplicar en la tabla "✏️ Cambios propuestos" de ' + ANA_HOJA_ + '.'); return; }
  var msg;
  try {
    var d = ANX_aplicarDet_(ss, ids, reemplazar);
    msg = d.mensaje + (d.enlaces.length ? '\n\nPara verlos en la hoja de vouchers (copie el enlace):\n' + d.enlaces.map(function (e) { return e.fila + ' (' + e.rango + '): ' + e.url; }).join('\n') : '');
  } catch (e) { msg = '❌ ' + e.message; }
  ss.toast(msg.split('\n')[0], '✏️ Cambios de la IA', 15);
  SpreadsheetApp.getUi().alert('✏️ Cambios de la IA', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function ANX_menuDeshacer() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var msg;
  try { msg = ANX_deshacer_(ss); } catch (e) { msg = '❌ ' + e.message; }
  SpreadsheetApp.getUi().alert('↩️ Cambios de la IA', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}
