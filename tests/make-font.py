"""Builds "Akhor" (আখৰ, "letter"), Kaamghor's display typeface, into web/assets/fonts/.

Latin capitals drawn with the habits of Assamese script: a headline bar (the matra) runs along
the top of every word, each letter hangs from it on a tapered wedge, stems are thick and curves
thin as if written with a reed. Lowercase uses the capitals; digits and punctuation hang free,
as Assamese numerals do. Usage: python tests/make-font.py   (needs: pip install fonttools brotli)
"""
import math
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = Path(__file__).resolve().parent.parent / 'web' / 'assets' / 'fonts'
OUT.mkdir(parents=True, exist_ok=True)

UPM = 1000
CAP = 690                 # letters stand from 0 to here
BAR0, BAR1 = 716, 780     # the matra, just above the letters
S, T = 122, 74            # thick stem, thin stroke


# ---------- shapes (font units, y up) ----------
def area(pts):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1])) / 2

def fill(pts):            # filled contours run clockwise
    return pts if area(pts) < 0 else pts[::-1]

def hole(pts):            # holes run counter-clockwise
    return pts if area(pts) > 0 else pts[::-1]

def rect(x0, y0, x1, y1):
    return [fill([(x0, y0), (x0, y1), (x1, y1), (x1, y0)])]

def line(x0, y0, x1, y1, w):
    dx, dy = x1 - x0, y1 - y0
    n = math.hypot(dx, dy)
    ox, oy = -dy / n * w / 2, dx / n * w / 2
    return [fill([(x0 + ox, y0 + oy), (x1 + ox, y1 + oy), (x1 - ox, y1 - oy), (x0 - ox, y0 - oy)])]

def ellipse(cx, cy, rx, ry, steps=72):
    return [(cx + rx * math.cos(2 * math.pi * i / steps), cy + ry * math.sin(2 * math.pi * i / steps)) for i in range(steps)]

def ring(cx, cy, rx, ry, tx=S, ty=T):
    return [fill(ellipse(cx, cy, rx, ry)), hole(ellipse(cx, cy, rx - tx, ry - ty))]

def arc(cx, cy, rx, ry, a0, a1, tx=S, ty=T, steps=48):
    """A curved stroke along an ellipse from angle a0 to a1 (degrees, counter-clockwise)."""
    angs = [math.radians(a0 + (a1 - a0) * i / steps) for i in range(steps + 1)]
    outer = [(cx + rx * math.cos(a), cy + ry * math.sin(a)) for a in angs]
    inner = [(cx + (rx - tx) * math.cos(a), cy + (ry - ty) * math.sin(a)) for a in angs]
    return [fill(outer + inner[::-1])]

def bowl(xs, y0, y1, xr, tx=S, ty=T):
    """A D-shaped bowl from a stem at xs out to xr."""
    return arc(xs, (y0 + y1) / 2, xr - xs, (y1 - y0) / 2, -90, 90, tx, ty)

def stem(x, w=S, y0=0, y1=CAP):
    return rect(x, y0, x + w, y1)


# ---------- the letters: width, shapes, where it hangs from the bar ----------
def letters():
    L = {}
    L['A'] = 660, line(95, 0, 330, CAP, S) + line(330, CAP, 565, 0, T) + rect(165, 190, 495, 190 + T), 330
    L['B'] = 610, stem(60) + bowl(120, 330, CAP, 520, S, T) + bowl(120, 0, 370, 560, S, T), 120
    L['C'] = 650, arc(345, CAP / 2, 295, CAP / 2, 42, 318), 345
    L['D'] = 670, stem(60) + bowl(120, 0, CAP, 615), 120
    L['E'] = 550, stem(60) + rect(60, CAP - T, 500, CAP) + rect(60, 312, 450, 312 + T) + rect(60, 0, 510, T), 120
    L['F'] = 530, stem(60) + rect(60, CAP - T, 490, CAP) + rect(60, 300, 440, 300 + T), 120
    L['G'] = 690, arc(355, CAP / 2, 300, CAP / 2, 38, 330) + rect(370, 290, 640, 290 + T) + rect(530, 110, 645, 290 + T), 355
    L['H'] = 690, stem(60) + stem(510) + rect(170, 318, 520, 318 + T), 120
    L['I'] = 300, stem(90), 150
    L['J'] = 520, stem(330, S, 230) + arc(262, 230, 190, 230, 180, 360), 390
    L['K'] = 650, stem(60) + line(160, 300, 600, CAP, T * 1.3) + line(250, 395, 610, 0, S), 120
    L['L'] = 510, stem(60) + rect(60, 0, 480, T), 120
    L['M'] = 840, stem(60, T + 20) + stem(660) + line(120, CAP - 10, 420, 110, T) + line(420, 110, 705, CAP - 10, S), 110
    L['N'] = 700, stem(60, T + 20) + stem(546, T + 20) + line(110, CAP - 30, 590, 30, S * 1.15), 105
    L['O'] = 730, ring(365, CAP / 2, 315, CAP / 2), 365
    L['P'] = 610, stem(60) + bowl(120, 290, CAP, 560), 120
    L['Q'] = 730, ring(365, CAP / 2, 315, CAP / 2) + line(430, 190, 660, -70, S * 0.95), 365
    L['R'] = 630, stem(60) + bowl(120, 300, CAP, 550) + line(300, 330, 600, 0, S), 120
    L['S'] = 590, arc(300, 518, 232, 172, 22, 270, S * .9, T) + arc(292, 180, 248, 180, -158, 90, S * .9, T), 300
    L['T'] = 610, rect(40, CAP - T, 570, CAP) + stem(244), 305
    L['U'] = 690, stem(60, S, 250) + stem(508, S, 250) + arc(345, 250, 285, 250, 180, 360), 120
    L['V'] = 670, line(70, CAP, 335, 0, S) + line(335, 0, 600, CAP, T), 95
    L['W'] = 940, line(60, CAP, 260, 0, S) + line(260, 0, 470, 560, T) + line(470, 560, 680, 0, S) + line(680, 0, 880, CAP, T), 85
    L['X'] = 650, line(80, CAP, 580, 0, S) + line(570, CAP, 80, 0, T), 105
    L['Y'] = 650, line(70, CAP, 325, 330, S) + line(580, CAP, 325, 330, T) + rect(264, 0, 386, 370), 100
    L['Z'] = 600, rect(60, CAP - T, 540, CAP) + rect(50, 0, 550, T) + line(520, CAP - T / 2, 85, T / 2, S), 300
    return L

def figures():
    D = {}
    D['zero'] = 580, ring(290, CAP / 2, 240, CAP / 2)
    D['one'] = 440, stem(250) + line(250, CAP - 20, 90, 560, T)
    D['two'] = 580, arc(290, 500, 226, 190, -38, 180) + line(462, 382, 80, T / 2, S) + rect(60, 0, 530, T)
    D['three'] = 580, arc(278, 520, 220, 170, -90, 155) + arc(286, 180, 246, 180, -155, 90)
    D['four'] = 600, line(400, CAP, 60, 210, T) + rect(55, 170, 560, 170 + T) + stem(380)
    D['five'] = 580, rect(110, CAP - T, 510, CAP) + stem(110, S, 340) + arc(285, 212, 252, 212, -150, 105)
    D['six'] = 590, ring(295, 220, 245, 220) + line(110, 250, 400, CAP, S)
    D['seven'] = 570, rect(50, CAP - T, 540, CAP) + line(530, CAP - 20, 200, 0, S)
    D['eight'] = 590, ring(295, 528, 205, 162) + ring(295, 190, 245, 190)
    D['nine'] = 590, ring(295, 470, 245, 220) + line(482, 440, 190, 0, S)
    return D

def punctuation():
    P = {}
    P['period'] = 300, rect(90, 0, 210, 120), '.'
    P['comma'] = 300, rect(90, 0, 210, 120) + line(205, 30, 120, -150, T), ','
    P['colon'] = 300, rect(90, 0, 210, 120) + rect(90, 380, 210, 500), ':'
    P['semicolon'] = 300, rect(90, 380, 210, 500) + rect(90, 0, 210, 120) + line(205, 30, 120, -150, T), ';'
    P['exclam'] = 320, rect(100, 230, 220, CAP) + rect(100, 0, 220, 120), '!'
    P['question'] = 540, arc(270, 520, 210, 170, -90, 170) + stem(212, S, 230, 380) + rect(212, 0, 334, 120), '?'
    P['quotesingle'] = 280, rect(80, 500, 190, CAP), "'"
    P['quoteright'] = 280, line(150, CAP, 110, 480, S * .9), '’'
    P['hyphen'] = 440, rect(70, 300, 370, 300 + T), '-'
    P['endash'] = 600, rect(60, 300, 540, 300 + T), '–'
    P['slash'] = 480, line(420, CAP + 40, 60, -60, T * 1.3), '/'
    P['parenleft'] = 360, arc(380, CAP / 2, 270, CAP / 2 + 60, 105, 255, T * 1.4, T), '('
    P['parenright'] = 360, arc(-20, CAP / 2, 270, CAP / 2 + 60, -75, 75, T * 1.4, T), ')'
    P['ampersand'] = 720, ring(270, 530, 170, 150, T * 1.2, T) + line(240, 400, 640, 0, S) + arc(330, 200, 270, 200, 120, 330) + line(560, 280, 680, 280, T), '&'
    # Rupee: two bars, a bowl and the diagonal.
    P['rupee'] = 600, rect(60, CAP - T, 540, CAP) + rect(60, 470, 540, 470 + T) + arc(170, 545, 290, 145, -90, 90, S, T * .9) + line(200, 410, 520, 0, S), '₹'
    return P


# ---------- assemble ----------
glyphs, widths, cmap = {}, {}, {}

def draw(name, contours, width):
    pen = TTGlyphPen(None)
    for c in contours:
        pts = [(round(x), round(y)) for x, y in c]
        pen.moveTo(pts[0])
        for p in pts[1:]:
            pen.lineTo(p)
        pen.closePath()
    g = pen.glyph()
    if g.numberOfContours > 0:
        g.flags[0] |= 0x40       # OVERLAP_SIMPLE: shapes overlap on purpose
    glyphs[name], widths[name] = g, width

draw('.notdef', rect(60, 0, 440, CAP) + [hole([(120, 60), (380, 60), (380, CAP - 60), (120, CAP - 60)])], 500)
draw('space', [], 280)
cmap[ord(' ')] = 'space'

for ch, (w, shapes, hang) in letters().items():
    neck = [fill([(hang - 62, BAR0 + 2), (hang + 62, BAR0 + 2), (hang + 18, CAP - 6), (hang - 18, CAP - 6)])]
    draw(ch, shapes + neck + rect(-2, BAR0, w + 2, BAR1), w)     # the bar joins the next letter
    cmap[ord(ch)] = ch
    cmap[ord(ch.lower())] = ch

for name, (w, shapes) in figures().items():
    draw(name, shapes, w)
    cmap[ord('0123456789'[list(figures()).index(name)])] = name

for name, (w, shapes, ch) in punctuation().items():
    draw(name, shapes, w)
    cmap[ord(ch)] = name

order = ['.notdef', 'space'] + [n for n in glyphs if n not in ('.notdef', 'space')]
fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(cmap)
fb.setupGlyf({n: glyphs[n] for n in order})
fb.setupHorizontalMetrics({n: (widths[n], glyphs[n].xMin if glyphs[n].numberOfContours else 0) for n in order})
fb.setupHorizontalHeader(ascent=900, descent=-200)
fb.setupNameTable({'familyName': 'Akhor', 'styleName': 'Regular', 'uniqueFontIdentifier': 'Kaamghor:Akhor:1.000',
                   'fullName': 'Akhor Regular', 'psName': 'Akhor-Regular', 'version': 'Version 1.000',
                   'copyright': 'Kaamghor', 'designer': 'Kaamghor'})
fb.setupOS2(sTypoAscender=900, sTypoDescender=-200, sTypoLineGap=0, usWinAscent=900, usWinDescent=220,
            sCapHeight=CAP, sxHeight=CAP, achVendID='KAAM', fsType=0)
fb.setupPost()
fb.save(OUT / 'akhor.ttf')
fb.font.flavor = 'woff2'
fb.save(OUT / 'akhor.woff2')
print('web/assets/fonts/akhor.ttf, akhor.woff2:', len(order), 'glyphs')
