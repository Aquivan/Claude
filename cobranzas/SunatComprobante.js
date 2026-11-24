/**
 * 🔎 CONSULTAR UN COMPROBANTE EN SUNAT (SOL → «Nueva consulta de comprobantes de pago») y traer sus datos.
 *
 * Para cargar una factura puntual (saldo inicial o fuera de SIRE) sin escribir todo: se dicta o escribe el RUC (o la razón
 * social), la serie y el número y si es factura / N/C / N/D; el robot de GitHub (sunat-comprobante.yml +
 * scripts/sunat_comprobante.py) entra a SUNAT con la clave SOL de la empresa del grupo, busca ESE comprobante y devuelve
 * fecha, moneda, total, IGV, forma de pago, vencimiento y detalle. Nada se guarda solo: se muestra y la persona confirma
 * (📥 Agregar como saldo inicial).
 * El repositorio es público: los datos NO van en las entradas del workflow ni en su registro. El robot se los pide al bot
 * (canal=gh, solo una ejecución de ese workflow que esté corriendo) y le devuelve el resultado.
 * Desde: 🧩 Mesa → 📥 Saldos iniciales → ✍️ Una factura → 🔎 Buscar en SUNAT; Telegram «/comprobante …», texto o audio
 * («consulta en SUNAT la factura F001-10892 de UNILAC para GRANIX»).
 */

var SCP_WF_ = 'sunat-comprobante.yml';
var SCP_PROP_ = 'SCP_L_';

/** consultas: [{empresa, lado, ruc, nombre, tipo ('01'|'07'|'08'), serie, numero, fecha?}]; extra: {origen:'mesa'|'tg', chat}. */
function SCP_lanzar_(consultas, extra) {
  var ss = TG_ss_(), cfg = TG_cfg_(ss);
  consultas = (consultas || []).slice(0, 20).map(function (c, i) {
    return { i: i, empresa: aRuc_(c.empresa), lado: /cobrar/i.test(c.lado) ? 'Por cobrar' : 'Por pagar', ruc: aRuc_(c.ruc), nombre: String(c.nombre || '').slice(0, 120),
      tipo: ('0' + String(c.tipo || '01').replace(/\D/g, '')).slice(-2), serie: String(c.serie || '').toUpperCase().trim(), numero: String(parseInt(String(c.numero).replace(/\D/g, ''), 10)),
      fecha: String(c.fecha || '') };
  });
  consultas.forEach(function (c) {
    if (cfg.cob.grupo.indexOf(c.empresa) < 0) throw new Error('Falta la empresa del grupo.');
    if (c.empresa !== consultas[0].empresa) throw new Error('Una consulta por empresa del grupo a la vez.');
    if (!c.ruc) throw new Error('Falta el RUC del ' + (c.lado === 'Por pagar' ? 'proveedor' : 'cliente') + '.');
    if (!/^[A-Z0-9]{4}$/.test(c.serie) || !(Number(c.numero) > 0)) throw new Error('Serie o número no válidos (ej. F001-10892).');
  });
  var lote = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  var p = PropertiesService.getScriptProperties();
  p.setProperty(SCP_PROP_ + lote, JSON.stringify({ consultas: consultas, extra: extra || {}, t: Date.now() }));
  CacheService.getScriptCache().put('scp_est_' + lote, JSON.stringify({ listo: false, etapa: '⏳ pidiendo a GitHub que entre a SUNAT…' }), 21600);
  try { TG_gh_(cfg, '/actions/workflows/' + SCP_WF_ + '/dispatches', 'post', { ref: cfg.rama, inputs: { lote: lote, empresa: consultas[0].empresa } }); }
  catch (e) { p.deleteProperty(SCP_PROP_ + lote); throw new Error('No pude lanzar la consulta a SUNAT: ' + e.message); }
  return lote;
}

/** doPost ?canal=gh de una ejecución de sunat-comprobante.yml (validada en TG_Captcha.js). */
function SCP_gh_(q) {
  var p = PropertiesService.getScriptProperties(), lote = String(q.lote || '').replace(/\W/g, ''), k = SCP_PROP_ + lote;
  var L = JSON.parse(p.getProperty(k) || 'null'), c = CacheService.getScriptCache();
  if (!L) return { ok: false, error: 'lote desconocido o ya respondido' };
  if (q.accion === 'scp_pendientes') return { ok: true, consultas: L.consultas };
  if (q.accion === 'scp_estado') { c.put('scp_est_' + lote, JSON.stringify({ listo: false, etapa: String(q.estado || '').slice(0, 200) }), 21600); return { ok: true }; }
  if (q.accion !== 'scp_resultados') return { ok: false, error: 'accion desconocida' };
  p.deleteProperty(k);
  var res = (q.resultados || []).map(function (r) {
    var cq = L.consultas[Number(r.i)] || {};
    return SCP_completar_(cq, r);
  });
  var est = { listo: true, resultados: res, error: String(q.error || '') };
  c.put('scp_est_' + lote, JSON.stringify(est), 21600);
  if (L.extra && L.extra.chat) try { SCP_avisarTG_(L.extra.chat, lote, est); } catch (e) { console.warn('SCP aviso: ' + e.message); }
  return { ok: true };
}

/** Junta lo pedido con lo que devolvió SUNAT y arma la fila de 📥 Saldos iniciales. */
function SCP_completar_(cq, r) {
  var x = { ok: !!r.ok, error: String(r.error || ''), consulta: cq, emisorRuc: r.emisor_ruc || '', emisorNombre: r.emisor_nombre || '', receptorRuc: r.receptor_ruc || '',
    receptorNombre: r.receptor_nombre || '', fecha: r.fecha || '', vence: r.vence || '', moneda: /USD|DOL/i.test(r.moneda || '') ? 'USD' : 'PEN', total: Number(r.total) || 0,
    igv: Number(r.igv) || 0, formaPago: r.forma_pago || '', detalle: String(r.detalle || '').slice(0, 300), estado: r.estado || '', texto: String(r.texto || '').slice(0, 4000),
    fuente: r.fuente || 'Consulta de comprobantes', modifica: r.modifica || '', pdf: '' };
  if (x.ok && r.pdf_b64) try { x.pdf = SCP_guardarPdf_(r.pdf_b64, (x.emisorRuc || cq.ruc) + '-' + cq.tipo + '-' + cq.serie + '-' + cq.numero + '.pdf'); } catch (e) { console.warn('SCP pdf: ' + e.message); }
  if (x.ok) {
    var otro = cq.lado === 'Por cobrar' ? { ruc: x.receptorRuc || cq.ruc, nom: x.receptorNombre || cq.nombre } : { ruc: x.emisorRuc || cq.ruc, nom: x.emisorNombre || cq.nombre };
    var tipoTxt = INI_TIPOS_.filter(function (t) { return t.indexOf(cq.tipo) === 0; })[0] || cq.tipo;
    var corte = Utilities.formatDate(INI_corteDefecto_(leerConfig_(ssPrincipal_())), 'America/Lima', 'dd/MM/yyyy');
    x.fila = [cq.empresa, cq.lado, otro.ruc, otro.nom, tipoTxt, cq.serie, cq.numero, x.fecha, x.vence, x.moneda, x.total, '', corte, 'SUNAT (' + (/XML/.test(x.fuente) ? 'XML' : 'consulta') + ')', (x.detalle.slice(0, 120) + (x.pdf ? ' · PDF: ' + x.pdf : '')).replace(/^ · /, ''), ''];
  }
  return x;
}

/** PDF oficial del comprobante en la carpeta «📥 Comprobantes de SUNAT» (junto a la hoja de Cobranzas). */
function SCP_guardarPdf_(b64, nombre) {
  var ss = ssPrincipal_(), padre = DriveApp.getFileById(ss.getId()).getParents();
  padre = padre.hasNext() ? padre.next() : DriveApp.getRootFolder();
  var it = padre.getFoldersByName('📥 Comprobantes de SUNAT'), car = it.hasNext() ? it.next() : padre.createFolder('📥 Comprobantes de SUNAT');
  var ya = car.getFilesByName(nombre);
  if (ya.hasNext()) return ya.next().getUrl();
  return car.createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', nombre)).getUrl();
}

/** Cómo va (la Mesa pregunta cada pocos segundos). */
function SCP_estado_(lote) {
  var v = CacheService.getScriptCache().get('scp_est_' + String(lote || '').replace(/\W/g, ''));
  return v ? JSON.parse(v) : { listo: false, etapa: '⏳ esperando al robot…' };
}

/* ============================================================ 🧩 Mesa */

function MESA_scpPedir(tk, consultas) {
  MESA_ok_(tk);
  return { lote: SCP_lanzar_(consultas, { origen: 'mesa' }) };
}
function MESA_scpEstado(tk, lote) { MESA_ok_(tk); return SCP_estado_(lote); }

/** RUC posibles para una razón social (los del SIRE, vouchers, alias…), para cuando se dicta el nombre en vez del RUC. */
function MESA_scpRuc(tk, nombre) {
  MESA_ok_(tk);
  return (TGQ_rucOpciones_(ssPrincipal_(), nombre).opciones || []).slice(0, 6).map(function (o) { return { ruc: o.ruc, nombre: o.nombre || o.nom || '' }; });
}

/* ============================================================ Telegram (texto o audio) */

var SCP_RX_ = /(\/comprobante\b|\b(consult|busc|verific|trae|jala|saca)\w*\b[^.]*\b(sunat|comprobante)|\b(factura|boleta|nota de cr[eé]dito|nota de d[eé]bito|comprobante)\b[^.]*\b(sunat|saldo inicial))/i;

/** «consulta en SUNAT la factura F001-10892 de UNILAC (20604785775) para GRANIX» → consulta. Devuelve true si la tomó. */
function SCP_tg_(ctx, texto) {
  var t = String(texto || '');
  if (!SCP_RX_.test(t)) return false;
  var doc = INI_doc_(t.replace(/\b\d{8,11}\b/g, ' '));
  if (!doc || !doc.numero) {
    if (/^\/comprobante/i.test(t)) { TG_enviar_(ctx.chatId, '🔎 Dígame (o escriba) el RUC o la razón social, la serie y el número. Ej.: <i>/comprobante 20604785775 F001-10892 GRANIX</i> o <i>consulta en SUNAT la factura F001-10892 de UNILAC para GRANIX</i>.'); return true; }
    return false;
  }
  var cfg = TG_cfg_(ctx.ss), grupo = cfg.cob.grupo, rucs = (t.match(/\b\d{11}\b/g) || []);
  var empresa = rucs.filter(function (r) { return grupo.indexOf(r) >= 0; })[0] || '';
  var nt = normHeader_(t);
  if (!empresa) grupo.forEach(function (r) { var n = normHeader_(cfg.cob.nombreEmpresa[r] || ''); if (n && n.length >= 3 && new RegExp('\\b' + n.split(' ')[0] + '\\b').test(nt)) empresa = empresa || r; });
  var otro = rucs.filter(function (r) { return grupo.indexOf(r) < 0; })[0] || '';
  var cobrar = /\b(cobrar|venta|vend|emiti|cliente)/i.test(t);
  var tipo = /cr[eé]dito/i.test(t) ? '07' : /d[eé]bito/i.test(t) ? '08' : '01';
  var c = { empresa: empresa, lado: cobrar ? 'Por cobrar' : 'Por pagar', ruc: otro, nombre: '', tipo: tipo, serie: doc.serie, numero: doc.numero };
  if (!otro) {   // dictó la razón social: se busca el RUC entre los conocidos
    var tras = t.slice(Math.max(0, t.toUpperCase().indexOf(doc.serie)));   // el nombre va después del número («… F001-10892 de UNILAC»)
    var m = tras.match(/\bde\s+(.+?)(?:\s+(?:para|a|en|del?)\s+(?:la\s+)?(?:empresa\s+)?\w+\s*$|[,.]|$)/i), nom = m ? m[1].replace(/\b(la|el|factura|boleta|nota)\b/gi, '').trim() : '';
    var ops = nom ? (TGQ_rucOpciones_(ctx.ss, nom).opciones || []) : [];
    if (!ops.length) { TG_enviar_(ctx.chatId, '🔎 No sé el RUC de «' + TG_esc_(nom || '¿?') + '». Dígame el RUC (11 dígitos) del ' + (cobrar ? 'cliente' : 'proveedor') + '.'); return true; }
    if (ops.length > 1 && normHeader_(ops[0].nombre || '') !== normHeader_(nom)) {
      return TG_tarjeta_(ctx, '🔎 ¿De cuál es la <b>' + TG_esc_(doc.serie + '-' + doc.numero) + '</b>?', ops.slice(0, 5).map(function (o) {
        return [TG_bot_(o.ruc + ' · ' + String(o.nombre || '').slice(0, 30), { t: 'scp', a: 'scpE', c: Object.assign({}, c, { ruc: o.ruc, nombre: o.nombre }) })];
      }).concat([[TG_bot_('✖ Cancelar', 'm:x', 'link')]]), { nuevo: true }), true;
    }
    c.ruc = ops[0].ruc; c.nombre = ops[0].nombre || '';
  }
  SCP_pedirTG_(ctx, c);
  return true;
}

/** Falta la empresa del grupo → se elige con botones; si no, se lanza. */
function SCP_pedirTG_(ctx, c) {
  var cfg = TG_cfg_(ctx.ss);
  if (!c.empresa) {
    var f = [], bs = cfg.cob.grupo.map(function (r) { return TG_bot_(cfg.cob.nombreEmpresa[r] || r, { t: 'scp', a: 'scpE', c: Object.assign({}, c, { empresa: r }) }); });
    for (var i = 0; i < bs.length; i += 3) f.push(bs.slice(i, i + 3));
    return TG_tarjeta_(ctx, '🔎 ¿A qué empresa del grupo ' + (c.lado === 'Por pagar' ? 'le emitieron' : 'emitió') + ' la <b>' + TG_esc_(c.serie + '-' + c.numero) + '</b>' + (c.nombre ? ' (' + TG_esc_(c.nombre) + ')' : '') + '?', f.concat([[TG_bot_('✖ Cancelar', 'm:x', 'link')]]), { nuevo: true });
  }
  try {
    SCP_lanzar_([c], { origen: 'tg', chat: ctx.chatId });
    TG_enviar_(ctx.chatId, '🔎 Consultando en SUNAT la <b>' + TG_esc_(c.serie + '-' + c.numero) + '</b> ' + (c.lado === 'Por pagar' ? 'de ' : 'a ') + TG_esc_(c.nombre || c.ruc) + ' para <b>' + TG_esc_(cfg.cob.nombreEmpresa[c.empresa] || c.empresa) + '</b>… (1–3 min). Le aviso aquí con los datos.');
  } catch (e) { TG_enviar_(ctx.chatId, '⚠️ ' + TG_esc_(e.message)); }
}

/** Botones de la consulta (k:… guardados): elegir empresa/RUC, agregar o no. */
function SCP_alBoton_(ctx, d) {
  if (d.a === 'scpE') return SCP_pedirTG_(ctx, d.c);
  if (d.a === 'scpA') {
    var r = INI_agregar_(ssPrincipal_(), [d.fila], 'Telegram');
    try { MESA_tocar_(); MESA_programarRecalculo_(); } catch (e) {}
    return TG_tarjeta_(ctx, '📥 ' + (r.nuevos ? 'Agregada' : 'Actualizada') + ' en «' + INI_HOJA_ + '»: <b>' + TG_esc_(d.fila[5] + '-' + d.fila[6]) + '</b> · ' + TG_esc_(d.fila[3]) + ' · ' + d.fila[9] + ' ' + Number(d.fila[10]).toFixed(2) +
      (d.fila[11] !== '' ? ' (saldo ' + Number(d.fila[11]).toFixed(2) + ')' : '') + '.\nCobranzas se recalcula en ~1–2 min. Para cambiar el saldo: 🧩 Mesa → 📥 Saldos iniciales, o la hoja.', []);
  }
  if (d.a === 'scpN') return TG_tarjeta_(ctx, 'Listo, no agregué nada.', []);
}

function SCP_avisarTG_(chat, lote, est) {
  var ctx = { chatId: chat, ss: TG_ss_() };
  if (!est.resultados.length) return TG_enviar_(chat, '⚠️ La consulta a SUNAT no terminó: ' + TG_esc_(est.error || 'sin resultado'));
  est.resultados.forEach(function (x) {
    var c = x.consulta || {};
    if (!x.ok) return TG_enviar_(chat, '❔ SUNAT no mostró la <b>' + TG_esc_(c.serie + '-' + c.numero) + '</b> (' + TG_esc_(c.ruc) + '): ' + TG_esc_(x.error || 'no encontrada') + '\n<i>Revise el RUC, la serie y el número, o si es de otra empresa del grupo.</i>');
    var f = x.fila, txt = '🧾 <b>' + TG_esc_(f[4]) + ' ' + TG_esc_(f[5] + '-' + f[6]) + '</b> (SUNAT' + (x.estado ? ' · ' + TG_esc_(x.estado) : '') + ')\n' +
      (c.lado === 'Por pagar' ? 'De: ' : 'A: ') + '<b>' + TG_esc_(f[3]) + '</b> · ' + TG_esc_(f[2]) + '\n' +
      'Emisión: ' + TG_esc_(x.fecha || '—') + (x.vence ? ' · vence ' + TG_esc_(x.vence) : '') + (x.formaPago ? ' · ' + TG_esc_(x.formaPago) : '') + '\n' +
      'Total: <b>' + (x.moneda === 'USD' ? 'US$ ' : 'S/ ') + x.total.toFixed(2) + '</b>' + (x.igv ? ' (IGV ' + x.igv.toFixed(2) + ')' : '') +
      (x.detalle ? '\n<i>' + TG_esc_(x.detalle.slice(0, 160)) + '</i>' : '') + (x.pdf ? '\n<a href="' + x.pdf + '">📄 PDF oficial</a>' : '') + '\n<i>Fuente: ' + TG_esc_(x.fuente) + '</i>' + '\n\n¿La agrego a 📥 Saldos iniciales (con saldo = total)?';
    TG_tarjeta_(ctx, txt, [[TG_bot_('📥 Agregar', { t: 'scp', a: 'scpA', fila: f }, 'success'), TG_bot_('✖ No', { t: 'scp', a: 'scpN' }, 'link')]], { nuevo: true });
  });
}
