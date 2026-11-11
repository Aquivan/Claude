/**
 * 🌐 Portal web de Vouchers — configuración.
 *
 * Proyecto APARTE de la hoja «Sistema de Vouchers» (su propia aplicación web), para usar la hoja desde el celular o la PC
 * con un enlace, SIN cuenta de Google: cada persona entra con su usuario y PIN (pestaña 👥 Portal de la misma hoja).
 *
 * ¿Por qué aparte? La aplicación web de la hoja de Vouchers (bot de Telegram) corre con la cuenta del dueño y tiene
 * funciones públicas que no piden permiso (p. ej. la que entrega el «pase» de Drive del visor). Si esa aplicación sirviera
 * una página, cualquiera con el enlace podría llamarlas. Aquí, en cambio, las ÚNICAS funciones públicas son doGet,
 * PV_entrar y PV_api, y estas revisan la sesión y el permiso en cada llamada. Todo lo demás termina en «_».
 *
 * Lo que necesita la IA de la hoja (🔁 volver a leer, ⚡ procesar ya) se pide a la hoja de Vouchers por su puente
 * (PV_Puente.js de la hoja, protegido con una clave que solo conocen los dos proyectos). Funciones PV_.
 */

// Hoja y carpetas del Sistema de Vouchers (son los mismos de su Config.js; no son secretos).
var PV_SS_ = '1CS0GZiKclm2SroNgrpiBZsavYVobqBv9rgKzjQDII1c';
var PV_CARP_ = {
  oe: { id: '1GqjydN2oOYhwDvxPmZtr9TEJgjP65i2g', t: '📥 Originales — entrada (por procesar)', tipo: 'original', entrada: true },
  fe: { id: '12si83gUAbe5kqbFopbMrFkdD3EvBsA72', t: '📥 Fotos — entrada (por procesar)', tipo: 'foto', entrada: true },
  op: { id: '1FM3wLUAGcFD5_yGiOuhLzLpAL9Sc7ki2', t: '📄 Originales — procesados', tipo: 'original' },
  fp: { id: '1RCiyPbj-s2k5ou8TQ3UIBA9vu6kUo3vE', t: '📸 Fotos — procesadas', tipo: 'foto' },
  de: { id: '1ssCkvGRm724X3wEnORCVK2nMSWXaRPLT', t: '🗑 Descartados', tipo: '' }
};
var PV_HOJAS_ = ['Originales', 'Fotos'];
var PV_MAX_MB_ = 45;            // igual que la hoja: más pesado se aparta
var PV_MAX_VER_MB_ = 20;        // para ver un original en el portal
var PV_HORAS_ = 10;             // la sesión dura esto (luego se vuelve a poner el PIN)
var PV_TZ_ = 'America/Lima';

// Pestañas que el portal agrega a la hoja de Vouchers (no las usa el resto del sistema).
var PV_HOJA_USU_ = '👥 Portal';
var PV_HOJA_REG_ = '🌐 Registro portal';

// Permisos: cada uno incluye a los anteriores.
var PV_PERMISOS_ = ['ver', 'subir', 'editar', 'admin'];
var PV_PERM_TXT_ = {
  ver: 'buscar y ver vouchers, originales y pendientes',
  subir: 'además subir vouchers y pedir que se procesen ya',
  editar: 'además corregir datos y volver a leer con IA',
  admin: 'todo, y además usuarios y registro'
};

function PV_ss_() { return SpreadsheetApp.openById(PV_SS_); }

function PV_hoy_(fmt) { return Utilities.formatDate(new Date(), PV_TZ_, fmt || 'dd/MM/yyyy HH:mm'); }
