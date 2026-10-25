"""Stage 2: builds the synthetic dataset (train + validation, synthetic only).

  ml/data/synth/
    train/NNNNN.jpg, val/NNNNN.jpg   line images, height 48 (PaddleOCR recognition input)
    train_list.txt, val_list.txt     "relative/path<TAB>LABEL" (PaddleOCR SimpleDataSet format)
    dict.txt                         character set: 0-9, A-Z (one per line)
    meta.csv                         per image: split, kind, label, what was applied
    stats.json                       counts, per-position character balance, effects
  ml/out/stage2/contact_sheet.jpg    50 random training images with their labels

No real photo is read, opened or used anywhere in this script.
Run:  .venv/bin/python scripts/make_dataset.py   (same seed -> identical files)
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
import sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from synth.augment import make_sample  # noqa: E402
from synth.strings import CHARSET, SERIAL_PATTERN, excluded, make_split  # noqa: E402

SEED = 20261017
N_SERIAL, N_NUM8, N_NUM12 = 10_000, 5_000, 5_000
N_CONF_SERIAL, N_CONF_NUM = 1_500, 1_500  # round 2: 0/6/8/9 look-alike practice
VAL_SHARE = 0.10
OUT = ROOT / "data" / "synth"
SHEET = ROOT / "out" / "stage2" / "contact_sheet.jpg"


def job(args):
    split, idx, text, kind, seed = args
    img, info = make_sample(text, seed)
    rel = f"{split}/{idx:05d}.jpg"
    ok = cv2.imwrite(str(OUT / rel), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    assert ok, rel
    return {
        "split": split,
        "file": rel,
        "label": text,
        "kind": kind,
        "seed": seed,
        "width": img.shape[1],
        **{k: (",".join(v) if isinstance(v, list) else v) for k, v in info.items()},
    }


def position_balance(texts: list[str]) -> dict:
    """For each position: how often the least and most frequent allowed character appears."""
    out = {}
    for pos in range(len(texts[0])):
        c = Counter(t[pos] for t in texts)
        out[pos + 1] = {"distinct": len(c), "min": min(c.values()), "max": max(c.values())}
    return out


def contact_sheet(rows: list[dict], n: int = 50) -> None:
    pick = random.Random(SEED).sample([r for r in rows if r["split"] == "train"], n)
    tiles = []
    for r in pick:
        img = cv2.imread(str(OUT / r["file"]))
        img = img[:, :600]
        tile = np.full((70, 610, 3), 255, np.uint8)
        tile[4 : 4 + img.shape[0], 5 : 5 + img.shape[1]] = img
        cv2.putText(tile, r["label"], (6, 66), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)
        tiles.append(tile)
    cols = 2
    grid = [np.hstack(tiles[i : i + cols]) for i in range(0, len(tiles), cols)]
    SHEET.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(SHEET), np.vstack(grid), [cv2.IMWRITE_JPEG_QUALITY, 92])


def main() -> None:
    train, val = make_split(SEED, N_SERIAL, N_NUM8, N_NUM12, VAL_SHARE, N_CONF_SERIAL, N_CONF_NUM)
    rng = random.Random(SEED)
    rng.shuffle(train)
    rng.shuffle(val)
    for split in ("train", "val"):
        (OUT / split).mkdir(parents=True, exist_ok=True)
    jobs = [("train", i, l.text, l.kind, SEED * 10 + i) for i, l in enumerate(train)]
    jobs += [("val", i, l.text, l.kind, SEED * 10 + 1_000_000 + i) for i, l in enumerate(val)]

    with Pool() as pool:
        rows = []
        for n, row in enumerate(pool.imap(job, jobs, chunksize=64), 1):
            rows.append(row)
            if n % 2000 == 0:
                print(f"  {n}/{len(jobs)}", flush=True)

    for split in ("train", "val"):
        with open(OUT / f"{split}_list.txt", "w") as f:
            for r in rows:
                if r["split"] == split:
                    f.write(f"{r['file']}\t{r['label']}\n")
    (OUT / "dict.txt").write_text("\n".join(CHARSET) + "\n")
    with open(OUT / "meta.csv", "w", newline="") as f:
        keys = sorted({k for r in rows for k in r})
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)

    # Reproducibility: 40 images drawn again must be byte-identical.
    check = random.Random(1).sample(jobs, 40)
    same = 0
    for split, idx, text, kind, seed in check:
        img, _ = make_sample(text, seed)
        enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes()
        same += hashlib.md5(enc).digest() == hashlib.md5((OUT / f"{split}/{idx:05d}.jpg").read_bytes()).digest()

    serial_texts = [r["label"] for r in rows if r["kind"] == "serial"]
    labels = [r["label"] for r in rows]
    tr = {r["label"] for r in rows if r["split"] == "train"}
    va = {r["label"] for r in rows if r["split"] == "val"}
    effects = Counter()
    for r in rows:
        for e in str(r.get("heavy") or "").split(","):
            if e:
                effects[e] += 1
    widths = np.array([r["width"] for r in rows])
    stats = {
        "seed": SEED,
        "images": len(rows),
        "by_split_kind": {
            f"{s}/{k}": sum(1 for r in rows if r["split"] == s and r["kind"] == k)
            for s in ("train", "val")
            for k in ("serial", "num8", "num12", "conf_serial", "conf_num")
        },
        "unique_labels": len(set(labels)),
        "labels_in_both_splits": len(tr & va),
        "brief_examples_generated": sum(excluded(t) for t in labels),
        "serial_pattern": SERIAL_PATTERN,
        "serial_year_26_share": round(sum(t.endswith("26") for t in serial_texts) / len(serial_texts), 3),
        "serial_other_years_distinct": len({t[-2:] for t in serial_texts if not t.endswith("26")}),
        "serial_position_balance": position_balance(serial_texts),
        "num8_position_balance": position_balance([r["label"] for r in rows if r["kind"] == "num8"]),
        "num12_position_balance": position_balance([r["label"] for r in rows if r["kind"] == "num12"]),
        "character_totals": dict(sorted(Counter("".join(labels)).items())),
        "plate": dict(Counter(r["plate"] for r in rows)),
        "dots_per_character_height": dict(sorted(Counter(r["dots_high"] for r in rows).items())),
        "dot_spacing_in_diameters": {
            "min": min(r["spacing_per_diameter"] for r in rows),
            "max": max(r["spacing_per_diameter"] for r in rows),
            "mean": round(float(np.mean([r["spacing_per_diameter"] for r in rows])), 3),
        },
        "pit": dict(Counter(r["pit"] for r in rows)),
        "heavy_effects": dict(effects),
        "with_dents_next_to_line": round(sum(int(r["marks"]) > 0 for r in rows) / len(rows), 3),
        "with_scratches_near_line": round(sum(int(r["scratches"]) > 0 for r in rows) / len(rows), 3),
        "high_res_photo_share": round(sum(r["photo_height"] >= 64 for r in rows) / len(rows), 3),
        "heavy_effect_count": dict(
            sorted(Counter(len([e for e in str(r.get("heavy") or "").split(",") if e]) for r in rows).items())
        ),
        "jpeg_compressed_share": round(sum(1 for r in rows if r["jpeg"] not in (None, "")) / len(rows), 3),
        "photo_text_height_px": {"min": min(r["photo_height"] for r in rows), "max": max(r["photo_height"] for r in rows)},
        "image_width_px": {"min": int(widths.min()), "median": int(np.median(widths)), "max": int(widths.max())},
        "redraws": dict(Counter(r["attempt"] for r in rows)),
        "reproducibility_check": f"{same}/40 identical",
    }
    (OUT / "stats.json").write_text(json.dumps(stats, indent=2))
    contact_sheet(rows)
    print(json.dumps({k: v for k, v in stats.items() if "balance" not in k and k != "character_totals"}, indent=2))


if __name__ == "__main__":
    main()
