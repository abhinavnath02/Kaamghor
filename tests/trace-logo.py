"""Turns the logo bitmap into a vector path (straight-edged polygons) and writes web/logo.svg.

The logo is made of straight lines, so: threshold the alpha channel, follow the pixel
boundaries into closed loops, then simplify each loop (Ramer-Douglas-Peucker) back to its corners.
Usage: python -I trace-logo.py <logo.png or .svg with an embedded PNG> <out.svg>
"""
import base64, re, struct, sys, zlib


def read_png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w = 8, b'', 0
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
            assert depth == 8 and ctype == 6, 'expects 8-bit RGBA'
        elif typ == b'IDAT':
            idat += body
        pos += 12 + ln
    raw, bpp, stride = zlib.decompress(idat), 4, w * 4
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return w, h, rows


def loops_from_mask(w, h, filled):
    # Directed boundary edges with the filled pixel on the left; corners are grid points.
    nxt = {}
    for y in range(h):
        for x in range(w):
            if not filled(x, y): continue
            if not filled(x, y - 1): nxt.setdefault((x + 1, y), []).append((x, y))
            if not filled(x - 1, y): nxt.setdefault((x, y), []).append((x, y + 1))
            if not filled(x, y + 1): nxt.setdefault((x, y + 1), []).append((x + 1, y + 1))
            if not filled(x + 1, y): nxt.setdefault((x + 1, y + 1), []).append((x + 1, y))
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop, cur = [start], start
        while True:
            outs = nxt[cur]
            nb = outs.pop()
            if not outs: del nxt[cur]
            if nb == start: break
            loop.append(nb); cur = nb
            if cur not in nxt: break
        if len(loop) > 8: loops.append(loop)
    return loops


def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = (dx * dx + dy * dy) ** .5 or 1
    best, idx = -1, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / norm
        if d > best: best, idx = d, i
    if best <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)


def simplify_loop(loop, eps):
    # Split the closed loop at its two most distant points, simplify both halves.
    a = loop[0]
    far = max(range(len(loop)), key=lambda i: (loop[i][0] - a[0]) ** 2 + (loop[i][1] - a[1]) ** 2)
    first, second = loop[:far + 1], loop[far:] + [loop[0]]
    return rdp(first, eps)[:-1] + rdp(second, eps)[:-1]


def main(src, out):
    data = open(src, 'rb').read()
    if src.lower().endswith('.svg'):
        m = re.search(rb'data:image/png;base64,([A-Za-z0-9+/=\s]+)', data)
        data = base64.b64decode(re.sub(rb'\s', b'', m.group(1)))
    w, h, rows = read_png(data)
    filled = lambda x, y: 0 <= x < w and 0 <= y < h and rows[y][x * 4 + 3] >= 128
    loops = [simplify_loop(l, 1.6) for l in loops_from_mask(w, h, filled)]
    d = ' '.join('M' + ' '.join(f'{x} {y}' for x, y in l) + 'Z' for l in loops)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">'
           f'<path fill="#1c1c1e" fill-rule="evenodd" d="{d}"/></svg>\n')
    open(out, 'w', encoding='utf-8').write(svg)
    print(f'{len(loops)} shapes, {sum(len(l) for l in loops)} corners, {len(svg)} bytes -> {out}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
