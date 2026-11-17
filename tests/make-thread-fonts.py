"""Builds Kaamghor's two thread typefaces from one alphabet drawn on a thread grid:

  Bowa  (বোৱা, "woven"):  each row of a letter is a float of weft thread, as in a gamosa border.
  Siloi (চিলাই, "stitched"): each cell of a letter is one cross-stitch.

Both are display faces in capitals (lowercase types as capitals). Strokes are two threads wide.
Output: web/assets/fonts/bowa.woff2|ttf and siloi.woff2|ttf.
Usage: python tests/make-thread-fonts.py   (needs: pip install fonttools brotli skia-pathops)
"""
import math
from pathlib import Path
import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = Path(__file__).resolve().parent.parent / 'web' / 'assets' / 'fonts'
OUT.mkdir(parents=True, exist_ok=True)
C = 64          # one thread cell, in font units; letters are 11 cells tall (704)

# The alphabet, top row first. '#' = thread.
GRID = {
'A': """
...###...
..#####..
.##...##.
.##...##.
##.....##
##.....##
#########
#########
##.....##
##.....##
##.....##""",
'B': """
######..
#######.
##...##.
##...##.
######..
#######.
##....##
##....##
##....##
#######.
######..""",
'C': """
..#####.
.#######
##....##
##......
##......
##......
##......
##......
##....##
.#######
..#####.""",
'D': """
######..
#######.
##...##.
##....##
##....##
##....##
##....##
##....##
##...##.
#######.
######..""",
'E': """
#######
#######
##.....
##.....
######.
######.
##.....
##.....
##.....
#######
#######""",
'F': """
#######
#######
##.....
##.....
######.
######.
##.....
##.....
##.....
##.....
##.....""",
'G': """
..#####.
.#######
##....##
##......
##......
##..####
##..####
##....##
##....##
.#######
..######""",
'H': """
##....##
##....##
##....##
##....##
########
########
##....##
##....##
##....##
##....##
##....##""",
'I': """
######
######
..##..
..##..
..##..
..##..
..##..
..##..
..##..
######
######""",
'J': """
....###
....###
.....##
.....##
.....##
.....##
.....##
##...##
##...##
.######
..####.""",
'K': """
##...###
##..###.
##.###..
#####...
####....
####....
#####...
##.###..
##..###.
##...###
##....##""",
'L': """
##.....
##.....
##.....
##.....
##.....
##.....
##.....
##.....
##.....
#######
#######""",
'M': """
###....###
####..####
##.####.##
##..##..##
##......##
##......##
##......##
##......##
##......##
##......##
##......##""",
'N': """
###....##
####...##
#####..##
##.##..##
##.###.##
##..##.##
##..#####
##...####
##....###
##.....##
##.....##""",
'O': """
..#####..
.#######.
###...###
##.....##
##.....##
##.....##
##.....##
##.....##
###...###
.#######.
..#####..""",
'P': """
######..
#######.
##...###
##....##
##...###
#######.
######..
##......
##......
##......
##......""",
'Q': """
..#####..
.#######.
###...###
##.....##
##.....##
##.....##
##..##.##
##...####
###...###
.########
..#####.#""",
'R': """
######..
#######.
##...###
##....##
##...###
#######.
######..
##..##..
##...##.
##...###
##....##""",
'S': """
.######.
########
##....##
##......
#######.
.#######
......##
......##
##....##
########
.######.""",
'T': """
########
########
...##...
...##...
...##...
...##...
...##...
...##...
...##...
...##...
...##...""",
'U': """
##....##
##....##
##....##
##....##
##....##
##....##
##....##
##....##
###..###
.######.
..####..""",
'V': """
##.....##
##.....##
##.....##
###...###
.##...##.
.###.###.
..##.##..
..#####..
...###...
...###...
....#....""",
'W': """
##......##
##......##
##......##
##......##
##......##
##..##..##
##.####.##
##########
####..####
###....###
##......##""",
'X': """
##.....##
###...###
.###.###.
..#####..
...###...
...###...
..#####..
.###.###.
###...###
##.....##
##.....##""",
'Y': """
##....##
###..###
.######.
..####..
...##...
...##...
...##...
...##...
...##...
...##...
...##...""",
'Z': """
########
########
.....###
....###.
...###..
..###...
.###....
###.....
##......
########
########""",
'0': """
.#####.
#######
##...##
##..###
##.####
####.##
###..##
##...##
##...##
#######
.#####.""",
'1': """
..##...
.###...
####...
..##...
..##...
..##...
..##...
..##...
..##...
######.
######.""",
'2': """
.#####.
#######
##...##
.....##
....###
...###.
..###..
.###...
###....
#######
#######""",
'3': """
.#####.
#######
##...##
.....##
..####.
..####.
.....##
.....##
##...##
#######
.#####.""",
'4': """
....##.
...###.
..####.
.##.##.
##..##.
#######
#######
....##.
....##.
....##.
....##.""",
'5': """
#######
#######
##.....
##.....
######.
#######
.....##
.....##
##...##
#######
.#####.""",
'6': """
.#####.
#######
##...##
##.....
######.
#######
##...##
##...##
##...##
#######
.#####.""",
'7': """
#######
#######
.....##
....###
...###.
..###..
..##...
..##...
..##...
..##...
..##...""",
'8': """
.#####.
#######
##...##
##...##
.#####.
.#####.
##...##
##...##
##...##
#######
.#####.""",
'9': """
.#####.
#######
##...##
##...##
##...##
#######
.######
.....##
##...##
#######
.#####.""",
'.': """
..
..
..
..
..
..
..
..
..
##
##""",
',': """
..
..
..
..
..
..
..
..
..
##
##
.#
#.""",
'!': """
##
##
##
##
##
##
##
..
..
##
##""",
'?': """
.#####.
#######
##...##
.....##
...###.
..###..
..##...
.......
.......
..##...
..##...""",
'-': """
.....
.....
.....
.....
#####
#####
.....
.....
.....
.....
.....""",
"'": """
##
##
.#
#.
..
..
..
..
..
..
..""",
'/': """
.....##
.....##
....##.
....##.
...##..
...##..
..##...
..##...
.##....
.##....
##.....""",
'₹': """
#######
#######
....##.
#######
#######
.####..
..##...
..###..
...###.
....###
.....##""",
':': """
..
..
..
##
##
..
..
..
..
##
##""",
}

NAMES = {'.': 'period', ',': 'comma', '!': 'exclam', '?': 'question', '-': 'hyphen', "'": 'quotesingle', '/': 'slash',
         '₹': 'rupee', ':': 'colon', **{d: n for d, n in zip('0123456789', ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])}}

def cells(ch):
    rows = GRID[ch].strip('\n').split('\n')
    top = 10   # row 0 is the top row (y from 10*C to 11*C); rows below 0 hang under the baseline
    return [(x, top - r) for r, row in enumerate(rows) for x, c in enumerate(row) if c == '#'], max(len(r) for r in rows)


# ---------- shapes and path operations ----------
def rounded_rect(x0, y0, x1, y1, r, n=6):
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts = []
    for cx, cy, a0 in ((x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def capsule(x0, y0, x1, y1, w, n=8):
    a = math.atan2(y1 - y0, x1 - x0)
    pts = []
    for cx, cy, base in ((x1, y1, a - math.pi / 2), (x0, y0, a + math.pi / 2)):
        for k in range(n + 1):
            t = base + math.pi * k / n
            pts.append((cx + w / 2 * math.cos(t), cy + w / 2 * math.sin(t)))
    return pts

def to_path(shapes, dx=0, dy=0):
    path = pathops.Path()
    for s in shapes:
        path.moveTo(s[0][0] + dx, s[0][1] + dy)
        for x, y in s[1:]:
            path.lineTo(x + dx, y + dy)
        path.close()
    path.simplify(fix_winding=True, keep_starting_points=False, clockwise=True)
    return path

def minus(a, b):
    return pathops.op(a, b, pathops.PathOp.DIFFERENCE, fix_winding=True, keep_starting_points=False, clockwise=True)


# ---------- woven: floats of twisted yarn, crossed by the warp ----------
def floats(cs):
    """Each horizontal run of thread in a row is one float: (x0, y0, x1, y1)."""
    rows, out = {}, []
    for x, y in cs:
        rows.setdefault(y, []).append(x)
    for y, xs in rows.items():
        xs.sort()
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x == prev + 1:
                prev = x
                continue
            out.append((start * C + 2, y * C + 3, (prev + 1) * C - 2, (y + 1) * C - 3))
            if x is not None:
                start = prev = x
    return out

def woven(cs):
    fl = floats(cs)
    # Each float is laid as a doubled thread: two strands, one above the other, with round thread ends.
    strands = []
    for x0, y0, x1, y1 in fl:
        mid = (y0 + y1) / 2
        strands += [(x0, y0, x1, mid - 1.5), (x0 + 5, mid + 1.5, x1 - 5, y1)]
    yarn = [rounded_rect(*s, (s[3] - s[1]) * 0.48) for s in strands]
    grooves, warp, glints = [], [], []
    for x0, y0, x1, y1 in strands:
        h = y1 - y0
        slant, top = h * 0.7, y0 + h * 0.5
        # The twist: fine slanted grooves between the plies of the yarn...
        gx = x0 + 2
        while gx < x1:
            grooves.append([(gx, y0 - 2), (gx + 1.8, y0 - 2), (gx + 1.8 + slant, y1 + 2), (gx + slant, y1 + 2)])
            # ...and a glint on the upper half of each ply, where light catches the round thread.
            g0, g1 = gx + 3.2 + slant * (top - y0) / h, gx + 3.2 + slant * (y1 - 3 - y0) / h
            glints.append([(g0, top), (g0 + 2.2, top), (g1 + 2.2, y1 - 3), (g1, y1 - 3)])
            gx += 7
    # The warp crosses over the floats now and then, as a fine line.
    for x0, y0, x1, y1 in fl:
        for k in range(math.ceil(x0 / C), math.floor(x1 / C) + 1):
            if k % 3 == 0 and x0 + 20 < k * C < x1 - 20:
                warp.append([(k * C - 1.2, y0 - 2), (k * C + 1.2, y0 - 2), (k * C + 1.2, y1 + 2), (k * C - 1.2, y1 + 2)])
    yarn_path = to_path(yarn)
    cuts = to_path(grooves + warp)
    body = minus(yarn_path, cuts)
    return {
        'base': body,                                                   # the thread itself, in the text colour
        'shadow': to_path(yarn, 2, -4),                                 # its shadow on the cloth
        'sheen': pathops.op(minus(to_path(glints), cuts), yarn_path, pathops.PathOp.INTERSECTION,
                            fix_winding=True, keep_starting_points=False, clockwise=True),
    }

def stitched(cs):
    """Each cell is a cross-stitch: two diagonal stitches."""
    shapes, m, w = [], 12, 17
    for x, y in cs:
        x0, y0, x1, y1 = x * C + m, y * C + m, (x + 1) * C - m, (y + 1) * C - m
        shapes += [capsule(x0, y0, x1, y1, w), capsule(x0, y1, x1, y0, w)]
    return {'base': to_path(shapes)}


# ---------- fonts ----------
def glyph(path):
    pen = TTGlyphPen(None)
    open_ = False
    for verb, pts in path:
        if verb == pathops.PathVerb.MOVE:
            pen.moveTo(tuple(round(v) for v in pts[0])); open_ = True
        elif verb == pathops.PathVerb.LINE:
            pen.lineTo(tuple(round(v) for v in pts[0]))
        elif verb == pathops.PathVerb.CLOSE and open_:
            pen.closePath(); open_ = False
    return pen.glyph()

# Colour layers sit around the text colour: a translucent dark shadow below, a translucent light sheen above,
# so the threads look round in any colour set with CSS. Browsers without colour fonts show the textured thread alone.
LAYERS = [('shadow', 0), ('base', 0xFFFF), ('sheen', 1)]
PALETTE = [(0.0, 0.0, 0.0, 0.34), (1.0, 1.0, 1.0, 0.30)]

def build(family, render, file):
    glyphs, widths, cmap, colr = {}, {}, {}, {}
    glyphs['.notdef'], widths['.notdef'] = glyph(render([(x, y) for x in range(5) for y in range(11) if x in (0, 4) or y in (0, 10)])['base']), 6 * C
    glyphs['space'], widths['space'] = TTGlyphPen(None).glyph(), 4 * C
    cmap[32] = 'space'
    for ch in GRID:
        cs, cols = cells(ch)
        name, width = NAMES.get(ch, ch), (cols + 1) * C
        layers = render(cs)
        glyphs[name], widths[name] = glyph(layers['base']), width
        if len(layers) > 1:
            for part in layers:
                if part != 'base':
                    glyphs[f'{name}.{part}'], widths[f'{name}.{part}'] = glyph(layers[part]), width
            colr[name] = [(name if part == 'base' else f'{name}.{part}', pal) for part, pal in LAYERS]
        cmap[ord(ch)] = name
        if ch.isalpha():
            cmap[ord(ch.lower())] = name
    order = ['.notdef', 'space'] + [n for n in glyphs if n not in ('.notdef', 'space')]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf({n: glyphs[n] for n in order})
    fb.setupHorizontalMetrics({n: (widths[n], glyphs[n].xMin if glyphs[n].numberOfContours else 0) for n in order})
    fb.setupHorizontalHeader(ascent=860, descent=-220)
    fb.setupNameTable({'familyName': family, 'styleName': 'Regular', 'uniqueFontIdentifier': f'Kaamghor:{family}:1.100',
                       'fullName': f'{family} Regular', 'psName': f'{family}-Regular', 'version': 'Version 1.100', 'copyright': 'Kaamghor'})
    fb.setupOS2(sTypoAscender=860, sTypoDescender=-220, sTypoLineGap=0, usWinAscent=860, usWinDescent=240,
                sCapHeight=11 * C, sxHeight=11 * C, achVendID='KAAM', fsType=0)
    fb.setupPost()
    if colr:
        fb.setupCPAL([PALETTE])
        fb.setupCOLR(colr, version=0)
    fb.save(OUT / f'{file}.ttf')
    fb.font.flavor = 'woff2'
    fb.save(OUT / f'{file}.woff2')
    print(f'web/assets/fonts/{file}.woff2', len(order), 'glyphs', '(colour)' if colr else '')

build('Bowa', woven, 'bowa')
build('Siloi', stitched, 'siloi')

