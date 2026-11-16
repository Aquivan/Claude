// ============================================================
// 🌐 PUENTE CON EL PORTAL WEB DE VOUCHERS (proyecto aparte: vouchers_portal/)
// ------------------------------------------------------------
// El portal (celular / PC, usuario y PIN) lee y escribe la hoja él mismo. Solo
// para lo que necesita la IA y los procesos de ESTA hoja llama aquí:
//   ?portal=1&k=CLAVE&op=procesar                -> procesar Entrada en ~1 minuto
//   ?portal=1&k=CLAVE&op=releer&hoja=..&fila=..  -> volver a leer con IA (no escribe)
//   ?portal=1&k=CLAVE&op=releerEstado&id=..      -> resultado de esa lectura
//   ?portal=1&k=CLAVE&op=releerAplicar&id=..&i=n -> reemplazar la fila con la opción n
//   ?portal=1&k=CLAVE&op=deshacer                -> deshacer la última relectura
//   ?portal=1&k=CLAVE&op=conexionIA              -> la conexión del 🧠 Asistente IA con Cobranzas (solo servidor a servidor)
// Responde JSON (nunca una página: así nadie puede llamar desde aquí otras
// funciones de la hoja). La CLAVE la genera el portal y la deja en los
// metadatos de la hoja (no se ven en la hoja ni van al repositorio).
// Lo llama doGet (Diagnostico.js). Funciones PVP_.
// ============================================================

function PVP_get_(p) {
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const m = ss.createDeveloperMetadataFinder().withKey('PV_PUENTE').find();
  const clave = m.length ? String(m[0].getValue() || '') : '';
  if (clave.length < 40 || !p.k || !tokensIguales_(String(p.k), clave)) return { ok: false, error: 'No autorizado' };
  const hojaOk = function (h) {
    if ([CFG.SHEET_ORIGINALES, CFG.SHEET_FOTOS].indexOf(String(h)) === -1) throw new Error('Pestaña no válida.');
    return String(h);
  };
  try {
    switch (p.op) {
      case 'ping': return { ok: true };
      case 'procesar': programarReintentoAutomatico_(); return { ok: true, mensaje: 'Se procesa en ~1 minuto.' };
      case 'releer': {
        const fila = parseInt(p.fila, 10);
        if (!(fila >= 2)) throw new Error('Fila no válida.');
        return { ok: true, id: RP_visorIniciar(hojaOk(p.hoja), fila) };
      }
      case 'releerEstado': {
        const r = RP_visorEstado(String(p.id || ''));
        r.ok = !r.error;
        return r;
      }
      case 'releerAplicar': {
        const r2 = RP_visorAplicar(String(p.id || ''), parseInt(p.i, 10) || 0);
        r2.ok = !r2.error;
        if (r2.mensaje) r2.mensaje = r2.mensaje.replace('menú 🤖 Vouchers → ↩️ Deshacer la última relectura', 'botón ↩️ Deshacer relectura');
        return r2;
      }
      case 'conexionIA': {   // 🧠 la conexión de esta hoja con Cobranzas (asistente_ia/AsistenteIA.js), para que el portal use el mismo asistente
        if (typeof VIA_llamar_ !== 'function' || typeof VIA_clave_ !== 'function') return { ok: false, error: 'Esta hoja no tiene el 🧠 Asistente IA.' };
        return { ok: true, url: VIA_URL_, clave: VIA_clave_() };
      }
      case 'deshacer': {
        const u = RP_deshacer_();
        return { ok: true, u: u ? { hoja: u.hoja, fila: u.fila } : null };
      }
    }
    return { ok: false, error: 'Operación desconocida.' };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
