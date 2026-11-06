"""Recolecta, del propio repositorio, los datos para el manual (archivos, robots, propiedades, menús).
Lo usa scripts/generar_manual.py. No lee carpetas de datos ni muestra valores secretos (solo nombres)."""
import os, re, subprocess, yaml

EXCLUIR = ('facturas_descargadas', 'sire/', 'vouchers_bot_respaldo', 'detracciones/datos', 'honorarios/datos',
           'retenciones/datos', 'notificaciones/datos', 'guias/datos')


def _primer_comentario(lineas, py):
    """Primer bloque de comentario del archivo, leído línea por línea (sin expresiones regulares pesadas)."""
    out, dentro, cierre = [], False, None
    for l in lineas[:80]:
        s = l.strip()
        if not dentro:
            if not s or s.startswith('#!') or s.startswith('// @') or s.startswith('<!'):
                continue
            if py and (s.startswith('"""') or s.startswith("'''")):
                cierre = s[:3]; s = s[3:]
                if cierre in s:
                    return s.split(cierre)[0].strip()
                dentro = True; out.append(s); continue
            if py and s.startswith('#'):
                out.append(s.lstrip('#').strip()); continue
            if not py and s.startswith('/*'):
                cierre = '*/'; s = s.lstrip('/*').strip()
                if '*/' in s:
                    return s.split('*/')[0].strip()
                dentro = True; out.append(s); continue
            if not py and s.startswith('//'):
                out.append(s.lstrip('/').strip()); continue
            break
        else:
            if cierre in s:
                out.append(s.split(cierre)[0].lstrip('*').strip()); break
            out.append(s.lstrip('*').strip())
    return ' '.join(x for x in out if x)


def recoger(raiz):
    os.chdir(raiz)
    files = subprocess.check_output(['git', 'ls-files'], text=True).split('\n')
    src = [f for f in files if f.endswith(('.js', '.gs', '.html', '.py')) and not f.startswith(EXCLUIR)]
    arch, props, menus = [], {}, []
    rx_fn = re.compile(r'^\s*(?:async\s+)?function\s+(\w+)|^def\s+(\w+)')
    rx_prop = re.compile(r"getProperty\('([A-Za-z0-9_]+)'\)")
    rx_menu = re.compile(r"createMenu\('([^']+)'\)")
    rx_item = re.compile(r"\.addItem\('([^']*)',\s*'(\w+)'\)")
    rx_tit = re.compile(r'<title>([^<]*)</title>')
    for f in src:
        t = open(f, encoding='utf-8', errors='replace').read()
        lineas = t.split('\n')
        py = f.endswith('.py')
        if f.endswith('.html'):
            m = rx_tit.search(t)
            d = m.group(1) if m else ''
        else:
            d = _primer_comentario(lineas, py)
        fns = [a or b for l in lineas for a, b in [ (rx_fn.match(l).groups() if rx_fn.match(l) else (None, None)) ] if a or b]
        arch.append({'f': f, 'd': re.sub(r'\s+', ' ', d)[:700], 'fns': fns, 'lineas': len(lineas)})
        if py:
            continue
        for k in rx_prop.findall(t):
            props.setdefault(k, set()).add(f)
        cur = ''
        for l in lineas:
            m = rx_menu.search(l)
            if m:
                cur = m.group(1)
            for it in rx_item.finditer(l):
                menus.append({'f': f, 'menu': cur, 'item': it.group(1), 'fn': it.group(2)})
    wfs = []
    for f in sorted(os.listdir('.github/workflows')):
        p = '.github/workflows/' + f
        t = open(p, encoding='utf-8').read()
        y = yaml.safe_load(t) or {}
        on = y.get(True) or y.get('on') or {}
        if isinstance(on, str): on = {on: None}
        if isinstance(on, list): on = {k: None for k in on}
        crons = [c['cron'] for c in (on.get('schedule') or [])]
        wd = on.get('workflow_dispatch') or {}
        inputs = list((wd.get('inputs') or {}).keys()) if isinstance(wd, dict) else []
        push = on.get('push') or {}
        paths = (push.get('paths') or []) if isinstance(push, dict) else []
        head = []
        for l in t.split('\n'):
            if l.startswith('#'): head.append(l.lstrip('#').strip())
            elif l.strip(): break
        wfs.append({'f': f, 'name': y.get('name', ''), 'desc': ' '.join(head)[:700], 'trig': list(on.keys()),
                    'crons': crons, 'inputs': inputs, 'paths': paths,
                    'secrets': sorted(set(re.findall(r'secrets\.([A-Z0-9_]+)', t))),
                    'jobs': list((y.get('jobs') or {}).keys())})
    return {'arch': arch, 'wfs': wfs, 'props': {k: sorted(v) for k, v in props.items()}, 'menus': menus}


if __name__ == '__main__':
    import json, sys
    d = recoger(sys.argv[1] if len(sys.argv) > 1 else '.')
    print(len(d['arch']), 'archivos', len(d['wfs']), 'robots', len(d['props']), 'propiedades', len(d['menus']), 'menús')
    json.dump(d, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0) if len(sys.argv) > 2 else None
