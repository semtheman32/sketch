# Builds public/lesstof/*.chem.json (one sheet per lesson) from the lesson-overview app of OSY2:
# its lesson trees (trees.json, extracted from src/lessen/*.jsx) and its Sketch drawings (tekeningen/lesNN/*.chem.json).
# Usage: python3 scripts/build-lesstof.py public/lesstof
import json, re, os, math, sys
T = json.load(open('/tmp/claude-0/ex/trees.json'))
DR = '/mnt/project-files/tekeningen/'
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

BLUE, GREEN, PURPLE, ORANGE, GRAY, MUTED = '#2563eb', '#16a34a', '#7c3aed', '#ea580c', '#64748b', '#6b7280'
SUP = str.maketrans('0123456789+-−n()=', '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻ⁿ⁽⁾⁼')
SUB = str.maketrans('0123456789+-()=aeoxhklmnpst', '₀₁₂₃₄₅₆₇₈₉₊₋₍₎₌ₐₑₒₓₕₖₗₘₙₚₛₜ')
GREEK = dict(alpha='α', beta='β', gamma='γ', delta='δ', Delta='Δ', pi='π', sigma='σ', mu='μ', lambda_='λ', nu='ν', theta='θ', tau='τ', omega='ω', Omega='Ω', rho='ρ', epsilon='ε', varepsilon='ε', chi='χ', kappa='κ', eta='η', phi='φ', Sigma='Σ')

def grp(s, i):
    # read {...} or single char at s[i]; return (content, next index)
    if i < len(s) and s[i] == '{':
        d, j = 1, i + 1
        while j < len(s) and d:
            d += {'{': 1, '}': -1}.get(s[j], 0); j += 1
        return s[i + 1:j - 1], j
    if i < len(s) and s[i] == '\\':
        m = re.match(r'\\[A-Za-z]+', s[i:])
        if m: return m.group(0), i + len(m.group(0))
    return (s[i] if i < len(s) else ''), i + 1

def tex(s):
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == '\\':
            m = re.match(r'\\([A-Za-z]+|.)', s[i:]); cmd = m.group(1); i += len(m.group(0))
            if cmd == 'frac':
                a, i = grp(s, i); b, i = grp(s, i)
                a, b = tex(a), tex(b)
                out.append((f'({a})' if len(a) > 1 and ' ' in a else a) + '/' + (f'({b})' if re.search(r'[\s+\-−·]', b) else b))
            elif cmd in ('mathrm', 'text', 'ce', 'mathit', 'mathbf', 'operatorname', 'textrm', 'boldsymbol', 'mathsf'):
                a, i = grp(s, i); out.append(tex(a))
            elif cmd == 'sqrt':
                a, i = grp(s, i); out.append('√(' + tex(a) + ')')
            elif cmd in GREEK: out.append(GREEK[cmd])
            elif cmd == 'lambda': out.append('λ')
            else:
                out.append({'cdot': '·', 'times': '×', 'approx': '≈', 'to': '→', 'rightarrow': '→', 'Rightarrow': '⇒', 'leftarrow': '←', 'rightleftharpoons': '⇌',
                            'qquad': '    ', 'quad': '  ', ',': ' ', ';': ' ', '!': '', ' ': ' ', 'ln': 'ln', 'log': 'log', 'exp': 'exp', 'pm': '±', 'le': '≤', 'leq': '≤', 'ge': '≥', 'geq': '≥',
                            'circ': '°', '%': '%', 'infty': '∞', 'propto': '∝', 'neq': '≠', 'cdots': '⋯', 'ldots': '…', 'left': '', 'right': '', 'big': '', 'Big': '', 'degree': '°', 'equiv': '≡',
                            'sum': 'Σ', 'prime': '′', 'partial': '∂', 'min': 'min', 'max': 'max', '{': '{', '}': '}', '_': '_', 'quad ': ' ', 'hline': '', 'displaystyle': '', 'over': '/'}.get(cmd, ''))
        elif c in '^_':
            a, i = grp(s, i + 1); a = tex(a)
            t = a.translate(SUP if c == '^' else SUB)
            ok = all(ch not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' or ch in t and ch not in a for ch in a)
            out.append(t if t != a or not a else ('^' + a if c == '^' else a))
        elif c in '{}': i += 1
        elif c == '~': out.append(' '); i += 1
        else: out.append(c); i += 1
    return ''.join(out)

def clean(s):
    s = re.sub(r'\$([^$]+)\$', lambda m: tex(m.group(1)), s)
    s = s.replace('**', '').replace('`', '')
    s = re.sub(r'\s*\[(zelf|ter illustratie)\]', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def flat(n):
    if n is None: return ''
    if isinstance(n, (str, int, float)): return str(n)
    if isinstance(n, list): return ''.join(flat(x) for x in n)
    if n.get('t') in ('br',): return ' '
    return ''.join(flat(c) for c in n.get('c', []))

def wrap(text, size, width):
    per = max(20, int(width / (size * 0.47)))
    words, lines, cur = text.split(' '), [], ''
    for w in words:
        if len(cur) + len(w) + 1 > per and cur: lines.append(cur); cur = w
        else: cur = (cur + ' ' + w).strip()
    if cur: lines.append(cur)
    return lines

class Sheet:
    def __init__(s):
        s.d = dict(atoms={}, bonds={}, arrows={}, curlies={}, texts={}, brackets={}); s.n = 0; s.y = 0
    def nid(s, k): s.n += 1; return f'{k}{s.n}'
    def text(s, x, y, t, size=14, color=None, bold=False, italic=False):
        i = s.nid('t'); s.d['texts'][i] = dict(id=i, x=x, y=y, text=t, size=size, **({'color': color} if color else {}), **({'bold': True} if bold else {}), **({'italic': True} if italic else {}))
    def para(s, x, text, size=14, width=1400, gap=7, **st):
        text = clean(text)
        if not text: return
        for line in wrap(text, size, width):
            s.y += size + 2; s.text(x, s.y, line, size, **st); s.y += gap
    def box(s, x1, y1, x2, y2, color, label=''):
        i = s.nid('k'); s.d['brackets'][i] = dict(id=i, x1=x1, y1=y1, x2=x2, y2=y2, shape='box', label=label, color=color)
    def drawing(s, f, x):
        p = DR + f + '.chem.json'
        if not os.path.exists(p): print('  missing', f); return False
        src = json.load(open(p))
        src['texts'] = {k: t for k, t in src.get('texts', {}).items() if t.get('text', '').strip() not in ('', '.')}
        xs, ys = [], []
        for a in src.get('atoms', {}).values(): xs += [a['x'] - 12, a['x'] + 12]; ys += [a['y'] - 14, a['y'] + 14]
        for r in src.get('arrows', {}).values(): xs += [r['x1'], r['x2']]; ys += [r['y1'] - 22, r['y2'] + 22]
        for t in src.get('texts', {}).values():
            sz = t.get('size', 14); xs += [t['x'], t['x'] + len(t['text']) * sz * 0.55]; ys += [t['y'] - sz, t['y'] + 4]
        for k in (src.get('brackets') or {}).values(): xs += [k['x1'], k['x2']]; ys += [k['y1'], k['y2']]
        if not xs: return False
        dx, dy = x - min(xs), s.y + 18 - min(ys)
        m = {}
        def rid(old):
            if old not in m: m[old] = s.nid(old[0] if old[0] in 'abrck' else 't')
            return m[old]
        for a in src.get('atoms', {}).values(): i = rid(a['id']); s.d['atoms'][i] = {**a, 'id': i, 'x': a['x'] + dx, 'y': a['y'] + dy}
        for b in src.get('bonds', {}).values(): i = rid(b['id']); s.d['bonds'][i] = {**b, 'id': i, 'a1': rid(b['a1']), 'a2': rid(b['a2'])}
        for r in src.get('arrows', {}).values(): i = rid(r['id']); s.d['arrows'][i] = {**r, 'id': i, 'x1': r['x1'] + dx, 'x2': r['x2'] + dx, 'y1': r['y1'] + dy, 'y2': r['y2'] + dy}
        for c in src.get('curlies', {}).values(): i = rid(c['id']); s.d['curlies'][i] = {**c, 'id': i, 'from': rid(c['from']), 'to': rid(c['to'])}
        for t in src.get('texts', {}).values(): i = rid(t['id']); s.d['texts'][i] = {**t, 'id': i, 'x': t['x'] + dx, 'y': t['y'] + dy}
        for k in (src.get('brackets') or {}).values(): i = rid(k['id']); s.d['brackets'][i] = {**k, 'id': i, 'x1': k['x1'] + dx, 'x2': k['x2'] + dx, 'y1': k['y1'] + dy, 'y2': k['y2'] + dy}
        s.y += max(ys) - min(ys) + 24
        s.maxx = max(getattr(s, 'maxx', 0), max(xs) + dx)
        return True

W = 1400
SKIP = {'bronnen', 'test', 'overzicht'}

def card(sh, color, label, body):
    """Run body() inside a tinted box with a title."""
    y0 = sh.y + 14; sh.y = y0 + 26
    body()
    sh.y += 14
    sh.box(-16, y0, W + 16, sh.y, color, label)
    sh.y += 10

def lines(sh, items, x=0, numbered=False, size=14):
    for k, it in enumerate(items, 1):
        if isinstance(it, list): it = (clean(it[0]) + ' ' + clean(it[1])) if len(it) > 1 else clean(it[0])
        pre = f'{k}. ' if numbered else '• '
        txt = clean(flat(it) if isinstance(it, dict) else str(it))
        ws = wrap(pre + txt, size, W - x - 10)
        for j, line in enumerate(ws):
            sh.y += size + 2; sh.text(x + (0 if j == 0 else 18), sh.y, line, size); sh.y += 6

def node(sh, n):
    t, p = n.get('t'), n.get('p', {})
    if t == 'Why':
        sh.y += 4; sh.para(0, flat(n), 14, W, italic=True, color=MUTED)
    elif t == 'p':
        sh.para(0, flat(n), 14, W)
    elif t == 'h3':
        sh.y += 10; sh.para(0, flat(n), 16, W, bold=True)
    elif t == 'Steps':
        sh.y += 6; lines(sh, p.get('items', []), 0, numbered=True)
    elif t == 'Remember':
        card(sh, GREEN, 'Onthoud', lambda: lines(sh, p.get('items', []), 4))
    elif t in ('ReactionCard', 'SpecCard'):
        def body():
            if p.get('f'): sh.drawing(p['f'], 10)
            if p.get('caption'): sh.para(4, p['caption'], 13, W - 20, italic=True, color=MUTED)
            rows = p.get('rows') or []
            if p.get('head') and rows: sh.y += 4; sh.para(4, '  |  '.join(clean(str(h)) for h in p['head']), 13, W - 20, bold=True)
            for r in rows: sh.para(4, (clean(str(r[0])) + ':  ' + '  |  '.join(clean(str(x)) for x in r[1:])) if isinstance(r, list) else str(r), 13, W - 20)
            if p.get('why'): sh.y += 4; sh.para(4, 'Waarom: ' + clean(p['why']), 13, W - 20)
        card(sh, BLUE, clean(p.get('title', '')), body)
    elif t == 'Drawing':
        if sh.drawing(p['f'], 10) and p.get('caption'): sh.para(4, p['caption'], 13, W, italic=True, color=MUTED)
    elif t == 'Stepper':
        def body():
            for st in p.get('steps', []):
                if st.get('f'): sh.drawing(st['f'], 10)
                sh.para(4, (clean(st.get('h', '')) + ' ' + clean(st.get('t', ''))).strip(), 13, W - 20)
                sh.y += 6
        card(sh, BLUE, clean(p.get('title', 'Mechanisme stap voor stap')), body)
    elif t in ('Worked', 'WorkedChem'):
        def body():
            if p.get('given'): sh.para(4, 'Gegeven: ' + clean(p['given']), 13, W - 20, italic=True)
            if p.get('f'): sh.drawing(p['f'], 10)
            lines(sh, p.get('steps', []), 4, numbered=True, size=13)
            if p.get('answerF'): sh.drawing(p['answerF'], 10)
            if p.get('answer'): sh.para(4, 'Antwoord: ' + clean(flat(p['answer']) if isinstance(p['answer'], dict) else str(p['answer'])), 13, W - 20, bold=True)
            if p.get('check'): sh.para(4, 'Controle: ' + clean(p['check']), 13, W - 20, color=MUTED)
        card(sh, PURPLE, f"Voorbeeld {p.get('n', '')}: {clean(p.get('title', ''))}", body)
    elif t == 'Formula':
        def body():
            if p.get('eq'): sh.y += 4; sh.para(10, tex(p['eq']), 17, W - 20)
            for sym in p.get('symbols') or []: sh.para(10, ' — '.join(clean(str(x)) for x in sym if x), 13, W - 20)
            if p.get('logic'): sh.y += 2; sh.para(4, clean(p['logic']), 13, W - 20, color=MUTED)
        card(sh, GRAY, 'Formule: ' + clean(p.get('title', '')), body)
    elif t == 'Table':
        def body():
            if p.get('head'): sh.para(4, '  |  '.join(clean(str(h)) for h in p['head']), 13, W - 20, bold=True)
            for r in p.get('rows', []): sh.para(4, '  |  '.join(clean(flat(x) if isinstance(x, dict) else str(x)) for x in r), 13, W - 20)
        card(sh, GRAY, clean(p.get('title', 'Tabel')), body)
    elif t == 'Summary':
        lines(sh, p.get('items', []), 4)
    elif t in ('F', 'div'):
        for c in n.get('c', []):
            if isinstance(c, dict): node(sh, c)
    elif t == 'Figure' and p.get('f'):
        sh.drawing(p['f'], 10)

index = []
for key in sorted(T):
    v = T[key]; meta = v['meta']; sh = Sheet()
    sh.y = 0; sh.text(0, 30, f"Les {meta['n']}: {meta['title']}", 28, BLUE, True); sh.y = 42
    sh.para(0, meta.get('lead', ''), 16, W, color=MUTED)
    sh.para(0, 'Bron: ' + clean(meta.get('src', '')), 12, W, italic=True, color=MUTED)
    chapters = [c for c in v['tree']['c'] if isinstance(c, dict) and c.get('t') == 'Chapter']
    topics = []
    for ch in chapters:
        cid = ch['p'].get('id')
        if cid in SKIP: continue
        sh.y += 50
        if cid == 'samenvatting':
            def body(ch=ch):
                for c in ch['c']:
                    if isinstance(c, dict): node(sh, c)
            card(sh, ORANGE, 'Samenvatting', body); continue
        topics.append(clean(ch['p'].get('title', '')))
        sh.y += 22; sh.text(0, sh.y, f"{ch['p'].get('n', '')}. {clean(ch['p'].get('title', ''))}", 22, BLUE, True); sh.y += 8
        if ch['p'].get('src'): sh.para(0, clean(ch['p']['src']), 12, W, italic=True, color=MUTED)
        for c in ch['c']:
            if isinstance(c, dict): node(sh, c)
    fn = f"les{meta['n']:02d}.chem.json"
    json.dump(sh.d, open(os.path.join(OUT, fn), 'w'), ensure_ascii=False)
    index.append(dict(n=meta['n'], title=meta.get('short') or meta['title'], file=fn, topics=', '.join(topics[:4])))
    print(key, len(sh.d['atoms']), 'atoms', len(sh.d['texts']), 'texts', int(sh.y), 'high')
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
