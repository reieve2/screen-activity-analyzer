import struct, zlib

def make_png(w, h, draw):
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            raw += bytes(draw(x, y, w, h))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

def draw(x, y, w, h):
    cx, cy = w // 2, h // 2
    dx, dy = x - cx, y - cy
    d = (dx * dx + dy * dy) ** 0.5
    if 5 <= x < w - 5 and 8 <= y < h - 4:
        if d < 5.5:
            return (20, 20, 35, 255)
        elif d < 7:
            return (90, 90, 110, 255)
        else:
            return (79, 70, 229, 255)
    if cx - 3 <= x < cx + 3 and 5 <= y < 9:
        return (79, 70, 229, 255)
    return (0, 0, 0, 0)

with open(r'D:\lifecode\screen-tracker\assets\icon.png', 'wb') as f:
    f.write(make_png(32, 32, draw))
print('Icon generated')
