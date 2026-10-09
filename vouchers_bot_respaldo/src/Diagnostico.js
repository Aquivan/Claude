// ============================================================
// ENDPOINT DE DIAGNOSTICO (doGet)
// ------------------------------------------------------------
// Permite verificar de forma remota que TODO el sistema esta sano,
// sin necesidad de entregar credenciales de Google a nadie.
//
// La app web ya esta publicada para que Telegram le hable por POST
// (doPost). Este doGet agrega una puerta de solo-consulta, protegida
// por su PROPIO token (distinto al de Telegram), que responde en JSON:
//
//   ?token=XXX&accion=diagnostico  -> revisa carpetas, hoja, API keys,
//                                     triggers y webhook de Telegram
//   ?token=XXX&accion=ultimas&n=5  -> ultimas N filas escritas
//   ?token=XXX&accion=errores      -> filas marcadas con error/omitido
//   ?token=XXX&accion=procesar     -> ejecuta procesarVouchers() ahora
//   ?token=XXX&accion=carpetas          -> contenido de las 3 carpetas
//   ?token=XXX&accion=crear-carpetas    -> restaura/crea carpetas faltantes
//   ?token=XXX&accion=configurar&clave=GEMINI_API_KEY&valor=...
//   ?token=XXX&accion=configurar&clave=TELEGRAM_BOT_TOKEN&valor=...
//   ?token=XXX&accion=configurar&clave=TELEGRAM_ALLOWED_CHAT_IDS&valor=111,222
//   ?token=XXX&accion=activar-webhook   -> conecta el bot ya configurado
//
// Nunca devuelve secretos: de las claves solo informa si estan
// configuradas (true/false), jamas su valor.
//
// Para generar el token usa el menu "🩺 Configurar diagnostico remoto".
// Para cortar el acceso, borra la propiedad DIAG_TOKEN (el menu tiene
// la opcion "🚫 Desactivar diagnostico remoto") o elimina la
// implementacion de la app web.
// ============================================================

function doGet(e) {
  const params = (e && e.parameter) || {};

  // Instalacion de un solo uso: prepara la hoja (renombra la pestana,
  // crea cabeceras) y genera el token de diagnostico. Solo funciona la
  // PRIMERA vez -- una vez usada, se autodestruye y nunca vuelve a
  // correr aunque se la vuelva a llamar. No pide token porque en ese
  // primer instante todavia no existe ninguno.
  if (params.accion === 'instalar') {
    return respuestaJson_(instalarSistema_());
  }

  const tokenGuardado = PropertiesService.getScriptProperties().getProperty('DIAG_TOKEN');

  if (!tokenGuardado || !params.token || !tokensIguales_(params.token, tokenGuardado)) {
    return respuestaJson_({ ok: false, error: 'No autorizado' });
  }

  try {
    switch (params.accion) {
      case 'diagnostico': return respuestaJson_(diagnosticoCompleto_());
      case 'ultimas':     return respuestaJson_(ultimasFilas_(parseInt(params.n, 10) || 5, params.pestana));
      case 'errores':     return respuestaJson_(filasConProblema_(params.pestana));
      case 'procesar':    return respuestaJson_(ejecutarProcesamiento_());
      case 'carpetas':    return respuestaJson_(listarCarpetas_());
      case 'crear-carpetas':   return respuestaJson_(crearCarpetasFaltantes_());
      case 'configurar':       return respuestaJson_(configurarSecreto_(params.clave, params.valor));
      case 'activar-webhook':  return respuestaJson_(activarWebhookTelegram_());
      case 'activar-trigger':  return respuestaJson_(activarTriggerRemoto_());
      case 'activar-reparacion': return respuestaJson_(activarTriggerReparacionRemoto_());
      case 'reparar':          return respuestaJson_(ejecutarReparacionRemota_());
      case 'migrar-v2':        return respuestaJson_(migrarEstructuraV2_());
      case 'vaciar-todo':      return respuestaJson_(vaciarTodo_(params.confirmar));
      default:
        return respuestaJson_({
          ok: false,
          error: 'Accion no reconocida',
          accionesValidas: ['diagnostico', 'ultimas', 'errores', 'procesar', 'carpetas', 'crear-carpetas', 'configurar', 'activar-webhook', 'activar-trigger', 'activar-reparacion', 'reparar', 'migrar-v2', 'vaciar-todo']
        });
    }
  } catch (err) {
    return respuestaJson_({ ok: false, error: err.message, stack: String(err.stack || '').split('\n').slice(0, 5) });
  }
}

// Solo estas propiedades se pueden tocar por esta via. Nunca DIAG_TOKEN ni
// INSTALADO -- esos se manejan aparte para no poder auto-revocarse ni
// reinstalarse por accidente via URL.
const PROPIEDADES_CONFIGURABLES_ = ['GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHAT_IDS'];

function configurarSecreto_(clave, valor) {
  if (PROPIEDADES_CONFIGURABLES_.indexOf(clave) === -1) {
    return { ok: false, error: 'Clave no permitida. Usa una de: ' + PROPIEDADES_CONFIGURABLES_.join(', ') };
  }
  if (valor === undefined || valor === null) {
    return { ok: false, error: 'Falta el parametro "valor".' };
  }
  PropertiesService.getScriptProperties().setProperty(clave, valor.toString().trim());
  return { ok: true, clave: clave, guardado: true };
}

function activarTriggerRemoto_() {
  try {
    crearTriggerAutomatico();
    return { ok: true, mensaje: 'Trigger de procesamiento automatico activado (cada 10 min).' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function activarTriggerReparacionRemoto_() {
  try {
    crearTriggerReparacion();
    return { ok: true, mensaje: 'Trigger de reparacion de imagenes activado (cada 30 min).' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function ejecutarReparacionRemota_() {
  const inicio = Date.now();
  let error = null;
  try {
    // repararImagenesFaltantes es async (usa pdf-lib); igual que
    // ejecutarProcesamiento_(), no se le pone await: Apps Script
    // termina de resolverla dentro de la misma invocacion antes de
    // que doGet (no-async) devuelva la respuesta.
    repararImagenesFaltantes();
  } catch (err) {
    error = err.message;
  }
  return {
    ok: !error,
    error: error,
    duracionSegundos: Math.round((Date.now() - inicio) / 1000)
  };
}

function instalarSistema_() {
  const props = PropertiesService.getScriptProperties();

  if (props.getProperty('INSTALADO') === 'true') {
    return { ok: false, error: 'El sistema ya fue instalado antes. Usa el token de diagnostico existente en vez de "instalar".' };
  }

  const resultado = { ok: true, pasos: [] };

  try {
    const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
    let hoja = ss.getSheetByName(CFG.SHEET_ORIGINALES);
    if (!hoja) {
      hoja = ss.getSheets()[0];
      hoja.setName(CFG.SHEET_ORIGINALES);
      resultado.pasos.push('Pestana renombrada a "' + CFG.SHEET_ORIGINALES + '"');
    } else {
      resultado.pasos.push('La pestana "' + CFG.SHEET_ORIGINALES + '" ya existia');
    }
    asegurarCabeceras(hoja);
    resultado.pasos.push('Cabeceras verificadas/creadas');
  } catch (err) {
    return { ok: false, error: 'Error preparando la hoja: ' + err.message };
  }

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  props.setProperty('DIAG_TOKEN', token);
  props.setProperty('INSTALADO', 'true');
  resultado.pasos.push('Token de diagnostico generado');
  resultado.diagToken = token;

  return resultado;
}

// ============================================================
// MIGRACION A LA ESTRUCTURA V2 (Originales vs Fotos)
// ------------------------------------------------------------
// Idempotente: si se corre varias veces, no duplica carpetas ni pestañas
// (los IDs quedan guardados en Script Properties). Al terminar, devuelve
// los IDs para pegarlos en Config.js.
// ============================================================

function migrarEstructuraV2_() {
  const props = PropertiesService.getScriptProperties();
  const resultado = { ok: true, pasos: [], ids: {} };

  try {
    let raizId = props.getProperty('CARPETA_RAIZ_ID');
    let raiz = null;
    if (raizId) {
      try { raiz = DriveApp.getFolderById(raizId); } catch (e) { raizId = null; }
    }
    if (!raiz) {
      raiz = DriveApp.createFolder('Sistema de Vouchers');
      raizId = raiz.getId();
      props.setProperty('CARPETA_RAIZ_ID', raizId);
      resultado.pasos.push('Carpeta raiz "Sistema de Vouchers" creada');
    } else {
      resultado.pasos.push('Carpeta raiz ya existia');
    }
    resultado.ids.raiz = raizId;

    const grupos = [
      { nombre: 'Originales', prefijo: 'ORIGINALES' },
      { nombre: 'Fotos',      prefijo: 'FOTOS' }
    ];

    grupos.forEach(function (grupo) {
      const grupoId = obtenerOCrearSubcarpeta_(raiz, grupo.nombre, props, 'CARPETA_' + grupo.prefijo + '_GRUPO_ID', resultado);
      const grupoFolder = DriveApp.getFolderById(grupoId);
      ['Entrada', 'Procesados'].forEach(function (hijo) {
        const clave = 'CARPETA_' + grupo.prefijo + '_' + hijo.toUpperCase() + '_ID';
        const id = obtenerOCrearSubcarpeta_(grupoFolder, hijo, props, clave, resultado);
        resultado.ids[grupo.prefijo.toLowerCase() + '_' + hijo.toLowerCase()] = id;
      });
    });

    resultado.ids.descartados = obtenerOCrearSubcarpeta_(raiz, 'Descartados', props, 'CARPETA_DESCARTADOS_ID', resultado);

    const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
    let hojaOriginales = ss.getSheetByName('Originales') || ss.getSheetByName('Vouchers');
    if (hojaOriginales && hojaOriginales.getName() !== 'Originales') {
      hojaOriginales.setName('Originales');
      resultado.pasos.push('Pestana "Vouchers" renombrada a "Originales"');
    } else if (!hojaOriginales) {
      hojaOriginales = ss.insertSheet('Originales');
      resultado.pasos.push('Pestana "Originales" creada');
    } else {
      resultado.pasos.push('Pestana "Originales" ya existia');
    }
    asegurarCabeceras(hojaOriginales);

    let hojaFotos = ss.getSheetByName('Fotos');
    if (!hojaFotos) {
      hojaFotos = ss.insertSheet('Fotos');
      resultado.pasos.push('Pestana "Fotos" creada');
    } else {
      resultado.pasos.push('Pestana "Fotos" ya existia');
    }
    asegurarCabeceras(hojaFotos);

  } catch (err) {
    resultado.ok = false;
    resultado.error = err.message;
    return resultado;
  }

  resultado.instrucciones = 'Copia estos IDs en Config.js (CARPETA_ORIGINALES_ENTRADA_ID, CARPETA_ORIGINALES_PROCESADOS_ID, ' +
    'CARPETA_FOTOS_ENTRADA_ID, CARPETA_FOTOS_PROCESADOS_ID, CARPETA_DESCARTADOS_ID) y vuelve a desplegar.';
  return resultado;
}

function obtenerOCrearSubcarpeta_(carpetaPadre, nombre, props, clavePropiedad, resultado) {
  let id = props.getProperty(clavePropiedad);
  if (id) {
    try { DriveApp.getFolderById(id); return id; } catch (e) { id = null; }
  }
  const it = carpetaPadre.getFoldersByName(nombre);
  const carpeta = it.hasNext() ? it.next() : carpetaPadre.createFolder(nombre);
  props.setProperty(clavePropiedad, carpeta.getId());
  resultado.pasos.push('Carpeta "' + nombre + '" lista (' + carpeta.getId() + ')');
  return carpeta.getId();
}

// ============================================================
// VACIADO TOTAL (destructivo) -- borra TODAS las filas de ambas pestañas
// y envia TODOS los archivos de las 5 carpetas a la papelera de Drive.
// Requiere ?confirmar=SI explicito para evitar un vaciado accidental.
// ============================================================

function vaciarTodo_(confirmar) {
  if (confirmar !== 'SI') {
    return { ok: false, error: 'Accion destructiva: borra TODAS las filas y TODOS los archivos. Pasa &confirmar=SI para confirmar.' };
  }

  const resultado = { ok: true, hojas: {}, carpetas: {} };

  TIPOS_VOUCHER.forEach(function (tipo) {
    const carpetas = carpetasParaTipo_(tipo);

    try {
      const hoja = obtenerHoja(carpetas.hojaNombre);
      const ultimaFila = hoja.getLastRow();
      if (ultimaFila > 1) {
        hoja.getRange(2, 1, ultimaFila - 1, Math.max(hoja.getLastColumn(), 1)).clearContent();
      }
      resultado.hojas[carpetas.hojaNombre] = { filasBorradas: Math.max(ultimaFila - 1, 0) };
    } catch (err) {
      resultado.hojas[carpetas.hojaNombre] = { error: err.message };
    }

    [carpetas.entrada, carpetas.procesados].forEach(function (folderId) {
      resultado.carpetas[folderId] = vaciarCarpeta_(folderId);
    });
  });

  resultado.carpetas[CFG.CARPETA_DESCARTADOS_ID] = vaciarCarpeta_(CFG.CARPETA_DESCARTADOS_ID);

  reiniciarEstadoFormato_();
  return resultado;
}

function vaciarCarpeta_(folderId) {
  try {
    const carpeta = DriveApp.getFolderById(folderId);
    let borrados = 0;
    const it = carpeta.getFiles();
    while (it.hasNext()) { it.next().setTrashed(true); borrados++; }
    return { archivosBorrados: borrados };
  } catch (err) {
    return { error: err.message };
  }
}

// Comparacion que no corta al primer caracter distinto, para no filtrar
// informacion del token por diferencias de tiempo de respuesta.
function tokensIguales_(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return dif === 0;
}

function respuestaJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// DIAGNOSTICO COMPLETO
// ============================================================

function diagnosticoCompleto_() {
  const props = PropertiesService.getScriptProperties();
  const r = {
    ok: true,
    revisadoEn: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
    zonaHoraria: Session.getScriptTimeZone(),
    carpetas: {},
    hoja: {},
    credenciales: {},
    triggers: {},
    telegram: {},
    problemas: []
  };

  // --- Carpetas de Drive ---
  const carpetas = {
    originales_entrada:    CFG.CARPETA_ORIGINALES_ENTRADA_ID,
    originales_procesados: CFG.CARPETA_ORIGINALES_PROCESADOS_ID,
    fotos_entrada:         CFG.CARPETA_FOTOS_ENTRADA_ID,
    fotos_procesados:      CFG.CARPETA_FOTOS_PROCESADOS_ID,
    descartados:           CFG.CARPETA_DESCARTADOS_ID
  };
  Object.keys(carpetas).forEach(function (clave) {
    if (!carpetas[clave]) {
      r.carpetas[clave] = { ok: false, error: 'ID no configurado en Config.js' };
      r.problemas.push('Carpeta "' + clave + '" no configurada. Corre la accion migrar-v2.');
      return;
    }
    try {
      const carpeta = DriveApp.getFolderById(carpetas[clave]);
      let archivos = 0;
      const it = carpeta.getFiles();
      while (it.hasNext() && archivos < 500) { it.next(); archivos++; }
      r.carpetas[clave] = { ok: true, nombre: carpeta.getName(), archivos: archivos };
    } catch (err) {
      r.carpetas[clave] = { ok: false, error: err.message };
      r.problemas.push('Carpeta "' + clave + '" inaccesible: ' + err.message);
    }
  });

  // --- Hojas de calculo (Originales y Fotos) ---
  r.hoja = {};
  TIPOS_VOUCHER.forEach(function (tipo) {
    const nombrePestana = carpetasParaTipo_(tipo).hojaNombre;
    try {
      const hoja = obtenerHoja(nombrePestana);
      if (!hoja) {
        r.hoja[nombrePestana] = { ok: false, error: 'No existe una pestana llamada "' + nombrePestana + '"' };
        r.problemas.push('No se encontro la pestana "' + nombrePestana + '" en la hoja.');
        return;
      }
      const ultimaFila = hoja.getLastRow();
      const cabeceras = ultimaFila >= 1
        ? hoja.getRange(1, 1, 1, Math.max(hoja.getLastColumn(), 1)).getValues()[0]
        : [];
      r.hoja[nombrePestana] = {
        ok: true,
        nombreArchivo: hoja.getParent().getName(),
        pestana: hoja.getName(),
        filasConDatos: Math.max(ultimaFila - 1, 0),
        columnas: hoja.getLastColumn(),
        tieneColumnaTelegram: cabeceras.indexOf('Enviado por Telegram') !== -1
      };
      if (!r.hoja[nombrePestana].tieneColumnaTelegram) {
        r.problemas.push('Falta la cabecera "Enviado por Telegram" en la pestana "' + nombrePestana + '".');
      }
    } catch (err) {
      r.hoja[nombrePestana] = { ok: false, error: err.message };
      r.problemas.push('Pestana "' + nombrePestana + '" inaccesible: ' + err.message);
    }
  });

  // --- Credenciales (solo se informa si existen, NUNCA su valor) ---
  r.credenciales = {
    geminiConfigurada:   !!props.getProperty('GEMINI_API_KEY'),
    telegramConfigurado: !!props.getProperty('TELEGRAM_BOT_TOKEN'),
    secretoWebhook:      !!props.getProperty('TELEGRAM_WEBHOOK_SECRET'),
    chatsAutorizados:    CFG.TELEGRAM_ALLOWED_CHAT_IDS.length
  };
  if (!r.credenciales.geminiConfigurada)   r.problemas.push('Falta configurar la API Key de Gemini.');
  if (!r.credenciales.telegramConfigurado) r.problemas.push('Falta configurar el token del bot de Telegram.');
  if (r.credenciales.telegramConfigurado && r.credenciales.chatsAutorizados === 0) {
    r.problemas.push('El bot no tiene chats autorizados: cualquiera podria enviarle vouchers.');
  }

  // --- Triggers ---
  try {
    const triggers = ScriptApp.getProjectTriggers();
    r.triggers = {
      procesamiento: triggers.filter(function (t) { return t.getHandlerFunction() === 'procesarVouchers'; }).length,
      reparacion:    triggers.filter(function (t) { return t.getHandlerFunction() === 'repararImagenesFaltantes'; }).length
    };
    if (r.triggers.procesamiento === 0) {
      r.problemas.push('No hay trigger automatico de procesamiento activo (PDFs largos no se reanudarian solos).');
    }
  } catch (err) {
    r.triggers = { error: err.message };
  }

  // --- Estado del webhook de Telegram (lo reporta la propia API de Telegram) ---
  if (CFG.TELEGRAM_BOT_TOKEN) {
    try {
      const resp = UrlFetchApp.fetch(
        'https://api.telegram.org/bot' + CFG.TELEGRAM_BOT_TOKEN + '/getWebhookInfo',
        { muteHttpExceptions: true }
      );
      const info = JSON.parse(resp.getContentText());
      if (info.ok) {
        r.telegram = {
          ok: true,
          webhookActivo:         !!info.result.url,
          mensajesPendientes:    info.result.pending_update_count || 0,
          ultimoError:           info.result.last_error_message || null,
          ultimoErrorFecha:      info.result.last_error_date
            ? Utilities.formatDate(new Date(info.result.last_error_date * 1000), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')
            : null
        };
        if (!r.telegram.webhookActivo) r.problemas.push('El webhook de Telegram no esta registrado.');
        if (r.telegram.ultimoError)    r.problemas.push('Telegram reporta un error reciente: ' + r.telegram.ultimoError);
      } else {
        r.telegram = { ok: false, error: info.description };
        r.problemas.push('Telegram rechazo la consulta: ' + info.description);
      }
    } catch (err) {
      r.telegram = { ok: false, error: err.message };
    }
  } else {
    r.telegram = { ok: false, error: 'Bot no configurado' };
  }

  r.ok = r.problemas.length === 0;
  return r;
}

// ============================================================
// CARPETAS DE DRIVE
// ============================================================

function listarCarpetas_() {
  const claves = {
    originales_entrada:    CFG.CARPETA_ORIGINALES_ENTRADA_ID,
    originales_procesados: CFG.CARPETA_ORIGINALES_PROCESADOS_ID,
    fotos_entrada:         CFG.CARPETA_FOTOS_ENTRADA_ID,
    fotos_procesados:      CFG.CARPETA_FOTOS_PROCESADOS_ID,
    descartados:           CFG.CARPETA_DESCARTADOS_ID
  };
  const resultado = {};
  let todoBien = true;

  Object.keys(claves).forEach(function (clave) {
    try {
      const carpeta = DriveApp.getFolderById(claves[clave]);
      const archivos = [];
      const it = carpeta.getFiles();
      while (it.hasNext() && archivos.length < 100) {
        const f = it.next();
        archivos.push({
          nombre: f.getName(),
          mb: Math.round((f.getSize() / (1024 * 1024)) * 10) / 10,
          modificado: Utilities.formatDate(f.getLastUpdated(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
        });
      }
      const enPapelera = carpeta.isTrashed();
      resultado[clave] = { ok: !enPapelera, id: claves[clave], nombre: carpeta.getName(), enPapelera: enPapelera, totalArchivos: archivos.length, archivos: archivos };
      if (enPapelera) todoBien = false;
    } catch (err) {
      resultado[clave] = { ok: false, id: claves[clave], error: err.message };
      todoBien = false;
    }
  });

  return { ok: todoBien, carpetas: resultado };
}

// Repara carpetas: si una esta en la papelera la restaura. Si el ID esta
// vacio o ya no existe, no crea una suelta (perderia su lugar en el arbol
// Originales/Fotos) -- avisa a correr "migrar-v2" en su lugar, que crea las
// carpetas faltantes en la posicion correcta dentro de la carpeta raiz.
function crearCarpetasFaltantes_() {
  const claves = {
    originales_entrada:    CFG.CARPETA_ORIGINALES_ENTRADA_ID,
    originales_procesados: CFG.CARPETA_ORIGINALES_PROCESADOS_ID,
    fotos_entrada:         CFG.CARPETA_FOTOS_ENTRADA_ID,
    fotos_procesados:      CFG.CARPETA_FOTOS_PROCESADOS_ID,
    descartados:           CFG.CARPETA_DESCARTADOS_ID
  };
  const resultado = {};
  let necesitaMigrarV2 = false;

  Object.keys(claves).forEach(function (clave) {
    if (!claves[clave]) {
      resultado[clave] = { accion: 'ID no configurado -- corre la accion migrar-v2' };
      necesitaMigrarV2 = true;
      return;
    }
    try {
      const carpeta = DriveApp.getFolderById(claves[clave]);
      if (carpeta.isTrashed()) {
        carpeta.setTrashed(false);
        resultado[clave] = { accion: 'restaurada de la papelera', id: claves[clave], nombre: carpeta.getName() };
      } else {
        resultado[clave] = { accion: 'ya existia', id: claves[clave], nombre: carpeta.getName() };
      }
    } catch (err) {
      resultado[clave] = { accion: 'ID invalido -- corre la accion migrar-v2', idAnterior: claves[clave] };
      necesitaMigrarV2 = true;
    }
  });

  return { ok: !necesitaMigrarV2, necesitaMigrarV2: necesitaMigrarV2, carpetas: resultado };
}

// ============================================================
// CONSULTAS SOBRE LA HOJA
// ============================================================

function ultimasFilas_(n, pestana) {
  const hoja = obtenerHoja(pestana);
  if (!hoja) return { ok: false, error: 'Hoja no encontrada' };

  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return { ok: true, filas: [], mensaje: 'La hoja aun no tiene datos.' };

  const cantidad = Math.min(n, ultimaFila - 1, 50);
  const inicio   = ultimaFila - cantidad + 1;
  const datos    = hoja.getRange(inicio, 1, cantidad, 14).getValues();

  return {
    ok: true,
    totalFilas: ultimaFila - 1,
    filas: datos.map(function (fila, i) {
      return {
        numeroFila:  inicio + i,
        fecha:       formatearValor_(fila[0]),
        nOperacion:  fila[1],
        banco:       fila[2],
        moneda:      fila[3],
        monto:       fila[4],
        proveedor:   fila[5],
        cliente:     fila[7],
        // La columna J trae la imagen: reportamos el TIPO, no el contenido.
        imagen:      describirCeldaImagen_(fila[9]),
        archivo:     fila[10],
        procesadoEn: formatearValor_(fila[11]),
        pagina:      fila[12],
        origen:      fila[13]
      };
    })
  };
}

function filasConProblema_(pestana) {
  const hoja = obtenerHoja(pestana);
  if (!hoja) return { ok: false, error: 'Hoja no encontrada' };

  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return { ok: true, problemas: [], mensaje: 'La hoja aun no tiene datos.' };

  const datos = hoja.getRange(2, 1, ultimaFila - 1, 14).getValues();
  const problemas = [];
  let imagenesFaltantes = 0;

  for (let i = 0; i < datos.length; i++) {
    const fila       = datos[i];
    const nOperacion = String(fila[1] || '');
    const imagen     = fila[9];

    const esMarcaError = nOperacion.indexOf('[ERROR]') === 0 ||
                         nOperacion.indexOf('[OMITIDO]') === 0 ||
                         nOperacion.indexOf('[ARCHIVO GRANDE]') === 0;

    if (typeof imagen === 'string' && imagen.indexOf('Ver PDF') === 0) imagenesFaltantes++;

    if (esMarcaError) {
      problemas.push({
        numeroFila: i + 2,
        marca:      nOperacion,
        detalle:    fila[5],   // en estas filas el detalle se guarda en "proveedor"
        archivo:    fila[10],
        pagina:     fila[12],
        origen:     fila[13]
      });
    }
  }

  return {
    ok: problemas.length === 0 && imagenesFaltantes === 0,
    totalFilas: ultimaFila - 1,
    filasConError: problemas.length,
    imagenesFaltantes: imagenesFaltantes,
    // Solo las ultimas 25 para que la respuesta no crezca sin control.
    problemas: problemas.slice(-25)
  };
}

function describirCeldaImagen_(valor) {
  if (valor && typeof valor === 'object') return 'imagen insertada';
  if (typeof valor === 'string' && valor.indexOf('Ver PDF') === 0) return 'FALTA (quedo como texto)';
  if (!valor) return 'vacio';
  return String(valor).substring(0, 40);
}

function formatearValor_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return v;
}

// ============================================================
// EJECUCION REMOTA DEL PROCESAMIENTO
// ============================================================

function ejecutarProcesamiento_() {
  const antes = filasTotalesAmbasPestanas_();

  const inicio = Date.now();
  let error = null;

  try {
    // procesarVouchers es async por pdf-lib; el motor de Apps Script
    // resuelve la promesa dentro de la misma invocacion.
    procesarVouchers();
  } catch (err) {
    error = err.message;
  }

  const despues = filasTotalesAmbasPestanas_();

  return {
    ok: !error,
    error: error,
    filasAntes: Math.max(antes - 1, 0),
    filasDespues: Math.max(despues - 1, 0),
    filasNuevas: Math.max(despues - antes, 0),
    duracionSegundos: Math.round((Date.now() - inicio) / 1000)
  };
}

// ============================================================
// CONFIGURACION DEL DIAGNOSTICO (desde el menu)
// ============================================================

function configurarDiagnosticoRemoto() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  let token = props.getProperty('DIAG_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    props.setProperty('DIAG_TOKEN', token);
  }

  const webAppUrl = ScriptApp.getService().getUrl();
  if (!webAppUrl) {
    ui.alert('Primero implementa el proyecto como Aplicacion Web:\n' +
             'Implementar > Nueva implementacion > Tipo: Aplicacion web.\n' +
             'Luego vuelve a ejecutar esta opcion.');
    return;
  }

  ui.alert(
    'Diagnostico remoto activado',
    'URL de diagnostico (guardala, es como una contrasena):\n\n' +
    webAppUrl + '?token=' + token + '&accion=diagnostico\n\n' +
    'Otras acciones: cambia "diagnostico" por "ultimas", "errores" o "procesar".\n\n' +
    'Cualquiera con esta URL puede consultar el estado y disparar el ' +
    'procesamiento, pero NO puede ver tus claves ni entrar a tu cuenta de Google. ' +
    'Para cortar el acceso usa "Desactivar diagnostico remoto".',
    ui.ButtonSet.OK
  );
}

function desactivarDiagnosticoRemoto() {
  const ui = SpreadsheetApp.getUi();
  PropertiesService.getScriptProperties().deleteProperty('DIAG_TOKEN');
  ui.alert('Diagnostico remoto desactivado. Las URLs anteriores dejaron de funcionar de inmediato.');
}
