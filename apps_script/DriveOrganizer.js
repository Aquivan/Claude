/**
 * DriveOrganizer.gs
 * Crea/reutiliza la estructura de carpetas en Google Drive, espejo de la
 * version Python: <Raiz>/<RUC>/Venta|Compra/<Anio>/<NN_Mes>/. Dentro de cada
 * carpeta de mes se guarda UN SOLO archivo (Google Sheet) por tipo -- si ya
 * existe uno de una corrida anterior para ese mismo periodo, se reutiliza y
 * actualiza en su lugar, en vez de ir acumulando copias.
 *
 * La carpeta de RUC evita que se mezclen/pisen los datos de distintas
 * empresas si usas este mismo proyecto con credenciales de otro RUC en algun
 * momento -- cada RUC tiene su propia rama, nunca chocan entre si.
 */

var NOMBRE_CARPETA_RAIZ_ = 'SIRE Descargas';
var MESES_CARPETA_ = [
  '01_Enero', '02_Febrero', '03_Marzo', '04_Abril', '05_Mayo', '06_Junio',
  '07_Julio', '08_Agosto', '09_Setiembre', '10_Octubre', '11_Noviembre', '12_Diciembre',
];

/** Busca una subcarpeta por nombre dentro de 'padre'; la crea si no existe. */
function obtenerOCrearCarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  while (it.hasNext()) {
    var candidata = it.next();
    // Se ignoran las que estan en la Papelera (eliminadas desde Drive, no
    // borradas para siempre) -- si no, la busqueda "encuentra" una carpeta
    // invisible en Drive y nunca crea una nueva visible.
    if (!candidata.isTrashed()) return candidata;
  }
  return padre.createFolder(nombre);
}

function obtenerCarpetaRaiz_() {
  return obtenerOCrearCarpeta_(DriveApp.getRootFolder(), NOMBRE_CARPETA_RAIZ_);
}

/**
 * Carpeta especifica del RUC, dentro de la raiz.
 * Formato: "<RUC> - <NOMBRE_EMPRESA>" si se conoce el nombre, o "<RUC>" si no.
 *
 * LOGICA DE BUSQUEDA (en orden de prioridad):
 *   1. Por ID guardado en Script Properties -- rapido, seguro para renombrar.
 *      Se valida que la carpeta NO este en la Papelera Y que ESTE dentro de
 *      'raiz' (si el usuario borro 'raiz' y la recreo, la carpeta vieja tiene
 *      otro padre y no debe usarse).
 *   2. Por nombre exacto dentro de 'raiz' usando getFoldersByName -- busca
 *      el formato nuevo ("RUC - Nombre") y el formato antiguo ("RUC" suelto).
 *      getFoldersByName NO devuelve carpetas trashadas, lo que lo hace fiable.
 *   3. Crear la carpeta nueva si no se encontro ninguna.
 *
 * En cualquier caso en que el ID guardado no sirva se limpia el Property para
 * que el siguiente intento no lo reutilice.
 */
function obtenerCarpetaRUC_(raiz, ruc, nombreEmpresa) {
  var props = PropertiesService.getScriptProperties();
  var claveId = 'CARPETA_ID_RUC_' + ruc;
  var idGuardado = props.getProperty(claveId);

  var nombreDeseado = String(ruc).trim();
  if (nombreEmpresa) {
    var nombreLimpio = String(nombreEmpresa).trim();
    if (nombreLimpio && nombreLimpio !== ruc) {
      nombreDeseado = ruc + ' - ' + nombreLimpio;
    }
  }

  // --- 1. Busca por ID guardado ---
  if (idGuardado) {
    try {
      var carpetaGuardada = DriveApp.getFolderById(idGuardado);
      var esValida = !carpetaGuardada.isTrashed();

      // Verificar ademas que la carpeta sea hija directa de raiz -- si el
      // usuario borro la carpeta raiz y la recreo, el ID viejo apunta a una
      // carpeta "suelta" que ya no esta dentro del nuevo raiz.
      if (esValida) {
        var padres = carpetaGuardada.getParents();
        var estaEnRaiz = false;
        while (padres.hasNext()) {
          if (padres.next().getId() === raiz.getId()) { estaEnRaiz = true; break; }
        }
        if (!estaEnRaiz) esValida = false;
      }

      if (esValida) {
        // Si el nombre cambio (empresa renombrada), actualiza en Drive.
        if (carpetaGuardada.getName() !== nombreDeseado) {
          carpetaGuardada.setName(nombreDeseado);
        }
        return carpetaGuardada;
      }
    } catch (e) {
      // ID invalido (borrada para siempre u otro error)
    }
    // ID ya no sirve -- eliminarlo para no reutilizarlo.
    props.deleteProperty(claveId);
  }

  // --- 2. Buscar por nombre dentro de raiz (no devuelve trashadas) ---
  // Intenta primero el nombre deseado, luego solo el RUC (formato antiguo).
  var candidatos = [nombreDeseado];
  if (nombreDeseado !== ruc) candidatos.push(ruc);
  for (var i = 0; i < candidatos.length; i++) {
    var it = raiz.getFoldersByName(candidatos[i]);
    while (it.hasNext()) {
      var f = it.next();
      if (f.isTrashed()) continue;
      // Renombrar si encontro el formato antiguo (solo RUC)
      if (f.getName() !== nombreDeseado) f.setName(nombreDeseado);
      props.setProperty(claveId, f.getId());
      return f;
    }
  }

  // --- 3. Crear la carpeta ---
  var carpeta = raiz.createFolder(nombreDeseado);
  props.setProperty(claveId, carpeta.getId());
  return carpeta;
}

/** tipo: 'venta' | 'compra'. Devuelve la carpeta <Raiz>/<RUC - Nombre>/<Tipo>/<Anio>/<NN_Mes>/ */
function obtenerCarpetaPeriodo_(ruc, tipo, anio, mes, nombreEmpresa) {
  var raiz = obtenerCarpetaRaiz_();
  var cRuc = obtenerCarpetaRUC_(raiz, ruc, nombreEmpresa);
  var nombreTipo = tipo === 'venta' ? 'Venta' : 'Compra';
  var cTipo = obtenerOCrearCarpeta_(cRuc, nombreTipo);
  var cAnio = obtenerOCrearCarpeta_(cTipo, String(anio));
  return obtenerOCrearCarpeta_(cAnio, MESES_CARPETA_[mes - 1]);
}

/**
 * Busca una Google Sheet con ese nombre dentro de la carpeta; si existe la
 * abre para reutilizarla/actualizarla, si no la crea y la mueve a esa
 * carpeta (por defecto Apps Script crea los Sheets nuevos sueltos en la raiz
 * de "Mi unidad"). Si por algun motivo hay mas de una con el mismo nombre
 * (no deberia pasar en uso normal), se queda con la primera y manda el resto
 * a la papelera para que no se acumulen duplicados.
 */
function obtenerOCrearSpreadsheetEnCarpeta_(carpeta, nombreArchivo) {
  var it = carpeta.getFilesByName(nombreArchivo);
  var existentes = [];
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) existentes.push(f);  // mismo caso que la carpeta de RUC
  }

  if (existentes.length > 0) {
    for (var i = 1; i < existentes.length; i++) existentes[i].setTrashed(true);
    return SpreadsheetApp.open(existentes[0]);
  }

  var ss = SpreadsheetApp.create(nombreArchivo);
  var archivo = DriveApp.getFileById(ss.getId());
  carpeta.addFile(archivo);
  DriveApp.getRootFolder().removeFile(archivo);
  return ss;
}


/**
 * Guarda un archivo (Blob) dentro de una carpeta, reemplazando cualquier
 * archivo previo con el MISMO nombre -- asi cada vez que se vuelve a
 * importar un periodo, el archivo se actualiza en su lugar en vez de ir
 * acumulando copias viejas. Se usa para los .zip crudos de "Propuesta"/
 * "Aceptada" (ver Main.gs, guardarZipsHistoricosSiCorresponde_).
 */
function guardarArchivoEnCarpeta_(carpeta, nombreArchivo, blob) {
  var it = carpeta.getFilesByName(nombreArchivo);
  while (it.hasNext()) it.next().setTrashed(true);
  return carpeta.createFile(blob.setName(nombreArchivo));
}

/** Borra hojas completamente vacias (ej. la "Sheet1"/"Hoja 1" que Google crea
 * por defecto al hacer SpreadsheetApp.create()), siempre que quede al menos
 * una hoja con datos -- un archivo no puede quedarse sin ninguna hoja. */
function limpiarHojasVacias_(ss) {
  var hojas = ss.getSheets();
  hojas.forEach(function (h) {
    if (ss.getSheets().length > 1 && h.getLastRow() === 0) {
      ss.deleteSheet(h);
    }
  });
}

/**
 * RESTABLECER DRIVE DESDE CERO (Todas o una empresa especifica)
 *
 * Solo limpia las carpetas correspondientes en Google Drive y elimina
 * los identificadores internos guardados (Script Properties).
 * NO reimporta automaticamente para evitar exceder el limite de tiempo de Google.
 *
 * Flujo:
 *   1. Pregunta si se desea restablecer TODAS las empresas o solo UNA (por RUC).
 *   2. Pide confirmacion de seguridad.
 *   3. Manda a la Papelera las carpetas correspondientes en "SIRE Descargas".
 *   4. Limpia los Script Properties asociados (CARPETA_ID_RUC_*).
 *   5. Muestra mensaje de confirmacion.
 */
function menuRestablecerDriveYReimportar() {
  var ui = SpreadsheetApp.getUi();

  // Obtener lista de empresas configuradas
  var cfg = null;
  var empresas = [];
  try {
    cfg = cargarConfigGitHub_();
    empresas = listarEmpresasGitHub_(cfg, false);
  } catch (e) {}

  var textoEmpresas = '';
  if (empresas.length > 0) {
    textoEmpresas = '\n\nEmpresas configuradas:\n' + empresas.map(function(e, i) {
      return (i + 1) + '. ' + e.ruc + ' - ' + e.nombre;
    }).join('\n');
  }

  // --- Paso 1: Preguntar si TODAS o UNA sola ---
  var respRuc = ui.prompt(
    '⚠️ RESTABLECER DRIVE',
    'Elige el alcance de la limpieza:' + textoEmpresas + '\n\n' +
    'Escribe el RUC para restablecer SOLO esa empresa,\n' +
    'o deja en BLANCO para restablecer TODAS las empresas:',
    ui.ButtonSet.OK_CANCEL);

  if (respRuc.getSelectedButton() !== ui.Button.OK) {
    ui.alert('Operacion cancelada.');
    return;
  }

  var rucSeleccionado = respRuc.getResponseText().trim();
  var esTodas = (rucSeleccionado === '');

  // Si especifico RUC, validar formato basico
  if (!esTodas && !/^\d{11}$/.test(rucSeleccionado)) {
    ui.alert('Formato de RUC invalido. Debe tener 11 digitos numericos.');
    return;
  }

  // --- Paso 2: Confirmacion ---
  var mensajeConf = esTodas
    ? 'Se mandaran a la Papelera TODAS las carpetas de empresas en "SIRE Descargas".'
    : 'Se mandara a la Papelera la carpeta de la empresa ' + rucSeleccionado + ' en "SIRE Descargas".';

  var conf = ui.alert(
    '⚠️ CONFIRMACION DE LIMPIEZA',
    mensajeConf + '\n\n' +
    'Los archivos van a la Papelera de Google Drive (no se borran definitivamente).\n' +
    '¿Deseas continuar?',
    ui.ButtonSet.YES_NO);

  if (conf !== ui.Button.YES) {
    ui.alert('Operacion cancelada.');
    return;
  }

  // --- Paso 3: Ejecutar limpieza ---
  var carpetasEliminadas = 0;
  var props = PropertiesService.getScriptProperties();
  var clavesEliminadas = 0;

  try {
    var raiz = obtenerCarpetaRaiz_();
    var idHojaControl = SpreadsheetApp.getActiveSpreadsheet().getId();
    var itCarpetas = raiz.getFolders();

    while (itCarpetas.hasNext()) {
      var c = itCarpetas.next();
      if (c.isTrashed()) continue;

      var nombreCarpeta = c.getName();
      var debeEliminar = false;

      if (esTodas) {
        debeEliminar = true;
      } else {
        // Coincidencia por RUC exacto o "RUC - Nombre"
        if (nombreCarpeta === rucSeleccionado || nombreCarpeta.indexOf(rucSeleccionado) === 0) {
          debeEliminar = true;
        }
      }

      if (debeEliminar) {
        c.setTrashed(true);
        carpetasEliminadas++;
      }
    }

    if (esTodas) {
      // Limpiar archivos sueltos en raiz (excepto la hoja de control)
      var itArchivos = raiz.getFiles();
      while (itArchivos.hasNext()) {
        var f = itArchivos.next();
        if (!f.isTrashed() && f.getId() !== idHojaControl) {
          f.setTrashed(true);
        }
      }

      // Limpiar todas las claves de carpetas
      var todasProps = props.getProperties();
      Object.keys(todasProps).forEach(function(k) {
        if (k.indexOf('CARPETA_ID_RUC_') === 0) {
          props.deleteProperty(k);
          clavesEliminadas++;
        }
      });
    } else {
      // Limpiar solo la clave del RUC seleccionado
      var claveRuc = 'CARPETA_ID_RUC_' + rucSeleccionado;
      if (props.getProperty(claveRuc)) {
        props.deleteProperty(claveRuc);
        clavesEliminadas++;
      }
    }

  } catch (e) {
    ui.alert('Error durante la limpieza: ' + e.message);
    return;
  }

  // --- Paso 4: Mensaje de resultado ---
  var detalle = esTodas
    ? 'Se restablecieron TODAS las empresas.\nCarpetas enviadas a la Papelera: ' + carpetasEliminadas
    : 'Se restablecio la empresa ' + rucSeleccionado + '.\nCarpetas enviadas a la Papelera: ' + carpetasEliminadas;

  ui.alert(
    'Limpieza completada ✓',
    detalle + '\nIDs internos limpiados: ' + clavesEliminadas + '\n\n' +
    'Siguiente paso:\n' +
    'Usa la opcion 5 o 6 del menu para reimportar los periodos deseados.\n' +
    'Las carpetas y hojas se crearan con el nuevo formato y las Notas de Credito resaltadas en rojo.',
    ui.ButtonSet.OK);
}

