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
 * Si ya existia una carpeta con solo el RUC o con nombre anterior, se renombra
 * automaticamente al formato claro y legible para no duplicar carpetas.
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

  if (idGuardado) {
    try {
      var carpetaGuardada = DriveApp.getFolderById(idGuardado);
      if (!carpetaGuardada.isTrashed()) {
        if (nombreDeseado !== ruc && carpetaGuardada.getName() !== nombreDeseado) {
          carpetaGuardada.setName(nombreDeseado);
        }
        return carpetaGuardada;
      }
    } catch (e) {
      // no existe por id
    }
  }

  // Buscar si ya existe una carpeta que comience con ese RUC
  var it = raiz.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) {
      var nombreActual = f.getName();
      if (nombreActual === ruc || nombreActual.indexOf(ruc + ' - ') === 0 || nombreActual.indexOf(ruc) === 0) {
        if (nombreDeseado !== nombreActual) {
          f.setName(nombreDeseado);
        }
        props.setProperty(claveId, f.getId());
        return f;
      }
    }
  }

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
