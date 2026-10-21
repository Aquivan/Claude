// ============================================================
// LLAMADA A GEMINI
// ============================================================

// totalPaginasLote: si se manda un PDF de varias paginas juntas en un solo
// archivo (para ahorrar llamadas), aqui va cuantas paginas trae ese
// archivo. Con eso se le agrega al prompt la instruccion de procesar cada
// pagina por separado y devolver a que pagina pertenece cada voucher. Para
// una sola imagen o una sola pagina de PDF, se deja undefined/1 (comportamiento
// identico al de siempre).
function llamarGemini(base64, mimeType, esPDF, totalPaginasLote) {
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
      maxOutputTokens: 8192,
      responseMimeType: 'application/json'
    }
  };

  // Si el modelo principal esta saturado (429/5xx) o no existe para la clave (404),
  // se pasa AL MOMENTO al siguiente de la lista, en vez de esperar 20-90 s.
  // Solo si todos estan ocupados se espera un poco y se vuelve a probar.
  const modelos = modelosGemini_();
  const ESPERAS = [15000, 30000];

  for (let vuelta = 0; vuelta <= ESPERAS.length; vuelta++) {
    for (let m = 0; m < modelos.length; m++) {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                  modelos[m] + ':generateContent?key=' + CFG.API_KEY;
      const resp = UrlFetchApp.fetch(url, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const code = resp.getResponseCode();

      if (code === 200) {
        if (m > 0) Logger.log('Leido con ' + modelos[m] + ' (el principal estaba ocupado).');
        return parsearRespuestaGemini_(resp);
      }
      if (code === 429 || code >= 500 || code === 404) {
        Logger.log('Modelo ' + modelos[m] + ': HTTP ' + code + '. Se prueba el siguiente.');
        if (code === 404) marcarModeloNoDisponible_(modelos[m]);
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
function modelosGemini_() {
  const prop = PropertiesService.getScriptProperties().getProperty('MODELOS_GEMINI') || '';
  const lista = (prop ? prop.split(',') : [CFG.MODELO_GEMINI, 'gemini-3.8-flash', 'gemini-3.5-flash-lite'])
    .map(function (x) { return String(x).trim(); }).filter(Boolean);
  const cache = CacheService.getScriptCache();
  const vistos = {};
  const usar = lista.filter(function (x) {
    if (vistos[x]) return false;
    vistos[x] = true;
    return !cache.get('gemini_404_' + x);
  });
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
  const limpio = texto.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

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
