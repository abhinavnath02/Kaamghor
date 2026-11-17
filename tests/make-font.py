"""Builds "Akhor" (আখৰ, "letter"), Kaamghor's display typeface, into web/assets/fonts/.

A heavy, soft, swashy display face that borrows from Assamese writing:
- lowercase hangs from a thick headline bar at x-height, like the Assamese matra;
- tall strokes (b d h k l) rise through the bar and curl over at the top, like the vowel sign ি;
- descenders (g j p q y) end in curls, like ু;
- letters open at the top (u v w x y) stop just short of the bar so they stay readable;
- capitals stand free, as swash forms.
Every letter is a centre line swept with an elliptical brush (fat verticals, slimmer horizontals),
then merged into clean outlines. Spacing is computed from each letter's shape.
Usage: python tests/make-font.py   (needs: pip install fonttools brotli skia-pathops)
"""
import math
import re
from pathlib import Path
import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = Path(__file__).resolve().parent.parent / 'web' / 'assets' / 'fonts'
OUT.mkdir(parents=True, exist_ok=True)

UPM = 1000
XH = 470                   # x-height: where the bar starts
BAR = (XH - 12, XH + 78)   # the matra
RX, RY = 86, 60            # brush: half-width and half-height (fat verticals, slimmer horizontals)
SLANT = 0.1                # a gentle forward lean
SIDE = 14                  # space either side of each letter (heavy faces sit close)


# ---------- drawing: centre lines swept with the brush ----------
def cubic(p0, p1, p2, p3, n):
    pts = []
    for i in range(1, n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts

def parse(d):
    """Centre line in a small SVG-like language: M, L, C, Z (y up)."""
    tok = re.findall(r'[MLCZ]|-?\d+(?:\.\d+)?', d)
    pts, i, start, cur = [], 0, None, None
    while i < len(tok):
        c = tok[i]; i += 1
        if c == 'M':
            cur = (float(tok[i]), float(tok[i + 1])); i += 2; start = cur; pts.append(cur)
        elif c == 'L':
            nxt = (float(tok[i]), float(tok[i + 1])); i += 2
            n = max(2, int(math.dist(cur, nxt) / 14))
            pts += [(cur[0] + (nxt[0] - cur[0]) * k / n, cur[1] + (nxt[1] - cur[1]) * k / n) for k in range(1, n + 1)]
            cur = nxt
        elif c == 'C':
            p1 = (float(tok[i]), float(tok[i + 1])); p2 = (float(tok[i + 2]), float(tok[i + 3])); p3 = (float(tok[i + 4]), float(tok[i + 5])); i += 6
            n = max(6, int((math.dist(cur, p1) + math.dist(p1, p2) + math.dist(p2, p3)) / 12))
            pts += cubic(cur, p1, p2, p3, n); cur = p3
        elif c == 'Z':
            pts.append(start); cur = start
    return pts

def ellipse(cx, cy, rx, ry, n=20):
    return [(cx + rx * math.cos(2 * math.pi * k / n), cy + ry * math.sin(2 * math.pi * k / n)) for k in range(n)]

def hull(points):
    pts = sorted(set((round(x, 2), round(y, 2)) for x, y in points))
    if len(pts) < 3:
        return pts
    def half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h
    lower, upper = half(pts), half(pts[::-1])
    return lower[:-1] + upper[:-1]

class Glyph:
    def __init__(self, weight=1.0):
        self.shapes, self.weight = [], weight
    def stroke(self, d, scale=1.0):
        pts = parse(d)
        rx, ry = RX * scale * self.weight, RY * scale * self.weight
        for a, b in zip(pts, pts[1:]):
            self.shapes.append(hull(ellipse(*a, rx, ry) + ellipse(*b, rx, ry)))
        if len(pts) == 1:
            self.shapes.append(ellipse(*pts[0], rx, ry))
        return self
    def dot(self, x, y, r):
        self.shapes.append(ellipse(x, y, r * 1.08, r, 32))
        return self
    def rect(self, x0, y0, x1, y1):
        self.shapes.append([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
        return self


# ---------- lowercase: hangs from the bar ----------
CURL_UP = 'C {x} {y2} {xl} {y3} {xl2} {y4}'    # not used directly; curls are written out below

def lower():
    g = {}
    S = lambda: Glyph()
    # a: a round bowl and a stem that kicks out at the foot
    g['a'] = S().stroke('M 395 440 L 395 110 C 395 60 420 40 470 58').stroke('M 395 270 C 395 390 330 430 250 430 C 155 430 95 360 95 255 C 95 140 160 70 250 70 C 330 70 395 130 395 230')
    # b: the tall stem curls over its top like ি
    g['b'] = S().stroke('M 115 700 L 115 80').stroke('M 115 700 C 115 770 60 790 30 760 C 5 735 25 700 60 708').stroke('M 115 300 C 130 400 190 430 270 430 C 370 430 430 350 430 250 C 430 135 360 68 265 68 C 195 68 140 100 115 160')
    g['c'] = S().stroke('M 430 380 C 400 420 345 432 280 432 C 165 432 90 355 90 250 C 90 140 165 66 280 66 C 350 66 405 92 440 140 C 455 165 440 192 410 182')
    g['d'] = S().stroke('M 395 700 L 395 110 C 395 60 420 40 470 58').stroke('M 395 700 C 395 770 450 790 480 760 C 505 735 485 700 450 708').stroke('M 395 270 C 395 390 330 430 250 430 C 155 430 95 360 95 255 C 95 140 160 70 250 70 C 330 70 395 130 395 230')
    g['e'] = S().stroke('M 100 265 L 420 265 C 425 370 360 432 270 432 C 165 432 90 355 90 250 C 90 140 165 66 285 66 C 355 66 410 92 445 140')
    g['f'] = S().stroke('M 185 60 L 185 560 C 185 690 250 745 335 740 C 395 736 420 700 400 670 C 385 650 355 655 350 680').stroke('M 185 60 C 175 30 140 20 110 40')
    g['g'] = S().stroke('M 395 440 L 395 -40 C 395 -170 310 -225 210 -222 C 120 -220 70 -175 82 -128 C 90 -98 125 -92 140 -115').stroke('M 395 270 C 395 390 330 430 250 430 C 155 430 95 360 95 255 C 95 140 160 70 250 70 C 330 70 395 130 395 230')
    g['h'] = S().stroke('M 115 700 L 115 70').stroke('M 115 700 C 115 770 60 790 30 760 C 5 735 25 700 60 708').stroke('M 115 300 C 140 400 200 430 275 430 C 370 430 415 380 415 285 L 415 120 C 415 65 440 42 488 60')
    g['i'] = S().stroke('M 130 440 L 130 110 C 130 60 155 40 205 58').dot(130, 660, 64)
    g['j'] = S().stroke('M 175 440 L 175 -60 C 175 -170 110 -225 40 -215 C -5 -208 -20 -170 0 -145').dot(175, 660, 64)
    g['k'] = S().stroke('M 115 700 L 115 70').stroke('M 115 700 C 115 770 60 790 30 760 C 5 735 25 700 60 708').stroke('M 120 230 C 240 260 330 330 390 440').stroke('M 230 280 C 290 210 345 140 390 95 C 420 65 460 55 492 75')
    g['l'] = S().stroke('M 125 720 L 125 120 C 125 62 152 40 205 58').dot(125, 730, 96)   # tall, with a ball on top
    g['m'] = S().stroke('M 110 440 L 110 70').stroke('M 110 300 C 130 395 175 430 235 430 C 300 430 340 385 340 300 L 340 70').stroke('M 340 300 C 360 395 405 430 465 430 C 530 430 570 385 570 300 L 570 120 C 570 65 595 42 640 60')
    g['n'] = S().stroke('M 115 440 L 115 70').stroke('M 115 300 C 140 400 200 430 275 430 C 370 430 415 380 415 285 L 415 120 C 415 65 440 42 488 60')
    g['o'] = S().stroke('M 265 432 C 160 432 90 355 90 250 C 90 140 160 66 265 66 C 370 66 440 140 440 250 C 440 355 370 432 265 432 Z')
    g['p'] = S().stroke('M 115 440 L 115 -170 C 115 -215 90 -232 50 -220').stroke('M 115 300 C 130 400 190 430 270 430 C 370 430 430 350 430 250 C 430 135 360 68 265 68 C 195 68 140 100 115 160')
    g['q'] = S().stroke('M 395 440 L 395 -170 C 395 -215 420 -232 460 -220').stroke('M 395 270 C 395 390 330 430 250 430 C 155 430 95 360 95 255 C 95 140 160 70 250 70 C 330 70 395 130 395 230')
    g['r'] = S().stroke('M 115 440 L 115 70').stroke('M 115 300 C 140 400 200 430 280 430 C 330 430 360 415 380 385')
    g['s'] = S().stroke('M 390 395 C 360 425 315 435 255 435 C 165 435 110 395 110 335 C 110 200 405 295 405 150 C 405 92 350 62 255 62 C 175 62 115 88 92 140')
    g['t'] = S().stroke('M 190 620 L 190 120 C 190 62 222 40 278 60').stroke('M 190 620 C 190 670 160 690 130 676')
    g['u'] = S().stroke('M 110 370 L 110 220 C 110 120 170 64 255 64 C 345 64 400 125 400 220 L 400 370').stroke('M 400 370 L 400 120 C 400 65 425 42 472 60').dot(110, 388, 62).dot(400, 388, 62)
    g['v'] = S().stroke('M 90 380 C 130 270 180 160 245 70 C 310 160 360 270 400 380').dot(90, 390, 60).dot(400, 390, 60)
    g['w'] = S().stroke('M 80 380 C 110 270 150 160 200 70 C 235 160 265 240 300 320 C 335 240 365 160 400 70 C 450 160 490 270 520 380').dot(80, 390, 58).dot(520, 390, 58)
    g['x'] = S().stroke('M 95 380 C 200 280 300 170 410 70 C 430 52 460 52 478 70').stroke('M 400 380 C 300 280 200 170 95 70 C 80 55 55 58 45 75').dot(95, 390, 58).dot(400, 390, 58)
    g['y'] = S().stroke('M 95 380 L 95 220 C 95 120 155 70 240 70 C 330 70 385 125 385 220 L 385 380').stroke('M 385 380 L 385 -40 C 385 -170 300 -225 200 -222 C 110 -220 60 -175 72 -128 C 80 -98 115 -92 130 -115').dot(95, 390, 60).dot(385, 390, 60)
    g['z'] = S().stroke('M 380 430 C 280 320 190 210 110 80 C 220 64 330 64 420 78 C 455 84 462 118 438 128')
    return g

# ---------- capitals: free-standing swash forms ----------
def upper():
    g = {}
    S = lambda: Glyph(1.08)
    g['A'] = S().stroke('M 60 70 C 100 50 130 70 145 110 C 200 300 260 520 330 700 C 400 520 460 300 515 110 C 530 65 560 45 610 60').stroke('M 190 290 C 270 300 370 300 460 285')
    g['B'] = S().stroke('M 120 690 L 120 70').stroke('M 60 690 C 300 700 470 680 470 545 C 470 430 370 400 140 400').stroke('M 140 400 C 420 400 520 345 520 220 C 520 95 400 55 70 60')
    g['C'] = S().stroke('M 560 600 C 520 680 440 712 345 712 C 180 712 80 575 80 385 C 80 190 185 60 350 60 C 460 60 535 100 580 180 C 595 210 580 240 550 230')
    g['D'] = S().stroke('M 120 690 L 120 70').stroke('M 60 690 C 360 700 590 600 590 380 C 590 160 400 60 70 60')
    g['E'] = S().stroke('M 120 690 L 120 70').stroke('M 60 690 C 220 700 360 700 470 690 C 510 686 515 650 490 640').stroke('M 120 390 C 220 400 310 400 400 390').stroke('M 60 62 C 220 55 380 55 500 68 C 540 72 545 108 520 118')
    g['F'] = S().stroke('M 120 690 L 120 110 C 120 70 95 52 55 62').stroke('M 60 690 C 220 700 360 700 470 690 C 510 686 515 650 490 640').stroke('M 120 380 C 220 390 310 390 400 380')
    g['G'] = S().stroke('M 560 600 C 520 680 440 712 345 712 C 180 712 80 575 80 385 C 80 190 185 60 350 60 C 480 60 580 130 585 300 L 585 330 C 520 335 450 335 385 330')
    g['H'] = S().stroke('M 115 700 L 115 110 C 115 70 90 52 50 62').stroke('M 500 690 L 500 110 C 500 65 525 45 572 60').stroke('M 115 390 C 250 400 380 400 500 390')
    g['I'] = S().stroke('M 170 690 L 170 70').stroke('M 60 690 C 140 698 210 698 285 690').stroke('M 55 62 C 140 55 210 55 290 64')
    g['J'] = S().stroke('M 120 690 C 250 698 380 698 470 690').stroke('M 380 690 L 380 230 C 380 110 300 50 210 50 C 120 50 60 105 70 180 C 75 215 110 225 132 205')
    g['K'] = S().stroke('M 120 690 L 120 70').stroke('M 125 300 C 260 400 400 560 490 690 C 515 720 550 720 568 700').stroke('M 250 400 C 340 300 420 190 490 110 C 520 72 560 62 595 80')
    g['L'] = S().stroke('M 130 700 L 130 110').stroke('M 60 62 C 220 52 380 55 500 70 C 540 75 545 110 520 120').stroke('M 130 700 C 130 760 80 778 50 752')
    g['M'] = S().stroke('M 100 70 L 100 690 C 180 500 260 330 330 200 C 400 330 480 500 560 690 L 560 110 C 560 65 585 45 632 60')
    g['N'] = S().stroke('M 110 70 L 110 690 C 230 500 360 300 500 70 L 500 690').stroke('M 500 690 C 500 740 530 760 565 745')
    g['O'] = S().stroke('M 345 712 C 180 712 80 575 80 385 C 80 190 180 60 345 60 C 510 60 610 190 610 385 C 610 575 510 712 345 712 Z')
    g['P'] = S().stroke('M 120 690 L 120 110 C 120 70 95 52 55 62').stroke('M 60 690 C 330 700 500 660 500 520 C 500 380 360 340 130 345')
    g['Q'] = S().stroke('M 345 712 C 180 712 80 575 80 385 C 80 190 180 60 345 60 C 510 60 610 190 610 385 C 610 575 510 712 345 712 Z').stroke('M 400 170 C 470 90 540 20 640 -20 C 680 -35 700 -10 690 15')
    g['R'] = S().stroke('M 120 690 L 120 110 C 120 70 95 52 55 62').stroke('M 60 690 C 330 700 500 660 500 520 C 500 380 360 340 130 345').stroke('M 280 350 C 360 260 430 170 490 100 C 520 65 560 55 598 75')
    g['S'] = S().stroke('M 520 590 C 500 670 420 712 315 712 C 180 712 100 645 100 545 C 100 300 545 420 545 200 C 545 100 450 55 315 55 C 190 55 100 100 75 180 C 65 215 90 235 118 220')
    g['T'] = S().stroke('M 60 690 C 220 700 400 700 560 690').stroke('M 310 690 L 310 120 C 310 70 280 50 240 62')
    g['U'] = S().stroke('M 100 690 L 100 280 C 100 140 190 55 320 55 C 450 55 540 140 540 280 L 540 690').stroke('M 100 690 C 100 735 70 752 40 740')
    g['V'] = S().stroke('M 60 700 C 140 500 220 300 320 70 C 420 300 500 500 580 700').stroke('M 580 700 C 595 740 625 752 655 735')
    g['W'] = S().stroke('M 50 700 C 110 480 170 270 230 70 C 280 230 330 380 380 520 C 430 380 480 230 530 70 C 590 270 650 480 710 700')
    g['X'] = S().stroke('M 70 690 C 220 490 380 280 540 70 C 560 45 600 45 615 70').stroke('M 540 690 C 400 490 250 290 90 70 C 75 50 40 50 30 75')
    g['Y'] = S().stroke('M 60 700 C 140 560 230 450 315 360 C 400 450 490 560 570 700').stroke('M 315 360 L 315 110 C 315 70 290 50 250 62')
    g['Z'] = S().stroke('M 70 690 C 220 700 380 700 520 690 C 380 480 230 270 90 66 C 240 56 400 58 540 72 C 580 76 585 112 560 122')
    return g

def figures():
    g = {}
    S = lambda: Glyph()
    g['zero'] = S().stroke('M 290 700 C 160 700 80 560 80 380 C 80 190 160 55 290 55 C 420 55 500 190 500 380 C 500 560 420 700 290 700 Z')
    g['one'] = S().stroke('M 90 560 C 170 590 230 640 270 700 L 270 110 C 270 70 245 52 205 62')
    g['two'] = S().stroke('M 90 560 C 120 650 190 700 285 700 C 390 700 465 635 465 540 C 465 380 160 260 90 60 C 230 52 380 54 500 66 C 540 70 545 105 520 115')
    g['three'] = S().stroke('M 95 600 C 130 665 200 700 285 700 C 385 700 455 645 455 560 C 455 465 380 415 265 410 C 395 405 485 345 485 225 C 485 110 395 55 270 55 C 170 55 100 100 75 170')
    g['four'] = S().stroke('M 390 70 L 390 700 C 290 560 170 400 70 250 C 220 240 380 240 520 250')
    g['five'] = S().stroke('M 470 700 C 370 700 250 700 160 690 L 140 430 C 190 455 245 465 300 465 C 420 465 495 380 495 255 C 495 125 400 55 275 55 C 175 55 105 100 75 170')
    g['six'] = S().stroke('M 420 680 C 300 650 200 570 140 450 C 100 370 85 300 85 230 C 85 110 170 55 290 55 C 410 55 495 125 495 245 C 495 360 410 420 300 420 C 205 420 140 370 110 300')
    g['seven'] = S().stroke('M 70 690 C 220 700 380 700 520 690 C 400 510 300 300 230 70')
    g['eight'] = S().stroke('M 290 410 C 180 410 115 470 115 555 C 115 645 190 700 290 700 C 390 700 465 645 465 555 C 465 470 400 410 290 410 C 165 410 80 330 80 215 C 80 110 170 55 290 55 C 410 55 500 110 500 215 C 500 330 415 410 290 410 Z')
    g['nine'] = S().stroke('M 160 75 C 280 105 380 185 440 305 C 480 385 495 455 495 525 C 495 645 410 700 290 700 C 170 700 85 630 85 510 C 85 395 170 335 280 335 C 375 335 440 385 470 455')
    return g

def punctuation():
    g = {}
    S = lambda: Glyph()
    g['period'] = (S().dot(110, 80, 70), '.')
    g['comma'] = (S().dot(110, 80, 70).stroke('M 150 70 C 150 10 120 -60 70 -110', .7), ',')
    g['colon'] = (S().dot(110, 80, 70).dot(110, 380, 70), ':')
    g['semicolon'] = (S().dot(110, 380, 70).dot(110, 80, 70).stroke('M 150 70 C 150 10 120 -60 70 -110', .7), ';')
    g['exclam'] = (S().stroke('M 120 700 L 125 300', 1.05).dot(122, 80, 70), '!')
    g['question'] = (S().stroke('M 80 590 C 110 665 180 705 265 705 C 370 705 440 645 440 560 C 440 430 280 420 270 290').dot(270, 80, 70), '?')
    g['quotesingle'] = (S().stroke('M 120 700 L 115 520', .9), "'")
    g['quoteright'] = (S().dot(120, 640, 62).stroke('M 158 630 C 158 570 130 510 85 470', .65), '’')
    g['hyphen'] = (S().stroke('M 80 290 L 330 290'), '-')
    g['endash'] = (S().stroke('M 80 290 L 520 290'), '–')
    g['slash'] = (S().stroke('M 400 740 L 80 -60', .8), '/')
    g['parenleft'] = (S().stroke('M 300 760 C 140 620 90 450 90 300 C 90 150 140 -10 300 -150', .8), '(')
    g['parenright'] = (S().stroke('M 80 760 C 240 620 290 450 290 300 C 290 150 240 -10 80 -150', .8), ')')
    g['ampersand'] = (S().stroke('M 560 300 C 520 120 420 50 300 50 C 170 50 90 120 90 230 C 90 360 220 400 300 470 C 360 520 380 570 380 620 C 380 675 340 705 290 705 C 230 705 190 665 190 610 C 190 520 330 330 580 60'), '&')
    g['rupee'] = (S().stroke('M 70 690 L 520 690').stroke('M 70 520 L 520 520').stroke('M 90 690 C 330 690 430 640 430 560 C 430 460 320 410 130 410 C 280 300 400 180 520 60'), '₹')
    return g


# ---------- outlines ----------
def outline(glyph, extra=()):
    path = pathops.Path()
    for shape in list(glyph.shapes) + list(extra):
        shape = [(x + y * SLANT, y) for x, y in shape]
        path.moveTo(*shape[0])
        for p in shape[1:]:
            path.lineTo(*p)
        path.close()
    path.simplify(fix_winding=True, keep_starting_points=False, clockwise=True)
    contours, cur = [], []
    for verb, pts in path:
        if verb == pathops.PathVerb.MOVE:
            cur = [pts[0]]
        elif verb == pathops.PathVerb.LINE:
            cur.append(pts[0])
        elif verb == pathops.PathVerb.CLOSE:
            if len(cur) > 2:
                # A closed loop: thin each half separately (the two ends of one half are the same point otherwise).
                k = max(range(len(cur)), key=lambda m: math.dist(cur[0], cur[m]))
                contours.append(rdp(cur[:k + 1], 1.4)[:-1] + rdp(cur[k:] + [cur[0]], 1.4)[:-1])
            cur = []
    return contours

def rdp(pts, eps):
    """Drop points that sit on a nearly straight line (keeps files small)."""
    if len(pts) < 4:
        return pts
    keep = [True] * len(pts)
    def walk(i, j):
        (x0, y0), (x1, y1) = pts[i], pts[j]
        L = math.hypot(x1 - x0, y1 - y0) or 1
        best, k = 0, -1
        for m in range(i + 1, j):
            d = abs((x1 - x0) * (y0 - pts[m][1]) - (x0 - pts[m][0]) * (y1 - y0)) / L
            if d > best:
                best, k = d, m
        if best > eps:
            walk(i, k); walk(k, j)
        else:
            for m in range(i + 1, j):
                keep[m] = False
    walk(0, len(pts) - 1)
    return [p for p, k in zip(pts, keep) if k]

def bounds(contours):
    xs = [x for c in contours for x, _ in c]
    return (min(xs), max(xs)) if xs else (0, 0)


glyphs, widths, cmap = {}, {}, {}

def add(name, contours, width, shift=0):
    pen = TTGlyphPen(None)
    for c in contours:
        pts = [(round(x + shift), round(y)) for x, y in c]
        pen.moveTo(pts[0])
        for p in pts[1:]:
            pen.lineTo(p)
        pen.closePath()
    glyphs[name], widths[name] = pen.glyph(), round(width)

def place(name, glyph, bar=False):
    """Space the letter by its own shape; lowercase gets the bar across its full width."""
    x0, x1 = bounds(outline(glyph))
    width, shift = (x1 - x0) + 2 * SIDE, SIDE - x0
    extra = [[(x0 - SIDE - 2, BAR[0]), (x1 + SIDE + 2, BAR[0]), (x1 + SIDE + 2, BAR[1]), (x0 - SIDE - 2, BAR[1])]] if bar else []
    add(name, outline(glyph, extra), width, shift)

add('.notdef', [[(60, 0), (60, 700), (440, 700), (440, 0)], [(120, 60), (380, 60), (380, 640), (120, 640)][::-1]], 500)
add('space', [], 260)
cmap[32] = 'space'

for ch, gl in lower().items():
    place(ch, gl, bar=True); cmap[ord(ch)] = ch
for ch, gl in upper().items():
    place(ch, gl); cmap[ord(ch)] = ch
for i, (name, gl) in enumerate(figures().items()):
    place(name, gl); cmap[ord('0123456789'[i])] = name
for name, (gl, ch) in punctuation().items():
    place(name, gl); cmap[ord(ch)] = name

order = ['.notdef', 'space'] + [n for n in glyphs if n not in ('.notdef', 'space')]
fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(order)
fb.setupCharacterMap(cmap)
fb.setupGlyf({n: glyphs[n] for n in order})
fb.setupHorizontalMetrics({n: (widths[n], glyphs[n].xMin if glyphs[n].numberOfContours else 0) for n in order})
fb.setupHorizontalHeader(ascent=950, descent=-280)
fb.setupNameTable({'familyName': 'Akhor', 'styleName': 'Regular', 'uniqueFontIdentifier': 'Kaamghor:Akhor:2.000',
                   'fullName': 'Akhor Regular', 'psName': 'Akhor-Regular', 'version': 'Version 2.000',
                   'copyright': 'Kaamghor', 'designer': 'Kaamghor'})
fb.setupOS2(sTypoAscender=950, sTypoDescender=-280, sTypoLineGap=0, usWinAscent=950, usWinDescent=300,
            sCapHeight=700, sxHeight=XH, achVendID='KAAM', fsType=0)
fb.setupPost()
fb.save(OUT / 'akhor.ttf')
fb.font.flavor = 'woff2'
fb.save(OUT / 'akhor.woff2')
print('web/assets/fonts/akhor.ttf, akhor.woff2:', len(order), 'glyphs')
