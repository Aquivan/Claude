// ============================================================
// LLAMADA A GEMINI
// ============================================================

// totalPaginasLote: si se manda un PDF de varias paginas juntas en un solo
// archivo (para ahorrar llamadas), aqui va cuantas paginas trae ese
// archivo. Con eso se le agrega al prompt la instruccion de procesar cada
// pagina por separado y devolver a que pagina pertenece cada voucher. Para
// una sola imagen o una sola pagina de PDF, se deja undefined/1 (comportamiento
// identico al de siempre).
// ⏱ Tiempos de ESTA ejecución (los devuelve «procesar al instante» para que Telegram y WhatsApp digan en qué se fue el tiempo).
// ia = toda la lectura con IA (incluye los intentos que fallaron) · gemFallo = lo que se perdió esperando a Gemini cuando
// respondió saturado/sin cupo · imagen = poner la imagen en la celda · pdf = abrir el PDF y separar sus páginas ·
// indices = leer la hoja para detectar duplicados · pausas = esperas fijas entre lotes · escribir = escribir la fila.
var TIEMPOS_ = { ia: 0, escribir: 0, lecturas: 0, lector: '', gemFallo: 0, gemFallos: 0, imagen: 0, imagenes: 0, imagenReuso: 0, pdf: 0, indices: 0, pausas: 0 };
var INICIO_EJECUCION_ = Date.now();   // ⏱ inicio de ESTA ejecución (Google la corta a los 6 min): Lectores.js no razona si queda poco

function llamarGemini(base64, mimeType, esPDF, totalPaginasLote) {
  const t0 = Date.now();
  try {
    // 🧾 Respaldo automático entre IAs (Lectores.js): Gemini → NVIDIA → Groq, en el orden que se elija por Telegram.
    if (typeof LEC_leer_ === 'function') return LEC_leer_(base64, mimeType, esPDF, totalPaginasLote);
    return llamarGeminiSolo_(base64, mimeType, esPDF, totalPaginasLote).vouchers;
  } finally {
    TIEMPOS_.ia += Date.now() - t0;
    TIEMPOS_.lecturas++;
  }
}

// Solo Gemini (con sus modelos de reserva). opc.sinEsperas: no esperar 15+30 s si
// todos estan ocupados (hay otro lector de respaldo). opc.modelo: probar ese primero.
// Devuelve { vouchers, modelo }.
function llamarGeminiSolo_(base64, mimeType, esPDF, totalPaginasLote, opc) {
  opc = opc || {};
  if (!CFG.API_KEY) {
    throw new Error('Falta configurar la API Key de Gemini (menu "🔑 Configurar API Key de Gemini").');
  }

  let prompt = esPDF ? PROMPT_PDF : PROMPT_IMAGEN;
  if (esPDF && totalPaginasLote && totalPaginasLote > 1) {
    prompt = envolverPromptParaLote_(prompt, totalPaginasLote);
  }

  const payload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 32768,   // Gemini 4 piensa antes de responder y ese razonamiento también cuenta aquí
      responseMimeType: 'application/json'
    }
  };

  // Si el modelo principal esta saturado (429/5xx) o no existe para la clave (404),
  // se pasa AL MOMENTO al siguiente de la lista, en vez de esperar 20-90 s.
  // Solo si todos estan ocupados se espera un poco y se vuelve a probar.
  // opc.modelos: los Gemini elegidos EN ORDEN en /lectores (1.º, 2.º, 3.º…). Sin otro lector de respaldo, después siguen los de siempre.
  let modelos = (opc.modelos && opc.modelos.length > 1) ? modelosGemini_(opc.modelos, !!opc.sinEsperas, !!opc.sinEsperas) : modelosGemini_(opc.modelo, false, !!opc.sinEsperas);
  if (opc.maxModelos) modelos = modelos.slice(0, opc.maxModelos);
  // ⏳ Paciencia con Gemini: aunque haya respaldo (NVIDIA/Groq), si todos los Gemini dijeron «saturado» se espera 15 s y se
  // prueban una vez más antes de pasar al respaldo (si a la ejecución le queda tiempo). Sin respaldo: 15 s y 30 s.
  const ESPERAS = opc.sinEsperas ? ((Date.now() - INICIO_EJECUCION_) < 200000 ? [15000] : []) : [15000, 30000];

  if (!modelos.length) throw new Error('API_SATURADA');   // todos saturados hace poco y hay respaldo: directo al respaldo
  for (let vuelta = 0; vuelta <= ESPERAS.length; vuelta++) {
    for (let m = 0; m < modelos.length; m++) {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                  modelos[m] + ':generateContent?key=' + CFG.API_KEY;
      let tPet = Date.now();
      const pedir = function () {
        return UrlFetchApp.fetch(url, { method: 'POST', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
      };
      let resp = pedir();
      let code = resp.getResponseCode();
      let segPet = Math.round((Date.now() - tPet) / 100) / 10;
      if (code !== 200) { TIEMPOS_.gemFallo += Date.now() - tPet; TIEMPOS_.gemFallos++; }
      // 🔁 «Saturado» (5xx) que llegó RÁPIDO (< 10 s): muchas veces dura segundos. Se espera 8 s y se intenta UNA vez más
      // el mismo modelo antes de pasar al siguiente (o a NVIDIA). No con «sin cupo» (429: no vuelve en segundos), ni si
      // Google ya hizo esperar mucho, ni si a esta ejecución le queda poco tiempo.
      if (code >= 500 && segPet < 10 && (Date.now() - INICIO_EJECUCION_) < 250000) {
        Logger.log('Modelo ' + modelos[m] + ': HTTP ' + code + ' en ' + segPet + ' s. Se espera 8 s y se intenta una vez más.');
        const tEsp = Date.now();
        Utilities.sleep(8000);
        tPet = Date.now();
        resp = pedir();
        code = resp.getResponseCode();
        segPet = Math.round((Date.now() - tPet) / 100) / 10;
        TIEMPOS_.gemFallo += tPet - tEsp;   // los 8 s de espera
        if (code !== 200) { TIEMPOS_.gemFallo += Date.now() - tPet; TIEMPOS_.gemFallos++; }
        else Logger.log('✅ ' + modelos[m] + ' respondió en el segundo intento.');
      }

      if (code === 200) {
        if (m > 0) Logger.log('Leido con ' + modelos[m] + ' (el principal estaba ocupado).');
        return { vouchers: parsearRespuestaGemini_(resp), modelo: modelos[m] };
      }
      if (code === 429 || code >= 500 || code === 404) {
        Logger.log('Modelo ' + modelos[m] + ': HTTP ' + code + ' (Google tardó ' + segPet + ' s en responder). Se prueba el siguiente.');
        if (code === 404) marcarModeloNoDisponible_(modelos[m]);
        else if (typeof LEC_marcarCaido_ === 'function') LEC_marcarCaido_('gemini', modelos[m], code === 429 ? LEC_SEG_SIN_CUPO_ : 0);   // ⚡ se salta 2 min (sin cupo: 15 min)
        continue;
      }
      throw new Error('GEMINI_HTTP_' + code + ': ' + resp.getContentText().substring(0, 200));
    }
    if (vuelta < ESPERAS.length) {
      Logger.log('Todos los modelos ocupados. Esperando ' + (ESPERAS[vuelta] / 1000) + 's...');
      Utilities.sleep(ESPERAS[vuelta]);
    }
  }
  throw new Error('API_SATURADA');
}

// Modelos a probar en orden. Se puede cambiar sin tocar codigo con la propiedad
// del script MODELOS_GEMINI (ej. "gemini-3.8-flash,gemini-3.6-flash").
// primero: el modelo elegido por Telegram («lectores modelo gemini ...»), si hay.
// primero también puede ser una LISTA (varios elegidos en orden); soloEsos: no agregar los de siempre (hay otro lector de respaldo).
function modelosGemini_(primero, soloEsos, hayRespaldo) {
  const prop = PropertiesService.getScriptProperties().getProperty('MODELOS_GEMINI') || '';
  const elegidos = Array.isArray(primero) ? primero.map(String) : (primero ? [String(primero)] : []);
  const lista = elegidos.concat(soloEsos && elegidos.length ? [] : (prop ? prop.split(',') : [CFG.MODELO_GEMINI, 'gemini-3.8-flash', 'gemini-3.5-flash-lite']))
    .map(function (x) { return String(x).trim(); }).filter(Boolean);
  const cache = CacheService.getScriptCache();
  const vistos = {};
  const usar = lista.filter(function (x) {
    if (vistos[x]) return false;
    vistos[x] = true;
    return !cache.get('gemini_404_' + x);
  });
  // ⚡ Los que respondieron saturado/sin cupo hace < 2 min (Lectores.js) se saltan; si hay otro lector de respaldo y
  // TODOS están así, no se pierde tiempo: se pasa directo al respaldo. Sin respaldo, se prueban igual.
  if (typeof LEC_caido_ === 'function') {
    const vivos = usar.filter(function (x) { return !LEC_caido_('gemini', x); });
    if (vivos.length) { if (vivos.length < usar.length) Logger.log('Se saltan (saturados hace poco): ' + usar.filter(function (x) { return vivos.indexOf(x) < 0; }).join(', ')); return vivos; }
    if (hayRespaldo) { Logger.log('Todos los Gemini elegidos estuvieron saturados hace poco: directo al respaldo.'); return []; }
  }
  return usar.length ? usar : [CFG.MODELO_GEMINI];
}

function marcarModeloNoDisponible_(modelo) {
  try { CacheService.getScriptCache().put('gemini_404_' + modelo, '1', 21600); } catch (e) {}
}

function parsearRespuestaGemini_(resp) {
  const json   = JSON.parse(resp.getContentText());
  const texto  = (json.candidates && json.candidates[0] &&
                  json.candidates[0].content && json.candidates[0].content.parts &&
                  json.candidates[0].content.parts[0] &&
                  json.candidates[0].content.parts[0].text) || '';
  return parsearTextoVouchers_(texto);
}

// Texto de la IA (JSON, a veces con ```json o con texto alrededor) -> arreglo de vouchers.
// Lo usan Gemini y los lectores de respaldo (Lectores.js).
function parsearTextoVouchers_(texto) {
  const limpio = String(texto || '').replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  try {
    const datos   = JSON.parse(limpio);
    const arreglo = Array.isArray(datos) ? datos : [datos];
    arreglo.forEach(function(v) {
      v.fecha       = forzarVacio(v.fecha);
      v.nOperacion  = forzarVacio(v.nOperacion);
      v.banco       = forzarVacio(v.banco);
      v.moneda      = forzarVacio(v.moneda);
      v.proveedor   = forzarVacio(v.proveedor);
      v.idCliente   = forzarVacio(v.idCliente);
      v.cliente     = forzarVacio(v.cliente);
      v.descripcion = forzarVacio(v.descripcion);
    });
    return arreglo;
  } catch (e) {
    const objetos = [];
    const coincidencias = limpio.match(/\{[\s\S]*?\}/g);
    if (coincidencias) {
      coincidencias.forEach(function(c) {
        try { objetos.push(JSON.parse(c)); } catch (err) {}
      });
    }
    return objetos.length > 0 ? objetos : [];
  }
}
