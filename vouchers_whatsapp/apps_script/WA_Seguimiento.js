/**
 * 📲 Vouchers por WhatsApp — avisos por tanda y resultado (cada minuto).
 *
 *   1. Acuse: cuando un número deja de mandar archivos por 30 s, UN mensaje
 *      con cuántos llegaron (y cuáles fallaron).
 *   2. Resultado: cuando el sistema de Vouchers ya sacó los archivos de la
 *      carpeta de Entrada, se buscan sus filas (columna "Archivo Original")
 *      y se manda UN mensaje con banco, monto y operación de cada uno.
 * Columna "Avisado" de Recibidos: '' → 'acuse' → 'resultado'.
 */

var WA_ESPERA_TANDA_MS_ = 30 * 1000;
var WA_MAX_COLA_MS_ = 45 * 60 * 1000;
var WA_MAX_SEGUIR_MS_ = 24 * 60 * 60 * 1000; // un "⏳ Revisar" se sigue mirando hasta 24 h

function WA_cadaMinuto() {
  var props = WA_props_().getProperties(), ahora = Date.now();
  var tandas = Object.keys(props).filter(function (k) { return k.indexOf('WA_TANDA_') === 0 && ahora - Number(props[k]) >= WA_ESPERA_TANDA_MS_; });
  var hayCola = props.WA_HAY_COLA === '1';
  if (props.WA_HAY_IA === '1') {
    try { WA_buscarRespuestasIA_(props); } catch (e) { console.error('Respuestas IA: ' + e.message); }
    if (!Object.keys(WA_props_().getProperties()).some(function (k) { return k.indexOf('WA_IAP_') === 0; })) WA_props_().setProperty('WA_HAY_IA', '0');
  }
  if (!tandas.length && !hayCola) return;

  var hoja = WA_hoja_(), datos = hoja.getDataRange().getValues();
  tandas.forEach(function (k) {
    WA_acuse_(hoja, datos, k.slice('WA_TANDA_'.length));
    WA_props_().deleteProperty(k);
  });

  if (tandas.length) WA_procesarYa_();
  var quedan = WA_revisarCola_(hoja, datos, ahora);
  WA_props_().setProperty('WA_HAY_COLA', quedan ? '1' : '0');
  WA_avisarResultados_(hoja, datos);
}

function WA_acuse_(hoja, datos, de) {
  var filas = [];
  for (var i = 1; i < datos.length; i++) if (String(datos[i][2]) === de && datos[i][10] === '') filas.push(i);
  if (!filas.length) return;
  var ok = filas.filter(function (i) { return datos[i][6] === 'En cola'; });
  var mal = filas.filter(function (i) { return datos[i][6] !== 'En cola'; });
  var fotos = ok.filter(function (i) { return datos[i][3] === 'foto'; }).length;
  var txt = '📥 Recibí ' + ok.length + ' archivo(s)' + (ok.length ? ': ' + fotos + ' foto(s), ' + (ok.length - fotos) + ' PDF/original(es).' : '.');
  if (ok.length) txt += WA_prop_('WA_PROCESAR_URL') ? '\n⚡ Procesando ahora; en un momento le mando el resultado.'
    : '\nLe aviso el resultado cuando estén en la hoja (el sistema revisa cada 10 min).';
  if (mal.length) txt += '\n\n⚠️ No pude guardar:\n' + mal.map(function (i) { return '• ' + datos[i][4] + ' — ' + datos[i][7]; }).join('\n');
  WA_enviarTexto_(de, txt);
  filas.forEach(function (i) {
    datos[i][10] = ok.indexOf(i) !== -1 ? 'acuse' : 'resultado';
    hoja.getRange(i + 1, 11).setValue(datos[i][10]);
  });
  if (ok.length) WA_props_().setProperty('WA_HAY_COLA', '1');
}

// Devuelve cuántos archivos siguen esperando al sistema de Vouchers.
function WA_revisarCola_(hoja, datos, ahora) {
  var pendientes = [];
  for (var i = 1; i < datos.length; i++) {
    var demorado = datos[i][6] === 'Revisar' && String(datos[i][7]).indexOf('⏳') === 0 &&
      ahora - new Date(datos[i][0]).getTime() < WA_MAX_SEGUIR_MS_;
    if (datos[i][6] === 'En cola' || demorado) pendientes.push(i);
  }
  if (!pendientes.length) return 0;

  var indice = null, quedan = 0;
  pendientes.forEach(function (i) {
    var r = datos[i], enEntrada = false, eraDemorado = r[6] === 'Revisar';
    try {
      var padres = DriveApp.getFileById(r[9]).getParents();
      while (padres.hasNext()) if (padres.next().getId() === WA_VOUCHERS_.entrada[r[3]]) enEntrada = true;
    } catch (e) { enEntrada = false; }

    var estado, resultado;
    if (enEntrada) {
      if (eraDemorado || ahora - new Date(r[0]).getTime() < WA_MAX_COLA_MS_) { quedan++; return; }
      quedan++; // se sigue mirando: si después se procesa, llega un segundo aviso con el resultado
      estado = 'Revisar';
      resultado = '⏳ Sigue en la carpeta de Entrada: el sistema de Vouchers aún no lo procesó.';
    } else {
      indice = indice || WA_indiceVouchers_();
      var filas = indice[r[3] + '|' + r[4]] || [];
      if (!filas.length) { estado = 'Descartado'; resultado = '❌ El sistema lo descartó (revise la carpeta Descartados).'; }
      else {
        var lineas = filas.map(WA_lineaVoucher_);
        estado = lineas.some(function (l) { return l.indexOf('✅') === 0; }) ? 'Registrado' : 'Revisar';
        resultado = lineas.slice(0, 5).join('\n') + (lineas.length > 5 ? '\n… y ' + (lineas.length - 5) + ' más' : '');
      }
    }
    datos[i][6] = estado; datos[i][7] = resultado;
    hoja.getRange(i + 1, 7, 1, 2).setValues([[estado, resultado]]);
    // Ya se había avisado "⏳ sigue en Entrada": se vuelve a avisar con el resultado real.
    if (eraDemorado) { datos[i][10] = 'acuse'; hoja.getRange(i + 1, 11).setValue('acuse'); }
  });
  return quedan;
}

// Filas de la hoja de Vouchers por "tipo|Archivo Original" (solo las últimas 2000 de cada pestaña).
function WA_indiceVouchers_() {
  var ss = SpreadsheetApp.openById(WA_VOUCHERS_.hoja), indice = {};
  ['original', 'foto'].forEach(function (tipo) {
    var h = ss.getSheetByName(WA_VOUCHERS_.pestana[tipo]);
    if (!h || h.getLastRow() < 2) return;
    var desde = Math.max(2, h.getLastRow() - 1999);
    h.getRange(desde, 1, h.getLastRow() - desde + 1, 11).getValues().forEach(function (f) {
      var k = tipo + '|' + f[10];
      (indice[k] = indice[k] || []).push(f);
    });
  });
  return indice;
}

function WA_lineaVoucher_(f) {
  var op = String(f[1] || ''), monto = WA_monto_(f[3], f[4]);
  if (op === '[OMITIDO]') return '❌ No se encontró un voucher legible';
  if (op === '[DUPLICADO]') return '⚠️ Duplicado (ya estaba en la hoja): ' + [f[2], monto].filter(String).join(' · ');
  if (op.charAt(0) === '[') return '❌ ' + (f[5] || op);
  return '✅ ' + [f[2], monto, op ? 'op ' + op : '', f[5]].filter(String).join(' · ');
}

function WA_monto_(moneda, monto) {
  var n = Number(monto);
  if (!monto && monto !== 0) return '';
  var t = isNaN(n) ? String(monto) : n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  var m = String(moneda || '').toUpperCase();
  return (m === 'PEN' || m === 'SOLES' || m === 'S/' ? 'S/ ' : m === 'USD' || m === 'DOLARES' || m === 'US$' ? 'US$ ' : (m ? m + ' ' : '')) + t;
}

function WA_avisarResultados_(hoja, datos) {
  var porNumero = {}, enCola = {};
  for (var i = 1; i < datos.length; i++) {
    var de = String(datos[i][2]);
    if (datos[i][6] === 'En cola') enCola[de] = true;
    else if (datos[i][10] === 'acuse') (porNumero[de] = porNumero[de] || []).push(i);
  }
  Object.keys(porNumero).forEach(function (de) {
    if (enCola[de]) return; // se espera a que termine toda la tanda
    var filas = porNumero[de];
    var txt = '📋 *Resultado de ' + filas.length + ' archivo(s)*\n\n' + filas.map(function (i, n) {
      return (n + 1) + '. ' + String(datos[i][4]).slice(0, 40) + '\n' + datos[i][7];
    }).join('\n\n');
    if (txt.length > 3900) txt = txt.slice(0, 3850) + '\n\n… (vea el resto en la hoja de Vouchers)';
    WA_enviarTexto_(de, txt);
    filas.forEach(function (i) { hoja.getRange(i + 1, 11).setValue('resultado'); });
  });
}

// Pide a la hoja de Vouchers que procese YA (su acción remota "procesar"), en vez de esperar
// su revisión de cada 10 min. Nunca dos a la vez: la hoja de Vouchers no usa bloqueos.
function WA_procesarYa_() {
  var url = WA_prop_('WA_PROCESAR_URL');
  if (!url) return;
  var p = WA_props_(), desde = Number(p.getProperty('WA_PROCESANDO') || 0);
  if (Date.now() - desde < 6 * 60 * 1000) return;
  p.setProperty('WA_PROCESANDO', String(Date.now()));
  try {
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    console.log('Procesar al instante: HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 300));
  } catch (e) {
    console.error('Procesar al instante falló: ' + e.message);
  } finally {
    p.deleteProperty('WA_PROCESANDO');
  }
}
