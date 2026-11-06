/**
 * ⏱ Minutos de GitHub Actions del mes (TGM_).
 *
 * GitHub regala 2,000 minutos al mes para repositorios PRIVADOS (los públicos no gastan). Cada trabajo («job») se
 * cobra redondeado hacia arriba al minuto. Aquí se suman así, igual que GitHub, desde el día 1 del mes:
 *   - Se mide solo, cada 6 horas, dentro del vigía (sin gastar minutos de GitHub: lo hace la hoja).
 *   - Avisa por Telegram a los administradores al pasar 50%, 75%, 90% y 100% (una vez cada uno por mes, solo si el
 *     repositorio es privado) y manda un resumen los lunes.
 *   - «minutos» en Telegram o WhatsApp: el reporte en cualquier momento.
 * El límite se cambia con la propiedad del script TGM_LIMITE (por defecto 2000).
 * Es una estimación propia: la cifra oficial está en GitHub → Settings → Billing and plans.
 */

var TGM_UMBRALES_ = [50, 75, 90, 100];

function TGM_limite_() { return Number(PropertiesService.getScriptProperties().getProperty('TGM_LIMITE')) || 2000; }

function TGM_estado_() {
  var mes = Utilities.formatDate(new Date(), 'UTC', 'yyyyMM');
  var e = {};
  try { e = JSON.parse(PropertiesService.getScriptProperties().getProperty('TGM_ESTADO') || '{}'); } catch (x) { e = {}; }
  if (e.mes !== mes) e = { mes: mes, min: 0, ult: 0, pend: [], wf: {}, avisos: [], t: 0 };
  return e;
}
function TGM_guardar_(e) { PropertiesService.getScriptProperties().setProperty('TGM_ESTADO', JSON.stringify(e)); }

/** Suma los trabajos nuevos (o que estaban en curso) desde la última medición. */
function TGM_medir_(cfg) {
  var e = TGM_estado_();
  var desde = e.mes.slice(0, 4) + '-' + e.mes.slice(4) + '-01';
  var porRevisar = [], vistos = {}, pagina = 1, maxId = e.ult, pend = {};
  (e.pend || []).forEach(function (id) { pend[id] = 1; });
  while (pagina <= 20) {
    var d = TG_gh_(cfg, '/actions/runs?per_page=100&page=' + pagina + '&created=%3E%3D' + desde);
    var rs = d.workflow_runs || [];
    var nuevos = 0;
    rs.forEach(function (r) {
      if (vistos[r.id]) return; vistos[r.id] = 1;
      if (r.id > e.ult || pend[r.id]) { porRevisar.push(r); nuevos++; }
      if (r.id > maxId) maxId = r.id;
    });
    if (rs.length < 100 || (!nuevos && !(e.pend || []).length)) break;
    pagina++;
  }
  var enCurso = [];
  var completas = porRevisar.filter(function (r) { if (r.status !== 'completed') { enCurso.push(r.id); return false; } return true; });
  // los trabajos de cada corrida, de a 20 a la vez
  var hdr = { Authorization: 'Bearer ' + cfg.github, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  for (var i = 0; i < completas.length; i += 20) {
    var lote = completas.slice(i, i + 20);
    var resp = UrlFetchApp.fetchAll(lote.map(function (r) {
      return { url: 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.nombreRepo + '/actions/runs/' + r.id + '/jobs?per_page=100&filter=all', headers: hdr, muteHttpExceptions: true };
    }));
    resp.forEach(function (x, j) {
      var r = lote[j];
      if (x.getResponseCode() !== 200) { enCurso.push(r.id); return; }   // se reintenta en la próxima medición
      var min = 0;
      (JSON.parse(x.getContentText()).jobs || []).forEach(function (job) {
        if (!job.started_at || !job.completed_at || job.conclusion === 'skipped') return;
        var s = (new Date(job.completed_at) - new Date(job.started_at)) / 1000;
        if (s > 0) min += Math.ceil(s / 60);
      });
      var nom = String(r.name || '').split(' · ')[0].slice(0, 40);
      e.min += min; e.wf[nom] = (e.wf[nom] || 0) + min;
    });
  }
  e.ult = maxId; e.pend = enCurso.slice(0, 200); e.t = Date.now();
  TGM_guardar_(e);
  return e;
}

function TGM_privado_(cfg) {
  try { return !!TG_gh_(cfg, '').private; } catch (x) { return null; }
}

/** Texto del reporte (sin HTML; el que llama lo escapa). */
function TGM_texto_(cfg, e, privado) {
  var lim = TGM_limite_(), pct = Math.round(e.min / lim * 100);
  var hoy = new Date(), dia = Number(Utilities.formatDate(hoy, 'UTC', 'd'));
  var diasMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0)).getUTCDate();
  var proy = Math.round(e.min / Math.max(dia, 1) * diasMes);
  var top = Object.keys(e.wf).sort(function (a, b) { return e.wf[b] - e.wf[a]; }).slice(0, 6)
    .map(function (k) { return '• ' + k + ': ' + e.wf[k] + ' min'; }).join('\n');
  var barra = '';
  for (var i = 0; i < 10; i++) barra += i < Math.min(10, Math.round(pct / 10)) ? '▰' : '▱';
  return '⏱ Minutos de GitHub este mes (hasta hoy, día ' + dia + ')\n' +
    barra + ' ' + e.min + ' de ' + lim + ' min · ' + pct + '%\n' +
    'Al ritmo de este mes terminaría en unos ' + proy + ' min (' + Math.round(proy / lim * 100) + '%).\n' +
    (privado === false ? '🔓 Hoy el repositorio es PÚBLICO: estos minutos no se cobran. El cálculo es para cuando lo pase a privado.\n' :
      privado ? '🔒 Repositorio privado: cuentan para el plan gratis de ' + lim + ' min.\n' : '') +
    (top ? '\nLos que más gastan:\n' + top + '\n' : '') +
    '\n(Estimación de la hoja; la cifra oficial está en GitHub → Settings → Billing and plans.)';
}

/** Lo llama el vigía: mide cada 6 horas, avisa al pasar 50/75/90/100% y manda un resumen los lunes. */
function TGM_revisar_(ss, cfg) {
  if (!cfg.github) return;
  var e = TGM_estado_();
  if (e.t && Date.now() - e.t < 6 * 3600 * 1000) return;
  e = TGM_medir_(cfg);
  var privado = TGM_privado_(cfg), lim = TGM_limite_(), pct = e.min / lim * 100;
  var msgs = [];
  if (privado) {
    TGM_UMBRALES_.forEach(function (u) {
      if (pct >= u && (e.avisos || []).indexOf(u) < 0) { (e.avisos = e.avisos || []).push(u); msgs.push(u); }
    });
  }
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyyMMdd'), lunes = Utilities.formatDate(new Date(), 'America/Lima', 'u') === '1';
  var semanal = lunes && e.lunes !== hoy && Number(Utilities.formatDate(new Date(), 'America/Lima', 'H')) >= 8;
  if (semanal) e.lunes = hoy;
  TGM_guardar_(e);
  if (!msgs.length && !semanal) return;
  var cab = msgs.length ? (msgs[msgs.length - 1] >= 100 ? '🔴 Se llegó al 100% de los minutos gratis de GitHub del mes.\n' : '🟡 Ya se usó el ' + msgs[msgs.length - 1] + '% de los minutos gratis de GitHub del mes.\n') : '🗓 Resumen semanal\n';
  var html = TG_esc_(cab + TGM_texto_(cfg, e, privado));
  TG_admins_(ss).forEach(function (a) { try { TG_enviar_(a.chatId, html); } catch (x) {} });
}

var TGM_RX_ = /^\s*\/?(minutos|minutos de github|consumo de github|cu[aá]ntos minutos)\b/i;

/** «minutos» en Telegram o WhatsApp: mide (si pasó más de 1 hora) y responde. */
function TGM_respuesta_(cfg) {
  if (!cfg.github) return 'Falta el token de GitHub en la hoja de Cobranzas.';
  var e = TGM_estado_();
  if (!e.t || Date.now() - e.t > 3600 * 1000) e = TGM_medir_(cfg);
  return TGM_texto_(cfg, e, TGM_privado_(cfg));
}
