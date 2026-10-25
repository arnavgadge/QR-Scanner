"""Stroke-following dot-peen font (0-9, A-Z), as on the real plates: each character is drawn as
pen strokes (lines, arcs, curves) of a monospace engraving-style face, and the engraver punches
dots closely ALONG those strokes. The zero has a slash (Ø).

Glyphs live in a unit box: x 0..1 (left to right), y 0..1 (top to bottom). `dots()` places dots
along every stroke at a given spacing (in glyph-height units) with slight jitter, dropping a dot
where it would land on one already placed (stroke joins).
"""
from __future__ import annotations

import math

import numpy as np

Stroke = list[tuple[float, float]]


def line(x0, y0, x1, y1) -> Stroke:
    return [(x0, y0), (x1, y1)]


def arc(cx, cy, rx, ry, a0, a1, n: int = 48) -> Stroke:
    """Elliptical arc from angle a0 to a1 (degrees; 0 = right, 90 = down, 270 = up)."""
    return [
        (cx + rx * math.cos(math.radians(a)), cy + ry * math.sin(math.radians(a)))
        for a in np.linspace(a0, a1, n)
    ]


def curve(p0, c, p1, n: int = 32) -> Stroke:
    """Quadratic Bezier from p0 to p1 with control point c."""
    out = []
    for t in np.linspace(0, 1, n):
        out.append(
            (
                (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t**2 * p1[0],
                (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t**2 * p1[1],
            )
        )
    return out


def _glyphs(variant: bool) -> dict[str, list[Stroke]]:
    g: dict[str, list[Stroke]] = {
        # As on the real plates: a tall, narrow rounded rectangle (straight sides) with a slash
        # running corner to corner, bottom-left to top-right, touching the outline.
        "0": [
            arc(0.5, 0.22, 0.5, 0.22, 180, 360),
            line(1, 0.22, 1, 0.78),
            arc(0.5, 0.78, 0.5, 0.22, 0, 180),
            line(0, 0.78, 0, 0.22),
            line(0.06, 0.86, 0.94, 0.14),
        ],
        "1": [line(0.5, 0, 0.5, 1), line(0.5, 0, 0.22, 0.22)]
        + ([] if variant else [line(0.2, 1, 0.8, 1)]),
        "2": [arc(0.5, 0.27, 0.46, 0.27, 180, 400), line(0.85, 0.44, 0, 1), line(0, 1, 1, 1)],
        "3": [arc(0.5, 0.26, 0.45, 0.26, 200, 450), arc(0.5, 0.75, 0.5, 0.25, 270, 520)],
        "4": [line(0.72, 1, 0.72, 0), line(0.72, 0, 0, 0.7), line(0, 0.7, 1, 0.7)],
        "5": [
            line(0.9, 0, 0.14, 0),
            line(0.14, 0, 0.12, 0.46),
            arc(0.5, 0.68, 0.46, 0.32, 220, 520),
        ],
        "6": [arc(0.5, 0.7, 0.46, 0.3, 0, 360), curve((0.85, 0.04), (0.05, 0.1), (0.04, 0.7))],
        "7": [line(0, 0, 1, 0), line(1, 0, 0.35, 1) if not variant else line(1, 0, 0.5, 1)],
        "8": [arc(0.5, 0.25, 0.4, 0.25, 0, 360), arc(0.5, 0.74, 0.48, 0.26, 0, 360)],
        "9": [arc(0.5, 0.3, 0.46, 0.3, 0, 360), curve((0.96, 0.3), (0.95, 0.92), (0.15, 0.97))],
        "A": [line(0, 1, 0.5, 0), line(0.5, 0, 1, 1), line(0.2, 0.62, 0.8, 0.62)],
        "B": [
            line(0, 0, 0, 1),
            line(0, 0, 0.62, 0),
            arc(0.62, 0.25, 0.32, 0.25, 270, 450),
            line(0.62, 0.5, 0, 0.5),
            line(0, 0.5, 0.66, 0.5),
            arc(0.66, 0.75, 0.34, 0.25, 270, 450),
            line(0.66, 1, 0, 1),
        ],
        "C": [arc(0.55, 0.5, 0.5, 0.5, 40, 320)],
        "D": [line(0, 0, 0, 1), line(0, 0, 0.45, 0), arc(0.45, 0.5, 0.55, 0.5, 270, 450), line(0.45, 1, 0, 1)],
        "E": [line(1, 0, 0, 0), line(0, 0, 0, 1), line(0, 1, 1, 1), line(0, 0.5, 0.75, 0.5)],
        "F": [line(1, 0, 0, 0), line(0, 0, 0, 1), line(0, 0.5, 0.75, 0.5)],
        "G": [arc(0.55, 0.5, 0.5, 0.5, 30, 320), line(0.98, 0.75, 0.98, 0.55), line(0.98, 0.55, 0.55, 0.55)],
        "H": [line(0, 0, 0, 1), line(1, 0, 1, 1), line(0, 0.5, 1, 0.5)],
        "I": [line(0.5, 0, 0.5, 1), line(0.2, 0, 0.8, 0), line(0.2, 1, 0.8, 1)],
        "J": [line(0.3, 0, 0.9, 0), line(0.75, 0, 0.75, 0.7), arc(0.42, 0.7, 0.33, 0.3, 0, 180)],
        "K": [line(0, 0, 0, 1), line(1, 0, 0, 0.6), line(0.3, 0.42, 1, 1)],
        "L": [line(0, 0, 0, 1), line(0, 1, 1, 1)],
        "M": [line(0, 1, 0, 0), line(0, 0, 0.5, 0.6), line(0.5, 0.6, 1, 0), line(1, 0, 1, 1)],
        "N": [line(0, 1, 0, 0), line(0, 0, 1, 1), line(1, 1, 1, 0)],
        "O": [arc(0.5, 0.5, 0.5, 0.5, 0, 360)],
        "P": [line(0, 1, 0, 0), line(0, 0, 0.6, 0), arc(0.6, 0.27, 0.4, 0.27, 270, 450), line(0.6, 0.54, 0, 0.54)],
        "Q": [arc(0.5, 0.5, 0.5, 0.5, 0, 360), line(0.6, 0.7, 1, 1.05)],
        "R": [
            line(0, 1, 0, 0),
            line(0, 0, 0.6, 0),
            arc(0.6, 0.27, 0.4, 0.27, 270, 450),
            line(0.6, 0.54, 0, 0.54),
            line(0.45, 0.54, 1, 1),
        ],
        "S": [arc(0.5, 0.26, 0.46, 0.26, 330, 90), arc(0.5, 0.76, 0.48, 0.24, 270, 510)],
        "T": [line(0, 0, 1, 0), line(0.5, 0, 0.5, 1)],
        "U": [line(0, 0, 0, 0.65), arc(0.5, 0.65, 0.5, 0.35, 180, 0), line(1, 0.65, 1, 0)],
        "V": [line(0, 0, 0.5, 1), line(0.5, 1, 1, 0)],
        "W": [line(0, 0, 0.22, 1), line(0.22, 1, 0.5, 0.35), line(0.5, 0.35, 0.78, 1), line(0.78, 1, 1, 0)],
        "X": [line(0, 0, 1, 1), line(1, 0, 0, 1)],
        "Y": [line(0, 0, 0.5, 0.5), line(1, 0, 0.5, 0.5), line(0.5, 0.5, 0.5, 1)],
        "Z": [line(0, 0, 1, 0), line(1, 0, 0, 1), line(0, 1, 1, 1)],
    }
    return g


GLYPHS = _glyphs(False)
GLYPHS_VARIANT = _glyphs(True)  # "1" without foot, straighter "7"
assert set(GLYPHS) == set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def dots(
    ch: str,
    width: float,
    height: float,
    spacing: float,
    rng: np.random.Generator,
    jitter: float = 0.08,
    variant: bool = False,
) -> list[tuple[float, float]]:
    """Dot centres (pixels, relative to the glyph's top-left) along every stroke of `ch`.

    spacing: distance between neighbouring dots along a stroke (pixels).
    jitter: random offset of each dot, as a fraction of the spacing.
    """
    placed: list[tuple[float, float]] = []
    for stroke in (GLYPHS_VARIANT if variant else GLYPHS)[ch]:
        pts = np.array([(x * width, y * height) for x, y in stroke], np.float64)
        seg = np.hypot(*np.diff(pts, axis=0).T)
        length = float(seg.sum())
        n = max(1, int(round(length / spacing)))
        cum = np.concatenate([[0.0], np.cumsum(seg)])
        for d in np.linspace(0, length, n + 1):
            i = min(int(np.searchsorted(cum, d, side="right")) - 1, len(seg) - 1)
            t = 0.0 if seg[i] == 0 else (d - cum[i]) / seg[i]
            x, y = pts[i] + t * (pts[i + 1] - pts[i])
            # A dot already there (stroke join, closed loop): don't punch it twice.
            if any((x - px) ** 2 + (y - py) ** 2 < (0.6 * spacing) ** 2 for px, py in placed):
                continue
            placed.append((x, y))
    return [
        (x + rng.normal(0, jitter * spacing), y + rng.normal(0, jitter * spacing))
        for x, y in placed
    ]
