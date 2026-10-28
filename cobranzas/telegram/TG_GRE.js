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
var TGG_WF_QUESITO_ = 'gre-quesito.yml';   // 🧀 la misma guía, emitida en Quesito.pe desde su factura (guias/scripts/quesito_gre.py)

/** Dónde se emite: 'quesito' si la persona lo pidió ("en quesito"), si no SUNAT SOL. */
function TGG_donde_(c) { return c && c.via === 'quesito' ? 'Quesito' : 'SUNAT'; }

/** El último mensaje que dice dónde emitir manda: "en quesito" / "por sunat" (o "en sol"). */
function TGG_via_(c) {
  var m = c.mensajes || [];
  for (var i = m.length - 1; i >= 0; i--) {
    if (/quesito/i.test(m[i])) return 'quesito';
    if (/\b(en|por|a|desde|con)\s+(la\s+)?(sunat|sol)\b/i.test(m[i])) return '';
  }
  return c.via || '';
}
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
  var o = { id: c.id, empresa_ruc: c.empresa_ruc, motivo: c.motivo, contraparte: c.contraparte, documento: c.documento,
    bienes: c.bienes, peso_kg: c.peso_kg, bultos: c.bultos || null, partida: c.partida, llegada: c.llegada, transporte: c.transporte, fecha: c.fecha, via: c.via || '',
    todo_factura: !!c.todo_factura, observaciones: c.observaciones || '' };
  if (c.cotizacion) o.cotizacion = String(c.cotizacion);   // 🧀 Quesito: la factura se busca desde la cotización
  if (c.pedido) o.pedido = String(c.pedido);               // 🧀 "M&D 325 lote 1507: 10000; barra 5000" o "total"
  return JSON.stringify(o);
}

function TGG_huella_(c) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, TGG_paraRobot_(c), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 10);
}

/* ============================================================ IA: analiza TODO junto */

// Un modelo que lee bien fotos y PDF; si no responde, el liviano.
var TGG_MODELOS_ = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];

var TGG_SISTEMA_ = [
  'Eres el asistente que prepara Guías de Remisión Electrónica Remitente (SUNAT, Perú) para un grupo de empresas.',
  'Recibes TODOS los archivos (facturas, tickets de despacho o balanza, tarjetas del transportista, fotos), TODOS los mensajes de la persona',
  '(texto o notas de voz transcritas) y el borrador actual. Devuelve SOLO un JSON con la guía completa y corregida:',
  '{"no_es_para_la_guia": false, "entendido": "1 frase de lo que tomaste o cambiaste",',
  ' "motivo": "Compra|Venta|Traslado entre establecimientos de la misma empresa|Devolución|Consignación|Otros",',
  ' "empresa_ruc": "RUC de la empresa del grupo que emite", "contraparte": {"ruc","nombre"},',
  ' "documento": {"tipo":"Factura|Boleta de Venta","numero":"F251-00056475","ruc_emisor"} o null,',
  ' "bienes": [{"descripcion","unidad":"código SUNAT","cantidad":número}], "peso_kg": número, "bultos": número o null,',
  ' "partida": {"ruc":"RUC del dueño del local o vacío","direccion"}, "llegada": {"ruc","direccion"},',
  ' "transporte": {"modo":"publico|privado","ruc","nombre","mtc","constancias":["15M25007676E","231800410"],"registrar_vehiculos":true,',
  '   "placas":["AON949","VFY983"],"conductores":[{"nombre","dni","licencia"}],"sin_mtc":false},',
  ' "fecha": "dd/mm/aaaa", "preguntas": ["solo lo que de verdad falta"]}',
  'REGLAS:',
  '1. Lee TODO antes de decidir. Lo que la persona escribe manda sobre los documentos. Si dice "está en la imagen", "ya te dije", "revisa bien",',
  '   vuelve a buscar en TODOS los archivos y mensajes y úsalo. Nunca vuelvas a preguntar algo que está en un archivo o en un mensaje.',
  '2. "preguntas": máximo 2, cortas y concretas, SOLO si el dato no está en ningún lado o hay una contradicción real. Si todo está, [].',
  '3. Compra: la factura es PARA una empresa del grupo → empresa_ruc = comprador, contraparte = proveedor. Venta: la emite el grupo.',
  '4. Compra: partida = almacén del PROVEEDOR desde donde SALE la carga (el ticket de despacho dice el centro, ej. "C.D. TACNA"; si la',
  '   factura trae varias direcciones del proveedor, usa la de esa ciudad, NO la oficina principal); partida.ruc = RUC del proveedor.',
  '   llegada = dirección del comprador o la que diga la persona (ej. "Av. Mártires"); llegada.ruc = "". En Venta al revés.',
  '4b. Direcciones de partida y llegada: si sabes el distrito, provincia y departamento, termínalas así: "… - DISTRITO - PROVINCIA - DEPARTAMENTO".',
  '5. Bienes: las líneas de la factura, en su orden, con unidad SUNAT y cantidad. Si la persona pide una parte ("solo líneas 1 a 5",',
  '   "la mitad", "200 de la línea 3") aplícalo; "total" o nada = todas. Si el ticket coincide con la factura, es el total: no preguntes.',
  '6. peso_kg = peso bruto total (TOTAL GENERAL del ticket/balanza en kg) o el que diga la persona. bultos = total de paquetes/unidades del ticket.',
  '7. Tarjeta del transportista → público: RUC, razón social, TODAS las constancias/registros MTC (COPIA EXACTA, con sus letras: "15M25007676E", nunca solo los dígitos), placas EN ORDEN (primero el tracto o',
  '   principal, luego la carreta; si una placa está tachada y corregida a mano, usa la corregida; las placas peruanas tienen 3 caracteres +',
  '   3 números y el 2.º carácter puede ser letra o NÚMERO, ej. A0N949 con cero, F1A123: copia cero/O tal como se ve; si la persona',
  '   escribe la placa, usa EXACTAMENTE la suya), y el chofer con su licencia (letra + 8 dígitos, ej. D00516821). Si no aparece el DNI, el DNI son esos 8 dígitos.',
  '   registrar_vehiculos = true si hay placas y chofer, salvo que la persona diga "sin vehículo". Sin transportista y con placas → privado.',
  '8. fecha: la que diga la persona; si no, la de hoy.',
  '9. Si el ÚLTIMO mensaje no tiene que ver con la guía (otra consulta), responde {"no_es_para_la_guia": true} y nada más.',
  '10. No inventes datos. Nunca incluyas teléfonos ni correos.',
  '11. Si el robot falló en SUNAT (te lo digo abajo), la persona puede responder cómo seguir: "deja el MTC vacío" → transporte.sin_mtc = true;',
  '   "el local 7", "usa la dirección X" → ese dato. Entiende lo que quiere decir aunque esté mal escrito y aplícalo; no preguntes de nuevo.',
  'Unidades SUNAT: NIU unidad, PK paquete (PQT), BX caja, BG bolsa, SA saco, KGM kilogramo, TNE tonelada, LTR litro, GLL galón, DZN docena,',
  ' CT cartones, DR tambor, BJ balde, BO botellas, CA latas, MLL millar, SET juego, PR par, ZZ otros.'
].join('\n');

function TGG_clave_() {
  var k = PropertiesService.getScriptProperties().getProperty('CIA_KEY_GEMINIGOOGLE') || IA_clave_('Gemini (Google)');
  if (!k) throw new Error('falta la clave de Gemini (pestaña 🧠 Asistente IA → 🔑).');
  return k;
}

/** Una sola llamada con el texto y TODOS los archivos (fotos y PDF). */
function TGG_gemini_(texto, archivos, sistema) {
  var partes = [{ text: texto }];
  (archivos || []).slice(0, 10).forEach(function (a, i) {
    try {
      var x = ANX_blob_(a), mime = x.mime || x.blob.getContentType();
      if (!/^image\/|pdf|^audio\//i.test(mime)) return;
      partes.push({ text: (/^audio\//i.test(mime) ? 'Nota de voz de la persona (escúchala: es un mensaje más) ' : 'Archivo ') + (i + 1) + ' (' + (x.nombre || 'sin nombre') + '):' });
      partes.push({ inline_data: { mime_type: /pdf/i.test(mime) ? 'application/pdf' : /^audio\//i.test(mime) ? 'audio/ogg' : mime, data: Utilities.base64Encode(x.blob.getBytes()) } });
    } catch (e) { partes.push({ text: 'Archivo ' + (i + 1) + ': no se pudo abrir.' }); }
  });
  var clave = TGG_clave_(), ultimo = '';
  for (var i = 0; i < TGG_MODELOS_.length; i++) {
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + TGG_MODELOS_[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': clave },
      payload: JSON.stringify({ systemInstruction: { parts: [{ text: sistema || TGG_SISTEMA_ }] }, contents: [{ role: 'user', parts: partes }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 16000, responseMimeType: 'application/json' } }) });
    if (r.getResponseCode() === 200) {
      var cand = (JSON.parse(r.getContentText()).candidates || [])[0];
      var t = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
      if (t) return IA_extraerJson_(t);
    }
    ultimo = r.getResponseCode() + ' ' + r.getContentText().slice(0, 150);
  }
  throw new Error('la IA no respondió (' + ultimo + '). Intente de nuevo en un momento.');
}

/** Vuelve a analizar el caso con TODO (archivos + mensajes + borrador). false si el último mensaje no era para la guía. */
function TGG_analizar_(ss, c) {
  var empresas = TGG_empresas_(ss);
  var txt = 'Hoy: ' + Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy') + '\nEmpresas del grupo (RUC → nombre): ' +
    Object.keys(empresas).map(function (r) { return r + ' → ' + empresas[r]; }).join('; ') +
    '\n\nMensajes de la persona, en orden:\n' + ((c.mensajes || []).map(function (m, i) { return (i + 1) + ') ' + m; }).join('\n') || '(ninguno)') +
    (c.bienes ? '\n\nBorrador actual (corrígelo con lo que dicen los archivos y los mensajes):\n' + TGG_paraRobot_(c) : '') +
    (c.ultimo_error ? '\n\nEl último intento del robot en SUNAT falló: ' + c.ultimo_error : '') +
    (c.opciones ? '\n\nSUNAT no encontró el punto de ' + c.opciones.cual + ' y mostró estos locales del RUC ' + ((c[c.opciones.cual] || {}).ruc || '') +
      ' (si la persona elige uno, pon en ' + c.opciones.cual + '.direccion ese domicilio tal cual):\n' +
      c.opciones.lista.map(function (o, i) { return (i + 1) + ') ' + o.fila; }).join('\n') : '') +
    '\n\nArchivos adjuntos: ' + (c.archivos || []).length + '.';
  var r = TGG_gemini_(txt, c.archivos), antes = { partida: c.partida, llegada: c.llegada };
  if (r.no_es_para_la_guia && c.bienes) return false;
  // 🔒 Con un borrador ya armado y sin archivos nuevos, un cambio pedido por mensaje solo toca lo que ese mensaje nombra
  // (si no, la IA "relee" los documentos y cambia, por ejemplo, la dirección de llegada sin que nadie lo pida).
  var fijo = {}, nArch = (c.archivos || []).length;
  if (c.bienes && (c.n_archivos == null ? nArch : Number(c.n_archivos)) >= nArch && !c.ultimo_error && !c.opciones) {
    var ult = String((c.mensajes || []).slice(-1)[0] || '');
    var temas = { partida: /partida|origen|sale|salida|direcci|almac|local|punto|parque/i, llegada: /llegada|destino|entrega|llega|direcci|almac|local|punto/i,
      peso_kg: /peso|kg|kilo|tonelad/i, bultos: /bulto|paquete|caja|saco/i, fecha: /fecha|hoy|mañana|ma[nñ]ana|d[ií]a|\d{1,2}\/\d{1,2}/i,
      documento: /factura|boleta|document|comprobante|\b[FBE][A-Z0-9]{3}\s*-?\s*\d/i, motivo: /motivo|venta|compra|traslado|devoluci|consignaci/i,
      contraparte: /cliente|proveedor|ruc|destinatario|remitente|compra a|vende/i,
      bienes: /bien|producto|l[ií]nea|cantidad|unidad|[ií]tem|\d+\s*(pk|und|unid|kg|cajas?|bolsas?|sacos?)\b|todo|solo|quita|agrega/i,
      transporte: /placa|chofer|conductor|licencia|mtc|constancia|certificado|transport|veh[ií]culo|privado|p[uú]blico|ruc|carreta|tracto/i };
    Object.keys(temas).forEach(function (k) { if (!temas[k].test(ult)) fijo[k] = true; });
  }
  ['motivo', 'contraparte', 'documento', 'bienes', 'peso_kg', 'bultos', 'partida', 'llegada', 'transporte', 'fecha'].forEach(function (k) {
    if (r[k] !== undefined && !fijo[k]) c[k] = r[k]; });
  c.n_archivos = nArch;
  var dig = function (x) { return String(x || '').replace(/\D/g, ''); };
  c.empresa_ruc = dig(r.empresa_ruc || c.empresa_ruc);
  if (!empresas[c.empresa_ruc]) c.empresa_ruc = '';
  c.empresa = empresas[c.empresa_ruc] || '';
  c.contraparte = { ruc: dig((c.contraparte || {}).ruc), nombre: String((c.contraparte || {}).nombre || '') };
  if (c.documento && !c.documento.numero) c.documento = null;
  c.bienes = (c.bienes || []).filter(function (b) { return b && b.descripcion; }).map(function (b) {
    return { descripcion: String(b.descripcion).trim().slice(0, 250), unidad: String(b.unidad || 'NIU').toUpperCase(), cantidad: Number(b.cantidad) || 1 };
  });
  c.peso_kg = Number(c.peso_kg) || null;
  c.bultos = Number(c.bultos) || null;
  ['partida', 'llegada'].forEach(function (k) {
    var p = c[k] || {}, o = antes[k] || {}, dir = String(p.direccion || '');
    c[k] = { ruc: dig(p.ruc), direccion: dir };
    var elegido = c.opciones && c.opciones.cual === k && c.opciones.lista.filter(function (x) { return x.direccion === dir; })[0];
    if (elegido) c[k].fila = elegido.fila; else if (o.fila && o.direccion === dir) c[k].fila = o.fila;
  });
  var t = c.transporte || {};
  t.ruc = dig(t.ruc);
  t.modo = /priv/i.test(t.modo || '') || !t.ruc ? 'privado' : 'publico';
  t.placas = (t.placas || []).map(function (x) { return String(x).toUpperCase().replace(/[^A-Z0-9]/g, ''); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  // La placa que escribió la persona manda tal cual (O y 0 se confunden fácil: A0N949 ≠ AON949).
  (c.mensajes || []).join(' ').toUpperCase().replace(/[^A-Z0-9\s]/g, '').split(/\s+/).forEach(function (w) {
    if (!/^[A-Z][A-Z0-9]{2}\d{3}$/.test(w)) return;
    var igual = function (x) { return x.replace(/0/g, 'O') === w.replace(/0/g, 'O'); };
    t.placas = t.placas.map(function (x) { return igual(x) ? w : x; });
  });
  // Constancias / certificados MTC tal cual, con sus letras (15M25007676E ≠ 1525007676): solo se quitan espacios y guiones.
  var alfa = function (x) { return String(x == null ? '' : x).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  t.constancias = (t.constancias || []).map(alfa).filter(function (x, i, a) { return x.length >= 5 && a.indexOf(x) === i; });
  t.mtc = alfa(t.mtc || t.constancias[0] || '');
  t.sin_mtc = t.sin_mtc === true;
  t.conductores = (t.conductores || []).filter(function (x) { return x && (x.dni || x.licencia); }).map(function (x) {
    var lic = String(x.licencia || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return { dni: dig(x.dni) || dig(lic).slice(-8), licencia: lic, nombre: String(x.nombre || '') };
  });
  t.registrar_vehiculos = t.modo === 'privado' || t.registrar_vehiculos !== false && !!(t.placas.length && t.conductores.length);
  c.transporte = t;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(c.fecha || '')) c.fecha = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy');
  c.preguntas_ia = (r.preguntas || []).map(String).filter(function (x) { return x.trim(); }).slice(0, 2);
  c.entendido = String(r.entendido || '').slice(0, 300);
  c.via = TGG_via_(c);
  c.estado = 'Propuesta';
  return true;
}

/** Suma un mensaje de la persona (o su respuesta a la pregunta) y vuelve a analizar. false si no era para la guía. */
function TGG_editar_(ss, c, texto, pregunta) {
  if (c.espera_run) c.decision = 'cerrar';   // cambió algo: la vista previa abierta se cierra sin emitir
  var op = c.opciones, n = op && String(texto).match(/^\s*(?:(?:el|la|n[uú]mero|nro\.?|n°|#|opci[oó]n|seleccion[eao]?|elij[oa]|escoj[oa]|us[ae]|marc[ao]|marque|pon(?:ga)?|es|local|establecimiento|de|del)\s*)*(\d{1,2})\s*[).]?\s*$/i), antes = op && JSON.stringify(c[op.cual] || {});
  if (n && op.lista[Number(n[1]) - 1]) {   // "7", "el 7", "seleccione el 7": el local de la lista que mostró SUNAT
    var o = op.lista[Number(n[1]) - 1];
    c.mensajes = (c.mensajes || []).concat(['Para ' + op.cual + ' elegí el local ' + n[1] + ') ' + o.fila]).slice(-25);
    c[op.cual] = { ruc: (c[op.cual] || {}).ruc || '', direccion: o.direccion, fila: o.fila };
    c.opciones = null; c.relanzar = true; c.estado = 'Propuesta'; c.ultimo_error = '';
    return true;
  }
  c.mensajes = (c.mensajes || []).concat([(pregunta ? 'Respondiendo a «' + pregunta.q + '»: ' : '') + String(texto).slice(0, 1500)]).slice(-25);
  var fallo = (c.estado === 'No emitida' && c.ultimo_error) || c.estado === 'Vista previa lista';   // tras un fallo o una vista previa: sigue solo
  var ok = TGG_analizar_(ss, c);
  if (!ok) { c.mensajes.pop(); return ok; }
  if (op && JSON.stringify(c[op.cual] || {}) !== antes) c.opciones = null;
  if (fallo && !TGG_preguntas_(c).length) { c.relanzar = true; c.ultimo_error = ''; }   // respondió al fallo del robot: sigue solo
  return ok;
}

/** Tras una respuesta a lo que pidió SUNAT, vuelve a pedir la vista previa sola. Devuelve el aviso ('' si no). */
function TGG_relanzar_(ss, c, chat) {
  if (!c.relanzar) return '';
  c.relanzar = false;
  try { c.chat = chat; TGG_pedir_(ss, c, 'vista'); } catch (e) { TGG_guardar_(ss, c); return '\n\n⚠️ ' + e.message; }
  return '\n\n👁 Con eso vuelvo a preparar la vista previa en ' + TGG_donde_(c) + ' (no se emite). Tarda 2–4 minutos.';
}

function TGG_faltan_(c) {
  var f = [];
  if (!c.empresa_ruc) f.push('Falta la empresa que emite la guía.');
  if (!(c.bienes || []).length && !(c.via === 'quesito' && (c.todo_factura || c.pedido))) f.push('Faltan los bienes.');   // en Quesito "todo lo de la factura" (o un pedido corto) no necesita la lista
  if (!(Number(c.peso_kg) > 0)) f.push('Falta el peso.');
  if (!c.partida || !c.partida.direccion) f.push('Falta el punto de partida.');
  if (!c.llegada || !c.llegada.direccion) f.push('Falta el punto de llegada.');
  var t = c.transporte || {};
  if (t.modo === 'publico' && !t.ruc) f.push('Falta el RUC del transportista.');
  if ((t.modo === 'privado' || t.registrar_vehiculos) && (!(t.placas || []).length || !(t.conductores || []).length)) f.push('Faltan la placa y el chofer (DNI y licencia).');
  if (c.via === 'quesito') {   // 🧀 en Quesito la guía sale desde la factura que la empresa emitió ahí
    if (c.motivo !== 'Venta') f.push('En Quesito, por ahora, solo guías de venta desde su factura (escriba «por sunat» para las demás).');
    if ((!c.documento || !/^[A-Z0-9]{4}\s*-\s*\d+$/i.test(String(c.documento.numero || ''))) && !/\d/.test(String(c.cotizacion || ''))) f.push('Para Quesito falta el número de la factura.');
    if (!(Number(c.bultos) >= 1)) f.push('Faltan los bultos (Quesito los pide).');
  }
  return f;
}

/** Lo que hay que preguntar: lo que la IA no encontró en ningún lado; si no dijo nada pero falta un dato obligatorio, ese. */
function TGG_preguntas_(c) {
  if ((c.preguntas_ia || []).length) return c.preguntas_ia.map(function (q, i) { return { k: 'ia' + i, q: q }; });
  var mapa = { 'Falta la empresa que emite la guía.': '¿Qué empresa del grupo emite la guía?', 'Faltan los bienes.': '¿Qué bienes se trasladan (con cantidad)?',
    'Falta el peso.': '¿Cuál es el peso bruto total en kg?', 'Falta el punto de partida.': '¿Desde qué dirección o almacén sale la carga?',
    'Falta el punto de llegada.': '¿A qué dirección o almacén llega?', 'Falta el RUC del transportista.': '¿Cuál es el RUC de la empresa de transporte?',
    'Faltan la placa y el chofer (DNI y licencia).': '¿Placa(s) del vehículo y chofer (nombre, DNI y licencia)?',
    'Para Quesito falta el número de la factura.': '¿De qué factura de Quesito sale la guía (ej. FQQ1-3648)?', 'Faltan los bultos (Quesito los pide).': '¿Cuántos bultos son?' };
  return TGG_faltan_(c).map(function (f, i) { return { k: 'f' + i, q: mapa[f] || f }; });
}

/** Deja la conversación lista: lo que escriba después (o responda) va a esta guía. */
function TGG_seguirConversacion_(clave, c) {
  var ses = TG_sesion_(clave), p = TGG_preguntas_(c)[0];
  ses.gre = c.id; ses.greT = Date.now();
  ses.esperando = p ? { tipo: 'gre', id: c.id, pregunta: p } : (ses.esperando && ses.esperando.tipo === 'gre' ? null : ses.esperando);
  TG_guardarSesion_(clave, ses);
}

// Pasada la hora de la última respuesta, solo se toman como datos de la guía los textos que lo parecen.
var TGG_DATO_RX_ = /(peso|kg|kilos?|toneladas?|privad[oa]|p[uú]blic[oa]|placa|chofer|conductor|dni|licencia|llegada|partida|almac[eé]n|fecha|l[ií]neas?|solo|mitad|total|cantidad|bultos|paquetes|veh[ií]culo|transportista|carreta|motivo|venta|compra|traslado|imagen|foto|pdf|adjunt)/i;

/** ¿Este texto es para la guía abierta? {c, pregunta} o null. */
function TGG_paraGuia_(ss, clave, texto) {
  var ses = TG_sesion_(clave);
  if (!ses.gre || !ses.greT || !texto || texto.charAt(0) === '/') return null;
  var edad = Date.now() - ses.greT;
  if (edad > 3 * 3600000 || (edad > 3600000 && !TGG_DATO_RX_.test(texto) && !(ses.esperando && ses.esperando.tipo === 'gre'))) return null;
  if (/^\s*\/?gu[ií]a\b|\b(emit|emite|emita|genera|haz)\w*\b.*\bgu[ií]a\b/i.test(texto) || TGG_PDF_RX_.test(texto)) return null;   // pide OTRA guía, emitir o el PDF
  var c = TGG_leer_(ss, ses.gre);
  if (!c || /Emitida|Descartada|Emitiendo/.test(c.estado || '')) return null;
  return { c: c, pregunta: ses.esperando && ses.esperando.tipo === 'gre' ? ses.esperando.pregunta : null };
}

/* ============================================================ texto de la propuesta */

function TGG_texto_(c, html) {
  var e = html ? TG_esc_ : String, b = function (s) { return html ? '<b>' + s + '</b>' : '*' + s + '*'; };
  var t = c.transporte || {}, L = [];
  L.push('🚚 ' + b('Guía de remisión · ' + e(c.motivo || '?')) + ' · caso ' + c.id);
  if (c.entendido) L.push('🧠 ' + (html ? '<i>' + e(c.entendido) + '</i>' : '_' + c.entendido + '_'));
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
  L.push('Se emite en: ' + (c.via === 'quesito' ? '🧀 Quesito (desde la factura' + (c.documento ? ' ' + e(c.documento.numero) : '') + ') · escriba «por sunat» para cambiarlo'
    : 'SUNAT SOL' + (c.motivo === 'Venta' ? ' · escriba «en quesito» para emitirla en Quesito desde su factura' : '')));
  var preg = TGG_preguntas_(c);
  if (preg.length) L.push('\n❓ ' + b(e(preg[0].q)) + (preg.length > 1 ? ' (después le pregunto ' + (preg.length - 1) + ' cosa(s) más)' : ''));
  else L.push('\n' + b('¿Está todo bien?') + ' Toque ✅ Está bien y la lleno en ' + TGG_donde_(c) + ' para que vea la vista previa (no se emite). ' +
    'Si quiere cambiar algo, toque ✏️ Modificar algo o escríbalo directo ("es privado", "peso 30000", "llegada Av. Mártires").');
  return L.join('\n');
}

/* ============================================================ GitHub */

function TGG_pedir_(ss, c, modo) {
  var cfg = TG_cfg_(ss);
  if (TGG_faltan_(c).length) throw new Error(TGG_faltan_(c).join(' '));
  if (modo === 'emitir' && /^(Emitida|Emitiendo)$/.test(c.estado || '')) throw new Error('esa guía ya está ' + c.estado.toLowerCase() + (c.gre ? ' (' + c.gre + ')' : '') + '.');
  // ⚡ La vista previa sigue abierta en SUNAT esperando: se emite ahí mismo (sin volver a llenar). Si no, corrida nueva.
  var lock = LockService.getUserLock();   // candado propio de las guías: no espera a "Actualizar todo" (usa el del script)
  if (!lock.tryLock(25000)) throw new Error('el bot está ocupado con otra guía. Toque de nuevo en un minuto.');
  try {
    var v = TGG_leer_(ss, c.id) || c;
    if (v.espera_run && Number(v.espera_hasta || 0) > Date.now() + 15000) {
      if (modo === 'emitir' && v.estado === 'Vista previa lista') {
        c.espera_run = v.espera_run; c.espera_hasta = v.espera_hasta;
        c.decision = 'emitir'; c.confirmar = TGG_huella_(c); c.estado = 'Emitiendo'; c.huella = c.confirmar;
        TGG_guardar_(ss, c);
        return 'misma';
      }
      c.decision = 'cerrar';   // pidió otra vista previa: la que espera se cierra sin emitir
    }
  } finally { lock.releaseLock(); }
  c.estado = modo === 'emitir' ? 'Emitiendo' : 'Vista previa…';
  c.solo_leer = false;
  c.huella = TGG_huella_(c);
  TGG_guardar_(ss, c);
  TG_gh_(cfg, '/actions/workflows/' + (c.via === 'quesito' ? TGG_WF_QUESITO_ : TGG_WF_) + '/dispatches', 'post', { ref: cfg.rama, inputs: {
    ruc: c.empresa_ruc, caso: c.id, modo: modo, confirmar: modo === 'emitir' ? c.huella : '' } });
}

var TGG_SISTEMA_LOCAL_ = [
  'Eres quien llena una Guía de Remisión en SUNAT. SUNAT muestra la lista de establecimientos (locales) registrados de un RUC y hay que',
  'elegir el punto de partida o de llegada correcto. Usa TODO: lo que la persona escribió o dictó (manda sobre lo demás, aunque esté',
  'abreviado o mal escrito: PQUE = PARQUE, Z.I. = ZONA INDUSTRIAL, MZ-E = MANZANA E, LT-4 = LOTE 4), la dirección del borrador, la',
  'ciudad del ticket de despacho o de la factura (ej. "C.D. TACNA") y los archivos. Compara por sentido, no letra por letra.',
  'Devuelve SOLO JSON: {"numero": número de la lista o 0, "seguro": true|false, "candidatos": [hasta 5 números, el mejor primero],',
  ' "motivo": "1 frase"}. seguro = true solo si un local corresponde claramente; si dudas entre varios, seguro = false y ordénalos.'
].join('\n');

/** El robot pide a la IA elegir el local de partida/llegada entre los que SUNAT tiene para ese RUC. */
function TGG_elegirLocal_(c, cual, lista) {
  if (!/^(partida|llegada)$/.test(cual) || !lista.length) return { ok: false, error: 'datos' };
  var p = c[cual] || {};
  var txt = 'Hay que elegir el punto de ' + cual.toUpperCase() + ' (motivo ' + (c.motivo || '?') + ', ' +
    (cual === 'partida' && c.motivo === 'Compra' ? 'sale del almacén del proveedor ' : '') + 'RUC del dueño del local ' + (p.ruc || c.empresa_ruc || '') + ').\n' +
    'Dirección en el borrador: ' + (p.direccion || '(vacía)') + '\n' +
    (c.entendido ? 'Resumen: ' + c.entendido + '\n' : '') +
    'Mensajes de la persona, en orden:\n' + ((c.mensajes || []).slice(-15).map(function (m, i) { return (i + 1) + ') ' + m; }).join('\n') || '(ninguno)') +
    '\n\nLocales que SUNAT muestra (' + lista.length + '):\n' + lista.slice(0, 80).map(function (t, i) { return (i + 1) + ') ' + String(t).slice(0, 200); }).join('\n');
  try {
    var r = TGG_gemini_(txt, c.archivos, TGG_SISTEMA_LOCAL_), n = Number(r.numero) || 0;
    var cand = (r.candidatos || []).map(Number).filter(function (x) { return x >= 1 && x <= lista.length; });
    return { ok: true, numero: n >= 1 && n <= lista.length ? n : 0, seguro: r.seguro === true, candidatos: cand, motivo: String(r.motivo || '').slice(0, 200) };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** PDF de la guía emitida (guardado en Drive): {base64, nombre} o null. */
function TGG_pdf_(c) {
  if (!c || !c.pdf) return null;
  try {
    var f = DriveApp.getFileById(c.pdf);
    return { base64: Utilities.base64Encode(f.getBlob().getBytes()), nombre: 'GRE ' + (c.gre || c.id) + '.pdf', archivo: f };
  } catch (e) { return null; }
}

/** "pdf guía b0006956", "pdf de la guía", "/pdf EG07-123": el caso pedido (o el de la conversación) o null si no es este pedido. */
var TGG_PDF_RX_ = /^\s*\/?(pdf|m[aá]nd[ae]me el pdf|env[ií]a(me)? el pdf|reenv[ií]a(me)? el pdf)\b/i;
function TGG_pedidoPdf_(ss, texto, clave) {
  var t = String(texto || '');
  if (!TGG_PDF_RX_.test(t) || !/gu[ií]a|\b[0-9a-f]{8}\b|\b(EG\d{2}|T\d{3})-?\d+/i.test(t)) return null;
  var m = t.match(/\b([0-9a-f]{8})\b/), g = t.match(/\b(EG\d{2}|T\d{3})\s*-\s*(\d+)/i), c = null;
  if (m) c = TGG_leer_(ss, m[1]);
  var mismo = function (x) { var k = String(x || '').toUpperCase().match(/(EG\d{2}|T\d{3})\s*-\s*0*(\d+)/); return k && g && k[1] === g[1].toUpperCase() && k[2] === String(Number(g[2])); };
  if (!c && g) {
    var hoja = ss.getSheetByName(TGG_HOJA_), datos = hoja ? hoja.getDataRange().getValues() : [];
    for (var i = datos.length - 1; i > 0 && !c; i--) if (mismo(datos[i][10])) c = TGG_leer_(ss, String(datos[i][1]));
  }
  if (!c && g) {   // guía que no salió de este bot: se registra solo para bajar su PDF (¿de qué empresa?)
    var emp = TGG_empresas_(ss), rucs = Object.keys(emp), dig = t.replace(/\D/g, ' ');
    var r = rucs.filter(function (x) { return dig.indexOf(x) >= 0 || simpleNombre_(t).indexOf(simpleNombre_(emp[x]).split(' ')[0]) >= 0 && simpleNombre_(emp[x]).split(' ')[0].length > 2; });
    var ult = TG_sesion_(clave).gre && TGG_leer_(ss, TG_sesion_(clave).gre);
    var ruc = r.length === 1 ? r[0] : (rucs.length === 1 ? rucs[0] : (ult && ult.empresa_ruc) || '');
    if (!ruc) return { c: null, falta: 'empresa' };
    c = { id: Utilities.getUuid().replace(/-/g, '').slice(0, 8), creado: new Date().toISOString(), chat: clave, estado: 'Emitida', solo_pdf: true,
      empresa_ruc: ruc, empresa: emp[ruc] || '', motivo: '', gre: g[1].toUpperCase() + '-' + ('00000000' + Number(g[2])).slice(-8) };
    TGG_guardar_(ss, c);
  }
  if (!c && TG_sesion_(clave).gre) c = TGG_leer_(ss, TG_sesion_(clave).gre);
  return { c: c };
}

function simpleNombre_(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

/** Sin PDF guardado: si la guía está emitida, el robot lo baja de SUNAT (Consulta de GRE). Texto para la persona. */
function TGG_pedirPdfSunat_(ss, c, clave) {
  if (!c.gre || c.estado !== 'Emitida') return 'La guía caso ' + c.id + ' aún no tiene PDF (todavía no se emitió).';
  if (c.via === 'quesito') return '📄 La guía ' + c.gre + ' se emitió en Quesito: su PDF está en Quesito → Guías de Remisión (no lo tengo guardado aquí).';
  c.chat = clave; TGG_guardar_(ss, c);
  var cfg = TG_cfg_(ss);
  try {
    TG_gh_(cfg, '/actions/workflows/' + TGG_WF_ + '/dispatches', 'post', { ref: cfg.rama, inputs: { ruc: c.empresa_ruc, caso: c.id, modo: 'pdf', confirmar: '' } });
  } catch (e) { return '⚠️ No pude pedir el PDF a SUNAT: ' + e.message; }
  return '📄 Bajo el PDF de la guía ' + c.gre + ' desde SUNAT (Consulta de GRE). En 2–3 minutos se lo mando aquí.';
}

/** doPost ?canal=gh con accion gre_* (lo llama gre_robot.py). La corrida debe ser de gre-sunat.yml y estar en curso. */
function TGG_gh_(q) {
  var ss = TG_ss_(), cfg = TG_cfg_(ss), run = String(q.run || '').replace(/\D/g, '');
  if (!run || !TGC_runValido_(cfg, run, /(^|\/)gre-(sunat|quesito)\.ya?ml$/)) return { ok: false, error: 'Forbidden' };   // 🧀 también el robot de Quesito
  var c = TGG_leer_(ss, String(q.caso || ''));
  if (!c) return { ok: false, error: 'caso desconocido' };
  if (q.accion === 'gre_caso') return { ok: true, datos: TGG_paraRobot_(c), gre: c.gre || '' };
  if (q.accion === 'gre_pdf') {   // modo pdf: el PDF de una guía ya emitida (nunca cambia su estado)
    if (q.ok && q.pdf) {
      try {
        var fp = IMP_carpeta_(ss).createFile(Utilities.newBlob(Utilities.base64Decode(q.pdf), 'application/pdf', 'GRE ' + (c.gre || c.id) + '.pdf'));
        c.pdf = fp.getId(); TGG_guardar_(ss, c);
        TGG_avisar_(c, '📄 PDF de la guía ' + (c.gre || c.id) + ' (bajado de SUNAT).', null, false);
      } catch (e) { TGG_avisar_(c, '⚠️ Bajé el PDF pero no lo pude guardar: ' + e.message, null, false); }
    } else TGG_avisar_(c, '📄 Guía ' + (c.gre || c.id) + ': ' + String(q.texto || 'no pude bajar el PDF.'), q.imagen, false);
    return { ok: true };
  }
  if (q.accion === 'gre_elegir') return TGG_elegirLocal_(c, String(q.cual || ''), q.lista || []);
  if (q.accion === 'gre_espera') {   // la vista previa abierta pregunta si ya aprobaron
    var lk = LockService.getUserLock();
    if (!lk.tryLock(25000)) return { ok: true, decision: '' };   // ocupado: el robot vuelve a preguntar en unos segundos
    try {
      var e = TGG_leer_(ss, c.id) || c;
      if (e.espera_run !== run) { e.espera_run = run; e.decision = ''; e.confirmar = ''; }
      if (q.hasta) e.espera_hasta = Number(q.hasta);
      var d = { ok: true, decision: e.decision || '', confirmar: e.decision === 'emitir' ? e.confirmar : '' };
      if (q.fin || d.decision) { e.espera_run = ''; e.espera_hasta = 0; if (d.decision !== 'emitir') e.decision = ''; }
      TGG_guardar_(ss, e);
      return d;
    } finally { lk.releaseLock(); }
  }
  if (q.accion === 'gre_leido') {   // 📥 lo que Quesito trae de la factura (para completar la hoja de Guías); no se creó nada
    var dl = q.datos || {};
    c.leido = { factura: String(dl.factura || '').slice(0, 20), cotizacion: String(dl.cotizacion || '').slice(0, 12), cliente: String(dl.cliente || '').slice(0, 200),
      cliente_pdf: dl.cliente_pdf || {}, fila: String(dl.fila || '').slice(0, 300), partida: dl.partida || {},
      lineas: (dl.lineas || []).slice(0, 40).map(function (l) { return { texto: String(l.texto || '').slice(0, 250), cantidad: Number(l.cantidad) || 0 }; }) };
    c.estado = 'Leído de Quesito'; c.ultimo_error = '';
    TGG_guardar_(ss, c);
    return { ok: true };
  }
  if (q.accion === 'gre_aviso') { TGG_avisar_(c, String(q.texto || '').slice(0, 500) + ' · caso ' + c.id, null, false); return { ok: true }; }
  var cache = CacheService.getScriptCache();
  if (q.accion === 'gre_vista') {
    c.estado = 'Vista previa lista';
    if (c.origen === 'hoja' && q.imagen) {   // 🚚 la hoja de Guías muestra el enlace de la foto
      try { c.vista_img = IMP_carpeta_(ss).createFile(Utilities.newBlob(Utilities.base64Decode(q.imagen), 'image/jpeg', 'Vista previa guía ' + (c.hoja || c.id) + '.jpg')).getId(); } catch (e) {}
    }
    TGG_guardar_(ss, c);
    var notas = (q.notas || []).map(String).filter(Boolean).slice(0, 5);
    TGG_avisar_(c, '👁 Vista previa en ' + TGG_donde_(c) + ' (no se emitió nada) · caso ' + c.id +
      (notas.length ? '\n' + (c.via === 'quesito' ? 'Para revisar' : 'Avisos de SUNAT que acepté (no impiden la guía)') + ':\n· ' + notas.join('\n· ') : '') +
      '\nRevise la foto. Si está bien, toque ✅ Emitir (le pido confirmar antes).', q.imagen, true);
    return { ok: true };
  }
  if (q.accion === 'gre_fin') {
    if (q.cayo && cache.get('tgg_fin_' + run)) return { ok: true };   // ya avisó el robot
    cache.put('tgg_fin_' + run, '1', 21600);
    if (!q.ok && c.estado === 'Emitida') {   // una corrida posterior falló: la guía sigue emitida
      TGG_avisar_(c, '⚠️ Guía ' + (c.gre || c.id) + ': ' + String(q.texto || 'el robot falló'), q.imagen, false);
      return { ok: true };
    }
    if (c.solo_leer && !q.ok) {   // 📥 solo se leía la factura para la hoja: el error queda ahí (sin mensajes al chat)
      c.estado = 'No leído'; c.ultimo_error = String(q.texto || 'el robot falló').slice(0, 1500);
      TGG_guardar_(ss, c);
      return { ok: true };
    }
    if (q.ok) {
      c.estado = 'Emitida'; c.gre = String(q.numero || '');
      if (q.pdf) {
        try {
          var f = IMP_carpeta_(ss).createFile(Utilities.newBlob(Utilities.base64Decode(q.pdf), 'application/pdf', 'GRE ' + c.gre + '.pdf'));
          c.pdf = f.getId();
        } catch (e) {}
      }
      TGG_guardar_(ss, c);
      TGG_avisar_(c, '✅ Guía de remisión emitida: ' + c.gre + '\n' + (c.empresa || '') + ' · ' + c.motivo + ' · caso ' + c.id +
        (c.pdf ? '\nLe mando el PDF. Cuando quiera, pídalo de nuevo con «pdf guía ' + c.id + '».' : '\nNo pude bajar el PDF: descárguelo de SOL → Consulta de GRE.'), q.imagen, false);
    } else {
      c.estado = q.dudoso ? 'Revisar en SOL' : 'No emitida';
      c.intentos = (c.intentos || 0) + 1;
      c.ultimo_error = String(q.texto || '').slice(0, 1500);   // permite volver a pedir la vista previa aunque la guía no cambie
      c.opciones = q.opciones && (q.opciones.lista || []).length ? { cual: String(q.opciones.cual), lista: q.opciones.lista.slice(0, 40) } : null;
      if (c.opciones) TGG_seguirConversacion_(String(c.chat || ''), c);   // lo que responda (el número) va a esta guía
      TGG_guardar_(ss, c);
      TGG_avisar_(c, (q.dudoso ? '⚠️ ' : '⛔ ') + 'Guía caso ' + c.id + ': ' + String(q.texto || 'el robot falló') + (q.dudoso ? '' : c.opciones ? '\nNo se emitió nada.' : '\nNo se emitió nada. Escríbame o dícteme cómo seguir y continúo solo.'), q.imagen, false);
    }
    return { ok: true };
  }
  return { ok: false, error: 'accion desconocida' };
}

/** Manda el aviso (y la foto) al chat que pidió la guía. */
function TGG_avisar_(c, texto, imagenB64, conEmitir) {
  var chat = String(c.chat || ''), blob = imagenB64 ? Utilities.newBlob(Utilities.base64Decode(imagenB64), 'image/jpeg', 'gre.jpg') : null;
  if (chat.indexOf('wa') === 0) {
    var extra = conEmitir ? '\n\nPara emitirla escriba: *emitir guía ' + c.id + '*. Para cambiar algo, escríbame o dícteme el cambio ' +
      '(ej. "en el secundario pon autorización MTC 231800410") y vuelvo a preparar la vista previa.' : '';
    var botones = conEmitir ? { k: TG_guardarBoton_({ t: 'gre', id: c.id }), texto: '¿Qué hago con la guía caso ' + c.id + '?',
      opciones: [{ op: 'em', titulo: '✅ Emitir' }, { op: 'ed', titulo: '✏️ Modificar algo' }, { op: 'no', titulo: '🗑 Descartar' }] } : null;
    try {
      if (blob) TGC_wa_({ tipo: 'imagen', numero: chat.slice(2), mime: 'image/jpeg', base64: imagenB64, texto: texto + extra, botones: botones });
      else TGC_wa_({ tipo: 'texto', numero: chat.slice(2), texto: texto + extra, botones: botones });
    } catch (e) { console.error('GRE aviso WhatsApp: ' + e.message); }
    var pdf = TGG_pdf_(c);
    if (pdf) {
      var ok = false;
      try { ok = TGC_wa_({ tipo: 'documento', numero: chat.slice(2), mime: 'application/pdf', base64: pdf.base64, nombre: pdf.nombre, texto: '📄 ' + pdf.nombre }); } catch (e) {}
      if (!ok) try { TGC_wa_({ tipo: 'texto', numero: chat.slice(2), texto: '📄 PDF: ' + DriveApp.getFileById(c.pdf).getUrl() }); } catch (e) {}
    }
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

/** Guarda los archivos (Drive, carpeta temporal), analiza todo junto con lo que escribió y guarda el caso. */
function TGG_crear_(ss, adjs, texto, chat) {
  var archivos = adjs.slice(0, 10).map(function (a) {
    if (a.id) return { id: a.id, nombre: a.nombre || '', mime: a.mime || '' };
    var f = IMP_carpeta_(ss).createFile(Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', 'guia ' + (a.nombre || 'archivo')));
    return { id: f.getId(), nombre: a.nombre || '', mime: a.mime || '' };
  });
  var c = { id: Utilities.getUuid().replace(/-/g, '').slice(0, 8), creado: new Date().toISOString(), chat: chat, estado: 'Propuesta',
    archivos: archivos, mensajes: String(texto || '').trim() ? [String(texto).trim()] : [] };
  TGG_analizar_(ss, c);
  TGG_guardar_(ss, c);
  return c;
}

/** Más fotos/PDF para la guía abierta: se suman y se analiza todo de nuevo. */
function TGG_agregarArchivos_(ss, c, adjs) {
  adjs.slice(0, 6).forEach(function (a) {
    if (a.id) c.archivos.push({ id: a.id, nombre: a.nombre || '', mime: a.mime || '' });
    else c.archivos.push({ id: IMP_carpeta_(ss).createFile(Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', 'guia ' + (a.nombre || 'archivo'))).getId() });
  });
  c.mensajes = (c.mensajes || []).concat(['(mandé ' + adjs.length + ' archivo(s) más)']);
  TGG_analizar_(ss, c);
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
  var pp = TGG_pedidoPdf_(ctx.ss, t, ctx.chatId);   // 📄 "pdf guía …": reenvía el PDF de una guía emitida
  if (pp) {
    var pdf = TGG_pdf_(pp.c);
    if (!pdf) TG_enviar_(ctx.chatId, pp.c ? TG_esc_(TGG_pedirPdfSunat_(ctx.ss, pp.c, ctx.chatId)) : pp.falta ? '📄 ¿De qué empresa es esa guía? Escriba, por ejemplo, <i>pdf guía EG07-502 de M&amp;D</i>.' :
      '📄 No encontré esa guía. Escriba, por ejemplo, <i>pdf guía EG07-00000502</i> o <i>pdf guía b0006956</i>.');
    else TG_enviarArchivo_(ctx.chatId, pdf.archivo.getBlob().setName(pdf.nombre), '📄 ' + TG_esc_(pdf.nombre));
    return true;
  }
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
    return TG_enviar_(ctx.chatId, '⚠️ <b>¿Emito esta guía en ' + TGG_donde_(c) + '?</b>\n' + TGG_texto_(c, true).split('\n').slice(0, -1).join('\n') +
      '\n\nEs una operación real ante SUNAT' + (c.via === 'quesito' ? ' (Quesito la envía).' : '.') + (c.estado !== 'Vista previa lista' ? ' <i>Aún no vio la vista previa.</i>' : ''),
      [[{ text: '✅ Sí, emitir', callback_data: 'k:' + k + ':ok' }, { text: '✖ No', callback_data: 'k:' + k + ':x' }]]);
  }
  if (op === 'x') return TG_editarOEnviar_(ctx, '✖ No se emitió nada.', null);
  if (op === 'ok' && (!ctx.usuario || ctx.usuario.rol !== 'admin')) return TG_enviar_(ctx.chatId, 'Solo un administrador puede emitir guías.');
  if (op === 'ok' && datos.huella && datos.huella !== TGG_huella_(c)) return TG_enviar_(ctx.chatId, '⚠️ La guía cambió después de pedir confirmar. Revísela y vuelva a tocar ✅ Emitir.', TGG_botonesTG_(c));
  if (op === 'ok' || op === 'vp') {
    var modo = op === 'ok' ? 'emitir' : 'vista';
    if (TG_yaVisto_('g2' + modo + c.id + TGG_huella_(c) + '_' + (c.intentos || 0), 120)) return TG_enviar_(ctx.chatId, 'Eso ya se pidió.');
    if (op === 'ok') TG_llamar_('editMessageReplyMarkup', { chat_id: ctx.chatId, message_id: ctx.msgId, reply_markup: { inline_keyboard: [] } });
    var como;
    try { c.chat = ctx.chatId; como = TGG_pedir_(ctx.ss, c, modo); } catch (e) {
      TG_olvidar_('g2' + modo + c.id + TGG_huella_(c) + '_' + (c.intentos || 0));   // no se pidió: el botón vuelve a servir
      return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message), TGG_botonesTG_(c)); }
    return TG_enviar_(ctx.chatId, (modo === 'emitir' ? '🚚 <b>Emitiendo</b> la guía en ' + TGG_donde_(c) : '👁 <b>Preparando la vista previa</b> en ' + TGG_donde_(c) + ' (no se emite)') +
      ' · caso ' + c.id + (como === 'misma' ? '\nEn la misma pantalla de la vista previa: en menos de un minuto le mando el resultado.' : '\nTarda 2–4 minutos; le mando aquí la foto o el resultado.'));
  }
}

/** Respuesta a ✏️ Corregir. */
function TGG_editarTG_(ctx, id, texto, pregunta) {
  var c = TGG_leer_(ctx.ss, id);
  if (!c) return TG_enviar_(ctx.chatId, 'No encontré ese caso de guía.');
  TG_accion_(ctx.chatId, 'typing');
  var ok;
  try { ok = TGG_editar_(ctx.ss, c, texto, pregunta); } catch (e) { TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message), TGG_botonesTG_(c)); return true; }
  if (!ok) return false;   // no era para la guía: lo responde la IA general
  var extra = TGG_relanzar_(ctx.ss, c, ctx.chatId);
  TGG_guardar_(ctx.ss, c);
  TGG_seguirConversacion_(ctx.chatId, c);
  TG_enviar_(ctx.chatId, TGG_texto_(c, true) + TG_esc_(extra), extra ? null : TGG_botonesTG_(c));
  return true;
}

/** Telegram: lo que escribe o dice 🎤 con una guía abierta va a la IA de la guía (con todos sus archivos). true si lo tomó. */
function TGG_datoTG_(ctx, texto) {
  var x = TGG_paraGuia_(ctx.ss, ctx.chatId, texto);
  if (!x) return false;
  return TGG_editarTG_(ctx, x.c.id, texto, x.pregunta);
}

/** Telegram: más fotos/PDF para la guía abierta. */
function TGG_agregarTG_(ctx, adjs) {
  var ses = TG_sesion_(ctx.chatId), c = ses.gre && TGG_leer_(ctx.ss, ses.gre);
  if (!c || /Emitida|Descartada/.test(c.estado || '')) return TGG_desdeAdjTG_(ctx, adjs, '');
  TG_accion_(ctx.chatId, 'typing');
  try { TGG_agregarArchivos_(ctx.ss, c, adjs); } catch (e) { return TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
  TGG_seguirConversacion_(ctx.chatId, c);
  TG_enviar_(ctx.chatId, TGG_texto_(c, true), TGG_botonesTG_(c));
}

/** ¿Hay una guía abierta en este chat (para ofrecer "agregar a la guía")? */
function TGG_abierta_(clave) {
  var ses = TG_sesion_(clave);
  return ses.gre && ses.greT && Date.now() - ses.greT < 3 * 3600000 ? ses.gre : '';
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
  var pp = !(q.adjuntos || []).length && TGG_pedidoPdf_(ss, texto, clave);   // 📄 "pdf guía …": manda el PDF adjunto
  if (pp) {
    var pdf = TGG_pdf_(pp.c);
    if (!pdf) return TGG_respWA_(pp.c ? TGG_pedirPdfSunat_(ss, pp.c, clave) : pp.falta ? '📄 ¿De qué empresa es esa guía? Escriba, por ejemplo, *pdf guía EG07-502 de M&D*.' :
      '📄 No encontré esa guía. Escriba, por ejemplo, *pdf guía EG07-00000502* o *pdf guía b0006956*.');
    var rp = TGG_respWA_('📄 Aquí está el PDF de la guía ' + (pp.c.gre || pp.c.id) + '.');
    rp.archivos = [{ base64: pdf.base64, mime: 'application/pdf', nombre: pdf.nombre, titulo: '📄 ' + pdf.nombre }];
    return rp;
  }
  // 🎤 Nota de voz con una guía abierta: se transcribe aquí para que vaya a la guía.
  if (!texto && q.audio && q.audio.base64 && TGG_abierta_(clave)) {
    try { texto = TG_transcribir_(ss, Utilities.newBlob(Utilities.base64Decode(q.audio.base64), q.audio.mime || 'audio/ogg', 'voz.ogg')); } catch (e) {}
  }
  // Fotos/PDF con una guía abierta y que hablan de la guía: se suman a ella.
  var abierta = TGG_abierta_(clave);
  if ((q.adjuntos || []).length && abierta && !/^\s*\/?gu[ií]a\b|emit\w*\s+gu[ií]a/i.test(texto) && TGG_PIDE_RX_.test(texto + ' ' + (q.citado || ''))) {
    var ca = TGG_leer_(ss, abierta);
    if (ca && !/Emitida|Descartada/.test(ca.estado || '')) {
      try { TGG_agregarArchivos_(ss, ca, q.adjuntos); } catch (e) { return TGG_respWA_('⚠️ ' + e.message, ca); }
      TGG_seguirConversacion_(clave, ca);
      return TGG_respWA_(TGG_texto_(ca, false), ca);
    }
  }
  var dato = !(q.adjuntos || []).length && TGG_paraGuia_(ss, clave, texto);   // todo lo que escribe va a la IA de la guía
  if (dato && !/^\s*(emitir|emite)\b/i.test(texto)) {
    var c0 = dato.c, ok;
    try { ok = TGG_editar_(ss, c0, texto, dato.pregunta); } catch (e) { return TGG_respWA_('⚠️ ' + e.message, c0); }
    if (ok) {
      var extra = TGG_relanzar_(ss, c0, clave);
      TGG_guardar_(ss, c0);
      TGG_seguirConversacion_(clave, c0);
      return TGG_respWA_(TGG_texto_(c0, false) + extra, extra ? null : c0);
    }
  }
  // «Emitir» / «emítela» a secas, justo después de la vista previa de una guía: es esa guía (no las retenciones por emitir).
  var sola = /^\s*\/?(emitir|emite|em[ií]tel[ao]|emitirl[ao]|s[ií],?\s*emit\w*|ok,?\s*emit\w*)(\s+(la\s+)?gu[ií]a)?\s*[.!]*\s*$/i.test(texto);
  var ab = sola && !(q.adjuntos || []).length && TGG_abierta_(clave), cab = ab && TGG_leer_(ss, ab);
  if (cab && cab.estado === 'Vista previa lista') return TGG_botonWA_({ id: cab.id }, null, 'em', clave.slice(2));
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
    var r = TGG_respWA_('⚠️ *¿Emito esta guía en ' + TGG_donde_(c) + '?*\n' + TGG_texto_(c, false).split('\n').slice(0, -1).join('\n') + '\n\nEs una operación real ante SUNAT' + (c.via === 'quesito' ? ' (Quesito la envía).' : '.') +
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
  if (TG_yaVisto_('g2' + modo + c.id + TGG_huella_(c) + '_' + (c.intentos || 0), 120)) return TGG_respWA_('Eso ya se pidió.');
  var como;
  try { c.chat = clave; como = TGG_pedir_(ss, c, modo); } catch (e) {
    TG_olvidar_('g2' + modo + c.id + TGG_huella_(c) + '_' + (c.intentos || 0));   // no se pidió: puede volver a tocar el botón
    return TGG_respWA_('⚠️ ' + e.message, c); }
  return TGG_respWA_((modo === 'emitir' ? '🚚 *Emitiendo* la guía en ' + TGG_donde_(c) : '👁 *Preparando la vista previa* en ' + TGG_donde_(c) + ' (no se emite)') +
    ' · caso ' + c.id + (como === 'misma' ? '\nEn la misma pantalla de la vista previa: en menos de un minuto le mando el resultado.' : '\nTarda 2–4 minutos; le mando aquí la foto o el resultado.'));
}
