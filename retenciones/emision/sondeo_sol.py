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


FUNCS = ['initVariables', 'setValoresDefecto', 'initComponentes', 'agregarDocumento', 'buscarUltimoNroPago', 'calcularRetencion',
         'calcularImporteOperacion', 'getTasas', 'irVistaPreliminar', 'jqueryValida', 'updateTblDocumentosRelacionados', 'existFacturaEnDocsRel',
         'initCompoDlg', 'cargarComboJSON', 'cargarCombo', 'startAjax', 'mostrarDialogAgregarEditar', 'calcularTipoCambio']


def cuerpo_funcion(js, nombre):
    """Código de una función (por llaves balanceadas)."""
    m = re.search(r'function\s+' + nombre + r'\s*\([^)]*\)\s*\{', js)
    if not m: return ''
    i, nivel = m.end(), 1
    while i < len(js) and nivel:
        nivel += {'{': 1, '}': -1}.get(js[i], 0); i += 1
    return js[m.start():i]


def sin_datos(t):
    """Oculta números largos (RUC, DNI, montos) y correos por si la página trae datos de la empresa."""
    t = re.sub(r'\b\d{6,}\b', '#####', t)
    return re.sub(r'[\w.+-]+@[\w-]+\.[\w.]+', '***@***', t)


sol = Sol()
sol.login(os.environ['SUNAT_RUC'], os.environ['SUNAT_USUARIO'], os.environ['SUNAT_CLAVE'])
print('Login OK')
sol.pedir(MENU, {'action': 'prevApp'})
st, pag = sol.pedir(f'{MENU}?action=execute&code=11.5.8.1.1')
print('Emitir CRE:', st, sol.ultima_url.split('?')[0], len(pag), 'bytes')
js = '\n'.join(re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', pag, re.S | re.I))
print('Variables globales:', sorted(set(re.findall(r'^\s*var\s+(\w+)', js, re.M)))[:80])
print('\n== Llamadas ajax / url / submit ==')
for m in re.finditer(r'.{0,120}(?:\$\.ajax|\$\.post|\$\.getJSON|url\s*:|\.submit\(|action\s*=|window\.location).{0,220}', js):
    print('  ', sin_datos(re.sub(r'\s+', ' ', m.group(0)))[:340])
for f in FUNCS:
    c = cuerpo_funcion(js, f)
    if c:
        print('\n----------', f, '(' + str(len(c)) + ' car.)')
        print(sin_datos(c)[:3500])
# Formulario de vista preliminar (solo nombres de campos)
form = re.search(r'<form[^>]*verVistaPreliminar[^>]*>(.*?)</form>', pag, re.S | re.I)
if form:
    print('\n== Campos del formulario verVistaPreliminar ==', re.findall(r'name="([^"]+)"', form.group(1)))
