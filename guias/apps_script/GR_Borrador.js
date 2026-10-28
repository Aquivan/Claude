/**
 * 🧾 Guías — Así va a quedar la guía: un BORRADOR armado solo con los datos de la fila (sin entrar a Quesito ni a SOL),
 * con la forma de una Guía de Remisión Remitente. Muestra en rojo lo que falta y se puede guardar como PDF en Drive
 * para revisarlo o mandarlo. No es la guía oficial (esa la crea Quesito o SUNAT al emitir).
 * Funciones GR_.
 */

function GR_menuBorrador() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet(), f = sh.getActiveRange().getRow();
  var id = sh.getName() === GR_HOJA_ && f >= GR_FILA1_ ? String(sh.getRange(f, 1).getValue()) : '';
  if (!id) return SpreadsheetApp.getUi().alert('Haga clic en la fila de la guía (en ' + GR_HOJA_ + ') y vuelva a intentar.');
  var t = HtmlService.createTemplateFromFile('GR_BorradorVista');
  t.idGuia = id;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(980).setHeight(700), '🧾 Así va a quedar la guía ' + id + ' (borrador)');
}

/** Todo lo de la guía, listo para dibujar. */
function GR_datosBorrador(id) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(GR_HOJA_), fila = GR_filaDe_(sh, id);
  if (!fila) throw new Error('No encontré la guía ' + id + '.');
  var r = GR_leerGuias_(sh, fila, fila)[0].r, ctx = GR_contexto_(ss), emp = ctx.emp[String(r.empresa).trim()] || {};
  var t = function (k) { var v = r[k]; return v instanceof Date ? Utilities.formatDate(v, 'America/Lima', 'dd/MM/yyyy') : String(v == null ? '' : v).trim(); };
  var v = GR_validar_(r, ctx);
  // Bienes: «Producto y cantidad» (sobre las líneas de la factura) > 📦 Productos > todo lo de la factura
  var bienes = [], origen = '';
  try {
    var fac = GR_facturaDe_(ss, id), ped = t('via') !== 'SUNAT' ? GR_partirPedido_(r.pedido) : [];
    if (ped.length && fac.lineas.length) {
      GR_calzarPedido_(ped, fac.lineas).forEach(function (q) { var l = fac.lineas[q.i]; bienes.push({ desc: GR_corto_(l), lote: l.lote, unidad: String(l.unidad).split(' - ')[0], cant: q.cant }); });
      origen = 'según «Producto y cantidad»';
    } else if ((ctx.prod[id] || []).length) {
      ctx.prod[id].forEach(function (p) { bienes.push({ desc: GR_corto_(p), lote: p.lote, unidad: p.unidad, cant: p.cant }); });
      origen = 'de 📦 Productos';
    } else if (fac.lineas.length && t('total') !== 'NO') {
      fac.lineas.forEach(function (l) { bienes.push({ desc: GR_corto_(l), lote: l.lote, unidad: String(l.unidad).split(' - ')[0], cant: l.cant }); });
      origen = 'todo lo de la factura';
    } else origen = t('total') === 'NO' ? 'falta elegir los productos' : 'todo lo de la factura (use 📥 Traer datos para verlos aquí)';
  } catch (e) { origen = '⚠️ ' + e.message; }
  var privado = t('modalidad').slice(0, 2) === '02';
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'dd/MM/yyyy');
  return {
    id: id, estado: t('estado'), faltas: v.faltas, avisos: v.avisos, donde: t('via') === 'SUNAT' ? 'SUNAT SOL' : 'Quesito',
    remitente: { nombre: String(emp.razon || r.empresa || ''), ruc: emp.ruc || '', serie: String(emp.serie || '') },
    numero: t('guia'), emision: t('femision') || hoy + ' (hoy)', traslado: t('fecha'), entrega: t('fentrega') || t('fecha'),
    motivo: t('motivo'), motivoTxt: t('motivoTxt'), modalidad: t('modalidad'), peso: t('peso'), upeso: t('upeso').split(' - ')[0], bultos: t('bultos'),
    destinatario: { tipo: t('tdest'), doc: t('ndest'), nombre: t('dest') },
    documento: t('docrel') === 'Ninguno' ? '' : (t('numero') ? t('docrel') + ' ' + t('serie') + '-' + t('numero') : (t('cotizacion') ? 'Cotización ' + t('cotizacion') + ' (la factura se busca al emitir)' : '')),
    partida: { dir: t('pdir'), ubi: t('pubi'), cod: t('pest') }, llegada: { dir: t('ldir'), ubi: t('lubi'), cod: t('lest') },
    transportista: privado ? null : { ruc: t('truc'), nombre: t('tnom'), mtc: t('mtc') },
    vehiculos: [t('placa'), t('placa2')].filter(String).map(function (p, i) { return { placa: p, cert: t(i ? 'mtcveh2' : 'mtcveh'), rol: i ? 'Secundario' : 'Principal' }; }),
    conductor: t('cdni') || t('cnom') ? { dni: t('cdni'), nombre: (t('cnom') + ' ' + t('cape')).trim(), licencia: t('clic') } : null,
    privado: privado, m1: t('m1') === 'SI', bienes: bienes, bienesOrigen: origen, observaciones: t('obsFinal') || t('obs')
  };
}

/** Guarda el borrador como PDF en Drive (carpeta «Guías · borradores» junto a la hoja). → url */
function GR_borradorPdf(id, html) {
  var ss = SpreadsheetApp.getActive(), padre;
  try { padre = DriveApp.getFileById(ss.getId()).getParents().next(); } catch (e) { padre = DriveApp.getRootFolder(); }
  var it = padre.getFoldersByName('Guías · borradores'), carpeta = it.hasNext() ? it.next() : padre.createFolder('Guías · borradores');
  var nombre = 'Borrador guía ' + id + ' ' + Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd HHmm');
  var pdf = Utilities.newBlob('<html><head><meta charset="utf-8"></head><body>' + html + '</body></html>', 'text/html', nombre + '.html').getAs('application/pdf').setName(nombre + '.pdf');
  var f = carpeta.createFile(pdf);
  GR_registrar_(id, '🧾 Borrador PDF', nombre);
  return f.getUrl();
}
