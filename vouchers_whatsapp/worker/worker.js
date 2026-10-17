/**
 * 📲 Puente WhatsApp → Apps Script (Cloudflare Worker, plan gratuito).
 *
 * Por qué existe: Meta no puede hablar directo con Apps Script (Apps Script
 * contesta con una redirección 302 y no deja leer la firma del mensaje).
 * Este puente:
 *   1. Responde la verificación del webhook de Meta (GET con hub.challenge).
 *   2. Comprueba que cada aviso venga de Meta (firma X-Hub-Signature-256).
 *   3. Contesta 200 al instante (así Meta no reintenta ni duplica).
 *   4. Reenvía a Apps Script SOLO los avisos que traen mensajes
 *      (los de "entregado/leído" se descartan aquí y no gastan nada).
 *
 * Variables (Cloudflare → Worker → Settings → Variables and Secrets):
 *   VERIFY_TOKEN  texto que usted inventa; el mismo se pone en Meta.
 *   APP_SECRET    Meta → su app → Configuración de la app → Básica → Clave secreta.
 *   GAS_URL       dirección /exec de la aplicación web "Vouchers WhatsApp".
 *   GAS_TOKEN     clave que muestra el menú 📲 WhatsApp → Datos para Cloudflare.
 */
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      if (url.searchParams.get('hub.mode') === 'subscribe') {
        if (env.VERIFY_TOKEN && url.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN) {
          return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
        }
        return new Response('verify_token incorrecto', { status: 403 });
      }
      const falta = ['VERIFY_TOKEN', 'APP_SECRET', 'GAS_URL', 'GAS_TOKEN'].filter((k) => !env[k]);
      return new Response(falta.length ? 'Faltan variables: ' + falta.join(', ') : 'Puente WhatsApp listo ✅', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 });

    const cuerpo = await req.text();
    if (!(await firmaValida_(cuerpo, req.headers.get('x-hub-signature-256') || '', env.APP_SECRET))) {
      return new Response('firma inválida', { status: 401 });
    }

    let datos;
    try { datos = JSON.parse(cuerpo); } catch (e) { return new Response('OK'); }
    if (traeMensajes_(datos)) ctx.waitUntil(reenviar_(cuerpo, env));
    return new Response('OK');
  },
};

function traeMensajes_(datos) {
  return (datos.entry || []).some((e) => (e.changes || []).some((c) => ((c.value || {}).messages || []).length));
}

async function reenviar_(cuerpo, env) {
  const destino = env.GAS_URL + (env.GAS_URL.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(env.GAS_TOKEN);
  for (let intento = 1; intento <= 3; intento++) {
    try {
      // Apps Script corre doPost al recibir el POST; la redirección que sigue solo trae la respuesta.
      const r = await fetch(destino, { method: 'POST', body: cuerpo, headers: { 'content-type': 'application/json' }, redirect: 'follow' });
      if (r.ok) return;
      console.log('Apps Script respondió ' + r.status + ' (intento ' + intento + ')');
    } catch (e) {
      console.log('No se pudo llegar a Apps Script: ' + e.message + ' (intento ' + intento + ')');
    }
    await new Promise((ok) => setTimeout(ok, 1500 * intento));
  }
}

async function firmaValida_(cuerpo, cabecera, secreto) {
  if (!secreto || !cabecera.startsWith('sha256=')) return false;
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(cuerpo)));
  const esperado = Array.from(firma, (b) => b.toString(16).padStart(2, '0')).join('');
  const recibido = cabecera.slice(7).toLowerCase();
  if (recibido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return dif === 0;
}
