// ============================================================
// CONFIGURACION
// ------------------------------------------------------------
// Los IDs de carpetas/hoja quedan aqui (no son secretos). El API Key de
// Gemini y el token del bot de Telegram SIEMPRE se leen desde
// Script Properties (Extensiones > Propiedades del proyecto > Propiedades
// del script), nunca hardcodeados, para que nunca queden expuestos si el
// codigo se comparte o se sube a un repositorio.
//
// Usa el menu "Configurar API Key de Gemini" y "Configurar Bot de
// Telegram" para guardarlos la primera vez.
// ============================================================

function CFG_() {
  const props = PropertiesService.getScriptProperties();
  const chatIds = (props.getProperty('TELEGRAM_ALLOWED_CHAT_IDS') || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

  return {
    // --- Estructura de carpetas v2: Originales (comprobantes formales /
    // PDF) y Fotos (fotos de comprobante) por separado, cada una con su
    // propia bandeja de Entrada y Procesados. Descartados es compartida
    // (vacios/duplicados/archivos muy pesados de cualquiera de los dos
    // tipos). Los IDs reales se generan una sola vez con la accion
    // "migrar-v2" del endpoint de diagnostico y se pegan aqui.
    CARPETA_ORIGINALES_ENTRADA_ID:    '1GqjydN2oOYhwDvxPmZtr9TEJgjP65i2g',
    CARPETA_ORIGINALES_PROCESADOS_ID: '1FM3wLUAGcFD5_yGiOuhLzLpAL9Sc7ki2',
    CARPETA_FOTOS_ENTRADA_ID:         '12si83gUAbe5kqbFopbMrFkdD3EvBsA72',
    CARPETA_FOTOS_PROCESADOS_ID:      '1RCiyPbj-s2k5ou8TQ3UIBA9vu6kUo3vE',
    CARPETA_DESCARTADOS_ID:           '1ssCkvGRm724X3wEnORCVK2nMSWXaRPLT',

    SPREADSHEET_ID:        '1CS0GZiKclm2SroNgrpiBZsavYVobqBv9rgKzjQDII1c',
    // Dos pestañas: una por tipo de comprobante. Duplicados se detectan
    // POR PESTAÑA (un mismo voucher subido como original y como foto no se
    // marca duplicado entre si).
    SHEET_ORIGINALES:      'Originales',
    SHEET_FOTOS:           'Fotos',

    API_KEY:               props.getProperty('GEMINI_API_KEY') || '',
    MODELO_GEMINI:         'gemini-3.6-flash',

    // Pausa entre LOTES de paginas de PDF (ya no es por pagina individual,
    // ver PAGINAS_POR_LOTE abajo). Si empiezan a salir errores 429 en el
    // log, sube este valor a 2000 o 2500. Si todo va limpio, puedes bajarlo.
    PAUSA_MS:              1200,

    // Cuantas paginas de un PDF se mandan JUNTAS en una sola llamada a
    // Gemini, en vez de una llamada por pagina. Gemini soporta documentos
    // de hasta 1000 paginas en una sola llamada, asi que agrupar es
    // seguro; se deja en 5 como numero conservador (menos llamadas =
    // menos tiempo Y menos riesgo de toparse con el limite de peticiones
    // por minuto de la cuenta gratuita de Gemini). Si mas adelante se
    // pasa a una cuenta de pago con mas cuota, se puede subir sin riesgo.
    PAGINAS_POR_LOTE:      5,

    // Limite interno de ejecucion. Google corta a los 6 min (360000 ms).
    // Dejamos margen de seguridad.
    LIMITE_TIEMPO_MS:      310000,

    // Limite de tiempo para el procesamiento SINCRONO disparado desde el
    // webhook de Telegram. Se mantiene mas corto que LIMITE_TIEMPO_MS para
    // no dejar la conexion HTTP con Telegram colgada demasiado tiempo.
    LIMITE_TIEMPO_TELEGRAM_MS: 240000,

    // Archivos mas pesados que esto se apartan en vez de romper la ejecucion.
    MAX_MB_ARCHIVO:        45,

    // --- Telegram ---
    TELEGRAM_BOT_TOKEN:        props.getProperty('TELEGRAM_BOT_TOKEN') || '',
    TELEGRAM_WEBHOOK_SECRET:   props.getProperty('TELEGRAM_WEBHOOK_SECRET') || '',
    TELEGRAM_ALLOWED_CHAT_IDS: chatIds,
    // Telegram Bot API solo permite descargar archivos de hasta 20 MB via getFile.
    TELEGRAM_MAX_MB_ARCHIVO: 20,
  };
}

const CFG = CFG_();

// Los dos tipos de voucher que maneja el sistema. Cada uno tiene su propia
// carpeta de Entrada/Procesados y su propia pestaña en el Sheet.
const TIPOS_VOUCHER = ['original', 'foto'];

// Devuelve, para un tipo dado, a que carpetas y pestaña debe ir el archivo.
function carpetasParaTipo_(tipo) {
  return tipo === 'original'
    ? {
        tipo:       'original',
        entrada:    CFG.CARPETA_ORIGINALES_ENTRADA_ID,
        procesados: CFG.CARPETA_ORIGINALES_PROCESADOS_ID,
        hojaNombre: CFG.SHEET_ORIGINALES
      }
    : {
        tipo:       'foto',
        entrada:    CFG.CARPETA_FOTOS_ENTRADA_ID,
        procesados: CFG.CARPETA_FOTOS_PROCESADOS_ID,
        hojaNombre: CFG.SHEET_FOTOS
      };
}
