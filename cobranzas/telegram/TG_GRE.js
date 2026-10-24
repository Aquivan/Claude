/**
 * 🚚 Guía de Remisión Electrónica (GRE) Remitente por SUNAT SOL — Telegram y WhatsApp.  Prefijo TGG_.
 *
 * La persona manda fotos/PDF (factura, ticket de despacho o balanza, tarjeta del transportista) o escribe
 * los datos. La IA (Gemini) los lee y aquí se arma la propuesta:
 *   · motivo: Compra si la factura es A una empresa del grupo, Venta si la emite una empresa del grupo;
 *   · bienes: todas las líneas de la factura (o solo las que diga la persona: "solo 1 a 5", "la mitad");
 *   · peso: el que diga la persona, si no el del ticket, si no la suma de pesos por línea;
 *   · partida / llegada, transportista (RUC y MTC), placas y chofer (estos dos solo si se piden registrar).
 * ✏️ Corregir → la persona escribe el cambio en sus palabras. 👁 Vista previa → GitHub (gre-sunat.yml) llena
 * la guía en SOL sin emitir y manda la foto aquí. ✅ Emitir → pide confirmar y recién emite, con la huella de
 * ESE caso (si algo cambió después, no emite).
 * Los datos del caso (chofer, placas, contraparte) quedan solo en la pestaña 🚚 Guías SUNAT de esta hoja; a
 * GitHub (repositorio público) solo va el código del caso y el robot los pide aquí (accion gre_caso).
 */

var TGG_WF_ = 'gre-sunat.yml';
var TGG_HOJA_ = '🚚 Guías SUNAT';
var TGG_ENC_ = ['Creado', 'Caso', 'Empresa', 'Motivo', 'Documento', 'Contraparte', 'Bienes', 'Peso kg', 'Transportista', 'Estado', 'GRE', 'Chat', 'Actualizado', 'Datos'];
var TGG_PIDE_RX_ = /\b(gu[ií]a(s)?( de remisi[oó]n)?|gre|remisi[oó]n)\b/i;

/* ============================================================ registro (pestaña 🚚 Guías SUNAT) */

function TGG_hoja_(ss) {
  var sh = ss.getSheetByName(TGG_HOJA_);
  if (!sh) {
    sh = ss.insertSheet(TGG_HOJA_);
    sh.getRange(1, 1, 1, TGG_ENC_.length).setValues([TGG_ENC_]).setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(1);
    sh.hideColumns(TGG_ENC_.length);
  }
  return sh;
}

function TGG_fila_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

function TGG_guardar_(ss, c) {
  var sh = TGG_hoja_(ss), f = TGG_fila_(sh, c.id) || sh.getLastRow() + 1, ahora = new Date();
  var t = c.transporte || {};
  sh.getRange(f, 1, 1, TGG_ENC_.length).setValues([[c.creado ? new Date(c.creado) : ahora, c.id, c.empresa || c.empresa_ruc, c.motivo,
    (c.documento && c.documento.numero) || '', (c.contraparte && c.contraparte.nombre) || '', (c.bienes || []).length, c.peso_kg || '',
    t.nombre || t.ruc || '', c.estado || 'Propuesta', c.gre || '', c.chat || '', ahora, JSON.stringify(c)]]);
}

function TGG_leer_(ss, id) {
  var sh = TGG_hoja_(ss), f = TGG_fila_(sh, id);
  if (!f) return null;
  try { return JSON.parse(sh.getRange(f, TGG_ENC_.length).getValue()); } catch (e) { return null; }
}

/** Lo que recibe el robot (texto exacto: su huella es la clave para emitir). */
function TGG_paraRobot_(c) {
  return JSON.stringify({ id: c.id, empresa_ruc: c.empresa_ruc, motivo: c.motivo, contraparte: c.contraparte, documento: c.documento,
    bienes: c.bienes, peso_kg: c.peso_kg, bultos: c.bultos || null, partida: c.partida, llegada: c.llegada, transporte: c.transporte, fecha: c.fecha });
}

function TGG_huella_(c) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, TGG_paraRobot_(c), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 10);
}

/* ============================================================ lectura con IA */

var TGG_SISTEMA_LEER_ = [
  'Eres experto en comprobantes de Perú. Lee la imagen o PDF y devuelve SOLO un JSON con lo que se ve (no inventes; si no está, null).',
  'Esquema: {"tipo":"factura|boleta|guia|ticket_despacho|ticket_balanza|transportista|otro",',
  ' "emisor":{"ruc","nombre","direccion"}, "receptor":{"ruc","nombre","direccion"},',
  ' "documento":{"tipo":"Factura|Boleta de Venta","serie","numero","fecha":"dd/mm/aaaa","total"},',
  ' "bienes":[{"descripcion","unidad":"código SUNAT","cantidad":número,"peso_kg":número|null}],',
  ' "peso_total_kg":número|null, "bultos":número|null, "punto_partida":texto|null, "punto_llegada":texto|null,',
  ' "transportista":{"ruc","nombre","mtc"}, "placas":["AON949",...], "conductor":{"nombre","dni","licencia"}}',
  'Unidades SUNAT: NIU unidad, PK paquete, BX caja, BG bolsa, SA saco, KGM kilogramo, TNE tonelada, LTR litro, GLL galón, DZN docena,',
  ' CJ conos, CT cartones, DR tambor, BJ balde, BO botellas, CA latas, MLL millar, SET juego, PR par, ZZ servicio/otros. PQT o PK = PK.',
  'En tickets de despacho o balanza toma el peso total ("TOTAL GENERAL", "peso neto/bruto") y los pesos por línea si los hay.',
  'En la tarjeta del transportista: RUC, razón social, constancia/registro MTC (TODOS los números, ej. "231800409-231800410"), placas EN ORDEN',
  ' (primero el tracto/vehículo principal, luego la carreta/semirremolque; si una placa está tachada y corregida a mano, usa la corregida) y chofer con su licencia.',
  'Licencia peruana: letra + 8 dígitos (ej. D00516821); el DNI suelen ser esos 8 dígitos si no aparece aparte.',
  'Nunca devuelvas números de teléfono ni correos.'
].join('\n');

function TGG_clave_() {
  var k = PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)');
  if (!k) throw new Error('falta la clave de Gemini (pestaña 🤝 Conciliar con IA → 🔑).');
  return k;
}

function TGG_leerUno_(a) {
  var x = ANX_blob_(a), mime = x.mime || x.blob.getContentType();
  if (!/^image\/|pdf/i.test(mime)) return null;
  return IA_llamar_({ proveedor: 'Gemini (Google)', clave: TGG_clave_(), maxTokens: 6000, sistema: TGG_SISTEMA_LEER_,
    texto: 'Lee este documento para una guía de remisión.', adjunto: { mime: /pdf/i.test(mime) ? 'application/pdf' : mime, base64: Utilities.base64Encode(x.blob.getBytes()) } });
}

/** Junta lo leído de cada archivo en un caso. empresas = {ruc: nombre} del grupo. */
function TGG_armar_(lecturas, empresas, chat) {
  var fac = lecturas.filter(function (l) { return l && /factura|boleta|guia/.test(l.tipo) && l.emisor; })[0] || {};
  var tickets = lecturas.filter(function (l) { return l && /ticket/.test(l.tipo); });
  var trans = lecturas.filter(function (l) { return l && l.transportista && l.transportista.ruc; })[0] || {};
  var ruc = function (p) { return String((p && p.ruc) || '').replace(/\D/g, ''); };
  var c = { id: Utilities.getUuid().replace(/-/g, '').slice(0, 8), creado: new Date().toISOString(), chat: chat, estado: 'Propuesta', avisos: [] };
  var em = ruc(fac.emisor), re = ruc(fac.receptor);
  if (empresas[re]) { c.motivo = 'Compra'; c.empresa_ruc = re; c.contraparte = { ruc: em, nombre: (fac.emisor || {}).nombre || '' }; }
  else if (empresas[em]) { c.motivo = 'Venta'; c.empresa_ruc = em; c.contraparte = { ruc: re, nombre: (fac.receptor || {}).nombre || '' }; }
  else { c.motivo = 'Compra'; c.empresa_ruc = ''; c.contraparte = { ruc: em, nombre: (fac.emisor || {}).nombre || '' }; c.avisos.push('La factura no es de ni para una empresa del grupo: dígame cuál emite la guía.'); }
  c.empresa = empresas[c.empresa_ruc] || '';
  var d = fac.documento || {};
  c.documento = d.serie ? { tipo: /boleta/i.test(d.tipo || '') ? 'Boleta de Venta' : 'Factura', numero: String(d.serie).toUpperCase() + '-' + String(d.numero || '').replace(/\D/g, ''),
    ruc_emisor: em, fecha: d.fecha || '', total: d.total || '' } : null;
  c.bienes = (fac.bienes || []).filter(function (b) { return b && b.descripcion; }).map(function (b) {
    return { descripcion: String(b.descripcion).trim(), unidad: String(b.unidad || 'NIU').toUpperCase(), cantidad: Number(b.cantidad) || 1, peso_kg: b.peso_kg || null };
  });
  // Peso: ticket (total) → suma de pesos por línea.
  var pesoTicket = tickets.map(function (t) { return Number(t.peso_total_kg) || 0; }).filter(Boolean)[0];
  if (!pesoTicket) tickets.forEach(function (t) { (t.bienes || []).forEach(function (b) { pesoTicket = (pesoTicket || 0) + (Number(b.peso_kg) || 0); }); });
  var pesoLineas = c.bienes.reduce(function (s, b) { return s + (Number(b.peso_kg) || 0); }, 0);
  c.peso_kg = pesoTicket || pesoLineas || null;
  c.peso_origen = pesoTicket ? 'ticket' : pesoLineas ? 'suma de líneas' : '';
  if (!c.peso_kg) c.avisos.push('No encontré el peso: escríbamelo (ej. "peso 30258.5").');
  var tk = tickets[0] || {};
  c.bultos = Number(tk.bultos) || null;
  var dirEm = (fac.emisor || {}).direccion || '', dirRe = (fac.receptor || {}).direccion || '';
  if (c.motivo === 'Compra') {
    c.partida = { ruc: c.contraparte.ruc, direccion: [tk.punto_partida || fac.punto_partida, dirEm].filter(Boolean).join(' · ') };
    c.llegada = { ruc: '', direccion: fac.punto_llegada || dirRe };
  } else {
    c.partida = { ruc: '', direccion: fac.punto_partida || tk.punto_partida || dirEm };
    c.llegada = { ruc: c.contraparte.ruc, direccion: fac.punto_llegada || dirRe };
  }
  var t = trans.transportista || {}, placas = (trans.placas || []).concat(tk.placas || []);
  var tieneDoc = function (x) { return x && (x.dni || x.licencia); };
  var cond = tieneDoc(trans.conductor) ? trans.conductor : tieneDoc(tk.conductor) ? tk.conductor : null;
  c.transporte = { modo: ruc(t) ? 'publico' : 'privado', ruc: ruc(t), nombre: t.nombre || '', mtc: String(t.mtc || '').split(/[\s,\/-]+/)[0] || '',
    constancias: String(t.mtc || '').split(/[\s,\/-]+/).filter(function (x) { return /\d{5,}/.test(x); }),
    registrar_vehiculos: true, placas: placas.map(function (p) { return String(p).toUpperCase().replace(/[^A-Z0-9]/g, ''); })
      .filter(function (p, i, a) { return p && a.indexOf(p) === i; }),
    conductores: cond && (cond.dni || cond.licencia) ? [{ dni: String(cond.dni || String(cond.licencia || '').replace(/\D/g, '')).replace(/\D/g, ''), licencia: String(cond.licencia || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), nombre: cond.nombre || '' }] : [] };
  // Se registran vehículo y chofer si llegaron (la persona puede decir "sin vehículo" para dejárselo al transportista).
  if (!c.transporte.placas.length || !c.transporte.conductores.length) c.transporte.registrar_vehiculos = c.transporte.modo === 'privado';
  if (c.transporte.modo === 'privado' && !c.transporte.placas.length) c.avisos.push('Falta el transporte: mande la tarjeta del transportista o diga la placa y el chofer.');
  c.fecha = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy');
  if (!c.bienes.length) c.avisos.push('No encontré los bienes: mande la factura o escríbalos.');
  // ❓ Dudas que se le preguntan a la persona (una por vez) antes de la vista previa.
  c.dudas = [];
  var cantFac = c.bienes.reduce(function (s, b) { return s + (Number(b.cantidad) || 0); }, 0), cantTk = Number(tk.bultos) || 0;
  if (c.bienes.length && !(cantTk && Math.abs(cantTk - cantFac) < 0.01))
    c.dudas.push({ k: 'parte', q: '¿La guía es por el TOTAL de la factura (' + TG_num_(cantFac) + ' en ' + c.bienes.length + ' línea(s))' +
      (cantTk ? ' o solo por lo que dice el ticket (' + TG_num_(cantTk) + ')' : '') + ', o por una parte? Ej.: "total", "solo líneas 1 a 5", "la mitad", "200 de la línea 3".' });
  if (!ruc(t) && !c.transporte.placas.length)
    c.dudas.push({ k: 'transporte', q: '¿Cómo se traslada? Con una empresa de transporte (público: deme su RUC) o en vehículo propio (privado: placa, y chofer con DNI y licencia).' });
  return c;
}

var TGG_SISTEMA_EDITAR_ = [
  'Corriges el borrador de una guía de remisión de Perú (JSON). Aplica EXACTAMENTE lo que pide la persona y devuelve el JSON completo con el mismo esquema.',
  'Ejemplos: "peso 30258.5" → peso_kg; "solo líneas 1 a 5" → deja solo esos bienes (numerados desde 1); "la mitad de cada uno" → cantidad/2;',
  '"placas AON949 y VFY983" → transporte.placas en ese orden (la primera es la principal); "constancias 231800409 231800410" → transporte.constancias;',
  '"privado" / "público" → transporte.modo; "registrar vehículo" → transporte.registrar_vehiculos=true; "sin vehículo" → false; "placa ABC123" → transporte.placas;',
  '"chofer Juan Pérez DNI 12345678 licencia Q12345678" → transporte.conductores; "fecha 25/10/2026" → fecha (dd/mm/aaaa);',
  '"venta" / "compra" → motivo (y si cambia, intercambia partida.ruc/llegada.ruc según quién es el tercero); "partida …" / "llegada …" → dirección.',
  '"total" → deja todos los bienes como están; "200 de la línea 3" → esa línea con cantidad 200 (y las demás igual salvo que diga "solo").',
  'Si la persona da un dato que no entiendes o no cabe, no lo inventes: déjalo como estaba. No borres campos que no te pidieron cambiar.'
].join('\n');

function TGG_editar_(c, texto, pregunta) {
  var base = TGG_paraRobot_(c);
  var r = IA_llamar_({ proveedor: 'Gemini (Google)', clave: TGG_clave_(), maxTokens: 6000, sistema: TGG_SISTEMA_EDITAR_,
    texto: 'Borrador:\n' + base + (pregunta ? '\n\nLe preguntamos: ' + pregunta.q + '\nRespondió: ' + texto : '\n\nPedido de la persona: ' + texto) });
  if (pregunta) c.dudas = (c.dudas || []).filter(function (d) { return d.k !== pregunta.k; });   // ya contestó (aunque sea "total")
  if (!r || !Array.isArray(r.bienes) || !r.transporte) throw new Error('no entendí el cambio; escríbalo de otra forma.');
  ['motivo', 'contraparte', 'documento', 'bienes', 'peso_kg', 'partida', 'llegada', 'transporte', 'fecha'].forEach(function (k) { if (r[k] !== undefined) c[k] = r[k]; });
  c.peso_origen = /peso/i.test(texto) ? 'indicado por usted' : c.peso_origen;
  c.avisos = TGG_faltan_(c);
  c.estado = 'Propuesta';
  return c;
}

function TGG_faltan_(c) {
  var f = [];
  if (!c.empresa_ruc) f.push('Falta la empresa que emite la guía.');
  if (!(c.bienes || []).length) f.push('Faltan los bienes.');
  if (!(Number(c.peso_kg) > 0)) f.push('Falta el peso.');
  if (!c.partida || !c.partida.direccion) f.push('Falta el punto de partida.');
  if (!c.llegada || !c.llegada.direccion) f.push('Falta el punto de llegada.');
  var t = c.transporte || {};
  if (t.modo === 'publico' && !t.ruc) f.push('Falta el RUC del transportista.');
  if ((t.modo === 'privado' || t.registrar_vehiculos) && (!(t.placas || []).length || !(t.conductores || []).length)) f.push('Faltan la placa y el chofer (DNI y licencia).');
  return f;
}

/** Lo que falta o hay que aclarar, como preguntas: [{k, q}]. La primera se le hace a la persona. */
function TGG_preguntas_(c) {
  var t = c.transporte || {}, p = [];
  if (!c.empresa_ruc) p.push({ k: 'empresa', q: '¿Qué empresa del grupo emite la guía? (nombre o RUC)' });
  if (!(c.bienes || []).length) p.push({ k: 'bienes', q: '¿Qué bienes se trasladan? Escríbalos con cantidad y unidad (ej. "3050 paquetes de fideos").' });
  (c.dudas || []).forEach(function (d) { p.push(d); });
  if (!(Number(c.peso_kg) > 0)) p.push({ k: 'peso', q: '¿Cuál es el peso bruto total en kg?' });
  if (!c.partida || !c.partida.direccion) p.push({ k: 'partida', q: '¿Desde qué dirección o almacén sale la carga?' });
  if (!c.llegada || !c.llegada.direccion) p.push({ k: 'llegada', q: '¿A qué dirección o almacén llega?' });
  if (t.modo === 'publico' && !t.ruc) p.push({ k: 'ruc_trans', q: '¿Cuál es el RUC de la empresa de transporte?' });
  if ((t.modo === 'privado' || t.registrar_vehiculos) && !(t.placas || []).length) p.push({ k: 'placa', q: '¿Cuál es la placa del vehículo (y de la carreta, si tiene)?' });
  if ((t.modo === 'privado' || t.registrar_vehiculos) && (t.placas || []).length && !(t.conductores || []).length) p.push({ k: 'chofer', q: '¿Quién maneja? Nombre, DNI y licencia.' });
  return p.filter(function (x, i, a) { return a.map(function (y) { return y.k; }).indexOf(x.k) === i; });
}

/** Deja la conversación lista: si hay una pregunta, la próxima respuesta se aplica a la guía. */
function TGG_seguirConversacion_(clave, c) {
  var ses = TG_sesion_(clave), p = TGG_preguntas_(c)[0];
  ses.gre = c.id; ses.greT = Date.now();
  ses.esperando = p ? { tipo: 'gre', id: c.id, pregunta: p } : (ses.esperando && ses.esperando.tipo === 'gre' ? null : ses.esperando);
  TG_guardarSesion_(clave, ses);
}

// Datos de guía escritos sueltos mientras hay una guía abierta ("es privado", "peso 30000", "placa ABC123"…).
var TGG_DATO_RX_ = /(peso|kg|kilos?|toneladas?|privad[oa]|p[uú]blic[oa]|placa|chofer|conductor|dni|licencia|llegada|partida|almac[eé]n|fecha|l[ií]neas?|solo|mitad|total|cantidad|bultos|paquetes|vehículo|vehiculo|transportista|carreta|motivo|venta|compra|traslado)\b/i;

/** ¿Este texto es para la guía abierta? Devuelve {c, pregunta} o null. */
function TGG_paraGuia_(ss, clave, texto) {
  var ses = TG_sesion_(clave);
  if (!ses.gre || !ses.greT || Date.now() - ses.greT > 3 * 3600000 || !texto || texto.charAt(0) === '/') return null;
  if (/^\s*\/?gu[ií]a\b|\b(emit|emite|emita|genera|haz)\w*\b.*\bgu[ií]a\b/i.test(texto)) return null;   // pide OTRA guía o emitir
  if (!TGG_DATO_RX_.test(texto) && !(ses.esperando && ses.esperando.tipo === 'gre')) return null;
  var c = TGG_leer_(ss, ses.gre);
  if (!c || /Emitida|Descartada|Emitiendo/.test(c.estado || '')) return null;
  return { c: c, pregunta: ses.esperando && ses.esperando.tipo === 'gre' ? ses.esperando.pregunta : null };
}

/* ============================================================ texto de la propuesta */

function TGG_texto_(c, html) {
  var e = html ? TG_esc_ : String, b = function (s) { return html ? '<b>' + s + '</b>' : '*' + s + '*'; };
  var t = c.transporte || {}, L = [];
  L.push('🚚 ' + b('Guía de remisión · ' + e(c.motivo || '?')) + ' · caso ' + c.id);
  L.push('Emite: ' + e(c.empresa || c.empresa_ruc || '¿?') + (c.motivo === 'Compra' ? ' (compra a ' : ' (para ') + e((c.contraparte || {}).nombre || (c.contraparte || {}).ruc || '¿?') + ')');
  if (c.documento) L.push('Documento: ' + e(c.documento.tipo + ' ' + c.documento.numero));
  var bs = c.bienes || [];
  L.push('Bienes (' + bs.length + '):\n' + bs.slice(0, 25).map(function (x, i) { return '  ' + (i + 1) + ') ' + e(String(x.descripcion).slice(0, 50)) + ' · ' + x.cantidad + ' ' + x.unidad; }).join('\n') +
    (bs.length > 25 ? '\n  … y ' + (bs.length - 25) + ' más' : ''));
  if (c.bultos) L.push('Bultos: ' + TG_num_(c.bultos));
  L.push('Peso bruto: ' + (c.peso_kg ? TG_num_(c.peso_kg, 2) + ' kg' + (c.peso_origen ? ' (' + e(c.peso_origen) + ')' : '') : '¿?'));
  L.push('Partida: ' + e(((c.partida || {}).direccion || '¿?').slice(0, 90)));
  L.push('Llegada: ' + e(((c.llegada || {}).direccion || '¿?').slice(0, 90)));
  if (t.modo === 'publico') L.push('Transporte público: ' + e(t.nombre || '') + ' RUC ' + e(t.ruc || '¿?') + (t.mtc ? ' · MTC ' + e(t.mtc) : '') +
    (t.registrar_vehiculos ? ' · con vehículo y chofer (diga "sin vehículo" si los pone el transportista)' : ' · vehículo y chofer los pone el transportista en su guía'));
  else L.push('Transporte privado');
  if (t.modo === 'privado' || t.registrar_vehiculos) L.push('Vehículo principal: ' + e((t.placas || [])[0] || '¿?') +
    ((t.placas || []).length > 1 ? ' · Secundario(s): ' + e(t.placas.slice(1).join(', ')) : '') +
    ((t.constancias || []).length > 1 ? ' · Constancias MTC: ' + e(t.constancias.join(' / ')) : '') + '\nChofer: ' +
    e((t.conductores || []).map(function (x) { return (x.nombre || '') + ' lic. ' + (x.licencia || '¿?'); }).join(', ') || '¿?'));
  L.push('Fecha de traslado: ' + e(c.fecha || '¿?'));
  var otros = (c.avisos || []).filter(function (a) { return !/^(Falta|No encontré)/.test(a); });
  if (otros.length) L.push('⚠️ ' + e(otros.join(' ')));
  var preg = TGG_preguntas_(c);
  if (preg.length) L.push('\n❓ ' + b(e(preg[0].q)) + (preg.length > 1 ? ' (después le pregunto ' + (preg.length - 1) + ' cosa(s) más)' : ''));
  else L.push('\n' + b('¿Está todo bien?') + ' Toque ✅ Está bien y la lleno en SUNAT para que vea la vista previa (no se emite). ' +
    'Si quiere cambiar algo, toque ✏️ Modificar algo o escríbalo directo ("es privado", "peso 30000", "llegada Av. Mártires").');
  return L.join('\n');
}

/* ============================================================ GitHub */

function TGG_pedir_(ss, c, modo) {
  var cfg = TG_cfg_(ss);
  if (TGG_faltan_(c).length) throw new Error(TGG_faltan_(c).join(' '));
  c.estado = modo === 'emitir' ? 'Emitiendo' : 'Vista previa…';
  c.huella = TGG_huella_(c);
  TGG_guardar_(ss, c);
  TG_gh_(cfg, '/actions/workflows/' + TGG_WF_ + '/dispatches', 'post', { ref: cfg.rama, inputs: {
    ruc: c.empresa_ruc, caso: c.id, modo: modo, confirmar: modo === 'emitir' ? c.huella : '' } });
}

/** doPost ?canal=gh con accion gre_* (lo llama gre_robot.py). La corrida debe ser de gre-sunat.yml y estar en curso. */
function TGG_gh_(q) {
  var ss = TG_ss_(), cfg = TG_cfg_(ss), run = String(q.run || '').replace(/\D/g, '');
  if (!run || !TGC_runValido_(cfg, run, /(^|\/)gre-sunat\.ya?ml$/)) return { ok: false, error: 'Forbidden' };
  var c = TGG_leer_(ss, String(q.caso || ''));
  if (!c) return { ok: false, error: 'caso desconocido' };
  if (q.accion === 'gre_caso') return { ok: true, datos: TGG_paraRobot_(c) };
  var cache = CacheService.getScriptCache();
  if (q.accion === 'gre_vista') {
    c.estado = 'Vista previa lista';
    TGG_guardar_(ss, c);
    TGG_avisar_(c, '👁 Vista previa en SUNAT (no se emitió nada) · caso ' + c.id + '\nRevise la foto. Si está bien, toque ✅ Emitir.', q.imagen, true);
    return { ok: true };
  }
  if (q.accion === 'gre_fin') {
    if (q.cayo && cache.get('tgg_fin_' + run)) return { ok: true };   // ya avisó el robot
    cache.put('tgg_fin_' + run, '1', 21600);
    if (q.ok) {
      c.estado = 'Emitida'; c.gre = String(q.numero || '');
      if (q.pdf) {
        try {
          var f = IMP_carpeta_(ss).createFile(Utilities.newBlob(Utilities.base64Decode(q.pdf), 'application/pdf', 'GRE ' + c.gre + '.pdf'));
          c.pdf = f.getId();
        } catch (e) {}
      }
      TGG_guardar_(ss, c);
      TGG_avisar_(c, '✅ Guía de remisión emitida: ' + c.gre + '\n' + (c.empresa || '') + ' · ' + c.motivo + ' · caso ' + c.id, q.imagen, false);
    } else {
      c.estado = q.dudoso ? 'Revisar en SOL' : 'No emitida';
      TGG_guardar_(ss, c);
      TGG_avisar_(c, (q.dudoso ? '⚠️ ' : '⛔ ') + 'Guía caso ' + c.id + ': ' + String(q.texto || 'el robot falló') + (q.dudoso ? '' : '\nNo se emitió nada. Corríjalo y vuelva a pedir la vista previa.'), q.imagen, false);
    }
    return { ok: true };
  }
  return { ok: false, error: 'accion desconocida' };
}

/** Manda el aviso (y la foto) al chat que pidió la guía. */
function TGG_avisar_(c, texto, imagenB64, conEmitir) {
  var chat = String(c.chat || ''), blob = imagenB64 ? Utilities.newBlob(Utilities.base64Decode(imagenB64), 'image/jpeg', 'gre.jpg') : null;
  if (chat.indexOf('wa') === 0) {
    var extra = conEmitir ? '\n\nPara emitirla escriba: *emitir guía ' + c.id + '*' : '';
    try {
      if (blob) TGC_wa_({ tipo: 'imagen', numero: chat.slice(2), mime: 'image/jpeg', base64: imagenB64, texto: texto + extra });
      else TGC_wa_({ tipo: 'texto', numero: chat.slice(2), texto: texto + extra });
    } catch (e) { console.error('GRE aviso WhatsApp: ' + e.message); }
    if (c.pdf) try { TGC_wa_({ tipo: 'texto', numero: chat.slice(2), texto: '📄 PDF: ' + DriveApp.getFileById(c.pdf).getUrl() }); } catch (e) {}
    return;
  }
  var teclado = conEmitir ? [[{ text: '✅ Emitir', callback_data: 'k:' + TG_guardarBoton_({ t: 'gre', id: c.id }) + ':em' },
    { text: '✏️ Corregir', callback_data: 'k:' + TG_guardarBoton_({ t: 'gre', id: c.id }) + ':ed' }]] : null;
  if (blob) {
    var r = TG_llamar_('sendPhoto', { chat_id: chat, photo: blob, caption: TG_esc_(texto).slice(0, 1000), parse_mode: 'HTML', reply_markup: teclado ? JSON.stringify({ inline_keyboard: teclado }) : undefined });
    if (!r || !r.ok) TG_enviarArchivo_(chat, blob, TG_esc_(texto));
    if (teclado && (!r || !r.ok)) TG_enviar_(chat, '¿Emito la guía caso ' + c.id + '?', teclado);
  } else TG_enviar_(chat, TG_esc_(texto), teclado);
  if (c.pdf) try { TG_enviarArchivo_(chat, DriveApp.getFileById(c.pdf).getBlob(), '📄 GRE ' + TG_esc_(c.gre || '')); } catch (e) {}
}

/* ============================================================ crear caso */

function TGG_empresas_(ss) {
  var cfg = leerConfig_(ss), out = {};
  Object.keys(cfg.nombreEmpresa || {}).forEach(function (r) { out[String(r).replace(/\D/g, '')] = String(cfg.nombreEmpresa[r]); });
  return out;
}

/** Lee los archivos, arma el caso, aplica lo que la persona escribió y lo guarda. */
function TGG_crear_(ss, adjs, texto, chat) {
  var lecturas = [];
  adjs.slice(0, 6).forEach(function (a) { try { lecturas.push(TGG_leerUno_(a)); } catch (e) { lecturas.push(null); } });
  var c = TGG_armar_(lecturas, TGG_empresas_(ss), chat);
  var pedido = String(texto || '').replace(TGG_PIDE_RX_, '').replace(/\b(emite|emitir|emita|haz|hazme|genera|generar|sacar|saca|por favor|la|una|de|esta|este)\b/gi, '').trim();
  if (pedido.length > 3) { try { TGG_editar_(c, texto); } catch (e) { c.avisos.push('No pude aplicar "' + String(texto).slice(0, 60) + '": ' + e.message); } }
  TGG_guardar_(ss, c);
  return c;
}

/* ============================================================ Telegram */

/** Antes de la vista previa: ¿está bien o modifica algo? (✅ Emitir recién aparece con la foto de la vista previa). */
function TGG_botonesTG_(c) {
  var k = TG_guardarBoton_({ t: 'gre', id: c.id });
  if (TGG_preguntas_(c).length) return [[{ text: '✏️ Modificar algo', callback_data: 'k:' + k + ':ed' }, { text: '🗑 Descartar', callback_data: 'k:' + k + ':no' }]];
  return [[{ text: '✅ Está bien → ver vista previa', callback_data: 'k:' + k + ':vp' }],
    [{ text: '✏️ Modificar algo', callback_data: 'k:' + k + ':ed' }, { text: '🗑 Descartar', callback_data: 'k:' + k + ':no' }]];
}

function TGG_desdeAdjTG_(ctx, adjs, texto) {
  TG_accion_(ctx.chatId, 'typing');
  TG_enviar_(ctx.chatId, '🚚 Leyendo ' + adjs.length + ' archivo(s) para la guía de remisión…');
  var c;
  try { c = TGG_crear_(ctx.ss, adjs, texto, ctx.chatId); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ No pude armar la guía: ' + TG_esc_(e.message)); }
  TGG_seguirConversacion_(ctx.chatId, c);
  TG_enviar_(ctx.chatId, TGG_texto_(c, true), TGG_botonesTG_(c));
}

/** Texto que pide una guía ("emite la guía", "/guia", "guía con estas fotos"). true si lo atendió. */
function TGG_atajoTG_(ctx, texto) {
  var t = String(texto || ''), ses = TG_sesion_(ctx.chatId);
  var esp = ses.greEsp && Date.now() - ses.greEsp < 10 * 60000;
  // "listo" después de "emite guía" + fotos: se arma con lo que llegó desde entonces y lo que escribió al pedirla.
  if (esp && /^\s*(listo|ya|eso es todo|termin[eé]|arma(la)?)\s*[.!]*\s*$/i.test(t)) {
    var nuevos = (ses.adj || []).filter(function (a) { return (a.t || 0) >= ses.greEsp; });
    var pedido = ses.greTexto || 'guía';
    ses.greEsp = null; ses.greTexto = ''; TG_guardarSesion_(ctx.chatId, ses);
    if (!nuevos.length) { TG_enviar_(ctx.chatId, '🚚 No me llegaron archivos para la guía. Escriba de nuevo <i>emite guía</i> y mándelos.'); return true; }
    TGG_desdeAdjTG_(ctx, nuevos, pedido);
    return true;
  }
  if (!(/^\/?gu[ií]a\b/i.test(t) || (TGG_PIDE_RX_.test(t) && /\b(emit|hac|haz|gener|sac|arm|crea|necesit|quiero)/i.test(t)))) return false;
  var m = t.match(/\b([0-9a-f]{8})\b/);
  var id = (m && m[1]) || (/^\/?emitir\b/i.test(t) && ses.gre);
  if (id && TGG_leer_(ctx.ss, id)) { TGG_alBotonTG_(ctx, { id: id }, /emit/i.test(t) ? 'em' : 'ver'); return true; }
  // Archivos recién mandados (últimos 15 min): se arma ya. Si no, se espera a que los mande y escriba "listo".
  var adjs = (ses.adj || []).filter(function (a) { return a.t && Date.now() - a.t < 15 * 60000; }).slice(-6);
  if (!adjs.length) {
    ses.greEsp = Date.now(); ses.greTexto = t; TG_guardarSesion_(ctx.chatId, ses);
    TG_enviar_(ctx.chatId, '🚚 <b>Guía de remisión por SUNAT</b>\nMande (o reenvíe) ahora la factura, el ticket y la tarjeta del transportista, y al final escriba <b>listo</b>. ' +
      'Nada se emite sin su ✅.');
    return true;
  }
  TGG_desdeAdjTG_(ctx, adjs, t);
  return true;
}

function TGG_alBotonTG_(ctx, datos, op) {
  var c = TGG_leer_(ctx.ss, datos.id);
  if (!c) return TG_enviar_(ctx.chatId, 'No encontré ese caso de guía.');
  if (op === 'ver') return TG_enviar_(ctx.chatId, TGG_texto_(c, true), TGG_botonesTG_(c));
  if (op === 'no') { c.estado = 'Descartada'; TGG_guardar_(ctx.ss, c); return TG_editarOEnviar_(ctx, '🗑 Guía caso ' + c.id + ' descartada. No se emitió nada.', null); }
  if (op === 'ed') {
    var ses = TG_sesion_(ctx.chatId); ses.esperando = { tipo: 'gre', id: c.id }; ses.gre = c.id; ses.greT = Date.now(); TG_guardarSesion_(ctx.chatId, ses);
    return TG_enviar_(ctx.chatId, '✏️ Escríbame (o díctelo 🎤) qué cambio en la guía caso ' + c.id + '.');
  }
  if (op === 'em') {
    if (c.estado === 'Emitida') return TG_enviar_(ctx.chatId, 'Esa guía ya se emitió: ' + TG_esc_(c.gre));
    var f = TGG_faltan_(c);
    if (f.length) return TG_enviar_(ctx.chatId, '⚠️ Antes de emitir: ' + TG_esc_(f.join(' ')), TGG_botonesTG_(c));
    var k = TG_guardarBoton_({ t: 'gre', id: c.id, huella: TGG_huella_(c) });
    return TG_enviar_(ctx.chatId, '⚠️ <b>¿Emito esta guía en SUNAT?</b>\n' + TGG_texto_(c, true).split('\n').slice(0, -1).join('\n') +
      '\n\nEs una operación real ante SUNAT.' + (c.estado !== 'Vista previa lista' ? ' <i>Aún no vio la vista previa.</i>' : ''),
      [[{ text: '✅ Sí, emitir', callback_data: 'k:' + k + ':ok' }, { text: '✖ No', callback_data: 'k:' + k + ':x' }]]);
  }
  if (op === 'x') return TG_editarOEnviar_(ctx, '✖ No se emitió nada.', null);
  if (op === 'ok' && (!ctx.usuario || ctx.usuario.rol !== 'admin')) return TG_enviar_(ctx.chatId, 'Solo un administrador puede emitir guías.');
  if (op === 'ok' && datos.huella && datos.huella !== TGG_huella_(c)) return TG_enviar_(ctx.chatId, '⚠️ La guía cambió después de pedir confirmar. Revísela y vuelva a tocar ✅ Emitir.', TGG_botonesTG_(c));
  if (op === 'ok' || op === 'vp') {
    var modo = op === 'ok' ? 'emitir' : 'vista';
    if (TG_yaVisto_('gre' + modo + c.id + TGG_huella_(c))) return TG_enviar_(ctx.chatId, 'Eso ya se pidió.');
    if (op === 'ok') TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
    try { c.chat = ctx.chatId; TGG_pedir_(ctx.ss, c, modo); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
    return TG_enviar_(ctx.chatId, (modo === 'emitir' ? '🚚 <b>Emitiendo</b> la guía en SUNAT' : '👁 <b>Preparando la vista previa</b> en SUNAT (no se emite)') +
      ' · caso ' + c.id + '\nTarda 2–4 minutos; le mando aquí la foto o el resultado.');
  }
}

/** Respuesta a ✏️ Corregir. */
function TGG_editarTG_(ctx, id, texto, pregunta) {
  var c = TGG_leer_(ctx.ss, id);
  if (!c) return TG_enviar_(ctx.chatId, 'No encontré ese caso de guía.');
  TG_accion_(ctx.chatId, 'typing');
  try { TGG_editar_(c, texto, pregunta); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message), TGG_botonesTG_(c)); }
  TGG_guardar_(ctx.ss, c);
  TGG_seguirConversacion_(ctx.chatId, c);
  TG_enviar_(ctx.chatId, TGG_texto_(c, true), TGG_botonesTG_(c));
}

/** Telegram: texto suelto con datos de la guía abierta (o la respuesta a su pregunta). true si lo tomó. */
function TGG_datoTG_(ctx, texto) {
  var x = TGG_paraGuia_(ctx.ss, ctx.chatId, texto);
  if (!x) return false;
  TGG_editarTG_(ctx, x.c.id, texto, x.pregunta);
  return true;
}

/* ============================================================ WhatsApp */

function TGG_respWA_(texto, c) {
  var r = { ok: true, respuesta: texto, tablas: [], sugerencias: [], archivos: [], avisos: [] };
  if (c) r.botones = [{ k: TG_guardarBoton_({ t: 'gre', id: c.id }), texto: TGG_preguntas_(c).length ? 'Responda la pregunta o:' : '¿Está todo bien?',
    opciones: TGG_preguntas_(c).length ? [{ op: 'ed', titulo: '✏️ Modificar algo' }, { op: 'no', titulo: '🗑 Descartar' }]
      : [{ op: 'vp', titulo: '✅ Está bien' }, { op: 'ed', titulo: '✏️ Modificar algo' }, { op: 'no', titulo: '🗑 Descartar' }] }];
  return r;
}

/** WhatsApp: corrección pendiente, "guía" con fotos, "emitir guía <caso>". null si no es de guías. */
function TGG_atajoWA_(ss, q, clave) {
  var texto = String(q.texto || '').trim(), ses = TG_sesion_(clave);
  var dato = !(q.adjuntos || []).length && TGG_paraGuia_(ss, clave, texto);   // respuesta a su pregunta o dato suelto
  if (dato && !/^\s*(emitir|emite)\b/i.test(texto)) {
    var c0 = dato.c;
    try { TGG_editar_(c0, texto, dato.pregunta); } catch (e) { return TGG_respWA_('⚠️ ' + e.message, c0); }
    TGG_guardar_(ss, c0);
    TGG_seguirConversacion_(clave, c0);
    return TGG_respWA_(TGG_texto_(c0, false), c0);
  }
  if (!(/^\/?gu[ií]a\b/i.test(texto) || (TGG_PIDE_RX_.test(texto) && /\b(emit|hac|haz|gener|sac|arm|necesit|quiero)/i.test(texto)))) return null;
  var m = texto.match(/\b([0-9a-f]{8})\b/), id = (m && m[1]) || (/^\/?emitir\b/i.test(texto) && ses.gre);
  if (id && TGG_leer_(ss, id)) return TGG_botonWA_({ id: id }, null, /emit/i.test(texto) ? 'em' : 'ver', clave.slice(2));
  var adjs = (q.adjuntos || []).length ? q.adjuntos : (ses.adj || []).slice(-4);
  if (!adjs.length) return TGG_respWA_('🚚 *Guía de remisión por SUNAT*\nMándeme las fotos o PDF (factura, ticket de despacho/balanza, tarjeta del transportista) con el texto *guía*. ' +
    'Puede agregar: "peso 30258.5", "solo líneas 1 a 5", "compra". Yo armo la propuesta y nada se emite sin su confirmación.');
  var c;
  try { c = TGG_crear_(ss, adjs, texto, clave); } catch (e) { return { ok: false, error: 'No pude armar la guía: ' + e.message }; }
  TGG_seguirConversacion_(clave, c);
  return TGG_respWA_(TGG_texto_(c, false), c);
}

function TGG_botonWA_(acc, k, op, numero) {
  var ss = TG_ss_(), clave = 'wa' + String(numero || '').replace(/\D/g, ''), c = TGG_leer_(ss, acc.id);
  if (!c) return TGG_respWA_('No encontré ese caso de guía.');
  if (op === 'ver') return TGG_respWA_(TGG_texto_(c, false), c);
  if (op === 'ed') {
    var ses = TG_sesion_(clave); ses.esperando = { tipo: 'gre', id: c.id }; ses.gre = c.id; ses.greT = Date.now(); TG_guardarSesion_(clave, ses);
    return TGG_respWA_('✏️ Escríbame qué cambio en la guía caso ' + c.id + ' (ej. "peso 30258.5", "solo líneas 1 a 5", "registrar vehículo").');
  }
  if (op === 'x') return TGG_respWA_('✖ No se emitió nada.');
  if (op === 'no') { c.estado = 'Descartada'; TGG_guardar_(ss, c); return TGG_respWA_('🗑 Guía caso ' + c.id + ' descartada. No se emitió nada.'); }
  if (op === 'em') {
    if (c.estado === 'Emitida') return TGG_respWA_('Esa guía ya se emitió: ' + c.gre);
    var f = TGG_faltan_(c);
    if (f.length) return TGG_respWA_('⚠️ Antes de emitir: ' + f.join(' '), c);
    var kk = TG_guardarBoton_({ t: 'gre', id: c.id, huella: TGG_huella_(c) });
    var r = TGG_respWA_('⚠️ *¿Emito esta guía en SUNAT?*\n' + TGG_texto_(c, false).split('\n').slice(0, -1).join('\n') + '\n\nEs una operación real ante SUNAT.' +
      (c.estado !== 'Vista previa lista' ? ' Aún no vio la vista previa.' : ''));
    r.botones = [{ k: kk, texto: '¿Emitir?', opciones: [{ op: 'ok', titulo: '✅ Sí, emitir' }, { op: 'x', titulo: '✖ No' }] }];
    return r;
  }
  if (op === 'ok') {
    var permitidos = (PropertiesService.getScriptProperties().getProperty(TGR_PROP_WA_) || '').split(',');
    if (permitidos.indexOf(clave.slice(2)) < 0) return TGG_respWA_('Este número no está autorizado para emitir. Un administrador lo autoriza en Telegram con /emitirwa ' + clave.slice(2) + '. La 👁 vista previa sí la puede pedir.');
    if (acc.huella && acc.huella !== TGG_huella_(c)) return TGG_respWA_('⚠️ La guía cambió después de pedir confirmar. Revísela y vuelva a pedir ✅ Emitir.', c);
  }
  if (op !== 'ok' && op !== 'vp') return TGG_respWA_('No entendí ese botón.');
  var modo = op === 'ok' ? 'emitir' : 'vista';
  if (TG_yaVisto_('gre' + modo + c.id + TGG_huella_(c))) return TGG_respWA_('Eso ya se pidió.');
  try { c.chat = clave; TGG_pedir_(ss, c, modo); } catch (e) { return TGG_respWA_('⚠️ ' + e.message, c); }
  return TGG_respWA_((modo === 'emitir' ? '🚚 *Emitiendo* la guía en SUNAT' : '👁 *Preparando la vista previa* en SUNAT (no se emite)') +
    ' · caso ' + c.id + '\nTarda 2–4 minutos; le mando aquí la foto o el resultado.');
}
