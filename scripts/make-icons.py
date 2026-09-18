#!/usr/bin/env python3
"""Generate the plugin's PNG assets.

Stream Deck requires PNGs for manifest icons (SVG is only allowed for images
set at runtime), and every icon needs a @2x companion. Rather than commit
binaries produced by a design tool, the glyphs are drawn here from signed
distance fields so the assets are reproducible and stay crisp at 20px, where
the sidebar shows them.

The visual system: a tile is about either quota (a level that drains) or time
(a clock face you read), and its window is short (blue) or long (purple). So
the four quota/reset icons pair a shape with a colour and never collide:

    quota  5h  -> upright level, blue      reset 5h     -> clock, blue
    quota week -> lying level, purple      reset weekly -> calendar, purple

Activity is the odd one out and keeps the three-lamp mark, which doubles as
the plugin's own icon.
"""

import math
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "com.topener.codexdeck.sdPlugin", "imgs")

BG = (0x16, 0x18, 0x1D, 255)
AMBER = (0xF5, 0xA6, 0x23, 255)
BLUE = (0x4A, 0x9E, 0xFF, 255)
GREEN = (0x3F, 0xB9, 0x50, 255)
PURPLE = (0xA3, 0x71, 0xF7, 255)


# --- PNG ----------------------------------------------------------------


def write_png(path, width, height, pixels):
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in pixels)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(png)


# --- signed distance fields --------------------------------------------
#
# Every shape is a function of a point in the unit square returning the signed
# distance to its edge (negative inside). Composing them with min/max gives
# unions and intersections, and converting distance to coverage at the end is
# what antialiases the result at any size.


def sd_circle(cx, cy, r):
    return lambda x, y: math.hypot(x - cx, y - cy) - r


def sd_rrect(x0, y0, x1, y1, r):
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = min(r, hx, hy)

    def f(x, y):
        qx, qy = abs(x - cx) - (hx - r), abs(y - cy) - (hy - r)
        return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r

    return f


def sd_segment(x0, y0, x1, y1, w):
    """A capsule: the stroke from one point to another, round-capped."""
    dx, dy = x1 - x0, y1 - y0
    length2 = dx * dx + dy * dy or 1e-9

    def f(x, y):
        t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / length2))
        return math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) - w / 2

    return f


def outline(shape, w):
    """The edge of a shape, w wide, centred on it."""
    return lambda x, y: abs(shape(x, y)) - w / 2


def both(a, b):
    """Intersection — used to clip a fill to the inside of an outline."""
    return lambda x, y: max(a(x, y), b(x, y))


def below(level):
    """Half-plane y >= level, i.e. the bottom of the tile."""
    return lambda x, y: level - y


def left_of(level):
    return lambda x, y: x - level


# --- raster -------------------------------------------------------------


def blend(base, color, alpha):
    """Source-over composite of `color` at `alpha` onto an RGBA base pixel."""
    base_alpha = base[3] / 255
    out_alpha = alpha + base_alpha * (1 - alpha)
    if out_alpha <= 0:
        return [0, 0, 0, 0]
    rgb = [round((color[k] * alpha + base[k] * base_alpha * (1 - alpha)) / out_alpha) for k in range(3)]
    return rgb + [round(out_alpha * 255)]


def draw(size, layers, background=None):
    """Composite `layers` — (sdf, colour) pairs, back to front — at `size`."""
    px = 1.0 / size
    img = [[list(background) if background else [0, 0, 0, 0] for _ in range(size)] for _ in range(size)]
    for shape, color in layers:
        for j in range(size):
            y = (j + 0.5) * px
            row = img[j]
            for i in range(size):
                d = shape((i + 0.5) * px, y)
                if d > px:
                    continue
                # Distance -> coverage: one pixel of feather across the edge.
                alpha = max(0.0, min(1.0, 0.5 - d / px)) * (color[3] / 255)
                if alpha > 0:
                    row[i] = blend(row[i], color, alpha)
    return img


# --- glyphs -------------------------------------------------------------
#
# Each returns layers in unit coordinates, so the same definition renders the
# 20px sidebar icon and the 144px key image.


def glyph_activity():
    """Three lamps: needs-you, working, idle — the states the tile can show."""
    return [
        (sd_circle(0.5, 0.235, 0.125), AMBER),
        (sd_circle(0.5, 0.500, 0.125), BLUE),
        (sd_circle(0.5, 0.765, 0.125), GREEN),
    ]


def _level(x0, y0, x1, y1, fraction, vertical, color):
    """A gauge that reads as a container with something left in it."""
    wall = 0.072
    shell = sd_rrect(x0, y0, x1, y1, 0.085)
    inner = sd_rrect(x0 + wall, y0 + wall, x1 - wall, y1 - wall, 0.05)
    if vertical:
        cut = below(y1 - wall - fraction * (y1 - y0 - 2 * wall))
    else:
        cut = left_of(x0 + wall + fraction * (x1 - x0 - 2 * wall))
    return [(outline(shell, wall), color), (both(inner, cut), color)]


def glyph_usage_5h():
    """Upright level, blue: the short window."""
    return _level(0.315, 0.10, 0.685, 0.90, 0.58, True, BLUE)


def glyph_usage_weekly():
    """The same level lying down, purple: the long window."""
    return _level(0.06, 0.315, 0.94, 0.685, 0.58, False, PURPLE)


def glyph_reset_5h():
    """A clock: the short window's countdown."""
    return [
        (outline(sd_circle(0.5, 0.5, 0.36), 0.105), BLUE),
        (sd_segment(0.5, 0.5, 0.5, 0.245, 0.085), BLUE),
        (sd_segment(0.5, 0.5, 0.715, 0.585, 0.085), BLUE),
    ]


def glyph_reset_weekly():
    """A calendar: the long window's countdown."""
    body = sd_rrect(0.09, 0.225, 0.91, 0.90, 0.10)
    return [
        (sd_segment(0.315, 0.10, 0.315, 0.26, 0.10), PURPLE),
        (sd_segment(0.685, 0.10, 0.685, 0.26, 0.10), PURPLE),
        (outline(body, 0.085), PURPLE),
        # Header band, clipped to the body so it keeps the rounded top.
        (both(body, lambda x, y: y - 0.40), PURPLE),
        (sd_circle(0.5, 0.655, 0.105), PURPLE),
    ]


def scaled(glyph, factor):
    """Shrink a glyph about the centre, to give a key image some margin."""

    def remap(shape):
        return lambda x, y: shape(0.5 + (x - 0.5) / factor, 0.5 + (y - 0.5) / factor) * factor

    return [(remap(shape), color) for shape, color in glyph]


def icon(glyph):
    """Sidebar/marketplace art: the glyph inside a rounded dark tile."""
    return lambda size: draw(size, [(sd_rrect(0, 0, 1, 1, 0.17), BG), *scaled(glyph, 0.66)])


def key(glyph):
    """Placeholder shown on the key until the plugin paints real data."""
    return lambda size: draw(size, scaled(glyph, 0.52), background=BG)


GLYPHS = {
    "activity": glyph_activity(),
    "usage-5h": glyph_usage_5h(),
    "usage-weekly": glyph_usage_weekly(),
    "reset-5h": glyph_reset_5h(),
    "reset-weekly": glyph_reset_weekly(),
    # The retired all-in-one tile is hidden from the sidebar but still needs art.
    "status": glyph_activity(),
}

def targets():
    """(name, renderer, [1x size, 2x size]) for every PNG the manifest needs."""
    out = [
        ("plugin/category", icon(GLYPHS["activity"]), [28, 56]),
        ("plugin/marketplace", icon(GLYPHS["activity"]), [256, 512]),
    ]
    for slug, glyph in GLYPHS.items():
        out.append((f"actions/{slug}/icon", icon(glyph), [20, 40]))
        out.append((f"actions/{slug}/key", key(glyph), [72, 144]))
    return out


def main():
    for name, render, sizes in targets():
        for index, size in enumerate(sizes):
            suffix = "" if index == 0 else "@2x"
            path = os.path.join(ROOT, f"{name}{suffix}.png")
            write_png(path, size, size, render(size))
            print(f"wrote {os.path.relpath(path, os.path.join(ROOT, '..', '..'))}")


if __name__ == "__main__":
    main()
