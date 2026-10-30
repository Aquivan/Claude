/**
 * 🌙 Descargas de madrugada (puntuales) y ☀️ reloj del resumen de la mañana.
 *
 * El reloj programado de GitHub (cron) arranca las corridas con 3 a 7 horas de atraso
 * (o se las salta). En cambio una corrida PEDIDA (workflow_dispatch) arranca en segundos.
 * Por eso el vigía del bot (cada hora) pide cada descarga diaria a la hora elegida en la
 * pestaña 🤖 Telegram («Descargas de madrugada»), solo si ese día todavía no corrió.
 * Usa los mismos nombres de corrida que las hojas («… · diario»), así ni la hoja ni el
 * cron de respaldo la repiten, y la hoja la importa con su ⏰ actualización diaria.
 * Funciones TGN_.
 */

var TGN_TAREAS_ = {
  sire: { nombre: 'SIRE', wf: 'sire-cadena-completa.yml', titulo: /^SIRE diario/,
    inputs: function () { return { periodo: '', tipo: 'ambos', modo: 'completo', ruc: '', mes_anterior: 'diario' }; } },
  notificaciones: { nombre: 'Notificaciones', wf: 'notificaciones-descargar.yml', titulo: /^Notificaciones · diario$/,
    inputs: function () { return { empresa: 'todas', desde: TG_mes_(2), diario: 'true' }; } },
  retenciones: { nombre: 'Retenciones', wf: 'retenciones-descargar.yml', titulo: /^Retenciones · diario$/,
    inputs: function () { return { empresa: 'todas', periodo: TG_mes_(1), hasta: '', diario: 'true' }; } },
  detracciones: { nombre: 'Detracciones', wf: 'detracciones-descargar.yml', titulo: /^Detracciones · diario$/,
    inputs: function () { return { empresa: 'todas', desde: '', diario: 'true' }; } },
  honorarios: { nombre: 'Honorarios', wf: 'honorarios-descargar.yml', titulo: /^Honorarios · diario$/,
    inputs: function () { return { empresa: 'todas', periodo: TG_mes_(1), hasta: '', diario: 'true' }; } }
};

/** «SIRE 1, Notificaciones 2, …» → {sire: 1, notificaciones: 2, …}. Vacío o NO = apagado. */
function TGN_horario_(texto) {
  var h = {};
  String(texto || '').split(/[,;\n]+/).forEach(function (p) {
    var m = p.trim().match(/^([a-záéíóú]+)\D*(\d{1,2})/i);
    if (!m) return;
    var k = Object.keys(TGN_TAREAS_).filter(function (x) { return x === m[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); })[0];
    var hora = parseInt(m[2], 10);
    if (k && hora >= 0 && hora <= 23) h[k] = hora;
  });
  return h;
}

/** Lo llama el vigía (cada hora): pide las descargas cuya hora ya llegó y que hoy no corrieron. */
function TGN_revisar_(cfg) {
  if (!cfg.github) return;
  var horario = TGN_horario_(cfg.noche);
  var hora = Number(Utilities.formatDate(new Date(), 'America/Lima', 'H'));
  var hoy = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
  var desde = new Date(hoy + 'T05:00:00Z').getTime();   // 0:00 de hoy en Lima
  var props = PropertiesService.getScriptProperties();
  Object.keys(horario).forEach(function (k) {
    var h = horario[k];
    if (hora < h || hora >= h + 6) return;   // solo dentro de las 6 horas siguientes a la elegida
    var t = TGN_TAREAS_[k], pk = 'TGN_' + k, est = {};
    try { est = JSON.parse(props.getProperty(pk) || '{}'); } catch (e) {}
    if (est.d !== hoy) est = { d: hoy, n: 0, t: 0 };
    if (est.listo || est.n >= 2) return;                    // ya corrió, o ya se intentó 2 veces hoy
    if (est.t && Date.now() - est.t < 45 * 60000) return;   // recién pedida: GitHub aún no la muestra
    try {
      var hoyRuns = TG_ghRuns_(cfg, 30, t.wf).filter(function (r) { return new Date(r.created_at).getTime() >= desde && t.titulo.test(r.display_title || r.name || ''); });
      if (hoyRuns.some(function (r) { return r.status !== 'completed' || r.conclusion === 'success'; })) { est.listo = true; props.setProperty(pk, JSON.stringify(est)); return; }
      TG_gh_(cfg, '/actions/workflows/' + t.wf + '/dispatches', 'post', { ref: cfg.rama, inputs: t.inputs() });
      est.n++; est.t = Date.now();
      props.setProperty(pk, JSON.stringify(est));
      console.log('🌙 Descarga de madrugada pedida: ' + t.nombre + ' (intento ' + est.n + ')');
    } catch (e) { console.warn('🌙 ' + t.nombre + ': ' + e.message); }
  });
}

/* ============================================================ ☀️ resumen a la hora exacta */

/** Reloj propio del resumen (Google lo dispara a la hora elegida ±15 min). Se rehace si cambia la hora. */
function TGN_relojResumen_(cfg) {
  var props = PropertiesService.getScriptProperties();
  var h = cfg.horaResumen >= 0 && cfg.horaResumen <= 23 ? cfg.horaResumen : -1;
  var hay = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'TG_resumenManana'; });
  if (String(h) === props.getProperty('TGN_RELOJ_RESUMEN') && hay.length === (h >= 0 ? 1 : 0)) return;
  hay.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  if (h >= 0) ScriptApp.newTrigger('TG_resumenManana').timeBased().everyDays(1).atHour(h).nearMinute(0).inTimezone('America/Lima').create();
  props.setProperty('TGN_RELOJ_RESUMEN', String(h));
}

/** Disparador diario: manda el ☀️ resumen (una sola vez al día; el vigía queda de respaldo). */
function TG_resumenManana() {
  var ss = TG_ss_();
  var cfg = TG_cfg_(ss);
  if (!cfg.avisosActivos || !TG_token_()) return;
  TG_mandarResumenDia_(ss, TG_usuarios_(ss).filter(function (u) { return u.activo; }));
}
