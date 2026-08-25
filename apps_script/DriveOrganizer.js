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
 * RESTABLECER DRIVE DESDE CERO
 *
 * Flujo completo:
 *   1. Pide confirmacion (2 veces -- es destructivo).
 *   2. Manda a la Papelera TODA la estructura de carpetas en "SIRE Descargas"
 *      (subcarpetas de RUC, Venta/Compra, anio, mes y los Sheets dentro),
 *      pero SIN tocar la hoja de control (esta hoja) ni los archivos fuera
 *      de SIRE Descargas.
 *   3. Limpia los Script Properties de IDs de carpetas guardados (CARPETA_ID_RUC_*).
 *   4. Pide el rango de periodos a reimportar y lanza la importacion
 *      (identica a la opcion 6 del menu) -- las carpetas y Sheets se recrean
 *      desde cero con el formato y columnas actualizados.
 *
 * Los archivos mandados a Papelera NO se borran definitivamente -- siguen
 * en "Papelera" de Drive y se pueden recuperar si algo salio mal.
 */
function menuRestablecerDriveYReimportar() {
  var ui = SpreadsheetApp.getUi();

  // --- Confirmacion 1 ---
  var conf1 = ui.alert(
    '⚠️  RESTABLECER DRIVE DESDE CERO',
    'Esta accion manda a la Papelera TODA la estructura de carpetas y archivos ' +
    'dentro de "SIRE Descargas" (subcarpetas de RUC, Venta, Compra, años, meses, ' +
    'Google Sheets mensuales).\n\n' +
    'Los archivos van a la PAPELERA (no se borran definitivamente).\n' +
    'Luego puedes reimportar todo con el formato y columnas actualizados.\n\n' +
    '¿Deseas continuar?',
    ui.ButtonSet.YES_NO);
  if (conf1 !== ui.Button.YES) {
    ui.alert('Operacion cancelada.'); return;
  }

  // --- Confirmacion 2 ---
  var conf2 = ui.alert(
    '⚠️  SEGUNDA CONFIRMACION',
    'Se van a enviar a la Papelera TODOS los archivos dentro de "SIRE Descargas".\n' +
    '¿Estas seguro?',
    ui.ButtonSet.YES_NO);
  if (conf2 !== ui.Button.YES) {
    ui.alert('Operacion cancelada.'); return;
  }

  // --- Paso 1: vaciar carpeta raiz ---
  try {
    var raiz = obtenerCarpetaRaiz_();

    // Mandar a Papelera todas las subcarpetas (que contienen los Sheets)
    var itCarpetas = raiz.getFolders();
    var carpetasEliminadas = 0;
    while (itCarpetas.hasNext()) {
      var c = itCarpetas.next();
      if (!c.isTrashed()) { c.setTrashed(true); carpetasEliminadas++; }
    }

    // Mandar a Papelera archivos sueltos dentro de raiz (si los hubiera)
    // EXCEPTO esta hoja de control (no deberia estar dentro de raiz, pero
    // por si acaso se verifica por ID).
    var idHojaControl = SpreadsheetApp.getActiveSpreadsheet().getId();
    var itArchivos = raiz.getFiles();
    while (itArchivos.hasNext()) {
      var f = itArchivos.next();
      if (!f.isTrashed() && f.getId() !== idHojaControl) f.setTrashed(true);
    }

    Logger.log('Eliminadas ' + carpetasEliminadas + ' carpetas de RUC en SIRE Descargas.');
  } catch (e) {
    ui.alert('Error al vaciar carpetas: ' + e.message);
    return;
  }

  // --- Paso 2: limpiar Script Properties de IDs de carpetas ---
  var props = PropertiesService.getScriptProperties();
  var todas = props.getProperties();
  var clavesEliminadas = [];
  Object.keys(todas).forEach(function(k) {
    if (k.indexOf('CARPETA_ID_RUC_') === 0) {
      props.deleteProperty(k);
      clavesEliminadas.push(k);
    }
  });
  Logger.log('Properties limpiados: ' + clavesEliminadas.join(', '));

  ui.alert(
    'Limpieza completada ✓',
    'Se mandaron a la Papelera las carpetas de Drive.\n' +
    'Script Properties de IDs limpiados: ' + clavesEliminadas.length + '\n\n' +
    'A continuacion elige el rango de periodos para reimportar todo desde cero.',
    ui.ButtonSet.OK);

  // --- Paso 3: Reimportar por rango ---
  menuImportarRango();
}
