// ============================================================
// ⏳ AVANCE EN VIVO DE CADA ARCHIVO (pedido del usuario, 26/11/2026)
// ------------------------------------------------------------
// Mientras un archivo se procesa, cada paso deja su avance:
//   cola → 🗜 reduciendo peso (pág x de N) → ✍️ reversos → 📖 leyendo (pág x de N · vouchers) → ✅ listo / ⏸ pausa / ⚠️ error
// 1. En esta hoja: memoria (CacheService) que lee la ventana 📤 Subir vouchers (SV_avance) cada pocos segundos.
// 2. A Cobranzas (bot de Telegram y avisos de WhatsApp): solo si alguien sigue ese archivo, como mucho cada 15 s
//    (los pasos importantes, siempre). Si Cobranzas no responde, no pasa nada: el proceso sigue igual.
// Funciones AV_.
// ============================================================

var AV_CADA_MS_ = 15000;
var AV_IMPORTANTES_ = { inicio: 1, comprimir: 0, comprimido: 1, sinCambio: 1, reversos: 1, fin: 1, pausa: 1, error: 1, cola: 1 };

/** Clave del archivo: sin extensión ni « (parte 1 de 2)», en minúsculas (así las partes comprimidas siguen al original). */
function AV_clave_(nombre) {
  return String(nombre || '').replace(/\.(pdf|jpe?g|png|webp|gif|bmp|tiff?)$/i, '').replace(/\s*\(parte \d+ de \d+\)\s*$/i, '').trim().toLowerCase();
}

/**
 * Anota el avance de un archivo. d = {etapa, pag, total, nuevos, repetidos, mb, mbFin, error}
 * (nuevos / repetidos se SUMAN a lo que ya había: un PDF largo se lee en varias vueltas).
 */
function AV_(nombre, d) {
  try {
    const c = CacheService.getScriptCache(), k = 'av_' + AV_clave_(nombre).slice(0, 200);
    let e = {};
    try { e = JSON.parse(c.get(k) || '{}'); } catch (x) {}
    if (d.etapa === 'cola' && e.etapa && e.etapa !== 'fin') return;   // ya empezó: «en cola» no lo pisa
    if (!e.t0 || (e.etapa === 'fin' && d.etapa !== 'fin')) e = { t0: Date.now(), nuevos: 0, repetidos: 0 };
    e.nombre = nombre;
    e.etapa = d.etapa;
    ['pag', 'total', 'mb', 'mbFin', 'error'].forEach(function (x) { if (d[x] !== undefined) e[x] = d[x]; });
    e.nuevos = (e.nuevos || 0) + (d.nuevos || 0);
    e.repetidos = (e.repetidos || 0) + (d.repetidos || 0);
    e.t = Date.now();
    const remoto = AV_IMPORTANTES_[d.etapa] === 1 || Date.now() - (e.envio || 0) >= AV_CADA_MS_;
    if (remoto && !c.get('av_noseg_' + k)) {
      e.envio = Date.now();
      c.put(k, JSON.stringify(e), 21600);
      AV_avisar_(k, e);
    } else c.put(k, JSON.stringify(e), 21600);
    // lista de los últimos archivos (para la ventana de la hoja)
    let l = [];
    try { l = JSON.parse(c.get('av_lista') || '[]'); } catch (x) {}
    if (l.indexOf(k) < 0) { l.unshift(k); c.put('av_lista', JSON.stringify(l.slice(0, 30)), 21600); }
  } catch (err) { Logger.log('Avance: ' + err.message); }
}

/** Le pasa el avance a Cobranzas (Telegram / WhatsApp). Si nadie lo sigue, deja de avisar por 10 min. */
function AV_avisar_(k, e) {
  if (typeof VIA_llamar_ !== 'function') return;
  try {
    const r = VIA_llamar_('avance', { nombre: e.nombre, estado: e });
    if (r && r.seguido === false) CacheService.getScriptCache().put('av_noseg_' + k, '1', 600);
  } catch (err) { Logger.log('Avance a Cobranzas: ' + err.message); }
}

/** Para la ventana 📤 Subir vouchers: el avance de esos nombres (o de los últimos). */
function AV_leer_(nombres) {
  const c = CacheService.getScriptCache();
  let ks = (nombres || []).map(function (n) { return 'av_' + AV_clave_(n).slice(0, 200); });
  if (!ks.length) { try { ks = JSON.parse(c.get('av_lista') || '[]'); } catch (x) { ks = []; } }
  const m = ks.length ? c.getAll(ks) : {};
  return ks.map(function (k) { try { return m[k] ? JSON.parse(m[k]) : null; } catch (x) { return null; } }).filter(Boolean);
}

/** Texto corto del avance (para la hoja). */
function AV_texto_(e) {
  const pct = e.total ? Math.round(100 * (e.pag || 0) / e.total) : 0;
  const barra = e.total ? ' ' + '▓'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10)) + ' ' + pct + '%' : '';
  const cuenta = (e.nuevos ? ' · ' + e.nuevos + ' nuevo(s)' : '') + (e.repetidos ? ' · ' + e.repetidos + ' repetido(s)' : '');
  switch (e.etapa) {
    case 'cola': return '🕐 En cola';
    case 'comprimir': return '🗜 Reduciendo peso' + (e.total ? ': pág. ' + (e.pag || 0) + ' de ' + e.total + barra : '…');
    case 'comprimido': return '🗜 Peso reducido: ' + e.mb + ' → ' + e.mbFin + ' MB';
    case 'sinCambio': return '🗜 Ya pesaba poco: sigue igual';
    case 'reversos': return '✍️ Buscando reversos y anotaciones' + (e.total ? ' (' + e.total + ' pág.)' : '') + '…';
    case 'inicio': case 'leer': return '📖 Leyendo' + (e.total ? ': pág. ' + (e.pag || 0) + ' de ' + e.total + barra : '…') + cuenta;
    case 'pausa': return '⏸ Pausa (sigue en ~1 min): pág. ' + (e.pag || 0) + ' de ' + (e.total || '?') + cuenta;
    case 'fin': return '✅ Listo' + (cuenta || ' · sin vouchers nuevos');
    case 'error': return '⚠️ ' + (e.error || 'error');
    default: return e.etapa || '';
  }
}
