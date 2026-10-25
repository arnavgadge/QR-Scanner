"""The text of every synthetic line: unique, random within the engraving pattern, balanced so that
every allowed character appears often in every position, and split into train/validation by
unique string (no string in both).

Serial (13): 2 digits + "W" + 2 letters + 5 digits + 1 letter + 2-digit year (mostly "26").
Second line: 8 or 12 digits.
"""
from __future__ import annotations

import random
import hashlib
from dataclasses import dataclass

DIGITS = "0123456789"
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
CHARSET = DIGITS + LETTERS

# Position classes of the serial, e.g. "DDWLLDDDDDLYY" (Y = year digits).
SERIAL_PATTERN = "DDWLLDDDDDLYY"
YEAR = "26"
OTHER_YEAR_SHARE = 0.15

# Example strings quoted in the task brief (real serials from client plates, and answers of the
# real photos): never generated. Kept as SHA-256 fingerprints so the serials themselves are not in
# the repository.
EXCLUDED_SHA256 = {
    "2d32073d9d2e151e1a9bd17a67a62e5408aa0d0ed82dd35437c02aa4a4d6c840",
    "34adb6cc61954c7c4bd10f4636aaeae25cb08999481153788b2e7dbae68881b8",
    "56c6f6fb425a4109c55e61a115945713bbd0347f6bf293efa5747e9c8c386724",
    "d86dd2f97ae316f42e6b4a095ee5ab9271d21b805954d2c770b085a4619d414b",
    "e2b9b4e7a06b6fee067107d38f1180bc351dfd4877b8efc84d40d720f9eedb92",
}


def excluded(text: str) -> bool:
    return hashlib.sha256(text.encode()).hexdigest() in EXCLUDED_SHA256


@dataclass(frozen=True)
class Line:
    text: str
    kind: str  # "serial" | "num8" | "num12" | "conf_serial" | "conf_num" (0/6/8/9 practice)


def _balanced_column(alphabet: str, n: int, rng: random.Random) -> list[str]:
    """n characters where each one of `alphabet` appears equally often (±1), shuffled."""
    col = [alphabet[i % len(alphabet)] for i in range(n)]
    rng.shuffle(col)
    return col


def _unique(build, n: int, rng: random.Random, taken: set[str]) -> list[str]:
    """Builds n strings column-balanced; duplicates (rare) are re-drawn one position at a time."""
    out = build(n)
    seen: set[str] = set()
    for i, s in enumerate(out):
        while s in seen or s in taken or excluded(s):
            s = build(1, single=True)[0]
        seen.add(s)
        out[i] = s
    return out


def serials(n: int, rng: random.Random, taken: set[str]) -> list[str]:
    def build(k: int, single: bool = False) -> list[str]:
        cols = []
        n_other = round(k * OTHER_YEAR_SHARE) if not single else int(rng.random() < OTHER_YEAR_SHARE)
        # Other years: every 2-digit year except "26", spread evenly.
        others = [f"{y:02d}" for y in range(100) if f"{y:02d}" != YEAR]
        other_years = [others[i % len(others)] for i in range(n_other)]
        rng.shuffle(other_years)
        years = other_years + [YEAR] * (k - n_other)
        rng.shuffle(years)
        for cls in SERIAL_PATTERN[:-2]:
            if cls == "D":
                cols.append(_balanced_column(DIGITS, k, rng) if not single else [rng.choice(DIGITS)])
            elif cls == "L":
                cols.append(_balanced_column(LETTERS, k, rng) if not single else [rng.choice(LETTERS)])
            else:
                cols.append([cls] * k)
        return ["".join(c[i] for c in cols) + years[i] for i in range(k)]

    return _unique(build, n, rng, taken)


def digit_lines(n: int, length: int, rng: random.Random, taken: set[str]) -> list[str]:
    def build(k: int, single: bool = False) -> list[str]:
        cols = [
            _balanced_column(DIGITS, k, rng) if not single else [rng.choice(DIGITS)]
            for _ in range(length)
        ]
        return ["".join(c[i] for c in cols) for i in range(k)]

    return _unique(build, n, rng, taken)


# Round 2: practice lines where most digits are the look-alikes 0 (slashed), 6, 8, 9.
CONFUSABLE = "0689"
CONFUSABLE_SHARE = 0.75


def _conf_digit(rng: random.Random) -> str:
    return rng.choice(CONFUSABLE) if rng.random() < CONFUSABLE_SHARE else rng.choice(DIGITS)


def confusable_serials(n: int, rng: random.Random, taken: set[str]) -> list[str]:
    out: list[str] = []
    seen = set(taken)
    while len(out) < n:
        body = "".join(
            _conf_digit(rng) if c == "D" else rng.choice(LETTERS) if c == "L" else "W"
            for c in SERIAL_PATTERN[:-2]
        )
        year = YEAR if rng.random() >= OTHER_YEAR_SHARE else _conf_digit(rng) + _conf_digit(rng)
        t = body + year
        if t not in seen and not excluded(t):
            seen.add(t)
            out.append(t)
    return out


def confusable_digit_lines(n: int, rng: random.Random, taken: set[str]) -> list[str]:
    out: list[str] = []
    seen = set(taken)
    while len(out) < n:
        t = "".join(_conf_digit(rng) for _ in range(8 if len(out) % 2 == 0 else 12))
        if t not in seen and not excluded(t):
            seen.add(t)
            out.append(t)
    return out


def make_split(seed: int, n_serial: int, n_num8: int, n_num12: int, val_share: float,
               n_conf_serial: int = 0, n_conf_num: int = 0):
    """Returns (train, val) lists of Line; stratified by kind; no string in both."""
    rng = random.Random(seed)
    taken: set[str] = set()
    groups: dict[str, list[str]] = {}
    for kind, make in (
        ("serial", lambda: serials(n_serial, rng, taken)),
        ("num8", lambda: digit_lines(n_num8, 8, rng, taken)),
        ("num12", lambda: digit_lines(n_num12, 12, rng, taken)),
        ("conf_serial", lambda: confusable_serials(n_conf_serial, rng, taken)),
        ("conf_num", lambda: confusable_digit_lines(n_conf_num, rng, taken)),
    ):
        groups[kind] = make()
        taken.update(groups[kind])
    train: list[Line] = []
    val: list[Line] = []
    for kind, texts in groups.items():
        texts = sorted(texts)
        rng.shuffle(texts)
        n_val = round(len(texts) * val_share)
        val += [Line(t, kind) for t in texts[:n_val]]
        train += [Line(t, kind) for t in texts[n_val:]]
    assert not {line.text for line in train} & {line.text for line in val}
    return train, val
