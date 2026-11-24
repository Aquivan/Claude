#!/usr/bin/env python3
"""
🩺 Registro técnico en TODOS los sistemas: agrega a cada proyecto Apps Script un archivo REG_Registro.js
(desde scripts/registro_plantilla.js) y «envuelve» sus procesos automáticos para que anoten inicio / fin / error.

Envolver = la función original pasa a llamarse NOMBRE__reg y NOMBRE (la que llaman los disparadores) queda en
REG_Registro.js llamando a REG_envolver_. Es idempotente: se puede correr varias veces.
Uso: python3 scripts/registro_tecnico.py
"""
import os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTILLA = open(os.path.join(RAIZ, 'scripts', 'registro_plantilla.js'), encoding='utf-8').read()

# carpeta, sistema, modo, {función: opciones}
PROYECTOS = [
    ('cobranzas', 'Cobranzas', 'central', {
        'actualizacionAutomatica': {'inicio': True},
        'TGP_seguirAnalisis': {'inicio': True},
        'TG_seguirDescargas': {'soloLento': 20},
        'VIG_paso': {'soloLento': 30},
        'VIG_semanal': {},
        'TG_resumenManana': {},
        'MESA_recalcular': {'soloLento': 30},
        'doPost': {'soloLento': 25},
    }),
    ('apps_script', 'SIRE', 'central', {
        'ejecucionDiariaAutomatica': {'inicio': True},
        'importacionAutomatica': {'inicio': True},
        'seguimientoAutomatico': {'soloLento': 30},
        'continuarColaLiquidaciones': {'inicio': True},
        'reintentarSirePendientes': {},
        'procesarColaWebhook': {'soloLento': 30},
    }),
    ('declaraciones/apps_script', 'Declaraciones', 'central', {
        'DEC_mensual': {'inicio': True},
    }),
    ('detracciones/apps_script', 'Detracciones', 'propia', {
        'DET_actualizacionAutomatica': {'inicio': True},
        'DET_trasDescarga': {'inicio': True},
        'DET_importarTrasDescarga': {'inicio': True},
        'DET_continuarConstancias': {'inicio': True},
        'DET_reintentar': {},
        'DET_trasReintento': {},
    }),
    ('honorarios/apps_script', 'Honorarios', 'propia', {
        'HON_actualizacionAutomatica': {'inicio': True},
        'HON_importarTrasDescarga': {'inicio': True},
        'HON_continuarPdf': {'inicio': True},
    }),
    ('notificaciones/apps_script', 'Notificaciones', 'propia', {
        'NOT_actualizacionAutomatica': {'inicio': True},
        'NOT_trasDescarga': {'inicio': True},
        'NOT_importarTrasDescarga': {'inicio': True},
        'NOT_continuarPdf': {'inicio': True},
    }),
    ('retenciones/apps_script', 'Retenciones', 'propia', {
        'RET_actualizacionAutomatica': {'inicio': True},
        'RET_importarTrasDescarga': {'inicio': True},
        'RET_continuarPdf': {'inicio': True},
    }),
    ('guias/apps_script', 'Guías', 'propia', {
        'GR_revisarResultados': {'soloLento': 20},
    }),
]

def js_opc(o):
    partes = []
    if o.get('inicio'): partes.append('inicio: true')
    if o.get('soloLento'): partes.append('soloLento: %d' % o['soloLento'])
    return '{ ' + ', '.join(partes) + ' }' if partes else '{}'

errores = []
for carpeta, sistema, modo, funcs in PROYECTOS:
    d = os.path.join(RAIZ, carpeta)
    archivos = []
    for raiz, _, fs in os.walk(d):
        if 'node_modules' in raiz: continue
        for f in fs:
            if f.endswith('.js') and f != 'REG_Registro.js': archivos.append(os.path.join(raiz, f))
    # 🧹 procesos «de una vez» (.timeBased().after()): se envuelven también (solo anotan si fallan o tardan > 10 min)
    # para que borren el disparador que los despertó. Se excluyen los async y los que además se repiten.
    todo = '\n'.join(open(a, encoding='utf-8').read() for a in archivos)
    una_vez = []
    for h in sorted(set(re.findall(r"newTrigger\('(\w+)'\)\s*\.timeBased\(\)\s*\.after", todo))):
        if re.search(r"newTrigger\('" + h + r"'\)\s*\.timeBased\(\)\s*\.(every|onWeekDay|atHour|at\(|onMonthDay|atDate)", todo):
            continue   # también se repite: no se borra
        if re.search(r'^\s*async\s+function ' + re.escape(h) + r'(__reg)?\s*\(', todo, re.M):
            continue   # async: el envoltorio no espera su fin
        una_vez.append(h)
        if h not in funcs: funcs = dict(funcs, **{h: {'soloLento': 600}})
    envolturas = []
    for fn, opc in funcs.items():
        rx = re.compile(r'^(\s*)function ' + re.escape(fn) + r'\s*\(', re.M)
        rx_ya = re.compile(r'^\s*function ' + re.escape(fn) + r'__reg\s*\(', re.M)
        donde = [a for a in archivos if rx.search(open(a, encoding='utf-8').read())]
        ya = [a for a in archivos if rx_ya.search(open(a, encoding='utf-8').read())]
        if ya and not donde:
            pass   # ya envuelta antes
        elif len(donde) == 1:
            t = open(donde[0], encoding='utf-8').read()
            t = rx.sub(lambda m: m.group(1) + 'function ' + fn + '__reg(', t, count=1)
            open(donde[0], 'w', encoding='utf-8').write(t)
        else:
            errores.append('%s: %s aparece %d veces' % (carpeta, fn, len(donde)))
            continue
        envolturas.append('function %s() { return REG_envolver_(%r, %s__reg, arguments, %s); }' % (fn, fn, fn, js_opc(opc)))
    cuerpo = PLANTILLA.replace('__SISTEMA__', sistema).replace('__MODO__', modo).replace('__UNA_VEZ__', repr(una_vez).replace("'", '"'))
    cuerpo += '\n/* ------------------------------------------------ procesos automáticos envueltos */\n\n' + '\n'.join(envolturas) + '\n'
    open(os.path.join(d, 'REG_Registro.js'), 'w', encoding='utf-8').write(cuerpo)
    print('%-28s %-14s %-8s %d procesos' % (carpeta, sistema, modo, len(envolturas)))
if errores:
    print('\n'.join(errores)); sys.exit(1)
