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

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              CFG.MODELO_GEMINI + ':generateContent?key=' + CFG.API_KEY;

  // Esperas mas cortas en el primer reintento: muchas veces el 429 se
  // resuelve en 20-30s, no hacia falta esperar 75s de entrada.
  const ESPERAS_429 = [20000, 45000, 90000];

  for (let intento = 1; intento <= 3; intento++) {
    const resp = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();

    if (code === 200) {
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

    if (code === 429 || code >= 500) {
      const espera = ESPERAS_429[intento - 1] || 90000;
      Logger.log('Cuota/servidor (HTTP ' + code + '). Intento ' + intento + '/3. Esperando ' + (espera / 1000) + 's...');
      if (intento < 3) {
        Utilities.sleep(espera);
      } else {
        throw new Error('API_SATURADA');
      }
    } else {
      throw new Error('GEMINI_HTTP_' + code + ': ' + resp.getContentText().substring(0, 200));
    }
  }

  return [];
}
