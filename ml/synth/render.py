"""Renders one engraved text line on a procedural plate (no pixels from any real photo).

- Plate: green paint or bare grey metal, generated from layered noise (paint orange-peel, worn
  patches showing metal, speckles; or brushed metal with mill-scale patches and scratches).
- Dots: placed closely ALONG each character's strokes (font.py). Each dot is a dimple in a height map (paraboloid with a slight raised burr), lit from a
  random direction, so a dot has a dark rim on one side and a lighter centre; on paint the pits
  show bare metal or dirt. Dot size, spacing, depth and position vary slightly.
- Rust blobs/stains (some over the characters) and glare spots are painted on the plate.

Images are float32 BGR in [0, 1] (OpenCV order).
"""
from __future__ import annotations

import colorsys
import math

import cv2
import numpy as np

from . import font


def _hsv(h: float, s: float, v: float) -> np.ndarray:
    """HSV (h in degrees, s/v in 0..1) -> BGR float."""
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360, s, v)
    return np.array([b, g, r], np.float32)


def noise(rng: np.random.Generator, h: int, w: int, scale: float, octaves: int = 4) -> np.ndarray:
    """Smooth fractal noise in [0, 1]: random grids resized up and summed."""
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cell = max(2.0, scale / (2**o))
        gh, gw = max(2, int(h / cell) + 2), max(2, int(w / cell) + 2)
        grid = rng.random((gh, gw), dtype=np.float32)
        out += amp * cv2.resize(grid, (w, h), interpolation=cv2.INTER_CUBIC)
        total += amp
        amp *= 0.5
    out /= total
    return np.clip((out - out.min()) / max(1e-6, out.max() - out.min()), 0, 1)


def metal_colour(rng: np.random.Generator) -> np.ndarray:
    hue = rng.choice([rng.uniform(190, 230), rng.uniform(20, 45)])  # cool or warm steel tint
    return _hsv(hue, rng.uniform(0.0, 0.12), rng.uniform(0.35, 0.8))


def background(rng: np.random.Generator, h: int, w: int, unit: float):
    """Returns (plate image, kind, bare-metal colour)."""
    metal = metal_colour(rng)
    if rng.random() < 0.5:
        kind = "paint"
        base = _hsv(rng.uniform(75, 165), rng.uniform(0.25, 0.85), rng.uniform(0.2, 0.7))
        img = np.ones((h, w, 3), np.float32) * base
        # Uneven paint thickness and orange-peel texture.
        img *= (0.85 + 0.3 * noise(rng, h, w, unit * 12))[..., None]
        img *= (0.94 + 0.12 * noise(rng, h, w, unit * 0.8, 2))[..., None]
        # Worn patches where bare metal shows.
        if rng.random() < 0.5:
            wear = noise(rng, h, w, unit * rng.uniform(6, 20))
            m = np.clip((wear - rng.uniform(0.7, 0.9)) * 8, 0, 1)[..., None]
            img = img * (1 - m) + metal * m * (0.8 + 0.4 * noise(rng, h, w, unit, 2))[..., None]
        # Speckles (dust, paint flecks).
        n = int(h * w / (unit * unit) * rng.uniform(0.0, 0.15))
        for _ in range(n):
            c = (int(rng.integers(w)), int(rng.integers(h)))
            v = float(rng.uniform(0.5, 1.4))
            cv2.circle(img, c, int(rng.integers(1, max(2, int(unit * 0.3)))), (base * v).tolist(), -1)
    else:
        kind = "metal"
        img = np.ones((h, w, 3), np.float32) * metal
        # Brushed / ground texture: noise smeared along one direction.
        streaks = rng.random((h, w), dtype=np.float32)
        k = int(max(3, unit * rng.uniform(2, 8))) | 1
        kernel = np.zeros((k, k), np.float32)
        kernel[k // 2, :] = 1 / k
        rot = cv2.getRotationMatrix2D((k / 2, k / 2), float(rng.uniform(-20, 20)), 1)
        kernel = cv2.warpAffine(kernel, rot, (k, k))
        kernel /= max(kernel.sum(), 1e-6)
        streaks = cv2.filter2D(streaks, -1, kernel)
        img *= (0.85 + 0.3 * streaks)[..., None]
        # Mill scale / darker patches.
        img *= (0.75 + 0.4 * noise(rng, h, w, unit * rng.uniform(8, 25)))[..., None]
        # Scratches.
        for _ in range(int(rng.integers(0, 8))):
            p1 = (int(rng.integers(w)), int(rng.integers(h)))
            ang = rng.uniform(0, math.pi)
            ln = rng.uniform(1, 6) * unit
            p2 = (int(p1[0] + ln * math.cos(ang)), int(p1[1] + ln * math.sin(ang)))
            cv2.line(img, p1, p2, (metal * rng.uniform(0.6, 1.4)).tolist(), 1, cv2.LINE_AA)
    return np.clip(img, 0, 1), kind, metal


def _stamp_dimple(hmap: np.ndarray, cx: float, cy: float, r: float, depth: float) -> None:
    """Adds one dot: a paraboloid pit of radius r with a small raised burr around it."""
    pad = int(math.ceil(r * 1.4)) + 1
    x0, y0 = int(cx) - pad, int(cy) - pad
    x1, y1 = int(cx) + pad + 1, int(cy) + pad + 1
    if x1 <= 0 or y1 <= 0 or x0 >= hmap.shape[1] or y0 >= hmap.shape[0]:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / r
    pit = np.where(d < 1, depth * (1 - d**2), 0)
    burr = np.where((d >= 1) & (d < 1.35), -0.12 * depth * np.sin((d - 1) / 0.35 * math.pi), 0)
    sx0, sy0 = max(0, -x0), max(0, -y0)
    tx0, ty0 = max(0, x0), max(0, y0)
    tx1, ty1 = min(hmap.shape[1], x1), min(hmap.shape[0], y1)
    patch = (pit + burr)[sy0 : sy0 + ty1 - ty0, sx0 : sx0 + tx1 - tx0]
    region = hmap[ty0:ty1, tx0:tx1]
    # Overlapping pits keep the deeper one; the burr adds up around them.
    region[:] = np.where(patch > 0, np.maximum(region, patch), region + patch)


def render_line(rng: np.random.Generator, text: str):
    """Returns (image, corners of the text box as 4 (x, y) points, info dict).

    Dots follow each character's strokes: spacing (centre to centre) 0.8-1.2 dot diameters,
    character height 9-12 dots, slight jitter; spacing and dot size vary per image.
    """
    variant = rng.random() < 0.3
    dots_high = int(rng.integers(9, 13))  # dots along a full-height vertical stroke
    spacing = rng.uniform(6, 9)  # px between neighbouring dots (high resolution)
    ratio = rng.uniform(0.8, 1.2)  # spacing in dot diameters
    radius = spacing / ratio / 2
    char_h = spacing * (dots_high - 1)
    char_w = char_h * rng.uniform(0.55, 0.68)  # monospace engraving face
    advance = char_w + char_h * rng.uniform(0.18, 0.35)
    text_w = (len(text) - 1) * advance + char_w
    text_h = char_h
    margin = char_h * rng.uniform(0.9, 1.6)
    w = int(text_w + 2 * margin)
    h = int(text_h + 2 * margin)
    unit = spacing
    plate, kind, metal = background(rng, h, w, unit)

    # Height map of all dots.
    hmap = np.zeros((h, w), np.float32)
    x0, y0 = margin, margin
    slope = rng.normal(0, 0.01)  # engraving not perfectly level
    for i, ch in enumerate(text):
        cx0 = x0 + i * advance + rng.normal(0, 0.04 * char_h)
        cy0 = y0 + i * advance * slope + rng.normal(0, 0.03 * char_h)
        for gx, gy in font.dots(ch, char_w, char_h, spacing, rng, jitter=0.08, variant=variant):
            r = radius * rng.uniform(0.88, 1.12)
            _stamp_dimple(hmap, cx0 + gx, cy0 + gy, r, rng.uniform(0.6, 1.0))

    # Dents next to the line (not part of the label): stray punch marks just before/after the
    # text and occasionally above/below, so the model learns not to read them as characters.
    marks = 0
    if rng.random() < 0.5:
        text_x1 = x0 + text_w
        for side in ("left", "right"):
            if rng.random() < 0.6:
                gap = char_w * rng.uniform(0.1, 0.4)
                mx = x0 - gap if side == "left" else text_x1 + gap
                for _ in range(int(rng.integers(1, 4))):
                    _stamp_dimple(
                        hmap,
                        mx + rng.normal(0, 0.15 * char_w),
                        y0 + rng.uniform(0.1, 0.9) * char_h,
                        radius * rng.uniform(0.6, 1.6),
                        rng.uniform(0.4, 1.0),
                    )
                    marks += 1
        if rng.random() < 0.3:
            for _ in range(int(rng.integers(1, 3))):
                above = rng.random() < 0.5
                _stamp_dimple(
                    hmap,
                    x0 + rng.uniform(0, text_w),
                    y0 - char_h * rng.uniform(0.15, 0.4) if above else y0 + char_h * rng.uniform(1.15, 1.4),
                    radius * rng.uniform(0.6, 1.6),
                    rng.uniform(0.4, 1.0),
                )
                marks += 1

    # Light the surface: dimples get a dark rim on one side and a light centre.
    relief = rng.uniform(2.0, 4.0)
    gy_, gx_ = np.gradient(hmap * relief * radius / 3)
    az = rng.uniform(0, 2 * math.pi)
    el = math.radians(rng.uniform(25, 70))
    lx, ly, lz = math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)
    shade = (gx_ * lx + gy_ * ly + lz) / np.sqrt(gx_**2 + gy_**2 + 1) / lz
    depth = np.clip(hmap, 0, None)
    inside = np.clip(depth * 2.5, 0, 1)[..., None]
    style = rng.choice(["metal", "dark", "plain"], p=[0.45, 0.35, 0.2] if kind == "paint" else [0.2, 0.5, 0.3])
    img = plate.copy()
    if style == "metal":  # paint punched away: bare metal in the pit
        img = img * (1 - inside) + metal * rng.uniform(0.7, 1.2) * inside
    elif style == "dark":  # dirt / oxide in the pit
        img = img * (1 - inside * rng.uniform(0.35, 0.75))
    ao = 1 - rng.uniform(0.2, 0.5) * np.clip(np.sqrt(gx_**2 + gy_**2) * 1.5, 0, 1)
    img = img * np.clip(shade, 0.25, 1.8)[..., None] * ao[..., None]

    # Scratches near the ends of the line (also not part of the label).
    scratches = 0
    if rng.random() < 0.4:
        for _ in range(int(rng.integers(1, 4))):
            end = x0 - char_w * rng.uniform(0, 0.5) if rng.random() < 0.5 else x0 + text_w + char_w * rng.uniform(0, 0.5)
            sy = y0 + rng.uniform(-0.2, 1.2) * char_h
            ang = rng.uniform(0, math.pi)
            ln = char_h * rng.uniform(0.3, 1.5)
            p1 = (int(end), int(sy))
            p2 = (int(end + ln * math.cos(ang)), int(sy + ln * math.sin(ang)))
            colour = (metal * rng.uniform(0.4, 1.5)).clip(0, 1).tolist()
            cv2.line(img, p1, p2, colour, int(rng.integers(1, 3)), cv2.LINE_AA)
            scratches += 1

    pad = radius * 1.2
    corners = np.array(
        [
            [x0 - pad, y0 - pad],
            [x0 + text_w + pad, y0 + (len(text) - 1) * advance * slope - pad],
            [x0 + text_w + pad, y0 + (len(text) - 1) * advance * slope + text_h + pad],
            [x0 - pad, y0 + text_h + pad],
        ],
        np.float32,
    )
    info = {
        "plate": kind,
        "dots_high": dots_high,
        "spacing_per_diameter": round(ratio, 2),
        "pit": str(style),
        "marks": marks,
        "scratches": scratches,
    }
    return np.clip(img, 0, 1), corners, info


def rust(rng: np.random.Generator, img: np.ndarray, corners: np.ndarray, text_h: float) -> int:
    """Rust blobs and stains, some over the characters. Returns how many."""
    h, w = img.shape[:2]
    n = int(rng.integers(1, 4))
    (xa, ya), (xb, yb) = corners.min(0), corners.max(0)
    for _ in range(n):
        size = text_h * rng.uniform(0.25, 1.2)
        if rng.random() < 0.5:  # over the text
            cx, cy = rng.uniform(xa, xb), rng.uniform(ya, yb)
        else:
            cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        s = int(size * 2) + 4
        x0, y0 = int(cx - s / 2), int(cy - s / 2)
        blob = noise(rng, s, s, size / 3, 3)
        yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
        ell = 1 - (((xx - s / 2) / (s / 2)) ** 2 + ((yy - s / 2) / (s / 2 * rng.uniform(0.5, 1))) ** 2)
        mask = np.clip((blob * 0.6 + ell * 0.7 - 0.55) * 6, 0, 1)
        alpha = rng.uniform(0.15, 0.4) if rng.random() < 0.3 else rng.uniform(0.45, 0.95)
        colour = _hsv(rng.uniform(8, 30), rng.uniform(0.45, 0.9), rng.uniform(0.2, 0.6))
        tex = (0.7 + 0.6 * noise(rng, s, s, max(2, size / 10), 2))[..., None]
        tx0, ty0, tx1, ty1 = max(0, x0), max(0, y0), min(w, x0 + s), min(h, y0 + s)
        if tx1 <= tx0 or ty1 <= ty0:
            continue
        m = (mask * alpha)[ty0 - y0 : ty1 - y0, tx0 - x0 : tx1 - x0, None]
        t = tex[ty0 - y0 : ty1 - y0, tx0 - x0 : tx1 - x0]
        img[ty0:ty1, tx0:tx1] = img[ty0:ty1, tx0:tx1] * (1 - m) + colour * t * m
    return n


def glare(rng: np.random.Generator, img: np.ndarray, corners: np.ndarray, text_h: float) -> int:
    """Specular glare spots (often blown out to white). Returns how many."""
    h, w = img.shape[:2]
    n = int(rng.integers(1, 3))
    (xa, ya), (xb, yb) = corners.min(0), corners.max(0)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for _ in range(n):
        cx, cy = rng.uniform(xa, xb), rng.uniform(ya - text_h, yb + text_h)
        sx = text_h * rng.uniform(0.15, 1.0)
        sy = sx * rng.uniform(0.3, 1.0)
        ang = rng.uniform(0, math.pi)
        ca, sa = math.cos(ang), math.sin(ang)
        u = ((xx - cx) * ca + (yy - cy) * sa) / sx
        v = (-(xx - cx) * sa + (yy - cy) * ca) / sy
        # Strong enough to wash characters out partly, not so strong the line can't be read.
        spot = np.exp(-(u**2 + v**2) / 2) * rng.uniform(0.3, 0.9)
        tint = np.array([1.0, 1.0, 1.0], np.float32) + rng.normal(0, 0.05, 3).astype(np.float32)
        img += spot[..., None] * tint
    np.clip(img, 0, 1, out=img)
    return n
