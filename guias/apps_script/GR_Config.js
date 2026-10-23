/**
 * 🚚 Guías de Remisión Remitente · Grupo — definiciones (prefijo GR_).
 *
 * Una fila de la pestaña 🚚 Guías = una guía, con todo lo que pide SUNAT (GRE Remitente, UBL 2.1)
 * y el formulario de Quesito. Los productos van en 📦 Productos solo si la guía NO lleva todo lo de
 * la factura (traslado parcial) o si no hay factura. Las pestañas de catálogo (empresas,
 * transportistas, vehículos, conductores, direcciones) llenan solos los datos que se repiten.
 */

var GR_HOJA_ = '🚚 Guías';
var GR_PROD_ = '📦 Productos';
var GR_EMP_ = '🏢 Empresas';
var GR_TRA_ = '🚛 Transportistas';
var GR_VEH_ = '🚗 Vehículos';
var GR_CON_ = '👤 Conductores';
var GR_DIR_ = '📍 Direcciones';
var GR_UBI_ = '🗺️ Ubigeos';
var GR_LIS_ = 'Listas';
var GR_REG_ = '🧾 Registro';
var GR_AYU_ = '📖 Ayuda';
var GR_FILA1_ = 3;
var GR_VERSION_ = 2;   // súbalo cuando cambien columnas o listas: la hoja se repara sola al abrir   // primera fila de datos (1 = grupos, 2 = títulos)

// Catálogos SUNAT (anexo 8 de la R.S. 097-2012 y modificatorias).
var GR_MOTIVOS_ = ['01 - Venta', '02 - Compra', '03 - Venta con entrega a terceros', '04 - Traslado entre establecimientos de la misma empresa',
  '05 - Consignación', '06 - Devolución', '07 - Recojo de bienes transformados', '08 - Importación', '09 - Exportación', '13 - Otros',
  '14 - Venta sujeta a confirmación del comprador', '17 - Traslado de bienes para transformación', '18 - Traslado emisor itinerante CP',
  '19 - Traslado a zona primaria'];
var GR_MODALIDAD_ = ['01 - Transporte público', '02 - Transporte privado'];
var GR_TIPODOC_ = ['6 - RUC', '1 - DNI', '4 - Carnet de extranjería', '7 - Pasaporte'];
var GR_DOCREL_ = ['Factura', 'Boleta', 'Ninguno'];
var GR_PESO_ = ['KGM - Kilogramo', 'TNE - Tonelada'];
var GR_UNIDADES_ = ['NIU - Unidad', 'KGM - Kilogramo', 'BX - Caja', 'BG - Bolsa', 'SA - Saco', 'PK - Paquete', 'TNE - Tonelada',
  'LTR - Litro', 'GLL - Galón', 'BO - Botella', 'CA - Lata', 'DZN - Docena', 'MTR - Metro', 'ZZ - Unidad (servicios)'];
var GR_SINO_ = ['SI', 'NO'];
var GR_ESTADOS_ = { BORRADOR: '✏️ Borrador', LISTA: '✅ Lista para emitir', VISTA: '👁 Vista previa', EMITIENDO: '⏳ Emitiendo',
  EMITIDA: '🚚 Emitida', ERROR: '⚠️ Error', ANULADA: '🚫 Anulada' };

// Grupos de columnas: título de la banda (fila 1) y color.
var GR_GRUPOS_ = {
  id: ['🆔 GUÍA', '#37474f'], comp: ['🧾 COMPROBANTE', '#546e7a'], dest: ['👤 DESTINATARIO', '#1565c0'], tras: ['🚚 TRASLADO', '#e65100'],
  pub: ['🏢 TRANSPORTISTA (público)', '#6a1b9a'], priv: ['🚗 VEHÍCULO Y CONDUCTOR (privado)', '#2e7d32'],
  par: ['📍 PARTIDA', '#00695c'], lle: ['🏁 LLEGADA', '#00838f'], otro: ['📝 OTROS', '#5d4037'], res: ['✅ RESULTADO (lo llena el robot)', '#263238'],
};

/**
 * Columnas de 🚚 Guías. k = clave interna, t = título, g = grupo, w = ancho, n = nota del encabezado,
 * v = lista desplegable (array, 'ubigeo' o 'fecha'), f = formato de número.
 */
var GR_COLS_ = [
  { k: 'id', t: 'ID', g: 'id', w: 78, n: 'Se pone solo al llenar la fila (G-000001). No lo cambie.' },
  { k: 'estado', t: 'Estado', g: 'id', w: 210, n: '✏️ Borrador = falta algo (dice qué). ✅ Lista = se puede emitir. El resto lo pone el robot.' },
  { k: 'empresa', t: 'Empresa (remitente)', g: 'id', w: 120, v: 'empresas', n: 'Empresa que emite la guía (pestaña 🏢 Empresas). Llena sola el punto de partida.' },
  { k: 'cotizacion', t: 'N° cotización', g: 'comp', w: 90, n: 'Opcional. Ayuda a ubicar la factura en Quesito ("Relacionado: Cotización N").' },
  { k: 'docrel', t: 'Doc. relacionado', g: 'comp', w: 100, v: GR_DOCREL_, n: 'Factura o boleta de la que sale la guía (Quesito la genera desde ella y trae cliente y productos). "Ninguno" = guía sin comprobante: llene los productos.' },
  { k: 'serie', t: 'Serie', g: 'comp', w: 62, n: '4 caracteres, tal cual en Quesito (ej. F001, FQQ1, E001).' },
  { k: 'numero', t: 'Número', g: 'comp', w: 72, f: '0', n: 'Número de la factura o boleta (sin ceros a la izquierda).' },
  { k: 'tdest', t: 'Tipo doc.', g: 'dest', w: 80, v: GR_TIPODOC_, n: 'Documento del destinatario (cliente). Con factura/boleta Quesito lo toma del comprobante: puede quedar vacío (🔎 Traer de la factura lo llena). Con factura es siempre RUC.' },
  { k: 'ndest', t: 'N° documento', g: 'dest', w: 105, f: '@', n: 'RUC (11 dígitos, se revisa el dígito verificador) o DNI (8). Si ya está en 📍 Direcciones, llena solo el nombre y la llegada.' },
  { k: 'dest', t: 'Destinatario', g: 'dest', w: 230, n: 'Razón social o nombre del cliente.' },
  { k: 'motivo', t: 'Motivo de traslado', g: 'tras', w: 170, v: GR_MOTIVOS_, n: 'Catálogo 20 de SUNAT. Lo normal: 01 - Venta.' },
  { k: 'motivoTxt', t: 'Descripción (motivo 13)', g: 'tras', w: 150, n: 'Solo si el motivo es 13 - Otros: describa el motivo.' },
  { k: 'modalidad', t: 'Modalidad', g: 'tras', w: 150, v: GR_MODALIDAD_, n: '01 Público = lo lleva un transportista (llene 🏢). 02 Privado = vehículo propio (llene 🚗).' },
  { k: 'fecha', t: 'Fecha inicio traslado', g: 'tras', w: 95, v: 'fecha', f: 'dd/mm/yyyy', n: 'Día en que sale la mercadería. SUNAT no acepta una fecha anterior a la emisión de la guía.' },
  { k: 'total', t: '¿Todo lo de la factura?', g: 'tras', w: 95, v: GR_SINO_, n: 'SI = la guía lleva TODOS los productos de la factura. NO = solo una parte: ponga los productos y cantidades en 📦 Productos.' },
  { k: 'peso', t: 'Peso bruto', g: 'tras', w: 80, f: '#,##0.00', n: 'Peso bruto total de ESTA guía. Si los productos de 📦 tienen peso, se suma solo.' },
  { k: 'upeso', t: 'Unidad', g: 'tras', w: 65, v: GR_PESO_, n: 'KGM (kilos) o TNE (toneladas).' },
  { k: 'bultos', t: 'N° bultos', g: 'tras', w: 62, f: '#,##0.##', n: 'Bultos o paquetes de la guía. Si los productos de 📦 tienen bultos, se suma solo.' },
  { k: 'm1', t: '¿Vehículo M1 o L?', g: 'tras', w: 80, v: GR_SINO_, n: 'SI si el traslado es en auto (M1) o moto/mototaxi (L): entonces no se piden placa ni conductor.' },
  { k: 'truc', t: 'RUC transportista', g: 'pub', w: 105, f: '@', n: 'Solo transporte público. Si está en 🚛 Transportistas, llena el nombre y el MTC.' },
  { k: 'tnom', t: 'Razón social transportista', g: 'pub', w: 220 },
  { k: 'mtc', t: 'N° registro MTC', g: 'pub', w: 95, f: '@', n: 'Registro del transportista en el MTC (si lo tiene).' },
  { k: 'placa', t: 'Placa principal', g: 'priv', w: 80, n: 'Solo transporte privado. Ej. ABC-123 (sin espacios). Si está en 🚗 Vehículos, se revisa.' },
  { k: 'placa2', t: 'Placa secundaria', g: 'priv', w: 80, n: 'Opcional (carreta, remolque).' },
  { k: 'mtcveh', t: 'Cert. habilitación MTC', g: 'priv', w: 140, f: '@', n: 'Certificado de habilitación vehicular (MTC) de las placas, ej. 15M26029908E/15M26029906E. Se llena desde 🚗 Vehículos y sale en Observaciones.' },
  { k: 'cdni', t: 'DNI conductor', g: 'priv', w: 85, f: '@', n: 'Si está en 👤 Conductores, llena nombres, apellidos y licencia.' },
  { k: 'cnom', t: 'Nombres conductor', g: 'priv', w: 130 },
  { k: 'cape', t: 'Apellidos conductor', g: 'priv', w: 140 },
  { k: 'clic', t: 'Licencia', g: 'priv', w: 90, f: '@', n: 'Licencia de conducir (ej. Q12345678).' },
  { k: 'plocal', t: 'Local de partida', g: 'par', w: 170, v: 'locales', n: 'Almacén o local de donde sale (📍 Direcciones, uso Partida). Al elegirlo se llenan el distrito, la dirección y el código de local. Si lo deja vacío, se usa la dirección de la empresa.' },
  { k: 'pubi', t: 'Ubigeo partida', g: 'par', w: 190, v: 'ubigeo', n: 'Se llena con la dirección de la empresa (🏢 Empresas). Elija o escriba el distrito o el código de 6 dígitos.' },
  { k: 'pdir', t: 'Dirección partida', g: 'par', w: 240 },
  { k: 'pest', t: 'Cód. local partida', g: 'par', w: 75, f: '@', n: 'Código de establecimiento anexo de SUNAT (0000 = domicilio fiscal). Obligatorio en el motivo 04.' },
  { k: 'llocal', t: 'Local de llegada', g: 'lle', w: 170, v: 'locales', n: 'Dirección del cliente o almacén de destino (📍 Direcciones). Al elegirla se llenan el distrito, la dirección y el código de local.' },
  { k: 'lubi', t: 'Ubigeo llegada', g: 'lle', w: 190, v: 'ubigeo', n: 'Distrito de destino. Si el cliente ya tiene dirección en 📍 Direcciones, se llena sola.' },
  { k: 'ldir', t: 'Dirección llegada', g: 'lle', w: 240 },
  { k: 'lest', t: 'Cód. local llegada', g: 'lle', w: 75, f: '@', n: 'Solo motivo 04 (traslado entre establecimientos de la misma empresa).' },
  { k: 'obs', t: 'Observaciones', g: 'otro', w: 220, n: 'Texto libre que sale en la guía (ej. lotes, referencia del pedido).' },
  { k: 'obsFinal', t: 'Observaciones que irá en la guía (automático)', g: 'otro', w: 320,
    n: 'Lo arma la hoja: sus observaciones + cotización, N° MTC, placas y conductor (Quesito no tiene campos propios para esos datos, así quedan en la guía). Es lo que el robot pondrá en Observaciones.' },
  { k: 'productos', t: 'Productos (de 📦)', g: 'otro', w: 200, n: 'Resumen automático de 📦 Productos para esta guía (solo si es parcial o sin factura).' },
  { k: 'guia', t: 'N° guía emitida', g: 'res', w: 95 },
  { k: 'femi', t: 'Emitida el', g: 'res', w: 115, f: 'dd/mm/yyyy hh:mm' },
  { k: 'sunat', t: 'Estado SUNAT', g: 'res', w: 120 },
  { k: 'pdf', t: 'PDF', g: 'res', w: 70 },
  { k: 'ticket', t: 'Ticket SUNAT', g: 'res', w: 120 },
  { k: 'msg', t: 'Mensaje / error', g: 'res', w: 240 },
  { k: 'actualizado', t: 'Actualizado', g: 'res', w: 115, f: 'dd/mm/yyyy hh:mm' },
];

// Pestañas de catálogo: títulos y anchos. La primera columna es la clave de búsqueda.
var GR_CATALOGOS_ = {};
GR_CATALOGOS_[GR_EMP_] = { color: '#37474f', cols: [['Empresa', 120], ['RUC', 105], ['Razón social', 260], ['Correo de Quesito', 200], ['Serie de guía', 85],
  ['Ubigeo partida', 190], ['Dirección partida', 260], ['Cód. local', 75], ['Activa', 60], ['Serie de factura', 85]],
  nota: 'Una fila por empresa que emite guías. La clave de Quesito NO va aquí: se guarda como secreto en GitHub.' };
GR_CATALOGOS_[GR_TRA_] = { color: '#6a1b9a', cols: [['RUC', 105], ['Razón social', 300], ['N° registro MTC', 120], ['Activo', 60]],
  nota: 'Transportistas (transporte público).' };
GR_CATALOGOS_[GR_VEH_] = { color: '#2e7d32', cols: [['Placa', 85], ['Descripción (marca, modelo, tipo)', 260], ['¿M1 o L?', 70], ['Empresa', 120], ['Activo', 60], ['Cert. habilitación MTC', 140]],
  nota: 'Vehículos propios (transporte privado). Placa sin espacios, ej. ABC-123. El certificado MTC de la placa sale en las Observaciones de la guía.' };
GR_CATALOGOS_[GR_CON_] = { color: '#2e7d32', cols: [['DNI', 90], ['Nombres', 160], ['Apellidos', 180], ['Licencia', 100], ['Activo', 60]],
  nota: 'Conductores (transporte privado).' };
GR_CATALOGOS_[GR_DIR_] = { color: '#00838f', cols: [['Local (nombre corto)', 170], ['RUC / DNI', 105], ['Nombre (empresa o cliente)', 240], ['Uso', 80], ['Ubigeo', 190], ['Dirección', 320], ['Cód. local', 75], ['Nota', 160]],
  nota: 'Almacenes propios (uso Partida: una empresa puede tener varios) y direcciones de clientes (uso Llegada). El "Local" es el nombre que se elige en la guía (ej. "M&D Taparachi", "FASUE Tacna"). Si escribe la dirección con "- DISTRITO - PROVINCIA - DEPARTAMENTO" al final, el ubigeo se pone solo.' };

// Empresas precargadas (las que hoy emiten en Quesito; GRANIX queda inactiva para más adelante).
var GR_EMPRESAS_INICIALES_ = [
  ['M&D', '20447623669', 'PROCESOS ALIMENTARIOS M&D E.I.R.L.', '', '', '', '', '0000', 'SI', 'FQQ1'],
  ['DSM', '20447968216', 'DSM CORPORACION E.I.R.L.', '', '', '', '', '0000', 'SI', 'FQQ1'],
  ['GRANIX', '20447969531', 'CORPORACION GRANIX E.I.R.L.', '', '', '', '', '0000', 'NO', ''],
];

/** Índice (0-based) de cada clave en GR_COLS_. */
function GR_idx_() {
  var m = {};
  GR_COLS_.forEach(function (c, i) { m[c.k] = i; });
  return m;
}

function GR_col_(k) { return GR_idx_()[k] + 1; }

/** RUC válido (11 dígitos, empieza en 10/15/16/17/20 y cuadra el dígito verificador). */
function GR_rucValido_(r) {
  r = String(r || '').replace(/\D/g, '');
  if (!/^(10|15|16|17|20)\d{9}$/.test(r)) return false;
  var w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], s = 0;
  for (var i = 0; i < 10; i++) s += Number(r[i]) * w[i];
  var d = 11 - (s % 11);
  if (d === 10) d = 0; else if (d === 11) d = 1;
  return d === Number(r[10]);
}

/** "150137" o "150137 · SANTA ANITA (LIMA / LIMA)" → "150137". */
function GR_codUbigeo_(v) {
  var m = String(v || '').match(/\b(\d{6})\b/);
  return m ? m[1] : '';
}

function GR_etiquetaUbigeo_(linea) {
  var p = linea.split('|');
  return p[0] + ' · ' + p[3] + ' (' + p[2] + ' / ' + p[1] + ')';
}

/** Mapa código → etiqueta (cacheado en memoria del script durante la ejecución). */
var GR_UBI_MAPA_ = null;
function GR_ubigeos_() {
  if (GR_UBI_MAPA_) return GR_UBI_MAPA_;
  GR_UBI_MAPA_ = {};
  GR_UBIGEOS_.forEach(function (l) { GR_UBI_MAPA_[l.slice(0, 6)] = GR_etiquetaUbigeo_(l); });
  return GR_UBI_MAPA_;
}

/** Busca un distrito por nombre ("santa anita", "juliaca puno") → etiqueta, o '' si no hay uno solo. */
function GR_buscarUbigeo_(txt) {
  var cod = GR_codUbigeo_(txt);
  if (cod) return GR_ubigeos_()[cod] || '';
  var q = GR_norm_(txt).split(' ').filter(String);
  if (!q.length) return '';
  var hits = GR_UBIGEOS_.filter(function (l) {
    var t = ' ' + GR_norm_(l.replace(/\|/g, ' ')) + ' ';
    return q.every(function (w) { return t.indexOf(' ' + w) >= 0; });
  });
  if (hits.length === 1) return GR_etiquetaUbigeo_(hits[0]);
  // Si el texto es exactamente el nombre de un distrito, ese (ej. "LIMA" → Lima cercado no; "JULIACA" sí).
  var exactos = hits.filter(function (l) { return GR_norm_(l.split('|')[3]) === q.join(' '); });
  return exactos.length === 1 ? GR_etiquetaUbigeo_(exactos[0]) : '';
}

function GR_norm_(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "ABC123" / "abc 123" → "ABC-123" (placas peruanas de 6 caracteres). */
function GR_placa_(p) {
  var s = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6 ? s.slice(0, 3) + '-' + s.slice(3) : String(p || '').toUpperCase().trim();
}

/** Código de local SUNAT de 4 dígitos ("0" → "0000"). */
function GR_codLocal_(v) {
  var d = String(v == null ? '' : v).replace(/\D/g, '');
  return d ? ('0000' + d).slice(-4) : '';
}

/** Ubigeo a partir del final de una dirección: "… - JULIACA - SAN ROMAN - PUNO" o "… TACNA - TACNA - ALTO DE LA ALIANZA". */
function GR_ubigeoDeTexto_(dir) {
  var partes = String(dir || '').split(/\s*-\s*/).map(function (x) { return x.trim(); }).filter(String);
  for (var n = Math.min(3, partes.length); n >= 1; n--) {
    var cola = partes.slice(-n);
    // El primer trozo de la cola puede traer la calle pegada ("PARQUE INDUSTRIAL TACNA"): se prueba con sus últimas palabras.
    var pal = cola[0].split(/\s+/);
    for (var k = 1; k <= Math.min(4, pal.length); k++) {
      var et = GR_buscarUbigeo_(pal.slice(-k).concat(cola.slice(1)).join(' '));
      if (et) return et;
    }
  }
  return '';
}

/** "HENRRY NOEL CABANA MAMANI" → {nom: 'HENRRY NOEL', ape: 'CABANA MAMANI'} (los dos últimos son los apellidos). */
function GR_partirNombre_(t) {
  var p = String(t || '').trim().split(/\s+/).filter(String);
  if (p.length < 3) return { nom: p.slice(0, 1).join(' '), ape: p.slice(1).join(' ') };
  return { nom: p.slice(0, -2).join(' '), ape: p.slice(-2).join(' ') };
}
