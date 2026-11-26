// ============================================================
// 🏢 COMPLETAR «EMPRESA» SOLO — acordado con el usuario el 26/11/2026
// ------------------------------------------------------------
// En cada vuelta del bot (si el interruptor está encendido: 🤖 Vouchers → 🏢 Completar Empresa sola), en Originales y
// Fotos, SOLO donde «Empresa» está vacía, se pone la empresa del grupo (de 🏢 Empresas) que pagó, y su «RUC empresa»:
//   1. «Doc. depositante» = RUC de una empresa del grupo (exacto).
//   2. «Doc. depositante» = DNI de una persona del grupo (su RUC 10 sin el 10 ni el dígito final) → se llena con nota
//      «depositó con DNI: revise si fue por cuenta de ella».
//   3. «Depositante» (nombre) = un nombre que la hoja ya usa para esa empresa (aprendido de las filas que ya tienen
//      Empresa, si casi siempre es la misma), o contiene la abreviatura (GRANIX, BKF, DSM, M&D…; las de persona solo así).
//   4. «✍️ Anotación» (lo escrito a mano) o «Nota» con la abreviatura como palabra.
// Si dos fuentes dicen empresas distintas, no se llena (nota «⚠️ revisar»). Un RUC con un dígito mal leído solo vale si
// el nombre confirma la misma empresa. Cada celda llenada lleva una nota «🏢 Completado solo …» y el lote queda guardado
// para ↩️ Deshacer (solo deshace las celdas que siguen tal como las dejó).
// ============================================================

var AE_MARCA_ = '🏢 Completado solo';
var AE_CARPETA_ = '🏢 Completar Empresa (lotes para deshacer)';

function AE_carpeta_() {
  const proc = DriveApp.getFolderById(CFG.CARPETA_FOTOS_PROCESADOS_ID), it = proc.getFoldersByName(AE_CARPETA_);
  return it.hasNext() ? it.next() : proc.createFolder(AE_CARPETA_);
}

function AE_activo_() { return PropertiesService.getScriptProperties().getProperty('VCH_AUTO_EMPRESA') !== '0'; }

function AE_norm_(t) { return String(t || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' Y ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

/** Regex de la abreviatura como palabra (M&D → «M D» / «M Y D» / «MYD»). */
function AE_rxAbrev_(ab) {
  const n = AE_norm_(ab);
  if (/^M Y D$/.test(n)) return /\bM ?(Y )?D\b/;
  return new RegExp('\\b' + n.replace(/ /g, ' ?') + '\\b');
}

function AE_dig_(t) { return String(t || '').replace(/\D/g, ''); }
function AE_unoDistinto_(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false; return d === 1; }

/** Recorre una pestaña. modo 'aplicar' escribe; devuelve {llenadas:[{fila, emp, ruc, por, nota}], dudas} */
function AE_pestana_(h, mapa) {
  const n = h.getLastRow() - 1;
  if (n < 1) return { llenadas: [], dudas: 0 };
  const tit = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
  const col = function (re) { for (let i = 0; i < tit.length; i++) if (re.test(tit[i])) return i; return -1; };
  const cDoc = col(/^doc/), cDep = col(/^depositante/), cEmp = col(/^empresa$/), cRuc = col(/^ruc empresa$/), cAno = col(/anotaci/), cNota = col(/^nota$/);
  if (cEmp < 0) return { llenadas: [], dudas: 0 };
  const v = h.getRange(2, 1, n, h.getLastColumn()).getDisplayValues();
  const empresas = Object.keys(mapa), porRuc = {}, porDni = {};
  empresas.forEach(function (e) { const r = mapa[e]; porRuc[r] = e; if (/^10\d{9}$/.test(r)) porDni[r.slice(2, 10)] = e; });
  // nombres de depositante ya usados para cada empresa (aprendidos de las filas con Empresa)
  const visto = {};
  if (cDep >= 0) v.forEach(function (r) {
    const e = String(r[cEmp]).trim(), d = AE_norm_(r[cDep]);
    if (!e || !d || !mapa[e]) return;
    (visto[d] = visto[d] || {})[e] = (visto[d][e] || 0) + 1;
  });
  const alias = {};
  Object.keys(visto).forEach(function (d) {
    const c = visto[d], tot = Object.keys(c).reduce(function (s, k) { return s + c[k]; }, 0);
    const mejor = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
    const otra = empresas.some(function (e) { return e !== mejor && !/^10/.test(mapa[e]) && AE_rxAbrev_(e).test(d); });
    if (tot >= 2 && c[mejor] / tot >= 0.9 && !otra) alias[d] = mejor;
  });
  const persona = {}; empresas.forEach(function (e) { persona[e] = /^10/.test(mapa[e]); });
  const rx = {}; empresas.forEach(function (e) { rx[e] = AE_rxAbrev_(e); });
  const llenadas = [];
  let dudas = 0;
  v.forEach(function (r, i) {
    if (String(r[cEmp]).trim()) return;
    const votos = {}, por = [];
    let nota = '';
    const votar = function (e, motivo) { if (!e) return; votos[e] = 1; por.push(motivo); };
    const doc = cDoc >= 0 ? AE_dig_(r[cDoc]) : '', dep = cDep >= 0 ? AE_norm_(r[cDep]) : '';
    if (doc.length === 11 && porRuc[doc]) votar(porRuc[doc], 'Doc. depositante ' + doc);
    else if (doc.length === 8 && porDni[doc]) { votar(porDni[doc], 'DNI ' + doc); nota = '⚠️ Depositó con DNI ' + doc + ': revise si fue por cuenta de ' + porDni[doc] + '.'; }
    // nombre del depositante
    let porNombre = '';
    const hayDoc = Object.keys(votos).length > 0;   // el RUC / DNI manda: el nombre solo se usa si no hay documento del grupo
    if (dep && !hayDoc) {
      if (alias[dep]) porNombre = alias[dep];
      else empresas.forEach(function (e) { if (!persona[e] && rx[e].test(dep)) porNombre = porNombre && porNombre !== e ? '¿' : e; });
      if (!porNombre) {   // persona del grupo (SONIA, NIELDEN…) por su nombre en el depositante: se llena, con nota para revisar
        empresas.forEach(function (e) { if (persona[e] && rx[e].test(dep)) porNombre = porNombre && porNombre !== e ? '¿' : e; });
        if (porNombre && porNombre !== '¿' && !nota) nota = 'ℹ️ Por el nombre del depositante («' + String(r[cDep]).trim().slice(0, 40) + '»): si no es ' + porNombre + ', corríjalo.';
      }
      if (porNombre === '¿') porNombre = '';
      if (porNombre) votar(porNombre, 'Depositante «' + String(r[cDep]).trim().slice(0, 40) + '»');
    } else if (dep) {   // con documento: el nombre solo se anota si confirma
      empresas.forEach(function (e) { if (votos[e] && (alias[dep] === e || (!persona[e] && rx[e].test(dep)))) por.push('Depositante «' + String(r[cDep]).trim().slice(0, 40) + '»'); });
    }
    // RUC con un dígito mal leído: solo si el nombre confirma
    if (doc.length === 11 && !porRuc[doc] && porNombre && AE_unoDistinto_(doc, mapa[porNombre])) { por.push('RUC ' + doc + ' (casi ' + mapa[porNombre] + ')'); }
    // lo escrito a mano / Nota
    [[cAno, '✍️ Anotación'], [cNota, 'Nota']].forEach(function (p) {
      if (p[0] < 0) return;
      const t = AE_norm_(r[p[0]]);
      if (!t) return;
      const hits = empresas.filter(function (e) { return rx[e].test(t); });
      if (hits.length === 1) votar(hits[0], p[1] + ' «' + String(r[p[0]]).trim().slice(0, 30) + '»');
    });
    const ks = Object.keys(votos);
    if (!ks.length) return;
    if (ks.length > 1) { dudas++; llenadas.push({ fila: i + 2, emp: '', ruc: '', por: por, nota: '⚠️ ' + AE_MARCA_ + ': no se llenó, las fuentes dicen empresas distintas (' + por.join(' · ') + '). Revise.' }); return; }
    llenadas.push({ fila: i + 2, emp: ks[0], ruc: mapa[ks[0]] || '', por: por, nota: nota,
      op: String(r[1]).trim(), banco: String(r[2]).trim(), monto: String(r[4]).trim(), cEmp: cEmp, cRuc: cRuc });
  });
  return { llenadas: llenadas, dudas: dudas, cEmp: cEmp, cRuc: cRuc };
}

/** En cada vuelta del bot (si está encendido). */
function VCH_autoEmpresa_() {
  if (!AE_activo_()) return;
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID), mapa = CC_mapaEmpresas_(ss).mapa;
  if (!Object.keys(mapa).length) return;
  const lote = { cuando: Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy HH:mm'), filas: [] };
  const resumen = [];
  [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].forEach(function (t) {
    const h = obtenerHoja(t);
    if (!h) return;
    const r = AE_pestana_(h, mapa), ok = r.llenadas.filter(function (x) { return x.emp; });
    if (!r.llenadas.length) return;
    const n = h.getLastRow() - 1;
    // Empresa y su nota: toda la columna de una vez (solo cambian las vacías)
    const rgE = h.getRange(2, r.cEmp + 1, n, 1), valE = rgE.getValues(), notE = rgE.getNotes();
    const rgR = r.cRuc >= 0 ? h.getRange(2, r.cRuc + 1, n, 1) : null, valR = rgR ? rgR.getValues() : null;
    let cambio = 0;
    r.llenadas.forEach(function (x) {
      const k = x.fila - 2;
      if (String(valE[k][0]).trim()) return;   // la llenaron mientras tanto
      const marca = (x.emp ? AE_MARCA_ + ' el ' + lote.cuando + ' por: ' + x.por.join(' · ') + (x.nota ? '\n' + x.nota : '') : x.nota);
      if (String(notE[k][0]).indexOf(AE_MARCA_) >= 0 && !x.emp) return;   // la duda ya estaba anotada
      notE[k][0] = (String(notE[k][0] || '').replace(/(^|\n)⚠️ 🏢 Completado solo[^\n]*/g, '').trim() + '\n' + marca).trim();
      if (!x.emp) { cambio++; return; }
      valE[k][0] = x.emp;
      if (valR && !String(valR[k][0]).trim()) valR[k][0] = x.ruc;
      lote.filas.push({ hoja: t, op: x.op, banco: x.banco, monto: x.monto, emp: x.emp, ruc: valR ? x.ruc : '' });
      cambio++;
    });
    if (!cambio) return;
    rgE.setValues(valE); rgE.setNotes(notE);
    if (rgR) { rgR.setNumberFormat('@'); rgR.setValues(valR); }
    resumen.push(t + ': ' + ok.length + ' empresa(s) puesta(s)' + (r.dudas ? ', ' + r.dudas + ' con fuentes distintas (sin llenar)' : ''));
  });
  if (lote.filas.length) {
    try {
      AE_carpeta_().createFile('lote ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmmss') + '.json', JSON.stringify(lote), MimeType.PLAIN_TEXT);
    } catch (e) { Logger.log('🏢 Guardar lote: ' + e.message); }
  }
  if (resumen.length && typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'completar Empresa', '', resumen.join(' | '));
}

/** ↩️ Deshace el último lote: borra Empresa / RUC empresa SOLO de las filas que siguen tal como las dejó. */
function AE_deshacer_() {
  // el lote MÁS RECIENTE que no se deshizo (cada vuelta que llena algo guarda el suyo)
  const it = AE_carpeta_().getFiles();
  let f = null;
  while (it.hasNext()) { const x = it.next(); if (!f || x.getName() > f.getName()) f = x; }
  if (!f) return 'No hay ningún completado para deshacer.';
  const lote = JSON.parse(f.getBlob().getDataAsString());
  let n = 0, cambiadas = 0;
  [CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].forEach(function (t) {
    const h = obtenerHoja(t), filas = lote.filas.filter(function (x) { return x.hoja === t; });
    if (!h || !filas.length) return;
    const tit = h.getRange(1, 1, 1, h.getLastColumn()).getDisplayValues()[0].map(CC_norma_);
    const cEmp = tit.indexOf('empresa'), cRuc = tit.indexOf('ruc empresa'), nn = h.getLastRow() - 1;
    if (cEmp < 0 || nn < 1) return;
    const v = h.getRange(2, 1, nn, 5).getDisplayValues();
    const rgE = h.getRange(2, cEmp + 1, nn, 1), valE = rgE.getValues(), notE = rgE.getNotes();
    const rgR = cRuc >= 0 ? h.getRange(2, cRuc + 1, nn, 1) : null, valR = rgR ? rgR.getValues() : null;
    const idx = {};
    v.forEach(function (r, i) { idx[String(r[1]).trim() + '|' + String(r[2]).trim() + '|' + String(r[4]).trim()] = i; });
    filas.forEach(function (x) {
      const k = idx[x.op + '|' + x.banco + '|' + x.monto];
      if (k === undefined) return;
      if (String(valE[k][0]).trim() !== x.emp || String(notE[k][0]).indexOf(AE_MARCA_ + ' el ' + lote.cuando) < 0) { cambiadas++; return; }
      valE[k][0] = '';
      if (valR && String(valR[k][0]).trim() === x.ruc) valR[k][0] = '';
      notE[k][0] = String(notE[k][0]).split('\n').filter(function (l) { return l.indexOf(AE_MARCA_ + ' el ' + lote.cuando) < 0 && l.indexOf('⚠️ Depositó con DNI') < 0; }).join('\n').trim();
      n++;
    });
    rgE.setValues(valE); rgE.setNotes(notE);
    if (rgR) rgR.setValues(valR);
  });
  f.setTrashed(true);
  if (typeof REG_anotar_ === 'function') REG_anotar_('Vouchers', 'completar Empresa · deshecho', '', n + ' fila(s) del ' + lote.cuando + (cambiadas ? ' · ' + cambiadas + ' no se tocaron (ya las habían cambiado)' : ''));
  return '↩️ Deshecho: se quitaron ' + n + ' empresa(s) puestas el ' + lote.cuando + '.' + (cambiadas ? ' ' + cambiadas + ' no se tocaron porque ya las habían cambiado a mano.' : '');
}

function AE_menuDeshacer() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('↩️ Deshacer el último completado de Empresa', '¿Quito las empresas que el sistema puso solo en su último lote? (las que usted cambió después no se tocan). Si quiere deshacer uno anterior, repita.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  // que no vuelva a llenarlas en la próxima vuelta: se apaga el interruptor
  PropertiesService.getScriptProperties().setProperty('VCH_AUTO_EMPRESA', '0');
  ui.alert('↩️ Deshacer', AE_deshacer_() + '\n\nEl completado automático quedó APAGADO (enciéndalo en 🤖 Vouchers → 🏢 Completar Empresa sola).', ui.ButtonSet.OK);
}

function AE_menuInterruptor() {
  const props = PropertiesService.getScriptProperties(), ui = SpreadsheetApp.getUi(), activo = AE_activo_();
  const r = ui.alert('🏢 Completar Empresa sola', 'Ahora está ' + (activo ? 'ENCENDIDO' : 'APAGADO') + '.\n\nEncendido: en cada vuelta, donde «Empresa» está vacía se pone la empresa del grupo que pagó ' +
    '(por Doc. depositante, Depositante, ✍️ Anotación o Nota) y su RUC. Nunca cambia lo que ya está escrito.\n\n¿' + (activo ? 'Apagarlo' : 'Encenderlo') + '?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  props.setProperty('VCH_AUTO_EMPRESA', activo ? '0' : '1');
  ui.alert(activo ? '⏸ Apagado.' : '✅ Encendido: se completa en la próxima vuelta (hasta 10 min).');
}
