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


# ---------- the two renderings ----------
def rounded_rect(x0, y0, x1, y1, r, n=6):
    pts = []
    for cx, cy, a0 in ((x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def woven(cs):
    """Each horizontal run of thread in a row is one float, with a slim gap between rows."""
    shapes, rows = [], {}
    for x, y in cs:
        rows.setdefault(y, []).append(x)
    for y, xs in rows.items():
        xs.sort()
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x == prev + 1:
                prev = x
                continue
            shapes.append(rounded_rect(start * C + 4, y * C + 7, (prev + 1) * C - 4, (y + 1) * C - 7, 22))
            if x is not None:
                start = prev = x
    return shapes

def capsule(x0, y0, x1, y1, w, n=8):
    a = math.atan2(y1 - y0, x1 - x0)
    pts = []
    for cx, cy, base in ((x1, y1, a - math.pi / 2), (x0, y0, a + math.pi / 2)):
        for k in range(n + 1):
            t = base + math.pi * k / n
            pts.append((cx + w / 2 * math.cos(t), cy + w / 2 * math.sin(t)))
    return pts

def stitched(cs):
    """Each cell is a cross-stitch: two diagonal stitches."""
    shapes, m, w = [], 12, 17
    for x, y in cs:
        x0, y0, x1, y1 = x * C + m, y * C + m, (x + 1) * C - m, (y + 1) * C - m
        shapes += [capsule(x0, y0, x1, y1, w), capsule(x0, y1, x1, y0, w)]
    return shapes


def outline(shapes):
    path = pathops.Path()
    for s in shapes:
        path.moveTo(*s[0])
        for p in s[1:]:
            path.lineTo(*p)
        path.close()
    path.simplify(fix_winding=True, keep_starting_points=False, clockwise=True)
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

def build(family, render, file):
    glyphs, widths, cmap = {}, {}, {}
    empty = TTGlyphPen(None).glyph()
    glyphs['.notdef'], widths['.notdef'] = outline(render([(x, y) for x in range(5) for y in range(11) if x in (0, 4) or y in (0, 10)])), 6 * C
    glyphs['space'], widths['space'] = empty, 4 * C
    cmap[32] = 'space'
    for ch in GRID:
        cs, cols = cells(ch)
        name = NAMES.get(ch, ch)
        glyphs[name], widths[name] = outline(render(cs)), (cols + 1) * C
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
    fb.setupNameTable({'familyName': family, 'styleName': 'Regular', 'uniqueFontIdentifier': f'Kaamghor:{family}:1.000',
                       'fullName': f'{family} Regular', 'psName': f'{family}-Regular', 'version': 'Version 1.000', 'copyright': 'Kaamghor'})
    fb.setupOS2(sTypoAscender=860, sTypoDescender=-220, sTypoLineGap=0, usWinAscent=860, usWinDescent=240,
                sCapHeight=11 * C, sxHeight=11 * C, achVendID='KAAM', fsType=0)
    fb.setupPost()
    fb.save(OUT / f'{file}.ttf')
    fb.font.flavor = 'woff2'
    fb.save(OUT / f'{file}.woff2')
    print(f'web/assets/fonts/{file}.woff2', len(order), 'glyphs')

build('Bowa', woven, 'bowa')
build('Siloi', stitched, 'siloi')
