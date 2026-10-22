"""Sondeo de SOLO LECTURA (camino A, SEE-SOL): ¿dónde está la emisión del Comprobante de Retención
Electrónico y qué campos pide? Entra a SOL, lista las opciones del menú que hablan de retención y,
de las de emisión, muestra NOMBRES de campos, listas y rutas. No llena ni envía nada.
Nunca imprime claves, tokens ni valores de campos (el repositorio es público)."""
import html, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from descargar_cre import Sol, MENU  # mismo ingreso a SOL que la descarga diaria


def limpio(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def estructura(pag, titulo):
    print(f'\n================ {titulo} · {len(pag)} bytes')
    print('Título:', limpio((re.search(r'<title>(.*?)</title>', pag, re.S | re.I) or [None, ''])[1])[:120])
    for f in re.finditer(r'<(?:iframe|frame)[^>]*src="([^"]+)"', pag, re.I):
        print('FRAME', f.group(1).split('?')[0])
    for f in re.finditer(r'<form[^>]*>', pag, re.I):
        a = re.search(r'action="([^"]*)"', f.group(0))
        print('FORM action=', (a.group(1).split('?')[0] if a else ''))
    for i in re.finditer(r'<input[^>]*>', pag, re.I):
        n = re.search(r'\b(?:name|id)="([^"]+)"', i.group(0))
        t = re.search(r'\btype="([^"]+)"', i.group(0))
        if n and (not t or t.group(1).lower() != 'hidden'):
            print('  INPUT', n.group(1), t.group(1) if t else 'text')
    ocultos = [re.search(r'\b(?:name|id)="([^"]+)"', i.group(0)).group(1) for i in re.finditer(r'<input[^>]*type="hidden"[^>]*>', pag, re.I)
               if re.search(r'\b(?:name|id)="([^"]+)"', i.group(0))]
    if ocultos: print('  OCULTOS (solo nombres):', ocultos[:40])
    for s in re.finditer(r'<select[^>]*(?:name|id)="([^"]+)"[^>]*>(.*?)</select>', pag, re.S | re.I):
        ops = [limpio(x) for x in re.findall(r'<option[^>]*>(.*?)</option>', s.group(2), re.S | re.I)][:15]
        print('  SELECT', s.group(1), ':', ' | '.join(ops))
    textos = [limpio(x) for x in re.findall(r'<(?:label|th|button|legend|h\d)[^>]*>(.*?)</(?:label|th|button|legend|h\d)>', pag, re.S | re.I)]
    print('  ETIQUETAS:', ' | '.join(dict.fromkeys(t for t in textos if 2 < len(t) < 70))[:1500])
    print('  RUTAS:', sorted(set(re.findall(r'["\']((?:\.{0,2}/)?[\w/\-.]+\.(?:htm|html|do|json|jsp|action)|/v\d/[\w/\-{}]+)["\']', pag)))[:50])
    print('  SCRIPTS:', [x.split('?')[0] for x in re.findall(r'<script[^>]*src="([^"]+)"', pag, re.I)][:25])
    print('  FUNCIONES:', sorted(set(re.findall(r'function\s+(\w+)\s*\(', pag)))[:60])


sol = Sol()
sol.login(os.environ['SUNAT_RUC'], os.environ['SUNAT_USUARIO'], os.environ['SUNAT_CLAVE'])
print('Login OK')
sol.pedir(MENU, {'action': 'prevApp'})
_, menu = sol.pedir(MENU)
opciones = {}
for m in re.finditer(r'(\d{1,2}(?:\.\d{1,2}){3,6})', menu):
    ventana = limpio(menu[max(0, m.start() - 30): m.end() + 300])
    if re.search(r'etenci', ventana, re.I) and m.group(1) not in opciones:
        opciones[m.group(1)] = ventana[:220]
print('\n== Opciones del menú con "retención" ==')
for c in sorted(opciones, key=lambda x: [int(p) for p in x.split('.')]):
    print(c, '·', opciones[c])

objetivos = [c for c, t in opciones.items() if re.search(r'emisi|emitir', t, re.I) and not re.search(r'consult', t, re.I)]
for cod in (objetivos or list(opciones))[:4]:
    sol.pedir(MENU, {'action': 'prevApp'})
    st, pag = sol.pedir(f'{MENU}?action=execute&code={cod}')
    estructura(pag, f'{cod} · HTTP {st} · {sol.ultima_url.split("?")[0]}')
    # Si la página es un marco, se abre también lo que carga dentro (solo lectura).
    for src in re.findall(r'<(?:iframe|frame)[^>]*src="([^"]+)"', pag, re.I)[:2]:
        url = src if src.startswith('http') else re.sub(r'/[^/]*$', '/', sol.ultima_url.split('?')[0]) + src.lstrip('./')
        st2, pag2 = sol.pedir(url)
        estructura(pag2, f'  marco {url.split("?")[0]} · HTTP {st2}')
