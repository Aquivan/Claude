/**
 * Main.gs
 * Orquesta el flujo UNIFICADO: esta hoja es la "hoja de control" para TODAS
 * las empresas (no una hoja por empresa). Los datos de cada empresa NO se
 * guardan aca -- se organizan en Drive, en "SIRE Descargas/<RUC>/Venta o
 * Compra/<Anio>/<NN_Mes>/", exactamente igual que antes (ver DriveOrganizer.gs).
 * Esta hoja solo tiene el menu y (opcionalmente) una pestana de resumen.
 *
 * DOS PASOS SEPARADOS A PROPOSITO -- "ejecutar" y "importar":
 *   1) EJECUTAR dispara el workflow en GitHub, que es quien realmente le
 *      habla a SUNAT (procesa TODAS las empresas activas de empresas.json,
 *      una tras otra). Esto puede tardar varios minutos (mas cuantas mas
 *      empresas/periodos tengas activos) -- Apps Script NO se queda
 *      esperando a que termine, porque Google mata cualquier ejecucion que
 *      pase de 6 minutos (cuentas gratuitas) o 30 minutos (Workspace), y una
 *      corrida de varias empresas facilmente supera eso.
 *   2) IMPORTAR trae a Drive lo que GitHub ya dejo guardado (no vuelve a
 *      hablarle a SUNAT). Se puede disparar de 3 formas -- no hace falta
 *      elegir una sola, las 3 conviven sin problema:
 *        a) A mano, con el menu "4/5/6. Importar resultados".
 *        b) "Seguimiento" automatico (~5 min) despues de usar el menu
 *           "1/2/Ejecutar UNA empresa" de ESTA hoja -- rapido, pero solo se
 *           activa si la corrida la disparaste desde aca.
 *        c) "Importacion automatica periodica" (cada 1/5/10/15/30 min,
 *           activable en el menu) -- revisa sola si hay una corrida nueva y
 *           exitosa en GitHub, sin importar COMO se haya disparado (el menu
 *           de esta hoja, el boton "Run workflow" de GitHub directo -- web o
 *           app movil --, o el cron diario). Garantiza que Drive se
 *           actualice solo pase lo que pase, con el costo de un margen de
 *           espera de hasta ese intervalo.
 *        d) Webhook INSTANTANEO (opcional, ver Webhook.gs) -- en vez de que
 *           esta hoja pregunte cada tanto, GitHub le avisa DIRECTO apenas
 *           termina cada empresa+periodo, e importa al toque (segundos, no
 *           minutos). Es la mas rapida de las 4, pero requiere un paso de
 *           configuracion manual (desplegar una Web App + 2 secrets en
 *           GitHub) que las otras 3 no necesitan.
 *
 * GitHub ademas YA corre el workflow solo todos los dias a las 08:00 hora
 * Peru (ver "schedule" en el .yml) -- en el uso normal del dia a dia ni
 * siquiera hace falta el paso 1 desde aca; ese cron mas cualquiera de las
 * opciones (c) o (d) alcanzan para que todo funcione solo, sin entrar ni a
 * GitHub ni a esta hoja.
 */

// ---------------------------------------------------------------------
// PASO 1: EJECUTAR (dispara el workflow en GitHub)
// ---------------------------------------------------------------------

function menuEjecutarTodas() {
  var periodoActual = periodoActualStr_();
  ejecutarDispatch_({ periodo: '', tipo: 'ambos', modo: 'completo' },
    'Se disparo la corrida para TODAS las empresas activas, cada una con su ' +
    'propio periodo/tipo configurado en empresas.json (igual que el cron diario).',
    [periodoActual]);
}

function menuEjecutarPeriodoEspecifico() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Ejecutar con periodo especifico',
    'Periodo AAAAMM (ej: 202608). Se usa para TODAS las empresas activas,\n' +
    'reemplazando el periodo que cada una tenga en empresas.json:',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var periodo = resp.getResponseText().trim();
  if (!/^\d{6}$/.test(periodo)) { ui.alert('Formato invalido. Usa AAAAMM, ej: 202608.'); return; }
  ejecutarDispatch_({ periodo: periodo, tipo: 'ambos', modo: 'completo' },
    'Se disparo la corrida del periodo ' + periodo + ' para TODAS las empresas activas.',
    [periodo]);
}

function menuEjecutarUnaEmpresa() {
  var ui = SpreadsheetApp.getUi();
  var cfg;
  try {
    cfg = cargarConfigGitHub_();
  } catch (e) {
    ui.alert('Error de configuracion', e.message, ui.ButtonSet.OK);
    return;
  }
  var ruc;
  try {
    ruc = elegirRucEmpresa_(cfg);
  } catch (e) {
    ui.alert('Error leyendo empresas.json de GitHub', e.message, ui.ButtonSet.OK);
    return;
  }
  if (!ruc) return; // cancelado

  var respPeriodo = ui.prompt('Ejecutar UNA empresa (' + ruc + ')',
    'Periodo AAAAMM (ej: 202608), o dejalo vacio para usar el periodo que\n' +
    'esa empresa tiene configurado en empresas.json:', ui.ButtonSet.OK_CANCEL);
  if (respPeriodo.getSelectedButton() !== ui.Button.OK) return;
  var periodo = respPeriodo.getResponseText().trim();
  if (periodo && !/^\d{6}$/.test(periodo)) { ui.alert('Formato invalido. Usa AAAAMM, ej: 202608.'); return; }

  ejecutarDispatch_({ periodo: periodo, tipo: 'ambos', modo: 'completo', ruc: ruc },
    'Se disparo la corrida SOLO para ' + ruc + (periodo ? (', periodo ' + periodo) : ', con su periodo configurado en empresas.json') + '.',
    [periodo || periodoActualStr_()], ruc);
}

function menuEjecutarSoloReintentarFallidas() {
  // Sin seguimiento automatico: este modo no vuelve a pedir el reporte SIRE
  // (no genera nada nuevo para "importar" a Drive), solo reintenta PDF/XML
  // directo en el repo de GitHub -- no hay nada que este sistema deba traer.
  ejecutarDispatch_({ periodo: '', tipo: 'ambos', modo: 'solo-reintentar-fallidas' },
    'Se disparo "solo reintentar fallidas" para TODAS las empresas activas -- ' +
    'NO vuelve a pedirle el reporte a SUNAT, solo reintenta el PDF/XML de los ' +
    'comprobantes que quedaron en FALLO en el ultimo run guardado de cada una.',
    null);
}

/**
 * periodosParaImportar: si se pasa (array de 'AAAAMM'), ademas de disparar el
 * workflow se PROGRAMA un seguimiento automatico (ver programarSeguimiento_)
 * que se fija solo, cada unos minutos, si la corrida ya termino en GitHub, y
 * en cuanto termina importa esos periodos a Drive sin que hagas nada mas --
 * un solo click ejecuta TODO el flujo de punta a punta. Null = no programar
 * seguimiento (ej. "solo reintentar fallidas", que no genera nada que importar).
 * rucFiltro: opcional -- si se paso inputs.ruc (correr UNA sola empresa), el
 * seguimiento automatico importa SOLO esa empresa, no todas las activas.
 */
function ejecutarDispatch_(inputs, mensajeBase, periodosParaImportar, rucFiltro) {
  var ui = SpreadsheetApp.getUi();
  var cfg;
  try {
    cfg = cargarConfigGitHub_();
  } catch (e) {
    ui.alert('Error de configuracion', e.message, ui.ButtonSet.OK);
    return;
  }

  var ahora = new Date().getTime();
  try {
    dispararWorkflowGitHub_(cfg, inputs);
  } catch (e) {
    ui.alert('Error disparando el workflow', e.message, ui.ButtonSet.OK);
    return;
  }

  var mensaje = mensajeBase + '\n\nBuscando el link de la corrida en GitHub (puede tardar unos segundos)...';
  var corrida = buscarCorridaRecienDisparada_(cfg, ahora);
  var seguimientoTexto = periodosParaImportar
    ? ('\n\nSe programo un seguimiento automatico: en cuanto GitHub termine (se revisa ' +
       'solo cada ' + INTERVALO_SEGUIMIENTO_MIN_ + ' minutos), se importa solo a Drive -- ' +
       'no hace falta que hagas nada mas. Mira la pestana "Registro" de esta hoja para ' +
       'ver cuando termine.')
    : '';
  if (corrida) {
    mensaje = mensajeBase + '\n\nCorrida: ' + corrida.html_url + seguimientoTexto;
  } else {
    mensaje = mensajeBase + '\n\nSe disparo correctamente, pero no se encontro el ' +
      'link todavia (GitHub a veces tarda en listarla). Revisa la pestana ' +
      '"Actions" del repo directamente, o usa el menu "7. Ver estado" en un ratito.' + seguimientoTexto;
  }
  if (periodosParaImportar) programarSeguimiento_(periodosParaImportar, rucFiltro || null, ahora);
  ui.alert('Ejecucion disparada', mensaje, ui.ButtonSet.OK);
}

function menuVerEstadoGitHub() {
  var ui = SpreadsheetApp.getUi();
  var cfg;
  try {
    cfg = cargarConfigGitHub_();
  } catch (e) {
    ui.alert('Error de configuracion', e.message, ui.ButtonSet.OK);
    return;
  }
  var corrida;
  try {
    corrida = obtenerUltimaCorridaGitHub_(cfg);
  } catch (e) {
    ui.alert('Error consultando GitHub', e.message, ui.ButtonSet.OK);
    return;
  }
  if (!corrida) { ui.alert('Todavia no hay ninguna corrida de este workflow.'); return; }

  var estado = corrida.status === 'completed'
    ? ('Terminada (' + corrida.conclusion + ')')
    : ('En curso (' + corrida.status + ')');
  ui.alert('Ultima ejecucion en GitHub',
    'Estado: ' + estado + '\n' +
    'Disparada: ' + corrida.event + ' el ' + corrida.created_at + '\n' +
    'Link: ' + corrida.html_url, ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------
// PASO 2: IMPORTAR (trae a Drive lo que GitHub ya proceso, sin hablarle a SUNAT)
// ---------------------------------------------------------------------

function menuImportarPeriodoActual() {
  var rucFiltro = preguntarEmpresaFiltro_();
  if (rucFiltro === null) return; // usuario cancelo
  var hoy = new Date();
  var periodoStr = hoy.getFullYear() + ('' + (hoy.getMonth() + 1)).padStart(2, '0');
  ejecutarImportacion_([periodoStr], true, rucFiltro || undefined);
}

function menuImportarPeriodoEspecifico() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Importar un periodo especifico', 'Periodo AAAAMM (ej: 202608):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var periodo = resp.getResponseText().trim();
  if (!/^\d{6}$/.test(periodo)) { ui.alert('Formato invalido. Usa AAAAMM, ej: 202608.'); return; }
  var rucFiltro = preguntarEmpresaFiltro_();
  if (rucFiltro === null) return;
  ejecutarImportacion_([periodo], true, rucFiltro || undefined);
}

function menuImportarRango() {
  var ui = SpreadsheetApp.getUi();
  var respDesde = ui.prompt('Importar un rango - Paso 1/3', 'Periodo inicial (AAAAMM, ej: 202601):', ui.ButtonSet.OK_CANCEL);
  if (respDesde.getSelectedButton() !== ui.Button.OK) return;
  var desde = respDesde.getResponseText().trim();
  if (!/^\d{6}$/.test(desde)) { ui.alert('Formato invalido. Usa AAAAMM.'); return; }

  var respHasta = ui.prompt('Importar un rango - Paso 2/3', 'Periodo final (AAAAMM, ej: 202612):', ui.ButtonSet.OK_CANCEL);
  if (respHasta.getSelectedButton() !== ui.Button.OK) return;
  var hasta = respHasta.getResponseText().trim();
  if (!/^\d{6}$/.test(hasta)) { ui.alert('Formato invalido. Usa AAAAMM.'); return; }

  var rucFiltro = preguntarEmpresaFiltro_();
  if (rucFiltro === null) return;

  var periodos = rangoPeriodosStr_(desde, hasta);
  if (periodos.length > 24) {
    var confirmar = ui.alert('Rango grande',
      'Vas a importar ' + periodos.length + ' periodos. Puede tardar varios minutos ' +
      '(Apps Script se corta a los 6 min). Si se corta, vuelve a correr con lo que falte.\n\n' +
      'Continuar?', ui.ButtonSet.YES_NO);
    if (confirmar !== ui.Button.YES) return;
  }
  ejecutarImportacion_(periodos, true, rucFiltro || undefined);
}

/**
 * Pregunta al usuario si importar TODAS las empresas o solo una.
 * Retorna: '' (todas), un RUC especifico, o null si cancelo.
 */
function preguntarEmpresaFiltro_() {
  var ui = SpreadsheetApp.getUi();
  var cfg;
  try { cfg = cargarConfigGitHub_(); } catch (e) {
    ui.alert('Error de configuracion', e.message, ui.ButtonSet.OK); return null;
  }
  var empresas;
  try { empresas = listarEmpresasGitHub_(cfg, true); } catch (e) {
    ui.alert('Error leyendo empresas.json', e.message, ui.ButtonSet.OK); return null;
  }
  if (empresas.length === 0) {
    ui.alert('No hay empresas activas en empresas.json.'); return null;
  }

  // Si solo hay una empresa, no preguntar
  if (empresas.length === 1) return '';

  var lista = empresas.map(function(e, i) {
    return (i + 1) + '. ' + e.ruc + ' - ' + e.nombre;
  }).join('\n');

  var resp = ui.prompt(
    'Seleccionar empresa',
    'Empresas activas:\n' + lista + '\n\n' +
    'Escribe el RUC para importar solo esa empresa,\n' +
    'o deja en blanco para importar TODAS:',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;

  var rucIngresado = resp.getResponseText().trim();
  if (!rucIngresado) return ''; // todas

  // Validar que el RUC existe en la lista
  var existe = empresas.some(function(e) { return e.ruc === rucIngresado; });
  if (!existe) {
    ui.alert('El RUC "' + rucIngresado + '" no existe o no esta activo en empresas.json.');
    return null;
  }
  return rucIngresado;
}

/** '202601'..'202612' -> lista de 'AAAAMM' inclusive, cruzando de anio sin problema. */
function rangoPeriodosStr_(desdeStr, hastaStr) {
  var desde = { anio: Number(desdeStr.substring(0, 4)), mes: Number(desdeStr.substring(4, 6)) };
  var hasta = { anio: Number(hastaStr.substring(0, 4)), mes: Number(hastaStr.substring(4, 6)) };
  var inicio = desde.anio * 12 + (desde.mes - 1);
  var fin = hasta.anio * 12 + (hasta.mes - 1);
  if (fin < inicio) throw new Error('El periodo final es anterior al inicial.');
  var periodos = [];
  for (var t = inicio; t <= fin; t++) {
    var anio = Math.floor(t / 12), mes = (t % 12) + 1;
    periodos.push(anio + ('' + mes).padStart(2, '0'));
  }
  return periodos;
}

/**
 * Importa uno o mas periodos a sus carpetas de Drive correspondientes.
 * mostrarResultado: false cuando lo llama una importacion automatica (ahi se
 * loguea en la pestana "Registro" en vez de mostrar un dialogo, porque no hay
 * usuario esperando). rucFiltro: opcional -- si se pasa, importa SOLO esa
 * empresa (aunque haya otras activas); si se omite, importa todas las activas.
 */
function ejecutarImportacion_(periodos, mostrarResultado, rucFiltro) {
  var ui = mostrarResultado ? SpreadsheetApp.getUi() : null;
  var cfg;
  try {
    cfg = cargarConfigGitHub_();
  } catch (e) {
    if (ui) ui.alert('Error de configuracion', e.message, ui.ButtonSet.OK);
    else registrarEnBitacora_('Importacion automatica: ' + e.message);
    return;
  }

  var empresas;
  try {
    empresas = listarEmpresasGitHub_(cfg, true);
    if (rucFiltro) empresas = empresas.filter(function (e) { return e.ruc === rucFiltro; });
  } catch (e) {
    if (ui) ui.alert('Error leyendo empresas.json de GitHub', e.message, ui.ButtonSet.OK);
    else registrarEnBitacora_('Importacion automatica: ' + e.message);
    return;
  }
  if (empresas.length === 0) {
    var msgVacio = rucFiltro
      ? ('La empresa ' + rucFiltro + ' no esta activa (o no existe) en empresas.json.')
      : 'No hay ninguna empresa activa en empresas.json.';
    if (ui) ui.alert(msgVacio); else registrarEnBitacora_(msgVacio);
    return;
  }

  var resumen = [];
  var errores = [];
  var aniosPorRuc = {}; // ruc -> [anios] tocados, para la liquidacion automatica

  empresas.forEach(function (empresa) {
    var tipos = empresa.tipo === 'ambos' ? ['compra', 'venta'] : [empresa.tipo];
    periodos.forEach(function (periodoStr) {
      var anio = Number(periodoStr.substring(0, 4));
      var mes = Number(periodoStr.substring(4, 6));
      tipos.forEach(function (tipo) {
        var etiqueta = empresa.ruc + ' (' + empresa.nombre + ') ' + tipo.toUpperCase() + ' ' + periodoStr;
        try {
          var contenido = leerCsvHistoricoGitHub_(cfg, empresa.ruc, tipo, periodoStr);
          if (!contenido) {
            resumen.push(etiqueta + ': todavia no procesado en GitHub para este periodo, se omite');
            return;
          }
          var nombreTipoCap = tipo === 'venta' ? 'Venta' : 'Compra';
          var carpeta = obtenerCarpetaPeriodo_(empresa.ruc, tipo, anio, mes, empresa.nombre);
          var nombreArchivo = nombreTipoCap + ' ' + periodoStr;
          var ss = obtenerOCrearSpreadsheetEnCarpeta_(carpeta, nombreArchivo);
          var yaExistia = !!ss.getSheetByName('Datos');
          var sheet = obtenerOCrearHoja_(ss, 'Datos');
          escribirDatosEnHoja_(sheet, contenido, tipo);
          agregarLinksR2SiCorresponde_(cfg, sheet, empresa, tipo, periodoStr);
          guardarZipsHistoricosSiCorresponde_(cfg, carpeta, empresa.ruc, tipo, periodoStr);
          limpiarHojasVacias_(ss);
          resumen.push(etiqueta + ': ' + (yaExistia ? 'actualizado' : 'creado') +
            ' (' + (sheet.getLastRow() - 1) + ' filas) -> ' + ss.getUrl());

          if (!aniosPorRuc[empresa.ruc]) aniosPorRuc[empresa.ruc] = [];
          if (aniosPorRuc[empresa.ruc].indexOf(anio) === -1) aniosPorRuc[empresa.ruc].push(anio);
        } catch (e) {
          errores.push(etiqueta + ': ' + e.message);
        }
      });
    });
  });

  // Construir / actualizar Liquidación IGV SIEMPRE de forma 100% automática para cada RUC y año procesado
  Object.keys(aniosPorRuc).forEach(function (ruc) {
    aniosPorRuc[ruc].forEach(function (anio) {
      try {
        var urlLiq = construirLiquidacion_(ruc, anio);
        resumen.push('📊 Liquidación ' + ruc + ' ' + anio + ' actualizada -> ' + urlLiq);
      } catch (e) {
        errores.push('Liquidación ' + ruc + ' ' + anio + ': ' + e.message);
      }
    });
  });

  var mensaje = resumen.join('\n');
  if (errores.length > 0) mensaje += '\n\nERRORES:\n' + errores.join('\n');
  if (!mensaje) mensaje = '(sin resultados)';

  // Actualizar Panel de Control automaticamente para reflejar los nuevos enlaces
  try {
    generarPanelDeControl_();
  } catch (e) {
    Logger.log('No se pudo refrescar el panel de control: ' + e.message);
  }

  if (ui) {
    ui.alert('Importacion terminada', mensaje, ui.ButtonSet.OK);
  } else {
    registrarEnBitacora_('Importacion automatica:\n' + mensaje);
  }
}

/** 'AAAAMM' del mes actual. */
function periodoActualStr_() {
  var hoy = new Date();
  return hoy.getFullYear() + ('' + (hoy.getMonth() + 1)).padStart(2, '0');
}

// ---------------------------------------------------------------------
// Seguimiento automatico despues de "Ejecutar" (menus 1/2) -- para que un
// solo click alcance de punta a punta: dispara el workflow y, sin que hagas
// nada mas, se fija solo cada rato si ya termino y en cuanto termina importa
// a Drive. Usa un trigger de UNA SOLA VEZ (se auto-elimina al dispararse) que
// se reprograma a si mismo mientras la corrida siga en curso, hasta un
// maximo de intentos (para no quedar reintentando para siempre si algo raro
// pasa, ej. la corrida se cancela a mano en GitHub).
// ---------------------------------------------------------------------

var INTERVALO_SEGUIMIENTO_MIN_ = 5;
var MAX_INTENTOS_SEGUIMIENTO_ = 8; // 8 x 5min = hasta 40 minutos de margen

function programarSeguimiento_(periodos, rucFiltro, desdeMs) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SEGUIMIENTO_PERIODOS', JSON.stringify(periodos));
  props.setProperty('SEGUIMIENTO_INTENTOS', '0');
  props.setProperty('SEGUIMIENTO_DESDE', String(desdeMs));
  if (rucFiltro) props.setProperty('SEGUIMIENTO_RUC', rucFiltro);
  else props.deleteProperty('SEGUIMIENTO_RUC');
  reprogramarSeguimiento_();
}

function reprogramarSeguimiento_() {
  // Por si quedo un trigger de un seguimiento anterior sin dispararse (ej.
  // dispariste "Ejecutar" dos veces seguidas) -- se evita duplicar el poll.
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'seguimientoAutomatico_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('seguimientoAutomatico_')
    .timeBased()
    .after(INTERVALO_SEGUIMIENTO_MIN_ * 60 * 1000)
    .create();
}

/** Handler del trigger de una sola vez -- se auto-elimina Apps Script al
 * dispararse, no hace falta borrarlo a mano salvo que se reprograme (arriba). */
function seguimientoAutomatico_() {
  var props = PropertiesService.getScriptProperties();
  var periodosJson = props.getProperty('SEGUIMIENTO_PERIODOS');
  if (!periodosJson) return; // no hay ningun seguimiento pendiente
  var periodos = JSON.parse(periodosJson);
  var intentos = Number(props.getProperty('SEGUIMIENTO_INTENTOS') || '0');
  var desdeMs = Number(props.getProperty('SEGUIMIENTO_DESDE') || '0');

  var cfg;
  try {
    cfg = cargarConfigGitHub_();
  } catch (e) {
    registrarEnBitacora_('Seguimiento automatico: error de configuracion (' + e.message + ')');
    limpiarSeguimiento_();
    return;
  }

  // Se busca especificamente LA corrida que este seguimiento disparo (por
  // fecha de creacion), no "la ultima que sea" -- si en el medio hubo otra
  // corrida disparada por otro lado (cron diario, otra sesion), esa otra
  // corrida NO cuenta como la que estamos esperando.
  var corrida;
  try {
    corrida = buscarCorridaDesde_(cfg, desdeMs);
  } catch (e) {
    registrarEnBitacora_('Seguimiento automatico: error consultando GitHub (' + e.message + ')');
    limpiarSeguimiento_();
    return;
  }

  if (corrida && corrida.status === 'completed') {
    var rucFiltro = props.getProperty('SEGUIMIENTO_RUC') || null;
    limpiarSeguimiento_();
    if (corrida.conclusion !== 'success') {
      // La corrida termino pero con error (ej. fallo real de SUNAT, no solo
      // "0 comprobantes" -- eso ya se maneja como exito). Importar ahora
      // solo traeria lo que YA estaba antes (o nada nuevo) sin avisar del
      // problema real -- mejor avisar y que se revise el link en GitHub.
      registrarEnBitacora_('Corrida terminada en GitHub con ERROR (' + corrida.conclusion + '). ' +
        'NO se importo nada automaticamente -- revisa la corrida: ' + corrida.html_url);
      return;
    }
    registrarEnBitacora_('Corrida terminada en GitHub (exitosa). Importando ' +
      periodos.join(', ') + (rucFiltro ? (' para ' + rucFiltro) : '') + ' a Drive...');
    ejecutarImportacion_(periodos, false, rucFiltro);
    return;
  }

  intentos++;
  if (intentos >= MAX_INTENTOS_SEGUIMIENTO_) {
    registrarEnBitacora_('Seguimiento automatico: la corrida sigue sin terminar despues de ' +
      (INTERVALO_SEGUIMIENTO_MIN_ * MAX_INTENTOS_SEGUIMIENTO_) + ' minutos. Se dejo de reintentar -- ' +
      'usa el menu "4/5/6. Importar resultados" a mano cuando termine.');
    limpiarSeguimiento_();
    return;
  }
  props.setProperty('SEGUIMIENTO_INTENTOS', String(intentos));
  reprogramarSeguimiento_();
}

function limpiarSeguimiento_() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('SEGUIMIENTO_PERIODOS');
  props.deleteProperty('SEGUIMIENTO_INTENTOS');
  props.deleteProperty('SEGUIMIENTO_DESDE');
  props.deleteProperty('SEGUIMIENTO_RUC');
}

/** Agrega una fila con fecha/hora a la pestana "Registro" de esta hoja de
 * control -- asi las acciones automaticas (seguimiento, importacion diaria)
 * quedan visibles sin tener que revisar "Ver > Registros" del editor de
 * Apps Script, que se borra solo y no es facil de encontrar. */
function registrarEnBitacora_(mensaje) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Registro');
  if (!sheet) {
    sheet = ss.insertSheet('Registro');
    sheet.getRange(1, 1, 1, 2).setValues([['Fecha/hora', 'Mensaje']])
      .setFontWeight('bold').setBackground('#305496').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 700);
  }
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 2).setValues([[new Date(), mensaje]]);
  Logger.log(mensaje);
}

// ---------------------------------------------------------------------
// Importacion automatica PERIODICA (trigger instalable, cada 15 minutos) --
// para que Drive se actualice solo pase lo que pase, sin importar como se
// haya disparado la corrida en GitHub (desde el menu "1/2" de esta hoja,
// desde el boton "Run workflow" de GitHub directo, desde el cron diario, o
// desde la app movil de GitHub) -- no depende de que la Sheet haya sido la
// que disparo, a diferencia del "seguimiento" de mas arriba (que es mas
// rapido -- ~5 min -- pero SOLO se activa si vos disparaste desde el menu
// "1/2/Ejecutar UNA empresa" de esta hoja).
//
// Para no reimportar (ni ensuciar la pestana "Registro") cada 15 minutos
// aunque no haya nada nuevo, se guarda el ID de la ultima corrida ya
// importada ("marca de agua") y solo se actua cuando aparece una corrida
// EXITOSA mas nueva que esa.
// ---------------------------------------------------------------------

function buscarTriggerImportacionAutomatica_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importarSiHayCorridaNueva_') return triggers[i];
  }
  return null;
}

// Valores permitidos por Google para timeBased().everyMinutes() -- cualquier
// otro numero tira error al crear el trigger.
var INTERVALOS_VALIDOS_IMPORTACION_ = [1, 5, 10, 15, 30];

function menuActivarImportacionAutomatica() {
  var ui = SpreadsheetApp.getUi();
  var yaActivo = buscarTriggerImportacionAutomatica_();

  var resp = ui.prompt(
    yaActivo ? 'Cambiar el intervalo de la importacion automatica' : 'Activar importacion automatica',
    'Cada cuantos minutos revisa sola si hay algo nuevo en GitHub. Opciones: ' +
    INTERVALOS_VALIDOS_IMPORTACION_.join(', ') + '.\n\n' +
    (yaActivo ? 'Ya esta activada -- escribi un numero para CAMBIAR el intervalo.\n\n' : '') +
    'Para pruebas rapidas, 5 esta bien; para uso normal del dia a dia, 15 o 30 ' +
    'ya alcanza (no hace falta mas seguido).',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var minutos = Number(resp.getResponseText().trim());
  if (INTERVALOS_VALIDOS_IMPORTACION_.indexOf(minutos) === -1) {
    ui.alert('Valor invalido. Tiene que ser exactamente uno de: ' +
      INTERVALOS_VALIDOS_IMPORTACION_.join(', ') + ' (son los unicos que permite Google).');
    return;
  }

  if (yaActivo) ScriptApp.deleteTrigger(yaActivo);
  ScriptApp.newTrigger('importarSiHayCorridaNueva_')
    .timeBased()
    .everyMinutes(minutos)
    .create();
  // Solo para poder mostrarlo despues en "Ver configuracion actual" -- los
  // triggers de Apps Script no exponen su propio intervalo por API una vez
  // creados, asi que se guarda aparte.
  PropertiesService.getScriptProperties().setProperty('IMPORTACION_INTERVALO_MIN', String(minutos));
  ui.alert('Importacion automatica periodica: ACTIVADA (cada ' + minutos + ' min)',
    'Cada ' + minutos + ' minutos, esta hoja va a revisar sola si hay una corrida ' +
    'nueva y exitosa en GitHub (sin importar quien o que la haya disparado -- el ' +
    'menu de esta hoja, GitHub directo, la app movil, o el cron diario) y, ' +
    'si la hay, importa el periodo actual a Drive para todas las empresas ' +
    'activas. No hace falta abrir la hoja ni GitHub para que esto pase, ni ' +
    'usar el menu "4. Importar resultados" a mano nunca mas.\n\n' +
    'Si no hay nada nuevo, no hace nada (no ensucia la pestana "Registro").',
    ui.ButtonSet.OK);
}

function menuDesactivarImportacionAutomatica() {
  var ui = SpreadsheetApp.getUi();
  var trigger = buscarTriggerImportacionAutomatica_();
  if (!trigger) { ui.alert('La importacion automatica periodica ya estaba desactivada.'); return; }
  ScriptApp.deleteTrigger(trigger);
  ui.alert('Importacion automatica periodica: DESACTIVADA.');
}

function importarSiHayCorridaNueva_() {
  var props = PropertiesService.getScriptProperties();
  var cfg;
  try {
    cfg = cargarConfigGitHub_();
  } catch (e) {
    return; // sin config todavia -- no tiene sentido ni loguear cada 15 min
  }

  var corrida;
  try {
    corrida = obtenerUltimaCorridaGitHub_(cfg);
  } catch (e) {
    return; // error de red/GitHub puntual -- se reintenta solo en 15 min
  }
  if (!corrida || corrida.status !== 'completed') return; // nada terminado todavia

  var idVisto = props.getProperty('ULTIMA_CORRIDA_IMPORTADA_ID');
  if (String(corrida.id) === idVisto) return; // ya se importo esta, nada nuevo

  // Se marca como "vista" ANTES de importar (no despues) -- si la corrida
  // fallo, igual no queremos volver a intentar importarla cada 15 minutos
  // por siempre; el aviso de error solo se loguea una vez.
  props.setProperty('ULTIMA_CORRIDA_IMPORTADA_ID', String(corrida.id));

  if (corrida.conclusion !== 'success') {
    registrarEnBitacora_('Importacion periodica: la corrida mas reciente en GitHub ' +
      'termino con ERROR (' + corrida.conclusion + '). No se importo nada -- revisa: ' +
      corrida.html_url);
    return;
  }

  registrarEnBitacora_('Importacion periodica: se detecto una corrida nueva y exitosa en ' +
    'GitHub (' + corrida.html_url + '). Importando periodo actual a Drive...');
  importarPeriodoActualAutomatico_();
}

function importarPeriodoActualAutomatico_() {
  var hoy = new Date();
  var periodoStr = hoy.getFullYear() + ('' + (hoy.getMonth() + 1)).padStart(2, '0');
  ejecutarImportacion_([periodoStr], false);
}

/**
 * Pide por prompt el RUC de la empresa a usar (para las opciones de
 * Liquidacion, que son por empresa) -- muestra la lista de empresas activas
 * de empresas.json para que no haya que memorizar el RUC de memoria. Null si
 * el usuario cancela o escribe algo que no matchea ninguna empresa.
 */
function elegirRucEmpresa_(cfg) {
  var ui = SpreadsheetApp.getUi();
  var empresas = listarEmpresasGitHub_(cfg, false); // todas, activas o no -- puede querer ver la liquidacion de una desactivada
  if (empresas.length === 0) throw new Error('empresas.json no tiene ninguna empresa.');

  var lista = empresas.map(function (e) {
    return e.ruc + ' - ' + e.nombre + (e.activo ? '' : ' (inactiva)');
  }).join('\n');

  if (empresas.length === 1) return empresas[0].ruc;

  var resp = ui.prompt('Elegir empresa',
    'Empresas en empresas.json:\n' + lista + '\n\nEscribe el RUC:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  var ruc = resp.getResponseText().trim();
  var existe = empresas.some(function (e) { return e.ruc === ruc; });
  if (!existe) { ui.alert('Ese RUC no esta en empresas.json.'); return null; }
  return ruc;
}

/**
 * Agrega las columnas "Link PDF"/"Link XML" al final de la hoja "Datos" que
 * acaba de escribir escribirDatosEnHoja_, si (y solo si) esta empresa tiene
 * "subir_pdf_r2": true en empresas.json Y la hoja tiene configurada la URL
 * base de R2 (menu "Configurar Cloudflare R2"). Si falta cualquiera de las
 * dos, no hace nada -- es 100% opcional, no rompe ni ensucia nada del resto
 * del sistema.
 *
 * No hace falta descargar ni subir ningun archivo aca: la URL de cada PDF/
 * XML es PREDECIBLE (GitHub ya los subio a R2 con la misma ruta relativa que
 * tienen en el repo, ver el paso "Subir PDF/XML a Cloudflare R2" del
 * workflow) -- solo se arma el texto del link, sin ninguna llamada de red
 * extra por factura.
 */
function agregarLinksR2SiCorresponde_(cfg, sheet, empresa, tipo, periodoStr) {
  if (!empresa.subir_pdf_r2) return;
  var urlBase = obtenerR2UrlBase_();
  if (!urlBase) return;

  var resumen;
  try {
    resumen = leerResumenHistoricoGitHub_(cfg, empresa.ruc, periodoStr);
  } catch (e) {
    Logger.log('agregarLinksR2SiCorresponde_ (' + empresa.ruc + ' ' + periodoStr + '): ' + e.message);
    return;
  }
  if (!resumen || resumen.length === 0) return;

  var mapa = {};
  resumen.forEach(function (r) {
    if (r.tipo === tipo && r.factura) mapa[r.factura] = r;
  });
  if (Object.keys(mapa).length === 0) return;

  var ultimaFila = sheet.getLastRow();
  var ultimaCol = sheet.getLastColumn();
  if (ultimaFila < 2) return;

  var encabezado = sheet.getRange(1, 1, 1, ultimaCol).getValues()[0];
  var idxSerie = indiceColumnaPorNombre_(encabezado, 'Serie del CDP');
  var idxNumero = indiceColumnaPorNombre_(encabezado, 'Nro CP o Doc. Nro Inicial (Rango)');
  if (idxSerie === -1 || idxNumero === -1) return; // formato inesperado, se omite sin romper nada

  var idxLinkPdf = indiceColumnaPorNombre_(encabezado, 'Link PDF');
  var idxLinkXml = indiceColumnaPorNombre_(encabezado, 'Link XML');
  var colPdf = idxLinkPdf !== -1 ? (idxLinkPdf + 1) : (ultimaCol + 1);
  var colXml = idxLinkXml !== -1 ? (idxLinkXml + 1) : (idxLinkPdf !== -1 ? idxLinkPdf + 2 : ultimaCol + 2);
  var totalColsFinal = Math.max(ultimaCol, colXml);

  var datos = sheet.getRange(2, 1, ultimaFila - 1, ultimaCol).getValues();
  var valoresPdf = [], valoresXml = [];

  datos.forEach(function (fila) {
    var factura = String(fila[idxSerie] || '').trim() + '-' + String(fila[idxNumero] || '').trim();
    var r = mapa[factura];
    var urlPdf = r && r.archivoPdf ? (urlBase + '/' + empresa.ruc + '/' + r.archivoPdf) : '';
    var urlXml = r && r.archivoXml ? (urlBase + '/' + empresa.ruc + '/' + r.archivoXml) : '';
    valoresPdf.push([urlPdf ? '=HYPERLINK("' + urlPdf + '", "Abrir PDF")' : '']);
    valoresXml.push([urlXml ? '=HYPERLINK("' + urlXml + '", "Abrir XML")' : '']);
  });

  sheet.getRange(1, colPdf).setValue('Link PDF')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#305496');
  sheet.getRange(1, colXml).setValue('Link XML')
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#305496');
  sheet.getRange(2, colPdf, valoresPdf.length, 1).setValues(valoresPdf);
  sheet.getRange(2, colXml, valoresXml.length, 1).setValues(valoresXml);
  sheet.setColumnWidth(colPdf, 90);
  sheet.setColumnWidth(colXml, 90);

  // El autofiltro que ya creo escribirDatosEnHoja_ se recrea para que las incluya.
  var filtroExistente = sheet.getFilter();
  if (filtroExistente) filtroExistente.remove();
  sheet.getRange(1, 1, ultimaFila, totalColsFinal).createFilter();
}

/**
 * Guarda en la carpeta de Drive del periodo (la misma donde vive la hoja
 * "Compra/Venta <periodo>") el .zip crudo tal cual lo entrego SUNAT -- hasta
 * 2 archivos por periodo+tipo: "Propuesta <periodo>.zip" (si el periodo
 * todavia no estaba presentado cuando se descargo) y/o "Aceptada
 * <periodo>.zip" (si ya estaba presentado). Cada uno se reemplaza a si
 * mismo en cada importacion -- no se acumulan copias viejas de la MISMA
 * version, pero las dos (propuesta y aceptada) conviven si ambas existen
 * (por ejemplo, se descargo cuando era propuesta y despues, ya presentado,
 * se volvio a importar). Si GitHub no tiene guardada alguna de las 2 (lo
 * normal: un periodo casi siempre es una sola de las dos), esa simplemente
 * no aparece, sin error.
 */
function guardarZipsHistoricosSiCorresponde_(cfg, carpeta, ruc, tipo, periodoStr) {
  ['Propuesta', 'Aceptada'].forEach(function (etiqueta) {
    var rutaGitHub = 'sire/' + ruc + '/historico/' + periodoStr + '/' + etiqueta + '_' + tipo + '.zip';
    var nombreDrive = etiqueta + ' ' + periodoStr + '.zip';
    var blob;
    try {
      blob = leerArchivoBinarioGitHub_(cfg, rutaGitHub, nombreDrive);
    } catch (e) {
      Logger.log('guardarZipsHistoricosSiCorresponde_ (' + ruc + ' ' + periodoStr + ' ' + tipo +
        '/' + etiqueta + '): ' + e.message);
      return;
    }
    if (!blob) return; // no existe esa version para este periodo/tipo, normal
    guardarArchivoEnCarpeta_(carpeta, nombreDrive, blob);
  });
}

/** Indice de columna 1-indexado por nombre de encabezado (tolerante a
 * acentos/mayus-minus/espacios extra, ver normalizarTexto_ en
 * ExcelHelper.gs). -1 si no se encuentra. */
function indiceColumnaPorNombre_(encabezado, nombre) {
  var objetivo = normalizarTexto_(nombre);
  for (var i = 0; i < encabezado.length; i++) {
    if (normalizarTexto_(encabezado[i]) === objetivo) return i;
  }
  return -1;
}

/**
 * Si ya existe una hoja con ese nombre (misma empresa+tipo+periodo de una
 * corrida anterior), la limpia y la reutiliza en vez de crear una nueva --
 * asi importar el mismo periodo dos veces actualiza los datos en el mismo
 * lugar en vez de ir acumulando hojas duplicadas.
 */
function obtenerOCrearHoja_(ss, nombre) {
  nombre = nombre.substring(0, 100); // limite de nombre de hoja en Sheets
  var sheet = ss.getSheetByName(nombre);
  if (sheet) {
    sheet.clear(); // borra contenido y formato, para escribir todo de nuevo limpio
    return sheet;
  }
  return ss.insertSheet(nombre);
}
